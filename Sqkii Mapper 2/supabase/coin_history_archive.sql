create extension if not exists pgcrypto;

create table if not exists public.coin_history_archive (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  coin_label text not null,
  status text not null default 'found',
  shrink_count integer not null default 0,
  lifecycle jsonb not null default '[]'::jsonb,
  snapshot_state jsonb not null default '[]'::jsonb,
  exact_lat double precision,
  exact_lng double precision,
  exact_note text,
  archived_by text,
  updated_by text,
  first_shrink_at timestamptz,
  last_shrink_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists coin_history_archive_room_code_created_at_idx
  on public.coin_history_archive (room_code, created_at desc);

alter table public.coin_history_archive enable row level security;

drop policy if exists "coin_history_archive_select" on public.coin_history_archive;
create policy "coin_history_archive_select"
on public.coin_history_archive
for select
to anon, authenticated
using (true);

drop policy if exists "coin_history_archive_insert" on public.coin_history_archive;
create policy "coin_history_archive_insert"
on public.coin_history_archive
for insert
to anon, authenticated
with check (true);

drop policy if exists "coin_history_archive_update" on public.coin_history_archive;
create policy "coin_history_archive_update"
on public.coin_history_archive
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "coin_history_archive_delete" on public.coin_history_archive;
create policy "coin_history_archive_delete"
on public.coin_history_archive
for delete
to anon, authenticated
using (true);
