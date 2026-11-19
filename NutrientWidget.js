// NO3 · PO4 balance widget for Scriptable (iOS) – LARGE or MEDIUM.
// Nitrate across, phosphate up. Shows the target box, the "dino corner"
// (nitrate near zero while phosphate is still there), your recent tests as
// a fading trail and where you are now.

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";
const K = {
  bg: "#0d1b24", panel: "#13262f", ink: "#e8f1f4", mute: "#8fa9b3", grid: "#1d2f38",
  green: "#7ee2a8", box: "#2e7d4f", boxLine: "#5fd08f", red: "#c0392b", redTxt: "#ff8a7a",
  amber: "#f6c453", dino: "#b9770e", trail: "#7fb3c4", grey: "#5d6d75",
};
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
const param = (d, k) => d.params.find(p => p.k === k);
const BOX = { n0: 2, n1: 5, p0: 0.03, p1: 0.10, aim: 4 };

// pair every nitrate test with the phosphate test nearest in time (within 1 day)
function pairs(d) {
  const n = (d.series && d.series.no3) || [], p = (d.series && d.series.po4) || [];
  const out = [];
  n.forEach(([at, v]) => {
    const t = new Date(at).getTime();
    let best = null, bd = 1e15;
    p.forEach(([pa, pv]) => { const dd = Math.abs(new Date(pa).getTime() - t); if (dd < bd) { bd = dd; best = pv; } });
    if (best != null && bd <= 864e5) out.push({ t, no3: v, po4: best });
  });
  return out.slice(-10);
}

function verdict(no3, po4) {
  const notes = [];
  let c = "g";
  if (no3 < 1.5 && po4 >= 0.03) { c = "r"; notes.push("Dino corner – keep pushing nitrate up"); }
  else if (no3 < BOX.n0) { c = "y"; notes.push("Nitrate low – dosing towards 4"); }
  else if (no3 > 10) { c = "r"; notes.push("Nitrate high – stop KNO3"); }
  else if (no3 > BOX.n1) { c = "y"; notes.push("Nitrate above 5 – skip KNO3"); }
  if (po4 > 0.2) { c = c === "g" ? "y" : c; notes.push("PO4 high – PhosBond working"); }
  else if (po4 > BOX.p1) { c = c === "g" ? "y" : c; notes.push("PO4 still coming down – slow is good"); }
  else if (po4 < 0.02) { c = "y"; notes.push("PO4 near zero – reduce PhosBond"); }
  if (!notes.length) notes.push("✓ In the box – just hold it there");
  return { c, t: notes.join(" · ") };
}

