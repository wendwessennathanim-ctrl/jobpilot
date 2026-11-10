'use strict';
/*
 * Backup & restore — why this exists:
 *
 * Free hosting tiers (Render free included) give the app an EPHEMERAL disk:
 * every redeploy or instance restart wipes local files, including the SQLite
 * database. Without a backup, that means accounts and profiles vanish and
 * logins start failing — which is exactly the bug this module fixes.
 *
 * How it works:
 *  - After any change, the whole database is snapshotted to a JSON file in a
 *    GitHub repo YOU own (the GitHub Contents API). Use a PRIVATE repo —
 *    the snapshot contains your profile and your (hashed) login record.
 *  - On boot, if the local database is empty (fresh/wiped disk) and a
 *    snapshot exists, it is restored automatically. Your email + password
 *    keep working and your profile, tracker and documents come back.
 *
 * Configuration (environment variables on the host):
 *   JOBPILOT_BACKUP_REPO   e.g. "youruser/jobpilot-data"   (required)
 *   JOBPILOT_BACKUP_TOKEN  GitHub fine-grained PAT with Contents
 *                          read/write on that repo ONLY   (required)
 *   JOBPILOT_BACKUP_FILE   default "jobpilot-backup.json"
 *   JOBPILOT_BACKUP_BRANCH default "main"
 *   JOBPILOT_BACKUP_API    default "https://api.github.com" (tests)
 *
 * If the variables are not set, backup is disabled and the app behaves
 * exactly as before (fine for local use; NOT durable on free hosts).
 */
const { db } = require('./db');

const REPO = process.env.JOBPILOT_BACKUP_REPO || '';
const TOKEN = process.env.JOBPILOT_BACKUP_TOKEN || '';
const FILE = process.env.JOBPILOT_BACKUP_FILE || 'jobpilot-backup.json';
const BRANCH = process.env.JOBPILOT_BACKUP_BRANCH || 'main';
const API = (process.env.JOBPILOT_BACKUP_API || 'https://api.github.com').replace(/\/$/, '');

// Parent tables first (foreign-key order for restore).
const TABLES = [
  'users', 'profiles', 'jobs', 'matches', 'applications', 'documents', 'runs',
  'scholarships', 'scholarship_matches', 'scholarship_applications', 'scholarship_documents',
];

function configured() { return !!(REPO && TOKEN); }

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

async function gh(pathname, opts = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'JobPilot-backup',
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  return res;
}

async function getRemote() {
  const res = await gh(`/repos/${REPO}/contents/${encodeURIComponent(FILE)}?ref=${encodeURIComponent(BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET backup failed: HTTP ${res.status}`);
  const data = await res.json();
  const json = JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf8'));
  return { sha: data.sha, json };
}

/** Build the snapshot object, trimming bulky re-fetchable text to stay
 *  comfortably under GitHub's 1 MB Contents API limit. */
function snapshot() {
  const tables = {};
  for (const t of TABLES) {
    if (!tableExists(t)) continue;
    let rows = db.prepare(`SELECT * FROM ${t}`).all();
    if (t === 'jobs') rows = rows.map((r) => ({ ...r, description: String(r.description || '').slice(0, 1500) }));
    if (t === 'runs') rows = rows.slice(-50);
    tables[t] = rows;
  }
  let payload = { version: 1, exportedAt: new Date().toISOString(), tables };
  let size = Buffer.byteLength(JSON.stringify(payload));
  if (size > 900000) {
    // Second pass: squeeze job descriptions harder.
    if (payload.tables.jobs) {
      payload.tables.jobs = payload.tables.jobs.map((r) => ({ ...r, description: String(r.description || '').slice(0, 300) }));
    }
    size = Buffer.byteLength(JSON.stringify(payload));
  }
  if (size > 980000) throw new Error(`Backup snapshot too large (${size} bytes)`);
  return payload;
}

let pushing = false;
async function pushBackup() {
  if (!configured() || pushing) return false;
  pushing = true;
  try {
    const payload = snapshot();
    const content = Buffer.from(JSON.stringify(payload)).toString('base64');
    let sha = null;
    try { const remote = await getRemote(); sha = remote ? remote.sha : null; } catch { /* create fresh */ }
    const put = (s) => gh(`/repos/${REPO}/contents/${encodeURIComponent(FILE)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `JobPilot backup ${payload.exportedAt}`,
        content,
        branch: BRANCH,
        ...(s ? { sha: s } : {}),
      }),
    });
    let res = await put(sha);
    if (res.status === 409 || res.status === 422) {
      // Someone/something updated the file meanwhile — refetch sha, retry once.
      const remote = await getRemote().catch(() => null);
      res = await put(remote ? remote.sha : null);
    }
    if (!res.ok) throw new Error(`GitHub PUT backup failed: HTTP ${res.status}`);
    console.log(`[jobpilot] backup saved (${payload.exportedAt})`);
    return true;
  } finally {
    pushing = false;
  }
}

/** Restore the snapshot into an empty database. Returns true if restored. */
async function restoreIfEmpty() {
  if (!configured()) {
    console.log('[jobpilot] Backup NOT configured — data will not survive redeploys on free hosts. Set JOBPILOT_BACKUP_REPO and JOBPILOT_BACKUP_TOKEN to enable it.');
    return false;
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return false;
  const remote = await getRemote().catch((e) => { console.error('[jobpilot] backup fetch failed:', e.message); return null; });
  if (!remote || !remote.json || !remote.json.tables) {
    console.log('[jobpilot] No backup found yet — starting fresh.');
    return false;
  }
  const tables = remote.json.tables;
  db.exec('BEGIN');
  try {
    for (const t of TABLES) {
      const rows = tables[t];
      if (!Array.isArray(rows) || !rows.length || !tableExists(t)) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        const sql = `INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        db.prepare(sql).run(...cols.map((c) => row[c]));
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[jobpilot] backup restore failed:', e.message);
    return false;
  }
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  console.log(`[jobpilot] Backup restored from ${remote.json.exportedAt || 'unknown date'} — ${users} account(s) recovered.`);
  return users > 0;
}

/* ------------------------- dirty tracking / flush ------------------------ */
let dirty = false;
let debounce = null;

function markDirty() {
  if (!configured()) return;
  dirty = true;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { flushNow().catch(() => {}); }, 4000);
  if (debounce.unref) debounce.unref();
}

async function flushNow() {
  if (!configured() || !dirty) return;
  dirty = false;
  try { await pushBackup(); }
  catch (e) { dirty = true; console.error('[jobpilot] backup failed:', e.message); }
}

setInterval(() => { if (dirty) flushNow().catch(() => {}); }, 60000).unref();

module.exports = { configured, restoreIfEmpty, markDirty, flushNow, pushBackup, snapshot };
