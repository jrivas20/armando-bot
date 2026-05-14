// modules/constants.js
// ─── GHL IDs, social account IDs, pipeline stages, blog IDs ──────────────────
// Nothing here calls APIs or has side effects — safe to require anywhere.
'use strict';

// ─── GHL core ─────────────────────────────────────────────
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'd7iUPfamAaPlSBNj6IhT';
const GHL_USER_ID     = process.env.GHL_USER_ID     || 'ALHFH3LlHUg7V4GuSbop';

// ─── CRM pipeline ─────────────────────────────────────────
const MARKETING_PIPELINE_ID = 'AA7OHokVnWcxHbbclGTk';
const PIPELINE_STAGES = {
  newLead:  '40493ee9-177a-4c42-ac4b-51b431f81a25',
  hotLead:  '184cf994-5c67-4cba-b5a0-c6d619c9fd8b',
  booking:  'b5fd5971-5f90-4343-a93a-22cc60c3bad9',
  attended: 'edc7830a-4171-4bd2-a25f-c84e21b81acb',
  sale:     'cbe933ec-5fd9-4e36-bcc5-b5db54479ffc',
  review:   '508da827-df8a-49f0-ae24-feb1dac67c8c',
};

// ─── JRZ Blog ─────────────────────────────────────────────
const BLOG_ID        = 'BSFKLAs40udrWd6XM0Tw';
const BLOG_AUTHOR_ID = '69b556769166961ed4d1ce43';
const BLOG_CATEGORIES = {
  ai:         '69b5568a6704163c27f63acf',
  automation: '69b556980fecd748ab1e5260',
  marketing:  '69b556a40fecd79c4e1e52f2',
  business:   '69b556c30fecd71ad71e5485',
  ghl:        '69b556b49166960cf8d1d167',
};

// ─── JRZ Marketing social account IDs ────────────────────
const SOCIAL_ACCOUNTS = {
  instagram:    '69571d8023b2d14504f42a08_d7iUPfamAaPlSBNj6IhT_17841419446338150',
  facebook:     '69571d90f8b327442fd7c7ff_d7iUPfamAaPlSBNj6IhT_106416250738350_page',
  linkedinJose: '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_rzdo30Vn11_profile',
  linkedinJRZ:  '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_59796032_page',
  google:       '69571da123b2d16f33f435a2_d7iUPfamAaPlSBNj6IhT_9708635617980992827',
  youtube:      '69571dd027f36d280fc94983_d7iUPfamAaPlSBNj6IhT_UCz-cQ8MvL74r83op8SvuSHw_profile',
  tiktokJose:   '69b64eeeed8b7690d62b17e3_d7iUPfamAaPlSBNj6IhT_000KlsWW3XktDcaqlWJLYjd9wZcGgB2K2R0_profile',
  tiktokJRZ:    '69b64e80794ff7350b7c5681_d7iUPfamAaPlSBNj6IhT_000BpU3LiTvQhmVRbhj0ztTBOYETOcE1k5J_business',
};

// Text-only platforms (no image required)
const TEXT_POST_ACCOUNTS = [
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.google,
];

// Instagram carousel — always posts with images
const INSTAGRAM_ACCOUNTS = [SOCIAL_ACCOUNTS.instagram];

// 4pm daily Reel — all video-capable platforms
const REEL_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.tiktokJose,
  SOCIAL_ACCOUNTS.tiktokJRZ,
];

// Stories: Instagram + Facebook only
const STORY_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
];

// ─── Cloudinary carousel images — 7 days × 4 slides ─────
const CLOUDINARY_BASE = 'https://res.cloudinary.com/dbsuw1mfm/image/upload/jrz';
const CAROUSEL_IMAGES = {
  0: [`${CLOUDINARY_BASE}/day7_slide1.png`, `${CLOUDINARY_BASE}/day7_slide2.png`, `${CLOUDINARY_BASE}/day7_slide3.png`, `${CLOUDINARY_BASE}/day7_slide4.png`],
  1: [`${CLOUDINARY_BASE}/day1_slide1.png`, `${CLOUDINARY_BASE}/day1_slide2.png`, `${CLOUDINARY_BASE}/day1_slide3.png`, `${CLOUDINARY_BASE}/day1_slide4.png`],
  2: [`${CLOUDINARY_BASE}/day2_slide1.png`, `${CLOUDINARY_BASE}/day2_slide2.png`, `${CLOUDINARY_BASE}/day2_slide3.png`, `${CLOUDINARY_BASE}/day2_slide4.png`],
  3: [`${CLOUDINARY_BASE}/day3_slide1.png`, `${CLOUDINARY_BASE}/day3_slide2.png`, `${CLOUDINARY_BASE}/day3_slide3.png`, `${CLOUDINARY_BASE}/day3_slide4.png`],
  4: [`${CLOUDINARY_BASE}/day4_slide1.png`, `${CLOUDINARY_BASE}/day4_slide2.png`, `${CLOUDINARY_BASE}/day4_slide3.png`, `${CLOUDINARY_BASE}/day4_slide4.png`],
  5: [`${CLOUDINARY_BASE}/day5_slide1.png`, `${CLOUDINARY_BASE}/day5_slide2.png`, `${CLOUDINARY_BASE}/day5_slide3.png`, `${CLOUDINARY_BASE}/day5_slide4.png`],
  6: [`${CLOUDINARY_BASE}/day6_slide1.png`, `${CLOUDINARY_BASE}/day6_slide2.png`, `${CLOUDINARY_BASE}/day6_slide3.png`, `${CLOUDINARY_BASE}/day6_slide4.png`],
};

// ─── GBP post type rotation (Mon–Fri) ────────────────────
// All WHATS_NEW — no promotions, no discounts, no offers. Only promote visiting the location.
const GBP_POST_TYPES = ['WHATS_NEW', 'WHATS_NEW', 'WHATS_NEW', 'WHATS_NEW', 'WHATS_NEW'];

module.exports = {
  GHL_LOCATION_ID, GHL_USER_ID,
  MARKETING_PIPELINE_ID, PIPELINE_STAGES,
  BLOG_ID, BLOG_AUTHOR_ID, BLOG_CATEGORIES,
  SOCIAL_ACCOUNTS, TEXT_POST_ACCOUNTS, INSTAGRAM_ACCOUNTS, REEL_ACCOUNTS, STORY_ACCOUNTS,
  CLOUDINARY_BASE, CAROUSEL_IMAGES,
  GBP_POST_TYPES,
};
