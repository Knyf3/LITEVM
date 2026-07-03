# LITEVM — Phase 1 Setup Guide: Origin Whitelist & Access Control

## Overview

This guide walks through setting up the **master config sheet**, configuring **origin whitelisting** for registration endpoints, and enabling **denied request logging** — collectively Phase 1 of the LITEVM access control system.

### What this adds

- **Master config sheet** — a single Google Sheet that manages all LITEVM customers
- **Origin whitelist** — only registration requests from approved domains are allowed; GET/status/admin endpoints get a basic customer-exists-and-active check
- **Denied request logging** — all blocked requests are logged to a `DeniedLog` tab for auditing
- **Frontend support** — the registration form, guard verification panel, and bulk operations all report their origin

---

## Step 1: Create the Master Config Sheet

Create a new Google Sheet. This sheet will hold your customer registry.

### Sheet structure

1. Open Google Sheets and create a new spreadsheet
2. Rename the default sheet tab to **`Customers`**
3. Add the following **6 columns** as headers in row 1:

| Column | Header | Description |
|---|---|---|
| A | `sheetId` | Customer's Google Sheet ID (unique key) |
| B | `allowedOrigins` | Comma-separated list of allowed domains |
| C | `tier` | Plan tier: `free`, `starter`, `pro`, or `admin` |
| D | `visitorLimit` | Max visitor registrations: `50`, `500`, `999999` |
| E | `status` | Account status: `active`, `paused`, or `disabled` |
| F | `notes` | Optional memo/notes field |

### Add your first customer row

For the LITEVM demo deployment (hosted on GitHub Pages at `knyf3.github.io`), add:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| `1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs` | `knyf3.github.io` | `admin` | `999999` | `active` | `LITEVM demo / GitHub Pages` |

> **Origin matching rules**: Exact domain match **or** subdomain match. So `knyf3.github.io` matches requests from both `https://knyf3.github.io` and `https://visitor.knyf3.github.io`. Protocols (`http://`/`https://`) and trailing slashes are stripped before comparison.

---

## Step 2: Store the Master Config ID in Script Properties

1. Open your GAS Web App project (the one where `Code.gs` is deployed)
2. Go to **Project Settings** > **Script Properties**
3. Add a new property:
   - **Name**: `MASTER_CONFIG_ID`
   - **Value**: The Google Sheet ID of the master config sheet you just created
     *(found in the sheet URL: `https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit`)*
4. Click **Save**

> The `MASTER_CONFIG_ID` property is never exposed to the frontend — it's server-side only.

---

## Step 3: Deploy the Updated Web App

1. Open `Code.gs` in the Apps Script editor
2. Verify the code matches your deployment (the changes in this phase are backward-compatible)
3. Go to **Deploy** > **New deployment** (or **Manage deployments** > update existing)
4. Set **Execute as**: `Me`
5. Set **Who has access**: `Anyone`
6. Deploy

---

## Step 4: Verify It Works

### Test 1 — Health check (no validation)

```bash
# Should return 200 with "LITEVM Web App is running"
curl -v "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```

### Test 2 — GET with valid sheetId

```bash
# Known customer — should return data
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=today&sheetId=1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs"
```

### Test 3 — GET with invalid sheetId

```bash
# Unknown customer — should return 403 with INVALID_CUSTOMER
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=today&sheetId=FAKE_SHEET_ID"
# Expected: {"status":"error","error":"Invalid customer configuration."}
```

### Test 4 — Registration with allowed origin

The frontend now sends `origin: window.location.origin` in the POST body. With `knyf3.github.io` whitelisted, registration from `https://knyf3.github.io` will proceed normally.

### Test 5 — Registration with blocked origin

If you modify the frontend to report a different origin (or use `curl`), registration should be blocked:

