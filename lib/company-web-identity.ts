/**
 * lib/company-web-identity.ts: an employer's own website and logo, found
 * from what the board already holds (indexing audit GFJ-08).
 *
 * The job page passes Company.website and Company.logoUrl into the JobPosting
 * hiringOrganization (sameAs and logo), but the Company rows behind the live
 * jobs had neither, and nothing filled them: every aggregated listing
 * emitted hiringOrganization with a name only. sameAs is how Google matches
 * the employer entity and clusters a listing with the employer's own copy;
 * the logo renders beside the listing in Google's job experience.
 *
 * WHERE A WEBSITE COMES FROM, most trusted first:
 *   1. an apply link on the employer's own domain (careers.example.org);
 *   2. a link or an e-mail address in the employer's own job descriptions
 *      ("visit www.example.com", "recruiting@example.org").
 * A domain counts only when its registrable label carries the employer's
 * name (lifestance.com for LifeStance Health): ATS and job-board hosts
 * (Greenhouse, Workday, Lever and the rest) are never an employer website,
 * and a domain that names someone else (a payer, a partner) is ignored.
 *
 * WHERE A LOGO COMES FROM: the employer's own homepage, read only by the
 * owner-run script with --fetch: its JSON-LD Organization logo, else an
 * apple-touch-icon or a declared icon of at least 112 pixels (Google's
 * minimum for a JobPosting logo). A favicon smaller than that is not used.
 *
 * Pure: no database, no network. scripts/indexing-fixes/
 * populate-company-website-logo.ts does the reads and the guarded writes.
 */

/** Hosts that belong to an ATS, a job board or a link service, never an employer. */
const NON_EMPLOYER_HOST_RE =
  /(?:^|\.)(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|smartrecruiters\.com|bamboohr\.com|workable\.com|ashbyhq\.com|applytojob\.com|jazzhr\.com|icims\.com|jobvite\.com|taleo\.net|oraclecloud\.com|successfactors\.(?:com|eu)|ultipro\.com|ukg\.com|paylocity\.com|paycomonline\.net|adp\.com|dayforcehcm\.com|breezy\.hr|recruitee\.com|rippling\.com|rippling-ats\.com|teamtailor\.com|pinpointhq\.com|hirebridge\.com|hrmdirect\.com|isolvedhire\.com|careerplug\.com|clearcompany\.com|indeed\.com|linkedin\.com|ziprecruiter\.com|glassdoor\.com|monster\.com|simplyhired\.com|careerbuilder\.com|dice\.com|usajobs\.gov|healthecareers\.com|doccafe\.com|practicelink\.com|google\.com|goo\.gl|bit\.ly|tinyurl\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|eeoc\.gov|dol\.gov|e-verify\.gov|uscis\.gov|w3\.org|schema\.org)$/i;

/** Second-level labels that sit under a country code ("example.com.au"). */
const COUNTRY_SECOND_LEVELS: ReadonlySet<string> = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/** Words that say nothing about which employer a name is. */
const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  'the', 'of', 'and', 'for', 'at', 'a', 'an', 'inc', 'llc', 'pllc', 'pc', 'pa', 'corp', 'corporation', 'co', 'company',
  'group', 'health', 'healthcare', 'medical', 'medicine', 'center', 'centers', 'centre', 'clinic', 'clinics', 'care',
  'services', 'service', 'system', 'systems', 'hospital', 'hospitals', 'associates', 'partners', 'network', 'national',
  'american', 'us', 'usa', 'behavioral', 'mental', 'wellness', 'practice', 'physicians', 'specialists',
]);

/** Shortest distinctive name token a domain may match on its own. */
const MIN_TOKEN_MATCH_LENGTH = 5;

/** Google's minimum logo size for a JobPosting hiringOrganization logo. */
export const MIN_LOGO_PIXELS = 112;

export type WebsiteEvidence = 'apply_link' | 'description_link' | 'description_email';

