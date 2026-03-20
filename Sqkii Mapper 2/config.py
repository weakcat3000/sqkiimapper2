# ===========================================================
# config.py — Centralized configuration for Sqkii Mapper 2
# ===========================================================
import os
import pathlib
import logging
from logging.handlers import RotatingFileHandler
from urllib.parse import quote_plus

import requests
from requests.adapters import HTTPAdapter
from dotenv import load_dotenv

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
GREAT_GOLD_HUNT_PAGE_URL = os.getenv("GREAT_GOLD_HUNT_PAGE_URL", "https://www.greatgoldhunt.com/#gold-hunt-quizzes")
GREAT_GOLD_HUNT_JSON_URL = os.getenv("GREAT_GOLD_HUNT_JSON_URL", "https://www.greatgoldhunt.com/json/currentActiveQuizzes.json")
GREAT_GOLD_HUNT_POLL_SEC = int(os.getenv("GREAT_GOLD_HUNT_POLL_SEC", "30"))
GREAT_GOLD_HUNT_COOKIE = os.getenv("GREAT_GOLD_HUNT_COOKIE", "").strip()
GREAT_GOLD_HUNT_HEADLESS = os.getenv("GREAT_GOLD_HUNT_HEADLESS", "0").strip().lower() in ("1", "true", "yes", "on")
GREAT_GOLD_HUNT_START_MINIMIZED = os.getenv("GREAT_GOLD_HUNT_START_MINIMIZED", "1").strip().lower() in ("1", "true", "yes", "on")
GREAT_GOLD_HUNT_CHECKPOINT_WAIT_SEC = int(os.getenv("GREAT_GOLD_HUNT_CHECKPOINT_WAIT_SEC", "180"))
GREAT_GOLD_HUNT_BROWSER_BINARY = os.getenv("GREAT_GOLD_HUNT_BROWSER_BINARY", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
GREAT_GOLD_HUNT_PROFILE_SEED_FROM = os.getenv("GREAT_GOLD_HUNT_PROFILE_SEED_FROM", os.path.join(os.getenv("LOCALAPPDATA", ""), "Google", "Chrome", "User Data"))
GREAT_GOLD_HUNT_PROFILE_DIRECTORY = os.getenv("GREAT_GOLD_HUNT_PROFILE_DIRECTORY", "Default")
AI_PROVIDER          = os.getenv("AI_PROVIDER", "gemini").strip().lower()
AI_FALLBACK_PROVIDER = os.getenv("AI_FALLBACK_PROVIDER", "openrouter").strip().lower()
GEMINI_MODEL         = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
GEMINI_FAST_MODEL    = os.getenv("GEMINI_FAST_MODEL", "gemini-2.5-flash-lite").strip()
ENABLE_SCHEDULED_AI_BROADCASTS = os.getenv("ENABLE_SCHEDULED_AI_BROADCASTS", "0").strip().lower() in ("1", "true", "yes", "on")
AI_BROADCAST_CHAT_ID = os.getenv("AI_BROADCAST_CHAT_ID", "").strip()
AI_BROADCAST_TIMES   = os.getenv("AI_BROADCAST_TIMES", "09:00,19:00").strip()
AI_BROADCAST_ONLY_WHEN_LIVE = os.getenv("AI_BROADCAST_ONLY_WHEN_LIVE", "1").strip().lower() in ("1", "true", "yes", "on")
AI_BROADCAST_TIMEZONE = os.getenv("AI_BROADCAST_TIMEZONE", "Asia/Singapore").strip()
SQKII_NEWS_SEARCH_QUERY = os.getenv("SQKII_NEWS_SEARCH_QUERY", "Sqkii HuntTheMouse").strip()
SQKII_NEWS_RSS_URL = os.getenv(
    "SQKII_NEWS_RSS_URL",
    f"https://news.google.com/rss/search?q={quote_plus(SQKII_NEWS_SEARCH_QUERY)}&hl=en-SG&gl=SG&ceid=SG:en",
).strip()

# ---- Paths ----
BASE_DIR           = pathlib.Path(__file__).resolve().parent
SENT_PATH          = str(BASE_DIR / "sent_coins.json")
WINNERS_FILE       = str((BASE_DIR / "Winners.txt").resolve())
EXCEL_PATH         = str((BASE_DIR / "shrink_log.xlsx").resolve())
OTHER_ALERTS_STATE_FILE = str((BASE_DIR / "other_alerts_state.json").resolve())
GREAT_GOLD_HUNT_TITLES_PATH = str((BASE_DIR / "great_gold_hunt_titles.json").resolve())
GREAT_GOLD_HUNT_PROFILE_DIR = str((BASE_DIR / ".great_gold_hunt_profile").resolve())
GREAT_GOLD_HUNT_COOKIES_PATH = str((BASE_DIR / "great_gold_hunt_cookies.json").resolve())
AI_BROADCAST_STATE_FILE = str((BASE_DIR / "ai_broadcast_state.json").resolve())
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

# ---- Misc constants ----
PICKER_PAGE_SIZE = 30
ignored_first_n = 0
