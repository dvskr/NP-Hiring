/**
 * app/salary-guide/specialty/specialty-content.ts
 *
 * Pure content builders for the by-specialty salary pages. No DB access —
 * the page passes in live aggregates; these functions turn config + live
 * data into display strings and the FAQ array that feeds BOTH the visible
 * accordion and the FAQPage JSON-LD (B48: schema must match visible
 * content, so one array feeds both).
 *
 * Every dollar figure here is either (a) STAT_SOURCES.averageSalary
 * (BLS-cited), (b) a computed premium range over that median (premiums
 * mirror the hub's published table — see specialty-config.ts), or (c) live
 * GATED MEDIANS (review P9 #2c/#2d: the npSalaryAnalyticsWhere pool scoped
 * to NP-eligible titles, published only under the benchmark widget's
 * policy — true median, n ≥ 5 postings from ≥ 3 employers; never a
 * mean-of-min/max). Nothing is typed in by hand, and no figure derives
 * from the ingest tuning constants in config/niche/salary.ts.
 *
 * CREDENTIAL TRUTH: every group noun goes through specialtyNoun /
 * specialtyNounPlural, and every mention of the cited median goes through
 * medianSentence. Both branch on `page.isNicheRole`, so a non-niche APRN
 * role (CRNA, CNM) can never be labelled with the niche token, and the
 * all-<niche> median can never be presented as that role's own pay: a
 * non-niche page cites its own occupation's BLS median instead
 * (citedMedian, indexing audit CQ-09).
 *
 * INDEX RULE (CQ-09, plan FB-2): a specialty page is indexable only when it
 * publishes pay it can back, either a gated posted median or its own cited
 * occupation median (specialtyIndexBasis). The all-<niche> median and the
 * editorial premium estimate do not count, and the title claims only what
 * the page renders (buildSpecialtyTitle).
 */
import { brand } from '@/config/brand';
import { STAT_SOURCES, type StatSource } from '@/lib/stats-sources';
import type { WorkModeMix } from '@/lib/pseo/listing-facts';
import { buildSpecialtyFaqAdditions, formatDollars } from '@/lib/pseo/listing-narrative';
import { formatCount } from '@/lib/display-text';
import { formatStatVintage } from '@/components/SalaryProvenance';
import type { SpecialtySalaryPage, SpecialtyPremium } from './specialty-config';

// ─── Live-data shapes (filled by the page's DB queries) ─────────────────────

export interface SpecialtyLiveStats {
    /**
     * Gated MEDIAN over the NP-eligible analytics pool for this specialty
     * (benchmark policy: n ≥ 5 postings from ≥ 3 employers). 0 below the
     * gate — callers must check gatePassed before rendering any figure.
     */
    medianSalary: number;
    /** Lowest disclosed normalized min across the gated pool (0 = none). */
    minSalary: number;
    /** Highest disclosed normalized max across the gated pool (0 = none). */
    maxSalary: number;
    /** Postings behind the published median (the gated sample size). */
    jobCount: number;
    /** True when the benchmark publishing gate passed. */
    gatePassed: boolean;
}

export interface SpecialtyStateRow {
    state: string;
    stateCode: string;
    /** Matches the /salary-guide/[state] + /jobs/<cat>/[state] slug shape. */
    slug: string;
    /** Gated per-state median (benchmark policy — rows below it are omitted). */
    medianSalary: number;
    jobCount: number;
}

export interface SpecialtyExperienceRow {
    label: string;
    /** Gated per-band median (benchmark policy — bands below it are omitted). */
    medianSalary: number;
    jobCount: number;
}

/**
 * Minimum postings before the specialty INDEX page's "N live postings with
 * pay" count chip renders. A count display only — every dollar FIGURE is
 * gated by the benchmark policy (BENCHMARK_MIN_POSTINGS /
 * BENCHMARK_MIN_EMPLOYERS in components/tools/benchmark-model.ts), which
 * superseded the old per-surface mean floors here (P9 #2d).
 */
export const MIN_LIVE_JOBS = 3;

// ─── Formatting ─────────────────────────────────────────────────────────────

/** "$129K" style — same shape as the salary-guide state pages. */
export function formatSalary(n: number): string {
    if (n >= 1000) return `$${Math.round(n / 1000)}K`;
    return `$${n.toLocaleString('en-US')}`;
}

/** The cited all-NP median as a number (BLS OEWS via lib/stats-sources.ts). */
export function nationalMedian(): number {
    return Number(STAT_SOURCES.averageSalary.value);
}

