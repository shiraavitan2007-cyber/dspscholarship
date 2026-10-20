-- =============================================================
-- RateMyBrofessor (DSP professor reviews): database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again after making changes.
-- =============================================================

-- ---------- Who is allowed in ----------
-- The two shared logins. If you change these emails, change config.js too.
create or replace function public.is_member() returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in ('members@dspscholarship.com', 'admin@dspscholarship.com')
$$;

create or replace function public.is_admin() returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@dspscholarship.com'
$$;

-- Tags reviewers can pick. Keep in sync with TAGS in app.js.
create or replace function public.allowed_tags() returns text[]
language sql immutable
as $$
  select array[
    'Tough Grader', 'Get Ready to Read', 'Participation Matters', 'Extra Credit',
    'Group Projects', 'Amazing Lectures', 'Clear Grading Criteria', 'Gives Good Feedback',
    'Inspirational', 'Lots of Homework', 'Hilarious', 'Beware of Pop Quizzes',
    'So Many Papers', 'Caring', 'Respected', 'Lecture Heavy',
    'Test Heavy', 'Graded By Few Things', 'Accessible Outside Class', 'Online Savvy'
  ]::text[]
$$;

-- "fin3010" / "Fin - 3010" → "FIN 3010". Same rule as normalizeCourse in app.js.
create or replace function public.normalize_course(c text) returns text
language sql immutable
as $$
  select regexp_replace(upper(regexp_replace(trim(c), '\s+', ' ', 'g')), '^([A-Z]+)\s*-?\s*([0-9])', '\1 \2')
$$;

-- ---------- Tables ----------
create table if not exists public.professors (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 100),
  department text not null default '' check (char_length(department) <= 100),
  created_at timestamptz not null default now()
);
create unique index if not exists professors_name_dept_key
  on public.professors (lower(name), lower(department));

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  professor_id bigint not null references public.professors (id) on delete cascade,
  course_code text not null check (char_length(course_code) between 2 and 20),
  semester text not null,
  overall smallint not null check (overall between 1 and 5),
  difficulty smallint not null check (difficulty between 1 and 5),
  take_again boolean not null,
  grade text,
  tags text[] not null default '{}',
  body text not null,
  flagged boolean not null default false,
  flag_reason text,
  -- Reviews are anonymous. Whoever posts one gets a secret kept in their
  -- browser; only its hash is stored, and it is needed to edit or delete.
  edit_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_professor_id_idx on public.reviews (professor_id);

-- Columns and rules matching the RateMyBrofessor Google Form questions.
-- Written as changes so re-running this file upgrades an existing database.
alter table public.reviews add column if not exists attendance_mandatory boolean;
alter table public.reviews add column if not exists other_tag text;

