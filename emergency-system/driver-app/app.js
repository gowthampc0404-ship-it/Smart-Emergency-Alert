let watchId = null;
let map = null, marker = null;
let myFix = null;

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hideEl(id) { document.getElementById(id).classList.add("hidden"); }
function setStatus(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "status " + (cls || "");
}

function startSharing() {
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  watchId = Connector.startGPS(onFix, onErr, 2000);
}

function onFix(fix) {
  myFix = fix;
  setStatus("gpsStatus", "Sharing live GPS (±" + Math.round(fix.accuracy || 0) + " m)", "ok");
  const c = document.getElementById("coords");
  c.classList.remove("hidden");
  c.textContent = fix.lat.toFixed(5) + ", " + fix.lng.toFixed(5);
  if (broadcasting) Connector.postBroadcastLocation(fix);
  updateMap(fix);
}

function onErr(msg) {
  setStatus("gpsStatus", "GPS error: " + msg, "bad");
  document.getElementById("startBtn").disabled = false;
  myFix = null;
}

function stopSharing() {
  Connector.stopGPS(watchId);
  watchId = null;
  myFix = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("gpsStatus", "GPS stopped", "warn");
}

function initMap() {
  map = L.map("map").setView([13.0827, 80.2707], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}

function updateMap(fix) {
  const ll = [fix.lat, fix.lng];
  if (!map) initMap();
  if (!marker) { marker = L.marker(ll).addTo(map).bindPopup("🚑 I am here"); map.setView(ll, 16); }
  else marker.setLatLng(ll);
}

let broadcasting = false;
let lastCitizenTs = 0;

function startBc() {
  Connector.startBroadcast("Ambulance emergency nearby — keep roads clear").then(() => {
    broadcasting = true;
    document.getElementById("bcStart").disabled = true;
    show("sirenLive");
    setStatus("bcStatus", "🚨 SIREN LIVE — every public phone is alerted automatically", "ok");
  }).catch(() => setStatus("bcStatus", "Could not start the siren — check the backend connection", "bad"));
}

function endBc() {
  Connector.endBroadcast().then(() => {
    broadcasting = false;
    document.getElementById("bcStart").disabled = false;
    hideEl("sirenLive");
    setStatus("bcStatus", "Siren: off", "");
  }).catch(() => setStatus("bcStatus", "Could not stop the siren — check the backend connection", "bad"));
}

function askSOS() {
  show("sosConfirm");
}

function showCitizen() {
  show("citizenCard");
  refreshCitizen();
}

async function refreshCitizen() {
  const d = await Connector.fetchCitizenSOS();
  const ul = document.getElementById("citizenList");
  ul.innerHTML = "";
  if (!d.citizen_sos.length) ul.innerHTML = "<li>No citizen SOS received</li>";
  d.citizen_sos.forEach((c) => {
    const li = document.createElement("li");
    li.textContent = "[" + new Date(c.ts * 1000).toLocaleTimeString() + "] " + c.message + (typeof c.lat === "number" ? " @ " + c.lat.toFixed(4) + "," + c.lng.toFixed(4) : "");
    ul.appendChild(li);
    if (citizenInit && !seenCitizenTs.has(c.ts)) {
      seenCitizenTs.add(c.ts);
      Connector.alarm("sos", "Citizen SOS received. " + c.message);
    }
  });
  citizenInit = true;
  const n = d.citizen_sos.length;
  document.getElementById("citizenCount").textContent = n ? n + " new" : "";
}

async function sendSOS() {
  hideEl("sosConfirm");
  const msg = "SOS EMERGENCY from ambulance driver at " + new Date().toLocaleTimeString();
  try { await Connector.sendBroadcastSOS(msg); } catch (e) {}
  if (!broadcasting) {
    broadcasting = true;
    document.getElementById("bcStart").disabled = true;
    show("sirenLive");
    setStatus("bcStatus", "🆘 SOS LIVE — every public phone sees a red SOS screen", "bad");
  }
}

const seenCitizenTs = new Set();
let citizenInit = false;

async function pollLive() {
  let d;
  try { d = await Connector.fetchBroadcast(myFix); } catch (e) { return; }
  const st = document.getElementById("liveStatus");
  const who = d.active_public_devices != null ? d.active_public_devices + " public app(s) online" : "";
  if (!broadcasting) {
    st.textContent = "Siren off — " + who + ". Turn the siren on to alert everyone.";
    st.className = "status";
  } else if (d.ambulance_stale || !myFix) {
    st.textContent = "🚨 SIREN LIVE — " + who + " — start GPS so they can see your distance";
    st.className = "status warn";
  } else {
    st.textContent = "🚨 SIREN LIVE — broadcasting your GPS — " + who;
    st.className = "status ok";
  }
}

setInterval(() => {
  pollLive();
  if (document.getElementById("citizenCard") && !document.getElementById("citizenCard").classList.contains("hidden")) refreshCitizen();
}, 5000);
pollLive();
