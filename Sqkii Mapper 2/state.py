# ===========================================================
# state.py — Shared mutable state for Sqkii Mapper 2
# ===========================================================
import threading
import pandas as pd
import config as cfg

# ---- Maintenance mode (toggled at runtime) ----
MAINTENANCE_MODE = False

# ---- Coin state ----
sent_coin_ids = set()
ongoing_status_map = {}
ongoing_coin_data = {}
forfeited_coin_ids = set()
forfeited_coin_data = {}
winner_names_record = {}          # coin_id -> last_known_winner_name
smallest_circle_status_map = {}
smallest_circle_data = {}
notified_smallest_ids = set()
latest_api_silver_data = {}

# ---- MRT data ----
MRT_STATIONS = []
mrt_df = pd.read_csv(cfg.MRT_CSV_PATH)
MRT_TYPE_MAP = dict(
    zip(
        mrt_df["station_name"].astype(str).str.strip().str.lower(),
        mrt_df["type"].astype(str).str.strip(),
    )
)

# ---- User / Telegram ----
authorized_users = set()
CALLBACK_TOKENS: dict[str, str] = {}
user_last_location = {}           # user_id -> (lat, lng, ts)
pending_plot_radius = {}          # user_id -> radius_m

# ---- Tracking ----
track_state_lock = threading.Lock()
track_subscribers = {}            # coin_id -> set(chat_id)
track_last_circle = {}            # coin_id -> {"lat", "lng", "radius"}

# ---- Mapper sync ----
_mapper_push_pending = False
_mapper_push_lock = threading.Lock()
_mapper_boot_synced_once = False
_mapper_last_sig = None

# ---- Startup guard ----
_startup_suppress_alerts = True

# ---- Map style (may be set later) ----
SQKII_STYLE = ""
