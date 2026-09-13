/**
 * CCL CRM — Google Apps Script Backend (WITH AUTH)
 * ------------------------------------------------------------
 * เพิ่มจากเวอร์ชันเดิม:
 *   - Sheet ใหม่ 2 อัน: "Users" (บัญชีผู้ใช้) และ "Sessions" (token ที่ login แล้ว)
 *   - ทุก action (ยกเว้น login/ping) ต้องแนบ token ที่ valid มาด้วย ไม่งั้นถูกปฏิเสธ
 *   - Password เก็บเป็น SHA-256(password + salt) ไม่เก็บ plaintext
 *   - Lockout: ผิด 5 ครั้ง ล็อก 15 นาที
 *   - Session อายุ 30 วัน
 *   - Role: Admin (จัดการ user ได้) / Staff (แก้ข้อมูล CRM อย่างเดียว)
 *
 * วิธี deploy:
 *   1. เปิด Apps Script editor ของโปรเจกต์เดิม
 *   2. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดนี้ทั้งไฟล์แทน
 *   3. ใน editor เลือกฟังก์ชัน "setupAuthSheets_" จาก dropdown ด้านบน แล้วกด Run (▶️) ครั้งเดียว
 *      -> จะสร้าง sheet "Users" และ "Sessions" พร้อม header ให้อัตโนมัติ
 *   4. เลือกฟังก์ชัน "seedInitialUsers_" แล้วกด Run (▶️) ครั้งเดียว
 *      -> จะสร้างบัญชี Nic (Admin) และ faii.w (Staff) พร้อมรหัสผ่านชั่วคราว
 *      -> เปิด Executions log (View > Logs หรือ Executions) เพื่อดูรหัสผ่านชั่วคราวที่สร้างให้
 *      -> **ห้ามลืม copy รหัสผ่านชั่วคราวจาก log ไปให้เจ้าของบัญชี** เพราะระบบจะไม่โชว์ซ้ำอีก
 *   5. Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy
 *      (สำคัญ: ต้องสร้าง "New version" ทุกครั้งที่แก้โค้ด ไม่งั้นจะยัง serve โค้ดเก่าอยู่)
 *
 * Endpoints ใหม่/เปลี่ยนแปลง:
 *   POST {action:'login', payload:{username,password}}
 *       -> {ok:true, token, role, username, must_change_password, expires_at}
 *   POST {action:'changePassword', token, payload:{old_password?, new_password}}
 *       -> {ok:true}  (old_password ไม่บังคับถ้า must_change_password=true)
 *   POST {action:'logout', token}
 *       -> {ok:true}
 *   GET  ?action=load&token=...                  → ข้อมูล CRM (ต้อง login)
 *   ทุก POST action เดิม (saveCustomer, deleteService, ...) ต้องมี token แนบมาด้วย
 *
 *   Admin-only actions (role ต้องเป็น Admin):
 *   POST {action:'adminListUsers', token}
 *       -> {ok:true, users:[{username,role,must_change_password,locked_until,created_at}]}
 *   POST {action:'adminCreateUser', token, payload:{username, role, temp_password}}
 *       -> {ok:true}
 *   POST {action:'adminResetPassword', token, payload:{username, temp_password}}
 *       -> {ok:true}
 *   POST {action:'adminDeleteUser', token, payload:{username}}
 *       -> {ok:true}
 */

const SHEET_CUSTOMERS = 'Customers';
const SHEET_SERVICES  = 'Services';
const SHEET_FOLLOWUPS = 'Followups';
const SHEET_CHURNED   = 'Churned';
const SHEET_USERS     = 'Users';
const SHEET_SESSIONS  = 'Sessions';

const KEY_OF = {
  [SHEET_CUSTOMERS]: 'customer',
  [SHEET_SERVICES]:  'id',
  [SHEET_FOLLOWUPS]: 'id',
  [SHEET_CHURNED]:   'name',
};

const SESSION_DAYS = 30;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// Actions that do NOT require a valid session token
const PUBLIC_ACTIONS = { ping: true, login: true };

