"""Scheduled AI-generated Telegram group announcements."""

from datetime import datetime
import json
import threading
import time
from zoneinfo import ZoneInfo

import ai_assistant
import config as cfg
import state
from telegram_bot import send_telegram_message

log = cfg.log.getChild("ai_broadcast")

_state_lock = threading.Lock()
_sent_slots: set[str] = set()
_tz = ZoneInfo(cfg.AI_BROADCAST_TIMEZONE or "Asia/Singapore")


def _load_state():
    global _sent_slots
    try:
        with open(cfg.AI_BROADCAST_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _sent_slots = set(data.get("sent_slots", []))
    except Exception:
        _sent_slots = set()


def _save_state():
    try:
        rows = sorted(_sent_slots)[-200:]
        with open(cfg.AI_BROADCAST_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"sent_slots": rows}, f, ensure_ascii=False)
    except Exception as e:
        log.error(f"AI broadcast state save error: {e}")


def _parse_times() -> set[str]:
    out = set()
    for raw in (cfg.AI_BROADCAST_TIMES or "").split(","):
        token = raw.strip()
        if len(token) != 5 or token[2] != ":":
            continue
        hh, mm = token.split(":")
        if hh.isdigit() and mm.isdigit() and 0 <= int(hh) <= 23 and 0 <= int(mm) <= 59:
            out.add(f"{int(hh):02d}:{int(mm):02d}")
    return out


def _slot_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%d %H:%M")


def _mark_slot_done(slot_key: str):
    with _state_lock:
        _sent_slots.add(slot_key)
        _save_state()


def _has_live_content() -> bool:
    ongoing = sum(1 for status in state.ongoing_status_map.values() if status == "ongoing")
    scheduled = sum(1 for status in state.ongoing_status_map.values() if status == "scheduled")
    verifying = sum(1 for status in state.ongoing_status_map.values() if status == "verifying")
    return (ongoing + scheduled + verifying) > 0


def scheduled_ai_broadcast_loop():
    if not cfg.AI_BROADCAST_CHAT_ID:
        log.info("AI broadcast loop not started: AI_BROADCAST_CHAT_ID is empty.")
        return

    times_of_day = _parse_times()
    if not times_of_day:
        log.info("AI broadcast loop not started: AI_BROADCAST_TIMES has no valid HH:MM entries.")
        return

    _load_state()
    log.info(f"AI broadcast loop started for chat {cfg.AI_BROADCAST_CHAT_ID} at {sorted(times_of_day)}")

    while True:
        try:
            now = datetime.now(_tz)
            slot_hhmm = now.strftime("%H:%M")
            slot_key = _slot_key(now)

            if slot_hhmm in times_of_day and slot_key not in _sent_slots:
                if cfg.AI_BROADCAST_ONLY_WHEN_LIVE and not _has_live_content():
                    log.info(f"Skipping AI broadcast at {slot_key}: no live/scheduled/verifying coins.")
                    _mark_slot_done(slot_key)
                else:
                    message = ai_assistant.generate_group_broadcast()
                    send_telegram_message(message, chat_id=cfg.AI_BROADCAST_CHAT_ID)
                    log.info(f"Sent AI broadcast to {cfg.AI_BROADCAST_CHAT_ID} at {slot_key}")
                    _mark_slot_done(slot_key)
        except Exception as e:
            log.error(f"AI broadcast loop error: {e}")

        time.sleep(20)
