// Usage: node scripts/create-admin.js email@domain "Full Name"   – creates an admin with a one-time password
require('dotenv').config({ quiet: true });
const { db } = require('../src/db');
const sec = require('../src/lib/security');
const [email, name = 'Administrator'] = process.argv.slice(2);
if (!email) { console.error('Usage: node scripts/create-admin.js email "Full Name"'); process.exit(1); }
const pw = sec.randomToken(12) + 'A1!';
db.prepare("INSERT INTO users(email, full_name, password_hash, role, must_change_password) VALUES (?,?,?,'admin',1) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role='admin', is_active=1, must_change_password=1, locked_until=NULL, failed_logins=0")
  .run(email.toLowerCase(), name, sec.hashPassword(pw));
console.log(`Admin ${email} – temporary password: ${pw}`);
