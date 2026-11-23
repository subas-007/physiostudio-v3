'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'physiostudio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','therapist','receptionist','accountant','patient')),
  is_active INTEGER NOT NULL DEFAULT 1,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS login_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_to TEXT,
  patient_sid TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  patient_code TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth TEXT,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT COLLATE NOCASE,
  address TEXT,
  occupation TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  referred_by TEXT,
  medical_history TEXT,
  allergies TEXT,
  current_medications TEXT,
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_whatsapp INTEGER NOT NULL DEFAULT 1,
  consent_treatment INTEGER NOT NULL DEFAULT 0,
  consent_communication INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  designation TEXT,
  qualification TEXT,
  nhpc_no TEXT,
  bio TEXT,
  photo TEXT,
  is_bookable INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- weekday: 0=Sunday .. 6=Saturday
CREATE TABLE IF NOT EXISTS staff_hours (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_leave (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE, -- NULL = clinic closed (holiday)
  date TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  body TEXT,
  image TEXT,
  duration_min INTEGER NOT NULL DEFAULT 45,
  price REAL NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_bookable INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  staff_id INTEGER REFERENCES staff(id),
  service_id INTEGER REFERENCES services(id),
  date TEXT NOT NULL,            -- YYYY-MM-DD (clinic local time)
  start_time TEXT NOT NULL,      -- HH:MM
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','checked_in','completed','cancelled','no_show')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','portal','admin','phone','walk_in')),
  complaint TEXT,
  internal_note TEXT,
  cancel_reason TEXT,
  manage_token_hash TEXT,
  reminder_24h_sent INTEGER NOT NULL DEFAULT 0,
  reminder_2h_sent INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, start_time);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_staff_date ON appointments(staff_id, date);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  note_type TEXT NOT NULL DEFAULT 'progress' CHECK (note_type IN ('initial_assessment','progress','discharge')),
  pain_score INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  amended_from INTEGER REFERENCES clinical_notes(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','partial','paid','void')),
  notes TEXT,
  void_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inv_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(issue_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id),
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  receipt_no TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card','esewa','khalti','fonepay','bank','other')),
  reference TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  received_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ---------- CMS ----------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS content_blocks (
  key TEXT PRIMARY KEY,          -- e.g. home.hero.title
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','textarea','markdown','image')),
  value TEXT,
  section TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  body TEXT NOT NULL,
  photo TEXT,
  rating INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  body TEXT,
  cover TEXT,
  author TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS body_areas (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS why_us (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  alt TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Notifications & audit ----------
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id),
  patient_id INTEGER REFERENCES patients(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  kind TEXT NOT NULL,            -- booking_received, confirmed, reminder_24h, reminder_2h, cancelled, rescheduled
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER,
  user_label TEXT,
  ip TEXT,
  action TEXT NOT NULL,           -- e.g. patient.view, invoice.void, auth.login_failed
  entity TEXT,
  entity_id INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- Audit log is append-only: block updates and deletes at the database layer.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Locked clinical notes cannot be edited; amendments are new rows.
CREATE TRIGGER IF NOT EXISTS notes_locked BEFORE UPDATE ON clinical_notes
WHEN OLD.is_locked = 1
BEGIN SELECT RAISE(ABORT, 'clinical note is locked; add an amendment'); END;
`;

db.exec(SCHEMA);

// ---------- v2 additions (idempotent; safe on existing databases) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  audience TEXT,
  summary TEXT,
  price REAL,
  price_unit TEXT,
  features TEXT,
  badge TEXT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY,
  image TEXT NOT NULL,
  caption TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  description TEXT,
  body_area_id INTEGER REFERENCES body_areas(id) ON DELETE SET NULL,
  level TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS slides (
  id INTEGER PRIMARY KEY,
  image TEXT NOT NULL,
  image_mobile TEXT,
  focus TEXT NOT NULL DEFAULT 'center',
  title TEXT NOT NULL,
  text TEXT,
  button_label TEXT,
  button_link TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);`);
function ensureColumn(table, column, ddl) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
ensureColumn('login_tickets', 'patient_sid', 'TEXT');
ensureColumn('body_areas', 'blurb', 'TEXT');
ensureColumn('body_areas', 'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');
ensureColumn('body_areas', 'map_key', 'TEXT');
ensureColumn('posts', 'category', 'TEXT');
ensureColumn('appointments', 'package_id', 'INTEGER REFERENCES packages(id) ON DELETE SET NULL');

/** Atomic sequential counter, e.g. invoice numbers per fiscal year. */
const nextCounter = db.transaction((name) => {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  const value = row ? row.value + 1 : 1;
  db.prepare('INSERT INTO counters(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, value);
  return value;
});

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function contentMap() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM content_blocks').all()) out[r.key] = r.value || '';
  return out;
}

module.exports = { db, nextCounter, getSetting, setSetting, allSettings, contentMap, DATA_DIR };
