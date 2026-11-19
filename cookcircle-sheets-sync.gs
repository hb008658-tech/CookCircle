/**
 * CookCircle directory sync for the private CookCircle Admin Directory Sheet.
 * Deploy as a web app that executes as the spreadsheet owner.
 * The shared token is stored in Script Properties, never in this source file.
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('COOKCIRCLE_SHEETS_SYNC_TOKEN') || '';
    if (!expected || !safeTokenEquals_(String(body.token || ''), expected)) {
      return json_({ ok: false, error: 'Unauthorized' });
    }
    if (!Array.isArray(body.cooks) || !Array.isArray(body.societies) ||
        body.cooks.length > 5000 || body.societies.length > 5000 ||
        body.cooks.some(row => !Array.isArray(row) || row.length !== 7) ||
        body.societies.some(row => !Array.isArray(row) || row.length !== 6)) {
      return json_({ ok: false, error: 'Invalid directory data' });
    }

    const spreadsheet = SpreadsheetApp.openById('1RObGhw51s9tLHVMq4Qlvay-8QCGH_FG_8H1t4RoVdzs');
    writeTab_(spreadsheet, 'Cooks', [
      'Cook ID', 'Cook name', 'Verification status', 'Active',
      'Service societies', 'Experience (years)', 'Synced at (UTC)'
    ], body.cooks);
    writeTab_(spreadsheet, 'Societies', [
      'Society ID', 'Society name', 'City', 'Active',
      'Created at (UTC)', 'Synced at (UTC)'
    ], body.societies);
    return json_({ ok: true, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('CookCircle sheet sync failed:', error);
    return json_({ ok: false, error: 'Sync failed' });
  }
}

function writeTab_(spreadsheet, name, headers, rows) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const values = [headers, ...rows].map(row => row.map(safeCell_));
  const oldLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  if (oldLastRow > values.length) {
    sheet.getRange(values.length + 1, 1, oldLastRow - values.length, headers.length).clearContent();
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}

// Treat any user-controlled strings beginning with formula prefixes as plain text.
function safeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function safeTokenEquals_(provided, expected) {
  if (!provided || provided.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
