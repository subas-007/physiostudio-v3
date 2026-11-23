'use strict';
/* End-to-end tests: run with `npm test`. Uses a throwaway database. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.TZ = 'Asia/Kathmandu';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'Initial!Pass123';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.LOGIN_RATE_LIMIT = '200';

const { seed } = require('../src/seed');
const { db } = require('../src/db');
const sec = require('../src/lib/security');
const { addDays, todayStr } = require('../src/lib/util');
let server, base;

before(async () => {
  seed();
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Tiny cookie-aware HTTP client. */
function client() {
  const jar = {};
  async function req(method, url, body, { json = false, multipart = null } = {}) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    if (multipart) payload = multipart;
    if (json) headers.accept = 'application/json';
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text();
    return { status: r.status, location: r.headers.get('location'), text, headers: r.headers };
  }
  const csrfFrom = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  return {
    jar,
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    raw: req,
    async form(pageUrl, postUrl, body) {
      const page = await req('GET', pageUrl);
      const _csrf = csrfFrom(page.text);
      assert.ok(_csrf, `csrf token on ${pageUrl}`);
      const r = await req('POST', postUrl || pageUrl, { _csrf, ...body });
      // A staff sign-in hands off to the staff cookie; follow that hop, as a browser would.
      return r.location && r.location.startsWith('/admin/start-session') ? req('GET', r.location) : r;
    },
    csrfFrom,
  };
}

function nextOpenDate() {
  // first Sun–Fri at least 2 days ahead
  for (let i = 2; i < 10; i++) { const d = addDays(todayStr(), i); if (new Date(d + 'T00:00:00').getDay() !== 6) return d; }
}

const totpNow = (secret) => sec.hotp(secret, Math.floor(Date.now() / 30000));

let adminClient;

test('guest can book online, gets manage link, double-booking is prevented', async () => {
  const c = client();
  const date = nextOpenDate();
  const slots = JSON.parse((await c.get(`/api/slots?date=${date}&service_id=1&staff_id=1`)).text).slots;
  assert.ok(slots.length > 10, 'slots available');
  const t = slots[0].time;
  const r = await c.form('/book', '/book', { service_id: '1', staff_id: '1', date, time: t, full_name: 'Sita Sharma', phone: '9801234567', email: 'sita@example.com', consent: '1', consent_reminders: '1', complaint: 'Knee pain' });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  assert.match(r.location, /^\/book\/success\/PS-/);
  const ok = await c.get(r.location);
  assert.match(ok.text, /booked!|Request received/);
  const manage = ok.text.match(/href="(\/appointment\/manage\/[^"]+)"/)[1].replace(/&amp;/g, '&');
  assert.equal((await c.get(manage)).status, 200);
  assert.equal((await c.get(manage.replace(/t=.*/, 't=wrong'))).status, 404, 'bad token rejected');

  // Same slot again by another person -> conflict
  const c2 = client();
  const r2 = await c2.form('/book', '/book', { service_id: '1', staff_id: '1', date, time: t, full_name: 'Ram Thapa', phone: '9811111111', consent: '1' });
  assert.equal(r2.status, 409);
  assert.match(r2.text, /just taken|no longer available/);
  const slotsAfter = JSON.parse((await c.get(`/api/slots?date=${date}&service_id=1&staff_id=1`)).text).slots;
  assert.ok(!slotsAfter.find((s) => s.time === t), 'slot removed after booking');

  // Notification queued (dry-run: skipped because SMTP/WA not configured)
  const n = db.prepare("SELECT channel, status FROM notifications WHERE kind IN ('confirmed','booking_received')").all();
  assert.ok(n.length >= 2, 'email + whatsapp notifications logged');
});

