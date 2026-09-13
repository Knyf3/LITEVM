# F3 — admin authorisation on the LITEVM backend (origin gate → server-side PIN)

**Status:** stage 1 (origin gate + audit) and stage 2 (server-side guard PIN) implemented 2026-09-13 in
Code.gs **1.21.0**. Portal (`report.js`) and kiosk (`verify.js` 1.0.3) clients updated.
**Found by:** the full-stack E2E pass, L-suite L8 — a `report` request from a foreign origin returned
the full payload.

---

## What was actually wrong (three layers)

The plan's R15 asserted *"`action=report` from a non-allowlisted origin → 403"*. It had **never**
held. Unpicking it produced three separate defects, each of which hides the next:

### 1. Admin actions were exempt from the origin check
`validateRequest` ended with `if (endpointType !== 'register') return …`, so `report`, `bulkSignOut`,
`retention*`, `expiry*` and `assignedCards` — everything classified `admin` — skipped the origin
check entirely.

Live evidence, before any fix:

| Request | HTTP | Result |
|---|---|---|
| `report` with `body.origin = "http://evil.example"` | 200 | **9 visitor rows returned** |
| `report` with `body.origin` omitted | 200 | 9 rows |
| `report` with `body.origin = "<the allow-listed value>"` | 200 | 9 rows |

### 2. The origin check was client-asserted — so it could never be a security boundary
`_extractOrigin_` parses **`body.origin`**, a JSON field the *caller* supplies. Apps Script Web Apps
do not expose HTTP request headers, so there is no alternative source. The practical consequences:
any caller can omit the field (sail through), or claim the allow-listed value (sail through). This is
why "copy the register check to admin" — the original recommendation — would have been **security
theatre**, and why it was not shipped.

### 3. `Access-Control-Allow-Origin: *` made it a *browser* problem, not just a script problem
Every GAS response carried `ACAO: *`, so any web page in any browser could read the report payload.
That is Google's fixed behaviour for `/exec` and cannot be configured away — which is the decisive
argument that **origin cannot be the control for this architecture**. Only authentication can be.

Compounding it: the guard PIN was published by `?action=config` (so a client could "compare" it
locally), and the sheet ID ships in the public portal config. Net posture: a public identifier, a
published PIN, and a payload any page could read.

---

## Stage 1 — origin gate + audit trail (kept, but downgraded in the docs)

* One shared `_originAllowed_` now serves `register` **and** `admin`.
* A refusal returns `ORIGIN_BLOCKED` and writes a `DeniedLog` row (`endpointType` included).
* `report.js` asserts `window.location.origin`.
* **`get` / `status` / `health` are deliberately NOT gated** — the kiosk is browsed from a LAN origin
  (`http://192.168.2.238:8123`) that is not on the tenant allow-list, and gating reads would break the
  front desk. Pinned by tests, because this is the kind of "tightening" a future change gets wrong.

**Stated plainly in the code and here:** this raises the bar against the observed exposure (a hostile
page must at least declare itself) and leaves an audit trail. It is **not** an authentication
boundary, because the origin is self-declared.

## Stage 2 — the guard PIN, validated server-side

* **`guardPin` is no longer published.** `_configPayload_` (shared by `?action=config` and
  `?action=bootstrap`) no longer carries it.
* **New `?action=guardLogin`** — POST `{ sheetId, pin }`:
  * constant-time compare (`_constantTimeEquals_`) against the tenant's `Settings.guardPin`;
  * **15 failures / 15 minutes per tenant** then `TOO_MANY_ATTEMPTS` (429). A 4-digit PIN is
    brute-forceable without this, and making the PIN the real credential is exactly what makes the
    limit necessary;
  * every failure is written to `DeniedLog` as `GUARD_UNAUTHORIZED`;
  * fails **closed** when no PIN is configured (`GUARD_PIN_NOT_CONFIGURED`).
* **`report` and `bulkSignOut` now require a valid `guardPin`** on every call (`_requiresGuardPin_`).
  Deliberately excluded: `signOutByCard`, `assignedCards` (shared-secret machine callers) and the
  retention/expiry paths (Apps Script triggers) — no human is present to type a PIN.
* **`report.js`**: validates through the server, holds the PIN for the session, sends it on each admin
  call, and re-prompts (with a clear message) when the server rejects a missing/expired PIN or rate-limits.
* **`verify.js` (kiosk 1.0.3)**: guard login is a server call. `settings.json GUARD_PIN` is kept
  **only** as an offline fallback when the server is unreachable — a deliberate availability
  trade-off that keeps the front desk usable during an outage. The value is pre-loaded so the kiosk
  and the backend can be deployed in **either order**: an older kiosk keeps working after the backend
  update, because its local copy already holds the right PIN.

### Residual risks (knowingly accepted, not hidden)

| # | Risk | Why it stands |
|---|---|---|
| R1 | An unauthenticated caller who guesses the PIN, or who holds it legitimately, can read every visitor's data for the tenant | The PIN is the credential. Increasing entropy (6+ digits, or a per-install admin secret) is a product decision |
| R2 | The kiosk's offline fallback means a physically-stolen kiosk box leaks its `settings.json` PIN | It already contained the LiteVM secret and sheet ID; the fallback does not widen the trust domain, but it is worth stating |
| R3 | `ACAO: *` remains | Not configurable on GAS. Mitigated by authentication (stage 2), not by origin |
| R4 | The PIN travels on each admin call | Same TLS channel, same origin; a token scheme would be an optimisation, not a security requirement |
| R5 | `report.js` holds the PIN in `sessionStorage` | Same origin, cleared with the tab — and strictly better than the previous state, where the *server* handed the PIN to any caller |

## Deploy order (safe either way)

1. **Code.gs 1.21.0** — paste `Code.txt` (`sha256 f144d105…`), Save, Deploy → Manage deployments → Edit
   → New version (keep the same deployment so the `/exec` URL is unchanged).
2. **Kiosk 1.0.3** — install; the guard PIN check moves to the server.
3. **Portal** — push `report.js` (LITEVM Pages deploy → `demo.litevm.itt.web.id`). **Until this lands,
   the portal's report page will fail its PIN gate** (it sends no `guardPin`, and holds no local copy):
   the server refuses it. Order matters for the *portal* only.

## Verification

* Offline GAS harness: **66 assertions, 0 failures** (was 32 before this work). New: the
  `validateRequest` gate matrix incl. the `get`/`status` exemptions, `_originAllowed_` rules,
  end-to-end report refusal + `DeniedLog` audit, `guardLogin` accept/reject/audit, the whole
  stage-2 matrix (no PIN / wrong PIN / right PIN / machine-caller exemption / minimal response),
  constant-time compare, and the lockout (including that lockout blocks the **correct** PIN).
* Live controls still owed after redeploy: foreign-origin `report` → 403; portal-origin `report` with
  PIN → 200; `report` with no PIN → `GUARD_UNAUTHORIZED`; correct PIN → 200; lockout after repeated
  failures; and `signOutByCard` unaffected (secret only).
