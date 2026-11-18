// Family Tasks – shared to-do list for Scriptable (iOS)
// Same script on every phone. Tasks live in tasks.json in a PRIVATE GitHub repo.
// Each task records who added it ("by"), who it is for ("for", or "Anyone"),
// an optional due date ("due", YYYY-MM-DD) and the last nudge ("nudge").
//
// Widget (home screen): green = not due yet, orange = due today/tomorrow, red = overdue;
//   the whole widget turns red while something of yours is overdue.
// Widget (lock screen): small overdue / open count.
// Notifications on this phone:
//   new task for you · nudges · your request finished · your request went overdue
//   due tomorrow 18:00 · due today 08:00 · overdue 08/13/18h (more often from 3 days late)
//   morning summary 07:30
// Apple Reminders: your tasks are mirrored into a "Family Tasks" list;
//   completing one there ticks it off for everyone.
// First run (inside the app) asks for the GitHub token and this phone's name;
// both are kept in the iPhone Keychain, not in this code.

const OWNER = "buettnerw";
const REPO = "family-tasks";
const FILE = "tasks.json";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
const K_TOKEN = "family-tasks-token", K_NAME = "family-tasks-name";
const ANYONE = "Anyone";
const THREAD = "family-tasks";
const REMINDER_LIST = "Family Tasks";
const QUIET_FROM = 21, QUIET_TO = 7;          // no instant alerts 21:00–07:00 (they wait until 07:30)
const SUMMARY_AT = [7, 30];

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "family-tasks-cache.json");
const SEEN = fm.joinPath(fm.documentsDirectory(), "family-tasks-seen.json");
const C = {
  bg:     Color.dynamic(new Color("#fbf7f2"), new Color("#1c1915")),
  bgLate: Color.dynamic(new Color("#fbe3df"), new Color("#3a1a17")),
  ink:    Color.dynamic(new Color("#2b2620"), new Color("#f1ebe3")),
  mute:   Color.dynamic(new Color("#7a6f62"), new Color("#a89c8d")),
  acc:    Color.dynamic(new Color("#c0522b"), new Color("#f08a5d")),
  green:  Color.dynamic(new Color("#2f7d4f"), new Color("#6fcf93")),
  orange: Color.dynamic(new Color("#d9822b"), new Color("#f5a85c")),
  red:    Color.dynamic(new Color("#b03a2e"), new Color("#f08a7e")),
};

const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
const me = () => Keychain.contains(K_NAME) ? Keychain.get(K_NAME) : "";

// ---------- dates (local calendar days) ----------
const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dparse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0);
const today = () => dparse(dkey(new Date()));
const daysLeft = (t, from) => t.due ? Math.round((dparse(t.due) - dparse(dkey(from || new Date()))) / 864e5) : null;
const isLate = t => !!t.due && daysLeft(t) < 0;
function dueText(t) {
  const n = daysLeft(t);
  if (n === null) return "";
  if (n < 0) return `${-n}d late`;
  if (n === 0) return "due today";
  if (n === 1) return "tomorrow";
  if (n < 7) return dparse(t.due).toLocaleDateString("en-ZA", { weekday: "short" });
  return dparse(t.due).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}
function dueColor(t) {
  const n = daysLeft(t);
  if (n === null) return null;
  return n < 0 ? C.red : n <= 1 ? C.orange : C.green;
}
const dueEmoji = t => { const n = daysLeft(t); return n === null ? "○" : n < 0 ? "🔴" : n <= 1 ? "🟠" : "🟢"; };

// ---------- setup ----------
async function ask(title, message, placeholder, secure) {
  const a = new Alert();
  a.title = title; a.message = message;
  secure ? a.addSecureTextField(placeholder, "") : a.addTextField(placeholder, "");
  a.addAction("Save"); a.addCancelAction("Cancel");
  if (await a.presentAlert() < 0) return null;
  return a.textFieldValue(0).trim() || null;
}
async function setup() {
  if (!Keychain.contains(K_TOKEN)) {
    const t = await ask("GitHub token", "Paste the family-tasks token (starts with github_pat_).", "github_pat_…", true);
    if (!t) throw new Error("No token saved");
    Keychain.set(K_TOKEN, t);
  }
  if (!Keychain.contains(K_NAME)) {
    const n = await ask("Who uses this phone?", "Used to show tasks for you and who added them.", "e.g. Werner");
    if (!n) throw new Error("No name saved");
    Keychain.set(K_NAME, n);
  }
}

