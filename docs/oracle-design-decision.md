# ORACLE — Final Design Decision: Origin Whitelist + Usage Tier Enforcement

**Date:** 30 June 2026
**Role:** Design Validator & Architecture Decision-Maker
**Inputs:** UX Expert Review (user-facing), Technical Architect Review (docs/origin-tier-architecture-review.md), Codebase Analysis

---

## 0. Executive Verdict

**Overall approach: SOUND.** The proposal is pragmatic, the architect's in-memory caching pattern neutralises the primary performance concern, and the UX's scoping (origin check only on `register`) cleanly avoids the wrapper.gs Origin-header gap. No showstoppers.

**Build this.** Priority order: Phase 1 (core infra) → Phase 2 (user-facing enforcement) → Phase 3 (grace/commercial) → Phase 4 (scale).

---

## 1. Conflict Resolution

### Conflict 1: Where to enforce origin?
| Review | Position |
|--------|----------|
| UX | Origin check ONLY on `mode=register` (the billable action) |
| Architect | Per-endpoint checks (register gets full check, lookup/today get lighter check) |

**Oracle Ruling: ✅ UX wins with modification.**
Only `mode=register` gets the full origin check. Why:
- GET requests (destinations, lookup, today) are read-only — no data is created
- `updateStatus`, `bulkSignOut`, `report` are PIN-gated on the guard portal
- `migrate`, `setupAutoSignOut` come from wrapper.gs (bound script, no Origin sent by UrlFetchApp)
- This cleanly sidesteps the wrapper.gs Origin-header problem without needing special fallback logic
- Defense-in-depth: add a lightweight Origin log on ALL requests (notify admin of strange domains hitting any endpoint), but only block on register

### Conflict 2: Auto-learn domains?
| Review | Position |
|--------|----------|
| UX | Auto-learn on first valid request with grace period ("pending" status) |
| Architect | No mention — explicit whitelist implied |

**Oracle Ruling: ❌ UX proposal REJECTED.**
Auto-learn is a security hole. Anyone who discovers the API endpoint can register their domain by sending a single valid request. The "pending" grace period mitigates this slightly but still creates an audit trail risk. Explicit whitelist only. Defer self-service to a future customer portal page (UX's own suggestion) where the admin explicitly approves domain additions.

### Conflict 3: Origin as security boundary?
| Review | Position |
|--------|----------|
| UX | Treats it as a blocking mechanism for copied frontends |
| Architect | Correctly calls it "deterrence, not security" — Origin header is unreliable |

**Oracle Ruling: ✅ Architect wins — but both are right.**
The UX is designing for the *user-facing behaviour* (block copied frontends visually). The architect is designing for the *reality of HTTP* (Origin can be stripped). Resolution:
- Frontend-facing behaviour: block register requests from unknown origins (this deters casual copy-paste)
- Backend reality: log all origin mismatches but handle missing-origin cases gracefully (allow the request, flag for audit)
- Real security boundary = Google Sheet sharing permissions (not shared publicly)
- Documentation should explicitly state: "Origin whitelist prevents copied frontends from using the API. It does NOT prevent direct API access via curl/Postman. Protect your sheet by not sharing With Editor access publicly."

### Conflict 4: Compute usage from data vs trigger-based counter?
| Review | Position |
|--------|----------|
| UX | Doesn't address this — implies a counter |
| Architect | Compute from data at request time — no reset trigger, always accurate |

**Oracle Ruling: ✅ Architect wins.**
Compute from data at request time. No trigger maintenance, no reset logic, always consistent. The cost (~0.5–2s scan of VisitorLog) is acceptable at this scale and only incurred on register requests.

---

## 2. Gaps Neither Review Caught

### Gap 1: GET path for destination dropdown will also need origin awareness
The visitor registration page calls `GET ?action=destinations` to populate the destination dropdown. Currently this is unprotected. Since the visitor page is served from the customer's domain (which we're whitelisting), the Origin header WILL be sent on this GET request. **No action needed now** — the GETs are read-only — but when adding logging, include dest lookups.

### Gap 2: CORS preflight is already handled (no gap after all)
Verified: all frontend POST requests use `Content-Type: text/plain` with JSON body. This is a "simple content type" — browsers do NOT send a CORS preflight (OPTIONS) for it. GAS Web Apps return responses that are readable cross-origin for simple requests. **No issue here.** However, this is a fragile assumption — if anyone changes to `application/json` in the future, the system breaks globally. Add a comment in the submit function:

