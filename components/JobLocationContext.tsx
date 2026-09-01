import Link from 'next/link';
import { ArrowRight, MapPinned, Scale, Wallet } from 'lucide-react';
import { brand } from '@/config/brand';
import { colAdjusted, NATIONAL_COL_INDEX } from '@/components/tools/col-model';
import { formatUsd } from '@/components/tools/tool-theme';
import { getCityByNameState } from '@/lib/pseo/city-data/cities';
import type { CityData } from '@/lib/pseo/city-data/types';
import {
    getStatePracticeAuthority,
    getAuthorityLabel,
    type StatePracticeInfo,
} from '@/lib/state-practice-authority';
import {
    isNpServableClass,
    type ProfessionClass,
} from '@/lib/profession-classifier';
import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    buildCitySlug,
    cityLinkResolves,
    MIN_CITY_JOBS_FOR_LINK,
} from '@/app/jobs/locations/[state]/directory';

/**
 * Per-job location context module (P5 A5 — competitive teardown).
 *
 * AANP's job detail pages carry an "Explore Location" panel; ours is built
 * strictly from data this repo already owns:
 *
 *   - Cost-of-living index: lib/pseo/city-data (4,135 cities, 100 = national
 *     average), resolved by (name, state) via getCityByNameState — never by
 *     bare city name (411 names are shared across states).
 *   - COL-adjusted pay: the SAME formula as the pSEO aggregation cron and the
 *     comparator tool (components/tools/col-model.ts `colAdjusted`), applied
 *     to the job's posted range. Jobs whose pay was inferred rather than
 *     posted (`salaryIsEstimated`) get NO adjusted figure — adjusting an
 *     invented number would publish an invented number.
 *   - Practice environment: lib/state-practice-authority.ts verbatim (the
 *     same strings the state hubs publish), attributed to AANP via
 *     STAT_SOURCES.fullPracticeStates.
 *
 * TRUTH RULES this module enforces:
 *   - No city match → the caller gets `null` and renders nothing. Never a
 *     guess, never a name-only fallback (cities.ts "never refill a null").
 *   - The /jobs/city link is DOUBLE-gated: `cityLinkResolves` (the lossy-slug
 *     round-trip guard) AND live inventory >= MIN_CITY_JOBS_FOR_LINK — the
 *     same pair every other surface uses, so we never link a page that
 *     notFound()s.
 *   - The comparator tool link is plain: app/tools/cost-of-living-comparison
 *     reads no searchParams and CostOfLivingComparator takes no URL params
 *     (checked 2026-08), so there is nothing to prefill. Do not add params
 *     here without adding support there first.
 *
 * The component is presentational; all decisions live in
 * `buildJobLocationContext` so they are unit-testable without a DB or a
 * component render (tests/regressions/p5-job-col-panel-location-context.test.ts).
 */

/**
 * Floor for treating a normalized salary as a plausible annual figure —
 * mirrors the `gte: 30000` guard getStateSalaryAverage applies on the same
 * columns in app/jobs/[slug]/page.tsx.
 */
export const MIN_PLAUSIBLE_ANNUAL_SALARY = 30000;

export interface JobLocationInput {
    city: string | null;
    /** Full state name as stored on job rows ("Texas"). */
    state: string | null;
    /** Two-letter state code as stored on job rows ("TX"). */
    stateCode: string | null;
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    /** True when the range was inferred/clamped rather than posted. */
    salaryIsEstimated: boolean;
    /**
     * Live-review fix #1 (profession conditioning): the job's profession
     * class — the stored column when present, else the caller's render-time
     * `classifyProfession(title, description)` result. Controls whether the
     * NP practice-authority row renders (np_eligible / aprn classes only —
     * a podiatrist or PA listing must not carry NP scope-of-practice
     * advice) and whether an honest APRN profession label accompanies it.
     * Omitted/null keeps the pre-classifier NP behavior (unclassifiable
     * rows keep their current rendering until the backfill stamps them).
     */
    professionClass?: ProfessionClass | null;
}

/** Honest profession labels for APRN classes served by design (review 1d). */
const APRN_PROFESSION_LABELS: Partial<Record<ProfessionClass, string>> = {
    aprn_midwife: 'Certified Nurse-Midwife (CNM)',
    aprn_crna: 'Certified Registered Nurse Anesthetist (CRNA)',
    aprn_cns: 'Clinical Nurse Specialist (CNS)',
};

/**
 * Note rendered with the practice-environment row for APRN (non-NP)
 * listings, so a CNM/CRNA/CNS role is labeled by its real profession
 * instead of being implicitly branded as an NP position. Null for
 * np_eligible / unclassified rows (no note needed) — and for non-NP
 * classes, where the authority row is suppressed entirely.
 */
