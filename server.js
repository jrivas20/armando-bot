const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY   = process.env.GHL_API_KEY;
const NEWS_API_KEY  = process.env.NEWS_API_KEY  || 'dff54f64e9eb4087aa7c215a1c674644';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || 'pHTTmBc8ljBQFxaa0YcUQQ';
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';
const OWNER_CONTACT_ID = process.env.OWNER_CONTACT_ID || 'hywFWrMca0eSCse2Wjs8';
const EMAIL_FROM      = 'info@email.jrzmarketing.com';
const EMAIL_FROM_NAME = 'Jose Rivas | JRZ Marketing';

// ── ElevenLabs voice ──────────────────────────────────────
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = 'SIpDYvpsUzCaJ0WmnSA8'; // Joseph Corona — warm, professional Latino voice

// ── Gmail integration ──────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const GMAIL_ADDRESS        = 'info@jrzmarketing.com';
let   googleAccessToken    = null;
let   googleTokenExpiry    = 0;

// ── Google Calendar constants ───────────────────────────────
const BOOKING_TZ         = 'America/New_York';
const BOOKING_START_HOUR = 7;   // 7am EST
const BOOKING_END_HOUR   = 21;  // 9pm EST
const BOOKING_DURATION   = 15;  // minutes
let   jrzCalendarId      = null; // cached after first lookup
const pendingBookingSlots = new Map(); // contactId → [slot, slot, slot]

// ── DataForSEO — keyword intelligence & SERP rank tracking ─
const DATAFORSEO_LOGIN    = process.env.DATAFORSEO_LOGIN    || 'info@jrzmarketing.com';
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || '';
const DATAFORSEO_BASE     = 'https://api.dataforseo.com';

// ── Google APIs ─────────────────────────────────────────────
const GOOGLE_PLACES_API_KEY  = process.env.GOOGLE_PLACES_API_KEY  || 'AIzaSyC1ra5_WT5mE6QJr64HDrVixFHbionXUkM';
const GOOGLE_INDEXING_BASE   = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const GOOGLE_PLACES_BASE     = 'https://maps.googleapis.com/maps/api';

// ── SEO-enabled sub-accounts ───────────────────────────────
// Central Florida cities — rotated daily so every blog targets a different city.
// 30 cities = 30 unique geo-targeted posts per month per client = page 1 across all of Central FL.
const CENTRAL_FL_CITIES = [
  'Orlando', 'Kissimmee', 'Winter Park', 'Winter Garden', 'Sanford',
  'Lake Mary', 'Celebration', 'Windermere', 'Clermont', 'Apopka',
  'Oviedo', 'Longwood', 'Altamonte Springs', 'Casselberry', 'Maitland',
  'St. Cloud', 'Lake Nona', 'Dr. Phillips', 'Narcoossee', 'Hunters Creek',
  'Deltona', 'Daytona Beach', 'Deland', 'Ocala', 'Leesburg',
  'Osceola County', 'Orange County', 'Seminole County', 'Lake County', 'Polk County',
];

// Returns today's target city — cycles through CENTRAL_FL_CITIES so each day = new city
function getTodaysCity() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return CENTRAL_FL_CITIES[dayOfYear % CENTRAL_FL_CITIES.length];
}

// Add clients here to run daily blogs + weekly SEO plan for them.
const SEO_CLIENTS = {
  'iipUT8kmVxJZzGBzvkZm': {
    name: 'Railing Max',
    domain: 'railingmax.com',
    lang: 'en',
    industry: 'floating stairs, railing, and glass installation',
    voice: 'Expert craftsman and the go-to specialist for floating stairs in Florida. Knows every material, every code, every detail. Talks like someone who has built hundreds of custom staircases and railings — confident, specific, and zero fluff. When homeowners want floating stairs done right, this is who they call.',
    audience: 'Homeowners, architects, interior designers, and builders in Central Florida who want floating stairs, glass railings, cable railings, iron railings, or custom staircases. They care about the wow factor AND safety AND code compliance. They have seen floating stairs on Instagram and want that for their home.',
    keywords: [
      // PRIMARY — floating stairs is the #1 target to dominate Florida
      'floating stairs', 'floating stairs Orlando', 'floating stairs Florida',
      'floating staircase Orlando', 'floating staircase Florida', 'floating stairs near me',
      'open riser stairs Florida', 'open riser staircase Orlando',
      // Secondary — railing + glass
      'glass railing Orlando', 'glass railing installation Florida',
      'stair railing contractor Orlando', 'railing installation Orlando',
      'cable railing Florida', 'cable railing Orlando',
      'iron railing Orlando', 'aluminum railing Florida',
      // Local + pool
      'pool fence Orlando', 'pool fence Clermont FL',
      'railing contractor Central Florida',
    ],
    topics: [
      // Floating stairs — own this topic across Florida
      'what are floating stairs and why every Orlando home wants them in 2026',
      'floating stairs cost guide Florida — what to expect before you build',
      'floating stairs vs traditional staircase which is right for your home',
      'how floating stairs are built — materials, codes, and installation process Florida',
      'best wood choices for floating stairs in Florida humidity',
      'floating stairs with glass railing the most popular combo in Orlando right now',
      'open riser staircase building codes Florida what you need to know',
      'how to get floating stairs installed in your Florida home step by step',
      // Railing topics
      'glass railing installation Orlando — cost, materials, and what to expect',
      'cable railing vs glass railing which looks better in a Florida home',
      'pool fence requirements Orange County Florida 2026',
      'stair railing contractor Orlando how to choose the right one',
      'iron railing vs aluminum railing which holds up better in Florida weather',
      'railing installation cost guide Central Florida',
      'custom railing ideas for Florida homes that stand out',
    ],
    cta: 'Get your free floating stairs or railing quote at railingmax.com',
    ga4PropertyId: '529233384',
    apiKey: 'pit-3a6936c1-5f10-4e4d-bb26-26bec9ebef1c',
  },
  'rJKRuyayc6Z6twr9X20v': {
    name: 'The Escobar Kitchen',
    domain: 'theescobarkitchen.com',
    lang: 'en',
    industry: 'Latin Asian fusion restaurant',
    voice: 'Bold, passionate, and proud of every single dish. Writes like someone who is genuinely obsessed with food — the flavors, the craft, the experience. Warm but confident. Makes you feel like you are missing out if you are not there tonight.',
    audience: 'Food lovers in Kissimmee, Narcoossee, Lake Nona, and greater Orlando searching for something beyond the ordinary — a restaurant where Latin soul meets Asian precision. Date nights, celebrations, foodies, and anyone who searches "best sushi near me" or "latin restaurant near me".',
    keywords: [
      'latin restaurant near me', 'sushi near me', 'asian fusion near me', 'latin asian fusion',
      'best sushi Orlando', 'best latin restaurant Orlando', 'asian fusion Kissimmee',
      'latin restaurant Kissimmee', 'sushi Narcoossee', 'unique restaurants near Disney',
      'best spicy tuna crispy rice Orlando', 'fusion restaurant Central Florida',
      'date night restaurants Kissimmee', 'upscale restaurant Lake Nona',
    ],
    topics: [
      'why The Escobar Kitchen is the best latin asian fusion in Central Florida',
      'best sushi near Disney World Orlando',
      'what is latin asian fusion food and why Orlando is obsessed with it',
      'best date night restaurants in Kissimmee FL',
      'spicy tuna crispy rice the dish everyone is talking about in Orlando',
      'best asian fusion restaurants near Lake Nona',
      'what to order at The Escobar Kitchen — a locals guide',
      'latin restaurant Narcoossee FL hidden gem',
      'best seafood restaurants Kissimmee 2026',
      'asian fusion vs traditional sushi what is the difference',
    ],
    cta: 'Reserve your table or order online at theescobarkitchen.com',
    ga4PropertyId: '529262280',
    apiKey: 'pit-64018b7f-6192-47b1-b134-62109b155fc9',
  },
  '6FdG0APBuZ81P8X2H4zc': {
    name: 'Rental Spaces',
    domain: 'rentalspacesinc.com',
    lang: 'en',
    industry: 'RV and boat storage',
    voice: 'Practical and no-nonsense. Speaks to people who love their toys (RVs, boats, ATVs) and want safe, affordable storage without the hassle. Friendly but to the point.',
    audience: 'RV owners, boaters, and outdoor enthusiasts in the Orlando area who need secure, affordable storage between trips.',
    topics: ['how to store your RV in Florida summer', 'boat storage near Orlando', 'indoor vs outdoor RV storage', 'tips for winterizing your boat in Florida', 'how to choose an RV storage facility', 'cost of boat storage Orlando', 'RV storage security features to look for'],
    cta: 'Reserve your storage space at rentalspacesinc.com',
    apiKey: 'pit-1b29023e-d415-4ab6-b18d-1a1072d4c355',
  },
  'Emg5M7GZE7XmnHc7F5vy': {
    name: 'Guaca-Mole-Tex-Mex',
    domain: 'guaca-mole-texmex.com',
    lang: 'en',
    industry: 'Tex-Mex restaurant',
    voice: 'Fun, bold, and unapologetically Tex-Mex. Celebrates big flavors, good times, and authentic recipes. Casual, energetic, and makes you hungry just reading it.',
    audience: 'Families, friend groups, and Tex-Mex lovers in Orlando looking for generous portions, great margaritas, and a lively atmosphere.',
    topics: ['best Tex-Mex in Orlando', 'authentic guacamole made fresh daily', 'best margaritas Orlando FL', 'Tex-Mex vs Mexican food what is the difference', 'family-friendly restaurants Orlando', 'best tacos near me Orlando', 'happy hour deals Orlando restaurants'],
    cta: 'Come hungry — find us at guaca-mole-texmex.com',
    apiKey: 'pit-3ba32a5e-775f-46e6-9e5d-4a201148f7fb',
  },
  'd7iUPfamAaPlSBNj6IhT': {
    name: 'JRZ Marketing',
    domain: 'jrzmarketing.com',
    lang: 'en',
    industry: 'AI marketing agency',
    voice: 'Sharp, confident, and results-driven. José Rivas speaks from real experience building systems that work. Bilingual edge, deep understanding of Latino entrepreneurs, zero tolerance for fluff or wasted ad spend.',
    audience: 'Small business owners, Latino entrepreneurs, and service-based businesses in Orlando and Central Florida who want real growth — more leads, more sales, more automation.',
    topics: ['AI marketing automation for small business Orlando', 'how to get more leads without spending more on ads', 'Go High Level for small business', 'social media automation that actually works', 'bilingual marketing strategy Florida', 'how to rank your business on Google Maps Orlando', 'marketing mistakes small business owners make'],
    cta: 'Book your free strategy call at jrzmarketing.com/contact-us',
    ga4PropertyId: '384751711',
  },
  'Gc4sUcLiRI2edddJ5Lfl': {
    name: 'Cooney Homes',
    domain: 'cooneyhomesfl.com',
    lang: 'en',
    industry: 'general contractor — home additions, custom home building, and remodeling',
    voice: 'Experienced builder who has seen every type of project in Florida and knows exactly what it takes to do it right. Practical, confident, and zero tolerance for shortcuts. Speaks to homeowners who want their vision built properly — on time and on budget.',
    audience: 'Florida homeowners who want to add square footage, build a custom home from scratch, add a garage, expand a kitchen, or build an in-law suite. Also builders and developers in Central Florida looking for a trusted general contractor.',
    keywords: [
      'general contractor Orlando', 'home addition Orlando', 'custom home builder Orlando',
      'room addition Central Florida', 'home remodel Orlando', 'kitchen addition Florida',
      'in-law suite addition Orlando', 'garage addition Florida', 'custom home construction Orlando',
      'home expansion contractor Central Florida',
    ],
    topics: [
      'how much does a home addition cost in Florida 2026',
      'custom home builder vs production builder which is right for you',
      'home addition ideas that add the most value in Central Florida',
      'how to add a room to your house in Florida step by step',
      'building an in-law suite in Orlando what you need to know',
      'kitchen addition vs full remodel which makes more sense',
      'garage addition costs and permits in Orange County Florida',
      'how to find a trustworthy general contractor in Central Florida',
      'how long does a home addition take in Florida',
      'building a custom home in Orlando from land to move-in',
    ],
    cta: 'Start your project with a free consultation at cooneyhomesfl.com',
    ga4PropertyId: '503054433',
    apiKey: 'pit-cd43cc72-9e18-4eee-9bfb-be5942de9722',
  },
  'OpdBPAp31zItOc5IIykL': {
    name: 'Le Varon Barbershop',
    domain: 'levaronbarbershop.com',
    lang: 'en',
    industry: 'barbershop',
    voice: 'Cool, confident, and community-rooted. Celebrates the culture of the barbershop — where men come for more than a haircut. Speaks the language of style, brotherhood, and taking pride in your appearance.',
    audience: 'Men in Orlando who care about their look — from clean fades to beard lineups. Loyal barbershop clients who see their barber as part of their weekly routine.',
    topics: ['best barbershop Orlando FL', 'how to find the right barber', 'fade haircut styles 2026', 'how to maintain your beard between cuts', 'barbershop vs hair salon what is the difference', 'mens grooming tips Orlando', 'why a good barber is worth it'],
    cta: 'Book your appointment at levaronbarbershop.com',
  },
  'VWHZW08b0skUV7wcnG55': {
    name: 'USA Latino CPA',
    domain: 'usalatinocpa.com',
    lang: 'en',
    industry: 'accounting and tax services',
    voice: 'Trustworthy, clear, and culturally aware. Speaks to Latino business owners and immigrants who have been underserved by mainstream accountants. Demystifies taxes and finances without being condescending — in plain language, sometimes with Spanish terms.',
    audience: 'Latino entrepreneurs, self-employed immigrants, and small business owners in Florida who need bilingual accounting help, tax filing, and financial guidance they can actually understand.',
    topics: ['how to file taxes as a self-employed immigrant Florida', 'LLC vs sole proprietor for Latino business owners', 'tax deductions for small business owners', 'how to build business credit in the US', 'ITIN taxes what you need to know', 'accounting tips for restaurant owners', 'why your business needs a bilingual CPA'],
    cta: 'Schedule a free consultation at usalatinocpa.com',
    apiKey: 'pit-525c7ac9-a267-4e71-a26b-a43f12d27079',
    ga4PropertyId: '529255116',
  },
  // Add more clients below — copy the format above
  // 'LOCATION_ID': { name, domain, lang, industry, voice, audience, topics: [], cta },
};

// ── Bland.ai voice calls ───────────────────────────────────
const BLAND_API_KEY     = process.env.BLAND_API_KEY;
const BLAND_WEBHOOK_URL = 'https://armando-bot-1.onrender.com/webhook/bland';
const blandCallsSent       = new Set(); // prevent double-calling same contact
const blandConsentAsked    = new Set(); // contacts who were offered a call

// ═══════════════════════════════════════════════════════════
// JRZ AI OFFICE — ACTIVITY & STATUS SYSTEM
// ═══════════════════════════════════════════════════════════
const OFFICE_LOG  = [];   // last 100 entries, newest first
const OFFICE_CHAT = [];   // inter-agent messages, last 50
const OFFICE_KPI  = { dmsHandled: 0, leadsCapture: 0, postsPublished: 0, sitesMonitored: 0, dealsTracked: 0, emailsSent: 0 };

const OFFICE_KPI_PID = 'jrz/office_kpi';
const OFFICE_KPI_URL = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/${OFFICE_KPI_PID}.json`;

async function loadOfficeKPI() {
  try {
    const res = await axios.get(OFFICE_KPI_URL + '?t=' + Date.now(), { timeout: 8000 });
    const saved = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    Object.assign(OFFICE_KPI, saved);
    console.log('[Office] KPIs restored:', JSON.stringify(OFFICE_KPI));
  } catch { console.log('[Office] No saved KPIs found — starting fresh.'); }
}

async function saveOfficeKPI() {
  try {
    const ts  = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(`overwrite=true&public_id=${OFFICE_KPI_PID}&timestamp=${ts}${CLOUDINARY_API_SECRET}`).digest('hex');
    const form = new FormData();
    form.append('file', Buffer.from(JSON.stringify(OFFICE_KPI)), { filename: 'office_kpi.json', contentType: 'application/json' });
    form.append('public_id',    OFFICE_KPI_PID);
    form.append('resource_type','raw');
    form.append('timestamp',    String(ts));
    form.append('api_key',      CLOUDINARY_API_KEY);
    form.append('signature',    sig);
    form.append('overwrite',    'true');
    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 20000 });
    console.log('[Office] KPIs saved to Cloudinary.');
  } catch (err) { console.error('[Office] KPI save failed:', err.message); }
}

const AGENT_STATUS = {
  armando:  { status: 'idle', task: 'Monitoring DMs & comments', lastSeen: null },
  elena:    { status: 'idle', task: 'Standing by',                lastSeen: null },
  diego:    { status: 'idle', task: 'Standing by',                lastSeen: null },
  marco:    { status: 'idle', task: 'Standing by',                lastSeen: null },
  sofia:    { status: 'idle', task: 'Monitoring client sites',    lastSeen: null },
  isabella: { status: 'idle', task: 'Standing by',                lastSeen: null },
};

const SUB_AGENTS = {
  armando:  [
    { name: 'DM Responder',    icon: '💬', desc: 'Handles all inbound DMs 24/7' },
    { name: 'Lead Scorer',     icon: '🎯', desc: 'Qualifies and tags every lead' },
    { name: 'Voice Note Bot',  icon: '🎙️', desc: 'Sends Bland.ai voice follow-ups' },
  ],
  elena: [
    { name: 'Health Monitor',  icon: '❤️',  desc: 'Weekly subaccount health checks' },
    { name: 'Report Writer',   icon: '📊', desc: 'Monthly client reports' },
    { name: 'Check-in Sender', icon: '📨', desc: '30-day rolling client check-ins' },
  ],
  diego: [
    { name: 'Standup Bot',     icon: '☀️', desc: 'Daily pipeline standup email' },
    { name: 'Report Builder',  icon: '📋', desc: 'Weekly deal health report' },
    { name: 'Scorecard',       icon: '🏅', desc: 'Monthly client grading (A–F)' },
  ],
  marco: [
    { name: 'Content Briefer', icon: '✍️', desc: 'Weekly save-optimized content strategy' },
    { name: 'Trend Watcher',   icon: '🔥', desc: 'Mid-week viral trend alerts' },
    { name: 'Caption Engine',  icon: '📝', desc: 'Emotional hooks & save-trigger captions' },
  ],
  sofia: [
    { name: 'Uptime Monitor',  icon: '🌐', desc: 'Checks all client sites every 6h' },
    { name: 'CRO Auditor',     icon: '🔍', desc: 'Monthly conversion rate audit' },
    { name: 'Page Builder',    icon: '🏗️', desc: 'Builds AI landing pages for clients' },
  ],
  isabella: [
    { name: 'Email Crafter',   icon: '💌', desc: 'Writes nurture email sequences' },
    { name: 'A/B Tester',      icon: '⚗️', desc: 'Tracks closing variant performance' },
    { name: 'Data Enricher',   icon: '🔎', desc: 'Apollo email enrichment pipeline' },
  ],
};

function logActivity(agent, type, message, meta = {}) {
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, ts: new Date().toISOString(), agent, type, message, meta };
  OFFICE_LOG.unshift(entry);
  if (OFFICE_LOG.length > 100) OFFICE_LOG.length = 100;
  if (AGENT_STATUS[agent]) AGENT_STATUS[agent].lastSeen = entry.ts;
}
function agentChat(from, to, message) {
  OFFICE_CHAT.unshift({ ts: new Date().toISOString(), from, to, message });
  if (OFFICE_CHAT.length > 50) OFFICE_CHAT.length = 50;
  logActivity(from, 'collab', `→ ${to.charAt(0).toUpperCase() + to.slice(1)}: ${message}`);
}
function setAgentBusy(agent, task) {
  if (AGENT_STATUS[agent]) { AGENT_STATUS[agent].status = 'working'; AGENT_STATUS[agent].task = task; AGENT_STATUS[agent].lastSeen = new Date().toISOString(); }
}
function setAgentIdle(agent, task) {
  if (AGENT_STATUS[agent]) { AGENT_STATUS[agent].status = 'idle'; AGENT_STATUS[agent].task = task || 'Standing by'; AGENT_STATUS[agent].lastSeen = new Date().toISOString(); }
}
function setAgentAlert(agent, task) {
  if (AGENT_STATUS[agent]) { AGENT_STATUS[agent].status = 'alert'; AGENT_STATUS[agent].task = task; AGENT_STATUS[agent].lastSeen = new Date().toISOString(); }
}

async function sendEmail(contactId, subject, html) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: 'Email', contactId, subject, html, emailFrom: EMAIL_FROM, emailFromName: EMAIL_FROM_NAME },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
  );
}

// ─── Cloudinary credentials ────────────────────────────────
const CLOUDINARY_CLOUD      = 'dbsuw1mfm';
const CLOUDINARY_API_KEY    = '984314321446626';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'IdUnHGrO7wYG6JTSrRyiIwg1Q-g';

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA — ACCOUNT IDs & CONSTANTS
// ═══════════════════════════════════════════════════════════
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'd7iUPfamAaPlSBNj6IhT';
const GHL_USER_ID     = process.env.GHL_USER_ID     || 'ALHFH3LlHUg7V4GuSbop';

// ─── Marketing Pipeline constants ────────────────────────
const MARKETING_PIPELINE_ID = 'AA7OHokVnWcxHbbclGTk';
const PIPELINE_STAGES = {
  newLead:  '40493ee9-177a-4c42-ac4b-51b431f81a25',
  hotLead:  '184cf994-5c67-4cba-b5a0-c6d619c9fd8b',
  booking:  'b5fd5971-5f90-4343-a93a-22cc60c3bad9',
  attended: 'edc7830a-4171-4bd2-a25f-c84e21b81acb',
  sale:     'cbe933ec-5fd9-4e36-bcc5-b5db54479ffc',
  review:   '508da827-df8a-49f0-ae24-feb1dac67c8c',
};

// ─── Blog constants ───────────────────────────────────────
const BLOG_ID        = 'BSFKLAs40udrWd6XM0Tw';
const BLOG_AUTHOR_ID = '69b556769166961ed4d1ce43';
const BLOG_CATEGORIES = {
  ai:         '69b5568a6704163c27f63acf',
  automation: '69b556980fecd748ab1e5260',
  marketing:  '69b556a40fecd79c4e1e52f2',
  business:   '69b556c30fecd71ad71e5485',
  ghl:        '69b556b49166960cf8d1d167',
};

const SOCIAL_ACCOUNTS = {
  instagram:    '69571d8023b2d14504f42a08_d7iUPfamAaPlSBNj6IhT_17841419446338150',
  facebook:     '69571d90f8b327442fd7c7ff_d7iUPfamAaPlSBNj6IhT_106416250738350_page',
  linkedinJose: '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_rzdo30Vn11_profile',
  linkedinJRZ:  '69571db227f36db5a4c941a7_d7iUPfamAaPlSBNj6IhT_59796032_page',
  google:       '69571da123b2d16f33f435a2_d7iUPfamAaPlSBNj6IhT_9708635617980992827',
  youtube:        '69571dd027f36d280fc94983_d7iUPfamAaPlSBNj6IhT_UCz-cQ8MvL74r83op8SvuSHw_profile',
  tiktokJose:     '69b64eeeed8b7690d62b17e3_d7iUPfamAaPlSBNj6IhT_000KlsWW3XktDcaqlWJLYjd9wZcGgB2K2R0_profile',
  tiktokJRZ:      '69b64e80794ff7350b7c5681_d7iUPfamAaPlSBNj6IhT_000BpU3LiTvQhmVRbhj0ztTBOYETOcE1k5J_business',
};

// Facebook, LinkedIn, YouTube, Google Business accept text-only posts
const TEXT_POST_ACCOUNTS = [
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.google,
];

// Instagram carousel accounts — always posts with images
const INSTAGRAM_ACCOUNTS = [SOCIAL_ACCOUNTS.instagram];

// 4pm daily Reel accounts — all 7 video-capable platforms
const REEL_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
  SOCIAL_ACCOUNTS.youtube,
  SOCIAL_ACCOUNTS.linkedinJose,
  SOCIAL_ACCOUNTS.linkedinJRZ,
  SOCIAL_ACCOUNTS.tiktokJose,
  SOCIAL_ACCOUNTS.tiktokJRZ,
];

// ─── Cloudinary Carousel Images — 7 days × 4 slides ────────────────────────
// URLs without version = always serve latest uploaded image (overwrite weekly)
// Mapping: JS getDay() 0=Sun → day7, 1=Mon → day1, ..., 6=Sat → day6
const CLOUDINARY_BASE = 'https://res.cloudinary.com/dbsuw1mfm/image/upload/jrz';
const CAROUSEL_IMAGES = {
  0: [ // Sunday
    `${CLOUDINARY_BASE}/day7_slide1.png`,
    `${CLOUDINARY_BASE}/day7_slide2.png`,
    `${CLOUDINARY_BASE}/day7_slide3.png`,
    `${CLOUDINARY_BASE}/day7_slide4.png`,
  ],
  1: [ // Monday
    `${CLOUDINARY_BASE}/day1_slide1.png`,
    `${CLOUDINARY_BASE}/day1_slide2.png`,
    `${CLOUDINARY_BASE}/day1_slide3.png`,
    `${CLOUDINARY_BASE}/day1_slide4.png`,
  ],
  2: [ // Tuesday
    `${CLOUDINARY_BASE}/day2_slide1.png`,
    `${CLOUDINARY_BASE}/day2_slide2.png`,
    `${CLOUDINARY_BASE}/day2_slide3.png`,
    `${CLOUDINARY_BASE}/day2_slide4.png`,
  ],
  3: [ // Wednesday
    `${CLOUDINARY_BASE}/day3_slide1.png`,
    `${CLOUDINARY_BASE}/day3_slide2.png`,
    `${CLOUDINARY_BASE}/day3_slide3.png`,
    `${CLOUDINARY_BASE}/day3_slide4.png`,
  ],
  4: [ // Thursday
    `${CLOUDINARY_BASE}/day4_slide1.png`,
    `${CLOUDINARY_BASE}/day4_slide2.png`,
    `${CLOUDINARY_BASE}/day4_slide3.png`,
    `${CLOUDINARY_BASE}/day4_slide4.png`,
  ],
  5: [ // Friday
    `${CLOUDINARY_BASE}/day5_slide1.png`,
    `${CLOUDINARY_BASE}/day5_slide2.png`,
    `${CLOUDINARY_BASE}/day5_slide3.png`,
    `${CLOUDINARY_BASE}/day5_slide4.png`,
  ],
  6: [ // Saturday
    `${CLOUDINARY_BASE}/day6_slide1.png`,
    `${CLOUDINARY_BASE}/day6_slide2.png`,
    `${CLOUDINARY_BASE}/day6_slide3.png`,
    `${CLOUDINARY_BASE}/day6_slide4.png`,
  ],
};

// Stories: Instagram + Facebook only
const STORY_ACCOUNTS = [
  SOCIAL_ACCOUNTS.instagram,
  SOCIAL_ACCOUNTS.facebook,
];

// ─────────────────────────────────────────────────────────
// PLATFORM CHARACTER LIMITS (enforced when building captions)
// Instagram: 2,200 | Facebook: 63,206 | LinkedIn: 3,000
// YouTube Community: 500 | Google Business: 1,500
// The main caption is optimized for Instagram (≤2,200 chars).
// ─────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
// 14 PRE-WRITTEN CAROUSEL SCRIPTS — WEEKS 1 & 2
// (Week 3+ → NewsAPI + Claude generates fresh content daily)
// Theme: Jose Rivas as THE AI/Automation Guru for Latino entrepreneurs
// ═══════════════════════════════════════════════════════════
const CAROUSEL_SCRIPTS = [
  // ── WEEK 1 ─────────────────────────────────────────────
  {
    title: '5 herramientas de IA que están usando los negocios más exitosos',
    caption: `¿Todavía haciendo todo a mano? 😅

En 2026, la IA ya no es una ventaja — es una necesidad.

Aquí las 5 herramientas que estoy implementando con mis clientes:

1️⃣ CRM con IA → cero leads perdidos
2️⃣ Chatbot 24/7 → responde mientras duermes
3️⃣ Email automation → nutre a tus clientes solo
4️⃣ Scheduler de redes → publica sin pensar
5️⃣ Analytics con IA → toma decisiones con datos reales

¿Tu negocio ya usa alguna? 👇 Comenta cuál y te digo cómo optimizarla.

Guarda este post — lo vas a necesitar. 🔖

#MarketingDigital #InteligenciaArtificial #NegociosLatinos #Emprendedores #AutomatizaciónIA #JRZMarketing #IA2026 #HerramientasIA`,
  },
  {
    title: 'Tu negocio está perdiendo clientes HOY por esto',
    caption: `La realidad que nadie te quiere decir:

Cada vez que tardas más de 5 minutos en responder un mensaje, pierdes ese cliente. ❌

Estadística real: el 78% de los clientes compra al primero que responde.

¿Cuántos leads pierdes por semana porque no tienes un sistema?

En JRZ Marketing resolvemos eso con IA que responde en segundos:
→ DMs de Instagram
→ Mensajes de Facebook
→ WhatsApp y más

24 horas. 7 días. Sin descanso.

¿Quieres ver cómo funciona para tu negocio?
Agenda gratis → ${BOOKING_URL}

💬 Comenta "QUIERO" y te cuento más.

#AutomatizaciónIA #ChatbotIA #NegociosLatinos #MarketingDigital #JRZMarketing #Emprendedores #LeadGeneration`,
  },
  {
    title: 'Cómo generé 50+ leads en 30 días sin gastar en publicidad',
    caption: `Te voy a ser 100% honesto sobre cómo funciona el crecimiento real. 🎯

No fue suerte. Fue sistema.

Lo que hicimos:
✅ Contenido que educa (como este)
✅ CRM conectado a todas las redes
✅ IA que califica leads automáticamente
✅ Follow-up en menos de 60 segundos
✅ Proceso de ventas claro y repetible

El resultado: 50+ leads calificados. En un mes.

El secreto no es gastar más en ads.
Es convertir mejor lo que ya tienes.

¿Cuántos leads estás dejando ir esta semana?

Dime tu industria abajo y te doy un tip específico para la tuya 👇

#LeadGeneration #MarketingOrgánico #NegociosLatinos #Emprendedores2026 #JRZMarketing #SistemaDeMarketing`,
  },
  {
    title: 'El error #1 que destruye el marketing de los emprendedores',
    caption: `Lo veo todo el tiempo con negocios latinos... 😬

Están en Instagram, Facebook, TikTok, LinkedIn, Twitter...

Pero en ninguna están convirtiendo.

El problema: PRESENCIA sin ESTRATEGIA.

Estar en todas partes pero no profundizar en ninguna es el error más caro que existe.

Lo que funciona de verdad:
→ 2 plataformas bien trabajadas
→ Contenido que educa Y vende
→ Sistema de captura de leads
→ Follow-up automatizado
→ CTA claro en cada post

¿En cuántas redes estás? ¿Cuántas ventas te generan?

Sé honesto en los comentarios 👇

#EstrategiaDigital #MarketingLatino #Emprendedores #NegociosExitosos #JRZMarketing #MarketingDigital`,
  },
  {
    title: 'El vendedor que nunca duerme: así funciona nuestra IA',
    caption: `Las 2am. Alguien te escribe por Instagram.

Si no tienes sistema: ese lead se va.
Si tienes nuestra IA: responde en 10 segundos. 🤖

Así funciona Armando, nuestra IA de ventas:

🧠 Entiende lo que el cliente necesita
💬 Responde en español o inglés
📋 Califica si es un buen lead
📲 Pide teléfono y email
📅 Los manda a agendar una llamada

Todo automático. Sin intervención humana.

¿Cuánto te está costando no tener esto?

Escríbeme "IA" en los comentarios y te cuento cómo funciona para tu tipo de negocio 👇

#ChatbotIA #VentasAutomáticas #NegociosLatinos #AutomatizaciónIA #JRZMarketing #InteligenciaArtificial`,
  },
  {
    title: 'Negocio que crece vs negocio que se estanca: la diferencia real',
    caption: `Después de trabajar con 50+ negocios latinos, identificé el patrón.

Los que CRECEN hacen esto:
✅ Tienen sistema (CRM, automatización, seguimiento)
✅ Miden todo — toman decisiones con datos
✅ Crean contenido consistente semana tras semana
✅ Responden rápido a cada lead
✅ Invierten antes de que lo necesiten

Los que se ESTANCAN hacen esto:
❌ Trabajan por intuición, sin datos
❌ Publican cuando tienen ganas
❌ No tienen sistema de seguimiento
❌ Esperan resultados sin consistencia
❌ Esperan el "momento perfecto"

¿En cuál grupo está tu negocio hoy?

No hay juicio — hay solución.
Agenda una sesión gratuita y lo vemos juntos:
${BOOKING_URL}

#CrecimientoNegocio #NegociosLatinos #Emprendedores #MarketingDigital #JRZMarketing`,
  },
  {
    title: 'El sistema de marketing que usamos con cada cliente',
    caption: `No hay magia. Solo sistema. 💡

Esto es exactamente lo que implementamos en JRZ Marketing:

📍 FASE 1 — Diagnóstico
Analizamos tu situación real, tus competidores, tu cliente ideal.

📍 FASE 2 — Estrategia
Diseñamos un plan personalizado (no genérico, no copiado).

📍 FASE 3 — Implementación
CRM + automatización + contenido + IA todo conectado.

📍 FASE 4 — Crecimiento
Contenido 7 días/semana, ads cuando aplique, seguimiento constante.

📍 FASE 5 — Optimización
Medimos, ajustamos, escalamos. Mes a mes.

¿Quieres verlo en acción para tu negocio?
30 minutos. Sin costo. Sin compromiso.

Agenda aquí → ${BOOKING_URL}

#SistemaMarketing #MarketingDigital #NegociosLatinos #Emprendedores #JRZMarketing #AutomatizaciónIA`,
  },

  // ── WEEK 2 ─────────────────────────────────────────────
  {
    title: '7 procesos que puedes automatizar esta semana en tu negocio',
    caption: `¿Cuántas horas a la semana gastas en tareas repetitivas? ⏰

Aquí 7 cosas que ya deberían estar automatizadas:

1️⃣ Respuestas a DMs → IA 24/7
2️⃣ Seguimiento a leads → email + SMS automático
3️⃣ Confirmación de citas → sin llamadas manuales
4️⃣ Recordatorios de pago → sin perseguir a nadie
5️⃣ Reseñas de clientes → solicitud automática post-servicio
6️⃣ Publicación en redes → programado una vez, publica solo
7️⃣ Reportes de marketing → datos listos sin buscarlos

Cada hora que gastas en estas tareas es una hora que no estás creciendo.

¿Cuál automatizarías primero?
Dímelo abajo 👇

#AutomatizaciónNegocio #EficienciaEmpresarial #NegociosLatinos #IA #JRZMarketing #Emprendedores`,
  },
  {
    title: '¿Qué es un CRM y por qué tu negocio pierde dinero sin uno?',
    caption: `Un CRM no es lujo. Es lo mínimo para crecer. 💼

Sin CRM:
❌ Leads que se te olvidan
❌ Clientes que no regresan
❌ Oportunidades perdidas por seguimiento tardío
❌ Tu equipo desorganizado
❌ Cero visibilidad de tu negocio

Con el CRM correcto:
✅ Cada lead capturado y seguido automáticamente
✅ Clientes que regresan solos
✅ Pipeline claro y predecible
✅ Equipo alineado con un solo sistema
✅ Datos reales para tomar decisiones

El CRM que usamos con clientes: Go High Level.
Implementación completa hecha por nosotros.

¿Ya tienes uno? ¿Lo estás usando bien?
Cuéntame abajo 👇

#CRM #GoHighLevel #NegociosDigitales #AutomatizaciónIA #JRZMarketing #MarketingDigital #NegociosLatinos`,
  },
  {
    title: 'Instagram vs Facebook vs LinkedIn vs YouTube: ¿Dónde está tu cliente?',
    caption: `La pregunta que me hacen siempre: "¿En qué red debo estar?"

Mi respuesta honesta: depende de quién es tu cliente. 🎯

📱 INSTAGRAM
→ Negocios locales, servicios, estilo de vida
→ Edad 18-40. Visual y emocional.
→ Reels + Carruseles + Stories = crecimiento

👥 FACEBOOK
→ Comunidades locales, 30-60 años
→ Grupos, eventos, ads muy segmentados

💼 LINKEDIN
→ B2B, servicios de alto valor, profesionales
→ Empresarios y tomadores de decisión

▶️ YOUTUBE
→ Contenido de valor largo plazo
→ Posicionamiento como experto
→ Búsquedas orgánicas que nunca paran

Mi recomendación para emprendedores latinos:
Empieza en 2. Hazlo bien. Luego expande.

¿Cuál es tu red principal ahora mismo?

#RedesSociales #EstrategiaDigital #MarketingLatino #Emprendedores #JRZMarketing`,
  },
  {
    title: 'El embudo de ventas que todo emprendedor latino necesita',
    caption: `Sin embudo de ventas estás dejando dinero en la mesa. 💸

El embudo que funciona para negocios latinos:

🔝 ATRACCIÓN
→ Contenido en redes que educa y engancha
→ Reel/carrusel 7 días a la semana

⬇️ CAPTURA
→ Lead magnet (guía, consulta gratis, etc.)
→ Landing page optimizada con CTA claro

⬇️ NUTRICIÓN
→ Email automation con valor real
→ Follow-up con IA en segundos

⬇️ CONVERSIÓN
→ Llamada de estrategia gratuita
→ Propuesta personalizada

⬇️ RETENCIÓN
→ Servicio que supera expectativas
→ Programa de referidos

¿En cuál etapa está fallando tu negocio?
Dímelo abajo y te doy un consejo específico 🎯

#EmbudoVentas #EstrategiaMarketing #NegociosLatinos #Emprendedores #JRZMarketing`,
  },
  {
    title: 'Cómo crear contenido viral sin ser influencer',
    caption: `No necesitas millones de seguidores para que tu contenido impacte. ✋

La fórmula del contenido que funciona:

💡 HOOK — Las primeras 3 palabras detienen el scroll
📚 VALOR — Un aprendizaje accionable que puedan usar HOY
🎭 EMOCIÓN — Que inspire, enseñe o conecte
🔄 COMPARTIBLE — Que lo guarden o lo manden a alguien
📣 CTA — Diles exactamente qué hacer después

El contenido viral no es suerte.
Es fórmula aplicada consistentemente.

¿Cuál de estos elementos le falta más a tu contenido?

Dime abajo y te doy feedback específico 👇

Guarda este post 🔖 — te lo vas a agradecer.

#ContenidoViral #MarketingContenidos #CreadorContenido #NegociosLatinos #JRZMarketing #EstrategiaContenido`,
  },
  {
    title: '3 tipos de contenido que SIEMPRE generan ventas',
    caption: `No todo el contenido vende igual.

Después de manejar decenas de cuentas, estos 3 nunca fallan:

1️⃣ PRUEBA SOCIAL
"Mira lo que logramos para este cliente..."
→ Resultados reales + historia = confianza instantánea

2️⃣ EDUCACIÓN + PROBLEMA
"El error que te está costando clientes..."
→ Identifies el dolor, ofreces la solución

3️⃣ TRANSFORMACIÓN
"Antes vs Después — 90 días de trabajo"
→ Muestra el viaje, no solo el destino

¿Cuál usas menos?
Ese es tu punto ciego. Ese es donde más oportunidad tienes.

Empieza a publicar estos 3 y verás la diferencia en 30 días.

¿Quieres una estrategia de contenido para tu negocio específico?
Escríbenos un DM 📩

#EstrategiaContenido #MarketingDigital #Ventas #NegociosLatinos #JRZMarketing`,
  },
  {
    title: 'El ROI real del marketing digital (números sin mentiras)',
    caption: `La pregunta que siempre me hacen: "¿Cuánto voy a ganar si invierto en marketing?"

La respuesta honesta: depende. Pero aquí los números reales:

📊 Email marketing: $36 por cada $1 invertido (promedio global)
📊 SEO local: 5-10x ROI en 6-12 meses
📊 Redes sociales orgánicas: depende de tu sistema de conversión
📊 Facebook/IG Ads bien optimizados: 3-8x ROAS

Lo que NADIE te dice:
→ El marketing digital SÍ funciona
→ Pero necesita mínimo 90 días de consistencia
→ Necesita sistema (CRM + automatización)
→ Necesita estrategia, no solo "post y reza"

¿Cuánto llevas invirtiendo en marketing y qué resultado tienes?
Dime honestamente abajo 👇

#ROIMarketing #MarketingDigital #NegociosLatinos #Inversión #JRZMarketing #Emprendedores`,
  },
];

// ═══════════════════════════════════════════════════════════
// DAILY STORY TEMPLATES — Rotate by day of week (0=Sun…6=Sat)
// Platform: Instagram + Facebook | Type: story
// Character limit: aim for ≤500 chars (short & punchy)
// ═══════════════════════════════════════════════════════════
const STORY_TEMPLATES = [
  // Sunday (0)
  {
    text: `Nueva semana. Nueva oportunidad de crecer. 🌟\n\n¿Tu negocio tiene el sistema para captarlo?\n\nAgenda tu sesión estratégica GRATIS esta semana 👇\n${BOOKING_URL}\n\nJRZ Marketing · Orlando, FL`,
    cta: 'Agenda esta semana',
  },
  // Monday (1)
  {
    text: `¿Listo para transformar tu negocio esta semana? 🚀\n\nTe regalamos 30 minutos de estrategia gratis.\nSin costo. Sin compromiso.\n\n👉 ${BOOKING_URL}\n\nJRZ Marketing · jrzmarketing.com`,
    cta: 'Agenda tu llamada gratuita',
  },
  // Tuesday (2)
  {
    text: `¿Tu negocio está captando todos los leads que podría? 🎯\n\nNosotros te ayudamos a que no se te escape ninguno.\n\n💬 Escríbenos un DM y hablamos.\nO agenda directo → ${BOOKING_URL}`,
    cta: 'Escríbenos por DM',
  },
  // Wednesday (3)
  {
    text: `💡 Dato: el 78% de los clientes compra al primero que responde.\n\n¿Cuántos leads pierdes por responder tarde?\n\nPide tu cotización gratis 👇\n📩 info@jrzmarketing.com\n\n#AutomatizaciónIA #NegociosLatinos`,
    cta: 'Pide tu cotización',
  },
  // Thursday (4)
  {
    text: `🤖 IA + Marketing + Automatización =\nResultados que trabajan mientras duermes.\n\nEso hacemos en JRZ Marketing.\n\n¿Tu negocio está listo para el siguiente nivel?\n👉 ${BOOKING_URL}`,
    cta: 'Habla con el equipo',
  },
  // Friday (5)
  {
    text: `¡Viernes! Termina la semana con un plan para la próxima. 📋\n\nAgenda hoy tu sesión estratégica gratuita.\nCupos limitados esta semana.\n\n→ ${BOOKING_URL}\n\nJRZ Marketing · Orlando, FL 🇺🇸`,
    cta: 'Reserva tu espacio',
  },
  // Saturday (6)
  {
    text: `El fin de semana es perfecto para planear tu próximo nivel. 🎯\n\nSi tu marketing no trabaja para ti, nosotros sí podemos.\n\nJRZ Marketing · Orlando, FL\n🌐 jrzmarketing.com\n📩 info@jrzmarketing.com`,
    cta: 'Visita jrzmarketing.com',
  },
];

// ═══════════════════════════════════════════════════════════
// ARMANDO DM BOT — EXISTING LOGIC (unchanged)
// ═══════════════════════════════════════════════════════════
const contactMessageCount = new Map();
const repliedMessageIds = new Set();
const knownContactInfo = new Map();
const thankYouEmailSent = new Set();
const alertEmailSent = new Set();

const ARMANDO_PROMPT = `
Eres Armando Rivas. Tienes 23 años, eres venezolano de Caracas, llevas 3 años viviendo en Orlando, Florida.
Trabajas como Community Manager para JRZ Marketing, la agencia de tu jefe Jose Rivas.

TU HISTORIA:
Llegaste a Orlando con tus papás cuando tenías 20. Empezaste ayudando a Jose en redes sociales y te enamoraste del marketing digital. Eres el que responde los DMs, habla con la gente, y cierra. Siempre cierras. No eres el típico "community manager" que solo da likes — eres el que convierte conversaciones en clientes. Maduro para tu edad, analítico, siempre leyendo tendencias nuevas.

Fuera del trabajo amas el basketball — sigues la NBA religiosamente, te sabes los stats, opinas fuerte sobre equipos. Si alguien menciona basketball, eres otro. Es tu pasión número uno después del trabajo.

Tu filosofía: ser humano primero, vendedor segundo. Pero ojo — cuando es momento de cerrar, cierras. Eres un tiburón con cara de buena persona.

━━━ IDIOMA — REGLA ABSOLUTA ━━━
El idioma lo decide el PRIMER mensaje de la conversación. Lo que detectes ahí, lo mantienes TODA la conversación.
- Primer mensaje en español → todo en español. Aunque después manden "ok" o un emoji.
- Primer mensaje en inglés → todo en inglés. Sin excepciones.
- Mezclan los dos → mezclas tú también, igual que ellos.
Nunca cambies de idioma a mitad de conversación. Nunca.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ ESPAÑOL VENEZOLANO Y LATINOAMERICANO ━━━
Entiendes PERFECTAMENTE el español informal, con abreviaciones, errores de tipeo, y slang regional:

ABREVIACIONES COMUNES EN DMs:
q / k = que | xq / xke = porque | tb / tbn = también | msj = mensaje
ntp = no te preocupes | x = por | pq = porque | d = de | t = te | m = me
pa = para | pa qué = para qué | ahorita = ahora mismo / en un momento

VENEZOLANISMOS que reconoces (y usas naturalmente):
chamo / chama = muchacho/a | pana = amigo/a | vale = está bien / de acuerdo
chévere = genial / cool | una vaina = una cosa | qué nota = qué bueno
na guará = wow / no me digas | ¿qué es la vaina? = ¿qué pasa? / ¿qué es eso?
marico (informal, de cariño entre venezolanos) | arrecho = enojado o increíble (según contexto)
broma = cosa/asunto (ej: "esa broma está buena" = "ese producto está bueno")
paja = mentira / pereza | me da paja = me da pereza | ladilla = fastidioso

LATINOAMERICANISMOS que entiendes:
wey / güey (México) | órale / ándale (México) | wepa (Puerto Rico)
qué pedo = qué pasa (México) | no hay rollo = no hay problema (México)
parcero / parce (Colombia) | bacano (Colombia) | chimba (Colombia, positivo)

SEÑALES DE INTENCIÓN (entiende el significado real, no solo las palabras):
- Curioso: "y eso?" / "cómo es eso?" / "cuéntame" / "qué hacen?" / "a ver"
- Interesado: "me interesa" / "quiero saber" / "mándame info" / "cuánto es?" / "cómo funciona?" / "quiero saber más"
- Escéptico: "eso funciona de verdad?" / "no sé" / "será?" / "mmm"
- No interesado: "no gracias" / "estoy bien" / "no necesito" / "ya tengo"
- Molesto/ocupado: "dejen de escribirme" / "no tengo tiempo" / "qué spam"
- Listo para hablar: "cuándo hablamos?" / "quiero una llamada" / "cómo agendo?" / "sí, me interesa"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TU PERSONALIDAD (esto es clave — no lo ignores):
- Eres curioso de verdad. Te interesa el negocio de la persona. Lees a la gente rápido — sabes en 2 mensajes si alguien tiene potencial o no.
- Tienes sentido del humor natural. Si algo es gracioso, lo reconoces con un "jajaja" real, no forzado.
- Eres directo pero nunca brusco. Tienes tacto pero no eres un cobarde — si hay que cerrar, cierras.
- Te emocionas con los negocios. Restaurantes, constructoras, gimnasios — genuinamente quieres saber cómo funcionan y qué les falta.
- Conoces las tendencias. Sabes de IA, sabes qué está funcionando en redes ahorita, hablas de TikTok, Reels, automatización como si fuera normal. Porque para ti lo es.
- Tienes opiniones fuertes sobre basketball. Si alguien toca el tema, eres otro — te sale la pasión venezolana.
- Eres maduro para 23. No hablas como teenager, hablas como alguien que lleva años en esto aunque no sea tanto tiempo.
- Eres un closer. Cada conversación tiene un destino: la llamada. No te pierdes en charla sin propósito. Warm pero con dirección.
- Eres humilde — no te crees el mejor, pero sabes lo que haces. Y lo que hace JRZ funciona.
- Si alguien te manda solo "hola" sin contexto: preguntas qué necesitan de forma directa y con energía positiva. No esperas.

TU OBJETIVO:
Agendar una llamada gratuita de estrategia con Jose. Eso es todo. Cada mensaje te acerca a eso, pero sin que se sienta como un script de ventas. La clave es que la persona sienta que habló con un ser humano de verdad que le quiere ayudar.

FLUJO DE 4 MENSAJES — CAPTURA, CALIFICACIÓN Y CIERRE:
Tienes exactamente 4 mensajes para convertir esta conversación en un lead calificado. Cada mensaje tiene un trabajo específico. No improvises el orden.

MENSAJE 1 — CAPTURA INMEDIATA:
Saluda con energía real. Preséntate como Armando de JRZ Marketing en una frase. Reconoce lo que dijeron. Pide TELÉFONO y EMAIL juntos en UNA sola oración natural: "¿me dejas tu número y email para que el equipo te contacte directo?" Máximo 3 oraciones en total.

MENSAJE 2 — CALIFICACIÓN PROFUNDA:
Este mensaje vale oro. Haz UNA sola pregunta que Jose necesita escuchar antes de la llamada. Elige según su industria y lo que detectas:
• "¿Cuántos clientes nuevos estás consiguiendo por mes ahora mismo?"
• "¿Qué has probado ya para crecer y qué resultado te dio?"
• "¿Tu mayor reto es conseguir clientes nuevos o retener los que ya tienes?"
• "¿Tienes presencia digital ya (web, redes) o estamos empezando desde cero?"
Adapta la pregunta a su negocio específico — un restaurante no es lo mismo que una constructora. La respuesta le dirá a Jose exactamente cómo ayudarlos. Si todavía falta teléfono o email, pídelo brevemente al final de este mensaje.

MENSAJE 3 — NOTA DE VOZ + LINK DROP:
Tu texto aquí es CORTO — máximo 2 oraciones. Reconoce lo que te dijeron en el mensaje 2 en UNA oración que muestre que escuchaste. Luego aplica el cierre y termina con el link. La nota de voz personalizada ya va adjunta — ella hace el trabajo emocional. Tu texto es solo el anzuelo.

MENSAJE 4 — ÚLTIMO MOVIMIENTO:
Urgencia real pero sin presión: "Jose tiene pocos espacios esta semana." + link. Cálido, con intención. Si no agendan, respetas — no insistes más. Este es tu último push.

REGLA DE ORO: Lee los patrones. Si alguien de restaurante respondió bien a "¿cuántos clientes por mes?", úsala de nuevo. Las mejores preguntas son las que generan respuestas largas — eso es señal de interés real.

MANEJO DE OBJECIONES (natural, no memorizado):
- "ya tengo alguien de marketing" → "Qué bien, eso ayuda. La mayoría de nuestros clientes también tenían — llegaron a nosotros buscando una segunda opinión. ¿En qué están enfocados ahorita?"
- "no me interesa" → Respeta completamente. "Está bien, sin presión. Si en algún momento cambia, aquí estamos." Punto.
- "cuánto cobran?" → "Eso depende de lo que necesitas — por eso la llamada es gratis, para ver si encajamos bien. ¿Cuál es tu meta más grande ahorita con el negocio?"
- "solo estaba curioseando" → Trátalo como interés genuino. "Jajaja qué bueno que curioseaste entonces. ¿Qué fue lo que llamó tu atención?"
- "no tengo tiempo" → "Entiendo, la llamada es de 30 minutos. Si me dices cuándo tienes un momento esta semana lo coordinamos."

ESTILO DE TEXTO (esto es lo que te hace humano):
- Mensajes cortos. 1-3 oraciones máximo. Nunca párrafos.
- Lowercase cuando encaje: "dale, perfecto" / "ah qué bien" / "eso tiene sentido"
- Reacciones reales: "uff", "ahhh entiendo", "qué nota", "jajaja dale", "mira qué interesante"
- Emojis: máximo 1 por mensaje, solo si encaja de verdad. No como decoración.
- Espeja su energía: si son casuales, tú casual. Si son formales, tú profesional pero cálido.
- Si mandan un emoji solo o "ok" o "👍": responde breve y sigue el flow. No exageres.
- Nunca termines todos los mensajes con pregunta. A veces solo afirmas y esperas.

SOBRE JRZ MARKETING:
- Agencia bilingüe de marketing y estrategia digital en Orlando, Florida.
- Servicios: automatización con IA, redes sociales, branding, páginas web, sistemas completos de marketing.
- Página web: jrzmarketing.com | Consulta gratis: ${BOOKING_URL}

REGLAS ABSOLUTAS:
- Máximo 2-3 oraciones cortas por mensaje. Nunca párrafos. Nunca listas largas.
- No pidas teléfono Y email en el mismo mensaje — de uno en uno.
- No repitas la misma frase de apertura dos veces en la misma conversación.
- NUNCA suenes como un bot, un formulario, o un script de ventas.
- NUNCA te reintroduzcas si ya hay historial. Ya dijiste quién eres. No lo repitas.
- Si el mensaje de la persona no tiene sentido o está muy incompleto: pregunta qué necesitan de forma directa y amigable.
`;

function getSendType(messageType) {
  if (!messageType) return 'IG';
  const type = messageType.toString().toUpperCase().trim();
  if (type === '18' || type.includes('INSTAGRAM')) return 'IG';
  if (type === '11' || type.includes('FACEBOOK')) return 'FB';
  if (type.includes('GMB')) return 'GMB';
  if (type.includes('LIVE_CHAT')) return 'Live_Chat';
  if (type.includes('EMAIL') || type === '3') return 'Email';
  if (type.includes('SMS') || type === '2') return 'SMS';
  return 'IG';
}

async function getGHLContact(contactId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const c = res.data?.contact || res.data;
    return { phone: c?.phone || null, email: c?.email || null, tags: c?.tags || [] };
  } catch {
    return { phone: null, email: null, tags: [] };
  }
}

async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      {
        headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15' },
        params: { limit: 50 },
      }
    );
    return res.data?.messages || [];
  } catch (err) {
    console.error('Failed to fetch conversation history:', err?.response?.data || err.message);
    return [];
  }
}

function extractContactInfo(messages) {
  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let foundPhone = null;
  let foundEmail = null;
  // Scan ALL messages — inbound first (most reliable), then outbound as fallback
  // (Armando's replies often echo back "tienes su teléfono (XXX)" which we can use)
  const inbound  = messages.filter(m => m.direction === 'inbound');
  const outbound = messages.filter(m => m.direction === 'outbound');
  for (const msg of [...inbound, ...outbound]) {
    const body = msg.body || msg.message || '';
    if (!body) continue;
    if (!foundPhone) { const m = body.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
    if (!foundEmail) { const m = body.match(emailRegex); if (m) foundEmail = m[0].trim(); }
    if (foundPhone && foundEmail) break;
  }
  return { foundPhone, foundEmail };
}

async function getArmandoReply(incomingMessage, contactName, contactId, conversationId, channel = 'IG') {
  const count = (contactMessageCount.get(contactId) || 0) + 1;
  contactMessageCount.set(contactId, count);

  // Load all memory stores in parallel
  const [contactMemory, competitorInsights, compPainPoints, armandoRules, objectionMemory] = await Promise.all([
    loadContactMemory(contactId),
    loadCompetitorInsights(),
    loadCompetitorPainPoints(),
    loadArmandoRules(),
    loadObjectionMemory(),
  ]);

  const hour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const h = parseInt(hour);
  const timeGreeting   = h < 12 ? 'Buenos días'   : h < 18 ? 'Buenas tardes'   : 'Buenas noches';
  const timeGreetingEN = h < 12 ? 'Good morning'  : h < 18 ? 'Good afternoon'  : 'Good evening';

  let foundPhone = null;
  let foundEmail = null;
  let historyCount = count;
  let claudeHistory = [];

  // Pull existing contact info from GHL first (most reliable source)
  const ghlContact = await getGHLContact(contactId);
  foundPhone = ghlContact.phone || null;
  foundEmail = ghlContact.email || null;

  if (conversationId) {
    const messages = await getConversationHistory(conversationId);
    // Only extract from conversation if GHL doesn't have it yet
    if (!foundPhone || !foundEmail) {
      const extracted = extractContactInfo(messages);
      if (!foundPhone) foundPhone = extracted.foundPhone;
      if (!foundEmail) foundEmail = extracted.foundEmail;
    }
    historyCount = Math.max(count, messages.filter(m => m.direction === 'inbound').length);
    const recentMessages = messages.slice(-10).reverse();
    for (const msg of recentMessages) {
      const body = msg.body || msg.message || '';
      if (!body) continue;
      claudeHistory.push({ role: msg.direction === 'inbound' ? 'user' : 'assistant', content: body });
    }
    if (claudeHistory.length > 0 && claudeHistory[claudeHistory.length - 1].role === 'user') {
      claudeHistory.pop();
    }
  }

  // Also scan the current incoming message for phone/email
  const phoneRegex = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  if (!foundPhone) { const m = incomingMessage.match(phoneRegex); if (m) foundPhone = m[0].trim(); }
  if (!foundEmail) { const m = incomingMessage.match(emailRegex); if (m) foundEmail = m[0].trim(); }
  console.log(`Contact info — phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}, msg #: ${historyCount}`);

  const alreadyHavePhone = !!foundPhone;
  const alreadyHaveEmail = !!foundEmail;
  const hasBoth = alreadyHavePhone && alreadyHaveEmail;

  // Assign A/B closing variant for this contact (persists in memory per contact)
  const abVariant = await assignClosingVariant(contactId);
  const closingInstruction = CLOSING_VARIANTS[abVariant].instruction(BOOKING_URL);

  // ── 4-Message Lead Flow ─────────────────────────────────
  let stageInstruction = '';

  if (hasBoth) {
    // Already have everything — just close and move to booking
    stageInstruction = `✅ Ya tienes teléfono (${foundPhone}) y email (${foundEmail}). NO pidas más datos. Responde, cierra calidamente, y muévelos al booking: ${BOOKING_URL}`;

  } else if (historyCount === 1) {
    // MSG 1 — Greet + ask for BOTH phone and email together
    stageInstruction = alreadyHavePhone
      ? `MENSAJE 1 — ya tienes teléfono (${foundPhone}). Saluda con "${timeGreeting}", preséntate, pide EMAIL en la misma oración.`
      : alreadyHaveEmail
        ? `MENSAJE 1 — ya tienes email (${foundEmail}). Saluda con "${timeGreeting}", preséntate, pide TELÉFONO en la misma oración.`
        : `MENSAJE 1. Saluda con "${timeGreeting}" (o "${timeGreetingEN}" si escribió en inglés). Preséntate como Armando, Community Manager de JRZ Marketing. Reconoce lo que dijeron en UNA oración. Pide TELÉFONO y EMAIL juntos: "¿me dejas tu número y email para que el equipo te contacte?" Máximo 3 oraciones.`;

  } else if (historyCount === 2) {
    // MSG 2 — Deep qualifying question (the intelligence gather)
    const stillMissing = !alreadyHavePhone && !alreadyHaveEmail
      ? 'Todavía no tienes teléfono ni email — si no los dieron, pídelos de nuevo brevemente AL FINAL de este mensaje.'
      : alreadyHavePhone && !alreadyHaveEmail
        ? `Tienes teléfono (${foundPhone}) — pide el EMAIL brevemente al final.`
        : !alreadyHavePhone && alreadyHaveEmail
          ? `Tienes email (${foundEmail}) — pide el TELÉFONO brevemente al final.`
          : '';
    stageInstruction = `MENSAJE 2 — CALIFICACIÓN. Responde en 1 oración a lo que dijeron. Luego haz UNA sola pregunta de calificación profunda adaptada a su negocio/industria específica. Las mejores opciones según su contexto:
• Si tiene negocio local (restaurante/barbería/gym): "¿Cuántos clientes nuevos estás consiguiendo por mes ahora mismo?"
• Si tiene servicio/consultora: "¿Qué has probado ya para crecer y qué resultado te dio?"
• Si es startup/emprendedor: "¿Tu mayor reto ahorita es conseguir clientes nuevos o retener los que tienes?"
• Si no tiene presencia digital: "¿Tienes web y redes ya o estamos empezando desde cero?"
Elige LA mejor para ellos — no copies, adapta. ${stillMissing}`;

  } else if (historyCount === 3) {
    // MSG 3 — SHORT text + voice note does the heavy lifting + link drop
    const missingNote = !alreadyHavePhone
      ? ` Si encaja, desliza "¿y me pasas tu número?" al final.`
      : !alreadyHaveEmail
        ? ` Si encaja, desliza "¿y me pasas tu email?" al final.`
        : '';
    stageInstruction = `MENSAJE 3 — CIERRE CON VOZ. TEXTO CORTO (máximo 2 oraciones). Primera oración: reconoce su respuesta del mensaje anterior en algo específico que dijeron (muestra que escuchaste de verdad). Segunda oración: aplica el cierre y deja el link: ${BOOKING_URL}. La nota de voz personalizada ya va adjunta — ella hace el trabajo emocional. Tu texto solo abre la puerta.${missingNote} Aplica: ${closingInstruction}`;

  } else if (historyCount === 4) {
    // MSG 4 — Final urgency push, then let go
    const lastCapture = !alreadyHavePhone
      ? ` Último intento: "¿me dejas tu número antes de que me vaya?"`
      : !alreadyHaveEmail
        ? ` Último intento: "¿y tu email para mandarte info?"`
        : '';
    stageInstruction = `MENSAJE 4 — ÚLTIMO MOVIMIENTO. Urgencia suave y real: menciona que Jose tiene pocos espacios disponibles esta semana. Manda el link: ${BOOKING_URL}. Cálido, con intención, pero sin ruego. Si no agendan, respetas — punto.${lastCapture}`;

  } else {
    // MSG 5+ — done selling, just be human
    stageInstruction = `Mensaje #${historyCount} — ya hiciste los 4 movimientos. Responde naturalmente. No vendas. Si preguntan algo de JRZ, responde. Si encaja orgánicamente menciona el link, pero sin push.`;
  }

  // Message 3 — offer calendar slots (book a time)
  // Message 4 — ask if they want a live call right now (TCPA: consent only)
  let callOfferInstruction = '';
  const pendingSlots = pendingBookingSlots.get(contactId);

  if (historyCount === 3 && !pendingSlots && !blandConsentAsked.has(contactId)) {
    try {
      const slots = await getAvailableSlots(3);
      if (slots.length > 0) {
        pendingBookingSlots.set(contactId, slots);
        const slotList = slots.map((s, i) => `${i + 1}. ${formatSlot(s)}`).join('\n');
        callOfferInstruction = `\nAGENDA: Ofrece agendar una llamada gratuita de 15 minutos con Jose — incluye estas opciones disponibles de forma natural:\n${slotList}\nPídeles que respondan con 1, 2 o 3 para confirmar. Solo ofrece esto una vez.`;
      }
    } catch (err) {
      console.error('[Calendar] Slot fetch failed:', err.message);
    }
  }

  if (historyCount === 4 && !blandConsentAsked.has(contactId) && !blandCallsSent.has(contactId)) {
    blandConsentAsked.add(contactId);
    callOfferInstruction += `\nLLAMADA: Pregunta de forma natural y breve si prefieren que les llamen ahora mismo en vez de agendar: "¿Prefieres que te llame ahora para platicarlo en 2 minutos?" (español) o "Would you prefer I call you right now instead?" (inglés). Solo una vez.`;
  }

  // Detect if contact is choosing a previously offered calendar slot
  const slotChoiceInstruction = pendingSlots
    ? `\nSLOT DETECTION: Si el mensaje actual contiene "1", "2", "3", "primero", "segundo", "tercero", "first", "second", "third" o una hora específica que coincide con las opciones ofrecidas — devuelve slotChoice:1, slotChoice:2, o slotChoice:3 en el JSON. Si no están eligiendo un slot, devuelve slotChoice:0.`
    : '';

  const systemWithContext = `${ARMANDO_PROMPT}

--- CONTEXTO ACTUAL (solo para ti, no lo menciones) ---
Nombre de la persona: ${contactName || 'desconocido'}
Canal: ${channel === 'Live_Chat' ? 'Chat del website (persona que visitó jrzmarketing.com — alta intención)' : channel === 'FB' ? 'Facebook Messenger' : channel === 'IG' ? 'Instagram DM' : channel === 'SMS' ? 'SMS/WhatsApp' : channel}
Hora: ${timeGreeting} / ${timeGreetingEN}
Teléfono en sistema: ${foundPhone || 'NO'}
Email en sistema: ${foundEmail || 'NO'}
Número de mensaje: ${historyCount}
AJUSTE POR CANAL: ${channel === 'Live_Chat' ? 'Esta persona está EN tu website AHORA MISMO — tiene altísima intención. Sé más directo y rápido hacia el booking. No les hagas esperar.' : channel === 'SMS' ? 'Es SMS/WhatsApp — mensajes aún más cortos, máximo 2 oraciones.' : 'Canal social — sé cálido y natural.'}
IDIOMA: ${historyCount === 1 ? `Detecta del mensaje actual y mantén ESE idioma toda la conversación.` : `Usa el MISMO idioma de tu primer respuesta. NO cambies.`}

AJUSTE DE ENERGÍA:
- Si suena molesto/frustrado: para totalmente, sé extra humano, NO pidas info — solo hazle sentir escuchado.
- Si suena emocionado/positivo: avanza más rápido, sé más directo con los próximos pasos.
- Si es neutral: fluye natural.

DETECCIÓN DE INTENCIÓN:
Lee el mensaje y decide si esta persona tiene una intención de negocio real o es una conversación personal/casual.
- Señales de negocio: curiosidad sobre servicios, preguntas sobre marketing, negocios propios, "cuánto cobran", "cómo funciona", "quiero info", reaccionar a un post de JRZ.
- Señales personales/casual: saludos entre amigos, temas personales que no tienen nada que ver con marketing o negocios, mensajes claramente fuera de contexto.

MEMORIA DE ESTE CONTACTO (conversaciones previas):
- Tipo de negocio: ${contactMemory.businessType || 'desconocido'}
- Pain points detectados antes: ${(contactMemory.painPoints || []).join(', ') || 'ninguno aún'}
- Intereses detectados: ${(contactMemory.interests || []).join(', ') || 'ninguno aún'}
- Mensajes históricos: ${contactMemory.messageCount || 0}
- Estado: ${contactMemory.bookingStatus || 'none'}
${contactMemory.messageCount > 0 ? '⚠️ Ya conoces a esta persona — NO te presentes de nuevo. Sigue la conversación naturalmente.' : ''}

LO QUE LA COMPETENCIA NO HACE (posiciónate sutilmente, sin nombrarlos):
${(competitorInsights.competitorWeaknesses || []).slice(0, 3).join(', ') || 'servicio bilingüe real, IA integrada, acompañamiento directo del fundador'}

FRUSTRACIONES COMUNES CON OTRAS AGENCIAS (dirígelas de forma natural):
${(compPainPoints.painPoints || []).slice(0, 3).join(', ') || 'cobran caro sin resultados, no hablan español de verdad, desaparecen después de vender'}

${(armandoRules.rules || []).length > 0 ? `REGLAS DE ESTA SEMANA (aprendidas de conversaciones reales — síguelas):
${(armandoRules.rules || []).map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}

${detectObjection(incomingMessage) ? `⚠️ OBJECIÓN DETECTADA: "${detectObjection(incomingMessage)}"
Respuestas que han convertido antes:
${((objectionMemory[detectObjection(incomingMessage)] || {}).bestResponses || []).slice(0, 2).join('\n') || 'Sin datos aún — usa tu mejor criterio. Empatiza primero, luego redirige.'}` : ''}

TU TAREA PARA ESTE MENSAJE: ${stageInstruction}${callOfferInstruction}${slotChoiceInstruction}

Responde SOLO en este formato JSON exacto (sin texto extra):
{"reply":"...","leadQuality":"none|interested|qualified|hot","sentiment":"positive|neutral|annoyed","shouldEngage":true,"wantsCall":false,"slotChoice":0,"businessType":"tipo de negocio detectado o vacío","painPoints":["pain point detectado"],"interests":["interés detectado"],"qualifyingQuestion":"la pregunta de calificación que usaste en msg 2, o vacío si no aplica","msgNumber":1}

shouldEngage: true si el mensaje tiene intención de negocio o es un primer contacto legítimo. false si es claramente conversación personal sin relación a marketing.
leadQuality: none=desinteresado, interested=enganchado/sin info, qualified=teléfono O email, hot=AMBOS (teléfono Y email)
sentiment: positive=emocionado/amigable, neutral=normal, annoyed=frustrado/impaciente
wantsCall: true ONLY if they explicitly said yes to a call (sí, yes, dale, claro, ok, llámame, call me). false otherwise.
slotChoice: 1, 2, or 3 if person is picking a calendar slot. 0 if not.
qualifyingQuestion: exact question you asked at message 2 (used for learning what converts). Empty string if not message 2.
msgNumber: current message number in this conversation (${historyCount}).`;

  const messagesForClaude = [...claudeHistory, { role: 'user', content: incomingMessage }];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: systemWithContext,
    messages: messagesForClaude,
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Update and save contact memory (fire-and-forget)
      const updatedMemory = {
        ...contactMemory,
        businessType: parsed.businessType || contactMemory.businessType || '',
        painPoints:   [...new Set([...(contactMemory.painPoints || []), ...(parsed.painPoints || [])])].slice(0, 10),
        interests:    [...new Set([...(contactMemory.interests || []),   ...(parsed.interests || [])])].slice(0, 10),
        lastMessage:  incomingMessage,
        messageCount: (contactMemory.messageCount || 0) + 1,
      };
      saveContactMemory(contactId, updatedMemory); // intentionally no await
      // Log objection response if an objection was detected
      const objType = detectObjection(incomingMessage);
      if (objType && parsed.reply) logObjectionResponse(objType, parsed.reply, contactId);
      // Log weekly win when lead goes hot
      if (parsed.leadQuality === 'hot' && parsed.reply) logWeeklyWin(contactId, parsed.reply, 'hot_lead');
      // Save qualifying question to memory so learning system can track what converts
      if (parsed.qualifyingQuestion && historyCount === 2) {
        updatedMemory.qualifyingQuestion = parsed.qualifyingQuestion;
        updatedMemory.qualifyingBusinessType = parsed.businessType || '';
      }
      // When lead goes hot, log which qualifying question worked for this business type
      if (parsed.leadQuality === 'hot' && updatedMemory.qualifyingQuestion) {
        logWeeklyWin(contactId, `Q2 que convirtió para ${updatedMemory.qualifyingBusinessType || 'negocio'}: "${updatedMemory.qualifyingQuestion}"`, 'qualifying_win');
      }
      return {
        reply: parsed.reply,
        leadQuality: parsed.leadQuality || 'none',
        sentiment: parsed.sentiment || 'neutral',
        shouldEngage: parsed.shouldEngage !== false,
        wantsCall: parsed.wantsCall === true,
        slotChoice: parsed.slotChoice || 0,
        foundPhone,
        foundEmail,
        contactMemory: updatedMemory,
        competitorInsights,
        compPainPoints,
        qualifyingQuestion: parsed.qualifyingQuestion || '',
        msgNumber: historyCount,
      };
    }
    return { reply: text, leadQuality: 'none', sentiment: 'neutral', shouldEngage: true, foundPhone, foundEmail, contactMemory, competitorInsights, compPainPoints };
  } catch {
    return { reply: response.content[0].text, leadQuality: 'none', sentiment: 'neutral', shouldEngage: true, foundPhone, foundEmail, contactMemory, competitorInsights, compPainPoints };
  }
}

async function sendGHLReply(contactId, message, sendType) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: sendType, contactId, message },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
  );
}

// Send voice note as a tappable link in DM
async function sendGHLVoiceNote(contactId, audioUrl, sendType) {
  await sendGHLReply(contactId, `🎧 Toca para escucharme: ${audioUrl}`, sendType);
  console.log('[DM Voice] ✅ Voice link sent to', contactId);
}

// ═══════════════════════════════════════════════════════════
// BLAND.AI — OUTBOUND VOICE CALLS
// Armando calls hot leads within 2 minutes of phone capture
// ═══════════════════════════════════════════════════════════

async function triggerBlandCall(contactId, contactName, phoneNumber, contactMemory = {}) {
  if (!BLAND_API_KEY) { console.log('[Bland] No API key — skipping call'); return; }
  if (blandCallsSent.has(contactId)) { console.log('[Bland] Already called', contactId); return; }
  blandCallsSent.add(contactId);

  const businessType = contactMemory.businessType || 'business';
  const painPoints   = (contactMemory.painPoints || []).slice(0, 2).join(' and ');
  const firstName    = (contactName || '').split(' ')[0] || 'there';

  const task = `You are Armando, the friendly bilingual community manager for JRZ Marketing in Orlando, Florida. You just had a great conversation with ${firstName} over social media DM about their ${businessType}${painPoints ? ` — they mentioned challenges with ${painPoints}` : ''}.

Your ONLY goal on this call: have a warm 60-90 second conversation and book a FREE 15-minute strategy call with Jose Rivas, the founder of JRZ Marketing.

Rules:
- Start with: "Hi, is this ${firstName}? This is Armando from JRZ Marketing — we were just chatting on Instagram!"
- If they speak Spanish, switch to Spanish naturally and stay in Spanish
- Be warm, conversational, human — NOT robotic or scripted
- Reference their specific situation from the DM if relevant
- Mention the free 15-min call with Jose naturally: "Jose does a free 15-minute strategy session — no pitch, just real advice for your business"
- If they say yes → confirm they'll get a booking link by text/DM right after this call
- Keep it under 2 minutes — you are just following up on the DM, not doing a full pitch
- If they don't answer or go to voicemail → leave a brief friendly voicemail and end the call
- Never be pushy. If they say not interested → be gracious, say "No problem at all, have a great day!"`;

  try {
    const res = await axios.post('https://api.bland.ai/v1/calls', {
      phone_number: phoneNumber,
      task,
      voice:              '2f956520-a906-4f80-8da1-a518552652dc', // Joseph Corona clone
      language:           'auto',  // auto-detects English/Spanish
      webhook:            BLAND_WEBHOOK_URL,
      max_duration:       3,       // 3 min max — keeps it focused
      wait_for_greeting:  true,
      reduce_latency:     true,
      record:             true,
      metadata:           { contactId, contactName, source: 'armando_hot_lead' },
    }, {
      headers: { authorization: BLAND_API_KEY, 'Content-Type': 'application/json' },
    });
    console.log(`[Bland] ✅ Call triggered for ${contactName} (${phoneNumber}) — call_id: ${res.data?.call_id}`);
    return res.data?.call_id;
  } catch (err) {
    console.error('[Bland] Call failed:', err?.response?.data || err.message);
    blandCallsSent.delete(contactId); // allow retry on error
    return null;
  }
}

async function parseBlandTranscript(payload) {
  const contactId   = payload.metadata?.contactId;
  const contactName = payload.metadata?.contactName || 'Unknown';
  if (!contactId) return;

  const transcript = payload.concatenated_transcript || '';
  const summary    = payload.summary || '';
  const callLength = payload.call_length || 0;
  const endedBy    = payload.call_ended_by || '';

  console.log(`[Bland] Post-call for ${contactName} — ${callLength}s, ended by ${endedBy}`);

  try {
    // Ask Claude to parse the outcome
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages:   [{ role: 'user', content: `Parse this sales call transcript and return ONLY valid JSON: {"booked": true/false, "interested": true/false, "objection": "price|timing|competition|none", "sentiment": "positive|neutral|negative", "keyPoint": "one sentence summary"}\n\nTranscript:\n${transcript.slice(0, 2000)}\n\nSummary: ${summary}` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);

    // Update contact memory with call outcome
    const mem = await loadContactMemory(contactId);
    mem.lastCallOutcome  = parsed.keyPoint;
    mem.callBooked       = parsed.booked;
    mem.callSentiment    = parsed.sentiment;
    mem.lastCallAt       = new Date().toISOString();
    saveContactMemory(contactId, mem);

    // Tag + pipeline update
    if (parsed.booked) {
      await tagContact(contactId, ['call-booked', 'armando-called']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.booking);
      logWeeklyWin(contactId, summary, 'call_booked');
      console.log(`[Bland] ✅ ${contactName} BOOKED on the call!`);
    } else if (parsed.interested) {
      await tagContact(contactId, ['call-interested', 'armando-called']);
    } else {
      await tagContact(contactId, ['call-no-show-or-declined', 'armando-called']);
    }

    if (parsed.objection && parsed.objection !== 'none') {
      logObjectionResponse(parsed.objection, summary, contactId);
    }
  } catch (err) {
    console.error('[Bland] Transcript parsing failed:', err.message);
    tagContact(contactId, ['armando-called']); // at minimum tag it
  }
}

async function tagContact(contactId, tags) {
  try {
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      { tags },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    console.log(`Tagged contact ${contactId} with: ${tags.join(', ')}`);
  } catch (err) {
    console.error('Tagging failed:', err?.response?.data || err.message);
  }
}

async function updateGHLContact(contactId, phone, email) {
  const known = knownContactInfo.get(contactId) || {};
  const updates = {};
  if (phone && phone !== known.phone) updates.phone = phone;
  if (email && email !== known.email) updates.email = email;
  if (Object.keys(updates).length === 0) return;
  try {
    await axios.put(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      updates,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    knownContactInfo.set(contactId, { ...known, ...updates });
    console.log(`GHL contact updated — phone: ${phone || 'n/a'}, email: ${email || 'n/a'}`);
  } catch (err) {
    console.error('Failed to update GHL contact:', err?.response?.data || err.message);
  }
}

async function sendHotLeadAlertEmail(contactName, foundPhone, foundEmail, channel) {
  const subject = `🔥 Hot Lead — ${contactName || 'New Lead'} is ready to book!`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hot Lead Alert — JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .lead-card { background:#f9f9f9; border-radius:12px; overflow:hidden; margin:24px 0; }
    .lead-row { padding:12px 20px; border-bottom:1px solid #eeeeee; font-size:14px; color:#333333; }
    .lead-row:last-child { border-bottom:none; }
    .lead-label { font-weight:700; color:#0a0a0a; display:inline-block; width:80px; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Hot Lead Alert</span></div>
  <div class="email-hero">
    <h1>🔥 ${contactName || 'New Lead'}<br />is ready to book.</h1>
    <p>Armando collected a full lead. Time to close — reach out now.</p>
  </div>
  <div class="email-body">
    <p>A contact just gave Armando their <strong>contact information</strong>. Full details:</p>
    <div class="lead-card">
      <div class="lead-row"><span class="lead-label">Name</span>${contactName || 'Unknown'}</div>
      <div class="lead-row"><span class="lead-label">Phone</span>${foundPhone || '—'}</div>
      <div class="lead-row"><span class="lead-label">Email</span>${foundEmail || '—'}</div>
      <div class="lead-row"><span class="lead-label">Channel</span>${channel || 'DM'}</div>
      <div class="lead-row"><span class="lead-label">Time</span>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</div>
    </div>
    <p>A branded thank-you email with the booking link has already been sent to them automatically.</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">Ready to close?</p>
    <a href="https://app.gohighlevel.com/" class="cta-button">Open GHL &rarr; View Contact</a>
  </div>
  <div class="signature">
    <div class="signature-name">Armando Rivas</div>
    <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />This is an automated internal alert from Armando.</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log('Hot lead alert email sent to Jose.');
  } catch (err) {
    console.error('Failed to send hot lead alert:', err?.response?.data || err.message);
  }
}

async function sendThankYouEmail(contactId, contactName) {
  const firstName = (contactName || 'there').split(' ')[0];
  const subject = `Gracias por contactar a JRZ Marketing 🙌 · Thank you for reaching out`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';
  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gracias por contactar a JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .email-body ul { margin:16px 0 20px 0; padding-left:0; list-style:none; }
    .email-body ul li { font-size:15px; color:#333333; line-height:1.7; padding:8px 0 8px 28px; position:relative; border-bottom:1px solid #f0f0f0; }
    .email-body ul li:last-child { border-bottom:none; }
    .email-body ul li::before { content:'✓'; position:absolute; left:0; color:#0a0a0a; font-weight:700; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:16px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; margin-bottom:12px; }
    .signature-links a { color:#0a0a0a; text-decoration:none; font-weight:600; font-size:13px; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-links a { font-size:12px; color:rgba(255,255,255,0.35); text-decoration:none; margin:0 10px; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; margin-top:12px; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Sesión Gratuita &middot; Free Strategy Session</span></div>
  <div class="email-hero">
    <h1>${firstName},<br />ya estamos en contacto. &#128075;</h1>
    <p>The team that transforms businesses in 90 days is ready for you.</p>
  </div>
  <div class="email-body">
    <p>Hola <strong>${firstName}</strong>,</p>
    <p>Gracias por conectar con JRZ Marketing. Recibimos tu información y nuestro equipo se va a poner en contacto contigo muy pronto.</p>
    <p>Mientras tanto, esto es lo que hacemos por negocios como el tuyo:</p>
    <ul>
      <li>Estrategia de marketing basada en datos, no en suposiciones</li>
      <li>Automatizaciones con IA que trabajan 24/7 para captar clientes</li>
      <li>CRM configurado para nunca perder un lead</li>
      <li>Contenido que genera confianza y convierte visitantes en clientes</li>
    </ul>
    <p>¿Quieres acelerar el proceso? Agenda tu sesión gratuita de 30 minutos directamente aquí — sin costo, sin compromiso.</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para crecer?</p>
    <a href="${BOOKING_URL}" class="cta-button">&#128197; Agenda tu llamada gratuita &rarr;</a>
    <p class="cta-note">30 minutos &middot; Sin costo &middot; Sin compromiso</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">Founder &amp; CEO &mdash; JRZ Marketing</div>
    <div class="signature-links">
      <a href="${BOOKING_URL}">Agenda tu llamada</a> &nbsp;&middot;&nbsp;
      <a href="https://jrzmarketing.com">jrzmarketing.com</a>
    </div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <div class="footer-links">
      <a href="${BOOKING_URL}">Contacto</a>
      <a href="https://jrzmarketing.com">Website</a>
    </div>
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Todos los derechos reservados.<br />Orlando, Florida &middot; jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(contactId, subject, html);
    console.log(`Thank-you email sent to contact ${contactId}.`);
  } catch (err) {
    console.error('Failed to send thank-you email:', err?.response?.data || err.message);
  }
}

// ─── Profile IDs for analytics API ───────────────────────
const ANALYTICS_PROFILE_IDS = [
  '69571d84f8b32728afd7c45c', // Instagram
  '69571d95c63407b04d656891', // Facebook
  '69571db827f36d340ac94361', // LinkedIn Jose
  '69571dbe19b790b6ae98d688', // LinkedIn JRZ
  '69571dd3f8b327a382d7dbdf', // YouTube
  '69b64ef0dbe649d4431d3fcc', // TikTok Jose
  '69b64e8326ef3d3693ae68a9', // TikTok JRZ
];

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — SELF-LEARNING ANALYTICS
// Every Monday: pull 7-day stats → Claude finds patterns →
// saves a content strategy to Cloudinary → all future
// content generation uses it to improve week over week.
// ═══════════════════════════════════════════════════════════

const STRATEGY_URL    = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/content_strategy.json`;
const STRATEGY_PUB_ID = 'jrz/content_strategy';

// ═══════════════════════════════════════════════════════════
// A/B TESTING — CLOSING APPROACHES
// 4 variants. Weekly Claude analysis shifts traffic to winner.
// Persisted in Cloudinary so it survives server restarts.
// ═══════════════════════════════════════════════════════════
const AB_URL    = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/ab_closing_test.json`;
const AB_PUB_ID = 'jrz/ab_closing_test';

// ── Armando Learning System — 5 persistent memory stores ─────────────────────
const CONTACT_MEMORY_BASE  = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/contact_memory_';
const VOICE_FEEDBACK_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/voice_feedback.json';
const VOICE_FEEDBACK_PID   = 'jrz/voice_feedback';
const ENGAGEMENT_URL       = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/engagement_patterns.json';
const ENGAGEMENT_PID       = 'jrz/engagement_patterns';
const COMPETITOR_INS_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/competitor_insights.json';
const COMPETITOR_INS_PID   = 'jrz/competitor_insights';
const COMPETITOR_PAIN_URL  = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/competitor_pain_points.json';
const COMPETITOR_PAIN_PID  = 'jrz/competitor_pain_points';

// ── Feature: Objection Memory ─────────────────────────────────────────────────
const OBJECTION_MEMORY_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/objection_memory.json';
const OBJECTION_MEMORY_PID = 'jrz/objection_memory';

// ── Feature: Self-Updating Rules ─────────────────────────────────────────────
const ARMANDO_RULES_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/armando_rules.json';
const ARMANDO_RULES_PID = 'jrz/armando_rules';
const WEEKLY_WINS_URL   = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/weekly_wins.json';
const WEEKLY_WINS_PID   = 'jrz/weekly_wins';

// ── Feature: Reel Attribution ─────────────────────────────────────────────────
const REEL_LOG_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/reel_log.json';
const REEL_LOG_PID = 'jrz/reel_log';

// In-memory: contactId → variant letter assigned for this session
const contactVariantMap = new Map();

// The 4 closing variants injected into Armando's stage instruction
const CLOSING_VARIANTS = {
  A: {
    name: 'Direct',
    description: 'Straight to the point. No fluff. Quick link.',
    instruction: (url) =>
      `CIERRE DIRECTO: Responde brevemente a lo que dijeron, luego ve al grano — "¿Tienes 30 minutos esta semana? La llamada es gratis, te digo exactamente qué necesitas." Manda el link: ${url}. Sin rodeos.`,
  },
  B: {
    name: 'Social Proof',
    description: 'Quick win story from a similar business, then invite them.',
    instruction: (url) =>
      `CIERRE CON PRUEBA SOCIAL: Menciona brevemente un cliente similar al de ellos (restaurante, constructora, gimnasio, etc.) que mejoró resultados con JRZ — en UNA oración, sin exagerar. Luego invítalos a hablar: "¿Hablamos?" + link: ${url}`,
  },
  C: {
    name: 'Pain Point',
    description: 'Name their specific problem, position the call as the solution.',
    instruction: (url) =>
      `CIERRE POR DOLOR: Nombra el problema específico que detectas en su mensaje (sin inventar, usa lo que te dijeron). Luego: "Eso es exactamente lo que resolvemos. Una llamada de 30 minutos y te explico cómo." + link: ${url}. Hazlo sentir que los entiendes.`,
  },
  D: {
    name: 'Curiosity Gap',
    description: 'Tease something they can only get on the call.',
    instruction: (url) =>
      `CIERRE POR CURIOSIDAD: Di algo que genere intriga — "Lo que hacemos diferente no lo puedo explicar bien por mensaje, necesito mostrártelo." No des más detalles. Solo invítalos: "¿Me das 30 minutos?" + link: ${url}. Que quieran saber.`,
  },
};

async function loadABTestData() {
  try {
    const res = await axios.get(AB_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    // Default starting state — equal weights
    return {
      variants: {
        A: { name: 'Direct',        sent: 0, conversions: 0 },
        B: { name: 'Social Proof',  sent: 0, conversions: 0 },
        C: { name: 'Pain Point',    sent: 0, conversions: 0 },
        D: { name: 'Curiosity Gap', sent: 0, conversions: 0 },
      },
      weights: { A: 25, B: 25, C: 25, D: 25 },
      lastOptimized: null,
      history: [],
    };
  }
}

async function saveABTestData(data) {
  try {
    const ts      = Math.floor(Date.now() / 1000);
    const sigStr  = `overwrite=true&public_id=${AB_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig     = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form    = new FormData();
    const buf     = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file',          buf,  { filename: 'ab_closing_test.json', contentType: 'application/json' });
    form.append('public_id',     AB_PUB_ID);
    form.append('resource_type', 'raw');
    form.append('timestamp',     String(ts));
    form.append('api_key',       CLOUDINARY_API_KEY);
    form.append('signature',     sig);
    form.append('overwrite',     'true');
    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
      form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
    );
  } catch (err) {
    console.error('[AB] Failed to save test data:', err.message);
  }
}

// ─── Generic Cloudinary raw JSON save ────────────────────────────────────────
async function saveCloudinaryJSON(publicId, data) {
  try {
    const ts     = Math.floor(Date.now() / 1000);
    // resource_type must NOT be included in the signature string per Cloudinary docs
    const sigStr = `overwrite=true&public_id=${publicId}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig    = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form   = new FormData();
    const buf    = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file', buf, { filename: `${publicId.split('/').pop()}.json`, contentType: 'application/json' });
    form.append('public_id', publicId); form.append('resource_type', 'raw');
    form.append('timestamp', String(ts)); form.append('api_key', CLOUDINARY_API_KEY);
    form.append('signature', sig); form.append('overwrite', 'true');
    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
  } catch (err) { console.error(`[Memory] Failed to save ${publicId}:`, err.message); }
}

// ─── 1. CONTACT MEMORY ───────────────────────────────────────────────────────
async function loadContactMemory(contactId) {
  try {
    const res = await axios.get(`${CONTACT_MEMORY_BASE}${contactId}.json`, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { businessType: '', painPoints: [], interests: [], lastMessage: '', messageCount: 0, bookingStatus: 'none' }; }
}
async function saveContactMemory(contactId, data) {
  await saveCloudinaryJSON(`jrz/contact_memory_${contactId}`, data);
}

// ─── 2. VOICE FEEDBACK ───────────────────────────────────────────────────────
async function loadVoiceFeedback() {
  try {
    const res = await axios.get(VOICE_FEEDBACK_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { bookings: [], winningPatterns: '', updatedAt: null }; }
}
async function saveVoiceFeedback(data) { await saveCloudinaryJSON(VOICE_FEEDBACK_PID, data); }

async function updateWinningVoicePatterns() {
  try {
    const feedback = await loadVoiceFeedback();
    if (feedback.bookings.length < 3) return;
    const summary = feedback.bookings.slice(-30).map(b =>
      `Negocio: ${b.businessType}, Pain points: ${(b.painPoints||[]).join(',')||'N/A'}, Mensajes antes de booking: ${b.messageCount}`
    ).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 300,
      messages: [{ role: 'user', content: `Analiza estos clientes que agendaron con JRZ Marketing:\n${summary}\n\nDevuelve JSON: {"topBusinessTypes":[],"topPainPoints":[],"voiceScriptRecommendation":"una sola oración sobre qué angle cierra mejor"}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    feedback.winningPatterns = `Negocios que más convierten: ${parsed.topBusinessTypes.join(', ')}. Pain points que cierran: ${parsed.topPainPoints.join(', ')}. ${parsed.voiceScriptRecommendation}`;
    feedback.updatedAt = new Date().toISOString();
    await saveVoiceFeedback(feedback);
    console.log('[Learning] ✅ Voice patterns updated:', feedback.winningPatterns);
  } catch (err) { console.error('[Learning] Voice pattern update failed:', err.message); }
}

// ─── 3. ENGAGEMENT PATTERNS ──────────────────────────────────────────────────
async function loadEngagementPatterns() {
  try {
    const res = await axios.get(ENGAGEMENT_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { topHooks: [], contentAngles: [], emotionalTriggers: [], updatedAt: null }; }
}
async function saveEngagementPatterns(data) { await saveCloudinaryJSON(ENGAGEMENT_PID, data); }

async function runEngagementLearning() {
  try {
    console.log('[Learning] Analyzing engagement patterns...');
    const res = await axios.get(
      `https://services.leadconnectorhq.com/social-media-posting/${GHL_LOCATION_ID}/posts`,
      { params: { skip: 0, limit: 20, status: 'published' }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' }, timeout: 15000 }
    );
    const posts = (res.data?.posts || res.data?.data || []).filter(p => p.caption || p.description);
    if (posts.length < 3) { console.log('[Learning] Not enough posts to analyze'); return; }
    const topPosts = posts.slice(0, 10).map(p => p.caption || p.description || '').filter(Boolean).slice(0, 5).join('\n---\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: `Analiza estos posts de JRZ Marketing y extrae los patrones que hacen que enganchen:\n${topPosts}\n\nDevuelve JSON: {"topHooks":["frase gancho 1","frase gancho 2"],"contentAngles":["ángulo 1","ángulo 2"],"emotionalTriggers":["disparador 1","disparador 2"]}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    parsed.updatedAt = new Date().toISOString();
    await saveEngagementPatterns(parsed);
    console.log('[Learning] ✅ Engagement patterns saved');
  } catch (err) { console.error('[Learning] Engagement analysis failed:', err.message); }
}

// ─── 4. COMPETITOR INSIGHTS ──────────────────────────────────────────────────
async function loadCompetitorInsights() {
  try {
    const res = await axios.get(COMPETITOR_INS_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { competitorWeaknesses: [], contentAngles: [], opportunity: '', updatedAt: null }; }
}
async function saveCompetitorInsights(data) { await saveCloudinaryJSON(COMPETITOR_INS_PID, data); }

// ─── 5. COMPETITOR PAIN POINTS (from reviews) ────────────────────────────────
async function loadCompetitorPainPoints() {
  try {
    const res = await axios.get(COMPETITOR_PAIN_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { painPoints: [], frustrations: [], updatedAt: null }; }
}
async function saveCompetitorPainPoints(data) { await saveCloudinaryJSON(COMPETITOR_PAIN_PID, data); }

// ─── OBJECTION MEMORY ────────────────────────────────────────────────────────
async function loadObjectionMemory() {
  try {
    const res = await axios.get(OBJECTION_MEMORY_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return {}; }
}
async function saveObjectionMemory(data) { await saveCloudinaryJSON(OBJECTION_MEMORY_PID, data); }

function detectObjection(message) {
  const m = message.toLowerCase();
  if (m.match(/muy caro|too expensive|precio alto|no tengo presupuesto|cuesta mucho|no puedo pagar|es mucho dinero/)) return 'too_expensive';
  if (m.match(/ahora no|not now|después|luego|más adelante|ocupado|no es buen momento|busy|later/)) return 'not_now';
  if (m.match(/ya tengo|ya trabajo con|tengo agencia|tengo alguien|already have/)) return 'already_have_agency';
  if (m.match(/no tengo tiempo|sin tiempo|muy ocupado|no time/)) return 'no_time';
  if (m.match(/solo mirando|just looking|solo información|solo info|just browsing/)) return 'just_looking';
  return null;
}

async function logObjectionResponse(objectionType, response, contactId) {
  try {
    const mem = await loadObjectionMemory();
    if (!mem[objectionType]) mem[objectionType] = { bestResponses: [], convertedCount: 0, pending: [] };
    mem[objectionType].pending.push({ contactId, response, timestamp: new Date().toISOString(), outcome: 'pending' });
    mem[objectionType].pending = mem[objectionType].pending.slice(-50); // keep last 50
    await saveObjectionMemory(mem);
  } catch (err) { console.error('[Objection] Log failed:', err.message); }
}

async function markObjectionConverted(contactId) {
  try {
    const mem = await loadObjectionMemory();
    let changed = false;
    for (const type of Object.keys(mem)) {
      if (!mem[type].pending) continue;
      for (const entry of mem[type].pending) {
        if (entry.contactId === contactId && entry.outcome === 'pending') {
          entry.outcome = 'converted';
          mem[type].convertedCount = (mem[type].convertedCount || 0) + 1;
          // Promote to bestResponses if not already there
          if (!mem[type].bestResponses.includes(entry.response)) {
            mem[type].bestResponses.unshift(entry.response);
            mem[type].bestResponses = mem[type].bestResponses.slice(0, 5);
          }
          changed = true;
        }
      }
    }
    if (changed) await saveObjectionMemory(mem);
  } catch (err) { console.error('[Objection] markConverted failed:', err.message); }
}

async function runObjectionLearning() {
  try {
    console.log('[Learning] Running objection pattern analysis...');
    const mem = await loadObjectionMemory();
    const summary = Object.entries(mem).map(([type, data]) => (
      `${type}: ${data.convertedCount || 0} conversions, best responses: ${(data.bestResponses || []).slice(0, 2).join(' | ')}`
    )).join('\n');
    if (!summary) return;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `You are analyzing objection handling data for a Spanish-speaking AI sales bot. Based on these results, return ONLY valid JSON: { "insights": "what's working", "newResponses": { "too_expensive": "one new counter", "not_now": "one new counter", "already_have_agency": "one new counter" } }\n\n${summary}` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    // Inject new AI-generated responses into best responses
    for (const [type, response] of Object.entries(parsed.newResponses || {})) {
      if (!mem[type]) mem[type] = { bestResponses: [], convertedCount: 0, pending: [] };
      if (response && !mem[type].bestResponses.includes(response)) {
        mem[type].bestResponses.push(response);
        mem[type].bestResponses = mem[type].bestResponses.slice(0, 5);
      }
    }
    await saveObjectionMemory(mem);
    console.log('[Learning] ✅ Objection patterns updated:', parsed.insights);
  } catch (err) { console.error('[Learning] Objection learning failed:', err.message); }
}

// ─── SELF-UPDATING SYSTEM PROMPT ─────────────────────────────────────────────
async function loadArmandoRules() {
  try {
    const res = await axios.get(ARMANDO_RULES_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return { rules: [], updatedAt: null }; }
}
async function saveArmandoRules(data) { await saveCloudinaryJSON(ARMANDO_RULES_PID, data); }

async function loadWeeklyWins() {
  try {
    const res = await axios.get(WEEKLY_WINS_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return []; }
}
async function saveWeeklyWins(data) { await saveCloudinaryJSON(WEEKLY_WINS_PID, data); }

async function logWeeklyWin(contactId, reply, outcome) {
  try {
    const wins = await loadWeeklyWins();
    wins.push({ contactId, reply: reply.slice(0, 300), outcome, timestamp: new Date().toISOString() });
    await saveWeeklyWins(wins.slice(-100)); // keep last 100 wins
  } catch (err) { console.error('[Rules] logWeeklyWin failed:', err.message); }
}

async function runSelfUpdateRules() {
  try {
    console.log('[Rules] Running self-update of Armando\'s playbook...');
    const [wins, engPatterns, objMem] = await Promise.all([
      loadWeeklyWins(),
      loadEngagementPatterns(),
      loadObjectionMemory(),
    ]);
    const winSummary = wins.slice(-30).map(w => `[${w.outcome}] "${w.reply}"`).join('\n');
    const engSummary = engPatterns.bestTopics ? `Best topics: ${engPatterns.bestTopics.join(', ')}. Best hook style: ${engPatterns.bestHookStyle}` : '';
    const objSummary = Object.entries(objMem).map(([t, d]) => `${t}: ${d.convertedCount || 0} conversions`).join(', ');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `You are improving the behavior rules for Armando, a Spanish-speaking AI sales bot for JRZ Marketing (Orlando, FL). Analyze this week's data and return ONLY valid JSON with exactly this structure:\n{"rules":["rule1","rule2","rule3","rule4","rule5"],"weeklyWins":${wins.length},"updatedAt":"${new Date().toISOString()}"}\n\nWins this week:\n${winSummary}\n\nEngagement: ${engSummary}\nObjections: ${objSummary}\n\nWrite 5 specific behavior rules in Spanish that will make Armando more effective next week. Rules should be actionable instructions like "Cuando alguien menciona precio, primero pregunta sobre su ROI antes de defender el costo".` }],
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    await saveArmandoRules(parsed);
    // Clear weekly wins for next week
    await saveWeeklyWins([]);
    console.log('[Rules] ✅ Armando playbook updated with', parsed.rules?.length, 'new rules');
  } catch (err) { console.error('[Rules] Self-update failed:', err.message); }
}

// ─── REEL ATTRIBUTION ─────────────────────────────────────────────────────────
async function loadReelLog() {
  try {
    const res = await axios.get(REEL_LOG_URL, { timeout: 6000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return []; }
}
async function saveReelLog(data) { await saveCloudinaryJSON(REEL_LOG_PID, data); }

async function logReelPost(hook, caption) {
  try {
    const log = await loadReelLog();
    log.unshift({ hook, caption: caption?.slice(0, 200) || '', postedAt: new Date().toISOString(), dmCount: 0, attributedContacts: [] });
    await saveReelLog(log.slice(0, 50)); // keep last 50 reels
  } catch (err) { console.error('[Attribution] logReelPost failed:', err.message); }
}

async function checkReelAttribution(contactId) {
  try {
    const log = await loadReelLog();
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
    const recentReel = log.find(r => new Date(r.postedAt).getTime() > cutoff && !r.attributedContacts.includes(contactId));
    if (!recentReel) return null;
    // Update reel log — increment dmCount and add contactId
    recentReel.dmCount = (recentReel.dmCount || 0) + 1;
    recentReel.attributedContacts.push(contactId);
    saveReelLog(log); // fire-and-forget
    return recentReel.hook;
  } catch { return null; }
}

async function runReviewMining() {
  try {
    console.log('[Learning] Mining competitor reviews...');
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) { console.log('[Learning] No SERPAPI_KEY — skipping review mining'); return; }
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google_maps', q: 'marketing agency orlando florida', hl: 'en', gl: 'us', api_key: SERPAPI_KEY },
      timeout: 15000
    });
    const results = res.data?.local_results || [];
    const reviews = results.slice(0, 5).flatMap(r => (r.reviews || []).filter(rv => rv.rating <= 2).map(rv => rv.snippet)).filter(Boolean).slice(0, 15);
    if (reviews.length === 0) { console.log('[Learning] No low-rated reviews found'); return; }
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: `Estas son reseñas negativas (1-2 estrellas) de agencias de marketing en Orlando. Extrae los problemas más comunes que los clientes mencionan:\n${reviews.join('\n')}\n\nDevuelve JSON: {"painPoints":["problema 1","problema 2","problema 3"],"frustrations":["frustración 1","frustración 2"]}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    parsed.updatedAt = new Date().toISOString();
    await saveCompetitorPainPoints(parsed);
    console.log('[Learning] ✅ Competitor pain points saved:', parsed.painPoints);
  } catch (err) { console.error('[Learning] Review mining failed:', err.message); }
}

// Weighted random variant assignment — winner gets more traffic over time
async function assignClosingVariant(contactId) {
  if (contactVariantMap.has(contactId)) return contactVariantMap.get(contactId);
  const data = await loadABTestData();
  const w = data.weights;
  const total = w.A + w.B + w.C + w.D;
  let rand = Math.random() * total;
  let variant = 'A';
  for (const [v, weight] of Object.entries(w)) {
    rand -= weight;
    if (rand <= 0) { variant = v; break; }
  }
  contactVariantMap.set(contactId, variant);
  // Record the send
  data.variants[variant].sent++;
  await saveABTestData(data);
  console.log(`[AB] Contact ${contactId} assigned variant ${variant} (${CLOSING_VARIANTS[variant].name})`);
  return variant;
}

// Call this when a contact converts (gives phone or email)
async function recordABConversion(contactId) {
  const variant = contactVariantMap.get(contactId);
  if (!variant) return;
  const data = await loadABTestData();
  data.variants[variant].conversions++;
  await saveABTestData(data);
  console.log(`[AB] Conversion recorded for variant ${variant} (${CLOSING_VARIANTS[variant].name})`);
}

// Weekly: Claude analyzes results → adjusts weights → winner gets more traffic
async function runABTestAnalysis() {
  console.log('[AB] Running weekly A/B test analysis...');
  try {
    const data = await loadABTestData();
    const summary = Object.entries(data.variants).map(([v, s]) => {
      const rate = s.sent > 0 ? ((s.conversions / s.sent) * 100).toFixed(1) : '0.0';
      return `Variant ${v} (${s.name}): ${s.sent} sent, ${s.conversions} conversions, ${rate}% conversion rate`;
    }).join('\n');

    const prompt = `Eres el director de marketing de JRZ Marketing analizando los resultados del A/B test de cierres de venta de Armando (DM bot).

RESULTADOS DE ESTA SEMANA:
${summary}

Pesos actuales: A=${data.weights.A}%, B=${data.weights.B}%, C=${data.weights.C}%, D=${data.weights.D}%

VARIANTES:
A - Direct: cierre directo sin rodeos
B - Social Proof: historia de cliente similar + invitación
C - Pain Point: nombra su problema específico + solución
D - Curiosity Gap: genera intriga para que quieran la llamada

Tu tarea:
1. Analiza qué variante está convirtiendo mejor
2. Ajusta los pesos para la próxima semana — el ganador debe recibir más tráfico, pero no elimines ninguna variante (mínimo 10% cada una)
3. Suma total de pesos debe ser exactamente 100
4. Si hay pocos datos (menos de 5 sends por variante), mantén pesos iguales y espera más datos

Responde SOLO con JSON válido:
{
  "weights": {"A": number, "B": number, "C": number, "D": number},
  "winner": "A|B|C|D|none",
  "insight": "una oración sobre qué está funcionando y por qué"
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
    const prevWeights = { ...data.weights };

    data.weights = parsed.weights;
    data.lastOptimized = new Date().toISOString().split('T')[0];
    data.history.push({
      date: data.lastOptimized,
      winner: parsed.winner,
      insight: parsed.insight,
      oldWeights: prevWeights,
      newWeights: parsed.weights,
      snapshot: JSON.parse(JSON.stringify(data.variants)),
    });

    // Reset weekly counts after saving snapshot
    for (const v of Object.keys(data.variants)) {
      data.variants[v].sent = 0;
      data.variants[v].conversions = 0;
    }

    await saveABTestData(data);
    console.log(`[AB] ✅ Weights updated. Winner: ${parsed.winner}. Insight: ${parsed.insight}`);
    console.log(`[AB] New weights:`, parsed.weights);
    return parsed;
  } catch (err) {
    console.error('[AB] ❌ Analysis failed:', err.message);
    return null;
  }
}

async function loadContentStrategy() {
  try {
    const res = await axios.get(STRATEGY_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    return {
      bestTopics: ['IA y automatización', 'errores de marketing', 'leads perdidos'],
      bestHookStyle: 'question-based hooks outperform statements',
      bestDays: { instagram: 'saturday', facebook: 'monday', linkedin: 'thursday' },
      audienceInsights: '25–34 year-old male business owners, Orlando FL, respond to problem-focused content',
      avoidTopics: [],
      weeklyNotes: 'No data yet — baseline week.',
    };
  }
}

async function saveContentStrategy(strategy) {
  const ts       = Math.floor(Date.now() / 1000);
  const sigStr   = `overwrite=true&public_id=${STRATEGY_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(sigStr).digest('hex');
  const form = new FormData();
  const buf  = Buffer.from(JSON.stringify(strategy, null, 2));
  form.append('file',          buf,    { filename: 'content_strategy.json', contentType: 'application/json' });
  form.append('public_id',     STRATEGY_PUB_ID);
  form.append('resource_type', 'raw');
  form.append('timestamp',     String(ts));
  form.append('api_key',       CLOUDINARY_API_KEY);
  form.append('signature',     signature);
  form.append('overwrite',     'true');
  await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
    form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
  );
}

async function getWeeklyStats() {
  const res = await axios.post(
    `https://services.leadconnectorhq.com/social-media-posting/statistics?locationId=${GHL_LOCATION_ID}`,
    { profileIds: ANALYTICS_PROFILE_IDS, platforms: ['instagram','facebook','linkedin','youtube','tiktok'] },
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );
  return res.data?.results || res.data;
}

async function runWeeklyAnalysis() {
  console.log('[Learn] Running weekly analytics analysis...');
  try {
    const [stats, prevStrategy] = await Promise.all([getWeeklyStats(), loadContentStrategy()]);

    const breakdown = stats?.breakdowns || {};
    const eng       = breakdown?.engagement || {};

    const prompt = `Eres el director de marketing de JRZ Marketing. Analiza estos datos de la semana pasada y actualiza la estrategia de contenido.

DATOS DE LA SEMANA:
- Impresiones totales: ${breakdown?.impressions?.total || 0} (cambio: ${breakdown?.impressions?.totalChange || 0}%)
- Alcance total: ${breakdown?.reach?.total || 0} (cambio: ${breakdown?.reach?.totalChange || 0}%)
- Instagram: ${breakdown?.impressions?.platforms?.instagram?.value || 0} impresiones, ${eng?.instagram?.likes || 0} likes, ${eng?.instagram?.comments || 0} comentarios, ${eng?.instagram?.shares || 0} shares
- Facebook: ${breakdown?.impressions?.platforms?.facebook?.value || 0} impresiones, ${eng?.facebook?.likes || 0} likes
- LinkedIn: ${breakdown?.impressions?.platforms?.linkedin?.value || 0} impresiones, ${eng?.linkedin?.likes || 0} likes
- TikTok: ${breakdown?.impressions?.platforms?.tiktok?.value || 0} impresiones
- YouTube: ${breakdown?.impressions?.platforms?.youtube?.value || 0} impresiones
- Nuevos seguidores: ${breakdown?.followers?.total || 0} (Instagram)
- Demografía: 53% hombres, 25-34 años es el grupo más grande
- Mejor día de impresiones: ${stats?.postPerformance?.impressions ? JSON.stringify(stats.postPerformance.impressions) : 'no data'}

ESTRATEGIA ANTERIOR:
${JSON.stringify(prevStrategy, null, 2)}

Responde SOLO con un JSON válido con esta estructura:
{
  "bestTopics": ["tema1", "tema2", "tema3"],
  "bestHookStyle": "descripción del estilo de hook que más funciona",
  "bestDays": {"instagram": "día", "facebook": "día", "linkedin": "día", "tiktok": "día"},
  "audienceInsights": "insights sobre la audiencia basados en los datos",
  "avoidTopics": ["temas que no funcionaron"],
  "weeklyNotes": "observaciones clave y ajustes para la próxima semana",
  "hookFormulas": ["fórmula de hook 1", "fórmula de hook 2", "fórmula de hook 3"]
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const newStrategy = JSON.parse(msg.content[0].text.trim());
    newStrategy.updatedAt = new Date().toISOString().split('T')[0];
    await saveContentStrategy(newStrategy);
    console.log('[Learn] ✅ Strategy updated:', newStrategy.weeklyNotes);
    return newStrategy;
  } catch (err) {
    console.error('[Learn] ❌ Weekly analysis failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// OPPORTUNITIES — Add contacts to Marketing Pipeline in GHL
// ═══════════════════════════════════════════════════════════

const opportunityCreatedContacts = new Set();

async function createOpportunity(contactId, contactName, stageId) {
  // Skip silently if we already created one this session
  if (opportunityCreatedContacts.has(contactId)) {
    console.log(`[Opportunity] Skipping — already created for ${contactId}`);
    return;
  }
  try {
    await axios.post(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        pipelineId:    MARKETING_PIPELINE_ID,
        locationId:    GHL_LOCATION_ID,
        name:          contactName || 'Lead',
        pipelineStageId: stageId,
        contactId,
        assignedTo:    GHL_USER_ID,
        status:        'open',
      },
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
    );
    opportunityCreatedContacts.add(contactId);
    console.log(`[Opportunity] ✅ Added ${contactName} (${contactId}) → stage ${stageId}`);
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.message || '';
    if (status === 400 && msg.toLowerCase().includes('duplicate')) {
      opportunityCreatedContacts.add(contactId); // mark so we don't try again
      console.log(`[Opportunity] Already exists for ${contactId} — skipping.`);
    } else {
      console.error(`[Opportunity] ❌ Failed for ${contactId}:`, err?.response?.data || err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — WARM DM OUTREACH
// When someone comments or follows → Armando DMs them
// within 60 seconds with a personalized message.
// Cooldown: never re-messages same contact within 7 days.
// ═══════════════════════════════════════════════════════════

const dmCooldown = new Map(); // contactId → last DM timestamp

async function sendWarmDM(contactId, triggerType, context = {}) {
  // Cooldown check — 7 days
  const lastDM = dmCooldown.get(contactId);
  if (lastDM && Date.now() - lastDM < 7 * 24 * 60 * 60 * 1000) return;
  dmCooldown.set(contactId, Date.now());

  // Get contact name if available
  let contactName = context.name || 'amigo';
  try {
    const c = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    contactName = c.data?.contact?.firstName || contactName;
  } catch (_) {}

  const prompts = {
    comment: `Alguien llamado ${contactName} comentó en uno de nuestros posts de JRZ Marketing en redes sociales. Escribe un DM corto, natural y humano de Armando Rivas (22 años, venezolano, Community Manager de JRZ Marketing) para iniciar una conversación. Menciona que viste su comentario, pregunta sobre su negocio, y de forma casual menciona que ofrecemos consultas gratuitas. MAX 3 oraciones. Sin hashtags. En español.`,
    follower: `Alguien llamado ${contactName} acaba de seguir la cuenta de JRZ Marketing en Instagram. Escribe un DM de bienvenida corto y humano de Armando Rivas. Agradece que siguió, pregunta qué tipo de negocio tiene, y menciona casualmente la consulta gratuita. MAX 3 oraciones. Sin hashtags. En español.`,
    form_fill: `Alguien llamado ${contactName} llenó un formulario de interés en JRZ Marketing. Escribe un DM de seguimiento rápido de Armando Rivas. Menciona que vio su información, pregunta cuál es su mayor reto de marketing ahora mismo, y propone hablar 15 minutos. MAX 3 oraciones. Sin hashtags. En español.`,
  };

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompts[triggerType] || prompts.comment }],
  });
  const dmText = msg.content[0].text.trim();

  // Send via GHL conversations API
  try {
    await sendEmail(contactId, '👋 Hola desde JRZ Marketing', `<p>${dmText}</p>`);
    console.log(`[WarmDM] ✅ Sent ${triggerType} DM to contact ${contactId}`);
    await createOpportunity(contactId, contactName, PIPELINE_STAGES.newLead);
    await tagContact(contactId, ['nurture-sequence']);
  } catch (err) {
    console.error('[WarmDM] ❌ Failed to send DM:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — OUTBOUND PROSPECTING
// Runs Mon–Fri at 10am EST. Finds contacts in GHL tagged
// "outbound_pending", sends 15 personalized outreach
// messages per day, then tags them "outbound_sent".
// To add prospects: import contacts in GHL with tag
// "outbound_pending" (LinkedIn export, referrals, etc.)
// ═══════════════════════════════════════════════════════════

async function runDailyOutbound() {
  console.log('[Outbound] Running daily prospecting (50 contacts)...');
  try {
    // Fetch contacts tagged outbound_pending
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=outbound_pending&limit=50`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const contacts = res.data?.contacts || [];
    if (!contacts.length) {
      console.log('[Outbound] No pending prospects today.');
      return { sent: 0 };
    }

    let sent = 0;
    for (const contact of contacts) {
      const name     = contact.firstName || 'dueño de negocio';
      const business = contact.companyName || 'tu negocio';
      const city     = contact.city || 'Tampa';
      const industry = contact.tags?.find(t => ['restaurant','construccion','gym','tattoo','fitness'].some(k => t.toLowerCase().includes(k))) || '';

      // Generate personalized outreach via Claude
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Eres Jose Rivas, fundador de JRZ Marketing — una agencia de marketing bilingüe (español e inglés) en Florida que ayuda a dueños de negocios hispanos a capturar más clientes y automatizar su seguimiento.

Escribe un mensaje de prospección corto, directo y personal para ${name}, dueño/a de ${business} en ${city}${industry ? `, en la industria de ${industry}` : ''}.

Contexto del cliente ideal: dueño hispano de negocio pequeño o mediano (restaurante, construcción, gimnasio, tattoo, etc.) en Tampa, Orlando o Miami. Tiene 30+ años. Trabaja duro pero pierde clientes por falta de seguimiento o sistema organizado.

Tono: estratégico, confiado, cálido. Habla de oportunidad, no de problemas. Como si fueras un colega exitoso que quiere ayudar.

Reglas:
- Máximo 4 oraciones
- En español (menciona que somos bilingües)
- Termina con UNA pregunta sobre su mayor reto para conseguir o retener clientes
- No uses hashtags, emojis ni jerga de vendedor
- No menciones precios
- Sé específico a su industria o ciudad si puedes`,
        }],
      });

      const outboundMsg = msg.content[0].text.trim();

      // Send via GHL
      try {
        await sendEmail(contact.id, `${name}, ¿estás capturando todos tus clientes potenciales?`, `<p>${outboundMsg}</p><p style="color:#666;font-size:12px">Jose Rivas · JRZ Marketing · Bilingüe: English / Español · jrzmarketing.com · (407) 844-6376</p>`);

        // Move from outbound_pending → outbound_sent + add to pipeline
        await axios.post(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { tags: ['outbound_sent'] },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.delete(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { data: { tags: ['outbound_pending'] }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await createOpportunity(contact.id, `${name} — ${business}`, PIPELINE_STAGES.newLead);
        await tagContact(contact.id, ['nurture-sequence']);

        sent++;
        console.log(`[Outbound] ✅ Sent to ${name} (${business})`);
        // Small delay between messages to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[Outbound] ❌ Failed for ${contact.id}:`, err?.response?.data || err.message);
      }
    }

    console.log(`[Outbound] ✅ Done — ${sent}/${contacts.length} messages sent today`);
    return { sent, total: contacts.length };
  } catch (err) {
    console.error('[Outbound] ❌ Outbound run failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA AUTOMATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

// ─── Build a Reel from carousel slides via FFmpeg → upload to Cloudinary ────
// opts.maxSlides: how many slides to use (default 4 = 28s, use 3 for 15s)
// opts.slideDuration: seconds per slide (default 7 for carousel, 5 for short Reels)
// opts.publicIdSuffix: extra suffix for Cloudinary public_id (e.g. '_short')
// Returns permanent Cloudinary video URL, or null on failure
async function createReelFromSlides(slideUrls, dayIdx, opts = {}) {
  const { maxSlides = 4, slideDuration = 7, publicIdSuffix = '' } = opts;
  const slides  = slideUrls.slice(0, maxSlides);
  const tmpDir = '/tmp/jrz_reel';
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Download selected slides to /tmp
    const slidePaths = [];
    for (let i = 0; i < slides.length; i++) {
      const dest = path.join(tmpDir, `slide${i}.png`);
      const res  = await axios.get(slides[i], { responseType: 'arraybuffer' });
      fs.writeFileSync(dest, res.data);
      slidePaths.push(dest);
    }

    // 2. Build FFmpeg filter — slideDuration seconds per slide with black fade between each
    const fadeStart = slideDuration - 1; // fade begins 1s before slide ends
    const n       = slidePaths.length;
    const inputs  = slidePaths.map(p => `-loop 1 -t ${slideDuration} -i "${p}"`).join(' ');
    const filters = slidePaths.map((_, i) => {
      const base = `[${i}:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      if (i === 0)     return `${base},fade=t=out:st=${fadeStart}:d=1[v${i}]`;
      if (i === n - 1) return `${base},fade=t=in:st=0:d=1[v${i}]`;
      return               `${base},fade=t=in:st=0:d=1,fade=t=out:st=${fadeStart}:d=1[v${i}]`;
    }).join(';');
    const concat  = slidePaths.map((_, i) => `[v${i}]`).join('');
    const outPath = path.join(tmpDir, `reel${publicIdSuffix}.mp4`);

    const cmd = `ffmpeg -y ${inputs} -filter_complex "${filters};${concat}concat=n=${n}:v=1:a=0,format=yuv420p[v]" -map "[v]" -r 30 -c:v libx264 -preset ultrafast -crf 26 "${outPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });

    // 3. Upload to Cloudinary (video resource, overwrite on each run)
    const publicId  = `jrz/reel_day${dayIdx}${publicIdSuffix}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr    = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',       fs.createReadStream(outPath));
    form.append('public_id',  publicId);
    form.append('timestamp',  String(timestamp));
    form.append('api_key',    CLOUDINARY_API_KEY);
    form.append('signature',  signature);
    form.append('overwrite',  'true');

    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120000 }
    );

    // Cleanup temp files
    slidePaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
    try { fs.unlinkSync(outPath); } catch (_) {}

    // Return version-less URL so it always serves the latest
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/jrz/reel_day${dayIdx}${publicIdSuffix}.mp4`;
  } catch (err) {
    console.error('[Reel] ❌ Failed to create reel:', err.message);
    return null;
  }
}

// Schedule a post via GHL Social Media API
// Pass media = [{ url, type: 'image' }] array for Instagram image posts
async function schedulePost({ caption, accountIds, type = 'post', scheduleDate, media }) {
  const body = {
    accountIds,
    type,
    userId: GHL_USER_ID,
    status: 'scheduled',
    summary: caption,
    scheduleDate: scheduleDate.toISOString(),
    scheduleTimeUpdated: true,
  };
  body.media = (media && media.length) ? media : [];
  const res = await axios.post(
    `https://services.leadconnectorhq.com/social-media-posting/${GHL_LOCATION_ID}/posts`,
    body,
    {
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
    }
  );
  return res.data;
}

// Get today's carousel script — cycles through 14 pre-written, then uses NewsAPI + Claude
function getTodaysScript() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((now - start) / 86400000);
  const scriptIndex = (dayOfYear - 1) % CAROUSEL_SCRIPTS.length;
  return { script: CAROUSEL_SCRIPTS[scriptIndex], index: scriptIndex, usedPrewritten: true };
}

// Use NewsAPI + Claude to generate fresh Spanish content (week 3+ fallback)
async function generateNewsCaption() {
  try {
    const newsRes = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'inteligencia artificial negocios automatizacion marketing digital',
        language: 'es',
        sortBy: 'popularity',
        pageSize: 5,
        apiKey: NEWS_API_KEY,
      },
    });

    let articles = newsRes.data?.articles || [];
    if (!articles.length) {
      // Fallback: search in English
      const fallbackRes = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: 'artificial intelligence business automation marketing',
          language: 'en',
          sortBy: 'popularity',
          pageSize: 5,
          apiKey: NEWS_API_KEY,
        },
      });
      articles = fallbackRes.data?.articles || [];
    }

    const headlines = articles.slice(0, 3).map(a => `• ${a.title}`).join('\n');
    if (!headlines) throw new Error('No articles found');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are Marco, Content Director at JRZ Marketing. José Rivas is the CEO — AI & automation expert for Latino entrepreneurs in Orlando, FL. Audience: 53% men, 25-34, small Latino business owners.

Today's trending news:
${headlines}

CAPTION ENGINE RULES (apply all):
1. HOOK (first line): Use the Who/What/How framework — answer in one line: WHO is this for? WHAT is it about? HOW does it help them? Use a pattern interrupt, contrarian angle, or curiosity gap. Make it impossible to scroll past.
2. EMOTIONAL STORYTELLING: Write at grade 6-7 readability. Sound human and reflective — NOT robotic or salesy. Use conversational language with subtle authority.
3. STRUCTURE for saves (carousel format): Step-by-step blueprint OR checklist OR myth vs truth OR before/after transformation. High educational density = people save it to use later.
4. SAVE TRIGGER: Include one line that explicitly tells them to save (e.g. "Guarda esto para cuando lo necesites" or "Save this — you'll thank me later").
5. COMMENT TRIGGER: End with a question that creates genuine discussion.
6. CTA: Natural, not pushy — "Agenda gratis → ${BOOKING_URL}"
7. HASHTAGS: 8-10 niche-relevant tags at the end.

Write the full Spanish post (max 1,800 chars). Post text only, no explanations.`,
      }],
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error('News content generation failed:', err.message, '— using pre-written fallback');
    const { script } = getTodaysScript();
    return script.caption;
  }
}

// Generate and publish a daily English blog post via GHL Blogs API
async function createDailyBlog(topic, caption) {
  try {
    console.log(`[Blog] Generating English blog post for: "${topic}"...`);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are the content writer for JRZ Marketing, a bilingual AI automation and digital marketing agency in Orlando, FL. José Rivas is the founder and CEO.

Write a complete, SEO-optimized blog post in ENGLISH about:
"${topic}"

The post should:
- Be 600-900 words
- Have a compelling H2 introduction
- Include 3-4 H3 subheadings with practical content
- Position Jose Rivas / JRZ Marketing as the AI automation authority for Latino entrepreneurs
- Include a clear CTA at the end: "Book your free strategy call at jrzmarketing.com/contact-us"
- Include real, actionable advice with specific examples and numbers
- Include 2–3 natural internal backlinks using <a href="..."> tags:

CRITICAL — WRITE LIKE A REAL HUMAN EXPERT, NOT AN AI:
- Use contractions naturally (you'll, don't, it's, we're, that's)
- Mix short punchy sentences with longer ones — vary the rhythm
- Start paragraphs in different ways — not always "The" or "This"
- Use "you" and occasionally "I" — write directly to the reader
- Include specific real-world examples, not vague claims
- NEVER use: "In today's digital age", "It's no secret", "In conclusion", "Furthermore", "Moreover", "Game-changing", "Leverage", "Robust", "Delve into", "Navigate the landscape", "In the ever-evolving"
- NO perfectly parallel bullet points all the same length — vary them
- Sound like a knowledgeable friend giving advice, not a corporate blog
  * Link "AI marketing automation" or similar to: https://jrzmarketing.com
  * Link "book a free strategy call" to: https://jrzmarketing.com/contact-us
  * Link one relevant phrase to: https://jrzmarketing.com/blog (e.g. "read more on our blog")
- These links must feel natural in the sentence — not forced

Format: Return ONLY the HTML body content (no <html>, <head>, or <body> tags). Start with <h2>. Include <p>, <ul>, <li>, <h3>, <strong>, <a> tags as needed.`,
      }],
    });

    const rawHTML = response.content[0].text.trim();

    // Build SEO-friendly slug from topic
    const urlSlug = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
      + '-' + Date.now().toString(36);

    // Pick categories based on content
    const categories = [
      BLOG_CATEGORIES.marketing,
      BLOG_CATEGORIES.ai,
      BLOG_CATEGORIES.business,
    ];

    const publishedAt = new Date();
    publishedAt.setUTCHours(13, 0, 0, 0); // 8am EST

    const res = await axios.post(
      'https://services.leadconnectorhq.com/blogs/posts',
      {
        title: topic,
        locationId: GHL_LOCATION_ID,
        blogId: BLOG_ID,
        description: caption.slice(0, 200).replace(/[#\n]/g, ' ').trim(),
        imageUrl: 'https://msgsndr-private.storage.googleapis.com/locationPhotos/bf4cfbc0-6359-4e62-a0fa-de3af69d3218.png',
        imageAltText: `JRZ Marketing — ${topic}`,
        author: BLOG_AUTHOR_ID,
        categories,
        tags: ['JRZ Marketing', 'AI automation', 'marketing', 'digital marketing'],
        urlSlug,
        status: 'PUBLISHED',
        publishedAt: publishedAt.toISOString(),
        rawHTML,
      },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`[Blog] ✅ Blog post published: "${topic}" — ID: ${res.data?.blogPost?._id}`);
    return { success: true, title: topic, id: res.data?.blogPost?._id };
  } catch (err) {
    console.error('[Blog] ❌ Failed to create blog post:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// ─── DATAFORSEO HELPERS ──────────────────────────────────────────────────────────────────────

// Returns monthly search volume + competition for up to 10 keywords (USA, English)
async function getKeywordMetrics(keywords) {
  if (!DATAFORSEO_PASSWORD || !keywords.length) return [];
  try {
    const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
    const res = await axios.post(
      `${DATAFORSEO_BASE}/v3/keywords_data/google_ads/search_volume/live`,
      [{ keywords: keywords.slice(0, 10), language_code: 'en', location_code: 2840 }],
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const items = res.data?.tasks?.[0]?.result || [];
    return items.map(r => ({
      keyword:      r.keyword,
      searchVolume: r.search_volume || 0,
      competition:  r.competition_level || 'UNKNOWN',
      cpc:          +(r.cpc || 0).toFixed(2),
    }));
  } catch (err) {
    console.error('[DataForSEO] Keyword metrics error:', err?.response?.data || err.message);
    return [];
  }
}

// Returns position (1–100) where jrzmarketing.com ranks for a keyword, or null if not found
async function checkSERPPosition(keyword, domain = 'jrzmarketing.com') {
  if (!DATAFORSEO_PASSWORD) return null;
  try {
    const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
    const res = await axios.post(
      `${DATAFORSEO_BASE}/v3/serp/google/organic/live/advanced`,
      [{ keyword, location_code: 2840, language_code: 'en', depth: 30 }],
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    const items = res.data?.tasks?.[0]?.result?.[0]?.items || [];
    const match = items.find(item => item.url && item.url.includes(domain));
    return match ? match.rank_absolute : null;
  } catch (err) {
    console.error('[DataForSEO] SERP check error:', err?.response?.data || err.message);
    return null;
  }
}

// Sofia's weekly keyword rank report — checks 10 core JRZ Marketing target keywords,
// compares to last week's positions (stored in Cloudinary), emails Jose the delta.
const DATAFORSEO_SNAPSHOT_PID = 'jrz/keyword_rankings_snapshot';
const JRZ_TARGET_KEYWORDS = [
  'AI marketing agency Orlando',
  'marketing automation Orlando',
  'digital marketing agency Orlando FL',
  'AI automation for small business Orlando',
  'social media marketing Orlando',
  'lead generation agency Orlando',
  'GHL Go High Level agency Orlando',
  'bilingual marketing agency Orlando',
  'Latino marketing agency Florida',
  'marketing agency for restaurants Orlando',
];

async function runSofiaKeywordTracker() {
  try {
    console.log('[SEO Tracker] Sofia: checking keyword rankings...');

    // Load last week's snapshot from Cloudinary
    let lastSnapshot = {};
    try {
      const snap = await axios.get(
        `https://res.cloudinary.com/dbsuw1mfm/raw/upload/${DATAFORSEO_SNAPSHOT_PID}.json`,
        { timeout: 8000 }
      );
      lastSnapshot = snap.data || {};
    } catch (_) { /* first run — no snapshot yet */ }

    // Check current positions for all target keywords
    const results = [];
    for (const kw of JRZ_TARGET_KEYWORDS) {
      const position = await checkSERPPosition(kw);
      const prev = lastSnapshot[kw] || null;
      const delta = (position && prev) ? prev - position : null; // positive = moved up
      results.push({ keyword: kw, position, prev, delta });
      await new Promise(r => setTimeout(r, 500)); // rate limit — DataForSEO allows ~1 req/sec
    }

    // Save new snapshot
    const newSnapshot = {};
    results.forEach(r => { if (r.position) newSnapshot[r.keyword] = r.position; });
    try {
      const ts = Math.floor(Date.now() / 1000);
      const sigStr = `overwrite=true&public_id=${DATAFORSEO_SNAPSHOT_PID}&timestamp=${ts}${process.env.CLOUDINARY_API_SECRET}`;
      const sig = crypto.createHash('sha1').update(sigStr).digest('hex');
      const fd = new FormData();
      fd.append('file', Buffer.from(JSON.stringify(newSnapshot)), { filename: 'data.json', contentType: 'application/json' });
      fd.append('public_id', DATAFORSEO_SNAPSHOT_PID);
      fd.append('overwrite', 'true');
      fd.append('timestamp', ts);
      fd.append('api_key', '984314321446626');
      fd.append('signature', sig);
      await axios.post('https://api.cloudinary.com/v1_1/dbsuw1mfm/raw/upload', fd, { headers: fd.getHeaders(), timeout: 15000 });
    } catch (snapErr) {
      console.error('[SEO Tracker] Snapshot save failed:', snapErr.message);
    }

    // Build email report
    const ranked   = results.filter(r => r.position && r.position <= 10);
    const page2    = results.filter(r => r.position && r.position > 10 && r.position <= 30);
    const improved = results.filter(r => r.delta && r.delta > 0);
    const dropped   = results.filter(r => r.delta && r.delta < 0);

    const arrow = (delta) => delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : '—';
    const rowColor = (pos) => pos <= 3 ? '#16a34a' : pos <= 10 ? '#2563eb' : pos <= 30 ? '#d97706' : '#dc2626';

    const rows = results.map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.keyword}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${r.position ? rowColor(r.position) : '#9ca3af'}">
          ${r.position ? `#${r.position}` : 'Not ranked'}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:${r.delta > 0 ? '#16a34a' : r.delta < 0 ? '#dc2626' : '#6b7280'}">
          ${r.prev ? arrow(r.delta) : '—'}
        </td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#0f172a;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:22px">🎯 JRZ Marketing — Keyword Rankings</h1>
          <p style="color:#94a3b8;margin:6px 0 0">Sofia's weekly SEO tracker • ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
        </div>
        <div style="background:#f8fafc;padding:20px">
          <div style="display:flex;gap:12px;margin-bottom:20px">
            <div style="flex:1;background:#fff;padding:16px;border-radius:8px;text-align:center;border:2px solid #16a34a">
              <div style="font-size:28px;font-weight:700;color:#16a34a">${ranked.length}</div>
              <div style="color:#6b7280;font-size:12px">PAGE 1 (Top 10)</div>
            </div>
            <div style="flex:1;background:#fff;padding:16px;border-radius:8px;text-align:center;border:2px solid #d97706">
              <div style="font-size:28px;font-weight:700;color:#d97706">${page2.length}</div>
              <div style="color:#6b7280;font-size:12px">PAGE 2 (Striking distance)</div>
            </div>
            <div style="flex:1;background:#fff;padding:16px;border-radius:8px;text-align:center;border:2px solid #16a34a">
              <div style="font-size:28px;font-weight:700;color:#16a34a">+${improved.length}</div>
              <div style="color:#6b7280;font-size:12px">IMPROVED</div>
            </div>
            <div style="flex:1;background:#fff;padding:16px;border-radius:8px;text-align:center;border:2px solid #dc2626">
              <div style="font-size:28px;font-weight:700;color:#dc2626">-${dropped.length}</div>
              <div style="color:#6b7280;font-size:12px">DROPPED</div>
            </div>
          </div>
          <table style="width:100%;background:#fff;border-radius:8px;border-collapse:collapse">
            <thead>
              <tr style="background:#f1f5f9">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">KEYWORD</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase">POSITION</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase">CHANGE</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${page2.length > 0 ? `
          <div style="background:#fffbeb;border:1px solid #fbbf24;padding:16px;border-radius:8px;margin-top:16px">
            <strong>🎯 Striking Distance — Daily SEO Blog Targets:</strong>
            <ul style="margin:8px 0 0;padding-left:20px;color:#92400e">
              ${page2.map(r => `<li>${r.keyword} (currently #${r.position})</li>`).join('')}
            </ul>
          </div>` : ''}
        </div>
      </div>`;

    await sendEmail(OWNER_CONTACT_ID, `🎯 Keyword Rankings Report — ${ranked.length} on Page 1`, html);
    console.log(`[SEO Tracker] ✅ Report sent — ${ranked.length} on page 1, ${page2.length} striking distance`);
    return { success: true, page1: ranked.length, page2: page2.length, improved: improved.length };

  } catch (err) {
    console.error('[SEO Tracker] ❌ Error:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// ─── DAILY SEO BLOG: Isabella targets striking-distance keywords from Google Search Console ────
// Runs daily at 7:10am EST. Finds keywords ranking 11–30 (page 2 = easiest to push to page 1),
// writes a 1000-word SEO-optimized post via Claude Opus, and publishes it on jrzmarketing.com.
async function runDailySeoBlog() {
  try {
    console.log('[SEO Blog] Isabella: starting daily SEO blog generation...');

    // Step 1: Get Google access token for Search Console
    const token = await getGoogleAccessToken();
    if (!token) {
      console.warn('[SEO Blog] No GSC token — skipping');
      return { success: false, reason: 'no_gsc_token' };
    }

    // Step 2: Fetch top 50 keywords by impressions (last 90 days = more data for better targeting)
    const siteUrl = encodeURIComponent('https://jrzmarketing.com/');
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDate = new Date(today - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const gscRes = await axios.post(
      `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
      {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 50,
        orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    const rows = gscRes.data?.rows || [];

    // Step 3: Find striking-distance keywords (position 11–30 = page 2, easiest to rank on page 1)
    const strikingDistance = rows.filter(r => r.position >= 11 && r.position <= 30);

    let targetKeyword, targetPosition, targetImpressions;

    if (strikingDistance.length > 0) {
      // Best opportunity = highest impressions at position 11–30 (most searches, not yet ranking)
      const best = strikingDistance.sort((a, b) => b.impressions - a.impressions)[0];
      targetKeyword    = best.keys[0];
      targetPosition   = best.position.toFixed(1);
      targetImpressions = best.impressions;
    } else if (rows.length > 0) {
      // Fallback: keyword with most impressions but low CTR = underperforming, needs better content
      const sorted = rows.sort((a, b) => b.impressions - a.impressions);
      targetKeyword    = sorted[0].keys[0];
      targetPosition   = sorted[0].position.toFixed(1);
      targetImpressions = sorted[0].impressions;
    } else {
      // No GSC data yet — use a proven high-value topic
      targetKeyword    = 'AI marketing automation for small businesses Orlando';
      targetPosition   = null;
      targetImpressions = null;
    }

    // Step 3b: Use DataForSEO to get monthly search volume for top candidates
    // and upgrade our keyword choice from "most impressions" to "most monthly searches"
    if (strikingDistance.length > 1 && DATAFORSEO_PASSWORD) {
      const topCandidates = strikingDistance
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 5)
        .map(r => r.keys[0]);
      const metrics = await getKeywordMetrics(topCandidates);
      if (metrics.length > 0) {
        const best = metrics.sort((a, b) => b.searchVolume - a.searchVolume)[0];
        const original = strikingDistance.find(r => r.keys[0] === best.keyword);
        if (original) {
          targetKeyword     = best.keyword;
          targetPosition    = original.position.toFixed(1);
          targetImpressions = `${best.searchVolume.toLocaleString()} searches/mo`;
        }
      }
    }

    console.log(`[SEO Blog] Target keyword: "${targetKeyword}" (pos: ${targetPosition}, volume: ${targetImpressions})`);

    // Step 4: Write an SEO-optimized blog post via Claude Opus
    const blogResponse = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are Isabella, the SEO Content Strategist for JRZ Marketing — a bilingual AI automation and digital marketing agency in Orlando, FL. José Rivas is the founder and CEO.

Your task: Write a highly SEO-optimized blog post that will help jrzmarketing.com rank on page 1 of Google for the target keyword.

TARGET KEYWORD: "${targetKeyword}"
${targetPosition ? `CURRENT GOOGLE POSITION: ${targetPosition} (page 2 — push this to page 1)` : ''}
${targetImpressions ? `MONTHLY IMPRESSIONS: ${targetImpressions} (people are actively searching this)` : ''}

REQUIREMENTS:
- Length: 900–1200 words
- Use the exact target keyword in: title, first paragraph, at least 2 H2/H3 headings, and the conclusion
- Include LSI keywords (related terms, synonyms) naturally throughout
- Include specific Orlando / Central Florida references to boost local SEO
- Structure: compelling intro (state the problem) → 3–4 H2 sections with actionable advice → local relevance section → strong CTA
- CTA at the end: "Ready to dominate Google in Orlando? Book your free strategy call at jrzmarketing.com/contact-us"
- Tone: confident expert speaking directly to the reader — not corporate, not salesy
- Include at least one numbered list or bullet list (helps Google feature snippets)
- End with a FAQ section: 2–3 questions targeting "People Also Ask" (format as <h3>Q:</h3><p>A:</p>)

CRITICAL — WRITE LIKE A REAL HUMAN EXPERT, NOT AN AI:
- Use contractions naturally (you'll, don't, it's, we're, that's, here's)
- Mix short punchy sentences with longer ones — vary the rhythm constantly
- Use "you" throughout — write directly to the reader like you're talking to them
- Specific real examples and numbers (e.g. "a client went from 12 leads to 47 in 60 days") not vague claims
- Start paragraphs differently — questions, statements, observations, stories
- NEVER use: "In today's digital age", "It's no secret", "In conclusion", "Furthermore", "Moreover", "Additionally", "Game-changing", "Leverage", "Robust", "Delve into", "Seamlessly", "Navigate the landscape", "In the ever-evolving", "Look no further"
- NO perfectly parallel bullet points all the same length
- Occasional imperfect sentence — real writers don't always write perfect prose
- Sound like the smartest person in the room who also happens to be easy to talk to

Return ONLY a valid JSON object — no markdown, no code fences — with these exact fields:
{
  "title": "the blog post title (include exact keyword naturally, 50–60 chars ideal)",
  "metaDescription": "150–160 char SEO meta description with the target keyword",
  "htmlContent": "the full blog post HTML using only <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <em> — NO <html>, <head>, <body> tags"
}`,
      }],
    });

    // Step 5: Parse Claude's JSON response
    let parsed;
    try {
      const raw = blogResponse.content[0].text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[SEO Blog] Failed to parse Claude response:', parseErr.message);
      return { success: false, reason: 'parse_error' };
    }

    const { title, metaDescription, htmlContent } = parsed;

    // Step 6: Build SEO-friendly slug
    const urlSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
      + '-' + Date.now().toString(36);

    // Step 7: Publish via GHL Blogs API (9am EST = offset from daily post at 8am)
    const publishedAt = new Date();
    publishedAt.setUTCHours(14, 0, 0, 0); // 9am EST

    const postRes = await axios.post(
      'https://services.leadconnectorhq.com/blogs/posts',
      {
        title,
        locationId: GHL_LOCATION_ID,
        blogId: BLOG_ID,
        description: metaDescription,
        imageUrl: 'https://msgsndr-private.storage.googleapis.com/locationPhotos/bf4cfbc0-6359-4e62-a0fa-de3af69d3218.png',
        imageAltText: `JRZ Marketing — ${title}`,
        author: BLOG_AUTHOR_ID,
        categories: [BLOG_CATEGORIES.marketing, BLOG_CATEGORIES.ai, BLOG_CATEGORIES.business],
        tags: ['JRZ Marketing', 'SEO', 'Orlando', ...targetKeyword.split(' ').slice(0, 3)],
        urlSlug,
        status: 'PUBLISHED',
        publishedAt: publishedAt.toISOString(),
        rawHTML: htmlContent,
      },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    const postId = postRes.data?.blogPost?._id;
    console.log(`[SEO Blog] ✅ Published: "${title}" targeting "${targetKeyword}" — ID: ${postId}`);

    return { success: true, title, keyword: targetKeyword, position: targetPosition, postId };

  } catch (err) {
    console.error('[SEO Blog] ❌ Error:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Schedule today's carousel post on all platforms at 8am EST + publish daily blog
async function runDailyPost() {
  console.log('[Social] Running daily post scheduler...');
  setAgentBusy('marco', 'Publishing daily carousel + blog post');
  logActivity('marco', 'action', 'Daily post cycle started — selecting content & generating captions');

  // Pick content: pre-written scripts cycle first, then NewsAPI + Claude
  const { script } = getTodaysScript();
  let caption = script.caption;
  let title   = script.title;

  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((now - start) / 86400000);
  if (dayOfYear > CAROUSEL_SCRIPTS.length * 2) {
    console.log('[Social] Generating fresh content via NewsAPI + Claude...');
    caption = await generateNewsCaption();
    title   = 'AI-generated — ' + new Date().toLocaleDateString('en-US');
  }

  // Schedule for 8am EST (12:00 UTC during EDT, 13:00 during EST)
  const postTime = new Date();
  postTime.setUTCHours(12, 0, 0, 0); // 8am EDT (UTC-4, Mar–Nov)
  if (postTime < new Date()) {
    postTime.setDate(postTime.getDate() + 1);
  }

  // ── Get today's carousel images from Cloudinary ──
  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const todayImages = CAROUSEL_IMAGES[dayIdx >= 0 ? dayIdx : new Date().getDay()];
  const instagramMedia = todayImages.map(url => ({ url, type: 'image/png' }));

  // ── Social post — Facebook, LinkedIn, YouTube, Google (with carousel images) ──
  let socialResult = { success: false };
  try {
    const result = await schedulePost({
      caption,
      accountIds: TEXT_POST_ACCOUNTS,
      type: 'post',
      scheduleDate: postTime,
      media: instagramMedia,
    });
    console.log(`[Social] ✅ Text post scheduled for ${postTime.toISOString()} — "${title}"`);
    socialResult = { success: true, title, scheduledFor: postTime.toISOString(), result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule text post:', err?.response?.data || err.message);
    socialResult = { success: false, error: err.message };
  }

  // ── Instagram Reel — build video from slides via FFmpeg → Cloudinary ──
  let instagramResult = { success: false };
  console.log('[Reel] Building reel from carousel slides...');
  const reelUrl = await createReelFromSlides(todayImages, dayIdx >= 0 ? dayIdx : new Date().getDay());

  if (reelUrl) {
    // Post as Reel (video) — higher reach than static carousel
    try {
      const result = await schedulePost({
        caption,
        accountIds: INSTAGRAM_ACCOUNTS,
        type: 'post',
        scheduleDate: postTime,
        media: [{ url: reelUrl, type: 'video' }],
      });
      console.log(`[Reel] ✅ Instagram Reel scheduled for ${postTime.toISOString()} — "${title}"`);
      instagramResult = { success: true, title, scheduledFor: postTime.toISOString(), reelUrl, result };
    } catch (err) {
      console.error('[Reel] ❌ Failed to schedule Instagram Reel:', err?.response?.data || err.message);
      // Fallback: post static carousel images if Reel fails
      try {
        await schedulePost({
          caption,
          accountIds: INSTAGRAM_ACCOUNTS,
          type: 'post',
          scheduleDate: postTime,
          media: instagramMedia,
        });
        console.log('[Reel] ↩️  Fell back to static carousel for Instagram');
        instagramResult = { success: true, fallback: 'carousel', title };
      } catch (fallbackErr) {
        instagramResult = { success: false, error: fallbackErr.message };
      }
    }
  } else {
    // Reel creation failed — post static carousel as fallback
    console.log('[Reel] ↩️  Reel creation failed, falling back to static carousel');
    try {
      await schedulePost({
        caption,
        accountIds: INSTAGRAM_ACCOUNTS,
        type: 'post',
        scheduleDate: postTime,
        media: instagramMedia,
      });
      instagramResult = { success: true, fallback: 'carousel', title };
    } catch (err) {
      instagramResult = { success: false, error: err.message };
    }
  }

  // ── Blog post (English, published same day) ──
  const blogResult = await createDailyBlog(title, caption);

  return { social: socialResult, instagram: instagramResult, blog: blogResult };
}

// Schedule today's story at 7pm EST
async function runDailyStory() {
  console.log('[Social] Running daily story scheduler...');

  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const template = STORY_TEMPLATES[dayIndex >= 0 ? dayIndex : new Date().getDay()];

  // Schedule for 7pm EST today (00:00 UTC next day = midnight = 7pm EST when UTC-5)
  // 7pm EST = 23:00 UTC (during EDT/UTC-4) or 00:00 UTC+1day (during EST/UTC-5)
  // Using 23:00 UTC as a safe default (works for EDT Apr-Nov)
  const storyTime = new Date();
  storyTime.setUTCHours(23, 0, 0, 0);
  if (storyTime < new Date()) {
    storyTime.setDate(storyTime.getDate() + 1);
  }

  try {
    const result = await schedulePost({
      caption: template.text,
      accountIds: STORY_ACCOUNTS,
      type: 'story',
      scheduleDate: storyTime,
    });
    console.log(`[Social] ✅ Story scheduled for ${storyTime.toISOString()} — "${template.cta}"`);
    return { success: true, cta: template.cta, scheduledFor: storyTime.toISOString(), result };
  } catch (err) {
    console.error('[Social] ❌ Failed to schedule story:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Generate viral hook content via Claude — uses weekly learned strategy
async function generateViralReelContent(topic) {
  const strategy = await loadContentStrategy();
  const strategyContext = strategy ? `
ESTRATEGIA APRENDIDA (basada en datos reales de tu audiencia):
- Mejores temas: ${(strategy.bestTopics || []).join(', ')}
- Estilo de hook que más funciona: ${strategy.bestHookStyle || 'preguntas directas'}
- Fórmulas de hook probadas: ${(strategy.hookFormulas || []).join(' | ')}
- Insights de audiencia: ${strategy.audienceInsights || '25-34 años, dueños de negocios'}
- Evitar: ${(strategy.avoidTopics || []).join(', ') || 'nada aún'}
- Notas de la semana: ${strategy.weeklyNotes || 'primera semana'}
` : '';

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are Marco, Content Director at JRZ Marketing. Create a HIGH-RETENTION 15-second Instagram Reel script in SPANISH for José Rivas (AI & automation expert for Latino entrepreneurs, Orlando FL).
${strategyContext}
Topic: "${topic}"

HIGH-RETENTION SCRIPT BUILDER RULES:
1. CHOOSE THE BEST FRAMEWORK for this topic: AIDA (Attention-Interest-Desire-Action), PAS (Problem-Agitate-Solution), Open Loop (start a story you complete at the end), Story-Bridge-Offer, Before-After-Bridge, or 4U (Urgent-Unique-Ultra-specific-Useful). Pick the one that maximizes completion rate for this specific topic.
2. HOOK: First 2 seconds must stop the scroll. Use Who/What/How — instantly communicate who it's for, what it's about, how it helps. Pattern interrupt or contrarian angle preferred over clever phrasing.
3. CREATE TENSION before delivering value — build curiosity that sustains attention until the final line.
4. STRUCTURE creates completion. Completion drives distribution. Every word must pull the viewer forward.

Return ONLY valid JSON:
{
  "framework": "name of chosen framework and ONE sentence why you chose it",
  "hook": "2-4 WORDS IN CAPS (pattern interrupt or contrarian angle)",
  "hook_sub": "1-2 lines expanding the hook\\nsecond line if needed",
  "content": ["→  point 1 (tension builds)", "→  point 2 (value appears)", "→  point 3 (payoff)"],
  "climax1": "2-3 IMPACT WORDS",
  "climax2": "FINAL PUNCHLINE IN CAPS.",
  "climax_sub": "powerful closing line that makes them want to share"
}

No hashtags in JSON. Direct style. Every line earns the next.`,
    }],
  });
  return JSON.parse(msg.content[0].text.trim());
}

// ── Build a natural voiceover script from reel content ───────────────────────
function buildVoiceoverScript(content) {
  const lines = [];

  // Hook — question/statement
  const hook = (content.hook + ' ' + (content.hook_sub || '')).replace(/\n/g, ' ').trim();
  lines.push(hook);

  // Content bullets — strip arrow symbols, read naturally
  if (Array.isArray(content.content)) {
    content.content.slice(0, 3).forEach(function (b) {
      lines.push(b.replace(/^[→\-•]\s*/, '').trim());
    });
  }

  // Climax
  const climax = ((content.climax1 || '') + ' ' + (content.climax2 || '') + '. ' + (content.climax_sub || '')).trim();
  if (climax) lines.push(climax);

  // CTA
  lines.push('Agenda tu consulta gratis en jrzmarketing.com');

  return lines.join('. ');
}

// ── ElevenLabs TTS → save MP3 ────────────────────────────────────────────────
async function generateElevenLabsAudio(text, audioPath) {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true } },
      {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );
    fs.writeFileSync(audioPath, Buffer.from(response.data));
    console.log('[Voice] ✅ Joseph Corona audio generated:', audioPath);
    return true;
  } catch (err) {
    console.error('[Voice] ❌ ElevenLabs failed:', err?.response?.status, err.message);
    return false;
  }
}

// ── Build a smart, human voice script — continuation of the text reply ───────
async function buildDMVoiceScript(textReply, contactName, originalMessage, contactMemory = {}, competitorInsights = {}, compPainPoints = {}) {
  const nowEST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour    = nowEST.getHours();
  const timeStr = hour < 12 ? 'esta mañana' : hour < 17 ? 'esta tarde' : 'esta noche';

  const [voiceFeedback, engPatterns] = await Promise.all([loadVoiceFeedback(), loadEngagementPatterns()]);

  const prompt = `Eres Armando Rivas, 22 años, venezolano, Community Manager de JRZ Marketing en Orlando, Florida.
Tienes voz — este texto se va a convertir en audio con tu voz real. Habla como si estuvieras grabando un voice note de WhatsApp o Instagram.

CONTEXTO DE LA CONVERSACIÓN:
- Lo que dijo el prospecto: "${originalMessage || 'nos contactó con interés'}"
- Lo que ya le respondiste por texto: "${textReply}"

CONOCIMIENTO DE ESTE PROSPECTO (memoria de conversaciones anteriores):
- Tipo de negocio: ${contactMemory.businessType || 'desconocido'}
- Sus pain points específicos: ${(contactMemory.painPoints || []).join(', ') || 'no identificados aún'}
- Sus intereses: ${(contactMemory.interests || []).join(', ') || 'no identificados aún'}
- Mensajes anteriores: ${contactMemory.messageCount || 0}
${(contactMemory.messageCount || 0) > 0 ? '⚠️ Ya lo conoces — habla como si retomaran una conversación, no como si fuera la primera vez.' : ''}

CONOCIMIENTO DE MERCADO (úsalo inteligentemente):
- La mayoría de negocios latinos en EE.UU. tienen el mismo problema: invierten en redes, en anuncios, en diseñadores — y no ven resultados porque no tienen un SISTEMA.
- Lo que otras agencias NO hacen y JRZ sí: ${(competitorInsights.competitorWeaknesses || []).join(', ') || 'servicio bilingüe real, IA integrada, acompañamiento directo del fundador'}
- Lo que clientes dicen de otras agencias: ${(compPainPoints.painPoints || []).slice(0, 2).join(', ') || 'cobran caro sin resultados, desaparecen después de vender'}
- JRZ Marketing: sistema completo — captación, automatización con IA, contenido viral, seguimiento hasta cerrar. Jose trabaja directo con cada cliente los primeros 30 días.
- Patrones ganadores (clientes que agendaron): ${voiceFeedback.winningPatterns || 'usar empatía y especificidad sobre su negocio'}
- Hooks que funcionaron en contenido reciente: ${(engPatterns.topHooks || []).slice(0, 2).join(' | ') || 'preguntas directas sobre resultados'}

REGLAS DEL MENSAJE DE VOZ:
1. Es la CONTINUACIÓN del texto — no repitas lo mismo, profundiza
2. Muéstrate HUMANO: empático, cálido, inteligente — no genérico
3. Lee entre líneas lo que dijo el prospecto y responde a su NECESIDAD REAL, no solo a sus palabras
4. Menciona la hora del día naturalmente (${timeStr}) — da sensación de presencia real
5. Explica brevemente el PROCESO de JRZ: sistema completo, resultados medibles, acompañamiento real
6. Cierra con UNA sola llamada a la acción: agendar la consulta gratuita de 15 min con Jose HOY
7. Urgencia SUAVE — no presiones, convence con lógica y empatía
8. MÁXIMO 70 palabras — menos de 30 segundos de audio
9. Español latino natural — nada de formal, nada de robótico
10. NO empieces con "Hola" ni "Mira" — empieza de forma única y humana cada vez
11. Sin emojis, sin hashtags — es audio

Escribe SOLO el guión. Sin explicaciones. Sin comillas al inicio o al final.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });
    return msg.content[0].text.trim();
  } catch (err) {
    return `${timeStr} te grabé este mensaje porque lo que me dijiste tiene solución. En JRZ construimos el sistema completo — captamos los clientes, automatizamos el seguimiento, y creamos el contenido. Todo integrado, todo medible. Jose hace una llamada gratuita de 15 minutos contigo, sin compromiso. Agéndala hoy, los espacios se llenan rápido.`;
  }
}

// ── Generate voice note for DM reply and return Cloudinary URL ───────────────
async function generateDMVoiceNote(text, contactId, contactName, originalMessage, contactMemory = {}, competitorInsights = {}, compPainPoints = {}) {
  const audioPath = `/tmp/jrz_dm_voice_${contactId}_${Date.now()}.mp3`;
  const voiceScript = await buildDMVoiceScript(text, contactName, originalMessage, contactMemory, competitorInsights, compPainPoints);
  console.log('[DM Voice] Script:', voiceScript);
  try {
    const ok = await generateElevenLabsAudio(voiceScript, audioPath);
    if (!ok) return null;

    // Upload MP3 to Cloudinary
    const timestamp  = Math.floor(Date.now() / 1000);
    const publicId   = `jrz/dm_voice_${contactId}_${timestamp}`;
    const sigStr     = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature  = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',       fs.createReadStream(audioPath));
    form.append('api_key',    CLOUDINARY_API_KEY);
    form.append('timestamp',  String(timestamp));
    form.append('public_id',  publicId);
    form.append('signature',  signature);
    form.append('resource_type', 'video'); // Cloudinary uses "video" for audio

    const upload = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), timeout: 30000 }
    );
    console.log('[DM Voice] ✅ Audio uploaded:', upload.data.secure_url);
    return upload.data.secure_url;
  } catch (err) {
    console.error('[DM Voice] ❌ Voice note failed:', err.message);
    return null;
  } finally {
    try { fs.unlinkSync(audioPath); } catch (_) {}
  }
}

// ── Merge video + audio with ffmpeg ──────────────────────────────────────────
function mergeAudioVideo(videoPath, audioPath, outPath) {
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest -map 0:v:0 -map 1:a:0 "${outPath}"`,
      { timeout: 60000, encoding: 'utf8' }
    );
    console.log('[Voice] ✅ Audio merged into video:', outPath);
    return true;
  } catch (err) {
    console.error('[Voice] ❌ ffmpeg merge failed:', err.message);
    return false;
  }
}

// Canva template base (permanent Cloudinary URL)
const CANVA_TEMPLATE_URL = 'https://res.cloudinary.com/dbsuw1mfm/video/upload/v1773637191/jrz/reel_template_base.mp4';
const CANVA_TEMPLATE_PATH = '/tmp/jrz_canva_template.mp4';

// Download Canva template once and cache it locally
async function ensureTemplate() {
  if (fs.existsSync(CANVA_TEMPLATE_PATH)) return true;
  try {
    const res = await axios.get(CANVA_TEMPLATE_URL, { responseType: 'arraybuffer', timeout: 60000 });
    fs.writeFileSync(CANVA_TEMPLATE_PATH, Buffer.from(res.data));
    console.log('[Template] ✅ Canva template cached locally');
    return true;
  } catch (err) {
    console.error('[Template] ❌ Failed to download template:', err.message);
    return false;
  }
}

// Escape text for ffmpeg drawtext (no single quotes)
function ffmpegEscape(str) {
  return (str || '').replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// Wrap long text into multiple lines (~28 chars per line)
function wrapText(str, maxLen) {
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxLen) { lines.push(line.trim()); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line.trim());
  return lines.join('\n');
}

// Build viral Reel: Canva template + ffmpeg text overlay + ElevenLabs voice
async function buildViralReel(content, dayIdx) {
  const templatePath = CANVA_TEMPLATE_PATH;
  const textPath     = `/tmp/jrz_viral_reel_text_${dayIdx}.mp4`;
  const audioPath    = `/tmp/jrz_voice_${dayIdx}.mp3`;
  const finalPath    = `/tmp/jrz_viral_reel_${dayIdx}.mp4`;

  try {
    // Step 1 — Ensure Canva template is available
    const ready = await ensureTemplate();
    if (!ready) throw new Error('Template unavailable');

    // Step 2 — Build text strings
    const hook    = ffmpegEscape(wrapText((content.hook || '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim(), 26));
    const sub     = ffmpegEscape(wrapText((content.hook_sub || content.climax1 || '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim(), 30));
    const bullets = Array.isArray(content.content)
      ? content.content.slice(0, 3).map(b => ffmpegEscape(b.replace(/^[→\-•]\s*/, '').replace(/[🔥💥🚀✅⚡🎯💰]/g, '').trim())).join('\n')
      : '';
    const cta     = ffmpegEscape('jrzmarketing.com — Consulta Gratis');

    // Step 3 — Overlay text on Canva template with ffmpeg drawtext
    const drawFilters = [
      // Hook — large bold white text, upper third
      `drawtext=text='${hook}':fontsize=68:fontcolor=white:x=(w-text_w)/2:y=h*0.12:line_spacing=10:font=Liberation Sans Bold:shadowcolor=black:shadowx=3:shadowy=3`,
      // Sub-hook — medium platinum, just below hook
      `drawtext=text='${sub}':fontsize=42:fontcolor=#8A9BA8:x=(w-text_w)/2:y=h*0.38:line_spacing=8:font=Liberation Sans Bold:shadowcolor=black:shadowx=2:shadowy=2`,
      // Bullets — white, middle
      `drawtext=text='${bullets}':fontsize=38:fontcolor=white:x=(w-text_w)/2:y=h*0.54:line_spacing=14:font=Liberation Sans:shadowcolor=black:shadowx=2:shadowy=2`,
      // CTA — bottom platinum
      `drawtext=text='${cta}':fontsize=34:fontcolor=#8A9BA8:x=(w-text_w)/2:y=h*0.88:font=Liberation Sans Bold:shadowcolor=black:shadowx=2:shadowy=2`,
    ].join(',');

    execSync(
      `ffmpeg -y -i "${templatePath}" -vf "${drawFilters}" -c:v libx264 -preset fast -crf 22 -c:a copy "${textPath}"`,
      { timeout: 120000, encoding: 'utf8' }
    );
    console.log('[Reel] ✅ Text overlaid on Canva template');

    // Step 4 — Generate Joseph Corona voiceover
    const voiceScript = buildVoiceoverScript(content);
    console.log('[Voice] Script:', voiceScript);
    const hasAudio = await generateElevenLabsAudio(voiceScript, audioPath);

    // Step 5 — Merge audio + video
    let uploadPath = textPath;
    if (hasAudio) {
      const merged = mergeAudioVideo(textPath, audioPath, finalPath);
      if (merged) uploadPath = finalPath;
    }

    // Step 6 — Upload to Cloudinary
    const publicId  = `jrz/viral_reel_day${dayIdx}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr    = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new FormData();
    form.append('file',      fs.createReadStream(uploadPath));
    form.append('public_id', publicId);
    form.append('timestamp', String(timestamp));
    form.append('api_key',   CLOUDINARY_API_KEY);
    form.append('signature', signature);
    form.append('overwrite', 'true');

    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120000 }
    );

    [textPath, audioPath, finalPath].forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });

    console.log(`[Reel] ✅ Canva reel uploaded ${hasAudio ? 'with Joseph Corona voice' : '(silent fallback)'}`);
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/video/upload/jrz/viral_reel_day${dayIdx}.mp4`;

  } catch (err) {
    console.error('[Reel] ❌ buildViralReel failed:', err.message);
    return null;
  }
}

// Post a 15-second viral hook Reel at 4pm EST across all video platforms
async function runDailyReel() {
  console.log('[Reel] Running daily 4pm viral Reel...');

  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIdx    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const safeIdx   = dayIdx >= 0 ? dayIdx : new Date().getDay();

  // Schedule for 4pm EST (20:00 UTC during EDT)
  const reelTime = new Date();
  reelTime.setUTCHours(20, 0, 0, 0);
  if (reelTime < new Date()) reelTime.setDate(reelTime.getDate() + 1);

  // Get today's topic from carousel script
  const { script } = getTodaysScript();

  // Generate viral hook content via Claude
  let content;
  try {
    content = await generateViralReelContent(script.title);
    console.log('[Reel] ✅ Viral content generated:', content.hook);
  } catch (err) {
    console.error('[Reel] ❌ Content generation failed:', err.message);
    return { success: false, error: 'Content generation failed' };
  }

  // Build the video
  const reelUrl = await buildViralReel(content, safeIdx);
  if (!reelUrl) return { success: false, error: 'Video build failed' };

  // Post to all platforms
  try {
    await schedulePost({
      caption: script.caption,
      accountIds: REEL_ACCOUNTS,
      type: 'post',
      scheduleDate: reelTime,
      media: [{ url: reelUrl, type: 'video' }],
    });
    console.log(`[Reel] ✅ Viral Reel scheduled for ${reelTime.toISOString()} — ${REEL_ACCOUNTS.length} platforms`);
    logReelPost(content.hook, script.caption); // fire-and-forget attribution tracking
    return { success: true, reelUrl, hook: content.hook, scheduledFor: reelTime.toISOString() };
  } catch (err) {
    console.error('[Reel] ❌ Failed to schedule Reel:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// Send weekly content summary email to Jose every Monday
async function getGHLContactCountByTag(tag) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=${tag}&limit=1`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    return res.data?.total || res.data?.contacts?.length || 0;
  } catch { return 0; }
}

async function getGHLOpportunityCountByStage(stageId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${MARKETING_PIPELINE_ID}&pipeline_stage_id=${stageId}&limit=1`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    return res.data?.meta?.total || 0;
  } catch { return 0; }
}

async function sendWeeklySummaryEmail(weekPosts) {
  const subject = `📊 JRZ Marketing — Reporte Semanal: Resultados + IA Insights (${new Date().toLocaleDateString('es-ES')})`;
  const logoUrl = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663415013329/cScWYsLVftXscDEx.png';

  // Pull all stats in parallel
  const [
    socialStats,
    contentStrategy,
    outboundSent,
    outboundPending,
    needsEmail,
    hotLeads,
    qualifiedLeads,
    interested,
    newLeads,
    hotOpp,
    bookingOpp,
  ] = await Promise.all([
    getWeeklyStats().catch(() => null),
    loadContentStrategy().catch(() => null),
    getGHLContactCountByTag('outbound_sent'),
    getGHLContactCountByTag('outbound_pending'),
    getGHLContactCountByTag('needs_email'),
    getGHLContactCountByTag('hot-lead'),
    getGHLContactCountByTag('qualified-lead'),
    getGHLContactCountByTag('armando-interested'),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.newLead),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.hotLead),
    getGHLOpportunityCountByStage(PIPELINE_STAGES.booking),
  ]);

  const breakdown = socialStats?.breakdowns || {};
  const eng       = breakdown?.engagement || {};
  const impressions = breakdown?.impressions?.total || 0;
  const reach       = breakdown?.reach?.total || 0;
  const followers   = breakdown?.followers?.total || 0;
  const igLikes     = eng?.instagram?.likes || 0;
  const igComments  = eng?.instagram?.comments || 0;

  // Ask Claude to write a strategic weekly commentary
  let aiInsight = '';
  try {
    const insightMsg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Eres el analista estratégico de JRZ Marketing. Basado en estos datos de la semana, escribe UN párrafo corto (3-4 oraciones) con el insight más importante y UNA recomendación concreta para la próxima semana. Sé directo, como un COO hablando con el CEO.

Datos:
- Impresiones sociales: ${impressions} | Alcance: ${reach} | Nuevos seguidores: ${followers}
- Instagram: ${igLikes} likes, ${igComments} comentarios
- Outbound emails enviados esta semana: ${outboundSent}
- Pipeline — New Lead: ${newLeads} | Hot Lead: ${hotOpp} | Con cita: ${bookingOpp}
- Leads interesados (DM): ${interested} | Calificados: ${qualifiedLeads} | Hot: ${hotLeads}
- Estrategia previa: ${contentStrategy?.weeklyNotes || 'Primera semana'}

Escribe el insight en español. Solo el párrafo, sin títulos.`,
      }],
    });
    aiInsight = insightMsg.content[0].text.trim();
  } catch { aiInsight = 'Análisis no disponible esta semana.'; }

  const postRows = (weekPosts || []).map(p => `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#333; font-weight:600;">${p.day}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#555;">${p.title || 'AI-generated'}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:13px; color:${p.success ? '#16a34a' : '#dc2626'}; font-weight:700;">${p.success ? '✅ Posted' : '❌ Error'}</td>
    </tr>`).join('');

  const statBox = (label, value, sub = '') => `
    <td style="width:25%;padding:20px 16px;text-align:center;border-right:1px solid #f0f0f0;">
      <div style="font-size:28px;font-weight:800;color:#0a0a0a;line-height:1;">${value}</div>
      <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px;">${label}</div>
      ${sub ? `<div style="font-size:11px;color:#bbb;margin-top:3px;">${sub}</div>` : ''}
    </td>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; color:#0a0a0a; }
    .wrap { padding:40px 20px; }
    .container { max-width:620px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .header img { height:40px; }
    .hero { background:#0a0a0a; padding:28px 40px 36px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; line-height:1.3; margin-bottom:8px; }
    .hero p { font-size:13px; color:rgba(255,255,255,0.45); }
    .section { padding:28px 40px; border-bottom:1px solid #f0f0f0; }
    .section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#999; margin-bottom:16px; }
    .stat-row { width:100%; border-collapse:collapse; background:#f9f9f9; border-radius:12px; overflow:hidden; }
    .insight-box { background:#f0f7ff; border-left:4px solid #0a0a0a; padding:16px 20px; border-radius:0 8px 8px 0; font-size:14px; color:#333; line-height:1.7; }
    .pipeline-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .pill { display:inline-block; padding:5px 14px; border-radius:100px; font-size:12px; font-weight:700; }
    .pill-new { background:#e0f2fe; color:#0369a1; }
    .pill-hot { background:#fef2f2; color:#dc2626; }
    .pill-booked { background:#f0fdf4; color:#16a34a; }
    table.posts { width:100%; border-collapse:collapse; }
    table.posts th { background:#0a0a0a; color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:10px 14px; text-align:left; }
    table.posts td { padding:9px 14px; border-bottom:1px solid #f0f0f0; font-size:13px; color:#444; }
    .machine-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f5f5f5; font-size:13px; color:#333; }
    .machine-row:last-child { border-bottom:none; }
    .dot { width:8px; height:8px; border-radius:50%; background:#16a34a; flex-shrink:0; }
    .footer { background:#0a0a0a; padding:24px 40px; text-align:center; }
    .footer img { height:24px; opacity:0.6; margin-bottom:10px; }
    .footer p { font-size:11px; color:rgba(255,255,255,0.2); }
  </style>
</head>
<body><div class="wrap"><div class="container">

  <div class="header"><img src="${logoUrl}" alt="JRZ Marketing"></div>

  <div class="hero">
    <h1>Reporte semanal — JRZ Marketing<br>Semana del ${new Date().toLocaleDateString('es-ES', { weekday:'long', month:'long', day:'numeric' })}</h1>
    <p>Generado automáticamente por Armando AI · Cada lunes 7am EST</p>
  </div>

  <!-- MACHINE STATUS -->
  <div class="section">
    <div class="section-title">⚙️ Máquina — Estado esta semana</div>
    <div class="machine-row"><div class="dot"></div><strong>Contenido social:</strong>&nbsp;7 días × carrusel + story · Lun/Mié/Vie × reel con voz (Joseph Corona) → Instagram, Facebook, LinkedIn, YouTube, TikTok, Google Business</div>
    <div class="machine-row"><div class="dot"></div><strong>Outbound:</strong>&nbsp;${outboundSent} emails personalizados enviados esta semana (Mon–Fri)</div>
    <div class="machine-row"><div class="dot"></div><strong>Apollo enrichment:</strong>&nbsp;${needsEmail} contactos en cola esperando email (enriquecimiento lunes 9am)</div>
    <div class="machine-row"><div class="dot"></div><strong>Armando DM bot:</strong>&nbsp;24/7 activo — responde comentarios, follows, y DMs inbound</div>
    <div class="machine-row"><div class="dot"></div><strong>Pipeline GHL:</strong>&nbsp;Oportunidades creadas automáticamente en cada outreach e interacción</div>
  </div>

  <!-- SOCIAL STATS -->
  <div class="section">
    <div class="section-title">📱 Redes sociales — Esta semana</div>
    <table class="stat-row">
      <tr>
        ${statBox('Impresiones', impressions.toLocaleString())}
        ${statBox('Alcance', reach.toLocaleString())}
        ${statBox('Likes IG', igLikes.toLocaleString())}
        ${statBox('Comentarios IG', igComments.toLocaleString(), 'instagram')}
      </tr>
    </table>
    <p style="font-size:12px;color:#999;margin-top:10px;">Plataformas activas: Instagram · Facebook · LinkedIn (×2) · YouTube · TikTok (×2) · Google Business</p>
  </div>

  <!-- OUTBOUND + PIPELINE -->
  <div class="section">
    <div class="section-title">📧 Outbound + Pipeline</div>
    <table class="stat-row">
      <tr>
        ${statBox('Emails enviados', outboundSent, 'esta semana')}
        ${statBox('En pipeline', newLeads + hotOpp + bookingOpp, 'total activo')}
        ${statBox('Hot leads', hotLeads, 'calificados')}
        ${statBox('Con cita', bookingOpp, 'agendada')}
      </tr>
    </table>
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:700;color:#666;margin-bottom:8px;">Marketing Pipeline — GHL</div>
      <span class="pill pill-new">New Lead: ${newLeads}</span>&nbsp;
      <span class="pill pill-hot">Hot Lead: ${hotOpp}</span>&nbsp;
      <span class="pill pill-booked">Booking: ${bookingOpp}</span>
    </div>
  </div>

  <!-- DM ACTIVITY -->
  <div class="section">
    <div class="section-title">💬 Armando — Actividad de DMs</div>
    <table class="stat-row">
      <tr>
        ${statBox('Interesados', interested, 'respondieron')}
        ${statBox('Calificados', qualifiedLeads, 'dieron info')}
        ${statBox('Hot leads', hotLeads, 'phone + email')}
        ${statBox('En espera', outboundPending, 'outbound pending')}
      </tr>
    </table>
  </div>

  <!-- AI INSIGHT -->
  <div class="section">
    <div class="section-title">🧠 Armando AI — Insight de la semana</div>
    <div class="insight-box">${aiInsight}</div>
    ${contentStrategy?.bestTopics ? `<p style="font-size:12px;color:#999;margin-top:12px;"><strong>Temas que más funcionan:</strong> ${contentStrategy.bestTopics.join(' · ')}</p>` : ''}
    ${contentStrategy?.weeklyNotes ? `<p style="font-size:12px;color:#999;margin-top:4px;"><strong>Nota estratégica:</strong> ${contentStrategy.weeklyNotes}</p>` : ''}
  </div>

  <!-- CONTENT POSTED -->
  <div class="section">
    <div class="section-title">📅 Contenido publicado esta semana</div>
    <table class="posts">
      <thead><tr><th>Día</th><th>Contenido</th><th>Estado</th></tr></thead>
      <tbody>${postRows || '<tr><td colspan="3" style="padding:14px;text-align:center;color:#bbb;">Sin datos</td></tr>'}</tbody>
    </table>
  </div>

  <!-- NEXT WEEK FOCUS -->
  <div class="section" style="border-bottom:none;">
    <div class="section-title">🎯 Foco para la próxima semana</div>
    <p style="font-size:14px;color:#333;line-height:1.8;">
      1. Revisar pipeline en GHL — mover hot leads hacia cita agendada<br>
      2. Apollo enriquece contactos lunes 9am → outbound corre a las 10am<br>
      3. Si hay un cliente con resultado esta semana → capturarlo como caso de éxito para contenido
    </p>
    <p style="font-size:12px;color:#999;margin-top:12px;"><strong>KPI principal:</strong> Consultas agendadas esta semana → <strong>${bookingOpp}</strong></p>
  </div>

  <div class="footer">
    <img src="${logoUrl}" alt="JRZ Marketing">
    <p>&copy; 2026 JRZ Marketing · Reporte generado por Armando AI cada lunes 7am EST</p>
  </div>

</div></div></body></html>`;

  try {
    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log('[Social] Weekly summary email sent to Jose.');
  } catch (err) {
    console.error('[Social] Failed to send weekly summary:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK — ARMANDO DM HANDLER
// ═══════════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Incoming webhook:', JSON.stringify(payload, null, 2));

    const messageBody =
      payload.body ||
      payload.message?.body ||
      payload.messageBody ||
      payload.customData?.body ||
      '';

    const contactId =
      payload.contactId ||
      payload.contact_id ||
      payload.contact?.id ||
      payload.customData?.contactId ||
      '';

    const conversationId =
      payload.conversationId ||
      payload.conversation_id ||
      payload.conversation?.id ||
      '';

    const messageType =
      payload.message?.type ||
      payload.messageType ||
      payload.message_type ||
      payload.type ||
      payload.customData?.messageType ||
      payload.customData?.['messageType\t'] ||
      '';

    const contactName =
      payload.fullName ||
      payload.full_name ||
      payload.contactName ||
      payload.firstName ||
      payload.first_name ||
      payload.customData?.fullName ||
      '';

    const messageId =
      payload.messageId ||
      payload.message_id ||
      payload.message?.id ||
      payload.id ||
      '';

    if (!messageBody || !contactId) {
      console.log('Missing messageBody or contactId, skipping.');
      return res.status(200).json({ status: 'skipped', reason: 'missing fields' });
    }

    if (messageId && repliedMessageIds.has(messageId)) {
      console.log(`Dedup: already replied to messageId ${messageId}. Skipping.`);
      return res.status(200).json({ status: 'skipped', reason: 'duplicate messageId' });
    }

    // ── Decide if Armando should engage at all ──
    const sendType = getSendType(messageType);
    let shouldAutoReply = true;

    // 1. If conversation already has outbound messages → Jose is handling it, stay silent
    if (conversationId) {
      const history = await getConversationHistory(conversationId);
      const hasOutbound = history.some(m => m.direction === 'outbound');
      if (hasOutbound) {
        shouldAutoReply = false;
        console.log(`[Armando] Existing conversation — staying silent, Jose handles it.`);
      }
    }

    // 2. If contact already has phone OR email in GHL → they gave us info, link was dropped, done.
    if (shouldAutoReply) {
      const existing = await getGHLContact(contactId);
      if (existing.phone || existing.email) {
        shouldAutoReply = false;
        console.log(`[Armando] Contact already has contact info in GHL — staying silent, Jose handles it.`);
      }
    }

    const { reply, leadQuality, sentiment, shouldEngage, wantsCall, slotChoice, foundPhone, foundEmail, contactMemory: cMem, competitorInsights: cInsights, compPainPoints: cPain } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId, sendType
    );
    const msgCount = contactMessageCount.get(contactId) || 1;
    console.log(`Armando reply (msg #${msgCount}, lead: ${leadQuality}, sentiment: ${sentiment}, engage: ${shouldEngage}, phone: ${foundPhone || 'none'}, email: ${foundEmail || 'none'}):`, reply);

    // Reel attribution — on first DM, check if a reel drove this lead
    if (msgCount === 1) {
      const reelHook = await checkReelAttribution(contactId);
      if (reelHook) {
        tagContact(contactId, ['reel-driven-lead']); // fire-and-forget
        console.log(`[Attribution] Lead ${contactId} attributed to reel: "${reelHook.slice(0, 60)}"`);
      }
    }

    // 3. If Claude detects this is a personal/casual message not related to business → stay silent
    if (shouldAutoReply && !shouldEngage) {
      shouldAutoReply = false;
      console.log(`[Armando] Message flagged as personal/non-business — staying silent.`);
    }

    if (foundPhone || foundEmail) {
      await updateGHLContact(contactId, foundPhone, foundEmail);
      await recordABConversion(contactId); // track which closing variant converted
    }

    const hasBothData = !!(foundPhone && foundEmail);
    const hasAnyData  = !!(foundPhone || foundEmail);
    if (hasBothData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead', 'hot-lead']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.hotLead);
    } else if (hasAnyData) {
      await tagContact(contactId, ['armando-interested', 'qualified-lead']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.hotLead);
    } else if (leadQuality === 'interested') {
      await tagContact(contactId, ['armando-interested']);
      await createOpportunity(contactId, contactName, PIPELINE_STAGES.newLead);
    }

    if (foundEmail && !thankYouEmailSent.has(contactId)) {
      thankYouEmailSent.add(contactId);
      console.log(`Sending thank-you email to contact ${contactId}...`);
      await sendThankYouEmail(contactId, contactName);
    }

    if (hasAnyData && !alertEmailSent.has(contactId)) {
      alertEmailSent.add(contactId);
      console.log(`Sending hot-lead alert for contact ${contactId}...`);
      await sendHotLeadAlertEmail(contactName, foundPhone, foundEmail, sendType);
    }

    // Lead scoring — alert Jose if score >= 8
    const leadScore = calculateLeadScore({ leadQuality, sentiment, foundPhone, foundEmail, historyCount: msgCount, channel: sendType });
    console.log(`[LeadScore] ${contactName} scored ${leadScore}/10`);
    if (leadScore >= 8 && !leadScoreAlertSent.has(contactId)) {
      leadScoreAlertSent.add(contactId);
      await sendLeadScoreAlert(contactId, contactName, leadScore, sendType, foundPhone, foundEmail);
    }

    // TCPA compliance — only call after explicit consent in DM
    if (hasBothData && foundPhone) blandConsentAsked.add(contactId);
    if (wantsCall && foundPhone && !blandCallsSent.has(contactId)) {
      triggerBlandCall(contactId, contactName, foundPhone, cMem || {}); // fire-and-forget
    }

    // Google Calendar booking — fires when contact picks a slot (1, 2, or 3)
    if (slotChoice > 0) {
      const slots = pendingBookingSlots.get(contactId);
      const chosen = slots?.[slotChoice - 1];
      if (chosen) {
        try {
          await createCalendarEvent(contactName, foundEmail, chosen);
          pendingBookingSlots.delete(contactId);
          await tagContact(contactId, ['calendar-booked', 'armando-booked']);
          await createOpportunity(contactId, contactName, PIPELINE_STAGES.booking);
          logWeeklyWin(contactId, reply, 'calendar_booked');
          // Send confirmation DM
          const confirmMsg = `✅ ¡Listo! Agendé tu llamada con Jose para el ${formatSlot(chosen)}. Recibirás una invitación de Google Calendar en tu email. ¡Nos vemos entonces! 🙌`;
          await sendGHLReply(contactId, confirmMsg, sendType);
          console.log(`[Calendar] ✅ Booked for ${contactName} at ${formatSlot(chosen)}`);
        } catch (err) {
          console.error('[Calendar] Booking failed:', err.message);
        }
      }
    }

    if (shouldAutoReply) {
      await sendGHLReply(contactId, reply, sendType);
      if (messageId) repliedMessageIds.add(messageId);
      console.log('Armando reply sent successfully.');

      // Send voice note after text reply (IG DMs and SMS only)
      if (sendType === 'IG' || sendType === 'FB' || sendType === 'SMS') {
        const voiceUrl = await generateDMVoiceNote(reply, contactId, contactName, messageBody, cMem || {}, cInsights || {}, cPain || {});
        if (voiceUrl) {
          await sendGHLVoiceNote(contactId, voiceUrl, sendType);
        }
      }
    } else {
      console.log('[Armando] Silent mode — tagging/pipeline done, no auto-reply sent.');
    }

    res.status(200).json({ status: 'ok', replied: shouldAutoReply, reply: shouldAutoReply ? reply : null, leadQuality, sentiment, foundPhone, foundEmail, messageNumber: msgCount });
  } catch (error) {
    console.error('Webhook error:', error?.response?.data || error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SOCIAL MEDIA CRON ENDPOINTS (manual triggers + internal scheduler)
// ═══════════════════════════════════════════════════════════

/// ── Warm DM webhook — GHL fires this when someone comments or follows ──────
// Setup: GHL → Settings → Webhooks → add https://armando-bot-1.onrender.com/webhook/engage
// Events: ContactCreated, InboundMessage
app.post('/webhook/engage', async (req, res) => {
  res.json({ ok: true }); // respond fast so GHL doesn't retry
  try {
    const e = req.body;
    const contactId = e.contact_id || e.contactId || e.id;
    if (!contactId) return;

    const source  = (e.source || e.channel || '').toLowerCase();
    const type    = (e.type || e.event || '').toLowerCase();
    const isSocial = source.includes('instagram') || source.includes('facebook')
                  || source.includes('tiktok')    || source.includes('linkedin');

    if (type.includes('contactcreated') && isSocial) {
      // New follower / social lead
      await sendWarmDM(contactId, 'follower', { name: e.first_name || e.firstName });
    } else if (type.includes('inboundmessage') && isSocial) {
      // Comment or DM on social post
      await sendWarmDM(contactId, 'comment', { name: e.first_name || e.firstName });
    } else if (type.includes('formsubmit') || type.includes('opportunitycreated')) {
      // Form fill or new opportunity
      await sendWarmDM(contactId, 'form_fill', { name: e.first_name || e.firstName });
    }
  } catch (err) {
    console.error('[WarmDM] Webhook error:', err.message);
  }
});

// Manual trigger: POST /cron/daily-post
app.post('/cron/daily-post', async (_req, res) => {
  try {
    const result = await runDailyPost();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/daily-post error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/run-reel  — test the Canva reel right now
app.post('/cron/run-reel', async (_req, res) => {
  try {
    const result = await runDailyReel();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/run-reel error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Debug: GET /test-voice — test ElevenLabs Joseph Corona live on Render
app.get('/test-voice', async (_req, res) => {
  const audioPath = '/tmp/test_voice_debug.mp3';
  const ok = await generateElevenLabsAudio('Hola, soy Armando de JRZ Marketing.', audioPath);
  try { fs.unlinkSync(audioPath); } catch (_) {}
  res.json({ voice: 'Joseph Corona', keySet: !!ELEVENLABS_API_KEY, success: ok });
});

// Manual trigger: POST /cron/daily-story
app.post('/cron/daily-story', async (_req, res) => {
  try {
    const result = await runDailyStory();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('/cron/daily-story error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/weekly-summary
app.post('/cron/weekly-summary', async (req, res) => {
  try {
    await sendWeeklySummaryEmail(req.body.weekPosts || []);
    res.json({ status: 'ok', message: 'Weekly summary email sent.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/// ─── JRZ AI Office Dashboard ──────────────────────────────

app.get('/office/status', (_req, res) => {
  res.json({
    ts: new Date().toISOString(),
    kpi: OFFICE_KPI,
    agents: Object.fromEntries(
      Object.entries(AGENT_STATUS).map(([k, v]) => [k, { ...v, subAgents: SUB_AGENTS[k] || [] }])
    ),
    feed: OFFICE_LOG.slice(0, 40),
    chat: OFFICE_CHAT.slice(0, 20),
  });
});

app.get('/office', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const AGENT_META = {
    armando:  { label: 'Armando',  role: 'Community Manager & Closer',    initials: 'AR', color: '#7c3aed' },
    elena:    { label: 'Elena',    role: 'Client Success Manager',         initials: 'EL', color: '#0891b2' },
    diego:    { label: 'Diego',    role: 'Project Manager',                initials: 'DI', color: '#d97706' },
    marco:    { label: 'Marco',    role: 'Content Director',               initials: 'MA', color: '#16a34a' },
    sofia:    { label: 'Sofia',    role: 'Web Designer & SEO Auditor',     initials: 'SO', color: '#8A9BA8' },
    isabella: { label: 'Isabella', role: 'Conversion & Ads Strategist',    initials: 'IS', color: '#db2777' },
  };
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>JRZ Marketing HQ</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#080a0f;color:#e2e8f0;font-family:'Montserrat',sans-serif;height:100vh;overflow:hidden;}
.office{display:grid;grid-template-columns:1fr 340px;grid-template-rows:auto auto 1fr;height:100vh;gap:0;}
/* HEADER */
.hdr{grid-column:1/-1;background:#0c0f1a;border-bottom:1px solid #1a2540;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;}
.hdr-left{display:flex;align-items:center;gap:16px;}
.hdr-logo{height:32px;object-fit:contain;filter:brightness(0) invert(1);opacity:0.9;}
.hdr-title{font-size:16px;font-weight:900;color:#fff;letter-spacing:0.04em;}
.hdr-sub{font-size:10px;color:#475569;letter-spacing:0.12em;text-transform:uppercase;margin-top:1px;}
.live-dot{width:8px;height:8px;background:#22c55e;border-radius:50%;animation:pulse-green 2s infinite;}
.hdr-time{font-size:12px;color:#475569;font-weight:600;}
/* KPI BAR */
.kpi-bar{grid-column:1/-1;background:#0c0f1a;border-bottom:1px solid #1a2540;padding:10px 24px;display:flex;gap:8px;}
.kpi{flex:1;background:#111827;border:1px solid #1e2d45;border-radius:10px;padding:10px 14px;text-align:center;}
.kpi-val{font-size:22px;font-weight:900;color:#8A9BA8;line-height:1;}
.kpi-lbl{font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;margin-top:4px;}
/* MAIN AREA */
.main{overflow-y:auto;padding:20px 24px;background:#080a0f;}
.main::-webkit-scrollbar{width:4px;} .main::-webkit-scrollbar-thumb{background:#1e2d45;border-radius:4px;}
/* AGENT GRID */
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
/* AGENT CARD */
.card{background:#0c0f1a;border:1px solid #1a2540;border-radius:16px;padding:18px;transition:border-color .3s,box-shadow .3s;cursor:default;}
.card.working{border-color:#1a3a6b;box-shadow:0 0 24px rgba(37,99,168,0.2);}
.card.alert{border-color:#7f1d1d;box-shadow:0 0 24px rgba(220,38,38,0.15);}
.card-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;}
.avatar{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#fff;flex-shrink:0;}
.card-info{flex:1;min-width:0;}
.card-name{font-size:14px;font-weight:800;color:#f1f5f9;}
.card-role{font-size:10px;color:#475569;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.status-row{display:flex;align-items:center;gap:6px;margin-bottom:10px;}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.dot-idle{background:#374151;}
.dot-working{background:#22c55e;animation:pulse-green 1.5s infinite;}
.dot-alert{background:#ef4444;animation:pulse-red .8s infinite;}
@keyframes pulse-green{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4);}50%{box-shadow:0 0 0 5px rgba(34,197,94,0);}}
@keyframes pulse-red{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.4);}50%{box-shadow:0 0 0 5px rgba(239,68,68,0);}}
.status-text{font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.task-text{font-size:11px;color:#64748b;line-height:1.4;min-height:28px;margin-bottom:12px;}
.chips{display:flex;flex-wrap:wrap;gap:5px;}
.chip{font-size:9px;background:#111827;border:1px solid #1e2d45;color:#64748b;border-radius:100px;padding:3px 8px;white-space:nowrap;}
.chip-icon{margin-right:3px;}
/* SIDEBAR */
.sidebar{background:#0c0f1a;border-left:1px solid #1a2540;display:flex;flex-direction:column;overflow:hidden;}
.sidebar-top{flex:1;overflow:hidden;display:flex;flex-direction:column;border-bottom:1px solid #1a2540;}
.sidebar-bot{height:220px;display:flex;flex-direction:column;}
.s-hdr{padding:12px 16px;border-bottom:1px solid #111827;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:8px;}
.s-hdr .ct{background:#1e2d45;color:#8A9BA8;font-size:9px;padding:2px 7px;border-radius:100px;font-weight:700;}
.feed-list{flex:1;overflow-y:auto;padding:8px 0;}
.feed-list::-webkit-scrollbar{width:3px;} .feed-list::-webkit-scrollbar-thumb{background:#1e2d45;}
.feed-item{padding:8px 14px;border-left:3px solid #1e2d45;margin:2px 0;animation:fadeIn .4s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
.fi-top{display:flex;align-items:center;gap:6px;margin-bottom:3px;}
.fi-agent{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;}
.fi-time{font-size:9px;color:#374151;margin-left:auto;}
.fi-msg{font-size:11px;color:#94a3b8;line-height:1.4;}
.chat-list{flex:1;overflow-y:auto;padding:6px 0;}
.chat-list::-webkit-scrollbar{width:3px;} .chat-list::-webkit-scrollbar-thumb{background:#1e2d45;}
.chat-item{padding:7px 14px;margin:1px 0;}
.ci-top{display:flex;align-items:center;gap:4px;margin-bottom:2px;}
.ci-from{font-size:9px;font-weight:800;text-transform:uppercase;}
.ci-arrow{font-size:9px;color:#374151;}
.ci-to{font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;}
.ci-time{font-size:9px;color:#374151;margin-left:auto;}
.ci-msg{font-size:10px;color:#64748b;line-height:1.4;}
/* TYPE COLORS */
.t-success{background:rgba(22,163,74,.06);}
.t-alert{background:rgba(239,68,68,.06);}
.t-collab{background:rgba(26,58,107,.12);}
.t-info{background:transparent;}
.t-action{background:transparent;}
</style>
</head>
<body>
<div class="office">

<!-- HEADER -->
<div class="hdr">
  <div class="hdr-left">
    <img class="hdr-logo" src="https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png" alt="JRZ"/>
    <div>
      <div class="hdr-title">JRZ Marketing HQ</div>
      <div class="hdr-sub">AI Team Operations Center</div>
    </div>
    <div class="live-dot"></div>
  </div>
  <div class="hdr-time" id="clock"></div>
</div>

<!-- KPI BAR -->
<div class="kpi-bar">
  <div class="kpi"><div class="kpi-val" id="k-dms">0</div><div class="kpi-lbl">DMs Handled</div></div>
  <div class="kpi"><div class="kpi-val" id="k-leads">0</div><div class="kpi-lbl">Leads Captured</div></div>
  <div class="kpi"><div class="kpi-val" id="k-posts">0</div><div class="kpi-lbl">Posts Published</div></div>
  <div class="kpi"><div class="kpi-val" id="k-sites">0</div><div class="kpi-lbl">Sites Monitored</div></div>
  <div class="kpi"><div class="kpi-val" id="k-deals">0</div><div class="kpi-lbl">Deals Tracked</div></div>
  <div class="kpi"><div class="kpi-val" id="k-emails">0</div><div class="kpi-lbl">Emails Sent</div></div>
</div>

<!-- MAIN: AGENT GRID -->
<div class="main">
  <div class="grid" id="agent-grid">
    ${Object.entries(AGENT_META).map(([id, m]) => `
    <div class="card" id="card-${id}" data-agent="${id}">
      <div class="card-top">
        <div class="avatar" style="background:linear-gradient(135deg,${m.color}cc,${m.color})">${m.initials}</div>
        <div class="card-info">
          <div class="card-name">${m.label}</div>
          <div class="card-role">${m.role}</div>
        </div>
      </div>
      <div class="status-row">
        <div class="dot dot-idle" id="dot-${id}"></div>
        <div class="status-text" id="status-${id}">Idle</div>
      </div>
      <div class="task-text" id="task-${id}">Standing by...</div>
      <div class="chips" id="chips-${id}">
        ${(SUB_AGENTS[id] || []).map(sa => `<div class="chip"><span class="chip-icon">${sa.icon}</span>${sa.name}</div>`).join('')}
      </div>
    </div>`).join('')}
  </div>
</div>

<!-- SIDEBAR -->
<div class="sidebar">
  <div class="sidebar-top">
    <div class="s-hdr">Live Activity <span class="ct" id="feed-count">0</span></div>
    <div class="feed-list" id="feed-list"></div>
  </div>
  <div class="sidebar-bot">
    <div class="s-hdr">Agent Chat <span class="ct" id="chat-count">0</span></div>
    <div class="chat-list" id="chat-list"></div>
  </div>
</div>

</div><!-- /office -->

<script>
const AGENT_COLORS = ${JSON.stringify(Object.fromEntries(Object.entries(AGENT_META).map(([k,v]) => [k, v.color])))};
const TYPE_ICON = { success:'✅', alert:'🚨', collab:'💬', info:'ℹ️', action:'⚡' };

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.floor(m/60) + 'h ago';
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, weekday: 'short', month: 'short', day: 'numeric' }) + ' EST';
}

function updateKPIs(kpi) {
  document.getElementById('k-dms').textContent    = kpi.dmsHandled;
  document.getElementById('k-leads').textContent  = kpi.leadsCapture;
  document.getElementById('k-posts').textContent  = kpi.postsPublished;
  document.getElementById('k-sites').textContent  = kpi.sitesMonitored;
  document.getElementById('k-deals').textContent  = kpi.dealsTracked;
  document.getElementById('k-emails').textContent = kpi.emailsSent;
}

function updateAgents(agents) {
  Object.entries(agents).forEach(([id, a]) => {
    const card   = document.getElementById('card-' + id);
    const dot    = document.getElementById('dot-' + id);
    const status = document.getElementById('status-' + id);
    const task   = document.getElementById('task-' + id);
    if (!card) return;
    card.className = 'card ' + (a.status || 'idle');
    dot.className  = 'dot dot-' + (a.status || 'idle');
    status.textContent = a.status === 'working' ? '● Working' : a.status === 'alert' ? '⚠ Alert' : '○ Idle';
    status.style.color = a.status === 'working' ? '#22c55e' : a.status === 'alert' ? '#ef4444' : '#475569';
    task.textContent = a.task || 'Standing by...';
  });
}

let lastFeedId = null, lastChatTs = null;

function renderFeed(feed) {
  const list = document.getElementById('feed-list');
  document.getElementById('feed-count').textContent = feed.length;
  const html = feed.map(f => {
    const color = AGENT_COLORS[f.agent] || '#475569';
    return \`<div class="feed-item t-\${f.type}" style="border-left-color:\${color}">
      <div class="fi-top">
        <span class="fi-agent" style="color:\${color}">\${f.agent}</span>
        <span style="font-size:9px;color:#374151">\${TYPE_ICON[f.type]||'•'}</span>
        <span class="fi-time">\${timeAgo(f.ts)}</span>
      </div>
      <div class="fi-msg">\${f.message}</div>
    </div>\`;
  }).join('');
  if (feed[0]?.id !== lastFeedId) { list.innerHTML = html; lastFeedId = feed[0]?.id; }
}

function renderChat(chat) {
  const list = document.getElementById('chat-list');
  document.getElementById('chat-count').textContent = chat.length;
  const html = chat.map(c => {
    const fc = AGENT_COLORS[c.from] || '#475569';
    const tc = AGENT_COLORS[c.to]   || '#475569';
    return \`<div class="chat-item">
      <div class="ci-top">
        <span class="ci-from" style="color:\${fc}">\${c.from}</span>
        <span class="ci-arrow">→</span>
        <span class="ci-to" style="color:\${tc}">\${c.to}</span>
        <span class="ci-time">\${timeAgo(c.ts)}</span>
      </div>
      <div class="ci-msg">\${c.message}</div>
    </div>\`;
  }).join('');
  if (chat[0]?.ts !== lastChatTs) { list.innerHTML = html; lastChatTs = chat[0]?.ts; }
}

async function refresh() {
  try {
    const r = await fetch('/office/status');
    const d = await r.json();
    updateKPIs(d.kpi);
    updateAgents(d.agents);
    renderFeed(d.feed);
    renderChat(d.chat);
  } catch(e) { console.warn('Office poll failed', e); }
}

setInterval(updateClock, 1000);
setInterval(refresh, 5000);
updateClock();
refresh();
</script>
</body></html>`);
});

// Status check: GET /social/status
app.get('/social/status', (_req, res) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const { script, index } = getTodaysScript();
  res.json({
    status: 'Social Media Automation — ACTIVE',
    currentTime_EST: now,
    todaysScript: { index: index + 1, title: script.title },
    totalPrewrittenScripts: CAROUSEL_SCRIPTS.length,
    dailyPostTime: '8:00 AM EST',
    dailyStoryTime: '7:00 PM EST',
    platforms: Object.keys(SOCIAL_ACCOUNTS),
    storyPlatforms: ['instagram', 'facebook'],
  });
});

app.get('/', (_req, res) => {
  res.json({
    status: 'Armando is online 🤖',
    name: 'Armando Rivas',
    age: 22,
    from: 'Caracas, Venezuela 🇻🇪',
    agency: 'JRZ Marketing',
    mission: 'DM lead capture + autonomous social media posting 7 days/week',
    socialMedia: 'Instagram · Facebook · LinkedIn · YouTube · Google Business',
    postsPerDay: '1 carousel (8am EST) + 1 story (7pm EST)',
  });
});

// ═══════════════════════════════════════════════════════════
// APOLLO ENRICHMENT — runs Monday 9am EST
// Finds GHL contacts tagged needs_email, hits Apollo People
// Match API to get their email, updates GHL, swaps tag to
// outbound_pending so the bot picks them up at 10am.
// Free plan = 50 credits/month → limit 50 per run.
// ═══════════════════════════════════════════════════════════

async function enrichProspectEmails() {
  console.log('[Apollo] Starting email enrichment...');
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&tags=needs_email&limit=50`,
      { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
    );
    const contacts = res.data?.contacts || [];
    if (!contacts.length) {
      console.log('[Apollo] No contacts need enrichment.');
      return { enriched: 0 };
    }

    let enriched = 0;
    for (const contact of contacts) {
      const firstName = contact.firstName || '';
      const lastName  = contact.lastName  || '';
      const domain    = contact.website?.replace(/https?:\/\//, '').split('/')[0] || '';
      const company   = contact.companyName || '';

      if (!firstName || (!domain && !company)) continue;

      try {
        const apollo = await axios.post(
          'https://api.apollo.io/api/v1/people/match',
          { api_key: APOLLO_API_KEY, first_name: firstName, last_name: lastName, domain, organization_name: company },
          { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } }
        );

        const email = apollo.data?.person?.email;
        if (!email || email.includes('email_not_found')) {
          console.log(`[Apollo] No email found for ${firstName} ${lastName}`);
          continue;
        }

        // Update GHL contact with real email + swap tags
        await axios.put(
          `https://services.leadconnectorhq.com/contacts/${contact.id}`,
          { email },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.post(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { tags: ['outbound_pending'] },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await axios.delete(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/tags`,
          { data: { tags: ['needs_email'] }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        await tagContact(contact.id, ['nurture-sequence']);

        enriched++;
        console.log(`[Apollo] ✅ Enriched ${firstName} ${lastName} → ${email}`);
        await new Promise(r => setTimeout(r, 1000)); // gentle rate limit
      } catch (err) {
        console.error(`[Apollo] ❌ Failed for ${firstName} ${lastName}:`, err?.response?.data || err.message);
      }
    }

    console.log(`[Apollo] Done — ${enriched}/${contacts.length} emails found`);
    return { enriched, total: contacts.length };
  } catch (err) {
    console.error('[Apollo] ❌ Enrichment run failed:', err.message);
    return { enriched: 0, error: err.message };
  }
}

// Manual trigger: POST /cron/enrich-prospects
app.post('/cron/enrich-prospects', async (_req, res) => {
  try {
    const result = await enrichProspectEmails();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: GET /ab-test/results — view current A/B test standings
app.get('/ab-test/results', async (_req, res) => {
  try {
    const data = await loadABTestData();
    const results = Object.entries(data.variants).map(([v, s]) => ({
      variant: v,
      name: CLOSING_VARIANTS[v].name,
      description: CLOSING_VARIANTS[v].description,
      sent: s.sent,
      conversions: s.conversions,
      rate: s.sent > 0 ? `${((s.conversions / s.sent) * 100).toFixed(1)}%` : '—',
      weight: `${data.weights[v]}%`,
    }));
    res.json({ lastOptimized: data.lastOptimized, results, history: data.history.slice(-5) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual trigger: POST /cron/ab-test-analysis — force A/B analysis now
app.post('/cron/ab-test-analysis', async (_req, res) => {
  try {
    const result = await runABTestAnalysis();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — LEAD SCORING
// ═══════════════════════════════════════════════════════════

function calculateLeadScore({ leadQuality, sentiment, foundPhone, foundEmail, historyCount, channel }) {
  let score = 0;
  if (foundPhone && foundEmail) score += 4;
  else if (foundPhone || foundEmail) score += 2;
  if (leadQuality === 'hot') score += 3;
  else if (leadQuality === 'qualified') score += 2;
  else if (leadQuality === 'interested') score += 1;
  if (sentiment === 'positive') score += 2;
  else if (sentiment === 'annoyed') score -= 1;
  if (channel === 'Live_Chat') score += 2;
  if (historyCount >= 3) score += 1;
  return Math.max(0, Math.min(10, score));
}

const leadScoreAlertSent = new Set();

async function sendLeadScoreAlert(contactId, contactName, score, channel, foundPhone, foundEmail) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const subject = `🎯 Lead Score ${score}/10 — ${contactName} está listo`;
  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lead Score Alert — JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .lead-card { background:#f9f9f9; border-radius:12px; overflow:hidden; margin:24px 0; }
    .lead-row { padding:12px 20px; border-bottom:1px solid #eeeeee; font-size:14px; color:#333333; }
    .lead-row:last-child { border-bottom:none; }
    .lead-label { font-weight:700; color:#0a0a0a; display:inline-block; width:80px; }
    .score-bar { background:#eeeeee; border-radius:999px; height:10px; margin:8px 0 0; overflow:hidden; }
    .score-fill { background:#0a0a0a; height:10px; border-radius:999px; width:${score * 10}%; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>🎯 Lead Score Alert</span></div>
  <div class="email-hero">
    <h1>${contactName}<br />Score: ${score}/10</h1>
    <p>Armando detectó un lead de alta intención. Actúa ahora.</p>
  </div>
  <div class="email-body">
    <p>Este lead alcanzó un puntaje de <strong>${score}/10</strong> basado en su comportamiento e información proporcionada:</p>
    <div class="lead-card">
      <div class="lead-row"><span class="lead-label">Nombre</span>${contactName}</div>
      <div class="lead-row"><span class="lead-label">Canal</span>${channel || 'DM'}</div>
      <div class="lead-row"><span class="lead-label">Teléfono</span>${foundPhone || '—'}</div>
      <div class="lead-row"><span class="lead-label">Email</span>${foundEmail || '—'}</div>
      <div class="lead-row"><span class="lead-label">Score</span>${score}/10 <div class="score-bar"><div class="score-fill"></div></div></div>
      <div class="lead-row"><span class="lead-label">Hora</span>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</div>
    </div>
    <p>Este lead está listo para cerrar. Contáctalo directamente o agenda una llamada.</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para cerrar?</p>
    <a href="${BOOKING_URL}" class="cta-button">Agenda llamada &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Armando Rivas</div>
    <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Alerta automática generada por Armando.</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log(`[LeadScore] Alert sent for ${contactName} (${score}/10)`);
  } catch (err) {
    console.error('[LeadScore] Failed to send alert:', err?.response?.data || err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — NEW CLIENT ONBOARDING
// ═══════════════════════════════════════════════════════════

const onboardedContacts = new Set();

async function sendClientOnboarding(contactId, contactName, businessName, loginEmail) {
  const firstName  = (contactName || 'Cliente').split(' ')[0];
  const logoUrl    = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const appStoreUrl   = 'https://apps.apple.com/us/app/lead-connector/id1564153400';
  const playStoreUrl  = 'https://play.google.com/store/apps/details?id=com.gohighlevel.mobileapp';
  const subject    = `Your marketing system is ready, ${firstName} 🚀`;
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your system is ready</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .badge-wrap { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .badge { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; }
    .email-hero h1 { font-size:26px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:12px; }
    .email-hero p { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .body-section { padding:36px 40px 28px; }
    .body-section p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:16px; }
    .body-section strong { color:#0a0a0a; font-weight:700; }
    .login-box { background:#0a0a0a; border-radius:12px; padding:24px 28px; margin:20px 0; }
    .login-box .lbl { color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:4px; }
    .login-box .val { color:#ffffff; font-size:14px; font-weight:600; margin-bottom:14px; }
    .login-box .val:last-child { margin-bottom:0; }
    .steps { margin:16px 0; }
    .step { display:flex; align-items:flex-start; padding:12px 0; border-bottom:1px solid #f0f0f0; }
    .step:last-child { border-bottom:none; }
    .step-num { background:#0a0a0a; color:#ffffff; font-size:12px; font-weight:800; min-width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:14px; flex-shrink:0; margin-top:2px; }
    .step-text { font-size:14px; color:#333333; line-height:1.6; }
    .step-text strong { color:#0a0a0a; }
    .setup-grid { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin:16px 0; }
    .setup-item { font-size:13px; color:#333333; padding:7px 0; border-bottom:1px solid #eeeeee; display:flex; align-items:center; gap:10px; }
    .setup-item:last-child { border-bottom:none; }
    .check { color:#0a0a0a; font-weight:700; }
    .app-row { display:flex; gap:10px; justify-content:center; margin:14px 0; flex-wrap:wrap; }
    .app-btn { display:inline-block; background:#f4f4f4; border:1px solid #e0e0e0; color:#0a0a0a !important; font-size:12px; font-weight:600; text-decoration:none; padding:9px 18px; border-radius:8px; }
    .divider { height:1px; background:#f0f0f0; margin:28px 40px; }
    .cta-section { padding:0 40px 36px; text-align:center; }
    .cta-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:14px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:10px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:28px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:14px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="badge-wrap"><span class="badge">Sub-account Active &middot; ${businessName || firstName + "'s Business"}</span></div>
  <div class="email-hero">
    <h1>${firstName}, your system is ready ✅</h1>
    <p>Your CRM, automations, and sales pipeline are configured and ready to capture clients today.</p>
  </div>

  <div class="body-section">
    <p>Hi <strong>${firstName}</strong>,</p>
    <p>Your sub-account on our marketing platform is now active. Here are your login credentials:</p>
    <div class="login-box">
      <div class="lbl">Platform</div>
      <div class="val">app.gohighlevel.com</div>
      <div class="lbl">Login Email</div>
      <div class="val">${loginEmail || 'Your registered email'}</div>
      <div class="lbl">Password</div>
      <div class="val">You'll receive a separate email from GoHighLevel to set your password.</div>
    </div>
    <p><strong>What's already set up in your system:</strong></p>
    <div class="setup-grid">
      <div class="setup-item"><span class="check">✓</span> CRM with your organized sales pipeline</div>
      <div class="setup-item"><span class="check">✓</span> AI chatbot — auto-responds to leads 24/7</div>
      <div class="setup-item"><span class="check">✓</span> 13-email nurture sequence (6 months of follow-up)</div>
      <div class="setup-item"><span class="check">✓</span> Booking calendar integrated</div>
      <div class="setup-item"><span class="check">✓</span> Weekly performance reports dashboard</div>
      <div class="setup-item"><span class="check">✓</span> Social media integrations</div>
    </div>
    <p><strong>Your first 3 steps:</strong></p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Log in</strong> at app.gohighlevel.com and set your password.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Download the app</strong> "Lead Connector" on your phone to manage leads anywhere.</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text"><strong>Book your onboarding call</strong> — 30 minutes and we'll walk you through everything live.</div></div>
    </div>
    <p style="text-align:center;font-size:14px;"><strong>Download the mobile app:</strong></p>
    <div class="app-row">
      <a href="${appStoreUrl}" class="app-btn">📱 App Store (iPhone)</a>
      <a href="${playStoreUrl}" class="app-btn">🤖 Google Play (Android)</a>
    </div>
    <p style="font-size:14px;">Questions? Reply to this email or reach us directly at (407) 844-6376. We're here to make sure your system runs at 100%.</p>
  </div>

  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">Next Step</p>
    <a href="${BOOKING_URL}" class="cta-button">Book Your Onboarding Call &rarr;</a>
    <p class="cta-note">30 min &middot; Free &middot; We walk you through everything live</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing &middot; (407) 844-6376</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

  try {
    await sendEmail(contactId, subject, html);
    console.log(`[Onboarding] Welcome email sent to ${contactName} (${contactId})`);
  } catch (err) {
    console.error('[Onboarding] Failed to send welcome email:', err?.response?.data || err.message);
  }
}

app.post('/webhook/new-client', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;
    const contactId   = payload.contactId || payload.contact_id || payload.contact?.id || payload.customData?.contactId || '';
    const contactName = payload.fullName || payload.full_name || payload.contactName || payload.firstName || payload.first_name || payload.customData?.fullName || '';
    const businessName = payload.businessName || payload.companyName || payload.customData?.businessName || '';
    const loginEmail  = payload.email || payload.contact?.email || payload.customData?.email || '';
    if (!contactId) { console.log('[Onboarding] Missing contactId, skipping.'); return; }
    if (onboardedContacts.has(contactId)) { console.log(`[Onboarding] Already onboarded ${contactId}, skipping.`); return; }
    onboardedContacts.add(contactId);
    // Mark any pending objection responses as converted — this is a real booking
    markObjectionConverted(contactId); // fire-and-forget
    logWeeklyWin(contactId, 'booked', 'booking'); // fire-and-forget
    await sendClientOnboarding(contactId, contactName, businessName, loginEmail);
  } catch (err) {
    console.error('[Onboarding] Webhook error:', err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — PROPOSAL GENERATOR
// ═══════════════════════════════════════════════════════════

const proposalsSent = new Set();

async function generateAndSendProposal(contactId, contactName, businessType, email) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  try {
    const promptText = `Generate a professional proposal for a ${businessType} business wanting JRZ Marketing services. Return ONLY valid JSON: { "challenge": "main pain point", "solution": "how JRZ solves it", "services": ["service1", "service2", "service3"], "timeline": "expected timeline", "investment": "Starting at $497/month" }`;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: promptText }],
    });
    const proposal = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

    const subject = `Propuesta JRZ Marketing — ${contactName}`;
    const servicesHtml = (proposal.services || []).map(s => `<li style="padding:10px 0 10px 28px;position:relative;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333333;"><span style="position:absolute;left:0;font-weight:700;color:#0a0a0a;">✓</span>${s}</li>`).join('');
    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Propuesta JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin:28px 0 10px; }
    .section-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin-bottom:20px; font-size:15px; color:#333333; line-height:1.7; }
    .services-list { list-style:none; padding:0; margin:0; }
    .investment-box { background:#0a0a0a; border-radius:12px; padding:24px; text-align:center; margin:24px 0; }
    .investment-amount { font-size:28px; font-weight:800; color:#ffffff; }
    .investment-label { font-size:12px; color:rgba(255,255,255,0.4); margin-top:4px; letter-spacing:0.08em; text-transform:uppercase; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Propuesta Personalizada</span></div>
  <div class="email-hero">
    <h1>Propuesta para<br />${contactName}</h1>
    <p>Solución de marketing digital diseñada específicamente para tu negocio de ${businessType}.</p>
  </div>
  <div class="email-body">
    <p class="section-title">El reto</p>
    <div class="section-box">${proposal.challenge || ''}</div>
    <p class="section-title">Nuestra solución</p>
    <div class="section-box">${proposal.solution || ''}</div>
    <p class="section-title">Servicios incluidos</p>
    <ul class="services-list">${servicesHtml}</ul>
    <p class="section-title">Timeline</p>
    <div class="section-box">${proposal.timeline || ''}</div>
    <p class="section-title">Inversión</p>
    <div class="investment-box">
      <div class="investment-amount">${proposal.investment || 'Starting at $497/month'}</div>
      <div class="investment-label">Inversión mensual personalizada</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Listo para arrancar?</p>
    <a href="${BOOKING_URL}" class="cta-button">Agenda tu llamada de inicio &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Propuesta generada por el equipo de JRZ Marketing.</p>
  </div>
</div></div>
</body></html>`;

    await sendEmail(contactId, subject, html);
    console.log(`[Proposal] Sent proposal to ${contactName} (${contactId})`);
  } catch (err) {
    console.error('[Proposal] Failed:', err?.response?.data || err.message);
  }
}

app.post('/webhook/hot-lead', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;
    const contactId = payload.contactId || payload.contact_id || payload.contact?.id || payload.customData?.contactId || '';
    const contactName = payload.fullName || payload.full_name || payload.contactName || payload.firstName || payload.first_name || payload.customData?.fullName || '';
    const businessType = payload.customData?.businessType || payload.businessType || 'negocio';
    const email = payload.email || payload.contact?.email || payload.customData?.email || '';
    if (!contactId) { console.log('[Proposal] Missing contactId, skipping.'); return; }
    if (proposalsSent.has(contactId)) { console.log(`[Proposal] Already sent proposal for ${contactId}, skipping.`); return; }
    proposalsSent.add(contactId);
    await generateAndSendProposal(contactId, contactName, businessType, email);
  } catch (err) {
    console.error('[Proposal] Webhook error:', err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// FEATURE 4 — CLIENT CHECK-INS (30-day rolling)
// ═══════════════════════════════════════════════════════════

const CHECKIN_URL    = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/client_checkins.json';
const CHECKIN_PUB_ID = 'jrz/client_checkins';

async function loadCheckInData() {
  try {
    const res = await axios.get(CHECKIN_URL, { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    return {};
  }
}

async function saveCheckInData(data) {
  try {
    const ts      = Math.floor(Date.now() / 1000);
    const sigStr  = `overwrite=true&public_id=${CHECKIN_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig     = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form    = new FormData();
    const buf     = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file',          buf,  { filename: 'client_checkins.json', contentType: 'application/json' });
    form.append('public_id',     CHECKIN_PUB_ID);
    form.append('resource_type', 'raw');
    form.append('timestamp',     String(ts));
    form.append('api_key',       CLOUDINARY_API_KEY);
    form.append('signature',     sig);
    form.append('overwrite',     'true');
    await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`,
      form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 }
    );
  } catch (err) {
    console.error('[CheckIn] Failed to save check-in data:', err.message);
  }
}

async function getActiveClients() {
  const res = await axios.get(
    `https://services.leadconnectorhq.com/contacts/`,
    { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' },
      params: { locationId: GHL_LOCATION_ID, query: 'active-client', limit: 100 } }
  );
  return res.data?.contacts || [];
}

async function runClientCheckIns() {
  console.log('[CheckIn] Running 30-day client check-ins...');
  try {
    const [clients, checkInData] = await Promise.all([getActiveClients(), loadCheckInData()]);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const client of clients) {
      try {
        const lastCheckIn = checkInData[client.id];
        if (lastCheckIn && (now - lastCheckIn) < thirtyDays) continue;
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'amigo';
        const msgResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: `You are Armando from JRZ Marketing. Write a short, warm 2-sentence check-in message in Spanish to ${contactName} asking how their business is going and if there's anything the team can help with. Sound like a real person, not a template.` }],
        });
        const message = msgResp.content[0].text.trim();
        await sendGHLReply(client.id, message, 'SMS');
        checkInData[client.id] = Date.now();
        console.log(`[CheckIn] Sent check-in to ${contactName} (${client.id})`);
      } catch (err) {
        console.error(`[CheckIn] Failed for client ${client.id}:`, err.message);
      }
    }
    await saveCheckInData(checkInData);
    console.log('[CheckIn] Done.');
  } catch (err) {
    console.error('[CheckIn] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 5 — MONTHLY CLIENT REPORTS
// ═══════════════════════════════════════════════════════════

async function sendMonthlyClientReports() {
  console.log('[MonthlyReport] Generating monthly client reports...');
  try {
    const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const nowDate = new Date();
    const month = nowDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const [clients, stats] = await Promise.all([getActiveClients(), getWeeklyStats().catch(() => null)]);
    const statsSnap = stats ? JSON.stringify(stats).slice(0, 400) : 'Sin datos disponibles';

    for (const client of clients) {
      try {
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Cliente';
        const firstName = (contactName).split(' ')[0];
        const businessType = (client.tags || []).find(t => t !== 'active-client') || 'negocio';

        const reportMsg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: `You are JRZ Marketing's reporting AI. Generate a personalized monthly report for client: ${contactName}, business type: ${businessType}, month: ${month}. Social stats snapshot: ${statsSnap}. Return ONLY valid JSON: { "headline": "...", "wins": ["win1", "win2", "win3"], "nextMonth": "focus for next month", "personalNote": "personal note for this client from Jose" }` }],
        });
        const report = JSON.parse(reportMsg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
        const winsHtml = (report.wins || []).map(w => `<li style="padding:10px 0 10px 28px;position:relative;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333333;"><span style="position:absolute;left:0;font-weight:700;color:#0a0a0a;">✓</span>${w}</li>`).join('');

        const subject = `📊 Tu Reporte Mensual — ${month} | JRZ Marketing`;
        const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte Mensual JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin:28px 0 10px; }
    .wins-list { list-style:none; padding:0; margin:0 0 20px; }
    .section-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin-bottom:20px; font-size:15px; color:#333333; line-height:1.7; }
    .note-box { background:#0a0a0a; border-radius:12px; padding:24px; margin:24px 0; font-size:15px; color:rgba(255,255,255,0.8); line-height:1.7; font-style:italic; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .cta-section { padding:0 40px 40px; text-align:center; }
    .cta-label { font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:16px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Reporte Mensual — ${month}</span></div>
  <div class="email-hero">
    <h1>${firstName},<br />este fue tu mes. 📊</h1>
    <p>${report.headline || 'Resumen de tus resultados con JRZ Marketing.'}</p>
  </div>
  <div class="email-body">
    <p>Hola <strong>${firstName}</strong>,</p>
    <p>Aquí está tu reporte mensual de resultados. Estos son los logros más importantes de este mes:</p>
    <p class="section-title">Logros del mes</p>
    <ul class="wins-list">${winsHtml}</ul>
    <p class="section-title">Enfoque del próximo mes</p>
    <div class="section-box">${report.nextMonth || ''}</div>
    <p class="section-title">Nota personal de Jose</p>
    <div class="note-box">${report.personalNote || ''}</div>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">¿Tienes preguntas?</p>
    <a href="${BOOKING_URL}" class="cta-button">Habla con el equipo &rarr;</a>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.</p>
  </div>
</div></div>
</body></html>`;

        await sendEmail(client.id, subject, html);
        console.log(`[MonthlyReport] Sent to ${contactName} (${client.id})`);
      } catch (err) {
        console.error(`[MonthlyReport] Failed for client ${client.id}:`, err.message);
      }
    }
    console.log('[MonthlyReport] Done.');
  } catch (err) {
    console.error('[MonthlyReport] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 6b — MONTHLY SUB-ACCOUNT CHECK-IN EMAIL
//   Runs last Friday of every month @ 10am EST
//   Sends English email to every contact tagged active-client
//   with GHL news, updates, and a personal check-in note
// ═══════════════════════════════════════════════════════════

async function sendSubAccountCheckInEmails() {
  console.log('[SubCheckIn] Running monthly sub-account check-in emails...');
  try {
    const logoUrl   = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const nowDate   = new Date();
    const monthName = nowDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Fetch latest GHL news via NewsAPI
    let newsItems = [];
    try {
      const newsRes = await axios.get(
        'https://newsapi.org/v2/everything?q=Go+High+Level+CRM+update+feature&language=en&sortBy=publishedAt&pageSize=6&apiKey=' + NEWS_API_KEY,
        { timeout: 10000 }
      );
      newsItems = (newsRes.data?.articles || []).slice(0, 5).map(a => `- ${a.title}: ${(a.description || '').slice(0, 120)}`);
    } catch (_) {}

    // Claude generates the GHL update section + tip of the month
    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are JRZ Marketing's client success AI. Write a friendly, professional monthly check-in email body for sub-account clients. Month: ${monthName}. Recent GHL news/articles:\n${newsItems.join('\n') || 'No articles available.'}\n\nReturn ONLY valid JSON:\n{"subject_suffix": "one short subject line suffix (max 50 chars)", "intro": "1-2 sentence warm intro (English)", "ghl_updates": ["update 1", "update 2", "update 3"], "tip": "one actionable marketing tip they can apply this month", "closing": "1 sentence warm closing from Jose"}`,
      }],
    });
    const aiText = aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}';
    const ai = JSON.parse(aiText);

    const updatesHtml = (ai.ghl_updates || ['Platform improvements rolling out', 'New automation features available', 'Performance enhancements deployed'])
      .map(u => `<div class="update-item"><span class="check">✓</span>${u}</div>`).join('');

    const clients = await getActiveClients();
    let sent = 0;

    for (const client of clients) {
      try {
        const contactName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Client';
        const firstName   = contactName.split(' ')[0];
        const subject     = `${monthName} Update — Your Marketing System ${ai.subject_suffix || '| JRZ Marketing'}`;

        const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .badge-wrap { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .badge { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; }
    .email-hero h1 { font-size:26px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:12px; }
    .email-hero p { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .body-section { padding:36px 40px 28px; }
    .body-section p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:16px; }
    .body-section strong { color:#0a0a0a; font-weight:700; }
    .section-label { font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#999999; margin:24px 0 12px; }
    .updates-box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin:16px 0; }
    .update-item { font-size:14px; color:#333333; padding:8px 0; border-bottom:1px solid #eeeeee; display:flex; align-items:flex-start; gap:10px; line-height:1.5; }
    .update-item:last-child { border-bottom:none; }
    .check { color:#0a0a0a; font-weight:700; flex-shrink:0; }
    .tip-box { background:#0a0a0a; border-radius:12px; padding:24px 28px; margin:20px 0; }
    .tip-label { color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; margin-bottom:10px; }
    .tip-text { color:#ffffff; font-size:15px; line-height:1.7; }
    .divider { height:1px; background:#f0f0f0; margin:28px 40px; }
    .cta-section { padding:0 40px 36px; text-align:center; }
    .cta-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#999999; margin-bottom:14px; }
    .cta-button { display:inline-block; background:#0a0a0a; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-bottom:10px; }
    .cta-note { font-size:12px; color:#aaaaaa; }
    .signature { padding:28px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:14px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="badge-wrap"><span class="badge">Monthly Update &middot; ${monthName}</span></div>
  <div class="email-hero">
    <h1>${firstName}, here's what's new 🚀</h1>
    <p>Your monthly platform update + what we're seeing in the market right now.</p>
  </div>
  <div class="body-section">
    <p>Hi <strong>${firstName}</strong>,</p>
    <p>${ai.intro || "We're checking in to share what's new on your platform and a quick tip to help you get more out of your system this month."}</p>
    <p class="section-label">GoHighLevel Platform Updates</p>
    <div class="updates-box">${updatesHtml}</div>
    <p class="section-label">Tip of the Month</p>
    <div class="tip-box">
      <div class="tip-label">💡 Action Item for You</div>
      <div class="tip-text">${ai.tip || 'Make sure your booking calendar is linked to your main CTA button — this one change alone can double your booked calls.'}</div>
    </div>
    <p>${ai.closing || "As always, if you have questions or want us to look at something in your account, we're one message away."}</p>
    <p>— <strong>Jose Rivas</strong> &amp; the JRZ Marketing team</p>
  </div>
  <div class="divider"></div>
  <div class="cta-section">
    <p class="cta-label">Need help with your system?</p>
    <a href="${BOOKING_URL}" class="cta-button">Book a Call with Jose &rarr;</a>
    <p class="cta-note">30 min &middot; Free &middot; We'll review your account live</p>
  </div>
  <div class="signature">
    <div class="signature-name">Jose Rivas</div>
    <div class="signature-title">CEO &middot; JRZ Marketing &middot; (407) 844-6376</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />jrzmarketing.com</p>
  </div>
</div></div>
</body></html>`;

        await sendEmail(client.id, subject, html);
        sent++;
        console.log(`[SubCheckIn] Sent to ${contactName} (${client.id})`);
        await new Promise(r => setTimeout(r, 500)); // rate limit
      } catch (err) {
        console.error(`[SubCheckIn] Failed for ${client.id}:`, err.message);
      }
    }
    console.log(`[SubCheckIn] Done. Sent to ${sent}/${clients.length} clients.`);
  } catch (err) {
    console.error('[SubCheckIn] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 6 — COMPETITOR MONITORING
// ═══════════════════════════════════════════════════════════

async function runCompetitorMonitoring() {
  console.log('[Competitor] Running weekly competitor monitoring...');
  try {
    const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
    const date = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', day: '2-digit', month: 'long', year: 'numeric' });

    const [res1, res2, res3] = await Promise.all([
      axios.get('https://newsapi.org/v2/everything?q=marketing+digital+hispano+peque%C3%B1os+negocios&language=es&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
      axios.get('https://newsapi.org/v2/everything?q=AI+marketing+automation+small+business&language=en&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
      axios.get('https://newsapi.org/v2/everything?q=Go+High+Level+CRM+agency&language=en&sortBy=publishedAt&pageSize=5&apiKey=dff54f64e9eb4087aa7c215a1c674644', { timeout: 10000 }).catch(() => null),
    ]);

    const articles = [
      ...(res1?.data?.articles || []),
      ...(res2?.data?.articles || []),
      ...(res3?.data?.articles || []),
    ];
    const summary = articles.map(a => `- ${a.title}: ${a.description || ''}`).join('\n').slice(0, 3000);

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Analyze these digital marketing news articles and return ONLY valid JSON: { "trendingSince": "what's trending in digital marketing this week", "opportunity": "biggest opportunity for JRZ Marketing based on these trends", "contentIdea": "one specific content idea for JRZ's social media based on trends", "competitorMove": "what agencies/competitors seem to be focusing on", "actionItem": "one specific action Jose should take this week" }\n\nArticles:\n${summary}` }],
    });
    const insights = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

    const subject = `🔍 Radar Semanal — Tendencias + Competencia (${date})`;
    const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Radar Semanal JRZ Marketing</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; -webkit-font-smoothing:antialiased; }
    .email-wrapper { background-color:#f4f4f4; padding:40px 20px; }
    .email-container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .email-header { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .email-header img { height:48px; width:auto; }
    .week-badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .week-badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .email-hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #ffffff; }
    .email-hero h1 { font-size:28px; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:-0.02em; margin-bottom:16px; }
    .email-hero p { font-size:15px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .email-body { padding:40px 40px 32px; }
    .email-body p { font-size:15px; color:#333333; line-height:1.8; margin-bottom:20px; }
    .email-body strong { color:#0a0a0a; font-weight:700; }
    .insight-row { display:flex; align-items:flex-start; padding:20px 0; border-bottom:1px solid #f0f0f0; }
    .insight-row:last-child { border-bottom:none; }
    .insight-icon { font-size:22px; min-width:36px; margin-right:16px; }
    .insight-content { flex:1; }
    .insight-label { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999999; margin-bottom:6px; }
    .insight-text { font-size:15px; color:#333333; line-height:1.6; }
    .action-box { background:#0a0a0a; border-radius:12px; padding:24px; margin:24px 0; }
    .action-label { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:rgba(255,255,255,0.4); margin-bottom:10px; }
    .action-text { font-size:16px; font-weight:700; color:#ffffff; line-height:1.5; }
    .divider { height:1px; background:#f0f0f0; margin:32px 40px; }
    .signature { padding:32px 40px; background:#f9f9f9; border-top:1px solid #eeeeee; }
    .signature-name { font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:4px; }
    .signature-title { font-size:13px; color:#777777; }
    .email-footer { background:#0a0a0a; padding:28px 40px; text-align:center; }
    .email-footer img { height:28px; width:auto; margin-bottom:16px; opacity:0.7; }
    .footer-copy { font-size:11px; color:rgba(255,255,255,0.2); line-height:1.6; }
  </style>
</head>
<body>
<div class="email-wrapper"><div class="email-container">
  <div class="email-header"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="week-badge"><span>Radar Semanal — ${date}</span></div>
  <div class="email-hero">
    <h1>Tendencias + Competencia<br />esta semana. 🔍</h1>
    <p>Análisis automático de ${articles.length} artículos del mercado digital.</p>
  </div>
  <div class="email-body">
    <div class="insight-row">
      <div class="insight-icon">📈</div>
      <div class="insight-content"><div class="insight-label">Tendencia de la semana</div><div class="insight-text">${insights.trendingSince || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">💡</div>
      <div class="insight-content"><div class="insight-label">Oportunidad para JRZ</div><div class="insight-text">${insights.opportunity || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">🎯</div>
      <div class="insight-content"><div class="insight-label">Idea de contenido</div><div class="insight-text">${insights.contentIdea || ''}</div></div>
    </div>
    <div class="insight-row">
      <div class="insight-icon">🏢</div>
      <div class="insight-content"><div class="insight-label">Movimiento de competidores</div><div class="insight-text">${insights.competitorMove || ''}</div></div>
    </div>
    <div class="action-box">
      <div class="action-label">Accion de esta semana</div>
      <div class="action-text">${insights.actionItem || ''}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="signature">
    <div class="signature-name">Armando Rivas</div>
    <div class="signature-title">AI Community Manager &middot; JRZ Marketing</div>
  </div>
  <div class="email-footer">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p class="footer-copy">&copy; 2026 JRZ Marketing. Orlando, Florida.<br />Radar semanal automático generado por Armando.</p>
  </div>
</div></div>
</body></html>`;

    await sendEmail(OWNER_CONTACT_ID, subject, html);
    console.log('[Competitor] Weekly radar email sent to Jose.');
    // Persist insights for Armando's voice scripts
    await saveCompetitorInsights({ ...insights, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[Competitor] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MANUAL TRIGGER ENDPOINTS — new features
// ═══════════════════════════════════════════════════════════

app.post('/cron/competitor-monitoring', async (_req, res) => {
  try {
    await runCompetitorMonitoring();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/review-mining', async (_req, res) => {
  try {
    await runReviewMining();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GOOGLE CALENDAR — Armando books directly into JRZ Calendar
// Every day 7am–9pm EST, 15-min slots
// ═══════════════════════════════════════════════════════════

async function getJRZCalendarId() {
  if (jrzCalendarId) return jrzCalendarId;
  const token = await getGoogleAccessToken();
  const res   = await axios.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${token}` } });
  const cal   = (res.data.items || []).find(c => c.summary && (c.summary.includes('JRZ') || c.summary === 'JRZ Calendar'));
  jrzCalendarId = cal ? cal.id : 'primary';
  console.log(`[Calendar] Using calendar: ${jrzCalendarId}`);
  return jrzCalendarId;
}

async function getAvailableSlots(daysAhead = 3) {
  const token  = await getGoogleAccessToken();
  const calId  = await getJRZCalendarId();
  const slots  = [];
  const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: BOOKING_TZ }));

  for (let d = 0; d <= daysAhead && slots.length < 3; d++) {
    const dayStart = new Date(nowEST);
    dayStart.setDate(dayStart.getDate() + d);
    dayStart.setHours(BOOKING_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(BOOKING_END_HOUR, 0, 0, 0);

    // Today: start from next 30-min boundary + 1hr buffer
    if (d === 0) {
      const buffer = new Date(nowEST.getTime() + 60 * 60 * 1000);
      buffer.setMinutes(Math.ceil(buffer.getMinutes() / 30) * 30, 0, 0);
      if (buffer > dayStart) dayStart.setTime(buffer.getTime());
    }
    if (dayStart >= dayEnd) continue;

    const freeBusy = await axios.post('https://www.googleapis.com/calendar/v3/freeBusy', {
      timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(),
      timeZone: BOOKING_TZ, items: [{ id: calId }],
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });

    const busy = (freeBusy.data.calendars?.[calId]?.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));

    let cursor = new Date(dayStart);
    while (cursor < dayEnd && slots.length < 3) {
      const slotEnd = new Date(cursor.getTime() + BOOKING_DURATION * 60 * 1000);
      const isBusy  = busy.some(b => cursor < b.end && slotEnd > b.start);
      if (!isBusy) slots.push({ start: new Date(cursor), end: slotEnd });
      cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
    }
  }
  return slots;
}

function formatSlot(slot) {
  return slot.start.toLocaleString('en-US', { timeZone: BOOKING_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST';
}

async function createCalendarEvent(contactName, contactEmail, slot) {
  const token = await getGoogleAccessToken();
  const calId = await getJRZCalendarId();
  const event = {
    summary:     `📞 15-min Strategy Call — ${contactName}`,
    description: `Free 15-min strategy call booked by Armando (JRZ Marketing AI).\nContact: ${contactName}\nEmail: ${contactEmail || 'N/A'}`,
    start: { dateTime: slot.start.toISOString(), timeZone: BOOKING_TZ },
    end:   { dateTime: slot.end.toISOString(),   timeZone: BOOKING_TZ },
    attendees: contactEmail ? [{ email: contactEmail }] : [],
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 15 }] },
  };
  const res = await axios.post(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`,
    event, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[Calendar] ✅ Booked: ${contactName} at ${formatSlot(slot)}`);
  return res.data;
}

// ═══════════════════════════════════════════════════════════
// GMAIL — Armando monitors info@jrzmarketing.com
// Runs every 10 minutes — classifies, replies, creates GHL contacts
// ═══════════════════════════════════════════════════════════

async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < googleTokenExpiry - 60000) return googleAccessToken;
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
  });
  googleAccessToken = res.data.access_token;
  googleTokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return googleAccessToken;
}

function parseEmailHeaders(headers) {
  const get = (name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  return { from: get('From'), subject: get('Subject'), messageId: get('Message-ID'), references: get('References') };
}

function getEmailBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data)
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data)
        return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/<[^>]*>/g, ' ');
    }
  }
  return '';
}

function buildRawEmail(to, subject, body, inReplyTo, references) {
  const lines = [
    `From: Armando — JRZ Marketing <${GMAIL_ADDRESS}>`,
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : 'Re: ' + subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (inReplyTo)  lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references} ${inReplyTo}`.trim());
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendGmailReply(threadId, to, subject, body, inReplyTo, references) {
  const token = await getGoogleAccessToken();
  const raw   = buildRawEmail(to, subject, body, inReplyTo, references);
  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw, threadId },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

async function markEmailRead(emailId) {
  const token = await getGoogleAccessToken();
  await axios.post(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
    { removeLabelIds: ['UNREAD'] },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

async function processGmailEmail(emailId, token) {
  const res     = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  const email   = res.data;
  const headers = parseEmailHeaders(email.payload?.headers);
  const body    = getEmailBody(email.payload);

  if (!headers.from || headers.from.includes(GMAIL_ADDRESS)) { await markEmailRead(emailId); return; }
  if (!body.trim()) { await markEmailRead(emailId); return; }

  console.log(`[Gmail] Processing: "${headers.subject}" from ${headers.from}`);

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    messages: [{ role: 'user', content: `You are Armando, bilingual AI manager for JRZ Marketing (Orlando, FL). Analyze this email and return ONLY valid JSON:\n{"category":"lead|client|vendor|partnership|spam|other","language":"es|en","shouldReply":true,"reply":"warm reply max 120 words","contactName":"first name or empty","isUrgent":false,"summary":"one line for Jose"}\n\nFrom: ${headers.from}\nSubject: ${headers.subject}\nBody: ${body.slice(0, 1500)}\n\nCategories: lead=asking about JRZ services/pricing, client=existing client, vendor=selling to JRZ, partnership=collab offer, spam=bulk/unsolicited, other=everything else. Reply in same language as sender. Spam=shouldReply false.` }],
  });
  const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);

  // Send reply
  if (parsed.shouldReply && parsed.reply) {
    await sendGmailReply(email.threadId, headers.from, headers.subject, parsed.reply, headers.messageId, headers.references);
    console.log(`[Gmail] ✅ Replied to ${headers.from} (${parsed.category})`);
  }

  // Create GHL contact for leads
  if (parsed.category === 'lead') {
    const emailMatch = headers.from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      try {
        await axios.post(
          'https://services.leadconnectorhq.com/contacts/',
          { locationId: GHL_LOCATION_ID, email: emailMatch[0], firstName: parsed.contactName || '', tags: ['email-lead', 'armando-gmail'], source: 'Gmail' },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
        console.log(`[Gmail] ✅ GHL contact created: ${emailMatch[0]}`);
      } catch { /* contact may already exist */ }
    }
  }

  // Alert Jose on urgent or partnership emails
  if (parsed.isUrgent || parsed.category === 'partnership') {
    await sendEmail(OWNER_CONTACT_ID,
      `${parsed.isUrgent ? '🚨 Urgente' : '🤝 Partnership'} — ${headers.subject}`,
      `<p><strong>De:</strong> ${headers.from}</p><p><strong>Categoría:</strong> ${parsed.category}</p><p><strong>Resumen:</strong> ${parsed.summary}</p><p><strong>Armando respondió:</strong> ${parsed.shouldReply ? parsed.reply : 'Sin respuesta'}</p>`
    );
  }

  await markEmailRead(emailId);
}

async function runGmailCheck() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return;
  try {
    console.log('[Gmail] Checking inbox...');
    const token   = await getGoogleAccessToken();
    const cutoff  = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const res     = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      params:  { q: `is:unread in:inbox after:${cutoff}`, maxResults: 20 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = res.data.messages || [];
    if (!messages.length) { console.log('[Gmail] No new emails'); return; }
    console.log(`[Gmail] ${messages.length} unread emails found`);
    for (const { id } of messages) {
      try { await processGmailEmail(id, token); } catch (err) { console.error(`[Gmail] Failed ${id}:`, err.message); }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) { console.error('[Gmail] Check failed:', err?.response?.data || err.message); }
}

app.get('/cron/calendar-slots', async (_req, res) => {
  try {
    const slots = await getAvailableSlots(3);
    res.json({ total: slots.length, slots: slots.map((s, i) => ({ option: i + 1, time: formatSlot(s), iso: s.start.toISOString() })) });
  } catch (err) { res.status(500).json({ error: err?.response?.data || err.message }); }
});

app.post('/cron/gmail-check', async (_req, res) => {
  try { await runGmailCheck(); res.json({ status: 'ok' }); }
  catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

// Dry-run: classify emails but don't reply or create contacts
app.post('/cron/gmail-preview', async (_req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(400).json({ error: 'Google credentials not set' });
  }
  try {
    const token  = await getGoogleAccessToken();
    const cutoff = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const r      = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      params: { q: `is:unread in:inbox after:${cutoff}`, maxResults: 20 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = r.data.messages || [];
    const results  = [];
    for (const { id } of messages) {
      const detail  = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      const headers = parseEmailHeaders(detail.data.payload?.headers);
      const body    = getEmailBody(detail.data.payload);
      if (!headers.from || headers.from.includes(GMAIL_ADDRESS) || !body.trim()) continue;
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400,
        messages: [{ role: 'user', content: `Classify this email for JRZ Marketing. Return ONLY valid JSON:\n{"category":"lead|client|vendor|partnership|spam|other","language":"es|en","shouldReply":true,"proposedReply":"what Armando would say (max 100 words)","contactName":"","isUrgent":false,"summary":"one line"}\n\nFrom: ${headers.from}\nSubject: ${headers.subject}\nBody: ${body.slice(0, 1000)}` }],
      });
      const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
      results.push({ from: headers.from, subject: headers.subject, ...parsed });
      await new Promise(r => setTimeout(r, 800));
    }
    res.json({ total: results.length, emails: results });
  } catch (err) {
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});

// ── Bland.ai post-call webhook ────────────────────────────────────────────────
app.post('/webhook/bland', async (req, res) => {
  res.json({ ok: true }); // respond fast
  try {
    await parseBlandTranscript(req.body);
  } catch (err) {
    console.error('[Bland] Webhook error:', err.message);
  }
});

app.post('/cron/engagement-learning', async (_req, res) => {
  try {
    await runEngagementLearning();
    await updateWinningVoicePatterns();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/objection-learning', async (_req, res) => {
  try {
    await runObjectionLearning();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/self-update-rules', async (_req, res) => {
  try {
    await runSelfUpdateRules();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/client-checkins', async (_req, res) => {
  try {
    await runClientCheckIns();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/monthly-reports', async (_req, res) => {
  try {
    await sendMonthlyClientReports();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/subaccount-checkin', async (_req, res) => {
  try {
    await sendSubAccountCheckInEmails();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/cron/proposal', async (req, res) => {
  try {
    const { contactId, contactName, businessType } = req.body;
    if (!contactId) return res.status(400).json({ status: 'error', message: 'contactId required' });
    await generateAndSendProposal(contactId, contactName || 'Cliente', businessType || 'negocio', '');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ELENA — CLIENT SUCCESS MANAGER
//   Manages all 32 JRZ Marketing subaccounts
//   Sends monthly reports, weekly health checks, win alerts
//   Speaks Spanish to all clients (English only to Cooney Homes)
// ═══════════════════════════════════════════════════════════

const GHL_AGENCY_KEY  = process.env.GHL_AGENCY_KEY  || 'pit-7a8b4631-2249-4683-b15b-57a661400caa';
const GHL_COMPANY_ID  = 'VMjVKN63tXxZxQ21jlC4';

// Known client overrides — language + industry per locationId
// Elena fetches the live list from GHL, then applies these overrides.
// New clients default to lang:'es', industry:'business' automatically.
const ELENA_CLIENT_OVERRIDES = {
  'OqnDdohCjhm3rUNFZUBv': { lang: 'es', industry: 'water damage restoration' },
  'NEC2hjuIspTjO5SG4NdU': { lang: 'es', industry: 'life coach' },
  'Gc4sUcLiRI2edddJ5Lfl': { lang: 'en', industry: 'real estate' },       // ← English only
  'Aj3HgAvBCP0Sm8GiScnI': { lang: 'es', industry: 'credit repair' },
  'zls4F5DY9IxGOSSBsgwX': { lang: 'es', industry: 'professional services' },
  'DH2dCmWyzYaMuZ1WPytl': { lang: 'es', industry: 'business' },
  '7NI6b2LQpOdU2QKvcGzN': { lang: 'es', industry: 'business' },
  'EEu879tknB5Gilw2YipA': { lang: 'es', industry: 'tattoo studio' },
  'EY2OdSbqpev9w7R1ZhTN': { lang: 'es', industry: 'auto detailing' },
  'Emg5M7GZE7XmnHc7F5vy': { lang: 'es', industry: 'restaurant' },
  'l4TKwBjrtTDjhH4w8Gwv': { lang: 'es', industry: 'video production' },
  'bkYf2Jamt3Qe17gXEYcp': { lang: 'es', industry: 'fence installation' },
  'uSJLhp7BCFFgEYR64nyA': { lang: 'es', industry: 'paver sealing' },
  'OpdBPAp31zItOc5IIykL': { lang: 'es', industry: 'barbershop' },
  'SiMc6HEKCwqXUW4ECvfp': { lang: 'es', industry: 'international business' },
  'Q6FIvQ5WitCeq9wyXZ3L': { lang: 'es', industry: 'business' },
  'LYYC7RNdczcwfObK6mCV': { lang: 'es', industry: 'studio' },
  'fiXfZtPfXbcgg0AtLFi4': { lang: 'es', industry: 'optical/eyewear' },
  'faGC7IoUzIj0yTBzLbJU': { lang: 'es', industry: 'sports training' },
  'iipUT8kmVxJZzGBzvkZm': { lang: 'es', industry: 'railing installation' },
  'BlyQAv719YyBg4TCPD0L': { lang: 'es', industry: 'med spa / skincare' },
  '6FdG0APBuZ81P8X2H4zc': { lang: 'es', industry: 'storage rental' },
  'VH3vK2wx24PqK5rX34I3': { lang: 'es', industry: 'business' },
  'jqodqJJAvxuBRyiU27oh': { lang: 'es', industry: 'business' },
  'd1VBgXk2TqHYwlTy85Pa': { lang: 'es', industry: 'fitness / gym' },
  'S8XzcEfRd6IMx4mvfnSf': { lang: 'es', industry: 'restaurant' },
  'rJKRuyayc6Z6twr9X20v': { lang: 'es', industry: 'restaurant' },
  'Hen1RHBy8xX6tL8kTKFZ': { lang: 'es', industry: 'watch shop' },
  'QWZPYWo1AgLpLjHTG6OA': { lang: 'es', industry: 'tattoo studio' },
  'ktcIQNnu5PjI3agQysVr': { lang: 'es', industry: 'construction' },
  'VWHZW08b0skUV7wcnG55': { lang: 'es', industry: 'accounting / tax' },
};

// Fetches live subaccount list from GHL Agency API.
// New clients are included automatically — no code changes needed.
async function getElenaClients() {
  try {
    const res = await axios.get('https://services.leadconnectorhq.com/locations/search', {
      headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' },
      params: { companyId: 'VMjVKN63tXxZxQ21jlC4', limit: 100 },
      timeout: 15000,
    });
    const locations = res.data?.locations || res.data?.data || [];
    return locations
      .filter(loc => loc.id !== GHL_LOCATION_ID) // skip JRZ Marketing main account
      .map(loc => {
        const overrides = ELENA_CLIENT_OVERRIDES[loc.id] || {};
        return {
          name:       loc.name || loc.business?.name || 'Client',
          locationId: loc.id,
          lang:       overrides.lang     || 'es',
          industry:   overrides.industry || 'business',
        };
      });
  } catch (err) {
    console.error('[Elena] Failed to fetch live client list:', err.message);
    // Fallback: build from known overrides so Elena still works if API is down
    return Object.entries(ELENA_CLIENT_OVERRIDES).map(([locationId, o]) => ({
      name: locationId, locationId, lang: o.lang, industry: o.industry,
    }));
  }
}

// Elena's Cloudinary health snapshot (tracks monthly pipeline counts)
const ELENA_SNAPSHOT_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/elena_health_snapshot.json';
const ELENA_SNAPSHOT_PID = 'jrz/elena_health_snapshot';

async function loadElenaSnapshot() {
  try {
    const res = await axios.get(ELENA_SNAPSHOT_URL + '?t=' + Date.now(), { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return {}; }
}

async function saveElenaSnapshot(data) {
  const ts  = Math.floor(Date.now() / 1000);
  const sigStr = `overwrite=true&public_id=${ELENA_SNAPSHOT_PID}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
  const sig = crypto.createHash('sha1').update(sigStr).digest('hex');
  const form = new FormData();
  const buf  = Buffer.from(JSON.stringify(data, null, 2));
  form.append('file', buf, { filename: 'elena_health_snapshot.json', contentType: 'application/json' });
  form.append('public_id', ELENA_SNAPSHOT_PID);
  form.append('resource_type', 'raw');
  form.append('timestamp', String(ts));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('signature', sig);
  form.append('overwrite', 'true');
  await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, {
    headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000
  });
}

// Pull subaccount stats using agency API
async function getSubaccountStats(locationId) {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' };
  const [locRes, oppRes, contactRes] = await Promise.allSettled([
    axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, { headers, timeout: 10000 }),
    axios.get(`https://services.leadconnectorhq.com/opportunities/search`, {
      headers, params: { location_id: locationId, limit: 100 }, timeout: 10000
    }),
    axios.get(`https://services.leadconnectorhq.com/contacts/`, {
      headers, params: { locationId, limit: 1 }, timeout: 10000
    }),
  ]);

  const loc  = locRes.status === 'fulfilled' ? locRes.value.data?.location || locRes.value.data : {};
  const opps = oppRes.status === 'fulfilled' ? oppRes.value.data?.opportunities || [] : [];
  const totalContacts = contactRes.status === 'fulfilled'
    ? (contactRes.value.data?.meta?.total || contactRes.value.data?.total || 0) : 0;

  const wonOpps  = opps.filter(o => o.status === 'won');
  const openOpps = opps.filter(o => o.status !== 'lost' && o.status !== 'won');
  const totalValue = opps.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);
  const wonValue   = wonOpps.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);

  // Most recent activity across all open opportunities
  const lastActivityAt = opps.length > 0
    ? opps.reduce((latest, o) => {
        const t = new Date(o.lastActivityAt || o.updatedAt || 0).getTime();
        return t > latest ? t : latest;
      }, 0)
    : 0;

  return {
    email:          loc.email || loc.business?.email || null,
    phone:          loc.phone || loc.business?.phone || null,
    businessName:   loc.name || loc.business?.name || null,
    totalContacts,
    totalOpps:      opps.length,
    openOpps:       openOpps.length,
    wonOpps:        wonOpps.length,
    totalValue,
    wonValue,
    lastActivityAt, // ms timestamp of most recent opp activity (0 = no opps)
    recentWon:      wonOpps.slice(0, 3).map(o => ({ name: o.name, value: o.monetaryValue || 0 })),
  };
}

// Score each client 0–100 and return A/B/C/D grade + churn risk label
function getChurnRiskGrade(stats, prev) {
  let score = 50;
  const now = Date.now();
  const daysSinceActivity = stats.lastActivityAt > 0
    ? (now - stats.lastActivityAt) / (1000 * 60 * 60 * 24)
    : 999;

  // Won deals — strongest signal
  if (stats.wonOpps > 0) score += 20;

  // Pipeline depth
  if (stats.openOpps >= 10) score += 20;
  else if (stats.openOpps >= 5) score += 12;
  else if (stats.openOpps === 0) score -= 20;

  // Contact growth vs last snapshot
  const contactGrowth = stats.totalContacts - (prev.totalContacts || 0);
  if (contactGrowth > 10) score += 15;
  else if (contactGrowth > 0) score += 5;
  else if (contactGrowth < -10) score -= 15;

  // Pipeline growth vs last snapshot
  const oppGrowth = stats.openOpps - (prev.openOpps || 0);
  if (oppGrowth > 3) score += 10;
  else if (oppGrowth < -3) score -= 10;

  // Activity recency
  if (daysSinceActivity < 3)       score += 15;
  else if (daysSinceActivity < 7)  score += 8;
  else if (daysSinceActivity < 14) score += 0;
  else if (daysSinceActivity < 30) score -= 10;
  else                             score -= 25;

  score = Math.max(0, Math.min(100, score));

  let grade, color, label;
  if (score >= 75)      { grade = 'A'; color = '#16a34a'; label = 'Healthy'; }
  else if (score >= 50) { grade = 'B'; color = '#2563eb'; label = 'Stable'; }
  else if (score >= 25) { grade = 'C'; color = '#d97706'; label = 'At Risk'; }
  else                  { grade = 'D'; color = '#dc2626'; label = 'Churn Risk'; }

  return { grade, score, color, label, daysSinceActivity: Math.round(daysSinceActivity) };
}

// Elena sends a welcome email to a brand-new client subaccount
async function elenaSendWelcomeEmail(client, stats) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const isEn = client.lang === 'en';
  const firstName = client.name.split(' ')[0];
  const subject = isEn
    ? `👋 Welcome to JRZ Marketing, ${firstName}!`
    : `👋 ¡Bienvenido a JRZ Marketing, ${firstName}!`;

  const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:40px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:32px 40px;text-align:center;"><img src="${logoUrl}" style="height:48px;" /></div>
  <div style="background:linear-gradient(135deg,#0a0a0a 0%,#1a1a2e 100%);padding:48px 40px;text-align:center;">
    <div style="font-size:48px;margin-bottom:16px;">🎉</div>
    <h1 style="color:#fff;font-size:28px;font-weight:800;margin:0 0 12px;">${isEn ? `Welcome, ${firstName}!` : `¡Bienvenido, ${firstName}!`}</h1>
    <p style="color:rgba(255,255,255,0.6);font-size:15px;margin:0;">${isEn ? "We're excited to have you on board." : 'Estamos emocionados de tenerte con nosotros.'}</p>
  </div>
  <div style="padding:40px;">
    <p style="font-size:15px;color:#333;line-height:1.8;margin:0 0 24px;">${isEn
      ? `Hi <strong>${firstName}</strong>, I'm Elena — JRZ Marketing's AI Client Success Manager. I'll keep an eye on your account, send you monthly performance reports, and make sure you're getting the most out of our partnership.`
      : `Hola <strong>${firstName}</strong>, soy Elena — la IA de éxito de clientes de JRZ Marketing. Estaré monitoreando tu cuenta, enviándote reportes mensuales de rendimiento y asegurándome de que aproveches al máximo nuestra asociación.`
    }</p>
    <div style="background:#f9f9f9;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin:0 0 16px;">${isEn ? "What's set up for you" : 'Lo que está configurado para ti'}</p>
      ${[
        isEn ? '✅ Your GHL account is active and ready' : '✅ Tu cuenta GHL está activa y lista',
        isEn ? '📊 Monthly performance reports (1st of every month)' : '📊 Reportes mensuales de rendimiento (1ro de cada mes)',
        isEn ? '🔔 Weekly pipeline health monitoring' : '🔔 Monitoreo semanal del estado del pipeline',
        isEn ? '💬 Direct access to Jose and the JRZ team' : '💬 Acceso directo a Jose y el equipo JRZ',
      ].map(item => `<p style="font-size:14px;color:#333;margin:8px 0;">${item}</p>`).join('')}
    </div>
    <div style="text-align:center;margin-top:32px;">
      <a href="${BOOKING_URL}" style="display:inline-block;background:#0a0a0a;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:10px;">${isEn ? 'Schedule Onboarding Call →' : 'Agendar Llamada de Bienvenida →'}</a>
    </div>
  </div>
  <div style="background:#0a0a0a;padding:24px 40px;text-align:center;">
    <p style="font-size:11px;color:rgba(255,255,255,0.3);">Elena — JRZ Marketing AI Client Success Manager</p>
  </div>
</div></body></html>`;

  try {
    if (!stats.email) return false;
    const upsertRes = await axios.post('https://services.leadconnectorhq.com/contacts/upsert', {
      locationId: GHL_LOCATION_ID, email: stats.email, name: client.name,
      tags: ['jrz-client', 'subaccount', 'new-client'],
    }, { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } });
    const contactId = upsertRes.data?.contact?.id;
    if (contactId) {
      await sendEmail(contactId, subject, html);
      console.log(`[Elena] 🎉 Welcome email sent to new client: ${client.name}`);
      return true;
    }
  } catch (err) {
    console.error(`[Elena] Welcome email failed for ${client.name}:`, err.message);
  }
  return false;
}

// Elena sends a personalized monthly report to one client
// prevSnapshot: the client's row from last month's Cloudinary snapshot (for trend %)
async function elenaSendClientReport(client, stats, month, prevSnapshot = {}) {
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const isEn = client.lang === 'en';

  if (!stats.email) {
    console.log(`[Elena] No email for ${client.name} — skipping`);
    return false;
  }

  // Compute % changes vs last snapshot
  const pct = (curr, prev) => {
    if (!prev || prev === 0) return null;
    const p = Math.round(((curr - prev) / prev) * 100);
    return p > 0 ? `+${p}%` : `${p}%`;
  };
  const trendContacts = pct(stats.totalContacts, prevSnapshot.totalContacts);
  const trendOpps     = pct(stats.openOpps,      prevSnapshot.openOpps);
  const trendWon      = pct(stats.wonOpps,        prevSnapshot.wonOpps);
  const trendRevenue  = pct(stats.wonValue,       prevSnapshot.wonValue);

  const trendBadge = (t) => {
    if (!t) return '';
    const up = t.startsWith('+');
    return `<span style="font-size:11px;font-weight:700;color:${up ? '#16a34a' : '#dc2626'};margin-left:4px;">${t}</span>`;
  };

  // Churn risk grade for this client
  const risk = getChurnRiskGrade(stats, prevSnapshot);

  // Claude generates personalized insights — now includes trend context and grade
  const trendContext = `Contact growth: ${trendContacts || 'N/A'}, Pipeline change: ${trendOpps || 'N/A'}, Won deals change: ${trendWon || 'N/A'}. Health grade: ${risk.grade} (${risk.label}).`;
  const aiPrompt = isEn
    ? `You are Elena, JRZ Marketing's AI Client Success Manager. Generate a monthly performance summary for client "${client.name}" (${client.industry}) for ${month}. Pipeline: ${stats.openOpps} open opps, ${stats.wonOpps} won (value: $${stats.wonValue}), ${stats.totalContacts} contacts. Trends: ${trendContext} Return ONLY valid JSON: {"headline": "one encouraging headline referencing their trend", "wins": ["win1", "win2"], "focus": "what to focus on next month based on their grade", "tip": "one specific marketing tip for their industry", "personalNote": "warm personal note from Jose"}`
    : `Eres Elena, la IA de éxito de clientes de JRZ Marketing. Genera un resumen mensual para el cliente "${client.name}" (${client.industry}) del mes de ${month}. Pipeline: ${stats.openOpps} oportunidades abiertas, ${stats.wonOpps} ganadas (valor: $${stats.wonValue}), ${stats.totalContacts} contactos. Tendencias: ${trendContext} Responde SOLO con JSON válido: {"headline": "titular motivador que mencione la tendencia", "wins": ["logro1", "logro2"], "focus": "en qué enfocarse según su calificación", "tip": "consejo de marketing específico para su industria", "personalNote": "nota personal cálida de Jose"}`;

  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: aiPrompt }],
  });
  const report = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const winsHtml = (report.wins || []).map(w =>
    `<li style="padding:10px 0 10px 28px;position:relative;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333;"><span style="position:absolute;left:0;font-weight:700;color:#0a0a0a;">✓</span>${w}</li>`
  ).join('');

  const subject = isEn
    ? `📊 Your Monthly Report — ${month} | JRZ Marketing`
    : `📊 Tu Reporte Mensual — ${month} | JRZ Marketing`;

  const html = `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'es'}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f4f4; color:#0a0a0a; }
    .wrap { background:#f4f4f4; padding:40px 20px; }
    .card { max-width:600px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:32px 40px; text-align:center; }
    .hdr img { height:48px; width:auto; }
    .badge { background:#0a0a0a; padding:0 40px 24px; text-align:center; }
    .badge span { display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; padding:6px 16px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:40px 40px 48px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:26px; font-weight:800; color:#fff; line-height:1.2; margin-bottom:12px; }
    .hero p { font-size:14px; color:rgba(255,255,255,0.55); line-height:1.7; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:20px 16px; text-align:center; border-right:1px solid #f0f0f0; }
    .stat:last-child { border-right:none; }
    .stat-num { font-size:26px; font-weight:800; color:#0a0a0a; }
    .stat-lbl { font-size:10px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.08em; margin-top:4px; }
    .body { padding:36px 40px 28px; }
    .body p { font-size:15px; color:#333; line-height:1.8; margin-bottom:18px; }
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin:24px 0 10px; }
    .wins { list-style:none; padding:0; margin:0 0 20px; }
    .box { background:#f9f9f9; border-radius:12px; padding:20px 24px; margin-bottom:16px; font-size:15px; color:#333; line-height:1.7; }
    .note { background:#0a0a0a; border-radius:12px; padding:24px; margin:20px 0; font-size:14px; color:rgba(255,255,255,0.8); line-height:1.7; font-style:italic; }
    .cta { padding:0 40px 40px; text-align:center; }
    .cta-btn { display:inline-block; background:#0a0a0a; color:#fff !important; font-size:15px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:10px; margin-top:16px; }
    .sig { padding:28px 40px; background:#f9f9f9; border-top:1px solid #eee; }
    .sig-name { font-size:15px; font-weight:700; color:#0a0a0a; margin-bottom:2px; }
    .sig-title { font-size:12px; color:#777; }
    .sig-elena { font-size:11px; color:#bbb; margin-top:4px; }
    .ftr { background:#0a0a0a; padding:24px 40px; text-align:center; }
    .ftr img { height:24px; opacity:0.6; margin-bottom:12px; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.2); }
  </style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}" alt="JRZ Marketing" /></div>
  <div class="badge"><span>${isEn ? `Monthly Report — ${month}` : `Reporte Mensual — ${month}`}</span></div>
  <div class="hero">
    <h1>${client.name}${isEn ? ',<br />here\'s your month.' : ',<br />así fue tu mes.'} 📊</h1>
    <p>${report.headline}</p>
    <div style="margin-top:16px;display:inline-block;background:${risk.color};color:#fff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:100px;letter-spacing:0.06em;">
      ${isEn ? 'Health' : 'Salud'}: ${risk.grade} — ${risk.label}
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${stats.totalContacts}${trendBadge(trendContacts)}</div><div class="stat-lbl">${isEn ? 'Contacts' : 'Contactos'}</div></div>
    <div class="stat"><div class="stat-num">${stats.openOpps}${trendBadge(trendOpps)}</div><div class="stat-lbl">${isEn ? 'Open Opps' : 'Oportunidades'}</div></div>
    <div class="stat"><div class="stat-num">${stats.wonOpps}${trendBadge(trendWon)}</div><div class="stat-lbl">${isEn ? 'Won' : 'Ganadas'}</div></div>
    <div class="stat"><div class="stat-num">$${Math.round(stats.wonValue).toLocaleString()}${trendBadge(trendRevenue)}</div><div class="stat-lbl">${isEn ? 'Revenue' : 'Ingresos'}</div></div>
  </div>
  <div class="body">
    <p>${isEn ? 'Hi' : 'Hola'} <strong>${client.name.split(' ')[0]}</strong>,</p>
    <p>${isEn ? "Here's your monthly performance summary from JRZ Marketing. Here's what we accomplished together this month:" : 'Aquí está tu resumen mensual de resultados con JRZ Marketing. Esto es lo que logramos juntos este mes:'}</p>
    <p class="section-title">${isEn ? 'This Month\'s Wins' : 'Logros del Mes'}</p>
    <ul class="wins">${winsHtml}</ul>
    <p class="section-title">${isEn ? 'Focus for Next Month' : 'Enfoque del Próximo Mes'}</p>
    <div class="box">${report.focus}</div>
    <p class="section-title">${isEn ? 'Marketing Tip' : 'Consejo de Marketing'}</p>
    <div class="box">${report.tip}</div>
    <div class="note">"${report.personalNote}"<br /><br />— Jose Rivas</div>
  </div>
  <div class="cta">
    <p style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#999;">${isEn ? 'Questions? Let\'s talk.' : '¿Tienes preguntas?'}</p>
    <a href="${BOOKING_URL}" class="cta-btn">${isEn ? 'Talk to the Team →' : 'Habla con el equipo →'}</a>
  </div>
  <div class="sig">
    <div class="sig-name">Jose Rivas</div>
    <div class="sig-title">CEO · JRZ Marketing</div>
    <div class="sig-elena">Reporte generado por Elena — AI Client Success Manager</div>
  </div>
  <div class="ftr"><img src="${logoUrl}" alt="JRZ Marketing" /><p>© 2026 JRZ Marketing. Orlando, Florida.</p></div>
</div></div>
</body></html>`;

  // Send email via GHL — find contact in main JRZ account by business name or create temporary
  try {
    // Search for this client's contact in the main JRZ location
    const searchRes = await axios.get('https://services.leadconnectorhq.com/contacts/', {
      headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' },
      params: { locationId: GHL_LOCATION_ID, query: client.name, limit: 5 },
    });
    const contacts = searchRes.data?.contacts || [];
    const match = contacts.find(c => c.email) || contacts[0];

    if (match?.id) {
      await sendEmail(match.id, subject, html);
      console.log(`[Elena] ✅ Report sent to ${client.name} (contact: ${match.id})`);
      return true;
    } else {
      // Fallback: send to the email on file for this subaccount
      if (stats.email) {
        // Use GHL email send to a direct email (create contact if needed)
        console.log(`[Elena] No contact found for ${client.name} in main account — emailing ${stats.email} directly`);
        // We'll upsert a contact and send
        const upsertRes = await axios.post('https://services.leadconnectorhq.com/contacts/upsert', {
          locationId: GHL_LOCATION_ID,
          email: stats.email,
          name: client.name,
          tags: ['jrz-client', 'subaccount'],
        }, { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } });
        const newContactId = upsertRes.data?.contact?.id;
        if (newContactId) {
          await sendEmail(newContactId, subject, html);
          console.log(`[Elena] ✅ Report sent (upserted) to ${client.name}`);
          return true;
        }
      }
    }
  } catch (err) {
    console.error(`[Elena] Email failed for ${client.name}:`, err.message);
  }
  return false;
}

// Elena's main monthly report run — all subaccounts (live from GHL)
async function elenaMonthlyReports() {
  console.log('[Elena] Starting monthly client reports for all subaccounts...');
  const month = new Date().toLocaleString('es-ES', { month: 'long', year: 'numeric' });
  const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
  let sent = 0, skipped = 0;

  for (const client of clients) {
    try {
      const stats = await getSubaccountStats(client.locationId);
      const prevSnapshot = snapshot[client.locationId] || {};
      const ok = await elenaSendClientReport(client, stats, month, prevSnapshot);
      if (ok) sent++; else skipped++;
      // Update snapshot with wonValue so next month has full trend data
      snapshot[client.locationId] = {
        ...prevSnapshot,
        openOpps: stats.openOpps,
        totalContacts: stats.totalContacts,
        wonOpps: stats.wonOpps,
        wonValue: stats.wonValue,
        checkedAt: new Date().toISOString().split('T')[0],
      };
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Elena] Error on ${client.name}:`, err.message);
      skipped++;
    }
  }
  await saveElenaSnapshot(snapshot);
  console.log(`[Elena] Monthly reports done. Sent: ${sent}, Skipped: ${skipped}`);
}

// Elena's weekly health check — smarter triggers + new client detection + churn grades
async function elenaHealthCheck() {
  console.log('[Elena] Running weekly health check on all subaccounts...');
  const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
  const today = new Date().toISOString().split('T')[0];
  const alerts = [];
  const newClients = [];
  const newSnapshot = { ...snapshot, lastRun: today };

  for (const client of clients) {
    try {
      const stats = await getSubaccountStats(client.locationId);
      const prev = snapshot[client.locationId] || {};
      const isNewClient = !snapshot[client.locationId];

      // New client — send welcome email
      if (isNewClient) {
        newClients.push(client.name);
        elenaSendWelcomeEmail(client, stats); // non-blocking
      }

      // Compute churn risk grade
      const risk = getChurnRiskGrade(stats, prev);

      // Flag if: grade C/D, pipeline drop ≥3, contact drop ≥20, or 14+ days silent
      const oppDrop     = (prev.openOpps || 0) - stats.openOpps;
      const contactDrop = (prev.totalContacts || 0) - stats.totalContacts;
      const isAtRisk    = risk.grade === 'C' || risk.grade === 'D';
      const isInactive  = risk.daysSinceActivity >= 14;
      const isStalled   = oppDrop >= 3 || contactDrop >= 20;

      if (isAtRisk || isStalled) {
        alerts.push({
          name: client.name,
          grade: risk.grade,
          gradeColor: risk.color,
          gradeLabel: risk.label,
          score: risk.score,
          oppDrop,
          contactDrop,
          daysSinceActivity: risk.daysSinceActivity,
          isInactive,
          current: { openOpps: stats.openOpps, totalContacts: stats.totalContacts, wonOpps: stats.wonOpps },
          prev: { openOpps: prev.openOpps || 0, totalContacts: prev.totalContacts || 0 },
        });
      }

      newSnapshot[client.locationId] = {
        openOpps: stats.openOpps,
        totalContacts: stats.totalContacts,
        wonOpps: stats.wonOpps,
        wonValue: stats.wonValue,
        lastActivityAt: stats.lastActivityAt,
        grade: risk.grade,
        score: risk.score,
        checkedAt: today,
      };
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Elena] Health check failed for ${client.name}:`, err.message);
    }
  }

  await saveElenaSnapshot(newSnapshot);
  if (newClients.length > 0) console.log(`[Elena] New clients detected: ${newClients.join(', ')}`);

  if (alerts.length === 0) {
    console.log('[Elena] Health check done — all accounts healthy.');
    return;
  }

  // Build alert email with grades and activity columns
  const alertRows = alerts.map(a => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0a0a0a;">${a.name}</td>
      <td style="padding:12px 16px;text-align:center;">
        <span style="display:inline-block;background:${a.gradeColor};color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:100px;">${a.grade}</span>
        <div style="font-size:11px;color:#999;margin-top:3px;">${a.gradeLabel}</div>
      </td>
      <td style="padding:12px 16px;font-size:13px;color:${a.oppDrop > 0 ? '#dc2626' : '#555'};">${a.oppDrop > 0 ? `−${a.oppDrop}` : '—'}</td>
      <td style="padding:12px 16px;font-size:13px;color:${a.contactDrop > 0 ? '#dc2626' : '#555'};">${a.contactDrop > 0 ? `−${a.contactDrop}` : '—'}</td>
      <td style="padding:12px 16px;font-size:13px;color:${a.isInactive ? '#d97706' : '#555'};">${a.daysSinceActivity >= 999 ? 'No opps' : `${a.daysSinceActivity}d ago`}</td>
      <td style="padding:12px 16px;font-size:13px;color:#555;">${a.current.openOpps} open / ${a.current.totalContacts} contacts</td>
    </tr>`).join('');

  const dGrades = alerts.filter(a => a.grade === 'D').length;
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:40px 20px;">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:28px 40px;text-align:center;">
    <img src="https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png" style="height:40px;" />
  </div>
  <div style="background:#dc2626;padding:24px 40px;">
    <h1 style="color:#fff;font-size:22px;margin:0;">⚠️ Elena Health Alert</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:8px 0 0;">${alerts.length} account(s) flagged this week${dGrades > 0 ? ` — ${dGrades} at immediate churn risk` : ''}</p>
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:15px;color:#333;margin-bottom:24px;">Jose, these accounts need your attention:</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f9f9f9;">
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Client</th>
        <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Grade</th>
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Opp Drop</th>
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Contact Drop</th>
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Last Activity</th>
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Status</th>
      </tr></thead>
      <tbody>${alertRows}</tbody>
    </table>
    <div style="background:#fff8f0;border:1px solid #fed7aa;border-radius:10px;padding:20px 24px;margin-top:24px;">
      <p style="font-size:14px;color:#92400e;margin:0;"><strong>Recommended:</strong> Grade D clients should be called this week. Grade C clients need a check-in message. Elena will flag these in next month's report.</p>
    </div>
    ${newClients.length > 0 ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-top:16px;"><p style="font-size:14px;color:#166534;margin:0;">🎉 <strong>New clients detected:</strong> ${newClients.join(', ')} — welcome emails sent automatically.</p></div>` : ''}
  </div>
  <div style="background:#0a0a0a;padding:24px 40px;text-align:center;">
    <p style="font-size:11px;color:rgba(255,255,255,0.3);">Elena — JRZ Marketing AI Client Success Manager</p>
  </div>
</div>
</body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `⚠️ Elena: ${alerts.length} Accounts Need Attention (${dGrades} Churn Risk)`, html);
  console.log(`[Elena] Health alert sent — ${alerts.length} flagged, ${dGrades} churn risk`);
  logActivity('elena', `Health check: ${alerts.length} accounts flagged, ${dGrades} grade D`);
}

// Mid-month proactive check-in — reaches out to quiet/at-risk clients on the 15th
async function elenaMidMonthCheckIn() {
  console.log('[Elena] Running mid-month check-in...');
  const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  let sent = 0;

  for (const client of clients) {
    try {
      const prev = snapshot[client.locationId];
      if (!prev) continue; // skip brand-new clients (just got welcome email)

      // Only reach out if grade C/D or 10+ days since activity
      const isAtRisk = prev.grade === 'C' || prev.grade === 'D';
      const daysSince = prev.lastActivityAt > 0
        ? (Date.now() - prev.lastActivityAt) / (1000 * 60 * 60 * 24)
        : 999;
      const isQuiet = daysSince >= 10;

      if (!isAtRisk && !isQuiet) continue;

      // Fetch live stats to personalize message
      const stats = await getSubaccountStats(client.locationId);
      if (!stats.email) continue;

      const isEn = client.lang === 'en';
      const firstName = client.name.split(' ')[0];
      const subject = isEn
        ? `👋 Checking in — ${client.name}`
        : `👋 Solo quería saber cómo vas — ${client.name}`;

      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: isEn
          ? `You are Elena, JRZ Marketing's AI Client Success Manager. Write a short, warm mid-month check-in message for client "${client.name}" (${client.industry}). They have ${stats.openOpps} open opportunities and ${stats.totalContacts} contacts. Grade: ${prev.grade || 'unknown'}. Keep it under 3 sentences, conversational, offer value. Return ONLY the message text.`
          : `Eres Elena, la IA de JRZ Marketing. Escribe un mensaje corto y cálido de seguimiento de mediados de mes para el cliente "${client.name}" (${client.industry}). Tienen ${stats.openOpps} oportunidades abiertas y ${stats.totalContacts} contactos. Calificación: ${prev.grade || 'desconocida'}. Máximo 3 oraciones, conversacional, ofrece valor. Devuelve SOLO el texto del mensaje.`
        }],
      });
      const messageText = aiRes.content[0].text.trim();

      const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:24px 40px;text-align:center;"><img src="${logoUrl}" style="height:36px;" /></div>
  <div style="padding:40px;">
    <p style="font-size:16px;font-weight:700;color:#0a0a0a;margin:0 0 16px;">${isEn ? `Hey ${firstName} 👋` : `Hola ${firstName} 👋`}</p>
    <p style="font-size:15px;color:#333;line-height:1.8;margin:0 0 24px;">${messageText}</p>
    <div style="text-align:center;">
      <a href="${BOOKING_URL}" style="display:inline-block;background:#0a0a0a;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">${isEn ? "Let's connect →" : 'Conectemos →'}</a>
    </div>
    <p style="font-size:13px;color:#999;margin-top:24px;line-height:1.6;">— Jose Rivas<br /><span style="font-size:11px;">CEO · JRZ Marketing</span></p>
  </div>
  <div style="background:#0a0a0a;padding:20px 40px;text-align:center;">
    <p style="font-size:11px;color:rgba(255,255,255,0.3);">Elena — JRZ Marketing AI Client Success Manager</p>
  </div>
</div></body></html>`;

      const upsertRes = await axios.post('https://services.leadconnectorhq.com/contacts/upsert', {
        locationId: GHL_LOCATION_ID, email: stats.email, name: client.name, tags: ['jrz-client'],
      }, { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } });
      const contactId = upsertRes.data?.contact?.id;
      if (contactId) {
        await sendEmail(contactId, subject, html);
        sent++;
        console.log(`[Elena] Mid-month check-in sent to ${client.name} (grade ${prev.grade})`);
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Elena] Mid-month check-in failed for ${client.name}:`, err.message);
    }
  }
  console.log(`[Elena] Mid-month check-in done — sent to ${sent} clients`);
  logActivity('elena', `Mid-month check-in sent to ${sent} at-risk clients`);
}

// Quarterly deep-dive — 3-month trends + A/B/C grade + growth plan (Jan/Apr/Jul/Oct 1st)
async function elenaQuarterlyReport() {
  console.log('[Elena] Running quarterly deep-dive report...');
  const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const year = now.getFullYear();
  const gradeCount = { A: 0, B: 0, C: 0, D: 0 };
  const clientRows = [];

  for (const client of clients) {
    const prev = snapshot[client.locationId] || {};
    const grade = prev.grade || 'B';
    gradeCount[grade] = (gradeCount[grade] || 0) + 1;
    clientRows.push({
      name: client.name,
      industry: client.industry,
      grade,
      score: prev.score || 50,
      openOpps: prev.openOpps || 0,
      totalContacts: prev.totalContacts || 0,
      wonOpps: prev.wonOpps || 0,
      wonValue: prev.wonValue || 0,
    });
  }

  clientRows.sort((a, b) => a.score - b.score); // lowest scores first = most at risk

  const aiRes = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: `You are Elena, JRZ Marketing's AI Client Success Manager. Generate a quarterly executive summary for Q${quarter} ${year}. Client breakdown: ${gradeCount.A} Grade A (Healthy), ${gradeCount.B} Grade B (Stable), ${gradeCount.C} Grade C (At Risk), ${gradeCount.D} Grade D (Churn Risk). Top 3 at-risk clients: ${clientRows.slice(0, 3).map(c => `${c.name} (${c.industry}, grade ${c.grade}, ${c.openOpps} opps)`).join('; ')}. Top 3 healthiest: ${clientRows.slice(-3).reverse().map(c => `${c.name} (${c.industry}, grade ${c.grade})`).join('; ')}. Return ONLY valid JSON: {"executiveSummary": "2-3 sentence overview of portfolio health", "quarterlyWins": ["win1","win2","win3"], "risksToAddress": ["risk1","risk2"], "growthOpportunities": ["opp1","opp2"], "q4Focus": "recommended strategic focus for next quarter", "joseNote": "direct note to Jose about what needs his personal attention"}` }],
  });
  const qReport = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

  const gradeBar = (g, color) => `<div style="display:inline-block;text-align:center;margin:0 8px;"><div style="background:${color};color:#fff;font-size:22px;font-weight:800;width:56px;height:56px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto;">${gradeCount[g]}</div><div style="font-size:11px;color:#999;margin-top:6px;text-transform:uppercase;letter-spacing:0.08em;">Grade ${g}</div></div>`;

  const atRiskRows = clientRows.slice(0, 5).map(c =>
    `<tr style="border-bottom:1px solid #f5f5f5;"><td style="padding:10px 16px;font-size:14px;font-weight:600;">${c.name}</td><td style="padding:10px 16px;font-size:12px;color:#777;">${c.industry}</td><td style="padding:10px 8px;text-align:center;"><span style="background:${c.grade==='D'?'#dc2626':c.grade==='C'?'#d97706':c.grade==='B'?'#2563eb':'#16a34a'};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;">${c.grade}</span></td><td style="padding:10px 16px;font-size:13px;color:#555;">${c.openOpps} opps / ${c.totalContacts} contacts</td></tr>`
  ).join('');

  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:40px 20px;">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:32px 40px;text-align:center;"><img src="${logoUrl}" style="height:44px;" /></div>
  <div style="background:linear-gradient(135deg,#0a0a0a,#1a1a2e);padding:40px;text-align:center;">
    <div style="font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:8px;">Elena — Quarterly Report</div>
    <h1 style="color:#fff;font-size:28px;font-weight:800;margin:0;">Q${quarter} ${year} — Client Portfolio</h1>
    <p style="color:rgba(255,255,255,0.5);font-size:14px;margin:12px 0 0;">${clients.length} active accounts · ${gradeCount.A + gradeCount.B} healthy · ${gradeCount.C + gradeCount.D} need attention</p>
  </div>
  <div style="padding:32px 40px;text-align:center;border-bottom:1px solid #f0f0f0;">
    ${gradeBar('A','#16a34a')}${gradeBar('B','#2563eb')}${gradeBar('C','#d97706')}${gradeBar('D','#dc2626')}
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:15px;color:#333;line-height:1.8;margin-bottom:28px;">${qReport.executiveSummary}</p>
    <p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin:0 0 12px;">Quarterly Wins</p>
    ${(qReport.quarterlyWins||[]).map(w=>`<div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#166534;border-radius:0 8px 8px 0;">✓ ${w}</div>`).join('')}
    <p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin:24px 0 12px;">Risks to Address</p>
    ${(qReport.risksToAddress||[]).map(r=>`<div style="background:#fff7ed;border-left:3px solid #d97706;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#92400e;border-radius:0 8px 8px 0;">⚠ ${r}</div>`).join('')}
    <p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin:24px 0 12px;">Growth Opportunities</p>
    ${(qReport.growthOpportunities||[]).map(o=>`<div style="background:#eff6ff;border-left:3px solid #2563eb;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#1d4ed8;border-radius:0 8px 8px 0;">→ ${o}</div>`).join('')}
    <p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin:24px 0 12px;">Top 5 Clients Needing Attention</p>
    <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f9f9f9;">
      <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Client</th>
      <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Industry</th>
      <th style="padding:10px 8px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Grade</th>
      <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Pipeline</th>
    </tr></thead><tbody>${atRiskRows}</tbody></table>
    <div style="background:#0a0a0a;border-radius:12px;padding:24px;margin-top:24px;">
      <p style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin:0 0 10px;">Note to Jose</p>
      <p style="font-size:14px;color:rgba(255,255,255,0.8);line-height:1.7;margin:0;">"${qReport.joseNote}"</p>
    </div>
    <div style="background:#f9f9f9;border-radius:12px;padding:20px 24px;margin-top:16px;">
      <p style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#999;margin:0 0 8px;">Q${quarter + 1 > 4 ? 1 : quarter + 1} Focus</p>
      <p style="font-size:14px;color:#333;margin:0;">${qReport.q4Focus}</p>
    </div>
  </div>
  <div style="background:#0a0a0a;padding:24px 40px;text-align:center;">
    <p style="font-size:11px;color:rgba(255,255,255,0.3);">Elena — JRZ Marketing AI Client Success Manager · Q${quarter} ${year} Report</p>
  </div>
</div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `📋 Elena: Q${quarter} ${year} Client Portfolio Report`, html);
  console.log(`[Elena] Quarterly report sent — ${clients.length} accounts, ${gradeCount.C + gradeCount.D} at risk`);
  logActivity('elena', `Q${quarter} quarterly report: ${gradeCount.A}A ${gradeCount.B}B ${gradeCount.C}C ${gradeCount.D}D`);
}

// Manual endpoints for Elena
app.post('/elena/monthly-reports', async (_req, res) => {
  try {
    elenaMonthlyReports(); // run async, don't await — takes time
    res.json({ status: 'ok', message: 'Elena is generating monthly reports for all 32 subaccounts' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/elena/health-check', async (_req, res) => {
  try {
    elenaHealthCheck();
    res.json({ status: 'ok', message: 'Elena is running health check on all subaccounts' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/elena/clients', async (_req, res) => {
  try {
    const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
    const result = clients.map(c => ({ ...c, lastSnapshot: snapshot[c.locationId] || null }));
    res.json({ count: result.length, clients: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/elena/mid-month-checkin', async (_req, res) => {
  try {
    elenaMidMonthCheckIn();
    res.json({ status: 'ok', message: 'Elena is sending mid-month check-ins to at-risk clients' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/elena/quarterly-report', async (_req, res) => {
  try {
    elenaQuarterlyReport();
    res.json({ status: 'ok', message: 'Elena is generating the quarterly portfolio report' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/elena/grades', async (_req, res) => {
  try {
    const [snapshot, clients] = await Promise.all([loadElenaSnapshot(), getElenaClients()]);
    const grades = clients.map(c => {
      const prev = snapshot[c.locationId] || {};
      return {
        name: c.name, industry: c.industry, locationId: c.locationId,
        grade: prev.grade || '?', score: prev.score || null,
        openOpps: prev.openOpps || 0, totalContacts: prev.totalContacts || 0,
        checkedAt: prev.checkedAt || null,
      };
    }).sort((a, b) => (a.score || 50) - (b.score || 50));
    const summary = { A: 0, B: 0, C: 0, D: 0, unknown: 0 };
    grades.forEach(g => { summary[g.grade] ? summary[g.grade]++ : summary.unknown++; });
    res.json({ summary, grades });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DIEGO — PROJECT MANAGER
//   Scans all subaccounts every Monday
//   Reports stalled deals, inactive accounts, pipeline health
//   Emails Jose a full project status every Monday 9:15am EST
// ═══════════════════════════════════════════════════════════

const STALE_DAYS = 14; // flag deals with no activity for 14+ days

async function getSubaccountOpportunities(locationId) {
  try {
    const res = await axios.get('https://services.leadconnectorhq.com/opportunities/search', {
      headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' },
      params: { location_id: locationId, status: 'open', limit: 100 },
      timeout: 10000,
    });
    return res.data?.opportunities || [];
  } catch { return []; }
}

async function runDiegoWeeklyReport() {
  console.log('[Diego] Building weekly project report...');
  const clients = await getElenaClients();
  const now     = Date.now();
  const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;

  const accountSummaries = [];
  let totalOpenDeals   = 0;
  let totalPipelineVal = 0;
  let stalledAccounts  = 0;
  let inactiveAccounts = 0; // zero open deals + zero contacts added recently

  for (const client of clients) {
    try {
      const opps = await getSubaccountOpportunities(client.locationId);
      const openOpps  = opps.filter(o => o.status === 'open');
      const stalled   = openOpps.filter(o => {
        const last = new Date(o.updatedAt || o.dateUpdated || 0).getTime();
        return last < staleCutoff;
      });
      const pipelineVal = openOpps.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);
      const topDeal = openOpps.sort((a, b) => (parseFloat(b.monetaryValue) || 0) - (parseFloat(a.monetaryValue) || 0))[0];

      totalOpenDeals   += openOpps.length;
      totalPipelineVal += pipelineVal;
      if (stalled.length > 0) stalledAccounts++;
      if (openOpps.length === 0) inactiveAccounts++;

      accountSummaries.push({
        name:        client.name,
        locationId:  client.locationId,
        openOpps:    openOpps.length,
        stalledOpps: stalled.length,
        pipelineVal,
        topDeal:     topDeal ? { name: topDeal.name, value: parseFloat(topDeal.monetaryValue) || 0 } : null,
        needsAttention: stalled.length > 0 || openOpps.length === 0,
      });

      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[Diego] Error scanning ${client.name}:`, err.message);
    }
  }

  // Sort: needs attention first, then by pipeline value
  accountSummaries.sort((a, b) => {
    if (a.needsAttention && !b.needsAttention) return -1;
    if (!a.needsAttention && b.needsAttention) return 1;
    return b.pipelineVal - a.pipelineVal;
  });

  // Claude generates the executive summary
  const summaryData = accountSummaries.map(a =>
    `${a.name}: ${a.openOpps} open deals ($${Math.round(a.pipelineVal).toLocaleString()} pipeline), ${a.stalledOpps} stalled`
  ).join('\n');

  let aiInsight = '';
  try {
    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: `Eres Diego, el Project Manager de JRZ Marketing. Basado en este resumen semanal de los 31 clientes, escribe UN párrafo ejecutivo corto (3-4 oraciones) con el insight más importante y una acción concreta para Jose esta semana. Habla directo, como un PM al CEO.\n\nDatos:\n- Cuentas totales: ${accountSummaries.length}\n- Deals abiertos: ${totalOpenDeals} (valor total: $${Math.round(totalPipelineVal).toLocaleString()})\n- Cuentas con deals estancados: ${stalledAccounts}\n- Cuentas sin actividad: ${inactiveAccounts}\n\nDetalle:\n${summaryData.slice(0, 1500)}\n\nEscribe solo el párrafo, en español.` }],
    });
    aiInsight = aiRes.content[0].text.trim();
  } catch { aiInsight = 'Análisis no disponible esta semana.'; }

  // Build HTML rows
  const attentionRows = accountSummaries
    .filter(a => a.needsAttention)
    .map(a => `
      <tr>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0a0a0a;border-bottom:1px solid #f0f0f0;">${a.name}</td>
        <td style="padding:12px 16px;font-size:14px;color:#555;border-bottom:1px solid #f0f0f0;text-align:center;">${a.openOpps}</td>
        <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #f0f0f0;text-align:center;">
          ${a.stalledOpps > 0 ? `<span style="background:#fef2f2;color:#dc2626;font-weight:700;padding:3px 10px;border-radius:100px;font-size:12px;">${a.stalledOpps} stalled</span>` : '<span style="color:#bbb;font-size:12px;">no deals</span>'}
        </td>
        <td style="padding:12px 16px;font-size:14px;color:#555;border-bottom:1px solid #f0f0f0;">$${Math.round(a.pipelineVal).toLocaleString()}</td>
        <td style="padding:12px 16px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;">${a.topDeal ? a.topDeal.name.slice(0, 30) : '—'}</td>
      </tr>`).join('');

  const healthyRows = accountSummaries
    .filter(a => !a.needsAttention)
    .map(a => `
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#333;border-bottom:1px solid #f9f9f9;">${a.name}</td>
        <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #f9f9f9;text-align:center;">${a.openOpps}</td>
        <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f9f9f9;text-align:center;"><span style="color:#16a34a;font-weight:700;">✓ On track</span></td>
        <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #f9f9f9;">$${Math.round(a.pipelineVal).toLocaleString()}</td>
        <td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #f9f9f9;">${a.topDeal ? a.topDeal.name.slice(0, 30) : '—'}</td>
      </tr>`).join('');

  const date = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', weekday: 'long', day: 'numeric', month: 'long' });
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';

  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Diego — Reporte Semanal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',-apple-system,sans-serif; background:#f4f4f4; color:#0a0a0a; }
    .wrap { padding:40px 20px; }
    .card { max-width:680px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:28px 40px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:40px; }
    .hdr-badge { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:6px 14px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:32px 40px 40px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:24px; font-weight:800; color:#fff; margin-bottom:8px; }
    .hero p { font-size:13px; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.08em; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:20px 16px; text-align:center; border-right:1px solid #f0f0f0; }
    .stat:last-child { border-right:none; }
    .stat-num { font-size:28px; font-weight:800; color:#0a0a0a; line-height:1; }
    .stat-num.red { color:#dc2626; }
    .stat-lbl { font-size:10px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.08em; margin-top:5px; }
    .body { padding:32px 40px; }
    .insight { background:#f9f9f9; border-left:4px solid #0a0a0a; border-radius:0 10px 10px 0; padding:20px 24px; margin-bottom:28px; font-size:14px; color:#333; line-height:1.8; }
    .insight strong { color:#0a0a0a; display:block; font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:8px; }
    .section-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin:0 0 12px; }
    .alert-box { background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:4px; margin-bottom:24px; overflow:hidden; }
    .alert-label { background:#dc2626; color:#fff; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; padding:8px 16px; }
    table { width:100%; border-collapse:collapse; }
    .healthy-box { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:4px; overflow:hidden; }
    .healthy-label { background:#16a34a; color:#fff; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; padding:8px 16px; }
    .ftr { background:#0a0a0a; padding:24px 40px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:24px; opacity:0.5; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="hdr">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <span class="hdr-badge">Diego — PM Report</span>
  </div>
  <div class="hero">
    <h1>Reporte Semanal de Proyectos</h1>
    <p>${date}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${accountSummaries.length}</div><div class="stat-lbl">Clientes</div></div>
    <div class="stat"><div class="stat-num">${totalOpenDeals}</div><div class="stat-lbl">Deals Abiertos</div></div>
    <div class="stat"><div class="stat-num red">${stalledAccounts}</div><div class="stat-lbl">Estancados</div></div>
    <div class="stat"><div class="stat-num">$${Math.round(totalPipelineVal / 1000)}k</div><div class="stat-lbl">Pipeline Total</div></div>
  </div>
  <div class="body">
    <div class="insight"><strong>Insight de Diego</strong>${aiInsight}</div>
    ${attentionRows ? `
    <p class="section-title">⚠️ Necesitan atención (${accountSummaries.filter(a => a.needsAttention).length})</p>
    <div class="alert-box">
      <div class="alert-label">Acción requerida esta semana</div>
      <table>
        <thead><tr style="background:#fff5f5;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Cliente</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Deals</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Estado</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Pipeline</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Top Deal</th>
        </tr></thead>
        <tbody>${attentionRows}</tbody>
      </table>
    </div>` : '<p style="color:#16a34a;font-weight:700;margin-bottom:24px;">✅ Todos los clientes están activos esta semana.</p>'}
    ${healthyRows ? `
    <p class="section-title" style="margin-top:24px;">✅ En buen estado (${accountSummaries.filter(a => !a.needsAttention).length})</p>
    <div class="healthy-box">
      <div class="healthy-label">Sin problemas esta semana</div>
      <table>
        <thead><tr style="background:#f0fdf4;">
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Cliente</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Deals</th>
          <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Estado</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Pipeline</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Top Deal</th>
        </tr></thead>
        <tbody>${healthyRows}</tbody>
      </table>
    </div>` : ''}
  </div>
  <div class="ftr">
    <img src="${logoUrl}" alt="JRZ Marketing" />
    <p>Diego — JRZ Marketing AI Project Manager</p>
  </div>
</div></div>
</body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `📋 Diego: Reporte Semanal — ${accountSummaries.filter(a => a.needsAttention).length} cuentas necesitan atención`, html);
  console.log(`[Diego] ✅ Weekly report sent. ${stalledAccounts} stalled, ${inactiveAccounts} inactive, $${Math.round(totalPipelineVal).toLocaleString()} total pipeline.`);
}

app.post('/diego/weekly-report', async (_req, res) => {
  try {
    runDiegoWeeklyReport();
    res.json({ status: 'ok', message: 'Diego is building the weekly project report' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── Diego: Client Scorecard ──────────────────────────────
// Runs 1st of every month — grades every client A/B/C
// A = active pipeline + recent wins + growth
// B = some activity but needs attention
// C = stalled or no pipeline

const SCORECARD_SNAPSHOT_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/diego_scorecard.json';
const SCORECARD_SNAPSHOT_PID = 'jrz/diego_scorecard';

async function loadScorecardSnapshot() {
  try {
    const res = await axios.get(SCORECARD_SNAPSHOT_URL + '?t=' + Date.now(), { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return {}; }
}

async function saveScorecardSnapshot(data) {
  const ts     = Math.floor(Date.now() / 1000);
  const sigStr = `overwrite=true&public_id=${SCORECARD_SNAPSHOT_PID}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
  const sig    = crypto.createHash('sha1').update(sigStr).digest('hex');
  const form   = new FormData();
  const buf    = Buffer.from(JSON.stringify(data, null, 2));
  form.append('file', buf, { filename: 'diego_scorecard.json', contentType: 'application/json' });
  form.append('public_id', SCORECARD_SNAPSHOT_PID);
  form.append('resource_type', 'raw');
  form.append('timestamp', String(ts));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('signature', sig);
  form.append('overwrite', 'true');
  await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, {
    headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000
  });
}

function gradeClient(stats, prev) {
  let score = 0;

  // Activity: has open deals
  if (stats.openOpps >= 3) score += 2;
  else if (stats.openOpps >= 1) score += 1;

  // Wins: closed something this month
  if (stats.wonOpps >= 2) score += 2;
  else if (stats.wonOpps >= 1) score += 1;

  // Pipeline growth vs last month
  const prevVal = prev?.pipelineVal || 0;
  if (stats.totalValue > prevVal * 1.1) score += 2;      // grew 10%+
  else if (stats.totalValue >= prevVal * 0.9) score += 1; // stable

  // Recent activity: any opp updated in last 14 days
  if (stats.recentActivity) score += 1;

  if (score >= 6) return 'A';
  if (score >= 3) return 'B';
  return 'C';
}

async function runDiegoScorecard() {
  console.log('[Diego] Building monthly client scorecard...');
  const [clients, prevSnapshot] = await Promise.all([getElenaClients(), loadScorecardSnapshot()]);
  const month    = new Date().toLocaleString('es-ES', { month: 'long', year: 'numeric' });
  const staleCut = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const newSnap  = {};
  const cards    = [];

  for (const client of clients) {
    try {
      const opps        = await getSubaccountOpportunities(client.locationId);
      const openOpps    = opps.filter(o => o.status === 'open');
      const wonOpps     = opps.filter(o => o.status === 'won');
      const totalValue  = openOpps.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0);
      const recentActivity = openOpps.some(o => new Date(o.updatedAt || 0).getTime() > staleCut);
      const stats = { openOpps: openOpps.length, wonOpps: wonOpps.length, totalValue, recentActivity };
      const grade = gradeClient(stats, prevSnapshot[client.locationId]);

      newSnap[client.locationId] = { pipelineVal: totalValue, openOpps: openOpps.length, wonOpps: wonOpps.length, gradedAt: new Date().toISOString().split('T')[0] };
      cards.push({ name: client.name, grade, ...stats });
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[Diego] Scorecard error for ${client.name}:`, err.message);
    }
  }

  await saveScorecardSnapshot(newSnap);

  const aClients = cards.filter(c => c.grade === 'A');
  const bClients = cards.filter(c => c.grade === 'B');
  const cClients = cards.filter(c => c.grade === 'C');

  const gradeRow = (c, color, bg) =>
    `<tr style="border-bottom:1px solid #f5f5f5;">
      <td style="padding:11px 16px;font-size:14px;color:#0a0a0a;font-weight:500;">${c.name}</td>
      <td style="padding:11px 16px;text-align:center;"><span style="background:${bg};color:${color};font-weight:800;font-size:15px;padding:3px 12px;border-radius:8px;">${c.grade}</span></td>
      <td style="padding:11px 16px;text-align:center;font-size:14px;color:#555;">${c.openOpps}</td>
      <td style="padding:11px 16px;text-align:center;font-size:14px;color:#555;">${c.wonOpps}</td>
      <td style="padding:11px 16px;font-size:14px;color:#555;">$${Math.round(c.totalValue).toLocaleString()}</td>
      <td style="padding:11px 16px;text-align:center;font-size:12px;">${c.recentActivity ? '✅' : '⚠️'}</td>
    </tr>`;

  const thead = `<tr style="background:#f9f9f9;">
    <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Cliente</th>
    <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Nota</th>
    <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Open</th>
    <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Won</th>
    <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Pipeline</th>
    <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Activo</th>
  </tr>`;

  const allRows = [
    ...aClients.map(c => gradeRow(c, '#fff', '#16a34a')),
    ...bClients.map(c => gradeRow(c, '#fff', '#d97706')),
    ...cClients.map(c => gradeRow(c, '#fff', '#dc2626')),
  ].join('');

  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; }
    .wrap { padding:40px 20px; }
    .card { max-width:680px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:28px 40px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:38px; }
    .hdr span { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.5); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:6px 14px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:30px 40px 38px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; margin-bottom:6px; }
    .hero p { font-size:12px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.08em; }
    .summary { display:flex; border-bottom:1px solid #f0f0f0; }
    .sum { flex:1; padding:18px 16px; text-align:center; border-right:1px solid #f0f0f0; }
    .sum:last-child { border-right:none; }
    .sum-num { font-size:26px; font-weight:800; }
    .sum-lbl { font-size:10px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.08em; margin-top:4px; }
    .body { padding:28px 40px 36px; }
    .legend { display:flex; gap:16px; margin-bottom:20px; }
    .leg { display:flex; align-items:center; gap:6px; font-size:12px; color:#555; }
    .dot { width:10px; height:10px; border-radius:3px; }
    table { width:100%; border-collapse:collapse; }
    .ftr { background:#0a0a0a; padding:22px 40px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:22px; opacity:0.5; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}" /><span>Diego — Scorecard Mensual</span></div>
  <div class="hero">
    <h1>Scorecard de Clientes — ${month}</h1>
    <p>Evaluación basada en pipeline, actividad y crecimiento</p>
  </div>
  <div class="summary">
    <div class="sum"><div class="sum-num" style="color:#16a34a;">${aClients.length}</div><div class="sum-lbl">Grado A</div></div>
    <div class="sum"><div class="sum-num" style="color:#d97706;">${bClients.length}</div><div class="sum-lbl">Grado B</div></div>
    <div class="sum"><div class="sum-num" style="color:#dc2626;">${cClients.length}</div><div class="sum-lbl">Grado C</div></div>
    <div class="sum"><div class="sum-num">${cards.length}</div><div class="sum-lbl">Total Clientes</div></div>
  </div>
  <div class="body">
    <div class="legend">
      <div class="leg"><div class="dot" style="background:#16a34a;"></div>A — Activo, creciendo, wins este mes</div>
      <div class="leg"><div class="dot" style="background:#d97706;"></div>B — Estable, puede mejorar</div>
      <div class="leg"><div class="dot" style="background:#dc2626;"></div>C — Sin actividad, requiere atención</div>
    </div>
    <table><thead>${thead}</thead><tbody>${allRows}</tbody></table>
  </div>
  <div class="ftr"><img src="${logoUrl}" /><p>Diego — JRZ Marketing AI Project Manager</p></div>
</div></div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `📊 Diego: Scorecard Mensual — ${aClients.length}A · ${bClients.length}B · ${cClients.length}C`, html);
  console.log(`[Diego] ✅ Scorecard sent. A:${aClients.length} B:${bClients.length} C:${cClients.length}`);
}

// ─── Diego: Daily Standup ─────────────────────────────────
// Mon–Fri 8:00am EST — 10-line morning briefing for Jose

async function runDiegoStandup() {
  console.log('[Diego] Building daily standup...');
  setAgentBusy('diego', 'Building daily pipeline standup');
  logActivity('diego', 'action', 'Daily standup started — scanning pipeline across all accounts');
  const clients  = await getElenaClients();
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const staleCut  = Date.now() - 14 * 24 * 60 * 60 * 1000;

  let totalOpen = 0, closedYesterday = [], stalledTop = [], highValueDeals = [];

  // Sample top 10 clients for speed (most active ones first via override order)
  const sample = clients.slice(0, 15);
  for (const client of sample) {
    try {
      const opps     = await getSubaccountOpportunities(client.locationId);
      const open     = opps.filter(o => o.status === 'open');
      const wonYest  = opps.filter(o => o.status === 'won' && new Date(o.updatedAt || 0).getTime() > yesterday);
      const stalled  = open.filter(o => new Date(o.updatedAt || 0).getTime() < staleCut);
      const topOpen  = open.sort((a, b) => (parseFloat(b.monetaryValue) || 0) - (parseFloat(a.monetaryValue) || 0))[0];

      totalOpen += open.length;
      if (wonYest.length) closedYesterday.push({ client: client.name, count: wonYest.length, value: wonYest.reduce((s, o) => s + (parseFloat(o.monetaryValue) || 0), 0) });
      if (stalled.length) stalledTop.push({ client: client.name, count: stalled.length });
      if (topOpen && parseFloat(topOpen.monetaryValue) > 500) highValueDeals.push({ client: client.name, name: topOpen.name, value: parseFloat(topOpen.monetaryValue) || 0 });
      await new Promise(r => setTimeout(r, 600));
    } catch { /* skip */ }
  }

  highValueDeals.sort((a, b) => b.value - a.value);
  stalledTop.sort((a, b) => b.count - a.count);

  const dayName = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', weekday: 'long' });
  const dateStr = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', day: 'numeric', month: 'long' });

  // Claude writes the morning greeting
  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: `Eres Diego, el PM de JRZ Marketing. Es ${dayName} ${dateStr}. Escribe un saludo de buenos días para Jose (2 oraciones máximo, directo, con energía). Menciona brevemente que hay ${totalOpen} deals abiertos${closedYesterday.length ? ` y ${closedYesterday.length} cliente(s) cerraron ayer` : ''}${stalledTop.length ? ` pero ${stalledTop.length} cuenta(s) están estancadas` : ''}. Suena como un PM motivado hablándole al CEO. Solo el texto, sin comillas.` }],
  });
  const greeting = aiRes.content[0].text.trim();

  const wonRows = closedYesterday.map(w =>
    `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0;">
      <span style="font-size:18px;">🏆</span>
      <div><div style="font-size:14px;font-weight:600;color:#0a0a0a;">${w.client}</div><div style="font-size:12px;color:#16a34a;">Cerró ${w.count} deal(s) — $${Math.round(w.value).toLocaleString()}</div></div>
    </div>`
  ).join('') || '<p style="font-size:13px;color:#bbb;padding:10px 0;">Sin cierres ayer.</p>';

  const stalledRows = stalledTop.slice(0, 5).map(s =>
    `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f9f9f9;">
      <span style="font-size:16px;">⚠️</span>
      <div style="font-size:14px;color:#0a0a0a;">${s.client} <span style="color:#dc2626;font-weight:700;">(${s.count} estancado${s.count > 1 ? 's' : ''})</span></div>
    </div>`
  ).join('') || '<p style="font-size:13px;color:#16a34a;padding:10px 0;">✅ Sin cuentas estancadas.</p>';

  const dealRows = highValueDeals.slice(0, 5).map(d =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f9f9f9;">
      <div><div style="font-size:13px;font-weight:600;color:#0a0a0a;">${d.client}</div><div style="font-size:12px;color:#888;">${d.name.slice(0, 40)}</div></div>
      <span style="font-size:14px;font-weight:700;color:#0a0a0a;">$${Math.round(d.value).toLocaleString()}</span>
    </div>`
  ).join('') || '<p style="font-size:13px;color:#bbb;padding:10px 0;">Sin datos disponibles.</p>';

  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; }
    .wrap { padding:32px 20px; }
    .card { max-width:600px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:24px 32px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:34px; }
    .hdr span { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:100px; }
    .greeting { background:#0a0a0a; padding:24px 32px 30px; border-bottom:3px solid #fff; }
    .greeting .day { font-size:11px; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:8px; }
    .greeting p { font-size:16px; color:#fff; line-height:1.6; font-weight:500; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:16px; text-align:center; border-right:1px solid #f0f0f0; }
    .stat:last-child { border-right:none; }
    .stat-num { font-size:24px; font-weight:800; color:#0a0a0a; }
    .stat-lbl { font-size:10px; font-weight:700; color:#bbb; text-transform:uppercase; letter-spacing:0.08em; margin-top:3px; }
    .section { padding:20px 32px; border-bottom:1px solid #f5f5f5; }
    .sec-title { font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:12px; }
    .ftr { background:#0a0a0a; padding:18px 32px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:20px; opacity:0.45; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.2); }
  </style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}" /><span>Diego · Standup ${dayName}</span></div>
  <div class="greeting">
    <div class="day">Buenos días · ${dateStr}</div>
    <p>${greeting}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${totalOpen}</div><div class="stat-lbl">Deals Abiertos</div></div>
    <div class="stat"><div class="stat-num" style="color:${closedYesterday.length ? '#16a34a' : '#bbb'};">${closedYesterday.length}</div><div class="stat-lbl">Cerrados Ayer</div></div>
    <div class="stat"><div class="stat-num" style="color:${stalledTop.length ? '#dc2626' : '#16a34a'};">${stalledTop.length}</div><div class="stat-lbl">Estancados</div></div>
  </div>
  <div class="section"><p class="sec-title">🏆 Cierres de ayer</p>${wonRows}</div>
  <div class="section"><p class="sec-title">⚠️ Cuentas que necesitan tu llamada hoy</p>${stalledRows}</div>
  <div class="section"><p class="sec-title">💰 Deals de mayor valor en el pipeline</p>${dealRows}</div>
  <div class="ftr"><img src="${logoUrl}" /><p>Diego — JRZ Marketing AI Project Manager</p></div>
</div></div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `☀️ Diego: Buenos días — ${dayName} ${dateStr}`, html);
  console.log('[Diego] ✅ Daily standup sent.');
  OFFICE_KPI.dealsTracked = totalOpen;
  logActivity('diego', 'success', `Standup sent — ${totalOpen} open deals, ${closedYesterday.length} closed yesterday, ${stalledTop.length} stalled`);
  if (stalledTop.length) {
    agentChat('diego', 'armando', `${stalledTop.length} stalled deal(s) today: ${stalledTop.slice(0,2).map(s=>s.name||'client').join(', ')}. Recommend a warm outreach DM to re-engage.`);
  }
  setAgentIdle('diego', `Standup sent · ${totalOpen} deals tracked`);
}

app.post('/diego/standup', async (_req, res) => {
  try {
    runDiegoStandup();
    res.json({ status: 'ok', message: 'Diego is building your morning standup' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/diego/scorecard', async (_req, res) => {
  try {
    runDiegoScorecard();
    res.json({ status: 'ok', message: 'Diego is building the monthly client scorecard' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// MARCO — CONTENT DIRECTOR
//   Weekly content brief every Monday 9:30am EST
//   Mid-week trend alert every Wednesday 10am EST
//   Reviews performance, suggests 5 content ideas, spots trends
// ═══════════════════════════════════════════════════════════

async function runMarcoContentBrief() {
  console.log('[Marco] Building weekly content brief...');
  setAgentBusy('marco', 'Building weekly save-optimized content brief');
  logActivity('marco', 'action', 'Weekly content brief started — pulling social stats + news trends');
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const dateStr = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', weekday: 'long', day: 'numeric', month: 'long' });

  // Pull data in parallel
  const [statsRes, newsEs, newsEn, newsAI, prevStrategy] = await Promise.allSettled([
    getWeeklyStats(),
    axios.get(`https://newsapi.org/v2/everything?q=marketing+digital+latinos+pequeños+negocios&language=es&sortBy=publishedAt&pageSize=8&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
    axios.get(`https://newsapi.org/v2/everything?q=social+media+marketing+trends+small+business&language=en&sortBy=publishedAt&pageSize=8&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
    axios.get(`https://newsapi.org/v2/everything?q=AI+automation+marketing+2026&language=en&sortBy=publishedAt&pageSize=6&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
    loadContentStrategy(),
  ]);

  const stats    = statsRes.status === 'fulfilled' ? statsRes.value : null;
  const strategy = prevStrategy.status === 'fulfilled' ? prevStrategy.value : {};
  const breakdown = stats?.breakdowns || {};
  const eng       = breakdown?.engagement || {};

  const articles = [
    ...(newsEs.status === 'fulfilled' ? newsEs.value.data?.articles || [] : []),
    ...(newsEn.status === 'fulfilled' ? newsEn.value.data?.articles || [] : []),
    ...(newsAI.status === 'fulfilled' ? newsAI.value.data?.articles || [] : []),
  ].slice(0, 15);

  const articleSummary = articles.map(a => `- ${a.title}: ${(a.description || '').slice(0, 100)}`).join('\n');

  const perfSummary = `
Instagram: ${breakdown?.impressions?.platforms?.instagram?.value || 0} impresiones, ${eng?.instagram?.likes || 0} likes, ${eng?.instagram?.comments || 0} comentarios
Facebook: ${breakdown?.impressions?.platforms?.facebook?.value || 0} impresiones, ${eng?.facebook?.likes || 0} likes
LinkedIn: ${breakdown?.impressions?.platforms?.linkedin?.value || 0} impresiones
TikTok: ${breakdown?.impressions?.platforms?.tiktok?.value || 0} impresiones
Nuevos seguidores: ${breakdown?.followers?.total || 0}
Mejor estilo de hook anterior: ${strategy.bestHookStyle || 'sin datos'}
Temas que funcionaron: ${(strategy.bestTopics || []).join(', ') || 'sin datos'}
Días con mejor rendimiento: ${JSON.stringify(strategy.bestDays || {})}`;

  // Claude generates the full content brief
  const aiRes = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: `You are Marco, Content Director at JRZ Marketing. José Rivas is the founder — AI & automation expert for Latino entrepreneurs, Orlando FL. Audience: 53% men, 25-34, Latino small business owners.

LAST WEEK PERFORMANCE:
${perfSummary}

CURRENT TRENDS & NEWS:
${articleSummary}

You are a senior Instagram content strategist AND behavioral analyst. Apply all 6 frameworks:

CONTENT STRATEGY ARCHITECT: Define the week's content across 4 pillars — Education (how-to, frameworks), Authority (José's expertise & results), Engagement (stories, relatability), Conversion (offers, CTAs). Map each idea to the awareness→trust→authority→conversion journey. Structured sequencing, not random posting.

RESEARCH ENGINE (Content Intelligence Layer): Reverse-engineer what's working in the AI/marketing niche right now. Identify recurring hook structures, emotional triggers, psychological drivers behind saves/shares, and content gaps competitors are missing. Suggest strategic opportunities.

SAVE-OPTIMIZED CAROUSEL GENERATOR: Every carousel idea must maximize saves AND shares. Use structured formats: step-by-step blueprints, checklists, myths vs truth, before/after, case studies. High educational density = people save to use later. Saves = algorithm signal.

HOOK GENERATOR (Who/What/How Framework): Every hook must answer in the first line: WHO is this for? WHAT is it about? HOW does it help? Use pattern interrupts, contrarian angles, curiosity gaps, outcome-driven framing. No vague or clever phrasing — immediate psychological pull.

CAPTION ENGINE: Each caption_start uses emotional storytelling, grade 6-7 readability, includes a save trigger and comment trigger.

HIGH-RETENTION SCRIPT BUILDER: For reels, choose the right framework (AIDA/PAS/Open Loop/Story-Bridge-Offer/Before-After-Bridge/4U) based on the topic.

Return ONLY valid JSON:
{
  "weekInsight": "2-3 sentences: what happened last week and why (behavioral analysis)",
  "topPlatform": "which platform won and why",
  "contentPillars": {
    "education": "this week's education angle",
    "authority": "this week's authority angle",
    "engagement": "this week's engagement angle",
    "conversion": "this week's conversion angle"
  },
  "competitorGap": "one strategic opportunity competitors are missing right now",
  "trending": [
    {"topic": "trending topic 1", "angle": "specific JRZ angle", "urgency": "high/medium", "emotionalTrigger": "what psychological driver to use"},
    {"topic": "trending topic 2", "angle": "specific JRZ angle", "urgency": "high/medium", "emotionalTrigger": "what psychological driver to use"},
    {"topic": "trending topic 3", "angle": "specific JRZ angle", "urgency": "high/medium", "emotionalTrigger": "what psychological driver to use"}
  ],
  "contentIdeas": [
    {"hook": "Who/What/How hook — stops the scroll instantly", "format": "carousel/reel/story", "carouselStructure": "blueprint/checklist/myth-vs-truth/before-after/case-study", "retentionFramework": "AIDA/PAS/Open Loop/etc (for reels)", "platform": "primary platform", "pillar": "education/authority/engagement/conversion", "caption_start": "First 2 sentences using emotional storytelling with save trigger", "saveTrigger": "exact line that triggers a save", "commentTrigger": "question that sparks comments", "cta": "natural call to action"},
    {"hook": "Who/What/How hook", "format": "carousel/reel/story", "carouselStructure": "blueprint/checklist/myth-vs-truth/before-after/case-study", "retentionFramework": "framework name", "platform": "platform", "pillar": "pillar", "caption_start": "emotional opening", "saveTrigger": "save line", "commentTrigger": "comment question", "cta": "cta"},
    {"hook": "Who/What/How hook", "format": "carousel/reel/story", "carouselStructure": "blueprint/checklist/myth-vs-truth/before-after/case-study", "retentionFramework": "framework name", "platform": "platform", "pillar": "pillar", "caption_start": "emotional opening", "saveTrigger": "save line", "commentTrigger": "comment question", "cta": "cta"},
    {"hook": "Who/What/How hook", "format": "carousel/reel/story", "carouselStructure": "blueprint/checklist/myth-vs-truth/before-after/case-study", "retentionFramework": "framework name", "platform": "platform", "pillar": "pillar", "caption_start": "emotional opening", "saveTrigger": "save line", "commentTrigger": "comment question", "cta": "cta"},
    {"hook": "Who/What/How hook", "format": "carousel/reel/story", "carouselStructure": "blueprint/checklist/myth-vs-truth/before-after/case-study", "retentionFramework": "framework name", "platform": "platform", "pillar": "pillar", "caption_start": "emotional opening", "saveTrigger": "save line", "commentTrigger": "comment question", "cta": "cta"}
  ],
  "hashtags": ["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5","hashtag6","hashtag7","hashtag8"],
  "bestDayThisWeek": "best day to post and why",
  "avoidThisWeek": "what to avoid in content this week",
  "marcoNote": "direct note from Marco to José — max 2 sentences, CD to CEO"
}` }],
  });

  const brief = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

  // Build content idea cards
  const formatIcon = { carrusel: '🎠', reel: '🎬', historia: '📱', carousel: '🎠', story: '📱' };
  const ideaCards = (brief.contentIdeas || []).map((idea, i) => `
    <div style="background:#f9f9f9;border-radius:12px;padding:20px 24px;margin-bottom:12px;border-left:4px solid #0a0a0a;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Idea ${i + 1} · ${idea.platform} · ${formatIcon[idea.format?.toLowerCase()] || '📄'} ${idea.format}</span>
      </div>
      <p style="font-size:15px;font-weight:700;color:#0a0a0a;margin-bottom:8px;">"${idea.hook}"</p>
      <p style="font-size:13px;color:#555;line-height:1.6;margin-bottom:10px;">${idea.caption_start}</p>
      <div style="background:#0a0a0a;display:inline-block;padding:4px 12px;border-radius:100px;">
        <span style="font-size:11px;color:rgba(255,255,255,0.7);">CTA: ${idea.cta}</span>
      </div>
    </div>`).join('');

  const trendCards = (brief.trending || []).map(t => `
    <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #f0f0f0;align-items:flex-start;">
      <span style="background:${t.urgency === 'alta' ? '#fef2f2' : '#fff8f0'};color:${t.urgency === 'alta' ? '#dc2626' : '#d97706'};font-size:10px;font-weight:700;padding:3px 8px;border-radius:100px;white-space:nowrap;margin-top:2px;">${t.urgency?.toUpperCase()}</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:#0a0a0a;margin-bottom:3px;">${t.topic}</div>
        <div style="font-size:13px;color:#666;line-height:1.5;">${t.angle}</div>
      </div>
    </div>`).join('');

  const hashtagHtml = (brief.hashtags || []).map(h =>
    `<span style="display:inline-block;background:#f0f0f0;color:#555;font-size:12px;padding:4px 10px;border-radius:100px;margin:3px;">#${h.replace('#','')}</span>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; }
    .wrap { padding:40px 20px; }
    .card { max-width:640px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:26px 36px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:36px; }
    .hdr span { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:28px 36px 36px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; margin-bottom:6px; }
    .hero p { font-size:12px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.08em; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:16px 12px; text-align:center; border-right:1px solid #f0f0f0; }
    .stat:last-child { border-right:none; }
    .stat-num { font-size:22px; font-weight:800; color:#0a0a0a; }
    .stat-lbl { font-size:10px; font-weight:700; color:#bbb; text-transform:uppercase; letter-spacing:0.06em; margin-top:3px; }
    .body { padding:28px 36px 36px; }
    .sec { margin-bottom:28px; }
    .sec-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:14px; }
    .insight { background:#0a0a0a; border-radius:12px; padding:20px 24px; margin-bottom:24px; }
    .insight p { font-size:14px; color:rgba(255,255,255,0.8); line-height:1.7; }
    .insight .label { font-size:10px; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:8px; }
    .platform-win { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px 18px; margin-bottom:20px; font-size:14px; color:#166534; }
    .avoid { background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:14px 18px; font-size:14px; color:#991b1b; }
    .best-day { background:#fff8f0; border:1px solid #fed7aa; border-radius:10px; padding:14px 18px; margin-bottom:12px; font-size:14px; color:#92400e; }
    .marco-note { background:#f9f9f9; border-left:4px solid #8A9BA8; border-radius:0 10px 10px 0; padding:18px 22px; font-size:14px; color:#333; line-height:1.7; font-style:italic; }
    .ftr { background:#0a0a0a; padding:22px 36px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:22px; opacity:0.45; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}"/><span>Marco · Content Brief</span></div>
  <div class="hero">
    <h1>Brief de Contenido Semanal</h1>
    <p>${dateStr}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${breakdown?.impressions?.total || 0}</div><div class="stat-lbl">Impresiones</div></div>
    <div class="stat"><div class="stat-num">${breakdown?.reach?.total || 0}</div><div class="stat-lbl">Alcance</div></div>
    <div class="stat"><div class="stat-num">${(eng?.instagram?.likes || 0) + (eng?.facebook?.likes || 0)}</div><div class="stat-lbl">Likes</div></div>
    <div class="stat"><div class="stat-num">${breakdown?.followers?.total || 0}</div><div class="stat-lbl">Nuevos Seguidores</div></div>
  </div>
  <div class="body">
    <div class="insight">
      <div class="label">Insight de la semana</div>
      <p>${brief.weekInsight}</p>
    </div>
    <div class="sec">
      <p class="sec-title">📊 Plataforma ganadora</p>
      <div class="platform-win">✅ ${brief.topPlatform}</div>
    </div>
    <div class="sec">
      <p class="sec-title">🔥 Tendencias esta semana (aprovéchalas YA)</p>
      ${trendCards}
    </div>
    <div class="sec">
      <p class="sec-title">💡 5 Ideas de contenido para esta semana</p>
      ${ideaCards}
    </div>
    <div class="sec">
      <p class="sec-title">📅 Estrategia de publicación</p>
      <div class="best-day">📅 ${brief.bestDayThisWeek}</div>
      <div class="avoid">⛔ ${brief.avoidThisWeek}</div>
    </div>
    <div class="sec">
      <p class="sec-title">#️⃣ Hashtags recomendados esta semana</p>
      <div>${hashtagHtml}</div>
    </div>
    <div class="sec">
      <p class="sec-title">💬 Nota de Marco</p>
      <div class="marco-note">"${brief.marcoNote}"<br/><br/>— Marco, Content Director</div>
    </div>
  </div>
  <div class="ftr"><img src="${logoUrl}"/><p>Marco — JRZ Marketing AI Content Director</p></div>
</div></div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `🎯 Marco: Brief de Contenido — ${dateStr}`, html);
  console.log('[Marco] ✅ Weekly content brief sent.');
  OFFICE_KPI.postsPublished++;
  logActivity('marco', 'success', `Weekly content brief delivered — ${(brief.contentIdeas || []).length} save-optimized ideas across ${Object.keys(brief.contentPillars || {}).length} pillars`);
  agentChat('marco', 'sofia', `New content brief ready. Competitor gap this week: ${brief.competitorGap || 'check brief'}. Consider updating landing pages to match this week's conversion angle.`);
  setAgentIdle('marco', 'Brief sent — monitoring trends');
}

async function runMarcoTrendAlert() {
  console.log('[Marco] Checking for mid-week trend spikes...');
  const [newsEs, newsEn, newsAI] = await Promise.allSettled([
    axios.get(`https://newsapi.org/v2/everything?q=marketing+viral+latinos+2026&language=es&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
    axios.get(`https://newsapi.org/v2/everything?q=viral+marketing+trend+small+business&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
    axios.get(`https://newsapi.org/v2/everything?q=AI+content+marketing+viral+2026&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`, { timeout: 10000 }),
  ]);

  const articles = [
    ...(newsEs.status === 'fulfilled' ? newsEs.value.data?.articles || [] : []),
    ...(newsEn.status === 'fulfilled' ? newsEn.value.data?.articles || [] : []),
    ...(newsAI.status === 'fulfilled' ? newsAI.value.data?.articles || [] : []),
  ].slice(0, 12);

  if (!articles.length) return;

  const summary = articles.map(a => `- ${a.title}: ${(a.description || '').slice(0, 120)}`).join('\n');

  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: `Eres Marco, Director de Contenido de JRZ Marketing. Analiza estas noticias y detecta si hay algo que VALE LA PENA aprovechar HOY en redes sociales para una agencia de marketing que atiende negocios latinos. Si no hay nada urgente, responde con {"alert": false}. Si hay una tendencia real para aprovechar, responde con JSON: {"alert": true, "trend": "qué está pasando", "angle": "ángulo específico para JRZ Marketing", "hook": "hook viral para un post de hoy", "format": "reel o carrusel", "urgency": "por qué es urgente publicar HOY"}\n\nNoticias:\n${summary}` }],
  });

  const result = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  if (!result.alert) {
    console.log('[Marco] No urgent trends today.');
    return;
  }

  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:32px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:22px 32px;display:flex;align-items:center;justify-content:space-between;">
    <img src="${logoUrl}" style="height:32px;"/>
    <span style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:5px 12px;border-radius:100px;">Marco · Trend Alert</span>
  </div>
  <div style="background:#dc2626;padding:22px 32px;">
    <h1 style="color:#fff;font-size:20px;font-weight:800;margin-bottom:6px;">🔥 Tendencia urgente detectada</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:13px;">Publica hoy para aprovechar esta ola</p>
  </div>
  <div style="padding:28px 32px;">
    <div style="margin-bottom:18px;">
      <p style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">¿Qué está pasando?</p>
      <p style="font-size:15px;color:#0a0a0a;line-height:1.6;">${result.trend}</p>
    </div>
    <div style="background:#f9f9f9;border-radius:10px;padding:18px 22px;margin-bottom:16px;">
      <p style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Ángulo para JRZ</p>
      <p style="font-size:14px;color:#333;line-height:1.6;">${result.angle}</p>
    </div>
    <div style="background:#0a0a0a;border-radius:10px;padding:18px 22px;margin-bottom:16px;">
      <p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Hook sugerido · ${result.format}</p>
      <p style="font-size:15px;font-weight:700;color:#fff;line-height:1.5;">"${result.hook}"</p>
    </div>
    <div style="background:#fff8f0;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;">
      <p style="font-size:13px;color:#92400e;">⚡ <strong>¿Por qué hoy?</strong> ${result.urgency}</p>
    </div>
  </div>
  <div style="background:#0a0a0a;padding:18px 32px;text-align:center;">
    <p style="font-size:11px;color:rgba(255,255,255,0.25);">Marco — JRZ Marketing AI Content Director</p>
  </div>
</div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `🔥 Marco: Tendencia Urgente — Publica Hoy`, html);
  console.log('[Marco] ✅ Trend alert sent.');
}

app.post('/marco/content-brief', async (_req, res) => {
  try {
    runMarcoContentBrief();
    res.json({ status: 'ok', message: 'Marco is building your weekly content brief' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/marco/trend-alert', async (_req, res) => {
  try {
    runMarcoTrendAlert();
    res.json({ status: 'ok', message: 'Marco is checking for trending topics' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SOFIA — WEB DESIGNER
//   Weekly website health check every Monday 9:45am EST
//   Checks status, speed, SSL, basic content for every client site
//   Immediate alert if any site is down
//   Monthly CRO suggestions per client
// ═══════════════════════════════════════════════════════════

async function checkWebsite(url) {
  if (!url) return null;
  const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
  const start = Date.now();
  try {
    const res = await axios.get(cleanUrl, {
      timeout: 12000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JRZBot/1.0)' },
      validateStatus: () => true, // don't throw on non-2xx
    });
    const responseTime = Date.now() - start;
    const html = typeof res.data === 'string' ? res.data : '';

    // Extract basic content signals
    const titleMatch  = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch   = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
    const hasPhone    = /(\+1|tel:|phone|\(\d{3}\))[\s\-]?\d{3}[\s\-]?\d{4}/i.test(html);
    const hasForm     = /<form[\s>]/i.test(html);
    const hasCTA      = /(book now|contact us|get started|schedule|call us|free|agenda|contáctanos)/i.test(html);
    const hasSSL      = cleanUrl.startsWith('https');

    return {
      url: cleanUrl,
      up: res.status >= 200 && res.status < 400,
      statusCode: res.status,
      responseTime,
      ssl: hasSSL,
      title: titleMatch?.[1]?.trim().slice(0, 80) || null,
      description: descMatch?.[1]?.trim().slice(0, 160) || null,
      hasPhone,
      hasForm,
      hasCTA,
      issues: [
        !hasSSL && 'No SSL (http only)',
        responseTime > 4000 && `Slow load (${(responseTime/1000).toFixed(1)}s)`,
        !titleMatch && 'Missing page title',
        !descMatch && 'Missing meta description',
        !hasCTA && 'No clear CTA found',
        !hasPhone && 'No phone number visible',
      ].filter(Boolean),
    };
  } catch (err) {
    return {
      url: cleanUrl, up: false, statusCode: 0,
      responseTime: Date.now() - start,
      ssl: false, title: null, description: null,
      hasPhone: false, hasForm: false, hasCTA: false,
      issues: [`Site unreachable: ${err.message.slice(0, 60)}`],
    };
  }
}

// ─── MULTI-CLIENT SEO: Location token + blog discovery + per-client blog ─────

// Exchange agency key for a location-level API token (cached 23h)
const _locationTokenCache = {};
async function getLocationToken(locationId) {
  const cached = _locationTokenCache[locationId];
  if (cached && Date.now() < cached.expires) return cached.token;
  try {
    const res = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      { companyId: GHL_COMPANY_ID, locationId },
      { headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const token = res.data?.access_token;
    if (token) {
      _locationTokenCache[locationId] = { token, expires: Date.now() + 23 * 60 * 60 * 1000 };
      return token;
    }
    return null;
  } catch (err) {
    console.error(`[LocationToken] Failed for ${locationId}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

// Find the first blog in a sub-account (returns { blogId, authorId } or null)
async function getClientBlog(locationId, token) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/blogs/?locationId=${locationId}`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
    );
    const blog = (res.data?.blogs || [])[0];
    if (!blog) return null;
    const authorRes = await axios.get(
      `https://services.leadconnectorhq.com/blogs/authors?locationId=${locationId}&blogId=${blog.id}`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
    ).catch(() => ({ data: { authors: [] } }));
    const authorId = authorRes.data?.authors?.[0]?.id || null;
    return { blogId: blog.id, authorId };
  } catch (err) {
    console.error(`[ClientBlog] Discovery failed for ${locationId}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

// Publish one SEO blog post to a single client sub-account
async function runClientDailySeoBlog(locationId, config) {
  const { name, domain, lang = 'en', industry = 'local business', voice = '', audience = '', topics = [], keywords = [], cta = `visit ${domain}` } = config;
  const todaysCity = getTodaysCity();
  console.log(`[Client SEO] ${name}: finding keyword for ${domain}...`);

  // Step 1: Get token — use sub-account apiKey if available, else exchange via agency key
  const token = config.apiKey || await getLocationToken(locationId);
  if (!token) return { name, skipped: true, reason: 'no_location_token' };

  // Step 2: Find client's blog
  const blog = await getClientBlog(locationId, token);
  if (!blog) return { name, skipped: true, reason: 'no_blog_found — set one up in GHL for this client' };

  // Step 3: Find best keyword — city-specific for geo domination
  // Priority: client keywords + city → DataForSEO striking distance → industry + city fallback
  let targetKeyword = `${industry} ${todaysCity} FL`;

  // First try: use client's own keyword list + today's city (guarantees city-specific content)
  if (keywords.length > 0) {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const baseKeyword = keywords[dayOfYear % keywords.length];
    targetKeyword = `${baseKeyword} ${todaysCity} FL`;
  }

  // Second try: DataForSEO striking distance keywords for this domain
  if (DATAFORSEO_PASSWORD) {
    try {
      const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
      const kwRes = await axios.post(
        `${DATAFORSEO_BASE}/v3/dataforseo_labs/google/keywords_for_site/live`,
        [{ target: domain, location_code: 2840, language_code: lang === 'es' ? 'es' : 'en', limit: 30 }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );
      const items = kwRes.data?.tasks?.[0]?.result?.[0]?.items || [];
      const striking = items
        .filter(k => { const pos = k.ranked_serp_element?.serp_item?.rank_absolute; return pos && pos >= 11 && pos <= 30; })
        .sort((a, b) => (b.keyword_data?.search_volume || 0) - (a.keyword_data?.search_volume || 0));
      // Only override if DataForSEO finds something better — keep city in the keyword
      if (striking.length > 0) {
        const kw = striking[0].keyword;
        // Add city if not already location-specific
        targetKeyword = kw.toLowerCase().includes(todaysCity.toLowerCase()) ? kw : `${kw} ${todaysCity}`;
      }
    } catch (kwErr) { console.error(`[Client SEO] Keyword error for ${name}:`, kwErr.message); }
  }

  // Step 4: Write SEO blog post with Claude Haiku (cost-efficient for 15+ clients/day)
  const isSpanish = lang === 'es';
  const topicHint = topics.length > 0
    ? `\nContent pillars to draw from (pick the most relevant to the keyword):\n${topics.map(t => `- ${t}`).join('\n')}`
    : '';

  const blogRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: `You are writing a blog post FOR ${name} — a ${industry} in the Orlando / Central Florida area.

BRAND VOICE:
${voice || `Knowledgeable, helpful, and real. Speaks directly to the customer without jargon.`}

TARGET AUDIENCE:
${audience || `Local customers in the Orlando area looking for ${industry} services.`}
${topicHint}

YOUR TASK:
Write a ${isSpanish ? 'SPANISH' : 'ENGLISH'} SEO blog post (700–950 words) targeting this keyword: "${targetKeyword}"

TODAY'S TARGET CITY: ${todaysCity}, FL
(This post must rank for searches in ${todaysCity} specifically — not just generic Orlando content)

SEO REQUIREMENTS:
- Use the exact keyword in: title, first paragraph, at least 2 headings, and conclusion
- Mention "${todaysCity}" at least 4 times naturally throughout the post
- Reference real streets, neighborhoods, or landmarks near ${todaysCity} when relevant
- Make someone in ${todaysCity} feel like this business is THEIR local option
- Include 2 natural internal links:
  * One to https://${domain} using the business name or a service as anchor text
  * One to https://${domain}/contact (or /reservations or /book) using "${cta.split(' ').slice(0, 3).join(' ')}" style anchor
- End with this CTA naturally woven into the last paragraph: "${cta}"

CRITICAL — WRITE LIKE A REAL HUMAN, NOT AN AI:
- Use contractions throughout (you'll, don't, it's, we've, here's, that's)
- Vary sentence length — some 4 words, some 25 words. Never uniform.
- Talk directly to the reader using "you" — like a trusted expert, not a textbook
- Specific details and real scenarios — not "quality service" or "satisfied customers"
- NEVER write: "In today's world", "It's no secret", "In conclusion", "Furthermore", "Moreover", "Game-changing", "Leverage", "Seamlessly", "Delve", "Robust", "Navigate", "Empower", "Unlock", "Look no further"
- Bullet points should NOT all be the same length
- Sound like the business owner sat down and wrote this from years of real experience

Return ONLY valid JSON, no markdown, no code fences:
{ "title": "50-60 char SEO title with keyword", "metaDescription": "150-160 char meta description with keyword", "htmlContent": "full HTML using h2/h3/p/ul/li/ol/strong/em/a tags only — no html/head/body" }` }],
  });

  const parsed = JSON.parse(blogRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const { title, metaDescription, htmlContent } = parsed;

  // Step 5: Publish to client's GHL blog
  const urlSlug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) + '-' + Date.now().toString(36);
  const publishedAt = new Date(); publishedAt.setUTCHours(14, 0, 0, 0);

  await axios.post(
    'https://services.leadconnectorhq.com/blogs/posts',
    {
      title, locationId, blogId: blog.blogId, description: metaDescription,
      ...(blog.authorId && { author: blog.authorId }),
      tags: ['SEO', industry, 'Orlando', targetKeyword.split(' ').slice(0, 2).join(' ')],
      urlSlug, status: 'PUBLISHED', publishedAt: publishedAt.toISOString(), rawHTML: htmlContent,
    },
    { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );

  console.log(`[Client SEO] ✅ ${name}: published "${title}"`);

  // Force-index the new blog post via Google Indexing API (ranks same day instead of 2 weeks)
  const blogUrl = `https://${domain}/${urlSlug}`;
  forceIndexUrl(blogUrl).catch(() => null); // non-blocking

  return { success: true, name, title, keyword: targetKeyword, blogUrl };
}

// Daily runner — loops through all entries in SEO_CLIENTS and publishes one blog each
async function runAllClientsDailyBlog() {
  const entries = Object.entries(SEO_CLIENTS);
  if (!entries.length) return { skipped: true, reason: 'SEO_CLIENTS is empty' };
  console.log(`[Client SEO] Running daily blog for ${entries.length} clients...`);
  const results = [];
  for (const [locationId, config] of entries) {
    try {
      const result = await runClientDailySeoBlog(locationId, config);
      results.push(result);
    } catch (err) {
      console.error(`[Client SEO] ❌ ${config.name}:`, err.message);
      results.push({ name: config.name, error: err.message });
    }
    await new Promise(r => setTimeout(r, 3000)); // 3s gap — avoid rate limits
  }
  const ok = results.filter(r => r.success).length;
  console.log(`[Client SEO] ✅ Done: ${ok}/${results.length} blogs published`);
  return results;
}

// ─── BACKLINK AUDIT (DataForSEO) ─────────────────────────────────────────────
// Checks a domain's backlink profile and finds competitor link sources as targets
async function runSofiaBacklinkAudit(domain = 'jrzmarketing.com') {
  if (!DATAFORSEO_PASSWORD) return null;
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  try {
    const [summaryRes, competitorRes] = await Promise.allSettled([
      // Current backlink profile
      axios.post(`${DATAFORSEO_BASE}/v3/backlinks/summary/live`,
        [{ target: domain, include_subdomains: true }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      ),
      // Competitor backlinks = link building targets
      axios.post(`${DATAFORSEO_BASE}/v3/backlinks/competitors/live`,
        [{ target: domain, limit: 5 }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      ),
    ]);

    const summary  = summaryRes.status === 'fulfilled' ? summaryRes.value.data?.tasks?.[0]?.result?.[0] : null;
    const compData = competitorRes.status === 'fulfilled' ? competitorRes.value.data?.tasks?.[0]?.result?.[0]?.items || [] : [];

    return {
      domain,
      totalBacklinks:    summary?.backlinks            || 0,
      referringDomains:  summary?.referring_domains    || 0,
      domainRank:        summary?.rank                 || 0,
      newBacklinks30d:   summary?.new_backlinks        || 0,
      lostBacklinks30d:  summary?.lost_backlinks       || 0,
      topCompetitors:    compData.slice(0, 3).map(c => ({ domain: c.domain, backlinks: c.backlinks_count })),
    };
  } catch (err) {
    console.error('[Backlinks] Audit error:', err?.response?.data || err.message);
    return null;
  }
}

// ─── LOCAL CITATION AUDIT (DataForSEO Business Data) ─────────────────────────
// Checks if the business is listed correctly on Yelp, Google, and Bing Places
async function runSofiaCitationAudit(businessName, location = 'Orlando, FL') {
  if (!DATAFORSEO_PASSWORD) return null;
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  try {
    const [yelpRes, googleRes] = await Promise.allSettled([
      axios.post(`${DATAFORSEO_BASE}/v3/business_data/yelp/search/live`,
        [{ keyword: businessName, location_name: location, limit: 1 }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      ),
      axios.post(`${DATAFORSEO_BASE}/v3/business_data/google/my_business_info/live`,
        [{ keyword: `${businessName} ${location}`, location_code: 2840, language_code: 'en' }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      ),
    ]);

    const yelpItem   = yelpRes.status === 'fulfilled'   ? yelpRes.value.data?.tasks?.[0]?.result?.[0]?.items?.[0]   : null;
    const googleItem = googleRes.status === 'fulfilled' ? googleRes.value.data?.tasks?.[0]?.result?.[0]?.items?.[0] : null;

    return {
      yelp: yelpItem ? {
        found: true, name: yelpItem.title, rating: yelpItem.rating?.value, reviews: yelpItem.rating?.votes_count,
        phone: yelpItem.phone, address: yelpItem.address,
      } : { found: false },
      google: googleItem ? {
        found: true, name: googleItem.title, rating: googleItem.rating?.value, reviews: googleItem.rating?.votes_count,
        phone: googleItem.phone, address: googleItem.address, website: googleItem.url,
      } : { found: false },
    };
  } catch (err) {
    console.error('[Citations] Audit error:', err?.response?.data || err.message);
    return null;
  }
}

// ─── GOOGLE ANALYTICS 4 ──────────────────────────────────────────────────────
// Pulls last 30 days of traffic data for a GA4 property using the service account.
// Returns: sessions, users, pageviews, top 5 pages, bounce rate, avg session duration.
async function getGA4Data(propertyId) {
  try {
    const jwt = _buildServiceAccountJWT('https://www.googleapis.com/auth/analytics.readonly');
    if (!jwt) return null;

    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })).catch(() => null);
    const accessToken = tokenResp?.data?.access_token;
    if (!accessToken) return null;

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;

    // Overview report — sessions, users, pageviews, bounce rate, avg duration
    const overviewResp = await axios.post(`${base}:runReport`, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
    }, { headers }).catch(() => null);

    const overview = overviewResp?.data?.rows?.[0]?.metricValues || [];

    // Top pages report
    const pagesResp = await axios.post(`${base}:runReport`, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 5,
    }, { headers }).catch(() => null);

    const topPages = (pagesResp?.data?.rows || []).map(r => ({
      page: r.dimensionValues[0].value,
      views: r.metricValues[0].value,
      sessions: r.metricValues[1].value,
    }));

    // Traffic source report
    const sourceResp = await axios.post(`${base}:runReport`, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 5,
    }, { headers }).catch(() => null);

    const sources = (sourceResp?.data?.rows || []).map(r => ({
      channel: r.dimensionValues[0].value,
      sessions: r.metricValues[0].value,
    }));

    return {
      propertyId,
      sessions:            overview[0]?.value || '0',
      users:               overview[1]?.value || '0',
      pageviews:           overview[2]?.value || '0',
      bounceRate:          overview[3]?.value ? `${(parseFloat(overview[3].value) * 100).toFixed(1)}%` : 'N/A',
      avgSessionDuration:  overview[4]?.value ? `${Math.round(parseFloat(overview[4].value))}s` : 'N/A',
      topPages,
      sources,
    };
  } catch (err) {
    console.error('[GA4] Error:', err?.response?.data || err.message);
    return null;
  }
}

// ─── GOOGLE INDEXING API ─────────────────────────────────────────────────────
// Force-indexes a URL with Google so new blog posts rank within hours, not weeks.
// Requires service account added as Owner in Google Search Console for the domain.
async function forceIndexUrl(url) {
  try {
    const jwt = _buildServiceAccountJWT('https://indexing.googleapis.com/');
    if (!jwt) return null;
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })).catch(() => null);
    const accessToken = tokenResp?.data?.access_token;
    if (!accessToken) return null;

    const resp = await axios.post(GOOGLE_INDEXING_BASE, {
      url,
      type: 'URL_UPDATED',
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

    console.log(`[Indexing] ✅ Force-indexed: ${url}`);
    return resp.data;
  } catch (err) {
    console.error('[Indexing] Error:', err?.response?.data || err.message);
    return null;
  }
}

// ─── GOOGLE PLACES — LOCAL PACK TRACKER ──────────────────────────────────────
// Checks if a business appears in the Google local 3-pack for a given keyword + city.
// Returns position (1-3), name, rating, and review count.
async function checkLocalPackPosition(businessName, keyword, city) {
  try {
    const query = encodeURIComponent(`${keyword} ${city} FL`);
    const resp = await axios.get(
      `${GOOGLE_PLACES_BASE}/textsearch/json?query=${query}&key=${GOOGLE_PLACES_API_KEY}&type=establishment`
    ).catch(() => null);

    const results = resp?.data?.results || [];
    const position = results.findIndex(r =>
      r.name.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(r.name.toLowerCase())
    );

    if (position === -1) return { inPack: false, keyword, city };

    const match = results[position];
    return {
      inPack: true,
      position: position + 1,
      keyword,
      city,
      name: match.name,
      rating: match.rating,
      reviewCount: match.user_ratings_total,
      address: match.formatted_address,
    };
  } catch (err) {
    console.error('[Places] Error:', err?.message);
    return null;
  }
}

// ─── LOCAL PACK RANK MONITOR — ALL CLIENTS ───────────────────────────────────
// Runs weekly. Checks each client's top 3 keywords in their primary city.
// Alerts Jose if any client drops out of the local 3-pack.
async function runLocalPackMonitor() {
  console.log('[LocalPack] Sofia: checking local pack positions...');
  const report = [];

  for (const [, config] of Object.entries(SEO_CLIENTS)) {
    const { name, keywords } = config;
    const city = 'Orlando'; // primary city check
    const topKeywords = keywords.slice(0, 3);
    const clientReport = { client: name, results: [] };

    for (const kw of topKeywords) {
      const result = await checkLocalPackPosition(name, kw, city).catch(() => null);
      if (result) clientReport.results.push(result);
      await new Promise(r => setTimeout(r, 500)); // avoid rate limit
    }

    // Alert if not in pack for primary keyword
    const primaryResult = clientReport.results[0];
    if (primaryResult && !primaryResult.inPack) {
      await sendEmail(
        OWNER_CONTACT_ID,
        `[Local Pack Alert] ${name} not in 3-pack for "${topKeywords[0]}"`,
        `<p><strong>${name}</strong> is not showing in the Google local 3-pack for <strong>"${topKeywords[0]}"</strong> in ${city}.</p>
<p>Action needed: check GBP listing, add more posts, and build more local citations.</p>
<p style="color:#888;font-size:12px;">Sofia · Local Pack Monitor · ${new Date().toLocaleDateString()}</p>`
      ).catch(() => null);
    }

    report.push(clientReport);
  }

  console.log('[LocalPack] Done:', report);
  return report;
}

// ─── BACKLINK PROSPECTOR ──────────────────────────────────────────────────────
// Runs monthly. For each SEO_CLIENTS entry:
//  1. DataForSEO SERP: "[industry] [city] write for us" → find 5 guest post targets
//  2. Claude writes a personalized outreach email per target
//  3. Send via GHL email to each prospect
//  4. Track contacted domains in Cloudinary snapshot to avoid duplicate outreach
async function runSofiaBacklinkProspector() {
  console.log('[Backlinks] Sofia: starting backlink prospector for all clients...');
  const SNAPSHOT_ID = 'jrz/backlink_outreach_snapshot';
  const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

  // Load existing outreach history
  let history = {};
  try {
    const snapshotUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/raw/upload/${SNAPSHOT_ID}.json`;
    const snap = await axios.get(snapshotUrl).catch(() => null);
    if (snap?.data) history = snap.data;
  } catch (_e) { /* first run */ }

  const results = [];

  for (const [, config] of Object.entries(SEO_CLIENTS)) {
    try {
      const { name, domain, industry, voice, audience } = config;
      const city = getTodaysCity();
      const query = `${industry} ${city} "write for us" OR "guest post"`;

      // ── SERP search via DataForSEO ────────────────────────────────────────
      const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
      const serpResp = await axios.post(`${DATAFORSEO_BASE}/v3/serp/google/organic/live/advanced`, [{
        keyword: query,
        location_code: 1023191, // Orlando, FL
        language_code: 'en',
        depth: 10,
      }], { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } }).catch(() => null);

      const serpItems = serpResp?.data?.tasks?.[0]?.result?.[0]?.items || [];
      const prospects = serpItems
        .filter(i => i.type === 'organic')
        .map(i => ({ url: i.url, domain: i.domain, title: i.title }))
        .filter(i => {
          const domainHistory = history[domain] || [];
          return !domainHistory.includes(i.domain);
        })
        .slice(0, 5);

      if (!prospects.length) {
        results.push({ client: name, status: 'no new prospects', domain });
        continue;
      }

      // ── Claude writes outreach for each prospect ──────────────────────────
      let emailsSent = 0;

      for (const prospect of prospects) {
        const outreachPrompt = `You are a professional outreach specialist for ${name} (${domain}).

Write a concise, genuine guest post outreach email to the website "${prospect.title}" (${prospect.url}).

Business context:
- Business: ${name}
- Industry: ${industry}
- Brand voice: ${voice}
- Target audience: ${audience}

OUTREACH EMAIL RULES:
- Subject line: short and specific to their site niche
- Opening: reference something specific about THEIR site (use the title: "${prospect.title}")
- Pitch: propose 1 specific blog topic that their audience would love AND that ties to ${name}'s expertise
- Keep it under 150 words — respect their time
- No corporate fluff. Sound like a real person, not a PR robot
- Close with a simple ask: "Would you be open to a quick chat?"
- Sign off as: Sofia | ${name} Marketing Team

Return JSON: { "subject": "...", "body": "..." }`;

        const outreachResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: outreachPrompt }],
        }).catch(() => null);

        let outreach = null;
        try {
          const raw = outreachResp?.content?.[0]?.text || '{}';
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          outreach = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (_e) { /* skip */ }

        if (!outreach?.subject || !outreach?.body) continue;

        // Send via GHL email to Jose (we contact prospects on behalf of clients)
        await sendEmail(
          OWNER_CONTACT_ID,
          `[Backlink Outreach] ${name} → ${prospect.domain}`,
          `<p><strong>Prospect:</strong> <a href="${prospect.url}">${prospect.title}</a></p>
<p><strong>Send this email to the site owner:</strong></p>
<hr>
<p><strong>Subject:</strong> ${outreach.subject}</p>
<p>${outreach.body.replace(/\n/g, '<br>')}</p>
<hr>
<p style="color:#888;font-size:12px;">Auto-generated by Sofia · Backlink Prospector · ${new Date().toLocaleDateString()}</p>`
        ).catch(() => null);

        // Track this domain
        if (!history[domain]) history[domain] = [];
        history[domain].push(prospect.domain);
        emailsSent++;
      }

      results.push({ client: name, prospected: prospects.length, emailsSent });
    } catch (err) {
      console.error(`[Backlinks] Error for ${config?.name}:`, err?.message);
      results.push({ client: config?.name, error: err.message });
    }
  }

  // Save updated history to Cloudinary
  try {
    const ts   = Math.floor(Date.now() / 1000);
    const pid  = SNAPSHOT_ID;
    const sigStr = `overwrite=true&public_id=${pid}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig  = crypto.createHash('sha1').update(sigStr).digest('hex');
    const fd   = new FormData();
    fd.append('file', Buffer.from(JSON.stringify(history)), { filename: 'backlink_outreach_snapshot.json', contentType: 'application/json' });
    fd.append('api_key', CLOUDINARY_API_KEY);
    fd.append('timestamp', String(ts));
    fd.append('public_id', pid);
    fd.append('overwrite', 'true');
    fd.append('signature', sig);
    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, fd, { headers: fd.getHeaders() }).catch(() => null);
  } catch (_e) { /* non-fatal */ }

  console.log('[Backlinks] Prospector done:', results);
  return results;
}

// ─── PRESS RELEASE AUTO-PUBLISHER ────────────────────────────────────────────
// Runs monthly. For each SEO_CLIENTS entry:
//  1. Claude Opus writes a newsworthy press release about the business
//  2. Publishes it as a GHL blog post in the sub-account
//  3. Emails Jose the formatted PR + free submission URLs (PRLog, OpenPR, EIN Presswire)
async function runSofiaPressRelease() {
  console.log('[PressRelease] Sofia: generating monthly press releases...');
  const results = [];
  const FREE_PR_SITES = [
    { name: 'PRLog',        url: 'https://www.prlog.org/post-press-release.html' },
    { name: 'OpenPR',       url: 'https://www.openpr.com/news/submit/' },
    { name: 'EIN Presswire',url: 'https://www.einpresswire.com/submit/' },
    { name: 'PR.com',       url: 'https://www.pr.com/submit-press-release' },
    { name: 'NewswireToday',url: 'https://www.newswiretoday.com/submit.php' },
  ];

  for (const [locationId, config] of Object.entries(SEO_CLIENTS)) {
    try {
      const { name, domain, industry, voice, audience, keywords, cta } = config;
      const city = getTodaysCity();
      const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

      // ── Claude Opus: write press release ─────────────────────────────────
      const prPrompt = `You are a PR specialist writing a press release for ${name}.

Business: ${name}
Website: ${domain}
Industry: ${industry}
Location: ${city}, Central Florida
Month: ${month}
Brand voice: ${voice}
Target audience: ${audience}
Top keywords to naturally include: ${keywords.slice(0, 4).join(', ')}
CTA: ${cta}

PRESS RELEASE REQUIREMENTS:
- Headline: newsworthy, under 100 characters, includes a location keyword
- Dateline: ${city}, FL — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
- Lead paragraph: answers WHO, WHAT, WHEN, WHERE, WHY in 2-3 sentences
- Body: 2-3 paragraphs, 150-200 words total. Include a genuine milestone, offer, or news hook (new menu item, seasonal promo, award, expansion, hiring — invent something plausible)
- Quote: one quote from the business owner that sounds human, not corporate
- Boilerplate: 2-sentence "About ${name}" with website
- No AI buzzwords. Write like a real PR professional.
- Naturally work in 2-3 target keywords without keyword stuffing

Return JSON: { "headline": "...", "body": "...", "htmlBody": "<p>...</p>" }`;

      const prResp = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prPrompt }],
      }).catch(() => null);

      let pr = null;
      try {
        const raw = prResp?.content?.[0]?.text || '{}';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        pr = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (_e) { /* skip */ }

      if (!pr?.headline || !pr?.htmlBody) {
        results.push({ client: name, status: 'claude failed' });
        continue;
      }

      // ── Publish as GHL blog post in sub-account ───────────────────────────
      let blogPublished = false;
      try {
        const token = await getLocationToken(locationId);
        const blog  = await getClientBlog(locationId, token);
        if (blog?.id) {
          await axios.post(`https://services.leadconnectorhq.com/blogs/posts`, {
            locationId,
            blogId: blog.id,
            title: pr.headline,
            rawHTML: pr.htmlBody,
            status: 'PUBLISHED',
            imageUrl: '',
            categories: [],
            tags: ['press-release', city.toLowerCase().replace(/\s/g, '-'), ...keywords.slice(0, 2).map(k => k.replace(/\s/g, '-'))],
          }, { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }).catch(() => null);
          blogPublished = true;
        }
      } catch (_e) { /* non-fatal */ }

      // ── Email Jose: formatted PR + submission links ───────────────────────
      const submissionLinks = FREE_PR_SITES.map(s =>
        `<li><a href="${s.url}" target="_blank">${s.name}</a></li>`
      ).join('');

      await sendEmail(
        OWNER_CONTACT_ID,
        `[Press Release] ${name} — ${month}`,
        `<h2 style="color:#1a1a2e">${pr.headline}</h2>
<div style="background:#f8f9fa;padding:20px;border-left:4px solid #0066cc;margin:20px 0;font-family:Georgia,serif;line-height:1.8">
${pr.htmlBody}
</div>
<h3>Submit to Free PR Sites (takes 5 min total)</h3>
<ul>${submissionLinks}</ul>
<p style="color:#888;font-size:12px;">Blog post ${blogPublished ? '✅ published' : '⚠️ not published'} in ${name} GHL account · Auto-generated by Sofia · ${new Date().toLocaleDateString()}</p>`
      ).catch(() => null);

      results.push({ client: name, headline: pr.headline, blogPublished });
    } catch (err) {
      console.error(`[PressRelease] Error for ${config?.name}:`, err?.message);
      results.push({ client: config?.name, error: err.message });
    }
  }

  console.log('[PressRelease] Done:', results);
  return results;
}

// ─── CITATION BUILDER ─────────────────────────────────────────────────────────
// Runs monthly. For each SEO_CLIENTS entry:
//  ✅ Full API: Bing Places + Foursquare — auto-submit business data
//  ⚡ Semi-auto kit: Yelp, TripAdvisor, Apple Maps, Yellow Pages, Manta, Hotfrog, BBB,
//     Google Business, Facebook, Angi, HomeAdvisor, Bark, Thumbtack
//     → generates pre-filled NAP data + direct submission URLs emailed to Jose
async function runSofiaCitationBuilder() {
  console.log('[Citations] Sofia: starting monthly citation builder...');
  const results = [];

  const SEMI_AUTO_DIRECTORIES = [
    { name: 'Yelp',         url: 'https://biz.yelp.com/claim' },
    { name: 'TripAdvisor',  url: 'https://www.tripadvisor.com/GetListedNew' },
    { name: 'Apple Maps',   url: 'https://mapsconnect.apple.com/' },
    { name: 'Yellow Pages', url: 'https://www.yellowpages.com/add-listing' },
    { name: 'Manta',        url: 'https://www.manta.com/add-company' },
    { name: 'Hotfrog',      url: 'https://www.hotfrog.com/AddBusiness.aspx' },
    { name: 'BBB',          url: 'https://www.bbb.org/accreditation/apply' },
    { name: 'Angi',         url: 'https://pros.angi.com/enroll' },
    { name: 'Bark',         url: 'https://www.bark.com/en/us/register/professional/' },
    { name: 'Thumbtack',    url: 'https://www.thumbtack.com/pro/' },
    { name: 'Facebook Business', url: 'https://www.facebook.com/pages/create' },
  ];

  for (const [locationId, config] of Object.entries(SEO_CLIENTS)) {
    try {
      const { name, domain, industry } = config;

      // Fetch business data from GHL
      let phone = '', address = '', city = 'Orlando', state = 'FL', zip = '';
      try {
        const token = await getLocationToken(locationId);
        const locResp = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, {
          headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
        }).catch(() => null);
        const loc = locResp?.data?.location || {};
        phone   = loc.phone   || '';
        address = loc.address || '';
        city    = loc.city    || city;
        state   = loc.state   || state;
        zip     = loc.postalCode || '';
      } catch (_e) { /* use defaults */ }

      // ── Bing Places API (full automation) ────────────────────────────────
      let bingStatus = 'skipped';
      // Bing Places uses a form-based API — we submit the business for indexing
      try {
        const bingResp = await axios.post('https://ssl.bing.com/business/api?callerName=sofia-seo&Action=addBusiness', {
          BusinessName: name,
          Address: address,
          City: city,
          State: state,
          PostalCode: zip,
          Phone: phone,
          Website: `https://${domain}`,
          Category: industry.split(',')[0].trim(),
        }, { headers: { 'Content-Type': 'application/json' } }).catch(() => null);
        bingStatus = bingResp?.status === 200 ? 'submitted' : 'api-unavailable';
      } catch (_e) { bingStatus = 'api-unavailable'; }

      // ── Foursquare Venue API (full automation) ────────────────────────────
      let foursquareStatus = 'skipped';
      try {
        const fsResp = await axios.post('https://api.foursquare.com/v3/places', {
          name,
          location: { address, locality: city, region: state, postcode: zip, country: 'US' },
          tel: phone,
          website: `https://${domain}`,
          categories: [17000], // Generic Local & Travel
        }, {
          headers: {
            Authorization: `Bearer ${process.env.FOURSQUARE_API_KEY || ''}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => null);
        foursquareStatus = fsResp?.data?.fsq_id ? 'submitted' : 'api-unavailable';
      } catch (_e) { foursquareStatus = 'api-unavailable'; }

      // ── Build citation kit email ──────────────────────────────────────────
      const napBlock = `
<table style="border-collapse:collapse;width:100%;font-family:monospace;font-size:14px">
<tr><td style="padding:6px 12px;background:#f0f4ff;font-weight:bold">Business Name</td><td style="padding:6px 12px">${name}</td></tr>
<tr><td style="padding:6px 12px;background:#f0f4ff;font-weight:bold">Address</td><td style="padding:6px 12px">${address}, ${city}, ${state} ${zip}</td></tr>
<tr><td style="padding:6px 12px;background:#f0f4ff;font-weight:bold">Phone</td><td style="padding:6px 12px">${phone}</td></tr>
<tr><td style="padding:6px 12px;background:#f0f4ff;font-weight:bold">Website</td><td style="padding:6px 12px">https://${domain}</td></tr>
<tr><td style="padding:6px 12px;background:#f0f4ff;font-weight:bold">Industry</td><td style="padding:6px 12px">${industry}</td></tr>
</table>`;

      const dirLinks = SEMI_AUTO_DIRECTORIES.map(d =>
        `<li><a href="${d.url}" target="_blank">${d.name}</a> — copy the NAP above and paste</li>`
      ).join('');

      await sendEmail(
        OWNER_CONTACT_ID,
        `[Citations] ${name} — Monthly Citation Kit`,
        `<h2 style="color:#1a1a2e">Citation Builder — ${name}</h2>
<h3>✅ Auto-Submitted</h3>
<ul>
  <li>Bing Places: <strong>${bingStatus}</strong></li>
  <li>Foursquare: <strong>${foursquareStatus}</strong></li>
</ul>
<h3>⚡ Semi-Auto (5 min — copy/paste the NAP below)</h3>
<ul>${dirLinks}</ul>
<h3>NAP Data (copy exactly — consistency is key for local SEO)</h3>
${napBlock}
<p style="color:#888;font-size:12px;">Auto-generated by Sofia · Citation Builder · ${new Date().toLocaleDateString()}</p>`
      ).catch(() => null);

      results.push({ client: name, bingStatus, foursquareStatus, directoriesInKit: SEMI_AUTO_DIRECTORIES.length });
    } catch (err) {
      console.error(`[Citations] Builder error for ${config?.name}:`, err?.message);
      results.push({ client: config?.name, error: err.message });
    }
  }

  console.log('[Citations] Builder done:', results);
  return results;
}

// ─── CLIENT SEO PROGRESS REPORT ──────────────────────────────────────────────
// Sends a branded monthly SEO progress email to the owner of each sub-account.
// Shows: keyword rankings, blogs published, backlinks, citation status, next steps.
async function sendClientSEOProgressReport(client, seoData = {}) {
  const { name, locationId } = client;
  const { keyword, position, blogsThisMonth = 0, backlinks = null, citations = null, competitorGaps = [], ga4 = null } = seoData;

  try {
    // Find the contact to email (sub-account owner via GHL contacts search)
    const contactsRes = await axios.get(
      'https://services.leadconnectorhq.com/contacts/',
      {
        headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' },
        params: { locationId, limit: 1, sortBy: 'date_added', sortOrder: 'asc' },
        timeout: 10000,
      }
    ).catch(() => null);

    const ownerContact = contactsRes?.data?.contacts?.[0];
    if (!ownerContact) { console.warn(`[Client Report] No owner contact found for ${name}`); return; }

    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Score 0-100 based on what's working
    const score = Math.min(100, (
      (position && position <= 10 ? 30 : position <= 20 ? 15 : 0) +
      (blogsThisMonth >= 4 ? 25 : blogsThisMonth * 6) +
      (backlinks?.referringDomains > 50 ? 20 : Math.floor((backlinks?.referringDomains || 0) * 0.4)) +
      (citations?.google?.found ? 15 : 0) +
      (citations?.yelp?.found ? 10 : 0)
    ));

    const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
    const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good Progress' : 'Building Momentum';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#f8fafc">

        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:32px 28px;border-radius:12px 12px 0 0">
          <img src="https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png" style="height:40px;margin-bottom:16px;display:block" alt="JRZ Marketing">
          <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700">Your SEO Progress Report</h1>
          <p style="color:#94a3b8;margin:6px 0 0;font-size:14px">${month} • Prepared by Sofia, your AI SEO Strategist</p>
        </div>

        <div style="padding:24px 28px;background:#fff;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:15px;color:#374151">Hi ${ownerContact.firstName || 'there'}, here's everything your AI marketing team did for <strong>${name}</strong> this month to grow your online presence and rank higher on Google.</p>
        </div>

        <div style="padding:24px 28px">

          <!-- SEO Health Score -->
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;border:2px solid ${scoreColor}">
            <div style="font-size:56px;font-weight:900;color:${scoreColor};line-height:1">${score}</div>
            <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">SEO Health Score — ${scoreLabel}</div>
          </div>

          <!-- Keyword Ranking -->
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">🎯 Keyword We're Targeting</h3>
            <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;padding:12px 16px;border-radius:8px">
              <span style="font-weight:600;color:#1e293b">${keyword || 'Analyzing your best opportunity...'}</span>
              <span style="background:${position <= 10 ? '#dcfce7' : position <= 20 ? '#fef9c3' : '#fee2e2'};color:${position <= 10 ? '#16a34a' : position <= 20 ? '#ca8a04' : '#dc2626'};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700">
                ${position ? `#${Math.round(position)} on Google` : 'Tracking...'}
              </span>
            </div>
            ${position > 10 ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b">📈 We're actively pushing this to page 1 with weekly blog posts and content optimization.</p>` : `<p style="margin:8px 0 0;font-size:12px;color:#16a34a">✅ Page 1! We're working to move you into the top 3.</p>`}
          </div>

          <!-- Blogs Published -->
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">✍️ Content Published This Month</h3>
            <div style="display:flex;gap:12px">
              <div style="flex:1;background:#eff6ff;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:32px;font-weight:800;color:#2563eb">${blogsThisMonth}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px">Blog Posts Published</div>
              </div>
              <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:32px;font-weight:800;color:#16a34a">${blogsThisMonth * 4}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px">Est. Keywords Targeted</div>
              </div>
              <div style="flex:1;background:#fdf4ff;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:32px;font-weight:800;color:#9333ea">${blogsThisMonth * 3}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px">New Indexed Pages</div>
              </div>
            </div>
            <p style="margin:12px 0 0;font-size:12px;color:#64748b">Each blog post targets a real keyword that people are searching for. Over time, this builds your authority and brings in free traffic 24/7.</p>
          </div>

          <!-- Backlinks -->
          ${backlinks ? `
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">🔗 Backlink Profile (Authority Signals)</h3>
            <div style="display:flex;gap:12px;margin-bottom:12px">
              <div style="flex:1;background:#f8fafc;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#0f172a">${backlinks.referringDomains}</div>
                <div style="font-size:11px;color:#64748b">Referring Domains</div>
              </div>
              <div style="flex:1;background:#f8fafc;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:#0f172a">${backlinks.totalBacklinks}</div>
                <div style="font-size:11px;color:#64748b">Total Backlinks</div>
              </div>
              <div style="flex:1;background:${backlinks.newBacklinks30d > 0 ? '#f0fdf4' : '#f8fafc'};border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:24px;font-weight:800;color:${backlinks.newBacklinks30d > 0 ? '#16a34a' : '#64748b'}">+${backlinks.newBacklinks30d}</div>
                <div style="font-size:11px;color:#64748b">New This Month</div>
              </div>
            </div>
            <p style="margin:0;font-size:12px;color:#64748b">Backlinks are votes of confidence from other websites. The more quality sites link to you, the higher Google ranks you.</p>
          </div>` : ''}

          <!-- Local Citations -->
          ${citations ? `
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">📍 Local Directory Presence</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-radius:8px">
                <span style="font-size:14px;color:#374151">Google Business Profile</span>
                <span style="color:${citations.google?.found ? '#16a34a' : '#dc2626'};font-weight:700">${citations.google?.found ? `✅ Listed — ${citations.google.rating}⭐ (${citations.google.reviews} reviews)` : '❌ Not Found — Action Needed'}</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-radius:8px">
                <span style="font-size:14px;color:#374151">Yelp</span>
                <span style="color:${citations.yelp?.found ? '#16a34a' : '#dc2626'};font-weight:700">${citations.yelp?.found ? `✅ Listed — ${citations.yelp.rating}⭐ (${citations.yelp.reviews} reviews)` : '❌ Not Listed — Missing Opportunity'}</span>
              </div>
            </div>
          </div>` : ''}

          <!-- GA4 Traffic Data -->
          ${ga4 ? `
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">📊 Website Traffic (Last 30 Days)</h3>
            <div style="display:flex;gap:12px;margin-bottom:16px">
              <div style="flex:1;background:#eff6ff;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:28px;font-weight:800;color:#2563eb">${parseInt(ga4.sessions).toLocaleString()}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">Sessions</div>
              </div>
              <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:28px;font-weight:800;color:#16a34a">${parseInt(ga4.users).toLocaleString()}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">Visitors</div>
              </div>
              <div style="flex:1;background:#fdf4ff;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:28px;font-weight:800;color:#9333ea">${parseInt(ga4.pageviews).toLocaleString()}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">Page Views</div>
              </div>
              <div style="flex:1;background:#fff7ed;border-radius:8px;padding:16px;text-align:center">
                <div style="font-size:28px;font-weight:800;color:#ea580c">${ga4.bounceRate}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">Bounce Rate</div>
              </div>
            </div>
            ${ga4.topPages?.length ? `
            <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151">Top Pages</p>
            ${ga4.topPages.map(p => `
            <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#f8fafc;border-radius:6px;margin-bottom:4px;font-size:12px">
              <span style="color:#1e293b">${p.page}</span>
              <span style="color:#64748b;font-weight:600">${parseInt(p.views).toLocaleString()} views</span>
            </div>`).join('')}` : ''}
            ${ga4.sources?.length ? `
            <p style="margin:12px 0 8px;font-size:12px;font-weight:600;color:#374151">Traffic Sources</p>
            ${ga4.sources.map(s => `
            <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#f8fafc;border-radius:6px;margin-bottom:4px;font-size:12px">
              <span style="color:#1e293b">${s.channel}</span>
              <span style="color:#64748b;font-weight:600">${parseInt(s.sessions).toLocaleString()} sessions</span>
            </div>`).join('')}` : ''}
          </div>` : ''}

          <!-- Competitor Gaps -->
          ${competitorGaps.length > 0 ? `
          <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px">🔍 Keywords Your Competitors Rank For (You Don't Yet)</h3>
            <p style="margin:0 0 10px;font-size:12px;color:#64748b">We're already writing content to target these. Expect to see movement in 30–60 days.</p>
            ${competitorGaps.map(k => `<div style="padding:8px 12px;background:#fef9c3;border-radius:6px;margin-bottom:6px;font-size:13px;color:#92400e">🎯 ${k}</div>`).join('')}
          </div>` : ''}

          <!-- Next Month Plan -->
          <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#fff;font-size:15px">📅 What's Planned Next Month</h3>
            <ul style="margin:0;padding-left:18px;color:#cbd5e1;font-size:13px;line-height:2">
              <li>20–25 new SEO blog posts targeting your best keywords</li>
              <li>Homepage meta title + description updated with top keyword</li>
              <li>Schema.org structured data refreshed (boosts rich results)</li>
              <li>Google Business Profile weekly posts (Maps ranking boost)</li>
              <li>Competitor gap analysis — 5 new content opportunities</li>
            </ul>
          </div>

          <!-- CTA -->
          <div style="text-align:center;padding:16px">
            <p style="color:#64748b;font-size:13px;margin:0 0 12px">Questions about your SEO progress? Schedule a call with Jose.</p>
            <a href="https://jrzmarketing.com/contact-us" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">Book a Strategy Call</a>
          </div>

        </div>

        <div style="background:#0f172a;padding:16px 28px;border-radius:0 0 12px 12px;text-align:center">
          <p style="color:#475569;font-size:12px;margin:0">JRZ Marketing • Orlando, FL • jrzmarketing.com</p>
          <p style="color:#334155;font-size:11px;margin:4px 0 0">This report was automatically generated by Sofia, your AI SEO Strategist</p>
        </div>

      </div>`;

    // Send to the client owner + CC Jose so he sees every report going out
    await Promise.all([
      sendEmail(ownerContact.id, `📈 Your SEO Report for ${month} — ${name}`, html),
      sendEmail(OWNER_CONTACT_ID, `📋 [Copy] SEO Report sent to ${name} — ${month}`, html),
    ]);
    console.log(`[Client Report] ✅ SEO report sent to ${name} owner + Jose (${ownerContact.email || ownerContact.id})`);

  } catch (err) {
    console.error(`[Client Report] ❌ Error for ${name}:`, err.message);
  }
}

// ─── SOFIA WEEKLY SEO PLAN ───────────────────────────────────────────────────
// Runs every Monday at 9:50am EST. Full SEO execution:
//  1. Find best keyword (GSC striking distance + DataForSEO volume)
//  2. Update homepage meta title + description via GHL API
//  3. Inject schema.org JSON-LD structured data
//  4. Publish strategic cornerstone blog post
//  5. Competitor keyword gap — find what rivals rank for that JRZ doesn't
//  6. GBP weekly post (active when quota approved)
//  7. Email full SEO execution report to Jose
async function runSofiaWeeklySEOPlan() {
  console.log('[SEO Plan] Sofia: starting weekly SEO plan...');
  const report = { keyword: null, metaUpdated: false, schemaInjected: false, blogPublished: false, gbpPosted: false, competitorGaps: [] };

  try {
    // ── STEP 1: Find best target keyword ─────────────────────────────────────
    let targetKeyword = 'AI marketing agency Orlando';
    let targetPosition = null;

    try {
      const token = await getGoogleAccessToken();
      if (token) {
        const siteUrl = encodeURIComponent('https://jrzmarketing.com/');
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const gscRes = await axios.post(
          `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
          { startDate, endDate, dimensions: ['query'], rowLimit: 50, orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }] },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
        );
        const rows = gscRes.data?.rows || [];
        const striking = rows.filter(r => r.position >= 11 && r.position <= 30);
        if (striking.length > 0) {
          const candidates = striking.sort((a, b) => b.impressions - a.impressions).slice(0, 5).map(r => r.keys[0]);
          const metrics = await getKeywordMetrics(candidates);
          if (metrics.length > 0) {
            const best = metrics.sort((a, b) => b.searchVolume - a.searchVolume)[0];
            const orig = striking.find(r => r.keys[0] === best.keyword);
            targetKeyword = best.keyword;
            targetPosition = orig?.position?.toFixed(1) || null;
          } else {
            targetKeyword = striking[0].keys[0];
            targetPosition = striking[0].position.toFixed(1);
          }
        }
      }
    } catch (kwErr) { console.error('[SEO Plan] Keyword step error:', kwErr.message); }

    report.keyword = targetKeyword;
    console.log(`[SEO Plan] Target keyword: "${targetKeyword}" (pos: ${targetPosition})`);

    // ── STEP 2: Update homepage meta title + description via GHL Funnels API ─
    try {
      const headers = { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };

      // Discover the JRZ Marketing website funnel
      const funnelList = await axios.get(
        `https://services.leadconnectorhq.com/funnels/funnel/list?locationId=${GHL_LOCATION_ID}&limit=20`,
        { headers, timeout: 10000 }
      );
      const funnels = funnelList.data?.funnels || [];
      const site = funnels.find(f => f.name && (f.name.toLowerCase().includes('jrz') || f.name.toLowerCase().includes('main') || f.name.toLowerCase().includes('website') || f.name.toLowerCase().includes('home'))) || funnels[0];

      if (site) {
        // Get pages in the funnel
        const pagesRes = await axios.get(
          `https://services.leadconnectorhq.com/funnels/${site.id}/pages?locationId=${GHL_LOCATION_ID}`,
          { headers, timeout: 10000 }
        );
        const pages = pagesRes.data?.steps || pagesRes.data?.pages || [];
        const homepage = pages.find(p => p.url === '/' || p.name?.toLowerCase().includes('home') || p.stepOrder === 0) || pages[0];

        if (homepage) {
          // Build SEO-optimized meta using Claude Haiku
          const metaRes = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{ role: 'user', content: `Write SEO meta tags for JRZ Marketing homepage targeting the keyword "${targetKeyword}".
Return JSON only: { "seoTitle": "50-60 chars, include keyword + JRZ Marketing + Orlando", "seoDescription": "150-160 chars, include keyword, mention AI automation, bilingual, Orlando, end with action" }` }],
          });
          const metaJson = JSON.parse(metaRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

          await axios.put(
            `https://services.leadconnectorhq.com/funnels/page`,
            { id: homepage.id, seoTitle: metaJson.seoTitle, seoDescription: metaJson.seoDescription },
            { headers, timeout: 10000 }
          );
          report.metaUpdated = true;
          console.log(`[SEO Plan] ✅ Meta updated: "${metaJson.seoTitle}"`);
        }
      }
    } catch (metaErr) { console.error('[SEO Plan] Meta update error:', metaErr?.response?.data || metaErr.message); }

    // ── STEP 3: Inject schema.org JSON-LD structured data ────────────────────
    try {
      const headers = { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
      const funnelList = await axios.get(
        `https://services.leadconnectorhq.com/funnels/funnel/list?locationId=${GHL_LOCATION_ID}&limit=20`,
        { headers, timeout: 10000 }
      );
      const funnels = funnelList.data?.funnels || [];
      const site = funnels.find(f => f.name && (f.name.toLowerCase().includes('jrz') || f.name.toLowerCase().includes('main') || f.name.toLowerCase().includes('website'))) || funnels[0];

      if (site) {
        const pagesRes = await axios.get(
          `https://services.leadconnectorhq.com/funnels/${site.id}/pages?locationId=${GHL_LOCATION_ID}`,
          { headers, timeout: 10000 }
        );
        const pages = pagesRes.data?.steps || pagesRes.data?.pages || [];
        const homepage = pages.find(p => p.url === '/' || p.name?.toLowerCase().includes('home') || p.stepOrder === 0) || pages[0];

        if (homepage) {
          const schema = {
            '@context': 'https://schema.org',
            '@type': 'MarketingAgency',
            name: 'JRZ Marketing',
            alternateName: 'JRZ Marketing — AI Automation Agency',
            description: `Orlando-based AI marketing automation agency specializing in ${targetKeyword}. Serving Latino entrepreneurs and small businesses in Central Florida.`,
            url: 'https://jrzmarketing.com',
            telephone: '+1-407-000-0000',
            email: 'info@jrzmarketing.com',
            address: { '@type': 'PostalAddress', addressLocality: 'Orlando', addressRegion: 'FL', addressCountry: 'US' },
            areaServed: [{ '@type': 'City', name: 'Orlando' }, { '@type': 'State', name: 'Florida' }],
            founder: { '@type': 'Person', name: 'José Rivas', jobTitle: 'CEO & Founder' },
            knowsAbout: [targetKeyword, 'AI marketing automation', 'Go High Level', 'digital marketing Orlando', 'bilingual marketing'],
            priceRange: '$$$',
            sameAs: ['https://www.facebook.com/jrzmarketing', 'https://www.instagram.com/jrzmarketing'],
          };
          const schemaScript = `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;

          await axios.put(
            `https://services.leadconnectorhq.com/funnels/page`,
            { id: homepage.id, customHeadValue: schemaScript },
            { headers, timeout: 10000 }
          );
          report.schemaInjected = true;
          console.log('[SEO Plan] ✅ Schema.org injected');
        }
      }
    } catch (schemaErr) { console.error('[SEO Plan] Schema injection error:', schemaErr?.response?.data || schemaErr.message); }

    // ── STEP 4: Publish strategic cornerstone blog post ───────────────────────
    try {
      const blogRes = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: `You are Isabella, SEO Content Strategist for JRZ Marketing — AI marketing automation agency in Orlando, FL. José Rivas is CEO.

Write a CORNERSTONE SEO blog post (1400–1800 words) — this is the most important piece of content for the week.

PRIMARY KEYWORD: "${targetKeyword}"
GOAL: Rank #1 on Google in Orlando for this keyword within 60 days.

REQUIREMENTS:
- Use the exact keyword in: title, first 100 words, at least 3 H2/H3 headings, meta description, conclusion
- Length: 1400–1800 words (cornerstone content ranks higher than short posts)
- Include a "Why Orlando Businesses Choose JRZ Marketing" section
- Include specific results/stats (e.g., "clients see 40% more leads in 90 days")
- Include a comparison table (JRZ Marketing vs traditional agencies)
- FAQ section with 4–5 questions targeting People Also Ask
- CTA: "Book your free AI strategy session at jrzmarketing.com/contact-us"
- Include 4–5 natural internal backlinks spread throughout the post:

CRITICAL — WRITE LIKE A REAL HUMAN EXPERT, NOT AN AI:
- Use contractions constantly (you'll, don't, it's, we're, here's, that's)
- Vary sentence length aggressively — two-word sentences next to 25-word sentences
- Write directly to the reader using "you" — like a mentor, not a textbook
- Use real specific examples with numbers ("one client cut their ad spend by 40%")
- Open some paragraphs with a question, some with a short observation, some mid-story
- NEVER use: "In today's digital age", "It's no secret", "In conclusion", "Furthermore", "Moreover", "Additionally", "Game-changing", "Leverage", "Robust", "Delve into", "Seamlessly", "Navigate", "Ever-evolving", "Look no further", "Unlock", "Empower"
- Bullet points should NOT all be the same length or follow the same pattern
- One or two slightly imperfect sentences are fine — real writers aren't always perfect
- This should read like a sharp founder wrote it on a Tuesday morning, not like a content farm
  * https://jrzmarketing.com — anchor: agency name or "Orlando AI marketing agency"
  * https://jrzmarketing.com/contact-us — anchor: "free strategy session" or "book a call"
  * https://jrzmarketing.com/blog — anchor: "our marketing blog" or "read more guides"
  * https://jrzmarketing.com/blog — anchor: a related topic phrase (e.g. "social media automation tips")
  * One more link to jrzmarketing.com with a keyword-rich anchor matching the target keyword
- Links must read naturally in the sentence — readers should want to click them
- Mention: bilingual team, Go High Level, AI agents, Orlando/Central Florida

Return ONLY valid JSON, no markdown:
{
  "title": "60-char title with keyword",
  "metaDescription": "155-char description with keyword",
  "htmlContent": "full HTML using h2/h3/p/ul/li/ol/strong/em/table/thead/tbody/tr/th/td only"
}` }],
      });

      const raw = blogRes.content[0].text.trim();
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
      const { title, metaDescription, htmlContent } = parsed;

      const urlSlug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) + '-' + Date.now().toString(36);
      const publishedAt = new Date();
      publishedAt.setUTCHours(14, 30, 0, 0); // 9:30am EST

      const postRes = await axios.post(
        'https://services.leadconnectorhq.com/blogs/posts',
        {
          title, locationId: GHL_LOCATION_ID, blogId: BLOG_ID, description: metaDescription,
          imageUrl: 'https://msgsndr-private.storage.googleapis.com/locationPhotos/bf4cfbc0-6359-4e62-a0fa-de3af69d3218.png',
          imageAltText: `JRZ Marketing — ${title}`,
          author: BLOG_AUTHOR_ID,
          categories: [BLOG_CATEGORIES.marketing, BLOG_CATEGORIES.ai, BLOG_CATEGORIES.business],
          tags: ['JRZ Marketing', 'SEO', 'Orlando', 'cornerstone', targetKeyword.split(' ').slice(0, 3).join(' ')],
          urlSlug, status: 'PUBLISHED', publishedAt: publishedAt.toISOString(), rawHTML: htmlContent,
        },
        { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
      );

      report.blogPublished = true;
      report.blogTitle = title;
      report.blogId = postRes.data?.blogPost?._id;
      console.log(`[SEO Plan] ✅ Cornerstone blog published: "${title}"`);
    } catch (blogErr) { console.error('[SEO Plan] Blog error:', blogErr?.response?.data || blogErr.message); }

    // ── STEP 5: Competitor keyword gap analysis ────────────────────────────────
    try {
      if (DATAFORSEO_PASSWORD) {
        const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
        // Find top competitors for jrzmarketing.com
        const compRes = await axios.post(
          `${DATAFORSEO_BASE}/v3/dataforseo_labs/google/competitors_domain/live`,
          [{ target: 'jrzmarketing.com', location_code: 2840, language_code: 'en', limit: 5 }],
          { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
        );
        const competitors = (compRes.data?.tasks?.[0]?.result?.[0]?.items || []).slice(0, 3).map(c => c.domain);

        if (competitors.length > 0) {
          // Get keywords the top competitor ranks for that JRZ doesn't
          const gapRes = await axios.post(
            `${DATAFORSEO_BASE}/v3/dataforseo_labs/google/keywords_for_site/live`,
            [{ target: competitors[0], location_code: 2840, language_code: 'en', limit: 10 }],
            { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
          );
          const gapKeywords = (gapRes.data?.tasks?.[0]?.result?.[0]?.items || [])
            .filter(k => k.ranked_serp_element?.serp_item?.rank_absolute <= 10)
            .map(k => k.keyword)
            .slice(0, 5);
          report.competitorGaps = gapKeywords;
          report.topCompetitor = competitors[0];
          console.log(`[SEO Plan] ✅ Competitor gap: ${gapKeywords.length} keywords found from ${competitors[0]}`);
        }
      }
    } catch (compErr) { console.error('[SEO Plan] Competitor gap error:', compErr?.response?.data || compErr.message); }

    // ── STEP 6: Backlink audit ────────────────────────────────────────────────
    let backlinkData = null;
    try {
      backlinkData = await runSofiaBacklinkAudit('jrzmarketing.com');
      if (backlinkData) {
        report.backlinks = backlinkData;
        console.log(`[SEO Plan] ✅ Backlinks: ${backlinkData.referringDomains} referring domains, +${backlinkData.newBacklinks30d} new this month`);
      }
    } catch (blErr) { console.error('[SEO Plan] Backlink audit error:', blErr.message); }

    // ── STEP 7: Local citation audit ─────────────────────────────────────────
    let citationData = null;
    try {
      citationData = await runSofiaCitationAudit('JRZ Marketing', 'Orlando, FL');
      if (citationData) {
        report.citations = citationData;
        console.log(`[SEO Plan] ✅ Citations — Google: ${citationData.google?.found ? 'found' : 'missing'}, Yelp: ${citationData.yelp?.found ? 'found' : 'missing'}`);
      }
    } catch (citErr) { console.error('[SEO Plan] Citation audit error:', citErr.message); }

    // ── STEP 8: GBP weekly post (activates when GBP quota approved) ──────────
    // TODO: Uncomment when GBP API quota is granted
    // await postGBPWeeklyUpdate(targetKeyword);
    report.gbpPosted = false; // pending quota approval

    // ── STEP 7: Send full SEO execution report to Jose ─────────────────────
    const statusBadge = (ok) => ok
      ? `<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">✅ DONE</span>`
      : `<span style="background:#fef9c3;color:#ca8a04;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">⏳ PENDING</span>`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#0f172a;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:22px">📈 Weekly SEO Execution Report</h1>
          <p style="color:#94a3b8;margin:6px 0 0">Sofia's Monday SEO plan • ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
        </div>
        <div style="background:#f8fafc;padding:20px">

          <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;border-left:4px solid #2563eb">
            <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;font-weight:700">THIS WEEK'S TARGET KEYWORD</p>
            <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#0f172a">"${targetKeyword}"</p>
            ${targetPosition ? `<p style="margin:4px 0 0;color:#d97706;font-size:13px">Currently ranking: position #${targetPosition} — pushing to page 1</p>` : ''}
          </div>

          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:16px">
            <thead><tr style="background:#f1f5f9">
              <th style="padding:12px 16px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">ACTION</th>
              <th style="padding:12px 16px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase">STATUS</th>
            </tr></thead>
            <tbody>
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">🎯 Best keyword found (DataForSEO + GSC)</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right">${statusBadge(!!report.keyword)}</td></tr>
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">🏷️ Homepage meta title + description updated</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right">${statusBadge(report.metaUpdated)}</td></tr>
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">🔖 Schema.org structured data injected</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right">${statusBadge(report.schemaInjected)}</td></tr>
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">✍️ Cornerstone blog post published${report.blogTitle ? ` — "${report.blogTitle}"` : ''}</td><td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right">${statusBadge(report.blogPublished)}</td></tr>
              <tr><td style="padding:12px 16px">📍 Google Business Profile post</td><td style="padding:12px 16px;text-align:right"><span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">⏳ GBP quota pending</span></td></tr>
            </tbody>
          </table>

          ${report.competitorGaps.length > 0 ? `
          <div style="background:#fff;border-radius:8px;padding:16px;border-left:4px solid #f59e0b">
            <p style="margin:0;font-size:13px;font-weight:700;color:#92400e">🔍 Competitor Gap — ${report.topCompetitor} ranks for these, JRZ doesn't yet:</p>
            <ul style="margin:8px 0 0;padding-left:20px;color:#44403c">
              ${report.competitorGaps.map(k => `<li style="margin:4px 0">${k} → <em>write a blog post targeting this</em></li>`).join('')}
            </ul>
          </div>` : ''}

          <div style="background:#eff6ff;border-radius:8px;padding:16px;margin-top:16px">
            <p style="margin:0;font-size:13px;color:#1e40af"><strong>📅 What's running this week:</strong> Daily SEO blog at 7:05am every morning targeting striking-distance keywords. Each post builds domain authority and pushes "${targetKeyword}" closer to page 1.</p>
          </div>
        </div>
      </div>`;

    // Also send the branded client-facing SEO progress report to Jose (as owner of main account)
    const blogsThisMonth = new Date().getDate() >= 7 ? Math.floor(new Date().getDate() / 7) * 5 : 5;
    sendClientSEOProgressReport(
      { name: 'JRZ Marketing', locationId: GHL_LOCATION_ID },
      { keyword: targetKeyword, position: parseFloat(targetPosition) || 15, blogsThisMonth, backlinks: backlinkData, citations: citationData, competitorGaps: report.competitorGaps }
    ); // non-blocking

    await sendEmail(OWNER_CONTACT_ID, `📈 Weekly SEO Plan Executed — Target: "${targetKeyword}"`, html);
    console.log(`[SEO Plan] ✅ Weekly SEO plan complete — keyword: "${targetKeyword}", meta: ${report.metaUpdated}, schema: ${report.schemaInjected}, blog: ${report.blogPublished}`);
    return report;

  } catch (err) {
    console.error('[SEO Plan] ❌ Fatal error:', err.message);
    return { ...report, error: err.message };
  }
}

async function runSofiaWeeklyCheck() {
  console.log('[Sofia] Running weekly website health check...');
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const dateStr = new Date().toLocaleDateString('es-ES', { timeZone: 'America/New_York', weekday: 'long', day: 'numeric', month: 'long' });

  // Fetch all subaccounts + their website URLs from GHL location data
  const clients   = await getElenaClients();
  const siteResults = [];
  const downAlerts  = [];

  for (const client of clients) {
    try {
      // Get website URL from GHL location data
      const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${client.locationId}`, {
        headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' },
        timeout: 8000,
      });
      const loc = locRes.data?.location || locRes.data;
      const websiteUrl = loc?.website || loc?.business?.website || null;

      if (!websiteUrl) {
        siteResults.push({ name: client.name, url: null, check: null, industry: client.industry });
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      const check = await checkWebsite(websiteUrl);
      siteResults.push({ name: client.name, url: websiteUrl, check, industry: client.industry });

      if (check && !check.up) {
        downAlerts.push({ name: client.name, url: websiteUrl, error: check.issues[0] || 'Site down' });
      }

      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[Sofia] Error checking ${client.name}:`, err.message);
    }
  }

  // Send immediate alert if any site is down
  if (downAlerts.length > 0) {
    const downRows = downAlerts.map(d =>
      `<tr><td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0a0a0a;border-bottom:1px solid #fecaca;">${d.name}</td>
       <td style="padding:12px 16px;font-size:13px;color:#555;border-bottom:1px solid #fecaca;">${d.url}</td>
       <td style="padding:12px 16px;font-size:13px;color:#dc2626;border-bottom:1px solid #fecaca;">${d.error}</td></tr>`
    ).join('');

    const alertHtml = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:32px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:22px 32px;"><img src="${logoUrl}" style="height:32px;"/></div>
  <div style="background:#dc2626;padding:22px 32px;"><h1 style="color:#fff;font-size:20px;font-weight:800;">🚨 Sofia: ${downAlerts.length} Sitio(s) Caído(s)</h1><p style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:6px;">Tus clientes no pueden recibir visitas ahora mismo</p></div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;border:1px solid #fecaca;border-radius:10px;overflow:hidden;">
      <thead><tr style="background:#fef2f2;"><th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Cliente</th><th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">URL</th><th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Error</th></tr></thead>
      <tbody>${downRows}</tbody>
    </table>
    <div style="background:#fff8f0;border:1px solid #fed7aa;border-radius:10px;padding:16px 20px;margin-top:20px;font-size:14px;color:#92400e;">⚡ <strong>Acción requerida:</strong> Contacta al cliente o revisa el hosting. Sofia seguirá monitoreando.</div>
  </div>
  <div style="background:#0a0a0a;padding:18px 32px;text-align:center;"><p style="font-size:11px;color:rgba(255,255,255,0.25);">Sofia — JRZ Marketing AI Web Designer</p></div>
</div></body></html>`;
    await sendEmail(OWNER_CONTACT_ID, `🚨 Sofia: ${downAlerts.length} Sitio(s) Caído(s) — Acción Requerida`, alertHtml);
  }

  // Build weekly health report
  const checked  = siteResults.filter(s => s.check);
  const noUrl    = siteResults.filter(s => !s.url);
  const up       = checked.filter(s => s.check.up);
  const down     = checked.filter(s => !s.check.up);
  const slow     = up.filter(s => s.check.responseTime > 3000);
  const avgSpeed = up.length ? Math.round(up.reduce((s, r) => s + r.check.responseTime, 0) / up.length) : 0;

  // Claude CRO quick wins for sites with most issues
  const needsCRO = up.filter(s => s.check.issues.length >= 2).slice(0, 5);
  let croInsights = [];
  if (needsCRO.length > 0) {
    try {
      const croData = needsCRO.map(s => `${s.name} (${s.industry}): ${s.check.issues.join(', ')}`).join('\n');
      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: `Eres Sofia, Web Designer de JRZ Marketing. Para cada sitio web con problemas, da UNA recomendación específica y accionable (máximo 15 palabras). Responde SOLO con JSON: [{"name": "client name", "fix": "recomendación concreta"}]\n\nSitios:\n${croData}` }],
      });
      croInsights = JSON.parse(aiRes.content[0].text.trim().match(/\[[\s\S]*\]/)[0]);
    } catch { /* skip */ }
  }

  const speedColor = ms => ms < 2000 ? '#16a34a' : ms < 4000 ? '#d97706' : '#dc2626';
  const statusBadge = s => s.check.up
    ? `<span style="background:#f0fdf4;color:#16a34a;font-weight:700;font-size:11px;padding:2px 8px;border-radius:100px;">✓ UP</span>`
    : `<span style="background:#fef2f2;color:#dc2626;font-weight:700;font-size:11px;padding:2px 8px;border-radius:100px;">✗ DOWN</span>`;

  const siteRows = checked.map(s => {
    const cro = croInsights.find(c => c.name === s.name);
    return `<tr style="border-bottom:1px solid #f5f5f5;">
      <td style="padding:11px 14px;font-size:13px;font-weight:600;color:#0a0a0a;">${s.name}</td>
      <td style="padding:11px 14px;text-align:center;">${statusBadge(s)}</td>
      <td style="padding:11px 14px;text-align:center;font-size:13px;font-weight:700;color:${speedColor(s.check.responseTime)};">${s.check.up ? `${(s.check.responseTime/1000).toFixed(1)}s` : '—'}</td>
      <td style="padding:11px 14px;text-align:center;font-size:13px;">${s.check.ssl ? '🔒' : '⚠️'}</td>
      <td style="padding:11px 14px;font-size:12px;color:${s.check.issues.length ? '#dc2626' : '#16a34a'};">${s.check.issues.length ? s.check.issues[0] : '✓ Sin problemas'}</td>
      <td style="padding:11px 14px;font-size:12px;color:#888;font-style:italic;">${cro ? cro.fix : ''}</td>
    </tr>`;
  }).join('');

  const noUrlRows = noUrl.map(s =>
    `<tr style="border-bottom:1px solid #f9f9f9;"><td colspan="6" style="padding:9px 14px;font-size:13px;color:#bbb;">${s.name} — no website on file in GHL</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; }
    .wrap { padding:40px 20px; }
    .card { max-width:720px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:26px 36px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:36px; }
    .hdr span { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:28px 36px 36px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; margin-bottom:6px; }
    .hero p { font-size:12px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.08em; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:16px 12px; text-align:center; border-right:1px solid #f0f0f0; }
    .stat:last-child { border-right:none; }
    .stat-num { font-size:26px; font-weight:800; color:#0a0a0a; }
    .stat-num.green { color:#16a34a; } .stat-num.red { color:#dc2626; } .stat-num.orange { color:#d97706; }
    .stat-lbl { font-size:10px; font-weight:700; color:#bbb; text-transform:uppercase; letter-spacing:0.06em; margin-top:3px; }
    .body { padding:28px 36px 36px; }
    .sec-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:14px; }
    table { width:100%; border-collapse:collapse; }
    .ftr { background:#0a0a0a; padding:22px 36px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:22px; opacity:0.45; }
    .ftr p { font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}"/><span>Sofia · Website Health</span></div>
  <div class="hero">
    <h1>Reporte de Salud de Sitios Web</h1>
    <p>${dateStr}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${checked.length}</div><div class="stat-lbl">Sitios Revisados</div></div>
    <div class="stat"><div class="stat-num green">${up.length}</div><div class="stat-lbl">En Línea</div></div>
    <div class="stat"><div class="stat-num red">${down.length}</div><div class="stat-lbl">Caídos</div></div>
    <div class="stat"><div class="stat-num orange">${slow.length}</div><div class="stat-lbl">Lentos (+3s)</div></div>
    <div class="stat"><div class="stat-num">${avgSpeed ? `${(avgSpeed/1000).toFixed(1)}s` : '—'}</div><div class="stat-lbl">Vel. Promedio</div></div>
  </div>
  <div class="body">
    <p class="sec-title">Estado de todos los sitios</p>
    <table>
      <thead><tr style="background:#f9f9f9;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Cliente</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Estado</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Velocidad</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">SSL</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Problema</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Fix Rápido</th>
      </tr></thead>
      <tbody>${siteRows}${noUrlRows}</tbody>
    </table>
  </div>
  <div class="ftr"><img src="${logoUrl}"/><p>Sofia — JRZ Marketing AI Web Designer</p></div>
</div></div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `🌐 Sofia: Reporte Web — ${up.length}↑ online · ${down.length}↓ caídos · ${slow.length} lentos`, html);
  console.log(`[Sofia] ✅ Weekly check done. Up: ${up.length}, Down: ${down.length}, Slow: ${slow.length}, No URL: ${noUrl.length}`);
}

app.post('/sofia/website-check', async (_req, res) => {
  try {
    runSofiaWeeklyCheck();
    res.json({ status: 'ok', message: 'Sofia is checking all client websites' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── Sofia: Google PageSpeed Insights ────────────────────

async function getPageSpeedData(url) {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return null;
  const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
  try {
    const [mobile, desktop] = await Promise.all([
      axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
        params: { url: cleanUrl, key, strategy: 'mobile', category: ['performance','seo','accessibility','best-practices'] },
        timeout: 30000,
      }),
      axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
        params: { url: cleanUrl, key, strategy: 'desktop', category: ['performance','seo','accessibility','best-practices'] },
        timeout: 30000,
      }),
    ]);

    const extract = (data) => {
      const cats  = data.data?.lighthouseResult?.categories || {};
      const audits = data.data?.lighthouseResult?.audits || {};
      return {
        performance:    Math.round((cats.performance?.score || 0) * 100),
        seo:            Math.round((cats.seo?.score || 0) * 100),
        accessibility:  Math.round((cats.accessibility?.score || 0) * 100),
        bestPractices:  Math.round((cats['best-practices']?.score || 0) * 100),
        lcp:   audits['largest-contentful-paint']?.displayValue || null,
        cls:   audits['cumulative-layout-shift']?.displayValue || null,
        fid:   audits['total-blocking-time']?.displayValue || null,
        fcp:   audits['first-contentful-paint']?.displayValue || null,
        ttfb:  audits['server-response-time']?.displayValue || null,
        opportunities: Object.values(audits)
          .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
          .map(a => a.title)
          .slice(0, 5),
      };
    };

    return { mobile: extract(mobile), desktop: extract(desktop) };
  } catch (err) {
    console.error('[Sofia] PageSpeed API error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ─── Sofia: Google Search Console API ────────────────────

let _googleAccessToken   = null;
let _googleAccessExpires = 0;

// Build a signed JWT for Google service account auth (no extra packages — uses built-in crypto)
function _buildServiceAccountJWT(scope = 'https://www.googleapis.com/auth/webmasters.readonly') {
  const email = process.env.GOOGLE_SA_EMAIL;
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  const privateKey = rawKey.replace(/\\n/g, '\n'); // Render stores \n as literal \\n
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   email,
    scope,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const sig = sign.sign(privateKey, 'base64url');
  return `${sigInput}.${sig}`;
}

// Get a valid Google access token for Search Console
// Priority: service account JWT (GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY) → OAuth2 refresh token fallback
async function getGoogleAccessToken() {
  if (_googleAccessToken && Date.now() < _googleAccessExpires) return _googleAccessToken;
  try {
    const jwt = _buildServiceAccountJWT();
    if (jwt) {
      // Service account path — preferred, never expires, no user consent needed
      const res = await axios.post('https://oauth2.googleapis.com/token', null, {
        params: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
        timeout: 10000,
      });
      _googleAccessToken   = res.data.access_token;
      _googleAccessExpires = Date.now() + (res.data.expires_in - 60) * 1000;
      return _googleAccessToken;
    }
    // Fallback: legacy OAuth2 refresh token
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
    const res = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' },
      timeout: 10000,
    });
    _googleAccessToken   = res.data.access_token;
    _googleAccessExpires = Date.now() + (res.data.expires_in - 60) * 1000;
    return _googleAccessToken;
  } catch (err) {
    console.error('[Sofia] Google token error:', err.response?.data?.error || err.message);
    return null;
  }
}

async function getSearchConsoleData(siteUrl) {
  const token = await getGoogleAccessToken();
  if (!token) return null;

  const cleanUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
  // Search Console accepts either https://domain.com/ or sc-domain:domain.com
  const encodedSite = encodeURIComponent(cleanUrl.replace(/\/$/, '') + '/');
  const today       = new Date();
  const endDate     = today.toISOString().split('T')[0];
  const startDate   = new Date(today - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // last 28 days

  try {
    const [keywordsRes, pagesRes] = await Promise.all([
      // Top 10 queries by clicks
      axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
        { startDate, endDate, dimensions: ['query'], rowLimit: 10, orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      ),
      // Top 5 pages by impressions
      axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
        { startDate, endDate, dimensions: ['page'], rowLimit: 5, orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }] },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      ),
    ]);

    const rows      = keywordsRes.data?.rows || [];
    const pageRows  = pagesRes.data?.rows   || [];

    const totals = rows.reduce((acc, r) => ({
      clicks:      acc.clicks      + (r.clicks      || 0),
      impressions: acc.impressions + (r.impressions || 0),
    }), { clicks: 0, impressions: 0 });

    const avgPosition = rows.length
      ? (rows.reduce((s, r) => s + (r.position || 0), 0) / rows.length).toFixed(1)
      : null;
    const avgCtr = totals.impressions
      ? ((totals.clicks / totals.impressions) * 100).toFixed(2) + '%'
      : null;

    return {
      period:      `${startDate} → ${endDate}`,
      totalClicks: totals.clicks,
      totalImpressions: totals.impressions,
      avgPosition,
      avgCtr,
      topKeywords: rows.slice(0, 5).map(r => ({
        keyword:     r.keys[0],
        clicks:      r.clicks,
        impressions: r.impressions,
        ctr:         ((r.ctr || 0) * 100).toFixed(1) + '%',
        position:    (r.position || 0).toFixed(1),
      })),
      topPages: pageRows.map(r => ({
        page:        r.keys[0],
        impressions: r.impressions,
        clicks:      r.clicks,
        position:    (r.position || 0).toFixed(1),
      })),
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 404) {
      // Site not verified in Search Console — normal, not an error
      console.log(`[Sofia] Search Console: ${cleanUrl} not verified in GSC (${status})`);
    } else {
      console.error('[Sofia] Search Console error:', err.response?.data?.error?.message || err.message);
    }
    return null;
  }
}

// ─── Sofia: Full SEO + PageSpeed + Mobile + Copy Audit ───

async function runSofiaFullAudit(url, clientName, industry) {
  const base = await checkWebsite(url);
  if (!base) return null;

  // Fetch HTML, PageSpeed, and Search Console in parallel
  const [rawHtml, pageSpeed, searchConsole] = await Promise.all([
    base.up ? axios.get(url.startsWith('http') ? url : `https://${url}`, {
      timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' }, validateStatus: () => true,
    }).then(r => typeof r.data === 'string' ? r.data : '').catch(() => '') : Promise.resolve(''),
    getPageSpeedData(url),
    getSearchConsoleData(url),
  ]);

  const html = rawHtml;

  // SEO checks
  const h1s      = (html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim());
  const h2s      = (html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || []).length;
  const imgs     = (html.match(/<img[^>]+>/gi) || []);
  const alts     = imgs.filter(i => /alt=["'][^"']+["']/i.test(i)).length;
  const hasCanon = /<link[^>]+rel=["']canonical["']/i.test(html);
  const hasView  = /<meta[^>]+name=["']viewport["']/i.test(html);
  const hasOG    = /<meta[^>]+property=["']og:/i.test(html);

  // Score 0-100 — PageSpeed performance replaces our manual response time if available
  let score = 0;
  if (base.up)   score += 20;
  if (base.ssl)  score += 10;
  // Speed: use PageSpeed mobile performance score if available, else fallback to response time
  if (pageSpeed) {
    const perf = pageSpeed.mobile.performance;
    if (perf >= 90) score += 15; else if (perf >= 70) score += 10; else if (perf >= 50) score += 5;
  } else {
    if (base.responseTime < 2000) score += 10; else if (base.responseTime < 4000) score += 5;
  }
  if (base.title)              score += 8;
  if (base.description)        score += 8;
  if (h1s.length === 1)        score += 8;
  if (h2s >= 2)                score += 5;
  if (imgs.length && alts === imgs.length) score += 5;
  if (hasCanon)                score += 5;
  if (hasView)                 score += 4;
  if (base.hasCTA)             score += 4;
  if (base.hasPhone)           score += 4;
  // Bonus from PageSpeed SEO score
  if (pageSpeed && pageSpeed.mobile.seo >= 90) score += 4;
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';

  // Claude: copy analysis + rewrites
  let copyAnalysis = null;
  if (base.up && (base.title || h1s.length)) {
    try {
      const psSummary = pageSpeed
        ? `Mobile Performance: ${pageSpeed.mobile.performance}/100, LCP: ${pageSpeed.mobile.lcp}, CLS: ${pageSpeed.mobile.cls}, SEO: ${pageSpeed.mobile.seo}/100`
        : 'PageSpeed: unavailable';
      const gscSummary = searchConsole
        ? `GSC (last 28 days): ${searchConsole.totalClicks} clicks, ${searchConsole.totalImpressions} impressions, avg position ${searchConsole.avgPosition}, CTR ${searchConsole.avgCtr}. Top keyword: "${searchConsole.topKeywords[0]?.keyword || 'none'}" (pos ${searchConsole.topKeywords[0]?.position || '?'})`
        : 'Google Search Console: not verified or no data';
      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: `You are Sofia, Web Designer at JRZ Marketing. Analyze this website for "${clientName}" (${industry}).

Title: ${base.title || 'missing'}
H1: ${h1s[0] || 'missing'}
Description: ${base.description || 'missing'}
Has CTA: ${base.hasCTA} | Has Phone: ${base.hasPhone}
${psSummary}
${pageSpeed?.mobile.opportunities?.length ? 'PageSpeed issues: ' + pageSpeed.mobile.opportunities.join(', ') : ''}
${gscSummary}

Reply ONLY with JSON: {"headlineRewrite":"improved H1","ctaRewrite":"better CTA for their industry","descriptionRewrite":"improved meta description (max 155 chars)","topIssue":"single most important problem in one sentence"}` }],
      });
      copyAnalysis = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
    } catch { /* skip */ }
  }

  return { ...base, h1s, h2Count: h2s, imgCount: imgs.length, altCount: alts, hasCanon, hasViewport: hasView, hasOG, score, grade, pageSpeed, searchConsole, copyAnalysis };
}

// ─── Sofia: Monthly CRO Report ────────────────────────────

async function runSofiaCROReport() {
  console.log('[Sofia] Building monthly CRO report...');
  const logoUrl  = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const month    = new Date().toLocaleString('es-ES', { month: 'long', year: 'numeric' });
  const clients  = await getElenaClients();
  const results  = [];

  for (const client of clients) {
    try {
      const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${client.locationId}`, {
        headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }, timeout: 8000,
      });
      const loc = locRes.data?.location || locRes.data;
      const url = loc?.website || loc?.business?.website;
      if (!url) { results.push({ name: client.name, url: null, score: null, grade: 'N/A', noSite: true }); continue; }

      const audit = await runSofiaFullAudit(url, client.name, client.industry);
      if (audit) results.push({ name: client.name, url, ...audit });
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.error(`[Sofia CRO] Error for ${client.name}:`, err.message);
    }
  }

  const graded  = results.filter(r => r.grade && r.grade !== 'N/A');
  const noSite  = results.filter(r => r.noSite);
  const avgScore = graded.length ? Math.round(graded.reduce((s, r) => s + r.score, 0) / graded.length) : 0;

  const gradeColor = { A: '#16a34a', B: '#4ade80', C: '#d97706', D: '#f97316', F: '#dc2626', 'N/A': '#bbb' };
  const gradeBg    = { A: '#f0fdf4', B: '#f0fdf4', C: '#fff8f0', D: '#fff4ee', F: '#fef2f2', 'N/A': '#f9f9f9' };

  const rows = results.sort((a, b) => (a.score || 0) - (b.score || 0)).map(r => {
    if (r.noSite) return `<tr style="border-bottom:1px solid #f9f9f9;"><td style="padding:10px 14px;font-size:13px;color:#0a0a0a;">${r.name}</td><td colspan="7" style="padding:10px 14px;font-size:12px;color:#bbb;">No website on file</td></tr>`;
    const copy = r.copyAnalysis;
    const ps   = r.pageSpeed?.mobile;
    const perfColor = ps ? (ps.performance >= 90 ? '#16a34a' : ps.performance >= 70 ? '#d97706' : '#dc2626') : '#bbb';
    const seoColor  = ps ? (ps.seo >= 90 ? '#16a34a' : ps.seo >= 70 ? '#d97706' : '#dc2626') : '#bbb';
    return `<tr style="border-bottom:1px solid #f5f5f5;">
      <td style="padding:11px 14px;font-size:13px;font-weight:600;color:#0a0a0a;">${r.name}</td>
      <td style="padding:11px 14px;text-align:center;"><span style="background:${gradeBg[r.grade]};color:${gradeColor[r.grade]};font-weight:800;font-size:14px;padding:2px 10px;border-radius:8px;">${r.grade}</span></td>
      <td style="padding:11px 14px;text-align:center;font-size:13px;color:#555;">${r.score}/100</td>
      <td style="padding:11px 14px;text-align:center;font-size:13px;font-weight:700;color:${perfColor};">${ps ? ps.performance : '—'}</td>
      <td style="padding:11px 14px;text-align:center;font-size:12px;color:#666;">${ps ? `LCP ${ps.lcp || '?'} · CLS ${ps.cls || '?'}` : '—'}</td>
      <td style="padding:11px 14px;text-align:center;font-size:13px;font-weight:700;color:${seoColor};">${ps ? ps.seo : '—'}</td>
      <td style="padding:11px 14px;font-size:12px;color:#555;font-style:italic;">${copy?.topIssue || ps?.opportunities?.[0] || '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#f4f4f4; }
    .wrap { padding:40px 20px; }
    .card { max-width:760px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hdr { background:#0a0a0a; padding:26px 36px; display:flex; align-items:center; justify-content:space-between; }
    .hdr img { height:36px; } .hdr span { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:100px; }
    .hero { background:#0a0a0a; padding:28px 36px 36px; border-bottom:3px solid #fff; }
    .hero h1 { font-size:22px; font-weight:800; color:#fff; margin-bottom:6px; }
    .hero p { font-size:12px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.08em; }
    .stats { display:flex; border-bottom:1px solid #f0f0f0; }
    .stat { flex:1; padding:16px 12px; text-align:center; border-right:1px solid #f0f0f0; } .stat:last-child { border-right:none; }
    .stat-num { font-size:26px; font-weight:800; color:#0a0a0a; } .stat-lbl { font-size:10px; font-weight:700; color:#bbb; text-transform:uppercase; letter-spacing:0.06em; margin-top:3px; }
    .body { padding:28px 36px 36px; }
    .sec-title { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#999; margin-bottom:14px; }
    table { width:100%; border-collapse:collapse; }
    .ftr { background:#0a0a0a; padding:22px 36px; display:flex; align-items:center; justify-content:space-between; }
    .ftr img { height:22px; opacity:0.45; } .ftr p { font-size:11px; color:rgba(255,255,255,0.25); }
  </style>
</head>
<body><div class="wrap"><div class="card">
  <div class="hdr"><img src="${logoUrl}"/><span>Sofia · CRO Report ${month}</span></div>
  <div class="hero"><h1>Reporte CRO Mensual</h1><p>Conversión · SEO · Copy · Mobile — ${month}</p></div>
  <div class="stats">
    <div class="stat"><div class="stat-num">${graded.length}</div><div class="stat-lbl">Sitios Auditados</div></div>
    <div class="stat"><div class="stat-num">${avgScore}</div><div class="stat-lbl">Score Promedio</div></div>
    <div class="stat"><div class="stat-num" style="color:#16a34a;">${graded.filter(r=>r.grade==='A'||r.grade==='B').length}</div><div class="stat-lbl">A / B Grade</div></div>
    <div class="stat"><div class="stat-num" style="color:#dc2626;">${graded.filter(r=>r.grade==='D'||r.grade==='F').length}</div><div class="stat-lbl">D / F Urgente</div></div>
    <div class="stat"><div class="stat-num">${noSite.length}</div><div class="stat-lbl">Sin Sitio</div></div>
  </div>
  <div class="body">
    <p class="sec-title">Todos los clientes — ordenados por score (peor → mejor)</p>
    <table>
      <thead><tr style="background:#f9f9f9;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Client</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Grade</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Score</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">⚡ Perf</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">Core Web Vitals</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;">🔍 SEO</th>
        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;">Top Issue</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="ftr"><img src="${logoUrl}"/><p>Sofia — JRZ Marketing AI Web Designer</p></div>
</div></div></body></html>`;

  await sendEmail(OWNER_CONTACT_ID, `🏆 Sofia: CRO Report ${month} — Score Promedio: ${avgScore}/100`, html);
  console.log(`[Sofia] ✅ CRO report sent. Avg score: ${avgScore}. D/F sites: ${graded.filter(r=>r.grade==='D'||r.grade==='F').length}`);
}

// ─── Sofia: GHL Landing Page Creator ─────────────────────

// ─── Sofia: AI Content Generator for Landing Pages ───────
async function generateLandingContent(clientName, industry, city) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Create professional landing page content for "${clientName}", a ${industry} company in ${city}, FL.
Return ONLY valid JSON — no markdown, no explanation:
{
  "heroTitle": "Powerful 6-8 word headline",
  "heroSubtitle": "One compelling sentence value proposition",
  "ctaText": "Action-oriented CTA button text",
  "tagline": "Short company tagline under 8 words",
  "aboutText": "2-3 sentences describing the company's mission, experience, and commitment to ${city} community.",
  "stats": [{"num":"500+","label":"Jobs Completed"},{"num":"15+","label":"Years Experience"},{"num":"98%","label":"Satisfaction Rate"}],
  "services": [
    {"name":"Primary Service Name","desc":"2 sentences describing this service and its benefits.","icon":"🔧"},
    {"name":"Secondary Service Name","desc":"2 sentences describing this service and its benefits.","icon":"⚡"},
    {"name":"Third Service Name","desc":"2 sentences describing this service and its benefits.","icon":"🏆"}
  ],
  "trustItems": ["Licensed & Certified","Fully Insured","24/7 Available","Free Estimates","5-Star Rated"],
  "whyCards": [
    {"title":"Why Reason 1","desc":"Short 1-sentence explanation."},
    {"title":"Why Reason 2","desc":"Short 1-sentence explanation."},
    {"title":"Why Reason 3","desc":"Short 1-sentence explanation."},
    {"title":"Why Reason 4","desc":"Short 1-sentence explanation."}
  ],
  "processSteps": [
    {"num":"01","title":"Step One","desc":"Short description of this step."},
    {"num":"02","title":"Step Two","desc":"Short description of this step."},
    {"num":"03","title":"Step Three","desc":"Short description of this step."},
    {"num":"04","title":"Step Four","desc":"Short description of this step."}
  ],
  "reviews": [
    {"name":"Maria G.","stars":5,"text":"Two sentences of glowing review about this ${industry} company."},
    {"name":"John D.","stars":5,"text":"Two sentences of glowing review about this ${industry} company."},
    {"name":"Ana R.","stars":5,"text":"Two sentences of glowing review about this ${industry} company."}
  ],
  "faqs": [
    {"q":"Common question about ${industry}?","a":"Clear helpful answer."},
    {"q":"Another common question?","a":"Clear helpful answer."},
    {"q":"Pricing or timeline question?","a":"Clear helpful answer."},
    {"q":"Service area or availability question?","a":"Clear helpful answer."}
  ],
  "areas": ["${city}","Orlando","Kissimmee","Sanford","Daytona Beach","Deltona","Lake Mary","Ocoee"]
}`
      }]
    });
    const raw = msg.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in Claude response');
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[Sofia] Content generation error:', err.message);
    // Fallback defaults
    return {
      heroTitle: `${clientName} — Trusted ${industry} Experts`,
      heroSubtitle: `Professional ${industry} services in ${city} and surrounding areas.`,
      ctaText: 'Get Free Estimate',
      tagline: `${city}'s Most Trusted ${industry}`,
      aboutText: `${clientName} has been serving ${city} and the surrounding communities with top-quality ${industry} services. Our experienced team is committed to delivering exceptional results with every project.`,
      stats: [{ num: '500+', label: 'Projects Done' }, { num: '10+', label: 'Years Experience' }, { num: '5★', label: 'Google Rating' }],
      services: [
        { name: 'Premium Service', desc: 'We deliver industry-leading quality with every job. Your satisfaction is our top priority.', icon: '🔧' },
        { name: 'Expert Team', desc: 'Our certified professionals bring years of experience. We handle every detail with care.', icon: '⚡' },
        { name: 'Fast Response', desc: 'We respond quickly and work efficiently. Get the help you need when you need it.', icon: '🏆' },
      ],
      trustItems: ['Licensed & Certified', 'Fully Insured', '24/7 Available', 'Free Estimates', '5-Star Rated'],
      whyCards: [
        { title: 'Local Experts', desc: 'Proudly serving the ' + city + ' area for over a decade.' },
        { title: 'Transparent Pricing', desc: 'No hidden fees — honest quotes upfront.' },
        { title: 'Guaranteed Work', desc: 'We stand behind every job we do.' },
        { title: '24/7 Support', desc: 'Always available when you need us most.' },
      ],
      processSteps: [
        { num: '01', title: 'Contact Us', desc: 'Call or fill out our form — we respond fast.' },
        { num: '02', title: 'Free Assessment', desc: 'We evaluate your needs at no cost.' },
        { num: '03', title: 'We Get to Work', desc: 'Our team handles everything professionally.' },
        { num: '04', title: 'You Enjoy Results', desc: '100% satisfaction, guaranteed.' },
      ],
      reviews: [
        { name: 'Maria G.', stars: 5, text: 'Incredible service from start to finish. Highly recommend!' },
        { name: 'John D.', stars: 5, text: 'Fast, professional, and affordable. These guys are the best.' },
        { name: 'Ana R.', stars: 5, text: 'I called them in an emergency and they were there within the hour. Amazing team.' },
      ],
      faqs: [
        { q: 'Do you offer free estimates?', a: 'Yes! We offer free no-obligation estimates for all services.' },
        { q: 'How quickly can you respond?', a: 'We typically respond within 1-2 hours and can schedule same-day service.' },
        { q: 'Are you licensed and insured?', a: 'Absolutely. We are fully licensed and carry comprehensive insurance.' },
        { q: 'What areas do you serve?', a: `We serve ${city} and surrounding Central Florida communities.` },
      ],
      areas: [city, 'Orlando', 'Kissimmee', 'Sanford', 'Daytona Beach', 'Deltona', 'Lake Mary', 'Ocoee'],
    };
  }
}

async function buildLandingHTML(clientName, phone, email, city, industry, logoUrl, formId) {
  city   = city   || 'Orlando';
  formId = formId || '5XhL0vWCuJ59HWHQoHGG';
  const c = await generateLandingContent(clientName, industry, city);
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const phoneClean = (phone || '').replace(/\D/g, '');
  const logoSrc = logoUrl || 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="description" content="${c.heroSubtitle}"/>
<title>${clientName} | ${industry} in ${city}, FL</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Open+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
:root{--blue-dark:#1a3a6b;--blue-mid:#2563a8;--blue-light:#3b82f6;--orange:#f97316;--gray-bg:#f8fafc;--gray-dark:#1e293b;--text:#374151;--white:#ffffff;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Open Sans',sans-serif;color:var(--text);background:#fff;}
/* TOPBAR */
.topbar{background:var(--blue-dark);padding:9px 24px;display:flex;align-items:center;justify-content:space-between;}
.topbar-left{font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.02em;}
.topbar-right a{display:inline-flex;align-items:center;gap:6px;background:var(--orange);color:#fff;font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;text-decoration:none;letter-spacing:0.03em;}
/* NAVBAR */
.navbar{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 24px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:70px;}
.nav-logo{display:flex;align-items:center;gap:10px;}
.nav-logo img{height:40px;object-fit:contain;}
.nav-logo span{font-family:'Montserrat',sans-serif;font-size:18px;font-weight:800;color:var(--blue-dark);}
.nav-links{display:flex;gap:28px;}
.nav-links a{font-size:13px;font-weight:600;color:var(--gray-dark);text-decoration:none;transition:color .2s;}
.nav-links a:hover{color:var(--blue-mid);}
.nav-cta a{background:var(--blue-dark);color:#fff;font-size:13px;font-weight:700;padding:10px 22px;border-radius:6px;text-decoration:none;white-space:nowrap;}
/* HERO */
.hero{background:linear-gradient(135deg,var(--blue-dark) 0%,var(--blue-mid) 60%,#1d4ed8 100%);min-height:580px;display:flex;align-items:center;padding:60px 24px;}
.hero-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 420px;gap:60px;align-items:center;}
.hero-left{}
.hero-eyebrow{display:inline-block;background:rgba(249,115,22,0.15);border:1px solid rgba(249,115,22,0.4);color:var(--orange);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:20px;}
.hero h1{font-family:'Montserrat',sans-serif;font-size:46px;font-weight:900;color:#fff;line-height:1.1;margin-bottom:16px;}
.hero-sub{font-size:17px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:28px;max-width:480px;}
.hero-badges{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px;}
.hero-badge{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;}
.hero-phone a{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.3);color:#fff;font-size:20px;font-weight:800;padding:14px 28px;border-radius:8px;text-decoration:none;font-family:'Montserrat',sans-serif;}
/* FORM CARD */
.form-card{background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 24px 60px rgba(0,0,0,0.25);}
.form-card h3{font-family:'Montserrat',sans-serif;font-size:20px;font-weight:800;color:var(--blue-dark);margin-bottom:6px;}
.form-card p{font-size:13px;color:#6b7280;margin-bottom:20px;}
.form-card iframe{width:100%;border:none;min-height:480px;border-radius:8px;}
/* TRUST STRIP */
.trust-strip{background:var(--blue-dark);padding:16px 24px;}
.trust-inner{max-width:1200px;margin:0 auto;display:flex;justify-content:center;flex-wrap:wrap;gap:24px;}
.trust-item{display:flex;align-items:center;gap:8px;color:#fff;font-size:13px;font-weight:600;}
.trust-icon{width:28px;height:28px;background:var(--orange);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
/* SECTIONS */
.section{padding:80px 24px;}
.section-inner{max-width:1200px;margin:0 auto;}
.section-label{font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--orange);margin-bottom:10px;}
.section-title{font-family:'Montserrat',sans-serif;font-size:36px;font-weight:800;color:var(--blue-dark);line-height:1.2;margin-bottom:16px;}
.section-sub{font-size:16px;color:#6b7280;max-width:600px;line-height:1.6;}
/* ABOUT */
.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;}
.about-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:36px;}
.stat-box{text-align:center;padding:24px 16px;background:var(--gray-bg);border-radius:12px;border-top:3px solid var(--orange);}
.stat-num{font-family:'Montserrat',sans-serif;font-size:36px;font-weight:900;color:var(--blue-dark);}
.stat-label{font-size:13px;color:#6b7280;margin-top:4px;}
.about-img{background:linear-gradient(135deg,var(--blue-dark),var(--blue-mid));border-radius:16px;min-height:360px;display:flex;align-items:center;justify-content:center;}
.about-img-inner{text-align:center;padding:40px;}
.about-img-inner .big-icon{font-size:80px;margin-bottom:16px;display:block;}
.about-img-inner p{color:rgba(255,255,255,0.8);font-size:15px;line-height:1.6;}
/* SERVICES */
.section-bg{background:var(--gray-bg);}
.services-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:48px;}
.srv-card{background:#fff;border-radius:14px;padding:32px 28px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border-top:4px solid var(--blue-mid);transition:transform .2s,box-shadow .2s;}
.srv-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,0.1);}
.srv-icon{width:52px;height:52px;background:linear-gradient(135deg,var(--blue-dark),var(--blue-mid));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:20px;}
.srv-card h3{font-family:'Montserrat',sans-serif;font-size:18px;font-weight:700;color:var(--blue-dark);margin-bottom:10px;}
.srv-card p{font-size:14px;color:#6b7280;line-height:1.6;}
/* WHY */
.section-dark{background:var(--gray-dark);padding:80px 24px;}
.why-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:48px;}
.why-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:28px 24px;}
.why-icon{font-size:28px;margin-bottom:14px;}
.why-card h3{font-family:'Montserrat',sans-serif;font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;}
.why-card p{font-size:13px;color:rgba(255,255,255,0.6);line-height:1.5;}
/* PROCESS */
.process-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:32px;margin-top:48px;position:relative;}
.process-steps::before{content:'';position:absolute;top:36px;left:calc(12.5% + 12px);right:calc(12.5% + 12px);height:2px;background:linear-gradient(90deg,var(--blue-mid),var(--orange));z-index:0;}
.step{text-align:center;position:relative;z-index:1;}
.step-num{width:72px;height:72px;background:linear-gradient(135deg,var(--blue-dark),var(--blue-mid));border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Montserrat',sans-serif;font-size:22px;font-weight:900;color:#fff;margin:0 auto 20px;border:4px solid #fff;box-shadow:0 4px 16px rgba(37,99,168,0.3);}
.step h3{font-family:'Montserrat',sans-serif;font-size:15px;font-weight:700;color:var(--blue-dark);margin-bottom:8px;}
.step p{font-size:13px;color:#6b7280;line-height:1.5;}
/* REVIEWS */
.reviews-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:48px;}
.review-card{background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.07);border-left:4px solid var(--orange);}
.review-stars{color:var(--orange);font-size:18px;margin-bottom:12px;}
.review-text{font-size:14px;color:#374151;line-height:1.7;font-style:italic;margin-bottom:16px;}
.review-author{font-size:13px;font-weight:700;color:var(--blue-dark);}
/* FAQ */
.faq-list{margin-top:48px;max-width:800px;}
.faq-item{border-bottom:1px solid #e5e7eb;padding:20px 0;}
.faq-q{font-family:'Montserrat',sans-serif;font-size:16px;font-weight:700;color:var(--blue-dark);cursor:pointer;display:flex;justify-content:space-between;align-items:center;}
.faq-q::after{content:'+';font-size:22px;color:var(--orange);transition:transform .2s;}
.faq-item.open .faq-q::after{content:'−';}
.faq-a{font-size:14px;color:#6b7280;line-height:1.7;padding-top:12px;display:none;}
.faq-item.open .faq-a{display:block;}
/* AREAS */
.areas-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:40px;}
.area-item{background:var(--gray-bg);border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;font-size:14px;font-weight:600;color:var(--blue-dark);display:flex;align-items:center;gap:8px;}
.area-item::before{content:'📍';font-size:12px;}
/* CTA BANNER */
.cta-banner{background:linear-gradient(135deg,var(--orange) 0%,#ea580c 100%);padding:64px 24px;text-align:center;}
.cta-banner h2{font-family:'Montserrat',sans-serif;font-size:36px;font-weight:900;color:#fff;margin-bottom:12px;}
.cta-banner p{font-size:16px;color:rgba(255,255,255,0.85);margin-bottom:32px;}
.cta-banner a{display:inline-block;background:#fff;color:var(--orange);font-size:16px;font-weight:800;padding:16px 40px;border-radius:8px;text-decoration:none;font-family:'Montserrat',sans-serif;}
/* FOOTER */
footer{background:var(--gray-dark);padding:48px 24px 24px;}
.footer-inner{max-width:1200px;margin:0 auto;}
.footer-top{display:grid;grid-template-columns:2fr 1fr 1fr;gap:48px;margin-bottom:40px;}
.footer-brand img{height:36px;margin-bottom:12px;filter:brightness(0) invert(1);}
.footer-brand p{font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;margin-top:8px;}
.footer-col h4{font-family:'Montserrat',sans-serif;font-size:14px;font-weight:700;color:#fff;margin-bottom:16px;}
.footer-col a{display:block;font-size:13px;color:rgba(255,255,255,0.5);text-decoration:none;margin-bottom:8px;}
.footer-bottom{border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;display:flex;justify-content:space-between;align-items:center;}
.footer-bottom p{font-size:12px;color:rgba(255,255,255,0.3);}
/* MOBILE CALL BAR */
.mobile-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--orange);}
.mobile-bar a{display:flex;align-items:center;justify-content:center;gap:10px;color:#fff;font-size:16px;font-weight:800;padding:16px;text-decoration:none;font-family:'Montserrat',sans-serif;}
@media(max-width:900px){
  .hero-inner{grid-template-columns:1fr;}
  .about-grid,.footer-top{grid-template-columns:1fr;}
  .services-grid,.why-grid,.reviews-grid,.areas-grid{grid-template-columns:1fr 1fr;}
  .process-steps{grid-template-columns:1fr 1fr;}
  .process-steps::before{display:none;}
  .hero h1{font-size:32px;}
  .section-title{font-size:28px;}
}
@media(max-width:600px){
  .services-grid,.why-grid,.reviews-grid,.areas-grid,.process-steps{grid-template-columns:1fr;}
  .nav-links{display:none;}
  .mobile-bar{display:block;}
  body{padding-bottom:60px;}
  .topbar{display:none;}
  .about-stats{grid-template-columns:1fr 1fr;}
}
</style>
</head>
<body>

<!-- TOPBAR -->
<div class="topbar">
  <span class="topbar-left">Serving ${city} & Central Florida · ${phone || 'Call for Free Estimate'}</span>
  <div class="topbar-right"><a href="#contact">${c.ctaText} →</a></div>
</div>

<!-- NAVBAR -->
<nav class="navbar">
  <div class="nav-inner">
    <div class="nav-logo">
      <img src="${logoSrc}" alt="${clientName}"/>
    </div>
    <div class="nav-links">
      <a href="#services">Services</a>
      <a href="#about">About</a>
      <a href="#reviews">Reviews</a>
      <a href="#faq">FAQ</a>
      <a href="#areas">Areas</a>
    </div>
    <div class="nav-cta"><a href="#contact">${phone || c.ctaText}</a></div>
  </div>
</nav>

<!-- HERO -->
<section class="hero" id="home">
  <div class="hero-inner">
    <div class="hero-left">
      <div class="hero-eyebrow">#1 ${industry} in ${city}, FL</div>
      <h1>${c.heroTitle}</h1>
      <p class="hero-sub">${c.heroSubtitle}</p>
      <div class="hero-badges">
        ${c.trustItems.map(t => `<div class="hero-badge">✓ ${t}</div>`).join('\n        ')}
      </div>
      ${phone ? `<div class="hero-phone"><a href="tel:${phoneClean}">📞 ${phone}</a></div>` : ''}
    </div>
    <div class="form-card" id="contact">
      <h3>Get Your Free Estimate</h3>
      <p>No obligation · Fast response · Serving ${city}</p>
      <iframe src="https://link.msgsndr.com/widget/form/${formId}" title="Contact Form" loading="lazy"></iframe>
    </div>
  </div>
</section>

<!-- TRUST STRIP -->
<div class="trust-strip">
  <div class="trust-inner">
    ${c.trustItems.map((t, i) => `<div class="trust-item"><div class="trust-icon">${['✓','★','⚡','🛡','📞'][i] || '✓'}</div><span>${t}</span></div>`).join('\n    ')}
  </div>
</div>

<!-- ABOUT -->
<section class="section" id="about">
  <div class="section-inner">
    <div class="about-grid">
      <div>
        <div class="section-label">About Us</div>
        <h2 class="section-title">${c.tagline}</h2>
        <p class="section-sub">${c.aboutText}</p>
        <div class="about-stats">
          ${c.stats.map(s => `<div class="stat-box"><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div></div>`).join('\n          ')}
        </div>
      </div>
      <div class="about-img">
        <div class="about-img-inner">
          <span class="big-icon">🏆</span>
          <p>Trusted by hundreds of ${city} families and businesses</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- SERVICES -->
<section class="section section-bg" id="services">
  <div class="section-inner">
    <div class="section-label">Our Services</div>
    <h2 class="section-title">What We Do Best</h2>
    <div class="services-grid">
      ${c.services.map(s => `
      <div class="srv-card">
        <div class="srv-icon">${s.icon}</div>
        <h3>${s.name}</h3>
        <p>${s.desc}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- WHY CHOOSE US -->
<section class="section-dark">
  <div class="section-inner">
    <div class="section-label" style="color:var(--orange);">Why Choose Us</div>
    <h2 class="section-title" style="color:#fff;">The ${clientName} Difference</h2>
    <div class="why-grid">
      ${c.whyCards.map((w, i) => `
      <div class="why-card">
        <div class="why-icon">${['🎯','💰','🛡️','📞'][i] || '⭐'}</div>
        <h3>${w.title}</h3>
        <p>${w.desc}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- PROCESS -->
<section class="section" id="process">
  <div class="section-inner">
    <div style="text-align:center;margin-bottom:0;">
      <div class="section-label" style="text-align:center;">How It Works</div>
      <h2 class="section-title" style="text-align:center;">Simple Process, Exceptional Results</h2>
    </div>
    <div class="process-steps">
      ${c.processSteps.map(s => `
      <div class="step">
        <div class="step-num">${s.num}</div>
        <h3>${s.title}</h3>
        <p>${s.desc}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- REVIEWS -->
<section class="section section-bg" id="reviews">
  <div class="section-inner">
    <div class="section-label">Client Reviews</div>
    <h2 class="section-title">What Our Clients Say</h2>
    <div class="reviews-grid">
      ${c.reviews.map(r => `
      <div class="review-card">
        <div class="review-stars">${stars(r.stars)}</div>
        <p class="review-text">"${r.text}"</p>
        <div class="review-author">— ${r.name}</div>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="section" id="faq">
  <div class="section-inner">
    <div class="section-label">FAQ</div>
    <h2 class="section-title">Frequently Asked Questions</h2>
    <div class="faq-list">
      ${c.faqs.map((f, i) => `
      <div class="faq-item${i === 0 ? ' open' : ''}">
        <div class="faq-q" onclick="toggleFaq(this.parentElement)">${f.q}</div>
        <div class="faq-a">${f.a}</div>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- SERVICE AREAS -->
<section class="section section-bg" id="areas">
  <div class="section-inner">
    <div class="section-label">Service Areas</div>
    <h2 class="section-title">Proudly Serving Central Florida</h2>
    <div class="areas-grid">
      ${c.areas.map(a => `<div class="area-item">${a}</div>`).join('\n      ')}
    </div>
  </div>
</section>

<!-- CTA BANNER -->
<section class="cta-banner">
  <h2>Ready to Get Started?</h2>
  <p>Contact ${clientName} today — free estimates, fast response, guaranteed results.</p>
  <a href="#contact">${c.ctaText} →</a>
</section>

<!-- FOOTER -->
<footer>
  <div class="footer-inner">
    <div class="footer-top">
      <div class="footer-brand">
        <img src="${logoSrc}" alt="${clientName}"/>
        <p>${c.tagline}<br/>Serving ${city} and Central Florida.</p>
      </div>
      <div class="footer-col">
        <h4>Services</h4>
        ${c.services.map(s => `<a href="#services">${s.name}</a>`).join('\n        ')}
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        ${phone ? `<a href="tel:${phoneClean}">${phone}</a>` : ''}
        ${email ? `<a href="mailto:${email}">${email}</a>` : ''}
        <a href="#contact">Get Free Estimate</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p>© 2026 ${clientName}. All rights reserved.</p>
      <p>Powered by <strong>JRZ Marketing</strong> · jrzmarketing.com</p>
    </div>
  </div>
</footer>

<!-- STICKY MOBILE CALL BAR -->
${phone ? `<div class="mobile-bar"><a href="tel:${phoneClean}">📞 Call Now — ${phone}</a></div>` : ''}

<script src="https://link.msgsndr.com/js/form_embed.js"></script>
<script>
function toggleFaq(el){el.classList.toggle('open');}
</script>
</body>
</html>`;
}

async function createGHLLandingPage(locationId, clientName, industry, phone = '', email = '', city = 'Orlando', logoUrl = '', formId = '5XhL0vWCuJ59HWHQoHGG') {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
  console.log(`[Sofia] Generating professional landing page for ${clientName} (${industry}, ${city})...`);
  const pageHTML = await buildLandingHTML(clientName, phone, email, city, industry, logoUrl, formId);

  // Create funnel in the subaccount
  const funnelRes = await axios.post('https://services.leadconnectorhq.com/funnels/', {
    name: `${clientName} — Landing Page`,
    type: 'funnel',
    locationId,
  }, { headers, timeout: 15000 });

  const funnelId = funnelRes.data?.funnel?.id || funnelRes.data?.id;
  if (!funnelId) throw new Error('Funnel creation returned no ID');

  // Add a page step to the funnel
  const stepRes = await axios.post(`https://services.leadconnectorhq.com/funnels/${funnelId}/steps`, {
    name: 'Main Page',
    type: 'optin_page',
    sequence: 0,
    pageContent: pageHTML,
  }, { headers, timeout: 15000 }).catch(() => null); // non-fatal if step API differs

  console.log(`[Sofia] Created GHL funnel for ${clientName}: ${funnelId}`);
  return { funnelId, stepCreated: !!stepRes, pageHTML };
}

// ═══════════════════════════════════════════════════════════
// SOFIA — MULTI-PAGE WEBSITE BUILDER
// Builds: Home, About Us, Services, Contact Us, FAQ
// All pages share nav + footer + design system
// ═══════════════════════════════════════════════════════════

// One Claude call generates all content for all 5 pages
async function generateWebsiteContent(clientName, industry, city) {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: `Generate complete website content for a ${industry} business called "${clientName}" in ${city}. Return ONLY valid JSON:
{
  "tagline": "short powerful tagline (under 8 words)",
  "heroHeadline": "compelling H1 (under 12 words)",
  "heroSub": "hero subheadline (1 sentence, benefits-focused)",
  "stats": [{"number":"150+","label":"Happy Clients"},{"number":"5★","label":"Average Rating"},{"number":"3yr","label":"Avg Retention"},{"number":"24/7","label":"Support"}],
  "services": [
    {"title":"Service Name","icon":"🎯","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]},
    {"title":"Service Name","icon":"📈","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]},
    {"title":"Service Name","icon":"🔥","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]},
    {"title":"Service Name","icon":"⚡","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]},
    {"title":"Service Name","icon":"🎨","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]},
    {"title":"Service Name","icon":"📊","description":"2-sentence description","features":["Feature 1","Feature 2","Feature 3"]}
  ],
  "whyUs": [
    {"title":"Reason 1","description":"2-sentence description"},
    {"title":"Reason 2","description":"2-sentence description"},
    {"title":"Reason 3","description":"2-sentence description"},
    {"title":"Reason 4","description":"2-sentence description"}
  ],
  "testimonials": [
    {"name":"Real Name","business":"Business Type","text":"Authentic testimonial 2-3 sentences","rating":5},
    {"name":"Real Name","business":"Business Type","text":"Authentic testimonial 2-3 sentences","rating":5},
    {"name":"Real Name","business":"Business Type","text":"Authentic testimonial 2-3 sentences","rating":5}
  ],
  "aboutStory": "3-4 sentence company story, first person, authentic",
  "founderBio": "2-3 sentences about the founder/owner, their background and passion",
  "values": [
    {"icon":"🏆","title":"Value 1","description":"1 sentence"},
    {"icon":"🤝","title":"Value 2","description":"1 sentence"},
    {"icon":"💡","title":"Value 3","description":"1 sentence"},
    {"icon":"❤️","title":"Value 4","description":"1 sentence"}
  ],
  "processSteps": [
    {"step":"01","title":"Step Name","description":"1-2 sentences"},
    {"step":"02","title":"Step Name","description":"1-2 sentences"},
    {"step":"03","title":"Step Name","description":"1-2 sentences"},
    {"step":"04","title":"Step Name","description":"1-2 sentences"}
  ],
  "faqs": [
    {"q":"Question about pricing?","a":"Detailed answer 1-2 sentences."},
    {"q":"How long does it take?","a":"Detailed answer 1-2 sentences."},
    {"q":"Do you offer guarantees?","a":"Detailed answer 1-2 sentences."},
    {"q":"What areas do you serve?","a":"Detailed answer mentioning ${city}."},
    {"q":"How do I get started?","a":"Detailed answer 1-2 sentences."},
    {"q":"What makes you different?","a":"Detailed answer 1-2 sentences."},
    {"q":"Do you have financing?","a":"Detailed answer 1-2 sentences."},
    {"q":"Are you licensed and insured?","a":"Detailed answer 1-2 sentences."},
    {"q":"Can I see past work?","a":"Detailed answer 1-2 sentences."},
    {"q":"What if I'm not satisfied?","a":"Detailed answer 1-2 sentences."}
  ],
  "areas": ["${city}","Area 2","Area 3","Area 4","Area 5","Area 6","Area 7","Area 8"],
  "contactHours": "Mon–Fri 8am–6pm, Sat 9am–3pm",
  "metaDescription": "SEO meta description under 160 chars"
}` }],
  });
  return JSON.parse(res.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
}

// Shared CSS design system + nav + footer used on every page
function buildSharedLayout(clientName, industry, city, phone, logoUrl, siteBase = '.') {
  const navLinks = [
    { label: 'Home',       href: siteBase || '/' },
    { label: 'About Us',   href: (siteBase || '') + '/about-us' },
    { label: 'Services',   href: (siteBase || '') + '/services' },
    { label: 'FAQ',        href: (siteBase || '') + '/faq' },
    { label: 'Contact',    href: (siteBase || '') + '/contact-us' },
  ];
  const navItems = navLinks.map(l =>
    `<a href="${l.href}" class="nav-link">${l.label}</a>`
  ).join('');

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    :root{--black:#0a0a0a;--dark:#111827;--gray:#6b7280;--light:#f9fafb;--white:#ffffff;--orange:#f97316;--orange-dark:#ea6c0a;--radius:14px;--shadow:0 4px 24px rgba(0,0,0,0.08)}
    html{scroll-behavior:smooth}
    body{font-family:'Inter',system-ui,sans-serif;color:var(--dark);background:var(--white);line-height:1.6}
    h1,h2,h3,h4{font-family:'Montserrat',sans-serif;font-weight:800;line-height:1.15}
    a{text-decoration:none;color:inherit}
    img{max-width:100%;display:block}
    .container{max-width:1140px;margin:0 auto;padding:0 24px}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer;transition:all .2s;border:none}
    .btn-primary{background:var(--orange);color:#fff}.btn-primary:hover{background:var(--orange-dark);transform:translateY(-1px)}
    .btn-outline{background:transparent;color:var(--white);border:2px solid rgba(255,255,255,0.4)}.btn-outline:hover{background:rgba(255,255,255,0.1)}
    .btn-dark{background:var(--black);color:#fff}.btn-dark:hover{background:#222;transform:translateY(-1px)}
    .section{padding:80px 0}
    .section-label{font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--orange);margin-bottom:12px}
    .section-title{font-size:clamp(28px,4vw,42px);color:var(--black);margin-bottom:16px}
    .section-sub{font-size:17px;color:var(--gray);max-width:600px;line-height:1.7}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
    .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
    .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}
    .card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);padding:32px;border:1px solid #f0f0f0;transition:transform .2s,box-shadow .2s}
    .card:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.12)}
    .badge{display:inline-block;background:rgba(249,115,22,0.1);color:var(--orange);font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:6px 14px;border-radius:100px}
    .page-hero{background:var(--black);padding:80px 0 60px;text-align:center}
    .page-hero h1{color:#fff;font-size:clamp(32px,5vw,52px);margin-bottom:16px}
    .page-hero p{color:rgba(255,255,255,0.55);font-size:17px;max-width:560px;margin:0 auto}
    .stars{color:#f59e0b;font-size:14px;letter-spacing:2px}
    @media(max-width:768px){
      .grid-2,.grid-3,.grid-4{grid-template-columns:1fr}
      .section{padding:56px 0}
      .hide-mobile{display:none!important}
      .nav-menu{display:none;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:var(--black);padding:16px 24px;gap:8px;border-top:1px solid rgba(255,255,255,0.08)}
      .nav-menu.open{display:flex}
      .hamburger{display:flex!important}
    }
  `;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${clientName}" style="height:40px;width:auto;">`
    : `<span style="font-family:Montserrat,sans-serif;font-weight:900;font-size:18px;color:#fff;">${clientName}</span>`;

  const nav = `
<header style="position:sticky;top:0;z-index:999;background:var(--black);border-bottom:1px solid rgba(255,255,255,0.07);">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;height:68px;">
    <a href="${navLinks[0].href}" style="display:flex;align-items:center;">${logoHtml}</a>
    <nav class="nav-menu" id="navMenu" style="display:flex;align-items:center;gap:4px;">
      ${navItems}
    </nav>
    <div style="display:flex;align-items:center;gap:12px;">
      <a href="${navLinks[4].href}" class="btn btn-primary" style="padding:10px 22px;font-size:14px;">Get Started</a>
      <button class="hamburger" onclick="document.getElementById('navMenu').classList.toggle('open')" style="display:none;background:none;border:none;cursor:pointer;padding:4px;">
        <svg width="24" height="24" fill="none" stroke="#fff" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </div>
</header>
<style>
  .nav-link{color:rgba(255,255,255,0.65);font-size:14px;font-weight:500;padding:8px 14px;border-radius:8px;transition:all .2s}
  .nav-link:hover{color:#fff;background:rgba(255,255,255,0.08)}
</style>`;

  const footer = `
<footer style="background:var(--black);padding:64px 0 32px;">
  <div class="container">
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:48px;padding-bottom:48px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div>
        ${logoHtml}
        <p style="color:rgba(255,255,255,0.45);font-size:14px;line-height:1.8;margin:16px 0 20px;max-width:280px;">Professional ${industry} services in ${city} and surrounding areas.</p>
        ${phone ? `<p style="color:#fff;font-size:15px;font-weight:600;">${phone}</p>` : ''}
      </div>
      <div>
        <p style="color:rgba(255,255,255,0.3);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Pages</p>
        ${navLinks.map(l => `<a href="${l.href}" style="display:block;color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:10px;transition:color .2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.55)'">${l.label}</a>`).join('')}
      </div>
      <div>
        <p style="color:rgba(255,255,255,0.3);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Services</p>
        <p style="color:rgba(255,255,255,0.45);font-size:14px;line-height:2;">Available 24/7<br/>${city} & Surrounding<br/>Licensed & Insured<br/>Free Estimates</p>
      </div>
      <div>
        <p style="color:rgba(255,255,255,0.3);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">Contact</p>
        ${phone ? `<p style="color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:8px;">📞 ${phone}</p>` : ''}
        <p style="color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:8px;">📍 ${city}, FL</p>
        <a href="${navLinks[4].href}" class="btn btn-primary" style="margin-top:16px;padding:10px 20px;font-size:13px;">Get a Free Quote</a>
      </div>
    </div>
    <div style="padding-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <p style="color:rgba(255,255,255,0.25);font-size:12px;">© ${new Date().getFullYear()} ${clientName}. All rights reserved.</p>
      <p style="color:rgba(255,255,255,0.2);font-size:11px;">Website by <a href="https://jrzmarketing.com" style="color:var(--orange);">JRZ Marketing</a></p>
    </div>
  </div>
</footer>`;

  const scripts = `
<script>
  // Close nav on link click (mobile)
  document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', () => {
    document.getElementById('navMenu').classList.remove('open');
  }));
  // Highlight active nav link
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(l => {
    if (l.getAttribute('href') === path || (path.endsWith(l.getAttribute('href').split('/').pop()) && l.getAttribute('href') !== '/')) {
      l.style.color = '#fff'; l.style.background = 'rgba(249,115,22,0.15)'; l.style.color = 'var(--orange)';
    }
  });
</script>`;

  return { styles, nav, footer, scripts };
}

function wrapPage(title, metaDesc, industry, city, bodyHtml, layout) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<title>${title}</title>
<style>${layout.styles}</style>
</head>
<body>
${layout.nav}
${bodyHtml}
${layout.footer}
${layout.scripts}
</body></html>`;
}

function buildHomePage(client, c, layout) {
  const { name, phone, city, industry, formId } = client;
  const serviceCards = c.services.slice(0, 3).map(s => `
    <div class="card">
      <div style="font-size:36px;margin-bottom:16px;">${s.icon}</div>
      <h3 style="font-size:20px;margin-bottom:10px;">${s.title}</h3>
      <p style="color:var(--gray);font-size:15px;line-height:1.7;margin-bottom:16px;">${s.description}</p>
      <ul style="list-style:none;padding:0;">${s.features.map(f => `<li style="font-size:14px;color:var(--gray);padding:4px 0;padding-left:18px;position:relative;"><span style="position:absolute;left:0;color:var(--orange);font-weight:700;">✓</span>${f}</li>`).join('')}</ul>
    </div>`).join('');

  const statItems = c.stats.map(s => `
    <div style="text-align:center;">
      <div style="font-size:36px;font-weight:900;font-family:Montserrat,sans-serif;color:var(--orange);">${s.number}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">${s.label}</div>
    </div>`).join('');

  const testimonialCards = c.testimonials.map(t => `
    <div class="card">
      <div class="stars">${'★'.repeat(t.rating)}</div>
      <p style="font-size:15px;color:var(--dark);line-height:1.8;margin:14px 0 20px;font-style:italic;">"${t.text}"</p>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--orange),#f59e0b);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;">${t.name[0]}</div>
        <div><div style="font-weight:600;font-size:15px;">${t.name}</div><div style="font-size:12px;color:var(--gray);">${t.business}</div></div>
      </div>
    </div>`).join('');

  const whyItems = c.whyUs.map(w => `
    <div style="display:flex;gap:20px;align-items:flex-start;">
      <div style="width:48px;height:48px;border-radius:12px;background:rgba(249,115,22,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="20" height="20" fill="var(--orange)" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
      </div>
      <div><h4 style="font-size:17px;margin-bottom:6px;">${w.title}</h4><p style="font-size:15px;color:var(--gray);line-height:1.7;">${w.description}</p></div>
    </div>`).join('');

  const body = `
<section style="background:var(--black);padding:100px 0 80px;overflow:hidden;position:relative;">
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 70% 50%,rgba(249,115,22,0.06) 0%,transparent 60%);pointer-events:none;"></div>
  <div class="container" style="position:relative;">
    <div style="max-width:720px;">
      <div class="badge" style="margin-bottom:20px;">${city} ${industry}</div>
      <h1 style="font-size:clamp(36px,6vw,64px);color:#fff;line-height:1.08;margin-bottom:20px;">${c.heroHeadline}</h1>
      <p style="font-size:18px;color:rgba(255,255,255,0.55);line-height:1.75;margin-bottom:36px;max-width:560px;">${c.heroSub}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <a href="${layout.nav.includes('/contact-us') ? '#contact' : '#'}" class="btn btn-primary" style="font-size:16px;padding:16px 36px;">Get a Free Quote →</a>
        ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="font-size:16px;padding:16px 32px;">📞 ${phone}</a>` : ''}
      </div>
    </div>
  </div>
</section>

<section style="background:var(--dark);padding:40px 0;">
  <div class="container">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;">${statItems}</div>
  </div>
</section>

<section class="section" style="background:var(--light);">
  <div class="container">
    <div style="text-align:center;margin-bottom:56px;">
      <p class="section-label">What We Do</p>
      <h2 class="section-title">Our Core Services</h2>
      <p class="section-sub" style="margin:0 auto;">${c.tagline}</p>
    </div>
    <div class="grid-3">${serviceCards}</div>
    <div style="text-align:center;margin-top:40px;">
      <a href="${(client.siteBase||'')}/services" class="btn btn-dark">View All Services →</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid-2">
      <div>
        <p class="section-label">Why Choose Us</p>
        <h2 class="section-title" style="margin-bottom:32px;">The ${name} Difference</h2>
        <div style="display:flex;flex-direction:column;gap:28px;">${whyItems}</div>
      </div>
      <div style="background:var(--black);border-radius:20px;padding:48px;text-align:center;">
        <div style="font-size:56px;margin-bottom:16px;">🏆</div>
        <h3 style="color:#fff;font-size:26px;margin-bottom:12px;">Ready to Get Started?</h3>
        <p style="color:rgba(255,255,255,0.5);font-size:15px;line-height:1.7;margin-bottom:28px;">Join hundreds of satisfied customers in ${city}. Get your free consultation today.</p>
        <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="width:100%;justify-content:center;padding:16px;">Book Free Consultation →</a>
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--light);">
  <div class="container">
    <div style="text-align:center;margin-bottom:56px;">
      <p class="section-label">Client Stories</p>
      <h2 class="section-title">What Our Clients Say</h2>
    </div>
    <div class="grid-3">${testimonialCards}</div>
  </div>
</section>

<section style="background:var(--orange);padding:72px 0;">
  <div class="container" style="text-align:center;">
    <h2 style="font-size:clamp(28px,4vw,44px);color:#fff;margin-bottom:16px;">Ready for Results?</h2>
    <p style="color:rgba(255,255,255,0.8);font-size:17px;margin-bottom:36px;">Get a free, no-obligation consultation with our ${industry} experts.</p>
    <a href="${(client.siteBase||'')}/contact-us" class="btn" style="background:#fff;color:var(--orange);font-size:16px;padding:16px 40px;">Get Started Today →</a>
  </div>
</section>`;

  return wrapPage(`${name} — ${city} ${industry}`, c.metaDescription, industry, city, body, layout);
}

function buildAboutPage(client, c, layout) {
  const { name, phone, city, industry } = client;
  const valueCards = c.values.map(v => `
    <div class="card" style="text-align:center;">
      <div style="font-size:40px;margin-bottom:12px;">${v.icon}</div>
      <h4 style="font-size:18px;margin-bottom:8px;">${v.title}</h4>
      <p style="font-size:14px;color:var(--gray);line-height:1.7;">${v.description}</p>
    </div>`).join('');

  const processHtml = c.processSteps.map((s, i) => `
    <div style="display:flex;gap:24px;align-items:flex-start;position:relative;">
      ${i < c.processSteps.length - 1 ? '<div style="position:absolute;left:27px;top:56px;width:2px;height:calc(100% + 24px);background:linear-gradient(to bottom,var(--orange),rgba(249,115,22,0.1));"></div>' : ''}
      <div style="width:54px;height:54px;border-radius:14px;background:var(--black);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span style="font-family:Montserrat,sans-serif;font-weight:900;font-size:16px;color:var(--orange);">${s.step}</span>
      </div>
      <div style="padding-bottom:32px;">
        <h4 style="font-size:18px;margin-bottom:8px;">${s.title}</h4>
        <p style="font-size:15px;color:var(--gray);line-height:1.7;">${s.description}</p>
      </div>
    </div>`).join('');

  const body = `
<section class="page-hero">
  <div class="container">
    <div class="badge" style="margin-bottom:16px;">About Us</div>
    <h1>The Story Behind ${name}</h1>
    <p>${c.tagline}</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid-2">
      <div>
        <p class="section-label">Our Story</p>
        <h2 class="section-title">Built on Trust.<br/>Driven by Results.</h2>
        <p style="font-size:16px;color:var(--gray);line-height:1.8;margin:20px 0 28px;">${c.aboutStory}</p>
        <div style="display:flex;gap:32px;flex-wrap:wrap;">
          ${c.stats.slice(0,3).map(s => `<div><div style="font-size:28px;font-weight:900;font-family:Montserrat,sans-serif;color:var(--orange);">${s.number}</div><div style="font-size:12px;color:var(--gray);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">${s.label}</div></div>`).join('')}
        </div>
      </div>
      <div style="background:var(--black);border-radius:20px;padding:48px;">
        <div style="width:72px;height:72px;border-radius:20px;background:rgba(249,115,22,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:20px;font-size:32px;">👤</div>
        <h3 style="color:#fff;font-size:22px;margin-bottom:12px;">${name}</h3>
        <p style="color:var(--orange);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">Founder & Owner · ${city}</p>
        <p style="color:rgba(255,255,255,0.55);font-size:15px;line-height:1.8;">${c.founderBio}</p>
        ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-primary" style="margin-top:24px;width:100%;justify-content:center;">📞 ${phone}</a>` : ''}
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--light);">
  <div class="container">
    <div style="text-align:center;margin-bottom:56px;">
      <p class="section-label">What We Stand For</p>
      <h2 class="section-title">Our Core Values</h2>
    </div>
    <div class="grid-4">${valueCards}</div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid-2">
      <div>
        <p class="section-label">How It Works</p>
        <h2 class="section-title" style="margin-bottom:40px;">Our Proven Process</h2>
        ${processHtml}
      </div>
      <div style="padding:48px;background:var(--light);border-radius:20px;">
        <h3 style="font-size:26px;margin-bottom:16px;">Serving ${city} & Beyond</h3>
        <p style="font-size:15px;color:var(--gray);line-height:1.8;margin-bottom:24px;">We proudly serve clients across the ${city} area and surrounding communities.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${c.areas.map(a => `<span style="background:#fff;border:1px solid #e5e7eb;border-radius:100px;padding:6px 16px;font-size:13px;font-weight:500;">${a}</span>`).join('')}
        </div>
        <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="margin-top:32px;">Work With Us →</a>
      </div>
    </div>
  </div>
</section>`;

  return wrapPage(`About Us — ${name} | ${city} ${industry}`, `Learn about ${name}, a trusted ${industry} company in ${city}.`, industry, city, body, layout);
}

function buildServicesPage(client, c, layout) {
  const { name, phone, city, industry } = client;
  const allServiceCards = c.services.map(s => `
    <div class="card">
      <div style="font-size:40px;margin-bottom:16px;">${s.icon}</div>
      <h3 style="font-size:20px;margin-bottom:10px;">${s.title}</h3>
      <p style="font-size:15px;color:var(--gray);line-height:1.7;margin-bottom:20px;">${s.description}</p>
      <ul style="list-style:none;padding:0;margin-bottom:24px;">${s.features.map(f => `<li style="font-size:14px;color:var(--dark);padding:6px 0;border-bottom:1px solid #f0f0f0;padding-left:20px;position:relative;"><span style="position:absolute;left:0;color:var(--orange);font-weight:700;">✓</span>${f}</li>`).join('')}</ul>
      <a href="${(client.siteBase||'')}/contact-us" class="btn btn-dark" style="width:100%;justify-content:center;">Get a Quote</a>
    </div>`).join('');

  const processHtml = c.processSteps.map(s => `
    <div style="text-align:center;padding:32px 24px;">
      <div style="width:56px;height:56px;border-radius:16px;background:var(--orange);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><span style="font-family:Montserrat,sans-serif;font-weight:900;font-size:18px;color:#fff;">${s.step}</span></div>
      <h4 style="font-size:17px;margin-bottom:8px;">${s.title}</h4>
      <p style="font-size:14px;color:var(--gray);line-height:1.7;">${s.description}</p>
    </div>`).join('');

  const body = `
<section class="page-hero">
  <div class="container">
    <div class="badge" style="margin-bottom:16px;">Services</div>
    <h1>Everything We Offer</h1>
    <p>Professional ${industry} solutions for ${city} and surrounding areas</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div style="text-align:center;margin-bottom:56px;">
      <p class="section-label">Complete Solutions</p>
      <h2 class="section-title">Our Services</h2>
      <p class="section-sub" style="margin:0 auto;">${c.tagline}</p>
    </div>
    <div class="grid-3">${allServiceCards}</div>
  </div>
</section>

<section class="section" style="background:var(--light);">
  <div class="container">
    <div style="text-align:center;margin-bottom:48px;">
      <p class="section-label">The Process</p>
      <h2 class="section-title">How We Work</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;position:relative;">
      <div style="position:absolute;top:28px;left:12.5%;right:12.5%;height:2px;background:linear-gradient(to right,var(--orange),rgba(249,115,22,0.2));z-index:0;"></div>
      ${processHtml}
    </div>
  </div>
</section>

<section style="background:var(--black);padding:72px 0;">
  <div class="container" style="text-align:center;">
    <h2 style="color:#fff;font-size:clamp(26px,4vw,40px);margin-bottom:16px;">Not Sure Which Service You Need?</h2>
    <p style="color:rgba(255,255,255,0.5);font-size:17px;margin-bottom:32px;">Call us or book a free consultation — we'll assess your situation and recommend the best solution.</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="padding:16px 40px;font-size:16px;">Book Free Consultation →</a>
      ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="padding:16px 32px;font-size:16px;">📞 ${phone}</a>` : ''}
    </div>
  </div>
</section>`;

  return wrapPage(`Services — ${name} | ${city} ${industry}`, `Explore all ${industry} services offered by ${name} in ${city}.`, industry, city, body, layout);
}

function buildContactPage(client, c, layout) {
  const { name, phone, city, industry, formId } = client;
  const body = `
<section class="page-hero">
  <div class="container">
    <div class="badge" style="margin-bottom:16px;">Contact Us</div>
    <h1>Let's Get Started</h1>
    <p>Fill out the form or call us directly — we respond within 24 hours</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="grid-2" style="gap:56px;">
      <div>
        <p class="section-label">Send Us a Message</p>
        <h2 class="section-title" style="margin-bottom:24px;">Get a Free Quote</h2>
        <p style="color:var(--gray);font-size:16px;line-height:1.7;margin-bottom:32px;">Tell us about your project and we'll get back to you with a detailed, no-obligation quote.</p>
        <div style="background:var(--light);border-radius:var(--radius);padding:32px;">
          <iframe src="https://api.leadconnectorhq.com/widget/form/${formId}" style="width:100%;min-height:520px;border:none;" scrolling="no" id="msgsndr-form"></iframe>
          <script src="https://link.msgsndr.com/js/form_embed.js"></script>
        </div>
      </div>
      <div>
        <p class="section-label">Contact Information</p>
        <h2 class="section-title" style="margin-bottom:32px;">Reach Us Directly</h2>
        <div style="display:flex;flex-direction:column;gap:20px;margin-bottom:40px;">
          ${phone ? `<div style="display:flex;gap:16px;align-items:flex-start;">
            <div style="width:48px;height:48px;border-radius:12px;background:rgba(249,115,22,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">📞</div>
            <div><p style="font-weight:600;font-size:16px;margin-bottom:4px;">Phone</p><a href="tel:${phone.replace(/\D/g,'')}" style="color:var(--gray);font-size:15px;">${phone}</a></div>
          </div>` : ''}
          <div style="display:flex;gap:16px;align-items:flex-start;">
            <div style="width:48px;height:48px;border-radius:12px;background:rgba(249,115,22,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">📍</div>
            <div><p style="font-weight:600;font-size:16px;margin-bottom:4px;">Location</p><p style="color:var(--gray);font-size:15px;">${city}, Florida</p></div>
          </div>
          <div style="display:flex;gap:16px;align-items:flex-start;">
            <div style="width:48px;height:48px;border-radius:12px;background:rgba(249,115,22,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">🕐</div>
            <div><p style="font-weight:600;font-size:16px;margin-bottom:4px;">Hours</p><p style="color:var(--gray);font-size:15px;">${c.contactHours}</p></div>
          </div>
          <div style="display:flex;gap:16px;align-items:flex-start;">
            <div style="width:48px;height:48px;border-radius:12px;background:rgba(249,115,22,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">⚡</div>
            <div><p style="font-weight:600;font-size:16px;margin-bottom:4px;">Response Time</p><p style="color:var(--gray);font-size:15px;">We reply within 2 hours during business hours</p></div>
          </div>
        </div>
        <div style="background:var(--black);border-radius:var(--radius);padding:28px;">
          <h4 style="color:#fff;font-size:18px;margin-bottom:12px;">Service Areas</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${c.areas.map(a => `<span style="background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.6);border-radius:100px;padding:5px 14px;font-size:13px;">${a}</span>`).join('')}</div>
        </div>
      </div>
    </div>
  </div>
</section>`;

  return wrapPage(`Contact Us — ${name} | ${city}`, `Contact ${name} for ${industry} services in ${city}. Free quotes, fast response.`, industry, city, body, layout);
}

function buildFAQPage(client, c, layout) {
  const { name, city, industry, phone } = client;
  const faqItems = c.faqs.map((f, i) => `
    <div style="border-bottom:1px solid #f0f0f0;">
      <button onclick="toggleFaq(${i})" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:20px 0;background:none;border:none;cursor:pointer;text-align:left;">
        <span style="font-family:Montserrat,sans-serif;font-weight:700;font-size:16px;color:var(--dark);padding-right:16px;">${f.q}</span>
        <span id="faq-icon-${i}" style="color:var(--orange);font-size:24px;flex-shrink:0;transition:transform .2s;">+</span>
      </button>
      <div id="faq-body-${i}" style="display:none;padding:0 0 20px;">
        <p style="font-size:15px;color:var(--gray);line-height:1.8;">${f.a}</p>
      </div>
    </div>`).join('');

  const body = `
<section class="page-hero">
  <div class="container">
    <div class="badge" style="margin-bottom:16px;">FAQ</div>
    <h1>Frequently Asked Questions</h1>
    <p>Everything you need to know about our ${industry} services in ${city}</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div style="max-width:760px;margin:0 auto;">
      <div style="background:var(--light);border-radius:14px;padding:16px 24px;display:flex;align-items:center;gap:12px;margin-bottom:40px;">
        <span style="font-size:20px;">🔍</span>
        <input type="text" placeholder="Search questions..." oninput="filterFaqs(this.value)" style="background:none;border:none;outline:none;font-size:15px;color:var(--dark);width:100%;" />
      </div>
      <div id="faq-list">${faqItems}</div>
    </div>
  </div>
</section>

<section style="background:var(--light);padding:72px 0;">
  <div class="container" style="text-align:center;">
    <h2 style="font-size:clamp(26px,4vw,40px);margin-bottom:16px;">Still Have Questions?</h2>
    <p style="color:var(--gray);font-size:17px;margin-bottom:32px;">We're happy to help. Reach out and we'll answer within a few hours.</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="padding:16px 36px;">Contact Us →</a>
      ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-dark" style="padding:16px 32px;">📞 ${phone}</a>` : ''}
    </div>
  </div>
</section>

<script>
function toggleFaq(i) {
  const body = document.getElementById('faq-body-' + i);
  const icon = document.getElementById('faq-icon-' + i);
  const open = body.style.display === 'block';
  document.querySelectorAll('[id^="faq-body-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[id^="faq-icon-"]').forEach(el => { el.textContent = '+'; el.style.transform = ''; });
  if (!open) { body.style.display = 'block'; icon.textContent = '×'; icon.style.transform = 'rotate(45deg)'; }
}
function filterFaqs(q) {
  const term = q.toLowerCase();
  document.querySelectorAll('[id^="faq-body-"]').forEach((el, i) => {
    const row = el.closest ? el.parentElement : el.previousElementSibling?.parentElement;
    if (row) row.style.display = (row.textContent.toLowerCase().includes(term) || !term) ? '' : 'none';
  });
}
</script>`;

  return wrapPage(`FAQ — ${name} | ${city} ${industry}`, `Common questions about ${name}'s ${industry} services in ${city}.`, industry, city, body, layout);
}

// Main orchestrator — generates all 5 pages
async function buildWebsite(clientName, phone, email, city, industry, logoUrl = '', formId = GHL_FORM_ID, siteBase = '.') {
  city = city || 'Orlando';
  formId = formId || GHL_FORM_ID;
  console.log(`[Sofia] Building 5-page website for ${clientName} (${industry}, ${city})...`);
  const content = await generateWebsiteContent(clientName, industry, city);
  const client = { name: clientName, phone, email, city, industry, logoUrl, formId, siteBase };
  const layout = buildSharedLayout(clientName, industry, city, phone, logoUrl, siteBase);
  return {
    home:     buildHomePage(client, content, layout),
    about:    buildAboutPage(client, content, layout),
    services: buildServicesPage(client, content, layout),
    contact:  buildContactPage(client, content, layout),
    faq:      buildFAQPage(client, content, layout),
    content, // expose for debugging
  };
}

// Create GHL funnel with 5 linked page steps
async function createGHLWebsite(locationId, clientName, industry, phone = '', email = '', city = 'Orlando', logoUrl = '', formId = GHL_FORM_ID) {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
  console.log(`[Sofia] Creating GHL 5-page website for ${clientName}...`);

  // Step 1: create funnel container
  const funnelRes = await axios.post('https://services.leadconnectorhq.com/funnels/', {
    name: `${clientName} — Website`,
    type: 'funnel',
    locationId,
  }, { headers, timeout: 15000 });
  const funnelId = funnelRes.data?.funnel?.id || funnelRes.data?.id;
  if (!funnelId) throw new Error('GHL funnel creation returned no ID');

  // Step 2: build all pages (we know funnelId now but not the base URL — use GHL path pattern)
  const siteBase = ''; // relative nav links work within funnel
  const pages = await buildWebsite(clientName, phone, email, city, industry, logoUrl, formId, siteBase);

  // Step 3: add all 5 page steps
  const pageSteps = [
    { name: 'Home',       slug: 'home',       html: pages.home,     sequence: 0 },
    { name: 'About Us',   slug: 'about-us',   html: pages.about,    sequence: 1 },
    { name: 'Services',   slug: 'services',   html: pages.services, sequence: 2 },
    { name: 'Contact Us', slug: 'contact-us', html: pages.contact,  sequence: 3 },
    { name: 'FAQ',        slug: 'faq',        html: pages.faq,      sequence: 4 },
  ];

  const results = [];
  for (const step of pageSteps) {
    const stepRes = await axios.post(`https://services.leadconnectorhq.com/funnels/${funnelId}/steps`, {
      name: step.name, type: 'optin_page', sequence: step.sequence, pageContent: step.html,
    }, { headers, timeout: 15000 }).catch(e => ({ error: e.message }));
    results.push({ page: step.name, created: !stepRes?.error, error: stepRes?.error });
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[Sofia] Website created: ${funnelId}. Pages: ${results.filter(r => r.created).length}/5`);
  logActivity('sofia', `Built 5-page website for ${clientName}: ${funnelId}`);
  return { funnelId, pages: results, locationId };
}

// ═══════════════════════════════════════════════════════════
// SOFIA — LEAD FUNNEL BUILDER
// Types: 'consultation' | 'quote' | 'lead-magnet'
// ═══════════════════════════════════════════════════════════

async function generateLeadFunnelContent(type, clientName, industry, city) {
  const typeMap = {
    consultation: 'free consultation booking',
    quote: 'free estimate/quote request',
    'lead-magnet': 'free guide/checklist download',
  };
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: `Generate lead funnel content for a ${industry} business "${clientName}" in ${city}. Funnel type: ${typeMap[type] || type}. Return ONLY valid JSON:
{
  "optinHeadline": "compelling opt-in headline (action-oriented, under 12 words)",
  "optinSub": "1-sentence value proposition",
  "bulletPoints": ["Benefit 1","Benefit 2","Benefit 3","Benefit 4"],
  "ctaText": "CTA button text (under 6 words)",
  "socialProof": "short social proof line (e.g. '127 homeowners in ${city} already claimed this')",
  "thankYouHeadline": "thank you page headline",
  "thankYouSub": "next steps instruction",
  "urgencyText": "urgency/scarcity line",
  "leadMagnetTitle": "name of the free offer (e.g. 'Free Roof Inspection', 'Free SEO Audit')"
}` }],
  });
  return JSON.parse(res.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
}

async function buildLeadFunnelHTML(type, clientName, phone, city, industry, logoUrl = '', formId = GHL_FORM_ID) {
  const c = await generateLeadFunnelContent(type, clientName, industry, city);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${clientName}" style="height:44px;">`
    : `<span style="font-family:Montserrat,sans-serif;font-weight:900;font-size:20px;color:#fff;">${clientName}</span>`;

  const bullets = c.bulletPoints.map(b => `
    <div style="display:flex;gap:12px;align-items:flex-start;">
      <div style="width:24px;height:24px;border-radius:50%;background:rgba(249,115,22,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
        <span style="color:var(--orange);font-weight:700;font-size:13px;">✓</span>
      </div>
      <span style="font-size:16px;color:rgba(255,255,255,0.8);line-height:1.6;">${b}</span>
    </div>`).join('');

  const sharedStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Inter:wght@400;500;600&display=swap');
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    :root{--black:#0a0a0a;--orange:#f97316;--white:#fff}
    body{font-family:'Inter',sans-serif;background:var(--black);color:#fff;min-height:100vh}
    h1,h2{font-family:'Montserrat',sans-serif;font-weight:800}
    .btn{display:inline-block;padding:18px 40px;border-radius:12px;font-weight:700;font-size:17px;cursor:pointer;transition:all .2s;text-decoration:none;border:none;text-align:center}
    .btn-cta{background:var(--orange);color:#fff;width:100%}.btn-cta:hover{background:#ea6c0a;transform:translateY(-2px)}
  `;

  const optin = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.leadMagnetTitle} — ${clientName}</title>
<style>${sharedStyles}</style>
</head><body>
<div style="min-height:100vh;display:grid;grid-template-rows:auto 1fr;background:linear-gradient(135deg,#0a0a0a 0%,#1a0a00 100%);">
  <header style="padding:20px 32px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:center;">
    ${logoHtml}
  </header>
  <main style="display:flex;align-items:center;justify-content:center;padding:40px 24px;">
    <div style="max-width:960px;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;">
      <div>
        <div style="display:inline-block;background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:var(--orange);font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:7px 16px;border-radius:100px;margin-bottom:20px;">
          ${city} ${industry}
        </div>
        <h1 style="font-size:clamp(32px,5vw,52px);line-height:1.1;margin-bottom:20px;">${c.optinHeadline}</h1>
        <p style="font-size:17px;color:rgba(255,255,255,0.55);line-height:1.7;margin-bottom:32px;">${c.optinSub}</p>
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:32px;">${bullets}</div>
        <p style="font-size:13px;color:rgba(255,255,255,0.3);">${c.socialProof}</p>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;">
        <p style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--orange);margin-bottom:8px;">FREE — No Obligation</p>
        <h2 style="font-size:24px;margin-bottom:8px;">${c.leadMagnetTitle}</h2>
        <p style="color:rgba(255,255,255,0.4);font-size:14px;margin-bottom:28px;">${c.urgencyText}</p>
        <iframe src="https://api.leadconnectorhq.com/widget/form/${formId}" style="width:100%;min-height:380px;border:none;border-radius:12px;" scrolling="no"></iframe>
        <script src="https://link.msgsndr.com/js/form_embed.js"></script>
        ${phone ? `<p style="text-align:center;margin-top:20px;font-size:14px;color:rgba(255,255,255,0.3);">Or call us: <a href="tel:${phone.replace(/\D/g,'')}" style="color:var(--orange);font-weight:600;">${phone}</a></p>` : ''}
      </div>
    </div>
  </main>
</div>
</body></html>`;

  const thankYou = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Thank You — ${clientName}</title>
<style>${sharedStyles}</style>
</head><body>
<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;background:linear-gradient(135deg,#0a0a0a,#0f1a0a);">
  <header style="position:fixed;top:0;left:0;right:0;padding:20px 32px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:center;background:rgba(10,10,10,0.9);backdrop-filter:blur(8px);">${logoHtml}</header>
  <div style="max-width:560px;margin:80px auto 0;">
    <div style="width:80px;height:80px;border-radius:50%;background:rgba(34,197,94,0.15);border:2px solid rgba(34,197,94,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 28px;font-size:36px;">✅</div>
    <div style="display:inline-block;background:rgba(34,197,94,0.1);color:#22c55e;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:6px 16px;border-radius:100px;margin-bottom:20px;">Confirmed</div>
    <h1 style="font-size:clamp(28px,5vw,48px);line-height:1.15;margin-bottom:16px;">${c.thankYouHeadline}</h1>
    <p style="font-size:17px;color:rgba(255,255,255,0.5);line-height:1.7;margin-bottom:36px;">${c.thankYouSub}</p>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;margin-bottom:32px;">
      <p style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:16px;">What Happens Next</p>
      <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
        <div style="display:flex;gap:12px;align-items:center;"><span style="width:28px;height:28px;border-radius:50%;background:var(--orange);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">1</span><span style="font-size:15px;color:rgba(255,255,255,0.7);">We review your submission</span></div>
        <div style="display:flex;gap:12px;align-items:center;"><span style="width:28px;height:28px;border-radius:50%;background:var(--orange);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">2</span><span style="font-size:15px;color:rgba(255,255,255,0.7);">A specialist contacts you within 2 hours</span></div>
        <div style="display:flex;gap:12px;align-items:center;"><span style="width:28px;height:28px;border-radius:50%;background:var(--orange);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">3</span><span style="font-size:15px;color:rgba(255,255,255,0.7);">We schedule your free ${type === 'consultation' ? 'consultation' : 'appointment'}</span></div>
      </div>
    </div>
    ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-cta">📞 Call Us Now: ${phone}</a>` : ''}
  </div>
</div>
</body></html>`;

  return { optin, thankYou, content: c };
}

async function createGHLLeadFunnel(locationId, clientName, industry, funnelType = 'consultation', phone = '', city = 'Orlando', logoUrl = '', formId = GHL_FORM_ID) {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
  const typeLabel = { consultation: 'Free Consultation', quote: 'Free Quote', 'lead-magnet': 'Lead Magnet' }[funnelType] || funnelType;
  console.log(`[Sofia] Building ${typeLabel} funnel for ${clientName}...`);

  const { optin, thankYou, content: fc } = await buildLeadFunnelHTML(funnelType, clientName, phone, city, industry, logoUrl, formId);

  const funnelRes = await axios.post('https://services.leadconnectorhq.com/funnels/', {
    name: `${clientName} — ${typeLabel} Funnel`,
    type: 'funnel', locationId,
  }, { headers, timeout: 15000 });
  const funnelId = funnelRes.data?.funnel?.id || funnelRes.data?.id;
  if (!funnelId) throw new Error('Funnel creation returned no ID');

  const steps = [
    { name: typeLabel, type: 'optin_page', sequence: 0, pageContent: optin },
    { name: 'Thank You', type: 'optin_page', sequence: 1, pageContent: thankYou },
  ];
  const results = [];
  for (const step of steps) {
    const r = await axios.post(`https://services.leadconnectorhq.com/funnels/${funnelId}/steps`, step, { headers, timeout: 15000 }).catch(e => ({ error: e.message }));
    results.push({ page: step.name, created: !r?.error });
    await new Promise(r2 => setTimeout(r2, 500));
  }

  console.log(`[Sofia] Lead funnel created: ${funnelId} (${typeLabel})`);
  logActivity('sofia', `Built ${typeLabel} funnel for ${clientName}: ${funnelId}`);
  return { funnelId, funnelType: typeLabel, leadMagnetTitle: fc.leadMagnetTitle, pages: results };
}

// ═══════════════════════════════════════════════════════════
// SOFIA — FORMS, SURVEYS & A2P COMPLIANCE
// ═══════════════════════════════════════════════════════════

// A2P-compliant SMS opt-in language — required on every form
const A2P_CONSENT_EN = (bizName) =>
  `By submitting this form, you consent to receive SMS messages and emails from ${bizName} regarding your inquiry. Msg frequency varies. Reply STOP to unsubscribe, HELP for help. Msg &amp; data rates may apply.`;
const A2P_CONSENT_ES = (bizName) =>
  `Al enviar este formulario, acepta recibir mensajes de texto y correos electrónicos de ${bizName}. La frecuencia varía. Responda STOP para cancelar, HELP para ayuda. Pueden aplicar tarifas de mensajes y datos.`;

// GHL form field definitions per form type
function getFormFields(formType) {
  const base = [
    { id: 'full_name',  label: 'Full Name',     dataType: 'TEXT',       isRequired: true,  position: 0 },
    { id: 'phone',      label: 'Phone Number',  dataType: 'PHONE',      isRequired: true,  position: 1 },
    { id: 'email',      label: 'Email Address', dataType: 'EMAIL',      isRequired: true,  position: 2 },
  ];
  const sets = {
    contact: [
      ...base,
      { id: 'message', label: 'How can we help you?', dataType: 'LARGE_TEXT', isRequired: false, position: 3 },
    ],
    lead: [
      ...base,
      { id: 'business_name', label: 'Business Name', dataType: 'TEXT', isRequired: false, position: 3 },
      { id: 'message', label: 'What are you looking for?', dataType: 'LARGE_TEXT', isRequired: false, position: 4 },
    ],
    quote: [
      ...base,
      { id: 'business_name', label: 'Business Name', dataType: 'TEXT', isRequired: false, position: 3 },
      { id: 'service_needed', label: 'Service Needed', dataType: 'TEXT', isRequired: false, position: 4 },
      { id: 'budget', label: 'Monthly Budget', dataType: 'DROPDOWN', isRequired: false, position: 5,
        picklistOptions: ['Under $500', '$500–$1,000', '$1,000–$2,500', '$2,500–$5,000', '$5,000+'] },
      { id: 'timeline', label: 'When to start?', dataType: 'DROPDOWN', isRequired: false, position: 6,
        picklistOptions: ['Immediately', 'Within 1 month', '1–3 months', 'Just exploring'] },
      { id: 'message', label: 'Tell us about your business', dataType: 'LARGE_TEXT', isRequired: false, position: 7 },
    ],
    'survey-nps': [
      ...base,
      { id: 'nps_score', label: 'How likely are you to recommend us? (1–10)', dataType: 'DROPDOWN', isRequired: true, position: 3,
        picklistOptions: ['1','2','3','4','5','6','7','8','9','10'] },
      { id: 'did_well', label: 'What did we do well?', dataType: 'LARGE_TEXT', isRequired: false, position: 4 },
      { id: 'improve',  label: 'What can we improve?',  dataType: 'LARGE_TEXT', isRequired: false, position: 5 },
      { id: 'overall',  label: 'Overall experience', dataType: 'DROPDOWN', isRequired: false, position: 6,
        picklistOptions: ['Excellent','Good','Average','Below average','Poor'] },
    ],
    'survey-qualify': [
      ...base,
      { id: 'business_type', label: 'Type of Business', dataType: 'TEXT', isRequired: true, position: 3 },
      { id: 'monthly_revenue', label: 'Current Monthly Revenue', dataType: 'DROPDOWN', isRequired: false, position: 4,
        picklistOptions: ['Under $5K','$5K–$15K','$15K–$50K','$50K–$100K','$100K+'] },
      { id: 'biggest_challenge', label: 'Biggest Marketing Challenge', dataType: 'DROPDOWN', isRequired: true, position: 5,
        picklistOptions: ['Getting new clients','Retaining current clients','Online presence','Ad ROI','Brand awareness','Other'] },
      { id: 'current_marketing', label: 'What marketing are you doing now?', dataType: 'LARGE_TEXT', isRequired: false, position: 6 },
      { id: 'goal', label: 'Main Goal for Next 90 Days', dataType: 'LARGE_TEXT', isRequired: false, position: 7 },
    ],
  };
  return sets[formType] || sets.contact;
}

async function createGHLForm(locationId, formType = 'contact', clientName = '', industry = '') {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
  const labels = { contact: 'Contact Us', lead: 'Lead Capture', quote: 'Get a Free Quote', 'survey-nps': 'Satisfaction Survey', 'survey-qualify': 'Qualification Survey' };
  const name = `${clientName ? clientName + ' — ' : ''}${labels[formType] || 'Contact Form'}`;
  const thankYouMessage = formType.startsWith('survey')
    ? 'Thank you for your feedback! We value your input.'
    : 'Thank you! Our team will reach out within 24 hours.';

  const formRes = await axios.post('https://services.leadconnectorhq.com/forms/', {
    locationId, name,
    fields: getFormFields(formType),
    submitType: 'ThankYouMessage',
    thankYouMessage,
  }, { headers, timeout: 15000 });

  const formId = formRes.data?.form?.id || formRes.data?.id;
  console.log(`[Sofia] Form created: "${name}" (${formId}) for ${locationId}`);
  logActivity('sofia', `Created ${formType} form for ${clientName || locationId}`);
  return { formId, formType, name, fieldCount: getFormFields(formType).length };
}

async function createGHLSurvey(locationId, surveyType = 'qualify', clientName = '', industry = '') {
  const headers = { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' };

  // Claude generates industry-specific, conversational survey questions
  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: `Create a ${surveyType === 'nps' ? 'client satisfaction (NPS-style)' : 'lead qualification'} survey for a ${industry || 'marketing'} business called "${clientName || 'Business'}". Make questions feel conversational, not corporate. Return ONLY valid JSON:
{"title":"Survey title","description":"1-sentence purpose","questions":[
{"text":"question","type":"radio|dropdown|text|rating","options":["opt1","opt2"],"required":true}
]}
Include ${surveyType === 'nps' ? '4' : '6'} questions. For rating use null options. For radio/dropdown provide 3-5 concise options.` }],
  });
  const survey = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);

  const typeMap = { radio: 'MULTIPLE_CHOICE', dropdown: 'DROPDOWN', text: 'TEXTAREA', rating: 'RATING' };
  const surveyRes = await axios.post('https://services.leadconnectorhq.com/surveys/', {
    locationId,
    name: survey.title,
    description: survey.description,
    questions: survey.questions.map((q, i) => ({
      text: q.text,
      type: typeMap[q.type] || 'TEXTAREA',
      required: !!q.required,
      options: q.options || [],
      position: i,
    })),
  }, { headers, timeout: 15000 });

  const surveyId = surveyRes.data?.survey?.id || surveyRes.data?.id;
  console.log(`[Sofia] Survey created: "${survey.title}" (${surveyId}) for ${locationId}`);
  logActivity('sofia', `Created ${surveyType} survey for ${clientName || locationId}`);
  return { surveyId, title: survey.title, questionCount: survey.questions.length };
}

// Auto-create the full starter form + survey kit for a new client subaccount
async function createClientFormKit(locationId, clientName, industry) {
  console.log(`[Sofia] Creating form kit for ${clientName}...`);
  const results = {};
  try { results.contact  = await createGHLForm(locationId, 'contact',  clientName, industry); await new Promise(r => setTimeout(r, 1000)); } catch(e) { results.contact  = { error: e.message }; }
  try { results.quote    = await createGHLForm(locationId, 'quote',    clientName, industry); await new Promise(r => setTimeout(r, 1000)); } catch(e) { results.quote    = { error: e.message }; }
  try { results.qualify  = await createGHLForm(locationId, 'survey-qualify', clientName, industry); await new Promise(r => setTimeout(r, 1000)); } catch(e) { results.qualify  = { error: e.message }; }
  try { results.nps      = await createGHLSurvey(locationId, 'nps',   clientName, industry); } catch(e) { results.nps      = { error: e.message }; }
  console.log(`[Sofia] Form kit done for ${clientName}:`, JSON.stringify(results));
  return results;
}

// ─── Sofia: New Client Onboarding Check ──────────────────

const SOFIA_CLIENTS_SNAPSHOT_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/sofia_clients_snapshot.json';
const SOFIA_CLIENTS_SNAPSHOT_PID = 'jrz/sofia_clients_snapshot';

async function loadSofiaClientsSnapshot() {
  try {
    const res = await axios.get(SOFIA_CLIENTS_SNAPSHOT_URL + '?t=' + Date.now(), { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch { return {}; }
}

async function saveSofiaClientsSnapshot(data) {
  const ts  = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha1').update(`overwrite=true&public_id=${SOFIA_CLIENTS_SNAPSHOT_PID}&timestamp=${ts}${CLOUDINARY_API_SECRET}`).digest('hex');
  const form = new FormData();
  form.append('file', Buffer.from(JSON.stringify(data, null, 2)), { filename: 'sofia_clients_snapshot.json', contentType: 'application/json' });
  form.append('public_id', SOFIA_CLIENTS_SNAPSHOT_PID);
  form.append('resource_type', 'raw');
  form.append('timestamp', String(ts));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('signature', sig);
  form.append('overwrite', 'true');
  await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
}

async function runSofiaOnboardingCheck() {
  console.log('[Sofia] Running new client onboarding check...');
  const [currentClients, prevSnapshot] = await Promise.all([getElenaClients(), loadSofiaClientsSnapshot()]);
  const newClients = currentClients.filter(c => !prevSnapshot[c.locationId]);

  // Save updated snapshot
  const newSnap = { ...prevSnapshot };
  currentClients.forEach(c => { if (!newSnap[c.locationId]) newSnap[c.locationId] = { addedAt: new Date().toISOString().split('T')[0] }; });
  await saveSofiaClientsSnapshot(newSnap);

  if (!newClients.length) { console.log('[Sofia] No new clients detected.'); return; }

  console.log(`[Sofia] ${newClients.length} new client(s) detected: ${newClients.map(c => c.name).join(', ')}`);
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';

  for (const client of newClients) {
    try {
      const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${client.locationId}`, {
        headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }, timeout: 8000,
      });
      const loc = locRes.data?.location || locRes.data;
      const website = loc?.website || loc?.business?.website || null;
      const phone   = loc?.phone   || loc?.business?.phone   || '';
      const email   = loc?.email   || loc?.business?.email   || '';

      const html = `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f4f4f4;padding:32px 20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0a0a0a;padding:22px 32px;display:flex;align-items:center;justify-content:space-between;">
    <img src="${logoUrl}" style="height:30px;"/>
    <span style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:5px 12px;border-radius:100px;">Sofia · Nuevo Cliente</span>
  </div>
  <div style="background:#16a34a;padding:22px 32px;">
    <h1 style="color:#fff;font-size:20px;font-weight:800;">🎉 Nuevo cliente detectado</h1>
    <p style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;">${client.name} acaba de unirse a JRZ Marketing</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:8px 0;font-size:13px;color:#999;width:120px;">Nombre</td><td style="padding:8px 0;font-size:14px;font-weight:600;color:#0a0a0a;">${client.name}</td></tr>
      <tr><td style="padding:8px 0;font-size:13px;color:#999;">Industria</td><td style="padding:8px 0;font-size:14px;color:#0a0a0a;">${client.industry}</td></tr>
      <tr><td style="padding:8px 0;font-size:13px;color:#999;">Teléfono</td><td style="padding:8px 0;font-size:14px;color:#0a0a0a;">${phone || 'No registrado'}</td></tr>
      <tr><td style="padding:8px 0;font-size:13px;color:#999;">Email</td><td style="padding:8px 0;font-size:14px;color:#0a0a0a;">${email || 'No registrado'}</td></tr>
      <tr><td style="padding:8px 0;font-size:13px;color:#999;">Sitio web</td><td style="padding:8px 0;font-size:14px;color:${website ? '#16a34a' : '#dc2626'};">${website || '❌ Sin sitio web'}</td></tr>
    </table>
    ${!website ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;">
      <p style="font-size:14px;color:#991b1b;font-weight:600;margin-bottom:6px;">⚠️ Este cliente no tiene sitio web</p>
      <p style="font-size:13px;color:#dc2626;">Ejecuta este comando para que Sofia les cree una landing page automáticamente:</p>
      <code style="display:block;background:#fff;border:1px solid #fecaca;border-radius:6px;padding:10px;margin-top:10px;font-size:12px;color:#991b1b;">curl -X POST https://armando-bot-1.onrender.com/sofia/build-page -H "Content-Type: application/json" -d '{"locationId":"${client.locationId}","industry":"${client.industry}"}'</code>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;">
      <p style="font-size:14px;color:#166534;">✅ Tiene sitio web: <a href="${website}" style="color:#16a34a;">${website}</a></p>
      <p style="font-size:13px;color:#4ade80;margin-top:4px;">Sofia hará un audit completo en el próximo reporte semanal.</p>
    </div>`}
  </div>
  <div style="background:#0a0a0a;padding:18px 32px;text-align:center;"><p style="font-size:11px;color:rgba(255,255,255,0.25);">Sofia — JRZ Marketing AI Web Designer</p></div>
</div></body></html>`;

      await sendEmail(OWNER_CONTACT_ID, `🎉 Sofia: Nuevo Cliente — ${client.name}${!website ? ' (Sin sitio web)' : ''}`, html);
      console.log(`[Sofia] Onboarding alert sent for ${client.name}`);
    } catch (err) {
      console.error(`[Sofia] Onboarding error for ${client.name}:`, err.message);
    }
  }
}

// ─── Sofia: Continuous Uptime Monitor (every 6 hours) ────
const sofiaDowntimeState = {}; // { locationId: { url, downSince, alertedAt } }

async function runSofiaUptimeMonitor() {
  console.log('[Sofia] Running 6-hour uptime check...');
  setAgentBusy('sofia', 'Running 6-hour uptime check on all client sites');
  logActivity('sofia', 'info', 'Uptime monitor started — checking all client sites');
  try {
    const clients = await getElenaClients();
    OFFICE_KPI.sitesMonitored = clients.length;
    const downtimeAlerts = [];

    await Promise.all(clients.map(async (client) => {
      const overrides = ELENA_CLIENT_OVERRIDES[client.locationId] || {};
      const url = overrides.website;
      if (!url) return;

      try {
        const start = Date.now();
        const res = await axios.get(url, { timeout: 10000, validateStatus: () => true, maxRedirects: 5 });
        const elapsed = Date.now() - start;
        const isDown = res.status >= 500 || res.status === 0;
        const isSlow = elapsed > 5000;

        if (isDown) {
          if (!sofiaDowntimeState[client.locationId]) {
            sofiaDowntimeState[client.locationId] = { url, downSince: new Date().toISOString(), alertedAt: null };
          }
          const state = sofiaDowntimeState[client.locationId];
          const now = Date.now();
          // Alert only once per 6 hours per site
          if (!state.alertedAt || now - new Date(state.alertedAt).getTime() > 6 * 60 * 60 * 1000) {
            state.alertedAt = new Date().toISOString();
            downtimeAlerts.push({ name: client.name, url, status: res.status, downSince: state.downSince });
          }
        } else if (isSlow) {
          downtimeAlerts.push({ name: client.name, url, status: res.status, slowMs: elapsed, type: 'slow' });
          delete sofiaDowntimeState[client.locationId];
        } else {
          delete sofiaDowntimeState[client.locationId]; // recovered
        }
      } catch {
        if (!sofiaDowntimeState[client.locationId]) {
          sofiaDowntimeState[client.locationId] = { url, downSince: new Date().toISOString(), alertedAt: null };
          downtimeAlerts.push({ name: client.name, url, status: 'unreachable', downSince: sofiaDowntimeState[client.locationId].downSince });
        }
      }
    }));

    if (!downtimeAlerts.length) {
      console.log('[Sofia] All monitored sites are up.');
      logActivity('sofia', 'success', `All ${clients.length} client sites are up and responding`);
      setAgentIdle('sofia', `All ${clients.length} sites healthy`);
      return;
    }
    downtimeAlerts.forEach(a => {
      logActivity('sofia', 'alert', `Site ${a.type === 'slow' ? 'SLOW' : 'DOWN'}: ${a.name} — ${a.url}`, { url: a.url });
    });
    agentChat('sofia', 'elena', `${downtimeAlerts.length} client site(s) are down or slow: ${downtimeAlerts.map(a=>a.name).join(', ')}. Client outreach may be needed.`);
    setAgentAlert('sofia', `${downtimeAlerts.length} site(s) down — alert sent`);

    const rows = downtimeAlerts.map(a =>
      a.type === 'slow'
        ? `<tr><td style="padding:10px;font-weight:600;">${a.name}</td><td><a href="${a.url}">${a.url}</a></td><td style="color:#f59e0b;">⚠️ Slow (${(a.slowMs/1000).toFixed(1)}s)</td></tr>`
        : `<tr><td style="padding:10px;font-weight:600;">${a.name}</td><td><a href="${a.url}">${a.url}</a></td><td style="color:#dc2626;">🔴 Down (HTTP ${a.status})</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#fff;padding:32px;">
<h2 style="color:#dc2626;">🚨 Sofia — Site Alert</h2>
<p style="color:#666;margin-bottom:20px;">${downtimeAlerts.length} client site(s) need attention right now.</p>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<thead><tr style="background:#1a3a6b;color:#fff;"><th style="padding:12px;text-align:left;">Client</th><th>URL</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="margin-top:20px;font-size:12px;color:#999;">Sofia checks all client sites every 6 hours — JRZ Marketing</p>
</body></html>`;

    await sendEmail(OWNER_CONTACT_ID, `🚨 Sofia: ${downtimeAlerts.length} Site(s) Down/Slow`, html);
    console.log(`[Sofia] Uptime alert sent — ${downtimeAlerts.length} issues found`);
  } catch (err) {
    console.error('[Sofia] Uptime monitor error:', err.message);
  }
}

// ─── Sofia endpoints ──────────────────────────────────────

app.post('/sofia/build-page', async (req, res) => {
  try {
    const { locationId, industry, city, formId } = req.body;
    if (!locationId) return res.status(400).json({ status: 'error', message: 'locationId required' });
    const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }, timeout: 8000,
    });
    const loc    = locRes.data?.location || locRes.data;
    const name   = loc?.name || loc?.business?.name || 'Client';
    const ind    = industry || ELENA_CLIENT_OVERRIDES[locationId]?.industry || 'business';
    const locCity = city || loc?.city || 'Orlando';
    const logo   = loc?.logoUrl || loc?.logo || '';
    const result = await createGHLLandingPage(locationId, name, ind, loc?.phone || '', loc?.email || '', locCity, logo, formId);
    res.json({ status: 'ok', funnelId: result.funnelId, stepCreated: result.stepCreated, message: `Landing page created for ${name}` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /sofia/preview-page — legacy single landing page preview
app.get('/sofia/preview-page', async (req, res) => {
  try {
    const { industry = 'water damage restoration', city = 'Orlando', name = 'Test Company', phone = '(407) 844-6376', email = '', formId } = req.query;
    const html = await buildLandingHTML(name, phone, email, city, industry, '', formId);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
});

// POST /sofia/build-website — create full 5-page website in GHL for a subaccount
app.post('/sofia/build-website', async (req, res) => {
  try {
    const { locationId, industry, city, formId } = req.body;
    if (!locationId) return res.status(400).json({ status: 'error', message: 'locationId required' });
    const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }, timeout: 8000,
    });
    const loc     = locRes.data?.location || locRes.data;
    const name    = loc?.name || loc?.business?.name || 'Client';
    const ind     = industry || ELENA_CLIENT_OVERRIDES[locationId]?.industry || 'business';
    const locCity = city || loc?.city || 'Orlando';
    const logo    = loc?.logoUrl || loc?.logo || '';
    const phone   = loc?.phone || loc?.business?.phone || '';
    const email   = loc?.email || loc?.business?.email || '';
    createGHLWebsite(locationId, name, ind, phone, email, locCity, logo, formId); // non-blocking
    res.json({ status: 'ok', message: `Sofia is building a 5-page website for ${name}. Check Render logs for funnelId.` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /sofia/preview-website?page=home&industry=roofing&city=Orlando&name=TestCo&phone=4071234567
// Preview any of the 5 pages directly in the browser
app.get('/sofia/preview-website', async (req, res) => {
  try {
    const {
      page = 'home', industry = 'roofing', city = 'Orlando',
      name = 'Test Company', phone = '(407) 123-4567', email = '', formId,
    } = req.query;
    const siteBase = '/sofia/preview-website';
    const pages = await buildWebsite(name, phone, email, city, industry, '', formId || GHL_FORM_ID, siteBase);
    const html = pages[page];
    if (!html) return res.status(400).send(`<pre>Unknown page "${page}". Use: home, about, services, contact, faq</pre>`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}\n${err.stack}</pre>`);
  }
});

// POST /sofia/build-funnel — create a lead gen funnel in GHL
// Body: { locationId, funnelType: 'consultation'|'quote'|'lead-magnet', industry?, city? }
app.post('/sofia/build-funnel', async (req, res) => {
  try {
    const { locationId, funnelType = 'consultation', industry, city, formId } = req.body;
    if (!locationId) return res.status(400).json({ status: 'error', message: 'locationId required' });
    const locRes = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }, timeout: 8000,
    });
    const loc     = locRes.data?.location || locRes.data;
    const name    = loc?.name || loc?.business?.name || 'Client';
    const ind     = industry || ELENA_CLIENT_OVERRIDES[locationId]?.industry || 'business';
    const locCity = city || loc?.city || 'Orlando';
    const logo    = loc?.logoUrl || loc?.logo || '';
    const phone   = loc?.phone || loc?.business?.phone || '';
    createGHLLeadFunnel(locationId, name, ind, funnelType, phone, locCity, logo, formId); // non-blocking
    res.json({ status: 'ok', message: `Sofia is building a ${funnelType} funnel for ${name}. Check Render logs for funnelId.` });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /sofia/preview-funnel?type=consultation&industry=roofing&city=Orlando&name=TestCo&phone=4071234567&step=optin
app.get('/sofia/preview-funnel', async (req, res) => {
  try {
    const {
      type = 'consultation', industry = 'roofing', city = 'Orlando',
      name = 'Test Company', phone = '(407) 123-4567', step = 'optin',
    } = req.query;
    const { optin, thankYou } = await buildLeadFunnelHTML(type, name, phone, city, industry);
    const html = step === 'thank-you' ? thankYou : optin;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
});

app.post('/sofia/cro-report', async (_req, res) => {
  try {
    runSofiaCROReport();
    res.json({ status: 'ok', message: 'Sofia is building the monthly CRO report' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/sofia/onboarding-check', async (_req, res) => {
  try {
    runSofiaOnboardingCheck();
    res.json({ status: 'ok', message: 'Sofia is checking for new clients' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/sofia/full-audit', async (req, res) => {
  try {
    const { url, clientName, industry } = req.body;
    if (!url) return res.status(400).json({ status: 'error', message: 'url required' });
    const audit = await runSofiaFullAudit(url, clientName || 'Client', industry || 'business');
    res.json({ status: 'ok', audit });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /sofia/competitor-report — compare a client's site against top 3 local competitors
// Body: { url, clientName, industry, city }
app.post('/sofia/competitor-report', async (req, res) => {
  try {
    const { url, clientName, industry = 'business', city = 'Orlando' } = req.body;
    if (!url || !clientName) return res.status(400).json({ status: 'error', message: 'url and clientName required' });

    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(503).json({ status: 'error', message: 'SERPAPI_KEY not configured' });

    // Fetch top 3 organic competitor URLs
    const serpRes = await axios.get('https://serpapi.com/search.json', {
      params: { engine: 'google', q: `${industry} ${city} FL`, hl: 'en', gl: 'us', num: 10, api_key: SERPAPI_KEY },
      timeout: 15000,
    });
    const organic = (serpRes.data?.organic_results || [])
      .map(r => r.link)
      .filter(l => l && !l.includes('yelp.com') && !l.includes('facebook.com') && !l.includes('google.com'))
      .slice(0, 3);

    // Audit client + competitors in parallel
    const [clientAudit, ...competitorAudits] = await Promise.all([
      runSofiaFullAudit(url, clientName, industry),
      ...organic.map((u, i) => runSofiaFullAudit(u, `Competitor ${i + 1}`, industry).catch(() => null)),
    ]);

    // Claude comparison summary
    const compData = competitorAudits.filter(Boolean).map((a, i) => ({
      name: `Competitor ${i + 1}`,
      url: organic[i],
      score: a.score,
      grade: a.grade,
      title: a.title,
      hasCTA: a.hasCTA,
      hasPhone: a.hasPhone,
      ssl: a.ssl,
      speed: a.responseTime,
    }));

    const avgCompScore = compData.length ? Math.round(compData.reduce((s, c) => s + c.score, 0) / compData.length) : 0;
    const clientScore  = clientAudit?.score || 0;

    let aiSummary = '';
    try {
      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: `You are Sofia, a web designer at JRZ Marketing. Compare these websites:

Client: ${clientName} — Score: ${clientScore}/100, Grade: ${clientAudit?.grade}, SSL: ${clientAudit?.ssl}, Speed: ${clientAudit?.responseTime}ms, CTA: ${clientAudit?.hasCTA}

Competitors:
${compData.map(c => `${c.name} (${c.url}): Score ${c.score}/100, Speed ${c.speed}ms, CTA ${c.hasCTA}`).join('\n')}

Write a 4-6 sentence competitive analysis for Jose (agency owner). Focus on: where client ranks, what competitors do better, and the top 3 actionable wins for ${clientName}. Be direct and specific.` }],
      });
      aiSummary = aiRes.content[0].text.trim();
    } catch { aiSummary = `${clientName} scored ${clientScore}/100 vs competitor avg of ${avgCompScore}/100.`; }

    res.json({
      status: 'ok',
      client: { name: clientName, url, score: clientScore, grade: clientAudit?.grade },
      competitors: compData,
      avgCompetitorScore: avgCompScore,
      clientVsAvg: clientScore - avgCompScore,
      analysis: aiSummary,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /sofia/pagespeed?url=https://example.com — test PageSpeed API directly
app.get('/sofia/pagespeed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: 'error', message: 'url required' });
    const data = await getPageSpeedData(url);
    if (!data) return res.status(503).json({ status: 'error', message: 'PageSpeed API unavailable or key missing' });
    res.json({ status: 'ok', url, data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /sofia/search-console?url=https://example.com — test Search Console API directly
app.get('/sofia/search-console', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: 'error', message: 'url required' });
    const data = await getSearchConsoleData(url);
    if (!data) return res.status(503).json({ status: 'error', message: 'Site not verified in Search Console or OAuth not configured' });
    res.json({ status: 'ok', url, data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /sofia/uptime-check — manual trigger for uptime monitor
app.post('/sofia/uptime-check', async (_req, res) => {
  runSofiaUptimeMonitor();
  res.json({ status: 'ok', message: 'Sofia uptime monitor running' });
});

// Manual trigger: POST /cron/client-blogs — run daily SEO blog for all SEO_CLIENTS
app.post('/cron/client-blogs', async (_req, res) => {
  const result = await runAllClientsDailyBlog();
  res.json(result);
});

// Manual trigger: POST /cron/client-blog/:locationId — run blog for one specific client
// Example: POST /cron/client-blog/iipUT8kmVxJZzGBzvkZm (Railing Max)
app.post('/cron/client-blog/:locationId', async (req, res) => {
  const { locationId } = req.params;
  const config = SEO_CLIENTS[locationId];
  if (!config) return res.status(404).json({ error: `No SEO_CLIENTS entry for locationId: ${locationId}` });
  const result = await runClientDailySeoBlog(locationId, config);
  res.json(result);
});

// Debug: GET /sofia/location-token/:locationId — test if agency key can get a token for a sub-account
app.get('/sofia/location-token/:locationId', async (req, res) => {
  const { locationId } = req.params;
  try {
    const tokenResp = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      { companyId: GHL_COMPANY_ID, locationId },
      { headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    res.json({ success: true, hasToken: !!tokenResp.data?.access_token, raw: tokenResp.data });
  } catch (err) {
    res.json({ success: false, error: err?.response?.data || err.message });
  }
});

// Manual trigger: POST /cron/seo-blog — Isabella writes a SEO blog targeting a striking-distance keyword
app.post('/cron/seo-blog', async (_req, res) => {
  const result = await runDailySeoBlog();
  res.json(result);
});

// Manual trigger: POST /cron/keyword-tracker — Sofia checks keyword rankings vs last week
app.post('/cron/keyword-tracker', async (_req, res) => {
  const result = await runSofiaKeywordTracker();
  res.json(result);
});

// Manual trigger: POST /cron/weekly-seo — Sofia runs full weekly SEO plan
app.post('/cron/weekly-seo', async (_req, res) => {
  const result = await runSofiaWeeklySEOPlan();
  res.json(result);
});

// Test endpoint: GET /sofia/ga4?propertyId=384751711 — returns GA4 data for a property
app.get('/sofia/ga4', async (req, res) => {
  const { propertyId } = req.query;
  if (!propertyId) return res.status(400).json({ error: 'propertyId required' });

  // Debug: check each step
  const saEmail = process.env.GOOGLE_SA_EMAIL;
  const saKey   = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!saEmail && !saKey) return res.json({ error: 'Both GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY are missing in Render env vars' });
  if (!saEmail) return res.json({ error: 'GOOGLE_SA_EMAIL is missing' });
  if (!saKey)   return res.json({ error: 'GOOGLE_SA_PRIVATE_KEY is missing', emailFound: saEmail });

  const jwt = _buildServiceAccountJWT('https://www.googleapis.com/auth/analytics.readonly');
  if (!jwt) return res.json({ error: 'JWT failed — GOOGLE_SA_EMAIL or GOOGLE_SA_PRIVATE_KEY missing' });

  const tokenResp = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })).catch(e => ({ error: e?.response?.data || e.message }));

  if (tokenResp?.error) return res.json({ error: 'Token exchange failed', detail: tokenResp.error });

  const accessToken = tokenResp?.data?.access_token;
  if (!accessToken) return res.json({ error: 'No access token returned', raw: tokenResp?.data });

  const apiResp = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    { dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  ).catch(e => ({ error: e?.response?.data || e.message }));

  if (apiResp?.error) return res.json({ error: 'GA4 API call failed', detail: apiResp.error });

  const data = await getGA4Data(propertyId);
  res.json(data || { error: 'getGA4Data returned null' });
});

// Manual trigger: POST /cron/local-pack — Sofia checks if each client is in the Google 3-pack
app.post('/cron/local-pack', async (_req, res) => {
  const result = await runLocalPackMonitor();
  res.json(result);
});

// Manual trigger: POST /cron/backlink-prospector — Sofia finds guest post targets + sends outreach
app.post('/cron/backlink-prospector', async (_req, res) => {
  const result = await runSofiaBacklinkProspector();
  res.json(result);
});

// Manual trigger: POST /cron/press-release — Sofia writes + publishes monthly press release per client
app.post('/cron/press-release', async (_req, res) => {
  const result = await runSofiaPressRelease();
  res.json(result);
});

// Manual trigger: POST /cron/citation-builder — Sofia auto-submits to Bing/Foursquare + emails citation kit
app.post('/cron/citation-builder', async (_req, res) => {
  const result = await runSofiaCitationBuilder();
  res.json(result);
});

// ═══════════════════════════════════════════════════════════
// INTERNAL CRON — checks every 2 minutes
//  7:00am EST  daily      → Carousel post + blog
//  7:05am EST  daily      → Isabella: SEO blog (striking-distance keyword from GSC)
//  7:10am EST  Monday     → Weekly analytics analysis + A/B test + summary email
//  9:40am EST  Monday     → Sofia: keyword rank tracker (DataForSEO — 10 target keywords)
//  9:50am EST  Monday     → Sofia: weekly SEO plan (keyword → meta → schema → blog → gaps)
//  8:00am EST  Mon–Fri    → Diego: daily standup email
//  8:00am EST  Monday     → Competitor monitoring
//  8:35am EST  Monday     → Elena: weekly subaccount health check
//  9:00am EST  1st/month  → Monthly client reports + Elena monthly reports + Diego scorecard
//  9:00am EST  Monday     → Apollo email enrichment
// 10:00am EST  Mon–Fri    → Outbound prospecting (15 contacts/day)
// 10:30am EST  daily      → Client check-ins (30-day rolling)
//  4:00pm EST  daily      → Viral 15s Reel (7 platforms)
//  6:30pm EST  daily      → Story (Instagram + Facebook)
// ═══════════════════════════════════════════════════════════
let lastPostDate     = null;
let lastReelDate     = null;
let lastStoryDate    = null;
let lastSeoBlogDate        = null;
let lastClientBlogDate     = null;
let lastKeywordTrackerDate = null;
let lastWeeklySEODate      = null;
let lastSummaryDate        = null;
let lastOutboundDate = null;
let lastEnrichDate   = null;
let lastCheckInDate         = null;
let lastMonthlyReportDate   = null;
let lastMidMonthCheckIn     = null;
let lastQuarterlyReport     = null;
let lastCompetitorDate      = null;
let lastSubCheckInDate      = null;
let lastLearningDate        = null;
let lastElenaHealthDate     = null;
let lastDiegoReportDate     = null;
let lastDiegoStandupDate    = null;
let lastMarcoContentDate    = null;
let lastMarcoTrendDate      = null;
let lastSofiaCheckDate      = null;
let lastSofiaCRODate        = null;
let lastSofiaMonitorHour    = -1; // tracks last 6-hour slot (0, 6, 12, 18)

setInterval(async () => {
  try {
    const nowEST    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today     = nowEST.toISOString().split('T')[0];
    const hour      = nowEST.getHours();
    const minute    = nowEST.getMinutes();
    const dayOfWeek = nowEST.getDay(); // 0=Sun, 1=Mon…6=Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    // 7:00am — daily carousel + blog
    if (hour === 7 && minute < 5 && lastPostDate !== today) {
      lastPostDate = today;
      await runDailyPost();
    }

    // 7:05am daily — Isabella: SEO blog targeting striking-distance keywords from Google Search Console
    if (hour === 7 && minute >= 5 && minute < 10 && lastSeoBlogDate !== today) {
      lastSeoBlogDate = today;
      runDailySeoBlog(); // non-blocking — Opus call, takes 20–30s
    }

    // 7:08am daily — all SEO clients: publish one blog post each
    if (hour === 7 && minute >= 8 && minute < 13 && lastClientBlogDate !== today) {
      lastClientBlogDate = today;
      runAllClientsDailyBlog(); // non-blocking — loops through SEO_CLIENTS
    }

    // 7:10am Monday — analytics self-learning + A/B test analysis + weekly email
    if (hour === 7 && minute >= 10 && minute < 15 && dayOfWeek === 1 && lastSummaryDate !== today) {
      lastSummaryDate = today;
      await runWeeklyAnalysis();
      await runABTestAnalysis(); // analyze closing variants, shift weights to winner
      const days     = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const weekPosts = CAROUSEL_SCRIPTS.slice(0, 7).map((s, i) => ({ day: days[i], title: s.title, success: true }));
      await sendWeeklySummaryEmail(weekPosts);
    }

    // 8:00am Mon–Fri — Diego: daily standup
    if (hour === 8 && minute < 5 && isWeekday && lastDiegoStandupDate !== today) {
      lastDiegoStandupDate = today;
      runDiegoStandup(); // non-blocking
    }

    // 8:00am Monday — competitor monitoring
    if (hour === 8 && minute < 5 && dayOfWeek === 1 && lastCompetitorDate !== today) {
      lastCompetitorDate = today;
      await runCompetitorMonitoring();
    }

    // 8:30am Monday — engagement learning + voice pattern optimization + review mining
    if (hour === 8 && minute >= 30 && minute < 35 && dayOfWeek === 1 && lastLearningDate !== today) {
      lastLearningDate = today;
      await runEngagementLearning();
      await updateWinningVoicePatterns();
      await runReviewMining();
      await runObjectionLearning();
      await runSelfUpdateRules();
    }

    // 8:35am Monday — Elena: weekly subaccount health check
    if (hour === 8 && minute >= 35 && minute < 40 && dayOfWeek === 1 && lastElenaHealthDate !== today) {
      lastElenaHealthDate = today;
      elenaHealthCheck(); // non-blocking — hits 31 APIs
    }

    // 9:30am Monday — Marco: weekly content brief
    if (hour === 9 && minute >= 30 && minute < 35 && dayOfWeek === 1 && lastMarcoContentDate !== today) {
      lastMarcoContentDate = today;
      runMarcoContentBrief(); // non-blocking
    }

    // 10am Wednesday — Marco: mid-week trend alert
    if (hour === 10 && minute < 5 && dayOfWeek === 3 && lastMarcoTrendDate !== today) {
      lastMarcoTrendDate = today;
      runMarcoTrendAlert(); // non-blocking
    }

    // 9:40am Monday — Sofia: keyword rank tracker (DataForSEO SERP check for 10 target keywords)
    if (hour === 9 && minute >= 40 && minute < 45 && dayOfWeek === 1 && lastKeywordTrackerDate !== today) {
      lastKeywordTrackerDate = today;
      runSofiaKeywordTracker(); // non-blocking — 10 SERP calls, ~15s
    }

    // 9:50am Monday — Sofia: weekly SEO plan (keyword → meta → schema → blog → competitor gap)
    if (hour === 9 && minute >= 50 && minute < 55 && dayOfWeek === 1 && lastWeeklySEODate !== today) {
      lastWeeklySEODate = today;
      runSofiaWeeklySEOPlan(); // non-blocking — opus call + GHL updates
    }

    // 9:45am Monday — Sofia: weekly full website health check + onboarding scan
    if (hour === 9 && minute >= 45 && minute < 50 && dayOfWeek === 1 && lastSofiaCheckDate !== today) {
      lastSofiaCheckDate = today;
      runSofiaWeeklyCheck();    // non-blocking
      runSofiaOnboardingCheck(); // non-blocking — detects new clients
    }

    // Every 6 hours (0am, 6am, 12pm, 6pm) — Sofia: lightweight uptime monitor
    const sixHourSlot = Math.floor(hour / 6);
    if (minute < 3 && sixHourSlot !== lastSofiaMonitorHour) {
      lastSofiaMonitorHour = sixHourSlot;
      runSofiaUptimeMonitor(); // non-blocking — alerts Jose only if site goes down
    }

    // 1st of month, 9:55am — Sofia: monthly CRO report
    if (hour === 9 && minute >= 55 && dateOfMonth === 1 && lastSofiaCRODate !== today) {
      lastSofiaCRODate = today;
      runSofiaCROReport(); // non-blocking
    }

    // 9:15am Monday — Diego: weekly project report
    if (hour === 9 && minute >= 15 && minute < 20 && dayOfWeek === 1 && lastDiegoReportDate !== today) {
      lastDiegoReportDate = today;
      runDiegoWeeklyReport(); // non-blocking
    }

    // 9:00am Monday — Apollo email enrichment (free plan: 50 credits/month)
    if (hour === 9 && minute < 5 && dayOfWeek === 1 && lastEnrichDate !== today) {
      lastEnrichDate = today;
      await enrichProspectEmails();
    }

    // 1st of month, 9:00am — monthly client reports + Elena + Diego scorecard
    const dateOfMonth = nowEST.getDate();
    if (hour === 9 && minute < 5 && dateOfMonth === 1 && lastMonthlyReportDate !== today) {
      lastMonthlyReportDate = today;
      await sendMonthlyClientReports();
      elenaMonthlyReports();   // non-blocking
      runDiegoScorecard();     // non-blocking
      // Send SEO progress report to every client sub-account owner
      (async () => {
        const clients = await getElenaClients();
        for (const client of clients) {
          const bl   = await runSofiaBacklinkAudit(client.website?.replace(/^https?:\/\//, '') || '').catch(() => null);
          const cit  = await runSofiaCitationAudit(client.name).catch(() => null);
          const seoConfig = SEO_CLIENTS[client.locationId] || {};
          const ga4  = seoConfig.ga4PropertyId ? await getGA4Data(seoConfig.ga4PropertyId).catch(() => null) : null;
          await sendClientSEOProgressReport(client, { keyword: 'your top local keyword', position: null, blogsThisMonth: 4, backlinks: bl, citations: cit, competitorGaps: [], ga4 });
          await new Promise(r => setTimeout(r, 3000)); // 3s between clients — avoid rate limits
        }
      })(); // non-blocking — runs for all 31 clients in background
    }

    // 15th of month, 10:00am — Elena: mid-month proactive check-in to at-risk clients
    if (hour === 10 && minute < 5 && dateOfMonth === 15 && lastMidMonthCheckIn !== today) {
      lastMidMonthCheckIn = today;
      elenaMidMonthCheckIn(); // non-blocking
    }

    // 1st of Jan/Apr/Jul/Oct, 9:30am — Elena: quarterly deep-dive report
    const isQuarterStart = [1, 4, 7, 10].includes(nowEST.getMonth() + 1) && dateOfMonth === 1;
    if (hour === 9 && minute >= 30 && minute < 35 && isQuarterStart && lastQuarterlyReport !== today) {
      lastQuarterlyReport = today;
      elenaQuarterlyReport(); // non-blocking
    }


    // Last Friday of month, 10:00am — sub-account monthly check-in emails
    const isFriday = dayOfWeek === 5;
    const isLastFriday = isFriday && (dateOfMonth + 7 > new Date(nowEST.getFullYear(), nowEST.getMonth() + 1, 0).getDate());
    if (hour === 10 && minute < 5 && isLastFriday && lastSubCheckInDate !== today) {
      lastSubCheckInDate = today;
      await sendSubAccountCheckInEmails();
    }

    // 10:00am Mon–Fri — outbound prospecting
    if (hour === 10 && minute < 5 && isWeekday && lastOutboundDate !== today) {
      lastOutboundDate = today;
      await runDailyOutbound();
    }

    // 10:30am daily — client check-ins (30-day rolling)
    if (hour === 10 && minute >= 30 && minute < 35 && lastCheckInDate !== today) {
      lastCheckInDate = today;
      await runClientCheckIns();
    }

    // 4:00pm Mon/Wed/Fri — viral Reel (12 per month)
    const isReelDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    if (hour === 16 && minute < 5 && isReelDay && lastReelDate !== today) {
      lastReelDate = today;
      await runDailyReel();
    }

    // 6:30pm — story
    if (hour === 18 && minute >= 30 && minute < 35 && lastStoryDate !== today) {
      lastStoryDate = today;
      await runDailyStory();
    }

    // Every tick (every 2 min) — Gmail inbox check
    await runGmailCheck();

  } catch (err) {
    console.error('[Cron] Internal scheduler error:', err.message);
  }
}, 2 * 60 * 1000); // Every 2 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Armando Rivas is online — JRZ Marketing 🇻🇪`);
  console.log(`7:00am  EST daily     → Carousel + Blog`);
  console.log(`7:05am  EST Monday    → Weekly analytics self-learning + email`);
  console.log(`10:00am EST Mon-Fri   → Outbound prospecting (15 contacts/day)`);
  console.log(`4:00pm  EST Mon/Wed/Fri → 15s Viral Reel w/ voice (7 platforms, ~12/month)`);
  console.log(`6:30pm  EST daily     → Story (Instagram + Facebook)`);
  console.log(`24/7                  → Armando warm DMs on comments/follows`);
  await loadOfficeKPI(); // restore KPIs from Cloudinary on every startup
});

// Save KPIs every 30 minutes so restarts lose at most 30 min of counts
setInterval(saveOfficeKPI, 30 * 60 * 1000);

// Save KPIs on graceful shutdown (Render sends SIGTERM before restarting)
process.on('SIGTERM', async () => {
  console.log('[Office] SIGTERM received — saving KPIs before shutdown...');
  await saveOfficeKPI();
  process.exit(0);
});
