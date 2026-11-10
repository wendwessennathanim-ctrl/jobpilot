'use strict';
/*
 * Document generation — cover letters, tailored resumes, and draft answers
 * to screening questions found in a posting.
 *
 * Default engine: deterministic templates built from YOUR profile and the
 * matched skills in the posting. Free, offline, no key, no surprises.
 *
 * Optional AI upgrade: set ONE of these env vars with a free-tier key and
 * generation is rewritten by the model (templates remain the fallback if
 * the call fails):
 *   GROQ_API_KEY    — groq.com free tier, model llama-3.3-70b-versatile
 *   GEMINI_API_KEY  — Google AI Studio free tier, model gemini-2.0-flash
 *
 * Everything produced here is a DRAFT for you to review and submit yourself.
 * JobPilot never submits applications: job boards ban automated submission
 * in their Terms, gate it behind CAPTCHAs/logins, and your standing rule is
 * that applications go out under your own hand after your review.
 */

function matchedSkills(profile, job) {
  const body = `${job.title} ${job.description} ${(job.tags || []).join(' ')}`.toLowerCase();
  return (profile.skills || []).filter((s) => s && body.includes(String(s).toLowerCase()));
}

function firstName(full) { return String(full || 'I').split(/\s+/)[0]; }

/* ------------------------- screening questions ------------------------- */

function extractQuestions(job) {
  const text = String(job.description || '');
  const found = new Set();
  // Sentences / lines ending in a question mark.
  for (const m of text.matchAll(/[^.\n!?]{10,220}\?/g)) {
    const q = m[0].replace(/\s+/g, ' ').trim();
    if (q.length >= 12) found.add(q);
  }
  // Common application-question phrasings even without a "?".
  const patterns = [
    /please (describe|explain|share|tell us)[^.\n]{5,180}/gi,
    /why (do you want|are you interested)[^.\n?]{5,160}\??/gi,
    /tell us about (a time|yourself|your experience)[^.\n]{0,160}/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(m[0].replace(/\s+/g, ' ').trim());
  }
  return [...found].slice(0, 6);
}

function draftAnswer(question, profile, job, skills) {
  const prefs = profile.prefs || {};
  const q = question.toLowerCase();
  const skillList = (skills.length ? skills : (profile.skills || []).slice(0, 4)).join(', ');
  const name = profile.name || 'the candidate';

  if (/when can you start|availability|available to start|start date/.test(q)) {
    return prefs.availability || 'I am available to start immediately and can confirm exact dates on request.';
  }
  if (/authorized|legally|eligible to work|work permit|visa/.test(q)) {
    return 'I am legally authorized to work in Canada for this employer on my current study/work authorization, and I can provide documentation on request. [Review before submitting — make sure this matches your permit conditions for this role.]';
  }
  if (/salary|compensation|pay expectation|rate/.test(q)) {
    return 'My expectations are in line with the range posted for this role, and I am happy to discuss specifics once we have talked about the scope of the position.';
  }
  if (/why (do you want|are you interested)|why (this|our) (company|role|position)/.test(q)) {
    return `I am interested in ${job.title} at ${job.company} because it sits right at the centre of what I am building toward: ${skillList}. ${profile.headline || ''} This role would let me apply that in a real team setting, and the work described in the posting is exactly the kind of work I want to be doing.`;
  }
  if (/experience with|describe your experience|tell us about your experience/.test(q)) {
    return `My experience covers ${skillList}. In my current work and studies I use these day to day — most recently in a Computer Engineering Technology – Computing Science program at Algonquin College (GPA 3.77, Dean's Honours List) and in projects including a self-healing CI/CD pipeline (GitHub Actions, n8n, OpenAI API) that diagnoses failed builds and proposes fixes, plus a Linux user-management automation script that cut manual administration time by ~80%. I can walk through concrete examples in an interview.`;
  }
  if (/strength|greatest achievement|proud/.test(q)) {
    return 'My strength is picking up new systems fast and being measured on outcomes. Alongside a 3.77 GPA in a demanding engineering-technology program, I built a self-healing CI/CD pipeline that uses an LLM to diagnose failed builds and open pull requests with proposed fixes — I plan, test, look at the results, and iterate.';
  }
  return `DRAFT — personalize before submitting: I bring ${skillList} and a background that combines hands-on technical study (CET-CS at Algonquin College, GPA 3.77, Dean's Honours) with hands-on project work in CI/CD automation, Linux administration, and full-stack development. I would welcome the chance to discuss how that fits ${job.company}'s needs for this ${job.title} role. — ${name}`;
}