```javascript
// CRITICAL: text/plain avoids CORS preflight in GAS Web Apps.
// Do NOT change to application/json without adding OPTIONS handling.
headers: { 'Content-Type': 'text/plain' },
```

### Gap 3: master config sheet concurrent modification
GAS has no transaction support. Two concurrent requests could both read the config, one writes an origin change, the other sees stale data. Mitigation: the in-memory cache busts every execution anyway (~60–180s max staleness), so this is acceptable for config changes (non-real-time).

### Gap 4: knyf3.github.io frontend needs its own sheet
The architect's Option A (reserved sheetId in master config) assumes `knyf3.github.io` frontend has a dedicated SHEET_ID. Currently, all frontends share whatever SHEET_ID is in config.js. For the report/verify pages on knyf3.github.io to work with unlimited tier, one of:
- Create a dedicated demo sheet with sheetId `DEMO` (or a real sheet ID) that maps to a reserved unlimited entry in master config → **recommended**
- OR add a special bypass flag like `MASTER_KEY` in config.js → architect warned against this, and rightly so

### Gap 5: The existing GUARD_PIN is plaintext in config.js
`CONFIG.GUARD_PIN: '1234'` is hardcoded in every customer's config.js. This is a separate concern but worth noting: when customers configure their own deployment, they set the same PIN in their own config.js. The PIN is only as secure as their GitHub Pages repo. Origin whitelisting on register doesn't affect guard portal security (the UX explicitly separates them). This is an existing known weakness, not introduced by this proposal.

---

## 3. Exact Data Schema — Master Config Sheet

### Sheet Name: `Customers` (in the master GAS project spreadsheet)

| Column | Header | Type | Required | Default | Description |
|--------|--------|------|----------|---------|-------------|
| A | `sheetId` | string | ✅ | — | Google Sheet ID of the customer's sheet |
| B | `allowedOrigins` | string | ✅ | `*` | Comma-separated origins, e.g. `https://office1.example.com,https://example.com`. Use `*` only for dev/admin |
| C | `tier` | string | ✅ | `free` | One of: `free`, `starter`, `pro`, `enterprise`, `admin` |
| D | `visitorLimit` | number | ❌ | *(from tier)* | Override the tier's default visitor limit. Empty = use tier default |
| E | `downgradeFromTier` | string | ❌ | — | If set, the customer downgraded this month. Old tier name for grace period |
| F | `downgradeMonth` | string | ❌ | — | ISO month when downgrade was requested, e.g. `2026-07`. Grace period lasts until month ends |
| G | `notes` | string | ❌ | — | Admin notes. Not read by code |

### Reserved Row for knyf3.github.io (admin deployment):
```
sheetId: [REAL_SHEET_ID_OF_DEMO_SHEET]
allowedOrigins: https://knyf3.github.io
tier: admin
visitorLimit: 999999
downgradeFromTier:
downgradeMonth:
notes: Developer admin deployment — unlimited tier
```

### Tier Defaults (hardcoded in Code.gs):
```javascript
var TIER_LIMITS = {
  free:       50,
  starter:    500,
  pro:        999999,  // effectively unlimited
  enterprise: 999999,
  admin:      999999,
};
```

---

## 4. Exact Code Structure — Code.gs

### New Global State (at top of Code.gs, after existing vars)

```javascript
/**
 * ──────────────────────────────────────────────
 * ORIGIN + TIER ENFORCEMENT
 * ──────────────────────────────────────────────
 */
var _masterConfig = null;
var _masterConfigSheetId = null;  // Set via Script Properties

var TIER_LIMITS = {
  free: 50,
  starter: 500,
  pro: 999999,
  enterprise: 999999,
  admin: 999999,
};

var TIER_NAMES = ['free', 'starter', 'pro', 'enterprise', 'admin'];
```

### New Functions

