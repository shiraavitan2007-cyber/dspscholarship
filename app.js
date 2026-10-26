import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const CONFIG = window.DSP_CONFIG || {};

// Must match allowed_tags() in supabase/schema.sql
const TAGS = [
  "Tough Grader", "Get Ready to Read", "Participation Matters", "Extra Credit",
  "Group Projects", "Amazing Lectures", "Clear Grading Criteria", "Gives Good Feedback",
  "Inspirational", "Lots of Homework", "Hilarious", "Beware of Pop Quizzes",
  "So Many Papers", "Caring", "Respected", "Lecture Heavy",
  "Test Heavy", "Graded By Few Things", "Accessible Outside Class", "Online Savvy",
];
// UW grading system (washington.edu/students/gencat/front/Grading_Sys.html).
// Must match reviews_grade_check in supabase/schema.sql. [stored value, label]
const NUMERIC_GRADES = [
  ...Array.from({ length: 34 }, (_, i) => { const g = ((40 - i) / 10).toFixed(1); return [g, g]; }), // 4.0 … 0.7
  ["0.0", "0.0 (failing, no credit)"],
];
const GRADE_NOTATIONS = [
  ["S", "S: Satisfactory"], ["NS", "NS: Not satisfactory"],
  ["CR", "CR: Credit"], ["NC", "NC: No credit"],
  ["I", "I: Incomplete"], ["N", "N: In progress"],
  ["W", "W: Withdrawal"], ["HW", "HW: Hardship withdrawal"], ["RD", "RD: Registrar drop"],
  ["X", "X: No grade submitted"],
];
const GRADES = [...NUMERIC_GRADES, ...GRADE_NOTATIONS];
// UW quarters. Must match reviews_semester_check in supabase/schema.sql
const TERMS = ["Autumn", "Winter", "Spring", "Summer"];
const OVERALL_LABELS = ["", "Awful", "Poor", "OK", "Good", "Awesome"];
const DIFFICULTY_LABELS = ["", "Very easy", "Easy", "Average", "Hard", "Very hard"];
const REVIEW_COLUMNS = "id, professor_id, course_code, semester, overall, difficulty, take_again, "
  + "attendance_mandatory, grade, tags, other_tag, body, created_at, updated_at";
const TRENDING_DAYS = 14;

// localStorage keys: which reviews this browser posted (needed to edit/delete them)
const TOKENS = "dsp-review-tokens"; // reviewId -> secret edit token
const REVIEWED = "dsp-reviewed"; // "professorId|COURSE" -> reviewId

// Static icon markup (no user data), inserted with innerHTML.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  classes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M4 5h16M4 12h16M4 19h10"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.4 3.5 5.2"/></svg>',
  google: '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

const app = document.getElementById("app");
const configured = Boolean(CONFIG.SUPABASE_URL) && !CONFIG.SUPABASE_URL.startsWith("PASTE");
// PKCE: Google sends people back with ?code=… instead of a #token, which would clash with the hash routes.
const supabase = configured ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { flowType: "pkce" } }) : null;
let session = null;
let access = null; // from my_access(): { member, admin, email, via, chapter_password_on }
const browseState = { sort: "rating" };
const homeState = { chart: "trending" };

// ---------- Helpers ----------

// Builds DOM elements. Text is always inserted as text, never as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false || key === "value") continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false || child === "") continue;
    el.append(child instanceof Node ? child : String(child));
  }
  if (attrs.value != null) el.value = attrs.value;
  return el;
}

function icon(name, cls = "icon") {
  const span = h("span", { class: cls, "aria-hidden": "true" });
  span.innerHTML = ICONS[name];
  return span;
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ }
}
function forgetReview(id) {
  const tokens = load(TOKENS);
  delete tokens[id];
  save(TOKENS, tokens);
  const reviewed = load(REVIEWED);
  for (const key of Object.keys(reviewed)) if (reviewed[key] === id) delete reviewed[key];
  save(REVIEWED, reviewed);
}

function normalizeCourse(c) {
  return c.trim().replace(/\s+/g, " ").toUpperCase().replace(/^([A-Z]+)\s*-?\s*(\d)/, "$1 $2");
}
// "b econ 300", "BECON300" and "B ECON 300" all compact to "BECON300".
function compact(text) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
// "B ECON 300" -> "B ECON"
function coursePrefix(code) {
  return code.replace(/\s*\d.*$/, "");
}

// UW Seattle course catalog (uw-courses.json, built by tools/build_uw_courses.py).
// Loaded once, on the pages that need it; the site still works if it fails to load.
let catalogPromise = null;
function loadCatalog() {
  catalogPromise ||= fetch("uw-courses.json")
    .then((res) => (res.ok ? res.json() : { courses: [], departments: {} }))
    .catch(() => ({ courses: [], departments: {} }))
    .then((data) => ({
      list: data.courses.map(([code, title]) => ({
        code, title, key: compact(code), number: Number(code.match(/\d+/)?.[0] || 0),
        search: `${compact(code)} ${title} ${data.departments[coursePrefix(code)] || ""}`.toLowerCase(),
      })),
      titles: new Map(data.courses),
      byKey: new Map(data.courses.map(([code]) => [compact(code), code])),
      departments: data.departments,
    }));
  return catalogPromise;
}
function courseTitle(catalog, code) {
  return catalog.titles.get(code) || "";
}
// Best catalog matches for what someone typed: code matches first, then title/department
// matches with lower-numbered (undergraduate) courses first.
function findCourses(catalog, text, limit = 8) {
  const key = compact(text);
  const words = text.toLowerCase().trim().replace(/\s+/g, " ");
  if (!key) return [];
  const byCode = catalog.list.filter((c) => c.key.startsWith(key));
  const byTitle = words.length >= 3
    ? catalog.list.filter((c) => !c.key.startsWith(key) && c.search.includes(words)).sort((a, b) => a.number - b.number)
    : [];
  return [...byCode, ...byTitle].slice(0, limit);
}

