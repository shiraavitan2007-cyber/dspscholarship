-- =============================================================
-- DSP Professor Reviews: database setup
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
    'Clear lectures', 'Engaging', 'Caring', 'Accessible outside class',
    'Tough grader', 'Lots of homework', 'Heavy reading', 'Test heavy',
    'Group projects', 'Attendance required', 'Participation matters',
    'Curves exams', 'Extra credit', 'Lecture heavy'
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
  semester text not null check (semester ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'),
  overall smallint not null check (overall between 1 and 5),
  difficulty smallint not null check (difficulty between 1 and 5),
  take_again boolean not null,
  grade text check (grade in ('A', 'B', 'C', 'D', 'F', 'Pass', 'Withdrew')),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  body text not null check (char_length(body) between 50 and 1000),
  flagged boolean not null default false,
  flag_reason text,
  -- Reviews are anonymous. Whoever posts one gets a secret kept in their
  -- browser; only its hash is stored, and it is needed to edit or delete.
  edit_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reviews_professor_id_idx on public.reviews (professor_id);

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
              grade, tags, body, created_at, updated_at)
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
  coalesce(array_agg(distinct r.course_code) filter (where r.course_code is not null), '{}') as courses
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

create or replace function public.submit_review(
  p_professor_id bigint, p_course text, p_semester text, p_overall int, p_difficulty int,
  p_take_again boolean, p_grade text, p_tags text[], p_body text, p_token text
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_id bigint;
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'Invalid edit token'; end if;
  if not (coalesce(p_tags, '{}') <@ allowed_tags()) then raise exception 'Unknown tag'; end if;
  insert into reviews (professor_id, course_code, semester, overall, difficulty, take_again,
                       grade, tags, body, edit_token_hash)
  values (p_professor_id, normalize_course(p_course), p_semester, p_overall, p_difficulty, p_take_again,
          nullif(p_grade, ''), coalesce(p_tags, '{}'), trim(p_body),
          encode(sha256(convert_to(p_token, 'UTF8')), 'hex'))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.update_review(
  p_id bigint, p_token text, p_course text, p_semester text, p_overall int, p_difficulty int,
  p_take_again boolean, p_grade text, p_tags text[], p_body text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_member() then raise exception 'Not signed in'; end if;
  if not (coalesce(p_tags, '{}') <@ allowed_tags()) then raise exception 'Unknown tag'; end if;
  update reviews set
    course_code = normalize_course(p_course),
    semester = p_semester,
    overall = p_overall,
    difficulty = p_difficulty,
    take_again = p_take_again,
    grade = nullif(p_grade, ''),
    tags = coalesce(p_tags, '{}'),
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

-- Only signed-in users may call functions; each one checks member/admin itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
