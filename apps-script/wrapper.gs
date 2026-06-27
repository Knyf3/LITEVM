/**
 * LITEVM — Thin Wrapper
 *
 * Runs as a bound script. All logic lives in the Web App.
 * Set WEB_APP_URL in Script Properties before using this file.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('📊 LITEVM')
      .addItem('⚙ Run Migration', 'runMigration')
      .addItem('⚙ Setup Auto Sign-Out (21:00)', 'runSetupAutoSignOut')
      .addItem('⚙ Register Sheet for Auto Sign-Out', 'runRegisterSheet')
      .addToUi();
  } catch(e) {}
}

function runMigration() { callWebApp_({ mode: 'migrate' }); }

function runSetupAutoSignOut() { callWebApp_({ mode: 'setupAutoSignOut' }); }

function runRegisterSheet() {
  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('CUSTOMER_SHEETS') || '';
  var sheets = existing ? existing.split(',') : [];
  if (sheets.indexOf(sheetId) === -1) {
    sheets.push(sheetId);
    props.setProperty('CUSTOMER_SHEETS', sheets.join(','));
    try { SpreadsheetApp.getActiveSpreadsheet().toast('✓ Sheet registered for auto sign-out', 'LITEVM', 3); } catch(e) {}
  } else {
    try { SpreadsheetApp.getActiveSpreadsheet().toast('ℹ Sheet already registered', 'LITEVM', 3); } catch(e) {}
  }
}

function callWebApp_(params) {
  var webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  if (!webAppUrl) {
    try { SpreadsheetApp.getUi().alert('⚠ WEB_APP_URL not set. Add it in File > Project properties > Script properties.'); } catch(e) {}
    return;
  }
  params.sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  try {
    var response = UrlFetchApp.fetch(webAppUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(params),
      muteHttpExceptions: true
    });
    var text = response.getContentText();
    if (!text || text.charAt(0) !== '{') {
      try { SpreadsheetApp.getUi().alert('⚠ Server returned an unexpected response. The Web App may need to be redeployed.'); } catch(e) {}
      return;
    }
    var result = JSON.parse(text);
    if (result.status === 'ok') {
      try { SpreadsheetApp.getActiveSpreadsheet().toast('✓ Done' + (result.message ? ': ' + result.message : ''), 'LITEVM', 3); } catch(e) {}
    } else {
      try { SpreadsheetApp.getUi().alert('⚠ Error: ' + (result.error || 'Unknown error')); } catch(e) {}
    }
  } catch (fetchError) {
    try { SpreadsheetApp.getUi().alert('⚠ Connection error. Check that the Web App URL is correct and the Web App is deployed.'); } catch(e) {}
  }
}
