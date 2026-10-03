"""Build the Buncombe County drive network from OpenStreetMap with osmnx.

Usage: backend/.venv/bin/python backend/scripts/build_graph.py
Outputs: backend/data/buncombe_drive.graphml, backend/data/road_segments.geojson (EPSG:4326)
"""
import json
from pathlib import Path

import osmnx as ox

PLACE = "Buncombe County, North Carolina, USA"
DATA = Path(__file__).resolve().parents[1] / "data"
ox.settings.use_cache = False  # don't write an HTTP cache dir (disk is tight)
ox.settings.log_console = False


def s(v):
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, (list, tuple, set)):
        return ";".join(str(x) for x in v)
    return str(v)


def main():
    G = ox.graph_from_place(PLACE, network_type="drive")
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)
    ox.save_graphml(G, DATA / "buncombe_drive.graphml")
    print(f"graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    edges = ox.graph_to_gdfs(G, nodes=False, fill_edge_geometry=True).reset_index()
    with open(DATA / "road_segments.geojson", "w") as fh:
        fh.write('{"type":"FeatureCollection","features":[\n')
        for i, e in enumerate(edges.itertuples(index=False)):
            feat = {"type": "Feature",
                    "geometry": {"type": "LineString",
                                 "coordinates": [[round(x, 6), round(y, 6)] for x, y in e.geometry.coords]},
                    "properties": {"u": int(e.u), "v": int(e.v), "key": int(e.key),
                                   "osmid": s(e.osmid), "name": s(getattr(e, "name", None)),
                                   "highway": s(e.highway), "length_m": round(float(e.length), 2),
                                   "speed_kph": round(float(e.speed_kph), 1),
                                   "travel_time_s": round(float(e.travel_time), 2)}}
            fh.write(("," if i else "") + json.dumps(feat, separators=(",", ":")) + "\n")
        fh.write("]}\n")
    print(f"wrote {len(edges)} road segments -> {DATA / 'road_segments.geojson'}")


if __name__ == "__main__":
    main()
