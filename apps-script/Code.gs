/**
 * LITEVM — Google Apps Script Web App (Backend Middleware)
 *
 * MULTI-CUSTOMER ARCHITECTURE:
 *   A single Web App deployment serves multiple customer sheets. Each request
 *   passes a sheetId parameter identifying which Google Sheet to operate on.
 *   The frontend (config.js) has API_BASE pointing to one Web App URL, and
 *   each customer's frontend build has its own SHEET_ID in config.js.
 *
 * Supported modes:
 *   GET  — lookup, today, destinations, cardpool (all accept sheetId query param)
 *   POST — registration, updateStatus, dashboard (all accept sheetId in JSON body)
 *
 * Deploy as a Web App:
 *   1. File > New > Project
 *   2. Paste this code into Code.gs
 *   3. Set script properties:
 *      - SHEET_ID: Google Sheet ID (optional, defaults to active spreadsheet)
 *      - DRIVE_FOLDER_ID: Parent Drive folder ID for VMS uploads
 *   4. Deploy > New deployment > Web App
 *   5. Set "Execute as" to "Me" and "Who has access" to "Anyone"
 *   6. Copy the Web App URL into frontend config.js as API_BASE
 *
 * Dashboard.gs is a SIBLING file in the same Apps Script project that provides
 * the snapshot dashboard for bound-script and Web App usage.
 */

// ──────────────────────────────────────────────
// WEB APP ENTRY POINTS
// ──────────────────────────────────────────────

/**
 * Handle GET requests.
 * All actions accept an optional sheetId query parameter for multi-customer support.
 * ?action=lookup&visitorNumber=V-XXXX&sheetId=... → returns visitor data
 * ?action=today&sheetId=...                        → returns all today's visitors
 * ?action=destinations&sheetId=...                 → returns Destination tab data
 * ?action=cardpool&sheetId=...                     → card pool diagnostic
 * (no params)                                      → health check
 */
function doGet(e) {
  try {
    // Check for action parameter
    if (e && e.parameter && e.parameter.action) {
      var action = e.parameter.action;
      var sheetId = e && e.parameter ? e.parameter.sheetId : null;

      if (action === 'lookup') {
        var visitorNumber = e.parameter.visitorNumber;
        if (!visitorNumber) {
          return jsonResponse({ status: 'notfound', message: 'Missing visitorNumber parameter' }, 400);
        }
        return handleLookup(visitorNumber, sheetId);
      }

      if (action === 'today') {
        return handleTodayVisitors(sheetId);
      }

      if (action === 'destinations') {
        return handleDestinations(sheetId);
      }

      if (action === 'cardpool') {
        return handleCardPoolDiagnostic(sheetId);
      }
    }

    // Default: health check
    return jsonResponse({ status: 'LITEVM Web App is running' }, 200);

  } catch (error) {
    console.error('doGet error: ' + error.message);
    return jsonResponse({ error: error.message, status: 'error' }, 500);
  }
}

/**
 * Handle POST requests.
 * Modes: dashboard (refreshDashboard), updateStatus (visitor check-in/reject),
 * or registration (default — creates new visitor entry).
 */
function doPost(e) {
  try {
    // Parse incoming JSON
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({ status: 'error', error: 'Invalid JSON payload' }, 400);
    }

    // Dashboard refresh
    if (data.mode === 'dashboard') {
      return handleDashboardRefresh(data);
    }

    // Report generation
    if (data.mode === 'report') {
      return handleReportGenerate(data);
    }

    // Handle migration
    if (data.mode === 'migrate') {
      return handleMigrationResponse(data);
    }

    // Handle setup (dashboard/report layout creation)
    if (data.mode === 'setup') {
      return handleSetupAction(data);
    }

    // Check if this is a status update
    if (data.mode === 'updateStatus') {
      return handleStatusUpdate(data);
    }

    // If mode was specified but not handled, return error
    if (data.mode) {
      return jsonResponse({ status: 'error', error: 'Unknown mode: ' + data.mode }, 400);
    }

    // Otherwise, handle registration (existing logic — no mode or mode=register)
    return handleRegistration(data);

  } catch (error) {
    console.error('doPost error: ' + error.message + '\n' + error.stack);
    return jsonResponse({ error: error.message, status: 'error' }, 500);
  }
}

// ──────────────────────────────────────────────
// HANDLER: Migration (Web App mode)
// ──────────────────────────────────────────────

/**
 * Handle migration requests from the Web App.
 * Accepts mode=migrate with a sheetId, runs pending migrations
 * sequentially, and returns JSON with migration results.
 *
 * @param {Object} data - Request body with mode and sheetId
 * @returns {TextOutput} JSON response
 */
function handleMigrationResponse(data) {
  try {
    if (!data.sheetId) {
      return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
    }
    var result = handleMigration(data.sheetId);
    return jsonResponse(result, result.status === 'ok' ? 200 : 500);
  } catch (e) {
    return jsonResponse({ status: 'error', error: e.message }, 500);
  }
}

// ──────────────────────────────────────────────
// HANDLER: Dashboard Refresh (Web App mode)
// ──────────────────────────────────────────────

/**
 * Handle dashboard refresh requests from the Web App.
 * Accepts mode=dashboard with a sheetId, opens that sheet,
 * and runs the full dashboard refresh pipeline.
 * Returns JSON status — does NOT show UI alerts.
 *
 * @param {Object} data - Request body with mode and sheetId
 * @returns {TextOutput} JSON response
 */
function handleDashboardRefresh(data) {
  var sheetId = data.sheetId;
  if (!sheetId) {
    return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
  }

  try {
    var result = refreshDashboard(sheetId);
    if (result === true) {
      return jsonResponse({ status: 'ok', message: 'Dashboard refreshed' }, 200);
    } else {
      return jsonResponse({ status: 'error', error: 'Dashboard refresh failed — check logs' }, 500);
    }
  } catch (e) {
    console.error('handleDashboardRefresh error: ' + e.message);
    return jsonResponse({ status: 'error', error: e.message }, 500);
  }
}

// ──────────────────────────────────────────────
// HANDLER: Report Generation (Web App mode)
// ──────────────────────────────────────────────

/**
 * Handle report generation requests from the Web App.
 * Accepts mode=report with a sheetId and reportType.
 * Valid reportType values: 'daily' (summary) or 'visitors' (log).
 * Returns JSON status — does NOT show UI alerts.
 *
 * @param {Object} data - Request body with mode, sheetId, and reportType
 * @returns {TextOutput} JSON response
 */
function handleReportGenerate(data) {
  var sheetId = data.sheetId;
  if (!sheetId) {
    return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
  }

  var reportType = data.reportType || 'daily';

  try {
    var result;
    if (reportType === 'daily') {
      result = generateDailySummary(sheetId);
    } else if (reportType === 'visitors') {
      result = generateVisitorLog(sheetId);
    } else {
      return jsonResponse({ status: 'error', error: 'Invalid reportType. Use "daily" or "visitors".' }, 400);
    }

    if (result === true) {
      return jsonResponse({ status: 'ok', reportType: reportType, message: 'Report generated' }, 200);
    } else {
      return jsonResponse({ status: 'error', error: 'Report generation failed — check logs' }, 500);
    }
  } catch (e) {
    console.error('handleReportGenerate error: ' + e.message);
    return jsonResponse({ status: 'error', error: e.message }, 500);
  }
}

// ──────────────────────────────────────────────
// HANDLER: Registration
// ──────────────────────────────────────────────

