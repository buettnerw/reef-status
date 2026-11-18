// Family Tasks – shared to-do list for Scriptable (iOS)
// Same script on every phone. Tasks live in tasks.json in a PRIVATE GitHub repo.
// Each task records who added it ("by") and who it is for ("for", or "Anyone").
// Widget: tasks for you, then tasks you asked others to do (still open).
// Tap the widget to add a task (and pick who it's for) or tick one off.
// First run (inside the app) asks for the GitHub token and this phone's name;
// both are kept in the iPhone Keychain, not in this code.

const OWNER = "buettnerw";
const REPO = "family-tasks";
const FILE = "tasks.json";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
const K_TOKEN = "family-tasks-token", K_NAME = "family-tasks-name";
const ANYONE = "Anyone";

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "family-tasks-cache.json");
const C = {
  bg:   Color.dynamic(new Color("#fbf7f2"), new Color("#1c1915")),
  ink:  Color.dynamic(new Color("#2b2620"), new Color("#f1ebe3")),
  mute: Color.dynamic(new Color("#7a6f62"), new Color("#a89c8d")),
  acc:  Color.dynamic(new Color("#c0522b"), new Color("#f08a5d")),
};

const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
const me = () => Keychain.contains(K_NAME) ? Keychain.get(K_NAME) : "";

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
function groups(list, name) {
  const open = list.tasks.filter(t => !t.done);
  const forMe = open.filter(t => same(t.for, name) || !t.for || same(t.for, ANYONE));
  const asked = open.filter(t => same(t.by, name) && t.for && !same(t.for, name) && !same(t.for, ANYONE));
  const others = open.filter(t => !forMe.includes(t) && !asked.includes(t));
  return { forMe, asked, others };
}
const fromLabel = t => t.by && !same(t.by, me()) ? `from ${t.by}` : "";
const forLabel = t => same(t.for, ANYONE) || !t.for ? "anyone" : `for ${t.for}`;

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

async function menu() {
  // make sure this phone's person is in the shared list of people
  let { list } = await load();
  if (!list.people.some(p => same(p, me()))) {
    list = await change(l => { if (!l.people.some(p => same(p, me()))) l.people.push(me()); }, `Add person: ${me()}`);
  }
  while (true) {
    ({ list } = await load());
    const g = groups(list, me());
    const rows = [
      ...g.forMe.map(t => ({ t, label: `○ ${t.text}${fromLabel(t) ? "  · " + fromLabel(t) : ""}` })),
      ...g.asked.map(t => ({ t, label: `↗ ${t.text}  · ${forLabel(t)}` })),
      ...g.others.map(t => ({ t, label: `· ${t.text}  · ${t.by || "?"} → ${forLabel(t).replace("for ", "")}` })),
    ];
    const a = new Alert();
    a.title = "Family tasks";
    a.message = (g.forMe.length ? `${g.forMe.length} for you. ` : "Nothing for you 🎉 ") +
      (g.asked.length ? `↗ = you asked someone else.` : "") + "\nTap a task to tick it off.";
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
      await change(l => {
        l.tasks.push({ id: Date.now().toString(36), text, by: me(), for: who, added: new Date().toISOString() });
      }, `Add: ${text} (${me()} → ${who})`);
    } else {
      const t = rows[i - 1].t;
      const c = new Alert();
      c.title = "Done?";
      c.message = `${t.text}\n${t.by ? "Added by " + t.by : ""}${t.for ? ", " + forLabel(t) : ""}`;
      c.addAction("✓ Tick off");
      c.addCancelAction("Not yet");
      if (await c.presentAlert() === 0) {
        await change(l => {
          const x = l.tasks.find(y => y.id === t.id);
          if (x) { x.done = new Date().toISOString(); x.doneBy = me(); }
          // keep only the last 30 finished tasks
          const old = l.tasks.filter(y => y.done).sort((a, b) => a.done < b.done ? 1 : -1).slice(30).map(y => y.id);
          l.tasks = l.tasks.filter(y => !old.includes(y.id));
        }, `Done: ${t.text} (${me()})`);
      }
    }
  }
}

// ---------- widget ----------
function age(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? "today" : d + "d";
}
function row(w, text, meta, size, color, showMeta) {
  const r = w.addStack(); r.centerAlignContent();
  const tx = r.addText(text); tx.font = Font.mediumSystemFont(size); tx.textColor = color; tx.lineLimit = 1;
  if (showMeta) {
    r.addSpacer();
    const m = r.addText(meta); m.font = Font.systemFont(size - 3); m.textColor = C.mute; m.lineLimit = 1;
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
  const head = w.addStack(); head.centerAlignContent();
  const h = head.addText(me() ? `${me()}'s tasks` : "Tasks"); h.font = Font.boldSystemFont(16); h.textColor = C.ink;
  head.addSpacer();
  const n = head.addText(g.forMe.length ? `${g.forMe.length} open` : "all done ✓");
  n.font = Font.boldSystemFont(12); n.textColor = g.forMe.length ? C.acc : C.mute;
  w.addSpacer(6);

  let used = 0;
  for (const t of g.forMe) {
    if (used++ >= max) break;
    row(w, "○ " + t.text, [fromLabel(t), age(t.added)].filter(Boolean).join(" · "), size, C.ink, showMeta);
  }
  if (g.forMe.length > max) { const m = w.addText(`+${g.forMe.length - max} more`); m.font = Font.systemFont(11); m.textColor = C.mute; }

  if (fam !== "small" && g.asked.length && used < max) {
    w.addSpacer(4);
    const s = w.addText("ASKED BY YOU"); s.font = Font.boldSystemFont(10); s.textColor = C.mute;
    w.addSpacer(2);
    for (const t of g.asked.slice(0, max - used)) {
      row(w, "↗ " + t.text, `${forLabel(t)} · ${age(t.added)}`, size - 1, C.mute, true);
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
    widget = build(list, stale);
  }
} catch (e) {
  widget = new ListWidget(); widget.backgroundColor = C.bg;
  const t = widget.addText("Tasks unavailable\n" + e.message); t.font = Font.systemFont(11); t.textColor = C.acc;
  if (config.runsInApp) { const a = new Alert(); a.title = "Problem"; a.message = e.message; a.addAction("OK"); await a.present(); }
}
if (config.runsInWidget) Script.setWidget(widget);
Script.complete();
