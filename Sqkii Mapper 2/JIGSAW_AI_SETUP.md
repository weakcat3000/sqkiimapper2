# Jigsaw AI Setup

Run `supabase/supabase_schema_jigsaw.sql` in the Supabase SQL editor before using Jigsaw AI.

The SQL also creates these public Supabase Storage buckets and object policies:

- `jigsaw-pieces`
- `jigsaw-stitched-boards`
- `jigsaw-analysis-uploads`

The first version uses mock OpenAI, Gemini, Singapore reference search, and Street View verification services. The interfaces already pass the selected coin boundary:

- Singapore-only
- selected coin center latitude / longitude
- selected coin radius in metres

All candidates are deterministically checked with the selected coin circle before weighted voting, map display, and Street View verification.

Google Maps and Street View panels require a browser API key. Set one of:

- `VITE_GOOGLE_MAPS_API_KEY` before building/running Vite
- `window.SQKII_GOOGLE_MAPS_API_KEY`
- `localStorage.setItem('sqkii_google_maps_api_key', 'YOUR_KEY')`

Safety scope: Jigsaw AI is only for public Singapore game clues. Do not use it to locate private homes, individuals, schools, workplaces, or personal routines.