test('saturday and holidays are closed', async () => {
  const c = client();
  let sat = todayStr(); for (let i = 1; i < 8; i++) { const d = addDays(todayStr(), i); if (new Date(d + 'T00:00:00').getDay() === 6) { sat = d; break; } }
  assert.equal(JSON.parse((await c.get(`/api/slots?date=${sat}&service_id=1`)).text).slots.length, 0);
  const d = addDays(nextOpenDate(), 1);
  db.prepare('INSERT INTO staff_leave(staff_id, date, reason) VALUES (NULL, ?, ?)').run(d, 'Test holiday');
  const r = JSON.parse((await c.get(`/api/slots?date=${d}&service_id=1`)).text);
  assert.equal(r.closed, true);
});

test('CSRF token is required on POST', async () => {
  const c = client();
  await c.get('/contact');
  const r = await c.post('/contact', { name: 'x', email: 'a@b.co', body: 'hello there' });
  assert.equal(r.status, 403);
});

test('admin login enforces password change and 2FA, then full back-office works', async () => {
  const c = client();
  // wrong password
  let r = await c.form('/staff/login', '/staff/login', { email: 'admin@test.local', password: 'nope' });
  assert.equal(r.status, 401);
  r = await c.form('/staff/login', '/staff/login', { email: 'admin@test.local', password: 'Initial!Pass123' });
  assert.equal(r.status, 302);
  r = await c.get('/admin');
  assert.equal(r.location, '/admin/account?force=1', 'forced password change');
  r = await c.form('/admin/account', '/admin/account/password', { current: 'Initial!Pass123', password: 'weak', password2: 'weak' });
  assert.match((await c.get(r.location)).text, /New password needs/);
  r = await c.form('/admin/account', '/admin/account/password', { current: 'Initial!Pass123', password: 'Better#Secret2026', password2: 'Better#Secret2026' });
  assert.equal(r.location, '/admin/account/2fa?required=1');
  r = await c.get('/admin/patients');
  assert.equal(r.location, '/admin/account/2fa?required=1', '2FA enforced');
  const page = await c.get('/admin/account/2fa?required=1');
  const secret = page.text.match(/Manual key: <code class="secret">([A-Z2-7 ]+)<\/code>/)[1].replace(/ /g, '');
  r = await c.raw('POST', '/admin/account/2fa/enable', { _csrf: c.csrfFrom(page.text), code: totpNow(secret) });
  assert.equal(r.location, '/admin');
  const stored = db.prepare("SELECT totp_secret FROM users WHERE email='admin@test.local'").get().totp_secret;
  assert.match(stored, /^v1:/, 'TOTP secret encrypted at rest');

  // fresh login requires TOTP
  const c2 = client();
  r = await c2.form('/staff/login', '/staff/login', { email: 'admin@test.local', password: 'Better#Secret2026' });
  assert.equal(r.location, '/login/2fa');
  r = await c2.form('/login/2fa', '/login/2fa', { code: '000000' });
  assert.equal(r.status, 401);
  r = await c2.form('/login/2fa', '/login/2fa', { code: totpNow(secret) });
  assert.equal(r.location, '/admin');
  adminClient = c2;

  for (const p of ['/admin', '/admin/appointments', '/admin/appointments?view=list', '/admin/appointments/new', '/admin/patients', '/admin/patients/new',
    '/admin/invoices', '/admin/invoices/new', '/admin/reports', '/admin/cms', '/admin/cms/content', '/admin/cms/media', '/admin/cms/services', '/admin/cms/services/1',
    '/admin/cms/team/1', '/admin/cms/testimonials', '/admin/cms/posts', '/admin/cms/faqs', '/admin/cms/why-us', '/admin/cms/body-areas', '/admin/cms/messages',
    '/admin/cms/slides', '/admin/cms/slides/1', '/admin/cms/packages', '/admin/cms/packages/1', '/admin/cms/gallery', '/admin/cms/videos', '/admin/cms/videos/new', '/admin/cms/body-areas/1', '/admin/users', '/admin/users/new', '/admin/settings', '/admin/holidays', '/admin/logs/notifications', '/admin/logs/audit', '/admin/account', '/admin/patients/1', '/admin/patients/1?tab=clinical', '/admin/patients/1?tab=billing', '/admin/appointments/1']) {
    const x = await c2.get(p);
    assert.equal(x.status, 200, `${p} -> ${x.status} ${x.text.slice(0, 200)}`);
  }
});

