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
// Must match reviews_grade_check in supabase/schema.sql. [stored value, label]
const GRADES = [
  ["A+", "A+"], ["A", "A"], ["A-", "A-"], ["B+", "B+"], ["B", "B"], ["B-", "B-"],
  ["C+", "C+"], ["C", "C"], ["C-", "C-"], ["D+", "D+"], ["D", "D"], ["D-", "D-"], ["F", "F"],
  ["S", "S (satisfactory)"], ["NS", "NS (not satisfactory)"], ["Dropped", "Dropped the class"],
];
const TERMS = ["Fall", "Winter", "Spring", "Summer"];
const OVERALL_LABELS = ["", "Awful", "Poor", "OK", "Good", "Awesome"];
const DIFFICULTY_LABELS = ["", "Very easy", "Easy", "Average", "Hard", "Very hard"];
const REVIEW_COLUMNS = "id, professor_id, course_code, semester, overall, difficulty, take_again, "
  + "attendance_mandatory, grade, tags, other_tag, body, created_at, updated_at";

// localStorage keys: which reviews this browser posted (needed to edit/delete them)
const TOKENS = "dsp-review-tokens"; // reviewId -> secret edit token
const REVIEWED = "dsp-reviewed"; // "professorId|COURSE" -> reviewId

const app = document.getElementById("app");
const configured = Boolean(CONFIG.SUPABASE_URL) && !CONFIG.SUPABASE_URL.startsWith("PASTE");
const supabase = configured ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
let session = null;
const browseState = { query: "", sort: "rating" };

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

