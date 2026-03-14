# ===========================================================
# scraper.py — Chrome headless scraper + API monitor
# ===========================================================
import os
import json
import time
import base64
import traceback
from datetime import datetime

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium_stealth import stealth

import config as cfg
import state
import utils
import map_renderer
import telegram_bot
from excel_logger import log_shrink
from mapper_sync import sync_mapper_circles

log = cfg.log.getChild("scraper")


# ===========================================================
# Chrome setup
# ===========================================================

def setup_chrome_driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--use-gl=swiftshader")
    options.add_argument("window-size=375,375")
    options.add_argument("user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 13_6 like Mac OS X)")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    options.add_argument("--disable-gpu-compositing")
    options.add_argument("--disable-gl-drawing-for-tests")
    options.add_argument("--disable-usb")
    options.add_argument("--disable-webgl")
    options.add_argument("--log-level=3")
    options.add_argument("--disable-extensions")
    options.add_argument("--blink-settings=imagesEnabled=false")

    driver = webdriver.Chrome(options=options)
    stealth(driver, languages=["en-US", "en"], vendor="Google Inc.", platform="Win32",
            webgl_vendor="Intel Inc.", renderer="Intel Iris OpenGL Engine", fix_hairline=True)
    try:
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Page.enable", {})
    except Exception:
        pass
    driver.get("https://huntthemouse.sqkii.com/")
    return driver


