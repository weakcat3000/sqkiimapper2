"""AI chat helpers with live Sqkii context and short chat memory."""

from collections import defaultdict, deque
from datetime import datetime
from email.utils import parsedate_to_datetime
from html import unescape
import json
import random
import re
import time
import xml.etree.ElementTree as ET

from google import genai
from openai import OpenAI

import config as cfg
import state
import utils

log = cfg.log.getChild("ai")

SYSTEM_PROMPT = (
    "You are Sqkii AI, an energetic, positive, and concise assistant for treasure hunters in Singapore. "
    "Use the live context provided with each request as the primary source of truth for current game state. "
    "If the live context does not contain enough information, say so plainly instead of guessing. "
    "When the question is unrelated to Sqkii, answer normally with general knowledge. "
    "Sound encouraging, lively, and upbeat, but stay practical and do not become cheesy or overly wordy. "
    "Output plain text only. Do not use Markdown, bullets, code fences, backticks, or quote marks."
)

SQKII_BACKGROUND = (
    "Sqkii runs real-world treasure hunts in Singapore. "
    "Silver coin circles represent possible search zones and may shrink over time. "
    "A circle marked as the smallest public circle can be sonared. "
    "Common hiding spots include benches, pipes, gaps, pavements, pillars, and sheltered public fixtures. "
    "Coins should be in publicly accessible places, not inside restricted or trespassing areas. "
    "Historical questions about past HuntTheMouse editions, sponsors, articles, and winners are also in scope."
)

_CHAT_MEMORY: dict[str, deque[dict]] = defaultdict(lambda: deque(maxlen=6))
_gemini_client = genai.Client(api_key=cfg.GEMINI_API_KEY) if cfg.GEMINI_API_KEY else None
_LOCATION_CACHE: dict[tuple[float, float], str] = {}
_broadcast_rng = random.Random()
_NEWS_CACHE = {"ts": 0.0, "items": []}

SQKII_REFERENCE_ARTICLES = [
    {
        "title": "Mothership: Hunt The Mouse S$500,000 gold coin found by 3 people in 2024",
        "url": "https://mothership.sg/2024/11/hunt-the-mouse-gold-coin-found-3-people-2024/",
        "summary": (
            "Mothership reported in November 2024 that the S$500,000 Hunt The Mouse gold coin "
            "was found by three friends, Wee Kiat, Edward Ter, and Erwin Teo, at about 1:43 a.m. "
            "on 8 November 2024 under a bench in front of Block 208 New Upper Changi Road, Bedok. "
            "The article also said some silver coins were still unfound at that point."
        ),
    },
    {
        "title": "Mothership: Singapore man wins S$250,000 after finding Hunt The Mouse gold coin under tree in Upper Thomson",
        "url": "https://mothership.sg/2026/03/gold-coin-hunt-the-mouse-tree/",
        "summary": (
            "Search results for the March 2026 Mothership article say a man named Jun Liang found the "
            "SG60-edition Hunt The Mouse gold coin worth S$250,000 under a tree along Tagore Road in Upper Thomson "
            "at about 11:32 p.m. on 26 February 2026, after Sqkii later verified the find."
        ),
    },
    {
        "title": "Official Hunt The Mouse map site",
        "url": "https://huntthemouse.sqkii.com/",
        "summary": (
            "The official Hunt The Mouse site title is Fastest HuntTheMouse ShopBack Edition. "
            "Its page description says S$20,000 will be hidden in Singapore from 12 March 2026 onwards, "
            "all coins must be found in the next 17 days, and players can pick up coins for cash and "
            "10x ShopBack Lifetime Earnings."
        ),
    },
]

SQKII_HISTORICAL_FACTS = [
    "Historical HuntTheMouse questions should be answered instead of being dismissed as out of scope.",
    "Revolut should be treated as a past HuntTheMouse sponsor for the 2025 SG60 edition only.",
    "Foodpanda was the title sponsor for the 2023 HuntTheMouse edition.",
    "The official HuntTheMouse site currently reflects the Fastest HuntTheMouse ShopBack Edition for March 2026.",
]


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return None


