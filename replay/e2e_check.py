"""DEMO-STUB test driver: plays the presenter's role against a running replay (--no-pause).

Accepts the demo volunteer's offer, waits for arrival, submits a bad photo (expect REJECTED)
then a good photo (expect VERIFIED). Prints the decision feed as it happens.

Usage: backend/.venv/bin/python replay/e2e_check.py [volunteer_name]
"""
import math
import sys
import time
from pathlib import Path

import httpx

API = "http://localhost:8000"
PHOTOS = Path(__file__).parent / "photos"
NAME = sys.argv[1] if len(sys.argv) > 1 else "Jordan Reyes"


def dist_m(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def main():
    c = httpx.Client(timeout=120)
    seen, phase, aid, t0 = set(), "wait_offer", None, time.time()
    while time.time() - t0 < 600:
        s = c.get(f"{API}/state").json()
        for a in reversed(s["activity"]):
            k = (a["at"], a["message"][:80])
            if k not in seen and a["kind"] != "road" or ("Riverwood" in a["message"] and k not in seen):
                seen.add(k)
                if a["kind"] not in ("adaptation",) or "cuts" in a["message"] or "Re-planning" in a["message"]:
                    print(f"[{a['at'][5:16]}] {a['kind']}: {a['message'][:300]}")
        vol = next((v for v in s["volunteers"] if v["name"] == NAME), None)
        if vol is None:
            time.sleep(1)
            continue
        mine = [a for a in s["assignments"] if a["volunteer_id"] == vol["id"] and a["status"] in ("OFFERED", "ACCEPTED")]
        if phase == "wait_offer" and mine and mine[0]["status"] == "OFFERED":
            aid = mine[0]["id"]
            c.post(f"{API}/assignments/{aid}/accept")
            print(f">>> {NAME} ACCEPTED assignment {aid}")
            phase = "driving"
        elif phase == "driving" and mine:
            task = next(t for t in s["tasks"] if t["id"] == mine[0]["task_id"])
            d = dist_m((vol["lon"], vol["lat"]), (task["lon"], task["lat"]))
            end = mine[0]["route"]["coordinates"][-1]
            if dist_m((vol["lon"], vol["lat"]), tuple(end)) < 30:
                print(f">>> arrived ({d:.0f} m from task point). Submitting BAD photo…")
                aid = mine[0]["id"]
                r = c.post(f"{API}/assignments/{aid}/complete",
                           files={"photo": ("bad.jpg", (PHOTOS / "delivery_bad.jpg").read_bytes(), "image/jpeg")},
                           data={"note": "done", "lon": vol["lon"], "lat": vol["lat"]}).json()
                print("    →", r["verdict"], "|", r["reasoning"][:250])
                print(">>> Submitting GOOD photo…")
                r = c.post(f"{API}/assignments/{aid}/complete",
                           files={"photo": ("porch.jpg", (PHOTOS / "delivery_ok.jpg").read_bytes(), "image/jpeg")},
                           data={"note": "Dropped off 4 gallons + 2 cases of water, talked with Mr. and Mrs. on the porch, they're OK.",
                                 "lon": vol["lon"], "lat": vol["lat"]}).json()
                print("    →", r["verdict"], "|", r["reasoning"][:250])
                phase = "done"
        elif phase == "done":
            time.sleep(3)
            s = c.get(f"{API}/state").json()
            for a in reversed(s["activity"][:6]):
                print(f"[{a['at'][5:16]}] {a['kind']}: {a['message'][:200]}")
            print("tasks:", [(t["id"], t["type"], t["status"]) for t in s["tasks"]])
            print("incidents:", [(i["id"], i["type"], i["status"]) for i in s["incidents"]])
            return
        time.sleep(1)
    print("TIMEOUT in phase", phase)


if __name__ == "__main__":
    main()
