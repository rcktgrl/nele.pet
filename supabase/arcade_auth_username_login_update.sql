-- Run this migration in Supabase SQL editor.
-- Supports username-first login and robust username-history sync.


-- Enforce case-insensitive uniqueness for usernames.
create unique index if not exists arcade_profiles_username_lower_uidx
on public.arcade_profiles (lower(username));

-- Resolve login email from username without exposing table access patterns in the client.
create or replace function public.arcade_resolve_login_email(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$

  select p.email
  from public.arcade_profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))

  limit 1;
$$;

revoke all on function public.arcade_resolve_login_email(text) from public;
grant execute on function public.arcade_resolve_login_email(text) to anon, authenticated;

-- Sync all username references in leaderboard history.
-- Uses SECURITY DEFINER so historical rows without user_id can still be updated safely.
create or replace function public.arcade_sync_username_everywhere(
  p_user_id uuid,
  p_old_username text,
  p_new_username text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rows integer := 0;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  update public.turborace_leaderboard
  set username = trim(coalesce(p_new_username, ''))
  where user_id = p_user_id
     or lower(username) = lower(trim(coalesce(p_old_username, '')));

  get diagnostics updated_rows = row_count;
  return updated_rows;
end;
$$;

revoke all on function public.arcade_sync_username_everywhere(uuid, text, text) from public;
grant execute on function public.arcade_sync_username_everywhere(uuid, text, text) to authenticated;
