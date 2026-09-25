// scripts/smoke_test_api.js
// Calls netlify/functions/api.js handler directly (no Netlify Dev needed)
// against Supabase staging, to sanity-check the backend before deploying.
//
// Usage: node scripts/smoke_test_api.js
// Requires .env with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

require('dotenv').config();
const { handler } = require('../netlify/functions/api.js');

function makeEvent({ method = 'GET', body, query } = {}) {
  return {
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    queryStringParameters: query || {},
  };
}

async function step(name, fn) {
  process.stdout.write(`▶ ${name} ... `);
  try {
    const result = await fn();
    console.log('✅', typeof result === 'object' ? JSON.stringify(result).slice(0, 120) : result);
    return result;
  } catch (e) {
    console.log('❌', e.message);
    process.exitCode = 1;
    return null;
  }
}

(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing env vars — check .env has SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('=== CCL CRM backend smoke test (against Supabase staging) ===\n');

  // 1. Login as Nic (Admin) — password must be supplied via env, never hardcoded.
  const adminPassword = process.env.SMOKE_TEST_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('Set SMOKE_TEST_ADMIN_PASSWORD env var (Nic\'s Supabase password) before running.');
    process.exit(1);
  }

  const loginRes = await step('POST login (nic)', async () => {
    const res = await handler(makeEvent({
      method: 'POST',
      body: { action: 'login', payload: { username: 'nic', password: adminPassword } },
    }));
    return JSON.parse(res.body);
  });

  if (!loginRes || loginRes.error || !loginRes.token) {
    console.error('\nLogin failed — cannot continue smoke test.', loginRes);
    process.exit(1);
  }
  const token = loginRes.token;
  console.log(`  role=${loginRes.role} username=${loginRes.username}`);

  // 2. Load CRM data
  await step('GET load (CRM data)', async () => {
    const res = await handler(makeEvent({ method: 'GET', query: { action: 'load', token } }));
    const data = JSON.parse(res.body);
    return {
      customers: data.customers?.length ?? data.error,
      services: data.services?.length,
      followups: data.followups?.length,
      churned: data.churned?.length,
    };
  });

  // 3. Admin: list users
  await step('POST adminListUsers', async () => {
    const res = await handler(makeEvent({
      method: 'POST',
      body: { action: 'adminListUsers', token },
    }));
    const data = JSON.parse(res.body);
    return { userCount: data.users?.length ?? data.error };
  });

  // 4. Create + delete a throwaway customer (round-trip write test)
  const testCustomer = `__smoke_test_${Date.now()}`;
  await step('POST saveCustomer (throwaway)', async () => {
    const res = await handler(makeEvent({
      method: 'POST',
      body: { action: 'saveCustomer', token, payload: { customer: testCustomer, tier: 'Test' } },
    }));
    return JSON.parse(res.body);
  });

  await step('POST deleteCustomer (cleanup)', async () => {
    const res = await handler(makeEvent({
      method: 'POST',
      body: { action: 'deleteCustomer', token, payload: { customer: testCustomer } },
    }));
    return JSON.parse(res.body);
  });

  console.log('\n=== Smoke test complete ===');
})();
