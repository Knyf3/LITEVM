# LITEVM — Complete Installation Guide

**Version:** 1.15.0

A lightweight, mobile-first visitor pre-registration system with guard verification portal, card assignment, and auto sign-out. Built on Google Sheets, Google Apps Script, and GitHub Pages.

---

## Architecture Overview

```
Visitor (mobile browser)
        │
        ▼  HTTPS
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Kiosk Frontend  │────▶│  GAS Web App     │────▶│  Google Sheets   │
│  (GitHub Pages)  │     │  (Code.gs)       │     │  (Data Storage)  │
│                  │     │                  │     │  + Google Drive  │
│  per-customer    │     │  shared backend  │     │  (Photo Storage) │
│  deployment      │     │  multi-tenant    │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                                                 │
        ▼                                                 ▼
┌──────────────────┐                          ┌──────────────────────┐
│  Guard Portal    │                          │  Master Config Sheet │
│  (verify.html)   │                          │  (Admin: Customers,  │
│  same kiosk URL  │                          │   DeniedLog, etc.)   │
└──────────────────┘                          └──────────────────────┘
```

### Components

| Component | Technology | Hosting | Per-customer? |
|-----------|-----------|---------|---------------|
| Kiosk frontend | HTML/CSS/JS | GitHub Pages | ✅ Yes — separate repo or subfolder |
| Guard portal | verify.html in kiosk | Same as kiosk | ✅ Same URL |
| Backend API | Google Apps Script (Code.gs) | GAS Web App | ❌ Single shared deployment |
| Data storage | Google Sheets | Google Drive | ✅ Yes — one sheet per customer |
| Photo storage | Google Drive | GAS Drive API | ✅ Per-customer folder |
| Master config | Google Sheet | Google Drive | ❌ One admin sheet for all customers |

### Deployment Flavors: Online-Only vs On-Prem

LITEVM ships in two flavors. Everything below the matrix line is identical (GAS backend, Sheet DB, Drive photos, master config) — the difference is whether physical door access is in scope.

| Component | Online-Only | On-Prem / Kiosk |
|-----------|-------------|-----------------|
| Frontend (GitHub Pages) | ✅ | ✅ (or local file copy) |
| GAS backend + Sheet DB | ✅ | ✅ |
| **Auto sign-out** | **GAS hourly trigger only** | GAS hourly (safety net) + `auto-signout.py` (ACT revoke) |
| ACTApi door access | — | ✅ on customer LAN |
| Windows companion box | — | ✅ (runs `auto-signout.py` beside ACTApi) |
| `config.js` → `ACTApiBase` | `null` | `http://<lan-ip>:8021` |

**Online-only:** no local hardware. The GAS hourly trigger (`autoSignOut()`) handles the entire sign-out — flips `Checked In → Signed Out`, records the time, releases the card back to the pool. Auto sign-out is 100% cloud-side and never depends on a LAN device.

**On-prem / kiosk:** adds ACT Pro door control on the customer LAN. Door access is granted/revoked by the guard portal browser directly against ACTApi (`verify.js` → `ACTApiBase`). Because the browser is not open at the auto sign-out hour, the optional `auto-signout.py` companion (same Windows box as ACTApi) revokes door access for all checked-in visitors at the configured hour, then asks GAS to sign them out. It degrades gracefully — if ACTApi is unreachable it skips the revoke and still performs the GAS sign-out.

Both flavors share the same auto sign-out engine in GAS: hourly time-driven trigger, per-customer `autoSignOutHour` evaluated **in the customer's own timezone** (`timezone` column in master config, e.g. `Asia/Jakarta`). For on-prem customers running both paths, the GAS trigger is an idempotent safety net — whichever path runs first signs the visitor out; the second finds nothing to do.

---

## Prerequisites

- **Google Account** — for GAS deployment, Google Sheets, Google Drive
- **GitHub Account** — for hosting the kiosk frontend
- **Template Sheet** — pre-formatted customer sheet (see Step 3)

---

## Step 1: Deploy the Backend (Google Apps Script)

### 1A. Create the GAS Project