```javascript
/**
 * Load master config into memory (once per execution).
 * First request pays ~1s openById penalty. Subsequent requests are instant.
 * @returns {Object} Config object keyed by sheetId
 */
function getMasterConfig_() {
  if (_masterConfig) return _masterConfig;
  
  var sheetId = PropertiesService.getScriptProperties().getProperty('MASTER_CONFIG_SHEET_ID');
  if (!sheetId) {
    console.error('MASTER_CONFIG_SHEET_ID not set. Allowing all requests.');
    _masterConfig = {};
    return _masterConfig;
  }
  
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Customers');
    if (!sheet) {
      console.error('Customers sheet not found in master config. Allowing all.');
      _masterConfig = {};
      return _masterConfig;
    }
    
    var data = sheet.getDataRange().getValues();
    _masterConfig = {};
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var sid = String(row[0] || '').trim();
      if (!sid) continue;
      
      _masterConfig[sid] = {
        allowedOrigins: (String(row[1] || '').trim() || '*').split(',').map(function(s) {
          return s.trim().toLowerCase().replace(/\/$/, '');
        }),
        tier: TIER_NAMES.indexOf(String(row[2] || '').trim().toLowerCase()) >= 0
          ? String(row[2] || '').trim().toLowerCase()
          : 'free',
        visitorLimit: parseInt(row[3], 10) || 0,
        downgradeFromTier: String(row[4] || '').trim().toLowerCase() || null,
        downgradeMonth: String(row[5] || '').trim() || null,
      };
    }
    
    return _masterConfig;
  } catch (e) {
    console.error('Failed to load master config: ' + e.message + '. Allowing all requests.');
    _masterConfig = {};
    return _masterConfig;
  }
}

/**
 * Get effective visitor limit for a sheet, accounting for tier + override + grace period.
 * @param {Object} customerConfig - Entry from master config for this sheetId
 * @returns {number} Effective monthly visitor limit
 */
function getEffectiveLimit_(customerConfig) {
  var tierLimit = TIER_LIMITS[customerConfig.tier] || 50;
  var overrideLimit = customerConfig.visitorLimit;
  var effectiveLimit = (overrideLimit > 0) ? overrideLimit : tierLimit;
  
  // Grace period for downgrades: if downgrade was requested this month, use old tier limit
  var now = new Date();
  var currentMonth = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  var downgradeMonth = customerConfig.downgradeMonth;
  
  if (customerConfig.downgradeFromTier && downgradeMonth === currentMonth) {
    var oldTierLimit = TIER_LIMITS[customerConfig.downgradeFromTier] || 50;
    if (oldTierLimit > effectiveLimit) {
      effectiveLimit = oldTierLimit;
    }
  }
  
  return effectiveLimit;
}

/**
 * Compute monthly visitor count from data in the customer sheet.
 * No reset trigger needed — always accurate to current date.
 * @param {string} sheetId - Customer's sheet ID
 * @returns {number} Visitor registrations this month
 */
function getMonthlyVisitorCount_(sheetId) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('VisitorLog');
    if (!sheet) return 0;
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return 0;
    
    var timeZone = Session.getScriptTimeZone();
    var now = new Date();
    var firstOfMonth = Utilities.formatDate(
      new Date(now.getFullYear(), now.getMonth(), 1),
      timeZone, 'yyyy-MM-dd'
    );
    
    var count = 0;
    for (var i = 1; i < data.length; i++) {
      var cell = data[i][5]; // Col 5 = Visitation Date
      var dateStr = '';
      if (cell instanceof Date && !isNaN(cell.getTime())) {
        dateStr = Utilities.formatDate(cell, timeZone, 'yyyy-MM-dd');
      } else {
        dateStr = String(cell || '').trim();
      }
      if (dateStr >= firstOfMonth) count++;
    }
    
    return count;
  } catch (e) {
    console.error('getMonthlyVisitorCount_ error for sheet ' + sheetId + ': ' + e.message);
    return 0; // On error, allow registration (fail open)
  }
}

/**
 * Check if an origin is allowed for a given sheetId.
 * @param {string} origin - The Origin header value (or empty)
 * @param {string} sheetId - Customer's sheet ID
 * @returns {boolean} Whether the origin is allowed
 */
function isOriginAllowed_(origin, sheetId) {
  // No config loaded = allow all (fail-safe during setup)
  var config = getMasterConfig_();
  var customerConfig = config[sheetId];
  if (!customerConfig) return true;  // Unknown sheetId = allow (backwards compat)
  
  // Wildcard = allow all
  if (customerConfig.allowedOrigins.indexOf('*') >= 0) return true;
  
  // No origin sent = allow but log (deterrence, not security)
  if (!origin || origin.trim() === '') {
    console.warn('ORIGIN_WARN: No Origin header for sheet ' + sheetId + '. Allowing request.');
    return true;
  }
  
  // Normalize
  var o = origin.trim().toLowerCase().replace(/\/$/, '');
  
  // Check against allowed list
  for (var i = 0; i < customerConfig.allowedOrigins.length; i++) {
    var a = customerConfig.allowedOrigins[i];
    if (o === a) return true;
    // Allow trailing-slash variations
    if (o === a + '/') return true;
    if (o + '/' === a) return true;
  }
  
  // Block: log the attempt
  console.error('ORIGIN_BLOCK: Origin "' + origin + '" not allowed for sheet ' + sheetId);
  return false;
}

/**
 * Check visitor limit for a sheetId.
 * @param {string} sheetId - Customer's sheet ID
 * @returns {Object} { allowed: boolean, current: number, limit: number, pct: number }
 */
function checkVisitorLimit_(sheetId) {
  var config = getMasterConfig_();
  var customerConfig = config[sheetId];
  if (!customerConfig) {
    return { allowed: true, current: 0, limit: 999999, pct: 0 };
  }
  
  var limit = getEffectiveLimit_(customerConfig);
  var current = getMonthlyVisitorCount_(sheetId);
  var pct = limit > 0 ? Math.round((current / limit) * 100) : 0;
  
  return {
    allowed: current < limit,
    current: current,
    limit: limit,
    pct: pct,
  };
}
```

