-- =============================================================================
--  SEED DEMO USERS  (super admin + admin + elite + 2 regular users)
-- =============================================================================
--  Run AFTER  setup.sql.  Paste into Supabase Dashboard → SQL Editor → Run.
--
--  👉 EDIT THE PASSWORD BELOW if you want (same for all 5 users):
--     v_password := 'Password123!'
--
--  Creates (all auto-confirmed, all approved so they can log in immediately):
--     superadmin@smartdream.app   super_admin
--     admin@smartdream.app        admin
--     elite@smartdream.app        user (is_elite = true)
--     user1@smartdream.app        user
--     user2@smartdream.app        user
--
--  Idempotent: safe to re-run — existing users are updated, never duplicated.
-- =============================================================================

do $$
declare
  v_password text := 'Password123!';   -- 👈 change me (shared by all users)
  v_rec      record;
  v_user_id  uuid;
  v_hash     text;
  v_pubid    text;
begin
  v_hash := crypt(v_password, gen_salt('bf', 10));

  for v_rec in (
    select * from (values
      -- (email,                     role,         status,     is_elite, first_name, last_name)
      ('superadmin@smartdream.app',  'super_admin','approved', false,    'Super',     'Admin'),
      ('admin@smartdream.app',       'admin',      'approved', false,    'Test',      'Admin'),
      ('elite@smartdream.app',       'user',       'approved', true,     'Elite',     'User'),
      ('user1@smartdream.app',       'user',       'approved', false,    'Regular',   'One'),
      ('user2@smartdream.app',       'user',       'approved', false,    'Regular',   'Two')
    ) as t(email, role, status, is_elite, first_name, last_name)
  )
  loop
    -- 1) Does the auth user already exist?
    select id into v_user_id
      from auth.users
      where lower(email) = lower(v_rec.email);

    -- 2) No → create it (auto-confirmed, with role/status metadata so the
    --    JWT carries them for the edge middleware).
    if v_user_id is null then
      v_user_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, last_sign_in_at
      )
      values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        v_rec.email,
        v_hash,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'first_name', v_rec.first_name,
          'last_name',  v_rec.last_name,
          'phone',      '',
          'role',       v_rec.role,
          'status',     v_rec.status
        ),
        now(), now(), null
      );
    else
      -- Existing user → just refresh password + metadata.
      update auth.users
        set encrypted_password = v_hash,
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            raw_user_meta_data = jsonb_build_object(
              'first_name', v_rec.first_name,
              'last_name',  v_rec.last_name,
              'phone',      '',
              'role',       v_rec.role,
              'status',     v_rec.status
            )
        where id = v_user_id;
    end if;

    -- 3) Upsert the profiles row.
    v_pubid := lpad(floor(random() * 90000000 + 10000000)::text, 8, '0');

    insert into public.profiles (
      id, public_id, first_name, last_name, phone, email,
      role, status, is_elite, is_boosted,
      boost_model, auto_like_enabled, auto_like_model,
      auto_like_used, boosted_offer_count, created_at
    )
    values (
      v_user_id, v_pubid, v_rec.first_name, v_rec.last_name, '', v_rec.email,
      v_rec.role, v_rec.status, v_rec.is_elite, false,
      'none', false, 'none',
      0, 0, now()
    )
    on conflict (id) do update
      set role     = excluded.role,
          status   = excluded.status,
          is_elite = excluded.is_elite,
          email    = excluded.email;

    raise notice '✅ %  (% / %)', v_rec.email, v_rec.role, v_rec.status;

    v_user_id := null;
  end loop;

  raise notice '============================================';
  raise notice 'All demo users ready. Password: %', v_password;
  raise notice '============================================';
end $$;
