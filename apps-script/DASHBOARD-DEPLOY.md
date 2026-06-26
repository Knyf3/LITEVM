# LITEVM Dashboard — Deployment Guide (Multi-Customer)

## Overview

The LITEVM Dashboard is a **pure snapshot dashboard** for Google Sheets. It has no
formulas, no triggers, and no hidden helper columns. `refreshDashboard()` reads all
data in-memory and writes static values to the **Dashboard** tab.

## Architecture

A **single Apps Script Web App** serves **multiple customer sheets**. Each customer
has their own Google Sheet, identified by `sheetId`. The dashboard supports two
operating modes:

### (a) Bound-Script Mode (Button / Menu)

Dashboard.gs lives **inside the same Apps Script project** that is bound to a
customer's sheet. In this mode:

- `onOpen(e)` adds a **📊 Dashboard** menu to the sheet
- `refreshDashboard()` uses `getActiveSpreadsheet()` — no sheetId needed
- Button clicks and menu items work instantly
- UI alerts are shown on success/error

### (b) Web App Mode (doPost via fetch)

The same Dashboard.gs functions are callable via the existing Web App endpoint.
In this mode:

- POST `{ mode: "dashboard", sheetId: "..." }` triggers `handleDashboardRefresh()`
- `refreshDashboard(sheetId)` uses `SpreadsheetApp.openById(sheetId)` — no UI
- Returns JSON `{ status: "ok" }` on success
- All KPIs are written directly to the target sheet's Dashboard tab

### Dual-Mode Function Design

Both public functions accept an **optional** `sheetId` parameter:

| Function | No sheetId (bound) | With sheetId (Web App) |
|---|---|---|
| `setupDashboardLayout(sheetId?)` | Uses `getActiveSpreadsheet()` | Opens by ID |
| `refreshDashboard(sheetId?)` | Shows UI alerts, returns nothing | No UI, returns `boolean` |

---

## Files

| File | Purpose | Location |
|---|---|---|
| `Code.gs` | Web App endpoints (GET/POST handlers) | Apps Script project root |
| `Dashboard.gs` | Dashboard snapshot logic — read, compute, write | Sibling file in same project |
| `DASHBOARD-DEPLOY.md` | This guide | Docs |

---

## Setup — Per Customer Sheet

### Step 1: Open the customer's Apps Script project

1. Open the customer's **Google Sheet**
2. Go to **Extensions > Apps Script**
3. This opens the **bound** Apps Script project for that sheet

> **Important:** The project may already be deployed as a Web App. Do NOT
> redeploy unless you know what you're doing — the deployment URL stays
> the same.

### Step 2: Add Dashboard.gs as a new file

1. In the Apps Script editor, click **Add a file > Script** (or `+` next to Files)
2. Name it **Dashboard**
3. Copy the entire contents of `Dashboard.gs` and paste it in
4. **Save** (Ctrl+S / ⌘S)

You should now see two files in the project:

- `Code.gs` — existing Web App endpoints (untouched)
- `Dashboard.gs` — new dashboard code

### Step 3: Run the Layout Setup (Once)

This creates the **Dashboard** tab with merged cells, colors, labels, and the
reload button instructions.

1. In the Apps Script editor, select `Dashboard.gs`
2. In the function dropdown, select **`setupDashboardLayout`**
3. Click **Run** (▶)
4. Review permissions on first run:
   - Click **Review Permissions**
   - Choose your Google account
   - Click **Advanced → Go to LITEVM (unsafe) → Allow**
5. Wait for the "✅ Dashboard layout is ready!" alert
6. Go back to the Google Sheet — a new **Dashboard** tab appears

### Step 4: Create the Reload Button (Manual Step)

Google Apps Script cannot programmatically create clickable drawings. After
setup runs, cell **J3** shows instructions. To create the button:

1. Go to the **Dashboard** tab
2. **Insert > Drawing**
3. Draw a rounded rectangle, type **⟳ Reload**
4. Style it (blue background, white text recommended)
5. Click **Save & Close**
6. Click the drawing, then click **the three dots (...)** that appear
7. Select **Assign script**
8. Type **`refreshDashboard`** and click **OK**

### Step 5: Verify the Menu

