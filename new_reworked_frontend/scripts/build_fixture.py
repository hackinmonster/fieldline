"""Builds src/data/fixture.json: the offline snapshot Fieldline uses when the backend is not running.

It mirrors what the Command dashboard shows after "Load scenario" (replay/scenario.yaml), parked at live_start:
the same volunteers, the same 15 reports word for word, and the incidents/tasks the pipeline makes from them.

REAL: NCDOT TIMS closures active at live_start, USGS gauge stages at live_start, OSRM driving routes (OpenStreetMap).
SCENARIO: volunteers and reports, read straight from replay/scenario.yaml.
HAND-WRITTEN: incident/task wording. With the backend running, the LLM pipeline writes these; here they are
written to match the scenario so the offline demo tells the same story.

Run from new_reworked_frontend/:  python3 scripts/build_fixture.py
"""
import json
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
DATA = REPO / "backend" / "data"
SC = yaml.safe_load((REPO / "replay" / "scenario.yaml").read_text())
NOW = SC["live_start"].replace("+00:00", "Z") if isinstance(SC["live_start"], str) else SC["live_start"].strftime("%Y-%m-%dT%H:%M:%SZ")
BBOX = (-82.80, 35.42, -82.25, 35.80)


def ts(s):
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def osrm(a, b):
    url = (f"https://router.project-osrm.org/route/v1/driving/{a[0]},{a[1]};{b[0]},{b[1]}"
           "?overview=full&geometries=geojson&steps=true")
    with urllib.request.urlopen(url, timeout=30) as r:
        route = json.load(r)["routes"][0]
    steps = [{"type": s["maneuver"]["type"], "modifier": s["maneuver"].get("modifier"), "name": s["name"],
              "distance_m": round(s["distance"]), "location": s["maneuver"]["location"]}
             for leg in route["legs"] for s in leg["steps"]]
    coords = [[round(x, 5), round(y, 5)] for x, y in route["geometry"]["coordinates"]]
    return {"type": "LineString", "coordinates": coords}, round(route["duration"]), round(route["distance"]), steps


def inside(c):
    return BBOX[0] <= c[0] <= BBOX[2] and BBOX[1] <= c[1] <= BBOX[3]


