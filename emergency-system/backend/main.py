import math
import time
import uuid
import secrets
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="Smart Emergency System")

BASE_DIR = Path(__file__).resolve().parent.parent

STALE_SEC = 60

pairs: dict = {}
public_devices: dict = {}
broadcast: dict = {
    "active": False,
    "started_ts": 0.0,
    "message": "",
    "ambulance": None,
    "amb_ts": 0.0,
    "sos": None,
}

SOS_VISIBLE_SEC = 300
citizen_sos: list = []


class Location(BaseModel):
    lat: float
    lng: float
    accuracy: float = 0.0
    timestamp: float = 0.0


class LocationPost(BaseModel):
    role: str
    lat: float
    lng: float
    accuracy: float = 0.0
    timestamp: float = 0.0


class SettingsUpdate(BaseModel):
    warn_km: Optional[float] = None
    critical_km: Optional[float] = None


class SOSRequest(BaseModel):
    message: str = "SOS emergency requested"


class TestAlertRequest(BaseModel):
    level: float


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def new_pair():
    code = secrets.token_hex(3).upper()
    while code in pairs:
        code = secrets.token_hex(3).upper()
    return code


def alert_level_for(distance_km, warn_km, critical_km):
    if distance_km <= critical_km:
        return "critical"
    if distance_km <= warn_km:
        return "warning"
    return None


@app.post("/api/pair/create")
def create_pair():
    code = new_pair()
    pairs[code] = {
        "ambulance": None,
        "receiver": None,
        "last_active": {"ambulance": 0.0, "receiver": 0.0},
        "settings": {"warn_km": 2.0, "critical_km": 1.5},
        "alert_state": {"level": None, "ts": 0.0},
        "history": [],
        "sos": None,
    }
    return {"code": code}


@app.post("/api/pair/{code}/join")
def join_pair(code: str):
    if code not in pairs:
        raise HTTPException(404, "Pair code not found")
    return {"code": code, "settings": pairs[code]["settings"]}


@app.post("/api/pair/{code}/location")
def post_location(code: str, body: LocationPost):
    if body.role not in ("ambulance", "receiver"):
        raise HTTPException(400, "role must be ambulance or receiver")
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    now = time.time()
    p[body.role] = {
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
        "timestamp": body.timestamp or now,
    }
    if body.role == "ambulance" and p["last_active"]["ambulance"] and now - p["last_active"]["ambulance"] > STALE_SEC:
        p["alert_state"] = {"level": None, "ts": now}
    p["last_active"][body.role] = now

    amb, rec = p["ambulance"], p["receiver"]
    result = {
        "time": now,
        "ambulance_stale": True,
        "receiver_ready": bool(rec),
        "distance_km": None,
        "alert": {"level": None, "is_test": False},
    }
    if not amb or not rec:
        return result

    amb_age = now - p["last_active"]["ambulance"]
    result["ambulance_stale"] = amb_age > STALE_SEC
    if result["ambulance_stale"]:
        result["gps_status"] = "outdated"
        return result

    dist = haversine_km(amb["lat"], amb["lng"], rec["lat"], rec["lng"])
    result["distance_km"] = round(dist, 3)
    result["gps_status"] = "ok"

    s = p["settings"]
    lvl = alert_level_for(dist, s["warn_km"], s["critical_km"])
    st = p["alert_state"]
    if lvl and st["level"] != lvl:
        st["level"] = lvl
        st["ts"] = now
        entry = {
            "id": str(uuid.uuid4())[:8],
            "ts": now,
            "level": lvl,
            "distance_km": round(dist, 3),
            "is_test": False,
        }
        p["history"].insert(0, entry)
        result["alert"] = entry
    elif lvl is None and st["level"]:
        st["level"] = None
    return result


@app.get("/api/pair/{code}/state")
def get_state(code: str):
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    now = time.time()
    amb, rec = p["ambulance"], p["receiver"]
    stale = (not amb) or (now - p["last_active"]["ambulance"] > STALE_SEC)
    distance = None
    if amb and rec and not stale:
        distance = round(haversine_km(amb["lat"], amb["lng"], rec["lat"], rec["lng"]), 3)
    return {
        "ambulance": amb,
        "receiver": rec,
        "ambulance_stale": stale,
        "distance_km": distance,
        "gps_status": "ok" if (amb and rec and not stale) else "unavailable",
        "settings": p["settings"],
        "alert_level": None if stale else p["alert_state"]["level"],
        "history": p["history"][:30],
        "sos": p["sos"],
    }


@app.post("/api/pair/{code}/settings")
def update_settings(code: str, body: SettingsUpdate):
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    if body.warn_km is not None:
        p["settings"]["warn_km"] = float(body.warn_km)
    if body.critical_km is not None:
        p["settings"]["critical_km"] = float(body.critical_km)
    w, c = p["settings"]["warn_km"], p["settings"]["critical_km"]
    if c >= w:
        p["settings"]["critical_km"] = w if w > 0 else c
        w, c = p["settings"]["warn_km"], p["settings"]["critical_km"]
    return p["settings"]


@app.post("/api/pair/{code}/sos")
def sos(code: str, body: SOSRequest):
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    p["sos"] = {"ts": time.time(), "message": body.message}
    p["history"].insert(
        0,
        {"id": str(uuid.uuid4())[:8], "ts": time.time(), "level": "sos", "distance_km": None, "is_test": False},
    )
    return {"ok": True, "sos": p["sos"]}


