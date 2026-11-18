'use strict';

// Compatibility bridge for CookCircle's existing synchronous route handlers.
// PostgreSQL work runs on a worker thread so network I/O does not run inside
// the main HTTP thread. Use one Render instance; this bridge serializes queries.
const { Worker } = require('node:worker_threads');
const { postgresConnectionConfig } = require('./cookcircle-postgres-ssl');

function toPostgres(sql) {
  let text = String(sql || '').trim();
  if (!text || /^PRAGMA\b/i.test(text)) return '';
  const ignoreInsert = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text);
  // PostgreSQL folds unquoted aliases to lowercase. Keep the camelCase row
  // names expected by the existing route handlers (for example passwordHash).
  text = text.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g, (_match, alias) => `AS "${alias}"`);
  text = text.replace(/\b([a-zA-Z_][\w.]*)\s*=\s*\?\s+COLLATE\s+NOCASE\b/ig, 'lower($1) = lower(?)');
  text = text
    .replace(/\bBEGIN\s+IMMEDIATE\b/ig, 'BEGIN')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/ig, 'INSERT INTO')
    .replace(/\bBLOB\b/ig, 'BYTEA')
    .replace(/\s+COLLATE\s+NOCASE\b/ig, '')
    .replace(/\bdate\('now'\)/ig, "to_char(CURRENT_DATE, 'YYYY-MM-DD')");


  let index = 0;
  text = text.replace(/\?/g, () => `$${++index}`);
  if (ignoreInsert && /^INSERT INTO\b/i.test(text) && !/\bON\s+CONFLICT\b/i.test(text)) {
    text = text.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  return text;
}

function restoreBuffers(value) {
  if (Array.isArray(value)) return value.map(restoreBuffers);
  if (value && typeof value === 'object') {
    if (typeof value.__cookcircleBuffer === 'string') return Buffer.from(value.__cookcircleBuffer, 'base64');
    for (const key of Object.keys(value)) value[key] = restoreBuffers(value[key]);
  }
  return value;
}

class PostgresSyncDatabase {
  constructor(connectionString) {
    if (!connectionString) throw new Error('DATABASE_URL is required for the PostgreSQL backend.');
    const postgresConfig = postgresConnectionConfig(connectionString);
    this.shared = new SharedArrayBuffer(32 * 1024 * 1024);
    this.header = new Int32Array(this.shared, 0, 2);
    this.worker = new Worker(require.resolve('./cookcircle-postgres-worker.js'), {
      workerData: postgresConfig
    });
    this.worker.unref();
  }

  query(query, params = []) {
    const text = toPostgres(query);
    if (!text) return { rows: [], rowCount: 0, changes: 0 };
    Atomics.store(this.header, 0, 0);
    Atomics.store(this.header, 1, 0);
    this.worker.postMessage({ shared: this.shared, text, params: params.map(v => v === undefined ? null : v) });
    const wait = Atomics.wait(this.header, 0, 0, 60000);
    if (wait === 'timed-out') throw new Error('Timed out waiting for Supabase Postgres. Check DATABASE_URL and the network connection.');
    const size = Atomics.load(this.header, 1);
    if (size < 0 || size > this.shared.byteLength - 8) throw new Error('Invalid response from the PostgreSQL worker.');
    const payload = Buffer.from(new Uint8Array(this.shared, 8, size)).toString('utf8');
    const response = restoreBuffers(JSON.parse(payload));
    if (Atomics.load(this.header, 0) === 2) throw new Error(response.error || 'PostgreSQL query failed.');
    return response;
  }

  exec(query) {
    const raw = String(query || '').trim();
    if (!raw) return;
    // Startup schema contains simple DDL statements only. The worker sorts
    // CREATE TABLE statements by FK dependency before applying them.
    if (/\bCREATE\s+TABLE\b/i.test(raw)) {
      // A previous query leaves a nonzero completion flag. Reset both slots
      // before posting so Atomics.wait cannot return early on stale state.
      Atomics.store(this.header, 0, 0);
      Atomics.store(this.header, 1, 0);
      this.worker.postMessage({ shared: this.shared, schema: raw });
      const wait = Atomics.wait(this.header, 0, 0, 60000);
      if (wait === 'timed-out') throw new Error('Timed out creating the Supabase schema.');
      const size = Atomics.load(this.header, 1);
      if (size < 0 || size > this.shared.byteLength - 8) throw new Error('Invalid response while creating the Supabase schema.');
      const payload = Buffer.from(new Uint8Array(this.shared, 8, size)).toString('utf8');
      const response = JSON.parse(payload);
      if (Atomics.load(this.header, 0) === 2) throw new Error(response.error || 'Could not create Supabase schema.');
      return;
    }
    for (const statement of raw.split(/;\s*(?=\S|$)/).map(s => s.trim()).filter(Boolean)) this.query(statement);
  }

  prepare(query) {
    return {
      get: (...params) => this.query(query, params).rows[0],
      all: (...params) => this.query(query, params).rows,
      run: (...params) => {
        const result = this.query(query, params);
        return { changes: result.rowCount || 0, lastInsertRowid: undefined };
      }
    };
  }
  close() { this.worker.terminate(); }
}

module.exports = { PostgresSyncDatabase };
