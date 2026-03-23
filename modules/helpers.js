// modules/helpers.js
// ─── Shared utilities: retry, cron logging, build info ───────────────────────
// This module has ZERO dependencies on the rest of the codebase.
// Everything else requires this file.

'use strict';

const crypto = require('crypto');

// ─── Build identity (changes on every Render deploy) ─────────────────────────
const SERVER_START_TIME = new Date().toISOString();
const BUILD_HASH = process.env.RENDER_GIT_COMMIT
  ? process.env.RENDER_GIT_COMMIT.slice(0, 8)
  : crypto.createHash('md5').update(String(Date.now())).digest('hex').slice(0, 8);

// ─── Retry wrapper ────────────────────────────────────────────────────────────
// Usage: await withRetry(() => axios.post(...), 3, 1500)
async function withRetry(fn, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`[Retry] attempt ${i + 2}/${retries} in ${delay * (i + 1)}ms — ${e.message}`);
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

// ─── Cron status tracker ──────────────────────────────────────────────────────
// Every cron job writes here. GET /status reads it.
const CRON_STATUS = {};

function logCron(name, status, detail = '') {
  const d = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
  CRON_STATUS[name] = {
    lastRun: new Date().toISOString(),
    status,                         // 'ok' | 'error'
    detail: d.slice(0, 300),
  };
}

// Wraps a cron fn: logs start → ok or error.
// nonBlocking=true = fire-and-forget, but result is still logged to CRON_STATUS.
async function runCron(name, fn, nonBlocking = false) {
  if (nonBlocking) {
    fn()
      .then(r  => logCron(name, 'ok',    r   ?? 'done'))
      .catch(e => { logCron(name, 'error', e.message); console.error(`[Cron:${name}] ❌`, e.message); });
  } else {
    try   { const r = await fn(); logCron(name, 'ok', r ?? 'done'); }
    catch (e) { logCron(name, 'error', e.message); console.error(`[Cron:${name}] ❌`, e.message); throw e; }
  }
}

module.exports = {
  SERVER_START_TIME,
  BUILD_HASH,
  withRetry,
  CRON_STATUS,
  logCron,
  runCron,
};
