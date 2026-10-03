"""Load static context layers (tracts, road segments, sensor sites, storm track) into PostGIS.

Run once after `docker compose up` and the fetch scripts:
    backend/.venv/bin/python backend/scripts/load_db.py
"""
import json
import os
import sys
from pathlib import Path

import psycopg

DATA = Path(__file__).resolve().parent.parent / "data"
DSN = os.getenv("DATABASE_URL", "postgresql://postgres:helene@localhost:5433/helene")


def main():
    with psycopg.connect(DSN, autocommit=False) as conn, conn.cursor() as cur:
        # Tracts
        tracts = json.loads((DATA / "tracts.geojson").read_text())["features"]
        cur.execute("TRUNCATE tracts")
        for f in tracts:
            p = f["properties"]
            cur.execute(
                """INSERT INTO tracts (geoid, name, pop, pct_65plus, pct_no_vehicle, median_income, geom)
                   VALUES (%s,%s,%s,%s,%s,%s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)))""",
                (p["geoid"], p["name"], p.get("pop"), p.get("pct_65plus"), p.get("pct_no_vehicle"),
                 p.get("median_income"), json.dumps(f["geometry"])))
        print(f"tracts: {len(tracts)}")

        # Road segments (mirrors the OSM graph used for routing)
        segs = json.loads((DATA / "road_segments.geojson").read_text())["features"]
        cur.execute("TRUNCATE road_segments RESTART IDENTITY")
        with cur.copy("COPY road_segments (u, v, k, name, highway, length_m, travel_time_s, geom) FROM STDIN") as cp:
            for f in segs:
                p = f["properties"]
                if f["geometry"]["type"] != "LineString":
                    continue
                wkt = "SRID=4326;LINESTRING(" + ",".join(f"{x} {y}" for x, y in f["geometry"]["coordinates"]) + ")"
                cp.write_row((p["u"], p["v"], p.get("key", 0), p.get("name"), p.get("highway"),
                              p.get("length_m"), p.get("travel_time_s"), wkt))
        print(f"road segments: {len(segs)}")

        # Sensor sites
        sites = json.loads((DATA / "usgs_sites.json").read_text())
        for s in sites:
            cur.execute(
                """INSERT INTO sensor_sites (site_id, name, flood_stage_ft, geom)
                   VALUES (%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326))
                   ON CONFLICT (site_id) DO UPDATE SET name=EXCLUDED.name, flood_stage_ft=EXCLUDED.flood_stage_ft""",
                (s["site_id"], s["site_name"], s.get("flood_stage_ft"), s["lon"], s["lat"]))
        print(f"sensor sites: {len(sites)}")

        # Storm track
        track = json.loads((DATA / "helene_track.geojson").read_text())["features"]
        cur.execute("TRUNCATE storm_track RESTART IDENTITY")
        for f in track:
            p = f["properties"]
            cur.execute("INSERT INTO storm_track (at, wind_kt, category, geom) VALUES (%s,%s,%s, ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))",
                        (p.get("datetime"), p.get("wind_kt"), str(p.get("category")) if p.get("category") is not None else None,
                         json.dumps(f["geometry"])))
        print(f"storm track features: {len(track)}")
        conn.commit()


if __name__ == "__main__":
    sys.exit(main())
