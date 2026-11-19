'use strict';
/**
 * v3 content: the wording from the original physiostudio.com.np (about, founder's letter, mission/vision,
 * service descriptions, Dr. Pragya's biography, "why us", patient reviews and the blog article), plus the
 * clinic's own photographs bundled under /static/img/clinic. Applied on fresh installs and, for existing
 * installs, only to fields that still hold the previous default (anything edited in the CMS is left alone).
 */

const CONSULT = '/uploads/about/250b0fc218e627ae44e20b5f5c9c60d4.jpg'; // Dr. Pragya with a patient (original site)

const blocks = {
  'home.hero.title': 'Destination for Relief & Wellness',
  'home.hero.subtitle': 'Our clinic is equipped with state-of-the-art diagnostic and therapeutic equipment designed to accelerate healing and enhance treatment precision. From advanced assessment tools to innovative physical therapy modalities, we leverage modern clinical advancements to accurately evaluate your condition and track your progress.',
  'home.hero.image': CONSULT,
  'home.stat1.value': '7am–7pm', 'home.stat1.label': 'Emergency care, Sunday to Friday',
  'home.stat2.value': '3+', 'home.stat2.label': 'Doctors',
  'home.stat3.value': '499+', 'home.stat3.label': 'Patients treated',
  'home.stat4.value': '15+', 'home.stat4.label': 'Years of experience',
  'about.title': 'Welcome to Physio Studio',
  'about.image': '/static/img/clinic/treatment-floor.jpg',
  'about.body': [
    'Welcome to Physio Studio, your premier destination for personalized physiotherapy care. At Physio Studio, we pride ourselves on our commitment to excellence, offering a unique blend of experienced therapists & modern facilities to help you achieve your health and wellness goals.',
    'Led by a team of highly skilled therapists, Physio Studio is equipped with advanced equipment facilities, ensuring that you receive the highest standard of care during your rehabilitation journey. Whether recovering from an injury, managing a chronic condition, or simply looking to optimize your physical well-being, our dedicated team is here to support you every step of the way.',
    'At Physio Studio, we understand that every individual is unique, which is why we take a personalized approach to your treatment. Our therapists will work closely with you to develop a customized treatment plan tailored to your specific needs and goals. From manual and exercise therapy prescription to innovative modalities, we offer a comprehensive range of services designed to address a wide variety of musculoskeletal and neurological conditions.',
    'But our commitment to your well-being goes beyond just treatment. We strive to create a warm, welcoming environment where you feel empowered to take an active role in your recovery and overall health. Whether you\'re here for rehabilitation, injury prevention, or performance enhancement, you can trust that you\'re in good hands at Physio Studio.',
    'Experience the difference that personalized care and modern facilities can make in your journey to better health. Schedule your appointment with Physio Studio today and take the first step towards a healthier, happier you.',
    'Welcome to Physio Studio, where your well-being is our top priority.',
  ].join('\n\n'),
  'about.mission': 'To provide exceptional, personalized physiotherapy care that empowers our patients to achieve optimal health and well-being.',
  'about.vision': 'To be the leading provider of physiotherapy services, recognized for excellence in patient care, innovative treatment approaches, and an unwavering commitment to fostering long-term health and wellness.',
  'founder.title': 'MPT (Ortho), Consultant Physiotherapist & Founder',
  'founder.image': '/uploads/about/ddff39e70fdfa4536104da777e548147.png',
  'founder.message': [
    'Dear valued patients and community members,',
    'At Physio Studio, our journey began with a simple yet powerful belief: everyone deserves access to exceptional care that not only heals but empowers them to live their best life. Every day, I am incredibly proud to see this belief come to life through the dedication, passion, and expertise of our team.',
    '### Our approach to your recovery',
    'From the very beginning, our mission has been clear: to provide personalized, high-quality physiotherapy tailored to the unique needs of every individual who walks through our doors. We deeply understand that true recovery goes beyond simply treating symptoms. It requires understanding you as a whole person and working collaboratively to achieve lasting health, mobility, and wellness.',
    '### A space built for healing',
    'We have invested in advanced facilities and modern therapeutic techniques to ensure you receive the highest standard of care. But beyond the clinical tools, we have intentionally designed a welcoming space where you feel supported, understood, and motivated to take active control of your health journey.',
    '### Looking forward',
    'Your trust is our highest honor, and we are deeply committed to continually evolving and improving our services to better serve our community. As we look to the future, our vision remains focused on advancing modern physiotherapy care and making a lasting, positive impact on your life.',
    'We are here to guide you, support you, and celebrate your successes with you every single step of the way.',
    'Thank you for choosing Physio Studio as your partner in health.',
  ].join('\n\n'),
  'finder.title': 'Where do you need attention?',
  'finder.text': 'We understand that injuries and acute pain can happen unexpectedly. Our emergency physiotherapy services are designed to provide prompt and effective care to help you manage.',
  'cta.title': 'Ready to start your journey to recovery?',
  'cta.text': 'Contact us today to schedule your initial consultation and take the first step towards a pain-free life.',
  'gallery.title': 'Inside the studio',
};

