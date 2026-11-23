'use strict';
/**
 * Initial content migrated from https://physiostudio.com.np (photos are referenced by their original
 * /uploads/... paths; run scripts/import-legacy-assets.sh on the server to copy them locally).
 * Everything here is editable afterwards in Admin → Website (CMS).
 */
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { db, setSetting } = require('./db');
const { hashPassword } = require('./lib/security');

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  clinic_name: 'Physio Studio',
  tagline: 'Destination for Relief & Wellness',
  phone_primary: '9767231155',
  phone_secondary: '01-4547884',
  whatsapp_number: '9767231155',
  email: 'tophysio.studio@gmail.com',
  address: 'Uma Shankar Bhawan, Pani Pokhari, Kathmandu, Nepal',
  hours_text: 'Sunday – Friday: 7:00 AM – 7:00 PM · Saturday: Closed',
  map_query: 'Physio Studio, Pani Pokhari, Kathmandu',
  facebook_url: '',
  instagram_url: '',
  tiktok_url: '',
  logo: '/uploads/socialmedia/06901cfce074db4e92e66914db3d7357.png',
  brand_color: '#16443a',
  accent_color: '#f2b33d',
  meta_description: 'Physio Studio, Pani Pokhari, Kathmandu – personalised physiotherapy for post-surgical rehab, sports injuries, joint pain, osteoarthritis, posture and chronic pain. Book online.',
  country_code: '977',
  // booking rules
  slot_step_min: '15',
  booking_lead_min: '60',
  booking_horizon_days: '60',
  cancel_cutoff_hours: '3',
  auto_confirm_online: '1',
  auto_no_show: '0',
  // billing
  invoice_prefix: 'PS',
  tax_rate: '0',
  tax_label: 'VAT',
  pan_vat_no: '',
  fy_start_mmdd: '07-17',
  invoice_footer: 'Thank you for choosing Physio Studio. Health services are VAT-exempt under the VAT Act, 2052.',
  // notifications
  reminders_enabled: '1',
  notify_email_enabled: '1',
  notify_whatsapp_enabled: '1',
  require_staff_2fa: '1',
  // v2: announcement bar & reviews
  announcement_enabled: '1',
  announcement_text: 'New: geriatric care plans – gentle, supervised physiotherapy for seniors.',
  announcement_link: '/packages',
  announcement_until: '',
  google_reviews_url: '',
};

