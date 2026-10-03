import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:helene@localhost:5433/helene")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-5.4-mini")
DATA_DIR = BACKEND_DIR / "data"
GRAPH_PATH = DATA_DIR / "buncombe_drive.graphml"
GEOCODE_CACHE = DATA_DIR / "geocode_cache.json"

# Tuning knobs. These are NOT decision rules — they bound how much context
# the LLM sees (recall), or are safety thresholds a human operator would set.
LINK_RECALL_RADIUS_M = float(os.getenv("LINK_RECALL_RADIUS_M", 5000))
LINK_RECALL_WINDOW_H = float(os.getenv("LINK_RECALL_WINDOW_H", 48))
MATCH_CANDIDATES = int(os.getenv("MATCH_CANDIDATES", 6))
CLOSURE_SNAP_RADIUS_M = float(os.getenv("CLOSURE_SNAP_RADIUS_M", 120))
