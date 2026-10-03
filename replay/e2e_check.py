"""DEMO-STUB test driver for the dashboard story (rewinds the live phase!).

Requires a loaded scenario. Rewind → dispatch the incident with the most independent sources →
accept as the chosen volunteer → wait for GPS arrival → mark complete → incident RESOLVED.

Usage: backend/.venv/bin/python replay/e2e_check.py
"""
import sys
import time

import httpx

API = "http://localhost:8000"


def main():
    c = httpx.Client(timeout=120)
    if c.get(f"{API}/demo/status").json()["phase"] != "ready":
        sys.exit("load the scenario first (dashboard or replay/replayer.py)")
    c.post(f"{API}/demo/rewind").raise_for_status()
    s = c.get(f"{API}/state").json()
    inc = max((i for i in s["incidents"] if any(t["incident_id"] == i["id"] for t in s["tasks"])),
              key=lambda i: (len(i["sources"] or []), i["priority"] or 0))
    print(f"incident #{inc['id']}: {inc['summary']}  sources={inc['sources']}")
    r = c.post(f"{API}/incidents/{inc['id']}/dispatch").json()
    print("decision:", r["decision"]["message"][:300])
    a = r["assignment"]
    assert a, "no assignment"
    c.post(f"{API}/assignments/{a['id']}/accept").raise_for_status()
    t0 = time.time()
    while time.time() - t0 < 180:
        s = c.get(f"{API}/state").json()
        if any(x["kind"] == "arrived" and x["data"].get("assignment_id") == a["id"] for x in s["activity"]):
            break
        time.sleep(1)
    else:
        sys.exit("volunteer never arrived")
    print(f"arrived after {time.time() - t0:.0f}s wall-clock")
    c.post(f"{API}/assignments/{a['id']}/complete", json={"note": "dropped off water"}).raise_for_status()
    s = c.get(f"{API}/state").json()
    status = next(i["status"] for i in s["incidents"] if i["id"] == inc["id"])
    print(f"completed; incident #{inc['id']} is {status} (expected RESOLVED)")


if __name__ == "__main__":
    main()