function isAdmin() {
  return session?.user?.email === CONFIG.ADMIN_EMAIL;
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

function field(label, id, input, hint) {
  return h("div", { class: "field" }, h("label", { for: id }, label), input, hint && h("p", { class: "hint" }, hint));
}

function ratingBadge(value, size = "") {
  return h("div", { class: `badge ${ratingClass(value)} ${size}` }, fmt(value));
}

// ---------- Routing ----------

async function render() {
  if (!configured) return renderSetup();
  if (!session) return renderLogin();

  const [path, queryString] = location.hash.slice(1).split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const params = new URLSearchParams(queryString || "");
  const view = h("main", { class: "wrap view" }, h("p", { class: "muted" }, "Loading…"));
  app.replaceChildren(header(), view);

  try {
    if (parts[0] === "prof" && parts[1]) await renderProfessor(view, Number(parts[1]));
    else if (parts[0] === "review" && parts[1] === "new") await renderForm(view, { professorId: Number(params.get("prof")) || null });
    else if (parts[0] === "review" && parts[1] === "edit") await renderForm(view, { reviewId: Number(parts[2]) });
    else if (parts[0] === "admin") await renderAdmin(view);
    else await renderBrowse(view);
  } catch (err) {
    view.replaceChildren(h("p", { class: "error" }, "Something went wrong: ", err.message || String(err)));
  }
}

function header() {
  return h("header", { class: "topbar" },
    h("div", { class: "wrap topbar-inner" },
      h("a", { href: "#/", class: "brand" }, "RateMyBrofessor"),
      h("nav", {},
        isAdmin() && h("a", { href: "#/admin" }, "Admin"),
        h("button", { class: "link", type: "button", onclick: () => supabase.auth.signOut({ scope: "local" }) }, "Sign out"),
        h("a", { href: "#/review/new", class: "btn btn-small" }, "Write a review"))));
}

// ---------- Setup & login ----------

function renderSetup() {
  app.replaceChildren(h("main", { class: "wrap center" },
    h("div", { class: "card login" },
      h("h1", {}, "Almost there"),
      h("p", {}, "Add your Supabase Project URL and anon key to config.js, then push the change."))));
}

function renderLogin() {
  const input = h("input", { type: "password", id: "password", autocomplete: "current-password", required: true });
  const msg = h("p", { class: "error", hidden: true });
  const btn = h("button", { class: "btn", type: "submit" }, "Sign in");

  const form = h("form", { class: "card login" },
    h("h1", {}, "RateMyBrofessor"),
    h("p", { class: "muted" }, "Delta Sigma Pi professor reviews, for brothers only. Enter the chapter password."),
    field("Password", "password", input),
    msg,
    btn);

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

  app.replaceChildren(h("main", { class: "wrap center" }, form));
  input.focus();
}

// ---------- Browse ----------

async function renderBrowse(view) {
  const profs = await q(supabase.from("professor_stats").select("*"));

  const search = h("input", {
    type: "search", placeholder: "Search professor, department, or course", "aria-label": "Search",
    value: browseState.query,
  });
  const sort = h("select", { "aria-label": "Sort by", value: browseState.sort },
    h("option", { value: "rating" }, "Highest rated"),
    h("option", { value: "reviews" }, "Most reviewed"),
    h("option", { value: "name" }, "Name A–Z"));
  const list = h("div", { class: "list" });

  const sorters = {
    rating: (a, b) => (b.avg_overall ?? -1) - (a.avg_overall ?? -1) || b.review_count - a.review_count,
    reviews: (a, b) => b.review_count - a.review_count || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };

  function update() {
    browseState.query = search.value;
    browseState.sort = sort.value;
    const term = search.value.trim().toLowerCase();
    const course = normalizeCourse(search.value).toLowerCase();
    const rows = profs
      .filter((p) => !term
        || `${p.name} ${p.department}`.toLowerCase().includes(term)
        || p.courses.some((c) => c.toLowerCase().includes(course)))
      .sort(sorters[sort.value]);

    const empty = profs.length ? "No professors match your search." : "No reviews yet. Be the first to write one!";
    list.replaceChildren(...(rows.length ? rows.map(profCard) : [h("p", { class: "muted empty" }, empty)]));
  }

  search.addEventListener("input", update);
  sort.addEventListener("change", update);
  view.replaceChildren(
    h("h1", { class: "page-title" }, "Professors"),
    h("div", { class: "toolbar" }, search, sort),
    list);
  update();
}

function profCard(p) {
  const stats = p.review_count
    ? `${plural(p.review_count, "review")} · Difficulty ${fmt(p.avg_difficulty)} · ${p.pct_take_again}% would take again`
    : "No reviews yet";
  return h("a", { href: `#/prof/${p.id}`, class: "card prof-card" },
    ratingBadge(p.avg_overall),
    h("div", { class: "prof-info" },
      h("h3", {}, p.name),
      p.department && h("p", { class: "muted" }, p.department),
      h("p", { class: "stats" }, stats)));
}

// ---------- Professor page ----------

async function renderProfessor(view, id) {
  const [prof, reviews] = await Promise.all([
    q(supabase.from("professor_stats").select("*").eq("id", id).maybeSingle()),
    q(supabase.from("reviews").select(REVIEW_COLUMNS).eq("professor_id", id).order("created_at", { ascending: false })),
  ]);
  if (!prof) {
    view.replaceChildren(h("p", {}, "Professor not found."), h("a", { href: "#/" }, "← All professors"));
    return;
  }

  const tagCounts = {};
  for (const r of reviews) for (const t of r.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const courses = ["All courses", ...new Set(reviews.map((r) => r.course_code).sort())];
  let course = courses[0];
  const filters = h("div", { class: "chips", role: "group", "aria-label": "Filter by course" });
  const list = h("div", { class: "reviews" });

  function update() {
    filters.replaceChildren(...courses.map((c) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(c === course), onclick: () => { course = c; update(); } }, c)));
    const shown = reviews.filter((r) => course === courses[0] || r.course_code === course);
    list.replaceChildren(...(shown.length
      ? shown.map((r) => reviewCard(r))
      : [h("p", { class: "muted empty" }, "No reviews yet. Be the first!")]));
  }

  view.replaceChildren(
    h("a", { href: "#/", class: "back" }, "← All professors"),
    h("section", { class: "prof-header" },
      ratingBadge(prof.avg_overall, "big"),
      h("div", {},
        h("h1", {}, prof.name),
        prof.department && h("p", { class: "muted" }, prof.department),
        h("p", { class: "muted small" }, `Overall quality from ${plural(prof.review_count, "review")}`))),
    h("div", { class: "stat-row" },
      stat("Difficulty", fmt(prof.avg_difficulty)),
      stat("Would take again", prof.review_count ? `${prof.pct_take_again}%` : "–"),
      stat("Say attendance is mandatory", prof.pct_attendance_mandatory == null ? "–" : `${prof.pct_attendance_mandatory}%`),
      stat("Reviews", prof.review_count)),
    topTags.length > 0 && h("div", { class: "tags" }, topTags.map(([t, n]) => h("span", { class: "tag" }, `${t} · ${n}`))),
    h("a", { href: `#/review/new?prof=${id}`, class: "btn btn-block" }, "Rate this professor"),
    courses.length > 2 && filters,
    list);
  update();
}