def setup_chrome_driver_safe():
    """Setup Chrome with auto-retry on failure."""
    max_retries = 5
    for attempt in range(1, max_retries + 1):
        try:
            driver = setup_chrome_driver()
            log.info(f"Chrome driver started (attempt {attempt})")
            return driver
        except Exception as e:
            log.error(f"Chrome setup failed (attempt {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                time.sleep(min(2 ** attempt, 30))
            else:
                raise


# ===========================================================
# Auto-refresh
# ===========================================================

def auto_refresh(driver):
    while True:
        try:
            driver.refresh()
            log.info("Auto-refreshed browser")
        except Exception as e:
            log.error(f"Refresh error: {e}")
        time.sleep(60)


# ===========================================================
# API Monitor (with Chrome auto-restart)
# ===========================================================

def monitor_api(driver):
    seen = set()

    while True:
        try:
            entries = []
            try:
                entries = driver.get_log("performance")
            except Exception as e:
                log.warning(f"PerfLog error: {repr(e)}")
                time.sleep(1)
                continue

            present_ids_this_cycle = set()

            for entry in entries:
                try:
                    raw = entry.get("message")
                    if not raw:
                        continue
                    outer = json.loads(raw)
                    msg = outer.get("message", {})
                except Exception:
                    continue

                method = msg.get("method", "")
                if method != "Network.responseReceived":
                    continue

                params = msg.get("params", {})
                resp = params.get("response", {})
                url = resp.get("url", "") or ""
                if "/api/silver" not in url:
                    continue

                req_id = params.get("requestId")
                if not req_id or req_id in seen:
                    continue
                seen.add(req_id)

                body_text = None
                try:
                    result = driver.execute_cdp_cmd('Network.getResponseBody', {'requestId': req_id})
                    if result.get('base64Encoded'):
                        body_text = base64.b64decode(result.get('body', "")).decode('utf-8', errors='replace')
                    else:
                        body_text = result.get('body', "")
                except Exception:
                    continue

                if not body_text:
                    continue

                try:
                    parsed = json.loads(body_text)
                except Exception:
                    continue

                data = parsed.get("data", parsed)
                if isinstance(data, dict):
                    data = list(data.values())
                elif not isinstance(data, list):
                    data = []

                state.latest_api_silver_data = {"data": data}

                # Boot: seed smallest coins silently
                if state._startup_suppress_alerts:
                    utils._seed_smallest_from_boot(data)
                    state._startup_suppress_alerts = False
                    log.info("First api/silver snapshot processed — new-drop alerts enabled.")

                # Process each item
                for i, item in enumerate(data):
                    try:
                        if i < cfg.ignored_first_n:
                            continue

                        coin_id = str(item.get("coin_id", "")).strip()
                        status = item.get("status")
                        if not coin_id or not status:
                            continue
                        present_ids_this_cycle.add(coin_id)

                        label = utils.display_label(coin_id, item)
                        prev_status = state.ongoing_status_map.get(coin_id)
                        state.ongoing_status_map[coin_id] = status
                        state.ongoing_coin_data[coin_id] = item

                        # Excel log
                        try:
                            log_shrink(
                                item,
                                xlsx_path=cfg.EXCEL_PATH,
                                status_filter=("ongoing", "verifying"),
                                only_when_changed=True
                            )
                        except Exception as e:
                            log.error(f"Excel log error: {e}")

                        # TRACK: notify shrink
                        try:
                            if status == "ongoing":
                                fc = item.get("freeCircle") or {}
                                ctr = (fc.get("center") or {})
                                new_lat = ctr.get("lat"); new_lng = ctr.get("lng"); new_r = fc.get("radius")
                                if new_lat and new_lng and new_r:
                                    with state.track_state_lock:
                                        subs = list(state.track_subscribers.get(coin_id, []))
                                        prev = state.track_last_circle.get(coin_id)
                                    if subs:
                                        if prev is None:
                                            with state.track_state_lock:
                                                state.track_last_circle[coin_id] = {"lat": float(new_lat), "lng": float(new_lng), "radius": float(new_r)}
                                                utils.save_track_state()
                                        else:
                                            prev_r = float(prev.get("radius", 0.0))
                                            new_r = float(new_r)
                                            if new_r < prev_r - 0.9:
                                                prev_circle = {"lat": float(prev.get("lat", new_lat)),
                                                               "lng": float(prev.get("lng", new_lng)),
                                                               "radius": prev_r}
                                                new_circle = {"lat": float(new_lat), "lng": float(new_lng), "radius": new_r}
                                                img = map_renderer.download_static_map_dual_circle(coin_id, prev_circle, new_circle)

                                                delta = prev_r - new_r
                                                label_safe = utils.md_escape(label)
                                                when = datetime.now().strftime("%I:%M %p")

                                                cap = f"🪙 *{label_safe}*\n📉 {int(prev_r)}m → {int(new_r)}m  (−{int(delta)}m)\n⏱️ {when}"
                                                for sub_chat in subs:
                                                    if img and os.path.exists(img):
                                                        telegram_bot.send_photo(img, cap, sub_chat, token=cfg.TELEGRAM_TOKEN)
                                                    else:
                                                        telegram_bot.send_telegram_message(cap, sub_chat)

                                                with state.track_state_lock:
                                                    state.track_last_circle[coin_id] = {"lat": float(new_lat), "lng": float(new_lng), "radius": float(new_r)}
                                                    utils.save_track_state()
                        except Exception as e:
                            log.error(f"TRACK notify error: {repr(e)}")

                        # NEW DROP alert
                        try:
                            is_transition_to_ongoing = (prev_status is not None and prev_status != "ongoing" and status == "ongoing")
                            is_first_seen_as_ongoing = (prev_status is None and status == "ongoing" and not state._startup_suppress_alerts)
                            if (is_transition_to_ongoing or is_first_seen_as_ongoing) and (coin_id not in state.sent_coin_ids) and (status == "ongoing"):
                                fc = item.get("freeCircle") or {}
                                ctr = fc.get("center") or {}
                                lat = ctr.get("lat"); lng = ctr.get("lng"); radius = fc.get("radius")
                                location_name = utils.reverse_geocode(lat, lng) if (lat and lng) else "Unknown location"
                                mrt_name, mrt_dist = utils.get_nearest_mrt(lat, lng) if (lat and lng) else ("-", 0)
                                mrt_type = utils.get_mrt_type(mrt_name)
                                reward = item.get("reward", "Unknown reward")
                                safe_label = label.replace('*', '\\*').replace('_', '\\_')

                                alert = (
                                    f"\U0001FA99 *NEW COIN DROPPED! ({reward})*\n"
                                    f"*{safe_label}*\n"
                                    + (f"`lat: {lat:.6f}, lng: {lng:.6f}`\n" if (lat and lng) else "")
                                    + (f"`radius: {radius}m`\n" if radius else "")
                                    + (f"_Approx. area: {location_name}_\n" if (lat and lng) else "")
                                    + (f"🚉 Nearest {mrt_type}: {mrt_name} ({mrt_dist}m away)\n" if (lat and lng) else "")
                                    + (f"📍 [See Location](https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m)\n" if (lat and lng) else "")
                                )

                                img_path = None
                                try:
                                    if lat and lng and radius:
                                        img_path = map_renderer.download_static_map_image(lat, lng, f"new_{coin_id}", radius)
                                except Exception as e:
                                    log.error(f"Map image error: {repr(e)}")

                                if img_path and os.path.exists(img_path):
                                    telegram_bot.send_photo(img_path, f"📍 {label}", cfg.TELEGRAM_CHAT_ID, cfg.TELEGRAM_TOKEN)
                                telegram_bot.send_telegram_message(alert)
                                log.info(f"SENT new coin alert: {label}")
                                state.sent_coin_ids.add(coin_id)
                                utils.save_sent_coins()
                        except Exception as e:
                            log.error(f"NEW DROP error: {repr(e)}")

                        # Smallest public circle
                        try:
                            if status == "ongoing" and item.get("is_smallest_public_circle", False) and coin_id not in state.notified_smallest_ids:
                                fc = item.get("freeCircle") or {}
                                ctr = fc.get("center") or {}
                                lat = ctr.get("lat"); lng = ctr.get("lng"); radius = fc.get("radius")
                                message = f"🔍 *{label}* has reached its *smallest public circle!*\nThis coin can now be sonared.\n"
                                if lat and lng and radius:
                                    message += f"`lat: {lat:.6f}, lng: {lng:.6f}`\n`radius: {radius}m`\n📍 [See Map](https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m)"
                                    state.smallest_circle_data[coin_id] = {
                                        "brand_name": item.get("brand_name"),
                                        "coin_number": item.get("coin_number"),
                                        "lat": lat, "lng": lng, "radius": radius,
                                        "timestamp": datetime.now(),
                                    }
                                    try:
                                        img = map_renderer.download_static_map_image(lat, lng, f"smallest_{coin_id}", radius)
                                        if img:
                                            state.smallest_circle_data[coin_id]["screenshot"] = img
                                            telegram_bot.send_photo(img, f"{label} (Smallest Circle)", cfg.TELEGRAM_CHAT_ID, cfg.TELEGRAM_TOKEN)
                                    except Exception as e:
                                        log.error(f"Smallest image error: {repr(e)}")
                                telegram_bot.send_telegram_message(message.strip(), cfg.TELEGRAM_CHAT_ID)
                                state.notified_smallest_ids.add(coin_id)
                                utils.save_track_state()
                        except Exception as e:
                            log.error(f"Smallest block error: {repr(e)}")

                        # Forfeited
                        try:
                            if status == "forfeited":
                                state.forfeited_coin_ids.add(coin_id)
                                c = item.get("circle") or {}
                                ctr = c.get("center") or {}
                                state.forfeited_coin_data[coin_id] = {
                                    "label": label,
                                    "lat": ctr.get("lat"),
                                    "lng": ctr.get("lng"),
                                    "radius": c.get("radius"),
                                }
                        except Exception as e:
                            log.error(f"Forfeit error: {repr(e)}")

                        # Verifying transition
                        try:
                            if prev_status == "ongoing" and status == "verifying":
                                circ = (item.get("freeCircle") or item.get("circle") or {})
                                ctr = (circ.get("center") or {})
                                lat = ctr.get("lat"); lng = ctr.get("lng")
                                if lat is None or lng is None:
                                    cached = state.ongoing_coin_data.get(coin_id, {})
                                    c2 = (cached.get("freeCircle") or cached.get("circle") or {})
                                    ctr2 = (c2.get("center") or {})
                                    lat = ctr2.get("lat", lat)
                                    lng = ctr2.get("lng", lng)
                                extra = ""
                                if lat is not None and lng is not None:
                                    mrt_name, dist_m = utils.get_nearest_mrt(float(lat), float(lng))
                                    if mrt_name:
                                        extra = f" ({mrt_name})"
                                telegram_bot.send_telegram_message(f"✅ *Coin has been Found!*\n*{label}{extra}*")
                        except Exception as e:
                            log.error(f"Found notify error: {repr(e)}")

                        # End tracking
                        try:
                            if status in ("verifying", "found", "forfeited"):
                                with state.track_state_lock:
                                    subs = list(state.track_subscribers.pop(coin_id, []))
                                    state.track_last_circle.pop(coin_id, None)
                                    utils.save_track_state()
                                if subs:
                                    label_safe = utils.md_escape(label)
                                    status_txt = "found" if status in ("verifying", "found") else "forfeited"
                                    for sub_chat in subs:
                                        telegram_bot.send_telegram_message(f"🛑 Stopped tracking *{label_safe}* — status changed to `{status_txt}`.", sub_chat)
                        except Exception as e:
                            log.error(f"TRACK end error: {repr(e)}")

                        # Winner info
                        try:
                            if status in ("verifying", "found"):
                                winner = item.get("winner_info") or {}
                                first = winner.get("first_name", "") or ""
                                last = winner.get("last_name", "") or ""
                                name = (f"{first} {last}").strip() if (first or last) else "NAME NOT YET FILLED"
                                state.winner_names_record[coin_id] = name
                        except Exception as e:
                            log.error(f"Winner error: {repr(e)}")

                    except Exception as per_item_ex:
                        log.error(f"Per-item error: {repr(per_item_ex)}")
                        continue

            # Post-cycle processing
            if present_ids_this_cycle:
                utils._prune_vanished_verifying(present_ids_this_cycle)

                sig_now = utils._points_signature()

                # Boot-sync: push immediately once
                if not state._mapper_boot_synced_once and sig_now:
                    try:
                        pts_now = utils._collect_mapper_points()
                        if pts_now:
                            sync_mapper_circles(pts_now)
                            state._mapper_last_sig = sig_now
                            state._mapper_boot_synced_once = True
                            log.info(f"Boot-sync: pushed {len(pts_now)} circles")
                    except Exception as e:
                        log.error(f"Boot-sync error: {e}")

                # After boot: push only when data changes
                elif state._mapper_boot_synced_once and sig_now and sig_now != state._mapper_last_sig:
                    state._mapper_last_sig = sig_now
                    # Import schedule_mapper_push from main to avoid circular at module level
                    try:
                        import main as _main
                        _main.schedule_mapper_push()
                    except Exception:
                        pass

        except Exception as e:
            log.error(f"Monitor error: {repr(e)}")
            traceback.print_exc()

        time.sleep(1.0)


def monitor_api_with_restart():
    """Wraps monitor_api with Chrome auto-restart on crash."""
    driver = None
    while True:
        try:
            if driver is None:
                driver = setup_chrome_driver_safe()
            monitor_api(driver)
        except Exception as e:
            log.error(f"Chrome crashed, restarting: {e}")
            try:
                if driver:
                    driver.quit()
            except Exception:
                pass
            driver = None
            time.sleep(5)