### Modified doGet()

No changes to doGet() for blocking — GET requests are read-only, no origin check. BUT add logging if desired:

```javascript
function doGet(e) {
  try {
    // Log origin for monitoring (non-blocking)
    if (e && e.parameter && e.parameter.sheetId && e.parameter.action) {
      var origin = (e.parameter.origin || '').trim();
      if (origin && origin !== 'null' && origin !== 'undefined') {
        var config = getMasterConfig_();
        var sheetId = e.parameter.sheetId;
        if (!isOriginAllowed_(origin, sheetId)) {
          console.warn('ORIGIN_LOG: GET ' + e.parameter.action + ' from ' + origin + ' for ' + sheetId);
        }
      }
    }
    // ... rest of existing doGet unchanged
```

### Modified doPost() — Origin check ONLY on register

```javascript
function doPost(e) {
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({ status: 'error', error: 'Invalid JSON payload' }, 400);
    }
    
    // ── ORIGIN CHECK: ONLY for mode=register (the billable action) ──
    var isRegister = (!data.mode || data.mode === 'register');
    if (isRegister) {
      var origin = data.origin || e.parameter.origin || '';
      var sheetId = data.sheetId || '';
      
      // Check origin
      if (!isOriginAllowed_(origin, sheetId)) {
        var logEntry = {
          timestamp: new Date().toISOString(),
          type: 'ORIGIN_BLOCK',
          sheetId: sheetId,
          origin: origin,
          action: 'register',
          visitorName: data.fullName || 'unknown',
        };
        logBlockedRequest_(logEntry);
        return jsonResponse({
          status: 'error',
          error: 'Access from this location is not authorised.',
          code: 'ORIGIN_BLOCKED',
        }, 403);
      }
      
      // Check visitor limit
      var limitCheck = checkVisitorLimit_(sheetId);
      if (!limitCheck.allowed) {
        return jsonResponse({
          status: 'error',
          error: 'Monthly visitor limit reached. Contact the office for assistance.',
          code: 'LIMIT_REACHED',
          usage: { current: limitCheck.current, limit: limitCheck.limit, pct: limitCheck.pct },
        }, 429);
      }
    }
    
    // ── ORIGIN CHECK applied. Continue with existing handler routing ──
    
    if (data.mode === 'migrate') { return handleMigrationResponse(data); }
    if (data.action === 'report') { return handleReport(data, data.sheetId); }
    if (data.mode === 'bulkSignOut') { return handleBulkSignOut(data); }
    if (data.mode === 'setupAutoSignOut') {
      setupAutoSignOutTrigger();
      return jsonResponse({ status: 'ok', message: 'Auto sign-out trigger set for 21:00' }, 200);
    }
    if (data.mode === 'updateStatus') { return handleStatusUpdate(data); }
    if (data.mode) {
      return jsonResponse({ status: 'error', error: 'Unknown mode: ' + data.mode }, 400);
    }
    
    return handleRegistration(data);
    
  } catch (error) {
    console.error('doPost error: ' + error.message + '\n' + error.stack);
    return jsonResponse({ error: error.message, status: 'error' }, 500);
  }
}
```

### New: Guard endpoint to check remaining allowance (for guard portal)

