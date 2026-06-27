# LITEVM — Bulk Sign-Out & Auto Sign-Out Technical Implementation

**Date:** 2026-06-27
**Status:** Design Complete
**Target:** Code.gs (Google Apps Script Web App), verify.js (Guard Portal)

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [API Design](#2-api-design)
3. [Card Release on Sign-Out](#3-card-release-on-sign-out)
4. [Auto Sign-Out at 21:00](#4-auto-sign-out-at-2100)
5. [Trigger Management](#5-trigger-management)
6. [Edge Cases](#6-edge-cases)
7. [Implementation Checklist](#7-implementation-checklist)
8. [Migration Plan](#8-migration-plan)

---

## 1. Overview & Architecture

### Problem
Currently:
- **Manual sign-out** records time but does NOT release the visitor's access card
- **Bulk sign-out** doesn't exist — guards must sign out one-by-one
- **Auto sign-out** doesn't exist — cards only release at 18:00 batch job
- **18:00 batch release** (`releaseDailyCards`) may conflict with or duplicate 21:00 auto sign-out

### Solution
Three coordinated changes:

| Feature | Mechanism | Timing |
|---|---|---|
| Card release on sign-out | `releaseCardForVisitor()` called inside existing sign-out path | At every sign-out |
| Bulk sign-out | New `mode=bulkSignOut` endpoint | On demand (guard click) |
| Auto sign-out at 21:00 | Time-driven trigger calling `autoSignOut()` | Daily 21:00–22:00 |

### New Lifecycle
```
Registration → Pending Entry → Checked In → Signed Out
                [card assigned]              [card released immediately]
                              → Rejected
```

The 18:00 batch release (`releaseDailyCards`) becomes a **safety net** — it catches any cards still Assigned after 21:00 auto sign-out completes. We keep it but schedule it later (e.g. 02:00) to avoid overlap.

---

## 2. API Design

### 2.1 New Endpoint: `mode=bulkSignOut`

**Request** (POST):
```json
{
  "mode": "bulkSignOut",
  "sheetId": "<google-sheet-id>"
}
```

**Success Response (200):**
```json
{
  "status": "ok",
  "signedOut": 5,
  "failed": 0,
  "errors": [],
  "details": [
    { "visitorNumber": "V-20260627-001", "status": "signedOut", "cardReleased": true },
    { "visitorNumber": "V-20260627-003", "status": "signedOut", "cardReleased": true }
  ]
}
```

**Partial Failure Response (200 — the operation succeeded for SOME visitors):**
```json
{
  "status": "ok",
  "signedOut": 4,
  "failed": 1,
  "errors": ["Visitor V-20260627-002: Lock timeout on card release"],
  "details": [
    { "visitorNumber": "V-20260627-001", "status": "signedOut", "cardReleased": true },
    { "visitorNumber": "V-20260627-002", "status": "failed", "cardReleased": false, "error": "Lock timeout on card release" },
    { "visitorNumber": "V-20260627-003", "status": "signedOut", "cardReleased": true }
  ]
}
```

**Error Response (400 — invalid state):**
```json
{
  "status": "error",
  "message": "No visitors currently checked in"
}
```

### 2.2 No Changes to Existing `mode=updateStatus`

The existing `updateStatus` endpoint for individual sign-out keeps its current contract. The only behavioral change is that signing out now also releases the card (see §3).

### 2.3 API Routing (doPost changes)

Add to `doPost()` in Code.gs:

```
data.mode === 'bulkSignOut'  →  handleBulkSignOut(data)
data.mode === 'updateStatus' →  handleStatusUpdate(data)  (existing, unchanged routing)
data.mode === 'migrate'      →  handleMigrationResponse(data)  (existing)
```

---

## 3. Card Release on Sign-Out

### 3.1 Core Function: `releaseCardForVisitor(visitorNumber, sheetId)`

Searches the `cardno` sheet for a row where `AssignedTo` matches the visitor number, then marks that card back to `Available`.

**Signature:**
```javascript
/**
 * Release the card assigned to a visitor back to Available.
 * @param {string} visitorNumber - The visitor number (e.g. "V-20260627-001")
 * @param {string} sheetId - Google Sheet ID
 * @returns {{ released: boolean, cardNo: string|null, error: string|null }}
 */
function releaseCardForVisitor(visitorNumber, sheetId)
```

**Logic:**
```
1. Open cardno sheet via getCardnoSheet(sheetId)
2. Get all data range
3. Loop i=1..data.length:
     if String(data[i][2]).trim() === visitorNumber:
       cardSheet.getRange(i+1, 2).setValue('Available')   // Status → Available
       cardSheet.getRange(i+1, 3).setValue('')             // Clear AssignedTo
       cardSheet.getRange(i+1, 4).setValue('')             // Clear AssignedAt
       return { released: true, cardNo: data[i][0], error: null }
4. Return { released: false, cardNo: null, error: 'No card found' }
```

### 3.2 Integration Points

**A) In `handleStatusUpdate` — the "Signed Out" path (line 480-493):**

After writing `Signed Out` status and timestamp, add:
```javascript
// Release the visitor's card immediately
try {
  var cardReleaseResult = releaseCardForVisitor(visitorNumber, data.sheetId);
  result.cardReleased = cardReleaseResult.released;
  result.cardNo = cardReleaseResult.cardNo;
  if (!cardReleaseResult.released && cardReleaseResult.error) {
    console.warn('Card release warning for ' + visitorNumber + ': ' + cardReleaseResult.error);
  }
} catch (cardErr) {
  console.warn('Card release failed for ' + visitorNumber + ': ' + cardErr.message);
  result.cardReleased = false;
  result.cardError = cardErr.message;
}
```

**B) In `handleBulkSignOut` — each visitor:**

For each visitor signed out, call `releaseCardForVisitor` and collect results.

### 3.3 LockService Strategy

| Operation | Lock Scope | Timeout | Rationale |
|---|---|---|---|
| Individual sign-out (`updateStatus`) | Single lock (existing) | 30s | Already has lock; card release is fast |
| Bulk sign-out (`bulkSignOut`) | **Extended single lock** | 120s | Entire bulk operation must be serialized; 120s for up to ~200 visitors (each card release takes ~1s) |

The bulk operation acquires ONE lock at the start and holds it for the entire operation. If lock acquisition fails, return 503 immediately.

For individual sign-out, the existing lock is sufficient — card release is added inside the same locked section.

---

## 4. Auto Sign-Out at 21:00

### 4.1 New Function: `autoSignOut()`

```javascript
/**
 * Auto sign-out all Checked In visitors at 21:00 daily.
 * Called by time-driven trigger. Handles up to N visitors within
 * the 6-minute Apps Script execution limit.
 */
function autoSignOut()
```

**Logic:**
```
1. sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID')
2. If no sheetId, log warning and return
3. Open VisitorLog sheet
4. Get all data
5. Collect row indices where status === 'Checked In' (col 12, 1-indexed)
6. If none found, log 'No checked-in visitors to auto sign-out' and return
7. For each matching row:
   a. sheet.getRange(rowIndex, 12).setValue('Signed Out')      // Status
   b. sheet.getRange(rowIndex, 14).setValue(new Date())         // Sign-Out Time
   c. releaseCardForVisitor(visitorNumber, sheetId)
8. Log summary: "autoSignOut: Signed out N visitors, released M cards"
```

**Important:** This function does NOT use LockService (no concurrent access risk — triggered function runs alone). However, to stay under the Apps Script 6-minute execution limit, it should process in batches if there are many visitors. For most use cases (under 200 daily visitors), a single loop is fine.

### 4.2 Trigger Installation

New setup function:

```javascript
function setupAutoSignOutTrigger() {
  // Remove any existing autoSignOut triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoSignOut') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Install daily trigger at 21:00
  ScriptApp.newTrigger('autoSignOut')
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .create();

  console.log('setupAutoSignOutTrigger: Daily auto sign-out trigger installed for 21:00–22:00');
}
```

### 4.3 Multi-Customer Support

Both `releaseDailyCards` and `autoSignOut` currently use a single `SHEET_ID` script property. In the multi-customer architecture, each customer has a different sheet, but the **Web App deployment is shared** — it uses the `sheetId` passed in each request.

**For time-driven triggers**, there's no request context. Options:

| Option | Complexity | Recommendation |
|---|---|---|
| **A) One Web App per customer** | High setup, clean isolation | Over-engineered for current scale |
| **B) Stored procedure per sheet** — iterate all known sheets | Medium | Preferred |
| **C) ScriptProperties per customer prefix** | Low hackiness | Simple but manual |

**Recommended approach (Option B):**

Maintain a registry of sheet IDs in Script Properties:
```
CUSTOMER_SHEETS = "sheet1_id,sheet2_id,sheet3_id"
```

The `autoSignOut()` function reads all sheet IDs, iterates each, and signs out visitors in each sheet.

The `setupAutoSignOutTrigger()` function also provides a convenience method to register a sheet:
```javascript
function registerCustomerSheet(sheetId) {
  var prop = PropertiesService.getScriptProperties();
  var existing = prop.getProperty('CUSTOMER_SHEETS') || '';
  var sheets = existing ? existing.split(',') : [];
  if (sheets.indexOf(sheetId) === -1) {
    sheets.push(sheetId);
    prop.setProperty('CUSTOMER_SHEETS', sheets.join(','));
  }
}
```

### 4.4 Updated `releaseDailyCards` (Safety Net)

Change from 18:00 to **02:00** (after all visitors would reasonably have left and autoSignOut has run):

```javascript
function setupDailyReleaseTrigger() {
  // ... existing cleanup ...
  ScriptApp.newTrigger('releaseDailyCards')
    .timeBased()
    .atHour(2)  // Changed from 18 to 2
    .everyDays(1)
    .create();
}
```

This ensures:
- Cards released at individual sign-out → immediate availability
- Cards released at bulk sign-out → immediate availability  
- Cards released at auto sign-out (21:00) → immediate availability
- 02:00 safety net catches anything missed (edge case: card assignment without check-in, script errors, etc.)

---

## 5. Trigger Management

### 5.1 Trigger Lifecycle

| Trigger | Function | Schedule | Purpose |
|---|---|---|---|
| Auto Sign-Out | `autoSignOut()` | Daily 21:00–22:00 | Signs out all Checked In visitors + releases cards |
| Daily Card Release | `releaseDailyCards()` | Daily 02:00–03:00 | Safety net — releases any remaining Assigned cards |

### 5.2 One-Shot Setup

Add to the `initialize()` function:
```javascript
console.log('Run setupAutoSignOutTrigger() once to install the 21:00 auto sign-out trigger.');
console.log('Run registerCustomerSheet(SHEET_ID) to register sheets for auto sign-out.');
```

Update the wrapper.gs menu:
```javascript
ui.createMenu('📊 LITEVM')
  .addItem('⚙ Run Migration', 'runMigration')
  .addItem('🔄 Setup Auto Sign-Out', 'runSetupAutoSignOut')
  .addToUi();
```

Add wrapper function in wrapper.gs:
```javascript
function runSetupAutoSignOut() {
  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  registerCustomerSheet(sheetId);
  setupAutoSignOutTrigger();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('✓ Auto sign-out at 21:00 installed', 'LITEVM', 3);
  } catch(e) {}
}
```

### 5.3 Trigger Conflict Prevention

The auto-sign-out function SELF-DEFENDS against running twice:

```javascript
function autoSignOut() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('autoSignOut: Another instance is running — skipping');
    return;
  }
  try {
    // ... actual logic ...
  } finally {
    lock.releaseLock();
  }
}
```

---

## 6. Edge Cases

### 6.1 Race Conditions

| Scenario | Handling |
|---|---|
| **Guard clicks bulk sign-out while someone is being individually signed out** | Both use LockService — one will wait. Bulk acquires 120s lock, individual uses 30s lock. If bulk is waiting, it times out and returns 503; guard retries. |
| **Bulk sign-out clicked twice rapidly** | First call acquires 120s lock. Second call fails lock acquisition → 503 "System busy. Please try again." The frontend hides the button once clicked (using `actionInProgress` flag). |
| **Auto sign-out (21:00) runs while guard is manually signing someone out** | Auto sign-out acquires a brief 1s lock first. If manual sign-out is in progress, auto skips that visitor and moves to the next row. On next tick (next 21:00 window or manual re-run), remaining visitors are caught. |
| **Auto sign-out overlaps with the same day's bulk** | Unlikely — bulk is manual during shift hours (< 21:00); auto runs at 21:00. But if both fire, the lock mechanism prevents double-processing. |

### 6.2 Partial Failures

| Scenario | Handling |
|---|---|
| **Bulk: some visitors fail to sign out** | Bulk endpoint returns `signedOut` count, `failed` count, and per-visitor `details` array with error messages. The operation does NOT roll back successes. Frontend displays: "Signed out 4 of 5 visitors. 1 failed. Tap to retry." |
| **Card release fails but sign-out succeeded** | The visitor IS signed out (status = Signed Out, timestamp written), but card remains Assigned. The 02:00 safety net (`releaseDailyCards`) will release it. The API response includes `cardReleased: false` and `cardError`. Log warning. |
| **Sign-out fails but card was released** | Should not happen — card release occurs AFTER sign-out write, inside the same lock. But if Apps Script crashes between the two writes, the card is released but status is still Checked In. The guard can re-sign-out, which will find the card already released (idempotent — `releaseCardForVisitor` returns `{ released: false, error: 'No card found' }` — acceptable). |

### 6.3 No-Op Cases

| Scenario | Handling |
|---|---|
| **Bulk sign-out with zero Checked In visitors** | Return 400: `{ status: 'error', message: 'No visitors currently checked in' }` |
| **Auto sign-out with zero Checked In visitors** | No-op. Log: `"autoSignOut: No checked-in visitors to sign out for sheet <id>"`. Continue to next sheet. |
| **Sign out a visitor who is already Signed Out** | Existing 409 guard in `handleStatusUpdate` catches this: `"Visitor already signed out."` |
| **Sign out a Pending Entry visitor** | Existing 409 guard: `"Visitor must be checked in before signing out."` |

### 6.4 Apps Script Limits

| Limit | Risk | Mitigation |
|---|---|---|
| **6-minute execution** | Bulk sign-out with 200+ visitors doing 2 writes each (status + card) could approach limit | Each visitor = 2 sheet writes + 1 cardno write = ~1s. 200 visitors = ~200s = 3.3min. Well within limit. Auto sign-out = same pattern. |
| **30 concurrent triggers** | Adding autoSignOut trigger plus existing releaseDailyCards is fine (2 total) | Not a concern. |
| **9 simultaneous executions** | Auto sign-out runs alone (trigger). Guard bulk is a POST handled by Web App → 1 execution. | Not a concern. Single-customer deployments use 1 execution. |
| **Cell write rate** | Batch writing 200 cells sequentially | Acceptable — Apps Script handles ~50 writes/second. 200 cells = ~4s of actual write time. |

### 6.5 Idempotency

**`releaseCardForVisitor` is idempotent** — if a card was already released (e.g., by 02:00 safety net before auto sign-out ran, or by a previous attempt), calling it again simply returns `{ released: false, error: 'No card found' }`. The sign-out status write is also idempotent (guarded by the 409 check in `handleStatusUpdate`).

---

## 7. Implementation Checklist

### Backend (Code.gs) — New Functions

- [ ] `releaseCardForVisitor(visitorNumber, sheetId)` — cardno lookup + release
- [ ] `handleBulkSignOut(data)` — bulk endpoint handler
- [ ] `autoSignOut()` — time-driven trigger handler
- [ ] `setupAutoSignOutTrigger()` — trigger installer
- [ ] `registerCustomerSheet(sheetId)` — optional multi-sheet registry

### Backend (Code.gs) — Modifications

- [ ] `doPost()` — add route for `mode='bulkSignOut'`
- [ ] `handleStatusUpdate()` — in "Signed Out" path, call `releaseCardForVisitor()`
- [ ] `setupDailyReleaseTrigger()` — change 18:00 → 02:00
- [ ] `initialize()` — add setup instructions for auto sign-out

### Backend (wrapper.gs) — Modifications

- [ ] Add `runSetupAutoSignOut()` wrapper function
- [ ] Add menu item: "🔄 Setup Auto Sign-Out"

### Frontend (verify.js) — Bulk Sign-Out Button

- [ ] Add "Bulk Sign Out" button (only visible to supervisor/guard with additional confirmation)
- [ ] Call `POST { mode: 'bulkSignOut', sheetId }` 
- [ ] Display result: "Signed out X visitors" or error
- [ ] Refresh today's visitors list after bulk sign-out

### Frontend (verify.js) — Card Release Awareness

- [ ] No frontend changes needed for card release (backend-only change)
- [ ] The sign-out success state already shows appropriately

---

## 8. Migration Plan

No data migration needed — the `cardno` sheet already has the right schema (CardNo, Status, AssignedTo, AssignedAt). The behavioral change is:
- **Before deploy:** Signing out does NOT release card; cards released at 18:00
- **After deploy:** Signing out DOES release card immediately; auto sign-out at 21:00

### Steps

1. **Deploy updated Code.gs** as new Web App version
2. **Run `setupAutoSignOutTrigger()`** once from editor (installs 21:00 trigger)
3. **Run `registerCustomerSheet(SHEET_ID)`** for each customer sheet
4. **Update `setupDailyReleaseTrigger()`** schedule → run it to change from 18:00 to 02:00
5. **Verify:** Check that signing out a visitor via the guard portal also clears AssignedTo in cardno
6. **Monitor:** Check logs for `autoSignOut` execution the following day

### Rollback

If issues emerge:
1. Revert Code.gs to previous version
2. Delete the autoSignOut trigger via `ScriptApp.getProjectTriggers()` in the editor
3. Re-run `setupDailyReleaseTrigger()` to restore 18:00 schedule
