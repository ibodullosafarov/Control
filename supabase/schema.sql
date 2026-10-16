-- Control online rooms + profiles
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Online presence itself needs NO tables (Supabase Realtime Presence +
-- Broadcast are ephemeral). This schema only stores public profiles so
-- room peers can resolve display names, and is future-proofing for
-- persisted public rooms / history.

-- 1) Public profiles (one row per auth user) ------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Guest',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed in can read names (needed for the roster).
-- Users can only insert/update their own row.
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Auto-create a profile row on signup (display name from user metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Guest'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Realtime: nothing to configure ---------------------------------------
-- Presence + Broadcast on channels named `online-room:*` work out of the
-- box on every Supabase project. No replication / publication setup needed.
-- (If you later add persisted tables for public room listings, add them to
-- the supabase_realtime publication explicitly.)
