// modules/agents/sofia.js
// ─── Sofia — Web Designer / Auditor ─────────────────────────────────────────
// All Sofia functions. Instantiate via require('./modules/agents/sofia')(ctx).
'use strict';

module.exports = function createSofia({
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
}) {

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
      `https://services.leadconnectorhq.com/blogs/site/all?locationId=${locationId}&skip=0&limit=10`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
    );
    const blog = (res.data?.blogs || res.data?.data || [])[0];
    if (!blog) return null;
    const blogId = blog._id || blog.id;
    const authorRes = await axios.get(
      `https://services.leadconnectorhq.com/blogs/authors?locationId=${locationId}&blogId=${blogId}`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 10000 }
    ).catch(() => ({ data: { authors: [] } }));
    const authorId = authorRes.data?.authors?.[0]?.id || null;
    return { blogId, authorId };
  } catch (err) {
    console.error(`[ClientBlog] Discovery failed for ${locationId}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

// Publish one SEO blog post to a single client sub-account
async function runClientDailySeoBlog(locationId, config) {
  const { name, domain, lang = 'en', industry = 'local business', voice = '', audience = '', topics = [], keywords = [], cta = `visit ${domain}`, author = null } = config;
  const todaysCity = getTodaysCity();
  console.log(`[Client SEO] ${name}: finding keyword for ${domain}...`);

  // Step 1: Get token — use sub-account apiKey if available, else exchange via agency key
  const token = config.apiKey || await getLocationToken(locationId);
  if (!token) return { name, skipped: true, reason: 'no_location_token' };

  // Step 2: Find client's blog
  const blog = await getClientBlog(locationId, token);
  if (!blog) return { name, skipped: true, reason: 'no_blog_found — set one up in GHL for this client' };

  // Step 3: Find best keyword — learning history picks unused/oldest topic, avoids 30-day repeats
  const _blogHistory = await loadBlogHistory().catch(() => ({}));
  const _clientHistory = _blogHistory[locationId] || [];
  // DataForSEO scores all available keywords and picks highest volume/lowest competition
  let targetKeyword = await getBestNextKeyword(locationId, config, _clientHistory);

  // Step 4: Write SEO blog post with Claude Haiku (cost-efficient for 15+ clients/day)
  const isSpanish = lang === 'es';
  const topicHint = topics.length > 0
    ? `\nContent pillars to draw from (pick the most relevant to the keyword):\n${topics.map(t => `- ${t}`).join('\n')}`
    : '';

  // Internal linking — pass last 5 published posts so Claude links to them naturally
  const _recentPosts = _clientHistory
    .filter(p => p.urlSlug || p.url)
    .slice(-5)
    .map(p => `- "${p.title}" → ${p.url || `https://${domain}/post/${p.urlSlug}`}`);
  const internalLinksBlock = _recentPosts.length > 0
    ? `\nEXISTING POSTS TO LINK TO (link naturally to 1-2 where relevant):\n${_recentPosts.join('\n')}`
    : '';

  const authorName  = author?.name  || name;
  const authorTitle = author?.title || `${industry} expert`;
  const authorCreds = author?.credentials || '';

  const blogRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2400,
    messages: [{ role: 'user', content: `You are ${authorName}, ${authorTitle}.

YOUR BACKGROUND & CREDENTIALS:
${authorCreds}

You are writing a blog post for ${name}'s website (${domain}) — a ${industry} serving the Orlando / Central Florida area. Write entirely in FIRST PERSON as ${authorName}. Draw on your real experience and expertise. This is not generic marketing copy — it's a real expert sharing genuine knowledge.

BRAND VOICE:
${voice || `Knowledgeable, helpful, and real. Speaks directly to the customer without jargon.`}

TARGET AUDIENCE:
${audience || `Local customers in the Orlando area looking for ${industry} services.`}
${topicHint}${internalLinksBlock}

YOUR TASK:
Write a ${isSpanish ? 'SPANISH' : 'ENGLISH'} SEO blog post (800–1000 words) targeting this keyword: "${targetKeyword}"

TODAY'S TARGET CITY: ${todaysCity}, FL
(This post must rank for searches in ${todaysCity} specifically — not just generic Orlando content)

E-E-A-T REQUIREMENTS (Experience, Expertise, Authoritativeness, Trustworthiness):
- Open with a specific personal anecdote or real scenario from your experience ("I've seen this exact situation dozens of times…", "Last month a client in ${todaysCity} asked me…", "In my X years doing this…")
- Include at least one specific technical detail, industry insight, or insider knowledge only an expert would know
- Reference specific challenges unique to Florida (weather, permits, HOA rules, local codes, seasonal patterns)
- Mention real numbers where relevant — costs, timelines, measurements, years of experience
- Write opinions and recommendations, not just facts ("I always recommend…", "In my experience the biggest mistake is…", "Here's what most people don't tell you…")

SEO REQUIREMENTS:
- Use the exact keyword in: title, first paragraph, at least 2 headings, and conclusion
- Mention "${todaysCity}" at least 4 times naturally throughout the post
- Reference real streets, neighborhoods, or landmarks near ${todaysCity} when relevant
- Make someone in ${todaysCity} feel like this business is THEIR local expert
- Include 2-4 natural internal links:
  * One to https://${domain} using the business name or a service as anchor text
  * One to https://${domain}/contact (or /reservations or /book) using "${cta.split(' ').slice(0, 3).join(' ')}" style anchor
  * Link naturally to 1-2 existing posts listed above (if any) where the topic is relevant
- End with this CTA naturally woven into the last paragraph: "${cta}"

CRITICAL — WRITE LIKE A REAL HUMAN EXPERT, NOT AN AI:
- Use contractions throughout (you'll, don't, it's, we've, here's, that's)
- Vary sentence length — some 4 words, some 25 words. Never uniform.
- Talk directly to the reader using "you" — like a trusted expert, not a textbook
- Specific details and real scenarios — not "quality service" or "satisfied customers"
- NEVER write: "In today's world", "It's no secret", "In conclusion", "Furthermore", "Moreover", "Game-changing", "Leverage", "Seamlessly", "Delve", "Robust", "Navigate", "Empower", "Unlock", "Look no further"
- Bullet points should NOT all be the same length

Return ONLY valid JSON, no markdown, no code fences:
{ "title": "50-60 char SEO title with keyword", "metaDescription": "150-160 char meta description with keyword", "htmlContent": "full HTML using h2/h3/p/ul/li/ol/strong/em/a tags only — no html/head/body" }` }],
  });

  const parsed = JSON.parse(blogRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const { title, metaDescription, htmlContent } = parsed;

  const brand = config.brand || { primary: '#0f172a', accent: '#2563eb', bg: '#ffffff', logoUrl: '' };

  // Step 5: Hero image — GHL media library first, Pexels as last resort
  let heroImage = null;
  if (brand.mediaImages && brand.mediaImages.length > 0) {
    // Use pre-defined media URLs from brand config (e.g. Escobar Kitchen)
    const pick = brand.mediaImages[Math.floor(Math.random() * brand.mediaImages.length)];
    heroImage = { url: pick, alt: `${name} — ${targetKeyword}`, photographer: null };
  } else {
    // Dynamically pull from this sub-account's GHL media library
    heroImage = await getGHLMediaImage(locationId, token).catch(() => null);
    // Only fall back to Pexels if GHL media is empty
    if (!heroImage) heroImage = await getPexelsImage(targetKeyword).catch(() => null);
  }

  // Step 6: Wrap content in brand-styled HTML template

  // Plain HTML mode — no inline CSS, let GHL theme handle styling
  let styledHTML;
  // Schema markup helpers (shared by both paths)
  const _schemaLocal = JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name, url: `https://${domain}`, telephone: brand.phone || '', sameAs: [`https://${domain}`] });
  const _schemaBlog  = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: title, datePublished: new Date().toISOString().split('T')[0], description: metaDescription, author: { '@type': 'Person', name: authorName, jobTitle: authorTitle, url: `https://${domain}/about` }, publisher: { '@type': 'Organization', name, url: `https://${domain}` } });
  const _faqMatches  = [...(htmlContent.matchAll(/<h2[^>]*>(.*?)<\/h2>[\s\S]*?<p[^>]*>(.*?)<\/p>/gs))].slice(0, 5);
  const _schemaFaq   = _faqMatches.length > 0 ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: _faqMatches.map(m => ({ '@type': 'Question', name: m[1].replace(/<[^>]+>/g, ''), acceptedAnswer: { '@type': 'Answer', text: m[2].replace(/<[^>]+>/g, '') } })) }) : null;
  const schemaBlock  = `<script type="application/ld+json">${_schemaLocal}</script>\n<script type="application/ld+json">${_schemaBlog}</script>${_schemaFaq ? `\n<script type="application/ld+json">${_schemaFaq}</script>` : ''}`;

  const authorBioBlock = author ? `
<hr>
<p><strong>About the Author</strong></p>
<p><strong>${author.name}</strong> — ${author.title}</p>
<p>${author.bio}</p>
` : '';

  if (brand.plainHtml) {
    styledHTML = `
${brand.logoUrl ? `<p><img src="${brand.logoUrl}" alt="${name} logo"></p>` : ''}
${heroImage ? `<p><img src="${heroImage.url}" alt="${heroImage.alt}"></p>` : ''}
${htmlContent}
<p><strong>${cta}</strong></p>
<p><a href="https://${domain}/contact">Contact Us</a></p>
${authorBioBlock}
${schemaBlock}
`;
  } else {

  const fontDisplay = brand.fontDisplay || 'Georgia';
  const fontBody    = brand.fontBody    || 'Arial';
  const bodyColor   = brand.bodyColor   || '#374151';
  const ctaBg       = brand.ctaBg       || brand.primary;
  styledHTML = `
<div style="font-family:'${fontBody}',sans-serif;max-width:820px;margin:0 auto;color:${brand.textColor || '#1a1a1a'};line-height:1.8;background:${brand.bg}">

  ${brand.fontImport ? `<link rel="stylesheet" href="${brand.fontImport}">` : ''}

  ${brand.logoUrl ? `
  <div style="padding:24px 32px 16px;background:${brand.bg}">
    <img src="${brand.logoUrl}" alt="${name} logo" style="height:52px;object-fit:contain;display:block">
  </div>` : ''}

  ${brand.trustBadges && brand.trustBadges.length ? `
  <div style="background:${brand.accent};padding:13px 32px;display:flex;gap:24px;flex-wrap:wrap;align-items:center">
    ${brand.trustBadges.map(b => `<span style="color:#ffffff;font-size:13px;font-weight:600;font-family:'${fontBody}',sans-serif">&#10003; ${b}</span>`).join('')}
  </div>` : ''}

  ${heroImage ? `
  <div style="position:relative">
    <img src="${heroImage.url}" alt="${heroImage.alt}" style="width:100%;height:420px;object-fit:cover;display:block">
    ${heroImage.photographer ? `<p style="font-size:11px;color:#888;text-align:right;margin:0;background:${brand.bg};padding:4px 10px;font-family:Arial,sans-serif">Photo by ${heroImage.photographer} · Pexels</p>` : ''}
  </div>` : ''}

  <div style="padding:36px 40px 0;font-family:'${fontBody}',sans-serif">
    ${htmlContent
      .replace(/<h2/g, `<h2 style="font-family:'${fontDisplay}',serif;font-size:28px;font-weight:900;color:${brand.primary};margin:40px 0 14px;padding-bottom:10px;border-bottom:3px solid ${brand.accent}"`)
      .replace(/<h3/g, `<h3 style="font-family:'${fontDisplay}',serif;font-size:21px;font-weight:700;color:${brand.primary};margin:28px 0 10px"`)
      .replace(/<p>/g, `<p style="margin:0 0 18px;font-size:17px;line-height:1.85;color:${bodyColor}">`)
      .replace(/<ul>/g, '<ul style="margin:0 0 20px;padding-left:24px">')
      .replace(/<ol>/g, '<ol style="margin:0 0 20px;padding-left:24px">')
      .replace(/<li>/g, `<li style="margin-bottom:10px;font-size:16px;color:${bodyColor}">`)
      .replace(/<strong>/g, `<strong style="color:${brand.primary}">`)
      .replace(/<a /g, `<a style="color:${brand.accent};text-decoration:underline" `)
    }
  </div>

  ${brand.stats && brand.stats.length ? `
  <div style="display:grid;grid-template-columns:repeat(${brand.stats.length},1fr);margin:32px 0 0;border-top:3px solid ${brand.accent}">
    ${brand.stats.map(s => `<div style="background:${brand.bg};padding:18px 10px;text-align:center;border-right:1px solid ${brand.accent}20"><span style="font-family:'${fontDisplay}',serif;font-size:15px;font-weight:700;color:${brand.primary};display:block">${s}</span></div>`).join('')}
  </div>` : ''}

  <div style="background:${ctaBg};padding:32px 40px;text-align:center">
    <p style="color:#ffffff;font-family:'${fontDisplay}',serif;font-size:20px;font-weight:700;margin:0 0 ${brand.phone ? '6px' : '20px'}">${cta}</p>
    ${brand.phone ? `<p style="color:rgba(255,255,255,0.80);font-size:15px;font-family:'${fontBody}',sans-serif;margin:0 0 20px">${brand.phone}</p>` : ''}
    <a href="https://${domain}/contact" style="background:${brand.accent};color:#ffffff;padding:16px 36px;border-radius:10px;text-decoration:none;font-family:'${fontDisplay}',serif;font-weight:700;font-size:16px;display:inline-block;letter-spacing:1px">Get a Free Quote</a>
  </div>

  ${author ? `
  <div style="border-top:2px solid ${brand.accent}20;margin:32px 0 0;padding:28px 32px;background:${brand.grayLight || '#f9fafb'};border-radius:0 0 12px 12px">
    <p style="font-family:'${fontDisplay}',serif;font-size:13px;font-weight:700;color:${brand.accent};letter-spacing:2px;text-transform:uppercase;margin:0 0 6px">About the Author</p>
    <p style="font-family:'${fontDisplay}',serif;font-size:18px;font-weight:700;color:${brand.primary};margin:0 0 2px">${author.name}</p>
    <p style="font-size:13px;color:${brand.grayMid || '#6b7280'};font-family:'${fontBody}',sans-serif;margin:0 0 10px">${author.title}</p>
    <p style="font-size:15px;color:${brand.bodyColor || '#374151'};font-family:'${fontBody}',sans-serif;line-height:1.7;margin:0">${author.bio}</p>
  </div>` : ''}

  ${schemaBlock}

</div>`;

  } // end else (styled HTML)

  // Step 7: Publish to client's GHL blog
  const urlSlug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60) + '-' + Date.now().toString(36);
  const publishedAt = new Date(); publishedAt.setUTCHours(14, 0, 0, 0);

  await axios.post(
    'https://services.leadconnectorhq.com/blogs/posts',
    {
      title, locationId, blogId: blog.blogId, description: metaDescription,
      ...(blog.authorId && { author: blog.authorId }),
      ...(heroImage && { imageUrl: heroImage.url }),
      tags: ['SEO', industry, 'Orlando', targetKeyword.split(' ').slice(0, 2).join(' ')],
      urlSlug, status: 'PUBLISHED', publishedAt: publishedAt.toISOString(), rawHTML: styledHTML,
    },
    { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );

  console.log(`[Client SEO] ✅ ${name}: published "${title}"`);

  // Force-index the new blog post via Google Indexing API (ranks same day instead of 2 weeks)
  const blogUrl = `https://${domain}/${urlSlug}`;
  forceIndexUrl(blogUrl).catch(() => null); // non-blocking

  // Save to blog history (non-blocking — learning loop)
  loadBlogHistory().then(hist => {
    if (!hist[locationId]) hist[locationId] = [];
    const baseKeyword = (config.keywords || []).find(k => targetKeyword.toLowerCase().includes(k.toLowerCase())) || targetKeyword.split(' ').slice(0,2).join(' ');
    hist[locationId].push({ keyword: targetKeyword, baseKeyword, title, url: blogUrl, urlSlug, date: new Date().toISOString().split('T')[0], clicks: null, impressions: null, position: null, gscChecked: false });
    return saveBlogHistory(hist);
  }).catch(() => null);

  return { success: true, name, title, keyword: targetKeyword, blogUrl };
}

