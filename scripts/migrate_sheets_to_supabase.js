// scripts/migrate_sheets_to_supabase.js
// Migrates CRM data from Google Sheets (via CSV export) into Supabase staging.
//
// HOW TO USE:
//   1. Open the production Google Sheet.
//   2. For each tab (Customers, Services, Followups, Churned), do:
//      File > Download > Comma Separated Values (.csv)
//      Save into ./migration_data/ as: customers.csv, services.csv,
//      followups.csv, churned.csv  (exact filenames matter)
//   3. Fill in .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//   4. Run: node scripts/migrate_sheets_to_supabase.js
//      (add --dry-run to preview row counts without writing anything)
//
// This script is idempotent: it upserts by primary key, so re-running is
// safe if a batch fails partway through.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DATA_DIR = path.join(__dirname, '..', 'migration_data');

// ---------------------------------------------------------------------
// Minimal CSV parser (no external dependency). Handles quoted fields with
// embedded commas/newlines — good enough for Google Sheets exports.
// ---------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h.trim()] = (r[idx] ?? '').trim(); });
    return obj;
  });
}

function loadCSV(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    console.warn(`⚠️  ${filename} not found in migration_data/, skipping`);
    return [];
  }
  const text = fs.readFileSync(p, 'utf8');
  return parseCSV(text);
}

// ---------------------------------------------------------------------
// Column mapping: Sheet header (Thai/English as used in the old system) ->
// Supabase column name (see analysis/supabase_schema.sql). Adjust the left
// side if your actual Sheet headers differ.
// ---------------------------------------------------------------------
function mapCustomer(r) {
  return {
    customer: r.customer,
    group_name: r.group_name || null,
    tier: r.tier || null,
    tier_remark: r.tier_remark || null,
    contact: r.contact || null,
    tel: r.tel || null,
    email: r.email || null,
    note: r.note || null,
    updated_by: r.updated_by || 'migration',
  };
}

function mapService(r) {
  return {
    id: r.id,
    customer: r.customer,
    item: r.item || null,
    type: r.type || null,
    qty: r.qty ? Number(r.qty) : null,
    price_unit: r.price_unit ? Number(r.price_unit) : null,
    price_year: r.price_year ? Number(r.price_year) : null,
    start: r.start || null,
    expire: r.expire || null,
    contact: r.contact || null,
    tel: r.tel || null,
    email: r.email || null,
    note: r.note || null,
    source: r.source || null,
    updated_by: r.updated_by || 'migration',
  };
}

function mapFollowup(r) {
  return {
    id: r.id,
    customer: r.customer,
    date: r.date || null,
    type: r.type || null,
    note: r.note || null,
    owner: r.owner || null,
    status: r.status || null,
    updated_by: r.updated_by || 'migration',
  };
}

function mapChurned(r) {
  return {
    name: r.name,
    services: r.services || null,
    lost_revenue: r.lost_revenue ? Number(r.lost_revenue) : null,
    expire: r.expire || null,
    reason: r.reason || null,
    winback: r.winback || null,
  };
}

async function upsertBatch(table, rows, conflictCol, batchSize = 200) {
  if (!rows.length) { console.log(`  (0 rows for ${table})`); return; }
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    if (DRY_RUN) {
      console.log(`  [dry-run] would upsert ${batch.length} rows into ${table}`);
      continue;
    }
    const { error } = await admin.from(table).upsert(batch, { onConflict: conflictCol });
    if (error) {
      console.error(`  ❌ ${table} batch ${i}-${i + batch.length}:`, error.message);
      process.exitCode = 1;
    } else {
      console.log(`  ✅ ${table}: upserted rows ${i + 1}-${i + batch.length}`);
    }
  }
}

(async () => {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== LIVE MIGRATION ===');

  const customers = loadCSV('customers.csv').map(mapCustomer).filter(r => r.customer);
  const services = loadCSV('services.csv').map(mapService).filter(r => r.id);
  const followups = loadCSV('followups.csv').map(mapFollowup).filter(r => r.id);
  const churned = loadCSV('churned.csv').map(mapChurned).filter(r => r.name);

  console.log(`Loaded: ${customers.length} customers, ${services.length} services, ` +
    `${followups.length} followups, ${churned.length} churned`);

  // Order matters: customers first (services/followups reference customer FK).
  console.log('\nCustomers:');
  await upsertBatch('customers', customers, 'customer');
  console.log('\nServices:');
  await upsertBatch('services', services, 'id');
  console.log('\nFollowups:');
  await upsertBatch('followups', followups, 'id');
  console.log('\nChurned:');
  await upsertBatch('churned_customers', churned, 'name');

  console.log('\nDone.');
})();
