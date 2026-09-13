#!/usr/bin/env python3
"""Register the bench visitor with Fenky's own face (the selfie the reader will enrol)."""
import base64, json, time, urllib.request, urllib.error

KIOSK = "http://192.168.2.238:8123/"
ORIGIN = "https://demo.litevm.itt.web.id"   # registration is origin-gated
PHOTO = "/home/hermes/.hermes/cache/images/img_0a9db89324cf.jpg"


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
print("photo base64 payload: %.1f KB" % (len(b64) / 1024))

payload = {
    "fullName": "Fenky Tjhang",
    "idNumber": "BENCH-20260913",
    "company": "Structure Research",
    "destination": "BCA",              # → DoorGroupID 2 (in the reader's [2..7] set)
    "visitorType": "Visitor",
    "visitationDate": time.strftime("%Y-%m-%d"),
    "phone": "081200000097",
    "email": "jarvisbot528@gmail.com",
    "idPhoto": "data:image/jpeg;base64," + b64,
    "selfie": "data:image/jpeg;base64," + b64,
    "sheetId": SHEET,
    "origin": ORIGIN,
}
t = time.time()
st, body = http("POST", API, payload, {"Content-Type": "text/plain", "Origin": ORIGIN})
print("registration: HTTP %s in %.1fs" % (st, time.time() - t))
try:
    d = json.loads(body)
except Exception:
    print("non-JSON:", body[:300]); raise SystemExit(1)
print("status :", d.get("status"), "|", d.get("message") or d.get("error") or "")
VN = d.get("visitorNumber")
print("VISITOR:", VN)
if VN:
    st, b = http("GET", "%s?action=lookup&visitorNumber=%s&sheetId=%s" % (API, VN, SHEET))
    v = json.loads(b).get("visitor", {})
    print("lookup : status=%s dest=%s type=%s selfie=%s" % (v.get("status"), v.get("destination"), v.get("visitorType"), "set" if v.get("selfieUrl") else "EMPTY"))
    open("/tmp/bench_visitor.txt", "w").write(VN)
