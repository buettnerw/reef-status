// "Running out" forecasts – Scriptable widget, MEDIUM or LARGE.
// Fits a straight line through your recent tests and says where each value is heading:
//   Alkalinity – days until it drops to 8.5 dKH
//   Phosphate  – days until it reaches 0.10, and a warning if it falls faster than 0.05 a day
//   Nitrate    – days until it reaches the aim of 4
// It's a rough guide: water changes and dosing bend the line.

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";
const K = { bg: "#0d1b24", panel: "#13262f", ink: "#e8f1f4", mute: "#8fa9b3", green: "#7ee2a8", amber: "#f6c453", red: "#ff8a7a", line: "#7fb3c4", band: "#2e7d4f" };
const col = (h, a) => new Color(h, a == null ? 1 : a);

async function loadData() {
  const fm = FileManager.local(), path = fm.joinPath(fm.documentsDirectory(), CACHE);
  try {
    const r = new Request(URL + "?t=" + Date.now()); r.timeoutInterval = 15;
    const d = await r.loadJSON(); fm.writeString(path, JSON.stringify(d)); return { data: d, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) return { data: JSON.parse(fm.readString(path)), stale: true };
    throw e;
  }
}

// least-squares slope in units per day over the last n points
function slope(pts) {
  if (pts.length < 2) return 0;
  const xs = pts.map(p => new Date(p[0]).getTime() / 864e5), ys = pts.map(p => p[1]);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : 0;
}
const recent = (s, days) => { const cut = Date.now() - days * 864e5; const r = s.filter(p => new Date(p[0]).getTime() >= cut); return r.length >= 2 ? r : s.slice(-3); };

function spark(pts, lo, hi, W, H, c) {
  const ctx = new DrawContext(); ctx.size = new Size(W, H); ctx.opaque = false; ctx.respectScreenScale = true;
  const vs = pts.map(p => p[1]);
  let a = Math.min(lo, ...vs), b = Math.max(hi, ...vs); const pad = (b - a) * 0.15 || 1; a -= pad; b += pad;
  const t0 = new Date(pts[0][0]).getTime(), t1 = new Date(pts[pts.length - 1][0]).getTime() || t0 + 1;
  const X = t => 3 + (new Date(t).getTime() - t0) / Math.max(1, t1 - t0) * (W - 6), Y = v => 3 + (1 - (v - a) / (b - a)) * (H - 6);
  ctx.setFillColor(col(K.band, 0.35)); ctx.fillRect(new Rect(0, Y(hi), W, Y(lo) - Y(hi)));
  const p = new Path(); p.move(new Point(X(pts[0][0]), Y(vs[0])));
  pts.slice(1).forEach(q => p.addLine(new Point(X(q[0]), Y(q[1]))));
  ctx.addPath(p); ctx.setStrokeColor(col(K.line)); ctx.setLineWidth(1.5); ctx.strokePath();
  const l = pts[pts.length - 1]; ctx.setFillColor(col(c)); ctx.fillEllipse(new Rect(X(l[0]) - 3, Y(l[1]) - 3, 6, 6));
  return ctx.getImage();
}

const fmtDays = d => d < 1 ? "today" : d < 2 ? "~1 day" : d > 60 ? "60+ days" : "~" + Math.round(d) + " days";