// ---------- Content blocks ----------
const DEFAULT_BLOCKS = [
  ['home.hero.eyebrow', 'Hero – small heading', 'text', 'Physiotherapy clinic in Pani Pokhari, Kathmandu', 'home', 1],
  ['home.hero.title', 'Hero – headline', 'text', 'Destination for Relief & Wellness', 'home', 2],
  ['home.hero.subtitle', 'Hero – sub-headline', 'textarea', 'Our clinic is equipped with modern diagnostic and therapy equipment, so every assessment is precise and every step of your recovery is measured. Personalised care from experienced physiotherapists – in a calm, clean space.', 'home', 3],
  ['home.hero.image', 'Hero – image', 'image', '/uploads/about/250b0fc218e627ae44e20b5f5c9c60d4.jpg', 'home', 4],
  ['home.stat1.value', 'Stat 1 – value', 'text', '7am–7pm', 'home', 10],
  ['home.stat1.label', 'Stat 1 – label', 'text', 'Care, Sunday to Friday', 'home', 11],
  ['home.stat2.value', 'Stat 2 – value', 'text', '3+', 'home', 12],
  ['home.stat2.label', 'Stat 2 – label', 'text', 'Expert physiotherapists', 'home', 13],
  ['home.stat3.value', 'Stat 3 – value', 'text', '499+', 'home', 14],
  ['home.stat3.label', 'Stat 3 – label', 'text', 'Patients treated', 'home', 15],
  ['home.stat4.value', 'Stat 4 – value', 'text', '15+', 'home', 16],
  ['home.stat4.label', 'Stat 4 – label', 'text', 'Years of experience', 'home', 17],
  ['about.title', 'About – heading', 'text', 'Personalised physiotherapy, built around you', 'about', 1],
  ['about.body', 'About – text', 'markdown',
    'At Physio Studio we combine more than 15 years of clinical experience with modern facilities to deliver physiotherapy that is tailored to each person. Every plan starts with a thorough assessment and is built from evidence-based techniques – manual therapy, exercise prescription and therapeutic modalities – for both musculoskeletal and neurological conditions.\n\nWhether you are recovering from surgery or injury, managing a long-term condition, preventing problems before they start, or chasing better performance, we create a welcoming environment and work alongside you. We encourage every patient to take an active role in their recovery, because the best results come from partnership.',
    'about', 2],
  ['about.image', 'About – main image', 'image', '/uploads/about/9f3092f1f055d334dd73c4ab0143ca66.jpg', 'about', 3],
  ['about.mission', 'Mission', 'textarea', 'To provide exceptional, personalised physiotherapy care that empowers our patients to achieve optimal health and well-being, with an uncompromising commitment to clinical excellence.', 'about', 4],
  ['about.vision', 'Vision', 'textarea', 'To be a leading physiotherapy provider in Nepal, known for patient-centred care, innovative treatment and a lasting contribution to the long-term health and wellness of our community.', 'about', 5],
  ['founder.name', 'Founder – name', 'text', 'Pragya Pyakurel', 'founder', 1],
  ['founder.title', 'Founder – title', 'text', 'MPT (Ortho) · Consultant Physiotherapist & Founder', 'founder', 2],
  ['founder.message', 'Founder – message', 'markdown',
    'When I started Physio Studio, the goal was simple: make high-quality, personalised physiotherapy accessible, and help people get back to living full, active lives.\n\nWe treat the whole person, not just the symptom. That is why we keep investing in our facilities and in the latest evidence-based techniques, and why we work hard to make the clinic a supportive, comfortable space. We will keep listening, learning and improving – because your recovery is our purpose.',
    'founder', 3],
  ['founder.image', 'Founder – photo', 'image', '/uploads/about/44fbb19f9de6f43c6216fa164b088c35.jpg', 'founder', 4],
  ['founder.stat_success', 'Founder – success rate', 'text', '98%', 'founder', 5],
  ['cta.title', 'Call-to-action – heading', 'text', 'Ready to move without pain?', 'general', 1],
  ['cta.text', 'Call-to-action – text', 'textarea', 'Book an assessment online in under a minute. We will confirm instantly and remind you by email and WhatsApp before your visit.', 'general', 2],
  ['attention.title', '"Where do you need attention" – heading', 'text', 'Where do you need attention?', 'general', 3],
  // v2 blocks
  ['finder.title', 'Body map – heading', 'text', 'Where does it hurt?', 'home', 20],
  ['finder.text', 'Body map – hint', 'text', 'Tap the area that is bothering you. We will show you how we treat it.', 'home', 21],
  ['steps.title', 'First visit – heading', 'text', 'What happens at your first visit', 'home', 30],
  ['steps.1', 'First visit – step 1', 'textarea', 'Book online or call us. Choose a time that suits you; you will get a confirmation straight away.', 'home', 31],
  ['steps.2', 'First visit – step 2', 'textarea', 'A 60-minute assessment: we listen to your history, test movement and strength, and find the cause.', 'home', 32],
  ['steps.3', 'First visit – step 3', 'textarea', 'Treatment begins the same day, with a written plan and exercises you can do at home.', 'home', 33],
  ['steps.4', 'First visit – step 4', 'textarea', 'We measure progress at every visit and adjust the plan until you are back to what you love.', 'home', 34],
  ['packages.title', 'Care plans – heading', 'text', 'Care plans', 'home', 40],
  ['packages.text', 'Care plans – intro', 'textarea', 'Committing to a course of treatment costs less per session and keeps your recovery on track.', 'home', 41],
  ['gallery.title', 'Gallery – heading', 'text', 'Inside the studio', 'home', 50],
  ['exercises.title', 'Exercise library – heading', 'text', 'Exercises to do at home', 'home', 60],
  ['exercises.text', 'Exercise library – intro', 'textarea', 'Short videos from our physiotherapists. Only do the exercises your therapist has recommended for you, and stop if anything causes sharp pain.', 'home', 61],
  ['callback.title', 'Callback – heading', 'text', 'Rather talk to someone first?', 'general', 10],
  ['callback.text', 'Callback – text', 'textarea', 'Leave your number and we will call you back within working hours.', 'general', 11],
];

