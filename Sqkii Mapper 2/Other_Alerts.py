import json
import os
import re
import time
from typing import Any

import config as cfg
import telegram_bot
import utils
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.common.exceptions import NoSuchWindowException, WebDriverException
from selenium_stealth import stealth

log = cfg.log.getChild("other_alerts")

_PAGE_BOOT_WAIT_SEC = 6
_CHECKPOINT_POLL_SEC = 2
_NETWORK_WAIT_SEC = 12
_TITLE_NUM_SUFFIX_RE = re.compile(r"\s+#\d+\s*$")
_COOKIE_DOMAIN = "www.greatgoldhunt.com"


def _setup_great_gold_hunt_driver():
    options = Options()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--use-gl=swiftshader")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-component-update")
    options.add_argument("--disable-domain-reliability")
    options.add_argument("--disable-sync")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--silent")
    options.add_argument("--log-level=3")
    options.add_argument("window-size=1280,900")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    )
    if cfg.GREAT_GOLD_HUNT_HEADLESS:
        options.add_argument("--headless=new")
    elif cfg.GREAT_GOLD_HUNT_START_MINIMIZED:
        options.add_argument("--start-minimized")

    if cfg.GREAT_GOLD_HUNT_BROWSER_BINARY and os.path.exists(cfg.GREAT_GOLD_HUNT_BROWSER_BINARY):
        options.binary_location = cfg.GREAT_GOLD_HUNT_BROWSER_BINARY
    options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    options.add_experimental_option("useAutomationExtension", False)
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

    service = ChromeService(log_output=os.devnull)
    driver = webdriver.Chrome(service=service, options=options)
    stealth(
        driver,
        languages=["en-US", "en"],
        vendor="Google Inc.",
        platform="Win32",
        webgl_vendor="Intel Inc.",
        renderer="Intel Iris OpenGL Engine",
        fix_hairline=True,
    )
    driver.set_page_load_timeout(30)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
            "source": """
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
            """
        },
    )
    try:
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Page.enable", {})
    except Exception:
        pass
    _minimize_window(driver)
    return driver


def _minimize_window(driver) -> None:
    if cfg.GREAT_GOLD_HUNT_HEADLESS or not cfg.GREAT_GOLD_HUNT_START_MINIMIZED:
        return
    try:
        driver.minimize_window()
    except Exception:
        pass


def _ensure_live_window(driver) -> None:
    try:
        handles = driver.window_handles
    except Exception as e:
        raise RuntimeError("Great Gold Hunt browser has no live windows.") from e

    if not handles:
        raise RuntimeError("Great Gold Hunt browser has no live windows.")

    candidates: list[tuple[str, str, str]] = []
    for handle in handles:
        try:
            driver.switch_to.window(handle)
            url = driver.current_url or ""
            title = driver.title or ""
            candidates.append((handle, url, title))
        except Exception:
            continue

    if not candidates:
        raise RuntimeError("Great Gold Hunt browser has no switchable windows.")

    for handle, url, _title in candidates:
        if "greatgoldhunt.com" in url:
            driver.switch_to.window(handle)
            return

    driver.switch_to.window(candidates[-1][0])


def _load_saved_cookies() -> list[dict[str, Any]]:
    path = cfg.GREAT_GOLD_HUNT_COOKIES_PATH
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        return [cookie for cookie in data if isinstance(cookie, dict) and cookie.get("name")]
    except Exception as e:
        log.error(f"Great Gold Hunt cookie load error: {e}")
        return []


def _save_cookies(driver) -> None:
    try:
        _ensure_live_window(driver)
        cookies = driver.get_cookies()
        with open(cfg.GREAT_GOLD_HUNT_COOKIES_PATH, "w", encoding="utf-8") as f:
            json.dump(cookies, f, ensure_ascii=False, indent=2)
        log.info(f"Saved {len(cookies)} Great Gold Hunt cookies.")
    except Exception as e:
        log.error(f"Great Gold Hunt cookie save error: {e}")


def _clear_performance_logs(driver) -> None:
    try:
        driver.get_log("performance")
    except Exception:
        pass


