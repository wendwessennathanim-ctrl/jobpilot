'use strict';
/*
 * JobPilot server — zero-dependency Node http server.
 *
 * Security posture (all implemented, not aspirational):
 *  - Passwords: scrypt + per-user salt (lib/auth.js). Never stored/logged raw.
 *  - Sessions: random tokens, only SHA-256 hashes stored; HttpOnly +
 *    SameSite=Lax cookies (+ Secure on HTTPS); 7-day expiry; logout destroys.
 *  - CSRF: per-session token required on every state-changing API call.
 *  - SQL injection: prepared statements with bound params, everywhere.
 *  - XSS: the UI renders all server data via textContent (never innerHTML
 *    with unescaped data), plus a strict Content-Security-Policy below.
 *  - Brute force: per-IP rate limits + per-account lockout after 5 failures.
 *  - Headers: CSP, X-Frame-Options DENY (clickjacking), nosniff,
 *    Referrer-Policy, Permissions-Policy. Static files are path-checked so
 *    ../ traversal cannot escape public/.
 *  - Bodies capped at 512 KB; errors are generic (no stack traces, no
 *    "email exists" oracle on login).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./lib/db');
const auth = require('./lib/auth');
const { runPipeline, getProfile, topMatches } = require('./lib/pipeline');
const { generateAll } = require('./lib/generate');
const { DEFAULT_PREFS } = require('./lib/match');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 512 * 1024;

/* ------------------------------ seed profile ------------------------------ */
// First registered account gets Nathi's real starting profile so the app is
// useful immediately. Edit everything later in Settings. (No secrets here.)
const SEED_PROFILE = {
  name: "Nathanim Wubete",
  headline: "Computer Engineering Technology student at Algonquin College (GPA 3.77, Dean's Honours List) focused on CI/CD and build automation — Linux administration, Bash/Python scripting, GitHub Actions, Jenkins, and full-stack development (Spring Boot, React).",
  skills: ["Bash","Python","Java","JavaScript","C","C++","SQL","Linux","Git","GitHub Actions","Jenkins","CI/CD","Spring Boot","React","Node.js","REST APIs","n8n","Maven","Wireshark","TCP/IP","HTML5","CSS3"],
  resume_text: "NATHANIM WUBETE\n(613) 791-2710 · wube0004@algonquinlive.com · Ottawa, ON · LinkedIn · Github · Credly\n\nPROFILE\nComputer Engineering Technology student at Algonquin College (GPA 3.77, Dean's Honours List) focused on CI/CD and build automation, with hands-on experience in Linux system administration, Bash and Python scripting, and Git-based workflows. Currently building an AI-assisted, self-healing CI/CD pipeline with GitHub Actions that diagnoses failed builds and proposes fixes automatically. Seeking a CI/CD role where I can apply my scripting, systems, and full-stack skills to build reliable, automated delivery pipelines.\n\nTECHNICAL SKILLS\nLanguages: Bash/Shell, Java, Python, JavaScript, C/C++, SQL, HTML5, CSS3\nOS: Linux (Ubuntu), Windows, macOS\nCI/CD & Automation: Jenkins, GitHub Actions, GitHub Secrets, n8n, Maven, npm, Bash scripting, Git/GitHub\nFrameworks & Libraries: Spring Boot, React, Vite, axios, react-router-dom, REST APIs\nTools: IntelliJ, VS Code, Eclipse, Wireshark, Cisco Packet Tracer\nConcepts: CI/CD, Build & Test Automation, Access control and user authorization, Full-Stack Development, RESTful APIs & Client-Server Architecture, Object-Oriented Design, Relational Databases (SQL), Agile, AI-Assisted Development\nNetworking: TCP/IP, OSI Model, Static Routing, NAT, IPv4/IPv6, Optical Networking Fundamentals, Wireshark Packet Analysis\nAI/LLMs: Claude Code, Copilot, ChatGPT Codex, Gemini, OpenAI API, RAG agents\nCurrently expanding: Node.js, PHP, jQuery, Automation Anywhere, RPA frameworks\n\nSOFT SKILLS\n- Collaborate effectively with team members and communicate clearly across technical and non-technical audiences\n- Demonstrated strong attention to detail in problem-solving and deliverables\n- Can quickly acquire new technical skills and adapt to unfamiliar tools and environments\n- Apply practical, solution-oriented approaches to troubleshooting and development\n- Maintained strong organizational skills and managed time effectively across multiple priorities\n- Can take initiative and follow through reliably on assigned tasks\n\nEDUCATION\nComputer Engineering Technology – Computing Science | Algonquin College, Sept. 2025 – Expected 2028\n- GPA 3.77 / 4.0 — Dean's Honours List 2025\n- Coursework: OOP (Java), Operating Systems (Linux), Networking, Technical Communications, Web Programming, Data Structures\n\nPROJECTS\nSelf-Healing CI/CD Pipeline | GitHub Actions, n8n, OpenAI API, Node.js/Express, Oct. 2026 – Present\n- Building an automated pipeline that detects failed builds, uses an LLM to analyze error logs and generate code patches, and opens pull requests with the proposed fix.\n- Integrating GitHub webhooks with n8n workflows and automated email alerts, with API keys secured through GitHub Secrets.\n\nJobBot — Full-Stack Job Automation App | Java, Spring Boot, React, Vite, REST APIs, 2026 – Present\n- Actively building a full-stack application to automate job search workflows; frontend built with React and Vite using axios for REST API communication and react-router-dom for client-side routing.\n- Designed a RESTful Spring Boot backend with a layered architecture (model, controller, service, repository) backed by an H2 in-memory database; managed end-to-end with npm and Maven.\n\nLinux User Management Automation Script | Bash, Linux Admin, Jan. 2026\n- Built a menu-driven Bash script automating Linux user account administration (add, modify, delete) across multiple groups with full error handling, cutting manual administration time by ~80%.\n\nNetwork Infrastructure & Protocol Analysis | Packet Tracer, Wireshark, Feb. 2026\n- Designed and verified 4-segment Cisco/Linksys networks (static routes, NAT, IPv4/IPv6) to analyze and optimize network performance; traced ARP, ICMP, and TFTP flows across OSI Layers 2–7 using Wireshark deep-packet inspection.\n\nTCP Socket Client–Server Messaging App | Java, Networking, Jan. 2026\n- Built a TextServer and TextClient over TCP port 18990; managed the full 3-way handshake lifecycle and graceful teardown using Wireshark to verify 0% packet loss.\n\nWard Tax Prediction — Linear Regression Engine | Java, OOP, Feb. 2026\n- Parsed multi-year ward CSV data and applied linear regression to forecast municipal tax assessments within a multi-class Java architecture (abstract classes, inheritance, polymorphism).\n- Interactive CLI delivers predictions in under 1 second; lets users estimate taxes for any new ward on demand.\n\nPersonal Portfolio Website | HTML, CSS, JavaScript, June 2026\n- Designed and built a 4-page responsive, WCAG-aligned portfolio site with a JavaScript-driven project slideshow and real-time form validation.\n\nWORK EXPERIENCE & LEADERSHIP\nIBM Z Student Ambassador & Club Leader | Algonquin College, Dec. 2025 – Present\n- Selected as an IBM Z Student Ambassador after independently completing IBM Z Xplore Fundamentals and Concepts badges; led the IBM Z Club, promoting mainframe technologies and enterprise architecture (z/OS, JCL) to fellow students.\n- Facilitated workshops and hands-on sessions, helping students earn accredited IBM Z credentials, strengthening peer engagement with mainframe computing.\n\nCashier & Line Cook | McDonald's, Ottawa, Nov. 2025 – Present\n- Maintained 100% food safety compliance during peak service; communicated efficiently under pressure in a fast-paced team environment.\n- Collaborated with team members to meet fast-paced service demands and minimize wait times.\n- Managed multiple tasks simultaneously, including order taking, food preparation, and order assembly.\n- Adapted quickly to changing priorities, including peak hours and shifting responsibilities.\n- Consistently met performance expectations for speed, accuracy, and teamwork.\n\nCERTIFICATIONS\nIBM Z Xplore Fundamentals Badge (2026)\nIBM Z Xplore Concepts Badge (2026)",
  prefs: { ...DEFAULT_PREFS },
};