def _tokenize(text: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-z0-9]+", (text or "").casefold()) if len(tok) >= 2}


def _coin_circle(item: dict) -> tuple[float | None, float | None, float | None]:
    circle = (item.get("freeCircle") or item.get("circle") or {})
    center = circle.get("center") or {}
    return _safe_float(center.get("lat")), _safe_float(center.get("lng")), _safe_float(circle.get("radius"))


def _coin_record(coin_id: str, item: dict, include_distance_from=None) -> dict:
    lat, lng, radius = _coin_circle(item)
    status = state.ongoing_status_map.get(coin_id, item.get("status", "unknown"))
    label = utils.display_label(coin_id, item)
    reward = item.get("reward")
    record = {
        "coin_id": coin_id,
        "label": label,
        "status": status,
        "brand_name": item.get("brand_name"),
        "coin_number": item.get("coin_number"),
        "reward": reward,
        "reward_label": utils.display_label_with_reward(coin_id, item),
        "is_smallest_public_circle": bool(item.get("is_smallest_public_circle")),
        "lat": lat,
        "lng": lng,
        "radius_m": radius,
    }
    if lat is not None and lng is not None:
        mrt, mrt_dist = utils.get_nearest_mrt(lat, lng)
        record["nearest_mrt"] = mrt
        record["nearest_mrt_distance_m"] = mrt_dist
        record["google_maps_url"] = f"https://www.google.com/maps?q={lat:.6f},{lng:.6f}&z=17&t=m"
        record["approx_area"] = _approx_area(lat, lng)
    if include_distance_from and lat is not None and lng is not None:
        u_lat, u_lng = include_distance_from
        record["distance_from_user_m"] = round(utils.haversine(u_lat, u_lng, lat, lng))
    winner = state.winner_names_record.get(coin_id)
    if winner:
        record["winner_name"] = winner
    if status == "ongoing" and item.get("is_smallest_public_circle"):
        record["can_sonar_now"] = True
    return record


def _approx_area(lat: float, lng: float) -> str:
    key = (round(lat, 5), round(lng, 5))
    if key not in _LOCATION_CACHE:
        _LOCATION_CACHE[key] = utils.reverse_geocode(lat, lng)
    return _LOCATION_CACHE[key]


def _detect_intent(query: str) -> str:
    q = (query or "").casefold().strip()
    if any(phrase in q for phrase in ("near me", "nearest coin", "coins near me", "what coin is near me")):
        return "near_me"
    if any(phrase in q for phrase in ("what coins are there", "what coins are available", "list coins", "what coins are live", "what coins now")):
        return "list_coins"
    if "sponsor" in q or any(name in q for name in ("revolut", "foodpanda", "shopback", "dbs", "agoda")):
        return "sponsor_history"
    if q.startswith("where is ") or q.startswith("where's ") or q.startswith("where are "):
        return "where_is_coin"
    return "general"


def _needs_news_context(query: str) -> bool:
    q = (query or "").casefold()
    triggers = (
        "news",
        "latest",
        "recent",
        "article",
        "huntthemouse",
        "hunt the mouse",
        "sqkii",
        "gold coin",
    )
    return any(token in q for token in triggers)


def _answer_sponsor_history(query: str) -> str | None:
    q = (query or "").casefold()
    if "revolut" in q:
        return (
            "Yes. Revolut should be treated as a past HuntTheMouse sponsor. "
            "For this bot, Revolut was the title sponsor of the 2025 SG60 edition only."
        )
    if "foodpanda" in q:
        return "Yes. Foodpanda was the title sponsor for the 2023 HuntTheMouse edition."
    if "shopback" in q:
        return "Yes. The official HuntTheMouse site currently reflects the ShopBack edition for March 2026."
    if "dbs" in q:
        return "Yes. DBS was used for the DBS SG60 Hunt context in the bot knowledge for the 2025 event."
    if "agoda" in q:
        return "Agoda should also be treated as a HuntTheMouse sponsor in later editions."
    if "sponsor" in q:
        return (
            "Yes, HuntTheMouse has had different sponsors across different editions. "
            "For this bot, that includes Foodpanda in 2023, Revolut in 2025, and ShopBack on the current official 2026 site context."
        )
    return None


