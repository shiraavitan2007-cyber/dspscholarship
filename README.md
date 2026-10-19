# DSP Professor Reviews

Internal professor reviews for our Delta Sigma Pi chapter, live at https://dspscholarship.com.
Hosted on GitHub Pages; reviews are stored in Supabase.

## How access works
- There are two shared logins in Supabase (Authentication → Users):
  - `members@dspscholarship.com`: the **chapter password** everyone uses
  - `admin@dspscholarship.com`: the **admin password** for officers
- The sign-in page only asks for a password; it figures out which login it is.
- The database refuses to show anything to anyone not signed in as one of those two logins.
- Reviews are fully anonymous. Nobody, including admins, can see who wrote a review.
- A review can be edited or deleted only from the browser that posted it. Admins can delete any review.

## Change the chapter password (e.g. at the start of each semester)
1. Supabase → **Authentication → Users** → click `members@dspscholarship.com`.
2. Set a new password and save.
3. On the site, sign in with the admin password → **Admin** → **Sign out all member devices**.
4. Share the new password with the chapter.

If someone changes the chapter password without permission (anyone who knows it can), reset it the same way.

## Add or remove an admin
Admins share the admin password. To add one, give them the password. To remove one,
change the admin password (Authentication → Users → `admin@dspscholarship.com`) and share the new one with the remaining admins.

## Moderate reviews
Members can tap **Report** on any review. Sign in with the admin password → **Admin**:
- **Keep** clears the report; **Delete** removes the review.
- Under **Professors** you can fix a name or department, or delete a duplicate professor (this deletes their reviews too).

## Change tags or colors
- Tags: edit `TAGS` in `app.js` **and** `allowed_tags()` in `supabase/schema.sql`, then re-run the SQL in Supabase.
- Colors: edit the variables at the top of `style.css`.

## Publish changes
```bash
git add . && git commit -m "Describe the change" && git push
```
The site updates in about a minute. Don't delete the `CNAME` file; it keeps the domain connected.

## Files
- `index.html`, `app.js`, `style.css`: the site
- `config.js`: Supabase project URL + anon key (public by design)
- `supabase/schema.sql`: tables, stats, access rules. Run it in Supabase → SQL Editor.
