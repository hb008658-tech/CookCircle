'use strict';

const { parentPort, workerData } = require('node:worker_threads');
let clientPromise;

function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { Client } = require('pg');
      const client = new Client({
        connectionString: workerData.connectionString,
        ssl: workerData.ssl,
        connectionTimeoutMillis: 15000,
        query_timeout: 30000,
        statement_timeout: 30000
      });
      await client.connect();
      return client;
    })();
  }
  return clientPromise;
}

function normalize(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __cookcircleBuffer: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = normalize(item);
    return result;
  }
  return value;
}

function orderSchema(raw) {
  const statements = raw.split(/;\s*(?=\S|$)/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/^PRAGMA\b/i.test(s)).map(s => s.replace(/\bBLOB\b/ig, 'BYTEA').replace(/\s+COLLATE\s+NOCASE\b/ig, ''));
  const tables = statements.filter(s => /^CREATE\s+TABLE/i.test(s));
  const others = statements.filter(s => !/^CREATE\s+TABLE/i.test(s));
  const nameOf = s => (s.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([\w"]+)/i) || s.match(/^CREATE\s+TABLE\s+([\w"]+)/i) || [])[1]?.replaceAll('"', '').toLowerCase();
  const pending = tables.slice(), ordered = [], created = new Set();
  while (pending.length) {
    let progressed = false;
    for (let i = 0; i < pending.length;) {
      const statement = pending[i], name = nameOf(statement);
      const dependencies = [...statement.matchAll(/\bREFERENCES\s+([\w"]+)\s*\(/ig)].map(m => m[1].replaceAll('"', '').toLowerCase()).filter(dep => dep !== name);
      if (dependencies.every(dep => created.has(dep))) {
        ordered.push(statement); if (name) created.add(name); pending.splice(i, 1); progressed = true;
      } else i++;
    }
    if (!progressed) throw new Error(`Could not order Postgres schema tables: ${pending.map(nameOf).join(', ')}`);
  }
  return [...ordered, ...others];
}

function send(shared, error, result = {}) {
  const header = new Int32Array(shared, 0, 2);
  const bytes = Buffer.from(JSON.stringify(error ? { error: String(error.message || error) } : normalize(result)));
  if (bytes.length > shared.byteLength - 8) {
    const fallback = Buffer.from(JSON.stringify({ error: 'PostgreSQL response exceeded the migration bridge buffer.' }));
    new Uint8Array(shared, 8, fallback.length).set(fallback);
    Atomics.store(header, 1, fallback.length); Atomics.store(header, 0, 2); Atomics.notify(header, 0); return;
  }
  new Uint8Array(shared, 8, bytes.length).set(bytes);
  Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, error ? 2 : 1); Atomics.notify(header, 0);
}

parentPort.on('message', async message => {
  const { shared } = message;
  try {
    const client = await getClient();
    if (message.schema) {
      for (const statement of orderSchema(message.schema)) await client.query(statement);
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL');
      send(shared, null, { rowCount: 0 });
      return;
    }
    let text = String(message.text || '');
    // Case-insensitive matching is used for account email login.
    text = text.replace(/\b([a-zA-Z_][\w.]*)\s*=\s*\$(\d+)\b\s+COLLATE\s+NOCASE/ig, 'lower($1) = lower($$2)');
    const params = (message.params || []).map(value => value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value);
    const result = await client.query(text, params);
    send(shared, null, { rows: result.rows || [], rowCount: result.rowCount || 0, command: result.command || '' });
  } catch (error) {
    send(shared, error);
  }
});
