import { Job } from '@/lib/types';
import { slugify, canonicalSalaryPeriod, formatSalary, type SalaryPeriodKey } from '@/lib/utils';
import { brand } from '@/config/brand';
import {
  cleanRoleTitle,
  isEstimatedSalary,
  isStubJobDescription,
  isUsListing,
  isVerifiedFullyRemote,
  jobPostedAt,
  mapEmploymentTypes,
  resolveEmploymentTypes,
  resolveJobPlaces,
  resolveRemoteApplicantStates,
  resolveRequisitionId,
  stateNameForCode,
  type JobPlace,
} from '@/app/jobs/[slug]/job-posting-facts';
import { safeExternalHref } from '@/components/jobs/safe-external-href';
import { titleIndicatesNewGrad } from '@/lib/experience-label';

// The estimated-pay rule lives with the other page facts so the meta
// description reads it too; re-exported for existing importers.
export { isEstimatedSalary };

// Schema.org accepts: HOUR, DAY, WEEK, MONTH, YEAR. We share the canonical
// period key with formatSalary so the UI and schema never disagree on whether
// a posting is hourly vs annual.
const SCHEMA_UNIT_TEXT: Record<SalaryPeriodKey, 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'> = {
  hourly: 'HOUR',
  daily: 'DAY',
  weekly: 'WEEK',
  // Schema.org has no native 'biweekly'. We emit MONTH and CONVERT the value
  // (× 26 pay periods / 12 months) in buildJobPostingSchema — the previous
  // clamp-without-converting understated biweekly pay by ~2.17× (live-review
  // item 7-iii residual).
  biweekly: 'MONTH',
  monthly: 'MONTH',
  annual: 'YEAR',
  // 'unknown' cadence: the badge shows no figure, so buildBaseSalary emits
  // none. The entry only completes the map.
  unknown: 'YEAR',
};
// 26 biweekly pay periods per year spread over 12 months.
const BIWEEKLY_TO_MONTHLY = 26 / 12;

/**
 * The annual figure the page's pay badge shows for a stored annual bound.
 * formatSalary reads 20 to 999 as thousands ("125" shows as "$125k").
 */
function shownAnnual(raw: number): number {
  return raw >= 20 && raw < 1000 ? raw * 1000 : raw;
}

/**
 * The annual bound to emit, or 'mismatch' when the page would show a
 * different figure. The badge prints the stored bound rounded to $1k
 * (formatSalary); the markup prints the normalized bound. They must be the
 * same figure (CQ-02: the MedElite row showed "$30k" while the markup said
 * 48000), and a shown bound the normalizer withheld as implausible is not
 * stated either. A bound the page does not show is not emitted.
 */
function annualBoundForSchema(
  raw: number | null | undefined,
  normalized: number | null | undefined,
): number | undefined | 'mismatch' {
  if (raw == null || raw === 0) return undefined;
  if (normalized == null) return 'mismatch';
  return Math.round(normalized / 1000) === Math.round(shownAnnual(raw) / 1000) ? normalized : 'mismatch';
}

// ─── SOC / occupationalCategory gating (live-review item 7-i) ────────────────
//
// Codes verified live against the O*NET-SOC taxonomy (onetonline.org, family
// 29, fetched 2026-08-21):
//   29-1171.00  Nurse Practitioners
//   29-1151.00  Nurse Anesthetists (CRNA)
//   29-1161.00  Nurse Midwives (CNM)
//   29-1141.04  Clinical Nurse Specialists (O*NET specialty under 29-1141 RNs)
//   29-1071.00  Physician Assistants
//
// Previously every JobPosting hardcoded the NP code — including psychiatrist,
// podiatrist, and PA listings. Per Google's guidance a wrong occupational
// category is worse than none, so anything we cannot classify
// deterministically gets NO occupationalCategory at all.
const SOC_NP = '29-1171.00';
const SOC_CRNA = '29-1151.00';
const SOC_CNM = '29-1161.00';
const SOC_CNS = '29-1141.04';
const SOC_PA = '29-1071.00';

