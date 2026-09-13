#!/usr/bin/env python3
"""F5 end-to-end proof: a NORMAL kiosk check-in must provision a real credential.

Uses the portrait this device has already accepted, so a failure can only come
from the wiring (CORS / gateway / device), not from the fixture.
"""
import base64, json, re, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

KIOSK = "http://192.168.2.238:8123/"
PIN = "2345"
ORIGIN = "https://demo.litevm.itt.web.id"   # registration is origin-gated
FACE = base64.b64encode(open("/tmp/face_probe2.jpg", "rb").read()).decode()


def http(method, url, body=None, headers=None, timeout=180):
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else (body.encode() if body else None)
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "EXC: %s" % e


st, cfg = http("GET", KIOSK + "settings.json")
j = json.loads(cfg.lstrip("\ufeff"))
API, SHEET = j["API_BASE"], j["SHEET_ID"]

probe = "QA-%s Provision Probe" % time.strftime("%Y%m%d-%H%M")
payload = {
    "fullName": probe, "idNumber": "QA-PROV-1", "company": "PROBE",
    "destination": "BCA", "visitorType": "Visitor",
    "visitationDate": time.strftime("%Y-%m-%d"),
    "phone": "081200000098", "email": "jarvisbot528@gmail.com",
    "idPhoto": "data:image/jpeg;base64," + FACE,
    "selfie": "data:image/jpeg;base64," + FACE,          # a REAL face this device accepts
    "sheetId": SHEET, "origin": ORIGIN,
}
t = time.time()
st, body = http("POST", API, payload, {"Content-Type": "text/plain", "Origin": ORIGIN})
print("registration: HTTP %s in %.1fs" % (st, time.time() - t))
VN = json.loads(body).get("visitorNumber")
print("visitor: %s" % VN)
if not VN:
    raise SystemExit("registration failed: %s" % body[:200])

console = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context().new_page()
    page.on("console", lambda m: console.append("%s: %s" % (m.type, m.text[:240])))
    page.goto(KIOSK, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#guard-pin-input", timeout=60000)
    time.sleep(18)
    page.fill("#guard-pin-input", PIN)
    page.click("#btn-guard-login")
    page.wait_for_selector("#todays-list", timeout=60000)
    time.sleep(3)
    page.fill("#search-input", VN)
    page.click("#btn-lookup")
    page.wait_for_selector("#lookup-result-section[data-state='found']", timeout=90000)
    page.click("#btn-verify")
    page.wait_for_selector("#confirm-dialog:not(.hidden)", timeout=20000)
    page.click("#btn-confirm-action")
    print("check-in submitted (normal path, no mangling)")

    final, card = "?", None
    for i in range(18):
        time.sleep(5)
        final = page.get_attribute("#lookup-result-section", "data-state")
        claimed = page.inner_text("#success-card-number") if page.query_selector("#success-card-number") else ""
        banner = page.evaluate("(() => { const e=document.querySelector('#ustar-provision-banner'); return e ? !e.classList.contains('hidden') : null; })()")
        print("  t+%3ds state=%-9s card=%-6s provision-banner=%s" % ((i + 1) * 5, final, claimed.strip(), banner))
        if claimed.strip():
            card = claimed.strip()
        if any("provision" in c for c in console) and i >= 3:
            break
    time.sleep(18)   # let the gateway finish enrolling

    print("\n--- console: provisioning lines ---")
    for c in console:
        if "provision" in c.lower() or "access to fetch" in c.lower() or "cors" in c.lower():
            print("  " + c)

    print("\n--- VERDICT ---")
    ok = any("provision succeeded" in c for c in console)
    cors = any("cors" in c.lower() or "access to fetch" in c.lower() for c in console)
    print("kiosk settled state      : %s" % final)
    print("provision SUCCEEDED      : %s" % ("YES" if ok else "NO"))
    print("any CORS block           : %s" % ("yes" if cors else "NO"))
    b.close()

# what the device now holds
print("\n=== device state AFTER ===")
