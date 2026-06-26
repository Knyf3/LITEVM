/**
 * LITEVM — Dashboard Snapshot (Additional file in Apps Script project)
 *
 * Pure snapshot approach: no formulas, no triggers, no hidden helper columns.
 *
 * DUAL-MODE ARCHITECTURE (since June 2026):
 *   This file supports BOTH:
 *   (a) Bound-script usage — called from button/menu in a specific sheet
 *       using getActiveSpreadsheet()
 *   (b) Web App invocation — called via doPost with a sheetId parameter
 *       using SpreadsheetApp.openById(sheetId)
 *
 * All public functions (setupDashboardLayout, refreshDashboard) accept an
 * optional sheetId parameter. When called with sheetId, they operate in
 * "Web App mode" — no UI alerts, returns boolean success/failure.
 *
 * Add this file as a new script file in the existing Apps Script project:
 *   1. Open your Apps Script project
 *   2. Files > New > Script
 *   3. Paste this code, name it Dashboard.gs
 *   4. Run setupDashboardLayout() once from the editor (or via Web App)
 *   5. Save and close
 */

// ──────────────────────────────────────────────
// COLOR PALETTE
// ──────────────────────────────────────────────

var COLORS = {
  primary:        '#4361EE',   // KPI card headers, accent blue
  success:        '#10B981',   // Checked In / green
  warning:        '#F59E0B',   // Pending / amber
  danger:         '#EF4444',   // Rejected / red
  cardBg:         '#F8FAFC',   // Card background
  bodyText:       '#334155',   // Body text
  headings:       '#0F172A',   // Heading text
  white:          '#FFFFFF',
  border:         '#E2E8F0',
  lightGray:      '#F1F5F9',
};

// ──────────────────────────────────────────────
// ON OPEN — Custom Menu
// ──────────────────────────────────────────────

/**
 * Add a custom menu when the spreadsheet is opened.
 */
function onOpen(e) {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 Dashboard')
    .addItem('⟳ Reload Dashboard', 'refreshDashboard')
    .addSeparator()
    .addItem('⚙ Setup Dashboard Layout', 'setupDashboardLayout')
    .addToUi();
}

// ──────────────────────────────────────────────
// ON EDIT — Auto-Refresh on Date Change
// ──────────────────────────────────────────────

/**
 * Auto-refresh dashboard when date cells G1 or I1 are edited.
 * Uses a 1-second debounce to avoid rapid reloads.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  if (sheet.getName() !== 'Dashboard') return;
  var col = range.getColumn();
  var row = range.getRow();
  // Watch G1 (col 7, row 1) and I1 (col 9, row 1)
  if (row === 1 && (col === 7 || col === 9)) {
    Utilities.sleep(1000);
    refreshDashboard();
  }
}

// ──────────────────────────────────────────────
// SETUP: Dashboard Tab Layout (run once from editor)
// ──────────────────────────────────────────────

/**
 * Creates the Dashboard tab with visual layout, merged cells, colors,
 * and text styles. Run ONCE from the Apps Script editor after adding
 * this file, or invoke via Web App with sheetId. Does NOT overwrite
 * data if the tab already exists — it clears the tab and rebuilds the
 * layout, then runs refreshDashboard().
 *
 * @param {string} [sheetId] - Optional. When provided, opens the sheet by ID
 *   (Web App mode). When omitted, uses getActiveSpreadsheet() (bound mode).
 */