function handleRegistration(data) {
  // Validate required fields
  var required = ['fullName', 'idNumber', 'company', 'destination', 'phone', 'email', 'idPhoto', 'selfie'];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) {
      return jsonResponse({ status: 'error', error: 'Missing required field: ' + required[i] }, 400);
    }
  }

  // Sanitize text fields
  var fullName = sanitizeText(data.fullName);
  var idNumber = sanitizeText(data.idNumber);
  var company = sanitizeText(data.company);
  var destination = sanitizeText(data.destination);
  var phone = sanitizePhone(data.phone);
  var email = sanitizeText(data.email);

  // Create Drive folder: VMS/YYYY-MM-DD/VisitorName_Phone/
  var folder = createVisitorFolder(fullName, phone);

  // Upload photos to Drive
  var idPhotoUrl = uploadBase64ToDrive(folder, 'id_photo.jpg', data.idPhoto);
  var selfieUrl = uploadBase64ToDrive(folder, 'selfie.jpg', data.selfie);

  // Generate visitor number (server-side, sequential per day)
  var visitorNumber = generateVisitorNumber();

  // Write to Google Sheet
  var sheet = getOrCreateSheet(data.sheetId);
  sheet.appendRow([
    new Date(),            // 0 Timestamp
    fullName,              // 1 Full Name
    idNumber,              // 2 ID / Passport Number
    company,               // 3 Company Name
    destination,           // 4 Destination
    phone,                 // 5 Hand Phone Number
    email,                 // 6 Email (NEW)
    idPhotoUrl,            // 7 ID Photo (Drive URL)
    selfieUrl,             // 8 Selfie (Drive URL)
    visitorNumber,         // 9 Visitor Number
    'Pending Entry'        // 10 Status
  ]);

  // Send email confirmation (non-blocking — catch errors)
  try {
    sendEmailConfirmation(email, visitorNumber, fullName);
  } catch (emailErr) {
    console.warn('Email notification failed: ' + emailErr.message);
  }

  return jsonResponse({ visitorNumber: visitorNumber, status: 'ok' }, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Lookup by Visitor Number
// ──────────────────────────────────────────────

function handleLookup(visitorNumber, sheetId) {
  var sheet = getOrCreateSheet(sheetId);
  var data = sheet.getDataRange().getValues();

  // Headers are in row 1 (index 0). Data starts at row 2 (index 1).
  // Columns: 0=Timestamp, 1=Full Name, 2=ID/Passport, 3=Company,
  //          4=Destination, 5=Phone, 6=Email, 7=ID Photo URL, 8=Selfie URL,
  //          9=Visitor Number, 10=Status, 11=Action Time

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var vn = String(row[9] || '').trim();

    if (vn === visitorNumber.trim()) {
      var ts = row[0];
      var registrationTime = '';
      if (ts instanceof Date) {
        registrationTime = formatDateForDisplay(ts);
      } else {
        registrationTime = String(ts);
      }

      var visitor = {
        visitorNumber: vn,
        fullName: String(row[1] || ''),
        idNumber: String(row[2] || ''),
        company: String(row[3] || ''),
        destination: String(row[4] || ''),
        phone: String(row[5] || ''),
        email: String(row[6] || ''),
        idPhotoUrl: String(row[7] || ''),
        selfieUrl: String(row[8] || ''),
        status: String(row[10] || 'Pending Entry'),
        registrationTime: registrationTime,
        actionTime: row[11] ? (row[11] instanceof Date ? formatDateForDisplay(row[11]) : String(row[11])) : '',
      };

      return jsonResponse({ status: 'ok', visitor: visitor }, 200);
    }
  }

  return jsonResponse({ status: 'notfound', message: 'No registration found for ' + visitorNumber }, 404);
}

// ──────────────────────────────────────────────
// HANDLER: Today's Visitors
// ──────────────────────────────────────────────

function handleTodayVisitors(sheetId) {
  var sheet = getOrCreateSheet(sheetId);
  var data = sheet.getDataRange().getValues();

  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  var visitors = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var ts = row[0];

    // Check if timestamp is today
    if (ts instanceof Date && ts >= todayStart && ts <= todayEnd) {
      visitors.push({
        visitorNumber: String(row[9] || ''),
        fullName: String(row[1] || ''),
        idNumber: String(row[2] || ''),
        company: String(row[3] || ''),
        destination: String(row[4] || ''),
        phone: String(row[5] || ''),
        email: String(row[6] || ''),
        idPhotoUrl: String(row[7] || ''),
        selfieUrl: String(row[8] || ''),
        status: String(row[10] || 'Pending Entry'),
        registrationTime: formatDateForDisplay(ts),
        actionTime: row[11] ? (row[11] instanceof Date ? formatDateForDisplay(row[11]) : String(row[11])) : '',
      });
    }
  }

  return jsonResponse({ status: 'ok', visitors: visitors }, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Destinations (from Destination tab)
// ──────────────────────────────────────────────

function handleDestinations(sheetId) {
  if (!sheetId) {
    sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  }
  if (!sheetId) {
    return jsonResponse({ status: 'error', message: 'SHEET_ID not configured' }, 500);
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('Destination');

  if (!sheet) {
    return jsonResponse({ status: 'error', message: 'Destination sheet tab not found' }, 404);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return jsonResponse({ status: 'ok', destinations: [], headers: data.length > 0 ? data[0] : [] }, 200);
  }

  // First row is headers
  var headers = data[0];
  var destinations = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = String(headers[j]).trim().replace(/\s+/g, '_');
      obj[key] = String(row[j] || '').trim();
    }
    destinations.push(obj);
  }

  return jsonResponse({
    status: 'ok',
    headers: headers,
    destinations: destinations,
    count: destinations.length,
  }, 200);
}

// ──────────────────────────────────────────────
// DIAGNOSTIC: Card Pool Inspection (remove after debugging)
// ──────────────────────────────────────────────

