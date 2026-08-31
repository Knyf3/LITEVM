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

var CODE_VERSION = '1.16.2';  // Increment this to track deployed versions

// EMAIL BRIDGE: when set, scripted confirmations route through GmailApp with this
// sender identity instead of MailApp. MailApp scripted sends are silently dropped at
// Google's outbound edge for this account; GmailApp (composer infra) delivers with
// full branding. Native account address = valid sender, no alias setup needed.
var EMAIL_BRIDGE_FROM = 'litevm@itt.web.id';

// ──────────────────────────────────────────────
// LICENSE ENFORCEMENT — HMAC SECRET CACHE
// ──────────────────────────────────────────────
var _hmacSecret = undefined; // cached per-execution

/**
 * Get the LITEVM_HMAC_SECRET ScriptProperty for signing ACTApi license tokens.
 * Returns null if not set — license issuance is disabled until configured.
 *
 * @returns {string|null} The hex-encoded 64-char master secret, or null
 */
function _getHmacSecret() {
  if (_hmacSecret === undefined) {
    _hmacSecret = PropertiesService.getScriptProperties().getProperty('LITEVM_HMAC_SECRET');
    if (!_hmacSecret) {
      console.warn('LITEVM_HMAC_SECRET ScriptProperty is not set — ACTApi license issuance disabled');
      _hmacSecret = null;
    } else if (_hmacSecret.length !== 64) {
      console.error('LITEVM_HMAC_SECRET is ' + _hmacSecret.length + ' chars (expected 64 hex chars) — treating as unset');
      _hmacSecret = null;
    }
  }
  return _hmacSecret;
}

// ──────────────────────────────────────────────
// MASTER CONFIG CACHE (per-execution)
// ──────────────────────────────────────────────
var _masterConfig = null;

// ──────────────────────────────────────────────
// Per-request spreadsheet cache — guarantees at most ONE
// SpreadsheetApp.openById per sheetId per request.  Lookup path
// (handleLookup → getOrCreateSheet → getCardNumberForVisitor)
// previously opened the same sheet 2-3×, each costing 2-10s on a
// cold container.  Now every helper reuses the same Spreadsheet
// object via _openSheetCached.
// ──────────────────────────────────────────────
var _ssCache = {};

function _openSheetCached(sheetId) {
  if (!sheetId) throw new Error('Missing sheetId');
  if (!_ssCache[sheetId]) {
    _ssCache[sheetId] = SpreadsheetApp.openById(sheetId);
  }
  return _ssCache[sheetId];
}

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
 * Resolves columns by header name (not position) so the schema can grow without
 * breaking deployments, and caches the result in two layers:
 *   - a per-execution global (_masterConfig), and
 *   - a Script Properties JSON cache (MASTER_CONFIG_CACHE) with a 5-minute TTL,
 *     so repeated hourly ticks don't re-open the master sheet on every run.
 *
 * Customers tab schema (header-name resolved):
 *   sheetId | allowedOrigins | tier | visitorLimit | status | notes |
 *   autoSignOutHour | autoSignOutEnabled | timezone | retentionDays |
 *   expiryDate | expiryWarningDays
 *
 * @returns {Object} Map of sheetId -> { sheetId, allowedOrigins, tier,
 *   visitorLimit, status, notes, autoSignOutHour, autoSignOutEnabled,
 *   timezone, retentionDays, expiryDate, expiryWarningDays }
 */
function _loadMasterConfig() {
  if (_masterConfig !== null) return _masterConfig;

  var props = PropertiesService.getScriptProperties();

  // ── Script Properties cache (TTL 5 min) ──
  var MASTER_CONFIG_TTL_MS = 5 * 60 * 1000;
  var cachedRaw = props.getProperty('MASTER_CONFIG_CACHE');
  if (cachedRaw) {
    try {
      var cached = JSON.parse(cachedRaw);
      if (cached && cached.at && (Date.now() - cached.at) < MASTER_CONFIG_TTL_MS) {
        _masterConfig = cached.data || {};
        return _masterConfig;
      }
    } catch (e) { /* stale/corrupt cache — fall through to a live read */ }
  }

  var sheet = _getMasterConfigSheet();
  if (!sheet) { _masterConfig = {}; return {}; }
  var custSheet = sheet.getSheetByName('Customers');
  if (!custSheet) { _masterConfig = {}; return {}; }
  var data = custSheet.getDataRange().getValues();

  var cols = resolveColumns(data, [
    'sheetId', 'allowedOrigins', 'tier', 'visitorLimit', 'status', 'notes',
    'autoSignOutHour', 'autoSignOutEnabled', 'retentionDays', 'timezone',
    'expiryDate', 'expiryWarningDays'
  ]);

  var config = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var sid = String(row[cols['sheetId']] || '').trim();
    if (!sid) continue;

    var hourCell = cols['autoSignOutHour'] !== -1 ? row[cols['autoSignOutHour']] : undefined;
    var enabledCell = cols['autoSignOutEnabled'] !== -1 ? row[cols['autoSignOutEnabled']] : undefined;
    var tzCell = cols['timezone'] !== -1 ? row[cols['timezone']] : '';
    // retentionDays is OPTIONAL: blank/empty → null (no purge for this customer).
    var retentionDays = null;
    if (cols['retentionDays'] !== -1 && row[cols['retentionDays']] !== '' && row[cols['retentionDays']] !== null && row[cols['retentionDays']] !== undefined) {
      var parsedRetention = parseInt(String(row[cols['retentionDays']]).trim(), 10);
      if (!isNaN(parsedRetention)) {
        retentionDays = parsedRetention;
      } else {
        console.warn('_loadMasterConfig: non-numeric retentionDays for ' + sid + ' — treating as no purge');
      }
    }

    // expiryDate is OPTIONAL: blank/empty → null (no expiry for this customer).
    // Sheets auto-coerces ISO-looking cell values to Date objects — normalize
    // BOTH shapes to a canonical 'yyyy-MM-dd' string (Date cell → format in the
    // customer timezone; string cell → trim as-is). Parsed strictly at
    // enforcement time by parseRetentionDate_ (never coerced to a Date here).
    var expiryDate = null;
    if (cols['expiryDate'] !== -1) {
      var rawExpiryCell = row[cols['expiryDate']];
      if (rawExpiryCell instanceof Date && !isNaN(rawExpiryCell.getTime())) {
        var expiryTz = tzCell ? String(tzCell).trim() : Session.getScriptTimeZone();
        expiryDate = Utilities.formatDate(rawExpiryCell, expiryTz, 'yyyy-MM-dd');
      } else {
        var rawExpiry = String(rawExpiryCell || '').trim();
        if (rawExpiry) expiryDate = rawExpiry;
      }
    }

    // expiryWarningDays is OPTIONAL: blank → default 7 (silent, the common
    // "unset" case); NaN / negative → default 7 with a warning.
    var expiryWarningDays = 7;
    if (cols['expiryWarningDays'] !== -1) {
      var rawWarning = String(row[cols['expiryWarningDays']] || '').trim();
      if (rawWarning !== '') {
        var parsedWarning = parseInt(rawWarning, 10);
        if (isNaN(parsedWarning) || parsedWarning < 0) {
          console.warn('_loadMasterConfig: invalid expiryWarningDays "' + rawWarning + '" for ' + sid + ' — using default 7');
          expiryWarningDays = 7;
        } else {
          expiryWarningDays = parsedWarning;
        }
      }
    }

    config[sid] = {
      sheetId: sid,
      allowedOrigins: String(row[cols['allowedOrigins']] || '').trim(),
      tier: String(row[cols['tier']] || 'free').trim().toLowerCase(),
      visitorLimit: row[cols['visitorLimit']] !== undefined && row[cols['visitorLimit']] !== null && row[cols['visitorLimit']] !== '' ? parseInt(row[cols['visitorLimit']], 10) : 50,
      status: String(row[cols['status']] || 'active').trim().toLowerCase(),
      notes: String(row[cols['notes']] || '').trim(),
      autoSignOutHour: hourCell !== undefined && hourCell !== null && hourCell !== '' ? parseInt(hourCell, 10) : 21,
      autoSignOutEnabled: enabledCell !== undefined && enabledCell !== null ? String(enabledCell).toUpperCase() === 'TRUE' : true,
      retentionDays: retentionDays,
      timezone: tzCell ? String(tzCell).trim() : null,
      expiryDate: expiryDate,
      expiryWarningDays: expiryWarningDays,
    };
  }
  _masterConfig = config;

  // ── Persist to Script Properties cache ──
  try {
    props.setProperty('MASTER_CONFIG_CACHE', JSON.stringify({ at: Date.now(), data: config }));
  } catch (e) {
    console.warn('_loadMasterConfig: failed to write MASTER_CONFIG_CACHE: ' + e.message);
  }

  return config;
}

/**
 * Invalidate both the per-execution master config cache and the Script
 * Properties JSON cache. Call after any write that mutates the Customers tab
 * (e.g. auto-register appending a row) so the next read is live.
 */