function setupDashboardLayout(sheetId) {
  var ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  var sheet = ss.getSheetByName('Dashboard');

  // Create the Dashboard tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Dashboard');
    sheet.setTabColor(COLORS.primary);
  } else {
    // Clear existing content and formatting
    sheet.clear();
  }

  // =============================================
  // ROW 1 — Title Bar
  // =============================================
  // Merge A1:E1 for title, F1:H1 spacer, I1 date range end, J1 reload button area
  sheet.getRange('A1').setValue('🏢 LITEVM · Visitor Management Dashboard');
  sheet.getRange('A1').setFontSize(18);
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('A1').setFontColor(COLORS.headings);
  sheet.getRange('A1:E1').merge();

  // Date range labels
  sheet.getRange('F1').setValue('Start');
  sheet.getRange('F2').setValue('End');
  sheet.getRange('F1').setFontSize(10);
  sheet.getRange('F1').setFontColor(COLORS.bodyText);
  sheet.getRange('F1').setFontWeight('bold');
  sheet.getRange('F2').setFontSize(10);
  sheet.getRange('F2').setFontColor(COLORS.bodyText);
  sheet.getRange('F2').setFontWeight('bold');

  // Date cells G1 and I1 — set to TODAY()
  sheet.getRange('G1').setValue(new Date());
  sheet.getRange('G1').setNumberFormat('dd/mm/yyyy');
  sheet.getRange('G1').setFontWeight('bold');
  sheet.getRange('G1').setFontColor(COLORS.primary);
  sheet.getRange('G1').setBackground(COLORS.lightGray);
  sheet.getRange('G1').setHorizontalAlignment('center');

  sheet.getRange('I1').setValue(new Date());
  sheet.getRange('I1').setNumberFormat('dd/mm/yyyy');
  sheet.getRange('I1').setFontWeight('bold');
  sheet.getRange('I1').setFontColor(COLORS.primary);
  sheet.getRange('I1').setBackground(COLORS.lightGray);
  sheet.getRange('I1').setHorizontalAlignment('center');

  // Column labels for date range
  sheet.getRange('H1').setValue('⟳');
  sheet.getRange('H1').setFontSize(10);
  sheet.getRange('H1').setFontColor(COLORS.bodyText);

  // Last refreshed cell (J2)
  sheet.getRange('J1').setValue('Last');
  sheet.getRange('J2').setValue('—');
  sheet.getRange('J1').setFontSize(10);
  sheet.getRange('J1').setFontColor(COLORS.bodyText);
  sheet.getRange('J1').setFontWeight('bold');
  sheet.getRange('J2').setFontSize(9);
  sheet.getRange('J2').setFontColor(COLORS.bodyText);
  sheet.getRange('J2').setFontStyle('italic');

  // =============================================
  // ROW 3 — Blank spacer
  // =============================================
  sheet.getRange('A3:J3').setBackground(COLORS.white);

  // =============================================
  // ROW 4-6 — KPI Row 1: Total Visitors | Checked In | Pending
  // =============================================
  setupKpiCard_(sheet, 4, 1, 'Total Visitors', COLORS.primary);        // A4:C6
  setupKpiCard_(sheet, 4, 4, 'Checked In', COLORS.success);            // D4:F6
  setupKpiCard_(sheet, 4, 7, 'Pending', COLORS.warning);               // G4:I6

  // =============================================
  // ROW 7 — Blank spacer
  // =============================================
  sheet.getRange('A7:J7').setBackground(COLORS.white);

  // =============================================
  // ROW 8-10 — KPI Row 2: Rejected | Cards Assigned | Today's Visitors
  // =============================================
  setupKpiCard_(sheet, 8, 1, 'Rejected', COLORS.danger);               // A8:C10
  setupKpiCard_(sheet, 8, 4, 'Cards Assigned', COLORS.primary);         // D8:F10
  setupKpiCard_(sheet, 8, 7, 'Today\'s Visitors', COLORS.primary);        // G8:I10

  // =============================================
  // ROW 11 — Blank spacer
  // =============================================
  sheet.getRange('A11:J11').setBackground(COLORS.white);

  // =============================================
  // ROW 12-16 — Chart Table 1: Status Distribution (A12:Bn)
  // ROW 12-16 — Chart Table 2: 7-Day Trend (E12:Fn)
  // =============================================
  sheet.getRange('A12').setValue('Status Distribution');
  sheet.getRange('A12').setFontWeight('bold');
  sheet.getRange('A12').setFontColor(COLORS.headings);
  sheet.getRange('A12').setFontSize(12);

  sheet.getRange('B12').setValue('Count');
  sheet.getRange('B12').setFontWeight('bold');
  sheet.getRange('B12').setFontColor(COLORS.headings);
  sheet.getRange('B12').setFontSize(12);

  sheet.getRange('E12').setValue('7-Day Trend (Registrations)');
  sheet.getRange('E12').setFontWeight('bold');
  sheet.getRange('E12').setFontColor(COLORS.headings);
  sheet.getRange('E12').setFontSize(12);

  sheet.getRange('F12').setValue('Count');
  sheet.getRange('F12').setFontWeight('bold');
  sheet.getRange('F12').setFontColor(COLORS.headings);
  sheet.getRange('F12').setFontSize(12);

  // =============================================
  // ROW 17 — Blank spacer
  // =============================================
  sheet.getRange('A17:J17').setBackground(COLORS.white);

  // =============================================
  // ROW 18-22 — Chart Table 3: Top Destinations (A18:Bn)
  // ROW 18-22 — Chart Table 4: Card Pool Summary (E18:Fn)
  // =============================================
  sheet.getRange('A18').setValue('Top Destinations');
  sheet.getRange('A18').setFontWeight('bold');
  sheet.getRange('A18').setFontColor(COLORS.headings);
  sheet.getRange('A18').setFontSize(12);

  sheet.getRange('B18').setValue('Visitors');
  sheet.getRange('B18').setFontWeight('bold');
  sheet.getRange('B18').setFontColor(COLORS.headings);
  sheet.getRange('B18').setFontSize(12);

  sheet.getRange('E18').setValue('Card Pool Status');
  sheet.getRange('E18').setFontWeight('bold');
  sheet.getRange('E18').setFontColor(COLORS.headings);
  sheet.getRange('E18').setFontSize(12);

  sheet.getRange('F18').setValue('Cards');
  sheet.getRange('F18').setFontWeight('bold');
  sheet.getRange('F18').setFontColor(COLORS.headings);
  sheet.getRange('F18').setFontSize(12);

  // =============================================
  // ROW 25+ — Recent Check-Ins Mini-List
  // =============================================
  sheet.getRange('A25').setValue('Recent Check-Ins');
  sheet.getRange('A25').setFontWeight('bold');
  sheet.getRange('A25').setFontColor(COLORS.headings);
  sheet.getRange('A25').setFontSize(12);

  // =============================================
  // Column widths (approximate, in characters)
  // =============================================
  sheet.setColumnWidth(1, 32);   // A: Labels
  sheet.setColumnWidth(2, 14);   // B: Values
  sheet.setColumnWidth(3, 14);   // C: Spacer
  sheet.setColumnWidth(4, 18);   // D: KPI label area
  sheet.setColumnWidth(5, 14);   // E: Title
  sheet.setColumnWidth(6, 14);   // F: Count
  sheet.setColumnWidth(7, 18);   // G: KPI label area
  sheet.setColumnWidth(8, 14);   // H: Spacer
  sheet.setColumnWidth(9, 14);   // I: Date/label
  sheet.setColumnWidth(10, 16);  // J: Last refreshed

  // =============================================
  // Freeze rows (header area)
  // =============================================
  sheet.setFrozenRows(0);

  // =============================================
  // Insert button/drawing for reload
  // =============================================
  insertReloadButton_(sheet);

  // =============================================
  // Run refresh to populate data
  // =============================================
  refreshDashboard(sheetId);

  console.log('setupDashboardLayout: Dashboard tab created and populated.');
  if (!sheetId) {
    try { SpreadsheetApp.getUi().alert(
      '✅ Dashboard layout is ready!\n\n'
      + '• Date filters are in cells G1 (Start) and I1 (End)\n'
      + '• Click [⟳ Reload] or menu 📊 Dashboard > Reload Dashboard\n'
      + '• Data has been loaded for today\'s date range.'
    ); } catch(e) {}
  }
}