test('admin: phone booking, clinical note, invoice + payment, void rules', async () => {
  const c = adminClient;
  const date = nextOpenDate();
  let r = await c.form('/admin/appointments/new', '/admin/appointments/new', { full_name: 'Hari <script>alert(1)</script> KC', phone: '9841000000', service_id: '2', staff_id: '2', date, time: '10:00', source: 'phone', notify: '1' });
  assert.equal(r.status, 302, r.text.slice(0, 500));
  const apptId = Number(r.location.split('/').pop());
  const ap = await c.get(r.location);
  assert.ok(!ap.text.includes('<script>alert(1)</script>'), 'output is HTML-escaped');
  assert.ok(ap.text.includes('&lt;script&gt;'));

  const pid = db.prepare('SELECT patient_id FROM appointments WHERE id=?').get(apptId).patient_id;
  r = await c.form(`/admin/patients/${pid}?tab=clinical`, `/admin/patients/${pid}/notes`, { note_type: 'initial_assessment', pain_score: '6', subjective: 'Low back pain 3 weeks', objective: 'Lumbar flexion limited', assessment: 'Mechanical LBP', plan: 'Manual therapy + HEP', sign: '1', appointment_id: String(apptId) });
  assert.equal(r.status, 302);
  const note = db.prepare('SELECT * FROM clinical_notes WHERE patient_id=?').get(pid);
  assert.equal(note.is_locked, 1);
  assert.throws(() => db.prepare("UPDATE clinical_notes SET plan='tampered' WHERE id=?").run(note.id), /locked/);

  // invoice from appointment
  r = await c.get(`/admin/invoices/new?appointment=${apptId}`);
  assert.equal(r.status, 200);
  r = await c.raw('POST', '/admin/invoices/new', { _csrf: c.csrfFrom(r.text), patient_id: String(pid), appointment_id: String(apptId), item_service: '2', item_description: 'Sports rehab session', item_qty: '2', item_price: '1500', discount: '500', pay_amount: '1000', pay_method: 'esewa', pay_reference: 'TXN123' });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const invId = Number(r.location.split('/').pop());
  let inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
  assert.equal(inv.total, 2500); assert.equal(inv.amount_paid, 1000); assert.equal(inv.status, 'partial');
  assert.match(inv.invoice_no, /^PS-\d{6}-00001$/);
  // overpay rejected
  let page = await c.get(`/admin/invoices/${invId}`);
  r = await c.raw('POST', `/admin/invoices/${invId}/pay`, { _csrf: c.csrfFrom(page.text), amount: '99999', method: 'cash' });
  assert.match((await c.get(r.location)).text, /exceeds the balance/);
  page = await c.get(`/admin/invoices/${invId}`);
  await c.raw('POST', `/admin/invoices/${invId}/pay`, { _csrf: c.csrfFrom(page.text), amount: '1500', method: 'cash' });
  inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
  assert.equal(inv.status, 'paid');
  // void blocked when payments exist
  page = await c.get(`/admin/invoices/${invId}`);
  await c.raw('POST', `/admin/invoices/${invId}/void`, { _csrf: c.csrfFrom(page.text), reason: 'test' });
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id=?').get(invId).status, 'paid');
  assert.equal((await c.get(`/admin/invoices/${invId}/print`)).status, 200);
  const csv = await c.get(`/admin/reports/export/payments.csv?from=${todayStr()}&to=${todayStr()}`);
  assert.match(csv.text, /TXN123/);
});

