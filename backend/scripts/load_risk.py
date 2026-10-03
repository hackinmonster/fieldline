"""Load risk-surface inputs from public APIs straight into PostGIS (no data files on disk).

    backend/.venv/bin/python backend/scripts/load_risk.py [step ...]
    steps: svi landslides streams grid terrain debris rain   (default: all, in that order)

Sources (all REAL, fetched live):
  svi         CDC/ATSDR Social Vulnerability Index 2022, tract layer (ArcGIS FeatureServer)
  landslides  USGS preliminary Helene landslide inventory (ArcGIS FeatureServer)
  streams     USGS NHD named flowlines (National Map MapServer)
  grid        hexagonal analysis grid over Buncombe County (PostGIS ST_HexagonGrid)
  terrain     elevation samples (Open-Meteo/Copernicus GLO-90 by default; USGS 3DEP with ELEV_SOURCE=3dep)
              → HAND (height above nearest named stream) + slope
  debris      NC DEQ channelized debris-flow model (map image fetched into memory, pixels sampled)
  rain        HRRR hourly precipitation via Open-Meteo historical-forecast API (3 km model, not gauges)
"""
import io
import json
import math
import os
import sys
import time
from pathlib import Path

import httpx
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
DSN = os.environ["DATABASE_URL"]
BBOX = (-82.90, 35.42, -82.25, 35.83)          # lon_min, lat_min, lon_max, lat_max (Buncombe County)
HEX_SIZE_M = 400                                 # hex edge length; ~0.42 km² cells
RAIN_STEP_DEG = 0.04                             # ~4 km rain sample spacing (HRRR is 3 km)
RAIN_START, RAIN_END = "2024-09-25", "2024-09-30"

http = httpx.Client(timeout=120, headers={"User-Agent": "helene-coord-hackathon/0.1"})
SVI_URL = "https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/arcgis/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer/2/query"
LANDSLIDE_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Hurricane_Helene_Landslide_Locations/FeatureServer/1/query"
NHD_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query"
DEP_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
DEBRIS_URL = "https://maps.deq.nc.gov/arcgis/rest/services/DEMLR/North_Carolina_Channelized_Debris_Flow_Model/MapServer/export"
METEO_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"


def bbox_env():
    return ",".join(map(str, BBOX))


def esri_query(url: str, params: dict, page: int = 2000):
    """Page through an ArcGIS query endpoint, yielding GeoJSON features."""
    offset = 0
    while True:
        r = http.get(url, params={**params, "f": "geojson", "resultOffset": offset, "resultRecordCount": page})
        r.raise_for_status()
        feats = r.json().get("features", [])
        yield from feats
        if len(feats) < page:
            return
        offset += page


# ---------------------------------------------------------------- steps
def step_svi(cur):
    n = 0
    for f in esri_query(SVI_URL, {"where": "STCNTY='37021'", "outFields": "FIPS,RPL_THEMES,RPL_THEME1,RPL_THEME2,RPL_THEME3,RPL_THEME4,EP_AGE65,EP_DISABL,EP_NOVEH,EP_POV150", "returnGeometry": "false"}):
        p = f["properties"]
        themes = {"socioeconomic": p["RPL_THEME1"], "household": p["RPL_THEME2"], "minority_language": p["RPL_THEME3"],
                  "housing_transport": p["RPL_THEME4"], "pct_65plus": p["EP_AGE65"], "pct_disabled": p["EP_DISABL"],
                  "pct_no_vehicle": p["EP_NOVEH"], "pct_below_150_poverty": p["EP_POV150"]}
        svi = p["RPL_THEMES"] if p["RPL_THEMES"] is not None and p["RPL_THEMES"] >= 0 else None  # -999 = no data
        cur.execute("UPDATE tracts SET svi=%s, svi_themes=%s WHERE geoid=%s", (svi, json.dumps(themes), p["FIPS"]))
        n += cur.rowcount
    print(f"svi: updated {n} tracts")


