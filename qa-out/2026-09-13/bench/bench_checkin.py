#!/usr/bin/env python3
"""Bench step: check the registered visitor in at the kiosk 1.0.2 and watch provisioning."""
import json, re, time, urllib.request
from playwright.sync_api import sync_playwright

KIOSK = "http://192.168.2.238:8123/"
PIN = "2345"
VN = open("/tmp/bench_visitor.txt").read().strip()

console = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context().new_page()
    page.on("console", lambda m: console.append("%s: %s" % (m.type, m.text[:220])))
    page.goto(KIOSK, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#guard-pin-input", timeout=60000)
    time.sleep(14)
    page.fill("#guard-pin-input", PIN)
    page.click("#btn-guard-login")
    page.wait_for_selector("#todays-list", timeout=60000)
    time.sleep(3)

    page.fill("#search-input", VN)
    page.click("#btn-lookup")
    page.wait_for_selector("#lookup-result-section[data-state='found']", timeout=90000)
    shown = page.inner_text("#result-found")[:90].replace("\n", " | ")
    print("lookup rendered: %s" % shown)

    page.click("#btn-verify")
    page.wait_for_selector("#confirm-dialog:not(.hidden)", timeout=20000)
    page.click("#btn-confirm-action")
    print("check-in submitted at %s" % time.strftime("%H:%M:%S"))

    card, state = None, "?"
    for i in range(20):
        time.sleep(5)
        state = page.get_attribute("#lookup-result-section", "data-state")
        c = page.inner_text("#success-card-number") if page.query_selector("#success-card-number") else ""
        banner = page.evaluate("(() => { const e=document.querySelector('#ustar-provision-banner'); return e ? !e.classList.contains('hidden') : null; })()")
        print("  t+%3ds state=%-9s card=%-6s prov-banner=%s" % ((i + 1) * 5, state, c.strip(), banner))
        if c.strip():
            card = c.strip()
        if any("provision" in x for x in console) and i >= 2:
            break
    print("\n--- console (provisioning) ---")
    for c in console:
        if "provision" in c.lower() or "cors" in c.lower() or "reconcil" in c.lower():
            print("  " + c)
    print("\nBENCH CARD: %s | state: %s" % (card, state))
    if card:
        open("/tmp/bench_card.txt", "w").write(card)
    b.close()
