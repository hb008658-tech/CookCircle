'use strict';

// Read-only check: compare local SQLite and Supabase row counts without
// reading records or requiring either CookCircle encryption key.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const { postgresConnectionConfig } = require('./cookcircle-postgres-ssl');

const root = __dirname;
const sourcePath = path.resolve(process.env.COOKCIRCLE_SOURCE_DB || path.join(root, 'cookcircle.sqlite'));
const tables = [
  'societies','users','sessions','service_categories','subscriptions','cook_profiles',
  'cook_service_societies','cook_documents','cook_availability','households','bookings',
  'booking_status_history','payments','credit_ledger','notifications','complaints',
  'society_registrations','cook_verification_records','backup_assignments','refunds',
  'cook_payouts','cook_cashouts','cook_cashout_items','reviews',
  'administrative_activity_logs','capacity_requests','help_requests'
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL was not provided. Run verify-cookcircle-supabase.cmd.');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new Client({ ...postgresConnectionConfig(process.env.DATABASE_URL), connectionTimeoutMillis: 15000 });
  let matches = true;
  try {
    await target.connect();
    for (const table of tables) {
      const exists = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      const localCount = exists ? source.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n : 0;
      const remote = await target.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
      const remoteCount = remote.rows[0].n;
      const equal = localCount === remoteCount;
      if (!equal) matches = false;
      console.log(`${equal ? 'MATCH' : 'DIFFERENT'} ${table}: local ${localCount}, Supabase ${remoteCount}`);
    }
    if (!matches) throw new Error('Some table totals differ. The migration may be incomplete, or local data changed after the copy.');
    console.log(`Verified: all ${tables.length} CookCircle table totals match. No records were changed by this check.`);
  } finally {
    source.close();
    await target.end().catch(() => {});
  }
}

main().catch(error => {
  const message = error.code === '28P01' || /password authentication failed/i.test(error.message)
    ? 'Supabase rejected the database login. Check the Session Pooler URI and database password; no data was changed.'
    : error.message;
  console.error(`Verification could not finish: ${message}`);
  process.exitCode = 1;
});
