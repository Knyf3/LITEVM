#!/usr/bin/env python3
"""Fetch the known-good selfie of V-20260913-003 (the portrait this device already
accepted) so a fresh probe can prove the full provisioning chain end to end."""
import json, re, urllib.parse, urllib.request

KS = "http://192.168.2.238:8123/settings.json"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"


def get(url, binary=False, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")


cfg = json.loads(get(KS).lstrip("\ufeff"))
API, SHEET = cfg["API_BASE"], cfg["SHEET_ID"]

# the selfie URL recorded for the visitor whose face already enrolled (person 5061)
body = get("%s?action=lookup&visitorNumber=%s&sheetId=%s" % (API, "V-20260913-003", SHEET))
v = json.loads(body).get("visitor", {})
url = v.get("selfieUrl") or ""
print("source selfie URL host: %s" % urllib.parse.urlparse(url).netloc)
m = re.search(r"/(?:d/|id=)([A-Za-z0-9_-]{20,})", url)
print("file id extracted: %s" % ("yes" if m else "NO"))
if not m:
    raise SystemExit("cannot extract a Drive file id from the selfie URL")
fid = m.group(1)

for tmpl in ("https://lh3.googleusercontent.com/d/%s=w1200",
             "https://drive.google.com/uc?export=download&id=%s"):
    u = tmpl % fid
    try:
        data = get(u, binary=True, timeout=90)
        head = data[:3]
        print("  %-58s -> %d bytes, magic=%r" % (urllib.parse.urlparse(u).netloc + urllib.parse.urlparse(u).path[:26], len(data), head))
        if head[:2] == b"\xff\xd8" or head[:8] == b"\x89PNG\r\n\x1a\n":
            open("/tmp/face_real.jpg", "wb").write(data)
            print("SAVED /tmp/face_real.jpg (%d bytes)" % len(data))
            break
    except Exception as e:
        print("  %s -> %s" % (u[:60], e))