// ---------- GitHub storage ----------
function req(method, body) {
  const r = new Request(API + (method === "GET" ? "?t=" + Date.now() : ""));
  r.method = method;
  r.timeoutInterval = 20;
  r.headers = {
    "Authorization": "Bearer " + Keychain.get(K_TOKEN),
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body) { r.headers["Content-Type"] = "application/json"; r.body = JSON.stringify(body); }
  return r;
}
function normalise(list) {
  list.tasks = list.tasks || [];
  list.people = list.people || [];
  return list;
}
async function load() {
  const r = req("GET");
  const j = await r.loadJSON();
  const code = r.response.statusCode;
  if (code === 404) return { list: normalise({}), sha: null };
  if (code !== 200) throw new Error(`GitHub ${code}: ${j.message || ""}`);
  const list = normalise(JSON.parse(Data.fromBase64String(j.content.replace(/\n/g, "")).toRawString()));
  fm.writeString(CACHE, JSON.stringify(list));
  return { list, sha: j.sha };
}
// apply a change and save; retries if another phone saved in between
async function change(fn, message) {
  for (let i = 0; i < 3; i++) {
    const { list, sha } = await load();
    fn(list);
    const body = { message, content: Data.fromString(JSON.stringify(list, null, 1)).toBase64String() };
    if (sha) body.sha = sha;
    const r = req("PUT", body);
    const j = await r.loadJSON();
    const code = r.response.statusCode;
    if (code === 200 || code === 201) { fm.writeString(CACHE, JSON.stringify(list)); return list; }
    if (code !== 409 && code !== 422) throw new Error(`GitHub ${code}: ${j.message || ""}`);
  }
  throw new Error("Couldn't save, please try again");
}
function markDone(l, ids) {
  for (const id of ids) {
    const x = l.tasks.find(y => y.id === id);
    if (x && !x.done) { x.done = new Date().toISOString(); x.doneBy = me(); }
  }
  // keep only the last 30 finished tasks
  const old = l.tasks.filter(y => y.done).sort((a, b) => a.done < b.done ? 1 : -1).slice(30).map(y => y.id);
  l.tasks = l.tasks.filter(y => !old.includes(y.id));
}

// ---------- sorting tasks for this phone ----------
function byUrgency(a, b) {
  const da = daysLeft(a), db = daysLeft(b);
  if (da !== null && db !== null && da !== db) return da - db;
  if (da !== null && db === null) return -1;
  if (da === null && db !== null) return 1;
  return (a.added || "") < (b.added || "") ? -1 : 1;
}
function groups(list, name) {
  const open = list.tasks.filter(t => !t.done);
  const forMe = open.filter(t => same(t.for, name) || !t.for || same(t.for, ANYONE)).sort(byUrgency);
  const asked = open.filter(t => same(t.by, name) && t.for && !same(t.for, name) && !same(t.for, ANYONE)).sort(byUrgency);
  const others = open.filter(t => !forMe.includes(t) && !asked.includes(t)).sort(byUrgency);
  return { forMe, asked, others };
}
const fromLabel = t => t.by && !same(t.by, me()) ? `from ${t.by}` : "";
const forLabel = t => same(t.for, ANYONE) || !t.for ? "anyone" : `for ${t.for}`;

// ---------- notifications ----------
function quietAdjusted(now) {
  const h = now.getHours();
  if (h >= QUIET_FROM) return at(addDays(now, 1), ...SUMMARY_AT);
  if (h < QUIET_TO) return at(now, ...SUMMARY_AT);
  return null; // fine to deliver now
}
async function send(title, body, opts = {}) {
  const n = new Notification();
  n.title = title; n.body = body;
  n.threadIdentifier = THREAD;
  n.openURL = URLScheme.forRunningScript();
  if (opts.sound) n.sound = opts.sound;
  if (opts.id) n.identifier = opts.id;
  const when = opts.when || quietAdjusted(new Date());
  if (when) n.setTriggerDate(when);
  await n.schedule();
}