def step_landslides(cur):
    cur.execute("TRUNCATE landslides")
    n = 0
    for f in esri_query(LANDSLIDE_URL, {"where": "1=1", "geometry": bbox_env(), "geometryType": "esriGeometryEnvelope",
                                        "inSR": 4326, "outFields": "*", "outSR": 4326}):
        p = {k.lower(): v for k, v in f["properties"].items()}
        cur.execute("INSERT INTO landslides (id, impact, source, geom) VALUES (%s,%s,%s, ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)) "
                    "ON CONFLICT DO NOTHING",
                    (p.get("objectid") or p.get("fid") or n, p.get("impact"), p.get("source"), json.dumps(f["geometry"])))
        n += 1
    print(f"landslides: {n}")


def step_streams(cur):
    cur.execute("TRUNCATE streams RESTART IDENTITY")
    n = 0
    for f in esri_query(NHD_URL, {"where": "gnis_name IS NOT NULL", "geometry": bbox_env(), "geometryType": "esriGeometryEnvelope",
                                  "inSR": 4326, "outSR": 4326, "outFields": "gnis_name", "maxAllowableOffset": 0.0002}):
        if not f.get("geometry"):
            continue
        cur.execute("INSERT INTO streams (name, geom) VALUES (%s, ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))))",
                    (f["properties"].get("gnis_name"), json.dumps(f["geometry"])))
        n += 1
    print(f"streams: {n} named NHD flowlines")


def step_grid(cur):
    cur.execute("TRUNCATE risk_cells RESTART IDENTITY")
    cur.execute(f"""
        WITH county AS (SELECT ST_Transform(ST_Union(geom), 32617) AS g FROM tracts),
             hex AS (SELECT (ST_HexagonGrid({HEX_SIZE_M}, g)).geom AS h FROM county)
        INSERT INTO risk_cells (geom, center, geojson, svi)
        SELECT ST_Transform(h, 4326), ST_Transform(ST_Centroid(h), 4326),
               ST_AsGeoJSON(ST_Transform(h, 4326), 5),
               (SELECT t.svi FROM tracts t WHERE ST_Contains(t.geom, ST_Transform(ST_Centroid(h), 4326)) LIMIT 1)
        FROM hex, county WHERE ST_Intersects(h, county.g)""")
    cur.execute("SELECT count(*) FROM risk_cells")
    print(f"grid: {cur.fetchone()[0]} hex cells ({HEX_SIZE_M} m)")


def _sample_chunk(chunk: list[tuple[float, float]]) -> list[float | None]:
    for attempt in range(6):
        try:
            r = http.post(DEP_URL, data={"geometry": json.dumps({"points": chunk, "spatialReference": {"wkid": 4326}}),
                                         "geometryType": "esriGeometryMultipoint", "returnFirstValueOnly": "true",
                                         # 30 m (1 arc-second) is plenty for 400 m cells and ~5× faster than native 1 m lidar
                                         "pixelSize": json.dumps({"x": 30, "y": 30, "spatialReference": {"wkid": 3857}}),
                                         "f": "json"})
            samples = r.json()["samples"]
            break
        except Exception as e:
            if attempt == 5:
                raise
            print(f"  3DEP retry {attempt + 1} (HTTP {getattr(locals().get('r'), 'status_code', '?')}: {type(e).__name__})")
            time.sleep(3 * (attempt + 1))
    vals: dict[int, float | None] = {}
    for s in samples:
        try:
            vals[s["locationId"]] = float(s["value"])
        except (TypeError, ValueError):
            vals[s["locationId"]] = None
    return [vals.get(j) for j in range(len(chunk))]


ELEV_SOURCE = os.getenv("ELEV_SOURCE", "openmeteo")   # "openmeteo" (Copernicus GLO-90, fast) | "3dep" (USGS 30 m, slow under load)
STENCIL_M = 100 if ELEV_SOURCE == "openmeteo" else 45


