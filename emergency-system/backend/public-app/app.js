let watchId = null, gpsOn = false;
let settings = { warn_km: 2.0, critical_km: 1.5 };
let map = null, ambMarker = null, meMarker = null;
let myFix = null;
let bcNotifiedId = null;
let historyEntries = [];
let lastSosId = null;

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hideEl(id) { document.getElementById(id).classList.add("hidden"); }
function setStatus(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "status " + (cls || "");
}
function banner(text, cls) {
  const el = document.getElementById("banner");
  if (!text) { el.className = "banner"; return; }
  el.className = "banner " + cls;
  el.textContent = text;
}
function setAlertMode(on) {
  document.body.classList.toggle("alert-mode", on);
}
function setDistance(text, cls) {
  const el = document.getElementById("distanceBig");
  el.textContent = text;
  el.className = "distBig" + (cls ? " " + cls : "");
}

function arm() {
  Connector.unlockAudio();
  Connector.requestNotificationPermission(() => {}, () => {});
  setStatus("armStatus", "🛡️ Armed — you will hear alarms automatically", "ok");
  document.getElementById("armBtn").disabled = true;
  document.getElementById("armBtn").textContent = "🛡️ ALERTS ENABLED";
  show("alertPanel");
  myGpsOn();
}

function myGpsOn() {
  if (!navigator.geolocation) return setStatus("armStatus", "Geolocation not supported", "bad");
  watchId = Connector.startGPS(onFix, onErr, 2500);
  gpsOn = true;
}

function myGpsToggle() {
  if (gpsOn) {
    Connector.stopGPS(watchId);
    watchId = null;
    gpsOn = false;
    myFix = null;
    setStatus("armStatus", "Location off — alerts continue, distance hidden", "warn");
  } else {
    myGpsOn();
  }
}

function onFix(fix) {
  myFix = fix;
  Connector.registerPublicDevice(fix);
  setStatus("armStatus", "GPS live (±" + Math.round(fix.accuracy || 0) + " m)", "ok");
  updateMe(fix);
}

function onErr(msg) {
  setStatus("armStatus", "GPS: " + msg + " — still receiving alerts, distance unavailable", "warn");
  myFix = null;
}

