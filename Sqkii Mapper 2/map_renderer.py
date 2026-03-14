# ===========================================================
# map_renderer.py — Static map image generation
# ===========================================================
import os
import io
import math
import time

from PIL import Image, ImageDraw, ImageFilter

import config as cfg

log = cfg.log.getChild("map_renderer")


# ===========================================================
# Circle path (for Google Static Maps overlay)
# ===========================================================

def generate_circle_path(lat, lng, radius_m=100, points=30):
    R = 6378137
    path = []
    for i in range(points):
        angle = 2 * math.pi * i / points
        dx = radius_m * math.cos(angle)
        dy = radius_m * math.sin(angle)
        dlat = dy / R * (180 / math.pi)
        dlng = dx / (R * math.cos(math.pi * lat / 180)) * (180 / math.pi)
        path.append(f"{lat + dlat},{lng + dlng}")
    return "|".join(path)


# ===========================================================
# KML export
# ===========================================================

def kml_from_generate_circle_path(lat, lng, radius_m, name="Circle", points=256, out_path=None):
    path_str = generate_circle_path(lat, lng, radius_m, points=points)
    pairs = []
    for part in path_str.split("|"):
        la, lo = part.split(",")
        pairs.append((float(lo), float(la)))
    if pairs[0] != pairs[-1]:
        pairs.append(pairs[0])
    coord_str = " ".join([f"{x:.7f},{y:.7f},0" for x, y in pairs])
    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>{name}</name>
  <Style id="circleStyle">
    <LineStyle><color>ff3939e5</color><width>2</width></LineStyle>
    <PolyStyle><color>333939e5</color></PolyStyle>
  </Style>
  <Placemark>
    <name>{name}</name>
    <styleUrl>#circleStyle</styleUrl>
    <Polygon>
      <outerBoundaryIs><LinearRing><coordinates>{coord_str}</coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>
