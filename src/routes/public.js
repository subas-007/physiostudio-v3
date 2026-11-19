'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSetting } = require('../db');
const { audit } = require('../lib/middleware');
const { clean, isEmail, isPhone, isDate, isTime, todayStr, addDays, md } = require('../lib/util');
const booking = require('../lib/booking');
const { notifyAppointment, sendStaffEmail } = require('../lib/notify');
const { sha256, safeEqual } = require('../lib/security');
const site = require('../lib/site');

const router = express.Router();
const lim = (max, min) => rateLimit({ windowMs: min * 60000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).render('public/error', { title: 'Please slow down', message: 'Too many requests. Please try again in a little while or call us.' }) });

const publicServices = () => db.prepare('SELECT * FROM services WHERE is_public = 1 ORDER BY sort_order').all();
const bookableServices = () => db.prepare('SELECT id, title, duration_min, price FROM services WHERE is_bookable = 1 ORDER BY sort_order').all();
const bodyAreas = () => db.prepare(`SELECT a.*, s.title AS service_title, s.slug AS service_slug, s.summary AS service_summary, s.duration_min
  FROM body_areas a LEFT JOIN services s ON s.id = a.service_id ORDER BY a.sort_order, a.id`).all();
const publicPackages = () => db.prepare('SELECT * FROM packages WHERE is_public = 1 ORDER BY sort_order, id').all()
  .map((p) => ({ ...p, featureList: String(p.features || '').split('\n').map((x) => x.trim()).filter(Boolean) }));
const bookableStaff = () => db.prepare('SELECT id, full_name, designation FROM staff WHERE is_bookable = 1 ORDER BY sort_order').all();

// ---------- Pages ----------
router.get('/', (req, res) => {
  res.render('public/home', {
    title: '',
    services: publicServices(),
    team: db.prepare('SELECT * FROM staff WHERE is_public = 1 ORDER BY sort_order').all(),
    why: db.prepare('SELECT * FROM why_us ORDER BY sort_order').all(),
    areas: bodyAreas(),
    testimonials: db.prepare('SELECT * FROM testimonials WHERE is_public = 1 ORDER BY sort_order LIMIT 9').all(),
    posts: db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 3").all(),
    packages: publicPackages(),
    gallery: db.prepare('SELECT * FROM gallery WHERE is_public = 1 ORDER BY sort_order LIMIT 8').all(),
    videos: db.prepare('SELECT * FROM videos WHERE is_public = 1 ORDER BY sort_order LIMIT 3').all(),
    faqs: db.prepare('SELECT * FROM faqs WHERE is_public = 1 ORDER BY sort_order LIMIT 4').all(),
    next: site.nextAvailable(),
    slides: db.prepare('SELECT * FROM slides WHERE is_public = 1 ORDER BY sort_order, id').all(),
  });
});

router.get('/about', (req, res) => res.render('public/about', {
  title: 'About us',
  gallery: db.prepare('SELECT * FROM gallery WHERE is_public = 1 ORDER BY sort_order').all(),
  why: db.prepare('SELECT * FROM why_us ORDER BY sort_order').all(),
  team: db.prepare('SELECT * FROM staff WHERE is_public = 1 ORDER BY sort_order').all(),
}));

router.get('/services', (req, res) => res.render('public/services', { title: 'Our services', services: publicServices() }));
router.get('/services/:slug', (req, res, next) => {
  const svc = db.prepare('SELECT * FROM services WHERE slug = ? AND is_public = 1').get(req.params.slug);
  if (!svc) return next();
  res.render('public/service', { title: svc.title, svc, bodyHtml: md(svc.body), others: publicServices().filter((s) => s.id !== svc.id).slice(0, 3), metaDescription: svc.summary });
});

router.get('/team', (req, res) => res.render('public/team', { title: 'Our physiotherapists', team: db.prepare('SELECT * FROM staff WHERE is_public = 1 ORDER BY sort_order').all() }));
router.get('/team/:slug', (req, res, next) => {
  const m = db.prepare('SELECT * FROM staff WHERE slug = ? AND is_public = 1').get(req.params.slug);
  if (!m) return next();
  const hours = db.prepare('SELECT * FROM staff_hours WHERE staff_id = ? ORDER BY weekday, start_time').all(m.id);
  res.render('public/member', { title: m.full_name, m, bioHtml: md(m.bio), hours });
});

