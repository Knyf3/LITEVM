#!/usr/bin/env python3
"""Render LITEVM flyer HTML to PDF via headless Chromium (A4 portrait)."""
import asyncio, os
from playwright.async_api import async_playwright

BASE = os.path.expanduser("~/projects/LITEVM/marketing")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # A4 portrait at 96dpi: 210mm x 297mm -> 794 x 1123 px
        page = await browser.new_page(viewport={"width": 794, "height": 1123}, device_scale_factor=2)
        await page.goto("file://" + BASE + "/flyer.html", wait_until="networkidle")
        await page.wait_for_timeout(1000)
        await page.pdf(
            path=BASE + "/LITEVM-Flyer.pdf",
            format="A4",
            print_background=True,
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
        )
        await page.screenshot(path=BASE + "/flyer-preview.png")
        await browser.close()
        print("PDF written:", BASE + "/LITEVM-Flyer.pdf")

asyncio.run(main())
