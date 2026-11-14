// Maps a user question to official UNITEN pages (www.uniten.edu.my) that Gemini may read through
// its "URL context" tool. The tool only fetches URLs present in the request, so this table is the
// hard limit on what the bot can look up online: it never browses or searches anywhere else.

import { PROGRAMME_PATHS } from './programmes.js';

const BASE = 'https://www.uniten.edu.my/';

// `listing` routes only point at generic programme listings; they are skipped when a specific
// programme page was matched.
const ROUTES: { pattern: RegExp; pages: string[]; listing?: boolean; generic?: boolean }[] = [
  {
    pattern: /\b(admission|admissions|apply|applying|application|enrol|enroll|enrolment|enrollment|register|registration|entry|requirements?|eligib\w*|intake|intakes|offer letter|sign ?up)\b/i,
    pages: ['admission/', 'apply-now/']
  },
  {
    pattern: /\b(fees?|tuition|cost|costs|scholarships?|loans?|ptptn|financial|bursary|payment|pay|afford\w*)\b/i,
    pages: ['financial-assistance/', 'admission/']
  },
  // Level-specific listings (full lists of what is offered at that level)
  { pattern: /\b(bachelors?|undergraduate|undergrad|degrees?)\b/i, pages: ['programme/undergraduate/'], listing: true },
  { pattern: /\b(diploma)\b/i, pages: ['programme/diploma/'], listing: true },
  { pattern: /\b(foundation|pre-?university|matriculation)\b/i, pages: ['programme/foundation/'], listing: true },
  { pattern: /\b(postgraduate|post-?grad|masters?|phd|doctorate|doctoral)\b/i, pages: ['programme/postgraduate/'], listing: true },
  {
    pattern: /\b(engineering|mechanical|electrical|civil|electronics?|power|energy)\b/i,
    pages: ['college-of-engineering/programmes/'], listing: true
  },
  {
    pattern: /\b(computer|computing|computer science|it|ai|artificial intelligence|cyber ?security|software|data science|informatics|network\w*|information technology)\b/i,
    pages: ['college-of-computing-informatics/programmes/'], listing: true
  },
  // Generic "what programmes/courses are there?" (no level named): every level's listing page.
  // Skipped when a level-specific listing above already matched.
  {
    pattern: /\b(programmes?|courses?|degrees?|major|majors|study|studies|faculty|faculties|colleges?)\b/i,
    pages: ['programme/undergraduate/', 'programme/diploma/', 'programme/foundation/', 'programme/postgraduate/'],
    listing: true,
    generic: true
  },
  {
    pattern: /\b(accommodation|hostel|dorm\w*|residential|residence|college rooms?|stay)\b/i,
    pages: ['campus-life/putrajaya-campus/accommodation/']
  },
  {
    pattern: /\b(facilit\w*|library|sports?|gym|cafe\w*|canteen|club|clubs|societ\w*|student life|campus life)\b/i,
    pages: ['campus-life/putrajaya-campus/facilities/', 'campus-life/putrajaya-campus/']
  },
  {
    pattern: /\b(campus|campuses|located|location|where|address|directions?|putrajaya|kajang|muadzam|pahang|kshas)\b/i,
    pages: ['campus-life/putrajaya-campus/', 'campus-life/sultan-haji-ahmad-shah-campus/']
  },
  { pattern: /\b(contact|phone|call|email|e-mail|hotline|reach)\b/i, pages: ['about/contact-us/'] },
  {
    pattern: /\b(calendar|semester|semesters|trimester|term dates?|academic dates?|holidays?|schedule)\b/i,
    pages: ['campus-life/academic-calendar/']
  },
  { pattern: /\b(international|foreign|overseas|visa|exchange)\b/i, pages: ['international-office/'] },
  { pattern: /\b(news|events?|latest|announcements?|award|awards|recognition)\b/i, pages: ['news-events/'] },
  { pattern: /\b(about|history|vision|mission|founded|established|rankings?|accolades?)\b/i, pages: ['about/'] }
];

// ---- Specific programme matching -------------------------------------------------------------

const GENERIC = new Set(['bachelor', 'of', 'in', 'and', 'honours', 'hons', 'by', 'coursework', 'research', 'project',
  'master', 'doctor', 'philosophy', 'diploma', 'foundation', 'open', 'distance', 'learning']);

const norm = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const tokensOf = (text: string) => text.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(norm);

const PROGRAMMES = PROGRAMME_PATHS.map((path) => ({
  path,
  level: path.split('/')[1],
  tokens: new Set(tokensOf(path.split('/')[2].replace(/-/g, ' ')).filter((t) => !GENERIC.has(t)))
}));

