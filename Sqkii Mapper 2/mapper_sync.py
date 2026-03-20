# ===========================================================
# mapper_sync.py — CLEAN + PRUNING + TRANSPARENT HISTORY + BLUE OUTLINES
# ===========================================================
# What it does
# • Pushes "Live Sqkii Circles" (ongoing coins) to your Mapper (Supabase).
# • Maintains "Shrink Pattern" history ONLY for coins still ongoing.
# • Past rings are outline-only (fillOpacity = 0.0).
# • First Timer / Youth / Senior coins are blue outlined (live + history).
# ===========================================================

import math
import time
import json
import hashlib
import threading
from datetime import datetime, timezone
from supabase import create_client

import config as cfg

log = cfg.log.getChild("mapper_sync")

HAVE_SENT_NON_EMPTY = False
_SYNC_LOCK = threading.Lock()

# ---- Config (from config.py) ----
SUPABASE_URL = cfg.SUPABASE_URL
SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY
ROOM_CODE = cfg.MAPPER_ROOM_CODE
SYNC_INTERVAL_SECONDS = cfg.MAPPER_SYNC_EVERY_SEC

# ---- Tuning ----
CIRCLE_STEPS = 64
MAX_HISTORY_PER_COIN = 120
MAX_TOTAL_HISTORY = 4000
PRINT_PAYLOAD_SIZE = True

# ---- Styling ----
_BLUE_STROKE = "#89CFF0"
_GREY_STROKE = "#999999"
_GREY_FILL = "#666666"
_WHITE = "#FFFFFF"


# ===========================================================
# Helpers
# ===========================================================

def _sb():
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def _now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def _geom_hash(geom: dict) -> str:
    try:
        s = json.dumps(geom or {}, sort_keys=True, separators=(",", ":"))
    except Exception:
        s = str(geom)
    return hashlib.sha1(s.encode("utf-8", errors="ignore")).hexdigest()


def _root_coin_id(fid: str) -> str:
    if not isinstance(fid, str):
        return ""
    return fid.split("-", 1)[0]


def _parse_ts_ms(feature: dict) -> int:
    try:
        props = (feature or {}).get("properties") or {}
        ts = props.get("_ts")
        if ts is not None:
            return int(ts)
    except Exception:
        pass
    try:
        fid = str(((feature or {}).get("properties") or {}).get("fid") or "")
        if "-" in fid:
            maybe = fid.split("-", 1)[1]
            return int(maybe)
    except Exception:
        pass
    return 0


def _circle_polygon(lng: float, lat: float, radius_m: float, steps: int = CIRCLE_STEPS) -> dict:
    coords = []
    R = 6378137.0
    lat_rad = math.radians(lat)
    cos_lat = max(1e-6, math.cos(lat_rad))
    for i in range(steps):
        ang = 2 * math.pi * i / steps
        dlat = (radius_m / R) * math.cos(ang)
        dlng = (radius_m / R) * math.sin(ang) / cos_lat
        coords.append([
            lng + (dlng * 180.0 / math.pi),
            lat + (dlat * 180.0 / math.pi),
        ])
    coords.append(coords[0])
    return {"type": "Polygon", "coordinates": [coords]}


def _canonical_coin_label(label: str) -> str:
    s = " ".join(str(label or "").split()).strip()
    if s.lower().endswith(" (past)"):
        s = s[:-7].rstrip()
    if s.lower().endswith(" - active"):
        s = s[:-9].rstrip()
    return s


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def _circle_meta_from_feature(feature: dict):
    props = (feature or {}).get("properties") or {}
    try:
        lat = float(props.get("_circleLat"))
        lng = float(props.get("_circleLng"))
        radius = float(props.get("_circleRadius"))
        return lat, lng, radius
    except Exception:
        pass

    geom = (feature or {}).get("geometry") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") != "Polygon" or not coords or not isinstance(coords[0], list):
        return None, None, None

    ring = coords[0][:-1] if len(coords[0]) > 1 else coords[0]
    if not ring:
        return None, None, None

    try:
        lng = sum(float(pt[0]) for pt in ring) / len(ring)
        lat = sum(float(pt[1]) for pt in ring) / len(ring)
        radius = _haversine_m(lat, lng, float(ring[0][1]), float(ring[0][0]))
        return lat, lng, radius
    except Exception:
        return None, None, None


