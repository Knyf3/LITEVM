# LITEVM ⇄ Kiosk ⇄ UStarAPI ⇄ Reader — Full-Stack E2E Test Plan

> Scope: prove the **whole on-prem stack works together, end to end** — cloud
> (LITEVM / GAS / Sheets), local kiosk (Verify Kiosk Windows service), gateway
> (UStarAPI), physical access hardware (UniUbi E53 reader), and the **report
> page** on both surfaces.
>
> **Layers under test (all four legs)**
> 1. **LITEVM cloud** — GAS backend + Google Sheets DB + GitHub Pages portal
> 2. **Verify Kiosk** — `verify-kiosk` Windows service on TESTBOX (.238)
> 3. **UStarAPI gateway** — on-prem facade on ASUSZENLAPTOP (.194)
> 4. **Hardware** — E53 reader (.211), incl. the device→gateway callback channel
> 5. **Report page** — `report.html`/`report.js` (Pages portal) — R-suite
>
> Companion plans (do not duplicate): `TESTPLAN-ONLINE.md` (cloud regression,
> T0–T11), `TESTPLAN-KIOSK-E2E.md` (I-suites), `verify-kiosk/TESTPLAN.md`
> (K-suites, kiosk-internal), `UStarAPI/docs/TESTPLAN.md` (gateway-internal).
> This plan owns the **P / L / G / H / E / R / N / S / C suites** — the
> cross-system seams and the physical loop.

**Baseline of record:** `qa-out/<date>/README.md` per run. Verdict vocabulary
and evidence discipline: see the `live-system-test-execution` skill (§verbs).

---

## 0. Environment state — verified 2026-09-13 (re-verify every run)

| Component | Endpoint / value | State | Evidence |
|---|---|---|---|
| GAS backend | `/exec` (deployment `AKfycbyQA6W…`) | ✅ live, deployed **v1.20.0** (== repo `CODE_VERSION`) — adds `?action=bootstrap`, the read-through CacheService layer, and QUEUED card email (`CARD_EMAIL_MODE`) | `?action=health`, `?action=bootstrap` |
| Tenant (demo) | sheet `1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs` | ✅ active: guardPin `2345`, tz `Asia/Jakarta`, autoSignOut **enabled 22:00**, `expiryState: none`, `actEnabled: true` | `?action=config` |
| Sheets DB | VisitorLog 15 canonical headers, **19 real data rows** (18 Signed Out / 1 Rejected; nothing dated today); cardno = 215 cards **all Available** (20 per DoorGroup 2–7) | ✅ healthy baseline | GAPI read, `?action=cardpool` |
| Tenant secret | `Settings.ustarSecret` = `<REDACTED-SECRET>` | ✅ present | GAPI `Settings!A1:C40` |
| UStarAPI gateway | `http://192.168.2.194:8091` | ✅ Running **v1.5.4.0**, licensed **pro/permanent**, `/swagger` 200, Settings sha256 `80DA8521C4207D52…` | `/api/health`, `/api/license/status` |
| Gateway config | `Litevm.Secret` = `<REDACTED-SECRET>` (= tenant ✅), SheetId = demo tenant, CardPool 5001–5215, **Verification = Face only (Qr false, Card false)** | ✅ / ⚠ see B4 | Settings.json read |
| Device roster | 1 device — `E03C1CB54A2F5601` `.211:8090`, alias **E53-out**, Role **out**, DoorGroups `[2..7]` | ⚠ single OUT reader only — see B5 | Settings.json read |
| E53 reader | `192.168.2.211:8090`, fw **OS-V2.2112**, pass `admin123` | ✅ reachable, live | `getDeviceKey`, `device/information` |
| Gateway→device | live poll + heartbeat | ✅ `onlineCount` **1**, `lastSeen` advancing (~60 s cadence) | `/api/devices` |
| **Device callbacks** | **9 of 10** slots → `http://192.168.2.194:8091/...` (repointed 2026-09-13, B1) | ✅ fixed | `/api/devices/{key}/callbacks` |
| ↳ `taskresultCallback` | still `http://192.168.2.113:8091/api/TaskResult` | ⚠ **UNFIXABLE on OS-V2.2112** — no setter exists (8 candidates probed, byte-identical to a nonsense-path control). Vendor input required; legacy task-result instrumentation stays dead | `callbacks` read-back |
| Verify Kiosk (.238) | `http://192.168.2.238:8123` | ✅ **installed FRESH on a cleaned host (2026-09-13)** — **v1.0.2**, exe file version `1.0.2.0`, `/health` reports `1.0.2`; self-scheduling refresh + `?action=bootstrap` boot + ambiguous-response recovery in `verify.js` (79,487 B); firewall rule Enabled/Allow; `settings.json` wired to demo tenant + gateway | LAN `GET /` 200, `GET /health`, `GET /verify.js` 200 |
| TESTBOX .238 | `DESKTOP-36079M4`, 30.9 GB free, no dotnet, `C:\repos\UStarAPI` present | ✅ up | SSH probe |
| ACT leg | ACT WCF `.217:8004` unreachable (ARP FAILED); ACTApi bridge `.194:8021` not installed | ⏸ **declared OUT OF SCOPE for this pass** (decision 2026-09-13) — A-suite deferred | nc / ARP |
| Installers on hand | `UStarAPI_Setup_1.5.5.exe` (CORS default fix) and `Verify Kiosk_Setup_1.0.2.exe` (Tier 1 client) — **note the SPACE** in the kiosk filename | ✅ both built 2026-09-13 on .194 (dotnet 10.0.302 + ISCC) | `C:\repos\*-build\Installer` |

**Three-way secret rule:** `tenant Settings.ustarSecret` = `gateway Litevm.Secret` =
`kiosk settings.json LITEVM_SECRET` — **all three verified identical** (len 11,
sha256 prefix `3D9353DC4B843BD0`). Compare fingerprints, never print the secret.

