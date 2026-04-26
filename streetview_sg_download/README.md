# Singapore Streetscapes Toolkit

Standalone scripts for downloading the `NUS-UAL/global-streetscapes` metadata, filtering it to Singapore, and then downloading the matching street-level images.

This folder is separate from `Sqkii Mapper 2` on purpose.

## What This Uses

- Dataset: `NUS-UAL/global-streetscapes`
- Metadata source: Hugging Face parquet
- Image sources: Mapillary and KartaView, using the dataset's `source` and `orig_id`

## Folder Layout

- `data/raw/`
  - downloaded parquet metadata
- `data/filtered/`
  - Singapore-only CSV outputs
- `images/`
  - downloaded JPEGs

## Install

```powershell
cd "C:\Users\yeoww\OneDrive\Desktop\Anti Gravity\Opencode\streetview_sg_download"
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Step 1: Download The Main Parquet

```powershell
python download_streetscapes_parquet.py
```

Default output:

- `data/raw/streetscapes.parquet`

## Step 2: Filter To Singapore

```powershell
python filter_singapore_streetscapes.py
```

Default output:

- `data/filtered/singapore_streetscapes.csv`

This CSV keeps the fields needed for image download:

- `uuid`
- `source`
- `orig_id`

and also keeps useful metadata like:

- `city`
- `country`
- `lat`
- `lon`
- `datetime_local`
- `sequence_id`
- `sequence_index`

## Step 3: Make A Small Test Sample First

```powershell
python sample_singapore_subset.py --limit 500
```

Default output:

- `data/filtered/singapore_streetscapes_sample_500.csv`

## Step 4: Download Images

You need a Mapillary access token for Mapillary-sourced images.

Set it for this PowerShell session:

```powershell
$env:MAPILLARY_ACCESS_TOKEN="your-token-here"
```

Then download a sample first:

```powershell
python download_singapore_images.py --csv data/filtered/singapore_streetscapes_sample_500.csv
```

Or download the full Singapore subset:

```powershell
python download_singapore_images.py --csv data/filtered/singapore_streetscapes.csv
```

## Notes

- The downloader is resumable. Re-run the same command to continue.
- Images are saved as `{uuid}.jpeg`.
- Output is chunked into folders like `1_10000`, `10001_20000`, etc.
- Some metadata rows may never download because the upstream image is no longer available.
- KartaView images do not require the Mapillary token.

## Useful Flags

Filter with a different parquet path:

```powershell
python filter_singapore_streetscapes.py --input data/raw/streetscapes.parquet --output data/filtered/sg.csv
```

Download with lower concurrency:

```powershell
python download_singapore_images.py --csv data/filtered/sg.csv --workers 24 --chunk-size 5000
```

Skip KartaView:

```powershell
python download_singapore_images.py --csv data/filtered/sg.csv --source mapillary
```

## Sources

- Hugging Face dataset: `https://huggingface.co/datasets/NUS-UAL/global-streetscapes`
- Dataset wiki download guide: `https://github.com/ualsg/global-streetscapes/wiki/2-Download-images`