// A UW class text box with a suggestion list. Returns the pieces to place in a form.
let pickerCount = 0;
function makeCoursePicker(catalog, { id = `course-${++pickerCount}`, value = "", required = false, label, onPick } = {}) {
  const listId = `${id}-suggestions`;
  const input = h("input", {
    id, class: "input", required, maxlength: 20, placeholder: "e.g. FIN 350", autocapitalize: "characters",
    autocomplete: "off", role: "combobox", "aria-autocomplete": "list", "aria-controls": listId, "aria-expanded": "false",
    "aria-label": label, value,
  });
  const suggestions = h("div", { class: "suggestions", id: listId, role: "listbox", hidden: true });
  const picked = h("p", { class: "course-picked" });
  const code = () => catalog.byKey.get(compact(input.value));
  function updatePicked() {
    const c = code();
    picked.textContent = c ? `${c} · ${courseTitle(catalog, c)}` : "";
    return c;
  }
  function hide() {
    suggestions.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }
  function pick(c) {
    input.value = c;
    hide();
    updatePicked();
    onPick?.(c);
  }
  input.addEventListener("input", () => {
    const exact = updatePicked();
    const matches = findCourses(catalog, input.value, 6);
    if (matches.length === 0 || (exact && matches.length === 1)) return hide();
    suggestions.replaceChildren(...matches.map((c) => h("button", {
      type: "button", class: "suggestion", role: "option",
      onmousedown: (e) => e.preventDefault(), // keep focus so the click lands
      onclick: () => pick(c.code),
    }, h("b", {}, c.code), h("span", {}, c.title))));
    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("blur", () => setTimeout(hide, 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  updatePicked();
  return { box: h("div", { class: "combo" }, input, suggestions), input, picked, code };
}

// ---------- UW quarters ----------

const TERM_ORDER = { Winter: 1, Spring: 2, Summer: 3, Autumn: 4 };
const quarterKey = (quarter) => {
  const [term, year] = quarter.split(" ");
  return Number(year) * 10 + (TERM_ORDER[term] || 0);
};
const byQuarter = (a, b) => quarterKey(a) - quarterKey(b);
function shiftQuarter(quarter, steps) {
  const order = ["Winter", "Spring", "Summer", "Autumn"];
  let [term, year] = quarter.split(" ");
  let i = order.indexOf(term) + steps;
  year = Number(year) + Math.floor(i / 4);
  return `${order[((i % 4) + 4) % 4]} ${year}`;
}
function quarterForDate(date = new Date()) {
  const m = date.getMonth();
  return `${m < 3 ? "Winter" : m < 6 ? "Spring" : m < 8 ? "Summer" : "Autumn"} ${date.getFullYear()}`;
}

// ---------- What'sBroTaking data ----------


async function loadCurrentQuarter() {
  const row = await q(supabase.from("app_settings").select("current_quarter").maybeSingle());
  return row?.current_quarter || quarterForDate();
}
// Every schedule (and its classes) for one quarter.
async function loadQuarter(quarter) {
  const schedules = await q(supabase.from("schedules").select("id, quarter, owner_email, full_name, updated_at").eq("quarter", quarter).order("full_name"));
  const ids = schedules.map((s) => s.id);
  const classes = ids.length
    ? await q(supabase.from("schedule_classes").select("id, schedule_id, course_code, section, quiz_section").in("schedule_id", ids))
    : [];
  const byId = new Map(schedules.map((s) => [s.id, { ...s, classes: [] }]));
  for (const c of classes) byId.get(c.schedule_id)?.classes.push(c);
  return [...byId.values()];
}
// Quarters that have schedules, plus the current one, oldest first.
async function loadQuarterList(current) {
  const rows = await q(supabase.from("schedules").select("quarter"));
  return [...new Set([current, ...rows.map((r) => r.quarter)])].sort(byQuarter);
}
function sectionLabel(c) {
  return [c.section && `Section ${c.section}`, c.quiz_section && `Quiz ${c.quiz_section}`].filter(Boolean).join(" · ");
}
function personAvatar(schedule, cls = "avatar") {
  return avatar({ id: schedule.id, name: schedule.full_name }, cls);
}

function isAdmin() {
  return Boolean(access?.admin);
}

async function loadAccess() {
  try { return await call("my_access"); } catch { return null; }
}

function fmt(n) {
  return n == null ? "–" : Number(n).toFixed(1);
}
function ratingClass(n) {
  if (n == null) return "none";
  return n >= 4 ? "good" : n >= 3 ? "mid" : "bad";
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function formatDate(s) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function timeAgo(s) {
  const minutes = (Date.now() - new Date(s)) / 60_000;
  if (minutes < 60) return "just now";
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d`;
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function initials(name) {
  const words = name.replace(/^(dr|prof|professor|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}
// Each professor gets a stable avatar color: purple, gold, or lilac.
function avatar(prof, cls = "avatar") {
  const variant = ["purple", "gold", "lilac"][prof.id % 3];
  return h("span", { class: `${cls} ${variant}`, "aria-hidden": "true" }, initials(prof.name));
}

function stars(n) {
  return h("span", { class: "stars", "aria-label": `${n} out of 5` }, "★".repeat(n), h("span", { class: "dim" }, "★".repeat(5 - n)));
}
function rateChip(value) {
  return h("span", { class: `rate ${ratingClass(value)}` }, fmt(value));
}

async function q(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
function call(name, args) {
  return q(supabase.rpc(name, args));
}
// For buttons: shows the error instead of throwing. Returns true on success.
async function act(name, args) {
  try { await call(name, args); return true; } catch (err) { alert(err.message); return false; }
}

// Professors + reviews; the chapter is small enough to load everything at once.
async function loadAll() {
  const [profs, reviews] = await Promise.all([
    q(supabase.from("professor_stats").select("*")),
    q(supabase.from("reviews").select(REVIEW_COLUMNS).order("created_at", { ascending: false }).limit(2000)),
  ]);
  const byId = new Map(profs.map((p) => [p.id, p]));
  return { profs, reviews, byId };
}

function field(label, id, input, hint) {
  return h("div", { class: "field" }, h("label", { for: id }, label), hint && h("p", { class: "hint" }, hint), input);
}

function emptyState(text, withButton = true) {
  return h("div", { class: "empty" },
    h("p", {}, text),
    withButton && h("a", { href: "#/review/new", class: "btn gold" }, "Write the first review"));
}

// ---------- Routing ----------

async function render() {
  if (!configured) return renderSetup();
  if (!session) return renderLogin();
  if (!access?.member) return renderNoAccess();

  const [path, queryString] = location.hash.slice(1).split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const params = new URLSearchParams(queryString || "");
  const view = h("div", { class: "view" }, h("p", { class: "wrap muted loading" }, "Loading…"));
  // Which app's tab bar to show: the hub and Admin have none.
  const section = parts[0] === "wbt" ? "wbt" : !parts[0] || parts[0] === "admin" ? "hub" : "rmb";
  const tab = section === "wbt"
    ? { class: "classes", brothers: "brothers", brother: "brothers", add: "add", profile: "profile" }[parts[1]] || "classes"
    : { rate: "home", search: "search", classes: "classes", class: "classes" }[parts[0]] || "";
  app.replaceChildren(...[view, section !== "hub" && bottomNav(section, tab)].filter(Boolean));
  document.body.classList.add("signed-in");
  document.body.classList.toggle("no-nav", section === "hub");

  try {
    if (!parts[0]) await renderHub(view);
    else if (parts[0] === "rate") await renderHome(view);
    else if (parts[0] === "wbt") {
      const quarter = params.get("quarter");
      if (parts[1] === "class" && parts[2]) await renderWbtClass(view, decodeURIComponent(parts[2]), quarter);
      else if (parts[1] === "brothers") await renderWbtBrothers(view, quarter);
      else if (parts[1] === "brother" && parts[2]) await renderWbtBrother(view, Number(parts[2]));
      else if (parts[1] === "add") await renderWbtForm(view, quarter);
      else if (parts[1] === "profile") await renderWbtProfile(view);
      else await renderWbtHome(view, quarter);
    } else if (parts[0] === "prof" && parts[1]) await renderProfessor(view, Number(parts[1]));
    else if (parts[0] === "review" && parts[1] === "new") {
      await renderForm(view, { professorId: Number(params.get("prof")) || null, course: params.get("course") });
    } else if (parts[0] === "review" && parts[1] === "edit") await renderForm(view, { reviewId: Number(parts[2]) });
    else if (parts[0] === "search") await renderSearch(view, params.get("q") || "", params.get("dept") || "");
    else if (parts[0] === "classes") await renderClasses(view);
    else if (parts[0] === "class" && parts[1]) await renderClass(view, decodeURIComponent(parts[1]));
    else if (parts[0] === "admin") await renderAdmin(view);
    else await renderHub(view);
  } catch (err) {
    view.replaceChildren(h("p", { class: "wrap error loading" }, "Something went wrong: ", err.message || String(err)));
  }
}

function bottomNav(app, active) {
  const item = (name, href, label, iconName = name) => h("a", { href, class: `nav-item${active === name ? " active" : ""}`, "aria-current": active === name ? "page" : null },
    icon(iconName), label);
  const apps = item("apps", "#/", "Apps", "grid");
  if (app === "wbt") {
    return h("nav", { class: "bottom-nav", "aria-label": "What'sBroTaking" },
      item("classes", "#/wbt", "Schedule"),
      item("brothers", "#/wbt/brothers", "Brothers", "people"),
      h("a", { href: "#/wbt/add", class: "nav-plus", "aria-label": "Add my classes" }, icon("plus")),
      item("profile", "#/wbt/profile", "My classes", "person"),
      apps);
  }
  return h("nav", { class: "bottom-nav", "aria-label": "RateMyBrofessor" },
    item("home", "#/rate", "Home"),
    item("search", "#/search", "Search"),
    h("a", { href: "#/review/new", class: "nav-plus", "aria-label": "Write a review" }, icon("plus")),
    item("classes", "#/classes", "Classes"),
    apps);
}

// Compact purple header used on every page except Home.
function pageHeader(title, { back, subtitle, extra } = {}) {
  return h("header", { class: "page-header" },
    h("div", { class: "wrap" },
      back && h("a", { href: back, class: "round-btn on-purple", "aria-label": "Back" }, icon("back")),
      h("h1", {}, title),
      subtitle && h("p", { class: "on-purple-muted" }, subtitle),
      extra));
}

function signOut() {
  supabase.auth.signOut({ scope: "local" });
}

// ---------- Hub (home after sign-in) ----------

// Two big app tiles, like a phone home screen.
async function renderHub(view) {
  view.replaceChildren(h("main", { class: "hub" },
    h("div", { class: "hub-top" },
      h("span", { class: "crest" }, "ΔΣΠ"),
      h("span", { class: "hub-eyebrow" }, "Scholarship")),
    h("div", { class: "tiles" },
      h("a", { href: "#/rate", class: "tile gold" },
        h("span", { class: "tile-icon" }, icon("star")),
        h("span", { class: "tile-name" }, "RateMy", h("br"), h("span", {}, "Bro"), "fessor")),
      h("a", { href: "#/wbt", class: "tile purple" },
        h("span", { class: "tile-icon" }, icon("people")),
        h("span", { class: "tile-name" }, "What's", h("br"), h("span", {}, "Bro"), "Taking"))),
    h("p", { class: "hub-links" },
      isAdmin() && h("a", { href: "#/admin" }, "Admin"),
      isAdmin() && h("span", { "aria-hidden": "true" }, "·"),
      h("button", { type: "button", class: "link muted", onclick: signOut }, "Sign out"))));
}

// ---------- What'sBroTaking ----------

const enc = encodeURIComponent;
const classesWord = (n) => `${n} ${n === 1 ? "class" : "classes"}`;

function wbtHero(title, quarter, extra) {
  return h("header", { class: "hero" },
    h("div", { class: "wrap" },
      h("div", { class: "hero-top" },
        h("a", { href: "#/wbt", class: "wordmark small" }, "What's", h("span", {}, "Bro"), "Taking"),
        h("span", { class: "crest" }, quarter)),
      h("h1", {}, title),
      extra));
}

// Pills to switch quarters; `path` is the page to reopen with ?quarter=.
function quarterPills(quarter, quarters, path) {
  if (quarters.length < 2) return null;
  return h("div", { class: "pills", role: "group", "aria-label": "Quarter" },
    [...quarters].reverse().map((qtr) => h("a", {
      href: `${path}?quarter=${enc(qtr)}`, class: "pill", "aria-current": qtr === quarter ? "true" : null,
    }, qtr)));
}

function emptyWbt(quarter) {
  return h("div", { class: "empty" },
    h("p", {}, `No one has added their ${quarter} classes yet.`),
    h("a", { href: `#/wbt/add?quarter=${enc(quarter)}`, class: "btn gold" }, "Add my classes"));
}

// Class -> brothers taking it, most popular first.
function groupByClass(schedules) {
  const map = new Map();
  for (const s of schedules) {
    for (const c of s.classes) {
      const entry = map.get(c.course_code) || { code: c.course_code, people: [] };
      entry.people.push(s);
      map.set(c.course_code, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.people.length - a.people.length || a.code.localeCompare(b.code));
}

function wbtClassRow(c, catalog, quarter) {
  const title = courseTitle(catalog, c.code);
  return h("a", { href: `#/wbt/class/${enc(c.code)}?quarter=${enc(quarter)}`, class: "list-row" },
    h("span", { class: "code-badge" }, coursePrefix(c.code)),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, c.code),
      title && h("div", { class: "row-sub strong" }, title),
      h("div", { class: "faces" },
        c.people.slice(0, 6).map((s) => personAvatar(s, "mini")),
        c.people.length > 6 && h("span", { class: "row-sub" }, `+${c.people.length - 6}`))),
    h("span", { class: "count-chip" }, String(c.people.length), h("small", {}, c.people.length === 1 ? "brother" : "brothers")));
}

function brotherRow(s) {
  const codes = s.classes.map((c) => c.course_code).sort();
  return h("a", { href: `#/wbt/brother/${s.id}`, class: "list-row" },
    personAvatar(s),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, s.full_name),
      h("div", { class: "row-sub" }, `${classesWord(codes.length)}: ${codes.join(", ")}`)));
}

async function renderWbtHome(view, requested) {
  const current = await loadCurrentQuarter();
  const quarter = requested || current;
  const [schedules, quarters, catalog] = await Promise.all([loadQuarter(quarter), loadQuarterList(current), loadCatalog()]);
  const classes = groupByClass(schedules);

  const search = h("input", { id: "wbt-search", type: "search", placeholder: "Class or brother's name", enterkeyhint: "search" });
  const list = h("div", { class: "list" });
  function update() {
    const text = search.value.trim();
    const key = compact(text);
    const words = text.toLowerCase();
    const people = text ? schedules.filter((s) => s.full_name.toLowerCase().includes(words)) : [];
    const shown = text
      ? classes.filter((c) => (key && compact(c.code).includes(key)) || courseTitle(catalog, c.code).toLowerCase().includes(words))
      : classes;
    list.replaceChildren(...[
      people.length > 0 && h("p", { class: "list-label" }, "Brothers"),
      ...people.map(brotherRow),
      shown.length > 0 && h("p", { class: "list-label" }, text ? "Classes" : "Most-taken classes"),
      ...shown.map((c) => wbtClassRow(c, catalog, quarter)),
      people.length === 0 && shown.length === 0 && (schedules.length ? h("p", { class: "muted pad" }, "No matches.") : emptyWbt(quarter)),
    ].filter(Boolean));
  }
  search.addEventListener("input", update);

  view.replaceChildren(
    wbtHero(`What's everyone taking in ${quarter}?`, quarter,
      h("div", { class: "hero-search" }, icon("search"), h("label", { for: "wbt-search", class: "sr-only" }, "Search"), search)),
    h("main", { class: "wrap page" },
      quarterPills(quarter, quarters, "#/wbt"),
      schedules.length > 0 && h("p", { class: "summary" }, `${plural(schedules.length, "brother")} · ${classesWord(classes.length)}`),
      h("a", { href: `#/wbt/add?quarter=${enc(quarter)}`, class: "btn gold block" }, icon("plus"), "Add or edit my classes"),
      list));
  update();
}

async function renderWbtClass(view, code, requested) {
  const current = await loadCurrentQuarter();
  const quarter = requested || current;
  const [schedules, catalog] = await Promise.all([loadQuarter(quarter), loadCatalog()]);
  const title = courseTitle(catalog, code);
  const dept = catalog.departments[coursePrefix(code)];
  const taking = schedules.flatMap((s) => s.classes.filter((c) => c.course_code === code).map((c) => ({ s, c })));

  // Group by lecture section; brothers without a section go last.
  const groups = new Map();
  for (const t of taking) {
    const key = t.c.section || "";
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));

  view.replaceChildren(
    pageHeader(code, {
      back: `#/wbt?quarter=${enc(quarter)}`,
      extra: h("div", { class: "class-header-info" },
        title && h("p", { class: "class-header-title" }, title),
        h("p", { class: "on-purple-muted" }, [dept, `${plural(taking.length, "brother")} in ${quarter}`].filter(Boolean).join(" · "))),
    }),
    h("main", { class: "wrap page" },
      h("a", { href: `#/class/${enc(code)}`, class: "crosslink" },
        icon("star"), h("span", { class: "grow" }, h("b", {}, "See reviews"), ` of ${code} professors on RateMyBrofessor`), "›"),
      taking.length === 0
        ? h("div", { class: "empty" },
          h("p", {}, `No brothers have added ${code} for ${quarter} yet.`),
          h("a", { href: `#/wbt/add?quarter=${enc(quarter)}`, class: "btn gold" }, "I'm taking this"))
        : keys.map((key) => h("section", {},
          h("p", { class: "list-label" }, key ? `Section ${key}` : "Section not given"),
          h("div", { class: "list" }, groups.get(key).map(({ s, c }) => h("a", { href: `#/wbt/brother/${s.id}`, class: "list-row" },
            personAvatar(s),
            h("div", { class: "grow" },
              h("div", { class: "row-title" }, s.full_name),
              c.quiz_section && h("div", { class: "row-sub" }, `Quiz section ${c.quiz_section}`)))))))));
}

async function renderWbtBrothers(view, requested) {
  const current = await loadCurrentQuarter();
  const quarter = requested || current;
  const [schedules, quarters] = await Promise.all([loadQuarter(quarter), loadQuarterList(current)]);

  const search = h("input", { id: "brother-search", type: "search", placeholder: "Search by name" });
  const list = h("div", { class: "list" });
  function update() {
    const words = search.value.trim().toLowerCase();
    const rows = schedules.filter((s) => s.full_name.toLowerCase().includes(words));
    list.replaceChildren(...(rows.length
      ? rows.map(brotherRow)
      : [schedules.length ? h("p", { class: "muted pad" }, "No brothers match.") : emptyWbt(quarter)]));
  }
  search.addEventListener("input", update);

  view.replaceChildren(
    pageHeader("Brothers", {
      subtitle: `${plural(schedules.length, "brother")} added classes for ${quarter}`,
      extra: h("div", { class: "header-search" }, icon("search"), h("label", { for: "brother-search", class: "sr-only" }, "Search brothers"), search),
    }),
    h("main", { class: "wrap page" }, quarterPills(quarter, quarters, "#/wbt/brothers"), list));
  update();
}

// A schedule's classes as tappable rows. `others(code)` counts other brothers in that class (optional).
function scheduleClassRows(classes, catalog, quarter, others) {
  return h("div", { class: "list" },
    [...classes].sort((a, b) => a.course_code.localeCompare(b.course_code)).map((c) => {
      const n = others?.(c.course_code);
      return h("a", { href: `#/wbt/class/${enc(c.course_code)}?quarter=${enc(quarter)}`, class: "list-row" },
        h("span", { class: "code-badge" }, coursePrefix(c.course_code)),
        h("div", { class: "grow" },
          h("div", { class: "row-title" }, c.course_code),
          courseTitle(catalog, c.course_code) && h("div", { class: "row-sub strong" }, courseTitle(catalog, c.course_code)),
          h("div", { class: "row-sub" }, [sectionLabel(c), n == null ? null : n ? plural(n, "other brother") : "No other brothers yet"].filter(Boolean).join(" · "))),
        "›");
    }));
}

async function renderWbtBrother(view, id) {
  const s = await q(supabase.from("schedules").select("id, quarter, owner_email, full_name, updated_at").eq("id", id).maybeSingle());
  if (!s) {
    view.replaceChildren(pageHeader("Not found", { back: "#/wbt/brothers" }), h("main", { class: "wrap page" }, h("p", {}, "This schedule was deleted or doesn't exist.")));
    return;
  }
  const [everyone, catalog] = await Promise.all([loadQuarter(s.quarter), loadCatalog()]);
  const me = everyone.find((x) => x.id === id) || { ...s, classes: [] };
  const classmates = (code) => everyone.filter((x) => x.id !== id && x.classes.some((c) => c.course_code === code)).length;
  const mine = Boolean(access?.email) && s.owner_email === access.email;

  view.replaceChildren(
    h("header", { class: "prof-hero" },
      h("div", { class: "wrap" },
        h("a", { href: `#/wbt/brothers?quarter=${enc(s.quarter)}`, class: "round-btn on-purple", "aria-label": "Back" }, icon("back")),
        h("div", { class: "prof-id" },
          h("span", { class: "prof-avatar" }, initials(s.full_name)),
          h("div", {},
            h("h1", {}, s.full_name),
            h("p", { class: "on-purple-muted" }, `${s.quarter} · ${classesWord(me.classes.length)}`))))),
    h("main", { class: "wrap page" },
      scheduleClassRows(me.classes, catalog, s.quarter, classmates),
      mine && h("div", { class: "action-row" },
        h("a", { href: `#/wbt/add?quarter=${enc(s.quarter)}`, class: "btn purple small" }, "Edit my classes"),
        h("a", { href: "#/wbt/profile" }, "My classes"))));
}

// ---------- What'sBroTaking: my classes ----------

// Shown when someone signed in with a shared password (not their own UW account) tries to add classes.
function googleNeeded(view) {
  const msg = h("p", { class: "error", hidden: true });
  view.replaceChildren(
    pageHeader("My classes", { back: "#/wbt" }),
    h("main", { class: "wrap page" },
      h("div", { class: "empty" },
        h("p", {}, "To add your classes, sign in with your own UW Google account so brothers know it's you."),
        h("button", {
          type: "button", class: "btn google",
          onclick: async () => {
            const error = await signInWithGoogle();
            if (error) { msg.textContent = error; msg.hidden = false; }
          },
        }, icon("google"), "Sign in with UW Google"),
        msg)));
}

async function renderWbtProfile(view) {
  if (!access?.can_edit) return googleNeeded(view);
  const [current, catalog] = await Promise.all([loadCurrentQuarter(), loadCatalog()]);
  const mine = await q(supabase.from("schedules").select("id, quarter, owner_email, full_name, updated_at").eq("owner_email", access.email));
  const ids = mine.map((s) => s.id);
  const classes = ids.length ? await q(supabase.from("schedule_classes").select("id, schedule_id, course_code, section, quiz_section").in("schedule_id", ids)) : [];
  const withClasses = mine.map((s) => ({ ...s, classes: classes.filter((c) => c.schedule_id === s.id) }))
    .sort((a, b) => byQuarter(b.quarter, a.quarter));
  const now = withClasses.find((s) => s.quarter === current);
  const others = withClasses.filter((s) => s.quarter !== current);

  view.replaceChildren(
    h("header", { class: "prof-hero" },
      h("div", { class: "wrap" },
        h("a", { href: "#/wbt", class: "round-btn on-purple", "aria-label": "Back" }, icon("back")),
        h("div", { class: "prof-id" },
          h("span", { class: "prof-avatar" }, initials(access.name || access.email)),
          h("div", {},
            h("h1", {}, access.name),
            h("p", { class: "on-purple-muted break" }, access.email))))),
    h("main", { class: "wrap page" },
      h("section", {},
        h("div", { class: "section-head" }, h("h2", {}, `My ${current} classes`)),
        now
          ? [scheduleClassRows(now.classes, catalog, current),
            h("div", { class: "action-row" },
              h("a", { href: `#/wbt/add?quarter=${enc(current)}`, class: "btn purple small" }, "Edit classes"),
              h("button", {
                type: "button", class: "link muted",
                onclick: async () => {
                  if (confirm(`Delete your ${current} classes?`) && await act("delete_my_schedule", { p_schedule_id: now.id })) render();
                },
              }, "Delete"))]
          : h("div", { class: "empty" },
            h("p", {}, `You haven't added your ${current} classes yet.`),
            h("a", { href: `#/wbt/add?quarter=${enc(current)}`, class: "btn gold" }, icon("plus"), `Add my ${current} classes`))),
      others.length > 0 && h("section", {},
        h("div", { class: "section-head" }, h("h2", {}, "Other quarters")),
        h("div", { class: "list" }, others.map((s) => h("a", { href: `#/wbt/brother/${s.id}`, class: "list-row" },
          h("span", { class: "code-badge" }, s.quarter.split(" ")[0].slice(0, 3).toUpperCase()),
          h("div", { class: "grow" },
            h("div", { class: "row-title" }, s.quarter),
            h("div", { class: "row-sub" }, `${classesWord(s.classes.length)}: ${s.classes.map((c) => c.course_code).sort().join(", ")}`)),
          "›")))),
      namePanel(),
      h("p", { class: "signout-line" }, h("button", { type: "button", class: "link muted", onclick: signOut }, "Sign out of this device"))));
}

// Lets a brother change how their name appears (it starts as the name on their Google account).
function namePanel() {
  const input = h("input", { id: "my-name", class: "input", maxlength: 80, required: true, autocomplete: "name", value: access.name });
  const msg = h("p", { class: "hint", hidden: true });
  const form = h("form", {},
    field("Name brothers see", "my-name", input),
    msg,
    h("button", { type: "submit", class: "btn purple small" }, "Save name"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await call("set_my_name", { p_name: input.value });
      access = await loadAccess();
      render();
    } catch (err) {
      msg.className = "error";
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
  return h("details", { class: "panel" }, h("summary", {}, "Change how my name appears"), form);
}

async function renderWbtForm(view, requested) {
  if (!access?.can_edit) return googleNeeded(view);
  const [current, catalog] = await Promise.all([loadCurrentQuarter(), loadCatalog()]);
  const options = [shiftQuarter(current, -1), current, shiftQuarter(current, 1)];
  let quarter = requested && /^(Autumn|Winter|Spring|Summer) \d{4}$/.test(requested) ? requested : current;
  if (!options.includes(quarter)) options.push(quarter);
  options.sort(byQuarter);

  async function loadMine(qtr) {
    const s = await q(supabase.from("schedules").select("id").eq("owner_email", access.email).eq("quarter", qtr).maybeSingle());
    return s ? q(supabase.from("schedule_classes").select("course_code, section, quiz_section").eq("schedule_id", s.id)) : [];
  }

  const quarterSelect = h("select", { id: "wbt-quarter", class: "input", value: quarter }, options.map((o) => h("option", { value: o }, o)));
  const intro = h("p", { class: "row-sub" });

  // Class rows (4 to start, like the Google Form, plus "Add another class")
  const rowsBox = h("div", { class: "class-rows" });
  const rows = [];
  function renumber() {
    rows.forEach((r, i) => { r.num.textContent = `Class #${i + 1}`; r.picker.input.setAttribute("aria-label", `Class #${i + 1}`); });
  }
  function addRow(c = {}) {
    const picker = makeCoursePicker(catalog, { value: c.course_code || "" });
    const section = h("input", { class: "input small-input", maxlength: 3, placeholder: "A", autocapitalize: "characters", "aria-label": "Section (required)", value: c.section || "" });
    const quiz = h("input", { class: "input small-input", maxlength: 3, placeholder: "AB", autocapitalize: "characters", "aria-label": "Quiz section", value: c.quiz_section || "" });
    const num = h("span", { class: "class-num" });
    const row = {
      picker, section, quiz, num,
      el: h("div", { class: "class-row" },
        h("div", { class: "class-row-head" }, num,
          h("button", { type: "button", class: "link muted", onclick: () => removeRow(row) }, "Remove")),
        picker.box, picker.picked,
        h("div", { class: "section-row" },
          h("label", {}, h("span", {}, "Section ", h("b", { class: "req" }, "*")), section),
          h("label", {}, h("span", {}, "Quiz section (optional)"), quiz))),
    };
    rows.push(row);
    rowsBox.append(row.el);
    renumber();
    return row;
  }
  function removeRow(row) {
    if (rows.length === 1) {
      row.picker.input.value = row.section.value = row.quiz.value = "";
      row.picker.picked.textContent = "";
      return;
    }
    rows.splice(rows.indexOf(row), 1);
    row.el.remove();
    renumber();
  }
  function fill(classes) {
    rows.length = 0;
    rowsBox.replaceChildren();
    for (const c of classes) addRow(c);
    while (rows.length < 4) addRow();
  }
  function updateIntro(hasClasses) {
    intro.replaceChildren(hasClasses ? "Update your " : "Add your ", h("strong", {}, "registered"),
      ` classes for ${quarter}. Brothers can see who's in their classes before the quarter starts.`);
  }
  quarterSelect.addEventListener("change", async () => {
    quarter = quarterSelect.value;
    const classes = await loadMine(quarter);
    fill(classes);
    updateIntro(classes.length > 0);
  });

  const status = h("p", { class: "error", hidden: true });
  const submit = h("button", { class: "btn gold block big", type: "submit" }, "Save my classes");
  const form = h("form", { class: "review-form wrap" },
    h("div", { class: "form-top" },
      h("a", { href: "#/wbt/profile", class: "round-btn", "aria-label": "Close" }, icon("close")),
      h("span", { class: "row-sub" }, "Visible to brothers")),
    h("div", { class: "form-intro" }, h("h1", {}, "What's Bro Taking?"), intro),
    h("div", { class: "q" },
      h("p", { class: "signed-in-as" }, "Adding as ", h("strong", {}, access.name), " · ", h("a", { href: "#/wbt/profile" }, "Change name")),
      field("Quarter", "wbt-quarter", quarterSelect)),
    h("fieldset", { class: "q" }, h("legend", {}, "Your classes"),
      h("p", { class: "hint" }, "Include your registered section, plus your quiz section if you have one (e.g. ACCTG 215, section A, quiz section AB)."),
      rowsBox,
      h("button", { type: "button", class: "btn add-row", onclick: () => addRow().picker.input.focus() }, icon("plus"), "Add another class")),
    status,
    submit);

  function showStatus(text) {
    status.textContent = text;
    status.hidden = false;
    status.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.hidden = true;
    const entries = rows
      .map((r) => ({ raw: r.picker.input.value.trim(), code: r.picker.code(), section: r.section.value.trim().toUpperCase(), quiz: r.quiz.value.trim().toUpperCase() }))
      .filter((x) => x.raw);
    if (entries.length === 0) return showStatus("Add at least one class.");
    const missing = entries.find((x) => !x.section);
    if (missing) {
      rows.find((r) => r.picker.input.value.trim() === missing.raw)?.section.focus();
      return showStatus(`Add your section for ${missing.code || normalizeCourse(missing.raw)} (e.g. A).`);
    }
    if (entries.some((x) => !/^[A-Z0-9]{1,3}$/.test(x.section) || (x.quiz && !/^[A-Z0-9]{1,3}$/.test(x.quiz)))) {
      return showStatus("Sections are letters or numbers only, like A or AB.");
    }
    const unknown = entries.filter((x) => !x.code).map((x) => normalizeCourse(x.raw));
    if (unknown.length && catalog.list.length
      && !confirm(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} in the UW course catalog. Save anyway? (Tap Cancel to fix it.)`)) return;

    submit.disabled = true;
    try {
      const id = await call("save_my_schedule", {
        p_quarter: quarter,
        p_classes: entries.map((x) => ({ course: x.code || normalizeCourse(x.raw), section: x.section, quiz: x.quiz || null })),
      });
      location.hash = `#/wbt/brother/${id}`;
    } catch (err) {
      showStatus("Couldn't save: " + err.message);
      submit.disabled = false;
    }
  });

  const existing = await loadMine(quarter);
  fill(existing);
  updateIntro(existing.length > 0);
  view.replaceChildren(form);
}

// ---------- Setup & login ----------

function renderSetup() {
  app.replaceChildren(h("main", { class: "login-screen" },
    h("div", { class: "login-card" },
      h("h1", {}, "Almost there"),
      h("p", {}, "Add your Supabase Project URL and anon key to config.js, then push the change."))));
}

// Sends the browser to Google. Returns an error message if it couldn't start.
async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    // hd suggests UW accounts in Google's account picker; the roster is what actually decides.
    options: { redirectTo: location.origin + location.pathname, queryParams: { hd: "uw.edu", prompt: "select_account" } },
  });
  if (!error) return null;
  return /not enabled|provider/i.test(error.message) ? "Google sign-in isn't set up yet." : error.message;
}