1. Go to [script.google.com](https://script.google.com)
2. Click **Create project** → **Blank project**
3. Name it e.g. "LITEVM Backend"
4. Delete any default code in `Code.gs`
5. Paste the entire contents of `apps-script/Code.gs` (from GitHub)
6. Click **Save** (Ctrl+S)

### 1B. Set Script Properties

Go to **Project Settings** → **Script Properties** and add:

| Property | Value | Description |
|----------|-------|-------------|
| `MASTER_CONFIG_ID` | *(your master config sheet ID)* | See Step 2 — set this after creating the Master Config sheet |

### 1C. Deploy the Web App

1. Click **Deploy** → **New deployment**
2. Select **Web app** as deployment type
3. **Description**: `LITEVM v1.15.0`
4. **Execute as**: `Me`
5. **Who has access**: `Anyone`
6. Click **Deploy**
7. **Copy the Web App URL** — you'll need this for every kiosk config.js

> **Important:** The first time you deploy, you'll be prompted to authorize the script. Grant access to Google Sheets, Drive, and any other requested scopes.

### 1D. Verify Deployment

```bash
curl -sL "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?mode=health"
# Expected: {"status":"ok","message":"LITEVM Web App is running","version":"1.15.0"}
```

### 1E. Install Auto Sign-Out Trigger (one-time)

After deployment, open the GAS editor, run this function once from the editor:

```javascript
setupAutoSignOutTrigger();
```

This installs an hourly time-driven trigger. Each customer's Master Config row controls whether, when, and in which timezone auto sign-out runs (default hour: 21:00). See Step 7.

---

## Step 2: Create the Master Config Sheet

This is your **admin control panel** — one sheet that manages all customers.

### 2A. Create the Sheet

1. Open [sheets.google.com](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it "LITEVM Master Config"

### 2B. Create the Customers Tab

Rename the default sheet to **`Customers`** and set up these **header names** in row 1:

`sheetId` | `allowedOrigins` | `tier` | `visitorLimit` | `status` | `notes` | `autoSignOutHour` | `autoSignOutEnabled` | `timezone` | `retentionDays` | `expiryDate` | `expiryWarningDays`

> **Header-name driven:** the backend resolves columns by header NAME (`resolveColumns`), never by column address. Order is flexible — you may insert or reorder columns freely; the `timezone` header can live anywhere. Do not rename or delete headers. Adding a new header at any position is safe and requires no code change.

**Column descriptions:**

| Header | Description |
|--------|-------------|
| `sheetId` | Customer's Google Sheet ID (unique key) |
| `allowedOrigins` | Comma-separated list of allowed domains (leave blank to allow all origins) |
| `tier` | Plan tier: `free`, `starter`, `pro`, `admin` |
| `visitorLimit` | Max visitor registrations per day: `50`, `500`, `999999` |
| `status` | Account status: `active`, `pending`, `paused`, `disabled` |
| `notes` | Optional memo/notes field |
| `autoSignOutHour` | Hour for auto sign-out (0-23, default `21`) |
| `autoSignOutEnabled` | `TRUE` or `FALSE` (default `TRUE`) |
| `timezone` | IANA timezone for the customer (e.g. `Asia/Jakarta`, `Asia/Singapore`). Used to evaluate the auto sign-out hour and daily boundaries. Empty = GAS project timezone. |
| `retentionDays` | Retention window in days. VisitorLog rows whose Visitation Date is older than this are purged daily (see Step 9). Empty/blank = no purge. Suggested default `90`. |
| `expiryDate` | Customer subscription expiry date in `YYYY-MM-DD` form. The customer is valid **through** this date (inclusive); enforcement disables access the morning after. Empty/blank = no expiry. |
| `expiryWarningDays` | Number of days before `expiryDate` that the customer enters the "expiring" warning state (no access change, audit-only). Empty/blank or invalid = default `7`. |

### 2C. Add Your First Customer

Row 1 header + Row 2 = your customer:

| sheetId | allowedOrigins | tier | visitorLimit | status | notes | autoSignOutHour | autoSignOutEnabled | timezone | retentionDays | expiryDate | expiryWarningDays |
|---------|---------------|------|-------------|--------|-------|----------------|-------------------|----------|---------------|------------|-------------------|
| `1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs` | `demo.litevm.itt.web.id` | `pro` | `1000` | `active` | `Test sheet` | `21` | `TRUE` | `Asia/Jakarta` | `90` | *(blank — no expiry)* | *(blank — default 7)* |

### 2D. Create the DeniedLog Tab (optional but recommended)

Add a second tab named **`DeniedLog`** with headers:

`Timestamp` | `SheetId` | `Origin` | `Reason` | `EndpointType` | `UserAgent`

Blocked requests will be logged here automatically.

### 2E. Link Master Config to GAS

Copy the **Sheet ID** from the URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
```

Set it in the GAS Script Properties:
- Go to GAS editor → **Project Settings** → **Script Properties**
- Add: **Name** = `MASTER_CONFIG_ID`, **Value** = `THE_SHEET_ID`
- Click **Save**

### 2F. Redeploy the GAS

After setting Script Properties, redeploy the GAS to pick up the config:

1. Go to **Deploy** → **Manage deployments**
2. Click the **pencil icon** next to your active deployment
3. Click **Deploy** (this updates the existing URL with the new config)

---

## Step 3: Create the Customer Template Sheet

A master template with all required tabs. Copy this for each new customer.

### 3A. Create the Template

1. Create a blank Google Sheet
2. Name it "LITEVM Customer Template"
3. Give me the Sheet ID and I'll run the migration to set up all tabs

Or run the migration yourself via curl:

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "migrate", "sheetId": "YOUR_TEMPLATE_SHEET_ID"}'
```

### 3B. Template Structure (After Migration)

The template will have these tabs after migration:

| Tab | Purpose | Headers |
|-----|---------|---------|
|| **VisitorLog** | Registration data (15 columns) | Timestamp, Full Name, ID/Passport, Company, Destination, Visitor Type, Visitation Date, Hand Phone, Email, ID Photo (Drive URL), Selfie (Drive URL), Visitor Number, Status, Sign-In Time, Sign-Out Time |
|| **cardno** | Physical card pool | CardNo, Status, AssignedTo, AssignedAt |
|| **Destination** | Destination/access mapping | Destination, Access Level, DoorGroupID |
|| **VisitorType** | Visitor type options | Visitor Type (single column) |
|| **Settings** | Per-sheet configuration | Setting, Value (autoSignOutEnabled=TRUE, autoSignOutHour=21, guardPin=1234) |
|| **\\_version** | Hidden — migration version tracking | A1: SHEET_VERSION=6 |

### 3C. Populate Destinations (per customer)

Before going live, fill in the **Destination** tab with the customer's locations:

```
| Destination | Access Level | DoorGroupID |
|-------------|-------------|-------------|
| Lobby       | 1           |             |
| Office 2F   | 2           |             |
| Meeting Room| 3           |             |
```

### 3D. Populate Card Pool (per customer)

If using physical access cards, populate the **cardno** tab:

```
| CardNo  | Status    | AssignedTo | AssignedAt |
|---------|-----------|------------|------------|
| 10001   | Available |            |            |
| 10002   | Available |            |            |
| 10003   | Available |            |            |
```

---

## Step 4: Deploy the Kiosk Frontend

Each customer gets their own kiosk deployment. This is the page visitors open on their phone to register.

### 4A. Create the Kiosk Repo

Clone the files from an existing kiosk repo (e.g. TESTLITEVM2) and customize:

```
/kiosk/
├── index.html       — Registration form (main kiosk page)
├── app.js           — Registration logic
├── styles.css       — Styling
├── config.js        — Per-customer config (modify this)
├── lang.js          — Language/i18n
├── verify.html      — Guard portal
├── verify.js        — Guard logic
├── verifylocal.html — Local-network guard portal (for ACTApi integration)
└── report.html      — Admin report page
```

### 4B. Configure config.js

Edit `config.js` for each customer:

```javascript
const CONFIG = {
  SHEET_ID: 'CUSTOMER_SHEET_ID',
  API_BASE: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  SITE_NAME: 'Customer Name Visitor Registration',
  DEFAULT_LANG: 'en',
  PHOTO_MAX_SIZE: 5 * 1024 * 1024,
  PHOTO_MAX_DIMENSION: 1024,
  PHOTO_JPEG_QUALITY: 0.8,
  TIMEOUT_MS: 30000,
  GUARD_PIN: '1234',     // Guard portal PIN — change per customer
  ACTApiBase: null,       // Set to ACT API URL for door integration
};
```

| Field | What to set |
|-------|-------------|
| `SHEET_ID` | Customer's Google Sheet ID (from template copy) |
| `API_BASE` | Your GAS Web App URL (same for all customers) |
| `SITE_NAME` | Customer-facing name shown in the kiosk |
| `GUARD_PIN` | Change this per customer for security |
| `ACTApiBase` | Leave `null` unless ACT Pro integration is active |

### 4C. Deploy to GitHub Pages

1. Create a new GitHub repo: `github.com/Knyf3/CUSTOMER-NAME-kiosk`
2. Push the kiosk files to `main` branch
3. Enable GitHub Pages:
   - Go to repo → **Settings** → **Pages**
   - Branch: `main`, folder: `/ (root)`
   - Save

The kiosk will be live at:
```
https://knyf3.github.io/CUSTOMER-NAME-kiosk/
```

---

## Step 5: Customer Onboarding Workflow

Complete end-to-end process for adding a new customer.

```
Owner                                            Customer
─────                                            ────────
 1. Copy template sheet (File → Make a copy)
 2. Share copy with customer as Editor
 3. Add sheet ID to Master Config → Customers       │
    tab with status=active                           │
                                                     ▼
                                              4. Opens kiosk URL
                                              5. Fills registration form
                                              6. Captures ID photo + selfie
                                              7. Submits → gets visitor number
                                                     │
 8. Guard portal: scan/verify visitor                │
 9. Check-in → assign card                           │
                                                     ▼
                                              10. Visitor enters building
                                              11. Leaves (sign-out auto/manual)
```

### Customer Responsibilities

1. Create a Google Sheet (or receive the template copy from you)
2. Share their sheet with the GAS deployer's email (Editor access)
3. Populate their Destination tab with locations
4. Provide their card numbers for the cardno tab

---

## Step 6: Guard Portal Setup

The guard portal (verify.html) is served from the same kiosk URL:
```
https://knyf3.github.io/CUSTOMER-NAME-kiosk/verify.html
```

### Guard Functions

| Feature | How |
|---------|-----|
| Lookup visitor | Search by name, ID, visitor number, or card |
| Check-in | Tap **Check In** → assigns card, records time |
| Sign out (individual) | Tap **Sign Out** → releases card back to pool |
| Bulk sign out | Tap **Bulk Sign Out** → signs out all checked-in visitors |
| View today's list | Shows all visitors registered today with status |

### Guard PIN

The default PIN is `1234`. Change it per customer in `config.js`:
```javascript
GUARD_PIN: '5678',
```

---

## Step 7: Auto Sign-Out

The system can automatically sign out all checked-in visitors at a configurable hour.

### Configuration

Set per customer in the **Master Config → Customers tab** — this is the trigger authority (since v1.13.0):

| Column | Value | Description |
|--------|-------|-------------|
| `autoSignOutHour` | `21` | Hour to sign out (0-23), evaluated in the customer's timezone |
| `autoSignOutEnabled` | `TRUE` | Enable auto sign-out for this customer |
| `timezone` | `Asia/Jakarta` | IANA timezone — the sign-out hour is computed in THIS zone, not the GAS project zone |

The customer's own **Settings** tab mirrors these values for UI display only; the master config wins on conflict.

Defaults are created by migration (v8): enabled=TRUE, hour=21, timezone = GAS project timezone.

### How It Works

1. An **hourly** time-driven trigger runs `autoSignOut()` in GAS (installed once via `setupAutoSignOutTrigger()`, self-heals on deploy)
2. It reads all active customers from Master Config **once** (5-minute cache)
3. For each customer it computes the current hour **in that customer's timezone** and processes only those whose local hour matches `autoSignOutHour`:
   - Signs out all "Checked In" visitors
   - Records sign-out time in VisitorLog
   - Releases all assigned cards back to Available
4. If more than 40 customers are due in a single tick, the remainder is queued and processed on the next hourly tick (guards the 6-minute GAS execution limit — safe at 100+ sheets, ~6 min/day trigger runtime)
5. **On-prem only:** if the customer runs ACTApi door control, deploy `auto-signout.py` on the same Windows box — it revokes ACT door access for the visitors before/alongside the GAS sign-out. **Online-only customers skip this entirely** — the GAS trigger is the complete auto sign-out (see "Deployment Flavors" in the Architecture Overview).

### Manual Trigger

Run auto sign-out immediately via curl:

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "setupAutoSignOut"}'
```

---

## Step 8: Running Migration on Existing Customer Sheets

When you add new features that require schema changes, update existing customer sheets individually.

### Migration Command

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "migrate", "sheetId": "CUSTOMER_SHEET_ID"}'
```

### Version History

| Version | Name | Description |
|---------|------|-------------|
| v1 | Initial structure | Creates VisitorLog, cardno, Destination tabs |
| v2 | Visitation Date columns | Adds Visitation Date, renames Action Time to Sign-In Time, adds Sign-Out Time |
| v3 | DoorGroupID | Adds DoorGroupID column to Destination tab |
| v4 | Settings tab | Creates Settings tab with auto sign-out defaults |
| v5 | Hidden version sheet | Moves SHEET_VERSION marker from VisitorLog!A1000 to hidden _version sheet |
| v6 | Visitor Type column + tab | Adds Visitor Type column after Destination in VisitorLog, creates VisitorType tab |

> **Important:** Always run migration per-customer. No bulk migration to prevent cascading failures.

---

## Step 9: Data Retention (Automatic Purge)

The system can automatically delete old VisitorLog rows to keep customer sheets within Google Sheets cell limits and protect visitor privacy.

### Configuration

Set per customer in **Master Config → Customers tab** — the `retentionDays` column:

| Header | Value | Description |
|--------|-------|-------------|
| `retentionDays` | `90` | Purge rows whose Visitation Date is older than this many days. Empty/blank = no purge. |

### How It Works

1. A **daily** time-driven trigger runs `runDailyMaintenance()` at **02:05** (which runs the retention purge then the expiry pass; installed automatically alongside the auto sign-out and card-release triggers and self-heals on deploy).
2. The purge criterion is **Visitation Date only** — there is **no status filter**. No-shows, pending, and never-came visitors are purged just like checked-in visitors once their Visitation Date falls outside the window.
3. A row is purged only when its Visitation Date is **strictly older** than `retentionDays` days ago (a row dated exactly `retentionDays` days ago is kept).
4. Photos (ID photo + selfie) are moved to Drive **Trash** (`setTrashed(true)`), not permanently deleted.
5. Each purge writes a row to the **PurgeLog** tab on the Master Config sheet (created automatically).

### Daily Limits (Large Backlogs)

The daily run is deliberately bounded to protect the 6-minute Apps Script execution limit:

- **10 customer sheets** per run (the remainder queues to the next day automatically).
- **50 rows** per sheet per run.
- **150 Drive operations** per run.

A large backlog (more than ~1000 qualifying rows) therefore drains gradually at ~50 rows/sheet/day rather than all at once. If you need to purge a very large backlog in one shot, contact your administrator for a one-time bulk cleanup — do not raise these limits in code.

### Dry Run

To preview what would be purged **without** deleting any rows or trashing any photos, trigger a dry run (requires a valid customer sheetId):

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "retentionDryRun", "sheetId": "CUSTOMER_SHEET_ID"}'
```

Dry-run results appear in the **PurgeLog** tab with the sheetId prefixed `[DRY] ` and nothing is actually removed.

To force an immediate live purge (instead of waiting for the 02:05 trigger):

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "runRetention", "sheetId": "CUSTOMER_SHEET_ID"}'
```