def _openmeteo_chunk(chunk: list[tuple[float, float]]) -> list[float | None]:
    for attempt in range(6):
        r = http.get("https://api.open-meteo.com/v1/elevation",
                     params={"latitude": ",".join(f"{y:.6f}" for _, y in chunk), "longitude": ",".join(f"{x:.6f}" for x, _ in chunk)})
        if r.status_code == 429:
            time.sleep(5 * (attempt + 1)); continue
        r.raise_for_status()
        return [float(v) if v is not None else None for v in r.json()["elevation"]]
    raise RuntimeError("Open-Meteo elevation rate-limited")


def sample_elevations(points: list[tuple[float, float]], batch: int = 200, workers: int = 3) -> list[float | None]:
    if ELEV_SOURCE == "openmeteo":
        out: list[float | None] = []
        for i in range(0, len(points), 100):
            out.extend(_openmeteo_chunk(points[i:i + 100]))
            if i % 5000 == 0:
                print(f"  elevation {len(out)}/{len(points)}", flush=True)
        return out
    from concurrent.futures import ThreadPoolExecutor
    chunks = [points[i:i + batch] for i in range(0, len(points), batch)]
    out: list[float | None] = []
    with ThreadPoolExecutor(workers) as ex:
        for k, vals in enumerate(ex.map(_sample_chunk, chunks)):   # map preserves order
            out.extend(vals)
            if k % 10 == 0:
                print(f"  3DEP {len(out)}/{len(points)}", flush=True)
    return out


def step_terrain(cur):
    # 2 elevation samples per cell: the cell center and the closest point on the nearest named stream (KNN).
    cur.execute("""
        SELECT c.id, ST_X(c.center), ST_Y(c.center), ST_X(s.p), ST_Y(s.p), s.d
        FROM risk_cells c
        CROSS JOIN LATERAL (
          SELECT ST_ClosestPoint(st.geom, c.center) AS p, ST_Distance(st.geom::geography, c.center::geography) AS d
          FROM streams st ORDER BY st.geom <-> c.center LIMIT 1) s""")
    rows = cur.fetchall()
    pts = []
    for _cid, x, y, sx, sy, _d in rows:
        pts += [(x, y), (sx, sy)]
    z = sample_elevations(pts)
    updates = []
    for k, (cid, _x, _y, _sx, _sy, d) in enumerate(rows):
        zc, zs = z[2 * k], z[2 * k + 1]
        hand = max(0.0, zc - zs) if zc is not None and zs is not None else None
        updates.append((zc, zs, hand, d, cid))
    cur.executemany("UPDATE risk_cells SET elev_m=%s, stream_elev_m=%s, hand_m=%s, stream_dist_m=%s WHERE id=%s", updates)
    # Slope at cell scale from neighboring cell centers (steepest drop to an adjacent hex) — no extra samples.
    cur.execute("""
        UPDATE risk_cells c SET slope_deg = n.s FROM (
          SELECT a.id, max(degrees(atan(abs(a.elev_m - b.elev_m) / ST_Distance(a.center::geography, b.center::geography)))) AS s
          FROM risk_cells a JOIN risk_cells b ON a.id <> b.id AND ST_DWithin(a.center::geography, b.center::geography, 800)
          WHERE a.elev_m IS NOT NULL AND b.elev_m IS NOT NULL GROUP BY a.id) n
        WHERE n.id = c.id""")
    print(f"terrain: {len(rows)} cells")


