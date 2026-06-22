/**
 * LITEVM — Google Apps Script Web App (Backend Middleware)
 *
 * Deploy as a Web App:
 *   1. File > New > Project
 *   2. Paste this code into Code.gs
 *   3. Set script properties:
 *      - SHEET_ID: Google Sheet ID (optional, defaults to active spreadsheet)
 *      - DRIVE_FOLDER_ID: Parent Drive folder ID for VMS uploads
 *      - WHATSAPP_TOKEN: WhatsApp Business API token
 *      - WHATSAPP_PHONE_ID: WhatsApp Business phone number ID
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
 * (no params)                             → health check
 */
function doGet(e) {
  try {
    // Check for action parameter
    if (e && e.parameter && e.parameter.action) {
      var action = e.parameter.action;

      if (action === 'lookup') {
        var visitorNumber = e.parameter.visitorNumber;
        if (!visitorNumber) {
          return jsonResponse({ status: 'notfound', message: 'Missing visitorNumber parameter' }, 400);
        }
        return handleLookup(visitorNumber);
      }

      if (action === 'today') {
        return handleTodayVisitors();
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
 * Existing: registration (fullName, idNumber, company, phone, idPhoto, selfie)
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
// HANDLER: Registration (extracted from existing doPost)
// ──────────────────────────────────────────────

function handleRegistration(data) {
  // Validate required fields
  var required = ['fullName', 'idNumber', 'company', 'phone', 'idPhoto', 'selfie'];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) {
      return jsonResponse({ status: 'error', error: 'Missing required field: ' + required[i] }, 400);
    }
  }

  // Sanitize text fields
  var fullName = sanitizeText(data.fullName);
  var idNumber = sanitizeText(data.idNumber);
  var company = sanitizeText(data.company);
  var phone = sanitizePhone(data.phone);

  // Create Drive folder: VMS/YYYY-MM-DD/VisitorName_Phone/
  var folder = createVisitorFolder(fullName, phone);

  // Upload photos to Drive
  var idPhotoUrl = uploadBase64ToDrive(folder, 'id_photo.jpg', data.idPhoto);
  var selfieUrl = uploadBase64ToDrive(folder, 'selfie.jpg', data.selfie);

  // Generate visitor number (server-side, sequential per day)
  var visitorNumber = generateVisitorNumber();

  // Write to Google Sheet
  var sheet = getOrCreateSheet();
  sheet.appendRow([
    new Date(),            // Timestamp
    fullName,              // Full Name
    idNumber,              // ID / Passport Number
    company,               // Company Name
    phone,                 // Hand Phone Number
    idPhotoUrl,            // ID Photo (Drive URL)
    selfieUrl,             // Selfie (Drive URL)
    visitorNumber,         // Visitor Number
    'Pending Entry'        // Status
  ]);

  // Send WhatsApp notification (non-blocking — catch errors)
  try {
    sendWhatsAppNotification(phone, visitorNumber, fullName);
  } catch (waErr) {
    console.warn('WhatsApp notification failed: ' + waErr.message);
  }

  return jsonResponse({ visitorNumber: visitorNumber, status: 'ok' }, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Lookup by Visitor Number
// ──────────────────────────────────────────────

function handleLookup(visitorNumber) {
  var sheet = getOrCreateSheet();
  var data = sheet.getDataRange().getValues();

  // Headers are in row 1 (index 0). Data starts at row 2 (index 1).
  // Columns: 0=Timestamp, 1=Full Name, 2=ID/Passport, 3=Company, 4=Phone,
  //          5=ID Photo URL, 6=Selfie URL, 7=Visitor Number, 8=Status

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var vn = String(row[7] || '').trim();

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
        phone: String(row[4] || ''),
        idPhotoUrl: String(row[5] || ''),
        selfieUrl: String(row[6] || ''),
        status: String(row[8] || 'Pending Entry'),
        registrationTime: registrationTime,
      };

      return jsonResponse({ status: 'ok', visitor: visitor }, 200);
    }
  }

  return jsonResponse({ status: 'notfound', message: 'No registration found for ' + visitorNumber }, 404);
}

// ──────────────────────────────────────────────
// HANDLER: Today's Visitors
// ──────────────────────────────────────────────

function handleTodayVisitors() {
  var sheet = getOrCreateSheet();
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
        visitorNumber: String(row[7] || ''),
        fullName: String(row[1] || ''),
        idNumber: String(row[2] || ''),
        company: String(row[3] || ''),
        phone: String(row[4] || ''),
        idPhotoUrl: String(row[5] || ''),
        selfieUrl: String(row[6] || ''),
        status: String(row[8] || 'Pending Entry'),
        registrationTime: formatDateForDisplay(ts),
      });
    }
  }

  return jsonResponse({ status: 'ok', visitors: visitors }, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Update Visitor Status
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

  var sheet = getOrCreateSheet();
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  for (var i = 1; i < values.length; i++) {
    var vn = String(values[i][7] || '').trim();

    if (vn === visitorNumber.trim()) {
      // Update Status column (col 9 = index 8)
      sheet.getRange(i + 1, 9).setValue(newStatus);
      // Update Timestamp column (col 1 = index 0) to record action time
      sheet.getRange(i + 1, 1).setValue(new Date());

      return jsonResponse({
        status: 'ok',
        message: 'Status updated to ' + newStatus,
        visitorNumber: visitorNumber,
      }, 200);
    }
  }

  return jsonResponse({ status: 'notfound', message: 'Visitor number not found: ' + visitorNumber }, 404);
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

function getOrCreateSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
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
    'Hand Phone',
    'ID Photo (Drive URL)',
    'Selfie (Drive URL)',
    'Visitor Number',
    'Status'
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
// WHATSAPP NOTIFICATION
// ──────────────────────────────────────────────

/**
 * Send a WhatsApp notification via WhatsApp Business Cloud API.
 * Uses script properties: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
 */
function sendWhatsAppNotification(phone, visitorNumber, fullName) {
  var token = PropertiesService.getScriptProperties().getProperty('WHATSAPP_TOKEN');
  var phoneId = PropertiesService.getScriptProperties().getProperty('WHATSAPP_PHONE_ID');

  if (!token || !phoneId) {
    console.log('WhatsApp not configured. Skipping notification.');
    console.log('Would send to ' + phone + ': Visitor number ' + visitorNumber + ' for ' + fullName);
    return;
  }

  // Clean phone number: remove non-digits, ensure it starts with country code
  var cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) {
    throw new Error('Invalid phone number format');
  }

  var url = 'https://graph.facebook.com/v18.0/' + phoneId + '/messages';

  var messageData = {
    messaging_product: 'whatsapp',
    to: cleanPhone,
    type: 'template',
    template: {
      name: 'visitor_registration_confirmation',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: fullName },
            { type: 'text', text: visitorNumber }
          ]
        }
      ]
    }
  };

  // If template not yet created, send a text message as fallback
  var textMessage = {
    messaging_product: 'whatsapp',
    to: cleanPhone,
    type: 'text',
    text: {
      body: 'Hi ' + fullName + ',\n\nYour visitor registration is confirmed!\n\nVisitor Number: ' + visitorNumber + '\n\nPlease show this number at the guard house for entry.\n\nThank you.'
    }
  };

  var payload = messageData;

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var responseCode = response.getResponseCode();
    if (responseCode >= 200 && responseCode < 300) {
      console.log('WhatsApp notification sent to ' + cleanPhone);
    } else {
      // If template fails, try text fallback
      console.warn('WhatsApp template failed (code ' + responseCode + '), trying text fallback...');
      try {
        var fallbackResponse = UrlFetchApp.fetch(url, {
          method: 'post',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          payload: JSON.stringify(textMessage),
          muteHttpExceptions: true,
        });
        console.log('WhatsApp text fallback sent to ' + cleanPhone + ': ' + fallbackResponse.getResponseCode());
      } catch (fallbackErr) {
        console.warn('WhatsApp text fallback also failed: ' + fallbackErr.message);
      }
    }
  } catch (fetchErr) {
    throw new Error('WhatsApp API call failed: ' + fetchErr.message);
  }
}

// ──────────────────────────────────────────────
// SANITIZATION HELPERS
// ──────────────────────────────────────────────

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
  console.log('  WHATSAPP_TOKEN - WhatsApp Business API token');
  console.log('  WHATSAPP_PHONE_ID - WhatsApp Business phone number ID');

  return 'Initialization complete. Check the logs for details.';
}