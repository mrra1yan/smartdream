-- =============================================================================
--  SMART DREAM — COMPLETE SUPABASE SETUP (one-shot)
-- =============================================================================
--  Run this ONCE in:  Supabase Dashboard → SQL Editor → New query → Run.
--
--  It creates every table, wires up Supabase Auth, enables RLS, and seeds the
--  default settings row. Safe to re-run (everything is idempotent).
--
--  PREREQUISITE (Dashboard → Authentication → Providers → Email):
--    "Confirm email"  →  OFF        (auto-confirm on signup)
--    "Enable Email"   →  ON
--
--  AFTER RUNNING THIS:
--    Create the first super admin with  seed/seed_super_admin.sql  (separate
--    file, because it needs your real password).
-- =============================================================================


-- ===========================================================================
-- 0. EXTENSIONS
-- ===========================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid(), crypt()


-- ===========================================================================
-- 1. BASE TABLES  (match the TypeScript row types in src/lib/supabase.ts)
-- ===========================================================================

-- ---- profiles -------------------------------------------------------------
-- NOTE: `id` is a plain uuid here; section 3 adds the FK → auth.users(id).
-- No password_hash column — Supabase Auth owns passwords.
create table if not exists public.profiles (
  id                                         uuid primary key,
  public_id                                  text unique,
  first_name                                 text,
  last_name                                  text,
  phone                                      text,
  email                                      text,
  role                                       text not null default 'user',
  status                                     text not null default 'pending',
  is_elite                                   boolean not null default false,
  is_boosted                                 boolean not null default false,
  boost_order                                integer,
  boost_model                                text not null default 'none',
  boost_expiry                               timestamptz,
  boost_quota                                integer,
  boost_used                                 integer not null default 0,
  auto_like_enabled                          boolean not null default false,
  auto_like_model                            text not null default 'none',
  auto_like_expiry                           timestamptz,
  auto_like_quota                            integer,
  auto_like_used                             integer not null default 0,
  free_autolike_until                        timestamptz,
  auto_like_paused                           boolean not null default false,
  auto_like_paused_remaining_minutes         integer,
  free_autolike_paused_remaining_minutes     integer,
  boosted_offer_count                        integer not null default 0,
  referred_by                                uuid,
  approved_by                                uuid,
  created_at                                 timestamptz not null default now()
);

create index if not exists profiles_email_idx     on public.profiles (email);
create index if not exists profiles_phone_idx     on public.profiles (phone);
create index if not exists profiles_public_id_idx on public.profiles (public_id);

-- ---- links ----------------------------------------------------------------
create table if not exists public.links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete cascade,
  url         text,
  likes_count integer not null default 0,
  sort_order  bigint not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists links_user_id_idx on public.links (user_id);