def step_debris(cur):
    from PIL import Image
    W, H = 3000, 1900
    r = http.get(DEBRIS_URL, params={"bbox": bbox_env(), "bboxSR": 4326, "imageSR": 4326, "size": f"{W},{H}",
                                     "format": "png32", "transparent": "true", "dpi": 96, "f": "image"})
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGBA")   # in memory only
    alpha = img.getchannel("A").load()
    lon0, lat0, lon1, lat1 = BBOX

    def opaque(lon, lat):
        px = int((lon - lon0) / (lon1 - lon0) * (W - 1))
        py = int((lat1 - lat) / (lat1 - lat0) * (H - 1))
        return 0 <= px < W and 0 <= py < H and alpha[px, py] > 30

    cur.execute("SELECT id, ST_X(center), ST_Y(center) FROM risk_cells")
    rows = cur.fetchall()
    # 19-point sample per hex (center + two rings) → fraction of the cell in mapped source/path zones.
    offs = [(0, 0)] + [(r_ * math.cos(a), r_ * math.sin(a)) for r_ in (150, 300) for a in [i * math.pi / (3 if r_ == 150 else 6) for i in range(6 if r_ == 150 else 12)]]
    updates = []
    for cid, x, y in rows:
        mlon = 1 / (111320 * math.cos(math.radians(y)))
        hits = sum(opaque(x + dx * mlon, y + dy / 110540) for dx, dy in offs)
        updates.append((hits / len(offs), cid))
    cur.executemany("UPDATE risk_cells SET debris_frac=%s WHERE id=%s", updates)
    print(f"debris: sampled {len(rows)} cells")


def step_rain(cur):
    cur.execute("TRUNCATE rain_points RESTART IDENTITY")
    cur.execute("TRUNCATE rain_hourly")
    lon0, lat0, lon1, lat1 = BBOX
    pts = [(round(lon0 + i * RAIN_STEP_DEG, 4), round(lat0 + j * RAIN_STEP_DEG, 4))
           for j in range(int((lat1 - lat0) / RAIN_STEP_DEG) + 1) for i in range(int((lon1 - lon0) / RAIN_STEP_DEG) + 1)]
    ids = []
    for lon, lat in pts:
        cur.execute("INSERT INTO rain_points (geom) VALUES (ST_SetSRID(ST_MakePoint(%s,%s),4326)) RETURNING id", (lon, lat))
        ids.append(cur.fetchone()[0])
    total = 0
    for i in range(0, len(pts), 40):
        chunk, cids = pts[i:i + 40], ids[i:i + 40]
        for attempt in range(4):
            r = http.get(METEO_URL, params={"latitude": ",".join(str(p[1]) for p in chunk), "longitude": ",".join(str(p[0]) for p in chunk),
                                            "start_date": RAIN_START, "end_date": RAIN_END, "hourly": "precipitation",
                                            "models": "gfs_hrrr", "timezone": "UTC"})
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1)); continue
            r.raise_for_status(); break
        data = r.json()
        data = data if isinstance(data, list) else [data]
        with cur.copy("COPY rain_hourly (point_id, at, mm) FROM STDIN") as cp:
            for pid, d in zip(cids, data):
                for t, v in zip(d["hourly"]["time"], d["hourly"]["precipitation"]):
                    if v is not None:
                        cp.write_row((pid, t + ":00+00", v)); total += 1
        print(f"  rain {min(i + 40, len(pts))}/{len(pts)} points", end="\r")
        time.sleep(1)
    print()
    # Inverse-distance weights from each cell to its 4 nearest rain points.
    cur.execute("""
        UPDATE risk_cells c SET rain_weights = w.ws FROM (
          SELECT c2.id, jsonb_agg(jsonb_build_array(n.id, n.w)) AS ws FROM risk_cells c2
          CROSS JOIN LATERAL (
            SELECT p.id, 1.0 / greatest(ST_Distance(p.geom::geography, c2.center::geography), 100)^2 AS w
            FROM rain_points p ORDER BY p.geom <-> c2.center LIMIT 4) n
          GROUP BY c2.id) w WHERE w.id = c.id""")
    print(f"rain: {len(pts)} HRRR points, {total} hourly values")


STEPS = {"svi": step_svi, "landslides": step_landslides, "streams": step_streams, "grid": step_grid,
         "terrain": step_terrain, "debris": step_debris, "rain": step_rain}

if __name__ == "__main__":
    todo = sys.argv[1:] or list(STEPS)
    with psycopg.connect(DSN) as conn:
        for s in todo:
            t0 = time.time()
            with conn.cursor() as cur:
                STEPS[s](cur)
            conn.commit()
            print(f"  ({s} took {time.time() - t0:.0f}s)")
