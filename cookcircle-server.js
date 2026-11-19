// CookCircle MVP backend — SQLite locally, optional PostgreSQL using DATABASE_URL.
// Run with: node cookcircle-server.js
// Persistent local SQLite database: cookcircle.sqlite
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);
const { PostgresSyncDatabase } = USE_POSTGRES ? require('./cookcircle-postgres-sync') : {};

const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = __dirname;
const DB_FILE = process.env.COOKCIRCLE_DB_FILE
  ? path.resolve(process.env.COOKCIRCLE_DB_FILE)
  : path.join(__dirname, 'cookcircle.sqlite');
if (!USE_POSTGRES) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const sessions = new Map();
const challenges = new Map();
const signupVerificationChallenges = new Map();
const signupVerificationProofs = new Map();
const verificationSendHistory = new Map();
const slots = ['07:00–09:00', '09:30–11:30', '12:00–14:00', '16:00–18:00', '18:30–20:30'];
const seed = {
  societies: [
    { id: 'soc-green-park', name: 'Green Park Residences', city: 'Bengaluru' },
    { id: 'soc-maple-heights', name: 'Maple Heights', city: 'Bengaluru' },
    { id: 'soc-riverstone', name: 'Riverstone Society', city: 'Pune' },
    { id: 'soc-sunrise-court', name: 'Sunrise Court', city: 'Hyderabad' }
  ], users: [], bookings: []
};

const sql = USE_POSTGRES ? new PostgresSyncDatabase(process.env.DATABASE_URL) : new DatabaseSync(DB_FILE);
sql.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS societies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS society_registrations (
    id TEXT PRIMARY KEY, society_name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,
    apartment_count INTEGER NOT NULL, contact_name TEXT NOT NULL, contact_email TEXT NOT NULL,
    contact_phone TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT REFERENCES users(id), society_id TEXT REFERENCES societies(id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE, phone_hash TEXT UNIQUE,
    society_id TEXT REFERENCES societies(id), apartment TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer', salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_profiles (
    id TEXT PRIMARY KEY, user_id TEXT UNIQUE REFERENCES users(id), name TEXT NOT NULL, society_id TEXT REFERENCES societies(id),
    verification_status TEXT NOT NULL DEFAULT 'pending', specialties TEXT NOT NULL DEFAULT '[]',
    address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', years_experience INTEGER NOT NULL DEFAULT 0,
    address_encrypted BLOB, address_nonce BLOB, address_tag BLOB,
    phone_encrypted BLOB, phone_nonce BLOB, phone_tag BLOB,
    bio TEXT NOT NULL DEFAULT '', photo_file_name TEXT, photo_mime_type TEXT,
    photo_encrypted BLOB, photo_nonce BLOB, photo_tag BLOB, photo_avatar_id TEXT NOT NULL DEFAULT 'sage',
    is_demo INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cook_service_societies (
    cook_id TEXT NOT NULL REFERENCES cook_profiles(id) ON DELETE CASCADE,
    society_id TEXT NOT NULL REFERENCES societies(id),
    status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY(cook_id,society_id)
  );
  CREATE TABLE IF NOT EXISTS cook_documents (
    id TEXT PRIMARY KEY, cook_id TEXT NOT NULL REFERENCES cook_profiles(id), file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL, encrypted_data BLOB NOT NULL, nonce BLOB NOT NULL, auth_tag BLOB NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_availability (
    id TEXT PRIMARY KEY, cook_id TEXT NOT NULL REFERENCES cook_profiles(id), date TEXT NOT NULL,
    slot TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1, UNIQUE(cook_id,date,slot)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), society_id TEXT NOT NULL REFERENCES societies(id),
    date TEXT NOT NULL, slot TEXT NOT NULL, meal TEXT NOT NULL, people TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '', cook TEXT NOT NULL, price_paise INTEGER NOT NULL,
    payment_status TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, subscription_id TEXT REFERENCES subscriptions(id), service_otp_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS booking_cook_offers (
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    cook_id TEXT NOT NULL REFERENCES cook_profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, responded_at TEXT,
    PRIMARY KEY(booking_id,cook_id)
  );
  CREATE INDEX IF NOT EXISTS bookings_user_date ON bookings(user_id,date);
  CREATE INDEX IF NOT EXISTS bookings_date_slot ON bookings(date,slot,status);
  CREATE TABLE IF NOT EXISTS booking_status_history (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, booking_id TEXT REFERENCES bookings(id), user_id TEXT NOT NULL REFERENCES users(id),
    amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'simulated', provider_reference TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan_name TEXT NOT NULL,
    price_paise INTEGER NOT NULL, included_credits INTEGER NOT NULL, remaining_credits INTEGER NOT NULL,
    status TEXT NOT NULL, starts_at TEXT, expires_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), booking_id TEXT REFERENCES bookings(id),
    subscription_id TEXT REFERENCES subscriptions(id), change_amount INTEGER NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), booking_id TEXT REFERENCES bookings(id),
    kind TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), booking_id TEXT REFERENCES bookings(id),
    category TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS help_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), society_id TEXT NOT NULL REFERENCES societies(id),
    apartment TEXT NOT NULL, household_name TEXT NOT NULL DEFAULT '', family_members INTEGER NOT NULL DEFAULT 1, cuisines TEXT NOT NULL DEFAULT '[]',
    dietary_preferences TEXT NOT NULL DEFAULT '', cooking_styles TEXT NOT NULL DEFAULT '[]',
    instructions TEXT NOT NULL DEFAULT '', allergies TEXT NOT NULL DEFAULT '',
    phone_encrypted BLOB, phone_nonce BLOB, phone_tag BLOB, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_verification_records (
    id TEXT PRIMARY KEY, cook_id TEXT NOT NULL REFERENCES cook_profiles(id), record_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', notes TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backup_assignments (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), primary_cook_id TEXT REFERENCES cook_profiles(id),
    backup_cook_id TEXT REFERENCES cook_profiles(id), status TEXT NOT NULL DEFAULT 'needed', accepted_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_payouts (
    id TEXT PRIMARY KEY, cook_id TEXT NOT NULL REFERENCES cook_profiles(id), booking_id TEXT REFERENCES bookings(id),
    amount_paise INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_cashouts (
    id TEXT PRIMARY KEY, cook_id TEXT NOT NULL REFERENCES cook_profiles(id), amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_cashout_items (
    cashout_id TEXT NOT NULL REFERENCES cook_cashouts(id), payout_id TEXT NOT NULL REFERENCES cook_payouts(id),
    amount_paise INTEGER NOT NULL, PRIMARY KEY(cashout_id,payout_id)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id), user_id TEXT NOT NULL REFERENCES users(id),
    cook_id TEXT REFERENCES cook_profiles(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, duration_minutes INTEGER NOT NULL DEFAULT 120,
    base_price_paise INTEGER NOT NULL DEFAULT 79900, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS administrative_activity_logs (
    id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS capacity_requests (
    id TEXT PRIMARY KEY, society_id TEXT NOT NULL REFERENCES societies(id), requested_by TEXT NOT NULL REFERENCES users(id),
    details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
  );
`);

// Allow mobile-only accounts and cook applicants without residential societies.
// Older databases had NOT NULL email/society columns and no indexed phone identifier.
if (!USE_POSTGRES) {
const userColumns = sql.prepare('PRAGMA table_info(users)').all();
const emailColumn=userColumns.find(column=>column.name==='email');
const societyColumn=userColumns.find(column=>column.name==='society_id');
const phoneHashColumn=userColumns.find(column=>column.name==='phone_hash');
if((emailColumn&&emailColumn.notnull)||(societyColumn&&societyColumn.notnull)||!phoneHashColumn){
  const oldPhoneHash=phoneHashColumn?'phone_hash':'NULL';
  sql.exec('PRAGMA foreign_keys = OFF');
  let migrationTransaction=false;
  try{
    sql.exec('BEGIN IMMEDIATE');migrationTransaction=true;
    const usersMigrationSql=[
      "CREATE TABLE users_rebuild (",
      "id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE, phone_hash TEXT UNIQUE,",
      "society_id TEXT REFERENCES societies(id), apartment TEXT NOT NULL,",
      "role TEXT NOT NULL DEFAULT 'customer', salt TEXT NOT NULL, password_hash TEXT NOT NULL,",
      "created_at TEXT NOT NULL",
      ");",
      "INSERT INTO users_rebuild(id,name,email,phone_hash,society_id,apartment,role,salt,password_hash,created_at) SELECT id,name,email,"+oldPhoneHash+",society_id,apartment,role,salt,password_hash,created_at FROM users;",
      "DROP TABLE users;",
      "ALTER TABLE users_rebuild RENAME TO users;"
    ].join(String.fromCharCode(10));
    sql.exec(usersMigrationSql);sql.exec('COMMIT');migrationTransaction=false;
  }catch(error){if(migrationTransaction)sql.exec('ROLLBACK');throw error}
  finally{sql.exec('PRAGMA foreign_keys = ON')}
  if(sql.prepare('PRAGMA foreign_key_check').all().length)throw new Error('CookCircle database migration left invalid references.');
}

}

function ensureColumn(table, column, declaration) {
  if (USE_POSTGRES) {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${declaration}`);
    return;
  }
  const present = sql.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (!present) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
ensureColumn('cook_profiles', 'user_id', 'TEXT REFERENCES users(id)');
ensureColumn('cook_profiles', 'address', "TEXT NOT NULL DEFAULT ''");
ensureColumn('cook_profiles', 'phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('cook_profiles', 'years_experience', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('cook_profiles', 'address_encrypted', 'BLOB');
ensureColumn('cook_profiles', 'address_nonce', 'BLOB');
ensureColumn('cook_profiles', 'address_tag', 'BLOB');
ensureColumn('cook_profiles', 'phone_encrypted', 'BLOB');
ensureColumn('cook_profiles', 'phone_nonce', 'BLOB');
ensureColumn('cook_profiles', 'phone_tag', 'BLOB');
ensureColumn('cook_profiles', 'bio', "TEXT NOT NULL DEFAULT ''");
ensureColumn('cook_profiles', 'photo_file_name', 'TEXT');
ensureColumn('cook_profiles', 'photo_mime_type', 'TEXT');
ensureColumn('cook_profiles', 'photo_encrypted', 'BLOB');
ensureColumn('cook_profiles', 'photo_nonce', 'BLOB');
ensureColumn('cook_profiles', 'photo_tag', 'BLOB');
ensureColumn('cook_profiles', 'photo_avatar_id', "TEXT NOT NULL DEFAULT 'sage'");
ensureColumn('cook_profiles', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('sessions', 'revoked_reason', 'TEXT');
ensureColumn('societies', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('households', 'household_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'phone_encrypted', 'BLOB');
ensureColumn('households', 'phone_nonce', 'BLOB');
ensureColumn('households', 'phone_tag', 'BLOB');
ensureColumn('bookings', 'cook_profile_id', 'TEXT REFERENCES cook_profiles(id)');
ensureColumn('bookings', 'subscription_id', 'TEXT REFERENCES subscriptions(id)');
ensureColumn('bookings', 'service_otp_hash', 'TEXT');

const societyInsert = sql.prepare('INSERT OR IGNORE INTO societies(id,name,city) VALUES(?,?,?)');
for (const s of seed.societies) societyInsert.run(s.id, s.name, s.city);
sql.prepare(`INSERT OR IGNORE INTO cook_service_societies(cook_id,society_id,status)
  SELECT c.id,c.society_id,CASE WHEN lower(c.verification_status)='approved' THEN 'approved' ELSE 'pending' END
  FROM cook_profiles c WHERE c.society_id IS NOT NULL`).run();
const cookInsert = sql.prepare('INSERT OR IGNORE INTO cook_profiles(id,name,verification_status,specialties,is_demo) VALUES(?,?,?,?,1)');
[['demo-meera','Meera','approved','["North Indian"]'],['demo-rafiq','Rafiq','approved','["Home-style"]'],['demo-anjali','Anjali','approved','["South Indian"]']].forEach(c => cookInsert.run(...c));
const serviceInsert = sql.prepare('INSERT OR IGNORE INTO service_categories(id,name,duration_minutes,base_price_paise) VALUES(?,?,?,?)');
[['breakfast','Breakfast',120,79900],['lunch','Lunch',120,79900],['dinner','Dinner',120,79900],['special','Special occasion',180,129900]].forEach(c => serviceInsert.run(...c));
const addMissingHousehold = sql.prepare('INSERT OR IGNORE INTO households(id,user_id,society_id,apartment,updated_at) VALUES(?,?,?,?,?)');
for (const u of sql.prepare("SELECT id,society_id,apartment,created_at FROM users WHERE role='customer' AND society_id IS NOT NULL").all()) {
  addMissingHousehold.run(crypto.randomUUID(), u.id, u.society_id, u.apartment, u.created_at);
}

// One-time import from the earlier JSON prototype, if it exists.
const legacyFile = path.join(__dirname, 'cookcircle-data.json');
if (fs.existsSync(legacyFile)) {
  try {
    const old = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    const addUser = sql.prepare('INSERT OR IGNORE INTO users(id,name,email,society_id,apartment,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const u of old.users || []) addUser.run(u.id,u.name,u.email,u.societyId,u.apartment,'customer',u.salt,u.passwordHash,u.createdAt);
    const addBooking = sql.prepare('INSERT OR IGNORE INTO bookings(id,user_id,society_id,date,slot,meal,people,instructions,cook,price_paise,payment_status,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const owners = new Map((old.users || []).map(u => [u.id, u.societyId]));
    const addHistory = sql.prepare('INSERT OR IGNORE INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)');
    for (const b of old.bookings || []) {
      const societyId = owners.get(b.userId); if (!societyId) continue;
      addBooking.run(b.id,b.userId,societyId,b.date,b.slot,b.meal,b.people || '',b.instructions || '',b.cook,b.pricePaise,b.paymentStatus,b.status,b.createdAt);
      addHistory.run(crypto.randomUUID(),b.id,b.status,'Imported from the previous local store',b.createdAt);
    }
  } catch (e) { console.error('Could not import the previous JSON store:', e.message); }
}

const db = {};
Object.defineProperties(db, {
  societies: { get: () => sql.prepare('SELECT id,name,city FROM societies WHERE is_active=1 ORDER BY name').all() },
  users: { get: () => sql.prepare('SELECT id,name,email,phone_hash AS phoneHash,society_id AS societyId,apartment,role,salt,password_hash AS passwordHash,created_at AS createdAt FROM users').all() },
  bookings: { get: () => sql.prepare(`SELECT id,user_id AS userId,society_id AS societyId,date,slot,meal,people,instructions,cook,price_paise AS pricePaise,payment_status AS paymentStatus,status,created_at AS createdAt FROM bookings`).all() }
});
function insertUser(u) {
  sql.prepare('INSERT INTO users(id,name,email,phone_hash,society_id,apartment,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(u.id,u.name,u.email,u.phoneHash||null,u.societyId,u.apartment,u.role || 'customer',u.salt,u.passwordHash,u.createdAt);
  if ((u.role || 'customer') === 'customer') {
    const householdPhone=u.householdPhone||{};
    sql.prepare('INSERT INTO households(id,user_id,society_id,apartment,household_name,phone_encrypted,phone_nonce,phone_tag,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),u.id,u.societyId,u.apartment,String(u.householdName||'').trim().slice(0,80),householdPhone.encrypted||null,householdPhone.nonce||null,householdPhone.authTag||null,u.createdAt);
    queueAdminDirectorySync();
  }
  if (u.role === 'cook') {
    const address=encryptSensitiveText(u.address),phone=encryptSensitiveText(u.phone);
    sql.prepare('INSERT INTO cook_profiles(id,user_id,name,society_id,verification_status,years_experience,address_encrypted,address_nonce,address_tag,phone_encrypted,phone_nonce,phone_tag,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(crypto.randomUUID(),u.id,u.name,u.societyId,'application received',Number(u.yearsExperience ?? 0),address.encrypted,address.nonce,address.authTag,phone.encrypted,phone.nonce,phone.authTag);
    queueAdminDirectorySync();
  }
}
function insertBooking(b) {
  sql.prepare('INSERT INTO bookings(id,user_id,society_id,date,slot,meal,people,instructions,cook,price_paise,payment_status,status,created_at,subscription_id,service_otp_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.id,b.userId,b.societyId,b.date,b.slot,b.meal,b.people,b.instructions,b.cook,b.pricePaise,b.paymentStatus,b.status,b.createdAt,b.subscriptionId||null,b.serviceOtpHash||null);
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)')
    .run(crypto.randomUUID(),b.id,b.status,'Booking request created',b.createdAt);
  sql.prepare('INSERT INTO payments(id,booking_id,user_id,amount_paise,status,provider,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(),b.id,b.userId,b.pricePaise,b.paymentStatus,'simulated',b.createdAt);
  sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(),b.userId,b.id,'booking_requested',`Booking ${b.id} requested. Your cook check-in code is ${b.checkinCode}.`,b.createdAt);
}
function storeCookDocuments(cookId,docs,encryptedDocs) {const save=sql.prepare('INSERT INTO cook_documents(id,cook_id,file_name,mime_type,encrypted_data,nonce,auth_tag,uploaded_at) VALUES(?,?,?,?,?,?,?,?)');const record=sql.prepare('INSERT INTO cook_verification_records(id,cook_id,record_type,status,notes,updated_at) VALUES(?,?,?,?,?,?)');const now=new Date().toISOString();encryptedDocs.forEach((d,i)=>{const id=crypto.randomUUID();save.run(id,cookId,d.fileName,d.mimeType,d.encrypted,d.nonce,d.authTag,now);record.run(crypto.randomUUID(),cookId,'Identity document','pending',d.fileName,now)})}
const adminSheetUrl='https://docs.google.com/spreadsheets/d/1RObGhw51s9tLHVMq4Qlvay-8QCGH_FG_8H1t4RoVdzs/edit';
let directorySyncState={at:null,error:''};
let directorySyncTimer=null;
function buildAdminDirectorySnapshot(){
  const syncedAt=new Date().toISOString();
  const societies=sql.prepare('SELECT id,name,city,is_active AS isActive,created_at AS createdAt FROM societies ORDER BY name').all();
  const cooks=sql.prepare("SELECT id,name,verification_status AS verificationStatus,is_active AS isActive,years_experience AS yearsExperience,phone_encrypted AS phoneEncrypted,phone_nonce AS phoneNonce,phone_tag AS phoneTag FROM cook_profiles ORDER BY name").all();
  const households=sql.prepare(`SELECT h.id,u.name AS memberName,h.household_name AS householdName,s.name AS societyName,u.email,h.phone_encrypted AS phoneEncrypted,h.phone_nonce AS phoneNonce,h.phone_tag AS phoneTag FROM households h JOIN users u ON u.id=h.user_id JOIN societies s ON s.id=h.society_id WHERE u.role='customer' ORDER BY u.name`).all();
  const serviceAreas=sql.prepare(`SELECT a.cook_id AS cookId,s.name,s.city,a.status FROM cook_service_societies a JOIN societies s ON s.id=a.society_id ORDER BY s.name`).all();
  const areasByCook=new Map();
  for(const area of serviceAreas){const list=areasByCook.get(area.cookId)||[];list.push(`${area.name} · ${area.city} (${area.status})`);areasByCook.set(area.cookId,list)}
  return {
    cooks:cooks.map(c=>[c.id,c.name,c.verificationStatus,c.isActive?'Yes':'No',(areasByCook.get(c.id)||[]).join('; '),c.yearsExperience,decryptSensitiveText(c.phoneEncrypted,c.phoneNonce,c.phoneTag),syncedAt]),
    societies:societies.map(s=>[s.id,s.name,s.city,s.isActive?'Yes':'No',s.createdAt,syncedAt]),
    households:households.map(h=>[h.id,h.memberName,h.householdName,h.societyName,h.email||'',decryptSensitiveText(h.phoneEncrypted,h.phoneNonce,h.phoneTag), 'Yes',syncedAt])
  };
}
function queueAdminDirectorySync(){
  if(directorySyncTimer)clearTimeout(directorySyncTimer);
  directorySyncTimer=setTimeout(async()=>{
    directorySyncTimer=null;
    const endpoint=String(process.env.COOKCIRCLE_SHEETS_SYNC_URL||'').trim();
    const token=String(process.env.COOKCIRCLE_SHEETS_SYNC_TOKEN||'').trim();
    if(!endpoint||!token){directorySyncState={at:null,error:'Google Sheets sync is not configured in Render.'};return}
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,...buildAdminDirectorySnapshot()}),signal:AbortSignal.timeout(15000)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.ok!==true)throw new Error('Google Sheets returned an unsuccessful sync response.');
      directorySyncState={at:new Date().toISOString(),error:''};
    }catch(error){directorySyncState={at:null,error:'The live Sheet update failed. Check the Apps Script deployment and Render settings.'};console.error('CookCircle Google Sheets directory sync failed:',error.message)}
  },250);
}
function setBookingStatus(id, status, note, cookId = null) {
  const now = new Date().toISOString();
  if (cookId) {
    const cook = sql.prepare('SELECT name FROM cook_profiles WHERE id=?').get(cookId);
    if (!cook) return false;
    sql.prepare('UPDATE bookings SET status=?,cook=?,cook_profile_id=? WHERE id=?').run(status,`Cook · ${cook.name}`,cookId,id);
  } else sql.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);
  if(cookId)sql.prepare("UPDATE booking_cook_offers SET status=CASE WHEN cook_id=? THEN 'accepted' ELSE 'expired' END,responded_at=? WHERE booking_id=? AND status='pending'").run(cookId,now,id);
  else if(status!=='Confirmed')sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND status='pending'").run(now,id);
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),id,status,note,now);
  const row = sql.prepare('SELECT user_id,cook_profile_id,price_paise FROM bookings WHERE id=?').get(id);
  if (row) sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),row.user_id,id,'booking_status',`Booking status updated: ${status}`,now);
  if(row&&status==='Completed'&&row.cook_profile_id&&!sql.prepare('SELECT id FROM cook_payouts WHERE booking_id=?').get(id))sql.prepare('INSERT INTO cook_payouts(id,cook_id,booking_id,amount_paise,status,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),row.cook_profile_id,id,Math.round(row.price_paise*.7),'pending',now);
  return Boolean(row);
}
function findAvailableCooks(societyId, date, slot) {
  return sql.prepare(`SELECT c.id,c.name,c.user_id AS userId
    FROM cook_profiles c
    JOIN cook_service_societies area ON area.cook_id=c.id AND area.society_id=? AND area.status='approved'
    JOIN societies s ON s.id=area.society_id AND s.is_active=1
    WHERE c.verification_status='approved' AND c.is_active=1 AND c.user_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.cook_profile_id=c.id AND b.date=? AND b.slot=? AND b.status NOT IN ('Cancelled','Refunded'))
      AND NOT EXISTS(SELECT 1 FROM cook_availability a WHERE a.cook_id=c.id AND a.date=? AND a.slot=? AND a.available=0)
    ORDER BY (SELECT COUNT(*) FROM bookings load WHERE load.cook_profile_id=c.id AND load.date=? AND load.status NOT IN ('Cancelled','Refunded')) ASC,
      c.created_at ASC,c.name COLLATE NOCASE ASC`).all(societyId,date,slot,date,slot,date);
}
function findAvailableCook(societyId,date,slot) { return findAvailableCooks(societyId,date,slot)[0] || null; }
function autoAssignBooking(bookingId) {
  const booking=sql.prepare('SELECT id,society_id AS societyId,date,slot,status,payment_status AS paymentStatus,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(bookingId);
  if(!booking||!['simulated-paid','credit-applied'].includes(booking.paymentStatus)||booking.cookProfileId||['Cancelled','Refunded'].includes(booking.status))return null;
  const cooks=findAvailableCooks(booking.societyId,booking.date,booking.slot),now=new Date().toISOString();
  const offer=sql.prepare("INSERT OR IGNORE INTO booking_cook_offers(booking_id,cook_id,status,created_at) VALUES(?,?,'pending',?)");
  const notify=sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)');
  for(const cook of cooks){const inserted=offer.run(booking.id,cook.id,now);if(inserted.changes&&cook.userId)notify.run(crypto.randomUUID(),cook.userId,booking.id,'booking_request',`New ${booking.slot} ${booking.date} booking request for a society you are approved to serve. Open your schedule to accept or decline.`,now)}
  return cooks.length;
}
function closeBookingAfterAllCookDeclines(bookingId, outcome='declined') {
  const row=sql.prepare('SELECT user_id AS userId,subscription_id AS subscriptionId,payment_status AS paymentStatus FROM bookings WHERE id=? AND cook_profile_id IS NULL AND status=\'Confirmed\'').get(bookingId);
  if(!row)return false;
  const pending=sql.prepare("SELECT COUNT(*) AS count FROM booking_cook_offers WHERE booking_id=? AND status='pending'").get(bookingId).count;
  const accepted=sql.prepare("SELECT 1 FROM booking_cook_offers WHERE booking_id=? AND status='accepted'").get(bookingId);
  if(pending||accepted)return false;
  const now=new Date().toISOString();
  const closed=sql.prepare("UPDATE bookings SET status='No cook available',cook='No cook booked' WHERE id=? AND cook_profile_id IS NULL AND status='Confirmed'").run(bookingId);
  if(!closed.changes)return false;
  const declined=outcome==='declined';
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),bookingId,'No cook available',declined?'All eligible cooks declined the request':'No approved cook was available when the request was sent',now);
  let apology=declined?'We’re sorry—all cooks approved for your society declined this request. No cook was booked.':'We’re sorry, no approved cook was available for your society and session. No cook was booked.';
  if(row.paymentStatus==='credit-applied'&&row.subscriptionId){
    sql.prepare('UPDATE subscriptions SET remaining_credits=remaining_credits+1 WHERE id=?').run(row.subscriptionId);
    sql.prepare('INSERT INTO credit_ledger(id,user_id,booking_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),row.userId,bookingId,row.subscriptionId,1,declined?'Credit returned because all eligible cooks declined':'Credit returned because no approved cook was available',now);
    apology+=' Your session credit has been returned.';
  }else{
    const payment=sql.prepare("SELECT id,amount_paise AS amountPaise FROM payments WHERE booking_id=? AND status='simulated-paid'").get(bookingId);
    if(payment){
      sql.prepare("UPDATE payments SET status='refund-pending' WHERE id=?").run(payment.id);
      sql.prepare('INSERT INTO refunds(id,payment_id,amount_paise,status,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),payment.id,payment.amountPaise,'pending',declined?'No eligible cook accepted the booking':'No approved cook was available for the booking',now);
      apology+=' Your demo payment has been marked for refund.';
    }
  }
  sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),row.userId,bookingId,'booking_status',apology,now);
  return true;
}
const legacyAutoAssignments=sql.prepare(`SELECT b.id FROM bookings b
  WHERE b.status='Cook assigned' AND b.cook_profile_id IS NOT NULL
    AND b.payment_status IN ('simulated-paid','credit-applied') AND b.date>=?
    AND EXISTS(SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id AND h.status='Cook assigned' AND h.note='Automatically assigned to an approved cook serving this society')
    AND NOT EXISTS(SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id AND h.note='Accepted by cook')
`).all(new Date().toISOString().slice(0,10));
for(const booking of legacyAutoAssignments){
  const reopened=sql.prepare("UPDATE bookings SET status='Confirmed',cook='Awaiting cook assignment',cook_profile_id=NULL WHERE id=? AND status='Cook assigned'").run(booking.id);
  if(reopened.changes){const now=new Date().toISOString();sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),booking.id,'Confirmed','Reopened as a cook request; previous assignment was automatic',now);autoAssignBooking(booking.id)}
}
for(const booking of sql.prepare("SELECT id FROM bookings WHERE cook_profile_id IS NULL AND payment_status IN ('simulated-paid','credit-applied') AND status='Confirmed' ORDER BY created_at").all())autoAssignBooking(booking.id);

