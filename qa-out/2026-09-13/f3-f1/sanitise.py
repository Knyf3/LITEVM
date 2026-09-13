#!/usr/bin/env python3
"""Sanitise live credential values out of the yet-to-be-pushed files."""
import json, re, subprocess, urllib.request

R = "/home/hermes/projects/LITEVM/"
cfg = json.loads(urllib.request.urlopen("http://192.168.2.238:8123/settings.json", timeout=60).read().decode().lstrip("\ufeff"))
SEC, PIN = cfg["LITEVM_SECRET"], cfg["GUARD_PIN"]

FILES = ["docs/TESTPLAN-FULLSTACK-E2E.md", "qa-out/2026-09-13/f5/f5_cleanup.py",
         "qa-out/2026-09-13/p10-tenant-settings.json", "qa-out/2026-09-13/p9-kiosk-settings.json"]

for f in FILES:
    p = R + f
    try:
        t = open(p, errors="ignore").read()
    except FileNotFoundError:
        print("  missing: %s" % f); continue
    n_sec, n_pin = t.count(SEC), t.count(PIN)
    t = t.replace(SEC, "<REDACTED-SECRET>")
    # Only the PIN, and only where it is an assignment — never inside an unrelated digit run.
    t = re.sub(r'(?i)((?:guard[_-]?pin|"pin"|\'pin\')\s*[:=]\s*["\']?)' + re.escape(PIN), r"\1<REDACTED-PIN>", t)
    t = t.replace("pin: '%s'" % PIN, "pin: os.environ.get('LITEVM_GUARD_PIN', '')")
    t = t.replace('pin="%s"' % PIN, 'pin=os.environ.get("LITEVM_GUARD_PIN", "")')
    open(p, "w").write(t)
    print("  %-46s secret x%d, pin x%d -> redacted" % (f, n_sec, n_pin))

# Re-check: no live secret anywhere in the tracked tree; PIN only where redacted.
print("\n=== re-scan ===")
bad = []
for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=R).stdout.split():
    try:
        t = open(R + f, errors="ignore").read()
    except Exception:
        continue
    if SEC in t:
        bad.append(f)
print("  files still containing the live secret: %d %s" % (len(bad), bad or "(clean)"))
ctx = 0
for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=R).stdout.split():
    try:
        t = open(R + f, errors="ignore").read()
    except Exception:
        continue
    for line in t.split("\n"):
        if PIN in line and re.search(r"(?i)(guard[_-]?pin|\"pin\")\s*[:=]\s*[\"']?" + PIN, line):
            ctx += 1
            print("  PIN still in context: %s" % f)
print("  live PIN remaining in a guard-pin assignment: %d" % ctx)

# Future-proof: never commit a raw settings dump again.
gi = open(R + ".gitignore").read() if __import__("os").path.exists(R + ".gitignore") else ""
add = [x for x in ("**/kiosk_settings*.json", "**/*kiosk-settings*.json", "**/tenant-settings*.json",
                   "**/Settings.local.json") if x not in gi]
if add:
    open(R + ".gitignore", "a").write("\n# QA config dumps carry live tenant values — never commit raw\n" + "\n".join(add) + "\n")
    print("  .gitignore: added %s" % ", ".join(add))