### Trash Note

Purging moves photos to Drive Trash; Drive **quota is not freed until the Trash is emptied manually** (or by your Drive retention policy). To reclaim space, empty the Drive Trash periodically.

### PurgeLog Location

Purge results are written to the **`PurgeLog`** tab on the **Master Config** sheet (auto-created on first purge). Columns: `Timestamp`, `SheetId`, `RowsPurged`, `PhotosTrashed`, `RowsSkippedUnparseable`, `RowsSkippedEmpty`, `PhotoErrors`.

---

## Step 10: Customer Expiry

Per-customer subscription expiry. A customer's access lapses automatically when its subscription `expiryDate` passes, without you having to remember to flip their status manually.

### Configuration

Set per customer in **Master Config → Customers tab**:

| Header | Value | Description |
|--------|-------|-------------|
| `expiryDate` | `2026-12-31` | Subscription end date (`YYYY-MM-DD`). Customer is valid **through** this date. Empty/blank = no expiry. |
| `expiryWarningDays` | `7` | Days before `expiryDate` the customer enters the "expiring" warning state. Empty/blank = `7`. |

### How It Works (warn-first)

1. Expiry state is **derived from `expiryDate` on every request** — it is not stored in the `status` column.
2. **Expiring** (`remainingDays` between `expiryWarningDays` and `0`, inclusive): the customer keeps full access; the state is surfaced for audit only (via the `config` endpoint's `expiryState` field). No status change.
3. **Expired** (`remainingDays < 0`): requests are denied with `ACCOUNT_EXPIRED` immediately — even if the `status` column still says `active`.
4. The daily **02:05** pass (`runDailyMaintenance` → `runExpiry`) also *materializes* `status=disabled` for expired customers whose status is still `active`. This persisted write is a fallback; enforcement is always derived.

### Same-Day Boundary

A customer is valid **through** their `expiryDate` day, inclusive. On the expiry date itself `remainingDays === 0` and the customer is still allowed (state = `expiring`). They are denied (`ACCOUNT_EXPIRED`) and materialized `disabled` the **next morning**, once `remainingDays` goes negative. The day boundary is evaluated in the customer's configured `timezone` (fallback: the GAS project timezone).

### What Respects Expiry

- **All API requests** (`validateRequest`) — expired customers get `ACCOUNT_EXPIRED`.
- **`actEnabled`** (config endpoint) — `false` for expired customers, even if status is still `active`.
- **License issuance** (`issueLicense`) — refused with `ACCOUNT_EXPIRED` for expired customers.

> Email alerting on expiry is **not** in this version — it is planned for a future release (`EXPIRY_ALERT_EMAIL`).

### Dry Run

Preview what the expiry pass would do **without** changing any status:

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "expiryDryRun", "sheetId": "CUSTOMER_SHEET_ID"}'
```

Dry-run rows in **ExpiryLog** use `Action = would_disable` (live runs use `disabled`, `already_disabled`, or `warn`).

To force an immediate live expiry pass (instead of waiting for 02:05):

```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "runExpiry", "sheetId": "CUSTOMER_SHEET_ID"}'
```

### ExpiryLog Location

Expiry events are written to the **`ExpiryLog`** tab on the **Master Config** sheet (auto-created on first run). Columns: `Timestamp`, `SheetId`, `ExpiryDate`, `RemainingDays`, `Action`, `PreviousStatus`.

### Recovery (Re-enable an Expired Customer)

1. In **Master Config → Customers**, set the customer's `expiryDate` to a future date (or clear it for no expiry).
2. If the daily pass already materialized `status=disabled`, set `status` back to `active`.

> The daily pass **never** re-disables a customer whose `expiryDate` is blank — clearing/extending the date is sufficient to stop future disables. A `paused` or operator-disabled customer is also never touched by the expiry pass.

---

## Troubleshooting

### "Cannot open sheet" error

- Verify the customer has shared their sheet with the GAS deployer's email (Editor access)
- Check the sheet ID is correct in config.js and Master Config
- The GAS runs under the deployer's identity — it can only access sheets shared with that account

### Health check returns old version

- Redeploy the GAS after updating Code.gs
- GAS caches deployed versions — updating the deployment pushes the new code

### Data starts at row 1001+

- The version marker was previously stored at VisitorLog!A1000
- Run migration v5 on the sheet to move it to the hidden _version sheet
- After migration, data will append at row 2

### Guard portal shows "Invalid PIN"

- Check `GUARD_PIN` in the kiosk's `config.js`
- The guard PIN in config.js should match what the guard enters

### Registration blocked with "Account pending activation"

- The customer's sheet is registered with `status=pending` in Master Config
- Set status to `active` to enable registrations

---

## Curl Command Reference

### Health check
```bash
curl -sL "https://script.google.com/macros/s/YOUR_GAS_URL/exec?mode=health"
```

### Migrate a customer sheet
```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "migrate", "sheetId": "CUSTOMER_SHEET_ID"}'
```

### Test GET request
```bash
curl -sL "https://script.google.com/macros/s/YOUR_GAS_URL/exec?action=config&sheetId=CUSTOMER_SHEET_ID"
```

### Test POST registration
```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"sheetId": "CUSTOMER_SHEET_ID", "origin": "https://knyf3.github.io"}'
```

### Bulk sign-out
```bash
curl -sL --post302 -X POST "https://script.google.com/macros/s/YOUR_GAS_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"mode": "bulkSignOut", "sheetId": "CUSTOMER_SHEET_ID"}'
```

---

## Reference: Key IDs

| Item | ID |
|------|-----|
| Master Config Sheet | *(your Master Config sheet ID)* |
| Customer Template | `199JdWHZZjil3O4hkrQtKbAZ6PA1EtRe3HZ_UcmYFaYw` |
| GAS Web App URL | *(your deployment URL)* |
| Demo Kiosk | `https://knyf3.github.io/LITEVM/` |
| Demo Guard Portal | `https://knyf3.github.io/LITEVM/verify.html` |
