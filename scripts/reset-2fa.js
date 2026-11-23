'use strict';
// Clears two-factor for one account, so it is set up again at its next sign-in. Run on the server:
//   node scripts/reset-2fa.js email@domain
if (require.main === module) require('dotenv').config({ quiet: true });
const { db } = require('../src/db');

/** Returns the account that was reset, or null if no account has that email. */
function resetTwoFactor(email) {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user) return null;
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(user.id);
  db.prepare("INSERT INTO audit_log(user_label, action, entity, entity_id) VALUES ('reset-2fa script', 'auth.2fa_reset', 'user', ?)").run(user.id);
  return user;
}

module.exports = { resetTwoFactor };

if (require.main === module) {
  const user = resetTwoFactor(process.argv[2]);
  if (!user) { console.error('No account has that email.'); process.exit(1); }
  console.log('Two-factor cleared. The account will set it up again at its next sign-in.');
}