function initMap() {
  map = L.map("map").setView([13.0827, 80.2707], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}

function updateMe(fix) {
  if (!map) initMap();
  const ll = [fix.lat, fix.lng];
  if (!meMarker) { meMarker = L.marker(ll).addTo(map).bindPopup("⚕️ Me"); map.setView(ll, 16); }
  else meMarker.setLatLng(ll);
}

function updateAmbulance(ll, label) {
  if (!map) initMap();
  if (!ambMarker) ambMarker = L.marker(ll).addTo(map).bindPopup(label);
  else { ambMarker.setLatLng(ll); ambMarker.setPopupContent ? ambMarker.setPopupContent(label) : null; }
  if (meMarker && ambMarker) map.fitBounds([meMarker.getLatLng(), ambMarker.getLatLng()], { padding: [40, 40] });
  else map.setView(ll, 15);
}

async function poll() {
  Connector.registerPublicDevice(myFix);
  let d;
  try { d = await Connector.fetchBroadcast(myFix); } catch (e) { return; }

  if (d.sos && d.sos.id !== lastSosId) {
    lastSosId = d.sos.id;
    showSosScreen(d.sos);
  }

  const st = document.getElementById("liveStatus");
  const who = d.active_public_devices != null ? " · " + d.active_public_devices + " apps online" : "";

  if (!d.active) {
    setAlertMode(false);
    hideEl("banner");
    setDistance("🚨 LISTENING", "");
    st.textContent = "No emergency broadcast right now";
    st.className = "status";
    st.textContent = "Listening for emergency broadcasts…" + who;
    if (ambMarker && map) { map.removeLayer(ambMarker); ambMarker = null; }
    return;
  }

  setAlertMode(true);

  if (!d.ambulance_stale && d.ambulance) {
    updateAmbulance([d.ambulance.lat, d.ambulance.lng], "🚑 Ambulance (siren live)");
  }

  if (d.ambulance_stale || d.gps_status !== "ok") {
    setDistance("🚨 SIREN!", "alarm");
    st.textContent = "Emergency siren active — ambulance location unavailable" + who;
    st.className = "status warn";
    if (bcNotifiedId !== d.started_ts + "-st") {
      bcNotifiedId = d.started_ts + "-st";
      banner("🚨 EMERGENCY SIREN BROADCAST — ambulance reported in your area", "sos");
      Connector.alarm("critical", "Emergency siren broadcast. Ambulance reported in your area.");
      Connector.pushNotification("🚨 EMERGENCY SIREN", "Ambulance SOS active in your area!", "bc" + bcNotifiedId);
      pushHistory({ level: "sos", ts: d.started_ts, distance_km: null });
    }
    return;
  }

  if (!myFix) {
    setDistance("🚨 SIREN!", "alarm");
    st.textContent = "Siren active — turn on my location to see distance" + who;
    st.className = "status warn";
    return;
  }

  if (d.distance_km == null) {
    setDistance("🚨 SIREN!", "alarm");
    st.textContent = "Siren active — computing distance…";
    st.className = "status warn";
    return;
  }

  setDistance(d.distance_km + " km" + (d.distance_km < 0.1 ? " — VERY CLOSE" : ""), "alarm");
  st.textContent = "Ambulance " + d.distance_km + " km away" + who;
  st.className = "status ok";

  if (d.alert_level === "critical" && bcNotifiedId !== "c" + d.started_ts) {
    bcNotifiedId = "c" + d.started_ts;
    banner("🚨 CRITICAL: Ambulance " + d.distance_km + " km away — MOVE OFF THE ROAD", "critical");
    Connector.alarm("critical", "Critical. Ambulance is " + d.distance_km + " kilometres away.");
    Connector.pushNotification("🚨 CRITICAL SIREN", "Ambulance " + d.distance_km + " km away!", "bc" + bcNotifiedId);
    pushHistory({ level: "critical", ts: d.started_ts, distance_km: d.distance_km });
  } else if (d.alert_level === "warning" && bcNotifiedId !== "w" + d.started_ts) {
    bcNotifiedId = "w" + d.started_ts;
    banner("⚠️ EARLY WARNING: Ambulance " + d.distance_km + " km away", "warning");
    Connector.alarm("warning", "Ambulance approaching, " + d.distance_km + " kilometres away.");
    Connector.pushNotification("⚠️ SIREN NEARBY", "Ambulance " + d.distance_km + " km away", "bc" + bcNotifiedId);
    pushHistory({ level: "warning", ts: d.started_ts, distance_km: d.distance_km });
  }
}

function showSosScreen(sos) {
  const scr = document.getElementById("sosScreen");
  document.getElementById("sosScreenMsg").textContent = "🆘 SOS EMERGENCY";
  document.getElementById("sosScreenInfo").textContent =
    "Ambulance driver triggered SOS at " + new Date(sos.ts * 1000).toLocaleTimeString();
  scr.classList.remove("hidden");
  Connector.unlockAudio();
  Connector.alarm("sos", "SOS emergency. Ambulance driver has triggered an SOS.");
  Connector.pushNotification("🆘 SOS EMERGENCY", sos.message || "Ambulance driver triggered an SOS!", "sosscreen" + sos.id);
  pushHistory({ level: "sos", ts: sos.ts, distance_km: null });
}

function dismissSosScreen() {
  document.getElementById("sosScreen").classList.add("hidden");
}

function pushHistory(entry) {
  historyEntries.unshift({
    ts: entry.ts,
    level: entry.level,
    distance_km: entry.distance_km,
  });
  if (historyEntries.length > 50) historyEntries.pop();
}

function openHistoryCard() {
  const ul = document.getElementById("historyList");
  ul.innerHTML = "";
  if (!historyEntries.length) ul.innerHTML = "<li>No alerts received yet</li>";
  historyEntries.forEach((h) => {
    const li = document.createElement("li");
    li.textContent = "[" + new Date(h.ts * 1000).toLocaleTimeString() + "] " + (h.level === "sos" ? "🆘 SOS" : "🚨 SIREN " + h.level.toUpperCase()) + (h.distance_km != null ? " (" + h.distance_km + " km)" : "");
    ul.appendChild(li);
  });
  show("historyCard");
}

function testSound() {
  Connector.unlockAudio();
  Connector.alarm("critical", "Sound test. This is how the emergency siren alarm sounds.");
}

function askSOS() {
  show("sosConfirm");
}

async function sendSOS() {
  const msg = "Citizen SOS: help requested at " + new Date().toLocaleTimeString();
  await Connector.sendPublicSOS(msg, myFix);
  hideEl("sosConfirm");
  const b = document.getElementById("sosBtn");
  b.textContent = "✅ SOS sent";
  setTimeout(() => (b.textContent = "🆘 SEND SOS"), 4000);
}

setInterval(poll, 2500);
poll();
