'use strict';
/*
 * Matching engine — scores a job 0..100 against a profile.
 *
 * Two layers:
 *  1. Built-in rules engine (always on, free, explainable — every point is
 *     recorded as a "reason" you can see on the dashboard).
 *  2. Optional AI rerank in generate.js when you add a free-tier LLM key.
 *
 * It is tuned for a student / new-grad reality: it rewards co-op, intern,
 * student and entry-level wording, and PENALISES senior roles and roles
 * whose text demands a bachelor's degree with no "or equivalent" — the two
 * traps that waste the most application time.
 */

const DEFAULT_PREFS = {
  // Any of these phrases in the job TITLE scores heavily. Keep both of your
  // tracks here, or split them into separate accounts — your call.
  titleKeywords: [
    'software developer co-op', 'software engineer co-op', 'co-op', 'coop',
    'intern', 'student', 'junior developer', 'junior software',
    'devops', 'ci/cd', 'automation', 'build engineer', 'release engineer',
    'systems administrator', 'linux administrator',
  ],
  // Places you can work. Remote jobs always count as a location match.
  locations: ['Ottawa', 'Kanata', 'Nepean', 'Ontario', 'Canada', 'Remote'],
  remoteOnly: false,
  // Hard filters: a hit in the title drops the job completely.
  excludeKeywords: ['senior', 'staff engineer', 'principal', 'manager', 'director', 'lead engineer'],
  minScore: 40,
  availability: 'Available to start January 2027 (Winter 2027 co-op term) and for ongoing part-time contract work.',
  runHour: 2, // 2 a.m. local server time = the overnight run
  leverCompanies: ['magnetforensics'],
  greenhouseBoards: [],
  extraFeeds: [],
};

function normText(s) { return String(s || '').toLowerCase(); }

function yearsRequired(text) {
  const m = text.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function scoreJob(profile, job) {
  const prefs = { ...DEFAULT_PREFS, ...(profile.prefs || {}) };
  const skills = (profile.skills || []).map(normText).filter(Boolean);
  const title = normText(job.title);
  const body = `${title} ${normText(job.company)} ${normText(job.location)} ${normText(job.description)} ${(job.tags || []).join(' ').toLowerCase()}`;
  const reasons = [];
  const flags = [];
  let score = 0;

  // Hard exclusion on title.
  for (const ex of prefs.excludeKeywords || []) {
    if (ex && title.includes(normText(ex))) {
      return { score: 0, reasons: [`Excluded: title contains "${ex}"`], flags: ['excluded'] };
    }
  }

  // Title keyword fit — the strongest signal.
  let titleHits = 0;
  for (const kw of prefs.titleKeywords || []) {
    if (kw && title.includes(normText(kw))) { titleHits++; reasons.push(`Title matches "${kw}" (+18)`); }
  }
  score += Math.min(36, titleHits * 18);

  // Skill overlap with your resume skills.
  let skillHits = 0;
  for (const sk of skills) {
    if (sk && body.includes(sk)) { skillHits++; }
  }
  if (skillHits) { score += Math.min(24, skillHits * 6); reasons.push(`${skillHits} of your skills appear (+${Math.min(24, skillHits * 6)})`); }

  // Level fit.
  if (/\b(co-?op|intern(ship)?|student|entry[- ]level|junior|new grad|graduate program)\b/.test(body)) {
    score += 14; reasons.push('Student / entry-level wording (+14)');
  }
  if (/\b(senior|sr\.|staff|principal|architect|manager|director)\b/.test(title)) {
    score -= 25; flags.push('senior-title'); reasons.push('Senior-level title (-25)');
  }
  const yrs = yearsRequired(body);
  if (yrs >= 5) { score -= 25; flags.push('experience-barrier'); reasons.push(`Asks ${yrs}+ years experience (-25)`); }
  else if (yrs >= 3) { score -= 15; flags.push('experience-barrier'); reasons.push(`Asks ${yrs}+ years experience (-15)`); }

  // Degree trap check — a hard degree demand with no "or equivalent" escape.
  if (/bachelor'?s degree (is )?required|must (have|hold) a bachelor|degree required|bachelor'?s degree in (computer|software|electrical)/i.test(job.description || '')
      && !/or equivalent|or related experience|equivalent experience/i.test(job.description || '')) {
    score -= 10; flags.push('degree-required'); reasons.push('Posting demands a bachelor’s degree with no “or equivalent” (-10) — check diploma eligibility');
  }

  // Location / remote fit.
  const locHit = (prefs.locations || []).some((l) => l && normText(job.location).includes(normText(l)));
  if (job.remote) { score += 8; reasons.push('Remote (+8)'); }
  if (locHit) { score += 10; reasons.push(`Location fits: ${job.location} (+10)`); }
  if (prefs.remoteOnly && !job.remote && !locHit) { score -= 20; flags.push('onsite-elsewhere'); reasons.push('On-site outside your locations (-20)'); }

  // Recency.
  if (job.posted_at) {
    const ageH = (Date.now() - new Date(job.posted_at).getTime()) / 3600000;
    if (Number.isFinite(ageH) && ageH <= 48) { score += 8; reasons.push('Posted in the last 48h (+8)'); }
    else if (ageH <= 24 * 7) { score += 4; reasons.push('Posted this week (+4)'); }
    else if (ageH > 24 * 45) { score -= 6; reasons.push('Posting is over 45 days old (-6)'); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons, flags };
}

module.exports = { scoreJob, DEFAULT_PREFS };
