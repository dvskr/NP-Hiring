/**
 * Pure planners for the scripts in scripts/indexing-fixes/.
 *
 * Every function here takes a stored job row and returns the change the
 * fixed ingest code would make, or null. Nothing here reads or writes the
 * database; the runner scripts do that, and only with --apply. The
 * planners reuse the SAME code paths ingest now uses (parseLocation,
 * extractSalary, validateAndNormalizeSalary, normalizeSalary,
 * detectNonUsWorkSite, analyzeDescriptionStub, the deduplicator's work-site
 * identity), so a re-run after --apply plans nothing, and a later code fix
 * converges the stored rows again on the next run.
 */
import { parseLocation, detectNonUsWorkSite, statesNamedIn, type NonUsWorkSite } from '@/lib/location-parser';
import {
  extractSalary,
  validateAndNormalizeSalary,
  analyzeDescriptionStub,
  detectMode,
  reconcileWorkMode,
  resolveJobType,
} from '@/lib/job-normalizer';
import { normalizeSalary } from '@/lib/salary-normalizer';
import {
  resolveLocationFallback,
  locationNamesUsState,
  storedLocality,
  type LocationFallbackSource,
} from '@/lib/location-fallback';
import {
  hasTownNameShape,
  namesPlaceholderNotTown,
  namesRegionNotTown,
  namesSiteNotTown,
  namesStreetFragment,
} from '@/lib/locality';
import { hasRemoteEvidence, withoutNegatedModeStatements } from '@/lib/work-mode-detection';
import { formatDisplaySalary } from '@/lib/salary-display';
import { parseLocationList } from '@/app/jobs/[slug]/job-posting-facts';
import { normalizeCompany, normalizeTitle, workSiteOf, descriptionFingerprint } from '@/lib/deduplicator';
import { salaryConfig } from '@/config/niche/salary';

/** The stored columns the planners read. */
export interface JobRow {
  id: string;
  slug: string | null;
  title: string;
  employer: string;
  location: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  country: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  mode: string | null;
  jobType: string | null;
  minSalary: number | null;
  maxSalary: number | null;
  salaryPeriod: string | null;
  salaryRange: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  salaryIsEstimated: boolean;
  salaryConfidence: number | null;
  displaySalary: string | null;
  isPublished: boolean;
  isManuallyUnpublished: boolean;
  sourceType: string | null;
  sourceProvider: string | null;
  applyLink: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

/** Prisma select matching JobRow. */
export const JOB_ROW_SELECT = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  description: true,
  city: true,
  state: true,
  stateCode: true,
  country: true,
  isRemote: true,
  isHybrid: true,
  mode: true,
  jobType: true,
  minSalary: true,
  maxSalary: true,
  salaryPeriod: true,
  salaryRange: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
  salaryIsEstimated: true,
  salaryConfidence: true,
  displaySalary: true,
  isPublished: true,
  isManuallyUnpublished: true,
  sourceType: true,
  sourceProvider: true,
  applyLink: true,
  createdAt: true,
  expiresAt: true,
} as const;

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/** The columns in `next` whose value differs from the row. */
export function diffFields(row: JobRow, next: Record<string, unknown>): FieldChanges {
  const out: FieldChanges = {};
  for (const [key, to] of Object.entries(next)) {
    const from = (row as unknown as Record<string, unknown>)[key] ?? null;
    if ((from ?? null) !== (to ?? null)) out[key] = { from, to: to ?? null };
  }
  return out;
}

function blank(v: string | null | undefined): boolean {
  return !v || !v.trim();
}

// ── Row scope: employer-posted rows are never unpublished here ──────────

/**
 * Source types of rows an employer posted on the board (paid or promo).
 * Their jobType is the employer's own form field (never re-derived), and
 * no script here unpublishes them: they are never ingested again, so
 * nothing would bring such a row back, and every unpublish path in the app
 * (source-presence-unpublish, check-dead-links, deindex-expired) is limited
 * to sourceType 'external' too. The unpublishing runners read only
 * 'external' rows and list the employer-posted rows the same test flags
 * for a person to review.
 */
export const EMPLOYER_POSTED_SOURCE_TYPES: readonly string[] = ['employer', 'direct'];

const EMPLOYER_SOURCE_TYPES: ReadonlySet<string> = new Set(EMPLOYER_POSTED_SOURCE_TYPES);

/** True for a row an employer posted on the board (sourceType 'employer' or 'direct'). */
export function isEmployerPosted(row: Pick<JobRow, 'sourceType'>): boolean {
  return EMPLOYER_SOURCE_TYPES.has(row.sourceType ?? '');
}

