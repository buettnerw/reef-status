// Reef cockpit widget for Scriptable (iOS)
// Reads latest.json from github.com/buettnerw/reef-status and shows
// each parameter with a green / amber / red dot, like the Reef Water Log.

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";

const C = {
  bg:   Color.dynamic(new Color("#f3f6f6"), new Color("#0c1719")),
  ink:  Color.dynamic(new Color("#13282c"), new Color("#e3eeef")),
  mute: Color.dynamic(new Color("#5b7074"), new Color("#93a8ab")),
  g:    Color.dynamic(new Color("#2f7d4f"), new Color("#6fcf93")),
  y:    Color.dynamic(new Color("#a8620b"), new Color("#f0b35c")),
  r:    Color.dynamic(new Color("#b03a2e"), new Color("#f08a7e")),
};

// ---- data (falls back to the last good copy when offline) ----
async function loadData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), CACHE);
  try {
    const req = new Request(URL + "?t=" + Date.now());
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    fm.writeString(path, JSON.stringify(data));
    return { data, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) return { data: JSON.parse(fm.readString(path)), stale: true };
    throw e;
  }
}

// ---- same traffic-light rules as the cockpit ----
function light(p) {
  const v = p.v;
  if (p.gt && v >= p.hi) return "r";
  if (v >= p.lo && v <= p.hi) return "g";
  if (v >= p.yl && v <= p.yh) return "y";
  return "r";
}
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function ageDays(at) { return Math.round((dayStart(new Date()) - dayStart(new Date(at))) / 864e5); }
function trend(p) {
  if (p.prev == null || Math.abs(p.prev - p.v) < 1e-9) return "→";
  return p.v > p.prev ? "↑" : "↓";
}
function fmt(p) { return (p.gt ? ">" : "") + Number(p.v).toFixed(p.d); }

// ---- layout ----
function addRow(stack, p, size) {
  const l = light(p), age = ageDays(p.at), due = age >= p.rt;
  const row = stack.addStack();
  row.centerAlignContent();
  const dot = row.addText("●");
  dot.font = Font.boldSystemFont(size);
  dot.textColor = C[l];
  row.addSpacer(4);
  const nm = row.addText(p.n);
  nm.font = Font.mediumSystemFont(size);
  nm.textColor = C.ink;
  nm.lineLimit = 1;
  row.addSpacer();
  const val = row.addText(fmt(p) + " " + trend(p));
  val.font = Font.semiboldMonospacedSystemFont(size);
  val.textColor = C.ink;
  row.addSpacer(4);
  const ag = row.addText(due ? "DUE" : age === 0 ? "today" : age + "d");
  ag.font = due ? Font.boldSystemFont(size - 3) : Font.systemFont(size - 3);
  ag.textColor = due ? C.r : C.mute;
}

function build({ data, stale }) {
  const fam = config.widgetFamily || "large";
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = data.log_url;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  const ps = data.params;
  const cnt = { g: 0, y: 0, r: 0 };
  ps.forEach(p => cnt[light(p)]++);
  const dueCount = ps.filter(p => ageDays(p.at) >= p.rt).length;

  // header
  const head = w.addStack();
  head.centerAlignContent();
  const t = head.addText("Reef");
  t.font = Font.boldSystemFont(fam === "small" ? 15 : 16);
  t.textColor = C.ink;
  head.addSpacer();
  for (const k of ["g", "y", "r"]) {
    const s = head.addText(" ●" + cnt[k]);
    s.font = Font.boldSystemFont(12);
    s.textColor = C[k];
  }
  w.addSpacer(6);

  if (fam === "small") {
    // most urgent first: red, then amber, then due
    const rank = p => ({ r: 0, y: 1, g: 2 }[light(p)]) - (ageDays(p.at) >= p.rt ? 0.5 : 0);
    [...ps].sort((a, b) => rank(a) - rank(b)).slice(0, 4).forEach(p => { addRow(w, p, 12); w.addSpacer(3); });
  } else {
    const n = fam === "medium" ? 5 : ps.length;
    const size = fam === "medium" ? 12 : 14;
    ps.slice(0, n).forEach(p => { addRow(w, p, size); w.addSpacer(fam === "medium" ? 2 : 5); });
  }

  w.addSpacer();
  const wc = ageDays(data.last_water_change);
  const foot = w.addText(
    `Water change ${wc === 0 ? "today" : wc + "d ago"}` +
    (dueCount ? ` · ${dueCount} test${dueCount > 1 ? "s" : ""} due` : "") +
    (stale ? " · offline" : "")
  );
  foot.font = Font.systemFont(10);
  foot.textColor = C.mute;
  return w;
}

let widget;
try {
  widget = build(await loadData());
} catch (e) {
  widget = new ListWidget();
  widget.backgroundColor = C.bg;
  const err = widget.addText("Reef data unavailable\n" + e);
  err.font = Font.systemFont(11);
  err.textColor = C.r;
}

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