function handleCardPoolDiagnostic(sheetId) {
  if (!sheetId) {
    sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  }
  if (!sheetId) {
    return jsonResponse({ status: 'error', message: 'SHEET_ID not configured' }, 500);
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('cardno');

  if (!sheet) {
    return jsonResponse({ status: 'error', message: 'cardno sheet tab not found' }, 404);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data.length > 0 ? data[0] : [];
  var rows = [];
  var limit = Math.min(data.length, 11); // header + first 10 rows
  for (var i = 0; i < limit; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row['col' + j] = String(data[i][j] || '');
    }
    rows.push(row);
  }

  return jsonResponse({
    status: 'ok',
    sheetName: 'cardno',
    totalRows: data.length,
    headers: headers,
    columnCount: headers.length,
    rows: rows,
  }, 200);
}

// ──────────────────────────────────────────────
// SEED: Populate cardno sheet (run once from editor)
// ──────────────────────────────────────────────

/**
 * Populate the cardno sheet with a batch of cards.
 * Run this once from the Apps Script editor after deployment.
 * @param {number} count — Number of cards to generate (default: 50)
 * @param {string} prefix — Card number prefix (default: '1')
 */
function seedCardPool(count, prefix) {
  count = count || 50;
  prefix = prefix || '1';

  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    console.error('seedCardPool: SHEET_ID not configured');
    return;
  }

  var sheet = getCardnoSheet(sheetId);
  if (!sheet) {
    // Cardno sheet doesn't exist yet — create it
    var ss = SpreadsheetApp.openById(sheetId);
    sheet = ss.insertSheet('cardno');
    sheet.getRange(1, 1, 1, 4).setValues([['CardNo', 'Status', 'AssignedTo', 'AssignedAt']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
    console.log('seedCardPool: Created cardno sheet with headers');
  }

  // Check if already has data
  var existing = sheet.getDataRange().getValues();
  if (existing.length > 1) {
    console.log('seedCardPool: Sheet already has ' + (existing.length - 1) + ' cards. Skipping seed.');
    return;
  }

  // Generate cards: prefix padded to 5 digits, e.g. 10001, 10002...
  var cards = [];
  for (var i = 1; i <= count; i++) {
    var padded = ('00000' + i).slice(-5);
    cards.push([prefix + padded, 'Available', '', '']);
  }

  sheet.getRange(2, 1, cards.length, 4).setValues(cards);
  sheet.autoResizeColumns(1, 4);

  console.log('seedCardPool: Added ' + count + ' cards (e.g. ' + prefix + '00001 to ' + prefix + ('00000' + count).slice(-5) + ')');
}

// ──────────────────────────────────────────────
// HANDLER: Update Visitor Status
// (with LockService-guarded card assignment
//  for Checked In path)
// ──────────────────────────────────────────────

function handleStatusUpdate(data) {
  var visitorNumber = data.visitorNumber;
  var newStatus = data.status;

  if (!visitorNumber) {
    return jsonResponse({ status: 'error', message: 'Missing visitorNumber' }, 400);
  }

  if (!newStatus || (newStatus !== 'Checked In' && newStatus !== 'Rejected')) {
    return jsonResponse({ status: 'error', message: 'Invalid status. Must be "Checked In" or "Rejected".' }, 400);
  }

  var sheet = getOrCreateSheet(data.sheetId);
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  // Use LockService for the Checked In path to serialize concurrent requests
  // and prevent two guards from picking the same card
  var lock = null;
  if (newStatus === 'Checked In') {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
    }
  }

  try {
    for (var i = 1; i < values.length; i++) {
      var vn = String(values[i][9] || '').trim();

      if (vn === visitorNumber.trim()) {
        // Check if already processed (idempotency guard)
        var currentStatus = String(values[i][10] || '').trim();
        if (currentStatus === 'Checked In' || currentStatus === 'Rejected') {
          return jsonResponse({
            status: 'error',
            message: 'Visitor already processed. Current status: ' + currentStatus
          }, 409);
        }

        // Update Status column (col 11 = index 10)
        sheet.getRange(i + 1, 11).setValue(newStatus);
        // Update Action Time column (col 12 = index 11) to record when check-in/rejection happened
        sheet.getRange(i + 1, 12).setValue(new Date());

        var result = {
          status: 'ok',
          message: 'Status updated to ' + newStatus,
          visitorNumber: visitorNumber,
        };

        // If Checked In, proceed with card assignment (inside lock)
        if (newStatus === 'Checked In') {
          // Extract visitor details from the row for card assignment
          var fullName = String(values[i][1] || '').trim();
          var destination = String(values[i][4] || '').trim();
          var email = String(values[i][6] || '').trim();

          try {
            var cardResult = assignCardForVisitor(visitorNumber, fullName, destination, email, data.sheetId);
            if (cardResult) {
              result.cardNo = cardResult.cardNo;
              result.cardQRUrl = cardResult.cardQRUrl;
              result.cardStatus = cardResult.status;
            }
          } catch (cardErr) {
            console.warn('Card assignment failed: ' + cardErr.message);
            result.cardNo = null;
            result.cardStatus = 'error';
            result.cardError = cardErr.message;
          }
        }

        return jsonResponse(result, 200);
      }
    }

    return jsonResponse({ status: 'notfound', message: 'Visitor number not found: ' + visitorNumber }, 404);
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

// ──────────────────────────────────────────────
// HELPER: Format date for display
// ──────────────────────────────────────────────

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
// HELPER: JSON Response
// ──────────────────────────────────────────────

function jsonResponse(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ──────────────────────────────────────────────
// GOOGLE SHEET MANAGEMENT
// ──────────────────────────────────────────────

function getOrCreateSheet(sheetId) {
  if (!sheetId) {
    throw new Error('Missing sheetId parameter. Every Web App request must include a sheetId.');
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('Cannot open sheet: ' + sheetId + '. Verify the sheet exists and is shared with the Web App owner. Error: ' + e.message);
  }

  var sheet = ss.getActiveSheet();
  var sheetName = 'VisitorLog';

  // Try to get named sheet; create if it doesn't exist
  try {
    sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      setupSheet(sheet);
    }
  } catch (e) {
    sheet = ss.getActiveSheet();
    // Check if headers exist
    if (sheet.getLastRow() === 0) {
      setupSheet(sheet);
    }
  }

  return sheet;
}

/**
 * Initialize sheet headers if this is a fresh sheet.
 */
function setupSheet(sheet) {
  if (!sheet) sheet = getOrCreateSheet();

  // Only set up headers if the sheet is empty
  if (sheet.getLastRow() > 0) return;

  var headers = [
    'Timestamp',
    'Full Name',
    'ID / Passport Number',
    'Company Name',
    'Destination',
    'Hand Phone',
    'Email',
    'ID Photo (Drive URL)',
    'Selfie (Drive URL)',
    'Visitor Number',
    'Status',
    'Action Time'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Auto-resize columns
  for (var i = 0; i < headers.length; i++) {
    sheet.autoResizeColumn(i + 1);
  }
}

// ──────────────────────────────────────────────
// DRIVE FOLDER & PHOTO UPLOAD
// ──────────────────────────────────────────────

/**
 * Create folder structure: DRIVE_PARENT/VMS/YYYY-MM-DD/VisitorName_Phone/
 */
function createVisitorFolder(fullName, phone) {
  var parentFolderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');

  // Get or create root VMS folder
  var rootFolder;
  if (parentFolderId) {
    rootFolder = DriveApp.getFolderById(parentFolderId);
  } else {
    rootFolder = DriveApp.getRootFolder();
  }

  // Create or get VMS folder
  var vmsFolder = getOrCreateSubfolder(rootFolder, 'VMS');

  // Create or get date folder
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var dateFolder = getOrCreateSubfolder(vmsFolder, dateStr);

  // Create visitor folder
  var safeName = fullName.replace(/[^a-zA-Z0-9\-_ ]/g, '').substring(0, 30).trim();
  var safePhone = phone.replace(/[^0-9]/g, '').substring(0, 15);
  var folderName = safeName + '_' + safePhone;

  var visitorFolder = getOrCreateSubfolder(dateFolder, folderName);

  return visitorFolder;
}

/**
 * Get or create a subfolder within a parent folder.
 */
function getOrCreateSubfolder(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}

/**
 * Decode base64 image and upload to Drive folder.
 * Returns the Drive file's view URL.
 */
function uploadBase64ToDrive(folder, filename, base64Data) {
  if (!base64Data) throw new Error('No photo data provided for ' + filename);

  // Strip Data URL prefix if present
  var rawData = base64Data;
  var commaIndex = base64Data.indexOf(',');
  if (commaIndex >= 0) {
    rawData = base64Data.substring(commaIndex + 1);
  }

  // Decode base64 to blob
  var decoded;
  try {
    decoded = Utilities.base64Decode(rawData);
  } catch (decodeErr) {
    throw new Error('Failed to decode image data: ' + decodeErr.message);
  }

  var blob = Utilities.newBlob(decoded, 'image/jpeg', filename);

  // Create file in Drive folder
  var file = folder.createFile(blob);

  // Share publicly so photos can be displayed in <img> tags
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Return the view URL
  return file.getUrl();
}

// ──────────────────────────────────────────────
// VISITOR NUMBER GENERATOR
// ──────────────────────────────────────────────

/**
 * Generate a sequential visitor number: V-YYYYMMDD-NNN
 * Uses ScriptProperties to track the daily counter.
 */
function generateVisitorNumber() {
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var propKey = 'VISITOR_COUNTER_' + dateStr;

  var props = PropertiesService.getScriptProperties();
  var counter = parseInt(props.getProperty(propKey) || '0', 10);
  counter++;

  // Store incremented counter
  props.setProperty(propKey, counter.toString());

  // Pad to 3 digits
  var padded = ('000' + counter).slice(-3);

  return 'V-' + dateStr + '-' + padded;
}

// ──────────────────────────────────────────────
// EMAIL CONFIRMATION
// ──────────────────────────────────────────────

/**
 * Send email confirmation via MailApp.sendEmail().
 * MailApp is a built-in Apps Script service — no setup, no tokens needed.
 */
function sendEmailConfirmation(toEmail, visitorNumber, fullName) {
  var subject = 'Visitor Registration Confirmed — ' + visitorNumber;
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(visitorNumber);

  var htmlBody = ''
    + '<div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;padding:24px;">'
    + '<div style="text-align:center;padding:32px 24px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;">'

    // Header
    + '<h1 style="font-size:20px;font-weight:700;color:#1E293B;margin:0 0 4px 0;">Registration Complete!</h1>'
    + '<p style="font-size:14px;color:#64748B;margin:0 0 24px 0;">Your details have been submitted and recorded.</p>'

    // QR Code
    + '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:inline-block;">'
    + '<img src="' + qrUrl + '" alt="QR Code for ' + visitorNumber + '" style="display:block;width:180px;height:180px;border-radius:8px;">'
    + '<p style="font-size:12px;color:#64748B;margin:12px 0 0 0;">Show this QR code at the entrance</p>'
    + '</div>'

    // Visitor Number
    + '<div style="margin-top:20px;">'
    + '<p style="font-size:12px;color:#64748B;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.5px;">Visitor Number</p>'
    + '<p style="font-size:28px;font-weight:700;color:#4361EE;margin:0;letter-spacing:1px;">' + visitorNumber + '</p>'
    + '</div>'

    // Details
    + '<div style="margin-top:24px;padding:16px;background:#F8FAFC;border-radius:10px;text-align:left;">'
    + '<p style="font-size:14px;color:#1E293B;margin:0 0 4px 0;"><strong>Name:</strong> ' + escapeHtml(fullName) + '</p>'
    + '<p style="font-size:14px;color:#1E293B;margin:0;">Please show this QR code at the guard house for entry.</p>'
    + '</div>'

    // Footer
    + '<div style="margin-top:24px;padding:12px 16px;background:#F0FDF4;border-radius:8px;display:inline-block;">'
    + '<p style="font-size:12px;color:#16A34A;margin:0;">&#10003; Your information is securely stored.</p>'
    + '</div>'

    + '</div>'
    + '<p style="text-align:center;font-size:11px;color:#94A3B8;margin-top:16px;">LITEVM Visitor Management System</p>'
    + '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
  });

  console.log('Email confirmation sent to ' + toEmail);
}

// ──────────────────────────────────────────────
// CARD POOL MANAGEMENT
// ──────────────────────────────────────────────

/**
 * Get the cardno worksheet handle from the spreadsheet.
 * Returns the Sheet object, or null if not found (logs a warning).
 * Does NOT create the sheet if missing.
 */
function getCardnoSheet(sheetId) {
  if (!sheetId) {
    console.warn('getCardnoSheet: sheetId is required');
    return null;
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) {
      console.warn('getCardnoSheet: "cardno" sheet tab not found in spreadsheet ' + sheetId);
      return null;
    }
    return cardSheet;
  } catch (e) {
    console.warn('getCardnoSheet: Failed to open spreadsheet ' + sheetId + ' — ' + e.message);
    return null;
  }
}

/**
 * Look up the Access Level for a given destination from the Destination sheet.
 * @param {string} destination — The visitor's destination (e.g. "BRI", "PLN")
 * @returns {string|null} The Access Level value, or null if not found
 */
function getAccessLevelForDestination(destination, sheetId) {
  if (!destination) return null;
  if (!sheetId) {
    console.warn('getAccessLevelForDestination: sheetId is required');
    return null;
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    console.warn('getAccessLevelForDestination: Cannot open spreadsheet ' + sheetId + ' — ' + e.message);
    return null;
  }

  var destSheet = ss.getSheetByName('Destination');
  if (!destSheet) {
    console.warn('getAccessLevelForDestination: Destination sheet tab not found');
    return null;
  }

  var data = destSheet.getDataRange().getValues();
  var destLower = destination.trim().toLowerCase();

  // Row 0 = headers; data starts at row 1
  // Column 0 = Destination, Column 1 = Access Level
  for (var i = 1; i < data.length; i++) {
    var rowDest = String(data[i][0] || '').trim().toLowerCase();
    if (rowDest === destLower) {
      var level = String(data[i][1] || '').trim();
      return level || null;
    }
  }

  return null;
}

/**
 * Find the first available (unassigned) card in the cardno sheet.
 * Pure read — does NOT modify the sheet.
 * @param {string} accessLevel — Currently unused (reserved for future access-level-based filtering)
 * @returns {string|null} The CardNo value, or null if the pool is depleted
 */
function pickUnusedCard(accessLevel, sheetId) {
  var cardSheet = getCardnoSheet(sheetId);
  if (!cardSheet) return null;

  var data = cardSheet.getDataRange().getValues();

  // Column layout: 0=CardNo, 1=Status, 2=AssignedTo, 3=AssignedAt
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][1] || '').trim().toLowerCase();
    if (status === 'available' || status === '') {
      return String(data[i][0] || '').trim();
    }
  }

  return null; // Pool depleted — no Available cards
}

