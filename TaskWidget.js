// Reef task widget for Scriptable (iOS)
// Shows today's aquarium jobs. Tests tick themselves off once the reading
// is logged (via latest.json); tap the widget to tick anything else by hand.

const BASE = "https://raw.githubusercontent.com/buettnerw/reef-status/main/";
const fm = FileManager.local();
const dir = fm.documentsDirectory();
const TICKS = fm.joinPath(dir, "reef-task-ticks.json");

const C = {
  bg:   Color.dynamic(new Color("#f3f6f6"), new Color("#0c1719")),
  ink:  Color.dynamic(new Color("#13282c"), new Color("#e3eeef")),
  mute: Color.dynamic(new Color("#5b7074"), new Color("#93a8ab")),
  ok:   Color.dynamic(new Color("#2f7d4f"), new Color("#6fcf93")),
  warn: Color.dynamic(new Color("#a8620b"), new Color("#f0b35c")),
  bad:  Color.dynamic(new Color("#b03a2e"), new Color("#f08a7e")),
};

// ---------- data ----------
async function getJSON(name) {
  const path = fm.joinPath(dir, "reef-cache-" + name);
  try {
    const r = new Request(BASE + name + "?t=" + Date.now());
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    fm.writeString(path, JSON.stringify(j));
    return [j, false];
  } catch (e) {
    if (fm.fileExists(path)) return [JSON.parse(fm.readString(path)), true];
    throw e;
  }
}
const loadTicks = () => fm.fileExists(TICKS) ? JSON.parse(fm.readString(TICKS)) : {};
const saveTicks = t => fm.writeString(TICKS, JSON.stringify(t));

// ---------- dates (all as local calendar days) ----------
const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = s => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const fromStamp = s => s ? day(key(new Date(s))) : null;   // ISO with offset -> local day
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const max = (a, b) => !a ? b : !b ? a : (a > b ? a : b);
const TODAY = day(key(new Date()));
const same = (a, b) => a && b && a.getTime() === b.getTime();

// ---------- task state ----------
// returns {done, doneToday, due}  (due = date the task is next/currently due)
function state(t, params, lastWC, ticks) {
  const tick = day(ticks[t.id]);
  if (t.kind === "test" || t.kind === "every") {
    const p = t.param ? params[t.param] : null;
    const days = t.days || (p && p.rt) || 1;
    const last = max(t.kind === "test" ? fromStamp(p && p.at) : day(t.last), tick);
    const due = last ? add(last, days) : TODAY;
    return { done: due > TODAY, doneToday: same(last, TODAY), due };
  }
  if (t.kind === "weekly") {
    const back = (TODAY.getDay() - t.weekday + 7) % 7;
    const start = add(TODAY, -back);
    const last = max(t.id === "wc" ? fromStamp(lastWC) : null, tick);
    const done = !!last && last >= start;
    return { done, doneToday: same(last, TODAY), due: done ? add(start, 7) : start };
  }
  // once
  const p = t.param ? params[t.param] : null;
  const auto = p && p.at && fromStamp(p.at) > day(t.after);
  const doneDay = tick || (auto ? fromStamp(p.at) : null);
  return { done: !!doneDay, doneToday: same(doneDay, TODAY), due: day(t.due), gone: !!doneDay && !same(doneDay, TODAY) };
}

function sortTasks(tasks, params, lastWC, ticks) {
  const all = tasks.map(t => ({ t, s: state(t, params, lastWC, ticks) })).filter(x => !x.s.gone);
  const open = all.filter(x => !x.s.done && x.s.due <= TODAY).sort((a, b) => a.s.due - b.s.due);
  const doneToday = all.filter(x => x.s.doneToday);
  const soon = all.filter(x => !x.s.doneToday && x.s.due > TODAY && x.s.due <= add(TODAY, 3))
    .sort((a, b) => a.s.due - b.s.due);
  return { open, doneToday, soon };
}

// ---------- widget ----------
function line(stack, text, size, color, font) {
  const t = stack.addText(text);
  t.font = font || Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}
