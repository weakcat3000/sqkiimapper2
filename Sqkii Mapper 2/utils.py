# ===========================================================
# utils.py — Shared utility functions for Sqkii Mapper 2
# ===========================================================
import os
import csv
import json
import math
import time
import re
import secrets
import subprocess
import sys
import threading
from datetime import datetime
from collections import Counter
from math import radians, cos, sin, sqrt, atan2

import config as cfg
import state

log = cfg.log.getChild("utils")


# ===========================================================
# Geo helpers
# ===========================================================

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a)) * 1000


def get_nearest_mrt(lat, lng):
    nearest_station = None
    nearest_dist = float('inf')
    for name, s_lat, s_lng in state.MRT_STATIONS:
        dist = haversine(lat, lng, s_lat, s_lng)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_station = name
    return nearest_station, round(nearest_dist)


def get_mrt_type(name: str) -> str:
    return state.MRT_TYPE_MAP.get((name or "").strip().lower(), "MRT")


def reverse_geocode(lat, lng):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18&addressdetails=1"
        headers = {'User-Agent': 'HuntTheMouseBot/1.0'}
        res = cfg.GET(url, headers=headers)
        if res.status_code == 200:
            data = res.json()
            address = data.get("address", {})
            components = [address.get("building"), address.get("road"), address.get("suburb"),
                          address.get("neighbourhood"), address.get("city"), address.get("state")]
            location_name = ", ".join(filter(None, components))
            return location_name if location_name else "Unknown location"
    except Exception as e:
        log.warning(f"Reverse geocode error: {e}")
    return "Unknown location"


# ===========================================================
# Naming / display helpers
# ===========================================================

def parse_location_name(coin_id):
    parts = coin_id.split("_")
    if len(parts) >= 4:
        location = " ".join(parts[-4:-1]).replace("-", " ").title()
        number = parts[-1]
        if location.lower().startswith("capitaland "):
            location = location[len("capitaland "):].strip()
        return f"{location} Coin {number}"
    return coin_id


def display_label(coin_id, data=None):
    d = data or {}
    brand = (d.get("brand_name") or "").strip()
    coin_num = d.get("coin_number", None)
    if coin_num is not None:
        try:
            coin_num = int(float(coin_num))
        except Exception:
            coin_num = str(coin_num).strip()
    if brand and coin_num not in (None, ""):
        return f"{brand} Coin {coin_num}"
    parsed = parse_location_name(coin_id)
    if brand:
        if parsed.lower().startswith(brand.lower()):
            return parsed
        return f"{brand} {parsed}"
    return parsed


def display_label_with_reward(coin_id, data):
    label = display_label(coin_id, data)
    reward = data.get("reward") or ""
    if reward:
        reward_str = str(reward)
        if not reward_str.startswith("S$"):
            try:
                reward_value = int(float(reward))
                reward_str = f"S${reward_value:,}"
            except Exception:
                pass
        return f"{label} ({reward_str})"
    return label


def _last3_words_label(coin_id):
    base = parse_location_name(coin_id)
    parts = base.split()
    return " ".join(parts[-1:]) if len(parts) >= 3 else base


def _last2_words_label(coin_id):
    base = parse_location_name(coin_id)
    parts = [p for p in base.split() if p.lower() != "coin"]
    if len(parts) >= 2:
        return " ".join(parts[-2:])
    return parts[-1] if parts else base


def _last1_word_label(coin_id: str) -> str:
    base = parse_location_name(coin_id)
    parts = base.split()
    return parts[-1] if parts else base


def md_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("*", "\\*").replace("_", "\\_").replace("`", "\\`")


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).casefold()


def _fmt_radius_tag(v):
    try:
        return f" ({int(float(v))}m)"
    except Exception:
        return ""


# ===========================================================
# Reward / sort helpers
# ===========================================================

def _get_reward_numeric(data: dict) -> float:
    raw = data.get("reward")
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw)
    cleaned = "".join(ch for ch in s if (ch.isdigit() or ch == "."))
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except Exception:
        return 0.0


def _sort_key_label(coin_id: str):
    try:
        return display_label(coin_id, state.ongoing_coin_data.get(coin_id, {})).casefold()
    except Exception:
        return str(coin_id)


def _sort_key_reward_first(coin_id: str):
    data = state.ongoing_coin_data.get(coin_id, {})
    reward_val = _get_reward_numeric(data)
    try:
        label_key = display_label(coin_id, data).casefold()
    except Exception:
        label_key = str(coin_id)
    return (-reward_val, label_key)


# ===========================================================
# Token helpers (Telegram inline buttons)
# ===========================================================

def make_token(coin_id: str, kind: str) -> str:
    tok = f"{kind}:{secrets.token_urlsafe(6)}"
    state.CALLBACK_TOKENS[tok] = coin_id
    return tok


def resolve_token(token: str, expected_kind: str) -> str | None:
    if not token.startswith(expected_kind + ":"):
        return None
    return state.CALLBACK_TOKENS.get(token)


# ===========================================================
# Persistence helpers
# ===========================================================

