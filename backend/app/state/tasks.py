"""Task / assignment state helpers. Every transition is a timestamped task_event."""
from .. import db
from ..bus import publish
from ..clock import sim_now

TASK_COLS = """t.id, t.incident_id, t.type, t.status, t.title, t.description, t.requirements,
               t.urgency, t.priority, t.proposal_reasoning, t.created_at, t.updated_at,
               ST_X(t.geom) AS lon, ST_Y(t.geom) AS lat"""
ASSIGN_COLS = """a.id, a.task_id, a.volunteer_id, a.status, a.eta_s, a.reason, a.superseded_by,
                 a.route_nodes, a.created_at, a.updated_at, ST_AsGeoJSON(a.route)::json AS route"""


async def get_task(task_id: int) -> dict | None:
    return await db.fetchrow(f"SELECT {TASK_COLS}, t.geom FROM tasks t WHERE t.id=%s", task_id)


async def set_status(task_id: int, to_status: str, reason: str) -> dict:
    now = sim_now()
    prev = await db.fetchval("SELECT status FROM tasks WHERE id=%s", task_id)
    await db.execute("UPDATE tasks SET status=%s, updated_at=%s WHERE id=%s", to_status, now, task_id)
    await db.execute("INSERT INTO task_events (task_id, at, from_status, to_status, reason) VALUES (%s,%s,%s,%s,%s)",
                     task_id, now, prev, to_status, reason)
    task = await get_task(task_id)
    await publish("task.updated", _strip(task))
    return task


async def active_assignment(task_id: int) -> dict | None:
    return await db.fetchrow(
        f"SELECT {ASSIGN_COLS} FROM assignments a WHERE a.task_id=%s AND a.status IN ('OFFERED','ACCEPTED') "
        "ORDER BY a.id DESC LIMIT 1", task_id)


async def get_assignment(aid: int) -> dict | None:
    return await db.fetchrow(f"SELECT {ASSIGN_COLS} FROM assignments a WHERE a.id=%s", aid)


async def publish_assignment(aid: int):
    a = await get_assignment(aid)
    await publish("assignment.updated", a)
    return a


def _strip(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {k: v for k, v in row.items() if k != "geom"}