```javascript
/**
 * Allowance check — used by guard portal to show progress bar.
 * Not subject to origin check (guard portal is PIN-gated separately).
 * Returns current usage + limit without consuming anything.
 */
function handleAllowanceCheck(data) {
  var sheetId = data.sheetId || '';
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
```

### New: Guard override for hard blocks

```javascript
function handleOverrideRegister(data) {
  // Must have guard PIN verification (passed from frontend-gated button)
  // Returns the registration result despite limit being hit
  var logEntry = {
    timestamp: new Date().toISOString(),
    type: 'GUARD_OVERRIDE',
    sheetId: data.sheetId,
    origin: data.origin || '',
    visitorName: data.fullName || 'unknown',
    guardAction: 'register_exempt',
  };
  logBlockedRequest_(logEntry);
  return handleRegistration(data);  // Proceed with registration
}
```

### Logging function

```javascript
/**
 * Log blocked/override requests to a dedicated sheet in the master config spreadsheet.
 * Creates 'BlockedRequests' sheet if it doesn't exist.
 */
function logBlockedRequest_(entry) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty('MASTER_CONFIG_SHEET_ID');
    if (!sheetId) return;
    
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('BlockedRequests');
    if (!sheet) {
      sheet = ss.insertSheet('BlockedRequests');
      sheet.appendRow(['Timestamp', 'Type', 'SheetId', 'Origin', 'Action', 'VisitorName']);
    }
    sheet.appendRow([
      entry.timestamp,
      entry.type,
      entry.sheetId,
      entry.origin,
      entry.action || '',
      entry.visitorName || '',
    ]);
  } catch (e) {
    console.error('logBlockedRequest_ failed (non-fatal): ' + e.message);
  }
}
```

### Script Property Setup (new)

Add to `Code.gs` header documentation:
```
Script Properties (set in Project Settings > Script Properties):
  - MASTER_CONFIG_SHEET_ID: ID of the master config spreadsheet
  - SHEET_ID: (existing) Default sheet ID for single-sheet mode
  - DRIVE_FOLDER_ID: (existing) Parent Drive folder for VMS uploads
```

---

## 5. Validation Flow (Decision Tree for a Registration Request)

```
POST / (mode=register, sheetId, origin, visitorData)
│
├── 1. Parse JSON body
│   ├── Parse error → 400 { error: 'Invalid JSON payload' }
│   └── OK → continue
│
├── 2. isOriginAllowed_(origin, sheetId)
│   ├── Master config not found → ALLOW (fail-safe)
│   ├── Wildcard (*) in allowedOrigins → ALLOW
│   ├── Origin is empty → ALLOW + log warning
│   ├── Origin matches entry → ALLOW
│   └── No match → BLOCK: log to BlockedRequests, return 403
│       { error: 'Access from this location is not authorised.', code: 'ORIGIN_BLOCKED' }
│
├── 3. checkVisitorLimit_(sheetId)
│   ├── Config not found → ALLOW (fail-safe)
│   ├── current < limit → ALLOW (include pct in response for frontend)
│   └── current >= limit → BLOCK: return 429
│       { error: 'Monthly visitor limit reached...', code: 'LIMIT_REACHED', usage: {...} }
│
├── 4. handleRegistration(data)  [existing logic]
│   ├── Validate required fields → 400 if missing
│   ├── Create Drive folder
│   ├── Upload photos
│   ├── Generate visitor number
│   ├── Append row to sheet
│   ├── Send email (non-blocking)
│   └── Return 200 { visitorNumber, status: 'ok' }
│
└── End
```

---

## 6. Frontend Changes Required

### app.js — submitRegistration()

Add to the POST payload (already exists in the codebase):
```javascript
var payload = {
  // ... existing fields ...
  mode: 'register',           // Explicit — triggers origin+limit check
  origin: window.location.origin,  // Send origin for server-side check
  sheetId: CONFIG.SHEET_ID,
};
```

Add response handling for the new error codes:
```javascript
// After parse errors and before general error handling:
if (parsed.code === 'ORIGIN_BLOCKED') {
  showError(App.t('err-origin-blocked'));  // Generic "not authorised" message
  return;
}
if (parsed.code === 'LIMIT_REACHED') {
  showError(App.t('err-limit-reached'));   // "Contact the office" message
  return;
}
```

### To propagate error messages through submitRegistration cleanly, add these translations to lang.js:

```javascript
// Add under visitor-facing registration keys:
'en': {
  'err-origin-blocked': 'Registration is not available from this location.',
  'err-limit-reached': 'The monthly registration limit has been reached. Please contact the office.',
},
'id': {
  'err-origin-blocked': 'Pendaftaran tidak tersedia dari lokasi ini.',
  'err-limit-reached': 'Batas pendaftaran bulanan telah tercapai. Silakan hubungi kantor.',
},
```

### verify.js — Guard Portal Changes

Add a `/api/allowance` call after PIN verification:
```javascript
function fetchAllowance() {
  fetch(CONFIG.API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      mode: 'checkAllowance',
      sheetId: CONFIG.SHEET_ID,
    }),
    redirect: 'follow',
  })
  .then(function (res) { return res.text(); })
  .then(function (text) {
    var data = JSON.parse(text);
    if (data.status === 'ok' && data.usage) {
      renderAllowanceBar(data.usage);
    }
  })
  .catch(function () { /* Silently fail — non-critical */ });
}
```

Guard portal allowance bar (renders after PIN unlock):
```javascript
function renderAllowanceBar(usage) {
  var pct = usage.pct;
  var bar = document.getElementById('allowance-bar');
  if (!bar) return;
  
  bar.innerHTML = '';  // Clear
  bar.classList.remove('hidden');
  
  var fill = document.createElement('div');
  fill.className = 'allowance-fill';
  fill.style.width = Math.min(pct, 100) + '%';
  if (pct >= 80) fill.classList.add('allowance-warning');
  if (pct >= 100) fill.classList.add('allowance-full');
  bar.appendChild(fill);
  
  var label = document.createElement('span');
  label.className = 'allowance-label';
  label.textContent = App.t('allowance-label').replace('{current}', usage.current).replace('{limit}', usage.limit);
  bar.appendChild(label);
}
```

Guard override button (shown when limit is hit):
```javascript
// On register POST that returns LIMIT_REACHED:
if (parsed.code === 'LIMIT_REACHED') {
  showLimitReachedDialog(parsed.usage, function () {
    // "Register Exempt Visitor" button clicked by guard
    var overridePayload = payload;
    overridePayload.mode = 'overrideRegister';
    overridePayload.guardPin = storedPin;  // Already verified earlier in session
    // Resend with override mode...
  });
}
```

### report.js — Report Page

Add allowance bar to report header (after PIN unlock):
```javascript
// Same fetch + render pattern as guard portal
// Shows: "Monthly usage: 34 / 500" with progress bar
```

---

## 7. Priority Order

### Phase 1 — Core Infrastructure (Build FIRST, ~2–3 hours)

| # | Task | Files | Why First |
|---|------|-------|-----------|
| 1 | Create master config spreadsheet with `Customers` sheet | New sheet | Foundation for everything |
| 2 | Add `MASTER_CONFIG_SHEET_ID` Script Property | GAS project settings | Points GAS to the config |
| 3 | Add `getMasterConfig_()` + `isOriginAllowed_()` to Code.gs | Code.gs | In-memory cache pattern |
| 4 | Add origin check to `doPost()` — only for `mode=register` | Code.gs | Core gate |
| 5 | Add reserved row for knyf3.github.io in master config | Master config sheet | Dev deployment stays working |
| 6 | Add `logBlockedRequest_()` with BlockedRequests sheet | Code.gs | Audit trail from day one |

**Test:** visitor registration from knyf3.github.io works, from an unauthorized domain returns 403, from empty Origin still works.

### Phase 2 — Usage Tier Enforcement (~2 hours)

| # | Task | Files | Why This Order |
|---|------|-------|----------------|
| 7 | Add `getMonthlyVisitorCount_()` — compute from data | Code.gs | Core counter |
| 8 | Add `getEffectiveLimit_()` with tier defaults + grace period | Code.gs | Tier logic |
| 9 | Add `checkVisitorLimit_()` to register flow | Code.gs | Enforce limits |
| 10 | Add `handleAllowanceCheck()` endpoint | Code.gs | Power frontend bars |
| 11 | Add allowance bar to guard portal (verify.html/verify.js) | verify.* | Visible feedback for guards |

**Test:** hit free tier limit (register 51 visitors), verify 50th shows warning, 51st returns 429.

### Phase 3 — UX Polish & Guard Override (~2 hours)