function seed({ withAdmin = true } = {}) {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting(k, v);

    const insBlock = db.prepare('INSERT OR REPLACE INTO content_blocks(key,label,type,value,section,sort_order) VALUES (?,?,?,?,?,?)');
    for (const b of DEFAULT_BLOCKS) insBlock.run(...b);

    // ---------- Services ----------
    const services = [
      ['Post-Surgical Rehabilitation', 'post-surgical-rehabilitation', 'Structured recovery after joint replacement, ligament repair or spinal surgery – restoring strength, mobility and confidence.', '/static/img/treatments/post-surgical-rehabilitation.jpg', 1, 1,
        'Undergoing orthopaedic surgery – whether it is a joint replacement, ligament reconstruction or spinal procedure – is only the first step. What happens in the weeks that follow largely decides the final outcome.\n\n### How we help\n- Close coordination with your surgeon\'s protocol and precautions\n- Pain and swelling management in the early phase\n- Progressive range-of-motion, strengthening and gait training\n- Balance, proprioception and return-to-activity testing\n\nWe set clear milestones and measure progress at every visit, so you always know where you stand.'],
      ['Sports Injury Rehabilitation', 'sports-injury-rehabilitation', 'From sprains and strains to ligament injuries – get back to your sport stronger and with lower risk of re-injury.', '/static/img/treatments/sports-injury-rehabilitation.jpg', 2, 1,
        'Sport and physical activity are central to a vibrant lifestyle, but they naturally carry a risk of injury. Our sports rehabilitation programmes go beyond pain relief to restore full function.\n\n### What it includes\n- Detailed movement and load assessment\n- Manual therapy and soft-tissue work\n- Sport-specific strength, agility and conditioning\n- Graded return-to-play plan and injury-prevention advice'],
      ['Joint Pain Management', 'joint-pain-management', 'Relief for chronic knee, hip, shoulder and other joint pain through targeted, evidence-based therapy.', '/static/img/treatments/joint-pain-management.jpg', 3, 1,
        'Chronic joint pain can become a constant barrier to enjoying life\'s simple pleasures. We identify what is driving your pain and treat the cause, not only the symptom.\n\n### Our approach\n- Assessment of joint mechanics, muscle balance and posture\n- Mobilisation, manual therapy and therapeutic modalities\n- Personalised exercise programme you can continue at home\n- Education on activity modification and joint protection'],
      ['Osteoarthritis Management', 'osteoarthritis-management', 'A proactive, long-term plan to reduce pain, keep joints moving and stay independent.', '/static/img/treatments/osteoarthritis-management.jpg', 4, 1,
        'Living with osteoarthritis brings daily physical challenges, but a precise, proactive management plan can reduce pain and keep you active.\n\n### Programme elements\n- Strengthening of the muscles that support affected joints\n- Mobility and flexibility work\n- Pain-relief modalities\n- Weight-bearing guidance, walking aids and home-exercise plans'],
      ['Chronic Pain Management', 'chronic-pain-management', 'A whole-person approach to persistent pain that helps you regain control of daily life.', '/static/img/treatments/chronic-pain-management.jpg', 5, 0,
        'Persistent pain can change how you interact with the world. With the right approach – combining hands-on care, graded activity and education about pain – it is possible to regain control.\n\n### What to expect\n- Comprehensive assessment of physical and lifestyle factors\n- Graded exercise and pacing strategies\n- Manual therapy and modalities where helpful\n- Self-management tools for long-term results'],
      ['Postural Correction and Ergonomics', 'postural-correction-and-ergonomics', 'Fix the neck, shoulder and back strain that comes from desks, phones and long hours of sitting.', '/static/img/treatments/postural-correction-and-ergonomics.jpg', 6, 0,
        'In an increasingly digital world, poor posture often shows up as chronic neck and back strain, headaches and fatigue.\n\n### We help with\n- Postural and movement assessment\n- Targeted strengthening and mobility exercises\n- Workstation and ergonomic advice for home and office\n- Habit-building plans that fit your daily routine'],
      ['Manual Therapy', 'manual-therapy', 'Skilled hands-on techniques to reduce pain, release tight tissues and restore joint movement.', '/static/img/treatments/manual-therapy.jpg', 7, 0,
        'Manual therapy is a cornerstone of effective orthopaedic physiotherapy, offering targeted relief and improved mobility.\n\n### Techniques include\n- Joint mobilisation and manipulation\n- Soft-tissue and myofascial release\n- Muscle energy techniques\n- Combined with exercise for lasting results'],
    ];
    const insSvc = db.prepare('INSERT INTO services(title,slug,summary,image,sort_order,is_featured,body,duration_min,price) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const s of services) insSvc.run(...s, 45, 1500);
    db.prepare("INSERT INTO services(title,slug,summary,sort_order,is_featured,is_public,duration_min,price,body) VALUES ('Initial Assessment & Consultation','initial-assessment','A full assessment with a physiotherapist and a written treatment plan.',0,0,0,60,1500,'')").run();

    // ---------- Team ----------
    const team = [
      ['Pragya Pyakurel', 'pragya-pyakurel', 'Consultant Physiotherapist & Founder', 'MPT (Orthopaedics)', '/uploads/doctors/64fb7cec3253f47f2818a6d74d3837dd.jpg', 1,
        'Pragya founded Physio Studio to make high-quality, personalised physiotherapy accessible in Kathmandu. She specialises in orthopaedic rehabilitation, joint pain and post-surgical recovery.'],
      ['Apeksha Khadka', 'apeksha-khadka', 'Physiotherapist', '', '/uploads/doctors/31b6b1a688b5278aa841039f261b13c7.png', 2, ''],
      ['Shraddha Manandhar', 'shraddha-manandhar', 'Physiotherapist', '', '/uploads/doctors/0a0bf3217bcaff0d880d886079cf8ba9.png', 3, ''],
    ];
    const insStaff = db.prepare('INSERT INTO staff(full_name,slug,designation,qualification,photo,sort_order,bio) VALUES (?,?,?,?,?,?,?)');
    const insHours = db.prepare('INSERT INTO staff_hours(staff_id,weekday,start_time,end_time) VALUES (?,?,?,?)');
    for (const t of team) {
      const id = insStaff.run(...t).lastInsertRowid;
      for (const wd of [0, 1, 2, 3, 4, 5]) insHours.run(id, wd, '07:00', '19:00'); // Sun–Fri; Saturday closed
    }

    // ---------- Why us ----------
    const why = [
      ['Experienced Therapists', 'Qualified physiotherapists with years of hands-on clinical practice.', '/static/img/n-users.svg'],
      ['Advanced Technology', 'Modern diagnostic and therapy equipment for precise assessment and tracking.', '/static/img/n-cog.svg'],
      ['Convenient & Accessible', 'Central Pani Pokhari location, open 7 AM – 7 PM, Sunday to Friday.', '/static/img/n-cal.svg'],
      ['Evidence-Based Treatment', 'Every plan follows current clinical research and best practice.', '/static/img/n-chart.svg'],
      ['Expert Consultations', 'One-to-one time with a physiotherapist who listens.', '/static/img/n-shield.svg'],
      ['Nutrition Strategies', 'Practical guidance that supports healing and recovery.', '/static/img/n-sun.svg'],
      ['Soothing, Clean Ambiance', 'A calm, spotless space designed for comfort.', '/static/img/n-globe.svg'],
      ['Support & Motivation', 'We stay with you from the first session to full recovery.', '/static/img/n-bell.svg'],
    ];
    const insWhy = db.prepare('INSERT INTO why_us(title,body,icon,sort_order) VALUES (?,?,?,?)');
    why.forEach((w, i) => insWhy.run(...w, i));

    // ---------- Body areas ----------
    const areas = [
      ['Neck Pain', '2ac81075cc75dc8045ce634c6b64089e'], ['Knee Pain', '5d6fafca317cd916f91c21180c5c9c0b'],
      ['Hand Pain', '2a75208134350c7026b898b80a8d4ce6'], ['Elbow Pain', 'fc05531d44f3bb1e03ec68808bd31a51'],
      ['Foot Pain', 'a7ead312f3c74ece9e38d6ebaffd5c0d'], ['Hip Pain', 'e13b4a807f867a98a0b90e46efecc971'],
      ['Ankle Pain', 'a9a345bf824707560f376b43f53084a1'], ['Back Pain', '1ba7c3571e3552aa574332cdcbafbe83'],
    ];
    const insArea = db.prepare('INSERT INTO body_areas(title,icon,sort_order) VALUES (?,?,?)');
    areas.forEach(([t, f], i) => insArea.run(t, `/uploads/portfolio/${f}.svg`, i));

    // ---------- Testimonials ----------
    // Seeded HIDDEN with placeholder text: paste each patient's original wording in Admin → Website → Testimonials, then publish.
    const tms = [
      ['Ganesh Khanal', '', '8808ef1c30f9d27fd0193302a0e26f41.jpg'],
      ['Quan Chunyan', '', 'aae14f4463b8ccdf1cbcc6523ad19ee2.jpg'],
      ['Prasid Malla', '', 'e98f13f427dd7257f8a4b41c56708e27.jpg'],
      ['Tika Rana Magar', '', '91d4527b46a3776a993351d2bb90313f.jpg'],
      ['Sabin Man Dangol', 'Engineer', 'a749074b85cf9f8199624749bc9f7bd5.jpg'],
      ['Rikhi Bau', '', '93518477d3776129ecdd313433534b75.png'],
    ];
    const insT = db.prepare('INSERT INTO testimonials(name,role,body,photo,is_public,sort_order) VALUES (?,?,?,?,0,?)');
    tms.forEach(([n, r, f], i) => insT.run(n, r, '[Paste the original review text from the current website here, then tick "Show on website".]', `/uploads/testimonials/${f}`, i));

    // ---------- FAQs ----------
    const faqs = [
      ['What are your opening hours?', 'We are open Sunday to Friday, 7:00 AM to 7:00 PM. We are closed on Saturdays and on public holidays announced on this website.'],
      ['Do I need a doctor\'s referral?', 'No. You can book directly with our physiotherapists. If you have a referral letter, reports or scans (X-ray, MRI), please bring them to your first visit.'],
      ['How long is a session?', 'An initial assessment usually takes about 60 minutes. Follow-up treatment sessions typically take 45 minutes.'],
      ['What should I wear or bring?', 'Wear loose, comfortable clothing that lets us see and move the area being treated. Bring any medical reports, a list of your medications and your appointment reference.'],
      ['How do I book, change or cancel an appointment?', 'Book online any time from the "Book Appointment" page. You can view, reschedule or cancel from your patient portal or the link in your confirmation message, up to 3 hours before your appointment. You can also call us on 9767231155.'],
      ['Will I get a reminder?', 'Yes. We send a reminder by email and WhatsApp the day before and again about two hours before your appointment.'],
      ['How can I pay?', 'We accept cash, card, eSewa, Khalti, Fonepay and bank transfer. You will receive an invoice and receipt, and can view your invoices in the patient portal.'],
      ['Is my information kept confidential?', 'Yes. Your health records are accessible only to authorised clinic staff involved in your care, every access is logged, and we never share your information without your consent unless required by law.'],
    ];
    const insF = db.prepare('INSERT INTO faqs(question,answer,sort_order) VALUES (?,?,?)');
    faqs.forEach((f, i) => insF.run(...f, i));

    // ---------- Blog ----------
    db.prepare(`INSERT INTO posts(title,slug,excerpt,body,cover,author,status,published_at) VALUES (?,?,?,?,?,?,'published',datetime('now','localtime'))`).run(
      '10 essential benefits of regular physiotherapy', '10-essential-benefits-of-regular-physiotherapy',
      'Physiotherapy is not only for injuries. Here is how regular sessions help you move better, feel better and stay independent.',
      'Physiotherapy combines hands-on treatment, guided exercise and education to restore movement and relieve pain. Regular sessions offer benefits well beyond recovering from an injury.\n\n1. **Pain relief without relying on medication** – manual therapy, exercise and modalities reduce pain at its source.\n2. **Faster, safer recovery after surgery** – structured rehabilitation restores strength and range of motion.\n3. **Better mobility and flexibility** – keep joints and muscles moving freely.\n4. **Injury prevention** – find and fix weak links before they cause problems.\n5. **Improved balance** – lower the risk of falls, especially for older adults.\n6. **Management of long-term conditions** – such as osteoarthritis, back pain and diabetes-related problems.\n7. **Better posture** – reduce the strain of desk work and screen time.\n8. **Sports performance** – move more efficiently and recover faster.\n9. **Neurological recovery** – support after stroke and other neurological conditions.\n10. **Confidence and independence** – understand your body and how to look after it.\n\nEvery treatment plan at Physio Studio is tailored to your age, medical history and goals. [Book an assessment](/book) to get started.',
      '/uploads/blog/bd1aa0e5b7bbf9197bc8f5bc3c2a9bfc.jpg', 'Physio Studio');

    // ---------- Admin ----------
    if (withAdmin && !db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
      const email = process.env.ADMIN_EMAIL || 'admin@physiostudio.com.np';
      const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + 'A1!';
      db.prepare("INSERT INTO users(email, full_name, password_hash, role, must_change_password) VALUES (?, 'Administrator', ?, 'admin', 1)").run(email, hashPassword(pw));
      console.log('\n================ INITIAL ADMIN ================');
      console.log(`  Email:    ${email}`);
      console.log(`  Password: ${pw}`);
      console.log('  You will be asked to change it and set up 2FA on first login.');
      console.log('===============================================\n');
    }
  });
  tx();
  ensureDefaults();
}

