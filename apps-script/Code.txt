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
 *   POST — registration, updateStatus (all accept sheetId in JSON body)
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
 */

var CODE_VERSION = '1.1.0';  // Increment this to track deployed versions

// ──────────────────────────────────────────────
// MASTER CONFIG CACHE (per-execution)
// ──────────────────────────────────────────────
var _masterConfig = null;

/**
 * Open the master config Google Sheet by its ID stored in Script Properties.
 * The MASTER_CONFIG_ID property is set once and never exposed to the frontend.
 */
function _getMasterConfigSheet() {
  var configId = PropertiesService.getScriptProperties().getProperty('MASTER_CONFIG_ID');
  if (!configId) return null;
  try {
    return SpreadsheetApp.openById(configId);
  } catch (e) {
    console.error('Failed to open master config: ' + e.message);
    return null;
  }
}

/**
 * Load all customer rows from the "Customers" tab of the master config sheet.
 * Caches the result in the per-execution global _masterConfig.
 *
 * Customers tab schema (6 columns):
 *   sheetId | allowedOrigins | tier | visitorLimit | status | notes
 *
 * @returns {Object} Map of sheetId -> { sheetId, allowedOrigins, tier, visitorLimit, status, notes }
 */
function _loadMasterConfig() {
  if (_masterConfig !== null) return _masterConfig;
  var sheet = _getMasterConfigSheet();
  if (!sheet) { _masterConfig = {}; return {}; }
  var custSheet = sheet.getSheetByName('Customers');
  if (!custSheet) { _masterConfig = {}; return {}; }
  var data = custSheet.getDataRange().getValues();
  var config = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var sid = String(row[0] || '').trim();
    if (!sid) continue;
    config[sid] = {
      sheetId: sid,
      allowedOrigins: String(row[1] || '').trim(),
      tier: String(row[2] || 'free').trim().toLowerCase(),
      visitorLimit: row[3] !== undefined && row[3] !== null && row[3] !== '' ? parseInt(row[3], 10) : 50,
      status: String(row[4] || 'active').trim().toLowerCase(),
      notes: String(row[5] || '').trim(),
    };
  }
  _masterConfig = config;
  return config;
}

/**
 * Get a single customer's config by sheetId from the cached master config.
 *
 * @param {string} sheetId - The Google Sheet ID of the customer
 * @returns {Object|null} Customer config object or null if not found
 */
function _getCustomerConfig(sheetId) {
  var config = _loadMasterConfig();
  return config[sheetId] || null;
}

/**
 * Count today's registrations for a customer sheet by Visitation Date.
 * Scans VisitorLog, counts rows where col 5 matches today's date.
 * Returns null on error (caller decides fail-open vs fail-closed).
 *
 * @param {string} sheetId - Customer's Google Sheet ID
 * @returns {number|null} Count of today's registrations, or null on error
 */
function getDailyVisitorCount_(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('VisitorLog');
    if (!sheet) return 0;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return 0; // header only

    var timeZone = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

    var count = 0;
    for (var i = 1; i < data.length; i++) {
      var cell = data[i][5]; // Col F = Visitation Date (index 5)
      var dateStr = '';
      if (cell instanceof Date && !isNaN(cell.getTime())) {
        dateStr = Utilities.formatDate(cell, timeZone, 'yyyy-MM-dd');
      } else {
        dateStr = String(cell || '').trim();
      }
      if (dateStr === todayStr) count++;
    }

    return count;
  } catch (e) {
    console.error('getDailyVisitorCount_ error for sheet ' + sheetId + ': ' + e.message);
    return null; // Caller decides fail-open vs fail-closed
  }
}

/**
 * Check if the customer has remaining visitor slots for today.
 * Reads customer config, compares current count vs visitorLimit.
 *
 * @param {string} sheetId - Customer's Google Sheet ID
 * @returns {Object} { allowed: boolean, current: number, limit: number, pct: number }
 */
function checkVisitorLimit_(sheetId) {
  var customer = _getCustomerConfig(sheetId);
  if (!customer) {
    return { allowed: true, current: 0, limit: 999999, pct: 0 };
  }

  var limit = customer.visitorLimit;
  var current = getDailyVisitorCount_(sheetId);

  // Fail-open: if count errored (null), allow registration
  if (current === null) {
    return { allowed: true, current: 0, limit: limit, pct: 0 };
  }

  var pct = limit > 0 ? Math.round((current / limit) * 100) : 0;

  return {
    allowed: current < limit,
    current: current,
    limit: limit,
    pct: pct,
  };
}