function chart(d, W, H, compact) {
  const ctx = new DrawContext(); ctx.size = new Size(W, H); ctx.opaque = false; ctx.respectScreenScale = true;
  const L = 34, R = 6, T = 6, B = compact ? 16 : 26;
  const n0 = 0, n1 = 8, p0 = 0, p1 = 0.32;
  const X = n => L + (n - n0) / (n1 - n0) * (W - L - R), Y = p => T + (1 - (p - p0) / (p1 - p0)) * (H - T - B);
  const rect = (a, b, c2, d2) => new Rect(X(a), Y(d2), X(c2) - X(a), Y(b) - Y(d2));
  const fill = (r, c) => { ctx.setFillColor(c); ctx.fillRect(r); };
  const txt = (s, x, y, w, size, c, bold, align) => {
    ctx.setFont(bold ? Font.boldSystemFont(size) : Font.systemFont(size)); ctx.setTextColor(c);
    if (align === "c") ctx.setTextAlignedCenter(); else if (align === "r") ctx.setTextAlignedRight(); else ctx.setTextAlignedLeft();
    ctx.drawTextInRect(s, new Rect(x, y, w, size + 3));
  };

  // zones
  fill(rect(0, 0.03, 1.5, p1), col(K.dino, 0.35));
  fill(rect(0, 0, 1.5, 0.03), col(K.grey, 0.35));
  fill(rect(1.5, 0.2, n1, p1), col(K.red, 0.22));
  const bp = new Path(); bp.addRoundedRect(rect(BOX.n0, BOX.p0, BOX.n1, BOX.p1), 5, 5);
  ctx.addPath(bp); ctx.setFillColor(col(K.box, 0.4)); ctx.fillPath();
  ctx.addPath(bp); ctx.setStrokeColor(col(K.boxLine)); ctx.setLineWidth(1.5); ctx.strokePath();

  // grid
  ctx.setLineWidth(1); ctx.setStrokeColor(col(K.grid));
  for (let n = 0; n <= 8; n += 2) {
    const g = new Path(); g.move(new Point(X(n), Y(p1))); g.addLine(new Point(X(n), Y(p0))); ctx.addPath(g); ctx.strokePath();
    txt(String(n), X(n) - 10, H - B + 2, 20, 9, col(K.mute), false, "c");
  }
  for (let p = 0; p <= 0.3001; p += 0.1) {
    const g = new Path(); g.move(new Point(X(n0), Y(p))); g.addLine(new Point(X(n1), Y(p))); ctx.addPath(g); ctx.strokePath();
    txt(p.toFixed(1), 0, Y(p) - 6, L - 4, 9, col(K.mute), false, "r");
  }
  if (!compact) txt("Nitrate NO3 (ppm) →     ↑ Phosphate PO4", L, H - 12, W - L - R, 9, col(K.ink, 0.8), false, "c");

  // labels
  txt("dino", X(0) + 3, Y(0.30), X(1.5) - X(0), 9, col(K.amber), true, "l");
  txt("corner", X(0) + 3, Y(0.30) + 11, X(1.5) - X(0), 9, col(K.amber), true, "l");
  txt("algae fuel", X(4.5), Y(0.31), X(8) - X(4.5) - 4, 9, col(K.redTxt), true, "r");
  txt("target", X(BOX.n0) + 4, Y(BOX.p1) + 2, 50, 9, col(K.boxLine), true, "l");
  // aim star
  txt("★", X(BOX.aim) - 6, Y(0.06) - 7, 12, 11, col(K.boxLine), true, "c");

  // trail
  const pts = pairs(d);
  if (pts.length > 1) {
    const t = new Path(); t.move(new Point(X(pts[0].no3), Y(pts[0].po4)));
    pts.slice(1).forEach(q => t.addLine(new Point(X(q.no3), Y(q.po4))));
    ctx.addPath(t); ctx.setStrokeColor(col(K.trail, 0.4)); ctx.setLineWidth(1); ctx.strokePath();
  }
  pts.slice(0, -1).forEach((q, i) => {
    const r = 2 + i * 0.25, f = 0.25 + 0.6 * i / Math.max(1, pts.length - 1);
    ctx.setFillColor(col(K.trail, f)); ctx.fillEllipse(new Rect(X(q.no3) - r, Y(q.po4) - r, 2 * r, 2 * r));
  });

  // now
  const no3 = param(d, "no3").v, po4 = param(d, "po4").v, v = verdict(no3, po4);
  const c = v.c === "g" ? K.green : v.c === "y" ? K.amber : K.redTxt;
  const sx = X(Math.min(n1, no3)), sy = Y(Math.min(p1, po4));
  // arrow towards the aim
  const ex = X(BOX.aim), ey = Y(0.06), ang = Math.atan2(ey - sy, ex - sx), len = Math.hypot(ex - sx, ey - sy);
  if (len > 30) {
    const ax = sx + (len - 10) * Math.cos(ang), ay = sy + (len - 10) * Math.sin(ang);
    for (let k = 16; k < len - 14; k += 7) {
      ctx.setFillColor(col(K.boxLine, 0.7));
      ctx.fillEllipse(new Rect(sx + k * Math.cos(ang) - 1.2, sy + k * Math.sin(ang) - 1.2, 2.4, 2.4));
    }
  }
  ctx.setStrokeColor(col(c, 0.45)); ctx.setLineWidth(2); ctx.strokeEllipse(new Rect(sx - 10, sy - 10, 20, 20));
  ctx.setFillColor(col(K.bg)); ctx.fillEllipse(new Rect(sx - 7.5, sy - 7.5, 15, 15));
  ctx.setFillColor(col(c)); ctx.fillEllipse(new Rect(sx - 6, sy - 6, 12, 12));
  txt("you · now", sx + 12, sy - 22, 70, 10, col(c), true, "l");
  return ctx.getImage();
}