router.get('/testimonials', (req, res) => res.render('public/testimonials', { title: 'What our patients say', testimonials: db.prepare('SELECT * FROM testimonials WHERE is_public = 1 ORDER BY sort_order').all() }));

router.get('/blog', (req, res) => {
  const category = clean(req.query.category, 60);
  const posts = db.prepare(`SELECT * FROM posts WHERE status='published' ${category ? 'AND category = ?' : ''} ORDER BY published_at DESC`).all(...(category ? [category] : []));
  const categories = db.prepare("SELECT category, COUNT(*) n FROM posts WHERE status='published' AND category IS NOT NULL AND category != '' GROUP BY category ORDER BY category").all();
  res.render('public/blog', { title: 'Health blog', posts: posts.map((p) => ({ ...p, minutes: site.readingTime(p.body) })), categories, category });
});
router.get('/blog/:slug', (req, res, next) => {
  const post = db.prepare("SELECT * FROM posts WHERE slug = ? AND status='published'").get(req.params.slug);
  if (!post) return next();
  const related = db.prepare("SELECT * FROM posts WHERE status='published' AND id != ? ORDER BY (category IS ?) DESC, published_at DESC LIMIT 3").all(post.id, post.category);
  res.render('public/post', { title: post.title, post, minutes: site.readingTime(post.body), related, bodyHtml: md(post.body), metaDescription: post.excerpt });
});

router.get('/packages', (req, res) => res.render('public/packages', { title: 'Care plans', packages: publicPackages() }));

router.get('/exercises', (req, res) => {
  const area = /^\d+$/.test(req.query.area || '') ? Number(req.query.area) : null;
  const videos = db.prepare(`SELECT v.*, a.title AS area_title FROM videos v LEFT JOIN body_areas a ON a.id = v.body_area_id
    WHERE v.is_public = 1 ${area ? 'AND v.body_area_id = ?' : ''} ORDER BY v.sort_order, v.id`).all(...(area ? [area] : []));
  const areas = db.prepare('SELECT a.id, a.title, COUNT(v.id) n FROM body_areas a JOIN videos v ON v.body_area_id = a.id AND v.is_public = 1 GROUP BY a.id ORDER BY a.sort_order').all();
  res.render('public/exercises', { title: 'Home exercise library', videos, areas, area });
});

router.post('/callback', lim(5, 60), (req, res) => {
  const back = '/contact';
  if (req.body.website) return res.redirect(back);
  const name = clean(req.body.name, 120), phone = clean(req.body.phone, 20), when = clean(req.body.when, 60), topic = clean(req.body.topic, 300);
  if (name.length < 2 || !isPhone(phone)) { req.flash('error', 'Please enter your name and a valid mobile number so we can call you back.'); return res.redirect(back); }
  db.prepare('INSERT INTO messages(name, phone, subject, body) VALUES (?,?,?,?)').run(name, phone, 'Callback request', `Best time: ${when || 'any time'}\n${topic}`);
  const to = process.env.CLINIC_NOTIFY_EMAIL || getSetting('email');
  if (to) sendStaffEmail(to, `Callback request: ${name}`, `${name} (${phone}) asked for a call back.\nBest time: ${when || 'any time'}\n${topic}`);
  req.flash('success', `Thanks ${name.split(' ')[0]}, we will call you on ${phone}${when ? ' (' + when + ')' : ''}.`);
  res.redirect(back);
});

router.get('/faq', (req, res) => res.render('public/faq', { title: 'Frequently asked questions', faqs: db.prepare('SELECT * FROM faqs WHERE is_public = 1 ORDER BY sort_order').all() }));
router.get('/privacy', (req, res) => res.render('public/privacy', { title: 'Privacy notice' }));

