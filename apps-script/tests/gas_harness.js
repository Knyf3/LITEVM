#!/usr/bin/env node
/**
 * Tier 1 + Tier 2 GAS verification harness.
 *
 * Runs the REAL Code.gs in a sandbox with stubbed Google services, so the new
 * bootstrap route, the read-through cache, cache invalidation and the queued
 * card email are EXECUTED and asserted — not merely grepped.
 *
 *   node /tmp/gas_harness.js
 */
const fs = require('fs');
const vm = require('vm');

const CODE = fs.readFileSync('/home/hermes/projects/LITEVM/apps-script/Code.gs', 'utf8');

// ── fake Google world ────────────────────────────────────────────────────
const SHEET_T1 = 'SHEET_T1';
const READS = {};              // tabName -> getDataRange() count
const CACHE_OPS = [];          // cache put/remove log
const MAIL_CALLS = [];         // GmailApp / MailApp sends
function countRead(tab) { READS[tab] = (READS[tab] || 0) + 1; }

function makeSheet(name, rows, parentRef) {
  const r = rows.map(x => x.slice());
  const sheet = {
    getParent: () => parentRef.ss,
    getName: () => name,
    _rows: r,
    getDataRange: () => { countRead(name); return { getValues: () => r.map(x => x.slice()) }; },
    getLastRow: () => r.length,
    getLastColumn: () => r.reduce((m, x) => Math.max(m, x.length), 0),
    appendRow: (row) => { r.push(row.slice()); CACHE_OPS.push('appendRow:' + name); },
    hideSheet: () => {}, setFrozenRows: () => {}, autoResizeColumns: () => {},
    getRange: (row, col, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => {
          countRead(name);
          const out = [];
          for (let i = 0; i < nr; i++) {
            const src = r[row - 1 + i] || [];
            const line = [];
            for (let j = 0; j < nc; j++) line.push(src[col - 1 + j]);
            out.push(line);
          }
          return out;
        },
        setValue: (v) => { countRead(name + ':write'); while (r.length < row) r.push([]); r[row - 1] = r[row - 1] || []; r[row - 1][col - 1] = v; },
        setValues: (vals) => { countRead(name + ':write'); for (let i = 0; i < vals.length; i++) { while (r.length < row + i) r.push([]); r[row - 1 + i] = (r[row - 1 + i] || []).slice(); for (let j = 0; j < vals[i].length; j++) r[row - 1 + i][col - 1 + j] = vals[i][j]; } },
        setFontWeight: () => {},
      };
    },
  };
  return sheet;
}

function makeSS(id, tabs) {
  const sheets = {};
  const parentRef = {};
  for (const k of Object.keys(tabs)) sheets[k] = makeSheet(k, tabs[k], parentRef);
  const ss = {
    getId: () => id,
    getSheetByName: (n) => sheets[n] || null,
    getActiveSheet: () => sheets['VisitorLog'] || sheets[Object.keys(sheets)[0]] || makeSheet('Sheet1', [], parentRef),
    getSheets: () => Object.keys(sheets).map(k => sheets[k]),
    insertSheet: (n) => { sheets[n] = makeSheet(n, [], parentRef); return sheets[n]; },
    getSpreadsheetTimeZone: () => 'Asia/Jakarta',
    _sheets: sheets,
  };
  parentRef.ss = ss;
  return ss;
}

const TODAY = new Date();              // "today" per the host clock — the code under test
                                       // derives todayStr from new Date() too, so the fixture
                                       // must agree or the filter legitimately returns nothing
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

const VL_HEADERS = ['Timestamp', 'Full Name', 'ID / Passport Number', 'Company Name', 'Destination',
  'Visitor Type', 'Visitation Date', 'Hand Phone', 'Email', 'ID Photo (Drive URL)',
  'Selfie (Drive URL)', 'Visitor Number', 'Status', 'Sign-In Time', 'Sign-Out Time'];