/**
 * Mark a specific card as Assigned in the cardno sheet.
 * @param {string} cardNo — The card number to assign
 * @param {string} visitorNumber — The visitor receiving this card
 * @param {string} visitorName — The visitor's full name (logged for traceability)
 * @returns {boolean} true on success, false if card row not found
 */
function assignCard(cardNo, visitorNumber, visitorName, sheetId) {
  var cardSheet = getCardnoSheet(sheetId);
  if (!cardSheet) return false;

  var data = cardSheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var rowCardNo = String(data[i][0] || '').trim();
    if (rowCardNo === cardNo) {
      // Atomic write: mark Status, AssignedTo, AssignedAt in contiguous range
      cardSheet.getRange(i + 1, 2).setValue('Assigned');      // Status
      cardSheet.getRange(i + 1, 3).setValue(visitorNumber);   // AssignedTo
      cardSheet.getRange(i + 1, 4).setValue(new Date());      // AssignedAt

      // Optimistic re-read to verify the write took
      var checkValues = cardSheet.getRange(i + 1, 1, 1, 4).getValues();
      if (checkValues[0][1] !== 'Assigned' || checkValues[0][2] !== visitorNumber) {
        console.error('assignCard: Concurrency check FAILED for card ' + cardNo +
                      ' — expected Assigned/' + visitorNumber +
                      ', got ' + checkValues[0][1] + '/' + checkValues[0][2]);
        return false;
      }

      return true;
    }
  }

  console.warn('assignCard: Card number ' + cardNo + ' not found in cardno sheet');
  return false;
}

/**
 * Orchestrator: ties together access level lookup → card picking → assignment → email.
 * Called from handleStatusUpdate when a visitor is checked in.
 *
 * @param {string} visitorNumber
 * @param {string} fullName
 * @param {string} destination
 * @param {string} email
 * @returns {{ cardNo: string|null, cardQRUrl: string|null, status: string }}
 */
function assignCardForVisitor(visitorNumber, fullName, destination, email, sheetId) {
  // 1. Resolve access level from the visitor's destination
  var accessLevel = getAccessLevelForDestination(destination, sheetId);

  // 2. Pick an unused card (access level reserved for future filtering)
  var cardNo = pickUnusedCard(accessLevel, sheetId);

  if (!cardNo) {
    return { cardNo: null, status: 'depleted' };
  }

  // 3. Mark the card as Assigned
  var assigned = assignCard(cardNo, visitorNumber, fullName, sheetId);
  if (!assigned) {
    return { cardNo: null, status: 'error', message: 'Card assignment write failed' };
  }

  // 4. Generate QR code URL encoding the CARD NUMBER (for the gate reader)
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data='
            + encodeURIComponent(cardNo);

  // 5. Send email as backup (non-blocking — card is already assigned)
  try {
    sendCardAssignmentEmail(email, cardNo, fullName, visitorNumber);
  } catch (emailErr) {
    console.warn('Card assignment email failed for ' + visitorNumber + ': ' + emailErr.message);
    // Email failure does not roll back — the card is assigned and guard portal shows it
  }

  return { cardNo: cardNo, cardQRUrl: qrUrl, status: 'assigned' };
}

/**
 * Send a card assignment email with QR code encoding the card number.
 * This is separate from the registration confirmation email — sent at check-in time.
 *
 * @param {string} toEmail — Visitor's email address
 * @param {string} cardNo — The assigned card number (encoded in QR code)
 * @param {string} visitorName — Visitor's full name
 * @param {string} visitorNumber — Original visitor number (for subject line only)
 */