// ── Location ────────────────────────────────────────────────────────────

const STRONG_FACILITY_RE =
  /\b(?:hospital|clinic|campus|specialists|associates|psychiatric|psychiatry|behavioral|healthcare|practice|offices?|department|dept|facility|llc|inc|pllc|locations)\b/i;

/**
 * A stored city that is really an address, a number, a facility name, a
 * state code ("CA" from "Remote - CA, NY"), a list of places ("Dallas /
 * Houston", "MO; Overland Park") or a sentence fragment a loose reader took
 * for a town ("s: Denver", "must reside in"; lib/locality.ts
 * hasTownNameShape), a region of a state ("Northern" from "Northern
 * Virginia", "Metro Detroit", "Within" from "Within Texas", "Houston
 * Metro"; namesRegionNotTown), a placeholder or work arrangement
 * ("Unknown", "Coming Soon", "Field Based"; namesPlaceholderNotTown), a
 * street name ("Main St", "Oak Ave"; namesStreetFragment), or a site,
 * district or custody word or a facility code ("Field", "Corporate",
 * "County Jail", "Downtown Atlanta", "MHC Nashville"; namesSiteNotTown). The
 * re-parse files a district or a coded site under its town when the city
 * dataset knows it ("Atlanta", "Nashville"). The dataset town Central, LA is
 * flagged too; when its location text names it, the re-parsed city is the
 * same and the row is not changed.
 */
export function isInvalidStoredCity(city: string | null | undefined): boolean {
  if (blank(city)) return false;
  const c = city!.trim();
  return /\d/.test(c) || /\t/.test(city!) || STRONG_FACILITY_RE.test(c) || /^[A-Z]{2}$/.test(c) || /[;/]/.test(c) ||
    !hasTownNameShape(c) || namesRegionNotTown(c) || namesPlaceholderNotTown(c) ||
    namesStreetFragment(c) || namesSiteNotTown(c);
}

/** A stored city that is only a number ("1730"): the street number of an address. */
export function isBareNumberCity(city: string | null | undefined): boolean {
  return !blank(city) && /^\d+$/.test(city!.trim());
}

export type LocationReason = 'wrong_state' | 'missing_state' | 'address_or_facility_city' | 'missing_city';

export interface LocationPlan {
  reasons: LocationReason[];
  next: { city: string | null; state: string | null; stateCode: string | null };
}

/**
 * Re-parse the stored location text with the fixed parser and correct the
 * city and state columns where they are wrong or missing. A stored city
 * that is valid is never replaced by a different parsed city in the same
 * state (it may have come from a better source than the location text).
 *
 * A stored state is wrong only when the location text does not name it at
 * all (statesNamedIn): a posting that lists several places ("Kansas City,
 * MO; Overland Park, KS") is right to store any of them, while "1730 Rhode
 * Island Ave NW, Washington, DC" names Rhode Island only as a street, so a
 * stored RI is still wrong.
 */
export function planLocationCorrection(row: JobRow): LocationPlan | null {
  const parsed = parseLocation(row.location ?? '');
  // The parsed city goes through the same guard ingest applies, so a
  // correction never writes a junk town (lib/location-fallback.ts).
  const parsedCity = storedLocality(parsed.city, parsed.stateCode);
  const reasons: LocationReason[] = [];
  let city = row.city;
  let state = row.state;
  let stateCode = row.stateCode;
  const storedStateNamed = !blank(row.stateCode) && statesNamedIn(row.location).has(row.stateCode!.trim().toUpperCase());

  if (parsed.stateCode && row.stateCode && parsed.stateCode !== row.stateCode && !storedStateNamed) {
    reasons.push('wrong_state');
    stateCode = parsed.stateCode;
    state = parsed.state;
    city = parsedCity;
  } else if (parsed.stateCode && blank(row.stateCode)) {
    reasons.push('missing_state');
    stateCode = parsed.stateCode;
    state = parsed.state;
  }

  if (isInvalidStoredCity(row.city)) {
    reasons.push('address_or_facility_city');
    city = parsed.stateCode && parsed.stateCode === stateCode ? parsedCity : null;
  } else if (blank(city) && parsedCity && parsed.stateCode && parsed.stateCode === stateCode) {
    reasons.push('missing_city');
    city = parsedCity;
  }

  if (city === row.city && state === row.state && stateCode === row.stateCode) return null;
  return { reasons, next: { city, state, stateCode } };
}

// ── Pay ─────────────────────────────────────────────────────────────────

