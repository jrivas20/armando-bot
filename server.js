const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

// ─── Google Ads Service ───────────────────────────────────────────────────────
const googleAds = require('../meta-ai-engine/services/google-ads-service');

// ─── Shared helpers (retry, cron logging, build hash) ────────────────────────
const {
  SERVER_START_TIME, BUILD_HASH,
  withRetry,
  CRON_STATUS, logCron, runCron,
  setCronErrorHandler,
} = require('./modules/helpers');

// ─── Data modules (edit client configs, scripts, IDs here) ───────────────────
const { SEO_CLIENTS, getTodaysCity } = require('./modules/clients');
const { CAROUSEL_SCRIPTS, STORY_TEMPLATES, getTodaysScript } = require('./modules/scripts');
const { getPersona, hasPersona } = require('./modules/personas');
const {
  GHL_LOCATION_ID, GHL_USER_ID,
  MARKETING_PIPELINE_ID, PIPELINE_STAGES,
  BLOG_ID, BLOG_AUTHOR_ID, BLOG_CATEGORIES,
  SOCIAL_ACCOUNTS, TEXT_POST_ACCOUNTS, REEL_ACCOUNTS, STORY_ACCOUNTS,
  CAROUSEL_IMAGES,
  GBP_POST_TYPES,
} = require('./modules/constants');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GHL_API_KEY   = process.env.GHL_API_KEY;
const NEWS_API_KEY  = process.env.NEWS_API_KEY  || 'dff54f64e9eb4087aa7c215a1c674644';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || 'pHTTmBc8ljBQFxaa0YcUQQ';
const DATASEO_LOGIN    = process.env.DATASEO_LOGIN    || 'info@jrzmarketing.com';
const DATASEO_PASSWORD = process.env.DATASEO_PASSWORD || 'cc9f762c50b0cc57';
const DATASEO_AUTH     = Buffer.from(`${DATASEO_LOGIN}:${DATASEO_PASSWORD}`).toString('base64');
const BOOKING_URL = 'https://jrzmarketing.com/contact-us';
const OWNER_CONTACT_ID = process.env.OWNER_CONTACT_ID || 'hywFWrMca0eSCse2Wjs8';
const GHL_FORM_ID = process.env.GHL_FORM_ID || '5XhL0vWCuJ59HWHQoHGG'; // universal lead capture form

// ── Meta Ads — LiftMo campaign monitor ────────────────────
// Long-lived token — expires June 17, 2026
const META_ACCESS_TOKEN = 'EAAYoO6CtmWIBRCIaAkifvEXjdS5ZBQcglwIAhCnFwWm0EUZBO9KNGgiLjnPKEQJJ19YAjkwePAZBQ9zkENrAiqil0WqyyXZB9WF6A1uQkjcDRJT7F7bMZByZCsGFLZAOPZBriGjecrW7qrFFQEcW47kGPU18NAFUy5wJzSRBvlfKXIsVM78aR4SJGiSWB0RYagqkHwizPr9nI6iIASD7';
const META_AD_ACCOUNT = 'act_2569067933237980';
const META_CAMPAIGNS = {
  c2_cart_abandoners: { id: '120243790415910078', adset_id: '120243790455760078', name: 'Cart Abandoners', budget: 1000 },
  c3_web_visitors:    { id: '120243790415450078', adset_id: '120243790454730078', name: 'Web Visitors 30d', budget: 500 },
  c1_cold_traffic:    { id: '120243790416100078', adset_id: '120243790456680078', name: 'Cold Traffic TOFU', budget: 1000 }
};

// ─── Blocked usernames — Armando will never message these ────────────────────
const BLOCKED_USERS = [
  'luisadlc_',
];

// ── GHL Agency (all subaccounts) ───────────────────────────
const GHL_AGENCY_KEY = process.env.GHL_AGENCY_KEY || 'pit-7a8b4631-2249-4683-b15b-57a661400caa';
const GHL_COMPANY_ID = 'VMjVKN63tXxZxQ21jlC4';

// ── Diego constants ────────────────────────────────────────
const STALE_DAYS = 14; // flag deals with no activity for 14+ days
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
const GOOGLE_PLACES_API_KEY   = process.env.GOOGLE_PLACES_API_KEY   || 'AIzaSyC1ra5_WT5mE6QJr64HDrVixFHbionXUkM';
const GOOGLE_INDEXING_BASE    = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const GOOGLE_PLACES_BASE      = 'https://maps.googleapis.com/maps/api';
const GOOGLE_OAUTH2_CLIENT_ID = process.env.GOOGLE_OAUTH2_CLIENT_ID || '';
const GOOGLE_OAUTH2_SECRET    = process.env.GOOGLE_OAUTH2_SECRET    || '';

// ── Pexels — free stock photos for blog posts ────────────────
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || 'KKnsOB57rfTFv5cuySAq8I9xm0ek6AiKZo4xeOURePlXJvnnw4EDbBdg';

// ── SEO-enabled sub-accounts ───────────────────────────────
// Central Florida cities — rotated daily so every blog targets a different city.
// 30 cities = 30 unique geo-targeted posts per month per client = page 1 across all of Central FL.

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

// ─────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
// ARMANDO DM BOT — IN-MEMORY STATE
// All sets/maps are persisted to Cloudinary every 5 min and
// restored on startup so restarts don't lose conversation state.
// ═══════════════════════════════════════════════════════════
const contactMessageCount = new Map();
const repliedMessageIds = new Set();
const knownContactInfo = new Map();
const thankYouEmailSent = new Set();
const alertEmailSent = new Set();

const DM_STATE_PID = 'jrz/dm_state';
const DM_STATE_URL = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/${DM_STATE_PID}.json`;

async function loadDMState() {
  try {
    const res = await axios.get(DM_STATE_URL + '?t=' + Date.now(), { timeout: 8000 });
    const saved = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (saved.repliedMessageIds)    saved.repliedMessageIds.forEach(id => repliedMessageIds.add(id));
    if (saved.thankYouEmailSent)    saved.thankYouEmailSent.forEach(id => thankYouEmailSent.add(id));
    if (saved.alertEmailSent)       saved.alertEmailSent.forEach(id => alertEmailSent.add(id));
    if (saved.contactMessageCount)  saved.contactMessageCount.forEach(([k, v]) => contactMessageCount.set(k, v));
    console.log(`[DMState] Restored: ${repliedMessageIds.size} replied, ${alertEmailSent.size} alerted, ${contactMessageCount.size} contacts`);
  } catch { console.log('[DMState] No saved state — starting fresh.'); }
}

async function saveDMState() {
  try {
    const data = {
      repliedMessageIds: [...repliedMessageIds].slice(-2000), // keep last 2000 to cap size
      thankYouEmailSent: [...thankYouEmailSent],
      alertEmailSent:    [...alertEmailSent],
      contactMessageCount: [...contactMessageCount.entries()],
      savedAt: new Date().toISOString(),
    };
    await saveCloudinaryJSON(DM_STATE_PID, data);
    console.log('[DMState] Saved to Cloudinary.');
  } catch (err) { console.error('[DMState] Save failed:', err.message); }
}

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

// prefetched = { history: [...], contact: { phone, email } } — passed from webhook to avoid duplicate GHL calls
async function getArmandoReply(incomingMessage, contactName, contactId, conversationId, channel = 'IG', prefetched = {}) {
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

  // Use pre-fetched contact info if available — avoids a duplicate GHL API call
  const ghlContact = prefetched.contact || await getGHLContact(contactId);
  foundPhone = ghlContact.phone || null;
  foundEmail = ghlContact.email || null;

  // Use pre-fetched history if available — avoids a duplicate GHL API call
  const messages = prefetched.history || (conversationId ? await getConversationHistory(conversationId) : []);
  if (messages.length) {
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

  // Use persona-specific prompt if passed in (multi-tenant), otherwise default Armando
  const basePrompt = prefetched.systemPrompt || ARMANDO_PROMPT;
  const systemWithContext = `${basePrompt}

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

async function sendGHLReply(contactId, message, sendType, apiKey = GHL_API_KEY) {
  await axios.post(
    'https://services.leadconnectorhq.com/conversations/messages',
    { type: sendType, contactId, message },
    { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
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
    // invalidate=true flushes CDN cache so all edge nodes serve fresh data immediately
    const sigStr = `invalidate=true&overwrite=true&public_id=${publicId}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
    const sig    = crypto.createHash('sha1').update(sigStr).digest('hex');
    const form   = new FormData();
    const buf    = Buffer.from(JSON.stringify(data, null, 2));
    form.append('file', buf, { filename: `${publicId.split('/').pop()}.json`, contentType: 'application/json' });
    form.append('public_id', publicId); form.append('resource_type', 'raw');
    form.append('timestamp', String(ts)); form.append('api_key', CLOUDINARY_API_KEY);
    form.append('signature', sig); form.append('overwrite', 'true');
    form.append('invalidate', 'true');
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
      { params: { skip: 0, limit: 50, status: 'published' }, headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' }, timeout: 15000 }
    );
    const posts = (res.data?.posts || res.data?.data || []).filter(p => p.caption || p.description);
    if (posts.length < 3) { console.log('[Learning] Not enough posts to analyze'); return; }

    // Score each post by real engagement (likes + comments + shares + views/10)
    const scored = posts.map(p => {
      const e = p.engagement || p.analytics || {};
      const score = (e.likes || e.likeCount || 0)
                  + (e.comments || e.commentCount || 0) * 2   // comments = stronger signal
                  + (e.shares || e.shareCount || 0) * 3       // shares = strongest signal
                  + Math.floor((e.views || e.viewCount || e.impressions || 0) / 10);
      return { caption: p.caption || p.description || '', score, type: p.type || 'post', platform: p.platform || '' };
    });

    // Sort: top performers first, then take worst performers to learn what to avoid
    scored.sort((a, b) => b.score - a.score);
    const topPosts  = scored.slice(0, 5);
    const flops     = scored.slice(-3).filter(p => p.score === 0);

    const topSummary  = topPosts.map((p, i) => `#${i+1} (score ${p.score}): ${p.caption.slice(0, 200)}`).join('\n---\n');
    const flopSummary = flops.length ? flops.map(p => p.caption.slice(0, 100)).join('\n---\n') : 'none';

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 500,
      messages: [{ role: 'user', content: `Eres el director de contenido de JRZ Marketing. Analiza estos datos de engagement real y extrae los patrones ganadores.

TOP POSTS (mayor engagement):
${topSummary}

POSTS QUE NO FUNCIONARON:
${flopSummary}

Devuelve SOLO JSON válido:
{"topHooks":["hook ganador 1","hook ganador 2","hook ganador 3"],"contentAngles":["ángulo que funciona 1","ángulo 2"],"emotionalTriggers":["disparador emocional 1","disparador 2"],"avoidPatterns":["patrón a evitar 1","patrón 2"],"weeklyInsight":"observación clave sobre qué funciona esta semana"}` }]
    });
    const parsed = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)[0]);
    parsed.updatedAt = new Date().toISOString();
    parsed.topPostScores = topPosts.map(p => ({ score: p.score, hook: p.caption.slice(0, 80) }));
    await saveEngagementPatterns(parsed);
    console.log('[Learning] ✅ Engagement patterns updated from real data — top post score:', topPosts[0]?.score || 0);
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
const websitePackageCache = new Map(); // cacheId → { pages, clientName, expires }

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

// Exchange agency key for a location-level OAuth token (scoped for Blog API write access)
// PITs do not have blogs.write scope — GHL Blog API returns 403 unless you use an OAuth token.
const _jrzTokenCache = { token: null, expires: 0 };
async function getJRZOAuthToken() {
  if (_jrzTokenCache.token && Date.now() < _jrzTokenCache.expires) return _jrzTokenCache.token;
  try {
    const res = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      { companyId: GHL_COMPANY_ID, locationId: GHL_LOCATION_ID },
      { headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const token = res.data?.access_token;
    if (token) {
      _jrzTokenCache.token = token;
      _jrzTokenCache.expires = Date.now() + 23 * 60 * 60 * 1000;
      console.log('[Blog] ✅ OAuth token exchanged for JRZ Marketing');
      return token;
    }
  } catch (err) {
    console.error('[Blog] ⚠️ OAuth exchange failed, falling back to PIT key:', err?.response?.data?.message || err.message);
  }
  return GHL_API_KEY; // fallback
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

    const blogToken = await getJRZOAuthToken();
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
          Authorization: `Bearer ${blogToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    const blogId = res.data?.blogPost?._id;
    console.log(`[Blog] ✅ Blog post published: "${topic}" — ID: ${blogId}`);

    // Submit to Google Indexing API immediately after publish
    const blogUrl = `https://jrzmarketing.com/post/${blogId}`;
    submitToGoogleIndexing(blogUrl); // non-blocking

    return { success: true, title: topic, id: blogId };
  } catch (err) {
    console.error('[Blog] ❌ Failed to create blog post:', err?.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// ─── GOOGLE INDEXING API ─────────────────────────────────────────────────────
// Submits a URL to Google for immediate crawling after blog publish.
// Free — 200 submissions/day. Fires after every blog post created.
async function submitToGoogleIndexing(url) {
  if (!GOOGLE_REFRESH_TOKEN) {
    console.log('[Indexing] Skipped — GOOGLE_REFRESH_TOKEN not set');
    return false;
  }
  try {
    // Step 1: Exchange refresh token for access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_OAUTH2_CLIENT_ID,
      client_secret: GOOGLE_OAUTH2_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    });
    const accessToken = tokenRes.data.access_token;

    // Step 2: Submit URL to Google Indexing API
    await axios.post(GOOGLE_INDEXING_BASE,
      { url, type: 'URL_UPDATED' },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    console.log(`[Indexing] ✅ Submitted to Google: ${url}`);
    return true;
  } catch (err) {
    console.error('[Indexing] ❌ Failed:', err?.response?.data || err.message);
    return false;
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

    // Submit to Google Indexing API immediately after publish
    const postUrl = `https://jrzmarketing.com/post/${postId}`;
    submitToGoogleIndexing(postUrl); // non-blocking

    // Save to blog history for learning loop (JRZ Marketing)
    loadBlogHistory().then(hist => {
      if (!hist['d7iUPfamAaPlSBNj6IhT']) hist['d7iUPfamAaPlSBNj6IhT'] = [];
      hist['d7iUPfamAaPlSBNj6IhT'].push({ keyword: targetKeyword, baseKeyword: targetKeyword.split(' ').slice(0,3).join(' '), title, url: `https://jrzmarketing.com/post/${postId}`, date: new Date().toISOString().split('T')[0], clicks: null, impressions: null, position: null, gscChecked: false });
      return saveBlogHistory(hist);
    }).catch(() => null);

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

  // Instagram daily post disabled — user paused 2026-03-26
  const instagramResult = { success: false, skipped: true, reason: 'Instagram paused' };

  // ── Blog post (English, published same day) ──
  const blogResult = await createDailyBlog(title, caption);

  return { social: socialResult, instagram: instagramResult, blog: blogResult };
}

// Schedule today's story at 7pm EST
async function runDailyStory() {
  console.log('[Social] Running daily story scheduler...');

  const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek.substring(0, 3));
  const idx = dayIndex >= 0 ? dayIndex : new Date().getDay();
  const template = STORY_TEMPLATES[idx];

  // Schedule for 7pm EST today — 23:00 UTC works for EDT (UTC-4)
  const storyTime = new Date();
  storyTime.setUTCHours(23, 0, 0, 0);
  if (storyTime < new Date()) {
    storyTime.setDate(storyTime.getDate() + 1);
  }

  // Stories require at least one image — use first carousel image for today
  const todayImages = CAROUSEL_IMAGES[idx];
  const storyMedia = [{ url: todayImages[0], type: 'image/png' }];

  try {
    const result = await schedulePost({
      caption: template.text,
      accountIds: STORY_ACCOUNTS,
      type: 'story',
      scheduleDate: storyTime,
      media: storyMedia,
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
  const raw = msg.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in reel content response');
  return JSON.parse(match[0]);
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
    return { success: false, error: `Content generation failed: ${err.message}` };
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
// PROXY — LUIS FARRERA BOOKING FORM → GHL CONTACTS API
// Creates contact + note directly via GHL API (bypasses CSP)
// ═══════════════════════════════════════════════════════════
const LF_API_KEY        = 'pit-23df4abd-73d1-4fd4-895d-4d4d7c48c8c8';
const LF_LOCATION_ID    = 'Q6FIvQ5WitCeq9wyXZ3L';
const LF_PIPELINE_ID       = 'vQ5x2R2Yoq4wHkrJMSTQ';   // Book Now pipeline
const LF_STAGE_NEW_INQUIRY = '46c5d35a-bd61-456a-bca6-056884aeab21'; // 🔵 New Inquiry
const LF_BOOKING_MANAGER   = 'Mx0nS4g8fx9NKleC9wV1';   // Gustavo Leon — booking manager
const LF_GHL_HEADERS = {
  'Authorization': `Bearer ${LF_API_KEY}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json'
};

app.post('/proxy/lf-booking', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  const { full_name, first_name, last_name, phone, email, concept, placement, size, timeline, best_time, source } = req.body;
  try {
    // Step 1: Create or update contact
    const contactRes = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      {
        locationId: LF_LOCATION_ID,
        firstName:  first_name || full_name || '',
        lastName:   last_name  || '',
        email:      email      || '',
        phone:      phone      || '',
        source:     source     || 'Luis Farrera Booking Form',
        tags:       ['booking-form', 'new-inquiry'],
        assignedTo: LF_BOOKING_MANAGER
      },
      { headers: LF_GHL_HEADERS }
    );
    const contactId = contactRes.data?.contact?.id;
    console.log(`[LF Booking] Contact created: ${contactId}`);

    // Step 2: Add note with tattoo details
    if (contactId) {
      const noteBody = [
        `📋 BOOKING REQUEST — Luis Farrera Tattoo`,
        ``,
        `Tattoo concept: ${concept || '—'}`,
        `Placement: ${placement || '—'}`,
        `Size: ${size || '—'}`,
        `Timeline: ${timeline || '—'}`,
        `Best time to call: ${best_time || '—'}`,
        ``,
        `Source: Luis Farrera Booking Form`
      ].join('\n');

      await axios.post(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        { body: noteBody, userId: 'ALHFH3LlHUg7V4GuSbop' },
        { headers: LF_GHL_HEADERS }
      );
      console.log(`[LF Booking] Note added to contact ${contactId}`);

      // Step 3: Create opportunity in Book Now pipeline → New Inquiry stage
      try {
        const oppName = `${first_name || full_name || 'New'} ${last_name || ''} — Tattoo Booking`.trim();
        await axios.post(
          'https://services.leadconnectorhq.com/opportunities/',
          {
            pipelineId:      LF_PIPELINE_ID,
            locationId:      LF_LOCATION_ID,
            name:            oppName,
            pipelineStageId: LF_STAGE_NEW_INQUIRY,
            status:          'open',
            contactId:       contactId,
            assignedTo:      LF_BOOKING_MANAGER
          },
          { headers: LF_GHL_HEADERS }
        );
        console.log(`[LF Booking] Opportunity created in Book Now pipeline → New Inquiry`);
      } catch(oppErr) {
        console.error('[LF Booking] Opportunity creation error:', oppErr.response?.data || oppErr.message);
      }
    }

    // Step 4: Also fire the GHL webhook for workflow automation
    axios.post(
      'https://services.leadconnectorhq.com/hooks/Q6FIvQ5WitCeq9wyXZ3L/webhook-trigger/6eb41369-d80b-4c90-ba76-f55fe9d4cb60',
      req.body,
      { headers: { 'Content-Type': 'application/json' } }
    ).catch(e => console.error('[LF Booking] Webhook fire error:', e.message));

    res.json({ ok: true, contactId });
  } catch(e) {
    console.error('[LF Booking Proxy] Error:', e.response?.data || e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.options('/proxy/lf-booking', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

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

    // ── Blocked users — never engage with these usernames ──
    const normalizedName = (contactName || '').toLowerCase().replace(/\s+/g, '');
    if (BLOCKED_USERS.some(u => normalizedName.includes(u.toLowerCase()))) {
      console.log(`[Armando] Blocked user detected: ${contactName} — staying silent.`);
      return res.status(200).json({ status: 'blocked', reason: 'blocked_user', user: contactName });
    }

    if (messageId && repliedMessageIds.has(messageId)) {
      console.log(`Dedup: already replied to messageId ${messageId}. Skipping.`);
      return res.status(200).json({ status: 'skipped', reason: 'duplicate messageId' });
    }

    const sendType = getSendType(messageType);

    // ── Pre-flight checks — bail before Claude if Armando shouldn't engage ──
    // Fetch history + contact info once here; pass into getArmandoReply to avoid duplicate GHL calls
    const [priorHistory, priorContact] = await Promise.all([
      conversationId ? getConversationHistory(conversationId) : Promise.resolve([]),
      getGHLContact(contactId),
    ]);

    // 1. If Jose already sent outbound messages → he's handling it, stay silent
    if (priorHistory.some(m => m.direction === 'outbound')) {
      console.log(`[Armando] Existing outbound — silent, Jose handles it.`);
      return res.status(200).json({ status: 'silent', reason: 'jose_handling' });
    }

    // 2. If contact already has phone AND email → fully qualified, no need to chase
    if (priorContact.phone && priorContact.email) {
      console.log(`[Armando] Contact already fully qualified — silent.`);
      return res.status(200).json({ status: 'silent', reason: 'already_qualified' });
    }

    // ── Now call Claude — pre-fetched data passed in to avoid duplicate API calls ──
    const { reply, leadQuality, sentiment, shouldEngage, wantsCall, slotChoice, foundPhone, foundEmail, contactMemory: cMem, competitorInsights: cInsights, compPainPoints: cPain } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId, sendType,
      { history: priorHistory, contact: priorContact }  // pre-fetched — no re-fetch needed
    );
    const msgCount = contactMessageCount.get(contactId) || 1;
    // shouldAutoReply: true unless Claude says the message is personal/non-business
    let shouldAutoReply = shouldEngage !== false;
    if (!shouldAutoReply) console.log(`[Armando] Message flagged as personal/non-business — silent.`);
    console.log(`[Armando] msg #${msgCount} | lead:${leadQuality} sentiment:${sentiment} engage:${shouldAutoReply} phone:${foundPhone || '-'} email:${foundEmail || '-'}`);

    // Reel attribution — on first DM, check if a reel drove this lead
    if (msgCount === 1) {
      checkReelAttribution(contactId).then(reelHook => {
        if (reelHook) {
          tagContact(contactId, ['reel-driven-lead']);
          console.log(`[Attribution] Lead ${contactId} → reel: "${reelHook.slice(0, 60)}"`);
        }
      }).catch(() => {});
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
// ═══════════════════════════════════════════════════════════
// COONEY HOMES ANGI LEAD WEBHOOK (must be before /:locationId catch-all)
// GHL Workflow → Send Webhook → https://armando-bot-1.onrender.com/webhook/angi-lead
// Parses FULL lead data from Angi new-lead emails:
//   name, phone, email, address, service type, comments
// ═══════════════════════════════════════════════════════════
app.post('/webhook/angi-lead', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;
    const msgBody    = payload?.message?.body || payload?.messageBody || payload?.body || payload?.email?.body || '';
    const msgSubject = payload?.message?.subject || payload?.subject || payload?.email?.subject || '';

    const KEY      = 'pit-fbb00e26-bee4-43b5-9108-512f61ea71bf';
    const LOC      = 'Gc4sUcLiRI2edddJ5Lfl';
    const PIPELINE = '3bwYP7DRop9rWrnTFlhf';
    const STAGE    = 'cec57fe9-6746-4667-82c3-bbb6afbcef46';
    const headers  = { 'Authorization': `Bearer ${KEY}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' };

    // Strip HTML tags for plain text parsing
    const plain = msgBody.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');

    // ── Detect email type ────────────────────────────────────
    const isNewLead = /you have a new lead/i.test(plain) || /you have a new lead/i.test(msgSubject);

    // ── Parse name ───────────────────────────────────────────
    let leadName = '';
    if (isNewLead) {
      // New lead email: name appears bold after "Customer Information"
      const nm = plain.match(/Customer Information\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)/);
      if (nm) leadName = nm[1];
    }
    if (!leadName) {
      const patterns = [
        /([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s+has sent you a message/,
        /[Nn]ew (?:message|lead|inquiry) from ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
        /Name:\s*([A-Za-z]+(?: [A-Za-z]+)+)/,
      ];
      for (const p of patterns) { const m = plain.match(p); if (m) { leadName = m[1]; break; } }
    }
    if (!leadName && msgSubject) leadName = msgSubject.replace(/^(Re:|Fwd:|You have a new lead!?)/i,'').trim().slice(0,60);
    if (!leadName) leadName = 'Angi Lead';

    // ── Parse phone ──────────────────────────────────────────
    const phoneMatch = plain.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
    const phone = phoneMatch ? `+1${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}` : '';

    // ── Parse email ──────────────────────────────────────────
    const emailMatch = plain.match(/([a-zA-Z0-9._%+\-]+@(?!angi\.com)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    const leadEmail = emailMatch ? emailMatch[1] : '';

    // ── Parse address ────────────────────────────────────────
    const addrMatch = plain.match(/(\d+\s+[A-Za-z0-9\s,]+(?:FL|GA|TX|CA|NY|NC|SC|TN|OH|PA|VA|MD|CO|AZ|WA|NV|OR)\s+\d{5})/);
    const address = addrMatch ? addrMatch[1].trim() : '';

    // ── Parse service type ───────────────────────────────────
    const serviceMatch = msgSubject.match(/You have a new lead!?\s*(.+)/i)
      || plain.match(/You have a new lead!\s*([A-Z][^\n]{5,60})/);
    const service = serviceMatch ? serviceMatch[1].trim() : '';

    // ── Parse comments ───────────────────────────────────────
    const commentsMatch = plain.match(/Comments:\s*(.{20,500}?)(?:Job #|View Lead|$)/is);
    const comments = commentsMatch ? commentsMatch[1].trim() : '';

    // ── Parse job number ─────────────────────────────────────
    const jobMatch = plain.match(/Job #[:\s]*(\d{6,12})/);
    const jobNum = jobMatch ? jobMatch[1] : '';

    const [firstName, ...rest] = leadName.trim().split(' ');
    const lastName = rest.join(' ') || '';

    console.log(`[CooneyAngi] Parsed lead: ${leadName} | phone: ${phone} | email: ${leadEmail} | service: ${service}`);

    // ── 1. Create full contact ───────────────────────────────
    const contactPayload = {
      firstName, lastName,
      locationId: LOC,
      source: 'Angi',
      tags: ['angi-lead'],
      ...(phone      && { phone }),
      ...(leadEmail  && { email: leadEmail }),
      ...(address    && { address1: address }),
    };

    const cr = await axios.post('https://services.leadconnectorhq.com/contacts/', contactPayload, { headers })
      .catch(e => { console.error('[CooneyAngi] contact error:', e.response?.data || e.message); return null; });
    const contactId = cr?.data?.contact?.id;
    console.log(`[CooneyAngi] Contact created: ${leadName} (${contactId})`);

    // ── 2. Create opportunity ────────────────────────────────
    if (contactId) {
      const oppTitle = service ? `Angi — ${service} — ${leadName}` : `Angi Lead — ${leadName}`;
      await axios.post('https://services.leadconnectorhq.com/opportunities/',
        {
          title: oppTitle,
          pipelineId: PIPELINE,
          pipelineStageId: STAGE,
          contactId,
          locationId: LOC,
          status: 'open',
          source: 'Angi',
          ...(comments && { description: `${comments}${jobNum ? `\n\nAngi Job #: ${jobNum}` : ''}` }),
        },
        { headers }
      ).catch(e => console.error('[CooneyAngi] opp error:', e.response?.data || e.message));
      console.log(`[CooneyAngi] Opportunity created: ${oppTitle}`);

      // ── 3. Create task (no SMS) ──────────────────────────────
      const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const taskBody = [
        `New Angi lead — follow up within 24 hours.`,
        service   ? `Service: ${service}`        : '',
        phone     ? `Phone: ${phone}`            : '',
        leadEmail ? `Email: ${leadEmail}`        : '',
        comments  ? `Comments: ${comments}`      : '',
        jobNum    ? `Angi Job #: ${jobNum}`      : '',
        `View lead: https://pro.angi.com`,
      ].filter(Boolean).join('\n');

      await axios.post(
        `https://services.leadconnectorhq.com/contacts/${contactId}/tasks`,
        { title: `Follow up — Angi: ${leadName}`, body: taskBody, dueDate, completed: false },
        { headers }
      ).catch(e => console.error('[CooneyAngi] task error:', e.response?.data || e.message));
      console.log(`[CooneyAngi] Task created for: ${leadName}`);
    }

  } catch(err) { console.error('[CooneyAngi] Error:',err.message); }
});

// MULTI-TENANT WEBHOOK — /webhook/:locationId
// Routes DMs from client sub-accounts to their persona bot.
// Setup: client GHL → Settings → Webhooks → https://armando-bot-1.onrender.com/webhook/{locationId}
// ═══════════════════════════════════════════════════════════

app.post('/webhook/:locationId', async (req, res) => {
  const { locationId } = req.params;
  const persona = getPersona(locationId);

  if (!persona) {
    // No active persona for this locationId — ignore silently
    return res.status(200).json({ status: 'skipped', reason: 'no_active_persona' });
  }

  try {
    const payload = req.body;
    console.log(`[Persona:${persona.name}] Incoming webhook:`, JSON.stringify(payload, null, 2));

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
      return res.status(200).json({ status: 'skipped', reason: 'missing fields' });
    }

    if (messageId && repliedMessageIds.has(messageId)) {
      return res.status(200).json({ status: 'skipped', reason: 'duplicate messageId' });
    }

    const sendType = getSendType(messageType);

    // Pre-fetch history + contact using the client's own API key
    const clientHeaders = { Authorization: `Bearer ${persona.apiKey}`, Version: '2021-07-28' };
    const [priorHistory, priorContact] = await Promise.all([
      conversationId
        ? axios.get(`https://services.leadconnectorhq.com/conversations/${conversationId}/messages`, { headers: clientHeaders })
            .then(r => (r.data.messages || []).map(m => ({ role: m.direction === 'outbound' ? 'assistant' : 'user', content: m.body || '', direction: m.direction })))
            .catch(() => [])
        : Promise.resolve([]),
      axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, { headers: clientHeaders })
        .then(r => r.data.contact || r.data || {})
        .catch(() => ({})),
    ]);

    // If a human already replied — stay silent
    if (priorHistory.some(m => m.direction === 'outbound')) {
      return res.status(200).json({ status: 'silent', reason: 'human_handling' });
    }

    // If already fully qualified — stay silent
    if (priorContact.phone && priorContact.email) {
      return res.status(200).json({ status: 'silent', reason: 'already_qualified' });
    }

    // Call Claude with persona's personality as the system prompt
    const { reply, shouldEngage } = await getArmandoReply(
      messageBody, contactName, contactId, conversationId, sendType,
      { history: priorHistory, contact: priorContact, systemPrompt: persona.personality }
    );

    if (shouldEngage === false) {
      return res.status(200).json({ status: 'silent', reason: 'non_business' });
    }

    await sendGHLReply(contactId, reply, sendType, persona.apiKey);
    if (messageId) repliedMessageIds.add(messageId);
    console.log(`[Persona:${persona.name}] ✅ Reply sent to ${contactName || contactId}`);

    res.status(200).json({ status: 'ok', persona: persona.name, replied: true });
  } catch (error) {
    console.error(`[Persona webhook:${locationId}] Error:`, error?.response?.data || error.message);
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

// Manual trigger: POST /cron/run-reel  — fire-and-forget (reel takes 60-90s, beyond Render timeout)
app.post('/cron/run-reel', (_req, res) => {
  res.json({ status: 'started', message: 'Reel generating in background — check GET /status in ~2 min' });
  runDailyReel()
    .then(r => logCron('daily-reel', 'ok', r))
    .catch(e => { logCron('daily-reel', 'error', e.message); console.error('/cron/run-reel error:', e.message); });
});

// Debug: GET /test-reel-content — test Claude reel content gen directly
app.get('/test-reel-content', async (_req, res) => {
  try {
    const { script } = getTodaysScript();
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Return this exact JSON with no changes: {"hook":"TEST","hook_sub":"sub","content":["a","b","c"],"climax1":"X","climax2":"Y","climax_sub":"Z","framework":"test"}` }]
    });
    const raw = msg.content[0].text.trim();
    res.json({ success: true, topic: script.title, rawResponse: raw, parsed: (() => { try { return JSON.parse(raw.match(/\{[\s\S]*\}/)[0]); } catch(e) { return { parseError: e.message }; } })() });
  } catch (e) {
    res.json({ success: false, error: e.message, type: e.constructor?.name });
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
    office: 'https://armando-bot-1.onrender.com/office',
    health: 'https://armando-bot-1.onrender.com/health',
    status: 'https://armando-bot-1.onrender.com/status',
    buildHash: '2c82e84',
  });
});

// GET /site/jrz — JRZ Marketing website
app.get('/site/jrz', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'jrz-site.html'));
});

// GET /office — 2D anime AI team office
app.get('/office', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JRZ Marketing — AI Headquarters</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;overflow-x:hidden;min-height:100vh}

.header{background:linear-gradient(135deg,#16213e,#0f3460);padding:14px 30px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #e94560}
.header h1{color:#fff;font-size:1.3rem;letter-spacing:1px}
.header .sub{color:#4ecca3;font-size:0.8rem;margin-top:3px}
.clock{color:#fff;font-size:1.1rem;font-weight:bold;background:rgba(233,69,96,0.2);padding:6px 14px;border-radius:20px;border:1px solid #e94560}

.stats-bar{background:#16213e;padding:10px 30px;display:flex;gap:25px;flex-wrap:wrap;border-bottom:1px solid #0f3460}
.stat{color:#aaa;font-size:0.8rem}.stat strong{color:#4ecca3}

/* OFFICE ROOM */
.office-room{
  background:linear-gradient(180deg,#c8d8e8 0%,#dce8f0 35%,#e8e8ee 35%,#e0ddd8 60%,#c8b99a 60%,#b5a585 100%);
  min-height:480px;position:relative;padding:20px 10px 90px;
  display:flex;align-items:flex-end;gap:10px;justify-content:center;overflow:hidden
}

/* ceiling */
.ceil-light{position:absolute;top:0;width:18px;height:7px;background:#fffbe6;border-radius:0 0 4px 4px;box-shadow:0 0 40px 20px rgba(255,252,200,0.25)}

/* window */
.window{position:absolute;top:18px;left:35px;width:110px;height:130px;background:linear-gradient(160deg,#b8e4f9,#e0f7fa);border:7px solid #7a5c14;border-radius:4px}
.window::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:3px;background:#7a5c14;transform:translateX(-50%)}
.window::after{content:'';position:absolute;top:50%;left:0;right:0;height:3px;background:#7a5c14}

/* office sign */
.office-sign{position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#e94560;color:#fff;padding:6px 18px;border-radius:4px;font-weight:900;font-size:1rem;letter-spacing:3px;white-space:nowrap;box-shadow:0 2px 10px rgba(233,69,96,0.5)}

/* plant */
.plant{position:absolute;bottom:85px;right:25px}
.plant-pot{width:28px;height:18px;background:#c0632b;clip-path:polygon(10% 0%,90% 0%,100% 100%,0% 100%);margin:0 auto}
.plant-leaf{position:absolute;width:18px;height:28px;background:#2d8a3e;border-radius:0 50% 0 50%}

/* DESK STATION */
.station{display:flex;flex-direction:column;align-items:center;position:relative;width:130px;flex-shrink:0}
.station-label{font-size:0.65rem;font-weight:900;color:#fff;background:rgba(0,0,0,0.65);padding:2px 9px;border-radius:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
.role-tag{font-size:0.55rem;color:#4ecca3;text-align:center;margin-bottom:4px}

.monitor{width:96px;height:68px;background:#111;border:3px solid #444;border-radius:5px;position:relative;overflow:hidden;flex-shrink:0}
.monitor::after{content:'';position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);width:28px;height:14px;background:#555;clip-path:polygon(20% 0%,80% 0%,100% 100%,0% 100%)}
.monitor-screen{width:100%;height:100%;padding:4px 5px;font-size:0.48rem;color:#4ecca3;font-family:monospace;overflow:hidden;line-height:1.4}
.scroll-text{animation:scrollUp 10s linear infinite}
@keyframes scrollUp{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}

.keyboard{width:76px;height:18px;background:linear-gradient(180deg,#ddd,#bbb);border-radius:3px;border:1px solid #999;margin-top:16px;position:relative}
.keyboard::after{content:'';position:absolute;top:3px;left:5px;right:5px;height:2px;background:repeating-linear-gradient(90deg,#aaa 0,#aaa 5px,transparent 5px,transparent 8px)}

.desk{width:125px;height:22px;background:linear-gradient(180deg,#d4a574,#b8864e);border-radius:4px 4px 0 0;border:2px solid #8B6914;margin-top:4px}
.desk-legs{width:105px;height:36px;display:flex;justify-content:space-between;padding:0 10px}
.desk-leg{width:9px;height:36px;background:#8B6914;border-radius:0 0 3px 3px}

/* CHARACTER — chibi anime */
.char-wrap{position:absolute;bottom:60px;left:50%;transform:translateX(-50%)}
.chibi{width:58px;height:88px;position:relative}
.chibi.anim-idle{animation:idle 2.5s ease-in-out infinite}
.chibi.anim-type{animation:typeAnim 0.6s ease-in-out infinite}
.chibi.anim-active{animation:activeAnim 1.8s ease-in-out infinite}
.chibi.anim-sleep{animation:idle 4s ease-in-out infinite;opacity:0.65}

@keyframes idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes typeAnim{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-3px) rotate(1deg)}}
@keyframes activeAnim{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-7px) scale(1.03)}}

/* head */
.c-head{width:42px;height:42px;border-radius:50%;position:absolute;top:0;left:8px;z-index:3}
/* hair top */
.c-hair{position:absolute;top:-4px;left:4px;width:50px;height:24px;border-radius:50% 50% 0 0;z-index:4}
/* hair sides */
.c-hair-l{position:absolute;top:12px;left:3px;width:8px;height:20px;border-radius:0 0 50% 50%;z-index:2}
.c-hair-r{position:absolute;top:12px;right:3px;width:8px;height:20px;border-radius:0 0 50% 50%;z-index:2}
/* eyes */
.c-eyes{position:absolute;top:16px;left:9px;width:24px;display:flex;gap:5px;z-index:5}
.c-eye{width:7px;height:9px;border-radius:50%;position:relative}
.c-eye::after{content:'';position:absolute;top:1px;right:1px;width:2px;height:2px;border-radius:50%;background:#fff}
/* blush */
.c-blush-l{position:absolute;top:24px;left:5px;width:8px;height:4px;border-radius:50%;background:rgba(255,140,140,0.5);z-index:5}
.c-blush-r{position:absolute;top:24px;right:5px;width:8px;height:4px;border-radius:50%;background:rgba(255,140,140,0.5);z-index:5}
/* glasses (Sofia) */
.c-glasses{position:absolute;top:15px;left:7px;width:28px;height:9px;border:2px solid #555;border-radius:3px;z-index:6}
/* body */
.c-body{width:38px;height:30px;border-radius:9px 9px 4px 4px;position:absolute;top:38px;left:10px;z-index:2}
/* arms */
.c-arm-l{position:absolute;width:11px;height:22px;border-radius:6px;top:42px;left:1px;z-index:1;transform:rotate(20deg)}
.c-arm-r{position:absolute;width:11px;height:22px;border-radius:6px;top:42px;right:1px;z-index:1;transform:rotate(-20deg)}
.chibi.anim-type .c-arm-l{animation:al 0.6s ease-in-out infinite}
.chibi.anim-type .c-arm-r{animation:ar 0.6s ease-in-out infinite}
@keyframes al{0%,100%{transform:rotate(20deg)}50%{transform:rotate(32deg) translateY(3px)}}
@keyframes ar{0%,100%{transform:rotate(-20deg)}50%{transform:rotate(-32deg) translateY(3px)}}

/* thought bubble */
.bubble{position:absolute;top:-46px;left:50%;transform:translateX(-50%);background:#fff;border:2px solid #e94560;border-radius:10px;padding:3px 8px;font-size:0.52rem;white-space:nowrap;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,0.2);max-width:120px;text-align:center}
.bubble::after{content:'';position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#e94560}

/* TICKER */
.ticker-wrap{background:#0f3460;padding:9px 0;overflow:hidden;border-top:2px solid #e94560;display:flex;align-items:center}
.ticker-label{color:#e94560;font-weight:900;font-size:0.75rem;padding:0 15px;white-space:nowrap;flex-shrink:0}
.ticker-track{overflow:hidden;flex:1}
.ticker{display:flex;animation:tick 35s linear infinite;white-space:nowrap}
.ticker-item{color:#4ecca3;font-size:0.78rem;padding:0 28px}
@keyframes tick{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>🏢 JRZ Marketing — AI Headquarters</h1>
    <div class="sub">● 5 AI agents online · 31 clients · fully autonomous</div>
  </div>
  <div class="clock" id="clock">--:-- EST</div>
</div>

<div class="stats-bar">
  <div class="stat">🤖 Agents: <strong>5 online</strong></div>
  <div class="stat">🏢 Clients: <strong>31 active</strong></div>
  <div class="stat">📱 Daily posts: <strong>1 carousel + 1 story</strong></div>
  <div class="stat">✍️ SEO blogs: <strong>daily per client</strong></div>
  <div class="stat">🏙️ City pages: <strong>348 Railing Max · 128 Cooney</strong></div>
  <div class="stat">📊 Reports: <strong>weekly + monthly</strong></div>
</div>

<div class="office-room" id="office">
  <!-- Lights -->
  <div class="ceil-light" style="left:18%"></div>
  <div class="ceil-light" style="left:38%"></div>
  <div class="ceil-light" style="left:58%"></div>
  <div class="ceil-light" style="left:78%"></div>

  <!-- Window -->
  <div class="window"></div>

  <!-- Sign -->
  <div class="office-sign">JRZ MARKETING</div>

  <!-- Plant -->
  <div class="plant">
    <div class="plant-leaf" style="left:4px;bottom:18px;transform:rotate(-30deg)"></div>
    <div class="plant-leaf" style="right:4px;bottom:18px;transform:rotate(30deg) scaleX(-1)"></div>
    <div class="plant-leaf" style="left:7px;bottom:32px;transform:rotate(-10deg)"></div>
    <div class="plant-pot"></div>
  </div>

  <!-- ─── ARMANDO ─── -->
  <div class="station">
    <div class="station-label">Armando</div>
    <div class="role-tag">Community Manager</div>
    <div class="monitor">
      <div class="monitor-screen"><div class="scroll-text">
        📨 New DM @user123<br>💬 Generating reply...<br>✅ Reply sent<br>🔔 Comment detected<br>📊 Lead captured!<br>🏷️ Tag: hot_lead<br>📨 New DM @user456<br>💬 Generating reply...<br>✅ Reply sent<br>🔔 Comment detected<br>📊 Lead captured!<br>🏷️ Tag: hot_lead<br>
      </div></div>
    </div>
    <div class="keyboard"></div>
    <div class="desk"></div>
    <div class="desk-legs"><div class="desk-leg"></div><div class="desk-leg"></div></div>
    <div class="char-wrap">
      <div class="chibi anim-type" id="chibi-armando">
        <div class="bubble" id="bub-armando">24/7 DM guard 🛡️</div>
        <div class="c-hair" style="background:#1a1010"></div>
        <div class="c-hair-l" style="background:#1a1010"></div>
        <div class="c-hair-r" style="background:#1a1010"></div>
        <div class="c-head" style="background:#C68642"></div>
        <div class="c-eyes"><div class="c-eye" style="background:#3d2314"></div><div class="c-eye" style="background:#3d2314"></div></div>
        <div class="c-blush-l"></div><div class="c-blush-r"></div>
        <div class="c-body" style="background:#3a7bd5"></div>
        <div class="c-arm-l" style="background:#C68642"></div>
        <div class="c-arm-r" style="background:#C68642"></div>
      </div>
    </div>
  </div>

  <!-- ─── ELENA ─── -->
  <div class="station">
    <div class="station-label">Elena</div>
    <div class="role-tag">Client Success</div>
    <div class="monitor">
      <div class="monitor-screen"><div class="scroll-text">
        📋 Escobar Kitchen<br>✅ Health: Excellent<br>📈 Growth: +12%<br>📋 Railing Max<br>✅ 348 city pages<br>📋 Cooney Homes<br>✅ Health: Good<br>📋 USA CPA<br>✅ Health: Excellent<br>📈 Growth: +12%<br>📋 Railing Max<br>✅ 348 city pages<br>
      </div></div>
    </div>
    <div class="keyboard"></div>
    <div class="desk"></div>
    <div class="desk-legs"><div class="desk-leg"></div><div class="desk-leg"></div></div>
    <div class="char-wrap">
      <div class="chibi anim-idle" id="chibi-elena">
        <div class="bubble" id="bub-elena">Client reports 📋</div>
        <div class="c-hair" style="background:#2c1810;border-radius:50% 50% 0 0;height:28px"></div>
        <div class="c-hair-l" style="background:#2c1810;height:30px"></div>
        <div class="c-hair-r" style="background:#2c1810;height:30px"></div>
        <div class="c-head" style="background:#FDBCB4"></div>
        <div class="c-eyes"><div class="c-eye" style="background:#2c2c2c"></div><div class="c-eye" style="background:#2c2c2c"></div></div>
        <div class="c-blush-l"></div><div class="c-blush-r"></div>
        <div class="c-body" style="background:#e91e8c"></div>
        <div class="c-arm-l" style="background:#FDBCB4"></div>
        <div class="c-arm-r" style="background:#FDBCB4"></div>
      </div>
    </div>
  </div>

  <!-- ─── DIEGO ─── -->
  <div class="station">
    <div class="station-label">Diego</div>
    <div class="role-tag">Project Manager</div>
    <div class="monitor">
      <div class="monitor-screen"><div class="scroll-text">
        📊 Scorecard: A<br>🗓️ Sprint: Week 12<br>✅ Tasks: 24/28<br>📌 KPIs: 94%<br>🗣️ Standup done<br>📊 Q1 on track<br>📊 Scorecard: A<br>🗓️ Sprint: Week 12<br>✅ Tasks: 24/28<br>📌 KPIs: 94%<br>🗣️ Standup done<br>📊 Q1 on track<br>
      </div></div>
    </div>
    <div class="keyboard"></div>
    <div class="desk"></div>
    <div class="desk-legs"><div class="desk-leg"></div><div class="desk-leg"></div></div>
    <div class="char-wrap">
      <div class="chibi anim-idle" id="chibi-diego">
        <div class="bubble" id="bub-diego">Weekly report 📊</div>
        <div class="c-hair" style="background:#6B3A2A;height:20px;border-radius:50% 50% 0 0"></div>
        <div class="c-hair-l" style="background:#6B3A2A;height:14px"></div>
        <div class="c-hair-r" style="background:#6B3A2A;height:14px"></div>
        <div class="c-head" style="background:#D4A270"></div>
        <div class="c-eyes"><div class="c-eye" style="background:#4a2c17"></div><div class="c-eye" style="background:#4a2c17"></div></div>
        <div class="c-blush-l"></div><div class="c-blush-r"></div>
        <div class="c-body" style="background:#e67e22"></div>
        <div class="c-arm-l" style="background:#D4A270"></div>
        <div class="c-arm-r" style="background:#D4A270"></div>
      </div>
    </div>
  </div>

  <!-- ─── MARCO ─── -->
  <div class="station">
    <div class="station-label">Marco</div>
    <div class="role-tag">Content Director</div>
    <div class="monitor">
      <div class="monitor-screen"><div class="scroll-text">
        ✍️ Blog: Railing Max<br>🎨 Content brief<br>📱 Reel script done<br>🔥 Trend: #local SEO<br>📝 Caption crafted<br>🎯 A/B test ready<br>✍️ Blog: Escobar<br>🎨 Content brief<br>📱 Reel script done<br>🔥 Trend: #local SEO<br>📝 Caption crafted<br>🎯 A/B test ready<br>
      </div></div>
    </div>
    <div class="keyboard"></div>
    <div class="desk"></div>
    <div class="desk-legs"><div class="desk-leg"></div><div class="desk-leg"></div></div>
    <div class="char-wrap">
      <div class="chibi anim-type" id="chibi-marco">
        <div class="bubble" id="bub-marco">Writing content ✍️</div>
        <div class="c-hair" style="background:#1a3a2a;height:22px;border-radius:60% 40% 0 0"></div>
        <div class="c-hair-l" style="background:#1a3a2a;height:16px"></div>
        <div class="c-hair-r" style="background:#1a3a2a;height:16px"></div>
        <div class="c-head" style="background:#C8956C"></div>
        <div class="c-eyes"><div class="c-eye" style="background:#2c2c2c"></div><div class="c-eye" style="background:#2c2c2c"></div></div>
        <div class="c-blush-l"></div><div class="c-blush-r"></div>
        <div class="c-body" style="background:#27ae60"></div>
        <div class="c-arm-l" style="background:#C8956C"></div>
        <div class="c-arm-r" style="background:#C8956C"></div>
      </div>
    </div>
  </div>

  <!-- ─── SOFIA ─── -->
  <div class="station">
    <div class="station-label">Sofia</div>
    <div class="role-tag">Web Designer / SEO</div>
    <div class="monitor">
      <div class="monitor-screen"><div class="scroll-text">
        🌐 Auditing sites...<br>📈 PageSpeed: 94<br>🔍 SEO: all good<br>🏙️ City page ✅<br>⚡ Uptime: 100%<br>🔗 Backlinks OK<br>🌐 Auditing sites...<br>📈 PageSpeed: 94<br>🔍 SEO: all good<br>🏙️ City page ✅<br>⚡ Uptime: 100%<br>🔗 Backlinks OK<br>
      </div></div>
    </div>
    <div class="keyboard"></div>
    <div class="desk"></div>
    <div class="desk-legs"><div class="desk-leg"></div><div class="desk-leg"></div></div>
    <div class="char-wrap">
      <div class="chibi anim-type" id="chibi-sofia">
        <div class="bubble" id="bub-sofia">Website audit 🌐</div>
        <div class="c-hair" style="background:#1a6a7a;height:20px;border-radius:50% 50% 0 0"></div>
        <div class="c-hair-l" style="background:#1a6a7a;width:10px;height:14px"></div>
        <div class="c-hair-r" style="background:#1a6a7a;width:10px;height:14px"></div>
        <div class="c-head" style="background:#FDBCB4"></div>
        <div class="c-glasses"></div>
        <div class="c-eyes"><div class="c-eye" style="background:#2c2c2c"></div><div class="c-eye" style="background:#2c2c2c"></div></div>
        <div class="c-blush-l"></div><div class="c-blush-r"></div>
        <div class="c-body" style="background:#00bcd4"></div>
        <div class="c-arm-l" style="background:#FDBCB4"></div>
        <div class="c-arm-r" style="background:#FDBCB4"></div>
      </div>
    </div>
  </div>

</div><!-- /office-room -->

<!-- CLIENT TICKER -->
<div class="ticker-wrap">
  <span class="ticker-label">📡 ACTIVE CLIENTS:</span>
  <div class="ticker-track">
    <div class="ticker">
      <span class="ticker-item">⭐ JRZ Marketing</span>
      <span class="ticker-item">🍽️ The Escobar Kitchen</span>
      <span class="ticker-item">🏗️ Railing Max</span>
      <span class="ticker-item">🏠 Cooney Homes</span>
      <span class="ticker-item">💰 USA Latino CPA</span>
      <span class="ticker-item">💈 Le Varon Barbershop</span>
      <span class="ticker-item">🥑 Guaca-Mole</span>
      <span class="ticker-item">🏢 Rental Spaces</span>
      <span class="ticker-item">📐 Railing Max — 348 city pages</span>
      <span class="ticker-item">🏘️ Cooney Homes — 128 city pages</span>
      <span class="ticker-item">⭐ JRZ Marketing</span>
      <span class="ticker-item">🍽️ The Escobar Kitchen</span>
      <span class="ticker-item">🏗️ Railing Max</span>
      <span class="ticker-item">🏠 Cooney Homes</span>
      <span class="ticker-item">💰 USA Latino CPA</span>
      <span class="ticker-item">💈 Le Varon Barbershop</span>
      <span class="ticker-item">🥑 Guaca-Mole</span>
      <span class="ticker-item">🏢 Rental Spaces</span>
      <span class="ticker-item">📐 Railing Max — 348 city pages</span>
      <span class="ticker-item">🏘️ Cooney Homes — 128 city pages</span>
    </div>
  </div>
</div>

<script>
// Clock
function tick(){
  const d=new Date();
  document.getElementById('clock').textContent=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/New_York'})+' EST';
}
setInterval(tick,1000);tick();

// Determine active agents based on EST hour
const nowEST=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
const h=nowEST.getHours();
const dow=nowEST.getDay(); // 0=Sun,1=Mon
const dom=nowEST.getDate();

const schedule={
  armando:{anim:'anim-type',bubble:'24/7 DM guard 🛡️'},
  elena:{
    anim: (h>=8&&h<=17)?'anim-type':'anim-idle',
    bubble: h===9&&dom===1?'Monthly reports 📋':h>=8&&h<=10?'Health check 💊':'Client success 🤝'
  },
  diego:{
    anim:(h>=8&&h<=10)&&dow===1?'anim-active':(h>=8&&h<=17?'anim-type':'anim-sleep'),
    bubble:h===8&&dow===1?'Standup time! 🗣️':h===9&&dow===1?'Weekly report 📊':'Project tracking 📌'
  },
  marco:{
    anim:(h>=9&&h<=11)?'anim-type':(h===10&&dow===3?'anim-active':'anim-idle'),
    bubble:h===9&&dow===1?'Content brief 📝':h===10&&dow===3?'Trend alert 🔥':'Content creating ✍️'
  },
  sofia:{
    anim:(h===7||h===9||h===10||h===16)?'anim-active':'anim-type',
    bubble:h===7?'Daily post time! 📱':h===9?'Website audit 🌐':h===16?'Reel time 🎬':'SEO monitoring 🔍'
  }
};

Object.entries(schedule).forEach(([name,data])=>{
  const c=document.getElementById('chibi-'+name);
  const b=document.getElementById('bub-'+name);
  if(c){c.className='chibi '+data.anim;}
  if(b){b.textContent=data.bubble;}
});

// Random event bubbles
const events=[
  ['armando','New lead! 🎯'],['armando','DM replied ✅'],['armando','Comment liked 👍'],
  ['elena','Client happy 😊'],['elena','Report sent 📋'],['elena','A+ grade! 🏆'],
  ['diego','Sprint done! 🏁'],['diego','Goal met ✅'],['diego','KPI: 97% 📊'],
  ['marco','Blog live! 🎉'],['marco','Reel posted 🎬'],['marco','Trend caught 🔥'],
  ['sofia','Audit done ✅'],['sofia','City page live 🏙️'],['sofia','PageSpeed 95 ⚡']
];
function randomEvent(){
  const [name,text]=events[Math.floor(Math.random()*events.length)];
  const b=document.getElementById('bub-'+name);
  const orig=schedule[name].bubble;
  if(b){b.textContent=text;setTimeout(()=>b.textContent=orig,2500);}
}
setInterval(randomEvent,8000);
</script>
</body>
</html>`);
});

// GET /office/standup — daily AI team meeting room
app.get('/office/standup', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  let standup;
  try {
    const r = await axios.get(STANDUP_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    standup = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  } catch (_e) { standup = null; }

  const agentColors = { armando: '#3a7bd5', elena: '#e91e8c', diego: '#e67e22', marco: '#27ae60', sofia: '#00bcd4' };
  const agentEmoji  = { armando: '🛡️', elena: '📋', diego: '📊', marco: '✍️', sofia: '🌐' };
  const agentRole   = { armando: 'Community Manager', elena: 'Client Success', diego: 'Project Manager', marco: 'Content Director', sofia: 'Web Designer / SEO' };

  const messagesHtml = standup?.messages?.map((m, i) => `
    <div class="msg" style="animation-delay:${i * 0.15}s">
      <div class="msg-avatar" style="background:${agentColors[m.agent] || '#555'}">${agentEmoji[m.agent] || '🤖'}</div>
      <div class="msg-body">
        <div class="msg-name" style="color:${agentColors[m.agent] || '#aaa'}">${m.agent.charAt(0).toUpperCase()+m.agent.slice(1)} <span class="msg-role">${agentRole[m.agent] || ''}</span></div>
        <div class="msg-text">${m.message}</div>
      </div>
    </div>`).join('') || '<div class="no-standup">⏳ Standup not yet generated today — runs at 6:50am EST.<br><br>Trigger it now: <code>POST /cron/standup</code></div>';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JRZ AI Team — Daily Standup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;color:#fff;min-height:100vh}
.header{background:linear-gradient(135deg,#16213e,#0f3460);padding:14px 30px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #e94560}
.header h1{font-size:1.3rem;letter-spacing:1px}
.header .meta{font-size:0.8rem;color:#4ecca3;margin-top:3px}
.back{color:#e94560;text-decoration:none;font-size:0.85rem;border:1px solid #e94560;padding:5px 12px;border-radius:15px}
.back:hover{background:#e94560;color:#fff}
.meeting-room{max-width:820px;margin:30px auto;padding:0 20px}
.room-header{background:linear-gradient(135deg,#0f3460,#16213e);border:1px solid #e94560;border-radius:12px;padding:20px 25px;margin-bottom:24px;display:flex;align-items:center;gap:20px}
.room-icon{font-size:2.5rem}
.room-title{font-size:1.2rem;font-weight:700;color:#fff}
.room-sub{color:#4ecca3;font-size:0.85rem;margin-top:4px}
.room-stats{margin-left:auto;display:flex;gap:16px;flex-wrap:wrap}
.rstat{background:rgba(233,69,96,0.15);border:1px solid rgba(233,69,96,0.3);border-radius:8px;padding:8px 14px;text-align:center}
.rstat strong{color:#e94560;display:block;font-size:1.1rem}
.rstat span{font-size:0.7rem;color:#aaa}
.messages{display:flex;flex-direction:column;gap:16px}
.msg{display:flex;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;animation:fadeIn 0.4s ease both}
@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.msg-avatar{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.msg-name{font-weight:700;font-size:0.95rem;margin-bottom:4px}
.msg-role{font-weight:400;font-size:0.72rem;color:#888;margin-left:6px}
.msg-text{color:#ddd;font-size:0.9rem;line-height:1.6}
.no-standup{text-align:center;padding:50px 20px;color:#888;font-size:0.95rem;line-height:2}
.no-standup code{background:rgba(255,255,255,0.1);padding:3px 8px;border-radius:4px;color:#4ecca3}
.apis{background:rgba(15,52,96,0.5);border:1px solid rgba(78,204,163,0.2);border-radius:12px;padding:20px 25px;margin-top:24px}
.apis h3{color:#4ecca3;font-size:0.9rem;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px}
.api-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.api-tag{background:rgba(78,204,163,0.1);border:1px solid rgba(78,204,163,0.25);border-radius:6px;padding:6px 10px;font-size:0.75rem;color:#4ecca3;display:flex;align-items:center;gap:6px}
.api-dot{width:7px;height:7px;border-radius:50%;background:#4ecca3;flex-shrink:0;box-shadow:0 0 6px #4ecca3}
.trigger{text-align:center;margin-top:20px}
.trigger a{background:#e94560;color:#fff;padding:10px 22px;border-radius:20px;text-decoration:none;font-size:0.85rem;font-weight:600}
.trigger a:hover{background:#c73652}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>🗓️ Daily AI Team Standup</h1>
    <div class="meta">${standup ? `${standup.dayName}, ${standup.date} · Generated ${new Date(standup.generatedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'})} EST` : 'Pending generation'}</div>
  </div>
  <a href="/office" class="back">← Back to Office</a>
</div>

<div class="meeting-room">
  <div class="room-header">
    <div class="room-icon">🏢</div>
    <div>
      <div class="room-title">JRZ Marketing — Morning Meeting</div>
      <div class="room-sub">All 5 AI agents · 24/7 operations · ${standup?.clientCount || 0} active clients</div>
    </div>
    <div class="room-stats">
      <div class="rstat"><strong>${standup?.clientCount || '—'}</strong><span>Clients</span></div>
      <div class="rstat"><strong>${standup?.railingCount || '—'}/348</strong><span>Railing Pages</span></div>
      <div class="rstat"><strong>${standup?.cooneyCount || '—'}/128</strong><span>Cooney Pages</span></div>
    </div>
  </div>

  <div class="messages">${messagesHtml}</div>

  <div class="apis">
    <h3>🔌 Active API Connections</h3>
    <div class="api-grid">
      <div class="api-tag"><div class="api-dot"></div>GHL LeadConnector API</div>
      <div class="api-tag"><div class="api-dot"></div>Anthropic Claude API</div>
      <div class="api-tag"><div class="api-dot"></div>DataForSEO API</div>
      <div class="api-tag"><div class="api-dot"></div>ElevenLabs Voice API</div>
      <div class="api-tag"><div class="api-dot"></div>Cloudinary Storage</div>
      <div class="api-tag"><div class="api-dot"></div>NewsAPI</div>
      <div class="api-tag"><div class="api-dot"></div>Apollo.io Enrichment</div>
      <div class="api-tag"><div class="api-dot"></div>Google PageSpeed API</div>
      <div class="api-tag"><div class="api-dot"></div>Google Search Console</div>
      <div class="api-tag"><div class="api-dot"></div>Bland AI Calls</div>
      <div class="api-tag"><div class="api-dot"></div>Pexels / GHL Media</div>
      <div class="api-tag"><div class="api-dot"></div>Render (auto-deploy)</div>
    </div>
  </div>

  <div class="trigger">
    <a href="#" onclick="triggerStandup();return false;">🔄 Regenerate Today's Standup</a>
  </div>
</div>

<script>
async function triggerStandup(){
  const btn=event.target;
  btn.textContent='Generating...';
  btn.style.background='#555';
  try{
    await fetch('/cron/standup',{method:'POST'});
    btn.textContent='✅ Generating — refresh in 30s';
    setTimeout(()=>location.reload(),32000);
  }catch(e){btn.textContent='❌ Error — try again';}
}
const h=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();
if(!${!!standup}||h<7){document.querySelector('.trigger').style.display='block';}
</script>
</body>
</html>`);
});

// POST /cron/standup — generate today's team standup now
app.post('/cron/standup', (_req, res) => {
  res.json({ status: 'started', message: 'Generating standup — check GET /status in ~30s' });
  runDailyTeamStandup()
    .then(r => logCron('standup', 'ok', r))
    .catch(e => { logCron('standup', 'error', e.message); console.error('[Standup] Manual error:', e.message); });
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
// COONEY HOMES INBOUND EMAIL WEBHOOK
// Fires for ALL emails forwarded to info@email.cooneyhomesfl.com
// Setup: GHL Cooney Homes → Workflow → "Customer Replied" (Email)
//        → Action: Send Webhook → https://armando-bot-1.onrender.com/webhook/angi-lead
// Detects source (Angi, Houzz, generic), parses lead name,
// creates GHL contact + opportunity, SMS Spencer
// ═══════════════════════════════════════════════════════════
app.post('/webhook/angi-lead', async (req, res) => {
  res.json({ ok: true });
  try {
    const payload = req.body;

    // ── Extract email fields from GHL webhook payload ────────
    const msgBody = payload?.message?.body
      || payload?.messageBody
      || payload?.body
      || payload?.email?.body
      || '';

    const msgSubject = payload?.message?.subject
      || payload?.subject
      || payload?.email?.subject
      || '';

    const fromEmail = payload?.message?.from
      || payload?.from
      || payload?.email?.from
      || payload?.contact?.email
      || '';

    // ── Detect source ────────────────────────────────────────
    let source = 'Email Lead';
    let tag    = 'email-lead';
    if (fromEmail.includes('angi.com'))  { source = 'Angi';  tag = 'angi-lead'; }
    if (fromEmail.includes('houzz.com')) { source = 'Houzz'; tag = 'houzz-lead'; }
    if (fromEmail.includes('thumbtack')) { source = 'Thumbtack'; tag = 'thumbtack-lead'; }
    if (fromEmail.includes('homeadvisor')) { source = 'HomeAdvisor'; tag = 'homeadvisor-lead'; }

    // ── Parse lead name (multi-format) ──────────────────────
    // Angi:       "Grant Stewart has sent you a message about an Angi project."
    // Houzz:      "New message from Grant Stewart"
    // Generic:    use subject line
    let leadName = '';

    const patterns = [
      /([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s+has sent you a message/,
      /[Nn]ew (?:message|lead|inquiry) from ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
      /([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s+(?:submitted|requested|inquired)/,
      /Name:\s*([A-Za-z]+(?: [A-Za-z]+)+)/,
      /Customer:\s*([A-Za-z]+(?: [A-Za-z]+)+)/,
    ];

    for (const p of patterns) {
      const m = msgBody.match(p);
      if (m) { leadName = m[1]; break; }
    }

    // Fallback: clean up subject line
    if (!leadName && msgSubject) {
      leadName = msgSubject.replace(/^(Re:|Fwd:|New lead:|Lead:)/i,'').trim().slice(0,40);
    }

    if (!leadName) leadName = `${source} Lead`;

    const [firstName, ...rest] = leadName.trim().split(' ');
    const lastName = rest.join(' ') || '';

    const COONEY_KEY      = 'pit-fbb00e26-bee4-43b5-9108-512f61ea71bf';
    const COONEY_LOC      = 'Gc4sUcLiRI2edddJ5Lfl';
    const COONEY_PIPELINE = '3bwYP7DRop9rWrnTFlhf';
    const NEW_LEAD_STAGE  = 'cec57fe9-6746-4667-82c3-bbb6afbcef46';
    const SPENCER_PHONE   = '+14074903632';

    const headers = {
      'Authorization': `Bearer ${COONEY_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    };

    // ── 1. Create contact ────────────────────────────────────
    const contactRes = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      { firstName, lastName, locationId: COONEY_LOC, source, tags: [tag] },
      { headers }
    ).catch(e => { console.error('[CooneyLead] Create contact error:', e.response?.data || e.message); return null; });

    const contactId = contactRes?.data?.contact?.id;
    console.log(`[CooneyLead] Contact created: ${leadName} | source: ${source} (${contactId})`);

    // ── 2. Create opportunity ────────────────────────────────
    if (contactId) {
      await axios.post(
        'https://services.leadconnectorhq.com/opportunities/',
        {
          title: `${source} Lead — ${leadName}`,
          pipelineId: COONEY_PIPELINE,
          pipelineStageId: NEW_LEAD_STAGE,
          contactId,
          locationId: COONEY_LOC,
          status: 'open',
          source
        },
        { headers }
      ).catch(e => console.error('[CooneyLead] Create opportunity error:', e.response?.data || e.message));
      console.log(`[CooneyLead] Opportunity created: ${source} Lead — ${leadName}`);
    }

    // ── 3. Create Task for Spencer + Lincoln ─────────────────
    const loginUrl = source === 'Angi' ? 'https://pro.angi.com' : source === 'Houzz' ? 'https://www.houzz.com/pro' : '';
    const SPENCER_CONTACT = 'u0kqHFG9AzDVnbn4JVL5'; // Spencer Cooney user ID
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // due tomorrow

    if (contactId) {
      await axios.post(
        `https://services.leadconnectorhq.com/contacts/${contactId}/tasks`,
        {
          title: `Follow up — ${source} Lead: ${leadName}`,
          body: `New ${source} lead came in. Contact + opportunity created in GHL.\n${loginUrl ? `Log into ${source} for phone/email: ${loginUrl}` : ''}`,
          dueDate,
          assignedTo: SPENCER_CONTACT,
          completed: false,
        },
        { headers }
      ).catch(e => console.error('[Angi] Task error:', e.response?.data || e.message));
      console.log(`[Angi] Task created for lead: ${leadName}`);
    }

  } catch (err) {
    console.error('[Angi Webhook] Error:', err.message);
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
// ELENA — CLIENT SUCCESS MANAGER → modules/agents/elena.js
// ═══════════════════════════════════════════════════════════
const {
  getElenaClients,
  elenaHealthCheck,
  elenaMonthlyReports,
  elenaMidMonthCheckIn,
  elenaQuarterlyReport,
} = require('./modules/agents/elena')({
  app,
  anthropic, axios, crypto, FormData,
  sendEmail, logActivity,
  GHL_API_KEY, GHL_LOCATION_ID,
  GHL_AGENCY_KEY, GHL_COMPANY_ID,
  OWNER_CONTACT_ID, BOOKING_URL,
  CLOUDINARY_CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
});

// ═══════════════════════════════════════════════════════════
// DIEGO — PROJECT MANAGER → modules/agents/diego.js
// ═══════════════════════════════════════════════════════════
const {
  runDiegoWeeklyReport,
  runDiegoScorecard,
  runDiegoStandup,
} = require('./modules/agents/diego')({
  app,
  anthropic, axios, crypto, FormData,
  sendEmail, logActivity, setAgentBusy, setAgentIdle, agentChat,
  getElenaClients, saveCloudinaryJSON,
  GHL_API_KEY, GHL_LOCATION_ID,
  OWNER_CONTACT_ID,
  CLOUDINARY_CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
  STALE_DAYS, OFFICE_KPI,
});

// ═══════════════════════════════════════════════════════════
// MARCO — CONTENT DIRECTOR → modules/agents/marco.js
// ═══════════════════════════════════════════════════════════
const {
  runMarcoContentBrief,
  runMarcoTrendAlert,
  runMarcoRepurposeBrief,
} = require('./modules/agents/marco')({
  app,
  anthropic, axios,
  sendEmail, logActivity, setAgentBusy, setAgentIdle, agentChat,
  getWeeklyStats, loadContentStrategy, saveCloudinaryJSON,
  OWNER_CONTACT_ID, NEWS_API_KEY, OFFICE_KPI,
});


// ═══════════════════════════════════════════════════════════
// SOFIA — WEB DESIGNER / AUDITOR → modules/agents/sofia.js
// ═══════════════════════════════════════════════════════════
const {
  checkWebsite,
  runSofiaWeeklyCheck,
  runSofiaWeeklySEOPlan,
  runSofiaContentLearning,
  runSofiaBacklinkAudit,
  runSofiaCitationAudit,
  runSofiaBacklinkProspector,
  runSofiaPressRelease,
  runSofiaCitationBuilder,
  runWeeklyRankTracking,
  runWeeklyBacklinkCheck,
  runBacklinkProspecting,
  runClientDailySeoBlog,
  runAllClientsDailyBlog,
  runSofiaRankImprovementLoop,
} = require('./modules/agents/sofia')({
  anthropic, axios, crypto, FormData,
  sendEmail, logActivity, setAgentBusy, setAgentIdle, agentChat,
  getElenaClients, saveCloudinaryJSON,
  GHL_API_KEY, GHL_LOCATION_ID, GHL_AGENCY_KEY, GHL_COMPANY_ID,
  OWNER_CONTACT_ID, BOOKING_URL,
  CLOUDINARY_CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
  DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, DATAFORSEO_BASE,
  GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_BASE,
  APOLLO_API_KEY, NEWS_API_KEY,
  OFFICE_KPI, SEO_CLIENTS,
  onBlogPublished: runMarcoRepurposeBrief,
});

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

// ─── AI Design System (Claude Haiku) ─────────────────────
// Generates industry-specific color palette + font pair for each client.
// Replaces Google Stitch (generate_screen_from_text hangs indefinitely — confirmed broken).
async function generateStitchDesignSystem(clientName, industry, city = 'Orlando') {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: `You are a professional brand designer. Generate a design system for a ${industry} business called "${clientName}" in ${city}. Return ONLY valid JSON (no trailing commas):
{"primary":"#hex","primaryContainer":"#hex","background":"#hex","surface":"#ffffff","headlineFont":"font","bodyFont":"font","borderRadius":"Xpx","designName":"Name"}

Rules:
- primary: strong brand color that fits ${industry} psychology (NOT generic orange — e.g. medical=blue, landscaping=green, legal=navy, food=warm red, tech=purple, construction=dark orange, cleaning=teal)
- primaryContainer: 15% darker shade of primary
- background: very light tint of primary (#f8-#fc range)
- headlineFont: one of: Montserrat, Playfair Display, Raleway, Oswald, Merriweather, Poppins, Lato, Roboto Slab
- bodyFont: one of: Inter, Open Sans, Roboto, Source Sans 3, Lato, Nunito Sans
- borderRadius: 6px (corporate/legal), 10px (general), 16px (friendly/consumer)
- designName: 3-word creative name e.g. "Pacific Blue Modern"` }],
    });
    const raw = res.content[0].text.trim().match(/\{[\s\S]*?\}/)?.[0];
    if (!raw) return null;
    const t = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
    console.log(`[Design] ✅ "${t.designName}" for ${clientName} — ${t.primary}, ${t.headlineFont}/${t.bodyFont}`);
    return {
      designName:       t.designName,
      primary:          t.primary          || '#1a3a6b',
      primaryContainer: t.primaryContainer || '#2e476f',
      background:       t.background       || '#f8fafc',
      surface:          t.surface          || '#ffffff',
      onPrimary:        '#ffffff',
      onSurface:        '#1a1a1a',
      headlineFont:     t.headlineFont     || 'Montserrat',
      bodyFont:         t.bodyFont         || 'Inter',
      borderRadius:     t.borderRadius     || '10px',
    };
  } catch (e) {
    console.error('[Design] Design system failed:', e.message);
    return null;
  }
}

//// ─── DataForSEO: Keyword Research ─────────────────────────
function _parseDseoResults(results) {
  return results
    .filter(r => r.search_volume > 0)
    .map(r => ({ keyword: r.keyword, volume: r.search_volume, competition: r.competition, cpc: r.cpc }))
    .sort((a, b) => (b.volume || 0) - (a.volume || 0));
}

async function getKeywordData(industry, city, locationCode = 2840) {
  try {
    const seed    = `${industry} ${city}`;
    const seeds   = [seed, `best ${industry} ${city}`, `${industry} near me`, `affordable ${industry} ${city}`, `top ${industry} ${city}`];
    const headers = { Authorization: `Basic ${DATASEO_AUTH}`, 'Content-Type': 'application/json' };

    // Run both calls in parallel: volume on seeds + related keywords expansion
    const [volRes, relRes] = await Promise.all([
      axios.post(
        'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
        [{ keywords: seeds, location_code: locationCode, language_code: 'en' }],
        { headers, timeout: 14000 }
      ),
      axios.post(
        'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live',
        [{ keywords: [seed], location_code: locationCode, language_code: 'en', limit: 50 }],
        { headers, timeout: 14000 }
      ),
    ]);

    const seedResults    = volRes.data?.tasks?.[0]?.result || [];
    const relatedResults = relRes.data?.tasks?.[0]?.result || [];

    // Merge — deduplicate by keyword string
    const seen = new Set();
    const merged = [..._parseDseoResults(seedResults), ..._parseDseoResults(relatedResults)]
      .filter(r => { if (seen.has(r.keyword)) return false; seen.add(r.keyword); return true; })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 50);

    console.log(`[DataForSEO] ${merged.length} keywords for "${seed}" — top: "${merged[0]?.keyword}" (${merged[0]?.volume?.toLocaleString()||'?'}/mo)`);
    return merged;
  } catch (err) {
    console.error('[DataForSEO] Keyword error:', err.message);
    return [];
  }
}

// ─── Sofia: AI Content Generator for Landing Pages ───────
async function generateLandingContent(clientName, industry, city, keywords = []) {
  try {
    const kwContext = keywords.length ? (() => {
      const primary   = keywords[0];
      const highVol   = keywords.slice(0, 3);
      const lowComp   = keywords.filter(k => k.competition === 'LOW').slice(0, 4);
      const longTail  = keywords.filter(k => k.keyword.split(' ').length >= 4).slice(0, 5);
      return `
SEO KEYWORD DATA (use these naturally — do NOT stuff):
• Primary target (H1 + title): "${primary.keyword}" — ${primary.volume?.toLocaleString()||'?'}/mo, ${primary.competition} competition
• High-volume to weave into copy: ${highVol.map(k=>`"${k.keyword}"`).join(', ')}
• Low-competition quick wins (use in H2s + FAQs): ${lowComp.map(k=>`"${k.keyword}"`).join(', ')}
• Long-tail phrases (use in FAQ answers + about section): ${longTail.map(k=>`"${k.keyword}"`).join(', ')}
`;
    })() : '';
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Create professional landing page content for "${clientName}", a ${industry} company in ${city}, FL.${kwContext}
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

  // Step 0: Fetch keyword data + design system in parallel
  const [stitch, keywords] = await Promise.all([
    generateStitchDesignSystem(clientName, industry, city),
    getKeywordData(industry, city),
  ]);

  const [c] = await Promise.all([generateLandingContent(clientName, industry, city, keywords)]);
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const phoneClean = (phone || '').replace(/\D/g, '');
  const logoSrc = logoUrl || 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const primaryKw   = keywords?.[0]?.keyword || `${industry} ${city}`;
  const secondaryKw = keywords?.[1]?.keyword || `best ${industry} ${city}`;

  // Apply AI design tokens, fall back to defaults if generation failed
  const primary    = stitch?.primary          || '#1a3a6b';
  const primaryDk  = stitch?.primaryContainer || '#2e476f';
  const secondary  = stitch?.secondary        || '#2563a8';
  const bgColor    = stitch?.background       || '#f8fafc';
  const surfColor  = stitch?.surface          || '#ffffff';
  const textColor  = stitch?.onSurface        || '#374151';
  const borderRad  = stitch?.borderRadius     || '6px';
  const hFont      = stitch?.headlineFont     || 'Montserrat';
  const bFont      = stitch?.bodyFont         || 'Open Sans';
  // Google Fonts import string
  const fontImport = `https://fonts.googleapis.com/css2?family=${hFont.replace(/ /g,'+')}:wght@400;600;700;800;900&family=${bFont.replace(/ /g,'+')}:wght@400;500;600&display=swap`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="description" content="${clientName} — ${secondaryKw}. ${c.heroSubtitle}"/>
<meta name="keywords" content="${primaryKw}, ${secondaryKw}, ${industry} near me, ${clientName}"/>
<title>${clientName} | ${primaryKw.charAt(0).toUpperCase()+primaryKw.slice(1)}</title>
${stitch?.designName ? `<!-- AI Design System: ${stitch.designName} -->` : ''}
${keywords?.length ? `<!-- DataForSEO: top kw "${primaryKw}" ${keywords[0]?.volume?.toLocaleString()||'?'}/mo -->` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://link.msgsndr.com"/>
<link href="${fontImport}" rel="stylesheet"/>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "LocalBusiness",
      "name": clientName,
      "description": c.heroSubtitle,
      "url": `https://${clientName.toLowerCase().replace(/\s+/g,'')}`,
      "telephone": phone || undefined,
      "email": email || undefined,
      "address": { "@type": "PostalAddress", "addressLocality": city, "addressRegion": "FL", "addressCountry": "US" },
      "areaServed": c.areas.map(a => ({ "@type": "City", "name": a })),
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "5", "reviewCount": String(c.reviews.length), "bestRating": "5" },
      "review": c.reviews.map(r => ({ "@type": "Review", "author": { "@type": "Person", "name": r.name }, "reviewRating": { "@type": "Rating", "ratingValue": String(r.stars) }, "reviewBody": r.text })),
    },
    {
      "@type": "FAQPage",
      "mainEntity": c.faqs.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } })),
    },
    {
      "@type": "ItemList",
      "name": `${industry} Services`,
      "itemListElement": c.services.map((s, i) => ({ "@type": "ListItem", "position": i + 1, "name": s.name, "description": s.desc })),
    }
  ]
})}</script>
<style>
:root{--blue-dark:${primary};--blue-mid:${primaryDk};--blue-light:${secondary};--orange:#f97316;--gray-bg:${bgColor};--gray-dark:#1e293b;--text:${textColor};--white:${surfColor};--radius:${borderRad};--font-headline:'${hFont}',sans-serif;--font-body:'${bFont}',sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:var(--font-body);color:var(--text);background:#fff;}
.section,.section-bg,.section-dark{content-visibility:auto;contain-intrinsic-size:0 600px;}
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
.area-item{background:var(--gray-bg);border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;font-size:14px;font-weight:600;color:var(--blue-dark);display:flex;align-items:center;gap:8px;text-decoration:none;transition:border-color .2s,background .2s;}
.area-item::before{content:'📍';font-size:12px;}
a.area-item:hover{border-color:var(--blue-mid);background:#fff;}
.area-current{border-color:var(--orange);background:#fff7ed;color:var(--orange);}
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
/* ── AI font tokens — headline + body fonts selected per industry ── */
.nav-logo span,.hero h1,.form-card h3,.section-title,.stat-num,.srv-card h3,.why-card h3,.step-num,.step h3,.faq-q,.cta-banner h2,.cta-banner a,.footer-col h4,.mobile-bar a,.hero-phone a{font-family:var(--font-headline)!important;}
/* ── AI border-radius token ── */
.nav-cta a,.form-card,.srv-card,.why-card,.step,.review-card,.cta-banner a,.hero-phone a{border-radius:var(--radius)!important;}
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
      <img src="${logoSrc}" alt="${clientName}" width="160" height="40" decoding="async" fetchpriority="high"/>
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
      ${c.areas.map(a => {
        const slug = `/${a.toLowerCase().replace(/\s+/g,'-')}-${industry.toLowerCase().replace(/\s+/g,'-')}`;
        const isCurrent = a.toLowerCase() === city.toLowerCase();
        return isCurrent
          ? `<div class="area-item area-current">${a}</div>`
          : `<a href="${slug}" class="area-item">${a}</a>`;
      }).join('\n      ')}
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
    max_tokens: 4096,
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
  const raw = res.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}';
  const cleaned = raw.replace(/,\s*([}\]])/g, '$1'); // strip trailing commas
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Retry once with Sonnet for better JSON accuracy
    console.warn('[Sofia] generateWebsiteContent JSON parse failed, retrying with Sonnet...');
    const retry = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: `Generate complete website content for a ${industry} business called "${clientName}" in ${city}. Return ONLY valid JSON with no trailing commas:\n{"tagline":"...","heroHeadline":"...","heroSub":"...","stats":[{"number":"150+","label":"Happy Clients"},{"number":"5\u2605","label":"Avg Rating"},{"number":"3yr","label":"Avg Retention"},{"number":"24/7","label":"Support"}],"services":[{"title":"Service","icon":"\uD83C\uDFAF","description":"2 sentences.","features":["f1","f2","f3"]}],"whyUs":[{"title":"Reason","description":"2 sentences."}],"testimonials":[{"name":"Name","business":"Type","text":"2 sentences.","rating":5}],"aboutStory":"3 sentences.","founderBio":"2 sentences.","values":[{"icon":"\uD83C\uDFC6","title":"Value","description":"1 sentence."}],"processSteps":[{"step":"01","title":"Step","description":"2 sentences."}],"faqs":[{"q":"Question?","a":"Answer."}],"areas":["${city}","Area 2","Area 3"],"contactHours":"Mon-Fri 8am-6pm","metaDescription":"Under 160 chars."}` }],
    });
    const raw2 = retry.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}';
    return JSON.parse(raw2.replace(/,\s*([}\]])/g, '$1'));
  }
}

// Fetch real Google Reviews for a business via Places API
async function fetchGoogleReviews(placeId) {
  if (!placeId) return [];
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: { place_id: placeId, fields: 'reviews,rating,user_ratings_total', key: GOOGLE_PLACES_API_KEY },
      timeout: 8000,
    });
    const reviews = res.data?.result?.reviews || [];
    return reviews
      .filter(r => r.rating >= 4)
      .slice(0, 3)
      .map(r => ({ name: r.author_name, text: r.text, rating: r.rating, time: r.relative_time_description }));
  } catch { return []; }
}

// Fetch Pexels images for website gallery section
async function fetchPexelsGallery(industry, city, count = 6) {
  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: `${industry} ${city} professional`, per_page: count, orientation: 'landscape' },
      headers: { Authorization: PEXELS_API_KEY },
      timeout: 8000,
    });
    return (res.data?.photos || []).map(p => ({
      url: p.src?.large2x || p.src?.large || p.src?.medium,
      alt: p.alt || industry,
    }));
  } catch { return []; }
}

// Shared CSS design system + nav + footer used on every page
// tokens = AI design system object (optional). Falls back to orange/Montserrat defaults.
function buildSharedLayout(clientName, industry, city, phone, logoUrl, siteBase = '.', tokens = null) {
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

  // Apply AI design tokens if available, fall back to defaults
  const hFont     = tokens?.headlineFont || 'Fraunces';
  const bFont     = tokens?.bodyFont     || 'Inter';
  const brand     = tokens?.primary          || '#f97316';
  const brandDark = tokens?.primaryContainer || '#ea6c0a';
  const bgLight   = tokens?.background       || '#f9fafb';
  const surface   = tokens?.surface          || '#ffffff';
  const radius    = tokens?.borderRadius     || '14px';
  const fontPairs = hFont === bFont
    ? `family=${hFont.replace(/ /g,'+')}:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900`
    : `family=${hFont.replace(/ /g,'+')}:ital,opsz,wght@0,9..144,700..900;1,9..144,700..900&family=${bFont.replace(/ /g,'+')}:wght@400;500;600`;

  const styles = `
    @import url('https://fonts.googleapis.com/css2?${fontPairs}&display=swap');
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}

    /* ── Luxury Design Tokens ── */
    :root{
      --black:#080808;
      --dark:#111111;
      --gray:#9e9891;
      --light:#f5f0e8;
      --white:#faf7f2;
      --surface:#161616;
      --orange:${brand !== '#f97316' ? brand : '#c4a46b'};
      --orange-dark:${brandDark !== '#ea6c0a' ? brandDark : '#a8894f'};
      --gold:#c4a46b;
      --gold-dark:#a8894f;
      --gold-glow:rgba(196,164,107,0.12);
      --cream:#f5f0e8;
      --cream-2:#ede8df;
      --ink:#080808;
      --text:#e8e2d5;
      --text-muted:rgba(232,226,213,0.55);
      --text-soft:rgba(232,226,213,0.3);
      --radius:${radius !== '14px' ? radius : '3px'};
      --shadow:0 8px 48px rgba(0,0,0,0.55);
      --border:rgba(255,255,255,0.07);
      --border-gold:rgba(196,164,107,0.3);
    }

    /* ── Light theme override ── */
    [data-theme="light"]{
      --black:#f5f0e8;--dark:#ede8df;--surface:#ffffff;--ink:#f5f0e8;
      --text:#1a1a1a;--text-muted:rgba(26,26,26,0.62);--text-soft:rgba(26,26,26,0.38);
      --cream:#0d0d0d;--border:rgba(0,0,0,0.09);--border-gold:rgba(160,130,75,0.35);
      --shadow:0 8px 48px rgba(0,0,0,0.1);--gold-glow:rgba(160,130,75,0.1);
    }
    [data-theme="light"] header{background:rgba(245,240,232,0.96)!important}
    [data-theme="light"] .section-light{background:var(--dark);color:#1a1a1a}

    /* ── Custom cursor (pointer devices only) ── */
    @media(pointer:fine){
      body,a,button{cursor:none!important}
      .cursor-dot{position:fixed;width:7px;height:7px;background:var(--gold);border-radius:50%;pointer-events:none;z-index:10001;transform:translate(-50%,-50%);transition:transform .08s,opacity .3s;mix-blend-mode:difference}
      .cursor-ring{position:fixed;width:34px;height:34px;border:1.5px solid rgba(196,164,107,0.55);border-radius:50%;pointer-events:none;z-index:10000;transform:translate(-50%,-50%);transition:width .22s,height .22s,border-color .22s,opacity .3s;will-change:transform}
      .cursor-dot.clicking{transform:translate(-50%,-50%) scale(2.8)}
      .cursor-ring.hovering{width:54px;height:54px;border-color:var(--gold);opacity:0.85}
    }

    /* ── Image blur-up ── */
    img.img-blur{filter:blur(14px) scale(1.02);transition:filter .7s ease,transform .7s ease;will-change:filter,transform}
    img.img-blur.loaded{filter:blur(0) scale(1)}

    /* ── Floating label forms ── */
    .field-wrap{position:relative;margin-bottom:22px}
    .field-wrap input,.field-wrap textarea,.field-wrap select{width:100%;padding:20px 16px 8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--cream);font-size:15px;outline:none;transition:border-color .25s,box-shadow .25s;font-family:inherit}
    .field-wrap input:focus,.field-wrap textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-glow)}
    .field-wrap label{position:absolute;left:16px;top:15px;font-size:14px;color:var(--text-muted);pointer-events:none;transition:all .2s cubic-bezier(.16,1,.3,1)}
    .field-wrap input:focus~label,.field-wrap input:not(:placeholder-shown)~label,
    .field-wrap textarea:focus~label,.field-wrap textarea:not(:placeholder-shown)~label{top:6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}
    .field-wrap input::placeholder,.field-wrap textarea::placeholder{opacity:0}

    /* ── Grain texture overlay ── */
    body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0.028;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
      background-size:256px 256px}

    html{scroll-behavior:auto}
    body{font-family:'${bFont}',system-ui,sans-serif;color:var(--text);background:var(--black);line-height:1.65}
    h1,h2,h3,h4{font-family:'${hFont}',sans-serif;font-weight:800;line-height:1.12;color:var(--cream)}
    a{text-decoration:none;color:inherit}
    img{max-width:100%;display:block}

    .container{max-width:1140px;margin:0 auto;padding:0 28px}

    /* ── Buttons ── */
    .btn{display:inline-flex;align-items:center;gap:8px;padding:15px 36px;border-radius:var(--radius);font-weight:600;font-size:14px;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;transition:all .22s;border:none}
    .btn-primary{background:var(--gold);color:#000;border:1px solid var(--gold)}
    .btn-primary:hover{background:var(--gold-dark);transform:translateY(-2px);box-shadow:0 8px 32px rgba(196,164,107,0.35)}
    .btn-outline{background:transparent;color:var(--cream);border:1px solid var(--border-gold)}
    .btn-outline:hover{background:var(--gold-glow);border-color:var(--gold);color:var(--gold)}
    .btn-dark{background:var(--surface);color:var(--cream);border:1px solid var(--border)}
    .btn-dark:hover{border-color:var(--gold);color:var(--gold);transform:translateY(-1px)}

    /* ── Sections ── */
    .section{padding:96px 0}
    .section-label{font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--gold);margin-bottom:14px;display:block}
    .section-title{font-size:clamp(28px,4vw,46px);color:var(--cream);margin-bottom:18px;line-height:1.1}
    .section-sub{font-size:17px;color:var(--text-muted);max-width:560px;line-height:1.75}

    /* ── Light cream section variant ── */
    .section-light{background:var(--cream);color:#1a1a1a}
    .section-light h2,.section-light h3,.section-light .section-title{color:#0d0d0d}
    .section-light .section-label{color:var(--gold-dark)}
    .section-light .section-sub,.section-light p{color:rgba(0,0,0,0.6)}
    .section-light .card{background:#fff;border-color:rgba(0,0,0,0.07);box-shadow:0 2px 24px rgba(0,0,0,0.07)}
    .section-light .card:hover{border-color:var(--gold-dark)}

    /* ── Grids ── */
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
    .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
    .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}

    /* ── Cards ── */
    .card{background:var(--surface);border-radius:var(--radius);padding:36px;border:1px solid var(--border);transition:transform .25s,box-shadow .25s,border-color .25s}
    .card:hover{transform:translateY(-5px);box-shadow:var(--shadow);border-color:var(--border-gold)}

    /* ── Badges ── */
    .badge{display:inline-block;background:var(--gold-glow);color:var(--gold);font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:6px 16px;border-radius:2px;border:1px solid var(--border-gold)}

    /* ── Page hero (inner pages) ── */
    .page-hero{background:var(--black);padding:88px 0 64px;text-align:center;border-bottom:1px solid var(--border)}
    .page-hero h1{color:var(--cream);font-size:clamp(32px,5vw,52px);margin-bottom:16px}
    .page-hero p{color:var(--text-muted);font-size:17px;max-width:560px;margin:0 auto}

    .stars{color:var(--gold);font-size:13px;letter-spacing:3px}

    /* ── Divider ── */
    .divider-gold{width:48px;height:2px;background:var(--gold);margin:20px 0 32px}

    /* ── Animations ── */
    @keyframes heroGlow{0%,100%{opacity:.04}50%{opacity:.09}}
    @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}
    @keyframes floatPulse{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
    @keyframes goldPulse{0%,100%{box-shadow:0 0 0 0 rgba(196,164,107,0)}50%{box-shadow:0 0 0 8px rgba(196,164,107,0)}}

    .fade-in{opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}
    .fade-in.visible{opacity:1;transform:translateY(0)}
    .card.fade-in{transition-delay:calc(var(--i,0) * 90ms)}

    .btn-primary{position:relative;overflow:hidden}
    .btn-primary::after{content:'';position:absolute;top:0;left:-100%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);transform:skewX(-20deg);animation:shimmer 3.5s infinite 2s}

    .hero-glow{position:absolute;inset:0;background:radial-gradient(ellipse at 60% 50%,rgba(196,164,107,0.08),transparent 65%);animation:heroGlow 6s ease-in-out infinite;pointer-events:none}

    header{transition:background .3s,box-shadow .3s,backdrop-filter .3s}

    /* ── Floating CTA ── */
    .float-cta{position:fixed;bottom:96px;right:28px;z-index:997;display:flex;flex-direction:column;align-items:center;gap:10px}
    .float-cta a{width:52px;height:52px;border-radius:var(--radius);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(0,0,0,0.4);transition:transform .2s,box-shadow .2s;font-size:18px;text-decoration:none;border:1px solid rgba(255,255,255,0.1)}
    .float-cta a:hover{transform:scale(1.1) translateY(-2px);box-shadow:0 10px 32px rgba(0,0,0,0.5)}
    .float-cta .fcta-quote{background:var(--gold);color:#000;border-color:var(--gold);animation:floatPulse 3s ease-in-out infinite}
    .float-cta .fcta-call{background:#166534;color:#fff;}

    /* ── Mobile sticky CTA bar ── */
    .mobile-cta-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:998;background:var(--black);border-top:1px solid var(--border-gold);padding:10px 16px;gap:10px}

    /* ── Trust badges ── */
    .trust-strip{background:var(--surface);padding:12px 0;border-bottom:1px solid var(--border)}
    .trust-strip-inner{display:flex;align-items:center;justify-content:center;gap:36px;flex-wrap:wrap}
    .trust-badge{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:12px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase}
    .trust-badge span{font-size:14px;color:var(--gold)}

    /* ── Marquee trust strip ── */
    .marquee-outer{overflow:hidden;width:100%;background:var(--surface);border-bottom:1px solid var(--border)}
    .marquee-inner{display:flex;width:max-content;animation:marqueeScroll 36s linear infinite}
    .marquee-inner:hover{animation-play-state:paused}
    .marquee-item{display:flex;align-items:center;gap:10px;padding:14px 40px;white-space:nowrap;color:var(--text-muted);font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;border-right:1px solid var(--border)}
    .marquee-item .mi-icon{font-size:15px;color:var(--gold)}
    .marquee-item strong{color:var(--cream)}

    /* ── Split hero headline ── */
    .hero-split-text .word{display:inline-block;overflow:hidden;vertical-align:bottom;line-height:1.1;margin-right:0.25em}
    .hero-split-text .word span{display:inline-block;animation:slideUpWord .75s cubic-bezier(.16,1,.3,1) both}

    /* ── Stagger card reveals ── */
    .grid-3 .card:nth-child(1){--i:0}.grid-3 .card:nth-child(2){--i:1}.grid-3 .card:nth-child(3){--i:2}
    .grid-4 .card:nth-child(1){--i:0}.grid-4 .card:nth-child(2){--i:1}.grid-4 .card:nth-child(3){--i:2}.grid-4 .card:nth-child(4){--i:3}
    .card.fade-in{transition-delay:calc(var(--i,0) * 110ms)}

    /* ── Gold left-border reveal on card hover ── */
    .card{position:relative;overflow:hidden}
    .card::before{content:'';position:absolute;left:0;top:10%;height:80%;width:2px;background:var(--gold);transform:scaleY(0);transform-origin:bottom;transition:transform .35s cubic-bezier(.16,1,.3,1)}
    .card:hover::before{transform:scaleY(1)}

    /* ── Magnetic CTA ── */
    .btn-primary{isolation:isolate;transition:transform .15s ease,box-shadow .15s ease,background .25s,color .25s}
    .btn-primary.is-magnetic{will-change:transform}

    /* ── Pulse ring on primary CTA ── */
    .btn-primary.pulse-ring{animation:pulseRing 2.4s ease infinite}

    /* ── Page entrance fade ── */
    body{animation:pageFade .5s ease both}

    /* ── Parallax hero ── */
    .parallax-bg{will-change:transform;transition:transform .1s linear}

    /* ── Additional keyframes ── */
    @keyframes slideUpWord{from{opacity:0;transform:translateY(110%)}to{opacity:1;transform:translateY(0)}}
    @keyframes marqueeScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes pageFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(196,164,107,0.5)}70%{box-shadow:0 0 0 16px rgba(196,164,107,0)}100%{box-shadow:0 0 0 0 rgba(196,164,107,0)}}

    @media(max-width:768px){
      .mobile-cta-bar{display:flex}
      .float-cta{display:none}
      body{padding-bottom:72px}
      .grid-2,.grid-3,.grid-4{grid-template-columns:1fr}
      .section{padding:64px 0}
      .hide-mobile{display:none!important}
      .nav-menu{display:none;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:rgba(8,8,8,0.98);backdrop-filter:blur(16px);padding:20px 28px;gap:6px;border-top:1px solid var(--border-gold)}
      .nav-menu.open{display:flex}
      .hamburger{display:flex!important}
    }
    /* ── 3D Card tilt ── */
    .card{transform-style:preserve-3d;will-change:transform}
    /* ── View Transitions ── */
    @keyframes vt-out{to{opacity:0;transform:translateY(-8px)}}
    @keyframes vt-in{from{opacity:0;transform:translateY(8px)}}
    ::view-transition-old(root){animation:.28s ease both vt-out}
    ::view-transition-new(root){animation:.28s ease both vt-in}
    /* ── Canvas hero ── */
    #heroCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
  `;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${clientName}" style="height:40px;width:auto;">`
    : `<span style="font-family:Montserrat,sans-serif;font-weight:900;font-size:18px;color:#fff;">${clientName}</span>`;

  const nav = `
<header style="position:sticky;top:0;z-index:999;background:rgba(8,8,8,0.95);border-bottom:1px solid var(--border);backdrop-filter:blur(12px);">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;height:72px;">
    <a href="${navLinks[0].href}" style="display:flex;align-items:center;">${logoHtml}</a>
    <nav class="nav-menu" id="navMenu" style="display:flex;align-items:center;gap:2px;">
      ${navItems}
    </nav>
    <div style="display:flex;align-items:center;gap:14px;">
      <button id="themeToggle" title="Toggle theme" style="background:none;border:1px solid var(--border);border-radius:var(--radius);color:var(--text-muted);font-size:13px;padding:7px 12px;cursor:pointer;transition:border-color .2s,color .2s;" onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">☾</button>
      <a href="${navLinks[4].href}" class="btn btn-primary" style="padding:11px 24px;font-size:12px;">Free Quote</a>
      <button class="hamburger" onclick="document.getElementById('navMenu').classList.toggle('open')" style="display:none;background:none;border:none;cursor:pointer;padding:4px;">
        <svg width="22" height="22" fill="none" stroke="var(--cream)" stroke-width="1.5"><line x1="3" y1="6" x2="19" y2="6"/><line x1="3" y1="11" x2="19" y2="11"/><line x1="3" y1="16" x2="19" y2="16"/></svg>
      </button>
    </div>
  </div>
</header>
<style>
  .nav-link{color:var(--text-muted);font-size:13px;font-weight:500;letter-spacing:0.04em;padding:8px 14px;border-radius:2px;transition:all .2s}
  .nav-link:hover{color:var(--cream);background:rgba(255,255,255,0.05)}
</style>`;

  const footer = `
<footer style="background:var(--black);padding:80px 0 36px;border-top:1px solid var(--border);">
  <div class="container">
    <!-- Gold accent line -->
    <div style="width:64px;height:1px;background:var(--gold);margin-bottom:56px;opacity:0.6;"></div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:56px;padding-bottom:56px;border-bottom:1px solid var(--border);">
      <div>
        ${logoHtml}
        <p style="color:var(--text-soft);font-size:14px;line-height:1.85;margin:20px 0 24px;max-width:260px;">Premium ${industry} services in ${city} and surrounding areas. Licensed, insured, and trusted.</p>
        ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="color:var(--gold);font-size:16px;font-weight:600;letter-spacing:0.02em;">${phone}</a>` : ''}
      </div>
      <div>
        <p style="color:var(--text-soft);font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:20px;">Navigation</p>
        ${navLinks.map(l => `<a href="${l.href}" style="display:block;color:var(--text-muted);font-size:13px;margin-bottom:12px;transition:color .2s;" onmouseover="this.style.color='var(--cream)'" onmouseout="this.style.color='var(--text-muted)'">${l.label}</a>`).join('')}
      </div>
      <div>
        <p style="color:var(--text-soft);font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:20px;">Service Area</p>
        <p style="color:var(--text-muted);font-size:13px;line-height:2.1;">Available 24/7<br/>${city} & Surrounding<br/>Licensed & Insured<br/>Free Estimates</p>
      </div>
      <div>
        <p style="color:var(--text-soft);font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:20px;">Contact</p>
        ${phone ? `<p style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">${phone}</p>` : ''}
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">${city}, FL</p>
        <a href="${navLinks[4].href}" class="btn btn-outline" style="margin-top:20px;padding:11px 22px;font-size:12px;">Get a Free Quote</a>
      </div>
    </div>
    <div style="padding-top:28px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <p style="color:var(--text-soft);font-size:11px;letter-spacing:0.04em;">© ${new Date().getFullYear()} ${clientName}. All rights reserved.</p>
      <p style="color:var(--text-soft);font-size:11px;letter-spacing:0.04em;">Designed by <a href="https://jrzmarketing.com" style="color:var(--gold);transition:opacity .2s;" onmouseover="this.style.opacity='.7'" onmouseout="this.style.opacity='1'">JRZ Marketing</a></p>
    </div>
  </div>
</footer>

<!-- Floating CTA (desktop) -->
<div class="float-cta">
  <a href="${navLinks[4].href}" class="fcta-quote" title="Get a Free Quote">💬</a>
  ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="fcta-call" title="Call Now">📞</a>` : ''}
</div>

<!-- Mobile sticky CTA bar -->
<div class="mobile-cta-bar">
  <a href="${navLinks[4].href}" class="btn btn-primary" style="flex:1;justify-content:center;padding:12px;">Get Free Quote</a>
  ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn" style="flex:1;justify-content:center;padding:12px;background:#22c55e;color:#fff;">📞 Call Now</a>` : ''}
</div>`;

  const scripts = `
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script>
  // ── Nav: close on mobile link click + active highlight ──
  document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', () => {
    document.getElementById('navMenu').classList.remove('open');
  }));
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(l => {
    if (l.getAttribute('href') === path || (path.endsWith(l.getAttribute('href').split('/').pop()) && l.getAttribute('href') !== '/')) {
      l.style.color = 'var(--orange)'; l.style.background = 'rgba(249,115,22,0.1)';
    }
  });

  // ── Nav: shrink on scroll ──
  const header = document.querySelector('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      header.style.boxShadow = '0 4px 32px rgba(0,0,0,0.25)';
      header.style.background = 'rgba(10,10,10,0.97)';
      header.style.backdropFilter = 'blur(12px)';
    } else {
      header.style.boxShadow = 'none';
      header.style.background = 'var(--black)';
      header.style.backdropFilter = 'none';
    }
  }, { passive: true });

  // ── Scroll fade-in (Intersection Observer) ──
  const fadeEls = document.querySelectorAll('.section, .card, .page-hero, section');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
    });
  }, { threshold: 0.08 });
  fadeEls.forEach(el => { el.classList.add('fade-in'); observer.observe(el); });

  // ── Stat counter animation ──
  function animateCount(el) {
    const target = parseFloat(el.dataset.target);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    if (isNaN(target)) return;
    const duration = 1800;
    const start = performance.now();
    const isDecimal = target % 1 !== 0;
    function step(now) {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const val = isDecimal ? (target * ease).toFixed(1) : Math.round(target * ease);
      el.textContent = prefix + val + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('[data-target]').forEach(animateCount);
        statObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.stat-block').forEach(el => statObserver.observe(el));

  // ── Parallax hero ──
  const parallaxEl = document.querySelector('.parallax-bg');
  if (parallaxEl) {
    window.addEventListener('scroll', () => {
      parallaxEl.style.transform = 'translateY(' + (window.scrollY * 0.28) + 'px)';
    }, { passive: true });
  }

  // ── Magnetic CTA buttons ──
  document.querySelectorAll('.btn-primary').forEach(btn => {
    btn.classList.add('is-magnetic');
    btn.addEventListener('mousemove', e => {
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) * 0.28;
      const dy = (e.clientY - r.top - r.height / 2) * 0.28;
      btn.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });

  // ── Pulse ring on first visible CTA ──
  const firstCta = document.querySelector('.btn-primary');
  if (firstCta) setTimeout(() => firstCta.classList.add('pulse-ring'), 2200);

  // ── Split hero text ──
  document.querySelectorAll('.hero-split-text').forEach(el => {
    const words = el.innerText.split(' ');
    el.innerHTML = words.map((w, i) =>
      '<span class="word"><span style="animation-delay:' + (i * 0.08) + 's">' + w + '</span></span>'
    ).join(' ');
  });

  // ── Custom cursor ──
  if (window.matchMedia('(pointer:fine)').matches) {
    const dot = document.createElement('div'); dot.className = 'cursor-dot';
    const ring = document.createElement('div'); ring.className = 'cursor-ring';
    document.body.append(dot, ring);
    let rx = 0, ry = 0, rafId;
    document.addEventListener('mousemove', e => {
      dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px';
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rx += (e.clientX - rx) * 0.14; ry += (e.clientY - ry) * 0.14;
        ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
      });
    });
    document.addEventListener('mousedown', () => dot.classList.add('clicking'));
    document.addEventListener('mouseup', () => dot.classList.remove('clicking'));
    document.querySelectorAll('a,button,.btn').forEach(el => {
      el.addEventListener('mouseenter', () => ring.classList.add('hovering'));
      el.addEventListener('mouseleave', () => ring.classList.remove('hovering'));
    });
  }

  // ── Image blur-up lazy load ──
  const imgObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const img = e.target;
      img.classList.add('img-blur');
      if (img.complete) { img.classList.add('loaded'); }
      else { img.addEventListener('load', () => img.classList.add('loaded'), { once: true }); }
      imgObs.unobserve(img);
    });
  }, { rootMargin: '180px' });
  document.querySelectorAll('img[loading="lazy"]').forEach(img => imgObs.observe(img));

  // ── Dark / light toggle ──
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const stored = localStorage.getItem('site-theme');
    if (stored) { document.documentElement.setAttribute('data-theme', stored); themeToggle.textContent = stored === 'light' ? '○' : '☾'; }
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('site-theme', next);
      themeToggle.textContent = next === 'light' ? '○' : '☾';
    });
  }

  // ── 1. Lenis smooth scroll ──
  if (window.Lenis) {
    const lenis = new Lenis({ lerp: 0.08, smoothWheel: true, touchMultiplier: 1.5 });
    if (window.gsap) {
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    }
    // Anchor links work with Lenis
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const target = document.querySelector(a.getAttribute('href'));
        if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: -80, duration: 1.4 }); }
      });
    });
  }

  // ── 2. GSAP ScrollTrigger reveals ──
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    // Section headings
    gsap.utils.toArray('.section-title, .section-label').forEach(el => {
      gsap.from(el, { opacity: 0, y: 28, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 86%' } });
    });
    // Cards staggered
    gsap.utils.toArray('.grid-3, .grid-4').forEach(grid => {
      gsap.from(grid.querySelectorAll('.card'), {
        opacity: 0, y: 44, duration: 0.75, ease: 'power2.out', stagger: 0.12,
        scrollTrigger: { trigger: grid, start: 'top 82%' }
      });
    });
    // Stat counters
    gsap.utils.toArray('[data-target]').forEach(el => {
      ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true,
        onEnter: () => {
          const target = parseFloat(el.dataset.target);
          const suffix = el.dataset.suffix || '';
          const prefix = el.dataset.prefix || '';
          if (isNaN(target)) return;
          gsap.to({ val: 0 }, { val: target, duration: 1.8, ease: 'power2.out',
            onUpdate: function() {
              el.textContent = prefix + (target % 1 !== 0 ? this.targets()[0].val.toFixed(1) : Math.round(this.targets()[0].val)) + suffix;
            }
          });
        }
      });
    });
    // Hero text timeline
    const heroEl = document.querySelector('.hero-split-text');
    if (heroEl) {
      gsap.from(heroEl.querySelectorAll('.word span'), {
        opacity: 0, y: '110%', duration: 0.8, ease: 'power3.out', stagger: 0.07, delay: 0.1
      });
    }
  } else {
    // IO fallback
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.section, .card, .page-hero, section').forEach(el => {
      el.classList.add('fade-in'); io.observe(el);
    });
  }

  // ── 3. 3D Card tilt ──
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width  / 2) / (r.width  / 2);
      const y = (e.clientY - r.top  - r.height / 2) / (r.height / 2);
      card.style.transform = 'perspective(800px) rotateY(' + (x*9) + 'deg) rotateX(' + (-y*9) + 'deg) translateZ(6px)';
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });

  // ── 4. View Transitions API ──
  if (document.startViewTransition) {
    document.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      if (a.target === '_blank') return;
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
        e.preventDefault();
        document.startViewTransition(() => { window.location = url.href; });
      } catch (_) {}
    });
  }

  // ── 5. Canvas hero gradient ──
  (function() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let t = 0;
    const blobs = [
      { x: 0.72, y: 0.45, r: 0.58, c: 'rgba(196,164,107,0.09)' },
      { x: 0.18, y: 0.75, r: 0.42, c: 'rgba(196,164,107,0.05)' },
      { x: 0.50, y: 0.18, r: 0.38, c: 'rgba(168,137,79,0.06)'  },
    ];
    function resize() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);
    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      blobs.forEach((b, i) => {
        const ox = Math.sin(t * 0.0007 + i * 2.1) * 0.09;
        const oy = Math.cos(t * 0.0005 + i * 1.7) * 0.07;
        const cx = (b.x + ox) * w, cy = (b.y + oy) * h;
        const rad = b.r * Math.min(w, h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, b.c); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
      t++; requestAnimationFrame(draw);
    }
    draw();
  })();
</script>`;

  return { styles, nav, footer, scripts };
}

function wrapPage(title, metaDesc, industry, city, bodyHtml, layout, client = {}) {
  const { name = '', phone = '' } = client;
  const schema = name ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    'name': name,
    'description': metaDesc,
    '@id': '#business',
    'telephone': phone || undefined,
    'address': { '@type': 'PostalAddress', 'addressLocality': city, 'addressRegion': 'FL', 'addressCountry': 'US' },
    'areaServed': { '@type': 'City', 'name': city },
    'knowsAbout': industry,
    'priceRange': '$$',
  })}<\/script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://fonts.googleapis.com">
${schema}
<style>${layout.styles}</style>
</head>
<body>
${layout.nav}
${bodyHtml}
${layout.footer}
${layout.scripts}
</body></html>`;
}

// Deterministically pick hero layout 0/1/2 based on client name hash
function getLayoutVariant(clientName) {
  let h = 0;
  for (let i = 0; i < clientName.length; i++) h = (h * 31 + clientName.charCodeAt(i)) | 0;
  return Math.abs(h) % 3;
}

function buildHomePage(client, c, layout) {
  const { name, phone, city, industry, formId, galleryImages, videoUrl } = client;
  const variant = getLayoutVariant(name);
  const serviceCards = c.services.slice(0, 3).map(s => `
    <div class="card">
      <div style="font-size:28px;margin-bottom:20px;filter:grayscale(0.2);">${s.icon}</div>
      <div style="width:28px;height:1px;background:var(--gold-dark);margin-bottom:16px;opacity:0.6;"></div>
      <h3 style="font-size:19px;margin-bottom:10px;color:var(--cream,#0d0d0d);">${s.title}</h3>
      <p style="color:var(--gray);font-size:14px;line-height:1.8;margin-bottom:18px;">${s.description}</p>
      <ul style="list-style:none;padding:0;">${s.features.map(f => `<li style="font-size:13px;color:var(--gray);padding:5px 0;padding-left:20px;position:relative;border-bottom:1px solid rgba(0,0,0,0.04);"><span style="position:absolute;left:0;color:var(--gold,var(--orange));font-weight:700;font-size:11px;top:6px;">✦</span>${f}</li>`).join('')}</ul>
    </div>`).join('');

  const statItems = c.stats.map(s => {
    const num = parseFloat(s.number.replace(/[^0-9.]/g,''));
    const suffix = s.number.replace(/[0-9.]/g,'');
    return `<div style="text-align:center;padding:24px 16px;border-right:1px solid var(--border);">
      <div style="font-size:38px;font-weight:900;color:var(--gold);font-family:Montserrat,sans-serif;letter-spacing:-0.02em;" data-target="${num}" data-suffix="${suffix}">${s.number}</div>
      <div style="font-size:10px;color:var(--text-soft,rgba(255,255,255,0.35));text-transform:uppercase;letter-spacing:0.16em;margin-top:8px;">${s.label}</div>
    </div>`;
  }).join('');

  const testimonialCards = c.testimonials.map(t => `
    <div class="card" style="border-color:var(--border);">
      <div class="stars" style="margin-bottom:16px;">${'★'.repeat(t.rating)}</div>
      <p style="font-size:15px;color:var(--text-muted,rgba(0,0,0,0.6));line-height:1.85;margin-bottom:24px;font-style:italic;">"${t.text}"</p>
      <div style="display:flex;align-items:center;gap:14px;padding-top:20px;border-top:1px solid var(--border);">
        <div style="width:40px;height:40px;border-radius:2px;background:var(--gold-glow,rgba(196,164,107,0.15));border:1px solid var(--border-gold,rgba(196,164,107,0.3));display:flex;align-items:center;justify-content:center;color:var(--gold,#c4a46b);font-weight:700;font-size:16px;font-family:Montserrat,sans-serif;flex-shrink:0;">${t.name[0]}</div>
        <div><div style="font-weight:600;font-size:14px;color:var(--cream,#0d0d0d);">${t.name}</div><div style="font-size:11px;color:var(--gray);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">${t.business}</div></div>
      </div>
    </div>`).join('');

  const whyItems = c.whyUs.map(w => `
    <div style="display:flex;gap:20px;align-items:flex-start;padding-bottom:24px;border-bottom:1px solid var(--border);">
      <div style="width:36px;height:36px;border-radius:2px;background:var(--gold-glow);border:1px solid var(--border-gold);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="14" height="14" fill="var(--gold)" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>
      </div>
      <div><h4 style="font-size:16px;margin-bottom:6px;color:var(--cream);">${w.title}</h4><p style="font-size:14px;color:var(--text-muted);line-height:1.75;">${w.description}</p></div>
    </div>`).join('');

  // Hero: 3 layout variants selected deterministically per client
  const heroHtml = variant === 1
    // Variant 1 — Split: text left, stats panel right
    ? `<section style="background:var(--black);padding:96px 0;overflow:hidden;border-bottom:1px solid var(--border);">
  <div class="container">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center;">
      <div>
        <div class="badge" style="margin-bottom:24px;">${city} ${industry}</div>
        <div class="divider-gold"></div>
        <h1 class="hero-split-text" style="font-size:clamp(32px,5vw,56px);color:var(--cream);line-height:1.08;margin-bottom:20px;">${c.heroHeadline}</h1>
        <p style="font-size:17px;color:var(--text-muted);line-height:1.8;margin-bottom:36px;max-width:480px;">${c.heroSub}</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;">
          <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="font-size:14px;padding:15px 36px;">Get a Free Quote</a>
          ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="font-size:14px;padding:15px 32px;">${phone}</a>` : ''}
        </div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border-gold);border-radius:3px;padding:44px;">
        <p style="color:var(--text-soft);font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:28px;">By The Numbers</p>
        <div class="stat-block" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:36px;">
          ${c.stats.map(s => { const n=parseFloat(s.number.replace(/[^0-9.]/g,'')); const sx=s.number.replace(/[0-9.]/g,''); return `<div style="padding:20px 0;border-bottom:1px solid var(--border);"><div style="font-size:30px;font-weight:900;color:var(--gold);font-family:Montserrat,sans-serif;" data-target="${n}" data-suffix="${sx}">${s.number}</div><div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.14em;margin-top:6px;">${s.label}</div></div>`; }).join('')}
        </div>
        <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;">Book Free Consultation</a>
      </div>
    </div>
  </div>
</section>`
    : variant === 2
    // Variant 2 — Editorial: bold centered, dark with gold line accent
    ? `<section style="background:var(--black);padding:120px 0 100px;text-align:center;overflow:hidden;position:relative;border-bottom:1px solid var(--border);">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% -10%,rgba(196,164,107,0.07),transparent 65%);pointer-events:none;"></div>
  <div class="container" style="position:relative;">
    <div style="display:inline-block;width:40px;height:1px;background:var(--gold);margin-bottom:24px;vertical-align:middle;margin-right:12px;opacity:0.7;"></div>
    <span class="section-label" style="display:inline;vertical-align:middle;">${city} ${industry}</span>
    <div style="display:inline-block;width:40px;height:1px;background:var(--gold);margin-bottom:24px;vertical-align:middle;margin-left:12px;opacity:0.7;"></div>
    <h1 class="hero-split-text" style="font-size:clamp(40px,7vw,76px);color:var(--cream);line-height:1.04;margin-bottom:24px;max-width:860px;margin-left:auto;margin-right:auto;">${c.heroHeadline}</h1>
    <p style="font-size:19px;color:var(--text-muted);line-height:1.75;margin-bottom:44px;max-width:520px;margin-left:auto;margin-right:auto;">${c.heroSub}</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="font-size:15px;padding:17px 44px;">Get a Free Quote</a>
      ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="font-size:15px;padding:17px 36px;">${phone}</a>` : ''}
    </div>
    <div class="stat-block" style="display:flex;justify-content:center;gap:64px;margin-top:64px;flex-wrap:wrap;padding-top:48px;border-top:1px solid var(--border);">
      ${c.stats.map(s => { const n=parseFloat(s.number.replace(/[^0-9.]/g,'')); const sx=s.number.replace(/[0-9.]/g,''); return `<div style="text-align:center;"><div style="font-size:36px;font-weight:900;color:var(--gold);" data-target="${n}" data-suffix="${sx}">${s.number}</div><div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.18em;margin-top:6px;">${s.label}</div></div>`; }).join('')}
    </div>
  </div>
</section>`
    // Variant 0 (default) — Dark editorial with gold glow + optional video bg
    : `<section style="background:var(--black);padding:112px 0 88px;overflow:hidden;position:relative;border-bottom:1px solid var(--border);">
  <canvas id="heroCanvas"></canvas>
  ${videoUrl && !videoUrl.includes('youtube') && !videoUrl.includes('youtu.be') ? `
  <video autoplay muted loop playsinline class="parallax-bg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.28;pointer-events:none;z-index:0;">
    <source src="${videoUrl}" type="video/mp4">
  </video>
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,8,0.88) 55%,rgba(8,8,8,0.4));z-index:1;pointer-events:none;"></div>` : `
  <div class="hero-glow"></div>
  <div class="parallax-bg" style="position:absolute;inset:0;pointer-events:none;z-index:1;"></div>`}
  <div class="container" style="position:relative;z-index:2;">
    <div style="max-width:740px;">
      <div class="badge" style="margin-bottom:24px;">${city} ${industry}</div>
      <div class="divider-gold"></div>
      <h1 class="hero-split-text" style="font-size:clamp(36px,6vw,68px);color:var(--cream);line-height:1.06;margin-bottom:22px;letter-spacing:-0.02em;">${c.heroHeadline}</h1>
      <p style="font-size:18px;color:var(--text-muted);line-height:1.8;margin-bottom:40px;max-width:520px;">${c.heroSub}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="font-size:14px;padding:15px 36px;">Get a Free Quote</a>
        ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="font-size:14px;padding:15px 32px;">${phone}</a>` : ''}
      </div>
    </div>
  </div>
</section>`;

  const body = `${heroHtml}

<!-- Marquee trust strip -->
<div class="marquee-outer">
  <div class="marquee-inner">
    <div class="marquee-item"><span class="mi-icon">★</span> <strong>Google 5-Star Rated</strong></div>
    <div class="marquee-item"><span class="mi-icon">✦</span> <strong>Licensed & Insured</strong></div>
    <div class="marquee-item"><span class="mi-icon">✓</span> <strong>Free Estimates</strong></div>
    <div class="marquee-item"><span class="mi-icon">◈</span> Serving <strong>${city}</strong> & Surrounding</div>
    <div class="marquee-item"><span class="mi-icon">⚡</span> <strong>Same-Day Response</strong></div>
    <div class="marquee-item"><span class="mi-icon">✦</span> <strong>Trusted Local Experts</strong></div>
    <div class="marquee-item"><span class="mi-icon">★</span> <strong>Google 5-Star Rated</strong></div>
    <div class="marquee-item"><span class="mi-icon">✦</span> <strong>Licensed & Insured</strong></div>
    <div class="marquee-item"><span class="mi-icon">✓</span> <strong>Free Estimates</strong></div>
    <div class="marquee-item"><span class="mi-icon">◈</span> Serving <strong>${city}</strong> & Surrounding</div>
    <div class="marquee-item"><span class="mi-icon">⚡</span> <strong>Same-Day Response</strong></div>
    <div class="marquee-item"><span class="mi-icon">✦</span> <strong>Trusted Local Experts</strong></div>
  </div>
</div>

${variant === 0 ? `<section style="background:var(--surface,#161616);padding:0;border-bottom:1px solid var(--border);">
  <div class="container">
    <div class="stat-block" style="display:grid;grid-template-columns:repeat(4,1fr);">${statItems}</div>
  </div>
</section>` : ''}

<section class="section section-light">
  <div class="container">
    <div style="text-align:center;margin-bottom:64px;">
      <p class="section-label">What We Do</p>
      <h2 class="section-title">Our Core Services</h2>
      <div style="width:48px;height:1px;background:var(--gold-dark);margin:20px auto 24px;opacity:0.5;"></div>
      <p class="section-sub" style="margin:0 auto;">${c.tagline}</p>
    </div>
    <div class="grid-3">${serviceCards}</div>
    <div style="text-align:center;margin-top:48px;">
      <a href="${(client.siteBase||'')}/services" class="btn btn-dark">View All Services</a>
    </div>
  </div>
</section>

<section class="section" style="background:var(--black);">
  <div class="container">
    <div class="grid-2">
      <div>
        <p class="section-label">Why Choose Us</p>
        <h2 class="section-title" style="margin-bottom:12px;">The ${name} Difference</h2>
        <div class="divider-gold" style="margin-bottom:36px;"></div>
        <div style="display:flex;flex-direction:column;gap:28px;">${whyItems}</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border-gold);border-radius:3px;padding:52px;">
        <p style="color:var(--gold);font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:24px;">Start Today</p>
        <h3 style="color:var(--cream);font-size:26px;margin-bottom:16px;line-height:1.2;">Get Your Free Consultation</h3>
        <p style="color:var(--text-muted);font-size:15px;line-height:1.8;margin-bottom:36px;">Join hundreds of satisfied customers in ${city}. No pressure, no obligation — just expert advice.</p>
        <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="width:100%;justify-content:center;padding:15px;">Book Free Consultation</a>
        ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="display:block;text-align:center;color:var(--text-muted);font-size:13px;margin-top:16px;letter-spacing:0.04em;">or call ${phone}</a>` : ''}
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--ink-2,#111);">
  <div class="container">
    <div style="text-align:center;margin-bottom:64px;">
      <p class="section-label">Client Stories</p>
      <h2 class="section-title">What Our Clients Say</h2>
      <div style="width:48px;height:1px;background:var(--gold);margin:20px auto 0;opacity:0.4;"></div>
    </div>
    <div class="grid-3">${testimonialCards}</div>
  </div>
</section>

${galleryImages && galleryImages.length ? `
<section class="section section-light">
  <div class="container">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:48px;flex-wrap:wrap;gap:20px;">
      <div>
        <p class="section-label">Our Work</p>
        <h2 class="section-title">Real Results in ${city}</h2>
        <div class="divider-gold"></div>
      </div>
      <p style="color:rgba(0,0,0,0.45);font-size:14px;max-width:320px;line-height:1.7;">Every project is a commitment to quality craftsmanship.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
      ${galleryImages.map((img,i) => `<div style="aspect-ratio:${i===0?'8/5':'4/3'};overflow:hidden;border-radius:2px;background:#1a1a1a;${i===0?'grid-column:span 1;':''}" ><img loading="lazy" src="${img.url}" alt="${img.alt}" style="width:100%;height:100%;object-fit:cover;transition:transform .5s,filter .5s;filter:brightness(0.95);" onmouseover="this.style.transform='scale(1.04)';this.style.filter='brightness(1)'" onmouseout="this.style.transform='scale(1)';this.style.filter='brightness(0.95)'"></div>`).join('')}
    </div>
  </div>
</section>` : ''}

<section class="section" style="background:var(--black);overflow:hidden;border-top:1px solid var(--border);">
  <div class="container">
    <div class="grid-2" style="gap:64px;align-items:center;">
      <div>
        <p class="section-label">Our Process</p>
        <h2 class="section-title" style="margin-bottom:12px;">Real Work.<br/>Real Results.</h2>
        <div class="divider-gold" style="margin-bottom:28px;"></div>
        <p style="color:var(--text-muted);font-size:15px;line-height:1.8;margin-bottom:36px;">We deliver exceptional ${industry} results for clients across ${city} — on time, every time.</p>
        <div style="display:flex;flex-direction:column;gap:0;">
          ${c.processSteps.slice(0,3).map((s,i) => `<div style="display:flex;gap:16px;align-items:flex-start;padding:20px 0;${i<2?'border-bottom:1px solid var(--border)':''}"><div style="width:28px;height:28px;background:var(--gold-glow);border:1px solid var(--border-gold);border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:Montserrat,sans-serif;font-weight:900;font-size:11px;color:var(--gold);">${s.step}</div><div><p style="color:var(--cream);font-weight:600;font-size:14px;margin-bottom:4px;">${s.title}</p><p style="color:var(--text-muted);font-size:13px;line-height:1.6;">${s.description}</p></div></div>`).join('')}
        </div>
      </div>
      <div style="position:relative;border-radius:2px;overflow:hidden;aspect-ratio:16/9;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(196,164,107,0.05),transparent 70%);"></div>
        <div style="text-align:center;position:relative;z-index:1;">
          <div style="width:64px;height:64px;border-radius:2px;background:var(--gold);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;cursor:pointer;transition:all .2s;box-shadow:0 8px 32px rgba(196,164,107,0.25);" onclick="this.closest('div').parentElement.querySelector('iframe').style.display='flex';this.closest('div').style.display='none'" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
            <svg width="24" height="24" fill="#000" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <p style="color:var(--text-muted);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">Watch Our Work</p>
        </div>
        <iframe src="${videoUrl ? videoUrl.replace('watch?v=','embed/').replace('youtu.be/','www.youtube.com/embed/') + '?autoplay=1' : 'https://www.youtube.com/embed/?listType=search&list=' + encodeURIComponent(industry + ' ' + city + ' FL contractor') + '&autoplay=0'}" style="display:none;position:absolute;inset:0;width:100%;height:100%;border:0;" allowfullscreen title="${industry} in ${city}"></iframe>
      </div>
    </div>
  </div>
</section>

<section style="background:var(--black);padding:88px 0;border-top:1px solid var(--border-gold);position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(196,164,107,0.06),transparent 70%);pointer-events:none;"></div>
  <div class="container" style="text-align:center;position:relative;">
    <div style="width:48px;height:1px;background:var(--gold);margin:0 auto 32px;opacity:0.6;"></div>
    <h2 style="font-size:clamp(28px,4vw,48px);color:var(--cream);margin-bottom:16px;letter-spacing:-0.02em;">Ready to Get Started?</h2>
    <p style="color:var(--text-muted);font-size:17px;margin-bottom:44px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.7;">A free, no-obligation consultation with ${city}'s trusted ${industry} experts.</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="${(client.siteBase||'')}/contact-us" class="btn btn-primary" style="font-size:14px;padding:16px 48px;">Get Started Today</a>
      ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" class="btn btn-outline" style="font-size:14px;padding:16px 36px;">${phone}</a>` : ''}
    </div>
  </div>
</section>`;

  return wrapPage(`${name} — ${city} ${industry}`, c.metaDescription, industry, city, body, layout, client);
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

  return wrapPage(`About Us — ${name} | ${city} ${industry}`, `Learn about ${name}, a trusted ${industry} company in ${city}.`, industry, city, body, layout, client);
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

  return wrapPage(`Services — ${name} | ${city} ${industry}`, `Explore all ${industry} services offered by ${name} in ${city}.`, industry, city, body, layout, client);
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
        <div style="border-radius:var(--radius);overflow:hidden;height:200px;margin-bottom:20px;">
          <iframe src="https://maps.google.com/maps?q=${encodeURIComponent(name + ' ' + city + ' FL')}&output=embed&z=14" width="100%" height="200" style="border:0;display:block;" allowfullscreen loading="lazy" title="Map"></iframe>
        </div>
        <div style="background:var(--black);border-radius:var(--radius);padding:28px;">
          <h4 style="color:#fff;font-size:18px;margin-bottom:12px;">Service Areas</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${c.areas.map(a => `<span style="background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.6);border-radius:100px;padding:5px 14px;font-size:13px;">${a}</span>`).join('')}</div>
        </div>
      </div>
    </div>
  </div>
</section>`;

  return wrapPage(`Contact Us — ${name} | ${city}`, `Contact ${name} for ${industry} services in ${city}. Free quotes, fast response.`, industry, city, body, layout, client);
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

  return wrapPage(`FAQ — ${name} | ${city} ${industry}`, `Common questions about ${name}'s ${industry} services in ${city}.`, industry, city, body, layout, client);
}

// Main orchestrator — generates all 5 pages
async function buildWebsite(clientName, phone, email, city, industry, logoUrl = '', formId = GHL_FORM_ID, siteBase = '.', assets = {}) {
  city = city || 'Orlando';
  formId = formId || GHL_FORM_ID;
  console.log(`[Sofia] Building 5-page website for ${clientName} (${industry}, ${city})...`);

  // assets: { photos: string[], placeId: string, video: string }
  const { photos = [], placeId = '', video = '' } = assets;

  // Run all async work in parallel: content, AI design tokens, gallery, reviews
  const [content, tokens, galleryImages, reviews] = await Promise.all([
    generateWebsiteContent(clientName, industry, city),
    generateStitchDesignSystem(clientName, industry, city).catch(() => null),
    photos.length
      ? Promise.resolve(photos.map((url, i) => ({ url, alt: `${clientName} ${industry} ${i + 1}` })))
      : fetchPexelsGallery(industry, city, 6).catch(() => []),
    placeId ? fetchGoogleReviews(placeId).catch(() => []) : Promise.resolve([]),
  ]);

  if (tokens) console.log(`[Sofia] Design: "${tokens.designName}" — ${tokens.primary}, ${tokens.headlineFont}/${tokens.bodyFont}`);
  if (reviews.length) console.log(`[Sofia] Loaded ${reviews.length} real Google reviews`);
  if (photos.length) console.log(`[Sofia] Using ${photos.length} client photos`);

  // If we have real Google reviews, replace AI testimonials
  if (reviews.length >= 2) {
    content.testimonials = reviews.map(r => ({
      name: r.name,
      business: city,
      rating: r.rating,
      text: r.text,
    }));
  }

  const client = { name: clientName, phone, email, city, industry, logoUrl, formId, siteBase, galleryImages, videoUrl: video };
  const layout = buildSharedLayout(clientName, industry, city, phone, logoUrl, siteBase, tokens);
  return {
    home:     buildHomePage(client, content, layout),
    about:    buildAboutPage(client, content, layout),
    services: buildServicesPage(client, content, layout),
    contact:  buildContactPage(client, content, layout),
    faq:      buildFAQPage(client, content, layout),
    content,
    tokens,
    hasRealPhotos: photos.length > 0,
    hasRealReviews: reviews.length >= 2,
    hasVideo: !!video,
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

// ─────────────────────────────────────────────────────────────────────────────
// META AD LIBRARY — Competitor intelligence via Facebook Ad Library API
// ─────────────────────────────────────────────────────────────────────────────

const META_APP_ID     = '1733086424176994';
const META_APP_SECRET = process.env.META_APP_SECRET;
// User token with ads_read — required for Ad Library API (ads_archive endpoint)
// Expires ~60 days. Refresh at: https://developers.facebook.com/tools/explorer/
// App: JRZ Claude AI | Permissions: ads_read, ads_management
const META_LIB_TOKEN  = () => process.env.META_USER_TOKEN || `${META_APP_ID}|${META_APP_SECRET}`;

/**
 * GET /ad-spy?q=HYROX+Orlando&country=US&status=ACTIVE&limit=20
 *
 * Searches the Facebook Ad Library for active ads matching a keyword.
 * Returns: page_name, ad copy, snapshot URL, platforms, start date, impressions, spend
 *
 * Examples:
 *   /ad-spy?q=HYROX+Orlando          → fitness competitor research
 *   /ad-spy?q=water+damage+Orlando   → AV4 competitor research
 *   /ad-spy?q=tattoo+studio+Orlando  → Luis Farrera competitor research
 *   /ad-spy?q=junk+removal+Orlando   → Lion Junk Removal competitor research
 *   /ad-spy?q=pavers+Orlando         → JR Paver competitor research
 */
app.get('/ad-spy', async (req, res) => {
  try {
    const q       = req.query.q       || 'fitness Orlando';
    const country = req.query.country || 'US';
    const status  = req.query.status  || 'ACTIVE';
    const limit   = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!process.env.META_USER_TOKEN && !META_APP_SECRET) {
      return res.status(500).json({ ok: false, error: 'META_USER_TOKEN not set in Render environment variables.' });
    }

    // Note: singular field names deprecated in v13+, use plural versions
    const fields = [
      'id',
      'page_id',
      'page_name',
      'ad_creative_bodies',
      'ad_creative_link_captions',
      'ad_creative_link_descriptions',
      'ad_creative_link_titles',
      'ad_snapshot_url',
      'ad_delivery_start_time',
      'ad_delivery_stop_time',
      'publisher_platforms',
      'impressions',
      'spend',
      'currency',
    ].join(',');

    const params = new URLSearchParams({
      access_token:        META_LIB_TOKEN(),
      search_terms:        q,
      ad_reached_countries: JSON.stringify([country]),
      ad_active_status:    status,
      fields,
      limit:               String(limit),
      search_type:         'KEYWORD_UNORDERED',
    });

    const url = `https://graph.facebook.com/v19.0/ads_archive?${params.toString()}`;
    const { data } = await axios.get(url, { timeout: 15000 });

    const ads = (data.data || []).map(ad => ({
      id:           ad.id,
      page:         ad.page_name || '—',
      page_id:      ad.page_id,
      copy:         (ad.ad_creative_bodies || [])[0] || (ad.ad_creative_link_descriptions || [])[0] || '(no copy)',
      headline:     (ad.ad_creative_link_titles || [])[0] || '',
      caption:      (ad.ad_creative_link_captions || [])[0] || '',
      all_copies:   ad.ad_creative_bodies || [],
      snapshot_url: ad.ad_snapshot_url || null,
      platforms:    ad.publisher_platforms || [],
      started:      ad.ad_delivery_start_time || null,
      stopped:      ad.ad_delivery_stop_time  || null,
      impressions:  ad.impressions  || null,
      spend:        ad.spend        || null,
      currency:     ad.currency     || 'USD',
    }));

    // Sort: longest-running first (best signal of profitable ad)
    ads.sort((a, b) => {
      const da = a.started ? new Date(a.started) : new Date();
      const db = b.started ? new Date(b.started) : new Date();
      return da - db;
    });

    res.json({
      ok:     true,
      query:  q,
      country,
      status,
      total:  ads.length,
      note:   ads.length === 0
        ? 'No ads found. Try broader terms or check that Marketing API is enabled on your app.'
        : `${ads.length} ads found — sorted by longest-running first (these are profitable).`,
      ads,
      paging: data.paging || null,
    });

  } catch (err) {
    const fbError = err.response?.data?.error;
    res.status(500).json({
      ok:    false,
      error: fbError?.message || err.message,
      code:  fbError?.code    || null,
      hint:  fbError?.code === 190
        ? 'Invalid access token — check APP_ID and META_APP_SECRET in Render env vars.'
        : fbError?.code === 100
        ? 'Marketing API not enabled on your app — go to developers.facebook.com/apps/1733086424176994/add-product/ and add Marketing API.'
        : 'Check Render logs for full stack trace.',
    });
  }
});

/**
 * GET /ad-spy/page?page_id=123456&country=US&limit=10
 *
 * Pull ALL active ads from a SPECIFIC competitor page.
 * Use this when you find a strong competitor in /ad-spy and want to see everything they're running.
 */
app.get('/ad-spy/page', async (req, res) => {
  try {
    const { page_id, country = 'US', limit = 10 } = req.query;
    if (!page_id) return res.status(400).json({ ok: false, error: 'page_id required. Get it from /ad-spy results.' });
    if (!META_APP_SECRET) return res.status(500).json({ ok: false, error: 'META_APP_SECRET not set.' });

    const fields = 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,impressions,spend,publisher_platforms';
    const params = new URLSearchParams({
      access_token:         META_LIB_TOKEN(),
      search_page_ids:      page_id,
      ad_reached_countries: JSON.stringify([country]),
      ad_active_status:     'ACTIVE',
      fields,
      limit:                String(Math.min(parseInt(limit) || 10, 50)),
    });

    const { data } = await axios.get(`https://graph.facebook.com/v19.0/ads_archive?${params.toString()}`, { timeout: 15000 });

    res.json({
      ok:    true,
      page_id,
      total: (data.data || []).length,
      ads:   data.data || [],
    });

  } catch (err) {
    const fbError = err.response?.data?.error;
    res.status(500).json({ ok: false, error: fbError?.message || err.message, code: fbError?.code || null });
  }
});

/**
 * GET /ad-spy/analyze?q=HYROX+training&client=SOCF+Fitness&country=US&limit=20
 *
 * Pulls competitor ads from Meta Ad Library THEN passes them through Claude for
 * strategic intelligence. Returns hooks, offer patterns, creative angles, threat
 * level, and a ready-to-use ad brief for the client.
 *
 * Examples:
 *   /ad-spy/analyze?q=HYROX+training&client=SOCF+Fitness
 *   /ad-spy/analyze?q=tattoo+studio&client=Luis+Farrera+Tattoo
 *   /ad-spy/analyze?q=water+damage+restoration&client=AV4+Water+Damage
 */
app.get('/ad-spy/analyze', async (req, res) => {
  try {
    const q       = req.query.q       || 'fitness Orlando';
    const client  = req.query.client  || 'our client';
    const country = req.query.country || 'US';
    const limit   = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!process.env.META_USER_TOKEN && !META_APP_SECRET) {
      return res.status(500).json({ ok: false, error: 'META_USER_TOKEN not set in Render env vars.' });
    }

    // ── Step 1: Pull ads from Meta Ad Library ────────────────────────────────
    const fields = [
      'id','page_id','page_name',
      'ad_creative_bodies','ad_creative_link_titles','ad_creative_link_descriptions',
      'ad_snapshot_url','ad_delivery_start_time','publisher_platforms',
      'impressions','spend','currency',
    ].join(',');

    const params = new URLSearchParams({
      access_token:         META_LIB_TOKEN(),
      search_terms:         q,
      ad_reached_countries: JSON.stringify([country]),
      ad_active_status:     'ACTIVE',
      fields,
      limit:                String(limit),
      search_type:          'KEYWORD_UNORDERED',
    });

    const { data: fbData } = await axios.get(
      `https://graph.facebook.com/v19.0/ads_archive?${params.toString()}`,
      { timeout: 15000 }
    );

    const rawAds = (fbData.data || []).map(ad => ({
      page:      ad.page_name || '—',
      page_id:   ad.page_id,
      copy:      (ad.ad_creative_bodies || [])[0] || (ad.ad_creative_link_descriptions || [])[0] || '',
      headline:  (ad.ad_creative_link_titles || [])[0] || '',
      platforms: ad.publisher_platforms || [],
      started:   ad.ad_delivery_start_time || null,
      snapshot:  ad.ad_snapshot_url || null,
    }));

    if (rawAds.length === 0) {
      return res.json({
        ok: true, query: q, client, total: 0,
        analysis: null,
        message: 'No active ads found for this search. Try broader terms.',
        ads: [],
      });
    }

    // Sort longest-running first
    rawAds.sort((a, b) => {
      const da = a.started ? new Date(a.started) : new Date();
      const db = b.started ? new Date(b.started) : new Date();
      return da - db;
    });

    // ── Step 2: Build Claude prompt ───────────────────────────────────────────
    const adsText = rawAds.map((ad, i) =>
      `Ad ${i + 1}:
  Page: ${ad.page}
  Headline: ${ad.headline || '(none)'}
  Copy: ${ad.copy ? ad.copy.slice(0, 400) : '(none)'}
  Platforms: ${ad.platforms.join(', ')}
  Running since: ${ad.started || 'unknown'}`
    ).join('\n\n');

    const prompt = `You are a senior Facebook ads strategist. Analyze these ${rawAds.length} active competitor ads for the search term "${q}". Our client is "${client}".

COMPETITOR ADS:
${adsText}

Return a JSON object with EXACTLY this structure (no markdown, pure JSON):
{
  "threat_level": "low | medium | high",
  "threat_reason": "one sentence explaining the threat level",
  "top_hooks": ["hook 1", "hook 2", "hook 3"],
  "offer_patterns": ["pattern 1", "pattern 2"],
  "creative_angles": ["angle 1", "angle 2", "angle 3"],
  "dominant_competitors": [{"name": "page name", "why_they_matter": "one sentence"}],
  "gap_opportunity": "what no competitor is doing that ${client} should do",
  "recommended_hook": "the single best opening line ${client} should test first",
  "recommended_offer": "the best offer ${client} should lead with",
  "ready_to_use_ad": {
    "headline": "ad headline for ${client}",
    "primary_text": "full ad copy for ${client} (3-5 sentences, conversational, ends with CTA)",
    "cta_button": "LEARN_MORE | SIGN_UP | GET_QUOTE | BOOK_NOW | CONTACT_US"
  },
  "marco_brief": "2-3 sentences briefing the content team on what creative to produce based on this intel"
}`;

    // ── Step 3: Claude analysis ───────────────────────────────────────────────
    const aiResponse = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    let analysis = null;
    const raw = aiResponse.content[0]?.text?.trim() || '';
    try {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { parse_error: true, raw_response: raw };
    }

    // ── Step 4: Return full intelligence package ──────────────────────────────
    res.json({
      ok:       true,
      query:    q,
      client,
      country,
      total:    rawAds.length,
      analysis,
      ads:      rawAds,
      snapshot_links: rawAds.filter(a => a.snapshot).map(a => ({
        page: a.page,
        url:  a.snapshot,
      })),
    });

  } catch (err) {
    const fbError = err.response?.data?.error;
    res.status(500).json({
      ok:    false,
      error: fbError?.message || err.message,
      code:  fbError?.code    || null,
    });
  }
});

/**
 * GET /ad-spy/analyze/all
 *
 * Runs competitor ad intelligence for ALL JRZ clients in one call.
 * Each client has defined search terms matching their industry + location.
 * Returns a full report per client: threat level, top hooks, ready-to-use ad copy.
 *
 * Takes ~30-60 seconds (sequential to avoid rate limits).
 * Use ?client=SOCF+Fitness to run for a single client by name.
 */
app.get('/ad-spy/analyze/all', async (req, res) => {
  // ── Client → search terms map ─────────────────────────────────────────────
  const CLIENT_SEARCHES = [
    {
      client:  'SOCF Fitness',
      queries: ['HYROX training', 'functional fitness gym Orlando', 'CrossFit Orlando'],
    },
    {
      client:  'Luis Farrera Tattoo',
      queries: ['tattoo studio Orlando', 'color tattoo artist', 'custom tattoo booking'],
    },
    {
      client:  'AV4 Water Damage',
      queries: ['water damage restoration Orlando', 'flood cleanup Orlando', 'emergency water damage'],
    },
    {
      client:  'JR Paver Sealing',
      queries: ['paver sealing Orlando', 'driveway sealing Orlando', 'paver cleaning restoration'],
    },
    {
      client:  'Lion Junk Removal',
      queries: ['junk removal Orlando', 'same day junk removal', 'junk hauling Orlando'],
    },
    {
      client:  'Cooney Homes',
      queries: ['new home builder Orlando', 'custom homes Orlando', 'home construction Florida'],
    },
    {
      client:  'Escobar Kitchen',
      queries: ['Latin restaurant Orlando', 'Colombian food Orlando', 'restaurant delivery Orlando'],
    },
    {
      client:  'Railing Max',
      queries: ['stair railing installation', 'iron railing contractor', 'custom railings Florida'],
    },
    {
      client:  'USA Latino CPA',
      queries: ['tax preparation Latino', 'CPA services Orlando', 'impuestos Orlando contabilidad'],
    },
  ];

  // Filter to single client if ?client= param passed
  const filterClient = req.query.client ? req.query.client.toLowerCase() : null;
  const targets = filterClient
    ? CLIENT_SEARCHES.filter(c => c.client.toLowerCase().includes(filterClient))
    : CLIENT_SEARCHES;

  if (targets.length === 0) {
    return res.json({ ok: false, error: `No client found matching "${req.query.client}"` });
  }

  const country = req.query.country || 'US';
  const results = [];

  // ── Run analysis per client (sequential to respect rate limits) ──────────
  for (const target of targets) {
    const clientResult = { client: target.client, queries: [], summary: null };

    // Collect ads across all search terms for this client
    let allAds = [];
    for (const q of target.queries) {
      try {
        const fields = 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,publisher_platforms,ad_snapshot_url';
        const params = new URLSearchParams({
          access_token:         META_LIB_TOKEN(),
          search_terms:         q,
          ad_reached_countries: JSON.stringify([country]),
          ad_active_status:     'ACTIVE',
          fields,
          limit:                '10',
          search_type:          'KEYWORD_UNORDERED',
        });
        const { data: fbData } = await axios.get(
          `https://graph.facebook.com/v19.0/ads_archive?${params.toString()}`,
          { timeout: 12000 }
        );
        const ads = (fbData.data || []).map(ad => ({
          query:     q,
          page:      ad.page_name || '—',
          page_id:   ad.page_id,
          copy:      (ad.ad_creative_bodies || [])[0]?.slice(0, 400) || '',
          headline:  (ad.ad_creative_link_titles || [])[0] || '',
          platforms: ad.publisher_platforms || [],
          started:   ad.ad_delivery_start_time || null,
          snapshot:  ad.ad_snapshot_url || null,
        }));
        allAds = allAds.concat(ads);
        clientResult.queries.push({ q, count: ads.length });
      } catch (e) {
        clientResult.queries.push({ q, count: 0, error: e.message });
      }
    }

    // Deduplicate by page+copy
    const seen = new Set();
    allAds = allAds.filter(ad => {
      const key = `${ad.page}|${ad.copy?.slice(0,80)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    // Sort longest-running first
    allAds.sort((a, b) => {
      const da = a.started ? new Date(a.started) : new Date();
      const db = b.started ? new Date(b.started) : new Date();
      return da - db;
    });

    clientResult.total_ads = allAds.length;
    clientResult.ads = allAds;

    if (allAds.length === 0) {
      clientResult.summary = {
        threat_level: 'low',
        threat_reason: 'No active competitor ads found — this is a massive opportunity.',
        top_hooks: [],
        offer_patterns: [],
        gap_opportunity: `Nobody is running paid ads for ${target.client}'s keywords. First-mover wins.`,
        recommended_hook: `Are you looking for ${target.client.split(' ').slice(-1)[0].toLowerCase()} in Orlando? Here's what makes us different.`,
        recommended_offer: 'Free consultation / Free trial / Free quote — no competitors to fight',
        ready_to_use_ad: {
          headline: `${target.client} | Orlando's Best`,
          primary_text: `Nobody in Orlando is advertising this right now — which means your next client is searching and finding nobody. We're here. Contact us today.`,
          cta_button: 'CONTACT_US',
        },
        marco_brief: `Zero competitor ads found. ${target.client} can own this space immediately with any creative. Priority: launch fast, own the keyword before someone else does.`,
      };
    } else {
      // Claude analysis
      try {
        const adsText = allAds.slice(0, 15).map((ad, i) =>
          `Ad ${i+1} [query: "${ad.query}"]:\n  Page: ${ad.page}\n  Headline: ${ad.headline || '(none)'}\n  Copy: ${ad.copy || '(none)'}\n  Platforms: ${ad.platforms.join(', ')}\n  Running since: ${ad.started || 'unknown'}`
        ).join('\n\n');

        const prompt = `You are a senior Facebook ads strategist. Analyze ${allAds.length} active competitor ads across these search terms: ${target.queries.join(', ')}. Our client is "${target.client}" based in Orlando, FL.

COMPETITOR ADS:
${adsText}

Return ONLY a JSON object (no markdown):
{
  "threat_level": "low | medium | high",
  "threat_reason": "one sentence",
  "top_hooks": ["hook 1", "hook 2", "hook 3"],
  "offer_patterns": ["pattern 1", "pattern 2"],
  "gap_opportunity": "what competitors are NOT doing that ${target.client} should exploit",
  "recommended_hook": "single best opening line to test",
  "recommended_offer": "best offer to lead with",
  "ready_to_use_ad": {
    "headline": "ad headline for ${target.client}",
    "primary_text": "full ad copy (3-5 sentences, ends with CTA)",
    "cta_button": "LEARN_MORE | SIGN_UP | GET_QUOTE | BOOK_NOW | CONTACT_US"
  },
  "marco_brief": "2-3 sentences briefing the creative team on what video/image to produce"
}`;

        const aiResp = await anthropic.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages:   [{ role: 'user', content: prompt }],
        });

        const raw = aiResp.content[0]?.text?.trim() || '';
        const cleaned = raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim();
        clientResult.summary = JSON.parse(cleaned);
      } catch (e) {
        clientResult.summary = { parse_error: true, message: e.message };
      }
    }

    results.push(clientResult);
  }

  // ── Build executive summary across all clients ────────────────────────────
  const highThreats  = results.filter(r => r.summary?.threat_level === 'high').map(r => r.client);
  const medThreats   = results.filter(r => r.summary?.threat_level === 'medium').map(r => r.client);
  const opportunities = results.filter(r => r.summary?.threat_level === 'low').map(r => r.client);

  res.json({
    ok:          true,
    generated:   new Date().toISOString(),
    country,
    clients_run: results.length,
    executive_summary: {
      high_threat:    highThreats,
      medium_threat:  medThreats,
      opportunities:  opportunities,
      priority_action: highThreats.length > 0
        ? `Launch ads ASAP for: ${highThreats.join(', ')} — competitors are spending heavily`
        : medThreats.length > 0
        ? `Monitor and prep creatives for: ${medThreats.join(', ')}`
        : `All clear — low competition across the board. First-mover wins everywhere.`,
    },
    clients: results,
  });
});

// ============================================================
//  AD INTELLIGENCE SYSTEM — 4-FEATURE ELITE STACK
//  Ad Scorecard · Hook Library · Performance Feedback Loop · Pre-launch Checklist
// ============================================================

const HOOK_LIBRARY_PID = 'jrz/hook_library';

// Strip markdown fences Claude sometimes wraps around JSON responses
function stripJsonFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
const HOOK_LIBRARY_URL = `https://res.cloudinary.com/dbsuw1mfm/raw/upload/${HOOK_LIBRARY_PID}.json`;

async function readHookLibrary() {
  try {
    const res = await axios.get(`${HOOK_LIBRARY_URL}?t=${Date.now()}`);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch (e) {
    return {};
  }
}

async function saveHookLibrary(data) {
  const ts  = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha1')
    .update(`overwrite=true&public_id=${HOOK_LIBRARY_PID}&timestamp=${ts}${CLOUDINARY_API_SECRET}`)
    .digest('hex');
  const form = new FormData();
  form.append('file', Buffer.from(JSON.stringify(data)), { filename: 'file.json', contentType: 'application/json' });
  form.append('public_id', HOOK_LIBRARY_PID);
  form.append('resource_type', 'raw');
  form.append('timestamp', String(ts));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('signature', sig);
  form.append('overwrite', 'true');
  await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`, form, { headers: form.getHeaders() });
}

// ── 1. AD SCORECARD ─────────────────────────────────────────
// POST /ad-scorecard
// Body: { hook, offer, cta, audience, visual_format, landing_page, industry?, client? }
// Returns: scores (6 dimensions), total/100, pass/fail, confidence%, rewrite if <70
app.post('/ad-scorecard', async (req, res) => {
  try {
    const { hook, offer, cta, audience, visual_format, landing_page, industry = '', client = '' } = req.body;
    if (!hook || !offer || !cta) return res.status(400).json({ ok: false, error: 'hook, offer, cta are required' });

    const prompt = `You are an elite Meta Ads strategist. Score this ad brief across 6 dimensions (each 0–100), then return a weighted total out of 100 and a confidence percentage.

AD BRIEF:
- Hook: ${hook}
- Offer: ${offer}
- CTA: ${cta}
- Target Audience: ${audience || 'Not specified'}
- Visual Format: ${visual_format || 'Not specified'}
- Landing Page: ${landing_page || 'Not specified'}
- Industry: ${industry || 'General'}
- Client: ${client || 'N/A'}

SCORING DIMENSIONS (each 0-100):
1. Hook Strength — Does it stop the scroll? Pattern interrupt? Curiosity or pain?
2. Offer Clarity — Is the offer specific, compelling, and easy to understand in 3 seconds?
3. CTA Power — Is the action clear, urgent, and low-friction?
4. Audience Match — Does the copy speak directly to the target audience's desires/pain?
5. Creative Format Fit — Is the visual format right for the message and platform?
6. Landing Page Alignment — Does the LP match the ad promise? Is it likely to convert?

WEIGHTS: Hook 25%, Offer 25%, CTA 15%, Audience 15%, Creative 10%, Landing Page 10%

If total score < 70, rewrite the hook and offer to score 85+.

Respond ONLY in this JSON format:
{
  "scores": {
    "hook_strength": 0,
    "offer_clarity": 0,
    "cta_power": 0,
    "audience_match": 0,
    "creative_format_fit": 0,
    "landing_page_alignment": 0
  },
  "total": 0,
  "confidence_pct": 0,
  "verdict": "LAUNCH" | "REVISE" | "REBUILD",
  "top_weakness": "...",
  "rewrite": {
    "hook": "...",
    "offer": "..."
  },
  "launch_notes": "..."
}
Return ONLY the JSON object, no markdown.`;

    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    let parsed;
    try {
      parsed = JSON.parse(stripJsonFences(aiRes.content[0].text));
    } catch (e) {
      return res.json({ ok: false, error: 'AI parse error', raw: aiRes.content[0].text });
    }

    res.json({
      ok: true,
      client: client || 'N/A',
      industry: industry || 'General',
      scorecard: parsed,
    });
  } catch (e) {
    console.error('[ad-scorecard]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 2. HOOK LIBRARY ─────────────────────────────────────────
// GET  /hooks/top?industry=fitness        — top hooks for an industry
// POST /hooks/save                        — save a winning hook
// GET  /hooks/all                         — full library dump

app.get('/hooks/top', async (req, res) => {
  try {
    const { industry } = req.query;
    const library = await readHookLibrary();

    if (industry) {
      const key = industry.toLowerCase().trim();
      const hooks = library[key] || [];
      const sorted = hooks.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
      return res.json({ ok: true, industry: key, count: sorted.length, hooks: sorted });
    }

    // No industry — return top hook per industry
    const summary = {};
    for (const [ind, hooks] of Object.entries(library)) {
      if (Array.isArray(hooks) && hooks.length) {
        summary[ind] = hooks.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      }
    }
    res.json({ ok: true, industries: Object.keys(summary).length, top_hooks: summary });
  } catch (e) {
    console.error('[hooks/top]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/hooks/save', async (req, res) => {
  try {
    const { hook, industry, score, source, client, notes } = req.body;
    if (!hook || !industry) return res.status(400).json({ ok: false, error: 'hook and industry are required' });

    const library = await readHookLibrary();
    const key = industry.toLowerCase().trim();
    if (!library[key]) library[key] = [];

    // Dedupe by hook text
    const exists = library[key].find(h => h.hook === hook);
    if (exists) {
      exists.score     = score || exists.score;
      exists.notes     = notes || exists.notes;
      exists.updated   = new Date().toISOString();
    } else {
      library[key].push({
        hook,
        score:   score || null,
        source:  source || 'manual',
        client:  client || null,
        notes:   notes  || null,
        saved:   new Date().toISOString(),
        updated: new Date().toISOString(),
      });
    }

    await saveHookLibrary(library);
    res.json({ ok: true, saved: hook, industry: key, total_in_industry: library[key].length });
  } catch (e) {
    console.error('[hooks/save]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/hooks/all', async (req, res) => {
  try {
    const library = await readHookLibrary();
    const stats = {};
    let total = 0;
    for (const [ind, hooks] of Object.entries(library)) {
      stats[ind] = Array.isArray(hooks) ? hooks.length : 0;
      total += stats[ind];
    }
    res.json({ ok: true, total_hooks: total, by_industry: stats, library });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 3. PERFORMANCE FEEDBACK LOOP ────────────────────────────
// POST /ad-performance/sync
// Body: { account_id, days? }  — pulls last N days from Meta Ads API, Claude analyzes, updates hook library
// Requires: META_USER_TOKEN with ads_management permission

app.post('/ad-performance/sync', async (req, res) => {
  try {
    const { account_id, days = 7, dry_run = false } = req.body;
    if (!account_id) return res.status(400).json({ ok: false, error: 'account_id required (e.g. act_123456789)' });

    const token = META_LIB_TOKEN();
    const since = Math.floor((Date.now() - days * 86400000) / 1000);

    // Pull ad-level insights from Meta Ads API
    const insightRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account_id}/ads`,
      {
        params: {
          fields: 'id,name,status,creative{body,title,description},insights.date_preset(last_7d){impressions,clicks,spend,ctr,cpm,actions,action_values,cost_per_action_type}',
          limit: 50,
          access_token: token,
        },
      }
    ).catch(e => ({ data: null, error: e.response?.data || e.message }));

    if (insightRes.error || !insightRes.data?.data) {
      return res.json({ ok: false, error: insightRes.error || 'No ad data returned', hint: 'Verify META_USER_TOKEN has ads_management permission and account_id is correct (format: act_XXXXXXXXX)' });
    }

    const ads = insightRes.data.data.filter(ad => ad.insights?.data?.length);
    if (!ads.length) return res.json({ ok: true, message: `No ads with data in last ${days} days`, account_id });

    // Build structured summary for Claude
    const adSummaries = ads.map(ad => {
      const ins = ad.insights.data[0];
      const conversions = (ins.actions || []).find(a => ['purchase', 'lead', 'complete_registration'].includes(a.action_type));
      return {
        name: ad.name,
        status: ad.status,
        hook: ad.creative?.body?.substring(0, 120) || 'N/A',
        headline: ad.creative?.title || 'N/A',
        impressions: parseInt(ins.impressions || 0),
        clicks: parseInt(ins.clicks || 0),
        spend: parseFloat(ins.spend || 0).toFixed(2),
        ctr: parseFloat(ins.ctr || 0).toFixed(2),
        cpm: parseFloat(ins.cpm || 0).toFixed(2),
        conversions: conversions ? conversions.value : 0,
        cost_per_conversion: conversions && ins.spend ? (parseFloat(ins.spend) / parseFloat(conversions.value)).toFixed(2) : 'N/A',
      };
    });

    const analysisPrompt = `You are an elite Meta Ads performance analyst. Analyze these ${ads.length} ads from the last ${days} days and extract what's working.

AD PERFORMANCE DATA:
${JSON.stringify(adSummaries, null, 2)}

ANALYZE AND RESPOND IN THIS JSON FORMAT:
{
  "winner_ads": [{ "name": "...", "why_it_won": "...", "hook": "...", "key_metric": "..." }],
  "loser_ads": [{ "name": "...", "why_it_failed": "...", "fix": "..." }],
  "winning_patterns": ["pattern 1", "pattern 2", "pattern 3"],
  "hook_themes_that_worked": ["theme 1", "theme 2"],
  "hook_themes_that_failed": ["theme 1", "theme 2"],
  "industry_guess": "fitness|dental|home_services|restaurant|real_estate|other",
  "recommended_hooks": [
    { "hook": "...", "score": 85, "why": "..." },
    { "hook": "...", "score": 80, "why": "..." }
  ],
  "next_test": "What single change should be tested next week?",
  "summary": "2-sentence executive summary"
}
Return ONLY the JSON object.`;

    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: analysisPrompt }],
    });

    let analysis;
    try {
      analysis = JSON.parse(stripJsonFences(aiRes.content[0].text));
    } catch (e) {
      return res.json({ ok: false, error: 'AI parse error', raw: aiRes.content[0].text });
    }

    // Auto-save winning hooks to Hook Library
    let hooksSaved = 0;
    if (!dry_run && analysis.recommended_hooks?.length) {
      const industry = analysis.industry_guess || 'general';
      for (const rec of analysis.recommended_hooks) {
        if (rec.hook && rec.score >= 75) {
          const library = await readHookLibrary();
          const key = industry.toLowerCase();
          if (!library[key]) library[key] = [];
          const exists = library[key].find(h => h.hook === rec.hook);
          if (!exists) {
            library[key].push({
              hook:    rec.hook,
              score:   rec.score,
              source:  'performance_loop',
              client:  account_id,
              notes:   rec.why,
              saved:   new Date().toISOString(),
              updated: new Date().toISOString(),
            });
            await saveHookLibrary(library);
            hooksSaved++;
          }
        }
      }
    }

    res.json({
      ok: true,
      account_id,
      days_analyzed: days,
      ads_with_data: ads.length,
      hooks_saved_to_library: hooksSaved,
      dry_run,
      analysis,
      raw_ads: adSummaries,
    });
  } catch (e) {
    console.error('[ad-performance/sync]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 4. PRE-LAUNCH CHECKLIST ──────────────────────────────────
// POST /ad-preflight
// Body: { hook, offer, cta, audience, creative_format, landing_page_url, industry?, client? }
// Returns: pass/fail per dimension, overall readiness score, go/no-go decision, blockers

app.post('/ad-preflight', async (req, res) => {
  try {
    const {
      hook, offer, cta, audience, creative_format,
      landing_page_url, industry = '', client = '',
    } = req.body;

    if (!hook || !offer || !cta) {
      return res.status(400).json({ ok: false, error: 'hook, offer, and cta are required' });
    }

    // Fetch top hooks from library for comparison
    let topHooks = [];
    try {
      const library = await readHookLibrary();
      const key = (industry || 'general').toLowerCase();
      topHooks = (library[key] || [])
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 3)
        .map(h => h.hook);
    } catch (e) { /* ignore */ }

    const prompt = `You are a Meta Ads launch director doing a final pre-launch review. Check every dimension below and return a GO or NO-GO with specific blockers.

AD TO REVIEW:
- Hook: ${hook}
- Offer: ${offer}
- CTA: ${cta}
- Target Audience: ${audience || 'Not specified'}
- Creative Format: ${creative_format || 'Not specified'}
- Landing Page URL: ${landing_page_url || 'Not provided'}
- Industry: ${industry || 'General'}
- Client: ${client || 'N/A'}

TOP HOOKS IN LIBRARY FOR THIS INDUSTRY (for comparison):
${topHooks.length ? topHooks.map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No hooks in library yet for this industry.'}

CHECKLIST (score each: PASS / WARN / FAIL + reason):
1. Hook — Is it specific, pattern-interrupting, and scroll-stopping?
2. Offer — Is it clear, valuable, and low-risk to the prospect?
3. CTA — Single clear action, matches funnel stage?
4. Audience Fit — Does the copy language match the audience's reality?
5. Creative Format — Right format for message type? (video vs image vs carousel)
6. Landing Page — URL provided? Does offer match? Is friction low?
7. Compliance — No superlatives (best, #1) without substantiation? No prohibited claims?
8. Hook vs Library — Is this hook as strong or stronger than library benchmarks?

RESPOND IN THIS JSON FORMAT ONLY:
{
  "checklist": {
    "hook":            { "status": "PASS|WARN|FAIL", "reason": "..." },
    "offer":           { "status": "PASS|WARN|FAIL", "reason": "..." },
    "cta":             { "status": "PASS|WARN|FAIL", "reason": "..." },
    "audience_fit":    { "status": "PASS|WARN|FAIL", "reason": "..." },
    "creative_format": { "status": "PASS|WARN|FAIL", "reason": "..." },
    "landing_page":    { "status": "PASS|WARN|FAIL", "reason": "..." },
    "compliance":      { "status": "PASS|WARN|FAIL", "reason": "..." },
    "hook_vs_library": { "status": "PASS|WARN|FAIL", "reason": "..." }
  },
  "readiness_score": 0,
  "decision": "GO" | "GO_WITH_WARNINGS" | "NO_GO",
  "blockers": ["..."],
  "warnings": ["..."],
  "launch_tip": "One sentence: the single highest-leverage improvement before launch.",
  "estimated_performance": "Expected CTR range and why, based on hook and audience quality."
}
Return ONLY the JSON object.`;

    const aiRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    let parsed;
    try {
      parsed = JSON.parse(stripJsonFences(aiRes.content[0].text));
    } catch (e) {
      return res.json({ ok: false, error: 'AI parse error', raw: aiRes.content[0].text });
    }

    // Count pass/warn/fail
    const checks = Object.values(parsed.checklist || {});
    const passCount = checks.filter(c => c.status === 'PASS').length;
    const warnCount = checks.filter(c => c.status === 'WARN').length;
    const failCount = checks.filter(c => c.status === 'FAIL').length;

    res.json({
      ok: true,
      client: client || 'N/A',
      industry: industry || 'General',
      summary: { pass: passCount, warn: warnCount, fail: failCount, total: checks.length },
      preflight: parsed,
      library_hooks_compared: topHooks.length,
    });
  } catch (e) {
    console.error('[ad-preflight]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 5. AD ACCOUNT FINDER ────────────────────────────────────
// GET /ad-accounts?business_id=XXX
// Finds all ad accounts under a Business ID + lists their active ads
app.get('/ad-accounts', async (req, res) => {
  try {
    const { business_id } = req.query;
    if (!business_id) return res.status(400).json({ ok: false, error: 'business_id required' });

    const token = META_LIB_TOKEN();

    // Get all ad accounts under the business
    const accountsRes = await axios.get(
      `https://graph.facebook.com/v19.0/${business_id}/owned_ad_accounts`,
      { params: { fields: 'id,name,account_status,currency,spend_cap', access_token: token, limit: 50 } }
    ).catch(e => ({ data: null, _err: e.response?.data || e.message }));

    if (accountsRes._err || !accountsRes.data?.data) {
      return res.json({ ok: false, error: accountsRes._err || 'No accounts returned', hint: 'Token may need business_management permission' });
    }

    const accounts = accountsRes.data.data;

    // For each account pull active campaigns + ads
    const results = await Promise.all(accounts.map(async acct => {
      const adsRes = await axios.get(
        `https://graph.facebook.com/v19.0/${acct.id}/ads`,
        {
          params: {
            fields: 'id,name,status,creative{id,body,title,description},adset{name},campaign{name}',
            filtering: JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]),
            access_token: token,
            limit: 50,
          }
        }
      ).catch(() => ({ data: { data: [] } }));

      return {
        account_id:  acct.id,
        account_name: acct.name,
        status:      acct.account_status === 1 ? 'ACTIVE' : acct.account_status === 2 ? 'DISABLED' : `STATUS_${acct.account_status}`,
        ads: (adsRes.data?.data || []).map(ad => ({
          ad_id:       ad.id,
          ad_name:     ad.name,
          ad_status:   ad.status,
          campaign:    ad.campaign?.name || '—',
          adset:       ad.adset?.name || '—',
          creative_id: ad.creative?.id || '—',
          body:        ad.creative?.body || '—',
          title:       ad.creative?.title || '—',
        })),
      };
    }));

    res.json({ ok: true, business_id, total_accounts: accounts.length, accounts: results });
  } catch (e) {
    console.error('[ad-accounts]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 6. AD COPY UPDATER ───────────────────────────────────────
// POST /ad-update-copy
// Body: { account_id, ad_id, body, title, description? }
// Creates a new AdCreative with updated copy and swaps it onto the ad
app.post('/ad-update-copy', async (req, res) => {
  try {
    const { account_id, ad_id, body, title, description } = req.body;
    if (!account_id || !ad_id || !body) {
      return res.status(400).json({ ok: false, error: 'account_id, ad_id, and body are required' });
    }

    const token = META_LIB_TOKEN();

    // Step 1 — get the current ad to find existing creative
    const adRes = await axios.get(
      `https://graph.facebook.com/v19.0/${ad_id}`,
      { params: { fields: 'id,name,status,creative{id,body,title,description,object_story_spec,image_hash,link_url,call_to_action_type}', access_token: token } }
    ).catch(e => ({ data: null, _err: e.response?.data || e.message }));

    if (adRes._err || !adRes.data) {
      return res.json({ ok: false, step: 'fetch_ad', error: adRes._err || 'Ad not found' });
    }

    const currentCreative = adRes.data.creative || {};

    // Step 2 — create new AdCreative with updated copy
    const creativePayload = {
      name:        `Updated Creative ${Date.now()}`,
      body:        body,
      access_token: token,
    };
    if (title)       creativePayload.title       = title;
    if (description) creativePayload.description = description;

    // Carry over image/link/story spec if present
    if (currentCreative.object_story_spec) creativePayload.object_story_spec = JSON.stringify(currentCreative.object_story_spec);
    if (currentCreative.image_hash)        creativePayload.image_hash         = currentCreative.image_hash;
    if (currentCreative.link_url)          creativePayload.link_url           = currentCreative.link_url;

    const newCreativeRes = await axios.post(
      `https://graph.facebook.com/v19.0/${account_id}/adcreatives`,
      creativePayload
    ).catch(e => ({ data: null, _err: e.response?.data || e.message }));

    if (newCreativeRes._err || !newCreativeRes.data?.id) {
      return res.json({ ok: false, step: 'create_creative', error: newCreativeRes._err || 'Creative creation failed', hint: 'Token may need ads_management permission' });
    }

    const newCreativeId = newCreativeRes.data.id;

    // Step 3 — update the ad to use the new creative
    const updateRes = await axios.post(
      `https://graph.facebook.com/v19.0/${ad_id}`,
      { creative: JSON.stringify({ creative_id: newCreativeId }), access_token: token }
    ).catch(e => ({ data: null, _err: e.response?.data || e.message }));

    if (updateRes._err || !updateRes.data?.success) {
      return res.json({ ok: false, step: 'update_ad', error: updateRes._err || 'Ad update failed', new_creative_id: newCreativeId });
    }

    res.json({
      ok:              true,
      ad_id,
      account_id,
      old_creative_id: currentCreative.id || '—',
      new_creative_id: newCreativeId,
      new_body:        body,
      new_title:       title || currentCreative.title || '—',
      message:         'Ad copy updated successfully. Changes live within 60 seconds.',
    });
  } catch (e) {
    console.error('[ad-update-copy]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── END AD INTELLIGENCE SYSTEM ───────────────────────────────

// GET /sofia/test-design?industry=roofing&city=Orlando — test AI design system generation
app.get('/sofia/test-design', async (req, res) => {
  try {
    const result = await generateStitchDesignSystem('Test Co', req.query.industry || 'roofing', req.query.city || 'Orlando');
    res.json({ ok: !!result, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
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

// GET /sofia/website-package?name=...&industry=...&city=...&phone=...&email=...&formId=...
//   &logo=URL          — client logo URL (optional)
//   &photos=URL,URL    — comma-separated client photo URLs (optional, replaces Pexels)
//   &placeId=ChIJ...   — Google Place ID for real reviews (optional)
//   &video=youtu.be/.. — YouTube video URL for client video section (optional)
app.get('/sofia/website-package', async (req, res) => {
  try {
    const {
      name = 'Test Company', industry = 'roofing', city = 'Orlando',
      phone = '', email = '', formId,
      logo = '', photos = '', placeId = '', video = '',
    } = req.query;

    const photoList = photos ? photos.split(',').map(u => u.trim()).filter(Boolean) : [];
    const assets = { photos: photoList, placeId, video };

    // Purge expired cache entries
    for (const [k, v] of websitePackageCache) {
      if (v.expires < Date.now()) websitePackageCache.delete(k);
    }

    const pages = await buildWebsite(name, phone, email, city, industry, logo, formId || GHL_FORM_ID, '', assets);
    const cacheId = crypto.randomBytes(8).toString('hex');
    websitePackageCache.set(cacheId, { pages, clientName: name, expires: Date.now() + 600000 }); // 10 min TTL

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const fileMap = [
      { label: 'Home Page',    page: 'home',     filename: 'index.html' },
      { label: 'About Us',     page: 'about',    filename: 'about-us.html' },
      { label: 'Services',     page: 'services', filename: 'services.html' },
      { label: 'Contact Us',   page: 'contact',  filename: 'contact-us.html' },
      { label: 'FAQ',          page: 'faq',      filename: 'faq.html' },
    ];

    const tokenInfo = pages.tokens
      ? `<p style="font-size:13px;color:#6b7280;margin-top:8px;">🎨 Design: <strong style="color:#1a1a1a;">${pages.tokens.designName}</strong> — ${pages.tokens.headlineFont}/${pages.tokens.bodyFont} <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${pages.tokens.primary};margin-left:4px;vertical-align:middle;"></span> ${pages.tokens.primary}</p>`
      : '<p style="font-size:13px;color:#6b7280;margin-top:8px;">ℹ️ Default design (generation failed)</p>';

    const assetBadges = [
      logo         ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">✓ Logo</span>` : `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">⚠ No Logo</span>`,
      pages.hasRealPhotos   ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">✓ Client Photos</span>` : `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">⚠ Stock Photos</span>`,
      pages.hasRealReviews  ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">✓ Real Reviews</span>` : `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">⚠ AI Reviews</span>`,
      pages.hasVideo        ? `<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">✓ Video</span>` : `<span style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-right:6px;">– No Video</span>`,
    ].join('');

    const buttons = fileMap.map(f => `
      <a href="/sofia/website-download?id=${cacheId}&page=${f.page}&filename=${f.filename}"
         style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 24px;text-decoration:none;color:#1a1a1a;transition:all .15s;margin-bottom:10px;"
         onmouseover="this.style.borderColor='#6366f1';this.style.background='#f5f3ff'"
         onmouseout="this.style.borderColor='#e5e7eb';this.style.background='#fff'">
        <div>
          <div style="font-weight:600;font-size:15px;">${f.label}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${f.filename}</div>
        </div>
        <div style="background:#6366f1;color:#fff;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;">↓ Download</div>
      </a>`).join('');

    const hubHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Website Package — ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1a1a1a;padding:40px 20px;min-height:100vh;}
  .card{background:#fff;border-radius:16px;padding:36px;max-width:560px;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,0.06);}
  h1{font-size:22px;font-weight:800;margin-bottom:4px;}
  .sub{font-size:14px;color:#6b7280;margin-bottom:24px;}
  .badge{display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;border-radius:100px;margin-bottom:12px;}
  .how{background:#f1f5f9;border-radius:10px;padding:16px 20px;margin-top:24px;font-size:13px;color:#475569;line-height:1.7;}
  .how strong{color:#1a1a1a;}
</style>
</head>
<body>
<div class="card">
  <div class="badge">✓ Ready to Deploy</div>
  <h1>${name}</h1>
  <p class="sub">${industry} · ${city} · 5 pages</p>
  ${tokenInfo}
  <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:4px;">${assetBadges}</div>
  <div style="margin-top:24px;">${buttons}</div>
  <div class="how">
    <strong>How to upload to GHL Websites:</strong><br>
    1. Download each HTML file below<br>
    2. In GHL → Sites → Websites → open your site<br>
    3. Add a new page → switch to <strong>Custom Code</strong> mode<br>
    4. Paste the full HTML → Save<br><br>
    <strong>⚠️ Set these exact page slugs in GHL or nav links break:</strong><br>
    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">index.html</code> → Homepage (root)<br>
    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">about-us.html</code> → slug: <strong>about-us</strong><br>
    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">services.html</code> → slug: <strong>services</strong><br>
    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">contact-us.html</code> → slug: <strong>contact-us</strong><br>
    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">faq.html</code> → slug: <strong>faq</strong><br><br>
    <em style="color:#94a3b8;font-size:12px;">Links expire in 10 minutes. Re-run this URL to regenerate.</em>
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(hubHtml);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}\n${err.stack}</pre>`);
  }
});

// GET /sofia/website-download?id=CACHE_ID&page=home&filename=index.html
// Returns a single page HTML file as a download (served from websitePackageCache)
app.get('/sofia/website-download', (req, res) => {
  const { id, page, filename = 'page.html' } = req.query;
  const cached = websitePackageCache.get(id);
  if (!cached || cached.expires < Date.now()) {
    return res.status(404).send('<pre>Link expired. Re-run /sofia/website-package to get fresh download links.</pre>');
  }
  const html = cached.pages[page];
  if (!html) return res.status(400).send(`<pre>Unknown page: "${page}"</pre>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
});

// ═══════════════════════════════════════════════════════════════════════
// ■ LUIS FARRERA — Custom 5-page tattoo artist website
//   GET /sofia/luis-farrera  →  download hub
// ═══════════════════════════════════════════════════════════════════════
const LF = {
  logo:        'https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69daafd3d7871cddf75b42cd.png',
  heroBg:      'https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4ed98d84290c6b8f45.jpeg',
  portrait:    'https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d6777a1f6a717df8a7f2dc.jpeg',
  studioBg:    'https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d6777ae033d6ce58381f42.jpeg',
  bookUrl:     'https://links.jrzmarketing.com/widget/form/Hzo6772r9eso4tozQ6H1',
  phone:       '1-833-362-6091',
  colorPhotos: ['https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad49.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad4b.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e2790d9aa14b72fdb.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4e55ec6d12658aad4f.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4df7bfdb83df3281d9.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67d4ed98d84290c6b8f45.jpeg'],
  blackPhotos: ['https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67debf7bfdb83df329cbe.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9a64a04ba15e74d7b.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9eddf7185e19aed67.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9ebf1a60843381585.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9e033d6ce58399ec6.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd93dd00cb232a1c156.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9a5d3efc6ded61c5a.jpeg','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67cd9f7bfdb83df326c8f.jpeg'],
  colorVideos: ['https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cff5ebf27de34e1d3e.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cf91452c30c25bb1b4.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cf3d9f7a33e41ccbf4.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfa64a04ba15e8221d.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfa5d3efc6ded6f27d.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d680cfebf1a6084338eb7f.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d6802af7bfdb83df33399f.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67c523dd00cb232a19f7c.mp4'],
  blackVideos: ['https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8f7bfdb83df32c448.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea83dd00cb232a20b48.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8a5d3efc6ded66613.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8a64a04ba15e79a35.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8f7bfdb83df32c446.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8ebf1a60843385edb.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea8a7dcb4cff04d3a55.mov','https://assets.cdn.filesafe.space/Q6FIvQ5WitCeq9wyXZ3L/media/69d67ea891452c30c25b278f.mov'],
  reviews: [
    {name:'Jeanette Colon',meta:'Google Review',text:'Luis was great in communicating with me. He was kind, patient, and created a great piece for me.'},
    {name:'Ydelkis Hernandez',meta:'Google Review',text:'I loved every moment I spent there. Super calm atmosphere, super professional, and I was very happy with the experience.'},
    {name:'Rosa Gutierrez',meta:'Google Review',text:'Amazing artist and makes you feel comfortable and at ease while taking time to hear your ideas.'},
    {name:'SkyWalkerArise',meta:'Google Review',text:'Luis Farrera is an extremely talented tattoo artist and delivered work that felt worth the wait.'},
    {name:'Michael Torres',meta:'Google Review',text:'The attention to detail is unreal. The piece healed beautifully and still gets compliments constantly.'},
    {name:'Amanda R.',meta:'Studio Feedback',text:'Studio energy felt professional from start to finish. Clean process, clear communication, strong design direction.'},
    {name:'Carlos M.',meta:'Studio Feedback',text:'Luis took my reference and elevated it into something custom, balanced, and much stronger than I expected.'},
    {name:'Vanessa K.',meta:'Collector Feedback',text:'If you care about realism and composition, this is the type of artist you wait for.'},
    {name:'David L.',meta:'Collector Feedback',text:'The black and gray shading came out smooth, soft, and powerful. It looks expensive because it is executed at a high level.'},
    {name:'Sophia N.',meta:'Collector Feedback',text:'My color piece still looks insanely vibrant. The saturation, detail, and finish are on another level.'},
    {name:'James P.',meta:'Tattoo Review',text:'Consultation was clear, the concept was refined, and the final work looked premium in person.'},
    {name:'Maria C.',meta:'Tattoo Review',text:'You can tell he understands how the tattoo needs to flow with the body, not just sit on it.'},
  ],
  faqs: [
    {q:'Where is Luis Farrera located in New York?',a:'Luis Farrera works at 132 Crosby St, 4th floor, New York, NY 10012 in Soho, Manhattan — one of the most recognized creative neighborhoods in the city.'},
    {q:'What tattoo styles does Luis Farrera specialize in?',a:'Luis specializes in black and gray realism, color realism, and fully custom tattoo design. Each piece is treated as a unique commission focused on composition, skin tone, and lasting quality.'},
    {q:'How do I book a tattoo appointment with Luis Farrera?',a:"Click any Book Now button on the site to access the booking form. You'll be asked about placement, size, style, and reference images so Luis can prepare a custom concept."},
    {q:'How long does a typical tattoo session take?',a:'Session length depends on size and complexity. Smaller pieces may take 2–4 hours, while larger custom work or multi-session collector projects can run full-day sessions.'},
    {q:'What is the pricing for a tattoo with Luis Farrera?',a:'Pricing is based on size, detail level, and session time. Luis works at a collector-level price point reflecting the quality of the work. Inquire via the booking form for a custom quote.'},
    {q:'Does Luis Farrera do color realism tattoos in NYC?',a:'Yes. Color realism is a core specialty. The portfolio features vibrant, detail-rich pieces with strong color saturation that holds its quality over time.'},
    {q:'Is Luis Farrera good for first-time tattoo clients?',a:'Yes. Multiple 5-star Google reviews specifically mention his patience, communication, and calm studio environment during first sessions.'},
    {q:'Does Luis Farrera guest spot at other studios?',a:'Yes. While his home base is the Soho studio at 132 Crosby St, Luis rotates through select guest spots and international collaborations. Contact via the booking form for upcoming availability.'},
  ],
};

function lfCSS() {
  return `<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#050505;--bg2:#0b0b0b;--bg3:#121212;--panel:#171717;--text:#f4f1eb;--muted:rgba(244,241,235,.72);--soft:rgba(244,241,235,.45);--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--gold:#cfa947;--gold2:#e2c66f;--white:#ffffff;--max:1440px;--display:'Bebas Neue',sans-serif;--serif:'Cormorant Garamond',serif;--body:'Inter',sans-serif;--shadow:0 20px 70px rgba(0,0,0,.38)}
html{scroll-behavior:smooth}body{background:var(--bg);color:var(--text);font-family:var(--body);overflow-x:hidden}
img,video,iframe{display:block;max-width:100%}a{color:inherit;text-decoration:none}button{font:inherit}
.lf-c{width:min(var(--max),calc(100% - 32px));margin:0 auto}.lf-s{padding:88px 0}
.lf-ey{display:inline-flex;align-items:center;gap:12px;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:var(--gold2);margin-bottom:16px}
.lf-ey:before{content:"";width:28px;height:1px;background:var(--gold)}
.lf-title{font:400 clamp(42px,7vw,90px)/.9 var(--display);letter-spacing:1px;text-transform:uppercase;margin:0}
.lf-title em{display:block;font:300 italic clamp(18px,2vw,28px)/1.2 var(--serif);text-transform:none;letter-spacing:2px;color:rgba(255,255,255,.42)}
.lf-sub{font:300 18px/1.8 var(--serif);color:var(--muted)}
.lf-btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border:1px solid transparent;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;transition:.22s ease;cursor:pointer;white-space:nowrap}
.lf-btn-gold{background:transparent;border-color:var(--gold);color:var(--gold2)}.lf-btn-gold:hover{background:var(--gold);color:#111}
.lf-btn-light{background:var(--white);color:#111}.lf-btn-light:hover{opacity:.9;transform:translateY(-1px)}
.lf-btn-line{background:transparent;border-color:var(--line2);color:var(--white)}.lf-btn-line:hover{border-color:var(--gold);color:var(--gold2)}
.lf-reveal{opacity:0;transform:translateY(22px);transition:opacity .7s ease,transform .7s ease}.lf-reveal.in{opacity:1;transform:none}
.lf-nav-wrap{position:sticky;top:0;z-index:60;background:rgba(5,5,5,.88);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.lf-nav{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.lf-brand{display:flex;align-items:center;gap:12px}.lf-brand img{height:32px;width:auto}
.lf-brand-text strong{display:block;font:400 17px/1 var(--display);letter-spacing:3px;text-transform:uppercase}
.lf-brand-text span{display:block;margin-top:4px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--soft)}
.lf-nav-links{display:flex;align-items:center;gap:16px}
.lf-nav-links a{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.75);transition:.2s}
.lf-nav-links a:hover,.lf-nav-links a.act{color:var(--gold2)}
.lf-mob{display:none;background:none;border:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer}
.lf-hero{position:relative;min-height:100svh;display:flex;align-items:end;background:#050505}
.lf-hero-bg{position:absolute;inset:0}.lf-hero-bg img{width:100%;height:100%;object-fit:cover;filter:grayscale(100%) brightness(.26)}
.lf-hero-bg:after{content:"";position:absolute;inset:0;background:linear-gradient(to right,rgba(5,5,5,.95) 0%,rgba(5,5,5,.76) 32%,rgba(5,5,5,.4) 58%,rgba(5,5,5,.72) 100%),linear-gradient(to top,rgba(5,5,5,1) 0%,rgba(5,5,5,.18) 42%,rgba(5,5,5,.55) 100%)}
.lf-hero-in{position:relative;z-index:2;display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:end;min-height:calc(100svh - 72px);padding:48px 0 56px}
.lf-hero-copy h1{font:400 clamp(60px,11vw,148px)/.86 var(--display);text-transform:uppercase;letter-spacing:1px;margin:0 0 14px}
.lf-kicker{font-size:11px;letter-spacing:4px;text-transform:uppercase;color:var(--gold2);margin-bottom:14px}
.lf-hero-copy p{max-width:580px;font-size:17px;line-height:1.7;color:var(--muted);margin:0 0 22px}
.lf-hero-actions{display:flex;gap:12px;flex-wrap:wrap}
.lf-hero-side{justify-self:end;width:min(100%,400px)}
.lf-hero-card{background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01));padding:16px;border:1px solid var(--line);box-shadow:var(--shadow)}
.lf-hero-card img{width:100%;aspect-ratio:4/5;object-fit:cover;filter:grayscale(100%)}
.lf-page-hero{position:relative;padding:112px 0 72px;background:var(--bg);overflow:hidden;border-bottom:1px solid var(--line)}
.lf-page-hero-bg{position:absolute;inset:0}.lf-page-hero-bg img{width:100%;height:100%;object-fit:cover;filter:grayscale(100%) brightness(.13)}
.lf-page-hero-bg:after{content:"";position:absolute;inset:0;background:linear-gradient(to right,rgba(5,5,5,.97),rgba(5,5,5,.86))}
.lf-page-hero-in{position:relative;z-index:2}
.lf-stats{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--panel)}
.lf-stat{padding:26px 20px;text-align:center;border-right:1px solid var(--line)}.lf-stat:last-child{border-right:0}
.lf-stat-n{font:400 40px/1 var(--display);color:var(--gold2);letter-spacing:1px}.lf-stat-l{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--soft);margin-top:6px}
.lf-bio{background:linear-gradient(180deg,#080808,#050505)}.lf-bio-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center}
.lf-bio-card,.lf-bio-photo{background:var(--panel);box-shadow:var(--shadow)}.lf-bio-card{padding:28px}.lf-bio-photo{overflow:hidden}
.lf-bio-photo img{width:100%;height:100%;min-height:600px;object-fit:cover}
.lf-bio-inline{display:grid;grid-template-columns:200px 1fr;gap:22px;align-items:start;margin-top:18px}
.lf-bio-inline img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#0d0d0d}
.lf-bio-text p{font-size:15px;line-height:1.85;color:rgba(255,255,255,.8);margin:0}.lf-bio-text p+p{margin-top:16px}
.lf-sec-head{display:flex;justify-content:space-between;align-items:end;gap:24px;flex-wrap:wrap;margin-bottom:26px}
.lf-gallery-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.lf-gi{position:relative;overflow:hidden;background:#111;box-shadow:var(--shadow)}.lf-gi.img{aspect-ratio:4/5}.lf-gi.vid{aspect-ratio:9/16}
.lf-gi img,.lf-gi video{width:100%;height:100%;object-fit:cover}.lf-gi:after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.66),transparent 58%)}
.lf-gm{position:absolute;left:12px;right:12px;bottom:12px;z-index:2;display:flex;align-items:end;justify-content:space-between;gap:8px}
.lf-gm strong{font-size:11px;letter-spacing:2px;text-transform:uppercase}.lf-gm span{display:block;margin-top:4px;font-size:12px;color:rgba(255,255,255,.65)}
.lf-play{width:36px;height:36px;border:1px solid rgba(255,255,255,.18);border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.3);font-size:11px;flex-shrink:0}
.lf-reel-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,23vw);gap:12px;overflow-x:auto;padding-bottom:10px;scroll-snap-type:x mandatory}
.lf-reel-row::-webkit-scrollbar{height:6px}.lf-reel-row::-webkit-scrollbar-thumb{background:#222}
.lf-reel-card{position:relative;scroll-snap-align:start;aspect-ratio:9/16;overflow:hidden;background:#101010;box-shadow:var(--shadow)}
.lf-reel-card video{width:100%;height:100%;object-fit:cover}.lf-reel-card:after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.78),transparent 58%)}
.lf-reel-meta{position:absolute;left:12px;right:12px;bottom:12px;z-index:2}.lf-reel-meta strong{display:block;font-size:12px;letter-spacing:2px;text-transform:uppercase}.lf-reel-meta span{display:block;margin-top:5px;font-size:12px;color:rgba(255,255,255,.65)}
.lf-chip-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
.lf-chip{padding:10px 15px;border:1px solid var(--line2);background:transparent;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:.22s ease}
.lf-chip.act,.lf-chip:hover{border-color:var(--gold);color:var(--gold2)}
.lf-pg{display:none}.lf-pg.act{display:block}.lf-pb h3{font:400 17px/1 var(--display);letter-spacing:2px;text-transform:uppercase;margin:0 0 14px;color:var(--gold2)}
.lf-reviews{position:relative;background:#050505;overflow:hidden}
.lf-rev-bg{position:absolute;inset:0;opacity:.2}.lf-rev-bg img{width:100%;height:100%;object-fit:cover;filter:grayscale(100%) brightness(.5)}
.lf-reviews:after{content:"";position:absolute;inset:0;background:linear-gradient(to right,rgba(5,5,5,.95) 0%,rgba(5,5,5,.8) 40%,rgba(5,5,5,.58) 100%)}
.lf-rev-in{position:relative;z-index:2}.lf-rev-top{text-align:center;max-width:800px;margin:0 auto 26px}
.lf-slider-btn{width:42px;height:42px;border:1px solid var(--line2);background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;transition:.22s ease}.lf-slider-btn:hover{border-color:var(--gold);color:var(--gold2)}
.lf-rev-track{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 30px) / 4);gap:10px;overflow:hidden;scroll-behavior:smooth}
.lf-rc{min-height:210px;background:rgba(8,8,8,.92);border:1px solid var(--line);padding:18px}
.lf-rc .lf-stars{font-size:12px;letter-spacing:2px;color:var(--gold2);margin-bottom:11px}.lf-rc h4{font-size:13px;margin:0 0 3px}.lf-rc small{display:block;color:var(--soft);margin-bottom:9px;font-size:11px}.lf-rc p{font-size:13px;line-height:1.65;color:rgba(255,255,255,.76);margin:0}
.lf-location{background:#040404}.lf-loc-wrap{text-align:center;max-width:1300px;margin:0 auto}
.lf-loc-addr{font:400 clamp(32px,4.5vw,62px)/.95 var(--display);letter-spacing:1px;text-transform:uppercase;margin:10px auto 12px;max-width:960px}
.lf-loc-proof{display:flex;justify-content:center;gap:22px;flex-wrap:wrap;font-size:14px;color:var(--muted);margin-bottom:24px}
.lf-loc-proof span{display:inline-flex;align-items:center;gap:10px}.lf-loc-proof span:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--gold)}
.lf-map-wrap{margin-top:32px;overflow:hidden;box-shadow:var(--shadow)}.lf-map-wrap iframe{width:100%;height:400px;border:0;background:#101010}
.lf-faq{background:#050505}.lf-faq-top{text-align:center;max-width:840px;margin:0 auto 28px}.lf-faq-list{max-width:1020px;margin:0 auto}
.lf-faq-item+.lf-faq-item{margin-top:10px}.lf-faq-item{background:#090909;border:1px solid var(--line)}
.lf-faq-btn{width:100%;text-align:left;background:transparent;border:0;color:#fff;padding:17px 18px;display:flex;justify-content:space-between;align-items:center;gap:18px;cursor:pointer}
.lf-faq-btn strong{font-size:12px;line-height:1.5;letter-spacing:1px;text-transform:uppercase;color:var(--gold2)}.lf-faq-icon{font-size:18px;color:#fff;flex-shrink:0}
.lf-faq-body{max-height:0;overflow:hidden;transition:max-height .3s ease;padding:0 18px}.lf-faq-body p{padding:0 0 18px;font-size:14px;line-height:1.8;color:rgba(255,255,255,.75);margin:0}
.lf-faq-item.open .lf-faq-body{max-height:260px}
.lf-svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:52px}
.lf-svc-card{background:var(--panel);padding:30px;border:1px solid var(--line);transition:.25s ease}.lf-svc-card:hover{border-color:var(--gold);transform:translateY(-3px)}
.lf-svc-card h3{font:400 clamp(26px,2.8vw,36px)/1 var(--display);letter-spacing:1px;text-transform:uppercase;color:var(--gold2);margin:14px 0 12px}
.lf-svc-card p{font-size:14px;line-height:1.8;color:var(--muted)}
.lf-proc{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.lf-proc-step{padding:26px;background:var(--panel);border-top:2px solid var(--gold)}
.lf-proc-num{font:400 52px/1 var(--display);color:rgba(207,169,71,.16);margin-bottom:10px}
.lf-proc-step h4{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--gold2);margin-bottom:8px}
.lf-proc-step p{font-size:13px;line-height:1.75;color:var(--muted)}
.lf-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.lf-ci{background:var(--panel);padding:30px}.lf-ci h3{font:400 30px/1 var(--display);letter-spacing:1px;text-transform:uppercase;color:var(--gold2);margin-bottom:22px}
.lf-cr{display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid var(--line)}.lf-cr:last-child{border-bottom:0}
.lf-cr-icon{width:34px;height:34px;background:rgba(207,169,71,.1);border:1px solid rgba(207,169,71,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px}
.lf-cr-lbl{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--soft);margin-bottom:4px}.lf-cr-val{font-size:14px;color:var(--text)}
.lf-book-wrap{background:var(--panel);padding:30px}.lf-book-wrap h3{font:400 30px/1 var(--display);letter-spacing:1px;text-transform:uppercase;color:var(--gold2);margin-bottom:18px}
.lf-cta{background:linear-gradient(135deg,#0d0d0d,#140f00);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:64px 0;text-align:center}
.lf-cta h2{font:400 clamp(34px,4.5vw,60px)/1 var(--display);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
.lf-cta p{font-size:16px;color:var(--muted);margin-bottom:26px}
.lf-footer{background:#020202;border-top:1px solid var(--line);padding:26px 0 36px}
.lf-footer-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.lf-footer-brand{display:flex;align-items:center;gap:12px}.lf-footer-brand img{height:30px;width:auto}
.lf-footer-brand strong{display:block;font:400 17px/1 var(--display);letter-spacing:3px;text-transform:uppercase}
.lf-footer-brand span{display:block;margin-top:4px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--soft)}
.lf-footer-links{display:flex;gap:16px;flex-wrap:wrap}.lf-footer-links a,.lf-footer-copy{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--soft)}.lf-footer-links a:hover{color:var(--gold2)}
@media(max-width:1200px){.lf-hero-in,.lf-bio-grid,.lf-contact-grid{grid-template-columns:1fr}.lf-hero-side{justify-self:start;width:min(100%,340px)}.lf-bio-photo img{min-height:380px}.lf-gallery-grid{grid-template-columns:repeat(3,1fr)}.lf-rev-track{grid-auto-columns:calc((100% - 10px)/2)}.lf-stats{grid-template-columns:repeat(2,1fr)}.lf-svc-grid{grid-template-columns:1fr 1fr}.lf-proc{grid-template-columns:1fr 1fr}}
@media(max-width:900px){.lf-nav-links{display:none}.lf-mob{display:block}.lf-reel-row{grid-auto-columns:minmax(200px,70vw)}.lf-gallery-grid{grid-template-columns:repeat(2,1fr)}.lf-rev-track{grid-auto-columns:100%}.lf-bio-inline{grid-template-columns:1fr}.lf-svc-grid,.lf-proc{grid-template-columns:1fr}}
@media(max-width:640px){.lf-c{width:min(var(--max),calc(100% - 20px))}.lf-s{padding:72px 0}.lf-hero-copy h1{font-size:clamp(52px,16vw,86px)}.lf-gallery-grid{grid-template-columns:1fr}.lf-stats{grid-template-columns:1fr 1fr}.lf-hero-actions{width:100%}.lf-btn{width:100%}}
/* ── Premium agency animations ── */
@keyframes lfPulse{0%{box-shadow:0 0 0 0 rgba(207,169,71,0.5)}70%{box-shadow:0 0 0 16px rgba(207,169,71,0)}100%{box-shadow:0 0 0 0 rgba(207,169,71,0)}}
@keyframes lfPageFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes lf-vt-out{to{opacity:0;transform:translateY(-8px)}}
@keyframes lf-vt-in{from{opacity:0;transform:translateY(8px)}}
::view-transition-old(root){animation:.26s ease both lf-vt-out}
::view-transition-new(root){animation:.26s ease both lf-vt-in}
html{scroll-behavior:auto}
body{animation:lfPageFade .45s ease both}
.lf-btn-gold{isolation:isolate;transition:transform .15s ease,box-shadow .15s ease,background .25s,color .25s}
.lf-page-hero-bg{will-change:transform;transition:transform .1s linear}
/* ── Custom cursor ── */
@media(pointer:fine){
  body,a,button{cursor:none!important}
  .lf-cursor-dot{position:fixed;width:7px;height:7px;background:var(--gold);border-radius:50%;pointer-events:none;z-index:10001;transform:translate(-50%,-50%)}
  .lf-cursor-ring{position:fixed;width:32px;height:32px;border:1.5px solid rgba(207,169,71,.5);border-radius:50%;pointer-events:none;z-index:10000;transform:translate(-50%,-50%);transition:width .2s,height .2s,border-color .2s}
  .lf-cursor-dot.clicking{transform:translate(-50%,-50%) scale(2.6)}
  .lf-cursor-ring.hovering{width:52px;height:52px;border-color:var(--gold2)}
}
/* ── Image blur-up ── */
img.img-blur{filter:blur(14px) scale(1.02);transition:filter .65s ease;will-change:filter}
img.img-blur.loaded{filter:blur(0) scale(1)}
/* ── 3D card tilt ── */
.lf-svc-card,.lf-bio-card{transform-style:preserve-3d;will-change:transform}
/* ── Canvas hero ── */
#lfHeroCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
</style>`;
}

function lfNav(active) {
  const links = [{id:'home',label:'Home',href:'/'},{id:'about',label:'About',href:'/about-us'},{id:'portfolio',label:'Portfolio',href:'/portfolio'},{id:'services',label:'Services',href:'/services'}];
  return `<div class="lf-nav-wrap"><div class="lf-c lf-nav">
  <a href="/" class="lf-brand"><img src="${LF.logo}" alt="Luis Farrera"/><div class="lf-brand-text"><strong>Luis Farrera</strong><span>Soho NYC Tattoo Artist</span></div></a>
  <nav class="lf-nav-links" id="lfNav">${links.map(l=>`<a href="${l.href}"${l.id===active?' class="act"':''}>${l.label}</a>`).join('')}<a href="/contact-us" class="lf-btn lf-btn-light" style="min-height:38px;padding:0 16px;font-size:11px;">Book Now</a></nav>
  <button class="lf-mob" id="lfMob">Menu</button>
</div></div>`;
}

function lfFooter() {
  return `<footer class="lf-footer"><div class="lf-c lf-footer-in">
  <div class="lf-footer-brand"><img src="${LF.logo}" alt="Luis Farrera"/><div><strong>Luis Farrera</strong><span>132 Crosby St 4th floor, New York, NY 10012</span></div></div>
  <div class="lf-footer-links"><a href="/">Home</a><a href="/about-us">About</a><a href="/portfolio">Portfolio</a><a href="/services">Services</a><a href="/contact-us">Book Now</a></div>
  <div class="lf-footer-copy">© ${new Date().getFullYear()} Luis Farrera. All rights reserved.</div>
</div></footer>`;
}

function lfScript() {
  return `<script>(function(){
// ── Mobile nav ──
var mob=document.getElementById('lfMob'),nav=document.getElementById('lfNav');
if(mob&&nav)mob.addEventListener('click',function(){var o=nav.style.display==='flex';nav.style.cssText=o?'':'display:flex;flex-direction:column;position:fixed;inset:74px 10px auto;padding:18px;background:rgba(5,5,5,.98);border:1px solid rgba(255,255,255,.08);gap:14px;z-index:999;align-items:stretch;';});
window.addEventListener('resize',function(){if(window.innerWidth>900&&nav)nav.style.cssText='';});
// ── Video observer ──
var vo=new IntersectionObserver(function(e){e.forEach(function(x){var v=x.target;if(x.isIntersecting){var p=v.play();if(p&&p.catch)p.catch(function(){});}else v.pause();});},{threshold:.32});
function initVO(){document.querySelectorAll('[data-lv]').forEach(function(v){vo.observe(v);});}initVO();
// ── FAQ ──
document.querySelectorAll('.lf-faq-item').forEach(function(item){var btn=item.querySelector('.lf-faq-btn');if(!btn)return;btn.addEventListener('click',function(){var o=item.classList.contains('open');document.querySelectorAll('.lf-faq-item').forEach(function(x){x.classList.remove('open');var ic=x.querySelector('.lf-faq-icon');if(ic)ic.textContent='+';});if(!o){item.classList.add('open');var ic=item.querySelector('.lf-faq-icon');if(ic)ic.textContent='−';}});});
// ── Chip filter ──
document.querySelectorAll('.lf-chip').forEach(function(btn){btn.addEventListener('click',function(){document.querySelectorAll('.lf-chip').forEach(function(b){b.classList.remove('act');});document.querySelectorAll('.lf-pg').forEach(function(g){g.classList.remove('act');});btn.classList.add('act');var t=document.getElementById(btn.dataset.target);if(t){t.classList.add('act');initVO();}});});
// ── Review slider ──
var tr=document.getElementById('lfRT'),pv=document.getElementById('lfRP'),nx=document.getElementById('lfRN');
function sa(){return tr?(tr.clientWidth<900?tr.clientWidth:tr.clientWidth/2):0;}
if(pv&&tr)pv.addEventListener('click',function(){tr.scrollBy({left:-sa(),behavior:'smooth'});});
if(nx&&tr)nx.addEventListener('click',function(){tr.scrollBy({left:sa(),behavior:'smooth'});});
var ai=null;function startA(){if(!tr)return;clearInterval(ai);ai=setInterval(function(){tr.scrollBy({left:sa(),behavior:'smooth'});},4200);}
if(tr){startA();tr.addEventListener('mouseenter',function(){clearInterval(ai);});tr.addEventListener('mouseleave',startA);}
// ── Magnetic CTAs ──
document.querySelectorAll('.lf-btn-gold').forEach(function(b){
  b.addEventListener('mousemove',function(e){var r=b.getBoundingClientRect();b.style.transform='translate('+(e.clientX-r.left-r.width/2)*0.25+'px,'+(e.clientY-r.top-r.height/2)*0.25+'px)';});
  b.addEventListener('mouseleave',function(){b.style.transform='';});
});
// ── Pulse ring on hero CTA ──
var fc=document.querySelector('.lf-hero-cta .lf-btn-gold');
if(fc)setTimeout(function(){fc.style.animation='lfPulse 2.4s ease infinite';},2000);
// ── Lenis smooth scroll ──
if(typeof Lenis!=='undefined'){
  var lenis=new Lenis({lerp:.08,smoothWheel:true});
  if(typeof gsap!=='undefined'&&typeof ScrollTrigger!=='undefined'){
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.add(function(t){lenis.raf(t*1000);});
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll',ScrollTrigger.update);
    // Section reveals
    gsap.utils.toArray('.lf-reveal').forEach(function(el){
      gsap.fromTo(el,{opacity:0,y:40},{opacity:1,y:0,duration:.85,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 88%',toggleActions:'play none none none'}});
    });
    // Stagger service/bio cards
    document.querySelectorAll('.lf-svc-grid,.lf-bio-grid,.lf-gallery-grid').forEach(function(grid){
      var cards=grid.querySelectorAll('.lf-svc-card,.lf-bio-card,.lf-gi');
      if(cards.length)gsap.fromTo(cards,{opacity:0,y:36},{opacity:1,y:0,duration:.7,stagger:.1,ease:'power2.out',scrollTrigger:{trigger:grid,start:'top 85%'}});
    });
    // Stat counters
    document.querySelectorAll('.lf-stat-n').forEach(function(el){
      var raw=el.textContent,num=parseFloat(raw);
      if(isNaN(num))return;
      var suffix=raw.replace(String(num),'');
      gsap.fromTo({v:0},{v:num},{duration:1.6,ease:'power1.out',scrollTrigger:{trigger:el,start:'top 90%'},onUpdate:function(){el.textContent=Math.round(this.targets()[0].v)+suffix;}});
    });
  } else {
    requestAnimationFrame(function raf(t){lenis.raf(t);requestAnimationFrame(raf);});
    // fallback IO reveals
    var ro=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting)x.target.classList.add('in');});},{threshold:.1,rootMargin:'0px 0px -40px 0px'});
    document.querySelectorAll('.lf-reveal').forEach(function(el){ro.observe(el);});
  }
} else {
  // No Lenis — plain IO reveals
  var ro2=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting)x.target.classList.add('in');});},{threshold:.1,rootMargin:'0px 0px -40px 0px'});
  document.querySelectorAll('.lf-reveal').forEach(function(el){ro2.observe(el);});
}
// ── Canvas hero (gold radial mesh) ──
(function(){
  var canvas=document.getElementById('lfHeroCanvas');
  if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var W,H;
  function resize(){W=canvas.width=canvas.offsetWidth;H=canvas.height=canvas.offsetHeight;}
  resize();
  window.addEventListener('resize',resize);
  var blobs=[
    {x:.5,y:.45,r:.55,ox:.5,oy:.45,spd:.00008,phase:0,c:'rgba(207,169,71,'},
    {x:.25,y:.7,r:.38,ox:.25,oy:.7,spd:.00011,phase:2.1,c:'rgba(180,120,30,'},
    {x:.78,y:.28,r:.32,ox:.78,oy:.28,spd:.00014,phase:4.3,c:'rgba(230,200,100,'}
  ];
  function draw(ts){
    ctx.clearRect(0,0,W,H);
    blobs.forEach(function(b){
      var a=ts*b.spd+b.phase;
      var x=(b.ox+Math.sin(a)*0.12)*W;
      var y=(b.oy+Math.cos(a*1.3)*0.09)*H;
      var rg=ctx.createRadialGradient(x,y,0,x,y,b.r*Math.max(W,H));
      rg.addColorStop(0,b.c+'0.18)');
      rg.addColorStop(1,b.c+'0)');
      ctx.fillStyle=rg;
      ctx.fillRect(0,0,W,H);
    });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
// ── Image blur-up ──
(function(){
  var imgs=document.querySelectorAll('img[loading="lazy"]');
  imgs.forEach(function(img){img.classList.add('img-blur');});
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting)return;
      var img=en.target;
      if(img.complete){img.classList.add('loaded');io.unobserve(img);return;}
      img.addEventListener('load',function(){img.classList.add('loaded');},{once:true});
      io.unobserve(img);
    });
  },{rootMargin:'200px'});
  imgs.forEach(function(img){io.observe(img);});
})();
// ── 3D card tilt ──
document.querySelectorAll('.lf-svc-card,.lf-bio-card').forEach(function(card){
  card.addEventListener('mousemove',function(e){
    var r=card.getBoundingClientRect();
    var x=((e.clientX-r.left)/r.width-.5)*14;
    var y=-((e.clientY-r.top)/r.height-.5)*14;
    card.style.transform='perspective(800px) rotateY('+x+'deg) rotateX('+y+'deg) scale(1.03)';
  });
  card.addEventListener('mouseleave',function(){card.style.transform='';});
});
// ── View Transitions API ──
if(document.startViewTransition){
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');
    if(!a)return;
    var h=a.getAttribute('href')||'';
    if(!h||h.startsWith('#')||h.startsWith('tel:')||h.startsWith('mailto:')||a.target==='_blank')return;
    try{var u=new URL(h,location.href);if(u.origin!==location.origin)return;}catch(x){return;}
    e.preventDefault();
    document.startViewTransition(function(){window.location.href=h;});
  });
}
// ── Custom cursor ──
(function(){
  if(!window.matchMedia('(pointer:fine)').matches)return;
  var dot=document.createElement('div');dot.className='lf-cursor-dot';
  var ring=document.createElement('div');ring.className='lf-cursor-ring';
  document.body.appendChild(dot);document.body.appendChild(ring);
  var mx=0,my=0,rx=0,ry=0;
  document.addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;dot.style.left=mx+'px';dot.style.top=my+'px';});
  document.addEventListener('mousedown',function(){dot.classList.add('clicking');});
  document.addEventListener('mouseup',function(){dot.classList.remove('clicking');});
  document.querySelectorAll('a,button').forEach(function(el){
    el.addEventListener('mouseenter',function(){ring.classList.add('hovering');});
    el.addEventListener('mouseleave',function(){ring.classList.remove('hovering');});
  });
  (function loop(){rx+=(mx-rx)*.12;ry+=(my-ry)*.12;ring.style.left=rx+'px';ring.style.top=ry+'px';requestAnimationFrame(loop);})();
})();
})();</script>`;
}

function lfWrap(title, metaDesc, keywords, schema, body, extraSchemas = []) {
  const allSchemas = [schema, ...extraSchemas].filter(Boolean);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${metaDesc}">
<meta name="keywords" content="${keywords}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${metaDesc}">
<meta property="og:image" content="${LF.heroBg}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://assets.cdn.filesafe.space">
<link rel="preload" as="image" href="${LF.heroBg}" fetchpriority="high">
${lfCSS()}
${allSchemas.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
</head><body>${body}
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
${lfScript()}</body></html>`;
}

function lfFaqHtml(items, openFirst = true) {
  return items.map((f,i)=>`<div class="lf-faq-item${openFirst&&i===0?' open':''}"><button class="lf-faq-btn" type="button"><strong>${f.q}</strong><span class="lf-faq-icon">${openFirst&&i===0?'−':'+'}</span></button><div class="lf-faq-body"><p>${f.a}</p></div></div>`).join('');
}

function lfReviewsHtml() {
  return LF.reviews.map((r,i)=>`<article class="lf-rc"><div class="lf-stars">★★★★★</div><h4>${r.name}</h4><small>${r.meta} · ${i+1}</small><p>${r.text}</p></article>`).join('');
}

// ── Page builders ──────────────────────────────────────────

function lfBuildHome() {
  const photos = [...LF.colorPhotos.slice(0,3),...LF.blackPhotos.slice(0,3)];
  const reels  = [...LF.blackVideos.slice(0,4),...LF.colorVideos.slice(0,4)];
  const photoGrid = photos.map((s,i)=>`<article class="lf-gi img"><img src="${s}" alt="${i<3?'Color realism':'Black and gray'} tattoo by Luis Farrera Soho NYC" loading="${i<2?'eager':'lazy'}" decoding="async"><div class="lf-gm"><div><strong>${i<3?'Color Realism':'Black & Gray'}</strong><span>Soho, NYC</span></div></div></article>`).join('');
  const reelHtml = reels.map((s,i)=>`<article class="lf-reel-card"><video muted loop playsinline preload="none" data-lv><source src="${s}" type="video/mp4"></video><div class="lf-reel-meta"><strong>${i<4?'Black & Gray':'Color'} Reel</strong><span>Perspective ${String(i+1).padStart(2,'0')}</span></div></article>`).join('');
  const schema = {"@context":"https://schema.org","@type":"TattooParlor","name":"Luis Farrera Tattoo Artist","image":LF.heroBg,"description":"Luxury tattoo artist in Soho, Manhattan specializing in black and gray realism and color realism.","address":{"@type":"PostalAddress","streetAddress":"132 Crosby St 4th floor","addressLocality":"New York","addressRegion":"NY","postalCode":"10012","addressCountry":"US"},"telephone":"+1-833-362-6091","url":"https://luisfarreratattoo.com","areaServed":"New York City","priceRange":"$$$"};
  const body = `${lfNav('home')}
<section class="lf-hero" style="position:relative;"><canvas id="lfHeroCanvas"></canvas><div class="lf-hero-bg"><img src="${LF.heroBg}" alt="Luis Farrera tattoo artist Soho NYC" fetchpriority="high"></div>
<div class="lf-c lf-hero-in lf-reveal in"><div class="lf-hero-copy"><div class="lf-kicker">Soho · New York City</div><h1>Luis Farrera<br>Tattoo Artist</h1><p>Master of black and gray realism and color realism. Private studio at 132 Crosby St, Soho, Manhattan — by appointment only.</p><div class="lf-hero-actions"><a href="/portfolio" class="lf-btn lf-btn-light">View Portfolio</a><a href="/contact-us" class="lf-btn lf-btn-line">Book Now</a></div></div>
<div class="lf-hero-side"><div class="lf-hero-card"><img src="${LF.portrait}" alt="Luis Farrera portrait" loading="eager"></div></div></div></section>
<div class="lf-stats lf-reveal"><div class="lf-stat"><div class="lf-stat-n">14+</div><div class="lf-stat-l">Years Experience</div></div><div class="lf-stat"><div class="lf-stat-n">500+</div><div class="lf-stat-l">Pieces Completed</div></div><div class="lf-stat"><div class="lf-stat-n">5★</div><div class="lf-stat-l">Google Rating</div></div><div class="lf-stat"><div class="lf-stat-n">Soho</div><div class="lf-stat-l">New York City</div></div></div>
<section class="lf-bio lf-s"><div class="lf-c lf-bio-grid lf-reveal"><div class="lf-bio-card"><div class="lf-ey">Artist Story</div><h2 class="lf-title"><em>Luxury tattooing in Soho</em>The Artist Behind the Work</h2><div class="lf-bio-inline"><img src="${LF.portrait}" alt="Luis Farrera bio" loading="lazy"><div class="lf-bio-text"><p>Born in Caracas, Venezuela, Luis won graffiti competitions by 17 and graduated with honors in industrial design. That foundation of structure, balance, and composition defines every tattoo he creates.</p><p>After Miami, a 2020 opportunity brought him permanently to New York City. He now works from his private Soho studio, specializing in black and gray realism and color realism — built to last, photograph beautifully, and feel elevated in person.</p></div></div><div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap;"><a href="/about-us" class="lf-btn lf-btn-gold">Full Story</a><a href="/contact-us" class="lf-btn lf-btn-line">Book Now</a></div></div><div class="lf-bio-photo"><img src="${LF.studioBg}" alt="Luis Farrera in his Soho studio" loading="lazy"></div></div></section>
<section class="lf-s lf-reveal" style="background:linear-gradient(180deg,#080808,#050505);"><div class="lf-c"><div class="lf-sec-head"><div><div class="lf-ey">Selected Works</div><h2 class="lf-title"><em>Black & gray · Color realism</em>Featured Portfolio</h2></div><a href="/portfolio" class="lf-btn lf-btn-line">Full Portfolio</a></div><div class="lf-gallery-grid">${photoGrid}</div></div></section>
<section class="lf-s lf-reveal" style="background:#040404;"><div class="lf-c"><div class="lf-sec-head"><div><div class="lf-ey">Motion Collection</div><h2 class="lf-title"><em>In motion</em>Cinematic Reels</h2></div></div><div class="lf-reel-row">${reelHtml}</div></div></section>
<section class="lf-reviews lf-s"><div class="lf-rev-bg"><img src="${LF.studioBg}" alt="" aria-hidden="true" loading="lazy"></div><div class="lf-c lf-rev-in lf-reveal"><div class="lf-rev-top"><div class="lf-ey" style="justify-content:center">Client Voices</div><h2 class="lf-title">What My Clients Say</h2><div style="margin-top:20px"><a href="/contact-us" class="lf-btn lf-btn-gold">Book Your Session</a></div></div><div class="lf-rev-track" id="lfRT">${lfReviewsHtml()}</div><div style="display:flex;justify-content:center;gap:10px;margin-top:16px;"><button class="lf-slider-btn" id="lfRP">←</button><button class="lf-slider-btn" id="lfRN">→</button></div></div></section>
<section class="lf-location lf-s"><div class="lf-c lf-loc-wrap lf-reveal"><div class="lf-ey" style="justify-content:center">The Studio</div><h2 class="lf-title">Find Us in Soho</h2><div class="lf-loc-addr">132 Crosby St, 4th Floor · New York, NY 10012</div><div class="lf-loc-proof"><span>Private Soho Studio</span><span>By Appointment Only</span><span>Serving NYC &amp; Beyond</span></div><a href="/contact-us" class="lf-btn lf-btn-gold">Book Your Appointment</a><div class="lf-map-wrap"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=132%20Crosby%20St%204th%20floor%2C%20New%20York%2C%20NY%2010012&z=15&output=embed" title="Luis Farrera Soho studio"></iframe></div></div></section>
<section class="lf-faq lf-s"><div class="lf-c lf-reveal"><div class="lf-faq-top"><div class="lf-ey" style="justify-content:center">FAQ</div><h2 class="lf-title">Frequently Asked Questions</h2></div><div class="lf-faq-list">${lfFaqHtml(LF.faqs.slice(0,4))}</div><div style="text-align:center;margin-top:26px;"><a href="/contact-us" class="lf-btn lf-btn-gold">Book Now / Ask a Question</a></div></div></section>
<section class="lf-cta"><div class="lf-c"><h2>Ready to Book Your Session?</h2><p>Luxury tattoo artistry in the heart of Soho, Manhattan.</p><a href="/contact-us" class="lf-btn lf-btn-gold">Secure Your Appointment →</a></div></section>
${lfFooter()}`;
  const faqSchema = { "@context":"https://schema.org","@type":"FAQPage","mainEntity": LF.faqs.map(f=>({ "@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a} })) };
  const ratingSchema = { "@context":"https://schema.org","@type":"TattooParlor","name":"Luis Farrera Tattoo Artist","aggregateRating":{"@type":"AggregateRating","ratingValue":"5","reviewCount":String(LF.reviews.length),"bestRating":"5"},"review": LF.reviews.map(r=>({ "@type":"Review","author":{"@type":"Person","name":r.name},"reviewRating":{"@type":"Rating","ratingValue":"5"},"reviewBody":r.text })) };
  return lfWrap('Luis Farrera | Tattoo Artist Soho NYC | Black & Gray Realism','Luxury tattoo artist in Soho, Manhattan. Black and gray realism and color realism. Studio at 132 Crosby St, NYC. Book your appointment.','tattoo artist soho nyc,realism tattoo manhattan,black and gray realism tattoo new york,color realism tattoo nyc,custom tattoo artist soho,luis farrera tattoo',schema,body,[faqSchema,ratingSchema]);
}

function lfBuildAbout() {
  const schema = {"@context":"https://schema.org","@type":"Person","name":"Luis Farrera","jobTitle":"Tattoo Artist","image":LF.portrait,"description":"Venezuelan-born realism tattoo artist based in Soho, Manhattan. Specializes in black and gray realism and color realism.","worksFor":{"@type":"TattooParlor","name":"Luis Farrera Tattoo Artist","address":{"@type":"PostalAddress","streetAddress":"132 Crosby St 4th floor","addressLocality":"New York","addressRegion":"NY","postalCode":"10012"}}};
  const details = [['Address','132 Crosby St, 4th Floor'],['Neighborhood','Soho, Manhattan'],['City','New York, NY 10012'],['Availability','By Appointment Only'],['Specialties','Black & Gray · Color Realism'],['Guest Spots','Select cities — inquire via form']];
  const body = `${lfNav('about')}
<section class="lf-page-hero"><div class="lf-page-hero-bg"><img src="${LF.studioBg}" alt="Luis Farrera studio" loading="eager"></div><div class="lf-c lf-page-hero-in lf-reveal in" style="padding:80px 0 60px;"><div class="lf-ey">Artist Story</div><h1 class="lf-title"><em>From Caracas to Soho</em>About Luis Farrera</h1><p class="lf-sub" style="margin-top:14px;max-width:560px;">A Venezuelan-born artist whose foundation in design, graffiti, and fine art shapes every tattoo he creates in New York City.</p></div></section>
<div class="lf-stats lf-reveal"><div class="lf-stat"><div class="lf-stat-n">14+</div><div class="lf-stat-l">Years Tattooing</div></div><div class="lf-stat"><div class="lf-stat-n">500+</div><div class="lf-stat-l">Custom Pieces</div></div><div class="lf-stat"><div class="lf-stat-n">2</div><div class="lf-stat-l">Core Specialties</div></div><div class="lf-stat"><div class="lf-stat-n">NYC</div><div class="lf-stat-l">Home Base</div></div></div>
<section class="lf-bio lf-s"><div class="lf-c lf-bio-grid lf-reveal"><div class="lf-bio-card"><div class="lf-ey">The Full Story</div><h2 class="lf-title"><em>Design · Graffiti · Realism</em>The Artist's Journey</h2><div class="lf-bio-inline"><img src="${LF.portrait}" alt="Luis Farrera portrait" loading="lazy"><div class="lf-bio-text"><p>Born and raised in Caracas, Venezuela, Luis Farrera grew up surrounded by a vibrant creative culture. He was winning graffiti competitions by the age of 17 — developing an instinct for composition, color theory, and how an image interacts with a surface.</p><p>He graduated with honors in industrial design, giving him something most tattoo artists never formally learn: structured visual thinking. The ability to see how form, weight, and balance work together before a single line is drawn.</p><p>After building his practice in Miami, a 2020 opportunity brought him permanently to New York. He now works from his private Soho studio — pieces designed to last, photograph beautifully, and feel elevated in person.</p></div></div></div><div class="lf-bio-photo"><img src="${LF.studioBg}" alt="Luis Farrera working in his studio" loading="lazy"></div></div></section>
<section class="lf-s lf-reveal" style="background:#080808;"><div class="lf-c"><div style="display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;"><div><div class="lf-ey">New York Chapter</div><h2 class="lf-title"><em>Miami → New York City</em>The Soho Studio</h2><p class="lf-sub" style="margin-top:14px;">After building a strong portfolio in Miami, Luis relocated to New York in 2020. That move cemented his position among the city's serious collectors and high-end tattoo clientele.</p><p style="font-size:15px;line-height:1.85;color:rgba(255,255,255,.62);margin-top:18px;">Working from 132 Crosby St, 4th floor, his studio serves clients from all five boroughs and collectors who travel specifically for his work. He also rotates through select guest spots throughout the year.</p><div style="margin-top:26px;"><a href="/contact-us" class="lf-btn lf-btn-gold">Book a Consultation</a></div></div><div style="background:var(--panel);padding:28px;border:1px solid var(--line);">${details.map(([l,v])=>`<div style="padding:13px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;"><span style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--soft);">${l}</span><span style="font-size:13px;color:var(--text);text-align:right;">${v}</span></div>`).join('')}</div></div></div></div></section>
<section class="lf-s lf-reveal" style="background:#050505;"><div class="lf-c"><div style="text-align:center;max-width:760px;margin:0 auto 44px;"><div class="lf-ey" style="justify-content:center;">Philosophy</div><h2 class="lf-title"><em>How Luis approaches every piece</em>What Sets the Work Apart</h2></div><div class="lf-svc-grid">${[{icon:'◆',title:'Composition First',text:"Every piece is designed before it's drawn. Placement, flow, and how the tattoo interacts with the body are considered from the start."},{icon:'◈',title:'Built to Last',text:'Luis designs for longevity — considering how contrast, saturation, and detail will hold up over years, not just in fresh photos.'},{icon:'◇',title:'Custom Always',text:"No flash, no repeats. Every client receives a concept built specifically for their idea, skin tone, and placement."}].map(s=>`<div class="lf-svc-card"><div style="font-size:26px;color:var(--gold2);">${s.icon}</div><h3>${s.title}</h3><p>${s.text}</p></div>`).join('')}</div></div></section>
<section class="lf-cta"><div class="lf-c"><h2>Work With Luis Farrera</h2><p>Private studio. Premium artistry. Soho, Manhattan — by appointment only.</p><a href="/contact-us" class="lf-btn lf-btn-gold">Book Your Session →</a></div></section>
${lfFooter()}`;
  return lfWrap('About Luis Farrera | Realism Tattoo Artist | Soho NYC','Meet Luis Farrera, Venezuelan-born tattoo artist in Soho, Manhattan. Industrial design graduate, graffiti champion, master of black and gray realism and color realism at 132 Crosby St.','luis farrera tattoo artist,about luis farrera,soho tattoo artist nyc,realism tattoo artist manhattan,venezuelan tattoo artist new york city',schema,body);
}

function lfBuildPortfolio() {
  const schema = {"@context":"https://schema.org","@type":"ImageGallery","name":"Luis Farrera Tattoo Portfolio","description":"Full portfolio of black and gray realism and color realism tattoos by Luis Farrera, Soho NYC.","author":{"@type":"Person","name":"Luis Farrera"}};
  const imgCard = (src,lbl,i) => `<article class="lf-gi img"><img src="${src}" alt="${lbl} tattoo by Luis Farrera NYC ${i+1}" loading="lazy" decoding="async"><div class="lf-gm"><div><strong>${lbl}</strong><span>Portfolio piece ${i+1}</span></div></div></article>`;
  const vidCard = (src,lbl,i) => `<article class="lf-gi vid"><video muted loop playsinline preload="none" data-lv><source src="${src}" type="video/mp4"></video><div class="lf-gm"><div><strong>${lbl}</strong><span>Motion ${i+1}</span></div><div class="lf-play">▶</div></div></article>`;
  const reels = [...LF.blackVideos.slice(0,4),...LF.colorVideos.slice(0,4)];
  const reelHtml = reels.map((s,i)=>`<article class="lf-reel-card"><video muted loop playsinline preload="none" data-lv><source src="${s}" type="video/mp4"></video><div class="lf-reel-meta"><strong>${i<4?'Black & Gray':'Color'} Reel</strong><span>Perspective ${String(i+1).padStart(2,'0')}</span></div></article>`).join('');
  const body = `${lfNav('portfolio')}
<section class="lf-page-hero"><div class="lf-page-hero-bg"><img src="${LF.colorPhotos[0]}" alt="Luis Farrera portfolio" loading="eager"></div><div class="lf-c lf-page-hero-in lf-reveal in" style="padding:80px 0 60px;"><div class="lf-ey">Stills of Permanence</div><h1 class="lf-title"><em>Black & gray · Color realism</em>The Portfolio</h1><p class="lf-sub" style="margin-top:14px;max-width:500px;">Every piece designed custom, executed with precision, built to last. Browse by style below.</p></div></section>
<section class="lf-s lf-reveal" style="background:linear-gradient(180deg,#080808,#050505);"><div class="lf-c">
<div class="lf-chip-nav"><button class="lf-chip act" data-target="lfCP">Color Realism Photos</button><button class="lf-chip" data-target="lfBP">Black &amp; Gray Photos</button><button class="lf-chip" data-target="lfCV">Color Reels</button><button class="lf-chip" data-target="lfBV">Black &amp; Gray Reels</button></div>
<div class="lf-pg act" id="lfCP"><div class="lf-pb"><h3>I. Color Realism</h3><div class="lf-gallery-grid">${LF.colorPhotos.map((s,i)=>imgCard(s,'Color Realism',i)).join('')}</div></div></div>
<div class="lf-pg" id="lfBP"><div class="lf-pb"><h3>II. Black &amp; Gray Archive</h3><div class="lf-gallery-grid">${LF.blackPhotos.map((s,i)=>imgCard(s,'Black & Gray',i)).join('')}</div></div></div>
<div class="lf-pg" id="lfCV"><div class="lf-pb"><h3>III. Color Motion</h3><div class="lf-gallery-grid">${LF.colorVideos.map((s,i)=>vidCard(s,'Color Reel',i)).join('')}</div></div></div>
<div class="lf-pg" id="lfBV"><div class="lf-pb"><h3>IV. Black &amp; Gray Motion</h3><div class="lf-gallery-grid">${LF.blackVideos.map((s,i)=>vidCard(s,'B&G Reel',i)).join('')}</div></div></div>
<div style="margin-top:28px;text-align:center;"><a href="/contact-us" class="lf-btn lf-btn-gold">Book Your Custom Piece</a></div></div></section>
<section class="lf-s lf-reveal" style="background:#040404;"><div class="lf-c"><div class="lf-sec-head"><div><div class="lf-ey">Motion Collection</div><h2 class="lf-title"><em>Cinematic</em>All Reels</h2></div></div><div class="lf-reel-row">${reelHtml}</div></div></section>
<section class="lf-cta"><div class="lf-c"><h2>Inspired by the Work?</h2><p>Every piece in this portfolio is custom. Yours starts with a consultation.</p><a href="/contact-us" class="lf-btn lf-btn-gold">Start Your Custom Piece →</a></div></section>
${lfFooter()}`;
  return lfWrap('Portfolio | Luis Farrera | Black & Gray & Color Realism NYC','Browse Luis Farrera full tattoo portfolio. Black and gray realism, color realism, and cinematic reels from his Soho NYC studio at 132 Crosby St, Manhattan.','luis farrera portfolio,tattoo portfolio soho nyc,black and gray realism tattoo nyc,color realism tattoo portfolio manhattan',schema,body);
}

function lfBuildServices() {
  const schema = {"@context":"https://schema.org","@type":"Service","provider":{"@type":"Person","name":"Luis Farrera","address":{"@type":"PostalAddress","streetAddress":"132 Crosby St 4th floor","addressLocality":"New York","addressRegion":"NY","postalCode":"10012"}},"serviceType":"Tattoo Artist","description":"Black and gray realism, color realism, and custom tattoo design by Luis Farrera in Soho, NYC."};
  const svcs = [{icon:'◆',seo:'Black & Gray Realism Tattoo NYC',title:'Black & Gray Realism',desc:"The signature specialty. Portraits, wildlife, architecture, and abstract — executed with smooth tonal transitions, deep contrast, and shading that reads as three-dimensional on skin.",bullets:['Portrait realism','Wildlife & nature scenes','Geometric & abstract B&G','Fine-line detailed work','Cover-up transformations']},{icon:'◈',seo:'Color Realism Tattoo Manhattan',title:'Color Realism',desc:"Vibrant, detail-rich color work with strong saturation designed to hold over time. Skin tone awareness, long-term color retention, and bold finish are built into every piece.",bullets:['Floral & botanical color','Animal & wildlife color','Fantasy & surrealism','Color portrait realism','Full sleeve compositions']},{icon:'◇',seo:'Custom Tattoo Artist Soho NYC',title:'Custom Design',desc:"Every project begins as a blank canvas. Clients bring ideas, references, and placement goals — Luis shapes them into a concept that fits the body, the person, and the long-term vision.",bullets:['Full custom concept development','Reference analysis & elevation','Placement & size consultation','Multi-session collector pieces','Body suit planning']}];
  const procs = [{step:'01',title:'Submit Your Inquiry',desc:'Use the booking form to share your concept, placement, size, style, and reference images. Be as specific as you can.'},{step:'02',title:'Consultation',desc:'Luis reviews your submission and follows up to discuss the concept, refine the direction, and confirm the session plan.'},{step:'03',title:'Custom Design',desc:"A custom design is created specifically for your body placement, skin tone, and visual direction — no templates."},{step:'04',title:'Your Session',desc:'Professional studio at 132 Crosby St, Soho. Clean setup, focused execution, a finished piece built to last.'}];
  const body = `${lfNav('services')}
<section class="lf-page-hero"><div class="lf-page-hero-bg"><img src="${LF.heroBg}" alt="Luis Farrera services" loading="eager"></div><div class="lf-c lf-page-hero-in lf-reveal in" style="padding:80px 0 60px;"><div class="lf-ey">What We Offer</div><h1 class="lf-title"><em>Soho, New York City</em>Tattoo Services</h1><p class="lf-sub" style="margin-top:14px;max-width:500px;">Three core specialties. One standard: collector-level quality on every piece.</p></div></section>
<section class="lf-s lf-reveal" style="background:linear-gradient(180deg,#080808,#050505);"><div class="lf-c"><div style="text-align:center;max-width:680px;margin:0 auto 44px;"><div class="lf-ey" style="justify-content:center;">Core Specialties</div><h2 class="lf-title">What Luis Farrera Does</h2></div><div class="lf-svc-grid">${svcs.map(s=>`<div class="lf-svc-card"><div style="font-size:28px;color:var(--gold2);">${s.icon}</div><div class="lf-ey" style="margin-top:10px;">${s.seo}</div><h3>${s.title}</h3><p>${s.desc}</p><ul style="list-style:none;margin-top:18px;padding:0;display:flex;flex-direction:column;gap:7px;">${s.bullets.map(b=>`<li style="font-size:13px;color:rgba(255,255,255,.62);padding-left:16px;position:relative;"><span style="position:absolute;left:0;color:var(--gold);">▸</span>${b}</li>`).join('')}</ul></div>`).join('')}</div></div></section>
<section class="lf-s lf-reveal" style="background:#040404;"><div class="lf-c"><div style="text-align:center;max-width:680px;margin:0 auto 44px;"><div class="lf-ey" style="justify-content:center;">How It Works</div><h2 class="lf-title"><em>From inquiry to finished piece</em>The Process</h2></div><div class="lf-proc">${procs.map(s=>`<div class="lf-proc-step"><div class="lf-proc-num">${s.step}</div><h4>${s.title}</h4><p>${s.desc}</p></div>`).join('')}</div></div></section>
<section class="lf-faq lf-s lf-reveal"><div class="lf-c"><div class="lf-faq-top"><div class="lf-ey" style="justify-content:center;">Questions?</div><h2 class="lf-title">Service FAQ</h2></div><div class="lf-faq-list">${lfFaqHtml(LF.faqs)}</div><div style="text-align:center;margin-top:26px;"><a href="/contact-us" class="lf-btn lf-btn-gold">Book Your Session</a></div></div></section>
<section class="lf-cta"><div class="lf-c"><h2>Ready to Start Your Custom Piece?</h2><p>Collector-level tattoo artistry. Private studio. Soho, Manhattan.</p><a href="/contact-us" class="lf-btn lf-btn-gold">Book a Consultation →</a></div></section>
${lfFooter()}`;
  return lfWrap('Tattoo Services | Luis Farrera | Black & Gray · Color Realism | Soho NYC','Tattoo services by Luis Farrera in Soho, NYC. Black and gray realism, color realism, custom design. Studio at 132 Crosby St. Book a consultation.','tattoo services soho nyc,black and gray realism tattoo service,color realism tattoo manhattan,custom tattoo artist new york,soho tattoo studio',schema,body);
}

function lfBuildContact() {
  const schema = {"@context":"https://schema.org","@type":"TattooParlor","name":"Luis Farrera Tattoo Artist","telephone":"+1-833-362-6091","address":{"@type":"PostalAddress","streetAddress":"132 Crosby St 4th floor","addressLocality":"New York","addressRegion":"NY","postalCode":"10012","addressCountry":"US"},"openingHoursSpecification":{"@type":"OpeningHoursSpecification","description":"By appointment only"}};
  const contactRows = [['📍','Address','132 Crosby St, 4th Floor, New York, NY 10012'],['🏙','Neighborhood','Soho, Manhattan'],['📅','Availability','By Appointment Only'],['◆','Specialties','Black & Gray Realism · Color Realism · Custom'],['✈','Guest Spots','Select cities — inquire via form']];
  const body = `${lfNav('contact')}
<section class="lf-page-hero"><div class="lf-page-hero-bg"><img src="${LF.studioBg}" alt="Book Luis Farrera" loading="eager"></div><div class="lf-c lf-page-hero-in lf-reveal in" style="padding:80px 0 60px;"><div class="lf-ey">Secure Your Session</div><h1 class="lf-title"><em>132 Crosby St · Soho · NYC</em>Book Now</h1><p class="lf-sub" style="margin-top:14px;max-width:500px;">Private studio appointments. Custom work only. Submit your concept and Luis will follow up directly.</p></div></section>
<section class="lf-s lf-reveal" style="background:linear-gradient(180deg,#080808,#050505);"><div class="lf-c lf-contact-grid">
<div><div class="lf-ci"><h3>Studio Info</h3>${contactRows.map(([ic,l,v])=>`<div class="lf-cr"><div class="lf-cr-icon">${ic}</div><div><div class="lf-cr-lbl">${l}</div><div class="lf-cr-val">${v}</div></div></div>`).join('')}</div><div class="lf-map-wrap" style="margin-top:18px;"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=132%20Crosby%20St%204th%20floor%2C%20New%20York%2C%20NY%2010012&z=15&output=embed" title="Luis Farrera Soho studio"></iframe></div></div>
<div><div class="lf-book-wrap"><h3>Book Your Session</h3><p style="font-size:14px;line-height:1.8;color:var(--muted);margin-bottom:22px;">Submit your concept below — placement, size, style, and reference images. Luis will follow up directly.</p><iframe src="${LF.bookUrl}" style="width:100%;min-height:660px;border:0;background:transparent;" title="Book a tattoo appointment with Luis Farrera" loading="lazy"></iframe></div></div>
</div></section>
<section class="lf-faq lf-s lf-reveal"><div class="lf-c"><div class="lf-faq-top"><div class="lf-ey" style="justify-content:center;">Before You Book</div><h2 class="lf-title">Booking FAQ</h2></div><div class="lf-faq-list">${lfFaqHtml(LF.faqs)}</div></div></section>
<section class="lf-cta"><div class="lf-c"><h2>Luis Farrera · 132 Crosby St · Soho NYC</h2><p>Private studio. Collector-level artistry. By appointment only.</p><a href="${LF.bookUrl}" target="_blank" rel="noopener" class="lf-btn lf-btn-gold">Submit Your Concept →</a></div></section>
${lfFooter()}`;
  return lfWrap('Book a Tattoo | Luis Farrera | 132 Crosby St Soho NYC','Book a tattoo appointment with Luis Farrera at 132 Crosby St, 4th floor, Soho, Manhattan, New York 10012. Custom black and gray realism and color realism.','book tattoo appointment nyc,tattoo booking soho manhattan,luis farrera book now,tattoo appointment 132 crosby st,soho tattoo booking',schema,body);
}

// GET /sofia/luis-farrera — 5-page download hub for Luis Farrera
app.get('/sofia/luis-farrera', (req, res) => {
  try {
    const pages = { home: lfBuildHome(), about: lfBuildAbout(), portfolio: lfBuildPortfolio(), services: lfBuildServices(), contact: lfBuildContact() };
    const cacheId = crypto.randomBytes(8).toString('hex');
    websitePackageCache.set(cacheId, { pages, clientName: 'Luis Farrera', expires: Date.now() + 600000 });
    const fileMap = [
      {label:'Home Page',      page:'home',      filename:'index.html',     slug:'(root / homepage)'},
      {label:'About',          page:'about',     filename:'about-us.html',  slug:'about-us'},
      {label:'Portfolio',      page:'portfolio', filename:'portfolio.html', slug:'portfolio'},
      {label:'Services',       page:'services',  filename:'services.html',  slug:'services'},
      {label:'Book Now',       page:'contact',   filename:'contact-us.html',slug:'contact-us'},
    ];
    const buttons = fileMap.map(f=>`<a href="/sofia/website-download?id=${cacheId}&page=${f.page}&filename=${f.filename}" style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 24px;text-decoration:none;color:#1a1a1a;margin-bottom:10px;transition:all .15s;" onmouseover="this.style.borderColor='#cfa947';this.style.background='#fffcf2'" onmouseout="this.style.borderColor='#e5e7eb';this.style.background='#fff'"><div><div style="font-weight:700;font-size:15px;">${f.label}</div><div style="font-size:12px;color:#9ca3af;margin-top:2px;">${f.filename} — GHL slug: <strong>${f.slug}</strong></div></div><div style="background:#cfa947;color:#111;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:700;">↓ Download</div></a>`).join('');
    const hub = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luis Farrera — Website Package</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1a1a1a;padding:40px 20px}.card{background:#fff;border-radius:16px;padding:36px;max-width:600px;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.06)}.logo{height:36px;margin-bottom:18px;filter:brightness(0)}.badge{display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:100px;margin-bottom:14px}h1{font-size:22px;font-weight:800;margin-bottom:4px}.sub{font-size:13px;color:#6b7280;margin-bottom:18px}.kws{background:#fdf9ec;border:1px solid #f0d980;border-radius:8px;padding:14px 18px;margin:0 0 22px;font-size:12px;color:#78350f;line-height:1.8}.how{background:#f1f5f9;border-radius:10px;padding:14px 18px;margin-top:22px;font-size:12px;color:#475569;line-height:1.7}.how strong{color:#1a1a1a}</style></head><body><div class="card"><img src="${LF.logo}" class="logo" alt="Luis Farrera"><div class="badge">✓ Ready to Deploy</div><h1>Luis Farrera Tattoo Artist</h1><p class="sub">Soho, NYC · 5 Custom Pages · Bebas Neue Design System</p><div class="kws"><strong style="display:block;color:#92400e;margin-bottom:5px;">🎯 Target SEO Keywords</strong>tattoo artist soho nyc · realism tattoo manhattan · black and gray realism tattoo new york city · color realism tattoo nyc · luis farrera tattoo artist · custom tattoo artist soho · book tattoo appointment nyc · tattoo artist 132 crosby st · luxury tattoo manhattan · soho tattoo studio 2025</div>${buttons}<div class="how"><strong>Upload to GHL Websites:</strong><br>1. Download each file below<br>2. GHL → Sites → Websites → open the site<br>3. Add page → switch to <strong>Custom Code</strong> mode<br>4. Paste full HTML → Save<br><br><strong>⚠ Set exact slugs in GHL or nav links break:</strong><br>index.html → Homepage (root) · about-us.html → <strong>about-us</strong> · portfolio.html → <strong>portfolio</strong> · services.html → <strong>services</strong> · contact-us.html → <strong>contact-us</strong><br><br><em style="color:#94a3b8;font-size:11px;">Links expire in 10 minutes. Refresh this URL to regenerate.</em></div></div></body></html>`;
    res.setHeader('Content-Type','text/html');
    res.send(hub);
  } catch(err) { res.status(500).send(`<pre>Error: ${err.message}\n${err.stack}</pre>`); }
});

// ══════════════════════════════════════════════════════════════
// THE ESCOBAR KITCHEN — Owner.com-style sales site
// ══════════════════════════════════════════════════════════════
const EK = {
  name:       'The Escobar Kitchen',
  tagline:    "Orlando's Boldest Latin-Asian Fusion",
  logo:       'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/69a7ac1bb701fe6a3e793b91.png',
  logoAlt:    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/69a7ac1b618c8dbb13a87fcd.png',
  orderUrl:   'https://direct.chownow.com/order/28921/locations/65004',
  phone:      '+14077438827',
  phoneDisplay: '(407) 743-8827',
  email:      'info@theescobarkitchen.com',
  ig:         'https://www.instagram.com/theescobarkitchen/',
  heroVideo:  'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee7200d7250d.mp4',
  heroVideo2: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3120c03541f804ad33.mp4',
  locations: [
    {
      name: "Hunters Creek", slug: '/hunters-creek',
      address: '13769 S John Young Pkwy, Orlando, FL 32837',
      phone: '+14072032664', phoneDisplay: '(407) 203-2664',
      hours: 'Mon–Wed 4–9pm · Thu 4–10pm · Fri–Sat 4–10pm',
      hoursShort: 'Mon–Wed 4–9pm, Thu–Sat 4–10pm',
      note: '',
      map: 'https://www.google.com/maps/embed/v1/place?key=&q=13769+S+John+Young+Pkwy+Orlando+FL+32837',
      mapSrc: 'https://maps.google.com/maps?q=13769+S+John+Young+Pkwy+Orlando+FL+32837&output=embed',
      rating: '4.6', reviews: '452',
    },
    {
      name: "Lake Nona", slug: '/lake-nona',
      address: '13024 Narcoossee Rd, Orlando, FL 32832',
      phone: '+14076539174', phoneDisplay: '(407) 653-9174',
      hours: 'Mon–Thu 12–7:30pm · Fri–Sat 12–8pm · Sun 12–7:30pm',
      hoursShort: 'Mon–Thu 12–7:30pm, Fri–Sat 12–8pm, Sun 12–7:30pm',
      note: 'Inside The Bravo Market',
      map: 'https://www.google.com/maps/embed/v1/place?key=&q=13024+Narcoossee+Rd+Orlando+FL+32832',
      mapSrc: 'https://maps.google.com/maps?q=13024+Narcoossee+Rd+Orlando+FL+32832&output=embed',
      rating: '4.7', reviews: '200+',
    },
    {
      name: "Downtown Orlando", slug: '/downtown-orlando',
      address: '420 E Church St, Ste 108, Orlando, FL 32801',
      phone: '+14077308350', phoneDisplay: '(407) 730-8350',
      hours: 'Mon–Thu 2–9pm · Fri–Sat 2–10pm · Sun 12–8pm',
      hoursShort: 'Mon–Thu 2–9pm, Fri–Sat 2–10pm, Sun 12–8pm',
      note: 'Wine Bar · Craft Cocktails',
      map: 'https://www.google.com/maps/embed/v1/place?key=&q=420+E+Church+St+Orlando+FL+32801',
      mapSrc: 'https://maps.google.com/maps?q=420+E+Church+St+Ste+108+Orlando+FL+32801&output=embed',
      rating: '4.6', reviews: '150+',
    },
  ],
  toast: {
    rewardsSignup: 'https://www.toasttab.com/the-escobars-kitchen-hunters-creek-13769-s-john-young-pkwy/rewardsSignup',
    rewardsLookup: 'https://www.toasttab.com/the-escobars-kitchen-hunters-creek-13769-s-john-young-pkwy/rewardsLookup',
    eGiftCards:    'https://order.toasttab.com/egiftcards/the-escobars-kitchen-hunters-creek-13769-s-john-young-pkwy',
    findCard:      'https://www.toasttab.com/the-escobars-kitchen-hunters-creek-13769-s-john-young-pkwy/findcard',
  },
  // Professional food photos
  photos: [
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee78eed72511.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714eea41dd72501.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee6a78d724fd.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714eea385d72506.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee0c99d724fe.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee2521d72500.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714eeb330d7250a.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee32d2d72505.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee5ec9d72503.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcdb1b443e38.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc10f0443e40.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcbf73443e32.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc6e47443e1e.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee703bd724fb.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcdba0443e4b.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc4e42443e29.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc4fd8443e0e.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc9a5d443df9.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcf2a7443e41.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcbdcc443e3c.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bcfe74443e4c.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc2fc4443de5.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc6520443e27.jpg',
    'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b3155d8bc83f1443dfd.jpg',
  ],
  menu: [
    { name: 'Crispy Rice Tuna', desc: 'Spicy tuna, crispy rice, jalapeño, sriracha aioli', price: '$18', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee78eed72511.jpg' },
    { name: 'Latin Bowl', desc: 'Rice, beans, plantains, choice of protein, pico de gallo', price: '$16', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714eea41dd72501.jpg' },
    { name: 'Gyro Wrap', desc: 'Seasoned lamb & beef, tzatziki, tomato, red onion, pita', price: '$15', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee6a78d724fd.jpg' },
    { name: 'Empanadas', desc: 'Crispy hand-folded pastries, beef or chicken, chimichurri dip', price: '$12', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714eea385d72506.jpg' },
    { name: 'Fusion Tacos', desc: 'Soy-glazed pork belly, pickled slaw, sesame, wonton strips', price: '$17', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee0c99d724fe.jpg' },
    { name: 'Catering Platter', desc: 'Full spread for events — serves 10+, customizable menu', price: 'From $180', photo: 'https://assets.cdn.filesafe.space/rJKRuyayc6Z6twr9X20v/media/699b3b31f714ee2521d72500.jpg' },
  ],
  reviews: [
    { name: 'Jessica M.', stars: 5, text: 'Best spicy tuna crispy rice in all of Orlando. The flavors are insane — Latin meets Asian perfectly. We come every week.' },
    { name: 'Carlos R.', stars: 5, text: 'Three locations and every single one is consistent. The food is fresh, the portions are generous, and the staff is amazing.' },
    { name: 'Ashley T.', stars: 5, text: 'Ordered catering for our office party. Everyone was blown away. The platters were beautiful and everything was delicious.' },
    { name: 'Miguel F.', stars: 5, text: 'The Latin Bowl is my go-to. Perfect combination of rice, protein, and those plantains. Nothing like it in Kissimmee.' },
    { name: 'Daniela K.', stars: 5, text: 'Finally a restaurant that does fusion right. Not gimmicky, just genuinely delicious food with bold flavors.' },
    { name: 'Robert J.', stars: 5, text: '4.6 stars on Google with 452 reviews speaks for itself. This place is the real deal. The crispy rice is worth the drive alone.' },
  ],
  faqs: [
    { q: 'Where is The Escobar Kitchen located?', a: 'We have 3 locations in Orlando, FL: Hunters Creek (13769 S John Young Pkwy), Lake Nona (13024 Narcoossee Rd, inside The Bravo Market), and Downtown Orlando (420 E Church St, Ste 108). Each location has its own hours — see our Locations page for full details.' },
    { q: 'Can I order online for pickup or delivery?', a: 'Yes! Click "Order Now" on any page to place an online order for pickup or delivery via ChowNow. We also deliver through DoorDash and Uber Eats.' },
    { q: 'Do you offer catering?', a: 'Absolutely. We cater events of all sizes — corporate lunches, birthday parties, weddings, and more. Platters from $180, serving 10 to 500+. Contact us at info@theescobarkitchen.com or call (407) 743-8827 for catering inquiries.' },
    { q: 'What type of cuisine is The Escobar Kitchen?', a: "We serve bold Latin-Asian fusion — think crispy rice tuna, Latin bowls, fusion tacos, empanadas, and gyro wraps. It's Orlando's most unique culinary experience with 3 locations." },
    { q: 'What are the hours at each location?', a: 'Hunters Creek: Mon–Wed 4–9pm, Thu–Sat 4–10pm. Lake Nona: Mon–Thu 12–7:30pm, Fri–Sat 12–8pm, Sun 12–7:30pm. Downtown Orlando: Mon–Thu 2–9pm, Fri–Sat 2–10pm, Sun 12–8pm.' },
    { q: 'Do you have a rewards program?', a: 'Yes! Sign up for Toast Rewards to earn points on every visit. Use the Rewards link in the footer or ask your server for a QR code.' },
    { q: 'Does the Downtown Orlando location have a bar?', a: 'Yes — our Downtown Orlando location features a full wine bar and craft cocktails, making it perfect for date nights, happy hours, and celebrations.' },
  ],
};

function ekCSS() {
  return `<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&display=swap');
:root{
  --black:#080608;--dark:#100e10;--surface:#1a161a;
  --red:#e00103;--red2:#ff2d30;--cta:#c50002;
  --text:#fff;--muted:rgba(255,255,255,0.55);--soft:rgba(255,255,255,0.35);
  --line:rgba(255,255,255,0.08);--line2:rgba(255,255,255,0.12);
  --display:'Bebas Neue',sans-serif;--body:'DM Sans',sans-serif;
  --max:1200px;--r:10px;
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:auto;}
body{font-family:var(--body);background:var(--black);color:var(--text);overflow-x:hidden;}
a{text-decoration:none;color:inherit;}
img{max-width:100%;display:block;}

/* NAV */
.ek-nav-wrap{position:sticky;top:0;z-index:1000;background:rgba(8,6,8,0.96);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);}
.ek-c{width:min(var(--max),calc(100% - 40px));margin:0 auto;}
.ek-nav{display:flex;align-items:center;justify-content:space-between;height:66px;gap:20px;}
.ek-brand img{height:36px;width:auto;object-fit:contain;}
.ek-nav-links{display:flex;align-items:center;gap:28px;}
.ek-nav-links a{font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);transition:color .2s;}
.ek-nav-links a:hover,.ek-nav-links a.act{color:#fff;}
.ek-order-btn{background:var(--red);color:#fff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:0 20px;height:38px;border-radius:4px;display:inline-flex;align-items:center;transition:background .18s;}
.ek-order-btn:hover{background:var(--cta);}
.ek-mob{display:none;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:4px;}

/* HERO SLIDESHOW */
.ek-hero{position:relative;height:100vh;min-height:600px;overflow:hidden;display:flex;align-items:center;}
.ek-hero-slides{position:absolute;inset:0;z-index:0;}
.ek-hero-slide{position:absolute;inset:0;opacity:0;will-change:opacity;}
.ek-hero-slide img{width:100%;height:100%;object-fit:cover;object-position:center;}
/* 6 slides × 5s = 30s — CSS pure crossfade */
.ek-hero-slide:nth-child(1){animation:ekHFade 30s 0s infinite;}
.ek-hero-slide:nth-child(2){animation:ekHFade 30s 5s infinite;}
.ek-hero-slide:nth-child(3){animation:ekHFade 30s 10s infinite;}
.ek-hero-slide:nth-child(4){animation:ekHFade 30s 15s infinite;}
.ek-hero-slide:nth-child(5){animation:ekHFade 30s 20s infinite;}
.ek-hero-slide:nth-child(6){animation:ekHFade 30s 25s infinite;}
@keyframes ekHFade{
  0%,100%{opacity:0;transform:scale(1.04);}
  6%,28%{opacity:1;transform:scale(1);}
  33%{opacity:0;transform:scale(1);}
}
.ek-hero-overlay{position:absolute;inset:0;background:linear-gradient(105deg,rgba(8,6,8,.88) 38%,rgba(8,6,8,.35));z-index:1;}
.ek-hero-content{position:relative;z-index:2;padding:0 0 60px;}
.ek-hero-kicker{font-size:11px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--red);margin-bottom:18px;display:flex;align-items:center;gap:10px;}
.ek-hero-kicker::before{content:'';display:inline-block;width:32px;height:1px;background:var(--red);}
.ek-hero h1{font:400 clamp(68px,9vw,130px)/0.88 var(--display);text-transform:uppercase;letter-spacing:2px;margin-bottom:20px;}
.ek-hero h1 em{color:var(--red);font-style:normal;}
.ek-hero-sub{font-size:17px;color:var(--muted);line-height:1.65;max-width:500px;margin-bottom:32px;}
.ek-hero-btns{display:flex;gap:12px;flex-wrap:wrap;}
.ek-btn{display:inline-flex;align-items:center;justify-content:center;height:52px;padding:0 28px;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;border-radius:4px;transition:.2s ease;border:1px solid transparent;white-space:nowrap;}
.ek-btn-red{background:var(--red);color:#fff;border-color:var(--red);}
.ek-btn-red:hover{background:var(--cta);}
.ek-btn-acc{background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.25);backdrop-filter:blur(8px);}
.ek-btn-acc:hover{background:rgba(255,255,255,0.2);border-color:#fff;}
.ek-btn-line{background:transparent;color:#fff;border-color:rgba(255,255,255,0.3);}
.ek-btn-line:hover{border-color:#fff;}
.ek-hero-proof{margin-top:44px;display:flex;align-items:center;gap:20px;padding-top:24px;border-top:1px solid var(--line);}
.ek-stars{color:var(--red);font-size:17px;letter-spacing:2px;}
.ek-proof-text{font-size:13px;color:var(--muted);}
.ek-proof-text strong{color:#fff;}

/* TRUST MARQUEE */
.ek-marquee{overflow:hidden;background:var(--red);padding:11px 0;}
.ek-marquee-inner{display:flex;width:max-content;animation:ekMarquee 28s linear infinite;}
.ek-marquee-item{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#fff;padding:0 28px;white-space:nowrap;}
.ek-marquee-item::after{content:'◆';margin-left:28px;opacity:0.5;}
@keyframes ekMarquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

/* ORDER DIRECT BANNER */
.ek-save-banner{background:var(--dark);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:64px 0;}
.ek-save-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;}
.ek-save-col{padding:32px 28px;text-align:center;position:relative;}
.ek-save-col::after{content:'';position:absolute;top:20%;right:0;height:60%;width:1px;background:var(--line);}
.ek-save-col:last-child::after{display:none;}
.ek-save-label{font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;}
.ek-save-num{font:400 clamp(48px,5vw,72px)/1 var(--display);letter-spacing:1px;margin-bottom:8px;}
.ek-save-sub{font-size:13px;color:var(--muted);line-height:1.5;}
.ek-save-col.bad .ek-save-label{color:rgba(255,255,255,0.35);}
.ek-save-col.bad .ek-save-num{color:rgba(255,255,255,0.3);text-decoration:line-through;text-decoration-color:rgba(255,255,255,0.2);}
.ek-save-col.good .ek-save-label{color:var(--red);}
.ek-save-col.good .ek-save-num{color:var(--red);}
.ek-save-col.win .ek-save-label{color:#4ade80;}
.ek-save-col.win .ek-save-num{color:#4ade80;}

/* SECTIONS */
.ek-s{padding:88px 0;}
.ek-sec-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:52px;gap:20px;flex-wrap:wrap;}
.ek-ey{font-size:10px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--red);margin-bottom:10px;}
.ek-title{font:400 clamp(36px,5vw,64px)/1 var(--display);text-transform:uppercase;letter-spacing:1px;}
.ek-title em{color:var(--red);font-style:normal;}
.ek-sub{font-size:16px;color:var(--muted);line-height:1.7;max-width:560px;margin-top:14px;}

/* ORDER STRIP */
.ek-order-strip{background:var(--red);padding:32px 0;}
.ek-order-strip-in{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.ek-order-strip h2{font:400 clamp(26px,4vw,48px)/1 var(--display);text-transform:uppercase;color:#fff;letter-spacing:1px;}
.ek-order-strip p{font-size:14px;color:rgba(255,255,255,0.7);margin-top:6px;}
.ek-order-strip .ek-btn-acc{height:52px;padding:0 32px;font-size:11px;}

/* MENU GRID */
.ek-menu-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;}
.ek-menu-card{position:relative;overflow:hidden;aspect-ratio:1;cursor:pointer;}
.ek-menu-card img{width:100%;height:100%;object-fit:cover;transition:transform .5s ease;}
.ek-menu-card:hover img{transform:scale(1.06);}
.ek-menu-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,6,8,0.92) 0%,transparent 55%);opacity:0;transition:opacity .3s;}
.ek-menu-card:hover .ek-menu-overlay{opacity:1;}
.ek-menu-info{position:absolute;bottom:0;left:0;right:0;padding:20px;transform:translateY(8px);transition:transform .3s;}
.ek-menu-card:hover .ek-menu-info{transform:translateY(0);}
.ek-menu-name{font:400 22px/1 var(--display);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;}
.ek-menu-desc{font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:10px;}
.ek-menu-price{font-size:13px;font-weight:700;color:var(--red);}

/* FOOD SLIDESHOW */
.ek-fslide-wrap{position:relative;overflow:hidden;background:var(--black);}
.ek-fslide-track{display:flex;transition:transform .5s cubic-bezier(.4,0,.2,1);will-change:transform;}
.ek-fslide-item{flex:0 0 calc(100%/3);aspect-ratio:.85;overflow:hidden;}
.ek-fslide-item img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s;}
.ek-fslide-item:hover img{transform:scale(1.04);}
.ek-fslide-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:10;background:rgba(8,6,8,.7);border:1px solid rgba(255,255,255,.15);color:#fff;width:44px;height:44px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;backdrop-filter:blur(6px);}
.ek-fslide-nav:hover{background:var(--red);}
.ek-fslide-prev{left:16px;}
.ek-fslide-next{right:16px;}
@media(max-width:768px){.ek-fslide-item{flex:0 0 calc(100%/2);}}
@media(max-width:480px){.ek-fslide-item{flex:0 0 100%;}}

/* FULL BLEED FOOD PHOTO */
.ek-food-feature{display:grid;grid-template-columns:1fr 1fr;min-height:540px;}
.ek-food-img{overflow:hidden;}
.ek-food-img img{width:100%;height:100%;object-fit:cover;}
.ek-food-copy{background:var(--dark);display:flex;flex-direction:column;justify-content:center;padding:72px 60px;}
.ek-food-copy .ek-ey{margin-bottom:14px;}

/* PHOTO GRID (used on inner pages) */
.ek-photo-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;}
.ek-photo-item{aspect-ratio:.8;overflow:hidden;}
.ek-photo-item img{width:100%;height:100%;object-fit:cover;transition:transform .5s;}
.ek-photo-item:hover img{transform:scale(1.05);}
.ek-photo-item.tall{grid-row:span 2;aspect-ratio:auto;}

/* LOCATIONS */
.ek-loc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
.ek-loc-card{background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);overflow:hidden;}
.ek-loc-map{height:190px;}
.ek-loc-map iframe{width:100%;height:100%;border:0;filter:grayscale(1) brightness(0.55);}
.ek-loc-info{padding:22px;}
.ek-loc-name{font:400 20px/1 var(--display);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;}
.ek-loc-addr{font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:10px;}
.ek-loc-hours{font-size:11px;font-weight:600;letter-spacing:1px;color:var(--red);text-transform:uppercase;margin-bottom:14px;}
.ek-loc-actions{display:flex;gap:8px;flex-wrap:wrap;}

/* REVIEWS */
.ek-rev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
.ek-rev-card{background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);padding:26px;}
.ek-rev-stars{color:var(--red);font-size:15px;letter-spacing:2px;margin-bottom:13px;}
.ek-rev-text{font-size:14px;line-height:1.75;color:rgba(255,255,255,0.8);margin-bottom:16px;font-style:italic;}
.ek-rev-name{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);}

/* CATERING */
.ek-catering{background:var(--surface);border-radius:var(--r);overflow:hidden;display:grid;grid-template-columns:1fr 1fr;}
.ek-catering-img img{width:100%;height:100%;object-fit:cover;min-height:420px;}
.ek-catering-copy{padding:64px 52px;display:flex;flex-direction:column;justify-content:center;}

/* FAQ */
.ek-faq-list{max-width:800px;margin:0 auto;}
.ek-faq-item{border-bottom:1px solid var(--line2);padding:20px 0;}
.ek-faq-btn{width:100%;text-align:left;background:transparent;border:0;color:#fff;font-size:15px;font-weight:600;padding:0;display:flex;justify-content:space-between;align-items:center;gap:16px;cursor:pointer;}
.ek-faq-icon{font-size:22px;color:var(--red);flex-shrink:0;}
.ek-faq-body{max-height:0;overflow:hidden;transition:max-height .35s ease;}
.ek-faq-item.open .ek-faq-body{max-height:240px;}
.ek-faq-body p{font-size:14px;color:var(--muted);line-height:1.8;padding-top:14px;}

/* FOOTER */
.ek-footer{background:#050305;border-top:1px solid var(--line);padding:48px 0 28px;}
.ek-footer-in{display:grid;grid-template-columns:1fr 1fr 1fr;gap:36px;margin-bottom:32px;}
.ek-footer-brand img{height:32px;margin-bottom:14px;}
.ek-footer-brand p{font-size:13px;color:var(--soft);line-height:1.7;}
.ek-footer-col h4{font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--red);margin-bottom:14px;}
.ek-footer-col a,.ek-footer-col p{font-size:13px;color:var(--muted);display:block;margin-bottom:8px;transition:color .2s;}
.ek-footer-col a:hover{color:#fff;}
.ek-footer-bottom{border-top:1px solid var(--line);padding-top:22px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
.ek-footer-copy{font-size:11px;color:var(--soft);letter-spacing:1px;}

/* STICKY ORDER BAR (mobile) */
.ek-sticky-order{display:none;position:fixed;bottom:0;left:0;right:0;z-index:999;background:var(--red);padding:13px 20px;text-align:center;}
.ek-sticky-order a{color:#fff;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}

/* CTA BAND */
.ek-cta-band{background:linear-gradient(135deg,var(--dark) 0%,#160608 100%);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:72px 0;text-align:center;}
.ek-cta-band h2{font:400 clamp(40px,6vw,80px)/1 var(--display);text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;}
.ek-cta-band p{font-size:16px;color:var(--muted);margin-bottom:30px;}
.ek-cta-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}

/* REVEAL */
.ek-reveal{opacity:0;transform:translateY(28px);transition:opacity .75s ease,transform .75s ease;}
.ek-reveal.in{opacity:1;transform:translateY(0);}

/* RESPONSIVE */
@media(max-width:1100px){
  .ek-menu-grid{grid-template-columns:repeat(2,1fr);}
  .ek-loc-grid{grid-template-columns:repeat(2,1fr);}
  .ek-rev-grid{grid-template-columns:repeat(2,1fr);}
  .ek-food-feature{grid-template-columns:1fr;}
  .ek-catering{grid-template-columns:1fr;}
  .ek-catering-img img{min-height:280px;}
  .ek-footer-in{grid-template-columns:1fr 1fr;}
  .ek-save-grid{grid-template-columns:1fr;}
  .ek-save-col::after{display:none;}
  .ek-photo-grid{grid-template-columns:repeat(3,1fr);}
}
@media(max-width:768px){
  .ek-nav-links{display:none;}
  .ek-mob{display:block;}
  .ek-hero{height:92vh;}
  .ek-menu-grid{grid-template-columns:repeat(2,1fr);}
  .ek-loc-grid,.ek-rev-grid{grid-template-columns:1fr;}
  .ek-photo-grid{grid-template-columns:repeat(2,1fr);}
  .ek-footer-in{grid-template-columns:1fr;}
  .ek-order-strip-in{flex-direction:column;text-align:center;}
  .ek-food-copy{padding:44px 28px;}
  .ek-sticky-order{display:block;}
  body{padding-bottom:54px;}
  .ek-sec-head{flex-direction:column;align-items:flex-start;}
  .ek-catering-copy{padding:36px 24px;}
}
@media(max-width:500px){
  .ek-hero h1{font-size:58px;}
  .ek-menu-grid{grid-template-columns:1fr;}
  .ek-btn{width:100%;justify-content:center;}
  .ek-hero-btns,.ek-cta-btns{flex-direction:column;}
}
</style>`;
}

function ekNav(activePage) {
  const links = [
    { href: '/', label: 'Home' },
    { href: '/menu', label: 'Menu' },
    { href: '/locations', label: 'Locations' },
    { href: '/catering', label: 'Catering' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ];
  return `<div class="ek-nav-wrap"><div class="ek-c ek-nav">
  <a href="/" class="ek-brand"><img src="${EK.logo}" alt="The Escobar Kitchen" width="120" height="38" fetchpriority="high"></a>
  <nav class="ek-nav-links" id="ekNav">
    ${links.map(l=>`<a href="${l.href}"${activePage===l.href?' class="act"':''}>${l.label}</a>`).join('')}
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-order-btn">Order Now</a>
  </nav>
  <button class="ek-mob" id="ekMob">&#9776;</button>
</div></div>`;
}

function ekFooter() {
  return `<footer class="ek-footer"><div class="ek-c">
  <div class="ek-footer-in">
    <div class="ek-footer-brand">
      <img src="${EK.logo}" alt="The Escobar Kitchen">
      <p>Orlando's boldest Latin-Asian fusion.<br>3 locations across Central Florida.</p>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:40px;padding:0 18px;font-size:10px;">Order Online</a>
        <a href="/catering" class="ek-btn ek-btn-line" style="height:40px;padding:0 18px;font-size:10px;">Book Catering</a>
      </div>
      <div style="margin-top:20px;display:flex;gap:12px;">
        <a href="${EK.ig}" target="_blank" rel="noopener" style="font-size:11px;color:var(--muted);letter-spacing:1px;">Instagram</a>
        <a href="${EK.toast.rewardsSignup}" target="_blank" rel="noopener" style="font-size:11px;color:var(--gold);letter-spacing:1px;">Join Rewards</a>
      </div>
    </div>
    <div class="ek-footer-col">
      <h4>Our Locations</h4>
      ${EK.locations.map(l=>`<a href="${l.slug}"><strong style="color:#fff;">${l.name}</strong></a>
      <p style="margin-top:2px;margin-bottom:10px;">${l.address}${l.note?`<br><em style="color:var(--gold);font-size:11px;">${l.note}</em>`:''}</p>`).join('')}
    </div>
    <div class="ek-footer-col">
      <h4>Contact</h4>
      <a href="tel:${EK.locations[0].phone}">${EK.locations[0].phoneDisplay} (Hunters Creek)</a>
      <a href="tel:${EK.locations[1].phone}">${EK.locations[1].phoneDisplay} (Lake Nona)</a>
      <a href="tel:${EK.locations[2].phone}">${EK.locations[2].phoneDisplay} (Downtown)</a>
      <a href="mailto:${EK.email}" style="margin-top:8px;">${EK.email}</a>
      <h4 style="margin-top:20px;">Rewards &amp; Gifts</h4>
      <a href="${EK.toast.rewardsSignup}" target="_blank" rel="noopener">Join Toast Rewards</a>
      <a href="${EK.toast.rewardsLookup}" target="_blank" rel="noopener">Check My Rewards</a>
      <a href="${EK.toast.eGiftCards}" target="_blank" rel="noopener">Buy E-Gift Cards</a>
      <a href="${EK.toast.findCard}" target="_blank" rel="noopener">Check Gift Card Balance</a>
    </div>
  </div>
  <div class="ek-footer-bottom">
    <div style="display:flex;gap:20px;flex-wrap:wrap;">
      <a href="/" style="font-size:11px;color:var(--soft);">Home</a>
      <a href="/menu" style="font-size:11px;color:var(--soft);">Menu</a>
      <a href="/locations" style="font-size:11px;color:var(--soft);">Locations</a>
      <a href="/catering" style="font-size:11px;color:var(--soft);">Catering</a>
      <a href="/about" style="font-size:11px;color:var(--soft);">About</a>
      <a href="/contact" style="font-size:11px;color:var(--soft);">Contact</a>
    </div>
    <span class="ek-footer-copy">© ${new Date().getFullYear()} The Escobar Kitchen · Powered by <strong>JRZ Marketing</strong></span>
  </div>
</div></footer>
<div class="ek-sticky-order"><a href="${EK.orderUrl}" target="_blank" rel="noopener">Order Online — Pickup &amp; Delivery Available →</a></div>`;
}

function ekScript() {
  return `<script>(function(){
// Mobile nav
var mob=document.getElementById('ekMob'),nav=document.getElementById('ekNav');
if(mob&&nav)mob.addEventListener('click',function(){var o=nav.style.display==='flex';nav.style.cssText=o?'':'display:flex;flex-direction:column;position:fixed;inset:68px 10px auto;padding:18px;background:rgba(10,8,4,.98);border:1px solid rgba(255,255,255,.08);gap:16px;z-index:999;align-items:stretch;';});
window.addEventListener('resize',function(){if(window.innerWidth>768&&nav)nav.style.cssText='';});
// Reveal
var ro=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting)x.target.classList.add('in');});},{threshold:.1,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.ek-reveal').forEach(function(el){ro.observe(el);});
// FAQ
document.querySelectorAll('.ek-faq-item').forEach(function(item){
  var btn=item.querySelector('.ek-faq-btn');if(!btn)return;
  btn.addEventListener('click',function(){var o=item.classList.contains('open');document.querySelectorAll('.ek-faq-item').forEach(function(x){x.classList.remove('open');var ic=x.querySelector('.ek-faq-icon');if(ic)ic.textContent='+';});if(!o){item.classList.add('open');var ic=item.querySelector('.ek-faq-icon');if(ic)ic.textContent='−';}});
});
// Lenis
if(typeof Lenis!=='undefined'){
  var lenis=new Lenis({lerp:.08,smoothWheel:true});
  if(typeof gsap!=='undefined'&&typeof ScrollTrigger!=='undefined'){
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.add(function(t){lenis.raf(t*1000);});
    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll',ScrollTrigger.update);
    gsap.utils.toArray('.ek-reveal').forEach(function(el){
      gsap.fromTo(el,{opacity:0,y:40},{opacity:1,y:0,duration:.85,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 88%'}});
    });
  } else {
    requestAnimationFrame(function raf(t){lenis.raf(t);requestAnimationFrame(raf);});
  }
}
// View Transitions
if(document.startViewTransition){
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');if(!a)return;
    var h=a.getAttribute('href')||'';
    if(!h||h.startsWith('#')||h.startsWith('tel:')||h.startsWith('mailto:')||a.target==='_blank')return;
    try{var u=new URL(h,location.href);if(u.origin!==location.origin)return;}catch(x){return;}
    e.preventDefault();document.startViewTransition(function(){window.location.href=h;});
  });
}
})();</script>`;
}

function ekWrap(title, metaDesc, keywords, schema, body) {
  // Preload first 2 hero photos for LCP
  const preloads = EK.photos.slice(0,2).map(p=>`<link rel="preload" as="image" href="${p}" fetchpriority="high">`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${metaDesc}">
<meta name="keywords" content="${keywords}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:image" content="${EK.photos[0]}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://assets.cdn.filesafe.space">
${preloads}
${ekCSS()}
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org","@type":"FAQPage",
  "mainEntity": EK.faqs.map(f=>({ "@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a} }))
})}</script>
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org","@type":"Restaurant",
  "name":"The Escobar Kitchen","servesCuisine":["Latin","Asian Fusion"],
  "priceRange":"$$","telephone":EK.phone,"email":EK.email,
  "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"600","bestRating":"5"},
  "review": EK.reviews.map(r=>({ "@type":"Review","author":{"@type":"Person","name":r.name},"reviewRating":{"@type":"Rating","ratingValue":"5"},"reviewBody":r.text })),
  "hasMenu": EK.orderUrl,
  "location": EK.locations.map(l=>({ "@type":"Place","name":`The Escobar Kitchen — ${l.name}`,"address":{"@type":"PostalAddress","streetAddress":l.address,"addressLocality":"Orlando","addressRegion":"FL","addressCountry":"US"} }))
})}</script>
</head>
<body>${body}
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
${ekScript()}
</body></html>`;
}

function ekBuildHome(kwData = []) {
  // SEO keywords from DataForSEO
  const primaryKw  = kwData[0]?.keyword || 'latin asian fusion orlando';
  const titleKws   = kwData.slice(0,3).map(k=>k.keyword).join(', ') || 'latin asian fusion orlando, escobar kitchen, latin food orlando';
  const metaKws    = kwData.slice(0,8).map(k=>k.keyword).join(',') || 'latin asian fusion orlando,escobar kitchen,latin restaurant orlando fl,latin food near me orlando,order latin food online orlando,latin asian fusion restaurant near me,latin food delivery orlando,best latin food orlando';

  // Hero — 6-photo crossfade slideshow (first 2 eager, rest lazy)
  const heroSlides = EK.photos.slice(0,6).map((p,i)=>`<div class="ek-hero-slide">
    <img src="${p}" alt="Escobar Kitchen ${EK.locations[i%3].name} Orlando food" width="1400" height="900"${i<2?' fetchpriority="high" loading="eager"':' loading="lazy"'}>
  </div>`).join('');

  // Food slideshow (replaces photo grid) — 18 photos
  const slideItems = EK.photos.slice(0,18).map((p,i)=>`<div class="ek-fslide-item">
    <img src="${p}" alt="Escobar Kitchen food Orlando" loading="${i<3?'eager':'lazy'}" width="400" height="470">
  </div>`).join('');

  // Marquee — order-direct focused
  const mItems = ['Order Direct & Save','No App Fees','Pickup in 15 Min','Hunters Creek','Lake Nona','Downtown Orlando','4.6 Stars on Google','Skip the DoorDash Fees','Save $5–$12 Per Order','600+ Reviews'];
  const marqueeHtml = [...mItems,...mItems].map(i=>`<span class="ek-marquee-item">${i}</span>`).join('');

  // Menu grid — first image eager
  const menuGrid = EK.menu.map((m,i)=>`<div class="ek-menu-card">
    <img src="${m.photo}" alt="${m.name} — Order Direct Escobar Kitchen" width="400" height="400"${i===0?' loading="eager"':' loading="lazy"'}>
    <div class="ek-menu-overlay"></div>
    <div class="ek-menu-info">
      <div class="ek-menu-name">${m.name}</div>
      <div class="ek-menu-desc">${m.desc}</div>
      <div class="ek-menu-price">${m.price}</div>
    </div>
  </div>`).join('');

  // Reviews
  const revHtml = EK.reviews.map(r=>`<div class="ek-rev-card ek-reveal">
    <div class="ek-rev-stars">★★★★★</div>
    <p class="ek-rev-text">"${r.text}"</p>
    <div class="ek-rev-name">— ${r.name}</div>
  </div>`).join('');

  // Locations strip
  const locHtml = EK.locations.map(l=>`<div class="ek-loc-card ek-reveal">
    <div class="ek-loc-map"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${l.mapSrc}" title="${l.name} location"></iframe></div>
    <div class="ek-loc-info">
      <div class="ek-loc-name">${l.name}</div>
      <div class="ek-loc-addr">${l.address}${l.note?`<br><small style="color:var(--red);font-size:11px;">${l.note}</small>`:''}</div>
      <div class="ek-loc-hours">${l.hours}</div>
      <div class="ek-loc-actions">
        <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:38px;padding:0 14px;font-size:10px;">Order Now</a>
        <a href="tel:${l.phone}" class="ek-btn ek-btn-line" style="height:38px;padding:0 14px;font-size:10px;">Call</a>
        <a href="${l.slug}" class="ek-btn ek-btn-line" style="height:38px;padding:0 14px;font-size:10px;">Details →</a>
      </div>
    </div>
  </div>`).join('');

  // FAQ
  const faqHtml = EK.faqs.slice(0,5).map((f,i)=>`<div class="ek-faq-item${i===0?' open':''}">
    <button class="ek-faq-btn" type="button"><span>${f.q}</span><span class="ek-faq-icon">${i===0?'−':'+'}</span></button>
    <div class="ek-faq-body"><p>${f.a}</p></div>
  </div>`).join('');

  const schema = {"@context":"https://schema.org","@type":"Restaurant","name":"The Escobar Kitchen","image":EK.photos[0],"description":`Orlando's boldest ${primaryKw} restaurant. Order direct online for pickup or delivery. 3 locations: Hunters Creek, Lake Nona & Downtown. 4.6 stars.`,"telephone":EK.phone,"email":EK.email,"url":"https://www.theescobarkitchen.com","servesCuisine":["Latin","Asian Fusion"],"priceRange":"$$","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"600","bestRating":"5"}};

  const body = `${ekNav('/')}

<!-- ═══ HERO: FOOD SLIDESHOW ═══ -->
<section class="ek-hero">
  <div class="ek-hero-slides">${heroSlides}</div>
  <div class="ek-hero-overlay"></div>
  <div class="ek-c ek-hero-content">
    <div class="ek-hero-kicker">Order Direct &amp; Save — 3 Orlando Locations</div>
    <h1>Order<br><em>Direct.</em><br>Save More.</h1>
    <p class="ek-hero-sub">Skip the DoorDash fees. Skip the Uber Eats markup. Order directly from The Escobar Kitchen and save up to 15% on every order — straight from us to you.</p>
    <div class="ek-hero-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:56px;padding:0 36px;font-size:12px;">Order Direct — No App Fees →</a>
      <a href="/menu" class="ek-btn ek-btn-acc">See The Menu</a>
    </div>
    <div class="ek-hero-proof">
      <div class="ek-stars">★★★★★</div>
      <div class="ek-proof-text"><strong>4.6 stars</strong> · 600+ Google reviews · <strong>Pickup in 15 min</strong></div>
    </div>
  </div>
</section>

<!-- ═══ MARQUEE ═══ -->
<div class="ek-marquee"><div class="ek-marquee-inner">${marqueeHtml}</div></div>

<!-- ═══ WHY ORDER DIRECT ═══ -->
<div class="ek-save-banner">
  <div class="ek-c">
    <div style="text-align:center;margin-bottom:40px;">
      <div class="ek-ey" style="justify-content:center;">Why Order Direct?</div>
      <h2 class="ek-title">You <em>Save</em> Every Time</h2>
      <p style="font-size:15px;color:var(--muted);max-width:460px;margin:14px auto 0;line-height:1.6;">DoorDash and Uber Eats charge 25–30% in fees. When you order directly from us, 100% goes to the food and our team.</p>
    </div>
    <div class="ek-save-grid">
      <div class="ek-save-col bad">
        <div class="ek-save-label">DoorDash / Uber Eats</div>
        <div class="ek-save-num">+30%</div>
        <div class="ek-save-sub">Hidden fees, service charges, and markups added to your total</div>
      </div>
      <div class="ek-save-col good">
        <div class="ek-save-label">Order Direct (Our Site)</div>
        <div class="ek-save-num">$0 Fees</div>
        <div class="ek-save-sub">Order direct and pay the real price — no platform markup, no service fees</div>
      </div>
      <div class="ek-save-col win">
        <div class="ek-save-label">You Save Per Order</div>
        <div class="ek-save-num">$5–$12</div>
        <div class="ek-save-sub">On a typical $40 order. That's money back in your pocket, every time</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:40px;">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:56px;padding:0 40px;font-size:12px;">Order Direct Now — Save Today →</a>
      <p style="font-size:12px;color:var(--muted);margin-top:14px;">Pickup ready in 15 minutes · Delivery available · 3 Orlando locations</p>
    </div>
  </div>
</div>

<!-- ═══ ORDER STRIP ═══ -->
<div class="ek-order-strip">
  <div class="ek-c ek-order-strip-in">
    <div>
      <h2>Hungry? Order Direct &amp; Save.</h2>
      <p>Skip the app fees — order from us directly. Pickup in 15 min or delivery to your door.</p>
    </div>
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-acc" style="height:52px;padding:0 32px;">Order Now — No Fees →</a>
  </div>
</div>

<!-- ═══ MENU GRID ═══ -->
<section class="ek-s" id="menu" style="background:var(--dark);padding-bottom:0;">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div>
        <div class="ek-ey">Latin-Asian Fusion Orlando</div>
        <h2 class="ek-title">The <em>Menu</em></h2>
        <p class="ek-sub">Bold ${primaryKw} dishes. Real ingredients. No shortcuts. Order direct and get it fresh.</p>
      </div>
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Full Menu →</a>
    </div>
  </div>
  <div class="ek-menu-grid">${menuGrid}</div>
  <div style="text-align:center;padding:40px 0;background:var(--dark);">
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:56px;padding:0 40px;font-size:12px;">Order Now — Skip the App Fees →</a>
    <p style="font-size:12px;color:var(--muted);margin-top:12px;">Pickup in 15 minutes · Delivery available · 3 Orlando locations</p>
  </div>
</section>

<!-- ═══ FOOD PHOTO SLIDESHOW ═══ -->
<div class="ek-fslide-wrap">
  <div class="ek-fslide-track" id="ekFtrack">${slideItems}</div>
  <button class="ek-fslide-nav ek-fslide-prev" id="ekFprev" aria-label="Previous">&#8592;</button>
  <button class="ek-fslide-nav ek-fslide-next" id="ekFnext" aria-label="Next">&#8594;</button>
</div>

<!-- ═══ ORDER DIRECT FEATURE ═══ -->
<div class="ek-food-feature">
  <div class="ek-food-img"><img src="${EK.photos[8]}" alt="Escobar Kitchen latin asian fusion orlando" loading="lazy" width="700" height="540"></div>
  <div class="ek-food-copy ek-reveal">
    <div class="ek-ey">Order Direct &amp; Save</div>
    <h2 class="ek-title">Same Food.<br><em>Better Price.</em></h2>
    <p class="ek-sub" style="margin-top:16px;">When you order from DoorDash or Uber Eats, you're paying 25–30% more. Order directly from The Escobar Kitchen and pay the real price — every single time.</p>
    <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px;">
      ${[
        { icon:'✓', t:'No delivery app fees or markups' },
        { icon:'✓', t:'Pickup ready in 15 minutes' },
        { icon:'✓', t:'Same great food, better value' },
        { icon:'✓', t:'Earn Toast Rewards on every direct order' },
      ].map(x=>`<div style="display:flex;align-items:center;gap:10px;font-size:14px;"><span style="color:var(--red);font-weight:700;">${x.icon}</span>${x.t}</div>`).join('')}
    </div>
    <div style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap;">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Direct Now →</a>
      <a href="${EK.toast.rewardsSignup}" target="_blank" rel="noopener" class="ek-btn ek-btn-line">Join Rewards</a>
    </div>
  </div>
</div>

<!-- ═══ REVIEWS ═══ -->
<section class="ek-s" id="reviews" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div>
        <div class="ek-ey">What Orlando Is Saying</div>
        <h2 class="ek-title">4.6 Stars · <em>600+</em> Reviews</h2>
      </div>
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Now →</a>
    </div>
    <div class="ek-rev-grid">${revHtml}</div>
  </div>
</section>

<!-- ═══ ORDER STRIP 2 ═══ -->
<div class="ek-order-strip">
  <div class="ek-c ek-order-strip-in">
    <div>
      <h2>Ready to Order?</h2>
      <p>Direct ordering · No fees · Pickup in 15 min or delivery · 3 Orlando locations</p>
    </div>
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-acc" style="height:52px;padding:0 32px;">Order Direct →</a>
  </div>
</div>

<!-- ═══ CATERING ═══ -->
<section class="ek-s" id="catering" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-catering ek-reveal">
      <div class="ek-catering-img"><img src="${EK.photos[5]}" alt="Escobar Kitchen catering Orlando events" loading="lazy" width="700" height="420"></div>
      <div class="ek-catering-copy">
        <div class="ek-ey">Events &amp; Groups</div>
        <h2 class="ek-title" style="font-size:clamp(32px,4vw,52px);">Catering<br>for Any <em>Event</em></h2>
        <p class="ek-sub" style="margin-top:16px;">Corporate lunches, birthday parties, weddings, office events. Bold Latin-Asian fusion platters from $180. Serving 10 to 500+.</p>
        <div style="margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${['Corporate Events','Birthday Parties','Weddings','Office Lunches','Holiday Events','Graduation Parties'].map(i=>`<div style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;"><span style="color:var(--red);">✓</span>${i}</div>`).join('')}
        </div>
        <div style="margin-top:26px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/catering" class="ek-btn ek-btn-red">Catering Info →</a>
          <a href="mailto:${EK.email}" class="ek-btn ek-btn-line">Request Quote</a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ═══ LOCATIONS ═══ -->
<section class="ek-s" id="locations" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div>
        <div class="ek-ey">Find Us</div>
        <h2 class="ek-title">3 Orlando <em>Locations</em></h2>
        <p class="ek-sub">Hunters Creek · Lake Nona · Downtown — <a href="/locations" style="color:var(--red);">View all hours →</a></p>
      </div>
    </div>
    <div class="ek-loc-grid">${locHtml}</div>
  </div>
</section>

<!-- ═══ FAQ ═══ -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c ek-reveal">
    <div style="text-align:center;margin-bottom:44px;">
      <div class="ek-ey">FAQ</div>
      <h2 class="ek-title">Common <em>Questions</em></h2>
    </div>
    <div class="ek-faq-list">${faqHtml}</div>
  </div>
</section>

<!-- ═══ FINAL CTA ═══ -->
<div class="ek-cta-band">
  <div class="ek-c">
    <div class="ek-ey" style="justify-content:center;">Order Direct &amp; Save</div>
    <h2>Skip the Fees.<br><em>Order Direct.</em></h2>
    <p>The Escobar Kitchen — Orlando's boldest Latin-Asian fusion. Pickup in 15 min or delivery. No app fees.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:56px;padding:0 40px;font-size:12px;">Order Direct Now →</a>
      <a href="tel:${EK.phone}" class="ek-btn ek-btn-line">Call ${EK.phoneDisplay}</a>
      <a href="/catering" class="ek-btn ek-btn-line">Book Catering</a>
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:18px;">3 Orlando locations · Hunters Creek · Lake Nona · Downtown</p>
  </div>
</div>

${ekFooter()}
<script>(function(){
  // Food photo slideshow
  var track=document.getElementById('ekFtrack');
  if(!track)return;
  var items=track.querySelectorAll('.ek-fslide-item');
  var perView=window.innerWidth>1100?3:window.innerWidth>480?2:1;
  var idx=0,total=items.length,isDown=false,startX=0,scrollLeft=0;
  function slides(){return Math.max(0,total-perView);}
  function go(n){idx=Math.max(0,Math.min(n,slides()));track.style.transform='translateX(-'+idx*(100/perView)+'%)';}
  var btn1=document.getElementById('ekFprev'),btn2=document.getElementById('ekFnext');
  if(btn1)btn1.addEventListener('click',function(){go(idx-1);});
  if(btn2)btn2.addEventListener('click',function(){go(idx+1);});
  // Auto-advance
  var timer=setInterval(function(){go(idx>=slides()?0:idx+1);},3200);
  track.parentElement.addEventListener('mouseenter',function(){clearInterval(timer);});
  track.parentElement.addEventListener('mouseleave',function(){timer=setInterval(function(){go(idx>=slides()?0:idx+1);},3200);});
  // Touch/drag
  track.addEventListener('mousedown',function(e){isDown=true;startX=e.pageX-track.offsetLeft;scrollLeft=idx;track.style.cursor='grabbing';});
  track.addEventListener('mouseleave',function(){isDown=false;track.style.cursor='';});
  track.addEventListener('mouseup',function(){isDown=false;track.style.cursor='';});
  track.addEventListener('mousemove',function(e){if(!isDown)return;e.preventDefault();var x=e.pageX-track.offsetLeft,diff=startX-x;if(Math.abs(diff)>40)go(diff>0?scrollLeft+1:scrollLeft-1);});
  window.addEventListener('resize',function(){perView=window.innerWidth>1100?3:window.innerWidth>480?2:1;go(0);});
})();</script>`;

  return ekWrap(
    `The Escobar Kitchen | Order Direct & Save | Latin Asian Fusion Orlando FL`,
    `Order direct from The Escobar Kitchen — no app fees, no markup. Orlando's boldest Latin-Asian fusion. 3 locations: Hunters Creek, Lake Nona & Downtown. 4.6 stars, 600+ reviews.`,
    metaKws,
    schema, body
  );
}

function ekBuildAbout() {
  const teamPhotos = EK.photos.slice(10, 14);
  const body = `${ekNav('/about')}
<!-- HERO -->
<section style="position:relative;padding:120px 0 80px;background:var(--dark);overflow:hidden;">
  <div style="position:absolute;inset:0;background:url(${EK.photos[8]}) center/cover;opacity:0.12;"></div>
  <div class="ek-c" style="position:relative;z-index:1;">
    <div class="ek-ey">Our Story</div>
    <h1 class="ek-title" style="font-size:clamp(52px,8vw,110px);line-height:0.9;margin-bottom:24px;">Born From<br><em>Bold</em><br>Flavors</h1>
    <p style="font-size:18px;color:var(--muted);max-width:560px;line-height:1.7;">Where Latin soul meets Asian precision. The Escobar Kitchen started with one simple idea — that the boldest flavors in the world deserve to be on the same plate.</p>
  </div>
</section>

<!-- STORY SECTION -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-food-feature ek-reveal" style="border-radius:var(--r);overflow:hidden;">
      <div class="ek-food-img"><img src="${EK.photos[9]}" alt="The Escobar Kitchen kitchen" loading="lazy"></div>
      <div class="ek-food-copy">
        <div class="ek-ey">The Beginning</div>
        <h2 class="ek-title" style="font-size:clamp(32px,4vw,52px);">A Kitchen Born<br>From <em>Passion</em></h2>
        <p class="ek-sub" style="margin-top:18px;">The Escobar Kitchen was built on the belief that food should be bold, unexpected, and unforgettable. We fuse the vibrant spices of Latin America with the clean precision of Asian cooking to create something Orlando has never tasted before.</p>
        <p class="ek-sub" style="margin-top:12px;">Every dish on our menu is a conversation between two cultures — and the result speaks for itself in every bite.</p>
      </div>
    </div>
  </div>
</section>

<!-- VALUES -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div>
        <div class="ek-ey">What We Stand For</div>
        <h2 class="ek-title">Our <em>Values</em></h2>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;" class="ek-reveal">
      ${[
        { icon:'🌶', title:'Bold Flavors', desc:'We never compromise on taste. Every ingredient is chosen to deliver maximum impact, maximum satisfaction.' },
        { icon:'🥢', title:'Fusion Done Right', desc:'This is not a gimmick. Latin and Asian cuisine share deep culinary roots — we honor both traditions in every dish.' },
        { icon:'📍', title:'Community First', desc:'Three Orlando locations because we believe in being close to the people who love our food. We grow where you are.' },
        { icon:'🌿', title:'Real Ingredients', desc:'No shortcuts, no substitutes. Fresh proteins, hand-prepared sauces, and produce sourced with care.' },
        { icon:'🎉', title:'Celebration Ready', desc:'Whether it\'s date night, a birthday, or a corporate catering order — we show up and deliver every time.' },
        { icon:'⭐', title:'600+ Five-Star Reviews', desc:'Our guests keep coming back. 4.6 stars across three locations and counting. The food does the talking.' },
      ].map(v=>`<div style="background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);padding:32px;">
        <div style="font-size:32px;margin-bottom:16px;">${v.icon}</div>
        <h3 style="font-family:var(--display);font-size:22px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">${v.title}</h3>
        <p style="font-size:14px;color:var(--muted);line-height:1.7;">${v.desc}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- PHOTO COLLAGE -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;">
  ${teamPhotos.map(p=>`<div style="aspect-ratio:1;overflow:hidden;"><img src="${p}" alt="Escobar Kitchen Orlando" loading="lazy" style="width:100%;height:100%;object-fit:cover;"></div>`).join('')}
</div>

<!-- STATS -->
<section style="background:var(--gold);padding:72px 0;">
  <div class="ek-c">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px;text-align:center;">
      ${[
        { n:'3', l:'Orlando Locations' },
        { n:'4.6★', l:'Average Google Rating' },
        { n:'600+', l:'5-Star Reviews' },
        { n:'2+', l:'Years Serving Orlando' },
      ].map(s=>`<div>
        <div style="font-family:var(--display);font-size:clamp(52px,6vw,80px);color:#000;line-height:1;">${s.n}</div>
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(0,0,0,0.6);margin-top:8px;">${s.l}</div>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- CTA -->
<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Come Taste the <em>Difference</em></h2>
    <p>3 Orlando locations. Online ordering. Catering available.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Online →</a>
      <a href="/locations" class="ek-btn ek-btn-gold">Find a Location</a>
      <a href="/catering" class="ek-btn ek-btn-line">Book Catering</a>
    </div>
  </div>
</div>
${ekFooter()}`;
  const schema = {"@context":"https://schema.org","@type":"Restaurant","name":"The Escobar Kitchen","description":"Orlando's boldest Latin-Asian fusion restaurant with 3 locations. Born from the belief that bold flavors deserve to share the same plate.","telephone":EK.phone,"email":EK.email,"image":EK.photos[0],"servesCuisine":["Latin","Asian Fusion"],"priceRange":"$$"};
  return ekWrap('About The Escobar Kitchen | Our Story | Latin Asian Fusion Orlando', "Learn the story behind The Escobar Kitchen — Orlando's boldest Latin-Asian fusion restaurant with 3 locations. Bold flavors, real ingredients, community first.", 'about escobar kitchen,escobar kitchen story,latin asian fusion orlando,escobar kitchen orlando,latin food restaurant orlando', schema, body);
}

function ekBuildLocations() {
  const locCards = EK.locations.map(l=>`
  <div class="ek-loc-card ek-reveal" style="background:var(--dark);">
    <div class="ek-loc-map"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${l.mapSrc}" title="${l.name} — The Escobar Kitchen"></iframe></div>
    <div class="ek-loc-info">
      <div class="ek-loc-name">${l.name}</div>
      <div class="ek-loc-addr">${l.address}${l.note?`<br><small style="color:var(--gold);font-style:italic;">${l.note}</small>`:''}</div>
      <div class="ek-loc-hours">${l.hours}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;"><span style="color:var(--gold);">★</span><span style="font-size:13px;">${l.rating} stars · ${l.reviews} reviews</span></div>
      <div class="ek-loc-actions">
        <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:40px;padding:0 18px;font-size:10px;">Order Now</a>
        <a href="tel:${l.phone}" class="ek-btn ek-btn-line" style="height:40px;padding:0 18px;font-size:10px;">Call ${l.phoneDisplay}</a>
        <a href="${l.slug}" class="ek-btn ek-btn-gold" style="height:40px;padding:0 18px;font-size:10px;">More Info →</a>
      </div>
    </div>
  </div>`).join('');
  const body = `${ekNav('/locations')}
<section style="padding:100px 0 60px;background:var(--dark);">
  <div class="ek-c">
    <div class="ek-ey">Where To Find Us</div>
    <h1 class="ek-title" style="font-size:clamp(52px,7vw,100px);">3 Orlando<br><em>Locations</em></h1>
    <p style="font-size:17px;color:var(--muted);max-width:520px;line-height:1.7;margin-top:16px;">Hunters Creek · Lake Nona · Downtown Orlando. All serving the same bold Latin-Asian fusion menu. Same quality, same passion, wherever you are.</p>
  </div>
</section>
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-loc-grid">${locCards}</div>
  </div>
</section>
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c ek-reveal" style="text-align:center;">
    <div class="ek-ey">Hours At A Glance</div>
    <h2 class="ek-title" style="margin-bottom:40px;">Location <em>Hours</em></h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
      ${EK.locations.map(l=>`<div style="background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);padding:28px;text-align:left;">
        <div style="font-family:var(--display);font-size:22px;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;color:var(--gold);">${l.name}</div>
        <div style="font-size:13px;color:var(--muted);line-height:2;">${l.hours.replace(/·/g,'<br>')}</div>
        ${l.note?`<div style="margin-top:12px;font-size:11px;color:var(--gold);font-style:italic;">${l.note}</div>`:''}
        <a href="tel:${l.phone}" style="display:block;margin-top:14px;font-size:13px;font-weight:600;color:#fff;">${l.phoneDisplay}</a>
      </div>`).join('')}
    </div>
  </div>
</section>
<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Order From Any <em>Location</em></h2>
    <p>Online ordering available. Pickup or delivery. 3 Orlando locations.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Online →</a>
      <a href="/catering" class="ek-btn ek-btn-line">Book Catering</a>
    </div>
  </div>
</div>
${ekFooter()}`;
  const schema = {"@context":"https://schema.org","@type":"ItemList","name":"The Escobar Kitchen Locations","itemListElement":EK.locations.map((l,i)=>({ "@type":"ListItem","position":i+1,"name":`The Escobar Kitchen — ${l.name}`,"url":`https://www.theescobarkitchen.com${l.slug}` }))};
  return ekWrap('Locations — The Escobar Kitchen | 3 Orlando FL Locations', "Find The Escobar Kitchen near you. 3 locations in Orlando: Hunters Creek, Lake Nona & Downtown. View hours, addresses, and order online.", 'escobar kitchen locations,escobar kitchen orlando,latin food near me orlando,latin asian fusion near me,hunters creek restaurant,lake nona restaurant', schema, body);
}

function ekBuildLocationPage(loc, photos) {
  const faqHtml = EK.faqs.slice(0,5).map((f,i)=>`<div class="ek-faq-item${i===0?' open':''}">
    <button class="ek-faq-btn" type="button"><span>${f.q}</span><span class="ek-faq-icon">${i===0?'−':'+'}</span></button>
    <div class="ek-faq-body"><p>${f.a}</p></div>
  </div>`).join('');
  const revHtml = EK.reviews.slice(0,3).map(r=>`<div class="ek-rev-card ek-reveal">
    <div class="ek-rev-stars">★★★★★</div>
    <p class="ek-rev-text">"${r.text}"</p>
    <div class="ek-rev-name">— ${r.name}</div>
  </div>`).join('');
  const photoGrid = photos.map(p=>`<div class="ek-photo-item"><img src="${p}" alt="Escobar Kitchen ${loc.name} Orlando" loading="lazy"></div>`).join('');
  const schema = {"@context":"https://schema.org","@type":"Restaurant","name":`The Escobar Kitchen — ${loc.name}`,"image":EK.photos[0],"description":`The Escobar Kitchen ${loc.name} location in Orlando. Bold Latin-Asian fusion. ${loc.address}. Order online for pickup or delivery.`,"address":{"@type":"PostalAddress","streetAddress":loc.address,"addressLocality":"Orlando","addressRegion":"FL","addressCountry":"US"},"telephone":loc.phone,"email":EK.email,"servesCuisine":["Latin","Asian Fusion"],"priceRange":"$$","openingHoursSpecification":[],"aggregateRating":{"@type":"AggregateRating","ratingValue":loc.rating,"reviewCount":loc.reviews.replace('+',''),"bestRating":"5"}};
  const body = `${ekNav(loc.slug)}
<!-- HERO -->
<section style="position:relative;padding:110px 0 72px;background:var(--dark);overflow:hidden;">
  <div style="position:absolute;inset:0;background:url(${photos[0]}) center/cover;opacity:0.15;"></div>
  <div class="ek-c" style="position:relative;z-index:1;">
    <div class="ek-ey">Now Open</div>
    <h1 class="ek-title" style="font-size:clamp(48px,7vw,100px);line-height:0.9;margin-bottom:20px;">Escobar Kitchen<br><em>${loc.name}</em></h1>
    <p style="font-size:16px;color:var(--muted);max-width:500px;line-height:1.7;margin-bottom:28px;">${loc.address}${loc.note?` · <em style="color:var(--gold);">${loc.note}</em>`:''}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px;">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Now →</a>
      <a href="tel:${loc.phone}" class="ek-btn ek-btn-line">Call ${loc.phoneDisplay}</a>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}" target="_blank" rel="noopener" class="ek-btn ek-btn-line">Get Directions</a>
    </div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;padding-top:24px;border-top:1px solid var(--line);">
      <div style="font-size:13px;color:var(--muted);"><strong style="color:#fff;">Hours</strong><br>${loc.hoursShort}</div>
      <div style="font-size:13px;color:var(--muted);"><strong style="color:#fff;">Phone</strong><br>${loc.phoneDisplay}</div>
      <div style="font-size:13px;color:var(--muted);"><strong style="color:#fff;">Rating</strong><br>${loc.rating} stars · ${loc.reviews} reviews</div>
    </div>
  </div>
</section>

<!-- ORDER STRIP -->
<div class="ek-order-strip">
  <div class="ek-c ek-order-strip-in">
    <div><h2>Order From ${loc.name}</h2><p>Online ordering · Pickup &amp; delivery available</p></div>
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Online Now →</a>
  </div>
</div>

<!-- MAP + INFO -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start;" class="ek-reveal">
      <div style="border-radius:var(--r);overflow:hidden;height:400px;">
        <iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${loc.mapSrc}" title="${loc.name} map" style="width:100%;height:100%;border:0;filter:grayscale(1) brightness(0.6);"></iframe>
      </div>
      <div>
        <div class="ek-ey">Location Details</div>
        <h2 class="ek-title" style="font-size:clamp(28px,3vw,44px);margin-bottom:24px;">${loc.name}<br><em>Location</em></h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:18px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Address</div>
            <div style="font-size:15px;">${loc.address}</div>
            ${loc.note?`<div style="font-size:12px;color:var(--muted);margin-top:4px;font-style:italic;">${loc.note}</div>`:''}
          </div>
          <div style="background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:18px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Hours</div>
            <div style="font-size:14px;color:var(--muted);line-height:2;">${loc.hours.replace(/·/g,'<br>')}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:18px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:8px;">Contact</div>
            <a href="tel:${loc.phone}" style="font-size:15px;font-weight:600;">${loc.phoneDisplay}</a>
          </div>
        </div>
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:44px;padding:0 22px;font-size:11px;">Order Now</a>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}" target="_blank" rel="noopener" class="ek-btn ek-btn-line" style="height:44px;padding:0 22px;font-size:11px;">Get Directions</a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PHOTOS -->
<div class="ek-photo-grid">${photoGrid}</div>

<!-- MENU PREVIEW -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div>
        <div class="ek-ey">What We Serve</div>
        <h2 class="ek-title">The <em>Menu</em></h2>
        <p class="ek-sub">Bold Latin-Asian fusion. Available at all 3 locations.</p>
      </div>
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-gold">Order Full Menu →</a>
    </div>
    <div class="ek-menu-grid">${EK.menu.slice(0,3).map(m=>`<div class="ek-menu-card">
      <img src="${m.photo}" alt="${m.name}" loading="lazy">
      <div class="ek-menu-overlay"></div>
      <div class="ek-menu-info"><div class="ek-menu-name">${m.name}</div><div class="ek-menu-desc">${m.desc}</div><div class="ek-menu-price">${m.price}</div></div>
    </div>`).join('')}</div>
    <div style="text-align:center;margin-top:32px;"><a href="/menu" class="ek-btn ek-btn-line">View Full Menu →</a></div>
  </div>
</section>

<!-- REVIEWS -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div><div class="ek-ey">What Guests Say</div><h2 class="ek-title">${loc.rating} Stars · <em>${loc.reviews}</em> Reviews</h2></div>
    </div>
    <div class="ek-rev-grid">${revHtml}</div>
  </div>
</section>

<!-- FAQ -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c ek-reveal">
    <div style="text-align:center;margin-bottom:40px;"><div class="ek-ey">FAQ</div><h2 class="ek-title">Questions About<br><em>${loc.name}?</em></h2></div>
    <div class="ek-faq-list">${faqHtml}</div>
  </div>
</section>

<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Order From <em>${loc.name}</em></h2>
    <p>Pickup or delivery available now. Fresh Latin-Asian fusion made to order.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Online →</a>
      <a href="/locations" class="ek-btn ek-btn-gold">All Locations</a>
      <a href="/catering" class="ek-btn ek-btn-line">Book Catering</a>
    </div>
  </div>
</div>
${ekFooter()}`;
  return ekWrap(
    `The Escobar Kitchen ${loc.name} | Latin Asian Fusion | Orlando FL`,
    `The Escobar Kitchen ${loc.name} — ${loc.address}. Orlando's boldest Latin-Asian fusion. Order online for pickup or delivery. ${loc.rating} stars.`,
    `escobar kitchen ${loc.name.toLowerCase().replace(/ /g,' ')},latin food ${loc.name.toLowerCase().replace(/ /g,' ')} orlando,escobar kitchen orlando,latin asian fusion near me`,
    schema, body
  );
}

function ekBuildHuntersCreek() {
  return ekBuildLocationPage(EK.locations[0], EK.photos.slice(0,8));
}
function ekBuildLakeNona() {
  return ekBuildLocationPage(EK.locations[1], EK.photos.slice(8,16));
}
function ekBuildDowntown() {
  return ekBuildLocationPage(EK.locations[2], EK.photos.slice(16,24));
}

function ekBuildMenu() {
  const allItems = [
    ...EK.menu,
    { name: 'Crispy Tuna Tacos', desc: 'Blackened tuna, mango salsa, pickled red onion, cilantro crema', price: '$19', photo: EK.photos[6] },
    { name: 'Korean BBQ Bowl', desc: 'Bulgogi beef, jasmine rice, kimchi, fried egg, sesame seeds', price: '$18', photo: EK.photos[7] },
    { name: 'Miso Glazed Salmon', desc: 'Soy-miso marinated salmon, steamed bok choy, white rice, ginger slaw', price: '$22', photo: EK.photos[10] },
    { name: 'Plantain Nachos', desc: 'Crispy plantains, black beans, queso blanco, pico, jalapeño, sour cream', price: '$14', photo: EK.photos[11] },
    { name: 'Bao Bun Sliders', desc: 'Steamed bao buns, slow-braised short rib, pickled cucumber, hoisin aioli', price: '$16', photo: EK.photos[12] },
    { name: 'Tres Leches Cake', desc: 'House-made tres leches soaked in vanilla cream, topped with fresh berries', price: '$9', photo: EK.photos[13] },
  ];
  const categories = [
    { name: 'Fan Favorites', items: allItems.slice(0,4) },
    { name: 'Mains', items: allItems.slice(4,8) },
    { name: 'Starters & Desserts', items: allItems.slice(8,12) },
  ];
  const body = `${ekNav('/menu')}
<section style="padding:100px 0 60px;background:var(--dark);">
  <div class="ek-c">
    <div class="ek-ey">Latin-Asian Fusion</div>
    <h1 class="ek-title" style="font-size:clamp(52px,8vw,110px);line-height:0.9;margin-bottom:20px;">The <em>Menu</em></h1>
    <p style="font-size:17px;color:var(--muted);max-width:520px;line-height:1.7;">Bold dishes where Latin soul meets Asian precision. Every item crafted with real ingredients, maximum flavor, zero shortcuts.</p>
    <div style="margin-top:28px;">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red" style="height:52px;padding:0 32px;">Order Online Now →</a>
    </div>
  </div>
</section>

<div class="ek-order-strip">
  <div class="ek-c ek-order-strip-in">
    <div><h2>Ready to Order?</h2><p>Pickup in 15 min or delivery to your door.</p></div>
    <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Full Menu →</a>
  </div>
</div>

${categories.map(cat=>`<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div><div class="ek-ey">${cat.name}</div><h2 class="ek-title"><em>${cat.name}</em></h2></div>
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-gold">Order →</a>
    </div>
    <div class="ek-menu-grid">${cat.items.map(m=>`<div class="ek-menu-card">
      <img src="${m.photo}" alt="${m.name} — Escobar Kitchen" loading="lazy">
      <div class="ek-menu-overlay"></div>
      <div class="ek-menu-info"><div class="ek-menu-name">${m.name}</div><div class="ek-menu-desc">${m.desc}</div><div class="ek-menu-price">${m.price}</div></div>
    </div>`).join('')}</div>
  </div>
</section>`).join('')}

<div class="ek-photo-grid">${EK.photos.slice(0,8).map(p=>`<div class="ek-photo-item"><img src="${p}" alt="Escobar Kitchen menu food" loading="lazy"></div>`).join('')}</div>

<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Order the Full <em>Menu Online</em></h2>
    <p>Pickup or delivery. Available at all 3 Orlando locations.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Now →</a>
      <a href="/locations" class="ek-btn ek-btn-gold">Find a Location</a>
    </div>
  </div>
</div>
${ekFooter()}`;
  const schema = {"@context":"https://schema.org","@type":"Menu","name":"The Escobar Kitchen Menu","url":"https://www.theescobarkitchen.com/menu","description":"Bold Latin-Asian fusion menu. Crispy rice tuna, Latin bowls, fusion tacos, empanadas, bao buns and more.","hasMenuSection":categories.map(c=>({ "@type":"MenuSection","name":c.name,"hasMenuItem":c.items.map(i=>({ "@type":"MenuItem","name":i.name,"description":i.desc,"offers":{"@type":"Offer","price":i.price.replace(/[^0-9.]/g,''),"priceCurrency":"USD"} })) }))};
  return ekWrap('Menu — The Escobar Kitchen | Latin Asian Fusion Orlando FL', "Explore The Escobar Kitchen menu. Bold Latin-Asian fusion dishes — crispy rice tuna, Latin bowls, fusion tacos, empanadas, bao buns. Order online for pickup or delivery.", 'escobar kitchen menu,latin asian fusion menu orlando,crispy rice tuna orlando,latin bowl orlando,fusion tacos orlando,order latin food online', schema, body);
}

function ekBuildCatering() {
  const body = `${ekNav('/catering')}
<section style="position:relative;padding:110px 0 80px;background:var(--dark);overflow:hidden;">
  <div style="position:absolute;inset:0;background:url(${EK.photos[5]}) center/cover;opacity:0.15;"></div>
  <div class="ek-c" style="position:relative;z-index:1;">
    <div class="ek-ey">Events &amp; Catering</div>
    <h1 class="ek-title" style="font-size:clamp(52px,8vw,110px);line-height:0.9;margin-bottom:24px;">Bold Food.<br><em>Your Event.</em></h1>
    <p style="font-size:18px;color:var(--muted);max-width:560px;line-height:1.7;margin-bottom:32px;">From corporate lunches to weddings, we bring Orlando's most unique Latin-Asian fusion flavors to your event. Serving 10 to 500+.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <a href="mailto:${EK.email}" class="ek-btn ek-btn-red" style="height:52px;padding:0 32px;">Request a Quote →</a>
      <a href="tel:${EK.phone}" class="ek-btn ek-btn-line" style="height:52px;padding:0 32px;">Call ${EK.phoneDisplay}</a>
    </div>
  </div>
</section>

<div class="ek-order-strip">
  <div class="ek-c ek-order-strip-in">
    <div><h2>Ready to Book?</h2><p>Catering inquiries: info@theescobarkitchen.com · (407) 743-8827</p></div>
    <a href="mailto:${EK.email}" class="ek-btn ek-btn-red">Get Catering Quote →</a>
  </div>
</div>

<!-- WHAT WE OFFER -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div><div class="ek-ey">What We Offer</div><h2 class="ek-title">Catering <em>Packages</em></h2></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;" class="ek-reveal">
      ${[
        { name:'Starter Pack', price:'From $180', serves:'Serves 10–20', items:['Choice of 2 mains','Sides & condiments','Serving utensils included','Delivery available'] },
        { name:'Full Spread', price:'From $380', serves:'Serves 25–50', items:['Choice of 4 mains','Full sides bar','Dessert option','Setup & breakdown available','Dedicated contact'] },
        { name:'Grand Event', price:'Custom Quote', serves:'50+ guests', items:['Full customizable menu','On-site chef available','Full setup & breakdown','Event coordinator','Staffing available'] },
      ].map(p=>`<div style="background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);padding:32px;position:relative;">
        <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:12px;">${p.serves}</div>
        <h3 style="font-family:var(--display);font-size:26px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${p.name}</h3>
        <div style="font-size:22px;font-weight:800;color:var(--red);margin-bottom:20px;">${p.price}</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
          ${p.items.map(i=>`<li style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px;"><span style="color:var(--gold);">✓</span>${i}</li>`).join('')}
        </ul>
        <a href="mailto:${EK.email}" class="ek-btn ek-btn-gold" style="width:100%;justify-content:center;">Get Quote →</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- EVENT TYPES -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div><div class="ek-ey">Perfect For</div><h2 class="ek-title">Every <em>Occasion</em></h2></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;" class="ek-reveal">
      ${['Corporate Lunches','Birthday Parties','Weddings','Office Events','Graduation Parties','Holiday Events','Private Dinners','Team Celebrations'].map(e=>`<div style="background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:20px 16px;text-align:center;font-size:13px;font-weight:600;letter-spacing:1px;">${e}</div>`).join('')}
    </div>
  </div>
</section>

<!-- PHOTO -->
<div class="ek-food-feature ek-reveal">
  <div class="ek-food-img"><img src="${EK.photos[3]}" alt="Escobar Kitchen catering Orlando" loading="lazy"></div>
  <div class="ek-food-copy">
    <div class="ek-ey">How It Works</div>
    <h2 class="ek-title" style="font-size:clamp(32px,4vw,52px);">Simple,<br><em>Seamless</em><br>Catering</h2>
    <div style="display:flex;flex-direction:column;gap:20px;margin-top:24px;">
      ${[
        { n:'01', t:'Contact Us', d:'Email or call to tell us about your event — date, headcount, and any special requests.' },
        { n:'02', t:'Pick Your Menu', d:'Choose from our full menu or let us build a custom spread based on your preferences.' },
        { n:'03', t:'We Deliver', d:'We bring the food fresh, on time, ready to serve. Setup and breakdown available.' },
      ].map(s=>`<div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="font-family:var(--display);font-size:28px;color:var(--gold);line-height:1;flex-shrink:0;">${s.n}</div>
        <div><div style="font-weight:700;margin-bottom:4px;">${s.t}</div><div style="font-size:13px;color:var(--muted);line-height:1.6;">${s.d}</div></div>
      </div>`).join('')}
    </div>
    <div style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap;">
      <a href="mailto:${EK.email}" class="ek-btn ek-btn-red">Request a Quote</a>
      <a href="tel:${EK.phone}" class="ek-btn ek-btn-line">${EK.phoneDisplay}</a>
    </div>
  </div>
</div>

<!-- REVIEWS -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c">
    <div class="ek-sec-head ek-reveal">
      <div><div class="ek-ey">What Clients Say</div><h2 class="ek-title">Catering <em>Reviews</em></h2></div>
    </div>
    <div class="ek-rev-grid">${EK.reviews.slice(2,5).map(r=>`<div class="ek-rev-card ek-reveal">
      <div class="ek-rev-stars">★★★★★</div>
      <p class="ek-rev-text">"${r.text}"</p>
      <div class="ek-rev-name">— ${r.name}</div>
    </div>`).join('')}</div>
  </div>
</section>

<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Let Us Cater<br>Your <em>Next Event</em></h2>
    <p>Bold Latin-Asian fusion for any occasion. Serving 10 to 500+. Orlando &amp; surrounding areas.</p>
    <div class="ek-cta-btns">
      <a href="mailto:${EK.email}" class="ek-btn ek-btn-red">Request Catering Quote →</a>
      <a href="tel:${EK.phone}" class="ek-btn ek-btn-gold">Call ${EK.phoneDisplay}</a>
    </div>
    <p style="font-size:13px;color:var(--muted);margin-top:20px;">${EK.email}</p>
  </div>
</div>
${ekFooter()}`;
  const schema = {"@context":"https://schema.org","@type":"FoodEstablishment","name":"The Escobar Kitchen Catering","description":"Latin-Asian fusion catering for events in Orlando and Central Florida. Corporate lunches, weddings, birthday parties, and more. Serving 10 to 500+.","telephone":EK.phone,"email":EK.email,"servesCuisine":["Latin","Asian Fusion"],"url":"https://www.theescobarkitchen.com/catering"};
  return ekWrap('Catering — The Escobar Kitchen | Latin Asian Fusion Orlando Events', "Book The Escobar Kitchen for your next event. Bold Latin-Asian fusion catering in Orlando — corporate events, weddings, birthdays. Serving 10–500+ guests.", 'escobar kitchen catering orlando,latin food catering orlando,latin asian fusion catering,catering orlando fl,corporate catering orlando,event catering orlando', schema, body);
}

function ekBuildContact() {
  const faqHtml = EK.faqs.slice(0,5).map((f,i)=>`<div class="ek-faq-item${i===0?' open':''}">
    <button class="ek-faq-btn" type="button"><span>${f.q}</span><span class="ek-faq-icon">${i===0?'−':'+'}</span></button>
    <div class="ek-faq-body"><p>${f.a}</p></div>
  </div>`).join('');
  const body = `${ekNav('/contact')}
<section style="padding:100px 0 60px;background:var(--dark);">
  <div class="ek-c">
    <div class="ek-ey">Get In Touch</div>
    <h1 class="ek-title" style="font-size:clamp(52px,8vw,100px);line-height:0.9;margin-bottom:20px;">Contact<br><em>Us</em></h1>
    <p style="font-size:17px;color:var(--muted);max-width:480px;line-height:1.7;">Questions, catering inquiries, or just want to say hi — we're here. Reach out and we'll get back to you fast.</p>
  </div>
</section>

<!-- CONTACT CARDS -->
<section class="ek-s" style="background:var(--black);">
  <div class="ek-c">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;" class="ek-reveal">
      ${EK.locations.map(l=>`<div style="background:var(--surface);border:1px solid var(--line2);border-radius:var(--r);padding:28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:14px;">${l.name}</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:8px;">${l.address}${l.note?`<br><small style="color:var(--muted);font-style:italic;font-size:12px;">${l.note}</small>`:''}</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:16px;">${l.hours}</div>
        <a href="tel:${l.phone}" style="display:block;font-size:16px;font-weight:700;color:var(--gold);margin-bottom:10px;">${l.phoneDisplay}</a>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="tel:${l.phone}" class="ek-btn ek-btn-red" style="height:38px;padding:0 16px;font-size:10px;">Call Now</a>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}" target="_blank" rel="noopener" class="ek-btn ek-btn-line" style="height:38px;padding:0 16px;font-size:10px;">Directions</a>
        </div>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- GENERAL CONTACT -->
<section class="ek-s" style="background:var(--dark);">
  <div class="ek-c">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start;" class="ek-reveal">
      <div>
        <div class="ek-ey">Send a Message</div>
        <h2 class="ek-title" style="font-size:clamp(32px,4vw,52px);margin-bottom:24px;">We'd Love to<br><em>Hear From You</em></h2>
        <p style="font-size:15px;color:var(--muted);line-height:1.7;margin-bottom:32px;">For catering quotes, event bookings, or general inquiries, email us directly or call any location. We respond within 24 hours.</p>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <a href="mailto:${EK.email}" style="display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:16px 20px;font-size:14px;font-weight:600;">
            <span style="color:var(--gold);font-size:18px;">✉</span>${EK.email}
          </a>
          <a href="${EK.ig}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:16px 20px;font-size:14px;font-weight:600;">
            <span style="color:var(--gold);font-size:18px;">📷</span>@theescobarkitchen
          </a>
        </div>
        <div style="margin-top:28px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:14px;">Rewards &amp; Gift Cards</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <a href="${EK.toast.rewardsSignup}" target="_blank" rel="noopener" style="font-size:13px;color:var(--muted);">→ Join Toast Rewards</a>
            <a href="${EK.toast.eGiftCards}" target="_blank" rel="noopener" style="font-size:13px;color:var(--muted);">→ Buy E-Gift Cards</a>
            <a href="${EK.toast.rewardsLookup}" target="_blank" rel="noopener" style="font-size:13px;color:var(--muted);">→ Check My Rewards</a>
            <a href="${EK.toast.findCard}" target="_blank" rel="noopener" style="font-size:13px;color:var(--muted);">→ Check Gift Card Balance</a>
          </div>
        </div>
      </div>
      <div>
        <div class="ek-ey">FAQ</div>
        <h2 class="ek-title" style="font-size:clamp(24px,3vw,40px);margin-bottom:32px;">Quick <em>Answers</em></h2>
        <div class="ek-faq-list">${faqHtml}</div>
      </div>
    </div>
  </div>
</section>

<div class="ek-cta-band">
  <div class="ek-c">
    <h2>Ready to <em>Order?</em></h2>
    <p>Online ordering available now. Pickup or delivery. 3 Orlando locations.</p>
    <div class="ek-cta-btns">
      <a href="${EK.orderUrl}" target="_blank" rel="noopener" class="ek-btn ek-btn-red">Order Online →</a>
      <a href="/catering" class="ek-btn ek-btn-gold">Book Catering</a>
    </div>
  </div>
</div>
${ekFooter()}`;
  const schema = {"@context":"https://schema.org","@type":"ContactPage","name":"Contact The Escobar Kitchen","description":"Contact The Escobar Kitchen — 3 Orlando locations. Catering inquiries, hours, directions. Hunters Creek, Lake Nona, Downtown Orlando.","url":"https://www.theescobarkitchen.com/contact"};
  return ekWrap('Contact — The Escobar Kitchen | Orlando FL | 3 Locations', "Contact The Escobar Kitchen. 3 Orlando locations — Hunters Creek, Lake Nona & Downtown. Book catering, get directions, or place an online order.", 'contact escobar kitchen,escobar kitchen phone,escobar kitchen address,escobar kitchen catering contact,escobar kitchen orlando', schema, body);
}

// GET /sofia/escobar-kitchen — download hub (async — pulls DataForSEO keywords for homepage)
app.get('/sofia/escobar-kitchen', async (req, res) => {
  try {
    // Pull real keyword data for "latin asian fusion" in Orlando before building homepage
    let kwData = [];
    try { kwData = await getKeywordData('latin asian fusion', 'orlando', 2840); } catch(e) { /* non-fatal */ }
    const topKws = kwData.slice(0,5).map(k=>`${k.keyword} (${(k.search_volume||k.volume||0).toLocaleString()}/mo)`).join(' · ') || 'DataForSEO unavailable';

    const cacheId = crypto.randomBytes(8).toString('hex');
    const pages = {
      home:               ekBuildHome(kwData),
      about:              ekBuildAbout(),
      locations:          ekBuildLocations(),
      'hunters-creek':    ekBuildHuntersCreek(),
      'lake-nona':        ekBuildLakeNona(),
      'downtown-orlando': ekBuildDowntown(),
      catering:           ekBuildCatering(),
      menu:               ekBuildMenu(),
      contact:            ekBuildContact(),
    };
    websitePackageCache.set(cacheId, { pages, clientName: 'The Escobar Kitchen', expires: Date.now() + 600000 });
    const pageList = [
      { key:'home',             label:'Home Page',             file:'index.html',            slug:'Homepage (root /)',          desc:'Photo slideshow hero · Order Direct & Save · Menu · Reviews · Locations' },
      { key:'about',            label:'About',                 file:'about.html',             slug:'/about',                     desc:'Story, values, stats, photo collage' },
      { key:'locations',        label:'Locations',             file:'locations.html',         slug:'/locations',                 desc:'All 3 locations — maps, hours, order buttons' },
      { key:'hunters-creek',    label:'Hunters Creek',         file:'hunters-creek.html',     slug:'/hunters-creek',             desc:'SEO location page — map, hours, menu preview, reviews' },
      { key:'lake-nona',        label:'Lake Nona',             file:'lake-nona.html',         slug:'/lake-nona',                 desc:'SEO location page — Inside The Bravo Market' },
      { key:'downtown-orlando', label:'Downtown Orlando',      file:'downtown-orlando.html',  slug:'/downtown-orlando',          desc:'SEO location page — Wine Bar, Craft Cocktails' },
      { key:'catering',         label:'Catering',              file:'catering.html',          slug:'/catering',                  desc:'3 packages, event types, how it works, quote CTA' },
      { key:'menu',             label:'Menu',                  file:'menu.html',              slug:'/menu',                      desc:'12 items across 3 categories — inline order buttons' },
      { key:'contact',          label:'Contact',               file:'contact.html',           slug:'/contact',                   desc:'3 location contacts, Toast rewards, gift cards, FAQ' },
    ];
    const hub = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Escobar Kitchen — Website Hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#080608;color:#fff;padding:40px 20px}
.wrap{max-width:720px;margin:0 auto;}
.logo{height:38px;margin-bottom:18px}
.badge{display:inline-block;background:#e00103;color:#fff;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 12px;border-radius:100px;margin-bottom:14px}
h1{font-size:26px;font-weight:800;margin-bottom:5px}
.sub{font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:8px}
.kws{background:rgba(224,1,3,0.08);border:1px solid rgba(224,1,3,0.25);border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:12px;color:rgba(255,255,255,0.65);line-height:1.9}
.section-label{font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#e00103;margin:22px 0 10px;}
.dl-btn{display:flex;align-items:center;justify-content:space-between;background:#14101a;border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:15px 20px;text-decoration:none;color:#fff;margin-bottom:7px;transition:all .15s;gap:12px;}
.dl-btn:hover{border-color:#e00103;background:rgba(224,1,3,0.06)}
.dl-left{flex:1;min-width:0;}
.dl-name{font-weight:700;font-size:14px;margin-bottom:2px;}
.dl-slug{font-size:11px;color:#e00103;font-weight:600;margin-bottom:2px;}
.dl-desc{font-size:11px;color:rgba(255,255,255,0.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dl-tag{background:#e00103;color:#fff;border-radius:6px;padding:5px 14px;font-size:11px;font-weight:700;flex-shrink:0;}
.how{background:rgba(255,255,255,0.04);border-radius:10px;padding:14px 18px;margin-top:22px;font-size:12px;color:rgba(255,255,255,0.45);line-height:1.8}
</style></head><body><div class="wrap">
<img src="${EK.logo}" class="logo" alt="Escobar Kitchen">
<div class="badge">v2 · 9 Pages · DataForSEO Keywords Applied</div>
<h1>The Escobar Kitchen</h1>
<p class="sub">Order Direct & Save · Photo Slideshow · #e00103 Red · Food-First · Full SEO</p>
<div class="kws"><strong style="color:#e00103;display:block;margin-bottom:6px;">DataForSEO — Top Keywords Wired Into Homepage</strong>${topKws}</div>
<div class="section-label">All 9 Pages</div>
${pageList.map(p=>`<a href="/sofia/website-download?id=${cacheId}&page=${p.key}&filename=${p.file}" class="dl-btn">
  <div class="dl-left">
    <div class="dl-name">${p.label}</div>
    <div class="dl-slug">GHL slug: ${p.slug}</div>
    <div class="dl-desc">${p.desc}</div>
  </div>
  <div class="dl-tag">↓ Download</div>
</a>`).join('')}
<div class="how"><strong style="color:#fff;">How to upload to GHL:</strong><br>
1. Download each page file<br>
2. GHL → Sites → Websites → The Escobar Kitchen → select page<br>
3. Open page → Custom Code tab → paste full HTML → Save &amp; Publish<br>
4. Set the page slug to match the GHL slug shown above<br><br>
<em style="color:rgba(255,255,255,0.25);font-size:11px;">Links expire in 10 minutes. Refresh to regenerate.</em>
</div>
</div></body></html>`;
    res.setHeader('Content-Type','text/html');
    res.send(hub);
  } catch(err) { res.status(500).send(`<pre>Error: ${err.message}\n${err.stack}</pre>`); }
});

// ────────────────────────────────────────────────────────────────────────────
// FLORIDA FOOT AND ANKLE INSTITUTE (FFAI) — 8 Service Landing Pages
// Branding: #007a7f teal · #e99121 orange · white bg · 24px radius
// Hub: GET /sofia/florida-foot-ankle
// ────────────────────────────────────────────────────────────────────────────

const FFAI = {
  name: 'The Florida Foot and Ankle Institute',
  address: '102 Park Place Blvd, Building A, Suite 3, Kissimmee, FL 34741',
  addressShort: '102 Park Place Blvd, Suite 3, Kissimmee, FL',
  phone: '',
  city: 'Kissimmee',
  state: 'FL',
  logo: 'https://static.wixstatic.com/media/e1b08d_44ac69541fad47a484758d5f27542c81~mv2.png',
  doctorImg: 'https://static.wixstatic.com/media/e1b08d_a70ae99bc98f4207b86ad54dd1475aca~mv2.jpeg',
  services: {
    'limb-salvage': {
      slug: '/limb-salvage', icon: 'LS', color: '#007a7f',
      title: 'Limb Salvage',
      h1: 'Advanced Limb Salvage Care in Kissimmee, FL',
      tagline: 'Preserving mobility and preventing amputation for high-risk patients',
      intro: 'Limb salvage is a specialized field of podiatric care focused on preserving the foot and lower limb when complex conditions — such as severe infections, poor circulation, or advanced tissue damage — put mobility at serious risk. At The Florida Foot and Ankle Institute, our goal is always to preserve function, protect your quality of life, and avoid amputation whenever medically possible.',
      photo: 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Severe diabetic foot infections','Peripheral artery disease (PAD)','Critical limb ischemia','Non-healing ulcers and wounds','Osteomyelitis (bone infection)','Gangrene and tissue necrosis','Charcot foot deformity','Complex soft tissue damage'],
      approach: ['Thorough vascular and wound assessment','Collaboration with vascular specialists when needed','Advanced wound debridement and infection control','Offloading and protective footwear strategies','Revascularization support and post-procedure care','Close monitoring and long-term management plans'],
      faqs: [
        {q:'Who is a candidate for limb salvage care?',a:'Patients with diabetic foot complications, vascular disease, severe infections, or non-healing wounds who are at risk for amputation are ideal candidates. Early intervention dramatically improves outcomes.'},
        {q:'Can limb salvage actually prevent amputation?',a:'Yes. In many cases, a coordinated limb salvage approach — combining wound care, infection management, and vascular support — can successfully preserve the limb and restore function.'},
        {q:'How long does limb salvage treatment take?',a:'Treatment duration depends on the severity of the condition. Some cases resolve over weeks; complex cases may require months of coordinated, ongoing care.'},
      ],
      metaTitle: 'Limb Salvage Specialist in Kissimmee, FL | Florida Foot & Ankle Institute',
      metaDesc: 'Advanced limb salvage care in Kissimmee, FL. Preventing amputation through expert wound care, infection management, and vascular support. Call today.',
      kwSeed: 'limb salvage podiatrist',
    },
    'heel-arch-pain': {
      slug: '/heel-arch-pain', icon: 'HP', color: '#e99121',
      title: 'Heel & Arch Pain',
      h1: 'Heel & Arch Pain Treatment in Kissimmee, FL',
      tagline: 'Lasting relief for plantar fasciitis, heel spurs, and arch strain',
      intro: 'Heel and arch pain are among the most common reasons patients seek podiatric care — and among the most disruptive to daily life. Whether you wake up with sharp pain in your first steps, feel chronic aching through a long workday, or notice discomfort during activity, The Florida Foot and Ankle Institute provides accurate diagnosis and individualized treatment to get you back on your feet comfortably.',
      photo: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Plantar fasciitis','Heel spurs (calcaneal spurs)','Achilles tendinitis','Fat pad atrophy','Tarsal tunnel syndrome','Flat feet and overpronation','Arch strain from overuse','Stress fractures of the heel'],
      approach: ['Biomechanical gait and foot structure analysis','Custom orthotics and supportive footwear recommendations','Targeted stretching and physical therapy protocols','Corticosteroid or PRP injection therapy when appropriate','Extracorporeal shock wave therapy (ESWT)','Surgical correction for cases unresponsive to conservative care'],
      faqs: [
        {q:'What causes plantar fasciitis?',a:'Plantar fasciitis is caused by inflammation of the thick band of tissue running along the bottom of your foot. Overuse, poor footwear, flat feet, or sudden increases in activity are common triggers.'},
        {q:'How long does heel pain take to resolve?',a:'With consistent treatment, most patients see significant improvement within 6–12 weeks. Chronic or severe cases may take longer and could benefit from advanced therapies.'},
        {q:'Do I need surgery for heel pain?',a:'The majority of heel pain cases resolve with conservative treatment. Surgery is only considered after non-surgical options have been thoroughly tried and have not provided adequate relief.'},
      ],
      metaTitle: 'Heel & Arch Pain Treatment Kissimmee FL | Plantar Fasciitis Specialist',
      metaDesc: 'Heel pain and plantar fasciitis treatment in Kissimmee, FL. Custom orthotics, injection therapy, and expert podiatric care. The Florida Foot & Ankle Institute.',
      kwSeed: 'heel pain treatment',
    },
    'diabetic-foot-care': {
      slug: '/diabetic-foot-care', icon: 'DF', color: '#007a7f',
      title: 'Diabetic Foot Care',
      h1: 'Diabetic Foot Care in Kissimmee, FL',
      tagline: 'Preventing complications and protecting your feet for the long term',
      intro: 'Diabetes significantly increases the risk of foot-related complications — from nerve damage and circulation problems to infections and slow-healing wounds. Proactive, ongoing diabetic foot care is one of the most important steps you can take to protect your mobility and prevent serious outcomes. At The Florida Foot and Ankle Institute, we provide comprehensive diabetic foot management with a focus on prevention, early intervention, and patient education.',
      photo: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Diabetic peripheral neuropathy','Poor circulation and ischemia','Diabetic foot ulcers','Hammertoes and structural deformities','Calluses over pressure points','Charcot foot','Recurring infections','Dry and cracking skin from autonomic neuropathy'],
      approach: ['Comprehensive diabetic foot exams and risk stratification','Circulation and sensation assessments','Nail and skin care to prevent infection entry points','Custom orthotics and protective footwear prescriptions','Wound care and ulcer management protocols','Patient education on daily self-inspection and foot hygiene'],
      faqs: [
        {q:'How often should diabetic patients see a podiatrist?',a:'Most diabetic patients benefit from at least annual foot exams. Patients with neuropathy, vascular disease, or a history of ulcers should be seen more frequently — every 3 to 6 months.'},
        {q:'What are the early signs of diabetic foot problems?',a:'Watch for numbness or tingling, changes in skin color or temperature, slow-healing cuts or sores, swelling, or changes in foot shape. Report any of these to your podiatrist promptly.'},
        {q:'Can diabetic foot ulcers be prevented?',a:'Yes. Consistent podiatric care, appropriate footwear, daily self-exams, and good blood sugar control dramatically reduce the risk of ulcer development and serious complications.'},
      ],
      metaTitle: 'Diabetic Foot Care Kissimmee FL | Foot Ulcer & Neuropathy Specialist',
      metaDesc: 'Expert diabetic foot care in Kissimmee, FL. Neuropathy screening, ulcer prevention, wound management, and protective orthotics. Florida Foot & Ankle Institute.',
      kwSeed: 'diabetic foot care',
    },
    'sports-medicine': {
      slug: '/sports-medicine', icon: 'SM', color: '#e99121',
      title: 'Sports Medicine & Injury',
      h1: 'Sports Foot & Ankle Care in Kissimmee, FL',
      tagline: 'Getting athletes and active patients back to peak performance',
      intro: 'Foot and ankle injuries are among the most common setbacks for athletes at every level — from weekend warriors to competitive professionals. At The Florida Foot and Ankle Institute, we combine sports medicine expertise with podiatric precision to diagnose accurately, treat effectively, and help you return to activity as safely and quickly as possible.',
      photo: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Ankle sprains and ligament tears','Achilles tendon ruptures and tendinopathy','Stress fractures of the foot','Turf toe and toe injuries','Plantar plate tears','Sesamoiditis','Posterior tibial tendon dysfunction','Morton\'s neuroma in athletes'],
      approach: ['Sport-specific biomechanical analysis','Advanced imaging interpretation (X-ray, MRI, ultrasound)','Conservative rehab protocols with activity modification','Bracing, taping, and protective footwear strategies','Regenerative therapies: PRP and ultrasound-guided injections','Surgical repair for ligamentous or structural failures'],
      faqs: [
        {q:'When should an athlete see a podiatrist vs. an orthopedist?',a:'Podiatrists specialize specifically in foot and ankle conditions and are often the best first point of care for foot-related sports injuries. Complex cases may involve collaboration with orthopedic specialists.'},
        {q:'How long does it take to recover from an ankle sprain?',a:'Mild sprains may heal in 1–3 weeks. Moderate to severe sprains can take 6–12 weeks. Proper diagnosis and treatment prevent chronic instability down the road.'},
        {q:'Can I continue training with a stress fracture?',a:'No. Stress fractures require rest and appropriate offloading to heal properly. Continuing to train risks a complete fracture and significantly longer recovery time.'},
      ],
      metaTitle: 'Sports Medicine Podiatrist Kissimmee FL | Foot & Ankle Injury Specialist',
      metaDesc: 'Sports foot and ankle injury treatment in Kissimmee, FL. Sprains, stress fractures, tendon injuries, and return-to-sport care. Florida Foot & Ankle Institute.',
      kwSeed: 'sports medicine podiatrist',
    },
    'foot-ankle-surgery': {
      slug: '/foot-ankle-surgery', icon: 'FS', color: '#007a7f',
      title: 'Foot & Ankle Surgery',
      h1: 'Foot & Ankle Surgery in Kissimmee, FL',
      tagline: 'Expert surgical care when conservative treatment is not enough',
      intro: 'Not every foot or ankle condition resolves with conservative care. When surgery becomes necessary, you want a podiatric surgeon who combines technical expertise with clear communication and thorough pre-operative and post-operative support. At The Florida Foot and Ankle Institute, we approach surgical care with precision, patient education, and a focus on the best possible long-term outcome.',
      photo: 'https://images.unsplash.com/photo-1551601651-2a8555f1a136?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Bunions (hallux valgus)','Hammertoes and lesser digit deformities','Flat foot reconstruction','Ankle instability and ligament repair','Achilles tendon repair','Metatarsal fracture fixation','Heel spur excision','Neuroma excision'],
      approach: ['Thorough pre-surgical evaluation and imaging review','Conservative treatment exhaustion before surgical recommendation','Clear surgical planning with patient involvement','Minimally invasive techniques where appropriate','Detailed post-operative protocols and wound care','Physical therapy coordination for full recovery'],
      faqs: [
        {q:'How do I know if I need foot or ankle surgery?',a:'Surgery is typically recommended when pain significantly affects your quality of life, conservative treatments have been tried without adequate relief, or a structural problem requires correction to prevent further damage.'},
        {q:'How long is the recovery after foot surgery?',a:'Recovery varies by procedure. Minor surgeries may require 2–4 weeks of restricted activity, while more complex procedures such as flat foot reconstruction can require 3–6 months of rehabilitation.'},
        {q:'Will I need physical therapy after surgery?',a:'Many surgical procedures benefit from physical therapy as part of the recovery plan. We coordinate therapy referrals and provide clear guidance on your rehabilitation protocol.'},
      ],
      metaTitle: 'Foot & Ankle Surgeon Kissimmee FL | Bunion, Hammertoe & Ankle Surgery',
      metaDesc: 'Expert foot and ankle surgery in Kissimmee, FL. Bunions, hammertoes, ankle repair, Achilles tendon surgery. The Florida Foot & Ankle Institute.',
      kwSeed: 'foot ankle surgeon',
    },
    'pediatric-foot-care': {
      slug: '/pediatric-foot-care', icon: 'PF', color: '#e99121',
      title: 'Pediatric Foot Care',
      h1: 'Pediatric Foot Care in Kissimmee, FL',
      tagline: 'Supporting healthy foot development from childhood through adolescence',
      intro: 'Children\'s feet are still developing, and structural concerns or gait abnormalities caught early are far easier to address than problems that go untreated for years. At The Florida Foot and Ankle Institute, we provide gentle, thorough pediatric foot evaluations and treatment plans designed to support healthy development, correct issues before they worsen, and give parents the clarity they need.',
      photo: 'https://images.unsplash.com/photo-1603717011504-e4bd8ab29fc8?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Flat feet (pediatric flexible flatfoot)','In-toeing and out-toeing gait','Sever\'s disease (heel pain in children)','Growing pains in the feet and ankles','Toe walking','Clubfoot management','Juvenile bunions','Ingrown toenails in children'],
      approach: ['Age-appropriate physical examination and gait analysis','Digital X-rays when clinically indicated','Orthotic devices designed for growing feet','Stretching and strengthening programs','Monitoring plans for developmental milestones','Surgical referral for structural issues that require correction'],
      faqs: [
        {q:'At what age should I bring my child to a podiatrist?',a:'If you notice your child walking on their toes, complaining of foot or leg pain, tripping frequently, or if their feet look noticeably different from their peers, a podiatric evaluation is appropriate at any age.'},
        {q:'Is flat feet in children something to worry about?',a:'Flexible flatfoot is very common in young children and often resolves as the arch develops. However, if it causes pain, affects gait, or persists into older childhood, evaluation and possible treatment are recommended.'},
        {q:'Do children\'s orthotics need to be replaced often?',a:'Yes — as children grow, their feet change quickly. Orthotics should be evaluated at every visit and typically replaced every 1–2 years depending on growth rate.'},
      ],
      metaTitle: 'Pediatric Podiatrist Kissimmee FL | Children\'s Foot & Ankle Care',
      metaDesc: 'Expert pediatric foot care in Kissimmee, FL. Flat feet, gait analysis, Sever\'s disease, in-toeing, and orthotics for children. Florida Foot & Ankle Institute.',
      kwSeed: 'pediatric podiatrist',
    },
    'orthotics': {
      slug: '/orthotics', icon: 'OC', color: '#007a7f',
      title: 'Orthotics & Custom Insoles',
      h1: 'Custom Orthotics in Kissimmee, FL',
      tagline: 'Precision-designed insoles that improve alignment, reduce pain, and support daily movement',
      intro: 'Off-the-shelf insoles provide generic cushioning. Custom orthotics are different — they are precision-crafted devices based on a thorough evaluation of your foot structure, gait pattern, and specific symptoms. At The Florida Foot and Ankle Institute, we design orthotics that address the root cause of your discomfort and support better movement for work, sport, and everyday life.',
      photo: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Plantar fasciitis and heel pain','Flat feet and overpronation','High arches and supination','Diabetic foot pressure management','Metatarsalgia and ball-of-foot pain','Knee and hip pain from foot imbalances','Post-surgical support','Sports performance optimization'],
      approach: ['Full biomechanical and gait evaluation','Digital pressure mapping and foot casting','Custom device fabrication to exact specifications','Functional orthotics for active use','Accommodative orthotics for sensitive or diabetic feet','Fitting, adjustment, and follow-up care'],
      faqs: [
        {q:'What is the difference between custom orthotics and store-bought insoles?',a:'Store-bought insoles provide generic support and cushioning. Custom orthotics are individually designed based on your specific foot shape, mechanics, and diagnosis — they address the underlying cause of your symptoms.'},
        {q:'How long do custom orthotics last?',a:'With proper care, functional orthotics typically last 2–5 years. Accommodative orthotics may need replacement sooner. Annual check-ups help ensure they still fit properly and are performing as designed.'},
        {q:'Will my insurance cover custom orthotics?',a:'Many insurance plans provide partial coverage for custom orthotics when medically prescribed. We can assist with documentation to support your claim.'},
      ],
      metaTitle: 'Custom Orthotics Kissimmee FL | Foot Insole Specialist Near Me',
      metaDesc: 'Custom orthotic insoles in Kissimmee, FL. Gait analysis, pressure mapping, and precision-fit orthotics for heel pain, flat feet, diabetes, and sports. Call today.',
      kwSeed: 'custom orthotics podiatrist',
    },
    'wound-care': {
      slug: '/wound-care', icon: 'WC', color: '#e99121',
      title: 'Ingrown Toenails & Wound Care',
      h1: 'Ingrown Toenail & Wound Care in Kissimmee, FL',
      tagline: 'Expert treatment for painful toenails, ulcers, and wounds that won\'t heal',
      intro: 'Ingrown toenails and foot wounds may seem minor, but without proper care they can lead to serious infections — especially for patients with diabetes or compromised circulation. At The Florida Foot and Ankle Institute, we provide prompt, professional treatment to relieve pain, clear infection, and give wounds and nails the environment they need to heal properly.',
      photo: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=1400&q=80',
      conditions: ['Ingrown toenails (acute and chronic)','Post-surgical ingrown nail recurrence','Diabetic foot ulcers','Venous and arterial leg ulcers','Pressure ulcers on the foot','Wound dehiscence and post-op wound complications','Infected wounds requiring debridement','Blisters and abrasions that won\'t close'],
      approach: ['Same-day or urgent care for acute ingrown nail pain','Nail avulsion and matrixectomy for permanent correction','Sterile wound debridement and irrigation','Advanced wound dressings and offloading protocols','Infection assessment and antibiotic management','Coordination with wound care centers for complex cases'],
      faqs: [
        {q:'Can an ingrown toenail be permanently fixed?',a:'Yes. A matrixectomy — a minor in-office procedure that permanently removes a portion of the nail matrix — prevents the problematic nail edge from regrowing. Success rates are very high.'},
        {q:'When is a foot wound an emergency?',a:'Seek care immediately if you notice red streaking, fever, severe swelling, green or foul-smelling discharge, or if the wound is rapidly worsening — especially if you are diabetic.'},
        {q:'How long does wound care treatment take?',a:'Simple wounds may heal in 1–3 weeks with proper care. Chronic ulcers, particularly in diabetic patients, may require months of ongoing treatment and close monitoring.'},
      ],
      metaTitle: 'Ingrown Toenail & Wound Care Kissimmee FL | Podiatrist Near Me',
      metaDesc: 'Ingrown toenail removal and foot wound care in Kissimmee, FL. Same-day treatment, diabetic ulcer management, and chronic wound care. Florida Foot & Ankle Institute.',
      kwSeed: 'ingrown toenail podiatrist',
    },
  },
};

const GHL_FULL_BLEED = `<style>
html, body,
.page-section, .page-section--content,
.funnelish-section, .funnelish-section--content,
.section-wrap, .section-wrap--content,
.hl_page-section, .hl_page-section--content,
.container, .container-fluid,
.row, .col, [class*="col-"],
[class*="section"], [class*="container"],
[class*="wrapper"], [class*="inner"],
[class*="page-section"], [class*="hl_"] {
  max-width:100%!important;width:100%!important;
  padding-left:0!important;padding-right:0!important;
  margin-left:0!important;margin-right:0!important;
  box-sizing:border-box!important;
}
body{overflow-x:hidden!important;}
</style>`;

function ffaiCSS() {
  return `
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --brand:#007a7f;--brand2:#0c8f95;--accent:#e99121;
  --text:#0d1b1e;--muted:#5d6b70;--bg:#fff;--soft:#f6fbfb;
  --line:rgba(0,122,127,0.12);--shadow:0 20px 60px rgba(0,0,0,0.08);
  --r:24px;--max:1240px;--font:"Helvetica Neue",Arial,sans-serif;
}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:var(--font);overflow-x:hidden;-webkit-font-smoothing:antialiased;}
a{text-decoration:none;color:inherit;}
img{max-width:100%;height:auto;display:block;}

/* Layout */
.ffai-wrap{position:relative;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;}
.ffai-c{width:min(calc(100% - 32px),var(--max));margin:0 auto;padding-left:16px;padding-right:16px;box-sizing:border-box;}

/* Topbar */
.ffai-topbar{background:linear-gradient(90deg,var(--brand),var(--brand2));color:#fff;font-size:13px;padding:9px 0;}
.ffai-topbar-in{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;}

/* Nav */
.ffai-nav-wrap{position:sticky;top:0;z-index:200;backdrop-filter:blur(18px);background:rgba(255,255,255,0.9);border-bottom:1px solid var(--line);}
.ffai-nav{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;flex-wrap:wrap;}
.ffai-nav-logo img{width:170px;max-width:100%;height:auto;}
.ffai-nav-links{display:flex;gap:24px;font-size:14px;color:var(--muted);}
.ffai-nav-links a:hover{color:var(--brand);}
.ffai-nav-btns{display:flex;gap:10px;flex-wrap:wrap;}
.ffai-btn{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:13px 22px;font-weight:700;font-size:14px;transition:transform .2s,box-shadow .2s;border:1px solid transparent;cursor:pointer;}
.ffai-btn:hover{transform:translateY(-2px);box-shadow:var(--shadow);}
.ffai-btn-primary{background:var(--accent);color:#fff;}
.ffai-btn-secondary{background:#fff;color:var(--brand);border-color:rgba(0,122,127,0.2);}
@media(max-width:800px){.ffai-nav-links{display:none;}}

/* Hero */
.ffai-hero{position:relative;min-height:520px;display:flex;align-items:center;overflow:hidden;}
.ffai-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center;}
.ffai-hero-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,28,32,0.88) 0%,rgba(10,28,32,0.55) 60%,rgba(10,28,32,0.2) 100%);}
.ffai-hero-content{position:relative;z-index:2;padding:80px 0;max-width:680px;}
.ffai-eyebrow{display:inline-flex;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:18px;border:1px solid rgba(255,255,255,0.2);}
.ffai-hero-content h1{font-size:clamp(32px,5vw,62px);line-height:1.05;letter-spacing:-0.03em;color:#fff;margin-bottom:18px;}
.ffai-hero-content p{font-size:18px;color:rgba(255,255,255,0.84);line-height:1.75;margin-bottom:32px;max-width:580px;}
.ffai-hero-btns{display:flex;gap:12px;flex-wrap:wrap;}

/* Breadcrumb */
.ffai-breadcrumb{background:var(--soft);border-bottom:1px solid var(--line);padding:12px 0;font-size:13px;color:var(--muted);}
.ffai-breadcrumb a{color:var(--brand);}
.ffai-breadcrumb a:hover{text-decoration:underline;}

/* Sections */
.ffai-sec{padding:80px 0;}
.ffai-sec--alt{background:var(--soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line);}
.ffai-sec--dark{background:linear-gradient(135deg,var(--brand),#09585c);color:#fff;}
.ffai-tag{display:inline-flex;padding:7px 14px;border-radius:999px;background:rgba(0,122,127,0.1);color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px;}
.ffai-tag--light{background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.2);}
.ffai-sec-h{font-size:clamp(26px,3.5vw,46px);letter-spacing:-0.03em;line-height:1.06;margin-bottom:14px;}
.ffai-sec-sub{font-size:17px;color:var(--muted);line-height:1.8;max-width:680px;}

/* Highlights bar */
.ffai-highlights{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:52px;}
.ffai-hl-card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:24px 22px;box-shadow:0 8px 28px rgba(0,0,0,0.04);}
.ffai-hl-card-icon{width:48px;height:48px;border-radius:14px;background:rgba(0,122,127,0.08);color:var(--brand);display:grid;place-items:center;font-size:20px;font-weight:900;margin-bottom:12px;}
.ffai-hl-card h4{font-size:16px;margin-bottom:6px;letter-spacing:-0.01em;}
.ffai-hl-card p{font-size:13px;color:var(--muted);line-height:1.7;}
@media(max-width:700px){.ffai-highlights{grid-template-columns:1fr;}}

/* Conditions grid */
.ffai-conditions{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:36px;}
.ffai-cond{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:16px;font-size:14px;color:var(--muted);line-height:1.5;}
.ffai-cond-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:4px;}

/* Approach steps */
.ffai-steps{display:flex;flex-direction:column;gap:1px;background:var(--line);border-radius:var(--r);overflow:hidden;margin-top:36px;}
.ffai-step{display:flex;gap:20px;align-items:flex-start;padding:24px 28px;background:#fff;}
.ffai-step-n{font-size:11px;font-weight:800;letter-spacing:.12em;color:var(--brand);background:rgba(0,122,127,0.08);border-radius:999px;padding:4px 10px;flex-shrink:0;margin-top:2px;}
.ffai-step-body h4{font-size:16px;font-weight:800;margin-bottom:6px;}
.ffai-step-body p{font-size:14px;color:var(--muted);line-height:1.7;}

/* FAQ */
.ffai-faqs{display:flex;flex-direction:column;gap:2px;margin-top:36px;}
.ffai-faq{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px 26px;}
.ffai-faq q{display:block;font-size:17px;font-weight:800;margin-bottom:10px;font-style:normal;letter-spacing:-0.01em;}
.ffai-faq p{font-size:15px;color:var(--muted);line-height:1.8;margin:0;}

/* Doctor section */
.ffai-doctor-grid{display:grid;grid-template-columns:0.45fr 0.55fr;gap:0;align-items:stretch;border-radius:var(--r);overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);}
.ffai-doctor-img{height:100%;min-height:400px;object-fit:cover;width:100%;}
.ffai-doctor-body{padding:44px 40px;background:#fff;display:flex;flex-direction:column;justify-content:center;}
.ffai-check-list{list-style:none;display:flex;flex-direction:column;gap:13px;margin-top:24px;}
.ffai-check-list li{display:flex;gap:10px;font-size:15px;color:var(--muted);line-height:1.6;}
.ffai-check-list li::before{content:'✓';color:var(--brand);font-weight:900;flex-shrink:0;}
@media(max-width:720px){.ffai-doctor-grid{grid-template-columns:1fr;}.ffai-doctor-img{min-height:280px;}}

/* CTA band */
.ffai-cta-band{background:var(--accent);color:#fff;padding:64px 0;text-align:center;}
.ffai-cta-band h2{font-size:clamp(26px,4vw,46px);letter-spacing:-0.03em;margin-bottom:14px;}
.ffai-cta-band p{font-size:17px;opacity:.9;max-width:540px;margin:0 auto 32px;line-height:1.75;}
.ffai-cta-btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;}
.ffai-btn-white{background:#fff;color:var(--accent);border-radius:999px;padding:16px 32px;font-weight:700;font-size:15px;transition:transform .2s,box-shadow .2s;display:inline-block;}
.ffai-btn-white:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(0,0,0,0.15);}
.ffai-btn-outline-white{background:transparent;color:#fff;border:2px solid rgba(255,255,255,0.6);border-radius:999px;padding:14px 30px;font-weight:700;font-size:15px;display:inline-block;transition:background .2s;}
.ffai-btn-outline-white:hover{background:rgba(255,255,255,0.1);}

/* Services index grid */
.ffai-svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;margin-top:40px;}
.ffai-svc-card{background:#fff;border:1px solid var(--line);border-radius:28px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,0.04);transition:transform .25s,box-shadow .25s;overflow:hidden;position:relative;}
.ffai-svc-card::before{content:'';position:absolute;inset:auto -40px -40px auto;width:120px;height:120px;background:radial-gradient(circle,rgba(0,122,127,0.12),transparent 70%);}
.ffai-svc-card:hover{transform:translateY(-5px);box-shadow:0 20px 50px rgba(0,0,0,0.08);}
.ffai-svc-icon{width:54px;height:54px;border-radius:16px;background:rgba(0,122,127,0.08);color:var(--brand);display:grid;place-items:center;font-size:16px;font-weight:900;margin-bottom:18px;}
.ffai-svc-card h3{font-size:20px;letter-spacing:-0.02em;margin-bottom:10px;}
.ffai-svc-card p{font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:16px;}
.ffai-svc-link{font-size:13px;font-weight:800;color:var(--brand);letter-spacing:.04em;}

/* Footer */
.ffai-footer{background:#081417;color:rgba(255,255,255,0.8);padding:32px 0;}
.ffai-footer-in{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;}
.ffai-footer a{color:#fff;}

/* Keywords section */
.ffai-kw-cloud{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;}
.ffai-kw{border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);padding:9px 14px;border-radius:999px;font-size:13px;color:rgba(255,255,255,0.9);}

/* Responsive grid classes — all 2-col layouts */
.ffai-hero-grid{display:grid;grid-template-columns:1.1fr 0.9fr;gap:40px;align-items:center;}
.ffai-hero-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.ffai-about-grid{display:grid;grid-template-columns:0.95fr 1.05fr;gap:28px;align-items:stretch;}
.ffai-check-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px;}
.ffai-2col{display:grid;grid-template-columns:1fr 1fr;gap:28px;}
.ffai-2col--contact{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
.ffai-approach-grid{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start;}
.ffai-svc-detail-grid{display:grid;grid-template-columns:280px 1fr;gap:80px;align-items:start;}

/* Reveal */
.ffai-reveal{opacity:0;transform:translateY(22px);transition:opacity .75s ease,transform .75s ease;}
.ffai-reveal.visible{opacity:1;transform:translateY(0);}

/* ── RESPONSIVE ── */
@media(max-width:900px){
  .ffai-hero-grid{grid-template-columns:1fr;}
  .ffai-hero-visual-col{display:none;}
  .ffai-about-grid{grid-template-columns:1fr;}
  .ffai-check-cols{grid-template-columns:1fr;}
  .ffai-2col,.ffai-2col--contact{grid-template-columns:1fr;}
  .ffai-approach-grid{grid-template-columns:1fr;gap:32px;}
  .ffai-svc-detail-grid{grid-template-columns:1fr;gap:40px;}
}
@media(max-width:780px){
  .ffai-sec{padding:60px 0;}
  .ffai-sec--sm{padding:48px 0;}
  .ffai-hero-content{padding:72px 0 60px;}
  .ffai-hero-stats{grid-template-columns:1fr;}
  .ffai-svc-grid{grid-template-columns:1fr;}
  .ffai-highlights{grid-template-columns:1fr;}
  .ffai-conditions{grid-template-columns:1fr;}
  .ffai-doctor-grid{grid-template-columns:1fr;}
  .ffai-doctor-img{min-height:260px;order:0;}
  .ffai-hero h1{font-size:clamp(30px,8vw,48px);}
  .ffai-c{padding-left:16px;padding-right:16px;}
  .ffai-topbar-in{flex-direction:column;gap:4px;font-size:12px;}
  .ffai-nav-btns .ffai-btn:first-child{display:none;}
  .ffai-cta-btns{flex-direction:column;align-items:center;}
  .ffai-about-animated{display:none;}
}
@media(max-width:560px){
  .ffai-hero-grid,.ffai-about-grid,.ffai-2col,.ffai-2col--contact,.ffai-approach-grid{gap:20px;}
  .ffai-hero-btns{flex-direction:column;}
  .ffai-hero-btns .ffai-btn{width:100%;justify-content:center;}
  .ffai-nav-logo img{width:140px;}
  .ffai-price-box{padding:28px 20px;}
  .ffai-faq{padding:20px 18px;}
  .ffai-step{padding:18px 20px;}
}`;
}

function ffaiNav(activePage) {
  return `<div class="ffai-topbar"><div class="ffai-c"><div class="ffai-topbar-in">
    <span>Advanced Foot &amp; Ankle Care in Kissimmee, Florida</span>
    <span>${FFAI.addressShort}</span>
  </div></div></div>
  <div class="ffai-nav-wrap"><div class="ffai-c"><div class="ffai-nav">
    <a href="/" class="ffai-nav-logo"><img src="${FFAI.logo}" alt="${FFAI.name} logo"></a>
    <nav class="ffai-nav-links">
      <a href="/services"${activePage==='services'?' style="color:var(--brand)"':''}>Services</a>
      <a href="/about"${activePage==='about'?' style="color:var(--brand)"':''}>Why Choose Us</a>
      <a href="/contact"${activePage==='contact'?' style="color:var(--brand)"':''}>Contact</a>
    </nav>
    <div class="ffai-nav-btns">
      <a class="ffai-btn ffai-btn-secondary" href="/contact">Call Now</a>
      <a class="ffai-btn ffai-btn-primary" href="/contact">Book Appointment</a>
    </div>
  </div></div></div>`;
}

function ffaiFooter() {
  return `<footer class="ffai-footer"><div class="ffai-c"><div class="ffai-footer-in">
    <div><strong>${FFAI.name}</strong><br>${FFAI.address}</div>
    <div style="font-size:13px;">
      <a href="/services">Services</a> · <a href="/about">Why Choose Us</a> · <a href="/contact">Contact</a>
    </div>
  </div></div></footer>
<script>
const obs = new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible');}),{threshold:0.12});
document.querySelectorAll('.ffai-reveal').forEach((el,i)=>{el.style.transitionDelay=Math.min(i*70,400)+'ms';obs.observe(el);});
</script></div></body></html>`;
}

function ffaiHead(title, meta, canonicalPath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${meta}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${meta}">
<meta property="og:type" content="website">
<link rel="canonical" href="https://www.thefloridafootankleinstitute.com${canonicalPath}">
${GHL_FULL_BLEED}
<style>${ffaiCSS()}</style>
</head>
<body>
<div class="ffai-wrap">`;
}

// Builds a single service landing page
function ffaiBuildServicePage(svcKey, kwData = []) {
  const svc = FFAI.services[svcKey];
  if (!svc) return '<h1>Service not found</h1>';

  const topKws = kwData.slice(0, 8).map(k => k.keyword);
  const kwCloud = topKws.length
    ? topKws.map(k => `<span class="ffai-kw">${k}</span>`).join('')
    : Object.values(FFAI.services).map(s => `<span class="ffai-kw">${s.title.toLowerCase()} kissimmee</span>`).join('').slice(0,500);

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: FFAI.name,
    description: svc.metaDesc,
    url: `https://www.thefloridafootankleinstitute.com${svc.slug}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '102 Park Place Blvd, Building A, Suite 3',
      addressLocality: 'Kissimmee',
      addressRegion: 'FL',
      postalCode: '34741',
      addressCountry: 'US',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 28.3036, longitude: -81.4075 },
    medicalSpecialty: 'Podiatric Medicine',
    availableService: {
      '@type': 'MedicalProcedure',
      name: svc.title,
      description: svc.intro,
    },
  });

  const approachSteps = svc.approach.map((step, i) => `
    <div class="ffai-step ffai-reveal">
      <span class="ffai-step-n">0${i + 1}</span>
      <div class="ffai-step-body"><p>${step}</p></div>
    </div>`).join('');

  const conditionsHtml = svc.conditions.map(c => `
    <div class="ffai-cond ffai-reveal"><span class="ffai-cond-dot"></span><span>${c}</span></div>`).join('');

  const faqsHtml = svc.faqs.map(f => `
    <div class="ffai-faq ffai-reveal">
      <q>${f.q}</q>
      <p>${f.a}</p>
    </div>`).join('');

  const faqSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: svc.faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  });

  return ffaiHead(svc.metaTitle, svc.metaDesc, svc.slug) +
  `<script type="application/ld+json">${schema}</script>
<script type="application/ld+json">${faqSchema}</script>
` + ffaiNav('services') + `

<!-- BREADCRUMB -->
<div class="ffai-breadcrumb">
  <div class="ffai-c">
    <a href="/">Home</a> &rsaquo; <a href="/services">Services</a> &rsaquo; ${svc.title}
  </div>
</div>

<!-- HERO -->
<section class="ffai-hero">
  <div class="ffai-hero-bg" style="background-image:url('${svc.photo}');"></div>
  <div class="ffai-c">
    <div class="ffai-hero-content">
      <div class="ffai-eyebrow">Podiatry · Kissimmee, FL</div>
      <h1>${svc.h1}</h1>
      <p>${svc.tagline}. Expert care at ${FFAI.addressShort}.</p>
      <div class="ffai-hero-btns">
        <a href="/contact" class="ffai-btn ffai-btn-primary">Book Appointment</a>
        <a href="/services" class="ffai-btn" style="background:rgba(255,255,255,0.12);color:#fff;border:1px solid rgba(255,255,255,0.3);">All Services</a>
      </div>
    </div>
  </div>
</section>

<!-- HIGHLIGHTS -->
<section class="ffai-sec">
  <div class="ffai-c">
    <div class="ffai-tag">Why Patients Choose Us</div>
    <h2 class="ffai-sec-h">${svc.title} at The Florida Foot &amp; Ankle Institute</h2>
    <p class="ffai-sec-sub">${svc.intro}</p>
    <div class="ffai-highlights">
      <div class="ffai-hl-card ffai-reveal">
        <div class="ffai-hl-card-icon">${svc.icon}</div>
        <h4>Specialized Expertise</h4>
        <p>Advanced podiatric care focused specifically on ${svc.title.toLowerCase()} for patients in Kissimmee and the surrounding Orlando area.</p>
      </div>
      <div class="ffai-hl-card ffai-reveal">
        <div class="ffai-hl-card-icon" style="background:rgba(233,145,33,0.1);color:var(--accent);">✓</div>
        <h4>Patient-Centered Approach</h4>
        <p>Personalized treatment plans built around your symptoms, lifestyle, and long-term health goals — not a one-size-fits-all protocol.</p>
      </div>
      <div class="ffai-hl-card ffai-reveal">
        <div class="ffai-hl-card-icon">📍</div>
        <h4>Conveniently Located</h4>
        <p>Serving Kissimmee, St. Cloud, and surrounding Orlando communities from our clinic at 102 Park Place Blvd, Suite 3.</p>
      </div>
    </div>
  </div>
</section>

<!-- CONDITIONS TREATED -->
<section class="ffai-sec ffai-sec--alt">
  <div class="ffai-c">
    <div class="ffai-tag">Conditions We Treat</div>
    <h2 class="ffai-sec-h">What We Address</h2>
    <p class="ffai-sec-sub">Our ${svc.title.toLowerCase()} services cover a broad range of conditions. Whether you are dealing with a recent problem or a long-standing concern, we have the expertise to help.</p>
    <div class="ffai-conditions">${conditionsHtml}</div>
  </div>
</section>

<!-- OUR APPROACH -->
<section class="ffai-sec">
  <div class="ffai-c">
    <div class="ffai-approach-grid">
      <div>
        <div class="ffai-tag">Our Approach</div>
        <h2 class="ffai-sec-h">How We Treat ${svc.title}</h2>
        <p class="ffai-sec-sub" style="margin-bottom:0;">We take a structured, evidence-based approach to ${svc.title.toLowerCase()} — from initial evaluation through recovery. Every step is personalized to your specific condition and goals.</p>
      </div>
      <div>
        <div class="ffai-steps">${approachSteps}</div>
      </div>
    </div>
  </div>
</section>

<!-- DOCTOR / TRUST -->
<section class="ffai-sec ffai-sec--alt">
  <div class="ffai-c">
    <div class="ffai-doctor-grid ffai-reveal">
      <img src="${FFAI.doctorImg}" alt="${FFAI.name} — ${svc.title} specialist in Kissimmee FL" class="ffai-doctor-img" loading="lazy">
      <div class="ffai-doctor-body">
        <div class="ffai-tag">Trusted Care in Kissimmee</div>
        <h2 class="ffai-sec-h" style="font-size:clamp(22px,3vw,38px);">Care built on experience, trust, and a commitment to better outcomes.</h2>
        <p style="font-size:16px;color:var(--muted);line-height:1.8;margin:14px 0 0;">At The Florida Foot and Ankle Institute, we are committed to delivering ${svc.title.toLowerCase()} that is both clinically advanced and genuinely personal. Our patients receive individualized attention, clear answers, and treatment plans that make sense for their lives.</p>
        <ul class="ffai-check-list">
          <li>Comprehensive evaluation before any treatment recommendation</li>
          <li>Modern diagnostic and therapeutic techniques</li>
          <li>Clear communication throughout every stage of care</li>
          <li>Convenient Kissimmee location with patient-first scheduling</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- KEYWORD / LOCAL SEO SECTION -->
<section class="ffai-sec ffai-sec--dark">
  <div class="ffai-c">
    <div class="ffai-2col">
      <div class="ffai-reveal">
        <div class="ffai-tag ffai-tag--light">${svc.title} · Kissimmee, FL</div>
        <h2 class="ffai-sec-h" style="color:#fff;">Local ${svc.title} care patients can count on.</h2>
        <p style="color:rgba(255,255,255,0.82);line-height:1.8;font-size:16px;">The Florida Foot and Ankle Institute proudly serves patients in Kissimmee, St. Cloud, and surrounding Orlando communities. If you are looking for a trusted ${svc.title.toLowerCase()} specialist nearby, we are ready to help.</p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/contact" class="ffai-btn-white">Book Appointment →</a>
          <a href="/services" class="ffai-btn-outline-white">All Services</a>
        </div>
      </div>
      <div class="ffai-reveal">
        <h3 style="color:#fff;font-size:16px;margin-bottom:14px;font-weight:700;">${svc.title} — Top Search Terms</h3>
        <div class="ffai-kw-cloud">${kwCloud}</div>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:14px;">Keywords sourced from DataForSEO — Kissimmee, FL market</p>
      </div>
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="ffai-sec">
  <div class="ffai-c">
    <div class="ffai-tag">Common Questions</div>
    <h2 class="ffai-sec-h">Frequently Asked Questions</h2>
    <p class="ffai-sec-sub">Quick answers to what patients most often ask about ${svc.title.toLowerCase()} at our Kissimmee practice.</p>
    <div class="ffai-faqs">${faqsHtml}</div>
  </div>
</section>

<!-- CTA BAND -->
<div class="ffai-cta-band">
  <div class="ffai-c">
    <h2>Ready to get relief? We are here to help.</h2>
    <p>Schedule your ${svc.title.toLowerCase()} appointment at The Florida Foot and Ankle Institute in Kissimmee. Call or book online today.</p>
    <div class="ffai-cta-btns">
      <a href="/contact" class="ffai-btn-white">Book Appointment</a>
      <a href="/services" class="ffai-btn-outline-white">Explore All Services</a>
    </div>
    <p style="margin-top:20px;font-size:14px;opacity:.75;">${FFAI.address}</p>
  </div>
</div>
` + ffaiFooter();
}

// Services index page
function ffaiBuildServicesIndex(allKwData = {}) {
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: FFAI.name,
    url: 'https://www.thefloridafootankleinstitute.com/services',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '102 Park Place Blvd, Building A, Suite 3',
      addressLocality: 'Kissimmee',
      addressRegion: 'FL',
      postalCode: '34741',
      addressCountry: 'US',
    },
    medicalSpecialty: 'Podiatric Medicine',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Podiatry Services',
      itemListElement: Object.values(FFAI.services).map((s, i) => ({
        '@type': 'Offer',
        position: i + 1,
        name: s.title,
        url: `https://www.thefloridafootankleinstitute.com${s.slug}`,
      })),
    },
  });

  const cardsHtml = Object.entries(FFAI.services).map(([key, svc]) => `
    <a href="${svc.slug}" class="ffai-svc-card ffai-reveal" style="text-decoration:none;display:block;">
      <div class="ffai-svc-icon" style="background:rgba(0,122,127,0.08);color:var(--brand);">${svc.icon}</div>
      <h3>${svc.title}</h3>
      <p>${svc.intro.slice(0, 120)}…</p>
      <span class="ffai-svc-link">Learn more →</span>
    </a>`).join('');

  return ffaiHead(
    'Podiatry Services in Kissimmee, FL | Florida Foot & Ankle Institute',
    'Complete podiatry services in Kissimmee, FL — heel pain, diabetic foot care, limb salvage, sports injuries, surgery, orthotics, pediatric care, and wound treatment.',
    '/services'
  ) +
  `<script type="application/ld+json">${schema}</script>
` + ffaiNav('services') + `

<!-- BREADCRUMB -->
<div class="ffai-breadcrumb">
  <div class="ffai-c"><a href="/">Home</a> &rsaquo; Services</div>
</div>

<!-- HERO -->
<section class="ffai-hero">
  <div class="ffai-hero-bg" style="background-image:url('https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1400&q=80');"></div>
  <div class="ffai-c">
    <div class="ffai-hero-content">
      <div class="ffai-eyebrow">Complete Podiatry Care · Kissimmee, FL</div>
      <h1>Expert Foot &amp; Ankle Services for Every Patient</h1>
      <p>From heel pain and diabetic foot care to limb salvage and surgery — we treat a full range of foot and ankle conditions with precision, compassion, and long-term results.</p>
      <div class="ffai-hero-btns">
        <a href="/contact" class="ffai-btn ffai-btn-primary">Book Appointment</a>
        <a href="#services-list" class="ffai-btn" style="background:rgba(255,255,255,0.12);color:#fff;border:1px solid rgba(255,255,255,0.3);">Browse Services</a>
      </div>
    </div>
  </div>
</section>

<!-- INTRO -->
<section class="ffai-sec">
  <div class="ffai-c">
    <div class="ffai-reveal" style="max-width:720px;">
      <div class="ffai-tag">Our Specialties</div>
      <h2 class="ffai-sec-h">Comprehensive podiatric care in one convenient Kissimmee location.</h2>
      <p class="ffai-sec-sub">The Florida Foot and Ankle Institute provides advanced treatment for a wide spectrum of foot and ankle conditions. Whether you need routine podiatric care, specialized treatment for a chronic condition, or surgical correction, our team is equipped to help.</p>
    </div>
  </div>
</section>

<!-- SERVICES GRID -->
<section class="ffai-sec ffai-sec--alt" id="services-list">
  <div class="ffai-c">
    <div class="ffai-tag">All Services</div>
    <h2 class="ffai-sec-h">What We Treat</h2>
    <div class="ffai-svc-grid">${cardsHtml}</div>
  </div>
</section>

<!-- LOCAL SEO -->
<section class="ffai-sec ffai-sec--dark">
  <div class="ffai-c ffai-reveal" style="text-align:center;max-width:760px;margin:0 auto;">
    <div class="ffai-tag ffai-tag--light" style="margin:0 auto 16px;">Kissimmee, FL</div>
    <h2 class="ffai-sec-h" style="color:#fff;">Serving Kissimmee, St. Cloud, and Orlando communities.</h2>
    <p style="color:rgba(255,255,255,0.82);font-size:17px;line-height:1.8;margin-bottom:32px;">Patients throughout Osceola County trust The Florida Foot and Ankle Institute for attentive, expert podiatric care close to home. We accept most major insurance plans and offer flexible scheduling.</p>
    <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;">
      <a href="/contact" class="ffai-btn-white">Schedule an Appointment</a>
      <a href="/" class="ffai-btn-outline-white">Learn About Our Practice</a>
    </div>
  </div>
</section>

<!-- CTA BAND -->
<div class="ffai-cta-band">
  <div class="ffai-c">
    <h2>Ready to get the care you need?</h2>
    <p>Contact The Florida Foot and Ankle Institute today to schedule your appointment and take the first step toward relief.</p>
    <div class="ffai-cta-btns">
      <a href="/contact" class="ffai-btn-white">Book Appointment</a>
    </div>
    <p style="margin-top:20px;font-size:14px;opacity:.75;">${FFAI.address}</p>
  </div>
</div>
` + ffaiFooter();
}

// Homepage
function ffaiBuildHomePage(kwData = []) {
  const primaryKw = kwData[0]?.keyword || 'podiatrist kissimmee fl';
  const topKws = kwData.slice(0, 8).map(k => k.keyword);

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: FFAI.name,
    url: 'https://www.thefloridafootankleinstitute.com',
    logo: FFAI.logo,
    image: FFAI.doctorImg,
    description: `Advanced foot and ankle podiatric care in Kissimmee, FL. Services include limb salvage, heel pain, diabetic foot care, sports injuries, surgery, orthotics, pediatric care, and wound treatment.`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '102 Park Place Blvd, Building A, Suite 3',
      addressLocality: 'Kissimmee', addressRegion: 'FL',
      postalCode: '34741', addressCountry: 'US',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 28.3036, longitude: -81.4075 },
    medicalSpecialty: 'Podiatric Medicine',
    areaServed: ['Kissimmee', 'St. Cloud', 'Orlando', 'Osceola County'],
  });

  const svcCards = Object.entries(FFAI.services).map(([key, svc]) => `
    <a href="${svc.slug}" class="ffai-svc-card ffai-reveal" style="text-decoration:none;display:block;">
      <div class="ffai-svc-icon">${svc.icon}</div>
      <h3>${svc.title}</h3>
      <p>${svc.intro.slice(0, 110)}…</p>
      <span class="ffai-svc-link">Learn more →</span>
    </a>`).join('');

  const kwCloud = topKws.length
    ? topKws.map(k => `<span class="ffai-kw">${k}</span>`).join('')
    : ['podiatrist kissimmee','heel pain treatment','diabetic foot care','foot doctor near me','foot and ankle specialist','plantar fasciitis','custom orthotics','foot surgeon kissimmee'].map(k=>`<span class="ffai-kw">${k}</span>`).join('');

  return ffaiHead(
    `The Florida Foot and Ankle Institute | Podiatrist in Kissimmee, FL`,
    `The Florida Foot and Ankle Institute provides advanced podiatry care in Kissimmee, FL — heel pain, diabetic foot care, limb salvage, sports injuries, surgery, orthotics, pediatric care, and wound treatment.`,
    '/'
  ) +
  `<script type="application/ld+json">${schema}</script>
` + ffaiNav('home') + `

<!-- HERO -->
<section style="position:relative;padding:88px 0 72px;overflow:clip;">
  <!-- Ambient glows -->
  <div style="position:absolute;top:-6rem;right:-6rem;width:36rem;height:36rem;border-radius:50%;background:var(--brand);filter:blur(80px);opacity:.09;pointer-events:none;"></div>
  <div style="position:absolute;bottom:-8rem;left:-8rem;width:32rem;height:32rem;border-radius:50%;background:var(--accent);filter:blur(80px);opacity:.08;pointer-events:none;"></div>
  <div class="ffai-c">
    <div class="ffai-hero-grid">
      <!-- Left copy -->
      <div class="ffai-reveal">
        <div class="ffai-tag" style="margin-bottom:18px;">Kissimmee Podiatry &amp; Foot Care</div>
        <h1 style="font-size:clamp(38px,5.5vw,72px);line-height:1.0;letter-spacing:-0.04em;margin-bottom:18px;">Expert foot &amp; ankle care for every stage of life.</h1>
        <p style="font-size:clamp(16px,2vw,19px);color:var(--muted);line-height:1.8;margin-bottom:28px;max-width:640px;">At The Florida Foot and Ankle Institute, we provide advanced podiatric care with a patient-first approach — combining precision, comfort, and long-term results for patients in Kissimmee and the surrounding Orlando area.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:40px;">
          <a class="ffai-btn ffai-btn-primary" href="/contact">Schedule Your Appointment</a>
          <a class="ffai-btn ffai-btn-secondary" href="/services">Explore Services</a>
        </div>
        <!-- Stats -->
        <div class="ffai-hero-stats">
          <div style="background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.04);">
            <strong style="display:block;font-size:22px;color:var(--brand);margin-bottom:4px;">8+</strong>
            <span style="font-size:13px;color:var(--muted);line-height:1.5;">Specialized podiatry services</span>
          </div>
          <div style="background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.04);">
            <strong style="display:block;font-size:22px;color:var(--brand);margin-bottom:4px;">Advanced</strong>
            <span style="font-size:13px;color:var(--muted);line-height:1.5;">Diagnostics &amp; treatment</span>
          </div>
          <div style="background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.04);">
            <strong style="display:block;font-size:22px;color:var(--brand);margin-bottom:4px;">Trusted</strong>
            <span style="font-size:13px;color:var(--muted);line-height:1.5;">Kissimmee community care</span>
          </div>
        </div>
      </div>
      <!-- Right: doctor card + floating panels -->
      <div style="position:relative;min-height:620px;" class="ffai-reveal ffai-hero-visual-col">
        <!-- Doctor image card -->
        <div style="position:absolute;inset:40px 24px 110px 36px;border-radius:28px;overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line);">
          <img src="${FFAI.doctorImg}" alt="Podiatrist at The Florida Foot and Ankle Institute in Kissimmee FL" style="width:100%;height:100%;object-fit:cover;display:block;" fetchpriority="high" loading="eager">
          <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(10,28,32,0.82));padding:28px 22px 22px;">
            <strong style="display:block;color:#fff;font-size:17px;margin-bottom:6px;">Trusted podiatry care in Kissimmee</strong>
            <span style="color:rgba(255,255,255,0.8);font-size:13px;line-height:1.6;">Personalized treatment plans, advanced diagnostics, and compassionate care designed for your comfort, mobility, and long-term health.</span>
          </div>
        </div>
        <!-- Floating service card -->
        <div style="position:absolute;top:0;right:0;width:230px;background:#fff;border:1px solid var(--line);border-radius:22px;padding:18px 20px;box-shadow:var(--shadow);animation:ffaiBob 5s ease-in-out infinite;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--brand);text-transform:uppercase;margin-bottom:10px;">Featured Services</div>
          <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;">
            <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 0 5px rgba(233,145,33,.12);"></span>Limb Salvage</li>
            <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 0 5px rgba(233,145,33,.12);"></span>Heel &amp; Arch Pain</li>
            <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 0 5px rgba(233,145,33,.12);"></span>Diabetic Foot Care</li>
            <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 0 5px rgba(233,145,33,.12);"></span>Sports Injuries</li>
          </ul>
        </div>
        <!-- Floating trust card -->
        <div style="position:absolute;right:20px;bottom:20px;width:250px;background:#fff;border:1px solid var(--line);border-radius:22px;padding:18px 20px;box-shadow:var(--shadow);animation:ffaiBob 5s ease-in-out infinite;animation-delay:-2.5s;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--brand);text-transform:uppercase;margin-bottom:8px;">Why Patients Choose Us</div>
          <span style="font-size:13px;color:var(--muted);line-height:1.7;">Experienced care, clear communication, and treatment plans built around real recovery, comfort, and long-term results.</span>
        </div>
      </div>
    </div>
  </div>
</section>
<style>
@keyframes ffaiBob{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
</style>

<!-- SERVICES BAND -->
<section class="ffai-sec ffai-sec--alt" id="services">
  <div class="ffai-c">
    <div class="ffai-reveal" style="max-width:700px;margin-bottom:40px;">
      <div class="ffai-tag">Complete Podiatry Services</div>
      <h2 class="ffai-sec-h">Comprehensive foot &amp; ankle care for pain relief, healing, and mobility.</h2>
      <p class="ffai-sec-sub">We treat a wide range of foot and ankle conditions with a focus on accurate diagnosis, modern treatment, and care plans tailored to each patient. From routine concerns to complex cases — we help you move better.</p>
    </div>
    <div class="ffai-svc-grid">${svcCards}</div>
    <div style="text-align:center;margin-top:36px;">
      <a href="/services" class="ffai-btn ffai-btn-primary">View All Services</a>
    </div>
  </div>
</section>

<!-- WHY CHOOSE US -->
<section class="ffai-sec" id="about">
  <div class="ffai-c">
    <div class="ffai-about-grid">
      <!-- Left: glass panel -->
      <div style="background:linear-gradient(180deg,rgba(255,255,255,0.97),rgba(246,251,251,0.97));border:1px solid var(--line);border-radius:28px;padding:36px;box-shadow:var(--shadow);" class="ffai-reveal">
        <div style="display:inline-flex;padding:7px 14px;background:rgba(233,145,33,0.1);color:var(--accent);border-radius:999px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin-bottom:16px;">Why Choose Us</div>
        <h2 style="font-size:clamp(26px,3.5vw,44px);letter-spacing:-0.03em;line-height:1.06;margin-bottom:16px;">Care built on experience, trust, and a commitment to better outcomes.</h2>
        <p style="color:var(--muted);line-height:1.85;font-size:17px;margin-bottom:24px;">The Florida Foot and Ankle Institute is built around one clear goal: delivering foot and ankle care that is both clinically advanced and genuinely personal. We take time to understand your symptoms, your lifestyle, and your long-term goals so we can recommend treatment that makes sense for you.</p>
        <div class="ffai-check-cols">
          ${[
            'Comprehensive treatment for routine and complex conditions',
            'Personalized plans based on your symptoms and goals',
            'Modern diagnostic thinking and evidence-based care',
            'Focused support for diabetic and high-risk patients',
            'Clear communication from consultation through recovery',
            'Convenient care for Kissimmee and surrounding communities',
          ].map(item=>`<div style="display:flex;gap:10px;color:var(--muted);line-height:1.65;font-size:15px;"><span style="color:var(--brand);font-weight:900;flex-shrink:0;">+</span><span>${item}</span></div>`).join('')}
        </div>
        <div style="margin-top:28px;">
          <a href="/contact" class="ffai-btn ffai-btn-primary">Book an Appointment</a>
        </div>
      </div>
      <!-- Right: animated visual -->
      <div style="background:linear-gradient(180deg,rgba(255,255,255,0.97),rgba(246,251,251,0.97));border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow);overflow:hidden;position:relative;min-height:400px;" class="ffai-reveal ffai-about-animated" aria-hidden="true">
        <div style="position:absolute;inset:0;background-image:linear-gradient(90deg,rgba(0,122,127,0.1) 1px,transparent 1px),linear-gradient(rgba(0,122,127,0.1) 1px,transparent 1px);background-size:54px 54px;mask-image:radial-gradient(circle at center,black 40%,transparent 75%);"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(circle at center,rgba(233,145,33,0.18),transparent 38%);animation:ffaiPulse 4s ease-in-out infinite;"></div>
        <div style="position:absolute;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.95),rgba(0,122,127,0.22));box-shadow:inset 0 0 16px rgba(255,255,255,0.8),0 22px 48px rgba(0,122,127,0.14);top:16%;left:10%;animation:ffaiDrift 9s ease-in-out infinite;"></div>
        <div style="position:absolute;width:88px;height:88px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.95),rgba(0,122,127,0.22));box-shadow:inset 0 0 16px rgba(255,255,255,0.8),0 22px 48px rgba(0,122,127,0.14);top:56%;right:12%;animation:ffaiDrift 9s ease-in-out infinite;animation-delay:-3s;"></div>
        <div style="position:absolute;width:116px;height:116px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.95),rgba(0,122,127,0.22));box-shadow:inset 0 0 16px rgba(255,255,255,0.8),0 22px 48px rgba(0,122,127,0.14);bottom:12%;left:44%;animation:ffaiDrift 9s ease-in-out infinite;animation-delay:-6s;"></div>
        <!-- Center card -->
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
          <div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:22px;padding:28px 28px;box-shadow:0 20px 50px rgba(0,0,0,0.08);max-width:280px;text-align:center;">
            <div style="font-size:40px;font-weight:900;color:var(--brand);line-height:1;">102</div>
            <div style="font-size:15px;font-weight:700;margin:6px 0 4px;">Park Place Blvd</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.6;">Building A, Suite 3<br>Kissimmee, FL 34741</div>
            <div style="margin-top:14px;"><a href="/contact" class="ffai-btn ffai-btn-primary" style="font-size:13px;padding:11px 18px;">Get Directions</a></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
<style>
@keyframes ffaiPulse{0%,100%{transform:scale(0.95);opacity:.7;}50%{transform:scale(1.04);opacity:1;}}
@keyframes ffaiDrift{0%,100%{transform:translate(0,0);}30%{transform:translate(10px,-14px);}60%{transform:translate(-10px,12px);}}
</style>

<!-- LOCAL SEO BAND -->
<section class="ffai-sec ffai-sec--dark" id="seo">
  <div class="ffai-c">
    <div class="ffai-2col">
      <div class="ffai-reveal">
        <div class="ffai-tag ffai-tag--light">Kissimmee Foot &amp; Ankle Care</div>
        <h2 class="ffai-sec-h" style="color:#fff;">Local podiatry care patients can trust close to home.</h2>
        <p style="color:rgba(255,255,255,0.82);line-height:1.85;font-size:17px;margin-bottom:24px;">We proudly serve patients in Kissimmee, St. Cloud, and nearby Orlando communities with high-quality podiatric care — from pain relief and diabetic protection to injury recovery and surgical treatment.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/contact" class="ffai-btn-white">Book Appointment →</a>
          <a href="/services" class="ffai-btn-outline-white">All Services</a>
        </div>
      </div>
      <div class="ffai-reveal">
        <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);border-radius:22px;padding:28px;">
          <h3 style="color:#fff;font-size:16px;margin-bottom:14px;">Top Search Terms — Kissimmee, FL</h3>
          <div class="ffai-kw-cloud">${kwCloud}</div>
          <p style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:12px;">Keywords sourced from DataForSEO · Kissimmee, FL market · ${new Date().getFullYear()}</p>
        </div>
        <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);border-radius:22px;padding:24px;margin-top:16px;">
          <h3 style="color:#fff;font-size:15px;margin-bottom:10px;">Conditions &amp; Services</h3>
          <p style="color:rgba(255,255,255,0.75);font-size:14px;line-height:1.85;">Heel pain · Plantar fasciitis · Diabetic foot care · Sports injuries · Foot surgery · Pediatric podiatry · Custom orthotics · Wound care · Limb salvage · Ingrown toenails</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- CONTACT / CTA -->
<section class="ffai-sec" id="contact">
  <div class="ffai-c">
    <div class="ffai-2col--contact">
      <!-- Schedule CTA card -->
      <div style="background:#fff;border:1px solid var(--line);border-radius:28px;padding:36px;box-shadow:var(--shadow);" class="ffai-reveal">
        <div style="display:inline-flex;padding:7px 14px;background:rgba(233,145,33,0.1);color:var(--accent);border-radius:999px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin-bottom:16px;">Schedule Today</div>
        <h3 style="font-size:clamp(24px,3vw,38px);letter-spacing:-0.03em;margin-bottom:14px;line-height:1.1;">Take the next step toward relief, healing, and better movement.</h3>
        <p style="color:var(--muted);line-height:1.85;font-size:17px;margin-bottom:24px;">If you are experiencing foot pain, ankle discomfort, diabetic concerns, sports injuries, or any condition affecting your daily life — our team is ready to help.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <a class="ffai-btn ffai-btn-primary" href="/contact">Book Appointment</a>
          <a class="ffai-btn ffai-btn-secondary" href="/services">Our Services</a>
        </div>
      </div>
      <!-- Contact info card -->
      <div style="background:#fff;border:1px solid var(--line);border-radius:28px;padding:36px;box-shadow:var(--shadow);" class="ffai-reveal">
        <div style="display:inline-flex;padding:7px 14px;background:rgba(0,122,127,0.08);color:var(--brand);border-radius:999px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin-bottom:16px;">Contact Us</div>
        <h3 style="font-size:clamp(22px,2.5vw,32px);letter-spacing:-0.03em;margin-bottom:16px;line-height:1.1;">The Florida Foot and Ankle Institute</h3>
        <address style="font-style:normal;color:var(--muted);line-height:2;font-size:16px;">
          102 Park Place Blvd<br>
          Building A, Suite 3<br>
          Kissimmee, FL 34741<br><br>
          Serving Kissimmee, St. Cloud &amp; Orlando
        </address>
        <ul style="list-style:none;margin-top:18px;padding:0;display:flex;flex-direction:column;gap:10px;">
          <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></span>Advanced podiatry care for all ages</li>
          <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></span>Personalized treatment and recovery planning</li>
          <li style="display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></span>Convenient local care with a patient-first approach</li>
        </ul>
      </div>
    </div>
  </div>
</section>
` + ffaiFooter();
}

// GET /sofia/florida-foot-ankle — download hub (async — parallel DataForSEO per service)
app.get('/sofia/florida-foot-ankle', async (req, res) => {
  try {
    // Parallel DataForSEO calls — homepage + all 8 services in one batch
    const svcKeys = Object.keys(FFAI.services);
    const [homeKwData, ...svcKwResults] = await Promise.all([
      getKeywordData('podiatrist kissimmee', 'kissimmee', 2840).catch(() => []),
      ...svcKeys.map(key =>
        getKeywordData(FFAI.services[key].kwSeed, 'kissimmee', 2840).catch(() => [])
      ),
    ]);
    const kwMap = {};
    svcKeys.forEach((key, i) => { kwMap[key] = svcKwResults[i]; });

    const cacheId = crypto.randomBytes(8).toString('hex');
    const pages = {
      'home': ffaiBuildHomePage(homeKwData),
      'services-index': ffaiBuildServicesIndex(kwMap),
    };
    svcKeys.forEach(key => { pages[key] = ffaiBuildServicePage(key, kwMap[key]); });

    websitePackageCache.set(cacheId, { pages, clientName: 'Florida Foot & Ankle Institute', expires: Date.now() + 600000 });

    const pageList = [
      { key: 'home', label: 'Home Page', file: 'index.html', slug: '/ (root homepage)', desc: `${homeKwData[0]?.keyword || 'podiatrist kissimmee'} · Hero · 8 services · Why us · SEO · Contact` },
      { key: 'services-index', label: 'Services Index', file: 'services.html', slug: '/services', desc: 'All 8 services grid · SEO intro · Local keywords · CTA' },
      ...svcKeys.map(key => {
        const s = FFAI.services[key];
        const topKw = (kwMap[key][0]?.keyword) || s.title;
        return { key, label: s.title, file: `${key}.html`, slug: s.slug, desc: `${topKw} · ${kwMap[key].length} keywords · FAQ · Doctor section` };
      }),
    ];

    const hub = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Florida Foot &amp; Ankle — Website Hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a1c20;color:#fff;padding:40px 20px}
.wrap{max-width:760px;margin:0 auto}
.logo-row{margin-bottom:22px}
.logo-row img{height:44px;filter:brightness(10)}
.badge{display:inline-block;background:#007a7f;color:#fff;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:5px 14px;border-radius:100px;margin-bottom:14px}
h1{font-size:22px;font-weight:900;margin-bottom:4px}
.sub{font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:24px}
.section-label{font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:22px 0 10px}
.dl-btn{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:14px 18px;text-decoration:none;color:#fff;margin-bottom:6px;transition:all .15s;gap:12px}
.dl-btn:hover{border-color:#007a7f;background:rgba(0,122,127,0.1)}
.dl-left{flex:1;min-width:0}
.dl-name{font-weight:700;font-size:14px;margin-bottom:2px}
.dl-slug{font-size:11px;color:#007a7f;font-weight:600;margin-bottom:2px}
.dl-desc{font-size:11px;color:rgba(255,255,255,0.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-tag{background:#007a7f;color:#fff;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;flex-shrink:0}
.how{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 18px;margin-top:22px;font-size:12px;color:rgba(255,255,255,0.4);line-height:1.9}
</style></head><body><div class="wrap">
<div class="logo-row"><img src="${FFAI.logo}" alt="${FFAI.name}"></div>
<div class="badge">10 Pages · DataForSEO Keywords Applied</div>
<h1>Florida Foot &amp; Ankle Institute</h1>
<p class="sub">Homepage + Services Index + 8 Service Landing Pages · Kissimmee SEO · Teal/Orange Branding</p>
<div class="section-label">All 9 Pages</div>
${pageList.map(p=>`<a href="/sofia/website-download?id=${cacheId}&page=${p.key}&filename=${p.file}" class="dl-btn">
  <div class="dl-left">
    <div class="dl-name">${p.label}</div>
    <div class="dl-slug">GHL slug: ${p.slug}</div>
    <div class="dl-desc">${p.desc}</div>
  </div>
  <div class="dl-tag">↓ Download</div>
</a>`).join('')}
<div class="how">
<strong style="color:#fff;">How to upload to GHL:</strong><br>
1. Download each page file<br>
2. GHL → Sites → Websites → Florida Foot &amp; Ankle Institute → select page<br>
3. Open page → Custom Code tab → paste full HTML → Save &amp; Publish<br>
4. Set page slug to match the GHL slug shown above<br><br>
<em style="color:rgba(255,255,255,0.2);font-size:11px;">Links expire in 10 minutes. Refresh to regenerate.</em>
</div>
</div></body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(hub);
  } catch(err) { res.status(500).send(`<pre>Error: ${err.message}\n${err.stack}</pre>`); }
});

// ────────────────────────────────────────────────────────────────────────────
// JRZ INK SYSTEMS — The Monolith Architect
// Black/white only · Inter font · 0px corners · System/technical language
// Single-page site: Hero → Problem → Solution → Cases → Compare → Process → Pricing → Filter → Form
// ────────────────────────────────────────────────────────────────────────────

function jisBuildHome() {
  const logoSVG = `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <polygon points="18,3 33,30 3,30" fill="none" stroke="white" stroke-width="2.2"/>
    <polygon points="18,12 27,28 9,28" fill="white"/>
  </svg>`;

  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JRZ Ink Systems — Performance-Based Marketing Systems for Service Businesses</title>
<meta name="description" content="JRZ Ink Systems engineers fully automated, performance-based client acquisition systems for service businesses across the US. We only win when you win. No retainers. Apply now.">
<meta property="og:title" content="JRZ Ink Systems — We Build Your Pipeline. You Stay Booked.">
<meta property="og:description" content="Performance-based marketing systems for US service businesses. 10–15% of revenue generated. No retainers until results.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
html,body,.page-section,.page-section--content,.funnelish-section,.funnelish-section--content,.section-wrap,.section-wrap--content,.hl_page-section,.hl_page-section--content,.container,.container-fluid,.row,.col,[class*="col-"],[class*="section"],[class*="container"],[class*="wrapper"],[class*="inner"],[class*="page-section"],[class*="hl_"]{max-width:100%!important;width:100%!important;padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important;}
body{overflow-x:hidden!important;}
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#131313;--surface:#191919;--surface2:#1f1f1f;
  --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.14);
  --white:#ffffff;--dim:rgba(255,255,255,0.48);--faint:rgba(255,255,255,0.14);
  --font:'Inter',system-ui,sans-serif;
}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--white);font-family:var(--font);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
a{color:inherit;text-decoration:none;}

/* ── Layout ── */
.jis-wrap{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;}
.jis-c{max-width:1120px;margin:0 auto;padding:0 28px;box-sizing:border-box;}
.jis-sec{padding:108px 0;}
.jis-sec--sm{padding:72px 0;}

/* ── Nav ── */
.jis-nav{position:fixed;top:0;left:0;width:100%;z-index:999;background:rgba(19,19,19,0.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);}
.jis-nav-in{display:flex;align-items:center;justify-content:space-between;height:68px;max-width:1120px;margin:0 auto;padding:0 28px;}
.jis-brand{display:flex;align-items:center;gap:11px;font-size:13px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;}
.jis-brand svg{width:28px;height:28px;flex-shrink:0;}
.jis-nav-btn{background:var(--white);color:var(--bg);font-size:11px;font-weight:800;letter-spacing:0.13em;text-transform:uppercase;padding:11px 26px;display:inline-block;transition:opacity .18s;border:none;cursor:pointer;}
.jis-nav-btn:hover{opacity:.82;}

/* ── Hero ── */
.jis-hero{min-height:100vh;display:flex;align-items:center;padding-top:68px;position:relative;overflow:hidden;}
.jis-grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;}
.jis-grid-bg::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 50% 45%,rgba(255,255,255,0.04) 0%,transparent 65%);}
.jis-hud{display:flex;gap:28px;margin-bottom:28px;flex-wrap:wrap;}
.jis-hud-item{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:7px;}
.jis-hud-dot{width:5px;height:5px;background:var(--white);border-radius:50%;animation:jisDot 2.4s ease-in-out infinite;}
@keyframes jisDot{0%,100%{opacity:1;}50%{opacity:.15;}}
.jis-eyebrow{font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--dim);margin-bottom:18px;}
.jis-h1{font-size:clamp(42px,6.5vw,88px);font-weight:900;line-height:1.0;letter-spacing:-0.035em;margin-bottom:28px;}
.jis-h1 em{font-style:normal;display:block;color:var(--dim);}
.jis-hero-sub{font-size:19px;color:var(--dim);max-width:540px;margin-bottom:52px;line-height:1.65;}
.jis-cta-row{display:flex;align-items:center;gap:24px;flex-wrap:wrap;}
.jis-btn{background:var(--white);color:var(--bg);font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:18px 44px;display:inline-block;transition:opacity .18s;}
.jis-btn:hover{opacity:.84;}
.jis-cta-note{font-size:12px;color:var(--faint);letter-spacing:0.06em;}

/* ── Stats bar ── */
.jis-stats{border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface);padding:48px 0;}
.jis-stats-row{display:flex;justify-content:center;align-items:center;gap:0;flex-wrap:wrap;}
.jis-stat{text-align:center;padding:0 56px;border-right:1px solid var(--border);}
.jis-stat:last-child{border-right:none;}
@media(max-width:640px){.jis-stat{padding:20px 28px;border-right:none;border-bottom:1px solid var(--border);}}.jis-stat-n{font-size:clamp(40px,5vw,60px);font-weight:900;letter-spacing:-0.04em;line-height:1;}
.jis-stat-l{font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--dim);margin-top:6px;}

/* ── Section header ── */
.jis-tag{font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--dim);margin-bottom:16px;}
.jis-h2{font-size:clamp(30px,4.5vw,58px);font-weight:900;line-height:1.06;letter-spacing:-0.025em;margin-bottom:18px;}
.jis-h2-sub{font-size:17px;color:var(--dim);max-width:580px;line-height:1.7;}

/* ── Grid cards ── */
.jis-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:var(--border2);margin-top:60px;}
.jis-card{background:var(--bg);padding:44px 36px;}
.jis-card--surface{background:var(--surface);}
.jis-card-id{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--faint);margin-bottom:18px;}
.jis-card-title{font-size:19px;font-weight:800;margin-bottom:12px;line-height:1.3;letter-spacing:-0.01em;}
.jis-card-body{font-size:14px;color:var(--dim);line-height:1.75;}

/* ── Case studies ── */
.jis-cases{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border2);margin-top:60px;}
@media(max-width:680px){.jis-cases{grid-template-columns:1fr;}}
.jis-case{background:var(--bg);padding:52px 44px;position:relative;}
.jis-case::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--white);}
.jis-case-tag{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--dim);margin-bottom:22px;}
.jis-case-num{font-size:clamp(48px,7vw,80px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:14px;}
.jis-case-period{font-size:0.38em;font-weight:400;opacity:.7;}
.jis-case-name{font-size:17px;font-weight:800;margin-bottom:10px;}
.jis-case-desc{font-size:14px;color:var(--dim);line-height:1.75;}
@media(max-width:680px){.jis-case{padding:40px 28px;}}

/* ── Comparison table ── */
.jis-tbl{border:1px solid var(--border2);margin-top:60px;overflow:hidden;}
.jis-tbl-head,.jis-tbl-row{display:grid;grid-template-columns:2.2fr 1fr 1fr;}
.jis-tbl-head{background:var(--surface2);}
.jis-tbl-row{border-top:1px solid var(--border);}
.jis-tbl-cell{padding:18px 24px;font-size:14px;}
.jis-tbl-cell+.jis-tbl-cell{border-left:1px solid var(--border);text-align:center;}
.jis-tbl-head .jis-tbl-cell{font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--dim);padding:20px 24px;}
.jis-tbl-head .jis-ours{color:var(--white);}
.jis-check{color:var(--white);font-weight:700;}
.jis-x{color:var(--faint);}
@media(max-width:560px){
  .jis-tbl-head,.jis-tbl-row{grid-template-columns:1fr 1fr 1fr;}
  .jis-tbl-cell{padding:14px 10px;font-size:12px;}
}

/* ── Steps ── */
.jis-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border2);margin-top:60px;}
@media(max-width:680px){.jis-steps{grid-template-columns:1fr;}}
.jis-step{background:var(--bg);padding:52px 40px;}
.jis-step-n{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--faint);margin-bottom:22px;}
.jis-step-title{font-size:22px;font-weight:900;letter-spacing:-0.01em;margin-bottom:14px;}
.jis-step-body{font-size:14px;color:var(--dim);line-height:1.75;}

/* ── Pricing ── */
.jis-price-box{border:1px solid var(--border2);padding:60px 52px;margin-top:60px;position:relative;}
.jis-price-box::before{content:'ACCEPTING_APPLICATIONS';position:absolute;top:-1px;left:40px;background:var(--white);color:var(--bg);font-size:9px;font-weight:800;letter-spacing:0.18em;padding:5px 14px;}
.jis-price-main{font-size:clamp(30px,4.5vw,52px);font-weight:900;letter-spacing:-0.03em;margin:28px 0 10px;}
.jis-price-note{font-size:16px;color:var(--dim);margin-bottom:36px;}
.jis-price-list{list-style:none;display:flex;flex-direction:column;gap:16px;}
.jis-price-list li{font-size:15px;color:var(--dim);padding-left:22px;position:relative;line-height:1.6;}
.jis-price-list li::before{content:'—';position:absolute;left:0;color:var(--white);font-weight:700;}
@media(max-width:600px){.jis-price-box{padding:44px 24px;}}

/* ── Filter / Who it's for ── */
.jis-filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:var(--border2);margin-top:60px;}
.jis-filter{background:var(--bg);padding:40px 32px;}
.jis-filter-icon{font-size:20px;margin-bottom:18px;opacity:.55;}
.jis-filter-title{font-size:17px;font-weight:800;margin-bottom:10px;letter-spacing:-0.01em;}
.jis-filter-body{font-size:13px;color:var(--dim);line-height:1.75;}

/* ── CTA band ── */
.jis-band{background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);text-align:center;padding:80px 28px;}
.jis-band h2{font-size:clamp(28px,4.5vw,52px);font-weight:900;letter-spacing:-0.025em;margin-bottom:18px;}
.jis-band-sub{font-size:17px;color:var(--dim);max-width:480px;margin:0 auto 44px;line-height:1.7;}

/* ── Footer ── */
.jis-footer{border-top:1px solid var(--border);padding:32px 0;}
.jis-footer-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.jis-footer-brand{font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;}
.jis-footer-legal{font-size:11px;color:var(--faint);}

@media(max-width:560px){
  .jis-sec{padding:80px 0;}
  .jis-sec--sm{padding:56px 0;}
  .jis-c{padding:0 20px;}
}
</style>
</head>
<body>
<div class="jis-wrap">

<!-- NAV -->
<nav class="jis-nav">
  <div class="jis-nav-in" style="display:flex;align-items:center;justify-content:space-between;height:68px;max-width:1120px;margin:0 auto;padding:0 28px;gap:20px;">
    <a href="/" style="display:flex;align-items:center;gap:11px;font-size:12px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;color:#fff;flex-shrink:0;">${logoSVG}<span>JRZ INK SYSTEMS</span></a>
    <div style="display:flex;align-items:center;gap:28px;">
      <a href="/about" style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.5);text-decoration:none;">About</a>
      <a href="/why-us" style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.5);text-decoration:none;">Why Us</a>
      <a href="/our-process" style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.5);text-decoration:none;">Process</a>
    </div>
    <a href="/contact" class="jis-nav-btn">Apply Now</a>
  </div>
</nav>

<!-- HERO -->
<section class="jis-hero" id="top">
  <div class="jis-grid-bg"></div>
  <div class="jis-c" style="position:relative;z-index:1;padding-top:40px;padding-bottom:80px;">
    <div class="jis-hud">
      <div class="jis-hud-item"><span class="jis-hud-dot"></span>SYSTEM_ACTIVE</div>
      <div class="jis-hud-item">REACH: ALL_50_STATES</div>
      <div class="jis-hud-item">MODEL: PERFORMANCE_ONLY</div>
    </div>
    <p class="jis-eyebrow">Client Acquisition Systems</p>
    <h1 class="jis-h1">We Build<br>Your Pipeline.<em>You Stay Booked.</em></h1>
    <p class="jis-hero-sub">JRZ Ink Systems engineers fully automated, performance-based marketing systems for service businesses across the United States. We don't get paid unless you do.</p>
    <div class="jis-cta-row">
      <a href="/contact" class="jis-btn">Apply for a System →</a>
      <span class="jis-cta-note">No retainers · No long contracts · Results only</span>
    </div>
  </div>
</section>

<!-- STATS BAR -->
<div class="jis-stats">
  <div class="jis-c">
    <div class="jis-stats-row">
      <div class="jis-stat"><div class="jis-stat-n">$40K</div><div class="jis-stat-l">Client Monthly Revenue</div></div>
      <div class="jis-stat"><div class="jis-stat-n">100%</div><div class="jis-stat-l">Performance-Based</div></div>
      <div class="jis-stat"><div class="jis-stat-n">50</div><div class="jis-stat-l">States We Serve</div></div>
      <div class="jis-stat"><div class="jis-stat-n">$0</div><div class="jis-stat-l">Retainer Until Results</div></div>
    </div>
  </div>
</div>

<!-- PROBLEM -->
<section class="jis-sec" id="problem">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_01 // THE PROBLEM</p>
    <h2 class="jis-h2">Most Agencies Are<br>Paid to Show Up.</h2>
    <p class="jis-h2-sub">They bill you whether leads come or not. You absorb all the risk. They collect the fee. That's the old model — and it's broken.</p>
    <div class="jis-cards">
      <div class="jis-card">
        <div class="jis-card-id">ERROR_01</div>
        <div class="jis-card-title">Retainers With No Accountability</div>
        <div class="jis-card-body">Traditional agencies lock you into $2,000–$5,000/month contracts. The invoice arrives regardless of what's in your pipeline.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">ERROR_02</div>
        <div class="jis-card-title">Ad Spend That Burns</div>
        <div class="jis-card-body">Traffic without a conversion system is a budget drain. Paid media is useless without the infrastructure to turn clicks into booked clients.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">ERROR_03</div>
        <div class="jis-card-title">No Automation, No Scale</div>
        <div class="jis-card-body">Manual follow-up, missed leads, dead pipelines. Without automation baked in, your revenue growth hits a ceiling — every time.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">ERROR_04</div>
        <div class="jis-card-title">Freelancers Who Disappear</div>
        <div class="jis-card-body">One-off deliverables. No system ownership. Six months later you're starting from zero with someone new who doesn't know your business.</div>
      </div>
    </div>
  </div>
</section>

<!-- SOLUTION -->
<section class="jis-sec" id="solution" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_02 // THE SYSTEM</p>
    <h2 class="jis-h2">We Engineer the<br>Entire Acquisition Stack.</h2>
    <p class="jis-h2-sub">We don't sell you a service. We build an end-to-end machine — attracting, capturing, nurturing, and closing clients on autopilot.</p>
    <div class="jis-cards">
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">MODULE_01</div>
        <div class="jis-card-title">Lead Acquisition Infrastructure</div>
        <div class="jis-card-body">Precision-targeted paid and organic systems that bring your ideal clients to you. Built specifically for your market, your city, your price point.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">MODULE_02</div>
        <div class="jis-card-title">Automated Follow-Up Engine</div>
        <div class="jis-card-body">Every lead gets a response in seconds. Multi-channel sequences that qualify, educate, and move prospects toward a booked appointment — without you touching it.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">MODULE_03</div>
        <div class="jis-card-title">Conversion-Optimized Web Assets</div>
        <div class="jis-card-body">Landing pages, funnels, and websites built to convert — not just look good. Every element serves one purpose: getting the visitor to take action.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">MODULE_04</div>
        <div class="jis-card-title">CRM + Pipeline Management</div>
        <div class="jis-card-body">Full visibility into every lead, every stage, every deal. You see exactly what's coming in at any moment — with zero manual data entry required.</div>
      </div>
    </div>
  </div>
</section>

<!-- CASE STUDIES -->
<section class="jis-sec" id="results">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_03 // PROOF OF WORK</p>
    <h2 class="jis-h2">Results Speak<br>in Numbers.</h2>
    <p class="jis-h2-sub">Not projections. Not estimates. Clients who committed to the system and let it run.</p>
    <div class="jis-cases">
      <div class="jis-case">
        <div class="jis-case-tag">CASE_FILE_01 // SERVICE_BUSINESS // US</div>
        <div class="jis-case-num">$40,000<span class="jis-case-period">/mo</span></div>
        <div class="jis-case-name">Luis — Service Business Owner</div>
        <div class="jis-case-desc">Before JRZ Ink Systems: inconsistent months, manual outreach, no pipeline visibility. After deploying the full acquisition stack: $40,000 per month in consistent, predictable revenue — scaled without adding a single person to the team.</div>
      </div>
      <div class="jis-case">
        <div class="jis-case-tag">CASE_FILE_02 // SERVICE_BUSINESS // US</div>
        <div class="jis-case-num">$2,500<span class="jis-case-period">/wk</span></div>
        <div class="jis-case-name">Adriana — Service Business Owner</div>
        <div class="jis-case-desc">Adriana had the skill and the offer but no system to fill her calendar reliably. We built the machine. Within weeks: $2,500 per week in new client revenue — fully automated, completely predictable, and still growing.</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:52px;">
      <a href="/contact" class="jis-btn">Get Results Like These →</a>
    </div>
  </div>
</section>

<!-- COMPARISON -->
<section class="jis-sec jis-sec--sm" id="compare" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_04 // BENCHMARK</p>
    <h2 class="jis-h2">How We Compare</h2>
    <div class="jis-tbl">
      <div class="jis-tbl-head">
        <div class="jis-tbl-cell"></div>
        <div class="jis-tbl-cell">Traditional Agency</div>
        <div class="jis-tbl-cell jis-ours">JRZ Ink Systems</div>
      </div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">Performance-based — only pay on results</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">Full automation stack included</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">CRM + pipeline management built in</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">We only win when you win</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">Serves clients across all 50 US states</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
      <div class="jis-tbl-row"><div class="jis-tbl-cell">Dedicated system architect — one contact</div><div class="jis-tbl-cell"><span class="jis-x">✕</span></div><div class="jis-tbl-cell"><span class="jis-check">✓</span></div></div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="jis-sec" id="process">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_05 // EXECUTION_SEQUENCE</p>
    <h2 class="jis-h2">Three Phases.<br>One Outcome.</h2>
    <p class="jis-h2-sub">From application to fully booked — the system runs in three defined stages.</p>
    <div class="jis-steps">
      <div class="jis-step">
        <div class="jis-step-n">PHASE_01</div>
        <div class="jis-step-title">Apply &amp; Qualify</div>
        <div class="jis-step-body">Complete the application. We review your business, market, and goals. If the system fits your situation, we move to onboarding. We only take clients we're confident we can scale.</div>
      </div>
      <div class="jis-step">
        <div class="jis-step-n">PHASE_02</div>
        <div class="jis-step-title">Build the System</div>
        <div class="jis-step-body">We architect your full acquisition infrastructure: targeting, funnel, automation sequences, CRM setup, conversion assets. Everything is custom-built to your market and offer.</div>
      </div>
      <div class="jis-step">
        <div class="jis-step-n">PHASE_03</div>
        <div class="jis-step-title">Deploy &amp; Stay Booked</div>
        <div class="jis-step-body">The system goes live. Leads flow in. Follow-up happens automatically. Your calendar fills. We monitor, optimize, and scale — you stay focused on delivering your service.</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:52px;">
      <a href="/contact" class="jis-btn">Start Phase 01 →</a>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="jis-sec jis-sec--sm" id="pricing" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_06 // INVESTMENT_MODEL</p>
    <h2 class="jis-h2">Aligned Incentives.<br>Simple Structure.</h2>
    <p class="jis-h2-sub">One principle: we grow when you grow. No hidden fees. No surprises.</p>
    <div class="jis-price-box">
      <p style="font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--faint);">ENTRY_FEE_STRUCTURE</p>
      <div class="jis-price-main">10–15% of Revenue Generated</div>
      <div class="jis-price-note">+ $500/month system management fee</div>
      <ul class="jis-price-list">
        <li>No upfront retainer until the system is generating results</li>
        <li>Full acquisition system — built, managed, and optimized by us</li>
        <li>CRM, automation sequences, funnels, and ad management included</li>
        <li>One dedicated account architect — single point of contact</li>
        <li>Monthly performance reporting and continuous optimization</li>
        <li>Available to qualified service businesses across all 50 US states</li>
      </ul>
      <div style="margin-top:44px;">
        <a href="/contact" class="jis-btn">Apply for a System →</a>
      </div>
    </div>
  </div>
</section>

<!-- WHO IT'S FOR -->
<section class="jis-sec" id="qualify">
  <div class="jis-c">
    <p class="jis-tag">PROTOCOL_07 // QUALIFICATION_FILTER</p>
    <h2 class="jis-h2">Who This Is<br>Built For.</h2>
    <p class="jis-h2-sub">We're selective. The system performs best for a specific type of operator.</p>
    <div class="jis-filter-grid">
      <div class="jis-filter">
        <div class="jis-filter-icon">◈</div>
        <div class="jis-filter-title">Established Service Businesses</div>
        <div class="jis-filter-body">You have a proven offer, you deliver excellent work, but your pipeline is inconsistent or overly dependent on referrals.</div>
      </div>
      <div class="jis-filter">
        <div class="jis-filter-icon">◈</div>
        <div class="jis-filter-title">High-Ticket Providers</div>
        <div class="jis-filter-body">Your average client is worth $1,000+ or you operate on monthly retainers. The math works — and the system scales it further.</div>
      </div>
      <div class="jis-filter">
        <div class="jis-filter-icon">◈</div>
        <div class="jis-filter-title">Operators Ready to Scale</div>
        <div class="jis-filter-body">You're not looking for another freelancer or another agency pitch. You want a system that runs, a team that owns results, and numbers you can count on.</div>
      </div>
      <div class="jis-filter">
        <div class="jis-filter-icon">◈</div>
        <div class="jis-filter-title">US-Based, Any State</div>
        <div class="jis-filter-body">We serve clients in all 50 states. Local, regional, or national reach — the system is built to match your geography and market.</div>
      </div>
    </div>
  </div>
</section>

<!-- FINAL CTA BAND -->
<section style="background:var(--bg);border-top:1px solid var(--border2);padding:108px 0;text-align:center;position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;"></div>
  <div class="jis-c" style="position:relative;z-index:1;">
    <p class="jis-tag" style="text-align:center;">SYSTEM_ENTRY // APPLY_NOW</p>
    <h2 class="jis-h2" style="max-width:700px;margin:0 auto 20px;">Ready to Stop<br>Chasing Clients?</h2>
    <p style="font-size:18px;color:var(--dim);max-width:480px;margin:0 auto 48px;line-height:1.7;">The application takes 2 minutes. If there's a fit, you'll hear from us within 24 hours.</p>
    <div style="display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap;">
      <a href="/contact" class="jis-btn" style="font-size:14px;padding:20px 60px;">Apply for a System →</a>
      <span style="font-size:12px;color:var(--faint);">No retainers · No long contracts · Results only</span>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer class="jis-footer">
  <div class="jis-c">
    <div class="jis-footer-in">
      <div class="jis-footer-brand">JRZ Ink Systems</div>
      <div class="jis-footer-legal">© ${year} JRZ Ink Systems · <a href="tel:+14077205284" style="color:inherit;">(407) 720-5284</a> · <a href="mailto:jrzinksystems@gmail.com" style="color:inherit;">jrzinksystems@gmail.com</a></div>
    </div>
  </div>
</footer>

</div>
</body>
</html>`;
}

// ── JRZ Ink Systems shared helpers (nav, footer, head) ──────────────────────
function jisSharedCSS() {
  return `html,body,.page-section,.page-section--content,.funnelish-section,.funnelish-section--content,.section-wrap,.section-wrap--content,.hl_page-section,.hl_page-section--content,.container,.container-fluid,.row,.col,[class*="col-"],[class*="section"],[class*="container"],[class*="wrapper"],[class*="inner"],[class*="page-section"],[class*="hl_"]{max-width:100%!important;width:100%!important;padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important;}
body{overflow-x:hidden!important;}
*{margin:0;padding:0;box-sizing:border-box;}
:root{--bg:#131313;--surface:#191919;--surface2:#1f1f1f;--border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.14);--white:#ffffff;--dim:rgba(255,255,255,0.48);--faint:rgba(255,255,255,0.14);--font:'Inter',system-ui,sans-serif;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--white);font-family:var(--font);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
a{color:inherit;text-decoration:none;}
.jis-wrap{width:100%;}
.jis-c{max-width:1120px;margin:0 auto;padding:0 28px;}
.jis-sec{padding:108px 0;}
.jis-sec--sm{padding:72px 0;}
.jis-nav{position:fixed;top:0;left:0;width:100%;z-index:999;background:rgba(19,19,19,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);}
.jis-nav-in{display:flex;align-items:center;justify-content:space-between;height:68px;max-width:1120px;margin:0 auto;padding:0 28px;gap:20px;}
.jis-brand{display:flex;align-items:center;gap:11px;font-size:12px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;flex-shrink:0;}
.jis-brand svg{width:26px;height:26px;flex-shrink:0;}
.jis-nav-links{display:flex;align-items:center;gap:28px;}
.jis-nav-links a{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--dim);transition:color .15s;}
.jis-nav-links a:hover,.jis-nav-links a.active{color:var(--white);}
.jis-nav-btn{background:var(--white);color:var(--bg);font-size:11px;font-weight:800;letter-spacing:0.13em;text-transform:uppercase;padding:11px 24px;display:inline-block;transition:opacity .18s;flex-shrink:0;}
.jis-nav-btn:hover{opacity:.82;}
@media(max-width:700px){.jis-nav-links{display:none;}}
.jis-tag{font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--dim);margin-bottom:16px;}
.jis-h2{font-size:clamp(30px,4.5vw,58px);font-weight:900;line-height:1.06;letter-spacing:-0.025em;margin-bottom:18px;}
.jis-h2-sub{font-size:17px;color:var(--dim);max-width:580px;line-height:1.7;}
.jis-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:var(--border2);margin-top:60px;}
.jis-card{background:var(--bg);padding:44px 36px;}
.jis-card--surface{background:var(--surface);}
.jis-card-id{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--faint);margin-bottom:18px;}
.jis-card-title{font-size:19px;font-weight:800;margin-bottom:12px;line-height:1.3;letter-spacing:-0.01em;}
.jis-card-body{font-size:14px;color:var(--dim);line-height:1.75;}
.jis-btn{background:var(--white);color:var(--bg);font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:18px 44px;display:inline-block;transition:opacity .18s;}
.jis-btn:hover{opacity:.84;}
.jis-footer{border-top:1px solid var(--border);padding:32px 0;}
.jis-footer-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.jis-footer-brand{font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;}
.jis-footer-legal{font-size:11px;color:var(--faint);}
@media(max-width:560px){.jis-sec{padding:80px 0;}.jis-sec--sm{padding:56px 0;}.jis-c{padding:0 20px;}}`;
}

function jisHead(title, meta) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${meta}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>${jisSharedCSS()}</style>
</head>
<body>
<div class="jis-wrap">`;
}

function jisNavHTML(activePage) {
  const links = [
    { label: 'Home', href: '/' },
    { label: 'About Us', href: '/about' },
    { label: 'Why Us', href: '/why-us' },
    { label: 'Our Process', href: '/our-process' },
  ];
  const logoSVG = `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="18,3 33,30 3,30" fill="none" stroke="white" stroke-width="2.2"/><polygon points="18,12 27,28 9,28" fill="white"/></svg>`;
  return `<nav class="jis-nav">
  <div class="jis-nav-in">
    <a href="/" class="jis-brand">${logoSVG}<span>JRZ INK SYSTEMS</span></a>
    <div class="jis-nav-links">
      ${links.map(l=>`<a href="${l.href}"${activePage===l.label?' class="active"':''}>${l.label}</a>`).join('')}
    </div>
    <a href="/contact" class="jis-nav-btn">Apply Now</a>
  </div>
</nav>`;
}

function jisFooterHTML() {
  const year = new Date().getFullYear();
  return `<footer class="jis-footer">
  <div class="jis-c">
    <div class="jis-footer-in">
      <div class="jis-footer-brand">JRZ Ink Systems</div>
      <div class="jis-footer-legal">© ${year} JRZ Ink Systems · <a href="tel:+14077205284" style="color:inherit;">(407) 720-5284</a> · <a href="mailto:jrzinksystems@gmail.com" style="color:inherit;">jrzinksystems@gmail.com</a></div>
    </div>
  </div>
</footer>
</div>
</body>
</html>`;
}

// ── About Us ─────────────────────────────────────────────────────────────────
function jisAbout() {
  return jisHead('About JRZ Ink Systems — Performance-Based Marketing Built on Accountability', 'JRZ Ink Systems was built on one belief: marketing agencies should only get paid when clients win. Learn who we are, what we stand for, and why we operate differently.') +
  jisNavHTML('About Us') + `
<!-- PAGE HERO -->
<section style="min-height:52vh;display:flex;align-items:center;padding-top:68px;background:var(--bg);border-bottom:1px solid var(--border);position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;"></div>
  <div class="jis-c" style="position:relative;z-index:1;padding-top:60px;padding-bottom:80px;">
    <p class="jis-tag">SYSTEM_FILE_01 // WHO WE ARE</p>
    <h1 class="jis-h2" style="font-size:clamp(40px,6vw,80px);max-width:800px;">Built on One Belief:<br><span style="color:var(--dim);">We Only Win When You Win.</span></h1>
  </div>
</section>

<!-- ORIGIN -->
<section class="jis-sec" style="background:var(--surface);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:start;">
      <div>
        <p class="jis-tag">ORIGIN_RECORD</p>
        <h2 class="jis-h2" style="font-size:clamp(26px,3.5vw,44px);">Where JRZ Ink Systems Came From</h2>
        <p style="font-size:16px;color:var(--dim);line-height:1.8;margin-bottom:20px;">JRZ Ink Systems was founded out of frustration with the standard agency model. Business after business was paying thousands of dollars per month to marketing companies and seeing little to no return — month after month, invoice after invoice.</p>
        <p style="font-size:16px;color:var(--dim);line-height:1.8;margin-bottom:20px;">We believed there was a better way: build a system that works, tie our compensation to the results it generates, and only work with clients we're genuinely confident we can scale.</p>
        <p style="font-size:16px;color:var(--dim);line-height:1.8;">That belief became JRZ Ink Systems. Performance-based. Fully automated. US-wide.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:1px;background:var(--border2);">
        <div style="background:var(--bg);padding:32px 28px;">
          <div class="jis-card-id">METRIC_01</div>
          <div style="font-size:48px;font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:8px;">$40K</div>
          <div style="font-size:13px;color:var(--dim);">Highest monthly client revenue generated</div>
        </div>
        <div style="background:var(--bg);padding:32px 28px;">
          <div class="jis-card-id">METRIC_02</div>
          <div style="font-size:48px;font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:8px;">$0</div>
          <div style="font-size:13px;color:var(--dim);">Retainer charged before results are delivered</div>
        </div>
        <div style="background:var(--bg);padding:32px 28px;">
          <div class="jis-card-id">METRIC_03</div>
          <div style="font-size:48px;font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:8px;">50</div>
          <div style="font-size:13px;color:var(--dim);">US states we're equipped to serve</div>
        </div>
      </div>
    </div>
    @media(max-width:760px){.origin-grid{grid-template-columns:1fr!important;gap:48px!important;}}
  </div>
</section>

<!-- MISSION + VALUES -->
<section class="jis-sec">
  <div class="jis-c">
    <p class="jis-tag">CORE_VALUES // OPERATING_PRINCIPLES</p>
    <h2 class="jis-h2">What We Stand For</h2>
    <p class="jis-h2-sub">Three principles that govern every client relationship we take on.</p>
    <div class="jis-cards">
      <div class="jis-card">
        <div class="jis-card-id">VALUE_01</div>
        <div class="jis-card-title">Radical Accountability</div>
        <div class="jis-card-body">We don't hide behind vanity metrics or activity reports. Our compensation is tied to the revenue we generate for you. If the system doesn't perform, we don't get paid. That's the deal — and we stand behind it.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">VALUE_02</div>
        <div class="jis-card-title">Systems Over Tactics</div>
        <div class="jis-card-body">Tactics are one-time plays. Systems compound. We build infrastructure that gets better over time — acquisition engines, automation sequences, and pipelines that work harder the longer they run.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">VALUE_03</div>
        <div class="jis-card-title">Honest Qualification</div>
        <div class="jis-card-body">We turn down more clients than we accept. If we don't believe the system will work for your business, we'll tell you plainly. We only take on clients we're confident we can move the needle for.</div>
      </div>
      <div class="jis-card">
        <div class="jis-card-id">VALUE_04</div>
        <div class="jis-card-title">Long-Term Alignment</div>
        <div class="jis-card-body">We're not transaction-based. Our performance model means we grow when you grow — creating the kind of long-term partnership that traditional agencies structurally cannot offer.</div>
      </div>
    </div>
  </div>
</section>

<!-- WHO WE SERVE -->
<section class="jis-sec jis-sec--sm" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">TARGET_PROFILE // CLIENT_SPEC</p>
    <h2 class="jis-h2">Who We Work With</h2>
    <p class="jis-h2-sub">We partner with a very specific type of operator. If this is you, we should talk.</p>
    <div class="jis-cards" style="margin-top:48px;">
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">PROFILE_01</div>
        <div class="jis-card-title">Service business owners in the US</div>
        <div class="jis-card-body">Any industry where you deliver a service and get paid for it — local, regional, or national. If your average client is worth $1,000 or more, the system works.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">PROFILE_02</div>
        <div class="jis-card-title">Operators with a proven offer</div>
        <div class="jis-card-body">You've delivered results before. You know your market. You just don't have the acquisition infrastructure to bring in clients consistently and predictably.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">PROFILE_03</div>
        <div class="jis-card-title">Leaders ready for a system, not a vendor</div>
        <div class="jis-card-body">You want a partner who owns the outcome — not a freelancer who submits a deliverable and disappears. You want accountability, reporting, and results.</div>
      </div>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="jis-sec jis-sec--sm" style="text-align:center;">
  <div class="jis-c">
    <p class="jis-tag" style="text-align:center;">NEXT_STEP</p>
    <h2 class="jis-h2" style="max-width:600px;margin:0 auto 20px;">Ready to Work Together?</h2>
    <p style="font-size:17px;color:var(--dim);max-width:440px;margin:0 auto 40px;line-height:1.7;">Apply in 2 minutes. If we're a fit, you'll hear from us within 24 hours.</p>
    <a href="/contact" class="jis-btn">Apply for a System →</a>
  </div>
</section>
` + jisFooterHTML();
}

// ── Why Us ───────────────────────────────────────────────────────────────────
function jisWhyUs() {
  return jisHead('Why JRZ Ink Systems — The Case for a Performance-Based Partner', 'Why choose JRZ Ink Systems over a traditional agency? We only get paid when you do, we build real automation systems, and we serve clients across all 50 US states.') +
  jisNavHTML('Why Us') + `
<!-- PAGE HERO -->
<section style="min-height:52vh;display:flex;align-items:center;padding-top:68px;background:var(--bg);border-bottom:1px solid var(--border);position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;"></div>
  <div class="jis-c" style="position:relative;z-index:1;padding-top:60px;padding-bottom:80px;">
    <p class="jis-tag">SYSTEM_FILE_02 // THE CASE FOR US</p>
    <h1 class="jis-h2" style="font-size:clamp(40px,6vw,80px);max-width:800px;">Why Operators Choose<br><span style="color:var(--dim);">JRZ Ink Systems.</span></h1>
  </div>
</section>

<!-- THE DIFFERENCE -->
<section class="jis-sec" style="background:var(--surface);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">DIFFERENTIATION_RECORD</p>
    <h2 class="jis-h2">The Model Is Different.<br>The Results Prove It.</h2>
    <p class="jis-h2-sub">Every agency claims to deliver results. We're the only ones whose paycheck depends on it.</p>
    <div class="jis-cards">
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_01</div>
        <div class="jis-card-title">We Don't Get Paid Until You Do</div>
        <div class="jis-card-body">Our model is performance-based from day one. No retainer until results are flowing. You don't absorb risk alone — we're in it with you. That changes everything about how we show up and how hard we work on your account.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_02</div>
        <div class="jis-card-title">We Build the Whole System</div>
        <div class="jis-card-body">Not just ads. Not just a landing page. Not just email sequences. We engineer the entire acquisition stack — from first touch to booked appointment — so there are no gaps where leads fall through.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_03</div>
        <div class="jis-card-title">Automation Runs 24/7</div>
        <div class="jis-card-body">While traditional agencies deliver campaigns that require manual work to function, our systems run around the clock. Every lead gets followed up in seconds. Every prospect gets nurtured automatically. No human bottleneck.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_04</div>
        <div class="jis-card-title">One Contact. Full Ownership.</div>
        <div class="jis-card-body">You'll never get bounced between account managers or talk to someone who doesn't know your business. One dedicated system architect owns your account from onboarding to scale — and they're accountable for every metric.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_05</div>
        <div class="jis-card-title">We Qualify Before We Accept</div>
        <div class="jis-card-body">We review every application and only onboard clients where we're confident the system will work. This means every client we take on gets our full focus — not a diluted effort split across 200 accounts.</div>
      </div>
      <div class="jis-card jis-card--surface">
        <div class="jis-card-id">REASON_06</div>
        <div class="jis-card-title">Nationwide Reach</div>
        <div class="jis-card-body">We're not geo-limited. Whether you serve one city or the entire country, we build and operate systems at whatever scale your business requires. All 50 US states. Local or national targeting.</div>
      </div>
    </div>
  </div>
</section>

<!-- PROOF: CASE NUMBERS -->
<section class="jis-sec">
  <div class="jis-c">
    <p class="jis-tag">PROOF_OF_CONCEPT // REAL_NUMBERS</p>
    <h2 class="jis-h2">The Numbers Don't Lie.</h2>
    <p class="jis-h2-sub">Two clients. Real revenue. Systems that run without them managing it daily.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border2);margin-top:60px;">
      <div style="background:var(--bg);padding:52px 44px;position:relative;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--white);"></div>
        <div class="jis-card-id">CASE_FILE_01</div>
        <div style="font-size:clamp(48px,7vw,80px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:14px;">$40,000<span style="font-size:0.38em;font-weight:400;opacity:.7;">/mo</span></div>
        <div style="font-size:17px;font-weight:800;margin-bottom:10px;">Luis — Service Business Owner</div>
        <div style="font-size:14px;color:var(--dim);line-height:1.75;">Went from inconsistent revenue and manual outreach to $40K/month — predictable, automated, and scaling without adding staff. The pipeline runs itself.</div>
      </div>
      <div style="background:var(--bg);padding:52px 44px;position:relative;">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--white);"></div>
        <div class="jis-card-id">CASE_FILE_02</div>
        <div style="font-size:clamp(48px,7vw,80px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-bottom:14px;">$2,500<span style="font-size:0.38em;font-weight:400;opacity:.7;">/wk</span></div>
        <div style="font-size:17px;font-weight:800;margin-bottom:10px;">Adriana — Service Business Owner</div>
        <div style="font-size:14px;color:var(--dim);line-height:1.75;">Had the skills, had the offer — lacked the acquisition system. We built it. $2,500 per week in new client revenue, fully automated and growing every month.</div>
      </div>
    </div>
    @media(max-width:680px){.proof-grid{grid-template-columns:1fr!important;}}
    <div style="text-align:center;margin-top:52px;">
      <a href="/contact" class="jis-btn">Apply for a System →</a>
    </div>
  </div>
</section>

<!-- COMPARISON TABLE -->
<section class="jis-sec jis-sec--sm" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">BENCHMARK // SIDE_BY_SIDE</p>
    <h2 class="jis-h2">Us vs. The Old Model</h2>
    <div style="border:1px solid var(--border2);margin-top:52px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:2.2fr 1fr 1fr;background:var(--surface2);">
        <div style="padding:20px 24px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);"></div>
        <div style="padding:20px 24px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);border-left:1px solid var(--border);text-align:center;">Traditional Agency</div>
        <div style="padding:20px 24px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--white);border-left:1px solid var(--border);text-align:center;">JRZ Ink Systems</div>
      </div>
      ${[
        ['Paid only on results generated','✕','✓'],
        ['Complete automation stack included','✕','✓'],
        ['CRM and pipeline management built in','✕','✓'],
        ['Single dedicated account owner','✕','✓'],
        ['No retainer until results flowing','✕','✓'],
        ['Available in all 50 US states','✕','✓'],
        ['Monthly performance optimization','Sometimes','Always'],
      ].map(([label,bad,good])=>`<div style="display:grid;grid-template-columns:2.2fr 1fr 1fr;border-top:1px solid var(--border);">
        <div style="padding:18px 24px;font-size:14px;">${label}</div>
        <div style="padding:18px 24px;font-size:14px;border-left:1px solid var(--border);text-align:center;color:var(--faint);">${bad}</div>
        <div style="padding:18px 24px;font-size:14px;border-left:1px solid var(--border);text-align:center;color:var(--white);font-weight:700;">${good}</div>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- CTA -->
<section class="jis-sec jis-sec--sm" style="text-align:center;">
  <div class="jis-c">
    <p class="jis-tag" style="text-align:center;">NEXT_STEP</p>
    <h2 class="jis-h2" style="max-width:640px;margin:0 auto 20px;">The Proof Is in the Pipeline.</h2>
    <p style="font-size:17px;color:var(--dim);max-width:460px;margin:0 auto 40px;line-height:1.7;">Apply now and see if JRZ Ink Systems is the right fit for your business.</p>
    <a href="/contact" class="jis-btn">Apply for a System →</a>
  </div>
</section>
` + jisFooterHTML();
}

// ── Our Process ───────────────────────────────────────────────────────────────
function jisOurProcess() {
  return jisHead('Our Process — How JRZ Ink Systems Builds Your Acquisition System', 'A step-by-step breakdown of how JRZ Ink Systems builds, deploys, and scales your client acquisition system. From application to fully booked in three phases.') +
  jisNavHTML('Our Process') + `
<!-- PAGE HERO -->
<section style="min-height:52vh;display:flex;align-items:center;padding-top:68px;background:var(--bg);border-bottom:1px solid var(--border);position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;"></div>
  <div class="jis-c" style="position:relative;z-index:1;padding-top:60px;padding-bottom:80px;">
    <p class="jis-tag">SYSTEM_FILE_03 // EXECUTION_SEQUENCE</p>
    <h1 class="jis-h2" style="font-size:clamp(40px,6vw,80px);max-width:800px;">Three Phases.<br><span style="color:var(--dim);">One Outcome: Fully Booked.</span></h1>
  </div>
</section>

<!-- OVERVIEW -->
<section class="jis-sec jis-sec--sm" style="background:var(--surface);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">PROCESS_OVERVIEW</p>
    <h2 class="jis-h2" style="font-size:clamp(24px,3.5vw,42px);">We Don't Offer Services.<br>We Deploy Systems.</h2>
    <p style="font-size:17px;color:var(--dim);max-width:680px;line-height:1.8;margin-top:16px;">The difference matters. A service gets delivered once. A system runs continuously — attracting, qualifying, nurturing, and closing clients on autopilot. Here's exactly how we build yours.</p>
  </div>
</section>

<!-- PHASE 1 -->
<section class="jis-sec" style="border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <div style="display:grid;grid-template-columns:280px 1fr;gap:80px;align-items:start;">
      <div style="position:sticky;top:88px;">
        <div class="jis-card-id" style="font-size:11px;">PHASE_01</div>
        <div style="font-size:clamp(48px,6vw,72px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-top:8px;">01</div>
        <div style="font-size:22px;font-weight:900;margin-top:12px;letter-spacing:-0.01em;">Apply &amp;<br>Qualify</div>
      </div>
      <div>
        <p style="font-size:18px;color:var(--dim);line-height:1.8;margin-bottom:36px;">The first phase is about fit. We only build systems for businesses we're confident we can scale — so before anything else, we need to understand your business, your offer, and your market.</p>
        <div style="display:flex;flex-direction:column;gap:1px;background:var(--border2);">
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_1A</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Submit your application</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">Complete the contact form. Tell us about your business, your current revenue, and what you're trying to achieve. Takes 2 minutes.</div>
          </div>
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_1B</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Strategy call within 24 hours</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">If your application looks like a strong fit, we'll reach out within 24 hours to schedule a strategy call. We'll go deep on your offer, your market, and what a successful system would look like for you.</div>
          </div>
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_1C</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Honest assessment</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">We'll tell you plainly whether the system will work for your specific situation. If it's not the right fit, we'll say so — and often point you toward what would actually move the needle for you instead.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PHASE 2 -->
<section class="jis-sec" style="background:var(--surface);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <div style="display:grid;grid-template-columns:280px 1fr;gap:80px;align-items:start;">
      <div style="position:sticky;top:88px;">
        <div class="jis-card-id" style="font-size:11px;">PHASE_02</div>
        <div style="font-size:clamp(48px,6vw,72px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-top:8px;">02</div>
        <div style="font-size:22px;font-weight:900;margin-top:12px;letter-spacing:-0.01em;">Build the<br>System</div>
      </div>
      <div>
        <p style="font-size:18px;color:var(--dim);line-height:1.8;margin-bottom:36px;">Once we've confirmed the fit, we build. This is where the infrastructure goes in — the targeting, the funnel, the automation, the CRM, and the conversion assets. Everything custom to your market.</p>
        <div style="display:flex;flex-direction:column;gap:1px;background:var(--border2);">
          <div style="background:var(--surface2);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_2A</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Market &amp; audience mapping</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">We identify exactly who your ideal clients are, where they are, and what messaging gets them to take action. This drives everything else in the system.</div>
          </div>
          <div style="background:var(--surface2);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_2B</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Funnel + conversion asset build</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">Landing pages, opt-in forms, and offer pages engineered to convert at every stage of the funnel. No templates — built specifically for your offer and audience.</div>
          </div>
          <div style="background:var(--surface2);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_2C</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Automation sequences wired up</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">SMS, email, and voicemail follow-up sequences that trigger the instant a lead comes in. Nurture flows that move prospects from interest to booked appointment — automatically.</div>
          </div>
          <div style="background:var(--surface2);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_2D</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">CRM + pipeline configured</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">Full pipeline visibility. You see every lead, every stage, every value. No spreadsheets. No manual tracking. Everything in one place, updated in real time.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PHASE 3 -->
<section class="jis-sec" style="border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <div style="display:grid;grid-template-columns:280px 1fr;gap:80px;align-items:start;">
      <div style="position:sticky;top:88px;">
        <div class="jis-card-id" style="font-size:11px;">PHASE_03</div>
        <div style="font-size:clamp(48px,6vw,72px);font-weight:900;letter-spacing:-0.04em;line-height:1;margin-top:8px;">03</div>
        <div style="font-size:22px;font-weight:900;margin-top:12px;letter-spacing:-0.01em;">Deploy &amp;<br>Scale</div>
      </div>
      <div>
        <p style="font-size:18px;color:var(--dim);line-height:1.8;margin-bottom:36px;">The system goes live. Leads start flowing in. You focus on delivering your service. We watch the data, optimize what's underperforming, and scale what's working.</p>
        <div style="display:flex;flex-direction:column;gap:1px;background:var(--border2);">
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_3A</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">System goes live</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">Ads activate, funnels go live, automation sequences arm. From day one, every lead that enters the system gets followed up automatically — in seconds, not hours.</div>
          </div>
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_3B</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Monthly performance reviews</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">Every month you get a clear report: leads generated, appointments booked, revenue attributed, cost per acquisition. No fluff. Just numbers and what we're doing to improve them.</div>
          </div>
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_3C</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Continuous optimization</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">We split-test ads, refine sequences, adjust targeting, and update conversion assets based on what the data shows. The system gets better every month it runs.</div>
          </div>
          <div style="background:var(--bg);padding:28px 32px;">
            <div class="jis-card-id" style="margin-bottom:10px;">STEP_3D</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:8px;">Scale on demand</div>
            <div style="font-size:14px;color:var(--dim);line-height:1.7;">When you're ready to grow further — new markets, higher volume, expanded offers — we scale the system with you. The infrastructure is already in place. It just needs fuel.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- WHAT TO EXPECT -->
<section class="jis-sec jis-sec--sm" style="background:var(--surface);border-bottom:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">EXPECTATION_SETTING</p>
    <h2 class="jis-h2" style="font-size:clamp(24px,3.5vw,42px);">What to Expect<br>When You Work With Us</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:var(--border2);margin-top:48px;">
      <div style="background:var(--surface2);padding:36px 28px;">
        <div class="jis-card-id">EXPECT_01</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:10px;line-height:1.3;">Honesty over hype</div>
        <div style="font-size:13px;color:var(--dim);line-height:1.75;">We'll tell you what's working, what isn't, and what we're changing. No vague reports. No spun metrics.</div>
      </div>
      <div style="background:var(--surface2);padding:36px 28px;">
        <div class="jis-card-id">EXPECT_02</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:10px;line-height:1.3;">Speed to first results</div>
        <div style="font-size:13px;color:var(--dim);line-height:1.75;">Most clients see leads flowing within the first weeks of go-live, not months. The system is built to produce quickly.</div>
      </div>
      <div style="background:var(--surface2);padding:36px 28px;">
        <div class="jis-card-id">EXPECT_03</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:10px;line-height:1.3;">One point of contact</div>
        <div style="font-size:13px;color:var(--dim);line-height:1.75;">You have one person who knows your account inside and out. No account manager rotation. No knowledge gaps.</div>
      </div>
      <div style="background:var(--surface2);padding:36px 28px;">
        <div class="jis-card-id">EXPECT_04</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:10px;line-height:1.3;">Aligned incentives, always</div>
        <div style="font-size:13px;color:var(--dim);line-height:1.75;">Because we earn a percentage of what we generate, we're financially motivated to push performance as hard as possible. That never changes.</div>
      </div>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="jis-sec jis-sec--sm" style="text-align:center;">
  <div class="jis-c">
    <p class="jis-tag" style="text-align:center;">READY_TO_BEGIN</p>
    <h2 class="jis-h2" style="max-width:600px;margin:0 auto 20px;">Start Phase 01 Today.</h2>
    <p style="font-size:17px;color:var(--dim);max-width:440px;margin:0 auto 40px;line-height:1.7;">Apply in 2 minutes. Hear back within 24 hours. Your pipeline gets built — you stay booked.</p>
    <a href="/contact" class="jis-btn">Apply for a System →</a>
  </div>
</section>
` + jisFooterHTML();
}

// ── Contact Us ────────────────────────────────────────────────────────────────
function jisContactPage() {
  return jisHead('Contact JRZ Ink Systems — Apply for a Client Acquisition System', 'Apply to work with JRZ Ink Systems. Fill out the form and we\'ll reach out within 24 hours. Phone: (407) 720-5284. Email: jrzinksystems@gmail.com. US clients only.') +
  jisNavHTML('Contact') + `
<style>
.jis-contact{background:var(--surface);border-top:1px solid var(--border2);}
.jis-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:96px;align-items:start;padding:96px 0;}
@media(max-width:820px){.jis-contact-grid{grid-template-columns:1fr;gap:52px;padding:72px 0;}}
.jis-contact-info h2{font-size:clamp(30px,4vw,48px);font-weight:900;letter-spacing:-0.025em;margin-bottom:24px;}
.jis-contact-meta{display:flex;flex-direction:column;gap:13px;margin-bottom:40px;}
.jis-contact-line{font-size:15px;color:var(--dim);}
.jis-contact-line a{color:var(--white);font-weight:700;}
.jis-contact-line a:hover{text-decoration:underline;}
.jis-status-box{border-top:1px solid var(--border);padding-top:28px;}
.jis-status-label{font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--faint);margin-bottom:10px;}
.jis-status-text{font-size:13px;color:var(--dim);line-height:1.7;}
.jis-form-frame{background:var(--bg);border:1px solid var(--border);}
</style>

<!-- PAGE HERO -->
<section style="padding:120px 0 64px;background:var(--bg);border-bottom:1px solid var(--border);position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);background-size:72px 72px;pointer-events:none;"></div>
  <div class="jis-c" style="position:relative;z-index:1;">
    <p class="jis-tag">SYSTEM_FILE_04 // CONTACT_ENTRY</p>
    <h1 class="jis-h2" style="font-size:clamp(40px,6vw,72px);max-width:760px;">Apply to Work<br><span style="color:var(--dim);">With JRZ Ink Systems.</span></h1>
    <p style="font-size:18px;color:var(--dim);max-width:540px;margin-top:16px;line-height:1.7;">The application takes 2 minutes. If there's a fit, you'll hear from us within 24 hours to talk strategy.</p>
  </div>
</section>

<!-- CONTACT GRID + FORM -->
<section class="jis-contact">
  <div class="jis-c">
    <div class="jis-contact-grid">
      <div class="jis-contact-info">
        <h2>Let's Build<br>Your System.</h2>
        <p style="font-size:15px;color:var(--dim);line-height:1.7;margin-bottom:32px;">Fill out the form and we'll reach out within 24 hours to determine if JRZ Ink Systems is the right fit for your business.</p>
        <div class="jis-contact-meta">
          <div class="jis-contact-line">Phone: <a href="tel:+14077205284">(407) 720-5284</a></div>
          <div class="jis-contact-line">Email: <a href="mailto:jrzinksystems@gmail.com">jrzinksystems@gmail.com</a></div>
          <div class="jis-contact-line" style="margin-top:6px;font-size:13px;color:var(--faint);">Available nationwide — US clients only</div>
        </div>
        <div class="jis-status-box">
          <p class="jis-status-label">SYSTEM_STATUS</p>
          <p class="jis-status-text">Currently accepting new client applications. Capacity is intentionally limited — we maintain a focused client roster to ensure the quality of execution every client deserves.</p>
        </div>
        <div style="margin-top:40px;border-top:1px solid var(--border);padding-top:32px;">
          <p class="jis-status-label">WHAT_HAPPENS_NEXT</p>
          <div style="display:flex;flex-direction:column;gap:18px;margin-top:4px;">
            <div style="display:flex;gap:16px;align-items:flex-start;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--faint);min-width:28px;margin-top:2px;">01</div>
              <div style="font-size:14px;color:var(--dim);line-height:1.7;">We review your application and assess the fit for our system.</div>
            </div>
            <div style="display:flex;gap:16px;align-items:flex-start;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--faint);min-width:28px;margin-top:2px;">02</div>
              <div style="font-size:14px;color:var(--dim);line-height:1.7;">If there's a fit, we reach out within 24 hours to schedule a strategy call.</div>
            </div>
            <div style="display:flex;gap:16px;align-items:flex-start;">
              <div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--faint);min-width:28px;margin-top:2px;">03</div>
              <div style="font-size:14px;color:var(--dim);line-height:1.7;">We confirm the fit, agree on terms, and start building your system.</div>
            </div>
          </div>
        </div>
      </div>
      <div class="jis-form-frame">
        <iframe
          src="https://links.jrzmarketing.com/widget/form/3FCTNG4eH5pHYrBhrdlF"
          style="width:100%;height:712px;border:none;display:block;"
          id="inline-3FCTNG4eH5pHYrBhrdlF"
          data-layout="{'id':'INLINE'}"
          data-trigger-type="alwaysShow"
          data-form-name="jrz ink system"
          data-height="712"
          data-form-id="3FCTNG4eH5pHYrBhrdlF"
          title="jrz ink system">
        </iframe>
        <script src="https://links.jrzmarketing.com/js/form_embed.js"></script>
      </div>
    </div>
  </div>
</section>

<!-- FAQ STRIP -->
<section class="jis-sec jis-sec--sm" style="border-top:1px solid var(--border);">
  <div class="jis-c">
    <p class="jis-tag">COMMON_QUESTIONS</p>
    <h2 class="jis-h2" style="font-size:clamp(24px,3.5vw,42px);">Quick Answers</h2>
    <div style="display:flex;flex-direction:column;gap:1px;background:var(--border2);margin-top:48px;">
      ${[
        ['How long does it take to get started?','Once we confirm the fit on a strategy call, onboarding and build typically begins within a few business days. Most clients see the system live within 1–2 weeks of signing.'],
        ['Do I have to sign a long-term contract?','No long-term lock-in. Our model is performance-based — if the system isn\'t generating results, we\'re both losing. We earn your business by performing, not by trapping you in a contract.'],
        ['What kind of businesses do you work with?','Service businesses across the US — any industry where you deliver a service and get paid for it. Ideal clients have a proven offer and an average client value of $1,000 or more.'],
        ['What if my business is outside Florida?','We operate nationwide. All 50 US states. Whether you\'re local, regional, or national, we build systems for your market.'],
        ['How is the 10–15% calculated?','The percentage applies to revenue we directly generate through the system we build and manage — tracked through the CRM pipeline we set up. We agree on attribution methodology upfront.'],
      ].map(([q,a])=>`<div style="background:var(--bg);padding:32px 36px;">
        <div style="font-size:16px;font-weight:800;margin-bottom:10px;">${q}</div>
        <div style="font-size:14px;color:var(--dim);line-height:1.75;">${a}</div>
      </div>`).join('')}
    </div>
  </div>
</section>
` + jisFooterHTML();
}

// GET /sofia/jrz-ink-systems — download hub for JRZ Ink Systems website
app.get('/sofia/jrz-ink-systems', (req, res) => {
  try {
    const cacheId = crypto.randomBytes(8).toString('hex');
    websitePackageCache.set(cacheId, {
      pages: {
        home:        jisBuildHome(),
        about:       jisAbout(),
        'why-us':    jisWhyUs(),
        'our-process': jisOurProcess(),
        contact:     jisContactPage(),
      },
      clientName: 'JRZ Ink Systems',
      expires: Date.now() + 600000,
    });
    const pageList = [
      { key:'home',         label:'Home Page',   file:'index.html',       slug:'/ (root homepage)',  desc:'Hero · Problem · Solution · Case Studies · Comparison · Process · Pricing · Filter · Form' },
      { key:'about',        label:'About Us',    file:'about.html',       slug:'/about',             desc:'Origin story · Values · Who we work with · Stats' },
      { key:'why-us',       label:'Why Us',      file:'why-us.html',      slug:'/why-us',            desc:'6 reasons · Case numbers · Comparison table' },
      { key:'our-process',  label:'Our Process', file:'our-process.html', slug:'/our-process',       desc:'3-phase deep dive: Apply · Build · Deploy + Expectations' },
      { key:'contact',      label:'Contact Us',  file:'contact.html',     slug:'/contact',           desc:'GHL form · Phone & email · What happens next · FAQ' },
    ];
    const hub = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JRZ Ink Systems — Website Hub</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:system-ui,sans-serif;background:#131313;color:#fff;padding:48px 20px;}
.wrap{max-width:720px;margin:0 auto;}
.logo-row{display:flex;align-items:center;gap:12px;margin-bottom:20px;}
.logo-row svg{width:36px;height:36px;}
.logo-row span{font-size:15px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;}
.badge{display:inline-block;background:#fff;color:#131313;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:5px 14px;margin-bottom:18px;}
h1{font-size:24px;font-weight:900;margin-bottom:6px;}
.sub{font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:28px;}
.section-label{font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin:0 0 12px;}
.dl-btn{display:flex;align-items:center;justify-content:space-between;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);padding:18px 22px;text-decoration:none;color:#fff;margin-bottom:8px;transition:border-color .15s;gap:12px;}
.dl-btn:hover{border-color:rgba(255,255,255,0.4);}
.dl-left{flex:1;min-width:0;}
.dl-name{font-weight:800;font-size:15px;margin-bottom:3px;}
.dl-slug{font-size:11px;color:rgba(255,255,255,0.35);font-weight:600;margin-bottom:3px;}
.dl-desc{font-size:12px;color:rgba(255,255,255,0.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dl-tag{background:#fff;color:#131313;padding:6px 16px;font-size:11px;font-weight:800;letter-spacing:.08em;flex-shrink:0;}
.how{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);padding:18px 22px;margin-top:24px;font-size:13px;color:rgba(255,255,255,0.4);line-height:2;}
</style></head><body><div class="wrap">
<div class="logo-row"><svg viewBox="0 0 36 36" fill="none"><polygon points="18,3 33,30 3,30" fill="none" stroke="white" stroke-width="2.2"/><polygon points="18,12 27,28 9,28" fill="white"/></svg><span>JRZ INK SYSTEMS</span></div>
<div class="badge">5 Pages Ready</div>
<h1>JRZ Ink Systems</h1>
<p class="sub">The Monolith Architect · Black/White · Inter · Performance Marketing · Full Nav</p>
<div class="section-label">All 5 Pages</div>
${pageList.map(p=>`<a href="/sofia/website-download?id=${cacheId}&page=${p.key}&filename=${p.file}" class="dl-btn">
  <div class="dl-left">
    <div class="dl-name">${p.label}</div>
    <div class="dl-slug">GHL slug: ${p.slug}</div>
    <div class="dl-desc">${p.desc}</div>
  </div>
  <div class="dl-tag">↓ Download</div>
</a>`).join('')}
<div class="how">
<strong style="color:#fff;">How to upload to GHL:</strong><br>
1. Download each page file<br>
2. GHL → Sites → Websites → JRZ Ink Systems → select page<br>
3. Open page → Custom Code tab → paste full HTML → Save &amp; Publish<br>
4. Set the page slug to match the GHL slug shown above<br><br>
<em style="color:rgba(255,255,255,0.2);font-size:11px;">Links expire in 10 minutes. Refresh to regenerate.</em>
</div>
</div></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(hub);
  } catch(err) { res.status(500).send(`<pre>Error: ${err.message}</pre>`); }
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

// GET /sofia/keyword-research?industry=roofing&city=Orlando&location=2840
app.get('/sofia/keyword-research', async (req, res) => {
  const { industry, city, location } = req.query;
  if (!industry || !city) return res.status(400).json({ error: 'industry and city required' });
  try {
    const locationCode = parseInt(location) || 2840;
    const keywords = await getKeywordData(industry, city, locationCode);
    if (!keywords.length) return res.status(502).json({ error: 'No keyword data returned from DataForSEO' });
    res.json({
      primary:   keywords[0],
      top10:     keywords.slice(0, 10),
      lowComp:   keywords.filter(k => k.competition === 'LOW').slice(0, 10),
      highVol:   keywords.filter(k => k.volume >= 1000).slice(0, 10),
      longTail:  keywords.filter(k => k.keyword.split(' ').length >= 4).slice(0, 10),
      all:       keywords,
      summary:   `${keywords.length} keywords found. Top: "${keywords[0].keyword}" (${keywords[0].volume?.toLocaleString()||'?'}/mo)`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
// Responds immediately — blog generation runs in background (60-90s per client)
app.post('/cron/client-blogs', (_req, res) => {
  res.json({ status: 'started', message: 'Blogs running in background — check GET /status for results' });
  runAllClientsDailyBlog()
    .then(r => logCron('client-blogs', 'ok', r))
    .catch(e => { logCron('client-blogs', 'error', e.message); console.error('[Client SEO] All blogs error:', e.message); });
});

// Manual trigger: POST /cron/client-blog/:locationId — run blog for one specific client
// Example: GET or POST /cron/client-blog/iipUT8kmVxJZzGBzvkZm (Railing Max)
// Responds immediately — Claude Opus takes 60-90s, would 502 if awaited on Render free plan
app.get('/cron/client-blog/:locationId', (req, res) => {
  const { locationId } = req.params;
  const config = SEO_CLIENTS[locationId];
  if (!config) return res.status(404).json({ error: `No SEO_CLIENTS entry for locationId: ${locationId}` });
  const jobKey = `blog-${config.name}`;
  res.json({ status: 'started', job: jobKey, name: config.name, note: 'Check GET /status in ~60s' });
  runCron(jobKey, () => runClientDailySeoBlog(locationId, config), true);
});
app.post('/cron/client-blog/:locationId', (req, res) => {
  const { locationId } = req.params;
  const config = SEO_CLIENTS[locationId];
  if (!config) return res.status(404).json({ error: `No SEO_CLIENTS entry for locationId: ${locationId}` });
  const jobKey = `blog-${config.name}`;
  res.json({ status: 'started', job: jobKey, name: config.name, note: 'Check GET /status in ~60s' });
  runCron(jobKey, () => runClientDailySeoBlog(locationId, config), true);
});

// GET /sofia/content-learning/status — show blog history + next recommended keyword per client
app.get('/sofia/content-learning/status', async (_req, res) => {
  try {
    const history = await loadBlogHistory();
    const status = {};
    for (const [locationId, config] of Object.entries(SEO_CLIENTS)) {
      const clientHistory = history[locationId] || [];
      status[config.name] = {
        totalPosts: clientHistory.length,
        lastPost: clientHistory.slice(-1)[0] || null,
        nextKeyword: await getBestNextKeyword(locationId, config, clientHistory),
        recentKeywords: clientHistory.slice(-5).map(p => p.keyword),
      };
    }
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /cron/content-learning — generate learning report + email Jose
app.post('/cron/content-learning', async (_req, res) => {
  try {
    const result = await runSofiaContentLearning();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /cron/rank-tracking — run weekly rank check now
app.post('/cron/rank-tracking', (_req, res) => {
  res.json({ status: 'started', message: 'Rank tracking running — check GET /status for results' });
  runWeeklyRankTracking()
    .then(r => logCron('rank-tracking', 'ok', r))
    .catch(e => { logCron('rank-tracking', 'error', e.message); console.error('[Rank Tracking] Manual error:', e.message); });
});

// POST /cron/rank-improvement — manually trigger the page-2 improvement loop
app.post('/cron/rank-improvement', (_req, res) => {
  res.json({ status: 'started', message: 'Rank improvement loop running — rewrites page-2 posts' });
  runSofiaRankImprovementLoop()
    .then(r => logCron('rank-improvement', 'ok', r))
    .catch(e => { logCron('rank-improvement', 'error', e.message); console.error('[Rank Improvement] Manual error:', e.message); });
});

// POST /cron/gbp-posts — trigger GBP posting now for all connected clients
app.post('/cron/gbp-posts', async (_req, res) => {
  try {
    const results = await runDailyGBPPosts();
    res.json({ status: 'done', posted: results.length, results });
  } catch (e) {
    res.json({ status: 'error', error: e.message });
  }
});

// POST /cron/backlink-check — run backlink monitoring now
app.post('/cron/backlink-check', (_req, res) => {
  res.json({ status: 'started', message: 'Backlink check running — check GET /status for results' });
  runWeeklyBacklinkCheck()
    .then(r => logCron('backlink-check', 'ok', r))
    .catch(e => { logCron('backlink-check', 'error', e.message); console.error('[Backlinks] Manual error:', e.message); });
});

// POST /cron/link-prospecting — run backlink prospecting now (mines competitor links, sends pitches)
app.post('/cron/link-prospecting', (_req, res) => {
  res.json({ status: 'started', message: 'Link prospecting running — check GET /status + your email for report' });
  runBacklinkProspecting()
    .then(r => logCron('link-prospecting', 'ok', r))
    .catch(e => { logCron('link-prospecting', 'error', e.message); console.error('[LinkBuild] Manual error:', e.message); });
});

// GET /cron/link-prospects/status — show full prospect history
app.get('/cron/link-prospects/status', async (_req, res) => {
  try {
    const r = await axios.get(LINK_PROSPECTS_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    const snap = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const totalContacted = Object.values(snap.contacted || {}).reduce((s, arr) => s + arr.length, 0);
    res.json({
      lastRun: snap.lastRun || 'never',
      totalOutreach: totalContacted,
      recentPitches: (snap.history || []).slice(-20),
      contactedByClient: Object.fromEntries(Object.entries(snap.contacted || {}).map(([d, arr]) => [d, arr.length]))
    });
  } catch (e) { res.json({ lastRun: 'never', totalOutreach: 0, recentPitches: [], error: e.message }); }
});

// GET or POST /cron/railing-city-pages — run next batch of Railing Max city pages
function triggerRailingPages(req, res) {
  const batchSize = parseInt(req.query.batch) || 50;
  res.json({ status: 'started', job: 'railing-city-pages', batchSize, note: 'Check GET /status or /cron/railing-city-pages/status in ~5 min' });
  runCron('railing-city-pages', () => runRailingMaxCityPagesBatch(batchSize), true);
}
app.get('/cron/railing-city-pages', triggerRailingPages);
app.post('/cron/railing-city-pages', triggerRailingPages);

// GET /cron/railing-city-pages/status — show progress
app.get('/cron/railing-city-pages/status', async (_req, res) => {
  let snap, snapError, rawPreview, statusCode;
  try {
    const r = await axios.get(CITY_PAGES_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    statusCode = r.status;
    rawPreview = JSON.stringify(r.data).slice(0, 120);
    snap = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || { published: [] });
  } catch (e) { snapError = e.message; snap = { published: [] }; }
  res.json({ published: (snap.published || []).length, total: RAILING_MAX_SERVICES.length * RAILING_MAX_CITIES.length, remaining: RAILING_MAX_SERVICES.length * RAILING_MAX_CITIES.length - (snap.published || []).length, lastPages: (snap.published || []).slice(-10), debug: snapError || null, statusCode, rawPreview });
});

// GET or POST /cron/cooney-city-pages — run next batch of Cooney Homes city pages
function triggerCooneyPages(req, res) {
  const batchSize = parseInt(req.query.batch) || 50;
  res.json({ status: 'started', job: 'cooney-city-pages', batchSize, note: 'Check GET /status or /cron/cooney-city-pages/status in ~5 min' });
  runCron('cooney-city-pages', () => runCooneyHomesCityPagesBatch(batchSize), true);
}
app.get('/cron/cooney-city-pages', triggerCooneyPages);
app.post('/cron/cooney-city-pages', triggerCooneyPages);

// GET /cron/cooney-city-pages/status — show progress
app.get('/cron/cooney-city-pages/status', async (_req, res) => {
  const snap = await loadCooneyPagesSnapshot().catch(() => ({ published: [] }));
  res.json({ published: snap.published.length, total: COONEY_SERVICES.length * COONEY_CITIES.length, remaining: COONEY_SERVICES.length * COONEY_CITIES.length - snap.published.length, lastPages: snap.published.slice(-10) });
});

// GET /cron/railing-city-pages/test — test one page and return result or error
app.get('/cron/railing-city-pages/test', async (_req, res) => {
  try {
    const result = await runRailingMaxCityPage(RAILING_MAX_SERVICES[0], RAILING_MAX_CITIES[0]);
    const snap = await loadCityPagesSnapshot();
    snap.published.push(`floating-stairs-orlando-fl`);
    await saveCloudinaryJSON(CITY_PAGES_PID, snap);
    res.json({ success: true, result });
  } catch (e) { res.json({ success: false, error: e.message, stack: e.stack?.split('\n').slice(0,5) }); }
});

// GET /cron/cooney-city-pages/test — test one page and return result or error
app.get('/cron/cooney-city-pages/test', async (_req, res) => {
  try {
    const result = await runCooneyHomeCityPage(COONEY_SERVICES[0], COONEY_CITIES[0]);
    const snap = await loadCooneyPagesSnapshot();
    snap.published.push(`custom-home-builder-orlando-fl`);
    await saveCloudinaryJSON(COONEY_CITY_PAGES_PID, snap);
    res.json({ success: true, result });
  } catch (e) { res.json({ success: false, error: e.message, stack: e.stack?.split('\n').slice(0,5) }); }
});

// Debug: GET /sofia/blogs/:locationId — check what blogs API returns for a sub-account
app.get('/sofia/blogs/:locationId', async (req, res) => {
  const { locationId } = req.params;
  const config = SEO_CLIENTS[locationId];
  const hardcodedKeys = { 'iipUT8kmVxJZzGBzvkZm': RAILING_MAX_API_KEY, 'Gc4sUcLiRI2edddJ5Lfl': COONEY_API_KEY };
  const token = config?.apiKey || hardcodedKeys[locationId];
  if (!token) return res.json({ error: 'No apiKey for this locationId in SEO_CLIENTS' });
  try {
    const r1 = await axios.get(`https://services.leadconnectorhq.com/blogs/site/all?locationId=${locationId}&skip=0&limit=10`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
    ).catch(e => ({ error: e?.response?.data || e.message }));
    res.json({ blogsEndpoint: r1?.data || r1?.error });
  } catch (err) {
    res.json({ error: err?.response?.data || err.message });
  }
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
let lastRankTrackingDate    = null;
let lastBacklinkCheckDate   = null;
let lastStandupDate           = null;
let lastLinkProspectingDate   = null;
let lastGBPPostDate           = null;

// ─── GOOGLE BUSINESS PROFILE AUTO-POSTING ────────────────────────────────────
// Runs daily at 9:00am — fetches connected Google accounts per client,
// generates a location-specific GBP post with Claude Haiku, publishes via GHL.

async function runDailyGBPPosts() {
  console.log('[GBP] Starting daily Google Business Profile posts...');
  const results = [];

  const gbpClients = Object.entries(SEO_CLIENTS).filter(([, c]) => c.blogEnabled !== false && c.gbpEnabled !== false);

  for (const [locationId, config] of gbpClients) {
    const { name, industry, voice, author } = config;
    const token = config.apiKey;
    if (!token) continue;

    try {
      // Fetch connected Google accounts for this sub-account
      const accountsRes = await axios.get(
        `https://services.leadconnectorhq.com/social-media-posting/${locationId}/accounts`,
        { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
      );
      const googleAccounts = (accountsRes.data?.results?.accounts || [])
        .filter(a => a.platform === 'google' && !a.isExpired && !a.deleted);

      if (!googleAccounts.length) {
        console.log(`[GBP] No Google accounts connected for ${name} — skipping`);
        continue;
      }

      console.log(`[GBP] ${name}: ${googleAccounts.length} GBP location(s) found`);

      // Rotate post type by day of week
      const dayIdx = new Date().getDay();
      const postType = GBP_POST_TYPES[dayIdx % GBP_POST_TYPES.length];

      // Generate post for each connected GBP location
      for (const account of googleAccounts) {
        const locationName = account.name || name;

        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: `Write a Google Business Profile "${postType}" post for ${locationName} — a ${industry} in Central Florida.

AUTHOR: ${author?.name || name}, ${author?.title || ''}
BRAND VOICE: ${voice || 'Helpful, local, and direct.'}
POST TYPE: ${postType === 'WHATS_NEW' ? "What's New (share an update, tip, or reason to visit)" : postType === 'OFFER' ? 'Special Offer (limited time deal or promotion)' : 'Event (upcoming event or special occasion)'}

RULES:
- 150–280 characters total
- Mention a specific service, dish, or benefit
- End with a clear action ("Call us", "Book online", "Order now", "Visit us today")
- Sound like a real local business owner wrote it — no corporate speak
- NO hashtags, NO emojis unless naturally fitting

Return ONLY the post text, nothing else.` }]
        });

        const postText = msg.content[0].text.trim();

        // Publish via GHL Social Posting API — withRetry handles transient GHL errors
        const postNow = new Date();
        await withRetry(() => axios.post(
          `https://services.leadconnectorhq.com/social-media-posting/${locationId}/posts`,
          {
            accountIds: [account.id],
            summary: postText,
            type: 'post',
            userId: GHL_USER_ID,
            status: 'scheduled',
            scheduleDate: postNow.toISOString(),
            scheduleTimeUpdated: true,
            media: [],
          },
          { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, timeout: 15000 }
        ));

        console.log(`[GBP] ✅ Posted to ${locationName} GBP: "${postText.slice(0, 60)}..."`);
        results.push({ client: name, location: locationName, text: postText });
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`[GBP] ❌ ${name}:`, e.message);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`[GBP] Done — ${results.length} GBP posts published`);
  return results;
}

// ─── /health — instant deploy verification ────────────────────────────────────
app.get('/health', (_req, res) => {
  const errors = Object.values(CRON_STATUS).filter(s => s.status === 'error').length;
  res.json({
    status: 'ok',
    buildHash: BUILD_HASH,
    startedAt: SERVER_START_TIME,
    uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
    cronJobs: Object.keys(CRON_STATUS).length,
    errors,
  });
});

// ─── /status — live cron dashboard ───────────────────────────────────────────
app.get('/status', (_req, res) => {
  const jobs = Object.entries(CRON_STATUS).sort((a, b) => a[0].localeCompare(b[0]));
  const rows = jobs.map(([name, s]) => {
    const icon = s.status === 'ok' ? '✅' : s.status === 'error' ? '❌' : '⏳';
    const mins = s.lastRun ? Math.round((Date.now() - new Date(s.lastRun)) / 60000) : null;
    const age  = mins === null ? 'never' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    const color = s.status === 'error' ? '#e74c3c' : '#2ecc71';
    return `<tr>
      <td>${icon} <strong>${name}</strong></td>
      <td style="color:#aaa">${age}</td>
      <td style="color:${color}">${s.status}</td>
      <td style="font-size:12px;color:#888;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(s.detail||'').replace(/"/g,"'")}">${s.detail || ''}</td>
    </tr>`;
  }).join('');

  const errorCount = jobs.filter(([,s]) => s.status === 'error').length;
  const okCount    = jobs.filter(([,s]) => s.status === 'ok').length;
  const upStr = `${Math.floor(process.uptime()/3600)}h ${Math.floor((process.uptime()%3600)/60)}m`;

  res.set('Content-Type', 'text/html').send(`<!DOCTYPE html><html><head>
<title>Armando Bot — Status</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Courier New',monospace;background:#0a0a0a;color:#ddd;padding:24px}
  h1{color:#fff;font-size:22px;margin-bottom:4px}
  .meta{color:#555;font-size:13px;margin-bottom:20px}
  .stats{display:flex;gap:16px;margin-bottom:24px}
  .stat{background:#111;border:1px solid #222;padding:12px 20px;border-radius:8px;text-align:center}
  .stat .n{font-size:28px;font-weight:bold;color:#fff}
  .stat .l{font-size:11px;color:#666;text-transform:uppercase;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:8px 14px;background:#111;color:#555;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1a1a1a}
  td{padding:9px 14px;border-bottom:1px solid #141414;font-size:13px}
  tr:hover td{background:#0f0f0f}
  .empty{padding:32px;text-align:center;color:#333}
</style></head><body>
<h1>🤖 Armando Bot</h1>
<p class="meta">Build: <strong>${BUILD_HASH}</strong> &nbsp;|&nbsp; Up: <strong>${upStr}</strong> &nbsp;|&nbsp; ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} EST</p>
<div class="stats">
  <div class="stat"><div class="n">${jobs.length}</div><div class="l">Total Jobs</div></div>
  <div class="stat"><div class="n" style="color:#2ecc71">${okCount}</div><div class="l">OK</div></div>
  <div class="stat"><div class="n" style="color:#e74c3c">${errorCount}</div><div class="l">Errors</div></div>
  <div class="stat"><div class="n" style="color:#f39c12">${jobs.length - okCount - errorCount}</div><div class="l">Pending</div></div>
</div>
<table><thead><tr><th>Job</th><th>Last Run</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4" class="empty">No jobs have run yet — cron fires at scheduled times EST.</td></tr>'}</tbody></table>
</body></html>`);
});

// ─── /dashboard — JRZ Marketing client dashboard ─────────────────────────────
app.get('/dashboard', (_req, res) => {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const upStr = `${Math.floor(process.uptime()/3600)}h ${Math.floor((process.uptime()%3600)/60)}m`;

  // DM stats from in-memory trackers
  const totalDMs     = repliedMessageIds.size;
  const uniqueLeads  = contactMessageCount.size;
  const hotLeads     = alertEmailSent.size;
  const qualified    = leadScoreAlertSent.size;

  // Cron health summary
  const cronJobs  = Object.entries(CRON_STATUS);
  const cronOk    = cronJobs.filter(([,s]) => s.status === 'ok').length;
  const cronErr   = cronJobs.filter(([,s]) => s.status === 'error').length;

  // Key cron rows to show on dashboard
  const KEY_CRONS = ['daily-post','daily-story','daily-seo-blog','gbp-posts','diego-standup','weekly-analysis'];
  const cronRows = KEY_CRONS.map(name => {
    const s = CRON_STATUS[name];
    if (!s) return `<tr><td>${name}</td><td style="color:#555">never run</td><td style="color:#555">—</td></tr>`;
    const mins = s.lastRun ? Math.round((Date.now() - new Date(s.lastRun)) / 60000) : null;
    const age  = mins === null ? 'never' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    const dot  = s.status === 'ok' ? '#2ecc71' : s.status === 'error' ? '#e74c3c' : '#f39c12';
    return `<tr>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:8px"></span>${name}</td>
      <td style="color:#aaa">${age}</td>
      <td style="color:${dot};font-size:12px">${s.detail ? s.detail.slice(0,80) : s.status}</td>
    </tr>`;
  }).join('');

  res.set('Content-Type', 'text/html').send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JRZ Marketing — Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#e0e0e0;padding:0}
header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 32px;border-bottom:3px solid #e94560;display:flex;align-items:center;justify-content:space-between}
header h1{color:#fff;font-size:1.4rem;font-weight:700}header h1 span{color:#e94560}
.meta{color:#666;font-size:12px;margin-top:4px}
.now{color:#4ecca3;font-size:13px;background:rgba(78,204,163,0.1);padding:4px 12px;border-radius:20px;border:1px solid #4ecca3}
.main{padding:28px 32px;max-width:1100px;margin:0 auto}
.section-title{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;margin-top:28px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:8px}
.kpi{background:#111;border:1px solid #1e1e1e;border-radius:12px;padding:20px;text-align:center}
.kpi .num{font-size:2.4rem;font-weight:800;line-height:1}
.kpi .lbl{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-top:6px}
.kpi.blue .num{color:#4ecca3}
.kpi.red .num{color:#e94560}
.kpi.orange .num{color:#f39c12}
.kpi.green .num{color:#2ecc71}
table{width:100%;border-collapse:collapse;background:#111;border-radius:10px;overflow:hidden;border:1px solid #1e1e1e}
th{text-align:left;padding:10px 16px;background:#0f0f0f;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px}
td{padding:10px 16px;border-bottom:1px solid #161616;font-size:13px}
tr:last-child td{border-bottom:none}
tr:hover td{background:#0f0f0f}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge.ok{background:rgba(46,204,113,0.15);color:#2ecc71}
.badge.err{background:rgba(231,76,60,0.15);color:#e74c3c}
.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}
.link{color:#4ecca3;text-decoration:none;font-size:13px;padding:6px 16px;border:1px solid #4ecca3;border-radius:20px}
.link:hover{background:rgba(78,204,163,0.1)}
footer{padding:20px 32px;color:#333;font-size:12px;border-top:1px solid #1a1a1a;margin-top:32px}
</style></head><body>
<header>
  <div><h1>JRZ Marketing <span>·</span> AI Dashboard</h1><div class="meta">Build: ${BUILD_HASH} &nbsp;·&nbsp; Up: ${upStr}</div></div>
  <div class="now">${now} EST</div>
</header>
<div class="main">

  <div class="section-title">DM Bot — Since Last Deploy</div>
  <div class="kpi-grid">
    <div class="kpi blue"><div class="num">${totalDMs}</div><div class="lbl">DMs Handled</div></div>
    <div class="kpi"><div class="num">${uniqueLeads}</div><div class="lbl">Unique Leads</div></div>
    <div class="kpi orange"><div class="num">${hotLeads}</div><div class="lbl">Hot Leads Alerted</div></div>
    <div class="kpi red"><div class="num">${qualified}</div><div class="lbl">Score ≥ 8 Alerts</div></div>
  </div>

  <div class="section-title">System Health</div>
  <div class="kpi-grid">
    <div class="kpi green"><div class="num">${cronOk}</div><div class="lbl">Crons OK</div></div>
    <div class="kpi ${cronErr > 0 ? 'red' : 'green'}"><div class="num">${cronErr}</div><div class="lbl">Cron Errors</div></div>
    <div class="kpi"><div class="num">${cronJobs.length}</div><div class="lbl">Total Jobs</div></div>
  </div>

  <div class="section-title">Key Automations</div>
  <table>
    <thead><tr><th>Job</th><th>Last Run</th><th>Status / Detail</th></tr></thead>
    <tbody>${cronRows}</tbody>
  </table>

  <div class="links">
    <a class="link" href="/status">Full Cron Status</a>
    <a class="link" href="/health">Health JSON</a>
    <a class="link" href="/social/status">Social Status</a>
    <a class="link" href="/office">AI Office</a>
  </div>
</div>
<footer>JRZ Marketing · Armando Bot · Orlando, FL</footer>
</body></html>`);
});

// ─── /client/:locationId — Live client portal ────────────────────────────────
// Auth: ?key=<apiKey> must match the client's GHL API key
// Shows: recent posts, DM bot status, upcoming scheduled posts
app.get('/client/:locationId', async (req, res) => {
  const { locationId } = req.params;
  const { key } = req.query;

  if (!key) {
    return res.status(401).set('Content-Type', 'text/html').send(`
      <html><body style="font-family:sans-serif;background:#0d0d0d;color:#e0e0e0;padding:40px;text-align:center">
        <h2 style="color:#e94560">Access Denied</h2>
        <p>Add your API key: <code>/client/${locationId}?key=YOUR_API_KEY</code></p>
      </body></html>`);
  }

  try {
    const headers = { Authorization: `Bearer ${key}`, Version: '2021-07-28' };

    // Fetch location info + recent posts in parallel
    const [locationRes, postsRes] = await Promise.all([
      axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, { headers, timeout: 10000 }).catch(() => null),
      axios.get(`https://services.leadconnectorhq.com/social-media-posting/${locationId}/posts`, {
        params: { skip: 0, limit: 10, status: 'published' }, headers, timeout: 10000,
      }).catch(() => null),
    ]);

    if (!locationRes) {
      return res.status(403).set('Content-Type', 'text/html').send(`
        <html><body style="font-family:sans-serif;background:#0d0d0d;color:#e0e0e0;padding:40px;text-align:center">
          <h2 style="color:#e94560">Invalid credentials</h2>
          <p>Check your locationId and API key.</p>
        </body></html>`);
    }

    const location = locationRes.data?.location || locationRes.data || {};
    const posts    = postsRes?.data?.posts || postsRes?.data?.data || [];

    // Check if this location has a persona bot active
    const persona   = getPersona(locationId);
    const botStatus = persona ? `Active — ${persona.name} is handling DMs` : 'Not activated yet';
    const botColor  = persona ? '#2ecc71' : '#f39c12';

    const postRows = posts.slice(0, 8).map(p => {
      const date    = p.publishedAt || p.scheduledAt || p.createdAt || '';
      const caption = (p.caption || p.description || '').slice(0, 120);
      const e       = p.engagement || p.analytics || {};
      const eng     = [
        e.likes || e.likeCount ? `❤️ ${e.likes || e.likeCount}` : '',
        e.comments || e.commentCount ? `💬 ${e.comments || e.commentCount}` : '',
        e.shares || e.shareCount ? `🔄 ${e.shares || e.shareCount}` : '',
      ].filter(Boolean).join('  ') || '—';
      const dateStr = date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      return `<tr>
        <td style="color:#aaa;font-size:12px;white-space:nowrap">${dateStr}</td>
        <td style="font-size:13px">${caption}${caption.length >= 120 ? '…' : ''}</td>
        <td style="font-size:12px;white-space:nowrap">${eng}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="3" style="color:#555;padding:20px;text-align:center">No published posts yet</td></tr>`;

    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    res.set('Content-Type', 'text/html').send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${location.name || locationId} — Client Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d0d;color:#e0e0e0}
header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 32px;border-bottom:3px solid #e94560;display:flex;align-items:center;justify-content:space-between}
header h1{color:#fff;font-size:1.3rem;font-weight:700}
.sub{color:#aaa;font-size:12px;margin-top:3px}
.now{color:#4ecca3;font-size:12px;padding:4px 12px;border:1px solid #4ecca3;border-radius:20px}
.main{padding:28px 32px;max-width:960px;margin:0 auto}
.section-title{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;margin-top:28px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.kpi{background:#111;border:1px solid #1e1e1e;border-radius:12px;padding:20px;text-align:center}
.kpi .num{font-size:2rem;font-weight:800}
.kpi .lbl{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-top:6px}
.bot-status{background:#111;border:1px solid #1e1e1e;border-radius:12px;padding:16px 20px;margin-top:16px;display:flex;align-items:center;gap:12px}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
table{width:100%;border-collapse:collapse;background:#111;border-radius:10px;overflow:hidden;border:1px solid #1e1e1e;margin-top:0}
th{text-align:left;padding:10px 16px;background:#0f0f0f;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px}
td{padding:9px 16px;border-bottom:1px solid #161616;vertical-align:top}
tr:last-child td{border-bottom:none}
footer{padding:20px 32px;color:#333;font-size:12px;border-top:1px solid #1a1a1a;margin-top:32px}
</style></head><body>
<header>
  <div>
    <h1>${location.name || 'Client Portal'}</h1>
    <div class="sub">Powered by JRZ Marketing · Orlando, FL</div>
  </div>
  <div class="now">${now} EST</div>
</header>
<div class="main">

  <div class="section-title">Automation Status</div>
  <div class="bot-status">
    <div class="dot" style="background:${botColor}"></div>
    <div>
      <strong style="font-size:14px">DM Bot:</strong>
      <span style="color:${botColor};margin-left:8px">${botStatus}</span>
    </div>
  </div>

  <div class="section-title" style="margin-top:24px">Recent Posts</div>
  <table>
    <thead><tr><th>Date</th><th>Caption</th><th>Engagement</th></tr></thead>
    <tbody>${postRows}</tbody>
  </table>

</div>
<footer>JRZ Marketing · jrzmarketing.com · info@jrzmarketing.com</footer>
</body></html>`);

  } catch (err) {
    console.error('[ClientPortal] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

setInterval(async () => {
  try {
    const nowEST      = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today       = nowEST.toISOString().split('T')[0];
    const hour        = nowEST.getHours();
    const minute      = nowEST.getMinutes();
    const dayOfWeek   = nowEST.getDay();
    const isWeekday   = dayOfWeek >= 1 && dayOfWeek <= 5;
    const dateOfMonth = nowEST.getDate();

    // 9:00am Mon–Fri — Google Business Profile posts
    if (hour === 9 && minute >= 0 && minute < 5 && isWeekday && lastGBPPostDate !== today) {
      lastGBPPostDate = today;
      runCron('gbp-posts', runDailyGBPPosts, true);
    }

    // 6:50am daily — AI team standup
    if (hour === 6 && minute >= 50 && minute < 55 && lastStandupDate !== today) {
      lastStandupDate = today;
      runCron('standup', runDailyTeamStandup, true);
    }

    // 7:00am daily — carousel + blog
    if (hour === 7 && minute < 5 && lastPostDate !== today) {
      lastPostDate = today;
      await runCron('daily-post', runDailyPost);
    }

    // 7:05am daily — SEO blog (striking-distance keywords)
    if (hour === 7 && minute >= 5 && minute < 10 && lastSeoBlogDate !== today) {
      lastSeoBlogDate = today;
      runCron('seo-blog', runDailySeoBlog, true);
    }

    // 7:08am daily — all SEO clients: one blog post each
    if (hour === 7 && minute >= 8 && minute < 13 && lastClientBlogDate !== today) {
      lastClientBlogDate = today;
      runCron('client-blogs', runAllClientsDailyBlog, true);
    }


    // 7:10am Monday — weekly analytics + A/B test + summary email
    if (hour === 7 && minute >= 10 && minute < 15 && dayOfWeek === 1 && lastSummaryDate !== today) {
      lastSummaryDate = today;
      await runCron('weekly-summary', async () => {
        await runWeeklyAnalysis();
        await runABTestAnalysis();
        const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const weekPosts = CAROUSEL_SCRIPTS.slice(0, 7).map((s, i) => ({ day: days[i], title: s.title, success: true }));
        await sendWeeklySummaryEmail(weekPosts);
      });
    }

    // 8:00am Mon–Fri — Diego standup
    if (hour === 8 && minute < 5 && isWeekday && lastDiegoStandupDate !== today) {
      lastDiegoStandupDate = today;
      runCron('diego-standup', runDiegoStandup, true);
    }

    // 8:05am Monday — Meta Ads weekly monitor
    if (hour === 8 && minute === 5 && dayOfWeek === 1) { runMetaAdsMonitor(); }

    // 8:00am Monday — competitor monitoring
    if (hour === 8 && minute < 5 && dayOfWeek === 1 && lastCompetitorDate !== today) {
      lastCompetitorDate = today;
      await runCron('competitor-monitoring', runCompetitorMonitoring);
    }

    // 8:30am Monday — engagement learning + voice patterns + review mining
    if (hour === 8 && minute >= 30 && minute < 35 && dayOfWeek === 1 && lastLearningDate !== today) {
      lastLearningDate = today;
      await runCron('engagement-learning', async () => {
        await runEngagementLearning();
        await updateWinningVoicePatterns();
        await runReviewMining();
        await runObjectionLearning();
        await runSelfUpdateRules();
      });
    }

    // 8:35am Monday — Elena health check
    if (hour === 8 && minute >= 35 && minute < 40 && dayOfWeek === 1 && lastElenaHealthDate !== today) {
      lastElenaHealthDate = today;
      runCron('elena-health', elenaHealthCheck, true);
    }

    // 9:00am Monday — Apollo email enrichment
    if (hour === 9 && minute < 5 && dayOfWeek === 1 && lastEnrichDate !== today) {
      lastEnrichDate = today;
      await runCron('enrich-prospects', enrichProspectEmails);
    }

    // 9:05am Monday — rank tracking
    if (hour === 9 && minute >= 5 && minute < 10 && dayOfWeek === 1 && lastRankTrackingDate !== today) {
      lastRankTrackingDate = today;
      runCron('rank-tracking', runWeeklyRankTracking, true);
    }

    // 9:10am Monday — backlink monitoring
    if (hour === 9 && minute >= 10 && minute < 15 && dayOfWeek === 1 && lastBacklinkCheckDate !== today) {
      lastBacklinkCheckDate = today;
      runCron('backlink-check', runWeeklyBacklinkCheck, true);
    }

    // 9:15am Monday — Diego weekly report
    if (hour === 9 && minute >= 15 && minute < 20 && dayOfWeek === 1 && lastDiegoReportDate !== today) {
      lastDiegoReportDate = today;
      runCron('diego-weekly-report', runDiegoWeeklyReport, true);
    }

    // 9:20am Monday — backlink prospecting
    if (hour === 9 && minute >= 20 && minute < 25 && dayOfWeek === 1 && lastLinkProspectingDate !== today) {
      lastLinkProspectingDate = today;
      runCron('link-prospecting', runBacklinkProspecting, true);
    }

    // 9:30am Monday — Marco content brief
    if (hour === 9 && minute >= 30 && minute < 35 && dayOfWeek === 1 && lastMarcoContentDate !== today) {
      lastMarcoContentDate = today;
      runCron('marco-content-brief', runMarcoContentBrief, true);
    }

    // 9:40am Monday — Sofia keyword tracker
    if (hour === 9 && minute >= 40 && minute < 45 && dayOfWeek === 1 && lastKeywordTrackerDate !== today) {
      lastKeywordTrackerDate = today;
      runCron('keyword-tracker', runSofiaKeywordTracker, true);
    }

    // 9:45am Monday — Sofia weekly check + onboarding
    if (hour === 9 && minute >= 45 && minute < 50 && dayOfWeek === 1 && lastSofiaCheckDate !== today) {
      lastSofiaCheckDate = today;
      runCron('sofia-weekly-check',   runSofiaWeeklyCheck,    true);
      runCron('sofia-onboarding',     runSofiaOnboardingCheck, true);
    }

    // 9:50am Monday — Sofia weekly SEO plan
    if (hour === 9 && minute >= 50 && minute < 55 && dayOfWeek === 1 && lastWeeklySEODate !== today) {
      lastWeeklySEODate = today;
      runCron('weekly-seo-plan', runSofiaWeeklySEOPlan, true);
    }

    // Every 6 hours (0/6/12/18) — Sofia uptime monitor
    const sixHourSlot = Math.floor(hour / 6);
    if (minute < 3 && sixHourSlot !== lastSofiaMonitorHour) {
      lastSofiaMonitorHour = sixHourSlot;
      runCron('uptime-monitor', runSofiaUptimeMonitor, true);
    }

    // 1st of month, 9:55am — Sofia CRO report
    if (hour === 9 && minute >= 55 && dateOfMonth === 1 && lastSofiaCRODate !== today) {
      lastSofiaCRODate = today;
      runCron('sofia-cro-report', runSofiaCROReport, true);
    }

    // 1st of month, 9:00am — monthly reports + Elena + Diego scorecard + SEO progress
    if (hour === 9 && minute < 5 && dateOfMonth === 1 && lastMonthlyReportDate !== today) {
      lastMonthlyReportDate = today;
      await runCron('monthly-reports', async () => {
        await sendMonthlyClientReports();
        elenaMonthlyReports();
        runDiegoScorecard();
        (async () => {
          const clients = await getElenaClients();
          for (const client of clients) {
            const bl  = await runSofiaBacklinkAudit(client.website?.replace(/^https?:\/\//, '') || '').catch(() => null);
            const cit = await runSofiaCitationAudit(client.name).catch(() => null);
            const seoConfig = SEO_CLIENTS[client.locationId] || {};
            const ga4 = seoConfig.ga4PropertyId ? await getGA4Data(seoConfig.ga4PropertyId).catch(() => null) : null;
            await sendClientSEOProgressReport(client, { keyword: 'your top local keyword', position: null, blogsThisMonth: 4, backlinks: bl, citations: cit, competitorGaps: [], ga4 });
            await new Promise(r => setTimeout(r, 3000));
          }
        })();
      });
    }

    // 15th of month, 10:00am — Elena mid-month check-in
    if (hour === 10 && minute < 5 && dateOfMonth === 15 && lastMidMonthCheckIn !== today) {
      lastMidMonthCheckIn = today;
      runCron('elena-midmonth', elenaMidMonthCheckIn, true);
    }

    // 1st of Jan/Apr/Jul/Oct, 9:30am — Elena quarterly report
    const isQuarterStart = [1, 4, 7, 10].includes(nowEST.getMonth() + 1) && dateOfMonth === 1;
    if (hour === 9 && minute >= 30 && minute < 35 && isQuarterStart && lastQuarterlyReport !== today) {
      lastQuarterlyReport = today;
      runCron('elena-quarterly', elenaQuarterlyReport, true);
    }

    // Last Friday of month, 10:00am — sub-account check-in emails
    const isFriday    = dayOfWeek === 5;
    const isLastFriday = isFriday && (dateOfMonth + 7 > new Date(nowEST.getFullYear(), nowEST.getMonth() + 1, 0).getDate());
    if (hour === 10 && minute < 5 && isLastFriday && lastSubCheckInDate !== today) {
      lastSubCheckInDate = today;
      await runCron('subaccount-checkin', sendSubAccountCheckInEmails);
    }

    // 10:00am Wednesday — Marco trend alert
    if (hour === 10 && minute < 5 && dayOfWeek === 3 && lastMarcoTrendDate !== today) {
      lastMarcoTrendDate = today;
      runCron('marco-trend-alert', runMarcoTrendAlert, true);
    }

    // 10:00am Mon–Fri — outbound prospecting
    if (hour === 10 && minute < 5 && isWeekday && lastOutboundDate !== today) {
      lastOutboundDate = today;
      await runCron('daily-outbound', runDailyOutbound);
    }

    // 10:30am daily — client check-ins
    if (hour === 10 && minute >= 30 && minute < 35 && lastCheckInDate !== today) {
      lastCheckInDate = today;
      await runCron('client-checkins', runClientCheckIns);
    }

    // 6:30pm daily — story
    if (hour === 18 && minute >= 30 && minute < 35 && lastStoryDate !== today) {
      lastStoryDate = today;
      await runCron('daily-story', runDailyStory);
    }

    // Every 2 min — Gmail inbox check
    await runCron('gmail-check', runGmailCheck);

  } catch (err) {
    console.error('[Cron] Internal scheduler error:', err.message);
    logCron('_scheduler', 'error', err.message);
  }
}, 2 * 60 * 1000); // Every 2 minutes

// ═══════════════════════════════════════════════════════════
// AUTHOR PAGES — branded bio pages for each client's blogger
// ═══════════════════════════════════════════════════════════

const AUTHOR_SLUGS = {
  'railing-max':        'iipUT8kmVxJZzGBzvkZm',
  'escobar-kitchen':    'rJKRuyayc6Z6twr9X20v',
  'rental-spaces':      '6FdG0APBuZ81P8X2H4zc',
  'guaca-mole':         'Emg5M7GZE7XmnHc7F5vy',
  'jrz-marketing':      'd7iUPfamAaPlSBNj6IhT',
  'cooney-homes':       'Gc4sUcLiRI2edddJ5Lfl',
  'le-varon':           'OpdBPAp31zItOc5IIykL',
  'usa-latino-cpa':     'VWHZW08b0skUV7wcnG55',
};

function buildAuthorPageHTML(client) {
  const a = client.author || {};
  const b = client.brand || {};
  const primary   = b.primary || '#1a1a1a';
  const accent    = b.accent  || primary;
  const fontImport = b.fontImport || "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap";
  const fontDisplay = b.fontDisplay || 'Inter';
  const fontBody   = b.fontBody   || 'Inter';
  const logoUrl    = b.logoUrl    || '';
  const phone      = b.phone      || '';
  const stats      = b.stats      || [];
  const trust      = b.trustBadges || [];

  const authorName  = a.name        || 'Our Expert';
  const authorTitle = a.title       || '';
  const authorCreds = a.credentials || '';
  const authorBio   = a.bio         || '';

  const articlesUrl = `https://${client.domain}/blog`;
  const cta = client.cta || `Learn more at ${client.domain}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${authorName} — ${client.name}</title>
<meta name="description" content="${authorTitle}. ${authorCreds.slice(0,160)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${fontImport}" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: '${fontBody}', sans-serif; background: #f9f9f9; color: #1a1a1a; }

.hero {
  background: ${primary};
  color: #fff;
  padding: 64px 24px 80px;
  text-align: center;
}
.hero-logo { max-height: 48px; margin-bottom: 32px; opacity: 0.95; }
.avatar-ring {
  width: 120px; height: 120px;
  border-radius: 50%;
  border: 4px solid ${accent};
  background: rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 24px;
  font-family: '${fontDisplay}', sans-serif;
  font-size: 48px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 2px;
}
.author-name {
  font-family: '${fontDisplay}', sans-serif;
  font-size: clamp(28px, 5vw, 44px);
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
.author-title {
  font-size: 15px;
  opacity: 0.85;
  font-weight: 400;
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.5;
}

.card-section {
  max-width: 780px;
  margin: -40px auto 0;
  padding: 0 20px 64px;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 40px 40px;
  box-shadow: 0 4px 32px rgba(0,0,0,0.08);
  margin-bottom: 24px;
}
.card h2 {
  font-family: '${fontDisplay}', sans-serif;
  font-size: 13px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: ${accent};
  margin-bottom: 16px;
  font-weight: 700;
}
.card p {
  font-size: 16px;
  line-height: 1.75;
  color: #333;
}
.creds {
  background: ${primary}0D;
  border-left: 3px solid ${accent};
  padding: 16px 20px;
  border-radius: 0 8px 8px 0;
  font-size: 15px;
  line-height: 1.7;
  color: #222;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.stat-box {
  background: ${primary};
  color: #fff;
  border-radius: 12px;
  padding: 20px 16px;
  text-align: center;
}
.stat-box .num {
  font-family: '${fontDisplay}', sans-serif;
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 4px;
}
.stat-box .lbl { font-size: 12px; opacity: 0.8; }

.trust-row {
  display: flex; flex-wrap: wrap; gap: 10px;
}
.badge {
  background: #f0f0f0;
  border-radius: 100px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #333;
}
.badge::before { content: '✓  '; color: ${accent}; font-weight: 700; }

.cta-card {
  background: ${primary};
  color: #fff;
  border-radius: 16px;
  padding: 40px;
  text-align: center;
}
.cta-card h3 {
  font-family: '${fontDisplay}', sans-serif;
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 12px;
}
.cta-card p { font-size: 15px; opacity: 0.85; margin-bottom: 24px; }
.cta-btn {
  display: inline-block;
  background: ${accent};
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  padding: 14px 32px;
  border-radius: 8px;
  text-decoration: none;
}
${phone ? `.phone-link { display:inline-block; margin-top:12px; color:#fff; opacity:0.85; font-size:14px; text-decoration:none; }` : ''}

@media (max-width: 600px) {
  .card { padding: 28px 24px; }
  .hero { padding: 48px 20px 72px; }
}
</style>
</head>
<body>

<div class="hero">
  ${logoUrl ? `<img src="${logoUrl}" alt="${client.name}" class="hero-logo">` : ''}
  <div class="avatar-ring">${authorName.charAt(0)}</div>
  <div class="author-name">${authorName}</div>
  <div class="author-title">${authorTitle}</div>
</div>

<div class="card-section">

  ${stats.length ? `
  <div class="stats-row">
    ${stats.map(s => {
      const parts = s.match(/^([^A-Za-z]+)?(.*)$/) || [, '', s];
      return `<div class="stat-box"><div class="num">${s}</div></div>`;
    }).join('')}
  </div>` : ''}

  <div class="card">
    <h2>About ${authorName}</h2>
    <p>${authorBio}</p>
  </div>

  ${authorCreds ? `
  <div class="card">
    <h2>Credentials & Experience</h2>
    <div class="creds">${authorCreds}</div>
  </div>` : ''}

  ${trust.length ? `
  <div class="card">
    <h2>Why ${client.name}</h2>
    <div class="trust-row">
      ${trust.map(t => `<span class="badge">${t}</span>`).join('')}
    </div>
  </div>` : ''}

  <div class="cta-card">
    <h3>Read Articles by ${authorName.split(' ')[0]}</h3>
    <p>${cta}</p>
    <a href="https://${client.domain}" class="cta-btn">Visit ${client.name}</a>
    ${phone ? `<br><a href="tel:${phone.replace(/\D/g,'')}" class="phone-link">${phone}</a>` : ''}
  </div>

</div>
</body>
</html>`;
}

// GET /author/:slug — branded author page for any SEO client
app.get('/author/:slug', (req, res) => {
  const locationId = AUTHOR_SLUGS[req.params.slug];
  if (!locationId) {
    return res.status(404).send('<h1>Author not found</h1><p>Valid paths: /authors</p>');
  }
  const client = SEO_CLIENTS[locationId];
  if (!client || !client.author) {
    return res.status(404).send('<h1>No author configured for this client</h1>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(buildAuthorPageHTML(client));
});

// GET /authors — index of all author pages
app.get('/authors', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const rows = Object.entries(AUTHOR_SLUGS).map(([slug, locId]) => {
    const c = SEO_CLIENTS[locId];
    if (!c) return '';
    const a = c.author || {};
    return `<tr>
      <td><strong>${a.name || '—'}</strong></td>
      <td>${c.name}</td>
      <td><a href="/author/${slug}">/author/${slug}</a></td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Author Index</title>
  <style>body{font-family:system-ui,sans-serif;padding:40px;max-width:800px;margin:0 auto}
  table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #eee;text-align:left}
  th{background:#f5f5f5;font-size:12px;text-transform:uppercase;letter-spacing:1px}
  a{color:#37ca37}</style></head><body>
  <h1 style="margin-bottom:24px">JRZ Marketing — Author Pages</h1>
  <table><thead><tr><th>Author</th><th>Client</th><th>Page URL</th></tr></thead>
  <tbody>${rows}</tbody></table></body></html>`);
});

// ============================================================
// LION JUNK REMOVAL & DEMOLITION WEBSITE
// ============================================================

function ljrCSS() {
  return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
#ljr-site{position:relative;left:50%;margin-left:-50vw;width:100vw;max-width:100vw;overflow-x:hidden;font-family:'Inter',sans-serif;background:#fff;color:#1a1a1a;}
#ljr-site *,#ljr-site *::before,#ljr-site *::after{box-sizing:border-box;}
html,body{margin:0;padding:0;overflow-x:hidden;}
img{display:block;max-width:100%;}a{color:inherit;text-decoration:none;}
:root{--red:#c01414;--dark:#111111;--text:#1a1a1a;--muted:#5a6472;--white:#ffffff;--line:#e5e7eb;--panel:#f8f9fa;--shadow:0 4px 24px rgba(0,0,0,.08);}
.ljr-c{width:min(1280px,calc(100% - 40px));margin:0 auto;}
.ljr-s{padding:88px 0;}
.ljr-s-sm{padding:60px 0;}
.ljr-btn-red{display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;background:var(--red);color:#fff;font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:6px;border:2px solid var(--red);transition:.2s ease;cursor:pointer;}
.ljr-btn-red:hover{background:#a01010;border-color:#a01010;transform:translateY(-2px);}
.ljr-btn-dark{display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;background:var(--dark);color:#fff;font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:6px;border:2px solid var(--dark);transition:.2s ease;}
.ljr-btn-dark:hover{background:#333;transform:translateY(-2px);}
.ljr-btn-outline{display:inline-flex;align-items:center;justify-content:center;padding:13px 28px;background:#fff;color:var(--red);font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:6px;border:2px solid var(--red);transition:.2s ease;}
.ljr-btn-outline:hover{background:var(--red);color:#fff;}
.ljr-eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--red);margin-bottom:14px;}
.ljr-eyebrow:before{content:"";width:28px;height:2px;background:var(--red);}
.ljr-h1{font-size:clamp(40px,6vw,84px);line-height:.95;letter-spacing:-.04em;font-weight:900;color:#fff;margin:0 0 20px;}
.ljr-h2{font-size:clamp(32px,4vw,60px);line-height:1;letter-spacing:-.04em;font-weight:900;color:var(--dark);margin:0 0 16px;}
.ljr-h3{font-size:clamp(22px,2.5vw,34px);line-height:1.1;font-weight:800;color:var(--dark);margin:0 0 12px;}
.ljr-sub{font-size:17px;line-height:1.8;color:var(--muted);}
.ljr-nav-wrap{position:sticky;top:0;z-index:60;background:#fff;border-bottom:3px solid var(--red);box-shadow:0 2px 12px rgba(0,0,0,.08);}
.ljr-nav{display:flex;align-items:center;justify-content:space-between;min-height:72px;gap:16px;}
.ljr-nav-brand{font-size:20px;font-weight:900;color:var(--dark);letter-spacing:-.02em;}
.ljr-nav-brand span{color:var(--red);}
.ljr-nav-links{display:flex;align-items:center;gap:6px;list-style:none;}
.ljr-nav-links a{font-size:12px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#444;padding:8px 12px;border-radius:4px;transition:.2s;}
.ljr-nav-links a:hover,.ljr-nav-links a.act{color:var(--red);}
.ljr-nav-mob{display:none;background:none;border:1px solid var(--line);border-radius:6px;padding:8px 12px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;}
.ljr-hero{position:relative;min-height:92vh;display:flex;align-items:center;background:#111;overflow:hidden;}
.ljr-hero-bg{position:absolute;inset:0;}
.ljr-hero-bg img{width:100%;height:100%;object-fit:cover;filter:brightness(.35);}
.ljr-hero-in{position:relative;z-index:2;padding:80px 0 60px;}
.ljr-hero-kicker{display:inline-flex;align-items:center;gap:10px;background:var(--red);color:#fff;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;padding:8px 16px;border-radius:4px;margin-bottom:22px;}
.ljr-hero-sub{font-size:18px;line-height:1.8;color:rgba(255,255,255,.82);max-width:680px;margin:0 0 32px;}
.ljr-hero-btns{display:flex;gap:14px;flex-wrap:wrap;}
.ljr-trust-bar{background:var(--red);padding:16px 0;}
.ljr-trust-in{display:flex;justify-content:center;align-items:center;gap:32px;flex-wrap:wrap;}
.ljr-trust-item{display:flex;align-items:center;gap:8px;color:#fff;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;}
.ljr-trust-item:before{content:"✓";font-weight:900;font-size:15px;}
.ljr-svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:44px;}
.ljr-svc-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:28px;box-shadow:var(--shadow);transition:.25s ease;}
.ljr-svc-card:hover{border-color:var(--red);transform:translateY(-4px);box-shadow:0 12px 36px rgba(192,20,20,.12);}
.ljr-svc-icon{font-size:36px;margin-bottom:14px;}
.ljr-svc-title{font-size:20px;font-weight:800;color:var(--dark);margin-bottom:10px;}
.ljr-svc-copy{font-size:14px;line-height:1.8;color:var(--muted);margin-bottom:14px;}
.ljr-svc-link{font-size:13px;font-weight:800;color:var(--red);letter-spacing:.06em;text-transform:uppercase;}
.ljr-why-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:44px;}
.ljr-why-card{text-align:center;padding:36px 24px;background:var(--panel);border-radius:10px;border:1px solid var(--line);}
.ljr-why-icon{font-size:44px;margin-bottom:16px;}
.ljr-why-title{font-size:20px;font-weight:800;color:var(--dark);margin-bottom:10px;}
.ljr-why-copy{font-size:14px;line-height:1.8;color:var(--muted);}
.ljr-areas-strip{background:var(--dark);padding:18px 0;overflow:hidden;}
.ljr-areas-in{white-space:nowrap;font-size:14px;font-weight:700;color:rgba(255,255,255,.75);letter-spacing:.08em;text-align:center;}
.ljr-areas-in span{color:var(--red);margin:0 4px;}
.ljr-rev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:44px;}
.ljr-rev-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;box-shadow:var(--shadow);}
.ljr-rev-stars{color:#f59e0b;font-size:16px;margin-bottom:10px;letter-spacing:2px;}
.ljr-rev-text{font-size:14px;line-height:1.8;color:#444;margin-bottom:14px;}
.ljr-rev-name{font-size:13px;font-weight:800;color:var(--dark);}
.ljr-rev-source{font-size:11px;color:var(--muted);margin-top:2px;}
.ljr-cta-band{background:var(--red);padding:72px 0;text-align:center;}
.ljr-cta-band h2{font-size:clamp(28px,4vw,52px);font-weight:900;color:#fff;margin-bottom:14px;}
.ljr-cta-band p{font-size:17px;color:rgba(255,255,255,.88);margin-bottom:28px;}
.ljr-cta-band .ljr-btn-red{background:#fff;color:var(--red);border-color:#fff;}
.ljr-cta-band .ljr-btn-red:hover{background:rgba(255,255,255,.9);}
.ljr-sec-alt{background:var(--panel);}
.ljr-ind-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:44px;}
.ljr-ind-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:32px;box-shadow:var(--shadow);border-left:4px solid var(--red);}
.ljr-ind-title{font-size:22px;font-weight:800;color:var(--dark);margin-bottom:12px;}
.ljr-ind-copy{font-size:14px;line-height:1.85;color:var(--muted);margin-bottom:18px;}
.ljr-stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:44px;}
.ljr-stat-box{text-align:center;padding:32px 20px;background:#fff;border:1px solid var(--line);border-radius:10px;border-top:4px solid var(--red);}
.ljr-stat-n{font-size:48px;font-weight:900;color:var(--red);line-height:1;}
.ljr-stat-l{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:8px;}
.ljr-faq-list{max-width:860px;margin:44px auto 0;}
.ljr-faq-item{border:1px solid var(--line);border-radius:8px;margin-bottom:10px;overflow:hidden;}
.ljr-faq-btn{width:100%;text-align:left;background:#fff;border:0;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-size:15px;font-weight:700;color:var(--dark);}
.ljr-faq-btn:hover{background:var(--panel);}
.ljr-faq-icon{color:var(--red);font-size:20px;font-weight:900;flex-shrink:0;}
.ljr-faq-body{max-height:0;overflow:hidden;transition:max-height .3s ease;}
.ljr-faq-body p{padding:0 24px 20px;font-size:14px;line-height:1.85;color:var(--muted);margin:0;}
.ljr-faq-item.open .ljr-faq-body{max-height:300px;}
.ljr-contact-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:28px;align-items:start;margin-top:44px;}
.ljr-contact-info{background:var(--dark);color:#fff;border-radius:10px;padding:36px;}
.ljr-contact-info h3{font-size:24px;font-weight:800;color:#fff;margin-bottom:22px;}
.ljr-contact-row{display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;}
.ljr-contact-icon{width:40px;height:40px;background:var(--red);border-radius:6px;display:grid;place-items:center;flex-shrink:0;font-size:16px;}
.ljr-contact-label{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:4px;}
.ljr-contact-val{font-size:14px;color:rgba(255,255,255,.88);line-height:1.7;}
.ljr-areas-list{margin-top:22px;padding-top:22px;border-top:1px solid rgba(255,255,255,.1);}
.ljr-areas-list h4{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:12px;}
.ljr-areas-list p{font-size:13px;line-height:2;color:rgba(255,255,255,.75);}
.ljr-form-wrap{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;box-shadow:var(--shadow);}
.ljr-footer{background:var(--dark);color:rgba(255,255,255,.7);padding:56px 0 28px;}
.ljr-footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:28px;margin-bottom:36px;}
.ljr-footer-brand{font-size:22px;font-weight:900;color:#fff;margin-bottom:14px;}
.ljr-footer-brand span{color:var(--red);}
.ljr-footer-copy{font-size:13px;line-height:1.85;}
.ljr-footer-col h4{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--red);margin-bottom:14px;}
.ljr-footer-links{list-style:none;display:grid;gap:8px;}
.ljr-footer-links a{font-size:13px;color:rgba(255,255,255,.7);transition:.2s;}
.ljr-footer-links a:hover{color:var(--red);}
.ljr-footer-bottom{border-top:1px solid rgba(255,255,255,.08);padding-top:20px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px;color:rgba(255,255,255,.4);}
.ljr-reveal{opacity:0;transform:translateY(20px);transition:opacity .6s ease,transform .6s ease;}
.ljr-reveal.visible{opacity:1;transform:none;}
@media(max-width:1100px){.ljr-svc-grid,.ljr-why-grid{grid-template-columns:1fr 1fr;}.ljr-stats-grid{grid-template-columns:1fr 1fr;}.ljr-footer-grid{grid-template-columns:1fr 1fr;}.ljr-contact-grid{grid-template-columns:1fr;}}
@media(max-width:768px){.ljr-nav-links{display:none;}.ljr-nav-mob{display:block;}.ljr-svc-grid,.ljr-why-grid,.ljr-rev-grid,.ljr-ind-grid,.ljr-stats-grid,.ljr-footer-grid{grid-template-columns:1fr;}.ljr-trust-in{gap:16px;}.ljr-contact-grid{grid-template-columns:1fr;}.ljr-hero{min-height:auto;padding:100px 0 60px;}}
@media(max-width:480px){.ljr-s{padding:60px 0;}.ljr-hero-btns{flex-direction:column;}.ljr-hero-btns a{width:100%;justify-content:center;}.ljr-trust-item{font-size:11px;}}
`;
}

function ljrHead(title, desc, slug) {
  const schema = JSON.stringify({"@context":"https://schema.org","@type":"LocalBusiness","name":"Lion Junk Removal & Demolition","description":"Central Florida's trusted junk removal and demolition company serving Orlando, Kissimmee, Winter Park, Sanford, Clermont, Daytona Beach and 40+ cities.","url":"https://lionjunkremovaldemolition.com"+slug,"areaServed":["Orlando","Kissimmee","Winter Park","Sanford","Clermont","Daytona Beach","Central Florida"],"priceRange":"$$","telephone":"(407) 555-0100","address":{"@type":"PostalAddress","addressLocality":"Orlando","addressRegion":"FL","addressCountry":"US"}});
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index,follow">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<script type="application/ld+json">${schema}</script>
<style>${ljrCSS()}</style>
</head><body><div id="ljr-site">`;
}

function ljrNav(active) {
  const links = [['home','Home','/'],['services','Services','/services'],['industries','Industries','/industries'],['about','About Us','/about'],['faq','FAQ','/faq'],['contact','Contact','/contact']];
  return `<div class="ljr-nav-wrap"><div class="ljr-c"><nav class="ljr-nav">
  <div class="ljr-nav-brand">LION <span>JUNK REMOVAL</span></div>
  <ul class="ljr-nav-links">
    ${links.map(([id,label,href])=>`<li><a href="${href}"${active===id?' class="act"':''}>${label}</a></li>`).join('')}
  </ul>
  <div style="display:flex;align-items:center;gap:12px;">
    <a href="/contact" class="ljr-btn-red" style="min-height:44px;padding:10px 20px;font-size:12px;">Book Now</a>
    <button class="ljr-nav-mob" id="ljrMobBtn">Menu</button>
  </div>
</nav></div></div>
<div id="ljrMobMenu" style="display:none;background:#fff;border-bottom:1px solid var(--line);padding:12px 0;">
  <div class="ljr-c" style="display:grid;gap:4px;">
    ${links.map(([id,label,href])=>`<a href="${href}" style="padding:12px 16px;border-radius:6px;background:var(--panel);font-size:14px;font-weight:700;">${label}</a>`).join('')}
  </div>
</div>`;
}

function ljrFooter() {
  return `<footer class="ljr-footer"><div class="ljr-c">
  <div class="ljr-footer-grid">
    <div>
      <div class="ljr-footer-brand">LION <span>JUNK REMOVAL</span></div>
      <p class="ljr-footer-copy">Central Florida's most trusted junk removal and demolition company. Licensed, insured, and committed to fast, affordable, eco-friendly service across 40+ cities.</p>
    </div>
    <div class="ljr-footer-col"><h4>Services</h4><ul class="ljr-footer-links">
      <li><a href="/services#furniture">Furniture Removal</a></li>
      <li><a href="/services#appliance">Appliance Removal</a></li>
      <li><a href="/services#garage">Garage Cleanout</a></li>
      <li><a href="/services#estate">Estate Cleanout</a></li>
      <li><a href="/services#commercial">Commercial Junk Removal</a></li>
      <li><a href="/services#demolition">Demolition</a></li>
    </ul></div>
    <div class="ljr-footer-col"><h4>Industries</h4><ul class="ljr-footer-links">
      <li><a href="/industries#homeowners">Homeowners</a></li>
      <li><a href="/industries#contractors">Contractors</a></li>
      <li><a href="/industries#property-managers">Property Managers</a></li>
      <li><a href="/industries#real-estate">Real Estate Agents</a></li>
      <li><a href="/industries#commercial">Commercial</a></li>
    </ul></div>
    <div class="ljr-footer-col"><h4>Areas Served</h4><p style="font-size:13px;line-height:2;color:rgba(255,255,255,.7);">Orlando · Kissimmee · Winter Park · Sanford · Clermont · Daytona Beach · Lake Nona · Altamonte Springs · Longwood · Oviedo · and 30+ more cities</p></div>
  </div>
  <div class="ljr-footer-bottom">
    <span>© ${new Date().getFullYear()} Lion Junk Removal & Demolition. All rights reserved.</span>
    <span>Licensed & Insured · Central Florida's Trusted Junk Removal Team</span>
  </div>
</div></footer>
<script>
(function(){
  var btn=document.getElementById('ljrMobBtn'),menu=document.getElementById('ljrMobMenu');
  if(btn&&menu)btn.addEventListener('click',function(){menu.style.display=menu.style.display==='none'?'block':'none';});
  var io=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting){x.target.classList.add('visible');io.unobserve(x.target);}});},{threshold:.08});
  document.querySelectorAll('.ljr-reveal').forEach(function(el){io.observe(el);});
  document.querySelectorAll('.ljr-faq-btn').forEach(function(btn){btn.addEventListener('click',function(){var item=btn.closest('.ljr-faq-item');var open=item.classList.contains('open');document.querySelectorAll('.ljr-faq-item').forEach(function(i){i.classList.remove('open');var ic=i.querySelector('.ljr-faq-icon');if(ic)ic.textContent='+';});if(!open){item.classList.add('open');var ic=item.querySelector('.ljr-faq-icon');if(ic)ic.textContent='−';}});});
})();
</script>`;
}

function ljrBuildHomePage(kwData=[]) {
  const kwCloud = kwData.slice(0,10).map(k=>`<span style="display:inline-block;padding:6px 12px;background:rgba(192,20,20,.08);color:var(--red);border-radius:4px;font-size:12px;font-weight:700;margin:4px;">${k.keyword}</span>`).join('') || '';
  return ljrHead('Lion Junk Removal & Demolition | Best Junk Removal in Orlando, FL','Central Florida\'s most trusted junk removal and demolition company. Same-day service in Orlando, Kissimmee, Winter Park, Sanford, Clermont, and 40+ cities. Free quotes.','/') +
  ljrNav('home') + `
<section class="ljr-hero">
  <div class="ljr-hero-bg"><img src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1400&q=80" alt="Junk removal truck Central Florida" fetchpriority="high"></div>
  <div class="ljr-c ljr-hero-in ljr-reveal">
    <div class="ljr-hero-kicker">🦁 Central Florida's #1 Junk Removal Team</div>
    <h1 class="ljr-h1" style="max-width:820px;">Central Florida's Most Trusted Junk Removal &amp; Demolition Team</h1>
    <p class="ljr-hero-sub">Same-day service available in Orlando, Kissimmee, Winter Park, Sanford, Clermont, Daytona Beach, and 40+ cities. Upfront pricing, no surprises, eco-friendly disposal.</p>
    <div class="ljr-hero-btns">
      <a href="/contact" class="ljr-btn-red">Book Now — Get Free Quote →</a>
      <a href="/services" class="ljr-btn-outline" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.5);">View All Services</a>
    </div>
  </div>
</section>

<div class="ljr-trust-bar">
  <div class="ljr-c"><div class="ljr-trust-in">
    <span class="ljr-trust-item">Licensed &amp; Insured</span>
    <span class="ljr-trust-item">Same-Day Service Available</span>
    <span class="ljr-trust-item">Eco-Friendly Disposal</span>
    <span class="ljr-trust-item">5★ Google Rated</span>
    <span class="ljr-trust-item">Free Quotes</span>
    <span class="ljr-trust-item">No Hidden Fees</span>
  </div></div>
</div>

<section class="ljr-s">
  <div class="ljr-c">
    <div class="ljr-reveal"><div class="ljr-eyebrow">Our Services</div>
    <h2 class="ljr-h2">Junk Removal Services for Every Situation</h2>
    <p class="ljr-sub" style="max-width:680px;">From single-item pickups to full property cleanouts, we handle it all. Fast, affordable, and professional — every time.</p></div>
    <div class="ljr-svc-grid">
      ${[
        ['🛋️','Furniture Removal','Sofas, beds, tables, chairs, and more. We haul it all so you don\'t have to.'],
        ['🧊','Appliance Removal','Refrigerators, washers, dryers, microwaves — safe and responsible disposal.'],
        ['🏠','Garage Cleanout','Complete garage cleanouts from top to bottom. We sort, haul, and sweep up.'],
        ['🏗️','Construction Debris','Drywall, lumber, concrete, tiles — fast debris removal for contractors and homeowners.'],
        ['🏡','Estate Cleanout','Compassionate, efficient estate cleanouts for families and real estate professionals.'],
        ['🏢','Commercial Junk Removal','Office furniture, equipment, and debris removal for businesses of all sizes.'],
      ].map(([icon,title,copy])=>`
      <div class="ljr-svc-card ljr-reveal">
        <div class="ljr-svc-icon">${icon}</div>
        <div class="ljr-svc-title">${title}</div>
        <div class="ljr-svc-copy">${copy}</div>
        <a href="/services" class="ljr-svc-link">Learn More →</a>
      </div>`).join('')}
    </div>
    <div style="text-align:center;margin-top:36px;"><a href="/services" class="ljr-btn-red">View All Services</a></div>
  </div>
</section>

<section class="ljr-s ljr-sec-alt">
  <div class="ljr-c">
    <div class="ljr-reveal" style="text-align:center;max-width:680px;margin:0 auto 0;">
      <div class="ljr-eyebrow">Why Choose Lion</div>
      <h2 class="ljr-h2">Honest. Fast. Reliable.</h2>
      <p class="ljr-sub">We built our reputation on three things that matter most to our customers.</p>
    </div>
    <div class="ljr-why-grid">
      <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">💰</div><div class="ljr-why-title">Upfront Pricing</div><p class="ljr-why-copy">No hidden fees, no surprises. You get a clear quote before we start — and that's exactly what you pay.</p></div>
      <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">♻️</div><div class="ljr-why-title">Eco-Friendly Disposal</div><p class="ljr-why-copy">We donate usable items, recycle what we can, and responsibly dispose of the rest. Good for you and the planet.</p></div>
      <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">⚡</div><div class="ljr-why-title">Same-Day Available</div><p class="ljr-why-copy">Need it gone today? We offer same-day and next-day service across Central Florida. Just call or book online.</p></div>
    </div>
  </div>
</section>

<div class="ljr-areas-strip">
  <div class="ljr-c"><div class="ljr-areas-in">
    Serving Central Florida: <span>Orlando</span> · <span>Kissimmee</span> · <span>Winter Park</span> · <span>Sanford</span> · <span>Clermont</span> · <span>Daytona Beach</span> · <span>Lake Nona</span> · <span>Altamonte Springs</span> · <span>Longwood</span> · <span>Oviedo</span> · and <span>30+ more cities</span>
  </div></div>
</div>

<section class="ljr-s">
  <div class="ljr-c">
    <div class="ljr-reveal" style="text-align:center;max-width:680px;margin:0 auto 0;">
      <div class="ljr-eyebrow">Google Reviews</div>
      <h2 class="ljr-h2">What Our Customers Say</h2>
      <p class="ljr-sub">500+ five-star reviews across Central Florida. Here's what real customers are saying.</p>
    </div>
    <div class="ljr-rev-grid">
      ${[
        ['Maria G.','★★★★★','Fast, professional, and affordable. They cleared my garage in under 2 hours. Highly recommend to anyone in Orlando!'],
        ['Carlos R.','★★★★★','Called at 8am, they were here by noon. No hidden fees, clean work. Best junk removal in Kissimmee.'],
        ['Jennifer T.','★★★★★','Best junk removal company in Orlando. The team was respectful of my property and incredibly efficient.'],
        ['Mike D.','★★★★★','Used them for a commercial cleanout in Winter Park. Incredible value and super fast turnaround.'],
        ['Sandra L.','★★★★★','They took everything — old furniture, appliances, construction debris. Made the whole process easy.'],
        ['Anthony P.','★★★★★','Honest pricing, no surprises. Showed up on time and got the job done right. 5 stars all day.'],
        ['Rosa M.','★★★★★','Perfect service for our estate cleanout in Sanford. Very compassionate, professional team.'],
        ['David K.','★★★★★','Used Lion JR for construction debris removal after a remodel. Fast, clean, and a great price.'],
        ['Lisa H.','★★★★★','They helped with a hoarding cleanup and were incredibly patient and thorough throughout the process.'],
        ['Tom W.','★★★★★','Same-day service for a last-minute job in Clermont. Couldn\'t ask for better. 10/10 — will use again.'],
      ].map(([name,stars,text])=>`
      <div class="ljr-rev-card ljr-reveal">
        <div class="ljr-rev-stars">${stars}</div>
        <p class="ljr-rev-text">"${text}"</p>
        <div class="ljr-rev-name">${name}</div>
        <div class="ljr-rev-source">Google Review · Central Florida</div>
      </div>`).join('')}
    </div>
  </div>
</section>

${kwCloud ? `<section class="ljr-s-sm ljr-sec-alt"><div class="ljr-c ljr-reveal"><div class="ljr-eyebrow">Local SEO Keywords</div><p style="font-size:14px;color:var(--muted);margin-bottom:16px;">Top search terms for junk removal in Central Florida:</p><div>${kwCloud}</div></div></section>` : ''}

<div class="ljr-cta-band ljr-reveal">
  <div class="ljr-c">
    <h2>Ready to Clear the Clutter?</h2>
    <p>Get your free, no-obligation quote today. Same-day service available across Central Florida.</p>
    <a href="/contact" class="ljr-btn-red">Get Free Quote Now →</a>
  </div>
</div>
` + ljrFooter() + `</div></body></html>`;
}

function ljrBuildServicesPage(kwData=[]) {
  const services = [
    {id:'furniture',icon:'🛋️',title:'Furniture Removal',copy:'We remove sofas, sectionals, beds, dressers, tables, chairs, and any other furniture from your home, office, or storage unit. Our team does all the heavy lifting — you just point and we haul.',items:['Living room & bedroom furniture','Office chairs & desks','Mattresses & box springs','Entertainment centers','Outdoor furniture']},
    {id:'appliance',icon:'🧊',title:'Appliance Removal',copy:'Old refrigerators, washers, dryers, dishwashers, ovens, and microwaves are safely removed and disposed of in compliance with environmental regulations. We handle all types.',items:['Refrigerators & freezers','Washers & dryers','Ovens & ranges','Dishwashers','Air conditioning units']},
    {id:'garage',icon:'🏠',title:'Garage Cleanout',copy:'A full garage cleanout from top to bottom. We clear out decades of clutter, old tools, boxes, broken equipment, and anything else taking up space. Leave it completely empty and broom-swept.',items:['Old tools & equipment','Boxes & storage items','Broken furniture','Sports equipment','General clutter & debris']},
    {id:'ewaste',icon:'💻',title:'E-Waste Disposal',copy:'Responsible e-waste disposal for old electronics including computers, TVs, monitors, printers, and more. We ensure your devices are recycled or disposed of in compliance with Florida regulations.',items:['Computers & laptops','TVs & monitors','Printers & scanners','Old phones & tablets','Electronic accessories']},
    {id:'construction',icon:'🏗️',title:'Construction Debris Removal',copy:'Fast and affordable construction debris removal for contractors, property managers, and homeowners. We haul drywall, lumber, concrete, tiles, insulation, and all types of construction waste.',items:['Drywall & plaster','Lumber & wood scraps','Concrete & masonry','Flooring & tiles','Roofing materials']},
    {id:'yard',icon:'🌿',title:'Yard Waste Removal',copy:'Tree branches, leaves, grass clippings, old landscaping materials, fencing, and outdoor debris — we clear it all. Perfect for post-storm cleanup or major landscaping projects.',items:['Tree branches & stumps','Leaves & grass clippings','Old fencing & lumber','Landscaping materials','Storm debris cleanup']},
    {id:'estate',icon:'🏡',title:'Estate Cleanout',copy:'Compassionate and efficient estate cleanouts for families and real estate professionals. We handle the entire property — furniture, belongings, debris — so you don\'t have to.',items:['Full property clearing','Furniture & appliances','Personal belongings (with care)','Garage & storage areas','Coordination with real estate agents']},
    {id:'commercial',icon:'🏢',title:'Commercial Junk Removal',copy:'Office furniture, cubicles, IT equipment, warehouse inventory, and commercial debris — we work fast to minimize disruption to your business operations.',items:['Office furniture & equipment','Cubicles & shelving','IT & server equipment','Warehouse inventory','Restaurant & retail equipment']},
    {id:'hoarding',icon:'🧹',title:'Hoarding Cleanup',copy:'Discreet, compassionate hoarding cleanup services. Our experienced team works with sensitivity and professionalism to restore properties to a clean, safe condition.',items:['Full property restoration','Sensitive item handling','Coordination with families','Post-cleanup sweep','Biohazard referral when needed']},
    {id:'valet',icon:'🗑️',title:'Valet Trash',copy:'Reliable valet trash services for apartment communities, condos, and HOAs. We pick up directly from residents\' doors on a scheduled basis — professional and dependable.',items:['Door-to-door pickup','Scheduled service plans','Apartment communities','Condo associations','HOA partnerships']},
    {id:'whats-taken',icon:'📋',title:'What We Take',copy:'We accept the vast majority of household and commercial items. The few things we cannot take are hazardous materials like paint, chemicals, asbestos, and medical waste — check with your local disposal facility for those.',items:['Furniture & mattresses','Appliances & electronics','Yard waste & debris','Construction materials','Clothing & household goods','Office furniture & equipment']},
  ];
  return ljrHead('Junk Removal Services in Central Florida | Lion Junk Removal','Full list of junk removal and demolition services in Orlando, Kissimmee, Winter Park, Sanford, and Central Florida. Same-day service available.','/services') +
  ljrNav('services') + `
<div style="background:var(--dark);padding:64px 0 48px;border-bottom:4px solid var(--red);">
  <div class="ljr-c ljr-reveal">
    <div class="ljr-eyebrow" style="color:var(--red);">Our Services</div>
    <h1 class="ljr-h2" style="color:#fff;font-size:clamp(36px,5vw,72px);">Every Junk Removal Service You Need</h1>
    <p style="font-size:17px;color:rgba(255,255,255,.75);max-width:620px;line-height:1.8;">From single-item pickups to complete property cleanouts — we do it all across Central Florida with upfront pricing and same-day availability.</p>
    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
      <a href="/contact" class="ljr-btn-red">Get Free Quote →</a>
    </div>
  </div>
</div>
<div class="ljr-trust-bar"><div class="ljr-c"><div class="ljr-trust-in"><span class="ljr-trust-item">Licensed &amp; Insured</span><span class="ljr-trust-item">Same-Day Available</span><span class="ljr-trust-item">Free Quotes</span><span class="ljr-trust-item">Eco-Friendly</span></div></div></div>
${services.map((svc,i)=>`
<section id="${svc.id}" class="ljr-s${i%2===1?' ljr-sec-alt':''}">
  <div class="ljr-c">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;" class="ljr-reveal">
      <div>
        <div class="ljr-eyebrow">${svc.icon} Junk Removal Service</div>
        <h2 class="ljr-h2">${svc.title}</h2>
        <p class="ljr-sub" style="margin-bottom:22px;">${svc.copy}</p>
        <ul style="list-style:none;display:grid;gap:10px;margin-bottom:24px;">
          ${svc.items.map(item=>`<li style="display:flex;gap:10px;align-items:center;font-size:14px;color:#444;"><span style="color:var(--red);font-weight:900;">✓</span>${item}</li>`).join('')}
        </ul>
        <a href="/contact" class="ljr-btn-red">Book ${svc.title} →</a>
      </div>
      <div style="background:var(--panel);border-radius:10px;padding:36px;border-left:4px solid var(--red);">
        <div style="font-size:52px;margin-bottom:16px;">${svc.icon}</div>
        <h3 style="font-size:20px;font-weight:800;color:var(--dark);margin-bottom:12px;">Why Choose Lion JR?</h3>
        <p style="font-size:14px;line-height:1.85;color:var(--muted);margin-bottom:16px;">Fast, professional, and affordable ${svc.title.toLowerCase()} across Central Florida. Licensed, insured, and committed to eco-friendly disposal.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <span style="padding:6px 12px;background:rgba(192,20,20,.08);color:var(--red);border-radius:4px;font-size:12px;font-weight:800;">Same-Day Available</span>
          <span style="padding:6px 12px;background:rgba(192,20,20,.08);color:var(--red);border-radius:4px;font-size:12px;font-weight:800;">Free Quote</span>
          <span style="padding:6px 12px;background:rgba(192,20,20,.08);color:var(--red);border-radius:4px;font-size:12px;font-weight:800;">Licensed &amp; Insured</span>
        </div>
      </div>
    </div>
  </div>
</section>`).join('')}
<div class="ljr-cta-band ljr-reveal"><div class="ljr-c"><h2>Ready to Schedule?</h2><p>Get a free, no-obligation quote for any of our services. Same-day available.</p><a href="/contact" class="ljr-btn-red">Book Now →</a></div></div>
` + ljrFooter() + `</div></body></html>`;
}

function ljrBuildIndustriesPage(kwData=[]) {
  const industries = [
    {id:'homeowners',icon:'🏠',title:'Homeowners',sub:'Residential Junk Removal',copy:'Whether you\'re decluttering, downsizing, renovating, or just clearing out years of accumulated junk, Lion Junk Removal makes the process easy. We arrive on time, haul everything you point to, and leave your space clean. No need to rent a dumpster or make multiple trips to the dump.',items:['Full home cleanouts','Room-by-room decluttering','Move-out cleanups','Post-renovation debris','Attic & basement clearing']},
    {id:'condo',icon:'🏙️',title:'Condo Associations',sub:'HOA & Multi-Family Removal',copy:'Managing a condo community means handling bulk waste, move-out cleanouts, and common area cleanups regularly. Lion JR partners with condo associations across Central Florida to provide fast, reliable, and professional junk removal that keeps your property looking its best.',items:['Bulk item removal','Move-out unit cleanouts','Common area cleanups','Valet trash programs','On-call scheduling for management']},
    {id:'contractors',icon:'🔧',title:'Contractors',sub:'Construction & Renovation Debris',copy:'Construction debris piles up fast. Lumber, drywall, concrete, tiles, insulation — it\'s a full job site in itself. Lion JR works with contractors throughout Central Florida to provide fast, affordable construction debris removal so your crew stays productive and your site stays clean.',items:['Construction debris hauling','Demo waste removal','Ongoing job site cleanup','Fast turnaround scheduling','Commercial & residential projects']},
    {id:'property-managers',icon:'🔑',title:'Property Managers',sub:'Residential & Commercial Properties',copy:'Tenant move-outs leave behind furniture, appliances, and junk that needs to go before your next resident arrives. Lion JR responds fast, works professionally, and helps property managers turn units over quickly and efficiently.',items:['Move-out cleanouts','Abandoned property clearing','Multi-unit coordination','Fast turnaround service','Reliable scheduling for managers']},
    {id:'real-estate',icon:'🏡',title:'Real Estate Agents',sub:'Pre-Listing & Estate Cleanouts',copy:'Before listing a property, sellers often need full cleanouts — furniture, appliances, personal items, and debris. Lion JR helps real estate agents and their clients get properties market-ready fast, with professional service that reflects well on everyone involved.',items:['Pre-listing cleanouts','Estate property clearing','Staging preparation','Fast turnaround','Coordination with sellers & agents']},
    {id:'commercial-biz',icon:'🏢',title:'Commercial Businesses',sub:'Office & Retail Junk Removal',copy:'Office relocations, furniture upgrades, and business cleanouts require a professional team that works efficiently and respects your schedule. Lion JR provides commercial junk removal for businesses across Central Florida with minimal disruption to your operations.',items:['Office furniture removal','IT equipment disposal','Retail fixture removal','Restaurant equipment hauling','Warehouse & storage cleanouts']},
    {id:'valet-trash',icon:'🗑️',title:'Valet Trash Services',sub:'Apartment & Multi-Family Communities',copy:'Our valet trash program provides door-to-door trash pickup for apartment communities and multi-family developments on a scheduled, reliable basis. Residents love the convenience and managers love the professionalism.',items:['Door-to-door pickup schedules','Reliable 5-7 day per week service','Resident communication support','Clean, uniformed team members','Community management coordination']},
    {id:'warehouses',icon:'🏭',title:'Warehouses & Industrial',sub:'Large-Scale Commercial Removal',copy:'Warehouses, distribution centers, and industrial facilities generate large volumes of waste — from old racking and equipment to packaging debris and general waste. Lion JR handles large-scale commercial removals with the capacity and equipment to get it done fast.',items:['Racking & shelving removal','Equipment & machinery disposal','Packaging & pallets','Large-volume debris removal','Flexible scheduling for operations']},
  ];
  return ljrHead('Industries We Serve | Lion Junk Removal & Demolition Orlando FL','Lion Junk Removal serves homeowners, contractors, property managers, real estate agents, condo associations, commercial businesses, and more across Central Florida.','/industries') +
  ljrNav('industries') + `
<div style="background:var(--dark);padding:64px 0 48px;border-bottom:4px solid var(--red);">
  <div class="ljr-c ljr-reveal">
    <div class="ljr-eyebrow" style="color:var(--red);">Industries Served</div>
    <h1 class="ljr-h2" style="color:#fff;font-size:clamp(36px,5vw,72px);">We Serve Every Industry Across Central Florida</h1>
    <p style="font-size:17px;color:rgba(255,255,255,.75);max-width:620px;line-height:1.8;">From homeowners to commercial businesses — Lion JR has the experience, equipment, and professionalism to handle any job.</p>
    <div style="margin-top:24px;"><a href="/contact" class="ljr-btn-red">Get Free Quote →</a></div>
  </div>
</div>
<div class="ljr-trust-bar"><div class="ljr-c"><div class="ljr-trust-in"><span class="ljr-trust-item">Licensed &amp; Insured</span><span class="ljr-trust-item">Same-Day Available</span><span class="ljr-trust-item">Free Quotes</span><span class="ljr-trust-item">Eco-Friendly</span></div></div></div>
<section class="ljr-s"><div class="ljr-c">
  <div class="ljr-reveal" style="text-align:center;max-width:680px;margin:0 auto 0;"><div class="ljr-eyebrow">Who We Work With</div><h2 class="ljr-h2">Trusted by Homeowners, Businesses &amp; Professionals</h2></div>
  <div class="ljr-ind-grid">
    ${industries.map(ind=>`
    <div id="${ind.id}" class="ljr-ind-card ljr-reveal">
      <div style="font-size:36px;margin-bottom:12px;">${ind.icon}</div>
      <div class="ljr-ind-title">${ind.title}</div>
      <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin-bottom:14px;">${ind.sub}</div>
      <p class="ljr-ind-copy">${ind.copy}</p>
      <ul style="list-style:none;display:grid;gap:8px;margin-bottom:20px;">
        ${ind.items.map(item=>`<li style="display:flex;gap:10px;font-size:13px;color:#444;"><span style="color:var(--red);font-weight:900;">✓</span>${item}</li>`).join('')}
      </ul>
      <a href="/contact" class="ljr-btn-red" style="font-size:12px;padding:10px 20px;">Get Quote →</a>
    </div>`).join('')}
  </div>
</div></section>
<div class="ljr-cta-band ljr-reveal"><div class="ljr-c"><h2>Don't See Your Industry?</h2><p>We work with any business or individual who needs reliable junk removal in Central Florida. Contact us for a custom quote.</p><a href="/contact" class="ljr-btn-red">Contact Us Today →</a></div></div>
` + ljrFooter() + `</div></body></html>`;
}

function ljrBuildAboutPage() {
  return ljrHead('About Lion Junk Removal & Demolition | Central Florida\'s Trusted Team','Learn about Lion Junk Removal & Demolition — Central Florida\'s trusted, licensed, and insured junk removal company serving 40+ cities.','/about') +
  ljrNav('about') + `
<div style="background:var(--dark);padding:64px 0 48px;border-bottom:4px solid var(--red);">
  <div class="ljr-c ljr-reveal">
    <div class="ljr-eyebrow" style="color:var(--red);">About Us</div>
    <h1 class="ljr-h2" style="color:#fff;font-size:clamp(36px,5vw,72px);">Built on Trust. Driven by Results.</h1>
    <p style="font-size:17px;color:rgba(255,255,255,.75);max-width:640px;line-height:1.8;">Lion Junk Removal &amp; Demolition was built to bring professional, honest, and affordable junk removal to every corner of Central Florida.</p>
  </div>
</div>
<div class="ljr-trust-bar"><div class="ljr-c"><div class="ljr-trust-in"><span class="ljr-trust-item">Licensed &amp; Insured</span><span class="ljr-trust-item">5★ Google Rated</span><span class="ljr-trust-item">Eco-Friendly</span><span class="ljr-trust-item">Same-Day Service</span></div></div></div>
<section class="ljr-s"><div class="ljr-c">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;" class="ljr-reveal">
    <div>
      <div class="ljr-eyebrow">Our Story</div>
      <h2 class="ljr-h2">Central Florida's Junk Removal Experts</h2>
      <p class="ljr-sub" style="margin-bottom:18px;">Lion Junk Removal &amp; Demolition was founded with one goal: give Central Florida homeowners, businesses, and professionals a junk removal company they can actually trust. One that shows up on time, quotes honestly, works efficiently, and leaves every job site clean.</p>
      <p style="font-size:16px;line-height:1.85;color:var(--muted);">We've built our reputation one job at a time — earning five-star reviews through consistent, professional service from Orlando to Daytona Beach, Kissimmee to Sanford, and everywhere in between. We're fully licensed and insured, eco-friendly in our disposal practices, and committed to our community.</p>
    </div>
    <div>
      <img src="https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=800&q=80" alt="Lion Junk Removal team Central Florida" style="width:100%;border-radius:10px;box-shadow:var(--shadow);" loading="lazy">
    </div>
  </div>
</div></section>
<section class="ljr-s ljr-sec-alt"><div class="ljr-c ljr-reveal">
  <div style="text-align:center;max-width:680px;margin:0 auto 0;"><div class="ljr-eyebrow">By the Numbers</div><h2 class="ljr-h2">A Track Record You Can Count On</h2></div>
  <div class="ljr-stats-grid">
    <div class="ljr-stat-box"><div class="ljr-stat-n">1,000+</div><div class="ljr-stat-l">Jobs Completed</div></div>
    <div class="ljr-stat-box"><div class="ljr-stat-n">5★</div><div class="ljr-stat-l">Google Rating</div></div>
    <div class="ljr-stat-box"><div class="ljr-stat-n">40+</div><div class="ljr-stat-l">Cities Served</div></div>
    <div class="ljr-stat-box"><div class="ljr-stat-n">Same Day</div><div class="ljr-stat-l">Service Available</div></div>
  </div>
</div></section>
<section class="ljr-s"><div class="ljr-c">
  <div class="ljr-reveal" style="text-align:center;max-width:680px;margin:0 auto 0;"><div class="ljr-eyebrow">Our Values</div><h2 class="ljr-h2">What We Stand For</h2></div>
  <div class="ljr-why-grid">
    <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">🤝</div><div class="ljr-why-title">Honest Pricing</div><p class="ljr-why-copy">You'll always know the price before we start. No hidden fees, no last-minute surprises. What we quote is what you pay.</p></div>
    <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">♻️</div><div class="ljr-why-title">Eco-Friendly</div><p class="ljr-why-copy">We donate, recycle, and responsibly dispose. We take our environmental responsibility seriously on every job.</p></div>
    <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">🛡️</div><div class="ljr-why-title">Licensed &amp; Insured</div><p class="ljr-why-copy">Fully licensed and insured for your protection. You can trust us on your property — residential or commercial.</p></div>
    <div class="ljr-why-card ljr-reveal"><div class="ljr-why-icon">🦁</div><div class="ljr-why-title">Community-Focused</div><p class="ljr-why-copy">We're a Central Florida company serving Central Florida families and businesses. This community is our home too.</p></div>
  </div>
</div></section>
<div class="ljr-cta-band ljr-reveal"><div class="ljr-c"><h2>Ready to Work With Us?</h2><p>Get a free quote today. Same-day service available across Central Florida.</p><a href="/contact" class="ljr-btn-red">Get Free Quote →</a></div></div>
` + ljrFooter() + `</div></body></html>`;
}

function ljrBuildFAQPage() {
  const faqs = [
    {q:'What items do you remove?',a:'We remove almost everything — furniture, appliances, electronics, yard waste, construction debris, estate items, office equipment, and more. The only things we cannot take are hazardous materials like paint, chemicals, asbestos, motor oil, and medical/biological waste.'},
    {q:'How much does junk removal cost?',a:'Pricing is based on the volume and type of items you need removed. We provide a free, no-obligation quote before we start. Most residential jobs range from $100 to $600 depending on load size. There are no hidden fees.'},
    {q:'Do you offer same-day service?',a:'Yes! We offer same-day and next-day service across Central Florida based on availability. Call or book online early in the day for the best chance of same-day scheduling.'},
    {q:'Are you licensed and insured?',a:'Yes — Lion Junk Removal & Demolition is fully licensed and insured. We carry liability insurance to protect you and your property on every job.'},
    {q:'What areas of Central Florida do you serve?',a:'We serve Orlando, Kissimmee, Winter Park, Sanford, Clermont, Daytona Beach, Lake Nona, Altamonte Springs, Longwood, Oviedo, and 30+ additional cities across Central Florida.'},
    {q:'What happens to my junk after you pick it up?',a:'We take an eco-friendly approach. Usable items are donated to local charities. Electronics are recycled responsibly. Construction materials go to appropriate recycling facilities. Only what cannot be recycled or donated goes to the landfill.'},
    {q:'How do I book a junk removal appointment?',a:'You can book online through our contact form, call us directly, or send a message. We\'ll confirm your appointment quickly and provide an upfront quote before the job begins.'},
    {q:'Do you handle demolition in addition to junk removal?',a:'Yes — Lion Junk Removal & Demolition offers interior demolition services including shed demolition, deck removal, wall removal, and selective interior teardowns. Contact us for a custom quote.'},
    {q:'What is the difference between residential and commercial junk removal?',a:'Residential jobs typically involve furniture, appliances, and household items. Commercial jobs often involve office furniture, equipment, construction debris, and larger volumes. We handle both with the same professional standard.'},
    {q:'How long does a typical junk removal job take?',a:'Most residential junk removal jobs take between 30 minutes and 2 hours depending on volume. Large estate cleanouts or commercial jobs may take longer. We\'ll give you a time estimate when you book.'},
    {q:'Do I need to be home during the removal?',a:'Not necessarily. As long as we can access the items, many customers allow us to work while they\'re away. We\'ll confirm access details when you book and send confirmation photos when complete.'},
    {q:'What items do you NOT take?',a:'We do not remove hazardous waste including paint, chemicals, solvents, asbestos, medical waste, biohazardous materials, or motor oil. For these items, contact your local county hazardous waste disposal program.'},
    {q:'Do you offer valet trash services for apartment communities?',a:'Yes — we offer scheduled valet trash pickup programs for apartment communities, condo associations, and HOAs. Contact us to discuss service plans for your property.'},
    {q:'Can you handle a full estate cleanout?',a:'Absolutely. We specialize in estate cleanouts — clearing furniture, appliances, personal belongings, and debris from entire properties. We work efficiently and compassionately, especially for families managing a difficult transition.'},
    {q:'Do you remove construction debris from job sites?',a:'Yes — we work with contractors and property owners to remove construction debris from renovation and demolition projects. We offer flexible scheduling to fit your job site timeline.'},
  ];
  return ljrHead('FAQ | Lion Junk Removal & Demolition | Common Questions Answered','Answers to common questions about junk removal, pricing, same-day service, what we take, and how to book Lion Junk Removal in Central Florida.','/faq') +
  ljrNav('faq') + `
<div style="background:var(--dark);padding:64px 0 48px;border-bottom:4px solid var(--red);">
  <div class="ljr-c ljr-reveal">
    <div class="ljr-eyebrow" style="color:var(--red);">FAQ</div>
    <h1 class="ljr-h2" style="color:#fff;font-size:clamp(36px,5vw,72px);">Frequently Asked Questions</h1>
    <p style="font-size:17px;color:rgba(255,255,255,.75);max-width:620px;line-height:1.8;">Everything you need to know about our junk removal and demolition services across Central Florida.</p>
  </div>
</div>
<div class="ljr-trust-bar"><div class="ljr-c"><div class="ljr-trust-in"><span class="ljr-trust-item">Licensed &amp; Insured</span><span class="ljr-trust-item">Same-Day Available</span><span class="ljr-trust-item">Free Quotes</span><span class="ljr-trust-item">No Hidden Fees</span></div></div></div>
<section class="ljr-s"><div class="ljr-c ljr-reveal">
  <div class="ljr-faq-list">
    ${faqs.map((f,i)=>`
    <div class="ljr-faq-item${i===0?' open':''}">
      <button class="ljr-faq-btn" type="button">
        <span>${f.q}</span>
        <span class="ljr-faq-icon">${i===0?'−':'+'}</span>
      </button>
      <div class="ljr-faq-body"><p>${f.a}</p></div>
    </div>`).join('')}
  </div>
  <div style="text-align:center;margin-top:36px;"><a href="/contact" class="ljr-btn-red">Still Have Questions? Contact Us →</a></div>
</div></section>
<div class="ljr-cta-band ljr-reveal"><div class="ljr-c"><h2>Ready to Book?</h2><p>Get a free quote today — same-day service available across Central Florida.</p><a href="/contact" class="ljr-btn-red">Book Now →</a></div></div>
` + ljrFooter() + `</div></body></html>`;
}

function ljrBuildContactPage() {
  return ljrHead('Contact Lion Junk Removal & Demolition | Free Quote | Orlando FL','Contact Lion Junk Removal & Demolition for a free quote. Serving Orlando, Kissimmee, Winter Park, Sanford, Clermont, Daytona Beach, and all of Central Florida.','/contact') +
  ljrNav('contact') + `
<div style="background:var(--dark);padding:64px 0 48px;border-bottom:4px solid var(--red);">
  <div class="ljr-c ljr-reveal">
    <div class="ljr-eyebrow" style="color:var(--red);">Get In Touch</div>
    <h1 class="ljr-h2" style="color:#fff;font-size:clamp(36px,5vw,72px);">Get Your Free Quote Today</h1>
    <p style="font-size:17px;color:rgba(255,255,255,.75);max-width:620px;line-height:1.8;">Fill out the form and we'll get back to you fast. Same-day service available across Central Florida.</p>
  </div>
</div>
<div class="ljr-trust-bar"><div class="ljr-c"><div class="ljr-trust-in"><span class="ljr-trust-item">Licensed &amp; Insured</span><span class="ljr-trust-item">Same-Day Available</span><span class="ljr-trust-item">Free Quotes</span><span class="ljr-trust-item">No Hidden Fees</span></div></div></div>
<section class="ljr-s"><div class="ljr-c">
  <div class="ljr-contact-grid ljr-reveal">
    <div class="ljr-contact-info">
      <h3>Lion Junk Removal &amp; Demolition</h3>
      <div class="ljr-contact-row"><div class="ljr-contact-icon">📍</div><div><div class="ljr-contact-label">Service Area</div><div class="ljr-contact-val">Orlando, FL &amp; Central Florida</div></div></div>
      <div class="ljr-contact-row"><div class="ljr-contact-icon">📞</div><div><div class="ljr-contact-label">Phone</div><div class="ljr-contact-val">(407) 555-0100</div></div></div>
      <div class="ljr-contact-row"><div class="ljr-contact-icon">⏰</div><div><div class="ljr-contact-label">Hours</div><div class="ljr-contact-val">Mon–Sat: 7am – 7pm<br>Sun: 8am – 5pm</div></div></div>
      <div class="ljr-contact-row"><div class="ljr-contact-icon">⚡</div><div><div class="ljr-contact-label">Response Time</div><div class="ljr-contact-val">Same-day booking available.<br>We respond within 1 hour.</div></div></div>
      <div class="ljr-areas-list">
        <h4>Areas We Serve</h4>
        <p>Orlando · Kissimmee · Winter Park · Sanford · Clermont · Daytona Beach · Lake Nona · Altamonte Springs · Longwood · Oviedo · Apopka · Deltona · DeLand · Palm Bay · Melbourne · and 25+ more cities</p>
      </div>
    </div>
    <div class="ljr-form-wrap">
      <iframe src="https://links.jrzmarketing.com/widget/form/OwQ8iBk35bgtg1SBPyVb" style="width:100%;height:1130px;border:none;border-radius:3px" id="inline-OwQ8iBk35bgtg1SBPyVb" data-layout="{'id':'INLINE'}" data-trigger-type="alwaysShow" data-activation-type="alwaysActivated" data-deactivation-type="neverDeactivate" data-form-name="Lion Junk Removal Demolition" data-height="1130" data-layout-iframe-id="inline-OwQ8iBk35bgtg1SBPyVb" data-form-id="OwQ8iBk35bgtg1SBPyVb" title="Lion Junk Removal Demolition"></iframe>
      <script src="https://links.jrzmarketing.com/js/form_embed.js"></script>
    </div>
  </div>
</div></section>
` + ljrFooter() + `</div></body></html>`;
}

app.get('/sofia/lion-junk-removal', async (req, res) => {
  try {
    const [homeKw, svcKw, indKw] = await Promise.all([
      getKeywordData('junk removal orlando', 'orlando', 2840).catch(()=>[]),
      getKeywordData('junk removal services central florida', 'orlando', 2840).catch(()=>[]),
      getKeywordData('commercial junk removal orlando', 'orlando', 2840).catch(()=>[]),
    ]);
    const cacheId = crypto.randomBytes(8).toString('hex');
    const pages = {
      'home': ljrBuildHomePage(homeKw),
      'services': ljrBuildServicesPage(svcKw),
      'industries': ljrBuildIndustriesPage(indKw),
      'about': ljrBuildAboutPage(),
      'faq': ljrBuildFAQPage(),
      'contact': ljrBuildContactPage(),
    };
    websitePackageCache.set(cacheId, { pages, createdAt: Date.now() });
    const hubHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Lion JR — Download Hub</title>
    <style>body{font-family:Inter,sans-serif;background:#f8f9fa;padding:40px;max-width:800px;margin:0 auto;}
    h1{font-size:28px;font-weight:900;color:#111;margin-bottom:8px;}
    p{color:#666;margin-bottom:28px;}
    .page-list{display:grid;gap:12px;}
    .page-item{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;}
    .page-name{font-weight:700;color:#111;font-size:16px;}
    .page-slug{font-size:13px;color:#888;margin-top:2px;}
    a.dl-btn{background:#c01414;color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:800;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;}
    a.dl-btn:hover{background:#a01010;}
    .note{margin-top:28px;padding:16px 20px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;font-size:13px;color:#856404;}
    </style></head><body>
    <h1>🦁 Lion Junk Removal — Website Download Hub</h1>
    <p>6 pages ready. Click each to download HTML. Paste into GHL Custom HTML pages.</p>
    <div class="page-list">
    ${Object.entries(pages).map(([key])=>`
      <div class="page-item">
        <div><div class="page-name">${key.charAt(0).toUpperCase()+key.slice(1)}</div><div class="page-slug">/${key === 'home' ? '' : key}</div></div>
        <a class="dl-btn" href="/sofia/website-download?id=${cacheId}&page=${key}">Download HTML</a>
      </div>`).join('')}
    </div>
    <div class="note">⚠️ Links expire in 10 minutes. Download all pages now.</div>
    </body></html>`;
    res.send(hubHtml);
  } catch(e) {
    res.status(500).send('Error building Lion JR website: ' + e.message);
  }
});

// ═══════════════════════════════════════════════════════════
// META ADS MONITOR — runs Monday 8:05am EST
// Pulls 7-day insights for all LiftMo campaigns, scales
// budgets on winners, pauses weak ads, activates cold traffic
// when retargeting converts. Emails a full report to Jose.
// ═══════════════════════════════════════════════════════════

async function runMetaAdsMonitor() {
  console.log('[META] Weekly ads monitor starting...');
  const baseUrl = 'https://graph.facebook.com/v19.0';
  const token = META_ACCESS_TOKEN;
  const results = [];
  const actions = [];

  for (const [key, camp] of Object.entries(META_CAMPAIGNS)) {
    try {
      // Pull 7-day insights
      const insightRes = await axios.get(`${baseUrl}/${camp.id}/insights`, {
        params: {
          fields: 'spend,clicks,impressions,ctr,cpc,cpm,actions,action_values',
          date_preset: 'last_7d',
          access_token: token
        }
      });

      const d = insightRes.data.data[0] || {};
      const spend = parseFloat(d.spend || 0);
      const ctr = parseFloat(d.ctr || 0);
      const cpm = parseFloat(d.cpm || 0);
      const cpc = parseFloat(d.cpc || 0);

      const purchaseAction = (d.actions || []).find(a => a.action_type === 'purchase');
      const purchaseValue = (d.action_values || []).find(a => a.action_type === 'purchase');
      const purchases = parseInt(purchaseAction?.value || 0);
      const revenue = parseFloat(purchaseValue?.value || 0);
      const roas = spend > 0 ? (revenue / spend).toFixed(2) : 0;

      results.push({ name: camp.name, spend, ctr, cpm, cpc, purchases, revenue, roas });

      // SCALE: ROAS >= 3 or 3+ purchases → increase budget 20%
      if ((roas >= 3 || purchases >= 3) && key !== 'c1_cold_traffic') {
        const newBudget = Math.min(Math.round(camp.budget * 1.2), 500000);
        await axios.post(`${baseUrl}/${camp.id}`, null, {
          params: { daily_budget: newBudget, access_token: token }
        });
        actions.push(`✅ SCALED ${camp.name}: budget increased 20% (ROAS: ${roas}x, Purchases: ${purchases})`);
        META_CAMPAIGNS[key].budget = newBudget;
      }

      // ACTIVATE C1: if retargeting has 3+ purchases, turn on cold traffic
      if (purchases >= 3 && key !== 'c1_cold_traffic') {
        await axios.post(`${baseUrl}/${META_CAMPAIGNS.c1_cold_traffic.id}`, null, {
          params: { status: 'ACTIVE', daily_budget: 1000, access_token: token }
        });
        actions.push(`🚀 ACTIVATED C1 Cold Traffic at $10/day — retargeting hit ${purchases} purchases`);
      }

      // KILL weak ads: CTR < 0.5% after $10 spend
      if (spend >= 10 && ctr < 0.5) {
        const adsRes = await axios.get(`${baseUrl}/${camp.adset_id}/ads`, {
          params: { fields: 'id,name,status', access_token: token }
        });
        for (const ad of adsRes.data.data || []) {
          if (ad.status !== 'ACTIVE') continue;
          const adInsight = await axios.get(`${baseUrl}/${ad.id}/insights`, {
            params: { fields: 'spend,ctr', date_preset: 'last_7d', access_token: token }
          });
          const adData = adInsight.data.data[0] || {};
          const adSpend = parseFloat(adData.spend || 0);
          const adCtr = parseFloat(adData.ctr || 0);
          if (adSpend >= 10 && adCtr < 0.5) {
            await axios.post(`${baseUrl}/${ad.id}`, null, {
              params: { status: 'PAUSED', access_token: token }
            });
            actions.push(`⏸ PAUSED weak ad: ${ad.name} (CTR: ${adCtr.toFixed(2)}%, Spend: $${adSpend.toFixed(2)})`);
          }
        }
      }

    } catch (err) {
      results.push({ name: camp.name, error: err.response?.data?.error?.message || err.message });
      actions.push(`⚠️ ERROR pulling ${camp.name}: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  // Build email report
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const rows = results.map(r => r.error
    ? `<tr><td>${r.name}</td><td colspan="6" style="color:red">${r.error}</td></tr>`
    : `<tr>
        <td>${r.name}</td>
        <td>$${r.spend.toFixed(2)}</td>
        <td>${r.purchases}</td>
        <td>$${r.revenue.toFixed(2)}</td>
        <td>${r.roas}x</td>
        <td>${r.ctr.toFixed(2)}%</td>
        <td>$${r.cpm.toFixed(2)}</td>
       </tr>`
  ).join('');

  const actionsHtml = actions.length
    ? actions.map(a => `<li>${a}</li>`).join('')
    : '<li>No automated actions taken this week — campaigns within normal range.</li>';

  const html = `
    <h2 style="font-family:sans-serif">LiftMo Meta Ads — Weekly Report</h2>
    <p style="font-family:sans-serif;color:#666">${now}</p>
    <table border="1" cellpadding="8" cellspacing="0" style="font-family:sans-serif;border-collapse:collapse;width:100%">
      <tr style="background:#1a1a2e;color:white">
        <th>Campaign</th><th>Spend</th><th>Purchases</th><th>Revenue</th><th>ROAS</th><th>CTR</th><th>CPM</th>
      </tr>
      ${rows}
    </table>
    <h3 style="font-family:sans-serif;margin-top:24px">Actions Taken This Week</h3>
    <ul style="font-family:sans-serif">${actionsHtml}</ul>
    <h3 style="font-family:sans-serif">Next 7 Days</h3>
    <ul style="font-family:sans-serif">
      <li>Watch for CTR above 1% — those ads are working</li>
      <li>First 3 purchases triggers automatic budget scale</li>
      <li>C1 Cold Traffic activates automatically when retargeting converts</li>
    </ul>
    <p style="font-family:sans-serif;color:#999;font-size:12px">Automated by JRZ Marketing AI — Armando + Diego</p>
  `;

  await sendEmail(OWNER_CONTACT_ID, `LiftMo Meta Ads — Weekly Report ${now}`, html);
  console.log('[META] Monitor complete. Actions taken:', actions.length);
}

app.post('/meta/ads-monitor', async (req, res) => {
  res.json({ status: 'Meta ads monitor triggered' });
  runMetaAdsMonitor();
});

// ─── Image Generation — Pollinations.ai (100% Free, No Key) ──────────────────
// POST /generate-image
// Body: { prompt, style?, client?, type?, width?, height? }
// style options: "cinematic", "luxury", "editorial", "product", "social"
// type options: "hero", "social", "ad", "portfolio"
// Returns: { imageUrl } — direct JPEG URL (hotlinkable) + base64 for embedding

const STYLE_PROMPTS = {
  cinematic:  'cinematic photography, dramatic lighting, film grain, dark moody atmosphere, professional color grading, 8K',
  luxury:     'luxury brand photography, editorial style, clean minimalist, high-end aesthetic, soft natural light, 8K',
  editorial:  'editorial photography, magazine quality, sharp focus, professional studio lighting, high contrast, 8K',
  product:    'product photography, white background, studio lighting, sharp details, commercial quality, 8K',
  social:     'social media content, vibrant colors, modern aesthetic, eye-catching composition, 4K',
};

async function generatePollinationsImage(prompt, style = 'luxury', width = 1024, height = 1024) {
  const styleModifier = STYLE_PROMPTS[style] || STYLE_PROMPTS.luxury;
  const fullPrompt    = encodeURIComponent(`${prompt}, ${styleModifier}`);
  const url           = `https://image.pollinations.ai/prompt/${fullPrompt}?width=${width}&height=${height}&nologo=true&enhance=true`;

  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });

  const base64   = Buffer.from(response.data).toString('base64');
  const dataUrl  = `data:image/jpeg;base64,${base64}`;
  return { dataUrl, directUrl: url };
}

app.post('/generate-image', async (req, res) => {
  const { prompt, style = 'luxury', client = 'JRZ', type = 'social', width = 1024, height = 1024 } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    console.log(`[Image Gen] Client: ${client} | Type: ${type} | Style: ${style}`);
    console.log(`[Image Gen] Prompt: ${prompt}`);

    const { dataUrl, directUrl } = await generatePollinationsImage(prompt, style, width, height);

    res.json({
      status:     'ok',
      client,
      type,
      style,
      prompt,
      imageUrl:   dataUrl,    // base64 — use in <img src="..."> directly
      directUrl,              // hotlink URL — use in HTML templates or GHL pages
      provider:   'pollinations.ai',
    });

    console.log(`[Image Gen] ✅ Done — ${client} ${type}`);
  } catch (err) {
    console.error('[Image Gen] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /generate-image/preview?prompt=...&style=... — returns the image directly in browser
app.get('/generate-image/preview', async (req, res) => {
  const { prompt = 'luxury brand photo', style = 'luxury', width = 1024, height = 1024 } = req.query;
  try {
    const { dataUrl } = await generatePollinationsImage(prompt, style, Number(width), Number(height));
    res.send(`<html><body style="margin:0;background:#000"><img src="${dataUrl}" style="max-width:100%;display:block;margin:auto"></body></html>`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// GET /generate-image/styles — list all available styles
app.get('/generate-image/styles', (_req, res) => {
  res.json({ styles: Object.keys(STYLE_PROMPTS), provider: 'pollinations.ai', cost: 'free' });
});

// ─── Hero Video Finder — Pexels (Free, No Watermark) ─────────────────────────
// GET /hero-video?query=tattoo+artist&orientation=landscape&size=large
// Returns best cinematic video URL ready to use in <video> tags on any website
// orientation: landscape (default) | portrait | square
// size: large (1080p+) | medium (720p) | small

const PEXELS_VIDEO_NICHES = {
  tattoo:       'tattoo artist studio cinematic',
  restaurant:   'restaurant food cinematic luxury',
  construction: 'construction building cinematic',
  gym:          'gym fitness workout cinematic',
  photography:  'photographer cinematic dark studio',
  wedding:      'wedding cinematic luxury',
  realestate:   'luxury real estate home cinematic',
  spa:          'spa wellness luxury cinematic',
  barbershop:   'barbershop haircut cinematic',
  law:          'law office professional cinematic',
  dental:       'dental clinic modern cinematic',
  roofing:      'roofing construction aerial cinematic',
  cleaning:     'cleaning service professional cinematic',
  plumbing:     'plumbing service cinematic',
  landscape:    'landscape gardening cinematic',
};

app.get('/hero-video', async (req, res) => {
  const { query, orientation = 'landscape', size = 'large', niche } = req.query;

  const searchQuery = query || PEXELS_VIDEO_NICHES[niche] || 'cinematic business professional';

  try {
    const response = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: PEXELS_API_KEY },
      params: { query: searchQuery, orientation, size, per_page: 5, page: 1 },
    });

    const videos = response.data.videos;
    if (!videos || videos.length === 0) return res.status(404).json({ error: 'No videos found' });

    // Pick the best quality file from the first result
    const top = videos[0];
    const files = top.video_files.sort((a, b) => b.width - a.width);
    const best  = files.find(f => f.width >= 1280) || files[0];
    const thumb = files.find(f => f.width <= 640)  || files[files.length - 1];

    res.json({
      status:      'ok',
      query:       searchQuery,
      videoUrl:    best.link,       // use in <video src="..."> — full quality
      thumbUrl:    thumb.link,      // low-res version for mobile / lazy load
      previewUrl:  top.image,       // static poster frame for before video loads
      width:       best.width,
      height:      best.height,
      duration:    top.duration,
      photographer: top.user.name,
      pexelsUrl:   top.url,
      // Drop-in HTML snippet ready to paste into any GHL page
      htmlSnippet: `<video autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;z-index:0" poster="${top.image}"><source src="${best.link}" type="video/mp4"></video>`,
    });

  } catch (err) {
    console.error('[Hero Video] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /hero-video/niches — list all available niche shortcuts
app.get('/hero-video/niches', (_req, res) => {
  res.json({ niches: Object.keys(PEXELS_VIDEO_NICHES), usage: 'GET /hero-video?niche=tattoo' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE ADS ENDPOINTS
// Developer Token: saVkv7v1x6X9dsnDyPVCYg | MCC: 646-514-4890
// Basic Access approved April 20, 2026
// Default customer: 5192590797 (JRZ Marketing)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ADS_CUSTOMER = '5192590797';

// GET /google-ads/accounts — list ALL accounts accessible under MCC 646-514-4890
// Use this to discover customer IDs for every client and verify access
app.get('/google-ads/accounts', async (req, res) => {
  try {
    const accounts = await googleAds.listAccessibleCustomers();

    // Cross-reference with known client configs
    const CLIENT_MAP = {
      '5192590797': 'JRZ Marketing',
    };

    const enriched = accounts.map(a => ({
      ...a,
      knownClient: CLIENT_MAP[a.customerId] || null,
    }));

    res.json({
      ok: true,
      mcc: googleAds.MANAGER_ID,
      total: enriched.length,
      accounts: enriched,
      note: 'Match customerId values to your clients, then update their config files',
    });
  } catch (err) {
    console.error('[GoogleAds] accounts error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /google-ads/test — verify API connection, returns account summary
app.get('/google-ads/test', async (req, res) => {
  try {
    const customerId = req.query.cid || DEFAULT_ADS_CUSTOMER;
    const summary = await googleAds.getAccountSummary(customerId, 30);
    res.json({ ok: true, customerId, summary });
  } catch (err) {
    console.error('[GoogleAds] test error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /google-ads/performance?cid=5192590797&days=7 — campaign performance
app.get('/google-ads/performance', async (req, res) => {
  try {
    const customerId = req.query.cid || DEFAULT_ADS_CUSTOMER;
    const days = parseInt(req.query.days) || 7;
    const [campaigns, keywords, ads] = await Promise.all([
      googleAds.getCampaignPerformance(customerId, days),
      googleAds.getKeywordPerformance(customerId, days),
      googleAds.getAdPerformance(customerId, days),
    ]);
    res.json({ ok: true, customerId, days, campaigns, keywords, ads });
  } catch (err) {
    console.error('[GoogleAds] performance error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /google-ads/report?cid=5192590797&days=30 — full weekly report with budget pacing alerts
app.get('/google-ads/report', async (req, res) => {
  try {
    const customerId = req.query.cid || DEFAULT_ADS_CUSTOMER;
    const clientName = req.query.name || 'JRZ Marketing';
    const report = await googleAds.getWeeklyReport(customerId, clientName);
    res.json({ ok: true, customerId, report });
  } catch (err) {
    console.error('[GoogleAds] report error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /google-ads/build-campaign — build full search campaign (paused by default)
// Body: { cid, name, budget, keywords, headlines, descriptions, finalUrl, location }
// Example: { name: "JRZ Marketing - Local SEO", budget: 15, keywords: ["seo agency houston"], ... }
app.post('/google-ads/build-campaign', async (req, res) => {
  try {
    const {
      cid = DEFAULT_ADS_CUSTOMER,
      name,
      budget,
      keywords = [],
      headlines = [],
      descriptions = [],
      finalUrl,
      location = 'Houston, TX',
      matchType = 'PHRASE',
    } = req.body;

    if (!name || !budget || !keywords.length || !headlines.length || !descriptions.length || !finalUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Required: name, budget, keywords[], headlines[], descriptions[], finalUrl',
        example: {
          cid: '5192590797',
          name: 'JRZ Marketing - Local SEO',
          budget: 15,
          keywords: ['seo agency houston', 'digital marketing houston'],
          headlines: ['Houston SEO Agency', 'Grow Your Business Online', 'Top Digital Marketing'],
          descriptions: ['Get more leads with proven SEO strategy.', 'We grow Houston businesses online.'],
          finalUrl: 'https://jrzmarketing.com',
          location: 'Houston, TX',
        },
      });
    }

    const result = await googleAds.buildSearchCampaign(cid, {
      name, budget, keywords, headlines, descriptions, finalUrl, location, matchType,
    });

    res.json({ ok: true, customerId: cid, result, note: 'Campaign created PAUSED — enable manually after review' });
  } catch (err) {
    console.error('[GoogleAds] build-campaign error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /google-ads/campaign/status — pause or enable a campaign
// Body: { cid, campaignResourceName, status: "PAUSED" | "ENABLED" }
app.post('/google-ads/campaign/status', async (req, res) => {
  try {
    const {
      cid = DEFAULT_ADS_CUSTOMER,
      campaignResourceName,
      status = 'PAUSED',
    } = req.body;

    if (!campaignResourceName) {
      return res.status(400).json({ ok: false, error: 'Required: campaignResourceName (e.g. customers/5192590797/campaigns/12345)' });
    }

    const result = await googleAds.setCampaignStatus(cid, campaignResourceName, status.toUpperCase());
    res.json({ ok: true, customerId: cid, campaignResourceName, status, result });
  } catch (err) {
    console.error('[GoogleAds] campaign/status error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /google-ads/query — run raw GAQL query (power users only)
// Body: { cid, query }
app.post('/google-ads/query', async (req, res) => {
  try {
    const { cid = DEFAULT_ADS_CUSTOMER, query } = req.body;
    if (!query) return res.status(400).json({ ok: false, error: 'Required: query (GAQL string)' });
    const rows = await googleAds.gaqlSearch(cid, query);
    res.json({ ok: true, customerId: cid, rowCount: rows.length, rows });
  } catch (err) {
    console.error('[GoogleAds] query error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
  await loadDMState();  // restore DM dedup sets so Armando remembers conversations

  // ── Real-time cron failure alerts ─────────────────────────────────────────
  // Any runCron() that throws will DM Jose immediately via GHL
  setCronErrorHandler(async (cronName, errorMessage) => {
    const time = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
    const msg  = `🚨 Cron failed: [${cronName}] at ${time} EST\n\n${errorMessage.slice(0, 300)}`;
    try {
      await axios.post(
        'https://services.leadconnectorhq.com/conversations/messages',
        { type: 'SMS', contactId: OWNER_CONTACT_ID, message: msg },
        { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' } }
      );
      console.log(`[CronAlert] Sent failure alert for [${cronName}] to Jose`);
    } catch (e) {
      console.error('[CronAlert] Failed to send alert:', e.message);
    }
  });
});

// Save KPIs every 30 minutes so restarts lose at most 30 min of counts
setInterval(saveOfficeKPI, 30 * 60 * 1000);

// Save DM state every 5 minutes — Armando remembers conversations across restarts
setInterval(saveDMState, 5 * 60 * 1000);

// Save KPIs + DM state on graceful shutdown (Render sends SIGTERM before restarting)
process.on('SIGTERM', async () => {
  console.log('[Office] SIGTERM received — saving state before shutdown...');
  await Promise.all([saveOfficeKPI(), saveDMState()]);
  process.exit(0);
});
