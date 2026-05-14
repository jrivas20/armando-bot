// modules/agents/marco.js
// ─── Marco — Content Director ────────────────────────────────────────────────
// All Marco functions. Instantiate via require('./modules/agents/marco')(ctx).
'use strict';

module.exports = function createMarco({
  app,
  anthropic, axios,
  sendEmail, logActivity, setAgentBusy, setAgentIdle, agentChat,
  getWeeklyStats, loadContentStrategy, saveCloudinaryJSON,
  OWNER_CONTACT_ID, NEWS_API_KEY, OFFICE_KPI,
}) {

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

// ─── REPURPOSE BRIEF — triggered by Sofia after blog publish or rank win ──────
// signal: { type: 'blog_published'|'rank_win', clientName, keyword, title, blogUrl?, industry?, position?, change? }
async function runMarcoRepurposeBrief(signal) {
  if (!signal || !signal.keyword) return;
  const { type, clientName, keyword, title, blogUrl, industry, position, change } = signal;
  const isRankWin = type === 'rank_win';
  const context = isRankWin
    ? `Sofia's rank tracking found "${title}" is now ranking at position #${position} for "${keyword}"${change > 0 ? ` (up ${change} spots)` : ''}.`
    : `Sofia just published a new blog post: "${title}" targeting keyword "${keyword}" for ${clientName} (${industry || 'local business'}). Post URL: ${blogUrl || 'n/a'}`;

  console.log(`[Marco] Repurpose brief triggered — ${type} | ${keyword}`);
  logActivity('marco', 'action', `Repurpose brief: ${type} signal for "${keyword}" (${clientName})`);

  const aiRes = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: `You are Marco, Content Director at JRZ Marketing. A performance signal just came in from Sofia (Web/SEO agent).

SIGNAL:
${context}

Your job: Generate a repurpose brief so José can immediately turn this SEO content into paid + organic social assets.

Return ONLY valid JSON:
{
  "signalSummary": "1 sentence: why this content is worth repurposing right now",
  "socialIdeas": [
    {
      "hook": "scroll-stopping hook (Who/What/How format)",
      "format": "carousel or reel",
      "caption_start": "first 2 sentences of the caption — emotional, direct, save trigger",
      "platform": "Instagram or TikTok",
      "angle": "what specific angle makes this social-native (not just blog summary)"
    },
    {
      "hook": "different hook, different angle",
      "format": "carousel or reel",
      "caption_start": "first 2 sentences",
      "platform": "Instagram or Facebook",
      "angle": "angle"
    },
    {
      "hook": "third hook — contrarian or story-based",
      "format": "carousel or reel or story",
      "caption_start": "first 2 sentences",
      "platform": "Instagram",
      "angle": "angle"
    }
  ],
  "adCreative": [
    {
      "platform": "Meta (Facebook/Instagram Ads)",
      "objective": "Traffic or Lead Gen",
      "headline": "30-char Meta ad headline",
      "primaryText": "125-char primary text — emotional hook, specific benefit, no fluff",
      "cta": "Learn More or Book Now or Get Quote",
      "targetAudience": "who to target (age, interest, location)"
    },
    {
      "platform": "Google Search Ads",
      "objective": "Search intent — bottom of funnel",
      "headline1": "30-char headline (include keyword)",
      "headline2": "30-char headline (benefit)",
      "headline3": "30-char headline (CTA)",
      "description1": "90-char description 1",
      "description2": "90-char description 2"
    }
  ],
  "marcoNote": "1 sentence direct recommendation to José on where to put budget first"
}` }],
  });

  const brief = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const logoUrl = 'https://assets.cdn.filesafe.space/d7iUPfamAaPlSBNj6IhT/media/6957081ee4125a4ef97efc62.png';
  const signalBadge = isRankWin ? `🏆 Rank Win — #${position}` : '📝 Blog Published';
  const signalColor = isRankWin ? '#16a34a' : '#2563eb';

  const socialCards = (brief.socialIdeas || []).map((idea, i) => `
    <div style="background:#f9fafb;border-radius:10px;padding:18px 22px;margin-bottom:10px;border-left:4px solid #0a0a0a">
      <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Idea ${i + 1} · ${idea.platform} · ${idea.format}</div>
      <p style="font-size:15px;font-weight:700;color:#0a0a0a;margin:0 0 6px">"${idea.hook}"</p>
      <p style="font-size:13px;color:#555;line-height:1.6;margin:0 0 8px">${idea.caption_start}</p>
      <p style="font-size:12px;color:#7c3aed;font-style:italic;margin:0">↳ ${idea.angle}</p>
    </div>`).join('');

  const adCards = (brief.adCreative || []).map(ad => `
    <div style="background:#f0f9ff;border-radius:10px;padding:18px 22px;margin-bottom:10px;border-left:4px solid #0ea5e9">
      <div style="font-size:10px;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">${ad.platform} · ${ad.objective}</div>
      ${ad.headline ? `<p style="font-size:15px;font-weight:700;color:#0a0a0a;margin:0 0 4px">${ad.headline}</p>
      <p style="font-size:13px;color:#555;margin:0 0 6px">${ad.primaryText}</p>
      <span style="background:#0ea5e9;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px">${ad.cta}</span>
      <p style="font-size:12px;color:#666;margin:8px 0 0">🎯 ${ad.targetAudience}</p>` : ''}
      ${ad.headline1 ? `<p style="font-size:14px;font-weight:700;color:#0a0a0a;margin:0 0 4px">${ad.headline1} | ${ad.headline2} | ${ad.headline3}</p>
      <p style="font-size:13px;color:#555;margin:0 0 4px">${ad.description1}</p>
      <p style="font-size:13px;color:#555;margin:0">${ad.description2}</p>` : ''}
    </div>`).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f4f4f4;padding:32px 20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:#0a0a0a;padding:22px 32px;display:flex;align-items:center;justify-content:space-between">
    <img src="${logoUrl}" style="height:32px"/>
    <span style="background:${signalColor};color:#fff;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:5px 12px;border-radius:100px">${signalBadge}</span>
  </div>
  <div style="background:#0a0a0a;padding:22px 32px;border-bottom:3px solid ${signalColor}">
    <h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px">Repurpose Brief — ${clientName}</h1>
    <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0">Keyword: "${keyword}"</p>
  </div>
  <div style="padding:28px 32px">
    <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin-bottom:24px;border-left:4px solid ${signalColor}">
      <p style="font-size:14px;color:#0a0a0a;margin:0;line-height:1.6">${brief.signalSummary}</p>
    </div>
    <p style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">📱 3 Social Content Ideas</p>
    ${socialCards}
    <p style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin:24px 0 12px">💰 Paid Ad Creative (Ready to Launch)</p>
    ${adCards}
    <div style="background:#0a0a0a;border-radius:10px;padding:16px 20px;margin-top:24px">
      <p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Marco's Recommendation</p>
      <p style="font-size:14px;color:#fff;font-style:italic;margin:0">"${brief.marcoNote}"</p>
    </div>
    ${blogUrl ? `<p style="margin-top:16px;font-size:13px;color:#6b7280">Blog: <a href="${blogUrl}" style="color:#2563eb">${blogUrl}</a></p>` : ''}
  </div>
  <div style="background:#0a0a0a;padding:18px 32px;text-align:center">
    <p style="font-size:11px;color:rgba(255,255,255,0.25)">Marco — JRZ Marketing AI Content Director</p>
  </div>
