'use strict';
/*
 * Scholarship matching — scores an award 0..100 against the student's
 * scholarship profile, with HARD eligibility gates first. A scholarship a
 * student cannot legally/actually receive is worse than useless (it wastes
 * an essay), so unlike job matching, clear ineligibility scores 0 with an
 * explanatory flag instead of a small penalty:
 *
 *   - Citizens/PR-only wording + an international-student profile  -> 0
 *   - Stated minimum GPA above the student's GPA                    -> 0
 *   - Deadline already passed                                       -> 0
 *   - Graduate-only (master's/PhD) wording for a diploma student    -> 0
 *
 * Everything else is positive evidence: home-school fit, international
 * eligibility stated outright, program fit, financial-need fit, amount,
 * deadline proximity, leadership/community fit with the student's
 * activities. Essay requirement is detected and flagged (never a penalty)
 * so the UI can offer one-click essay generation.
 */

const DEFAULT_SCHOLARSHIP = {
  gpa: null,                 // e.g. 3.77
  nationality: '',           // e.g. "Ethiopian"
  residency: 'international',// 'international' | 'citizen' | 'permanent-resident' | 'other'
  school: '',                // e.g. "Algonquin College"
  program: '',               // e.g. "Computer Engineering Technology – Computing Science"
  level: 'college diploma',  // free text: college diploma / bachelor's / etc.
  activities: '',            // leadership, clubs, volunteering, work
  financialNeed: false,
  feeds: [],
};

function schProfile(profile) {
  return { ...DEFAULT_SCHOLARSHIP, ...((profile && profile.prefs && profile.prefs.scholarship) || {}) };
}

const txt = (s) => String(s || '').toLowerCase();