**LAN quirk:** ICMP is filtered on this network — a `ping` sweep gives false
negatives. Verify with `nc`/`curl`/SSH instead.

---

## 1. Preflight remediations (B-list) — status

> **Status 2026-09-13:** **B1 ✅ DONE** — 9/10 callback slots repointed, heartbeat channel
> proven live (`lastSeen` 2026-09-10 → now). **B2 ✅ DONE** — kiosk v1.0.1 built on .194,
> installed and configured on .238. **B3 ⏸ CLOSED** — ACT leg declared out of scope by
> decision, A-suite deferred. **B4/B5 ⏳ open** (Face-only verification; single OUT reader).
> **B6 resolved in practice** — this pass uses the **demo tenant**, which the gateway is
> pinned to, so kiosk and gateway agree.

| # | Blocker | Fix | Verify |
|---|---|---|---|
| **B1** ✅ | Device callback slots pinned the dead `.113` host → heartbeat, identify/event, task-pull and legacy task-result were all going nowhere (hardware→cloud loop dead) | Two-part fix: **`POST /api/devices/{key}/callbacks/configure`** with `facadeBaseUrl: http://192.168.2.194:8091` + `enableIdentify/Regist/Event/Qr/Finger/Card` (6 slots) **AND** the device-side targets, which the facade does **not** own: `POST <reader>:8090/setDeviceHeartBeat -d "pass=…&url=…/device/heartbeat"` and `POST /setTaskInterfaceAddress -d "pass=…&url=…/device/task"` | `callbacks` read-back: all slots `192.168.2.194`; `lastSeen` advancing; `isOnline: true` |
| **B2** ✅ | Verify Kiosk not installed on .238 | 1) clean leftovers (`Remove-Item` the app dir — the uninstaller retains `wwwroot`+`Logs`, which mangles a reinstall) 2) `git archive HEAD` → .194 → `dotnet publish` → ISCC 3) silent install 4) write `settings.json` **in place** (preserves the users-modify ACL) 5) `Restart-Service` so `PORT` is re-read | service Running, port 8123 listening, firewall rule Enabled, `http://192.168.2.238:8123` serves the page |
| **B3** ⏸ | ACT leg offline (`.217` down, ACTApi absent) | **Declared out of scope** — no work this pass | A-suite deferred |
| **B4** ⏳ | Gateway `Verification` is **Face-only** (`Qr=false`, `Card=false`) | Either keep Face-only and assert Face-only expectations, or deliberately flip `Qr`/`Card` true (gateway restart) and record it | config read-back + device effect |
| **B5** ⏳ | Only a single **OUT** reader exists (no IN reader, no door relay on the bench) | Assert the **sign-out** physical path only; a "door opened" claim needs hardware we do not have — record as CHECK, never PASS | physical observation note |
| **B6** ✅ | Tenant choice: the gateway config is **single-tenant** (`Litevm.SheetId` = demo tenant), so kiosk `SHEET_ID` must be the SAME sheet | Resolved: **demo tenant** for this pass, kiosk and gateway aligned to it. A dedicated QA tenant would require re-pointing the gateway + restart | `config` on the chosen tenant |

**Kiosk `settings.json` as deployed on .238:**
```json
{ "SHEET_ID": "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs",
  "API_BASE": "https://script.google.com/macros/s/AKfycbyQA6WibRYfpTJYA7syYaskM2n45csIs_sjzn-FfF8sNKaAFWOkIrNcRfYC-nTJc7JK/exec",
  "GUARD_PIN": "2345", "LITEVM_SECRET": "<REDACTED-SECRET>",
  "UStarApiBase": "http://192.168.2.194:8091", "ACTApiBase": "",
  "ACTExtraRights": { "timezone": 2, "validityDays": 1 }, "PORT": 8123 }
```
`GUARD_PIN` here is the **offline fallback**; online, the sheet's `guardPin`
(`2345`) is authoritative.

**Lessons worth keeping (from clearing B1/B2):**
- **The facade's callback read-back compares PATHS, not HOSTS.** After the laptop's IP
  move every slot reported `facadeUrlMatches` as a clean match while the actual URL still
  pointed at the dead `.113` host. A host change is therefore **invisible** to that
  read-back — always assert the **host** explicitly.
- **The heartbeat/task targets do not live in the gateway.** Configure writes only 6 slots;
  `heartBeatCallback` and `tasknoCallback` are set by direct device calls
  (`setDeviceHeartBeat`, `setTaskInterfaceAddress`) and are otherwise silently stale.
- **The kiosk artifact has a SPACE in its filename** (`Verify Kiosk_Setup_1.0.1.exe`), so
  `-Include "VerifyKiosk_Setup*.exe"` finds nothing. Quote the path.
- **Over-SSH PowerShell one-liners with nested quotes fail silently** (empty output, exit 0).
  Write a `.ps1`, `scp` it, run with `-File` — the fix for two false FAILs in this run.

---

## 2. The money path (what "end to end" means)

```
 [1] Visitor registers            portal / kiosk self-service
        │  POST /exec (registration)                    → VisitorLog row "Pending Entry" + email
        ▼
 [2] Guard logs in at kiosk       PIN 2345 (sheet-authoritative)
        │  GET  ?action=today                            → visitor listed, Pending count +1
        ▼
 [3] CHECK-IN at kiosk
        │  POST /exec mode=updateStatus                  → status "Checked In", cardNo assigned from
        │                                                   Destination→DoorGroupID block, DoorGroupID intact
        │  POST gateway /api/litevm/provision             → X-Litevm-Secret; person + face(+QR) on reader
        ▼
 [4] DEVICE EFFECT (hardware)     GET  /api/devices/{key}/info  → faceCount 0→1, person present
        ▼
 [5] PHYSICAL PRESENTATION        face (or QR/card) at the E53 → reader recognises
        │  identify/event callback → gateway (HOST MUST BE .194)
        ▼
 [6] GATEWAY → CLOUD              gateway resolves cardNo (idcardNum→personId fallback for face-only),
        │                          POST /exec mode=signOutByCard (+ustarSecret) → row "Signed Out", card released
        ▼
 [7] DE-PROVISION                 gateway deletes person/face on reader → faceCount back to baseline
        ▼
 [8] TRUTH + REPORT               VisitorLog row + cardno state correct; report page for the date shows
                                   the visitor as Signed Out with the right summary counts
```