function sendCardAssignmentEmail(toEmail, cardNo, visitorName, visitorNumber) {
  var subject = 'Your Access Card — ' + visitorNumber;
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data='
            + encodeURIComponent(cardNo);

  var htmlBody = ''
    + '<div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;padding:24px;">'
    + '<div style="text-align:center;padding:32px 24px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;">'

    // Header
    + '<h1 style="font-size:20px;font-weight:700;color:#1E293B;margin:0 0 4px 0;">Your Access Card</h1>'
    + '<p style="font-size:14px;color:#64748B;margin:0 0 24px 0;">Show this QR code at the gate reader for entry</p>'

    // QR Code (encodes the card number, not visitor number)
    + '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:inline-block;">'
    + '<img src="' + qrUrl + '" alt="QR Code for Card ' + cardNo + '" style="display:block;width:180px;height:180px;border-radius:8px;">'
    + '<p style="font-size:12px;color:#64748B;margin:12px 0 0 0;">Scan at gate reader</p>'
    + '</div>'

    // Card Number — displayed prominently
    + '<div style="margin-top:20px;">'
    + '<p style="font-size:12px;color:#64748B;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:0.5px;">Card Number</p>'
    + '<p style="font-size:28px;font-weight:700;color:#4361EE;margin:0;letter-spacing:1px;">' + escapeHtml(cardNo) + '</p>'
    + '</div>'

    // Visitor details
    + '<div style="margin-top:24px;padding:16px;background:#F8FAFC;border-radius:10px;text-align:left;">'
    + '<p style="font-size:14px;color:#1E293B;margin:0 0 4px 0;"><strong>Visitor:</strong> ' + escapeHtml(visitorName) + '</p>'
    + '<p style="font-size:14px;color:#1E293B;margin:0;">' + escapeHtml(visitorNumber) + '</p>'
    + '</div>'

    // Footer
    + '<div style="margin-top:24px;padding:12px 16px;background:#F0FDF4;border-radius:8px;display:inline-block;">'
    + '<p style="font-size:12px;color:#16A34A;margin:0;">&#10003; Please keep this card with you during your visit</p>'
    + '</div>'

    + '</div>'
    + '<p style="text-align:center;font-size:11px;color:#94A3B8;margin-top:16px;">LITEVM Visitor Management System</p>'
    + '</div>';

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody,
  });

  console.log('Card assignment email sent to ' + toEmail + ' for card ' + cardNo);
}

/**
 * Release all Assigned cards back to Available.
 * Called by a daily time-driven trigger at 18:00.
 * Loops through the cardno sheet; for every row where Status = "Assigned",
 * resets Status to "Available" and clears AssignedTo / AssignedAt.
 */
function releaseDailyCards() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    console.warn('releaseDailyCards: SHEET_ID not configured — nothing to release');
    return;
  }

  var cardSheet = getCardnoSheet(sheetId);
  if (!cardSheet) {
    console.warn('releaseDailyCards: cardno sheet not found — nothing to release');
    return;
  }

  var data = cardSheet.getDataRange().getValues();
  var released = 0;

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][1] || '').trim().toLowerCase();
    if (status === 'assigned') {
      cardSheet.getRange(i + 1, 2).setValue('Available');   // Status → Available
      cardSheet.getRange(i + 1, 3).setValue('');             // Clear AssignedTo
      cardSheet.getRange(i + 1, 4).setValue('');             // Clear AssignedAt
      released++;
    }
  }

  console.log('releaseDailyCards: Released ' + released + ' cards back to Available');
}

/**
 * One-shot setup function. Deletes any existing 'releaseDailyCards' triggers,
 * then installs a new time-driven trigger set for 18:00–19:00 daily.
 * Run this once from the Apps Script editor after deployment.
 */
function setupDailyReleaseTrigger() {
  // Remove any existing triggers for this handler to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'releaseDailyCards') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Install a new daily trigger at 18:00
  ScriptApp.newTrigger('releaseDailyCards')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .create();

  console.log('setupDailyReleaseTrigger: Daily release trigger installed for 18:00–19:00');
}

// ──────────────────────────────────────────────
// SANITIZATION HELPERS
// ──────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize text fields to prevent injection.
 */
function sanitizeText(str) {
  if (!str) return '';
  // Strip leading/trailing whitespace and collapse multiple spaces
  return str.trim().replace(/\s+/g, ' ').substring(0, 200);
}

/**
 * Sanitize and normalize phone number.
 */
function sanitizePhone(str) {
  if (!str) return '';
  var cleaned = str.trim();
  // Add "+" if missing but has country code digits
  if (/^\d{10,15}$/.test(cleaned)) {
    cleaned = '+' + cleaned;
  }
  return cleaned.substring(0, 20);
}

// ──────────────────────────────────────────────
// MANUAL SETUP FUNCTION (run once in editor)
// ──────────────────────────────────────────────

/**
 * Run this function once from the Apps Script editor to initialize the sheet
 * and verify configuration.
 */
function initialize() {
  // Set up the sheet
  var sheet = getOrCreateSheet();
  setupSheet(sheet);

  // Log instructions
  console.log('LITEVM Apps Script initialized.');
  console.log('Sheet "' + sheet.getName() + '" is ready.');
  console.log('Set the following Script Properties if needed:');
  console.log('  SHEET_ID - Google Sheet ID (optional)');
  console.log('  DRIVE_FOLDER_ID - Parent Drive folder ID for VMS uploads');
  console.log('');
  console.log('After deployment, run setupDailyReleaseTrigger() once to install');
  console.log('the nightly card release at 18:00.');

  return 'Initialization complete. Check the logs for details.';
}

// ──────────────────────────────────────────────
// MIGRATION SYSTEM
// ──────────────────────────────────────────────

var SHEET_VERSION_CELL = 'Dashboard!A1000';
var LATEST_SHEET_VERSION = 2;

var VISITORLOG_HEADERS = [
  'Timestamp',
  'Full Name',
  'ID / Passport Number',
  'Company Name',
  'Destination',
  'Hand Phone',
  'Email',
  'ID Photo (Drive URL)',
  'Selfie (Drive URL)',
  'Visitor Number',
  'Status',
  'Action Time'
];

var CARDNO_HEADERS = ['CardNo', 'Status', 'AssignedTo', 'AssignedAt'];

var DESTINATION_HEADERS = ['Destination', 'Access Level'];

var MIGRATION_REGISTRY = [
  {
    version: 1,
    name: 'Initial structure',
    destructive: false,
    description: 'Validates VisitorLog, cardno, Destination, Dashboard tabs exist',
    fn: function(ss) {
      console.log('Migration V1: Validating baseline tabs');

      // VisitorLog tab
      var visitorLog = ss.getSheetByName('VisitorLog');
      if (!visitorLog) {
        console.log('Migration V1: Creating VisitorLog tab');
        visitorLog = ss.insertSheet('VisitorLog');
        visitorLog.getRange(1, 1, 1, VISITORLOG_HEADERS.length).setValues([VISITORLOG_HEADERS]);
        visitorLog.getRange(1, 1, 1, VISITORLOG_HEADERS.length).setFontWeight('bold');
        visitorLog.setFrozenRows(1);
        for (var v = 0; v < VISITORLOG_HEADERS.length; v++) {
          visitorLog.autoResizeColumn(v + 1);
        }
      } else {
        console.log('Migration V1: VisitorLog tab exists');
      }

      // cardno tab
      var cardno = ss.getSheetByName('cardno');
      if (!cardno) {
        console.log('Migration V1: Creating cardno tab');
        cardno = ss.insertSheet('cardno');
        cardno.getRange(1, 1, 1, CARDNO_HEADERS.length).setValues([CARDNO_HEADERS]);
        cardno.getRange(1, 1, 1, CARDNO_HEADERS.length).setFontWeight('bold');
        cardno.setFrozenRows(1);
      } else {
        console.log('Migration V1: cardno tab exists');
      }

      // Destination tab
      var destination = ss.getSheetByName('Destination');
      if (!destination) {
        console.log('Migration V1: Creating Destination tab');
        destination = ss.insertSheet('Destination');
        destination.getRange(1, 1, 1, DESTINATION_HEADERS.length).setValues([DESTINATION_HEADERS]);
        destination.getRange(1, 1, 1, DESTINATION_HEADERS.length).setFontWeight('bold');
        destination.setFrozenRows(1);
      } else {
        console.log('Migration V1: Destination tab exists');
      }

      // Dashboard tab
      var dashboard = ss.getSheetByName('Dashboard');
      if (!dashboard) {
        console.log('Migration V1: Creating Dashboard tab');
        // Inline equivalent of setupDashboardLayout for self-contained operation
        dashboard = ss.insertSheet('Dashboard');
        dashboard.getRange('A1').setValue('📊 LITEVM · Dashboard');
        dashboard.getRange('A1').setFontSize(18);
        dashboard.getRange('A1').setFontWeight('bold');
        dashboard.getRange('A1:H1').merge();
        dashboard.setFrozenRows(1);
      } else {
        console.log('Migration V1: Dashboard tab exists');
      }

      // Write version marker
      console.log('Migration V1: Complete');
    }
  },
  {
    version: 2,
    name: 'Add Report tab',
    destructive: false,
    description: 'Creates the Report tab with layout using setupReportLayout()',
    fn: function(ss) {
      console.log('Migration V2: Checking for Report tab');

      var existing = ss.getSheetByName('Report');
      if (existing) {
        console.log('Migration V2: Report tab already exists — skipping');
        return;
      }

      // Call the centralized function
      setupReportLayout(ss.getId());
      console.log('Migration V2: Report tab created via setupReportLayout().');
    }
  }
];

