#!/usr/bin/env python3
"""Clean the demo tenant. VisitorLog is cleared (Sheets forbids deleting all non-frozen rows),
EmailQueue rows are deleted, card pool released."""
import json, urllib.request, urllib.parse

T = json.load(open("/home/hermes/.hermes/google_token.json"))
d = urllib.parse.urlencode({"client_id": T["client_id"], "client_secret": T["client_secret"],
                            "refresh_token": T["refresh_token"], "grant_type": "refresh_token"}).encode()
TOK = json.load(urllib.request.urlopen(urllib.request.Request(T["token_uri"], data=d), timeout=30))["access_token"]
SID = "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs"
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}


def api(url, method="GET", body=None, raw=False):
    r = urllib.request.Request(url, headers=H, method=method, data=json.dumps(body).encode() if body is not None else None)
    try:
        out = urllib.request.urlopen(r, timeout=120).read().decode()
        return out if raw else json.loads(out or "{}")
    except urllib.error.HTTPError as e:
        print("  !! HTTP %s on %s %s" % (e.code, method, url[:100]))
        print("     " + e.read().decode()[:300])
        return None


def vals(rng):
    return api("https://sheets.googleapis.com/v4/spreadsheets/%s/values/%s" % (SID, urllib.parse.quote(rng))).get("values", [])


meta = api("https://sheets.googleapis.com/v4/spreadsheets/%s?fields=sheets.properties" % SID)
ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta["sheets"]}

# 1. VisitorLog — clear, cannot delete (Sheets refuses to remove all non-frozen rows)
n = sum(1 for r in vals("VisitorLog!A1:AJ40")[1:] if any(str(c).strip() for c in r))
api("https://sheets.googleapis.com/v4/spreadsheets/%s/values/%s:clear" % (SID, urllib.parse.quote("VisitorLog!A2:AJ31")), "POST", {})
print("### VisitorLog: cleared %d data row(s) (A2:AJ31)" % n)

# 2. EmailQueue — real rows can be deleted here
eq = [i for i, r in enumerate(vals("EmailQueue!A1:H40")[1:], 2) if any(str(c).strip() for c in r)]
if eq:
    api("https://sheets.googleapis.com/v4/spreadsheets/%s:batchUpdate" % SID, "POST",
        {"requests": [{"deleteDimension": {"range": {"sheetId": ids["EmailQueue"], "dimension": "ROWS",
                                                     "startIndex": 1, "endIndex": max(eq)}}}]})
print("### EmailQueue: deleted %d record(s)" % len(eq))

# 3. Card pool
cn = vals("CardNo!A1:E260")
released = 0
for i, r in enumerate(cn[1:], 2):
    if len(r) > 1 and str(r[1]).strip() not in ("", "Available"):
        api("https://sheets.googleapis.com/v4/spreadsheets/%s/values/%s?valueInputOption=RAW" % (
            SID, urllib.parse.quote("CardNo!B%d:D%d" % (i, i))), "PUT", {"values": [["Available", "", ""]]})
        released += 1
        print("### CardNo: row %d card %s -> Available" % (i, r[0]))

# 4. verify
print("\n### VERIFY")
vl = vals("VisitorLog!A1:AJ40")
print("  VisitorLog data rows   : %d (header present: %s)" % (
    sum(1 for r in vl[1:] if any(str(c).strip() for c in r)), bool(vl and vl[0])))
print("  EmailQueue rows        : %d" % sum(1 for r in vals("EmailQueue!A1:H40")[1:] if any(str(c).strip() for c in r)))
cn2 = vals("CardNo!A1:E260")
from collections import Counter
print("  CardNo states          : %s" % dict(Counter(str(r[1]).strip() if len(r) > 1 else "" for r in cn2[1:] if any(str(c).strip() for c in r))))
st = vals("Settings!A1:B10")
print("  Settings intact        : %d key(s): %s" % (len(st), [r[0] for r in st]))
print("  Destination entries    : %d" % sum(1 for r in vals("Destination!A1:A20")[1:] if any(str(c).strip() for c in r)))
print("  VisitorType entries    : %d" % sum(1 for r in vals("VisitorType!A1:A20")[1:] if any(str(c).strip() for c in r)))
