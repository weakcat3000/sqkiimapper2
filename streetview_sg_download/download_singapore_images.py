from __future__ import annotations

import argparse
import os
import random
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import mapillary.interface as mly
import pandas as pd
import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download Singapore streetscapes JPEGs from a filtered CSV."
    )
    parser.add_argument(
        "--csv",
        default="data/filtered/singapore_streetscapes.csv",
        help="Filtered CSV path with at least uuid, source, and orig_id columns.",
    )
    parser.add_argument(
        "--output-dir",
        default="images",
        help="Main output folder for downloaded images.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=32,
        help="Concurrent download workers.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=10000,
        help="Images per subfolder before rolling to the next folder.",
    )
    parser.add_argument(
        "--source",
        choices=["all", "mapillary", "kartaview"],
        default="all",
        help="Optional source filter.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional limit for a smaller run. Use 0 for all rows.",
    )
    parser.add_argument(
        "--mapillary-token",
        default=os.environ.get("MAPILLARY_ACCESS_TOKEN", "").strip(),
        help="Mapillary access token. Defaults to MAPILLARY_ACCESS_TOKEN env var.",
    )
    return parser.parse_args()


def normalize_source(value: object) -> str:
    text = str(value or "").strip().lower()
    if text == "mapillary":
        return "Mapillary"
    if text == "kartaview":
        return "KartaView"
    return str(value or "").strip()


def load_existing_uuids(output_dir: Path) -> set[str]:
    uuids: set[str] = set()
    if not output_dir.exists():
        return uuids
    for path in output_dir.rglob("*.jpeg"):
        uuids.add(path.stem)
    return uuids


def get_chunk_folder(output_dir: Path, row_number: int, chunk_size: int) -> Path:
    start = ((row_number - 1) // chunk_size) * chunk_size + 1
    end = start + chunk_size - 1
    folder = output_dir / f"{start}_{end}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def get_mapillary_image_url(image_id: object, token: str) -> str:
    if not token:
        raise RuntimeError("Missing Mapillary token. Set --mapillary-token or MAPILLARY_ACCESS_TOKEN.")
    mly.set_access_token(token)
    return mly.image_thumbnail(image_id, 2048)


def get_kartaview_image_url(image_id: object) -> str:
    url = f"https://api.openstreetcam.org/2.0/photo/?id={image_id}"
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    data = response.json()["result"]["data"][0]
    return data["fileurlProc"]


def download_binary(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "sg-streetscapes-downloader/1.0"})
    with urllib.request.urlopen(request, timeout=120) as web_file:
        data = web_file.read()
    destination.write_bytes(data)


def download_one(
    row_number: int,
    row: pd.Series,
    output_dir: Path,
    chunk_size: int,
    mapillary_token: str,
) -> tuple[str, str]:
    uuid = str(row["uuid"]).strip()
    source = normalize_source(row["source"])
    image_id = row["orig_id"]
    target_folder = get_chunk_folder(output_dir, row_number, chunk_size)
    destination = target_folder / f"{uuid}.jpeg"
    if destination.exists():
        return uuid, "exists"

    time.sleep(random.randint(1, 8) / 10)
    if source == "Mapillary":
        image_url = get_mapillary_image_url(image_id, mapillary_token)
    elif source == "KartaView":
        image_url = get_kartaview_image_url(image_id)
    else:
        raise RuntimeError(f"Unsupported source '{source}' for uuid {uuid}")

    download_binary(image_url, destination)
    return uuid, "downloaded"


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(
        csv_path,
        dtype={
            "uuid": "string",
            "source": "string",
            "orig_id": "string",
        },
    )
    required = {"uuid", "source", "orig_id"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {sorted(missing)}")

    df["source"] = df["source"].map(normalize_source)
    if args.source == "mapillary":
        df = df[df["source"] == "Mapillary"]
    elif args.source == "kartaview":
        df = df[df["source"] == "KartaView"]

    if args.limit > 0:
        df = df.head(args.limit)

    existing = load_existing_uuids(output_dir)
    if existing:
        df = df[~df["uuid"].astype(str).isin(existing)]

    if df.empty:
        print("No new images to download.")
        return

    print(f"Rows queued: {len(df)}")
    print(f"Output folder: {output_dir}")
    if (df["source"] == "Mapillary").any() and not args.mapillary_token:
        raise RuntimeError("Mapillary rows are present but no Mapillary token was provided.")

    success = 0
    failed = 0
    failed_rows: list[tuple[str, str]] = []
    counter_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(download_one, row_number, row, output_dir, args.chunk_size, args.mapillary_token): (
                row_number,
                str(row["uuid"]),
            )
            for row_number, (_, row) in enumerate(df.reset_index(drop=True).iterrows(), start=1)
        }
        for future in as_completed(futures):
            row_number, uuid = futures[future]
            try:
                _, status = future.result()
                with counter_lock:
                    success += 1
                    if success % 100 == 0 or success == len(futures):
                        print(f"Progress: {success}/{len(futures)} complete")
            except Exception as exc:  # noqa: BLE001
                with counter_lock:
                    failed += 1
                    failed_rows.append((uuid, str(exc)))
                print(f"Failed [{row_number}] {uuid}: {exc}")

    print(f"Downloaded: {success}")
    print(f"Failed: {failed}")
    if failed_rows:
        failed_path = output_dir / "failed_downloads.csv"
        pd.DataFrame(failed_rows, columns=["uuid", "error"]).to_csv(failed_path, index=False)
        print(f"Failed rows written to: {failed_path}")


if __name__ == "__main__":
    main()
