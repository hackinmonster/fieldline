import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db
from .bus import hub
from .config import UPLOAD_DIR
from .coordination import routing
from .ingestion.api import router as ingest_router
from .intelligence import pipeline
from .state.api import router as state_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.open_pool()
    await asyncio.to_thread(routing.load_graph)
    await routing.sync_closures_from_db()
    worker = asyncio.create_task(pipeline.worker())
    yield
    worker.cancel()
    await db.close_pool()


app = FastAPI(title="Helene Volunteer Coordination", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(ingest_router)
app.include_router(state_router)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
async def health():
    return {"ok": True, "routing": routing.ready(), "queue": pipeline.queue.qsize() + int(pipeline.busy)}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)