// ------------------------------------------------------------
// HTTP entry points
// ------------------------------------------------------------
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'load';
    if (action === 'ping') return json_({ ok: true, server_time: new Date().toISOString() });

    const auth = requireAuth_(e.parameter && e.parameter.token);
    if (auth.error) return json_({ error: auth.error, auth_required: true });

    if (action === 'load') return json_(loadAll_());
    return json_({ error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';
    const payload = body.payload || {};
    const stamp = new Date().toISOString();

    if (action === 'ping') return json_({ ok: true, server_time: stamp });
    if (action === 'login') return json_(login_(payload.username, payload.password));

    // Everything else needs a valid session
    const auth = requireAuth_(body.token);
    if (auth.error) return json_({ error: auth.error, auth_required: true });
    const by = auth.username;

    switch (action) {
      case 'logout':
        return json_(logout_(body.token));
      case 'changePassword':
        return json_(changePassword_(auth, payload.old_password, payload.new_password));

      case 'saveCustomer':
        return json_(upsertRow_(SHEET_CUSTOMERS, stampPayload_(payload, by, stamp)));
      case 'saveService':
        return json_(upsertRow_(SHEET_SERVICES, stampPayload_(payload, by, stamp)));
      case 'saveFollowup':
        return json_(upsertRow_(SHEET_FOLLOWUPS, stampPayload_(payload, by, stamp)));
      case 'saveChurned':
        return json_(upsertRow_(SHEET_CHURNED, stampPayload_(payload, by, stamp, false)));

      case 'deleteCustomer':
        return json_(deleteRow_(SHEET_CUSTOMERS, payload.customer));
      case 'deleteService':
        return json_(deleteRow_(SHEET_SERVICES, payload.id));
      case 'deleteFollowup':
        return json_(deleteRow_(SHEET_FOLLOWUPS, payload.id));
      case 'deleteChurned':
        return json_(deleteRow_(SHEET_CHURNED, payload.name));

      case 'renameGroup':
        return json_(renameGroup_(payload.oldName || '', payload.newName || '', payload.members || [], by, stamp));

      case 'bulkSave':
        return json_(bulkSave_(payload, by, stamp));

      // ---- Admin-only user management ----
      case 'adminListUsers':
        if (auth.role !== 'Admin') return json_({ error: 'ต้องเป็น Admin เท่านั้น' });
        return json_(adminListUsers_());
      case 'adminCreateUser':
        if (auth.role !== 'Admin') return json_({ error: 'ต้องเป็น Admin เท่านั้น' });
        return json_(adminCreateUser_(payload.username, payload.role, payload.temp_password));
      case 'adminResetPassword':
        if (auth.role !== 'Admin') return json_({ error: 'ต้องเป็น Admin เท่านั้น' });
        return json_(adminResetPassword_(payload.username, payload.temp_password));
      case 'adminDeleteUser':
        if (auth.role !== 'Admin') return json_({ error: 'ต้องเป็น Admin เท่านั้น' });
        return json_(adminDeleteUser_(payload.username));

      default:
        return json_({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    return json_({ error: String(err && err.message || err), stack: err && err.stack });
  }
}

// ------------------------------------------------------------
// Auth core
// ------------------------------------------------------------
function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function randomTempPassword_() {
  // Human-typable temp password: 10 chars, unambiguous charset
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function getUsersSheet_() { return getSheet_(SHEET_USERS); }
function getSessionsSheet_() { return getSheet_(SHEET_SESSIONS); }

function findUserRow_(username) {
  const sh = getUsersSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const uIdx = headers.indexOf('username');
  const uname = String(username || '').trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][uIdx] || '').trim().toLowerCase() === uname) {
      const obj = {};
      headers.forEach((h, j) => obj[h] = values[i][j]);
      obj._row = i + 1;
      obj._headers = headers;
      return obj;
    }
  }
  return null;
}