router.get('/contact', (req, res) => res.render('public/contact', { title: 'Contact us', f: {} }));
router.post('/contact', lim(5, 60), async (req, res) => {
  if (req.body.website) return res.redirect('/contact?sent=1'); // honeypot
  const f = { name: clean(req.body.name, 120), email: clean(req.body.email, 190), phone: clean(req.body.phone, 20), subject: clean(req.body.subject, 150), body: clean(req.body.body, 3000) };
  const errors = [];
  if (f.name.length < 2) errors.push('Please enter your name.');
  if (!isEmail(f.email) && !isPhone(f.phone)) errors.push('Please give an email or phone number so we can reply.');
  if (f.body.length < 5) errors.push('Please write a message.');
  if (errors.length) return res.status(400).render('public/contact', { title: 'Contact us', f, errors });
  db.prepare('INSERT INTO messages(name,email,phone,subject,body) VALUES (?,?,?,?,?)').run(f.name, f.email, f.phone, f.subject, f.body);
  const to = process.env.CLINIC_NOTIFY_EMAIL || getSetting('email');
  if (to) sendStaffEmail(to, `Website enquiry: ${f.subject || f.name}`, `From: ${f.name}\nEmail: ${f.email}\nPhone: ${f.phone}\n\n${f.body}`);
  req.flash('success', 'Thank you! Your message has been sent. We will get back to you soon.');
  res.redirect('/contact');
});

// ---------- Booking ----------
router.get(['/book', '/appointment'], (req, res) => {
  let patient = null;
  if (req.user && req.user.role === 'patient') patient = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id);
  res.render('public/book', {
    title: 'Book an appointment',
    services: bookableServices(), staff: bookableStaff(), patient,
    f: bookingPrefill(req.query),
    minDate: todayStr(), maxDate: addDays(todayStr(), parseInt(getSetting('booking_horizon_days', '60'), 10)),
  });
});

function bookingPrefill(q) {
  const f = { service_id: /^\d+$/.test(q.service || '') ? q.service : '', staff_id: /^\d+$/.test(q.therapist || '') ? q.therapist : '',
    date: isDate(q.date) ? q.date : '', time: isTime(q.time) ? q.time : '', complaint: '', package_id: '' };
  if (/^\d+$/.test(q.area || '')) {
    const a = db.prepare('SELECT title, service_id FROM body_areas WHERE id = ?').get(q.area);
    if (a) { f.complaint = a.title; if (!f.service_id && a.service_id) f.service_id = String(a.service_id); }
  }
  if (/^\d+$/.test(q.package || '')) {
    const p = db.prepare('SELECT id, title, service_id FROM packages WHERE id = ? AND is_public = 1').get(q.package);
    if (p) { f.package_id = String(p.id); f.package_title = p.title; if (!f.service_id && p.service_id) f.service_id = String(p.service_id); }
  }
  return f;
}

router.get('/api/slots', lim(120, 5), (req, res) => {
  const { date, service_id, staff_id } = req.query;
  if (!isDate(date) || !/^\d+$/.test(String(service_id || ''))) return res.json({ slots: [] });
  const sid = /^\d+$/.test(String(staff_id || '')) ? Number(staff_id) : null;
  const closed = booking.clinicClosed(date);
  const staffMode = !!(req.user && req.user.role !== 'patient');
  const ignore = /^\d+$/.test(String(req.query.ignore || '')) ? Number(req.query.ignore) : null;
  // Only staff may ask to ignore an existing appointment (used when rescheduling); patients' own reschedule is handled server-side.
  res.json({ closed, slots: booking.availableSlots(date, Number(service_id), sid, { staffMode, ignoreAppointmentId: staffMode ? ignore : null }).map((s) => ({ time: s.time, end: s.end })) });
});

