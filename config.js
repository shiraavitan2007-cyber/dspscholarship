// Supabase → Project Settings → API. The anon/publishable key is safe to publish.
// NEVER put the service_role / secret key here.
window.DSP_CONFIG = {
  SUPABASE_URL: "PASTE_PROJECT_URL_HERE",
  SUPABASE_ANON_KEY: "PASTE_ANON_KEY_HERE",

  // The two shared logins (must match supabase/schema.sql).
  MEMBER_EMAIL: "members@dspscholarship.com",
  ADMIN_EMAIL: "admin@dspscholarship.com",
};