function _invalidateMasterConfigCache_() {
  _masterConfig = null;
  try {
    PropertiesService.getScriptProperties().deleteProperty('MASTER_CONFIG_CACHE');
  } catch (e) { /* ignore */ }
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
 * Validate an IANA timezone string by attempting a formatDate. Returns false
 * (rather than throwing) so callers can fall through to the next priority.
 *
 * @param {*} tz - Candidate timezone string
 * @returns {boolean} true if the string is a valid IANA timezone
 */
function _isValidTimeZone_(tz) {
  if (!tz || typeof tz !== 'string') return false;
  var trimmed = tz.trim();
  if (!trimmed) return false;
  try {
    Utilities.formatDate(new Date(), trimmed, 'yyyy');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the effective IANA timezone for a customer, in priority order:
 *   (1) Settings tab 'timezone' row (if present and valid)
 *   (2) master config entry 'timezone' (if present and valid)
 *   (3) Session.getScriptTimeZone() (project timezone)
 *
 * Invalid values log a warning and fall through to the next priority.
 *
 * NOTE: autoSignOut() does NOT use this helper — reading the Settings tab per
 * sheet at ~100-customer scale is too expensive, so it uses the master-config
 * timezone directly. Request-time helpers (handleTodayVisitors, handleReport,
 * getDailyVisitorCount_) may pay the Settings read since the sheet is already
 * open and the call volume is per-request.
 *
 * @param {string} sheetId - Customer's Google Sheet ID
 * @param {Object} [masterConfigEntry] - Cached master config entry (avoids a re-fetch)
 * @returns {string} IANA timezone string
 */
function getCustomerTimeZone_(sheetId, masterConfigEntry) {
  if (masterConfigEntry === undefined || masterConfigEntry === null) {
    masterConfigEntry = _getCustomerConfig(sheetId);
  }

  // Priority 1: Settings tab timezone (best-effort; may not exist yet).
  var fromSettings = null;
  try {
    var settings = getSheetSettings_(sheetId);
    if (settings && settings.timezone) fromSettings = settings.timezone;
  } catch (e) { /* settings read is best-effort */ }
  if (fromSettings && _isValidTimeZone_(fromSettings)) return fromSettings;
  if (fromSettings) {
    console.warn('getCustomerTimeZone_: invalid Settings timezone "' + fromSettings + '" for ' + sheetId + ' — falling through');
  }

  // Priority 2: master config timezone.
  var fromMaster = masterConfigEntry ? masterConfigEntry.timezone : null;
  if (fromMaster && _isValidTimeZone_(fromMaster)) return fromMaster;
  if (fromMaster) {
    console.warn('getCustomerTimeZone_: invalid master-config timezone "' + fromMaster + '" for ' + sheetId + ' — falling through');
  }

  // Priority 3: project timezone.
  return Session.getScriptTimeZone();
}

/**
 * Extract the origin from a doGet/doPost event object.
 * Checks POST body first, then query parameters.
 *
 * @param {Object} e - The event object
 * @returns {string} The origin string (may be empty)
 */
function _extractOrigin_(e) {
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
  return origin;
}

/**
 * Auto-register an unknown sheetId to the Customers tab with pending status.
 *
 * Guards:
 *  - Respects AUTO_REGISTER_ENABLED Script Property (must be "true").
 *  - Rate-limits: at most 20 auto-registrations per rolling hour (stored
 *    in Script Properties counter).
 *  - Uses LockService on the master config sheet to prevent duplicate rows
 *    from concurrent requests for the same sheetId.
 *  - Double-checks the customer wasn't registered between the initial miss
 *    and acquiring the lock (race condition guard).
 *  - Logs every auto-registration to DeniedLog for traceability.
 *  - Auto-runs migration on the customer sheet to create required tabs
 *    (VisitorLog, cardno, Destination, Settings).
 *
 * @param {string} sheetId - The unknown Google Sheet ID
 * @param {string} origin - Request origin (for logging)
 * @param {string} endpointType - Endpoint type (for logging)
 * @returns {Object|null} Newly created customer config object, or null on failure
 */
function _autoRegisterCustomer(sheetId, origin, endpointType) {
  // ── Guard 1: Feature flag ──
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('AUTO_REGISTER_ENABLED') !== 'true') {
    console.log('[autoRegister] AUTO_REGISTER_ENABLED is not true — skipping auto-registration for ' + sheetId);
    return null;
  }

  // ── Guard 2: Rate limit (max 20 per rolling hour) ──
  if (!_checkAutoRegisterRateLimit_()) {
    console.warn('[autoRegister] Rate limit exceeded — skipping auto-registration for ' + sheetId);
    logDeniedRequest(sheetId, origin, 'AUTO_REGISTER_RATE_LIMIT', endpointType, null);
    return null;
  }

  // ── Guard 3: Lock on master config to prevent duplicate registrations ──
  var masterSheet = _getMasterConfigSheet();
  if (!masterSheet) {
    console.warn('[autoRegister] Cannot access master config sheet');
    return null;
  }

  var lock = LockService.getUserLock();
  try {
    if (!lock.tryLock(15000)) { // 15s timeout
      console.warn('[autoRegister] Could not acquire lock for master config');
      return null;
    }

    // ── Guard 5: Double-check — another execution may have registered this sheetId ──
    _invalidateMasterConfigCache_();
    var existing = _getCustomerConfig(sheetId);
    if (existing) {
      console.log('[autoRegister] Customer ' + sheetId + ' was registered by another execution — using existing record');
      return existing;
    }

    // ── Build default config ──
    var defaults = {
      allowedOrigins: '',
      tier: 'free',
      visitorLimit: 50,
      status: 'pending',
      notes: 'Auto-registered by LITEVM on ' + new Date().toISOString(),
      autoSignOutHour: 21,
      autoSignOutEnabled: true,
      timezone: '', // empty → inherit Settings tab or project tz
    };

    // Allow override via AUTO_REGISTER_DEFAULTS JSON in Script Properties
    var customDefaults = props.getProperty('AUTO_REGISTER_DEFAULTS');
    if (customDefaults) {
      try {
        var parsed = JSON.parse(customDefaults);
        if (parsed.allowedOrigins !== undefined) defaults.allowedOrigins = String(parsed.allowedOrigins);
        if (parsed.tier !== undefined) defaults.tier = String(parsed.tier).toLowerCase();
        if (parsed.visitorLimit !== undefined) defaults.visitorLimit = parseInt(parsed.visitorLimit, 10);
        if (parsed.status !== undefined) defaults.status = String(parsed.status).toLowerCase();
        if (parsed.notes !== undefined) defaults.notes = String(parsed.notes);
        if (parsed.autoSignOutHour !== undefined) defaults.autoSignOutHour = parseInt(parsed.autoSignOutHour, 10);
        if (parsed.autoSignOutEnabled !== undefined) defaults.autoSignOutEnabled = String(parsed.autoSignOutEnabled).toUpperCase() === 'TRUE';
        if (parsed.timezone !== undefined) defaults.timezone = String(parsed.timezone).trim();
      } catch (e) {
        console.warn('[autoRegister] Failed to parse AUTO_REGISTER_DEFAULTS: ' + e.message);
      }
    }

    // ── Append row to Customers tab (header-name resolved, full-width) ──
    var custSheet = masterSheet.getSheetByName('Customers');
    if (!custSheet) {
      console.warn('[autoRegister] Customers tab not found in master config');
      return null;
    }

    var custData = custSheet.getDataRange().getValues();
    var custCols = resolveColumns(custData, [
      'sheetId', 'allowedOrigins', 'tier', 'visitorLimit', 'status', 'notes',
      'autoSignOutHour', 'autoSignOutEnabled', 'retentionDays', 'timezone'
    ]);

    // All required master-config headers must be present BEFORE appending
    // (fail loud — a partial row would corrupt positional reads elsewhere).
    // retentionDays is intentionally NOT required: new rows leave it empty
    // (no purge) until an operator sets it.
    var MASTER_REQUIRED = ['sheetId', 'allowedOrigins', 'tier', 'visitorLimit',
      'status', 'notes', 'autoSignOutHour', 'autoSignOutEnabled'];
    for (var mh = 0; mh < MASTER_REQUIRED.length; mh++) {
      if (custCols[MASTER_REQUIRED[mh]] === -1) {
        console.error('[autoRegister] Master config Customers tab missing header: ' + MASTER_REQUIRED[mh]);
        return null;
      }
    }

    // Build a full-width row (length = header row length), placing each field
    // at its resolved index and leaving everything else empty. 'timezone' is
    // appended last with an empty default (same pattern as handleRegistration).
    var headerLen = custData.length > 0 ? custData[0].length : custCols['autoSignOutEnabled'] + 1;
    var custRow = new Array(headerLen);
    for (var ck = 0; ck < headerLen; ck++) custRow[ck] = '';

    custRow[custCols['sheetId']] = sheetId;
    custRow[custCols['allowedOrigins']] = defaults.allowedOrigins;
    custRow[custCols['tier']] = defaults.tier;
    custRow[custCols['visitorLimit']] = defaults.visitorLimit;
    custRow[custCols['status']] = defaults.status;
    custRow[custCols['notes']] = defaults.notes;
    custRow[custCols['autoSignOutHour']] = defaults.autoSignOutHour;
    custRow[custCols['autoSignOutEnabled']] = defaults.autoSignOutEnabled;
    // NOTE: the legacy registration-timestamp column is no longer written — it
    // may still exist in the sheet (left over from pre-v1.14.0) but the code no
    // longer reads it. retentionDays is deliberately left empty so the new
    // customer is NOT purged until an operator explicitly sets a value.
    if (custCols['timezone'] !== -1) {
      custRow[custCols['timezone']] = defaults.timezone;
    }

    custSheet.appendRow(custRow);

    SpreadsheetApp.flush(); // Ensure write is committed

    // ── Invalidate cache so next call sees the new row ──
    _invalidateMasterConfigCache_();

    // ── Log the auto-registration ──
    console.log('[autoRegister] Successfully registered sheetId ' + sheetId + ' with status=' + defaults.status + ' tier=' + defaults.tier);
    logDeniedRequest(sheetId, origin, 'AUTO_REGISTERED', endpointType, null);

    // ── Auto-migrate: create required tabs if missing ──
    try {
      var migResult = handleMigration(sheetId);
      if (migResult.status === 'ok') {
        console.log('[autoRegister] Migration complete for ' + sheetId + ': v' + migResult.fromVersion + ' → v' + migResult.toVersion);
      } else {
        console.warn('[autoRegister] Migration warning for ' + sheetId + ': ' + JSON.stringify(migResult));
      }
    } catch (migErr) {
      console.warn('[autoRegister] Migration failed for ' + sheetId + ' (sheet may not be accessible yet): ' + migErr.message);
    }

    // Return the new customer config
    return _getCustomerConfig(sheetId);

  } catch (e) {
    console.error('[autoRegister] Error registering sheetId ' + sheetId + ': ' + e.message);
    return null;
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore release errors */ }
  }
}

/**
 * Rate-limiter for auto-registrations.
 * Stores a JSON array of timestamps in Script Properties under
 * AUTO_REGISTER_TIMESTAMPS. Allows at most MAX_PER_HOUR entries
 * in the last 3600 seconds.
 *
 * @returns {boolean} true if request is within rate limit
 */
function _checkAutoRegisterRateLimit_() {
  var MAX_PER_HOUR = 20;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('AUTO_REGISTER_TIMESTAMPS');
  var timestamps = [];
  if (raw) {
    try { timestamps = JSON.parse(raw); } catch (e) { timestamps = []; }
  }

  var now = Date.now();
  var oneHourAgo = now - 3600000; // 60 min in ms

  // Filter out timestamps older than 1 hour
  timestamps = timestamps.filter(function(ts) { return ts > oneHourAgo; });

  if (timestamps.length >= MAX_PER_HOUR) {
    return false;
  }

  // Add current timestamp and save
  timestamps.push(now);
  props.setProperty('AUTO_REGISTER_TIMESTAMPS', JSON.stringify(timestamps));

  return true;
}

/**
 * Count today's registrations for a customer sheet by Visitation Date.
 * Scans VisitorLog, counts rows where the Visitation Date column matches today's date.
 * Returns null on error (caller decides fail-open vs fail-closed).
 *
 * @param {string} sheetId - Customer's Google Sheet ID
 * @param {string} [tz] - IANA timezone for "today" (defaults to project tz)
 * @returns {number|null} Count of today's registrations, or null on error
 */
function getDailyVisitorCount_(sheetId, tz) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('VisitorLog');
    if (!sheet) return 0;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return 0; // header only

    var visitDateIdx = getColumnIndex_(data, 'Visitation Date');
    if (visitDateIdx === -1) {
      console.error('getDailyVisitorCount_: VisitorLog missing Visitation Date header');
      return null;
    }

    var timeZone = tz || Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

    var count = 0;
    for (var i = 1; i < data.length; i++) {
      var cell = data[i][visitDateIdx];
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
  var current = getDailyVisitorCount_(sheetId, getCustomerTimeZone_(sheetId, customer));

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
 * Build the standard "valid" result object for validateRequest, annotating the
 * derived expiry state when known. Keeps the allow-return sites DRY so every
 * allow path reports a consistent expiryState + remainingDays shape.
 *
 * @param {Object} customer - Master config entry
 * @param {Object} expiryInfo - Result of computeExpiryState_ (may be null)
 * @returns {Object} { valid:true, tier, visitorLimit, status, expiryState?, remainingDays? }
 */
function buildValidResult_(customer, expiryInfo) {
  var result = {
    valid: true,
    tier: customer.tier,
    visitorLimit: customer.visitorLimit,
    status: customer.status,
  };
  if (expiryInfo) {
    result.expiryState = expiryInfo.expiryState;
    result.remainingDays = expiryInfo.remainingDays;
  }
  return result;
}

/**
 * Validate an incoming request against the master config.
 *
 * NEW BEHAVIOR for unknown sheetIds:
 *   If AUTO_REGISTER_ENABLED=true in Script Properties, unknown sheetIds are
 *   auto-registered to the Customers tab with status="pending" and tier/limit
 *   defaults. The request is then allowed through for non-register endpoints,
 *   but blocked for registration (check-in) with ACCOUNT_PENDING.
 *
 * Validation steps:
 *   1. If sheetId not in master config → try auto-register (if enabled)
 *      a. If auto-register succeeds:
 *         - For 'register' epType → deny with ACCOUNT_PENDING
 *         - For all other epTypes → allow (returns status='pending')
 *      b. If auto-register fails → deny with INVALID_CUSTOMER
 *   2. If customer status is 'pending' and epType is 'register' → deny ACCOUNT_PENDING
 *   3. If customer status is 'pending' (non-register) → allow
 *   4. If customer is expired (derived from expiryDate) → deny ACCOUNT_EXPIRED
 *      (overrides paused/disabled; pending wins above)
 *   5. If customer status is not 'active' → deny ACCOUNT_DISABLED
 *   6. If endpointType is NOT 'register' → skip origin check, allow
 *   7. If origin is reported → check against allowedOrigins whitelist
 *   8. If origin not whitelisted → deny with ORIGIN_BLOCKED
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

  // ── NEW: Auto-register unknown customers if enabled ──
  if (!customer) {
    // Attempt auto-registration
    var origin = _extractOrigin_(e);
    customer = _autoRegisterCustomer(sheetId, origin, endpointType);

    if (!customer) {
      // Auto-registration failed or disabled — deny as before
      logDeniedRequest(sheetId, null, 'UNKNOWN_CUSTOMER', endpointType, null);
      return { valid: false, error: 'INVALID_CUSTOMER', message: 'Invalid customer configuration.' };
    }

    // Auto-registration succeeded
    // If this is a registration endpoint, block with pending message
    if (endpointType === 'register') {
      logDeniedRequest(sheetId, origin, 'ACCOUNT_PENDING', endpointType, null);
      return {
        valid: false,
        error: 'ACCOUNT_PENDING',
        message: 'Account pending activation. Please contact the administrator.',
        tier: customer.tier,
        visitorLimit: customer.visitorLimit,
        status: customer.status,
      };
    }

    // For non-register endpoints on newly registered pending accounts — allow
    return { valid: true, tier: customer.tier, visitorLimit: customer.visitorLimit, status: customer.status };
  }

  // ── NEW: Check for pending status (blocks registration only, allows reads/updates) ──
  if (customer.status === 'pending') {
    if (endpointType === 'register') {
      logDeniedRequest(sheetId, _extractOrigin_(e), 'ACCOUNT_PENDING', endpointType, null);
      return {
        valid: false,
        error: 'ACCOUNT_PENDING',
        message: 'Account pending activation. Please contact the administrator.',
        tier: customer.tier,
        visitorLimit: customer.visitorLimit,
        status: customer.status,
      };
    }
    // For non-register endpoints on pending accounts — allow through
    return { valid: true, tier: customer.tier, visitorLimit: customer.visitorLimit, status: customer.status };
  }

  // ── NEW: derived expiry enforcement (computed fresh on every request) ──
  // Expiry is NEVER stored as a status; it is derived from the customer's
  // expiryDate on each request. 'expiring' is annotation-only (allow). 'expired'
  // DENIES even if status is still 'active' — and, because this step runs before
  // the status check below, it also overrides paused/disabled status. Pending
  // accounts return above, so ACCOUNT_PENDING always wins over expiry for
  // never-activated accounts.
  var expiryInfo = computeExpiryState_(customer, new Date());
  if (expiryInfo.expiryState === 'expired') {
    logDeniedRequest(sheetId, _extractOrigin_(e), 'ACCOUNT_EXPIRED', endpointType, null);
    return {
      valid: false,
      error: 'ACCOUNT_EXPIRED',
      message: 'Customer subscription expired.',
      expiryDate: customer.expiryDate,
      remainingDays: expiryInfo.remainingDays,
      tier: customer.tier,
      visitorLimit: customer.visitorLimit,
      status: customer.status,
    };
  }

  // Check account status for non-pending, non-active states
  if (customer.status !== 'active') {
    logDeniedRequest(sheetId, _extractOrigin_(e), 'ACCOUNT_' + customer.status.toUpperCase(), endpointType, null);
    return { valid: false, error: 'ACCOUNT_DISABLED', message: 'This service is currently unavailable.' };
  }

  // Only enforce origin checks on registration endpoint
  if (endpointType !== 'register') {
    return buildValidResult_(customer, expiryInfo);
  }

  // ─── REGISTRATION-SPECIFIC CHECKS ───
  var origin = _extractOrigin_(e);

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
  return buildValidResult_(customer, expiryInfo);
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
    // Auto-install triggers on first request after deploy
    ensureTriggersInstalled();

    // Check for action parameter
    if (e && e.parameter && e.parameter.action) {
      var action = e.parameter.action;
      var sheetId = e && e.parameter ? e.parameter.sheetId : null;

      // Admin actions that don't need customer validation
      if (action === 'runAutoSignOut') {
        autoSignOut();
        return jsonResponse({ status: 'ok', message: 'autoSignOut triggered manually' }, 200);
      }

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

      if (action === 'visitorTypes') {
        return handleVisitorTypes(sheetId);
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

      if (action === 'config') {
        if (!sheetId) {
          return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
        }
        var settings = getSheetSettings_(sheetId);
        var customer = _getCustomerConfig(sheetId);
        var entitledTiers = ['pro', 'multi-site', 'enterprise'];
        // Derived expiry is authoritative: an expired customer gets
        // actEnabled=false even if status is still 'active'.
        var expiryInfo = customer ? computeExpiryState_(customer, new Date()) : { expiryState: 'none', remainingDays: null };
        var actEnabled = customer !== null &&
          customer.status === 'active' &&
          entitledTiers.indexOf(customer.tier) !== -1 &&
          expiryInfo.expiryState !== 'expired';
        return jsonResponse({
          status: 'ok',
          guardPin: settings.guardPin,
          autoSignOutEnabled: settings.enabled,
          autoSignOutHour: settings.hour,
          timezone: settings.timezone || (customer ? customer.timezone : null) || Session.getScriptTimeZone(),
          actEnabled: actEnabled,
          expiryDate: customer && customer.expiryDate ? customer.expiryDate : null,
          remainingDays: expiryInfo.remainingDays,
          expiryState: expiryInfo.expiryState,
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
    // Auto-install triggers on first request after deploy
    ensureTriggersInstalled();

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
    else if (data.mode === 'retentionDryRun' || data.mode === 'runRetention') epType = 'admin';
    else if (data.mode === 'expiryDryRun' || data.mode === 'runExpiry') epType = 'admin';
    else if (data.mode === 'signOutByCard') epType = 'admin';
    else if (data.mode === 'assignedCards') epType = 'admin';
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
      return jsonResponse({ status: 'ok', message: "Hourly auto sign-out trigger installed (per-customer timezone/hour)." }, 200);
    }

    // Handle retention purge manual triggers (admin-gated). retentionDryRun
    // performs the full scan + logging but skips deleteRow and setTrashed.
    if (data.mode === 'retentionDryRun') {
      runRetention(true);
      return jsonResponse({ status: 'ok', message: 'Retention dry run complete — no rows deleted or photos trashed.' }, 200);
    }
    if (data.mode === 'runRetention') {
      runRetention(false);
      return jsonResponse({ status: 'ok', message: 'Retention purge complete.' }, 200);
    }

    // Handle expiry pass manual triggers (admin-gated). expiryDryRun performs
    // the full scan + ExpiryLog writes but skips status changes.
    if (data.mode === 'expiryDryRun') {
      runExpiry(true);
      return jsonResponse({ status: 'ok', message: 'Expiry dry run complete — no status changes applied.' }, 200);
    }
    if (data.mode === 'runExpiry') {
      runExpiry(false);
      return jsonResponse({ status: 'ok', message: 'Expiry pass complete.' }, 200);
    }

    // Handle ACTApi license issuance
    if (data.mode === 'issueLicense') {
      return handleIssueLicense(data);
    }

    // Handle test-email diagnostic (admin-gated — surfaces OAuth/scope errors)
    if (data.mode === 'testEmail') {
      return handleTestEmail(data);
    }

    // Handle UStarAPI sign-out webhook (M8 §3.3)
    if (data.mode === 'signOutByCard') {
      return handleSignOutByCard(data);
    }

    // Handle UStarAPI assigned-cards query (M8 §4.2)
    if (data.mode === 'assignedCards') {
      return handleAssignedCards(data);
    }

    // Check if this is a status update
    if (data.mode === 'updateStatus') {
      return handleStatusUpdate(data);
    }

    // If mode was specified but not handled, return error
    if (data.mode) {
      return jsonResponse({ status: 'error', error: 'Unknown mode: ' + data.mode }, 400);
    }

    // ── REGISTRATION (no mode) ──
    // Drive photo upload and email enqueue now happen OUTSIDE the LockService
    // critical section (see handleRegistration); the lock wraps only the atomic
    // visitor-limit check + VisitorLog row append.
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
// HANDLER: Issue ACTApi License Token
// ──────────────────────────────────────────────

/**
 * Handle ACTApi license token issuance requests.
 * Accepts mode=issueLicense with sheetId, machineId, optional validityDays,
 * optional permanent (boolean). validityDays=0 is also treated as permanent.
 * Validates the customer's tier and status from master config,
 * constructs and signs a license token using HMAC-SHA256.
 *
 * Token format: base64url(payload_json).base64url(hmac_signature)
 * Cryptographic scheme matches ACTApi Security/LicenseValidator.cs
 * and tools/issue_license.py exactly.
 *
 * Token schema: ver=2 tokens; exp=0 means PERMANENT (never expires),
 * exp>0 is a timed token. (The .NET validator also still accepts ver=1.)
 *
 * @param {Object} data - Request body: { mode:'issueLicense', sheetId, machineId, validityDays?, permanent? }
 * @returns {TextOutput} JSON response with token or error
 */
function handleIssueLicense(data) {
  try {
    // ── Validate inputs ──
    if (!data.sheetId) {
      return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
    }
    if (!data.machineId || data.machineId.length !== 64) {
      return jsonResponse({ status: 'error', error: 'machineId must be a 64-char hex string' }, 400);
    }

    // ── Get HMAC secret ──
    var secret = _getHmacSecret();
    if (!secret) {
      return jsonResponse({
        status: 'error',
        error: 'License signing is not configured. Set LITEVM_HMAC_SECRET ScriptProperty.'
      }, 500);
    }

    // ── Check customer entitlement ──
    var customer = _getCustomerConfig(data.sheetId);
    if (!customer) {
      return jsonResponse({ status: 'error', error: 'Customer not found' }, 404);
    }
    // Derived expiry guard: an expired customer must NOT be issued a license
    // even if status is still 'active' (the daily pass materializes 'disabled'
    // the next morning; enforcement here is always derived).
    var expiryInfo = computeExpiryState_(customer, new Date());
    if (expiryInfo.expiryState === 'expired') {
      return jsonResponse({ status: 'error', error: 'ACCOUNT_EXPIRED', message: 'Customer subscription expired.' }, 403);
    }
    if (customer.status !== 'active') {
      return jsonResponse({
        status: 'error',
        error: 'Customer status is ' + customer.status + ' — must be active'
      }, 403);
    }
    var entitledTiers = ['pro', 'multi-site', 'enterprise'];
    if (entitledTiers.indexOf(customer.tier) === -1) {
      return jsonResponse({
        status: 'error',
        error: 'Tier "' + customer.tier + '" is not entitled to ACTApi. Requires pro, multi-site, or enterprise.'
      }, 403);
    }

    // ── Build payload ──
    // permanent can be a JSON boolean (true/false) or the string 'true';
    // validityDays=0 is also treated as permanent for convenience.
    var permanent = data.permanent === true || data.permanent === 'true' ||
                    parseInt(data.validityDays, 10) === 0;
    var validityDays = parseInt(data.validityDays, 10) || 30;
    if (permanent) {
      validityDays = 0; // permanent tokens have no validity window
    } else {
      if (validityDays < 1) validityDays = 1;
      if (validityDays > 90) validityDays = 90;
    }

    var now = Math.floor(Date.now() / 1000);
    // ver=2: exp=0 means PERMANENT (never expires); exp>0 is a timed token.
    var exp = permanent ? 0 : now + validityDays * 86400;
    var jti = _randomHex(16);

    var payload = {
      sub: data.machineId,
      tier: customer.tier,
      iat: now,
      exp: exp,
      jti: jti,
      ver: 2
    };

    // ── Sign ──
    var payloadJson = JSON.stringify(payload);
    // Per-machine key: HMAC-SHA256(UTF8(secret_hex), UTF8(machineId_hex))
    var perMachineKeyRaw = Utilities.computeHmacSha256Signature(data.machineId, secret);
    // Convert per-machine key to hex string for the payload HMAC key
    var perMachineKeyHex = _bytesToHex(perMachineKeyRaw);
    // Sign payload: HMAC-SHA256(UTF8(perMachineKeyHex), UTF8(payloadJson))
    var sig = Utilities.computeHmacSha256Signature(payloadJson, perMachineKeyHex);
    // Token = base64url(payloadJson) + "." + base64url(sig)
    var token = Utilities.base64EncodeWebSafe(Utilities.newBlob(payloadJson).getBytes())
      .replace(/=+$/, '') + '.' +
      Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');

    // ── Log issuance to Licenses tab ──
    _logLicenseIssuance(data.machineId, jti, customer.tier, now, exp);

    console.log('License issued: sheetId=' + data.sheetId + ', tier=' + customer.tier +
      ', machineId=' + data.machineId.substring(0, 8) + '..., jti=' + jti);

    return jsonResponse({
      status: 'ok',
      token: token,
      machineId: data.machineId,
      tier: customer.tier,
      permanent: permanent,
      expiresAt: permanent ? null : new Date(exp * 1000).toISOString(),
      validDays: validityDays
    }, 200);

  } catch (e) {
    console.error('handleIssueLicense error: ' + e.message + '\n' + e.stack);
    return jsonResponse({ status: 'error', error: e.message }, 500);
  }
}

/**
 * Generate a random hex string of the given length.
 * Uses Math.random for GAS compatibility (not cryptographically strong,
 * but jti is for uniqueness, not secrecy).
 *
 * @param {number} len - Length in hex characters
 * @returns {string} Random hex string
 */
function _randomHex(len) {
  var chars = '0123456789abcdef';
  var result = '';
  for (var i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * 16));
  }
  return result;
}

/**
 * Convert a byte array (from computeHmacSignature) to lowercase hex string.
 * GAS HMAC functions return Byte[]; we need hex for the second HMAC key.
 *
 * @param {Byte[]} bytes - Byte array from Utilities.computeHmacSha256Signature
 * @returns {string} Lowercase hex string
 */
function _bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256; // GAS bytes can be signed
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Log license issuance to the Licenses tab of the master config sheet.
 * Creates the tab with headers if it does not already exist.
 * Schema: machineId | jti | tier | issuedAt | expiresAt | status
 *
 * @param {string} machineId - The hex-encoded machine fingerprint
 * @param {string} jti - The JWT ID for this issuance
 * @param {string} tier - The customer tier
 * @param {number} issuedAtEpoch - Issued-at timestamp (epoch seconds)
 * @param {number} expiresAtEpoch - Expiration timestamp (epoch seconds);
 *        0 denotes a PERMANENT token and is logged as 'permanent'
 */
function _logLicenseIssuance(machineId, jti, tier, issuedAtEpoch, expiresAtEpoch) {
  try {
    var masterSheet = _getMasterConfigSheet();
    if (!masterSheet) return;

    var tab = masterSheet.getSheetByName('Licenses');
    if (!tab) {
      tab = masterSheet.insertSheet('Licenses');
      tab.appendRow(['machineId', 'jti', 'tier', 'issuedAt', 'expiresAt', 'status']);
    }

    tab.appendRow([
      machineId,
      jti,
      tier,
      new Date(issuedAtEpoch * 1000),
      expiresAtEpoch === 0 ? 'permanent' : new Date(expiresAtEpoch * 1000),
      'active'
    ]);
  } catch (e) {
    console.warn('_logLicenseIssuance: Failed to write to Licenses tab: ' + e.message);
    // Non-blocking — licensing still succeeds
  }
}

// ──────────────────────────────────────────────
// HANDLER: Registration
// ──────────────────────────────────────────────

function handleRegistration(data) {
  // ── Phase 1 (OUTSIDE lock): validate, sanitize, upload photos to Drive ──
  // The slow Drive I/O (two file creates) must not hold the script lock — two
  // concurrent registrations would otherwise serialize on it.
  var required = ['fullName', 'idNumber', 'company', 'destination', 'visitorType', 'visitationDate', 'phone', 'email', 'idPhoto', 'selfie'];
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
  var visitorType = sanitizeText(data.visitorType);
  var visitationDate = sanitizeText(data.visitationDate);
  var phone = sanitizePhone(data.phone);
  var email = sanitizeText(data.email);

  // Create Drive folder: VMS/YYYY-MM-DD/VisitorName_Phone/
  var folder = createVisitorFolder(fullName, phone);

  // Upload photos to Drive
  var idPhotoUrl = uploadBase64ToDrive(folder, 'id_photo.jpg', data.idPhoto);
  var selfieUrl = uploadBase64ToDrive(folder, 'selfie.jpg', data.selfie);

  var fields = {
    fullName: fullName,
    idNumber: idNumber,
    company: company,
    destination: destination,
    visitorType: visitorType,
    visitationDate: visitationDate,
    phone: phone,
    email: email,
    idPhotoUrl: idPhotoUrl,
    selfieUrl: selfieUrl,
  };

  // ── Phase 2 (INSIDE lock): atomic visitor-limit check + row append ──
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
  }

  var visitorLimit = null;
  var commitResult = null;
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
    visitorLimit = limitCheck.limit;
    commitResult = _registrationCommit(data.sheetId, fields);
  } finally {
    lock.releaseLock();
  }

  if (!commitResult.ok) {
    // Header-missing (or similar) failure — no email, no row.
    return commitResult.response;
  }

  // ── Phase 3 (OUTSIDE lock): enqueue email confirmation + build response ──
  try {
    sendEmailConfirmation(fields.email, commitResult.visitorNumber, fields.fullName, fields.visitorType, data.sheetId);
  } catch (emailErr) {
    console.warn('Email notification failed for ' + fields.email + ': ' + emailErr.message + ' | ' + emailErr.stack);
  }

  // Get updated count for response
  var updatedCount = getDailyVisitorCount_(data.sheetId, getCustomerTimeZone_(data.sheetId));
  var response = { visitorNumber: commitResult.visitorNumber, status: 'ok' };
  if (visitorLimit && updatedCount !== null) {
    response.usage = {
      current: updatedCount,
      limit: visitorLimit,
      pct: Math.round((updatedCount / visitorLimit) * 100),
    };
  }
  return jsonResponse(response, 200);
}

/**
 * Atomic critical section of registration: generate the visitor number and
 * append the full-width VisitorLog row. Called with the script lock held.
 * Does NOT touch Drive or email (both run outside the lock).
 *
 * @param {string} sheetId - Customer sheet ID
 * @param {Object} fields - Sanitized registration fields (incl. photo URLs)
 * @returns {{ok: boolean, visitorNumber: string, response?: TextOutput}}
 */
