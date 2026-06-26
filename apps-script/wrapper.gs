/**
 * LITEVM — Thin Wrapper (replaces Dashboard.gs + Reports.gs)
 *
 * Runs as a bound script. All logic lives in the Web App.
 * Set WEB_APP_URL in Script Properties (File > Project properties > Script properties)
 * before using this file.
 */

function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('📊 LITEVM')
      .addItem('⟳ Refresh Dashboard', 'refreshDashboard')
      .addSeparator()
      .addItem('📋 Daily Summary', 'dailySummary')
      .addItem('📋 Visitor Log', 'visitorLog')
      .addSeparator()
      .addItem('⚙ Setup Dashboard', 'setupDashboard')
      .addItem('⚙ Setup Report', 'setupReport')
      .addSeparator()
      .addItem('⚙ Run Migration', 'runMigration')
      .addToUi();
  } catch(e) {}
}

function refreshDashboard() { callWebApp_({ mode: 'dashboard' }); }
function dailySummary()     { callWebApp_({ mode: 'report', reportType: 'daily' }); }
function visitorLog()       { callWebApp_({ mode: 'report', reportType: 'visitors' }); }
function setupDashboard()   { callWebApp_({ mode: 'setup', setupType: 'dashboard' }); }
function setupReport()      { callWebApp_({ mode: 'setup', setupType: 'report' }); }
function runMigration()     { callWebApp_({ mode: 'migrate' }); }

function callWebApp_(params) {
  var webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  if (!webAppUrl) {
    SpreadsheetApp.getUi().alert('⚠ WEB_APP_URL not set. Add it in File > Project properties > Script properties.');
    return;
  }

  params.sheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

  var response = UrlFetchApp.fetch(webAppUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(params),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (result.status === 'ok') {
    try { SpreadsheetApp.getActiveSpreadsheet().toast('✓ Done' + (result.message ? ': ' + result.message : ''), 'LITEVM', 3); } catch(e) {}
  } else {
    try { SpreadsheetApp.getUi().alert('⚠ Error: ' + (result.error || 'Unknown error')); } catch(e) {}
  }
}