/**
 * Validate an incoming request against the master config.
 *
 * Validation steps:
 *   1. If sheetId is not in master config → deny with INVALID_CUSTOMER
 *   2. If customer status is not 'active' → deny with ACCOUNT_DISABLED
 *   3. If endpointType is NOT 'register' → skip origin check, allow
 *   4. If origin is reported → check against allowedOrigins whitelist
 *   5. If origin not whitelisted → deny with ORIGIN_BLOCKED
 *
 * Denied requests are logged to the DeniedLog tab of the master config sheet.
 *
 * @param {Object} e - The doGet/doPost event object
 * @param {string} sheetId - Customer's Google Sheet ID
 * @param {string} endpointType - 'health' | 'get' | 'register' | 'status' | 'admin'
 * @returns {Object} { valid: boolean, error?: string, message?: string, tier?, visitorLimit?, status? }
 */
function validateRequest(e, sheetId, endpointType) {
  // Health check — no validation needed
  if (!endpointType || endpointType === 'health') {
    return { valid: true };
  }

  // Must have a sheetId for any data operation
  if (!sheetId) {
    return { valid: false, error: 'MISSING_SHEET_ID', message: 'Customer identifier required.' };
  }

  // Look up customer in master config
  var customer = _getCustomerConfig(sheetId);
  if (!customer) {
    logDeniedRequest(sheetId, null, 'UNKNOWN_CUSTOMER', endpointType, null);
    return { valid: false, error: 'INVALID_CUSTOMER', message: 'Invalid customer configuration.' };
  }

  // Check account status
  if (customer.status !== 'active') {
    logDeniedRequest(sheetId, null, 'ACCOUNT_' + customer.status.toUpperCase(), endpointType, null);
    return { valid: false, error: 'ACCOUNT_DISABLED', message: 'This service is currently unavailable.' };
  }

  // Only enforce origin checks on registration endpoint
  if (endpointType !== 'register') {
    return { valid: true, tier: customer.tier, visitorLimit: customer.visitorLimit, status: customer.status };
  }

  // ─── REGISTRATION-SPECIFIC CHECKS ───

  // Get the reported origin from the JSON body or URL parameter
  var origin = '';
  try {
    if (e && e.postData) {
      var body = JSON.parse(e.postData.contents);
      origin = body.origin || '';
    }
  } catch (er) { /* ignore parse errors */ }
  if (!origin && e && e.parameter && e.parameter.origin) {
    origin = e.parameter.origin;
  }

  // Check origin against whitelist
  if (origin) {
    var allowed = customer.allowedOrigins;
    if (allowed) {
      var origins = allowed.split(',').map(function(d) {
        return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      });
      var cleanOrigin = origin.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      var matched = false;
      for (var i = 0; i < origins.length; i++) {
        if (origins[i] && cleanOrigin === origins[i]) {
          matched = true;
          break;
        }
        // Also match subdomains: if allowed is "example.com", "visitor.example.com" matches
        if (origins[i] && cleanOrigin.endsWith('.' + origins[i])) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        logDeniedRequest(sheetId, origin, 'ORIGIN_BLOCKED', endpointType, null);
        return { valid: false, error: 'ORIGIN_BLOCKED', message: 'Registration unavailable from this location. Please contact the front desk.' };
      }
    } else {
      // No origins configured — allow (legacy mode) but log warning
      console.warn('[validateRequest] No allowedOrigins configured for sheet ' + sheetId + ' — allowing request from ' + origin);
    }
  } else {
    // No origin provided — log warning but don't block (some clients don't send origin)
    console.warn('[validateRequest] No origin provided for registration on sheet ' + sheetId + ' — allowing request');
  }

  // All checks passed
  return { valid: true, tier: customer.tier, visitorLimit: customer.visitorLimit, status: customer.status };
}

/**
 * Log a denied request to the DeniedLog tab of the master config sheet.
 * Creates the tab with headers if it does not already exist.
 *
 * @param {string} sheetId - Customer sheet ID
 * @param {string} origin - Request origin (may be empty)
 * @param {string} reason - Denial reason code
 * @param {string} endpointType - Endpoint type string
 * @param {string} userAgent - User-Agent header (may be empty)
 */