function alkRow(s) {
  const pts = recent(s, 14), v = s[s.length - 1][1], m = slope(pts);
  if (v <= 8.5) return { c: K.red, msg: "below 8.5 now – raise slowly" };
  if (m >= -0.01) return { c: K.green, msg: "steady – no drop to worry about" };
  const d = (v - 8.5) / -m;
  return { c: d < 5 ? K.red : d < 10 ? K.amber : K.green, msg: (m.toFixed(2)) + " a day · 8.5 in " + fmtDays(d) };
}
function po4Row(s) {
  const pts = recent(s, 4), v = s[s.length - 1][1], m = slope(pts);
  if (v < 0.03) return { c: K.red, msg: "near zero – take some PhosBond out" };
  if (m < -0.05) return { c: K.red, msg: "falling too fast (" + m.toFixed(3) + " a day) – less PhosBond" };
  if (v <= 0.1) return { c: K.green, msg: "in target · hold it here" };
  if (m >= -0.002) return { c: K.amber, msg: "not falling – check the reactor flow" };
  return { c: K.green, msg: m.toFixed(3) + " a day · 0.10 in " + fmtDays((v - 0.1) / -m) };
}
function no3Row(s) {
  const pts = recent(s, 5), v = s[s.length - 1][1], m = slope(pts);
  if (v >= 3.5 && v <= 4.5) return { c: K.green, msg: "at the aim of 4 · hold" };
  if (v > 4.5) return { c: m > 0 ? K.amber : K.green, msg: m > 0 ? "rising past 4 – dose less" : "coming back down to 4" };
  if (m <= 0.05) return { c: K.amber, msg: "not rising yet – keep the 20 mL going" };
  return { c: K.green, msg: "+" + m.toFixed(2) + " a day · 4 in " + fmtDays((4 - v) / m) };
}

function row(w, title, val, unit, r, pts, lo, hi, big) {
  const s = w.addStack(); s.backgroundColor = col(K.panel); s.cornerRadius = 10; s.setPadding(6, 8, 6, 8); s.centerAlignContent();
  const left = s.addStack(); left.layoutVertically(); left.size = new Size(big ? 74 : 68, 0);
  const t = left.addText(title); t.font = Font.systemFont(10); t.textColor = col(K.mute);
  const v = left.addText(val + " " + unit); v.font = Font.boldRoundedSystemFont(15); v.textColor = col(r.c); v.minimumScaleFactor = 0.7;
  s.addSpacer(6);
  const mid = s.addStack(); mid.layoutVertically();
  const m = mid.addText(r.msg); m.font = Font.semiboldSystemFont(11); m.textColor = col(r.c); m.lineLimit = 2; m.minimumScaleFactor = 0.7;
  s.addSpacer(6);
  if (pts.length > 1) s.addImage(spark(pts, lo, hi, big ? 90 : 70, big ? 34 : 26, r.c));
}

async function build() {
  const { data, stale } = await loadData();
  const S = data.series || {};
  const fam = config.widgetFamily || "large", big = fam === "large";
  const w = new ListWidget(); w.backgroundColor = col(K.bg); w.setPadding(10, 10, 10, 10);
  w.url = data.log_url; w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const top = w.addStack();
  const t = top.addText("🔮 Where it's heading"); t.font = Font.boldSystemFont(14); t.textColor = col(K.ink);
  top.addSpacer();
  const n = top.addText(stale ? "offline" : "straight-line guess"); n.font = Font.systemFont(10); n.textColor = col(K.mute);
  w.addSpacer(5);
  const add = (k, title, unit, f, lo, hi, d) => {
    const s = S[k]; if (!s || !s.length) return;
    row(w, title, s[s.length - 1][1].toFixed(d), unit, f(s), s.slice(-8), lo, hi, big); w.addSpacer(5);
  };
  add("alk", "Alkalinity", "dKH", alkRow, 8.5, 11, 1);
  add("po4", "Phosphate", "", po4Row, 0.03, 0.1, 2);
  add("no3", "Nitrate", "", no3Row, 2, 5, 1);
  if (big) {
    const temp = S.temp || [];
    if (temp.length) {
      const vs = temp.slice(-7).map(p => p[1]), hi = Math.max(...vs), lo = Math.min(...vs);
      row(w, "Temp · 7 tests", temp[temp.length - 1][1].toFixed(1), "°C",
        { c: hi > 26.8 ? K.amber : K.green, msg: "range " + lo.toFixed(1) + "–" + hi.toFixed(1) + " °C" + (hi > 26.8 ? " · warm" : " · stable") },
        temp.slice(-8), 24.8, 26.5, big);
    }
  }
  w.addSpacer();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget); else await widget.presentLarge();
Script.complete();