// ──────────────────────────────────────────────
// HELPER: Setup a KPI Card (3-column merged block)
// ──────────────────────────────────────────────

/**
 * Setup a KPI card block spanning 3 columns by 3 rows.
 * Merges cells, sets background, writes the label in the first row.
 * Data cells (big number and trend %) are left empty for refreshDashboard().
 *
 * @param {Sheet} sheet - The Dashboard sheet
 * @param {number} row - Start row (top of card, 1-indexed)
 * @param {number} col - Start column (left edge, 1-indexed)
 * @param {string} label - KPI label text
 * @param {string} accentColor - Hex color for the label row
 */
function setupKpiCard_(sheet, row, col, label, accentColor) {
  var rangeLabel = sheet.getRange(row, col, 1, 3);
  rangeLabel.merge();
  rangeLabel.setValue(label);
  rangeLabel.setBackground(accentColor);
  rangeLabel.setFontColor(COLORS.white);
  rangeLabel.setFontSize(11);
  rangeLabel.setFontWeight('bold');
  rangeLabel.setHorizontalAlignment('center');
  rangeLabel.setVerticalAlignment('middle');

  // Big number row (row + 1)
  var rangeValue = sheet.getRange(row + 1, col, 1, 3);
  rangeValue.merge();
  rangeValue.setBackground(COLORS.cardBg);
  rangeValue.setFontSize(28);
  rangeValue.setFontWeight('bold');
  rangeValue.setFontColor(COLORS.headings);
  rangeValue.setHorizontalAlignment('center');
  rangeValue.setVerticalAlignment('middle');

  // Trend row (row + 2)
  var rangeTrend = sheet.getRange(row + 2, col, 1, 3);
  rangeTrend.merge();
  rangeTrend.setBackground(COLORS.cardBg);
  rangeTrend.setFontSize(11);
  rangeTrend.setFontColor(COLORS.bodyText);
  rangeTrend.setHorizontalAlignment('center');
  rangeTrend.setVerticalAlignment('middle');

  // Thin border around the card
  var cardRange = sheet.getRange(row, col, 3, 3);
  cardRange.setBorder(true, true, true, true, true, true, COLORS.border, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

// ──────────────────────────────────────────────
// HELPER: Insert Reload Button
// ──────────────────────────────────────────────

/**
 * Inserts a note instructing the user to create the reload button.
 *
 * Google Apps Script cannot programmatically create clickable drawings
 * in Sheets. The user must create the button manually once:
 *
 *   1. Insert > Drawing
 *   2. Draw a rounded rectangle, type "⟳ Reload"
 *   3. Save & Close
 *   4. Click the drawing → three dots → Assign script → "refreshDashboard"
 *
 * @param {Sheet} sheet - The Dashboard sheet
 */
function insertReloadButton_(sheet) {
  // Write instructions in cell J3 (out of the way)
  sheet.getRange('J3').setValue(
    '⚠ Insert button: Insert > Drawing (rounded rect, text "⟳ Reload"), assign script "refreshDashboard".'
  );
  sheet.getRange('J3').setFontColor(COLORS.danger);
  sheet.getRange('J3').setFontSize(8);
  sheet.getRange('J3').setFontStyle('italic');

  // Remove any existing button placeholder images if re-running setup
  var images = sheet.getImages();
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    // Remove old "reload" placeholder images by checking anchor cell
    var anchor = img.getAnchorCell();
    if (anchor && anchor.getA1Notation() === 'J1') {
      img.remove();
    }
  }

  console.log('insertReloadButton_: Button note added to J3. User must create button manually (see deploy guide).');
}

// ──────────────────────────────────────────────
// MAIN: refreshDashboard() — Read → Compute → Write
// ──────────────────────────────────────────────

/**
 * Main dashboard refresh function.
 * Reads all data from VisitorLog, cardno, and Destination sheets into
 * memory, computes KPIs filtered by the date range in G1 / I1, and
 * writes static (snapshot) values to the Dashboard tab.
 *
 * Supports dual-mode operation:
 *   - Bound mode (no sheetId): Uses getActiveSpreadsheet(), shows UI alerts.
 *   - Web App mode (with sheetId): Opens by ID, returns boolean, no UI.
 *
 * @param {string} [sheetId] - Optional sheet ID for Web App mode.
 * @returns {boolean} True on success, false on failure.
 */
function refreshDashboard(sheetId) {
  try {
    var ss;
    if (sheetId) {
      ss = SpreadsheetApp.openById(sheetId);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    var sheet = ss.getSheetByName('Dashboard');
    if (!sheet) {
      if (!sheetId) {
        try { SpreadsheetApp.getUi().alert(
          'Dashboard tab not found. Run 📊 Dashboard > Setup Dashboard Layout first.'
        ); } catch(e) {}
      }
      return false;
    }

    // ── Toast: loading (bound mode only) ──
    if (!sheetId) {
      try { SpreadsheetApp.toast('⟳ Loading dashboard data...', 'LITEVM', 5); } catch(e) {}
    }

    // ── Step 1: Get date range ──
    var dateRange = getDateRange_(sheet);

    // ── Step 2: Read all source data ──
    var visitorLogData = readSheetData_(ss, 'VisitorLog');
    var cardnoData = readSheetData_(ss, 'cardno');
    var destData = readSheetData_(ss, 'Destination');  // Reserved for future chart enrichment

    // ── Step 3: Compute KPIs ──
    var kpis = computeKpis_(visitorLogData, cardnoData, dateRange);

    // ── Step 4: Compute trends ──
    var trends = computeTrends_(visitorLogData, cardnoData, dateRange);

    // ── Step 5: Build chart summary tables ──
    var chartTables = buildChartTables_(visitorLogData, cardnoData, dateRange);

    // ── Step 6: Write values to cells ──
    writeKpiValues_(sheet, kpis, 5, 1);     // Total Visitors
    writeKpiValues_(sheet, kpis, 5, 4);     // Checked In
    writeKpiValues_(sheet, kpis, 5, 7);     // Pending
    writeKpiValues_(sheet, kpis, 9, 1);     // Rejected
    writeKpiValues_(sheet, kpis, 9, 4);     // Cards Assigned
    writeKpiValues_(sheet, kpis, 9, 7);     // Today's Visitors

    // ── Step 7: Write trend values ──
    writeTrendValues_(sheet, trends, 6, 1);  // Total Visitors trend
    writeTrendValues_(sheet, trends, 6, 4);  // Checked In trend
    writeTrendValues_(sheet, trends, 6, 7);  // Pending trend
    writeTrendValues_(sheet, trends, 10, 1);  // Rejected trend
    writeTrendValues_(sheet, trends, 10, 4);  // Cards Assigned trend
    writeTrendValues_(sheet, trends, 10, 7);  // Today's Visitors trend

    // ── Step 8: Write chart table data ──
    writeStatusDistribution_(sheet, chartTables, 13);      // A13:B...
    writeDailyTrend_(sheet, chartTables, 13);               // E13:F...
    writeTopDestinations_(sheet, chartTables, 19);          // A19:B...
    writeCardPoolSummary_(sheet, chartTables, 19);          // E19:F...

    // ── Step 8b: Write Recent Check-Ins mini-list ──
    writeRecentCheckins_(sheet, chartTables, 26);           // A26:D31

    // ── Step 9: Write last refreshed timestamp ──
    var now = new Date();
    var formattedNow = formatDateForDisplay(now);
    sheet.getRange('J2').setValue('Last: ' + formattedNow);
    sheet.getRange('J2').setFontStyle('italic');
    sheet.getRange('J2').setFontColor(COLORS.bodyText);
    sheet.getRange('J2').setFontSize(9);

    // ── Step 10: Write empty-state message if all zero ──
    var allZero = (kpis.totalVisitors === 0
                  && kpis.checkedIn === 0
                  && kpis.pending === 0
                  && kpis.rejected === 0
                  && kpis.cardsAssignedToday === 0
                  && kpis.cardsAvailable === 0);
    if (allZero) {
      // Write a note below the KPIs (row 11, merged across)
      sheet.getRange('A11:J11').merge();
      sheet.getRange('A11').setValue('📋 No visitor data for this date range. Adjust the date filters or start checking in visitors.');
      sheet.getRange('A11').setFontColor(COLORS.bodyText);
      sheet.getRange('A11').setFontSize(11);
      sheet.getRange('A11').setFontStyle('italic');
      sheet.getRange('A11').setHorizontalAlignment('center');
      sheet.getRange('A11').setVerticalAlignment('middle');
    }

    // ── Toast: completion (bound mode only) ──
    if (!sheetId) {
      var h = now.getHours();
      var m = now.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 || 12;
      var minStr = ('0' + m).slice(-2);
      try { SpreadsheetApp.toast('✓ Dashboard updated • ' + h12 + ':' + minStr + ' ' + ampm, 'LITEVM', 3); } catch(e) {}
    }

    console.log('refreshDashboard: Dashboard refreshed successfully at ' + formattedNow);
    return true;

  } catch (error) {
    console.error('refreshDashboard error: ' + error.message + '\n' + error.stack);
    if (!sheetId) {
      try { SpreadsheetApp.getUi().alert(
        '❌ Dashboard refresh failed.\n\n'
        + error.message + '\n\n'
        + 'Check the Apps Script logs for details.'
      ); } catch(e) {}
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// HELPER: Get Date Range from Dashboard cells
// ──────────────────────────────────────────────

/**
 * Read start and end dates from cells G1 (start) and I1 (end) on the
 * Dashboard tab. If empty or invalid, default to today.
 *
 * @param {Sheet} sheet - The Dashboard sheet
 * @returns {{ start: Date, end: Date }}
 */
function getDateRange_(sheet) {
  var now = new Date();
  var startCell = sheet.getRange('G1').getValue();
  var endCell = sheet.getRange('I1').getValue();

  var startDate, endDate;

  if (startCell instanceof Date && !isNaN(startCell.getTime())) {
    startDate = new Date(startCell);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
  }

  if (endCell instanceof Date && !isNaN(endCell.getTime())) {
    endDate = new Date(endCell);
    endDate.setHours(23, 59, 59, 999);
  } else {
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  }

  return { start: startDate, end: endDate };
}

// ──────────────────────────────────────────────
// HELPER: Read All Rows from a Sheet Tab
// ──────────────────────────────────────────────

/**
 * Read all data from a named sheet tab into a 2D array.
 * Returns an empty array if the sheet tab doesn't exist.
 *
 * @param {Spreadsheet} ss - The active spreadsheet
 * @param {string} sheetName - Tab name (e.g. 'VisitorLog')
 * @returns {Array<Array>} All data rows (including header row 0)
 */
function readSheetData_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    console.warn('readSheetData_: Sheet tab "' + sheetName + '" not found. Returning empty data.');
    return [];
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    return [];
  }

  return sheet.getDataRange().getValues();
}

// ──────────────────────────────────────────────
// COMPUTE: All KPIs from Raw Data
// ──────────────────────────────────────────────

/**
 * Compute all KPIs from the raw sheet data in-memory.
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {Array} cardno - All rows from cardno
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Object} KPI values
 */
function computeKpis_(visitorLog, cardno, dateRange) {
  var totalVisitors = 0;
  var checkedIn = 0;
  var pending = 0;
  var rejected = 0;

  // VisitorLog columns (0-indexed from getValues):
  // 0=Timestamp, 1=FullName, 2=ID, 3=Company, 4=Destination,
  // 5=Phone, 6=Email, 7=IDPhoto, 8=Selfie, 9=VisitorNo, 10=Status, 11=ActionTime
  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];

    // Check if timestamp is a valid Date within range
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < dateRange.start || ts > dateRange.end) continue;

    totalVisitors++;

    var status = String(row[10] || '').trim();
    if (status === 'Checked In') {
      checkedIn++;
    } else if (status === 'Pending Entry') {
      pending++;
    } else if (status === 'Rejected') {
      rejected++;
    }
  }

  // cardno columns: 0=CardNo, 1=Status, 2=AssignedTo, 3=AssignedAt
  var cardsAssignedToday = 0;
  var cardsAvailable = 0;

  for (var j = 1; j < cardno.length; j++) {
    var cRow = cardno[j];
    var cStatus = String(cRow[1] || '').trim().toLowerCase();
    var cAssignedAt = cRow[3];

    if (cStatus === 'available' || cStatus === '') {
      cardsAvailable++;
    } else if (cStatus === 'assigned') {
      // Check if assigned within date range
      if (cAssignedAt instanceof Date && !isNaN(cAssignedAt.getTime())) {
        if (cAssignedAt >= dateRange.start && cAssignedAt <= dateRange.end) {
          cardsAssignedToday++;
        }
      } else {
        // No timestamp — count as assigned today for safety
        cardsAssignedToday++;
      }
    }
  }

  // onSite is same as checkedIn (no checkout mechanism yet)
  var onSite = checkedIn;

  return {
    totalVisitors: totalVisitors,
    checkedIn: checkedIn,
    pending: pending,
    rejected: rejected,
    cardsAssignedToday: cardsAssignedToday,
    cardsAvailable: cardsAvailable,
    onSite: onSite,
  };
}

