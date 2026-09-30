/**
 * Pure planner for scripts/indexing-fixes/populate-company-website-logo.ts
 * (indexing audit GFJ-08): which empty Company.website and Company.logoUrl
 * values can be filled, from what, without guessing.
 *
 *   website  from an apply link on the employer's own domain (its career
 *            site), else a link or e-mail domain in its own job
 *            descriptions, and only when the domain names the employer; ATS
 *            and job-board hosts never count (lib/company-web-identity.ts).
 *            When the homepage was read (--fetch) it must be on that domain
 *            and name the employer, or the website is not used.
 *   logo     only from the employer's own homepage (--fetch): its JSON-LD
 *            Organization logo, else an apple-touch-icon, else a declared
 *            icon of at least 112 pixels.
 * A stored value is never replaced. No database, no network: the script
 * does the reads and passes the homepage it fetched, if any.
 */
import {
  homepageNamesEmployer,
  registrableDomain,
  websiteCandidates,
  type HomepageFacts,
} from '@/lib/company-web-identity';

export interface CompanyWebRow {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  jobs: ReadonlyArray<{ applyLink: string | null; description: string | null }>;
}

/** What the script read from the homepage, or null when it did not or could not. */
export interface FetchedHomepage {
  finalUrl: string;
  facts: HomepageFacts;
}

export interface CompanyWebPlan {
  /** The website to write, or null (unknown, or already stored). */
  website: string | null;
  /** The logo to write, or null (unknown, or already stored). */
  logoUrl: string | null;
  /** Why, for the dry-run printout. */
  notes: string[];
}

/** The site the script should read with --fetch: the stored website, else the best candidate. */
export function siteToRead(company: CompanyWebRow): string | null {
  if (company.website) return company.website;
  return websiteCandidates(company.name, company.jobs)[0]?.website ?? null;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The fill for one company. `page` is the homepage the script fetched from
 * siteToRead(company), `null` when the fetch failed, or `undefined` when the
 * run did not fetch (no --fetch).
 */
export function planCompanyWebIdentity(company: CompanyWebRow, page: FetchedHomepage | null | undefined): CompanyWebPlan {
  const notes: string[] = [];
  const candidate = company.website ? null : websiteCandidates(company.name, company.jobs)[0] ?? null;
  if (candidate) notes.push(`website from ${candidate.evidence}: ${candidate.source}`);

  if (page === undefined) {
    if (candidate && !company.logoUrl) notes.push('logo needs --fetch (read from the homepage)');
    return { website: candidate?.website ?? null, logoUrl: null, notes };
  }

  const site = siteToRead(company);
  if (!site) return { website: null, logoUrl: null, notes };
  if (page === null) {
    notes.push(`homepage ${site} did not answer with HTML; nothing taken from it`);
    return { website: null, logoUrl: null, notes };
  }

  const pageHost = hostnameOf(page.finalUrl);
  const siteHost = hostnameOf(site);
  const sameSite = !!pageHost && !!siteHost && registrableDomain(pageHost) === registrableDomain(siteHost);
  const namesEmployer = homepageNamesEmployer(page.facts.siteName, company.name);
  if (!sameSite || (candidate && !namesEmployer)) {
    notes.push(`homepage "${page.facts.siteName ?? '(no title)'}" at ${page.finalUrl} is not the employer's own site; nothing taken from it`);
    return { website: null, logoUrl: null, notes };
  }

  const website = candidate?.website ?? null;
  let logoUrl: string | null = null;
  if (!company.logoUrl && page.facts.logoUrl) {
    logoUrl = page.facts.logoUrl;
    notes.push(`logo from the homepage ${page.facts.logoSource}`);
  }
  return { website, logoUrl, notes };
}
