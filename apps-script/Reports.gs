/**
 * LITEVM — Reports Tab (Additional file in Apps Script project)
 *
 * Dedicated Reports tab with two modes:
 *   1. Daily Summary — KPIs, top destinations, peak hour, trend vs last week
 *   2. Visitor Log Export — Full filtered list, no row cap
 *
 * DUAL-MODE ARCHITECTURE (matching Dashboard.gs convention):
 *   (a) Bound-script mode — called from menu in a specific sheet using
 *       getActiveSpreadsheet(), shows toast and alert UI.
 *   (b) Web App mode — called via doPost with sheetId parameter using
 *       SpreadsheetApp.openById(sheetId), returns boolean, no UI.
 *
 * Date range cells are B2 (Start) and D2 (End) — dedicated to Reports,
 * NOT shared with the Dashboard tab (which uses G1/I1).
 *
 * No charts, no ReportHistory, no triggers.
 */

// ──────────────────────────────────────────────
// NOTE: onOpen lives in Dashboard.gs only.
// Report menu items are added there so that both
// Dashboard and Report menu items appear in one
// unified 📊 Dashboard menu.
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// SETUP: Report Tab Layout (run once from editor)
// ──────────────────────────────────────────────

/**
 * Creates the Report tab with a clean layout, date range cells,
 * and column widths. Run ONCE from the Apps Script editor after adding
 * this file, or invoke via Web App with sheetId.
 *
 * @param {string} [sheetId] - Optional. When provided, opens the sheet by ID
 *   (Web App mode). When omitted, uses getActiveSpreadsheet() (bound mode).
 */
function setupReportLayout(sheetId) {
  var ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  var sheet = ss.getSheetByName('Report');

  // Create the Report tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Report');
    sheet.setTabColor(COLORS.primary);
  } else {
    // Clear existing content and formatting
    sheet.clear();
  }

  // =============================================
  // ROW 1 — Title Bar (merged A1:H1)
  // =============================================
  sheet.getRange('A1').setValue('📋 LITEVM · Report');
  sheet.getRange('A1').setFontSize(18);
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('A1').setFontColor(COLORS.headings);
  sheet.getRange('A1:H1').merge();

  // =============================================
  // ROW 2 — Date Range Cells
  // =============================================
  // A2: label, B2: start date, C2: label, D2: end date
  sheet.getRange('A2').setValue('Start');
  sheet.getRange('A2').setFontSize(10);
  sheet.getRange('A2').setFontColor(COLORS.bodyText);
  sheet.getRange('A2').setFontWeight('bold');

  sheet.getRange('B2').setValue(new Date());
  sheet.getRange('B2').setNumberFormat('dd/mm/yyyy');
  sheet.getRange('B2').setFontWeight('bold');
  sheet.getRange('B2').setFontColor(COLORS.primary);
  sheet.getRange('B2').setBackground(COLORS.lightGray);
  sheet.getRange('B2').setHorizontalAlignment('center');

  sheet.getRange('C2').setValue('End');
  sheet.getRange('C2').setFontSize(10);
  sheet.getRange('C2').setFontColor(COLORS.bodyText);
  sheet.getRange('C2').setFontWeight('bold');

  sheet.getRange('D2').setValue(new Date());
  sheet.getRange('D2').setNumberFormat('dd/mm/yyyy');
  sheet.getRange('D2').setFontWeight('bold');
  sheet.getRange('D2').setFontColor(COLORS.primary);
  sheet.getRange('D2').setBackground(COLORS.lightGray);
  sheet.getRange('D2').setHorizontalAlignment('center');

  // E2: action hint / generate button area
  sheet.getRange('E2').setValue('Use menu 📊 Dashboard > Daily Summary or Visitor Log');
  sheet.getRange('E2').setFontSize(9);
  sheet.getRange('E2').setFontColor(COLORS.bodyText);
  sheet.getRange('E2').setFontStyle('italic');
  sheet.getRange('E2:H2').merge();

  // =============================================
  // ROW 3 — Blank spacer
  // =============================================
  sheet.getRange('A3:H3').setBackground(COLORS.white);

  // =============================================
  // Column widths
  // =============================================
  sheet.setColumnWidth(1, 20);   // A: Labels
  sheet.setColumnWidth(2, 16);   // B: Dates / values
  sheet.setColumnWidth(3, 14);   // C: Labels
  sheet.setColumnWidth(4, 16);   // D: Dates / values
  sheet.setColumnWidth(5, 22);   // E: Descriptions / destinations
  sheet.setColumnWidth(6, 16);   // F: Counts
  sheet.setColumnWidth(7, 16);   // G: Percentages
  sheet.setColumnWidth(8, 20);   // H: Spacer / percentages

  // =============================================
  // Freeze rows
  // =============================================
  sheet.setFrozenRows(3);

  // =============================================
  // Write placeholder message in row 4
  // =============================================
  sheet.getRange('A4').setValue('Generate a report using the 📊 Dashboard menu above.');
  sheet.getRange('A4').setFontColor(COLORS.bodyText);
  sheet.getRange('A4').setFontSize(11);
  sheet.getRange('A4').setFontStyle('italic');
  sheet.getRange('A4:H4').merge();

  console.log('setupReportLayout: Report tab created and layout ready.');
  if (!sheetId) {
    try { SpreadsheetApp.getUi().alert(
      '✅ Report layout is ready!\n\n'
      + '• Date filters are in cells B2 (Start) and D2 (End)\n'
      + '• Use menu 📊 Dashboard > Daily Summary or Visitor Log\n'
      + '• Adjust the dates and generate reports as needed.'
    ); } catch(e) {}
  }
}