def _fetch_sqkii_news(limit: int = 5) -> list[dict]:
    now = time.time()
    if _NEWS_CACHE["items"] and (now - float(_NEWS_CACHE["ts"])) < 900:
        return list(_NEWS_CACHE["items"])[:limit]

    items = []
    try:
        res = cfg.GET(cfg.SQKII_NEWS_RSS_URL, headers={"User-Agent": "SqkiiAI/1.0"})
        if res.status_code == 200 and res.text.strip():
            root = ET.fromstring(res.text)
            for item in root.findall(".//item")[:limit]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                try:
                    pub_date = parsedate_to_datetime(pub_date).isoformat()
                except Exception:
                    pass
                source = ""
                source_node = item.find("source")
                if source_node is not None and source_node.text:
                    source = source_node.text.strip()
                items.append(
                    {
                        "title": unescape(title),
                        "url": link,
                        "published_at": pub_date,
                        "source": source,
                    }
                )
    except Exception as e:
        log.warning(f"Sqkii news fetch failed: {e}")

    _NEWS_CACHE["ts"] = now
    _NEWS_CACHE["items"] = items
    return items[:limit]


def _format_coin_line(record: dict) -> str:
    bits = [record.get("reward_label") or record.get("label") or record.get("coin_id", "Unknown coin")]
    dist = record.get("distance_from_user_m")
    if dist is not None:
        bits.append(f"{int(dist)}m away")
    mrt = record.get("nearest_mrt")
    mrt_dist = record.get("nearest_mrt_distance_m")
    if mrt and mrt_dist is not None:
        bits.append(f"near {mrt} ({int(mrt_dist)}m)")
    if record.get("radius_m") is not None:
        bits.append(f"radius {int(float(record['radius_m']))}m")
    return " - ".join(bits)


def _answer_near_me(live_context: dict) -> str | None:
    user = live_context.get("user") or {}
    if not user.get("last_shared_location"):
        return (
            "I need your current location first before I can check which coin is nearest you.\n\n"
            "Please share your location in Telegram, then ask again. After that I can tell you the nearest ongoing coins and how far they are."
        )

    nearby = live_context.get("nearest_ongoing_coins_to_user") or []
    if not nearby:
        return "I could not find any ongoing coins with location data right now."

    lines = ["Nearest ongoing coins to your last shared location:"]
    for idx, record in enumerate(nearby[:3], start=1):
        lines.append(f"{idx}. {_format_coin_line(record)}")
    return "\n".join(lines)


def _answer_list_coins(live_context: dict) -> str:
    counts = live_context.get("status_counts") or {}
    relevant = live_context.get("relevant_coins") or []
    grouped = {"ongoing": [], "scheduled": [], "verifying": []}
    for record in relevant:
        status = record.get("status")
        if status in grouped:
            grouped[status].append(record.get("reward_label") or record.get("label"))

    lines = [
        f"There are {counts.get('ongoing', 0)} ongoing coins, {counts.get('scheduled', 0)} scheduled coins, and {counts.get('verifying', 0)} verifying coins right now."
    ]
    if grouped["ongoing"]:
        lines.append("")
        lines.append("Ongoing:")
        lines.extend(grouped["ongoing"][:6])
    if grouped["scheduled"]:
        lines.append("")
        lines.append("Scheduled:")
        lines.extend(grouped["scheduled"][:6])
    if grouped["verifying"]:
        lines.append("")
        lines.append("Verifying:")
        lines.extend(grouped["verifying"][:4])
    return "\n".join(lines)