const PERIOD_KEY: Readonly<Record<string, string>> = {
  hour: 'hourly', hourly: 'hourly', hr: 'hourly',
  day: 'daily', daily: 'daily',
  week: 'weekly', weekly: 'weekly',
  biweekly: 'biweekly',
  month: 'monthly', monthly: 'monthly',
  year: 'annual', yearly: 'annual', annual: 'annual',
};

/**
 * A stored raw figure equal to one of the old clamp bounds
 * (config/niche/salary.ts jobNormalizer.periodBounds): "$30,000" per year
 * or "$500,000" per year, "$20" or "$350" per hour, and so on. Before
 * 2026-09-28 out-of-band figures were clamped to these, so such a value is
 * most likely invented, and is re-derived from the posting text.
 */
export function isRawClampValue(value: number | null, period: string | null): boolean {
  if (value == null || !period) return false;
  const key = PERIOD_KEY[period.toLowerCase()] ?? period.toLowerCase();
  const bounds = (salaryConfig.jobNormalizer.periodBounds as Readonly<Record<string, { min: number; max: number }>>)[key];
  return !!bounds && (value === bounds.min || value === bounds.max);
}

export type PayReason = 'clamped_raw_value' | 'clamped_normalized_value';

export interface PayPlan {
  reason: PayReason;
  /** What the posting text states, for the printout. */
  statedInText: string | null;
  next: {
    minSalary: number | null;
    maxSalary: number | null;
    salaryPeriod: string | null;
    salaryRange: string | null;
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    salaryIsEstimated: boolean;
    salaryConfidence: number | null;
    displaySalary: string | null;
  };
}

const NO_PAY: PayPlan['next'] = {
  minSalary: null,
  maxSalary: null,
  salaryPeriod: null,
  salaryRange: null,
  normalizedMinSalary: null,
  normalizedMaxSalary: null,
  salaryIsEstimated: false,
  salaryConfidence: null,
  displaySalary: null,
};

function payFrom(min: number | null, max: number | null, period: string | null, title: string, estimated: boolean, confidenceCap: number | null): PayPlan['next'] {
  if (!min && !max) return NO_PAY;
  const salaryRange = min && max ? `$${min.toLocaleString('en-US')} to $${max.toLocaleString('en-US')}` : null;
  const n = normalizeSalary({ salaryRange, minSalary: min, maxSalary: max, salaryPeriod: period, title });
  const confidence = n.salaryConfidence == null
    ? null
    : confidenceCap == null ? n.salaryConfidence : Math.min(n.salaryConfidence, confidenceCap);
  return {
    minSalary: min,
    maxSalary: max,
    salaryPeriod: period,
    salaryRange,
    normalizedMinSalary: n.normalizedMinSalary,
    normalizedMaxSalary: n.normalizedMaxSalary,
    salaryIsEstimated: estimated || n.salaryIsEstimated,
    salaryConfidence: confidence,
    displaySalary: formatDisplaySalary(n.normalizedMinSalary, n.normalizedMaxSalary, period),
  };
}

/** Two figures within 5% of each other: the same amount written twice. */
function sameFigure(a: number | null, b: number | null): boolean {
  return a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.05;
}

/**
 * Correct pay the old clamps invented.
 *   - A raw figure equal to a clamp bound is re-derived from the posting
 *     text with the fixed extractor (the Sol Mental Health rows: raw
 *     $30,000 from a "$1,500 annually" CEU budget, text "Compensation
 *     $140,000 - $228,400+"). The text figure is taken when the text states
 *     it as pay, or when it repeats the stored figure: a posting whose own
 *     range starts at $30,000 (MedElite "$30,000 - $90,000") only looks like
 *     a clamp, so its figure is kept and re-normalized. No such figure in
 *     the text means no salary.
 *   - Otherwise the stored raw figure is re-normalized without clamping (a
 *     $40,000 to $44,000 posting stored as $48,000 normalized).
 */
