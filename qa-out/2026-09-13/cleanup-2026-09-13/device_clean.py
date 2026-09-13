#!/usr/bin/env python3
"""Device clean-down: clear recognition records, confirm the enrolment baseline."""
import json, urllib.request, urllib.parse, urllib.error

R = "http://192.168.2.211:8090"
P = __import__("os").environ.get("UNIUBI_PASS", "")   # never commit the device password


def call(path, fields=None, method="GET"):
    f = dict(fields or {}); f["pass"] = P
    if method == "GET":
        url = "%s/%s?%s" % (R, path, urllib.parse.urlencode(f))
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request("%s/%s" % (R, path), data=urllib.parse.urlencode(f).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        return {"__http": e.code, "body": e.read().decode("utf-8", "replace")[:200]}
    except Exception as e:
        return {"__exc": str(e)}


info = call("device/information").get("data", {})
print("### BEFORE")
print("   person=%s face=%s finger=%s   baseline is person=2 face=2 finger=3" % (
    info.get("personCount"), info.get("faceCount"), info.get("fingerCount")))

rec = call("newFindRecords", {"startTime": 0, "endTime": 0, "index": 0, "length": 50})
print("   recognition records: success=%s count=%s" % (rec.get("success"), rec.get("count")))

print("\n### CLEARING recognition records")
res = call("newDeleteRecords", None, "POST")
print("   POST newDeleteRecords -> %s" % json.dumps(res)[:200])

print("\n### AFTER")
info2 = call("device/information").get("data", {})
print("   person=%s face=%s finger=%s" % (info2.get("personCount"), info2.get("faceCount"), info2.get("fingerCount")))
rec2 = call("newFindRecords", {"startTime": 0, "endTime": 0, "index": 0, "length": 50})
print("   recognition records: success=%s count=%s" % (rec2.get("success"), rec2.get("count")))
for c in ("5001", "5021", "5061"):
    f = call("person/find", {"personId": c})          # GET on this firmware
    infos = (f.get("data") or {}).get("personInfos") or []
    print("   card %-5s on reader: %d record(s) %s" % (c, len(infos), "clean" if not infos else "PRESENT"))
base = str(info2.get("personCount")) == "2" and str(info2.get("faceCount")) == "2"
print("\n   BASELINE RESTORED: %s" % ("YES" if base and not (rec2.get("count") or 0) else "CHECK — see above"))
