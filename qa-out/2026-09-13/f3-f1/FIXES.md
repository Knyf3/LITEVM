# F1 + F3 fixes — code complete, tests green (2026-09-13, night)

## F1 — stale-record loop + wrong-visitor sign-out (UStarAPI, → **1.5.6**)

**Two defects, one observed failure.** The sign-out poll holds its watermark forever when a
candidate batch "fails", and a GAS **business refusal** (HTTP 200 with `{"status":"error"}` — the
LITEVM convention, and exactly what an unassigned/unknown card returns) was classified as a
retryable failure. One unprocessable record therefore blocked every record behind it, retried every
tick, until an operator restarted the service. Compounding it: the watermark store is **in-memory**,
so a restart re-seeds it to 0 and the device replays its entire recognition history — and a replayed
record for a card that has since been **recycled** can sign out the wrong visitor (observed
2026-08-30: a row read *"signed out three weeks before signing in"*).

**Fix, in three layers.**

| Layer | Where | Behaviour |
|---|---|---|
| 1. Classify | `ILitevmGasClient` / `LitevmGasClient` | new `GasSignOutStatus.Rejected` — 200 + `status:"error"`, or any 4xx with a parseable JSON body, is a **business refusal**. 5xx / unparseable body / transport errors stay `Failed` (genuinely retryable). `Unauthorized` unchanged |
| 2. Ack-and-drop | `SignOutPollingService.ProcessCandidateAsync` | `Rejected` → log, **no device delete** (nobody was signed out, so the credential must stay live), watermark **advances**. `Failed` still holds |
| 3. Replay guard | `SignOutOptions.MaxRecordAgeHours` (**default 24**, 0 = off) | records older than the window are ignored — and still advance the watermark, so a stale record can never wedge the poll. Fresh records are unaffected |
| 4. Authority-side guard | GAS `_signOutVisitor_` | if the caller supplied an explicit event time **and** the row's Sign-In Time is a real `Date` **and** the event strictly precedes it → `stale_event`, returned as `noop`. Makes a recycled-card mis-sign-out structurally impossible, whatever the watermark does. Deliberately narrow: anything less certain is allowed |

**Live sheet check that the layer-4 guard depends on:** the demo tenant's Sign-In Time column holds a
real **date serial** (`46278.836…`), not text — verified via the Sheets API with
`valueRenderOption=UNFORMATTED_VALUE`. A display string there would have made the guard silently
inert.

**Tests:** `dotnet test` → **427 passed, 0 failed** (was 417; +10). New: business-refusal → Rejected
(200 + 4xx), non-JSON body still Failed, ack-and-drop advances the watermark with no device delete,
transient failure still holds, stale record ignored-but-watermark-advances, recent record processed,
stale-before-recent ordering, default `MaxRecordAgeHours = 24` pinned, and config binding.
*16 pre-existing tests failed first* — the fixtures use synthetic epoch-1970 record times
(`Time = 1000`) which the new guard correctly rejects; they now disable the guard explicitly, with
the guard's own tests carrying that coverage.

## F3 — admin actions bypassed the origin gate (LITEVM, → Code **1.20.1**)

**The finding, in three layers — the first two make the obvious fix a no-op:**

1. **Admin actions skipped the check entirely.** `validateRequest` returned early for anything that
   wasn't `endpointType === 'register'`, so `report`, `bulkSignOut`, `retention*`, `expiry*`,
   `assignedCards` were never origin-checked. Proven live: a `report` POST from
   `http://evil.example` → **HTTP 200 with 9 visitor rows**. The plan's R15 expectation
   ("non-allowlisted origin → 403") had never actually held.
2. **The check is client-asserted.** The "origin" is read from `body.origin` — a **JSON field the
   caller supplies** — because Apps Script Web Apps do not expose HTTP request headers. Omit it and
   you sail through; set it to the tenant's allowed value and you sail through. Copying this check
   to admin (the original recommendation) would have been **security theatre**.