/** True when a live aggregate has a renderable min–max spread (never "$X–$0"). */
export function hasReportedRange(live: SpecialtyLiveStats): boolean {
    return live.minSalary > 0 && live.maxSalary >= live.minSalary;
}

// ─── Derived ranges ─────────────────────────────────────────────────────────

/**
 * Estimated annual range for a premium specialty: the cited all-NP median
 * scaled by the published premium band. Computed, never hand-typed.
 */
export function premiumEstimateRange(premium: SpecialtyPremium): { min: number; max: number } {
    const median = nationalMedian();
    return {
        min: Math.round(median * (1 + premium.minPct / 100)),
        max: Math.round(median * (1 + premium.maxPct / 100)),
    };
}

/**
 * The config-derived headline range for a specialty page, when one exists.
 *
 * A published premium band over the cited median is the ONLY config source
 * of a range — there is deliberately no second branch. A previous revision
 * published a CRNA "W-2 band" whose ceiling was `salaryConfig.normalizer
 * .annualMax`, the global ingest clamp applied to every job; that is a
 * tuning constant, not wage evidence, and rendering it as "<role> pay
 * spans X–Y" asserted an uncited YMYL salary range as fact.
 */
export function configRange(page: SpecialtySalaryPage): { min: number; max: number } | null {
    if (page.premium) return premiumEstimateRange(page.premium);
    return null;
}

/** Human sentence fragment for an estimated range ("$142K to $155K per year"). */
function bandText(band: { min: number; max: number }): string {
    return `${formatSalary(band.min)} to ${formatSalary(band.max)} per year`;
}

/**
 * Indefinite article for a role name. The FAQ questions ship into FAQPage
 * JSON-LD, so "a Acute Care Nurse Practitioner" is a visible grammar bug in
 * structured data. Every configured role starts with a plain word, so the
 * first-letter test is sufficient here.
 */
function indefiniteArticle(phrase: string): string {
    return /^[aeiou]/i.test(phrase) ? 'an' : 'a';
}

// ─── Credential-safe nouns + median framing ─────────────────────────────────

/**
 * Singular group noun for headings and prose. Niche roles read as
 * "<label> <niche>" ("Family Practice NP"); a non-niche APRN role uses its
 * own credential ("CRNA"), because appending the niche token would state a
 * credential the holder does not have.
 */
export function specialtyNoun(page: SpecialtySalaryPage): string {
    return page.isNicheRole ? `${page.label} ${brand.niche.short}` : page.credential;
}

/** Plural form of {@link specialtyNoun} ("Family Practice NPs", "CRNAs"). */
export function specialtyNounPlural(page: SpecialtySalaryPage): string {
    return `${specialtyNoun(page)}s`;
}

/**
 * The cited national median a page leads with: the all-<niche> BLS median
 * on a niche page (its cohort figure), and the role's own occupation median
 * on a non-niche APRN page, which the all-<niche> median does not include.
 */
export function citedMedian(page: SpecialtySalaryPage): StatSource {
    return page.isNicheRole ? STAT_SOURCES.averageSalary : page.occupationWage;
}

/**
 * The sentence that carries the cited national median, split so surfaces
 * can emphasise the value while sharing one wording.
 *
 * On a niche-role page the all-<niche> median IS that page's cohort figure.
 * A non-niche APRN page cites its own occupation's median and says why:
 * the all-<niche> median excludes the role, so quoting it would read as "a
 * CRNA earns the all-NP median".
 */
export function medianSentenceParts(page: SpecialtySalaryPage): { lead: string; tail: string } {
    const short = brand.niche.short;
    if (page.isNicheRole) {
        return {
            lead: `The national median across all ${short}s is `,
            tail: ` per year (${STAT_SOURCES.averageSalary.source}).`,
        };
    }
    return {
        lead: `The national median wage for ${page.occupationWage.occupation} is `,
        tail:
            ` per year (${page.occupationWage.source}). ${specialtyNounPlural(page)} are a distinct APRN role, ` +
            `so this guide cites their own occupation rather than the all-${short} median, which does not include them.`,
    };
}

/** {@link medianSentenceParts} rendered as one plain string. */
export function medianSentence(page: SpecialtySalaryPage): string {
    const { lead, tail } = medianSentenceParts(page);
    return `${lead}${citedMedian(page).formatted}${tail}`;
}

// ─── Index rule and title claims (indexing audit CQ-09, plan FB-2) ──────────

/** Why a specialty page may be indexed: pay it publishes and can back. */
export type SpecialtyIndexBasis = 'posted-median' | 'occupation-wage';

