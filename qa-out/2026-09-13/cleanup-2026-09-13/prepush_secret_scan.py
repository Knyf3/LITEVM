#!/usr/bin/env python3
"""Decisive pre-push scan: do LIVE credential VALUES appear anywhere in tracked files?

Reports file, line number and a masked excerpt only — never the value itself.
"""
import json, subprocess, urllib.request

cfg = json.loads(urllib.request.urlopen("http://192.168.2.238:8123/settings.json", timeout=60).read().decode().lstrip("\ufeff"))

# Live secrets, taken from the running kiosk's own settings (never printed).
targets = {}
for k in ("LITEVM_SECRET", "GUARD_PIN", "API_BASE", "SHEET_ID"):
    v = cfg.get(k)
    if v:
        targets[k if k != "API_BASE" else "GAS_EXEC_URL"] = str(v)

# The deployment-id fragment of the exec URL is the part that identifies the app.
if "GAS_EXEC_URL" in targets:
    targets["GAS_DEPLOYMENT_ID"] = targets["GAS_EXEC_URL"].split("/macros/s/")[-1].split("/")[0]

files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd="/home/hermes/projects/LITEVM").stdout.split()

def mask(s):
    return s[:4] + "*" * max(0, len(s) - 8) + s[-4:] if len(s) > 8 else s[0] + "*" * (len(s) - 1)

for label, val in targets.items():
    if not val:
        continue
    hits = []
    for f in files:
        try:
            with open("/home/hermes/projects/LITEVM/" + f, "r", errors="ignore") as fh:
                for n, line in enumerate(fh, 1):
                    if val in line:
                        hits.append((f, n))
        except (IsADirectoryError, FileNotFoundError):
            continue
    print("\n%s  value=%s (len %d)" % (label, mask(val), len(val)))
    if not hits:
        print("   CLEAN — no tracked file contains this value")
    for f, n in hits[:14]:
        print("   LEAK CANDIDATE  %s:%d" % (f, n))
    if len(hits) > 14:
        print("   ... and %d more" % (len(hits) - 14))
