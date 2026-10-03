"""DEMO-STUB endpoints: load / rewind the Helene scenario from the dashboard."""
from fastapi import APIRouter, HTTPException

from . import runner

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/setup")
async def setup():
    if not runner.start_setup():
        raise HTTPException(409, "scenario is already loading")
    return runner.status


@router.post("/rewind")
async def rewind():
    try:
        await runner.rewind()
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return runner.status


@router.get("/status")
async def get_status():
    return runner.status
