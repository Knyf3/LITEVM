#!/usr/bin/env python3
"""Debug today's list rendering after login."""
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        page.set_default_timeout(15000)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto("https://knyf3.github.io/LITEVM/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.fill("#guard-pin-input", "2345")
        await page.click("#btn-guard-login")
        await page.wait_for_timeout(6000)
        dom = await page.evaluate("""() => ({
            loginDisplay: document.getElementById('guard-login')?.style.display,
            cards: document.querySelectorAll('.today-visitor-card').length,
            listHtmlLen: document.getElementById('todays-list')?.innerHTML.length,
            emptyDisplay: document.getElementById('todays-empty')?.style.display || getComputedStyle(document.getElementById('todays-empty')).display,
            loadingHidden: document.getElementById('todays-loading')?.classList.contains('hidden'),
            stateFilter: (typeof state !== 'undefined' && state.currentFilter) || 'n/a',
            todayCount: (typeof state !== 'undefined' && state.todayVisitors && state.todayVisitors.length) || 0,
            listText: document.getElementById('todays-list')?.innerText.slice(0, 200),
        })""")
        print(json.dumps(dom, indent=1))
        print("page errors:", errs[:5])
        await browser.close()

asyncio.run(main())
