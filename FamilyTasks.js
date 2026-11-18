// Family Tasks – shared to-do list for Scriptable (iOS)
// Same script on every phone. Tasks live in tasks.json in a PRIVATE GitHub repo.
// Each task records who added it ("by"), who it is for ("for", or "Anyone")
// and an optional due date ("due", YYYY-MM-DD).
// Colours: green = not due yet, orange = due today/tomorrow, red = overdue.
// Notifications (on this phone): new task for you, due tomorrow (18:00),
// due today (08:00), overdue (08:00 daily), and when someone finishes a task you asked for.
// First run (inside the app) asks for the GitHub token and this phone's name;
// both are kept in the iPhone Keychain, not in this code.

const OWNER = "buettnerw";
const REPO = "family-tasks";
const FILE = "tasks.json";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
const K_TOKEN = "family-tasks-token", K_NAME = "family-tasks-name";
const ANYONE = "Anyone";
const THREAD = "family-tasks";

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "family-tasks-cache.json");
const SEEN = fm.joinPath(fm.documentsDirectory(), "family-tasks-seen.json");
const C = {
  bg:     Color.dynamic(new Color("#fbf7f2"), new Color("#1c1915")),
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
const today = () => dparse(dkey(new Date()));
const daysLeft = t => t.due ? Math.round((dparse(t.due) - today()) / 864e5) : null;
function dueText(t) {
  const n = daysLeft(t);
  if (n === null) return "";
  if (n < 0) return n === -1 ? "1d late" : `${-n}d late`;
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
async function notifyNow(title, body) {
  const n = new Notification();
  n.title = title; n.body = body;
  n.threadIdentifier = THREAD;
  n.openURL = URLScheme.forRunningScript();
  await n.schedule();
}
async function syncNotifications(list) {
  const name = me();
  const g = groups(list, name);

  // 1) new tasks for me, and finished tasks I asked for (compared with what this phone saw last time)
  const first = !fm.fileExists(SEEN);
  const seen = first ? { open: [], done: [] } : JSON.parse(fm.readString(SEEN));
  if (!first) {
    for (const t of g.forMe) {
      if (!seen.open.includes(t.id) && !same(t.by, name)) {
        await notifyNow(`New task from ${t.by || "someone"}`, t.text + (t.due ? ` (${dueText(t)})` : ""));
      }
    }
    for (const t of list.tasks) {
      if (t.done && same(t.by, name) && !same(t.doneBy, name) && !seen.done.includes(t.id)) {
        await notifyNow(`${t.doneBy || "Someone"} finished a task`, "✓ " + t.text);
      }
    }
  }
  fm.writeString(SEEN, JSON.stringify({
    open: list.tasks.filter(t => !t.done).map(t => t.id),
    done: list.tasks.filter(t => t.done).map(t => t.id),
  }));

  // 2) due-date reminders: clear this script's scheduled ones, then schedule fresh ones
  const pending = await Notification.allPending();
  const old = pending.filter(n => (n.identifier || "").startsWith("ft-due-")).map(n => n.identifier);
  if (old.length) Notification.removePending(old);
  const now = new Date();
  for (const t of g.forMe) {
    if (!t.due) continue;
    const due = dparse(t.due);
    const plan = [
      [new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 18, 0), "Due tomorrow"],
      [new Date(due.getFullYear(), due.getMonth(), due.getDate(), 8, 0), "Due today"],
    ];
    if (daysLeft(t) < 0) {
      // overdue: remind at the next 08:00
      let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0);
      if (next <= now) next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0);
      plan.push([next, "Overdue"]);
    }
    for (const [when, label] of plan) {
      if (when <= now) continue;
      const n = new Notification();
      n.identifier = `ft-due-${t.id}-${label.replace(/\s/g, "")}`;
      n.threadIdentifier = THREAD;
      n.title = label + (t.by && !same(t.by, name) ? ` · from ${t.by}` : "");
      n.body = t.text;
      n.openURL = URLScheme.forRunningScript();
      n.setTriggerDate(when);
      await n.schedule();
    }
  }
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
  // make sure this phone's person is in the shared list of people
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
      ...g.asked.map(t => ({ t, label: `↗ ${t.text}  · ${forLabel(t)}${d(t)}` })),
      ...g.others.map(t => ({ t, label: `· ${t.text}  · ${t.by || "?"} → ${forLabel(t).replace("for ", "")}${d(t)}` })),
    ];
    const a = new Alert();
    a.title = "Family tasks";
    a.message = (g.forMe.length ? `${g.forMe.length} for you. ` : "Nothing for you 🎉 ") +
      (g.asked.length ? "↗ = you asked someone else." : "") + "\nTap a task to tick it off or change its date.";
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
    } else {
      const t = rows[i - 1].t;
      const c = new Alert();
      c.title = t.text;
      c.message = [t.by ? "Added by " + t.by : "", forLabel(t), t.due ? dueText(t) : "no due date"].filter(Boolean).join(" · ");
      c.addAction("✓ Tick off");
      c.addAction("📅 Change due date");
      c.addCancelAction("Back");
      const k = await c.presentAlert();
      if (k === 0) {
        await change(l => {
          const x = l.tasks.find(y => y.id === t.id);
          if (x) { x.done = new Date().toISOString(); x.doneBy = me(); }
          // keep only the last 30 finished tasks
          const old = l.tasks.filter(y => y.done).sort((a, b) => a.done < b.done ? 1 : -1).slice(30).map(y => y.id);
          l.tasks = l.tasks.filter(y => !old.includes(y.id));
        }, `Done: ${t.text} (${me()})`);
      } else if (k === 1) {
        const due = await pickDue("New due date");
        if (due === null) continue;
        await change(l => {
          const x = l.tasks.find(y => y.id === t.id);
          if (x) { if (due) x.due = due; else delete x.due; }
        }, `Due date: ${t.text} → ${due || "none"} (${me()})`);
      }
    }
  }
}

// ---------- widget ----------
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
    m.textColor = col && daysLeft(t) < 0 ? C.red : C.mute;
  }
  w.addSpacer(3);
}
function build(list, stale) {
  const fam = config.widgetFamily || "large";
  const max = { small: 4, medium: 5, large: 12 }[fam] || 5;
  const size = fam === "large" ? 14 : 13;
  const showMeta = fam !== "small";
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const g = list ? groups(list, me()) : { forMe: [], asked: [] };
  const late = g.forMe.filter(t => daysLeft(t) !== null && daysLeft(t) < 0).length;
  const head = w.addStack(); head.centerAlignContent();
  const h = head.addText(me() ? `${me()}'s tasks` : "Tasks"); h.font = Font.boldSystemFont(16); h.textColor = C.ink;
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
  const f = w.addText(list ? "Tap to add or tick off" + (stale ? " · offline" : "") : "Tap to set up");
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
    if (!stale) { try { await syncNotifications(list); } catch (e) { console.log("Notifications: " + e); } }
    widget = build(list, stale);
  }
} catch (e) {
  widget = new ListWidget(); widget.backgroundColor = C.bg;
  const t = widget.addText("Tasks unavailable\n" + e.message); t.font = Font.systemFont(11); t.textColor = C.acc;
  if (config.runsInApp) { const a = new Alert(); a.title = "Problem"; a.message = e.message; a.addAction("OK"); await a.present(); }
}
if (config.runsInWidget) Script.setWidget(widget);
Script.complete();