function pill(row, label, value, hex) {
  const s = row.addStack(); s.layoutVertically();
  s.backgroundColor = col(K.panel); s.cornerRadius = 10; s.setPadding(4, 8, 5, 6);
  const l = s.addText(label); l.font = Font.systemFont(10); l.textColor = col(K.mute);
  const v = s.addText(value); v.font = Font.boldRoundedSystemFont(17); v.textColor = col(hex);
}

async function build() {
  const { data, stale } = await loadData();
  const fam = config.widgetFamily || "large";
  const no3 = param(data, "no3"), po4 = param(data, "po4");
  const v = verdict(no3.v, po4.v), vc = v.c === "g" ? K.green : v.c === "y" ? K.amber : K.redTxt;
  const w = new ListWidget(); w.backgroundColor = col(K.bg); w.setPadding(12, 12, 10, 12);
  w.url = data.log_url; w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const top = w.addStack(); top.centerAlignContent();
  const t = top.addText("🧪 NO3 · PO4 balance"); t.font = Font.boldSystemFont(fam === "small" ? 12 : 15); t.textColor = col(K.ink);
  top.addSpacer();
  if (fam !== "small") {
    const dt = top.addText((stale ? "offline · " : "") + new Date(no3.at).getDate() + " " + new Date(no3.at).toLocaleString("en", { month: "short" }));
    dt.font = Font.systemFont(11); dt.textColor = col(K.mute);
  }
  w.addSpacer(4);

  if (fam === "small") {
    const a = w.addText("NO3 " + no3.v); a.font = Font.boldRoundedSystemFont(20); a.textColor = col(no3.v >= 2 && no3.v <= 5 ? K.green : K.amber);
    const b = w.addText("PO4 " + po4.v.toFixed(2)); b.font = Font.boldRoundedSystemFont(20); b.textColor = col(po4.v <= 0.1 && po4.v >= 0.03 ? K.green : K.amber);
    w.addSpacer(4);
    const c = w.addText(v.t.split(" · ")[0]); c.font = Font.systemFont(10); c.textColor = col(vc); c.minimumScaleFactor = 0.7;
    return w;
  }
  const medium = fam === "medium";
  w.addImage(chart(data, medium ? 300 : 310, medium ? 110 : 210, medium)).centerAlignImage();
  if (medium) return w;

  w.addSpacer(6);
  const row = w.addStack(); row.spacing = 6;
  pill(row, "Nitrate · aim 4", String(no3.v), no3.v >= 2 && no3.v <= 5 ? K.green : K.amber);
  pill(row, "Phosphate · aim ≤0.10", po4.v.toFixed(2), po4.v <= 0.1 && po4.v >= 0.03 ? K.green : K.amber);
  w.addSpacer(6);
  const vb = w.addStack(); vb.backgroundColor = col(vc, 0.15); vb.cornerRadius = 10; vb.setPadding(5, 8, 5, 8);
  const vt = vb.addText(v.t); vt.font = Font.semiboldSystemFont(11); vt.textColor = col(vc); vt.lineLimit = 2; vt.minimumScaleFactor = 0.7;
  vb.addSpacer();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget); else await widget.presentLarge();
Script.complete();
