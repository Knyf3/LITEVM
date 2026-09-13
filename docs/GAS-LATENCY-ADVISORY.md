# GAS Latency — Diagnosis & Advisory

Date: 2026-09-13 · Scope: LITEVM cloud backend (Apps Script + Sheets + Drive) as used by the
hosted portal, the on-prem kiosk, and the report page.

---

## 1. What was measured

All times are wall-clock for a single `/exec` call, same endpoint, same tenant.

| Regime | Sample | Result |
|---|---|---|
| **Quiet system** (kiosk service stopped, nothing polling) — 8 consecutive `?action=config` | 5.98 / 6.58 / 6.40 / 8.14 / 5.83 / 6.16 / 6.71 / 5.43 s | **5.4–8.1 s, all HTTP 200, tight spread** |
| **Loaded system** (kiosk polling every 30 s + a burst of test calls) — 6–7 consecutive calls | 43.4 / 4.7 / 5.3 / **41.0 (404)** / **120.8 (302)** / 6.6 s | **wildly bimodal, with transport failures** |
| **Trivial action, quiet** — `?action=health` | 5.08 / 12.4 s | ~as slow as any real read |
| **Different actions, quiet** | `config` 5.27 s · `today` 6.34 s | every action costs about the same |
| **Same POST, two clients** | curl `report` **6.8 s** vs browser `fetch` `report` **30.9 s** | browser pays ~4.5× |
| Idle effect | 30 s idle then one call → 10.4 s | mild cold-start component |

---

## 2. Diagnosis — this is two problems, not one

**P1 — a fixed ~5–8 s cost per invocation, independent of the work done.**
`health` (which touches almost nothing) costs the same as `config` and `today` (which open the
master config and the customer sheet). That means the cost is **per-call**, not per-unit-of-work:
Apps Script routing + container start + the `script.google.com` → `script.googleusercontent.com`
redirect hop + the sheet open. **Optimising JavaScript inside `Code.gs` therefore buys almost
nothing** — the ceiling is set by the invocation itself.

**P2 — concurrency amplification: overlapping calls turn 6 s into 20–120 s.**
The kiosk refreshes its today-list with `setInterval(loadTodayVisitors, 30000)`. A refresh cannot
finish inside 30 s when a call takes 6–8 s *and* a check-in is in flight (the script holds a
`LockService` lock for the write). Requests therefore stack, Apps Script queues/serialises them
(consumer accounts allow 30 concurrent executions), and the client sees the queue — hence 41 s and
120 s, and the 404/302 artefacts in the chain. **A poll whose interval is shorter than its own
response time is a permanent self-inflicted load.** Today's worst numbers were partly created by
our own testing plus that poll; on a quiet system the same endpoint is a steady ~6 s.

**P3 — a browser tax of roughly 2–4.5×.**
The identical report POST took 6.8 s via curl and 30.9 s in a browser. The redirect chain is far
more expensive for a browser client than `curl -L` suggests, and a few chains contained 404s.
Not yet root-caused (see caveats) — but it means **designing for the browser's number, not curl's**.

**Consequence that drives every recommendation below:** latency scales with
**(number of round trips) × (concurrency)**, not with the amount of data processed.

---

## 3. Fixes, ordered by impact ÷ effort

### Tier 1 — no architecture change, removes most of the pain
1. **Fix the kiosk refresh.** Replace `setInterval(fn, 30000)` with a self-scheduling
   `setTimeout` that fires **after** the previous call completes, at a 60–120 s cadence, with a
   single-flight guard (never two in flight) and a pause while a check-in/sign-out is running.
   *This is the single highest-value change and it is a few lines of JavaScript.*
2. **Add a `bootstrap` action** returning config + destinations + visitorTypes + today in **one**
   response. Kiosk boot goes from 3–4 calls to 1 → saves 12–25 s per boot.
3. **Client timeouts + idempotent retry.** Never treat a slow/odd response as a failure — that is
   exactly what silently dropped provisioning (defect F2). Time out generously (60–120 s), then
   retry the *provisioning step* independently of the UI.
4. **`CacheService` caching** (5-minute TTL, invalidate on write) for config, destinations,
   visitor types and settings. Cheap, and removes repeated sheet opens for repeat reads.

### Tier 2 — one large in-request cost
5. **Move the check-in email off the request path.** The v1.19.0 hybrid sends the card email
   *inside* `updateStatus`; a Gmail send is seconds-to-tens-of-seconds. The `EmailQueue` +
   trigger sweep already exists. Trade-off to accept explicitly: instant delivery costs
   ~3–25 s on every check-in. Sensible split: **instant for registration** (the visitor is
   waiting), **queued for check-in** (the guard is waiting).
6. **Photos.** Each registration does two Drive creates plus `setSharing`. The selfie must stay
   in-request (provisioning needs its URL); the ID photo could be deferred.

