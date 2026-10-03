"""Buncombe County NC census tracts (TIGER geometry) joined with ACS 5-year vulnerability variables.

Geometry: Census TIGERweb REST, tigerWMS_ACS2023 / Census Tracts (2020 tract vintage), served in EPSG:4326.
ACS values:
  * if env CENSUS_API_KEY is set -> official api.census.gov ACS 2023 5-year (the API now requires a key)
  * otherwise -> Census Reporter API (api.censusreporter.org), which republishes the official ACS tables
    unchanged; its latest supported release is used (reported in each feature's `acs_release`).
Tables: B01003 total pop; B01001 sex by age (65+); B25044 tenure by vehicles available; B19013 median HH income.

Usage: backend/.venv/bin/python backend/scripts/load_tiger_acs.py
Output: backend/data/tracts.geojson
"""
import json
import os
from pathlib import Path

import requests

STATE, COUNTY = "37", "021"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query"
OUT = Path(__file__).resolve().parents[1] / "data" / "tracts.geojson"
# B01001: male 65+ = 020..025, female 65+ = 044..049
AGE65 = [f"B01001_{i:03d}E" for i in list(range(20, 26)) + list(range(44, 50))]


def acs_official(key):
    vars_ = ["B01003_001E", "B19013_001E", "B25044_001E", "B25044_003E", "B25044_010E", "B01001_001E"] + AGE65
    r = requests.get("https://api.census.gov/data/2023/acs/acs5", params={
        "get": ",".join(vars_), "for": "tract:*", "in": f"state:{STATE} county:{COUNTY}", "key": key}, timeout=60)
    r.raise_for_status()
    hdr, *rows = r.json()
    out = {}
    for row in rows:
        d = dict(zip(hdr, row))
        v = {k: (float(d[k]) if d[k] not in (None, "") else None) for k in vars_}
        out[d["state"] + d["county"] + d["tract"]] = (v, "acs2023_5yr (api.census.gov)")
    return out


def acs_censusreporter():
    r = requests.get("https://api.censusreporter.org/1.0/data/show/latest", params={
        "table_ids": "B01003,B01001,B25044,B19013", "geo_ids": f"140|05000US{STATE}{COUNTY}"},
        headers={"User-Agent": "wolf-hacks-data-loader/1.0 (curl-compatible)"}, timeout=120)  # default python UA gets 403
    r.raise_for_status()
    d = r.json()
    rel = f"{d['release']['id']} ({d['release']['years']}) via api.censusreporter.org"
    out = {}
    for geo, t in d["data"].items():
        def g(table, col):
            return t[table]["estimate"].get(f"{table}{col:03d}")
        v = {"B01003_001E": g("B01003", 1), "B19013_001E": g("B19013", 1), "B01001_001E": g("B01001", 1),
             "B25044_001E": g("B25044", 1), "B25044_003E": g("B25044", 3), "B25044_010E": g("B25044", 10)}
        for name in AGE65:
            v[name] = g("B01001", int(name[7:10]))
        out[geo.split("US")[1]] = (v, rel)
    return out


def pct(num, den):
    return round(100.0 * num / den, 2) if num is not None and den else None


def main():
    key = os.environ.get("CENSUS_API_KEY")
    acs = acs_official(key) if key else acs_censusreporter()
    r = requests.get(TIGER, params={"where": f"STATE='{STATE}' AND COUNTY='{COUNTY}'",
                                    "outFields": "GEOID,NAME,BASENAME,AREALAND", "outSR": 4326,
                                    "f": "geojson"}, timeout=120)
    r.raise_for_status()
    feats = []
    for f in r.json()["features"]:
        p = f["properties"]
        v, rel = acs.get(p["GEOID"], ({}, None))
        age65 = sum(v.get(k) or 0 for k in AGE65) if v else None
        inc = v.get("B19013_001E")
        if inc is not None and inc < 0:  # Census jam values (e.g. -666666666) = not available
            inc = None
        nov = (v.get("B25044_003E") or 0) + (v.get("B25044_010E") or 0) if v else None
        feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "geoid": p["GEOID"], "name": p["NAME"],
            "pop": int(v["B01003_001E"]) if v.get("B01003_001E") is not None else None,
            "pct_65plus": pct(age65, v.get("B01001_001E")),
            "pct_no_vehicle": pct(nov, v.get("B25044_001E")),
            "median_income": int(inc) if inc is not None else None,
            "aland_m2": p.get("AREALAND"),
            "acs_release": rel,
            "source_url": TIGER.rsplit("/query", 1)[0],
        }})
    feats.sort(key=lambda x: x["properties"]["geoid"])
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"wrote {len(feats)} tracts ({sum(1 for x in feats if x['properties']['pop'] is not None)} with ACS) -> {OUT}")


if __name__ == "__main__":
    main()