function _registrationCommit(sheetId, fields) {
  // Generate visitor number (server-side, sequential per day)
  var visitorNumber = generateVisitorNumber();

  // Write to Google Sheet
  var sheet = getOrCreateSheet(sheetId);
  var sheetData = sheet.getDataRange().getValues();
  var headerLen = sheetData.length > 0 ? sheetData[0].length : VISITORLOG_HEADERS.length;

  var colNames = [
    'Timestamp', 'Full Name', 'ID / Passport Number', 'Company Name',
    'Destination', 'Visitor Type', 'Visitation Date', 'Hand Phone', 'Email',
    'ID Photo (Drive URL)', 'Selfie (Drive URL)', 'Visitor Number', 'Status',
    'Sign-In Time', 'Sign-Out Time'
  ];
  var cols = resolveColumns(sheetData, colNames);

  // All 15 canonical headers must be present BEFORE appending (no partial write).
  for (var h = 0; h < colNames.length; h++) {
    if (cols[colNames[h]] === -1) {
      return {
        ok: false,
        visitorNumber: visitorNumber,
        response: jsonResponse({ status: 'error', error: 'VisitorLog header missing: ' + colNames[h] }, 500),
      };
    }
  }

  // Build a full-width row array (length = header row length), placing each
  // field at its resolved index and leaving everything else empty.
  var rowArr = new Array(headerLen);
  for (var k = 0; k < headerLen; k++) rowArr[k] = '';

  rowArr[cols['Timestamp']] = new Date();
  rowArr[cols['Full Name']] = fields.fullName;
  rowArr[cols['ID / Passport Number']] = fields.idNumber;
  rowArr[cols['Company Name']] = fields.company;
  rowArr[cols['Destination']] = fields.destination;
  rowArr[cols['Visitor Type']] = fields.visitorType;
  rowArr[cols['Visitation Date']] = fields.visitationDate;
  rowArr[cols['Hand Phone']] = fields.phone;
  rowArr[cols['Email']] = fields.email;
  rowArr[cols['ID Photo (Drive URL)']] = fields.idPhotoUrl;
  rowArr[cols['Selfie (Drive URL)']] = fields.selfieUrl;
  rowArr[cols['Visitor Number']] = visitorNumber;
  rowArr[cols['Status']] = 'Pending Entry';
  rowArr[cols['Sign-In Time']] = '';
  rowArr[cols['Sign-Out Time']] = '';

  _appendVisitorLogRow_(sheet, rowArr);

  return { ok: true, visitorNumber: visitorNumber };
}

/**
 * Append a full-width VisitorLog row. Prefers the Sheets Advanced Service
 * (single append API call — faster than SpreadsheetApp.appendRow, which does a
 * getLastRow() round-trip first). Feature-detects: if the advanced service is
 * not enabled in the Apps Script editor (Services → Google Sheets API), it
 * silently falls back to appendRow so the deployment keeps working.
 *
 * @param {Sheet} sheet - The VisitorLog sheet handle
 * @param {Array} rowArr - Full-width row array (length = header row length)
 */
function _appendVisitorLogRow_(sheet, rowArr) {
  if (typeof Sheets !== 'undefined') {
    try {
      Sheets.Spreadsheets.Values.append(
        { values: [rowArr] },
        sheet.getParent().getId(),
        sheet.getName() + '!A1',
        { valueInputOption: 'USER_ENTERED' }
      );
      return;
    } catch (e) {
      console.warn('_appendVisitorLogRow_: Sheets advanced append failed — falling back to appendRow: ' + e.message);
    }
  }
  sheet.appendRow(rowArr);
}

// ──────────────────────────────────────────────
// HANDLER: Lookup by Visitor Number
// ──────────────────────────────────────────────