// Create or reset a platform administrator only when credentials are supplied in the environment.
if (process.env.COOKCIRCLE_ADMIN_EMAIL && process.env.COOKCIRCLE_ADMIN_PASSWORD) {
  const email = process.env.COOKCIRCLE_ADMIN_EMAIL.trim().toLowerCase();
  const existing = sql.prepare('SELECT id,role FROM users WHERE email=? COLLATE NOCASE').get(email);
  const pass = hashPassword(process.env.COOKCIRCLE_ADMIN_PASSWORD);
  if (!existing) {
    insertUser({ id: crypto.randomUUID(), name: 'CookCircle Admin', email, societyId: seed.societies[0].id,
      apartment: 'Platform', role: 'platform_admin', salt: pass.salt, passwordHash: pass.hash, createdAt: new Date().toISOString() });
    console.log('Platform administrator account created from startup credentials.');
  } else {
    // The operator explicitly supplied these credentials at server startup,
    // so configure that existing account as the platform administrator.
    sql.prepare("UPDATE users SET role='platform_admin',salt=?,password_hash=?,society_id=?,apartment='Platform' WHERE id=?")
      .run(pass.salt,pass.hash,seed.societies[0].id,existing.id);
    console.log('Existing account configured as the platform administrator from startup credentials.');
  }
}