3. **GAS answers `Access-Control-Allow-Origin: *`**, so any web page in any browser can *read* the
   report payload. With a public sheetId (it ships in the portal's `config.js`) and the guard PIN
   published by `?action=config`, "PIN-protected" is currently a client-side claim.

**Fix applied (honest scope):** the origin gate now covers `register` **and** `admin`, via one shared
`_originAllowed_`. Denials are audited in `DeniedLog` with the `endpointType`. `report.js` now
asserts `window.location.origin`. `get`/`status`/`health` are deliberately **not** gated — the kiosk
is browsed from a LAN origin that is not on the allow-list.

**What this does NOT do** (stated plainly in the code comment, not hidden): it raises the bar against
the observed exposure (a hostile page in a victim's browser) and leaves an audit trail. It is **not**
an authentication boundary, because the origin is self-declared. The real fix is **server-side PIN
validation** — stop publishing `guardPin` from `?action=config` and validate it in GAS for admin
actions — which changes the shipped kiosk's guard-login contract and needs a portal + kiosk deploy.
Raised as a decision, not half-implemented.

**Tests:** GAS offline harness → **54 passed, 0 failed** (was 32). New: the `validateRequest` gate
matrix (admin × allowed/foreign/absent, `get`/`status` stay open, `_originAllowed_` subdomain +
scheme rules), the end-to-end report refusal, the DeniedLog audit row, and the whole stale-event
guard sequence. *Two harness FAILs were chased to `SpreadsheetApp.flush` being unstubbed —
an instrument artefact, not a product result; the stub now exists.*

## Live verification — UStarAPI 1.5.6 on the bench gateway (2026-09-13 20:33)

Installed silently on `.194`; **`Settings.json` byte-identical before/after** (sha
`F5B6F322220F7E0CACB06FA4FB632DC108ACF07CA2C9799CAD157553C833BD45`) — the CORS allowlist survived.
`/api/health` → `version 1.5.6.0, devices 1, online 1`; device round trip `person=2 face=2 finger=3`.

**F1b proved itself on live traffic inside a minute.** The QR run had left records stuck behind a GAS
timeout; after the restart the poll reproduced the failure and then the fix:

```
[20:34:21 WRN] Sign-out batch not fully processed for device E03C1CB54A2F5601 — watermark held for retry
[20:34:51 WRN] Sign-out batch not fully processed for device E03C1CB54A2F5601 — watermark held for retry
[20:35:10 WRN] Sign-out poll: card 5001 answered noop (card not assigned) — ensuring no orphaned credential is left on the reader
[20:35:14 WRN] … noop (card not assigned) — ensuring no orphaned credential is left on the reader
[20:35:19 WRN] … noop (card not assigned) — ensuring no orphaned credential is left on the reader
[20:35:19 INF] Sign-out poll for device E03C1CB54A2F5601: 3 candidate(s) processed (0 stale record(s) ignored)
```

* the **new log format** (`(0 stale record(s) ignored)`) proves 1.5.6 is the running binary;
* the noop path **actively de-provisions** instead of silently advancing — the fail-open is closed;
* the batch **completes** and the watermark advances, so the F1 retry-forever loop is gone.

(The three deletes were no-ops on the device because the orphan had already been removed by hand —
which is why the bench reads baseline `2/2/3`.)

## Artifacts built

| Artifact | Size | SHA256 |
|---|---|---|
| `UStarAPI_Setup_1.5.6.exe` | 35,471,394 B | `0FD514932A14FB23EF94895B20AFD41FBB957FAB35262F5B6DC9A6942D8EB680` |
| `Verify Kiosk_Setup_1.0.3.exe` | 35,495,295 B | `412D59FE9060956282D6DDE38509583B3F91787E44CA7FC3D4D869D56ADAC409` |

Both were verified *inside the packaged source* (not just the repo): the UStarAPI installer carries
`GasSignOutStatus.Rejected`, the refusal classifier, `MaxRecordAgeHours`, the noop de-provision and the
noop-reason parse; the kiosk installer's `verify.js` (82,499 B) carries `verifyGuardPinOnServer`, the
`guardLogin` call, the deploy-order-safety branch (unknown response → `unreachable`), and **no**
reference to a published `guardPin`.

## Still outstanding

- **Redeploy Code.gs 1.21.0** — paste `Code.txt` (sha256 `f144d105b05dbfc5a924f41be25a81903febd6752dcedb2ba681c0a2448b1d41`),
  Save, Deploy → Manage deployments → Edit → New version (keep the same deployment/URL). This carries
  the F3 stage-2 gate, the GAS stale-event guard, and the `noop` reason.
- **Portal push** for `report.js` — until it lands, the portal's report page cannot authenticate
  (it sends no `guardPin`). Push it immediately before or after the Code deploy; the window is short.
- **Install kiosk 1.0.3** on `.238` — safe in either order now (unknown `guardLogin` responses fall
  back to `settings.json`), but install it *after* the Code deploy to avoid a needless GAS round trip
  on every guard login.
- **Live F3 controls after redeploy:** foreign-origin `report` → 403; portal-origin `report` with a PIN
  → 200; no PIN → `GUARD_UNAUTHORIZED`; correct PIN → 200; lockout after 15 failures;
  `signOutByCard` unaffected (secret only).

