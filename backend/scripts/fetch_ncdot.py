"""Fetch real NCDOT TIMS Hurricane Helene road incidents (closures) from NCDOT's ArcGIS Online org.

Source: the layers behind the NCDOT dashboard/web map "NCDOT Road Reopening for Hurricane Helene 2024"
(web map item 66d0698a5ba846e5989d282301f4405d, owner ResponseRecovery.NCDOT.GOV):
  .../State_Maintained_Historical_TIMS_Incidents_Hurricane_Helene/FeatureServer/{0 points, 1 lines}
  .../State_Maintained_Active_TIMS_Incidents_Hurricane_Helene/FeatureServer/{0 points, 1 lines}

Field semantics (TIMS):
  StartDateUTC     -> closed_at   (incident start)
  ClosedByDateUTC  -> reopened_at (when the TIMS incident was closed/cleared, i.e. road reopened)
  EndDateUTC       -> est_end_at  (NCDOT's *estimated* end at the time, not the actual reopen)

Usage: backend/.venv/bin/python backend/scripts/fetch_ncdot.py [--all-counties]
Output: backend/data/ncdot_closures.geojson (EPSG:4326)
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ORG = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services"
SERVICES = {
    "historical": f"{ORG}/State_Maintained_Historical_TIMS_Incidents_Hurricane_Helene/FeatureServer",
    "active": f"{ORG}/State_Maintained_Active_TIMS_Incidents_Hurricane_Helene/FeatureServer",
}
# Buncombe + adjacent counties
COUNTIES = ["Buncombe", "Haywood", "Henderson", "Madison", "McDowell", "Rutherford", "Yancey"]
OUT = Path(__file__).resolve().parents[1] / "data" / "ncdot_closures.geojson"


def iso(ms):
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def query_all(layer_url, where):
    feats, offset = [], 0
    while True:
        r = requests.get(f"{layer_url}/query", params={
            "where": where, "outFields": "*", "returnGeometry": "true", "outSR": 4326,
            "f": "geojson", "resultOffset": offset, "resultRecordCount": 1000,
            "orderByFields": "OBJECTID",
        }, timeout=60)
        r.raise_for_status()
        d = r.json()
        if "error" in d:
            raise RuntimeError(d["error"])
        batch = d.get("features", [])
        feats += batch
        if not batch or not (d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")):
            break
        offset += len(batch)
    return feats


def main():
    all_counties = "--all-counties" in sys.argv
    where = "1=1" if all_counties else "CountyName IN (%s)" % ",".join(f"'{c}'" for c in COUNTIES)
    by_id = {}
    # order matters: lines preferred over points, active overrides historical for same Id only if new
    for status, svc in SERVICES.items():
        for layer, kind in ((1, "line"), (0, "point")):
            url = f"{svc}/{layer}"
            try:
                feats = query_all(url, where)
            except Exception as e:  # active layer may be empty / retired
                print(f"warn: {url}: {e}")
                continue
            print(f"{status} {kind}: {len(feats)} features")
            for f in feats:
                a = f["properties"]
                tid = a.get("Id")
                if f.get("geometry") is None:
                    continue
                key = tid if tid is not None else f"{status}-{kind}-{a['OBJECTID']}"
                if key in by_id and (by_id[key]["_kind"] == "line" or kind == "point"):
                    continue
                closed_flag = (a.get("Closed") or "").lower() == "yes"
                reopened = iso(a.get("ClosedByDateUTC")) if closed_flag or status == "historical" else None
                road = (a.get("Road") or "").strip()
                common = (a.get("CommonName") or "").strip()
                by_id[key] = {
                    "type": "Feature",
                    "geometry": f["geometry"],
                    "_kind": kind,
                    "properties": {
                        "id": f"tims-{key}",
                        "tims_id": tid,
                        "road_name": f"{road} ({common})" if common and road else (road or common),
                        "road": road,
                        "common_name": common,
                        "county": a.get("CountyName"),
                        "closed_at": iso(a.get("StartDateUTC") or a.get("StartDateTime")),
                        "reopened_at": reopened,
                        "est_end_at": iso(a.get("EndDateUTC") or a.get("EndDateTime")),
                        "last_update_at": iso(a.get("LastUpdateUTC") or a.get("LastUpdateDateTime")),
                        "condition": a.get("Condition"),
                        "description": (a.get("Reason") or "").replace(" ", " ").strip(),
                        "location": a.get("Location"),
                        "severity": a.get("Severity"),
                        "is_full_closure": a.get("IsFullClosure"),
                        "geom_kind": kind,
                        "feed_status": status,
                        "provenance": "real: NCDOT TIMS via ArcGIS FeatureServer",
                        "source_url": url,
                    },
                }
    feats = []
    for v in by_id.values():
        v.pop("_kind")
        feats.append(v)
    feats.sort(key=lambda f: (f["properties"]["closed_at"] or ""))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"wrote {len(feats)} features -> {OUT}")


if __name__ == "__main__":
    main()