export interface WebsiteCandidate {
  /** The normalized site origin, "https://www.example.com". */
  website: string;
  /** The registrable domain it was read from, "example.com". */
  domain: string;
  evidence: WebsiteEvidence;
  /** The text the domain came from, for the dry-run printout. */
  source: string;
}

/** The registrable domain of a host: "careers.example.org" → "example.org". */
export function registrableDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9-]+$/.test(l))) return null;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  if (tld.length === 2 && COUNTRY_SECOND_LEVELS.has(second) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

/** True for an ATS, job board, social network, link shortener or government notice host. */
export function isNonEmployerHost(host: string): boolean {
  return NON_EMPLOYER_HOST_RE.test(host.toLowerCase());
}

/** The distinctive words of an employer name, lower case, generic words dropped. */
export function employerNameTokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !GENERIC_NAME_WORDS.has(t));
}

/**
 * True when a domain's registrable label names the employer. Any one of:
 *   - every word of the name run together ("solmentalhealth" for Sol Mental
 *     Health, whose one distinctive word is too short to trust alone);
 *   - the distinctive words run together ("lifestance" for LifeStance
 *     Health, "medelite" for MedElite);
 *   - one distinctive word of MIN_TOKEN_MATCH_LENGTH or more letters
 *     ("davita" for DaVita Kidney Care).
 */
export function domainNamesEmployer(domain: string, employerName: string): boolean {
  const label = domain.split('.')[0].replace(/-/g, '');
  const tokens = employerNameTokens(employerName);
  if (tokens.length === 0 || !label) return false;
  const everyWord = compactName(employerName);
  if (everyWord.length >= 3 && label.includes(everyWord)) return true;
  const distinctive = tokens.join('');
  if (distinctive.length >= MIN_TOKEN_MATCH_LENGTH && label.includes(distinctive)) return true;
  // Whole words as written, before the CamelCase split ("DaVita" → "davita").
  const words = employerName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !GENERIC_NAME_WORDS.has(w));
  return [...tokens, ...words].some((t) => t.length >= MIN_TOKEN_MATCH_LENGTH && label.includes(t));
}

/** Every word of the name run together, generic words kept ("solmentalhealth"). */
function compactName(employerName: string): string {
  return employerName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

/** "https://{host}" for a URL string, or null when it is not an http(s) URL. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

/** The site origin for a domain found under `host`: keep a www host, else the bare domain. */
function siteFor(host: string, domain: string): string {
  return host.toLowerCase().startsWith('www.') && registrableDomain(host.slice(4)) === domain
    ? `https://www.${domain}`
    : `https://${domain}`;
}

const DESCRIPTION_URL_RE = /\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)"'<>]*)?/gi;
const DESCRIPTION_EMAIL_RE = /\b[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;

/**
 * Website candidates for one employer from its live jobs: apply links first,
 * then description links, then description e-mail domains. Only domains that
 * name the employer and are not ATS or job-board hosts count; each domain
 * appears once, at its most trusted evidence.
 */
export function websiteCandidates(
  employerName: string,
  jobs: ReadonlyArray<{ applyLink: string | null; description: string | null }>,
): WebsiteCandidate[] {
  const out: WebsiteCandidate[] = [];
  const seen = new Set<string>();
  const consider = (host: string | null, evidence: WebsiteEvidence, source: string): void => {
    if (!host || isNonEmployerHost(host)) return;
    const domain = registrableDomain(host);
    if (!domain || seen.has(domain) || isNonEmployerHost(domain) || !domainNamesEmployer(domain, employerName)) return;
    seen.add(domain);
    out.push({ website: siteFor(host, domain), domain, evidence, source });
  };
  for (const job of jobs) if (job.applyLink) consider(hostOf(job.applyLink), 'apply_link', job.applyLink);
  for (const job of jobs) {
    const text = job.description ?? '';
    for (const m of text.matchAll(DESCRIPTION_URL_RE)) {
      const raw = m[0].replace(/[.,;:]+$/, '');
      consider(hostOf(raw.startsWith('http') ? raw : `https://${raw}`), 'description_link', raw);
    }
  }
  for (const job of jobs) {
    const text = job.description ?? '';
    for (const m of text.matchAll(DESCRIPTION_EMAIL_RE)) consider(m[1], 'description_email', m[0]);
  }
  return out;
}

/* ─── Homepage metadata (read by the script's --fetch pass) ──────────────── */

export interface HomepageFacts {
  /** The page's own name for itself: og:site_name, else <title>. */
  siteName: string | null;
  /** The best logo URL the page declares, absolute, or null. */
  logoUrl: string | null;
  logoSource: 'json_ld' | 'apple_touch_icon' | 'icon' | null;
}

function absolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
}