// Short forms students use -> words that appear in programme names
const ALIASES: [RegExp, string][] = [
  [/\bai\b/gi, 'artificial intelligence'],
  [/\bcyber ?security\b/gi, 'cyber security'],
  [/\bict\b/gi, 'information and communication technology'],
  [/\bhr\b/gi, 'human resource'],
  [/\bfintech\b/gi, 'financial technology'],
  [/\bmba\b/gi, 'master business administration'],
  [/\bm\.?sc\b/gi, 'master science'],
  [/\bsoftware eng\b/gi, 'software engineering'],
  [/\bcompsci\b|\bcs\b/gi, 'computer science']
];

function levelOf(q: string): string | null {
  if (/\bdiploma\b/i.test(q)) return 'diploma';
  if (/\bfoundation\b/i.test(q)) return 'foundation';
  if (/\b(master|masters|msc|mba|phd|doctorate|doctoral|postgraduate|postgrad)\b/i.test(q)) return 'postgraduate';
  return null;
}

/** Programme page(s) whose name best matches the question (empty when unclear or too many ties). */
function programmePagesFor(question: string, context = '', max = 3): string[] {
  let q = question;
  for (const [re, to] of ALIASES) q = q.replace(re, to);
  const words = new Set(tokensOf(q));
  // Level: what the question says, else SPM/UEC mentioned earlier (entry level is diploma or
  // foundation), else undergraduate.
  const stated = levelOf(question);
  const levels = stated ? [stated] : SPM_LEVEL.test(`${context}\n${question}`) ? ['diploma', 'foundation'] : ['undergraduate'];

  const rank = (pool: typeof PROGRAMMES) => {
    const scored = pool.map((p) => ({ p, score: [...p.tokens].filter((t) => words.has(t)).length }));
    const best = Math.max(0, ...scored.map((s) => s.score));
    return best === 0 ? [] : scored.filter((s) => s.score === best).map((s) => s.p);
  };

  // Prefer the stated level (default: undergraduate), otherwise look across every level.
  let hits = rank(PROGRAMMES.filter((p) => levels.includes(p.level)));
  if (!hits.length) hits = rank(PROGRAMMES);
  return hits.length && hits.length <= max ? hits.map((p) => BASE + p.path) : [];
}

// ---- "What can I apply for?" questions -------------------------------------------------------
// Needs the requirements of many programmes, so it reads every programme page at the relevant
// level, but only once the student has actually given qualification details (otherwise the bot
// should ask first, and we avoid loading dozens of pages for nothing).

const ELIGIBILITY_INTENT =
  /\b(eligible|eligibility|qualif\w*|can i (apply|take|study|join|enter|get in)|which (course|programme|degree|diploma|foundation)s?|what (course|programme|degree|diploma|foundation)s?)\b/i;
const SPM_LEVEL = /\b(spm|uec|o-?levels?|igcse|gcse)\b/i;
const POST_SPM_LEVEL = /\b(stpm|matric\w*|a-?levels?|sace|ausmat|foundation|diploma)\b/i;
const HAS_GRADE_DETAILS = /\d|\b(credits?|passes|pass|grades?|straight ?a)\b/i;

function eligibilityPagesFor(text: string): string[] {
  if (!ELIGIBILITY_INTENT.test(text) || !HAS_GRADE_DETAILS.test(text)) return [];
  const levels = SPM_LEVEL.test(text) ? ['diploma', 'foundation'] : POST_SPM_LEVEL.test(text) ? ['undergraduate'] : [];
  return PROGRAMMES.filter((p) => levels.includes(p.level)).map((p) => BASE + p.path);
}

/**
 * Up to `max` official page URLs relevant to the conversation (empty when nothing matches).
 * `question` is the current message; `context` is recent earlier user messages, so short
 * follow-ups ("I got 5 credits, I like computers") still resolve to the right pages.
 */
export function pagesFor(question: string, context = '', max = 4): string[] {
  const eligibility = eligibilityPagesFor(`${context}\n${question}`);
  if (eligibility.length) return eligibility;

  // A follow-up that matches nothing on its own falls back to the earlier messages.
  const own = topicPagesFor(question, max, context);
  return own.length || !context ? own : topicPagesFor(`${context}\n${question}`, max, context);
}

function topicPagesFor(question: string, max: number, context = ''): string[] {
  const specific = programmePagesFor(question, context);
  const out: string[] = [...specific];
  const hasLevelListing = () => out.some((u) => /\/programme\/(undergraduate|diploma|foundation|postgraduate)\/$/.test(u));
  for (const { pattern, pages, listing, generic } of ROUTES) {
    if (!pattern.test(question)) continue;
    if (listing && specific.length) continue;
    if (generic && hasLevelListing()) continue;
    for (const p of pages) {
      const url = BASE + p;
      if (!out.includes(url)) out.push(url);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
