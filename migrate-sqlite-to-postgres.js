'use strict';

// One-time, transactional migration. Secrets are supplied through process
// environment variables by the local PowerShell wizard; never put them here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const { postgresConnectionConfig } = require('./cookcircle-postgres-ssl');

const root = __dirname;
const sourcePath = path.resolve(process.env.COOKCIRCLE_SOURCE_DB || path.join(root, 'cookcircle.sqlite'));
const schemaPath = path.join(root, 'cookcircle-postgres-schema.sql');
const url = process.env.DATABASE_URL || '';
const oldKeyText = process.env.COOKCIRCLE_OLD_DOCUMENT_KEY || '';
const newKeyText = process.env.COOKCIRCLE_DOCUMENT_KEY || '';

function keyFrom(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a 64-character hexadecimal key.`);
  return Buffer.from(value, 'hex');
}
function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Unsafe database identifier.');
  return `"${value}"`;
}
function decrypt(bytes, nonce, tag, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(bytes)), decipher.final()]);
}
function encrypt(bytes, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { encrypted, nonce, tag: cipher.getAuthTag() };
}
function orderSchema(raw) {
  const statements = raw.split(/;\s*(?=\S|$)/).map(s => s.trim()).filter(Boolean);
  const tables = statements.filter(s => /^CREATE\s+TABLE/i.test(s));
  const other = statements.filter(s => !/^CREATE\s+TABLE/i.test(s));
  const nameOf = s => (s.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w"]+)/i) || s.match(/^CREATE\s+TABLE\s+([\w"]+)/i) || [])[1]?.replaceAll('"', '').toLowerCase();
  const waiting = tables.slice(), made = new Set(), ordered = [];
  while (waiting.length) {
    let moved = false;
    for (let i = 0; i < waiting.length;) {
      const sql = waiting[i], name = nameOf(sql);
      const refs = [...sql.matchAll(/\bREFERENCES\s+([\w"]+)\s*\(/ig)].map(m => m[1].replaceAll('"', '').toLowerCase()).filter(v => v !== name);
      if (refs.every(ref => made.has(ref))) { ordered.push(sql); if (name) made.add(name); waiting.splice(i, 1); moved = true; }
      else i++;
    }
    if (!moved) throw new Error(`Could not order PostgreSQL tables: ${waiting.map(nameOf).join(', ')}`);
  }
  return [...ordered, ...other];
}
function encryptedCookProfile(row, oldKey, newKey) {
  for (const [clearColumn, cipherColumn, nonceColumn, tagColumn] of [
    ['address', 'address_encrypted', 'address_nonce', 'address_tag'],
    ['phone', 'phone_encrypted', 'phone_nonce', 'phone_tag'],
    [null, 'photo_encrypted', 'photo_nonce', 'photo_tag']
  ]) {
    // Some earlier local database versions kept cook contact details as plain
    // text. Encrypt those too instead of copying them into hosted columns.
    const clear = row[cipherColumn]
      ? decrypt(row[cipherColumn], row[nonceColumn], row[tagColumn], oldKey)
      : clearColumn && String(row[clearColumn] || '').length
        ? Buffer.from(String(row[clearColumn]), 'utf8')
        : null;
    if (!clear) { if (clearColumn) row[clearColumn] = ''; continue; }
    const next = encrypt(clear, newKey);
    if (!crypto.timingSafeEqual(clear, decrypt(next.encrypted, next.nonce, next.tag, newKey))) throw new Error('Encrypted cook data failed verification.');
    row[cipherColumn] = next.encrypted; row[nonceColumn] = next.nonce; row[tagColumn] = next.tag;
    if (clearColumn) row[clearColumn] = '';
  }
}

async function main() {
  if (!url) throw new Error('DATABASE_URL is not set. Run migrate-cookcircle-to-supabase.cmd to enter it securely.');
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite database not found: ${sourcePath}`);
  if (!fs.existsSync(schemaPath)) throw new Error('PostgreSQL schema file is missing.');
  const oldKey = keyFrom(oldKeyText, 'COOKCIRCLE_OLD_DOCUMENT_KEY');
  const newKey = keyFrom(newKeyText, 'COOKCIRCLE_DOCUMENT_KEY');
  if (oldKey.equals(newKey)) throw new Error('Use the new key created by the migration wizard.');

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new Client({ ...postgresConnectionConfig(url), connectionTimeoutMillis: 15000 });
  try {
    await target.connect();
    const schema = fs.readFileSync(schemaPath, 'utf8');
    for (const statement of orderSchema(schema)) await target.query(statement);
    await target.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL');

    const tables = [
      'societies','users','sessions','service_categories','subscriptions','cook_profiles',
      'cook_service_societies','cook_documents','cook_availability','households','bookings',
      'booking_status_history','payments','credit_ledger','notifications','complaints',
      'society_registrations','cook_verification_records','backup_assignments','refunds',
      'cook_payouts','cook_cashouts','cook_cashout_items','reviews',
      'administrative_activity_logs','capacity_requests','help_requests'
    ];

    for (const table of tables) {
      const count = await target.query(`SELECT COUNT(*)::int AS n FROM ${quoteIdentifier(table)}`);
      if (count.rows[0].n > 0) throw new Error(`Supabase table ${table} is not empty. Migration stopped to avoid overwriting data.`);
    }

    await target.query('BEGIN');
    const report = [];
    for (const table of tables) {
      const sourceExists = source.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!sourceExists) { report.push([table, 0]); continue; }
      const available = source.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(column => column.name);
      const targetColumns = (await target.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', table])).rows.map(row => row.column_name);
      const columns = targetColumns.filter(name => available.includes(name));
      const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
      const columnSql = columns.map(quoteIdentifier).join(',');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
      const insert = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`;
      for (const rawRow of rows) {
        const row = { ...rawRow };
        if (table === 'cook_profiles') encryptedCookProfile(row, oldKey, newKey);
        if (table === 'cook_documents' && row.encrypted_data) {
          const clear = decrypt(row.encrypted_data, row.nonce, row.auth_tag, oldKey);
          const next = encrypt(clear, newKey);
          if (!crypto.timingSafeEqual(clear, decrypt(next.encrypted, next.nonce, next.tag, newKey))) throw new Error('Encrypted cook document failed verification.');
          row.encrypted_data = next.encrypted; row.nonce = next.nonce; row.auth_tag = next.tag;
        }
        await target.query(insert, columns.map(column => {
          const value = row[column];
          if (value === undefined) return null;
          // node:sqlite exposes BLOB fields as Uint8Array; pg expects Buffer.
          return value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value;
        }));
      }
      report.push([table, rows.length]);
    }
    for (const [table, count] of report) {
      const check = await target.query(`SELECT COUNT(*)::int AS n FROM ${quoteIdentifier(table)}`);
      if (check.rows[0].n !== count) throw new Error(`Row-count check failed for ${table}.`);
    }
    await target.query('COMMIT');
    console.log('CookCircle SQLite → Supabase migration completed.');
    for (const [table, count] of report) console.log(`${table}: ${count} rows copied`);
    console.log('Encrypted cook documents and profile data were re-encrypted and verified.');
    console.log('Existing phone sign-in hashes were kept; set COOKCIRCLE_PHONE_HASH_KEY to the old key on Render until accounts are re-verified.');
  } catch (error) {
    try { await target.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    source.close();
    await target.end().catch(() => {});
  }
}

main().catch(error => {
  const message = error.code === '28P01' || /password authentication failed/i.test(error.message)
    ? 'Supabase rejected the database login. First confirm the URI is from Connect > Session pooler and its username is postgres.<project-ref>. Then confirm the database password is current. If it contains reserved characters such as @, #, ?, &, or spaces, percent-encode them in the URI.'
    : error.message;
  console.error(`Migration stopped: ${message}`);
  process.exitCode = 1;
});
