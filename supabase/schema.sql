-- =============================================================
-- RateMyBrofessor (DSP professor reviews): database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again after making changes.
-- =============================================================

-- ---------- Who is allowed in ----------
-- Brothers sign in with UW Google; only emails on this roster get in. Admins manage it.
create table if not exists public.members (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_admin boolean not null default false,
  added_at timestamptz not null default now()
);
alter table public.members enable row level security;
revoke all on public.members from anon, authenticated;

-- Members are: roster emails signed in with Google, the shared chapter login (while
-- admins allow it), and the shared admin login (kept as an emergency backup).
-- If you change the shared login emails, change config.js too.
create or replace function public.is_member() returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_email = 'admin@dspscholarship.com' then return true; end if;
  if v_email = 'members@dspscholarship.com' then
    return coalesce((select allow_chapter_password from app_settings where id = 1), true);
  end if;
  -- Google has verified the email; a password sign-up with a roster email would not count.
  return coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
     and exists (select 1 from members where email = v_email);
end
$$;

create or replace function public.is_admin() returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_email = 'admin@dspscholarship.com' then return true; end if;
  return coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
     and exists (select 1 from members where email = v_email and is_admin);
end
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
-- Admins turn this off once every brother is on the roster and signs in with Google.
alter table public.app_settings add column if not exists allow_chapter_password boolean not null default true;

-- Brothers' display names (defaults to the name on their Google account).
alter table public.members add column if not exists display_name text check (char_length(display_name) between 2 and 80);

create table if not exists public.schedules (
  id bigint generated always as identity primary key,
  quarter text not null check (quarter ~ '^(Autumn|Winter|Spring|Summer) [0-9]{4}$'),
  -- The brother's roster email (from Google sign-in). Removing them from the roster removes their classes.
  owner_email text references public.members (email) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Upgrade: schedules used to belong to PIN profiles; now they belong to roster emails.
alter table public.schedules add column if not exists owner_email text references public.members (email) on delete cascade;
delete from public.schedules where owner_email is null;
alter table public.schedules alter column owner_email set not null;
alter table public.schedules drop column if exists brother_id;
alter table public.schedules drop column if exists pin_hash;
alter table public.schedules drop column if exists failed_attempts;
alter table public.schedules drop column if exists locked_until;
drop index if exists public.schedules_quarter_name_key;
drop index if exists public.schedules_quarter_brother_key;
create unique index if not exists schedules_quarter_owner_key on public.schedules (quarter, owner_email);

create table if not exists public.schedule_classes (
  id bigint generated always as identity primary key,
  schedule_id bigint not null references public.schedules (id) on delete cascade,
  course_code text not null check (char_length(course_code) between 2 and 20),
  section text check (section ~ '^[A-Z0-9]{1,3}$'),
  quiz_section text check (quiz_section ~ '^[A-Z0-9]{1,3}$'),
  unique (schedule_id, course_code)
);
create index if not exists schedule_classes_course_idx on public.schedule_classes (course_code);

-- PIN profiles (and before them, per-schedule PINs) are replaced by Google sign-in.
drop function if exists public.create_profile(text, text);
drop function if exists public.profile_sign_in(text, text);
drop function if exists public.profile_me(text);
drop function if exists public.profile_sign_out(text);
drop function if exists public.change_my_pin(text, text, text);
drop function if exists public.save_my_schedule(text, text, jsonb);
drop function if exists public.delete_my_schedule(text, bigint);
drop function if exists public.admin_reset_profile_pin(bigint, text);
drop function if exists public.admin_delete_profile(bigint);
drop function if exists public._check_brother_pin(bigint, text);
drop function if exists public._new_brother_session(bigint);
drop function if exists public._session_brother(text);
drop function if exists public.save_schedule(text, text, text, jsonb);
drop function if exists public.delete_schedule(bigint, text);
drop function if exists public.admin_reset_schedule_pin(bigint, text);
drop function if exists public._check_schedule_pin(bigint, text);
drop table if exists public.brother_sessions;
drop table if exists public.brothers;

alter table public.app_settings enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_classes enable row level security;

drop policy if exists "members read settings" on public.app_settings;
create policy "members read settings" on public.app_settings for select to authenticated using (public.is_member());
drop policy if exists "members read schedules" on public.schedules;
create policy "members read schedules" on public.schedules for select to authenticated using (public.is_member());
drop policy if exists "members read schedule classes" on public.schedule_classes;
create policy "members read schedule classes" on public.schedule_classes for select to authenticated using (public.is_member());

revoke all on public.app_settings, public.schedules, public.schedule_classes from anon, authenticated;
grant select on public.app_settings, public.schedule_classes to authenticated;
grant select (id, quarter, owner_email, full_name, created_at, updated_at) on public.schedules to authenticated;

-- The signed-in brother's roster email: Google sign-ins on the roster only (not the shared logins).
create or replace function public._my_email() returns text
language sql stable security definer set search_path = public
as $$
  select m.email from members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
$$;

-- Their display name: what they set, else the name on their Google account, else their UW NetID.
create or replace function public._my_name() returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(m.display_name,
                  nullif(regexp_replace(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), '\s+', ' ', 'g'), ''),
                  split_part(m.email, '@', 1))
  from members m where m.email = _my_email()