const services = {
  'manual-therapy': {
    summary: 'Targeted, hands-on interventions that reduce acute pain, restore lost joint play and accelerate natural tissue healing.',
    body: 'Manual therapy is a cornerstone of highly effective orthopedic physical medicine, offering targeted, hands-on interventions that rapidly reduce acute pain, restore lost joint play, and accelerate natural tissue healing. Our clinical manual therapy services encompass precise joint mobilization and manipulation to improve joint kinematics, advanced soft-tissue techniques to alleviate protective muscle guarding, and myofascial release to dissolve stubborn scar tissue and enhance fascial elasticity.\n\nEach hands-on session is precisely customized to your immediate structural tolerance and broader rehabilitation goals. Whether you are navigating chronic spinal stiffness, recovering from a traumatic tissue injury, or unlocking athletic mobility limitations, our expert manual therapy provides the foundational relief required to make active exercise highly successful.',
  },
  'chronic-pain-management': {
    summary: 'Persistent pain can alter how you interact with the world. With the right approach, lasting relief is achievable.',
    body: 'Persistent pain can fundamentally alter how you interact with the world, but with the right neurological and physical approach, lasting relief is entirely achievable. Our clinical team specializes in treating complex, long-standing pain conditions by blending hands-on therapy, desensitizing movement patterns, and advanced pain management paradigms.\n\nWe work deeply with you to untangle the underlying triggers of your discomfort—whether rooted in arthritis, fibromyalgia, or poorly healed past trauma. Your personalized plan is intentionally paced to safely lower your nervous system\'s threat responses, reduce baseline discomfort, and incrementally restore your physical capabilities. We are completely dedicated to providing sustainable, long-term physical solutions that protect your well-being and return vital control of your life back to you.',
  },
  'postural-correction-and-ergonomics': {
    summary: 'Achieve and maintain healthy alignment across your workday, with practical changes to your desk, sleep and lifting habits.',
    body: 'In an increasingly digital world, poor postural habits frequently manifest as chronic spinal strain, tension headaches, and restricted baseline mobility. Our postural correction and ergonomics service is dedicated to helping you achieve, master, and maintain optimal musculoskeletal alignment across your workday and daily lifestyle.\n\nWe initiate care with a thorough static and dynamic postural assessment to isolate systemic muscle imbalances, joint restrictions, or habitual structural strains. Based on these findings, we develop a corrective protocol combining targeted deep-core and scapular stabilization exercises, specialized manual tissue release, and real-world ergonomic education. We guide you through exact, practical adjustments for your office workstation, sleeping mechanics, and lifting habits ensuring long-term spinal integrity, alleviating structural fatigue, and promoting robust physical vitality.',
  },
  'joint-pain-management': {
    summary: 'Break the cycle of joint pain from arthritis or repetitive stress, and restore comfortable, fluid movement.',
    body: 'Chronic joint pain can become a constant, frustrating barrier to enjoying life\'s simple pleasures, whether it stems from osteoarthritis, rheumatoid arthritis, or repetitive mechanical stress. Our specialized joint pain management service is designed to break the cycle of discomfort and systematically improve structural joint function through modern therapeutic modalities.\n\nWe combine expert hands-on manual therapy to improve structural joint tracking with customized, low-impact stabilization exercises that strengthen the primary muscle groups supporting your joints. By aggressively targeting both the immediate discomfort and the root biomechanical causes of your symptoms, we help eliminate persistent stiffness, restore fluid movement, and return comfort and freedom to your daily life.',
  },
  'osteoarthritis-management': {
    summary: 'A precise, proactive plan to reduce joint pain, preserve mobility and keep you doing the activities you love.',
    body: 'Living with osteoarthritis poses daily physical challenges, but with a precise, proactive management strategy, you can maintain a profoundly active and fulfilling lifestyle. Our osteoarthritis management service focuses on minimizing localized joint pain, preserving structural mobility, and optimizing your overall quality of life.\n\nWe utilize a targeted combination of manual therapy, custom-loaded exercises, and practical lifestyle adjustments to take the mechanical pressure off compromised joints. Our clinical team works with you to design a structured movement routine that safely strengthens surrounding stabilizing muscles, increases joint range of motion, and protects cartilage health. Additionally, we provide expert guidance on activity modification and ergonomics to give you total control over your joint health and keep you doing the activities you love.',
  },
  'sports-injury-rehabilitation': {
    summary: 'From ankle sprains to ligament tears, get back to peak performance safely, and stronger against future injury.',
    body: 'Sports and physical activities are vital to a vibrant lifestyle, but they naturally carry inherent mechanical risks. Whether you have sustained an acute ankle sprain, a complex ligament tear, or a persistent muscle strain, our sports injury rehabilitation service is engineered to get you back to peak performance safely and efficiently.\n\nWe begin with a comprehensive biomechanical assessment to map out the exact scope of your injury. Your personalized recovery roadmap integrates targeted manual therapy, precision strength training, and sports-specific conditioning drills. Our methodology extends beyond merely treating the immediate injury; we look at the entire kinetic chain to isolate and correct underlying movement compensations or muscular imbalances. We are fully committed to accelerating your recovery timeline while building an athletic foundation that is stronger, faster, and highly resilient against future injuries.',
  },
  'post-surgical-rehabilitation': {
    summary: 'A milestone plan built with your surgeon\'s protocol after joint replacement, ligament repair or spinal surgery.',
    body: 'Undergoing orthopedic surgery whether it\'s a joint replacement, ligament repair, or spinal surgery marks the definitive beginning of your journey toward recovery. Our post-surgical rehabilitation program is meticulously designed to safely guide you through this critical healing phase. Because every procedure and patient blueprint is entirely unique, our physiotherapists collaborate closely with your surgeon\'s specific protocols to co-create a tailored milestone plan.\n\nThrough highly structured, progressive movements, we focus on safely restoring your muscle strength, joint flexibility, and daily function while actively minimizing post-operative pain and swelling. With our clinical guidance, you will steadily rebuild your physical independence, minimize the risk of secondary complications or re-injury, and step back into your daily routine with complete confidence.',
  },
};