1. Reload the Google Sheet
2. A **📊 Dashboard** menu should appear in the menu bar
3. Click **📊 Dashboard > Reload Dashboard** — the dashboard should update

---

## Web App Dashboard Refresh (Programmatic)

If you want to trigger a dashboard refresh from the frontend or an external
system, POST to the Web App URL:

```json
POST {WEB_APP_URL}
Content-Type: application/json

{
  "mode": "dashboard",
  "sheetId": "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs"
}
```

Response:

```json
{
  "status": "ok",
  "message": "Dashboard refreshed"
}
```

Error responses:

```json
{
  "status": "error",
  "error": "Missing sheetId"
}
```

The Web App runs as **you** (the developer), so it can access any sheet you
have edit access to via `SpreadsheetApp.openById(sheetId)`.

---

## Using the Dashboard

### Date Filters

- **Cell G1** — Start date (defaults to today)
- **Cell I1** — End date (defaults to today)

Change these to any date to filter the data. Click **[⟳ Reload]** to refresh.

> **Note:** These are static date values, not formulas. Set them to `=TODAY()`
> if you want auto-updating dates.

### Reloading Data

Three ways to refresh:

1. **Click the blue [⟳ Reload] button** on the Dashboard tab
2. **Menu:** 📊 Dashboard > **Reload Dashboard**
3. **Web App:** POST `{ mode: "dashboard", sheetId }` (see above)

### What Gets Snapshot

| Area | Data |
|---|---|
| **KPI Cards** | Total Visitors, Checked In, Pending, Rejected, Cards Assigned, Cards Available |
| **Trends** | ▲ / ▼ / ◄ percentage vs same weekday last week |
| **Status Distribution** | Count of Checked In / Pending / Rejected |
| **7-Day Trend** | Registrations per day over last 7 days |
| **Top Destinations** | Top 5 destinations by visitor count |
| **Card Pool** | Available vs Assigned card counts |
| **Last Refreshed** | Timestamp in cell J2 |

---

## Common Issues

| Issue | Fix |
|---|---|
| **Button click does nothing** | Re-assign the script: click button → three dots → Assign script → `refreshDashboard` |
| **"Dashboard tab not found" on reload** | Run `setupDashboardLayout()` once from the editor |
| **All KPIs show 0** | Check date filters in G1 and I1 — they must fall within VisitorLog data |
| **Data doesn't update** | Click [⟳ Reload] or POST `mode=dashboard` via Web App |
| **"Cannot read properties of null"** | One of the source tabs (VisitorLog, cardno, Destination) is missing |
| **Web App returns "Missing sheetId"** | Include `sheetId` in the JSON payload |
| **Web App returns 500 on dashboard refresh** | Check Apps Script logs — ensure the developer has edit access to the target sheet |

---

## Key Functions Reference

| Function | Mode | When to Call |
|---|---|---|
| `setupDashboardLayout(sheetId?)` | Bound or Web App | Run **once** to create the Dashboard tab. Safe to re-run. |
| `refreshDashboard(sheetId?)` | Bound or Web App | Main refresh — reads data, computes, writes snapshot |
| `onOpen(e)` | Bound only | Auto-runs when sheet opens — adds 📊 Dashboard menu |
| `handleDashboardRefresh(data)` | Web App only | Called by `doPost` when `mode=dashboard` |

---

## Technical Notes

- **No formulas** — all cells contain static values written by the script
- **No triggers** — refresh is manual via button/menu or Web App POST
- **No hidden columns** — the entire Dashboard tab is visible
- **In-memory filtering** — all data is filtered using JavaScript array operations
- **Column layouts:**
  - `VisitorLog` — Timestamp, FullName, ID, Company, Destination, Phone, Email, IDPhoto URL, Selfie URL, VisitorNo, Status, ActionTime
  - `cardno` — CardNo, Status, AssignedTo, AssignedAt
  - `Destination` — Destination, Access Level
- **Authorization:** Web App runs as the developer. Any sheet the developer can edit is accessible via `SpreadsheetApp.openById()`.
- **Multi-customer:** Each customer has their own sheet with the same tab structure and the same bound Apps Script project containing both Code.gs and Dashboard.gs.
