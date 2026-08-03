#!/usr/bin/env python3
"""Debug guard login + today's list DOM."""
import asyncio, os
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        page.set_default_timeout(15000)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url[:100]))
        await page.goto("https://knyf3.github.io/LITEVM/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        # check PIN gate logic
        await page.fill("#guard-pin-input", "1234")
        print("pin btn disabled?", await page.evaluate("() => document.getElementById('btn-guard-login').disabled"))
        await page.click("#btn-guard-login")
        await page.wait_for_timeout(6000)
        print("requests:", reqs[-6:])
        dom = await page.evaluate("""() => ({
            guardLoginHidden: document.getElementById('guard-login')?.classList.contains('hidden'),
            todayHidden: document.getElementById('todays-list')?.classList.contains('hidden'),
            todaysEmptyHidden: document.getElementById('todays-empty')?.classList.contains('hidden'),
            todaysLoadingHidden: document.getElementById('todays-loading')?.classList.contains('hidden'),
            listHtml: (document.getElementById('todays-list')?.innerHTML || '').slice(0, 400),
            pageText: document.body.innerText.slice(0, 300),
        })""")
        print(json_dumps(dom))
        await browser.close()

def json_dumps(d):
    import json
    return json.dumps(d, indent=1)

asyncio.run(main())