/**
 * The index verdict for a specialty page, or null for `noindex, follow`.
 * A gated posted median (the benchmark gate plus the employer-share cap)
 * qualifies any page; a non-niche page also qualifies on its own cited
 * occupation median. The all-<niche> median and the premium estimate never
 * do: neither is pay data for the specialty itself.
 */
export function specialtyIndexBasis(
    page: SpecialtySalaryPage,
    live: Pick<SpecialtyLiveStats, 'gatePassed' | 'medianSalary'>,
): SpecialtyIndexBasis | null {
    if (live.gatePassed && live.medianSalary > 0) return 'posted-median';
    if (!page.isNicheRole) return 'occupation-wage';
    return null;
}

/** What a specialty page actually renders, for the claims its title may make. */
export interface SpecialtyTitleClaims {
    /** The page publishes pay of its own (a non-null specialtyIndexBasis). */
    hasPay: boolean;
    /** The top-paying-states table renders (3 or more gated state medians). */
    hasTopStates: boolean;
}

/** Minimum gated state rows before the top-paying-states section renders. */
export const MIN_TOP_STATES = 3;

/**
 * <title> for a specialty page. "Pay and Top States" is claimed only when
 * both sections render; a page with neither carries the bare guide name.
 */
export function buildSpecialtyTitle(page: SpecialtySalaryPage, year: number, claims: SpecialtyTitleClaims): string {
    const base = `${page.shortTitle} Salary Guide ${year}`;
    if (claims.hasPay && claims.hasTopStates) return `${base}: Pay and Top States`;
    if (claims.hasPay) return `${base}: Median Pay`;
    if (claims.hasTopStates) return `${base}: Top-Paying States`;
    return base;
}

/**
 * Meta description for a non-niche page: its own cited occupation median
 * first (the one national figure it can back), then the live count and,
 * when gated, the posted median. Null on a niche page, which keeps the
 * shared buildSpecialtyDescription. The caller truncates to its budget.
 */
export function buildOccupationWageDescription(
    page: SpecialtySalaryPage,
    input: { total: number; posted: { median: number; postings: number } | null },
): string | null {
    if (page.isNicheRole) return null;
    const wage = page.occupationWage;
    const posted = input.posted
        ? `, posted median ${formatDollars(input.posted.median)} from ${formatCount(input.posted.postings, 'posting')}`
        : '';
    return `${page.credential} salary: national median ${wage.formatted} (BLS OEWS, ${formatStatVintage(wage.asOf)}). `
        + `${formatCount(input.total, 'open role')} on ${brand.name}${posted}.`;
}

