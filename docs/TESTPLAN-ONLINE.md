# LITEVM — Online-Only Test Plan (Regression Suite)

> Scope: **Online-only deployment flavor** — GitHub Pages frontend (index /
> verify / report) + GAS backend + Sheets DB + Drive photos + email/WhatsApp
> notification bridge. NO on-prem components: no ACTApi, no UStarAPI, no local
> verify-kiosk, no LAN reader provisioning. A separate plan covers on-prem.

Purpose: a reusable, evidence-based checklist to (a) confirm a LITEVM deployment
is working, and (b) re-run after every change/fix to prove no regression slipped
in. Run the **Quick** set after any deploy; run **Full** before go-live or after
structural changes (migrations, header refactors, card-pool logic).

---

## 0. Environment & preconditions

| Item | Value / rule |
|---|---|
| GAS /exec URL | Use a **dedicated test tenant**, never a live customer sheet |
| Master config sheet | Read-only access needed (Customers tab) |
| Test sheet | A disposable customer template copy; reset between runs (clear VisitorLog rows 2+, cardno all `Available`) |
| Test identity | Every test visitor named `QA-<YYYYMMDD-HHMM>-<seq>` so rows are identifiable and purgeable |
| Notifications | Keep email/WhatsApp volume to ≤2 real sends per run — consumer quota is 100/day (GAS) and resets 14:00 WIB; sending to invalid addresses still counts against quota |
| Evidence | Save curl bodies to `qa-out/` with timestamp; screenshot UI flows; HTTP 200 ≠ success — ALWAYS check response body `status` |
| Resets | After card tests, release all cards (sign out all QA visitors) before the next suite |

**Authoritative action list:** `apps-script/Code.gs` — `doGet` (GET actions)
and `doPost` (POST actions). If this plan references an action that no longer
exists, the code changed — update this plan and flag the drift.

**POST curl pattern (documented 2026-08-31):**
```bash
curl -sL --max-time 90 "URL" -H "Content-Type: text/plain" -d '{"action":"...","sheetId":"..."}' -w "\nHTTP %{http_code} in %{time_total}s\n"
```
GAS POST returns 302 to `script.googleusercontent.com` — the follow-up MUST be
GET (curl `-L` handles it). Never `--post302` / `-X POST` on hop 2. Content-Type
must be `text/plain` (avoids preflight). Always print HTTP code + latency.

---

## 1. Suites & test cases

ID scheme: `T<suite>-<n>`. Expected values assume canonical sheet headers
(15-col VisitorLog etc.) — header-name resolution, not column letters.

### T0 — Deployment sanity

| ID | Test | Steps | Expected |
|---|---|---|---|
| T0-1 | Backend reachable | GET `?action=health` | HTTP 200, `{"status":"ok",...}` with the deployed version string |
| T0-2 | Deployed version matches intent | Compare health `version` with the GAS editor deployment version you intend | Match (mismatch = stale deploy) |
| T0-3 | Master config reachable | POST `config` for the test customer | `status:"ok"` + config fields (timezone, retentionDays, expiryState etc.) |
| T0-4 | Test tenant active | `config` response for test sheet | Not expired/disabled/paused (`ACCOUNT_DISABLED`/`expired` absent) |
| T0-5 | Portal loads | Open `https://knyf3.github.io/LITEVM/` | index renders, no console 404s, config.js values correct |

### T1 — Sheet DB integrity (test sheet)

| ID | Test | Steps | Expected |
|---|---|---|---|
| T1-1 | VisitorLog headers | Read headers row | Canonical 15 in order: `Timestamp, Full Name, ID / Passport Number, Company Name, Destination, Visitor Type, Visitation Date, Hand Phone, Email, ID Photo (Drive URL), Selfie (Drive URL), Visitor Number, Status, Sign-In Time, Sign-Out Time` |
| T1-2 | cardno headers | Read headers row | `CardNo, Status, AssignedTo, AssignedAt, DoorGroupID` |
| T1-3 | Card pool intact | Read cardno rows | 215 rows 5001–5215, all `Available`, blank AssignedTo/AssignedAt; group blocks 5001–5120 (20 per DoorGroup 2..7) | 
| T1-4 | Destination tab | Read rows | Destinations with DoorGroupID values matching the customer's door groups |
| T1-5 | Settings tab | Read rows | autoSignOutEnabled / autoSignOutHour / guardPin present |
| T1-6 | Schema version | Check hidden `_version!A1` (test sheet) | `SHEET_VERSION` matches current MIGRATION_REGISTRY head |
| T1-7 | No stray columns | `cardpool` action + GAPI full-range read | Status col E survives assignment/release writes; no extra/missing columns |

### T2 — Registration

