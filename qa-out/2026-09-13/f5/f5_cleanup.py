#!/usr/bin/env python3
"""Clean up the F5 test artifacts:
   - sign out the probe visitors still holding cards (releases the card pool)
   - delete the test persons from the reader (a released card must NOT leave a
     live face/QR credential on the door)
   - leave the bench visitor (card 5061) untouched
"""
import json, time, urllib.request, urllib.error

KIOSK = "http://192.168.2.238:8123/"
GW = "http://192.168.2.194:8091"
SECRET = "<REDACTED-SECRET>"
ORIGIN = "https://demo.litevm.itt.web.id"


def http(method, url, body=None, headers=None, timeout=120):
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
H = {"Content-Type": "text/plain", "Origin": ORIGIN}

print("=== 1. release the cards my tests hold ===")
for vn in ["V-20260913-006", "V-20260913-007"]:
    st, b = http("GET", "%s?action=lookup&visitorNumber=%s&sheetId=%s" % (API, vn, SHEET))
    v = json.loads(b).get("visitor", {})
    card = v.get("cardNo")
    print("  %s status=%s card=%s" % (vn, v.get("status"), card))
    if v.get("status") == "Checked In":
        st, b = http("POST", API, {"mode": "updateStatus", "visitorNumber": vn,
                                   "status": "Signed Out", "sheetId": SHEET, "origin": ORIGIN}, H)
        print("    sign-out -> HTTP %s %s" % (st, b[:120]))

print("\n=== 2. delete the test persons from the reader ===")
for card in ["5001", "5002"]:
    st, b = http("DELETE", "%s/api/litevm/persons/%s" % (GW, card), headers={"X-Litevm-Secret": SECRET})
    print("  DELETE persons/%s -> HTTP %s %s" % (card, st, b[:160].replace("\n", " ")))

print("\n=== 3. device state (expect person=2 face=2, i.e. the bench visitor only) ===")
