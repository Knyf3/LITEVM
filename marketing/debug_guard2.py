#!/usr/bin/env python3
"""Debug guard portal with route interception."""
import asyncio, os, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        page.set_default_timeout(15000)

        async def route_gas(route):
            resp = await route.fetch()
            ct = resp.headers.get("content-type", "")
            print("GAS request:", route.request.url[:90], "-> ct:", ct[:40], "status:", resp.status)
            try:
                body_text = await resp.text()
                print("  body head:", body_text[:150])
            except Exception as e:
                print("  body read err:", e)
            await route.continue_()
        await page.route("**script.google.com/macros/**", route_gas)

        await page.goto("https://knyf3.github.io/LITEVM/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.fill("#guard-pin-input", "2345")
        await page.click("#btn-guard-login")
        await page.wait_for_timeout(6000)
        dom = await page.evaluate("""() => ({
            loginHidden: document.getElementById('guard-login')?.classList.contains('hidden'),
            cards: document.querySelectorAll('.today-visitor-card').length,
            emptyHidden: document.getElementById('todays-empty')?.classList.contains('hidden'),
            loadingHidden: document.getElementById('todays-loading')?.classList.contains('hidden'),
            text: document.body.innerText.slice(0, 200),
        })""")
        print("DOM:", json.dumps(dom, indent=1))
        await browser.close()

asyncio.run(main())