export function planPayCorrection(row: JobRow): PayPlan | null {
  const rawArtifact = isRawClampValue(row.minSalary, row.salaryPeriod) || isRawClampValue(row.maxSalary, row.salaryPeriod);
  let reason: PayReason;
  let next: PayPlan['next'];
  let statedInText: string | null = null;

  if (rawArtifact) {
    reason = 'clamped_raw_value';
    const text = extractSalary(`${row.title} ${row.description ?? ''} ${row.location ?? ''}`);
    const repeatsStored = sameFigure(text.min, row.minSalary) || sameFigure(text.max, row.maxSalary);
    if ((text.min || text.max) && (text.stated || repeatsStored)) {
      const v = validateAndNormalizeSalary(text.min, text.max, '', row.title, text.period);
      next = payFrom(v.minSalary, v.maxSalary, v.salaryPeriod, row.title, false, null);
      statedInText = `${text.min ?? ''} to ${text.max ?? ''} per ${text.period}`;
    } else {
      next = NO_PAY;
    }
  } else if (row.minSalary || row.maxSalary) {
    reason = 'clamped_normalized_value';
    next = payFrom(
      row.minSalary,
      row.maxSalary,
      row.salaryPeriod,
      row.title,
      row.salaryIsEstimated,
      row.salaryConfidence,
    );
    // Only the normalized columns are in question here; keep the stored
    // raw figure, period and range text as they are.
    next = {
      ...next,
      minSalary: row.minSalary,
      maxSalary: row.maxSalary,
      salaryPeriod: row.salaryPeriod,
      salaryRange: row.salaryRange,
    };
    if (next.normalizedMinSalary === row.normalizedMinSalary && next.normalizedMaxSalary === row.normalizedMaxSalary) {
      return null;
    }
  } else {
    return null;
  }

  const changes = diffFields(row, next);
  if (Object.keys(changes).length === 0) return null;
  return { reason, statedInText, next };
}

// ── FB-3: rows that show false location or pay ──────────────────────────

export type Fb3Reason = 'non_us_work_site' | 'wrong_state' | 'address_or_number_city' | 'pay_not_stated_by_employer';

export interface Fb3Plan {
  reasons: Fb3Reason[];
  notes: string[];
}

/**
 * Plan item FB-3: a published row whose page or JobPosting markup shows a
 * location or pay the employer did not state. Such rows are unpublished
 * (isManuallyUnpublished pins them against renewal) until
 * correct-location-and-pay.ts corrects and re-publishes them. Non-US rows
 * are never re-published (owner decision: US jobs only).
 *
 * Messy but true data is NOT FB-3 (CQ-02 skeptic): a street address stored
 * as the city in the right state ("5100 Buckeyestown Pike Suite 200
 * Frederick", MD; "4401 Wornall Rd Kansas City", MO) and a posting's own
 * pay whose normalized columns were clamped are corrected in place by
 * correct-location-and-pay.ts without unpublishing. Each extra unpublish is
 * a 410 and a deindex removal, followed by a later re-publish.
 */
export function planFb3(row: JobRow): Fb3Plan | null {
  const reasons: Fb3Reason[] = [];
  const notes: string[] = [];

  const foreign = nonUsWorkSite(row);
  if (foreign) {
    reasons.push('non_us_work_site');
    notes.push(`work site ${foreign.country} (${foreign.evidence}: "${foreign.matched}")`);
  }

  const loc = planLocationCorrection(row);
  const wrongState = !!loc?.reasons.includes('wrong_state');
  if (wrongState) {
    reasons.push('wrong_state');
    notes.push(`state ${row.stateCode} should be ${loc!.next.stateCode}`);
  }
  // A bare number ("1730") is shown as the city name; an address in the
  // right state is only unparsed, so it counts only beside a wrong state.
  if (row.city && /^\s*\d/.test(row.city) && (isBareNumberCity(row.city) || wrongState)) {
    reasons.push('address_or_number_city');
    notes.push(`city "${row.city.trim()}" should be "${loc?.next.city ?? '(none)'}"`);
  }

  // Only a raw clamp figure the posting does not state is pay the employer
  // never stated (the header shows it). When the re-derived raw figure is
  // the stored one (MedElite's own "$30,000 - $90,000"), or the reason is
  // 'clamped_normalized_value', only the normalized columns are off, and
  // correct-location-and-pay.ts fixes those in place.
  const pay = planPayCorrection(row);
  const rawPayChanges = !!pay && (pay.next.minSalary !== row.minSalary || pay.next.maxSalary !== row.maxSalary);
  if (pay?.reason === 'clamped_raw_value' && rawPayChanges) {
    reasons.push('pay_not_stated_by_employer');
    notes.push(
      `pay ${row.displaySalary ?? `${row.normalizedMinSalary ?? '?'} to ${row.normalizedMaxSalary ?? '?'}`} ` +
      `should be ${pay.next.displaySalary ?? 'no salary'}`,
    );
  }

  return reasons.length > 0 ? { reasons, notes } : null;
}

// ── Non-US ──────────────────────────────────────────────────────────────

export function nonUsWorkSite(row: JobRow): NonUsWorkSite | null {
  return detectNonUsWorkSite({
    title: row.title,
    description: row.description,
    location: row.location,
    atsCountry: row.country,
  });
}

// ── Stub descriptions ───────────────────────────────────────────────────