router.post(['/book', '/appointment'], lim(15, 60), async (req, res) => {
  if (req.body.website) return res.redirect('/'); // honeypot
  const f = {
    service_id: clean(req.body.service_id, 10), staff_id: clean(req.body.staff_id, 10), date: clean(req.body.date, 10), time: clean(req.body.time, 5),
    full_name: clean(req.body.full_name, 120), phone: clean(req.body.phone, 20), email: clean(req.body.email, 190).toLowerCase(), whatsapp: clean(req.body.whatsapp, 20),
    gender: clean(req.body.gender, 20), complaint: clean(req.body.complaint, 1000),
    package_id: /^\d+$/.test(req.body.package_id || '') && db.prepare('SELECT 1 FROM packages WHERE id = ?').get(req.body.package_id) ? req.body.package_id : '',
  };
  if (f.package_id) f.package_title = db.prepare('SELECT title FROM packages WHERE id = ?').get(f.package_id).title;
  let patient = req.user && req.user.role === 'patient' ? db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id) : null;
  const errors = [];
  if (!/^\d+$/.test(f.service_id)) errors.push('Please choose a service.');
  if (!isDate(f.date) || !isTime(f.time)) errors.push('Please choose a date and an available time.');
  if (!patient) {
    if (f.full_name.length < 2) errors.push('Please enter the patient\'s full name.');
    if (!isPhone(f.phone)) errors.push('Please enter a valid mobile number.');
    if (f.email && !isEmail(f.email)) errors.push('Please enter a valid email or leave it blank.');
    if (!req.body.consent) errors.push('Please accept the privacy notice so we can store your booking.');
  }
  const rerender = (status, errs) => res.status(status).render('public/book', {
    title: 'Book an appointment', services: bookableServices(), staff: bookableStaff(), patient, f, errors: errs,
    minDate: todayStr(), maxDate: addDays(todayStr(), parseInt(getSetting('booking_horizon_days', '60'), 10)),
  });
  if (errors.length) return rerender(400, errors);

  try {
    if (!patient) patient = booking.findOrCreatePatient({ ...f, consent_communication: !!req.body.consent_reminders });
    if (!patient.notify_whatsapp && req.body.consent_reminders) db.prepare('UPDATE patients SET notify_whatsapp=1 WHERE id=?').run(patient.id);
    const { appointment, manageToken } = booking.createAppointment({
      patientId: patient.id, serviceId: Number(f.service_id), staffId: f.staff_id ? Number(f.staff_id) : null,
      date: f.date, time: f.time, complaint: f.complaint, source: req.user ? 'portal' : 'web', createdBy: req.user ? req.user.id : null,
    });
    if (f.package_id) db.prepare('UPDATE appointments SET package_id = ? WHERE id = ?').run(f.package_id, appointment.id);
    site.nextAvailable.reset();
    audit(req, 'appointment.create', 'appointment', appointment.id, { source: appointment.source });
    notifyAppointment(appointment, appointment.status === 'confirmed' ? 'confirmed' : 'booking_received', manageToken).catch((e) => console.error(e));
    req.session.lastBooking = { ref: appointment.ref, token: manageToken };
    res.redirect(`/book/success/${appointment.ref}`);
  } catch (e) {
    if (e.userMessage) return rerender(409, [e.userMessage]);
    throw e;
  }
});

router.get('/book/success/:ref', (req, res, next) => {
  const lb = req.session.lastBooking;
  if (!lb || lb.ref !== req.params.ref) return next();
  const a = booking.getAppointment(db.prepare('SELECT id FROM appointments WHERE ref = ?').get(lb.ref).id);
  res.render('public/book-success', { title: 'Appointment booked', a, manageUrl: `/appointment/manage/${a.ref}?t=${lb.token}` });
});

