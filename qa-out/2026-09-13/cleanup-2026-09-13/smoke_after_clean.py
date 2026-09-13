#!/usr/bin/env python3
"""Post-cleanup smoke test: does the emptied log still take a write, and land in the right row?"""
import base64, json, re, time, urllib.request, urllib.error, urllib.parse

KIOSK = "http://192.168.2.238:8123/"
ORIGIN = "https://demo.litevm.itt.web.id"
PHOTO = "/home/hermes/.hermes/cache/images/img_0a9db89324cf.jpg"
TOK = json.load(open("/home/hermes/.hermes/google_token.json"))
d = urllib.parse.urlencode({"client_id": TOK["client_id"], "client_secret": TOK["client_secret"],
                            "refresh_token": TOK["refresh_token"], "grant_type": "refresh_token"}).encode()
AT = json.load(urllib.request.urlopen(urllib.request.Request(TOK["token_uri"], data=d), timeout=30))["access_token"]
SID = "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs"
GH = {"Authorization": "Bearer " + AT}


def http(method, url, body=None, headers=None, timeout=300):
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "EXC: %s" % e


cfg = json.loads(http("GET", KIOSK + "settings.json")[1].lstrip("\ufeff"))
API, SHEET = cfg["API_BASE"], cfg["SHEET_ID"]

b64 = base64.b64encode(open(PHOTO, "rb").read()).decode()
payload = {"fullName": "SMOKE TEST (cleanup verification)", "idNumber": "SMOKE-20260913", "company": "Hermes QA",
           "destination": "BCA", "visitorType": "Visitor", "visitationDate": time.strftime("%Y-%m-%d"),
           "phone": "081200000000", "email": "jarvisbot528@gmail.com",
           "idPhoto": "data:image/jpeg;base64," + b64, "selfie": "data:image/jpeg;base64," + b64,
           "sheetId": SHEET, "origin": ORIGIN}
t0 = time.time()
st, body = http("POST", API, payload, {"Content-Type": "text/plain", "Origin": ORIGIN})
res = json.loads(body) if body.startswith("{") else {}
print("### registration: HTTP %s in %.1fs -> status=%s visitor=%s" % (
    st, time.time() - t0, res.get("status"), res.get("visitorNumber")))

# Where did it land?
rows = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://sheets.googleapis.com/v4/spreadsheets/%s/values/VisitorLog!A1:O6" % SID, headers=GH), timeout=60)).get("values", [])
for i, r in enumerate(rows, 1):
    label = "HEADER" if i == 1 else ("row %d" % i)
    num = r[11] if len(r) > 11 else ""
    print("   %-8s %-22s %-32s status=%s" % (label, num, str(r[1])[:32] if len(r) > 1 else "", r[12] if len(r) > 12 else ""))
print("   -> appended at row 2 (immediately after the header): %s" % (
    len(rows) > 1 and str(rows[1][11]).startswith("V-20260913")))

# Report sees exactly one
rb = json.dumps({"action": "report", "sheetId": SHEET, "fromDate": time.strftime("%Y-%m-%d"),
                 "toDate": time.strftime("%Y-%m-%d"), "origin": ORIGIN, "guardPin": cfg["GUARD_PIN"]}).encode()
st2, b2 = http("POST", API, rb, {"Content-Type": "text/plain", "Origin": ORIGIN})
r2 = json.loads(b2) if b2.startswith("{") else {}
print("### report: status=%s visitors=%d (expect 1)" % (r2.get("status"), len(r2.get("visitors") or [])))

# --- clean up the smoke test -------------------------------------------------
print("\n### cleaning the smoke test back out")
files = []
for i in (9, 10):
    if len(rows) > 1 and len(rows[1]) > i and "drive.google.com" in str(rows[1][i]):
        m = re.search(r"/d/([A-Za-z0-9_-]+)", str(rows[1][i]))
        if m:
            files.append(m.group(1))
for fid in files:
    try:
        urllib.request.urlopen(urllib.request.Request(
            "https://www.googleapis.com/drive/v3/files/%s" % fid, headers={**GH, "Content-Type": "application/json"},
            method="PATCH", data=json.dumps({"trashed": True}).encode()), timeout=60)
    except Exception as e:
        print("   drive %s: %s" % (fid[:10], e))
print("   drive photos trashed: %d" % len(files))

urllib.request.urlopen(urllib.request.Request(
    "https://sheets.googleapis.com/v4/spreadsheets/%s/values/%s:clear" % (SID, urllib.parse.quote("VisitorLog!A2:O31")),
    headers={**GH, "Content-Type": "application/json"}, method="POST", data=b"{}"), timeout=90)

rows2 = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://sheets.googleapis.com/v4/spreadsheets/%s/values/VisitorLog!A1:O6" % SID, headers=GH), timeout=60)).get("values", [])
data_rows = [r for r in rows2[1:] if any(str(c).strip() for c in r)]
print("   VisitorLog data rows now: %d" % len(data_rows))
st3, b3 = http("POST", API, rb, {"Content-Type": "text/plain", "Origin": ORIGIN})
r3 = json.loads(b3) if b3.startswith("{") else {}
print("   report now: authority=%s visitors=%d (expect 0)" % (r3.get("status"), len(r3.get("visitors") or [])))