export function isStubRow(row: JobRow): boolean {
  return analyzeDescriptionStub(row.description, row.title).isStub;
}

// ── FB-3 re-publish ─────────────────────────────────────────────────────

/**
 * Why a row FB-3 held must stay held after correct-location-and-pay.ts
 * applies `next` (its location and pay corrections), or null when the
 * corrected row passes every gate and may be re-published:
 *   - 'run without --only': a partial run (--only=location or --only=pay)
 *     leaves the other correction unmade, so the row would go live with a
 *     wrong state or pay the employer never stated;
 *   - 'work site XX': a non-US work site is never re-published;
 *   - the FB-3 reasons the corrected row still has;
 *   - 'stub description': hold-stub (step 3) reads only published rows, so
 *     it never saw the held row; a stub must not go live here either.
 * The expiry check stays in the runner (it needs the run's clock).
 */
export function republishBlocker(row: JobRow, next: Record<string, unknown>, only: readonly string[] | null): string | null {
  const fullRun = !only || (only.includes('location') && only.includes('pay'));
  if (!fullRun) return 'run without --only';
  const corrected = { ...row, ...next } as JobRow;
  const foreign = nonUsWorkSite(corrected);
  if (foreign) return `work site ${foreign.country}`;
  const fb3 = planFb3(corrected);
  if (fb3) return fb3.reasons.join(', ');
  if (isStubRow(corrected)) return 'stub description';
  return null;
}

/** True when a row FB-3 held may be re-published once `next` is applied (see republishBlocker). */
export function shouldRepublishHeld(row: JobRow, next: Record<string, unknown>, only: readonly string[] | null): boolean {
  return republishBlocker(row, next, only) === null;
}

// ── Duplicates ──────────────────────────────────────────────────────────

export interface DuplicateGroup {
  key: string;
  keep: JobRow;
  remove: JobRow[];
}

export interface DuplicatePlan {
  groups: DuplicateGroup[];
  /**
   * Listed, never changed: the same employer, title and text at different
   * sites, and exact groups that hold two or more employer-posted rows.
   */
  review: JobRow[][];
}

/**
 * The work site a row is for, as the deduplicator reads it. The street
 * address is part of it, so two clinics of one employer in the same city
 * never group as duplicates.
 */
function siteKey(row: JobRow): string {
  const site = workSiteOf(row.location);
  const address = site.address ?? '';
  return site.city
    ? `c:${site.city}|${site.stateCode ?? ''}|${address}`
    : `s:${site.stateCode ?? ''}|${site.isRemote ? 'remote' : ''}|${address}`;
}

function byAge(a: JobRow, b: JobRow): number {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  return t !== 0 ? t : a.id.localeCompare(b.id);
}

/**
 * fixSoon 8: exact duplicates are rows with the same employer, normalized
 * title, work site and description text. The oldest row of each group is
 * kept (its URL has been live longest); the others are unpublished.
 * Genuine per-city requisitions differ in work site (and usually in text),
 * so they never group.
 *
 * An employer-posted row (isEmployerPosted) is never removed: it is a
 * paying customer's job, and it is never ingested again, so nothing would
 * re-publish it. A group with exactly one employer-posted row keeps that
 * row, whatever its age, and removes only the aggregated copies; a group
 * with two or more goes to review for a person to decide.
 */
export function planDuplicateGroups(rows: readonly JobRow[]): DuplicatePlan {
  const exact = new Map<string, JobRow[]>();
  const sameText = new Map<string, JobRow[]>();
  for (const row of rows) {
    const fp = descriptionFingerprint(row.description);
    if (!fp) continue;
    const identity = `${normalizeCompany(row.employer)}|${normalizeTitle(row.title)}`;
    const exactKey = `${identity}|${siteKey(row)}|${fp}`;
    exact.set(exactKey, [...(exact.get(exactKey) ?? []), row]);
    const textKey = `${identity}|${fp}`;
    sameText.set(textKey, [...(sameText.get(textKey) ?? []), row]);
  }

  const groups: DuplicateGroup[] = [];
  const review: JobRow[][] = [];
  for (const [key, members] of exact) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byAge);
    const employerPosted = sorted.filter(isEmployerPosted);
    if (employerPosted.length >= 2) {
      review.push(sorted);
      continue;
    }
    const keep = employerPosted[0] ?? sorted[0];
    groups.push({ key, keep, remove: sorted.filter((r) => r !== keep) });
  }

  for (const members of sameText.values()) {
    const sites = new Set(members.map(siteKey));
    if (members.length > 1 && sites.size > 1) review.push([...members].sort(byAge));
  }
  return { groups, review };
}