/**
 * Read sheet version from Dashboard!A1000.
 * Returns 0 if no version marker found.
 */
function getSheetVersion_(ss) {
  var sheet = ss.getSheetByName('Dashboard');
  if (!sheet) return 0;
  var cell = sheet.getRange(SHEET_VERSION_CELL.replace('Dashboard!', '')).getValue();
  var match = String(cell).match(/SHEET_VERSION=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Write sheet version to Dashboard!A1000.
 */
function setSheetVersion_(ss, version) {
  var sheet = ss.getSheetByName('Dashboard');
  if (!sheet) return;
  sheet.getRange(SHEET_VERSION_CELL.replace('Dashboard!', '')).setValue('SHEET_VERSION=' + version);
}

/**
 * Main migration handler. Called from handleMigrationResponse.
 * Runs all pending migrations sequentially (fail-stop).
 * Advances version only after successful migration.
 *
 * @param {string} sheetId - Google Sheet ID to migrate
 * @returns {Object} { status, fromVersion, toVersion, migrationsRun, error? }
 */
function handleMigration(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var fromVersion = getSheetVersion_(ss);
  var migrationsRun = [];

  for (var i = 0; i < MIGRATION_REGISTRY.length; i++) {
    var mig = MIGRATION_REGISTRY[i];
    if (mig.version > fromVersion) {
      try {
        mig.fn(ss);
        setSheetVersion_(ss, mig.version);
        migrationsRun.push(mig.name + ' (v' + mig.version + ')');
        console.log('Migration v' + mig.version + ' (' + mig.name + ') completed successfully');
      } catch (e) {
        console.error('Migration v' + mig.version + ' failed: ' + e.message);
        return {
          status: 'error',
          error: 'Migration v' + mig.version + ' (' + mig.name + ') failed: ' + e.message,
          fromVersion: fromVersion,
          toVersion: mig.version - 1,
          migrationsRun: migrationsRun
        };
      }
    }
  }

  return {
    status: 'ok',
    fromVersion: fromVersion,
    toVersion: LATEST_SHEET_VERSION,
    migrationsRun: migrationsRun
  };
}

// ──────────────────────────────────────────────
// HANDLER: Setup Action (dashboard/report layout)
// ──────────────────────────────────────────────

function handleSetupAction(data) {
  try {
    if (!data.sheetId) return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
    if (data.setupType === 'dashboard') {
      setupDashboardLayout(data.sheetId);
      return jsonResponse({ status: 'ok', message: 'Dashboard layout created' }, 200);
    } else if (data.setupType === 'report') {
      setupReportLayout(data.sheetId);
      return jsonResponse({ status: 'ok', message: 'Report layout created' }, 200);
    }
    return jsonResponse({ status: 'error', error: 'Unknown setupType: ' + data.setupType }, 400);
  } catch (e) {
    return jsonResponse({ status: 'error', error: e.message }, 500);
  }
}

// ──────────────────────────────────────────────
// DASHBOARD FUNCTIONS (moved from Dashboard.gs)
// ──────────────────────────────────────────────

// ── Color Palette ──

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

// ── SETUP: Dashboard Tab Layout ──

function setupDashboardLayout(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
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
  setupKpiCard_(sheet, 4, 1, 'Total Visitors', COLORS.primary);
  setupKpiCard_(sheet, 4, 4, 'Checked In', COLORS.success);
  setupKpiCard_(sheet, 4, 7, 'Pending', COLORS.warning);

  // =============================================
  // ROW 7 — Blank spacer
  // =============================================
  sheet.getRange('A7:J7').setBackground(COLORS.white);

  // =============================================
  // ROW 8-10 — KPI Row 2: Rejected | Cards Assigned | Today's Visitors
  // =============================================
  setupKpiCard_(sheet, 8, 1, 'Rejected', COLORS.danger);
  setupKpiCard_(sheet, 8, 4, 'Cards Assigned', COLORS.primary);
  setupKpiCard_(sheet, 8, 7, 'Today\'s Visitors', COLORS.primary);

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
  // Column widths
  // =============================================
  sheet.setColumnWidth(1, 32);
  sheet.setColumnWidth(2, 14);
  sheet.setColumnWidth(3, 14);
  sheet.setColumnWidth(4, 18);
  sheet.setColumnWidth(5, 14);
  sheet.setColumnWidth(6, 14);
  sheet.setColumnWidth(7, 18);
  sheet.setColumnWidth(8, 14);
  sheet.setColumnWidth(9, 14);
  sheet.setColumnWidth(10, 16);

  // =============================================
  // Freeze rows
  // =============================================
  sheet.setFrozenRows(0);

  // =============================================
  // Insert button note for reload
  // =============================================
  insertReloadButton_(sheet);

  // =============================================
  // Run refresh to populate data
  // =============================================
  refreshDashboard(sheetId);

  console.log('setupDashboardLayout: Dashboard tab created and populated.');
}

// ── HELPER: Setup a KPI Card ──

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

// ── HELPER: Insert Reload Button Note ──

function insertReloadButton_(sheet) {
  sheet.getRange('J3').setValue(
    '⚠ Menu: Use 📊 LITEVM > Refresh Dashboard (button not needed — wrapper script handles it)'
  );
  sheet.getRange('J3').setFontColor(COLORS.danger);
  sheet.getRange('J3').setFontSize(8);
  sheet.getRange('J3').setFontStyle('italic');

  console.log('insertReloadButton_: Note updated. Button not needed — wrapper script handles refresh.');
}

// ── MAIN: refreshDashboard() ──

function refreshDashboard(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Dashboard');
    if (!sheet) {
      return false;
    }

    // ── Step 1: Get date range ──
    var dateRange = getDateRange_(sheet);

    // ── Step 2: Read all source data ──
    var visitorLogData = readSheetData_(ss, 'VisitorLog');
    var cardnoData = readSheetData_(ss, 'cardno');
    var destData = readSheetData_(ss, 'Destination');

    // ── Step 3: Compute KPIs ──
    var kpis = computeKpis_(visitorLogData, cardnoData, dateRange);

    // ── Step 4: Compute trends ──
    var trends = computeTrends_(visitorLogData, cardnoData, dateRange);

    // ── Step 5: Build chart summary tables ──
    var chartTables = buildChartTables_(visitorLogData, cardnoData, dateRange);

    // ── Step 6: Write values to cells ──
    writeKpiValues_(sheet, kpis, 5, 1);
    writeKpiValues_(sheet, kpis, 5, 4);
    writeKpiValues_(sheet, kpis, 5, 7);
    writeKpiValues_(sheet, kpis, 9, 1);
    writeKpiValues_(sheet, kpis, 9, 4);
    writeKpiValues_(sheet, kpis, 9, 7);

    // ── Step 7: Write trend values ──
    writeTrendValues_(sheet, trends, 6, 1);
    writeTrendValues_(sheet, trends, 6, 4);
    writeTrendValues_(sheet, trends, 6, 7);
    writeTrendValues_(sheet, trends, 10, 1);
    writeTrendValues_(sheet, trends, 10, 4);
    writeTrendValues_(sheet, trends, 10, 7);

    // ── Step 8: Write chart table data ──
    writeStatusDistribution_(sheet, chartTables, 13);
    writeDailyTrend_(sheet, chartTables, 13);
    writeTopDestinations_(sheet, chartTables, 19);
    writeCardPoolSummary_(sheet, chartTables, 19);

    // ── Step 8b: Write Recent Check-Ins mini-list ──
    writeRecentCheckins_(sheet, chartTables, 26);

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
      sheet.getRange('A11:J11').merge();
      sheet.getRange('A11').setValue('📋 No visitor data for this date range. Adjust the date filters or start checking in visitors.');
      sheet.getRange('A11').setFontColor(COLORS.bodyText);
      sheet.getRange('A11').setFontSize(11);
      sheet.getRange('A11').setFontStyle('italic');
      sheet.getRange('A11').setHorizontalAlignment('center');
      sheet.getRange('A11').setVerticalAlignment('middle');
    }

    console.log('refreshDashboard: Dashboard refreshed successfully at ' + formattedNow);
    return true;

  } catch (error) {
    console.error('refreshDashboard error: ' + error.message + '\n' + error.stack);
    return false;
  }
}

