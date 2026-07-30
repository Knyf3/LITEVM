# LITEVM Auto-Registration with Pending Approval — Implementation Plan

## Overview

When an unknown `sheetId` hits the GAS backend, instead of rejecting it with `INVALID_CUSTOMER`, the system auto-registers it to the Customers tab with configurable defaults and `status=pending`. Requests from pending customers work for basic operations (health check, lookup, today, destinations, cardpool, allowance, config) but registration (check-in) is blocked with `ACCOUNT_PENDING`.

---

## 1. Schema: Customers Tab

**Current (8 columns):**
```
sheetId | allowedOrigins | tier | visitorLimit | status | notes | autoSignOutHour | autoSignOutEnabled
```

**New (9 columns):** Add `registeredAt` as column 9.
```
sheetId | allowedOrigins | tier | visitorLimit | status | notes | autoSignOutHour | autoSignOutEnabled | registeredAt
```

`registeredAt` is a timestamp set when the row is auto-registered. Provides audit trail. Backward-compatible — existing rows have empty column 9.

---

## 2. Code Changes (Code.gs)

### 2A. Bump CODE_VERSION → `1.8.0` (line 26)

### 2B. Update `_loadMasterConfig()` — Read 9th column

Add `registeredAt` field to the config object parsed from Customers tab:
```javascript
registeredAt: row[8] instanceof Date ? row[8] : (row[8] ? String(row[8]) : null),
```

### 2C. Add `_extractOrigin_(e)` Helper

Refactor origin extraction from inline code into a reusable helper.

### 2D. Add `_autoRegisterCustomer(sheetId, origin, endpointType)`

Guards (layered defense):
1. **Feature flag**: `AUTO_REGISTER_ENABLED` Script Property must be `"true"`
2. **Rate limit**: Max 20 auto-registrations per rolling hour (stored in Script Properties)
3. **Sheet existence**: `SpreadsheetApp.openById(sheetId)` must succeed
4. **Lock**: `LockService.getUserLock()` on master config — 15s timeout
5. **Double-check**: Re-read Customers tab under lock to detect race-condition duplicates

Defaults (applied if no `AUTO_REGISTER_DEFAULTS` Script Property):
- `allowedOrigins`: `""` (empty = legacy allow-all)
- `tier`: `"free"`
- `visitorLimit`: `50`
- `status`: `"pending"`
- `notes`: `"Auto-registered by LITEVM on <timestamp>"`
- `autoSignOutHour`: `21`
- `autoSignOutEnabled`: `true`

Custom defaults can be set via `AUTO_REGISTER_DEFAULTS` JSON in Script Properties (any subset).

### 2E. Add `_checkAutoRegisterRateLimit_()`

Stores a JSON array of millisecond timestamps in `AUTO_REGISTER_TIMESTAMPS` Script Property. Filters to last 60 minutes. Returns false if count >= 20.

### 2F. Replace `validateRequest()` — New Logic Flow

```
if sheetId not in Customers tab:
    try auto-register:
        if fails → return INVALID_CUSTOMER (original behavior)
        if succeeds and endpointType is 'register' → return ACCOUNT_PENDING
        if succeeds and endpointType is NOT 'register' → ALLOW (return customer config with status='pending')

if customer.status is 'pending':
    if endpointType is 'register' → return ACCOUNT_PENDING
    if endpointType is NOT 'register' → ALLOW (return customer config)

if customer.status is not 'active' and not 'pending' → return ACCOUNT_DISABLED

[rest of existing origin-check logic for 'register' endpoint on active accounts]
```

---

## 3. Script Properties to Set

| Property | Purpose | Type | Required? |
|---|---|---|---|
| `AUTO_REGISTER_ENABLED` | Master feature flag | `"true"` or absent | **Yes** |
| `AUTO_REGISTER_DEFAULTS` | Custom defaults JSON | `{"tier":"trial","visitorLimit":100}` | Optional |
| `AUTO_REGISTER_TIMESTAMPS` | Rate-limit tracking | auto-managed | Internal |

---

## 4. UX Flow

**Visitor at kiosk (pending account):**
1. Opens kiosk → frontend sends registration POST → gets 403 `ACCOUNT_PENDING` with message *"Account pending activation. Please contact the administrator."*
2. Kiosk displays the message — visitor cannot register
3. GET operations (lookup, today's list, destinations) work normally

**Guard at pending account:**
1. Opens guard panel
2. Lookup works — can search existing visitors
3. Check-in fails with *"Account pending activation"*
4. Sign-out works — can sign out visitors who were previously checked in

**Admin:**
1. Sees new rows in Customers tab with `status=pending`
2. Reviews the sheetId — if legitimate, changes `status` to `"active"`
3. Next request for that sheetId loads the updated config and proceeds normally
4. All auto-registrations logged in `DeniedLog` with reason `AUTO_REGISTERED`

**Frontend:**
- No changes required — `ACCOUNT_PENDING` is returned as a standard error code
- Optional enhancement: frontend can detect `ACCOUNT_PENDING` and show a specific message

---

## 5. Security Considerations

| Concern | Mitigation |
|---|---|
| Spam/malicious sheetIds | Sheet must exist and be accessible — `SpreadsheetApp.openById()` must succeed |
| Rate-limit bypass | Max 20 per rolling hour via Script Properties counter |
| Race condition duplicates | LockService + double-check pattern |
| Unintended activation | Feature flag `AUTO_REGISTER_ENABLED` must be explicitly set |
| Pending account used for spam registrations | Registration blocked — only read operations allowed |
| GET endpoint abuse on pending accounts | Acceptable — read-only, no sensitive data exposed beyond what's in the sheet |

---

## 6. Edge Cases

| Edge Case | Behavior |
|---|---|
| sheetId doesn't exist | `SpreadsheetApp.openById()` throws → auto-register fails → `INVALID_CUSTOMER` |
| Concurrent first requests for same sheetId | Lock + double-check ensures exactly one row appended |
| Admin manually adds customer between check and lock | Double-check finds existing row, returns it |
| Pending for weeks | Stays blocked until admin changes status to `active` |
| Admin deletes auto-registered row | Next request triggers new auto-registration (rate limit permitting) |
| Malformed AUTO_REGISTER_DEFAULTS JSON | Parse error logged, hardcoded defaults used |
| Script Properties quota | Rate-limit JSON ~1KB for 20 entries — well within 500KB GAS quota |

---

## 7. Recommendations

| Topic | Recommendation |
|---|---|
| **Sign-out for pending accounts** | ALLOW — sign-out is cleanup, not creation. Blocking it would strand visitors in "Checked In" state. |
| **Admin operations (migrate, report, bulk sign-out)** | ALLOW — these are setup/cleanup operations needed to bring a pending account online. |
| **Check-in via updateStatus (Pending Entry → Checked In)** | ALLOW (through status endpoint, not register) — this is guard-mediated, not self-service. But admin can block by setting status back to pending. |