def _ensure_archive_props(feature: dict, fid_root: str = "", coin_label: str = ""):
    if not isinstance(feature, dict):
        return
    props = feature.setdefault("properties", {}) or {}
    if fid_root:
        props.setdefault("_coinId", fid_root)
    if coin_label:
        props.setdefault("_coinLabel", _canonical_coin_label(coin_label))
    props["_coinArchiveEligible"] = True
    props["_coinArchiveSource"] = "silver-api"

    lat, lng, radius = _circle_meta_from_feature(feature)
    if lat is not None and lng is not None and radius is not None:
        props.setdefault("_circleLat", lat)
        props.setdefault("_circleLng", lng)
        props.setdefault("_circleCenter", [lng, lat])
        props.setdefault("_circleRadius", radius)


def _feature_to_archive_step(feature: dict, default_layer_name: str = "Shrink Pattern"):
    if not isinstance(feature, dict):
        return None
    props = feature.get("properties") or {}
    fid = str(props.get("fid") or props.get("_gid") or "")
    coin_id = _root_coin_id(str(props.get("_coinId") or fid)) or str(props.get("_coinId") or fid)
    coin_label = _canonical_coin_label(props.get("_coinLabel") or props.get("name") or coin_id)
    lat, lng, radius = _circle_meta_from_feature(feature)
    if lat is None or lng is None or radius is None:
        return None

    ts_ms = _parse_ts_ms(feature) or _now_ms()
    return {
        "step": 0,
        "layerName": default_layer_name,
        "featureName": str(props.get("name") or default_layer_name),
        "coinId": coin_id,
        "coinLabel": coin_label,
        "lat": lat,
        "lng": lng,
        "radiusMeters": radius,
        "timestampMs": ts_ms,
        "timestampIso": datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat(),
        "fid": fid,
    }


def _step_identity(step: dict) -> str:
    coin_id = _root_coin_id(str((step or {}).get("coinId") or (step or {}).get("fid") or ""))
    try:
        lat = f"{float((step or {}).get('lat')):.6f}"
        lng = f"{float((step or {}).get('lng')):.6f}"
        radius = f"{float((step or {}).get('radiusMeters')):.2f}"
    except Exception:
        lat = lng = radius = ""
    ts = str((step or {}).get("timestampMs") or (step or {}).get("timestampIso") or "")
    feature_name = str((step or {}).get("featureName") or "")
    return "|".join([coin_id, lat, lng, radius, ts, feature_name])


def _merge_lifecycle(existing_steps, incoming_steps):
    merged = {}
    for step in (existing_steps or []):
        if isinstance(step, dict):
            merged[_step_identity(step)] = dict(step)
    for step in (incoming_steps or []):
        if isinstance(step, dict):
            merged[_step_identity(step)] = dict(step)

    out = list(merged.values())
    out.sort(key=lambda s: (
        int(s.get("timestampMs") or 0),
        str(s.get("featureName") or ""),
    ))
    for i, step in enumerate(out, 1):
        step["step"] = i
    return out