const staff = {
  'pragya-pyakurel': {
    designation: 'Consultant Physiotherapist & Founder', qualification: 'MPT (Ortho)',
    bio: 'Dr. Pragya Pyakurel is a highly experienced Physiotherapist with over 15 years of dedicated practice. She holds a Post-Graduate degree from Jamia Hamdard University and a Bachelor\'s degree from Delhi University, both in New Delhi. She is part of various clinical trainings and seminars that complement her extensive education.\n\nDr. Pyakurel has significantly contributed to orthopedic rehabilitation, pain management, and back pain management. Her career has spanned roles at leading institutions, including Medicare Hospital, Grande City Hospital, and Patan Academy of Health Sciences. As a former head of the Department of Rehabilitation at Grande City Hospital and a lecturer at Patan Academy, she has shared her expertise and mentored aspiring healthcare professionals.\n\nDr. Pyakurel\'s commitment to patient care is evident in her long and successful career. She brings a wealth of knowledge and experience to her role as a senior consultant physiotherapist at Physio Studio.',
  },
};

const why = {
  'Experienced Therapists': 'Our team of highly skilled physiotherapists is dedicated to providing exceptional, personalized care tailored to your unique physical needs. Bringing years of advanced training, specialized certifications, and diverse clinical experience, our therapists are fully equipped to treat everything from acute sports injuries to complex, chronic musculoskeletal conditions. We continuously update our knowledge in line with global advancements in physical medicine, ensuring you receive the highest standard of care.',
  'Advanced Technology': 'Our clinic is equipped with state-of-the-art diagnostic and therapeutic equipment designed to accelerate healing and enhance treatment precision. By seamlessly combining cutting-edge technology with our hands-on manual expertise, we deliver highly efficient, targeted care that helps you recover faster, rebuild strength safely, and achieve superior long-term results.',
  'Convenient & Accessible': 'We understand that your time is valuable. To accommodate your busy schedule, our clinic offers flexible appointment blocks, including early morning and extended evening hours, in a conveniently located clinic with easy access and a welcoming atmosphere.',
  'Evidence-Based Treatment': 'Our physiotherapists integrate the latest clinical research and global healthcare guidelines to inform every aspect of your treatment plan, so the techniques, modalities and exercises we apply are proven to be effective for your specific condition.',
};

