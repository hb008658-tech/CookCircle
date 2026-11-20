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
const LANDING_IMAGE_FILES = Object.freeze({
  "cookcircle-logo.webp": "cookcircle-logo.webp",
  "inline-01.jpg": "assets/cookcircle-inline-01.jpg",
  "inline-02.jpg": "An authentic Indian home meal on a real dining-kitchen table, with subtle signs of a lived-in home. No restaurant plating..jpg",
  "inline-03.webp": "A very appetizing plate-bowl of rajma chawal or another recognizably homemade Indian comfort.webp",
  "inline-04.webp": "Indian apartment-society environment with a sense of neighbouring homes-community..webp",
  "inline-05.webp": "a cook\u2019s hands at the stove.webp",
  "inline-06.webp": "indian-woman-cooking-kitchen-making-delicious-food-wearing-sari-apron_926199-4307338.webp",
  "inline-07.webp": "assets/cookcircle-inline-07.webp",
  "inline-08.webp": "Several genuinely Indian homemade dishes together- dal, sabzi, rice-roti, etc..webp",
  "inline-09.webp": "A family dinner.webp",
  "inline-10.jpg": "A visually interesting assortment of homemade Indian foods that can support categories such as comfort food, Sunday lunch, spicy food, lunch for work..jpg.jpg",
});
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
  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recurring_plans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), society_id TEXT NOT NULL REFERENCES societies(id),
    frequency TEXT NOT NULL, weekdays TEXT NOT NULL, slot TEXT NOT NULL, duration_minutes INTEGER NOT NULL,
    meal TEXT NOT NULL, people TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', dishes TEXT NOT NULL DEFAULT '[]',
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    preferred_cook_id TEXT REFERENCES cook_profiles(id), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS household_routines (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom',
    meal TEXT NOT NULL DEFAULT 'Lunch', people TEXT NOT NULL DEFAULT '', duration_minutes INTEGER NOT NULL DEFAULT 120,
    dishes TEXT NOT NULL DEFAULT '[]', instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS household_away_periods (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, cancelled_at TEXT
  );
  CREATE TABLE IF NOT EXISTS booking_extensions (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), requested_by TEXT NOT NULL REFERENCES users(id),
    minutes INTEGER NOT NULL, price_paise INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'requested',
    created_at TEXT NOT NULL, responded_at TEXT
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
// Booking models, durations and cluster allocation. Older bookings keep NULL duration (treated as the original 2-hour session).
ensureColumn('bookings', 'duration_minutes', 'INTEGER');
ensureColumn('bookings', 'booking_type', "TEXT NOT NULL DEFAULT 'on_demand'");
ensureColumn('bookings', 'plan_id', 'TEXT');
ensureColumn('bookings', 'fulfilment', 'TEXT');
ensureColumn('bookings', 'visit_start', 'TEXT');
ensureColumn('bookings', 'dishes', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('bookings', 'estimate_minutes', 'INTEGER');
ensureColumn('bookings', 'paused_for_away', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('households', 'spice_level', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'oil_preference', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'regular_dishes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'roti_requirements', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'kitchen_equipment', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'other_instructions', "TEXT NOT NULL DEFAULT ''");
ensureColumn('households', 'share_brief', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('households', 'routines_seeded', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('cook_profiles', 'preferred_language', "TEXT NOT NULL DEFAULT 'en'");
// One generated session per plan and date; sessions paused for Away Mode leave the index so the date can resume.
sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS bookings_plan_date_active ON bookings(plan_id,date) WHERE plan_id IS NOT NULL AND paused_for_away=0');

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
  sql.prepare('INSERT INTO bookings(id,user_id,society_id,date,slot,meal,people,instructions,cook,price_paise,payment_status,status,created_at,subscription_id,service_otp_hash,duration_minutes,booking_type,plan_id,dishes,estimate_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.id,b.userId,b.societyId,b.date,b.slot,b.meal,b.people,b.instructions,b.cook,b.pricePaise,b.paymentStatus,b.status,b.createdAt,b.subscriptionId||null,b.serviceOtpHash||null,b.durationMinutes||null,b.bookingType||'on_demand',b.planId||null,JSON.stringify(b.dishes||[]),b.estimateMinutes||null);
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)')
    .run(crypto.randomUUID(),b.id,b.status,'Booking request created',b.createdAt);
  sql.prepare('INSERT INTO payments(id,booking_id,user_id,amount_paise,status,provider,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(),b.id,b.userId,b.pricePaise,b.paymentStatus,b.paymentProvider||'simulated',b.createdAt);
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
// ---- Session timing, pricing and cook allocation ----
// A slot is the household's arrival window. A visit of the booked duration starts inside that window
// (or at its start when the visit is longer than the window). Visits in the same society can run
// back-to-back, which is how one cook serves a cluster of nearby households; moving between
// societies needs a travel buffer.
const BOOKING_DURATIONS = [60, 90, 120, 150, 180, 240];
const LEGACY_DURATION_MINUTES = 120;
const TRAVEL_BUFFER_MINUTES = 30;
const CLUSTER_GAP_MINUTES = 30;
const LAST_VISIT_END_MINUTES = 22 * 60;
const CREDIT_MAX_MINUTES = 120;
const OPEN_BOOKING_STATUSES = "('Cancelled','Refunded','No cook available')";
function toMinutes(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; }
function toClock(minutes) { return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }
function slotWindow(slot) { const [start, end] = String(slot).split('–'); return { start: toMinutes(start), end: toMinutes(end) }; }
function bookingDuration(row) { return Number(row.duration_minutes || row.durationMinutes) || LEGACY_DURATION_MINUTES; }
function hourlyRatePaise() {
  const row = sql.prepare("SELECT value FROM platform_settings WHERE key='hourly_rate_paise'").get();
  const value = Number(row && row.value);
  return Number.isInteger(value) && value > 0 ? value : 20000;
}
function priceForMinutes(minutes) { return Math.round(hourlyRatePaise() * minutes / 60); }
// The cook's committed time on a date: assigned visits plus sessions the cook marked unavailable.
function cookDayIntervals(cookId, date, excludeBookingId = null) {
  const visits = sql.prepare(`SELECT id,society_id AS societyId,slot,visit_start AS visitStart,duration_minutes AS durationMinutes FROM bookings
    WHERE cook_profile_id=? AND date=? AND status NOT IN ${OPEN_BOOKING_STATUSES}`).all(cookId, date)
    .filter(b => b.id !== excludeBookingId)
    .map(b => { const start = b.visitStart ? toMinutes(b.visitStart) : slotWindow(b.slot).start; return { start, end: start + bookingDuration(b), societyId: b.societyId, bookingId: b.id }; });
  const blocked = sql.prepare('SELECT slot FROM cook_availability WHERE cook_id=? AND date=? AND available=0').all(cookId, date)
    .map(a => ({ ...slotWindow(a.slot), societyId: null, blocked: true }));
  return [...visits, ...blocked];
}
// Earliest start inside the window that fits the cook's day, or null.
function feasibleVisit(intervals, slot, durationMinutes, societyId) {
  const window = slotWindow(slot), latest = Math.max(window.start, window.end - durationMinutes);
  for (let start = window.start; start <= latest; start += 30) {
    const end = start + durationMinutes;
    if (end > LAST_VISIT_END_MINUTES) return null;
    const clash = intervals.some(iv => {
      const buffer = iv.blocked || iv.societyId === societyId ? 0 : TRAVEL_BUFFER_MINUTES;
      return start < iv.end + buffer && iv.start < end + buffer;
    });
    if (!clash) {
      const cluster = intervals.some(iv => !iv.blocked && iv.societyId === societyId && (Math.abs(start - iv.end) <= CLUSTER_GAP_MINUTES || Math.abs(iv.start - end) <= CLUSTER_GAP_MINUTES));
      return { visitStart: toClock(start), fulfilment: cluster ? 'cluster' : 'individual' };
    }
  }
  return null;
}
function findAvailableCooks(societyId, date, slot, durationMinutes = LEGACY_DURATION_MINUTES, excludeBookingId = null) {
  const candidates = sql.prepare(`SELECT c.id,c.name,c.user_id AS userId,c.created_at AS createdAt
    FROM cook_profiles c
    JOIN cook_service_societies area ON area.cook_id=c.id AND area.society_id=? AND area.status='approved'
    JOIN societies s ON s.id=area.society_id AND s.is_active=1
    WHERE c.verification_status='approved' AND c.is_active=1 AND c.user_id IS NOT NULL`).all(societyId);
  const available = [];
  for (const cook of candidates) {
    const intervals = cookDayIntervals(cook.id, date, excludeBookingId);
    const visit = feasibleVisit(intervals, slot, durationMinutes, societyId);
    if (visit) available.push({ ...cook, ...visit, load: intervals.filter(iv => !iv.blocked).length });
  }
  // Prefer cooks already working nearby (cluster), then the lightest day, then the longest-serving cook.
  return available.sort((a, b) => (a.fulfilment === 'cluster' ? 0 : 1) - (b.fulfilment === 'cluster' ? 0 : 1) || a.load - b.load || String(a.createdAt).localeCompare(String(b.createdAt)) || a.name.localeCompare(b.name));
}
function findAvailableCook(societyId, date, slot, durationMinutes) { return findAvailableCooks(societyId, date, slot, durationMinutes)[0] || null; }
function autoAssignBooking(bookingId, { broadcast = false } = {}) {
  const booking = sql.prepare('SELECT id,society_id AS societyId,date,slot,status,duration_minutes AS durationMinutes,plan_id AS planId,payment_status AS paymentStatus,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(bookingId);
  if (!booking || !['simulated-paid', 'credit-applied'].includes(booking.paymentStatus) || booking.cookProfileId || booking.status !== 'Confirmed') return null;
  let cooks = findAvailableCooks(booking.societyId, booking.date, booking.slot, bookingDuration(booking)), now = new Date().toISOString();
  // Regular arrangements go to the household's usual cook first; others are asked if that cook declines or does not respond.
  if (!broadcast && booking.planId) {
    const plan = sql.prepare('SELECT preferred_cook_id AS preferredCookId FROM recurring_plans WHERE id=?').get(booking.planId);
    const preferred = plan && cooks.find(c => c.id === plan.preferredCookId);
    const alreadyAsked = preferred && sql.prepare('SELECT 1 FROM booking_cook_offers WHERE booking_id=? AND cook_id=?').get(booking.id, preferred.id);
    if (preferred && !alreadyAsked) cooks = [preferred];
  }
  // Offers that expired because another cook accepted are reopened when the booking is routed again;
  // declined or withdrawn offers stay closed so those cooks are not asked twice.
  const offer = sql.prepare("INSERT INTO booking_cook_offers(booking_id,cook_id,status,created_at) VALUES(?,?,'pending',?) ON CONFLICT(booking_id,cook_id) DO UPDATE SET status='pending',created_at=excluded.created_at,responded_at=NULL WHERE booking_cook_offers.status='expired'");
  const notify = sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)');
  let sent = 0;
  for (const cook of cooks) {
    const inserted = offer.run(booking.id, cook.id, now);
    if (inserted.changes) { sent++; if (cook.userId) notify.run(crypto.randomUUID(), cook.userId, booking.id, 'booking_request', `New ${booking.slot} ${booking.date} booking request for a society you are approved to serve. Open Requests to accept or decline.`, now); }
  }
  return sent;
}
// After a cook commits time, drop that cook's other requests that no longer fit the day.
function revalidatePendingOffersForCook(cookId, date) {
  const rows = sql.prepare("SELECT b.id,b.society_id AS societyId,b.slot,b.duration_minutes AS durationMinutes FROM booking_cook_offers o JOIN bookings b ON b.id=o.booking_id WHERE o.cook_id=? AND o.status='pending' AND b.date=?").all(cookId, date);
  const now = new Date().toISOString(); let withdrawn = 0;
  for (const b of rows) {
    if (feasibleVisit(cookDayIntervals(cookId, date), b.slot, bookingDuration(b), b.societyId)) continue;
    sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND cook_id=? AND status='pending'").run(now, b.id, cookId);
    if (!autoAssignBooking(b.id, { broadcast: true })) closeBookingAfterAllCookDeclines(b.id, 'unavailable');
    withdrawn++;
  }
  return withdrawn;
}
function closeBookingAfterAllCookDeclines(bookingId, outcome='declined') {
  const row=sql.prepare('SELECT user_id AS userId,subscription_id AS subscriptionId,payment_status AS paymentStatus FROM bookings WHERE id=? AND cook_profile_id IS NULL AND status=\'Confirmed\'').get(bookingId);
  if(!row)return false;
  // PostgreSQL returns COUNT(*) as text, so convert before testing for zero.
  const pending=Number(sql.prepare("SELECT COUNT(*) AS count FROM booking_cook_offers WHERE booking_id=? AND status='pending'").get(bookingId).count);
  const accepted=sql.prepare("SELECT 1 FROM booking_cook_offers WHERE booking_id=? AND status='accepted'").get(bookingId);
  if(pending||accepted)return false;
  const now=new Date().toISOString();
  const closed=sql.prepare("UPDATE bookings SET status='No cook available',cook='No cook booked' WHERE id=? AND cook_profile_id IS NULL AND status='Confirmed'").run(bookingId);
  if(!closed.changes)return false;
  const declined=outcome==='declined',noResponse=outcome==='no_response';
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),bookingId,'No cook available',declined?'All eligible cooks declined the request':noResponse?'No cook accepted before the session was due to start':'No approved cook was available when the request was sent',now);
  let apology=declined?'We’re sorry—all cooks approved for your society declined this request. No cook was booked.':noResponse?'We’re sorry—no cook accepted this request in time, so no cook was booked.':'We’re sorry, no approved cook was available for your society and session. No cook was booked.';
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
// Expire a cook's unanswered requests (optionally for one session) and close any request no other cook can still take.
function withdrawPendingOffersForCook(cookId,date=null,slot=null){
  const rows=date
    ?sql.prepare("SELECT o.booking_id AS bookingId FROM booking_cook_offers o JOIN bookings b ON b.id=o.booking_id WHERE o.cook_id=? AND o.status='pending' AND b.date=? AND b.slot=?").all(cookId,date,slot)
    :sql.prepare("SELECT booking_id AS bookingId FROM booking_cook_offers WHERE cook_id=? AND status='pending'").all(cookId);
  const now=new Date().toISOString();
  for(const {bookingId} of rows){
    sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND cook_id=? AND status='pending'").run(now,bookingId,cookId);
    closeBookingAfterAllCookDeclines(bookingId,'unavailable');
  }
  return rows.length;
}
// Release a booking the assigned cook can no longer serve and send it to the other eligible cooks.
function reopenBookingForOtherCooks(bookingId,cookId,note){
  const now=new Date().toISOString();
  const reopened=sql.prepare("UPDATE bookings SET status='Confirmed',cook='Awaiting cook assignment',cook_profile_id=NULL WHERE id=? AND cook_profile_id=? AND status IN ('Cook assigned','Replacement confirmed','Cook en route')").run(bookingId,cookId);
  if(!reopened.changes)return false;
  sql.prepare("INSERT OR IGNORE INTO booking_cook_offers(booking_id,cook_id,status,created_at) VALUES(?,?,'withdrawn',?)").run(bookingId,cookId,now);
  sql.prepare("UPDATE booking_cook_offers SET status='withdrawn',responded_at=? WHERE booking_id=? AND cook_id=?").run(now,bookingId,cookId);
  sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),bookingId,'Confirmed',note,now);
  const row=sql.prepare('SELECT user_id AS userId FROM bookings WHERE id=?').get(bookingId);
  if(row)sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),row.userId,bookingId,'booking_status','Your assigned cook can no longer make this session. We are asking other approved cooks in your society.',now);
  if(!autoAssignBooking(bookingId))closeBookingAfterAllCookDeclines(bookingId,'unavailable');
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
for(const booking of sql.prepare("SELECT id FROM bookings WHERE cook_profile_id IS NULL AND payment_status IN ('simulated-paid','credit-applied') AND status='Confirmed' ORDER BY created_at").all()){if(!autoAssignBooking(booking.id))closeBookingAfterAllCookDeclines(booking.id,'unavailable')}

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
function devEmailOutbox(){const file=String(process.env.COOKCIRCLE_DEV_EMAIL_OUTBOX||'').trim();return file&&!process.env.RENDER&&process.env.NODE_ENV!=='production'?file:''}
function emailCodeCopy(purpose,code){return purpose==='password_reset'?{subject:'Your CookCircle password reset code',text:'Your CookCircle password reset code is '+code+'. It expires in 10 minutes. If you did not ask to reset your password, ignore this email; your password has not changed.'}:{subject:'Your CookCircle verification code',text:'Your CookCircle verification code is '+code+'. It expires in 10 minutes. If you did not request it, ignore this email.'}}
async function sendGmailVerificationEmail(destination,code,purpose='signup'){
  const sender=String(process.env.GMAIL_API_SENDER||'').trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(sender))throw new Error('Gmail API sender address is not configured.');
  const token=await getGmailApiAccessToken();
  const copy=emailCodeCopy(purpose,code),message=['From: CookCircle <'+sender+'>','To: '+destination,'Subject: '+copy.subject,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',copy.text].join('\r\n');
  const raw=Buffer.from(message,'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){console.error('CookCircle Gmail API send failed:',response.status,payload.error?.status||payload.error?.message||'unknown error');throw new Error('Gmail API did not accept the message. Check Gmail API authorization and sender settings.');}
}
async function sendAppsScriptVerificationEmail(destination,code,purpose='signup'){
  const endpoint=String(process.env.COOKCIRCLE_GMAIL_RELAY_URL||'').trim(),relayToken=String(process.env.COOKCIRCLE_GMAIL_RELAY_TOKEN||'').trim();
  if(!endpoint||!relayToken)throw new Error('Google Apps Script email relay settings are incomplete.');
  let relayUrl;
  try{relayUrl=new URL(endpoint)}catch{throw new Error('Google Apps Script email relay URL is invalid.');}
  if(relayUrl.protocol!=='https:'||relayUrl.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(relayUrl.pathname))throw new Error('Google Apps Script email relay URL is invalid.');
  let response;
  try{
    response=await fetch(relayUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:relayToken,to:destination,code,purpose}),signal:AbortSignal.timeout(20000)});
  }catch(e){console.error('CookCircle Google Apps Script relay request failed:',e.name||'request error');throw new Error('Google Apps Script could not be reached. Check the relay URL and deployment access.');}
  let payload={};
  try{payload=await response.json()}catch{}
  if(!response.ok||payload.ok!==true){console.error('CookCircle Google Apps Script relay rejected email:',response.status,payload.error||'invalid response');throw new Error('Google Apps Script could not send the email. Check its deployment, authorization, and daily sending limit.');}
}
async function deliverSignupVerificationCode(channel,destination,code,purpose='signup'){
  if(channel!=='email')throw Object.assign(new Error('Email is the only available signup verification method.'),{httpStatus:400});
  const outbox=devEmailOutbox();
  if(outbox){fs.appendFileSync(outbox,JSON.stringify({to:destination,code,purpose,at:new Date().toISOString()})+'\n');return {deliveryMode:'dev-outbox'}}
  if(process.env.COOKCIRCLE_GMAIL_RELAY_URL||process.env.COOKCIRCLE_GMAIL_RELAY_TOKEN){
    try{await sendAppsScriptVerificationEmail(destination,code,purpose)}catch(e){console.error('CookCircle Google Apps Script delivery failed:',e.message);throw Object.assign(new Error('Gmail could not send the code through the Google Apps Script relay. Check the relay settings in Render and the Apps Script executions page.'),{httpStatus:502})}
    return {deliveryMode:'google-apps-script'};
  }
  if(process.env.GMAIL_API_CLIENT_ID&&process.env.GMAIL_API_CLIENT_SECRET&&process.env.GMAIL_API_REFRESH_TOKEN&&process.env.GMAIL_API_SENDER){
    try{await sendGmailVerificationEmail(destination,code,purpose)}catch(e){console.error('CookCircle Gmail API delivery failed:',e.message);throw Object.assign(new Error('Gmail could not send the code. Check the Gmail API settings in Render and the server logs.'),{httpStatus:502})}
    return {deliveryMode:'gmail-api'};
  }
  if(process.env.RESEND_API_KEY&&process.env.COOKCIRCLE_EMAIL_FROM){
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.COOKCIRCLE_EMAIL_FROM,to:[destination],...emailCodeCopy(purpose,code)})});
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
function serveFile(res, file, headers = {}) {
  const ext = path.extname(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
  fs.readFile(file, (err, data) => { if (err) return send(res, 404, { error: 'Page not found' }); res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', ...headers }); res.end(data); });
}

// ---- Cookability estimates ----
// Typical active minutes per dish plus minutes per serving/piece. Order matters: specific dishes come before generic words.
const DISH_TIMES = [
  { match: /parath/i, label: 'Paratha', base: 10, per: 3, unit: 'pieces' },
  { match: /\b(roti|chapat+i|phulka|fulka)s?\b/i, label: 'Roti / chapati', base: 10, per: 1.5, unit: 'pieces' },
  { match: /\b(poori|puri)s?\b/i, label: 'Puri', base: 10, per: 1.2, unit: 'pieces' },
  { match: /dosa|uttapam|chil+a|cheela/i, label: 'Dosa / chilla', base: 5, per: 2.5, unit: 'pieces' },
  { match: /idli/i, label: 'Idli', base: 15, per: 0.3, unit: 'pieces' },
  { match: /biryani/i, label: 'Biryani', base: 60, per: 2, unit: 'servings' },
  { match: /mutton|lamb|goat/i, label: 'Mutton curry', base: 75, per: 2, unit: 'servings' },
  { match: /chicken/i, label: 'Chicken dish', base: 45, per: 2, unit: 'servings' },
  { match: /fish|prawn|shrimp/i, label: 'Fish / seafood', base: 35, per: 2, unit: 'servings' },
  { match: /\begg|anda|omelet/i, label: 'Egg dish', base: 15, per: 1, unit: 'servings' },
  { match: /pulao|jeera rice|fried rice|khich(di|ri)/i, label: 'Pulao / khichdi', base: 30, per: 1, unit: 'servings' },
  { match: /rice|chawal/i, label: 'Plain rice', base: 20, per: 0.5, unit: 'servings' },
  { match: /\bdaa?l\b|sambh?ar|rasam|kadhi/i, label: 'Dal / sambar', base: 25, per: 1.5, unit: 'servings' },
  { match: /paneer|chole|chana|rajma|kofta|korma|curry|gravy/i, label: 'Curry / gravy', base: 35, per: 2, unit: 'servings' },
  { match: /sabz?ji|sabzi|bhaji|vegetable|\bveg\b|aloo|gobi|bhindi|palak|poriyal|thoran/i, label: 'Vegetable (sabzi)', base: 25, per: 1.5, unit: 'servings' },
  { match: /poha|upma|sevai|vermicelli|oats/i, label: 'Light breakfast dish', base: 20, per: 1, unit: 'servings' },
  { match: /kheer|halwa|payasam|dessert|sweet|ladoo/i, label: 'Dessert', base: 35, per: 1, unit: 'servings' },
  { match: /salad|raita|chutney|pickle/i, label: 'Salad / raita / chutney', base: 10, per: 0.5, unit: 'servings' },
  { match: /\btea\b|chai|coffee/i, label: 'Tea / coffee', base: 5, per: 0.5, unit: 'cups' }
];
const COOKABILITY_METHOD = 'Each dish has a typical active cooking time plus time per serving or piece. We assume about a third of the work overlaps when dishes cook side by side, then add 10 minutes for setup and cleanup. This is an estimate, not a guarantee: ingredient prep, kitchen equipment and the cook\'s pace all change it.';
function cleanDishes(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 15).map(d => ({ name: String(d && d.name || '').trim().slice(0, 60), qty: Math.max(1, Math.min(60, Math.round(Number(d && d.qty) || 1))) })).filter(d => d.name.length >= 2);
}
function parseDishes(json) { try { return cleanDishes(JSON.parse(json || '[]')); } catch { return []; } }
function estimateCookability(dishes, durationMinutes) {
  const items = dishes.map(d => {
    const known = DISH_TIMES.find(t => t.match.test(d.name));
    const t = known || { label: 'Not recognised', base: 30, per: 1.5, unit: 'servings' };
    return { name: d.name, qty: d.qty, category: t.label, unit: t.unit, minutes: Math.round(t.base + t.per * d.qty), recognised: Boolean(known) };
  });
  const duration = BOOKING_DURATIONS.includes(Number(durationMinutes)) ? Number(durationMinutes) : null;
  if (!items.length) return { items, estimateMinutes: null, durationMinutes: duration, status: 'unknown', recommendedMinutes: null, confidence: 'none', method: COOKABILITY_METHOD };
  const total = items.reduce((n, i) => n + i.minutes, 0), longest = Math.max(...items.map(i => i.minutes));
  const estimate = Math.ceil(Math.max(longest + 10, total * 0.67 + 10) / 5) * 5;
  const unknown = items.filter(i => !i.recognised).length;
  let status = 'unknown', recommendedMinutes = null;
  if (duration) {
    status = estimate <= duration ? 'fits' : estimate <= duration + 15 ? 'tight' : 'over';
    if (status !== 'fits') recommendedMinutes = BOOKING_DURATIONS.find(m => m >= estimate) || null;
  }
  return { items, estimateMinutes: estimate, activeMinutes: total, durationMinutes: duration, status, recommendedMinutes, confidence: unknown ? (unknown === items.length ? 'low' : 'medium') : 'standard', method: COOKABILITY_METHOD };
}

// ---- Shared booking creation and cancellation ----
function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
function addDays(date, days) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function weekday(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
function sessionStartMs(date, slot) { return Date.parse(`${date}T${String(slot).split('–')[0]}:00+05:30`); }
const MIN_LEAD_MINUTES = 60;
function createBookingForHousehold(user, input, { bookingType = 'on_demand', planId = null, planBilled = false } = {}) {
  const household = sql.prepare('SELECT society_id AS societyId FROM households WHERE user_id=?').get(user.id);
  if (!household) return { status: 409, error: 'Your household profile needs a registered society before you can book.' };
  const societyId = household.societyId;
  if (!sql.prepare('SELECT id FROM societies WHERE id=? AND is_active=1').get(societyId)) return { status: 403, error: 'Your society is no longer active on CookCircle. Contact the platform administrator.' };
  const date = String(input.date || ''), slot = String(input.slot || ''), durationMinutes = input.durationMinutes === undefined || input.durationMinutes === null || input.durationMinutes === '' ? LEGACY_DURATION_MINUTES : Number(input.durationMinutes);
  if (!dateAllowed(date) || !slots.includes(slot)) return { status: 400, error: 'Choose a valid available date and session.' };
  if (!BOOKING_DURATIONS.includes(durationMinutes)) return { status: 400, error: 'Choose a cooking duration between 1 and 4 hours.' };
  if (weekday(date) === 0) return { status: 409, error: 'CookCircle does not schedule cooks on Sundays. Please choose another day.' };
  if (sessionStartMs(date, slot) - Date.now() < MIN_LEAD_MINUTES * 60000) return { status: 409, error: 'That session starts too soon to find a cook. Choose a session at least an hour away.' };
  if (sql.prepare(`SELECT id FROM bookings WHERE user_id=? AND date=? AND slot=? AND status NOT IN ${OPEN_BOOKING_STATUSES} AND status<>'Completed'`).get(user.id, date, slot)) return { status: 409, error: 'You already have a booking for this date and session.' };
  if (!planId && !findAvailableCook(societyId, date, slot, durationMinutes)) return { status: 409, error: 'No approved cook serving your society is available for that session and duration. Please choose another time.' };
  const meal = String(input.meal || 'Lunch').slice(0, 40);
  if (!sql.prepare('SELECT id FROM service_categories WHERE name=? AND active=1').get(meal)) return { status: 400, error: 'This service is currently unavailable.' };
  const dishes = cleanDishes(input.dishes), estimate = estimateCookability(dishes, durationMinutes).estimateMinutes;
  const pricePaise = priceForMinutes(durationMinutes);
  let paymentStatus = 'unpaid-demo', status = 'Requested', subscriptionId = null, paymentProvider = 'simulated';
  if (planBilled) { paymentStatus = 'simulated-paid'; status = 'Confirmed'; paymentProvider = 'simulated-plan'; }
  else if (input.paymentMethod === 'credit') {
    if (durationMinutes > CREDIT_MAX_MINUTES) return { status: 400, error: 'A meal-pack credit covers a session of up to 2 hours. Choose 2 hours or less, or pay for this booking.' };
    const sub = sql.prepare("SELECT id FROM subscriptions WHERE user_id=? AND status='active' AND remaining_credits>0 AND expires_at>=? ORDER BY expires_at LIMIT 1").get(user.id, new Date().toISOString());
    if (!sub) return { status: 400, error: 'No valid meal-pack credits are available.' };
    subscriptionId = sub.id;
    sql.prepare('UPDATE subscriptions SET remaining_credits=remaining_credits-1 WHERE id=?').run(sub.id);
    sql.prepare('INSERT INTO credit_ledger(id,user_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), user.id, sub.id, -1, 'Credit reserved for cooking session', new Date().toISOString());
    paymentStatus = 'credit-applied'; status = 'Confirmed';
  }
  const checkinCode = String(crypto.randomInt(100000, 1000000));
  const booking = { id: `CC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, userId: user.id, societyId, date, slot, meal, people: String(input.people || '').slice(0, 30), instructions: String(input.instructions || '').slice(0, 500), cook: 'Awaiting cook assignment', pricePaise, paymentStatus, paymentProvider, status, subscriptionId, serviceOtpHash: crypto.createHash('sha256').update(checkinCode).digest('hex'), checkinCode, createdAt: new Date().toISOString(), durationMinutes, bookingType, planId, dishes, estimateMinutes: estimate };
  insertBooking(booking);
  let requestCount = null, bookingClosed = false;
  if (status === 'Confirmed') { requestCount = autoAssignBooking(booking.id) || 0; if (!requestCount) bookingClosed = closeBookingAfterAllCookDeclines(booking.id, 'unavailable'); }
  return { booking, requestCount, bookingClosed };
}
function cancelBookingForHousehold(booking, note) {
  const now = new Date().toISOString();
  if (booking.payment_status === 'credit-applied' && booking.subscription_id) {
    sql.prepare('UPDATE subscriptions SET remaining_credits=remaining_credits+1 WHERE id=?').run(booking.subscription_id);
    sql.prepare('INSERT INTO credit_ledger(id,user_id,booking_id,subscription_id,change_amount,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), booking.user_id, booking.id, booking.subscription_id, 1, note === 'Cancelled by customer' ? 'Cancelled booking credit returned' : `${note}: credit returned`, now);
  }
  setBookingStatus(booking.id, 'Cancelled', note);
  for (const pay of sql.prepare("SELECT id,amount_paise FROM payments WHERE booking_id=? AND status='simulated-paid'").all(booking.id)) {
    sql.prepare("UPDATE payments SET status='refund-pending' WHERE id=?").run(pay.id);
    sql.prepare('INSERT INTO refunds(id,payment_id,amount_paise,status,reason,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), pay.id, pay.amount_paise, 'pending', `${note} (demo mode)`, now);
  }
  sql.prepare("UPDATE booking_extensions SET status='cancelled',responded_at=? WHERE booking_id=? AND status='requested'").run(now, booking.id);
  if (booking.cook_profile_id) {
    const cookUser = sql.prepare('SELECT user_id AS userId FROM cook_profiles WHERE id=?').get(booking.cook_profile_id);
    if (cookUser && cookUser.userId) sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), cookUser.userId, booking.id, 'booking_status', `The ${booking.slot} ${booking.date} visit was cancelled by the household (${note.toLowerCase()}).`, now);
  }
}

// ---- Regular (recurring) arrangements ----
const PLAN_TERMS = { weekly: 7, monthly: 28 };
function planDates(plan, from, to) {
  const days = JSON.parse(plan.weekdays || '[]'), out = [];
  for (let date = from > plan.start_date ? from : plan.start_date; date <= to && date <= plan.end_date; date = addDays(date, 1)) if (days.includes(weekday(date))) out.push(date);
  return out;
}
function awayPeriodsFor(userId) { return sql.prepare("SELECT id,start_date AS startDate,end_date AS endDate FROM household_away_periods WHERE user_id=? AND status='active'").all(userId); }
function isAway(periods, date) { return periods.some(p => date >= p.startDate && date <= p.endDate); }
// Creates the sessions of each active arrangement that fall inside the booking window, once per date.
function generateRecurringSessions(userId = null) {
  const today = istToday(), horizon = addDays(today, 7);
  const plans = sql.prepare(`SELECT * FROM recurring_plans WHERE status='active'${userId ? ' AND user_id=?' : ''}`).all(...(userId ? [userId] : []));
  let created = 0;
  for (const plan of plans) {
    if (plan.end_date < today) { sql.prepare("UPDATE recurring_plans SET status='completed' WHERE id=? AND status='active'").run(plan.id); continue; }
    const user = sql.prepare("SELECT id,role FROM users WHERE id=? AND role='customer'").get(plan.user_id);
    if (!user) continue;
    const away = awayPeriodsFor(user.id);
    for (const date of planDates(plan, today, horizon)) {
      if (isAway(away, date)) continue;
      if (sql.prepare('SELECT 1 FROM bookings WHERE plan_id=? AND date=? AND paused_for_away=0').get(plan.id, date)) continue;
      if (sessionStartMs(date, plan.slot) - Date.now() < MIN_LEAD_MINUTES * 60000) continue;
      try {
        const result = createBookingForHousehold(user, { date, slot: plan.slot, durationMinutes: plan.duration_minutes, meal: plan.meal, people: plan.people, instructions: plan.instructions, dishes: parseDishes(plan.dishes) }, { bookingType: 'regular', planId: plan.id, planBilled: true });
        if (result.booking) created++;
      } catch (error) { if (!/unique|constraint/i.test(String(error.message))) throw error; }
    }
  }
  return created;
}
function planView(plan) {
  const today = istToday();
  return { id: plan.id, frequency: plan.frequency, weekdays: JSON.parse(plan.weekdays), slot: plan.slot, durationMinutes: plan.duration_minutes, meal: plan.meal, people: plan.people, instructions: plan.instructions, dishes: parseDishes(plan.dishes), startDate: plan.start_date, endDate: plan.end_date, status: plan.status, sessionPricePaise: priceForMinutes(plan.duration_minutes),
    preferredCook: plan.preferred_cook_id ? (sql.prepare('SELECT name FROM cook_profiles WHERE id=?').get(plan.preferred_cook_id) || {}).name || '' : '',
    upcomingDates: plan.status === 'active' ? planDates(plan, today, plan.end_date).slice(0, 12) : [] };
}
function validatePlanInput(body) {
  const frequency = String(body.frequency || ''), slot = String(body.slot || ''), durationMinutes = Number(body.durationMinutes), startDate = String(body.startDate || '');
  const weekdays = [...new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number))].filter(d => Number.isInteger(d) && d >= 1 && d <= 6).sort();
  const today = istToday();
  if (!PLAN_TERMS[frequency]) return { error: 'Choose a weekly or monthly arrangement.' };
  if (!weekdays.length) return { error: 'Choose at least one day from Monday to Saturday.' };
  if (!slots.includes(slot)) return { error: 'Choose a session time.' };
  if (!BOOKING_DURATIONS.includes(durationMinutes)) return { error: 'Choose a cooking duration between 1 and 4 hours.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < today || startDate > addDays(today, 30)) return { error: 'Choose a start date within the next 30 days.' };
  const meal = String(body.meal || 'Lunch').slice(0, 40);
  if (!sql.prepare('SELECT id FROM service_categories WHERE name=? AND active=1').get(meal)) return { error: 'This service is currently unavailable.' };
  const endDate = addDays(startDate, PLAN_TERMS[frequency] - 1);
  const plan = { frequency, weekdays: JSON.stringify(weekdays), slot, duration_minutes: durationMinutes, meal, people: String(body.people || '').slice(0, 30), instructions: String(body.instructions || '').slice(0, 500), dishes: JSON.stringify(cleanDishes(body.dishes)), start_date: startDate, end_date: endDate };
  const dates = planDates(plan, startDate, endDate);
  if (!dates.length) return { error: 'No sessions fall on the chosen days in this term.' };
  return { plan, dates };
}

// ---- Away Mode ----
function awaySessionsAffected(userId, startDate, endDate) {
  const scheduled = sql.prepare(`SELECT b.id,b.date,b.slot,b.meal,b.status,b.plan_id AS planId FROM bookings b WHERE b.user_id=? AND b.plan_id IS NOT NULL AND b.paused_for_away=0 AND b.date>=? AND b.date<=? AND b.status IN ('Confirmed','Cook assigned','Replacement confirmed') ORDER BY b.date,b.slot`).all(userId, startDate, endDate);
  const tooLate = sql.prepare(`SELECT b.id,b.date,b.slot,b.status FROM bookings b WHERE b.user_id=? AND b.plan_id IS NOT NULL AND b.date>=? AND b.date<=? AND b.status IN ('Cook en route','Checked in','In progress')`).all(userId, startDate, endDate);
  const notYetScheduled = [];
  for (const plan of sql.prepare("SELECT * FROM recurring_plans WHERE user_id=? AND status='active'").all(userId)) {
    for (const date of planDates(plan, startDate, endDate)) if (!sql.prepare('SELECT 1 FROM bookings WHERE plan_id=? AND date=? AND paused_for_away=0').get(plan.id, date)) notYetScheduled.push({ planId: plan.id, date, slot: plan.slot, meal: plan.meal });
  }
  const oneOff = sql.prepare(`SELECT id,date,slot,meal,status FROM bookings WHERE user_id=? AND plan_id IS NULL AND date>=? AND date<=? AND status NOT IN ${OPEN_BOOKING_STATUSES} AND status<>'Completed'`).all(userId, startDate, endDate);
  return { scheduled, notYetScheduled, tooLate, oneOff };
}
function validateAwayDates(body) {
  const startDate = String(body.startDate || ''), endDate = String(body.endDate || ''), today = istToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { error: 'Choose your departure and return dates.' };
  if (startDate < today) return { error: 'The departure date cannot be in the past.' };
  if (endDate < startDate) return { error: 'The return date must be on or after the departure date.' };
  if (endDate > addDays(startDate, 89)) return { error: 'Away Mode can cover up to 90 days at a time.' };
  return { startDate, endDate };
}

// ---- Routine templates ----
const ROUTINE_KINDS = ['weekday', 'weekend', 'occasion', 'light', 'custom'];
const DEFAULT_ROUTINES = [
  { kind: 'weekday', name: 'Regular weekday routine', meal: 'Lunch', people: '3–4 people', durationMinutes: 120, dishes: [{ name: 'Dal', qty: 4 }, { name: 'Rice', qty: 4 }, { name: 'Seasonal sabzi', qty: 4 }, { name: 'Roti', qty: 12 }], instructions: 'Everyday home-style meal with our usual spice and oil levels.' },
  { kind: 'weekend', name: 'Weekend routine', meal: 'Lunch', people: '3–4 people', durationMinutes: 180, dishes: [{ name: 'Paneer curry', qty: 4 }, { name: 'Jeera rice', qty: 4 }, { name: 'Dal', qty: 4 }, { name: 'Paratha', qty: 8 }, { name: 'Raita', qty: 4 }], instructions: 'A more elaborate weekend meal.' },
  { kind: 'occasion', name: 'Special occasion routine', meal: 'Special occasion', people: '5–6 people', durationMinutes: 240, dishes: [{ name: 'Biryani', qty: 8 }, { name: 'Chicken curry', qty: 8 }, { name: 'Dal', qty: 8 }, { name: 'Puri', qty: 30 }, { name: 'Kheer', qty: 8 }, { name: 'Salad', qty: 8 }], instructions: 'Cooking for guests: larger quantities and a fuller spread.' },
  { kind: 'light', name: 'Light meal routine', meal: 'Dinner', people: '1–2 people', durationMinutes: 60, dishes: [{ name: 'Khichdi', qty: 2 }, { name: 'Raita', qty: 2 }], instructions: 'A simple, light meal with less oil.' }
];
function seedHouseholdRoutines(userId) {
  const household = sql.prepare('SELECT routines_seeded AS seeded FROM households WHERE user_id=?').get(userId);
  if (!household || household.seeded) return;
  const now = new Date().toISOString(), insert = sql.prepare('INSERT INTO household_routines(id,user_id,name,kind,meal,people,duration_minutes,dishes,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for (const r of DEFAULT_ROUTINES) insert.run(crypto.randomUUID(), userId, r.name, r.kind, r.meal, r.people, r.durationMinutes, JSON.stringify(r.dishes), r.instructions, now, now);
  sql.prepare('UPDATE households SET routines_seeded=1 WHERE user_id=?').run(userId);
}
function routineView(r) { return { id: r.id, name: r.name, kind: r.kind, meal: r.meal, people: r.people, durationMinutes: r.duration_minutes, dishes: parseDishes(r.dishes), instructions: r.instructions, updatedAt: r.updated_at }; }
function validateRoutine(body) {
  const name = String(body.name || '').trim().slice(0, 60), kind = ROUTINE_KINDS.includes(body.kind) ? body.kind : 'custom', durationMinutes = Number(body.durationMinutes), meal = String(body.meal || 'Lunch').slice(0, 40);
  if (name.length < 2) return { error: 'Give the routine a name.' };
  if (!BOOKING_DURATIONS.includes(durationMinutes)) return { error: 'Choose a cooking duration between 1 and 4 hours.' };
  if (!sql.prepare('SELECT id FROM service_categories WHERE name=?').get(meal)) return { error: 'Choose a meal type.' };
  return { name, kind, durationMinutes, meal, people: String(body.people || '').slice(0, 30), dishes: JSON.stringify(cleanDishes(body.dishes)), instructions: String(body.instructions || '').slice(0, 500) };
}

// ---- Extra cooking time ----
const EXTENSION_MINUTES = [30, 60, 90];
const EXTENDABLE_STATUSES = ['Cook assigned', 'Replacement confirmed', 'Cook en route', 'Checked in', 'In progress'];
function extensionQuote(booking, minutes) {
  const current = bookingDuration(booking), start = booking.visit_start ? toMinutes(booking.visit_start) : slotWindow(booking.slot).start, end = start + current + minutes;
  const intervals = booking.cook_profile_id ? cookDayIntervals(booking.cook_profile_id, booking.date, booking.id) : [];
  const clash = end > LAST_VISIT_END_MINUTES || intervals.some(iv => { const buffer = iv.blocked || iv.societyId === booking.society_id ? 0 : TRAVEL_BUFFER_MINUTES; return start < iv.end + buffer && iv.start < end + buffer; });
  const pricePaise = priceForMinutes(minutes);
  return { minutes, pricePaise, hourlyRatePaise: hourlyRatePaise(), currentDurationMinutes: current, newDurationMinutes: current + minutes, currentTotalPaise: booking.price_paise, newTotalPaise: booking.price_paise + pricePaise, cookHasTime: !clash, newEndTime: toClock(end) };
}

// ---- Stale request handling ----
const PREFERRED_COOK_RESPONSE_MINUTES = 120;
const UNASSIGNED_CUTOFF_MINUTES = 30;
// Closes requests no cook accepted before the session, widens regular-session requests the usual cook has not answered,
// and expires extension requests on visits that have ended.
function sweepBookingRequests() {
  const now = Date.now(), nowIso = new Date().toISOString();
  for (const b of sql.prepare("SELECT id,date,slot FROM bookings WHERE cook_profile_id IS NULL AND status='Confirmed' AND date<=?").all(addDays(istToday(), 1))) {
    if (sessionStartMs(b.date, b.slot) - now > UNASSIGNED_CUTOFF_MINUTES * 60000) continue;
    sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND status='pending'").run(nowIso, b.id);
    closeBookingAfterAllCookDeclines(b.id, 'no_response');
  }
  const cutoff = new Date(now - PREFERRED_COOK_RESPONSE_MINUTES * 60000).toISOString();
  for (const b of sql.prepare("SELECT b.id FROM bookings b WHERE b.plan_id IS NOT NULL AND b.cook_profile_id IS NULL AND b.status='Confirmed' AND EXISTS(SELECT 1 FROM booking_cook_offers o WHERE o.booking_id=b.id AND o.status='pending' AND o.created_at<?)").all(cutoff)) autoAssignBooking(b.id, { broadcast: true });
  sql.prepare("UPDATE booking_extensions SET status='expired',responded_at=? WHERE status='requested' AND booking_id IN (SELECT id FROM bookings WHERE status IN ('Completed','Cancelled','Refunded','No cook available'))").run(nowIso);
}
function runScheduledBookingWork() {
  try { generateRecurringSessions(); sweepBookingRequests(); } catch (error) { console.error('CookCircle scheduled booking work failed:', error.message); }
}

// ---- Reviews ----
function cookRatingSummary(cookId) {
  const row = sql.prepare('SELECT COUNT(*) AS count,AVG(rating) AS average FROM reviews WHERE cook_id=?').get(cookId);
  const count = Number(row && row.count) || 0;
  return { count, average: count ? Math.round(Number(row.average) * 10) / 10 : null };
}
function cookReviews(cookId, limit = 20) {
  return sql.prepare(`SELECT r.rating,r.comment,r.created_at AS createdAt,b.meal,b.date,s.name AS societyName FROM reviews r JOIN bookings b ON b.id=r.booking_id JOIN societies s ON s.id=b.society_id WHERE r.cook_id=? ORDER BY r.created_at DESC LIMIT ${Number(limit) || 20}`).all(cookId);
}

// ---- Password reset ----
const passwordResetChallenges = new Map();
const passwordResetTokens = new Map();
const passwordResetSendHistory = new Map();
const chatRateHistory = new Map();
function emailDeliveryConfigured() {
  return Boolean(devEmailOutbox() || process.env.COOKCIRCLE_GMAIL_RELAY_URL || process.env.COOKCIRCLE_GMAIL_RELAY_TOKEN ||
    (process.env.GMAIL_API_CLIENT_ID && process.env.GMAIL_API_CLIENT_SECRET && process.env.GMAIL_API_REFRESH_TOKEN && process.env.GMAIL_API_SENDER) ||
    (process.env.RESEND_API_KEY && process.env.COOKCIRCLE_EMAIL_FROM));
}
function recentSends(map, key, now) { const fresh = (map.get(key) || []).filter(t => now - t < 60 * 60_000); map.set(key, fresh); return fresh; }
function prunePasswordReset(now) {
  for (const [id, item] of passwordResetChallenges) if (item.expiresAt < now) passwordResetChallenges.delete(id);
  for (const [token, item] of passwordResetTokens) if (item.expiresAt < now) passwordResetTokens.delete(token);
}

// ---- Help assistant ----
const HELP_SUPPORT_NOTE = 'For anything about a specific payment, a dispute, or something not covered here, contact CookCircle support: households can use Support in their dashboard; anyone can use the Help page form.';
function helpKnowledge() {
  const rate = hourlyRatePaise() / 100;
  return [
    { topics: ['household', 'cook', 'landing'], keys: ['price', 'pricing', 'cost', 'rate', 'hour', 'charge', 'kitna', 'paisa'], answer: `Cooking sessions cost ₹${rate} per hour. You choose a duration from 1 to 4 hours (in 30-minute steps) and the total is calculated before you confirm. Payments on this site run in demo mode: no real money is charged.` },
    { topics: ['household', 'landing'], keys: ['book', 'booking', 'request', 'on-demand', 'on demand', 'how do i'], answer: 'To book an on-demand cook: open Book a cook, choose a day, an arrival window and how long you need, then submit and complete the demo payment (or use a meal-pack credit). The request goes to approved cooks serving your society; the first to accept is assigned and you will see their name and phone number in Bookings.' },
    { topics: ['landing', 'household'], keys: ['sign up', 'signup', 'create account', 'register account', 'join cookcircle'], answer: 'Choose Sign up and create a household account with your email, phone number, society and apartment details. Verify your email with the 6-digit code we send, then sign in to use your household dashboard.' },
    { topics: ['landing', 'household', 'cook'], keys: ['verification code', 'email code', 'code not', 'verify email', 'verification email', 'signup code'], answer: 'Signup verification uses a 6-digit code sent to your email. Check that the address is correct and look in spam or junk. Codes expire after 10 minutes; wait for the resend option and request another code if needed.' },
    { topics: ['household', 'landing'], keys: ['regular', 'recurring', 'weekly', 'monthly', 'every day', 'repeat', 'arrangement'], answer: 'A regular arrangement repeats on the days you pick (Monday–Saturday) for one week or four weeks. Sessions are created up to 7 days ahead and offered to your usual cook first; if they decline or do not respond within 2 hours, other approved cooks are asked. Each session is billed (demo) when it is scheduled.' },
    { topics: ['household'], keys: ['cancel', 'reschedule', 'change date', 'move'], answer: 'You can cancel a booking from Bookings until the session is completed. A meal-pack credit is returned automatically and a demo payment is marked for refund. To reschedule, cancel and book the new time. For regular arrangements you can cancel the whole arrangement or use Away Mode to pause it.' },
    { topics: ['household'], keys: ['away', 'travel', 'holiday', 'vacation', 'pause'], answer: 'Away Mode pauses the sessions of your regular arrangements between your departure and return dates. You see exactly which sessions are affected before confirming. Paused sessions are cancelled with the usual credit return or demo refund, and the arrangement resumes automatically after your return date.' },
    { topics: ['household'], keys: ['brief', 'operating brief', 'preference', 'instructions', 'allerg', 'spice', 'oil', 'kitchen'], answer: 'Your Household Operating Brief (Household profile page) stores family size, food preferences, cuisines, spice and oil levels, regular dishes, roti needs, kitchen equipment and other instructions. Your assigned cook sees it for each visit; you can switch sharing off at any time.' },
    { topics: ['household', 'landing'], keys: ['meal pack', 'meal-pack', 'pack credit', 'credits', 'five sessions'], answer: 'The Monthly meal pack includes five standard cooking sessions and is valid for 30 days. A credit can be used for a session up to 2 hours. Your household supplies the ingredients. Check Payments in your dashboard to see remaining credits and validity.' },
    { topics: ['household'], keys: ['routine', 'template', 'weekday', 'weekend', 'occasion', 'light meal'], answer: 'Cooking routines are reusable templates (weekday, weekend, special occasion, light meal, or your own). Each stores dishes, quantities, duration and notes. Pick one in Book a cook to fill the form, then adjust anything before submitting.' },
    { topics: ['household'], keys: ['cookability', 'enough time', 'how long', 'duration', 'estimate', 'feasib'], answer: 'Cookability Preview estimates how long your dishes take: each dish has a typical active time plus time per serving or piece, about a third of the work overlaps, and 10 minutes are added for setup and cleanup. If the estimate is longer than your duration it suggests a longer session. It is an estimate, not a guarantee.' },
    { topics: ['household'], keys: ['extra time', 'extend', 'extension', 'more time', 'longer'], answer: 'Once a cook is assigned you can request extra time (30, 60 or 90 minutes) from the booking card. You see the added cost and new total before sending. The cook approves it only if they have time; the extra amount is charged (demo) on approval.' },
    { topics: ['household'], keys: ['review', 'rating', 'feedback', 'star'], answer: 'After a session is marked completed you can leave a 1–5 star review with optional feedback from Bookings. One review per completed session.' },
    { topics: ['household', 'landing'], keys: ['cluster', 'share', 'shared cook', 'neighbour', 'neighbor'], answer: 'CookCircle may schedule one cook for several households in your society back to back. The cook still cooks separately in each kitchen for your full booked duration, within your chosen arrival window.' },
    { topics: ['household', 'landing'], keys: ['no cook', 'nobody accepted', 'not accepted', 'no one accepted', 'unavailable cook'], answer: 'If no approved cook can take the session, no cook is booked. Any meal-pack credit is returned, and a demo payment is marked for refund. You can try another date or arrival window.' },
    { topics: ['household', 'landing'], keys: ['society not listed', 'missing society', 'register society', 'add society', 'can’t find my society', "can't find my society"], answer: 'Use the “Register it here” option in signup to submit your society details. The team reviews society registrations before the society becomes available in CookCircle.' },
    { topics: ['household'], keys: ['payment', 'charged', 'real money', 'refund', 'billing'], answer: 'Payments on this site run in demo mode, so no real money is charged. Booking confirmations show the session total before you submit. For a specific payment or dispute, contact CookCircle support through Support in your dashboard or the Help page form.' },
    { topics: ['cook'], keys: ['request', 'accept', 'decline', 'new booking'], answer: 'New booking requests appear under Requests. Household details stay hidden until you accept. The first cook to accept is assigned; declining passes the request to other cooks.' },
    { topics: ['cook', 'landing'], keys: ['become a cook', 'cook application', 'apply as a cook', 'join as a cook', 'cook signup', 'cook sign up'], answer: 'Choose Become a Cook and submit your contact details, cooking experience, the societies you can reliably serve, and 1–3 identity documents. Your application and service area are reviewed by an administrator before you can receive requests.' },
    { topics: ['cook'], keys: ['identity document', 'identity documents', 'aadhaar', 'passport', 'pan card', 'verification documents'], answer: 'Cook applications require 1–3 clear identity documents, such as Aadhaar, PAN, voter ID or passport. Accepted uploads are PDF, JPEG or PNG; each file can be up to 5 MB and the total upload up to 10 MB. Documents are encrypted and reviewed by an administrator.' },
    { topics: ['cook'], keys: ['society selection', 'select societies', 'service area', 'nearby society', 'which societies'], answer: 'Select only the societies you can reliably travel to when you apply. The team reviews your service area with your application; you can register a missing society from the “Register it here” option.' },
    { topics: ['cook'], keys: ['application status', 'pending approval', 'approved cook', 'when can i start', 'review application'], answer: 'Cook applications are reviewed by an administrator. Only approved, active cooks receive booking requests. If you need an update about your application, contact CookCircle support using the Help page form.' },
    { topics: ['cook'], keys: ['schedule', 'visit', 'check in', 'check-in', 'code', 'otp', 'complete', 'en route'], answer: 'Accepted visits are in Schedule with the apartment, household brief, dishes and phone number. Move each visit through Mark en route → Check in (enter the household\'s 6-digit code) → Start service → Mark completed. Use Report unavailable before you set out if you cannot make it.' },
    { topics: ['cook'], keys: ['earning', 'payment', 'paid', 'cash out', 'cashout', 'payout', 'money'], answer: 'Completed sessions add 70% of the session price to your earnings. Request a cash out from the Cash out page; an administrator reviews it. Cash-out is a recorded request, not an automatic bank transfer.' },
    { topics: ['cook'], keys: ['instruction', 'brief', 'household', 'allerg', 'preference'], answer: 'Open the visit in Schedule to see the Household Operating Brief (if the household shares it), their dishes and notes. It appears only for visits assigned to you.' },
    { topics: ['cook'], keys: ['extra time', 'extension', 'more time'], answer: 'If a household asks for extra time, the request appears on that visit in Schedule. Approve it only if you can stay; the visit length and price update automatically.' },
    { topics: ['cook'], keys: ['available', 'availability', 'leave', 'off', 'unavailable'], answer: 'Use Availability to mark sessions you cannot serve. You will not receive requests that overlap them.' },
    { topics: ['cook'], keys: ['hindi', 'language', 'english', 'भाषा'], answer: 'Use the language switch (English / हिन्दी) at the top of your workspace. Your choice is saved to your account.' },
    { topics: ['household', 'cook', 'landing'], keys: ['password', 'forgot', 'reset', 'login', 'log in', 'sign in'], answer: 'If you forgot your password, choose Log in → Forgot password, enter your registered email, then enter the 6-digit code we email you and set a new password.' }
  ];
}
function faqAnswer(question, context) {
  const q = String(question || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const entry of helpKnowledge()) {
    if (!entry.topics.includes(context)) continue;
    const score = entry.keys.reduce((n, k) => n + (q.includes(k) ? k.length : 0), 0);
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best ? best.answer : null;
}
function helpSystemPrompt(context, accountSummary) {
  const knowledge = helpKnowledge().filter(e => e.topics.includes(context)).map(e => '- ' + e.answer).join('\n');
  const audience = context === 'cook' ? 'a cook who works through CookCircle' : context === 'household' ? 'a household that books cooks through CookCircle' : 'a visitor to the CookCircle website';
  return `You are the CookCircle help assistant. CookCircle connects households in Indian apartment societies with verified home cooks. You are talking to ${audience}.

Answer only from the CookCircle facts below and the account summary. If the answer is not covered, say you are not sure and point the person to human support. Never invent prices, policies, booking details, refunds or timelines. Payments on this site run in demo mode. Never reveal or guess personal information about anyone other than the person you are talking to. Keep answers short and practical (under 120 words), in the language the person writes in. When a person needs a human (payment disputes, safety concerns, complaints, account problems), end your reply with the exact line: [HANDOFF]

CookCircle facts:
${knowledge}
- ${HELP_SUPPORT_NOTE}

Account summary (this person's own data only):
${accountSummary || 'Not signed in.'}`;
}
function helpAccountSummary(user) {
  if (!user) return '';
  if (user.role === 'customer') {
    const rows = sql.prepare(`SELECT id,date,slot,meal,status,duration_minutes AS durationMinutes,booking_type AS bookingType FROM bookings WHERE user_id=? AND date>=? ORDER BY date,slot LIMIT 8`).all(user.id, istToday());
    const plans = sql.prepare("SELECT frequency,slot,end_date AS endDate FROM recurring_plans WHERE user_id=? AND status='active'").all(user.id);
    return `Household account. Upcoming bookings: ${rows.length ? rows.map(b => `${b.id} on ${b.date} ${b.slot}, ${b.meal}, ${bookingDuration(b) / 60} h, ${b.bookingType === 'regular' ? 'regular' : 'on-demand'}, status ${b.status}`).join('; ') : 'none'}. Active regular arrangements: ${plans.length ? plans.map(p => `${p.frequency} at ${p.slot} until ${p.endDate}`).join('; ') : 'none'}.`;
  }
  if (user.role === 'cook') {
    const cook = sql.prepare('SELECT id,verification_status AS status FROM cook_profiles WHERE user_id=?').get(user.id);
    if (!cook) return 'Cook account without a profile.';
    const pending = sql.prepare("SELECT COUNT(*) AS n FROM booking_cook_offers WHERE cook_id=? AND status='pending'").get(cook.id).n;
    const visits = sql.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE cook_profile_id=? AND date>=? AND status NOT IN ${OPEN_BOOKING_STATUSES} AND status<>'Completed'`).get(cook.id, istToday()).n;
    return `Cook account, verification ${cook.status}. Open requests: ${pending}. Upcoming accepted visits: ${visits}.`;
  }
  return `Signed in as ${user.role}.`;
}
let anthropicClient = null;
function helpAiClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) { const Anthropic = require('@anthropic-ai/sdk'); anthropicClient = new (Anthropic.default || Anthropic)(); }
  return anthropicClient;
}
async function answerHelpChat(messages, context, user) {
  const latest = messages[messages.length - 1].content;
  const fallback = () => {
    const answer = faqAnswer(latest, context);
    return { mode: 'faq', reply: answer || `I don't have an answer for that in CookCircle's help guide. ${HELP_SUPPORT_NOTE}`, handoff: !answer };
  };
  const client = helpAiClient();
  if (!client) return fallback();
  try {
    const response = await client.beta.messages.create({
      model: process.env.COOKCIRCLE_AI_MODEL || 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: helpSystemPrompt(context, helpAccountSummary(user)),
      messages
    });
    if (response.stop_reason === 'refusal') return { mode: 'ai', reply: `I can't help with that here. ${HELP_SUPPORT_NOTE}`, handoff: true };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return fallback();
    const handoff = text.includes('[HANDOFF]');
    return { mode: 'ai', reply: text.replace(/\s*\[HANDOFF\]\s*/g, '\n').trim(), handoff };
  } catch (error) {
    const Anthropic = require('@anthropic-ai/sdk'), A = Anthropic.default || Anthropic;
    if (error instanceof A.AuthenticationError) console.error('CookCircle help assistant: the Anthropic API key was rejected.');
    else if (error instanceof A.RateLimitError) console.error('CookCircle help assistant: rate limited by the Anthropic API.');
    else if (error instanceof A.APIError) console.error('CookCircle help assistant API error:', error.status);
    else console.error('CookCircle help assistant request failed:', error.name || 'error');
    return { ...fallback(), notice: 'The AI assistant is unavailable right now, so this answer comes from the help guide.' };
  }
}

// Public routes for password reset, the help assistant and pricing. Returns true when handled.
async function handlePublicFeatureRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/pricing') { send(res, 200, { hourlyRatePaise: hourlyRatePaise(), durations: BOOKING_DURATIONS, creditMaxMinutes: CREDIT_MAX_MINUTES, extensionMinutes: EXTENSION_MINUTES }); return true; }
  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/send') {
    let body; try { body = await getBody(req); } catch (e) { send(res, 400, { error: e.message }); return true; }
    const email = String(body.email || '').trim().toLowerCase(), now = Date.now();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) { send(res, 400, { error: 'Enter a valid email address.' }); return true; }
    if (!emailDeliveryConfigured()) { send(res, 503, { error: 'Password reset email is not configured on this server yet. Contact CookCircle support.' }); return true; }
    prunePasswordReset(now);
    const existing = body.challengeId ? passwordResetChallenges.get(String(body.challengeId)) : null;
    if (existing && existing.email !== email) { send(res, 400, { error: 'The email address changed. Request a new code.' }); return true; }
    if (existing && now - existing.sentAt < 60_000) { send(res, 429, { error: 'Please wait before requesting another code.', retryAfterSeconds: Math.ceil((60_000 - (now - existing.sentAt)) / 1000) }); return true; }
    const ipSends = recentSends(passwordResetSendHistory, 'ip|' + (req.socket.remoteAddress || 'local'), now), emailSends = recentSends(passwordResetSendHistory, 'email|' + email, now);
    if (ipSends.length >= 10 || emailSends.length >= 5) { send(res, 429, { error: 'Too many reset codes requested. Try again in an hour.' }); return true; }
    ipSends.push(now); emailSends.push(now);
    const account = sql.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND role IN ('customer','cook')").get(email);
    const code = String(crypto.randomInt(100000, 1000000));
    if (account) {
      try { await deliverSignupVerificationCode('email', email, code, 'password_reset'); }
      catch (e) { send(res, e.httpStatus || 502, { error: 'We could not send the reset email right now. Please try again shortly.' }); return true; }
    } else await new Promise(resolve => setTimeout(resolve, 250 + crypto.randomInt(500)));
    // Unknown emails get an identical-looking challenge that can never be verified, so the response does not reveal which emails are registered.
    const challengeId = existing ? existing.id : crypto.randomBytes(20).toString('hex');
    passwordResetChallenges.set(challengeId, { id: challengeId, email, userId: account ? account.id : null, codeHash: crypto.createHash('sha256').update(code).digest(), expiresAt: now + 10 * 60_000, sentAt: now, attempts: 0 });
    send(res, 200, { challengeId, destinationMasked: maskVerificationDestination('email', email), expiresInSeconds: 600, resendAfterSeconds: 60, message: 'If an account uses that email, we have sent it a 6-digit code.' });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/verify') {
    let body; try { body = await getBody(req); } catch (e) { send(res, 400, { error: e.message }); return true; }
    const challenge = passwordResetChallenges.get(String(body.challengeId || '')), code = String(body.code || '');
    if (!challenge || challenge.expiresAt < Date.now()) { if (challenge) passwordResetChallenges.delete(challenge.id); send(res, 400, { error: 'That code expired. Request a new reset code.' }); return true; }
    if (challenge.attempts >= 5) { passwordResetChallenges.delete(challenge.id); send(res, 429, { error: 'Too many incorrect codes. Request a new reset code.' }); return true; }
    const supplied = crypto.createHash('sha256').update(code).digest();
    if (!/^\d{6}$/.test(code) || !challenge.userId || !crypto.timingSafeEqual(supplied, challenge.codeHash)) { challenge.attempts++; send(res, 400, { error: 'That code is incorrect.' }); return true; }
    passwordResetChallenges.delete(challenge.id);
    const resetToken = crypto.randomBytes(32).toString('hex');
    passwordResetTokens.set(resetToken, { userId: challenge.userId, expiresAt: Date.now() + 10 * 60_000 });
    send(res, 200, { verified: true, resetToken }); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/complete') {
    let body; try { body = await getBody(req); } catch (e) { send(res, 400, { error: e.message }); return true; }
    const token = String(body.resetToken || ''), entry = passwordResetTokens.get(token), password = String(body.password || '');
    if (!entry || entry.expiresAt < Date.now()) { passwordResetTokens.delete(token); send(res, 400, { error: 'This reset session expired. Start again from Forgot password.' }); return true; }
    if (password.length < 8 || password.length > 200) { send(res, 400, { error: 'Use a password with at least 8 characters.' }); return true; }
    if (password !== String(body.confirmPassword || '')) { send(res, 400, { error: 'The two passwords do not match.' }); return true; }
    const pass = hashPassword(password);
    sql.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(pass.salt, pass.hash, entry.userId);
    sql.prepare('DELETE FROM sessions WHERE user_id=?').run(entry.userId);
    passwordResetTokens.delete(token);
    send(res, 200, { ok: true, message: 'Your password was updated. Log in with your new password.' }); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/help/chat') {
    let body; try { body = await getBody(req); } catch (e) { send(res, 400, { error: e.message }); return true; }
    const now = Date.now(), chatKey = 'chat|' + (req.socket.remoteAddress || 'local'), sends = recentSends(chatRateHistory, chatKey, now).filter(t => now - t < 10 * 60_000);
    if (sends.length >= 30) { send(res, 429, { error: 'You have sent a lot of messages. Please wait a few minutes.' }); return true; }
    chatRateHistory.set(chatKey, [...sends, now]);
    const raw = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const messages = raw.map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String(m && m.content || '').trim().slice(0, 1000) })).filter(m => m.content);
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== 'user') { send(res, 400, { error: 'Type a question first.' }); return true; }
    const user = currentUser(req);
    // The account's role decides the context; a page can only narrow a visitor to the landing context.
    const context = user ? (user.role === 'cook' ? 'cook' : user.role === 'customer' ? 'household' : 'landing') : 'landing';
    send(res, 200, await answerHelpChat(messages, context, user)); return true;
  }
  return false;
}

