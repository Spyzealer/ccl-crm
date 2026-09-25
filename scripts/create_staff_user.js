// scripts/create_staff_user.js
// Creates the "faii.w" Staff account in Supabase Auth (staging).
// Requires .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY populated.
//
// Usage: node scripts/create_staff_user.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERNAME = 'faii.w';
const EMAIL = `${USERNAME}@cclcrm.local`;
const ROLE = 'Staff';

function genPassword() {
  return Math.random().toString(36).slice(-10) + 'Aa1!';
}

(async () => {
  const tempPassword = genPassword();

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { username: USERNAME, must_change_password: true },
  });

  if (error) {
    console.error('Create user failed:', error.message);
    process.exit(1);
  }

  // The DB trigger auto-creates the profiles row with role='Staff' by default,
  // so no extra update needed unless ROLE !== 'Staff'.
  if (ROLE !== 'Staff') {
    await admin.from('profiles').update({ role: ROLE }).eq('id', data.user.id);
  }

  console.log(`Created user: ${USERNAME} (${EMAIL}), role=${ROLE}`);
  console.log(`Temp password: ${tempPassword}`);
  console.log('IMPORTANT: copy this password now, it will not be shown again.');

  // Append to the local (gitignored) secrets file for reference.
  const fs = require('fs');
  const line = `Supabase Staging Staff login: ${EMAIL} / password: ${tempPassword}\n`;
  fs.appendFileSync(require('path').join(__dirname, '..', '.secrets_staging.txt'), line);
  console.log('Appended to .secrets_staging.txt');
})();