def load_mrt_stations(file_path=None):
    file_path = file_path or cfg.MRT_CSV_PATH
    state.MRT_STATIONS = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row["station_name"].strip()
                lat = float(row["lat"])
                lng = float(row["lng"])
                state.MRT_STATIONS.append((name, lat, lng))
        log.info(f"MRT stations loaded: {len(state.MRT_STATIONS)}")
    except Exception as e:
        log.error(f"MRT CSV load error: {e}")


def load_sent_coins():
    try:
        if not os.path.exists(cfg.SENT_PATH):
            log.info(f"No sent_coins file yet at {cfg.SENT_PATH} (cold start).")
            state.sent_coin_ids = set()
            return
        with open(cfg.SENT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                state.sent_coin_ids = set(map(str, data))
            else:
                state.sent_coin_ids = set(map(str, data.get("ids", [])))
        log.info(f"Loaded {len(state.sent_coin_ids)} coin ids from {cfg.SENT_PATH}")
    except Exception as e:
        log.error(f"Sent coins load error: {e}. Starting with empty set.")
        state.sent_coin_ids = set()


def save_sent_coins():
    tmp_path = cfg.SENT_PATH + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(sorted(list(state.sent_coin_ids)), f, ensure_ascii=False)
        os.replace(tmp_path, cfg.SENT_PATH)
        log.info(f"Saved {len(state.sent_coin_ids)} ids -> {cfg.SENT_PATH}")
    except Exception as e:
        log.error(f"Sent coins save error: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


def load_authorized_users():
    try:
        with open(cfg.AUTH_FILE, "r", encoding="utf-8") as f:
            state.authorized_users = set(json.load(f))
    except Exception:
        state.authorized_users = set()


def save_authorized_users():
    try:
        with open(cfg.AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(sorted(list(state.authorized_users)), f, ensure_ascii=False)
    except Exception as e:
        log.error(f"Auth save error: {e}")


def is_authorized(user_id: int) -> bool:
    return user_id in state.authorized_users


def load_track_state():
    try:
        with open(cfg.TRACK_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            state.track_subscribers = {k: set(v) for k, v in data.get("subs", {}).items()}
            state.track_last_circle = data.get("last", {})
            state.notified_smallest_ids = set(data.get("notified_smallest", []))
    except Exception:
        state.track_subscribers, state.track_last_circle = {}, {}
        state.notified_smallest_ids = set()


def save_track_state():
    try:
        data = {
            "subs": {k: list(v) for k, v in state.track_subscribers.items()},
            "last": state.track_last_circle,
            "notified_smallest": sorted(list(state.notified_smallest_ids)),
        }
        with open(cfg.TRACK_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        log.error(f"Track state save error: {e}")


# ===========================================================
# Winner / Leaderboard
# ===========================================================

def load_winner_counts(path: str = None, aliases: dict[str, str] | None = None):
    path = path or cfg.WINNERS_FILE
    aliases = {_norm_name(k): v for k, v in (aliases or {}).items()}
    counts = Counter()
    display = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw or raw.startswith("#"):
                    continue
                norm = _norm_name(raw)
                if norm in aliases:
                    canon = _norm_name(aliases[norm])
                    display.setdefault(canon, aliases[norm])
                    counts[canon] += 1
                else:
                    pretty = re.sub(r"\s+", " ", raw)
                    display.setdefault(norm, pretty)
                    counts[norm] += 1
    except FileNotFoundError:
        return Counter(), {}
    return counts, display


def render_leaderboard_from_counts(counts: Counter, display: dict[str, str], top_n: int = 15) -> str:
    if not counts:
        return "🏆 Winners Leaderboard\n(no winners recorded yet)"
    rows = sorted(counts.items(), key=lambda kv: (-kv[1], display[kv[0]]))
    rows = rows[:top_n]
    lines = ["🏆 Winners Leaderboard", ""]
    rank = 0
    prev = None
    for i, (norm, c) in enumerate(rows, 1):
        if c != prev:
            rank = i
            prev = c
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"{rank:>2}.")
        lines.append(f"{medal} {display[norm]} — {c}")
    return "\n".join(lines)


# ===========================================================
# Weather
# ===========================================================

def get_latest_rainfall_data():
    url = "https://api-open.data.gov.sg/v2/real-time/api/rainfall"
    try:
        res = cfg.GET(url, headers={"User-Agent": "RainBot/1.0"})
        if res.status_code != 200:
            log.warning(f"Rain API error status: {res.status_code}")
            return [], ""
        payload = res.json()
        data = payload.get("data", {})
        stations = {s["id"]: s["name"] for s in data.get("stations", [])}
        readings = data.get("readings", [])
        if not readings:
            return [], ""
        latest_reading = readings[-1]
        timestamp = latest_reading.get("timestamp", "Unknown time")
        rainfall_data = [
            (stations.get(item["stationId"], item["stationId"]), item["value"])
            for item in latest_reading["data"]
            if item["value"] > 0.6
        ]
        rainfall_data.sort(key=lambda x: -x[1])
        return rainfall_data[:10], timestamp
    except Exception as e:
        log.error(f"Rainfall API error: {e}")
        return [], ""


# ===========================================================
# Smallest circle helpers
# ===========================================================

def ensure_smallest_cache(coin_id):
    item = state.ongoing_coin_data.get(coin_id) or {}
    fc = (item.get("freeCircle") or item.get("circle") or {})
    ctr = (fc.get("center") or {})
    lat = ctr.get("lat"); lng = ctr.get("lng"); radius = fc.get("radius")
    if lat and lng and radius:
        data = {
            "brand_name": item.get("brand_name"),
            "coin_number": item.get("coin_number"),
            "lat": float(lat),
            "lng": float(lng),
            "radius": float(radius),
            "timestamp": datetime.now(),
        }
        state.smallest_circle_data[coin_id] = data
        return data
    return None


def _seed_smallest_from_boot(data):
    seeded = 0
    for item in data or []:
        try:
            cid = str(item.get("coin_id", "")).strip()
            if not cid:
                continue
            if item.get("status") == "ongoing" and item.get("is_smallest_public_circle"):
                if cid not in state.notified_smallest_ids:
                    state.notified_smallest_ids.add(cid)
                    seeded += 1
                    fc = (item.get("freeCircle") or {})
                    ctr = (fc.get("center") or {})
                    lat = ctr.get("lat"); lng = ctr.get("lng"); radius = fc.get("radius")
                    if lat and lng and radius:
                        state.smallest_circle_data[cid] = {
                            "brand_name": item.get("brand_name"),
                            "coin_number": item.get("coin_number"),
                            "lat": lat, "lng": lng, "radius": radius,
                            "timestamp": datetime.now(),
                        }
        except Exception:
            continue
    if seeded:
        save_track_state()
        log.info(f"Boot: Seeded {seeded} coins already at smallest — no re-alerts on restart.")


# ===========================================================
# Mapper point collection
# ===========================================================

def _collect_mapper_points():
    out = []
    WHITE_STYLE = {
        "strokeColor": "#FFFFFF",
        "strokeOpacity": 0.75,
        "strokeWidth": 1.5,
        "fillColor": "#FFFFFF",
        "fillOpacity": 0.08
    }
    for coin_id, status in state.ongoing_status_map.items():
        if status != "ongoing":
            continue
        data = state.ongoing_coin_data.get(coin_id, {})
        circle = (data.get("freeCircle") or {})
        center = circle.get("center") or {}
        lat, lng, radius = center.get("lat"), center.get("lng"), circle.get("radius")
        if lat is None or lng is None or radius is None:
            continue
        out.append({
            "id": str(coin_id),
            "title": display_label(coin_id, data),
            "lat": float(lat),
            "lng": float(lng),
            "radius_m": float(radius),
            "style": WHITE_STYLE
        })
    return out


def _points_signature() -> str | None:
    rows = []
    for coin_id, status in state.ongoing_status_map.items():
        if status != "ongoing":
            continue
        d = state.ongoing_coin_data.get(coin_id, {})
        fc = (d.get("freeCircle") or {})
        ctr = fc.get("center") or {}
        lat, lng, r = ctr.get("lat"), ctr.get("lng"), fc.get("radius")
        if lat is None or lng is None or r is None:
            continue
        rows.append((
            str(coin_id),
            round(float(lat), 6),
            round(float(lng), 6),
            int(round(float(r))),
        ))
    if not rows:
        return None
    rows.sort()
    return json.dumps(rows, separators=(",", ":"))


# ===========================================================
# Pruning
# ===========================================================

def _prune_vanished_verifying(latest_present_ids: set):
    """If a coin was 'verifying' but vanished from the latest payload, mark it as 'found'."""
    # Import here to avoid circular import at module level
    from telegram_bot import send_telegram_message
    try:
        vanished = [cid for cid, st in list(state.ongoing_status_map.items())
                    if st == "verifying" and cid not in latest_present_ids]
        if not vanished:
            return
        for cid in vanished:
            try:
                with state.track_state_lock:
                    subs = list(state.track_subscribers.pop(cid, []))
                    state.track_last_circle.pop(cid, None)
                    save_track_state()
                if subs:
                    label = display_label(cid, state.ongoing_coin_data.get(cid, {}))
                    label_safe = md_escape(label)
                    for sub_chat in subs:
                        send_telegram_message(f"🛑 Stopped tracking *{label_safe}* — status changed to `found`.", sub_chat)
            except Exception as e:
                log.error(f"Prune track error: {e}")
            state.ongoing_status_map[cid] = "found"
    except Exception as e:
        log.error(f"Prune error: {e}")


# ===========================================================
# Subprocess launcher
# ===========================================================

def launch_shrink_automater(script_name="shrink_mainhunt.py"):
    try:
        flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        subprocess.Popen([sys.executable, script_name], creationflags=flags)
    except Exception as e:
        log.error(f"Error launching {script_name}: {e}")


# ===========================================================
# Map style helpers
# ===========================================================

def get_map_style_url() -> str:
    return state.SQKII_STYLE


def clean_style(url: str) -> str:
    return url.split("#", 1)[0]
