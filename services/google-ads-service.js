/**
 * Google Ads Service — JRZ Marketing Agency
 * Google Ads REST API v17
 *
 * Full campaign management: create, monitor, optimize, report.
 * Supports Search, Performance Max, and Display campaigns.
 *
 * Auth: OAuth2 refresh token (shared with GA4/Search Console token)
 * Developer Token: saVkv7v1x6X9dsnDyPVCYg (Basic Access — approved April 20, 2026)
 * Manager Account (MCC): 646-514-4890
 */

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────
const DEVELOPER_TOKEN  = 'saVkv7v1x6X9dsnDyPVCYg';
const MANAGER_ID       = '6465144890';           // MCC — no dashes
const API_VERSION      = 'v20';
const BASE_URL         = `https://googleads.googleapis.com/${API_VERSION}`;

// Token file — only exists locally (not on Render)
const TOKEN_PATH = path.join(__dirname, '../../meta-ai-engine/config/google-token.json');

// OAuth2 credentials — loaded from env vars only (set in Render dashboard + local .env)
const OAUTH_CREDS = {
  client_id:     process.env.GOOGLE_OAUTH2_CLIENT_ID,
  client_secret: process.env.GOOGLE_OAUTH2_SECRET,
};

// ─── OAuth2: Get Fresh Access Token ──────────────────────────────────────────
let _tokenCache = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();

  // Use cached token if still valid (5 min buffer)
  if (_tokenCache && now < _tokenExpiry - 300000) return _tokenCache;

  // On Render: refresh token comes from env var. Locally: read from file.
  let refresh_token;
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    refresh_token = process.env.GOOGLE_REFRESH_TOKEN;
  } else {
    const stored = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    refresh_token = stored.refresh_token;
  }

  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id:     OAUTH_CREDS.client_id,
    client_secret: OAUTH_CREDS.client_secret,
    refresh_token,
    grant_type:    'refresh_token',
  });

  _tokenCache  = res.data.access_token;
  _tokenExpiry = now + (res.data.expires_in * 1000);

  // Persist locally only (Render filesystem is read-only — skip silently)
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    try {
      const stored = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      const updated = { ...stored, access_token: _tokenCache, expiry_date: _tokenExpiry };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    } catch (_) { /* file not available on Render */ }
  }

  return _tokenCache;
}

// ─── Core: Ads API Headers ────────────────────────────────────────────────────
// loginAs: optional — pass MANAGER_ID to use MCC context for manager-link operations
async function adsHeaders(customerId, loginAs = null) {
  const token = await getAccessToken();
  const headers = {
    'Authorization':   `Bearer ${token}`,
    'developer-token': DEVELOPER_TOKEN,
    'Content-Type':    'application/json',
  };
  // Only add login-customer-id when explicitly needed (e.g. manager link mutations)
  if (loginAs) {
    headers['login-customer-id'] = loginAs;
  }
  return headers;
}

// ─── Core: GAQL Search ───────────────────────────────────────────────────────
async function gaqlSearch(customerId, query) {
  const cid     = customerId.replace(/-/g, '');
  const headers = await adsHeaders(cid);

  const res = await axios.post(
    `${BASE_URL}/customers/${cid}/googleAds:search`,
    { query },
    { headers }
  );

  return res.data.results || [];
}

// ─── Core: Mutate ─────────────────────────────────────────────────────────────
async function adsMutate(customerId, resource, operations) {
  const cid     = customerId.replace(/-/g, '');
  const headers = await adsHeaders(cid);

  const res = await axios.post(
    `${BASE_URL}/customers/${cid}/${resource}:mutate`,
    { operations },
    { headers }
  );

  return res.data;
}

// ══════════════════════════════════════════════════════════════════════════════
// READ: PERFORMANCE DATA
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get campaign performance for last N days
 */