// Signed-in routes for booking models, household planning, extensions, reviews and preferences. Returns true when handled.
async function handleFeatureRoutes(req, res, url, user) {
  const readBody = async () => { try { return await getBody(req); } catch (e) { send(res, 400, { error: e.message }); return null; } };
  if (req.method === 'POST' && url.pathname === '/api/cookability') {
    const body = await readBody(); if (!body) return true;
    send(res, 200, { estimate: estimateCookability(cleanDishes(body.dishes), body.durationMinutes) }); return true;
  }
  // Regular arrangements
  if (url.pathname.startsWith('/api/plans')) {
    if (!requireRole(user, ['customer'], res)) return true;
    if (req.method === 'GET' && url.pathname === '/api/plans') {
      generateRecurringSessions(user.id);
      send(res, 200, { plans: sql.prepare('SELECT * FROM recurring_plans WHERE user_id=? ORDER BY created_at DESC').all(user.id).map(planView) }); return true;
    }
    if (req.method === 'POST' && (url.pathname === '/api/plans/preview' || url.pathname === '/api/plans')) {
      const body = await readBody(); if (!body) return true;
      const household = sql.prepare('SELECT society_id AS societyId FROM households WHERE user_id=?').get(user.id);
      if (!household || !sql.prepare('SELECT id FROM societies WHERE id=? AND is_active=1').get(household.societyId)) { send(res, 409, { error: 'Your household needs an active society before you can set up a regular cook.' }); return true; }
      const checked = validatePlanInput(body); if (checked.error) { send(res, 400, { error: checked.error }); return true; }
      const sessionPricePaise = priceForMinutes(checked.plan.duration_minutes), away = awayPeriodsFor(user.id);
      const firstWeek = checked.dates.filter(d => d <= addDays(istToday(), 7)).map(date => ({ date, cookAvailable: Boolean(findAvailableCook(household.societyId, date, checked.plan.slot, checked.plan.duration_minutes)), away: isAway(away, date) }));
      const summary = { frequency: checked.plan.frequency, startDate: checked.plan.start_date, endDate: checked.plan.end_date, sessionDates: checked.dates, sessionCount: checked.dates.length, sessionPricePaise, totalPaise: sessionPricePaise * checked.dates.length, hourlyRatePaise: hourlyRatePaise(), firstWeek };
      if (url.pathname === '/api/plans/preview') { send(res, 200, { preview: summary }); return true; }
      const overlapping = sql.prepare("SELECT weekdays FROM recurring_plans WHERE user_id=? AND status='active' AND slot=? AND start_date<=? AND end_date>=?").all(user.id, checked.plan.slot, checked.plan.end_date, checked.plan.start_date);
      const days = JSON.parse(checked.plan.weekdays);
      if (overlapping.some(p => JSON.parse(p.weekdays).some(d => days.includes(d)))) { send(res, 409, { error: 'You already have a regular arrangement for that session on one of these days.' }); return true; }
      const id = crypto.randomUUID(), p = checked.plan;
      sql.prepare('INSERT INTO recurring_plans(id,user_id,society_id,frequency,weekdays,slot,duration_minutes,meal,people,instructions,dishes,start_date,end_date,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, household.societyId, p.frequency, p.weekdays, p.slot, p.duration_minutes, p.meal, p.people, p.instructions, p.dishes, p.start_date, p.end_date, 'active', new Date().toISOString());
      const created = generateRecurringSessions(user.id);
      send(res, 201, { plan: planView(sql.prepare('SELECT * FROM recurring_plans WHERE id=?').get(id)), preview: summary, sessionsScheduled: created }); return true;
    }
    const cancelPlan = url.pathname.match(/^\/api\/plans\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelPlan) {
      const plan = sql.prepare('SELECT * FROM recurring_plans WHERE id=? AND user_id=?').get(cancelPlan[1], user.id);
      if (!plan) { send(res, 404, { error: 'Regular arrangement not found.' }); return true; }
      if (plan.status !== 'active') { send(res, 409, { error: 'This arrangement is no longer active.' }); return true; }
      sql.prepare("UPDATE recurring_plans SET status='cancelled' WHERE id=?").run(plan.id);
      const sessions = sql.prepare("SELECT * FROM bookings WHERE plan_id=? AND date>=? AND status IN ('Confirmed','Cook assigned','Replacement confirmed','Requested')").all(plan.id, istToday());
      for (const b of sessions) cancelBookingForHousehold(b, 'Regular arrangement cancelled');
      send(res, 200, { ok: true, cancelledSessions: sessions.length }); return true;
    }
    return false;
  }
  // Away Mode
  if (url.pathname.startsWith('/api/away')) {
    if (!requireRole(user, ['customer'], res)) return true;
    if (req.method === 'GET' && url.pathname === '/api/away') {
      send(res, 200, { periods: sql.prepare("SELECT id,start_date AS startDate,end_date AS endDate,status,created_at AS createdAt FROM household_away_periods WHERE user_id=? AND (status='active' AND end_date>=?) ORDER BY start_date").all(user.id, istToday()) }); return true;
    }
    if (req.method === 'POST' && (url.pathname === '/api/away/preview' || url.pathname === '/api/away')) {
      const body = await readBody(); if (!body) return true;
      const dates = validateAwayDates(body); if (dates.error) { send(res, 400, { error: dates.error }); return true; }
      const overlap = sql.prepare("SELECT 1 FROM household_away_periods WHERE user_id=? AND status='active' AND start_date<=? AND end_date>=?").get(user.id, dates.endDate, dates.startDate);
      const affected = awaySessionsAffected(user.id, dates.startDate, dates.endDate);
      if (url.pathname === '/api/away/preview') { send(res, 200, { preview: { ...dates, ...affected, overlapsExisting: Boolean(overlap) } }); return true; }
      if (overlap) { send(res, 409, { error: 'These dates overlap an Away Mode period you already set.' }); return true; }
      const id = crypto.randomUUID();
      sql.prepare('INSERT INTO household_away_periods(id,user_id,start_date,end_date,status,created_at) VALUES(?,?,?,?,?,?)').run(id, user.id, dates.startDate, dates.endDate, 'active', new Date().toISOString());
      for (const s of affected.scheduled) {
        const booking = sql.prepare('SELECT * FROM bookings WHERE id=?').get(s.id);
        cancelBookingForHousehold(booking, 'Paused for Away Mode');
        sql.prepare('UPDATE bookings SET paused_for_away=1 WHERE id=?').run(s.id);
      }
      send(res, 201, { period: { id, ...dates, status: 'active' }, paused: affected.scheduled, skipped: affected.notYetScheduled, notPaused: affected.tooLate, oneOff: affected.oneOff }); return true;
    }
    const endAway = url.pathname.match(/^\/api\/away\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && endAway) {
      const period = sql.prepare("SELECT id FROM household_away_periods WHERE id=? AND user_id=? AND status='active'").get(endAway[1], user.id);
      if (!period) { send(res, 404, { error: 'Away period not found.' }); return true; }
      sql.prepare("UPDATE household_away_periods SET status='cancelled',cancelled_at=? WHERE id=?").run(new Date().toISOString(), period.id);
      send(res, 200, { ok: true, sessionsScheduled: generateRecurringSessions(user.id) }); return true;
    }
    return false;
  }
  // Cooking routine templates
  if (url.pathname.startsWith('/api/routines')) {
    if (!requireRole(user, ['customer'], res)) return true;
    if (req.method === 'GET' && url.pathname === '/api/routines') {
      seedHouseholdRoutines(user.id);
      send(res, 200, { routines: sql.prepare('SELECT * FROM household_routines WHERE user_id=? ORDER BY created_at,name').all(user.id).map(routineView) }); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/routines') {
      const body = await readBody(); if (!body) return true;
      const r = validateRoutine(body); if (r.error) { send(res, 400, { error: r.error }); return true; }
      if (sql.prepare('SELECT COUNT(*) AS n FROM household_routines WHERE user_id=?').get(user.id).n >= 30) { send(res, 409, { error: 'You can save up to 30 routines. Delete one you no longer use.' }); return true; }
      const id = crypto.randomUUID(), now = new Date().toISOString();
      sql.prepare('INSERT INTO household_routines(id,user_id,name,kind,meal,people,duration_minutes,dishes,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, r.name, r.kind, r.meal, r.people, r.durationMinutes, r.dishes, r.instructions, now, now);
      send(res, 201, { routine: routineView(sql.prepare('SELECT * FROM household_routines WHERE id=?').get(id)) }); return true;
    }
    const one = url.pathname.match(/^\/api\/routines\/([^/]+)$/);
    if (one && (req.method === 'PUT' || req.method === 'DELETE')) {
      const existing = sql.prepare('SELECT id FROM household_routines WHERE id=? AND user_id=?').get(one[1], user.id);
      if (!existing) { send(res, 404, { error: 'Routine not found.' }); return true; }
      if (req.method === 'DELETE') { sql.prepare('DELETE FROM household_routines WHERE id=?').run(existing.id); send(res, 200, { ok: true }); return true; }
      const body = await readBody(); if (!body) return true;
      const r = validateRoutine(body); if (r.error) { send(res, 400, { error: r.error }); return true; }
      sql.prepare('UPDATE household_routines SET name=?,kind=?,meal=?,people=?,duration_minutes=?,dishes=?,instructions=?,updated_at=? WHERE id=?').run(r.name, r.kind, r.meal, r.people, r.durationMinutes, r.dishes, r.instructions, new Date().toISOString(), existing.id);
      send(res, 200, { routine: routineView(sql.prepare('SELECT * FROM household_routines WHERE id=?').get(existing.id)) }); return true;
    }
    return false;
  }
  // Extra cooking time: quote and request (household), decide (cook)
  const extension = url.pathname.match(/^\/api\/bookings\/([^/]+)\/extensions(\/quote)?$/);
  if (extension) {
    if (!requireRole(user, ['customer'], res)) return true;
    const booking = sql.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').get(extension[1], user.id);
    if (!booking) { send(res, 404, { error: 'Booking not found.' }); return true; }
    const body = req.method === 'POST' ? await readBody() : { minutes: url.searchParams.get('minutes') };
    if (!body) return true;
    const minutes = Number(body.minutes);
    if (!EXTENSION_MINUTES.includes(minutes)) { send(res, 400, { error: 'Choose 30, 60 or 90 extra minutes.' }); return true; }
    if (!booking.cook_profile_id || !EXTENDABLE_STATUSES.includes(booking.status)) { send(res, 409, { error: 'Extra time can be requested once a cook is assigned and before the session is completed.' }); return true; }
    if (bookingDuration(booking) + minutes > 300) { send(res, 409, { error: 'A single visit can be at most 5 hours.' }); return true; }
    const quote = extensionQuote(booking, minutes);
    if (extension[2] && req.method === 'GET') { send(res, 200, { quote }); return true; }
    if (req.method !== 'POST' || extension[2]) return false;
    if (sql.prepare("SELECT 1 FROM booking_extensions WHERE booking_id=? AND status='requested'").get(booking.id)) { send(res, 409, { error: 'You already have an extra-time request waiting for the cook.' }); return true; }
    if (!quote.cookHasTime) { send(res, 409, { error: 'Your cook has another visit right after this one, so extra time is not available.' }); return true; }
    const id = crypto.randomUUID(), now = new Date().toISOString();
    sql.prepare('INSERT INTO booking_extensions(id,booking_id,requested_by,minutes,price_paise,status,created_at) VALUES(?,?,?,?,?,?,?)').run(id, booking.id, user.id, minutes, quote.pricePaise, 'requested', now);
    const cookUser = sql.prepare('SELECT user_id AS userId FROM cook_profiles WHERE id=?').get(booking.cook_profile_id);
    if (cookUser && cookUser.userId) sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), cookUser.userId, booking.id, 'extension_request', `A household asked for ${minutes} extra minutes on the ${booking.slot} ${booking.date} visit. Open Schedule to approve or decline.`, now);
    send(res, 201, { extension: { id, minutes, pricePaise: quote.pricePaise, status: 'requested' }, quote }); return true;
  }
  const cookExtension = url.pathname.match(/^\/api\/cook\/extensions\/([^/]+)$/);
  if (req.method === 'POST' && cookExtension) {
    if (!requireRole(user, ['cook'], res)) return true;
    const body = await readBody(); if (!body) return true;
    const cook = sql.prepare('SELECT id,name FROM cook_profiles WHERE user_id=?').get(user.id);
    const ext = cook && sql.prepare("SELECT e.* FROM booking_extensions e JOIN bookings b ON b.id=e.booking_id WHERE e.id=? AND b.cook_profile_id=?").get(cookExtension[1], cook.id);
    if (!ext) { send(res, 404, { error: 'Extra-time request not found.' }); return true; }
    if (ext.status !== 'requested') { send(res, 409, { error: 'This request has already been answered.' }); return true; }
    const booking = sql.prepare('SELECT * FROM bookings WHERE id=?').get(ext.booking_id), now = new Date().toISOString();
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'decline' ? 'decline' : '';
    if (!decision) { send(res, 400, { error: 'Choose approve or decline.' }); return true; }
    if (decision === 'approve') {
      if (!EXTENDABLE_STATUSES.includes(booking.status)) { send(res, 409, { error: 'This visit can no longer be extended.' }); return true; }
      const quote = extensionQuote(booking, ext.minutes);
      if (!quote.cookHasTime) { send(res, 409, { error: 'You have another visit right after this one, so you cannot add this time.' }); return true; }
      sql.prepare('UPDATE bookings SET duration_minutes=?,price_paise=? WHERE id=?').run(quote.newDurationMinutes, quote.newTotalPaise, booking.id);
      sql.prepare('INSERT INTO payments(id,booking_id,user_id,amount_paise,status,provider,provider_reference,created_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), booking.id, booking.user_id, ext.price_paise, 'simulated-paid', 'simulated-extension', `SIM-${crypto.randomUUID()}`, now);
      revalidatePendingOffersForCook(cook.id, booking.date);
    }
    sql.prepare('UPDATE booking_extensions SET status=?,responded_at=? WHERE id=?').run(decision === 'approve' ? 'approved' : 'declined', now, ext.id);
    sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), booking.user_id, booking.id, 'booking_status', decision === 'approve' ? `${cook.name} approved ${ext.minutes} extra minutes. The extra ₹${ext.price_paise / 100} was recorded as a demo payment.` : `${cook.name} could not add the ${ext.minutes} extra minutes you asked for. No extra charge was made.`, now);
    send(res, 200, { ok: true, status: decision === 'approve' ? 'approved' : 'declined' }); return true;
  }
  // Cook reviews and language preference
  if (req.method === 'GET' && url.pathname === '/api/cook/reviews') {
    if (!requireRole(user, ['cook'], res)) return true;
    const cook = sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);
    if (!cook) { send(res, 404, { error: 'Cook profile not found.' }); return true; }
    send(res, 200, { summary: cookRatingSummary(cook.id), reviews: cookReviews(cook.id) }); return true;
  }
  if (req.method === 'PUT' && url.pathname === '/api/cook/preferences') {
    if (!requireRole(user, ['cook'], res)) return true;
    const body = await readBody(); if (!body) return true;
    if (!['en', 'hi'].includes(body.language)) { send(res, 400, { error: 'Choose English or Hindi.' }); return true; }
    sql.prepare('UPDATE cook_profiles SET preferred_language=? WHERE user_id=?').run(body.language, user.id);
    send(res, 200, { ok: true, language: body.language }); return true;
  }
  // Hourly pricing (platform admin)
  if (url.pathname === '/api/admin/pricing') {
    if (!requireRole(user, ['platform_admin'], res)) return true;
    if (req.method === 'GET') { send(res, 200, { hourlyRatePaise: hourlyRatePaise() }); return true; }
    if (req.method === 'PUT') {
      const body = await readBody(); if (!body) return true;
      const rupees = Number(body.hourlyRateRupees);
      if (!Number.isInteger(rupees) || rupees < 50 || rupees > 5000) { send(res, 400, { error: 'Enter an hourly rate between ₹50 and ₹5,000.' }); return true; }
      sql.prepare('INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run('hourly_rate_paise', String(rupees * 100), new Date().toISOString());
      logAdmin(user, 'hourly_rate_updated', 'pricing', 'hourly_rate_paise', `₹${rupees}/hour`);
      send(res, 200, { ok: true, hourlyRatePaise: rupees * 100 }); return true;
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-landing.html'));
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const asset = LANDING_IMAGE_FILES[url.pathname.slice('/media/'.length)];
    if (!asset) return send(res, 404, { error: 'Asset not found' });
    return serveFile(res, path.join(WEB_ROOT, asset), { 'Cache-Control': 'public, max-age=86400' });
  }
  if (req.method === 'GET' && url.pathname === '/cookcircle-diet-plate.jpg') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-diet-plate.jpg'));
  if (req.method === 'GET' && url.pathname === '/cookcircle-vegetable-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'cookcircle-vegetable-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/admin-legumes-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'admin-legumes-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/household-dried-fruit-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'household-dried-fruit-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/cook-workspace-vegetables-background.jpg') return serveFile(res, path.join(WEB_ROOT, 'cook-workspace-vegetables-background.jpg'));
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'CookCircle MVP API', build: USE_POSTGRES ? 'postgres-booking-models-v3' : 'sqlite-booking-models-v3', database: { engine: USE_POSTGRES ? 'PostgreSQL' : 'SQLite', connected: sql.prepare('SELECT 1 AS ok').get().ok === 1, persistent: true, ...(USE_POSTGRES ? {} : { file: path.basename(DB_FILE) }) }, features: { dynamicPersistentDatabase: true, bookingCheckinCodeInHouseholdBookings: true, publicHelpRequests: true, resolvedHelpRequestClear: true, emailSignupVerification: true, mobileSignupVerification: false, cookSignupWithoutResidence: true, cookDefaultAvatars: true, profilePhotoCrop: true, alphanumericCaptcha: true, caseSensitiveMixedCaptcha: true, dietPlateImage: true, vegetableBackground: true, societyRegistrationReview: true, adminPasswordReset: true, existingAdminPromotion: true, cookAndSocietyRemoval: true, adminBackground: true, permanentAdminDeletes: true, societySessionRevocation: true, removedCookCashoutOnly: true, hourlyPricing: true, regularBookings: true, clusterAllocation: true, cookabilityPreview: true, routineTemplates: true, awayMode: true, bookingExtensions: true, passwordReset: true, cookHindi: true, helpAssistant: Boolean(process.env.ANTHROPIC_API_KEY) ? 'ai' : 'guide' } });
  if (req.method === 'GET' && url.pathname === '/api/societies') return send(res, 200, { societies: db.societies });
  if (req.method === 'GET' && url.pathname === '/api/services') return send(res,200,{services:sql.prepare('SELECT id,name,duration_minutes AS durationMinutes,base_price_paise AS pricePaise FROM service_categories WHERE active=1 ORDER BY name').all(),hourlyRatePaise:hourlyRatePaise(),durations:BOOKING_DURATIONS});

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
      if (!['customer','cook'].includes(role)) return send(res, 403, { error: 'Administrator accounts must be configured by the operator.' });
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

  if (url.pathname.startsWith('/api/') && await handlePublicFeatureRoutes(req, res, url)) return;
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
    if (await handleFeatureRoutes(req, res, url, user)) return;
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
      return send(res,200,{bookings:sql.prepare(`SELECT b.id,b.date,b.slot,b.meal,b.status,b.society_id AS societyId,b.payment_status AS paymentStatus,b.price_paise AS pricePaise,b.duration_minutes AS durationMinutes,b.booking_type AS bookingType,b.fulfilment,b.visit_start AS visitStart,u.name AS household,u.apartment,s.name AS society,b.cook,c.name AS assignedCookName FROM bookings b JOIN users u ON u.id=b.user_id JOIN societies s ON s.id=b.society_id LEFT JOIN cook_profiles c ON c.id=b.cook_profile_id ORDER BY b.date DESC,b.slot`).all()});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/cooks') {
      if (!requireRole(user,['platform_admin'],res)) return;
      const cooks=sql.prepare(`SELECT c.id,c.name,c.society_id AS societyId,sc.name AS serviceSocietyName,c.verification_status AS verificationStatus,c.is_active AS isActive,c.specialties,c.address_encrypted AS addressEncrypted,c.address_nonce AS addressNonce,c.address_tag AS addressTag,c.phone_encrypted AS phoneEncrypted,c.phone_nonce AS phoneNonce,c.phone_tag AS phoneTag,c.years_experience AS yearsExperience,c.is_demo AS isDemo,u.email FROM cook_profiles c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN societies sc ON sc.id=c.society_id ORDER BY c.is_demo,c.name`).all().map(c=>({...c,address:decryptSensitiveText(c.addressEncrypted,c.addressNonce,c.addressTag),phone:decryptSensitiveText(c.phoneEncrypted,c.phoneNonce,c.phoneTag),serviceSocieties:sql.prepare(`SELECT ss.id,ss.name,ss.city,a.status FROM cook_service_societies a JOIN societies ss ON ss.id=a.society_id WHERE a.cook_id=? ORDER BY ss.name`).all(c.id),rating:cookRatingSummary(c.id)}));
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
      const signupSocietyIds=new Set(sql.prepare('SELECT society_id AS societyId FROM cook_service_societies WHERE cook_id=?').all(row.id).map(item=>item.societyId));
      if(status==='approved'&&serviceSocietyIds.some(id=>!signupSocietyIds.has(id)))return send(res,400,{error:'Approve only the societies this cook selected at signup.'});
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
    if(req.method==='PATCH'&&adminCookActive){if(!requireRole(user,['platform_admin'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}if(typeof body.active!=='boolean')return send(res,400,{error:'Choose whether to remove or restore this cook.'});const result=sql.prepare('UPDATE cook_profiles SET is_active=? WHERE id=?').run(body.active?1:0,adminCookActive[1]);if(!result.changes)return send(res,404,{error:'Cook not found.'});if(!body.active){withdrawPendingOffersForCook(adminCookActive[1]);for(const booking of sql.prepare("SELECT id FROM bookings WHERE cook_profile_id=? AND status IN ('Cook assigned','Replacement confirmed','Cook en route') AND date>=?").all(adminCookActive[1],new Date().toISOString().slice(0,10)))reopenBookingForOtherCooks(booking.id,adminCookActive[1],'Assigned cook was removed by the platform administrator')}logAdmin(user,body.active?'cook_restored':'cook_removed','cook',adminCookActive[1],body.active?'active':'removed from new bookings');queueAdminDirectorySync();return send(res,200,{ok:true,active:body.active});}
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
      if(!body.active){
        sql.prepare("UPDATE sessions SET revoked_reason='society_removed' WHERE user_id IN (SELECT id FROM users WHERE society_id=?)").run(adminSocietyActive[1]);
        const now=new Date().toISOString();
        for(const booking of sql.prepare("SELECT id FROM bookings WHERE society_id=? AND cook_profile_id IS NULL AND status='Confirmed'").all(adminSocietyActive[1])){sql.prepare("UPDATE booking_cook_offers SET status='expired',responded_at=? WHERE booking_id=? AND status='pending'").run(now,booking.id);closeBookingAfterAllCookDeclines(booking.id,'unavailable')}
      }
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
      if(!requireRole(user,['cook'],res))return;const c=sql.prepare(`SELECT id,name,verification_status AS verificationStatus,years_experience AS yearsExperience,specialties,bio,address_encrypted AS addressEncrypted,address_nonce AS addressNonce,address_tag AS addressTag,phone_encrypted AS phoneEncrypted,phone_nonce AS phoneNonce,phone_tag AS phoneTag,photo_file_name AS photoFileName,photo_avatar_id AS photoAvatarId,preferred_language AS preferredLanguage FROM cook_profiles WHERE user_id=?`).get(user.id);if(!c)return send(res,404,{error:'Cook profile not found.'});
      try{return send(res,200,{profile:{id:c.id,name:c.name,verificationStatus:c.verificationStatus,yearsExperience:c.yearsExperience,specialties:JSON.parse(c.specialties||'[]'),bio:c.bio,address:decryptSensitiveText(c.addressEncrypted,c.addressNonce,c.addressTag),phone:decryptSensitiveText(c.phoneEncrypted,c.phoneNonce,c.phoneTag),photoAvailable:Boolean(c.photoFileName),photoAvatarId:c.photoAvatarId||'sage',preferredLanguage:c.preferredLanguage==='hi'?'hi':'en',rating:cookRatingSummary(c.id)}})}catch{return send(res,500,{error:'Could not read your cook profile. Check the document encryption key.'})}
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
        const missed=sql.prepare(`SELECT b.id FROM bookings b JOIN cook_service_societies a ON a.cook_id=? AND a.society_id=b.society_id AND a.status='approved' WHERE b.cook_profile_id IS NULL AND b.status='Confirmed' AND b.payment_status IN ('simulated-paid','credit-applied') AND b.date>=date('now') AND NOT EXISTS(SELECT 1 FROM booking_cook_offers o WHERE o.booking_id=b.id AND o.cook_id=?) AND (b.plan_id IS NULL OR NOT EXISTS(SELECT 1 FROM booking_cook_offers p WHERE p.booking_id=b.id AND p.status='pending'))`).all(cook.id,cook.id);

        for(const booking of missed)autoAssignBooking(booking.id,{broadcast:true});
      }
      cook.serviceSocieties=sql.prepare(`SELECT s.id,s.name,s.city FROM cook_service_societies a JOIN societies s ON s.id=a.society_id WHERE a.cook_id=? AND a.status='approved' AND s.is_active=1 ORDER BY s.name`).all(cook.id);
      sweepBookingRequests();
      const bookings=sql.prepare(`SELECT b.id,b.date,b.slot,b.meal,b.cook_profile_id AS cookProfileId,society.name AS societyName,b.duration_minutes AS durationMinutes,b.booking_type AS bookingType,b.fulfilment,b.visit_start AS visitStart,b.dishes AS dishesJson,b.estimate_minutes AS estimateMinutes,b.user_id AS householdUserId,
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
            const {householdPhoneEncrypted,householdPhoneNonce,householdPhoneTag,dishesJson,householdUserId,...booking}=b;
            const extra={durationMinutes:bookingDuration(b),dishes:parseDishes(dishesJson),visitStart:b.visitStart||toClock(slotWindow(b.slot).start)};
            if(!assignedToCook)return {...booking,...extra,householdPhone};
            // The Household Operating Brief is shared only with the cook assigned to this visit, and only if the household allows it.
            const h=sql.prepare('SELECT family_members AS familyMembers,cuisines,dietary_preferences AS dietaryPreferences,cooking_styles AS cookingStyles,instructions,allergies,spice_level AS spiceLevel,oil_preference AS oilPreference,regular_dishes AS regularDishes,roti_requirements AS rotiRequirements,kitchen_equipment AS kitchenEquipment,other_instructions AS otherInstructions,share_brief AS shareBrief FROM households WHERE user_id=?').get(householdUserId);
            const {shareBrief,...brief}=h||{};
            const extensions=sql.prepare("SELECT id,minutes,price_paise AS pricePaise,status,created_at AS createdAt FROM booking_extensions WHERE booking_id=? ORDER BY created_at DESC").all(b.id);
            return {...booking,...extra,householdPhone,brief:h&&shareBrief?brief:null,briefShared:Boolean(h&&shareBrief),extensions};
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
      const personal=new Set(sql.prepare('SELECT slot FROM cook_availability WHERE cook_id=? AND date=? AND available=0').all(cook.id,date).map(x=>x.slot)),visits=cookDayIntervals(cook.id,date).filter(iv=>!iv.blocked);return send(res,200,{date,slots:slots.map(slot=>{const w=slotWindow(slot),isBooked=visits.some(iv=>iv.start<w.end&&w.start<iv.end),unavailableByCook=personal.has(slot);return {slot,available:!unavailableByCook&&!isBooked,unavailableByCook,booked:isBooked}})});
    }
    if(req.method==='PUT'&&url.pathname==='/api/cook/availability'){
      if(!requireRole(user,['cook'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}const cook=sql.prepare('SELECT id FROM cook_profiles WHERE user_id=?').get(user.id);if(!cook)return send(res,404,{error:'Cook profile not found.'});if(!dateAllowed(body.date)||!slots.includes(body.slot))return send(res,400,{error:'Choose a valid date and session.'});{const w=slotWindow(body.slot);if(!body.available&&cookDayIntervals(cook.id,body.date).some(iv=>!iv.blocked&&iv.start<w.end&&w.start<iv.end))return send(res,409,{error:'This session already has an assigned visit.'})}
      sql.prepare('INSERT INTO cook_availability(id,cook_id,date,slot,available) VALUES(?,?,?,?,?) ON CONFLICT(cook_id,date,slot) DO UPDATE SET available=excluded.available').run(crypto.randomUUID(),cook.id,body.date,body.slot,body.available?1:0);if(!body.available)revalidatePendingOffersForCook(cook.id,body.date);return send(res,200,{ok:true});
    }
    const cookBooking=url.pathname.match(/^\/api\/cook\/bookings\/([^/]+)\/status$/);
    if(req.method==='POST'&&cookBooking){
      if(!requireRole(user,['cook'],res))return;
      let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const cook=sql.prepare('SELECT id,name,verification_status AS verificationStatus,is_active AS isActive FROM cook_profiles WHERE user_id=?').get(user.id);
      if(!cook||cook.verificationStatus!=='approved'||!cook.isActive)return send(res,403,{error:'Your cook profile must be approved and active before accepting bookings.'});
      const booking=sql.prepare('SELECT id,user_id,society_id,date,slot,status,duration_minutes,plan_id,service_otp_hash AS otpHash,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(cookBooking[1]);if(!booking)return send(res,404,{error:'Booking not found.'});
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
            const stillPending=sql.prepare("SELECT 1 FROM booking_cook_offers WHERE booking_id=? AND status='pending'").get(booking.id);
            const rerouted=stillPending?0:autoAssignBooking(booking.id,{broadcast:true})||0;
            const bookingClosed=stillPending||rerouted?false:closeBookingAfterAllCookDeclines(booking.id);
            return send(res,200,{ok:true,declined:true,rerouted,bookingClosed});
          }
          const paid=sql.prepare("SELECT 1 FROM bookings WHERE id=? AND payment_status IN ('simulated-paid','credit-applied')").get(booking.id);
          if(!paid)return send(res,409,{error:'This booking is not yet paid or covered by a session credit.'});
          const visit=feasibleVisit(cookDayIntervals(cook.id,booking.date),booking.slot,bookingDuration(booking),booking.society_id);
          if(!visit)return send(res,409,{error:'You are no longer available for this session.'});
          const claimed=sql.prepare("UPDATE bookings SET status='Cook assigned',cook=?,cook_profile_id=?,visit_start=?,fulfilment=? WHERE id=? AND cook_profile_id IS NULL AND status='Confirmed'").run(`Cook · ${cook.name}`,cook.id,visit.visitStart,visit.fulfilment,booking.id);
          if(!claimed.changes)return send(res,409,{error:'Another cook has already accepted this request.'});
          sql.prepare("UPDATE booking_cook_offers SET status=CASE WHEN cook_id=? THEN 'accepted' ELSE 'expired' END,responded_at=? WHERE booking_id=? AND status='pending'").run(cook.id,now,booking.id);
          revalidatePendingOffersForCook(cook.id,booking.date);
          if(booking.plan_id)sql.prepare('UPDATE recurring_plans SET preferred_cook_id=? WHERE id=? AND preferred_cook_id IS NULL').run(cook.id,booking.plan_id);
          sql.prepare('INSERT INTO booking_status_history(id,booking_id,status,note,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),booking.id,'Cook assigned','Accepted by cook',now);
          sql.prepare('INSERT INTO notifications(id,user_id,booking_id,kind,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),booking.user_id,booking.id,'booking_status',`Booking accepted by ${cook.name}. The visit starts at ${visit.visitStart}.`,now);
          return send(res,200,{ok:true,accepted:true});
        }
        if(body.action==='reject')return send(res,404,{error:'This request is no longer available.'});
        if(booking.status!=='Confirmed'||booking.cookProfileId!==cook.id)return send(res,409,{error:'This booking is no longer available.'});setBookingStatus(booking.id,'Cook assigned','Accepted by cook',cook.id);
      }
      else{const owned=sql.prepare('SELECT id FROM bookings WHERE id=? AND cook_profile_id=?').get(booking.id,cook.id);if(!owned)return send(res,403,{error:'This booking is not assigned to you.'});
        const allowedFrom={enroute:['Cook assigned','Replacement confirmed'],checkin:['Cook assigned','Replacement confirmed','Cook en route'],start:['Checked in'],complete:['In progress'],unavailable:['Cook assigned','Replacement confirmed','Cook en route']};
        if(!allowedFrom[body.action].includes(booking.status))return send(res,409,{error:`This booking is ${booking.status}; that update is not available now.`});
        if(body.action==='unavailable'){
          const now=new Date().toISOString();
          sql.prepare('INSERT INTO backup_assignments(id,booking_id,primary_cook_id,status,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),booking.id,cook.id,'needed',now);
          sql.prepare('INSERT INTO cook_availability(id,cook_id,date,slot,available) VALUES(?,?,?,?,0) ON CONFLICT(cook_id,date,slot) DO UPDATE SET available=0').run(crypto.randomUUID(),cook.id,booking.date,booking.slot);
          reopenBookingForOtherCooks(booking.id,cook.id,'Assigned cook reported unavailable');
          return send(res,200,{ok:true,rerouted:true});
        }
        if(body.action==='checkin'){const supplied=crypto.createHash('sha256').update(String(body.otp||'')).digest('hex');if(!booking.otpHash||!crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(booking.otpHash,'hex')))return send(res,400,{error:'The customer check-in code is incorrect.'})}const next=transition[0];setBookingStatus(booking.id,next,'Cook updated the service status')}
      return send(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname === '/api/profile') {
      if(!requireRole(user,['customer'],res))return;
      return send(res,200,{profile:sql.prepare('SELECT h.household_name AS householdName,h.family_members AS familyMembers,h.cuisines,h.dietary_preferences AS dietaryPreferences,h.cooking_styles AS cookingStyles,h.instructions,h.allergies,h.spice_level AS spiceLevel,h.oil_preference AS oilPreference,h.regular_dishes AS regularDishes,h.roti_requirements AS rotiRequirements,h.kitchen_equipment AS kitchenEquipment,h.other_instructions AS otherInstructions,h.share_brief AS shareBrief,s.name AS societyName,s.city AS societyCity FROM households h JOIN societies s ON s.id=h.society_id WHERE h.user_id=?').get(user.id)});
    }
    if (req.method === 'PUT' && url.pathname === '/api/profile') {
      if(!requireRole(user,['customer'],res))return;let body;try{body=await getBody(req)}catch(e){return send(res,400,{error:e.message})}
      const spiceLevels=['','mild','medium','spicy','very spicy'],oilLevels=['','less oil','normal','more oil'];
      if(body.spiceLevel!==undefined&&!spiceLevels.includes(body.spiceLevel))return send(res,400,{error:'Choose a spice level from the list.'});
      if(body.oilPreference!==undefined&&!oilLevels.includes(body.oilPreference))return send(res,400,{error:'Choose an oil preference from the list.'});
      const current=sql.prepare('SELECT spice_level AS spiceLevel,oil_preference AS oilPreference,regular_dishes AS regularDishes,roti_requirements AS rotiRequirements,kitchen_equipment AS kitchenEquipment,other_instructions AS otherInstructions,share_brief AS shareBrief FROM households WHERE user_id=?').get(user.id)||{};
      const keep=(key,max)=>body[key]===undefined?String(current[key]||''):String(body[key]||'').slice(0,max);
      sql.prepare('UPDATE households SET household_name=?,family_members=?,cuisines=?,dietary_preferences=?,cooking_styles=?,instructions=?,allergies=?,spice_level=?,oil_preference=?,regular_dishes=?,roti_requirements=?,kitchen_equipment=?,other_instructions=?,share_brief=?,updated_at=? WHERE user_id=?')
        .run(String(body.householdName||'').trim().slice(0,80),Math.max(1,Math.min(20,Number(body.familyMembers)||1)),String(body.cuisines||'').slice(0,300),String(body.dietaryPreferences||'').slice(0,300),String(body.cookingStyles||'').slice(0,300),String(body.instructions||'').slice(0,1000),String(body.allergies||'').slice(0,500),keep('spiceLevel',20),keep('oilPreference',20),keep('regularDishes',500),keep('rotiRequirements',300),keep('kitchenEquipment',500),keep('otherInstructions',1000),body.shareBrief===undefined?(current.shareBrief===0?0:1):(body.shareBrief===false?0:1),new Date().toISOString(),user.id);
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
      if(action==='cancel'){if(['Completed','Cancelled','Refunded','No cook available'].includes(booking.status))return send(res,409,{error:'This booking can no longer be cancelled.'});cancelBookingForHousehold(booking,'Cancelled by customer');return send(res,200,{ok:true,refundPolicy:'Demo cancellation; no real payment was collected.'})}
            if(action==='pay'){if(booking.payment_status!=='unpaid-demo')return send(res,409,{error:'This booking has already been paid or confirmed.'});if(booking.status!=='Requested')return send(res,409,{error:'This booking is no longer open for payment.'});if(!dateAllowed(booking.date))return send(res,409,{error:'This session date has passed. Please book a new session.'});if(!sql.prepare('SELECT id FROM societies WHERE id=? AND is_active=1').get(booking.society_id))return send(res,403,{error:'Your society is no longer active on CookCircle. Contact the platform administrator.'});sql.prepare("UPDATE bookings SET payment_status='simulated-paid' WHERE id=?").run(id);sql.prepare("UPDATE payments SET status='simulated-paid',provider_reference=? WHERE booking_id=?").run(`SIM-${crypto.randomUUID()}`,id);setBookingStatus(id,'Confirmed','Simulated payment successful');const requestCount=autoAssignBooking(id),bookingClosed=requestCount===0?closeBookingAfterAllCookDeclines(id,'unavailable'):false;return send(res,200,{ok:true,simulated:true,requestsSent:requestCount,bookingClosed,message:bookingClosed?'No approved cook was available for this session. The demo payment has been marked for refund.':''})}
      if(action==='review'){if(booking.status!=='Completed'||!booking.cook_profile_id)return send(res,409,{error:'You can review a booking after a cook completes it.'});if(sql.prepare('SELECT 1 FROM reviews WHERE booking_id=?').get(id))return send(res,409,{error:'A review already exists for this booking.'});const rating=Math.max(1,Math.min(5,Number(body.rating)||0));try{sql.prepare('INSERT INTO reviews(id,booking_id,user_id,cook_id,rating,comment,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,user.id,booking.cook_profile_id,rating,String(body.comment||'').slice(0,1000),new Date().toISOString());return send(res,201,{ok:true})}catch{return send(res,409,{error:'A review already exists for this booking.'})}}
    }
    if (req.method === 'GET' && url.pathname === '/api/me') { const profile=user.role==='cook'?sql.prepare('SELECT is_active AS isActive FROM cook_profiles WHERE user_id=?').get(user.id):null; return send(res,200,{user:{...cleanUser(user),...(user.role==='cook'?{cookRemoved:!profile||!profile.isActive}:{})}}); }
    if (req.method === 'GET' && url.pathname === '/api/availability') {
      if(!requireRole(user,['customer'],res))return;
      const date = url.searchParams.get('date'); if (!dateAllowed(date)) return send(res, 400, { error: 'Choose a date within the next seven days.' });
      const durationMinutes=BOOKING_DURATIONS.includes(Number(url.searchParams.get('duration')))?Number(url.searchParams.get('duration')):LEGACY_DURATION_MINUTES;
      const household=sql.prepare('SELECT society_id AS societyId FROM households WHERE user_id=?').get(user.id);if(!household)return send(res,409,{error:'Your household profile needs a registered society before you can book.'});
      const sunday=weekday(date)===0;
      return send(res, 200, { date, durationMinutes, pricePaise: priceForMinutes(durationMinutes), slots: slots.map(time => { const tooSoon=sessionStartMs(date,time)-Date.now()<MIN_LEAD_MINUTES*60000; return { time, available: !sunday && !tooSoon && Boolean(findAvailableCook(household.societyId,date,time,durationMinutes)), reason: sunday?'closed':tooSoon?'too_soon':undefined }; }) });
    }
    if (req.method === 'GET' && url.pathname === '/api/bookings') {
      if(!requireRole(user,['customer'],res))return;
      generateRecurringSessions(user.id);
      const codeRows=sql.prepare("SELECT booking_id AS bookingId,message FROM notifications WHERE user_id=? AND kind='booking_requested' AND booking_id IS NOT NULL").all(user.id);
      const checkinCodes=new Map(codeRows.map(n=>[n.bookingId,(String(n.message||'').match(/check-in code(?: is|:)\s*(\d{6})/)||[])[1]||'']));
      const bookings = sql.prepare(`SELECT b.id,b.user_id AS userId,b.society_id AS societyId,b.date,b.slot,b.meal,b.people,b.instructions,b.cook,b.price_paise AS pricePaise,b.payment_status AS paymentStatus,b.status,b.created_at AS createdAt,b.subscription_id AS subscriptionId,b.cook_profile_id AS cookProfileId,b.duration_minutes AS durationMinutes,b.booking_type AS bookingType,b.plan_id AS planId,b.visit_start AS visitStart,b.dishes AS dishesJson,b.estimate_minutes AS estimateMinutes,b.paused_for_away AS pausedForAway,c.years_experience AS cookYearsExperience,c.specialties AS cookSpecialties,(SELECT r.rating FROM reviews r WHERE r.booking_id=b.id) AS reviewRating,c.name AS assignedCookName,c.phone AS legacyCookPhone,c.phone_encrypted AS cookPhoneEncrypted,c.phone_nonce AS cookPhoneNonce,c.phone_tag AS cookPhoneTag FROM bookings b LEFT JOIN cook_profiles c ON c.id=b.cook_profile_id WHERE b.user_id=? ORDER BY b.date,b.slot`).all(user.id).map(b=>{
        const {legacyCookPhone,cookPhoneEncrypted,cookPhoneNonce,cookPhoneTag,assignedCookName,dishesJson,cookYearsExperience,cookSpecialties,...booking}=b;
        const mayContactCook=Boolean(b.cookProfileId)&&!['Cancelled','Refunded'].includes(b.status);let cookPhone='';
        if(mayContactCook)cookPhone=decryptSensitiveText(cookPhoneEncrypted,cookPhoneNonce,cookPhoneTag)||legacyCookPhone||'';
        let specialties=[];try{specialties=JSON.parse(cookSpecialties||'[]')}catch{}
        const cookProfile=b.cookProfileId?{name:assignedCookName,yearsExperience:cookYearsExperience,specialties,rating:cookRatingSummary(b.cookProfileId)}:null;
        const extensions=sql.prepare('SELECT id,minutes,price_paise AS pricePaise,status,created_at AS createdAt FROM booking_extensions WHERE booking_id=? ORDER BY created_at DESC').all(b.id);
        return {...booking,durationMinutes:bookingDuration(b),dishes:parseDishes(dishesJson),pausedForAway:Boolean(b.pausedForAway),reviewed:b.reviewRating!==null&&b.reviewRating!==undefined,cook:assignedCookName?`Cook · ${assignedCookName}`:b.cook,cookProfile,cookPhone,checkinCode:checkinCodes.get(b.id)||'',extensions};
      });
      return send(res, 200, { bookings });
    }
    if (req.method === 'POST' && url.pathname === '/api/bookings') {
      if(!requireRole(user,['customer'],res))return;
      let body; try { body = await getBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
      const result=createBookingForHousehold(user,body);
      if(result.error)return send(res,result.status,{error:result.error});
      const {booking,requestCount,bookingClosed}=result,{serviceOtpHash,...publicBooking}=booking;
      const saved=sql.prepare('SELECT status,cook,cook_profile_id AS cookProfileId FROM bookings WHERE id=?').get(booking.id);
      const assignmentMessage=bookingClosed?'No approved cook was available for this session. Your session credit has been returned.':booking.paymentStatus==='credit-applied'?`Your request was sent to ${requestCount} approved cook${requestCount===1?'':'s'} serving your society.`:'Your booking is saved. Complete the demo payment to send it to matching cooks.';
      return send(res, 201, { booking:{...publicBooking,...saved,requestCount,assignmentMessage} });
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

runScheduledBookingWork();
setInterval(runScheduledBookingWork, 5 * 60_000).unref();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`CookCircle is listening on port ${PORT}`);
  console.log(`Persistent SQLite database: ${DB_FILE}`);
});
