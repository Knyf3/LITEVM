#!/usr/bin/env python3
"""Bench evidence: recognition record -> sign-out -> card release -> de-provision."""
import json, time, urllib.request, urllib.parse, urllib.error

R = "http://192.168.2.211:8090"
PASS = "admin123"
KIOSK = "http://192.168.2.238:8123/"


def dev(path, fields, get=False):
    fields = dict(fields); fields["pass"] = PASS
    if get:
        url = "%s/%s?%s" % (R, path, urllib.parse.urlencode(fields))
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request("%s/%s" % (R, path), data=urllib.parse.urlencode(fields).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return "HTTP %s %s" % (e.code, e.read().decode("utf-8", "replace")[:200])


def http_get(url, timeout=180):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        return "EXC: %s" % e


print("### 1. READER RECOGNITION RECORDS (newFindRecords)")
raw = dev("newFindRecords", {"startTime": 0, "endTime": 0, "index": 0, "length": 20})
try:
    d = json.loads(raw)
    print("   success=%s code=%s count=%s" % (d.get("success"), d.get("code"), d.get("count")))
    data = d.get("data")
    recs = []
    if isinstance(data, dict):
        recs = data.get("records") or data.get("list") or []
    elif isinstance(data, list):
        recs = data
    for r in recs[:6]:
        t = r.get("time") or r.get("recognitionTime")
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(t))) if t else "?"
        print("   REC: card=%s name=%s at=%s sim=%s type=%s dir=%s" % (
            r.get("personId") or r.get("cardNo"), r.get("personName"), ts,
            r.get("similarity") or r.get("score"), r.get("recognitionType") or r.get("type"), r.get("direction")))
except Exception as e:
    print("   parse issue: %s | raw: %s" % (e, raw[:400]))

print("\n### 2. DEVICE COUNTS (de-provision check: baseline was person=2 face=2 finger=3)")
for p in ("person/count", "face/count", "finger/count"):
    b = dev(p, {}, get=True)
    try:
        print("   %-14s -> %s" % (p, json.loads(b).get("data")))
    except Exception:
        print("   %-14s -> %s" % (p, b[:80]))
b = dev("person/find", {"id": "5001"}, get=True)
print("   person 5001 still present? -> %s" % b[:160])

print("\n### 3. GATEWAY: sign-out poll")
for path in ("/api/litevm/signout/status", "/api/litevm/status"):
    print("   GET %s -> %s" % (path, http_get("http://192.168.2.194:8091" + path, 60)[:300]))

print("\n### 4. SHEET via GAS (visitor V-20260913-009)")
cfg = json.loads(http_get(KIOSK + "settings.json").lstrip("\ufeff"))
API, SHEET = cfg["API_BASE"], cfg["SHEET_ID"]
b = http_get("%s?action=lookup&visitorNumber=V-20260913-009&sheetId=%s" % (API, SHEET), 240)
try:
    v = json.loads(b).get("visitor", {})
    print("   status=%s card=%s signOutTime=%s destination=%s" % (
        v.get("status"), v.get("cardNumber"), v.get("signOutTime") or v.get("timeOut"), v.get("destination")))
except Exception:
    print("   raw:", b[:300])

print("\n### 5. CARD POOL")
b = http_get("%s?action=cardpool&sheetId=%s" % (API, SHEET), 240)
try:
    d = json.loads(b); print("   status=%s totalRows=%s available=%s (was 214 before the bench)" % (
        d.get("status"), d.get("totalRows"), d.get("available") or d.get("availableCount")))
except Exception:
    print("   raw:", b[:300])
