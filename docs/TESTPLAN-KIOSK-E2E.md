# LITEVM ↔ Verify Kiosk — E2E Integration Test Plan

> Scope: the **integration suites** that prove the LITEVM product works
> together with the local Verify Kiosk (the guard's on-prem Windows-service
> kiosk). These suites live on the LITEVM side because they exercise LITEVM
> tenants, GAS backends, and the ACTApi/UStarAPI gateway chain — the kiosk is
> the front surface, LITEVM is the system under test.
>
> Kiosk-internal functional suites (login, lookup, check-in UI, bulk, i18n,
> resilience) are owned by the kiosk repo: see `verify-kiosk/TESTPLAN.md`
> (K-suites). This plan covers the **I-suites** (I1 visitor lifecycle, I2 ACT
> door, I3 UStar provisioning) plus LITEVM-side preconditions and evidence.

Companion to `TESTPLAN-ONLINE.md` (the online-only regression suite). Run this
plan whenever the on-prem deployment flavor changes: kiosk wiring, gateway
URLs, ACT/UStar config, provisioning logic, or the tenant's card/door plan.

---

## 0. Environment & preconditions (on-prem flavor)

| Item | Value / rule |
|---|---|
| Online parts | GAS /exec live; master config; **dedicated QA tenant** (never a live customer); GitHub Pages portal reachable |
| Kiosk | VerifyKiosk service Running on the test box (192.168.2.238) — `http://192.168.2.238:8123`; settings.json points at the QA tenant (`SHEET_ID`, `API_BASE`, `GUARD_PIN`) |
| Gateways (optional per suite) | ACTApi `ACTApiBase` (e.g. `http://192.168.2.113:8021`) — Pro-tier tenant; UStarAPI `UStarApiBase` (e.g. `http://192.168.2.113:8091`) + matching `LITEVM_SECRET` |
| ACT WCF server | 192.168.2.217:8004 reachable when I2 requires real ACT grant/revoke |
| Reader (optional) | E53 bench 192.168.2.211:8090 for I3-4 face/QR enrolment |
| Test identity | `QA-<YYYYMMDD-HHMM>-<seq>`; reset VisitorLog + card pool between runs |
| Emails | ≤2 real sends per run (quota resets 14:00 WIB) |
| Evidence | `qa-out/<date>/` — screenshots, network traces, sheet snapshots, ACT/UStar API responses |

**Flavor reference:** online-only vs on-prem deployment differences — see
`deployment-flavors-online-onprem-2026-08.md` (auto-sign-out: GAS hourly is
universal; `auto-signout.py` is the optional ACT-revoke companion).

**Kiosk config contract:** all in ONE `wwwroot/settings.json` on the kiosk
box. `ACTApiBase`/`UStarApiBase` empty = online mode (no gateway calls).
Check-in POST returns `cardNo`/`doorGroupId` from the BACKEND response — the
kiosk never guesses them from cached state (data-provenance rule).

---

## 1. Suites

### I1 — End-to-end visitor lifecycle (the money test)

| ID | Test | Steps | Expected |
|---|---|---|---|
| I1-1 | Register online | POST registration (QA identity) to GAS /exec OR via hosted portal | Status `Pending Entry`; confirmation email (≤1 real send) |
| I1-2 | Kiosk sees visitor | Load kiosk today list (K2 login first) | Visitor appears; Pending count +1 |
| I1-3 | Guard checks in at kiosk | Kiosk lookup → Check-in | Success; card assigned from the correct door-group block; QR shown; card email arrives (≤1 real) |
| I1-4 | Sheet truth | Read VisitorLog + cardno (GAPI) | `Checked In`; card `Assigned`/AssignedTo = VN; Destination + Visitor Type correct; DoorGroupID intact |
| I1-5 | Guard signs out at kiosk | Kiosk lookup → Sign-out | `Signed Out`; card `Available`; AssignedTo/At cleared; DoorGroupID preserved |
| I1-6 | Card reuse | Repeat I1-1..I1-5 with second visitor | Same freed card re-drawn; no stale assignment |
| I1-7 | Tenant isolation | QA tenant kiosk vs demo tenant | Zero leakage between tenants (rows, cards, counts) |
| I1-8 | Auto sign-out interplay | Set QA `autoSignOutHour` = current hour; leave one visitor Checked In | GAS hourly tick signs out cloud-side (kiosk list updates on next refresh) — proves the safety-net path |