function gradeLabel(value) {
  return GRADES.find(([v]) => v === value)?.[1] || value;
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("strong", {}, value), h("span", {}, label));
}

function reviewCard(r) {
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

  return h("article", { class: "card review" },
    h("div", { class: "review-top" },
      h("div", { class: "scores" },
        h("span", { class: `score ${ratingClass(r.overall)}` }, h("b", {}, r.overall), " quality"),
        h("span", { class: "score neutral" }, h("b", {}, r.difficulty), " difficulty")),
      h("span", { class: "muted small" }, formatDate(r.created_at), edited && " (edited)")),
    h("p", { class: "review-meta" },
      h("strong", {}, r.course_code), ` · ${r.semester}`,
      r.grade && ` · Grade: ${gradeLabel(r.grade)}`),
    h("p", { class: "review-facts" },
      r.take_again ? "Would take again" : "Would not take again",
      r.attendance_mandatory != null && ` · Attendance ${r.attendance_mandatory ? "mandatory" : "not mandatory"}`),
    (r.tags.length > 0 || r.other_tag) && h("div", { class: "tags" },
      r.tags.map((t) => h("span", { class: "tag" }, t)),
      r.other_tag && h("span", { class: "tag" }, r.other_tag)),
    h("p", { class: "review-body" }, r.body),
    actions);
}

// ---------- Review form (new + edit) ----------