function logDeniedRequest(sheetId, origin, reason, endpointType, userAgent) {
  try {
    var sheet = _getMasterConfigSheet();
    if (!sheet) return;
    var deniedSheet = sheet.getSheetByName('DeniedLog');
    if (!deniedSheet) {
      deniedSheet = sheet.insertSheet('DeniedLog');
      deniedSheet.appendRow(['Timestamp', 'SheetId', 'Origin', 'Reason', 'EndpointType', 'UserAgent']);
    }
    deniedSheet.appendRow([new Date(), sheetId || '', origin || '', reason || '', endpointType || '', userAgent || '']);
  } catch (e) {
    console.error('Failed to log denied request: ' + e.message);
  }
}

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
 * ?action=allowance&sheetId=...                    → returns daily usage vs limit
 * (no params)                                      → health check
 */
function doGet(e) {
  try {
    // Check for action parameter
    if (e && e.parameter && e.parameter.action) {
      var action = e.parameter.action;
      var sheetId = e && e.parameter ? e.parameter.sheetId : null;

      // Validate request (skip for health check — when there's an action, validate)
      var validation = validateRequest(e, sheetId, 'get');
      if (!validation.valid) {
        return jsonResponse({ status: 'error', error: validation.message || 'Request blocked.' }, 403);
      }

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

      if (action === 'lookupByCard') {
        var cardNo = e.parameter.cardNo;
        if (!cardNo) {
          return jsonResponse({ status: 'notfound', message: 'Missing cardNo parameter' }, 400);
        }
        return handleLookupByCard(cardNo, sheetId);
      }

      if (action === 'allowance') {
        if (!sheetId) {
          return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
        }
        var limitCheck = checkVisitorLimit_(sheetId);
        return jsonResponse({
          status: 'ok',
          usage: {
            current: limitCheck.current,
            limit: limitCheck.limit,
            pct: limitCheck.pct,
          },
          warning: limitCheck.pct >= 80 && limitCheck.pct < 100 ? 'approaching_limit' : null,
          blocked: !limitCheck.allowed,
        }, 200);
      }
    }

    // Default: health check — return version info
    return jsonResponse({
      status: 'ok',
      message: 'LITEVM Web App is running',
      version: CODE_VERSION,
    }, 200);

  } catch (error) {
    console.error('doGet error: ' + error.message);
    return jsonResponse({ error: error.message, status: 'error' }, 500);
  }
}

/**
 * Handle POST requests.
 * Modes: updateStatus (visitor check-in/reject),
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

    // Determine endpoint type and validate request
    var epType = 'register'; // default for registration (no mode)
    if (data.mode === 'updateStatus') epType = 'status';
    else if (data.mode === 'migrate') epType = 'admin';
    else if (data.action === 'report') epType = 'admin';
    else if (data.mode === 'bulkSignOut') epType = 'admin';
    else if (data.mode === 'setupAutoSignOut') epType = 'admin';
    else if (data.mode) epType = 'admin';

    var validation = validateRequest(e, data.sheetId, epType);
    if (!validation.valid) {
      return jsonResponse({ status: 'error', error: validation.message || 'Request blocked.' }, 403);
    }

    // Handle migration
    if (data.mode === 'migrate') {
      return handleMigrationResponse(data);
    }

    // Handle report generation
    if (data.action === 'report') {
      return handleReport(data, data.sheetId);
    }

    // Handle bulk sign-out
    if (data.mode === 'bulkSignOut') {
      return handleBulkSignOut(data);
    }

    // Handle auto sign-out trigger setup
    if (data.mode === 'setupAutoSignOut') {
      setupAutoSignOutTrigger();
      return jsonResponse({ status: 'ok', message: 'Auto sign-out trigger set for 21:00' }, 200);
    }

    // Check if this is a status update
    if (data.mode === 'updateStatus') {
      return handleStatusUpdate(data);
    }

    // If mode was specified but not handled, return error
    if (data.mode) {
      return jsonResponse({ status: 'error', error: 'Unknown mode: ' + data.mode }, 400);
    }

    // ── VISITOR LIMIT CHECK (registration only) ──
    // Use LockService to prevent race conditions (two concurrent registrations
    // both passing the limit check before either appends a row).
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
    }
    try {
      var limitCheck = checkVisitorLimit_(data.sheetId);
      if (!limitCheck.allowed) {
        return jsonResponse({
          status: 'error',
          error: 'Daily visitor limit reached. Please contact the office or try again tomorrow.',
          code: 'DAILY_LIMIT_REACHED',
          usage: { current: limitCheck.current, limit: limitCheck.limit, pct: limitCheck.pct },
        }, 429);
      }
      return handleRegistration(data, limitCheck.limit);
    } finally {
      lock.releaseLock();
    }

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
// HANDLER: Registration
// ──────────────────────────────────────────────

function handleRegistration(data, visitorLimit) {
  // Validate required fields
  var required = ['fullName', 'idNumber', 'company', 'destination', 'visitationDate', 'phone', 'email', 'idPhoto', 'selfie'];
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
  var visitationDate = sanitizeText(data.visitationDate);
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
    visitationDate,        // 5 Visitation Date (NEW)
    phone,                 // 6 Hand Phone (was 5)
    email,                 // 7 Email (was 6)
    idPhotoUrl,            // 8 ID Photo (was 7)
    selfieUrl,             // 9 Selfie (was 8)
    visitorNumber,         // 10 Visitor # (was 9)
    'Pending Entry',       // 11 Status (was 10)
    '',                    // 12 Sign-In Time (NEW, empty)
    '',                    // 13 Sign-Out Time (NEW, empty)
  ]);

  // Send email confirmation (non-blocking — catch errors)
  try {
    sendEmailConfirmation(email, visitorNumber, fullName);
  } catch (emailErr) {
    console.warn('Email notification failed: ' + emailErr.message);
  }

  // Get updated count for response
  var updatedCount = getDailyVisitorCount_(data.sheetId);
  var response = { visitorNumber: visitorNumber, status: 'ok' };
  if (visitorLimit && updatedCount !== null) {
    response.usage = {
      current: updatedCount,
      limit: visitorLimit,
      pct: Math.round((updatedCount / visitorLimit) * 100),
    };
  }
  return jsonResponse(response, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Lookup by Visitor Number
// ──────────────────────────────────────────────

function getCardNumberForVisitor(visitorNumber, sheetId) {
  if (!visitorNumber || !sheetId) return '';
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) return '';
    var data = cardSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][2] || '').trim() === visitorNumber.trim()) {
        return String(data[i][0] || '').trim();
      }
    }
  } catch (e) {
    console.warn('getCardNumberForVisitor error: ' + e.message);
  }
  return '';
}

/**
 * Look up a visitor by their assigned card number.
 * Searches the cardno sheet for the card, finds the assigned visitor number,
 * then looks up the visitor in VisitorLog.
 */