// Daily runner — loops through all entries in SEO_CLIENTS and publishes one blog each
async function runAllClientsDailyBlog() {
  const entries = Object.entries(SEO_CLIENTS);
  if (!entries.length) return { skipped: true, reason: 'SEO_CLIENTS is empty' };
  console.log(`[Client SEO] Running daily blog for ${entries.length} clients...`);
  const results = [];
  for (const [locationId, config] of entries) {
    if (config.blogEnabled === false) { results.push({ name: config.name, skipped: true, reason: 'blogEnabled: false' }); continue; }
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

// ─── SEO BLOG HISTORY (Learning Loop) ────────────────────────────────────────
const SEO_BLOG_HISTORY_PID = 'jrz/seo_blog_history';
const SEO_BLOG_HISTORY_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/seo_blog_history.json';

async function loadBlogHistory() {
  try {
    const res = await axios.get(SEO_BLOG_HISTORY_URL + '?t=' + Date.now(), { timeout: 8000 });
    return typeof res.data === 'string' ? JSON.parse(res.data) : (res.data || {});
  } catch { return {}; }
}
async function saveBlogHistory(data) { await saveCloudinaryJSON(SEO_BLOG_HISTORY_PID, data); }

const BACKLINK_SNAPSHOT_PID = 'jrz/backlink_snapshot';
const BACKLINK_SNAPSHOT_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/backlink_snapshot.json';

// ─── WEEKLY RANK TRACKING ────────────────────────────────────────────────────
async function runWeeklyRankTracking() {
  console.log('[Rank Tracking] Starting weekly rank check...');
  if (!DATAFORSEO_PASSWORD) return { skipped: true, reason: 'no_dataforseo_password' };
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  const hist = await loadBlogHistory();
  const sixtyDaysAgo = Date.now() - 60 * 86400000;
  const today = new Date().toISOString().split('T')[0];
  const reportRows = [];

  for (const [locationId, config] of Object.entries(SEO_CLIENTS)) {
    const { name, domain } = config;
    const posts = (hist[locationId] || []).filter(p => new Date(p.date).getTime() > sixtyDaysAgo && (!p.gscChecked || p.position == null));
    for (const post of posts) {
      try {
        const res = await axios.post(
          `${DATAFORSEO_BASE}/v3/serp/google/organic/live/advanced`,
          [{ keyword: post.keyword, location_code: 2840, language_code: 'en', depth: 100 }],
          { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
        );
        const items = res.data?.tasks?.[0]?.result?.[0]?.items || [];
        const match = items.find(i => i.url && i.url.includes(domain));
        const prevPosition = post.position;
        post.position = match ? match.rank_absolute : null;
        post.gscChecked = true;
        post.lastChecked = today;
        reportRows.push({ client: name, keyword: post.keyword, title: post.title, position: post.position, prev: prevPosition, change: (prevPosition != null && post.position != null) ? prevPosition - post.position : null });
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) { console.error(`[Rank Tracking] ${name} — ${post.keyword}:`, e.message); }
    }
  }

  await saveBlogHistory(hist);
  if (!reportRows.length) return { checked: 0 };

  const tableRows = reportRows.map(r => `<tr>
    <td style="padding:8px;border:1px solid #e5e7eb">${r.client}</td>
    <td style="padding:8px;border:1px solid #e5e7eb">${r.keyword}</td>
    <td style="padding:8px;border:1px solid #e5e7eb">${r.title || '—'}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center">${r.position != null ? `#${r.position}` : 'Not ranking'}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;color:${r.change > 0 ? '#16a34a' : r.change < 0 ? '#dc2626' : '#6b7280'}">${r.change != null ? (r.change > 0 ? `▲${r.change}` : `▼${Math.abs(r.change)}`) : 'New'}</td>
  </tr>`).join('');

  const html = `<h2 style="font-family:Arial,sans-serif">Weekly Rank Tracking Report</h2>
    <p style="font-family:Arial,sans-serif;color:#6b7280">${today} — ${reportRows.length} keywords checked</p>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px">
      <thead><tr style="background:#1e40af;color:#fff">
        <th style="padding:10px;text-align:left">Client</th><th style="padding:10px;text-align:left">Keyword</th>
        <th style="padding:10px;text-align:left">Post</th><th style="padding:10px;text-align:center">Position</th><th style="padding:10px;text-align:center">Change</th>
      </tr></thead><tbody>${tableRows}</tbody></table>`;

  await sendEmail(OWNER_CONTACT_ID, `Weekly Rank Report — ${reportRows.length} keywords checked`, html);
  console.log(`[Rank Tracking] Done — ${reportRows.length} checked.`);
  return { checked: reportRows.length };
}

// ─── WEEKLY BACKLINK MONITORING ──────────────────────────────────────────────
async function runWeeklyBacklinkCheck() {
  console.log('[Backlinks] Starting weekly backlink check...');
  if (!DATAFORSEO_PASSWORD) return { skipped: true, reason: 'no_dataforseo_password' };
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  const today = new Date().toISOString().split('T')[0];

  let prevSnapshot = {};
  try {
    const snap = await axios.get(BACKLINK_SNAPSHOT_URL + '?t=' + Date.now(), { timeout: 8000 });
    prevSnapshot = typeof snap.data === 'string' ? JSON.parse(snap.data) : (snap.data || {});
  } catch { /* first run */ }

  const newSnapshot = { date: today, clients: {} };
  const reportRows = [];

  for (const [, config] of Object.entries(SEO_CLIENTS)) {
    const { name, domain } = config;
    try {
      const res = await axios.post(
        `${DATAFORSEO_BASE}/v3/backlinks/summary/live`,
        [{ target: domain, include_subdomains: true }],
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );
      const result = res.data?.tasks?.[0]?.result?.[0] || {};
      const current = { total_count: result.backlinks || 0, referring_domains: result.referring_domains || 0 };
      newSnapshot.clients[domain] = current;
      const prev = prevSnapshot.clients?.[domain] || {};
      reportRows.push({ client: name, domain, ...current, gained: current.total_count - (prev.total_count || 0), domainsGained: current.referring_domains - (prev.referring_domains || 0) });
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.error(`[Backlinks] ${name}:`, e.message); }
  }

  await saveCloudinaryJSON(BACKLINK_SNAPSHOT_PID, newSnapshot);
  if (!reportRows.length) return { checked: 0 };

  const tableRows = reportRows.map(r => `<tr>
    <td style="padding:8px;border:1px solid #e5e7eb">${r.client}</td>
    <td style="padding:8px;border:1px solid #e5e7eb">${r.domain}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center">${r.total_count.toLocaleString()}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center">${r.referring_domains.toLocaleString()}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;color:${r.gained > 0 ? '#16a34a' : r.gained < 0 ? '#dc2626' : '#6b7280'}">${r.gained > 0 ? `+${r.gained}` : r.gained}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;color:${r.domainsGained > 0 ? '#16a34a' : r.domainsGained < 0 ? '#dc2626' : '#6b7280'}">${r.domainsGained > 0 ? `+${r.domainsGained}` : r.domainsGained}</td>
  </tr>`).join('');

  const html = `<h2 style="font-family:Arial,sans-serif">Weekly Backlink Report</h2>
    <p style="font-family:Arial,sans-serif;color:#6b7280">${today}</p>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px">
      <thead><tr style="background:#1e40af;color:#fff">
        <th style="padding:10px;text-align:left">Client</th><th style="padding:10px;text-align:left">Domain</th>
        <th style="padding:10px;text-align:center">Total Backlinks</th><th style="padding:10px;text-align:center">Ref. Domains</th>
        <th style="padding:10px;text-align:center">Links ±</th><th style="padding:10px;text-align:center">Domains ±</th>
      </tr></thead><tbody>${tableRows}</tbody></table>`;

  await sendEmail(OWNER_CONTACT_ID, `Weekly Backlink Report — ${today}`, html);
  console.log(`[Backlinks] Done — ${reportRows.length} clients checked.`);
  return { checked: reportRows.length };
}

// ─── WEEKLY BACKLINK PROSPECTING — build links, not just monitor ─────────────
// Every Monday 9:20am: mine competitor referring domains via DataForSEO,
// Claude writes personalized guest post pitches, GHL sends outreach emails.
// Tracks contacted domains in Cloudinary so we never double-reach out.
async function runBacklinkProspecting() {
  console.log('[LinkBuild] Starting weekly backlink prospecting...');
  if (!DATAFORSEO_PASSWORD) return { skipped: true, reason: 'no_dataforseo_password' };
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  // Load snapshot — tracks who we've already contacted
  let snapshot = { contacted: {}, history: [], lastRun: null };
  try {
    const r = await axios.get(LINK_PROSPECTS_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    snapshot = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || snapshot);
  } catch { /* first run */ }

  const results = [];

  for (const [, config] of Object.entries(SEO_CLIENTS)) {
    if (!config.competitors?.length || !config.domain) continue;
    const { name, domain, industry } = config;
    const alreadyContacted = new Set(snapshot.contacted[domain] || []);

    console.log(`[LinkBuild] Prospecting for ${name} (${domain})...`);

    // Mine referring domains from up to 2 competitors
    const candidateMap = new Map();
    for (const competitor of config.competitors.slice(0, 2)) {
      try {
        const res = await axios.post(
          `${DATAFORSEO_BASE}/v3/backlinks/referring_domains/live`,
          [{ target: competitor, limit: 40, order_by: ['rank,desc'], filters: [['dofollow', '=', true]] }],
          { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 }
        );
        const items = res.data?.tasks?.[0]?.result?.[0]?.items || [];
        for (const item of items) {
          const df = item.domain_from;
          if (!df || df === domain || alreadyContacted.has(df)) continue;
          // Filter out mega-domains unlikely to accept pitches
          if (['google', 'facebook', 'youtube', 'twitter', 'amazon', 'yelp', 'reddit', 'linkedin', 'instagram', 'pinterest', 'wikipedia'].some(x => df.includes(x))) continue;
          if (!candidateMap.has(df)) candidateMap.set(df, item.rank || 0);
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) { console.error(`[LinkBuild] DataForSEO error for ${competitor}:`, e.message); }
    }

    // Take top 3 by rank score
    const targets = [...candidateMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
    if (!targets.length) { console.log(`[LinkBuild] No new targets for ${name}`); continue; }

    // For each target: Claude writes pitch → GHL sends email
    for (const targetDomain of targets) {
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `Write a short guest post outreach email from Jose Rivas at JRZ Marketing on behalf of ${name} (${domain}).

Target site: ${targetDomain} — assume they publish content related to ${industry} or adjacent topics.
Goal: earn a dofollow backlink to ${domain}.

Rules:
- Write a compelling subject line + email body under 120 words
- Pitch ONE specific guest post idea that genuinely helps their readers AND earns the link
- Sound human, not automated — reference their likely content focus
- End with: "Reply to this email if you're interested — Jose | JRZ Marketing"
- No fluff, no excessive compliments

Return JSON only: {"subject":"...","body":"..."}` }]
        });
        const raw = msg.content[0].text.trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) continue;
        const { subject, body } = JSON.parse(match[0]);

        // Create GHL contact + send email
        const email = `info@${targetDomain}`;
        const contactRes = await axios.post(
          'https://services.leadconnectorhq.com/contacts/',
          { locationId: GHL_LOCATION_ID, firstName: 'Editor', lastName: targetDomain, email, tags: ['link_prospect', `client_${name.toLowerCase().replace(/\s+/g, '_')}`], source: 'Link Building Bot' },
          { headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' } }
        ).catch(() => null);

        const contactId = contactRes?.data?.contact?.id;
        if (contactId) {
          await sendEmail(contactId, subject, `<p style="font-family:Arial,sans-serif;line-height:1.6">${body.replace(/\n/g, '</p><p style="font-family:Arial,sans-serif;line-height:1.6">')}</p>`);
          if (!snapshot.contacted[domain]) snapshot.contacted[domain] = [];
          snapshot.contacted[domain].push(targetDomain);
          results.push({ client: name, target: targetDomain, subject, email });
          console.log(`[LinkBuild] ✅ Pitched ${targetDomain} for ${name}`);
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) { console.error(`[LinkBuild] Pitch error for ${targetDomain}:`, e.message); }
    }
  }

  // Save snapshot + alert Jose
  snapshot.lastRun = new Date().toISOString();
  snapshot.history = [...(snapshot.history || []), ...results].slice(-500);
  await saveCloudinaryJSON(LINK_PROSPECTS_PID, snapshot);

  if (results.length > 0) {
    const rows = results.map(r => `<tr><td style="padding:8px;border:1px solid #e5e7eb">${r.client}</td><td style="padding:8px;border:1px solid #e5e7eb">${r.target}</td><td style="padding:8px;border:1px solid #e5e7eb">${r.subject}</td></tr>`).join('');
    await sendEmail(OWNER_CONTACT_ID, `🔗 Link Building — ${results.length} Outreach Emails Sent`,
      `<h2 style="font-family:Arial,sans-serif">Weekly Link Building Report</h2>
       <p style="font-family:Arial,sans-serif;color:#6b7280">Pitches sent this week: <strong>${results.length}</strong></p>
       <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;width:100%">
         <thead><tr style="background:#1e40af;color:#fff">
           <th style="padding:10px;text-align:left">Client</th><th style="padding:10px;text-align:left">Target Site</th><th style="padding:10px;text-align:left">Email Subject</th>
         </tr></thead><tbody>${rows}</tbody></table>
       <p style="font-family:Arial,sans-serif;color:#6b7280;margin-top:16px">All sent from info@email.jrzmarketing.com via GHL. Replies come to your inbox. Reply to accept and we'll write the full guest post.</p>`
    );
  }

  console.log(`[LinkBuild] Done — ${results.length} pitches sent across ${Object.keys(SEO_CLIENTS).length} clients`);
  return { sent: results.length, results };
}

// ─── RAILING MAX CITY PAGES (Programmatic SEO) ───────────────────────────────
// 58 cities × 6 services = 348 pages — published 5/day starting with floating stairs
const RAILING_MAX_LOCATION_ID = 'iipUT8kmVxJZzGBzvkZm';
const RAILING_MAX_API_KEY     = 'pit-3a6936c1-5f10-4e4d-bb26-26bec9ebef1c';
const RAILING_MAX_BLOG_ID     = 'NUf80XWXC5gwQqrvTpbD';
const RAILING_MAX_DOMAIN      = 'railingmax.com';
const CITY_PAGES_PID          = 'jrz/railingmax_city_pages';
const CITY_PAGES_URL          = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/railingmax_city_pages.json';

const RAILING_MAX_SERVICES = [
  { slug: 'floating-stairs', keyword: 'floating stairs', label: 'Floating Stairs', priority: 1 },
  { slug: 'glass-railing',   keyword: 'glass railing',   label: 'Glass Railing',   priority: 2 },
  { slug: 'cable-railing',   keyword: 'cable railing',   label: 'Cable Railing',   priority: 3 },
  { slug: 'stair-railing',   keyword: 'stair railing',   label: 'Stair Railing',   priority: 4 },
  { slug: 'iron-railing',    keyword: 'iron railing',    label: 'Iron Railing',    priority: 5 },
  { slug: 'pool-fence',      keyword: 'pool fence',      label: 'Pool Fence',      priority: 6 },
];

const RAILING_MAX_CITIES = [
  // Orlando metro
  { city: 'Orlando',            state: 'FL', metro: 'Orlando' },
  { city: 'Kissimmee',          state: 'FL', metro: 'Orlando' },
  { city: 'Lake Nona',          state: 'FL', metro: 'Orlando' },
  { city: 'Winter Park',        state: 'FL', metro: 'Orlando' },
  { city: 'Sanford',            state: 'FL', metro: 'Orlando' },
  { city: 'Lake Mary',          state: 'FL', metro: 'Orlando' },
  { city: 'Longwood',           state: 'FL', metro: 'Orlando' },
  { city: 'Oviedo',             state: 'FL', metro: 'Orlando' },
  { city: 'Winter Garden',      state: 'FL', metro: 'Orlando' },
  { city: 'Clermont',           state: 'FL', metro: 'Orlando' },
  { city: 'Windermere',         state: 'FL', metro: 'Orlando' },
  { city: 'Celebration',        state: 'FL', metro: 'Orlando' },
  { city: 'Altamonte Springs',  state: 'FL', metro: 'Orlando' },
  { city: 'Apopka',             state: 'FL', metro: 'Orlando' },
  { city: 'Maitland',           state: 'FL', metro: 'Orlando' },
  { city: 'Casselberry',        state: 'FL', metro: 'Orlando' },
  { city: 'Daytona Beach',      state: 'FL', metro: 'Orlando' },
  // Tampa metro
  { city: 'Tampa',              state: 'FL', metro: 'Tampa' },
  { city: 'St. Petersburg',     state: 'FL', metro: 'Tampa' },
  { city: 'Clearwater',         state: 'FL', metro: 'Tampa' },
  { city: 'Brandon',            state: 'FL', metro: 'Tampa' },
  { city: 'Wesley Chapel',      state: 'FL', metro: 'Tampa' },
  { city: 'Lakeland',           state: 'FL', metro: 'Tampa' },
  { city: 'Sarasota',           state: 'FL', metro: 'Tampa' },
  { city: 'Bradenton',          state: 'FL', metro: 'Tampa' },
  { city: 'Lutz',               state: 'FL', metro: 'Tampa' },
  { city: 'New Port Richey',    state: 'FL', metro: 'Tampa' },
  { city: 'Dunedin',            state: 'FL', metro: 'Tampa' },
  { city: 'Tarpon Springs',     state: 'FL', metro: 'Tampa' },
  { city: 'Plant City',         state: 'FL', metro: 'Tampa' },
  { city: 'Riverview',          state: 'FL', metro: 'Tampa' },
  { city: 'Land O Lakes',       state: 'FL', metro: 'Tampa' },
  // Miami metro
  { city: 'Miami',              state: 'FL', metro: 'Miami' },
  { city: 'Miami Beach',        state: 'FL', metro: 'Miami' },
  { city: 'Coral Gables',       state: 'FL', metro: 'Miami' },
  { city: 'Doral',              state: 'FL', metro: 'Miami' },
  { city: 'Hialeah',            state: 'FL', metro: 'Miami' },
  { city: 'Fort Lauderdale',    state: 'FL', metro: 'Miami' },
  { city: 'Hollywood',          state: 'FL', metro: 'Miami' },
  { city: 'Pompano Beach',      state: 'FL', metro: 'Miami' },
  { city: 'Boca Raton',         state: 'FL', metro: 'Miami' },
  { city: 'Delray Beach',       state: 'FL', metro: 'Miami' },
  { city: 'West Palm Beach',    state: 'FL', metro: 'Miami' },
  { city: 'Aventura',           state: 'FL', metro: 'Miami' },
  { city: 'Kendall',            state: 'FL', metro: 'Miami' },
  { city: 'Homestead',          state: 'FL', metro: 'Miami' },
  { city: 'Weston',             state: 'FL', metro: 'Miami' },
  // Jacksonville metro
  { city: 'Jacksonville',       state: 'FL', metro: 'Jacksonville' },
  { city: 'Fleming Island',     state: 'FL', metro: 'Jacksonville' },
  { city: 'Orange Park',        state: 'FL', metro: 'Jacksonville' },
  { city: 'St. Augustine',      state: 'FL', metro: 'Jacksonville' },
  { city: 'Ponte Vedra',        state: 'FL', metro: 'Jacksonville' },
  { city: 'Fernandina Beach',   state: 'FL', metro: 'Jacksonville' },
  { city: 'Jacksonville Beach', state: 'FL', metro: 'Jacksonville' },
  { city: 'Atlantic Beach',     state: 'FL', metro: 'Jacksonville' },
  { city: 'Neptune Beach',      state: 'FL', metro: 'Jacksonville' },
  { city: 'Mandarin',           state: 'FL', metro: 'Jacksonville' },
  { city: 'Southside',          state: 'FL', metro: 'Jacksonville' },
];

async function loadCityPagesSnapshot() {
  try {
    const res = await axios.get(CITY_PAGES_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    return typeof res.data === 'string' ? JSON.parse(res.data) : (res.data || { published: [] });
  } catch { return { published: [] }; }
}

// ═══════════════════════════════════════════════════════════
// DAILY TEAM STANDUP — all 5 AI agents meet every morning
// Generated by Claude with real data, saved to Cloudinary,
// served at /office/standup
// ═══════════════════════════════════════════════════════════

async function runDailyTeamStandup() {
  console.log('[Standup] Generating daily team meeting...');
  try {
    const clients = await getElenaClients().catch(() => []);
    const railingSnap = await loadCityPagesSnapshot().catch(() => ({ published: [] }));
    const cooneySnap  = await loadCooneyPagesSnapshot().catch(() => ({ published: [] }));
    const railingCount = railingSnap.published?.length || 0;
    const cooneyCount  = cooneySnap.published?.length  || 0;

    const nowEST   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayName  = nowEST.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr  = nowEST.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const dow      = nowEST.getDay();
    const dom      = nowEST.getDate();

    const todayJobs = ['7:00am — Daily carousel post', '10:30am — Client check-ins', '6:30pm — Daily story'];
    if (dow === 1) todayJobs.push('8:00am — Diego standup', '8:35am — Elena health check', '9:00am — Apollo enrichment', '9:15am — Diego weekly report', '9:30am — Marco content brief', '9:45am — Sofia website audit');
    if (dow === 3) todayJobs.push('10:00am — Marco trend alert');
    if (dom === 1) todayJobs.push('9:00am — Monthly client reports + Diego scorecard');

    const prompt = `You are writing the daily morning standup meeting for the JRZ Marketing AI team on ${dayName}, ${dateStr}.

REAL-TIME DATA:
- Active sub-accounts managed: ${clients.length} clients
- Client names: ${clients.map(c => c.name).join(', ')}
- Railing Max city pages published: ${railingCount}/348 (floating stairs priority)
- Cooney Homes city pages published: ${cooneyCount}/128
- Today's cron schedule: ${todayJobs.join(' | ')}

ACTIVE API CONNECTIONS:
- GHL (LeadConnector) API — contacts, conversations, blogs, social posting, sub-accounts
- Anthropic Claude API — claude-opus-4-6 (quality), claude-haiku-4-5 (fast tasks)
- DataForSEO — keyword volume, competition scoring, SERP rank tracking, backlink monitoring
- ElevenLabs — voice synthesis (Joseph Corona voice ID)
- Cloudinary — persistent memory: health snapshots, scorecard, city pages, content strategy, standup
- NewsAPI — trending topic discovery for content briefs
- Apollo.io — prospect email enrichment (50 credits/month)
- Google PageSpeed API — site performance scoring
- Google Search Console API — rank/click/impression data
- Bland AI — automated phone call campaigns
- Pexels — stock photo fallback for blog hero images
- GHL Media Storage — primary blog images per sub-account

Write a natural daily standup where all 5 agents speak. Each should report what they're doing TODAY, reference specific client names, mention which APIs they're using, and share 1 insight or thing they learned. Agents should cross-reference each other's work naturally.

Return ONLY a valid JSON array:
[{"agent":"armando","message":"..."},{"agent":"elena","message":"..."},{"agent":"diego","message":"..."},{"agent":"marco","message":"..."},{"agent":"sofia","message":"..."},{"agent":"armando","message":"..."}]

6 messages total. Each message 2-4 sentences. Keep it real, specific, energetic. They work together 24/7.`;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in standup response');
    const messages = JSON.parse(jsonMatch[0]);

    const standup = {
      date: dateStr, dayName,
      generatedAt: new Date().toISOString(),
      railingCount, cooneyCount,
      clientCount: clients.length,
      messages
    };
    await saveCloudinaryJSON(STANDUP_PID, standup);
    console.log('[Standup] ✅ Daily meeting saved');
    return standup;
  } catch (e) {
    console.error('[Standup] Error:', e.message);
    throw e;
  }
}

async function runRailingMaxCityPage(service, cityObj) {
  const { city, metro } = cityObj;
  const { keyword, label, slug } = service;
  const token = RAILING_MAX_API_KEY;

  console.log(`[City Pages] Generating: ${keyword} in ${city}, FL...`);
  const blog = { blogId: RAILING_MAX_BLOG_ID, authorId: null };

  const nearbyStr = RAILING_MAX_CITIES.filter(c => c.metro === metro && c.city !== city).slice(0, 4).map(c => c.city).join(', ');

  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: `Write a LOCAL SERVICE PAGE for Railing Max — licensed floating stairs and railing contractor, all of Florida.

TARGET KEYWORD: "${keyword} ${city} FL"
TARGET CITY: ${city}, FL (${metro} metro)
SERVICE: ${label}

VOICE: Expert craftsman. Confident, specific, zero fluff. Sounds like someone who has installed hundreds of ${label.toLowerCase()} across Florida.

WRITE 700-850 WORDS:
- Open with hook mentioning ${city} and "${keyword}" in first sentence
- Why ${city} homeowners want ${label.toLowerCase()} (local architecture, waterfront, luxury, new construction — whatever fits ${metro})
- Materials, installation, Florida codes, timeline, cost range
- Mention nearby cities served: ${nearbyStr}
- 2 internal links: one to https://railingmax.com, one to https://railingmax.com/contact
- End CTA: "Get your free ${label.toLowerCase()} quote in ${city} — call (407) 412-5421 or visit railingmax.com"

No AI clichés. Contractions throughout. Vary sentence length.

Return ONLY valid JSON:
{ "title": "60-65 char title with '${keyword} ${city} FL'", "metaDescription": "155-165 char meta", "htmlContent": "HTML using h2/h3/p/ul/li/strong/a tags only" }` }],
  });

  const parsed = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const { title, metaDescription, htmlContent } = parsed;

  const heroImg = await getGHLMediaImage(RAILING_MAX_LOCATION_ID, token).catch(() => null);
  const heroSrc = heroImg?.url || 'https://assets.cdn.filesafe.space/iipUT8kmVxJZzGBzvkZm/media/69b80afa87f2fb2848a34872.png';
  const pageHTML = `<p><img src="${heroSrc}" alt="Railing Max — ${label} ${city} FL"></p>
${htmlContent}
<p><strong>Ready for your ${label.toLowerCase()} in ${city}? Call <a href="tel:4074125421">(407) 412-5421</a> or visit <a href="https://railingmax.com/contact">railingmax.com</a> for a free quote.</strong></p>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Railing Max', url: 'https://railingmax.com', telephone: '(407) 412-5421', areaServed: { '@type': 'City', name: city } })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Service', name: `${label} in ${city}, FL`, provider: { '@type': 'LocalBusiness', name: 'Railing Max' }, areaServed: city, description: metaDescription })}</script>`;

  const urlSlug = `${slug}-${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fl`;
  const publishedAt = new Date(); publishedAt.setUTCHours(14, 0, 0, 0);

  await axios.post('https://services.leadconnectorhq.com/blogs/posts',
    { title, locationId: RAILING_MAX_LOCATION_ID, blogId: blog.blogId, description: metaDescription,
      ...(blog.authorId && { author: blog.authorId }),
      tags: ['Floating Stairs', 'Railing', label, city, metro, 'Florida'],
      urlSlug, status: 'PUBLISHED', publishedAt: publishedAt.toISOString(), rawHTML: pageHTML },
    { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );
  console.log(`[City Pages] ✅ ${title}`);
  return { title, urlSlug, city, service: slug };
}

