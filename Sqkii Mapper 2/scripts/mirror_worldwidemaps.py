from __future__ import annotations

import gzip
import json
import math
import os
import shutil
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public" / "worldwidemaps"
TILES_DIR = PUBLIC_DIR / "tiles" / "htm_icons"
HTM_MAPS_DIR = PUBLIC_DIR / "maps" / "htm_icons"
SHOPBACK_MAPS_DIR = PUBLIC_DIR / "maps" / "shopback_htm_icons"
FALLBACK_TILE_BOUNDS = [103.582686, 1.016277, 104.031312, 1.4939]
MAX_TILE_WORKERS = 16

TILES_JSON_URL = "https://worldwidemaps.sqkii.com/api/tiles/htm_icons/tiles.json"
TILE_URL_TEMPLATE = "https://worldwidemaps.sqkii.com/api/tiles/htm_icons/{z}/{x}/{y}"
HTM_STYLE_JSON_URL = "https://worldwidemaps.sqkii.com/api/maps/htm_icons/style.json"
HTM_SPRITE_JSON_URL = "https://worldwidemaps.sqkii.com/api/maps/htm_icons/sprite@2x.json"
HTM_SPRITE_PNG_URL = "https://worldwidemaps.sqkii.com/api/maps/htm_icons/sprite@2x.png"
SHOPBACK_SPRITE_JSON_URL = "https://worldwidemaps.sqkii.com/api/maps/shopback_htm_icons/sprite@2x.json"
SHOPBACK_SPRITE_PNG_URL = "https://worldwidemaps.sqkii.com/api/maps/shopback_htm_icons/sprite@2x.png"


def fetch_bytes(url: str, *, compressed: bool = False) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "sqkii-mapper2-mirror/1.0"})
    if compressed:
        req.add_header("Accept-Encoding", "gzip")
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
        if compressed and resp.headers.get("Content-Encoding", "").lower() == "gzip":
            return gzip.decompress(data)
        return data


def lon2x(lon: float, z: int) -> int:
    return int(math.floor((lon + 180.0) / 360.0 * (2**z)))


def lat2y(lat: float, z: int) -> int:
    clamped = max(min(lat, 85.05112878), -85.05112878)
    lat_rad = math.radians(clamped)
    return int(
        math.floor(
            (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * (2**z)
        )
    )


def mirror_tiles() -> None:
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    tiles_json = json.loads(fetch_bytes(TILES_JSON_URL).decode("utf-8"))
    west, south, east, north = tiles_json["bounds"]
    if west < 100 or south <= 0:
        west, south, east, north = FALLBACK_TILE_BOUNDS
        tiles_json["bounds"] = [west, south, east, north]
    tiles_json["tiles"] = ["./{z}/{x}/{y}.pbf"]
    (TILES_DIR / "tiles.json").write_text(json.dumps(tiles_json, indent=2), encoding="utf-8")

    minzoom = int(tiles_json["minzoom"])
    maxzoom = int(tiles_json["maxzoom"])

    tile_jobs: list[tuple[int, int, int]] = []
    for z in range(minzoom, maxzoom + 1):
        x0, x1 = lon2x(west, z), lon2x(east, z)
        y0, y1 = lat2y(north, z), lat2y(south, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                tile_jobs.append((z, x, y))

    def download_tile(job: tuple[int, int, int]) -> None:
        z, x, y = job
        out_path = TILES_DIR / str(z) / str(x) / f"{y}.pbf"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tile_url = TILE_URL_TEMPLATE.format(z=z, x=x, y=y)
        out_path.write_bytes(fetch_bytes(tile_url, compressed=True))

    total = len(tile_jobs)
    completed = 0
    with ThreadPoolExecutor(max_workers=MAX_TILE_WORKERS) as executor:
        futures = [executor.submit(download_tile, job) for job in tile_jobs]
        for future in as_completed(futures):
            future.result()
            completed += 1
            if completed % 100 == 0 or completed == total:
                print(f"Downloaded {completed}/{total} HTM tiles")
    print(f"Mirrored {total} vector tiles into {TILES_DIR}")


def mirror_htm_style_bundle() -> None:
    HTM_MAPS_DIR.mkdir(parents=True, exist_ok=True)
    style_json = json.loads(fetch_bytes(HTM_STYLE_JSON_URL).decode("utf-8"))
    style_json["sprite"] = "./sprite"
    if isinstance(style_json.get("sources", {}).get("htm_icons"), dict):
        style_json["sources"]["htm_icons"]["url"] = "../../tiles/htm_icons/tiles.json"
    (HTM_MAPS_DIR / "style.json").write_text(json.dumps(style_json, indent=2), encoding="utf-8")
    (HTM_MAPS_DIR / "sprite@2x.json").write_bytes(fetch_bytes(HTM_SPRITE_JSON_URL))
    (HTM_MAPS_DIR / "sprite@2x.png").write_bytes(fetch_bytes(HTM_SPRITE_PNG_URL))
    print(f"Mirrored HTM style bundle into {HTM_MAPS_DIR}")


def mirror_shopback_sprites() -> None:
    SHOPBACK_MAPS_DIR.mkdir(parents=True, exist_ok=True)
    (SHOPBACK_MAPS_DIR / "sprite@2x.json").write_bytes(fetch_bytes(SHOPBACK_SPRITE_JSON_URL))
    (SHOPBACK_MAPS_DIR / "sprite@2x.png").write_bytes(fetch_bytes(SHOPBACK_SPRITE_PNG_URL))
    print(f"Mirrored ShopBack sprite sheet into {SHOPBACK_MAPS_DIR}")


def _handle_remove_error(func, path, exc_info) -> None:
    try:
        os.chmod(path, 0o777)
    except OSError:
        pass
    func(path)


def clear_dir_contents(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for child in path.iterdir():
        if child.is_dir():
            shutil.rmtree(child, onexc=_handle_remove_error)
        else:
            child.unlink(missing_ok=True)


def main() -> None:
    clear_dir_contents(TILES_DIR)
    clear_dir_contents(HTM_MAPS_DIR)
    clear_dir_contents(SHOPBACK_MAPS_DIR)
    mirror_tiles()
    mirror_htm_style_bundle()
    mirror_shopback_sprites()


if __name__ == "__main__":
    main()
