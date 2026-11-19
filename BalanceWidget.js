// Ca · Alk balance widget for Scriptable (iOS) – best as a LARGE widget.
// Reads latest.json from github.com/buettnerw/reef-status.
// Chart: alkalinity (x) vs calcium (y), green target box, red "snow" zone
// (Ca × Alk too high for the current Mg – rule of thumb), natural-seawater
// ring, your recent readings as a fading trail and the direction corals
// pull the water (≈7.1 ppm Ca per 1 dKH).

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";

// ---------- colours (dark card, like the mock-up) ----------
const K = {
  bg: "#0d1b24", panel: "#13262f", ink: "#e8f1f4", mute: "#8fa9b3",
  grid: "#1d2f38", green: "#7ee2a8", box: "#2e7d4f", boxLine: "#5fd08f",
  red: "#c0392b", redTxt: "#ff8a7a", amber: "#f6c453", trail: "#7fb3c4", sea: "#9fc7d4",
};
const col = (h, a) => new Color(h, a == null ? 1 : a);

// ---------- data ----------
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
const param = (d, k) => d.params.find(p => p.k === k);

// ---------- chemistry rules ----------
const BOX = { a0: 8.5, a1: 11, c0: 400, c1: 450 };
const snowK = mg => 5000 * mg / 1300;          // Ca×Alk limit, grows with Mg
const MGCA = { lo: 2.8, hi: 3.6 };

function verdict(ca, alk, mg) {
  const prod = ca * alk, k = snowK(mg), ratio = mg / ca;
  if (prod > k) return { c: "r", t: "Snow risk – pause Ca & Alk dosing, retest tomorrow" };
  if (prod > 0.9 * k) return { c: "y", t: "Close to the snow line – don't raise Ca or Alk" };
  if (alk < BOX.a0) return { c: "y", t: "Alkalinity low – raise slowly (max 1 dKH a day)" };
  if (ca < BOX.c0) return { c: "y", t: "Calcium low – raise slowly" };
  if (alk > BOX.a1 || ca > BOX.c1) return { c: "y", t: "Above the target box – let corals use it down" };
  if (ratio < MGCA.lo) return { c: "y", t: "Mg low for this Ca – raise Mg first" };
  if (ratio > MGCA.hi) return { c: "y", t: "Mg high for this Ca – no Mg dosing" };
  return { c: "g", t: "Balanced · inside the target box, clear of the snow zone" };
}

