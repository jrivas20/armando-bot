# CLAUDE.md — Armando Bot / JRZ Marketing
# Read this at the start of every session. It contains everything needed to work on this project.

---

## Project Overview

Node.js/Express bot deployed on **Render** (free plan) at `https://armando-bot-1.onrender.com`.
Source: GitHub `jrivas20/armando-bot`, branch `main`. Push to main = auto-deploy.
Main file: `server.js` (~7500+ lines). Config: `render.yaml`.

**Tech stack:** Node.js, Express, Axios, Anthropic SDK, FormData, Crypto (built-in)
**No test suite.** Verification = test endpoints + Render logs.

---

## AI Team

| Agent | Role | Key Functions |
|-------|------|---------------|
| Armando | Community Manager / DM Closer | `getArmandoReply()` — 24/7 on webhook |
| Elena | Client Success Manager | `elenaMonthlyReports()`, `elenaHealthCheck()` |
| Diego | Project Manager | `runDiegoWeeklyReport()`, `runDiegoStandup()`, `runDiegoScorecard()` |
| Marco | Content Director | `runMarcoContentBrief()`, `runMarcoTrendAlert()` |
| Sofia | Web Designer / Auditor | `runSofiaWeeklyCheck()`, `runSofiaCROReport()`, `runSofiaUptimeMonitor()`, `buildLandingHTML()` |

---

## Key Constants

```js
GHL_LOCATION_ID    = 'd7iUPfamAaPlSBNj6IhT'       // JRZ Marketing main account
GHL_USER_ID        = 'ALHFH3LlHUg7V4GuSbop'
OWNER_CONTACT_ID   = 'hywFWrMca0eSCse2Wjs8'        // Jose Rivas — all agent alerts go here
GHL_AGENCY_KEY     = 'pit-7a8b4631-2249-4683-b15b-57a661400caa'
GHL_COMPANY_ID     = 'VMjVKN63tXxZxQ21jlC4'        // used in getElenaClients()

CLOUDINARY_CLOUD   = 'dbsuw1mfm'
CLOUDINARY_API_KEY = '984314321446626'

NEWS_API_KEY       = 'dff54f64e9eb4087aa7c215a1c674644'
APOLLO_API_KEY     = 'pHTTmBc8ljBQFxaa0YcUQQ'

EMAIL_FROM         = 'info@email.jrzmarketing.com'
EMAIL_FROM_NAME    = 'Jose Rivas | JRZ Marketing'
GMAIL_ADDRESS      = 'info@jrzmarketing.com'

ELEVENLABS_VOICE_ID = 'SIpDYvpsUzCaJ0WmnSA8'       // Joseph Corona voice
GHL_FORM_ID         = '5XhL0vWCuJ59HWHQoHGG'        // universal GHL form embed
```

---

## API Patterns

### GHL — Location-level (subaccount data)
```js
headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' }
// Base: https://services.leadconnectorhq.com
```

### GHL — Agency-level (all subaccounts)
```js
headers: { Authorization: `Bearer ${GHL_AGENCY_KEY}`, Version: '2021-07-28' }
GET /locations/search?companyId=VMjVKN63tXxZxQ21jlC4&limit=100
```

### sendEmail(contactId, subject, html)
Sends via GHL conversations API. To alert Jose: `sendEmail(OWNER_CONTACT_ID, subject, html)`.

### Anthropic models
- `claude-haiku-4-5-20251001` — fast/cheap: standups, copy rewrites, scoring, tagging
- `claude-opus-4-6` — quality: outbound messages, content briefs, weekly reports

---

## Cloudinary Signature — CRITICAL PATTERN

Two patterns exist. Use the correct one based on what is being uploaded:

### JSON/raw file uploads (snapshots)
```js
const sigStr = `overwrite=true&public_id=${pid}&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
// NO resource_type in signature string
// BUT add resource_type: 'raw' to the FormData body
```

### AB test / analytics data (exception — resource_type IS in sig)
```js
const sigStr = `overwrite=true&public_id=${AB_PUB_ID}&resource_type=raw&timestamp=${ts}${CLOUDINARY_API_SECRET}`;
```

**Why:** Cloudinary's signature must exactly match the fields you send. If you include `resource_type` in FormData but not in the sig string, you get a 401. Most snapshots use the first pattern.

---

## Cron Schedule (EST, setInterval every 2 min)

| Time | Day | Function |
|------|-----|----------|
| 7:00am | Daily | `runDailyPost()` |
| 7:05am | Mon | `runWeeklyAnalysis()`, `runABTestAnalysis()`, `sendWeeklySummaryEmail()` |
| 8:00am | Mon–Fri | `runDiegoStandup()` |
| 8:00am | Mon | `runCompetitorMonitoring()` |
| 8:30am | Mon | `runEngagementLearning()`, learning functions |
| 8:35am | Mon | `elenaHealthCheck()` |
| 9:00am | Mon | `enrichProspectEmails()` |
| 9:15am | Mon | `runDiegoWeeklyReport()` |
| 9:30am | Mon | `runMarcoContentBrief()` |
| 9:45am | Mon | `runSofiaWeeklyCheck()`, `runSofiaOnboardingCheck()` |
| 9:55am | 1st | `runSofiaCROReport()` |
| 10:00am | Mon–Fri | `runDailyOutbound()` |
| 10:00am | Wed | `runMarcoTrendAlert()` |
| 10:00am | Last Fri | `sendSubAccountCheckInEmails()` |
| 10:30am | Daily | `runClientCheckIns()` |
| 9:00am | 1st | `sendMonthlyClientReports()`, `elenaMonthlyReports()`, `runDiegoScorecard()` |
| 9:30am | 1st Jan/Apr/Jul/Oct | `elenaQuarterlyReport()` |
| 10:00am | 15th | `elenaMidMonthCheckIn()` |
| 4:00pm | Mon/Wed/Fri | `runDailyReel()` |
| 6:30pm | Daily | `runDailyStory()` |
| Every 6h (0/6/12/18) | Daily | `runSofiaUptimeMonitor()` |
| Every 2 min | Daily | `runGmailCheck()` |

**Non-blocking pattern:** Call without `await` — just `functionName(); // non-blocking`

