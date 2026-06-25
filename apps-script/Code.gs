/**
 * LITEVM — Google Apps Script Web App (Backend Middleware)
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
 */

// ──────────────────────────────────────────────
// WEB APP ENTRY POINTS
// ──────────────────────────────────────────────

/**
 * Handle GET requests.
 * ?action=lookup&visitorNumber=V-XXXX   → returns visitor data
 * ?action=today                           → returns all today's visitors
 * ?action=destinations                    → returns Destination tab data
 * (no params)                             → health check
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
 * Existing: registration (fullName, idNumber, company, destination, phone, email, idPhoto, selfie)
 * New: mode=updateStatus with visitorNumber and status
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

    // Check if this is a status update
    if (data.mode === 'updateStatus') {
      return handleStatusUpdate(data);
    }

    // Otherwise, handle registration (existing logic)
    return handleRegistration(data);

  } catch (error) {
    console.error('doPost error: ' + error.message + '\n' + error.stack);
    return jsonResponse({ error: error.message, status: 'error' }, 500);
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

  var sheet = getCardnoSheet();
  if (!sheet) {
    // Cardno sheet doesn't exist yet — create it
    var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!sheetId) {
      console.error('seedCardPool: SHEET_ID not configured');
      return;
    }
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
            var cardResult = assignCardForVisitor(visitorNumber, fullName, destination, email);
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
  // If sheetId not provided, try Script Properties
  if (!sheetId) {
    sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  }

  var ss;
  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
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
function getCardnoSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    console.warn('getCardnoSheet: SHEET_ID not configured');
    return null;
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) {
      console.warn('getCardnoSheet: "cardno" sheet tab not found in spreadsheet');
      return null;
    }
    return cardSheet;
  } catch (e) {
    console.warn('getCardnoSheet: Failed to open spreadsheet — ' + e.message);
    return null;
  }
}

/**
 * Look up the Access Level for a given destination from the Destination sheet.
 * @param {string} destination — The visitor's destination (e.g. "BRI", "PLN")
 * @returns {string|null} The Access Level value, or null if not found
 */
function getAccessLevelForDestination(destination) {
  if (!destination) return null;

  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    console.warn('getAccessLevelForDestination: SHEET_ID not configured');
    return null;
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    console.warn('getAccessLevelForDestination: Cannot open spreadsheet — ' + e.message);
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
function pickUnusedCard(accessLevel) {
  var cardSheet = getCardnoSheet();
  if (!cardSheet) return null;

  var data = cardSheet.getDataRange().getValues();

  // Column layout: 0=CardNo, 1=Status, 2=AssignedTo, 3=AssignedAt
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][1] || '').trim();
    if (status === 'Available') {
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
function assignCard(cardNo, visitorNumber, visitorName) {
  var cardSheet = getCardnoSheet();
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
function assignCardForVisitor(visitorNumber, fullName, destination, email) {
  // 1. Resolve access level from the visitor's destination
  var accessLevel = getAccessLevelForDestination(destination);

  // 2. Pick an unused card (access level reserved for future filtering)
  var cardNo = pickUnusedCard(accessLevel);

  if (!cardNo) {
    return { cardNo: null, status: 'depleted' };
  }

  // 3. Mark the card as Assigned
  var assigned = assignCard(cardNo, visitorNumber, fullName);
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
  var cardSheet = getCardnoSheet();
  if (!cardSheet) {
    console.warn('releaseDailyCards: cardno sheet not found — nothing to release');
    return;
  }

  var data = cardSheet.getDataRange().getValues();
  var released = 0;

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][1] || '').trim();
    if (status === 'Assigned') {
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
