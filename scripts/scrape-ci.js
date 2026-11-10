'use strict';
/*
 * Headless overnight run for GitHub Actions (or any cron).
 *
 * Reads your matching profile from profile.json (copy profile.example.json),
 * runs the full pipeline into a throwaway database, then writes a static
 * report into docs/ that GitHub Pages can serve:
 *   docs/index.html  — readable report page
 *   docs/jobs.json   — machine-readable matches
 *   docs/report.md   — markdown summary (also nice in the repo)
 *
 * NOTE: profile.json can contain your resume. If you put real personal
 * details in it, keep the GitHub repo PRIVATE (Pages on private repos needs
 * GitHub Pro on personal accounts — or use the full app on a free host and
 * keep this report local). When in doubt, keep the committed profile light:
 * keywords + skills only, no resume text.
 */
const fs = require('node:fs');
const path = require('node:path');

process.env.JOBPILOT_DB = process.env.JOBPILOT_DB || path.join(__dirname, '..', 'data', 'ci.db');

const { db } = require('../lib/db');
const { runPipeline, topMatches } = require('../lib/pipeline');
const { DEFAULT_PREFS } = require('../lib/match');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const root = path.join(__dirname, '..');
  const profilePath = fs.existsSync(path.join(root, 'profile.json'))
    ? path.join(root, 'profile.json')
    : path.join(root, 'profile.example.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const email = 'ci@jobpilot.local';
  db.prepare('INSERT OR IGNORE INTO users (email, pass_hash, salt) VALUES (?, ?, ?)').run(email, 'ci', 'ci');
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const prefs = { ...DEFAULT_PREFS, ...(profile.prefs || {}) };
  db.prepare(`INSERT INTO profiles (user_id, name, headline, resume_text, skills, prefs_json)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, headline = excluded.headline,
                resume_text = excluded.resume_text, skills = excluded.skills, prefs_json = excluded.prefs_json`)
    .run(user.id, profile.name || '', profile.headline || '', profile.resume_text || '',
      JSON.stringify(profile.skills || []), JSON.stringify(prefs));

  const result = await runPipeline(user.id);
  const top = topMatches(user.id, 50, prefs.minScore || 0);
  const now = new Date().toISOString();

  const docsDir = path.join(root, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'jobs.json'), JSON.stringify({ generatedAt: now, run: result, matches: top }, null, 2));

  const md = [
    `# JobPilot report — ${now.slice(0, 10)}`,
    '',
    `Scanned sources returned **${result.found}** postings (${result.newJobs} new). Top score: **${result.topScore}**.`,
    result.errors && result.errors.length ? `\nSource warnings: ${result.errors.join('; ')}` : '',
    '',
    '## Top matches',
    '',
    ...top.slice(0, 25).map((j, i) => `${i + 1}. **[${j.score}] ${j.title}** — ${j.company} (${j.location || 'n/a'}) · ${j.source}\n   ${j.url}\n   _${j.reasons.slice(0, 3).join(' · ')}_${j.flags.length ? `\n   ⚠ ${j.flags.join(', ')}` : ''}`),
    '',
    '_Drafts of cover letters, tailored resumes and screening answers are generated in the full JobPilot app (see README)._',
  ].join('\n');
  fs.writeFileSync(path.join(docsDir, 'report.md'), md);

  const rows = top.slice(0, 50).map((j) => `
    <article class="job">
      <div class="score">${j.score}</div>
      <div>
        <h3><a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a></h3>
        <p class="meta">${esc(j.company)} · ${esc(j.location)} · ${esc(j.source)}</p>
        <p class="reasons">${esc(j.reasons.slice(0, 3).join(' · '))}</p>
        ${j.flags.length ? `<p class="flags">⚠ ${esc(j.flags.join(', '))}</p>` : ''}
      </div>
    </article>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JobPilot — nightly report</title>
<style>
body{background:#0b0f1a;color:#e8ecf6;font-family:ui-sans-system,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:28px 16px 60px}
main{max-width:860px;margin:0 auto}h1{font-size:1.7rem}.muted{color:#93a0bd}
.job{display:flex;gap:14px;background:#131a2c;border:1px solid #24304f;border-radius:14px;padding:16px;margin:12px 0}
.score{flex:none;width:52px;height:52px;border-radius:12px;background:#38d6a4;color:#06231a;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:1.15rem}
h3{margin:0 0 4px;font-size:1rem}a{color:#6c8cff;text-decoration:none}.meta,.reasons{color:#93a0bd;margin:3px 0;font-size:.88rem}.flags{color:#ffb454;font-size:.82rem;margin:3px 0}
</style></head><body><main>
<h1>🧭 JobPilot nightly report</h1>
<p class="muted">Generated ${esc(now)} · ${result.found} postings scanned · ${result.newJobs} new · top score ${result.topScore}</p>
${rows || '<p>No matches above the minimum score in this run.</p>'}
</main></body></html>`;
  fs.writeFileSync(path.join(docsDir, 'index.html'), html);

  console.log(`JobPilot CI run complete: found=${result.found} new=${result.newJobs} top=${result.topScore}`);
  if (result.errors && result.errors.length) console.log('Source warnings:', result.errors.join(' | '));
}

main().catch((e) => { console.error(e); process.exit(1); });