def _answer_where_is_coin(live_context: dict) -> str | None:
    relevant = live_context.get("relevant_coins") or []
    if not relevant:
        return None

    record = relevant[0]
    label = record.get("reward_label") or record.get("label") or record.get("coin_id", "This coin")
    status = record.get("status", "unknown")
    area = record.get("approx_area") or "an unknown area"
    radius = record.get("radius_m")
    mrt = record.get("nearest_mrt")
    mrt_dist = record.get("nearest_mrt_distance_m")
    map_url = record.get("google_maps_url")

    status_text = {
        "scheduled": "is scheduled and not live yet",
        "ongoing": "is currently ongoing",
        "verifying": "is currently verifying",
        "found": "has already been found",
        "forfeited": "was forfeited",
    }.get(status, f"is currently {status}")

    parts = [f"{label} {status_text}."]
    if area:
        parts.append(f"The current circle is around {area}.")
    if mrt and mrt_dist is not None:
        parts.append(f"It is about {int(mrt_dist)}m from {mrt}.")
    if radius is not None:
        parts.append(f"Current radius is {int(float(radius))}m.")
    if map_url:
        parts.append(f"Map: {map_url}")
    return " ".join(parts)


def _direct_answer(query: str, live_context: dict) -> str | None:
    intent = _detect_intent(query)
    if intent == "near_me":
        return _answer_near_me(live_context)
    if intent == "list_coins":
        return _answer_list_coins(live_context)
    if intent == "sponsor_history":
        return _answer_sponsor_history(query)
    if intent == "where_is_coin":
        return _answer_where_is_coin(live_context)
    return None


def _find_relevant_coins(query: str, user_loc=None, limit: int = 6) -> list[dict]:
    query_lc = (query or "").casefold()
    query_tokens = _tokenize(query)
    scored = []

    for coin_id, item in state.ongoing_coin_data.items():
        label = utils.display_label(coin_id, item)
        brand = str(item.get("brand_name") or "")
        coin_num = str(item.get("coin_number") or "")
        haystack = " ".join([
            str(coin_id),
            label,
            brand,
            coin_num,
            str(item.get("status") or ""),
        ]).casefold()
        hay_tokens = _tokenize(haystack)

        score = 0
        if query_lc and query_lc in haystack:
            score += 100
        if label.casefold() in query_lc and label:
            score += 50
        if brand and brand.casefold() in query_lc:
            score += 25
        score += 8 * len(query_tokens & hay_tokens)

        if score <= 0:
            continue
        scored.append((score, utils._get_reward_numeric(item), coin_id, item))

    scored.sort(key=lambda row: (-row[0], -row[1], utils.display_label(row[2], row[3]).casefold()))
    records = [_coin_record(coin_id, item, include_distance_from=user_loc) for _, _, coin_id, item in scored[:limit]]

    if records:
        return records

    fallback_ids = []
    for coin_id, item in state.ongoing_coin_data.items():
        if item.get("is_smallest_public_circle"):
            fallback_ids.append((3, utils._get_reward_numeric(item), coin_id, item))
        elif state.ongoing_status_map.get(coin_id) == "ongoing":
            fallback_ids.append((2, utils._get_reward_numeric(item), coin_id, item))
        elif state.ongoing_status_map.get(coin_id) == "scheduled":
            fallback_ids.append((1, utils._get_reward_numeric(item), coin_id, item))

    fallback_ids.sort(key=lambda row: (-row[0], -row[1], utils.display_label(row[2], row[3]).casefold()))
    return [_coin_record(coin_id, item, include_distance_from=user_loc) for _, _, coin_id, item in fallback_ids[:limit]]


def _nearest_user_coins(user_loc, limit: int = 3) -> list[dict]:
    if not user_loc:
        return []

    lat, lng = user_loc
    nearby = []
    for coin_id, item in state.ongoing_coin_data.items():
        if state.ongoing_status_map.get(coin_id) != "ongoing":
            continue
        c_lat, c_lng, _ = _coin_circle(item)
        if c_lat is None or c_lng is None:
            continue
        nearby.append((utils.haversine(lat, lng, c_lat, c_lng), coin_id, item))

    nearby.sort(key=lambda row: row[0])
    return [_coin_record(coin_id, item, include_distance_from=user_loc) for _, coin_id, item in nearby[:limit]]