-- ---- likes ----------------------------------------------------------------
create table if not exists public.likes (
  id              uuid primary key default gen_random_uuid(),
  liker_id        uuid references public.profiles (id) on delete set null,
  link_id         uuid references public.links (id) on delete cascade,
  receiver_id     uuid references public.profiles (id) on delete cascade,
  is_anonymous    boolean not null default false,
  is_boosted_like boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists likes_receiver_idx on public.likes (receiver_id);
create index if not exists likes_liker_idx    on public.likes (liker_id);

-- ---- blogs ----------------------------------------------------------------
create table if not exists public.blogs (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  slug         text unique,
  excerpt      text,
  content      text,
  hero_image   text,
  published_at timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- ---- settings -------------------------------------------------------------
-- Single-row config table. The app reads row id='1'.
create table if not exists public.settings (
  id                                  text primary key default '1',
  whatsapp_number                     text,
  active_like_count                   integer not null default 0,
  active_window_hours                 integer not null default 24,
  elite_weight                        integer not null default 50,
  offer_likes_required                integer not null default 100,
  offer_autolike_minutes              integer not null default 60,
  offer_active                        boolean not null default false,
  boost_price_no_expiry               integer,
  boost_price_1w                      integer,
  boost_price_1m                      integer,
  boost_price_3m                      integer,
  boost_price_6m                      integer,
  boost_price_1y                      integer,
  boost_price_usage_per_unit          integer,
  autolike_price_no_expiry            integer,
  autolike_price_1w                   integer,
  autolike_price_1m                   integer,
  autolike_price_3m                   integer,
  autolike_price_6m                   integer,
  autolike_price_1y                   integer,
  autolike_price_usage_per_unit       integer,
  referral_reward_referrer_minutes    integer not null default 1440,
  referral_reward_referee_minutes     integer not null default 720,
  level1_name                         text,
  level1_threshold                    integer,
  level2_name                         text,
  level2_threshold                    integer,
  level3_name                         text,
  level3_threshold                    integer,
  level4_name                         text,
  level4_threshold                    integer,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now()
);


-- ===========================================================================
-- 2. SETTINGS SEED  (one row, id='1')
-- ===========================================================================
insert into public.settings (id) values ('1')
on conflict (id) do nothing;


-- ===========================================================================
-- 3. LINK profiles → auth.users  +  DROP legacy password column
-- ===========================================================================
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

alter table public.profiles
  drop column if exists password_hash;


-- ===========================================================================
-- 4. AUTO-CREATE PROFILE ON SIGNUP
-- ===========================================================================
-- When a user signs up via Supabase Auth, this trigger inserts the matching
-- profiles row with role='user', status='pending', copying the metadata
-- passed to auth.signUp({ options: { data: {...} } }).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_first_name text := coalesce(new.raw_user_meta_data->>'first_name', '');
  v_last_name  text := coalesce(new.raw_user_meta_data->>'last_name',  '');
  v_phone      text := coalesce(new.raw_user_meta_data->>'phone', '');
begin
  insert into public.profiles (
    id, public_id, first_name, last_name, phone, email,
    role, status, is_elite, is_boosted,
    boost_model, auto_like_enabled, auto_like_model,
    auto_like_used, boosted_offer_count, created_at
  )
  values (
    new.id,
    lpad(floor(random() * 90000000 + 10000000)::text, 8, '0'),
    v_first_name, v_last_name, v_phone, new.email,
    'user', 'pending', false, false,
    'none', false, 'none',
    0, 0, now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ===========================================================================
-- 5. MIRROR role / status INTO auth.users.raw_user_meta_data
-- ===========================================================================
-- Edge middleware reads role + status from the JWT (no DB call). Whenever
-- those columns change on profiles, this trigger reflects the change into
-- the auth user's metadata, which Supabase then propagates into the token.

create or replace function public.sync_profile_meta_to_auth_user()
returns trigger
language plpgsql
security definer set search_path = public, auth
as $$
begin
  if (tg_op = 'UPDATE') and (
       old.role   is distinct from new.role or
       old.status is distinct from new.status
     ) then
    update auth.users
      set raw_user_meta_data =
            jsonb_set(
              jsonb_set(
                coalesce(raw_user_meta_data, '{}'::jsonb),
                '{role}',   to_jsonb(new.role::text), true),
              '{status}', to_jsonb(new.status::text), true)
      where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_status_change on public.profiles;
create trigger on_profile_role_status_change
  after update of role, status on public.profiles
  for each row execute function public.sync_profile_meta_to_auth_user();


-- ===========================================================================
-- 6. ROW LEVEL SECURITY
-- ===========================================================================
-- The service-role client bypasses RLS, so all server-side admin code keeps
-- working. These policies only affect queries via the anon-key client
-- (browser + the RLS-aware SSR client).

alter table public.profiles enable row level security;
alter table public.links     enable row level security;
alter table public.likes     enable row level security;
alter table public.blogs     enable row level security;
alter table public.settings enable row level security;

-- profiles: read & update only your own row
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- blogs: anyone can read published posts
drop policy if exists "blogs_public_read" on public.blogs;
create policy "blogs_public_read" on public.blogs
  for select using (published_at is not null);

-- links: owner can read their own
drop policy if exists "links_select_own_or_public" on public.links;
create policy "links_select_own_or_public" on public.links
  for select using (auth.uid() = user_id);

-- likes: liker or receiver can read
drop policy if exists "likes_select_own_or_public" on public.likes;
create policy "likes_select_own_or_public" on public.likes
  for select using (auth.uid() = liker_id or auth.uid() = receiver_id);

-- settings: anyone can READ (pricing/whatsapp is public), nobody can WRITE
-- via anon/authenticated keys — updates happen only through server actions
-- that use the service-role client (which bypasses RLS).
drop policy if exists "settings_public_read" on public.settings;
create policy "settings_public_read" on public.settings
  for select using (true);


-- ===========================================================================
-- DONE.  Next: create the super admin →  see  supabase/seed/seed_super_admin.sql
-- ===========================================================================