const customerSS = makeSS(SHEET_T1, {
  VisitorLog: [
    VL_HEADERS,
    [TODAY, 'Ada Lovelace', 'K111', 'ACME', 'BCA', 'Visitor', TODAY, '0811', 'ada@x.com', 'https://id', 'https://selfie', 'V-20260913-001', 'Pending Entry', '', ''],
    [TODAY, 'Grace Hopper', 'K222', 'NAVY', 'PLN', 'Contractor', TODAY, '0812', 'grace@x.com', 'https://id2', 'https://selfie2', 'V-20260913-002', 'Checked In', '09:10 13 Sep 2026', ''],
    [new Date(2026, 7, 30), 'Old Timer', 'K333', 'OLD', 'BCA', 'Visitor', iso(new Date(2026, 7, 30)), '0813', 'old@x.com', '', '', 'V-20260830-009', 'Signed Out', '', ''],
  ],
  Destination: [['Destination', 'Access Level', 'DoorGroupID'], ['BCA', '1', '2'], ['PLN', '1', '5']],
  VisitorType: [['Visitor Type'], ['Visitor'], ['Contractor']],
  Settings: [['Setting', 'Value'], ['autoSignOutEnabled', 'TRUE'], ['autoSignOutHour', '21'], ['guardPin', '4321'], ['timezone', 'Asia/Jakarta']],
  cardno: [['CardNo', 'Status', 'AssignedTo', 'AssignedAt', 'DoorGroupID'], ['5001', 'Assigned', 'V-20260913-002', '', '5']],
});

const masterSS = makeSS('MASTER_CFG', {
  Customers: [
    ['sheetId', 'allowedOrigins', 'tier', 'visitorLimit', 'status', 'notes', 'autoSignOutHour',
      'autoSignOutEnabled', 'timezone', 'retentionDays', 'expiryDate', 'expiryWarningDays'],
    [SHEET_T1, 'https://kiosk.local', 'pro', '200', 'active', '', '21', 'TRUE', 'Asia/Jakarta', '', '', '7'],
  ],
  PurgeLog: [['Timestamp', 'SheetId', 'Action']],
  ExpiryLog: [['Timestamp', 'SheetId', 'ExpiryDate', 'RemainingDays', 'Action', 'PreviousStatus']],
});

let TRIGGER_CHAIN;
{
  const handler = { get: (t, p) => (p === 'create' ? (() => ({})) : TRIGGER_CHAIN), apply: () => TRIGGER_CHAIN };
  TRIGGER_CHAIN = new Proxy(function () {}, handler);
}

const scriptProps = {};
const cacheStore = {};
const sandbox = {
  console,
  // Cross-realm trap: a Date built in THIS realm fails `instanceof Date` inside
  // the vm context, so Code.gs silently treated fixture dates as strings.
  // Share the constructor so instanceof means what it means in Apps Script.
  Date,
  Logger: { log: () => {} },
  SpreadsheetApp: { openById: (id) => (id === 'MASTER_CFG' ? masterSS : customerSS), getActiveSpreadsheet: () => customerSS },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v, ttl) => { cacheStore[k] = v; CACHE_OPS.push('put:' + k + '@' + ttl); },
      remove: (k) => { delete cacheStore[k]; CACHE_OPS.push('remove:' + k); },
    }),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
      setProperty: (k, v) => { scriptProps[k] = v; },
      deleteProperty: (k) => { delete scriptProps[k]; },
    }),
  },
  Session: { getScriptTimeZone: () => 'Asia/Jakarta', getActiveUser: () => ({ getEmail: () => 'tester@example.com' }) },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const p = (n) => String(n).padStart(2, '0');
      return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1))
        .replace('dd', p(d.getDate())).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()))
        .replace('MMM', M[d.getMonth()]);
    },
    computeDigest: () => [1, 2, 3],
    base64Encode: (s) => Buffer.from(s, 'binary').toString('base64'),
    base64EncodeWebSafe: (s) => Buffer.from(s, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (s) => ({ _body: s, setMimeType() { return this; }, getContent() { return this._body; } }),
  },
  ScriptApp: {
    getProjectTriggers: () => [],
    // Trigger builders are fluent and grow new rungs; a chainable proxy keeps
    // the harness honest without re-stubbing every method GAS adds.
    newTrigger: () => TRIGGER_CHAIN,
    deleteTrigger: () => {},
  },
  GmailApp: { sendEmail: (...a) => { MAIL_CALLS.push(['GmailApp', a[0]]); } },
  MailApp: { sendEmail: (o) => { MAIL_CALLS.push(['MailApp', o && o.to]); }, getRemainingDailyQuota: () => 100 },
  UrlFetchApp: { fetch: () => ({ getContentText: () => '{}', getResponseCode: () => 200 }) },
  DriveApp: { getFolderById: () => ({ createFile: () => ({ getId: () => 'f1', setSharing: () => {} }) }) },
  Drive: {},
  HtmlService: {},
  Gmail: undefined,
};
sandbox.global = sandbox;

