# ===========================================================
# telegram_bot.py — Telegram bot polling + all command handlers
# ===========================================================
import os
import re
import json
import math
import time
import threading

import config as cfg
import state
import utils
import map_renderer
import ai_assistant

log = cfg.log.getChild("telegram")


# ===========================================================
# Telegram API helpers
# ===========================================================

def send_telegram_message(text, chat_id=None, keyboard=None, token=None):
    chat_id = chat_id or cfg.TELEGRAM_CHAT_ID
    token = token or cfg.TELEGRAM_TOKEN
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": False
    }
    if keyboard:
        payload["reply_markup"] = keyboard

    response = cfg.POST(url, json=payload)

    if response.status_code == 400 and "parse entities" in response.text.lower():
        payload2 = dict(payload)
        payload2.pop("parse_mode", None)
        response = cfg.POST(url, json=payload2)

    if response.status_code == 429:
        retry_after = response.json().get("parameters", {}).get("retry_after", 5)
        log.warning(f"Telegram 429 — retry after {retry_after}s")
        time.sleep(retry_after)
        return send_telegram_message(text, chat_id=chat_id, keyboard=keyboard, token=token)

    if not response.ok:
        log.error(f"Telegram error: {response.text}")

    return response


def send_photo(image_path, caption, chat_id, token=None, tries=6):
    token = token or cfg.TELEGRAM_TOKEN
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    if not os.path.exists(image_path):
        log.warning(f"sendPhoto missing: {image_path}")
        return None
    for a in range(1, tries + 1):
        try:
            with open(image_path, "rb") as img:
                r = cfg.POST(url, data={"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"},
                             files={"photo": img})
            if r.status_code == 200:
                return r
            if r.status_code == 400 and "parse entities" in r.text.lower():
                with open(image_path, "rb") as img:
                    r2 = cfg.POST(url, data={"chat_id": chat_id, "caption": caption}, files={"photo": img})
                return r2 if r2.status_code == 200 else r2
            if r.status_code == 429:
                try:
                    ra = float(r.json().get("parameters", {}).get("retry_after", 1))
                except Exception:
                    ra = 1.0
                time.sleep(ra)
                continue
            if 500 <= r.status_code < 600:
                time.sleep(min(2**a, 30))
                continue
            log.warning(f"sendPhoto {r.status_code}: {r.text}")
            return r
        except Exception as e:
            log.error(f"sendPhoto error: {e}")
            time.sleep(min(2**a, 30))
    log.error(f"sendPhoto failed after {tries} tries: {image_path}")
    return None


def send_document(file_path, caption, chat_id, token=None, tries=4):
    token = token or cfg.TELEGRAM_TOKEN
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    if not os.path.exists(file_path):
        log.warning(f"sendDocument missing: {file_path}")
        return None
    for a in range(1, tries + 1):
        try:
            with open(file_path, "rb") as doc:
                r = cfg.POST(url, data={"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"},
                             files={"document": doc})
            if r.status_code == 200:
                return r
            if r.status_code == 400 and "parse entities" in r.text.lower():
                with open(file_path, "rb") as doc:
                    r2 = cfg.POST(url, data={"chat_id": chat_id, "caption": caption}, files={"document": doc})
                return r2 if r2.status_code == 200 else r2
            if r.status_code == 429:
                try:
                    ra = float(r.json().get("parameters", {}).get("retry_after", 1))
                except Exception:
                    ra = 1.0
                time.sleep(ra)
                continue
            if 500 <= r.status_code < 600:
                time.sleep(min(2**a, 30))
                continue
            log.warning(f"sendDocument {r.status_code}: {r.text}")
            return r
        except Exception as e:
            log.error(f"sendDocument error: {e}")
            time.sleep(min(2**a, 30))
    log.error(f"sendDocument failed after {tries} tries: {file_path}")
    return None


def answer_callback(callback_query_id: str, text: str | None = None,
                    show_alert: bool = False, token=None):
    token = token or cfg.TELEGRAM_TOKEN
    try:
        url = f"https://api.telegram.org/bot{token}/answerCallbackQuery"
        payload = {"callback_query_id": callback_query_id}
        if text:
            payload["text"] = text
        if show_alert:
            payload["show_alert"] = True
        return cfg.POST(url, json=payload)
    except Exception as e:
        log.error(f"answerCallbackQuery error: {e}")
        return None


def edit_reply_markup(chat_id: int, message_id: int, keyboard: dict, token=None):
    token = token or cfg.TELEGRAM_TOKEN
    try:
        url = f"https://api.telegram.org/bot{token}/editMessageReplyMarkup"
        payload = {"chat_id": chat_id, "message_id": message_id, "reply_markup": keyboard}
        r = cfg.POST(url, json=payload)
        if not r.ok:
            log.warning(f"editMessageReplyMarkup error: {r.status_code} {r.text[:200]}")
        return r
    except Exception as e:
        log.error(f"edit_reply_markup error: {e}")
        return None


