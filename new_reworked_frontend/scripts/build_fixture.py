"""Builds src/data/fixture.json: the offline demo snapshot used when the backend is not running.

REAL: NCDOT TIMS closures active at the snapshot time, USGS gauge stages at that time,
      driving routes from the public OSRM server (OpenStreetMap).
DEMO-STUB: tasks, feed posts, volunteers and resource points, written to match replay/scenario.yaml.

Run from new_reworked_frontend/:  python3 scripts/build_fixture.py
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT.parent / "backend" / "data"
NOW = "2024-09-29T14:12:00Z"  # 10:12 AM EDT, the coordination phase of the replay
BBOX = (-82.75, 35.45, -82.25, 35.75)


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


# ---- Real: NCDOT closures active at NOW ----
closures = []
for f in json.load(open(DATA / "ncdot_closures.geojson"))["features"]:
    p, g = f["properties"], f["geometry"]
    if g["type"] != "LineString" or p["county"] != "Buncombe":
        continue
    if not (p["closed_at"] <= NOW < (p["reopened_at"] or "9999")):
        continue
    if not any(inside(c) for c in g["coordinates"]):
        continue
    closures.append({"id": len(closures) + 1, "name": p["road_name"], "closed_reason": p["description"],
                     "closed_since": p["closed_at"], "source": "NCDOT TIMS",
                     "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in g["coordinates"]]}})

# ---- Real: latest USGS reading per gauge at NOW ----
sites = {s["site_id"]: s for s in json.load(open(DATA / "usgs_sites.json"))}
latest = {}
for r in json.load(open(DATA / "usgs_readings.json")):
    if r["stage_ft"] is None:
        continue
    from datetime import datetime
    at = datetime.fromisoformat(r["at"]).astimezone().isoformat()
    if datetime.fromisoformat(r["at"]) <= datetime.fromisoformat(NOW.replace("Z", "+00:00")):
        latest[r["site_id"]] = {**r, "at": at}
sensors = [{"site_id": k, "name": sites[k]["site_name"].title().replace(", Nc", ", NC"), "flood_stage_ft": sites[k]["flood_stage_ft"],
            "lon": sites[k]["lon"], "lat": sites[k]["lat"], "stage_ft": v["stage_ft"], "discharge_cfs": v["discharge_cfs"],
            "at": v["at"], "peak_stage_ft": sites[k]["peak_stage_ft"]} for k, v in latest.items()]

# ---- Places ----
BEE_TREE = (-82.41275, 35.63187)
AB_TECH = (-82.55186, 35.56837)
PATTON_COVE = (-82.4027, 35.59407)
JORDAN = (-82.500, 35.605)
MARIA = (-82.405, 35.602)

route_jordan, eta_jordan, dist_jordan, steps_jordan = osrm(JORDAN, BEE_TREE)
route_maria, eta_maria, dist_maria, _ = osrm(MARIA, PATTON_COVE)
# Swannanoa River corridor follows US-70 from Black Mountain to Biltmore; drawn as the flooded band.
corridor, *_ = osrm((-82.3215, 35.6175), (-82.5440, 35.5690))

volunteers = [
    {"id": 1, "name": "Jordan Reyes", "lon": JORDAN[0], "lat": JORDAN[1], "available": True, "verify_safe": False,
     "vehicle": {"type": "pickup", "capacity_gal": 80, "seats": 2, "high_clearance": True},
     "skills": ["heavy_lifting", "spanish"], "equipment": ["water_jugs", "cooler"]},
    {"id": 2, "name": "Maria Lopez", "lon": MARIA[0], "lat": MARIA[1], "available": True, "verify_safe": False,
     "vehicle": None, "skills": ["first_aid", "spanish"], "equipment": []},
    {"id": 3, "name": "Sam Whitaker", "lon": -82.398, "lat": 35.598, "available": True, "verify_safe": False,
     "vehicle": None, "skills": ["chainsaw"], "equipment": ["chainsaw"]},
    {"id": 4, "name": "Priya Nair", "lon": -82.585, "lat": 35.575, "available": True, "verify_safe": False,
     "vehicle": {"type": "suv", "capacity_gal": 30, "seats": 5, "high_clearance": True}, "skills": ["first_aid"], "equipment": []},
    {"id": 5, "name": "Ben Carter", "lon": -82.555, "lat": 35.620, "available": False, "verify_safe": False,
     "vehicle": {"type": "sedan", "capacity_gal": 10, "seats": 4, "high_clearance": False}, "skills": [], "equipment": []},
    {"id": 6, "name": "Alex Kim", "lon": -82.530, "lat": 35.612, "available": True, "verify_safe": True,
     "vehicle": {"type": "suv", "capacity_gal": 20, "seats": 5, "high_clearance": True}, "skills": ["first_aid", "cpr"], "equipment": []},
    {"id": 7, "name": "Tasha Green", "lon": -82.640, "lat": 35.555, "available": True, "verify_safe": False,
     "vehicle": {"type": "minivan", "capacity_gal": 40, "seats": 7, "high_clearance": False}, "skills": [], "equipment": []},
    {"id": 8, "name": "Luis Ortega", "lon": -82.470, "lat": 35.540, "available": True, "verify_safe": False,
     "vehicle": {"type": "pickup", "capacity_gal": 60, "seats": 3, "high_clearance": True}, "skills": ["chainsaw"], "equipment": ["chainsaw", "generator"]},
    {"id": 9, "name": "Hannah Moore", "lon": -82.560, "lat": 35.640, "available": True, "verify_safe": False,
     "vehicle": None, "skills": ["medical", "cpr"], "equipment": []},
    {"id": 10, "name": "Devon Price", "lon": -82.320, "lat": 35.617, "available": True, "verify_safe": False,
     "vehicle": {"type": "sedan", "capacity_gal": 8, "seats": 4, "high_clearance": False}, "skills": [], "equipment": []},
]


def task(id, type, status, title, description, lon, lat, urgency, priority, req, reasoning, incident_id, created):
    base = {"vehicle": False, "high_clearance": False, "min_capacity_gal": 0, "min_seats": 0,
            "skills": [], "equipment": [], "supplies": []}
    return {"id": id, "incident_id": incident_id, "type": type, "status": status, "title": title,
            "description": description, "requirements": {**base, **req}, "urgency": urgency, "priority": priority,
            "proposal_reasoning": reasoning, "lon": lon, "lat": lat, "created_at": created, "updated_at": created}


ADDRESS = {1: '1144 Bee Tree Rd, Swannanoa', 2: '340 Victoria Rd, Asheville', 3: 'Town Mountain Rd past the overlook', 4: '105 Patton Cove Rd, Swannanoa', 5: 'Grovemont Ave, Swannanoa', 6: 'Old US 70, near Black Mountain', 7: 'Riceville Rd above the fire station', 8: 'Charlotte Hwy, Fairview', 9: 'Bull Creek Rd low-water crossing', 10: 'Swannanoa Library, Grovemont Ave'}

tasks = [
    task(1, "DELIVER_SUPPLIES", "ASSIGNED", "Drinking water for two residents in their 80s",
         "Deliver at least 10 gallons of drinking water to 1144 Bee Tree Rd. Well pump has been out since Friday. "
         "The husband uses a walker; carry the water inside to the kitchen. Ask if they need medication refills and report it.",
         *BEE_TREE, 0.86, 0.91,
         {"vehicle": True, "high_clearance": True, "min_capacity_gal": 10, "skills": ["heavy_lifting"],
          "supplies": ["10 gal drinking water", "2 cases bottled water if available"]},
         "Direct request from family (SMS) corroborated by a neighbor 3 min later. Both residents are over 80, one has limited mobility, "
         "and they have no vehicle. Census tract 65+ share 31%.", 1, "2024-09-29T14:01:10Z"),
    task(2, "DELIVER_SUPPLIES", "OPEN", "Infant formula and size 3–4 diapers for AB Tech shelter",
         "The AB Tech shelter (340 Victoria Rd) has 3 infants and is out of formula and size 3 and 4 diapers. Check in at the front desk.",
         *AB_TECH, 0.55, 0.62, {"vehicle": True, "supplies": ["infant formula (2–3 cans)", "diapers size 3", "diapers size 4"]},
         "Shelter coordinator request by hotline. Needed tonight, not an emergency.", 2, "2024-09-28T19:16:00Z"),
    task(3, "VERIFY_CONDITION", "OPEN", "Check reported slide on Town Mountain Rd",
         "Unconfirmed report of a slide across Town Mountain Rd past the overlook. Do not cross debris. "
         "From a safe distance, photograph the road and report whether one lane is passable.",
         -82.5205, 35.6178, 0.48, 0.52, {"vehicle": True, "high_clearance": True},
         "Second-hand caller via BCSO radio; no units free. Hazard is uncertain so only verification is proposed.", 3, "2024-09-29T12:31:00Z"),
    task(4, "WELLNESS_CHECK", "EN_ROUTE", "Wellness check at 105 Patton Cove Rd",
         "Neighbor has not seen the resident since Thursday. Knock and speak with them; if no answer, report to dispatch, do not force entry.",
         *PATTON_COVE, 0.7, 0.74, {"skills": ["first_aid"]},
         "Neighbor report; resident lives alone. Tract has 18% households without a vehicle.", 4, "2024-09-29T13:20:00Z"),
    task(5, "TRANSPORT", "OPEN", "Ride to dialysis for one resident in Swannanoa",
         "Resident at Grovemont Ave needs a ride to dialysis at Mission Hospital by 1:00 PM. Walks with a cane; can sit in a regular seat.",
         -82.3826, 35.5985, 0.78, 0.8, {"vehicle": True, "min_seats": 1},
         "Resident called the hotline. Missed dialysis is a health risk within 24 h.", 5, "2024-09-29T13:40:00Z"),
    task(6, "DELIVER_SUPPLIES", "OPEN", "Generator fuel for oxygen concentrator",
         "Household on Old US 70 runs an oxygen concentrator on a generator with under a day of fuel. Bring 5 gal of gasoline in an approved can.",
         -82.3505, 35.6130, 0.82, 0.84, {"vehicle": True, "supplies": ["5 gal gasoline (approved can)"]},
         "Caregiver report via app; oxygen dependence raises vulnerability.", 6, "2024-09-29T13:55:00Z"),
    task(7, "WELLNESS_CHECK", "OPEN", "Wellness check, Riceville Rd",
         "Family out of state cannot reach their mother since Friday. Phone lines are down in the area.",
         -82.4560, 35.6210, 0.6, 0.66, {}, "Family request via web form.", 7, "2024-09-29T12:58:00Z"),
    task(8, "DELIVER_SUPPLIES", "OPEN", "Water and ice for Fairview community church",
         "Church on Charlotte Hwy is feeding 60 people a day and is out of ice. Bring ice and drinking water.",
         -82.4060, 35.5260, 0.45, 0.5, {"vehicle": True, "min_capacity_gal": 20, "equipment": ["cooler"], "supplies": ["ice (40 lb)", "10 gal water"]},
         "Pastor report via app.", 8, "2024-09-29T11:10:00Z"),
    task(9, "VERIFY_CONDITION", "OPEN", "Is Bull Creek Rd passable?",
         "Residents report the low-water crossing on Bull Creek Rd may be washed out. Report from a safe distance.",
         -82.4740, 35.6480, 0.4, 0.44, {"vehicle": True}, "Two resident reports with conflicting status.", 9, "2024-09-29T10:44:00Z"),
    task(10, "DELIVER_SUPPLIES", "COMPLETED", "Bottled water to Swannanoa Library pickup point",
         "Dropped 4 cases at the side entrance.", -82.3990, 35.6000, 0.5, 0.5, {"vehicle": True}, "Shelter request.", 10, "2024-09-28T21:00:00Z"),
]

assignments = [
    {"id": 1, "task_id": 1, "volunteer_id": 1, "status": "OFFERED", "eta_s": eta_jordan, "distance_m": dist_jordan,
     "reason": "Rerouted around Riverwood Rd at the Swannanoa River bridge (washed out, Swannanoa FD radio 10:06 AM). Adds about 4 min.",
     "route": route_jordan, "steps": steps_jordan, "created_at": "2024-09-29T14:09:30Z", "updated_at": "2024-09-29T14:09:30Z"},
    {"id": 2, "task_id": 4, "volunteer_id": 2, "status": "ACCEPTED", "eta_s": eta_maria, "distance_m": dist_maria,
     "reason": "Nearest volunteer with first aid.", "route": route_maria, "steps": [],
     "created_at": "2024-09-29T13:22:00Z", "updated_at": "2024-09-29T13:24:00Z"},
    {"id": 3, "task_id": 10, "volunteer_id": 1, "status": "DONE", "eta_s": 900, "distance_m": 9000, "reason": "", "route": None,
     "steps": [], "created_at": "2024-09-28T21:05:00Z", "updated_at": "2024-09-28T22:10:00Z"},
]


def obs(id, at, source_type, reporter, category, subtype, summary, lon, lat, incident_id=None, raw=None, photo=None, confidence=0.8):
    return {"id": id, "observed_at": at, "source_type": source_type, "reporter": reporter, "category": category,
            "subtype": subtype, "confidence": confidence, "incident_id": incident_id, "summary": summary,
            "raw": raw, "photo": photo, "point": {"type": "Point", "coordinates": [lon, lat]}}


observations = [
    obs(1, "2024-09-29T14:06:10Z", "radio", "Swannanoa FD · BC Fire Dispatch", "road", "bridge_out",
        "Riverwood Rd at the Swannanoa River bridge is impassable; north approach washed out.", -82.4075, 35.6030,
        raw="Engine 2 to Buncombe, be advised Riverwood Rd at the Swannanoa River bridge is impassable, approach is washed out on the north side, request PW."),
    obs(2, "2024-09-29T14:03:00Z", "resident", "Neighbor on Bee Tree Rd", "need", "water",
        "Older couple at 1144 Bee Tree still have no water; neighbor shared some but is running low.", *BEE_TREE, incident_id=1,
        raw="The older couple at the end of our road on Bee Tree (1144) still have no water, I gave them what I could but we're running low too."),
    obs(3, "2024-09-29T14:00:00Z", "resident", "Dana R. (daughter, by SMS)", "need", "water",
        "Parents in their 80s at 1144 Bee Tree Rd have no water since Friday; father uses a walker, cannot drive out.", *BEE_TREE, incident_id=1,
        raw="my parents are at 1144 Bee Tree Rd in Swannanoa, both in their 80s. no power since friday so the well pump is out = no water. they're down to like 2 bottles of drinking water. dad uses a walker and they cant drive out."),
    obs(4, "2024-09-29T13:52:00Z", "volunteer", "Sam Whitaker", "road", "tree_down",
        "Cleared one lane on Grovemont Ave at Whitson. Second oak still blocking the shoulder; passable for cars, slow.", -82.3858, 35.5977),
    obs(5, "2024-09-29T13:30:00Z", "shelter", "Owen Middle School shelter", "resource", "supplies_available",
        "Shelter has surplus bottled water (about 30 cases) and baby wipes. Volunteers can pick up at the gym door until 6 PM.", -82.3268, 35.6020),
    obs(6, "2024-09-29T13:12:00Z", "usgs", "USGS 03451500", "water", "gauge",
        "French Broad at Asheville falling after record crest. Still well above normal.", -82.5793, 35.6092),
    obs(7, "2024-09-29T12:58:00Z", "resident", "Kayla M.", "condition", "power",
        "Whole stretch of Riceville Rd above the fire station has no power or cell service. Duke trucks not here yet.", -82.4560, 35.6210, incident_id=7),
    obs(8, "2024-09-29T12:30:00Z", "radio", "BCSO · Ops 1", "road", "slide",
        "Possible slide across Town Mountain Rd past the overlook; passability unknown; caller is second-hand.", -82.5205, 35.6178, incident_id=3, confidence=0.55,
        raw="Unit 214, caller advising possible slide across Town Mtn Rd up past the overlook, unknown if passable, caller is second hand, no units free to check."),
    obs(9, "2024-09-29T11:45:00Z", "ngo", "Manna FoodBank", "resource", "distribution",
        "Water and shelf-stable food distribution at the Swannanoa Fire Dept, 10 AM to 4 PM today. Bring your own bags.", -82.3995, 35.5998),
    obs(10, "2024-09-29T11:10:00Z", "resident", "Pastor R. Hill", "need", "ice",
        "Fairview church kitchen is feeding about 60 a day and is out of ice. Water is OK until tomorrow.", -82.4060, 35.5260, incident_id=8),
    obs(11, "2024-09-29T10:40:00Z", "ncdot", "NCDOT TIMS", "road", "closure",
        "US-70 closed between Swannanoa and Black Mountain. Use I-40.", -82.3480, 35.6100),
    obs(12, "2024-09-28T22:10:00Z", "volunteer", "Jordan Reyes", "resource", "delivery",
        "Dropped 4 cases of water at the Swannanoa Library side entrance. Staff said they can take more tomorrow.", -82.3990, 35.6000),
]

resources = [
    {"id": 1, "kind": "shelter", "name": "AB Tech shelter", "detail": "340 Victoria Rd · beds, meals, charging", "status": "open", "lon": AB_TECH[0], "lat": AB_TECH[1]},
    {"id": 2, "kind": "shelter", "name": "Owen Middle School shelter", "detail": "Beds and water. Surplus bottled water", "status": "open", "lon": -82.3268, "lat": 35.6020},
    {"id": 3, "kind": "water", "name": "Water and food distribution", "detail": "Swannanoa Fire Dept · 10 AM–4 PM", "status": "open", "lon": -82.3995, "lat": 35.5998},
    {"id": 4, "kind": "fuel", "name": "Fuel available", "detail": "Ingles, Tunnel Rd · 1-hour wait reported", "status": "limited", "lon": -82.5180, "lat": 35.5880},
    {"id": 5, "kind": "medical", "name": "Mission Hospital", "detail": "Emergency department open, on generator", "status": "open", "lon": -82.5490, "lat": 35.5770},
]

for t in tasks:
    t["address"] = ADDRESS[t["id"]]

incidents = [{"id": t["incident_id"], "status": "RESOLVED" if t["status"] == "COMPLETED" else "ACTIVE", "type": t["type"].lower(),
              "summary": t["title"], "priority": t["priority"], "confidence": 0.8, "lon": t["lon"], "lat": t["lat"], "n_obs": 1}
             for t in tasks]

fixture = {
    "clock": {"sim_now": NOW, "speed": 1, "simulated": True},
    "incidents": incidents, "tasks": tasks, "assignments": assignments, "volunteers": volunteers,
    "observations": observations, "closures": closures, "sensors": sensors, "activity": [],
    "resources": resources,
    "flood_corridor": {"type": "Feature", "properties": {"name": "Swannanoa River corridor", "source": "Reported flooding, Sep 27"}, "geometry": corridor},
}
out = ROOT / "src" / "data" / "fixture.json"
out.write_text(json.dumps(fixture, separators=(",", ":")))
print(f"wrote {out} · {len(closures)} closures · {len(sensors)} gauges · route {dist_jordan} m / {eta_jordan} s · {out.stat().st_size // 1024} KB")