// Local walkthrough accounts. Disable with COOKCIRCLE_DEMO_ACCOUNTS=off before
// exposing this server publicly. These accounts are only created when missing.
function seedDemoAccounts() {
  if (String(process.env.COOKCIRCLE_DEMO_ACCOUNTS || '').toLowerCase() === 'off') return;
  const now = new Date().toISOString();
  const societyId = 'soc-green-park';
  const accounts = [
    { id: 'cc-demo-customer', name: 'Demo Customer', email: 'demo.customer@cookcircle.local', apartment: 'B-1204', role: 'customer', password: 'CookCircleUser!2026' },
    { id: 'cc-demo-cook', name: 'Demo Cook', email: 'demo.cook@cookcircle.local', apartment: 'Cook', role: 'cook', password: 'CookCircleCook!2026' }
  ];
  const byEmail = sql.prepare('SELECT id,role FROM users WHERE email=? COLLATE NOCASE');
  const addUser = sql.prepare('INSERT INTO users(id,name,email,society_id,apartment,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const account of accounts) {
    let existing = byEmail.get(account.email);
    if (!existing) {
      const pass = hashPassword(account.password);
      addUser.run(account.id, account.name, account.email, societyId, account.apartment, account.role, pass.salt, pass.hash, now);
      existing = { id: account.id, role: account.role };
    }
    if (account.role === 'customer' && existing.role === 'customer') {
      sql.prepare('INSERT OR IGNORE INTO households(id,user_id,society_id,apartment,updated_at) VALUES(?,?,?,?,?)')
        .run('hh-demo-customer', existing.id, societyId, account.apartment, now);
    }
    if (account.role === 'cook' && existing.role === 'cook' && !sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(existing.id)) {
      sql.prepare(`INSERT INTO cook_profiles(id,user_id,name,society_id,verification_status,specialties,bio,is_demo)
        VALUES('demo-login-cook',?,?,?,'approved','["Home-style","Indian"]','Demo account for exploring the cook workspace.',1)`)
        .run(existing.id, account.name, societyId);
    }
  }

  // Keep the walkthrough cook bookable in its demo community. Real cooks only
  // receive service areas that they selected and an administrator approved.
  const demoCookUser = byEmail.get('demo.cook@cookcircle.local');
  const demoCookProfile = demoCookUser && sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(demoCookUser.id);
  if (demoCookProfile) {
    sql.prepare("INSERT OR IGNORE INTO cook_service_societies(cook_id,society_id,status) VALUES(?,?,'approved')")
      .run(demoCookProfile.id, societyId);
  }

  const customer = byEmail.get('demo.customer@cookcircle.local');
  const cook = sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(byEmail.get('demo.cook@cookcircle.local')?.id || '');
  if (!customer || customer.role !== 'customer' || !cook || sql.prepare('SELECT id FROM bookings WHERE id=?').get('CC-DEMO-1001')) return;
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 3);
  const serviceDate = date.toISOString().slice(0, 10);
  const otp = '246810';
  const booking = {
    id: 'CC-DEMO-1001', userId: customer.id, societyId, date: serviceDate, slot: '18:30–20:30', meal: 'Dinner',
    people: '2', instructions: 'Demo booking · please prepare a mild home-style meal.', cook: 'Cook · Demo Cook',
    pricePaise: 79900, paymentStatus: 'simulated-paid', status: 'Cook assigned', createdAt: now,
    serviceOtpHash: crypto.createHash('sha256').update(otp).digest('hex'), checkinCode: otp
  };
  insertBooking(booking);
  sql.prepare('UPDATE bookings SET cook_profile_id=? WHERE id=?').run(cook.id, booking.id);
  sql.prepare('UPDATE booking_status_history SET note=? WHERE booking_id=?')
    .run('Sample demo booking. No payment was collected.', booking.id);
  sql.prepare('UPDATE notifications SET message=? WHERE booking_id=? AND user_id=?')
    .run(`Demo booking assigned to Demo Cook. Sample cook check-in code: ${otp}. No payment was collected.`, booking.id, customer.id);
}
seedDemoAccounts();

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function getBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '', tooLarge = false; req.on('data', c => { if (tooLarge) return; raw += c; if (raw.length > 15_000_000) { tooLarge = true; reject(Error('Request is too large. Cook documents are limited to 10 MB total.')); } });
    req.on('end', () => { if (tooLarge) return; try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}
function documentKey() {
  const value=process.env.COOKCIRCLE_DOCUMENT_KEY||'';
  return /^[a-f0-9]{64}$/i.test(value)?Buffer.from(value,'hex'):null;
}
function encryptSensitiveText(value) {
  const key=documentKey();if(!key)throw Error('Cook application encryption is not configured.');
  const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return {encrypted,nonce,authTag:cipher.getAuthTag()};
}
function decryptSensitiveText(encrypted,nonce,tag) {
  if(!encrypted)return '';
  const key=documentKey();if(!key)throw Error('Cook application encryption key is not configured.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
}
function encryptCookDocument(doc) {
  const key=documentKey();if(!key)throw Error('Cook document encryption is not configured. Set COOKCIRCLE_DOCUMENT_KEY before starting the server.');
  const allowed={'application/pdf':b=>b.subarray(0,5).toString()==='%PDF-','image/jpeg':b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,'image/png':b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))};
  if(!doc||!allowed[doc.mimeType]||typeof doc.data!=='string')throw Error('Upload a PDF, JPEG, or PNG identity document.');
  const data=Buffer.from(doc.data,'base64');if(!data.length||data.length>5*1024*1024||!allowed[doc.mimeType](data))throw Error('An identity document is invalid or exceeds 5 MB.');
  const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
  return {fileName:path.basename(String(doc.fileName||'identity-document')).replace(/[\r\n]/g,'').slice(0,160),mimeType:doc.mimeType,encrypted,nonce,authTag:cipher.getAuthTag()};
}
function decryptCookDocument(row) {
  const key=documentKey();if(!key)throw Error('Document decryption key is not configured.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,row.nonce);decipher.setAuthTag(row.auth_tag);return Buffer.concat([decipher.update(row.encrypted_data),decipher.final()]);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, user) {
  if (typeof password !== 'string' || !user || typeof user.salt !== 'string' ||
      typeof user.passwordHash !== 'string' || !/^[a-f0-9]{128}$/i.test(user.passwordHash)) return false;
  try {
    const candidate = crypto.scryptSync(password, user.salt, 64);
    const stored = Buffer.from(user.passwordHash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}
function normalizeSignupPhone(value){return String(value||'').replace(/[\s().-]/g,'')}
function phoneLookupHash(value){const keyValue=process.env.COOKCIRCLE_PHONE_HASH_KEY||process.env.COOKCIRCLE_DOCUMENT_KEY||'';const key=/^[a-f0-9]{64}$/i.test(keyValue)?Buffer.from(keyValue,'hex'):null;if(!key)throw Object.assign(new Error('Phone sign-in needs COOKCIRCLE_PHONE_HASH_KEY.'),{httpStatus:503});return crypto.createHmac('sha256',key).update(normalizeSignupPhone(value)).digest('hex')}
function maskVerificationDestination(channel,destination){if(channel==='email'){const [name,domain]=destination.split('@');return (name.slice(0,1)||'')+'••••@'+domain}return '••••'+destination.slice(-4)}
let gmailApiAccessToken='';let gmailApiAccessTokenExpiresAt=0;
async function getGmailApiAccessToken(){
  const clientId=String(process.env.GMAIL_API_CLIENT_ID||'').trim(),clientSecret=String(process.env.GMAIL_API_CLIENT_SECRET||''),refreshToken=String(process.env.GMAIL_API_REFRESH_TOKEN||'').trim();
  if(!clientId||!clientSecret||!refreshToken)throw new Error('Gmail API OAuth settings are incomplete.');
  if(gmailApiAccessToken&&gmailApiAccessTokenExpiresAt>Date.now()+60_000)return gmailApiAccessToken;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.access_token){console.error('CookCircle Gmail API token refresh failed:',response.status,payload.error||'unknown error',payload.error_description||'');throw new Error('Gmail API could not authorize the sender. Check the OAuth client and refresh token.');}
  gmailApiAccessToken=payload.access_token;gmailApiAccessTokenExpiresAt=Date.now()+Math.max(60,Number(payload.expires_in)||3600)*1000;return gmailApiAccessToken;
}
async function sendGmailVerificationEmail(destination,code){
  const sender=String(process.env.GMAIL_API_SENDER||'').trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(sender))throw new Error('Gmail API sender address is not configured.');
  const token=await getGmailApiAccessToken();
  const message=['From: CookCircle <'+sender+'>','To: '+destination,'Subject: Your CookCircle verification code','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','','Your CookCircle verification code is '+code+'.','This code expires in 10 minutes. If you did not request it, ignore this email.'].join('\r\n');
  const raw=Buffer.from(message,'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){console.error('CookCircle Gmail API send failed:',response.status,payload.error?.status||payload.error?.message||'unknown error');throw new Error('Gmail API did not accept the message. Check Gmail API authorization and sender settings.');}
}
async function sendAppsScriptVerificationEmail(destination,code){
  const endpoint=String(process.env.COOKCIRCLE_GMAIL_RELAY_URL||'').trim(),relayToken=String(process.env.COOKCIRCLE_GMAIL_RELAY_TOKEN||'').trim();
  if(!endpoint||!relayToken)throw new Error('Google Apps Script email relay settings are incomplete.');
  let relayUrl;
  try{relayUrl=new URL(endpoint)}catch{throw new Error('Google Apps Script email relay URL is invalid.');}
  if(relayUrl.protocol!=='https:'||relayUrl.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(relayUrl.pathname))throw new Error('Google Apps Script email relay URL is invalid.');
  let response;
  try{
    response=await fetch(relayUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:relayToken,to:destination,code}),signal:AbortSignal.timeout(20000)});
  }catch(e){console.error('CookCircle Google Apps Script relay request failed:',e.name||'request error');throw new Error('Google Apps Script could not be reached. Check the relay URL and deployment access.');}
  let payload={};
  try{payload=await response.json()}catch{}
  if(!response.ok||payload.ok!==true){console.error('CookCircle Google Apps Script relay rejected email:',response.status,payload.error||'invalid response');throw new Error('Google Apps Script could not send the email. Check its deployment, authorization, and daily sending limit.');}
}
async function deliverSignupVerificationCode(channel,destination,code){
  if(channel!=='email')throw Object.assign(new Error('Email is the only available signup verification method.'),{httpStatus:400});
  if(process.env.COOKCIRCLE_GMAIL_RELAY_URL||process.env.COOKCIRCLE_GMAIL_RELAY_TOKEN){
    try{await sendAppsScriptVerificationEmail(destination,code)}catch(e){console.error('CookCircle Google Apps Script delivery failed:',e.message);throw Object.assign(new Error('Gmail could not send the code through the Google Apps Script relay. Check the relay settings in Render and the Apps Script executions page.'),{httpStatus:502})}
    return {deliveryMode:'google-apps-script'};
  }
  if(process.env.GMAIL_API_CLIENT_ID&&process.env.GMAIL_API_CLIENT_SECRET&&process.env.GMAIL_API_REFRESH_TOKEN&&process.env.GMAIL_API_SENDER){
    try{await sendGmailVerificationEmail(destination,code)}catch(e){console.error('CookCircle Gmail API delivery failed:',e.message);throw Object.assign(new Error('Gmail could not send the code. Check the Gmail API settings in Render and the server logs.'),{httpStatus:502})}
    return {deliveryMode:'gmail-api'};
  }
  if(process.env.RESEND_API_KEY&&process.env.COOKCIRCLE_EMAIL_FROM){
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.COOKCIRCLE_EMAIL_FROM,to:[destination],subject:'Your CookCircle verification code',text:'Your CookCircle verification code is '+code+'. It expires in 10 minutes. If you did not request it, ignore this email.'})});
    if(!response.ok){console.error('CookCircle email delivery failed:',response.status,(await response.text()).slice(0,300));throw Object.assign(new Error('The email provider could not send your code. Check the API key and verified sender address.'),{httpStatus:502})}
    return {deliveryMode:'email'};
  }
  if(process.env.RENDER&&process.env.GMAIL_SMTP_USER&&process.env.GMAIL_SMTP_APP_PASSWORD)throw Object.assign(new Error('Gmail SMTP is blocked on Render Free. Configure the Google Apps Script relay or Gmail API OAuth settings to send email over HTTPS.'),{httpStatus:503});
  throw Object.assign(new Error('Email delivery is not configured. Add Google Apps Script relay settings or Gmail API OAuth settings.'),{httpStatus:503});
}

function currentUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return sql.prepare(`SELECT u.id,u.name,u.email,u.society_id AS societyId,u.apartment,u.role,s.revoked_reason AS revokedReason,u.salt,
    u.password_hash AS passwordHash,u.created_at AS createdAt FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(crypto.createHash('sha256').update(token).digest('hex'),new Date().toISOString()) || null;
}
function tokenFor(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(
    crypto.createHash('sha256').update(token).digest('hex'),user.id,new Date(Date.now()+30*86400000).toISOString());
  return token;
}
function cleanUser(user) { return { id: user.id, name: user.name, email: user.email, societyId: user.societyId, apartment: user.apartment, role: user.role || 'customer' }; }
function requireRole(user, roles, res) { if (!roles.includes(user.role)) { send(res,403,{error:'This account does not have access to that area.'}); return false; } return true; }
function logAdmin(user, action, targetType, targetId, details='') {
  sql.prepare('INSERT INTO administrative_activity_logs(id,actor_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(),user.id,action,targetType,targetId,details,new Date().toISOString());
}
function dateAllowed(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const chosen = new Date(`${date}T00:00:00Z`); const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setUTCDate(limit.getUTCDate() + 7);
  return chosen >= today && chosen <= limit;
}
function serveFile(res, file) {
  const ext = path.extname(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
  fs.readFile(file, (err, data) => { if (err) return send(res, 404, { error: 'Page not found' }); res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(data); });
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-landing.html'));
  if (req.method === 'GET' && url.pathname === '/cookcircle-diet-plate.jpg') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-diet-plate.jpg'));
  if (req.method === 'GET' && url.pathname === '/cookcircle-vegetable-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-vegetable-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/admin-legumes-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'admin-legumes-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/household-dried-fruit-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'household-dried-fruit-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/cook-workspace-vegetables-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'cook-workspace-vegetables-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'CookCircle MVP API', build: USE_POSTGRES ? 'postgres-migration-bridge-v1' : 'sqlite-dynamic-stakeholders-v1', database: { engine: USE_POSTGRES ? 'PostgreSQL' : 'SQLite', connected: sql.prepare('SELECT 1 AS ok').get().ok === 1, persistent: true, ...(USE_POSTGRES ? {} : { file: path.basename(DB_FILE) }) }, features: { dynamicPersistentDatabase: true, bookingCheckinCodeInHouseholdBookings: true, publicHelpRequests: true, resolvedHelpRequestClear: true, emailSignupVerification: true, mobileSignupVerification: false, cookSignupWithoutResidence: true, cookDefaultAvatars: true, profilePhotoCrop: true, alphanumericCaptcha: true, caseSensitiveMixedCaptcha: true, dietPlateImage: true, vegetableBackground: true, societyRegistrationReview: true, adminPasswordReset: true, existingAdminPromotion: true, cookAndSocietyRemoval: true, adminBackground: true, permanentAdminDeletes: true, societySessionRevocation: true, removedCookCashoutOnly: true } });
  if (req.method === 'GET' && url.pathname === '/api/societies') return send(res, 200, { societies: db.societies });
  if (req.method === 'GET' && url.pathname === '/api/services') return send(res,200,{services:sql.prepare('SELECT id,name,duration_minutes AS durationMinutes,base_price_paise AS pricePaise FROM service_categories WHERE active=1 ORDER BY name').all()});

  if (req.method === 'POST' && url.pathname === '/api/society-registrations') {
    let body; try { body = await getBody(req); } catch (e) { return send(res,400,{error:e.message}); }
    const societyName=String(body.societyName||'').trim().slice(0,120),city=String(body.city||'').trim().slice(0,80),address=String(body.address||'').trim().slice(0,300),contactName=String(body.contactName||'').trim().slice(0,80),contactEmail=String(body.contactEmail||'').trim().toLowerCase().slice(0,254),contactPhone=String(body.contactPhone||'').trim().slice(0,24),notes=String(body.notes||'').trim().slice(0,1000),apartmentCount=Number(body.apartmentCount);
    if(societyName.length<3||city.length<2||address.length<8||contactName.length<2||!/^\S+@\S+\.\S+$/.test(contactEmail)||!/^[+\d][\d\s().-]{8,19}$/.test(contactPhone)||!Number.isInteger(apartmentCount)||apartmentCount<1||apartmentCount>10000)return send(res,400,{error:'Complete each required field with valid contact details and an apartment count from 1 to 10,000.'});
    const duplicate=sql.prepare("SELECT id FROM society_registrations WHERE lower(society_name)=lower(?) AND lower(contact_email)=lower(?) AND status='pending'").get(societyName,contactEmail);if(duplicate)return send(res,409,{error:'A society registration from this contact is already awaiting review.'});
    const id=crypto.randomUUID();sql.prepare('INSERT INTO society_registrations(id,society_name,city,address,apartment_count,contact_name,contact_email,contact_phone,notes,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,societyName,city,address,apartmentCount,contactName,contactEmail,contactPhone,notes,'pending',new Date().toISOString());return send(res,201,{ok:true,requestId:id,status:'pending'});
  }

  if (req.method === 'POST' && url.pathname === '/api/help-requests') {
    let body; try { body = await getBody(req); } catch (e) { return send(res,400,{error:e.message}); }
    const name=String(body.name||'').trim().slice(0,100),contact=String(body.contact||'').trim().slice(0,254),question=String(body.question||'').trim().slice(0,2000);
    const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact),validPhone=/^\+?[0-9][0-9\s().-]{7,18}$/.test(contact);
    if(name.length<2||(!validEmail&&!validPhone)||question.length<5)return send(res,400,{error:'Enter your name, a valid email address or mobile number, and a question of at least 5 characters.'});
    const id=crypto.randomUUID();sql.prepare('INSERT INTO help_requests(id,name,contact,question,status,created_at) VALUES(?,?,?,?,?,?)').run(id,name,contact,question,'open',new Date().toISOString());
    return send(res,201,{ok:true,requestId:id,status:'open'});
  }

  if (req.method === 'GET' && url.pathname === '/api/captcha') {
    const groups = ['abcdefghijkmnopqrstuvwxyz', '23456789', 'ABCDEFGHJKLMNPQRSTUVWXYZ'];
    const codeChars = groups.map(group => group[crypto.randomInt(group.length)]);
    const allChars = groups.join('');
    while (codeChars.length < 6) codeChars.push(allChars[crypto.randomInt(allChars.length)]);
    const code = codeChars.join(''); // First three characters guarantee lowercase, digit, uppercase.
    const id = crypto.randomBytes(18).toString('hex');
    challenges.set(id, { answer: code, expires: Date.now() + 5 * 60_000 });
    return send(res, 200, { id, code });
  }

  if(req.method==='POST'&&url.pathname==='/api/auth/verification/send'){
    let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
    const channel=String(body.channel||''),email=String(body.email||'').trim().toLowerCase();
    if(channel!=='email')return send(res,400,{error:'Email is the only available signup verification method.'});
    if(channel==='email'&&!/^\S+@\S+\.\S+$/.test(email))return send(res,400,{error:'Enter a valid email address.'});
    if(channel==='email'&&db.users.some(account=>account.email&&account.email.toLowerCase()===email))return send(res,409,{error:'An account with this email already exists. Please log in.'});
    const destination=email;
    const now=Date.now();for(const [id,item] of signupVerificationChallenges)if(item.expiresAt<now)signupVerificationChallenges.delete(id);for(const [token,item] of signupVerificationProofs)if(item.expiresAt<now)signupVerificationProofs.delete(token);for(const [key,times] of verificationSendHistory){const fresh=times.filter(time=>now-time<60*60_000);if(fresh.length)verificationSendHistory.set(key,fresh);else verificationSendHistory.delete(key)}const existing=body.challengeId?signupVerificationChallenges.get(String(body.challengeId)):null;
    if(body.challengeId&&existing&&(existing.channel!==channel||existing.destination!==destination))return send(res,400,{error:'The verification destination changed. Request a new code.'});
    if(existing&&now-existing.sentAt<60_000)return send(res,429,{error:'Please wait before requesting another code.',retryAfterSeconds:Math.ceil((60_000-(now-existing.sentAt))/1000)});
    const rateKey=(req.socket.remoteAddress||'local')+'|'+channel+'|'+destination;
    const sentTimes=(verificationSendHistory.get(rateKey)||[]).filter(time=>now-time<60*60_000);
    if(sentTimes.length>=5)return send(res,429,{error:'Too many verification codes requested. Try again in an hour.'});
    const code=String(crypto.randomInt(100000,1000000));let delivery;
    try{delivery=await deliverSignupVerificationCode(channel,destination,code)}catch(e){return send(res,e.httpStatus||502,{error:e.message||'Could not send the verification code.'})}
    const challengeId=existing?existing.id:crypto.randomBytes(20).toString('hex');
    signupVerificationChallenges.set(challengeId,{id:challengeId,channel,destination,codeHash:crypto.createHash('sha256').update(code).digest(),expiresAt:now+10*60_000,sentAt:now,attempts:0});
    sentTimes.push(now);verificationSendHistory.set(rateKey,sentTimes);
    return send(res,200,{challengeId,destinationMasked:maskVerificationDestination(channel,destination),expiresInSeconds:600,resendAfterSeconds:60,deliveryMode:delivery.deliveryMode});
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/verification/confirm'){
    let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
    const challenge=signupVerificationChallenges.get(String(body.challengeId||''));
    if(challenge&&challenge.channel!=='email'){signupVerificationChallenges.delete(challenge.id);return send(res,400,{error:'Email is the only available signup verification method.'})}
    if(!challenge||challenge.expiresAt<Date.now()){if(challenge)signupVerificationChallenges.delete(challenge.id);return send(res,400,{error:'That code expired. Request a new verification code.'})}
    if(challenge.attempts>=5){signupVerificationChallenges.delete(challenge.id);return send(res,429,{error:'Too many incorrect codes. Request a new verification code.'})}
    const supplied=crypto.createHash('sha256').update(String(body.code||'')).digest();
    if(!/^\d{6}$/.test(String(body.code||''))||!crypto.timingSafeEqual(supplied,challenge.codeHash)){challenge.attempts++;return send(res,400,{error:'That verification code is incorrect.'})}
    signupVerificationChallenges.delete(challenge.id);const verificationToken=crypto.randomBytes(32).toString('hex');signupVerificationProofs.set(verificationToken,{channel:challenge.channel,destination:challenge.destination,expiresAt:Date.now()+10*60_000});
    return send(res,200,{verified:true,verificationToken});
  }
  if (req.method === 'POST' && ['/api/auth/signup', '/api/auth/login'].includes(url.pathname)) {
    let body; try { body = await getBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
    const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
    const challenge = challenges.get(String(body.captchaId || '')); challenges.delete(String(body.captchaId || ''));
    if (!challenge || challenge.expires < Date.now() || String(body.captchaAnswer || '').trim() !== challenge.answer) return send(res, 400, { error: 'Enter the CAPTCHA exactly as shown, including uppercase and lowercase letters.' });
    if(password.length<8)return send(res,400,{error:'Use a password with at least 8 characters.'});
    if(url.pathname.endsWith('/signup')){
      const channel=String(body.verificationChannel||''),phone=normalizeSignupPhone(body.phone);
      if(channel!=='email')return send(res,400,{error:'Email is the only available signup verification method.'});
      if(!/^\S+@\S+\.\S+$/.test(email))return send(res,400,{error:'Enter a valid email address.'});
    }else if(!/^\S+@\S+\.\S+$/.test(email)&&!/^\+[1-9]\d{7,14}$/.test(normalizeSignupPhone(body.email)))return send(res,400,{error:'Enter a valid email address or mobile number.'});
    if (url.pathname.endsWith('/signup')) {
      const name = String(body.name || '').trim(), role = String(body.role || 'customer'), householdName = role === 'customer' ? String(body.householdName || '').trim().slice(0,80) : ''; let societyId = String(body.societyId || '');
      let apartment = String(body.apartment || '').trim(), address='', phone='', householdPhone=null, yearsExperience=0, encryptedDocs=[],serviceSocietyIds=[];
      if (!['customer','cook','society_admin'].includes(role)) return send(res, 403, { error: 'Platform administrator accounts must be configured by the operator.' });
      const verificationToken=String(body.verificationToken||''),verificationChannel=String(body.verificationChannel||''),verificationProof=signupVerificationProofs.get(verificationToken);
      const verificationDestination=verificationChannel==='email'?email:'';
      if(!verificationProof||verificationProof.expiresAt<Date.now()||verificationProof.channel!=='email'||verificationChannel!=='email'||verificationProof.destination!==verificationDestination)return send(res,400,{error:'Verify your email address before creating your account.'});
      if (name.length < 2 || (role !== 'cook' && !sql.prepare('SELECT id FROM societies WHERE id=? AND is_active=1').get(societyId))) return send(res, 400, { error: 'Add your name and choose an active service society.' });
      if (role === 'cook') societyId = null;
      const signupPhoneHash=null;if(db.users.some(u=>u.email&&u.email.toLowerCase()===email))return send(res,409,{error:'An account with this email already exists. Please log in.'});
      if(role==='cook'){
        address=String(body.address||'').trim();phone=String(body.phone||'').trim();yearsExperience=Number(body.yearsExperience);
        if(address.length<10||address.length>500||!/^[+\d][\d\s().-]{8,19}$/.test(phone)||!Number.isInteger(yearsExperience)||yearsExperience<0||yearsExperience>60)return send(res,400,{error:'Enter a complete address, a valid phone number, and cooking experience from 0 to 60 years.'});
        serviceSocietyIds=[...new Set((Array.isArray(body.serviceSocietyIds)?body.serviceSocietyIds:[]).map(x=>String(x||'').trim()).filter(Boolean))];
        if(!serviceSocietyIds.length||serviceSocietyIds.length>20)return send(res,400,{error:'Choose at least one nearby society you can serve.'});
        const activeServiceSocieties=sql.prepare(`SELECT id FROM societies WHERE is_active=1 AND id IN (${serviceSocietyIds.map(()=>'?').join(',')})`).all(...serviceSocietyIds);
        if(activeServiceSocieties.length!==serviceSocietyIds.length)return send(res,400,{error:'Choose only active societies from the nearby-society list.'});
        if(!documentKey())return send(res,503,{error:'Cook document encryption is not configured. Set COOKCIRCLE_DOCUMENT_KEY in PowerShell, restart the server, and try again.'});
        if(!Array.isArray(body.documents)||body.documents.length<1||body.documents.length>3)return send(res,400,{error:'Upload 1 to 3 identity verification documents.'});
        try{encryptedDocs=body.documents.map(encryptCookDocument)}catch(e){return send(res,400,{error:e.message})}if(encryptedDocs.reduce((n,d)=>n+d.encrypted.length,0)>10*1024*1024)return send(res,400,{error:'Identity documents must total 10 MB or less.'});apartment='Cook application';
      }else{
        if(!apartment)return send(res,400,{error:'Enter your apartment number.'});
        if(role==='customer'){
          phone=String(body.phone||'').trim();
          if(!/^[+\d][\d\s().-]{8,19}$/.test(phone))return send(res,400,{error:'Enter a valid household mobile number, including your country code.'});
          try{householdPhone=encryptSensitiveText(phone)}catch(e){return send(res,503,{error:'Household phone encryption is not configured. Ask the site administrator to check the server encryption key.'})}
        }
      }
      const pass = hashPassword(password); const user = { id: crypto.randomUUID(), name, householdName, email, phoneHash:signupPhoneHash, societyId, apartment, role, address, phone, householdPhone, yearsExperience, salt: pass.salt, passwordHash: pass.hash, createdAt: new Date().toISOString() };
      insertUser(user);if(role==='cook'){const cook=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id),addArea=sql.prepare("INSERT INTO cook_service_societies(cook_id,society_id,status) VALUES(?,?,'pending')");for(const societyId of serviceSocietyIds)addArea.run(cook.id,societyId);storeCookDocuments(cook.id,body.documents,encryptedDocs);queueAdminDirectorySync()}signupVerificationProofs.delete(verificationToken);return send(res, 201, { token: tokenFor(user), user: cleanUser(user) });
    }
    let user;if(/^\S+@\S+\.\S+$/.test(email))user=db.users.find(account=>account.email&&account.email.toLowerCase()===email);else{try{const phoneHash=phoneLookupHash(body.email);user=db.users.find(account=>account.phoneHash===phoneHash)}catch{user=null}}
    if (!user || !verifyPassword(password, user)) return send(res, 401, { error: 'Email/mobile number or password is incorrect.' });
    if(user.role==='customer'||user.role==='society_admin'){const society=sql.prepare('SELECT is_active AS isActive FROM societies WHERE id=?').get(user.societyId);if(!society||!society.isActive)return send(res,403,{code:'society_removed',error:'Your society was removed by the admin. You can request to add a society.'});}
    return send(res, 200, { token: tokenFor(user), user: cleanUser(user) });
  }

  if (url.pathname.startsWith('/api/')) {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'Please log in to continue.' });
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
    const society=['customer','society_admin'].includes(user.role)?sql.prepare('SELECT is_active AS isActive FROM societies WHERE id=?').get(user.societyId):{isActive:1};
    if(['customer','society_admin'].includes(user.role)&&(user.revokedReason==='society_removed'||!society||!society.isActive)){
      sql.prepare("UPDATE sessions SET revoked_reason='society_removed' WHERE token_hash=?").run(tokenHash);
      sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
      return send(res,401,{code:'society_removed',error:'Your society was removed by the admin. You have been logged out. You can request to add a society.'});
    }
    if(user.role==='cook'){
      const cookAccess=sql.prepare('SELECT is_active AS isActive FROM cook_profiles WHERE user_id=?').get(user.id);
      const cashoutOnly=Boolean(cookAccess&&!cookAccess.isActive);
      const allowed=cashoutOnly&&((req.method==='GET'&&['/api/me','/api/cook/earnings'].includes(url.pathname))||(req.method==='POST'&&['/api/cook/cashout','/api/logout'].includes(url.pathname)));
      if(cashoutOnly&&!allowed)return send(res,403,{code:'cook_removed',error:'You were removed by the admin. You can still request a cash out.'});
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
      sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
      return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
      if (!requireRole(user,['platform_admin'],res)) return;
      const count=(table,where='')=>sql.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get().n;
      return send(res,200,{overview:{societies:count('societies','WHERE is_active=1'),households:count('households'),activeSubscribers:count('subscriptions',"WHERE status='active'"),verifiedCooks:count('cook_profiles',"WHERE verification_status='approved' AND is_active=1"),pendingCooks:count('cook_profiles',"WHERE verification_status IN ('pending','application received','in review') AND is_active=1"),todayBookings:sql.prepare('SELECT COUNT(*) AS n FROM bookings WHERE date=?').get(new Date().toISOString().slice(0,10)).n,upcomingBookings:count('bookings',"WHERE date>=date('now')"),completedBookings:count('bookings',"WHERE status='Completed'"),cancelledBookings:count('bookings',"WHERE status='Cancelled'"),revenuePaise:sql.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM payments WHERE status IN ('paid','simulated-paid')").get().n,openComplaints:count('complaints',"WHERE status='open'"),openHelpRequests:count('help_requests',"WHERE status='open'"),cashoutRequests:count('cook_cashouts',"WHERE status='requested'")}});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/sheets'){
      if(!requireRole(user,['platform_admin'],res))return;
      const syncConfigured=Boolean(process.env.COOKCIRCLE_SHEETS_SYNC_URL&&process.env.COOKCIRCLE_SHEETS_SYNC_TOKEN);
      return send(res,200,{sheetUrl:adminSheetUrl,syncConfigured,lastSyncAt:directorySyncState.at,lastSyncError:directorySyncState.error||(!syncConfigured?'Google Sheets live sync is not configured in Render.':'')});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/sheets/sync'){
      if(!requireRole(user,['platform_admin'],res))return;
      queueAdminDirectorySync();
      return send(res,202,{ok:true,queued:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/bookings') {
      if (!requireRole(user,['platform_admin'],res)) return;
      return send(res,200,{bookings:sql.prepare(`SELECT b.id,b.date,b.slot,b.meal,b.status,b.society_id AS societyId,b.payment_status AS paymentStatus,b.price_paise AS pricePaise,u.name AS household,u.apartment,s.name AS society,b.cook FROM bookings b JOIN users u ON u.id=b.user_id JOIN societies s ON s.id=b.society_id ORDER BY b.date DESC,b.slot`).all()});
    }
    const adminBooking=url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/);
    if (req.method === 'PATCH' && adminBooking) {
      if (!requireRole(user,['platform_admin'],res)) return;
      let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const allowed=['Requested','Confirmed','Cook assigned','Backup required','Replacement confirmed','Cook en route','Checked in','In progress','Completed','Cancelled','Refund pending','Refunded','No-show','No cook available'];
      const row=sql.prepare('SELECT id,status,society_id AS societyId,date,slot,payment_status AS paymentStatus FROM bookings WHERE id=?').get(adminBooking[1]);if(!row)return send(res,404,{error:'Booking not found.'});
      let status=String(body.status||'');if(body.cookProfileId){if(!['simulated-paid','credit-applied'].includes(row.paymentStatus))return send(res,400,{error:'The booking must be paid or use a session credit before cook assignment.'});const cook=sql.prepare(`SELECT c.id FROM cook_profiles c JOIN cook_service_societies area ON area.cook_id=c.id AND area.society_id=? AND area.status='approved' JOIN societies s ON s.id=area.society_id AND s.is_active=1 WHERE c.id=? AND c.verification_status='approved' AND c.is_active=1 AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.cook_profile_id=c.id AND b.date=? AND b.slot=? AND b.status NOT IN ('Cancelled','Refunded')) AND NOT EXISTS(SELECT 1 FROM cook_availability a WHERE a.cook_id=c.id AND a.date=? AND a.slot=? AND a.available=0)`).get(row.societyId,body.cookProfileId,row.date,row.slot,row.date,row.slot);if(!cook)return send(res,400,{error:'Choose an available, approved cook who serves this society.'});status=row.status==='Backup required'?'Replacement confirmed':'Cook assigned';}
      if(!allowed.includes(status))return send(res,400,{error:'Choose a valid booking status.'});
      setBookingStatus(row.id,status,'Updated by platform administrator',body.cookProfileId||null);logAdmin(user,'booking_updated','booking',row.id,status);
      return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/cooks') {
      if (!requireRole(user,['platform_admin'],res)) return;
      const cooks=sql.prepare(`SELECT c.id,c.name,c.society_id AS societyId,sc.name AS serviceSocietyName,c.verification_status AS verificationStatus,c.is_active AS isActive,c.specialties,c.address_encrypted AS addressEncrypted,c.address_nonce AS addressNonce,c.address_tag AS addressTag,c.phone_encrypted AS phoneEncrypted,c.phone_nonce AS phoneNonce,c.phone_tag AS phoneTag,c.years_experience AS yearsExperience,c.is_demo AS isDemo,u.email FROM cook_profiles c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN societies sc ON sc.id=c.society_id ORDER BY c.is_demo,c.name`).all().map(c=>({...c,address:decryptSensitiveText(c.addressEncrypted,c.addressNonce,c.addressTag),phone:decryptSensitiveText(c.phoneEncrypted,c.phoneNonce,c.phoneTag),serviceSocieties:sql.prepare(`SELECT ss.id,ss.name,ss.city,a.status FROM cook_service_societies a JOIN societies ss ON ss.id=a.society_id WHERE a.cook_id=? ORDER BY ss.name`).all(c.id)}));
      return send(res,200,{cooks});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/cashouts'){
      if(!requireRole(user,['platform_admin'],res))return;return send(res,200,{cashouts:sql.prepare(`SELECT x.id,x.amount_paise AS amountPaise,x.status,x.created_at AS createdAt,c.name AS cook,u.email FROM cook_cashouts x JOIN cook_profiles c ON c.id=x.cook_id LEFT JOIN users u ON u.id=c.user_id ORDER BY x.created_at DESC`).all()});
    }
    const adminCashout=url.pathname.match(/^\/api\/admin\/cashouts\/([^/]+)$/);
    if(req.method==='PATCH'&&adminCashout){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}if(!['paid','rejected'].includes(body.status))return send(res,400,{error:'Choose paid or rejected.'});sql.prepare('UPDATE cook_cashouts SET status=?,note=? WHERE id=?').run(body.status,String(body.note||'').slice(0,500),adminCashout[1]);if(body.status==='paid')sql.prepare("UPDATE cook_payouts SET status='paid' WHERE id IN (SELECT payout_id FROM cook_cashout_items WHERE cashout_id=?)").run(adminCashout[1]);logAdmin(user,'cook_cashout_updated','cook_cashout',adminCashout[1],body.status);return send(res,200,{ok:true})}
    const cookDocs=url.pathname.match(/^\/api\/admin\/cooks\/([^/]+)\/documents$/);
    if(req.method==='GET'&&cookDocs){if(!requireRole(user,['platform_admin'],res))return;const cook=sql.prepare('SELECT id FROM cook_profiles WHERE id=?').get(cookDocs[1]);if(!cook)return send(res,404,{error:'Cook application not found.'});logAdmin(user,'cook_documents_listed','cook',cook.id);return send(res,200,{documents:sql.prepare('SELECT id,file_name AS fileName,mime_type AS mimeType,uploaded_at AS uploadedAt FROM cook_documents WHERE cook_id=? ORDER BY uploaded_at').all(cook.id)})}
    const cookDoc=url.pathname.match(/^\/api\/admin\/cooks\/([^/]+)\/documents\/([^/]+)$/);
    if(req.method==='GET'&&cookDoc){if(!requireRole(user,['platform_admin'],res))return;const row=sql.prepare('SELECT id,file_name,mime_type,encrypted_data,nonce,auth_tag FROM cook_documents WHERE id=? AND cook_id=?').get(cookDoc[2],cookDoc[1]);if(!row)return send(res,404,{error:'Document not found.'});try{const data=decryptCookDocument(row);logAdmin(user,'cook_document_viewed','cook',cookDoc[1],row.file_name);return send(res,200,{fileName:row.file_name,mimeType:row.mime_type,data:data.toString('base64')})}catch(e){return send(res,500,{error:'Unable to decrypt this document. Check the COOKCIRCLE_DOCUMENT_KEY used to start the server.'})}}
    if (req.method === 'GET' && url.pathname === '/api/admin/services') {
      if(!requireRole(user,['platform_admin'],res))return;
      return send(res,200,{services:sql.prepare('SELECT id,name,duration_minutes AS durationMinutes,base_price_paise AS pricePaise,active FROM service_categories ORDER BY name').all()});
    }
    const adminService=url.pathname.match(/^\/api\/admin\/services\/([^/]+)$/);
    if(req.method==='PATCH'&&adminService){
      if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const duration=Math.max(60,Math.min(360,Number(body.durationMinutes)||120)),price=Math.max(0,Math.min(10000000,Number(body.pricePaise)||0));const result=sql.prepare('UPDATE service_categories SET duration_minutes=?,base_price_paise=?,active=? WHERE id=?').run(duration,price,body.active===false?0:1,adminService[1]);if(!result.changes)return send(res,404,{error:'Service type not found.'});logAdmin(user,'service_config_updated','service',adminService[1],`${price} paise / ${duration} minutes`);return send(res,200,{ok:true});
    }
    const verifyCook=url.pathname.match(/^\/api\/admin\/cooks\/([^/]+)\/verification$/);
    if (req.method === 'POST' && verifyCook) {
      if (!requireRole(user,['platform_admin'],res)) return;
      let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const status=String(body.status||'');if(!['approved','rejected'].includes(status))return send(res,400,{error:'Choose Accept or Reject.'});
      const row=sql.prepare('SELECT id,user_id,verification_status FROM cook_profiles WHERE id=?').get(verifyCook[1]);if(!row)return send(res,404,{error:'Cook not found.'});
      if(!['pending','application received','in review'].includes(String(row.verification_status||'').toLowerCase()))return send(res,409,{error:'This cook request has already been reviewed.'});
      const submittedSocietyIds=Array.isArray(body.societyIds)?body.societyIds:(body.societyId?[body.societyId]:[]);const selectedAtSignup=status==='approved'&&submittedSocietyIds.length===0?sql.prepare("SELECT society_id AS societyId FROM cook_service_societies WHERE cook_id=? AND status='pending' ORDER BY society_id").all(row.id).map(item=>item.societyId):submittedSocietyIds;const serviceSocietyIds=status==='approved'?[...new Set(selectedAtSignup.map(x=>String(x||'').trim()).filter(Boolean))]:[];
      if(status==='approved'&&(!serviceSocietyIds.length||serviceSocietyIds.length>20))return send(res,400,{error:'Select at least one nearby society to approve for this cook.'});
      if(status==='approved'){const active=sql.prepare(`SELECT id FROM societies WHERE is_active=1 AND id IN (${serviceSocietyIds.map(()=>'?').join(',')})`).all(...serviceSocietyIds);if(active.length!==serviceSocietyIds.length)return send(res,400,{error:'Choose only active societies from the service-area list.'});}
      sql.exec('BEGIN IMMEDIATE');try{
        const updated=sql.prepare("UPDATE cook_profiles SET verification_status=?,society_id=? WHERE id=? AND lower(verification_status) IN ('pending','application received','in review')").run(status,status==='approved'?serviceSocietyIds[0]:null,row.id);
        if(!updated.changes){sql.exec('ROLLBACK');return send(res,409,{error:'This cook request has already been reviewed.'});}
        if(status==='approved'){
          sql.prepare('DELETE FROM cook_service_societies WHERE cook_id=?').run(row.id);
          const addArea=sql.prepare("INSERT INTO cook_service_societies(cook_id,society_id,status) VALUES(?,?,'approved')");for(const societyId of serviceSocietyIds)addArea.run(row.id,societyId);
        }else sql.prepare("UPDATE cook_service_societies SET status='rejected' WHERE cook_id=?").run(row.id);
        sql.exec('COMMIT');
      }catch(e){sql.exec('ROLLBACK');return send(res,500,{error:'Could not save the cook service areas.'})}
      if(status==='rejected')sql.prepare('UPDATE cook_profiles SET is_active=0 WHERE id=?').run(row.id);
      sql.prepare('UPDATE cook_verification_records SET status=?,reviewed_by=?,updated_at=? WHERE cook_id=? AND status IN (\'pending\',\'in review\')').run(status,user.id,new Date().toISOString(),row.id);
      sql.prepare('INSERT INTO cook_verification_records(id,cook_id,record_type,status,notes,reviewed_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),row.id,'admin review',status,String(body.notes||'').slice(0,500),user.id,new Date().toISOString());
      if(row.user_id)sql.prepare('INSERT INTO notifications(id,user_id,kind,message,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),row.user_id,'cook_verification',`Your cook application was ${status}.`,new Date().toISOString());
      logAdmin(user,'cook_verification_updated','cook',row.id,status);queueAdminDirectorySync();return send(res,200,{ok:true});
    }
    const adminCookDelete=url.pathname.match(/^\/api\/admin\/cooks\/([^/]+)$/);
    if(req.method==='DELETE'&&adminCookDelete){
      if(!requireRole(user,['platform_admin'],res))return;
      const cookId=adminCookDelete[1],row=sql.prepare('SELECT id,name,user_id,is_active AS isActive FROM cook_profiles WHERE id=?').get(cookId);
      if(!row)return send(res,404,{error:'Cook request not found.'});
      if(row.isActive)return send(res,409,{error:'Remove this cook from new bookings before permanently deleting the request.'});
      const cookReferences=[['bookings','cook_profile_id'],['backup_assignments','primary_cook_id'],['backup_assignments','backup_cook_id'],['reviews','cook_id'],['cook_payouts','cook_id'],['cook_cashouts','cook_id']];
      for(const [table,column] of cookReferences){if(sql.prepare('SELECT 1 FROM '+table+' WHERE '+column+'=? LIMIT 1').get(cookId))return send(res,409,{error:'This cook has booking, review, or earnings history. It has been kept so those records remain intact.'})}
      const cookUser=row.user_id?sql.prepare('SELECT id,role FROM users WHERE id=?').get(row.user_id):null;
      if(cookUser&&cookUser.role==='platform_admin')return send(res,409,{error:'A platform administrator account cannot be deleted as a cook request.'});
      if(cookUser){
        const userReferences=[['bookings','user_id'],['payments','user_id'],['subscriptions','user_id'],['credit_ledger','user_id'],['complaints','user_id'],['households','user_id'],['capacity_requests','requested_by'],['reviews','user_id']];
        for(const [table,column] of userReferences){if(sql.prepare('SELECT 1 FROM '+table+' WHERE '+column+'=? LIMIT 1').get(cookUser.id))return send(res,409,{error:'This cook account has other service history. It has been kept so those records remain intact.'})}
      }
      sql.exec('BEGIN IMMEDIATE');
      try{
        sql.prepare('DELETE FROM cook_documents WHERE cook_id=?').run(cookId);
        sql.prepare('DELETE FROM cook_availability WHERE cook_id=?').run(cookId);
        sql.prepare('DELETE FROM cook_verification_records WHERE cook_id=?').run(cookId);
        if(cookUser){
          sql.prepare('DELETE FROM sessions WHERE user_id=?').run(cookUser.id);
          sql.prepare('DELETE FROM notifications WHERE user_id=?').run(cookUser.id);
          sql.prepare('UPDATE society_registrations SET reviewed_by=NULL WHERE reviewed_by=?').run(cookUser.id);
          sql.prepare('UPDATE cook_verification_records SET reviewed_by=NULL WHERE reviewed_by=?').run(cookUser.id);
          sql.prepare('UPDATE administrative_activity_logs SET actor_user_id=NULL WHERE actor_user_id=?').run(cookUser.id);
        }
        sql.prepare('DELETE FROM cook_profiles WHERE id=?').run(cookId);
        if(cookUser)sql.prepare('DELETE FROM users WHERE id=?').run(cookUser.id);
        logAdmin(user,'cook_request_permanently_deleted','cook',cookId,row.name);
        sql.exec('COMMIT');
      }catch(e){sql.exec('ROLLBACK');return send(res,409,{error:'This cook still has linked records and cannot be permanently deleted. Keep it removed instead.'})}
      queueAdminDirectorySync();return send(res,200,{ok:true});
    }
    const adminCookActive=url.pathname.match(/^\/api\/admin\/cooks\/([^/]+)\/active$/);
    if(req.method==='PATCH'&&adminCookActive){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}if(typeof body.active!=='boolean')return send(res,400,{error:'Choose whether to remove or restore this cook.'});const result=sql.prepare('UPDATE cook_profiles SET is_active=? WHERE id=?').run(body.active?1:0,adminCookActive[1]);if(!result.changes)return send(res,404,{error:'Cook not found.'});logAdmin(user,body.active?'cook_restored':'cook_removed','cook',adminCookActive[1],body.active?'active':'removed from new bookings');queueAdminDirectorySync();return send(res,200,{ok:true,active:body.active});}
    if (req.method === 'GET' && url.pathname === '/api/admin/complaints') {
      if (!requireRole(user,['platform_admin'],res)) return;
      return send(res,200,{complaints:sql.prepare(`SELECT c.id,c.category,c.details,c.status,c.created_at AS createdAt,u.name AS customer,b.id AS bookingId FROM complaints c JOIN users u ON u.id=c.user_id LEFT JOIN bookings b ON b.id=c.booking_id ORDER BY c.created_at DESC`).all()});
    }
    const adminComplaint=url.pathname.match(/^\/api\/admin\/complaints\/([^/]+)$/);
    if(req.method==='PATCH'&&adminComplaint){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const status=['open','reviewing','resolved'].includes(body.status)?body.status:'';if(!status)return send(res,400,{error:'Choose a valid complaint status.'});sql.prepare('UPDATE complaints SET status=? WHERE id=?').run(status,adminComplaint[1]);logAdmin(user,'complaint_updated','complaint',adminComplaint[1],status);return send(res,200,{ok:true})}
    if (req.method === 'GET' && url.pathname === '/api/admin/help-requests') {
      if (!requireRole(user,['platform_admin'],res)) return;
      return send(res,200,{requests:sql.prepare('SELECT id,name,contact,question,status,created_at AS createdAt FROM help_requests ORDER BY created_at DESC').all()});
    }
    const adminHelpRequest=url.pathname.match(/^\/api\/admin\/help-requests\/([^/]+)$/);
    if(req.method==='PATCH'&&adminHelpRequest){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const status=['open','resolved'].includes(body.status)?body.status:'';if(!status)return send(res,400,{error:'Choose open or resolved.'});const updated=sql.prepare('UPDATE help_requests SET status=? WHERE id=?').run(status,adminHelpRequest[1]);if(!updated.changes)return send(res,404,{error:'Help request not found.'});logAdmin(user,'help_request_updated','help_request',adminHelpRequest[1],status);return send(res,200,{ok:true})}
    if(req.method==='DELETE'&&adminHelpRequest){if(!requireRole(user,['platform_admin'],res))return;const row=sql.prepare('SELECT id,status,name FROM help_requests WHERE id=?').get(adminHelpRequest[1]);if(!row)return send(res,404,{error:'Help request not found.'});if(row.status!=='resolved')return send(res,409,{error:'Resolve the help request before clearing it.'});sql.prepare('DELETE FROM help_requests WHERE id=?').run(row.id);logAdmin(user,'help_request_cleared','help_request',row.id,row.name);return send(res,200,{ok:true})}
    if (req.method === 'GET' && url.pathname === '/api/admin/capacity-requests') {
      if (!requireRole(user,['platform_admin'],res)) return;
      return send(res,200,{requests:sql.prepare(`SELECT r.id,r.details,r.status,r.created_at AS createdAt,s.name AS society,u.name AS requestedBy FROM capacity_requests r JOIN societies s ON s.id=r.society_id JOIN users u ON u.id=r.requested_by ORDER BY r.created_at DESC`).all()});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/society-registrations') {
      if (!requireRole(user,['platform_admin'],res)) return;
      return send(res,200,{registrations:sql.prepare('SELECT id,society_name AS societyName,city,address,apartment_count AS apartmentCount,contact_name AS contactName,contact_email AS contactEmail,contact_phone AS contactPhone,notes,status,created_at AS createdAt,reviewed_at AS reviewedAt,society_id AS societyId FROM society_registrations ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END,created_at DESC').all()});
    }
    const adminSocietyRegistration=url.pathname.match(/^\/api\/admin\/society-registrations\/([^/]+)$/);
    if(req.method==='DELETE'&&adminSocietyRegistration){
      if(!requireRole(user,['platform_admin'],res))return;
      const row=sql.prepare('SELECT id,society_name AS societyName,status FROM society_registrations WHERE id=?').get(adminSocietyRegistration[1]);
      if(!row)return send(res,404,{error:'Society registration not found.'});
      if(row.status==='pending')return send(res,409,{error:'Review or reject this society request before deleting it.'});
      sql.prepare('DELETE FROM society_registrations WHERE id=?').run(row.id);
      logAdmin(user,'society_registration_permanently_deleted','society_registration',row.id,row.societyName);
      return send(res,200,{ok:true});
    }
    if(req.method==='PATCH'&&adminSocietyRegistration){
      if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const status=['approved','rejected'].includes(body.status)?body.status:'';if(!status)return send(res,400,{error:'Choose approve or reject.'});const row=sql.prepare('SELECT * FROM society_registrations WHERE id=?').get(adminSocietyRegistration[1]);if(!row)return send(res,404,{error:'Society registration not found.'});if(row.status!=='pending')return send(res,409,{error:'This society registration has already been reviewed.'});
      const now=new Date().toISOString();let societyId=null;sql.exec('BEGIN IMMEDIATE');try{if(status==='approved'){societyId='soc-'+crypto.randomBytes(6).toString('hex');sql.prepare('INSERT INTO societies(id,name,city) VALUES(?,?,?)').run(societyId,row.society_name,row.city)}sql.prepare('UPDATE society_registrations SET status=?,reviewed_at=?,reviewed_by=?,society_id=? WHERE id=? AND status=\'pending\'').run(status,now,user.id,societyId,row.id);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');return send(res,500,{error:'Could not save the society review.'})}
      logAdmin(user,'society_registration_'+status,'society_registration',row.id,row.society_name);if(status==='approved')queueAdminDirectorySync();return send(res,200,{ok:true,status,societyId});
    }
    const adminCapacity=url.pathname.match(/^\/api\/admin\/capacity-requests\/([^/]+)$/);
    if(req.method==='PATCH'&&adminCapacity){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const status=['open','reviewing','resolved'].includes(body.status)?body.status:'';if(!status)return send(res,400,{error:'Choose a valid request status.'});const result=sql.prepare('UPDATE capacity_requests SET status=? WHERE id=?').run(status,adminCapacity[1]);if(!result.changes)return send(res,404,{error:'Capacity request not found.'});logAdmin(user,'capacity_request_updated','capacity_request',adminCapacity[1],status);return send(res,200,{ok:true})}
    if (req.method === 'POST' && url.pathname === '/api/society/capacity-request') {
      if(!requireRole(user,['society_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const details=String(body.details||'').trim().slice(0,1000);if(details.length<5)return send(res,400,{error:'Describe what additional cook capacity your society needs.'});
      const id=crypto.randomUUID();sql.prepare('INSERT INTO capacity_requests(id,society_id,requested_by,details,created_at) VALUES(?,?,?,?,?)').run(id,user.societyId,user.id,details,new Date().toISOString());return send(res,201,{id,status:'open'});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/societies'){
      if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const name=String(body.name||'').trim(),city=String(body.city||'').trim();if(name.length<3||city.length<2)return send(res,400,{error:'Enter a society name and city.'});const row={id:'soc-'+crypto.randomBytes(6).toString('hex'),name,city};sql.prepare('INSERT INTO societies(id,name,city) VALUES(?,?,?)').run(row.id,row.name,row.city);logAdmin(user,'society_created','society',row.id,row.name);queueAdminDirectorySync();return send(res,201,{society:row});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/societies'){
      if(!requireRole(user,['platform_admin'],res))return;return send(res,200,{societies:sql.prepare('SELECT id,name,city,is_active AS isActive,created_at AS createdAt FROM societies ORDER BY is_active DESC,name').all()});
    }
    const adminSocietyDelete=url.pathname.match(/^\/api\/admin\/societies\/([^/]+)$/);
    if(req.method==='DELETE'&&adminSocietyDelete){
      if(!requireRole(user,['platform_admin'],res))return;
      const societyId=adminSocietyDelete[1],row=sql.prepare('SELECT id,name,is_active AS isActive FROM societies WHERE id=?').get(societyId);
      if(!row)return send(res,404,{error:'Society not found.'});
      if(row.isActive)return send(res,409,{error:'Remove this society from new registrations before permanently deleting it.'});
      const references=[['users','society_id'],['cook_profiles','society_id'],['bookings','society_id'],['households','society_id'],['capacity_requests','society_id'],['society_registrations','society_id']];
      for(const [table,column] of references){if(sql.prepare('SELECT 1 FROM '+table+' WHERE '+column+'=? LIMIT 1').get(societyId))return send(res,409,{error:'This society still has linked accounts, bookings, cooks, or requests. It has been kept so those records remain intact.'})}
      sql.prepare('DELETE FROM societies WHERE id=?').run(societyId);
      logAdmin(user,'society_permanently_deleted','society',societyId,row.name);
      queueAdminDirectorySync();
      return send(res,200,{ok:true});
    }
    const adminSocietyActive=url.pathname.match(/^\/api\/admin\/societies\/([^/]+)\/active$/);
    if(req.method==='PATCH'&&adminSocietyActive){
      if(!requireRole(user,['platform_admin'],res))return;
      let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      if(typeof body.active!=='boolean')return send(res,400,{error:'Choose whether to remove or restore this society.'});
      const result=sql.prepare('UPDATE societies SET is_active=? WHERE id=?').run(body.active?1:0,adminSocietyActive[1]);
      if(!result.changes)return send(res,404,{error:'Society not found.'});
      if(!body.active)sql.prepare("UPDATE sessions SET revoked_reason='society_removed' WHERE user_id IN (SELECT id FROM users WHERE society_id=?)").run(adminSocietyActive[1]);
      logAdmin(user,body.active?'society_restored':'society_removed','society',adminSocietyActive[1],body.active?'active':'removed from new registrations; user sessions revoked');
      queueAdminDirectorySync();
      return send(res,200,{ok:true,active:body.active});
    }
    if (req.method === 'GET' && url.pathname === '/api/society/overview') {
      if (!requireRole(user,['society_admin'],res)) return;
      const [society]=db.societies.filter(s=>s.id===user.societyId);
      return send(res,200,{society,households:sql.prepare('SELECT COUNT(*) AS n FROM households WHERE society_id=?').get(user.societyId).n,bookings:sql.prepare('SELECT COUNT(*) AS n FROM bookings WHERE society_id=?').get(user.societyId).n,mealDemand:sql.prepare('SELECT meal,COUNT(*) AS count FROM bookings WHERE society_id=? GROUP BY meal ORDER BY count DESC').all(user.societyId)});
    }
    if(req.method==='GET'&&url.pathname==='/api/cook/profile'){
      if(!requireRole(user,['cook'],res))return;const c=sql.prepare(`SELECT id,name,verification_status AS verificationStatus,years_experience AS yearsExperience,specialties,bio,address_encrypted AS addressEncrypted,address_nonce AS addressNonce,address_tag AS addressTag,phone_encrypted AS phoneEncrypted,phone_nonce AS phoneNonce,phone_tag AS phoneTag,photo_file_name AS photoFileName,photo_avatar_id AS photoAvatarId FROM cook_profiles WHERE user_id=?`).get(user.id);if(!c)return send(res,404,{error:'Cook profile not found.'});
      try{return send(res,200,{profile:{id:c.id,name:c.name,verificationStatus:c.verificationStatus,yearsExperience:c.yearsExperience,specialties:JSON.parse(c.specialties||'[]'),bio:c.bio,address:decryptSensitiveText(c.addressEncrypted,c.addressNonce,c.addressTag),phone:decryptSensitiveText(c.phoneEncrypted,c.phoneNonce,c.phoneTag),photoAvailable:Boolean(c.photoFileName),photoAvatarId:c.photoAvatarId||'sage'}})}catch{return send(res,500,{error:'Could not read your cook profile. Check the document encryption key.'})}
    }
    if(req.method==='PUT'&&url.pathname==='/api/cook/profile'){
      if(!requireRole(user,['cook'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const name=String(body.name||'').trim(),address=String(body.address||'').trim(),phone=String(body.phone||'').trim(),years=Number(body.yearsExperience),bio=String(body.bio||'').trim();
      if(name.length<2||name.length>80||address.length<10||address.length>500||!/^[+\d][\d\s().-]{8,19}$/.test(phone)||!Number.isInteger(years)||years<0||years>60||bio.length>1500)return send(res,400,{error:'Check your name, address, phone, professional experience, and profile summary.'});
      const specialties=Array.isArray(body.specialties)?body.specialties.map(x=>String(x).trim().slice(0,50)).filter(Boolean).slice(0,10):[];let a,p;try{a=encryptSensitiveText(address);p=encryptSensitiveText(phone)}catch(e){return send(res,503,{error:e.message})}
      const c=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);if(!c)return send(res,404,{error:'Cook profile not found.'});sql.prepare('UPDATE cook_profiles SET name=?,years_experience=?,specialties=?,bio=?,address=?,phone=?,address_encrypted=?,address_nonce=?,address_tag=?,phone_encrypted=?,phone_nonce=?,phone_tag=? WHERE id=?').run(name,years,JSON.stringify(specialties),bio,'','',a.encrypted,a.nonce,a.authTag,p.encrypted,p.nonce,p.authTag,c.id);sql.prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);queueAdminDirectorySync();return send(res,200,{ok:true});
    }
    if(req.method==='PUT'&&url.pathname==='/api/cook/profile/avatar'){
      if(!requireRole(user,['cook'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const allowed=['sage','sunshine','tomato','lavender'];if(!allowed.includes(String(body.avatarId||'')))return send(res,400,{error:'Choose one of the available default avatars.'});
      sql.prepare("UPDATE cook_profiles SET photo_avatar_id=?,photo_file_name=NULL,photo_mime_type=NULL,photo_encrypted=NULL,photo_nonce=NULL,photo_tag=NULL WHERE user_id=?").run(body.avatarId,user.id);return send(res,200,{ok:true,avatarId:body.avatarId});
    }
    if(req.method==='GET'&&url.pathname==='/api/cook/profile/photo'){
      if(!requireRole(user,['cook'],res))return;const c=sql.prepare('SELECT photo_file_name AS fileName,photo_mime_type AS mimeType,photo_encrypted AS encrypted,photo_nonce AS nonce,photo_tag AS authTag FROM cook_profiles WHERE user_id=?').get(user.id);if(!c||!c.encrypted)return send(res,404,{error:'No profile photo has been uploaded.'});try{const bytes=decryptCookDocument({file_name:c.fileName,mime_type:c.mimeType,encrypted_data:c.encrypted,nonce:c.nonce,auth_tag:c.authTag});return send(res,200,{fileName:c.fileName,mimeType:c.mimeType,data:bytes.toString('base64')})}catch{return send(res,500,{error:'Could not decrypt your photo. Check the document encryption key.'})}
    }
    if(req.method==='PUT'&&url.pathname==='/api/cook/profile/photo'){
      if(!requireRole(user,['cook'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}if(!['image/jpeg','image/png'].includes(body.mimeType))return send(res,400,{error:'Choose a JPEG or PNG profile picture.'});let image;try{image=encryptCookDocument(body)}catch(e){return send(res,400,{error:e.message})}if(image.encrypted.length>2*1024*1024)return send(res,400,{error:'Profile photos must be 2 MB or smaller.'});try{sql.prepare('UPDATE cook_profiles SET photo_file_name=?,photo_mime_type=?,photo_encrypted=?,photo_nonce=?,photo_tag=? WHERE user_id=?').run(image.fileName,image.mimeType,image.encrypted,image.nonce,image.authTag,user.id)}catch(e){console.error('Could not save cook profile photo:',e.message);return send(res,500,{error:'Could not save the profile photo. Please restart CookCircle and try again.'})}return send(res,200,{ok:true});
    }
    if(req.method==='DELETE'&&url.pathname==='/api/cook/profile/photo'){
      if(!requireRole(user,['cook'],res))return;sql.prepare("UPDATE cook_profiles SET photo_file_name=NULL,photo_mime_type=NULL,photo_encrypted=NULL,photo_nonce=NULL,photo_tag=NULL,photo_avatar_id='sage' WHERE user_id=?").run(user.id);return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/cook/overview') {
      if (!requireRole(user,['cook'],res)) return;
      const cook=sql.prepare('SELECT id,name,verification_status AS verificationStatus,specialties FROM cook_profiles WHERE user_id=?').get(user.id);
      if(!cook)return send(res,404,{error:'Cook application not found.'});
      if(cook.verificationStatus==='approved'){
        const mismatched=sql.prepare(`SELECT b.id,h.society_id AS societyId FROM bookings b JOIN households h ON h.user_id=b.user_id WHERE b.cook_profile_id IS NULL AND b.status='Confirmed' AND b.payment_status IN ('simulated-paid','credit-applied') AND b.society_id<>h.society_id AND b.date>=date('now')`).all();
        for(const booking of mismatched){sql.prepare("UPDATE bookings SET society_id=? WHERE id=? AND cook_profile_id IS NULL AND status='Confirmed'").run(booking.societyId,booking.id);sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND status='pending'").run(new Date().toISOString(),booking.id)}
        const missed=sql.prepare(`SELECT b.id FROM bookings b JOIN cook_service_societies a ON a.cook_id=? AND a.society_id=b.society_id AND a.status='approved' WHERE b.cook_profile_id IS NULL AND b.status='Confirmed' AND b.payment_status IN ('simulated-paid','credit-applied') AND b.date>=date('now') AND NOT EXISTS(SELECT 1 FROM booking_cook_offers o WHERE o.booking_id=b.id AND o.cook_id=?)`).all(cook.id,cook.id);
        for(const booking of missed)autoAssignBooking(booking.id);
      }
      cook.serviceSocieties=sql.prepare(`SELECT s.id,s.name,s.city FROM cook_service_societies a JOIN societies s ON s.id=a.society_id WHERE a.cook_id=? AND a.status='approved' AND s.is_active=1 ORDER BY s.name`).all(cook.id);
      const bookings=sql.prepare(`SELECT b.id,b.date,b.slot,b.meal,b.cook_profile_id AS cookProfileId,society.name AS societyName,
        CASE WHEN offer.status='pending' THEN 'Request pending' ELSE b.status END AS status,
        offer.status AS offerStatus,b.cook,
        CASE WHEN b.cook_profile_id=? THEN b.people ELSE '' END AS people,
        CASE WHEN b.cook_profile_id=? THEN b.instructions ELSE '' END AS instructions,
        CASE WHEN b.cook_profile_id=? THEN u.name ELSE 'New booking request' END AS household,
        CASE WHEN b.cook_profile_id=? THEN u.apartment ELSE '' END AS apartment,
        CASE WHEN b.cook_profile_id=? THEN h.phone_encrypted ELSE NULL END AS householdPhoneEncrypted,
        CASE WHEN b.cook_profile_id=? THEN h.phone_nonce ELSE NULL END AS householdPhoneNonce,
        CASE WHEN b.cook_profile_id=? THEN h.phone_tag ELSE NULL END AS householdPhoneTag
        FROM bookings b JOIN users u ON u.id=b.user_id
        LEFT JOIN households h ON h.user_id=b.user_id
        LEFT JOIN booking_cook_offers offer ON offer.booking_id=b.id AND offer.cook_id=?
        LEFT JOIN cook_service_societies area ON area.cook_id=? AND area.society_id=b.society_id AND area.status='approved'
        JOIN societies society ON society.id=b.society_id AND society.is_active=1
        WHERE (b.cook_profile_id=? OR (offer.status='pending' AND area.cook_id IS NOT NULL AND b.status='Confirmed' AND b.payment_status IN ('simulated-paid','credit-applied')))
          AND b.status NOT IN ('Cancelled','Refunded') ORDER BY b.date,b.slot`).all(cook.id,cook.id,cook.id,cook.id,cook.id,cook.id,cook.id,cook.id,cook.id,cook.id).map(b=>{
            const assignedToCook=b.cookProfileId===cook.id;
            const householdPhone=assignedToCook?decryptSensitiveText(b.householdPhoneEncrypted,b.householdPhoneNonce,b.householdPhoneTag):'';
            const {householdPhoneEncrypted,householdPhoneNonce,householdPhoneTag,...booking}=b;
            return {...booking,householdPhone};
          });
      return send(res,200,{cook,bookings});
    }
    if(req.method==='GET'&&url.pathname==='/api/cook/earnings'){
      if(!requireRole(user,['cook'],res))return;const c=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);if(!c)return send(res,404,{error:'Cook profile not found.'});
      const payouts=sql.prepare('SELECT p.id,p.amount_paise AS amountPaise,p.status,p.created_at AS createdAt,b.date,b.meal FROM cook_payouts p LEFT JOIN bookings b ON b.id=p.booking_id WHERE p.cook_id=? ORDER BY p.created_at DESC').all(c.id);
      const eligible=sql.prepare(`SELECT p.id,p.amount_paise AS amountPaise FROM cook_payouts p WHERE p.cook_id=? AND p.status='pending' AND NOT EXISTS(SELECT 1 FROM cook_cashout_items i JOIN cook_cashouts x ON x.id=i.cashout_id WHERE i.payout_id=p.id AND x.status IN ('requested','paid'))`).all(c.id);
      return send(res,200,{payouts,totalPaise:payouts.reduce((n,p)=>n+p.amountPaise,0),availablePaise:eligible.reduce((n,p)=>n+p.amountPaise,0),cashouts:sql.prepare('SELECT id,amount_paise AS amountPaise,status,created_at AS createdAt FROM cook_cashouts WHERE cook_id=? ORDER BY created_at DESC').all(c.id)});
    }
    if(req.method==='POST'&&url.pathname==='/api/cook/cashout'){
      if(!requireRole(user,['cook'],res))return;const c=sql.prepare('SELECT id,verification_status AS verificationStatus FROM cook_profiles WHERE user_id=?').get(user.id);if(!c)return send(res,404,{error:'Cook profile not found.'});if(c.verificationStatus!=='approved')return send(res,403,{error:'Only approved cooks can request a cash out.'});
      const payouts=sql.prepare(`SELECT p.id,p.amount_paise FROM cook_payouts p WHERE p.cook_id=? AND p.status='pending' AND NOT EXISTS(SELECT 1 FROM cook_cashout_items i JOIN cook_cashouts x ON x.id=i.cashout_id WHERE i.payout_id=p.id AND x.status IN ('requested','paid'))`).all(c.id);const amount=payouts.reduce((n,p)=>n+p.amount_paise,0);if(amount<=0)return send(res,400,{error:'There is no available completed-service balance to cash out yet.'});
      const id=crypto.randomUUID(),now=new Date().toISOString();sql.exec('BEGIN IMMEDIATE');try{sql.prepare('INSERT INTO cook_cashouts(id,cook_id,amount_paise,status,created_at) VALUES(?,?,?,?,?)').run(id,c.id,amount,'requested',now);const add=sql.prepare('INSERT INTO cook_cashout_items(cashout_id,payout_id,amount_paise) VALUES(?,?,?)');for(const p of payouts)add.run(id,p.id,p.amount_paise);sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');return send(res,500,{error:'Could not save cash-out request.'})}
      return send(res,201,{cashout:{id,amountPaise:amount,status:'requested',simulated:true}});
    }
    if(req.method==='GET'&&url.pathname==='/api/cook/availability'){
      if(!requireRole(user,['cook'],res))return;const cook=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);if(!cook)return send(res,404,{error:'Cook profile not found.'});const date=url.searchParams.get('date');if(!dateAllowed(date))return send(res,400,{error:'Choose a date within the next seven days.'});
      const personal=new Set(sql.prepare('SELECT slot FROM cook_availability WHERE cook_id=? AND date=? AND available=0').all(cook.id,date).map(x=>x.slot)),booked=new Set(sql.prepare("SELECT slot FROM bookings WHERE cook_profile_id=? AND date=? AND status NOT IN ('Cancelled','Refunded')").all(cook.id,date).map(x=>x.slot));return send(res,200,{date,slots:slots.map(slot=>{const isBooked=booked.has(slot),unavailableByCook=personal.has(slot);return {slot,available:!unavailableByCook&&!isBooked,unavailableByCook,booked:isBooked}})});
    }
    if(req.method==='PUT'&&url.pathname==='/api/cook/availability'){
      if(!requireRole(user,['cook'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const cook=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);if(!cook)return send(res,404,{error:'Cook profile not found.'});if(!dateAllowed(body.date)||!slots.includes(body.slot))return send(res,400,{error:'Choose a valid date and session.'});if(sql.prepare("SELECT 1 FROM bookings WHERE cook_profile_id=? AND date=? AND slot=? AND status NOT IN ('Cancelled','Refunded')").get(cook.id,body.date,body.slot))return send(res,409,{error:'This session already has an assigned visit.'});
      sql.prepare('INSERT INTO cook_availability(id,cook_id,date,slot,available) VALUES(?,?,?,?,?) ON CONFLICT(cook_id,date,slot) DO UPDATE SET available=excluded.available').run(crypto.randomUUID(),cook.id,body.date,body.slot,body.available?1:0);return send(res,200,{ok:true});
    }
    const cookBooking=url.pathname.match(/^\/api\/cook\/bookings\/([^/]+)\/status$/);
    if(req.method==='POST'&&cookBooking){
      if(!requireRole(user,['cook'],res))return;
      let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const cook=sql.prepare('SELECT id,name,verification_status AS verificationStatus,is_active AS isActive FROM cook_profiles WHERE user_id=?').get(user.id);
      if(!cook||cook.verificationStatus!=='approved'||!cook.isActive)return send(res,403,{error:'Your cook profile must be approved and active before accepting bookings.'});
      const booking=sql.prepare('SELECT id,user_id,society_id,date,slot,status,service_otp_hash AS otpHash,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(cookBooking[1]);if(!booking)return send(res,404,{error:'Booking not found.'});
      const transitions={accept:['Requested','Cook assigned'],reject:['Request declined'],enroute:['Cook en route'],checkin:['Checked in'],start:['In progress'],complete:['Completed'],unavailable:['Backup required']};const transition=transitions[body.action];if(!transition)return send(res,400,{error:'Choose a supported booking action.'});
      if(body.action==='accept'||body.action==='reject'){
        const offer=sql.prepare('SELECT status FROM booking_cook_offers WHERE booking_id=? AND cook_id=?').get(booking.id,cook.id);
        if(offer){
          if(offer.status!=='pending')return send(res,409,{error:'This request has already been answered.'});
          const serves=sql.prepare("SELECT 1 FROM cook_service_societies a JOIN societies s ON s.id=a.society_id AND s.is_active=1 WHERE a.cook_id=? AND a.society_id=? AND a.status='approved'").get(cook.id,booking.society_id);
          if(!serves)return send(res,403,{error:'This society is not currently approved for your cook account.'});
          const now=new Date().toISOString();
          if(body.action==='reject'){
            const declined=sql.prepare("UPDATE booking_cook_offers SET status='rejected',responded_at=? WHERE booking_id=? AND cook_id=? AND status='pending'").run(now,booking.id,cook.id);
            if(!declined.changes)return send(res,409,{error:'This request is no longer available.'});
            const bookingClosed=closeBookingAfterAllCookDeclines(booking.id);
            return send(res,200,{ok:true,declined:true,bookingClosed});
          }
          const paid=sql.prepare("SELECT 1 FROM bookings WHERE id=? AND payment_status IN ('simulated-paid','credit-applied')").get(booking.id);
          if(!paid)return send(res,409,{error:'This booking is not yet paid or covered by a session credit.'});
          if(findAvailableCooks(booking.society_id,booking.date,booking.slot).every(candidate=>candidate.id!==cook.id))return send(res,409,{error:'You are no longer available for this session.'});
          const claimed=sql.prepare("UPDATE bookings SET status='Cook assigned',cook=?,cook_profile_id=? WHERE id=? AND cook_profile_id IS NULL AND status='Confirmed'").run(`Cook · ${cook.name}`,cook.id,booking.id);
          if(!claimed.changes)return send(res,409,{error:'Another cook has already accepted this request.'});
          sql.prepare("UPDATE booking_cook_offers SET status=CASE WHEN cook_id=? THEN 'accepted' ELSE 'expired' END,responded_at=? WHERE booking_id=? AND status='pending'").run(cook.id,now,booking.id);
          sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE cook_id=? AND status='pending' AND booking_id IN (SELECT id FROM bookings WHERE date=? AND slot=? AND cook_profile_id IS NULL)").run(now,cook.id,booking.date,booking.slot);
          sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),booking.id,'Cook assigned','Accepted by cook',now);
          sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),booking.user_id,booking.id,'booking_status',`Booking accepted by ${cook.name}.`,now);
          return send(res,200,{ok:true,accepted:true});
        }
        if(body.action==='reject')return send(res,404,{error:'This request is no longer available.'});
        if(booking.status!=='Confirmed'||booking.cookProfileId!==cook.id)return send(res,409,{error:'This booking is no longer available.'});setBookingStatus(booking.id,'Cook assigned','Accepted by cook',cook.id);
      }
      else{const owned=sql.prepare('SELECT id FROM bookings WHERE id=? AND cook_profile_id=?').get(booking.id,cook.id);if(!owned)return send(res,403,{error:'This booking is not assigned to you.'});if(body.action==='checkin'){const supplied=crypto.createHash('sha256').update(String(body.otp||'')).digest('hex');if(!booking.otpHash||!crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(booking.otpHash,'hex')))return send(res,400,{error:'The customer check-in code is incorrect.'})}const next=transition[0];setBookingStatus(booking.id,next,'Cook updated the service status');if(body.action==='unavailable')sql.prepare('INSERT INTO backup_assignments(id,booking_id,primary_cook_id,status,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),booking.id,cook.id,'needed',new Date().toISOString())}
      return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/profile') {
      if(!requireRole(user,['customer'],res))return;
      return send(res,200,{profile:sql.prepare('SELECT h.household_name AS householdName,h.family_members AS familyMembers,h.cuisines,h.dietary_preferences AS dietaryPreferences,h.cooking_styles AS cookingStyles,h.instructions,h.allergies,s.name AS societyName,s.city AS societyCity FROM households h JOIN societies s ON s.id=h.society_id WHERE h.user_id=?').get(user.id)});
    }
    if (req.method === 'PUT' && url.pathname === '/api/profile') {
      if(!requireRole(user,['customer'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      sql.prepare('UPDATE households SET household_name=?,family_members=?,cuisines=?,dietary_preferences=?,cooking_styles=?,instructions=?,allergies=?,updated_at=? WHERE user_id=?')
        .run(String(body.householdName||'').trim().slice(0,80),Math.max(1,Math.min(20,Number(body.familyMembers)||1)),String(body.cuisines||'').slice(0,300),String(body.dietaryPreferences||'').slice(0,300),String(body.cookingStyles||'').slice(0,300),String(body.instructions||'').slice(0,1000),String(body.allergies||'').slice(0,500),new Date().toISOString(),user.id);
      queueAdminDirectorySync();
      return send(res,200,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
      if(!requireRole(user,['customer'],res))return;const now=new Date(),end=new Date(now);end.setDate(end.getDate()+30);const id=crypto.randomUUID();
      sql.prepare('INSERT INTO subscriptions(id,user_id,plan_name,price_paise,included_credits,remaining_credits,status,starts_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,user.id,'5-session pack',399900,5,5,'active',now.toISOString(),end.toISOString(),now.toISOString());
      sql.prepare('INSERT INTO payments(id,user_id,amount_paise,status,provider,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),user.id,399900,'simulated-paid','simulated',now.toISOString());
      sql.prepare('INSERT INTO credit_ledger(id,user_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),user.id,id,5,'5-session pack purchased in demo mode',now.toISOString());
      return send(res,201,{subscription:{id,planName:'5-session pack',pricePaise:399900,remainingCredits:5,status:'active',simulatedPayment:true}});
    }
    if (req.method === 'GET' && url.pathname === '/api/subscriptions/current') {
      if(!requireRole(user,['customer'],res))return;
      return send(res,200,{subscriptions:sql.prepare(`SELECT id,plan_name AS planName,price_paise AS pricePaise,included_credits AS includedCredits,remaining_credits AS remainingCredits,status,expires_at AS expiresAt FROM subscriptions WHERE user_id=? ORDER BY created_at DESC`).all(user.id)});
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications') {
      return send(res,200,{notifications:sql.prepare('SELECT id,kind,message,read_at AS readAt,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(user.id)});
    }
    if(req.method==='GET'&&url.pathname==='/api/payments'){
      if(!requireRole(user,['customer'],res))return;return send(res,200,{payments:sql.prepare('SELECT p.id,p.booking_id AS bookingId,p.amount_paise AS amountPaise,p.status,p.provider,p.created_at AS createdAt,b.meal,b.date AS sessionDate FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id WHERE p.user_id=? ORDER BY p.created_at DESC').all(user.id)});
    }
    if (req.method === 'POST' && url.pathname === '/api/complaints') {
      if(!requireRole(user,['customer'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const bookingId=String(body.bookingId||'');if(bookingId&&!sql.prepare('SELECT id FROM bookings WHERE id=? AND user_id=?').get(bookingId,user.id))return send(res,404,{error:'Booking not found.'});
      const id=crypto.randomUUID();sql.prepare('INSERT INTO complaints(id,user_id,booking_id,category,details,created_at) VALUES(?,?,?,?,?,?)').run(id,user.id,bookingId||null,String(body.category||'Other').slice(0,60),String(body.details||'').slice(0,2000),new Date().toISOString());return send(res,201,{id,status:'open'});
    }
    const customerBooking=url.pathname.match(/^\/api\/bookings\/([^/]+)\/(cancel|pay|review)$/);
    if(req.method==='POST'&&customerBooking){
      if(!requireRole(user,['customer'],res))return;const [_,id,action]=customerBooking;const booking=sql.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').get(id,user.id);if(!booking)return send(res,404,{error:'Booking not found.'});
      let body={};try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      if(action==='cancel'){if(['Completed','Cancelled','Refunded','No cook available'].includes(booking.status))return send(res,409,{error:'This booking can no longer be cancelled.'});if(booking.payment_status==='credit-applied'&&booking.subscription_id){sql.prepare('UPDATE subscriptions SET remaining_credits=remaining_credits+1 WHERE id=?').run(booking.subscription_id);sql.prepare('INSERT INTO credit_ledger(id,user_id,booking_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),user.id,id,booking.subscription_id,1,'Cancelled booking credit returned',new Date().toISOString())}setBookingStatus(id,'Cancelled','Cancelled by customer');const pay=sql.prepare("SELECT id,amount_paise FROM payments WHERE booking_id=? AND status='simulated-paid'").get(id);if(pay){sql.prepare("UPDATE payments SET status='refund-pending' WHERE id=?").run(pay.id);sql.prepare('INSERT INTO refunds(id,payment_id,amount_paise,status,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),pay.id,pay.amount_paise,'pending','Customer cancellation in demo mode',new Date().toISOString())}return send(res,200,{ok:true,refundPolicy:'Demo cancellation; no real payment was collected.'})}
            if(action==='pay'){if(booking.payment_status!=='unpaid-demo')return send(res,409,{error:'This booking has already been paid or confirmed.'});sql.prepare("UPDATE bookings SET payment_status='simulated-paid' WHERE id=?").run(id);sql.prepare("UPDATE payments SET status='simulated-paid',provider_reference=? WHERE booking_id=?").run(`SIM-${crypto.randomUUID()}`,id);setBookingStatus(id,'Confirmed','Simulated payment successful');const requestCount=autoAssignBooking(id),bookingClosed=requestCount===0?closeBookingAfterAllCookDeclines(id,'unavailable'):false;return send(res,200,{ok:true,simulated:true,requestsSent:requestCount,bookingClosed,message:bookingClosed?'No approved cook was available for this session. The demo payment has been marked for refund.':''})}
      if(action==='review'){if(booking.status!=='Completed')return send(res,409,{error:'You can review a booking after service completion.'});const rating=Math.max(1,Math.min(5,Number(body.rating)||0));try{sql.prepare('INSERT INTO reviews(id,booking_id,user_id,cook_id,rating,comment,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,user.id,booking.cook_profile_id,rating,String(body.comment||'').slice(0,1000),new Date().toISOString());return send(res,201,{ok:true})}catch{return send(res,409,{error:'A review already exists for this booking.'})}}
    }
    if (req.method === 'GET' && url.pathname === '/api/me') { const profile=user.role==='cook'?sql.prepare('SELECT is_active AS isActive FROM cook_profiles WHERE user_id=?').get(user.id):null; return send(res,200,{user:{...cleanUser(user),...(user.role==='cook'?{cookRemoved:!profile||!profile.isActive}:{})}}); }
    if (req.method === 'GET' && url.pathname === '/api/availability') {
      if(!requireRole(user,['customer'],res))return;
      const date = url.searchParams.get('date'); if (!dateAllowed(date)) return send(res, 400, { error: 'Choose a date within the next seven days.' });
      const day = new Date(`${date}T00:00:00`); const sameDay = new Date().toISOString().slice(0, 10) === date;
      const household=sql.prepare('SELECT society_id AS societyId FROM households WHERE user_id=?').get(user.id);if(!household)return send(res,409,{error:'Your household profile needs a registered society before you can book.'});
      return send(res, 200, { date, slots: slots.map((time, i) => ({ time, available: day.getDay() !== 0 && !(sameDay && i < 3) && Boolean(findAvailableCook(household.societyId,date,time)) })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/bookings') {
      if(!requireRole(user,['customer'],res))return;
      const codeRows=sql.prepare("SELECT booking_id AS bookingId,message FROM notifications WHERE user_id=? AND kind='booking_requested' AND booking_id IS NOT NULL").all(user.id);
      const checkinCodes=new Map(codeRows.map(n=>[n.bookingId,(String(n.message||'').match(/check-in code is (\d{6})/)||[])[1]||'']));
      const bookings = sql.prepare(`SELECT b.id,b.user_id AS userId,b.society_id AS societyId,b.date,b.slot,b.meal,b.people,b.instructions,b.cook,b.price_paise AS pricePaise,b.payment_status AS paymentStatus,b.status,b.created_at AS createdAt,b.subscription_id AS subscriptionId,b.cook_profile_id AS cookProfileId,c.name AS assignedCookName,c.phone AS legacyCookPhone,c.phone_encrypted AS cookPhoneEncrypted,c.phone_nonce AS cookPhoneNonce,c.phone_tag AS cookPhoneTag FROM bookings b LEFT JOIN cook_profiles c ON c.id=b.cook_profile_id WHERE b.user_id=? ORDER BY b.date,b.slot`).all(user.id).map(b=>{
        const {legacyCookPhone,cookPhoneEncrypted,cookPhoneNonce,cookPhoneTag,assignedCookName,...booking}=b;
        const mayContactCook=Boolean(b.cookProfileId)&&!['Cancelled','Refunded'].includes(b.status);let cookPhone='';
        if(mayContactCook)cookPhone=decryptSensitiveText(cookPhoneEncrypted,cookPhoneNonce,cookPhoneTag)||legacyCookPhone||'';
        return {...booking,cook:assignedCookName?`Cook · ${assignedCookName}`:b.cook,cookPhone,checkinCode:checkinCodes.get(b.id)||''};
      });
      return send(res, 200, { bookings });
    }
    if (req.method === 'POST' && url.pathname === '/api/bookings') {
      if(!requireRole(user,['customer'],res))return;
      let body; try { body = await getBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
      const household=sql.prepare('SELECT society_id AS societyId FROM households WHERE user_id=?').get(user.id);if(!household)return send(res,409,{error:'Your household profile needs a registered society before you can book.'});const societyId=household.societyId;
      if(!sql.prepare('SELECT id FROM societies WHERE id=? AND is_active=1').get(societyId))return send(res,403,{error:'Your society is no longer active on CookCircle. Contact the platform administrator.'});
      if (!dateAllowed(body.date) || !slots.includes(body.slot)) return send(res, 400, { error: 'Choose a valid available date and session.' });
      if (new Date(`${body.date}T00:00:00`).getDay() === 0 || !findAvailableCook(societyId,body.date,body.slot)) return send(res, 409, { error: 'No approved cook serving your society is available for that session. Please choose another time.' });
      const meal=String(body.meal||'Meal').slice(0,40),service=sql.prepare('SELECT base_price_paise AS price FROM service_categories WHERE name=? AND active=1').get(meal);if(!service)return send(res,400,{error:'This service is currently unavailable.'});const pricePaise=service.price;let paymentStatus='unpaid-demo',status='Requested',subscriptionId=null;
      if(body.paymentMethod==='credit'){const sub=sql.prepare("SELECT id FROM subscriptions WHERE user_id=? AND status='active' AND remaining_credits>0 AND expires_at>=? ORDER BY expires_at LIMIT 1").get(user.id,new Date().toISOString());if(!sub)return send(res,400,{error:'No valid meal-pack credits are available.'});subscriptionId=sub.id;sql.prepare('UPDATE subscriptions SET remaining_credits=remaining_credits-1 WHERE id=?').run(sub.id);sql.prepare('INSERT INTO credit_ledger(id,user_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),user.id,sub.id,-1,'Credit reserved for cooking session',new Date().toISOString());paymentStatus='credit-applied';status='Confirmed'}
      const checkinCode=String(crypto.randomInt(100000,1000000));const serviceOtpHash=crypto.createHash('sha256').update(checkinCode).digest('hex');
      const booking = { id: `CC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, userId: user.id, societyId, date: body.date, slot: body.slot, meal, people: String(body.people || '').slice(0, 30), instructions: String(body.instructions || '').slice(0, 500), cook: 'Awaiting cook assignment', pricePaise, paymentStatus, status, subscriptionId, serviceOtpHash, checkinCode, createdAt: new Date().toISOString() };
      insertBooking(booking);const requestCount=paymentStatus==='credit-applied'?autoAssignBooking(booking.id):null,bookingClosed=paymentStatus==='credit-applied'&&requestCount===0?closeBookingAfterAllCookDeclines(booking.id,'unavailable'):false;const saved=sql.prepare('SELECT status,cook,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(booking.id);const assignmentMessage=bookingClosed?'No approved cook was available for this session. Your session credit has been returned.':paymentStatus==='credit-applied'?`Your request was sent to ${requestCount} approved cook${requestCount===1?'':'s'} serving your society.`:'Your booking is saved; matching cooks will receive it after payment.';return send(res, 201, { booking:{...booking,...saved,requestCount,assignmentMessage} });
    }
    return send(res, 404, { error: 'API route not found.' });
  }
  return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error('CookCircle request failed:', error && (error.stack || error.message) || error);
    if (!res.headersSent) return send(res, 500, { error: 'The request could not be completed. Please try again.' });
    res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CookCircle is listening on port ${PORT}`);
  console.log(`Persistent SQLite database: ${DB_FILE}`);
});