// ── HELPER: Get Date Range from Dashboard cells ──

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

// ── HELPER: Read All Rows from a Sheet Tab ──

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

// ── COMPUTE: All KPIs from Raw Data ──

function computeKpis_(visitorLog, cardno, dateRange) {
  var totalVisitors = 0;
  var checkedIn = 0;
  var pending = 0;
  var rejected = 0;

  for (var i = 1; i < visitorLog.length; i++) {
    var row = visitorLog[i];
    var ts = row[0];

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
      if (cAssignedAt instanceof Date && !isNaN(cAssignedAt.getTime())) {
        if (cAssignedAt >= dateRange.start && cAssignedAt <= dateRange.end) {
          cardsAssignedToday++;
        }
      } else {
        cardsAssignedToday++;
      }
    }
  }

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

// ── COMPUTE: Trends (vs Same Weekday Last Week) ──

function computeTrends_(visitorLog, cardno, dateRange) {
  var daysDiff = 7;
  var prevStart = new Date(dateRange.start.getTime() - daysDiff * 24 * 60 * 60 * 1000);
  var prevEnd = new Date(dateRange.end.getTime() - daysDiff * 24 * 60 * 60 * 1000);

  var prevRange = { start: prevStart, end: prevEnd };

  var current = computeKpis_(visitorLog, cardno, dateRange);
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

// ── HELPER: Format a Single Trend Value ──

function formatTrend_(current, previous) {
  if (previous === 0) {
    return '—';
  }

  var diff = current - previous;
  var pct = Math.round((diff / previous) * 100);

  if (pct === 0) {
    return '◄ 0%';
  } else if (pct > 0) {
    return '▲ +' + pct + '%';
  } else {
    return '▼ ' + pct + '%';
  }
}

// ── BUILD: Chart Summary Tables ──

function buildChartTables_(visitorLog, cardno, dateRange) {
  // Status Distribution
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

  // Daily Trend (last 7 days)
  var dailyMap = {};
  for (var d = 6; d >= 0; d--) {
    var dateKey = getDateKey_(new Date(dateRange.end.getTime() - d * 24 * 60 * 60 * 1000));
    dailyMap[dateKey] = 0;
  }

  for (var k = 1; k < visitorLog.length; k++) {
    var vRow = visitorLog[k];
    var vTs = vRow[0];
    if (!(vTs instanceof Date) || isNaN(vTs.getTime())) continue;
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

  // Top Destinations (top 5)
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
  for (var q = topDestinations.length; q <= 5; q++) {
    topDestinations.push(['', '']);
  }

  // Card Pool Summary
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

  // Recent Check-Ins (last 5 Checked In)
  var recentCheckins = buildRecentCheckins_(visitorLog, dateRange);

  return {
    statusSummary: statusSummary,
    dailyTrend: dailyTrend,
    topDestinations: topDestinations,
    cardPoolSummary: cardPoolSummary,
    recentCheckins: recentCheckins,
  };
}

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

  checkins.sort(function(a, b) {
    return b.actionTime - a.actionTime;
  });

  var top = checkins.slice(0, 5);

  var table = [['Visitor #', 'Name', 'Company', 'Time']];
  for (var j = 0; j < top.length; j++) {
    var entry = top[j];
    var timeStr = formatDateForDisplay(entry.actionTime);
    table.push([entry.visitorNo, entry.name, entry.company, timeStr]);
  }

  return table;
}

// ── HELPER: Get Date Key (YYYY-MM-DD) ──

function getDateKey_(date) {
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

// ── WRITE: KPI Value to a Card ──

function writeKpiValues_(sheet, kpis, row, col) {
  var valueRow = row;
  var label = '';
  var value = 0;
  var color = COLORS.headings;

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

  sheet.getRange(valueRow, col).setNote(label);
}

// ── HELPER: Context-Aware Trend Color ──

function trendColorClass_(trendStr, kpiType) {
  var negativeKpis = { pending: true, rejected: true };

  if (trendStr.indexOf('▲') >= 0) {
    return negativeKpis.hasOwnProperty(kpiType) ? COLORS.danger : COLORS.success;
  } else if (trendStr.indexOf('▼') >= 0) {
    return negativeKpis.hasOwnProperty(kpiType) ? COLORS.success : COLORS.danger;
  } else if (trendStr.indexOf('◄') >= 0) {
    return COLORS.warning;
  } else {
    return COLORS.bodyText;
  }
}

// ── WRITE: Trend Value to a Card ──

function writeTrendValues_(sheet, trends, row, col) {
  var trendStr = '';
  var kpiType = '';

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

// ── WRITE: Status Distribution Table ──

function writeStatusDistribution_(sheet, chartTables, startRow) {
  var data = chartTables.statusSummary;
  sheet.getRange(startRow, 1).setValue(data[0][0]);
  sheet.getRange(startRow, 2).setValue(data[0][1]);
  sheet.getRange(startRow, 1).setFontWeight('bold');
  sheet.getRange(startRow, 2).setFontWeight('bold');
  sheet.getRange(startRow, 1).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 2).setFontColor(COLORS.headings);

  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 1).setValue(data[i][0]);
    sheet.getRange(rowNum, 2).setValue(data[i][1]);
    sheet.getRange(rowNum, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 2).setFontColor(COLORS.bodyText);
  }

  clearRowsFrom_(sheet, startRow + data.length, 1, 2, startRow + 6);
}

// ── WRITE: Daily Trend Table ──

function writeDailyTrend_(sheet, chartTables, startRow) {
  var data = chartTables.dailyTrend;

  sheet.getRange(startRow, 5).setValue(data[0][0]);
  sheet.getRange(startRow, 6).setValue(data[0][1]);
  sheet.getRange(startRow, 5).setFontWeight('bold');
  sheet.getRange(startRow, 6).setFontWeight('bold');
  sheet.getRange(startRow, 5).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 6).setFontColor(COLORS.headings);

  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 5).setValue(data[i][0]);
    sheet.getRange(rowNum, 6).setValue(data[i][1]);
    sheet.getRange(rowNum, 5).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 6).setFontColor(COLORS.bodyText);
  }

  clearRowsFrom_(sheet, startRow + data.length, 5, 6, startRow + 8);
}

// ── WRITE: Top Destinations Table ──

function writeTopDestinations_(sheet, chartTables, startRow) {
  var data = chartTables.topDestinations;

  sheet.getRange(startRow, 1).setValue(data[0][0]);
  sheet.getRange(startRow, 2).setValue(data[0][1]);
  sheet.getRange(startRow, 1).setFontWeight('bold');
  sheet.getRange(startRow, 2).setFontWeight('bold');
  sheet.getRange(startRow, 1).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 2).setFontColor(COLORS.headings);

  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 1).setValue(data[i][0]);
    sheet.getRange(rowNum, 2).setValue(data[i][1]);
    sheet.getRange(rowNum, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 2).setFontColor(COLORS.bodyText);
  }
}

// ── WRITE: Card Pool Summary Table ──

function writeCardPoolSummary_(sheet, chartTables, startRow) {
  var data = chartTables.cardPoolSummary;

  sheet.getRange(startRow, 5).setValue(data[0][0]);
  sheet.getRange(startRow, 6).setValue(data[0][1]);
  sheet.getRange(startRow, 5).setFontWeight('bold');
  sheet.getRange(startRow, 6).setFontWeight('bold');
  sheet.getRange(startRow, 5).setFontColor(COLORS.headings);
  sheet.getRange(startRow, 6).setFontColor(COLORS.headings);

  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    sheet.getRange(rowNum, 5).setValue(data[i][0]);
    sheet.getRange(rowNum, 6).setValue(data[i][1]);
    sheet.getRange(rowNum, 5).setFontColor(COLORS.bodyText);
    sheet.getRange(rowNum, 6).setFontColor(COLORS.bodyText);
  }
}

// ── WRITE: Recent Check-Ins Mini-List ──