/** Patient reviews from the original site (publish only with each patient's ongoing consent). */
const testimonials = {
  'Ganesh Khanal': 'I highly recommend Physio Studio to anyone looking for physiotherapy treatment. I had been suffering from leg pain for about 3 months. After visiting Physio Studio, Dr. Pragya recommended some physiotherapy exercises. I\'ve been doing the exercises at home, and after just 3 weeks, I\'m completely pain-free!',
  'Quan Chunyan': '这家理疗诊所提供卓越的设施，如空调、热水，以及干净舒适的环境。他们提供一对一的咨询和理疗课程，确保每位患者都能得到个性化的关注。这家诊所的专业团队非常出色。工作人员非常友好和乐于助人。医疗人员经验丰富，带来了丰富的知识和专业技能。此外，治疗过程使用现代设备和技术，确保高质量的护理。',
  'Prasid Malla': 'I highly recommend Physio Studio to anyone seeking effective and compassionate physiotherapy treatment. Dr Pragya took the time to understand my medical history, lifestyle, and specific concerns regarding my lower back pain. This personalized approach made me feel confident that my treatment would be tailored to my needs. Throughout my sessions, the physiotherapist monitored my progress closely and made necessary adjustments to my treatment plan. Their attention to detail and dedication to my recovery was evident in every session. I appreciated the consistent encouragement and support, which kept me motivated even on the tougher days. Thank you, Dr Pragya, for helping me get back to a pain-free life!',
  'Tika Rana Magar': 'Physio Studio is great! 👏 The team here is amazing—very knowledgeable and experienced. 🤓💪 The clinic is clean and well maintained. 🌟 The atmosphere is calm and positive, which really helps during treatment. 🌺🙌 Will definitely be back! 💯',
  'Sabin Man Dangol': 'This physiotherapy clinic offers excellent facilities such as AC, hot tea/coffee and a clean and comfortable environment than other PT clinics. They provide one-on-one consultations and therapy sessions, ensuring personalized attention for each patient. The professional team at this clinic is truly outstanding. The staff are extremely friendly and helpful. The medical personnel are highly experienced, bringing a wealth of knowledge and expertise to each treatment. Additionally, treatments are conducted using modern equipment and technology, ensuring high-quality care. Services are provided promptly, with special attention to patient convenience. This clinic maintains excellence in its services, and I highly recommend it to everyone.',
  'Rikhi Bau': 'Loved my visit to Physio Studio! 💖 The staff are true professionals, very friendly and experienced. 👩‍⚕️👨‍⚕️ The clinic\'s cleanliness is second to none, and the environment is incredibly soothing. 🌼🛋️ If you need excellent physiotherapy, this is the place to go! 🌟👏',
};

