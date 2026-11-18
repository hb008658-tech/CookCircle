'use strict';

const fs = require('node:fs');
const path = require('node:path');

function postgresConnectionConfig(connectionString, certificatePath) {
  if (!connectionString) throw new Error('DATABASE_URL is required for the PostgreSQL backend.');
  const caPath = certificatePath || process.env.COOKCIRCLE_DATABASE_CA_FILE || path.join(__dirname, 'supabase-ca.crt');
  if (!fs.existsSync(caPath)) {
    throw new Error('Supabase CA certificate is missing. Download it from Supabase Project Settings → Database → SSL Configuration and save it as supabase-ca.crt beside the CookCircle server.');
  }
  const ca = fs.readFileSync(caPath, 'utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('supabase-ca.crt is not a PEM certificate. Download the CA certificate from Supabase Database SSL Configuration.');
  }

  // node-postgres replaces its ssl object if sslmode/sslrootcert (or related
  // fields) remain in the URI. Remove those URI options so the CA below is used.
  let parsed;
  try { parsed = new URL(connectionString.trim()); }
  catch { throw new Error('DATABASE_URL is not a valid PostgreSQL connection string.'); }
  if (!parsed.hostname.toLowerCase().endsWith('.pooler.supabase.com')) {
    throw new Error('Use the full URI from Supabase Connect > Session pooler. The host should end with .pooler.supabase.com.');
  }
  let username, password;
  try { username = decodeURIComponent(parsed.username); password = decodeURIComponent(parsed.password); }
  catch { throw new Error('The Session Pooler URI has invalid percent-encoding. Copy it again and replace only the password placeholder.'); }
  if (!/^postgres\.[a-z0-9-]+$/i.test(username)) {
    throw new Error('The Session Pooler username must be postgres.<project-ref>, not just postgres. Copy the complete URI from Supabase Connect > Session pooler.');
  }
  if (!password || /YOUR(?:[-_]DATABASE)?[-_]PASSWORD/i.test(password)) {
    throw new Error('Replace the password placeholder with your Supabase database password. This is different from your Supabase account password.');
  }
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) parsed.searchParams.delete(name);

  return {
    connectionString: parsed.toString(),
    ssl: { ca, rejectUnauthorized: true }
  };
}

module.exports = { postgresConnectionConfig };