async function getCampaignPerformance(customerId, days = 7) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.conversion_rate,
      metrics.all_conversions
    FROM campaign
    WHERE segments.date DURING LAST_${days}_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const results = await gaqlSearch(customerId, query);

  return results.map(r => ({
    id:            r.campaign?.id,
    name:          r.campaign?.name,
    status:        r.campaign?.status,
    type:          r.campaign?.advertisingChannelType,
    budgetMicros:  r.campaignBudget?.amountMicros,
    budgetDaily:   r.campaignBudget ? (r.campaignBudget.amountMicros / 1e6).toFixed(2) : null,
    clicks:        r.metrics?.clicks || 0,
    impressions:   r.metrics?.impressions || 0,
    ctr:           r.metrics?.ctr ? (r.metrics.ctr * 100).toFixed(2) + '%' : '0%',
    avgCpc:        r.metrics?.averageCpc ? '$' + (r.metrics.averageCpc / 1e6).toFixed(2) : '$0',
    spend:         r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions:   r.metrics?.conversions || 0,
    cpa:           r.metrics?.costPerConversion ? '$' + (r.metrics.costPerConversion / 1e6).toFixed(2) : 'N/A',
    cvr:           r.metrics?.conversionRate ? (r.metrics.conversionRate * 100).toFixed(2) + '%' : '0%',
  }));
}

/**
 * Get keyword performance
 */
async function getKeywordPerformance(customerId, days = 7) {
  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group.name,
      campaign.name,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.search_impression_share
    FROM keyword_view
    WHERE segments.date DURING LAST_${days}_DAYS
      AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.clicks DESC
    LIMIT 50
  `;

  const results = await gaqlSearch(customerId, query);

  return results.map(r => ({
    keyword:        r.adGroupCriterion?.keyword?.text,
    matchType:      r.adGroupCriterion?.keyword?.matchType,
    status:         r.adGroupCriterion?.status,
    adGroup:        r.adGroup?.name,
    campaign:       r.campaign?.name,
    clicks:         r.metrics?.clicks || 0,
    impressions:    r.metrics?.impressions || 0,
    ctr:            r.metrics?.ctr ? (r.metrics.ctr * 100).toFixed(2) + '%' : '0%',
    avgCpc:         r.metrics?.averageCpc ? '$' + (r.metrics.averageCpc / 1e6).toFixed(2) : '$0',
    spend:          r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions:    r.metrics?.conversions || 0,
    impressionShare: r.metrics?.searchImpressionShare ? (r.metrics.searchImpressionShare * 100).toFixed(1) + '%' : 'N/A',
  }));
}

/**
 * Get ad performance
 */
async function getAdPerformance(customerId, days = 7) {
  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.status,
      ad_group.name,
      campaign.name,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions
    FROM ad_group_ad
    WHERE segments.date DURING LAST_${days}_DAYS
      AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.clicks DESC
    LIMIT 20
  `;

  const results = await gaqlSearch(customerId, query);

  return results.map(r => ({
    id:          r.adGroupAd?.ad?.id,
    name:        r.adGroupAd?.ad?.name,
    type:        r.adGroupAd?.ad?.type,
    status:      r.adGroupAd?.status,
    adGroup:     r.adGroup?.name,
    campaign:    r.campaign?.name,
    clicks:      r.metrics?.clicks || 0,
    impressions: r.metrics?.impressions || 0,
    ctr:         r.metrics?.ctr ? (r.metrics.ctr * 100).toFixed(2) + '%' : '0%',
    spend:       r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions: r.metrics?.conversions || 0,
    headlines:   (r.adGroupAd?.ad?.responsiveSearchAd?.headlines || []).map(h => h.text),
    descriptions:(r.adGroupAd?.ad?.responsiveSearchAd?.descriptions || []).map(d => d.text),
  }));
}

/**
 * Get account-level summary
 */
