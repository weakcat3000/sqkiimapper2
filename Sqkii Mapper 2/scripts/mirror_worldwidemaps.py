from __future__ import annotations

import gzip
import json
import math
import shutil
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public" / "worldwidemaps"
TILES_DIR = PUBLIC_DIR / "tiles" / "htm_icons"
MAPS_DIR = PUBLIC_DIR / "maps" / "shopback_htm_icons"

TILES_JSON_URL = "https://worldwidemaps.sqkii.com/api/tiles/htm_icons/tiles.json"
TILE_URL_TEMPLATE = "https://worldwidemaps.sqkii.com/api/tiles/htm_icons/{z}/{x}/{y}"
SPRITE_JSON_URL = "https://worldwidemaps.sqkii.com/api/maps/shopback_htm_icons/sprite@2x.json"
SPRITE_PNG_URL = "https://worldwidemaps.sqkii.com/api/maps/shopback_htm_icons/sprite@2x.png"


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
    (TILES_DIR / "tiles.json").write_text(json.dumps(tiles_json, indent=2), encoding="utf-8")

    west, south, east, north = tiles_json["bounds"]
    minzoom = int(tiles_json["minzoom"])
    maxzoom = int(tiles_json["maxzoom"])

    total = 0
    for z in range(minzoom, maxzoom + 1):
        x0, x1 = lon2x(west, z), lon2x(east, z)
        y0, y1 = lat2y(north, z), lat2y(south, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                total += 1
                out_path = TILES_DIR / str(z) / str(x) / f"{y}.pbf"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                tile_url = TILE_URL_TEMPLATE.format(z=z, x=x, y=y)
                out_path.write_bytes(fetch_bytes(tile_url, compressed=True))
    print(f"Mirrored {total} vector tiles into {TILES_DIR}")


def mirror_sprites() -> None:
    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    (MAPS_DIR / "sprite@2x.json").write_bytes(fetch_bytes(SPRITE_JSON_URL))
    (MAPS_DIR / "sprite@2x.png").write_bytes(fetch_bytes(SPRITE_PNG_URL))
    print(f"Mirrored sprite sheet into {MAPS_DIR}")


def main() -> None:
    if PUBLIC_DIR.exists():
        shutil.rmtree(PUBLIC_DIR)
    mirror_tiles()
    mirror_sprites()


if __name__ == "__main__":
    main()
