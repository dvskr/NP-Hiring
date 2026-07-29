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
 * DB aggregates. Nothing is typed in by hand, and no figure derives from
 * the ingest tuning constants in config/niche/salary.ts.
 *
 * CREDENTIAL TRUTH: every group noun goes through specialtyNoun /
 * specialtyNounPlural, and every mention of the cited median goes through
 * medianSentence. Both branch on `page.isNicheRole`, so a non-niche APRN
 * role (CRNA, CNM) can never be labelled with the niche token, and the
 * all-<niche> median can never be presented as that role's own pay.
 */
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import type { SpecialtyPremium, SpecialtySalaryPage } from './specialty-config';

// ─── Live-data shapes (filled by the page's DB queries) ─────────────────────

export interface SpecialtyLiveStats {
    avgSalary: number;
    minSalary: number;
    maxSalary: number;
    jobCount: number;
}

export interface SpecialtyStateRow {
    state: string;
    stateCode: string;
    /** Matches the /salary-guide/[state] + /jobs/<cat>/[state] slug shape. */
    slug: string;
    avgSalary: number;
    jobCount: number;
}

export interface SpecialtyExperienceRow {
    label: string;
    avgSalary: number;
    jobCount: number;
}

/** Minimum postings before a live aggregate is trustworthy enough to render. */
export const MIN_LIVE_JOBS = 3;
/** Minimum postings for a state row in the top-paying-states table. */
export const MIN_STATE_JOBS = 2;

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

/**
 * Midpoint of the disclosed salary bounds for an aggregate.
 *
 * Prisma's `_avg` skips nulls per column, so a set where no posting
 * discloses an upper bound yields `_avg.normalizedMaxSalary === null`.
 * Naively averaging `(min + max) / 2` with a `|| 0` fallback would then
 * HALVE the real figure and publish it as a salary — so only the bounds
 * that actually exist are averaged, and a set with no usable bound returns
 * 0 for callers to gate on (omit, never fabricate).
 */
export function averageOfBounds(avgMin: number | null, avgMax: number | null): number {
    const bounds = [avgMin, avgMax].filter((v): v is number => typeof v === 'number' && v > 0);
    if (bounds.length === 0) return 0;
    return Math.round(bounds.reduce((sum, v) => sum + v, 0) / bounds.length);
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

/** Human sentence fragment for an estimated range ("$142K–$155K per year"). */
function bandText(band: { min: number; max: number }): string {
    return `${formatSalary(band.min)}–${formatSalary(band.max)} per year`;
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
 * The sentence that carries the cited national median, split so surfaces
 * can emphasise the value while sharing one wording.
 *
 * On a niche-role page the median IS that page's cohort figure. On a
 * non-niche APRN page it is a neighbouring-market benchmark that EXCLUDES
 * the role, and must say so — otherwise the page (and its Article/FAQ
 * JSON-LD) reads as "a CRNA earns the all-NP median".
 */
export function medianSentenceParts(page: SpecialtySalaryPage): { lead: string; tail: string } {
    const short = brand.niche.short;
    const source = STAT_SOURCES.averageSalary.source;
    if (page.isNicheRole) {
        return {
            lead: `The national median across all ${short}s is `,
            tail: ` per year (${source}).`,
        };
    }
    return {
        lead: `${specialtyNounPlural(page)} are a distinct APRN role: the all-${short} median of `,
        tail:
            ` per year (${source}) does not include them, and is shown here only as a benchmark ` +
            `for the wider advanced-practice market.`,
    };
}

/** {@link medianSentenceParts} rendered as one plain string. */
export function medianSentence(page: SpecialtySalaryPage): string {
    const { lead, tail } = medianSentenceParts(page);
    return `${lead}${STAT_SOURCES.averageSalary.formatted}${tail}`;
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

export function buildSpecialtyFaqs(
    page: SpecialtySalaryPage,
    live: SpecialtyLiveStats | null,
    topStates: readonly SpecialtyStateRow[],
): SpecialtyFaq[] {
    const fpa = STAT_SOURCES.fullPracticeStates;
    const noun = page.credential ? `${page.credential}` : specialtyNoun(page);
    const faqs: SpecialtyFaq[] = [];

    // 1. Headline pay question — cited median + premium-derived range + live
    //    data. On a non-niche APRN page medianSentence says outright that the
    //    median excludes the role, and the only dollar figures that can
    //    follow are live board aggregates.
    const payParts: string[] = [medianSentence(page)];
    if (page.premium) {
        const r = premiumEstimateRange(page.premium);
        payParts.push(
            `${page.label} roles typically carry a +${page.premium.minPct}–${page.premium.maxPct}% premium over that median — an estimated ${bandText(r)}.`,
        );
    }
    if (!page.isNicheRole) {
        payParts.push(
            `${brand.name} publishes ${noun} pay only from live ${noun} postings that disclose salary — no national ${noun} wage figure is cited on this board.`,
        );
    }
    if (live && live.jobCount >= MIN_LIVE_JOBS && live.avgSalary > 0) {
        // The min–max spread is appended only when both bounds are real —
        // a set where no posting discloses an upper bound would otherwise
        // publish "range $98K–$0".
        const spread = hasReportedRange(live)
            ? ` (range ${formatSalary(live.minSalary)}–${formatSalary(live.maxSalary)})`
            : '';
        payParts.push(
            `Across ${live.jobCount} active ${noun} postings with disclosed pay on ${brand.name}, the average is ${formatSalary(live.avgSalary)} per year${spread}.`,
        );
    }
    faqs.push({ q: `How much does ${indefiniteArticle(page.role)} ${page.role} make?`, a: payParts.join(' ') });

    // 2. Premium driver (premium specialties only).
    if (page.premium) {
        faqs.push({
            q: `Why do ${specialtyNounPlural(page)} earn a premium?`,
            a: `The +${page.premium.minPct}–${page.premium.maxPct}% premium reflects: ${page.premium.driver}. Typical practice settings include ${settingsList(page.settings)}.`,
        });
    }

    // 3. Top-paying states — only when live data supports it.
    if (topStates.length >= 3) {
        const top3 = topStates
            .slice(0, 3)
            .map((s) => `${s.state} (${formatSalary(s.avgSalary)} average across ${s.jobCount} ${s.jobCount === 1 ? 'posting' : 'postings'})`)
            .join(', ');
        faqs.push({
            q: `Which states pay ${specialtyNounPlural(page)} the most?`,
            a: `Among current postings with disclosed salary on ${brand.name}, the top-paying states for ${page.label.toLowerCase()} roles are ${top3}. Rankings shift as new jobs are ingested daily.`,
        });
    }

    // 4. Certification — correct body per specialty (config-enforced).
    faqs.push({
        q: `What certification does ${indefiniteArticle(page.role)} ${page.role} need?`,
        a: `${page.certification}. State licensure requirements vary — check your state board of nursing for specifics.`,
    });

    // 5. Increasing pay — FPA stat is the only figure, and it is cited.
    faqs.push({
        q: `How can I increase my ${noun} salary?`,
        a: `Compare offers across practice settings (${settingsList(page.settings)}), consider states granting full practice authority (${fpa.formatted} per ${fpa.source}), and negotiate total compensation — base, bonuses, CME allowance, and loan-repayment support — rather than base salary alone.`,
    });

    return faqs;
}
