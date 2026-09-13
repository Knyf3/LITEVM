#!/usr/bin/env python3
"""Is the live portal report page actually broken until report.js is pushed? Prove it."""
import json, time, urllib.request
from playwright.sync_api import sync_playwright

URL = "https://demo.litevm.itt.web.id/report.html"
KIOSK = "http://192.168.2.238:8123/"
PIN = json.loads(urllib.request.urlopen(KIOSK + "settings.json", timeout=60).read().decode("utf-8", "replace").lstrip("\ufeff"))["GUARD_PIN"]

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context().new_page()
    console = []
    page.on("console", lambda m: console.append("%s: %s" % (m.type, m.text[:160])))
    page.on("request", lambda r: console.append("REQ guardLogin") if "guardLogin" in r.url else None)

    page.goto(URL, wait_until="domcontentloaded", timeout=90000)
    print("loaded: %s" % page.title())
    # The report page attaches its PIN handler only after its config fetch settles.
    for i in range(12):
        time.sleep(6)
        vis = page.evaluate("(() => { const o=document.querySelector('#pin-overlay'); return o ? getComputedStyle(o).display !== 'none' : null; })()")
        if vis:
            break
    print("pin overlay visible: %s" % vis)

    page.fill("#pin-input", PIN)
    page.keyboard.press("Enter")
    time.sleep(15)
    err = page.evaluate("(() => { const e=document.querySelector('#pin-error'); return e ? {shown: getComputedStyle(e).display !== 'none', text: e.textContent} : null; })()")
    main = page.evaluate("(() => { const m=document.querySelector('#main-content'); return m ? getComputedStyle(m).display !== 'none' : null; })()")
    print("after entering the CORRECT pin -> error=%s | main content visible=%s" % (err, main))
    print("guardLogin requested? %s" % any("guardLogin" in c for c in console))
    for c in console[:6]:
        print("   console: " + c)
    b.close()
