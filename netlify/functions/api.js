// netlify/functions/api.js
// Single-endpoint backend for CCL CRM, mirroring the old Apps Script contract:
//   POST { action, payload, token }  ->  { ...result } | { error }
//   GET  ?action=load&token=...      ->  { customers, services, followups, churned }
//
// Auth: Supabase Auth (email/password). Frontend still logs in with a plain
// "username" (e.g. "Nic") — we map username -> `${username}@cclcrm.local`
// under the hood so nothing in the UI has to change.
//
// Session: we don't reinvent sessions — Supabase's own JWT access_token IS
// the AUTH.token the frontend already stores/sends on every request. No
// separate Sessions sheet/table needed.
//
// Admin-only actions (adminCreateUser/adminResetPassword/adminDeleteUser/
// adminListUsers) use the Supabase service_role key, which must NEVER reach
// the browser — hence this being a Netlify Function instead of client code.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const FAKE_EMAIL_DOMAIN = 'cclcrm.local';
const toEmail = (username) => `${String(username || '').trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
const toUsername = (email) => String(email || '').split('@')[0];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

// Admin client: full DB + auth admin access via service_role. Used only for
// operations that legitimately need it (admin user mgmt, and as a fallback
// data client since RLS policies key off auth.role()='authenticated', not
// a specific user, for the CRM tables).
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// User client bound to the caller's token: used to verify the token is a
// real, unexpired Supabase session and to know who + what role is calling.
function userClient(token) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAuth(token) {
  if (!token) return { error: 'auth_required', auth_required: true };
  const sb = userClient(token);
  const { data, error } = await sb.auth.getUser();
  if (error || !data || !data.user) return { error: 'auth_required', auth_required: true };
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('username, role').eq('id', data.user.id).single();
  return { user: data.user, username: profile?.username || toUsername(data.user.email), role: profile?.role || 'Staff' };
}

async function handleLogin(payload) {
  const { username, password } = payload || {};
  if (!username || !password) return { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
  if (error || !data.session) return { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('username, role').eq('id', data.user.id).single();
  const mustChange = data.user.user_metadata && data.user.user_metadata.must_change_password === true;

  return {
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    username: profile?.username || username,
    role: profile?.role || 'Staff',
    expires_at: new Date(data.session.expires_at * 1000).toISOString(),
    must_change_password: !!mustChange,
  };
}

async function handleChangePassword(auth, payload) {
  const admin = adminClient();
  const { new_password } = payload || {};
  if (!new_password || new_password.length < 8) return { error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' };
  const { error } = await admin.auth.admin.updateUserById(auth.user.id, {
    password: new_password,
    user_metadata: { must_change_password: false },
  });
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleLogout(auth) {
  // Supabase JWTs are stateless; client just discards the token. Nothing to
  // revoke server-side without extra infra, so this is a no-op that always
  // succeeds (matches old Apps Script contract's fire-and-forget logout).
  return { ok: true };
}

// ---- CRM data: load / save / delete ----------------------------------

async function handleLoad() {
  const admin = adminClient();
  const [customers, services, followups, churned] = await Promise.all([
    admin.from('customers').select('*'),
    admin.from('services').select('*'),
    admin.from('followups').select('*'),
    admin.from('churned_customers').select('*'),
  ]);
  for (const r of [customers, services, followups, churned]) {
    if (r.error) return { error: r.error.message };
  }
  return {
    customers: customers.data,
    services: services.data,
    followups: followups.data,
    churned: churned.data,
  };
}

async function handleSaveCustomer(auth, payload) {
  const admin = adminClient();
  const row = { ...payload, updated_by: auth.username, updated_at: new Date().toISOString() };
  const { error } = await admin.from('customers').upsert(row, { onConflict: 'customer' });
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleDeleteCustomer(payload) {
  const admin = adminClient();
  const { error } = await admin.from('customers').delete().eq('customer', payload.customer);
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleSaveService(auth, payload) {
  const admin = adminClient();
  const row = { ...payload, updated_by: auth.username, updated_at: new Date().toISOString() };
  const { error } = await admin.from('services').upsert(row, { onConflict: 'id' });
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleDeleteService(payload) {
  const admin = adminClient();
  const { error } = await admin.from('services').delete().eq('id', payload.id);
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleSaveFollowup(auth, payload) {
  const admin = adminClient();
  const row = { ...payload, updated_by: auth.username, updated_at: new Date().toISOString() };
  const { error } = await admin.from('followups').upsert(row, { onConflict: 'id' });
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleDeleteFollowup(payload) {
  const admin = adminClient();
  const { error } = await admin.from('followups').delete().eq('id', payload.id);
  if (error) return { error: error.message };
  return { ok: true };
}

async function handleRenameGroup(auth, payload) {
  const admin = adminClient();
  const { newName, members } = payload || {};
  if (!members || !members.length) return { ok: true };
  const { error } = await admin
    .from('customers')
    .update({ group_name: newName || null, updated_by: auth.username, updated_at: new Date().toISOString() })
    .in('customer', members);
  if (error) return { error: error.message };
  return { ok: true };
}

// ---- Admin: user management (service_role only, never in the browser) --

async function handleAdminListUsers(auth) {
  if (auth.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
  const admin = adminClient();
  const { data, error } = await admin.from('profiles').select('username, role, created_at').order('created_at');
  if (error) return { error: error.message };
  return { users: data };
}

async function handleAdminCreateUser(auth, payload) {
  if (auth.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
  const { username, role } = payload || {};
  if (!username) return { error: 'กรุณาระบุชื่อผู้ใช้' };
  const admin = adminClient();
  const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
  const { data, error } = await admin.auth.admin.createUser({
    email: toEmail(username),
    password: tempPassword,
    email_confirm: true,
    user_metadata: { username, must_change_password: true },
  });
  if (error) return { error: error.message };
  // Trigger auto-creates the profiles row; patch the role if not Staff.
  if (role === 'Admin') {
    await admin.from('profiles').update({ role: 'Admin' }).eq('id', data.user.id);
  }
  return { ok: true, username, temp_password: tempPassword };
}

async function handleAdminResetPassword(auth, payload) {
  if (auth.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
  const { username } = payload || {};
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('username', username).single();
  if (!profile) return { error: 'ไม่พบผู้ใช้นี้' };
  const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
  const { error } = await admin.auth.admin.updateUserById(profile.id, {
    password: tempPassword,
    user_metadata: { must_change_password: true },
  });
  if (error) return { error: error.message };
  return { ok: true, temp_password: tempPassword };
}

async function handleAdminDeleteUser(auth, payload) {
  if (auth.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
  const { username } = payload || {};
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('username', username).single();
  if (!profile) return { error: 'ไม่พบผู้ใช้นี้' };
  const { error } = await admin.auth.admin.deleteUser(profile.id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ---- Admin: change a user's role (Admin only) --------------------------

async function handleAdminUpdateRole(auth, payload) {
  if (auth.role !== 'Admin') return { error: 'ต้องเป็น Admin เท่านั้น' };
  const { username, role } = payload || {};
  if (!username) return { error: 'กรุณาระบุชื่อผู้ใช้' };
  if (role !== 'Admin' && role !== 'Staff') return { error: 'สิทธิ์ไม่ถูกต้อง' };
  if (username === auth.username && role !== 'Admin') {
    return { error: 'ไม่สามารถลดสิทธิ์ตัวเองได้ ให้ Admin คนอื่นเปลี่ยนแทน' };
  }
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('username', username).single();
  if (!profile) return { error: 'ไม่พบผู้ใช้นี้' };
  const { error } = await admin.from('profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', profile.id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ---- Router -------------------------------------------------------------

const ACTIONS = {
  saveCustomer: (auth, p) => handleSaveCustomer(auth, p),
  deleteCustomer: (auth, p) => handleDeleteCustomer(p),
  saveService: (auth, p) => handleSaveService(auth, p),
  deleteService: (auth, p) => handleDeleteService(p),
  saveFollowup: (auth, p) => handleSaveFollowup(auth, p),
  deleteFollowup: (auth, p) => handleDeleteFollowup(p),
  renameGroup: (auth, p) => handleRenameGroup(auth, p),
  changePassword: (auth, p) => handleChangePassword(auth, p),
  logout: (auth) => handleLogout(auth),
  adminListUsers: (auth) => handleAdminListUsers(auth),
  adminCreateUser: (auth, p) => handleAdminCreateUser(auth, p),
  adminResetPassword: (auth, p) => handleAdminResetPassword(auth, p),
  adminDeleteUser: (auth, p) => handleAdminDeleteUser(auth, p),
  adminUpdateRole: (auth, p) => handleAdminUpdateRole(auth, p),
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } };
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json(500, { error: 'Backend misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env vars' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const { action, token } = params;
      if (action === 'load') {
        const auth = await requireAuth(token);
        if (auth.error) return json(200, auth);
        const result = await handleLoad();
        return json(200, result);
      }
      return json(400, { error: 'unknown GET action' });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action, payload, token } = body;

      if (action === 'login') {
        const result = await handleLogin(payload);
        return json(200, result);
      }

      const auth = await requireAuth(token);
      if (auth.error) return json(200, auth);

      const fn = ACTIONS[action];
      if (!fn) return json(400, { error: 'unknown action: ' + action });
      const result = await fn(auth, payload);
      return json(200, result);
    }

    return json(405, { error: 'method not allowed' });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};
