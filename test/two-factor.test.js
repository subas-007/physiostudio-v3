'use strict';
/* Two-factor: a secret that can no longer be decrypted (encryption key changed) must fail safely and be resettable. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Random per run, so the test suite never carries fixed credentials or keys.
const randomSecret = () => crypto.randomBytes(24).toString('base64url');
const PASSWORD = `Pw-${randomSecret()}-9!`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-2fa-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.TZ = 'Asia/Kathmandu';
process.env.ADMIN_EMAIL = 'admin@twofactor.local';
process.env.ADMIN_PASSWORD = PASSWORD;
process.env.SESSION_SECRET = randomSecret();
process.env.APP_ENCRYPTION_KEY = randomSecret();
process.env.LOGIN_RATE_LIMIT = '200';

const { seed } = require('../src/seed');
const { db } = require('../src/db');
const sec = require('../src/lib/security');
let server, base;

before(async () => {
  seed();
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  const jar = {};
  async function req(method, url, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  }
  const csrfFrom = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  return {
    jar,
    get: (u) => req('GET', u),
    async form(pageUrl, postUrl, body) {
      const page = await req('GET', pageUrl);
      return req('POST', postUrl, { _csrf: csrfFrom(page.text), ...body });
    },
  };
}

const totp = (secret) => sec.hotp(secret, Math.floor(Date.now() / 30000));

/** Creates a staff account with two-factor, its secret encrypted under the key in force right now. */
function makeStaff(email, role) {
  const secret = sec.newTotpSecret();
  db.prepare('INSERT INTO users(email, full_name, password_hash, role, totp_enabled, totp_secret) VALUES (?,?,?,?,1,?)')
    .run(email, `${role} staff`, sec.hashPassword(PASSWORD), role, sec.encrypt(secret));
  return secret;
}

test('an unreadable two-factor secret fails safely at sign-in and says what to do', async () => {
  const email = 'staff1@twofactor.local';
  const secret = makeStaff(email, 'receptionist');
  process.env.APP_ENCRYPTION_KEY = randomSecret(); // the key changed after two-factor was turned on
  const c = client();
  let r = await c.form('/login', '/login', { email, password: PASSWORD });
  assert.equal(r.location, '/login/2fa');
  r = await c.form('/login/2fa', '/login/2fa', { code: totp(secret) });
  assert.equal(r.status, 503, 'a clear error, not a crash');
  assert.match(r.text, /Ask an administrator to reset two-factor/);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='auth.2fa_unreadable'").get(), 'the failure is audited');
});

test('the reset tool clears two-factor and ends that account’s sessions; the next sign-in asks for a new set-up', async () => {
  const { resetTwoFactor } = require('../scripts/reset-2fa');
  const email = 'staff2@twofactor.local';
  const secret = makeStaff(email, 'accountant');
  const c = client();
  await c.form('/login', '/login', { email, password: PASSWORD });
  const done = await c.form('/login/2fa', '/login/2fa', { code: totp(secret) });
  await c.get(done.location); // staff sign-in handoff
  assert.equal((await c.get('/admin')).status, 200, 'signed in before the reset');

  assert.ok(resetTwoFactor(email), 'the account was found');
  const row = db.prepare('SELECT totp_enabled, totp_secret FROM users WHERE email = ?').get(email);
  assert.equal(row.totp_enabled, 0);
  assert.equal(row.totp_secret, null);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='auth.2fa_reset'").get(), 'the reset is audited');
  assert.equal((await c.get('/admin')).location, '/staff/login', 'the old session was ended');

  const again = client();
  const r = await again.form('/login', '/login', { email, password: PASSWORD });
  assert.equal(r.location.startsWith('/admin/start-session?t='), true);
  assert.equal((await again.get(r.location)).location, '/admin/account/2fa?required=1', 'asked to set two-factor up again');
  assert.equal(resetTwoFactor('nobody@twofactor.local'), null, 'unknown email is reported');
});