export function buildProfessionNote(
    professionClass: ProfessionClass | null | undefined,
): string | null {
    const label = professionClass ? APRN_PROFESSION_LABELS[professionClass] : undefined;
    if (!label) return null;
    return `This listing is a ${label} role — an APRN profession in its own right, not a nurse practitioner position. The state practice rules below describe the NP practice environment.`;
}

export interface AdjustedSalaryContext {
    nominalMin: number;
    nominalMax: number;
    adjustedMin: number;
    adjustedMax: number;
}

export interface JobLocationContextModel {
    cityName: string;
    stateName: string;
    stateCode: string;
    colIndex: number;
    /** Rounded (colIndex − 100); positive = pricier than the national average. */
    colDeltaPct: number;
    /** Null when the job has no posted (non-estimated, plausible) range. */
    adjustedSalary: AdjustedSalaryContext | null;
    /**
     * Null for jurisdictions the practice-authority dataset does not cover —
     * and for listings classified as a non-NP profession, which must not
     * carry NP scope-of-practice advice (live-review fix #1).
     */
    authority: StatePracticeInfo | null;
    /**
     * Honest profession label note for APRN (CNM/CRNA/CNS) listings,
     * rendered with the authority row. Null/omitted for NP and
     * unclassified listings.
     */
    professionNote?: string | null;
    /** Null unless the city page both resolves AND clears the inventory gate. */
    cityJobsHref: string | null;
    stateJobsHref: string;
    salaryGuideHref: string;
    comparatorHref: string;
}

/**
 * Resolve the job's (city, state) against the city dataset. Tries the state
 * code first (the exact key), then the full state name — getCityByNameState
 * accepts either. Returns undefined rather than guessing.
 */
export function resolveJobCityRecord(
    city: string | null,
    stateCode: string | null,
    state: string | null,
): CityData | undefined {
    if (!city) return undefined;
    if (stateCode) {
        const byCode = getCityByNameState(city, stateCode);
        if (byCode) return byCode;
    }
    if (state) return getCityByNameState(city, state);
    return undefined;
}

/**
 * Build the render model, or null when the module should not render at all
 * (no dataset match, or a matched record without a usable COL index).
 *
 * @param cityJobCount live count of published jobs in this (city, state) —
 *        the same predicate app/jobs/city/[slug]'s getCityStats counts, so
 *        the link gate here equals the render gate there.
 */
export function buildJobLocationContext(
    input: JobLocationInput,
    cityJobCount: number,
): JobLocationContextModel | null {
    const record = resolveJobCityRecord(input.city, input.stateCode, input.state);
    if (!record) return null;

    const colIndex = record.costOfLivingIndex;
    // The COL index is the spine of this module; a record without a positive
    // index has nothing to contextualize. Omit rather than substitute.
    if (!(colIndex > 0)) return null;

    const { normalizedMinSalary: min, normalizedMaxSalary: max } = input;
    const hasPostedRange =
        !input.salaryIsEstimated &&
        typeof min === 'number' &&
        typeof max === 'number' &&
        min >= MIN_PLAUSIBLE_ANNUAL_SALARY &&
        max >= min;
    const adjustedSalary: AdjustedSalaryContext | null = hasPostedRange
        ? {
            nominalMin: min,
            nominalMax: max,
            adjustedMin: Math.round(colAdjusted(min, colIndex)),
            adjustedMax: Math.round(colAdjusted(max, colIndex)),
        }
        : null;

    const stateSlug = record.state.toLowerCase().replace(/\s+/g, '-');
    const canLinkCity =
        cityJobCount >= MIN_CITY_JOBS_FOR_LINK && cityLinkResolves(record.name, record.stateCode);

    return {
        cityName: record.name,
        stateName: record.state,
        stateCode: record.stateCode,
        colIndex,
        colDeltaPct: Math.round(colIndex - NATIONAL_COL_INDEX),
        adjustedSalary,
        // NP practice-authority advice renders only for NP/APRN listings
        // (NULL/undefined = unclassified = current behavior, per the
        // pre-backfill safety rule). Non-NP classes get no authority row.
        authority: isNpServableClass(input.professionClass ?? null)
            ? getStatePracticeAuthority(record.state)
            : null,
        professionNote: buildProfessionNote(input.professionClass),
        cityJobsHref: canLinkCity
            ? `/jobs/city/${buildCitySlug(record.name, record.stateCode)}`
            : null,
        stateJobsHref: `/jobs/state/${stateSlug}`,
        salaryGuideHref: `/salary-guide/${stateSlug}`,
        comparatorHref: '/tools/cost-of-living-comparison',
    };
}