function getCardNumberForVisitor(visitorNumber, sheetId) {
  if (!visitorNumber || !sheetId) return '';
  try {
    var ss = _openSheetCached(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) return '';
    var data = cardSheet.getDataRange().getValues();

    var cols = resolveColumns(data, ['CardNo', 'AssignedTo']);
    var cardNoIdx = cols['CardNo'];
    var assignedToIdx = cols['AssignedTo'];

    if (cardNoIdx === -1 || assignedToIdx === -1) {
      console.warn('getCardNumberForVisitor: cardno sheet missing CardNo/AssignedTo headers');
      return '';
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][assignedToIdx] || '').trim() === visitorNumber.trim()) {
        return String(data[i][cardNoIdx] || '').trim();
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
    var ss = _openSheetCached(sheetId);
    
    // Step 1: Find visitor number from cardno sheet
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) {
      return jsonResponse({ status: 'notfound', message: 'cardno sheet not found' }, 404);
    }
    
    var cardData = cardSheet.getDataRange().getValues();

    var cols = resolveColumns(cardData, ['CardNo', 'Status', 'AssignedTo']);
    var cardNoIdx = cols['CardNo'];
    var statusIdx = cols['Status'];
    var assignedToIdx = cols['AssignedTo'];

    if (cardNoIdx === -1 || statusIdx === -1 || assignedToIdx === -1) {
      return jsonResponse({ status: 'error', message: 'cardno sheet headers missing required columns' }, 500);
    }

    var visitorNumber = '';
    var cardStatus = '';

    for (var i = 1; i < cardData.length; i++) {
      if (String(cardData[i][cardNoIdx] || '').trim() === cardNo.trim()) {
        visitorNumber = String(cardData[i][assignedToIdx] || '').trim();
        cardStatus = String(cardData[i][statusIdx] || '').trim();
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
  var customerTz = getCustomerTimeZone_(sheetId);
  var sheet = getOrCreateSheet(sheetId);
  var data = sheet.getDataRange().getValues();

  var cols = resolveColumns(data, [
    'Timestamp', 'Full Name', 'ID / Passport Number', 'Company Name',
    'Destination', 'Visitor Type', 'Visitation Date', 'Hand Phone', 'Email',
    'ID Photo (Drive URL)', 'Selfie (Drive URL)', 'Visitor Number', 'Status',
    'Sign-In Time', 'Sign-Out Time'
  ]);

  // Required headers — fail loud with a 500 rather than misread rows.
  if (cols['Visitor Number'] === -1 || cols['Status'] === -1) {
    return jsonResponse({ status: 'error', message: 'VisitorLog headers missing required columns' }, 500);
  }

  var tsIdx = cols['Timestamp'];
  var fullNameIdx = cols['Full Name'];
  var idNumberIdx = cols['ID / Passport Number'];
  var companyIdx = cols['Company Name'];
  var destinationIdx = cols['Destination'];
  var visitorTypeIdx = cols['Visitor Type'];
  var visitationDateIdx = cols['Visitation Date'];
  var phoneIdx = cols['Hand Phone'];
  var emailIdx = cols['Email'];
  var idPhotoIdx = cols['ID Photo (Drive URL)'];
  var selfieIdx = cols['Selfie (Drive URL)'];
  var visitorNumberIdx = cols['Visitor Number'];
  var statusIdx = cols['Status'];
  var signInIdx = cols['Sign-In Time'];
  var signOutIdx = cols['Sign-Out Time'];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var vn = String(row[visitorNumberIdx] || '').trim();

    if (vn === visitorNumber.trim()) {
      var ts = row[tsIdx];
      var registrationTime = '';
      if (ts instanceof Date) {
        registrationTime = formatDateForDisplay(ts, customerTz);
      } else {
        registrationTime = String(ts);
      }

      var status = String(row[statusIdx] || 'Pending Entry');

      var visitor = {
        visitorNumber: vn,
        fullName: String(row[fullNameIdx] || ''),
        idNumber: String(row[idNumberIdx] || ''),
        company: String(row[companyIdx] || ''),
        destination: String(row[destinationIdx] || ''),
        visitorType: String(row[visitorTypeIdx] || ''),
        visitationDate: getDateString_(row[visitationDateIdx], customerTz),
        phone: String(row[phoneIdx] || ''),
        email: String(row[emailIdx] || ''),
        idPhotoUrl: String(row[idPhotoIdx] || ''),
        selfieUrl: String(row[selfieIdx] || ''),
        status: status,
        registrationTime: registrationTime,
        signInTime: row[signInIdx] ? (row[signInIdx] instanceof Date ? formatDateForDisplay(row[signInIdx], customerTz) : String(row[signInIdx])) : '',
        signOutTime: row[signOutIdx] ? (row[signOutIdx] instanceof Date ? formatDateForDisplay(row[signOutIdx], customerTz) : String(row[signOutIdx])) : '',
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

function getDateString_(cell, tz) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return Utilities.formatDate(cell, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(cell || '').trim();
}

/**
 * Read a sheet's header row plus at most the last `maxDataRows` data rows, as a
 * single 2D array suitable for resolveColumns() (row 0 = header). Bounds the
 * read to the tail of an unbounded log so per-request reads ('today') don't pay
 * for the entire sheet on every poll. Registrations are appended chronologically,
 * so today's visitors always live near the tail.
 *
 * @param {Sheet} sheet - The sheet handle
 * @param {number} maxDataRows - Maximum number of data rows to read (from the end)
 * @returns {Array<Array>} Header + tail data rows
 */
function _readTailRows_(sheet, maxDataRows) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [[]]; // truly empty sheet
  var header = sheet.getRange(1, 1, 1, lastCol).getValues();
  if (lastRow <= 1) return header; // header only, no data rows
  var startRow = Math.max(2, lastRow - maxDataRows + 1);
  var numRows = lastRow - startRow + 1;
  var body = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  return header.concat(body);
}

function handleTodayVisitors(sheetId) {
  var customerTz = getCustomerTimeZone_(sheetId);
  var sheet = getOrCreateSheet(sheetId);
  // Bounded read: today's registrations are the most recent rows, so read the
  // header + the last N data rows instead of the whole (potentially huge) log.
  // N=2000 is generous enough to cover pre-registrations and heavy days.
  var data = _readTailRows_(sheet, 2000);

  var cols = resolveColumns(data, [
    'Timestamp', 'Full Name', 'ID / Passport Number', 'Company Name',
    'Destination', 'Visitor Type', 'Visitation Date', 'Hand Phone', 'Email',
    'ID Photo (Drive URL)', 'Selfie (Drive URL)', 'Visitor Number', 'Status',
    'Sign-In Time', 'Sign-Out Time'
  ]);

  if (cols['Visitation Date'] === -1 || cols['Visitor Number'] === -1 ||
      cols['Status'] === -1 || cols['Full Name'] === -1) {
    return jsonResponse({ status: 'error', message: 'VisitorLog headers missing required columns' }, 500);
  }

  var tsIdx = cols['Timestamp'];
  var fullNameIdx = cols['Full Name'];
  var idNumberIdx = cols['ID / Passport Number'];
  var companyIdx = cols['Company Name'];
  var destinationIdx = cols['Destination'];
  var visitorTypeIdx = cols['Visitor Type'];
  var visitationDateIdx = cols['Visitation Date'];
  var phoneIdx = cols['Hand Phone'];
  var emailIdx = cols['Email'];
  var idPhotoIdx = cols['ID Photo (Drive URL)'];
  var selfieIdx = cols['Selfie (Drive URL)'];
  var visitorNumberIdx = cols['Visitor Number'];
  var statusIdx = cols['Status'];
  var signInIdx = cols['Sign-In Time'];
  var signOutIdx = cols['Sign-Out Time'];

  var todayStr = Utilities.formatDate(new Date(), customerTz, 'yyyy-MM-dd');

  var visitors = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var visitDateStr = getDateString_(row[visitationDateIdx], customerTz);

    // Filter by Visitation Date matching today
    if (visitDateStr === todayStr) {
      var ts = row[tsIdx];
      var status = String(row[statusIdx] || 'Pending Entry');
      var vn = String(row[visitorNumberIdx] || '');
      var visitor = {
        visitorNumber: vn,
        fullName: String(row[fullNameIdx] || ''),
        idNumber: String(row[idNumberIdx] || ''),
        company: String(row[companyIdx] || ''),
        destination: String(row[destinationIdx] || ''),
        visitorType: String(row[visitorTypeIdx] || ''),
        visitationDate: visitDateStr,
        phone: String(row[phoneIdx] || ''),
        email: String(row[emailIdx] || ''),
        idPhotoUrl: String(row[idPhotoIdx] || ''),
        selfieUrl: String(row[selfieIdx] || ''),
        status: status,
        registrationTime: ts instanceof Date ? formatDateForDisplay(ts, customerTz) : String(ts),
        signInTime: row[signInIdx] ? (row[signInIdx] instanceof Date ? formatDateForDisplay(row[signInIdx], customerTz) : String(row[signInIdx])) : '',
        signOutTime: row[signOutIdx] ? (row[signOutIdx] instanceof Date ? formatDateForDisplay(row[signOutIdx], customerTz) : String(row[signOutIdx])) : '',
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

/**
 * Read the rows for the report action with bounded pagination.
 *   - mode='full'          → the entire tab (date-range search needs full history)
 *   - startRow (+ count)   → an explicit 1-based slice [startRow, startRow+count-1]
 *   - otherwise (default)  → the last `count` data rows (default 500)
 * The header row is always row 0 so resolveColumns() keeps working.
 *
 * @param {Sheet} sheet - The VisitorLog sheet handle
 * @param {Object} data - The report request body ({ mode?, startRow?, count? })
 * @returns {Array<Array>} Header + (possibly bounded) data rows
 */
function _readReportRows_(sheet, data) {
  var REPORT_DEFAULT_COUNT = 500;

  if (data.mode === 'full') {
    return sheet.getDataRange().getValues();
  }

  var count = parseInt(data.count, 10);
  var startRow = parseInt(data.startRow, 10);

  if (!isNaN(startRow) && startRow >= 2) {
    // Explicit slice anchored at startRow.
    if (isNaN(count) || count < 1) count = REPORT_DEFAULT_COUNT;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return [[]];
    var header = sheet.getRange(1, 1, 1, lastCol).getValues();
    if (lastRow < 2) return header;
    var endRow = Math.min(lastRow, startRow + count - 1);
    var body = endRow >= startRow ? sheet.getRange(startRow, 1, endRow - startRow + 1, lastCol).getValues() : [];
    return header.concat(body);
  }

  // Default / count-only: last N data rows.
  if (isNaN(count) || count < 1) count = REPORT_DEFAULT_COUNT;
  return _readTailRows_(sheet, count);
}

function handleReport(data, sheetId) {
  SpreadsheetApp.flush();

  var customerTz = getCustomerTimeZone_(data.sheetId || sheetId);
  var sheet = getOrCreateSheet(data.sheetId || sheetId);
  var allData = _readReportRows_(sheet, data);

  var cols = resolveColumns(allData, [
    'Timestamp', 'Full Name', 'ID / Passport Number', 'Company Name',
    'Destination', 'Visitor Type', 'Visitation Date', 'Hand Phone', 'Email',
    'ID Photo (Drive URL)', 'Selfie (Drive URL)', 'Visitor Number', 'Status',
    'Sign-In Time', 'Sign-Out Time'
  ]);

  if (cols['Visitation Date'] === -1 || cols['Status'] === -1 ||
      cols['Visitor Number'] === -1 || cols['Visitor Type'] === -1) {
    return jsonResponse({ status: 'error', message: 'VisitorLog headers missing required columns' }, 500);
  }

  var tsIdx = cols['Timestamp'];
  var fullNameIdx = cols['Full Name'];
  var idNumberIdx = cols['ID / Passport Number'];
  var companyIdx = cols['Company Name'];
  var destinationIdx = cols['Destination'];
  var visitorTypeIdx = cols['Visitor Type'];
  var visitationDateIdx = cols['Visitation Date'];
  var phoneIdx = cols['Hand Phone'];
  var emailIdx = cols['Email'];
  var visitorNumberIdx = cols['Visitor Number'];
  var statusIdx = cols['Status'];
  var signInIdx = cols['Sign-In Time'];
  var signOutIdx = cols['Sign-Out Time'];

  var fromDate = data.fromDate || '';
  var toDate = data.toDate || '';

  var visitors = [];
  var pendingCount = 0;
  var checkedInCount = 0;
  var signedOutCount = 0;
  var typeSummary = {}; // { 'Guest': 5, '—': 3 }

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var visitDateStr = getDateString_(row[visitationDateIdx], customerTz);

    // Apply date range filter
    if (fromDate && visitDateStr < fromDate) continue;
    if (toDate && visitDateStr > toDate) continue;

    var ts = row[tsIdx];
    var status = String(row[statusIdx] || 'Pending Entry');
    var vn = String(row[visitorNumberIdx] || '');

    var visitor = {
      visitorNumber: vn,
      fullName: String(row[fullNameIdx] || ''),
      idNumber: String(row[idNumberIdx] || ''),
      company: String(row[companyIdx] || ''),
      destination: String(row[destinationIdx] || ''),
      visitorType: String(row[visitorTypeIdx] || ''),
      visitationDate: visitDateStr,
      phone: String(row[phoneIdx] || ''),
      email: String(row[emailIdx] || ''),
      status: status,
      registrationTime: ts instanceof Date ? formatDateForDisplay(ts, customerTz) : String(ts),
      signInTime: row[signInIdx] ? (row[signInIdx] instanceof Date ? formatDateForDisplay(row[signInIdx], customerTz) : String(row[signInIdx])) : '',
      signOutTime: row[signOutIdx] ? (row[signOutIdx] instanceof Date ? formatDateForDisplay(row[signOutIdx], customerTz) : String(row[signOutIdx])) : '',
    };

    if (status === 'Pending Entry' || status === 'Pending') {
      pendingCount++;
    } else if (status === 'Checked In') {
      checkedInCount++;
    } else if (status === 'Signed Out') {
      signedOutCount++;
    }

    // Per-type summary
    var typeKey = visitor.visitorType || '—';
    typeSummary[typeKey] = (typeSummary[typeKey] || 0) + 1;

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
      byType: typeSummary,
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
// HANDLER: Visitor Types (from VisitorType tab)
// ──────────────────────────────────────────────

function handleVisitorTypes(sheetId) {
  if (!sheetId) {
    sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  }
  if (!sheetId) {
    return jsonResponse({ status: 'ok', types: [], count: 0 }, 200);
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('VisitorType');

  if (!sheet) {
    return jsonResponse({ status: 'ok', types: [], count: 0 }, 200);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 1) {
    return jsonResponse({ status: 'ok', types: [], count: 0 }, 200);
  }

  // Detect if first row is a header: if A1 matches /visitor\s*type/i, skip it
  var startRow = 0;
  var firstCell = String(data[0][0] || '').trim();
  if (data.length >= 1 && /^visitor\s*type$/i.test(firstCell)) {
    startRow = 1;
  }

  var types = [];
  for (var i = startRow; i < data.length; i++) {
    var val = String(data[i][0] || '').trim();
    if (val.length > 0) {
      types.push(val);
    }
  }

  return jsonResponse({
    status: 'ok',
    types: types,
    count: types.length,
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
    // Cardno sheet doesn't exist yet — create it with canonical 5 headers.
    var ss = SpreadsheetApp.openById(sheetId);
    sheet = ss.insertSheet('cardno');
    sheet.getRange(1, 1, 1, CARDNO_HEADERS.length).setValues([CARDNO_HEADERS]);
    sheet.getRange(1, 1, 1, CARDNO_HEADERS.length).setFontWeight('bold');
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
  // 5 columns: CardNo, Status, AssignedTo, AssignedAt, DoorGroupID (empty).
  var cards = [];
  for (var i = 1; i <= count; i++) {
    var padded = ('00000' + i).slice(-5);
    cards.push([prefix + padded, 'Available', '', '', '']);
  }

  sheet.getRange(2, 1, cards.length, 5).setValues(cards);
  sheet.autoResizeColumns(1, 5);

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

  var cols = resolveColumns(values, [
    'Full Name', 'Destination', 'Email', 'Visitor Number', 'Status',
    'Sign-In Time', 'Sign-Out Time', 'Selfie (Drive URL)'
  ]);

  if (cols['Visitor Number'] === -1 || cols['Status'] === -1 ||
      cols['Sign-In Time'] === -1 || cols['Sign-Out Time'] === -1) {
    return jsonResponse({ status: 'error', message: 'VisitorLog headers missing required columns' }, 500);
  }

  var fullNameIdx = cols['Full Name'];
  var destinationIdx = cols['Destination'];
  var emailIdx = cols['Email'];
  var visitorNumberIdx = cols['Visitor Number'];
  var statusIdx = cols['Status'];
  var signInIdx = cols['Sign-In Time'];
  var signOutIdx = cols['Sign-Out Time'];
  var selfieIdx = cols['Selfie (Drive URL)'];

  // Use LockService for the Checked In and Signed Out paths to serialize concurrent requests
  // and prevent two guards from picking the same card or signing out the same visitor
  var lock = null;
  if (newStatus === 'Checked In' || newStatus === 'Signed Out') {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
    }
  }

  var response = null;
  var pendingEmail = null; // { to, cardNo, visitorName, visitorNumber } — enqueued after the lock

  try {
    for (var i = 1; i < values.length; i++) {
      var vn = String(values[i][visitorNumberIdx] || '').trim();

      if (vn === visitorNumber.trim()) {
        var currentStatus = String(values[i][statusIdx] || '').trim();

        // ── SIGNED OUT PATH ──
        if (newStatus === 'Signed Out') {
          // Delegate to the shared sign-out write path (also used by the UStarAPI signOutByCard
          // webhook) so the flip-status + time + release-card sequence has one source of truth.
          // Called while the script lock is held; it re-reads the sheet for a fresh snapshot.
          var signOutResult = _signOutVisitor_(data.sheetId, visitorNumber);

          if (signOutResult.outcome === 'already_signed_out') {
            response = jsonResponse({ status: 'error', message: 'Visitor already signed out.', visitorNumber: visitorNumber }, 409);
            break;
          }
          if (signOutResult.outcome === 'not_checked_in') {
            response = jsonResponse({ status: 'error', message: 'Visitor must be checked in before signing out.', visitorNumber: visitorNumber }, 409);
            break;
          }
          if (signOutResult.outcome === 'not_found') {
            response = jsonResponse({ status: 'notfound', message: 'Visitor number not found: ' + visitorNumber }, 404);
            break;
          }

          var responseData = {
            status: 'ok',
            message: 'Visitor signed out',
            visitorNumber: visitorNumber,
          };
          if (signOutResult.cardNo) {
            responseData.cardNo = signOutResult.cardNo;
          }

          response = jsonResponse(responseData, 200);
          break;
        }

        // ── CHECK-IN / REJECT PATH ──
        // Idempotency guard — prevent re-processing
        if (currentStatus === 'Checked In' || currentStatus === 'Rejected' || currentStatus === 'Signed Out') {
          response = jsonResponse({ status: 'error', message: 'Visitor already processed. Current status: ' + currentStatus }, 409);
          break;
        }

        // Update Status, Sign-In Time, and clear Sign-Out Time at resolved indices.
        sheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
        sheet.getRange(i + 1, signInIdx + 1).setValue(new Date());
        sheet.getRange(i + 1, signOutIdx + 1).setValue('');

        var result = {
          status: 'ok',
          message: 'Status updated to ' + newStatus,
          visitorNumber: visitorNumber,
        };

        // If Checked In, proceed with card assignment (inside lock)
        if (newStatus === 'Checked In') {
          var fullName = String(values[i][fullNameIdx] || '').trim();
          var destination = String(values[i][destinationIdx] || '').trim();
          var email = String(values[i][emailIdx] || '').trim();

          // M8 §5: supply the selfie URL and visitor name from the sheet (backend provenance —
          // never the frontend cache) so the provision hook can fetch them.
          result.visitorName = fullName;
          result.selfieUrl = String(values[i][selfieIdx] || '').trim();

          try {
            var cardResult = assignCardForVisitor(visitorNumber, fullName, destination, data.sheetId);
            if (cardResult) {
              result.cardNo = cardResult.cardNo;
              result.cardQRUrl = cardResult.cardQRUrl;
              result.cardStatus = cardResult.status;
              if (cardResult.cardNo && email) {
                // Defer the card email to AFTER the lock (fire-and-forget queue).
                pendingEmail = { to: email, cardNo: cardResult.cardNo, visitorName: fullName, visitorNumber: visitorNumber };
              }
            }
          } catch (cardErr) {
            console.warn('Card assignment failed: ' + cardErr.message);
            result.cardNo = null;
            result.cardStatus = 'error';
            result.cardError = cardErr.message;
          }

          // Look up door group ID for ACT integration
          if (destination) {
            var dgId = getDoorGroupIdForDestination(destination, data.sheetId);
            if (dgId) result.doorGroupId = dgId;
          }
        }

        response = jsonResponse(result, 200);
        break;
      }
    }

    if (response === null) {
      response = jsonResponse({ status: 'notfound', message: 'Visitor number not found: ' + visitorNumber }, 404);
    }
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }

  // ── Email enqueue OUTSIDE the lock ──
  // The card-assignment email is fire-and-forget via the EmailQueue (deferred
  // delivery). It runs after releaseLock() so queue/GmailApp I/O never extends
  // the critical section that serializes card allocation.
  if (pendingEmail) {
    try {
      sendCardAssignmentEmail(pendingEmail.to, pendingEmail.cardNo, pendingEmail.visitorName, pendingEmail.visitorNumber, data.sheetId);
    } catch (emailErr) {
      console.warn('Card assignment email enqueue failed for ' + pendingEmail.visitorNumber + ': ' + emailErr.message);
    }
  }

  return response;
}

// ──────────────────────────────────────────────
// HELPER: Format date for display
// ──────────────────────────────────────────────

function formatDateForDisplay(date, tz) {
  // Use Utilities.formatDate so the displayed wall-clock time is in the
  // caller's timezone (customer tz where known). The previous implementation
  // read UTC component accessors (getHours/getMinutes/getDate/getMonth/
  // getFullYear), which return UTC values in Apps Script regardless of the
  // script's timezone — this was the display bug.
  return Utilities.formatDate(date, tz || Session.getScriptTimeZone(), 'HH:mm dd MMM yyyy');
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
    ss = _openSheetCached(sheetId);
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

  var headers = VISITORLOG_HEADERS;

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
 * Diagnostic endpoint: sends a test email to verify MailApp is authorized.
 * Surfaces the raw error message (OAuth scope, provisioning, quota, etc.)
 * so the operator can diagnose deployment issues without checking Executions.
 * Admin-gated: requires a valid admin token via validateRequest.
 */
function handleTestEmail(data) {
  if (!data.to) {
    return jsonResponse({ status: 'error', error: 'Missing to' }, 400);
  }

  console.log('handleTestEmail: attempting to send test email to ' + data.to);

  try {
    // Diagnostic variant: pass plain:true to send text-only (no htmlBody) —
    // isolates whether the multipart/alternative MIME shape matters to delivery.
    var opts = {
      to: data.to,
      subject: (data.plain === true) ? 'LITEVM test email (plain text)'
              : (data.from ? 'LITEVM test email (' + data.from + ')'
                 : (EMAIL_BRIDGE_FROM ? 'LITEVM test email (bridge)' : 'LITEVM test email')),
    };
    if (data.plain === true) {
      opts.body = 'Test from LITEVM — plain text only, no htmlBody, no multipart.';
    } else {
      opts.body = 'Test from LITEVM — if you can read this, MailApp works.';
      opts.htmlBody = '<p>Test from LITEVM — if you can read this, <b>MailApp works</b>.</p>';
    }
    if (data.from) { opts.from = data.from; }
    sendEmailThroughBridge(opts);

    console.log('handleTestEmail: test email sent successfully to ' + data.to);
    return jsonResponse({ status: 'ok', sent: true, to: data.to }, 200);
  } catch (e) {
    console.error('handleTestEmail: FAILED to send to ' + data.to + ' — ' + e.message + ' | ' + e.stack);
    return jsonResponse({ status: 'error', sent: false, error: e.message }, 200);
  }
}

/**
 * Send email through the configured bridge. When EMAIL_BRIDGE_FROM is set,
 * routes via GmailApp with the established sender identity (gmail.com);
 * otherwise falls back to MailApp (Workspace default sender).
 */
function sendEmailThroughBridge(opts) {
  var from = opts.from || EMAIL_BRIDGE_FROM;
  if (from) {
    // Positional overload — unambiguous, documented:
    // GmailApp.sendEmail(recipient, subject, body, options)
    GmailApp.sendEmail(
      opts.to,
      opts.subject,
      opts.body || '',
      {
        htmlBody: opts.htmlBody,
        from: from,
        name: opts.name || 'LITEVM Visitor Management',
      }
    );
  } else {
    MailApp.sendEmail(opts);
  }
}

// ══════════════════════════════════════════════
// EMAIL QUEUE (deferred delivery)
// ══════════════════════════════════════════════
//
// Registration and check-in emails are no longer sent inline in the request
// path (GmailApp costs 600ms–1.2s per send). Instead they are appended to a
// hidden PER-CUSTOMER 'EmailQueue' tab and delivered by a 2-minute time-driven
// sweep (runEmailQueueSweep). This returns HTTP 200 immediately and isolates
// the consumer-account quota (100/day) from request bursts.
//
// The queue is per-customer (each sheet copy has its own EmailQueue tab), so
// the header list has no sheetId column — the parent sheet identifies the
// customer. Schema is header-name resolved like every other tab. The HTML body
// is stored in the 'Body' column and reconstructed as `htmlBody` on send.

var EMAIL_QUEUE_SHEET_NAME = 'EmailQueue';
var EMAIL_QUEUE_HEADERS = ['Timestamp', 'Type', 'To', 'Subject', 'Body', 'Status', 'Attempts', 'LastError'];
var EMAIL_QUEUE_MAX_ATTEMPTS = 3;
// Script-property flag: '1' when any customer has PENDING email. The sweep
// checks this FIRST and returns immediately when clean, so idle ticks cost
// ~0.2s instead of ~14s (openById + getDataRange per customer). Cleared by
// the sweep before processing; set by enqueueEmail AFTER the append.
var EMAIL_QUEUE_DIRTY_FLAG = 'EMAIL_QUEUE_DIRTY';

/**
 * Get (or create) the hidden EmailQueue tab on a customer spreadsheet.
 *
 * @param {Spreadsheet} ss - Open customer spreadsheet handle
 * @returns {Sheet|null} The EmailQueue tab, or null if it cannot be created
 */
function getOrCreateEmailQueue_(ss) {
  var tab = ss.getSheetByName(EMAIL_QUEUE_SHEET_NAME);
  if (tab) return tab;
  try {
    tab = ss.insertSheet(EMAIL_QUEUE_SHEET_NAME);
    tab.getRange(1, 1, 1, EMAIL_QUEUE_HEADERS.length).setValues([EMAIL_QUEUE_HEADERS]);
    tab.getRange(1, 1, 1, EMAIL_QUEUE_HEADERS.length).setFontWeight('bold');
    tab.setFrozenRows(1);
    tab.hideSheet();
    return tab;
  } catch (e) {
    console.warn('getOrCreateEmailQueue_: could not create EmailQueue tab: ' + e.message);
    return null;
  }
}

/**
 * Enqueue an email for deferred delivery. Appends a PENDING row to the
 * customer's EmailQueue tab. If the tab cannot be created (or any enqueue
 * write fails), falls back to a synchronous send so the email is never lost.
 *
 * @param {string} sheetId - Customer sheet ID (identifies the EmailQueue tab)
 * @param {string} type - 'registration' | 'card' (diagnostic only)
 * @param {string} to - Recipient address
 * @param {string} subject - Subject line
 * @param {string} htmlBody - HTML body (stored in the 'Body' column)
 */
function enqueueEmail(sheetId, type, to, subject, htmlBody) {
  if (!to) return; // no recipient — nothing to deliver
  try {
    var ss = _openSheetCached(sheetId);
    var tab = getOrCreateEmailQueue_(ss);
    if (tab) {
      tab.appendRow([new Date(), type, to, subject, htmlBody, 'PENDING', 0, '']);
      // Dirty flag AFTER the append: a sweep that started before this append
      // won't miss it — the flag survives to the next tick. Setting it after
      // the append also guarantees the row exists before the flag is visible.
      try {
        PropertiesService.getScriptProperties().setProperty(EMAIL_QUEUE_DIRTY_FLAG, '1');
      } catch (flagErr) {
        console.warn('enqueueEmail: could not set dirty flag: ' + flagErr.message);
      }
      return;
    }
  } catch (e) {
    console.warn('enqueueEmail: could not enqueue — falling back to synchronous send: ' + e.message);
  }
  // Synchronous fallback — email is never lost if the queue is unavailable.
  try {
    sendEmailThroughBridge({ to: to, subject: subject, htmlBody: htmlBody });
  } catch (syncErr) {
    console.warn('enqueueEmail: synchronous fallback send also failed: ' + syncErr.message);
  }
}

/**
 * Sweep one customer's EmailQueue tab: deliver every PENDING row, marking SENT
 * on success or incrementing Attempts (→ FAILED after EMAIL_QUEUE_MAX_ATTEMPTS).
 * Sends are fire-and-forget per row; no LockService is held here.
 *
 * @param {string} sheetId - Customer sheet ID
 * @returns {{sent: number, failed: number}}
 */
function _sweepEmailQueueForSheet_(sheetId) {
  var sent = 0;
  var failed = 0;
  var ss = SpreadsheetApp.openById(sheetId);
  var tab = ss.getSheetByName(EMAIL_QUEUE_SHEET_NAME);
  if (!tab) return { sent: 0, failed: 0 };

  var data = tab.getDataRange().getValues();
  var cols = resolveColumns(data, EMAIL_QUEUE_HEADERS);
  var toIdx = cols['To'];
  var subjectIdx = cols['Subject'];
  var bodyIdx = cols['Body'];
  var statusIdx = cols['Status'];
  var attemptsIdx = cols['Attempts'];
  var lastErrorIdx = cols['LastError'];
  if (toIdx === -1 || statusIdx === -1) {
    console.warn('_sweepEmailQueueForSheet_: EmailQueue missing To/Status headers for ' + sheetId + ' — skipping');
    return { sent: 0, failed: 0 };
  }

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][statusIdx] || '').trim().toUpperCase();
    if (status !== 'PENDING') continue;

    var to = String(data[i][toIdx] || '').trim();
    var subject = String(subjectIdx !== -1 ? data[i][subjectIdx] : '').trim();
    var body = bodyIdx !== -1 ? data[i][bodyIdx] : '';

    if (!to) {
      // No recipient — mark FAILED so it never loops forever.
      tab.getRange(i + 1, statusIdx + 1).setValue('FAILED');
      if (lastErrorIdx !== -1) tab.getRange(i + 1, lastErrorIdx + 1).setValue('Missing recipient');
      failed++;
      continue;
    }

    var attempts = attemptsIdx !== -1 ? (parseInt(String(data[i][attemptsIdx] || '0'), 10) || 0) : 0;
    try {
      sendEmailThroughBridge({ to: to, subject: subject, htmlBody: body });
      tab.getRange(i + 1, statusIdx + 1).setValue('SENT');
      sent++;
    } catch (e) {
      attempts++;
      var newStatus = attempts < EMAIL_QUEUE_MAX_ATTEMPTS ? 'PENDING' : 'FAILED';
      tab.getRange(i + 1, statusIdx + 1).setValue(newStatus);
      if (attemptsIdx !== -1) tab.getRange(i + 1, attemptsIdx + 1).setValue(attempts);
      if (lastErrorIdx !== -1) tab.getRange(i + 1, lastErrorIdx + 1).setValue(String(e.message || '').substring(0, 500));
      failed++;
    }
  }

  return { sent: sent, failed: failed };
}

/**
 * Time-driven sweep (every 5 minutes): deliver pending queue emails across all
 * customer sheets. Fire-and-forget per row — no LockService is held so a slow
 * send never blocks the hourly autoSignOut / daily maintenance triggers.
 *
 * Quota guard: checks the EMAIL_QUEUE_DIRTY script property first. When no
 * customer has enqueued mail since the last sweep, it returns immediately —
 * an idle tick costs ~0.2s instead of openById+getDataRange for every
 * customer (~14s). The flag is cleared BEFORE processing and re-set by
 * enqueueEmail AFTER its append, so an enqueue during the sweep is picked up
 * on the next tick (worst case: one interval of delay, never a lost email).
 */
function runEmailQueueSweep() {
  var prop = PropertiesService.getScriptProperties();
  if (prop.getProperty(EMAIL_QUEUE_DIRTY_FLAG) !== '1') {
    return; // idle — nothing enqueued since the last sweep
  }
  // Claim the work: clear the flag first. Any enqueue that lands after this
  // point re-sets it and is handled on the next tick.
  try {
    prop.setProperty(EMAIL_QUEUE_DIRTY_FLAG, '0');
  } catch (e) {
    console.warn('runEmailQueueSweep: could not clear dirty flag: ' + e.message);
  }

  var config = _loadMasterConfig();
  var sheetIds = Object.keys(config);
  var totalSent = 0;
  var totalFailed = 0;
  for (var s = 0; s < sheetIds.length; s++) {
    var sheetId = sheetIds[s];
    if (!sheetId) continue;
    try {
      var res = _sweepEmailQueueForSheet_(sheetId);
      totalSent += res.sent;
      totalFailed += res.failed;
    } catch (e) {
      console.warn('runEmailQueueSweep: error for sheet ' + sheetId + ': ' + e.message);
    }
  }
  if (totalSent > 0 || totalFailed > 0) {
    console.log('runEmailQueueSweep: sent=' + totalSent + ' failed=' + totalFailed + ' across ' + sheetIds.length + ' sheet(s)');
  }
}

/**
 * Send email confirmation via MailApp.sendEmail().
 * MailApp is a built-in Apps Script service — no setup, no tokens needed.
 */
function sendEmailConfirmation(toEmail, visitorNumber, fullName, visitorType, sheetId) {
  var subject = 'LITEVM — Visitor Registration Confirmation';
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(visitorNumber);

  var htmlBody = ''
    + '<div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;padding:24px;">'
    + '<div style="text-align:center;padding:32px 24px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;">'

    // Header
    + '<h1 style="font-size:20px;font-weight:700;color:#1E293B;margin:0 0 4px 0;">Registration Complete!</h1>'
    + '<p style="font-size:14px;color:#64748B;margin:0 0 24px 0;">Your details have been submitted and recorded.</p>'

    // QR Code
    + '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:inline-block;">'
    + '<a href="' + qrUrl + '" target="_blank">'
    + '<img src="' + qrUrl + '" alt="QR Code for ' + visitorNumber + '" style="display:block;width:200px;height:200px;border-radius:8px;">'
    + '</a>'
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
    + (visitorType ? '<p style="font-size:14px;color:#1E293B;margin:0 0 4px 0;"><strong>Visitor Type:</strong> ' + escapeHtml(visitorType) + '</p>' : '')
    + '<p style="font-size:14px;color:#1E293B;margin:0;">Please show this QR code at the guard house for entry.</p>'
    + '</div>'

    // Footer
    + '<div style="margin-top:24px;padding:12px 16px;background:#F0FDF4;border-radius:8px;display:inline-block;">'
    + '<p style="font-size:12px;color:#16A34A;margin:0;">&#10003; Your information is securely stored.</p>'
    + '</div>'

    + '</div>'
    + '<p style="text-align:center;font-size:11px;color:#94A3B8;margin-top:16px;">LITEVM Visitor Management System</p>'
    + '</div>';

  enqueueEmail(sheetId, 'registration', toEmail, subject, htmlBody);

  console.log('Email confirmation queued for ' + toEmail);
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

  var cols = resolveColumns(data, ['Destination', 'Access Level']);
  var destIdx = cols['Destination'];
  var levelIdx = cols['Access Level'];

  if (destIdx === -1 || levelIdx === -1) {
    console.warn('getAccessLevelForDestination: Destination sheet missing Destination/Access Level headers');
    return null;
  }

  var destLower = destination.trim().toLowerCase();

  // Row 0 = headers; data starts at row 1
  for (var i = 1; i < data.length; i++) {
    var rowDest = String(data[i][destIdx] || '').trim().toLowerCase();
    if (rowDest === destLower) {
      var level = String(data[i][levelIdx] || '').trim();
      return level || null;
    }
  }

  return null;
}

/**
 * Look up the DoorGroup ID for a given destination from the Destination sheet.
 * @param {string} destination — The visitor's destination (e.g. "BRI", "PLN")
 * @param {string} sheetId — The Google Sheet ID
 * @returns {number|null} The numeric DoorGroup ID, or null if not found
 */
function getDoorGroupIdForDestination(destination, sheetId) {
  if (!destination) return null;
  if (!sheetId) {
    console.warn('getDoorGroupIdForDestination: sheetId is required');
    return null;
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    console.warn('getDoorGroupIdForDestination: Cannot open spreadsheet ' + sheetId + ' — ' + e.message);
    return null;
  }

  var destSheet = ss.getSheetByName('Destination');
  if (!destSheet) {
    console.warn('getDoorGroupIdForDestination: Destination sheet tab not found');
    return null;
  }

  var data = destSheet.getDataRange().getValues();

  var cols = resolveColumns(data, ['Destination', 'DoorGroupID']);
  var destIdx = cols['Destination'];
  var doorGroupIdx = cols['DoorGroupID'];

  if (destIdx === -1) {
    console.warn('getDoorGroupIdForDestination: Destination sheet missing Destination header');
    return null;
  }
  if (doorGroupIdx === -1) {
    // Pre-V3 sheets have no DoorGroupID column — a normal compat case.
    console.info('getDoorGroupIdForDestination: DoorGroupID header missing — returning null');
    return null;
  }

  var destLower = destination.trim().toLowerCase();

  // Row 0 = headers; data starts at row 1
  for (var i = 1; i < data.length; i++) {
    var rowDest = String(data[i][destIdx] || '').trim().toLowerCase();
    if (rowDest === destLower) {
      var dgId = data[i][doorGroupIdx];
      if (dgId === '' || dgId === undefined || dgId === null) return null;
      var num = parseInt(dgId, 10);
      return isNaN(num) ? null : num;
    }
  }

  return null;
}

/**
 * Find the first available (unassigned) card in the cardno sheet.
 * Pure read — does NOT modify the sheet.
 * @param {string} accessLevel — Currently unused (reserved for future access-level-based filtering)
 * @param {string} sheetId — The Google Sheet ID
 * @param {number|null} doorGroupId — When provided, only cards whose DoorGroupID (col 5) matches are eligible.
 *   Cards with an empty DoorGroupID never qualify for a group-scoped pick.
 *   When null/undefined, falls back to any available card (legacy behaviour).
 * @returns {string|null} The CardNo value, or null if the pool is depleted
 */
function pickUnusedCard(accessLevel, sheetId, doorGroupId) {
  var cardSheet = getCardnoSheet(sheetId);
  if (!cardSheet) return null;

  var data = cardSheet.getDataRange().getValues();

  // Resolve required/optional columns by header name (header-agnostic).
  var cols = resolveColumns(data, ['CardNo', 'Status', 'DoorGroupID']);
  var cardNoIdx = cols['CardNo'];
  var statusIdx = cols['Status'];
  var doorGroupIdx = cols['DoorGroupID'];

  if (cardNoIdx === -1 || statusIdx === -1) {
    console.error('pickUnusedCard: cardno sheet missing required CardNo/Status headers — aborting');
    return null;
  }

  // If a door group was requested but the sheet has no DoorGroupID column,
  // fall back to a legacy any-Available pick rather than failing the check-in.
  var groupScoped = doorGroupId !== null && doorGroupId !== undefined;
  if (groupScoped && doorGroupIdx === -1) {
    console.warn('pickUnusedCard: DoorGroupID header missing but doorGroupId=' + doorGroupId +
                 ' requested — falling back to any-Available pick');
    groupScoped = false;
  }

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][statusIdx] || '').trim().toLowerCase();
    if (status !== 'available' && status !== '') continue;

    // Door-group scoped pick: card must carry the requested group.
    if (groupScoped) {
      var cardGroup = String(data[i][doorGroupIdx] || '').trim();
      if (cardGroup !== String(doorGroupId).trim()) continue;
    }

    return String(data[i][cardNoIdx] || '').trim();
  }

  return null; // Pool depleted — no Available cards for this door group
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

  // Resolve required columns by header name (header-agnostic).
  var cols = resolveColumns(data, ['CardNo', 'Status', 'AssignedTo', 'AssignedAt']);
  var cardNoIdx = cols['CardNo'];
  var statusIdx = cols['Status'];
  var assignedToIdx = cols['AssignedTo'];
  var assignedAtIdx = cols['AssignedAt'];

  if (cardNoIdx === -1 || statusIdx === -1 || assignedToIdx === -1 || assignedAtIdx === -1) {
    console.error('assignCard: cardno sheet missing required headers (CardNo/Status/AssignedTo/AssignedAt)');
    return false;
  }

  for (var i = 1; i < data.length; i++) {
    var rowCardNo = String(data[i][cardNoIdx] || '').trim();
    if (rowCardNo === cardNo) {
      // Atomic write: mark Status, AssignedTo, AssignedAt at resolved indices.
      cardSheet.getRange(i + 1, statusIdx + 1).setValue('Assigned');        // Status
      cardSheet.getRange(i + 1, assignedToIdx + 1).setValue(visitorNumber); // AssignedTo
      cardSheet.getRange(i + 1, assignedAtIdx + 1).setValue(new Date());    // AssignedAt

      // Optimistic re-read to verify the write took (per-column at resolved indices).
      var checkStatus = cardSheet.getRange(i + 1, statusIdx + 1).getValue();
      var checkAssignedTo = cardSheet.getRange(i + 1, assignedToIdx + 1).getValue();
      if (checkStatus !== 'Assigned' || checkAssignedTo !== visitorNumber) {
        console.error('assignCard: Concurrency check FAILED for card ' + cardNo +
                      ' — expected Assigned/' + visitorNumber +
                      ', got ' + checkStatus + '/' + checkAssignedTo);
        return false;
      }

      return true;
    }
  }

  console.warn('assignCard: Card number ' + cardNo + ' not found in cardno sheet');
  return false;
}

/**
 * Orchestrator: ties together access level lookup → card picking → assignment.
 * Called from handleStatusUpdate when a visitor is checked in. Email dispatch
 * is handled by the caller (outside the lock) via sendCardAssignmentEmail.
 *
 * @param {string} visitorNumber
 * @param {string} fullName
 * @param {string} destination
 * @param {string} sheetId
 * @returns {{ cardNo: string|null, cardQRUrl: string|null, status: string }}
 */
function assignCardForVisitor(visitorNumber, fullName, destination, sheetId) {
  // 1. Resolve access level and door group from the visitor's destination
  var accessLevel = getAccessLevelForDestination(destination, sheetId);
  var doorGroupId = getDoorGroupIdForDestination(destination, sheetId);

  // 2. Pick an unused card (door-group scoped when destination maps to one)
  var cardNo = pickUnusedCard(accessLevel, sheetId, doorGroupId);

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
function sendCardAssignmentEmail(toEmail, cardNo, visitorName, visitorNumber, sheetId) {
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

  enqueueEmail(sheetId, 'card', toEmail, subject, htmlBody);

  console.log('Card assignment email queued for ' + toEmail + ' for card ' + cardNo);
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
 * @param {Spreadsheet} [ss] — Optional pre-opened spreadsheet handle (avoids a second openById)
 * @returns {(string|boolean)} The released card number, or false if not found
 */
function releaseCardForVisitor(visitorNumber, sheetId, ss) {
  if (!visitorNumber || !sheetId) return false;
  try {
    if (!ss) ss = SpreadsheetApp.openById(sheetId);
    var cardSheet = ss.getSheetByName('cardno');
    if (!cardSheet) return false;

    var data = cardSheet.getDataRange().getValues();

    var cols = resolveColumns(data, ['CardNo', 'Status', 'AssignedTo', 'AssignedAt']);
    var cardNoIdx = cols['CardNo'];
    var statusIdx = cols['Status'];
    var assignedToIdx = cols['AssignedTo'];
    var assignedAtIdx = cols['AssignedAt'];

    if (cardNoIdx === -1 || statusIdx === -1 || assignedToIdx === -1 || assignedAtIdx === -1) {
      console.error('releaseCardForVisitor: cardno sheet missing required headers — cannot release');
      return false;
    }

    for (var i = 1; i < data.length; i++) {
      var assignedTo = String(data[i][assignedToIdx] || '').trim();
      if (assignedTo === visitorNumber.trim()) {
        var cardNumber = String(data[i][cardNoIdx] || '').trim();
        // Per-column writes at resolved indices (no assumption of contiguity).
        cardSheet.getRange(i + 1, statusIdx + 1).setValue('Available');
        cardSheet.getRange(i + 1, assignedToIdx + 1).setValue('');
        cardSheet.getRange(i + 1, assignedAtIdx + 1).setValue('');
        return cardNumber;
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

    // Resolve columns once from the header row (stable across iterations).
    var headerValues = sheet.getDataRange().getValues();
    var cols = resolveColumns(headerValues, ['Visitor Number', 'Status', 'Sign-In Time', 'Sign-Out Time']);

    if (cols['Visitor Number'] === -1 || cols['Status'] === -1 ||
        cols['Sign-In Time'] === -1 || cols['Sign-Out Time'] === -1) {
      return jsonResponse({ status: 'error', error: 'VisitorLog headers missing required columns' }, 500);
    }

    var visitorNumberIdx = cols['Visitor Number'];
    var statusIdx = cols['Status'];
    var signInIdx = cols['Sign-In Time'];
    var signOutIdx = cols['Sign-Out Time'];

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
          var rowVn = String(values[i][visitorNumberIdx] || '').trim();
          if (rowVn !== vn) continue;

          found = true;
          var currentStatus = String(values[i][statusIdx] || '').trim();

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

          // Write Signed Out status + timestamp at resolved indices.
          sheet.getRange(i + 1, statusIdx + 1).setValue('Signed Out');
          sheet.getRange(i + 1, signOutIdx + 1).setValue(new Date());

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
 * Get or create the Settings tab in a customer sheet.
 * Settings tab is a key-value table:
 *   | Setting              | Value     |
 *   |----------------------|-----------|
 *   | autoSignOutEnabled   | TRUE      |
 *   | autoSignOutHour      | 21        |
 *   | guardPin             | 1234      |
 *
 * Creates the tab with defaults if missing.
 * Auto-adds any missing default rows to existing tabs.
 */
function getOrCreateSettingsTab_(ss) {
  var tab = ss.getSheetByName('Settings');
  if (!tab) {
    tab = ss.insertSheet('Settings');
    tab.getRange(1, 1, 1, 2).setValues([['Setting', 'Value']]);
    tab.autoResizeColumns(1, 2);
    console.log('getOrCreateSettingsTab_: Created Settings tab');
  }

  // Ensure default rows exist (handles both new and existing tabs)
  ensureSettingRow_(tab, 'autoSignOutEnabled', 'TRUE');
  ensureSettingRow_(tab, 'autoSignOutHour', '21');
  ensureSettingRow_(tab, 'guardPin', '1234');
  ensureSettingRow_(tab, 'timezone', '');
  // Keep the informational Note in sync with the new per-customer schedule
  // (v1.12.0 said "daily at 19:00 WIB (fixed)").
  _setSettingValue_(tab, 'Note', 'Auto sign-out runs at the configured hour in the customer timezone.');

  return tab;
}

/** Append a setting row to the Settings tab if the key doesn't exist. */
function ensureSettingRow_(tab, key, defaultValue) {
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toLowerCase() === key.toLowerCase()) {
      return; // already exists
    }
  }
  var nextRow = data.length + 1;
  tab.getRange(nextRow, 1, 1, 2).setValues([[key, defaultValue]]);
  tab.autoResizeColumns(1, 2);
  console.log('ensureSettingRow_: Added ' + key + ' = ' + defaultValue);
}

/**
 * Set a setting row's value in-place if the key exists (only writing when the
 * value actually changes), otherwise append it. Used to migrate the Note text
 * without touching user-customizable settings.
 */
function _setSettingValue_(tab, key, value) {
  var data = tab.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toLowerCase() === key.toLowerCase()) {
      if (String(data[i][1] || '') !== value) {
        tab.getRange(i + 1, 2).setValue(value);
      }
      return;
    }
  }
  ensureSettingRow_(tab, key, value);
}

/**
 * Read all settings from a customer sheet's Settings tab.
 * Returns { enabled: boolean, hour: number, guardPin: string, timezone: string|null }.
 * Creates the tab with defaults if missing.
 */
function getSheetSettings_(sheetId) {
  try {
    var ss = _openSheetCached(sheetId);
    var tab = getOrCreateSettingsTab_(ss);
    var data = tab.getDataRange().getValues();

    var enabled = true;      // default
    var hour = 21;           // default
    var guardPin = '1234';   // default
    var timezone = null;     // default (inherit master config or project tz)

    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0] || '').trim().toLowerCase();
      var val = String(data[i][1] || '').trim();

      if (key === 'autosignoutenabled') {
        enabled = val.toUpperCase() === 'TRUE';
      } else if (key === 'autosignouthour') {
        var parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
          hour = parsed;
        }
      } else if (key === 'guardpin') {
        guardPin = val;
      } else if (key === 'timezone') {
        if (val) timezone = val;
      }
    }

    return { enabled: enabled, hour: hour, guardPin: guardPin, timezone: timezone };
  } catch (e) {
    console.warn('getSheetSettings_: Error reading sheet ' + sheetId + ': ' + e.message);
    return { enabled: false, hour: -1, guardPin: '1234', timezone: null };
  }
}

/**
 * Read the pending auto sign-out queue (sheetIds that matched the hourly gate
 * in a prior run but were left unprocessed due to the 6-minute batch cap).
 * Returns an array (empty if none / corrupt).
 */
function _readPendingAutoSignOut_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('AUTO_SIGNOUT_PENDING');
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * Persist the pending auto sign-out queue. Empty array deletes the property so
 * a completed batch never leaves a stale queue behind.
 */
function _writePendingAutoSignOut_(ids) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!ids || ids.length === 0) {
      props.deleteProperty('AUTO_SIGNOUT_PENDING');
    } else {
      props.setProperty('AUTO_SIGNOUT_PENDING', JSON.stringify(ids));
    }
  } catch (e) {
    console.warn('autoSignOut: failed to write AUTO_SIGNOUT_PENDING: ' + e.message);
  }
}

