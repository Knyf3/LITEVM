#!/usr/bin/env python3
"""Back up every demo-tenant tab, and enumerate exactly what is test residue."""
import json, os, time, urllib.request, urllib.parse

T = json.load(open("/home/hermes/.hermes/google_token.json"))
d = urllib.parse.urlencode({"client_id": T["client_id"], "client_secret": T["client_secret"],
                            "refresh_token": T["refresh_token"], "grant_type": "refresh_token"}).encode()
TOK = json.load(urllib.request.urlopen(urllib.request.Request(T["token_uri"], data=d), timeout=30))["access_token"]
SID = "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs"
H = {"Authorization": "Bearer " + TOK}

OUT = "/home/hermes/qa-backups"          # deliberately OUTSIDE the repo (holds live settings)
os.makedirs(OUT, exist_ok=True)
stamp = time.strftime("%Y-%m-%dT%H%M%S")
backup = {}

meta = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://sheets.googleapis.com/v4/spreadsheets/%s?fields=sheets.properties" % SID, headers=H), timeout=60))
for s in meta["sheets"]:
    name = s["properties"]["title"]
    rng = "%s!A1:AZ%d" % (name, max(s["properties"]["gridProperties"]["rowCount"], 60))
    u = "https://sheets.googleapis.com/v4/spreadsheets/%s/values/%s" % (SID, urllib.parse.quote(rng))
    backup[name] = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=120)).get("values", [])

path = "%s/demo-tenant-%s.json" % (OUT, stamp)
json.dump(backup, open(path, "w"), indent=1)
os.chmod(path, 0o600)
print("### backup written: %s (%d bytes, mode 600, outside the repo)" % (path, os.path.getsize(path)))
for k, v in backup.items():
    print("   %-16s %d row(s)" % (k, len(v)))

print("\n### VisitorLog — every row, with the row number needed to delete it")
vl = backup["VisitorLog"]
for n, r in enumerate(vl[1:], 2):
    if not any(str(c).strip() for c in r):
        continue
    num = str(r[11]) if len(r) > 11 else "?"
    name = str(r[1])[:24] if len(r) > 1 else "?"
    status = str(r[12]) if len(r) > 12 else "?"
    ts = str(r[0])[:19] if r else "?"
    tag = "TONIGHT-QA" if num.startswith("V-20260913") else ("legacy-test" if num.startswith("V-202608") else "REVIEW")
    print("   row %-3d %-18s %-24s %-12s %-19s  %s" % (n, num, name, status, ts, tag))
print("   total data rows: %d" % sum(1 for r in vl[1:] if any(str(c).strip() for c in r)))

print("\n### EmailQueue — anything queued/unsent?")
eq = backup.get("EmailQueue", [])
qr = [r for r in eq[1:] if any(str(c).strip() for c in r)]
print("   header: %s" % (eq[0] if eq else "?"))
print("   %d populated row(s)" % len(qr))
for r in qr[:10]:
    print("      " + " | ".join(str(c)[:26] for c in r[:8]))

print("\n### CardNo — anything not simply Available?")
cn = backup["CardNo"]
print("   header: %s" % cn[0])
odd = [r for r in cn[1:] if len(r) > 1 and str(r[1]).strip() != "Available"]
for r in odd:
    print("   row %d: %s" % (cn.index(r) + 1, " | ".join(str(x)[:22] for x in r)))
print("   %d row(s) not Available" % len(odd))

print("\n### lookups (should be legitimate config)")
for t in ("Destination", "VisitorType"):
    rows = [r for r in backup.get(t, [])[1:] if any(str(c).strip() for c in r)]
    print("   %-14s %d entry/entries: %s" % (t, len(rows), [r[0] for r in rows][:12]))