function renderLogin() {
  document.body.classList.remove("signed-in");
  const input = h("input", { type: "password", id: "password", class: "input", autocomplete: "current-password", required: true, placeholder: "Enter the chapter password" });
  const msg = h("p", { class: "error", hidden: true });
  const btn = h("button", { class: "btn purple block", type: "submit" }, "Sign in with password");
  const googleMsg = h("p", { class: "error", hidden: true });

  const google = h("button", {
    type: "button", class: "btn google block big",
    onclick: async () => {
      googleMsg.hidden = true;
      const error = await signInWithGoogle();
      if (error) {
        googleMsg.textContent = error;
        googleMsg.hidden = false;
      }
    },
  }, icon("google"), "Sign in with UW Google");

  const form = h("form", { class: "signin-form" },
    google,
    googleMsg,
    h("p", { class: "signin-note" }, "Use your @uw.edu account. For Delta Sigma Pi brothers on the chapter roster."),
    h("details", { class: "signin-alt" },
      h("summary", {}, "Use the chapter password instead"),
      h("label", { for: "password", class: "signin-label" }, "Chapter password"),
      input,
      msg,
      btn));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.hidden = true;
    const password = input.value;
    // One password box: try the member login, then the admin login.
    let { error } = await supabase.auth.signInWithPassword({ email: CONFIG.MEMBER_EMAIL, password });
    if (error) ({ error } = await supabase.auth.signInWithPassword({ email: CONFIG.ADMIN_EMAIL, password }));
    if (error) {
      msg.textContent = error.status === 400 ? "That password didn't work." : error.message;
      msg.hidden = false;
      btn.disabled = false;
    }
  });

  // Split screen: purple welcome on top, gold line, password below.
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-top" },
      h("span", { class: "signin-crest", "aria-hidden": "true" }, "ΔΣΠ"),
      h("h1", {}, "Welcome back, brother"),
      h("p", {}, "RateMyBrofessor · What'sBroTaking")),
    h("section", { class: "signin-bottom" }, form)));
}

