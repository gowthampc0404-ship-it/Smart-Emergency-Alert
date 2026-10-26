const API_HOST = window.API_HOST || "";

const Connector = {
  code: null,
  role: null,

  createPair(role) {
    this.role = role;
    return fetchJson(API_HOST + "/api/pair/create", "POST").then((d) => {
      this.code = d.code;
      return d;
    });
  },

  joinPair(code) {
    this.role = "receiver";
    return fetchJson(API_HOST + "/api/pair/" + code + "/join", "POST").then((d) => {
      this.code = code;
      return d;
    });
  },

  postLocation(fix) {
    const body = {
      role: this.role,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
    };
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/location", "POST", body);
  },

  pollState() {
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/state", "GET");
  },

  sendSOS(message) {
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/sos", "POST", { message });
  },

  testAlert(km) {
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/test-alert", "POST", { level: km });
  },

  updateSettings(warnKm, criticalKm) {
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/settings", "POST", {
      warn_km: warnKm,
      critical_km: criticalKm,
    });
  },

  history() {
    return fetchJson(API_HOST + "/api/pair/" + this.code + "/history", "GET");
  },

  deviceId() {
    if (!localStorage.getItem("ses_device_id")) {
      localStorage.setItem("ses_device_id", crypto.randomUUID());
    }
    return localStorage.getItem("ses_device_id");
  },

  registerPublicDevice(fix) {
    return fetchJson(API_HOST + "/api/public/device", "POST", {
      id: this.deviceId(),
      lat: fix ? fix.lat : null,
      lng: fix ? fix.lng : null,
    });
  },

  startBroadcast(message) {
    return fetchJson(API_HOST + "/api/broadcast/start", "POST", { message });
  },

  endBroadcast() {
    return fetchJson(API_HOST + "/api/broadcast/end", "POST");
  },

  postBroadcastLocation(fix) {
    return fetchJson(API_HOST + "/api/broadcast/ambulance/location", "POST", {
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
    });
  },

  fetchBroadcast(fix) {
    let url = API_HOST + "/api/broadcast";
    if (fix && typeof fix.lat === "number") {
      url += "?lat=" + encodeURIComponent(fix.lat) + "&lng=" + encodeURIComponent(fix.lng);
    }
    return fetchJson(url, "GET");
  },

  sendBroadcastSOS(message) {
    return fetchJson(API_HOST + "/api/broadcast/sos", "POST", { message });
  },

  sendPublicSOS(message, fix) {
    return fetchJson(API_HOST + "/api/public/sos", "POST", {
      id: this.deviceId(),
      message,
      lat: fix ? fix.lat : null,
      lng: fix ? fix.lng : null,
    });
  },

  fetchCitizenSOS() {
    return fetchJson(API_HOST + "/api/public/sos", "GET");
  },

  startGPS(onFix, onError, minInterval) {
    if (!navigator.geolocation) {
      onError("Geolocation not supported");
      return null;
    }
    let lastSend = 0;
    return navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        const now = Date.now();
        if (now - lastSend >= (minInterval || 2000)) {
          lastSend = now;
          onFix(fix);
        }
      },
      (err) => {
        onError({ 1: "permission denied", 2: "position unavailable", 3: "timeout" }[err.code] || err.message);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  },

  stopGPS(watchId) {
    if (watchId !== null && watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  },

  requestNotificationPermission(ok, denied) {
    if (!("Notification" in window)) return denied("notifications unsupported");
    Notification.requestPermission().then((p) => (p === "granted" ? ok(p) : denied(p)));
  },

  pushNotification(title, body, key) {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    if (this._shown && this._shown.has(key)) return false;
    (this._shown = this._shown || new Set()).add(key);
    new Notification(title, { body, requireInteraction: true, tag: key });
    return true;
  },

  _audioCtx: null,

  unlockAudio() {
    if (!this._audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this._audioCtx = new AC();
    }
    if (this._audioCtx.state === "suspended") this._audioCtx.resume();
    return this._audioCtx.state === "running";
  },

  _siren(cycles, baseHz, topHz, gainVal) {
    const ctx = this.unlockAudio() ? this._audioCtx : null;
    if (!ctx) return false;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    for (let i = 0; i < cycles; i++) {
      osc.frequency.setValueAtTime(baseHz, t0 + i * 0.4);
      osc.frequency.linearRampToValueAtTime(topHz, t0 + i * 0.4 + 0.2);
      osc.frequency.linearRampToValueAtTime(baseHz, t0 + i * 0.4 + 0.4);
      gain.gain.setValueAtTime(gainVal, t0 + i * 0.4);
    }
    gain.gain.setValueAtTime(0, t0 + cycles * 0.4 + 0.05);
    osc.start(t0);
    osc.stop(t0 + cycles * 0.4 + 0.1);
    return true;
  },

  alarm(level, spokenText) {
    const loud = level === "critical" || level === "sos";
    if (loud) this._siren(10, 450, 1250, 0.35);
    else this._siren(2, 500, 900, 0.25);
    if (loud && navigator.vibrate) navigator.vibrate([600, 150, 600, 150, 600, 150, 900]);
    else if (navigator.vibrate) navigator.vibrate(300);
    try {
      if ("speechSynthesis" in window && level !== "test") {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(spokenText || "");
        u.rate = 1.05;
        u.volume = 1;
        speechSynthesis.speak(u);
      }
    } catch (e) {}
    return true;
  },
};

function fetchJson(url, method, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then((res) => res.json());
}
