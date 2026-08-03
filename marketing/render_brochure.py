#!/usr/bin/env python3
"""Render LITEVM brochure HTML to PDF via headless Chromium."""
import asyncio, os
from playwright.async_api import async_playwright

BASE = os.path.expanduser("~/projects/LITEVM/marketing")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # A4 landscape at 96dpi: 297mm x 210mm -> 1123 x 794 px
        page = await browser.new_page(viewport={"width": 1123, "height": 794}, device_scale_factor=2)
        await page.goto("file://" + BASE + "/brochure.html", wait_until="networkidle")
        await page.wait_for_timeout(1000)
        await page.pdf(
            path=BASE + "/LITEVM-Brochure.pdf",
            format="A4",
            landscape=True,
            print_background=True,
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
        )
        # also render a preview PNG for QA
        await page.screenshot(path=BASE + "/brochure-preview.png")
        await browser.close()
        print("PDF written:", BASE + "/LITEVM-Brochure.pdf")

asyncio.run(main())
