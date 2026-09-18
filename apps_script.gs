/**
 * CCL CRM — Google Apps Script backend (Google Sheet as database).
 *
 * Deploy as a Web App ("Anyone" access) and paste the resulting /exec
 * URL into index.html's SYNC_URL_PROD / SYNC_URL_STAGING, or into the
 * app's own ⚙️ Sync Settings.
 *
 * Setup (once, in the Apps Script editor for the target Sheet):
 *   1. Paste this whole file in as Code.gs.
 *   2. Run setupSheets() once (creates the 4 tabs + headers).
 *   3. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone → Deploy → copy the /exec URL.
 *
 * API contract (must match index.html's apiGet/apiPost calls):
 *   GET  ?action=ping                → { ok, server_time }
 *   GET  ?action=load                → { customers, services, followups,
 *                                        churned, server_time }
 *   POST { action: 'saveCustomer', payload: {customer, group_name, tier,
 *          tier_remark, contact, tel, email, note}, user }
 *   POST { action: 'saveService',  payload: {id, customer, item, type, qty,
 *          price_unit, price_year, start, expire, contact, tel, email,
 *          note, source}, user }
 *   POST { action: 'saveFollowup', payload: {id, customer, date, type,
 *          note, owner, status}, user }
 * Rows are upserted by key (customer name / id) — a matching key
 * overwrites the row, otherwise a new one is appended.
 */

const SHEETS = {
  Customers: ['customer', 'group_name', 'tier', 'tier_remark', 'contact', 'tel', 'email', 'note', 'updated_by', 'updated_at'],
  Services: ['id', 'customer', 'item', 'type', 'qty', 'price_unit', 'price_year', 'start', 'expire', 'contact', 'tel', 'email', 'note', 'source', 'updated_by', 'updated_at'],
  Followups: ['id', 'customer', 'date', 'type', 'note', 'owner', 'status', 'updated_by', 'updated_at'],
  Churned: ['name', 'services', 'lost_revenue', 'expire', 'reason', 'winback'],
};

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(name => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(SHEETS[name]);
  });
}

function doGet(e) {
  const action = (e.parameter.action || 'load');
  if (action === 'ping') return respond({ ok: true, server_time: new Date().toISOString() });
  if (action === 'load') return respond(loadAll());
  return respond({ error: 'unknown action: ' + action });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, payload, user } = body;
    if (action === 'saveCustomer') return respond(upsert('Customers', 'customer', payload, user));
    if (action === 'saveService') return respond(upsert('Services', 'id', payload, user));
    if (action === 'saveFollowup') return respond(upsert('Followups', 'id', payload, user));
    return respond({ error: 'unknown action: ' + action });
  } catch (err) {
    return respond({ error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

function loadAll() {
  return {
    customers: readRows('Customers'),
    services: readRows('Services'),
    followups: readRows('Followups'),
    churned: readRows('Churned'),
    server_time: new Date().toISOString(),
  };
}

function readRows(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const [header, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = row[i]; });
    return obj;
  });
}

// Overwrites the row whose `keyField` matches payload[keyField]; appends otherwise.
function upsert(sheetName, keyField, payload, user) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const header = SHEETS[sheetName];
  const keyCol = header.indexOf(keyField);
  const data = sheet.getDataRange().getValues();
  const rowValues = header.map(col => {
    if (col === 'updated_by') return user || 'anonymous';
    if (col === 'updated_at') return new Date().toISOString();
    return payload[col] !== undefined ? payload[col] : '';
  });
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][keyCol]) === String(payload[keyField])) {
      sheet.getRange(r + 1, 1, 1, rowValues.length).setValues([rowValues]);
      return { ok: true, updated: true };
    }
  }
  sheet.appendRow(rowValues);
  return { ok: true, created: true };
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