const TITLE_CRNA_RE = /\bcrna\b|\bnurse\s+anesthetist\b/i;
// 'CNM' alone is ambiguous — 'Clinical Nurse Manager – CNM' rows exist in the
// corpus (review item 1d). Require a midwifery token, or a bare CNM without
// manager context.
const TITLE_CNM_MIDWIFE_RE = /\bnurse[\s-]?midwi(?:fe|ves|fery)\b|\bmidwifery\b/i;
const TITLE_CNM_TOKEN_RE = /\bcnm\b/i;
const TITLE_MANAGER_CONTEXT_RE = /\bnurse\s+manager\b|\bcase\s+manager\b|\bclinical\s+nurse\s+manager\b/i;
const TITLE_CNS_RE = /\bclinical\s+nurse\s+specialist\b|\bcns\b/i;
const TITLE_NP_RE = /\bnurse\s+practitioners?\b|\b(?:pmhnp|fnp|agnp|agpcnp|agacnp|acnp|pnp|nnp|whnp|dnp)(?:-(?:c|bc))?\b|\bnp\b|\baprn\b/i;
const TITLE_PA_RE = /\bphysician\s+(?:assistant|associate)s?\b|\bpa-c\b/i;

// Persisted `professionClass` → SOC code. Keys MUST mirror the Prisma
// `ProfessionClass` enum exactly (prisma/schema.prisma / NON_NP + NP_ELIGIBLE
// sets in lib/profession-classifier.ts). An earlier draft gated on
// 'np'/'aprn_non_np'/'unknown' — values that do not exist in the enum — so
// every classified NP/CRNA/CNM/CNS row silently lost its SOC once the
// backfill stamped real classes. physician / other_clinical / nonclinical
// are intentionally absent: a classified non-NP row never gets a nursing or
// PA code, whatever its title looks like.
const SOC_BY_PROFESSION_CLASS: Readonly<Record<string, string>> = {
  np_eligible: SOC_NP,
  aprn_crna: SOC_CRNA,
  aprn_midwife: SOC_CNM,
  aprn_cns: SOC_CNS,
  pa_only: SOC_PA,
};

/**
 * Derive the O*NET-SOC occupationalCategory for a listing, or undefined when
 * it cannot be determined with confidence (omission beats a wrong code).
 *
 * Precedence: the persisted `professionClass` column (WP-1C, written by the
 * ingest classifier) is authoritative when present; a deterministic title
 * scan is the interim fallback for rows not yet classified.
 */
export function deriveOccupationalCategory(job: {
  title: string;
  professionClass?: string | null;
}): string | undefined {
  const title = job.title || '';
  const fromTitle = (): string | undefined => {
    if (TITLE_CRNA_RE.test(title)) return SOC_CRNA;
    if (
      TITLE_CNM_MIDWIFE_RE.test(title) ||
      (TITLE_CNM_TOKEN_RE.test(title) && !TITLE_MANAGER_CONTEXT_RE.test(title))
    ) {
      return SOC_CNM;
    }
    if (TITLE_CNS_RE.test(title)) return SOC_CNS;
    if (TITLE_NP_RE.test(title)) return SOC_NP;
    if (TITLE_PA_RE.test(title)) return SOC_PA;
    return undefined;
  };

  const professionClass = job.professionClass;
  if (professionClass) {
    // Classified rows: the enum value alone decides. Non-NP classes and any
    // unrecognized future value map to undefined — omission beats a wrong
    // code per Google's structured-data guidance.
    return SOC_BY_PROFESSION_CLASS[professionClass];
  }
  // NULL/absent = classifier has not stamped this row yet (pre-backfill) —
  // fall back to the deterministic title scan.
  return fromTitle();
}

/**
 * The job row plus what the page resolved about its employer. companyWebsite
 * and companyLogoUrl come from the employer's own posting (EmployerJob) or,
 * failing that, the matched Company row (GFJ-08); externalId carries the ATS
 * requisition id (GFJ-13).
 */
