"""NHC best track for Hurricane Helene (AL092024) -> GeoJSON (one LineString + one Point per fix).

Source: https://www.nhc.noaa.gov/gis/best_track/al092024_best_track.zip (NHC GIS archive, shapefiles).
Coordinates are on NHC's authalic sphere; treated as EPSG:4326 (sub-km difference, standard practice).

Usage: backend/.venv/bin/python backend/scripts/load_nhc.py
Output: backend/data/helene_track.geojson
"""
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import requests

URL = "https://www.nhc.noaa.gov/gis/best_track/al092024_best_track.zip"
OUT = Path(__file__).resolve().parents[1] / "data" / "helene_track.geojson"
TYPES = {"DB": "disturbance", "TD": "tropical depression", "TS": "tropical storm", "HU": "hurricane",
         "EX": "extratropical", "LO": "low", "SD": "subtropical depression", "SS": "subtropical storm",
         "WV": "tropical wave"}


def category(stype, wind_kt, ss):
    if stype == "HU":
        return f"Cat {int(ss)}" if ss else ("Cat 5" if wind_kt >= 137 else "Cat 4" if wind_kt >= 113 else
                                           "Cat 3" if wind_kt >= 96 else "Cat 2" if wind_kt >= 83 else "Cat 1")
    return {"TS": "TS", "TD": "TD"}.get(stype, stype)


def main():
    r = requests.get(URL, timeout=60)
    r.raise_for_status()
    pts = gpd.read_file(io.BytesIO(r.content), layer="AL092024_pts")
    pts["dtg"] = pts["DTG"].astype("int64").astype(str)
    pts = pts.sort_values("dtg")
    feats, coords = [], []
    for _, p in pts.iterrows():
        at = datetime.strptime(p["dtg"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        lon, lat = float(p["LON"]), float(p["LAT"])
        coords.append([lon, lat])
        wind = int(p["INTENSITY"])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {
            "kind": "fix", "storm": "HELENE", "storm_id": "AL092024",
            "datetime": at.isoformat().replace("+00:00", "Z"),
            "wind_kt": wind, "pressure_mb": int(p["MSLP"]) if p["MSLP"] == p["MSLP"] else None,
            "storm_type": p["STORMTYPE"], "storm_type_desc": TYPES.get(p["STORMTYPE"], p["STORMTYPE"]),
            "category": category(p["STORMTYPE"], wind, p["SS"]), "saffir_simpson": int(p["SS"]),
            "source_url": URL}})
    line = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {
        "kind": "track", "storm": "HELENE", "storm_id": "AL092024",
        "start": feats[0]["properties"]["datetime"], "end": feats[-1]["properties"]["datetime"],
        "max_wind_kt": max(f["properties"]["wind_kt"] for f in feats), "source_url": URL}}
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": [line] + feats}))
    print(f"wrote track + {len(feats)} fixes {line['properties']['start']} -> {line['properties']['end']} -> {OUT}")


if __name__ == "__main__":
    main()
