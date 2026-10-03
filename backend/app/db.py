import json
from contextlib import asynccontextmanager

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .config import DATABASE_URL

pool = AsyncConnectionPool(DATABASE_URL, min_size=2, max_size=10, open=False,
                           kwargs={"row_factory": dict_row, "autocommit": True})


async def open_pool():
    await pool.open()


async def close_pool():
    await pool.close()


async def fetch(sql: str, *args) -> list[dict]:
    # A single dict argument means named (%(name)s) placeholders.
    params = args[0] if len(args) == 1 and isinstance(args[0], dict) else (args or None)
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall() if cur.description else []


async def fetchrow(sql: str, *args) -> dict | None:
    rows = await fetch(sql, *args)
    return rows[0] if rows else None


async def fetchval(sql: str, *args):
    row = await fetchrow(sql, *args)
    return next(iter(row.values())) if row else None


async def execute(sql: str, *args) -> None:
    async with pool.connection() as conn:
        await conn.execute(sql, args or None)


@asynccontextmanager
async def transaction():
    async with pool.connection() as conn:
        async with conn.transaction():
            yield conn


def J(obj) -> Jsonb:
    return Jsonb(obj)


def geojson(text: str | None):
    return json.loads(text) if text else None
