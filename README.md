# Smart Emergency System — GPS Ambulance Early-Warning (College Prototype)
DEMO LINKS:
Driver app:https://robots-chrome-casey-nottingham.trycloudflare.com/driver
Public Link:https://robots-chrome-casey-nottingham.trycloudflare.com/public

WE USED CLOUDFLARE FOR FREE HOSTING 

Web-based GPS early-warning system in two independent apps sharing one FastAPI backend.
**No pairing codes — the driver app and public app connect automatically over the internet.**

## 📡 How it works (no codes, no pairing)
1. **Driver app** (`/driver`): ▶️ Start GPS → 🚨 START SIREN.
2. **Public app** (`/public`): anyone opens it on their phone (anywhere with internet)
   → taps 🆘 ENABLE EMERGENCY ALERTS → they immediately receive every ambulance's
   early-warning (≤2 km) and critical (≤1.5 km) alerts. Distance is computed server-side per device.
3. Driver taps 🆘 SEND SOS (confirm) → every public phone instantly shows a **full-red flashing SOS
   screen** with siren sound, vibration, spoken announcement and a browser notification.
4. Public users can send a **Citizen SOS** back, which appears in the driver app's **Citizen SOS inbox**.

> **Disclaimer:** College prototype. No traffic-signal control, no guaranteed delivery.

## Stack
- **Backend:** Python FastAPI (`backend/main.py`)
- **Frontends:** `driver-app/` and `public-app/` — HTML + CSS + JavaScript, browser Geolocation API for real GPS
- **Connector:** `shared/connector.js` — one shared client module both apps include (API calls, GPS watch, alarm sound, notifications)
- **Map:** Leaflet + OpenStreetMap (loaded from CDN, needs internet)
- **Notifications:** Web Notification API (must be granted permission)
- **Distance:** Haversine formula, computed on the backend (Python)
- **Public access:** served locally via uvicorn; expose with a tunnel (e.g. `cloudflared tunnel --url http://127.0.0.1:8000`) for public URLs

## The two apps
| | URL | Who | Main screens |
|---|---|---|---|
| 🚑 Driver App | `/driver` | Ambulance driver | Start/Stop GPS, START/STOP SIREN broadcast, live status (public apps online), SOS (with confirm), Citizen SOS inbox, map |
| ⚕️ Public App | `/public` | Public | One-tap Enable Alerts, distance to ambulance, alert banners + notifications, map both markers, SOS back to drivers, alert history |

## Features
1. Real GPS via browser `navigator.geolocation.watchPosition` with permission handling
2. Backend computes Haversine distance between ambulance and each public device
3. Automatic warning alert at ≤ 2 km (default), critical alert at ≤ 1.5 km (default)
4. Real-time updates (ambulance posts every 2 s; public app polls every 2.5 s)
5. Map showing ambulance (🚑), public user, distance and GPS status
6. GPS error handling: permission denied / position unavailable / timeout are shown,
   and no alert is ever shown from outdated data (location older than 60 s = "unavailable")
7. Full-red SOS screen + alarm on every public phone when the driver sends SOS
8. Quick actions: Start/Stop GPS, Start/Stop Siren, Test Alarm Sound, SOS, Alert History, Citizen SOS

## Setup (install & run)

```powershell
# 1. Install dependencies
py -m pip install fastapi "uvicorn[standard]"

# 2. Start the server (from the backend folder)
py -m uvicorn main:app --host 127.0.0.1 --port 8000

# 3. (Optional) make it publicly reachable from any phone/internet
cloudflared tunnel --url http://127.0.0.1:8000
#    -> use the printed https://<random>.trycloudflare.com URL (changes on restart)
```

Local URL: `http://127.0.0.1:8000` → open `/driver` and `/public`.

## Location access & permissions
- Browser will ask **"Allow location access"** — click **Allow** (required for real GPS).
- Public app: tap **🆘 ENABLE EMERGENCY ALERTS** and **Allow** notifications once (this also unlocks the alarm sound).
- On a phone, notifications appear while the page is open (keep the screen on during the demo).
  Full background push would need Firebase Cloud Messaging (optional upgrade).

## How to test (2 devices or 2 browser windows)
1. Open `/driver` → ▶️ Start GPS → 🚨 START SIREN.
2. Open `/public` (same PC or any phone via the tunnel URL) → 🆘 ENABLE EMERGENCY ALERTS.
3. Public app shows distance in km once both share GPS.
4. To see **real alerts**, move the devices closer/farther (>2 km apart to reset).
5. To demo **without driving**, use 🔊 Test Alarm Sound in the public app.
6. 🆘 SEND SOS (driver) → red SOS screen + siren on every public phone.
7. 🆘 SEND SOS (public) → appears in the driver's Citizen SOS inbox.

## Honest limitations
- Push notifications fire while the receiving page is open (PWA/FCM needed for true background push).
- Haversine is straight-line distance (not road distance).
- Single-server in-memory storage — no database; state resets when the server restarts.
- Free `trycloudflare.com` tunnel URL changes each time the tunnel restarts.
- Accuracy depends on device GPS (typically 5–30 m).