function login_(username, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = findUserRow_(username);
    if (!user) return { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

    const now = new Date();
    if (user.locked_until && new Date(user.locked_until) > now) {
      const mins = Math.ceil((new Date(user.locked_until) - now) / 60000);
      return { error: `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${mins} นาที` };
    }

    const hash = sha256Hex_(String(password || '') + String(user.salt || ''));
    if (hash !== user.password_hash) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const sh = getUsersSheet_();
      const headers = user._headers;
      sh.getRange(user._row, headers.indexOf('failed_attempts') + 1).setValue(attempts);
      if (attempts >= LOCKOUT_THRESHOLD) {
        const until = new Date(now.getTime() + LOCKOUT_MINUTES * 60000);
        sh.getRange(user._row, headers.indexOf('locked_until') + 1).setValue(until.toISOString());
        return { error: `พิมพ์รหัสผ่านผิดครบ ${LOCKOUT_THRESHOLD} ครั้ง — บัญชีถูกล็อก ${LOCKOUT_MINUTES} นาที` };
      }
      return { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    // Success: reset failed attempts + lock, create session
    const sh = getUsersSheet_();
    const headers = user._headers;
    sh.getRange(user._row, headers.indexOf('failed_attempts') + 1).setValue(0);
    sh.getRange(user._row, headers.indexOf('locked_until') + 1).setValue('');

    const token = randomToken_();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
    getSessionsSheet_().appendRow([token, user.username, user.role, createdAt, expiresAt]);
    cleanupExpiredSessions_();

    return {
      ok: true,
      token,
      role: user.role,
      username: user.username,
      must_change_password: user.must_change_password === true || String(user.must_change_password).toLowerCase() === 'true',
      expires_at: expiresAt,
    };
  } finally {
    lock.releaseLock();
  }
}

function requireAuth_(token) {
  if (!token) return { error: 'ต้อง login ก่อนใช้งาน' };
  const sh = getSessionsSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const tIdx = headers.indexOf('token');
  const now = new Date();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][tIdx]) === String(token)) {
      const row = {};
      headers.forEach((h, j) => row[h] = values[i][j]);
      if (new Date(row.expires_at) < now) return { error: 'Session หมดอายุ กรุณา login ใหม่' };
      return { username: row.username, role: row.role };
    }
  }
  return { error: 'Session ไม่ถูกต้อง กรุณา login ใหม่' };
}

function logout_(token) {
  const sh = getSessionsSheet_();
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(token)) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: true }; // already gone
}

function cleanupExpiredSessions_() {
  const sh = getSessionsSheet_();
  const values = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = values.length - 1; i >= 1; i--) {
    if (new Date(values[i][4]) < now) sh.deleteRow(i + 1);
  }
}

function changePassword_(auth, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    return { error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };
  }
  const user = findUserRow_(auth.username);
  if (!user) return { error: 'ไม่พบผู้ใช้' };

  const mustChange = user.must_change_password === true || String(user.must_change_password).toLowerCase() === 'true';
  if (!mustChange) {
    const oldHash = sha256Hex_(String(oldPassword || '') + String(user.salt || ''));
    if (oldHash !== user.password_hash) return { error: 'รหัสผ่านเดิมไม่ถูกต้อง' };
  }

  const salt = Utilities.getUuid();
  const newHash = sha256Hex_(String(newPassword) + salt);
  const sh = getUsersSheet_();
  const headers = user._headers;
  sh.getRange(user._row, headers.indexOf('password_hash') + 1).setValue(newHash);
  sh.getRange(user._row, headers.indexOf('salt') + 1).setValue(salt);
  sh.getRange(user._row, headers.indexOf('must_change_password') + 1).setValue(false);
  sh.getRange(user._row, headers.indexOf('updated_at') + 1).setValue(new Date().toISOString());
  return { ok: true };
}

// ------------------------------------------------------------
// Admin user management
// ------------------------------------------------------------
function adminListUsers_() {
  const sh = getUsersSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    headers.forEach((h, j) => { if (h !== 'password_hash' && h !== 'salt') obj[h] = values[i][j]; });
    out.push(obj);
  }
  return { ok: true, users: out };
}

