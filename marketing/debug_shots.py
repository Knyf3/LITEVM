#!/usr/bin/env python3
"""Debug photo upload state."""
import asyncio, os
from playwright.async_api import async_playwright

OUT = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        page.set_default_timeout(15000)
        await page.goto("https://knyf3.github.io/LITEVM/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.fill("#fullName", "Ahmad Fauzi")
        await page.fill("#idNumber", "3174031508900003")
        await page.fill("#company", "PT Maju Jaya")
        await page.wait_for_timeout(2000)
        opts = await page.evaluate("() => Array.from(document.querySelectorAll('#destination option')).map(o => o.value)")
        print("destination options:", opts)
        if len(opts) > 1:
            await page.select_option("#destination", index=1)
        await page.fill("#visitationDate", "2026-08-01")
        await page.fill("#phone", "+62 812-3456-7890")
        await page.fill("#email", "ahmad.fauzi@example.com")
        await page.wait_for_timeout(1500)
        s1 = await page.evaluate("() => ({btn: document.getElementById('btn-step1-continue').disabled, errs: document.querySelectorAll('.field-error').length})")
        print("step1 continue state:", s1)
        await page.click("#btn-step1-continue")
        await page.wait_for_timeout(1000)
        print("now on step:", await page.evaluate("() => document.querySelector('.step.active')?.id"))
        # upload via click (opens chooser) — but with file input directly
        await page.set_input_files("#id-file-input", os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-id.jpg"))
        await page.wait_for_timeout(2500)
        state1 = await page.evaluate("""() => ({
            hasPhoto: !!document.querySelector('#id-photo-zone.has-photo'),
            capturedHidden: document.querySelector('#id-captured')?.classList.contains('hidden'),
            spinnerHidden: document.querySelector('#id-spinner')?.classList.contains('hidden'),
            btn2: document.getElementById('btn-step2-continue').disabled,
            capturedSrc: (document.querySelector('#id-captured')?.src || '').slice(0, 60),
        })""")
        print("after id upload:", state1)
        await page.set_input_files("#selfie-file-input", os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-selfie.jpg"))
        await page.wait_for_timeout(2500)
        state2 = await page.evaluate("""() => ({
            hasPhoto: !!document.querySelector('#selfie-photo-zone.has-photo'),
            capturedHidden: document.querySelector('#selfie-captured')?.classList.contains('hidden'),
            spinnerHidden: document.querySelector('#selfie-spinner')?.classList.contains('hidden'),
            btn2: document.getElementById('btn-step2-continue').disabled,
        })""")
        print("after selfie upload:", state2)
        await browser.close()

asyncio.run(main())