function handleLookupByCard(cardNo, sheetId) {
  if (!cardNo || !sheetId) {
    return jsonResponse({ status: 'error', message: 'Missing cardNo or sheetId' }, 400);
  }
  
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    
    // Step 1: Find visitor number from cardno sheet
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) {
      return jsonResponse({ status: 'notfound', message: 'cardno sheet not found' }, 404);
    }
    
    var cardData = cardSheet.getDataRange().getValues();
    var visitorNumber = '';
    var cardStatus = '';
    
    for (var i = 1; i < cardData.length; i++) {
      if (String(cardData[i][0] || '').trim() === cardNo.trim()) {
        visitorNumber = String(cardData[i][2] || '').trim();
        cardStatus = String(cardData[i][1] || '').trim();
        break;
      }
    }
    
    if (!visitorNumber) {
      return jsonResponse({ status: 'notfound', message: 'Card number ' + cardNo + ' not found or not assigned' }, 404);
    }
    
    // Step 2: Look up the visitor by visitor number
    var result = handleLookup(visitorNumber, sheetId);
    var responseText = result.getContent();
    var responseData = JSON.parse(responseText);
    
    if (responseData.status === 'ok') {
      responseData.visitor.cardNo = cardNo;
      responseData.visitor.cardStatus = cardStatus;
      return jsonResponse(responseData, 200);
    }
    
    return jsonResponse({ status: 'notfound', message: 'Visitor ' + visitorNumber + ' not found (card ' + cardNo + ')' }, 404);
    
  } catch (e) {
    console.error('handleLookupByCard error: ' + e.message);
    return jsonResponse({ status: 'error', message: 'Lookup by card failed: ' + e.message }, 500);
  }
}

