-- =============================================================================
--  DIAGNOSE: why does login say "Invalid login credentials"?
--  Paste into SQL Editor → Run → share the output.
-- =============================================================================

-- 1. auth.users state
select
  email,
  case when encrypted_password is null then 'NULL'
       else left(encrypted_password, 4) || '...' end as pwd_prefix,
  case when email_confirmed_at is null then 'NOT CONFIRMED'
       else 'CONFIRMED' end as email_state,
  aud,
  role as auth_role,
  instance_id
from auth.users
where email like '%@smartdream.app'
order by email;

-- 2. profiles state
select email, role, status, is_elite, public_id
from public.profiles
where email like '%@smartdream.app'
order by email;

-- 3. Show what instance_id Supabase actually expects (from existing rows)
select 'expected instance_id' as info, instance_id
from auth.users
limit 1;
