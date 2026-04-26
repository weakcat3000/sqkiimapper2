# Sqkii Silver Shorts Archive Analysis

Generated on 2026-04-14 from the `@sqkiimouse` Shorts archive.

## Scope

- Total Shorts surfaced from deep archive crawl: `1,560`
- Silver-matching reveal Shorts: `699`
- Canonical silver reveal units after deduping by `(series, coin_number)`: `593`

## Main Takeaways

- The silver archive is not one single campaign. It is a stack of different runs: `Singapore`, `SG60 Edition`, `Sentosa Edition`, `pandamart`, `Ho Chi Minh City`, `Mystery Cities`, plus a couple of one-off items.
- Raw Shorts counts overstate the number of unique reveals because some campaigns contain reposts or later re-uploads of the same coin number.
- The cleanest campaign for large-scale analysis is `SG60 Edition`: it currently appears as `194` unique silver reveal Shorts with no duplicates in the surfaced archive.
- The `Singapore` and `Ho Chi Minh City` sets include clear backfill/re-upload behavior, so archive counts should be read separately as:
  - posted Shorts
  - unique coin reveals

## Series Breakdown

| Series | Posted Shorts | Unique Coin Numbers | Duplicate Posts | Coin Range |
| --- | --- | --- | --- | --- |
| Singapore | 291 | 233 | 58 | 1-239 |
| SG60 Edition | 194 | 194 | 0 | 1-214 |
| Ho Chi Minh City | 91 | 62 | 29 | 2-74 |
| Sentosa Edition | 64 | 64 | 0 | 1-65 |
| pandamart | 33 | 33 | 0 | 1-33 |
| Mystery Cities | 24 | 5 grouped coin numbers | 19 | 1-5 |
| Other | 2 | 2 | 0 | 10, 111 |

## Date Ranges

| Series | Earliest surfaced upload | Latest surfaced upload | Notes |
| --- | --- | --- | --- |
| pandamart | 2023-03-09 | 2023-04-05 | earliest silver campaign surfaced in the archive |
| Mystery Cities | 2023-04-14 | 2024-12-02 | city-based mini-runs |
| Ho Chi Minh City | 2024-03-01 | 2025-05-22 | includes later repost/backfill activity |
| Singapore | 2024-10-10 | 2026-04-13 | heavy October 2024 backfill plus ongoing mainline uploads |
| Sentosa Edition | 2025-03-06 | 2025-04-03 | very compressed event run |
| SG60 Edition | 2025-10-16 | 2026-01-25 | dense special-event burst |
| Other | 2023-12-01 | 2026-01-06 | one-off outliers |

Overall surfaced date range: `2023-03-09` to `2026-04-13`.

## High-Signal Patterns

### 1. The archive is campaign-heavy, not just chronological

The Shorts feed mixes multiple games and regional/event variants into one channel history. That means a simple search for `Silver Coin #...` captures several overlapping numbering systems. Any hiding-spot analysis that lumps all of them together risks mixing fundamentally different hunt contexts.

### 2. Singapore and Ho Chi Minh City contain visible repost/backfill behavior

Examples from the surfaced archive:

- `Singapore` coin `#17` appears `4` times.
- `Singapore` coin `#14` appears `3` times.
- `Ho Chi Minh City` coins like `#2`, `#4`, `#8`, `#12`, `#13`, `#15`, `#16`, `#19`, `#21`, and `#22` each appear twice with widely separated upload dates.

This suggests the feed includes both original reveal posts and later reposts/backfills, especially around late `2024` and early `2025`.

### 3. October 2024 is a major archive/backfill moment

The `Singapore` set has a very large concentration of uploads in `2024-10`, which strongly suggests Sqkii bulk-posted or restored a large block of older Singapore reveal content at that time.

### 4. SG60 is the cleanest large structured silver dataset

The surfaced `SG60 Edition` archive currently has:

- `194` posted Shorts
- `194` unique coin numbers
- no duplicates in the surfaced crawl

That makes it the most reliable campaign for broad pattern comparison without heavy deduping.

### 5. Sentosa and pandamart are compact event runs

- `pandamart` is a short early run with `33` unique silver coins.
- `Sentosa Edition` is a concentrated burst with `64` unique silver coins from `2025-03-06` to `2025-04-03`.

These are useful if the goal is to compare hiding styles between compact sponsored/event hunts and the longer-running Singapore mainline.

## Mystery Cities Split

`Mystery Cities` is not a single city. It currently splits into these surfaced sub-runs:

| Subcampaign | Surfaced posts | Surfaced coin numbers |
| --- | --- | --- |
| HCM | 5 | 1,2,3,4,5 |
| JKT | 5 | 1,2,3,4,5 |
| KL | 5 | 1,2,3,4,5 |
| TYO | 4 | 1,3,4,5 |
| BKK | 3 | 1,2,4 |
| JB | 2 | 1,2 |

## Outliers

Two surfaced silver-matching Shorts do not fit the main campaign buckets cleanly:

- `Silver Coin #10 has been found in #HuntTheMouse — Silver Burger Quest!`
- `Silver Coin #111`

## Recommended Analysis Strategy

If the goal is hiding-spot analysis rather than archive bookkeeping, the best order is:

1. Use canonical unique reveals, not raw Shorts post counts.
2. Analyze campaigns separately.
3. Start with `Singapore` and `SG60 Edition`.
4. Treat `Singapore` and `Ho Chi Minh City` duplicates as repost/backfill noise unless the duplicate videos clearly show different reveal footage.

## Related Files

- [sqkii_silver_shorts_index.csv](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_silver_shorts_index.csv>)
- [sqkii_silver_shorts_index.md](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_silver_shorts_index.md>)
- [sqkii_silver_shorts_index_enriched_clean.csv](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_silver_shorts_index_enriched_clean.csv>)