</Document>
</kml>"""
    if out_path is None:
        ts = int(time.time())
        out_path = os.path.join(cfg.PLOTS_FOLDER, f"circle_{lat:.6f}_{lng:.6f}_{int(radius_m)}_{ts}.kml")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(kml)
    return out_path


# ===========================================================
# Zoom calculation
# ===========================================================

def compute_zoom_for_radius(lat, radius_m, img_width=1280, img_height=960, padding_px=100):
    if not radius_m or radius_m <= 0:
        return 18
    usable_w = max(1, img_width - 2 * padding_px)
    usable_h = max(1, img_height - 2 * padding_px)
    diameter_m = 2.0 * radius_m * 1.05
    mpp0 = 156543.03392 * math.cos(math.radians(lat))
    z_w = math.log2((mpp0 * usable_w) / diameter_m)
    z_h = math.log2((mpp0 * usable_h) / diameter_m)
    z = int(math.floor(min(z_w, z_h)))
    return max(0, min(21, z))


def _bounds_from_circles(circles):
    lat_min = 90.0; lat_max = -90.0
    lng_min = 180.0; lng_max = -180.0
    for c in circles:
        lat = float(c["lat"]); lng = float(c["lng"]); r = float(c["radius"])
        dlat = r / 111320.0
        dlng = r / (111320.0 * max(0.01, math.cos(math.radians(lat))))
        lat_min = min(lat_min, lat - dlat); lat_max = max(lat_max, lat + dlat)
        lng_min = min(lng_min, lng - dlng); lng_max = max(lng_max, lng + dlng)
    return lat_min, lat_max, lng_min, lng_max


def _fit_zoom_for_bounds(lat_min, lat_max, lng_min, lng_max, img_w=1280, img_h=960, pad_px=120):
    if lat_min > lat_max or lng_min > lng_max:
        return 17
    lat_c = (lat_min + lat_max) / 2.0
    mpp0 = 156543.03392 * math.cos(math.radians(lat_c))
    usable_w = max(1, img_w - 2 * pad_px)
    usable_h = max(1, img_h - 2 * pad_px)
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * max(0.01, math.cos(math.radians(lat_c)))
    dx_m = max(1e-3, (lng_max - lng_min) * m_per_deg_lng)
    dy_m = max(1e-3, (lat_max - lat_min) * m_per_deg_lat)
    z_w = math.log2((mpp0 * usable_w) / dx_m)
    z_h = math.log2((mpp0 * usable_h) / dy_m)
    z = int(math.floor(min(z_w, z_h)))
    return max(0, min(21, z))


# ===========================================================
# Geoapify static circle image
# ===========================================================

def geoapify_static_circle_image(
    lat, lng, radius_m, out_png=None,
    width=None, height=None,
    img_w=None, img_h=None,
    padding_px=100,
    scale_factor=2,
    supersample=None,
    api_scale=None,
    style="osm-carto",
    sharpen=True,
    zoom_tightness=1.1
):
    effective_radius_m = float(radius_m) * 2.0
    _sf = api_scale if api_scale is not None else (supersample if supersample is not None else scale_factor)
    req_scale = int(max(1, min(2, int(round(float(_sf))))))
    api_key = cfg.GEOAPIFY_API_KEY

    W_css = int(img_w or width or 1600)
    H_css = int(img_h or height or 1200)
    usable_w = max(1, W_css - 2 * padding_px)
    usable_h = max(1, H_css - 2 * padding_px)
    usable_min = min(usable_w, usable_h)

    if out_png is None:
        ts = int(time.time())
        os.makedirs(cfg.PLOTS_FOLDER, exist_ok=True)
        out_png = os.path.join(cfg.PLOTS_FOLDER, f"circle_{lat:.6f}_{lng:.6f}_{int(effective_radius_m)}_{ts}.jpg")
    else:
        base, _ext = os.path.splitext(out_png)
        out_png = base + ".jpg"

    mpp0 = 156543.03392 * math.cos(math.radians(lat))
    diameter = 2.0 * effective_radius_m * 1.02
    z_w = math.log2((mpp0 * usable_w) / diameter)
    z_h = math.log2((mpp0 * usable_h) / diameter)
    z = max(0, min(22, int(math.floor(min(z_w, z_h)))))

    def circle_diameter_css(z_test):
        mpp_css = 156543.03392 * math.cos(math.radians(lat)) / (2 ** z_test)
        return (effective_radius_m / mpp_css) * 2.0

    while z < 22:
        next_diam = circle_diameter_css(z + 1)
        if next_diam <= usable_min * zoom_tightness:
            z += 1
        else:
            break

    base_url = "https://maps.geoapify.com/v1/staticmap"
    url = (
        f"{base_url}?style={style}"
        f"&width={W_css}&height={H_css}"
        f"&center=lonlat:{lng},{lat}&zoom={z}"
        f"&format=jpeg&scaleFactor={req_scale}"
        f"&apiKey={api_key}"
    )

    resp = cfg.GET(url, timeout=20)
    if resp.status_code != 200:
        raise RuntimeError(f"Geoapify static map error: {resp.status_code} {resp.text[:200]}")
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")

    bmp_w, bmp_h = img.size
    eff_scale_x = bmp_w / float(W_css) if W_css else 1.0
    eff_scale_y = bmp_h / float(H_css) if H_css else 1.0
    eff_scale = (eff_scale_x + eff_scale_y) / 2.0 or 1.0

    mpp_css = 156543.03392 * math.cos(math.radians(lat)) / (2 ** z)
    px_radius = max(1, int(round((effective_radius_m / mpp_css) * eff_scale)))

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = (img.size[0] // 2, img.size[1] // 2)
    bbox = (cx - px_radius, cy - px_radius, cx + px_radius, cy + px_radius)
    outline_w = max(3, int(round(3 * eff_scale)))
    draw.ellipse(bbox, fill=(229, 57, 53, 76))
    draw.ellipse(bbox, outline=(229, 57, 53, 220), width=outline_w)

    composed = Image.alpha_composite(img.convert("RGBA"), overlay)
    if sharpen:
        composed = composed.filter(ImageFilter.UnsharpMask(radius=1.1, percent=130, threshold=2))
    composed = composed.convert("RGB")

    def _save_compact_jpeg(pil_img, path, size_limit=9_900_000, start_q=88):
        pil_img.save(path, "JPEG", quality=start_q, optimize=True)
        try:
            if os.path.getsize(path) <= size_limit:
                return path
        except Exception:
            return path
        for q in (82, 75, 70, 65, 60, 55):
            pil_img.save(path, "JPEG", quality=q, optimize=True)
            if os.path.getsize(path) <= size_limit:
                return path
        w, h = pil_img.size
        downsized = pil_img.resize((max(600, int(w * 0.85)), max(400, int(h * 0.85))), Image.LANCZOS)
        downsized.save(path, "JPEG", quality=70, optimize=True)
        return path

    _save_compact_jpeg(composed, out_png)
    return out_png


# Alias for backward compat
render_worldwidemaps_circle_screenshot = geoapify_static_circle_image


# ===========================================================
# Google Static Maps
# ===========================================================

def download_static_map_image(lat, lng, coin_id, radius=100):
    os.makedirs(cfg.SCREENSHOT_FOLDER, exist_ok=True)
    path_coords = generate_circle_path(lat, lng, radius)
    path_circle = f"color:0x00000000|fillcolor:0xFF00004D|weight:2|{path_coords}"
    marker = f"color:red|{lat},{lng}"
    zoom = compute_zoom_for_radius(lat, radius, img_width=1280, img_height=960, padding_px=100)
    url = (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lng}&zoom={zoom}&size=1280x960&scale=2&maptype=roadmap"
        f"&markers={marker}&path={path_circle}&key={cfg.GOOGLE_MAPS_API_KEY}"
    )
    path = f"{cfg.SCREENSHOT_FOLDER}/{coin_id}.png"
    try:
        res = cfg.GET(url)
        if res.status_code == 200:
            with open(path, "wb") as f:
                f.write(res.content)
            return path
        else:
            log.warning(f"Map error HTTP {res.status_code} {res.text[:200]}")
    except Exception as e:
        log.error(f"Map error: {e}")
    return None


def download_static_map_dual_circle(coin_id, prev_circle, new_circle,
                                    img_w=1280, img_h=960, pad_px=120):
    os.makedirs(cfg.SCREENSHOT_FOLDER, exist_ok=True)
    lat_min, lat_max, lng_min, lng_max = _bounds_from_circles([prev_circle, new_circle])
    zoom = _fit_zoom_for_bounds(lat_min, lat_max, lng_min, lng_max, img_w, img_h, pad_px)

    center_lat = (prev_circle["lat"] + new_circle["lat"]) / 2.0
    center_lng = (prev_circle["lng"] + new_circle["lng"]) / 2.0
    base = (f"https://maps.googleapis.com/maps/api/staticmap"
            f"?center={center_lat},{center_lng}&zoom={zoom}&size={img_w}x{img_h}&scale=2&maptype=roadmap")

    def path_for(c, stroke, fill):
        coords = generate_circle_path(c["lat"], c["lng"], c["radius"], points=48)
        return f"&path=color:{stroke}|fillcolor:{fill}|weight:2|{coords}"

    parts = [base]
    parts.append(path_for(prev_circle, "0x1E88E5FF", "0x1E88E533"))
    parts.append(path_for(new_circle, "0xE53935FF", "0xE5393533"))
    parts.append(f"&key={cfg.GOOGLE_MAPS_API_KEY}")
    url = "".join(parts)

    out = f"{cfg.SCREENSHOT_FOLDER}/track_{coin_id}.png"
    try:
        r = cfg.GET(url)
        if r.status_code == 200:
            with open(out, "wb") as f:
                f.write(r.content)
            return out
        log.warning(f"DualCircle {r.status_code} {r.text[:200]}")
    except Exception as e:
        log.error(f"DualCircle error: {e}")
    return None
