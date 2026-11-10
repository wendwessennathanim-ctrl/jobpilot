'use strict';
/*
 * Scholarship pipeline — fetch -> store -> score, mirroring the job
 * pipeline. Kept separate from jobs so each can run on its own button,
 * while the overnight scheduler runs both.
 */
const { db } = require('./db');
const { getProfile } = require('./pipeline');
const { fetchAllScholarships } = require('./scholarship-sources');
const { scoreScholarship, parseAmount, parseDeadline } = require('./scholarship-match');

const upsertSch = () => db.prepare(`
  INSERT INTO scholarships (id, source, title, provider, url, amount_text, amount_value, deadline, description, criteria_text)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, amount_text = excluded.amount_text,
    deadline = excluded.deadline, description = excluded.description,
    criteria_text = excluded.criteria_text, fetched_at = datetime('now')
`);

const upsertMatch = () => db.prepare(`
  INSERT INTO scholarship_matches (user_id, scholarship_id, score, reasons, flags, essay_required)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, scholarship_id) DO UPDATE SET
    score = excluded.score, reasons = excluded.reasons, flags = excluded.flags,
    essay_required = excluded.essay_required, created_at = datetime('now')
`);

async function runScholarshipScan(userId) {
  const profile = getProfile(userId);
  if (!profile) throw new Error('Profile not found for user');
  const { scholarships, errors } = await fetchAllScholarships(profile.prefs);
  const insS = upsertSch();
  const insM = upsertMatch();
  let newCount = 0;
  let topScore = 0;
  const exists = db.prepare('SELECT 1 FROM scholarships WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const s of scholarships) {
      if (!exists.get(s.id)) newCount++;
      const dl = parseDeadline(s);
      insS.run(s.id, s.source, s.title, s.provider, s.url, s.amount_text,
        parseAmount(s), dl ? dl.toISOString().slice(0, 10) : s.deadline, s.description, s.criteria_text);
      const r = scoreScholarship(profile, s);
      insM.run(userId, s.id, r.score, JSON.stringify(r.reasons), JSON.stringify(r.flags), r.essayRequired ? 1 : 0);
      if (r.score > topScore) topScore = r.score;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { found: scholarships.length, newScholarships: newCount, topScore, errors };
}

function topScholarships(userId, limit = 60, minScore = 0) {
  return db.prepare(`
    SELECT s.*, m.score, m.reasons, m.flags, m.essay_required, m.created_at AS matched_at
    FROM scholarship_matches m JOIN scholarships s ON s.id = m.scholarship_id
    WHERE m.user_id = ? AND m.score >= ?
    ORDER BY m.score DESC, s.deadline IS NULL, s.deadline ASC
    LIMIT ?
  `).all(userId, minScore, limit).map((r) => ({
    ...r,
    reasons: JSON.parse(r.reasons || '[]'),
    flags: JSON.parse(r.flags || '[]'),
    essay_required: !!r.essay_required,
  }));
}

module.exports = { runScholarshipScan, topScholarships };