// Signed in, but not allowed: not on the roster, or the chapter password was turned off.
function renderNoAccess() {
  document.body.classList.remove("signed-in");
  const viaPassword = access?.via === "chapter";
  const message = !access
    ? "We couldn't check your access. Check your connection and try again."
    : viaPassword
      ? "The chapter password has been turned off. Sign in with your UW Google account instead."
      : `You're signed in as ${access.email}, but that email isn't on the chapter roster yet. Ask the VP of Scholarship to add you, then sign in again.`;
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-top" },
      h("span", { class: "signin-crest", "aria-hidden": "true" }, "ΔΣΠ"),
      h("h1", {}, viaPassword ? "Sign in with Google" : "Almost there")),
    h("section", { class: "signin-bottom" },
      h("div", { class: "signin-form" },
        h("p", { class: "noaccess-msg" }, message),
        h("button", { type: "button", class: "btn gold block big", onclick: signOut }, viaPassword ? "Back to sign in" : "Sign out and try another account")))));
}

// ---------- Home ----------

async function renderHome(view) {
  const [{ profs, reviews, byId }, catalog] = await Promise.all([loadAll(), loadCatalog()]);
  const reviewed = profs.filter((p) => p.review_count > 0);

  const search = h("input", { id: "home-search", type: "search", placeholder: "Class or professor", enterkeyhint: "search" });
  const searchForm = h("form", { class: "hero-search", role: "search" },
    icon("search"),
    h("label", { for: "home-search", class: "sr-only" }, "Search"),
    search,
    h("button", { type: "submit", class: "go" }, "Go"));
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(search.value.trim())}`;
  });

  const hero = h("header", { class: "hero" },
    h("div", { class: "wrap" },
      h("div", { class: "hero-top" },
        h("a", { href: "#/rate", class: "wordmark small" }, "RateMy", h("span", {}, "Bro"), "fessor"),
        h("span", { class: "crest" }, "ΔΣΠ")),
      h("h1", {}, "What are you taking next quarter?"),
      searchForm));

  if (reviews.length === 0) {
    view.replaceChildren(hero, h("main", { class: "wrap home" }, emptyState("No reviews yet. Be the first brother to rate a professor!")));
    return;
  }

  // Department bubbles, busiest first, labelled with the department's most common course prefix (e.g. FIN).
  const deptCounts = {};
  const prefixCounts = {};
  for (const p of reviewed) {
    if (!p.department) continue;
    deptCounts[p.department] = (deptCounts[p.department] || 0) + p.review_count;
    const counts = (prefixCounts[p.department] ||= {});
    for (const c of p.courses) counts[coursePrefix(c)] = (counts[coursePrefix(c)] || 0) + 1;
  }
  const deptLabel = (d) => Object.entries(prefixCounts[d] || {}).sort((a, b) => b[1] - a[1])[0]?.[0].slice(0, 6)
    || d.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
  const depts = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d]) => d);
  const bubbles = depts.length > 0 && h("div", { class: "bubbles wrap" },
    h("a", { href: "#/search", class: "bubble" }, h("span", { class: "ring active" }, "ALL"), "Everyone"),
    depts.map((d) => h("a", { href: `#/search?dept=${encodeURIComponent(d)}`, class: "bubble" },
      h("span", { class: "ring" }, deptLabel(d)), d)));

  const best = [...reviewed].sort((a, b) => b.avg_overall - a.avg_overall || b.review_count - a.review_count)[0];
  const spotlight = h("a", { href: `#/prof/${best.id}`, class: "spotlight" },
    h("span", { class: "spot-avatar" }, initials(best.name)),
    h("div", {},
      h("span", { class: "eyebrow" }, "TOP RATED"),
      h("span", { class: "spot-name" }, best.name),
      h("span", { class: "spot-meta" },
        [best.department, `★ ${fmt(best.avg_overall)}`, `${best.pct_take_again}% would retake`].filter(Boolean).join(" · "))));

  // Charts
  const since = Date.now() - TRENDING_DAYS * 24 * 60 * 60_000;
  const recentCounts = {};
  for (const r of reviews) if (new Date(r.created_at) >= since) recentCounts[r.professor_id] = (recentCounts[r.professor_id] || 0) + 1;
  const charts = {
    trending: {
      label: "Trending",
      rows: reviewed.filter((p) => recentCounts[p.id]).sort((a, b) => recentCounts[b.id] - recentCounts[a.id] || b.avg_overall - a.avg_overall),
      sub: (p) => `${plural(recentCounts[p.id], "new review")}`,
      empty: `No new reviews in the last ${TRENDING_DAYS} days.`,
    },
    rating: {
      label: "Top rated",
      rows: [...reviewed].sort((a, b) => b.avg_overall - a.avg_overall || b.review_count - a.review_count),
      sub: (p) => plural(p.review_count, "review"),
    },
    easiest: {
      label: "Easiest",
      rows: [...reviewed].sort((a, b) => a.avg_difficulty - b.avg_difficulty || b.review_count - a.review_count),
      sub: (p) => plural(p.review_count, "review"),
    },
    hardest: {
      label: "Hardest",
      rows: [...reviewed].sort((a, b) => b.avg_difficulty - a.avg_difficulty || b.review_count - a.review_count),
      sub: (p) => plural(p.review_count, "review"),
    },
  };
  const chartTabs = h("div", { class: "pills", role: "group", "aria-label": "Chart" });
  const chartList = h("div", { class: "chart" });
  function updateChart() {
    chartTabs.replaceChildren(...Object.entries(charts).map(([key, c]) => h("button", {
      type: "button", class: "pill", "aria-pressed": String(homeState.chart === key),
      onclick: () => { homeState.chart = key; updateChart(); },
    }, c.label)));
    const chart = charts[homeState.chart];
    const rows = chart.rows.slice(0, 5);
    chartList.replaceChildren(...(rows.length
      ? rows.map((p, i) => chartRow(p, i + 1, [p.department, chart.sub(p)].filter(Boolean).join(" · ")))
      : [h("p", { class: "muted small pad" }, chart.empty)]));
  }
  updateChart();

  // Popular classes
  const classes = summarizeClasses(reviews).slice(0, 4);

  // Fresh feed
  const feed = h("div", { class: "feed" }, reviews.slice(0, 10).map((r, i) => feedCard(r, byId.get(r.professor_id), i)));

  view.replaceChildren(
    hero,
    bubbles,
    h("main", { class: "wrap home" },
      spotlight,
      h("section", {},
        h("div", { class: "section-head" }, h("h2", {}, "The charts"), h("a", { href: "#/search" }, "See all")),
        chartTabs,
        chartList),
      classes.length > 0 && h("section", {},
        h("div", { class: "section-head" }, h("h2", {}, "Popular classes"), h("a", { href: "#/classes" }, "All classes")),
        h("div", { class: "class-grid" }, classes.map((c) => classTile(c, catalog)))),
      h("section", {},
        h("div", { class: "section-head" }, h("h2", {}, "Fresh from the chapter")),
        feed),
      h("p", { class: "signout-line" }, h("button", { type: "button", class: "link muted", onclick: signOut }, "Sign out of this device"))));
}