/** One-line reading of the index, sign-aware. */
function colMeaningLine(model: JobLocationContextModel): string {
    const { cityName, colDeltaPct } = model;
    if (colDeltaPct === 0) {
        return `Living costs in ${cityName} are in line with the national average (index 100), per ${brand.name}'s city dataset.`;
    }
    const direction = colDeltaPct > 0 ? 'above' : 'below';
    return `Living costs in ${cityName} run about ${Math.abs(colDeltaPct)}% ${direction} the national average (100), per ${brand.name}'s city dataset.`;
}

const cardStyle: React.CSSProperties = {
    backgroundColor: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 12px rgba(0,0,0,0.06), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
    padding: '24px 28px',
    marginBottom: '20px',
};

const rowIconStyle: React.CSSProperties = {
    width: '34px',
    height: '34px',
    borderRadius: '11px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(190,24,93,0.08)',
    color: '#BE185D',
};

const AUTHORITY_COLORS: Record<StatePracticeInfo['authority'], string> = {
    full: '#047857',
    reduced: '#B45309',
    restricted: '#C2410C',
};

interface JobLocationContextProps {
    model: JobLocationContextModel;
}

export default function JobLocationContext({ model }: JobLocationContextProps) {
    const links: { href: string; label: string }[] = [
        ...(model.cityJobsHref
            ? [{ href: model.cityJobsHref, label: `${brand.niche.short} jobs in ${model.cityName}` }]
            : []),
        { href: model.stateJobsHref, label: `${brand.niche.short} jobs in ${model.stateName}` },
        { href: model.salaryGuideHref, label: `${model.stateName} salary guide` },
        { href: model.comparatorHref, label: 'Cost-of-living comparator' },
    ];

    return (
        <section aria-labelledby="job-location-context-heading" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={rowIconStyle} aria-hidden="true">
                    <MapPinned size={17} />
                </span>
                <h2
                    id="job-location-context-heading"
                    style={{
                        fontSize: '20px',
                        fontWeight: 700,
                        fontFamily: 'var(--font-lora), Georgia, serif',
                        color: 'var(--text-primary)',
                        margin: 0,
                    }}
                >
                    Working in {model.cityName}, {model.stateCode}
                </h2>
            </div>

            {/* ── Cost of living ── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
                <span style={rowIconStyle} aria-hidden="true">
                    <Wallet size={17} />
                </span>
                <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                        Cost-of-living index: {model.colIndex}
                        <span
                            style={{
                                marginLeft: '8px',
                                fontSize: '12px',
                                fontWeight: 700,
                                color: model.colDeltaPct > 0 ? '#B91C1C' : '#047857',
                            }}
                        >
                            {model.colDeltaPct > 0 ? '+' : ''}
                            {model.colDeltaPct}% vs national average
                        </span>
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                        {colMeaningLine(model)}
                    </p>
                    {model.adjustedSalary && (
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '6px 0 0', lineHeight: 1.55 }}>
                            Adjusted for local costs, this job&apos;s posted range of{' '}
                            {formatUsd(model.adjustedSalary.nominalMin)}–{formatUsd(model.adjustedSalary.nominalMax)} is
                            worth about{' '}
                            <strong style={{ color: 'var(--text-primary)' }}>
                                {formatUsd(model.adjustedSalary.adjustedMin)}–{formatUsd(model.adjustedSalary.adjustedMax)}
                            </strong>{' '}
                            in national-average dollars.
                        </p>
                    )}
                </div>
            </div>

            {/* ── Practice environment ── */}
            {model.authority && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                    <span style={rowIconStyle} aria-hidden="true">
                        <Scale size={17} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                        {model.professionNote && (
                            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px', lineHeight: 1.55 }}>
                                {model.professionNote}
                            </p>
                        )}
                        <p style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 2px', color: AUTHORITY_COLORS[model.authority.authority] }}>
                            {getAuthorityLabel(model.authority.authority)}
                        </p>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                            {model.authority.details}{' '}
                            <a
                                href={STAT_SOURCES.fullPracticeStates.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#BE185D', fontWeight: 600, textDecoration: 'underline' }}
                            >
                                Source: {STAT_SOURCES.fullPracticeStates.source}
                            </a>
                        </p>
                    </div>
                </div>
            )}

            {/* ── Explore links ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {links.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className="jlc-pill"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '8px 14px',
                            borderRadius: '18px',
                            background: '#FDF2F8',
                            color: '#BE185D',
                            fontSize: '12.5px',
                            fontWeight: 700,
                            textDecoration: 'none',
                        }}
                    >
                        {link.label} <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                ))}
            </div>
            <style>{`
                .jlc-pill { transition: transform 0.2s ease, background-color 0.2s ease; }
                .jlc-pill:hover { transform: translateY(-2px); background-color: #FCE7F3 !important; }
                .jlc-pill:active { transform: translateY(0); }
            `}</style>
        </section>
    );
}
