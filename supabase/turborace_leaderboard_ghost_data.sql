-- Run this migration in Supabase SQL editor.
-- Adds per-run ghost replay payloads for online leaderboard ghost playback.

begin;

alter table public.turborace_leaderboard
  add column if not exists ghost_data jsonb;

commit;