/**
 * Auto sign-out of checked-in visitors, gated per customer by their own
 * timezone and autoSignOutHour (HOURLY trigger). Each tick:
 *   1. Resumes any pending batch left over from a prior 6-minute-capped run.
 *   2. Finds active customers whose configured hour matches the current hour
 *      in their timezone.
 *   3. Processes up to AUTO_SIGNOUT_BATCH_CAP sheets, queueing the rest in
 *      Script Properties AUTO_SIGNOUT_PENDING for the next tick.
 *
 * autoSignOutEnabled / autoSignOutHour are read from MASTER CONFIG only — the
 * Settings tab is UI-display-only, and reading it per-sheet at ~100-customer
 * scale is too expensive.
 */
function autoSignOut() {
  // Self-heal: ensure triggers are installed (in case they were cleared by redeploy)
  ensureTriggersInstalled();

  // Hourly run — guard against concurrent executions. Reduced from 120s to 30s:
  // the hourly window is a full hour wide and a stale lock must never hold a
  // whole hour's worth of ticks.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn('autoSignOut: Could not acquire lock — another instance is running, skipping');
    return;
  }

  try {
    var now = new Date(); // snapshot ONCE — the hour must not roll mid-run
    var AUTO_SIGNOUT_BATCH_CAP = 40;

    var masterConfig = _loadMasterConfig();

    // ── Build the ordered candidate list ──
    // Pending (already due from a prior capped run) first, then newly-matched.
    var candidates = [];
    var seen = {};

    var pending = _readPendingAutoSignOut_();
    for (var p = 0; p < pending.length; p++) {
      var pid = pending[p];
      if (!pid || seen[pid]) continue;
      var pe = masterConfig[pid];
      if (!pe || pe.status !== 'active') continue; // stale/missing — drop
      seen[pid] = true;
      candidates.push({ sheetId: pid, tz: pe.timezone || Session.getScriptTimeZone() });
    }

    for (var sid in masterConfig) {
      var entry = masterConfig[sid];
      if (entry.status !== 'active') continue;
      if (!entry.autoSignOutEnabled) continue; // per-customer opt-out (master config)
      if (seen[sid]) continue;

      var customerTz = entry.timezone || Session.getScriptTimeZone();
      var customerHourStr = Utilities.formatDate(now, customerTz, 'HH');
      if (parseInt(customerHourStr, 10) !== entry.autoSignOutHour) continue;

      seen[sid] = true;
      candidates.push({ sheetId: sid, tz: customerTz });
    }

    if (candidates.length === 0) {
      console.log('autoSignOut: No customers due for sign-out at this tick');
      return;
    }

    // ── Cap at AUTO_SIGNOUT_BATCH_CAP; queue the remainder for the next tick ──
    var processIds = candidates.slice(0, AUTO_SIGNOUT_BATCH_CAP);
    var remainingIds = [];
    for (var r = AUTO_SIGNOUT_BATCH_CAP; r < candidates.length; r++) {
      remainingIds.push(candidates[r].sheetId);
    }
    _writePendingAutoSignOut_(remainingIds);

    console.log('autoSignOut: Processing ' + processIds.length + ' customer(s), ' + remainingIds.length + ' queued for next tick');

    for (var s = 0; s < processIds.length; s++) {
      var sheetId = processIds[s].sheetId;
      var customerTz = processIds[s].tz;
      if (!sheetId) continue;

      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('VisitorLog');
        if (!sheet) {
          console.log('autoSignOut: No VisitorLog sheet for ' + sheetId + ' — skipping');
          continue;
        }

        var data = sheet.getDataRange().getValues();

        var cols = resolveColumns(data, ['Status', 'Visitation Date', 'Visitor Number', 'Sign-In Time', 'Sign-Out Time']);
        var statusIdx = cols['Status'];
        var visitationDateIdx = cols['Visitation Date'];
        var visitorNumberIdx = cols['Visitor Number'];
        var signInIdx = cols['Sign-In Time'];
        var signOutIdx = cols['Sign-Out Time'];

        if (statusIdx === -1 || visitationDateIdx === -1 || visitorNumberIdx === -1 ||
            signInIdx === -1 || signOutIdx === -1) {
          console.error('autoSignOut: VisitorLog missing required headers for sheet ' + sheetId + ' — skipping');
          continue;
        }

        // Customer-local "today" for the idempotency guard.
        var customerTodayStr = Utilities.formatDate(now, customerTz, 'yyyy-MM-dd');

        // Find dirty rows: today's "Checked In" visitors (idempotency guard).
        var dirty = {};        // 0-indexed data row -> true
        var dirtyRows = [];    // 0-indexed data rows, ascending
        var minRow = -1;
        var maxRow = -1;
        for (var i = 1; i < data.length; i++) {
          var status = String(data[i][statusIdx] || '').trim();
          if (status === 'Checked In' && getDateString_(data[i][visitationDateIdx], customerTz) === customerTodayStr) {
            dirty[i] = true;
            dirtyRows.push(i);
            if (minRow === -1 || i < minRow) minRow = i;
            if (i > maxRow) maxRow = i;
          }
        }

        if (dirtyRows.length === 0) {
          console.log('autoSignOut: No checked-in visitors for sheet ' + sheetId);
          continue;
        }

        // Only use a single multi-column range when Status / Sign-In Time /
        // Sign-Out Time are contiguous (canonical layout: signIn = status+1,
        // signOut = status+2). Otherwise fall back to per-row writes.
        var contiguous = (signInIdx === statusIdx + 1 && signOutIdx === statusIdx + 2);
        if (contiguous) {
          // Write Status + Sign-Out Time in ONE setValues() over the minimal
          // bounding range, preserving Sign-In Time and any non-dirty rows
          // inside the span.
          var numRows = maxRow - minRow + 1;
          var block = [];
          for (var r = 0; r < numRows; r++) {
            var dataIdx = minRow + r;
            if (dirty[dataIdx]) {
              block.push(['Signed Out', data[dataIdx][signInIdx], now]);
            } else {
              block.push([data[dataIdx][statusIdx], data[dataIdx][signInIdx], data[dataIdx][signOutIdx]]);
            }
          }
          sheet.getRange(minRow + 1, statusIdx + 1, numRows, 3).setValues(block);
        } else {
          for (var d = 0; d < dirtyRows.length; d++) {
            var dataIdx = dirtyRows[d];
            sheet.getRange(dataIdx + 1, statusIdx + 1).setValue('Signed Out');
            sheet.getRange(dataIdx + 1, signOutIdx + 1).setValue(now);
          }
        }

        // Release cards for each signed-out visitor (reuse the open ss handle).
        var releasedCount = 0;
        for (var d = 0; d < dirtyRows.length; d++) {
          var visitorNumber = String(data[dirtyRows[d]][visitorNumberIdx] || '').trim();
          if (!visitorNumber) continue;
          if (releaseCardForVisitor(visitorNumber, sheetId, ss)) releasedCount++;
        }

        console.log('autoSignOut: Signed out ' + dirtyRows.length + ' visitor(s), released ' + releasedCount + ' card(s) for sheet ' + sheetId);
      } catch (e) {
        console.error('autoSignOut: Error for sheet ' + sheetId + ': ' + e.message);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Install or reinstall the HOURLY auto sign-out time-driven trigger.
 * Removes any existing autoSignOut triggers first to avoid duplicates.
 * The per-customer hour gating happens inside autoSignOut().
 */
function setupAutoSignOutTrigger() {
  // Remove existing auto sign-out triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoSignOut') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Install hourly trigger — autoSignOut() gates per customer timezone/hour.
  ScriptApp.newTrigger('autoSignOut')
    .timeBased()
    .everyHours(1)
    .create();
  console.log('setupAutoSignOutTrigger: Hourly auto sign-out trigger installed');
}

/**
 * Multi-customer catch-up sweep: signs out any visitor still "Checked In" from
 * a previous day (stragglers left behind by a failed hourly autoSignOut run) and
 * releases their cards. Called by a daily time-driven trigger at 02:00.
 * Falls back to the legacy single-sheet SHEET_ID behavior if no active
 * customers are configured in the master config.
 */
function releaseDailyCards() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) {
    console.warn('releaseDailyCards: Could not acquire lock — another instance is running, skipping');
    return;
  }

  try {
    // Keep the PROJECT timezone for the straggler criterion ("not today").
    // Card release is a nightly global sweep, not a per-customer schedule, so
    // a customer-local timezone could misclassify late-night visitors as
    // stragglers (or vice-versa). We pass the project tz explicitly for clarity.
    var timeZone = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');

    // Load active customers from master config.
    var masterConfig = _loadMasterConfig();
    var activeIds = [];
    for (var sid in masterConfig) {
      if (masterConfig[sid].status === 'active') activeIds.push(sid);
    }

    // Fallback: if no active customers in master config, use legacy SHEET_ID
    // so nothing silently stops for single-sheet deployments.
    if (activeIds.length === 0) {
      var legacySheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
      if (!legacySheetId) {
        console.warn('releaseDailyCards: No active customers and SHEET_ID not configured — nothing to release');
        return;
      }
      activeIds.push(legacySheetId);
      console.log('releaseDailyCards: No active customers in master config — falling back to SHEET_ID');
    }

    var totalSignedOut = 0;
    var totalReleased = 0;

    for (var s = 0; s < activeIds.length; s++) {
      var sheetId = activeIds[s].trim();
      if (!sheetId) continue;

      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('VisitorLog');
        if (!sheet) {
          console.log('releaseDailyCards: No VisitorLog sheet for ' + sheetId + ' — skipping');
          continue;
        }

        var data = sheet.getDataRange().getValues();

        var cols = resolveColumns(data, ['Status', 'Visitation Date', 'Visitor Number', 'Sign-In Time', 'Sign-Out Time']);
        var statusIdx = cols['Status'];
        var visitationDateIdx = cols['Visitation Date'];
        var visitorNumberIdx = cols['Visitor Number'];
        var signInIdx = cols['Sign-In Time'];
        var signOutIdx = cols['Sign-Out Time'];

        if (statusIdx === -1 || visitationDateIdx === -1 || visitorNumberIdx === -1 ||
            signInIdx === -1 || signOutIdx === -1) {
          console.error('releaseDailyCards: VisitorLog missing required headers for sheet ' + sheetId + ' — skipping');
          continue;
        }

        // Find dirty rows: yesterday's-or-older visitors still "Checked In".
        var dirty = {};
        var dirtyRows = [];
        var minRow = -1;
        var maxRow = -1;
        for (var i = 1; i < data.length; i++) {
          var status = String(data[i][statusIdx] || '').trim();
          if (status === 'Checked In' && getDateString_(data[i][visitationDateIdx], timeZone) !== todayStr) {
            dirty[i] = true;
            dirtyRows.push(i);
            if (minRow === -1 || i < minRow) minRow = i;
            if (i > maxRow) maxRow = i;
          }
        }

        if (dirtyRows.length === 0) {
          console.log('releaseDailyCards: No stragglers for sheet ' + sheetId);
          continue;
        }

        // Only use a single multi-column range when Status / Sign-In Time /
        // Sign-Out Time are contiguous (canonical layout: signIn = status+1,
        // signOut = status+2). Otherwise fall back to per-row writes.
        var now = new Date();
        var contiguous = (signInIdx === statusIdx + 1 && signOutIdx === statusIdx + 2);
        if (contiguous) {
          // One setValues() over the minimal bounding range, preserving
          // Sign-In Time and any non-dirty rows inside the span.
          var numRows = maxRow - minRow + 1;
          var block = [];
          for (var r = 0; r < numRows; r++) {
            var dataIdx = minRow + r;
            if (dirty[dataIdx]) {
              block.push(['Signed Out', data[dataIdx][signInIdx], now]);
            } else {
              block.push([data[dataIdx][statusIdx], data[dataIdx][signInIdx], data[dataIdx][signOutIdx]]);
            }
          }
          sheet.getRange(minRow + 1, statusIdx + 1, numRows, 3).setValues(block);
        } else {
          for (var d = 0; d < dirtyRows.length; d++) {
            var dataIdx = dirtyRows[d];
            sheet.getRange(dataIdx + 1, statusIdx + 1).setValue('Signed Out');
            sheet.getRange(dataIdx + 1, signOutIdx + 1).setValue(now);
          }
        }

        // Release cards for each signed-out visitor (reuse the open ss handle).
        var releasedCount = 0;
        for (var d = 0; d < dirtyRows.length; d++) {
          var visitorNumber = String(data[dirtyRows[d]][visitorNumberIdx] || '').trim();
          if (!visitorNumber) continue;
          if (releaseCardForVisitor(visitorNumber, sheetId, ss)) releasedCount++;
        }

        console.log('releaseDailyCards: Signed out ' + dirtyRows.length + ' straggler(s), released ' + releasedCount + ' card(s) for sheet ' + sheetId);
        totalSignedOut += dirtyRows.length;
        totalReleased += releasedCount;
      } catch (e) {
        console.error('releaseDailyCards: Error for sheet ' + sheetId + ': ' + e.message);
      }
    }

    console.log('releaseDailyCards: Signed out ' + totalSignedOut + ' visitor(s), released ' + totalReleased + ' card(s) across ' + activeIds.length + ' sheet(s)');
  } finally {
    lock.releaseLock();
  }
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
// RETENTION PURGE (daily, time-driven at 02:05)
// ──────────────────────────────────────────────

