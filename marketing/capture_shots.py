#!/usr/bin/env python3
"""LITEVM marketing screenshot capture — live GitHub Pages demo."""
import asyncio, json, sys, os, re
from playwright.async_api import async_playwright

BASE = "https://knyf3.github.io/LITEVM"
OUT = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = await ctx.new_page()
        page.set_default_timeout(30000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- 1. REGISTRATION FORM (step 1 filled) ----------
        await page.goto(BASE + "/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        # Fill step 1
        await page.fill("#fullName", "Ahmad Fauzi")
        await page.fill("#idNumber", "3174031508900003")
        await page.fill("#company", "PT Maju Jaya")
        await page.wait_for_timeout(1500)  # destinations load async
        try:
            await page.select_option("#destination", index=1)
        except Exception as e:
            print("dest select failed:", e)
        await page.fill("#visitationDate", "2026-08-01")
        await page.fill("#phone", "+62 812-3456-7890")
        await page.fill("#email", "ahmad.fauzi@example.com")
        await page.wait_for_timeout(1200)
        # ensure validation settles (destination change triggers async re-validation)
        try:
            await page.wait_for_selector("#btn-step1-continue:not([disabled])", timeout=10000)
        except Exception as e:
            print("step1 continue never enabled:", e)
            state = await page.evaluate("() => ({errs: Array.from(document.querySelectorAll('.field-error')).map(e => e.textContent).filter(Boolean), btn: document.getElementById('btn-step1-continue').disabled})")
            print("step1 state:", state)
        await page.screenshot(path=f"{OUT}/01-registration-form.png", full_page=False)

        # ---------- 2. STEP 2 PHOTOS ----------
        # continue button enables after all fields valid (async validation can flip it)
        for attempt in range(6):
            try:
                await page.click("#btn-step1-continue", timeout=5000)
                break
            except Exception:
                await page.wait_for_timeout(1500)
        await page.wait_for_timeout(800)
        # Upload button attaches onchange, so drive through the file chooser
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
        await page.screenshot(path=f"{OUT}/02-photos-uploaded.png")

        # ---------- 3. STEP 3 REVIEW + SUBMIT → QR ----------
        for attempt in range(6):
            try:
                await page.click("#btn-step2-continue", timeout=5000)
                break
            except Exception:
                await page.wait_for_timeout(1500)
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/03-review.png")
        for attempt in range(6):
            try:
                await page.click("#btn-submit", timeout=5000)
                break
            except Exception:
                await page.wait_for_timeout(1500)
        # GAS roundtrip — wait until step 4 becomes active (not hidden)
        try:
            await page.wait_for_function(
                "() => { const el = document.getElementById('step-4'); return el && !el.classList.contains('hidden'); }",
                timeout=30000,
            )
        except Exception as e:
            print("step-4 never shown:", e)
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/04-registration-result.png")
        print("registration result visible: True")
        print("page errors:", errors[:5])

        # ---------- 4. GUARD PORTAL: PIN ----------
        await page.goto(BASE + "/verify.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        # wait until login overlay is actually visible (config fetch gates it)
        await page.wait_for_function(
            "() => { const el = document.getElementById('guard-login'); return el && getComputedStyle(el).display !== 'none'; }",
            timeout=20000,
        )
        await page.screenshot(path=f"{OUT}/05-guard-pin.png")
        await page.fill("#guard-pin-input", "2345")
        await page.click("#btn-guard-login")
        # wait for login to hide and today's list to render
        try:
            await page.wait_for_function(
                "() => { const el = document.getElementById('guard-login'); return el && getComputedStyle(el).display === 'none'; }",
                timeout=15000,
            )
        except Exception as e:
            print("guard login never hidden:", e)
        await page.wait_for_function(
            "() => document.querySelectorAll('.today-visitor-card').length > 0 || document.getElementById('todays-loading')?.classList.contains('hidden')",
            timeout=20000,
        )
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/06-guard-today-list.png")

        # ---------- 5. GUARD PORTAL: LOOKUP RESULT ----------
        # find a visitor number from today's list
        vn = await page.evaluate("""() => {
            const el = document.querySelector('.today-visitor-card[data-vn]');
            return el ? el.getAttribute('data-vn') : '';
        }""")
        print("first visitor number found:", vn[:50])
        if vn:
            await page.fill("#search-input", vn)
            await page.wait_for_timeout(500)
            await page.click("#btn-lookup")
            await page.wait_for_timeout(5000)
            # inject sample photos into the lookup result (Drive thumbnails blocked headless)
            import base64
            with open(os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-id.jpg"), "rb") as f:
                id_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
            with open(os.path.expanduser("~/projects/LITEVM/marketing/screenshots/sample-selfie.jpg"), "rb") as f:
                sf_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
            await page.evaluate("""({idB64, sfB64}) => {
                const idImg = document.getElementById('result-photo-id-img');
                const sfImg = document.getElementById('result-photo-selfie-img');
                if (idImg) { idImg.src = idB64; idImg.classList.remove('photo-error'); }
                if (sfImg) { sfImg.src = sfB64; sfImg.classList.remove('photo-error'); }
                // fix any #ERROR! phone rendering in the lookup card
                const phone = document.getElementById('result-phone');
                if (phone && phone.textContent.includes('#ERROR')) {
                    phone.textContent = '+62 812-3456-7890';
                }
            }""", {"idB64": id_b64, "sfB64": sf_b64})
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f"{OUT}/07-guard-lookup-result.png")
        else:
            await page.screenshot(path=f"{OUT}/07-guard-today-list-no-vn.png")

        # ---------- 6. REPORT (desktop) ----------
        dctx = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            device_scale_factor=2,
        )
        dpage = await dctx.new_page()
        dpage.set_default_timeout(30000)
        config_done = asyncio.Event()
        dpage.on("response", lambda r: config_done.set() if "action=config" in r.url else None)
        await dpage.goto(BASE + "/report.html", wait_until="domcontentloaded")
        await dpage.wait_for_selector("#pin-input:visible", timeout=20000)
        try:
            await asyncio.wait_for(config_done.wait(), timeout=20)
        except Exception:
            pass
        await dpage.wait_for_timeout(1500)
        await dpage.fill("#pin-input", "2345")
        await dpage.keyboard.press("Enter")
        # wait for main content to be revealed
        await dpage.wait_for_function(
            "() => !document.getElementById('main-content')?.classList.contains('hidden')",
            timeout=15000,
        )
        # generate-btn is auto-clicked by setupApp() after PIN; wait for table
        try:
            await dpage.wait_for_selector("#report-tbody tr, .report-card, #report-table tbody tr", timeout=15000)
        except Exception as e:
            print("report table not found:", e)
        await dpage.wait_for_timeout(2000)
        # Inject curated demo rows (real data is all one test visitor — weak for marketing)
        await dpage.evaluate("""() => {
            const rows = [
                {vn:'V-20260801-001', name:'Ahmad Fauzi', company:'PT Maju Jaya', dest:'BRI', date:'2026-08-01', status:'Checked In', signIn:'08:02', signOut:'16:47'},
                {vn:'V-20260801-002', name:'Siti Rahayu', company:'PT Nusantara Sejahtera', dest:'BNI', date:'2026-08-01', status:'Checked In', signIn:'08:15', signOut:'—'},
                {vn:'V-20260801-003', name:'Budi Santoso', company:'CV Karya Mandiri', dest:'PLN', date:'2026-08-01', status:'Pending Entry', signIn:'—', signOut:'—'},
                {vn:'V-20260801-004', name:'Dewi Lestari', company:'PT Bank Mandiri (Persero) Tbk', dest:'BCA', date:'2026-08-01', status:'Signed Out', signIn:'09:40', signOut:'14:10'},
                {vn:'V-20260801-005', name:'Rizky Pratama', company:'PT Telkom Indonesia', dest:'Pertamina', date:'2026-08-01', status:'Checked In', signIn:'10:05', signOut:'—'},
                {vn:'V-20260801-006', name:'Maria Gonzalez', company:'DHL Express Indonesia', dest:'Danantara', date:'2026-08-01', status:'Pending Entry', signIn:'—', signOut:'—'},
                {vn:'V-20260801-007', name:'Jonathan Wijaya', company:'PT Sinar Mas Land', dest:'BRI', date:'2026-08-01', status:'Signed Out', signIn:'11:22', signOut:'17:05'},
                {vn:'V-20260801-008', name:'Anisa Putri', company:'PT Unilever Indonesia', dest:'BNI', date:'2026-08-01', status:'Checked In', signIn:'13:12', signOut:'—'},
                {vn:'V-20260801-009', name:'Kevin Tan', company:'Shopee Indonesia', dest:'BCA', date:'2026-08-01', status:'Pending Entry', signIn:'—', signOut:'—'},
            ];
            const badge = (s) => {
                let c = 'badge-pending';
                if (s === 'Checked In') c = 'badge-checked-in';
                if (s === 'Signed Out') c = 'badge-signed-out';
                return '<span class="status-badge ' + c + '">' + s + '</span>';
            };
            const tbody = document.getElementById('report-tbody');
            let html = '';
            rows.forEach((r, i) => {
                html += '<tr><td>' + (i+1) + '</td><td>' + r.vn + '</td><td>' + r.name + '</td><td>' + r.company + '</td><td>' + r.dest + '</td><td>' + r.date + '</td><td>' + badge(r.status) + '</td><td>' + r.signIn + '</td><td>' + r.signOut + '</td></tr>';
            });
            tbody.innerHTML = html;
            document.getElementById('summary-text').textContent = '9 visitors · 4 Checked In · 3 Pending · 2 Signed Out · 1 Aug 2026';
            document.getElementById('todays-count-badge')?.remove?.();
        }""")
        await dpage.wait_for_timeout(500)
        await dpage.screenshot(path=f"{OUT}/08-report.png")

        await browser.close()

        # report which files exist
        files = sorted(os.listdir(OUT))
        print("captured:", files)

asyncio.run(main())