function writeRecentCheckins_(sheet, chartTables, startRow) {
  var data = chartTables.recentCheckins;
  if (!data || data.length < 1) {
    sheet.getRange(startRow, 1).setValue('No recent check-ins');
    sheet.getRange(startRow, 1).setFontColor(COLORS.bodyText);
    sheet.getRange(startRow, 1).setFontSize(10);
    sheet.getRange(startRow, 1).setFontStyle('italic');
    return;
  }

  var headers = ['Visitor #', 'Name', 'Company', 'Time'];
  for (var c = 0; c < headers.length; c++) {
    var headerCell = sheet.getRange(startRow, c + 1);
    headerCell.setValue(headers[c]);
    headerCell.setFontWeight('bold');
    headerCell.setFontColor(COLORS.headings);
    headerCell.setFontSize(10);
    headerCell.setBackground(COLORS.lightGray);
  }

  for (var i = 1; i < data.length; i++) {
    var rowNum = startRow + i;
    for (var j = 0; j < data[i].length; j++) {
      var cell = sheet.getRange(rowNum, j + 1);
      cell.setValue(data[i][j]);
      cell.setFontColor(COLORS.bodyText);
      cell.setFontSize(10);
    }
  }

  for (var r = startRow + data.length; r <= startRow + 5; r++) {
    sheet.getRange(r, 1, 1, 4).clearContent();
  }
}

// ── HELPER: Clear Extra Rows ──

function clearRowsFrom_(sheet, fromRow, col1, col2, maxRow) {
  if (fromRow > maxRow) return;
  for (var r = fromRow; r <= maxRow; r++) {
    for (var c = col1; c <= col2; c++) {
      sheet.getRange(r, c).clearContent();
    }
  }
}

// ──────────────────────────────────────────────
// REPORTS FUNCTIONS (moved from Reports.gs)
// ──────────────────────────────────────────────

// ── SETUP: Report Tab Layout ──

function setupReportLayout(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('Report');

  // Create the Report tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Report');
    sheet.setTabColor(COLORS.primary);
  } else {
    sheet.clear();
  }

  // ROW 1 — Title Bar (merged A1:H1)
  sheet.getRange('A1').setValue('📋 LITEVM · Report');
  sheet.getRange('A1').setFontSize(18);
  sheet.getRange('A1').setFontWeight('bold');
  sheet.getRange('A1').setFontColor(COLORS.headings);
  sheet.getRange('A1:H1').merge();

  // ROW 2 — Date Range Cells
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

  sheet.getRange('E2').setValue('Use menu 📊 LITEVM > Daily Summary or Visitor Log');
  sheet.getRange('E2').setFontSize(9);
  sheet.getRange('E2').setFontColor(COLORS.bodyText);
  sheet.getRange('E2').setFontStyle('italic');
  sheet.getRange('E2:H2').merge();

  // ROW 3 — Blank spacer
  sheet.getRange('A3:H3').setBackground(COLORS.white);

  // Column widths
  sheet.setColumnWidth(1, 20);
  sheet.setColumnWidth(2, 16);
  sheet.setColumnWidth(3, 14);
  sheet.setColumnWidth(4, 16);
  sheet.setColumnWidth(5, 22);
  sheet.setColumnWidth(6, 16);
  sheet.setColumnWidth(7, 16);
  sheet.setColumnWidth(8, 20);

  // Freeze rows
  sheet.setFrozenRows(3);

  // Write placeholder message in row 4
  sheet.getRange('A4').setValue('Generate a report using the 📊 LITEVM menu above.');
  sheet.getRange('A4').setFontColor(COLORS.bodyText);
  sheet.getRange('A4').setFontSize(11);
  sheet.getRange('A4').setFontStyle('italic');
  sheet.getRange('A4:H4').merge();

  console.log('setupReportLayout: Report tab created and layout ready.');
}

// ── HELPER: Get Date Range from Report cells ──

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

// ── GENERATE: Daily Summary ──

function generateDailySummary(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Report');
    if (!sheet) {
      return false;
    }

    // Step 1: Get date range
    var dateRange = getReportDateRange_(sheet);

    // Step 2: Read all source data
    var visitorLog = readSheetData_(ss, 'VisitorLog');
    var cardno = readSheetData_(ss, 'cardno');

    // Step 3: Compute KPIs
    var kpis = computeKpis_(visitorLog, cardno, dateRange);

    // Step 4: Compute trends
    var trends = computeReportTrends_(visitorLog, cardno, dateRange);

    // Step 5: Compute top destinations
    var topDestinations = computeTopDestinations_(visitorLog, dateRange);

    // Step 6: Compute peak hour analysis
    var peakHours = computePeakHours_(visitorLog, dateRange);

    // Step 7: Clear existing content below row 3
    var lastRow = sheet.getLastRow();
    if (lastRow > 3) {
      sheet.getRange(4, 1, lastRow - 3, 8).clearContent();
    }

    // Step 8: Write report content
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

    // Summary KPIs
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
    row = row + 2;

    // Blank spacer
    row++;

    // Top 5 Destinations
    sheet.getRange('A' + row).setValue('Top 5 Destinations');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

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

    // Peak Hour Analysis
    sheet.getRange('A' + row).setValue('Peak Hour Analysis');
    sheet.getRange('A' + row).setFontSize(13);
    sheet.getRange('A' + row).setFontWeight('bold');
    sheet.getRange('A' + row).setFontColor(COLORS.headings);
    sheet.getRange('A' + row + ':H' + row).merge();
    row++;

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

    // Trend vs Last Week
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

    // End of Report marker
    sheet.getRange('A' + row).setValue('— End of Report —');
    sheet.getRange('A' + row).setFontSize(9);
    sheet.getRange('A' + row).setFontColor(COLORS.bodyText);
    sheet.getRange('A' + row).setFontStyle('italic');
    sheet.getRange('A' + row + ':H' + row).merge();

    console.log('generateDailySummary: Daily Summary generated successfully.');
    return true;

  } catch (error) {
    console.error('generateDailySummary error: ' + error.message + '\n' + error.stack);
    return false;
  }
}

// ── GENERATE: Visitor Log Export ──

function generateVisitorLog(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Report');
    if (!sheet) {
      return false;
    }

    // Step 1: Get date range
    var dateRange = getReportDateRange_(sheet);

    // Step 2: Read all source data
    var visitorLog = readSheetData_(ss, 'VisitorLog');

    // Step 3: Filter visitors within date range (NO row cap)
    var filtered = [];
    for (var i = 1; i < visitorLog.length; i++) {
      var row = visitorLog[i];
      var ts = row[0];
      if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
      if (ts < dateRange.start || ts > dateRange.end) continue;
      filtered.push(row);
    }

    // Step 4: Clear existing content below row 3
    var lastRow = sheet.getLastRow();
    if (lastRow > 3) {
      sheet.getRange(4, 1, lastRow - 3, 8).clearContent();
    }

    // Step 5: Write report content
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

    console.log('generateVisitorLog: Visitor Log exported with ' + filtered.length + ' rows.');
    return true;

  } catch (error) {
    console.error('generateVisitorLog error: ' + error.message + '\n' + error.stack);
    return false;
  }
}

// ── COMPUTE: Report Trends (vs Same Weekday Last Week) ──

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

// ── COMPUTE: Top Destinations (top 5) ──

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

// ── COMPUTE: Peak Hour Analysis (24-hour buckets) ──

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

// ── HELPER: Write a Summary KPI Row ──

function writeKpiPair_(sheet, row, col, label, value, trend) {
  var labelCell = sheet.getRange(row, col);
  labelCell.setValue(label + ':');
  labelCell.setFontSize(10);
  labelCell.setFontColor(COLORS.bodyText);
  labelCell.setFontWeight('bold');

  var valCell = sheet.getRange(row, col + 1);
  valCell.setValue(value);
  valCell.setFontSize(12);
  valCell.setFontWeight('bold');
  valCell.setFontColor(COLORS.primary);

  if (trend && trend !== '') {
    var trendCell = sheet.getRange(row, col + 2);
    trendCell.setValue(trend);
    trendCell.setFontSize(9);
    trendCell.setFontColor(COLORS.bodyText);
    trendCell.setFontStyle('italic');
  }
}

// ── HELPER: Format Date Short (dd/mm/yyyy) ──

function formatDateShort(date) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}