async function syncNotifications(list, usingReminders) {
  const name = me();
  const g = groups(list, name);
  const now = new Date();

  // --- 1) instant alerts, compared with what this phone saw last time ---
  const first = !fm.fileExists(SEEN);
  const seen = Object.assign({ open: [], done: [], nudge: {}, lateTold: [] },
    first ? {} : JSON.parse(fm.readString(SEEN)));
  if (!first) {
    for (const t of g.forMe) {
      if (!seen.open.includes(t.id) && !same(t.by, name))
        await send(`New task from ${t.by || "someone"}`, t.text + (t.due ? ` (${dueText(t)})` : ""));
      if (t.nudge && !same(t.nudge.by, name) && t.nudge.at > (seen.nudge[t.id] || ""))
        await send(`👋 ${t.nudge.by} is nudging you`, t.text + (t.due ? ` (${dueText(t)})` : ""), { sound: "alert" });
    }
    for (const t of list.tasks) {
      if (t.done && same(t.by, name) && !same(t.doneBy, name) && !seen.done.includes(t.id))
        await send(`${t.doneBy || "Someone"} finished a task`, "✓ " + t.text, { sound: "complete" });
    }
    for (const t of g.asked) {
      if (isLate(t) && !seen.lateTold.includes(t.id))
        await send(`⚠️ ${t.for}'s task is overdue`, `${t.text} (${dueText(t)})`, { sound: "failure" });
    }
  }
  fm.writeString(SEEN, JSON.stringify({
    open: list.tasks.filter(t => !t.done).map(t => t.id),
    done: list.tasks.filter(t => t.done).map(t => t.id),
    nudge: Object.fromEntries(list.tasks.filter(t => t.nudge).map(t => [t.id, t.nudge.at])),
    lateTold: g.asked.filter(isLate).map(t => t.id),
  }));

  // --- 2) scheduled alerts: clear this script's ones, then plan the next 36 hours ---
  const pending = await Notification.allPending();
  const old = pending.filter(n => (n.identifier || "").startsWith("ft-s-")).map(n => n.identifier);
  if (old.length) Notification.removePending(old);
  const horizon = new Date(now.getTime() + 36 * 3600e3);
  const plan = [];
  for (const t of g.forMe) {
    if (!t.due) continue;
    const due = dparse(t.due);
    plan.push([at(addDays(due, -1), 18), t, "Due tomorrow", null]);
    if (!usingReminders) plan.push([at(due, 8), t, "Due today", null]);   // Reminders alarm covers this
    // overdue: escalate – 3x a day, 6x a day from 3 days late
    for (let d = 0; d <= 1; d++) {
      const day = addDays(today(), d);
      const late = -daysLeft(t, day);
      if (late < 1) continue;
      const times = late >= 3 ? [[8], [10, 30], [13], [15, 30], [18], [20]] : [[8], [13], [18]];
      for (const [h, m] of times) plan.push([at(day, h, m), t, `🔴 Overdue ${late}d`, late >= 3 ? "failure" : "alert"]);
    }
  }
  let k = 0;
  for (const [when, t, label, sound] of plan) {
    if (when <= now || when > horizon) continue;
    await send(label + (t.by && !same(t.by, name) ? ` · from ${t.by}` : ""), t.text,
      { when, sound, id: `ft-s-${t.id}-${k++}` });
  }

  // --- 3) morning summary 07:30 ---
  let next = at(now, ...SUMMARY_AT);
  if (next <= now) next = at(addDays(now, 1), ...SUMMARY_AT);
  const on = t => daysLeft(t, next);
  const lateN = g.forMe.filter(t => t.due && on(t) < 0);
  const todayN = g.forMe.filter(t => t.due && on(t) === 0);
  const askedLate = g.asked.filter(t => t.due && on(t) < 0);
  if (lateN.length || todayN.length || askedLate.length) {
    const parts = [];
    if (lateN.length) parts.push(`🔴 ${lateN.length} overdue: ${lateN.map(t => t.text).join(", ")}`);
    if (todayN.length) parts.push(`🟠 ${todayN.length} due today: ${todayN.map(t => t.text).join(", ")}`);
    if (askedLate.length) parts.push(`↗ ${askedLate.length} you asked for ${askedLate.length > 1 ? "are" : "is"} overdue`);
    await send("Good morning – your tasks", parts.join("\n"), { when: next, id: "ft-s-summary" });
  }
}

