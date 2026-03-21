create table if not exists public.room_presence (
  room_code text not null,
  session_id text not null,
  client_id text not null,
  device text,
  browser text,
  city text,
  country text,
  ip text,
  online_at timestamptz not null default timezone('utc'::text, now()),
  last_seen timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (room_code, session_id)
);

create index if not exists room_presence_room_code_last_seen_idx
  on public.room_presence (room_code, last_seen desc);

alter table public.room_presence enable row level security;

drop policy if exists "room_presence_select" on public.room_presence;
create policy "room_presence_select"
on public.room_presence
for select
to anon, authenticated
using (true);

drop policy if exists "room_presence_insert" on public.room_presence;
create policy "room_presence_insert"
on public.room_presence
for insert
to anon, authenticated
with check (true);

drop policy if exists "room_presence_update" on public.room_presence;
create policy "room_presence_update"
on public.room_presence
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "room_presence_delete" on public.room_presence;
create policy "room_presence_delete"
on public.room_presence
for delete
to anon, authenticated
using (true);