/**
 * Compute the retention cutoff as a local-midnight Date exactly `retentionDays`
 * days ago. A VisitorLog row is eligible for purge when its Visitation Date is
 * STRICTLY older than this cutoff; a row dated exactly `retentionDays` days ago
 * is NOT purged.
 *
 * @param {number} retentionDays - Positive integer number of days to retain
 * @returns {Date} Local-midnight cutoff Date (no time component)
 */
function computeCutoffDate_(retentionDays) {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays, 0, 0, 0, 0);
}

/**
 * Strict ISO-8601 date parser for retention purging. Accepts ONLY `yyyy-MM-dd`
 * and returns a local-midnight Date via the integer-split constructor. Never
 * falls back to `new Date(str)` (the UTC-midnight trap) and never guesses
 * localized formats — unparseable input returns null so the caller can skip it
 * and log (never guess).
 *
 * @param {*} str - Cell value to parse (string expected)
 * @returns {Date|null} Local-midnight Date, or null if not a valid ISO date
 */
function parseRetentionDate_(str) {
  if (typeof str !== 'string') return null;
  var s = str.trim();
  if (!s) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  var y = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  var d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  var out = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (isNaN(out.getTime())) return null;
  return out;
}

/**
 * Compute today's date as a local-midnight Date in the given IANA timezone.
 * Thin wrapper: format "now" into the target tz ('yyyy-MM-dd' via
 * Utilities.formatDate), then re-parse that string with parseRetentionDate_
 * so the result is a local-midnight Date (no UTC-midnight trap). Falls back to
 * the script project timezone if `tz` is empty or not a valid IANA zone.
 *
 * @param {string} tz - IANA timezone string (may be empty/invalid)
 * @returns {Date} Local-midnight Date for today in the effective timezone
 */
function computeTodayLocalMidnight_(tz) {
  var effectiveTz = (tz && _isValidTimeZone_(tz)) ? tz : Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), effectiveTz, 'yyyy-MM-dd');
  return parseRetentionDate_(todayStr);
}

/**
 * Derive a customer's expiry state — the SINGLE SOURCE OF TRUTH for per-customer
 * subscription expiry. Expiry is NEVER stored as a status column; it is derived
 * from the customer's `expiryDate` (raw ISO string) on every call. Returns:
 *   - 'none'     → no expiryDate configured (or unparseable)
 *   - 'active'   → expiryDate is more than expiryWarningDays away
 *   - 'expiring' → within the warning window (remainingDays <= expiryWarningDays,
 *                  including remainingDays === 0 — the expiry date itself)
 *   - 'expired'  → remainingDays < 0 (today is strictly after the expiry date)
 *
 * Same-day boundary: the customer is valid THROUGH the expiryDate day. On the
 * expiry date remainingDays === 0 → 'expiring' (still allowed). The daily pass
 * materializes status='disabled' the NEXT morning once remainingDays < 0.
 *
 * Timezone: the day boundary is evaluated in the customer's master-config
 * timezone (fallback: script project timezone), so "today" means the customer's
 * local today, not the GAS project's.
 *
 * @param {Object} customer - Master config entry (must carry expiryDate,
 *   expiryWarningDays, timezone, sheetId)
 * @param {Date} [now] - Reference "now" (defaults to new Date()); injectable
 *   for deterministic testing
 * @returns {Object} { expiryState: 'none'|'active'|'expiring'|'expired',
 *   remainingDays: number|null }
 */
function computeExpiryState_(customer, now) {
  // No expiry configured → not time-limited.
  if (!customer.expiryDate) {
    return { expiryState: 'none', remainingDays: null };
  }

  var expiryDateLocalMidnight = parseRetentionDate_(customer.expiryDate);
  if (expiryDateLocalMidnight === null) {
    console.warn('computeExpiryState_: unparseable expiryDate "' + customer.expiryDate + '" for ' + customer.sheetId + ' — treating as no expiry');
    return { expiryState: 'none', remainingDays: null };
  }

  var todayLocalMidnight = computeTodayLocalMidnight_(customer.timezone);
  var remainingDays = Math.round((expiryDateLocalMidnight - todayLocalMidnight) / 86400000);

  // Warning window is the customer's configured expiryWarningDays (default 7).
  var warningDays = customer.expiryWarningDays;
  if (warningDays === undefined || warningDays === null || isNaN(warningDays)) warningDays = 7;

  if (remainingDays < 0) return { expiryState: 'expired', remainingDays: remainingDays };
  if (remainingDays === 0) return { expiryState: 'expiring', remainingDays: remainingDays };
  if (remainingDays <= warningDays) return { expiryState: 'expiring', remainingDays: remainingDays };
  return { expiryState: 'active', remainingDays: remainingDays };
}

/**
 * Extract a Google Drive file ID from a Drive URL of the form
 * https://drive.google.com/file/d/<FILE_ID>/view (or /open, /preview, etc.).
 * Returns null when the input is not a string, is empty, or does not contain a
 * recognizable 25+ character Drive file ID.
 *
 * @param {*} url - Cell value (string expected)
 * @returns {string|null} Drive file ID, or null if none found
 */
function extractDriveFileId_(url) {
  if (typeof url !== 'string') return null;
  if (!url) return null;
  var m = /\/d\/([a-zA-Z0-9_-]{25,})\//.exec(url);
  if (!m) return null;
  return m[1];
}

/**
 * Log a retention purge result to the PurgeLog tab of the master config sheet.
 * Creates the tab with headers if it does not already exist. Analogous to
 * logDeniedRequest, but always wrapped so a PurgeLog write failure never aborts
 * the retention run.
 *
 * @param {Object} entry - { sheetId, rowsPurged, photosTrashed,
 *   rowsSkippedUnparseable, rowsSkippedEmpty, photoErrors }
 */
function logPurge_(entry) {
  try {
    var sheet = _getMasterConfigSheet();
    if (!sheet) return;
    var purgeSheet = sheet.getSheetByName('PurgeLog');
    if (!purgeSheet) {
      purgeSheet = sheet.insertSheet('PurgeLog');
      purgeSheet.appendRow(['Timestamp', 'SheetId', 'RowsPurged', 'PhotosTrashed', 'RowsSkippedUnparseable', 'RowsSkippedEmpty', 'PhotoErrors']);
    }
    purgeSheet.appendRow([
      new Date(),
      entry.sheetId || '',
      entry.rowsPurged || 0,
      entry.photosTrashed || 0,
      entry.rowsSkippedUnparseable || 0,
      entry.rowsSkippedEmpty || 0,
      entry.photoErrors || 0
    ]);
  } catch (e) {
    console.error('Failed to log retention purge: ' + e.message);
  }
}

/**
 * Log a per-customer expiry event to the ExpiryLog tab of the master config
 * sheet. Creates the tab with headers if it does not already exist. Mirrors
 * logPurge_: always wrapped so an ExpiryLog write failure never aborts the
 * expiry run.
 *
 * @param {Object} entry - { sheetId, expiryDate, remainingDays, action,
 *   previousStatus }
 */
function logExpiry_(entry) {
  try {
    var sheet = _getMasterConfigSheet();
    if (!sheet) return;
    var expirySheet = sheet.getSheetByName('ExpiryLog');
    if (!expirySheet) {
      expirySheet = sheet.insertSheet('ExpiryLog');
      expirySheet.appendRow(['Timestamp', 'SheetId', 'ExpiryDate', 'RemainingDays', 'Action', 'PreviousStatus']);
    }
    expirySheet.appendRow([
      new Date(),
      entry.sheetId || '',
      entry.expiryDate || '',
      entry.remainingDays !== undefined && entry.remainingDays !== null ? entry.remainingDays : '',
      entry.action || '',
      entry.previousStatus || ''
    ]);
  } catch (e) {
    console.error('Failed to log expiry: ' + e.message);
  }
}

/**
 * Write a customer's status cell in the master config Customers tab. Resolves
 * columns by header name (sheetId + status), scans for the matching sheetId,
 * and sets the status cell. Flushes the write and invalidates the master config
 * cache so the next validateRequest reads the fresh status. Always wrapped so a
 * status write failure never aborts the expiry run.
 *
 * @param {string} sheetId - Customer's Google Sheet ID
 * @param {string} newStatus - New status value to write (e.g. 'disabled')
 * @returns {boolean} true if the write succeeded, false otherwise
 */
function setCustomerStatus(sheetId, newStatus) {
  try {
    var sheet = _getMasterConfigSheet();
    if (!sheet) {
      console.error('setCustomerStatus: master config sheet not accessible');
      return false;
    }
    var custSheet = sheet.getSheetByName('Customers');
    if (!custSheet) {
      console.error('setCustomerStatus: Customers tab not found in master config');
      return false;
    }

    var data = custSheet.getDataRange().getValues();
    var cols = resolveColumns(data, ['sheetId', 'status']);
    var sidIdx = cols['sheetId'];
    var statusIdx = cols['status'];
    if (sidIdx === -1 || statusIdx === -1) {
      console.error('setCustomerStatus: Customers tab missing sheetId/status headers');
      return false;
    }

    for (var i = 1; i < data.length; i++) {
      var sid = String(data[i][sidIdx] || '').trim();
      if (sid === sheetId) {
        custSheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
        SpreadsheetApp.flush(); // Ensure write is committed
        _invalidateMasterConfigCache_();
        return true;
      }
    }

    console.warn('setCustomerStatus: sheetId ' + sheetId + ' not found in Customers tab');
    return false;
  } catch (e) {
    console.error('setCustomerStatus: ' + e.message);
    return false;
  }
}

// ══════════════════════════════════════════════
// USTARAPI BRIDGE (M8) — shared sign-out path + sign-out webhook + assigned-cards query
// ══════════════════════════════════════════════

/**
 * Shared sign-out write path (M8 §3.3): flips a visitor's Status to "Signed Out", writes the
 * Sign-Out Time, and releases their assigned card back to the pool. Single source of truth for
 * the flip-status + time + release-card sequence, used by BOTH the guard portal
 * (handleStatusUpdate) and the UStarAPI signOutByCard webhook. Callers must hold the script lock
 * (LockService) before calling — the write/release is not internally serialized.
 *
 * @param {string} sheetId - Customer spreadsheet id
 * @param {string} visitorNumber - Visitor number to sign out
 * @param {Date} [signOutTime] - Sign-Out Time to record (defaults to now)
 * @returns {object} { outcome: 'signed_out'|'already_signed_out'|'not_checked_in'|'not_found', cardNo?: string }
 */
function _signOutVisitor_(sheetId, visitorNumber, signOutTime) {
  var sheet = getOrCreateSheet(sheetId);
  var values = sheet.getDataRange().getValues();

  var cols = resolveColumns(values, ['Visitor Number', 'Status', 'Sign-Out Time']);
  if (cols['Visitor Number'] === -1 || cols['Status'] === -1 || cols['Sign-Out Time'] === -1) {
    throw new Error('VisitorLog headers missing required columns');
  }
  var visitorNumberIdx = cols['Visitor Number'];
  var statusIdx = cols['Status'];
  var signOutIdx = cols['Sign-Out Time'];

  for (var i = 1; i < values.length; i++) {
    var vn = String(values[i][visitorNumberIdx] || '').trim();
    if (vn !== visitorNumber.trim()) continue;

    var currentStatus = String(values[i][statusIdx] || '').trim();
    if (currentStatus === 'Signed Out') {
      return { outcome: 'already_signed_out' };
    }
    if (currentStatus !== 'Checked In') {
      return { outcome: 'not_checked_in' };
    }

    sheet.getRange(i + 1, statusIdx + 1).setValue('Signed Out');
    sheet.getRange(i + 1, signOutIdx + 1).setValue(signOutTime || new Date());

    var releasedCard = false;
    try {
      releasedCard = releaseCardForVisitor(visitorNumber, sheetId);
    } catch (cardErr) {
      console.warn('Card release failed for ' + visitorNumber + ': ' + cardErr.message);
    }

    return { outcome: 'signed_out', cardNo: (releasedCard && releasedCard !== '') ? releasedCard : null };
  }

  return { outcome: 'not_found' };
}

/**
 * Read a single setting value (case-insensitive) from a customer Settings tab.
 * Resolves the 2-col (Setting, Value) layout by header name. Returns the trimmed
 * value, or '' when the key is absent.
 */
function _getSettingValue_(ss, key) {
  var tab = ss.getSheetByName('Settings');
  if (!tab) return '';
  var data = tab.getDataRange().getValues();
  var cols = resolveColumns(data, ['Setting', 'Value']);
  var settingIdx = cols['Setting'];
  var valueIdx = cols['Value'];
  if (settingIdx === -1 || valueIdx === -1) return '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][settingIdx] || '').trim().toLowerCase() === String(key).toLowerCase()) {
      return String(data[i][valueIdx] || '').trim();
    }
  }
  return '';
}

/**
 * Validate the UStar gateway secret against the customer Settings ustarSecret (M8 §2.6).
 * Fails closed: a blank/missing configured secret never matches.
 */
function _checkUstarSecret_(ss, secret) {
  var expected = _getSettingValue_(ss, 'ustarSecret');
  if (!expected) return false;
  return String(secret || '') === expected;
}

/**
 * Parse an OUT-record eventTime (ms epoch) into a Date, or null when absent/invalid.
 */
function _parseEventTime_(eventTime) {
  if (eventTime === undefined || eventTime === null || eventTime === '') return null;
  var ts = parseInt(eventTime, 10);
  if (isNaN(ts)) return null;
  return new Date(ts);
}

/** Coerce a cardno DoorGroupID cell to a number, or null when blank/unparseable. */
function _parseDoorGroupId_(cell) {
  if (cell === '' || cell === undefined || cell === null) return null;
  var n = parseInt(String(cell).trim(), 10);
  return isNaN(n) ? null : n;
}

/** Format a timestamp cell (Date or string) as ISO-8601 for JSON output. */
function _formatTimestamp_(cell) {
  if (!cell) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell);
}

/**
 * UStarAPI sign-out webhook (M8 §3.3). Validates the shared ustarSecret, finds the visitor
 * assigned to the card, and — when the card is Assigned and the visitor Checked In — runs the
 * SAME sign-out path as the guard portal (_signOutVisitor_, LockService-serialized). Idempotent:
 * an unassigned card or an already Signed-Out visitor returns { status: 'noop' } with no error.
 *
 * @param {Object} data - { mode:'signOutByCard', sheetId, cardNo, secret, eventTime? }
 * @returns {TextOutput} { status:'signed_out'|'noop', visitorNumber?, signedOutAt? }
 */
function handleSignOutByCard(data) {
  if (!data.sheetId) {
    return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
  }
  if (!data.cardNo) {
    return jsonResponse({ status: 'error', error: 'Missing cardNo' }, 400);
  }
  if (!data.secret) {
    return jsonResponse({ status: 'error', error: 'LITEVM_UNAUTHORIZED' }, 401);
  }

  var ss;
  try {
    ss = _openSheetCached(data.sheetId);
  } catch (e) {
    return jsonResponse({ status: 'error', error: 'Cannot open sheet: ' + e.message }, 500);
  }

  if (!_checkUstarSecret_(ss, data.secret)) {
    return jsonResponse({ status: 'error', error: 'LITEVM_UNAUTHORIZED' }, 401);
  }

  // 1. Locate the card row and read its assignment status.
  var cardSheet = ss.getSheetByName('cardno');
  if (!cardSheet) {
    return jsonResponse({ status: 'error', error: 'cardno sheet not found' }, 404);
  }
  var cardData = cardSheet.getDataRange().getValues();
  var cols = resolveColumns(cardData, ['CardNo', 'Status', 'AssignedTo']);
  var cardNoIdx = cols['CardNo'];
  var statusIdx = cols['Status'];
  var assignedToIdx = cols['AssignedTo'];
  if (cardNoIdx === -1 || statusIdx === -1 || assignedToIdx === -1) {
    return jsonResponse({ status: 'error', error: 'cardno sheet headers missing required columns' }, 500);
  }

  var visitorNumber = '';
  var cardStatus = '';
  for (var i = 1; i < cardData.length; i++) {
    if (String(cardData[i][cardNoIdx] || '').trim() === String(data.cardNo).trim()) {
      visitorNumber = String(cardData[i][assignedToIdx] || '').trim();
      cardStatus = String(cardData[i][statusIdx] || '').trim();
      break;
    }
  }

  // Card Available / not found / unassigned → nothing to do (idempotent).
  if (!visitorNumber || cardStatus !== 'Assigned') {
    return jsonResponse({ status: 'noop', message: 'card not assigned' }, 200);
  }

  // 2. Run the shared sign-out path, serialized exactly like the guard portal.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return jsonResponse({ status: 'error', message: 'System busy. Please try again.' }, 503);
  }

  try {
    var effectiveTime = _parseEventTime_(data.eventTime) || new Date();
    var result = _signOutVisitor_(data.sheetId, visitorNumber, effectiveTime);

    if (result.outcome === 'signed_out') {
      return jsonResponse({
        status: 'signed_out',
        visitorNumber: visitorNumber,
        cardNo: result.cardNo || data.cardNo,
        signedOutAt: effectiveTime.toISOString(),
      }, 200);
    }

    // already_signed_out / not_checked_in / not_found → idempotent noop.
    if (result.outcome === 'not_found') {
      console.warn('signOutByCard: visitor ' + visitorNumber + ' not found in VisitorLog (card ' + data.cardNo + ')');
    }
    return jsonResponse({ status: 'noop', visitorNumber: visitorNumber }, 200);
  } finally {
    lock.releaseLock();
  }
}