function chartRow(p, rank, subtitle) {
  return h("a", { href: `#/prof/${p.id}`, class: "chart-row" },
    h("span", { class: "rank" }, rank),
    avatar(p),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, p.name),
      h("div", { class: "row-sub" }, subtitle),
      h("div", { class: "meter-line" },
        h("span", { class: "meter" }, h("span", { style: `width: ${(Number(p.avg_difficulty) / 5) * 100}%` })),
        `Difficulty ${fmt(p.avg_difficulty)}`)),
    rateChip(p.avg_overall));
}

function feedCard(r, prof, index) {
  if (!prof) return null;
  return h("a", { href: `#/prof/${prof.id}`, class: `feed-card${index % 5 === 1 ? " purple" : ""}` },
    stars(r.overall),
    h("span", { class: "quote" }, `“${truncate(r.body, 160)}”`),
    r.tags.length > 0 && h("span", { class: "tags" }, r.tags.slice(0, 2).map((t) => h("span", { class: "tag" }, t))),
    h("span", { class: "byline" },
      avatar(prof, "mini"),
      h("span", {}, h("b", {}, prof.name), h("span", { class: "row-sub" }, `${r.course_code} · ${timeAgo(r.created_at)}`))));
}

function summarizeClasses(reviews) {
  const map = new Map();
  for (const r of reviews) {
    const c = map.get(r.course_code) || { code: r.course_code, count: 0, total: 0, profs: new Set() };
    c.count += 1;
    c.total += r.overall;
    c.profs.add(r.professor_id);
    map.set(r.course_code, c);
  }
  return [...map.values()].map((c) => ({ ...c, avg: c.total / c.count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function classTile(c, catalog) {
  const title = courseTitle(catalog, c.code);
  return h("a", { href: `#/class/${encodeURIComponent(c.code)}`, class: "class-tile" },
    h("span", { class: "class-code" }, c.code),
    title && h("span", { class: "class-title" }, title),
    h("span", { class: "row-sub" }, `${plural(c.profs.size, "professor")} · avg ${fmt(c.avg)}`));
}

// ---------- Search ----------

async function renderSearch(view, initialQuery, dept) {
  const { profs } = await loadAll();

  const search = h("input", { id: "search", type: "search", placeholder: "Professor, department, or class (e.g. FIN 350)", value: initialQuery, enterkeyhint: "search" });
  const sortPills = h("div", { class: "pills", role: "group", "aria-label": "Sort" });
  const list = h("div", { class: "list" });
  const sorters = {
    rating: ["Top rated", (a, b) => (b.avg_overall ?? -1) - (a.avg_overall ?? -1) || b.review_count - a.review_count],
    reviews: ["Most reviewed", (a, b) => b.review_count - a.review_count || a.name.localeCompare(b.name)],
    name: ["A–Z", (a, b) => a.name.localeCompare(b.name)],
  };

  function update() {
    sortPills.replaceChildren(...Object.entries(sorters).map(([key, [label]]) => h("button", {
      type: "button", class: "pill", "aria-pressed": String(browseState.sort === key),
      onclick: () => { browseState.sort = key; update(); },
    }, label)));
    const term = search.value.trim().toLowerCase();
    const course = compact(search.value);
    const rows = profs
      .filter((p) => !dept || p.department === dept)
      .filter((p) => !term
        || `${p.name} ${p.department}`.toLowerCase().includes(term)
        || (course && p.courses.some((c) => compact(c).includes(course))))
      .sort(sorters[browseState.sort][1]);
    list.replaceChildren(...(rows.length
      ? rows.map(profRow)
      : [profs.length ? h("p", { class: "muted pad" }, "No professors match your search.") : emptyState("No professors yet.")]));
  }
  search.addEventListener("input", update);

  view.replaceChildren(
    pageHeader(dept || "Search", {
      back: dept ? "#/rate" : null,
      extra: h("div", { class: "header-search" }, icon("search"), h("label", { for: "search", class: "sr-only" }, "Search"), search),
    }),
    h("main", { class: "wrap page" }, sortPills, list));
  update();
  if (!dept) search.focus();
}

function profRow(p) {
  const stats = p.review_count
    ? `${plural(p.review_count, "review")} · Difficulty ${fmt(p.avg_difficulty)} · ${p.pct_take_again}% retake`
    : "No reviews yet";
  return h("a", { href: `#/prof/${p.id}`, class: "list-row" },
    avatar(p),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, p.name),
      h("div", { class: "row-sub" }, [p.department, stats].filter(Boolean).join(" · "))),
    rateChip(p.avg_overall));
}

// ---------- Classes ----------

async function renderClasses(view) {
  const [{ reviews }, catalog] = await Promise.all([loadAll(), loadCatalog()]);
  const classes = summarizeClasses(reviews);
  const reviewedCodes = new Set(classes.map((c) => c.code));
  const search = h("input", { id: "class-search", type: "search", placeholder: "FIN 350, marketing…" });
  const list = h("div", { class: "list" });

  const reviewedRow = (c) => h("a", { href: `#/class/${encodeURIComponent(c.code)}`, class: "list-row" },
    h("span", { class: "code-badge" }, coursePrefix(c.code)),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, c.code),
      courseTitle(catalog, c.code) && h("div", { class: "row-sub strong" }, courseTitle(catalog, c.code)),
      h("div", { class: "row-sub" }, `${plural(c.profs.size, "professor")} · ${plural(c.count, "review")}`)),
    rateChip(c.avg));
  const catalogRow = (c) => h("a", { href: `#/class/${encodeURIComponent(c.code)}`, class: "list-row" },
    h("span", { class: "code-badge" }, coursePrefix(c.code)),
    h("div", { class: "grow" },
      h("div", { class: "row-title" }, c.code),
      h("div", { class: "row-sub strong" }, c.title),
      h("div", { class: "row-sub" }, "No reviews yet")),
    rateChip(null));

  function update() {
    const text = search.value.trim();
    if (!text) {
      list.replaceChildren(...(classes.length
        ? [h("p", { class: "list-label" }, "Reviewed by the chapter"), ...classes.map(reviewedRow)]
        : [h("p", { class: "muted pad" }, "No classes reviewed yet. Search any UW class above.")]));
      return;
    }
    const key = compact(text);
    const words = text.toLowerCase();
    const reviewedMatches = classes.filter((c) => compact(c.code).includes(key)
      || courseTitle(catalog, c.code).toLowerCase().includes(words));
    const catalogMatches = findCourses(catalog, text, 30).filter((c) => !reviewedCodes.has(c.code));
    list.replaceChildren(...(reviewedMatches.length || catalogMatches.length
      ? [
        reviewedMatches.length > 0 && h("p", { class: "list-label" }, "Reviewed by the chapter"),
        ...reviewedMatches.map(reviewedRow),
        catalogMatches.length > 0 && h("p", { class: "list-label" }, "Other UW classes"),
        ...catalogMatches.map(catalogRow),
      ].filter(Boolean)
      : [h("p", { class: "muted pad" }, "No UW classes match. Try a code like FIN 350 or a word like \"marketing\".")]));
  }
  search.addEventListener("input", update);

  view.replaceChildren(
    pageHeader("Classes", {
      subtitle: "Every UW Seattle class. See who teaches it and what brothers thought.",
      extra: h("div", { class: "header-search" }, icon("search"), h("label", { for: "class-search", class: "sr-only" }, "Search classes"), search),
    }),
    h("main", { class: "wrap page" }, list));
  update();
}