// ── fixSoon 6: missing locations, misfiled remote rows, phantom states ──

const US_STATE_NAME_RE =
  /^(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)$/;

export type LocationSource = LocationFallbackSource;

export interface LocationBackfillPlan {
  source: LocationSource;
  evidence: string;
  next: { city: string | null; state: string | null; stateCode: string | null; location?: string };
}

/** Rows fixSoon 6 targets: not fully remote, and no city, state or state code. */
export function needsLocationBackfill(row: JobRow): boolean {
  const fullyRemote = row.isRemote && !row.isHybrid;
  return !fullyRemote && blank(row.city) && blank(row.state) && blank(row.stateCode);
}

/**
 * Where the row's location can be recovered. The title has authority: a
 * "City, ST", state-name or bare state segment of the title wins, because
 * it is the visible H1. Otherwise, in order of trust: the Workday detail
 * endpoint's primary location (when the runner fetched it), a labelled
 * "Location:" line in the description, a street address line at the top of
 * the description, then a "work in City, State" phrase; each counts only
 * when it resolves to a US state that agrees with any state the title names.
 * The rules live in lib/location-fallback.ts, which ingest calls too, so new
 * rows arrive with the same place this repair gives old ones.
 *
 * A stored location text that itself says remote ("Remote") is placed only
 * by the title, as at ingest (lib/job-normalizer.ts): a text-only In-Person
 * reading can clear the remote flag, and the description then names the
 * employer's office ("based in New York, NY"), not a work site.
 */
export function planLocationBackfill(row: JobRow, workdayPrimaryLocation?: string | null): LocationBackfillPlan | null {
  if (!needsLocationBackfill(row)) return null;
  const remoteText = parseLocation(row.location ?? '').isRemote;
  const found = resolveLocationFallback({
    title: row.title,
    description: remoteText ? '' : row.description,
    workdayPrimaryLocation: remoteText ? null : workdayPrimaryLocation,
  });
  if (!found) return null;
  if (remoteText && found.source !== 'title') return null;
  const vagueLocation = !locationNamesUsState(row.location);
  return {
    source: found.source,
    evidence: found.evidence,
    next: {
      // The same last guard ingest applies to every stored city.
      city: storedLocality(found.city, found.stateCode),
      state: found.state,
      stateCode: found.stateCode,
      ...(vagueLocation ? { location: found.label } : {}),
    },
  };
}

export interface StateOnlyTownPlan {
  evidence: string;
  /** Only the town: the stored state is already right and stays untouched. */
  next: { city: string };
}

/** The stored state as a code: the stateCode column, else the state name read as a code. */
function storedStateCodeOf(row: JobRow): string | null {
  const code = row.stateCode?.trim().toUpperCase();
  if (code && /^[A-Z]{2}$/.test(code)) return code;
  return blank(row.state) ? null : parseLocation(row.state!).stateCode ?? null;
}

/**
 * A row that is not fully remote, has its state but no city, and whose
 * location string names exactly one place, a town in that same state:
 * Thriveworks stored "VA - Chesterfield" and "VA - Norfolk" with state
 * Virginia and no city (13 rows), so needsLocationBackfill, which wants the
 * state blank too, never planned them. The job page already reads the town
 * from such a string (app/jobs/[slug]/job-posting-facts.ts locationAddsTown);
 * this stores it, through the same guard ingest applies (storedLocality), so
 * listings and city pages count the row under its town. A string that lists
 * more than one place or state, a town in another state, or a value that is
 * not a town ("VA - Field", "VA - Main Campus") plans nothing.
 */
export function planStateOnlyTownBackfill(row: JobRow): StateOnlyTownPlan | null {
  const fullyRemote = row.isRemote && !row.isHybrid;
  if (fullyRemote || !blank(row.city) || blank(row.location)) return null;
  const stateCode = storedStateCodeOf(row);
  if (!stateCode) return null;
  const location = row.location!.trim();
  const named = statesNamedIn(location);
  if (named.size !== 1 || !named.has(stateCode)) return null;
  const listed = parseLocationList(location);
  if (listed.length !== 1 || listed[0].regionCode !== stateCode || listed[0].locality === null) return null;
  const parsed = parseLocation(location);
  if (parsed.stateCode !== stateCode) return null;
  const city = storedLocality(parsed.city, stateCode);
  return city ? { evidence: location, next: { city } } : null;
}

const REMOTE_ONLY_LOCATION_RE =
  /^(?:remote|anywhere|us|usa|united states|remote,?\s*(?:us|usa|united states)|united states\s*[-–]?\s*remote|remote\s*[-–]\s*(?:us|usa|united states))$/i;
