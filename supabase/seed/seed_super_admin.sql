-- =============================================================================
--  CREATE FIRST SUPER ADMIN
-- =============================================================================
--  Run AFTER  setup.sql  has completed.
--
--  👉 EDIT THE TWO VALUES BELOW before running (email + password).
--     Then paste this whole file into:  Supabase Dashboard → SQL Editor → Run.
-- =============================================================================

do $$
declare
  v_email    text := 'admin@smartdream.app';          -- 👈 change me
  v_password text := 'ChangeMe123!';                  -- 👈 change me
  v_user_id  uuid;
begin
  -- 1) Create the auth user (auto-confirmed) with super_admin metadata.
  --    Using the auth schema admin helper so it works straight from SQL.
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, last_sign_in_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'first_name', 'Super',
      'last_name',  'Admin',
      'phone',      '',
      'role',       'super_admin',
      'status',     'approved'
    ),
    now(), now(), null
  )
  on conflict (a lower(email))  -- if the email already exists, skip insert
  do nothing
  returning id into v_user_id;

  -- If the user already existed, grab its id.
  if v_user_id is null then
    select id into v_user_id from auth.users where lower(email) = lower(v_email);
  end if;

  -- 2) Upsert the profiles row as super_admin / approved.
  insert into public.profiles (
    id, public_id, first_name, last_name, phone, email,
    role, status, is_elite, is_boosted,
    boost_model, auto_like_enabled, auto_like_model,
    auto_like_used, boosted_offer_count, created_at
  )
  values (
    v_user_id,
    lpad(floor(random() * 90000000 + 10000000)::text, 8, '0'),
    'Super', 'Admin', '', v_email,
    'super_admin', 'approved', false, false,
    'none', false, 'none',
    0, 0, now()
  )
  on conflict (id) do update
    set role   = 'super_admin',
        status = 'approved',
        email  = excluded.email;

  raise notice '✅ Super admin ready → email: %  (user id: %)', v_email, v_user_id;
end $$;