async function renderForm(view, { professorId = null, reviewId = null }) {
  const profs = await q(supabase.from("professors").select("id, name, department").order("name"));
  let existing = null;
  const tokens = load(TOKENS);

  if (reviewId) {
    existing = await q(supabase.from("reviews").select(REVIEW_COLUMNS).eq("id", reviewId).maybeSingle());
    if (!existing || !tokens[reviewId]) {
      view.replaceChildren(h("p", {}, "You can only edit reviews posted from this device."), h("a", { href: "#/" }, "← All professors"));
      return;
    }
    professorId = existing.professor_id;
  }

  const NEW = "new";
  const profSelect = h("select", { id: "prof", required: true, disabled: Boolean(existing) },
    h("option", { value: "" }, "Choose a professor…"),
    profs.map((p) => h("option", { value: p.id }, p.department ? `${p.name} (${p.department})` : p.name)),
    h("option", { value: NEW }, "+ Add a professor who isn't listed"));
  profSelect.value = professorId ? String(professorId) : "";

  const newName = h("input", { id: "new-name", maxlength: 100, placeholder: "e.g. Dr. Jane Smith" });
  const newDept = h("input", { id: "new-dept", maxlength: 100, list: "depts", placeholder: "e.g. Finance" });
  const deptList = h("datalist", { id: "depts" },
    [...new Set(profs.map((p) => p.department).filter(Boolean))].map((d) => h("option", { value: d })));
  const newProfBox = h("div", { class: "subfields", hidden: true },
    field("Professor's name", "new-name", newName),
    field("Department", "new-dept", newDept),
    deptList);
  profSelect.addEventListener("change", () => {
    newProfBox.hidden = profSelect.value !== NEW;
    newName.required = profSelect.value === NEW;
  });

  const courseInput = h("input", {
    id: "course", required: true, maxlength: 20, placeholder: "e.g. FIN 3010", autocapitalize: "characters",
    value: existing?.course_code,
  });

  const now = new Date();
  const [existingTerm, existingYear] = existing ? existing.semester.split(" ") : [];
  const month = now.getMonth();
  const currentTerm = month < 3 ? "Winter" : month < 6 ? "Spring" : month < 8 ? "Summer" : "Fall";
  const term = h("select", { id: "term", "aria-label": "Quarter", value: existingTerm || currentTerm },
    TERMS.map((t) => h("option", { value: t }, t)));
  const years = Array.from({ length: 7 }, (_, i) => String(now.getFullYear() - i));
  if (existingYear && !years.includes(existingYear)) years.push(existingYear);
  const year = h("select", { "aria-label": "Year", value: existingYear || years[0] }, years.map((y) => h("option", { value: y }, y)));

  const grade = h("select", { id: "grade", value: existing?.grade || "" },
    h("option", { value: "" }, "Prefer not to say"),
    GRADES.map(([value, label]) => h("option", { value }, label)));

  const tagBoxes = TAGS.map((t) => h("input", { type: "checkbox", name: "tags", value: t, checked: existing?.tags.includes(t) }));
  const otherTag = h("input", { id: "other-tag", maxlength: 40, placeholder: "Something else? (optional)", value: existing?.other_tag });

  const body = h("textarea", { id: "body", required: true, minlength: 10, maxlength: 3000, rows: 7, value: existing?.body });
  const counter = h("p", { class: "hint" });
  const updateCounter = () => { counter.textContent = `${body.value.trim().length}/3000 characters`; };
  body.addEventListener("input", updateCounter);
  updateCounter();

  const status = h("p", { class: "error", hidden: true });
  const submit = h("button", { class: "btn btn-block", type: "submit" }, existing ? "Save changes" : "Submit review");

  const form = h("form", { class: "review-form" },
    h("a", { href: existing ? `#/prof/${professorId}` : "#/", class: "back" }, "← Back"),
    h("h1", { class: "page-title" }, existing ? "Edit your review" : "RateMyBrofessor"),
    h("div", { class: "guidelines" },
      h("p", {}, "Share your reviews of your professors: the good, the bad, and the ugly. ",
        h("strong", {}, "All reviews and responses are anonymous.")),
      h("p", { class: "small muted" }, "Keep it about the class and the teaching. No personal attacks or private information.")),
    field("Class", "course", courseInput),
    field("Professor", "prof", profSelect),
    newProfBox,
    h("div", { class: "field" }, h("label", { for: "term" }, "Quarter taken"), h("div", { class: "row" }, term, year)),
    h("fieldset", { class: "field" }, h("legend", {}, "Quality"), scale("overall", OVERALL_LABELS, existing?.overall)),
    h("fieldset", { class: "field" }, h("legend", {}, "Difficulty"), scale("difficulty", DIFFICULTY_LABELS, existing?.difficulty)),
    h("fieldset", { class: "field" }, h("legend", {}, "Would you take it again?"), yesNo("take_again", existing?.take_again)),
    h("fieldset", { class: "field" }, h("legend", {}, "Attendance mandatory?"), yesNo("attendance", existing?.attendance_mandatory)),
    field("Grade received (optional)", "grade", grade, "Choose \"Dropped\" or S/NS if that applies."),
    field("Share your unfiltered thoughts here!", "body", body,
      "Please share as much as you are willing to. This is by far the most helpful part of the review."),
    counter,
    h("fieldset", { class: "field" }, h("legend", {}, "Select all/any that apply (optional)"),
      h("div", { class: "tag-picker" }, tagBoxes.map((b) => h("label", { class: "tag-option" }, b, h("span", {}, b.value)))),
      h("div", { class: "other-tag" }, otherTag)),
    status,
    submit);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.hidden = true;

    const course = normalizeCourse(courseInput.value);
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
      p_semester: `${term.value} ${year.value}`,
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
  return h("div", { class: "segmented two" },
    ["yes", "no"].map((v) => h("label", {},
      h("input", { type: "radio", name, value: v, required: true, checked: current != null && current === (v === "yes") }),
      h("span", {}, v === "yes" ? "Yes" : "No"))));
}

