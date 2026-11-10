'use strict';
/*
 * Job sources — free, public, no API key required.
 *
 * We deliberately use official public APIs and feeds instead of scraping
 * LinkedIn / Indeed / Glassdoor HTML: those sites ban bots in their Terms,
 * block datacenter IPs, and put logins behind CAPTCHAs, so HTML scraping
 * them is unreliable and can get accounts banned. The sources below are
 * the legal, stable way to aggregate a lot of real postings for free:
 *
 *   RemoteOK, Arbeitnow, Jobicy, Remotive, Himalayas  (open APIs)
 *   Lever + Greenhouse public board APIs for specific companies you name
 *   Any RSS feed you add yourself (e.g. a Canada Job Bank search feed,
 *   We Work Remotely category feeds, company career-page feeds)
 *
 * Every adapter fails independently: one dead source never kills the run.
 */
const crypto = require('node:crypto');

const UA = 'JobPilot/1.0 (personal job-search aggregator; contact: the repo owner)';

async function fetchJson(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Strip HTML to plain text (descriptions are stored and shown as text). */
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, 20000);
}

function jobId(source, key) {
  return crypto.createHash('sha256').update(`${source}|${key}`).digest('hex').slice(0, 32);
}

function norm(partial) {
  return {
    id: jobId(partial.source, partial.url || partial.title),
    source: partial.source,
    title: String(partial.title || 'Untitled').slice(0, 300),
    company: String(partial.company || '').slice(0, 200),
    location: String(partial.location || '').slice(0, 200),
    remote: partial.remote ? 1 : 0,
    url: String(partial.url || ''),
    description: stripHtml(partial.description || ''),
    tags: Array.isArray(partial.tags) ? partial.tags.slice(0, 20).map(String) : [],
    posted_at: partial.posted_at || null,
  };
}

const adapters = {
  async remoteok() {
    const data = await fetchJson('https://remoteok.com/api');
    return (Array.isArray(data) ? data : [])
      .filter((j) => j && j.position)
      .map((j) => norm({
        source: 'RemoteOK', title: j.position, company: j.company,
        location: j.location || 'Remote', remote: true, url: j.url,
        description: j.description, tags: j.tags, posted_at: j.date || null,
      }));
  },

  async arbeitnow() {
    const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
    return (data.data || []).map((j) => norm({
      source: 'Arbeitnow', title: j.title, company: j.company_name,
      location: j.location || '', remote: !!j.remote, url: j.url,
      description: j.description, tags: j.tags,
      posted_at: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    }));
  },

  async jobicy() {
    const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50');
    return (data.jobs || []).map((j) => norm({
      source: 'Jobicy', title: j.jobTitle, company: j.companyName,
      location: j.jobGeo || 'Remote', remote: true, url: j.url,
      description: j.jobDescription, tags: [j.jobIndustry, j.jobType].filter(Boolean),
      posted_at: j.pubDate || null,
    }));
  },

  async remotive() {
    const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=100');
    return (data.jobs || []).map((j) => norm({
      source: 'Remotive', title: j.title, company: j.company_name,
      location: j.candidate_required_location || 'Remote', remote: true, url: j.url,
      description: j.description, tags: [j.category, ...(j.tags || [])],
      posted_at: j.publication_date || null,
    }));
  },

  async himalayas() {
    const data = await fetchJson('https://himalayas.app/jobs/api?limit=50');
    return (data.jobs || []).map((j) => norm({
      source: 'Himalayas', title: j.title, company: j.companyName,
      location: (j.locationRestrictions || []).join(', ') || 'Remote', remote: true,
      url: j.applicationLink || j.guid, description: j.description,
      tags: j.categories, posted_at: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
    }));
  },

};

/** Lever public postings API for one company slug, e.g. "magnetforensics". */
async function leverCompany(slug) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j) => norm({
    source: `Lever:${slug}`, title: j.text, company: slug,
    location: (j.categories && j.categories.location) || '',
    remote: /remote/i.test(JSON.stringify(j.categories || {})),
    url: j.hostedUrl, description: j.descriptionPlain || j.description,
    tags: [j.categories && j.categories.team, j.categories && j.categories.commitment].filter(Boolean),
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

/** Greenhouse public board API for one board token, e.g. "gitlab". */
async function greenhouseBoard(token) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  return (data.jobs || []).map((j) => norm({
    source: `Greenhouse:${token}`, title: j.title, company: token,
    location: (j.location && j.location.name) || '',
    remote: /remote/i.test((j.location && j.location.name) || ''),
    url: j.absolute_url, description: j.content,
    tags: (j.departments || []).map((d) => d.name),
    posted_at: j.updated_at || null,
  }));
}

/** Minimal RSS/Atom reader for user-supplied feeds (Job Bank, WWR, etc.). */
async function rssFeed(feedUrl) {
  const xml = await fetchText(feedUrl);
  const items = [];
  const itemRe = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g;
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  };
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 60) {
    const block = m[0];
    const linkM = block.match(/<link[^>]*href="([^"]+)"/) || block.match(/<link>([\s\S]*?)<\/link>/);
    items.push(norm({
      source: 'RSS', title: stripHtml(pick(block, 'title')) || 'Untitled',
      company: stripHtml(pick(block, 'author') || pick(block, 'dc:creator')),
      location: '', remote: /remote/i.test(block), url: linkM ? linkM[1] : feedUrl,
      description: pick(block, 'description') || pick(block, 'summary') || pick(block, 'content'),
      posted_at: pick(block, 'pubDate') || pick(block, 'published') || null,
    }));
  }
  return items;
}

/**
 * Fetch from every enabled source. `prefs` may carry:
 *   leverCompanies: string[], greenhouseBoards: string[], extraFeeds: string[]
 * Returns { jobs, errors } — errors are per-source and non-fatal.
 */
async function fetchAllJobs(prefs = {}) {
  const jobs = [];
  const errors = [];
  const tasks = Object.entries(adapters).map(([name, fn]) =>
    fn().then((list) => jobs.push(...list)).catch((e) => errors.push(`${name}: ${e.message}`))
  );
  for (const slug of prefs.leverCompanies || []) {
    tasks.push(leverCompany(slug).then((l) => jobs.push(...l)).catch((e) => errors.push(`lever:${slug}: ${e.message}`)));
  }
  for (const token of prefs.greenhouseBoards || []) {
    tasks.push(greenhouseBoard(token).then((l) => jobs.push(...l)).catch((e) => errors.push(`greenhouse:${token}: ${e.message}`)));
  }
  for (const feed of prefs.extraFeeds || []) {
    tasks.push(rssFeed(feed).then((l) => jobs.push(...l)).catch((e) => errors.push(`rss: ${e.message}`)));
  }
  await Promise.allSettled(tasks);

  // Dedupe by id.
  const seen = new Set();
  return {
    jobs: jobs.filter((j) => j.url && !seen.has(j.id) && seen.add(j.id)),
    errors,
  };
}

module.exports = { fetchAllJobs, stripHtml };
