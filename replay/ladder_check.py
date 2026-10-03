"""Generality check for the adaptation ladder with inputs NOT in the demo scenario.

Case A (REASSIGN): volunteer A accepts a task, then a closure traps A up a dead-end valley
                   (upper Bee Tree Rd); B can still reach the task → expect reassign to B.
Case B (ESCALATE): a closure cuts the only road to a task → nobody can reach it → expect BLOCKED.
Then a reopening → expect the blocked task to be retried and matched.

Usage: backend/.venv/bin/python replay/ladder_check.py   (resets the database!)
"""
import time

import httpx

API = "http://localhost:8000"
c = httpx.Client(timeout=120)


def wait_queue():
    for _ in range(120):
        if c.get(f"{API}/health").json()["queue"] == 0:
            time.sleep(1.5)
            if c.get(f"{API}/health").json()["queue"] == 0:
                return
        time.sleep(1)


def feed(n=12):
    for a in reversed(c.get(f"{API}/state").json()["activity"][:n]):
        if a["kind"] not in ("road",):
            print(f"   {a['kind']}: {a['message'][:230]}")


def vol(name, lon, lat, **kw):
    body = {"name": name, "lon": lon, "lat": lat,
            "vehicle": {"type": "pickup", "capacity_gal": 60, "seats": 2, "high_clearance": True}, **kw}
    return c.post(f"{API}/volunteers", json=body).json()["id"]


c.post(f"{API}/sim/reset")
c.post(f"{API}/sim/clock", json={"at": "2024-09-30T15:00:00Z", "speed": 1})

print("== Case A: REASSIGN ==")
a = vol("Avery (upper Bee Tree)", -82.4127, 35.6320)   # far up Bee Tree Rd (single access)
b = vol("Blake (West Asheville)", -82.6000, 35.5750)
c.post(f"{API}/ingest/report", json={"source_type": "resident", "channel": "sms",
       "text": "My grandmother at 105 Patton Cove Rd in Swannanoa is diabetic and almost out of insulin-safe drinking water and food, she lives alone with no car. Please send someone with groceries and a case of water."})
wait_queue()
asg = [x for x in c.get(f"{API}/state").json()["assignments"] if x["status"] == "OFFERED"]
print("   offered to volunteer", asg[0]["volunteer_id"] if asg else None, "(A is", a, ")")
if asg:
    c.post(f"{API}/assignments/{asg[0]['id']}/accept")
c.post(f"{API}/ingest/radio", json={"agency": "BCSO", "channel": "Ops 2", "confidence": 0.9,
       "transcript": "214 to county, Bee Tree Rd is gone at Sunset Dr, total washout, nobody in or out above that point."})
wait_queue()
feed(10)

print("\n== Case B: ESCALATE then recover ==")
c.post(f"{API}/volunteers/{a}/availability", json={"available": False})  # Avery goes off duty (trapped)
vol("Casey (Oteen)", -82.4850, 35.5950)                                     # free volunteer below the washout
c.post(f"{API}/ingest/report", json={"source_type": "resident", "channel": "hotline",
       "text": "This is Ray at 1144 Bee Tree Rd Swannanoa, my wife needs her prescription picked up and we're out of water, we can't get out."})
wait_queue()
feed(8)
print("\n   -- reopening --")
c.post(f"{API}/ingest/radio", json={"agency": "Buncombe PW", "channel": "PW 1", "confidence": 0.95,
       "transcript": "PW to county, Bee Tree Rd at Sunset Dr temp crossing installed, road is open to traffic, all units advised."})
wait_queue()
feed(8)
s = c.get(f"{API}/state").json()
print("\ntasks:", [(t["id"], t["type"], t["status"]) for t in s["tasks"]])
print("assignments:", [(x["id"], x["task_id"], x["volunteer_id"], x["status"]) for x in s["assignments"]])