/** The original blog article (typos corrected; the stray sentence about yoga removed). */
const post = {
  excerpt: 'Physiocare combines specialized therapies to restore physical function, relieve pain and promote overall wellness.',
  body: [
    'Physiocare encompasses a range of specialized therapies and treatments aimed at restoring physical function, alleviating pain, and promoting overall wellness. It combines elements of physiotherapy, chiropractic care, and rehabilitative exercises to address musculoskeletal issues, injuries, and chronic conditions.',
    'Central to physiocare is the hands-on approach of physiotherapists who assess, diagnose, and treat patients using manual techniques such as joint mobilization, soft tissue manipulation, and corrective exercises. These professionals tailor treatment plans to individual needs, considering factors like age, medical history, and specific goals for recovery.',
    'Physiocare often includes modalities like ultrasound, electrical stimulation, and heat therapy to complement manual techniques and enhance healing. It focuses not only on symptom relief but also on correcting underlying issues to prevent recurrence and improve long-term function.',
    '### We understand your injury and your pain',
    'Education and guidance are integral components of physiocare, empowering patients with knowledge about their conditions and teaching them self-management techniques to maintain progress between sessions.',
    '- Customized rehabilitation programs tailored to you.\n- Highly trained and certified physiotherapists provide expert care.\n- Physiotherapy techniques effectively manage and reduce pain without relying on medication.\n- Specialized programs aid a quicker and safer recovery.\n- Targeted therapy helps athletes recover from sports injuries.',
    'In essence, physiocare is a holistic approach to health that promotes mobility, reduces pain, and enhances overall quality of life through personalized, evidence-based treatments and comprehensive patient education.',
    '[Book an assessment](/book) to get started.',
  ].join('\n\n'),
};

const gallery = [
  ['/static/img/clinic/reception.jpg', 'Reception'],
  ['/static/img/clinic/treatment-floor.jpg', 'Treatment bays and exercise floor'],
  [CONSULT, 'Consultation with Dr. Pragya Pyakurel'],
  ['/static/img/clinic/exercise-class.jpg', 'Exercise therapy session'],
  ['/static/img/clinic/senior-care.jpg', 'Geriatric care session'],
];

const slides = [
  { image: '/static/img/clinic/reception.jpg', mobile: '/static/img/clinic/reception-900.jpg', focus: 'center', title: 'Revive. Regain. Restore.', text: 'Personalized physiotherapy at Uma Shankar Bhawan, Pani Pokhari, Kathmandu. Open 7 AM to 7 PM, Sunday to Friday.', label: 'Book an assessment', link: '/book' },
  { image: CONSULT, mobile: CONSULT, focus: 'center', title: 'Destination for Relief & Wellness', text: 'State-of-the-art diagnostic and therapeutic equipment to accurately evaluate your condition and track your progress.', label: 'Explore our services', link: '/services' },
  { image: '/static/img/clinic/treatment-floor.jpg', mobile: '/static/img/clinic/treatment-floor-900.jpg', focus: 'center', title: 'A space built for healing', text: 'Private treatment bays, a dedicated exercise floor and modern equipment, all under one roof.', label: 'About the studio', link: '/about' },
  { image: '/static/img/clinic/exercise-class.jpg', mobile: '/static/img/clinic/exercise-class-900.jpg', focus: 'top', title: 'Exercise therapy that rebuilds strength', text: 'Supervised, progressive exercise prescribed for your body and your goals.', label: 'See treatments', link: '/services' },
  { image: '/static/img/clinic/senior-care.jpg', mobile: '/static/img/clinic/senior-care-900.jpg', focus: 'top', title: 'Gentle care for seniors', text: 'Geriatric care plans for balance, strength and independence, with family kept informed of progress.', label: 'View care plans', link: '/packages' },
];

const theme = { brand_color: ['#16443a', '#2e3236'], accent_color: ['#f2b33d', '#f0b323'], tagline: ['Destination for Relief & Wellness', 'Revive. Regain. Restore.'] };

module.exports = { blocks, services, staff, why, testimonials, post, gallery, slides, theme };
