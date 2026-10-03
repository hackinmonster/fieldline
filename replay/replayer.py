"""DEMO-STUB: load the Helene scenario from the terminal (same as the dashboard's "Load scenario").

Playback now lives in the backend (backend/app/demo/runner.py) so the whole demo runs from the
dashboard. This script just triggers it and prints progress.

Usage:  backend/.venv/bin/python replay/replayer.py
"""
import time

import httpx

API = "http://localhost:8000"


def main():
    c = httpx.Client(timeout=30)
    c.post(f"{API}/demo/setup").raise_for_status()
    last = None
    while True:
        s = c.get(f"{API}/demo/status").json()
        line = f"[{s['done']}/{s['total']}] {s['phase']}: {s['message']}"
        if line != last:
            print(line)
            last = line
        if s["phase"] in ("ready", "error"):
            return
        time.sleep(1)


if __name__ == "__main__":
    main()