// ──────────────────────────────────────────────
// COMPUTE: Trends (vs Same Weekday Last Week)
// ──────────────────────────────────────────────

/**
 * Compute trend percentages comparing the current date range to the
 * same weekday one week prior. For each KPI, returns a formatted
 * string like "▲ +12%", "▼ -5%", "◄ 0%", or "—" (when previous is 0).
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {Array} cardno - All rows from cardno
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Object} Trend strings keyed by KPI name
 */
function computeTrends_(visitorLog, cardno, dateRange) {
  // Calculate the previous period (same weekday, 7 days earlier)
  var daysDiff = 7; // Always compare to same weekday last week
  var prevStart = new Date(dateRange.start.getTime() - daysDiff * 24 * 60 * 60 * 1000);
  var prevEnd = new Date(dateRange.end.getTime() - daysDiff * 24 * 60 * 60 * 1000);

  var prevRange = { start: prevStart, end: prevEnd };

  // Compute current period KPIs
  var current = computeKpis_(visitorLog, cardno, dateRange);
  // Compute previous period KPIs
  var previous = computeKpis_(visitorLog, cardno, prevRange);

  return {
    totalVisitors:    formatTrend_(current.totalVisitors,    previous.totalVisitors),
    checkedIn:        formatTrend_(current.checkedIn,        previous.checkedIn),
    pending:          formatTrend_(current.pending,          previous.pending),
    rejected:         formatTrend_(current.rejected,         previous.rejected),
    cardsAssigned:    formatTrend_(current.cardsAssignedToday, previous.cardsAssignedToday),
    cardsAvailable:   formatTrend_(current.cardsAvailable,   previous.cardsAvailable),
  };
}