// ---------- chart image ----------
function chart(ca, alk, mg, hist, W, H) {
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const L = 34, R = 6, T = 6, B = 26;
  const a0 = 6, a1 = 13.5, c0 = 350, c1 = 490;
  const X = a => L + (a - a0) / (a1 - a0) * (W - L - R);
  const Y = c => T + (1 - (c - c0) / (c1 - c0)) * (H - T - B);
  const P = (a, c) => new Point(X(a), Y(c));

  // grid + labels
  ctx.setFont(Font.systemFont(9));
  ctx.setTextColor(col(K.mute));
  ctx.setLineWidth(1);
  ctx.setStrokeColor(col(K.grid));
  for (let a = 7; a <= 13; a++) {
    const g = new Path(); g.move(P(a, c0)); g.addLine(P(a, c1)); ctx.addPath(g); ctx.strokePath();
    ctx.setTextAlignedCenter(); ctx.drawTextInRect(String(a), new Rect(X(a) - 10, H - B + 3, 20, 12));
  }
  for (let c = 360; c <= 480; c += 20) {
    const g = new Path(); g.move(P(a0, c)); g.addLine(P(a1, c)); ctx.addPath(g); ctx.strokePath();
    ctx.setTextAlignedRight(); ctx.drawTextInRect(String(c), new Rect(0, Y(c) - 6, L - 4, 12));
  }
  ctx.setTextAlignedCenter();
  ctx.setTextColor(col(K.ink, 0.8));
  ctx.drawTextInRect("Alkalinity (dKH) →", new Rect(L, H - 12, W - L - R, 12));

  // snow zone
  const k = snowK(mg);
  const z = new Path();
  z.move(P(Math.max(a0, k / c1), c1));
  for (let a = Math.max(a0, k / c1); a <= a1 + 1e-9; a += 0.05) z.addLine(P(a, Math.min(c1, k / a)));
  z.addLine(P(a1, c1)); z.closeSubpath();
  ctx.addPath(z); ctx.setFillColor(col(K.red, 0.35)); ctx.fillPath();
  ctx.setFont(Font.boldSystemFont(10)); ctx.setTextColor(col(K.redTxt));
  ctx.drawTextInRect("snow zone", new Rect(X(11.6), Y(486), X(13.5) - X(11.6), 12));
  ctx.setFont(Font.systemFont(8));
  ctx.drawTextInRect("moves out as Mg rises", new Rect(X(11.2), Y(478), X(13.5) - X(11.2), 11));

  // target box
  const bx = new Rect(X(BOX.a0), Y(BOX.c1), X(BOX.a1) - X(BOX.a0), Y(BOX.c0) - Y(BOX.c1));
  const bp = new Path(); bp.addRoundedRect(bx, 5, 5);
  ctx.addPath(bp); ctx.setFillColor(col(K.box, 0.4)); ctx.fillPath();
  ctx.addPath(bp); ctx.setStrokeColor(col(K.boxLine)); ctx.setLineWidth(1.5); ctx.strokePath();
  ctx.setFont(Font.boldSystemFont(9)); ctx.setTextColor(col(K.boxLine)); ctx.setTextAlignedLeft();
  ctx.drawTextInRect("target", new Rect(X(BOX.a0) + 4, Y(BOX.c1) + 2, 50, 11));

  // natural sea water
  ctx.setStrokeColor(col(K.sea)); ctx.setLineWidth(1.5);
  ctx.strokeEllipse(new Rect(X(7) - 4, Y(420) - 4, 8, 8));
  ctx.setFont(Font.systemFont(9)); ctx.setTextColor(col(K.sea));
  ctx.drawTextInRect("sea", new Rect(X(7) + 6, Y(420) - 6, 30, 12));

  // trail of past readings (older = smaller, fainter)
  const pts = (hist || []).slice(-8);
  if (pts.length > 1) {
    const t = new Path(); t.move(P(pts[0].alk, pts[0].ca));
    pts.slice(1).forEach(q => t.addLine(P(q.alk, q.ca)));
    ctx.addPath(t); ctx.setStrokeColor(col(K.trail, 0.45)); ctx.setLineWidth(1); ctx.strokePath();
  }
  pts.slice(0, -1).forEach((q, i) => {
    const r = 2 + i * 0.4, f = 0.3 + 0.6 * i / Math.max(1, pts.length - 1);
    ctx.setFillColor(col(K.trail, f));
    ctx.fillEllipse(new Rect(X(q.alk) - r, Y(q.ca) - r, 2 * r, 2 * r));
  });

  // corals-use-both arrow: −2 dKH and −14.2 ppm Ca
  const s = P(alk, ca), e = P(alk - 2, ca - 14.2);
  const ar = new Path(); ar.move(s); ar.addLine(e);
  ctx.addPath(ar); ctx.setStrokeColor(col(K.amber)); ctx.setLineWidth(2); ctx.strokePath();
  const ang = Math.atan2(e.y - s.y, e.x - s.x), hl = 7;
  const head = new Path();
  head.move(e);
  head.addLine(new Point(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45)));
  head.addLine(new Point(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45)));
  head.closeSubpath();
  ctx.addPath(head); ctx.setFillColor(col(K.amber)); ctx.fillPath();
  ctx.setFont(Font.systemFont(8.5)); ctx.setTextColor(col(K.amber)); ctx.setTextAlignedCenter();
  ctx.drawTextInRect("corals use both", new Rect(e.x - 45, e.y + 4, 90, 11));

  // you · now
  const v = verdict(ca, alk, mg);
  const dotC = v.c === "g" ? K.green : v.c === "y" ? K.amber : K.redTxt;
  ctx.setStrokeColor(col(dotC, 0.45)); ctx.setLineWidth(2);
  ctx.strokeEllipse(new Rect(s.x - 10, s.y - 10, 20, 20));
  ctx.setFillColor(col(K.bg)); ctx.fillEllipse(new Rect(s.x - 7.5, s.y - 7.5, 15, 15));
  ctx.setFillColor(col(dotC)); ctx.fillEllipse(new Rect(s.x - 6, s.y - 6, 12, 12));
  ctx.setFont(Font.boldSystemFont(10)); ctx.setTextColor(col(dotC)); ctx.setTextAlignedLeft();
  ctx.drawTextInRect("you · now", new Rect(s.x + 12, s.y - 22, 70, 12));

  return ctx.getImage();
}

function gauge(ratio, W, H) {
  const ctx = new DrawContext();
  ctx.size = new Size(W, H); ctx.opaque = false; ctx.respectScreenScale = true;
  const lo = 2.5, hi = 4.0, X = r => (Math.min(hi, Math.max(lo, r)) - lo) / (hi - lo) * (W - 8) + 4;
  const bar = (x0, x1, c) => { const p = new Path(); p.addRoundedRect(new Rect(x0, H / 2 - 3, x1 - x0, 6), 3, 3); ctx.addPath(p); ctx.setFillColor(c); ctx.fillPath(); };
  bar(4, W - 4, col("#2a3d46"));
  bar(X(MGCA.lo), X(MGCA.hi), col(K.box));
  const ok = ratio >= MGCA.lo && ratio <= MGCA.hi;
  ctx.setFillColor(col(K.bg)); ctx.fillEllipse(new Rect(X(ratio) - 6, H / 2 - 6, 12, 12));
  ctx.setFillColor(col(ok ? K.green : K.amber)); ctx.fillEllipse(new Rect(X(ratio) - 4.5, H / 2 - 4.5, 9, 9));
  return ctx.getImage();
}

