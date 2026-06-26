# LITEVM Dashboard — Deployment Guide

## Overview

This is a **pure snapshot dashboard** for LITEVM's Google Sheets. It has no formulas, no triggers, and no hidden helper columns. The `refreshDashboard()` function reads all data in-memory and writes static values to the **Dashboard** tab. The user clicks **[⟳ Reload]** to refresh.

## Files

| File | Purpose |
|---|---|
| `Dashboard.gs` | Full Apps Script code — add as a new script file in your project |
| `Code.gs` | Existing Web App endpoints (do **not** modify) |

---

## Step 1: Add Dashboard.gs to Your Apps Script Project

1. Open your **Google Sheet** (`1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs`)
2. Go to **Extensions > Apps Script**
3. In the Apps Script editor, look at the **Files** panel on the left
4. Click **Add a file > Script** (or the `+` icon next to "Files")
5. Name it **Dashboard**
6. Copy the entire contents of `Dashboard.gs` and paste it into the new file
7. **Save** (Ctrl+S / ⌘S)

You will now see two files in the project:

- `Code.gs` (your existing Web App code — untouched)
- `Dashboard.gs` (the new dashboard code)

## Step 2: Run the Layout Setup (Once)

This creates the **Dashboard** tab with merged cells, colors, labels, and the reload button.

1. In the Apps Script editor, make sure `Dashboard.gs` is selected
2. In the function dropdown at the top, select **`setupDashboardLayout`**
3. Click **Run** (▶)
4. Review the permissions dialog (first run only):
   - It needs access to your spreadsheet and slides (for the button shape)
   - Click **Review Permissions** → choose your Google account → click **Advanced** → **Go to LITEVM (unsafe)** → **Allow**
5. Wait for the "✅ Dashboard layout is ready!" alert
6. Go back to your Google Sheet — you'll see a new **Dashboard** tab

> **Note:** Google Apps Script cannot programmatically create clickable drawings in Sheets. After setup runs, cell **J3** will show instructions for creating the button manually. See **Step 4** below.

## Step 3: Using the Dashboard

### Date Filters

- **Cell G1** — Start date (defaults to today)
- **Cell I1** — End date (defaults to today)

Change these to any date to filter the data. Click **[⟳ Reload]** to refresh.

> **Important:** These are **static date values**, not formulas. If you want them to automatically update to today each time the sheet opens, manually set them to `=TODAY()` and add date formatting.

### Reloading Data

Three ways to refresh:

1. **Click the blue [⟳ Reload] button** on the Dashboard tab
2. **Menu:** 📊 Dashboard > **Reload Dashboard**
3. **Editor:** Run `refreshDashboard()` from the Apps Script editor

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

## Step 4: Alternative — Manual Button (if auto-insert fails)

If the script couldn't insert the button shape automatically:

1. Go to the **Dashboard** tab
2. Go to **Insert > Drawing**
3. Draw a rounded rectangle, type **⟳ Reload**
4. Style it any way you like (blue background, white text recommended)
5. Click **Save & Close**
6. Click on the drawing, then click the **three dots (...)** that appear
7. Select **Assign script**
8. Type **`refreshDashboard`** and click **OK**

## Step 5: Deploy & Save

No separate deployment is needed for the dashboard functions — they run directly in the spreadsheet. Simply **save** the Apps Script project. The `onOpen(e)` function will automatically add the **📊 Dashboard** menu when anyone opens the sheet.

> If you also need the existing Web App (Code.gs) to continue working, do **not** redeploy — your existing deployment remains intact. The dashboard runs as client-side functions, not as a Web App.

## What to Expect When You Open the Sheet

1. A **📊 Dashboard** menu appears in the menu bar
2. The **Dashboard** tab shows six KPI cards across two rows
3. Below them are chart summary tables (Status Distribution, 7-Day Trend, Top Destinations, Card Pool)
4. Date filter cells G1 and I1 are pre-filled with today's date
5. Click **[⟳ Reload]** or go to **📊 Dashboard > Reload Dashboard** to refresh

## Common Issues

| Issue | Fix |
|---|---|
| **Button click does nothing** | Re-assign the script: click the button → three dots → Assign script → enter `refreshDashboard` |
| **"Dashboard tab not found"** on reload | Run `setupDashboardLayout()` once from the editor |
| **All KPIs show 0** | Check date filters in G1 and I1 — they must fall within your VisitorLog data |
| **Data doesn't update** | Click [⟳ Reload] to re-run the snapshot |
| **"Cannot read properties of null"** | One of the source tabs (VisitorLog, cardno, Destination) is missing or has different column structure |

## Key Functions Reference

| Function | When to Call |
|---|---|
| `refreshDashboard()` | Main refresh — reads data, computes, writes snapshot. Call from button/menu. |
| `setupDashboardLayout()` | Run **once** to create the Dashboard tab with layout and button. Safe to re-run to rebuild layout. |
| `onOpen(e)` | Auto-runs when sheet opens — adds the 📊 Dashboard menu. No manual action needed. |

## Technical Notes

- **No formulas** — all cells contain static values written by the script
- **No triggers** — refresh is manual via button/menu
- **No hidden columns** — the entire Dashboard tab is visible
- **In-memory filtering** — all data is filtered using JavaScript array operations, not QUERY or FILTER formulas
- **Column layout** — VisitorLog uses columns: 0=Timestamp, 1=FullName, 2=ID, 3=Company, 4=Destination, 5=Phone, 6=Email, 7=IDPhoto URL, 8=Selfie URL, 9=VisitorNo, 10=Status, 11=ActionTime
- **cardno layout** — columns: 0=CardNo, 1=Status, 2=AssignedTo, 3=AssignedAt
- **Destination layout** — columns: 0=Destination, 1=Access Level
