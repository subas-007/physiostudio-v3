'use strict';
/* Portal separation: staff (/admin) and patient (/portal) sessions are separate cookies on one domain. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Random per run, so the test suite never carries fixed credentials.
const randomSecret = () => crypto.randomBytes(24).toString('base64url');
const PASSWORD = `Pw-${randomSecret()}-9!`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-portal-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.TZ = 'Asia/Kathmandu';
process.env.ADMIN_EMAIL = 'admin@portal.local';
process.env.ADMIN_PASSWORD = PASSWORD;
process.env.SESSION_SECRET = randomSecret();
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

/** Cookie-aware client; one jar holds every cookie the browser would hold. */
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

function makeStaff(email, role) {
  const secret = sec.newTotpSecret();
  db.prepare('INSERT INTO users(email, full_name, password_hash, role, totp_enabled, totp_secret) VALUES (?,?,?,?,1,?)')
    .run(email, `${role} staff`, sec.hashPassword(PASSWORD), role, sec.encrypt(secret));
  return secret;
}
function makePatient(email) {
  db.prepare("INSERT INTO users(email, full_name, password_hash, role) VALUES (?,?,?,'patient')").run(email, 'Patient', sec.hashPassword(PASSWORD));
}

/** Signs in through the public /login (works for staff too), completing two-factor if asked. */
async function signInStaffPublic(c, email, secret) {
  let r = await c.form('/login', '/login', { email, password: PASSWORD });
  if (r.location === '/login/2fa') r = await c.form('/login/2fa', '/login/2fa', { code: totp(secret) });
  return r;
}

test('staff sign-in on the public login gets its own cookie and reaches /admin through the handoff', async () => {
  const secret = makeStaff('staff1@portal.local', 'receptionist');
  const c = client();
  const r = await signInStaffPublic(c, 'staff1@portal.local', secret);
  assert.match(r.location, /^\/admin\/start-session\?t=[\w-]+$/, 'sign-in hands off to the staff area');
  const h = await c.get(r.location);
  assert.equal(h.location, '/admin');
  assert.ok(c.jar.ps_staff, 'staff cookie set');
  assert.equal((await c.get('/admin')).status, 200);
});

test('patient sign-in uses the patient cookie only and cannot open /admin', async () => {
  makePatient('patient1@portal.local');
  const c = client();
  const r = await c.form('/login', '/login', { email: 'patient1@portal.local', password: PASSWORD });
  assert.equal(r.location, '/portal');
  assert.ok(c.jar.ps_patient, 'patient cookie set');
  assert.equal(c.jar.ps_staff, undefined, 'no staff cookie for a patient');
  assert.equal((await c.get('/admin')).location, '/staff/login', 'the staff area does not see the patient cookie');
});

test('staff and patient can be signed in at the same time in one browser', async () => {
  const secret = makeStaff('staff2@portal.local', 'therapist');
  makePatient('patient2@portal.local');
  const c = client();
  const h = await c.get((await signInStaffPublic(c, 'staff2@portal.local', secret)).location);
  assert.equal(h.location, '/admin');
  await c.form('/login', '/login', { email: 'patient2@portal.local', password: PASSWORD });
  assert.equal((await c.get('/admin')).status, 200, 'staff still signed in');
  assert.equal((await c.get('/portal')).status, 200, 'patient signed in too');
});

test('each cookie is refused by the other area', async () => {
  const secret = makeStaff('staff3@portal.local', 'receptionist');
  makePatient('patient3@portal.local');
  const both = client();
  await both.get((await signInStaffPublic(both, 'staff3@portal.local', secret)).location);
  await both.form('/login', '/login', { email: 'patient3@portal.local', password: PASSWORD });

  const staffOnly = client();
  staffOnly.jar.ps_staff = both.jar.ps_staff;
  assert.equal((await staffOnly.get('/portal')).location, '/login', 'staff cookie does not open the patient area');

  const patientOnly = client();
  patientOnly.jar.ps_patient = both.jar.ps_patient;
  assert.equal((await patientOnly.get('/admin')).location, '/staff/login', 'patient cookie does not open the staff area');
});

test('staff sign-out ends only the staff area', async () => {
  const secret = makeStaff('staff4@portal.local', 'accountant');
  makePatient('patient4@portal.local');
  const c = client();
  await c.get((await signInStaffPublic(c, 'staff4@portal.local', secret)).location);
  await c.form('/login', '/login', { email: 'patient4@portal.local', password: PASSWORD });
  await c.form('/admin', '/admin/logout', {});
  assert.equal((await c.get('/admin')).location, '/staff/login', 'staff signed out');
  assert.equal((await c.get('/portal')).status, 200, 'patient still signed in');
});

test('a handoff link works only in the browser that started the sign-in, once, and not after it expires', async () => {
  const secret = makeStaff('staff5@portal.local', 'receptionist');
  const c = client();
  const r = await signInStaffPublic(c, 'staff5@portal.local', secret);
  assert.match((await client().get(r.location)).location, /^\/staff\/login\?expired=1$/, 'another browser cannot use the link');
  assert.equal((await c.get(r.location)).location, '/admin', 'the browser that signed in can');
  assert.match((await c.get(r.location)).location, /^\/staff\/login/, 'the link is single use');

  const d = client();
  const again = await signInStaffPublic(d, 'staff5@portal.local', secret);
  db.prepare('UPDATE login_tickets SET expires_at = 0').run();
  assert.match((await d.get(again.location)).location, /^\/staff\/login\?expired=1$/, 'an expired link is refused');
});

test('failed sign-ins record which area was targeted', async () => {
  makeStaff('staff6@portal.local', 'receptionist');
  await client().form('/staff/login', '/staff/login', { email: 'staff6@portal.local', password: 'wrong' });
  const staffRow = db.prepare("SELECT detail FROM audit_log WHERE action='auth.login_failed' ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(staffRow.detail).area, 'staff');
  await client().form('/login', '/login', { email: 'staff6@portal.local', password: 'wrong' });
  const publicRow = db.prepare("SELECT detail FROM audit_log WHERE action='auth.login_failed' ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(publicRow.detail).area, 'public');
});