const REMOTE_NEGATION_RE = /\bnot\s+(?:a\s+)?(?:100%|fully|completely)\s+remote\b|remote\s*type:?\s*(?:on-?site|hybrid)/i;

export interface RemoteReclassifyPlan {
  next: { isRemote: boolean; isHybrid: boolean; mode: string };
}

/**
 * fixSoon 6: a row whose raw location is only "Remote" / "United States" /
 * "United States- Remote" but is stored hybrid becomes fully remote when the
 * title and description confirm it: the ingest reconciler reads Remote, and
 * nothing in the text says hybrid, on-site in the ATS "Remote Type" field,
 * or "not a 100% remote position".
 */
export function planRemoteReclassify(row: JobRow): RemoteReclassifyPlan | null {
  if (!row.isHybrid) return null;
  const location = (row.location ?? '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!REMOTE_ONLY_LOCATION_RE.test(location)) return null;
  const description = row.description ?? '';
  const text = `${row.title}\n${description}`;
  if (/\bhybrid\b/i.test(text) || REMOTE_NEGATION_RE.test(text)) return null;
  const parsed = parseLocation(row.location ?? '');
  const reconciled = reconcileWorkMode({
    title: row.title,
    detectedMode: detectMode(`${row.title} ${description}`),
    locationIsRemote: parsed.isRemote,
    locationIsHybrid: parsed.isHybrid,
  });
  if (reconciled.mode !== 'Remote') return null;
  return { next: { isRemote: true, isHybrid: false, mode: 'Remote' } };
}

/**
 * A list of work modes ("if in an on-site or hybrid workplace category", a
 * Corewell vaccine-policy line) names the categories a policy covers, not
 * this job's mode, so it is removed before the mode is read.
 */
const MODE_LIST_RE =
  /\b(?:on[\s-]?site|in[\s-]person|hybrid)(?:\s*(?:,|\/|\bor\b|\band\b)\s*(?:on[\s-]?site|in[\s-]person|hybrid))+\b/gi;

export interface OnsiteReclassifyPlan {
  /** The mode the text states, for the printout. */
  statedMode: string | null;
  next: { isRemote: false; isHybrid: boolean; mode: 'Hybrid' | 'In-Person' };
}

/**
 * fixSoon 6 (CS-03 skeptic fix, item 3): a row flagged remote although
 * nothing says it is. The old enrich-jobs fallback set isRemote = true on
 * every location-less row (and OR-ed isHybrid on beside it), so on-site
 * roles such as Corewell's inpatient psychiatry post at Lakeland Hospital,
 * St. Joseph were listed on /jobs/remote. A row qualifies when it is
 * flagged remote, its location text carries no remote token, and neither
 * its title nor its description has any remote evidence (REMOTE_EVIDENCE_RE,
 * or a Remote reading by detectMode). A statement that denies remote work
 * is not evidence for it: the VA template "Telework: Not Available.
 * Virtual: This is not a virtual position." on an in-person medical center
 * job, or "This is not a remote position". It becomes Hybrid when the text
 * or location states hybrid outside a list of modes, otherwise In-Person;
 * the flags follow the mode as they do at ingest (isRemote and isHybrid are
 * never both true).
 */
export function planOnsiteReclassify(row: JobRow): OnsiteReclassifyPlan | null {
  if (!row.isRemote) return null;
  const location = row.location ?? '';
  const parsedLocation = parseLocation(location);
  if (parsedLocation.isRemote || detectMode(location) === 'Remote') return null;
  const text = `${row.title}\n${row.description ?? ''}`;
  // Any remote wording at all outside a negated statement
  // (lib/work-mode-detection.ts hasRemoteEvidence, broader than detectMode
  // on purpose): the row keeps its flag and is left for a person to judge.
  if (hasRemoteEvidence(withoutNegatedModeStatements(text)) || detectMode(text) === 'Remote') return null;
  const statedMode = detectMode(text.replace(MODE_LIST_RE, ' '));
  const mode = parsedLocation.isHybrid || statedMode === 'Hybrid' ? 'Hybrid' : 'In-Person';
  return { statedMode, next: { isRemote: false, isHybrid: mode === 'Hybrid', mode } };
}

// ── H-03: employment type re-derived from the posting ───────────────────

/**
 * The detector ingest used before 2026-09-29 (substring hits, per diem and
 * contract checked before full time), frozen here only to recognise rows
 * whose stored jobType it produced. A row whose stored type is NOT what it
 * would say for the stored text got its type from somewhere else (the ATS
 * field, the enrichment model, a person) and is left alone.
 */
export function legacyDetectJobType(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('locum tenens') || t.includes('locums') || /\blocum\b/.test(t)) return 'Locum Tenens';
  if (t.includes('per diem') || t.includes('per-diem') || /\bprn\b/.test(t)) return 'Per Diem';
  if (t.includes('1099') || t.includes('independent contractor') || t.includes('contract') || /\bffs\b/.test(t) || /\bfee[\s-]for[\s-]service\b/.test(t)) {
    return 'Contract';
  }
  if (t.includes('part-time') || t.includes('part time') || /\bpart[-\s]?time\b/.test(t) || /\bp\/?t\b/.test(t)) return 'Part-Time';
  if (t.includes('full-time') || t.includes('full time') || t.includes('permanent') || /\bw[\s-]?2\b/.test(t) || /\bf\/?t\b/.test(t)) {
    return 'Full-Time';
  }
  return null;
}

