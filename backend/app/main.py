import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .bus import hub
from .coordination import routing
from .demo import runner as demo_runner
from .demo.api import router as demo_router
from .ingestion.api import router as ingest_router
from .risk.api import router as risk_router
from .intelligence import pipeline
from .state.api import router as state_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.open_pool()
    await asyncio.to_thread(routing.load_graph)
    await routing.sync_closures_from_db()
    await demo_runner.restore()
    worker = asyncio.create_task(pipeline.worker())
    mover = asyncio.create_task(demo_runner.movement.run())  # DEMO-STUB: simulated volunteer GPS
    yield
    mover.cancel()
    worker.cancel()
    await db.close_pool()


app = FastAPI(title="Disaster Response Coordination", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(ingest_router)
app.include_router(state_router)
app.include_router(demo_router)
app.include_router(risk_router)


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