async function renderClass(view, code) {
  const [{ reviews, byId }, catalog, current] = await Promise.all([loadAll(), loadCatalog(), loadCurrentQuarter()]);
  const takingNow = (await loadQuarter(current)).filter((s) => s.classes.some((c) => c.course_code === code)).length;
  const title = courseTitle(catalog, code);
  const dept = catalog.departments[coursePrefix(code)];
  const forClass = reviews.filter((r) => r.course_code === code);
  const groups = new Map();
  for (const r of forClass) {
    const g = groups.get(r.professor_id) || { prof: byId.get(r.professor_id), count: 0, overall: 0, difficulty: 0 };
    g.count += 1;
    g.overall += r.overall;
    g.difficulty += r.difficulty;
    groups.set(r.professor_id, g);
  }
  const rows = [...groups.values()].filter((g) => g.prof)
    .map((g) => ({ ...g, overall: g.overall / g.count, difficulty: g.difficulty / g.count }))
    .sort((a, b) => b.overall - a.overall || b.count - a.count);

  view.replaceChildren(
    pageHeader(code, {
      back: "#/classes",
      extra: h("div", { class: "class-header-info" },
        title && h("p", { class: "class-header-title" }, title),
        h("p", { class: "on-purple-muted" }, [dept, plural(rows.length, "professor"), plural(forClass.length, "review")].filter(Boolean).join(" · "))),
    }),
    h("main", { class: "wrap page" },
      h("a", { href: `#/wbt/class/${encodeURIComponent(code)}?quarter=${encodeURIComponent(current)}`, class: "crosslink" },
        icon("people"),
        h("span", { class: "grow" }, takingNow
          ? [h("b", {}, `${plural(takingNow, "brother")} ${takingNow === 1 ? "is" : "are"} taking this`), ` in ${current}`]
          : [h("b", {}, "What'sBroTaking"), `: see who's taking ${code} in ${current}`]),
        "›"),
      h("a", { href: `#/review/new?course=${encodeURIComponent(code)}`, class: "btn gold block" }, `Review a ${code} professor`),
      h("div", { class: "list" },
        rows.length
          ? rows.map((g) => h("a", { href: `#/prof/${g.prof.id}`, class: "list-row" },
            avatar(g.prof),
            h("div", { class: "grow" },
              h("div", { class: "row-title" }, g.prof.name),
              h("div", { class: "row-sub" }, `In ${code}: ${plural(g.count, "review")} · Difficulty ${fmt(g.difficulty)}`)),
            rateChip(g.overall)))
          : h("p", { class: "muted pad" }, "No reviews for this class yet."))));
}

// ---------- Professor page ----------

async function renderProfessor(view, id) {
  const [prof, reviews, catalog] = await Promise.all([
    q(supabase.from("professor_stats").select("*").eq("id", id).maybeSingle()),
    q(supabase.from("reviews").select(REVIEW_COLUMNS).eq("professor_id", id).order("created_at", { ascending: false })),
    loadCatalog(),
  ]);
  if (!prof) {
    view.replaceChildren(pageHeader("Not found", { back: "#/rate" }), h("main", { class: "wrap page" }, h("p", {}, "Professor not found.")));
    return;
  }

  const tagCounts = {};
  for (const r of reviews) for (const t of r.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const distribution = [0, 0, 0, 0, 0, 0];
  for (const r of reviews) distribution[r.overall] += 1;
  const maxCount = Math.max(1, ...distribution);

  const courses = ["All classes", ...new Set(reviews.map((r) => r.course_code).sort())];
  let course = courses[0];
  const filters = h("div", { class: "pills", role: "group", "aria-label": "Filter by class" });
  const list = h("div", { class: "reviews" });

  function update() {
    filters.replaceChildren(...courses.map((c) =>
      h("button", { type: "button", class: "pill", "aria-pressed": String(c === course), onclick: () => { course = c; update(); } }, c)));
    const shown = reviews.filter((r) => course === courses[0] || r.course_code === course);
    list.replaceChildren(...(shown.length
      ? shown.map((r) => reviewCard(r, catalog))
      : [emptyState("No reviews yet. Be the first!", false)]));
  }

  const rateLink = `#/review/new?prof=${id}`;
  view.replaceChildren(
    h("header", { class: "prof-hero" },
      h("div", { class: "wrap" },
        h("a", { href: "#/rate", class: "round-btn on-purple", "aria-label": "Back" }, icon("back")),
        h("div", { class: "prof-id" },
          h("span", { class: "prof-avatar" }, initials(prof.name)),
          h("div", {},
            h("h1", {}, prof.name),
            h("p", { class: "on-purple-muted" }, [prof.department, plural(prof.review_count, "rating")].filter(Boolean).join(" · ")))))),
    h("main", { class: "wrap page" },
      h("section", { class: "score-card" },
        h("div", { class: "score-top" },
          h("div", {},
            h("div", { class: "score-big" }, fmt(prof.avg_overall), h("span", {}, " / 5")),
            h("div", { class: "row-sub" }, "Overall quality")),
          h("a", { href: rateLink, class: "btn purple" }, icon("plus"), "Rate")),
        h("div", { class: "dist" },
          [5, 4, 3, 2, 1].map((n) => h("div", { class: "dist-row" },
            h("span", { class: "dist-label" }, OVERALL_LABELS[n]),
            h("span", { class: "bar" }, h("span", { style: `width: ${(distribution[n] / maxCount) * 100}%` })),
            h("b", {}, String(distribution[n])))))),
      h("div", { class: "stat-row" },
        stat(prof.review_count ? `${prof.pct_take_again}%` : "–", "Would take again"),
        stat(fmt(prof.avg_difficulty), "Difficulty"),
        stat(prof.pct_attendance_mandatory == null ? "–" : `${prof.pct_attendance_mandatory}%`, "Attendance mandatory")),
      topTags.length > 0 && h("div", { class: "tags" }, topTags.map(([t, n]) => h("span", { class: "tag white" }, `${t} · ${n}`))),
      h("div", { class: "section-head" }, h("h2", {}, plural(reviews.length, "review"))),
      courses.length > 2 && filters,
      list));
  update();
}

// "3.7" stays "3.7"; "W" becomes "W (withdrawal)".
function gradeLabel(value) {
  const label = GRADE_NOTATIONS.find(([v]) => v === value)?.[1];
  return label ? `${value} (${label.split(": ")[1].toLowerCase()})` : value;
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("strong", {}, value), h("span", {}, label));
}

function reviewCard(r, catalog) {
  const token = load(TOKENS)[r.id];
  const edited = new Date(r.updated_at) - new Date(r.created_at) > 60_000;

  const actions = h("div", { class: "review-actions" },
    token && h("a", { href: `#/review/edit/${r.id}` }, "Edit"),
    (token || isAdmin()) && h("button", {
      type: "button", class: "link",
      onclick: async () => {
        if (!confirm("Delete this review? This can't be undone.")) return;
        if (await act("delete_review", { p_id: r.id, p_token: token || null })) { forgetReview(r.id); render(); }
      },
    }, "Delete"),
    h("button", {
      type: "button", class: "link muted",
      onclick: async () => {
        const reason = prompt("Report this review to the admins. What's wrong with it? (optional)");
        if (reason === null) return;
        if (await act("flag_review", { p_id: r.id, p_reason: reason })) alert("Thanks. An admin will take a look.");
      },
    }, "Report"));

  const facts = [
    r.semester,
    r.grade && `Grade ${gradeLabel(r.grade)}`,
    r.take_again ? "Would take again" : "Would not take again",
    r.attendance_mandatory != null && (r.attendance_mandatory ? "Attendance mandatory" : "Attendance not mandatory"),
  ].filter(Boolean).join(" · ");

  return h("article", { class: "review" },
    h("div", { class: "review-boxes" },
      h("div", {}, h("div", { class: "box-label" }, "QUALITY"), h("div", { class: `box ${ratingClass(r.overall)}` }, `${r.overall}.0`)),
      h("div", {}, h("div", { class: "box-label" }, "DIFFICULTY"), h("div", { class: "box neutral" }, `${r.difficulty}.0`))),
    h("div", { class: "review-main" },
      h("div", { class: "review-head" },
        h("a", { href: `#/class/${encodeURIComponent(r.course_code)}`, class: "review-course" }, r.course_code),
        h("span", { class: "row-sub" }, formatDate(r.created_at), edited && " (edited)")),
      courseTitle(catalog, r.course_code) && h("p", { class: "row-sub strong" }, courseTitle(catalog, r.course_code)),
      h("p", { class: "row-sub" }, facts),
      h("p", { class: "review-body" }, r.body),
      (r.tags.length > 0 || r.other_tag) && h("div", { class: "tags" },
        r.tags.map((t) => h("span", { class: "tag" }, t)),
        r.other_tag && h("span", { class: "tag" }, r.other_tag)),
      actions));
}

// ---------- Review form (new + edit) ----------