# ---- Real: NCDOT closures active at live_start ----
closures, closure_obs = [], []
for f in json.load(open(DATA / "ncdot_closures.geojson"))["features"]:
    p, g = f["properties"], f["geometry"]
    if not g or g["type"] != "LineString" or p["county"] != "Buncombe":
        continue
    if not (ts(p["closed_at"]) <= ts(NOW) < (ts(p["reopened_at"]) if p["reopened_at"] else ts("9999-01-01T00:00:00Z"))):
        continue
    if not any(inside(c) for c in g["coordinates"]):
        continue
    cid = len(closures) + 1
    coords = [[round(x, 5), round(y, 5)] for x, y in g["coordinates"]]
    closures.append({"id": cid, "name": p["road_name"], "closed_reason": p["description"], "closed_since": p["closed_at"],
                     "geometry": {"type": "LineString", "coordinates": coords}})
    closure_obs.append((max(ts(p["closed_at"]), ts(SC["start"])), p, coords[len(coords) // 2]))

# ---- Real: latest USGS reading per gauge at live_start ----
sites = {s["site_id"]: s for s in json.load(open(DATA / "usgs_sites.json"))}
latest = {}
for r in json.load(open(DATA / "usgs_readings.json")):
    if r["stage_ft"] is not None and ts(r["at"]) <= ts(NOW):
        latest[r["site_id"]] = r
sensors = [{"site_id": k, "name": sites[k]["site_name"].title().replace(", Nc", ", NC"), "flood_stage_ft": sites[k]["flood_stage_ft"],
            "lon": sites[k]["lon"], "lat": sites[k]["lat"], "stage_ft": v["stage_ft"], "discharge_cfs": v["discharge_cfs"],
            "at": ts(v["at"]).isoformat(), "peak_stage_ft": sites[k]["peak_stage_ft"]} for k, v in latest.items()]

# ---- Scenario volunteers (ids in registration order, as the backend assigns them) ----
volunteers = []
for i, v in enumerate(SC["volunteers"], start=1):
    volunteers.append({"id": i, "name": v["name"], "lon": v["lon"], "lat": v["lat"], "available": True,
                       "verify_safe": v.get("verify_safe", False), "vehicle": v.get("vehicle"),
                       "skills": v.get("skills", []), "equipment": v.get("equipment", [])})
JORDAN = (volunteers[0]["lon"], volunteers[0]["lat"])

# ---- Places named in the scenario reports (geocode_cache.json where it resolved them) ----
P = {
    "bee_tree": (-82.41275, 35.63187), "ab_tech": (-82.55186, 35.56837), "leicester": (-82.69624, 35.65511),
    "fairview_es": (-82.39670, 35.52360), "reems_creek": (-82.56164, 35.68779), "town_mtn": (-82.5205, 35.6178),
    "whitson": (-82.3986, 35.5975), "bm_library": (-82.3209, 35.6178),
}

# ---- Incidents and tasks: one per scenario need; the swift-water call stays a hazard with no task ----
#   key: (incident type, location_text, task or None)
def task(type, title, description, lonlat, urgency, priority, req, reasoning, address):
    base = {"vehicle": False, "high_clearance": False, "min_capacity_gal": 0, "min_seats": 0, "skills": [], "equipment": [], "supplies": []}
    return {"type": type, "title": title, "description": description, "lon": lonlat[0], "lat": lonlat[1], "urgency": urgency,
            "priority": priority, "requirements": {**base, **req}, "proposal_reasoning": reasoning, "address": address}


SPEC = {
    "Water rescue traffic": ("water_rescue", "Whitson Ave at the river, Swannanoa", P["whitson"], None),
    "grandfather unreachable": ("welfare_check", "Dillingham Rd, Barnardsville", None, task(
        "WELLNESS_CHECK", "Check on Earl, 79, alone on Dillingham Rd", "Earl lives alone on Dillingham Rd in Barnardsville / Big Ivy. No cell service and nobody has heard from him since Thursday night. He no longer drives. Knock and speak with him; if no answer, report it, do not force entry.",
        (-82.418, 35.781), 0.72, 74, {"vehicle": True, "high_clearance": True}, "Granddaughter's post: older adult living alone, no contact for 2+ days, no vehicle, no cell coverage.", "Dillingham Rd, Barnardsville")),
    "out of infant formula": ("supply_need", "AB Tech, 340 Victoria Rd, Asheville", None, task(
        "DELIVER_SUPPLIES", "Infant formula and size 3–4 diapers to AB Tech shelter", "The AB Tech shelter has 3 infants and is out of formula and size 3 and 4 diapers. Check in at the front desk.",
        P["ab_tech"], 0.55, 58, {"vehicle": True, "supplies": ["infant formula", "diapers size 3", "diapers size 4"]}, "Shelter coordinator by hotline. Needed tonight, not an emergency.", "340 Victoria Rd, Asheville")),
    "family needs water": ("supply_need", "Leicester Hwy near Dollar General, Leicester", None, task(
        "DELIVER_SUPPLIES", "Water and diapers for a family of 5 in Leicester", "Family of five on Leicester Hwy near the Dollar General: no water since Friday, two small children, out of diapers, no car. They wrote in Spanish.",
        P["leicester"], 0.74, 77, {"vehicle": True, "min_capacity_gal": 10, "skills": ["spanish"], "supplies": ["10 gal drinking water", "diapers (ask size)"]}, "Direct SMS request; young children, no water 2+ days, no vehicle. Spanish speaker preferred.", "Leicester Hwy, Leicester")),
    "insulin warming": ("medical_supply", "Haywood Rd by the old Sears lot, West Asheville", None, task(
        "DELIVER_SUPPLIES", "Cooler and ice for insulin, Haywood Rd", "Neighbor is type 1 diabetic; her insulin has been unrefrigerated since Friday. Bring a cooler with ice.",
        (-82.5865, 35.5786), 0.8, 82, {"equipment": ["cooler"], "supplies": ["ice (10 lb)"]}, "Medication at risk for an insulin-dependent resident; time-sensitive.", "Haywood Rd, West Asheville")),
    "food boxes": ("supply_need", "Cane Creek Rd area, Fairview", None, task(
        "DELIVER_SUPPLIES", "Drive 15 food boxes to Fairview Elementary", "MANNA FoodBank has 15 food boxes (~25 lb each) staged for Cane Creek Rd households. Take them to the distribution table at Fairview Elementary School.",
        P["fairview_es"], 0.5, 54, {"vehicle": True, "min_capacity_gal": 30, "skills": ["heavy_lifting"]}, "NGO request for a driver; about 15 households cut off from groceries.", "Fairview Elementary School, Fairview")),
    "dialysis patient": ("transport_need", "Reems Creek Rd, Weaverville", None, task(
        "TRANSPORT", "Ride to dialysis for a 66-year-old, Reems Creek Rd", "Client on Reems Creek Rd needs a ride to her dialysis appointment in Asheville tomorrow morning. Walks with a cane; one passenger.",
        P["reems_creek"], 0.78, 80, {"vehicle": True, "min_seats": 1}, "Missed dialysis is a health risk; regular transit suspended.", "Reems Creek Rd, Weaverville")),
    "roof hole": ("shelter_need", "Pisgah Hwy, Candler", None, task(
        "DELIVER_SUPPLIES", "Put a tarp on a roof hole, Pisgah Hwy", "An oak came down on the back of the house; rain is coming in. The 68-year-old owner can't get on a ladder. Bring a tarp and put it up.",
        (-82.7155, 35.5175), 0.6, 63, {"vehicle": True, "skills": ["heavy_lifting"], "equipment": ["ladder"], "supplies": ["roof tarp", "furring strips or sandbags"]}, "Older adult alone; ongoing water damage.", "Pisgah Hwy, Candler")),
    "Unconfirmed slide": ("landslide", "Town Mountain Rd past the overlook", None, task(
        "VERIFY_CONDITION", "Is Town Mountain Rd passable past the overlook?", "Second-hand report of a slide across the road. From a safe distance, photograph it and report: passable, one lane, or closed. Do not cross debris.",
        P["town_mtn"], 0.45, 48, {"vehicle": True, "high_clearance": True}, "Uncertain hazard; no units free. Verification only.", "Town Mountain Rd, Asheville")),
    "oxygen user": ("transport_need", "Montreat Rd, Black Mountain", None, task(
        "TRANSPORT", "Ride to the Black Mountain Library shelter for an oxygen user", "Aunt on Montreat Rd uses an oxygen concentrator; power is out and backup tanks last until about tonight. Drive her to the shelter at the Black Mountain Library, which has generator power.",
        (-82.3172, 35.6262), 0.82, 84, {"vehicle": True, "min_seats": 1}, "Oxygen-dependent; backup supply runs out tonight.", "Montreat Rd, Black Mountain")),
    "elderly parents need drinking water": ("water_need", "1144 Bee Tree Rd, Swannanoa", None, task(
        "DELIVER_SUPPLIES", "Deliver drinking water to an elderly couple, Bee Tree Rd", "Couple in their 80s at 1144 Bee Tree Rd; the well pump has been out since Friday. Husband uses a walker; they can't drive out. Carry the water inside.",
        P["bee_tree"], 0.86, 91, {"vehicle": True, "high_clearance": True, "min_capacity_gal": 10, "supplies": ["10 gal drinking water (several days)"]},
        "Three independent sources (daughter's SMS, neighbor's post, church outreach list) about the same household. Both over 80, limited mobility, no water.", "1144 Bee Tree Rd, Swannanoa")),
}
ATTACH = {"neighbor posts about the same couple": "elderly parents need drinking water",
          "church outreach list flags the same household": "elderly parents need drinking water"}
CATEGORY = {"water_rescue": "HAZARD", "landslide": "HAZARD"}

incidents, tasks, observations, by_key = [], [], [], {}
for e in SC["events"]:
    label, body = e.get("label", ""), e.get("body", {})
    key = next((k for k in SPEC if k in label), None)
    parent = next((v for k, v in ATTACH.items() if k in label), None)
    if key is None and parent is None:
        continue
    at = ts(e["at"]).strftime("%Y-%m-%dT%H:%M:%SZ")
    if parent:
        inc = by_key[parent]
    else:
        itype, loc_text, point, t = SPEC[key]
        lonlat = point or (t["lon"], t["lat"])
        inc = {"id": len(incidents) + 1, "status": "OPEN", "type": itype, "summary": label.split(": ", 1)[-1], "priority": t["priority"] if t else 20,
               "confidence": 0.8, "lon": lonlat[0], "lat": lonlat[1], "n_obs": 0, "sources": [], "location_text": loc_text}
        incidents.append(inc)
        by_key[key] = inc
        if t:
            tasks.append({"id": len(tasks) + 1, "incident_id": inc["id"], "status": "OPEN", "created_at": at, "updated_at": at, **t})
    src = body.get("source_type", e["kind"])
    inc["n_obs"] += 1
    if src not in inc["sources"]:
        inc["sources"].append(src)
    lon, lat = body.get("lon", inc["lon"]), body.get("lat", inc["lat"])
    observations.append({
        "id": len(observations) + 1, "observed_at": at, "source_type": src,
        "category": CATEGORY.get(inc["type"], "NEED"), "subtype": inc["type"], "confidence": body.get("confidence", 0.85),
        "incident_id": inc["id"], "summary": inc["summary"] if not parent else f"Corroborates: {inc['summary']}",
        "text": body.get("text") or body.get("transcript"), "raw": body.get("transcript"),
        "reporter": body.get("reporter") or body.get("agency"), "channel": body.get("channel"),
        "location_text": inc["location_text"], "point": {"type": "Point", "coordinates": [lon, lat]},
    })

# NCDOT closures enter the feed too (real records).
for at, p, mid in sorted(closure_obs, key=lambda x: x[0], reverse=True)[:6]:
    observations.append({"id": len(observations) + 1, "observed_at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "source_type": "ncdot",
                         "category": "INFRASTRUCTURE", "subtype": "road_closed", "confidence": 1, "incident_id": None,
                         "summary": f"{p['road_name']} closed. {p['description']}", "text": None, "raw": None,
                         "reporter": "NCDOT TIMS", "channel": None, "location_text": p.get("location"),
                         "point": {"type": "Point", "coordinates": mid}})
for g in sensors:
    observations.append({"id": len(observations) + 1, "observed_at": g["at"], "source_type": "usgs", "category": "STATUS",
                         "subtype": "gauge_reading", "confidence": 1, "incident_id": None,
                         "summary": f"{g['name']}: {g['stage_ft']:.1f} ft (flood stage {g['flood_stage_ft']} ft).",
                         "text": None, "raw": None, "reporter": f"USGS {g['site_id']}", "channel": None, "location_text": None,
                         "point": {"type": "Point", "coordinates": [g["lon"], g["lat"]]}})

# ---- Jordan's offer: the hero task, as the dashboard's "Find the best volunteer" would produce it ----
hero = next(t for t in tasks if "Bee Tree" in t["title"])
route, eta, dist, steps = osrm(JORDAN, (hero["lon"], hero["lat"]))
assignments = [{
    "id": 1, "task_id": hero["id"], "volunteer_id": 1, "status": "OFFERED", "eta_s": eta, "distance_m": dist,
    "reason": f"Jordan Reyes is the fastest capable volunteer by road ({eta / 60:.0f} min, {dist / 1000:.1f} km by road)",
    "route": route, "steps": steps, "created_at": NOW, "updated_at": NOW,
}]

# ---- Places the reports name: shown as resources on the map ----
resources = [
    {"id": 1, "kind": "shelter", "name": "AB Tech shelter", "detail": "340 Victoria Rd · out of infant formula and diapers", "status": "limited", "lon": P["ab_tech"][0], "lat": P["ab_tech"][1]},
    {"id": 2, "kind": "shelter", "name": "Black Mountain Library shelter", "detail": "Generator power", "status": "open", "lon": P["bm_library"][0], "lat": P["bm_library"][1]},
    {"id": 3, "kind": "water", "name": "MANNA distribution table", "detail": "Fairview Elementary School", "status": "open", "lon": P["fairview_es"][0], "lat": P["fairview_es"][1]},
]

fixture = {
    "clock": {"sim_now": NOW, "speed": 1, "simulated": True},
    "demo": {"phase": "ready", "message": f"{len(incidents)} incidents, {len(tasks)} volunteer tasks awaiting dispatch"},
    "incidents": incidents, "tasks": tasks, "assignments": assignments, "volunteers": volunteers,
    "observations": sorted(observations, key=lambda o: o["observed_at"], reverse=True),
    "closures": closures, "sensors": sensors, "activity": [], "resources": resources,
}
out = ROOT / "src" / "data" / "fixture.json"
out.write_text(json.dumps(fixture, separators=(",", ":")))
print(f"wrote {out.name}: {len(incidents)} incidents · {len(tasks)} tasks · {len(volunteers)} volunteers · "
      f"{len(observations)} posts · {len(closures)} closures · {len(sensors)} gauges · route {dist} m / {eta} s")