// ──────────────────────────────────────────────
// HELPER: Get Date Range from Report cells
// ──────────────────────────────────────────────

/**
 * Read start and end dates from cells B2 (start) and D2 (end) on the
 * Report tab. If empty or invalid, default to today.
 *
 * @param {Sheet} sheet - The Report sheet
 * @returns {{ start: Date, end: Date }}
 */
function getReportDateRange_(sheet) {
  var now = new Date();
  var startCell = sheet.getRange('B2').getValue();
  var endCell = sheet.getRange('D2').getValue();

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
// GENERATE: Daily Summary
// ──────────────────────────────────────────────

/**
 * Generate the Daily Summary report on the Report tab.
 * Reads date range from B2/D2, computes KPIs, top destinations,
 * peak hour analysis, and trend vs last week.
 *
 * Supports dual-mode operation:
 *   - Bound mode (no sheetId): Uses getActiveSpreadsheet(), shows UI.
 *   - Web App mode (with sheetId): Opens by ID, returns boolean.
 *
 * @param {string} [sheetId] - Optional sheet ID for Web App mode.
 * @returns {boolean} True on success, false on failure.
 */
function generateDailySummary(sheetId) {
  try {
    var ss;
    if (sheetId) {
      ss = SpreadsheetApp.openById(sheetId);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    var sheet = ss.getSheetByName('Report');
    if (!sheet) {
      if (!sheetId) {
        try { SpreadsheetApp.getUi().alert(
          'Report tab not found. Run 📊 Dashboard > Setup Report Layout first.'
        ); } catch(e) {}
      }
      return false;
    }

    // ── Toast: loading (bound mode only) ──
    if (!sheetId) {
      try { SpreadsheetApp.toast('⟳ Generating Daily Summary...', 'LITEVM', 5); } catch(e) {}
    }

    // ── Step 1: Get date range ──
    var dateRange = getReportDateRange_(sheet);

    // ── Step 2: Read all source data ──
    var visitorLog = readSheetData_(ss, 'VisitorLog');
    var cardno = readSheetData_(ss, 'cardno');

    // ── Step 3: Compute KPIs ──
    var kpis = computeKpis_(visitorLog, cardno, dateRange);

    // ── Step 4: Compute trends ──
    var trends = computeReportTrends_(visitorLog, cardno, dateRange);

    // ── Step 5: Compute top destinations ──
    var topDestinations = computeTopDestinations_(visitorLog, dateRange);

    // ── Step 6: Compute peak hour analysis ──
    var peakHours = computePeakHours_(visitorLog, dateRange);

    // ── Step 7: Clear existing content below row 3 ──
    var lastRow = sheet.getLastRow();
    if (lastRow > 3) {
      sheet.getRange(4, 1, lastRow - 3, 8).clearContent();
    }

    // ── Step 8: Write report content ──
    var row = 4;
    var now = new Date();
    var dateStr = formatDateForDisplay(now);

    // Title and header
    sheet.getRange('A' + row).setValue('📋 Daily Summary');
    sheet.getRange('A' + row).setFontSize(16);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    sheet.getRange('A' + row).setValue('Period: ' + formatDateShort(dateRange.start) + ' to ' + formatDateShort(dateRange.end));
    sheet.getRange('A' + row).setFontSize(10);
    sheet.getRange('A' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    sheet.getRange('A' + row).setValue('Generated: ' + dateStr);
    sheet.getRange('A' + row).setFontSize(9);
    sheet.getRange('A' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row).setFontStyle('italic');
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    // Blank spacer
    row++;

    // ── Summary KPIs ──
    sheet.getRange('A' + row).setValue('Summary');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    writeKpiPair_(sheet, row, 1, 'Total Visitors', kpis.totalVisitors, '');
    writeKpiPair_(sheet, row, 4, 'Checked In', kpis.checkedIn, trends.checkedIn);
    writeKpiPair_(sheet, row, 7, 'Pending', kpis.pending, trends.pending);
    writeKpiPair_(sheet, row + 1, 1, 'Rejected', kpis.rejected, trends.rejected);
    writeKpiPair_(sheet, row + 1, 4, 'Cards Assigned', kpis.cardsAssignedToday, '');
    writeKpiPair_(sheet, row + 1, 7, 'Cards Available', kpis.cardsAvailable, '');
    row = row + 2; // Advanced past the two summary rows

    // Blank spacer
    row++;

    // ── Top 5 Destinations ──
    sheet.getRange('A' + row).setValue('Top 5 Destinations');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    // Header row
    sheet.getRange('A' + row).setValue('Destination');
    sheet.getRange('B' + row).setValue('Count');
    sheet.getRange('C' + row).setValue('% of Total');
    sheet.getRange('A' + row + ':C' + row).setFontWeight('bold');
    sheet.getRange('A' + row + ':C' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':C' + row).setFontSize(10);
    sheet.getRange('A' + row + ':C' + row).setBackground(COLORS.lightGray);
    row++;

    var grandTotal = kpis.totalVisitors || 1;
    for (var d = 0; d < topDestinations.length; d++) {
      var entry = topDestinations[d];
      var pct = Math.round((entry.count / grandTotal) * 100);
      sheet.getRange('A' + row).setValue(entry.name);
      sheet.getRange('B' + row).setValue(entry.count);
      sheet.getRange('C' + row).setValue(pct + '%');
      sheet.getRange('A' + row + ':C' + row).setFontColor(COLORS.bodyText);
      sheet.getRange('A' + row + ':C' + row).setFontSize(10);
      row++;
    }

    // Blank spacer
    row++;

    // ── Peak Hour Analysis ──
    sheet.getRange('A' + row).setValue('Peak Hour Analysis');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    // Header row
    sheet.getRange('A' + row).setValue('Hour');
    sheet.getRange('B' + row).setValue('Visitors');
    sheet.getRange('A' + row + ':B' + row).setFontWeight('bold');
    sheet.getRange('A' + row + ':B' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':B' + row).setFontSize(10);
    sheet.getRange('A' + row + ':B' + row).setBackground(COLORS.lightGray);
    row++;

    var maxHourCount = 0;
    var peakHourLabel = '';
    for (var h = 0; h < peakHours.length; h++) {
      var hourEntry = peakHours[h];
      var hourLabel = ('0' + hourEntry.hour).slice(-2) + ':00-' + ('0' + hourEntry.hour).slice(-2) + ':59';
      sheet.getRange('A' + row).setValue(hourLabel);
      sheet.getRange('B' + row).setValue(hourEntry.count);
      sheet.getRange('A' + row + ':B' + row).setFontColor(COLORS.bodyText);
      sheet.getRange('A' + row + ':B' + row).setFontSize(10);
      if (hourEntry.count > maxHourCount) {
        maxHourCount = hourEntry.count;
        peakHourLabel = hourLabel;
      }
      row++;
    }

    // Blank spacer
    row++;

    // ── Trend vs Last Week ──
    sheet.getRange('A' + row).setValue('Trend vs Last Week');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

    sheet.getRange('A' + row).setValue('Total: ' + trends.totalVisitors);
    sheet.getRange('B' + row).setValue('Checked In: ' + trends.checkedIn);
    sheet.getRange('C' + row).setValue('Pending: ' + trends.pending);
    sheet.getRange('A' + row + ':C' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row + ':C' + row).setFontSize(10);
    row++;

    sheet.getRange('A' + row).setValue('Rejected: ' + trends.rejected);
    sheet.getRange('A' + row + ':C' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row + ':C' + row).setFontSize(10);
    row++;

    // Blank spacer
    row++;

    // ── End of Report marker ──
    sheet.getRange('A' + row).setValue('— End of Report —');
    sheet.getRange('A' + row).setFontSize(9);
    sheet.getRange('A' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row).setFontStyle('italic');
    sheet.getRange('A' + row + ':H' + row).merge();

    // ── Toast: completion (bound mode only) ──
    if (!sheetId) {
      var hh = now.getHours();
      var mm = now.getMinutes();
      var ampm = hh >= 12 ? 'PM' : 'AM';
      var h12 = hh % 12 || 12;
      var minStr = ('0' + mm).slice(-2);
      try { SpreadsheetApp.toast('✓ Daily Summary generated • ' + h12 + ':' + minStr + ' ' + ampm, 'LITEVM', 3); } catch(e) {}
    }

    console.log('generateDailySummary: Daily Summary generated successfully.');
    return true;

  } catch (error) {
    console.error('generateDailySummary error: ' + error.message + '\n' + error.stack);
    if (!sheetId) {
      try { SpreadsheetApp.getUi().alert(
        '❌ Daily Summary generation failed.\n\n'
        + error.message + '\n\n'
        + 'Check the Apps Script logs for details.'
      ); } catch(e) {}
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// GENERATE: Visitor Log Export
// ──────────────────────────────────────────────

/**
 * Generate the Visitor Log Export on the Report tab.
 * Shows ALL visitors within the date range with NO row cap.
 *
 * Supports dual-mode operation:
 *   - Bound mode (no sheetId): Uses getActiveSpreadsheet(), shows UI.
 *   - Web App mode (with sheetId): Opens by ID, returns boolean.
 *
 * @param {string} [sheetId] - Optional sheet ID for Web App mode.
 * @returns {boolean} True on success, false on failure.
 */
function generateVisitorLog(sheetId) {
  try {
    var ss;
    if (sheetId) {
      ss = SpreadsheetApp.openById(sheetId);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    var sheet = ss.getSheetByName('Report');
    if (!sheet) {
      if (!sheetId) {
        try { SpreadsheetApp.getUi().alert(
          'Report tab not found. Run 📊 Dashboard > Setup Report Layout first.'
        ); } catch(e) {}
      }
      return false;
    }

    // ── Toast: loading (bound mode only) ──
    if (!sheetId) {
      try { SpreadsheetApp.toast('⟳ Generating Visitor Log...', 'LITEVM', 5); } catch(e) {}
    }

    // ── Step 1: Get date range ──
    var dateRange = getReportDateRange_(sheet);

    // ── Step 2: Read all source data ──
    var visitorLog = readSheetData_(ss, 'VisitorLog');

    // ── Step 3: Filter visitors within date range (NO row cap) ──
    var filtered = [];
    for (var i = 1; i < visitorLog.length; i++) {
      var row = visitorLog[i];
      var ts = row[0];
      if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
      if (ts < dateRange.start || ts > dateRange.end) continue;
      filtered.push(row);
    }

    // ── Step 4: Clear existing content below row 3 ──
    var lastRow = sheet.getLastRow();
    if (lastRow > 3) {
      sheet.getRange(4, 1, lastRow - 3, 8).clearContent();
    }

    // ── Step 5: Write report content ──
    var r = 4;
    var now = new Date();

    // Title and header
    sheet.getRange('A' + r).setValue('📋 Visitor Log');
    sheet.getRange('A' + r).setFontSize(16);
    sheet.getRange('A' + r).setFontWeight('bold');
    sheet.getRange('A' + r).setFontColor(COLORS.headings);
    sheet.getRange('A' + r + ':H' + r).merge();
    r++;

    sheet.getRange('A' + r).setValue('Period: ' + formatDateShort(dateRange.start) + ' to ' + formatDateShort(dateRange.end));
    sheet.getRange('A' + r).setFontSize(10);
    sheet.getRange('A' + r).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + r + ':H' + r).merge();
    r++;

    sheet.getRange('A' + r).setValue('Generated: ' + formatDateForDisplay(now));
    sheet.getRange('A' + r).setFontSize(9);
    sheet.getRange('A' + r).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + r).setFontStyle('italic');
    sheet.getRange('A' + r + ':H' + r).merge();
    r++;

    sheet.getRange('A' + r).setValue('Total visitors in period: ' + filtered.length);
    sheet.getRange('A' + r).setFontSize(10);
    sheet.getRange('A' + r).setFontColor(COLORS.primary);
    sheet.getRange('A' + r).setFontWeight('bold');
    sheet.getRange('A' + r + ':H' + r).merge();
    r++;

    // Blank spacer
    r++;

    // Table headers
    var logHeaders = ['Visitor #', 'Name', 'ID/Passport', 'Company', 'Destination', 'Status', 'Time'];
    for (var c = 0; c < logHeaders.length; c++) {
      var cell = sheet.getRange(r, c + 1);
      cell.setValue(logHeaders[c]);
      cell.setFontWeight('bold');
      cell.setFontColor(COLORS.headings);
      cell.setFontSize(10);
      cell.setBackground(COLORS.lightGray);
    }
    r++;

    // Visitor Log data rows — ALL of them, NO row cap
    // Columns: 0=Timestamp, 1=Name, 2=ID, 3=Company, 4=Destination,
    //          5=Phone, 6=Email, 7=IDPhoto, 8=Selfie, 9=VisitorNo, 10=Status, 11=ActionTime
    for (var j = 0; j < filtered.length; j++) {
      var vRow = filtered[j];
      var timeStr = '';
      var actionTime = vRow[11] instanceof Date ? vRow[11] : vRow[0];
      if (actionTime instanceof Date && !isNaN(actionTime.getTime())) {
        var th = actionTime.getHours();
        var tm = actionTime.getMinutes();
        var tampm = th >= 12 ? 'PM' : 'AM';
        var th12 = th % 12 || 12;
        var tmin = ('0' + tm).slice(-2);
        timeStr = th12 + ':' + tmin + ' ' + tampm;
      }

      var visitorNo = String(vRow[9] || '').trim();
      var name = String(vRow[1] || '').trim();
      var idNum = String(vRow[2] || '').trim();
      var company = String(vRow[3] || '').trim();
      var dest = String(vRow[4] || '').trim();
      var status = String(vRow[10] || '').trim();

      var rowVals = [visitorNo, name, idNum, company, dest, status, timeStr];
      for (var k = 0; k < rowVals.length; k++) {
        var dataCell = sheet.getRange(r, k + 1);
        dataCell.setValue(rowVals[k]);
        dataCell.setFontColor(COLORS.bodyText);
        dataCell.setFontSize(9);
      }
      r++;

      // Yield periodically for large datasets (every 500 rows)
      if (j > 0 && j % 500 === 0) {
        SpreadsheetApp.flush();
      }
    }

    // Blank spacer
    r++;

    // End of report marker
    sheet.getRange('A' + r).setValue('Showing ' + filtered.length + ' visitor(s) · End of Report');
    sheet.getRange('A' + r).setFontSize(9);
    sheet.getRange('A' + r).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + r).setFontStyle('italic');
    sheet.getRange('A' + r + ':H' + r).merge();

    // ── Toast: completion (bound mode only) ──
    if (!sheetId) {
      var ho = now.getHours();
      var mi = now.getMinutes();
      var ampm2 = ho >= 12 ? 'PM' : 'AM';
      var h12_2 = ho % 12 || 12;
      var minStr2 = ('0' + mi).slice(-2);
      try { SpreadsheetApp.toast('✓ Visitor Log exported • ' + filtered.length + ' rows • ' + h12_2 + ':' + minStr2 + ' ' + ampm2, 'LITEVM', 5); } catch(e) {}
    }

    console.log('generateVisitorLog: Visitor Log exported with ' + filtered.length + ' rows.');
    return true;

  } catch (error) {
    console.error('generateVisitorLog error: ' + error.message + '\n' + error.stack);
    if (!sheetId) {
      try { SpreadsheetApp.getUi().alert(
        '❌ Visitor Log generation failed.\n\n'
        + error.message + '\n\n'
        + 'Check the Apps Script logs for details.'
      ); } catch(e) {}
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// COMPUTE: Report Trends (vs Same Weekday Last Week)
// ──────────────────────────────────────────────

/**
 * Compute trend strings comparing current period to the same weekday
 * one week prior. Reuses computeKpis_ and formatTrend_ from Dashboard.gs.
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {Array} cardno - All rows from cardno
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Object} Trend strings keyed by KPI name
 */
function computeReportTrends_(visitorLog, cardno, dateRange) {
  var daysDiff = 7;
  var prevStart = new Date(dateRange.start.getTime() - daysDiff * 24 * 60 * 60 * 1000);
  var prevEnd = new Date(dateRange.end.getTime() - daysDiff * 24 * 60 * 60 * 1000);
  var prevRange = { start: prevStart, end: prevEnd };

  var current = computeKpis_(visitorLog, cardno, dateRange);
  var previous = computeKpis_(visitorLog, cardno, prevRange);

  return {
    totalVisitors:  formatTrend_(current.totalVisitors,    previous.totalVisitors),
    checkedIn:      formatTrend_(current.checkedIn,        previous.checkedIn),
    pending:        formatTrend_(current.pending,          previous.pending),
    rejected:       formatTrend_(current.rejected,         previous.rejected),
  };
}

// ──────────────────────────────────────────────
// COMPUTE: Top Destinations (top 5)
// ──────────────────────────────────────────────

/**
 * Compute the top 5 destinations by visitor count within the date range.
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Array<{ name: string, count: number }>}
 */
function computeTopDestinations_(visitorLog, dateRange) {
  var destCounts = {};

  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < dateRange.start || ts > dateRange.end) continue;

    var dest = String(row[4] || 'Unknown').trim();
    if (dest === '') dest = 'Unknown';
    if (destCounts.hasOwnProperty(dest)) {
      destCounts[dest]++;
    } else {
      destCounts[dest] = 1;
    }
  }

  var entries = [];
  for (var name in destCounts) {
    if (destCounts.hasOwnProperty(name)) {
      entries.push({ name: name, count: destCounts[name] });
    }
  }

  entries.sort(function(a, b) {
    return b.count - a.count;
  });

  return entries.slice(0, 5);
}

// ──────────────────────────────────────────────
// COMPUTE: Peak Hour Analysis (24-hour buckets)
// ──────────────────────────────────────────────

/**
 * Compute visitor count per hour of the day within the date range.
 * Returns an array of 24 entries (hours 0-23).
 *
 * @param {Array} visitorLog - All rows from VisitorLog
 * @param {{ start: Date, end: Date }} dateRange
 * @returns {Array<{ hour: number, count: number }>}
 */
function computePeakHours_(visitorLog, dateRange) {
  var hourCounts = {};
  for (var h = 0; h < 24; h++) {
    hourCounts[h] = 0;
  }

  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < dateRange.start || ts > dateRange.end) continue;

    var hour = ts.getHours();
    hourCounts[hour]++;
  }

  var result = [];
  for (var hh = 0; hh < 24; hh++) {
    result.push({ hour: hh, count: hourCounts[hh] });
  }

  return result;
}

// ──────────────────────────────────────────────
// HELPER: Write a Summary Row
// ──────────────────────────────────────────────

/**
 * Write a single summary KPI row with label, value, and optional trend.
 *
 * @param {Sheet} sheet - The Report sheet
 * @param {number} row - The row number to write
 * @param {string} label - KPI label
 * @param {number} value - KPI value
 * @param {string} trend - Trend string (optional, pass '' to skip)
 */
function writeKpiPair_(sheet, row, col, label, value, trend) {
  // Write label
  var labelCell = sheet.getRange(row, col);
  labelCell.setValue(label + ':');
  labelCell.setFontSize(10);
  labelCell.setFontColor(COLORS.bodyText);
  labelCell.setFontWeight('bold');

  // Write value
  var valCell = sheet.getRange(row, col + 1);
  valCell.setValue(value);
  valCell.setFontSize(12);
  valCell.setFontWeight('bold');
  valCell.setFontColor(COLORS.primary);

  // Write trend if provided
  if (trend && trend !== '') {
    var trendCell = sheet.getRange(row, col + 2);
    trendCell.setValue(trend);
    trendCell.setFontSize(9);
    trendCell.setFontColor(COLORS.bodyText);
    trendCell.setFontStyle('italic');
  }
}

// ──────────────────────────────────────────────
// HELPER: Format Date Short (dd/mm/yyyy)
// ──────────────────────────────────────────────

/**
 * Format a Date object into a short date string like "26 Jun 2026".
 *
 * @param {Date} date
 * @returns {string} e.g. "26 Jun 2026"
 */
function formatDateShort(date) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}