// ---------- Apple Reminders mirror ----------
async function reminderList() {
  try { return await Calendar.forRemindersByTitle(REMINDER_LIST); }
  catch (e) { return await Calendar.createForReminders(REMINDER_LIST); }
}
async function syncReminders(list) {
  const cal = await reminderList();
  const rems = await Reminder.all([cal]);
  const mine = groups(list, me()).forMe;
  const byId = {};
  const completedThere = [];
  for (const r of rems) {
    const m = (r.notes || "").match(/\[ft:([^\]]+)\]/);
    if (!m) continue;
    const t = mine.find(x => x.id === m[1]);
    if (!t) { r.remove(); continue; }                              // done elsewhere or not mine any more
    if (r.isCompleted) { completedThere.push(t.id); continue; }   // ticked off in Reminders
    byId[t.id] = r;
  }
  for (const t of mine) {
    if (completedThere.includes(t.id)) continue;
    const fresh = !byId[t.id];
    const r = byId[t.id] || new Reminder();
    const dueAt = t.due ? at(dparse(t.due), 8) : null;
    const changed = fresh || r.title !== t.text ||
      ((r.dueDate ? r.dueDate.getTime() : 0) !== (dueAt ? dueAt.getTime() : 0));
    if (!changed) continue;
    r.title = t.text;
    r.notes = `${t.by && !same(t.by, me()) ? "From " + t.by + " " : ""}[ft:${t.id}]`;
    r.calendar = cal;
    if (dueAt) {
      r.dueDate = dueAt;
      r.dueDateIncludesTime = true;
      if (fresh) r.addAlarm(Alarm.absolute(dueAt));
    } else r.dueDate = null;
    r.save();
  }
  if (completedThere.length) {
    const names = mine.filter(t => completedThere.includes(t.id)).map(t => t.text).join(", ");
    list = await change(l => markDone(l, completedThere), `Done in Reminders: ${names} (${me()})`);
  }
  return list;
}