function jsonLdLogo(html: string, base: string): string | null {
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes: unknown[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        nodes.push(v);
        const graph = (v as { '@graph'?: unknown })['@graph'];
        if (graph) walk(graph);
      }
    };
    walk(data);
    for (const node of nodes) {
      const n = node as { '@type'?: unknown; logo?: unknown };
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (!types.some((t) => typeof t === 'string' && /Organization|Hospital|MedicalOrganization|MedicalClinic|Corporation|LocalBusiness/.test(t))) continue;
      const logo = typeof n.logo === 'string' ? n.logo : (n.logo as { url?: unknown } | undefined)?.url;
      if (typeof logo === 'string' && logo.trim()) return absolute(logo.trim(), base);
    }
  }
  return null;
}

/** Largest declared size of an icon link ("192x192" → 192), 0 when none. */
function iconSize(tag: string): number {
  const sizes = attr(tag, 'sizes') ?? '';
  return Math.max(0, ...sizes.split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
}

/**
 * The employer homepage's name and best logo. The JSON-LD Organization logo
 * wins; else an apple-touch-icon (180 pixels by convention); else the
 * largest declared icon of at least MIN_LOGO_PIXELS. SVG icons are skipped
 * (Google's logo guidelines ask for a raster image).
 */
export function parseHomepageFacts(html: string, pageUrl: string): HomepageFacts {
  const ogSite = html.match(/<meta[^>]+property\s*=\s*["']og:site_name["'][^>]*>/i)?.[0];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const siteName = (ogSite ? attr(ogSite, 'content') : null) || (title ? title.replace(/\s+/g, ' ').trim() : null) || null;

  const fromJsonLd = jsonLdLogo(html, pageUrl);
  if (fromJsonLd) return { siteName, logoUrl: fromJsonLd, logoSource: 'json_ld' };

  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const raster = (tag: string): boolean => !/\.svg(?:$|\?)/i.test(attr(tag, 'href') ?? '') && !/svg/i.test(attr(tag, 'type') ?? '');
  const apple = links.find((tag) => /\brel\s*=\s*["'][^"']*apple-touch-icon/i.test(tag) && raster(tag));
  if (apple) {
    const href = attr(apple, 'href');
    const url = href ? absolute(href, pageUrl) : null;
    if (url) return { siteName, logoUrl: url, logoSource: 'apple_touch_icon' };
  }
  const icons = links
    .filter((tag) => /\brel\s*=\s*["'][^"']*\bicon\b/i.test(tag) && raster(tag) && iconSize(tag) >= MIN_LOGO_PIXELS)
    .sort((a, b) => iconSize(b) - iconSize(a));
  const href = icons[0] ? attr(icons[0], 'href') : null;
  const url = href ? absolute(href, pageUrl) : null;
  return url ? { siteName, logoUrl: url, logoSource: 'icon' } : { siteName, logoUrl: null, logoSource: null };
}

/**
 * True when a fetched homepage is the employer's: its site name carries a
 * distinctive word of the employer name, or every word of it run together.
 */
export function homepageNamesEmployer(siteName: string | null, employerName: string): boolean {
  if (!siteName) return false;
  const site = siteName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (site.includes(compactName(employerName))) return true;
  return employerNameTokens(employerName).some((t) => t.length >= 4 && site.includes(t));
}
