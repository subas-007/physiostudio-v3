'use strict';
/**
 * Content management: page text blocks, services, team, testimonials, blog, FAQ, "why us", body areas, media library, messages.
 * One generic CRUD engine drives the list/edit screens from the ENTITIES definitions below.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db } = require('../../db');
const { audit, requirePerm } = require('../../lib/middleware');
const { clean, slugify, isTime, DAYS } = require('../../lib/util');
const { memory, saveImage, UPLOAD_ROOT } = require('../../lib/upload');
const { youtubeId } = require('../../lib/site');

const router = express.Router();
const upload = memory.any();

const ENTITIES = {
  slides: {
    table: 'slides', label: 'Home page slider', singular: 'slide', publicUrl: () => '/', list: ['title', 'is_public', 'sort_order'],
    fields: [
      { name: 'image', label: 'Photo (landscape, at least 1600 px wide)', type: 'image', required: true },
      { name: 'image_mobile', label: 'Phone version (optional, smaller or portrait crop)', type: 'image' },
      { name: 'focus', label: 'Keep this part of the photo in view when cropped', type: 'select', options: ['center', 'top', 'bottom', 'left', 'right'] },
      { name: 'title', label: 'Headline', type: 'text', required: true, max: 90 },
      { name: 'text', label: 'Supporting text', type: 'textarea', max: 220 },
      { name: 'button_label', label: 'Button text (e.g. Book an assessment)', type: 'text', max: 40 },
      { name: 'button_link', label: 'Button link (a page like /book, or https://…)', type: 'text', max: 300 },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'sort_order', label: 'Order', type: 'number' },
    ],
  },
  services: {
    table: 'services', label: 'Services', singular: 'service', slug: 'title', publicUrl: (r) => `/services/${r.slug}`,
    list: ['title', 'duration_min', 'price', 'is_public', 'is_bookable'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL slug (leave blank to generate)', type: 'text' },
      { name: 'summary', label: 'Short summary (cards & SEO)', type: 'textarea', max: 300 },
      { name: 'body', label: 'Full description (Markdown)', type: 'markdown', max: 20000 },
      { name: 'image', label: 'Image', type: 'image' },
      { name: 'duration_min', label: 'Session length (minutes)', type: 'number', min: 5, max: 480 },
      { name: 'price', label: 'Price (Rs.)', type: 'number', min: 0, max: 1000000, step: '0.01' },
      { name: 'is_featured', label: 'Featured on home page', type: 'checkbox' },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'is_bookable', label: 'Can be booked online', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  team: {
    table: 'staff', label: 'Team', singular: 'team member', slug: 'full_name', publicUrl: (r) => `/team/${r.slug}`,
    list: ['full_name', 'designation', 'is_public', 'is_bookable'],
    fields: [
      { name: 'full_name', label: 'Full name', type: 'text', required: true },
      { name: 'slug', label: 'URL slug (leave blank to generate)', type: 'text' },
      { name: 'designation', label: 'Designation', type: 'text' },
      { name: 'qualification', label: 'Qualification', type: 'text' },
      { name: 'nhpc_no', label: 'NHPC registration no.', type: 'text' },
      { name: 'bio', label: 'Biography (Markdown)', type: 'markdown', max: 10000 },
      { name: 'photo', label: 'Photo', type: 'image' },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'is_bookable', label: 'Accepts appointments', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
    hours: true,
  },
  testimonials: {
    table: 'testimonials', label: 'Testimonials', singular: 'testimonial', list: ['name', 'role', 'is_public'],
    fields: [
      { name: 'name', label: 'Patient name', type: 'text', required: true },
      { name: 'role', label: 'Role / occupation', type: 'text' },
      { name: 'body', label: 'Review text', type: 'textarea', required: true, max: 3000 },
      { name: 'rating', label: 'Rating (1-5, optional)', type: 'number', min: 1, max: 5 },
      { name: 'photo', label: 'Photo', type: 'image' },
      { name: 'is_public', label: 'Show on website (only with the patient\'s consent)', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  posts: {
    table: 'posts', label: 'Blog posts', singular: 'post', slug: 'title', publicUrl: (r) => `/blog/${r.slug}`, order: 'id DESC',
    list: ['title', 'status', 'published_at'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL slug (leave blank to generate)', type: 'text' },
      { name: 'excerpt', label: 'Excerpt', type: 'textarea', max: 400 },
      { name: 'body', label: 'Article (Markdown)', type: 'markdown', max: 50000 },
      { name: 'cover', label: 'Cover image', type: 'image' },
      { name: 'author', label: 'Author', type: 'text' },
      { name: 'category', label: 'Category (e.g. Back care, Sports, Seniors)', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'published'] },
    ],
  },
  faqs: {
    table: 'faqs', label: 'FAQs', singular: 'FAQ', list: ['question', 'is_public'],
    fields: [
      { name: 'question', label: 'Question', type: 'text', required: true },
      { name: 'answer', label: 'Answer', type: 'textarea', required: true, max: 3000 },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  'why-us': {
    table: 'why_us', label: 'Why choose us', singular: 'reason', list: ['title'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Text', type: 'textarea', max: 400 },
      { name: 'icon', label: 'Icon', type: 'image' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  'body-areas': {
    table: 'body_areas', label: 'Body map areas', singular: 'body area', list: ['title', 'map_key'],
    fields: [
      { name: 'title', label: 'Title (e.g. Knee Pain)', type: 'text', required: true },
      { name: 'map_key', label: 'Position on the body map', type: 'select', options: ['', 'neck', 'shoulder', 'elbow', 'hand', 'back', 'hip', 'knee', 'ankle', 'foot'] },
      { name: 'blurb', label: 'What we treat here (one or two sentences)', type: 'textarea', max: 300 },
      { name: 'service_id', label: 'Recommended service', type: 'ref', ref: 'SELECT id, title FROM services ORDER BY sort_order' },
      { name: 'icon', label: 'Icon', type: 'image' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  packages: {
    table: 'packages', label: 'Care plans', singular: 'care plan', publicUrl: () => '/packages', list: ['title', 'price', 'price_unit', 'is_public'],
    fields: [
      { name: 'title', label: 'Plan name', type: 'text', required: true },
      { name: 'audience', label: 'Who it is for (short)', type: 'text' },
      { name: 'summary', label: 'Summary', type: 'textarea', max: 400 },
      { name: 'price', label: 'Price (Rs.) – leave blank to show "Ask us for pricing"', type: 'number', min: 0, max: 10000000, step: '0.01', nullable: true },
      { name: 'price_unit', label: 'Price unit (e.g. per session, 10 sessions, per month)', type: 'text' },
      { name: 'features', label: 'What is included (one per line)', type: 'textarea', max: 2000 },
      { name: 'badge', label: 'Highlight label (optional, e.g. Most chosen)', type: 'text' },
      { name: 'service_id', label: 'Service to book', type: 'ref', ref: 'SELECT id, title FROM services WHERE is_bookable = 1 ORDER BY sort_order' },
      { name: 'is_featured', label: 'Highlight this plan', type: 'checkbox' },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  gallery: {
    table: 'gallery', label: 'Photo gallery', singular: 'photo', list: ['caption', 'is_public'],
    fields: [
      { name: 'image', label: 'Photo', type: 'image', required: true },
      { name: 'caption', label: 'Caption', type: 'text' },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
  videos: {
    table: 'videos', label: 'Exercise videos', singular: 'video', publicUrl: () => '/exercises', list: ['title', 'level', 'is_public'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'youtube_id', label: 'YouTube link or video ID', type: 'youtube', required: true },
      { name: 'description', label: 'Instructions / notes', type: 'textarea', max: 1500 },
      { name: 'body_area_id', label: 'Body area', type: 'ref', ref: 'SELECT id, title FROM body_areas ORDER BY sort_order' },
      { name: 'level', label: 'Level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] },
      { name: 'is_public', label: 'Show on website', type: 'checkbox' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
    ],
  },
};

router.use(requirePerm('cms.manage'));

router.get('/', (req, res) => {
  const counts = {};
  for (const [k, e] of Object.entries(ENTITIES)) counts[k] = db.prepare(`SELECT COUNT(*) n FROM ${e.table}`).get().n;
  res.render('admin/cms-index', { title: 'Website content', ENTITIES, counts });
});

// ---------- Page text blocks ----------
router.get('/content', (req, res) => {
  const blocks = db.prepare('SELECT * FROM content_blocks ORDER BY section, sort_order').all();
  res.render('admin/cms-content', { title: 'Page text & images', blocks });
});
router.post('/content', upload, (req, res) => {
  const blocks = db.prepare('SELECT * FROM content_blocks').all();
  const upd = db.prepare('UPDATE content_blocks SET value = ? WHERE key = ?');
  const changed = [];
  try {
    db.transaction(() => {
      for (const b of blocks) {
        const field = 'b_' + b.key.replace(/\./g, '__');
        let val;
        if (b.type === 'image') {
          const file = (req.files || []).find((f) => f.fieldname === field + '_file');
          val = file ? saveImage(file, req.user.id, b.label) : clean(req.body[field], 300);
          if (val && !/^\/uploads\//.test(val)) continue; // only local paths
        } else val = clean(req.body[field], b.type === 'markdown' ? 20000 : 2000);
        if (val !== undefined && val !== b.value) { upd.run(val, b.key); changed.push(b.key); }
      }
    })();
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); return res.redirect('/admin/cms/content'); }
  audit(req, 'cms.content_update', 'content_blocks', null, { changed });
  req.flash('success', changed.length ? `Saved ${changed.length} change(s).` : 'No changes.');
  res.redirect('/admin/cms/content');
});

// ---------- Media library ----------
router.get('/media', (req, res) => res.render('admin/cms-media', { title: 'Media library', items: db.prepare('SELECT * FROM media ORDER BY id DESC').all() }));
router.post('/media', upload, (req, res) => {
  try {
    const f = (req.files || [])[0];
    if (!f) throw Object.assign(new Error('Choose an image.'), { userMessage: 'Choose an image.' });
    const p = saveImage(f, req.user.id, clean(req.body.alt, 200));
    audit(req, 'cms.media_upload', 'media', null, { path: p });
    req.flash('success', `Uploaded: ${p}`);
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); }
  res.redirect('/admin/cms/media');
});
router.post('/media/:id/delete', (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (m) {
    const abs = path.resolve(UPLOAD_ROOT, '.' + m.path.replace(/^\/uploads/, ''));
    if (abs.startsWith(path.resolve(UPLOAD_ROOT, 'cms') + path.sep) && fs.existsSync(abs)) fs.unlinkSync(abs);
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    audit(req, 'cms.media_delete', 'media', m.id, { path: m.path });
    req.flash('success', 'Image deleted.');
  }
  res.redirect('/admin/cms/media');
});

// ---------- Messages (contact form) ----------
router.get('/messages', requirePerm('messages.view'), (req, res) => res.render('admin/messages', { title: 'Messages', rows: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all() }));
router.post('/messages/:id/read', requirePerm('messages.view'), (req, res) => { db.prepare('UPDATE messages SET is_read = 1 - is_read WHERE id = ?').run(req.params.id); res.redirect('/admin/cms/messages'); });
router.post('/messages/:id/delete', requirePerm('messages.view'), (req, res) => { db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id); audit(req, 'message.delete', 'message', Number(req.params.id)); res.redirect('/admin/cms/messages'); });

// ---------- Generic CRUD ----------
function entity(req, res, next) {
  const e = ENTITIES[req.params.entity];
  if (!e) return next('route');
  req.entity = e; res.locals.e = e; res.locals.ekey = req.params.entity;
  next();
}

function readFields(e, req, current = {}) {
  const row = {}; const errors = [];
  for (const f of e.fields) {
    if (f.type === 'checkbox') { row[f.name] = req.body[f.name] ? 1 : 0; continue; }
    if (f.type === 'image') {
      const file = (req.files || []).find((x) => x.fieldname === f.name + '_file');
      if (file) row[f.name] = saveImage(file, req.user.id, req.body[e.slug || 'title'] || '');
      else if (req.body[f.name + '_remove']) row[f.name] = null;
      else row[f.name] = current[f.name] || null;
      if (f.required && !row[f.name]) errors.push(`${f.label} is required.`);
      continue;
    }
    if (f.type === 'ref') {
      const v = String(req.body[f.name] || '');
      row[f.name] = /^\d+$/.test(v) && db.prepare(f.ref).all().some((r) => r.id === Number(v)) ? Number(v) : null;
      continue;
    }
    if (f.type === 'youtube') {
      const id = youtubeId(req.body[f.name]);
      if (!id) errors.push('Paste a valid YouTube link (e.g. https://youtu.be/abc123XYZ_0).');
      row[f.name] = id || null;
      continue;
    }
    let v = clean(req.body[f.name], f.max || 500);
    if (f.type === 'number') {
      if (v === '') { row[f.name] = f.name === 'sort_order' ? 0 : (f.nullable ? null : 0); continue; }
      const n = Number(v);
      if (Number.isNaN(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) { errors.push(`${f.label} is out of range.`); continue; }
      row[f.name] = n; continue;
    }
    if (f.type === 'select' && !f.options.includes(v)) v = f.options[0];
    if (f.type === 'select' && v === '') { row[f.name] = null; continue; }
    if (f.required && !v) errors.push(`${f.label} is required.`);
    row[f.name] = v || null;
  }
  if ('button_link' in row && row.button_link && !/^\/(?!\/)|^https:\/\//.test(row.button_link)) errors.push('Button link must start with / or https://');
  if ('slug' in row) {
    let slug = slugify(row.slug || row[e.slug]);
    const clash = db.prepare(`SELECT id FROM ${e.table} WHERE slug = ? AND id IS NOT ?`).get(slug, current.id || null);
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    row.slug = slug;
  }
  if (e.table === 'posts' && row.status === 'published' && !current.published_at) row.published_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return { row, errors };
}

function refsFor(e) {
  const out = {};
  for (const f of e.fields) if (f.type === 'ref') out[f.name] = db.prepare(f.ref).all();
  return out;
}

function readHours(req) {
  const out = [];
  for (let wd = 0; wd < 7; wd++) {
    const s = req.body[`h_${wd}_start`], e = req.body[`h_${wd}_end`];
    if (isTime(s) && isTime(e) && s < e) out.push([wd, s, e]);
  }
  return out;
}

router.get('/:entity', entity, (req, res) => {
  const e = req.entity;
  const rows = db.prepare(`SELECT * FROM ${e.table} ORDER BY ${e.order || 'sort_order, id'}`).all();
  res.render('admin/cms-list', { title: e.label, rows });
});

router.get('/:entity/new', entity, (req, res) => res.render('admin/cms-form', { refs: refsFor(req.entity), title: `New ${req.entity.singular}`, row: { is_public: 1, is_bookable: 1, status: 'draft', duration_min: 45 }, hours: [], DAYS }));
router.post('/:entity/new', entity, upload, (req, res) => {
  const e = req.entity;
  let r;
  try { r = readFields(e, req); } catch (err) { if (!err.userMessage) throw err; r = { row: req.body, errors: [err.userMessage] }; }
  if (r.errors.length) return res.status(400).render('admin/cms-form', { refs: refsFor(e), title: `New ${e.singular}`, row: r.row, errors: r.errors, hours: [], DAYS });
  const cols = Object.keys(r.row);
  const id = db.prepare(`INSERT INTO ${e.table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r.row[c])).lastInsertRowid;
  if (e.hours) { const ins = db.prepare('INSERT INTO staff_hours(staff_id,weekday,start_time,end_time) VALUES (?,?,?,?)'); for (const h of readHours(req)) ins.run(id, ...h); }
  audit(req, 'cms.create', e.table, id);
  req.flash('success', `${e.singular[0].toUpperCase() + e.singular.slice(1)} created.`);
  res.redirect(`/admin/cms/${req.params.entity}/${id}`);
});

router.get('/:entity/:id', entity, (req, res, next) => {
  const row = db.prepare(`SELECT * FROM ${req.entity.table} WHERE id = ?`).get(req.params.id);
  if (!row) return next();
  const hours = req.entity.hours ? db.prepare('SELECT * FROM staff_hours WHERE staff_id = ?').all(row.id) : [];
  res.render('admin/cms-form', { refs: refsFor(req.entity), title: `Edit ${req.entity.singular}`, row, hours, DAYS });
});
router.post('/:entity/:id', entity, upload, (req, res, next) => {
  const e = req.entity;
  const current = db.prepare(`SELECT * FROM ${e.table} WHERE id = ?`).get(req.params.id);
  if (!current) return next();
  let r;
  try { r = readFields(e, req, current); } catch (err) { if (!err.userMessage) throw err; r = { row: { ...current, ...req.body }, errors: [err.userMessage] }; }
  if (r.errors.length) return res.status(400).render('admin/cms-form', { refs: refsFor(e), title: `Edit ${e.singular}`, row: { ...current, ...r.row }, errors: r.errors, hours: [], DAYS });
  const cols = Object.keys(r.row);
  db.transaction(() => {
    db.prepare(`UPDATE ${e.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => r.row[c]), current.id);
    if (e.table === 'posts') db.prepare("UPDATE posts SET updated_at = datetime('now','localtime') WHERE id = ?").run(current.id);
    if (e.hours) {
      db.prepare('DELETE FROM staff_hours WHERE staff_id = ?').run(current.id);
      const ins = db.prepare('INSERT INTO staff_hours(staff_id,weekday,start_time,end_time) VALUES (?,?,?,?)');
      for (const h of readHours(req)) ins.run(current.id, ...h);
    }
  })();
  audit(req, 'cms.update', e.table, current.id);
  req.flash('success', 'Saved.');
  res.redirect(`/admin/cms/${req.params.entity}/${current.id}`);
});
router.post('/:entity/:id/delete', entity, (req, res) => {
  const e = req.entity;
  try {
    db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).run(req.params.id);
    audit(req, 'cms.delete', e.table, Number(req.params.id));
    req.flash('success', 'Deleted.');
  } catch (err) {
    if (!String(err.message).includes('FOREIGN KEY')) throw err;
    req.flash('error', 'This item is linked to appointments or invoices, so it cannot be deleted. Untick "Show on website" / "bookable" to hide it instead.');
    return res.redirect(`/admin/cms/${req.params.entity}/${req.params.id}`);
  }
  res.redirect(`/admin/cms/${req.params.entity}`);
});

module.exports = router;
module.exports.ENTITIES = ENTITIES;