def _status_counts() -> dict:
    counts = {
        "ongoing": 0,
        "scheduled": 0,
        "verifying": 0,
        "found": 0,
        "forfeited": 0,
    }
    for status in state.ongoing_status_map.values():
        counts[status] = counts.get(status, 0) + 1
    counts["smallest_public_circle"] = sum(
        1 for coin_id, item in state.ongoing_coin_data.items()
        if state.ongoing_status_map.get(coin_id) == "ongoing" and item.get("is_smallest_public_circle")
    )
    return counts


def _user_context(user_id: int | None) -> tuple[dict, tuple[float, float] | None]:
    if user_id is None:
        return {}, None

    last = state.user_last_location.get(user_id)
    if not last:
        return {"authorized": utils.is_authorized(user_id)}, None

    lat, lng, ts = last
    ts_text = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    user_info = {
        "authorized": utils.is_authorized(user_id),
        "last_shared_location": {
            "lat": round(float(lat), 6),
            "lng": round(float(lng), 6),
            "timestamp_local": ts_text,
        },
    }
    return user_info, (float(lat), float(lng))


def _chat_key(user_id: int | None, chat_id: int | None) -> str:
    if user_id is not None:
        return f"user:{user_id}"
    if chat_id is not None:
        return f"chat:{chat_id}"
    return "global"


def _recent_history(key: str) -> list[dict]:
    return list(_CHAT_MEMORY.get(key, ()))


def _remember_turn(key: str, question: str, answer: str):
    _CHAT_MEMORY[key].append({"role": "user", "content": question})
    _CHAT_MEMORY[key].append({"role": "assistant", "content": answer[:1200]})


def build_live_context(query: str, user_id: int | None = None, chat_id: int | None = None) -> dict:
    user_info, user_loc = _user_context(user_id)
    key = _chat_key(user_id, chat_id)

    verifying = []
    for coin_id, status in state.ongoing_status_map.items():
        if status == "verifying":
            item = state.ongoing_coin_data.get(coin_id, {})
            verifying.append(_coin_record(coin_id, item, include_distance_from=user_loc))

    context = {
        "generated_at_local": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "maintenance_mode": state.MAINTENANCE_MODE,
        "status_counts": _status_counts(),
        "historical_facts": SQKII_HISTORICAL_FACTS,
        "user": user_info,
        "nearest_ongoing_coins_to_user": _nearest_user_coins(user_loc),
        "relevant_coins": _find_relevant_coins(query, user_loc=user_loc),
        "verifying_coins": verifying[:5],
        "recent_winner_records": [
            {"coin_id": coin_id, "winner_name": name}
            for coin_id, name in list(state.winner_names_record.items())[:8]
        ],
        "recent_chat_history": _recent_history(key),
    }
    if _needs_news_context(query):
        context["reference_articles"] = SQKII_REFERENCE_ARTICLES
        context["latest_sqkii_news"] = _fetch_sqkii_news()
    return context


def _render_user_prompt(query: str, live_context: dict) -> str:
    context_json = json.dumps(live_context, ensure_ascii=False, separators=(",", ":"))
    return (
        f"Background:\n{SQKII_BACKGROUND}\n\n"
        f"Live context:\n{context_json}\n\n"
        f"User question:\n{query}\n\n"
        "Reply naturally, helpfully, and with positive energy.\n"
        "Sound a bit more lively and encouraging than a neutral assistant.\n"
        "Do not say phrases like the live context does not contain or based on the provided context.\n"
        "If the user asks about coins near them and there is no saved user location, tell them to share their location first.\n"
        "If a coin is scheduled, clearly say it is scheduled and not live yet.\n"
        "Prefer nearest MRT, approximate area, and map link over raw latitude and longitude unless the user asks for exact coordinates.\n"
        "If latest_sqkii_news is present, use it for current news-related questions and mention source names when useful.\n"
        "If reference_articles is present, you may use it as historical HuntTheMouse context.\n"
        "Do not reject historical Sqkii questions just because they are not about the current live map.\n"
        "Keep the answer concise, practical, and easy to act on.\n\n"
        "Answer using the live context when relevant. "
        "If the live context conflicts with older general knowledge, trust the live context."
    )


