'use strict';
/*
 * Scholarship sources — free and public, mirroring the job sources' rules:
 * no scraping of login-walled aggregators. Three feeds:
 *
 *   1. Curated — opportunities verified by hand against official pages
 *      (Oct 2026). Small, high-trust, always available offline.
 *   2. Algonquin College financial-aid pages — award links extracted from
 *      the college's own public pages (best effort; fails soft).
 *   3. RSS feeds the user adds in Settings (prefs.schFeeds).
 *
 * Eligibility is NOT decided here — that's lib/scholarship-match.js. This
 * module only collects: title, provider, amount, deadline, and the full
 * criteria text the matcher needs.
 */
const crypto = require('node:crypto');
const { stripHtml } = require('./sources');

const UA = 'JobPilot/1.0 (personal scholarship aggregator; contact: the repo owner)';

async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function schId(source, key) {
  return crypto.createHash('sha256').update(`sch|${source}|${key}`).digest('hex').slice(0, 32);
}

function norm(p) {
  return {
    id: schId(p.source, p.url || p.title),
    source: p.source,
    title: String(p.title || 'Untitled award').slice(0, 300),
    provider: String(p.provider || '').slice(0, 200),
    url: String(p.url || ''),
    amount_text: String(p.amount_text || '').slice(0, 120),
    deadline: p.deadline || null,
    description: String(p.description || '').slice(0, 6000),
    criteria_text: String(p.criteria_text || '').slice(0, 12000),
  };
}

/* ------------------------------- curated -------------------------------- */
/* Verified against official pages in Oct 2026 for an international CET-CS
 * student at Algonquin College. Keep claims exactly as verified; the UI
 * labels these "Curated" and the matcher still re-checks the criteria. */
function curated() {
  return [
    norm({
      source: 'Curated', provider: 'Algonquin College',
      title: 'General Bursary Application — Winter 2027',
      url: 'https://www.algonquincollege.com/financial-aid/',
      amount_text: 'Varies — one application covers 100+ bursaries',
      deadline: '2027-01-20',
      description: 'Algonquin College\'s single bursary application for the Winter 2027 term. The application window is Dec 22, 2026 to Jan 20, 2027 in the ACSIS Bursary Portal. Most bursaries are need-based.',
      criteria_text: 'Eligibility: enrolled Algonquin College students demonstrating financial need. International students may apply through the general bursary application. Requirement: your Social Insurance Number (SIN) must be registered in ACSIS before the application will open. No essay. Apply in the ACSIS Bursary Portal during the window.',
    }),
    norm({
      source: 'Curated', provider: 'ADGA Group (via Algonquin College)',
      title: 'ADGA Bursary',
      url: 'https://www.algonquincollege.com/financial-aid/',
      amount_text: '$1,000 × 10 awards',
      deadline: '2027-01-20',
      description: 'Bursary for students in Algonquin\'s School of Advanced Technology, awarded through the college\'s general bursary application (Winter window closes Jan 20, 2027).',
      criteria_text: 'Eligibility: students enrolled in the School of Advanced Technology at Algonquin College with demonstrated financial need. International students are explicitly eligible. Awarded via the general bursary application — no separate essay.',
    }),
    norm({
      source: 'Curated', provider: 'International Education Centre, Algonquin College',
      title: 'IEC International Student Scholarships',
      url: 'https://www.algonquincollege.com/financial-aid/',
      amount_text: 'Varies by school',
      deadline: null,
      description: 'Automatic-consideration scholarships for international students at Algonquin College, awarded to the highest-GPA international student in each school. Graduating-year opportunity — no application to file.',
      criteria_text: 'Eligibility: international students at Algonquin College. Selection is automatic, based on the highest GPA per school. No essay and no separate application.',
    }),
    norm({
      source: 'Curated', provider: 'International House / Algonquin College',
      title: 'International House Prize',
      url: 'https://www.algonquincollege.com/financial-aid/',
      amount_text: 'Varies',
      deadline: null,
      description: 'Prize recognising an international student\'s academic achievement at Algonquin College. Graduating-year opportunity (2027–28).',
      criteria_text: 'Eligibility: international students at Algonquin College with a GPA of 3.60 or higher. Confirm current-year details and any nomination process on the official page.',
    }),
  ];
}

/* ------------------------- Algonquin awards pages ------------------------ */
const ALGONQUIN_PAGES = [
  'https://www.algonquincollege.com/financial-aid/',
  'https://www.algonquincollege.com/financial-aid/scholarships-bursaries-awards/',
  'https://www.algonquincollege.com/financial-aid/awards/',
];

async function algonquin() {
  const out = [];
  const seen = new Set();
  for (const page of ALGONQUIN_PAGES) {
    let html = '';
    try { html = await fetchText(page); } catch { continue; }
    const linkRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null && out.length < 40) {
      const text = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
      const href = m[1];
      if (!text || text.length < 6 || text.length > 140) continue;
      if (!/scholarship|bursar|award|prize/i.test(text)) continue;
      if (/^(how to|apply|awards?,?\s*&?\s*bursaries|financial aid|fees?\b)/i.test(text)) continue; // navigation pages, not awards
      let abs;
      try { abs = new URL(href, page).toString(); } catch { continue; }
      if (!abs.startsWith('https://www.algonquincollege.com/')) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(norm({
        source: 'Algonquin College', provider: 'Algonquin College',
        title: text, url: abs,
        description: 'Award listed on Algonquin College\'s financial-aid pages. Open the official page for the amount, deadline and full eligibility criteria — JobPilot scores it from this listing text, so verify details on the page before applying.',
        criteria_text: `Listed on Algonquin College financial aid pages: "${text}". Full criteria on the official page.`,
      }));
    }
  }
  return out;
}

/* --------------------------------- RSS ---------------------------------- */
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
  while ((m = itemRe.exec(xml)) !== null && items.length < 40) {
    const block = m[0];
    const linkM = block.match(/<link[^>]*href="([^"]+)"/) || block.match(/<link>([\s\S]*?)<\/link>/);
    const desc = stripHtml(pick(block, 'description') || pick(block, 'summary') || pick(block, 'content'));
    items.push(norm({
      source: 'RSS', provider: stripHtml(pick(block, 'author') || pick(block, 'dc:creator')),
      title: stripHtml(pick(block, 'title')) || 'Untitled award',
      url: linkM ? linkM[1] : feedUrl,
      description: desc, criteria_text: desc,
    }));
  }
  return items;
}

async function fetchAllScholarships(prefs = {}) {
  const items = [];
  const errors = [];
  const tasks = [
    Promise.resolve().then(curated).then((l) => items.push(...l)).catch((e) => errors.push(`curated: ${e.message}`)),
    algonquin().then((l) => items.push(...l)).catch((e) => errors.push(`algonquin: ${e.message}`)),
  ];
  const sch = (prefs && prefs.scholarship) || {};
  for (const feed of prefs.schFeeds || sch.feeds || []) {
    tasks.push(rssFeed(feed).then((l) => items.push(...l)).catch((e) => errors.push(`rss: ${e.message}`)));
  }
  await Promise.allSettled(tasks);
  const seen = new Set();
  return {
    scholarships: items.filter((s) => s.url && !seen.has(s.id) && seen.add(s.id)),
    errors,
  };
}

module.exports = { fetchAllScholarships, curated };
