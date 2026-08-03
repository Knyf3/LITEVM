#!/usr/bin/env python3
"""Debug report page PIN flow."""
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 768}, device_scale_factor=2)
        page = await ctx.new_page()
        page.set_default_timeout(15000)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        reqs = []
        page.on("request", lambda r: reqs.append(r.url[:90]))

        await page.goto("https://knyf3.github.io/LITEVM/report.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        print("pin visible?", await page.evaluate("() => { const el = document.getElementById('pin-overlay'); return el && getComputedStyle(el).display; }"))
        print("pin-input visible?", await page.evaluate("() => { const el = document.getElementById('pin-input'); return el ? getComputedStyle(el).display : 'no-el'; }"))
        print("main hidden?", await page.evaluate("() => document.getElementById('main-content')?.classList.contains('hidden')"))
        # try fill via evaluate + dispatch Enter
        await page.evaluate("""() => {
            const inp = document.getElementById('pin-input');
            inp.value = '2345';
            inp.dispatchEvent(new Event('input'));
            const ke = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
            inp.dispatchEvent(ke);
        }""")
        await page.wait_for_timeout(5000)
        print("after pin attempt:")
        print("  main hidden?", await page.evaluate("() => document.getElementById('main-content')?.classList.contains('hidden')"))
        print("  pin-error shown?", await page.evaluate("() => !document.getElementById('pin-error')?.classList.contains('hidden')"))
        print("  body:", (await page.evaluate("() => document.body.innerText.slice(0, 200)")).replace(chr(10), ' | '))
        print("  reqs:", reqs[-5:])
        print("  errs:", errs[:5])
        await browser.close()

asyncio.run(main())