// ──────────────────────────────────────────────
// HELPER: Format a Single Trend Value
// ──────────────────────────────────────────────

/**
 * Format a trend comparison between current and previous period.
 *
 * @param {number} current - Current period count
 * @param {number} previous - Previous period count
 * @returns {string} Formatted trend string
 */
function formatTrend_(current, previous) {
  if (previous === 0) {
    return '—';   // No baseline — show em dash
  }

  var diff = current - previous;
  var pct = Math.round((diff / previous) * 100);

  if (pct === 0) {
    return '◄ 0%';
  } else if (pct > 0) {
    return '▲ +' + pct + '%';
  } else {
    return '▼ ' + pct + '%';  // pct is already negative
  }
}

// ──────────────────────────────────────────────
// BUILD: Chart Summary Tables
// ──────────────────────────────────────────────

/**
 * Build chart-ready summary tables from raw visitor data.
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {Array} cardno - All rows from cardno
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Object} Chart table objects
 */
function buildChartTables_(visitorLog, cardno, dateRange) {
  // ── Status Distribution ──
  var statusCounts = {
    'Checked In': 0,
    'Pending Entry': 0,
    'Rejected': 0,
  };

  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < dateRange.start || ts > dateRange.end) continue;

    var status = String(row[10] || '').trim();
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++;
    }
  }

  var statusSummary = [
    ['Status', 'Count'],
    ['Checked In', statusCounts['Checked In']],
    ['Pending', statusCounts['Pending Entry']],
    ['Rejected', statusCounts['Rejected']],
  ];

  // ── Daily Trend (last 7 days) ──
  var dailyMap = {};
  for (var d = 6; d >= 0; d--) {
    var dateKey = getDateKey_(new Date(dateRange.end.getTime() - d * 24 * 60 * 60 * 1000));
    dailyMap[dateKey] = 0;
  }

  for (var k = 1; k < visitorLog.length; k++) {
    var vRow = visitorLog[k];
    var vTs = vRow[0];
    if (!(vTs instanceof Date) || isNaN(vTs.getTime())) continue;
    // Only count rows within the last 7 days from end date
    var sevenDaysBefore = new Date(dateRange.end.getTime() - 6 * 24 * 60 * 60 * 1000);
    sevenDaysBefore.setHours(0, 0, 0, 0);
    if (vTs < sevenDaysBefore || vTs > dateRange.end) continue;

    var vDateKey = getDateKey_(vTs);
    if (dailyMap.hasOwnProperty(vDateKey)) {
      dailyMap[vDateKey]++;
    }
  }

  var dailyTrend = [['Date', 'Registrations']];
  var sortedDates = Object.keys(dailyMap).sort();
  for (var m = 0; m < sortedDates.length; m++) {
    dailyTrend.push([sortedDates[m], dailyMap[sortedDates[m]]]);
  }

  // ── Top Destinations (top 5) ──
  var destCounts = {};
  for (var n = 1; n < visitorLog.length; n++) {
    var dRow = visitorLog[n];
    var dTs = dRow[0];
    if (!(dTs instanceof Date) || isNaN(dTs.getTime())) continue;
    if (dTs < dateRange.start || dTs > dateRange.end) continue;

    var dest = String(dRow[4] || 'Unknown').trim();
    if (dest === '') dest = 'Unknown';
    if (destCounts.hasOwnProperty(dest)) {
      destCounts[dest]++;
    } else {
      destCounts[dest] = 1;
    }
  }

  // Sort by count descending, take top 5
  var destEntries = [];
  for (var destName in destCounts) {
    if (destCounts.hasOwnProperty(destName)) {
      destEntries.push({ name: destName, count: destCounts[destName] });
    }
  }
  destEntries.sort(function(a, b) {
    return b.count - a.count;
  });

  var topDestinations = [['Destination', 'Count']];
  var limit = Math.min(destEntries.length, 5);
  for (var p = 0; p < limit; p++) {
    topDestinations.push([destEntries[p].name, destEntries[p].count]);
  }
  // Pad with empty rows if fewer than 5
  for (var q = topDestinations.length; q <= 5; q++) {
    topDestinations.push(['', '']);
  }

  // ── Card Pool Summary ──
  var totalCards = cardno.length > 1 ? cardno.length - 1 : 0;
  var availCards = 0;
  var assignedCards = 0;

  for (var r = 1; r < cardno.length; r++) {
    var cStat = String(cardno[r][1] || '').trim().toLowerCase();
    if (cStat === 'available' || cStat === '') {
      availCards++;
    } else if (cStat === 'assigned') {
      assignedCards++;
    }
  }

  var cardPoolSummary = [
    ['Status', 'Count'],
    ['Available', availCards],
    ['Assigned', assignedCards],
  ];

  // ── Recent Check-Ins (last 5 Checked In, sorted by Action Time desc) ──
  var recentCheckins = buildRecentCheckins_(visitorLog, dateRange);

  return {
    statusSummary: statusSummary,
    dailyTrend: dailyTrend,
    topDestinations: topDestinations,
    cardPoolSummary: cardPoolSummary,
    recentCheckins: recentCheckins,
  };
}