-- UW grading system (https://www.washington.edu/students/gencat/front/Grading_Sys.html):
-- decimal grades 4.0 down to 0.7 in 0.1 steps, or 0.0 (E); plus the notations
-- S, NS, CR, NC, I (incomplete), N (in progress), W, HW, RD, and X (no grade submitted).
-- Older values are converted using UW's letter-to-number ranges.
alter table public.reviews drop constraint if exists reviews_grade_check;
update public.reviews set grade = case grade
  when 'A+' then '4.0' when 'A' then '4.0' when 'A-' then '3.7' when 'B+' then '3.3' when 'B' then '3.0'
  when 'B-' then '2.7' when 'C+' then '2.3' when 'C' then '2.0' when 'C-' then '1.7' when 'D+' then '1.3'
  when 'D' then '1.0' when 'D-' then '0.7' when 'F' then '0.0' when 'E' then '0.0' when 'Pass' then 'S'
  when 'Withdrew' then 'W' when 'Dropped' then 'W'
  else grade end
where grade is not null;
alter table public.reviews add constraint reviews_grade_check
  check (grade ~ '^(4\.0|[1-3]\.[0-9]|0\.[7-9]|0\.0)$'
         or grade in ('S', 'NS', 'CR', 'NC', 'I', 'N', 'W', 'HW', 'RD', 'X'));
alter table public.reviews drop constraint if exists reviews_tags_check;
alter table public.reviews add constraint reviews_tags_check check (cardinality(tags) <= 25);
alter table public.reviews drop constraint if exists reviews_body_check;
alter table public.reviews add constraint reviews_body_check check (char_length(body) between 10 and 3000);
-- UW quarters: Autumn, Winter, Spring, Summer.
update public.reviews set semester = replace(semester, 'Fall ', 'Autumn ') where semester like 'Fall %';
alter table public.reviews drop constraint if exists reviews_semester_check;
alter table public.reviews add constraint reviews_semester_check
  check (semester ~ '^(Autumn|Winter|Spring|Summer) [0-9]{4}$');
alter table public.reviews drop constraint if exists reviews_other_tag_check;
alter table public.reviews add constraint reviews_other_tag_check check (char_length(other_tag) between 1 and 40);

-- ---------- Access rules ----------
-- Nobody can read anything unless signed in as one of the two chapter logins.
-- All writes go through the functions below; nobody can write to tables directly.
alter table public.professors enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "members read professors" on public.professors;
create policy "members read professors" on public.professors
  for select to authenticated using (public.is_member());

drop policy if exists "members read reviews" on public.reviews;
create policy "members read reviews" on public.reviews
  for select to authenticated using (public.is_member());

revoke all on public.professors, public.reviews from anon, authenticated;
grant select on public.professors to authenticated;
-- Members can't see edit tokens or report details.
grant select (id, professor_id, course_code, semester, overall, difficulty, take_again,
              attendance_mandatory, grade, tags, other_tag, body, created_at, updated_at)
  on public.reviews to authenticated;

-- ---------- Professor stats ----------
create or replace view public.professor_stats with (security_invoker = true) as
select
  p.id,
  p.name,
  p.department,
  count(r.id)::int as review_count,
  round(avg(r.overall), 2) as avg_overall,
  round(avg(r.difficulty), 2) as avg_difficulty,
  round(100.0 * avg(r.take_again::int))::int as pct_take_again,
  coalesce(array_agg(distinct r.course_code) filter (where r.course_code is not null), '{}') as courses,
  round(100.0 * avg(r.attendance_mandatory::int))::int as pct_attendance_mandatory
from public.professors p
left join public.reviews r on r.professor_id = p.id
group by p.id;

revoke all on public.professor_stats from anon, authenticated;
grant select on public.professor_stats to authenticated;

-- ---------- Member actions ----------
create or replace function public.add_professor(p_name text, p_department text) returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_id bigint;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  p_name := regexp_replace(trim(p_name), '\s+', ' ', 'g');
  p_department := regexp_replace(trim(coalesce(p_department, '')), '\s+', ' ', 'g');
  select id into v_id from professors
    where lower(name) = lower(p_name) and lower(department) = lower(p_department);
  if v_id is null then
    insert into professors (name, department) values (p_name, p_department) returning id into v_id;
  end if;
  return v_id;
end
$$;

-- Older versions without attendance/other tag; dropped so they don't linger as overloads.
drop function if exists public.submit_review(bigint, text, text, int, int, boolean, text, text[], text, text);
drop function if exists public.update_review(bigint, text, text, text, int, int, boolean, text, text[], text);

create or replace function public.submit_review(
  p_professor_id bigint, p_course text, p_semester text, p_overall int, p_difficulty int,
  p_take_again boolean, p_attendance_mandatory boolean, p_grade text, p_tags text[], p_other_tag text,
  p_body text, p_token text
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_id bigint;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'Invalid edit token'; end if;
  if p_attendance_mandatory is null then raise exception 'Please answer whether attendance is mandatory'; end if;
  if not (coalesce(p_tags, '{}') <@ allowed_tags()) then raise exception 'Unknown tag'; end if;
  insert into reviews (professor_id, course_code, semester, overall, difficulty, take_again,
                       attendance_mandatory, grade, tags, other_tag, body, edit_token_hash)
  values (p_professor_id, normalize_course(p_course), p_semester, p_overall, p_difficulty, p_take_again,
          p_attendance_mandatory, nullif(p_grade, ''), coalesce(p_tags, '{}'), nullif(trim(p_other_tag), ''),
          trim(p_body), encode(sha256(convert_to(p_token, 'UTF8')), 'hex'))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.update_review(
  p_id bigint, p_token text, p_course text, p_semester text, p_overall int, p_difficulty int,
  p_take_again boolean, p_attendance_mandatory boolean, p_grade text, p_tags text[], p_other_tag text,
  p_body text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if p_attendance_mandatory is null then raise exception 'Please answer whether attendance is mandatory'; end if;
  if not (coalesce(p_tags, '{}') <@ allowed_tags()) then raise exception 'Unknown tag'; end if;
  update reviews set
    course_code = normalize_course(p_course),
    semester = p_semester,
    overall = p_overall,
    difficulty = p_difficulty,
    take_again = p_take_again,
    attendance_mandatory = p_attendance_mandatory,
    grade = nullif(p_grade, ''),
    tags = coalesce(p_tags, '{}'),
    other_tag = nullif(trim(p_other_tag), ''),
    body = trim(p_body),
    updated_at = now()
  where id = p_id
    and edit_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if not found then raise exception 'You can only edit reviews posted from this device'; end if;
end
$$;

-- Authors delete with their token; admins can delete any review.
create or replace function public.delete_review(p_id bigint, p_token text default null) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if is_admin() then
    delete from reviews where id = p_id;
  else
    delete from reviews where id = p_id
      and edit_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  end if;
  if not found then raise exception 'Review not found, or not yours to delete'; end if;
end
$$;

create or replace function public.flag_review(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  update reviews set flagged = true, flag_reason = left(nullif(trim(p_reason), ''), 200)
    where id = p_id;
end
$$;

-- ---------- Admin actions ----------
create or replace function public.admin_flagged_reviews()
returns table (id bigint, professor_id bigint, professor_name text, course_code text, semester text,
               overall smallint, body text, flag_reason text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.id, r.professor_id, p.name, r.course_code, r.semester, r.overall, r.body, r.flag_reason, r.created_at
  from reviews r join professors p on p.id = r.professor_id
  where r.flagged and is_admin()
  order by r.created_at
$$;

create or replace function public.admin_keep_review(p_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update reviews set flagged = false, flag_reason = null where id = p_id;
end
$$;

create or replace function public.admin_update_professor(p_id bigint, p_name text, p_department text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update professors set
    name = regexp_replace(trim(p_name), '\s+', ' ', 'g'),
    department = regexp_replace(trim(coalesce(p_department, '')), '\s+', ' ', 'g')
  where id = p_id;
end
$$;

create or replace function public.admin_delete_professor(p_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from professors where id = p_id;
end
$$;

-- Signs out every device using the member login (use after changing its password).
create or replace function public.admin_sign_out_members() returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from auth.sessions
    where user_id in (select id from auth.users where email = 'members@dspscholarship.com');
end
$$;

-- ---------- Password lock ----------
-- Everyone knows the chapter password, so anyone could otherwise change it
-- (or the login's email) through Supabase's API and lock the chapter out.
-- This blocks every change to the two shared logins made through Supabase Auth,
-- including the dashboard. Passwords are changed only via admin_set_password()
-- from the site's Admin page.
create or replace function public.lock_shared_logins() returns trigger
language plpgsql
as $$
begin
  if old.email in ('members@dspscholarship.com', 'admin@dspscholarship.com')
     and current_user <> 'postgres'
     and (new.encrypted_password is distinct from old.encrypted_password
          or new.email is distinct from old.email
          or coalesce(new.email_change, '') is distinct from coalesce(old.email_change, '')
          or new.phone is distinct from old.phone
          or coalesce(new.phone_change, '') is distinct from coalesce(old.phone_change, '')) then
    raise exception 'The shared chapter logins can only be changed from the site''s Admin page';
  end if;
  return new;
end
$$;

drop trigger if exists lock_shared_logins on auth.users;
create trigger lock_shared_logins before update on auth.users
  for each row execute function public.lock_shared_logins();

-- p_which: 'member' or 'admin'. Changing the member password also signs out every member device.
create or replace function public.admin_set_password(p_which text, p_new_password text) returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if char_length(p_new_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  v_email := case p_which when 'member' then 'members@dspscholarship.com'
                          when 'admin' then 'admin@dspscholarship.com' end;
  if v_email is null then raise exception 'Unknown login'; end if;
  update auth.users
    set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    where email = v_email;
  if p_which = 'member' then
    delete from auth.sessions where user_id in (select id from auth.users where email = v_email);
  end if;
end
$$;

-- =============================================================
-- What'sBroTaking: classes brothers are registered for, by quarter
-- =============================================================

-- One row: which quarter the site treats as "current".
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  current_quarter text not null check (current_quarter ~ '^(Autumn|Winter|Spring|Summer) [0-9]{4}$')
);
insert into public.app_settings (id, current_quarter) values (1, 'Winter 2027') on conflict (id) do nothing;

-- Brother profiles: full name + 4-digit PIN (only its bcrypt hash is stored).
create table if not exists public.brothers (
  id bigint generated always as identity primary key,
  full_name text not null check (char_length(full_name) between 2 and 80),
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists brothers_name_key on public.brothers (lower(full_name));

-- Signing in to a profile gives that device a random token; only its SHA-256 hash is stored.
create table if not exists public.brother_sessions (
  token_hash text primary key,
  brother_id bigint not null references public.brothers (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.schedules (
  id bigint generated always as identity primary key,
  quarter text not null check (quarter ~ '^(Autumn|Winter|Spring|Summer) [0-9]{4}$'),
  brother_id bigint references public.brothers (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80), -- copied from the profile
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Upgrade from per-schedule PINs to profiles (there were no schedules before profiles).
alter table public.schedules add column if not exists brother_id bigint references public.brothers (id) on delete cascade;
delete from public.schedules where brother_id is null;
alter table public.schedules alter column brother_id set not null;
alter table public.schedules drop column if exists pin_hash;
alter table public.schedules drop column if exists failed_attempts;
alter table public.schedules drop column if exists locked_until;
drop index if exists public.schedules_quarter_name_key;
create unique index if not exists schedules_quarter_brother_key on public.schedules (quarter, brother_id);

create table if not exists public.schedule_classes (
  id bigint generated always as identity primary key,
  schedule_id bigint not null references public.schedules (id) on delete cascade,
  course_code text not null check (char_length(course_code) between 2 and 20),
  section text check (section ~ '^[A-Z0-9]{1,3}$'),
  quiz_section text check (quiz_section ~ '^[A-Z0-9]{1,3}$'),
  unique (schedule_id, course_code)
);
create index if not exists schedule_classes_course_idx on public.schedule_classes (course_code);

alter table public.app_settings enable row level security;
alter table public.brothers enable row level security;
alter table public.brother_sessions enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_classes enable row level security;

drop policy if exists "members read settings" on public.app_settings;
create policy "members read settings" on public.app_settings for select to authenticated using (public.is_member());
drop policy if exists "members read brothers" on public.brothers;
create policy "members read brothers" on public.brothers for select to authenticated using (public.is_member());
drop policy if exists "members read schedules" on public.schedules;
create policy "members read schedules" on public.schedules for select to authenticated using (public.is_member());
drop policy if exists "members read schedule classes" on public.schedule_classes;
create policy "members read schedule classes" on public.schedule_classes for select to authenticated using (public.is_member());

revoke all on public.app_settings, public.brothers, public.brother_sessions, public.schedules, public.schedule_classes
  from anon, authenticated;
grant select on public.app_settings, public.schedule_classes to authenticated;
grant select (id, quarter, brother_id, full_name, created_at, updated_at) on public.schedules to authenticated;
-- Members see names only: no PIN hashes, lockout state, or sessions.
grant select (id, full_name, created_at) on public.brothers to authenticated;

-- Old per-schedule PIN functions (replaced by profiles).
drop function if exists public.save_schedule(text, text, text, jsonb);
drop function if exists public.delete_schedule(bigint, text);
drop function if exists public.admin_reset_schedule_pin(bigint, text);
drop function if exists public._check_schedule_pin(bigint, text);

-- Checks a profile PIN. Returns an error message, or null when it's right.
-- Five wrong PINs lock the profile for 15 minutes. Callers must NOT raise on a
-- wrong PIN (that would undo the attempt counter); they return the message instead.
create or replace function public._check_brother_pin(p_id bigint, p_pin text) returns text
language plpgsql security definer set search_path = public
as $$
declare b brothers;
begin
  select * into b from brothers where id = p_id for update;
  if not found then return 'Profile not found'; end if;
  if b.locked_until > now() then return 'Too many wrong PINs. Try again in 15 minutes.'; end if;
  if b.pin_hash = extensions.crypt(coalesce(p_pin, ''), b.pin_hash) then
    update brothers set failed_attempts = 0, locked_until = null where id = p_id;
    return null;
  end if;
  if b.failed_attempts + 1 >= 5 then
    update brothers set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = p_id;
    return 'Too many wrong PINs. Try again in 15 minutes.';
  end if;
  update brothers set failed_attempts = failed_attempts + 1 where id = p_id;
  return 'Wrong PIN';
end
$$;

-- Issues a device token for a profile (valid 180 days).
create or replace function public._new_brother_session(p_brother_id bigint) returns text
language plpgsql security definer set search_path = public
as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from brother_sessions where expires_at < now();
  insert into brother_sessions (token_hash, brother_id, expires_at)
    values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_brother_id, now() + interval '180 days');
  return v_token;
end
$$;

-- The profile a device token belongs to, or null.
create or replace function public._session_brother(p_token text) returns bigint
language sql stable security definer set search_path = public
as $$
  select brother_id from brother_sessions
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now()
$$;

create or replace function public.create_profile(p_full_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_id bigint;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if v_name !~ ' ' or char_length(v_name) > 80 then raise exception 'Please enter your full name (first and last)'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  if exists (select 1 from brothers where lower(full_name) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'A profile with that name already exists. Sign in instead.');
  end if;
  insert into brothers (full_name, pin_hash) values (v_name, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'full_name', v_name, 'token', _new_brother_session(v_id));
end
$$;

create or replace function public.profile_sign_in(p_full_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  b brothers;
  v_error text;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  select * into b from brothers where lower(full_name) = lower(v_name);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'No profile with that name. Check the spelling or create one.');
  end if;
  v_error := _check_brother_pin(b.id, p_pin);
  if v_error is not null then return jsonb_build_object('ok', false, 'error', v_error); end if;
  return jsonb_build_object('ok', true, 'id', b.id, 'full_name', b.full_name, 'token', _new_brother_session(b.id));
end
$$;

create or replace function public.profile_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare b brothers;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  select * into b from brothers where id = _session_brother(p_token);
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'id', b.id, 'full_name', b.full_name);
end
$$;

create or replace function public.profile_sign_out(p_token text) returns void
language sql security definer set search_path = public
as $$
  delete from brother_sessions where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

create or replace function public.change_my_pin(p_token text, p_old_pin text, p_new_pin text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id bigint := _session_brother(p_token); v_error text;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if v_id is null then raise exception 'Signed out of your profile. Sign in again.'; end if;
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  v_error := _check_brother_pin(v_id, p_old_pin);
  if v_error is not null then return jsonb_build_object('ok', false, 'error', v_error); end if;
  update brothers set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)) where id = v_id;
  return jsonb_build_object('ok', true);
end
$$;

-- Creates or replaces the signed-in brother's classes for a quarter.
-- p_classes: [{"course": "FIN 350", "section": "A", "quiz": "AB"}, ...]
create or replace function public.save_my_schedule(p_token text, p_quarter text, p_classes jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_brother bigint := _session_brother(p_token);
  v_name text;
  v_id bigint;
  c jsonb;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if v_brother is null then raise exception 'Signed out of your profile. Sign in again.'; end if;
  if jsonb_typeof(p_classes) <> 'array' or jsonb_array_length(p_classes) not between 1 and 12 then
    raise exception 'Add between 1 and 12 classes';
  end if;
  select full_name into v_name from brothers where id = v_brother;
  select id into v_id from schedules where quarter = p_quarter and brother_id = v_brother;
  if v_id is null then
    insert into schedules (quarter, brother_id, full_name) values (p_quarter, v_brother, v_name) returning id into v_id;
  else
    update schedules set full_name = v_name, updated_at = now() where id = v_id;
    delete from schedule_classes where schedule_id = v_id;
  end if;
  for c in select * from jsonb_array_elements(p_classes) loop
    if trim(coalesce(c ->> 'section', '')) = '' then
      raise exception 'Every class needs a section (e.g. A)';
    end if;
    insert into schedule_classes (schedule_id, course_code, section, quiz_section)
    values (v_id, normalize_course(c ->> 'course'),
            nullif(upper(trim(coalesce(c ->> 'section', ''))), ''),
            nullif(upper(trim(coalesce(c ->> 'quiz', ''))), ''))
    on conflict (schedule_id, course_code) do nothing;
  end loop;
  return v_id;
end
$$;

create or replace function public.delete_my_schedule(p_token text, p_schedule_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
declare v_brother bigint := _session_brother(p_token);
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if v_brother is null then raise exception 'Signed out of your profile. Sign in again.'; end if;
  delete from schedules where id = p_schedule_id and brother_id = v_brother;
  if not found then raise exception 'You can only delete your own classes'; end if;
end
$$;

create or replace function public.admin_set_current_quarter(p_quarter text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update app_settings set current_quarter = p_quarter where id = 1;
end
$$;

create or replace function public.admin_delete_schedule(p_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from schedules where id = p_id;
end
$$;

-- Also signs the profile out everywhere.
create or replace function public.admin_reset_profile_pin(p_brother_id bigint, p_pin text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  update brothers set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
    failed_attempts = 0, locked_until = null where id = p_brother_id;
  delete from brother_sessions where brother_id = p_brother_id;
end
$$;

-- Deletes a profile and all of its schedules.
create or replace function public.admin_delete_profile(p_brother_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from brothers where id = p_brother_id;
end
$$;

create or replace function public.admin_clear_quarter(p_quarter text) returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from schedules where quarter = p_quarter;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Only signed-in users may call functions; each one checks member/admin itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Supabase Auth's own role must be able to run the trigger.
grant execute on function public.lock_shared_logins() to supabase_auth_admin;
-- Internal helpers: only callable from the profile/schedule functions above.
revoke execute on function public._check_brother_pin(bigint, text) from authenticated;
revoke execute on function public._new_brother_session(bigint) from authenticated;
revoke execute on function public._session_brother(text) from authenticated;