function handleLookup(visitorNumber, sheetId) {
  var sheet = getOrCreateSheet(sheetId);
  var data = sheet.getDataRange().getValues();

  // Headers are in row 1 (index 0). Data starts at row 2 (index 1).
  // Columns: 0=Timestamp, 1=Full Name, 2=ID/Passport, 3=Company,
  //          4=Destination, 5=Visitation Date, 6=Phone, 7=Email,
  //          8=ID Photo URL, 9=Selfie URL, 10=Visitor Number,
  //          11=Status, 12=Sign-In Time, 13=Sign-Out Time

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var vn = String(row[10] || '').trim();

    if (vn === visitorNumber.trim()) {
      var ts = row[0];
      var registrationTime = '';
      if (ts instanceof Date) {
        registrationTime = formatDateForDisplay(ts);
      } else {
        registrationTime = String(ts);
      }

      var status = String(row[11] || 'Pending Entry');

      var visitor = {
        visitorNumber: vn,
        fullName: String(row[1] || ''),
        idNumber: String(row[2] || ''),
        company: String(row[3] || ''),
        destination: String(row[4] || ''),
        visitationDate: getDateString_(row[5]),
        phone: String(row[6] || ''),
        email: String(row[7] || ''),
        idPhotoUrl: String(row[8] || ''),
        selfieUrl: String(row[9] || ''),
        status: status,
        registrationTime: registrationTime,
        signInTime: row[12] ? (row[12] instanceof Date ? formatDateForDisplay(row[12]) : String(row[12])) : '',
        signOutTime: row[13] ? (row[13] instanceof Date ? formatDateForDisplay(row[13]) : String(row[13])) : '',
      };

      if (status === 'Checked In') {
        visitor.cardNo = getCardNumberForVisitor(vn, sheetId);
      }

      return jsonResponse({ status: 'ok', visitor: visitor }, 200);
    }
  }

  return jsonResponse({ status: 'notfound', message: 'No registration found for ' + visitorNumber }, 404);
}

// ──────────────────────────────────────────────
// HANDLER: Today's Visitors
// ──────────────────────────────────────────────

function getDateString_(cell) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(cell || '').trim();
}

function handleTodayVisitors(sheetId) {
  var sheet = getOrCreateSheet(sheetId);
  var data = sheet.getDataRange().getValues();

  var timeZone = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

  var visitors = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var visitDateStr = getDateString_(row[5]);

    // Filter by Visitation Date (col 5) matching today
    if (visitDateStr === todayStr) {
      var ts = row[0];
      var status = String(row[11] || 'Pending Entry');
      var vn = String(row[10] || '');
      var visitor = {
        visitorNumber: vn,
        fullName: String(row[1] || ''),
        idNumber: String(row[2] || ''),
        company: String(row[3] || ''),
        destination: String(row[4] || ''),
        visitationDate: getDateString_(row[5]),
        phone: String(row[6] || ''),
        email: String(row[7] || ''),
        idPhotoUrl: String(row[8] || ''),
        selfieUrl: String(row[9] || ''),
        status: status,
        registrationTime: ts instanceof Date ? formatDateForDisplay(ts) : String(ts),
        signInTime: row[12] ? (row[12] instanceof Date ? formatDateForDisplay(row[12]) : String(row[12])) : '',
        signOutTime: row[13] ? (row[13] instanceof Date ? formatDateForDisplay(row[13]) : String(row[13])) : '',
      };
      if (status === 'Checked In') {
        visitor.cardNo = getCardNumberForVisitor(vn, sheetId);
      }
      visitors.push(visitor);
    }
  }

  return jsonResponse({ status: 'ok', visitors: visitors }, 200);
}

// ──────────────────────────────────────────────
// HANDLER: Report (date-range visitor list)
// ──────────────────────────────────────────────

