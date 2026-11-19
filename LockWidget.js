// Lock-screen reef widget for Scriptable (iOS 16+).
// Works in all three lock-screen sizes:
//   • Rectangular – NO3 · PO4 · KH · Ca · temp and an "all good / watch" line
//   • Circular    – a ring gauge for one value. Default nitrate; set the widget's
//                   Parameter to po4, alk, ca, mg or temp for another one
//   • Inline      – one line above the clock
// The lock screen is mostly one colour, so ✓ and ! carry the meaning, not colour.

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";

async function loadData() {
  const fm = FileManager.local(), path = fm.joinPath(fm.documentsDirectory(), CACHE);
  try {
    const r = new Request(URL + "?t=" + Date.now()); r.timeoutInterval = 10;
    const d = await r.loadJSON(); fm.writeString(path, JSON.stringify(d)); return d;
  } catch (e) {
    if (fm.fileExists(path)) return JSON.parse(fm.readString(path));
    throw e;
  }
}
const P = (d, k) => d.params.find(p => p.k === k);
const ok = p => p.v >= p.lo && p.v <= p.hi;
const tr = p => p.prev == null || Math.abs(p.prev - p.v) < 1e-9 ? "" : p.v > p.prev ? "↑" : "↓";
const f = p => Number(p.v).toFixed(p.d) + tr(p);
const mark = p => ok(p) ? "" : "!";

function ring(p) {
  // gauge from yl..yh, green arc lo..hi, needle at the value
  const S = 120, ctx = new DrawContext(); ctx.size = new Size(S, S); ctx.opaque = false; ctx.respectScreenScale = true;
  const c = S / 2, R = 50, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const lo = Math.min(p.yl, p.v), hi = Math.max(p.yh, p.v);
  const A = v => a0 + (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1) * (a1 - a0);
  const arc = (from, to, w, a) => {
    const path = new Path(), n = 40;
    for (let i = 0; i <= n; i++) {
      const t = from + (to - from) * i / n, pt = new Point(c + R * Math.cos(t), c + R * Math.sin(t));
      if (i) path.addLine(pt); else path.move(pt);
    }
    ctx.addPath(path); ctx.setStrokeColor(new Color("#ffffff", a)); ctx.setLineWidth(w); ctx.strokePath();
  };
  arc(a0, a1, 8, 0.25);
  arc(A(p.lo), A(p.hi), 8, 0.75);
  const av = A(p.v);
  ctx.setFillColor(Color.white());
  ctx.fillEllipse(new Rect(c + R * Math.cos(av) - 9, c + R * Math.sin(av) - 9, 18, 18));
  ctx.setFillColor(Color.black());
  ctx.fillEllipse(new Rect(c + R * Math.cos(av) - 4, c + R * Math.sin(av) - 4, 8, 8));
  return ctx.getImage();
}

async function build() {
  const d = await loadData();
  const fam = config.widgetFamily || "accessoryRectangular";
  const no3 = P(d, "no3"), po4 = P(d, "po4"), alk = P(d, "alk"), ca = P(d, "ca"), temp = P(d, "temp");
  const w = new ListWidget();
  w.url = d.log_url;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (fam === "accessoryInline") {
    w.addText(`🐠 NO3 ${f(no3)} · PO4 ${f(po4)} · ${temp.v.toFixed(1)}°`);
    return w;
  }

  if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const k = (args.widgetParameter || "no3").trim().toLowerCase();
    const p = P(d, k) || no3;
    const st = w.addStack(); st.size = new Size(0, 0);
    st.backgroundImage = ring(p);
    st.layoutVertically(); st.centerAlignContent();
    st.addSpacer();
    const v = st.addText(Number(p.v).toFixed(p.d)); v.font = Font.boldRoundedSystemFont(14); v.centerAlignText(); v.minimumScaleFactor = 0.5;
    const n = st.addText(p.n + (ok(p) ? "" : "!")); n.font = Font.systemFont(9); n.centerAlignText();
    st.addSpacer();
    return w;
  }

  // rectangular
  const l1 = w.addText(`NO3 ${f(no3)}${mark(no3)}  PO4 ${f(po4)}${mark(po4)}`);
  l1.font = Font.boldRoundedSystemFont(14); l1.minimumScaleFactor = 0.7;
  const l2 = w.addText(`KH ${f(alk)}  Ca ${ca.v}  ${temp.v.toFixed(1)}°`);
  l2.font = Font.semiboldRoundedSystemFont(13); l2.minimumScaleFactor = 0.7;
  const bad = d.params.filter(p => !ok(p)).map(p => p.n);
  const l3 = w.addText(bad.length ? `! watch: ${bad.slice(0, 3).join(", ")}` : "✓ everything in range");
  l3.font = Font.systemFont(11); l3.textOpacity = 0.8; l3.minimumScaleFactor = 0.7;
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentAccessoryRectangular();
Script.complete();