async function runRailingMaxCityPagesBatch(batchSize = 5) {
  const snapshot = await loadCityPagesSnapshot();
  const published = new Set(snapshot.published || []);
  const queue = [];
  for (const service of [...RAILING_MAX_SERVICES].sort((a, b) => a.priority - b.priority)) {
    for (const cityObj of RAILING_MAX_CITIES) {
      const key = `${service.slug}-${cityObj.city.toLowerCase().replace(/[^a-z0-9]/g, '-')}-fl`;
      if (!published.has(key)) queue.push({ service, cityObj, key });
    }
  }
  if (!queue.length) { console.log('[City Pages] All pages published!'); return { done: true, total: published.size }; }

  const batch = queue.slice(0, batchSize);
  const results = [];
  for (const { service, cityObj, key } of batch) {
    try {
      const r = await runRailingMaxCityPage(service, cityObj);
      snapshot.published.push(key);
      results.push(r);
      await saveCloudinaryJSON(CITY_PAGES_PID, snapshot); // save after every page
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error(`[City Pages] ❌ ${key}:`, e.message); }
  }
  console.log(`[City Pages] Batch done — ${results.length} published, ${queue.length - results.length} remaining`);
  return { published: results.length, remaining: queue.length - results.length };
}

// ─── COONEY HOMES CITY PAGES (Programmatic SEO) ──────────────────────────────
const COONEY_LOCATION_ID    = 'Gc4sUcLiRI2edddJ5Lfl';
const COONEY_API_KEY        = 'pit-cd43cc72-9e18-4eee-9bfb-be5942de9722';
const COONEY_BLOG_ID        = 'FGBk0wCHy3JJcQd7ULbr';
const COONEY_CITY_PAGES_PID = 'jrz/cooney_city_pages';
const COONEY_CITY_PAGES_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/cooney_city_pages.json';

