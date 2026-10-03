"""Road network routing with live closures (REAL).

The Buncombe OSM drive graph is held in memory (networkx). Closures snap to
`road_segments` in PostGIS and remove the matching edges from the routing
weight function, so every subsequent route avoids them. Works for any closure
anywhere in the county — nothing is keyed to demo roads.
"""
import asyncio
import logging
import math

import networkx as nx
import numpy as np

from .. import db
from ..config import CLOSURE_SNAP_RADIUS_M, GRAPH_PATH
from ..geo import road_core

log = logging.getLogger("routing")

G: nx.MultiDiGraph | None = None
_node_ids: np.ndarray | None = None
_node_xy: np.ndarray | None = None
closed: set[tuple[int, int, int]] = set()


def load_graph():
    global G, _node_ids, _node_xy
    if not GRAPH_PATH.exists():
        log.warning("road graph %s missing — routing disabled until build_graph.py runs", GRAPH_PATH)
        return
    import osmnx as ox
    G = ox.load_graphml(GRAPH_PATH)
    ids, xy = zip(*[(n, (d["x"], d["y"])) for n, d in G.nodes(data=True)])
    _node_ids = np.array(ids)
    _node_xy = np.array(xy)
    log.info("road graph loaded: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())


async def sync_closures_from_db():
    rows = await db.fetch("SELECT u, v, k FROM road_segments WHERE closed")
    closed.clear()
    closed.update((r["u"], r["v"], r["k"]) for r in rows)


def ready() -> bool:
    return G is not None


def nearest_node(lon: float, lat: float) -> int:
    assert _node_xy is not None and _node_ids is not None
    dx = (_node_xy[:, 0] - lon) * math.cos(math.radians(lat))
    dy = _node_xy[:, 1] - lat
    return int(_node_ids[np.argmin(dx * dx + dy * dy)])


def _make_weight(blocked: set):
    def _weight(u, v, data):
        # data: {key: attrs} for MultiDiGraph. Hide edge entirely if every parallel edge is closed.
        best = None
        for k, d in data.items():
            if (u, v, k) in blocked:
                continue
            t = d.get("travel_time", d.get("length", 1.0) / 13.0)
            if best is None or t < best:
                best = t
        return best
    return _weight


def _best_key(u, v, blocked: set):
    best_k, best_t = None, None
    for k, d in G[u][v].items():
        if (u, v, k) in blocked:
            continue
        t = d.get("travel_time", 1e9)
        if best_t is None or t < best_t:
            best_k, best_t = k, t
    return best_k


def _route_sync(src: tuple[float, float], dst: tuple[float, float], blocked: set) -> dict | None:
    a, b = nearest_node(*src), nearest_node(*dst)
    try:
        eta, nodes = nx.bidirectional_dijkstra(G, a, b, weight=_make_weight(blocked))
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
    coords: list[tuple[float, float]] = []
    for u, v in zip(nodes[:-1], nodes[1:]):
        d = G[u][v][_best_key(u, v, blocked)]
        geom = d.get("geometry")
        pts = list(geom.coords) if geom is not None else [(G.nodes[u]["x"], G.nodes[u]["y"]),
                                                           (G.nodes[v]["x"], G.nodes[v]["y"])]
        if coords and pts and pts[0] != coords[-1]:
            # osmnx geometries may be stored reversed relative to u→v
            if pts[-1] == coords[-1] or _dist2(pts[-1], coords[-1]) < _dist2(pts[0], coords[-1]):
                pts = pts[::-1]
        coords.extend(pts if not coords else pts[1:])
    if len(coords) < 2:
        coords = [src, dst]
    return {"eta_s": float(eta), "nodes": [int(n) for n in nodes], "coords": coords}


def _dist2(p, q):
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2


async def route(src: tuple[float, float], dst: tuple[float, float],
                ignore: set | None = None) -> dict | None:
    """Shortest travel-time path avoiding closed segments. None = unreachable.
    `ignore`: closures to pretend are open (used to compute the pre-closure baseline)."""
    if not ready():
        return None
    blocked = set(closed) - (ignore or set())
    return await asyncio.to_thread(_route_sync, src, dst, blocked)


def route_uses(nodes: list[int], keys: set) -> bool:
    """Does a node path traverse any of the given (u, v, k) edges?"""
    pairs = {(u, v) for u, v, _ in keys}
    return any((u, v) in pairs for u, v in zip(nodes[:-1], nodes[1:]))


def find_bridge(road_name: str, hint: tuple[float, float] | None = None) -> tuple[float, float] | None:
    """Midpoint of a bridge (OSM bridge=*) on the named road, nearest to `hint` if given.
    Bridges are the most common flood failure point, so 'X Rd at the river bridge' resolves here."""
    if G is None:
        return None
    core = road_core(road_name)
    best, best_d = None, None
    for u, v, d in G.edges(data=True):
        if not d.get("bridge") or core not in str(d.get("name", "")).lower():
            continue
        geom = d.get("geometry")
        pts = list(geom.coords) if geom is not None else [(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]
        mid = pts[len(pts) // 2] if len(pts) > 2 else ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
        dist = _dist2(mid, hint) if hint else 0
        if best is None or dist < best_d:
            best, best_d = mid, dist
    return best


def road_names(nodes: list[int]) -> list[str]:
    """Ordered distinct road names along a node path (for human-readable route changes)."""
    out: list[str] = []
    if G is None:
        return out
    for u, v in zip(nodes[:-1], nodes[1:]):
        d = min(G[u][v].values(), key=lambda x: x.get("travel_time", 1e9))
        n = d.get("name")
        n = n if isinstance(n, str) else (n[0] if isinstance(n, list) and n else None)
        if n and (not out or out[-1] != n):
            out.append(n)
    return out


def path_length_m(coords) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords[:-1], coords[1:]):
        dx = (x2 - x1) * 111320 * math.cos(math.radians((y1 + y2) / 2))
        dy = (y2 - y1) * 110540
        total += math.hypot(dx, dy)
    return total


def linestring_wkt(coords) -> str:
    return "LINESTRING(" + ",".join(f"{x} {y}" for x, y in coords) + ")"


async def snap_closure(geom_geojson: str, road_name: str | None) -> list[dict]:
    """Find the road segments a closure report refers to.

    Line closures (NCDOT extents): segments lying mostly (>60%) inside a 20 m buffer of the
    closed stretch — so crossing side streets are not closed.
    Point closures (radio / field reports): segments of the named road near the point;
    geometry-only with a tighter radius if the name doesn't match anything.
    """
    gtype = await db.fetchval("SELECT GeometryType(ST_GeomFromGeoJSON(%s))", geom_geojson)
    if gtype and "LINE" in gtype.upper():
        rows = await db.fetch(
            """WITH c AS (SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326),32617) AS line),
                    b AS (SELECT line, ST_Buffer(line, 20) AS buf FROM c)
               SELECT s.id, s.u, s.v, s.k, s.name FROM road_segments s, b
               WHERE ST_Intersects(ST_Transform(s.geom,32617), b.buf)
                 AND ST_Length(ST_Intersection(ST_Transform(s.geom,32617), b.buf))
                     > 0.6 * GREATEST(LEAST(ST_Length(ST_Transform(s.geom,32617)), ST_Length(b.line)), 1)""", geom_geojson)
        core = road_core(road_name) if road_name else ""
        named = [r for r in rows if r["name"] and core and core in r["name"].lower()]
        # Prefer the named road (drops junction stubs of crossing streets); fall back to geometry.
        return named or rows
    g ="ST_SetSRID(ST_GeomFromGeoJSON(%s),4326)"
    if road_name and road_core(road_name):
        rows = await db.fetch(
            f"""SELECT id, u, v, k, name FROM road_segments, (SELECT {g} AS cg) c
                WHERE ST_DWithin(geom::geography, c.cg::geography, %s) AND name ILIKE %s""",
            geom_geojson, CLOSURE_SNAP_RADIUS_M, f"%{road_core(road_name)}%")
        if rows:
            return rows
    return await db.fetch(
        f"""SELECT id, u, v, k, name FROM road_segments, (SELECT {g} AS cg) c
            WHERE ST_DWithin(geom::geography, c.cg::geography, %s)""",
        geom_geojson, CLOSURE_SNAP_RADIUS_M / 3)


async def set_closed(segment_ids: list[int], is_closed: bool, reason: str, at) -> list[dict]:
    rows = await db.fetch(
        """UPDATE road_segments SET closed=%s, closed_reason=%s, closed_since=%s
           WHERE id = ANY(%s) RETURNING id, u, v, k, name, ST_AsGeoJSON(geom) AS geojson""",
        is_closed, reason if is_closed else None, at if is_closed else None, segment_ids)
    for r in rows:
        key = (r["u"], r["v"], r["k"])
        (closed.add if is_closed else closed.discard)(key)
    return rows
