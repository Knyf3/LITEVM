#!/usr/bin/env python3
"""Work out exactly what is already public vs what tonight's local commits would ADD."""
import json, subprocess, urllib.request

R = "/home/hermes/projects/LITEVM/"
cfg = json.loads(urllib.request.urlopen("http://192.168.2.238:8123/settings.json", timeout=60).read().decode().lstrip("\ufeff"))
SEC, PIN = cfg["LITEVM_SECRET"], cfg["GUARD_PIN"]


def git(*a):
    return subprocess.run(["git"] + list(a), capture_output=True, text=True, cwd=R).stdout


def mask(s):
    for v in (SEC, PIN):
        if v and len(v) > 3:
            s = s.replace(v, "<" + ("SECRET" if v == SEC else "GUARD_PIN") + " REDACTED>")
    return s


print("### which of tonight's files are ALREADY in origin/main?\n")
for f in ("docs/TESTPLAN-FULLSTACK-E2E.md", "apps-script/Code.gs", "apps-script/Code.txt",
          "docs/setup-guide.md", "qa-out/2026-09-13/p9-kiosk-settings.json",
          "qa-out/2026-09-13/f5/f5_cleanup.py"):
    pub = subprocess.run(["git", "cat-file", "-e", "origin/main:" + f], cwd=R,
                         capture_output=True).returncode == 0
    print("  %-48s %s" % (f, "ALREADY PUBLIC (in origin/main)" if pub else "local-only commit — NOT yet public"))

print("\n### is the secret in the version that is ALREADY public?\n")
pub_plan = git("show", "origin/main:docs/TESTPLAN-FULLSTACK-E2E.md")
print("  origin/main TESTPLAN contains the live secret value:  %s" % (SEC in pub_plan))
print("  origin/main TESTPLAN contains the live guard PIN:     %s" % (PIN in pub_plan))
pub_code = git("show", "origin/main:apps-script/Code.gs")
print("  origin/main Code.gs contains the live secret value:   %s" % (SEC in pub_code))
print("  origin/main Code.gs contains the live guard PIN:      %s" % (PIN in pub_code))
pub_cfg = git("show", "origin/main:config.js")
print("  origin/main config.js contains the live secret value: %s" % (SEC in pub_cfg))

print("\n### context of the Code.gs PIN constant (masked)\n")
lines = open(R + "apps-script/Code.gs", errors="ignore").read().split("\n")
for n in (1495, 1496, 1497):
    if n - 1 < len(lines):
        print("  %d| %s" % (n, mask(lines[n - 1].strip())[:150]))

print("\n### context of the TESTPLAN secret lines (masked)\n")
tl = open(R + "docs/TESTPLAN-FULLSTACK-E2E.md", errors="ignore").read().split("\n")
for n in (33, 35, 77):
    print("  %d| %s" % (n, mask(tl[n - 1].strip())[:160]))

print("\n### where does the LIVE pin come from?\n")
for n, l in enumerate(lines, 1):
    if "GUARD_PIN" in l and ("Properties" in l or "getRange" in l or "DEFAULT" in l.upper() or "||" in l or "=" in l):
        print("  %d| %s" % (n, mask(l.strip())[:150]))