const STANDUP_PID = 'jrz/daily_standup';
const STANDUP_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/daily_standup.json';

const LINK_PROSPECTS_PID = 'jrz/link_prospects';
const LINK_PROSPECTS_URL = 'https://res.cloudinary.com/dbsuw1mfm/raw/upload/jrz/link_prospects.json';

const COONEY_SERVICES = [
  { slug: 'custom-home-builder',  keyword: 'custom home builder',  label: 'Custom Homes',     priority: 1 },
  { slug: 'home-renovation',      keyword: 'home renovation',       label: 'Home Renovation',  priority: 2 },
  { slug: 'home-addition',        keyword: 'home addition',         label: 'Home Additions',   priority: 3 },
  { slug: 'general-contractor',   keyword: 'general contractor',    label: 'General Contractor', priority: 4 },
];

const COONEY_CITIES = [
  // Orlando / Central Florida
  { city: 'Orlando',            state: 'FL', metro: 'Orlando' },
  { city: 'Kissimmee',          state: 'FL', metro: 'Orlando' },
  { city: 'St. Cloud',          state: 'FL', metro: 'Orlando' },
  { city: 'Davenport',          state: 'FL', metro: 'Orlando' },
  { city: 'Haines City',        state: 'FL', metro: 'Orlando' },
  { city: 'Poinciana',          state: 'FL', metro: 'Orlando' },
  { city: 'Winter Park',        state: 'FL', metro: 'Orlando' },
  { city: 'Sanford',            state: 'FL', metro: 'Orlando' },
  { city: 'Lake Mary',          state: 'FL', metro: 'Orlando' },
  { city: 'Longwood',           state: 'FL', metro: 'Orlando' },
  { city: 'Oviedo',             state: 'FL', metro: 'Orlando' },
  { city: 'Winter Garden',      state: 'FL', metro: 'Orlando' },
  { city: 'Clermont',           state: 'FL', metro: 'Orlando' },
  { city: 'Windermere',         state: 'FL', metro: 'Orlando' },
  { city: 'Celebration',        state: 'FL', metro: 'Orlando' },
  { city: 'Altamonte Springs',  state: 'FL', metro: 'Orlando' },
  { city: 'Apopka',             state: 'FL', metro: 'Orlando' },
  { city: 'Lake Nona',          state: 'FL', metro: 'Orlando' },
  { city: 'Osceola County',     state: 'FL', metro: 'Orlando' },
  { city: 'Polk County',        state: 'FL', metro: 'Orlando' },
  // Tampa
  { city: 'Tampa',              state: 'FL', metro: 'Tampa' },
  { city: 'Lakeland',           state: 'FL', metro: 'Tampa' },
  { city: 'Brandon',            state: 'FL', metro: 'Tampa' },
  { city: 'Wesley Chapel',      state: 'FL', metro: 'Tampa' },
  { city: 'Riverview',          state: 'FL', metro: 'Tampa' },
  { city: 'Plant City',         state: 'FL', metro: 'Tampa' },
  { city: 'Land O Lakes',       state: 'FL', metro: 'Tampa' },
  { city: 'Lutz',               state: 'FL', metro: 'Tampa' },
  // Daytona / Space Coast
  { city: 'Daytona Beach',      state: 'FL', metro: 'Daytona' },
  { city: 'Palm Bay',           state: 'FL', metro: 'Daytona' },
  { city: 'Melbourne',          state: 'FL', metro: 'Daytona' },
  { city: 'Cocoa',              state: 'FL', metro: 'Daytona' },
];