// ---------- widget ----------
function pill(row, label, value, colorHex) {
  const s = row.addStack(); s.layoutVertically();
  s.backgroundColor = col(K.panel); s.cornerRadius = 10; s.setPadding(4, 8, 5, 6);
  const l = s.addText(label); l.font = Font.systemFont(10); l.textColor = col(K.mute);
  const v = s.addText(value); v.font = Font.boldRoundedSystemFont(17); v.textColor = col(colorHex);
  return s;
}
const inRange = p => p.v >= p.lo && p.v <= p.hi;
const short = at => { const d = new Date(at); return d.getDate() + " " + d.toLocaleString("en", { month: "short" }); };

async function build() {
  const { data, stale } = await loadData();
  const ca = param(data, "ca"), alk = param(data, "alk"), mg = param(data, "mg");
  const hist = (data.balance && data.balance.history) || [];
  const fam = config.widgetFamily || "large";

  const w = new ListWidget();
  w.backgroundColor = col(K.bg);
  w.setPadding(12, 12, 10, 12);
  w.url = data.log_url;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const top = w.addStack(); top.centerAlignContent();
  const t = top.addText("⚖︎ Ca · Alk balance"); t.font = Font.boldSystemFont(15); t.textColor = col(K.ink);
  top.addSpacer();
  const newest = [ca, alk, mg].map(p => new Date(p.at)).sort((a, b) => b - a)[0];
  const dt = top.addText((stale ? "offline · " : "") + short(newest)); dt.font = Font.systemFont(11); dt.textColor = col(K.mute);
  w.addSpacer(4);

  const v = verdict(ca.v, alk.v, mg.v);
  const vc = v.c === "g" ? K.green : v.c === "y" ? K.amber : K.redTxt;

  if (fam === "small") {
    const big = w.addText(v.c === "g" ? "✓ Balanced" : v.c === "y" ? "⚠︎ Check" : "⛔︎ Snow risk");
    big.font = Font.boldSystemFont(16); big.textColor = col(vc);
    w.addSpacer(4);
    [["Ca", ca], ["Alk", alk], ["Mg", mg]].forEach(([n, p]) => {
      const r = w.addText(n + "  " + Number(p.v).toFixed(p.d)); r.font = Font.semiboldSystemFont(13);
      r.textColor = col(inRange(p) ? K.green : K.amber);
    });
    const ratio = w.addText("Mg:Ca " + (mg.v / ca.v).toFixed(1)); ratio.font = Font.systemFont(11); ratio.textColor = col(K.mute);
    return w;
  }

  const medium = fam === "medium";
  const img = w.addImage(chart(ca.v, alk.v, mg.v, hist, medium ? 300 : 310, medium ? 105 : 200));
  img.centerAlignImage();
  if (medium) return w;

  w.addSpacer(6);
  const row = w.addStack(); row.spacing = 6;
  pill(row, "Calcium", String(ca.v), inRange(ca) ? K.green : K.amber);
  pill(row, "Alkalinity", Number(alk.v).toFixed(1), inRange(alk) ? K.green : K.amber);
  pill(row, "Mg", String(mg.v), inRange(mg) ? K.green : K.amber);
  const ratio = mg.v / ca.v, ok = ratio >= MGCA.lo && ratio <= MGCA.hi;
  const g = row.addStack(); g.layoutVertically();
  g.backgroundColor = col(K.panel); g.cornerRadius = 10; g.setPadding(4, 8, 5, 6);
  const gl = g.addText("Mg : Ca"); gl.font = Font.systemFont(10); gl.textColor = col(K.mute);
  g.addImage(gauge(ratio, 56, 12));
  const gv = g.addText(ratio.toFixed(1) + (ok ? " ✓" : " !")); gv.font = Font.boldRoundedSystemFont(13); gv.textColor = col(ok ? K.green : K.amber);

  w.addSpacer(6);
  const vb = w.addStack(); vb.backgroundColor = col(vc, 0.15); vb.cornerRadius = 10; vb.setPadding(5, 8, 5, 8);
  const vt = vb.addText(v.t); vt.font = Font.semiboldSystemFont(11); vt.textColor = col(vc); vt.minimumScaleFactor = 0.7; vt.lineLimit = 2;
  vb.addSpacer();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
