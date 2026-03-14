-- Run this migration in Supabase SQL editor.
-- Adds car snapshot data to leaderboard runs so each result shows the car used.

begin;

alter table public.turborace_leaderboard
  add column if not exists car_name text,
  add column if not exists car_hex text;

update public.turborace_leaderboard
set car_name = nullif(trim(car_name), ''),
    car_hex = case
      when car_hex ~* '^#[0-9a-f]{6}$' then lower(car_hex)
      else null
    end;

commit;
