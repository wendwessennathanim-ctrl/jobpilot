'use strict';
/*
 * JobPilot UI. Security note: every piece of server data is rendered with
 * textContent / createElement — never innerHTML — so job descriptions and
 * company names cannot inject markup (XSS) even if a source is hostile.
 */
const $ = (id) => document.getElementById(id);
let CSRF = '';
let currentJob = null;
let currentDoc = 'desc';
let jobDocs = {};
let authMode = 'login';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = CSRF;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------- auth ------------------------------- */
function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login');
  $('tabRegister').classList.toggle('active', mode === 'register');
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
$('tabLogin').addEventListener('click', () => setAuthMode('login'));
$('tabRegister').addEventListener('click', () => setAuthMode('register'));

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('authError').classList.add('hidden');
  try {
    const data = await api(`/api/${authMode}`, {
      method: 'POST',
      body: { email: $('authEmail').value, password: $('authPassword').value },
    });
    CSRF = data.csrf;
    await enterApp(data.email);
    if (authMode === 'register') toast('Account created — your profile is pre-filled. Press “Run scan now” for a first report.');
  } catch (err) {
    $('authError').textContent = err.message;
    $('authError').classList.remove('hidden');
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  CSRF = '';
  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
});

async function enterApp(email) {
  $('whoami').textContent = email;
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  await Promise.all([loadDashboard(), loadJobs(), loadApplications(), loadSettings()]);
}

/* ------------------------------ navigation ------------------------------ */
document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.navbtn').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + b.dataset.view).classList.remove('hidden');
}));

/* ------------------------------ dashboard ------------------------------ */
function scoreBadge(score) {
  const cls = score >= 70 ? 'hi' : score >= 40 ? 'md' : 'lo';
  return el('div', `score ${cls}`, String(score));
}

function jobCard(job, compact) {
  const card = el('div', 'job');
  const top = el('div', 'job-top');
  const left = el('div');
  left.appendChild(el('div', 'job-title', job.title));
  left.appendChild(el('div', 'job-meta', [job.company, job.location, job.source].filter(Boolean).join(' · ')));
  top.appendChild(left);
  top.appendChild(scoreBadge(job.score));
  card.appendChild(top);
  if (!compact && job.reasons && job.reasons.length) {
    card.appendChild(el('div', 'reasons', job.reasons.slice(0, 3).join(' · ')));
  }
  for (const f of job.flags || []) {
    if (f === 'degree-required') card.appendChild(el('span', 'flag', '⚠ degree wording — check diploma eligibility'));
    else if (f === 'experience-barrier') card.appendChild(el('span', 'flag', '⚠ experience barrier'));
  }
  card.addEventListener('click', () => openJob(job.id));
  return card;
}

async function loadDashboard() {
  const { lastRun, top } = await api('/api/report');
  const { applications } = await api('/api/applications');
  $('statApps').textContent = applications.length;
  $('statInterviews').textContent = applications.filter((a) => ['interview', 'offer'].includes(a.status)).length;
  $('statTop').textContent = top.length ? top[0].score : '—';
  $('statLastRun').textContent = lastRun && lastRun.finished_at ? lastRun.finished_at.slice(0, 10) : '—';
  const sum = $('reportSummary');
  sum.textContent = lastRun
    ? `Last scan: ${lastRun.finished_at || 'running…'}. Sources returned ${lastRun.found} postings, ${lastRun.new_jobs} of them new. Top score ${lastRun.top_score}.${lastRun.error ? ' Source warnings: ' + lastRun.error : ''}`
    : 'No scan yet. Press “Run scan now” or wait for the overnight run.';
  const list = $('topList');
  list.replaceChildren();
  if (!top.length) list.appendChild(el('p', 'muted', 'No matches above your minimum score yet.'));
  top.slice(0, 5).forEach((j) => list.appendChild(jobCard(j, true)));
}