interface JobStructuredDataProps {
  job: Job & { professionClass?: string | null };
}

/**
 * Remove all keys with undefined values from an object (shallow + nested).
 */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * One schema.org Place per location. streetAddress is intentionally omitted:
 * listings carry no reliable street, and "City, ST" belongs in
 * addressLocality and addressRegion, never streetAddress.
 */
function toSchemaPlace(place: JobPlace): Record<string, unknown> {
  return {
    '@type': 'Place',
    address: stripUndefined({
      '@type': 'PostalAddress',
      addressLocality: place.locality ?? undefined,
      addressRegion: place.regionCode ?? undefined,
      addressCountry: 'US',
    }),
  };
}

/**
 * JobPosting.baseSalary, or undefined. The markup states exactly the pay the
 * page's badge shows (formatSalary(minSalary, maxSalary, salaryPeriod)), in
 * the same unit, and nothing else:
 *   - no badge, no baseSalary. That covers salaryPeriod 'unknown' (P9 #2a):
 *     the ingest validator refused to classify the cadence, the badge shows
 *     no figure, so the markup claims none either;
 *   - CQ-02: Google defines baseSalary as "the actual base salary for the
 *     job, as provided by the employer (not an estimate)". A row the ingest
 *     conflict check flagged, or whose source marked its range estimated,
 *     is omitted (isEstimatedSalary). A lower confidence above the conflict
 *     floor stays: it marks an employer-stated wide range or an hourly
 *     conversion, both real figures;
 *   - SEO Fix #3 / 7-iii: a non-annual period emits the stored figures in
 *     their native unit (HOUR, DAY, WEEK, MONTH), never the annualized
 *     normalized bounds, and biweekly converts to MONTH (x 26 / 12, rounded);
 *   - an annual period emits the normalized bound only when it is the figure
 *     the badge shows (annualBoundForSchema); otherwise nothing.
 */
function buildBaseSalary(job: JobStructuredDataProps['job']): Record<string, unknown> | undefined {
  if (!formatSalary(job.minSalary, job.maxSalary, job.salaryPeriod)) return undefined;
  if (isEstimatedSalary(job)) return undefined;
  const periodKey = canonicalSalaryPeriod(job.salaryPeriod);

  let min: number | undefined;
  let max: number | undefined;
  if (periodKey === 'annual') {
    const annualMin = annualBoundForSchema(job.minSalary, job.normalizedMinSalary);
    const annualMax = annualBoundForSchema(job.maxSalary, job.normalizedMaxSalary);
    if (annualMin === 'mismatch' || annualMax === 'mismatch') return undefined;
    min = annualMin;
    max = annualMax;
  } else {
    const toSchemaValue = (value: number | null | undefined): number | undefined => {
      if (value == null || value === 0) return undefined;
      return periodKey === 'biweekly' ? Math.round(value * BIWEEKLY_TO_MONTHLY) : value;
    };
    min = toSchemaValue(job.minSalary);
    max = toSchemaValue(job.maxSalary);
  }
  if (min === undefined && max === undefined) return undefined;

  return {
    '@type': 'MonetaryAmount',
    currency: 'USD',
    value: stripUndefined({
      '@type': 'QuantitativeValue',
      minValue: min,
      maxValue: max ?? min,
      unitText: SCHEMA_UNIT_TEXT[periodKey],
    }),
  };
}

/**
 * JobPosting.experienceRequirements, or undefined. minYearsExperience
 * becomes months (x 12); a new-grad-friendly posting with no stated minimum
 * requires no prior experience, which is monthsOfExperience 0. A title that
 * names a new-graduate program (residency, fellowship) shows the page's
 * "New grad welcome" chip whatever minimum the row holds
 * (effectiveExperienceLabel), so the markup says 0 months there too rather
 * than contradict the chip. GFJ-12: the former experienceInPlaceOfEducation:
 * true said the opposite ("experience accepted IN PLACE OF formal
 * education") and Google requires educationRequirements beside it, so it is
 * no longer emitted. With nothing known the block is omitted, so Google
 * never sees an empty container (lint-flagged in Rich Results Test).
 */
