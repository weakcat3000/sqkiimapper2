# ===========================================================
# main.py — Sqkii Mapper 2 Orchestrator
# ===========================================================
# This is the entry point. It wires up all modules, loads
# persistent state, starts background threads, and runs the
# API monitor loop.
# ===========================================================

import threading
import time

import config as cfg
import state
import utils
from Other_Alerts import run_other_alerts_loop
from scheduled_announcements import scheduled_ai_broadcast_loop
from telegram_bot import check_telegram_messages
from scraper import setup_chrome_driver_safe, auto_refresh, monitor_api
from mapper_sync import sync_mapper_circles, mapper_sync_loop

log = cfg.log.getChild("main")

# ---- Feature toggles ----
ENABLE_OTHER_ALERTS = False

# ===========================================================
# Debounced mapper push
# ===========================================================

_push_timer = None
_push_timer_lock = threading.Lock()
PUSH_DEBOUNCE_SEC = 2.0


def schedule_mapper_push():
    """Debounce: wait PUSH_DEBOUNCE_SEC then push once."""
    global _push_timer
    with _push_timer_lock:
        if _push_timer is not None:
            _push_timer.cancel()
        _push_timer = threading.Timer(PUSH_DEBOUNCE_SEC, _do_mapper_push)
        _push_timer.daemon = True
        _push_timer.start()


def _do_mapper_push():
    try:
        pts = utils._collect_mapper_points()
        if pts:
            sync_mapper_circles(pts)
            log.info(f"Debounced push: {len(pts)} circles")
    except Exception as e:
        log.error(f"Debounced push error: {e}")


def mapper_push_loop():
    """Periodic background sync (runs every MAPPER_SYNC_EVERY_SEC)."""
    while True:
        try:
            pts = utils._collect_mapper_points()
            if pts:
                sync_mapper_circles(pts)
                log.info(f"Periodic sync: {len(pts)} circles")
        except Exception as e:
            log.error(f"Periodic sync error: {e}")
        time.sleep(cfg.MAPPER_SYNC_EVERY_SEC)


# ===========================================================
# Entry point
# ===========================================================

def main():
    log.info("=" * 50)
    log.info("  Sqkii Mapper 2 — Starting up...")
    log.info("=" * 50)

    # ---- Load persistent state ----
    utils.load_authorized_users()
    utils.load_track_state()
    utils.load_mrt_stations(cfg.MRT_CSV_PATH)
    utils.load_sent_coins()

    # ---- Start Chrome ----
    driver = setup_chrome_driver_safe()

    # ---- Background threads ----
    threading.Thread(target=check_telegram_messages, daemon=True, name="TelegramPoll").start()
    threading.Thread(target=auto_refresh, args=(driver,), daemon=True, name="AutoRefresh").start()
    if ENABLE_OTHER_ALERTS:
        threading.Thread(target=run_other_alerts_loop, daemon=True, name="OtherAlerts").start()
    else:
        log.info("Other alerts disabled in main.py")
    if cfg.ENABLE_SCHEDULED_AI_BROADCASTS:
        threading.Thread(target=scheduled_ai_broadcast_loop, daemon=True, name="AIBroadcastLoop").start()
    else:
        log.info("Scheduled AI broadcasts disabled in config")
    threading.Thread(target=mapper_push_loop, daemon=True, name="MapperPushLoop").start()
    threading.Thread(
        target=mapper_sync_loop,
        args=(utils._collect_mapper_points,),
        daemon=True,
        name="MapperSyncLoop",
    ).start()

    log.info("All background threads started. Entering API monitor...")

    # ---- Main loop ----
    monitor_api(driver)


if __name__ == "__main__":
    main()
