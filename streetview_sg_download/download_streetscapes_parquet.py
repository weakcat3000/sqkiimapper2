from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import hf_hub_download


DEFAULT_REPO_ID = "NUS-UAL/global-streetscapes"
DEFAULT_FILENAME = "data/parquet/streetscapes.parquet"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download the combined streetscapes parquet from Hugging Face."
    )
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID, help="Hugging Face dataset repo id.")
    parser.add_argument("--filename", default=DEFAULT_FILENAME, help="Dataset file path inside the repo.")
    parser.add_argument(
        "--output-dir",
        default="data/raw",
        help="Directory where the parquet should be placed.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {args.filename} from {args.repo_id} into {output_dir} ...")
    downloaded_path = hf_hub_download(
        repo_id=args.repo_id,
        repo_type="dataset",
        filename=args.filename,
        local_dir=str(output_dir),
        local_dir_use_symlinks=False,
    )
    print(f"Done: {downloaded_path}")


if __name__ == "__main__":
    main()