function buildExperienceRequirements(job: JobStructuredDataProps['job']): Record<string, unknown> | undefined {
  const requirement = (months: number): Record<string, unknown> => ({
    '@type': 'OccupationalExperienceRequirements',
    monthsOfExperience: months,
  });
  if (titleIndicatesNewGrad(job.title)) return requirement(0);
  if (typeof job.minYearsExperience === 'number' && job.minYearsExperience > 0) {
    return requirement(job.minYearsExperience * 12);
  }
  return job.newGradFriendly ? requirement(0) : undefined;
}

/**
 * Location semantics (Google JobPosting: jobLocation is required unless the
 * job is 100% remote, which uses jobLocationType TELECOMMUTE plus
 * applicantLocationRequirements):
 *   - verified fully remote (isVerifiedFullyRemote)  → TELECOMMUTE and the
 *     states the posting restricts applicants to, else Country USA (GFJ-07);
 *   - otherwise every physical place the job names   → jobLocation, a single
 *     Place or an array for multi-location jobs (CS-03, GFJ-02);
 *   - neither                                        → null: no JobPosting.
 * Hybrid is never TELECOMMUTE: it requires on-site presence.
 */
function buildLocationFields(job: JobStructuredDataProps['job']): Record<string, unknown> | null {
  if (isVerifiedFullyRemote(job)) {
    const states = resolveRemoteApplicantStates(job);
    return {
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: states.length > 0
        ? states.map((name) => ({ '@type': 'State', name: `${name}, USA` }))
        : { '@type': 'Country', name: 'USA' },
    };
  }
  const places = resolveJobPlaces(job);
  if (places.length === 0) return null;
  return { jobLocation: places.length === 1 ? toSchemaPlace(places[0]) : places.map(toSchemaPlace) };
}

/**
 * Build the JobPosting JSON-LD object for a job, or null when the job names
 * neither a physical place nor a verified remote arrangement (or is not a US
 * listing). Such an item would be invalid for Google's job experience
 * ("Missing field jobLocation"); the page keeps rendering and indexing, it
 * just carries no JobPosting until ingest resolves the location. Exported as
 * a pure function so the schema logic is unit-testable without React.
 */
