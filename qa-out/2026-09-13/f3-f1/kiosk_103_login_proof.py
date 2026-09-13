#!/usr/bin/env python3
"""Live kiosk 1.0.3 guard-login proof: the PIN must be validated by the SERVER, not locally."""
import json, time, urllib.request
from playwright.sync_api import sync_playwright

KIOSK = "http://192.168.2.238:8123/"


def hget(u, t=120):
    with urllib.request.urlopen(u, timeout=t) as r:
        return r.read().decode("utf-8", "replace")


PIN = json.loads(hget(KIOSK + "settings.json").lstrip("\ufeff"))["GUARD_PIN"]

with sync_playwright() as p:
    b = p.chromium.launch()

    # --- (a) correct PIN -------------------------------------------------
    ctx = b.new_context()
    page = ctx.new_page()
    calls = []
    page.on("request", lambda r: calls.append(r.url) if "guardLogin" in r.url else None)
    page.goto(KIOSK, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#guard-pin-input", timeout=60000)
    time.sleep(12)  # let the config fetch settle (GAS floor is 5-8 s)
    t0 = time.time()
    page.fill("#guard-pin-input", PIN)
    page.click("#btn-guard-login")
    authed = False
    try:
        page.wait_for_selector("#todays-list", timeout=90000)
        authed = True
    except Exception:
        pass
    print("(a) correct PIN  -> authed=%s after %.1fs | guardLogin calls seen: %d" % (authed, time.time() - t0, len(calls)))
    print("    first call: %s" % (calls[0][:90] if calls else "NONE  <<< the client did NOT ask the server"))
    ctx.close()

    # --- (b) wrong PIN ---------------------------------------------------
    ctx2 = b.new_context()
    page2 = ctx2.new_page()
    calls2 = []
    page2.on("request", lambda r: calls2.append(r.url) if "guardLogin" in r.url else None)
    page2.goto(KIOSK, wait_until="domcontentloaded", timeout=60000)
    page2.wait_for_selector("#guard-pin-input", timeout=60000)
    time.sleep(12)
    page2.fill("#guard-pin-input", "0000")
    page2.click("#btn-guard-login")
    time.sleep(18)
    err_visible = page2.evaluate("(() => { const e = document.querySelector('#guard-login-error'); return e ? getComputedStyle(e).display !== 'none' : null; })()")
    still_locked = page2.query_selector("#todays-list") is None
    print("(b) wrong PIN    -> error shown=%s, still at the login screen=%s | guardLogin calls: %d" % (err_visible, still_locked, len(calls2)))
    ctx2.close()
    b.close()