@app.post("/api/pair/{code}/test-alert")
def test_alert(code: str, body: TestAlertRequest):
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    lvl = "critical" if body.level <= p["settings"]["critical_km"] else "warning"
    entry = {
        "id": str(uuid.uuid4())[:8],
        "ts": time.time(),
        "level": lvl,
        "distance_km": body.level,
        "is_test": True,
    }
    p["history"].insert(0, entry)
    return {"ok": True, "alert": entry}


@app.get("/api/pair/{code}/history")
def history(code: str):
    p = pairs.get(code)
    if p is None:
        raise HTTPException(404, "Pair code not found")
    return {"history": p["history"][:50]}


driver_dir = BASE_DIR / "driver-app"
public_dir = BASE_DIR / "public-app"
shared_dir = BASE_DIR / "shared"


@app.get("/")
def root():
    return {"driver_app": "/driver", "public_app": "/public", "connector": "/shared/connector.js"}


@app.get("/driver")
def driver_app():
    return FileResponse(driver_dir / "index.html")


@app.get("/public")
def public_app():
    return FileResponse(public_dir / "index.html")


if driver_dir.exists():
    app.mount("/driver-static", StaticFiles(directory=driver_dir), name="driver")

if public_dir.exists():
    app.mount("/public-static", StaticFiles(directory=public_dir), name="public")

if shared_dir.exists():
    app.mount("/shared", StaticFiles(directory=shared_dir), name="shared")


class DeviceRegister(BaseModel):
    id: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class BroadcastLocation(BaseModel):
    lat: float
    lng: float
    accuracy: float = 0.0


class BroadcastMessage(BaseModel):
    message: str = "Ambulance emergency nearby"


class BroadcastSOSRequest(BaseModel):
    message: str = "SOS EMERGENCY from ambulance driver"


class BroadcastSOS(BaseModel):
    message: str = "SOS EMERGENCY from ambulance"


class PublicSOS(BaseModel):
    id: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    message: str = "Citizen SOS raised"


@app.post("/api/public/device")
def register_device(body: DeviceRegister):
    now = time.time()
    public_devices[body.id] = {
        "lat": body.lat,
        "lng": body.lng,
        "last_seen": now,
    }
    active_devices = sum(
        1 for d in public_devices.values() if now - d["last_seen"] < 120
    )
    return {"ok": True, "active_public_devices": active_devices}


@app.post("/api/broadcast/start")
def broadcast_start(body: BroadcastMessage):
    broadcast["active"] = True
    broadcast["started_ts"] = time.time()
    broadcast["message"] = body.message
    return {"ok": True, "active": True}


@app.post("/api/broadcast/end")
def broadcast_end():
    broadcast["active"] = False
    return {"ok": True, "active": False}


@app.post("/api/broadcast/sos")
def broadcast_sos(body: BroadcastSOS):
    now = time.time()
    broadcast["active"] = True
    broadcast["message"] = body.message
    if not broadcast["started_ts"]:
        broadcast["started_ts"] = now
    entry = {"id": str(uuid.uuid4())[:8], "ts": now, "message": body.message}
    broadcast["sos"] = entry
    return {"ok": True, "sos": entry}


@app.post("/api/broadcast/ambulance/location")
def broadcast_ambulance_location(body: BroadcastLocation):
    if not broadcast["active"]:
        raise HTTPException(400, "broadcast not active")
    broadcast["ambulance"] = {
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
    }
    broadcast["amb_ts"] = time.time()
    return {"ok": True}


@app.post("/api/broadcast/sos")
def broadcast_sos(body: BroadcastSOSRequest):
    entry = {
        "id": str(uuid.uuid4())[:8],
        "ts": time.time(),
        "message": body.message,
    }
    broadcast["sos"] = entry
    return {"ok": True, "sos": entry}


@app.get("/api/broadcast")
def get_broadcast(device_id: str = "", lat: float = None, lng: float = None):
    now = time.time()
    result = {
        "active": broadcast["active"],
        "started_ts": broadcast["started_ts"],
        "message": broadcast["message"],
        "sos": broadcast["sos"],
        "ambulance_stale": True,
        "distance_km": None,
        "alert_level": None,
        "gps_status": "unavailable",
        "ambulance": None,
        "active_public_devices": sum(
            1 for d in public_devices.values() if now - d["last_seen"] < 120
        ),
    }
    if broadcast["sos"] and now - broadcast["sos"]["ts"] > SOS_VISIBLE_SEC:
        broadcast["sos"] = None
    result["sos"] = broadcast["sos"]
    if not broadcast["active"]:
        return result

    amb = broadcast["ambulance"]
    result["ambulance"] = amb
    result["ambulance_stale"] = (not amb) or (now - broadcast["amb_ts"] > STALE_SEC)
    if result["ambulance_stale"]:
        return result
    result["gps_status"] = "ok"

    if lat is None or lng is None:
        return result

    dist = haversine_km(amb["lat"], amb["lng"], lat, lng)
    result["distance_km"] = round(dist, 3)
    result["alert_level"] = alert_level_for(dist, 2.0, 1.5)
    return result


@app.post("/api/public/sos")
def public_sos(body: PublicSOS):
    now = time.time()
    entry = {
        "ts": now,
        "device_id": body.id,
        "message": body.message,
        "lat": body.lat,
        "lng": body.lng,
    }
    citizen_sos.insert(0, entry)
    del citizen_sos[10:]
    return {"ok": True, "sos": entry}


@app.get("/api/public/sos")
def get_citizen_sos():
    seen = {c["ts"] for c in citizen_sos if now_ok(c)}
    recent = [c for c in citizen_sos if time.time() - c["ts"] < 600]
    return {"citizen_sos": recent}


def now_ok(c):
    return True
