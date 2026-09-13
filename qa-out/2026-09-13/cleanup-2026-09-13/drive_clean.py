#!/usr/bin/env python3
"""Trash the Drive photos referenced by the deleted visits (trash = recoverable for 30 days)."""
import json, glob, re, urllib.request, urllib.parse

T = json.load(open("/home/hermes/.hermes/google_token.json"))
d = urllib.parse.urlencode({"client_id": T["client_id"], "client_secret": T["client_secret"],
                            "refresh_token": T["refresh_token"], "grant_type": "refresh_token"}).encode()
TOK = json.load(urllib.request.urlopen(urllib.request.Request(T["token_uri"], data=d), timeout=30))["access_token"]
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}

backup = sorted(glob.glob("/home/hermes/qa-backups/demo-tenant-*.json"))[-1]
b = json.load(open(backup))
ids, seen = [], set()
for r in b["VisitorLog"][1:]:
    for i in (9, 10):                       # ID Photo, Selfie
        if len(r) > i and "drive.google.com" in str(r[i]):
            m = re.search(r"/d/([A-Za-z0-9_-]+)", str(r[i]))
            if m and m.group(1) not in seen:
                seen.add(m.group(1)); ids.append(m.group(1))

print("### %d unique photo file(s) referenced by the %d deleted visit rows" % (len(ids), len(b["VisitorLog"]) - 1))
ok, gone, denied, other = 0, 0, [], {}
for n, fid in enumerate(ids, 1):
    try:
        req = urllib.request.Request("https://www.googleapis.com/drive/v3/files/%s?fields=id,name,trashed" % fid,
                                     headers=H, method="PATCH",
                                     data=json.dumps({"trashed": True}).encode())
        res = json.load(urllib.request.urlopen(req, timeout=60))
        ok += 1
    except urllib.error.HTTPError as e:
        code = e.code
        if code == 404:
            gone += 1
        else:
            other.setdefault(code, 0)
            other[code] += 1
            if len(denied) < 3:
                denied.append("%s -> HTTP %s %s" % (fid[:12], code, e.read().decode()[:120]))
    except Exception as e:
        other.setdefault("exc", 0); other["exc"] += 1

print("   trashed: %d | already gone: %d | other: %s" % (ok, gone, other or "none"))
for x in denied:
    print("     " + x)

# confirm from the source of truth
left = 0
for fid in ids:
    try:
        q = urllib.request.Request("https://www.googleapis.com/drive/v3/files/%s?fields=id,trashed" % fid, headers=H)
        if json.load(urllib.request.urlopen(q, timeout=30)).get("trashed") is False:
            left += 1
    except urllib.error.HTTPError:
        pass
print("   still live (not trashed): %d of %d" % (left, len(ids)))