/**
 * Compute recent check-ins: last 5 visitors with Status 'Checked In'
 * within the date range, sorted by Action Time descending.
 */
function buildRecentCheckins_(visitorLog, dateRange) {
  var checkins = [];

  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < dateRange.start || ts > dateRange.end) continue;

    var status = String(row[10] || '').trim();
    if (status === 'Checked In') {
      checkins.push({
        visitorNo: String(row[9] || ''),
        name: String(row[1] || ''),
        company: String(row[3] || ''),
        actionTime: row[11] instanceof Date ? row[11] : ts,
      });
    }
  }

  // Sort by Action Time descending
  checkins.sort(function(a, b) {
    return b.actionTime - a.actionTime;
  });

  // Take top 5
  var top = checkins.slice(0, 5);

  // Build table: [Visitor #, Name, Company, Time]
  var table = [['Visitor #', 'Name', 'Company', 'Time']];
  for (var j = 0; j < top.length; j++) {
    var entry = top[j];
    var timeStr = formatDateForDisplay(entry.actionTime);
    table.push([entry.visitorNo, entry.name, entry.company, timeStr]);
  }

  return table;
}

// ──────────────────────────────────────────────
// HELPER: Get Date Key (YYYY-MM-DD)
// ──────────────────────────────────────────────

/**
 * Format a Date object into a YYYY-MM-DD string key.
 *
 * @param {Date} date
 * @returns {string} e.g. "2026-06-25"
 */