---

## All Endpoints

```
POST /webhook, /webhook/engage, /webhook/new-client, /webhook/hot-lead, /webhook/bland
GET  /
GET  /social/status
GET  /ab-test/results
GET  /elena/clients
POST /elena/monthly-reports
POST /elena/health-check
POST /elena/mid-month-checkin
POST /elena/quarterly-report
GET  /elena/grades
POST /diego/weekly-report, /diego/standup, /diego/scorecard
POST /marco/content-brief, /marco/trend-alert
POST /sofia/website-check, /sofia/build-page, /sofia/cro-report
POST /sofia/onboarding-check, /sofia/full-audit
POST /sofia/competitor-report, /sofia/uptime-check
GET  /sofia/preview-page?industry=&city=&name=&phone=
GET  /sofia/pagespeed?url=
GET  /sofia/search-console?url=
POST /cron/*  (manual triggers for all cron functions)
```

---

## Lessons — Do Not Repeat These Mistakes

### 1. Cloudinary 401 on raw uploads
**Rule:** Never include `resource_type` in the signature string for standard JSON snapshots.
The sig string is only `overwrite=true&public_id=...&timestamp=...` + secret.

### 2. buildLandingHTML must be async
**Rule:** `buildLandingHTML` calls Claude internally. Always `await` it.
`createGHLLandingPage` must also be async and await the call.

### 3. GHL funnel step creation is unreliable
**Rule:** Wrap `POST /funnels/{id}/steps` in `.catch(() => null)` — non-fatal.
The funnel container is always created; the step may not work via API.

### 4. Non-blocking crons must not use await
**Rule:** Heavy agent functions (Elena, Diego, Marco, Sofia) run fire-and-forget.
Never `await` them inside the 2-minute interval — it will block the entire cron loop.

### 5. Elena still used hardcoded list
**Rule:** Always call `await getElenaClients()` — never reference the old `JRZ_CLIENTS` array.
The old array no longer exists. `getElenaClients()` fetches live from GHL Agency API.

### 6. render.yaml sync: false vs value
**Rule:** Use `value: actual-key` for keys we already know (PageSpeed, Search Console).
Use `sync: false` for secrets that must be set manually in the Render dashboard.

### 7. POST vs GET confusion on manual triggers
**Rule:** All `/elena/*`, `/diego/*`, `/marco/*`, `/sofia/*` triggers are POST.
Use curl or Postman, not the browser, to trigger them.

---

## Verification Before Pushing — Mandatory

For any new Sofia feature, add a GET endpoint that returns HTML or JSON directly in the browser.
Examples already set:
- `GET /sofia/preview-page` — renders landing page HTML live
- `GET /sofia/pagespeed?url=` — returns PageSpeed JSON
- `GET /sofia/search-console?url=` — returns GSC data JSON

**Rule:** If a feature can't be tested without waiting for a cron or Render deploy, add a test endpoint.
Format: `GET /sofia/test-{feature}` or `POST /sofia/{feature}` with immediate response.

---

## Sub-agent Strategy

**Use the Explore sub-agent** for any search inside server.js before making edits.
The file is 7500+ lines. Searching it manually wastes main context.

**Trigger:** Any question of the form "where is X", "what does Y do", "find the function that..."
**Do not:** grep server.js yourself in the main context for open-ended searches.

**Use the Plan sub-agent** before any feature that touches 3+ functions or the cron schedule.

---

## getElenaClients() — Source of Truth for All Clients

Returns live subaccounts from GHL Agency API, filtered by `ELENA_CLIENT_OVERRIDES` for language/industry.
All agents (Elena, Diego, Marco, Sofia) use this function — never hardcode client arrays.

```js
// Returns: [{ name, locationId, lang, industry }, ...]
const clients = await getElenaClients();
```

Fallback: if API fails, returns entries from `ELENA_CLIENT_OVERRIDES` object.

---

## Cloudinary Snapshot Files (Persistent Memory)

| File | Public ID | Used by |
|------|-----------|---------|
| Elena health snapshot | `jrz/elena_health_snapshot` | Elena weekly health check |
| Diego scorecard snapshot | `jrz/diego_scorecard_snapshot` | Diego monthly scorecard |
| Sofia clients snapshot | `jrz/sofia_clients_snapshot` | Sofia onboarding detection |
| Content strategy | `jrz/content_strategy` | Marco content brief |
| AB test data | `jrz/ab_test_data` | AB test analysis |
| Engagement patterns | `jrz/engagement_patterns` | Armando learning |

---

## Deploy Checklist

Before any `git push origin main`:
1. New async functions awaited everywhere they're called?
2. New env vars added to `render.yaml`?
3. Non-blocking cron functions called without `await`?
4. Test endpoint added for any new Sofia/Elena/Diego feature?
5. Cloudinary sig string matches the pattern for this file type?
