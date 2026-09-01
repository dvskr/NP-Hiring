import { Job } from '@/lib/types';
import { slugify, canonicalSalaryPeriod, type SalaryPeriodKey } from '@/lib/utils';
import { brand } from '@/config/brand';

function mapJobType(jobType: string | null): string {
  const mapping: Record<string, string> = {
    'Full-Time': 'FULL_TIME',
    'Part-Time': 'PART_TIME',
    'Contract': 'CONTRACTOR',
    'Per Diem': 'PER_DIEM',
    'Travel': 'TEMPORARY',
    'Temporary': 'TEMPORARY',
    'Internship': 'INTERN',
  };
  return mapping[jobType || ''] || 'FULL_TIME';
}

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
  // 'unknown' cadence: the only values allowed to back a unit are the
  // ANNUALIZED normalized bounds (see pickBoundForSchema), so YEAR is the
  // only honest unitText. The pipeline withholds normalized values for these
  // rows, so in practice baseSalary is suppressed entirely.
  unknown: 'YEAR',
};
// 26 biweekly pay periods per year spread over 12 months.
const BIWEEKLY_TO_MONTHLY = 26 / 12;

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
 * Build the JobPosting JSON-LD object for a job. Exported as a pure function
 * so the schema logic (SOC gating, TELECOMMUTE semantics, salary units) is
 * unit-testable without rendering React.
 */