function getDateKey_(date) {
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

// ──────────────────────────────────────────────
// WRITE: KPI Value to a Card
// ──────────────────────────────────────────────

/**
 * Write the big number and supporting label into a KPI card.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} kpis - KPI object from computeKpis_
 * @param {number} row - Card start row (the big number row = row + 1)
 * @param {number} col - Card start column
 */
function writeKpiValues_(sheet, kpis, row, col) {
  var valueRow = row;     // big number row
  var label = '';
  var value = 0;
  var color = COLORS.headings;  // default color

  // Determine which KPI to write based on (row, col) position
  // Row 5: Total Visitors(col1), Checked In(col4), Pending(col7)
  // Row 9: Rejected(col1), Cards Assigned(col4), Today's Visitors(col7)
  if (row === 5 && col === 1) {
    value = kpis.totalVisitors;
    label = 'total visitors today';
    color = COLORS.headings;
  } else if (row === 5 && col === 4) {
    value = kpis.checkedIn;
    label = 'on-site now';
    color = COLORS.success;
  } else if (row === 5 && col === 7) {
    value = kpis.pending;
    label = 'awaiting check-in';
    color = COLORS.warning;
  } else if (row === 9 && col === 1) {
    value = kpis.rejected;
    label = 'rejected entries';
    color = COLORS.danger;
  } else if (row === 9 && col === 4) {
    value = kpis.cardsAssignedToday;
    label = 'cards issued today';
    color = COLORS.primary;
  } else if (row === 9 && col === 7) {
    value = kpis.totalVisitors;
    label = 'visitors today';
    color = COLORS.headings;
  }

  var rangeVal = sheet.getRange(valueRow, col, 1, 3);
  rangeVal.merge();
  rangeVal.setValue(value);
  rangeVal.setFontSize(28);
  rangeVal.setFontWeight('bold');
  rangeVal.setFontColor(color);
  rangeVal.setHorizontalAlignment('center');
  rangeVal.setVerticalAlignment('middle');
  rangeVal.setBackground(COLORS.cardBg);

  // Store the label as a note on the value cell
  sheet.getRange(valueRow, col).setNote(label);
}

// ──────────────────────────────────────────────
// HELPER: Context-Aware Trend Color
// ──────────────────────────────────────────────

/**
 * Determine trend arrow color based on KPI context.
 * Positive KPIs (total, checked-in, cards-assigned): up=green, down=red.
 * Negative KPIs (pending, rejected): UP=red, down=green.
 * Flat/N/A always gets the body text color.
 *
 * @param {string} trendStr - Trend string (contains ▲, ▼, ◄, or —)
 * @param {string} kpiType - KPI identifier ('totalVisitors', 'checkedIn', 'pending', 'rejected', 'cardsAssigned')
 * @returns {string} Hex color string
 */
function trendColorClass_(trendStr, kpiType) {
  var negativeKpis = { pending: true, rejected: true };

  if (trendStr.indexOf('▲') >= 0) {
    // Up arrow: good for positive KPIs, bad for negative KPIs
    return negativeKpis.hasOwnProperty(kpiType) ? COLORS.danger : COLORS.success;
  } else if (trendStr.indexOf('▼') >= 0) {
    // Down arrow: bad for positive KPIs, good for negative KPIs
    return negativeKpis.hasOwnProperty(kpiType) ? COLORS.success : COLORS.danger;
  } else if (trendStr.indexOf('◄') >= 0) {
    return COLORS.warning;  // Flat — amber
  } else {
    return COLORS.bodyText; // N/A — gray
  }
}

// ──────────────────────────────────────────────
// WRITE: Trend Value to a Card
// ──────────────────────────────────────────────

/**
 * Write the trend string into a KPI card's trend row.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} trends - Trend strings from computeTrends_
 * @param {number} row - Trend row (row = big number row + 1)
 * @param {number} col - Card start column
 */
function writeTrendValues_(sheet, trends, row, col) {
  var trendStr = '';
  var kpiType = '';

  // Map position to trend key — same mapping as writeKpiValues_
  if (row === 6 && col === 1) {
    trendStr = 'vs last week: ' + trends.totalVisitors;
    kpiType = 'totalVisitors';
  } else if (row === 6 && col === 4) {
    trendStr = 'vs last week: ' + trends.checkedIn;
    kpiType = 'checkedIn';
  } else if (row === 6 && col === 7) {
    trendStr = 'vs last week: ' + trends.pending;
    kpiType = 'pending';
  } else if (row === 10 && col === 1) {
    trendStr = 'vs last week: ' + trends.rejected;
    kpiType = 'rejected';
  } else if (row === 10 && col === 4) {
    trendStr = 'vs last week: ' + trends.cardsAssigned;
    kpiType = 'cardsAssigned';
  } else if (row === 10 && col === 7) {
    trendStr = 'vs last week: ' + trends.totalVisitors;
    kpiType = 'totalVisitors';
  }

  var rangeTrend = sheet.getRange(row, col, 1, 3);
  rangeTrend.merge();
  rangeTrend.setValue(trendStr);
  rangeTrend.setFontSize(11);
  rangeTrend.setFontColor(trendColorClass_(trendStr, kpiType));
  rangeTrend.setHorizontalAlignment('center');
  rangeTrend.setVerticalAlignment('middle');
  rangeTrend.setBackground(COLORS.cardBg);
}

// ──────────────────────────────────────────────
// WRITE: Status Distribution Table
// ──────────────────────────────────────────────

/**
 * Write the status distribution summary table into the Dashboard.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} chartTables - Chart tables from buildChartTables_
 * @param {number} startRow - Row to start writing data (header + rows)
 */
function writeStatusDistribution_(sheet, chartTables, startRow) {
  var data = chartTables.statusSummary;
  // data[0] is header, data[1..n] are rows
  // Write header
  sheet.getRange(startRow, 1).setValue(data[0][0]);
  sheet.getRange(startRow, 2).setValue(data[0][1]);
  sheet.getRange(startRow, 1).setFontWeight('bold');
  sheet.getRange(startRow, 2).setFontWeight('bold');
  sheet.getRange(startRow, 1).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 2).setFontColor(COLORS.headings);

  // Write data rows
  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 1).setValue(data[i][0]);
    sheet.getRange(rowNum, 2).setValue(data[i][1]);
    sheet.getRange(rowNum, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 2).setFontColor(COLORS.bodyText);
  }

  // Clear any leftover rows from a previous refresh
  clearRowsFrom_(sheet, startRow + data.length, 1, 2, startRow + 6);
}

// ──────────────────────────────────────────────
// WRITE: Daily Trend Table
// ──────────────────────────────────────────────

/**
 * Write the 7-day daily trend summary into the Dashboard.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} chartTables - Chart tables from buildChartTables_
 * @param {number} startRow - Row to start writing data
 */