/* -------------------------------- jobs -------------------------------- */
async function loadJobs() {
  const min = $('minScore').value || 0;
  const { jobs } = await api(`/api/jobs?minScore=${encodeURIComponent(min)}`);
  const list = $('jobList');
  list.replaceChildren();
  if (!jobs.length) list.appendChild(el('p', 'muted', 'Nothing here yet — run a scan, or lower the minimum score.'));
  jobs.forEach((j) => list.appendChild(jobCard(j, false)));
}
$('minScore').addEventListener('change', loadJobs);

$('runNowBtn').addEventListener('click', async () => {
  const btn = $('runNowBtn');
  btn.disabled = true; btn.textContent = 'Scanning… (up to a minute)';
  try {
    const r = await api('/api/run', { method: 'POST' });
    toast(`Scan done: ${r.found} postings found, ${r.newJobs} new, top score ${r.topScore}.`);
    await Promise.all([loadDashboard(), loadJobs()]);
  } catch (err) { toast(err.message); }
  btn.disabled = false; btn.textContent = 'Run scan now';
});

/* ------------------------------ job modal ------------------------------ */
async function openJob(id) {
  const { job, documents } = await api(`/api/jobs/${id}`);
  currentJob = job;
  jobDocs = {};
  for (const [kind, d] of Object.entries(documents || {})) jobDocs[kind] = d.content;
  $('mTitle').textContent = job.title;
  $('mMeta').textContent = [job.company, job.location, job.source, job.posted_at ? 'Posted ' + String(job.posted_at).slice(0, 10) : ''].filter(Boolean).join(' · ');
  const link = $('mLink');
  link.href = job.url;
  $('mScore').textContent = '';
  currentDoc = 'desc';
  document.querySelectorAll('.dtab').forEach((t) => t.classList.toggle('active', t.dataset.doc === 'desc'));
  showDoc();
  $('modal').classList.remove('hidden');
}
function showDoc() {
  const body = $('mBody');
  if (currentDoc === 'desc') body.textContent = currentJob.description || '(No description text was provided by the source.)';
  else body.textContent = jobDocs[currentDoc] || 'Not generated yet — press “Generate cover letter, resume & answers”.';
}
document.querySelectorAll('.dtab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.dtab').forEach((x) => x.classList.toggle('active', x === t));
  currentDoc = t.dataset.doc;
  showDoc();
}));
$('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });
$('mCopy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('mBody').textContent).catch(() => {});
  toast('Copied to clipboard');
});
$('mGenerate').addEventListener('click', async () => {
  const btn = $('mGenerate');
  btn.disabled = true; btn.textContent = 'Writing…';
  try {
    const { documents } = await api(`/api/jobs/${currentJob.id}/generate`, { method: 'POST' });
    jobDocs = documents;
    currentDoc = 'cover_letter';
    document.querySelectorAll('.dtab').forEach((x) => x.classList.toggle('active', x.dataset.doc === 'cover_letter'));
    showDoc();
    toast('Drafts ready — review them, then submit on the employer’s site yourself.');
  } catch (err) { toast(err.message); }
  btn.disabled = false; btn.textContent = 'Generate cover letter, resume & answers';
});
$('mTrack').addEventListener('click', async () => {
  await api('/api/applications', {
    method: 'POST',
    body: { job_id: currentJob.id, title: currentJob.title, company: currentJob.company, url: currentJob.url, status: 'saved' },
  });
  toast('Added to your tracker');
  await Promise.all([loadApplications(), loadDashboard()]);
});

