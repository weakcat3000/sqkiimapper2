from __future__ import annotations

import argparse
from pathlib import Path

import duckdb


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Make a small sample CSV from the Singapore streetscapes subset."
    )
    parser.add_argument(
        "--input",
        default="data/filtered/singapore_streetscapes.csv",
        help="Input Singapore CSV path.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional output CSV path. Defaults to singapore_streetscapes_sample_<limit>.csv.",
    )
    parser.add_argument("--limit", type=int, default=500, help="Number of rows to sample.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for repeatable samples.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise FileNotFoundError(
            f"Input CSV not found: {input_path}. Run filter_singapore_streetscapes.py first."
        )

    output_path = (
        Path(args.output).resolve()
        if args.output
        else input_path.with_name(f"singapore_streetscapes_sample_{args.limit}.csv")
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    query = f"""
    COPY (
        SELECT *
        FROM read_csv_auto('{input_path.as_posix()}', header=true)
        USING SAMPLE {args.limit} ROWS (reservoir, {args.seed})
    )
    TO '{output_path.as_posix()}'
    (HEADER, DELIMITER ',');
    """
    duckdb.sql(query)
    print(f"Done: {output_path}")


if __name__ == "__main__":
    main()
