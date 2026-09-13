#!/usr/bin/env python3
"""Post-bench verification: did the reader give the face back, and is the card released?"""
import json, time, urllib.request, urllib.parse, urllib.error

R = "http://192.168.2.211:8090"
P = "admin123"
KIOSK = "http://192.168.2.238:8123/"


def dget(path):
    with urllib.request.urlopen("%s/%s" % (R, path), timeout=25) as r:
        return r.status, json.loads(r.read().decode("utf-8", "replace"))


def dpost(path, fields):
    f = dict(fields); f["pass"] = P
    req = urllib.request.Request("%s/%s" % (R, path), data=urllib.parse.urlencode(f).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")


def hget(url, t=240):
    try:
        with urllib.request.urlopen(url, timeout=t) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        return "EXC: %s" % e


st, info = dget("device/information?pass=" + P)
d = info.get("data", {})
print("### POST-BENCH DEVICE COUNTS (pre-bench baseline: person=2 face=2 finger=3; during: 3/3/3)")
print("   person=%s face=%s finger=%s  (%s)  -> %s" % (
    d.get("personCount"), d.get("faceCount"), d.get("fingerCount"), d.get("time") or "",
    "DE-PROVISIONED ✅" if str(d.get("personCount")) == "2" and str(d.get("faceCount")) == "2" else "STILL ENROLLED ⚠"))

st, res = dpost("person/findByPage", {"personId": "5001", "index": 0, "length": 5})
infos = (res.get("data") or {}).get("personInfos") or []
print("\n### CARD 5001 ON THE READER: %d record(s) -> %s" % (len(infos), "REMOVED ✅" if not infos else "STILL PRESENT ⚠ " + json.dumps(infos)[:200]))

print("\n### RECOGNITION RECORDS (findRecords)")
rec = None
for meth, path, f in (("GET", "newFindRecords", {"startTime": 0, "endTime": 0, "index": 0, "length": 10}),
                      ("POST", "newFindRecords", {"startTime": 0, "endTime": 0, "index": 0, "length": 10})):
    f = dict(f); f["pass"] = P
    try:
        if meth == "GET":
            with urllib.request.urlopen("%s/%s?%s" % (R, path, urllib.parse.urlencode(f)), timeout=25) as r:
                b = r.read().decode("utf-8", "replace")
        else:
            with urllib.request.urlopen(urllib.request.Request("%s/%s" % (R, path), data=urllib.parse.urlencode(f).encode(),
                                         headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=25) as r:
                b = r.read().decode("utf-8", "replace")
        j = json.loads(b)
        print("   %-4s -> success=%s count=%s" % (meth, j.get("success"), j.get("count")))
        if j.get("count"):
            rec = j
            break
    except Exception as e:
        print("   %-4s -> %s" % (meth, e))
if rec:
    data = rec.get("data")
    rows = (data.get("records") or data.get("list")) if isinstance(data, dict) else data
    for r_ in (rows or [])[:5]:
        t = r_.get("time")
        print("   REC card=%s name=%s at=%s type=%s sim=%s" % (
            r_.get("personId"), r_.get("personName"),
            time.strftime("%H:%M:%S", time.localtime(int(t) / 1000)) if t else "?",
            r_.get("type") or r_.get("recognitionType"), r_.get("similarity") or r_.get("score")))

cfg = json.loads(hget(KIOSK + "settings.json").lstrip("\ufeff"))
API, SHEET = cfg["API_BASE"], cfg["SHEET_ID"]

print("\n### VISITOR RECORD V-20260913-009 (full field set)")
b = hget("%s?action=lookup&visitorNumber=V-20260913-009&sheetId=%s" % (API, SHEET))
v = json.loads(b).get("visitor", {})
for k in sorted(v):
    if any(s in k.lower() for s in ("status", "card", "time", "sign", "visitor")):
        print("   %-22s = %s" % (k, v[k]))

print("\n### CARD POOL")
b = hget("%s?action=cardpool&sheetId=%s" % (API, SHEET))
j = json.loads(b)
print("   keys:", [k for k in j.keys()])
print("   " + json.dumps({k: val for k, val in j.items() if not isinstance(val, (list, dict))})[:400])