/* ------------------------------- rate limit ------------------------------ */
const hits = new Map(); // key -> [timestamps]
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

/* -------------------------------- helpers -------------------------------- */
function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function currentSession(req) {
  const cookies = auth.parseCookies(req);
  return cookies.sid ? auth.getSession(cookies.sid) : null;
}

function requireAuth(req, res) {
  const s = currentSession(req);
  if (!s) { sendJson(res, 401, { error: 'Not signed in' }); return null; }
  return s;
}

function requireCsrf(req, res, session) {
  if (!auth.csrfValid(session, req.headers['x-csrf-token'])) {
    sendJson(res, 403, { error: 'CSRF check failed — reload the page and try again' });
    return false;
  }
  return true;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/* --------------------------------- routes -------------------------------- */
async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  if (p === '/api/register' && method === 'POST') {
    if (rateLimited(`reg:${req.socket.remoteAddress}`, 5, 3600000)) return sendJson(res, 429, { error: 'Too many attempts — try again later' });
    const body = await readBody(req);
    const email = str(body.email, 254).trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address' });
    if (password.length < 10 || password.length > 200) return sendJson(res, 400, { error: 'Password must be at least 10 characters' });
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return sendJson(res, 400, { error: 'Could not create the account — try signing in instead' });
    const { salt, hash } = auth.hashPassword(password);
    const info = db.prepare('INSERT INTO users (email, pass_hash, salt) VALUES (?, ?, ?)').run(email, hash, salt);
    const userId = Number(info.lastInsertRowid);
    const isFirst = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 1;
    const prof = isFirst ? SEED_PROFILE : { name: '', headline: '', skills: [], resume_text: '', prefs: { ...DEFAULT_PREFS } };
    db.prepare('INSERT INTO profiles (user_id, name, headline, resume_text, skills, prefs_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, prof.name, prof.headline, prof.resume_text, JSON.stringify(prof.skills), JSON.stringify(prof.prefs));
    const s = auth.createSession(userId);
    return sendJson(res, 201, { ok: true, email, csrf: s.csrf }, { 'Set-Cookie': auth.sessionCookie(req, s.token, s.expires) });
  }

  if (p === '/api/login' && method === 'POST') {
    if (rateLimited(`login:${req.socket.remoteAddress}`, 20, 900000)) return sendJson(res, 429, { error: 'Too many attempts — try again later' });
    const body = await readBody(req);
    const email = str(body.email, 254).trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (auth.isLocked(email)) return sendJson(res, 429, { error: 'Account temporarily locked after repeated failed attempts — try again in 15 minutes' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Run scrypt either way so timing does not reveal whether the email exists.
    const ok = user
      ? auth.verifyPassword(password, user.salt, user.pass_hash)
      : auth.verifyPassword(password, 'deadbeefdeadbeefdeadbeefdeadbeef', 'ab'.repeat(64));
    if (!ok) { auth.noteFailedLogin(email); return sendJson(res, 401, { error: 'Email or password is incorrect' }); }
    auth.clearFailedLogins(email);
    const s = auth.createSession(user.id);
    return sendJson(res, 200, { ok: true, email, csrf: s.csrf }, { 'Set-Cookie': auth.sessionCookie(req, s.token, s.expires) });
  }

  if (p === '/api/logout' && method === 'POST') {
    const cookies = auth.parseCookies(req);
    auth.destroySession(cookies.sid);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (p === '/api/me' && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    return sendJson(res, 200, { email: s.email, csrf: s.csrf });
  }

  if (p === '/api/profile' && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    return sendJson(res, 200, { profile: getProfile(s.userId) });
  }

  if (p === '/api/profile' && method === 'PUT') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    const body = await readBody(req);
    const cur = getProfile(s.userId);
    const name = str(body.name ?? cur.name, 120);
    const headline = str(body.headline ?? cur.headline, 600);
    const resume = str(body.resume_text ?? cur.resume_text, 60000);
    const skills = Array.isArray(body.skills) ? body.skills.slice(0, 60).map((x) => str(x, 60)).filter(Boolean) : cur.skills;
    const prefs = { ...cur.prefs };
    if (body.prefs && typeof body.prefs === 'object') {
      for (const k of Object.keys(DEFAULT_PREFS)) {
        if (k in body.prefs) prefs[k] = body.prefs[k];
      }
      // Sanitise the structured prefs.
      for (const k of ['titleKeywords', 'locations', 'excludeKeywords', 'leverCompanies', 'greenhouseBoards', 'extraFeeds']) {
        if (Array.isArray(prefs[k])) prefs[k] = prefs[k].slice(0, 40).map((x) => str(x, 300)).filter(Boolean);
      }
      prefs.minScore = Math.max(0, Math.min(100, Number(prefs.minScore) || 0));
      prefs.runHour = Math.max(0, Math.min(23, Number(prefs.runHour) || 2));
      prefs.availability = str(prefs.availability, 500);
      prefs.remoteOnly = !!prefs.remoteOnly;
    }
    db.prepare("UPDATE profiles SET name = ?, headline = ?, resume_text = ?, skills = ?, prefs_json = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(name, headline, resume, JSON.stringify(skills), JSON.stringify(prefs), s.userId);
    return sendJson(res, 200, { profile: getProfile(s.userId) });
  }

  if (p === '/api/jobs' && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const profile = getProfile(s.userId);
    const min = Math.max(0, Math.min(100, Number(url.searchParams.get('minScore') ?? (profile.prefs.minScore || 0)) || 0));
    return sendJson(res, 200, { jobs: topMatches(s.userId, 60, min) });
  }

  const jobMatch = p.match(/^\/api\/jobs\/([a-f0-9]{32})$/);
  if (jobMatch && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobMatch[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    const docs = db.prepare('SELECT kind, content, created_at FROM documents WHERE user_id = ? AND job_id = ? ORDER BY created_at DESC').all(s.userId, job.id);
    const latest = {};
    for (const d of docs) if (!latest[d.kind]) latest[d.kind] = d;
    return sendJson(res, 200, { job: { ...job, tags: JSON.parse(job.tags || '[]') }, documents: latest });
  }

  const genMatch = p.match(/^\/api\/jobs\/([a-f0-9]{32})\/generate$/);
  if (genMatch && method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(genMatch[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    job.tags = JSON.parse(job.tags || '[]');
    const profile = getProfile(s.userId);
    const docs = await generateAll(profile, job);
    const ins = db.prepare('INSERT INTO documents (user_id, job_id, kind, content) VALUES (?, ?, ?, ?)');
    for (const [kind, content] of Object.entries(docs)) ins.run(s.userId, job.id, kind, content);
    return sendJson(res, 200, { documents: docs });
  }

  if (p === '/api/report' && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const lastRun = db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(s.userId) || null;
    const profile = getProfile(s.userId);
    return sendJson(res, 200, { lastRun, top: topMatches(s.userId, 10, profile.prefs.minScore || 0) });
  }

  if (p === '/api/run' && method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    const result = await runPipeline(s.userId);
    return sendJson(res, 200, result);
  }

  if (p === '/api/applications' && method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const apps = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC').all(s.userId);
    return sendJson(res, 200, { applications: apps });
  }

  if (p === '/api/applications' && method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    const body = await readBody(req);
    const title = str(body.title, 300);
    if (!title) return sendJson(res, 400, { error: 'Title is required' });
    const jobId = typeof body.job_id === 'string' && /^[a-f0-9]{32}$/.test(body.job_id) ? body.job_id : null;
    const info = db.prepare('INSERT INTO applications (user_id, job_id, title, company, url, status, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.userId, jobId, title, str(body.company, 200), str(body.url, 1000),
        ['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'closed'].includes(body.status) ? body.status : 'saved',
        body.status === 'applied' ? new Date().toISOString() : null);
    return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
  }

  const appMatch = p.match(/^\/api\/applications\/(\d+)$/);
  if (appMatch && method === 'PUT') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    const body = await readBody(req);
    const app = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(appMatch[1]), s.userId);
    if (!app) return sendJson(res, 404, { error: 'Application not found' });
    const status = ['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'closed'].includes(body.status) ? body.status : app.status;
    db.prepare("UPDATE applications SET status = ?, notes = ?, applied_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(status, str(body.notes ?? app.notes, 4000),
        status === 'applied' && !app.applied_at ? new Date().toISOString() : app.applied_at,
        app.id, s.userId);
    return sendJson(res, 200, { ok: true });
  }
  if (appMatch && method === 'DELETE') {
    const s = requireAuth(req, res); if (!s) return;
    if (!requireCsrf(req, res, s)) return;
    db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(Number(appMatch[1]), s.userId);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* --------------------------------- static -------------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, url) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong' });
    console.error('[jobpilot] error:', e.message);
  }
});

/* --------------------------- overnight scheduler -------------------------- */
// Every minute, check each user: if the local hour matches their runHour and
// no run has finished today, run the pipeline. This is what makes JobPilot
// work overnight while the app stays open on any always-on host.
const lastRunDay = new Map();
setInterval(async () => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      const profile = getProfile(u.id);
      if (!profile) continue;
      const hour = Number(profile.prefs.runHour ?? 2);
      if (now.getHours() !== hour) continue;
      if (lastRunDay.get(u.id) === today) continue;
      const done = db.prepare("SELECT 1 FROM runs WHERE user_id = ? AND date(started_at) = date('now') AND finished_at IS NOT NULL").get(u.id);
      lastRunDay.set(u.id, today);
      if (done) continue;
      console.log(`[jobpilot] overnight run for user ${u.id}`);
      runPipeline(u.id).catch((e) => console.error('[jobpilot] scheduled run failed:', e.message));
    }
  } catch (e) { console.error('[jobpilot] scheduler error:', e.message); }
}, 60000);

server.listen(PORT, () => {
  console.log(`JobPilot running at http://localhost:${PORT}`);
});
