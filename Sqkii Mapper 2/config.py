# ===========================================================
# config.py — Centralized configuration for Sqkii Mapper 2
# ===========================================================
import os
import pathlib
import logging
from logging.handlers import RotatingFileHandler

import requests
from requests.adapters import HTTPAdapter
from dotenv import load_dotenv
import google.generativeai as genai
from openai import OpenAI

# ---- Load environment ----
load_dotenv()

# ---- Logging ----
_LOG_FMT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_LOG_DATE = "%Y-%m-%d %H:%M:%S"

def setup_logging(log_file="sqkii_mapper.log", level=logging.INFO):
    root = logging.getLogger()
    if root.handlers:
        return root  # already configured
    root.setLevel(level)
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter(_LOG_FMT, datefmt=_LOG_DATE))
    root.addHandler(ch)
    fh = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=3, encoding="utf-8")
    fh.setFormatter(logging.Formatter(_LOG_FMT, datefmt=_LOG_DATE))
    root.addHandler(fh)
    return root

logger = setup_logging()
log = logging.getLogger("sqkii")

# ---- Secrets ----
TELEGRAM_TOKEN       = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID     = os.getenv("TELEGRAM_CHAT_ID", "")
GOOGLE_MAPS_API_KEY  = os.getenv("GOOGLE_MAPS_API_KEY", "")
GEMINI_API_KEY       = os.getenv("GEMINI_API_KEY", "")
OPENROUTER_API_KEY   = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BACKUP_KEY = os.getenv("OPENROUTER_BACKUP_KEY", "")
GEOAPIFY_API_KEY     = os.getenv("GEOAPIFY_API_KEY", "")
SUPABASE_URL         = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY    = os.getenv("SUPABASE_ANON_KEY", "")
BOT_PASSWORD         = os.getenv("BOT_PASSWORD", "")
MAINTENANCE_PASSWORD = os.getenv("MAINTENANCE_PASSWORD", "wk30")

# ---- App config ----
MAPPER_ROOM_CODE       = os.getenv("MAPPER_ROOM_CODE", "silver")
MAPPER_SYNC_EVERY_SEC  = int(os.getenv("MAPPER_SYNC_EVERY_SEC", "1800"))

# ---- Paths ----
BASE_DIR           = pathlib.Path(__file__).resolve().parent
SENT_PATH          = str(BASE_DIR / "sent_coins.json")
WINNERS_FILE       = str((BASE_DIR / "Winners.txt").resolve())
EXCEL_PATH         = str((BASE_DIR / "shrink_log.xlsx").resolve())
TRACK_STATE_FILE   = "track_state.json"
AUTH_FILE          = "authorized_users.json"
PLOTS_FOLDER       = "plots"
SCREENSHOT_FOLDER  = "map_screenshots"
MRT_CSV_PATH       = "sg_mrt_stations.csv"
os.makedirs(PLOTS_FOLDER, exist_ok=True)
os.makedirs(SCREENSHOT_FOLDER, exist_ok=True)

# ---- HTTP session ----
http = requests.Session()
http.headers.update({"User-Agent": "SilverCoinAlertsBot/1.0"})
http.mount("https://", HTTPAdapter(pool_connections=30, pool_maxsize=30))
http.mount("http://",  HTTPAdapter(pool_connections=30, pool_maxsize=30))

def GET(url, **kw):
    return http.get(url, timeout=kw.pop("timeout", 20), **kw)

def POST(url, **kw):
    return http.post(url, timeout=kw.pop("timeout", 20), **kw)

# ---- Gemini ----
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# ---- OpenRouter ----
openrouter_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)

# ---- Misc constants ----
PICKER_PAGE_SIZE = 30
ignored_first_n = 0