$$;

-- Creates or replaces the signed-in brother's classes for a quarter.
-- p_classes: [{"course": "FIN 350", "section": "A", "quiz": "AB"}, ...]
create or replace function public.save_my_schedule(p_quarter text, p_classes jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := _my_email();
  v_name text := _my_name();
  v_id bigint;
  c jsonb;
begin
  if v_email is null then raise exception 'Sign in with your UW Google account to add classes'; end if;
  if jsonb_typeof(p_classes) <> 'array' or jsonb_array_length(p_classes) not between 1 and 12 then
    raise exception 'Add between 1 and 12 classes';
  end if;
  select id into v_id from schedules where quarter = p_quarter and owner_email = v_email;
  if v_id is null then
    insert into schedules (quarter, owner_email, full_name) values (p_quarter, v_email, v_name) returning id into v_id;
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

create or replace function public.delete_my_schedule(p_schedule_id bigint) returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from schedules where id = p_schedule_id and owner_email = _my_email();
  if not found then raise exception 'You can only delete your own classes'; end if;
end
$$;

-- Sets the name brothers see for you (and updates your existing schedules).
create or replace function public.set_my_name(p_name text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := _my_email();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if v_email is null then raise exception 'Sign in with your UW Google account first'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'Name must be 2 to 80 characters'; end if;
  update members set display_name = v_name where email = v_email;
  update schedules set full_name = v_name where owner_email = v_email;
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

-- =============================================================
-- Roster (who can sign in with Google)
-- =============================================================

-- What the signed-in account can do. Callable by anyone signed in, even if not on the roster,
-- so the site can explain why they can't get in.
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  return jsonb_build_object(
    'member', is_member(),
    'admin', is_admin(),
    'email', v_email,
    'via', case when v_email = 'members@dspscholarship.com' then 'chapter'
                when v_email = 'admin@dspscholarship.com' then 'admin'
                else coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', 'unknown') end,
    'chapter_password_on', coalesce((select allow_chapter_password from app_settings where id = 1), true),
    -- Only roster brothers signed in with Google can add classes to What'sBroTaking.
    'can_edit', _my_email() is not null,
    'name', _my_name());
end
$$;

create or replace function public.admin_list_members()
returns table (email text, is_admin boolean, added_at timestamptz, last_sign_in timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.email, m.is_admin, m.added_at,
         (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = m.email)
  from members m
  where is_admin()
  order by m.email
$$;

-- Adds emails to the roster (duplicates ignored). Returns how many were new.
create or replace function public.admin_add_members(p_emails text[]) returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  insert into members (email)
    select distinct lower(trim(e)) from unnest(p_emails) e
    where lower(trim(e)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  on conflict (email) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.admin_remove_member(p_email text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from members where email = lower(trim(p_email));
end
$$;

create or replace function public.admin_set_member_admin(p_email text, p_is_admin boolean) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update members set is_admin = p_is_admin where email = lower(trim(p_email));
end
$$;

create or replace function public.admin_set_chapter_password(p_allowed boolean) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update app_settings set allow_chapter_password = p_allowed where id = 1;
end
$$;

-- Only signed-in users may call functions; each one checks member/admin itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Supabase Auth's own role must be able to run the trigger.
grant execute on function public.lock_shared_logins() to supabase_auth_admin;
-- Internal helpers: only callable from the functions above.
revoke execute on function public._my_email() from authenticated;
revoke execute on function public._my_name() from authenticated;
