#!/usr/bin/env python3
"""Debug report page v3: track config response event."""
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 768}, device_scale_factor=2)
        page = await ctx.new_page()
        page.set_default_timeout(20000)
        config_done = asyncio.Event()
        page.on("response", lambda r: config_done.set() if "action=config" in r.url else None)

        await page.goto("https://knyf3.github.io/LITEVM/report.html", wait_until="domcontentloaded")
        await page.wait_for_selector("#pin-input:visible", timeout=20000)
        try:
            await asyncio.wait_for(config_done.wait(), timeout=20)
            print("config response received")
        except Exception as e:
            print("config wait timeout:", e)
        await page.wait_for_timeout(1500)
        await page.fill("#pin-input", "2345")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(4000)
        state = await page.evaluate("""() => ({
            mainHidden: document.getElementById('main-content')?.classList.contains('hidden'),
            pinOverlayHidden: document.getElementById('pin-overlay')?.classList.contains('hidden'),
            pinErrorHidden: document.getElementById('pin-error')?.classList.contains('hidden'),
            body: document.body.innerText.slice(0, 150).replace(/\\n/g, ' | '),
        })""")
        print(json.dumps(state, indent=1))
        await browser.close()

asyncio.run(main())