```bash
# POST from an origin NOT in the whitelist
curl -X POST \
  -H "Content-Type: text/plain" \
  -d '{"fullName":"Test","idNumber":"123456","company":"TestCo","destination":"Lobby","visitationDate":"2030-01-01","phone":"+60123456789","email":"test@test.com","idPhoto":"data:image/jpeg;base64,/9j/4AAQ...","selfie":"data:image/jpeg;base64,/9j/4AAQ...","sheetId":"1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs","origin":"https://evil-site.com"}' \
  "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
# Expected: {"status":"error","error":"Registration unavailable from this location. Please contact the front desk."}
```

### Test 6 — Check DeniedLog

Open your master config sheet. You should now see a `DeniedLog` tab with rows logged for each denied request, including:

- `Timestamp` when the block occurred
- `SheetId` of the customer
- `Origin` that was reported
- `Reason` code (`UNKNOWN_CUSTOMER`, `ACCOUNT_DISABLED`, `ACCOUNT_PAUSED`, `ORIGIN_BLOCKED`)
- `EndpointType` (`get`, `register`, `status`, `admin`)
- `UserAgent` (empty for now — will be populated in a future phase)

---

## Architecture Notes

### How validation works

```
Request → doGet() / doPost()
            ↓
         validateRequest(e, sheetId, endpointType)
            ↓
         1. Skip if health check (no action)
         2. Reject MISSING_SHEET_ID
         3. Lookup customer in master config cache
         4. Reject UNKNOWN_CUSTOMER
         5. Reject ACCOUNT_DISABLED / ACCOUNT_PAUSED
         6. Skip origin check if not 'register' endpoint
         7. Extract origin from POST body or GET param
         8. Check origin against allowedOrigins whitelist
         9. Reject ORIGIN_BLOCKED if no match
        10. Return { valid: true, tier, visitorLimit, status }
```

### Per-execution caching

The master config is loaded once per script execution. A global variable `_masterConfig` holds the parsed config map (sheetId → config object). This means:

- **First request** after a cold start: reads from Google Sheets
- **Subsequent requests** in the same execution: uses the in-memory cache
- Changes to the master config sheet take effect on the **next script execution** (typically within minutes due to GAS caching)

### Endpoint type mapping

| Mode / Action | Endpoint Type | Origin Check? |
|---|---|---|
| Registration (no mode) | `register` | ✅ Yes |
| `mode=updateStatus` | `status` | ❌ No (but customer must exist & be active) |
| `mode=migrate` | `admin` | ❌ No |
| `action=report` | `admin` | ❌ No |
| `mode=bulkSignOut` | `admin` | ❌ No |
| `mode=setupAutoSignOut` | `admin` | ❌ No |
| GET (lookup, today, etc.) | `get` | ❌ No (but customer must exist & be active) |
| GET (no action / health) | `health` | ❌ Skipped entirely |

---

## Troubleshooting

### "Failed to open master config" in logs

- Verify `MASTER_CONFIG_ID` is set correctly in Script Properties
- Ensure the script has access to the master config sheet (share it with the script's service account email if needed)

### "Customers tab not found"

- Make sure the tab in the master config sheet is named exactly **Customers** (case-sensitive)

### Registration still works from unlisted origins

- Check that the frontend is actually sending `origin: window.location.origin` in the POST body
- Check the GAS logs for `[validateRequest] No origin provided` warnings
- If the master config has an empty `allowedOrigins` field, the system allows all origins (legacy mode) and logs a warning

### False positive blocks

- Verify the `allowedOrigins` entry matches your actual domain
- Example: if your app runs at `https://visitor.example.com/app/`, the allowed origin is `visitor.example.com` — protocols and paths are stripped

---

## Next Steps (Phase 2)

Phase 2 will add:

- **Usage counting** — track registration counts against `visitorLimit`
- **Hard block on limit exceeded** — return `VISITOR_LIMIT_REACHED` when limit is hit
- **Tier-based rate limiting** — different request caps per tier
- **User-Agent logging** — record the actual User-Agent header for denied requests