/** v2 content for both new and existing installs (runs once). */
function seedV2() {
  if (db.prepare("SELECT value FROM settings WHERE key='v2_seeded'").get()) return;
  db.transaction(() => {
    const svc = (slug) => (db.prepare('SELECT id FROM services WHERE slug = ?').get(slug) || {}).id || null;
    const areas = {
      'Neck Pain': ['neck', 'Stiffness, headaches and pain from posture, screens or sleeping awkwardly.', 'postural-correction-and-ergonomics'],
      'Knee Pain': ['knee', 'Ligament injuries, arthritis, pain on stairs or after surgery.', 'joint-pain-management'],
      'Hand Pain': ['hand', 'Wrist and hand pain, carpal tunnel symptoms and stiffness after fractures.', 'manual-therapy'],
      'Elbow Pain': ['elbow', 'Tennis and golfer\'s elbow, overuse and lifting injuries.', 'sports-injury-rehabilitation'],
      'Foot Pain': ['foot', 'Heel pain, plantar fasciitis and flat-foot strain.', 'sports-injury-rehabilitation'],
      'Hip Pain': ['hip', 'Hip arthritis, bursitis and recovery after hip replacement.', 'osteoarthritis-management'],
      'Ankle Pain': ['ankle', 'Sprains, instability and Achilles problems.', 'sports-injury-rehabilitation'],
      'Back Pain': ['back', 'Lower-back pain, sciatica, disc problems and long-term back pain.', 'chronic-pain-management'],
    };
    const upd = db.prepare('UPDATE body_areas SET map_key = COALESCE(map_key, ?), blurb = COALESCE(blurb, ?), service_id = COALESCE(service_id, ?) WHERE title = ?');
    for (const [title, [key, blurb, slug]] of Object.entries(areas)) upd.run(key, blurb, svc(slug), title);
    if (!db.prepare("SELECT 1 FROM body_areas WHERE map_key = 'shoulder'").get()) {
      db.prepare('INSERT INTO body_areas(title, map_key, blurb, service_id, sort_order) VALUES (?,?,?,?,?)')
        .run('Shoulder Pain', 'shoulder', 'Frozen shoulder, rotator cuff injuries and pain lifting your arm.', svc('manual-therapy'), 1);
    }
    if (!db.prepare('SELECT 1 FROM packages').get()) {
      const ins = db.prepare('INSERT INTO packages(title, audience, summary, price, price_unit, features, badge, service_id, is_featured, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
      ins.run('Single session', 'Pay as you go', 'One assessment or treatment session with a physiotherapist.', null, 'per session',
        'One-to-one session\nPersonal home-exercise plan\nProgress notes kept on file', null, svc('initial-assessment'), 0, 1);
      ins.run('Recovery plan', 'After injury or surgery', 'A course of sessions for steady recovery from injury or surgery.', null, '10 sessions',
        '10 sessions with the same therapist\nGoals set and re-measured regularly\nPriority booking\nWhatsApp check-ins between visits', 'Most chosen', svc('post-surgical-rehabilitation'), 1, 2);
      ins.run('Geriatric care plan', 'For seniors', 'Gentle, supervised physiotherapy for strength, balance and independence.', null, 'monthly, quarterly or yearly',
        'Balance and fall-prevention training\nJoint care for arthritis\nFamily kept informed of progress\nWeekly, monthly, quarterly, half-yearly or yearly plans', null, svc('osteoarthritis-management'), 0, 3);
    }
    if (!db.prepare('SELECT 1 FROM gallery').get()) {
      const ins = db.prepare('INSERT INTO gallery(image, caption, sort_order) VALUES (?,?,?)');
      [['/uploads/about/250b0fc218e627ae44e20b5f5c9c60d4.jpg', 'Treatment room'], ['/uploads/about/9f3092f1f055d334dd73c4ab0143ca66.jpg', 'The studio'],
        ['/uploads/service/69c26b79b2230044ed501d685d3e9f9c.jpg', 'Sports rehabilitation'], ['/uploads/service/ae08f66447f10fd76e070c0093c23124.jpg', 'Post-surgical rehabilitation'],
        ['/uploads/service/4f7d203afe967fa4e8e7cc7e9f36a63c.jpg', 'Joint care'], ['/uploads/service/7579a20e1c8630fcb7d06331466ed2d1.jpg', 'Manual therapy']]
        .forEach(([img, cap], i) => ins.run(img, cap, i));
    }
    db.prepare("UPDATE posts SET category = COALESCE(category, 'Wellness')").run();
    db.prepare("INSERT INTO settings(key, value) VALUES ('v2_seeded', datetime('now','localtime'))").run();
  })();
}

/**
 * v3: original-site wording + the clinic's own photos + hero slides + brand colours from the logo.
 * Each field is replaced only if it still equals the v2 default, so CMS edits are never overwritten.
 */
function seedV3() {
  if (db.prepare("SELECT value FROM settings WHERE key='v3_seeded'").get()) return;
  const v2 = require('./seed-v2-defaults.json');
  const v3 = require('./content-v3');
  db.transaction(() => {
    const blk = db.prepare('UPDATE content_blocks SET value = ? WHERE key = ? AND (value IS ? OR value = ?)');
    for (const [k, val] of Object.entries(v3.blocks)) blk.run(val, k, v2.blocks[k] ?? null, v2.blocks[k] ?? '');
    for (const [slug, f] of Object.entries(v3.services)) {
      const old = v2.services[slug] || {};
      db.prepare('UPDATE services SET summary = ? WHERE slug = ? AND summary IS ?').run(f.summary, slug, old.summary ?? null);
      db.prepare('UPDATE services SET body = ? WHERE slug = ? AND body IS ?').run(f.body, slug, old.body ?? null);
    }
    for (const [slug, f] of Object.entries(v3.staff)) {
      const old = v2.staff[slug] || {};
      for (const col of ['designation', 'qualification', 'bio']) db.prepare(`UPDATE staff SET ${col} = ? WHERE slug = ? AND ${col} IS ?`).run(f[col], slug, old[col] ?? null);
    }
    // Shraddha's published hours on the original site were 09:00–17:00
    const sh = db.prepare("SELECT id FROM staff WHERE slug = 'shraddha-manandhar'").get();
    if (sh && db.prepare("SELECT COUNT(*) n FROM staff_hours WHERE staff_id = ? AND NOT (start_time = '07:00' AND end_time = '19:00')").get(sh.id).n === 0) {
      db.prepare("UPDATE staff_hours SET start_time = '09:00', end_time = '17:00' WHERE staff_id = ?").run(sh.id);
    }
    for (const [title, body] of Object.entries(v3.why)) db.prepare('UPDATE why_us SET body = ? WHERE title = ? AND body IS ?').run(body, title, v2.why[title] ?? null);
    for (const [name, body] of Object.entries(v3.testimonials)) {
      db.prepare("UPDATE testimonials SET body = ?, is_public = 1, role = CASE WHEN role = '' THEN NULL ELSE role END WHERE name = ? AND body IS ?").run(body, name, v2.testimonials[name] ?? null);
    }
    if (v2.post) db.prepare('UPDATE posts SET body = ?, excerpt = ? WHERE slug = ? AND body IS ?').run(v3.post.body, v3.post.excerpt, v2.post.slug, v2.post.body);
    const gal = db.prepare('SELECT image FROM gallery ORDER BY sort_order, id').all().map((r) => r.image);
    if (JSON.stringify(gal) === JSON.stringify(v2.gallery)) {
      db.prepare('DELETE FROM gallery').run();
      const ins = db.prepare('INSERT INTO gallery(image, caption, sort_order) VALUES (?,?,?)');
      v3.gallery.forEach(([img, cap], i) => ins.run(img, cap, i));
    }
    if (!db.prepare('SELECT 1 FROM slides').get()) {
      const ins = db.prepare('INSERT INTO slides(image, image_mobile, focus, title, text, button_label, button_link, sort_order) VALUES (?,?,?,?,?,?,?,?)');
      v3.slides.forEach((x, i) => ins.run(x.image, x.mobile, x.focus, x.title, x.text, x.label, x.link, i));
    }
    for (const [key, [oldV, newV]] of Object.entries(v3.theme)) db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(newV, key, oldV);
    const lbl = db.prepare('UPDATE content_blocks SET label = ? WHERE key = ?');
    lbl.run('Fallback headline (shown only if the slider has no slides)', 'home.hero.title');
    lbl.run('Fallback text (shown only if the slider has no slides)', 'home.hero.subtitle');
    lbl.run('Old hero image (not used while the slider has slides)', 'home.hero.image');
    lbl.run('Old hero small heading (not used)', 'home.hero.eyebrow');
    lbl.run('Body map – heading', 'finder.title');
    lbl.run('Body map – intro text', 'finder.text');
    db.prepare("INSERT INTO settings(key, value) VALUES ('v3_seeded', datetime('now','localtime'))").run();
  })();
}

/** Fill in any settings / content blocks added in later versions without touching edited values. */
function ensureDefaults() {
  const s = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) s.run(k, v);
  const b = db.prepare('INSERT OR IGNORE INTO content_blocks(key,label,type,value,section,sort_order) VALUES (?,?,?,?,?,?)');
  for (const row of DEFAULT_BLOCKS) b.run(...row);
  seedV2();
  seedV3();
}

module.exports = { seed, ensureDefaults };
if (require.main === module) {
  if (db.prepare('SELECT 1 FROM settings LIMIT 1').get()) {
    console.log('Database already has content – nothing to do. Delete data/physiostudio.db to start fresh.');
  } else {
    seed();
    console.log('Seed complete.');
  }
}