def _sync_coin_history_archive(sb, code: str, live_layer: dict, shrink_layer: dict, snapshot_state):
    live_features = ((live_layer or {}).get("data") or {}).get("features") or []
    shrink_features = ((shrink_layer or {}).get("data") or {}).get("features") or []

    groups = {}
    for feature in live_features:
        props = (feature or {}).get("properties") or {}
        coin_id = _root_coin_id(str(props.get("_coinId") or props.get("fid") or props.get("_gid") or ""))
        if not coin_id:
            continue
        coin_label = _canonical_coin_label(props.get("_coinLabel") or props.get("name") or coin_id)
        groups[coin_id] = {
            "coin_label": coin_label,
            "is_live": True,
            "steps": [],
        }

    for feature in shrink_features:
        step = _feature_to_archive_step(feature, "Shrink Pattern")
        if not step:
            continue
        coin_id = step["coinId"]
        group = groups.setdefault(coin_id, {
            "coin_label": step["coinLabel"],
            "is_live": False,
            "steps": [],
        })
        if not group.get("coin_label"):
            group["coin_label"] = step["coinLabel"]
        group["steps"].append(step)

    for group in groups.values():
        group["steps"] = _merge_lifecycle([], group.get("steps") or [])

    existing_rows = (
        sb.table("coin_history_archive")
        .select("id, coin_label, lifecycle")
        .eq("room_code", code)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    existing_by_label = {
        _canonical_coin_label(row.get("coin_label")): row
        for row in existing_rows
        if isinstance(row, dict)
    }

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    processed = set()

    for group in groups.values():
        if not group.get("is_live"):
            continue
        coin_label = _canonical_coin_label(group.get("coin_label"))
        processed.add(coin_label)
        existing = existing_by_label.get(coin_label) or {}
        merged_steps = _merge_lifecycle(existing.get("lifecycle") or [], group.get("steps") or [])
        payload = {
            "room_code": code,
            "coin_label": coin_label,
            "status": "active",
            "shrink_count": len(merged_steps),
            "lifecycle": merged_steps,
            "snapshot_state": snapshot_state,
            "first_shrink_at": merged_steps[0]["timestampIso"] if merged_steps else None,
            "last_shrink_at": merged_steps[-1]["timestampIso"] if merged_steps else None,
            "updated_by": "python-bot",
            "updated_at": now_iso,
        }

        if existing.get("id"):
            sb.table("coin_history_archive").update(payload).eq("id", existing["id"]).execute()
        else:
            payload["archived_by"] = "python-bot"
            sb.table("coin_history_archive").insert(payload).execute()

    for label, row in existing_by_label.items():
        if label in processed:
            continue
        sb.table("coin_history_archive").update({
            "status": "found",
            "updated_by": "python-bot",
            "updated_at": now_iso,
        }).eq("id", row["id"]).execute()


# ---- Blue-outline classification ----

def _is_blue_outline_name(name: str) -> bool:
    if not isinstance(name, str):
        return False
    t = name.lower().replace("_", " ").replace("-", " ")
    keys = ["first timer", "youth", "young senior", "senior", "senoir"]
    return any(k in t for k in keys)


def _is_blue_outline_point(p: dict) -> bool:
    name = (
        (p or {}).get("title")
        or (p or {}).get("display_name")
        or (p or {}).get("label")
        or (p or {}).get("name")
        or ""
    )
    return _is_blue_outline_name(str(name))


def _build_circles_layer(points, layer_name: str, opacity: float = 0.075) -> dict:
    ts = _now_ms()
    feats = []
    for i, p in enumerate(points or []):
        try:
            coin_id = str((p or {}).get("id") or (p or {}).get("name") or f"circle-{i}")
            display_name = (
                (p or {}).get("title")
                or (p or {}).get("display_name")
                or (p or {}).get("label")
                or (p or {}).get("name")
                or f"Circle {int(float((p or {}).get('radius_m', 50)))}m"
            )
            lat = float((p or {})["lat"])
            lng = float((p or {})["lng"])
            radius_m = float((p or {})["radius_m"])
            geom = _circle_polygon(lng, lat, radius_m)

            is_blue = _is_blue_outline_point(p or {})
            stroke_color = _BLUE_STROKE if is_blue else _WHITE
            fill_color = _BLUE_STROKE if is_blue else _WHITE

            style_dict = {
                "strokeColor": stroke_color,
                "strokeOpacity": 0.9,
                "strokeWidth": 1.2,
                "fillColor": fill_color,
                "fillOpacity": opacity,
            }
            props = {
                "fid": coin_id,
                "_gid": coin_id,
                "_ts": ts,
                "name": str(display_name),
                "_coinId": coin_id,
                "_coinLabel": _canonical_coin_label(display_name),
                "_coinArchiveEligible": True,
                "_coinArchiveSource": "silver-api",
                "_circleLat": lat,
                "_circleLng": lng,
                "_circleCenter": [lng, lat],
                "_circleRadius": radius_m,
                "hidden": False,
                "_fill": fill_color,
                "_fillOpacity": opacity,
                "_stroke": stroke_color,
                "_strokeOpacity": 0.9,
                "_weight": 1.2,
                "style": style_dict,
            }
            feats.append({
                "type": "Feature",
                "geometry": geom,
                "properties": props,
                "style": style_dict,
            })
        except Exception:
            continue

    return {
        "id": 9999 if layer_name == "Live Sqkii Circles" else 9998,
        "name": layer_name,
        "visible": True,
        "data": {"type": "FeatureCollection", "features": feats},
        "items": [],
        "_deletedLayer": False,
    }


def _get_existing_layers(sb, code: str):
    row = sb.table("rooms").select("state").eq("code", code).maybe_single().execute().data
    if not row:
        return []
    state_data = row.get("state")
    if isinstance(state_data, list):
        return [L for L in state_data if isinstance(L, dict)]
    if isinstance(state_data, dict):
        return [state_data]
    return []


def _upsert_layers(sb, code: str, layers):
    sb.table("rooms").upsert(
        {
            "code": code,
            "state": layers,
            "updated_by": "python-bot",
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        },
        on_conflict="code",
        returning="minimal",
    ).execute()


# ===========================================================
# Main sync
# ===========================================================

def sync_mapper_circles(silver_points):
    global HAVE_SENT_NON_EMPTY
    pts = silver_points or []

    if not pts and not HAVE_SENT_NON_EMPTY:
        log.info("Boot-skip: points not ready yet; keeping existing layer")
        return

    new_live_layer = _build_circles_layer(pts, "Live Sqkii Circles", opacity=0.075)

    with _SYNC_LOCK:
        sb = _sb()
        existing_layers = _get_existing_layers(sb, ROOM_CODE)

        def _find_layer(name_lower):
            return next(
                (L for L in existing_layers if (L.get("name") or "").lower() == name_lower),
                None,
            )

        live_layer_old = _find_layer("live sqkii circles")
        shrink_layer = _find_layer("shrink pattern")

        def _map_by_fid(layer):
            out = {}
            if isinstance(layer, dict):
                feats = (layer.get("data") or {}).get("features") or []
                if isinstance(feats, list):
                    for f in feats:
                        if not isinstance(f, dict):
                            continue
                        props = f.get("properties") or {}
                        fid = props.get("fid")
                        if fid:
                            out[str(fid)] = f
            return out

        old_live_map = _map_by_fid(live_layer_old)
        new_live_map = _map_by_fid(new_live_layer)

        def _root(fid):
            return _root_coin_id(fid) or fid

        live_root_to_feature = {}
        for fid, feat in new_live_map.items():
            live_root_to_feature[_root(fid)] = feat

        ongoing_roots = set(live_root_to_feature.keys())

        # Build Shrink Pattern (history)
        shrink_feats = []
        seen_hashes_by_coin = {}

        def _normalise_history_feature(f, is_blue):
            if not isinstance(f, dict):
                return
            props = f.setdefault("properties", {}) or {}
            style = f.setdefault("style", {}) or {}
            stroke_col = _BLUE_STROKE if is_blue else _GREY_STROKE
            fill_col = _BLUE_STROKE if is_blue else _GREY_FILL
            style["fillOpacity"] = 0.0
            style["fillColor"] = fill_col
            style["strokeColor"] = stroke_col
            style["strokeOpacity"] = 0.75
            style.setdefault("strokeWidth", 1.2)
            props["_fillOpacity"] = 0.0
            props["_fill"] = fill_col
            props["_stroke"] = stroke_col
            props["_strokeOpacity"] = 0.75

        if isinstance(shrink_layer, dict):
            existing_features = (shrink_layer.get("data") or {}).get("features") or []
            if isinstance(existing_features, list):
                for f in existing_features:
                    if not isinstance(f, dict):
                        continue
                    props = f.get("properties") or {}
                    fid_root = _root(str(props.get("fid") or ""))
                    if not fid_root or fid_root not in ongoing_roots:
                        continue
                    live_feat = live_root_to_feature.get(fid_root) or {}
                    live_name = ((live_feat.get("properties") or {}).get("name") or "")
                    is_blue = _is_blue_outline_name(str(live_name))
                    _ensure_archive_props(f, fid_root, live_name)
                    _normalise_history_feature(f, is_blue)
                    shrink_feats.append(f)
                    gh = _geom_hash(f.get("geometry") or {})
                    seen_hashes_by_coin.setdefault(fid_root, set()).add(gh)

        def _append_history_from_feature(src_feature, fid_root):
            if not isinstance(src_feature, dict):
                return
            props_src = src_feature.get("properties") or {}
            geom_src = src_feature.get("geometry") or {}
            if not props_src or not geom_src:
                return
            if fid_root not in ongoing_roots:
                return
            ghash = _geom_hash(geom_src)
            if ghash in seen_hashes_by_coin.get(fid_root, set()):
                return
            live_feat = live_root_to_feature.get(fid_root) or {}
            live_name = ((live_feat.get("properties") or {}).get("name") or "")
            is_blue = _is_blue_outline_name(str(live_name))
            ts_ms = _now_ms()
            hist_id = f"{fid_root}-{ts_ms}"
            stroke_col = _BLUE_STROKE if is_blue else _GREY_STROKE
            fill_col = _BLUE_STROKE if is_blue else _GREY_FILL
            props = {
                **props_src,
                "fid": hist_id,
                "_gid": hist_id,
                "_ts": ts_ms,
                "name": f"{props_src.get('name', fid_root)} (past)",
                "_fillOpacity": 0.0,
                "_strokeOpacity": 0.75,
                "_stroke": stroke_col,
                "_fill": fill_col,
            }
            style = {
                "strokeColor": stroke_col,
                "strokeOpacity": 0.75,
                "strokeWidth": (src_feature.get("style") or {}).get("strokeWidth", 1.2),
                "fillColor": fill_col,
                "fillOpacity": 0.0,
            }
            history_feature = {
                "type": "Feature",
                "geometry": geom_src,
                "properties": props,
                "style": style,
            }
            _ensure_archive_props(history_feature, fid_root, live_name)
            shrink_feats.append(history_feature)
            seen_hashes_by_coin.setdefault(fid_root, set()).add(ghash)

        for fid, newf in new_live_map.items():
            oldf = old_live_map.get(fid)
            if not oldf:
                continue
            old_geom = oldf.get("geometry") or {}
            new_geom = newf.get("geometry") or {}
            if _geom_hash(old_geom) != _geom_hash(new_geom):
                _append_history_from_feature(oldf, _root(fid))

        for f in shrink_feats:
            if not isinstance(f, dict):
                continue
            f.setdefault("style", {})
            f["style"]["fillOpacity"] = 0.0
            f.setdefault("properties", {})
            f["properties"]["_fillOpacity"] = 0.0

        # Pruning
        by_root = {}
        for f in shrink_feats:
            props = (f or {}).get("properties") or {}
            fid_root = _root(str(props.get("fid") or ""))
            if not fid_root:
                continue
            by_root.setdefault(fid_root, []).append(f)

        pruned = []
        for root_id, feats in by_root.items():
            feats.sort(key=_parse_ts_ms)
            if MAX_HISTORY_PER_COIN and len(feats) > MAX_HISTORY_PER_COIN:
                feats = feats[-MAX_HISTORY_PER_COIN:]
            pruned.extend(feats)

        if MAX_TOTAL_HISTORY and len(pruned) > MAX_TOTAL_HISTORY:
            pruned.sort(key=_parse_ts_ms)
            pruned = pruned[-MAX_TOTAL_HISTORY:]

        shrink_feats = pruned

        new_shrink_layer = {
            "id": 9998,
            "name": "Shrink Pattern",
            "visible": True,
            "data": {"type": "FeatureCollection", "features": shrink_feats},
            "items": [],
            "_deletedLayer": False,
        }

        final_layers = []
        for L in existing_layers:
            if not isinstance(L, dict):
                continue
            nm = (L.get("name") or "").lower()
            if nm not in ["live sqkii circles", "shrink pattern"]:
                final_layers.append(L)

        final_layers.extend([new_live_layer, new_shrink_layer])

        if PRINT_PAYLOAD_SIZE:
            try:
                payload_bytes = len(json.dumps(final_layers, separators=(",", ":")).encode("utf-8"))
                log.info(f"Payload size: {payload_bytes/1024/1024:.2f} MB")
            except Exception:
                pass

        _upsert_layers(sb, ROOM_CODE, final_layers)
        _sync_coin_history_archive(sb, ROOM_CODE, new_live_layer, new_shrink_layer, final_layers)

    if pts:
        HAVE_SENT_NON_EMPTY = True
        log.info(
            f"Synced {len(pts)} live circles and updated shrink history "
            f"in room '{ROOM_CODE}' (history size: {len(shrink_feats)})"
        )
    else:
        log.info(f"Cleared 0 circles to room '{ROOM_CODE}'")


# ===========================================================
# Loop
# ===========================================================

def mapper_sync_loop(get_points_fn):
    while True:
        try:
            pts = get_points_fn() or []
            sync_mapper_circles(pts)
        except Exception as e:
            log.error(f"Mapper sync error: {e}")
        time.sleep(SYNC_INTERVAL_SECONDS)
