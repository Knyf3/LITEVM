#!/usr/bin/env python3
"""Live F3 controls against the redeployed backend (Code 1.21.0)."""
import json, time, urllib.request, urllib.error

KIOSK = "http://192.168.2.238:8123/"


def hget(u, t=240):
    with urllib.request.urlopen(u, timeout=t) as r:
        return r.read().decode("utf-8", "replace")


def post(url, payload, origin=None):
    h = {"Content-Type": "text/plain"}
    if origin:
        h["Origin"] = origin
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


cfg = json.loads(hget(KIOSK + "settings.json").lstrip("\ufeff"))
API, SHEET, PIN = cfg["API_BASE"], cfg["SHEET_ID"], cfg["GUARD_PIN"]
PORTAL = "https://demo.litevm.itt.web.id"
today = time.strftime("%Y-%m-%d")
report = {"action": "report", "sheetId": SHEET, "fromDate": today, "toDate": today}


def show(label, st, body, want=None):
    try:
        d = json.loads(body)
        if isinstance(d, dict) and d.get("status") == "ok" and "rows" in d:
            summary = "status=ok rows=%d" % len(d.get("rows") or [])
        elif isinstance(d, dict) and d.get("status") == "ok" and "version" in d:
            summary = "status=ok version=%s guardPinPublished=%s" % (d.get("version"), "guardPin" in d)
        else:
            summary = json.dumps(d)[:110]
    except Exception:
        summary = body[:90]
    ok = "" if want is None else ("  <<< " + ("OK" if want in summary else "UNEXPECTED"))
    print("  %-46s HTTP %-3s %s%s" % (label, st, summary, ok))


print("### 1. deployment confirmed by the backend itself")
try:
    boot = hget(API + "?action=bootstrap&sheetId=" + SHEET)
    d = json.loads(boot)
    print("  bootstrap      HTTP 200  status=%s version=%s guardPinPublished=%s" % (
        d.get("status"), d.get("version"), "guardPin" in (d.get("config") or {})))
except Exception as e:
    print("  bootstrap failed:", e)

print("\n### 2. guardLogin (server-side PIN)")
st, b = post(API, {"action": "guardLogin", "sheetId": SHEET, "pin": PIN, "origin": PORTAL})
show("correct PIN", st, b, "status=ok")
for i in range(3):
    st, b = post(API, {"action": "guardLogin", "sheetId": SHEET, "pin": "9999", "origin": PORTAL})
show("wrong PIN (x3)", st, b, "INVALID_PIN")
st, b = post(API, {"action": "guardLogin", "sheetId": SHEET, "pin": PIN, "origin": PORTAL})
show("correct PIN again (counter resets)", st, b, "status=ok")

print("\n### 3. report — the defect and the fix")
st, b = post(API, dict(report, origin="http://evil.example", guardPin=PIN), "http://evil.example")
show("foreign origin + valid PIN", st, b, "not available from this location")
st, b = post(API, dict(report, guardPin=PIN), PORTAL)
show("allow-listed origin + valid PIN", st, b, "rows=")
st, b = post(API, dict(report, origin=PORTAL), PORTAL)
show("no PIN at all (the old hole)", st, b, "GUARD_UNAUTHORIZED")
st, b = post(API, dict(report, origin=PORTAL, guardPin="9999"), PORTAL)
show("wrong PIN", st, b, "GUARD_UNAUTHORIZED")
st, b = post(API, {"mode": "signOutByCard", "sheetId": SHEET, "cardNo": "5001"})
show("machine caller (signOutByCard) not PIN-gated", st, b, "LITEVM_UNAUTHORIZED")

print("\n### 4. config no longer publishes the PIN")
st, b = post(API, {"action": "guardLogin", "sheetId": SHEET, "pin": PIN})
cfgv = json.loads(hget(API + "?action=config&sheetId=" + SHEET))
print("  keys:", ", ".join(sorted(k for k in cfgv if k != "status")))
print("  guardPin present? %s  <<< %s" % ("guardPin" in cfgv, "OK" if "guardPin" not in cfgv else "STILL PUBLISHED"))