export function buildJobPostingSchema(job: JobStructuredDataProps['job']): Record<string, unknown> {
  // Use originalPostedAt (real source date) with createdAt fallback for SEO accuracy
  const rawDate = job.originalPostedAt || job.createdAt;
  const datePosted = rawDate instanceof Date ? rawDate : new Date(rawDate as string);

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
  const description = (job.description && job.description.trim())
    || (job.descriptionSummary && job.descriptionSummary.trim())
    || `${job.title} position at ${job.employer}${job.city ? ` in ${job.city}, ${job.stateCode || job.state}` : ''}`;

  // SEO Fix #2: schema URL must match the canonical resolver. Live route reads
  // the trailing UUID and renders any prefix, but Google penalizes URL/canonical
  // mismatches. The DB-stored job.slug can drift from current slugify() output
  // when titles contain '/', '&', or other punctuation — generate the slug from
  // the same source the page uses so schema URL == <link rel=canonical>.
  const canonicalSlug = job.slug || slugify(job.title, job.id);
  const canonicalUrl = `${brand.baseUrl}/jobs/${canonicalSlug}`;

  // SEO Fix #1 (corrected per live-review item 7-ii): location semantics for
  // remote / hybrid / in-person. Google's actual guidance: jobLocationType
  // TELECOMMUTE means the job is 100% remote — DO NOT use it for hybrid
  // roles that require any on-site presence.
  //   - Remote-only (isRemote && !isHybrid) → omit jobLocation, set
  //     jobLocationType TELECOMMUTE + applicantLocationRequirements
  //   - Hybrid                              → physical jobLocation ONLY,
  //     never TELECOMMUTE (an earlier version of this block claimed the
  //     opposite of the guidance and emitted TELECOMMUTE for hybrid)
  //   - In-person / null                    → physical jobLocation only
  const hasPhysicalLocation = !!(job.city || job.state || job.stateCode);
  const addressLocality = hasPhysicalLocation ? (job.city || undefined) : undefined;
  const addressRegion = hasPhysicalLocation ? (job.stateCode || job.state || undefined) : undefined;
  // Note: streetAddress is intentionally omitted. Job listings don't include a
  // physical street, and previous code stuffed "City, ST" into streetAddress —
  // a semantic error per schema.org PostalAddress (those values belong in
  // addressLocality and addressRegion, which we already emit).

  const physicalJobLocation = hasPhysicalLocation
    ? {
        '@type': 'Place',
        address: stripUndefined({
          '@type': 'PostalAddress',
          addressLocality,
          addressRegion,
          addressCountry: 'US',
        }),
      }
    : undefined;

  // Remote-only jobs: drop physical jobLocation entirely and mark TELECOMMUTE.
  // Hybrid: physical jobLocation only — hybrid is NOT 100% remote, so it gets
  // neither TELECOMMUTE nor applicantLocationRequirements.
  const isFullyRemote = job.isRemote && !job.isHybrid;
  const jobLocation = isFullyRemote ? undefined : physicalJobLocation;
  const jobLocationType = isFullyRemote ? 'TELECOMMUTE' : undefined;
  const applicantLocationRequirements = isFullyRemote
    ? { '@type': 'Country', name: 'US' }
    : undefined;

  // SEO Fix #3: emit salary in its NATIVE unit. Previously we always pushed
  // normalizedMin/Max (annualized) with unitText: 'YEAR' even when the source
  // posting was hourly, producing UI ($175/hr) ≠ schema ($364k/yr) mismatches.
  // For non-annual periods, prefer the raw minSalary/maxSalary (original unit).
  // The canonical period key is shared with formatSalary in lib/utils.ts so
  // UI and schema can never branch differently on the same DB value.
  const periodKey = canonicalSalaryPeriod(job.salaryPeriod);
  const unitText = SCHEMA_UNIT_TEXT[periodKey];
  // salaryPeriod='unknown' is a DECISION, not a missing value (P9 #2a): the
  // ingest validator saw a magnitude in the ambiguous band with no explicit
  // period token, kept the raw figures for the record, and REFUSED to
  // normalize them. canonicalSalaryPeriod used to fold 'unknown' into
  // 'annual', which republished that raw ambiguous figure here with unitText
  // YEAR — a possibly-monthly $35,000 emitted as $35,000/year, recreating the
  // 7-iii wrong-unit defect for this row class. It now returns 'unknown' as
  // its own key (formatSalary renders no figure for it, matching this
  // emitter's suppression). Omission beats wrong: under an unknown period
  // only ANNUALIZED normalized values may back a YEAR unit; the pipeline
  // withholds them for these rows, so baseSalary is suppressed entirely
  // (undefined bounds → no block below).
  const isUnknownPeriod = periodKey === 'unknown';
  // Non-annual periods use the RAW source values ONLY — normalizedMin/Max are
  // ANNUALIZED figures, so falling back to them under an HOUR/MONTH unitText
  // (as the previous version did when one raw bound was missing) mixed units
  // inside a single QuantitativeValue. A missing bound is omitted instead.
  const pickBoundForSchema = (
    normalized: number | null | undefined,
    raw: number | null | undefined,
  ): number | null | undefined => {
    if (isUnknownPeriod) return normalized; // never the raw unclassified figure
    if (periodKey === 'annual') return normalized != null ? normalized : raw;
    return raw;
  };
  const rawMinForSchema = pickBoundForSchema(job.normalizedMinSalary, job.minSalary);
  const rawMaxForSchema = pickBoundForSchema(job.normalizedMaxSalary, job.maxSalary);

  // Biweekly is the one period whose unitText (MONTH) differs from the source
  // cadence, so the per-paycheck value must be converted to per-month
  // (× 26 / 12). Every other period passes through in its native unit.
  // Rounded — synthetic cents would imply precision the source doesn't carry.
  const toSchemaValue = (value: number | null | undefined): number | undefined => {
    if (value == null) return undefined;
    return periodKey === 'biweekly' ? Math.round(value * BIWEEKLY_TO_MONTHLY) : value;
  };
  const minForSchema = toSchemaValue(rawMinForSchema);
  const maxForSchema = toSchemaValue(rawMaxForSchema);

  const baseSalary = minForSchema !== undefined || maxForSchema !== undefined
    ? {
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: stripUndefined({
          '@type': 'QuantitativeValue',
          minValue: minForSchema,
          maxValue: maxForSchema ?? minForSchema,
          unitText,
        }),
      }
    : undefined;

  // Phase 1 #13 — surface structured experience requirements to Google
  // Jobs. Google's docs accept `experienceRequirements.monthsOfExperience`
  // (numeric) plus `experienceInPlaceOfEducation` (boolean) to indicate
  // employers will consider experience-equivalence. We map:
  //   - minYearsExperience  → monthsOfExperience (× 12)
  //   - newGradFriendly     → experienceInPlaceOfEducation = false AND
  //                            adds an OccupationalExperienceRequirements
  //                            block stating new grads are accepted.
  // When both fields are null we omit the entire block so Google doesn't
  // see an empty container (lint-flagged in Rich Results Test).
  const months =
    typeof job.minYearsExperience === 'number' && job.minYearsExperience > 0
      ? job.minYearsExperience * 12
      : undefined;
  const experienceRequirements =
    months !== undefined
      ? stripUndefined({
          '@type': 'OccupationalExperienceRequirements',
          monthsOfExperience: months,
        })
      : job.newGradFriendly
        ? stripUndefined({
            '@type': 'OccupationalExperienceRequirements',
            monthsOfExperience: 0,
          })
        : undefined;

  const structuredData = stripUndefined({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
    url: canonicalUrl,
    datePosted: datePosted.toISOString(),
    validThrough: validThrough.toISOString(),
    employmentType: mapJobType(job.jobType),
    hiringOrganization: stripUndefined({
      '@type': 'Organization',
      name: job.employer,
      // sameAs lets Google deduplicate employer entities across postings; logo
      // is what renders next to the listing in Google Jobs results.
      sameAs: job.companyWebsite || undefined,
      logo: job.companyLogoUrl || undefined,
    }),
    jobLocation,
    jobLocationType,
    applicantLocationRequirements,
    baseSalary,
    experienceRequirements,
    // Indicate to Google that on-the-job experience can substitute for
    // formal education thresholds when the employer explicitly accepts
    // new grads. Google uses this in Rich Results filtering.
    ...(job.newGradFriendly ? { experienceInPlaceOfEducation: true } : {}),
    industry: 'Healthcare',
    // Live-review item 7-i: previously hardcoded to the NP code for EVERY
    // listing (psychiatrists, podiatrists, PAs included). Now derived per
    // listing; undefined (unclassifiable) is stripped below — omission
    // beats a wrong code per Google's structured-data guidance.
    occupationalCategory: deriveOccupationalCategory(job),
    // Only emit directApply when the application actually completes on this
    // page (in-platform ATS via applyOnPlatform). For employer-direct-link
    // and aggregator listings we omit — the apply flow leaves the URL.
    // Misclaiming directApply on off-site flows triggers Google Jobs demotion.
    ...(job.applyOnPlatform ? { directApply: true } : {}),
    identifier: {
      '@type': 'PropertyValue',
      name: brand.name,
      value: job.id,
    },
  });

  return structuredData;
}

export default function JobStructuredData({ job }: JobStructuredDataProps) {
  const structuredData = buildJobPostingSchema(job);

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