async function renderForm(view, { professorId = null, reviewId = null, course: presetCourse = null }) {
  const [profs, catalog] = await Promise.all([
    q(supabase.from("professors").select("id, name, department").order("name")),
    loadCatalog(),
  ]);
  let existing = null;
  const tokens = load(TOKENS);

  if (reviewId) {
    existing = await q(supabase.from("reviews").select(REVIEW_COLUMNS).eq("id", reviewId).maybeSingle());
    if (!existing || !tokens[reviewId]) {
      view.replaceChildren(pageHeader("Edit review", { back: "#/rate" }),
        h("main", { class: "wrap page" }, h("p", {}, "You can only edit reviews posted from this device.")));
      return;
    }
    professorId = existing.professor_id;
  }

  const NEW = "new";
  const profSelect = h("select", { id: "prof", class: "input", required: true, disabled: Boolean(existing) },
    h("option", { value: "" }, "Choose a professor…"),
    profs.map((p) => h("option", { value: p.id }, p.department ? `${p.name} (${p.department})` : p.name)),
    h("option", { value: NEW }, "+ Add a professor who isn't listed"));
  profSelect.value = professorId ? String(professorId) : "";

  const newName = h("input", { id: "new-name", class: "input", maxlength: 100, placeholder: "e.g. Dr. Jane Smith" });
  const newDept = h("input", { id: "new-dept", class: "input", maxlength: 100, list: "depts", placeholder: "e.g. Finance" });
  const deptList = h("datalist", { id: "depts" },
    [...new Set([...profs.map((p) => p.department), ...Object.values(catalog.departments)].filter(Boolean))].sort()
      .map((d) => h("option", { value: d })));
  const newProfBox = h("div", { class: "subfields", hidden: true },
    field("Professor's name", "new-name", newName),
    field("Department", "new-dept", newDept),
    deptList);
  profSelect.addEventListener("change", () => {
    newProfBox.hidden = profSelect.value !== NEW;
    newName.required = profSelect.value === NEW;
    const code = catalog.byKey.get(compact(courseInput.value));
    if (profSelect.value === NEW && code && !newDept.value) newDept.value = catalog.departments[coursePrefix(code)] || "";
  });

  // Class box: type a code or a word, pick from matching UW courses.
  const coursePicker = makeCoursePicker(catalog, {
    id: "course", value: existing?.course_code || presetCourse, required: true,
    onPick: (code) => { if (!newDept.value) newDept.value = catalog.departments[coursePrefix(code)] || ""; },
  });
  const courseInput = coursePicker.input;

  const now = new Date();
  const [existingTerm, existingYear] = existing ? existing.semester.split(" ") : [];
  const month = now.getMonth();
  const currentTerm = month < 3 ? "Winter" : month < 6 ? "Spring" : month < 8 ? "Summer" : "Autumn";
  const selectedTerm = existingTerm || currentTerm;
  const termPicker = h("div", { class: "choice-row" },
    TERMS.map((t) => h("label", { class: "choice" },
      h("input", { type: "radio", name: "term", value: t, required: true, checked: t === selectedTerm }),
      h("span", {}, t))));
  const years = Array.from({ length: 7 }, (_, i) => String(now.getFullYear() - i));
  if (existingYear && !years.includes(existingYear)) years.push(existingYear);
  const year = h("select", { class: "input year", "aria-label": "Year", value: existingYear || years[0] }, years.map((y) => h("option", { value: y }, y)));

  const grade = h("select", { id: "grade", class: "input", value: existing?.grade || "" },
    h("option", { value: "" }, "Prefer not to say"),
    h("optgroup", { label: "Grade (4.0–0.0)" }, NUMERIC_GRADES.map(([value, label]) => h("option", { value }, label))),
    h("optgroup", { label: "Other UW grades" }, GRADE_NOTATIONS.map(([value, label]) => h("option", { value }, label))));

  const tagBoxes = TAGS.map((t) => h("input", { type: "checkbox", name: "tags", value: t, checked: existing?.tags.includes(t) }));
  const otherTag = h("input", { id: "other-tag", class: "input", maxlength: 40, placeholder: "Other (optional)", value: existing?.other_tag });

  const body = h("textarea", { id: "body", class: "input", required: true, minlength: 10, maxlength: 3000, rows: 6,
    placeholder: "Lectures, exams, workload, tips…", value: existing?.body });
  const counter = h("p", { class: "hint right" });
  const updateCounter = () => { counter.textContent = `${body.value.trim().length}/3000`; };
  body.addEventListener("input", updateCounter);
  updateCounter();

  const status = h("p", { class: "error", hidden: true });
  const submit = h("button", { class: "btn gold block big", type: "submit" }, existing ? "Save changes" : "Post review");
  const backHref = existing ? `#/prof/${professorId}` : professorId ? `#/prof/${professorId}` : "#/rate";

  const form = h("form", { class: "review-form wrap" },
    h("div", { class: "form-top" },
      h("a", { href: backHref, class: "round-btn", "aria-label": "Close" }, icon("close")),
      h("span", { class: "row-sub" }, "Anonymous")),
    h("div", { class: "form-intro" },
      h("h1", {}, existing ? "Edit your review" : "Rate a professor"),
      h("p", { class: "row-sub" }, "The good, the bad, and the ugly. All reviews and responses are anonymous. Keep it about the class and the teaching.")),
    h("div", { class: "q" },
      field("Class", "course", coursePicker.box, "Type the course code or name. UW Seattle courses only."),
      coursePicker.picked,
      field("Professor", "prof", profSelect),
      newProfBox,
      h("fieldset", { class: "field" }, h("legend", {}, "Quarter taken"), h("div", { class: "term-row" }, termPicker, year))),
    h("fieldset", { class: "q" }, h("legend", {}, "Quality"), scale("overall", OVERALL_LABELS, existing?.overall)),
    h("fieldset", { class: "q" }, h("legend", {}, "Difficulty"), scale("difficulty", DIFFICULTY_LABELS, existing?.difficulty)),
    h("div", { class: "q" },
      h("fieldset", { class: "field" }, h("legend", {}, "Would you take it again?"), yesNo("take_again", existing?.take_again)),
      h("fieldset", { class: "field" }, h("legend", {}, "Attendance mandatory?"), yesNo("attendance", existing?.attendance_mandatory)),
      field("Grade received (optional)", "grade", grade, "UW grade from 4.0 to 0.0, or another UW grade like S/NS, CR/NC, I, or W.")),
    h("div", { class: "q" },
      field("Share your unfiltered thoughts here!", "body", body,
        "Please share as much as you are willing to. This is by far the most helpful part of the review."),
      counter),
    h("fieldset", { class: "q" }, h("legend", {}, "Select all/any that apply"),
      h("div", { class: "tag-picker" }, tagBoxes.map((b) => h("label", { class: "tag-option" }, b, h("span", {}, b.value)))),
      h("label", { for: "other-tag", class: "sr-only" }, "Other"),
      otherTag),
    status,
    submit);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.hidden = true;

    const catalogCode = catalog.byKey.get(compact(courseInput.value));
    const course = catalogCode || normalizeCourse(courseInput.value);
    if (!catalogCode && catalog.list.length > 0
      && !confirm(`"${course}" isn't in the UW course catalog. Post it anyway? (Tap Cancel to fix the class code.)`)) {
      courseInput.focus();
      return;
    }
    const text = body.value.trim();
    if (text.length < 10) return showStatus("Please write a little more in your review.");

    let profId = existing ? existing.professor_id : profSelect.value;
    const reviewed = load(REVIEWED);
    const previous = reviewed[`${profId}|${course}`];
    if (!existing && previous && load(TOKENS)[previous]) {
      return showStatus(`You've already reviewed this professor for ${course} from this device. `,
        h("a", { href: `#/review/edit/${previous}` }, "Edit that review instead."));
    }

    const fields = {
      p_course: course,
      p_semester: `${form.elements.term.value} ${year.value}`,
      p_overall: Number(form.elements.overall.value),
      p_difficulty: Number(form.elements.difficulty.value),
      p_take_again: form.elements.take_again.value === "yes",
      p_attendance_mandatory: form.elements.attendance.value === "yes",
      p_grade: grade.value || null,
      p_tags: tagBoxes.filter((b) => b.checked).map((b) => b.value),
      p_other_tag: otherTag.value.trim() || null,
      p_body: text,
    };

    submit.disabled = true;
    try {
      if (existing) {
        await call("update_review", { p_id: existing.id, p_token: load(TOKENS)[existing.id], ...fields });
        for (const key of Object.keys(reviewed)) if (reviewed[key] === existing.id) delete reviewed[key];
        reviewed[`${profId}|${course}`] = existing.id;
        save(REVIEWED, reviewed);
      } else {
        if (profId === NEW) profId = await call("add_professor", { p_name: newName.value, p_department: newDept.value });
        const token = crypto.randomUUID() + crypto.randomUUID();
        const id = await call("submit_review", { p_professor_id: Number(profId), ...fields, p_token: token });
        save(TOKENS, { ...load(TOKENS), [id]: token });
        save(REVIEWED, { ...load(REVIEWED), [`${profId}|${course}`]: id });
      }
      location.hash = `#/prof/${profId}`;
    } catch (err) {
      showStatus("Couldn't save: ", err.message);
      submit.disabled = false;
    }
  });

  function showStatus(...content) {
    status.replaceChildren(...content);
    status.hidden = false;
    status.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  view.replaceChildren(form);
}

function yesNo(name, current) {
  return h("div", { class: "yes-no" },
    ["yes", "no"].map((v) => h("label", { class: "choice wide" },
      h("input", { type: "radio", name, value: v, required: true, checked: current != null && current === (v === "yes") }),
      h("span", {}, v === "yes" ? "Yes" : "No"))));
}

function scale(name, labels, current) {
  const picked = h("span", { class: "scale-picked" }, current ? labels[current] : "");
  return h("div", {},
    h("div", { class: "dots" },
      [1, 2, 3, 4, 5].map((n) => h("label", { class: "dot" },
        h("input", { type: "radio", name, value: n, required: true, checked: current === n, onchange: () => { picked.textContent = labels[n]; } }),
        h("span", {}, n)))),
    h("div", { class: "scale-labels" }, h("span", {}, labels[1]), picked, h("span", {}, labels[5])));
}

// ---------- Admin ----------

async function renderAdmin(view) {
  if (!isAdmin()) {
    view.replaceChildren(pageHeader("Admin", { back: "#/" }), h("main", { class: "wrap page" }, h("p", {}, "Admins only.")));
    return;
  }
  const [flagged, profs, current] = await Promise.all([
    call("admin_flagged_reviews"),
    q(supabase.from("professor_stats").select("id, name, department, review_count").order("name")),
    loadCurrentQuarter(),
  ]);
  const [schedules, quarters, roster] = await Promise.all([
    loadQuarter(current), loadQuarterList(current), call("admin_list_members"),
  ]);

  const flaggedList = flagged.length
    ? flagged.map((r) => h("article", { class: "panel" },
      h("p", { class: "row-sub" },
        h("a", { href: `#/prof/${r.professor_id}` }, h("strong", {}, r.professor_name)),
        ` · ${r.course_code} · ${r.semester} · ${r.overall}/5`),
      h("p", { class: "review-body" }, r.body),
      h("p", { class: "row-sub" }, "Reason given: ", r.flag_reason || "none"),
      h("div", { class: "review-actions" },
        h("button", { type: "button", class: "btn purple small", onclick: async () => { if (await act("admin_keep_review", { p_id: r.id })) render(); } }, "Keep"),
        h("button", {
          type: "button", class: "btn danger small",
          onclick: async () => { if (confirm("Delete this review?") && await act("delete_review", { p_id: r.id, p_token: null })) render(); },
        }, "Delete"))))
    : [h("p", { class: "muted" }, "Nothing reported.")];

  const profRows = profs.map((p) => h("div", { class: "admin-row" },
    h("div", {}, h("strong", {}, p.name), h("div", { class: "row-sub" }, [p.department, plural(p.review_count, "review")].filter(Boolean).join(" · "))),
    h("div", { class: "review-actions" },
      h("button", {
        type: "button", class: "link",
        onclick: async () => {
          const name = prompt("Professor's name", p.name);
          if (name === null) return;
          const dept = prompt("Department", p.department);
          if (dept === null) return;
          if (await act("admin_update_professor", { p_id: p.id, p_name: name, p_department: dept })) render();
        },
      }, "Edit"),
      h("button", {
        type: "button", class: "link danger-text",
        onclick: async () => {
          if (!confirm(`Delete ${p.name} and all ${plural(p.review_count, "review")}? This can't be undone.`)) return;
          if (await act("admin_delete_professor", { p_id: p.id })) render();
        },
      }, "Delete"))));

  view.replaceChildren(
    pageHeader("Admin", { back: "#/", subtitle: access?.via === "google" ? `Signed in as ${access.email}` : "Signed in with the admin password." }),
    h("main", { class: "wrap page" },
      rosterAdmin(roster),
      wbtAdmin(current, schedules, quarters),
      h("section", {}, h("div", { class: "section-head" }, h("h2", {}, `Reported reviews (${flagged.length})`)), flaggedList),
      h("section", {}, h("div", { class: "section-head" }, h("h2", {}, `Professors (${profs.length})`)),
        profRows.length ? h("div", { class: "panel" }, profRows) : h("p", { class: "muted" }, "No professors yet.")),
      h("section", {}, h("div", { class: "section-head" }, h("h2", {}, "Change passwords")),
        passwordForm("member", "Chapter password",
          "The password brothers use. Everyone gets signed out within the hour and needs the new one."),
        passwordForm("admin", "Admin password", "The password officers use for this Admin page.")),
      h("p", { class: "signout-line" }, h("button", { type: "button", class: "link muted", onclick: signOut }, "Sign out of this device"))));
}