def _normalize_response(text: str) -> str:
    cleaned = (text or "").replace("\r\n", "\n").strip()
    if not cleaned:
        return "Sqkii AI could not generate a reply right now."
    cleaned = cleaned.replace("•", "-").replace("`", "")
    return cleaned[:4000]


def _broadcast_fallback(context: dict) -> str:
    counts = context.get("status_counts") or {}
    ongoing = counts.get("ongoing", 0)
    scheduled = counts.get("scheduled", 0)
    verifying = counts.get("verifying", 0)
    notable = []
    for record in (context.get("relevant_coins") or []):
        label = record.get("reward_label") or record.get("label")
        status = record.get("status")
        if label and status in ("ongoing", "scheduled"):
            notable.append(label)
        if len(notable) >= 2:
            break
    openings = [
        "Quick hunt update.",
        "Sqkii AI check-in.",
        "Fresh coin update.",
        "Hunter heads-up.",
        "Treasure hunt update.",
    ]
    ctas_live = [
        "Are you hunting today?",
        "Heading out to hunt later?",
        "Time to plan your route.",
        "Might be a good time to head out.",
        "Good luck if you are going hunting.",
    ]
    ctas_quiet = [
        "Stay ready for the next drop.",
        "Keep an eye on the map.",
        "More movement could happen later.",
    ]

    parts = [_broadcast_rng.choice(openings)]
    if ongoing > 0:
        coin_word = "coin" if ongoing == 1 else "coins"
        parts.append(f"There {'is' if ongoing == 1 else 'are'} {ongoing} ongoing {coin_word} live now.")
    if scheduled > 0:
        parts.append(f"{scheduled} more {'coin is' if scheduled == 1 else 'coins are'} scheduled.")
    if verifying > 0:
        parts.append(f"{verifying} {'coin is' if verifying == 1 else 'coins are'} verifying.")
    if notable:
        parts.append(f"Notable coins include {', '.join(notable)}.")
    if len(parts) == 1:
        parts.append("No live coins right now.")
        parts.append(_broadcast_rng.choice(ctas_quiet))
    else:
        parts.append(_broadcast_rng.choice(ctas_live))
    return " ".join(parts)


def _broadcast_style_prompt() -> str:
    styles = [
        "Write in a clean and energetic hunt-update style.",
        "Write like a short community check-in for active hunters.",
        "Write like a crisp alert with a light playful tone.",
        "Write like a practical update that feels human, not robotic.",
        "Write like a short evening rally message for treasure hunters.",
        "Write like a midday status update with a gentle call to action.",
    ]
    ctas = [
        "Use a call to action like Are you hunting today",
        "Use a call to action like Heading out later",
        "Use a call to action like Time to check the map",
        "Use a call to action like Good luck if you are hunting",
        "Use a call to action like Might be worth a quick route plan",
    ]
    return f"{_broadcast_rng.choice(styles)} {_broadcast_rng.choice(ctas)}."


def _gemini_ask(prompt: str, model_name: str | None = None) -> str:
    if _gemini_client is None:
        return "Gemini API key is not configured. Add GEMINI_API_KEY to your .env file."

    response = _gemini_client.models.generate_content(
        model=model_name or cfg.GEMINI_MODEL,
        contents=prompt,
        config={
            "system_instruction": SYSTEM_PROMPT,
            "temperature": 0.4,
        },
    )
    return _normalize_response(getattr(response, "text", "") or "")