function parseAmount(s) {
  const m = txt(s.amount_text).match(/\$\s?([\d,]+)/) || txt(s.description).match(/\$\s?([\d,]{3,})/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  return s.amount_value || null;
}

function parseDeadline(s) {
  const raw = s.deadline || '';
  let d = raw ? new Date(raw) : null;
  if (!d || isNaN(d.getTime())) {
    const m = txt(`${s.description} ${s.criteria_text}`).match(/(?:deadline|apply by|closes|due)[^.\n]{0,40}?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (m) { d = new Date(m[1]); }
  }
  return d && !isNaN(d.getTime()) ? d : null;
}

/** Required minimum GPA stated in the text (4.0 scale), or null. */
function requiredGpa(text) {
  let m = text.match(/(?:minimum|min\.?|at least)\s*(?:gpa|grade point average)\s*(?:of\s*)?(\d(?:\.\d{1,2})?)/);
  if (m) return parseFloat(m[1]);
  m = text.match(/(?:gpa|grade point average)\s*(?:of\s*)?(?:at least\s*)?(\d(?:\.\d{1,2})?)\s*(?:or (?:higher|above)|\+|minimum|required)/);
  if (m) return parseFloat(m[1]);
  m = text.match(/(\d{2,3})\s?%\s*(?:average|standing|minimum)/);
  if (m) return Math.round(((parseInt(m[1], 10) / 100) * 4) * 100) / 100;
  return null;
}

/** Essay detection + best-effort prompt extraction. */
function detectEssay(s) {
  const hay = `${s.title} ${s.description} ${s.criteria_text}`;
  const required = /\b(essay|personal statement|statement of (intent|purpose)|written (submission|response|statement)|letter of intent)\b/i.test(hay)
    && !/no (?:separate\s+|additional\s+)?(?:essay|personal statement)|without (?:an?\s+)?essay/i.test(hay);
  let prompt = null;
  if (required) {
    const m = hay.match(/(?:essay|statement|response)[^.\n]{0,60}?(?:on|about|describing|discussing|explaining)\s+([^.\n]{10,220})/i)
      || hay.match(/(?:describe|explain|discuss|tell us)[^.\n]{10,220}/i);
    if (m) prompt = (m[1] || m[0]).replace(/\s+/g, ' ').trim();
  }
  return { required, prompt };
}

function scoreScholarship(profile, s) {
  const sp = schProfile(profile);
  const text = txt(`${s.title} ${s.provider} ${s.description} ${s.criteria_text}`);
  const reasons = [];
  const flags = [];
  let score = 10; // base: it's a student award in the list at all
  reasons.push('Listed student award (+10)');

  const essay = detectEssay(s);
  if (essay.required) { flags.push('essay-required'); reasons.push('Essay/statement required — JobPilot can draft it'); }

  /* ---------------------------- hard gates ---------------------------- */
  const intlExcluded = /international students?[^.\n]{0,40}?(?:not eligible|ineligible|may not apply|not accepted|are excluded)/i.test(text);
  const intlOk = !intlExcluded && (/international students? (?:are )?(?:also )?(?:eligible|welcome|encouraged|may apply)|open to international|all nationalit|international students? (?:at|enrolled|studying)/i.test(text));
  const citizensOnly = /(?:canadian )?citizens?(?:\s*(?:&|and)\s*(?:permanent residents?|prs?))?\s*(?:and permanent residents?\s*)?only|must be a (?:canadian )?citizen|canadian citizenship (?:is )?required|permanent residents? only/i.test(text);
  if (sp.residency === 'international' && citizensOnly && !intlOk) {
    return { score: 0, reasons: ['Restricted to Canadian citizens / permanent residents — you are an international student'], flags: ['citizens-restricted'], essayRequired: essay.required };
  }
  if (intlOk) { score += 18; reasons.push('International students explicitly eligible (+18)'); }

  const req = requiredGpa(text);
  if (req && sp.gpa) {
    if (sp.gpa >= req) { score += 12; reasons.push(`Minimum GPA ${req} — yours is ${sp.gpa} (+12)`); }
    else return { score: 0, reasons: [`Requires GPA ${req} or higher — yours is ${sp.gpa}`], flags: ['gpa-below-minimum'], essayRequired: essay.required };
  }

  const deadline = parseDeadline(s);
  if (deadline) {
    const days = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
    if (days < 0) return { score: 0, reasons: [`Deadline passed (${deadline.toISOString().slice(0, 10)})`], flags: ['deadline-passed'], essayRequired: essay.required };
    if (days <= 30) { score += 10; flags.push('deadline-soon'); reasons.push(`Deadline in ${days} days (+10) — act soon`); }
    else if (days <= 90) { score += 5; reasons.push(`Deadline in ${days} days (+5)`); }
  }

  if (/\b(phd|doctoral|master'?s students? only|graduate students? only)\b/i.test(text) && !/undergraduate|college|diploma/i.test(text)) {
    return { score: 0, reasons: ['Graduate-level award (master\'s/PhD) — not open to diploma students'], flags: ['level-mismatch'], essayRequired: essay.required };
  }

  /* --------------------------- positive fit --------------------------- */
  if (sp.school && text.includes(txt(sp.school))) { score += 20; reasons.push(`At your school: ${sp.school} (+20)`); }
  else if (/university of|college of|polytechnic/i.test(text) && /(?:students?|applicants?) (?:at|of|from)/i.test(text)) {
    score -= 25; flags.push('maybe-other-school'); reasons.push('May be restricted to another institution (-25) — verify');
  }

  const progWords = ['computer', 'engineering', 'technology', 'computing', 'software', 'stem', 'science'];
  const progHit = progWords.some((w) => txt(sp.program).includes(w) && text.includes(w))
    || /school of advanced technology/i.test(text) && /technology/i.test(txt(sp.program));
  if (progHit) { score += 10; reasons.push('Program/field fit (+10)'); }

  if (/financial need|demonstrated need|need-based|bursar/i.test(text)) {
    if (sp.financialNeed) { score += 10; reasons.push('Need-based — matches your profile (+10)'); }
    else { score += 3; reasons.push('Need-based award (+3)'); }
    flags.push('need-based');
  }

  if (/leadership|community|volunteer|extracurricular/i.test(text) && sp.activities) {
    score += 6; reasons.push('Leadership/community criteria — your activities fit (+6)');
  }
  if (sp.nationality && text.includes(txt(sp.nationality))) { score += 8; reasons.push(`Mentions your nationality: ${sp.nationality} (+8)`); }
  if (/women in|female/i.test(text)) { flags.push('check-criteria'); reasons.push('Has a demographic criterion — verify it fits you'); }

  const amount = parseAmount(s);
  if (amount && amount >= 5000) { score += 8; reasons.push(`Amount $${amount.toLocaleString()} (+8)`); }
  else if (amount && amount >= 1000) { score += 5; reasons.push(`Amount $${amount.toLocaleString()} (+5)`); }
  else if (amount) { score += 2; reasons.push(`Amount $${amount.toLocaleString()} (+2)`); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons, flags, essayRequired: essay.required };
}

module.exports = { scoreScholarship, detectEssay, DEFAULT_SCHOLARSHIP, schProfile, parseDeadline, parseAmount };