vm.createContext(sandbox);
scriptProps['MASTER_CONFIG_ID'] = 'MASTER_CFG';
vm.runInContext(CODE, sandbox, { filename: 'Code.gs' });

// ── assertions ───────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function body(out) { return JSON.parse(out.getContent()); }
function boot() { return body(sandbox.doGet({ parameter: { action: 'bootstrap', sheetId: SHEET_T1 } })); }

console.log('\n=== T1: ?action=bootstrap assembles one round trip ===');
READS.length = 0; for (const k of Object.keys(READS)) delete READS[k];
const b1 = boot();
check('status ok', b1.status === 'ok', b1.status);
check('version is 1.20.0', b1.version === '1.20.0', b1.version);
check('config.guardPin from Settings tab', b1.config && b1.config.guardPin === '4321', b1.config && b1.config.guardPin);
check('config.actEnabled true for pro+active', b1.config && b1.config.actEnabled === true, b1.config && b1.config.actEnabled);
check('destinations returned (2)', Array.isArray(b1.destinations) && b1.destinations.length === 2, b1.destinations && b1.destinations.length);
check('visitorTypes returned (2)', Array.isArray(b1.visitorTypes) && b1.visitorTypes.length === 2, b1.visitorTypes);
check('visitors = today only (2 of 3 rows)', Array.isArray(b1.visitors) && b1.visitors.length === 2,
  b1.visitors && b1.visitors.map(v => v.visitorNumber));
if (!Array.isArray(b1.visitors) || b1.visitors.length !== 2) {
  try {
    console.log('  DIAG headers: ' + JSON.stringify(customerSS.getSheetByName('VisitorLog')._rows[0]));
    console.log('  DIAG resolveColumns(Visitation Date): ' + JSON.stringify(sandbox.resolveColumns([customerSS.getSheetByName('VisitorLog')._rows[0]], ['Visitation Date', 'Visitor Number', 'Status'])));
    console.log('  DIAG formatDate(TODAY): ' + sandbox.Utilities.formatDate(TODAY, 'Asia/Jakarta', 'yyyy-MM-dd'));
    console.log('  DIAG getDateString_(TODAY): ' + sandbox.getDateString_(TODAY, 'Asia/Jakarta'));
    console.log('  DIAG customerTz: ' + sandbox.getCustomerTimeZone_(SHEET_T1));
    console.log('  DIAG todayData: ' + JSON.stringify(sandbox._todayData_(SHEET_T1)).slice(0, 300));
  } catch (e) { console.log('  DIAG threw: ' + e.message + '\n' + e.stack); }
}
const ci = (b1.visitors || []).find(v => v.visitorNumber === 'V-20260913-002');
check('checked-in visitor carries cardNo (provenance)', !!ci && ci.cardNo === '5001', ci && ci.cardNo);

console.log('\n=== T2: read-through cache cuts repeat sheet reads ===');
const firstReads = JSON.parse(JSON.stringify(READS));
const b2 = boot();
const secondReads = JSON.parse(JSON.stringify(READS));
check('bootstrap #2 still ok', b2.status === 'ok');
check('visitors list identical (live read, not cached)', JSON.stringify(b1.visitors) === JSON.stringify(b2.visitors));
const d2 = (k) => (secondReads[k] || 0) - (firstReads[k] || 0);
check('boot #2: Settings NOT re-read (cached)', d2('Settings') === 0, { boot1: firstReads['Settings'], boot2: secondReads['Settings'] });
check('boot #2: Destination NOT re-read (cached)', d2('Destination') === 0, { boot1: firstReads['Destination'], boot2: secondReads['Destination'] });
check('boot #2: VisitorType NOT re-read (cached)', d2('VisitorType') === 0, { boot1: firstReads['VisitorType'], boot2: secondReads['VisitorType'] });
check('boot #2: VisitorLog IS re-read (today never cached)', d2('VisitorLog') >= 1, { boot1: firstReads['VisitorLog'], boot2: secondReads['VisitorLog'] });
check('cache put used a TTL', CACHE_OPS.some(o => o.startsWith('put:litevm:v1:settings:') && o.endsWith('@120')), CACHE_OPS.filter(o => o.startsWith('put:')));