| ID | Test | Steps | Expected |
|---|---|---|---|
| T2-1 | Register happy path | POST `registration` with full valid payload (name, ID, company, destination from the Destination tab, visitor type, visitation date = today, phone, email) | `status:"ok"`, visitor number returned; `Status` = Registered |
| T2-2 | Row written correctly | Read back the sheet row (by visitor number) | All fields in the CORRECT columns (esp. Destination idx 4, Visitor Type idx 5 — the old drift bug); no empty destination/visitorType |
| T2-3 | Duplicate-ish ID accepted/rejected per design | Register second visitor with same ID number | Matches documented behaviour (record the outcome; flag if it silently overwrites) |
| T2-4 | Photo upload | Register with ID photo + selfie | Drive URLs stored in the correct columns; files openable |
| T2-5 | Invalid destination | Register with a destination NOT on the Destination tab | Graceful error, no partial row |
| T2-6 | Missing required field | Register without phone/name | Clear validation error, no row appended |

### T3 — Lookup, check-in, card assignment

| ID | Test | Steps | Expected |
|---|---|---|---|
| T3-1 | Lookup by visitor number | POST/GET `lookup` for a Registered QA visitor | Row returned with correct destination/visitorType/status |
| T3-2 | Lookup by card | After assignment, GET `lookupByCard` | Matches the visitor |
| T3-3 | Check-in happy path | POST `updateStatus` → `Checked In` for a QA visitor whose destination maps to a door group | `status:"ok"`; card assigned from the CORRECT door-group block; cardno row = `Assigned` + AssignedTo = visitor number |
| T3-4 | Card pool decremented | Re-run `cardpool` | Correct count; the specific card shows `Assigned` |
| T3-5 | No cross-group steal | Check in a second visitor whose destination maps to a different door group | Card comes from that group's block, not an Assigned card from another group |
| T3-6 | Reject path | POST `updateStatus` → `Rejected` for a fresh visitor | Status `Rejected`; no card assigned; row consistent |
| T3-7 | Double check-in guarded | Attempt check-in on an already Checked-In visitor | Rejected/guarded, no duplicate card assignment |

### T4 — Sign-out & card release

| ID | Test | Steps | Expected |
|---|---|---|---|
| T4-1 | Sign-out by visitor | POST `updateStatus` → `Signed Out` for a Checked-In QA visitor | Status flips; card returns `Available`; AssignedTo/AssignedAt cleared; **DoorGroupID column preserved** |
| T4-2 | Card reusable | Check in another QA visitor right after T4-1 | The freed card (or an Available one in the group) is assignable |
| T4-3 | Sign-out of never-checked-in | Attempt sign-out of a Registered-only visitor | Guarded error — must be Checked In first |

### T5 — Bulk & auto sign-out

| ID | Test | Steps | Expected |
|---|---|---|---|
| T5-1 | Bulk sign out (portal) | Check in 3 QA visitors, then Bulk Sign Out in the guard portal | All flip to `Signed Out`; all cards released to `Available` |
| T5-2 | Auto sign-out trigger exists | Apps Script Triggers page (or code) | Daily maintenance + autoSignOut trigger present, schema version matches TRIGGER_SCHEMA_VERSION |
| T5-3 | runAutoSignOut action | GET `?action=runAutoSignOut` on a tenant whose hour matches now (or after temporarily setting autoSignOutHour = current hour) | Checked-In visitors from today sign out; idempotent second run changes nothing |

### T6 — Retention purge (destructive — dry-run FIRST)

| ID | Test | Steps | Expected |
|---|---|---|---|
| T6-1 | Dry-run | POST `mode=retentionDryRun` | Counts rows strictly older than `retentionDays`; NO rows deleted; PurgeLog not written for the dry run |
| T6-2 | Real purge (optional, on disposable tenant) | POST retention purge with small `retentionDays`; seed an old-dated row (visitation date string in the past) | Old rows deleted; photo files trashed (not permanently deleted); PurgeLog row appended |
| T6-3 | Future/current rows survive | Verify after purge | Today's QA rows remain; ISO-unparseable dates are skipped + logged, never crash |

### T7 — Expiry

| ID | Test | Steps | Expected |
|---|---|---|---|
| T7-1 | Expiry dry-run | POST `mode=expiryDryRun` | Per-customer expiryState reported; no status mutation |
| T7-2 | Config expiryState | POST `config` on a tenant with expiryDate near/far | `expiryState` none/active/expiring/expired per remaining days |
| T7-3 | Banner logic (frontend) | In verify portal with an expiring tenant | Amber dismissible banner; expired tenant → red non-dismissible + login blocked (detect via `error` text, NOT expiryState — config is denied when expired) |

### T8 — Email / notification