function adminCreateUser_(username, role, tempPassword) {
  username = String(username || '').trim();
  if (!username) return { error: 'ต้องระบุ username' };
  if (findUserRow_(username)) return { error: 'username นี้มีอยู่แล้ว' };
  role = (role === 'Admin') ? 'Admin' : 'Staff';
  const pwd = tempPassword || randomTempPassword_();
  const salt = Utilities.getUuid();
  const hash = sha256Hex_(pwd + salt);
  const now = new Date().toISOString();
  getUsersSheet_().appendRow([username, hash, salt, role, true, 0, '', now, now]);
  return { ok: true, username, temp_password: pwd, role };
}

function adminResetPassword_(username, tempPassword) {
  const user = findUserRow_(username);
  if (!user) return { error: 'ไม่พบผู้ใช้' };
  const pwd = tempPassword || randomTempPassword_();
  const salt = Utilities.getUuid();
  const hash = sha256Hex_(pwd + salt);
  const sh = getUsersSheet_();
  const headers = user._headers;
  sh.getRange(user._row, headers.indexOf('password_hash') + 1).setValue(hash);
  sh.getRange(user._row, headers.indexOf('salt') + 1).setValue(salt);
  sh.getRange(user._row, headers.indexOf('must_change_password') + 1).setValue(true);
  sh.getRange(user._row, headers.indexOf('failed_attempts') + 1).setValue(0);
  sh.getRange(user._row, headers.indexOf('locked_until') + 1).setValue('');
  sh.getRange(user._row, headers.indexOf('updated_at') + 1).setValue(new Date().toISOString());
  return { ok: true, username, temp_password: pwd };
}

function adminDeleteUser_(username) {
  const user = findUserRow_(username);
  if (!user) return { error: 'ไม่พบผู้ใช้' };
  getUsersSheet_().deleteRow(user._row);
  return { ok: true };
}

// ------------------------------------------------------------
// Setup helpers (run once from the Apps Script editor)
// ------------------------------------------------------------
function setupAuthSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_USERS);
    sh.getRange(1, 1, 1, 9).setValues([[
      'username', 'password_hash', 'salt', 'role', 'must_change_password',
      'failed_attempts', 'locked_until', 'created_at', 'updated_at'
    ]]);
  }
  let sh2 = ss.getSheetByName(SHEET_SESSIONS);
  if (!sh2) {
    sh2 = ss.insertSheet(SHEET_SESSIONS);
    sh2.getRange(1, 1, 1, 5).setValues([['token', 'username', 'role', 'created_at', 'expires_at']]);
  }
  Logger.log('Users + Sessions sheets ready.');
}

// Run ONCE after setupAuthSheets_. Prints temp passwords to the execution log —
// copy them from there (View > Logs) and hand them to Nic / faii.w. They will be
// forced to change password on first login.
function seedInitialUsers_() {
  const seeds = [
    { username: 'Nic', role: 'Admin' },
    { username: 'faii.w', role: 'Staff' },
  ];
  seeds.forEach(s => {
    if (findUserRow_(s.username)) {
      Logger.log(s.username + ' already exists — skipped.');
      return;
    }
    const r = adminCreateUser_(s.username, s.role, null);
    Logger.log('Created ' + r.username + ' (' + r.role + ') — TEMP PASSWORD: ' + r.temp_password);
  });
}

// ------------------------------------------------------------
// Original CRM helpers (unchanged)
// ------------------------------------------------------------
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function stampPayload_(p, by, stamp, withUser) {
  const out = Object.assign({}, p);
  out.updated_at = stamp;
  if (withUser !== false) out.updated_by = by;
  return out;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name);
  return sh;
}

function readSheet_(name) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 1) return [];
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isEmpty = row.every(v => v === '' || v === null);
    if (isEmpty) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let v = row[j];
      if (v instanceof Date) {
        const iso = v.toISOString();
        v = (headers[j] === 'updated_at') ? iso : iso.slice(0, 10);
      }
      obj[headers[j]] = v;
    }
    rows.push(obj);
  }
  return rows;
}

function loadAll_() {
  return {
    customers: readSheet_(SHEET_CUSTOMERS),
    services:  readSheet_(SHEET_SERVICES),
    followups: readSheet_(SHEET_FOLLOWUPS),
    churned:   readSheet_(SHEET_CHURNED),
    server_time: new Date().toISOString(),
  };
}

