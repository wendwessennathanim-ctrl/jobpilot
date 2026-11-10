'use strict';
/*
 * Pipeline — one full run: fetch -> store -> score -> report.
 * Used by the web server (button + overnight scheduler) and by the
 * GitHub Actions script (scripts/scrape-ci.js).
 */
const { db } = require('./db');
const { fetchAllJobs } = require('./sources');
const { scoreJob, DEFAULT_PREFS } = require('./match');

function getProfile(userId) {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    user_id: row.user_id,
    name: row.name,
    headline: row.headline,
    resume_text: row.resume_text,
    skills: JSON.parse(row.skills || '[]'),
    prefs: { ...DEFAULT_PREFS, ...JSON.parse(row.prefs_json || '{}') },
  };
}

const upsertJob = () => db.prepare(`
  INSERT INTO jobs (id, source, title, company, location, remote, url, description, tags, posted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, description = excluded.description,
    fetched_at = datetime('now')
`);

const upsertMatch = () => db.prepare(`
  INSERT INTO matches (user_id, job_id, score, reasons, flags)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, job_id) DO UPDATE SET
    score = excluded.score, reasons = excluded.reasons, flags = excluded.flags,
    created_at = datetime('now')
`);

async function runPipeline(userId) {
  const profile = getProfile(userId);
  if (!profile) throw new Error('Profile not found for user');
  const runRow = db.prepare('INSERT INTO runs (user_id) VALUES (?)').run(userId);
  const runId = Number(runRow.lastInsertRowid);
  try {
    const { jobs, errors } = await fetchAllJobs(profile.prefs);
    const insJ = upsertJob();
    const insM = upsertMatch();
    let newJobs = 0;
    let topScore = 0;
    const exists = db.prepare('SELECT 1 FROM jobs WHERE id = ?');
    db.exec('BEGIN');
    try {
      for (const job of jobs) {
        if (!exists.get(job.id)) newJobs++;
        insJ.run(job.id, job.source, job.title, job.company, job.location, job.remote,
          job.url, job.description, JSON.stringify(job.tags), job.posted_at);
        const { score, reasons, flags } = scoreJob(profile, job);
        insM.run(userId, job.id, score, JSON.stringify(reasons), JSON.stringify(flags));
        if (score > topScore) topScore = score;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    db.prepare("UPDATE runs SET finished_at = datetime('now'), found = ?, new_jobs = ?, top_score = ?, error = ? WHERE id = ?")
      .run(jobs.length, newJobs, topScore, errors.length ? errors.join('; ').slice(0, 900) : null, runId);
    return { runId, found: jobs.length, newJobs, topScore, errors };
  } catch (e) {
    db.prepare("UPDATE runs SET finished_at = datetime('now'), error = ? WHERE id = ?").run(String(e.message).slice(0, 900), runId);
    throw e;
  }
}

/** Top matches for a user, newest strong matches first. */
function topMatches(userId, limit = 25, minScore = 0) {
  return db.prepare(`
    SELECT j.*, m.score, m.reasons, m.flags, m.created_at AS matched_at
    FROM matches m JOIN jobs j ON j.id = m.job_id
    WHERE m.user_id = ? AND m.score >= ?
    ORDER BY m.score DESC, j.fetched_at DESC
    LIMIT ?
  `).all(userId, minScore, limit).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    reasons: JSON.parse(r.reasons || '[]'),
    flags: JSON.parse(r.flags || '[]'),
  }));
}

module.exports = { runPipeline, getProfile, topMatches };