### Tier 3 — structural, only if on-prem must feel local
7. **Extend the local gateway into a caching facade.** The on-prem install already runs a .NET
   service on the customer's LAN. Giving it a tenant cache (config/today) and an async write
   queue with retries would put the guard's interactions at LAN latency (~ms) and let GAS latency
   affect only the cloud copy. Days of work, and it adds sync complexity — but it is the real
   answer for the on-prem flavour.
8. **Longer term, Sheets is not a database.** For high-volume tenants the SimplVM/RVMSv2
   (SQL Server + API) direction is the right shape. That is a product decision, not a bug fix.

### Tier 4 — headroom, not speed
9. **Business Workspace tenant (`itt.web.id`)** lifts the 90 min/day runtime and 100 emails/day
   consumer caps. It does **not** reduce latency — do it for quota headroom, not for speed.
10. **Watch the Executions page** for `Exceeded maximum execution time` and quota errors, and
    compare duration against our own call volume. Consumer accounts allow 30 concurrent
    executions — a polling kiosk plus test traffic consumes them.

---

## 4. Recommended order

1. Tier 1 items 1–3 (a day's work, mostly kiosk-side). Expected: the 20–120 s outliers disappear
   and check-ins return to ~10–15 s.
2. Tier 1 item 4 + Tier 2 item 5. Expected: check-in ~6–8 s, i.e. roughly the platform floor.
3. Re-measure, then decide on Tier 3 — with real numbers rather than a hunch.

**Do not** start by micro-optimising `Code.gs`: `health` proves the floor is the invocation itself.

---

## 5. Honest caveats

- I did **not** instrument inside `Code.gs`. The 5–8 s split between cold start, sheet opens and
  the redirect hop is inferred from action-independence, not measured per phase. One hour of
  phase timing (`Date.now()` deltas written to a hidden tab) would settle it.
- The **browser 30.9 s vs curl 6.8 s** comparison is solid for that POST, but my redirect-hop
  counts were contaminated by the portal page's own traffic. One clean re-test (isolated page,
  no polling) would confirm whether the tax is the redirect chain or retries.
- **404s appeared in some chains** and are unexplained — possibly expired content keys with a
  retry. Worth one focused test before treating the platform as "just slow".
- Today's baseline was partly self-inflicted: the kiosk's 30 s poll plus an aggressive test
  sequence. Treat "GAS is broken" as too strong a claim; the accurate statement is **a slow
  platform with a per-call floor, made far worse by overlapping requests.**

---

## 6. Tier 1 + Tier 2 — implemented and verified (2026-09-13)

### What shipped

**Backend — `apps-script/Code.gs`, `CODE_VERSION` 1.19.0 → 1.20.0**
1. **Read-through cache layer** (`cachedRead_` / `_cacheGetJson_` / `invalidateReadCache_`).
   Settings is cached for **120 s** (it carries the guard PIN and auto-sign-out hour, so
   operator edits must propagate quickly); Destination and VisitorType for **300 s**.
   A null/undefined producer result is never cached, so a transient failure cannot be frozen.
   Invalidation is wired into `ensureSettingRow_` and `_setSettingValue_` (i.e. every Settings
   writer), via `tab.getParent().getId()`.
2. **`?action=bootstrap`** — config + destinations + visitor types + today's list in ONE
   response. `_configPayload_`, `_destinationsData_`, `_visitorTypesData_` and `_todayData_`
   were extracted so `config`/`destinations`/`visitorTypes`/`today` and `bootstrap` share one
   implementation and cannot drift. Today's list is deliberately **never** cached.
3. **Card email moved off the request path** (Tier 2). `CARD_EMAIL_MODE` Script Property,
   default `queue` → appended to `EmailQueue` and delivered by the 5-minute sweep;
   set `immediate` to restore v1.19.0 in-request send **without a redeploy**. Registration
   email is untouched — there the *visitor* is waiting, not the guard.

**Frontend — `verify.js` (on-prem kiosk AND hosted portal; the two files were byte-identical)**
1. **Self-scheduling refresh** replaces `setInterval(fn, 30000)`: a `setTimeout` armed from the
   *end* of the previous call (90 s steady state, 15 s re-check while an action is in flight),
   a single-flight guard, and a 120 s abort timeout so a hung request cannot wedge the loop.
2. **Boot via `?action=bootstrap`**, degrading to `config` + `today` if the backend has not been
   redeployed — the client must work against either generation.
3. **Timeouts + idempotent recovery.** A check-in whose response is lost, times out, or arrives
   non-JSON now triggers `recoverAfterAmbiguousAction()`: re-read the visitor via `lookup` (3
   attempts, backoff) and settle the UI on what the **sheet** says — including provisioning, so a
   lost response can no longer silently cost the visitor their door credential.
4. **F4 fixed**: `hasActApi()` requires a non-empty `ACTApiBase`. The old `!== null &&
   !== undefined` test let `""` through, so with the shipped demo `settings.json`
   (`"ACTApiBase": ""`) every sign-out fired a 404 at the kiosk's own origin.