/**
 * UStarAPI read-only query (M8 §4.2): returns every Assigned card with its door group and
 * assignee. DoorGroupID is read directly from the cardno tab column E — no Destination join.
 * No state change.
 *
 * @param {Object} data - { mode:'assignedCards', sheetId, secret }
 * @returns {TextOutput} { status:'ok', cards:[{ cardNo, doorGroupId, visitorNumber, assignedAt }] }
 */
function handleAssignedCards(data) {
  if (!data.sheetId) {
    return jsonResponse({ status: 'error', error: 'Missing sheetId' }, 400);
  }
  if (!data.secret) {
    return jsonResponse({ status: 'error', error: 'LITEVM_UNAUTHORIZED' }, 401);
  }

  var ss;
  try {
    ss = _openSheetCached(data.sheetId);
  } catch (e) {
    return jsonResponse({ status: 'error', error: 'Cannot open sheet: ' + e.message }, 500);
  }

  if (!_checkUstarSecret_(ss, data.secret)) {
    return jsonResponse({ status: 'error', error: 'LITEVM_UNAUTHORIZED' }, 401);
  }

  var cardSheet = ss.getSheetByName('cardno');
  if (!cardSheet) {
    return jsonResponse({ status: 'error', error: 'cardno sheet not found' }, 404);
  }

  var cardData = cardSheet.getDataRange().getValues();
  var cols = resolveColumns(cardData, ['CardNo', 'Status', 'AssignedTo', 'AssignedAt', 'DoorGroupID']);
  var cardNoIdx = cols['CardNo'];
  var statusIdx = cols['Status'];
  var assignedToIdx = cols['AssignedTo'];
  var assignedAtIdx = cols['AssignedAt'];
  var doorGroupIdx = cols['DoorGroupID'];
  if (cardNoIdx === -1 || statusIdx === -1) {
    return jsonResponse({ status: 'error', error: 'cardno sheet headers missing required columns' }, 500);
  }

  var cards = [];
  for (var i = 1; i < cardData.length; i++) {
    if (String(cardData[i][statusIdx] || '').trim() !== 'Assigned') continue;

    cards.push({
      cardNo: String(cardData[i][cardNoIdx] || '').trim(),
      doorGroupId: doorGroupIdx === -1 ? null : _parseDoorGroupId_(cardData[i][doorGroupIdx]),
      visitorNumber: assignedToIdx === -1 ? '' : String(cardData[i][assignedToIdx] || '').trim(),
      assignedAt: assignedAtIdx === -1 ? '' : _formatTimestamp_(cardData[i][assignedAtIdx]),
    });
  }

  return jsonResponse({ status: 'ok', cards: cards }, 200);
}

/**
 * Read the pending retention queue (sheetIds that matched the retention
 * criterion in a prior run but were left unprocessed due to the batch cap).
 * Returns an array (empty if none / corrupt).
 */
function _readPendingRetention_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('RETENTION_PENDING');
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * Persist the pending retention queue. Empty array deletes the property so a
 * completed batch never leaves a stale queue behind.
 */
function _writePendingRetention_(ids) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!ids || ids.length === 0) {
      props.deleteProperty('RETENTION_PENDING');
    } else {
      props.setProperty('RETENTION_PENDING', JSON.stringify(ids));
    }
  } catch (e) {
    console.warn('runRetention: failed to write RETENTION_PENDING: ' + e.message);
  }
}

/**
 * Daily retention purge (time-driven trigger at 02:05). Deletes VisitorLog rows
 * whose Visitation Date is strictly older than the customer's `retentionDays`,
 * INCLUDING no-shows / pending / never-came visitors (visitation-date-only
 * criterion, NO status filter). Photos are moved to Trash (not permanently
 * deleted). Bounded per run: RETENTION_BATCH_CAP sheets, RETENTION_ROW_CAP rows
 * per sheet, RETENTION_PHOTO_CAP Drive ops total — the remainder queues in
 * Script Properties RETENTION_PENDING for the next tick.
 *
 * @param {boolean} [dryRun] - When true, scan + log only; skip deleteRow and
 *   setTrashed. PurgeLog rows are prefixed with '[DRY] '.
 */
function runRetention(dryRun) {
  // Self-heal: ensure triggers are installed (in case they were cleared by redeploy).
  ensureTriggersInstalled();

  // Daily run — guard against concurrent executions. Hold the lock for the
  // entire function (same pattern as autoSignOut).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn('runRetention: Could not acquire lock — another instance is running, skipping');
    return;
  }

  try {
    var RETENTION_BATCH_CAP = 10;
    var RETENTION_ROW_CAP = 50;
    var RETENTION_PHOTO_CAP = 150;

    var masterConfig = _loadMasterConfig();

    // ── Build the ordered candidate list ──
    // Pending (left over from a prior capped run) first, then active customers
    // with a valid retentionDays (not null, not NaN, >= 1).
    var candidates = [];
    var seen = {};

    var pending = _readPendingRetention_();
    for (var p = 0; p < pending.length; p++) {
      var pid = pending[p];
      if (!pid || seen[pid]) continue;
      var pe = masterConfig[pid];
      if (!pe || pe.status !== 'active' || !pe.retentionDays || isNaN(pe.retentionDays) || pe.retentionDays < 1) continue;
      seen[pid] = true;
      candidates.push({ sheetId: pid, retentionDays: pe.retentionDays });
    }

    for (var sid in masterConfig) {
      var entry = masterConfig[sid];
      if (entry.status !== 'active') continue;
      if (!entry.retentionDays || isNaN(entry.retentionDays) || entry.retentionDays < 1) continue;
      if (seen[sid]) continue;
      seen[sid] = true;
      candidates.push({ sheetId: sid, retentionDays: entry.retentionDays });
    }

    if (candidates.length === 0) {
      console.log('runRetention: No customers with retentionDays configured');
      return;
    }

    // ── Cap at RETENTION_BATCH_CAP; queue the remainder for the next tick ──
    var processList = candidates.slice(0, RETENTION_BATCH_CAP);
    var remainingIds = [];
    for (var r = RETENTION_BATCH_CAP; r < candidates.length; r++) {
      remainingIds.push(candidates[r].sheetId);
    }
    _writePendingRetention_(remainingIds);

    console.log('runRetention: Processing ' + processList.length + ' customer(s), ' + remainingIds.length + ' queued for next tick');

    // Run-wide totals (RETENTION_PHOTO_CAP is shared across the whole run).
    var totalRowsPurged = 0;
    var totalPhotosTrashed = 0;
    var totalSkippedUnparseable = 0;
    var totalSkippedEmpty = 0;
    var totalPhotoErrors = 0;
    var totalPhotoOps = 0;

    for (var s = 0; s < processList.length; s++) {
      var sheetId = processList[s].sheetId;
      var retentionDays = processList[s].retentionDays;
      if (!sheetId) continue;

      var rowsPurged = 0;
      var photosTrashed = 0;
      var skippedUnparseable = 0;
      var skippedEmpty = 0;
      var photoErrors = 0;

      try {
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('VisitorLog');
        if (!sheet) {
          console.log('runRetention: No VisitorLog sheet for ' + sheetId + ' — skipping');
          continue;
        }

        var data = sheet.getDataRange().getValues();
        var cols = resolveColumns(data, ['Visitation Date', 'ID Photo (Drive URL)', 'Selfie (Drive URL)']);
        var visitationDateIdx = cols['Visitation Date'];
        var idPhotoIdx = cols['ID Photo (Drive URL)'];
        var selfieIdx = cols['Selfie (Drive URL)'];

        if (visitationDateIdx === -1 || idPhotoIdx === -1 || selfieIdx === -1) {
          console.error('runRetention: VisitorLog missing required headers for sheet ' + sheetId + ' — skipping');
          continue;
        }

        // Local-midnight cutoff: rows strictly older than this are purged.
        var cutoff = computeCutoffDate_(retentionDays);
        var qualifying = []; // 0-based data-row indices, ascending

        for (var i = 1; i < data.length; i++) {
          var cell = data[i][visitationDateIdx];
          var str = getDateString_(cell, Session.getScriptTimeZone());
          if (str === '' || str === null) {
            skippedEmpty++;
            continue;
          }
          var d = parseRetentionDate_(str);
          if (d === null) {
            skippedUnparseable++;
            continue;
          }
          if (d >= cutoff) continue; // not yet eligible (dated exactly retentionDays ago is retained)
          qualifying.push(i);
        }

        if (qualifying.length === 0) {
          // No qualifying rows — keep signal-to-noise high: NO PurgeLog row.
          console.log('runRetention: No qualifying rows for sheet ' + sheetId);
          continue;
        }

        // Cap rows and delete bottom-up so the 0-based snapshot indices stay
        // valid while rows shift upward after each deleteRow.
        qualifying = qualifying.slice(0, RETENTION_ROW_CAP);
        qualifying.sort(function (a, b) { return b - a; });

        for (var q = 0; q < qualifying.length; q++) {
          var idx = qualifying[q];

          // Trash photos first (row deletion below is independent of photo success).
          var idFileId = extractDriveFileId_(data[idx][idPhotoIdx]);
          var selfieFileId = extractDriveFileId_(data[idx][selfieIdx]);
          var fileIds = [];
          if (idFileId) fileIds.push(idFileId);
          if (selfieFileId) fileIds.push(selfieFileId);

          for (var f = 0; f < fileIds.length; f++) {
            if (totalPhotoOps >= RETENTION_PHOTO_CAP) {
              // Photo cap reached — skip trashing (orphaned files are the
              // accepted tradeoff: their IDs are gone once the row is
              // deleted, so they are NOT recoverable by a later run), but
              // STILL delete the row.
              break;
            }
            totalPhotoOps++; // count every Drive op attempt against the cap
            try {
              DriveApp.getFileById(fileIds[f]).setTrashed(true);
              photosTrashed++;
            } catch (pe) {
              // Missing / already-trashed files raise here — not fatal; count and continue.
              photoErrors++;
            }
          }

          if (!dryRun) {
            sheet.deleteRow(idx + 1); // data[0] is header, so data index i → sheet row i+1
          }
          rowsPurged++;
        }

        totalRowsPurged += rowsPurged;
        totalPhotosTrashed += photosTrashed;
        totalSkippedUnparseable += skippedUnparseable;
        totalSkippedEmpty += skippedEmpty;
        totalPhotoErrors += photoErrors;

        logPurge_({
          sheetId: (dryRun ? '[DRY] ' : '') + sheetId,
          rowsPurged: rowsPurged,
          photosTrashed: photosTrashed,
          rowsSkippedUnparseable: skippedUnparseable,
          rowsSkippedEmpty: skippedEmpty,
          photoErrors: photoErrors
        });

        console.log('runRetention: sheet ' + sheetId + ' — purged ' + rowsPurged + ' row(s), trashed ' + photosTrashed + ' photo(s), skipped ' + skippedUnparseable + ' unparseable, ' + skippedEmpty + ' empty, ' + photoErrors + ' photo error(s)');
      } catch (e) {
        console.error('runRetention: Error for sheet ' + sheetId + ': ' + e.message);
        // Failure row: RowsPurged=0, SheetId set, and a non-zero skip field to
        // signal "this sheet errored out" (distinct from "nothing qualifying",
        // which is deliberately not logged).
        logPurge_({
          sheetId: sheetId,
          rowsPurged: 0,
          photosTrashed: 0,
          rowsSkippedUnparseable: 1,
          rowsSkippedEmpty: 0,
          photoErrors: 0
        });
      }
    }

    console.log('runRetention: Run complete — ' + totalRowsPurged + ' row(s) purged, ' + totalPhotosTrashed + ' photo(s) trashed, ' + totalSkippedUnparseable + ' unparseable, ' + totalSkippedEmpty + ' empty, ' + totalPhotoErrors + ' photo error(s) across ' + processList.length + ' sheet(s)');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Daily per-customer expiry pass (run via runDailyMaintenance at 02:05).
 *
 * Design (warn-first): 'expiring' is PURELY DERIVED — the daily pass only
 * MATERIALIZES a status='disabled' write when a customer is already 'expired'
 * (remainingDays < 0) AND its current status is still 'active'. It NEVER
 * touches 'paused' or operator-disabled status. A customer with no expiryDate
 * (or an unparseable one) is never disabled here. Expiry enforcement in
 * validateRequest / handleIssueLicense / config is always DERIVED fresh from
 * expiryDate on every request, so the status write here is only a persisted
 * fallback for downstream consumers that read status directly.
 *
 * Audit only: results go to the ExpiryLog tab. EXPIRY_ALERT_EMAIL is deferred
 * to v1.16.0 — no email is sent in this version.
 *
 * @param {boolean} [dryRun] - When true, scan + log only; skip status writes.
 */
function runExpiry(dryRun) {
  // Self-heal: ensure triggers are installed (in case they were cleared by redeploy).
  ensureTriggersInstalled();

  // Daily run — guard against concurrent executions. Hold the lock for the
  // entire function (same pattern as runRetention).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn('runExpiry: Could not acquire lock — another instance is running, skipping');
    return;
  }

  try {
    var masterConfig = _loadMasterConfig();

    var disabledCount = 0;
    var warnedCount = 0;
    var alreadyCount = 0;

    for (var sid in masterConfig) {
      var customer = masterConfig[sid];
      if (!customer.expiryDate) continue; // no expiry → nothing to do

      var expiryInfo = computeExpiryState_(customer, new Date());

      if (expiryInfo.expiryState === 'expired') {
        if (customer.status === 'active') {
          // Materialize the disable only for still-active customers.
          if (!dryRun) {
            setCustomerStatus(sid, 'disabled');
          }
          logExpiry_({
            sheetId: sid,
            expiryDate: customer.expiryDate,
            remainingDays: expiryInfo.remainingDays,
            action: dryRun ? 'would_disable' : 'disabled',
            previousStatus: 'active'
          });
          disabledCount++;
        } else {
          // Already 'disabled'/'paused' (or operator-disabled) — NEVER touch status.
          logExpiry_({
            sheetId: sid,
            expiryDate: customer.expiryDate,
            remainingDays: expiryInfo.remainingDays,
            action: 'already_disabled',
            previousStatus: customer.status
          });
          alreadyCount++;
        }
      } else if (expiryInfo.expiryState === 'expiring') {
        // Warning window — audit only, no status write.
        logExpiry_({
          sheetId: sid,
          expiryDate: customer.expiryDate,
          remainingDays: expiryInfo.remainingDays,
          action: 'warn',
          previousStatus: customer.status
        });
        warnedCount++;
      }
      // 'active' / 'none' → no log row (signal-to-noise).
    }

    // After writes, invalidate the cache so a subsequent validateRequest in
    // this (or any) execution reads the fresh persisted status.
    if (!dryRun) {
      _invalidateMasterConfigCache_();
    }

    console.log('runExpiry: Run complete — ' + disabledCount + ' disabled, ' + warnedCount + ' warned, ' + alreadyCount + ' already-disabled' + (dryRun ? ' (dry run)' : ''));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Daily maintenance wrapper (time-driven trigger at 02:05). Runs retention
 * purge first, then the expiry pass. Replaces the old runRetention trigger so
 * the trigger count stays at 3 (autoSignOut, releaseDailyCards, and this one).
 */
function runDailyMaintenance() {
  runRetention(false);
  runExpiry(false);
}

/**
 * One-shot master-config schema migration (SEPARATE from MIGRATION_REGISTRY,
 * which is customer-sheet-only). Adds the 'timezone' header to the Customers
 * tab if missing. Guarded by the MASTER_CONFIG_SCHEMA_VERSION Script Property
 * so it runs exactly once.
 *
 * Called from ensureTriggersInstalled() on first request after deploy so the
 * master schema migrates automatically (no manual admin step). Cheap on every
 * subsequent call: a single Script Property read.
 *
 * @returns {Object} { status, migrated, schema, column?, error? }
 */
function _migrateMasterConfigV2() {
  var MASTER_CONFIG_SCHEMA_VERSION = 'v2'; // v1 = 9-col schema, v2 = +timezone
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MASTER_CONFIG_SCHEMA_VERSION') === MASTER_CONFIG_SCHEMA_VERSION) {
    return { status: 'ok', migrated: false, schema: MASTER_CONFIG_SCHEMA_VERSION };
  }

  var sheet = _getMasterConfigSheet();
  if (!sheet) {
    return { status: 'error', error: 'Master config sheet not accessible' };
  }
  var custSheet = sheet.getSheetByName('Customers');
  if (!custSheet) {
    return { status: 'error', error: 'Customers tab not found in master config' };
  }

  var data = custSheet.getDataRange().getValues();
  var headers = data.length > 0 ? data[0] : [];

  // Header already present? Mark schema and stop (idempotent).
  if (resolveColumns(data, ['timezone'])['timezone'] !== -1) {
    props.setProperty('MASTER_CONFIG_SCHEMA_VERSION', MASTER_CONFIG_SCHEMA_VERSION);
    console.log('_migrateMasterConfigV2: timezone header already present');
    return { status: 'ok', migrated: false, schema: MASTER_CONFIG_SCHEMA_VERSION };
  }

  // Append 'timezone' at the first free column after the last non-empty header.
  var lastCol = _lastNonEmpty_(headers);
  var tzCol = lastCol + 1; // 1-based
  custSheet.getRange(1, tzCol).setValue('timezone');
  custSheet.getRange(1, tzCol).setFontWeight('bold');
  console.log('_migrateMasterConfigV2: appended timezone header at column ' + tzCol);

  props.setProperty('MASTER_CONFIG_SCHEMA_VERSION', MASTER_CONFIG_SCHEMA_VERSION);
  _invalidateMasterConfigCache_();
  return { status: 'ok', migrated: true, schema: MASTER_CONFIG_SCHEMA_VERSION, column: tzCol };
}

/**
 * One-shot master-config schema migration (SEPARATE from MIGRATION_REGISTRY,
 * which is customer-sheet-only). Adds the 'retentionDays' header to the
 * Customers tab if missing. Guarded by the MASTER_CONFIG_SCHEMA_VERSION Script
 * Property so it runs exactly once.
 *
 * Does NOT remove the legacy registration-timestamp column — its cells stay in
 * place; the code simply stops reading it. New customer rows leave retentionDays
 * empty (no purge) until an operator sets a value, which is the correct default.
 *
 * Called from ensureTriggersInstalled() on first request after deploy so the
 * master schema migrates automatically (no manual admin step).
 *
 * @returns {Object} { status, migrated, schema, column?, error? }
 */
function _migrateMasterConfigV3() {
  var MASTER_CONFIG_SCHEMA_VERSION = 'v3'; // v1 = 9-col schema, v2 = +timezone, v3 = +retentionDays
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MASTER_CONFIG_SCHEMA_VERSION') === MASTER_CONFIG_SCHEMA_VERSION) {
    return { status: 'ok', migrated: false, schema: MASTER_CONFIG_SCHEMA_VERSION };
  }

  var sheet = _getMasterConfigSheet();
  if (!sheet) {
    return { status: 'error', error: 'Master config sheet not accessible' };
  }
  var custSheet = sheet.getSheetByName('Customers');
  if (!custSheet) {
    return { status: 'error', error: 'Customers tab not found in master config' };
  }

  var data = custSheet.getDataRange().getValues();
  var headers = data.length > 0 ? data[0] : [];

  // Header already present? Mark schema and stop (idempotent).
  if (resolveColumns(data, ['retentionDays'])['retentionDays'] !== -1) {
    props.setProperty('MASTER_CONFIG_SCHEMA_VERSION', MASTER_CONFIG_SCHEMA_VERSION);
    console.log('_migrateMasterConfigV3: retentionDays header already present');
    return { status: 'ok', migrated: false, schema: MASTER_CONFIG_SCHEMA_VERSION };
  }

  // Append 'retentionDays' at the first free column after the last non-empty
  // header. Existing customer rows are untouched (empty = no purge).
  var lastCol = _lastNonEmpty_(headers);
  var retentionCol = lastCol + 1; // 1-based
  custSheet.getRange(1, retentionCol).setValue('retentionDays');
  custSheet.getRange(1, retentionCol).setFontWeight('bold');
  console.log('_migrateMasterConfigV3: appended retentionDays header at column ' + retentionCol);

  props.setProperty('MASTER_CONFIG_SCHEMA_VERSION', MASTER_CONFIG_SCHEMA_VERSION);
  _invalidateMasterConfigCache_();
  return { status: 'ok', migrated: true, schema: MASTER_CONFIG_SCHEMA_VERSION, column: retentionCol };
}

/**
 * One-shot master-config schema migration (SEPARATE from MIGRATION_REGISTRY,
 * which is customer-sheet-only). Adds the 'expiryDate' and 'expiryWarningDays'
 * headers to the Customers tab if missing. Guarded by the
 * MASTER_CONFIG_SCHEMA_VERSION Script Property so it runs exactly once, and
 * each header is guarded individually (idempotent per-header) so a partial
 * prior run self-heals. Existing customer rows are untouched (empty expiryDate
 * = no expiry; empty expiryWarningDays = default 7 at read time).
 *
 * Called from ensureTriggersInstalled() on first request after deploy so the
 * master schema migrates automatically (no manual admin step).
 *
 * @returns {Object} { status, migrated, schema, columns?, error? }
 */