Every arrow above is a seam that has failed in production at least once — that is
why each is its own case, not a step inside one.

---

## 3. Suites

### P — Preflight & environment (run first, every time)

| ID | Test | Expected | Destructive |
|---|---|---|---|
| P1 | GAS `/exec?action=health&sheetId=<tenant>` | 200, `version` == repo `CODE_VERSION` (**1.20.0**) | no |
| P2 | Tenant `config` | active, guardPin/tz/autoSignOut as intended, not expired/disabled | no |
| P3 | Gateway `/api/health` + `/api/license/status` | version 1.5.4.0, `licensed:true` | no |
| P4 | Gateway → device poll `/api/devices/{key}/info` | device data returned; `onlineCount` → 1 | no |
| P5 | Reader direct `getDeviceKey` + `device/information` | deviceKey matches config; fw OS-V2.2112 | no |
| P6 | **Snapshot** gateway `Settings.json` + SHA256 → `qa-out/<date>/` | hash recorded | no |
| P7 | Snapshot reader baseline: personCount / faceCount / fingerCount | recorded (expect 1 / 1 / 3) | no |
| P8 | Selector of record: `kiosk commit`, `LITEVM CODE_VERSION`, `UStarAPI version` | all three recorded in the run header | no |
| P9 | Kiosk service + `:8123` + firewall rule + LAN serve | Running, page served | no |
| P10 | Secret chain probe: tenant `ustarSecret` == gateway `Litevm.Secret` == kiosk `LITEVM_SECRET` | 3-way match (compare fingerprints, never print secrets) | no |
| P11 | Cards available ≥ 3 for the target door group | pool `Available` count from `cardpool` | no |
| P12 | Baseline `VisitorLog` row count for today | recorded (for the "+N rows" assertions) | no |
| P13 | **`?action=bootstrap`** (new v1.20.0) | 200 `status ok` + `version` + `config` + `destinations[]` + `visitorTypes[]` + `visitors[]` in ONE response; `todayError` absent | no |
| P14 | **CORS preflight, kiosk origin → gateway** (F5 regression guard) | 204 + `Access-Control-Allow-Origin: http://192.168.2.238:8123`; **control:** `http://evil.example` → no ACAO header | no |

### L — LITEVM cloud leg

| ID | Test | Expected |
|---|---|---|
| L1 | Registration (POST) | 200 + `status ok`, `V-YYYYMMDD-NNN`, row `Pending Entry` |
| L2 | Registration validation | missing required fields rejected; bad `Destination` rejected |
| L3a | **Registration** confirmation email | delivered **in-request** (hybrid); `EmailQueue` gains **no** row — the visitor is waiting, so this one stays synchronous |
| L3b | **Card-assignment** email (v1.20.0 Tier 2 change) | **QUEUED, not sent in-request**: `EmailQueue` gains a PENDING row for the card recipient and the check-in response returns promptly. Reverting needs no redeploy — set Script Property `CARD_EMAIL_MODE=immediate` |
| L4 | `lookup` by visitor number | full record; Destination + Visitor Type correct (header-name resolution) |
| L5 | `today` list | new visitor present with photo URLs |
| L6 | `cardpool` | totalRows 216; card statuses reflect check-ins |
| L7 | Cross-tenant isolation | second tenant's reads never surface this tenant's rows/cards |
| L8 | Origin/authority gate on admin actions | `report`/`bulkSignOut`/`signOutByCard` rejected (403) from a non-allowlisted origin — **control:** nonsense `action` also rejected, wrong verb rejected |

### G — UStarAPI gateway leg

| ID | Test | Expected |
|---|---|---|
| G1 | `/api/litevm/provision` with correct secret | 200; `provisioned[].success` true |
| G2 | Provision with wrong secret | 401 `LITEVM_UNAUTHORIZED`-class; kiosk shows red banner; check-in itself unaffected |
| G3 | Licence gate (fail-closed) | with a blanked token: `/api/*` → 403 `LICENSE_REQUIRED`; `/device/*` and `/api/health` still reachable. *(Only as a controlled test window; restore + restart afterwards.)* |
| G4 | Idempotent re-provision | same visitor re-provisioned → no duplicate person, no error |
| G5 | `isOnline` semantics | momentary `false` after an outage ≠ proof; a successful on-demand call is the stronger signal |
| G6 | Callback slot read-back | every slot **host** == `.194` (paths alone are not proof — see §1 lesson) |
| G7 | Event ingestion | a real device presentation appears in `/api/events` with `receivedVia: 1` (push), not `reconcileRequired` |
| G8 | Heartbeat/task channel | device heartbeat → `lastSeen` refresh; `/device/task` pulls served |
| G9 | Legacy `/api/TaskResult` | 200 bare boolean (`false`), **exempt from the licence gate**. ⚠ currently unreachable — its slot still points at `.113` and cannot be re-pointed on this firmware |
| G10 | Photo proxy / record retrieval | visitor photo served for the kiosk without referrer 403 |

### H — Hardware leg (E53 bench)