/* ---------------------------- applications ---------------------------- */
const STATUSES = ['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'closed'];
const LABELS = { saved: 'Saved', applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer 🎉', rejected: 'Rejected', closed: 'Closed' };
let allApps = [];

async function loadApplications() {
  const { applications } = await api('/api/applications');
  allApps = applications;
  const board = $('appBoard');
  board.replaceChildren();
  for (const st of STATUSES) {
    const col = el('div', 'col');
    col.appendChild(el('h3', null, `${LABELS[st]} (${applications.filter((a) => a.status === st).length})`));
    for (const a of applications.filter((x) => x.status === st)) {
      const card = el('div', 'app');
      const link = el('a', null, a.title);
      link.href = a.url || '#'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.appendChild(link);
      card.appendChild(el('div', 'co', a.company || ''));
      if (a.applied_at) card.appendChild(el('div', 'co', 'Applied ' + a.applied_at.slice(0, 10)));
      const sel = el('select');
      for (const s2 of STATUSES) {
        const o = el('option', null, LABELS[s2]);
        o.value = s2; o.selected = s2 === a.status;
        sel.appendChild(o);
      }
      sel.addEventListener('change', async () => {
        await api(`/api/applications/${a.id}`, { method: 'PUT', body: { status: sel.value, notes: a.notes } });
        toast('Tracker updated');
        await Promise.all([loadApplications(), loadDashboard()]);
      });
      card.appendChild(sel);
      col.appendChild(card);
    }
    board.appendChild(col);
  }
}
$('addAppBtn').addEventListener('click', async () => {
  const title = prompt('Job title:');
  if (!title) return;
  const company = prompt('Company:') || '';
  const url = prompt('Posting URL (optional):') || '';
  await api('/api/applications', { method: 'POST', body: { title, company, url, status: 'saved' } });
  await Promise.all([loadApplications(), loadDashboard()]);
});

/* ------------------------------ settings ------------------------------ */
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
async function loadSettings() {
  const { profile } = await api('/api/profile');
  if (!profile) return;
  const p = profile.prefs || {};
  $('pfName').value = profile.name || '';
  $('pfHeadline').value = profile.headline || '';
  $('pfSkills').value = (profile.skills || []).join(', ');
  $('pfResume').value = profile.resume_text || '';
  $('pfTitleKw').value = (p.titleKeywords || []).join(', ');
  $('pfLocations').value = (p.locations || []).join(', ');
  $('pfExclude').value = (p.excludeKeywords || []).join(', ');
  $('pfMinScore').value = p.minScore ?? 40;
  $('pfRunHour').value = p.runHour ?? 2;
  $('pfRemoteOnly').checked = !!p.remoteOnly;
  $('pfAvailability').value = p.availability || '';
  $('pfLever').value = (p.leverCompanies || []).join(', ');
  $('pfGreenhouse').value = (p.greenhouseBoards || []).join(', ');
  $('pfFeeds').value = (p.extraFeeds || []).join(', ');
  $('minScore').value = p.minScore ?? 40;
}
$('saveProfileBtn').addEventListener('click', async () => {
  await api('/api/profile', {
    method: 'PUT',
    body: {
      name: $('pfName').value, headline: $('pfHeadline').value,
      skills: csv($('pfSkills').value), resume_text: $('pfResume').value,
      prefs: {
        titleKeywords: csv($('pfTitleKw').value), locations: csv($('pfLocations').value),
        excludeKeywords: csv($('pfExclude').value), minScore: Number($('pfMinScore').value),
        runHour: Number($('pfRunHour').value), remoteOnly: $('pfRemoteOnly').checked,
        availability: $('pfAvailability').value, leverCompanies: csv($('pfLever').value),
        greenhouseBoards: csv($('pfGreenhouse').value), extraFeeds: csv($('pfFeeds').value),
      },
    },
  });
  $('settingsMsg').textContent = 'Saved. New preferences apply from the next scan.';
  $('minScore').value = $('pfMinScore').value;
  toast('Profile saved');
});

/* --------------------- pointer sheen on cards --------------------- */
document.addEventListener('pointermove', (e) => {
  const t = e.target.closest ? e.target.closest('.job') : null;
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  t.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });

/* -------------------------------- boot -------------------------------- */
(async () => {
  try {
    const me = await api('/api/me');
    CSRF = me.csrf;
    await enterApp(me.email);
  } catch {
    $('authView').classList.remove('hidden');
  }
})();