console.log('\n=== T3: a Settings write invalidates the cached read ===');
sandbox._setSettingValue_(customerSS.getSheetByName('Settings'), 'guardPin', '9999');
check('invalidation emitted a cache remove', CACHE_OPS.some(o => o === 'remove:litevm:v1:settings:' + SHEET_T1), CACHE_OPS.filter(o => o.startsWith('remove:')));
const b3 = boot();
check('new guard PIN visible immediately after write', b3.config.guardPin === '9999', b3.config.guardPin);

console.log('\n=== T4: card email is QUEUED by default (Tier 2) ===');
MAIL_CALLS.length = 0;
sandbox.sendCardAssignmentEmail('visitor@example.com', '5001', 'Grace Hopper', 'V-20260913-002', SHEET_T1);
check('no synchronous mail send on the check-in path', MAIL_CALLS.length === 0, MAIL_CALLS);
check('EmailQueue tab was created', !!customerSS.getSheetByName('EmailQueue'));
check('EmailQueue row appended', CACHE_OPS.some(o => o === 'appendRow:EmailQueue'));
check('EMAIL_QUEUE_DIRTY flag set for the sweep', scriptProps['EMAIL_QUEUE_DIRTY'] === '1', scriptProps['EMAIL_QUEUE_DIRTY']);
const qrows = customerSS.getSheetByName('EmailQueue')._rows;
check('queued row is PENDING with the card recipient', qrows.length === 2 && qrows[1][2] === 'visitor@example.com' && qrows[1][5] === 'PENDING', qrows[1] && qrows[1].slice(0, 6));

console.log('\n=== T5: mode is reversible without a redeploy ===');
scriptProps['CARD_EMAIL_MODE'] = 'immediate';
MAIL_CALLS.length = 0;
const rowsBefore = customerSS.getSheetByName('EmailQueue')._rows.length;
sandbox.sendCardAssignmentEmail('visitor2@example.com', '5002', 'Ada Lovelace', 'V-20260913-001', SHEET_T1);
check('immediate mode sends synchronously (GmailApp tier)', MAIL_CALLS.length === 1 && MAIL_CALLS[0][0] === 'GmailApp', MAIL_CALLS);
check('immediate mode does NOT enqueue', customerSS.getSheetByName('EmailQueue')._rows.length === rowsBefore);
scriptProps['CARD_EMAIL_MODE'] = 'queue';
MAIL_CALLS.length = 0;
sandbox.sendCardAssignmentEmail('visitor3@example.com', '5003', 'Alan Turing', 'V-20260913-003', SHEET_T1);
check('back to queue mode: no mail, one more queued row', MAIL_CALLS.length === 0 && customerSS.getSheetByName('EmailQueue')._rows.length === rowsBefore + 1);

console.log('\n=== T6: legacy actions still work (no regression) ===');
const t = body(sandbox.doGet({ parameter: { action: 'today', sheetId: SHEET_T1 } }));
check('?action=today still returns visitors', t.status === 'ok' && t.visitors.length === 2, t.status);
const c = body(sandbox.doGet({ parameter: { action: 'config', sheetId: SHEET_T1 } }));
check('?action=config still returns guardPin', c.status === 'ok' && c.guardPin === '9999', c);
const d = body(sandbox.doGet({ parameter: { action: 'destinations', sheetId: SHEET_T1 } }));
check('?action=destinations still returns count', d.status === 'ok' && d.count === 2, d.count);
const v = body(sandbox.doGet({ parameter: { action: 'visitorTypes', sheetId: SHEET_T1 } }));
check('?action=visitorTypes still returns types', v.status === 'ok' && v.count === 2, v.count);
const lk = body(sandbox.doGet({ parameter: { action: 'lookup', sheetId: SHEET_T1, visitorNumber: 'V-20260913-002' } }));
check('?action=lookup still returns visitor + cardNo', lk.status === 'ok' && lk.visitor.cardNo === '5001', lk.status);
check('?action=lookup carries selfieUrl for provisioning', lk.visitor.selfieUrl === 'https://selfie2', lk.visitor.selfieUrl);
const h = body(sandbox.doGet({ parameter: {} }));
check('health check still reports the new version', h.status === 'ok' && h.version === '1.20.0', h);

console.log('\n──────────────────────────────────────────────');
console.log('Tier 1/2 GAS harness: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