| # | Task | Files | Why This Order |
|---|------|-------|----------------|
| 12 | Add overrideRegister mode + guard PIN re-verification | Code.gs + verify.js | Customer-facing feature |
| 13 | Add tiered error messages (3 tiers) | Code.gs | Visitor sees generic, guard sees actionable, admin gets log |
| 14 | Add allowance bar to report page header | report.js | Commercial visibility |
| 15 | Add translation keys (EN/ID) for new strings | lang.js | Bilingual support |

**Test:** guard can override limit, visitor never sees technical details.

### Phase 4 — Deferred (Build when customers ask or scale demands)

| # | Task | Rationale |
|---|------|-----------|
| 16 | Customer self-service portal for domain management | Not needed until >10 customers |
| 17 | Cloudflare Worker front-end with rate limiting | Not needed until >2,000 reqs/day |
| 18 | Per-customer GAS deployments | Not needed until >200 customers |
| 19 | Hybrid migration (Node.js + SQLite / Supabase) | Not needed until >500 customers |

---

## 8. Showstopper Assessment

| Issue | Severity | Status |
|-------|----------|--------|
| CORS preflight (OPTIONS) | 🔴 HIGH if `application/json` | ✅ **NOT an issue** — frontend uses `text/plain`, no preflight needed. Add comment to prevent accidental change |
| wrapper.gs UrlFetchApp has no Origin | 🔴 HIGH if origin check is global | ✅ **NOT an issue** — origin check is only on register. wrapper.gs calls migration/setup/signOut, not register |
| GAS daily quota (90 min runtime) | 🟡 MEDIUM at >2K reqs/day | ✅ **Acceptable** — Phase 1-3 works under 2K reqs/day. Phase 4 (Cloudflare) defers the wall |
| Master config sheet not set up | 🟡 MEDIUM — breaks registration | ✅ **Handled** — `getMasterConfig_()` returns empty config on error, fails open for backwards compat |
| GET destination fetch could show stale data | 🟢 LOW — read-only, not billable | ✅ **Acceptable** — no origin check on GET, but no data is created |
| sheetId still visible in client source code | 🟡 MEDIUM — unavoidable | ✅ **Known limitation** — real security is Sheet sharing permissions. Docs should state this explicitly |

**No showstoppers.** The implementation is safe to proceed with Phase 1 today.

---

## 9. Summary of All Changes Needed

### New Files
- None — all additions go into existing Code.gs, app.js, verify.js, report.js, lang.js, styles.css

### Modified Files
| File | Changes |
|------|---------|
| apps-script/Code.gs | ~150 new lines: getMasterConfig_(), isOriginAllowed_(), getMonthlyVisitorCount_(), getEffectiveLimit_(), checkVisitorLimit_(), handleAllowanceCheck(), handleOverrideRegister(), logBlockedRequest_(), modified doPost() |
| app.js | ~10 lines: add `mode: 'register'` and `origin: window.location.origin` to payload; add response handling for ORIGIN_BLOCKED and LIMIT_REACHED codes |
| verify.js | ~60 lines: add fetchAllowance(), renderAllowanceBar(), override register dialog, limit-reached dialog |
| report.js | ~30 lines: add allowance bar to header |
| lang.js | ~10 keys: new error messages, allowance label |
| styles.css | ~20 lines: allowance bar styles, override button styles |
| config.js | No changes needed (still contains SHEET_ID and GUARD_PIN) |

### New Google Resources
| Resource | Purpose |
|----------|---------|
| Master config spreadsheet | One spreadsheet housing two sheets: `Customers` (config) and `BlockedRequests` (audit log) |
| Reserved restricted sheet for knyf3.github.io demo | A real sheet with visitor data for dev/demo purposes |

### Script Properties to Set
| Key | Value |
|-----|-------|
| `MASTER_CONFIG_SHEET_ID` | ID of the master config spreadsheet |

---

## 10. Long-Term Architecture Note

The architect's scalability analysis is excellent. The key threshold is **~2,000–3,000 requests/day or ~200 customers**. Before that limit, the single GAS Web App + master config is the right architecture. After it, the migration path is clear: Cloudflare Worker (next step), then hybrid backend. The only addition I'd make: when adding the Cloudflare Worker in Phase 4, the Worker should **own the Origin check** — strip it from the request to GAS entirely. This eliminates the GAS-level origin check cost and lets GAS focus purely on data operations. This is already implied by the architect's Phase 2 design but should be explicit in planning.
