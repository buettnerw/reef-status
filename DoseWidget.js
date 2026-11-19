// Today's KNO3 dose – Scriptable widget, SMALL (or medium).
// Reads this morning's nitrate and works out the dose with the target-4 rule:
//   NO3 ≤2.5 → 20 mL · ~3 → 14 mL · ~4 → 8 mL · near 5 → 4 mL · 5 or more → none
// Stock: 50 g KNO3 in 500 mL (14 mL ≈ +1 ppm in the 850 L system).

const URL = "https://raw.githubusercontent.com/buettnerw/reef-status/main/latest.json";
const CACHE = "reef-status-latest.json";
const K = { bg: "#0d1b24", ink: "#e8f1f4", mute: "#8fa9b3", green: "#7ee2a8", amber: "#f6c453", red: "#ff8a7a", blue: "#7fc4ff" };
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
function doseFor(no3) {
  if (no3 <= 2.5) return 20;
  if (no3 < 3.5) return 14;
  if (no3 < 4.5) return 8;
  if (no3 < 5) return 4;
  return 0;
}
const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const hm = d => { const x = new Date(d); return String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0"); };

async function build() {
  const { data, stale } = await loadData();
  const no3 = data.params.find(p => p.k === "no3");
  const dose = data.dose && data.dose.kno3;
  const now = new Date(), today = day(now);
  const testedToday = day(no3.at) === today;
  const dosedToday = dose && day(dose.at) === today;
  const saturday = now.getDay() === 6;
  const ml = doseFor(no3.v);
  const fam = config.widgetFamily || "small";

  const w = new ListWidget(); w.backgroundColor = col(K.bg); w.setPadding(12, 12, 10, 12);
  w.url = data.log_url; w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const t = w.addText("💧 KNO3 today" + (stale ? " · offline" : "")); t.font = Font.boldSystemFont(13); t.textColor = col(K.ink);
  w.addSpacer(4);

  let big, bigC, line1, line1C, line2;
  if (dosedToday) {
    big = "✓ " + dose.ml + " mL"; bigC = K.green;
    line1 = "dosed at " + hm(dose.at); line1C = K.green;
    line2 = "NO3 " + no3.v + " → aim 4 · test again tomorrow";
  } else if (testedToday) {
    big = ml ? ml + " mL" : "none"; bigC = ml ? K.blue : K.green;
    line1 = saturday ? "after the water change" : "not dosed yet"; line1C = K.amber;
    line2 = "NO3 " + no3.v + " this morning → aim 4";
  } else {
    big = "Test NO3"; bigC = K.amber;
    line1 = "then dose" + (saturday ? " after the water change" : ""); line1C = K.amber;
    line2 = "last: " + no3.v + " → would be " + ml + " mL";
  }
  const b = w.addText(big); b.font = Font.boldRoundedSystemFont(fam === "small" ? 30 : 34); b.textColor = col(bigC); b.minimumScaleFactor = 0.6;
  const l1 = w.addText(line1); l1.font = Font.semiboldSystemFont(12); l1.textColor = col(line1C);
  w.addSpacer();
  const l2 = w.addText(line2); l2.font = Font.systemFont(10); l2.textColor = col(K.mute); l2.minimumScaleFactor = 0.7; l2.lineLimit = 2;
  if (fam !== "small") {
    const l3 = w.addText("Rule: ≤2 → 20 mL · ~3 → 14 · ~4 → 8 · near 5 → 4 · 5+ → none");
    l3.font = Font.systemFont(10); l3.textColor = col(K.mute);
  }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget); else await widget.presentSmall();
Script.complete();
