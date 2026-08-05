# LITEVM — Complete Installation Guide

**Version:** 1.10.0

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
3. **Description**: `LITEVM v1.10.0`
4. **Execute as**: `Me`
5. **Who has access**: `Anyone`
6. Click **Deploy**
7. **Copy the Web App URL** — you'll need this for every kiosk config.js

> **Important:** The first time you deploy, you'll be prompted to authorize the script. Grant access to Google Sheets, Drive, and any other requested scopes.

### 1D. Verify Deployment

```bash
curl -sL "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?mode=health"
# Expected: {"status":"ok","message":"LITEVM Web App is running","version":"1.10.0"}
```

### 1E. Install Auto Sign-Out Trigger (one-time)

After deployment, open the GAS editor, run this function once from the editor:

```javascript
setupAutoSignOutTrigger();
```

This installs an hourly time-driven trigger. Each customer's Settings tab controls whether and when auto sign-out runs (default: 21:00).

---

## Step 2: Create the Master Config Sheet

This is your **admin control panel** — one sheet that manages all customers.

### 2A. Create the Sheet

1. Open [sheets.google.com](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it "LITEVM Master Config"

### 2B. Create the Customers Tab

Rename the default sheet to **`Customers`** and set up these columns in row 1:

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| `sheetId` | `allowedOrigins` | `tier` | `visitorLimit` | `status` | `notes` | `autoSignOutHour` | `autoSignOutEnabled` | `registeredAt` |

**Column descriptions:**

| Column | Header | Description |
|--------|--------|-------------|
| A | `sheetId` | Customer's Google Sheet ID (unique key) |
| B | `allowedOrigins` | Comma-separated list of allowed domains (leave blank to allow all origins) |
| C | `tier` | Plan tier: `free`, `starter`, `pro`, `admin` |
| D | `visitorLimit` | Max visitor registrations per day: `50`, `500`, `999999` |
| E | `status` | Account status: `active`, `pending`, `paused`, `disabled` |
| F | `notes` | Optional memo/notes field |
| G | `autoSignOutHour` | Hour for auto sign-out (0-23, default `21`) |
| H | `autoSignOutEnabled` | `TRUE` or `FALSE` (default `TRUE`) |
| I | `registeredAt` | Auto-filled timestamp (leave empty for manual entries) |

### 2C. Add Your First Customer

Row 1 header + Row 2 = your customer:

| sheetId | allowedOrigins | tier | visitorLimit | status | notes | autoSignOutHour | autoSignOutEnabled |
|---------|---------------|------|-------------|--------|-------|----------------|-------------------|
| `1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs` | `knyf3.github.io` | `admin` | `999999` | `active` | `Demo` | `21` | `TRUE` |

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

Per customer, set in the **Settings** tab of their sheet:

| Setting | Value | Description |
|---------|-------|-------------|
| `autoSignOutEnabled` | `TRUE` | Enable auto sign-out for this customer |
| `autoSignOutHour` | `21` | Hour to sign out (0-23) |

Default values are created by migration (v4): enabled=TRUE, hour=21.

### How It Works

1. An hourly time-driven trigger runs `autoSignOut()` in the GAS
2. It reads all active customers from Master Config
3. For customers where `autoSignOutHour` matches the current hour:
   - Signs out all "Checked In" visitors
   - Records sign-out time in VisitorLog
   - Releases all assigned cards back to Available

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