def _extract_payload_from_network(driver) -> list[dict[str, Any]] | None:
    try:
        entries = driver.get_log("performance")
    except Exception:
        return None

    request_ids: list[str] = []
    for entry in entries:
        try:
            outer = json.loads(entry.get("message", ""))
            msg = outer.get("message", {})
        except Exception:
            continue

        if msg.get("method") != "Network.responseReceived":
            continue

        params = msg.get("params", {})
        resp = params.get("response", {})
        url = resp.get("url", "") or ""
        if cfg.GREAT_GOLD_HUNT_JSON_URL not in url:
            continue

        request_id = params.get("requestId")
        if request_id:
            request_ids.append(request_id)

    for request_id in reversed(request_ids):
        try:
            result = driver.execute_cdp_cmd("Network.getResponseBody", {"requestId": request_id})
            body_text = result.get("body", "") or ""
            if not body_text:
                continue
            data = json.loads(body_text)
            if isinstance(data, dict):
                data = data.get("data", data.get("results", []))
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
        except Exception:
            continue

    return None


def _apply_saved_cookies(driver) -> None:
    cookies = _load_saved_cookies()
    if not cookies:
        return

    driver.get("https://www.greatgoldhunt.com/")
    for cookie in cookies:
        payload = {
            "name": cookie.get("name"),
            "value": cookie.get("value", ""),
            "path": cookie.get("path", "/"),
        }
        domain = str(cookie.get("domain", "")).lstrip(".")
        if domain:
            payload["domain"] = domain
        if cookie.get("expiry") is not None:
            try:
                payload["expiry"] = int(cookie["expiry"])
            except Exception:
                pass
        if cookie.get("secure") is not None:
            payload["secure"] = bool(cookie["secure"])
        if cookie.get("httpOnly") is not None:
            payload["httpOnly"] = bool(cookie["httpOnly"])
        same_site = cookie.get("sameSite")
        if same_site in ("Strict", "Lax", "None"):
            payload["sameSite"] = same_site
        try:
            driver.add_cookie(payload)
        except Exception:
            continue


def _wait_for_checkpoint_clear(driver) -> None:
    _ensure_live_window(driver)
    title = (driver.title or "").strip()
    if "security checkpoint" not in title.lower():
        return

    if cfg.GREAT_GOLD_HUNT_HEADLESS:
        raise RuntimeError("Great Gold Hunt browser session hit the Vercel Security Checkpoint in headless mode.")

    log.warning(
        "Great Gold Hunt hit the Vercel Security Checkpoint. "
        f"Waiting up to {cfg.GREAT_GOLD_HUNT_CHECKPOINT_WAIT_SEC}s for manual solve in the browser window."
    )
    try:
        driver.maximize_window()
    except Exception:
        pass

    deadline = time.time() + max(15, cfg.GREAT_GOLD_HUNT_CHECKPOINT_WAIT_SEC)
    while time.time() < deadline:
        time.sleep(_CHECKPOINT_POLL_SEC)
        try:
            _ensure_live_window(driver)
            title = (driver.title or "").strip()
        except Exception:
            continue
        if "security checkpoint" not in title.lower():
            log.info("Great Gold Hunt checkpoint cleared.")
            _save_cookies(driver)
            _minimize_window(driver)
            return

    raise RuntimeError("Great Gold Hunt Vercel checkpoint was not cleared in time.")


def _normalize_flag(value: Any) -> str:
    return "1" if str(value).strip() == "1" else "0"


def _quiz_key(item: dict[str, Any]) -> str:
    quiz_id = str(item.get("id", "")).strip()
    if quiz_id:
        return quiz_id
    return str(item.get("slug", "")).strip()


def _load_title_overrides() -> dict[str, str]:
    path = cfg.GREAT_GOLD_HUNT_TITLES_PATH
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            log.warning("Title overrides must be a JSON object. Ignoring file.")
            return {}
        return {
            str(key).strip(): str(value).strip()
            for key, value in data.items()
            if str(key).strip() and str(value).strip()
        }
    except Exception as e:
        log.error(f"Title override load error: {e}")
        return {}


def _display_name(item: dict[str, Any], titles: dict[str, str]) -> str:
    quiz_id = str(item.get("id", "")).strip()
    slug = str(item.get("slug", "")).strip()

    for key in (quiz_id, slug):
        if key and key in titles:
            return titles[key]

    banner = str(item.get("banner", "")).strip()
    if banner and quiz_id:
        return f"{banner} #{quiz_id}"
    if quiz_id:
        return f"Great Gold Hunt Quiz #{quiz_id}"
    if slug:
        return f"Great Gold Hunt Quiz {slug}"
    return "Great Gold Hunt Quiz"