function writeDailyTrend_(sheet, chartTables, startRow) {
  var data = chartTables.dailyTrend;

  // Write header in E12, F12
  sheet.getRange(startRow, 5).setValue(data[0][0]);  // "Date"
  sheet.getRange(startRow, 6).setValue(data[0][1]);  // "Registrations"
  sheet.getRange(startRow, 5).setFontWeight('bold');
  sheet.getRange(startRow, 6).setFontWeight('bold');
  sheet.getRange(startRow, 5).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 6).setFontColor(COLORS.headings);

  // Write data rows (up to 7 days)
  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 5).setValue(data[i][0]);
    sheet.getRange(rowNum, 6).setValue(data[i][1]);
    sheet.getRange(rowNum, 5).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 6).setFontColor(COLORS.bodyText);
  }

  // Clear any leftover rows
  clearRowsFrom_(sheet, startRow + data.length, 5, 6, startRow + 8);
}

// ──────────────────────────────────────────────
// WRITE: Top Destinations Table
// ──────────────────────────────────────────────

/**
 * Write the top destinations summary into the Dashboard.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} chartTables - Chart tables from buildChartTables_
 * @param {number} startRow - Row to start writing data
 */
function writeTopDestinations_(sheet, chartTables, startRow) {
  var data = chartTables.topDestinations;

  // Header row
  sheet.getRange(startRow, 1).setValue(data[0][0]);
  sheet.getRange(startRow, 2).setValue(data[0][1]);
  sheet.getRange(startRow, 1).setFontWeight('bold');
  sheet.getRange(startRow, 2).setFontWeight('bold');
  sheet.getRange(startRow, 1).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 2).setFontColor(COLORS.headings);

  // Data rows (at most 5 entries)
  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 1).setValue(data[i][0]);
    sheet.getRange(rowNum, 2).setValue(data[i][1]);
    sheet.getRange(rowNum, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 2).setFontColor(COLORS.bodyText);
  }
}

// ──────────────────────────────────────────────
// WRITE: Card Pool Summary Table
// ──────────────────────────────────────────────

/**
 * Write the card pool summary into the Dashboard.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} chartTables - Chart tables from buildChartTables_
 * @param {number} startRow - Row to start writing data
 */
function writeCardPoolSummary_(sheet, chartTables, startRow) {
  var data = chartTables.cardPoolSummary;

  // Header row
  sheet.getRange(startRow, 5).setValue(data[0][0]);
  sheet.getRange(startRow, 6).setValue(data[0][1]);
  sheet.getRange(startRow, 5).setFontWeight('bold');
  sheet.getRange(startRow, 6).setFontWeight('bold');
  sheet.getRange(startRow, 5).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 6).setFontColor(COLORS.headings);

  // Data rows
  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 5).setValue(data[i][0]);
    sheet.getRange(rowNum, 6).setValue(data[i][1]);
    sheet.getRange(rowNum, 5).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 6).setFontColor(COLORS.bodyText);
  }
}

// ──────────────────────────────────────────────
// WRITE: Recent Check-Ins Mini-List
// ──────────────────────────────────────────────

/**
 * Write the recent check-ins mini-table into the Dashboard.
 * Shows last 5 visitors who were Checked In.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {Object} chartTables - Chart tables from buildChartTables_
 * @param {number} startRow - Row to start writing data
 */
function writeRecentCheckins_(sheet, chartTables, startRow) {
  var data = chartTables.recentCheckins;
  if (!data || data.length < 1) {
    // Write empty placeholder
    sheet.getRange(startRow, 1).setValue('No recent check-ins');
    sheet.getRange(startRow, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(startRow, 1).setFontSize(10);
    sheet.getRange(startRow, 1).setFontStyle('italic');
    return;
  }

  // Write header row: A-D
  var headers = ['Visitor #', 'Name', 'Company', 'Time'];
  for (var c = 0; c < headers.length; c++) {
    var headerCell = sheet.getRange(startRow, c + 1);
    headerCell.setValue(headers[c]);
    headerCell.setFontWeight('bold');
    headerCell.setFontColor(COLORS.headings);
    headerCell.setFontSize(10);
    headerCell.setBackground(COLORS.lightGray);
  }

  // Write data rows
  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    for (var j = 0; j < data[i].length; j++) {
      var cell = sheet.getRange(rowNum, j + 1);
      cell.setValue(data[i][j]);
      cell.setFontColor(COLORS.bodyText);
      cell.setFontSize(10);
    }
  }

  // Clear leftover rows (we expect at most 5)
  for (var r = startRow + data.length; r <= startRow + 5; r++) {
    sheet.getRange(r, 1, 1, 4).clearContent();
  }
}

// ──────────────────────────────────────────────
// HELPER: Format Date for Display
// ──────────────────────────────────────────────

/**
 * Format a Date object into a human-readable string like
 * "2:32 PM 26 Jun 2026".
 * Included here to keep Dashboard.gs self-contained.
 *
 * @param {Date} date
 * @returns {string} Formatted date string
 */
function formatDateForDisplay(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var h12 = hours % 12 || 12;
  var minStr = ('0' + minutes).slice(-2);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return h12 + ':' + minStr + ' ' + ampm + ' ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}

// ──────────────────────────────────────────────
// HELPER: Clear Extra Rows (clean up after refresh)
// ──────────────────────────────────────────────

/**
 * Clear content from cells in a column range from a start row up to a
 * max row, to remove any leftover values from a previous refresh.
 *
 * @param {Sheet} sheet - Dashboard sheet
 * @param {number} fromRow - First row to clear
 * @param {number} col1 - First column to clear
 * @param {number} col2 - Last column to clear
 * @param {number} maxRow - Maximum row to clear (inclusive)
 */
function clearRowsFrom_(sheet, fromRow, col1, col2, maxRow) {
  if (fromRow > maxRow) return;
  for (var r = fromRow; r <= maxRow; r++) {
    for (var c = col1; c <= col2; c++) {
      sheet.getRange(r, c).clearContent();
    }
  }
}