function scale(name, labels, current) {
  const label = h("p", { class: "hint scale-label" }, current ? labels[current] : `1 = ${labels[1]}, 5 = ${labels[5]}`);
  return h("div", {},
    h("div", { class: "segmented" },
      [1, 2, 3, 4, 5].map((n) => h("label", {},
        h("input", { type: "radio", name, value: n, required: true, checked: current === n, onchange: () => { label.textContent = `${n}: ${labels[n]}`; } }),
        h("span", {}, n)))),
    label);
}

// ---------- Admin ----------

async function renderAdmin(view) {
  if (!isAdmin()) {
    view.replaceChildren(h("p", {}, "Admins only."));
    return;
  }
  const [flagged, profs] = await Promise.all([
    call("admin_flagged_reviews"),
    q(supabase.from("professor_stats").select("id, name, department, review_count").order("name")),
  ]);

  const flaggedList = flagged.length
    ? flagged.map((r) => h("article", { class: "card review" },
      h("p", { class: "review-meta" },
        h("a", { href: `#/prof/${r.professor_id}` }, h("strong", {}, r.professor_name)),
        ` · ${r.course_code} · ${r.semester} · ${r.overall}/5`),
      h("p", { class: "review-body" }, r.body),
      h("p", { class: "muted small" }, "Reason given: ", r.flag_reason || "none"),
      h("div", { class: "review-actions" },
        h("button", { type: "button", class: "btn btn-small", onclick: async () => { if (await act("admin_keep_review", { p_id: r.id })) render(); } }, "Keep"),
        h("button", {
          type: "button", class: "btn btn-small danger",
          onclick: async () => { if (confirm("Delete this review?") && await act("delete_review", { p_id: r.id, p_token: null })) render(); },
        }, "Delete"))))
    : [h("p", { class: "muted" }, "Nothing reported.")];

  const profRows = profs.map((p) => h("div", { class: "admin-row" },
    h("div", {}, h("strong", {}, p.name), p.department && h("span", { class: "muted" }, ` · ${p.department}`),
      h("span", { class: "muted small" }, ` · ${plural(p.review_count, "review")}`)),
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
    h("h1", { class: "page-title" }, "Admin"),
    h("section", { class: "admin-section" }, h("h2", {}, `Reported reviews (${flagged.length})`), flaggedList),
    h("section", { class: "admin-section" }, h("h2", {}, `Professors (${profs.length})`),
      profRows.length ? h("div", { class: "card" }, profRows) : h("p", { class: "muted" }, "No professors yet.")),
    h("section", { class: "admin-section" }, h("h2", {}, "Change passwords"),
      passwordForm("member", "Chapter password",
        "The password brothers use. Everyone gets signed out within the hour and needs the new one."),
      passwordForm("admin", "Admin password", "The password officers use for this Admin page.")));
}

function passwordForm(which, title, description) {
  const id = `pw-${which}`;
  const input = h("input", { type: "password", id, autocomplete: "new-password", minlength: 8, required: true });
  const repeat = h("input", { type: "password", id: `${id}-2`, autocomplete: "new-password", minlength: 8, required: true });
  const msg = h("p", { class: "hint", hidden: true });
  const btn = h("button", { class: "btn btn-small", type: "submit" }, `Change ${title.toLowerCase()}`);

  const form = h("form", { class: "card password-form" },
    h("h3", {}, title),
    h("p", { class: "muted small" }, description),
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
  supabase.auth.onAuthStateChange((_event, next) => {
    const changed = next?.user?.id !== session?.user?.id;
    session = next;
    // Deferred: calling Supabase inside this callback can deadlock.
    if (changed) setTimeout(render, 0);
  });
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
render();