/**
 * Providers whose adapters already passed a structured employment type
 * before 2026-09-29. A stored type on their rows most likely came from that
 * field, which outranks any text reading, so only a missing type is filled.
 * Workday, Greenhouse, Lever and JazzHR passed none (Lever's `job_type` was
 * never read), so their stored types came from the text detector.
 */
const ATS_TYPED_PROVIDERS: ReadonlySet<string> = new Set([
  'ashby', 'bamboohr', 'smartrecruiters', 'workable', 'usajobs', 'adzuna', 'healthcareercenter',
]);

export type JobTypeReason = 'text_detector_fix' | 'missing_type';

export interface JobTypeRederivePlan {
  reason: JobTypeReason;
  /** Where the new type was read (title, labelled line, text, W-2). */
  source: string | null;
  /** Every type the source states, primary first. */
  types: string[];
  next: { jobType: string | null };
}

/**
 * H-03 (f): the jobType the fixed ingest would store for a live row.
 *   - A stored type the old text detector produced (it equals what that
 *     detector says for the stored title and text, by either of its two
 *     call shapes) is replaced by the fixed resolver's answer, including
 *     null when the text states no type (omission beats a wrong type): the
 *     Advocate "Status: Full time" row stored as Per Diem becomes Full-Time,
 *     Highmark's "Contractors ... Notice" rows lose Contract.
 *   - A missing type is filled when the fixed resolver finds one.
 *   - Any other stored type (from the ATS field, enrichment or a person) and
 *     every employer-posted row are left alone.
 * The ATS field is not stored, so the resolver sees the title and text only.
 */
export function planJobTypeRederive(row: JobRow): JobTypeRederivePlan | null {
  // An employer-posted row's jobType is the employer's own form field.
  if (isEmployerPosted(row)) return null;
  const description = row.description ?? '';
  const fixed = resolveJobType({ canonicalAts: null, title: row.title, description });
  const stored = row.jobType?.trim() || null;

  if (!stored) {
    if (!fixed.jobType) return null;
    return { reason: 'missing_type', source: fixed.source, types: fixed.types, next: { jobType: fixed.jobType } };
  }

  if (ATS_TYPED_PROVIDERS.has(row.sourceProvider ?? '')) return null;
  const fullText = `${row.title} ${description} ${row.location ?? ''}`;
  const legacyTitleFirst = legacyDetectJobType(row.title) ?? legacyDetectJobType(fullText);
  const legacyTextOnly = legacyDetectJobType(fullText);
  const fromOldDetector = stored === legacyTitleFirst || stored === legacyTextOnly;
  if (!fromOldDetector || fixed.jobType === stored) return null;
  return { reason: 'text_detector_fix', source: fixed.source, types: fixed.types, next: { jobType: fixed.jobType } };
}

/** A state column holding something that is not a US state ("United States"). */
export function isPhantomState(row: JobRow): boolean {
  return !blank(row.state) && !US_STATE_NAME_RE.test(row.state!.trim()) && !/^[A-Z]{2}$/.test(row.state!.trim());
}

// ── Workday detail URL (for the optional --fetch-workday pass) ──────────

/**
 * The CXS detail endpoint for a Workday apply link:
 * https://{t}.wd{n}.myworkdayjobs.com/en-US/{site}/job/... →
 * https://{t}.wd{n}.myworkdayjobs.com/wday/cxs/{t}/{site}/job/...
 */
export function workdayDetailUrl(applyLink: string | null): string | null {
  if (!applyLink) return null;
  const m = applyLink.match(/^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)(\/job\/[^?#]+)/i);
  if (!m) return null;
  const [, tenant, instance, site, path] = m;
  return `https://${tenant}.${instance}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${path}`;
}