export function buildJobPostingSchema(job: JobStructuredDataProps['job']): Record<string, unknown> | null {
  if (!isUsListing(job)) return null;
  // GFJ-04: a synthesized stub ("<role>, Remote TX ... / Employer: / Department:
  // / Location:") is not a complete job description; no JobPosting for it.
  // The page answers noindex, follow for the same rule (isJobPostingEligible).
  if (isStubJobDescription(job)) return null;
  const locationFields = buildLocationFields(job);
  if (!locationFields) return null;

  // GFJ-16: the employer's original posting date, the same value the page's
  // visible "Posted …" line reads (jobPostedAt).
  const datePosted = jobPostedAt(job);

  // GSC Fix: when expiresAt is null we used to emit `now + 30d` — recalculated
  // on every render, which made stale jobs look perpetually fresh to Google
  // ("validThrough always in future" is a quality-model red flag). Anchor the
  // fallback to datePosted instead so the value is deterministic per job and
  // old listings naturally roll out of Google Jobs after 60 days.
  // When expiresAt IS set, we respect the employer's stated expiry as-is.
  const sixtyDaysAfterPost = new Date(datePosted);
  sixtyDaysAfterPost.setDate(sixtyDaysAfterPost.getDate() + 60);

  const validThrough = job.expiresAt
    ? (job.expiresAt instanceof Date ? job.expiresAt : new Date(job.expiresAt))
    : sixtyDaysAfterPost;

  // GSC Fix: Guard against empty/whitespace description — fallback chain
  const regionName = stateNameForCode(job.stateCode) ?? job.state;
  const description = (job.description && job.description.trim())
    || (job.descriptionSummary && job.descriptionSummary.trim())
    || `${cleanRoleTitle(job.title, job)} position at ${job.employer}${job.city && regionName ? ` in ${job.city}, ${regionName}` : ''}`;

  // SEO Fix #2: schema URL must match the canonical resolver. Live route reads
  // the trailing UUID and renders any prefix, but Google penalizes URL/canonical
  // mismatches. The DB-stored job.slug can drift from current slugify() output
  // when titles contain '/', '&', or other punctuation — generate the slug from
  // the same source the page uses so schema URL == <link rel=canonical>.
  const canonicalSlug = job.slug || slugify(job.title, job.id);
  const canonicalUrl = `${brand.baseUrl}/jobs/${canonicalSlug}`;

  const baseSalary = buildBaseSalary(job);

  const experienceRequirements = buildExperienceRequirements(job);

  // GFJ-13: identifier is "the hiring organization's unique identifier for
  // the job". The employer's ATS requisition id when the source provides
  // one; never this site's UUID, which says nothing to Google.
  const requisitionId = resolveRequisitionId(job.externalId);

  const structuredData = stripUndefined({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    // GFJ-15: the role title, without pay, bonus, place or work-mode text.
    // The visible H1 keeps the employer's wording.
    title: cleanRoleTitle(job.title, job),
    description,
    url: canonicalUrl,
    datePosted: datePosted.toISOString(),
    validThrough: validThrough.toISOString(),
    // GFJ-06: omitted when unknown, never defaulted to FULL_TIME. H-03:
    // every type the posting offers, an array when there are several, the
    // same types the page's chip shows (resolveEmploymentTypes).
    employmentType: mapEmploymentTypes(resolveEmploymentTypes(job)),
    hiringOrganization: stripUndefined({
      '@type': 'Organization',
      name: job.employer,
      // sameAs lets Google deduplicate employer entities across postings; logo
      // is what renders next to the listing in Google Jobs results. Only an
      // absolute http(s) URL is emitted.
      sameAs: safeExternalHref(job.companyWebsite) ?? undefined,
      logo: safeExternalHref(job.companyLogoUrl) ?? undefined,
    }),
    ...locationFields,
    baseSalary,
    experienceRequirements,
    industry: 'Healthcare',
    // Live-review item 7-i: previously hardcoded to the NP code for EVERY
    // listing (psychiatrists, podiatrists, PAs included). Now derived per
    // listing; undefined (unclassifiable) is stripped below — omission
    // beats a wrong code per Google's structured-data guidance.
    occupationalCategory: deriveOccupationalCategory(job),
    // GFJ-03, owner decision 2026-09: applying requires an account. Google
    // counts a flow as direct apply only when the visitor completes the
    // application on this page without "unnecessary intermediate steps":
    // "If the user has to click apply, complete an application form, sign
    // in or log in more than once in the application journey, it means that
    // you aren't offering a direct apply experience." An external job
    // applies on the employer's ATS, and an Easy Apply visitor arriving from
    // Google signed out must create an account (and confirm it) before the
    // application form, so no job on this board is direct apply. Stated as
    // false rather than left out, so the markup cannot be read as claiming it.
    directApply: false,
    identifier: requisitionId
      ? { '@type': 'PropertyValue', name: job.employer, value: requisitionId }
      : undefined,
  });

  return structuredData;
}

export default function JobStructuredData({ job }: JobStructuredDataProps) {
  const structuredData = buildJobPostingSchema(job);
  if (!structuredData) return null;

  // SEO/security fix (B29): job.title/description/employer arrive from
  // external aggregators. A literal "</script>" inside any of them would
  // terminate this script element early — corrupting the JobPosting schema
  // and letting the remainder of the string parse as markup (XSS vector).
  // Escape < and > as </> inside the JSON string (same pattern as
  // app/jobs/page.tsx, app/blog/page.tsx, app/salary-guide/page.tsx) —
  // JSON.parse output is identical, but the payload can never break out of
  // the <script> element.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e'),
      }}
    />
  );
}
