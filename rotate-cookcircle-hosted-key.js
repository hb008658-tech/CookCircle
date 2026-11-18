'use strict';

// Re-encrypt hosted CookCircle documents and profile data in one transaction.
// The PowerShell launcher supplies secrets through process environment only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { postgresConnectionConfig } = require('./cookcircle-postgres-ssl');

function keyFrom(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error(`${label} is unavailable or invalid.`);
  return Buffer.from(value, 'hex');
}
function bytes(value) { return value == null ? null : Buffer.from(value); }
function decrypt(ciphertext, nonce, tag, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes(nonce));
  decipher.setAuthTag(bytes(tag));
  return Buffer.concat([decipher.update(bytes(ciphertext)), decipher.final()]);
}
function encrypt(cleartext, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  return { data: Buffer.concat([cipher.update(cleartext), cipher.final()]), nonce, tag: cipher.getAuthTag() };
}
function checkRoundTrip(cleartext, encrypted, key) {
  const checked = decrypt(encrypted.data, encrypted.nonce, encrypted.tag, key);
  if (checked.length !== cleartext.length || !crypto.timingSafeEqual(checked, cleartext)) {
    throw new Error('The replacement encrypted data failed verification. No database changes were committed.');
  }
}
function backupValue(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
}
function safeBackup(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, backupValue(value)])));
}

async function main() {
  const url = process.env.DATABASE_URL || '';
  const oldKey = keyFrom(process.env.COOKCIRCLE_OLD_DOCUMENT_KEY, 'Saved current hosted key');
  const newKey = keyFrom(process.env.COOKCIRCLE_NEW_DOCUMENT_KEY, 'Fresh replacement key');
  const backupPath = process.env.COOKCIRCLE_KEY_ROTATION_BACKUP || '';
  if (!url) throw new Error('The Supabase connection string was not provided.');
  if (!backupPath) throw new Error('A private backup path was not provided.');
  if (oldKey.equals(newKey)) throw new Error('The new key must differ from the current hosted key.');

  const client = new Client({ ...postgresConnectionConfig(url), connectionTimeoutMillis: 15000 });
  let transaction = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    transaction = true;

    const profiles = (await client.query(`SELECT id,address_encrypted,address_nonce,address_tag,
      phone_encrypted,phone_nonce,phone_tag,photo_encrypted,photo_nonce,photo_tag
      FROM cook_profiles ORDER BY id FOR UPDATE`)).rows;
    const documents = (await client.query(`SELECT id,cook_id,file_name,mime_type,encrypted_data,nonce,auth_tag
      FROM cook_documents ORDER BY id FOR UPDATE`)).rows;

    const backup = {
      format: 'CookCircle encrypted-data key-rotation backup v1',
      createdAt: new Date().toISOString(),
      cook_profiles: safeBackup(profiles),
      cook_documents: safeBackup(documents)
    };
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    const fd = fs.openSync(backupPath, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(backup)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }

    let encryptedCells = 0;
    for (const row of profiles) {
      const updates = {};
      for (const [cipherColumn, nonceColumn, tagColumn] of [
        ['address_encrypted', 'address_nonce', 'address_tag'],
        ['phone_encrypted', 'phone_nonce', 'phone_tag'],
        ['photo_encrypted', 'photo_nonce', 'photo_tag']
      ]) {
        const ciphertext = row[cipherColumn], nonce = row[nonceColumn], tag = row[tagColumn];
        if (ciphertext == null && nonce == null && tag == null) continue;
        if (ciphertext == null || nonce == null || tag == null) throw new Error(`Cook profile ${row.id} has incomplete encrypted fields. No changes were committed.`);
        const clear = decrypt(ciphertext, nonce, tag, oldKey);
        const next = encrypt(clear, newKey);
        checkRoundTrip(clear, next, newKey);
        updates[cipherColumn] = next.data; updates[nonceColumn] = next.nonce; updates[tagColumn] = next.tag;
        encryptedCells++;
      }
      if (Object.keys(updates).length) {
        await client.query(`UPDATE cook_profiles SET address_encrypted=$1,address_nonce=$2,address_tag=$3,
          phone_encrypted=$4,phone_nonce=$5,phone_tag=$6,photo_encrypted=$7,photo_nonce=$8,photo_tag=$9 WHERE id=$10`, [
          updates.address_encrypted ?? row.address_encrypted, updates.address_nonce ?? row.address_nonce, updates.address_tag ?? row.address_tag,
          updates.phone_encrypted ?? row.phone_encrypted, updates.phone_nonce ?? row.phone_nonce, updates.phone_tag ?? row.phone_tag,
          updates.photo_encrypted ?? row.photo_encrypted, updates.photo_nonce ?? row.photo_nonce, updates.photo_tag ?? row.photo_tag, row.id
        ]);
      }
    }

    for (const row of documents) {
      const clear = decrypt(row.encrypted_data, row.nonce, row.auth_tag, oldKey);
      const next = encrypt(clear, newKey);
      checkRoundTrip(clear, next, newKey);
      await client.query('UPDATE cook_documents SET encrypted_data=$1,nonce=$2,auth_tag=$3 WHERE id=$4', [next.data, next.nonce, next.tag, row.id]);
      encryptedCells++;
    }

    const profileCheck = (await client.query(`SELECT id,address_encrypted,address_nonce,address_tag,
      phone_encrypted,phone_nonce,phone_tag,photo_encrypted,photo_nonce,photo_tag FROM cook_profiles ORDER BY id`)).rows;
    const documentCheck = (await client.query('SELECT id,encrypted_data,nonce,auth_tag FROM cook_documents ORDER BY id')).rows;
    for (const row of profileCheck) {
      for (const [cipherColumn, nonceColumn, tagColumn] of [
        ['address_encrypted', 'address_nonce', 'address_tag'], ['phone_encrypted', 'phone_nonce', 'phone_tag'], ['photo_encrypted', 'photo_nonce', 'photo_tag']
      ]) {
        if (row[cipherColumn] != null) decrypt(row[cipherColumn], row[nonceColumn], row[tagColumn], newKey);
      }
    }
    for (const row of documentCheck) decrypt(row.encrypted_data, row.nonce, row.auth_tag, newKey);
    if (profileCheck.length !== profiles.length || documentCheck.length !== documents.length) throw new Error('Record verification count changed. No database changes were committed.');

    await client.query('COMMIT');
    transaction = false;
    console.log('CookCircle hosted encrypted data was re-encrypted and verified.');
    console.log(`Cook profiles checked: ${profileCheck.length}; cook documents checked: ${documentCheck.length}; encrypted fields rotated: ${encryptedCells}.`);
    console.log('A private backup of the previous encrypted records was saved locally.');
  } catch (error) {
    if (transaction) { try { await client.query('ROLLBACK'); } catch {} }
    if (error.code === '28P01' || /password authentication failed/i.test(error.message)) {
      throw new Error('Supabase rejected the database login. Confirm this is the Session Pooler URI and that its database password is current.');
    }
    if (error.code === 'CERT_HAS_EXPIRED' || /certificate|self-signed/i.test(error.message)) {
      throw new Error('Supabase TLS verification failed. Confirm supabase-ca.crt is the current certificate downloaded from Supabase.');
    }
    throw error;
  } finally {
    oldKey.fill(0); newKey.fill(0);
    await client.end().catch(() => {});
  }
}

main().catch(error => { console.error(`Key rotation stopped: ${error.message}`); process.exitCode = 1; });
