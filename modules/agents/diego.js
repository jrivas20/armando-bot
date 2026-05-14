// modules/agents/diego.js
// ─── Diego — Project Manager ─────────────────────────────────────────────────
// All Diego functions. Instantiate via require('./modules/agents/diego')(ctx).
'use strict';

module.exports = function createDiego({
  app,
  anthropic, axios, crypto, FormData,
  sendEmail, logActivity, setAgentBusy, setAgentIdle, agentChat,
  getElenaClients, saveCloudinaryJSON,
  GHL_API_KEY, GHL_LOCATION_ID,
  OWNER_CONTACT_ID,
  CLOUDINARY_CLOUD, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
  STALE_DAYS, OFFICE_KPI,
}) {

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
app.get('/diego/weekly-report', async (_req, res) => {
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
app.get('/diego/standup', async (_req, res) => {
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
app.get('/diego/scorecard', async (_req, res) => {
  try {
    runDiegoScorecard();
    res.json({ status: 'ok', message: 'Diego is building the monthly client scorecard' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});



  return {
    runDiegoWeeklyReport,
    runDiegoScorecard,
    runDiegoStandup,
  };
};