### I2 — ACTApi door integration (requires ACT server reachable + Pro tier)

| ID | Test | Steps | Expected |
|---|---|---|---|
| I2-1 | ACT entitlement | QA tenant tier Pro+; kiosk config fetch | `actEnabled: true` in kiosk config path |
| I2-2 | Grant on check-in | Check in at kiosk with ACTApiBase set | PUT `/api/users/{cardNo}/extra-rights` fires with rights array (doorGroup + timezone + validity window from `ACTExtraRights`); ACT side confirms access |
| I2-3 | Revoke on sign-out | Sign out at kiosk | DELETE `/api/users/{cardNo}/extra-rights` fires; ACT side confirms removal |
| I2-4 | Photo proxy | View QA visitor photo at kiosk | Served via `/api/photo-proxy?id=` (no referrer 403) |
| I2-5 | Non-Pro tenant | Non-Pro tier + ACTApiBase set | Grant/revoke SKIPPED (kiosk logs only) — `_actEnabled` gate |
| I2-6 | ACT down resilience | Stop ACTApi; check in | Check-in still succeeds; ACT grant failure logged non-blocking (kiosk K8-6) |

### I3 — UStarAPI gateway provisioning (requires gateway; reader optional)

| ID | Test | Steps | Expected |
|---|---|---|---|
| I3-1 | Provision on check-in | Check in at kiosk with UStarApiBase set | POST `/api/litevm/provision` with `X-Litevm-Secret` header; response `provisioned[].success` true |
| I3-2 | Wrong secret | Mismatch `LITEVM_SECRET` vs gateway | 401; kiosk shows persistent red provision banner; check-in itself succeeded |
| I3-3 | Gateway down | Dead UStarApiBase | Provision fails gracefully; red banner + retry; no impact on check-in |
| I3-4 | Retry succeeds | Fix target → click retry | Provision succeeds; banner clears |
| I3-5 | Reader effect (optional) | E53 bench reachable | Person on device with face + QR credential (faceCount 0→1) |
| I3-6 | Online-mode skip | UStarApiBase empty | NO provision call (network panel) — gateway optional |

---

## 2. Change → required suites

| Change | Required |
|---|---|
| Kiosk wiring / settings.json (base URLs, secret) | I1 Quick + I2/I3 for configured gateway |
| ACTApi / door-grant logic | I2 (full) |
| UStarAPI provisioning | I3 (full) |
| LITEVM backend check-in/out response shape (cardNo/doorGroupId) | I1-3/4/5 + kiosk K4 |
| Card pool / door-group plan change | I1-3/4 + I1-6 |
| Tenant tier/expiry changes | I2-1/5 + I1-7 |
| **Any on-prem change** | I1 Quick: I1-1 → I1-3 → I1-5 smoke |

---

## 3. Test log template

```markdown
## Run: <date> — <kiosk commit> / <LITEVM version> — <tester>
Environment: Kiosk = http://<box>:8123 | Tenant = <qa id> | ACT = <url> | UStar = <url>
Outcome: ⚠ <N> failed / ✅ <N> passed

| ID | Expected | Actual | Result | Notes |
|----|----------|--------|--------|-------|
| I1-3 | card assigned + QR | ... | ✅/❌ | ... |
```

---

## 4. Related
- Kiosk functional suites (K0–K10): `verify-kiosk/TESTPLAN.md`
- Online-only LITEVM regression (T0–T11): `TESTPLAN-ONLINE.md`
- Deployment flavors: `deployment-flavors-online-onprem-2026-08.md`
- Skills: `litevm-ecosystem`, `rvmsv2-ecosystem` (ACT WCF), `ustarapi-ecosystem`
