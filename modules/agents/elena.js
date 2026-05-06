// modules/agents/elena.js
// ─── Elena — Client Success Manager ──────────────────────────────────────────
// All Elena functions. Instantiate via require('./modules/agents/elena')(ctx).
'use strict';

module.exports = function createElena({
  app,
  anthropic, axios, crypto, FormData,
  sendEmail, logActivity,
  GHL_API_KEY, GHL_LOCATION_ID,
  GHL_AGENCY_KEY, GHL_COMPANY_ID,
  OWNER_CONTACT_ID, BOOKING_URL,
  CLOUDINARY_CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
}) {

// ═══════════════════════════════════════════════════════════
// ELENA — CLIENT SUCCESS MANAGER
//   Manages all 32 JRZ Marketing subaccounts
//   Sends monthly reports, weekly health checks, win alerts
//   Speaks Spanish to all clients (English only to Cooney Homes)
// ═══════════════════════════════════════════════════════════

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
      params: { companyId: GHL_COMPANY_ID, limit: 100 },
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
          locationId: client.locationId,
          lang: client.lang || 'es',
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

  // ── Cross-agent signals ────────────────────────────────────────────────────
  // Signal Diego: create GHL task per at-risk client (delivery review)
  // Signal Armando: add 'at-risk' tag to contact (triggers re-engagement workflow)
  fireElenaSignals(alerts); // non-blocking
}

async function fireElenaSignals(alerts) {
  if (!alerts || alerts.length === 0) return;
  console.log(`[Elena → Diego+Armando] Firing cross-agent signals for ${alerts.length} at-risk accounts...`);

  for (const alert of alerts) {
    try {
      // Find this client's contact in JRZ Marketing main account
      const search = await axios.get('https://services.leadconnectorhq.com/contacts/', {
        headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' },
        params: { locationId: GHL_LOCATION_ID, query: alert.name, limit: 5 },
      });

      const contact = (search.data?.contacts || [])[0];
      if (!contact) {
        console.log(`[Elena] No contact found for "${alert.name}" — skipping signal`);
        continue;
      }

      const contactId = contact.id;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);

      // Signal Diego → create delivery review task in GHL
      await axios.post(
        `https://services.leadconnectorhq.com/contacts/${contactId}/tasks`,
        {
          title: `[Diego] Delivery review — ${alert.name} (Grade ${alert.grade})`,
          body: `Elena health check flagged this account.\nGrade: ${alert.grade} (${alert.gradeLabel}) | Score: ${alert.score}/100\nOpp drop: ${alert.oppDrop > 0 ? `−${alert.oppDrop}` : 'none'} | Contact drop: ${alert.contactDrop > 0 ? `−${alert.contactDrop}` : 'none'} | Last activity: ${alert.daysSinceActivity >= 999 ? 'no opps' : `${alert.daysSinceActivity} days ago`}\n\nAction: Check delivery status, resolve any blockers, confirm active work is moving.`,
          dueDate: dueDate.toISOString(),
          status: 'incompleted',
        },
        { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
      );

      // Signal Armando → add 'at-risk' tag + send re-engagement message directly to client
      const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
      const alreadyTagged    = currentTags.includes('at-risk');
      const alreadyMessaged  = currentTags.includes('re-engaged');

      const newTags = [...currentTags];
      if (!alreadyTagged)   newTags.push('at-risk');
      if (!alreadyMessaged) newTags.push('re-engaged');

      if (!alreadyTagged || !alreadyMessaged) {
        await axios.put(
          `https://services.leadconnectorhq.com/contacts/${contactId}`,
          { tags: newTags },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
        );
      }

      // Only send re-engagement message once (skip if already messaged this cycle)
      if (!alreadyMessaged) {
        const isSpanish  = (alert.lang || 'es') === 'es';
        const isChurn    = alert.grade === 'D';
        const clientName = alert.name;
        const contactFirstName = contact.firstName || contact.name?.split(' ')[0] || clientName;

        // Build internal context for Claude — never exposed to client
        const internalContext = [
          isChurn ? 'This client is at serious churn risk.' : 'This client is showing early churn signals.',
          alert.oppDrop > 0 ? `Pipeline dropped by ${alert.oppDrop} opportunities.` : '',
          alert.contactDrop > 0 ? `Contact database shrank by ${alert.contactDrop}.` : '',
          alert.isInactive ? `No meaningful account activity in ${alert.daysSinceActivity} days.` : '',
        ].filter(Boolean).join(' ');

        const msgRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `You are Armando, writing a re-engagement message on behalf of José Rivas (founder of JRZ Marketing) to a client named ${contactFirstName} from ${clientName}.

INTERNAL CONTEXT (never mention this to the client):
${internalContext}

RULES:
- Write in ${isSpanish ? 'Spanish' : 'English'}
- Sound like a genuine personal message from José, NOT a template
- NEVER mention scores, grades, health checks, metrics, or any internal data
- Tone: warm, human, slightly concerned — like a founder checking in on a relationship
- If Grade D (churn risk): slightly more direct — "I wanted to connect personally to make sure we're on the right track"
- If Grade C (at risk): lighter — "I realized I haven't personally checked in recently"
- End with one soft CTA: ask for 15 minutes this week or ask them to reply
- Max 4 sentences total. No greetings like "Dear" — start with their first name directly.
- NO subject line, NO HTML — plain text message body only.

Return ONLY the message text, nothing else.` }],
        });

        const messageBody = msgRes.content[0].text.trim();
        const subject = isSpanish
          ? `${contactFirstName}, quería conectar contigo personalmente`
          : `${contactFirstName}, wanted to connect with you personally`;

        const emailHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:520px">
<p>${messageBody.replace(/\n/g, '</p><p>')}</p>
<p style="margin-top:24px;color:#555;font-size:13px">—<br><strong>José Rivas</strong><br>JRZ Marketing<br><a href="https://jrzmarketing.com" style="color:#2563eb">jrzmarketing.com</a></p>
</div>`;

        await sendEmail(contactId, subject, emailHtml);
        console.log(`[Elena → Armando] Re-engagement message sent to ${contactFirstName} (${clientName})`);
        logActivity('elena', 'action', `Re-engagement sent to ${clientName} — Grade ${alert.grade}, personal message delivered by Armando`);
      }

      console.log(`[Elena → Diego+Armando] Signals fired for ${alert.name} — task created, at-risk tag + re-engagement message sent`);
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      console.error(`[Elena] Cross-agent signal failed for ${alert.name}:`, err.message);
    }
  }
  console.log('[Elena] Cross-agent signals complete.');
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



app.get('/elena/monthly-reports',async(_q,r)=>{try{elenaMonthlyReports();r.json({status:'ok'});}catch(e){r.status(500).json({status:'error',message:e.message});}});

app.get('/elena/health-check',async(_q,r)=>{try{elenaHealthCheck();r.json({status:'ok'});}catch(e){r.status(500).json({status:'error',message:e.message});}});

  return {
    getElenaClients,
    elenaHealthCheck,
    elenaMonthlyReports,
    elenaMidMonthCheckIn,
    elenaQuarterlyReport,
    elenaSendWelcomeEmail,
    elenaSendClientReport,
    getSubaccountStats,
    getSubaccountOpportunities,
  };
};


// test