function _migrateMasterConfigV4() {
  var MASTER_CONFIG_SCHEMA_VERSION = 'v4'; // v1 = 9-col, v2 = +timezone, v3 = +retentionDays, v4 = +expiryDate, +expiryWarningDays
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MASTER_CONFIG_SCHEMA_VERSION') === MASTER_CONFIG_SCHEMA_VERSION) {
    return { status: 'ok', migrated: false, schema: MASTER_CONFIG_SCHEMA_VERSION };
  }

  var sheet = _getMasterConfigSheet();
  if (!sheet) {
    return { status: 'error', error: 'Master config sheet not accessible' };
  }
  var custSheet = sheet.getSheetByName('Customers');
  if (!custSheet) {
    return { status: 'error', error: 'Customers tab not found in master config' };
  }

  var data = custSheet.getDataRange().getValues();
  var headers = data.length > 0 ? data[0] : [];

  var migrated = false;
  var appended = [];

  // Header 1: expiryDate (guarded individually).
  if (resolveColumns(data, ['expiryDate'])['expiryDate'] === -1) {
    var lastCol = _lastNonEmpty_(headers);
    var expiryDateCol = lastCol + 1; // 1-based
    custSheet.getRange(1, expiryDateCol).setValue('expiryDate');
    custSheet.getRange(1, expiryDateCol).setFontWeight('bold');
    console.log('_migrateMasterConfigV4: appended expiryDate header at column ' + expiryDateCol);
    // Refresh so the next header appends after this one.
    data = custSheet.getDataRange().getValues();
    headers = data.length > 0 ? data[0] : [];
    migrated = true;
    appended.push('expiryDate');
  }

  // Header 2: expiryWarningDays (guarded individually).
  if (resolveColumns(data, ['expiryWarningDays'])['expiryWarningDays'] === -1) {
    var lastCol2 = _lastNonEmpty_(headers);
    var expiryWarningDaysCol = lastCol2 + 1; // 1-based
    custSheet.getRange(1, expiryWarningDaysCol).setValue('expiryWarningDays');
    custSheet.getRange(1, expiryWarningDaysCol).setFontWeight('bold');
    console.log('_migrateMasterConfigV4: appended expiryWarningDays header at column ' + expiryWarningDaysCol);
    migrated = true;
    appended.push('expiryWarningDays');
  }

  props.setProperty('MASTER_CONFIG_SCHEMA_VERSION', MASTER_CONFIG_SCHEMA_VERSION);
  _invalidateMasterConfigCache_();
  return { status: 'ok', migrated: migrated, schema: MASTER_CONFIG_SCHEMA_VERSION, columns: appended };
}

/**
 * One-shot auto-install: migrates the master config schema (timezone +
 * retentionDays + expiryDate + expiryWarningDays headers), then ensures the
 * HOURLY auto sign-out trigger, the daily card release trigger (02:00), the
 * daily maintenance trigger (02:05, which runs retention purge + expiry pass),
 * and the 2-minute email-queue sweep trigger exist. Uses a versioned
 * ScriptProperties flag so it automatically reinstalls if the trigger schema
 * changes.
 * Called automatically from doGet and doPost on first request after deploy.
 */
function ensureTriggersInstalled() {
  // Master-config schema migrations (cheap no-ops after the first successful run).
  _migrateMasterConfigV2();
  _migrateMasterConfigV3();
  _migrateMasterConfigV4();

  var prop = PropertiesService.getScriptProperties();
  // Schema version — bump this if trigger type/interval changes (v11 adds the
  // 5-minute email-queue sweep with dirty-flag gate; everyMinutes(2) is NOT a
  // valid GAS interval — v10 shipped everyMinutes(1) which burned ~336 min/day
  // of consumer quota when idle, hence the v11 cadence + flag change).
  var SCHEMA_VERSION = 'v11';

  // Check if required triggers physically exist (handles redeploy clearing them)
  var triggers = ScriptApp.getProjectTriggers();
  var hasAutoSignOut = false;
  var hasDailyRelease = false;
  var hasDailyMaintenance = false;
  var hasEmailSweep = false;
  for (var ti = 0; ti < triggers.length; ti++) {
    var fn = triggers[ti].getHandlerFunction();
    if (fn === 'autoSignOut') hasAutoSignOut = true;
    if (fn === 'releaseDailyCards') hasDailyRelease = true;
    if (fn === 'runDailyMaintenance') hasDailyMaintenance = true;
    if (fn === 'runEmailQueueSweep') hasEmailSweep = true;
  }
  // If schema matches AND all four required triggers exist, skip
  if (prop.getProperty('TRIGGER_SCHEMA_VERSION') === SCHEMA_VERSION && hasAutoSignOut && hasDailyRelease && hasDailyMaintenance && hasEmailSweep) {
    return;
  }

  // Delete ALL existing autoSignOut + releaseDailyCards + runDailyMaintenance +
  // runEmailQueueSweep + syncAutoSignOutHours triggers. The legacy 'runRetention'
  // trigger is also removed here so old deployments get it replaced by
  // runDailyMaintenance.
  triggers = ScriptApp.getProjectTriggers();
  for (var i = triggers.length - 1; i >= 0; i--) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'autoSignOut' || fn === 'releaseDailyCards' || fn === 'runRetention' || fn === 'runDailyMaintenance' || fn === 'syncAutoSignOutHours' || fn === 'runEmailQueueSweep') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Install HOURLY autoSignOut (per-customer timezone/hour gating inside).
  ScriptApp.newTrigger('autoSignOut')
    .timeBased()
    .everyHours(1)
    .create();
  console.log('ensureTriggersInstalled: Installed hourly autoSignOut trigger');

  // Install daily card release at 02:00
  ScriptApp.newTrigger('releaseDailyCards')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  console.log('ensureTriggersInstalled: Installed releaseDailyCards trigger at 02:00');

  // Install daily maintenance at 02:05 (5-minute window: 02:05–02:10). This
  // runs retention purge + expiry pass. releaseDailyCards holds the script
  // lock at 02:00 (up to 120s, ~until 02:02), so the 02:05 start keeps the two
  // daily runs from contending on the lock. If `.nearMinute(5)` is rejected in
  // this combination at runtime, fall back to `.atHour(2).everyDays(1)` (fires
  // within the 02:00–03:00 window) — lock contention with releaseDailyCards is
  // the expected isolation.
  ScriptApp.newTrigger('runDailyMaintenance')
    .timeBased()
    .atHour(2)
    .nearMinute(5)
    .everyDays(1)
    .create();
  console.log('ensureTriggersInstalled: Installed runDailyMaintenance trigger at 02:05');

  // Install the 5-minute email-queue sweep. GAS everyMinutes() only accepts
  // 1, 5, 10, 15, 30 — 2 is REJECTED at runtime (verified live 2026-08-31).
  // 5 minutes (not 1) because GAS bills ~1s overhead per trigger execution:
  // 1-min cadence = 1,440 ticks/day ≈ 24 min/day of pure overhead even when
  // idle. runEmailQueueSweep() gates on EMAIL_QUEUE_DIRTY, so idle ticks cost
  // ~0.2s. Fire-and-forget per row — the sweep does NOT hold the script lock,
  // so a slow GmailApp send can't contend with autoSignOut /
  // releaseDailyCards / runDailyMaintenance.
  ScriptApp.newTrigger('runEmailQueueSweep')
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log('ensureTriggersInstalled: Installed runEmailQueueSweep trigger every 5 minutes');

  // Mark current schema version
  prop.setProperty('TRIGGER_SCHEMA_VERSION', SCHEMA_VERSION);
  console.log('ensureTriggersInstalled: Triggers installed (schema ' + SCHEMA_VERSION + ')');
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
// COLUMN RESOLUTION HELPERS
// ──────────────────────────────────────────────

/**
 * Normalize a header label for case-/whitespace-insensitive comparison.
 * Lowercases, trims, and collapses internal whitespace runs to a single space.
 *
 * @param {*} value - The header cell value
 * @returns {string} Normalized label
 */
function normalizeHeader_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Resolve the 0-based column index of a header cell by name.
 * Case-insensitive and whitespace-insensitive. Row 0 is the header row.
 *
 * @param {Array<Array>} data - 2D array from getDataRange().getValues()
 * @param {string} headerName - Canonical header name to find
 * @returns {number} 0-based index, or -1 if the header is absent
 */
function getColumnIndex_(data, headerName) {
  if (!data || data.length === 0) return -1;
  var headers = data[0];
  var target = normalizeHeader_(headerName);
  for (var j = 0; j < headers.length; j++) {
    if (normalizeHeader_(headers[j]) === target) return j;
  }
  return -1;
}

/**
 * Single-pass wrapper: resolve a list of header names to a {name: index} map.
 * Scans the header row exactly once, then maps each requested name to its
 * 0-based index (or -1 if absent).
 *
 * @param {Array<Array>} data - 2D array from getDataRange().getValues()
 * @param {string[]} nameList - Header names to resolve
 * @returns {Object} Map of name -> 0-based index (or -1)
 */
function resolveColumns(data, nameList) {
  var map = {};
  var headerIndex = {};
  if (data && data.length > 0) {
    var headers = data[0];
    for (var j = 0; j < headers.length; j++) {
      var key = normalizeHeader_(headers[j]);
      if (!(key in headerIndex)) headerIndex[key] = j; // first occurrence wins
    }
  }
  for (var i = 0; i < nameList.length; i++) {
    var name = nameList[i];
    var idx = headerIndex[normalizeHeader_(name)];
    map[name] = (idx === undefined) ? -1 : idx;
  }
  return map;
}

/**
 * Return the 1-based position of the last non-empty cell in a row array.
 * Used by migration V7 to measure effective column width (trailing empty
 * string cells do not count as content).
 *
 * @param {Array} row - A single row array from getValues()
 * @returns {number} 1-based index of the last non-empty cell, or 0 if all empty
 */
function _lastNonEmpty_(row) {
  if (!row) return 0;
  for (var c = row.length - 1; c >= 0; c--) {
    var v = row[c];
    if (v !== '' && v !== undefined && v !== null) return c + 1;
  }
  return 0;
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

var SHEET_VERSION_CELL = '_version!A1';
var LATEST_SHEET_VERSION = 10;

var VISITORLOG_HEADERS = [
  'Timestamp',
  'Full Name',
  'ID / Passport Number',
  'Company Name',
  'Destination',
  'Visitor Type',
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

var CARDNO_HEADERS = ['CardNo', 'Status', 'AssignedTo', 'AssignedAt', 'DoorGroupID'];

var DESTINATION_HEADERS = ['Destination', 'Access Level', 'DoorGroupID'];

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
  {
    version: 3,
    name: 'Add DoorGroupID to Destination',
    destructive: false,
    description: 'Adds DoorGroupID column to Destination sheet for ACT integration',
    fn: function(ss) {
      console.log('Migration V3: Updating Destination headers');
      var sheet = ss.getSheetByName('Destination');
      if (!sheet) {
        console.log('Migration V3: Destination tab not found — skipping');
        return;
      }

      // Only run if current header count is less than 3
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.length >= 3) {
        console.log('Migration V3: DoorGroupID column already exists — skipping');
        return;
      }

      var newHeaders = DESTINATION_HEADERS;
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');

      console.log('Migration V3: DoorGroupID column added to Destination');
    }
  },
  {
    version: 4,
    name: 'Create Settings tab with auto sign-out defaults',
    destructive: false,
    description: 'Creates Settings tab with autoSignOutEnabled=TRUE and autoSignOutHour=21',
    fn: function(ss) {
      console.log('Migration V4: Checking Settings tab');
      var tab = ss.getSheetByName('Settings');
      if (!tab) {
        tab = ss.insertSheet('Settings');
        tab.getRange(1, 1, 3, 2).setValues([
          ['Setting', 'Value'],
          ['autoSignOutEnabled', 'TRUE'],
          ['autoSignOutHour', '21'],
        ]);
        tab.autoResizeColumns(1, 2);
        console.log('Migration V4: Created Settings tab with defaults');
      } else {
        console.log('Migration V4: Settings tab already exists — skipping');
      }
    }
  },
  {
    version: 5,
    name: 'Move version marker to hidden _version sheet',
    destructive: false,
    description: 'Moves SHEET_VERSION from VisitorLog!A1000 to _version!A1 and clears the old cell',
    fn: function(ss) {
      console.log('Migration V5: Moving version marker to _version sheet');
      
      // Read old marker from VisitorLog!A1000
      var vSheet = ss.getSheetByName('VisitorLog');
      if (vSheet) {
        var oldCell = vSheet.getRange('A1000');
        var oldValue = String(oldCell.getValue());
        var match = oldValue.match(/SHEET_VERSION=(\d+)/);
        
        if (match) {
          // Write to new _version sheet
          var newSheet = ss.getSheetByName('_version');
          if (!newSheet) {
            newSheet = ss.insertSheet('_version');
            newSheet.hideSheet();
          }
          newSheet.getRange('A1').setValue('SHEET_VERSION=' + match[1]);
          
          // Clear old marker
          oldCell.clear();
          console.log('Migration V5: Migrated version ' + match[1] + ' from A1000 to _version sheet');
        } else {
          console.log('Migration V5: No old marker found at A1000 — initializing _version sheet');
          var newSheet = ss.getSheetByName('_version');
          if (!newSheet) {
            newSheet = ss.insertSheet('_version');
            newSheet.hideSheet();
            newSheet.getRange('A1').setValue('SHEET_VERSION=0');
          }
        }
      } else {
        console.log('Migration V5: VisitorLog not found — creating _version sheet');
        var newSheet = ss.getSheetByName('_version');
        if (!newSheet) {
          newSheet = ss.insertSheet('_version');
          newSheet.hideSheet();
          newSheet.getRange('A1').setValue('SHEET_VERSION=0');
        }
      }
      
      console.log('Migration V5: Complete');
    }
  },
  {
    version: 6,
    name: 'Add Visitor Type column + VisitorType tab',
    destructive: false,
    description: 'Inserts Visitor Type column after Destination in VisitorLog, creates VisitorType tab',
    fn: function(ss) {
      console.log('Migration V6: Adding Visitor Type column and VisitorType tab');

      var sheet = ss.getSheetByName('VisitorLog');
      if (!sheet) {
        console.log('Migration V6: VisitorLog not found — skipping column insert');
      } else {
        // Idempotency guard: read headers
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        var hasVisitorType = false;
        for (var h = 0; h < headers.length; h++) {
          if (/visitor\s*type/i.test(String(headers[h] || ''))) {
            hasVisitorType = true;
            break;
          }
        }
        if (hasVisitorType || headers.length >= 15) {
          console.log('Migration V6: Visitor Type column already present — skipping');
        } else {
          // Insert column after Destination (col 5 = index 4, 1-indexed col 5)
          sheet.insertColumnAfter(4);
          sheet.getRange(1, 5).setValue('Visitor Type');
          sheet.getRange(1, 5).setFontWeight('bold');
          sheet.autoResizeColumn(5);
          console.log('Migration V6: Inserted Visitor Type column at col 5');
        }
      }

      // Create VisitorType tab if missing
      var vtSheet = ss.getSheetByName('VisitorType');
      if (!vtSheet) {
        vtSheet = ss.insertSheet('VisitorType');
        vtSheet.getRange(1, 1).setValue('Visitor Type');
        vtSheet.getRange(1, 1).setFontWeight('bold');
        vtSheet.setFrozenRows(1);
        vtSheet.autoResizeColumn(1);
        console.log('Migration V6: Created VisitorType tab');
      } else {
        console.log('Migration V6: VisitorType tab already exists — skipping');
      }

      console.log('Migration V6: Complete');
    }
  },
  {
    version: 7,
    name: 'Reconcile VisitorLog/cardno headers to canonical columns',
    destructive: false,
    description: 'Aligns VisitorLog and cardno headers to the canonical 15-column and 5-column layouts',
    fn: function(ss) {
      console.log('Migration V7: Reconciling VisitorLog/cardno headers');

      // ── VisitorLog ──
      var vSheet = ss.getSheetByName('VisitorLog');
      if (!vSheet) {
        console.log('Migration V7: VisitorLog not found — skipping');
      } else {
        var data = vSheet.getDataRange().getValues();
        var headerRow = data.length > 0 ? data[0] : [];
        var hasVisitorType = getColumnIndex_(data, 'Visitor Type') !== -1;

        if (!hasVisitorType) {
          // Distinguish "14-wide sheet (V6 never ran)" from "15-wide data whose
          // header row is stale": if any data row extends past the header's
          // effective width, the Visitor Type column already exists in the data
          // and we must NOT insert (which would shift data and corrupt it).
          var headerWidth = _lastNonEmpty_(headerRow);
          var maxDataWidth = 0;
          for (var d = 1; d < data.length; d++) {
            var w = _lastNonEmpty_(data[d]);
            if (w > maxDataWidth) maxDataWidth = w;
          }
          var dataWide = maxDataWidth > headerWidth || vSheet.getLastColumn() > headerWidth;

          if (dataWide) {
            console.log('Migration V7: VisitorLog data already 15-wide — rewriting header row only');
          } else {
            // Insert a Visitor Type column after Destination (col 5) and shift
            // existing data right — same mechanics as V6.
            vSheet.insertColumnAfter(4);
            vSheet.getRange(1, 5).setValue('Visitor Type');
            vSheet.getRange(1, 5).setFontWeight('bold');
            vSheet.autoResizeColumn(5);
            console.log('Migration V7: Inserted Visitor Type column at col 5');
          }
        }

        // Always rewrite the header row to the canonical 15-column order (idempotent).
        vSheet.getRange(1, 1, 1, VISITORLOG_HEADERS.length).setValues([VISITORLOG_HEADERS]);
        vSheet.getRange(1, 1, 1, VISITORLOG_HEADERS.length).setFontWeight('bold');
        console.log('Migration V7: VisitorLog header set to canonical 15 columns');
      }

      // ── cardno ──
      var cSheet = ss.getSheetByName('cardno');
      if (!cSheet) {
        console.log('Migration V7: cardno not found — skipping');
      } else {
        var cData = cSheet.getDataRange().getValues();

        // DoorGroupID: append header cell only (no data shift).
        if (getColumnIndex_(cData, 'DoorGroupID') === -1) {
          cSheet.getRange(1, 5).setValue('DoorGroupID');
          cSheet.getRange(1, 5).setFontWeight('bold');
          console.log('Migration V7: Appended DoorGroupID header to cardno');
        }
        if (getColumnIndex_(cData, 'AssignedTo') === -1) {
          cSheet.getRange(1, 3).setValue('AssignedTo');
          cSheet.getRange(1, 3).setFontWeight('bold');
          console.log('Migration V7: Set AssignedTo header on cardno');
        }
        if (getColumnIndex_(cData, 'AssignedAt') === -1) {
          cSheet.getRange(1, 4).setValue('AssignedAt');
          cSheet.getRange(1, 4).setFontWeight('bold');
          console.log('Migration V7: Set AssignedAt header on cardno');
        }
        console.log('Migration V7: cardno header reconciled to canonical 5 columns');
      }

      console.log('Migration V7: Complete');
    }
  },
  {
    version: 8,
    name: 'Add timezone row to Settings tab',
    destructive: false,
    description: 'Ensures the Settings tab carries a timezone row (empty default)',
    fn: function(ss) {
      console.log('Migration V8: Ensuring timezone row in Settings tab');
      getOrCreateSettingsTab_(ss); // ensureSettingRow_ handles idempotently
      console.log('Migration V8: Complete');
    }
  },
  {
    // Numbered 10 per M8 §5 / §2.6; v9 was never landed in this codebase (registry jumps 8 → 10).
    version: 10,
    name: 'Add ustarSecret row to Settings tab',
    destructive: false,
    description: 'Appends a blank ustarSecret row to the Settings tab (operator sets the value)',
    fn: function(ss) {
      console.log('Migration V10: Ensuring ustarSecret row in Settings tab');
      var tab = getOrCreateSettingsTab_(ss);
      ensureSettingRow_(tab, 'ustarSecret', ''); // value left blank — operator sets it
      console.log('Migration V10: Complete');
    }
  },
];

/**
 * Read sheet version from _version!A1.
 * Creates the _version sheet if it doesn't exist.
 * Returns 0 if no version marker found.
 */
function getSheetVersion_(ss) {
  var sheet = ss.getSheetByName('_version');
  if (!sheet) {
    sheet = ss.insertSheet('_version');
    sheet.hideSheet();
    return 0;
  }
  var cell = sheet.getRange('A1').getValue();
  var match = String(cell).match(/SHEET_VERSION=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Write sheet version to _version!A1.
 * Creates the _version sheet if it doesn't exist.
 */
function setSheetVersion_(ss, version) {
  var sheet = ss.getSheetByName('_version');
  if (!sheet) {
    sheet = ss.insertSheet('_version');
    sheet.hideSheet();
  }
  sheet.getRange('A1').setValue('SHEET_VERSION=' + version);
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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 'error', error: 'Could not acquire migration lock — another migration may be in progress' };
  }

  try {
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
  } finally {
    lock.releaseLock();
  }
}