test('role-based access: therapist cannot see invoices; receptionist cannot see clinical notes', async () => {
  const mk = (email, role) => db.prepare("INSERT INTO users(email, full_name, password_hash, role) VALUES (?,?,?,?)").run(email, role + ' user', sec.hashPassword('Role#Pass12345'), role).lastInsertRowid;
  mk('ther@test.local', 'therapist'); mk('rec@test.local', 'receptionist');
  db.prepare("UPDATE settings SET value='0' WHERE key='require_staff_2fa'").run();
  const t = client();
  await t.form('/staff/login', '/staff/login', { email: 'ther@test.local', password: 'Role#Pass12345' });
  assert.equal((await t.get('/admin/invoices')).status, 403);
  assert.equal((await t.get('/admin/users')).status, 403);
  assert.equal((await t.get('/admin/patients/1?tab=clinical')).status, 200);
  const rc = client();
  await rc.form('/staff/login', '/staff/login', { email: 'rec@test.local', password: 'Role#Pass12345' });
  assert.equal((await rc.get('/admin/invoices')).status, 200);
  assert.equal((await rc.get('/admin/patients/1/record')).status, 403);
  assert.equal((await rc.get('/admin/logs/audit')).status, 403);
  db.prepare("UPDATE settings SET value='1' WHERE key='require_staff_2fa'").run();
  const forb = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='security.forbidden'").get().n;
  assert.ok(forb >= 4);
});

test('patient registers, links to existing record, sees only own data, can cancel', async () => {
  const c = client();
  let r = await c.form('/register', '/register', { full_name: 'Sita Sharma', email: 'sita@example.com', phone: '9801234567', password: 'Patient#2026x', password2: 'Patient#2026x', consent_treatment: '1' });
  assert.equal(r.status, 302, r.text.slice(0, 400));
  r = await c.get('/portal');
  assert.equal(r.status, 200);
  assert.match(r.text, /Upcoming appointments/);
  const pat = db.prepare("SELECT * FROM patients WHERE email='sita@example.com'").get();
  assert.ok(pat.user_id, 'existing guest-booking record linked');
  // other patient's invoice -> 404
  const other = db.prepare('SELECT id FROM invoices LIMIT 1').get();
  assert.equal((await c.get(`/portal/invoices/${other.id}`)).status, 404);
  assert.equal((await c.get('/admin')).location, '/staff/login', 'patients are not signed in to the staff area');
  // cancel own appointment
  const a = db.prepare("SELECT id FROM appointments WHERE patient_id=? AND status='confirmed'").get(pat.id);
  const page = await c.get('/portal');
  r = await c.raw('POST', `/portal/appointments/${a.id}/cancel`, { _csrf: c.csrfFrom(page.text), reason: 'travel' });
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(a.id).status, 'cancelled');
});

test('account lockout after 5 failures', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c.form('/login', '/login', { email: 'rec@test.local', password: 'wrong' + i });
  const r = await c.form('/login', '/login', { email: 'rec@test.local', password: 'Role#Pass12345' });
  assert.match(r.text, /temporarily locked/);
});

test('reminder scheduler sends 24h and 2h reminders exactly once', async () => {
  const { runReminders } = require('../src/lib/scheduler');
  const pid = db.prepare('SELECT id FROM patients LIMIT 1').get().id;
  const now = new Date();
  const at = (h) => { const d = new Date(now.getTime() + h * 3600e3); const p = (n) => String(n).padStart(2, '0'); return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]; };
  const [d1, t1] = at(20); const [d2, t2] = at(1.5);
  const ins = db.prepare("INSERT INTO appointments(ref, patient_id, staff_id, service_id, date, start_time, end_time, status) VALUES (?,?,1,1,?,?,?, 'confirmed')");
  const a1 = ins.run('PS-REM24', pid, d1, t1, t1).lastInsertRowid;
  const a2 = ins.run('PS-REM02', pid, d2, t2, t2).lastInsertRowid;
  const res = await runReminders(now);
  assert.ok(res.r24 >= 1 && res.r2 >= 1, JSON.stringify(res));
  assert.equal(db.prepare('SELECT reminder_24h_sent FROM appointments WHERE id=?').get(a1).reminder_24h_sent, 1);
  assert.equal(db.prepare('SELECT reminder_2h_sent FROM appointments WHERE id=?').get(a2).reminder_2h_sent, 1);
  const before = db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind LIKE 'reminder%'").get().n;
  await runReminders(now);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind LIKE 'reminder%'").get().n, before, 'no duplicates');
});

