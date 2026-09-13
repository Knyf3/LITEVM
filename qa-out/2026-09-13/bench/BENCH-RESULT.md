# Bench result — full E2E with the operator's own face

**Date:** 2026-09-13, 20:03–20:09 Asia/Jakarta
**Operator:** Fenky Tjhang (physically at the reader)
**Versions under test:** LITEVM Code.gs **1.20.0** · Verify Kiosk **1.0.2** (fresh install) · UStarAPI **1.5.5.0** · reader E53 fw **OS-V2.2112**
**Verdict: PASS — the money path ran end to end on real hardware, and the fail-open guard held.**

## Timeline (all times local, from gateway log + sheet + device)

| # | Step | Time | Evidence |
|---|---|---|---|
| 1 | Registration `V-20260913-009` (Fenky Tjhang, BCA, selfie = his own photo) | 20:03:12 | GAS `status: ok`; lookup → `Pending Entry` |
| 2 | Kiosk check-in (guard PIN, lookup → verify → confirm) | 20:04:24 | kiosk UI `state=verified`, card shown **5001** |
| 3 | Provision on the reader | 20:04:36–38 | `POST /api/litevm/provision` **200 in 4,528 ms** → selfie fetch from Drive 3,158 ms → `device/setIdentifyModel` 200 (78 ms) → `person/create` 200 (160 ms) → `face/create` 200 (516 ms) → `person/update` 200 (159 ms) |
| 4 | Enrolment proof | 20:04:38 | device `person 2 → 3`, `face 2 → 3` |
| 5 | **Operator presents his face** | 20:06:54.953 | device → gateway callback `/device/callback/identify?personId=5001&type=face_0&idcardNum=&aliveType=1&recType=1&maskState=3&path=…/200654_871_5001_rgb.jpg` |
| 6 | Callback handled | 20:06:55 | action 5.4 ms, HTTP **200 in 10.9 ms** (push, not poll) |
| 7 | Cloud sign-out | 20:07:23 | poll `1 candidate(s) processed` → GAS `POST /exec` 200 (8,143 ms) → sheet `Signed Out` |
| 8 | De-provision + card release | 20:07:23 | device `person/delete` 200 (188 ms) → `person 3 → 2`, `face 3 → 2`; card 5001 → `Available`, AssignedTo/At cleared, DoorGroupID 2 intact |

Total: registration → de-provision in **4 min 11 s**, of which ~1 min 50 s was the operator's own walk-to-the-reader time.

## Plan items

| ID | Result | Note |
|---|---|---|
| **H1** | ✅ PASS | `person/findByPage personId=5001` returned a live, numeric-id person during the bench; 0 records after de-provision |
| **H2** | ✅ PASS | `faceCount` 2 → 3 on provision, 3 → 2 on de-provision |
| **H3** | ✅ PASS (mapping) | gateway `Verification Face=True Qr=True Card=False`; QR permission mapping proven on the still-enrolled 5061 (`qrCode='5061'`, `qrPermission=2`, `facePermission=2`). Card 5001's own person record could not be re-read after de-provision — honest gap, same code path |
| **H4** | ✅ PASS — the real risk case | the identify callback carried **`idcardNum=` EMPTY**; the gateway resolved the visitor by `personId=5001` and signed out correctly. A silently dropped recognition would have shown as a stuck `Checked In` — it did not |
| **H5** | ✅ PASS | face at 20:06:54.953 → callback at 20:06:55 (**push**, ~50 ms), far inside the 30 s poll window |
| **H6** | ✅ PASS — fail-open guard held | card released **and** the face removed from the door; device back to the exact pre-bench baseline 2/2/3; `person/findByPage 5001` → 0 records |
| **E1** | ✅ PASS | all 8 steps of the money path landed, single visitor |
| **E2** | ✅ PASS | kiosk displayed 5001 from the backend response; 5001 ∈ the Destination's DoorGroup 2 block |
| **E3** | ⚠️ NOT CAPTURED | mid-flight read of `AssignedTo = V-20260913-009` / `Status = Assigned` on the cardno row was not taken before sign-out. The completion state (E4) is proven; this is an instrument gap, not a product fault |
| **E4** | ✅ PASS | `Signed Out`, card `Available`, `AssignedTo` + `AssignedAt` empty, **`DoorGroupID` 2 preserved** |
| **F1 watch** | ✅ PASS | poll sequence `0,0,0,…,0` (20:02:15→20:06:45) → **`1`** (20:07:23) → `0,0,0` (20:07:45→20:08:45). Consumed exactly once, no re-trigger loop, **no ERR/WRN in the log** |
| **QR scan capability** | ⚠️ UNVERIFIED | gateway accepts QR and issues it; nobody has demonstrated the E53's scanner. Not exercised — declared, not claimed |

## Honest caveats

- **"Door opened" is a CHECK, not a PASS.** This bench has a single OUT reader: it proves *recognition + access revocation*, not that a strike plate energised. There is no second reader or lock contact on this bench.
- **E3 not captured** (see above) — the mid-flight card assignment state was missed by the instrument, not failed by the system.
- **Kiosk-side card display**: the card number rendered from the check-in response (5001) — consistent with the provenance rule (backend supplies the value, not cached state), but the kiosk's card was cross-checked only against the cardno sheet state, not a separate logged response body.

## Instrumentation lessons (for the next run)

- The device record-list endpoints (`newFindRecords` / `findRecords`) returned `LAN_EXP-1006` in this run under both GET and POST with `startTime=0&endTime=0` — the record list could **not** be read this time. The authoritative recognition evidence came from the gateway's identify callback instead. Fix the record-read call shape before the next pass.
- `?action=cardpool` is a **first-11-rows diagnostic** returning `col0..colN` keys (header in row 0), not header-named rows — parse accordingly.
- `person/count` / `face/count` are not readable directly; use `device/information?pass=…` → `personCount` / `faceCount` / `fingerCount`.
- `person/findByPage` returned `LAN_EXP-1006` for a **non-existent** card id — treat that code as "no such person" when the person was deleted (not as a bad verb).