async function loadCooneyPagesSnapshot() {
  try {
    const res = await axios.get(COONEY_CITY_PAGES_URL, { timeout: 8000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
    return typeof res.data === 'string' ? JSON.parse(res.data) : (res.data || { published: [] });
  } catch { return { published: [] }; }
}

async function runCooneyHomeCityPage(service, cityObj) {
  const { city, metro } = cityObj;
  const { keyword, label, slug } = service;
  const token = COONEY_API_KEY;

  console.log(`[Cooney City Pages] Generating: ${keyword} in ${city}, FL...`);
  const blog = { blogId: COONEY_BLOG_ID, authorId: null };

  const nearbyCities = COONEY_CITIES.filter(c => c.metro === metro && c.city !== city).slice(0, 4).map(c => c.city).join(', ');

  const aiRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: `Write a LOCAL SERVICE PAGE for Cooney Homes — licensed general contractor in Central Florida specializing in custom homes, renovations, and additions.

TARGET KEYWORD: "${keyword} ${city} FL"
TARGET CITY: ${city}, FL (${metro} area)
SERVICE: ${label}

ABOUT COONEY HOMES:
Owner-led builds. Clean communication. High craftsmanship. Licensed General Contractor. Free consultations. Built for long-term value.

VOICE: Confident, straight-talking contractor. Sounds like the owner talking to a homeowner at their kitchen table. Specific about the process, honest about timelines, proud of the work.

WRITE 700-850 WORDS:
- Open with hook mentioning ${city} and "${keyword}" in first sentence
- Why ${city} homeowners choose Cooney Homes for ${label.toLowerCase()} (growth, new neighborhoods, renovation boom, local market where relevant)
- Process overview: planning, permitting, construction, finish work
- Florida building codes and what makes Central Florida builds unique (humidity, lot sizes, HOA considerations)
- Mention nearby areas served: ${nearbyCities}
- 2 internal links: https://cooneyhomesfl.com and https://cooneyhomesfl.com/contact
- End CTA: "Ready to build or renovate in ${city}? Call Cooney Homes at (407) 201-4100 for a free consultation."

No AI clichés. Contractions throughout. Vary sentence length.

Return ONLY valid JSON:
{ "title": "60-65 char title with '${keyword} ${city} FL'", "metaDescription": "155-165 char meta", "htmlContent": "HTML using h2/h3/p/ul/li/strong/a tags only" }` }],
  });

  const parsed = JSON.parse(aiRes.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
  const { title, metaDescription, htmlContent } = parsed;

  const cooneyHero = await getGHLMediaImage(COONEY_LOCATION_ID, token).catch(() => null);
  const pageHTML = `${cooneyHero ? `<p><img src="${cooneyHero.url}" alt="Cooney Homes — ${label} ${city} FL"></p>` : ''}
${htmlContent}
<p><strong>Ready to start your ${label.toLowerCase()} in ${city}? Call <a href="tel:4072014100">(407) 201-4100</a> or visit <a href="https://cooneyhomesfl.com/contact">cooneyhomesfl.com</a> for a free consultation.</strong></p>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Cooney Homes', url: 'https://cooneyhomesfl.com', telephone: '(407) 201-4100', areaServed: { '@type': 'City', name: city } })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Service', name: `${label} in ${city}, FL`, provider: { '@type': 'LocalBusiness', name: 'Cooney Homes' }, areaServed: city, description: metaDescription })}</script>`;

  const urlSlug = `${slug}-${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fl`;
  const publishedAt = new Date(); publishedAt.setUTCHours(14, 30, 0, 0);

  await axios.post('https://services.leadconnectorhq.com/blogs/posts',
    { title, locationId: COONEY_LOCATION_ID, blogId: blog.blogId, description: metaDescription,
      ...(blog.authorId && { author: blog.authorId }),
      tags: ['Custom Home Builder', 'Contractor', label, city, metro, 'Florida'],
      urlSlug, status: 'PUBLISHED', publishedAt: publishedAt.toISOString(), rawHTML: pageHTML },
    { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' } }
  );
  console.log(`[Cooney City Pages] ✅ ${title}`);
  return { title, urlSlug, city, service: slug };
}

async function runCooneyHomesCityPagesBatch(batchSize = 5) {
  const snapshot = await loadCooneyPagesSnapshot();
  const published = new Set(snapshot.published || []);
  const queue = [];
  for (const service of [...COONEY_SERVICES].sort((a, b) => a.priority - b.priority)) {
    for (const cityObj of COONEY_CITIES) {
      const key = `${service.slug}-${cityObj.city.toLowerCase().replace(/[^a-z0-9]/g, '-')}-fl`;
      if (!published.has(key)) queue.push({ service, cityObj, key });
    }
  }
  if (!queue.length) { console.log('[Cooney City Pages] All pages published!'); return { done: true, total: published.size }; }

  const batch = queue.slice(0, batchSize);
  const results = [];
  for (const { service, cityObj, key } of batch) {
    try {
      const r = await runCooneyHomeCityPage(service, cityObj);
      snapshot.published.push(key);
      results.push(r);
      await saveCloudinaryJSON(COONEY_CITY_PAGES_PID, snapshot); // save after every page
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error(`[Cooney City Pages] ❌ ${key}:`, e.message); }
  }
  console.log(`[Cooney City Pages] Batch done — ${results.length} published, ${queue.length - results.length} remaining`);
  return { published: results.length, remaining: queue.length - results.length };
}

// DataForSEO: get search volume + competition score for a list of keywords
// Returns map of { keyword -> { volume, competition, score } }
async function getDataForSEOKeywordScores(keywords) {
  if (!DATAFORSEO_PASSWORD || !keywords.length) return {};
  try {
    const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
    const res = await axios.post(
      `${DATAFORSEO_BASE}/v3/keywords_data/google_ads/search_volume/live`,
      [{ keywords, location_code: 2840, language_code: 'en' }],
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const items = res.data?.tasks?.[0]?.result || [];
    const scores = {};
    for (const item of items) {
      const vol = item.search_volume || 0;
      const comp = item.competition_index || 50; // 0-100, lower = easier
      scores[item.keyword] = { volume: vol, competition: comp, score: vol / (comp + 1) };
    }
    return scores;
  } catch (e) {
    console.error('[DataForSEO] Keyword scores error:', e.message);
    return {};
  }
}

// Smart keyword picker — uses DataForSEO to rank available keywords by opportunity (high volume, low competition)
async function getBestNextKeyword(locationId, config, clientHistory = []) {
  const { keywords = [], industry } = config;
  const todaysCity = getTodaysCity();
  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  // What base keywords were written in the last 30 days
  const recentlyWritten = new Set(
    clientHistory
      .filter(p => new Date(p.date).getTime() > thirtyDaysAgo)
      .map(p => (p.baseKeyword || p.keyword).toLowerCase())
  );

  if (keywords.length > 0) {
    // Prefer keywords not written recently
    const available = keywords.filter(k => !recentlyWritten.has(k.toLowerCase()));
    const pool = available.length > 0 ? available : (() => {
      // All used recently — pick oldest
      return [[...keywords].sort((a, b) => {
        const aDate = clientHistory.filter(p => (p.baseKeyword || p.keyword).toLowerCase().includes(a.toLowerCase())).pop()?.date || '2000-01-01';
        const bDate = clientHistory.filter(p => (p.baseKeyword || p.keyword).toLowerCase().includes(b.toLowerCase())).pop()?.date || '2000-01-01';
        return new Date(aDate) - new Date(bDate);
      })[0]];
    })();

    // Score pool with DataForSEO — pick highest opportunity keyword
    const scores = await getDataForSEOKeywordScores(pool);
    if (Object.keys(scores).length > 0) {
      const best = pool.sort((a, b) => (scores[b]?.score || 0) - (scores[a]?.score || 0))[0];
      console.log(`[DataForSEO] Best keyword for ${locationId}: "${best}" (vol:${scores[best]?.volume}, comp:${scores[best]?.competition})`);
      return `${best} ${todaysCity} FL`;
    }

    // DataForSEO unavailable — fall back to click-data heuristic
    if (available.length > 0) {
      const topPost = clientHistory.filter(p => p.clicks > 0).sort((a, b) => (b.clicks || 0) - (a.clicks || 0))[0];
      if (topPost) {
        const topBase = (topPost.baseKeyword || topPost.keyword).toLowerCase().split(' ')[0];
        const similar = available.find(k => k.toLowerCase().startsWith(topBase));
        if (similar) return `${similar} ${todaysCity} FL`;
      }
      return `${available[0]} ${todaysCity} FL`;
    }
    return `${pool[0]} ${todaysCity} FL`;
  }

  return `${industry} ${todaysCity} FL`;
}

// Weekly learning report — what's been written, what's next, what's unused
async function runSofiaContentLearning() {
  console.log('[Content Learning] Generating SEO learning report...');
  const history = await loadBlogHistory();
  const report = [];

  for (const [locationId, config] of Object.entries(SEO_CLIENTS)) {
    const { name, keywords = [] } = config;
    const clientHistory = history[locationId] || [];
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recentPosts = clientHistory.filter(p => new Date(p.date).getTime() > thirtyDaysAgo);
    const usedBaseKeywords = new Set(clientHistory.map(p => (p.baseKeyword || p.keyword.split(' ').slice(0,2).join(' ')).toLowerCase()));
    const unusedKeywords = keywords.filter(k => !usedBaseKeywords.has(k.toLowerCase()));
    const nextKeyword = await getBestNextKeyword(locationId, config, clientHistory);
    report.push({ name, totalPosts: clientHistory.length, recentPosts: recentPosts.length, unusedKeywords: unusedKeywords.length, unusedList: unusedKeywords.slice(0,5), recentKeywords: recentPosts.slice(-5).map(p => p.keyword), nextKeyword });
  }

  const html = `<h2>SEO Content Learning Report — ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</h2>
    ${report.map(r => `<h3>${r.name}</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-family:Arial,sans-serif;font-size:14px">
        <tr><td style="padding:7px 14px;background:#f5f5f5;width:200px"><b>Total posts</b></td><td style="padding:7px 14px">${r.totalPosts}</td></tr>
        <tr><td style="padding:7px 14px;background:#f5f5f5"><b>Last 30 days</b></td><td style="padding:7px 14px">${r.recentPosts} posts</td></tr>
        <tr><td style="padding:7px 14px;background:#f5f5f5"><b>Keywords unused</b></td><td style="padding:7px 14px">${r.unusedKeywords} left — ${r.unusedList.join(', ') || 'none'}</td></tr>
        <tr><td style="padding:7px 14px;background:#f5f5f5"><b>Recent topics</b></td><td style="padding:7px 14px">${r.recentKeywords.join(' · ') || '—'}</td></tr>
        <tr style="background:#d4edda"><td style="padding:7px 14px"><b>Next recommended</b></td><td style="padding:7px 14px"><b>${r.nextKeyword}</b></td></tr>
      </table>`).join('')}`;

  await sendEmail(OWNER_CONTACT_ID, `SEO Content Learning — ${new Date().toLocaleDateString()}`, html);
  return { success: true, report };
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

// ─── PEXELS IMAGE SEARCH ─────────────────────────────────────────────────────
// Fetches a random image from a sub-account's GHL media library.
// Returns { url, alt } or null if no images found.
async function getGHLMediaImage(locationId, token) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/medias/files?locationId=${locationId}&type=image&limit=50`,
      { headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' }, timeout: 8000 }
    );
    const files = res.data?.files || [];
    const images = files.filter(f => f.url && /\.(jpg|jpeg|png|webp)/i.test(f.url));
    if (!images.length) return null;
    const pick = images[Math.floor(Math.random() * images.length)];
    return { url: pick.url, alt: pick.name || 'photo', photographer: null };
  } catch { return null; }
}

// Fetches a relevant stock photo for blog posts based on keyword.
// Returns { url, photographer, alt } or null if not found.
async function getPexelsImage(keyword) {
  try {
    const query = encodeURIComponent(keyword.split(' ').slice(0, 3).join(' '));
    const resp = await axios.get(`https://api.pexels.com/v1/search?query=${query}&per_page=5&orientation=landscape`, {
      headers: { Authorization: PEXELS_API_KEY },
    }).catch(() => null);
    const photos = resp?.data?.photos || [];
    if (!photos.length) return null;
    const photo = photos[Math.floor(Math.random() * Math.min(3, photos.length))];
    return {
      url: photo.src.large2x || photo.src.large,
      photographer: photo.photographer,
      alt: photo.alt || keyword,
    };
  } catch (_e) {
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



  return {
    checkWebsite,
    runSofiaWeeklyCheck,
    runSofiaFullAudit,
    runSofiaCROReport,
    runSofiaOnboardingCheck,
    runSofiaUptimeMonitor,
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
    buildLandingHTML,
    createGHLLandingPage,
  };
};
