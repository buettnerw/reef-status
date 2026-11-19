#!/usr/bin/env python3
"""Copy recent readings from wc/series.py into latest.json -> "series" (for the phone widgets).
Run after every new reading:  python3 sync_series.py"""
import json, re, sys
SRC = "/home/claude/wc/series.py"; DST = "/home/claude/reef-status/latest.json"
KEEP = {"no3": 16, "po4": 16, "alk": 12, "ca": 10, "mg": 10, "temp": 14}
ser = {k: [] for k in KEEP}
for line in open(SRC):
    m = re.match(r"\s*(20\d\d-\d\d-\d\dT\d\d:\d\d) (.+)$", line.strip())
    if not m: continue
    at = m.group(1) + ":00+02:00"
    for part in m.group(2).split("|"):
        bits = part.strip().split()
        if len(bits) != 2 or bits[0] not in KEEP: continue
        v = bits[1].rstrip(">")
        try: ser[bits[0]].append([at, float(v)])
        except ValueError: pass
for k in ser:
    ser[k] = sorted(ser[k])[-KEEP[k]:]
d = json.load(open(DST))
d["series"] = ser
# balance trail: each Ca with the alk measured within 4 days before it
pairs, alk = [], None
ev = sorted([(a, "alk", v) for a, v in ser["alk"]] + [(a, "ca", v) for a, v in ser["ca"]])
for a, k, v in ev:
    if k == "alk": alk = (a, v)
    elif alk: pairs.append({"at": a[:10], "alk": alk[1], "ca": v})
if ser["alk"] and pairs and ser["alk"][-1][0] > pairs[-1]["at"]:
    pairs.append({"at": ser["alk"][-1][0][:10], "alk": ser["alk"][-1][1], "ca": ser["ca"][-1][1]})
d.setdefault("balance", {})["history"] = pairs[-8:]
def dump(d):
    c = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    out = []
    for k, v in d.items():
        if k == "params":
            out.append('  "params": [\n' + ",\n".join("    " + c(p) for p in v) + "\n  ]")
        elif isinstance(v, dict):
            out.append(f'  "{k}": {{\n' + ",\n".join(f'    "{kk}": {c(vv)}' for kk, vv in v.items()) + "\n  }")
        else:
            out.append(f'  "{k}": {c(v)}')
    return "{\n" + ",\n".join(out) + "\n}\n"
open(DST, "w").write(dump(d))
print({k: len(v) for k, v in ser.items()}, "pairs", len(pairs))