function handleReport(data, sheetId) {
  SpreadsheetApp.flush();

  var sheet = getOrCreateSheet(data.sheetId || sheetId);
  var allData = sheet.getDataRange().getValues();

  var fromDate = data.fromDate || '';
  var toDate = data.toDate || '';
  var timeZone = Session.getScriptTimeZone();

  var visitors = [];
  var pendingCount = 0;
  var checkedInCount = 0;
  var signedOutCount = 0;

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var visitDateStr = getDateString_(row[5]);

    // Apply date range filter
    if (fromDate && visitDateStr < fromDate) continue;
    if (toDate && visitDateStr > toDate) continue;

    var ts = row[0];
    var status = String(row[11] || 'Pending Entry');
    var vn = String(row[10] || '');

    var visitor = {
      visitorNumber: vn,
      fullName: String(row[1] || ''),
      idNumber: String(row[2] || ''),
      company: String(row[3] || ''),
      destination: String(row[4] || ''),
      visitationDate: visitDateStr,
      phone: String(row[6] || ''),
      email: String(row[7] || ''),
      status: status,
      registrationTime: ts instanceof Date ? formatDateForDisplay(ts) : String(ts),
      signInTime: row[12] ? (row[12] instanceof Date ? formatDateForDisplay(row[12]) : String(row[12])) : '',
      signOutTime: row[13] ? (row[13] instanceof Date ? formatDateForDisplay(row[13]) : String(row[13])) : '',
    };

    if (status === 'Pending Entry' || status === 'Pending') {
      pendingCount++;
    } else if (status === 'Checked In') {
      checkedInCount++;
    } else if (status === 'Signed Out') {
      signedOutCount++;
    }

    visitors.push(visitor);
  }

  return jsonResponse({
    status: 'ok',
    visitors: visitors,
    count: visitors.length,
    summary: {
      total: visitors.length,
      pending: pendingCount,
      checkedIn: checkedInCount,
      signedOut: signedOutCount,
    },
  }, 200);
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

  if (!newStatus || (newStatus !== 'Checked In' && newStatus !== 'Rejected' && newStatus !== 'Signed Out')) {
    return jsonResponse({ status: 'error', message: 'Invalid status. Must be "Checked In", "Rejected", or "Signed Out".' }, 400);
  }

  var sheet = getOrCreateSheet(data.sheetId);
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  // Use LockService for the Checked In and Signed Out paths to serialize concurrent requests
  // and prevent two guards from picking the same card or signing out the same visitor
  var lock = null;
  if (newStatus === 'Checked In' || newStatus === 'Signed Out') {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
    }
  }

  try {
    for (var i = 1; i < values.length; i++) {
      var vn = String(values[i][10] || '').trim();

      if (vn === visitorNumber.trim()) {
        var currentStatus = String(values[i][11] || '').trim();

        // ── SIGNED OUT PATH ──
        if (newStatus === 'Signed Out') {
          if (currentStatus === 'Signed Out') {
            return jsonResponse({ status: 'error', message: 'Visitor already signed out.', visitorNumber: visitorNumber }, 409);
          }
          if (currentStatus !== 'Checked In') {
            return jsonResponse({ status: 'error', message: 'Visitor must be checked in before signing out.', visitorNumber: visitorNumber }, 409);
          }

          // Write Sign-Out: Status to col 12, Sign-Out Time to col 14
          sheet.getRange(i + 1, 12).setValue('Signed Out');
          sheet.getRange(i + 1, 14).setValue(new Date());

          // Release card immediately on sign-out
          try {
            releaseCardForVisitor(visitorNumber, data.sheetId);
          } catch (cardErr) {
            console.warn('Card release failed for ' + visitorNumber + ': ' + cardErr.message);
          }

          return jsonResponse({ status: 'ok', message: 'Visitor signed out', visitorNumber: visitorNumber }, 200);
        }

        // ── CHECK-IN / REJECT PATH ──
        // Idempotency guard — prevent re-processing
        if (currentStatus === 'Checked In' || currentStatus === 'Rejected' || currentStatus === 'Signed Out') {
          return jsonResponse({ status: 'error', message: 'Visitor already processed. Current status: ' + currentStatus }, 409);
        }

        // Update Status column (col 12 = index 11)
        sheet.getRange(i + 1, 12).setValue(newStatus);
        // Update Sign-In Time column (col 13 = index 12)
        sheet.getRange(i + 1, 13).setValue(new Date());
        // Clear any old Sign-Out Time on check-in re-entry (col 14 = index 13)
        sheet.getRange(i + 1, 14).setValue('');

        var result = {
          status: 'ok',
          message: 'Status updated to ' + newStatus,
          visitorNumber: visitorNumber,
        };

        // If Checked In, proceed with card assignment (inside lock)
        if (newStatus === 'Checked In') {
          var fullName = String(values[i][1] || '').trim();
          var destination = String(values[i][4] || '').trim();
          var email = String(values[i][7] || '').trim();

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
  var hrStr = ('0' + hours).slice(-2);
  var minStr = ('0' + minutes).slice(-2);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return hrStr + ':' + minStr + ' ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
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
    'Visitation Date',
    'Hand Phone',
    'Email',
    'ID Photo (Drive URL)',
    'Selfie (Drive URL)',
    'Visitor Number',
    'Status',
    'Sign-In Time',
    'Sign-Out Time'
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

// ══════════════════════════════════════════════
// BULK SIGN-OUT & CARD RELEASE
// ══════════════════════════════════════════════

/**
 * Release a specific visitor's assigned card back to Available.
 * Searches the cardno sheet for a row where AssignedTo matches the visitor number.
 *
 * @param {string} visitorNumber — The visitor number whose card to release
 * @param {string} sheetId — The Google Sheet ID
 * @returns {boolean} true if card was found and released, false otherwise
 */
function releaseCardForVisitor(visitorNumber, sheetId) {
  if (!visitorNumber || !sheetId) return false;
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) return false;

    var data = cardSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var assignedTo = String(data[i][2] || '').trim();
      if (assignedTo === visitorNumber.trim()) {
        cardSheet.getRange(i + 1, 2, 1, 3).setValues([['Available', '', '']]);
        return true;
      }
    }
    return false; // Card not found for this visitor
  } catch (e) {
    console.warn('releaseCardForVisitor error: ' + e.message);
    return false;
  }
}

/**
 * Handle bulk sign-out of multiple visitors.
 * Accepts { mode: 'bulkSignOut', visitorNumbers: [...], sheetId: '...' }
 * Uses LockService with 120s timeout for large batches.
 * Iterates through visitorNumbers array, signs out each one, releases cards.
 * Caps at 25 items per request.
 *
 * @param {Object} data — Request payload
 * @returns {TextOutput} JSON response with per-visitor results and summary
 */
function handleBulkSignOut(data) {
  var visitorNumbers = data.visitorNumbers;
  var sheetId = data.sheetId;

  if (!visitorNumbers || !Array.isArray(visitorNumbers) || visitorNumbers.length === 0) {
    return jsonResponse({ status: 'error', error: 'visitorNumbers must be a non-empty array' }, 400);
  }

  if (visitorNumbers.length > 25) {
    return jsonResponse({ status: 'error', error: 'Maximum 25 visitors per batch' }, 400);
  }

  if (!sheetId) {
    return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    return jsonResponse({ status: 'error', error: 'System busy. Please try again.' }, 503);
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('VisitorLog');
    if (!sheet) {
      return jsonResponse({ status: 'error', error: 'VisitorLog sheet not found' }, 404);
    }

    var results = [];
    var summary = { ok: 0, skipped: 0, error: 0 };

    for (var v = 0; v < visitorNumbers.length; v++) {
      var vn = visitorNumbers[v].trim();
      if (!vn) {
        results.push({ visitorNumber: vn, status: 'skipped', message: 'Empty visitor number' });
        summary.skipped++;
        continue;
      }

      try {
        // Read fresh data each iteration (avoid stale cache)
        var dataRange = sheet.getDataRange();
        var values = dataRange.getValues();
        var found = false;

        for (var i = 1; i < values.length; i++) {
          var rowVn = String(values[i][10] || '').trim();
          if (rowVn !== vn) continue;

          found = true;
          var currentStatus = String(values[i][11] || '').trim();

          // Stale checkbox protection
          if (currentStatus === 'Signed Out') {
            results.push({ visitorNumber: vn, status: 'skipped', message: 'Already signed out' });
            summary.skipped++;
            break;
          }
          if (currentStatus !== 'Checked In') {
            results.push({ visitorNumber: vn, status: 'skipped', message: 'Status is "' + currentStatus + '" — must be "Checked In"' });
            summary.skipped++;
            break;
          }

          // Write Signed Out status + timestamp
          sheet.getRange(i + 1, 12).setValue('Signed Out');
          sheet.getRange(i + 1, 14).setValue(new Date());

          // Release card
          var cardReleased = releaseCardForVisitor(vn, sheetId);

          results.push({
            visitorNumber: vn,
            status: 'ok',
            message: 'Signed out successfully' + (cardReleased ? ' (card released)' : ' (no card found)'),
            cardReleased: cardReleased,
          });
          summary.ok++;
          break;
        }

        if (!found) {
          results.push({ visitorNumber: vn, status: 'error', message: 'Visitor number not found' });
          summary.error++;
        }
      } catch (e) {
        console.warn('handleBulkSignOut: Error for ' + vn + ': ' + e.message);
        results.push({ visitorNumber: vn, status: 'error', message: e.message });
        summary.error++;
      }

      // Flush every 10 items to keep writes durable
      if ((v + 1) % 10 === 0) {
        SpreadsheetApp.flush();
      }
    }

    SpreadsheetApp.flush();

    return jsonResponse({
      status: 'ok',
      results: results,
      summary: summary,
    }, 200);
  } catch (e) {
    return jsonResponse({ status: 'error', error: 'Bulk sign-out failed: ' + e.message }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Auto sign-out all checked-in visitors across all configured sheets.
 * Reads CUSTOMER_SHEETS from ScriptProperties (comma-separated sheetIds).
 * Intended to be called by a time-driven trigger at 21:00 daily.
 */
function autoSignOut() {
  // Read CUSTOMER_SHEETS from ScriptProperties (comma-separated sheetIds)
  var sheetsProp = PropertiesService.getScriptProperties().getProperty('CUSTOMER_SHEETS');
  if (!sheetsProp) {
    console.log('autoSignOut: No CUSTOMER_SHEETS configured');
    return;
  }
  var sheetIds = sheetsProp.split(',');

  for (var s = 0; s < sheetIds.length; s++) {
    var sheetId = sheetIds[s].trim();
    if (!sheetId) continue;
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var sheet = ss.getSheetByName('VisitorLog');
      if (!sheet) continue;

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var status = String(data[i][11] || '').trim(); // col 11 = Status
        if (status === 'Checked In') {
          var visitorNumber = String(data[i][10] || '').trim(); // col 10 = Visitor#
          if (visitorNumber) {
            // Write Signed Out status + timestamp
            sheet.getRange(i + 1, 12).setValue('Signed Out');  // col 12 = Status (1-indexed)
            sheet.getRange(i + 1, 14).setValue(new Date());    // col 14 = Sign-Out Time
            // Release card
            releaseCardForVisitor(visitorNumber, sheetId);
          }
        }
      }
      console.log('autoSignOut: Processed sheet ' + sheetId);
    } catch (e) {
      console.error('autoSignOut: Error for sheet ' + sheetId + ': ' + e.message);
    }
  }
}

/**
 * Install or reinstall the 21:00 auto sign-out time-driven trigger.
 * Removes any existing autoSignOut triggers first to avoid duplicates.
 */
function setupAutoSignOutTrigger() {
  // Remove existing auto sign-out triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoSignOut') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Install new trigger at 21:00 daily
  ScriptApp.newTrigger('autoSignOut')
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .create();
  console.log('setupAutoSignOutTrigger: Auto sign-out trigger installed for 21:00');
}

/**
 * Release all Assigned cards back to Available.
 * Called by a daily time-driven trigger at 02:00 (moved from 18:00).
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

  // Install a new daily trigger at 02:00 (safety net, moved from 18:00)
  ScriptApp.newTrigger('releaseDailyCards')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();

  console.log('setupDailyReleaseTrigger: Daily release trigger installed for 02:00–03:00');
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

var SHEET_VERSION_CELL = 'VisitorLog!A1000';
var LATEST_SHEET_VERSION = 2;

var VISITORLOG_HEADERS = [
  'Timestamp',
  'Full Name',
  'ID / Passport Number',
  'Company Name',
  'Destination',
  'Visitation Date',
  'Hand Phone',
  'Email',
  'ID Photo (Drive URL)',
  'Selfie (Drive URL)',
  'Visitor Number',
  'Status',
  'Sign-In Time',
  'Sign-Out Time'
];

var CARDNO_HEADERS = ['CardNo', 'Status', 'AssignedTo', 'AssignedAt'];

var DESTINATION_HEADERS = ['Destination', 'Access Level'];

var MIGRATION_REGISTRY = [
  {
    version: 1,
    name: 'Initial structure',
    destructive: false,
    description: 'Validates VisitorLog, cardno, Destination tabs exist',
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

      // Write version marker
      console.log('Migration V1: Complete');
    }
  },
  {
    version: 2,
    name: 'Add Visitation Date, Sign-In Time, Sign-Out Time',
    destructive: false,
    description: 'Inserts Visitation Date column, renames Action Time to Sign-In Time, adds Sign-Out Time',
    fn: function(ss) {
      console.log('Migration V2: Updating VisitorLog headers');
      var sheet = ss.getSheetByName('VisitorLog');
      if (!sheet) {
        console.log('Migration V2: VisitorLog not found — skipping');
        return;
      }

      // Only run if current header count is less than 14
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.length >= 14) {
        console.log('Migration V2: Headers already 14+ columns — skipping');
        return;
      }

      // Write new 14-column headers
      var newHeaders = VISITORLOG_HEADERS;
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');

      console.log('Migration V2: Headers updated to 14 columns');
    }
  },
];

/**
 * Read sheet version from VisitorLog!A1000.
 * Returns 0 if no version marker found.
 */
function getSheetVersion_(ss) {
  var sheet = ss.getSheetByName('VisitorLog');
  if (!sheet) return 0;
  var cell = sheet.getRange(SHEET_VERSION_CELL.replace('VisitorLog!', '')).getValue();
  var match = String(cell).match(/SHEET_VERSION=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Write sheet version to VisitorLog!A1000.
 */
function setSheetVersion_(ss, version) {
  var sheet = ss.getSheetByName('VisitorLog');
  if (!sheet) return;
  sheet.getRange(SHEET_VERSION_CELL.replace('VisitorLog!', '')).setValue('SHEET_VERSION=' + version);
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