| ID | Test | Expected |
|---|---|---|
| H1 | Person upsert visible | device `person/find` (or `findByPage`) returns the provisioned person; ids numeric only |
| H2 | Face enrolment | `/api/devices/{key}/info` `faceCount` +1 (`face/find` returns an **array** of records) |
| H3 | QR credential (only if `Verification.Qr=true`) | QR enabled per the 7-mode permission table (enabled = `2`, disabled = `1`, never `0`) |
| H4 | Face-only sign-out resolution | face record carries `personId` with EMPTY `idcardNum` → gateway falls back to `personId` (no silently dropped recognition) |
| H5 | Physical recognition → callback | presenting the enrolled face at the reader produces a gateway identify event **within one poll interval (30 s for sign-out; callbacks are push)** |
| H6 | De-provision on sign-out | `faceCount` returns to baseline; `face/find` 0 records (fail-open regression guard: never a hollow success) |
| H7 | Reader idempotence / no-op safety | re-sending an unchanged config value causes **no** outage (`LAN_SUS-0`, no socket 10061 window) |
| H8 | Transport binding | read endpoints = GET; setter endpoints = POST form-encoded; wrong verb → `LAN_EXP-1006` **with a nonsense-path control** proving it |
| H9 | Clock/locale sanity | device time sane; `languageType` field is **unreliable** — never assert the applied language from it (confirm by eye) |
| H10 | Device error honesty | a device-level rejection surfaces as non-2xx (never a 200 carrying an inner failure) |

**Do NOT include in any batch:** `POST /manage/language` with a *changed* value
(restarts the reader's HTTP service ~14 s), `POST /manage/netinfo` (known-broken
field set), any `setTime` call (unimplemented on this firmware).

### E — Full-loop E2E (the money path)

| ID | Test | Expected |
|---|---|---|
| E1 | **Happy path, complete loop** — register → kiosk check-in → provision → physical presentation → callback → cloud sign-out → de-provision | Steps [1]–[8] all land; single visitor; ≤2 real emails |
| E2 | Card assignment provenance | kiosk shows the card returned **by the backend response** (not cached state); card ∈ the Destination's DoorGroup block |
| E3 | Sheet truth after check-in | `Checked In`, AssignedTo = VN, DoorGroupID intact |
| E4 | Sheet truth after sign-out | `Signed Out`, card `Available`, AssignedTo/At cleared, **DoorGroupID preserved** |
| E5 | Card reuse | a second visitor draws the freed card; no stale assignment |
| E6 | Second loop, same reader | loop repeatable back-to-back; device counts return to baseline each time |
| E7 | Online-mode skip | with `UStarApiBase` empty → **no** provision call (network panel); check-in still succeeds |
| E8 | Report cross-check (closing assertion) | R-suite shows the E2E visitor Signed Out; counts match VisitorLog |

### R — Report page (`report.html` / `report.js`)

Report data flows: PIN gate → `?action=config` → POST `action=report`
(**admin** endpoint type ⇒ origin/allowlist-gated) with `fromDate`/`toDate`;
filters and the summary bar are computed client-side over the returned rows.