function upsertRow_(sheetName, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(sheetName);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const keyCol = KEY_OF[sheetName];
    const keyIdx = headers.indexOf(keyCol);
    if (keyIdx < 0) throw new Error('ไม่พบคอลัมน์ key (' + keyCol + ') ในชีต ' + sheetName);

    const newKey = String(payload[keyCol] || '').trim();
    if (!newKey) throw new Error('payload ขาด ' + keyCol);

    let rowNum = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][keyIdx]).trim() === newKey) { rowNum = i + 1; break; }
    }

    const rowArr = headers.map(h => {
      if (h in payload) return payload[h];
      return (rowNum > 0) ? values[rowNum - 1][headers.indexOf(h)] : '';
    });

    if (rowNum > 0) {
      sh.getRange(rowNum, 1, 1, headers.length).setValues([rowArr]);
      return { ok: true, action: 'update', sheet: sheetName, key: newKey, row: rowNum };
    } else {
      sh.appendRow(rowArr);
      return { ok: true, action: 'insert', sheet: sheetName, key: newKey, row: sh.getLastRow() };
    }
  } finally {
    lock.releaseLock();
  }
}

function deleteRow_(sheetName, key) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(sheetName);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const keyCol = KEY_OF[sheetName];
    const keyIdx = headers.indexOf(keyCol);
    if (keyIdx < 0) throw new Error('no key column: ' + keyCol);
    const k = String(key || '').trim();
    if (!k) return { ok: false, error: 'empty key' };
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][keyIdx]).trim() === k) {
        sh.deleteRow(i + 1);
        return { ok: true, action: 'delete', sheet: sheetName, key: k };
      }
    }
    return { ok: false, error: 'not found: ' + k };
  } finally {
    lock.releaseLock();
  }
}

function renameGroup_(oldName, newName, members, by, stamp) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(SHEET_CUSTOMERS);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const keyIdx = headers.indexOf('customer');
    const gIdx = headers.indexOf('group_name');
    const uaIdx = headers.indexOf('updated_at');
    const ubIdx = headers.indexOf('updated_by');
    if (keyIdx < 0 || gIdx < 0) throw new Error('missing columns');

    const memSet = {};
    (members || []).forEach(m => memSet[String(m)] = true);

    let changed = 0;
    for (let i = 1; i < values.length; i++) {
      const cust = String(values[i][keyIdx] || '');
      const cur = String(values[i][gIdx] || '');
      const shouldBe = memSet[cust] ? newName : (cur === oldName ? '' : cur);
      if (shouldBe !== cur) {
        values[i][gIdx] = shouldBe;
        if (uaIdx >= 0) values[i][uaIdx] = stamp;
        if (ubIdx >= 0) values[i][ubIdx] = by;
        sh.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
        changed++;
      }
    }
    return { ok: true, changed: changed };
  } finally {
    lock.releaseLock();
  }
}

function bulkSave_(payload, by, stamp) {
  const results = {};
  (['customers', 'services', 'followups', 'churned']).forEach(k => {
    const arr = payload[k] || [];
    const sheetName = k === 'customers' ? SHEET_CUSTOMERS
                    : k === 'services'  ? SHEET_SERVICES
                    : k === 'followups' ? SHEET_FOLLOWUPS
                    : SHEET_CHURNED;
    const ok = [];
    const err = [];
    arr.forEach(rec => {
      try {
        upsertRow_(sheetName, stampPayload_(rec, by, stamp, sheetName !== SHEET_CHURNED));
        ok.push(rec[KEY_OF[sheetName]]);
      } catch (e) {
        err.push({ key: rec[KEY_OF[sheetName]], error: String(e.message || e) });
      }
    });
    results[k] = { saved: ok.length, errors: err };
  });
  return { ok: true, results: results };
}

// ------------------------------------------------------------
// Quick test helpers (run from Apps Script editor)
// ------------------------------------------------------------
function test_load() {
  const out = loadAll_();
  Logger.log('customers: ' + out.customers.length);
  Logger.log('services:  ' + out.services.length);
  Logger.log('followups: ' + out.followups.length);
  Logger.log('churned:   ' + out.churned.length);
}
