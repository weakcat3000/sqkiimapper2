create extension if not exists pgcrypto;

create table if not exists public.jigsaw_puzzles (
  id uuid primary key default gen_random_uuid(),
  coin_id text not null,
  coin_name text,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m double precision not null,
  grid_rows int not null default 4,
  grid_cols int not null default 4,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists jigsaw_puzzles_coin_id_idx
  on public.jigsaw_puzzles (coin_id);

alter table public.jigsaw_puzzles
  alter column grid_rows set default 4,
  alter column grid_cols set default 4;

create table if not exists public.jigsaw_pieces (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid references public.jigsaw_puzzles(id) on delete cascade,
  coin_id text not null,
  row_index int not null,
  col_index int not null,
  image_url text not null,
  notes text,
  created_at timestamptz default now(),
  unique(puzzle_id, row_index, col_index)
);

create index if not exists jigsaw_pieces_puzzle_id_idx
  on public.jigsaw_pieces (puzzle_id);

update public.jigsaw_puzzles p
set grid_rows = 4,
    grid_cols = 4,
    updated_at = now()
where (p.grid_rows > 4 or p.grid_cols > 4)
  and not exists (
    select 1
    from public.jigsaw_pieces piece
    where piece.puzzle_id = p.id
  );

create table if not exists public.jigsaw_analyses (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid references public.jigsaw_puzzles(id) on delete cascade,
  coin_id text not null,
  input_type text not null,
  input_image_url text,
  stitched_image_url text,
  notes text,
  status text default 'pending',
  final_label text,
  final_score numeric,
  raw_result jsonb,
  created_at timestamptz default now()
);

create index if not exists jigsaw_analyses_puzzle_id_idx
  on public.jigsaw_analyses (puzzle_id);

create table if not exists public.jigsaw_candidates (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references public.jigsaw_analyses(id) on delete cascade,
  location_name text,
  lat double precision,
  lng double precision,
  inside_radius boolean default true,
  distance_from_coin_center_m numeric,
  model_votes jsonb,
  weighted_score numeric,
  streetview_score numeric,
  label text,
  reasoning text,
  created_at timestamptz default now()
);

create index if not exists jigsaw_candidates_analysis_id_idx
  on public.jigsaw_candidates (analysis_id);

create table if not exists public.jigsaw_selected_candidates (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references public.jigsaw_analyses(id) on delete cascade,
  coin_id text not null,
  candidate_id uuid references public.jigsaw_candidates(id) on delete set null,
  location_name text,
  lat double precision,
  lng double precision,
  user_notes text,
  created_at timestamptz default now()
);

alter table public.jigsaw_puzzles enable row level security;
alter table public.jigsaw_pieces enable row level security;
alter table public.jigsaw_analyses enable row level security;
alter table public.jigsaw_candidates enable row level security;
alter table public.jigsaw_selected_candidates enable row level security;

drop policy if exists "jigsaw_puzzles_select" on public.jigsaw_puzzles;
create policy "jigsaw_puzzles_select" on public.jigsaw_puzzles for select to anon, authenticated using (true);
drop policy if exists "jigsaw_puzzles_insert" on public.jigsaw_puzzles;
create policy "jigsaw_puzzles_insert" on public.jigsaw_puzzles for insert to anon, authenticated with check (true);
drop policy if exists "jigsaw_puzzles_update" on public.jigsaw_puzzles;
create policy "jigsaw_puzzles_update" on public.jigsaw_puzzles for update to anon, authenticated using (true) with check (true);
drop policy if exists "jigsaw_puzzles_delete" on public.jigsaw_puzzles;
create policy "jigsaw_puzzles_delete" on public.jigsaw_puzzles for delete to anon, authenticated using (true);

drop policy if exists "jigsaw_pieces_select" on public.jigsaw_pieces;
create policy "jigsaw_pieces_select" on public.jigsaw_pieces for select to anon, authenticated using (true);
drop policy if exists "jigsaw_pieces_insert" on public.jigsaw_pieces;
create policy "jigsaw_pieces_insert" on public.jigsaw_pieces for insert to anon, authenticated with check (true);
drop policy if exists "jigsaw_pieces_update" on public.jigsaw_pieces;
create policy "jigsaw_pieces_update" on public.jigsaw_pieces for update to anon, authenticated using (true) with check (true);
drop policy if exists "jigsaw_pieces_delete" on public.jigsaw_pieces;
create policy "jigsaw_pieces_delete" on public.jigsaw_pieces for delete to anon, authenticated using (true);

drop policy if exists "jigsaw_analyses_select" on public.jigsaw_analyses;
create policy "jigsaw_analyses_select" on public.jigsaw_analyses for select to anon, authenticated using (true);
drop policy if exists "jigsaw_analyses_insert" on public.jigsaw_analyses;
create policy "jigsaw_analyses_insert" on public.jigsaw_analyses for insert to anon, authenticated with check (true);
drop policy if exists "jigsaw_analyses_update" on public.jigsaw_analyses;
create policy "jigsaw_analyses_update" on public.jigsaw_analyses for update to anon, authenticated using (true) with check (true);

drop policy if exists "jigsaw_candidates_select" on public.jigsaw_candidates;
create policy "jigsaw_candidates_select" on public.jigsaw_candidates for select to anon, authenticated using (true);
drop policy if exists "jigsaw_candidates_insert" on public.jigsaw_candidates;
create policy "jigsaw_candidates_insert" on public.jigsaw_candidates for insert to anon, authenticated with check (true);
drop policy if exists "jigsaw_candidates_update" on public.jigsaw_candidates;
create policy "jigsaw_candidates_update" on public.jigsaw_candidates for update to anon, authenticated using (true) with check (true);

drop policy if exists "jigsaw_selected_candidates_select" on public.jigsaw_selected_candidates;
create policy "jigsaw_selected_candidates_select" on public.jigsaw_selected_candidates for select to anon, authenticated using (true);
drop policy if exists "jigsaw_selected_candidates_insert" on public.jigsaw_selected_candidates;
create policy "jigsaw_selected_candidates_insert" on public.jigsaw_selected_candidates for insert to anon, authenticated with check (true);
drop policy if exists "jigsaw_selected_candidates_update" on public.jigsaw_selected_candidates;
create policy "jigsaw_selected_candidates_update" on public.jigsaw_selected_candidates for update to anon, authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('jigsaw-pieces', 'jigsaw-pieces', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('jigsaw-stitched-boards', 'jigsaw-stitched-boards', true, 52428800, array['image/png', 'image/jpeg', 'image/webp']),
  ('jigsaw-analysis-uploads', 'jigsaw-analysis-uploads', true, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "jigsaw_storage_select" on storage.objects;
create policy "jigsaw_storage_select"
on storage.objects
for select
to anon, authenticated
using (bucket_id in ('jigsaw-pieces', 'jigsaw-stitched-boards', 'jigsaw-analysis-uploads'));

drop policy if exists "jigsaw_storage_insert" on storage.objects;
create policy "jigsaw_storage_insert"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id in ('jigsaw-pieces', 'jigsaw-stitched-boards', 'jigsaw-analysis-uploads'));

drop policy if exists "jigsaw_storage_update" on storage.objects;
create policy "jigsaw_storage_update"
on storage.objects
for update
to anon, authenticated
using (bucket_id in ('jigsaw-pieces', 'jigsaw-stitched-boards', 'jigsaw-analysis-uploads'))
with check (bucket_id in ('jigsaw-pieces', 'jigsaw-stitched-boards', 'jigsaw-analysis-uploads'));

drop policy if exists "jigsaw_storage_delete" on storage.objects;
create policy "jigsaw_storage_delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id in ('jigsaw-pieces', 'jigsaw-stitched-boards', 'jigsaw-analysis-uploads'));
