
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
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, phone_hash TEXT UNIQUE,
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
    address_encrypted BYTEA, address_nonce BYTEA, address_tag BYTEA,
    phone_encrypted BYTEA, phone_nonce BYTEA, phone_tag BYTEA,
    bio TEXT NOT NULL DEFAULT '', photo_file_name TEXT, photo_mime_type TEXT,
    photo_encrypted BYTEA, photo_nonce BYTEA, photo_tag BYTEA, photo_avatar_id TEXT NOT NULL DEFAULT 'sage',
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
    mime_type TEXT NOT NULL, encrypted_data BYTEA NOT NULL, nonce BYTEA NOT NULL, auth_tag BYTEA NOT NULL,
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
    phone_encrypted BYTEA, phone_nonce BYTEA, phone_tag BYTEA, updated_at TEXT NOT NULL
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

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cook_profile_id TEXT REFERENCES cook_profiles(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'on_demand';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS plan_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fulfilment TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visit_start TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dishes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paused_for_away INTEGER NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN IF NOT EXISTS spice_level TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS oil_preference TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS regular_dishes TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS roti_requirements TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS kitchen_equipment TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS other_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE households ADD COLUMN IF NOT EXISTS share_brief INTEGER NOT NULL DEFAULT 1;
ALTER TABLE households ADD COLUMN IF NOT EXISTS routines_seeded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cook_profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';
CREATE UNIQUE INDEX IF NOT EXISTS bookings_plan_date_active ON bookings(plan_id,date) WHERE plan_id IS NOT NULL AND paused_for_away=0;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL;