| ID | Test | Steps | Expected |
|---|---|---|---|
| T8-1 | EmailQueue tab exists | Read test sheet | Hidden tab `EmailQueue` with headers `Timestamp, Type, To, Subject, Body, Status, Attempts, LastError` |
| T8-2 | Email sent + queue drained | Register with a REAL recipient address (≤2 per run) | EmailQueue PENDING → SENT; email arrives; Attempts stays sane |
| T8-3 | Failure path (optional) | Trigger send to an invalid address | Status PENDING→FAILED after 3 attempts with LastError, never lost |
| T8-4 | Dirty-flag efficiency | Observe trigger logs briefly | Idle sweep returns fast (EMAIL_QUEUE_DIRTY not set) — no per-customer sheet open per tick |

### T9 — Hosted frontend (GitHub Pages)

| ID | Test | Steps | Expected |
|---|---|---|---|
| T9-1 | Registration page | index.html full flow on phone viewport | Validation, photo capture, submit → visitor number via WhatsApp/screen; no console errors |
| T9-2 | Guard portal | verify.html login with guardPin → today list | Lists today's registrations; check-in/sign-out/bulk work (cross-check T3/T4/T5) |
| T9-3 | Report page | report.html loads | Data renders; no errors |
| T9-4 | i18n | Toggle EN/ID on index + verify | Labels switch; no missing-key placeholders |
| T9-5 | Cached-asset bust | Verify versioned query strings (`?v=N`) bumped after a frontend deploy | Browser gets new assets (hard refresh not required for correctness) |

### T10 — Post-change static checks (developer greps)

Run after ANY `Code.gs` change (before live endpoint tests):

| ID | Check | Command (approx) | Expected |
|---|---|---|---|
| T10-1 | No positional sheet access in scope | Grep `data[i][<digit>]`, `getRange(i + 1, <digit>` in changed code | Only header-name resolution via `resolveColumns` |
| T10-2 | Node syntax | `cp Code.gs /tmp/x.js && node --check /tmp/x.js` | Clean parse |
| T10-3 | Trigger intervals legal | Grep `everyMinutes(` | Only 1/5/10/15/30 — NEVER `everyMinutes(2)` |
| T10-4 | Header constants == migrations | Compare VISITORLOG_HEADERS/CARDNO_HEADERS with migration V7 + live sheet | All three agree |
| T10-5 | Email fallback intact | Grep enqueue/send path | Email never silently dropped; EmailQueue fallback present |
| T10-6 | Date coercion handled | Grep Date-cell reads on config columns | `instanceof Date` → format-then-parse pattern present |

---

## 2. Change → required suites (use this every time)

| Change | Required |
|---|---|
| GAS backend deploy (any Code.gs) | T10 static checks → T0 → T1 → T2 → T3 → T4 (T6/T7 if retention/expiry code touched) |
| New/edited migration (MIGRATION_REGISTRY) | T1-6 + fresh-template-copy simulation + T1-1/T1-2 header checks |
| Header/column refactor | T1 (full) + T2-2 + T10-4 |
| Card-pool / door-group logic | T3-3..T3-5, T4, T5-1 |
| Email/queue change | T8 (full) — mind quota, ≤2 real sends |
| Retention change | T6 (dry-run mandatory first) |
| Expiry change | T7 |
| Frontend (index/verify/report/lang) | T9 + T7-3 if banner touched + T0-5 |
| config.js / settings template | T0-5, T9-1 smoke |
| Secret/entitlement/gate logic | T0-4 + T7-2/3 |
| **Any change** | Quick regression: T0-1, T2-1, T3-3, T4-1, T9-2 smoke — then the full suite for the touched area |

---

## 3. Test log template

```markdown
## Run: <date> — <deploy version> — <tester>
Environment: GAS /exec = <url> | Test sheet = <id> | Portal = <url>
Outcome: ⚠ <N> failed / ✅ <N> passed

| ID | Expected | Actual | Result | Notes |
|----|----------|--------|--------|-------|
| T2-1 | status ok + visitor number | ... | ✅/❌ | ... |
```

Evidence dir: `qa-out/<date>/` (curl bodies, screenshots). On failure: capture the
exact request, response body, sheet state, and Apps Script execution log — then fix,
redeploy, re-run the affected suite AND the Quick regression.

---

## 4. Out of scope (future plan: on-prem)

- verify-kiosk (verifylocal.html / serve_local.ps1 / settings.json / GUARD_PIN)
- ACTApi integration (ACTApiBase, photo-proxy, extra rights)
- UStarAPI gateway (UStarApiBase, provisionUstar, sign-out polling, X-Litevm-Secret)
- Reader/device enrolment chains (face/QR/card on UniUbi)
- On-prem auto-sign-out companion script