test('audit log is append-only; security headers present', async () => {
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE audit_log SET action='x'").run(), /append-only/);
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('CMS: upload validation rejects non-images, content edits appear on site', async () => {
  const c = adminClient;
  const page = await c.get('/admin/cms/content');
  const csrf = c.csrfFrom(page.text);
  const fd = new FormData();
  fd.append('b_finder__title', 'Move Better, Live Better');
  fd.append('b_home__hero__image_file', new Blob(['<svg onload=alert(1)>'], { type: 'image/svg+xml' }), 'x.svg');
  let r = await c.raw('POST', `/admin/cms/content?_csrf=${csrf}`, null, { multipart: fd });
  assert.match((await c.get(r.location)).text, /Only JPG, PNG, WEBP or GIF/);
  const fd2 = new FormData();
  for (const row of db.prepare('SELECT key, value FROM content_blocks').all()) fd2.append('b_' + row.key.replace(/\./g, '__'), row.key === 'finder.title' ? 'Move Better, Live Better' : row.value);
  r = await c.raw('POST', `/admin/cms/content?_csrf=${csrf}`, null, { multipart: fd2 });
  assert.equal(r.status, 302);
  assert.match((await fetch(base + '/').then((x) => x.text())), /Move Better, Live Better/);
});

test('v2: new public pages, body map, live status and next slot render', async () => {
  for (const p of ['/', '/packages', '/exercises', '/blog?category=Wellness', '/about', '/faq', '/contact', '/team', '/testimonials']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
  const home = await fetch(base + '/').then((r) => r.text());
  assert.match(home, /class="hotspot hs-knee"/);
  assert.match(home, /Book for knee pain/);
  assert.match(home, /Geriatric care plan/);
  assert.match(home, /class="status/);
  assert.match(home, /data-announce/);
  const map = db.prepare("SELECT id FROM body_areas WHERE map_key='knee'").get();
  const book = await fetch(`${base}/book?area=${map.id}`).then((r) => r.text());
  assert.match(book, />Knee Pain<\/textarea>/, 'complaint prefilled from body map');
});

test('v2: booking a care plan records the package', async () => {
  const c = client();
  const pkg = db.prepare("SELECT id, service_id FROM packages WHERE title='Recovery plan'").get();
  const page = await c.get(`/book?package=${pkg.id}`);
  assert.match(page.text, /Recovery plan<\/strong> care plan/);
  const date = nextOpenDate();
  const t = JSON.parse((await c.get(`/api/slots?date=${date}&service_id=${pkg.service_id}`)).text).slots[5].time;
  const r = await c.raw('POST', '/book', { _csrf: c.csrfFrom(page.text), package_id: String(pkg.id), service_id: String(pkg.service_id), date, time: t, full_name: 'Maya Rai', phone: '9860000001', consent: '1' });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const a = db.prepare("SELECT a.package_id FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.full_name='Maya Rai'").get();
  assert.equal(a.package_id, pkg.id);
});

test('v2: callback request lands in the admin inbox', async () => {
  const c = client();
  const r = await c.form('/contact', '/callback', { name: 'Kiran Joshi', phone: '9812345678', when: 'Evening (3–7 PM)', topic: 'knee after surgery' });
  assert.equal(r.status, 302);
  const m = db.prepare("SELECT * FROM messages WHERE subject='Callback request'").get();
  assert.equal(m.name, 'Kiran Joshi');
  const bad = await c.form('/contact', '/callback', { name: 'X', phone: 'abc' });
  assert.match((await c.get(bad.location)).text, /valid mobile number/);
});

test('v2: CMS videos validate YouTube links and appear in the library; announcement expires', async () => {
  const c = adminClient;
  let page = await c.get('/admin/cms/videos/new');
  const csrf = c.csrfFrom(page.text);
  const fd = new FormData(); fd.append('title', 'Knee strengthening'); fd.append('youtube_id', 'not a link'); fd.append('is_public', '1');
  let r = await c.raw('POST', `/admin/cms/videos/new?_csrf=${csrf}`, null, { multipart: fd });
  assert.equal(r.status, 400);
  assert.match(r.text, /valid YouTube link/);
  const fd2 = new FormData(); fd2.append('title', 'Knee strengthening'); fd2.append('youtube_id', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'); fd2.append('is_public', '1');
  fd2.append('body_area_id', String(db.prepare("SELECT id FROM body_areas WHERE map_key='knee'").get().id)); fd2.append('level', 'Beginner');
  r = await c.raw('POST', `/admin/cms/videos/new?_csrf=${csrf}`, null, { multipart: fd2 });
  assert.equal(r.status, 302, r.text.slice(0, 300));
  assert.equal(db.prepare('SELECT youtube_id FROM videos').get().youtube_id, 'dQw4w9WgXcQ');
  const lib = await fetch(base + '/exercises').then((x) => x.text());
  assert.match(lib, /data-video="dQw4w9WgXcQ"/);
  assert.ok(!/youtube-nocookie\.com\/embed/.test(lib), 'iframe not loaded until play is pressed');
  db.prepare("UPDATE settings SET value='2000-01-01' WHERE key='announcement_until'").run();
  assert.ok(!/data-announce/.test(await fetch(base + '/').then((x) => x.text())), 'expired announcement hidden');
});

test('v3: slider, original content and clinic photos', async () => {
  const home = await fetch(base + '/').then((r) => r.text());
  assert.match(home, /data-slider/);
  assert.match(home, /\/static\/img\/clinic\/reception\.jpg/);
  assert.match(home, /Revive\. Regain\. Restore\./);
  assert.equal((home.match(/<h1/g) || []).length, 1, 'exactly one h1 on the home page');
  const about = await fetch(base + '/about').then((r) => r.text());
  assert.match(about, /premier destination for personalized physiotherapy care/);
  const doc = await fetch(base + '/team/pragya-pyakurel').then((r) => r.text());
  assert.match(doc, /Jamia Hamdard University/);
  const svc = await fetch(base + '/services/manual-therapy').then((r) => r.text());
  assert.match(svc, /cornerstone of highly effective orthopedic physical medicine/);
  assert.equal((await fetch(base + '/static/img/clinic/senior-care-900.jpg')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM testimonials WHERE is_public = 1').get().n, 6);
});

test('v3 upgrade keeps edited content', () => {
  const { ensureDefaults } = require('../src/seed');
  db.prepare("UPDATE content_blocks SET value = 'Edited by clinic' WHERE key = 'about.mission'").run();
  db.prepare("DELETE FROM settings WHERE key = 'v3_seeded'").run();
  ensureDefaults();
  assert.equal(db.prepare("SELECT value FROM content_blocks WHERE key = 'about.mission'").get().value, 'Edited by clinic');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM slides').get().n, 5, 'slides not duplicated');
});

test('v2: upgrade path is idempotent', () => {
  const { ensureDefaults } = require('../src/seed');
  const before = db.prepare('SELECT COUNT(*) n FROM packages').get().n;
  ensureDefaults(); ensureDefaults();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM packages').get().n, before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM body_areas WHERE map_key='shoulder'").get().n, 1);
});
