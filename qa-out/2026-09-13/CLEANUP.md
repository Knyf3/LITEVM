# Demo tenant clean-down — 2026-09-13 20:50–21:05

Goal: leave the demo tenant and the bench reader exactly as a customer would find them —
no QA residue, nothing left armed, and nothing secret in the public repo.

## What was removed

| Target | Action | Detail |
|---|---|---|
| `VisitorLog` | **29 rows cleared** | 11 legacy (Aug 29–30), 8 Sep 2/6/9 QA, 10 from tonight's `V-20260913-*` runs |
| `EmailQueue` | **6 records deleted** | all `SENT`; 4 older + 2 from tonight's card mail |
| `CardNo` | **card 5061 released** | was still `Assigned` → `V-20260913-003` (an orphan: the visit had ended, the pool entry never was) |
| E53 reader | **5 recognition records deleted** | `newDeleteRecords` with `personId=-1&startTime=0&endTime=0&model=-1` → `删除识别记录数量：5` |
| Google Drive | **60 photos trashed** | 2 per deleted visit (58) + 2 from the smoke test — Trash, recoverable 30 days |
| Bench state | **baseline** | reader `person=2 face=2 finger=3`; cards 5001/5021/5061 all absent from the reader |

Kept deliberately: `Settings` (tenant config), `Destination` (6 entries), `VisitorType` (3),
`_version`, and the `DeniedLog` audit rows — an audit log is not scratch space.

## `VisitorLog` was cleared, not shrunk — and why that is safe

The Sheets API refuses outright:

```
HTTP 400 Invalid requests[0].deleteDimension:
Sorry, it is not possible to delete all non-frozen rows.
```

So `values:clear` on `A2:AJ31` was used instead. That is safe because the append path is
`_appendVisitorLogRow_` (Sheets **advanced append**, with a `appendRow` fallback) which targets
the end of the populated table — after a clear that is the header row.

**Proven, not assumed:**

```
### registration: HTTP 200 in 32.7s -> status=ok visitor=V-20260913-011
   HEADER   Visitor Number         Full Name                            status=Status
   row 2    V-20260913-011         SMOKE TEST (cleanup verification)    status=Pending Entry
   -> appended at row 2 (immediately after the header): True
```

The smoke-test row was then cleared and its 2 photos trashed. `report` → `status=ok`, 0 visitors.

## Verification after the clean-down

| Check | Result |
|---|---|
| `report` (admin read, allow-listed origin + PIN) | `status=ok`, **0 visitors** ✅ |
| `VisitorLog` | header intact, 0 data rows ✅ |
| `EmailQueue` | 0 rows ✅ |
| `CardNo` | **215 / 215 `Available`**, 0 assigned ✅ |
| `Settings` / lookups | 7 keys intact / 6 + 3 entries intact ✅ |
| Device | `person=2 face=2 finger=3`, no test cards on the reader ✅ |
| Gateway | 1.5.6.0, device online, poll steady `0 candidate(s) processed`, no held batch ✅ |

## Backup / recovery

`/home/hermes/qa-backups/demo-tenant-2026-09-13T205048.json` (**mode 600, outside the repo** —
it contains live tenant config) holds every tab as it was before the clean: all 29 rows with
their Drive file IDs. Drive deletions are Trash, so both halves are recoverable for 30 days.

## Security sweep performed as part of this clean-down

1. **Live tenant secret** (`Settings.ustarSecret` = gateway `Litevm.Secret` = kiosk
   `LITEVM_SECRET`) was sitting in 4 files staged for a public push
   (`docs/TESTPLAN-FULLSTACK-E2E.md`, `qa-out/2026-09-13/p9-kiosk-settings.json`,
   `p10-tenant-settings.json`, `f5/f5_cleanup.py`). Verified per-file against `origin/main`
   that **none had ever been public**, then redacted before pushing.
2. **The reader's admin password** was in 3 tracked files and *did* go public with the push
   (`bafb640`, ~25 min). Redacted in `5f84014`; the bench scripts now read `UNIUBI_PASS`.
   **The value remains in git history — rotation is the fix, not a rewrite.**
3. `.gitignore` now blocks raw `*settings*.json` dumps from ever being committed again.
4. Residual: the tenant secret is a dictionary word, the guard PIN is a 4-digit default and
   the device password is a shipped default. All three are the *only* boundaries on their
   respective paths (see `SECURITY-F3-ADMIN-AUTH.md`). Rotation recommended.

## Note on GAS latency

Registering the smoke-test visitor took **32.7 s**, and one `report` call in the same burst
returned a transient error before succeeding (9.1 s, then 4.9 s on retry). This is the
documented GAS-latency behaviour (`docs/GAS-LATENCY-ADVISORY.md`), not a defect introduced
here — but it does mean the 30 s client timeout is not generous.