// ---------- in-app menu ----------
async function pickPerson(list) {
  const people = list.people.filter(p => !same(p, me()));
  const a = new Alert();
  a.title = "Who is it for?";
  const opts = [me(), ...people, ANYONE];
  a.addAction(`Me (${me()})`);
  people.forEach(p => a.addAction(p));
  a.addAction("Anyone");
  a.addAction("Someone else…");
  a.addCancelAction("Cancel");
  const i = await a.presentSheet();
  if (i < 0) return null;
  if (i < opts.length) return opts[i];
  return await ask("Who is it for?", "Type their name as they entered it on their phone.", "Name");
}
// returns "YYYY-MM-DD", "" for no due date, or null if cancelled
async function pickDue(title) {
  const a = new Alert();
  a.title = title || "When is it due?";
  const t0 = today();
  const quick = [["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["In a week", 7]];
  quick.forEach(([l]) => a.addAction(l));
  a.addAction("Pick a date…");
  a.addAction("No due date");
  a.addCancelAction("Cancel");
  const i = await a.presentSheet();
  if (i < 0) return null;
  if (i < quick.length) return dkey(addDays(t0, quick[i][1]));
  if (i === quick.length) {
    const p = new DatePicker();
    p.initialDate = addDays(t0, 1);
    p.minimumDate = t0;
    try { return dkey(await p.pickDate()); } catch (e) { return null; }
  }
  return "";
}

async function menu() {
  let { list } = await load();
  if (!list.people.some(p => same(p, me()))) {
    list = await change(l => { if (!l.people.some(p => same(p, me()))) l.people.push(me()); }, `Add person: ${me()}`);
  }
  while (true) {
    ({ list } = await load());
    const g = groups(list, me());
    const d = t => t.due ? `  · ${dueText(t)}` : "";
    const rows = [
      ...g.forMe.map(t => ({ t, label: `${dueEmoji(t)} ${t.text}${d(t)}${fromLabel(t) ? "  · " + fromLabel(t) : ""}` })),
      ...g.asked.map(t => ({ t, label: `↗ ${t.due ? dueEmoji(t) + " " : ""}${t.text}  · ${forLabel(t)}${d(t)}` })),
      ...g.others.map(t => ({ t, label: `· ${t.text}  · ${t.by || "?"} → ${forLabel(t).replace("for ", "")}${d(t)}` })),
    ];
    const a = new Alert();
    a.title = "Family tasks";
    a.message = (g.forMe.length ? `${g.forMe.length} for you. ` : "Nothing for you 🎉 ") +
      (g.asked.length ? "↗ = you asked someone else." : "") + "\nTap a task to tick it off, change its date or nudge.";
    a.addAction("➕ Add a task");
    rows.forEach(r => a.addAction(r.label));
    a.addCancelAction("Close");
    const i = await a.presentSheet();
    if (i < 0) return;
    if (i === 0) {
      const text = await ask("New task", "", "What needs doing?");
      if (!text) continue;
      const who = await pickPerson(list);
      if (!who) continue;
      const due = await pickDue();
      if (due === null) continue;
      await change(l => {
        const t = { id: Date.now().toString(36), text, by: me(), for: who, added: new Date().toISOString() };
        if (due) t.due = due;
        l.tasks.push(t);
      }, `Add: ${text} (${me()} → ${who}${due ? ", due " + due : ""})`);
      continue;
    }
    const t = rows[i - 1].t;
    const canNudge = t.for && !same(t.for, me()) && !same(t.for, ANYONE);
    const c = new Alert();
    c.title = t.text;
    c.message = [t.by ? "Added by " + t.by : "", forLabel(t), t.due ? dueText(t) : "no due date",
      t.nudge ? `last nudge ${new Date(t.nudge.at).toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""]
      .filter(Boolean).join(" · ");
    const actions = [];
    if (canNudge) { c.addAction(`👋 Nudge ${t.for}`); actions.push("nudge"); }
    c.addAction("✓ Tick off"); actions.push("done");
    c.addAction("📅 Change due date"); actions.push("due");
    c.addCancelAction("Back");
    const k = await c.presentAlert();
    if (k < 0) continue;
    if (actions[k] === "done") {
      await change(l => markDone(l, [t.id]), `Done: ${t.text} (${me()})`);
    } else if (actions[k] === "nudge") {
      await change(l => { const x = l.tasks.find(y => y.id === t.id); if (x) x.nudge = { by: me(), at: new Date().toISOString() }; },
        `Nudge: ${t.text} (${me()} → ${t.for})`);
      const ok = new Alert(); ok.title = "Nudge sent 👋";
      ok.message = `${t.for} gets a notification when their widget next refreshes (usually within 15–30 min).`;
      ok.addAction("OK"); await ok.present();
    } else if (actions[k] === "due") {
      const due = await pickDue("New due date");
      if (due === null) continue;
      await change(l => { const x = l.tasks.find(y => y.id === t.id); if (x) { if (due) x.due = due; else delete x.due; } },
        `Due date: ${t.text} → ${due || "none"} (${me()})`);
    }
  }
}

// ---------- widgets ----------
function age(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? "today" : d + "d";
}
function row(w, t, meta, size, muted, showMeta) {
  const r = w.addStack(); r.centerAlignContent();
  const col = dueColor(t);
  const dot = r.addText(col ? "● " : "○ ");
  dot.font = Font.boldSystemFont(size);
  dot.textColor = col || C.mute;
  if (muted) dot.textOpacity = 0.7;
  const tx = r.addText(t.text); tx.font = Font.mediumSystemFont(size); tx.textColor = muted ? C.mute : C.ink; tx.lineLimit = 1;
  if (showMeta) {
    r.addSpacer();
    const m = r.addText(meta); m.font = Font.systemFont(size - 3); m.lineLimit = 1;
    m.textColor = isLate(t) ? C.red : C.mute;
  }
  w.addSpacer(3);
}
function buildLockScreen(fam, g) {
  const w = new ListWidget();
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const late = g.forMe.filter(isLate);
  const open = g.forMe.length;
  if (fam === "accessoryInline") {
    w.addText(late.length ? `⚠︎ ${late.length} late · ${open} tasks` : open ? `☐ ${open} tasks` : "✓ No tasks");
  } else if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const n = w.addText(String(late.length || open)); n.font = Font.boldSystemFont(22); n.centerAlignText();
    const l = w.addText(late.length ? "LATE" : "tasks"); l.font = Font.boldSystemFont(9); l.centerAlignText();
  } else {
    const h = w.addText(late.length ? `⚠︎ ${late.length} overdue · ${open} open` : open ? `${open} open task${open > 1 ? "s" : ""}` : "✓ No tasks");
    h.font = Font.boldSystemFont(13);
    for (const t of g.forMe.slice(0, 2)) {
      const x = w.addText(`${isLate(t) ? "! " : "· "}${t.text}${t.due ? " – " + dueText(t) : ""}`);
      x.font = Font.systemFont(12); x.lineLimit = 1;
    }
  }
  return w;
}
function build(list, stale) {
  const fam = config.widgetFamily || "large";
  const g = list ? groups(list, me()) : { forMe: [], asked: [], others: [] };
  if (fam.startsWith("accessory")) return buildLockScreen(fam, g);

  const max = { small: 4, medium: 5, large: 12 }[fam] || 5;
  const size = fam === "large" ? 14 : 13;
  const showMeta = fam !== "small";
  const late = g.forMe.filter(isLate).length;
  const w = new ListWidget();
  w.backgroundColor = late ? C.bgLate : C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const title = me() ? `${me()}'s tasks` : "Tasks";
  const head = w.addStack(); head.centerAlignContent();
  const h = head.addText(late ? "⚠︎ " + title : title);
  h.font = Font.boldSystemFont(16); h.textColor = late ? C.red : C.ink;
  head.addSpacer();
  const n = head.addText(!g.forMe.length ? "all done ✓" : late ? `${late} late · ${g.forMe.length} open` : `${g.forMe.length} open`);
  n.font = Font.boldSystemFont(12); n.textColor = !g.forMe.length ? C.mute : late ? C.red : C.acc;
  w.addSpacer(6);

  const meta = t => [t.due ? dueText(t) : "", fromLabel(t), t.due ? "" : age(t.added)].filter(Boolean).join(" · ");
  let used = 0;
  for (const t of g.forMe) {
    if (used++ >= max) break;
    row(w, t, meta(t), size, false, showMeta);
  }
  if (g.forMe.length > max) { const m = w.addText(`+${g.forMe.length - max} more`); m.font = Font.systemFont(11); m.textColor = C.mute; }

  if (fam !== "small" && g.asked.length && used < max) {
    w.addSpacer(4);
    const s = w.addText("ASKED BY YOU"); s.font = Font.boldSystemFont(10); s.textColor = C.mute;
    w.addSpacer(2);
    for (const t of g.asked.slice(0, max - used)) {
      row(w, t, [forLabel(t), t.due ? dueText(t) : age(t.added)].join(" · "), size - 1, true, true);
    }
  }

  w.addSpacer();
  const f = w.addText(list ? "Tap to add, tick off or nudge" + (stale ? " · offline" : "") : "Tap to set up");
  f.font = Font.systemFont(10); f.textColor = C.mute;
  return w;
}

// ---------- main ----------
let widget;
try {
  if (config.runsInApp) { await setup(); await menu(); }
  if (!Keychain.contains(K_TOKEN) || !Keychain.contains(K_NAME)) widget = build(null, false);
  else {
    let list, stale = false;
    try { list = (await load()).list; }
    catch (e) { if (fm.fileExists(CACHE)) { list = normalise(JSON.parse(fm.readString(CACHE))); stale = true; } else throw e; }
    if (!stale) {
      let usingReminders = false;
      try { list = await syncReminders(list); usingReminders = true; } catch (e) { console.log("Reminders: " + e); }
      try { await syncNotifications(list, usingReminders); } catch (e) { console.log("Notifications: " + e); }
    }
    widget = build(list, stale);
  }
} catch (e) {
  widget = new ListWidget(); widget.backgroundColor = C.bg;
  const t = widget.addText("Tasks unavailable\n" + e.message); t.font = Font.systemFont(11); t.textColor = C.acc;
  if (config.runsInApp) { const a = new Alert(); a.title = "Problem"; a.message = e.message; a.addAction("OK"); await a.present(); }
}
if (config.runsInWidget) Script.setWidget(widget);
Script.complete();
