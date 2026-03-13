-- Run this migration in Supabase SQL editor.
-- Supports username-first login and robust username-history sync.
-- Safe to re-run on branches to reduce merge conflicts.

begin;


-- Allow mixed-case usernames while still enforcing case-insensitive uniqueness.
alter table public.arcade_profiles
  drop constraint if exists arcade_profiles_username_format;

alter table public.arcade_profiles
  add constraint arcade_profiles_username_format
  check (username ~ '^[A-Za-z0-9_.-]{3,24}$');

-- Enforce case-insensitive uniqueness for usernames.
create unique index if not exists arcade_profiles_username_lower_uidx
on public.arcade_profiles (lower(username));

-- Resolve login email from username without exposing table access patterns in the client.
-- Also supports legacy users that may exist in auth.users before their public profile row was upserted.
create or replace function public.arcade_resolve_login_email(p_username text)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  lookup_username text := lower(trim(coalesce(p_username, '')));
  resolved_email text;
begin
  if lookup_username = '' then
    return null;
  end if;

  select p.email
  into resolved_email
  from public.arcade_profiles p
  where lower(p.username) = lookup_username
  limit 1;

  if resolved_email is not null then
    return lower(trim(resolved_email));
  end if;

  -- Legacy fallback: query auth.users metadata directly.
  select u.email
  into resolved_email
  from auth.users u
  where lower(coalesce(u.raw_user_meta_data->>'username', '')) = lookup_username
  limit 1;

  return lower(trim(coalesce(resolved_email, '')));
end;
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

commit;
