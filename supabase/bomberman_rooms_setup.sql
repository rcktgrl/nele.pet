-- ─── Bomberman public room registry ─────────────────────────────────────────
-- Run this in the Supabase SQL editor for the nele.pet project.
--
-- Creates a lightweight room listing table so players can see and join
-- public rooms from the home screen without knowing the room code.
-- Private rooms skip this table entirely.

create table if not exists public.bomberman_rooms (
  code         text        primary key,
  host_name    text        not null,
  player_count integer     not null default 1
                           check (player_count between 1 and 4),
  status       text        not null default 'waiting'
                           check (status in ('waiting', 'started')),
  created_at   timestamptz not null default now()
);

-- Row-level security (all operations are public — no auth required for this table)
alter table public.bomberman_rooms enable row level security;

create policy "bomberman rooms: public read"
  on public.bomberman_rooms for select using (true);

create policy "bomberman rooms: public insert"
  on public.bomberman_rooms for insert with check (true);

create policy "bomberman rooms: public update"
  on public.bomberman_rooms for update using (true);

create policy "bomberman rooms: public delete"
  on public.bomberman_rooms for delete using (true);

-- Enable Realtime so the home page room list updates live
alter publication supabase_realtime add table public.bomberman_rooms;