// Who can sign in: paste emails, manage admins, turn off the shared chapter password.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function rosterAdmin(roster) {
  const chapterOn = access?.chapter_password_on !== false;
  const signedInCount = roster.filter((m) => m.last_sign_in).length;

  // Paste box: pulls every email out of whatever is pasted (a column from a sheet, a list, etc.)
  const paste = h("textarea", { id: "roster-paste", class: "input", rows: 5, placeholder: "Paste emails here: one per line, or copied straight from a spreadsheet." });
  const found = h("p", { class: "hint" });
  const addBtn = h("button", { type: "submit", class: "btn purple small", disabled: true }, "Add to roster");
  const parse = () => [...new Set((paste.value.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
  paste.addEventListener("input", () => {
    const emails = parse();
    const notUw = emails.filter((e) => !e.endsWith("@uw.edu"));
    const already = emails.filter((e) => roster.some((m) => m.email === e));
    found.textContent = emails.length
      ? [`${plural(emails.length, "email")} found`, already.length && `${already.length} already on the roster`,
        notUw.length && `${notUw.length} not @uw.edu (they can only sign in if it's a Google account)`].filter(Boolean).join(" · ")
      : "";
    addBtn.disabled = emails.length === 0;
  });
  const addForm = h("form", { class: "panel" },
    h("h3", {}, "Add brothers"),
    h("p", { class: "row-sub" }, "Brothers sign in with their UW Google account. Only emails on this roster can get in."),
    h("label", { for: "roster-paste", class: "sr-only" }, "Emails to add"),
    paste, found, addBtn);
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const n = await call("admin_add_members", { p_emails: parse() });
      alert(n ? `Added ${plural(n, "brother")} to the roster.` : "Everyone you pasted is already on the roster.");
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  // Roster list with search
  const search = h("input", { type: "search", class: "input", placeholder: "Search the roster", "aria-label": "Search the roster" });
  const list = h("div", {});
  function update() {
    const term = search.value.trim().toLowerCase();
    const rows = roster.filter((m) => m.email.includes(term));
    list.replaceChildren(...(rows.length ? rows.map((m) => h("div", { class: "admin-row" },
      h("div", { class: "grow" },
        h("strong", { class: "break" }, m.email), m.is_admin && h("span", { class: "admin-badge" }, "Admin"),
        h("div", { class: "row-sub" }, m.last_sign_in ? `Last signed in ${formatDate(m.last_sign_in)}` : "Hasn't signed in yet")),
      h("div", { class: "review-actions" },
        h("button", {
          type: "button", class: "link",
          onclick: async () => {
            if (m.is_admin && m.email === access?.email && !confirm("Remove your own admin access?")) return;
            if (await act("admin_set_member_admin", { p_email: m.email, p_is_admin: !m.is_admin })) render();
          },
        }, m.is_admin ? "Remove admin" : "Make admin"),
        h("button", {
          type: "button", class: "link danger-text",
          onclick: async () => {
            const self = m.email === access?.email;
            if (!confirm(self ? "Remove YOURSELF from the roster? You'll lose access right away." : `Remove ${m.email} from the roster? They won't be able to sign in.`)) return;
            if (await act("admin_remove_member", { p_email: m.email })) render();
          },
        }, "Remove"))))
      : [h("p", { class: "row-sub" }, roster.length ? "No matches." : "No one on the roster yet.")]));
  }
  search.addEventListener("input", update);
  update();

  const hasGoogleAdmin = roster.some((m) => m.is_admin && m.last_sign_in);
  const chapter = h("div", { class: "panel" },
    h("h3", {}, `Chapter password: ${chapterOn ? "on" : "off"}`),
    h("p", { class: "row-sub" }, chapterOn
      ? "Brothers can still sign in with the shared chapter password. Turn it off once everyone is on the roster, so only roster members get in."
      : "Only brothers on the roster can sign in (with UW Google). The admin password still works as a backup."),
    !hasGoogleAdmin && chapterOn && h("p", { class: "notice" }, "Before turning it off, make yourself an admin on the roster and sign in once with Google, so you're not relying on the shared passwords."),
    h("button", {
      type: "button", class: `btn small ${chapterOn ? "danger" : "purple"}`,
      onclick: async () => {
        const msg = chapterOn
          ? "Turn OFF the chapter password? Anyone not on the roster will be signed out of access right away."
          : "Turn the chapter password back ON? Anyone with it will be able to get in.";
        if (!confirm(msg)) return;
        if (await act("admin_set_chapter_password", { p_allowed: !chapterOn })) {
          access = await loadAccess();
          render();
        }
      },
    }, chapterOn ? "Turn off chapter password" : "Turn chapter password back on"));

  return h("section", {},
    h("div", { class: "section-head" }, h("h2", {}, "Sign-in & roster")),
    addForm,
    h("div", { class: "panel" },
      h("h3", {}, `Roster (${roster.length})`),
      h("p", { class: "row-sub" }, `${signedInCount} of ${roster.length} have signed in with Google.`),
      roster.length > 6 && search,
      list),
    chapter);
}

// What'sBroTaking tools: current quarter, fix schedules, clear old quarters.
function wbtAdmin(current, schedules, quarters) {
  const [curTerm, curYear] = current.split(" ");
  const thisYear = new Date().getFullYear();
  const term = h("select", { class: "input", "aria-label": "Quarter", value: curTerm }, TERMS.map((t) => h("option", { value: t }, t)));
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, Number(curYear)])].sort();
  const year = h("select", { class: "input", "aria-label": "Year", value: curYear }, years.map((y) => h("option", { value: String(y) }, y)));
  const setQuarter = h("form", { class: "panel" },
    h("h3", {}, "Current quarter"),
    h("p", { class: "row-sub" }, "What'sBroTaking shows and collects this quarter by default. Set it to the upcoming quarter once registration opens."),
    h("div", { class: "inline-fields" }, term, year, h("button", { type: "submit", class: "btn purple small" }, "Save")));
  setQuarter.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await act("admin_set_current_quarter", { p_quarter: `${term.value} ${year.value}` })) render();
  });

  const rows = schedules.map((s) => h("div", { class: "admin-row" },
    h("div", {}, h("strong", {}, s.full_name), h("div", { class: "row-sub" }, classesWord(s.classes.length))),
    h("div", { class: "review-actions" },
      h("button", {
        type: "button", class: "link danger-text",
        onclick: async () => {
          if (confirm(`Delete ${s.full_name}'s ${current} classes?`) && await act("admin_delete_schedule", { p_id: s.id })) render();
        },
      }, "Delete classes"))));

  const old = quarters.filter((qtr) => qtr !== current);
  const clearSelect = h("select", { class: "input", "aria-label": "Quarter to clear" }, old.map((qtr) => h("option", { value: qtr }, qtr)));
  const clear = h("form", { class: "panel" },
    h("h3", {}, "Clear an old quarter"),
    h("p", { class: "row-sub" }, "Deletes every schedule for that quarter. This can't be undone."),
    h("div", { class: "inline-fields" }, clearSelect, h("button", { type: "submit", class: "btn danger small" }, "Clear")));
  clear.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm(`Delete ALL What'sBroTaking schedules for ${clearSelect.value}?`)) return;
    try {
      const n = await call("admin_clear_quarter", { p_quarter: clearSelect.value });
      alert(`Deleted ${plural(n, "schedule")}.`);
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  return h("section", {},
    h("div", { class: "section-head" }, h("h2", {}, "What'sBroTaking")),
    setQuarter,
    h("div", { class: "panel" },
      h("h3", {}, `${current} schedules (${schedules.length})`),
      rows.length ? rows : h("p", { class: "row-sub" }, "No one has added classes yet.")),
    old.length > 0 && clear);
}

function passwordForm(which, title, description) {
  const id = `pw-${which}`;
  const input = h("input", { type: "password", id, class: "input", autocomplete: "new-password", minlength: 8, required: true });
  const repeat = h("input", { type: "password", id: `${id}-2`, class: "input", autocomplete: "new-password", minlength: 8, required: true });
  const msg = h("p", { class: "hint", hidden: true });
  const btn = h("button", { class: "btn purple small", type: "submit" }, `Change ${title.toLowerCase()}`);

  const form = h("form", { class: "panel" },
    h("h3", {}, title),
    h("p", { class: "row-sub" }, description),
    field("New password (at least 8 characters)", id, input),
    field("Type it again", `${id}-2`, repeat),
    msg,
    btn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.hidden = true;
    msg.className = "error";
    if (input.value !== repeat.value) {
      msg.textContent = "The two passwords don't match.";
      msg.hidden = false;
      return;
    }
    if (!confirm(`Change the ${title.toLowerCase()}?`)) return;
    btn.disabled = true;
    try {
      await call("admin_set_password", { p_which: which, p_new_password: input.value });
      form.reset();
      msg.className = "hint";
      msg.textContent = `${title} changed. Share the new one with the people who need it.`;
    } catch (err) {
      msg.textContent = "Couldn't change it: " + err.message;
    }
    msg.hidden = false;
    btn.disabled = false;
  });
  return form;
}

// ---------- Start ----------

if (supabase) {
  session = (await supabase.auth.getSession()).data.session;
  // Coming back from Google: supabase-js has used the ?code=…; drop it from the address bar.
  if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + location.hash);
  if (session) access = await loadAccess();
  supabase.auth.onAuthStateChange((_event, next) => {
    const changed = next?.user?.id !== session?.user?.id;
    session = next;
    // Deferred: calling Supabase inside this callback can deadlock.
    if (changed) {
      setTimeout(async () => {
        access = session ? await loadAccess() : null;
        render();
      }, 0);
    }
  });
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
render();
