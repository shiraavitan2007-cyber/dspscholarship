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

-- Only signed-in users may call functions; each one checks member/admin itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Supabase Auth's own role must be able to run the trigger.
grant execute on function public.lock_shared_logins() to supabase_auth_admin;