def prompt_login(chat_id):
    send_telegram_message(
        "🔐 Password required. Please log in with:\n`/login your_password`🛡️\n\n"
        "Don't know the password? Please contact the owner. 🕵️",
        chat_id
    )


# ===========================================================
# Pagination helpers
# ===========================================================

def _paginate(items: list, page: int, per_page: int):
    total = len(items)
    total_pages = max(1, int(math.ceil(total / float(per_page)))) if total else 1
    page = max(0, min(int(page), total_pages - 1))
    start = page * per_page
    end = start + per_page
    return items[start:end], page, total_pages, total


def _nav_row(picker: str, page: int, total_pages: int):
    prev_cb = f"pg:{picker}:{page-1}" if page > 0 else "noop"
    next_cb = f"pg:{picker}:{page+1}" if page < (total_pages - 1) else "noop"
    return [
        {"text": "⬅️ Prev", "callback_data": prev_cb},
        {"text": f"{page+1}/{total_pages}", "callback_data": "noop"},
        {"text": "Next ➡️", "callback_data": next_cb},
    ]


# ===========================================================
# Picker keyboard builder
# ===========================================================

def build_picker_keyboard(picker: str, page: int = 0):
    picker = (picker or "").strip().lower()
    ids = []

    if picker == "coins":
        for coin_id, status in state.ongoing_status_map.items():
            if status == "ongoing":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label_with_reward(cid, data)
            tok = utils.make_token(cid, "ci")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("coins", page, total_pages))
        title = "🪙 *Ongoing Coins:*"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "shrink":
        for coin_id, data in state.ongoing_coin_data.items():
            if state.ongoing_status_map.get(coin_id) == "ongoing":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label_with_reward(cid, data)
            tok = utils.make_token(cid, "sh")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("shrink", page, total_pages))
        title = "📍 *Select a coin to start auto shrinking:*"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "gethint":
        for coin_id, data in state.ongoing_coin_data.items():
            if state.ongoing_status_map.get(coin_id) == "ongoing":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label(cid, data)
            tok = utils.make_token(cid, "gethint")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("gethint", page, total_pages))
        title = "📍 Select a coin to generate a silver coin hint (It may take some time, please be patient):"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "track":
        for coin_id, data in state.ongoing_coin_data.items():
            if state.ongoing_status_map.get(coin_id) == "ongoing":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label(cid, data)
            tok = utils.make_token(cid, "trk")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("track", page, total_pages))
        title = "📡 *Select a coin to track/untrack:*"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "shrinkbackup":
        for coin_id, data in state.ongoing_coin_data.items():
            if state.ongoing_status_map.get(coin_id) == "ongoing":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label(cid, data)
            tok = utils.make_token(cid, "sbs")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("shrinkbackup", page, total_pages))
        title = "📍 Select a coin to start BACKUP shrink automator:"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "scheduled":
        for coin_id, status in state.ongoing_status_map.items():
            if status == "scheduled":
                ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            data = state.ongoing_coin_data.get(cid, {})
            label = utils.display_label_with_reward(cid, data)
            tok = utils.make_token(cid, "ci")
            rows.append([{"text": label, "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("scheduled", page, total_pages))
        title = "📅 *Scheduled Coins:*"
        return title, {"inline_keyboard": rows} if rows else None

    if picker == "max":
        for coin_id, item in state.ongoing_coin_data.items():
            if state.ongoing_status_map.get(coin_id) != "ongoing":
                continue
            if not item.get("is_smallest_public_circle"):
                continue
            ids.append(str(coin_id))
        ids.sort(key=utils._sort_key_reward_first)
        page_ids, page, total_pages, total = _paginate(ids, page, cfg.PICKER_PAGE_SIZE)
        rows = []
        for cid in page_ids:
            item = state.ongoing_coin_data.get(cid, {})
            utils.ensure_smallest_cache(cid)
            data = state.smallest_circle_data.get(cid, {})
            label = utils.display_label(cid, item)
            rad_tag = utils._fmt_radius_tag(data.get("radius"))
            tok = utils.make_token(cid, "mx")
            rows.append([{"text": f"{label}{rad_tag}", "callback_data": tok}])
        if total_pages > 1:
            rows.append(_nav_row("max", page, total_pages))
        title = "🧭 *Coins at Smallest Public Circle:*"
        return title, {"inline_keyboard": rows} if rows else None

    return "⚠️ Unknown picker.", None


# ===========================================================
# Shared maxinfo handler (deduplicates mx: and maxinfo:)
# ===========================================================

def _handle_max_info(coin_id, chat_id, cb_id):
    """Common handler for both mx: and maxinfo: callbacks."""
    data = state.smallest_circle_data.get(coin_id) or utils.ensure_smallest_cache(coin_id)
    if not data:
        send_telegram_message("⚠️ Coin info not found.", chat_id, token=cfg.TELEGRAM_TOKEN)
        if cb_id:
            answer_callback(cb_id)
        return

    label = utils.display_label(coin_id, state.ongoing_coin_data.get(coin_id, data))
    lat = data.get("lat"); lng = data.get("lng"); radius = data.get("radius")
    location = data.get("location") or utils.reverse_geocode(lat, lng)
    mrt, dist = utils.get_nearest_mrt(lat, lng)

    screenshot = data.get("screenshot")
    stored_radius = data.get("screenshot_radius")
    if (not screenshot) or (not os.path.exists(screenshot)) or (stored_radius != radius):
        try:
            screenshot = map_renderer.download_static_map_image(lat, lng, f"maxinfo_{coin_id}", radius=int(radius))
        except Exception as e:
            log.error(f"max screenshot error: {e}")
        if screenshot:
            data["screenshot"] = screenshot
            data["screenshot_radius"] = radius
            state.smallest_circle_data[coin_id] = data

    from datetime import datetime
    time_str = (data.get("timestamp") or datetime.now()).strftime("%I:%M %p")
    caption = (
        f"🟢 *{label} is currently at its smallest publicly viewable circle!*\n"
        f"*radius:*  `{int(radius)}m`\n"
        f"🚉 Nearest MRT: {mrt} ({dist}m away)\n"
        f"📍 [View Location](https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m)\n"
        f"⏱️ Updated: {time_str}"
    )

    if screenshot and os.path.exists(screenshot):
        send_photo(screenshot, caption, chat_id, token=cfg.TELEGRAM_TOKEN)
    else:
        send_telegram_message(caption, chat_id, token=cfg.TELEGRAM_TOKEN)

    if cb_id:
        answer_callback(cb_id)


# ===========================================================
# Main polling loop (with exponential backoff)
# ===========================================================

def check_telegram_messages():
    offset = None
    backoff = 1  # exponential backoff on error

    while True:
        try:
            url = f"https://api.telegram.org/bot{cfg.TELEGRAM_TOKEN}/getUpdates?timeout=25"
            if offset:
                url += f"&offset={offset}"
            resp = cfg.GET(url, timeout=60)
            data = resp.json()
            results = data.get("result", [])

            if not isinstance(results, list):
                log.error(f"Unexpected Telegram response: {data}")
                time.sleep(5)
                continue

            backoff = 1  # reset on success

            for result in results:
                offset = result["update_id"] + 1

                # --- Handle normal text commands ---
                if "message" in result:
                    message = result["message"]
                    msg = message.get("text", "").strip().lower()
                    from_chat_id = message.get("chat", {}).get("id")
                    user_id = message.get("from", {}).get("id")

                    # always allow /start and /login
                    if msg == "/start":
                        send_telegram_message(
                            "Welcome! 🔐 This bot requires a password. 🛡️\n"
                            "Please log in with `/login your_password`. 🧑‍💻",
                            from_chat_id
                        )
                        continue

                    # Location messages
                    if "location" in message:
                        try:
                            lat = float(message["location"]["latitude"])
                            lng = float(message["location"]["longitude"])
                            state.user_last_location[user_id] = (lat, lng, time.time())

                            if user_id in state.pending_plot_radius:
                                pradius = float(state.pending_plot_radius.pop(user_id))
                                send_telegram_message("🗺️ Using your current location…", from_chat_id)
                                try:
                                    png_path = map_renderer.geoapify_static_circle_image(
                                        lat, lng, pradius,
                                        width=1600, height=1200,
                                        padding_px=110, supersample=3,
                                        api_scale=1, style="osm-carto"
                                    )
                                except Exception as e:
                                    log.error(f"/plot current error: {e}")
                                    png_path = None

                                cap = f"📍 Custom circle\n`lat: {lat:.6f}, lng: {lng:.6f}`\n`radius: {int(pradius)}m`"
                                if png_path and os.path.exists(png_path):
                                    send_photo(png_path, cap, from_chat_id, token=cfg.TELEGRAM_TOKEN)
                                else:
                                    send_telegram_message(cap + "\n(⚠️ screenshot failed)", from_chat_id)
                            else:
                                send_telegram_message("✅ Saved your current location. You can now use `/plot current,500`.", from_chat_id)
                        except Exception as e:
                            log.error(f"Location parse error: {e}")

                    if msg.startswith("/login"):
                        parts = message.get("text", "").split(maxsplit=1)
                        if len(parts) < 2:
                            send_telegram_message("Usage: `/login your_password`", from_chat_id)
                            continue
                        entered = parts[1].strip()
                        if entered == cfg.BOT_PASSWORD:
                            state.authorized_users.add(user_id)
                            utils.save_authorized_users()
                            send_telegram_message("✅ 🔑Access granted. You're whitelisted! 🪪", from_chat_id)
                        else:
                            send_telegram_message("❌ Wrong password. Try again 😡.", from_chat_id)
                        continue

                    # block if not authorized
                    if not utils.is_authorized(user_id):
                        prompt_login(from_chat_id)
                        continue

                    # Maintenance toggle
                    if msg.startswith("/offwk30") or msg.startswith("/onwk30"):
                        parts = message.get("text", "").split(maxsplit=1)
                        if msg.startswith("/offwk30"):
                            if len(parts) < 2 or parts[1].strip() != cfg.MAINTENANCE_PASSWORD:
                                send_telegram_message("❌ Wrong password to enable maintenance mode.", from_chat_id)
                                continue
                            state.MAINTENANCE_MODE = True
                            send_telegram_message("🔧 Maintenance mode ENABLED. All commands are now disabled for other users.", from_chat_id)
                        elif msg.startswith("/onwk30"):
                            if len(parts) < 2 or parts[1].strip() != cfg.MAINTENANCE_PASSWORD:
                                send_telegram_message("❌ Wrong password to disable maintenance mode.", from_chat_id)
                                continue
                            state.MAINTENANCE_MODE = False
                            send_telegram_message("✅ Maintenance mode DISABLED. All commands are now available again.", from_chat_id)
                        continue

                    if msg.startswith("/"):
                        msg = msg.split("@")[0]

                    if msg == "/help":
                        help_text = (
                            "🛠️ 🐭 *Available Commands:*\n"
                            "/coins - List all available coins to be found\n"
                            "/scheduled - List all scheduled coins and their circles\n"
                            "/shrink - (Beta) Start Enhanced crystal shrink automater on a selected coin\n"
                            "/gethint - Generate a silver coin hint on a selected coin\n"
                            "/shrinkbackup - (Beta) Start the crystal shrink automator on a selected coin\n"
                            "/plot - Plot a custom circle: /plot LAT,LNG,RADIUS (meters)\n"
                            "/track - Track the shrink of a selected circle of a coin real time\n"
                            "/verifying - Check for verifying circles and the winner's name\n"
                            "/max - Show coins that have reached smallest public shrink, and can be sonared\n"
                            "/leaderboard - Show top 15 winners by name\n"
                            "/forfeit - Check the location of forfeited coins\n"
                            "/ask - Ask Sqkii AI any question. Enter /ask...[Your Question]\n"
                            "/weather - Check for any rain across Singapore\n"
                            "/status - Check for the status of bot and coin map\n"
                            "/help - Show this help message"
                        )
                        send_telegram_message(help_text, from_chat_id)

                    elif msg == "/shrink":
                        title, keyboard = build_picker_keyboard("shrink", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("📍 There are no coins available for shrink currently.", from_chat_id)

                    elif msg == "/gethint":
                        title, keyboard = build_picker_keyboard("gethint", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("📍 There are no coins available for shrink currently.", from_chat_id)

                    elif msg == "/shrinkbackup":
                        title, keyboard = build_picker_keyboard("shrinkbackup", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("📍 There are no coins available for shrink currently.", from_chat_id)

                    elif msg == "/plot" or msg.startswith("/plot "):
                        full_text = message.get("text", "").strip()
                        m = re.search(
                            r"/plot\s+([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+]?\d+(?:\.\d+)?)",
                            full_text, flags=re.I
                        )
                        mc = re.search(
                            r"/plot\s+(current|here)\s*[, ]\s*([+]?\d+(?:\.\d+)?)\s*$",
                            full_text, flags=re.I
                        )

                        if m:
                            try:
                                plat = float(m.group(1)); plng = float(m.group(2)); pradius = float(m.group(3))
                            except Exception:
                                send_telegram_message("Could not parse numbers. Try: /plot 1.443183,103.825074,1152", from_chat_id)
                                continue
                            if not (-90.0 <= plat <= 90.0 and -180.0 <= plng <= 180.0 and pradius > 0):
                                send_telegram_message("Values out of range.", from_chat_id)
                                continue
                            send_telegram_message("🗺️ Plotting custom circle...", from_chat_id)
                            try:
                                png_path = map_renderer.geoapify_static_circle_image(
                                    plat, plng, pradius,
                                    width=1600, height=1200,
                                    padding_px=110, supersample=3,
                                    api_scale=1, style="osm-carto"
                                )
                            except Exception as e:
                                log.error(f"/plot geoapify error: {e}")
                                png_path = None
                            cap = f"📍 Custom circle\n`lat: {plat:.6f}, lng: {plng:.6f}`\n`radius: {int(pradius)}m`"
                            if png_path and os.path.exists(png_path):
                                send_photo(png_path, cap, from_chat_id, token=cfg.TELEGRAM_TOKEN)
                            else:
                                send_telegram_message(cap + "\n(⚠️ screenshot failed)", from_chat_id)
                            continue

                        elif mc:
                            pradius = float(mc.group(2))
                            if pradius <= 0:
                                send_telegram_message("Radius must be > 0.", from_chat_id)
                                continue
                            last = state.user_last_location.get(user_id)
                            if last:
                                plat, plng, _ts = last
                                send_telegram_message("🗺️ Using your last shared location…", from_chat_id)
                                try:
                                    png_path = map_renderer.geoapify_static_circle_image(
                                        plat, plng, pradius,
                                        width=1600, height=1200,
                                        padding_px=110, supersample=3,
                                        api_scale=1, style="osm-carto"
                                    )
                                except Exception as e:
                                    log.error(f"/plot current error: {e}")
                                    png_path = None
                                cap = f"📍 Custom circle\n`lat: {plat:.6f}, lng: {plng:.6f}`\n`radius: {int(pradius)}m`"
                                if png_path and os.path.exists(png_path):
                                    send_photo(png_path, cap, from_chat_id, token=cfg.TELEGRAM_TOKEN)
                                else:
                                    send_telegram_message(cap + "\n(⚠️ screenshot failed)", from_chat_id)
                                continue
                            state.pending_plot_radius[user_id] = pradius
                            keyboard = {
                                "keyboard": [[{"text": "📍 Send current location", "request_location": True}]],
                                "resize_keyboard": True,
                                "one_time_keyboard": True
                            }
                            send_telegram_message(
                                "Please tap the button below to share your current location, then I'll plot the circle.",
                                from_chat_id, keyboard=keyboard
                            )
                            continue
                        else:
                            send_telegram_message(
                                "Usage:\n"
                                "/plot LAT,LNG,RADIUS_M  (e.g. /plot 1.443183,103.825074,1152)\n"
                                "or\n"
                                "/plot current,RADIUS_M  (e.g. /plot current,600)\n\n"
                                "Tip: Tap the '📍 Send current location' button when prompted.",
                                from_chat_id
                            )
                            continue

                    elif msg == "/forfeit":
                        response = "🚫 *Forfeited Coins:*\n"
                        found = False
                        for coin_id in state.forfeited_coin_ids:
                            data = state.forfeited_coin_data.get(coin_id, {})
                            label = data.get("label", utils.parse_location_name(coin_id))
                            lat = data.get("lat"); lng = data.get("lng"); radius = data.get("radius")
                            response += f"*{label}*\n"
                            if lat and lng and radius:
                                location_name = utils.reverse_geocode(lat, lng)
                                mrt_name, mrt_dist = utils.get_nearest_mrt(lat, lng)
                                mrt_type = utils.get_mrt_type(mrt_name)
                                response += f"`lat: {lat:.6f}, lng: {lng:.6f}`\n"
                                response += f"`radius: {radius}m`\n"
                                response += f"_Approx. area: {location_name}_\n"
                                response += f"🚉 Nearest {mrt_type}: {mrt_name} ({mrt_dist}m away)\n"
                                response += f"📍 [See Location](https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m)\n"
                            else:
                                response += "_(No location data)_\n"
                            found = True
                        if not found:
                            response = "No forfeited coins at the moment."
                        send_telegram_message(response.strip(), from_chat_id)

                    elif msg == "/verifying":
                        response = "🔍 🐁 *Verifying Coins:*\n"
                        found = False
                        for coin_id, status in state.ongoing_status_map.items():
                            if status == "verifying":
                                label = utils.display_label(coin_id, state.ongoing_coin_data.get(coin_id))
                                name = state.winner_names_record.get(coin_id, "NOT FILLED YET")
                                response += f"*{label}*: → {name}\n"
                                found = True
                        if not found:
                            response = "No verifying coins at the moment."
                        send_telegram_message(response.strip(), from_chat_id)

                    elif msg == "/track":
                        title, keyboard = build_picker_keyboard("track", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("📡 There are no ongoing coins to track currently.", from_chat_id)

                    elif msg == "/leaderboard":
                        counts, display = utils.load_winner_counts(cfg.WINNERS_FILE)
                        text = utils.render_leaderboard_from_counts(counts, display, top_n=30)
                        send_telegram_message(text, from_chat_id)

                    elif msg == "/max":
                        title, keyboard = build_picker_keyboard("max", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard, token=cfg.TELEGRAM_TOKEN)
                        else:
                            send_telegram_message("🧭 No coins are at their smallest public circle currently.", from_chat_id, token=cfg.TELEGRAM_TOKEN)

                    elif msg == "/coins":
                        title, keyboard = build_picker_keyboard("coins", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("🪙 No ongoing coins found.", from_chat_id)

                    elif msg == "/scheduled":
                        title, keyboard = build_picker_keyboard("scheduled", page=0)
                        if keyboard:
                            send_telegram_message(title, from_chat_id, keyboard=keyboard)
                        else:
                            send_telegram_message("📅 No scheduled coins at the moment.", from_chat_id)

                    elif msg == "/ask2" or msg.startswith("/ask2 "):
                        query = message.get("text", "").strip()[5:].strip()
                        if not query:
                            send_telegram_message("❓ Please type a question after `/ask2`. For example: `/ask2 [What model of AI are you?]?`", from_chat_id)
                        else:
                            send_telegram_message("🤖 Google Gemini is Thinking...", from_chat_id)
                            reply = ai_assistant.chatgpt_response(query)
                            send_telegram_message(reply, from_chat_id)

                    elif msg == "/ask" or msg.startswith("/ask "):
                        query = message.get("text", "").strip()[4:].strip()
                        if not query:
                            send_telegram_message("❓ Please type a question after `/ask`. For example: `/ask [What model of AI are you?]`", from_chat_id)
                        else:
                            send_telegram_message("🤖 Sqkii AI is thinking... Please wait patiently (~10 seconds), Teehee!", from_chat_id)
                            full_prompt = ai_assistant.SQKII_PRE_PROMPT + query
                            reply = ai_assistant.openrouter_ask(full_prompt)
                            send_telegram_message(reply, from_chat_id)

                    elif msg == "/weather":
                        send_telegram_message("🌧️ Checking latest rainfall across Singapore...", from_chat_id)

                        def interpret_rainfall(value):
                            if value == 0:
                                return "☀️", "No rain"
                            elif value <= 1:
                                return "🌤️", "Very light rain"
                            elif value <= 2:
                                return "🌦️", "Light rain"
                            elif value <= 5:
                                return "🌧️", "Moderate rain"
                            elif value <= 10:
                                return "🌧️", "Heavy rain"
                            else:
                                return "⛈️", "Very heavy rain"

                        try:
                            rainfall_data, timestamp = utils.get_latest_rainfall_data()
                            if not rainfall_data:
                                send_telegram_message("☀️ *It's clear skies across Singapore right now!*\n✅ No rainfall detected in the last 5 minutes.", from_chat_id)
                            else:
                                message_text = "*🌦️ Rainfall Readings (last 5 min):*\n\n"
                                for name, value in rainfall_data:
                                    emoji, label = interpret_rainfall(value)
                                    message_text += f"{emoji} *{name}*: `{value:.1f} mm` ({label})\n"
                                message_text += f"\n🕒 _Last updated: {timestamp}_"
                                send_telegram_message(message_text.strip(), from_chat_id)
                        except Exception as e:
                            log.error(f"Weather error: {e}")
                            send_telegram_message("⚠️ Failed to retrieve rainfall data.", from_chat_id)

                    elif msg == "/status":
                        total = sum(1 for s in state.ongoing_status_map.values() if s == "ongoing")
                        scheduled = sum(1 for s in state.ongoing_status_map.values() if s == "scheduled")
                        verifying = sum(1 for s in state.ongoing_status_map.values() if s == "verifying")
                        forfeited = sum(1 for s in state.ongoing_status_map.values() if s == "forfeited")
                        tracks = sum(1 for subs in state.track_subscribers.values() for _ in subs)
                        send_telegram_message(
                            f"✅ Bot OK\n"
                            f"🪙 Ongoing: {total}\n"
                            f"📅 Scheduled: {scheduled}\n"
                            f"🔍 Verifying: {verifying}\n"
                            f"⛔ Forfeited: {forfeited}\n"
                            f"📡 Active track subscriptions: {tracks}",
                            from_chat_id
                        )

                # --- Handle button callback ---
                if "callback_query" in result:
                    callback = result["callback_query"]
                    callback_data = callback["data"]
                    chat_id = callback["message"]["chat"]["id"]
                    cb_id = callback.get("id")
                    message_id = callback.get("message", {}).get("message_id")
                    user_id = callback.get("from", {}).get("id")

                    if not utils.is_authorized(user_id):
                        prompt_login(chat_id)
                        if cb_id:
                            answer_callback(cb_id)
                        continue

                    if state.MAINTENANCE_MODE:
                        send_telegram_message(
                            "🔧 Sqkii Coin Alerts is undergoing maintenance and during this period, all commands will be unavailable.",
                            chat_id
                        )
                        if cb_id:
                            answer_callback(cb_id)
                        continue

                    if callback_data == "noop":
                        if cb_id:
                            answer_callback(cb_id)
                        continue

                    # Pagination
                    if callback_data.startswith("pg:"):
                        try:
                            _, picker, page_s = callback_data.split(":", 2)
                            page = int(page_s)
                            _title, keyboard = build_picker_keyboard(picker, page=page)
                            if keyboard and message_id is not None:
                                edit_reply_markup(chat_id, message_id, keyboard, token=cfg.TELEGRAM_TOKEN)
                        except Exception as e:
                            log.error(f"Pagination callback error: {e}")
                        if cb_id:
                            answer_callback(cb_id)
                        continue

                    # Max info (deduplicated)
                    if callback_data.startswith("mx:"):
                        coin_id = utils.resolve_token(callback_data, "mx")
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /max again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        _handle_max_info(coin_id, chat_id, cb_id)
                        continue

                    if callback_data.startswith("maxinfo:"):
                        coin_id = callback_data.split("maxinfo:", 1)[1].strip()
                        _handle_max_info(coin_id, chat_id, cb_id)
                        continue

                    # Shrink
                    elif callback_data.startswith("sh:"):
                        coin_id = utils.resolve_token(callback_data, "sh")
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /shrink again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        data = state.ongoing_coin_data.get(coin_id, {})
                        lat = data.get("freeCircle", {}).get("center", {}).get("lat")
                        lng = data.get("freeCircle", {}).get("center", {}).get("lng")
                        if lat and lng:
                            with open("shrink_target.json", "w") as f:
                                json.dump({"lat": lat, "lng": lng}, f)
                            label = utils.display_label(coin_id, data)
                            send_telegram_message(
                                f"📍 {label}\n"
                                f"🔮💎Enhanced crystal shrink automator will now run at `{label}`. Please wait... (110 seconds)",
                                chat_id
                            )
                            utils.launch_shrink_automater("shrink_mainhunt.py")
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        else:
                            send_telegram_message("⚠️ The selected coin cannot be shrunk.", chat_id)
                            if cb_id:
                                answer_callback(cb_id)

                    # Get hint
                    elif callback_data.startswith("gethint:"):
                        coin_id = utils.resolve_token(callback_data, "gethint")
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /gethint again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        data = state.ongoing_coin_data.get(coin_id, {})
                        lat = data.get("freeCircle", {}).get("center", {}).get("lat")
                        lng = data.get("freeCircle", {}).get("center", {}).get("lng")
                        if lat and lng:
                            with open("shrink_target.json", "w") as f:
                                json.dump({"lat": lat, "lng": lng}, f)
                            label = utils.display_label(coin_id, data)
                            send_telegram_message(
                                f"💎 Generating Silver Coin Hint for `{label}`. Please wait... (~120 seconds)",
                                chat_id
                            )
                            utils.launch_shrink_automater("gethint.py")
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        else:
                            send_telegram_message("⚠️ Unable to generate hint for the selected coin.", chat_id)
                            if cb_id:
                                answer_callback(cb_id)

                    # Shrink backup
                    elif callback_data.startswith("sbs:"):
                        coin_id = utils.resolve_token(callback_data, "sbs") or callback_data.split("sbs:", 1)[1]
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /shrinkbackup again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        data = state.ongoing_coin_data.get(coin_id, {})
                        lat = data.get("freeCircle", {}).get("center", {}).get("lat")
                        lng = data.get("freeCircle", {}).get("center", {}).get("lng")
                        if lat and lng:
                            with open("shrink_target.json", "w") as f:
                                json.dump({"lat": lat, "lng": lng}, f)
                            label = utils.display_label(coin_id, data)
                            send_telegram_message(
                                f"💎 Crystal shrink automator will now run at {label}. Please wait... (~30 seconds)",
                                chat_id
                            )
                            utils.launch_shrink_automater("shrink_mainhunt_backup.py")
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        else:
                            send_telegram_message("⚠️ The selected coin cannot be shrunk.", chat_id)
                            if cb_id:
                                answer_callback(cb_id)

                    # Track
                    elif callback_data.startswith("trk:"):
                        coin_id = utils.resolve_token(callback_data, "trk")
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /track again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        data = state.ongoing_coin_data.get(coin_id, {})
                        circle = data.get("freeCircle", {}) or {}
                        center = circle.get("center", {}) or {}
                        lat, lng, radius = center.get("lat"), center.get("lng"), circle.get("radius")
                        if not (lat and lng and radius):
                            send_telegram_message("⚠️ This coin doesn't have a trackable circle right now.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        label, label_safe = utils.display_label(coin_id, data), utils.md_escape(utils.display_label(coin_id, data))
                        with state.track_state_lock:
                            subs = state.track_subscribers.get(coin_id, set())
                            if subs:
                                # Untrack: remove ALL subscribers for this coin
                                all_subs = list(subs)
                                state.track_subscribers.pop(coin_id, None)
                                state.track_last_circle.pop(coin_id, None)
                                utils.save_track_state()
                        if subs:
                            for sub_chat in all_subs:
                                try:
                                    send_telegram_message(
                                        f"🛑 Stopped tracking *{label_safe}*.",
                                        sub_chat, token=cfg.TELEGRAM_TOKEN
                                    )
                                except Exception:
                                    pass
                        else:
                            with state.track_state_lock:
                                # Track: add this user as a subscriber
                                subs = state.track_subscribers.setdefault(coin_id, set())
                                subs.add(chat_id)
                                state.track_last_circle.setdefault(coin_id, {"lat": float(lat), "lng": float(lng), "radius": float(radius)})
                                utils.save_track_state()
                            send_telegram_message(
                                f"✅ Tracking *{label_safe}*.\nI'll alert you when it shrinks from `{int(radius)}m`.",
                                chat_id, token=cfg.TELEGRAM_TOKEN
                            )
                        if cb_id:
                            answer_callback(cb_id)
                        continue

                    # Coin info
                    elif callback_data.startswith("ci:"):
                        coin_id = utils.resolve_token(callback_data, "ci")
                        if not coin_id:
                            send_telegram_message("This button expired. Please run /coins again.", chat_id, token=cfg.TELEGRAM_TOKEN)
                            if cb_id:
                                answer_callback(cb_id)
                            continue
                        data = state.ongoing_coin_data.get(coin_id, {})
                        label = utils.display_label(coin_id, data)
                        status = state.ongoing_status_map.get(coin_id, "unknown")
                        circle = data.get("freeCircle") or data.get("circle") or {}
                        center = circle.get("center", {})
                        lat = center.get("lat"); lng = center.get("lng"); radius = circle.get("radius")
                        location = utils.reverse_geocode(lat, lng) if lat and lng else "Unknown location"
                        mrt, dist = utils.get_nearest_mrt(lat, lng) if lat and lng else ("-", 0)

                        screenshot = data.get("screenshot")
                        stored_radius = data.get("screenshot_radius")
                        if lat and lng and radius and (not screenshot or not os.path.exists(screenshot) or stored_radius != radius):
                            screenshot = map_renderer.download_static_map_image(lat, lng, f"coininfo_{coin_id}", radius)
                            if screenshot:
                                data["screenshot"] = screenshot
                                data["screenshot_radius"] = radius
                                state.ongoing_coin_data[coin_id] = data

                        # Format drop time for scheduled coins
                        drop_line = ""
                        if status == "scheduled" and data.get("start_at"):
                            try:
                                from datetime import datetime, timezone, timedelta
                                sgt = timezone(timedelta(hours=8))
                                start_utc = datetime.strptime(data["start_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
                                start_sgt = start_utc.astimezone(sgt)
                                drop_line = f"📅 *Drops:* `{start_sgt.strftime('%d %b %Y, %I:%M %p')} SGT`\n"
                            except Exception:
                                pass

                        caption = (
                            f"🪙 *{label}*\n"
                            f"*Status:* `{status}`\n"
                            + drop_line
                            + (f"*Radius:* `{radius}m`\n" if radius else "")
                            + (f"📍 Location: _{location}_\n" if lat and lng else "")
                            + (f"🚉 Nearest MRT: {mrt} ({dist}m away)\n" if lat and lng else "")
                            + (f"[Google Maps](https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m)" if lat and lng else "")
                        ).strip()

                        if screenshot and os.path.exists(screenshot):
                            send_photo(screenshot, caption, chat_id, token=cfg.TELEGRAM_TOKEN)
                        else:
                            send_telegram_message(caption, chat_id, token=cfg.TELEGRAM_TOKEN)
                        if cb_id:
                            answer_callback(cb_id)
                        continue

        except Exception as e:
            log.error(f"Telegram polling error: {e}")
            time.sleep(min(backoff, 30))
            backoff = min(backoff * 2, 30)  # exponential backoff, cap at 30s
        time.sleep(1)
