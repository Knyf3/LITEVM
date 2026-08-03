#!/usr/bin/env python3
"""Debug report page with response-wait + fill."""
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 768}, device_scale_factor=2)
        page = await ctx.new_page()
        page.set_default_timeout(20000)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        reqs = []
        page.on("request", lambda r: reqs.append(r.url[:110]))

        await page.goto("https://knyf3.github.io/LITEVM/report.html", wait_until="domcontentloaded")
        await page.wait_for_selector("#pin-input:visible", timeout=20000)
        try:
            resp = await page.wait_for_response(lambda r: "action=config" in r.url, timeout=20000)
            print("config resp status:", resp.status)
        except Exception as e:
            print("no config resp:", e)
        await page.wait_for_timeout(2000)
        await page.fill("#pin-input", "2345")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(4000)
        state = await page.evaluate("""() => ({
            mainHidden: document.getElementById('main-content')?.classList.contains('hidden'),
            pinOverlayHidden: document.getElementById('pin-overlay')?.classList.contains('hidden'),
            pinErrorHidden: document.getElementById('pin-error')?.classList.contains('hidden'),
        })""")
        print(json.dumps(state, indent=1))
        print("reqs:", [r for r in reqs if 'script.google' in r or 'usercontent' in r][-4:])
        print("errs:", errs[:5])
        await browser.close()

asyncio.run(main())