def _load_state() -> dict[str, Any]:
    path = cfg.OTHER_ALERTS_STATE_FILE
    if not os.path.exists(path):
        return {"ready": False, "quizzes": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        quizzes = data.get("quizzes", {}) if isinstance(data, dict) else {}
        return {
            "ready": bool(isinstance(data, dict) and data.get("ready")),
            "quizzes": {
                str(key): _normalize_flag(value)
                for key, value in (quizzes.items() if isinstance(quizzes, dict) else [])
            },
        }
    except Exception as e:
        log.error(f"Other alerts state load error: {e}")
        return {"ready": False, "quizzes": {}}


def _save_state(state_data: dict[str, Any]) -> None:
    tmp_path = cfg.OTHER_ALERTS_STATE_FILE + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(state_data, f, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp_path, cfg.OTHER_ALERTS_STATE_FILE)
    except Exception as e:
        log.error(f"Other alerts state save error: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


def _fetch_quiz_payload(driver) -> list[dict[str, Any]]:
    _apply_saved_cookies(driver)
    _clear_performance_logs(driver)
    _ensure_live_window(driver)
    driver.get(cfg.GREAT_GOLD_HUNT_PAGE_URL)
    time.sleep(_PAGE_BOOT_WAIT_SEC)
    _wait_for_checkpoint_clear(driver)
    _save_cookies(driver)

    deadline = time.time() + _NETWORK_WAIT_SEC
    while time.time() < deadline:
        _ensure_live_window(driver)
        payload = _extract_payload_from_network(driver)
        if payload is not None:
            _minimize_window(driver)
            return payload
        time.sleep(1)

    current_url = ""
    title = ""
    try:
        _ensure_live_window(driver)
        current_url = driver.current_url or ""
        title = driver.title or ""
    except Exception:
        pass
    raise RuntimeError(
        "Great Gold Hunt network response was not captured from the page. "
        f"title={title!r} url={current_url!r}"
    )


def _series_name(name: str) -> str:
    return _TITLE_NUM_SUFFIX_RE.sub("", name).strip() or name.strip()


def _send_found_alert(name: str) -> None:
    series_name = utils.md_escape(_series_name(name))
    label_safe = utils.md_escape(name)
    telegram_bot.send_telegram_message(
        f"\u2705 \U0001FA99 *{series_name} has been Found!*\n*{label_safe}*"
    )


def warmup_great_gold_hunt_session() -> list[dict[str, Any]]:
    driver = _setup_great_gold_hunt_driver()
    try:
        payload = _fetch_quiz_payload(driver)
        _save_cookies(driver)
        log.info(f"Great Gold Hunt warmup succeeded with {len(payload)} quizzes.")
        return payload
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def run_other_alerts_loop() -> None:
    state_data = _load_state()
    driver = None

    while True:
        try:
            if driver is None:
                driver = _setup_great_gold_hunt_driver()
                log.info("Great Gold Hunt browser started.")

            titles = _load_title_overrides()
            payload = _fetch_quiz_payload(driver)

            latest_flags: dict[str, str] = {}
            latest_names: dict[str, str] = {}

            for item in payload:
                key = _quiz_key(item)
                if not key:
                    continue

                latest_flags[key] = _normalize_flag(item.get("is_found"))
                latest_names[key] = _display_name(item, titles)

            if not state_data["ready"]:
                state_data = {"ready": True, "quizzes": latest_flags}
                _save_state(state_data)
                log.info(f"Other alerts baseline loaded for {len(latest_flags)} Great Gold Hunt quizzes.")
            else:
                previous_flags = state_data.get("quizzes", {})
                for key, current_flag in latest_flags.items():
                    if previous_flags.get(key) == "0" and current_flag == "1":
                        name = latest_names.get(key, f"Great Gold Hunt Quiz #{key}")
                        _send_found_alert(name)
                        log.info(f"SENT Great Gold Hunt found alert: {name}")

                state_data["quizzes"] = latest_flags
                _save_state(state_data)

        except Exception as e:
            msg = str(e)
            if "session not created" in msg.lower() or "user data directory is already in use" in msg.lower():
                log.error(
                    "Other alerts could not start Chrome. "
                    "Close any existing Great Gold Hunt automation window that is using the dedicated profile, "
                    "then restart main.py."
                )
            log.error(f"Other alerts poll error: {e}")
            try:
                if driver is not None:
                    driver.quit()
            except Exception:
                pass
            driver = None

        time.sleep(max(5, cfg.GREAT_GOLD_HUNT_POLL_SEC))