// ---------- Guest manage link (token-protected) ----------
function manageAuth(req) {
  const t = String(req.query.t || req.body.t || '');
  const a = db.prepare('SELECT id, manage_token_hash FROM appointments WHERE ref = ?').get(String(req.params.ref).slice(0, 20));
  if (!a || !t || !a.manage_token_hash || !safeEqual(sha256(t), a.manage_token_hash)) return null;
  return { a: booking.getAppointment(a.id), t };
}
router.get('/appointment/manage/:ref', lim(60, 15), (req, res) => {
  const m = manageAuth(req);
  if (!m) return res.status(404).render('public/error', { title: 'Link not valid', message: 'This appointment link is invalid or has expired. Please call us or sign in to your patient portal.' });
  res.render('public/manage', { title: `Appointment ${m.a.ref}`, a: m.a, t: m.t, canChange: booking.patientCanChange(m.a), services: bookableServices(),
    minDate: todayStr(), maxDate: addDays(todayStr(), parseInt(getSetting('booking_horizon_days', '60'), 10)) });
});
router.post('/appointment/manage/:ref/cancel', lim(10, 15), async (req, res) => {
  const m = manageAuth(req);
  if (!m || !booking.patientCanChange(m.a)) { req.flash('error', 'This appointment can no longer be cancelled online. Please call us.'); return res.redirect('/'); }
  db.prepare("UPDATE appointments SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?").run('Cancelled by patient (link): ' + clean(req.body.reason, 300), m.a.id);
  audit(req, 'appointment.cancel_by_patient', 'appointment', m.a.id);
  notifyAppointment(m.a.id, 'cancelled').catch(console.error);
  req.flash('success', 'Your appointment has been cancelled.');
  res.redirect(`/appointment/manage/${m.a.ref}?t=${encodeURIComponent(m.t)}`);
});
router.post('/appointment/manage/:ref/reschedule', lim(10, 15), async (req, res) => {
  const m = manageAuth(req);
  if (!m || !booking.patientCanChange(m.a)) { req.flash('error', 'This appointment can no longer be changed online. Please call us.'); return res.redirect('/'); }
  try {
    const a = booking.rescheduleAppointment(m.a.id, { date: clean(req.body.date, 10), time: clean(req.body.time, 5) });
    audit(req, 'appointment.reschedule_by_patient', 'appointment', a.id);
    notifyAppointment(a, 'rescheduled', m.t).catch(console.error);
    req.flash('success', 'Your appointment has been moved.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); }
  res.redirect(`/appointment/manage/${m.a.ref}?t=${encodeURIComponent(m.t)}`);
});

// ---------- Theme (brand colours from CMS) ----------
router.get('/theme.css', (req, res) => {
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);
  res.type('text/css').set('Cache-Control', 'public, max-age=300')
    .send(`:root{--brand:${hex(getSetting('brand_color'), '#2e3236')};--accent:${hex(getSetting('accent_color'), '#f0b323')};}`);
});

// ---------- SEO ----------
router.get('/sitemap.xml', (req, res) => {
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const urls = ['/', '/about', '/services', '/packages', '/exercises', '/team', '/testimonials', '/blog', '/faq', '/contact', '/book']
    .concat(db.prepare('SELECT slug FROM services WHERE is_public=1').all().map((r) => `/services/${r.slug}`))
    .concat(db.prepare('SELECT slug FROM staff WHERE is_public=1').all().map((r) => `/team/${r.slug}`))
    .concat(db.prepare("SELECT slug FROM posts WHERE status='published'").all().map((r) => `/blog/${r.slug}`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`);
});

// ---------- Legacy URL redirects (keep Google rankings) ----------
const legacyServiceMap = { 1: 'manual-therapy', 2: 'chronic-pain-management', 3: 'postural-correction-and-ergonomics', 4: 'joint-pain-management', 5: 'osteoarthritis-management', 6: 'sports-injury-rehabilitation', 7: 'post-surgical-rehabilitation' };
const legacyDoctorMap = { 9: 'pragya-pyakurel', 11: 'shraddha-manandhar', 13: 'apeksha-khadka' };
router.get('/service', (req, res) => res.redirect(301, '/services'));
router.get('/single-service/:id', (req, res) => res.redirect(301, legacyServiceMap[req.params.id] ? `/services/${legacyServiceMap[req.params.id]}` : '/services'));
router.get('/our-doctors', (req, res) => res.redirect(301, '/team'));
router.get('/single-doctor/:id', (req, res) => res.redirect(301, legacyDoctorMap[req.params.id] ? `/team/${legacyDoctorMap[req.params.id]}` : '/team'));
router.get('/testimonial', (req, res) => res.redirect(301, '/testimonials'));
router.get('/blogDetail/:id', (req, res) => res.redirect(301, '/blog'));

module.exports = router;
