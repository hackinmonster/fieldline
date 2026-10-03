"""Fetch real USGS NWIS instantaneous values (stage ft, discharge cfs) for Asheville-area gauges
during Hurricane Helene, plus NWS flood categories from the NOAA NWPS API.

Usage: backend/.venv/bin/python backend/scripts/fetch_usgs.py
Outputs: backend/data/usgs_readings.json, backend/data/usgs_sites.json
"""
import json
from collections import defaultdict
from pathlib import Path

import requests

# USGS site id -> NWS location id (NWPS)
SITES = {"03451500": "AVLN7", "03451000": "BLTN7"}
START, END = "2024-09-26", "2024-10-01"
# nwis.waterservices.usgs.gov is the historical host (waterservices.usgs.gov 301-redirects there)
NWIS = "https://nwis.waterservices.usgs.gov/nwis/iv/"
NWPS = "https://api.water.noaa.gov/nwps/v1/gauges/"
DATA = Path(__file__).resolve().parents[1] / "data"


def main():
    params = {"format": "json", "sites": ",".join(SITES), "parameterCd": "00065,00060",
              "startDT": START, "endDT": END}
    r = requests.get(NWIS, params=params, timeout=120)
    r.raise_for_status()
    source_url = r.url
    rows = defaultdict(dict)  # (site, at) -> row
    sites = {}
    for ts in r.json()["value"]["timeSeries"]:
        si = ts["sourceInfo"]
        sid = si["siteCode"][0]["value"]
        geo = si["geoLocation"]["geogLocation"]
        sites.setdefault(sid, {"site_id": sid, "site_name": si["siteName"],
                               "lat": geo["latitude"], "lon": geo["longitude"]})
        code = ts["variable"]["variableCode"][0]["value"]
        nodata = ts["variable"].get("noDataValue")
        field = {"00065": "stage_ft", "00060": "discharge_cfs"}[code]
        for v in ts["values"][0]["value"]:
            val = float(v["value"])
            row = rows[(sid, v["dateTime"])]
            row.update(site_id=sid, site_name=si["siteName"], lat=geo["latitude"],
                       lon=geo["longitude"], at=v["dateTime"])
            row[field] = None if nodata is not None and val == nodata else val
            row.setdefault("qualifiers", [])
            row["qualifiers"] = sorted(set(row["qualifiers"]) | set(v.get("qualifiers", [])))

    readings = sorted(rows.values(), key=lambda x: (x["site_id"], x["at"]))
    for row in readings:
        row.setdefault("stage_ft", None)
        row.setdefault("discharge_cfs", None)

    for sid, s in sites.items():
        lid = SITES.get(sid)
        s.update(nws_lid=lid, source_url=source_url)
        try:
            g = requests.get(NWPS + lid, timeout=30).json()
            cats = g["flood"]["categories"]
            s["flood_stages_ft"] = {k: cats[k]["stage"] for k in ("action", "minor", "moderate", "major")}
            s["flood_stage_ft"] = cats["minor"]["stage"]  # NWS "flood stage" == minor threshold
            hist = g["flood"].get("crests", {}).get("historic", [])
            if hist:
                s["record_crest"] = hist[0]
        except Exception as e:
            print(f"warn: NWPS {lid}: {e}")
        mine = [x for x in readings if x["site_id"] == sid]
        s["n_readings"] = len(mine)
        s["first_at"] = mine[0]["at"] if mine else None
        s["last_at"] = mine[-1]["at"] if mine else None
        peak = max((x for x in mine if x["stage_ft"] is not None), key=lambda x: x["stage_ft"], default=None)
        s["peak_stage_ft"] = peak and peak["stage_ft"]
        s["peak_at"] = peak and peak["at"]

    (DATA / "usgs_readings.json").write_text(json.dumps(readings))
    (DATA / "usgs_sites.json").write_text(json.dumps(list(sites.values()), indent=2))
    for s in sites.values():
        print(s["site_id"], s["site_name"], s["n_readings"], s["first_at"], s["last_at"],
              "peak", s["peak_stage_ft"], s["peak_at"], "flood", s.get("flood_stage_ft"))


if __name__ == "__main__":
    main()
