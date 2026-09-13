#!/usr/bin/env python3
"""Enumerate exactly which unpushed files carry live values, and which already-public
files carry them in a real (non-substring) context."""
import json, subprocess, urllib.request, re

R = "/home/hermes/projects/LITEVM/"
cfg = json.loads(urllib.request.urlopen("http://192.168.2.238:8123/settings.json", timeout=60).read().decode().lstrip("\ufeff"))
SEC, PIN = cfg["LITEVM_SECRET"], cfg["GUARD_PIN"]


def git(*a):
    return subprocess.run(["git"] + list(a), capture_output=True, text=True, cwd=R).stdout


def mask(s):
    for v, n in ((SEC, "SECRET"), (PIN, "GUARD_PIN")):
        if v:
            s = s.replace(v, "<%s REDACTED>" % n)
    return s


print("### 1. what keys do the QA config dumps carry? (values masked)")
for f in ("qa-out/2026-09-13/p9-kiosk-settings.json", "qa-out/2026-09-13/p10-tenant-settings.json"):
    try:
        d = json.load(open(R + f))
    except Exception as e:
        print("  %s: unreadable (%s)" % (f, e)); continue
    print("  %s" % f)
    for k, v in (d.items() if isinstance(d, dict) else []):
        vs = json.dumps(v)
        print("      %-22s %s" % (k, mask(vs)[:88]))

print("\n### 2. already-public files: is the PIN there in a REAL context (not a digit run)?")
for f in ("apps-script/Code.gs", "docs/setup-guide.md", "apps-script/Code.txt"):
    txt = git("show", "origin/main:" + f)
    ctx = [mask(l.strip())[:120] for l in txt.split("\n") if PIN in l and re.search(r"(GUARD_PIN|pin|PIN)\s*[:=]", l)]
    print("  %-34s %d real-context hit(s)" % (f, len(ctx)))
    for c in ctx[:4]:
        print("       " + c)

print("\n### 3. unpushed files carrying the SECRET value (these MUST be sanitised before push)")
for f in git("ls-files").split():
    if f.startswith(("qa-out/", "docs/", "marketing/")) or f.endswith((".gs", ".txt", ".md", ".py", ".json", ".js")):
        try:
            txt = open(R + f, errors="ignore").read()
        except Exception:
            continue
        if SEC in txt:
            pub = subprocess.run(["git", "cat-file", "-e", "origin/main:" + f], cwd=R, capture_output=True).returncode == 0
            pubnow = SEC in git("show", "origin/main:" + f) if pub else False
            print("  %-52s already_public=%s already_public_WITH_secret=%s" % (f, pub, pubnow))
