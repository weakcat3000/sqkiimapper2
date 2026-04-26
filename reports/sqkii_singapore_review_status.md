# Singapore Silver Review Status

Generated on 2026-04-14.

## Current State

- Canonical Singapore silver reveal set: `233` unique coin numbers
- Canonical list file:
  [sqkii_singapore_canonical_silver.csv](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_singapore_canonical_silver.csv>)
- Storyboard JSONs fetched cleanly so far: `38`
- First-pass contact sheets built from those fetched storyboards:
  - [sg_contact_1.jpg](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_sg_contacts/sg_contact_1.jpg>)
  - [sg_contact_2.jpg](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_sg_contacts/sg_contact_2.jpg>)
  - [sg_contact_3.jpg](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_sg_contacts/sg_contact_3.jpg>)
  - [sg_contact_4.jpg](</c:/Users/yeoww/OneDrive/Desktop/Anti Gravity/Opencode/reports/sqkii_sg_contacts/sg_contact_4.jpg>)

## Verified Constraint

The limiting issue is not archive discovery. The archive/index work is done.

The limiting issue is reveal-frame retrieval:

- `yt-dlp` only returned clean storyboard metadata for part of the canonical Singapore set.
- Direct storyboard URL extraction from Shorts HTML works in principle, but the image host is returning `403` for many raw storyboard image requests in this environment.
- Because of that, a truly correct frame-by-frame hiding-spot verification cannot yet be completed for all `233` canonical Singapore reveals from this session alone.

## What Is Reliable Right Now

- The canonical Singapore silver list is reliable.
- The duplicate/backfill issue is already handled for the canonical list.
- The first `38` storyboard-backed Singapore reveals can be reviewed visually from the contact sheets above.

## Why I Did Not Claim “Full Singapore Hiding Spot Data”

The user asked for hiding spots “by reviewing the frame by frame hiding spot, making sure the spot is correct”.

That standard is stricter than a title-based archive scrape or a thumbnail-only guess.

Without clean reveal-frame access for the full canonical set, claiming a complete Singapore hiding-spot dataset would overstate certainty.
