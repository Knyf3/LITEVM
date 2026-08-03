#!/usr/bin/env python3
"""Debug registration submit + today list."""
import asyncio, os
from playwright.async_api import async_playwright

OUT = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        page.set_default_timeout(15000)
        resp_log = []
        page.on("response", lambda r: resp_log.append((r.status, r.url[:80])))
        await page.goto("https://knyf3.github.io/LITEVM/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.fill("#fullName", "Ahmad Fauzi")
        await page.fill("#idNumber", "3174031508900003")
        await page.fill("#company", "PT Maju Jaya")
        await page.wait_for_timeout(2000)
        await page.select_option("#destination", index=1)
        await page.fill("#visitationDate", "2026-08-01")
        await page.fill("#phone", "+62 812-3456-7890")
        await page.fill("#email", "ahmad.fauzi@example.com")
        await page.wait_for_selector("#btn-step1-continue:not([disabled])", timeout=10000)
        await page.click("#btn-step1-continue")
        await page.wait_for_timeout(800)
        async with page.expect_file_chooser() as fc1:
            await page.click("#id-btn-upload")
        fc = await fc1.value
        await fc.set_files(os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-id.jpg"))
        await page.wait_for_timeout(1500)
        async with page.expect_file_chooser() as fc2:
            await page.click("#selfie-btn-upload")
        fc2v = await fc2.value
        await fc2v.set_files(os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-selfie.jpg"))
        await page.wait_for_timeout(2500)
        btn2 = await page.evaluate("() => document.getElementById('btn-step2-continue').disabled")
        print("step2 continue disabled?", btn2)
        await page.click("#btn-step2-continue")
        await page.wait_for_timeout(800)
        print("step3 active?", await page.evaluate("() => document.querySelector('.step.active')?.id"))
        resp_log.clear()
        await page.click("#btn-submit")
        for i in range(20):
            await page.wait_for_timeout(1000)
            body = await page.evaluate("() => document.body.innerText.slice(0, 400)")
            if any(k in body for k in ["Visitor Number", "QR", "Success", "Error", "error", "thank"]):
                print(f"after {i+1}s body:", body.replace(chr(10), " | ")[:300])
            step = await page.evaluate("() => document.querySelector('.step.active, .success-step, #success-step, #result-step, .qr-section, #qr-section')?.id || document.querySelector('.step.active')?.className || ''")
            if "success" in str(step).lower() or "qr" in str(step).lower():
                print("SUCCESS step found:", step)
                break
        print("network responses:", resp_log)
        # today's list on verify
        await page.goto("https://knyf3.github.io/LITEVM/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await page.fill("#guard-pin-input", "1234")
        await page.click("#btn-guard-login")
        await page.wait_for_timeout(5000)
        today = await page.evaluate("""() => {
            const items = Array.from(document.querySelectorAll('#todays-list > *'));
            return {count: items.length, text: (items[0]?.textContent || '').slice(0, 200)};
        }""")
        print("today's list:", today)
        await browser.close()

asyncio.run(main())