</div></body></html>`;

  const subjectEmoji = isRankWin ? '🏆' : '📝';
  await sendEmail(OWNER_CONTACT_ID, `${subjectEmoji} Marco: Repurpose Brief — "${keyword}" (${clientName})`, html);
  console.log(`[Marco] ✅ Repurpose brief sent — ${type} | ${keyword}`);
  logActivity('marco', 'success', `Repurpose brief delivered — ${keyword} for ${clientName} (${type})`);
}

app.post('/marco/content-brief', async (_req, res) => {
  try {
    runMarcoContentBrief();
    res.json({ status: 'ok', message: 'Marco is building your weekly content brief' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
app.get('/marco/content-brief', async (_req, res) => {
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
app.get('/marco/trend-alert', async (_req, res) => {
  try {
    runMarcoTrendAlert();
    res.json({ status: 'ok', message: 'Marco is checking for trending topics' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/marco/repurpose-brief', async (req, res) => {
  try {
    const signal = req.body;
    if (!signal || !signal.keyword) return res.status(400).json({ status: 'error', message: 'signal.keyword required' });
    runMarcoRepurposeBrief(signal); // non-blocking
    res.json({ status: 'ok', message: 'Marco is building your repurpose brief' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});


  return {
    runMarcoContentBrief,
    runMarcoTrendAlert,
    runMarcoRepurposeBrief,
  };
};
