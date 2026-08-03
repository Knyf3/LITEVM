#!/usr/bin/env python3
"""Full trace: requests, responses, today state."""
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
        logs = []
        page.on("response", lambda r: logs.append((r.status, r.url[:110])))

        await page.goto("https://knyf3.github.io/LITEVM/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        await page.fill("#guard-pin-input", "2345")
        await page.click("#btn-guard-login")
        await page.wait_for_timeout(8000)

        state = await page.evaluate("""async () => {
            // manually re-run the today fetch to see raw result
            const url = CONFIG.API_BASE + '?action=today&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID);
            let raw = '';
            try {
                const r = await fetch(url, {method: 'GET', redirect: 'follow', headers: {'Content-Type': 'text/plain'}});
                raw = await r.text();
            } catch (e) { raw = 'FETCH ERROR: ' + e.message; }
            return {
                apiBase: CONFIG.API_BASE.slice(0, 60),
                sheetId: CONFIG.SHEET_ID,
                rawHead: raw.slice(0, 300),
                cards: document.querySelectorAll('.today-visitor-card').length,
                loadingHidden: document.getElementById('todays-loading')?.classList.contains('hidden'),
            };
        }""")
        print(json.dumps(state, indent=1))
        print("responses:", [l for l in logs if 'script.google' in l[1] or 'usercontent' in l[1]])
        print("page errors:", errs[:5])
        await browser.close()

asyncio.run(main())
