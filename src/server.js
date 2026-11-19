'use strict';
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'Asia/Kathmandu';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const compression = require('compression');
const layouts = require('express-ejs-layouts');

const { db, allSettings, contentMap } = require('./db');
const { loadUser, flash, csrf } = require('./lib/middleware');
const util = require('./lib/util');
const { UPLOAD_ROOT } = require('./lib/upload');

const PROD = process.env.NODE_ENV === 'production';
if (PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('FATAL: SESSION_SECRET must be set to a random string of 32+ characters in production.');
  process.exit(1);
}
const LEGACY = (process.env.LEGACY_ASSET_BASE || 'https://physiostudio.com.np').replace(/\/$/, '');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(layouts);
app.set('layout', 'layouts/public');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', LEGACY, 'https://i.ytimg.com'],
      'frame-src': ['https://www.google.com', 'https://maps.google.com', 'https://www.youtube-nocookie.com'],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'upgrade-insecure-requests': PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next(); });
app.use(compression());

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '7d' : 0 }));
// Uploaded media. Files from the old site that have not been imported yet fall back to the legacy host.
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: PROD ? '30d' : 0, dotfiles: 'deny', index: false }));
app.use('/uploads', (req, res) => {
  if (/^\/(service|doctors|testimonials|blog|about|whyus|portfolio|socialmedia)\/[\w.-]+$/.test(req.path)) return res.redirect(302, LEGACY + '/uploads' + req.path);
  res.status(404).end();
});
app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/favicon.svg'));
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: /admin\nDisallow: /portal\nDisallow: /appointment/manage\nSitemap: ${(process.env.BASE_URL || '').replace(/\/$/, '')}/sitemap.xml\n`));

app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 300 }));
app.use(express.json({ limit: '100kb' }));

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  name: PROD ? '__Host-ps.sid' : 'ps.sid',
  secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me-please-123456',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 8 * 3600 * 1000, path: '/' },
}));
// Make sure anonymous visitors get a session only when they hit a form (CSRF needs one).
app.use(flash);
app.use(loadUser);
// Shared template helpers
app.use((req, res, next) => {
  res.locals.s = allSettings();
  res.locals.c = contentMap();
  res.locals.u = util;
  res.locals.fiscalYear = require('./lib/billing').fiscalYear;
  res.locals.path = req.path;
  if (!req.path.startsWith('/admin') && !req.path.startsWith('/api')) {
    const site = require('./lib/site');
    res.locals.clinicStatus = site.clinicStatus();
    res.locals.announcement = site.announcement();
    res.locals.hasVideos = !!db.prepare('SELECT 1 FROM videos WHERE is_public = 1').get();
  }
  res.locals.title = '';
  res.locals.metaDescription = res.locals.s.meta_description || '';
  res.locals.baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  res.set('Cache-Control', req.user ? 'no-store' : 'no-cache');
  next();
});

app.use(csrf);


app.use('/', require('./routes/auth'));
app.use('/', require('./routes/public'));
app.use('/portal', require('./routes/portal'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('public/error', { title: 'Page not found', message: 'The page you are looking for does not exist or has moved.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') { req.flash('error', 'File is too large (max 5 MB).'); return res.redirect(safeBack(req)); }
  console.error(err);
  res.status(500).render('public/error', { layout: 'layouts/public', title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

function safeBack(req) {
  try { const u = new URL(req.get('Referrer') || '/', 'http://x'); return u.host === 'x' || u.host === req.get('host') ? u.pathname + u.search : '/'; } catch { return '/'; }
}

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  if (!db.prepare('SELECT 1 FROM settings LIMIT 1').get()) {
    console.log('Empty database – seeding initial content from the existing site…');
    require('./seed').seed();
  }
  require('./seed').ensureDefaults();
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Physio Studio running on http://${process.env.HOST || '127.0.0.1'}:${PORT}`));
  if (process.env.DISABLE_SCHEDULER !== '1') require('./lib/scheduler').start();
}
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
module.exports = app;