### Evidence

| Check | Result |
|---|---|
| GAS harness (`/tmp/gas_harness.js`, real `Code.gs` in a stubbed VM) | **32 passed, 0 failed** |
| Live kiosk vs real (pre-`bootstrap`) backend | gap between today-reads **100.1 s** (90 s idle + 10 s call), **max concurrent 1**, bootstrap falls back cleanly |
| Live kiosk with the boot payload intercepted | config + destinations + types + today applied in **1 call**, **0** separate today fetches, badge = 2 |
| Live recovery: real visitor, response destroyed *after* commit | kiosk settled `data-state=verified`, no error; sheet = `Checked In`, card 5001, selfie set |

The harness also caught a trap worth remembering: a `Date` created outside the Node `vm`
context fails `instanceof Date` inside it, which had made fixture dates look like strings.
Share the constructor (`sandbox.Date = Date`) or the harness silently tests the wrong branch.

### F5 — provisioning blocked by CORS (pre-existing) — **FIXED & VERIFIED 2026-09-13**

**Symptom.** A real check-in recovers correctly, then:
`Access to fetch at 'http://192.168.2.194:8091/api/litevm/provision' from origin
'http://192.168.2.238:8123' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present`. The visitor is checked in with a card, but **no credential ever reaches the
reader** — the door never opens. The kiosk raises the red provisioning banner (correct
behaviour, and how this was caught).

**Cause.** `UStarAPI/Program.cs` reads `Cors:AllowedOrigins`; when the list is empty it defaults
to `http://localhost:8123` / `http://127.0.0.1:8123`. A kiosk browsed at
`http://<host-ip>:8123` is therefore **not** an allowed origin. `kiosk` and `gateway` on the same
box are still cross-origin (port differs), so this bites at every site where the kiosk is
reached by IP rather than localhost. Earlier full-stack runs proved provisioning only with a
direct server-side call, which is why this was never seen.

**Fix applied (the supported mechanism, not a workaround).** `Cors:AllowedOrigins` on the gateway
is exactly the hook for this, so the gateway's `Settings/Settings.json` now carries:

```json
"Cors": { "AllowedOrigins": [ "http://192.168.2.238:8123", "http://localhost:8123", "http://127.0.0.1:8123" ] }
```

(backup: `Settings.json.bak-cors-20260913`; gateway service restarted). localhost/127.0.0.1 are kept
so a co-located kiosk browsed locally still works.

**Verification (with a control):**

| Probe | Result |
|---|---|
| `OPTIONS` preflight from the kiosk origin | `Access-Control-Allow-Origin: http://192.168.2.238:8123` |
| `OPTIONS` preflight from `http://evil.example` | **no allow header** — the list is still an allow-list, not a wildcard |
| Real kiosk check-in, real face (public-domain portrait), no mangling | console `UStar provision succeeded for card 5002`; device `face 2 → 3` |
| Real kiosk check-in, response destroyed after commit (recovery path) | kiosk settled `verified`; the POST reached the gateway and returned a structured result |

Two device codes surfaced while proving this, both **correct refusals rather than defects**:
`LAN_EXP-8006` = *No faces detected* (my 1×1 px test image), and `LAN_EXP-3056` = *Face has been
registered* (the same portrait was already enrolled on the reader as person 5061). Both are worth
knowing: a re-used selfie cannot be enrolled twice on this firmware.

**Still recommended (durable fix, not yet done).** The allow-list is per-site configuration: every
deployment must add that site's kiosk origin, and the failure mode is silent (a red banner at best).
Two better options, in order:
1. **KioskServer same-origin proxy** — the kiosk page POSTs to its own origin (`/api/litevm/provision`)
   and the .NET server forwards to the gateway with the secret. No CORS, no shared secret in the
   browser, retries server-side. Needs a kiosk build + installer.
2. **Gateway default** — when `Cors:AllowedOrigins` is empty, default to localhost *plus the host's
   own IPv4 addresses at port 8123*, so a co-located kiosk works out of the box. Needs a gateway build.

**Sibling risk (same class, live and unverified).** `ACTApi/Program.cs` enables CORS only when its
own `CorsOrigins` setting is non-empty, and the kiosk calls ACTApi cross-origin for
`grantActAccess` (PUT) / `revokeActAccess` (DELETE). With `ACTApiBase` set at a real site and
`CorsOrigins` empty, door-access grant/revoke will fail exactly the way provisioning did. It could
not be tested on the demo kiosk (`ACTApiBase: ""`). Add the kiosk origin to ACTApi's `CorsOrigins`
per deployment, or route ACT through the same-origin proxy.

**Cleanup performed:** probe visitors signed out (cards 5001/5002 returned to the pool), test
persons deleted from the reader via `DELETE /api/litevm/persons/{card}?doorGroupId=2` (the
**doorGroupId parameter is required** — persons are group-scoped), recognition records verified at
zero, device restored to its pre-test baseline `person=2 face=2 finger=3`.

