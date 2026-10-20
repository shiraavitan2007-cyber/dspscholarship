# RateMyBrofessor (DSP Professor Reviews)

Internal professor reviews for our Delta Sigma Pi chapter, live at https://dspscholarship.com.
Hosted on GitHub Pages; reviews are stored in Supabase (project `dsp-professor-reviews`:
https://supabase.com/dashboard/project/ntmfodbezvygvmgblhwy).

## How access works
- There are two shared logins in Supabase (Authentication → Users):
  - `members@dspscholarship.com`: the **chapter password** everyone uses
  - `admin@dspscholarship.com`: the **admin password** for officers
- The sign-in page only asks for a password; it figures out which login it is.
- The database refuses to show anything to anyone not signed in as one of those two logins.
- Reviews are fully anonymous. Nobody, including admins, can see who wrote a review.
- A review can be edited or deleted only from the browser that posted it. Admins can delete any review.

## Change a password (e.g. the chapter password each semester)
Sign in with the admin password → **Admin** → **Change passwords**.
- Changing the **chapter password** signs out every member device within the hour.
- Then share the new password with the chapter.

The two logins are locked: nobody, not even someone using the Supabase dashboard or the API,
can change their password or email any other way. The Admin page is the only place.

## Add or remove an admin
Admins share the admin password. To add one, give them the password. To remove one,
change the admin password on the Admin page and share the new one with the remaining admins.

## If you forget the admin password
In Supabase → **SQL Editor**, run (with your new password):
```sql
update auth.users set encrypted_password = extensions.crypt('NEW-PASSWORD-HERE', extensions.gen_salt('bf', 10))
where email = 'admin@dspscholarship.com';
```

## Moderate reviews
Members can tap **Report** on any review. Sign in with the admin password → **Admin**:
- **Keep** clears the report; **Delete** removes the review.
- Under **Professors** you can fix a name or department, or delete a duplicate professor (this deletes their reviews too).

## UW classes
The class picker, course titles, and Classes search use `uw-courses.json`, a list of every
UW Seattle course built from the official catalog (https://www.washington.edu/students/crscat/).
Quarters are UW's: Autumn, Winter, Spring, Summer. To pick up new courses (about once a year):
```bash
python3 tools/build_uw_courses.py
git add uw-courses.json && git commit -m "Update UW course list" && git push
```

## Change tags or colors
- Tags: edit `TAGS` in `app.js` **and** `allowed_tags()` in `supabase/schema.sql`, then re-run the SQL in Supabase.
- Colors: edit the variables at the top of `style.css`.

## Publish changes
```bash
git add . && git commit -m "Describe the change" && git push
```
The site updates in about a minute. Don't delete the `CNAME` file; it keeps the domain connected.

When you change `app.js`, `style.css`, or `config.js`, also bump the `?v=` number on those links in
`index.html` (e.g. `2026-10-20.1` → `2026-10-20.2`). Otherwise phones may keep showing the old version.

## Files
- `index.html`, `app.js`, `style.css`: the site
- `config.js`: Supabase project URL + anon key (public by design)
- `supabase/schema.sql`: tables, stats, access rules. Run it in Supabase → SQL Editor.