| ID | Test | Expected |
|---|---|---|
| R1 | PIN gate | wrong PIN → inline error, no data; `2345` → `sessionStorage.guardAuth = true`, main content shown |
| R2 | PIN source | online: PIN comes from the sheet's `guardPin`; offline: falls back to `settings.json GUARD_PIN` then `1234`. Assert the sheet value wins when reachable |
| R3 | Date defaults & presets | default = **today** (from = to = today); presets `today / yesterday / 7days / month` set the correct inclusive range and the active-button state |
| R4 | Inclusive boundaries | `fromDate == toDate == today` returns today's rows; a **future** range returns 0 rows with 0 counts, CSV + Print disabled |
| R5 | Server date filter correctness | rows returned match `fromDate ≤ Visitation Date ≤ toDate` (string-ISO comparison, customer tz) — cross-check against GAPI VisitorLog read |
| R6 | Free-text search | matches Full Name, Company, Visitor Number |
| R7 | Status filter | Pending Entry / Checked In / Signed Out subsets correct |
| R8 | Type filter | Visitor Type subset correct (list from the tenant's VisitorType tab) |
| R9 | Summary bar truth | Pending / Checked-In / Signed-Out counts + per-type summary **equal the filtered table rows** and the sheet truth for the range |
| R10 | Pagination | 25/page; page nav correct at first/last boundary; empty result → no pagination |
| R11 | CSV export | BOM present, header row correct, one row per visitor, comma/quote escaping correct, filename `LITEVM_Report_<YYYY-MM-DD>.csv`; export disabled when 0 rows |
| R12 | Print/PDF | Print enabled only with rows; print stylesheet hides controls/overlays |
| R13 | **E2E visibility** | the E1 visitor appears in the report for today with `Signed Out` and the correct Visitor Number |
| R14 | Tenant isolation | report for tenant A never includes tenant B rows (pair with L7) |
| R15 | Origin gate + control | `action=report` from a non-allowlisted origin → 403; from the portal → 200. Control: missing `sheetId` → `Customer identifier required`; nonsense action → rejected |
| R16 | Expired/disabled tenant | an expired tenant's report is blocked consistently with `config` (expect the expiry error, not a silent empty table) |
| R17 | i18n | all report strings present in `lang.js` (en + id), no key leakage on the page |
| R18 | XSS/escaping | a visitor name containing `<script>`/quotes renders escaped in the table and in the CSV |

### N — Negative & resilience (failure injection)

| ID | Test | Expected |
|---|---|---|
| N1 | Gateway down | check-in still succeeds; provision fails gracefully (red banner + retry); no data loss |
| N2 | Gateway restored → retry | provision succeeds, banner clears |
| N3 | Reader off/network-cut | gateway surfaces `isOnline:false` + 502 on demand; auto-recovery without a gateway restart |
| N4 | GAS unreachable from kiosk | kiosk shows an error state, does not blank-screen or spin forever |
| N5 | Callback host wrong (regression for B1) | with a deliberately wrong callback host, events are **not** ingested and the logs show the retry storm — the control that proves G7 is a real signal |
| N6 | Duplicate check-in | second check-in on an already-checked-in visitor does not double-assign a card |
| N7 | Sign-out for a visitor with no card | handled without corrupting cardno state |
| N8 | Email quota path | (simulate only) queue fallback engaged, `EmailQueue` rows pending → SENT on sweep; never exceed 2 real sends |
| N9 | Time skew | licence grace (24 h) and device clock sanity — do not treat a sub-day skew as a licence failure |
| N10 | Kiosk restart mid-flow | after service restart the kiosk recovers state from the backend (no cached-only assumption) |

### S — Safety nets & lifecycle

| ID | Test | Expected |
|---|---|---|
| S1 | Auto sign-out safety net | with `autoSignOutHour` = current WIB hour, the GAS hourly tick signs the visitor out cloud-side; the device person is *not* revoked by the cloud tick alone (state that explicitly) |
| S2 | Retention dry-run (`retentionDryRun`) | runs clean while the tenant is active; **an expired tenant cannot run admin modes** |
| S3 | Expiry dry-run (`expiryDryRun`) | clean; expiry state derived, never stored |
| S4 | Licence rotation behaviour | a timed token locks the box only after `exp + 24 h` grace, and without a restart |
| S5 | Restore-to-baseline proof | post-run diff of gateway `Settings.json` SHA256 + device counts == pre-run snapshot → **zero changes** (rule: a zero-diff is the evidence) |

### A — ACT leg (**DEFERRED BY DECISION 2026-09-13 — NOT RUN this pass**)

Not exercised: the ACT Enterprise server `.217:8004` is offline (ARP FAILED) and the
ACTApi bridge is not installed on `.194`. Cases retained for a future pass:

| ID | Test | Expected |
|---|---|---|
| A1 | ACT entitlement | tenant `actEnabled: true` (currently true) and kiosk config path honours it |
| A2 | Grant on check-in | `PUT /api/users/{cardNo}/extra-rights` fires with the doorGroup + tz + validity window |
| A3 | Revoke on sign-out | `DELETE /api/users/{cardNo}/extra-rights` fires |
| A4 | ACT down resilience | check-in succeeds; grant failure logged non-blocking |
| A5 | ACTApi SSPI transport | the service runs as a **user account** (LocalSystem/session-0 fails NTLM, socket 10054 abort) |

### C — Cleanup & evidence

| ID | Item |
|---|---|
| C1 | Remove test visitors/cards created by the run (or leave them tagged `QA-*` for the next run — pick one and record it) |
| C2 | Restore `Settings.json` from snapshot if it was touched; confirm SHA256 |
| C3 | Confirm device counts back to baseline (person/face/finger) |
| C4 | Save evidence: `qa-out/<date>/` — curl bodies, sheet snapshots, `/callbacks` reads, device `device/information` before/after, kiosk screenshots, report CSV |
| C5 | Run log written to this file's §5 (results table) |

---

## 4. Change → required suites

| Change | Required suites |
|---|---|
| Any on-prem change | **P (full) + E1 smoke** |
| Host/IP move (like `.113`→`.194`) | **P3/P4/P6 + G6 callback HOST read-back + H5/E1** ← the B1 class of failure |
| Kiosk `settings.json` (bases, secret, PIN, port) | P9/P10 + K quick + G2/E7 + R2 |
| Gateway `Settings.json` (secret, SheetId, Verification flags) | P3/P10 + G1/G4 + H3 + E2 |
| LITEVM backend response shape (cardNo/doorGroupId) | L4 + E2/E3/E4 + kiosk K4 |
| Report page / `lang.js` | **R (full)** + L8 |
| Card pool / DoorGroup plan | P11 + E2/E4/E5 |
| Tenant tier/expiry/licence | P2/P3 + R16 + S3/S4 |
| Provisioning / face-delete logic | H1/H2/H6 + N6 + E1 |
| Firmware / device swap | P5/P7 + **H (full)** + G6 |

---

## 5. Run log

### Run 1 — 2026-09-13 — **P-suite only** (B1 + B2 remediation complete)

```
Selectors: LITEVM 1.19.0 | kiosk v1.0.1 (verify-kiosk 2b347e0) | UStarAPI 1.5.4.0
Environment: tenant=<demo 1-rHZEn2AW…> | kiosk=http://192.168.2.238:8123 | gateway=http://192.168.2.194:8091 | reader=192.168.2.211
Snapshots: gateway Settings sha256=80DA8521C4207D52… | device person/face/finger=1/1/3 | exe sha=05EA6DF2E4D85B7B…
Evidence: qa-out/2026-09-13/
Outcome: 12 PASS / 0 FAIL / 2 INFO   (2 initial probe FAILs were instrumentation, corrected — see note)
```

| ID | Expected | Actual | Verdict |
|----|----------|--------|---------|
| P1 | deployed version = repo | 1.19.0 = 1.19.0 | ✅ PASS |
| P2 | tenant active | guardPin 2345, Asia/Jakarta, expiryState none | ✅ PASS |
| P3 | gateway up + licensed | v1.5.4.0, pro, permanent | ✅ PASS |
| P4 | gateway→device poll | onlineCount 1; lastSeen advancing | ✅ PASS |
| P5 | reader reachable, key matches | OS-V2.2112, key E03C1CB54A2F5601 | ✅ PASS |
| P6 | settings snapshot | sha256 80DA8521C4207D52… | ✅ PASS |
| P7 | device baseline | 1 / 1 / 3 | ℹ️ INFO |
| P8 | selectors of record | recorded above | ℹ️ INFO |
| P9 | kiosk service/port/firewall/LAN | Running, port 8123, rule Enabled, `GET /` 200, `/settings.json` 200 | ✅ PASS |
| P10 | three-way secret match | tenant = gateway = kiosk (11 / 3D9353DC4B843BD0) | ✅ PASS |
| P11 | ≥3 cards in target groups | 215 Available (20 each, DoorGroups 2–7) | ✅ PASS |
| P12 | VisitorLog baseline | 19 real rows; 0 dated today (clean slate) | ℹ️ INFO |

**Not run this pass:** L / G / H / E / R / N / S suites (P9 and P10 were the only
on-prem preconditions outstanding; the loop itself awaits a human at the reader for the
physical presentation step) · A-suite deferred by decision · C-suite runs at the end of a
full pass.

**Note on the two corrected entries:** P9 and P10 initially recorded FAIL because the
over-SSH PowerShell probes used nested quotes and returned **empty output with exit 0** —
the service was in fact serving (`GET /` 200 from the LAN) and the secrets did in fact
match. Both were re-probed with a `.ps1` file (`ssh … powershell -File probe.ps1 <mode>`) and
passed. **An empty probe result is not evidence of absence** — re-run it a different way
before recording a FAIL.

**Outage note (same day):** a brief LAN/network outage occurred mid-run. Post-outage
re-verification: GAS 200 v1.19.0 · gateway `onlineCount` 1 · device `lastSeen` still
advancing · kiosk `GET /` 200 · reader reachable. No state lost; the repaired callback
channel re-established by itself, which is itself evidence that B1 holds.

### Run 2 — 2026-09-13 — **L / K / G / H / E suites + B4 (QR) + F1 remediation**

```
Selectors: LITEVM 1.19.0 | kiosk v1.0.1 (verify-kiosk 2b347e0) | UStarAPI 1.5.4.0
Environment: tenant=demo | kiosk=http://192.168.2.238:8123 | gateway=http://192.168.2.194:8091 | reader=192.168.2.211
Config: gateway Verification = Face+QR (Card off); settings sha256 A96AC57B… (was 80DA8521…, QR enabled this run)
GAS latency observed: 5.6–12.4 s per curl call; 133 s for one browser GET through the redirect chain
Evidence: qa-out/2026-09-13/ ; visitors V-20260913-001 / -002 / -003
```

| ID | Expected | Actual | Verdict |
|----|----------|--------|---------|
| L1 | registration accepted | 3 × `{"status":"ok","visitorNumber":"V-20260913-00N"}` | ✅ PASS |
| L2 | missing-field POST → HTTP 400 | body carried the error but HTTP was **200** (302→GET hop masks the status) | ⚠ DEVIATION (plan expectation wrong — assert on the body) |
| L4 | lookup returns full record | BCA / Visitor / Pending Entry correct — header-name resolution sound | ✅ PASS |
| L5/L6 | today list + cardpool | visitor listed; cardpool totalRows 216 | ✅ PASS |
| L8 | admin action origin-gated | **foreign origin also returned the full report (200)** — `allowedOrigins` is enforced for `register` only | ⚠ DEVIATION → **F3** (security) |
| K1/K2 | kiosk boots, config wired, PIN gate | CONFIG from `settings.json` (tenant + gateway + secret), wrong PIN rejected, correct PIN unlocks | ✅ PASS |
| K3 | lookup renders visitor | full record incl. photos | ✅ PASS |
| K4 | check-in via UI | **server-side PASS** (row `Checked In` + card assigned) but the client received a non-JSON body and rendered "Unexpected server response" | ❌ **FAIL → F2** |
| K5/E4 | sign-out via UI | `{"status":"ok","message":"Visitor signed out","cardNo":"5021"}` in 8 s; card released | ✅ PASS |
| K5b | ACT revoke when ACT is disabled | kiosk called `GET /api/users/5021/extra-rights` **against its own origin** (404) — empty-string `ACTApiBase` passes the `!== null` check | ❌ **FAIL → F4** |
| E2/E3 | card assigned from the Destination's door-group block | BCA→**5001**, BRI→**5021**, PLN→**5061**; DoorGroupID preserved | ✅ PASS |
| G1 | gateway provision | `POST /api/litevm/provision` → **200 in 3.5 s**, `provisioned[0].success=true` | ✅ PASS |
| H1 | person upsert visible | person record `id=5061`, name set, `qrCode='5061'`, `qrCodePermission=2`, `facePermission=2` | ✅ PASS |
| H2 | face enrolment | device `faceCount` **1 → 2** (`face/find` returns the faceId + croplmgPath) | ✅ PASS |
| H3 | QR credential (B4 enabled) | `qrCodePermission=2`, `qrCode='5061'` — QR config assert accepted by the firmware | ✅ PASS |
| E1 | full loop incl. physical presentation | **NOT RUN** — needs a person at the reader (bench session) | ⏸ NOT RUN |
| E7 | online-mode skip | not re-run this pass (UStarApiBase is configured) | ⏸ NOT RUN |
| H5/H6 | physical recognition → callback → de-provision | **NOT RUN** — same physical constraint | ⏸ NOT RUN |

#### R-suite — report page (`https://demo.litevm.itt.web.id/report.html`), run live

| ID | Test | Verdict |
|----|------|---------|
| R1a | wrong PIN rejected (**control** — also proves the PIN handler is attached) | ✅ PASS — handler attached after 2 probes (12 s) |
| R1b | correct PIN (`2345`, sheet value) unlocks | ✅ PASS |
| R3 | date defaults to today (from = to) | ✅ PASS |
| R3b | presets present | ✅ PASS (`today / yesterday / 7days / month`) |
| R4 | today range returns rows | ✅ PASS — **3 rows** |
| R9 | summary bar truth | ✅ PASS — `3 visitors · 1 Checked In · 0 Pending · 2 Signed Out · 13 Sep 2026 – 13 Sep 2026`; type split `Contractor: 1, Visitor: 2` |
| R13 | E2E visitors visible | ✅ PASS — all three `QA-20260913-*` present |
| R6 | free-text search | ✅ PASS — 1 row for the bench visitor |
| R7 | status filter | ✅ PASS — `Signed Out` → 2 rows (matches the sheet) |
| R8 | type filter | ✅ PASS — `Contractor` → 1 row |
| R11 | CSV export | ✅ PASS — BOM present, header + **3 rows**, correct Destination/Type. *(Automated assertion first read FAIL because it looked for the header "Visitor Number"; the actual column is "Visitor #" — an assertion bug, not a product bug. Re-verified by hand.)* |
| R12 | Print enabled with rows | ✅ PASS |
| R17 | i18n toggle | ✅ PASS |
| R5 / R10 / R14 / R15 / R16 / R18 | date-boundary cross-check vs sheet, pagination, tenant isolation, origin gate, expired tenant, XSS | ⏸ NOT RUN — R5 done at API level only; **R15 is moot until F3 is addressed** |

**Counts cross-check:** the report's 3 rows / 1 Checked In / 2 Signed Out match `VisitorLog` exactly for 2026-09-13 — summary-bar truth holds.

**CHECK (new):** the status filter's option vocabulary is `['', 'Registered', 'Checked In', 'Signed Out']`, but the backend stores `Pending Entry` for a pre-registration. With 0 pending rows today this was not exercised — a filter labelled "Registered" may not match `Pending Entry` rows. Verify on a day with a pending visitor.

**Defects raised this run**

| ID | Defect | Severity | Status |
|----|--------|----------|--------|
| **F1** | Stale device records replayed by the sign-out poll: the watermark store is in-memory and only advances when a whole batch succeeds, and a GAS **404 (card not assigned) is treated as retryable** → infinite retry. A replayed 8/30 record for card 5001 later hit that card's *new* holder and wrote the old timestamp as their Sign-Out Time. | **High** | **Mitigated** — 125 device records cleared (`POST /newDeleteRecords`), gateway restarted; poll now reports `0 candidate(s)`; 0 retries observed afterwards. **Code fix still open** (ack-and-drop on business rejection + record-freshness filter) |
| **F2** | Kiosk check-in loses the response under GAS latency → `JSON.parse` failure branch → `provisionUstar()` **never called** → visitor carded but no credential on the reader | **High** | Open (needs kiosk/LITEVM change) |
| **F3** | `action=report` (and other `admin` endpoints) are **not origin-gated** — `allowedOrigins` applies to `register` only | **Medium (security)** | Open — decision required |
| **F4** | Kiosk treats an empty-string `ACTApiBase` as enabled → bogus ACT call to its own origin on every sign-out | **Low** | Open |
| **F5** | GAS latency (5.6–12.4 s/call; 133 s browser GET) makes the kiosk and report page fragile | **Medium** | Observation — amplified F2 |

**Method notes worth keeping**
- **A silent zero:** `newFindRecords` without `startTime=0&endTime=0` returns `LAN_EXP-3031`, and a naive count of `data.records` reports **0 records** — indistinguishable from "nothing to process". Assert the envelope's `success` first.
- **Kiosk page-load waits:** the kiosk polls, so `networkidle` never settles — use `domcontentloaded` + an explicit element wait.
- **The report page's PIN handler attaches only after its config fetch settles.** Under GAS latency that is minutes; probing with a wrong PIN (expect `#pin-error`) is the reliable "is the page ready" signal, and keystrokes before then are silently lost.
- **Over-SSH PowerShell with nested quotes fails silently** (empty output, exit 0) — ship a `.ps1` and run it with `-File`.

### Run 3 — 2026-09-13 20:03–20:09 — **bench: full E2E with the operator's own face — PASS**

Stack: LITEVM **1.20.0** (live) · Verify Kiosk **1.0.2** (fresh install on the cleaned testbox) · UStarAPI **1.5.5.0** · E53 fw **OS-V2.2112**, operator physically at the reader.

Money path, all 8 steps landed, 4 min 11 s end to end: register `V-20260913-009` (20:03:12) → kiosk check-in (20:04:24) → provision **200 in 4,528 ms** (Drive selfie 3,158 ms → `setIdentifyModel` 78 ms → `person/create` 160 ms → `face/create` 516 ms → `person/update` 159 ms) → device `person 2→3, face 2→3` → **operator's face at the reader** 20:06:54.953 → identify callback **200 in 10.9 ms** with `personId=5001` and **`idcardNum=` EMPTY** (H4 fallback resolved it) → sign-out poll `1 candidate(s) processed` 20:07:23 → GAS `/exec` 200 (8,143 ms) → sheet `Signed Out` → `person/delete` 200 (188 ms) → device back to baseline **2/2/3**, card 5001 `Available`, `DoorGroupID` 2 intact.

**H1–H6 PASS. E1/E2/E4 PASS. E3 NOT CAPTURED** (mid-flight `AssignedTo`/`Assigned` read missed by the instrument — not a product fault). **F1 watch PASS**: poll sequence `0,0,0,…,0 → 1 → 0,0,0`, consumed exactly once, no loop, no ERR/WRN. QR scan capability remains **UNVERIFIED** (declared, not claimed). "Door opened" stays a **CHECK** — single OUT reader on this bench.

Full evidence: `qa-out/2026-09-13/bench/BENCH-RESULT.md`.

### Run 4 — 2026-09-13 20:17–20:26 — **QR credential leg — cloud PASS, door FAIL (now fixed)**

Stack unchanged (LITEVM 1.20.1-candidate / kiosk 1.0.2 / UStarAPI 1.5.5.0), operator at the reader.
Second visitor of the evening: `V-20260913-010` (same photo), checked in on card **5001** — which also
proves **card reuse (E5)**: 5001 had been released by the face run 10 minutes earlier.

**Passed.** Enrolment: device `person 2→3, face 2→3`, and the QR credential is armed —
`person/find` (a **GET** on this firmware; a POST returns `LAN_EXP-1006`, which reads as "absent" if
you trust it) reports `qrCode="5001"`, `qrCodePermission=2`. The scan then produced
`POST /device/callback/identify?personId=5001&type=qrCode_0&time=1789305914616` — handler **1.4 ms**,
HTTP 200. So **QR mode works end-to-end**, and the "does the E53 even have a QR scanner" question is
closed. The sheet flipped to `Signed Out` (in 20:17, out 20:24) and card 5001 returned to the pool
`Available`, unassigned.

**Failed — F1b, a genuine fail-open.** The reader still held `person=3 face=3`: the credential was
**never de-provisioned**. The log explains it: at 20:25:30 and again at 20:26:00 the gateway logged
`GAS signOutByCard transport failure for card 5001 — watermark held` (GAS round trips exceeding the
client's 15 s timeout), *after* GAS had already committed the sign-out. The retry therefore finds the
card **already released**, receives `noop`, and the then-current rule — "noop ⇒ advance the watermark,
do not touch the device" — skipped the delete. Net effect: **the sheet says Signed Out, the card is
back in the pool, and the visitor's face and QR still open the door.**

This is the exact class the whole stack exists to prevent, and it was pre-existing (not introduced by
the F1 classification change — that change is what made it *visible*). Fixed in UStarAPI **1.5.6**:
`noop` now de-provisions unless the reason is `stale_event`, and GAS reports a `reason`
(`card_not_assigned`) so the gateway can tell the two apart. Three tests cover it, one of which
**replaced an assertion that encoded the defect** ("a noop never deletes").

**Also learned (instrument, not product):** `person/find` and `person/findByPage` are **GET**; my
earlier POST-based reads returned `LAN_EXP-1006` and I briefly mis-reported an absent person. The
device count readback (`device/information` → `personCount`/`faceCount`) is the reliable one, and
`person/delete` on the device wants a different field shape than the gateway's
`DELETE /api/litevm/persons/{card}?doorGroupId=<n>` — use the gateway.

Orphan cleaned up by hand (device restored to baseline 2/2/3).

### Run log template (full passes)

```markdown
## Run: <date> — LITEVM <CODE_VERSION> / kiosk <commit> / UStarAPI <version>
Environment: tenant=<sheetId> | kiosk=http://192.168.2.238:8123 | gateway=http://192.168.2.194:8091 | reader=192.168.2.211
Snapshot: settings sha256=<..> | device person/face/finger=<n>/<n>/<n>
Outcome: <N> PASS / <N> DEVIATION / <N> CHECK / <N> SKIP / <N> FAIL

| ID | Expected | Actual | Verdict | Evidence | Notes |
|----|----------|--------|---------|----------|-------|
| P4 | onlineCount 1 | ... | ... | qa-out/.../p4.json | |
```

**Verdicts:** `PASS` matched · `DEVIATION` plan expectation was wrong (usually the
most valuable finding) · `CHECK` probe limitation · `SKIP` blocked — **say why, and
re-test the why** · `FAIL` failed against a *correct* expectation.

---

## 6. Run sequencing & cost notes

1. **P-suite** (incl. B-list remediation) — ~30 min. Do not start the loop until the P-suite is green.
2. **L + R baselines** before touching hardware — so a later failure is attributable.
3. **E1** once, observed end to end (physical step needs a human at the reader).
4. **H/E repeats** for card reuse and idempotence.
5. **N/S** with stated windows; schedule any `POST /manage/language` *change* off-shift.
6. Cleanup + zero-diff proof + run log.

**Budget guards:** ≤2 real emails per run (quota resets 14:00 WIB); one reader
HTTP-service bounce max per run (~14 s outage, and only if the value actually
changes); never bundle a disruptive write into a batch.

---

## 7. Decisions — status

| # | Decision | Status |
|---|---|---|
| 1 | **Tenant:** stay on the demo tenant (gateway is pinned to it) or re-point the gateway to a dedicated QA tenant and align the kiosk? | ✅ **Decided — demo tenant for this pass** (kiosk, gateway and secret chain all aligned to it). Revisit before any pass that needs a dedicated QA tenant (e.g. R14/L7 isolation) |
| 2 | **ACT leg:** revive `.217` + ACTApi, or declare out of scope? | ✅ **Decided — OUT OF SCOPE this pass** (2026-09-13). A-suite deferred, not deleted |
| 3 | **Verification modes:** keep the gateway Face-only, or deliberately enable Qr/Card? | ✅ **Decided + live + PROVEN — Face=True, Qr=True, Card=False.** QR is now confirmed end-to-end on real hardware (2026-09-13 evening): the E53's scanner reads a QR, pushes `POST /device/callback/identify?type=qrCode_0&personId=5001` (handler 1.4 ms), and the sign-out chain follows. A revoked credential is correctly refused ("unregistered"). Card mode stays off (card-only is not a supported visitor path) |
| 4 | **F1 — stale-record loop + wrong-visitor sign-out** | ✅ **FIXED — UStarAPI 1.5.6.** Business refusals are acked and dropped (`GasSignOutStatus.Rejected`) instead of holding the watermark forever; `SignOut:MaxRecordAgeHours` (default 24) bounds replay; GAS `_signOutVisitor_` refuses a stale event that predates the row's check-in. 430 tests |
| 5 | **F1b — a noop left an orphaned credential on the reader** | ✅ **FOUND + FIXED — UStarAPI 1.5.6.** Found by the QR bench loop: GAS committed the sign-out, the response was lost to the client's 15 s timeout, the retry saw the card released and got `noop` — and the old rule ("noop ⇒ no device delete") left a live face **and** QR on the door while the sheet said Signed Out. A noop now de-provisions, **except** `stale_event` (where the card belongs to a current visitor and deleting would lock them out). GAS `signOutByCard` now reports a `reason` |
| 6 | **F3 — admin authorisation** | ✅ **STAGES 1+2 SHIPPED — Code 1.21.0 / kiosk 1.0.3.** Stage 1: `register` + `admin` share one origin gate, refusals audited (explicitly *not* an auth boundary — the origin is client-asserted and GAS answers `ACAO: *`). Stage 2: `guardPin` is **no longer published**; `?action=guardLogin` validates it server-side (constant-time, 15/15min lockout, audited, fails closed) and `report`/`bulkSignOut` require it. Residual risks + deploy order: `docs/SECURITY-F3-ADMIN-AUTH.md` |