/* ------------------------------ documents ------------------------------ */

function coverLetter(profile, job) {
  const skills = matchedSkills(profile, job);
  const skillLine = (skills.length ? skills : (profile.skills || []).slice(0, 5)).join(', ');
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${profile.name || 'Your Name'}
${profile.headline || ''}

${today}

Hiring Team
${job.company}

Re: Application for ${job.title}

Dear Hiring Team,

I am applying for the ${job.title} position at ${job.company}. ${profile.headline || 'My background combines technical study with client-facing results work.'} The posting's focus on ${skillLine} matches the skills I use every week, and I would bring that combination to your team from day one.

Two things set up my fit for this role:

1. Technical foundation. I am a Computer Engineering Technology – Computing Science student at Algonquin College with a 3.77 cumulative GPA and Dean's Honours List standing. My coursework and projects cover ${skillLine} in real, graded, hands-on work — not just tutorials.

2. Automation projects with measurable results. I am building a self-healing CI/CD pipeline with GitHub Actions that detects failed builds, uses an LLM to analyze error logs, and opens pull requests with proposed fixes; an earlier Linux user-management script cut manual administration time by about 80%. That work has made me disciplined about testing, reading logs and data, and reporting clearly — habits that transfer directly to this role.

${(profile.prefs && profile.prefs.availability) || ''}

I would welcome an interview to walk through my work in more detail. Thank you for your consideration.

Sincerely,
${profile.name || 'Your Name'}

---
Draft generated by JobPilot from your profile — review, personalize the
middle paragraph with one concrete example, then submit it yourself.
Posting: ${job.url}`;
}

function tailoredResume(profile, job) {
  const skills = matchedSkills(profile, job);
  const base = profile.resume_text || '(Paste your general resume in Settings → Profile. JobPilot will tailor it per posting.)';
  return `TARGETED RESUME — ${job.title} @ ${job.company}
Generated by JobPilot. Send the version below (or merge the highlights into your own file).

== TARGETED HIGHLIGHTS FOR THIS POSTING ==
${(skills.length ? skills : ['(no direct skill overlap detected — review manually)']).map((s) => `• ${s} — as used in my Algonquin CET-CS coursework and automation/full-stack projects`).join('\n')}
• Posting keywords mirrored for ATS: ${[...new Set([job.title, ...(job.tags || [])])].join(', ')}

== YOUR GENERAL RESUME ==
${base}`;
}

function answersDoc(profile, job) {
  const questions = extractQuestions(job);
  const skills = matchedSkills(profile, job);
  if (!questions.length) {
    return `No screening questions were detected in this posting's text.\n\nNote: many employers add questions inside their application portal (Workday, Lever, Greenhouse) that never appear in the posting. Open the application link and check before you submit:\n${job.url}`;
  }
  return questions.map((q, i) => `Q${i + 1}. ${q}\nDRAFT ANSWER: ${draftAnswer(q, profile, job, skills)}\n`).join('\n') +
    '\n---\nDrafts generated from your profile. Check every fact against your real situation (work authorization, dates, salary) before submitting.';
}

/* --------------------------- optional LLM ------------------------------ */

async function llmRewrite(kind, draft, profile, job) {
  const prompt = `Rewrite this ${kind} draft to sound natural and specific, keeping every fact truthful and adding NO claims, employers, metrics or credentials that are not in the draft or the candidate profile. Keep it concise.\n\nCandidate: ${profile.name}. ${profile.headline}\nRole: ${job.title} at ${job.company}.\n\nDRAFT:\n${draft}`;
  try {
    if (process.env.GROQ_API_KEY) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.5 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
      const data = await res.json();
      return data.choices[0].message.content || draft;
    }
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json();
      return data.candidates[0].content.parts.map((p) => p.text).join('') || draft;
    }
  } catch (e) {
    return draft; // fallback: template version
  }
  return draft;
}

async function generateAll(profile, job) {
  const [cover, resume, answers] = await Promise.all([
    llmRewrite('cover letter', coverLetter(profile, job), profile, job),
    Promise.resolve(tailoredResume(profile, job)),
    llmRewrite('screening-answer set', answersDoc(profile, job), profile, job),
  ]);
  return { cover_letter: cover, resume, answers };
}

module.exports = { generateAll, extractQuestions, matchedSkills };