function dueLabel(d) {
  const n = Math.round((d - TODAY) / 864e5);
  if (n < 0) return `${-n}d late`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return d.toLocaleDateString("en-ZA", { weekday: "short" });
}

function build(lists, stale) {
  const fam = config.widgetFamily || "large";
  const size = fam === "large" ? 14 : 12;
  const maxRows = { small: 4, medium: 6, large: 14 }[fam];
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

  const head = w.addStack(); head.centerAlignContent();
  line(head, "Reef jobs", 0, C.ink, Font.boldSystemFont(fam === "small" ? 15 : 16));
  head.addSpacer();
  const left = lists.open.length;
  line(head, left ? `${left} to do` : "all done ✓", 0, left ? C.warn : C.ok, Font.boldSystemFont(12));
  w.addSpacer(6);

  let rows = 0;
  for (const { t, s } of lists.open) {
    if (rows++ >= maxRows) break;
    const r = w.addStack(); r.centerAlignContent();
    const late = s.due < TODAY;
    line(r, "○ ", size, late ? C.bad : C.ink, Font.boldSystemFont(size));
    line(r, t.title, size, C.ink, Font.mediumSystemFont(size));
    r.addSpacer();
    if (fam !== "small" && late) line(r, dueLabel(s.due), size - 3, C.bad, Font.boldSystemFont(size - 3));
    if (fam === "large" && t.note) { const n = w.addStack(); n.addSpacer(18); line(n, t.note, size - 4, C.mute); }
    w.addSpacer(fam === "large" ? 3 : 2);
  }
  if (fam !== "small") {
    for (const { t } of lists.doneToday) {
      if (rows++ >= maxRows) break;
      const r = w.addStack();
      line(r, "✓ " + t.title, size, C.mute, Font.systemFont(size)).textOpacity = 0.6;
      w.addSpacer(2);
    }
  }
  if (fam === "large" && lists.soon.length && rows < maxRows) {
    w.addSpacer(6);
    line(w, "COMING UP", 10, C.mute, Font.boldSystemFont(10));
    w.addSpacer(2);
    for (const { t, s } of lists.soon.slice(0, maxRows - rows)) {
      const r = w.addStack();
      line(r, t.title, 12, C.mute);
      r.addSpacer();
      line(r, dueLabel(s.due), 11, C.mute);
    }
  }
  w.addSpacer();
  line(w, "Tap to tick off" + (stale ? " · offline" : ""), 10, C.mute);
  return w;
}

// ---------- tick-off menu (runs when you tap the widget) ----------
async function tickMenu(tasks, params, lastWC) {
  while (true) {
    const ticks = loadTicks();
    const { open, doneToday } = sortTasks(tasks, params, lastWC, ticks);
    const items = [...open.map(x => ({ x, on: false })), ...doneToday.map(x => ({ x, on: true }))];
    const a = new Alert();
    a.title = "Reef jobs today";
    a.message = open.length ? "Tap a job to tick it off (tap again to undo)." : "Everything done for today 🎉";
    items.forEach(({ x, on }) => a.addAction((on ? "✓ " : "○ ") + x.t.title));
    a.addCancelAction("Close");
    const i = await a.presentSheet();
    if (i < 0) break;
    const { x, on } = items[i];
    if (on) delete ticks[x.t.id]; else ticks[x.t.id] = key(TODAY);
    saveTicks(ticks);
  }
}

// ---------- main ----------
let widget;
try {
  const [[tdata, s1], [ldata, s2]] = [await getJSON("tasks.json"), await getJSON("latest.json")];
  const params = Object.fromEntries(ldata.params.map(p => [p.k, p]));
  if (config.runsInApp) await tickMenu(tdata.tasks, params, ldata.last_water_change);
  widget = build(sortTasks(tdata.tasks, params, ldata.last_water_change, loadTicks()), s1 || s2);
} catch (e) {
  widget = new ListWidget();
  widget.backgroundColor = C.bg;
  line(widget, "Reef jobs unavailable\n" + e, 11, C.bad).lineLimit = 0;
}
if (config.runsInWidget) Script.setWidget(widget);
Script.complete();
