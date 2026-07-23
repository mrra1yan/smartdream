-- =============================================================================
-- 0001_supabase_auth.sql
-- Migrate auth from the hand-rolled bcrypt + JWT scheme to Supabase Auth.
--
-- Run this ONCE in the Supabase Dashboard → SQL Editor.
--
-- PREREQUISITES (Dashboard → Authentication → Providers → Email):
--   * "Confirm email" must be OFF  → sign-ups are immediately usable, which
--     matches the existing admin-approval flow (status = 'pending' on signup,
--     an admin flips the user to 'approved').
--   * "Allow new users to sign up" must be ON.
--
-- SAFE TO RE-RUN: each statement is idempotent (IF EXISTS / IF NOT EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Link profiles.id → auth.users.id
-- -----------------------------------------------------------------------------
-- The application's `profiles` table now mirrors `auth.users` 1:1. A new auth
-- user's profile row is created automatically by the trigger below, so we make
-- the relationship explicit with a foreign key + cascade on delete (deleting
-- an auth user removes their profile).

-- Drop the legacy constraint if it was manually created previously.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Drop the legacy password column
-- -----------------------------------------------------------------------------
-- Passwords are now owned by `auth.users.encrypted_password`. The column is
-- safe to drop because this migration assumes a FRESH START (no existing users
-- to preserve). `IF EXISTS` keeps the migration re-runnable.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS password_hash;

-- -----------------------------------------------------------------------------
-- 3. Auto-create a profile row when an auth user signs up
-- -----------------------------------------------------------------------------
-- Supabase calls `handle_new_user` after `auth.users` INSERT. It copies the
-- metadata passed to `auth.signUp({ options: { data: {...} } })` into the
-- `profiles` columns. Defaults: role = 'user', status = 'pending'.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_first_name text := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  v_last_name  text := COALESCE(NEW.raw_user_meta_data->>'last_name',  '');
  v_phone      text := COALESCE(NEW.raw_user_meta_data->>'phone', '');
BEGIN
  INSERT INTO public.profiles (
    id, public_id, first_name, last_name, phone, email,
    role, status, is_elite, is_boosted,
    boost_model, auto_like_enabled, auto_like_model,
    auto_like_used, boosted_offer_count, created_at
  )
  VALUES (
    NEW.id,
    -- 8-digit numeric public id, random
    lpad(floor(random() * 90000000 + 10000000)::text, 8, '0'),
    v_first_name,
    v_last_name,
    v_phone,
    NEW.email,
    'user',
    'pending',
    false,
    false,
    'none',
    false,
    'none',
    0,
    0,
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 4. Keep role / status mirrored into the auth user's JWT metadata
-- -----------------------------------------------------------------------------
-- Edge middleware reads `role` and `status` from the session JWT without a DB
-- round-trip. Whenever those columns change on `profiles`, this trigger
-- reflects the change into `auth.users.raw_user_meta_data`, which Supabase
-- then propagates into the next issued access token.
--
-- (The actual token refresh still requires the user to re-auth or hit a
-- session-refresh path; the middleware calls supabase.auth.getUser() which
-- forces the latest claims to be fetched.)

CREATE OR REPLACE FUNCTION public.sync_profile_meta_to_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF (TG_OP = 'UPDATE') AND
     (OLD.role   IS DISTINCT FROM NEW.role   OR
      OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE auth.users
      SET raw_user_meta_data =
            jsonb_set(
              jsonb_set(
                COALESCE(raw_user_meta_data, '{}'::jsonb),
                '{role}',   to_jsonb(NEW.role::text), true),
              '{status}', to_jsonb(NEW.status::text), true)
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_role_status_change ON public.profiles;
CREATE TRIGGER on_profile_role_status_change
  AFTER UPDATE OF role, status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_meta_to_auth_user();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------
-- Enable RLS on the application tables. The service-role client bypasses RLS,
-- so all existing admin/server code keeps working; these policies only affect
-- queries made via the anon-key client (browser + RLS-aware SSR client).

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blogs     ENABLE ROW LEVEL SECURITY;

-- profiles: a user can read & update only their own row.
DROP POLICY IF EXISTS "profiles_select_own"   ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"   ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Blogs are public-readable.
DROP POLICY IF EXISTS "blogs_public_read" ON public.blogs;
CREATE POLICY "blogs_public_read" ON public.blogs
  FOR SELECT USING (published_at IS NOT NULL);

-- links / likes: users may read the rows they own; writes are funnelled
-- through server actions (service-role client) so no permissive INSERT/UPDATE
-- policy is added here. Tighten later if browser-side writes are introduced.
DROP POLICY IF EXISTS "links_select_own" ON public.links;
DROP POLICY IF EXISTS "links_select_own_or_public" ON public.links;
CREATE POLICY "links_select_own_or_public" ON public.links
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "likes_select_own" ON public.likes;
DROP POLICY IF EXISTS "likes_select_own_or_public" ON public.likes;
CREATE POLICY "likes_select_own_or_public" ON public.likes
  FOR SELECT USING (auth.uid() = liker_id OR auth.uid() = receiver_id);

-- =============================================================================
-- End of migration.
-- =============================================================================