/** Article JSON-LD headline, naming only the sections the page renders. */
export function buildSpecialtyHeadline(page: SpecialtySalaryPage, claims: SpecialtyTitleClaims): string {
    const parts = [
        claims.hasPay ? 'Pay' : null,
        page.premium ? 'Premium Estimate' : null,
        claims.hasTopStates ? 'Top States' : null,
    ].filter((part): part is string => part !== null);
    const base = `${page.role} Salary Guide`;
    if (parts.length === 0) return base;
    if (parts.length === 1) return `${base}: ${parts[0]}`;
    return `${base}: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ─── FAQ builder (feeds visible accordion AND FAQPage JSON-LD) ──────────────

export interface SpecialtyFaq {
    q: string;
    a: string;
}

/**
 * Lowercase a setting chip for mid-sentence prose — unless it starts with
 * an acronym ("ICUs", "FQHCs", "OB/GYN practices"), which keeps its case.
 */
function settingProse(setting: string): string {
    if (/^[A-Z]{2}/.test(setting)) return setting;
    return setting.charAt(0).toLowerCase() + setting.slice(1);
}

function settingsList(settings: readonly string[]): string {
    return settings.slice(0, 3).map(settingProse).join(', ');
}

/**
 * Facts the live SPEC-P1 and SPEC-P4 sections rendered, so the FAQ can
 * repeat them only when they are on the page (thin-spec-4 3B, "Specialty
 * schema"). Every field may be null, in which case its question and its
 * FAQPage entry disappear together.
 */
export interface SpecialtyLiveSections {
    /** The SPEC-P1 sentence, or null when that section did not render. */
    statesSentence: string | null;
    /** The SPEC-P4 work-mode mix, or null when it did not clear its floor. */
    workMode: WorkModeMix | null;
}

export function buildSpecialtyFaqs(
    page: SpecialtySalaryPage,
    live: SpecialtyLiveStats | null,
    topStates: readonly SpecialtyStateRow[],
    sections: SpecialtyLiveSections = { statesSentence: null, workMode: null },
): SpecialtyFaq[] {
    const fpa = STAT_SOURCES.fullPracticeStates;
    const noun = page.credential ? `${page.credential}` : specialtyNoun(page);
    const faqs: SpecialtyFaq[] = [];

    // 1. Headline pay question — cited median + premium-derived range + live
    //    data. On a non-niche APRN page medianSentence cites the role's own
    //    occupation median and says why the all-niche median is not used;
    //    the only other dollar figures that can follow are live board
    //    aggregates.
    const payParts: string[] = [medianSentence(page)];
    if (page.premium) {
        const r = premiumEstimateRange(page.premium);
        // The premium is the hub's editorial table, not survey data, so the
        // answer says so rather than stating it as what the role earns.
        payParts.push(
            `This guide applies an editorial premium of ${page.premium.minPct} to ${page.premium.maxPct}% to that median for ${page.label.toLowerCase()} roles, an estimated ${bandText(r)} that is not survey data.`,
        );
    }
    // P9 #2d: only a GATED median may be quoted (benchmark policy — n ≥ 5
    // postings from ≥ 3 employers), stated as a median, never an "average".
    if (live && live.gatePassed && live.medianSalary > 0) {
        // The min–max spread is appended only when both bounds are real —
        // a set where no posting discloses an upper bound would otherwise
        // publish "range $98K–$0".
        const spread = hasReportedRange(live)
            ? ` (disclosed ranges span ${formatSalary(live.minSalary)} to ${formatSalary(live.maxSalary)})`
            : '';
        payParts.push(
            `Across ${live.jobCount} active ${noun} postings with disclosed pay on ${brand.name}, the median is ${formatSalary(live.medianSalary)} per year${spread}.`,
        );
    }
    faqs.push({ q: `How much does ${indefiniteArticle(page.role)} ${page.role} make?`, a: payParts.join(' ') });

    // 2. Premium driver (premium specialties only). The premium is the
    //    hub's editorial estimate, not survey data, so the question asks what
    //    the guide estimates rather than asserting that the role earns one:
    //    it ships into FAQPage JSON-LD, where a presupposed premium would
    //    read as a sourced fact.
    if (page.premium) {
        faqs.push({
            q: `What premium does this guide estimate for ${specialtyNounPlural(page)}?`,
            a: `This guide's editorial estimate is ${page.premium.minPct} to ${page.premium.maxPct}% over the all-${brand.niche.short} median, reflecting ${page.premium.driver}. It is not survey data. Typical practice settings include ${settingsList(page.settings)}.`,
        });
    }

    // 3. Top-paying states — only when live data supports it. Each row is a
    //    gated per-state MEDIAN (benchmark policy), so the sample counts
    //    quoted here are always ≥ the publishing minimum.
    if (topStates.length >= MIN_TOP_STATES) {
        const top3 = topStates
            .slice(0, 3)
            .map((s) => `${s.state} (${formatSalary(s.medianSalary)} median across ${s.jobCount} ${s.jobCount === 1 ? 'posting' : 'postings'})`)
            .join(', ');
        faqs.push({
            q: `Which states pay ${specialtyNounPlural(page)} the most?`,
            // No trend claim: the ranking is a snapshot of the postings
            // behind the medians, and this page holds no time series that
            // would support "shifts as new jobs arrive".
            a: `Among current postings with disclosed salary on ${brand.name}, the top-paying states for ${page.label.toLowerCase()} roles are ${top3}.`,
        });
    }

    // 4. Certification — correct body per specialty (config-enforced).
    faqs.push({
        q: `What certification does ${indefiniteArticle(page.role)} ${page.role} need?`,
        a: `${page.certification}. State licensure requirements vary, so check your state board of nursing for specifics.`,
    });

    // 5. Increasing pay — FPA stat is the only figure, and it is cited.
    faqs.push({
        q: `How can I increase my ${noun} salary?`,
        a: `Compare offers across practice settings (${settingsList(page.settings)}), consider states that grant full practice authority (${fpa.formatted} per ${fpa.source}), and negotiate total compensation (base pay, bonuses, CME allowance, and loan-repayment support) rather than base salary alone.`,
    });

    // 6. Live sections (SPEC-P1 and SPEC-P4). Each entry is built only from
    //    a sentence that already rendered above the fold, so no FAQPage
    //    answer can state something a reader cannot see on the page.
    for (const entry of buildSpecialtyFaqAdditions({
        credential: noun,
        statesSentence: sections.statesSentence,
        workMode: sections.workMode,
    })) {
        faqs.push({ q: entry.question, a: entry.answer });
    }

    return faqs;
}
