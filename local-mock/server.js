// local-mock/server.js
// Zero-dependency local test server for CCL CRM.
// Serves the static app (../index.html etc.) AND mocks the
// /.netlify/functions/api backend with in-memory mock data —
// no Supabase, no Netlify, no network calls, no real customer data.
//
// Usage:  node local-mock/server.js [port]
// Then open http://localhost:8888 (or your LAN IP for phone testing).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.argv[2] || 8888;
const ROOT = path.join(__dirname, '..'); // serve the real index.html etc.

// ---------------------------------------------------------------------
// Mock data — small, obviously-fake dataset. Enough shape to exercise
// every screen (dashboard KPIs, tables, modals, command palette, mobile
// nav) without touching production/staging data.
// ---------------------------------------------------------------------
const now = () => new Date().toISOString();
const in_ = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let DB = {
  customers: [
    { customer: 'Mock Trading Co., Ltd.', group_name: '', tier: 'Gold', tier_remark: '', contact: 'คุณทดสอบ หนึ่ง', tel: '0812345678', email: 'test1@mock.local', note: '', updated_at: now(), updated_by: 'system' },
    { customer: 'Demo Logistics Ltd.', group_name: 'Demo Group', tier: 'Diamond', tier_remark: '', contact: 'คุณทดสอบ สอง', tel: '0899999999', email: 'test2@mock.local', note: 'ลูกค้าเก่าแก่', updated_at: now(), updated_by: 'system' },
    { customer: 'Sample Manufacturing PLC', group_name: 'Demo Group', tier: 'Silver', tier_remark: '', contact: '', tel: '', email: '', note: '', updated_at: now(), updated_by: 'system' },
    { customer: 'Placeholder Retail Co.', group_name: '', tier: 'Basic', tier_remark: '', contact: 'คุณทดสอบ สาม', tel: '0855555555', email: '', note: 'ต้องติดตาม', updated_at: now(), updated_by: 'system' },
  ],
  services: [
    { id: '1', customer: 'Mock Trading Co., Ltd.', item: 'mocktrading.co.th', type: 'Domain', qty: 1, price_unit: 500, price_year: 500, start: in_(-300), expire: in_(15), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
    { id: '2', customer: 'Mock Trading Co., Ltd.', item: 'Hosting Plan A', type: 'Hosting', qty: 1, price_unit: 3000, price_year: 3000, start: in_(-300), expire: in_(-5), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
    { id: '3', customer: 'Demo Logistics Ltd.', item: 'demologistics.com', type: 'SSL', qty: 1, price_unit: 2500, price_year: 2500, start: in_(-100), expire: in_(45), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
    { id: '4', customer: 'Demo Logistics Ltd.', item: 'Mail Hosting', type: 'Mail', qty: 10, price_unit: 800, price_year: 8000, start: in_(-200), expire: in_(200), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
    { id: '5', customer: 'Sample Manufacturing PLC', item: 'Software MA', type: 'SoftwareMA', qty: 1, price_unit: 45000, price_year: 45000, start: in_(-60), expire: in_(300), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
    { id: '6', customer: 'Placeholder Retail Co.', item: 'placeholder.shop', type: 'Domain', qty: 1, price_unit: 450, price_year: 450, start: in_(-400), expire: in_(-40), contact: '', tel: '', email: '', note: '', source: 'MOCK', updated_at: now(), updated_by: null },
  ],
  followups: [
    { id: 'mock-fu-1', customer: 'Placeholder Retail Co.', date: in_(-3), type: 'Phone', note: 'โทรติดตามเรื่องต่ออายุ domain (ข้อมูลจำลอง)', owner: '', status: 'Open', updated_at: now(), updated_by: 'tester' },
  ],
  churned: [
    { name: 'Old Closed Co. (mock)', services: 'Hosting, Domain', lost_revenue: 12000, expire: in_(-400), reason: 'ทดสอบระบบ — ไม่ใช่ข้อมูลจริง', winback: '', updated_at: now() },
  ],
  profiles: [
    { username: 'test', role: 'Admin', created_at: now() },
    { username: 'staff', role: 'Staff', created_at: now() },
  ],
};

// ---------------------------------------------------------------------
// Fake auth: accept ANY username/password, issue a random mock token.
// No real Supabase session — this is local UI testing only.
// ---------------------------------------------------------------------
const SESSIONS = new Map(); // token -> { username, role }

function issueToken(username) {
  const token = 'mock_' + crypto.randomBytes(16).toString('hex');
  const role = (DB.profiles.find(p => p.username === username) || {}).role || 'Admin'; // default Admin so all UI is testable
  SESSIONS.set(token, { username, role });
  return { token, role };
}

function auth(token) {
  if (!token || !SESSIONS.has(token)) return { error: 'auth_required', auth_required: true };
  const s = SESSIONS.get(token);
  return { user: { id: s.username }, username: s.username, role: s.role };
}

// ---------------------------------------------------------------------
// Action handlers — same contract shape as netlify/functions/api.js,
// but operating on the in-memory DB above instead of Supabase.
// ---------------------------------------------------------------------
function handleLoad() {
  return { customers: DB.customers, services: DB.services, followups: DB.followups, churned: DB.churned };
}

function upsert(list, row, key) {
  const i = list.findIndex(r => r[key] === row[key]);
  if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
}

const ACTIONS = {
  saveCustomer: (a, p) => { upsert(DB.customers, { ...p, updated_by: a.username, updated_at: now() }, 'customer'); return { ok: true }; },
  deleteCustomer: (a, p) => { DB.customers = DB.customers.filter(c => c.customer !== p.customer); return { ok: true }; },
  saveService: (a, p) => {
    const row = { ...p, updated_by: a.username, updated_at: now() };
    if (!row.id) row.id = 'mock-' + crypto.randomBytes(4).toString('hex');
    upsert(DB.services, row, 'id');
    return { ok: true };
  },
  deleteService: (a, p) => { DB.services = DB.services.filter(s => s.id !== p.id); return { ok: true }; },
  saveFollowup: (a, p) => {
    const row = { ...p, updated_by: a.username, updated_at: now() };
    if (!row.id) row.id = 'mock-fu-' + crypto.randomBytes(4).toString('hex');
    upsert(DB.followups, row, 'id');
    return { ok: true };
  },
  deleteFollowup: (a, p) => { DB.followups = DB.followups.filter(f => f.id !== p.id); return { ok: true }; },
  renameGroup: (a, p) => {
    const { newName, members } = p || {};
    if (members) DB.customers.forEach(c => { if (members.includes(c.customer)) c.group_name = newName || ''; });
    return { ok: true };
  },
  changePassword: () => ({ ok: true }),
  logout: () => ({ ok: true }),
  adminListUsers: (a) => a.role === 'Admin' ? { users: DB.profiles } : { error: 'ต้องเป็น Admin เท่านั้น' },
  adminCreateUser: (a, p) => {
    if (a.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
    DB.profiles.push({ username: p.username, role: p.role || 'Staff', created_at: now() });
    return { ok: true, username: p.username, temp_password: 'mock1234' };
  },
  adminResetPassword: (a) => a.role === 'Admin' ? { ok: true, temp_password: 'mock1234' } : { error: 'ต้องเป็น Admin เท่านั้น' },
  adminDeleteUser: (a, p) => {
    if (a.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
    DB.profiles = DB.profiles.filter(u => u.username !== p.username);
    return { ok: true };
  },
  adminUpdateRole: (a, p) => {
    if (a.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
    const u = DB.profiles.find(x => x.username === p.username);
    if (u) u.role = p.role;
    return { ok: true };
  },
};

// ---------------------------------------------------------------------
// HTTP server: static file serving + the mock API endpoint
// ---------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end();
    return;
  }

  if (u.pathname === '/.netlify/functions/api') {
    if (req.method === 'GET') {
      const action = u.searchParams.get('action');
      const token = u.searchParams.get('token');
      if (action === 'load') {
        const a = auth(token);
        if (a.error) return sendJson(res, 200, a);
        return sendJson(res, 200, handleLoad());
      }
      return sendJson(res, 400, { error: 'unknown GET action' });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (e) {}
        const { action, payload, token } = parsed;
        if (action === 'login') {
          // Accept ANY username/password for local testing.
          const { token: t, role } = issueToken((payload && payload.username) || 'test');
          return sendJson(res, 200, {
            token: t, refresh_token: t, username: (payload && payload.username) || 'test',
            role, expires_at: new Date(Date.now() + 86400000).toISOString(), must_change_password: false,
          });
        }
        const a = auth(token);
        if (a.error) return sendJson(res, 200, a);
        const fn = ACTIONS[action];
        if (!fn) return sendJson(res, 400, { error: 'unknown action: ' + action });
        return sendJson(res, 200, fn(a, payload));
      });
      return;
    }
  }

  serveStatic(req, res, u.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let lan = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) lan = net.address;
    }
  }
  console.log(`\n✅ CCL CRM local mock server running`);
  console.log(`   Desktop: http://localhost:${PORT}`);
  if (lan) console.log(`   Phone (same WiFi): http://${lan}:${PORT}`);
  console.log(`   Login: ANY username/password works (e.g. test / test)`);
  console.log(`   Data:  in-memory mock only — no Supabase, no real data\n`);
});
