from __future__ import annotations

import argparse
from pathlib import Path

import duckdb


DEFAULT_COLUMNS = [
    "uuid",
    "source",
    "orig_id",
    "url",
    "city",
    "country",
    "continent",
    "lat",
    "lon",
    "datetime_local",
    "sequence_index",
    "sequence_id",
    "img_path",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Filter the combined streetscapes parquet down to Singapore rows."
    )
    parser.add_argument(
        "--input",
        default="data/raw/data/parquet/streetscapes.parquet",
        help="Input parquet path from download_streetscapes_parquet.py.",
    )
    parser.add_argument(
        "--output",
        default="data/filtered/singapore_streetscapes.csv",
        help="Output CSV path.",
    )
    parser.add_argument(
        "--country",
        default="singapore",
        help="Country name to match case-insensitively.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(
            f"Input parquet not found: {input_path}. Run download_streetscapes_parquet.py first."
        )

    columns_sql = ",\n        ".join(DEFAULT_COLUMNS)
    country = args.country.strip().lower()

    query = f"""
    COPY (
        SELECT
            {columns_sql}
        FROM read_parquet('{input_path.as_posix()}')
        WHERE lower(coalesce(country, '')) = '{country}'
           OR lower(coalesce(city, '')) = '{country}'
    )
    TO '{output_path.as_posix()}'
    (HEADER, DELIMITER ',');
    """

    print(f"Filtering Singapore rows from {input_path} ...")
    duckdb.sql(query)
    row_count = duckdb.sql(
        f"SELECT COUNT(*) AS n FROM read_csv_auto('{output_path.as_posix()}', header=true)"
    ).fetchone()[0]
    print(f"Done: {output_path}")
    print(f"Rows written: {row_count}")


if __name__ == "__main__":
    main()