async function getAccountSummary(customerId, days = 30) {
  const query = `
    SELECT
      customer.id,
      customer.descriptive_name,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion
    FROM customer
    WHERE segments.date DURING LAST_${days}_DAYS
  `;

  const results = await gaqlSearch(customerId, query);
  const r = results[0];
  if (!r) return null;

  return {
    customerId:  r.customer?.id,
    name:        r.customer?.descriptiveName,
    clicks:      r.metrics?.clicks || 0,
    impressions: r.metrics?.impressions || 0,
    spend:       r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions: r.metrics?.conversions || 0,
    ctr:         r.metrics?.ctr ? (r.metrics.ctr * 100).toFixed(2) + '%' : '0%',
    avgCpc:      r.metrics?.averageCpc ? '$' + (r.metrics.averageCpc / 1e6).toFixed(2) : '$0',
    cpa:         r.metrics?.costPerConversion ? '$' + (r.metrics.costPerConversion / 1e6).toFixed(2) : 'N/A',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// WRITE: CAMPAIGN CREATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a campaign budget
 * Returns: budget resource name
 */
async function createBudget(customerId, { name, dailyBudgetUSD, shared = false }) {
  const cid = customerId.replace(/-/g, '');

  const result = await adsMutate(cid, 'campaignBudgets', [{
    create: {
      name,
      amount_micros: Math.round(dailyBudgetUSD * 1e6),
      delivery_method: 'STANDARD',
      explicitly_shared: shared,
    }
  }]);

  return result.results[0].resourceName;
}

/**
 * Create a Search campaign
 */
async function createSearchCampaign(customerId, {
  name,
  dailyBudgetUSD,
  targetLocations = [],   // e.g. ['Houston, TX']
  targetLanguage  = 1000, // 1000 = English
  bidStrategy     = 'TARGET_CPA',
  targetCpaUSD    = null,
  startDate       = null,
}) {
  const cid        = customerId.replace(/-/g, '');
  const budgetName = await createBudget(cid, { name: `${name} Budget`, dailyBudgetUSD });

  const campaign = {
    name,
    advertising_channel_type: 'SEARCH',
    status: 'PAUSED', // Always start paused — review before enabling
    campaign_budget: budgetName,
    network_settings: {
      target_google_search: true,
      target_search_network: false, // Search partners off by default
      target_content_network: false,
    },
    manual_cpc: bidStrategy === 'MANUAL_CPC' ? {} : undefined,
    target_cpa: bidStrategy === 'TARGET_CPA' && targetCpaUSD ? {
      target_cpa_micros: Math.round(targetCpaUSD * 1e6)
    } : undefined,
    maximize_conversions: bidStrategy === 'MAXIMIZE_CONVERSIONS' ? {} : undefined,
    start_date: startDate || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING', // required in v20
  };

  // Remove undefined fields
  Object.keys(campaign).forEach(k => campaign[k] === undefined && delete campaign[k]);

  const result = await adsMutate(cid, 'campaigns', [{ create: campaign }]);
  const campaignResourceName = result.results[0].resourceName;

  console.log(`[Google Ads] Campaign created: ${name} → ${campaignResourceName}`);
  return campaignResourceName;
}

/**
 * Create a Performance Max campaign
 */
async function createPMaxCampaign(customerId, {
  name,
  dailyBudgetUSD,
  targetCpaUSD = null,
}) {
  const cid        = customerId.replace(/-/g, '');
  const budgetName = await createBudget(cid, { name: `${name} Budget`, dailyBudgetUSD });

  const campaign = {
    name,
    advertising_channel_type: 'PERFORMANCE_MAX',
    status: 'PAUSED',
    campaign_budget: budgetName,
    maximize_conversion_value: targetCpaUSD ? {
      target_roas: null
    } : {},
  };

  const result = await adsMutate(cid, 'campaigns', [{ create: campaign }]);
  const campaignResourceName = result.results[0].resourceName;

  console.log(`[Google Ads] PMax campaign created: ${name} → ${campaignResourceName}`);
  return campaignResourceName;
}

/**
 * Create an ad group
 */
async function createAdGroup(customerId, campaignResourceName, {
  name,
  cpcBidUSD = 2.00,
  status    = 'ENABLED',
}) {
  const cid = customerId.replace(/-/g, '');

  const result = await adsMutate(cid, 'adGroups', [{
    create: {
      name,
      campaign: campaignResourceName,
      status,
      cpc_bid_micros: Math.round(cpcBidUSD * 1e6),
    }
  }]);

  return result.results[0].resourceName;
}

/**
 * Add keywords to an ad group
 * matchType: EXACT | PHRASE | BROAD
 */
async function addKeywords(customerId, adGroupResourceName, keywords = [], matchType = 'PHRASE') {
  const cid = customerId.replace(/-/g, '');

  const operations = keywords.map(text => ({
    create: {
      ad_group: adGroupResourceName,
      status: 'ENABLED',
      keyword: {
        text,
        match_type: matchType,
      }
    }
  }));

  const result = await adsMutate(cid, 'adGroupCriteria', operations);
  console.log(`[Google Ads] Added ${keywords.length} keywords to ${adGroupResourceName}`);
  return result.results.map(r => r.resourceName);
}

/**
 * Create a Responsive Search Ad (RSA)
 * headlines: array of up to 15 strings (max 30 chars each)
 * descriptions: array of up to 4 strings (max 90 chars each)
 */
async function createResponsiveSearchAd(customerId, adGroupResourceName, {
  finalUrl,
  headlines,
  descriptions,
  path1 = '',
  path2 = '',
}) {
  const cid = customerId.replace(/-/g, '');

  // Trim to limits
  const h = headlines.slice(0, 15).map((text, i) => ({
    text: text.slice(0, 30),
    pinned_field: i === 0 ? 'HEADLINE_1' : undefined,
  }));

  const d = descriptions.slice(0, 4).map(text => ({
    text: text.slice(0, 90),
  }));

  const result = await adsMutate(cid, 'adGroupAds', [{
    create: {
      ad_group: adGroupResourceName,
      status: 'PAUSED',
      ad: {
        final_urls:  [finalUrl],
        display_url: new URL(finalUrl).hostname,
        responsive_search_ad: {
          headlines:    h,
          descriptions: d,
          path1:        path1.slice(0, 15),
          path2:        path2.slice(0, 15),
        }
      }
    }
  }]);

  console.log(`[Google Ads] RSA created → ${result.results[0].resourceName}`);
  return result.results[0].resourceName;
}

/**
 * Pause or enable a campaign
 */
async function setCampaignStatus(customerId, campaignResourceName, status = 'PAUSED') {
  const cid = customerId.replace(/-/g, '');

  await adsMutate(cid, 'campaigns', [{
    update: { resource_name: campaignResourceName, status },
    update_mask: { paths: ['status'] }
  }]);

  console.log(`[Google Ads] Campaign ${campaignResourceName} → ${status}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MONITOR: WEEKLY PERFORMANCE REPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Full weekly performance report for a client
 */
async function getWeeklyReport(customerId, clientName = '') {
  const [campaigns, keywords, ads, summary] = await Promise.all([
    getCampaignPerformance(customerId, 7).catch(() => []),
    getKeywordPerformance(customerId, 7).catch(() => []),
    getAdPerformance(customerId, 7).catch(() => []),
    getAccountSummary(customerId, 7).catch(() => null),
  ]);

  const totalSpend = campaigns.reduce((sum, c) => sum + parseFloat(c.spend.replace('$', '') || 0), 0);
  const totalConv  = campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + (parseInt(c.clicks) || 0), 0);

  // Top performers
  const topKeyword  = [...keywords].sort((a, b) => b.clicks - a.clicks)[0];
  const worstKeyword = keywords.filter(k => k.clicks > 5 && parseFloat(k.ctr) < 1).slice(0, 3);

  // Budget pacing alerts
  const alerts = [];
  for (const c of campaigns) {
    const spend = parseFloat(c.spend.replace('$', '') || 0);
    const daily = parseFloat(c.budgetDaily || 0);
    if (daily > 0) {
      const pacing = (spend / (daily * 7)) * 100;
      if (pacing < 50) alerts.push(`⚠️ ${c.name}: only ${pacing.toFixed(0)}% budget used — may be limited`);
      if (pacing > 120) alerts.push(`🔥 ${c.name}: ${pacing.toFixed(0)}% over budget pacing — check`);
    }
    if (c.status === 'PAUSED') alerts.push(`⏸️ ${c.name}: PAUSED — intentional?`);
  }

  return {
    client:      clientName,
    customerId,
    period:      'Last 7 days',
    generatedAt: new Date().toISOString(),
    summary: {
      totalSpend:   '$' + totalSpend.toFixed(2),
      totalClicks:  totalClicks,
      totalConversions: totalConv,
      cpa: totalConv > 0 ? '$' + (totalSpend / totalConv).toFixed(2) : 'N/A',
      activeCampaigns: campaigns.filter(c => c.status === 'ENABLED').length,
    },
    campaigns,
    topKeyword,
    worstKeywords: worstKeyword,
    ads: ads.slice(0, 5),
    alerts,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK: BUILD FULL CAMPAIGN FROM TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a complete Search campaign with ad group, keywords, and RSA
 * One call to create everything for a client niche
 *
 * Example:
 * await buildSearchCampaign('5192590797', {
 *   campaignName: 'JRZ - SEO Services - Houston',
 *   dailyBudgetUSD: 20,
 *   finalUrl: 'https://jrzmarketing.com/contact-us',
 *   adGroupName: 'SEO Services',
 *   keywords: ['SEO company Houston', 'digital marketing Houston', 'marketing agency Houston TX'],
 *   matchType: 'PHRASE',
 *   headlines: ['Houston SEO Experts', 'Rank #1 on Google', 'JRZ Marketing Agency', ...],
 *   descriptions: ['Get more leads with proven SEO. Free audit. Call today.', ...],
 *   path1: 'SEO',
 *   path2: 'Houston',
 * })
 */
async function buildSearchCampaign(customerId, config) {
  console.log(`[Google Ads] Building campaign: ${config.campaignName}`);

  const campaignRN = await createSearchCampaign(customerId, {
    name:           config.campaignName,
    dailyBudgetUSD: config.dailyBudgetUSD,
    bidStrategy:    config.bidStrategy || 'MAXIMIZE_CONVERSIONS',
    targetCpaUSD:   config.targetCpaUSD || null,
  });

  const adGroupRN = await createAdGroup(customerId, campaignRN, {
    name:      config.adGroupName,
    cpcBidUSD: config.cpcBidUSD || 2.50,
  });

  await addKeywords(customerId, adGroupRN, config.keywords, config.matchType || 'PHRASE');

  const adRN = await createResponsiveSearchAd(customerId, adGroupRN, {
    finalUrl:     config.finalUrl,
    headlines:    config.headlines,
    descriptions: config.descriptions,
    path1:        config.path1 || '',
    path2:        config.path2 || '',
  });

  console.log(`[Google Ads] ✅ Campaign built: ${config.campaignName}`);

  return { campaignRN, adGroupRN, adRN, status: 'PAUSED — review before enabling' };
}

// ══════════════════════════════════════════════════════════════════════════════
// OPTIMIZE: KEYWORD MANAGEMENT + NEGATIVE KEYWORDS + SEARCH TERMS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get keywords with resource names — required for pause/enable mutations
 */
async function getKeywordsWithResourceNames(customerId, days = 14) {
  const query = `
    SELECT
      ad_group_criterion.resource_name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group.name,
      campaign.name,
      campaign.resource_name,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions
    FROM keyword_view
    WHERE segments.date DURING LAST_${days}_DAYS
      AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.clicks DESC
    LIMIT 50
  `;

  const results = await gaqlSearch(customerId, query);

  return results.map(r => ({
    resourceName: r.adGroupCriterion?.resourceName,
    keyword:      r.adGroupCriterion?.keyword?.text,
    matchType:    r.adGroupCriterion?.keyword?.matchType,
    status:       r.adGroupCriterion?.status,
    adGroup:      r.adGroup?.name,
    campaign:     r.campaign?.name,
    campaignRN:   r.campaign?.resourceName,
    clicks:       r.metrics?.clicks || 0,
    impressions:  r.metrics?.impressions || 0,
    spend:        r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions:  r.metrics?.conversions || 0,
  }));
}

/**
 * Get search terms report — what people actually typed to trigger your ads
 */
async function getSearchTermsReport(customerId, days = 14) {
  const query = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.name,
      campaign.resource_name,
      ad_group.name,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING LAST_${days}_DAYS
      AND metrics.impressions > 0
    ORDER BY metrics.clicks DESC
    LIMIT 100
  `;

  const results = await gaqlSearch(customerId, query);

  return results.map(r => ({
    searchTerm:  r.searchTermView?.searchTerm,
    status:      r.searchTermView?.status,
    campaign:    r.campaign?.name,
    campaignRN:  r.campaign?.resourceName,
    adGroup:     r.adGroup?.name,
    clicks:      r.metrics?.clicks || 0,
    impressions: r.metrics?.impressions || 0,
    ctr:         r.metrics?.ctr ? (r.metrics.ctr * 100).toFixed(2) + '%' : '0%',
    spend:       r.metrics?.costMicros ? '$' + (r.metrics.costMicros / 1e6).toFixed(2) : '$0',
    conversions: r.metrics?.conversions || 0,
  }));
}

/**
 * Add negative keywords to a campaign — blocks wasteful searches at source
 * matchType: BROAD | PHRASE | EXACT
 */
async function addCampaignNegatives(customerId, campaignResourceName, keywords = [], matchType = 'BROAD') {
  const cid = customerId.replace(/-/g, '');

  const operations = keywords.map(text => ({
    create: {
      campaign: campaignResourceName,
      negative: true,
      keyword: { text, match_type: matchType },
    }
  }));

  const result = await adsMutate(cid, 'campaignCriteria', operations);
  console.log(`[Google Ads] Added ${keywords.length} negatives to ${campaignResourceName}`);
  return result.results.map(r => r.resourceName);
}

/**
 * Pause or enable a specific keyword by criterion resource name
 */
async function setKeywordStatus(customerId, criterionResourceName, status = 'PAUSED') {
  const cid = customerId.replace(/-/g, '');

  await adsMutate(cid, 'adGroupCriteria', [{
    update: { resource_name: criterionResourceName, status },
    update_mask: { paths: ['status'] },
  }]);

  console.log(`[Google Ads] Keyword ${criterionResourceName} → ${status}`);
}

/**
 * Full optimization pass — pause dead keywords, add negatives, surface search terms
 * Returns a complete audit report of every action taken
 */
async function optimizeAccount(customerId, options = {}) {
  const {
    niche                = 'barbershop',
    minClicksToEvaluate  = 10,   // min clicks before evaluating for pause
    maxSpendNoConversion = 20,   // max $ with 0 conversions before pause
    extraNegatives       = [],   // caller can inject extra negatives
  } = options;

  // Niche-specific negative keyword library
  const NICHE_NEGATIVES = {
    barbershop: [
      'how to cut hair', 'barber school', 'barber college', 'barber license',
      'barber training', 'barber course', 'become a barber', 'barber kit',
      'barber supplies', 'barber clippers', 'barber tools', 'hair clipper',
      'free haircut', 'diy haircut', 'barber certification', 'barber program',
      'barber chair for sale', 'buy barber chair', 'barber equipment',
    ],
  };

  const report = {
    customerId,
    niche,
    timestamp:       new Date().toISOString(),
    keywordsPaused:  [],
    negativesAdded:  [],
    searchTerms:     [],
    irrelevantTerms: [],
    actions:         [],
    errors:          [],
  };

  // Step 1 — Pull keywords with resource names
  let keywords = [];
  try {
    keywords = await getKeywordsWithResourceNames(customerId, 14);
    report.totalKeywords = keywords.length;
  } catch (err) {
    report.errors.push(`Keywords fetch failed: ${err.message}`);
  }

  // Step 2 — Pause keywords that are bleeding spend with 0 conversions
  for (const kw of keywords) {
    const spend = parseFloat((kw.spend || '$0').replace('$', ''));
    const shouldPause =
      (kw.conversions === 0 && kw.clicks >= minClicksToEvaluate) ||
      (kw.conversions === 0 && spend >= maxSpendNoConversion);

    if (shouldPause && kw.status === 'ENABLED' && kw.resourceName) {
      try {
        await setKeywordStatus(customerId, kw.resourceName, 'PAUSED');
        report.keywordsPaused.push({ keyword: kw.keyword, matchType: kw.matchType, clicks: kw.clicks, spend: kw.spend });
        report.actions.push(`⏸️ Paused: "${kw.keyword}" [${kw.matchType}] — ${kw.clicks} clicks, ${kw.spend}, 0 conversions`);
      } catch (err) {
        report.errors.push(`Pause failed for "${kw.keyword}": ${err.message}`);
      }
    }
  }

  // Step 3 — Search terms report (what people actually typed)
  try {
    const terms = await getSearchTermsReport(customerId, 14);
    report.searchTerms = terms.slice(0, 25);
    // Flag terms with clicks but 0 conversions — candidates for negatives
    report.irrelevantTerms = terms.filter(st => st.conversions === 0 && st.clicks >= 3).slice(0, 10);
  } catch (err) {
    report.errors.push(`Search terms fetch failed: ${err.message}`);
  }

  // Step 4 — Add niche negatives to every campaign in the account
  const nicheNegs = NICHE_NEGATIVES[niche] || [];
  const allNegatives = [...new Set([...nicheNegs, ...extraNegatives])];
  const campaignRNs = [...new Set(keywords.map(k => k.campaignRN).filter(Boolean))];

  for (const campaignRN of campaignRNs) {
    try {
      await addCampaignNegatives(customerId, campaignRN, allNegatives, 'BROAD');
      const campaignName = keywords.find(k => k.campaignRN === campaignRN)?.campaign || campaignRN;
      report.negativesAdded.push({ campaign: campaignName, count: allNegatives.length });
      report.actions.push(`🚫 Added ${allNegatives.length} negatives → "${campaignName}"`);
    } catch (err) {
      // Duplicates throw — log but don't fail the whole pass
      report.errors.push(`Negatives (may already exist) for ${campaignRN}: ${err.message}`);
    }
  }

  return report;
}

/**
 * Set language targeting on a list of campaigns
 * langs: array of codes — 'en' (1000), 'es' (1003), 'fr' (1002), 'pt' (1014)
 */
async function setLanguageTargeting(customerId, campaignResourceNames = [], langs = ['en', 'es']) {
  const cid = customerId.replace(/-/g, '');

  const LANG_MAP = {
    en: 'languageConstants/1000',
    es: 'languageConstants/1003',
    fr: 'languageConstants/1002',
    pt: 'languageConstants/1014',
  };

  const results = [];

  for (const campaignRN of campaignResourceNames) {
    const operations = langs
      .map(l => LANG_MAP[l])
      .filter(Boolean)
      .map(lc => ({
        create: {
          campaign: campaignRN,
          language: { language_constant: lc },
        }
      }));

    try {
      await adsMutate(cid, 'campaignCriteria', operations);
      results.push({ campaign: campaignRN, langs, status: 'ok' });
      console.log(`[Google Ads] Language targeting set: ${campaignRN} → ${langs.join('+')}`);
    } catch (err) {
      results.push({ campaign: campaignRN, status: 'error', error: err.message });
    }
  }

  return results;
}

// ─── List All Accessible Customer Accounts ───────────────────────────────────
// Hits the MCC and returns every sub-account linked under it.
// Use this to discover customer IDs for all your clients.
async function listAccessibleCustomers() {
  const token = await getAccessToken();

  // Step 1 — list all customer IDs accessible via this login
  const listRes = await axios.get(
    `${BASE_URL}/customers:listAccessibleCustomers`,
    {
      headers: {
        'Authorization':   `Bearer ${token}`,
        'developer-token': DEVELOPER_TOKEN,
      },
    }
  );

  const resourceNames = listRes.data.resourceNames || [];
  // resourceNames = ["customers/5192590797", "customers/1234567890", ...]

  // Step 2 — fetch name + manager flag for each account
  const accounts = await Promise.all(
    resourceNames.map(async (resourceName) => {
      const cid = resourceName.replace('customers/', '');
      try {
        const rows = await gaqlSearch(cid, `
          SELECT
            customer.id,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager,
            customer.status
          FROM customer
          LIMIT 1
        `);
        const c = rows[0]?.customer || {};
        return {
          customerId:   cid,
          resourceName,
          name:         c.descriptiveName || '(no name)',
          currency:     c.currencyCode,
          timeZone:     c.timeZone,
          isManager:    c.manager || false,
          status:       c.status || 'UNKNOWN',
        };
      } catch (err) {
        // Some sub-accounts may deny access — return partial info
        return { customerId: cid, resourceName, name: '(access denied)', error: err.message };
      }
    })
  );

  return accounts;
}

// ─── Unlink Sub-Account from MCC ─────────────────────────────────────────────
// Sets the CustomerManagerLink status to INACTIVE, removing the sub-account
// from MCC 646-514-4890. Does NOT delete the account itself — just unlinks it.
async function unlinkSubAccount(clientCustomerId) {
  const cid = clientCustomerId.replace(/-/g, '');

  // Step 1 — find the active manager link resource name
  const rows = await gaqlSearch(MANAGER_ID, `
    SELECT
      customer_manager_link.resource_name,
      customer_manager_link.client_customer,
      customer_manager_link.status,
      customer_manager_link.manager_link_id
    FROM customer_manager_link
    WHERE customer_manager_link.client_customer = 'customers/${cid}'
      AND customer_manager_link.status = 'ACTIVE'
    LIMIT 1
  `);

  if (!rows.length) {
    throw new Error(`No active manager link found for customer ${cid} under MCC ${MANAGER_ID}`);
  }

  const linkResourceName = rows[0].customerManagerLink.resourceName;

  // Step 2 — mutate status to INACTIVE (unlinks the account from MCC)
  const token = await getAccessToken();
  const headers = {
    'Authorization':     `Bearer ${token}`,
    'developer-token':   DEVELOPER_TOKEN,
    'login-customer-id': MANAGER_ID,
    'Content-Type':      'application/json',
  };

  const res = await axios.post(
    `${BASE_URL}/customers/${MANAGER_ID}/customerManagerLinks:mutate`,
    {
      operations: [{
        update: {
          resourceName: linkResourceName,
          status: 'INACTIVE',
        },
        updateMask: 'status',
      }],
    },
    { headers }
  );

  return {
    unlinked: true,
    clientCustomerId: cid,
    linkResourceName,
    response: res.data,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Auth
  getAccessToken,

  // Account Discovery
  listAccessibleCustomers,
  unlinkSubAccount,

  // Read
  gaqlSearch,
  getCampaignPerformance,
  getKeywordPerformance,
  getKeywordsWithResourceNames,
  getAdPerformance,
  getAccountSummary,
  getWeeklyReport,
  getSearchTermsReport,

  // Write
  createBudget,
  createSearchCampaign,
  createPMaxCampaign,
  createAdGroup,
  addKeywords,
  createResponsiveSearchAd,
  setCampaignStatus,
  setKeywordStatus,
  addCampaignNegatives,

  // Bulk
  buildSearchCampaign,
  optimizeAccount,
  setLanguageTargeting,

  // Constants
  MANAGER_ID,
  DEVELOPER_TOKEN,
};