def _openrouter_ask(prompt: str) -> str:
    keys = [cfg.OPENROUTER_API_KEY, cfg.OPENROUTER_BACKUP_KEY]
    keys = [k for k in keys if k]

    for idx, key in enumerate(keys, start=1):
        try:
            client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=key,
            )
            completion = client.chat.completions.create(
                model="deepseek/deepseek-r1-0528:free",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            )
            message = completion.choices[0].message.content
            return _normalize_response(message)
        except Exception as e:
            preview = f"{key[:18]}..." if len(key) >= 18 else "***"
            log.warning(f"OpenRouter attempt {idx} failed with key {preview}: {e}")

    return "Sqkii AI is currently unavailable. You can try /ask2 to use Gemini instead."


def ask_ai(query: str, provider: str | None = None, user_id: int | None = None, chat_id: int | None = None) -> str:
    key = _chat_key(user_id, chat_id)
    live_context = build_live_context(query, user_id=user_id, chat_id=chat_id)
    direct = _direct_answer(query, live_context)
    if direct:
        _remember_turn(key, query, direct)
        return direct
    prompt = _render_user_prompt(query, live_context)
    provider = (provider or cfg.AI_PROVIDER).strip().lower()

    try:
        if provider == "gemini":
            answer = _gemini_ask(prompt)
        elif provider in ("gemini-fast", "gemini-lite"):
            answer = _gemini_ask(prompt, model_name=cfg.GEMINI_FAST_MODEL)
        else:
            answer = _openrouter_ask(prompt)
    except Exception as e:
        log.error(f"AI provider error ({provider}): {e}")
        fallback = cfg.AI_FALLBACK_PROVIDER
        if fallback and fallback != provider:
            try:
                if fallback == "gemini":
                    answer = _gemini_ask(prompt)
                elif fallback in ("gemini-fast", "gemini-lite"):
                    answer = _gemini_ask(prompt, model_name=cfg.GEMINI_FAST_MODEL)
                else:
                    answer = _openrouter_ask(prompt)
                _remember_turn(key, query, answer)
                return answer
            except Exception as fallback_error:
                log.error(f"AI fallback error ({fallback}): {fallback_error}")
        if provider.startswith("gemini"):
            return "Gemini could not respond right now."
        return "Sqkii AI is currently unavailable right now."

    _remember_turn(key, query, answer)
    return answer


def generate_group_broadcast(provider: str | None = None) -> str:
    live_context = build_live_context("Write a short group update about current coins.", user_id=None, chat_id=cfg.AI_BROADCAST_CHAT_ID or cfg.TELEGRAM_CHAT_ID)
    provider = (provider or cfg.AI_PROVIDER).strip().lower()

    prompt = (
        "Write one short Telegram group announcement for hunters.\n"
        "Requirements:\n"
        "- Mention the current number of ongoing, scheduled, and verifying coins if useful.\n"
        "- Keep it to 1 or 2 short sentences.\n"
        "- Sound natural, upbeat, and concise.\n"
        "- Vary the wording from earlier updates. Do not always start with There are.\n"
        "- Prefer different openings, sentence structures, and calls to action.\n"
        "- When useful, mention one or two coin names or rewards from the live context.\n"
        "- Do not use Markdown.\n"
        "- End with a light call to action when there are live coins.\n\n"
        f"Style direction:\n{_broadcast_style_prompt()}\n\n"
        f"Live context:\n{json.dumps(live_context, ensure_ascii=False, separators=(',', ':'))}"
    )

    try:
        if provider == "gemini":
            text = _gemini_ask(prompt)
        elif provider in ("gemini-fast", "gemini-lite"):
            text = _gemini_ask(prompt, model_name=cfg.GEMINI_FAST_MODEL)
        else:
            text = _openrouter_ask(prompt)
        text = _normalize_response(text)
        if text:
            return text
    except Exception as e:
        log.error(f"Group broadcast generation error ({provider}): {e}")

    return _broadcast_fallback(live_context)
