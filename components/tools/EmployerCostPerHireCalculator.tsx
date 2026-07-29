'use client';

/**
 * Employer cost-per-hire calculator (P3 #6b) — client widget.
 *
 * The only pre-filled prices are ours, and they come from lib/config via
 * ./cost-per-hire-model.ts. Every alternative channel starts empty and reports
 * "not comparable" until the employer enters their own numbers — a zero would
 * render as free, and a made-up benchmark on a page that concludes our product
 * is cheaper would be indefensible.
 *
 * ACCESSIBILITY / STABILITY
 *  - Labelled native inputs with ids, keyboard operable, hints wired through
 *    aria-describedby.
 *  - The results table is always mounted with all three channel rows present,
 *    so entering a number changes cell contents and never the page layout.
 *  - The headline cost per hire announces politely.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Info, ShieldCheck } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, labelStyle } from './tool-theme';
import {
    DEFAULT_INPUTS,
    FIRST_YEAR_BASE_SOURCE,
    FLAT_FEE_COST_PER_DAY,
    FLAT_FEE_PRICING,
    FREE_POST_SCOPE_NOTE,
    compareChannels,
    flatFeeCostPerHire,
    flatFeeSpend,
    rankByCostPerHire,
    type CostPerHireInputs,
} from './cost-per-hire-model';

type NumericKey = Exclude<keyof CostPerHireInputs, 'useFreeFirstPost'>;
type Draft = Record<NumericKey, string>;

function toDraft(inputs: CostPerHireInputs): Draft {
    return {
        roles: String(inputs.roles),
        renewalsPerRole: String(inputs.renewalsPerRole),
        hiresPerRole: String(inputs.hiresPerRole),
        flatFeeApplicantsPerRole: String(inputs.flatFeeApplicantsPerRole),
        flatFeeTimeToFillDays: String(inputs.flatFeeTimeToFillDays),
        cpcSpendPerRole: String(inputs.cpcSpendPerRole),
        cpcApplicantsPerRole: String(inputs.cpcApplicantsPerRole),
        cpcTimeToFillDays: String(inputs.cpcTimeToFillDays),
        agencyFeePct: String(inputs.agencyFeePct),
        firstYearBase: String(inputs.firstYearBase),
        agencyTimeToFillDays: String(inputs.agencyTimeToFillDays),
        dailyVacancyCost: String(inputs.dailyVacancyCost),
    };
}

const num = (raw: string): number => {
    const parsed = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

interface FieldProps {
    id: string;
    label: string;
    hint: string;
    value: string;
    prefix?: string;
    suffix?: string;
    step?: number;
    onChange: (next: string) => void;
}

function NumberField({ id, label, hint, value, prefix, suffix, step = 1, onChange }: FieldProps) {
    const hintId = `${id}-hint`;
    return (
        <div>
            <label htmlFor={id} style={labelStyle}>{label}</label>
            <div style={{ position: 'relative' }}>
                {prefix && (
                    <span aria-hidden="true" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', fontWeight: 600, color: '#94A3B8' }}>
                        {prefix}
                    </span>
                )}
                <input
                    id={id}
                    className="tool-control"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={step}
                    value={value}
                    aria-describedby={hintId}
                    onChange={(event) => onChange(event.target.value)}
                    style={{ ...controlStyle, paddingLeft: prefix ? '28px' : '14px', paddingRight: suffix ? '34px' : '14px' }}
                />
                {suffix && (
                    <span aria-hidden="true" style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', fontWeight: 600, color: '#94A3B8' }}>
                        {suffix}
                    </span>
                )}
            </div>
            <p id={hintId} style={{ fontSize: '11.5px', color: '#94A3B8', margin: '5px 0 0', lineHeight: 1.45 }}>
                {hint}
            </p>
        </div>
    );
}

const groupHeading = {
    fontSize: '13px',
    fontWeight: 800,
    color: '#1A2E35',
    margin: '0 0 3px',
} as const;

const groupNote = {
    fontSize: '12px',
    color: '#7A6A62',
    margin: '0 0 12px',
    lineHeight: 1.5,
} as const;

const twoCol = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
    gap: '14px',
} as const;

export default function EmployerCostPerHireCalculator() {
    const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_INPUTS));
    const [useFreeFirstPost, setUseFreeFirstPost] = useState(DEFAULT_INPUTS.useFreeFirstPost);

    const inputs = useMemo<CostPerHireInputs>(
        () => ({
            roles: num(draft.roles),
            renewalsPerRole: num(draft.renewalsPerRole),
            useFreeFirstPost,
            hiresPerRole: num(draft.hiresPerRole),
            flatFeeApplicantsPerRole: num(draft.flatFeeApplicantsPerRole),
            flatFeeTimeToFillDays: num(draft.flatFeeTimeToFillDays),
            cpcSpendPerRole: num(draft.cpcSpendPerRole),
            cpcApplicantsPerRole: num(draft.cpcApplicantsPerRole),
            cpcTimeToFillDays: num(draft.cpcTimeToFillDays),
            agencyFeePct: num(draft.agencyFeePct),
            firstYearBase: num(draft.firstYearBase),
            agencyTimeToFillDays: num(draft.agencyTimeToFillDays),
            dailyVacancyCost: num(draft.dailyVacancyCost),
        }),
        [draft, useFreeFirstPost],
    );

    const results = useMemo(() => compareChannels(inputs), [inputs]);
    const flat = useMemo(() => flatFeeSpend(inputs), [inputs]);
    const ourCostPerHire = flatFeeCostPerHire(results);
    const ranked = rankByCostPerHire(results);
    const vacancyOn = inputs.dailyVacancyCost > 0;

    const set = (key: NumericKey) => (next: string) =>
        setDraft((current) => ({ ...current, [key]: next }));

    return (
        <div style={{ ...clayCard, padding: '28px 26px 24px' }}>
            <ToolStyles />

            {/* Whose tool this is. Stated first, not buried. */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: '#EEF2FF', border: '1.5px solid rgba(67,56,202,0.18)', marginBottom: '22px' }}>
                <ShieldCheck size={16} color="#4338CA" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '12.5px', color: '#312E81', margin: 0, lineHeight: 1.6 }}>
                    <strong>We sell job postings, so here is how this stays honest.</strong> The only prices filled in
                    for you are ours, and they are the prices our checkout actually charges. We publish no benchmark
                    for what a sponsored click, an agency fee, or a time-to-fill &ldquo;usually&rdquo; costs — every
                    figure in the other two columns is one you enter from your own invoices, and a column with nothing
                    entered says so instead of showing a zero.
                </p>
            </div>

            {/* Hiring plan */}
            <h3 style={groupHeading}>Your hiring plan</h3>
            <p style={groupNote}>Applies to every channel — the same roles filled three different ways.</p>
            <div className="tool-two-col" style={{ ...twoCol, marginBottom: '10px' }}>
                <NumberField
                    id="cph-roles"
                    label="Roles to fill"
                    hint="How many openings this plan covers."
                    value={draft.roles}
                    onChange={set('roles')}
                />
                <NumberField
                    id="cph-hires"
                    label="Hires per role"
                    hint="Usually 1. Raise it if one posting reliably fills several seats."
                    value={draft.hiresPerRole}
                    onChange={set('hiresPerRole')}
                />
            </div>

            {/* Flat fee */}
            <h3 style={{ ...groupHeading, marginTop: '20px' }}>Flat-fee posting on {brand.name}</h3>
            <p style={groupNote}>
                {formatUsd(FLAT_FEE_PRICING.postingPrice)} per post for {FLAT_FEE_PRICING.paidDurationDays} days
                ({formatUsd(FLAT_FEE_COST_PER_DAY)} a day), {formatUsd(FLAT_FEE_PRICING.renewalPrice)} to renew,
                and {FLAT_FEE_PRICING.candidateUnlocksPerPosting} candidate unlocks plus{' '}
                {FLAT_FEE_PRICING.inmailsPerPosting} direct messages included. Your organization&rsquo;s first post is
                free for {FLAT_FEE_PRICING.freeDurationDays} days: {FREE_POST_SCOPE_NOTE}.
            </p>
            <div className="tool-two-col" style={{ ...twoCol, marginBottom: '10px' }}>
                <NumberField
                    id="cph-flat-applicants"
                    label="Applicants per role you expect"
                    hint={`Starts at ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} because that is how many candidate unlocks a posting includes — a plan feature, not a benchmark. Replace it with what your postings actually draw.`}
                    value={draft.flatFeeApplicantsPerRole}
                    onChange={set('flatFeeApplicantsPerRole')}
                />
                <NumberField
                    id="cph-renewals"
                    label="Renewals per role"
                    hint={`Each renewal adds ${formatUsd(FLAT_FEE_PRICING.renewalPrice)} and another ${FLAT_FEE_PRICING.paidDurationDays} days.`}
                    value={draft.renewalsPerRole}
                    onChange={set('renewalsPerRole')}
                />
            </div>
            <label
                htmlFor="cph-free-post"
                style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px 14px', borderRadius: '12px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.06)', marginBottom: '10px' }}
            >
                <input
                    id="cph-free-post"
                    className="tool-control"
                    type="checkbox"
                    checked={useFreeFirstPost}
                    onChange={(event) => setUseFreeFirstPost(event.target.checked)}
                    style={{ width: '17px', height: '17px', flexShrink: 0, marginTop: '1px', accentColor: TOOL_ACCENT, padding: 0 }}
                />
                <span style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                    Apply the free first post — {FREE_POST_SCOPE_NOTE}. Uncheck it if a colleague at your domain has
                    already used it, because the quota does not reset for each new recruiter who signs up. With it
                    applied, a single-role plan costs nothing on our side, which is a real price and not a comparison.
                </span>
            </label>

            {/* CPC */}
            <h3 style={{ ...groupHeading, marginTop: '20px' }}>Sponsored / cost-per-click, from your invoice</h3>
            <p style={groupNote}>Leave at zero to leave this channel out of the comparison.</p>
            <div className="tool-two-col" style={{ ...twoCol, marginBottom: '10px' }}>
                <NumberField
                    id="cph-cpc-spend"
                    label="Sponsored spend per role"
                    hint="Total you spent on paid clicks for one comparable role. Read it off the invoice rather than estimating."
                    value={draft.cpcSpendPerRole}
                    prefix="$"
                    step={50}
                    onChange={set('cpcSpendPerRole')}
                />
                <NumberField
                    id="cph-cpc-applicants"
                    label="Applicants that spend produced"
                    hint="Completed applications, not clicks or impressions — your ATS knows this number."
                    value={draft.cpcApplicantsPerRole}
                    onChange={set('cpcApplicantsPerRole')}
                />
            </div>

            {/* Agency */}
            <h3 style={{ ...groupHeading, marginTop: '20px' }}>Agency / contingency search, from your agreement</h3>
            <p style={groupNote}>Leave the rate at zero to leave this channel out of the comparison.</p>
            <div className="tool-two-col" style={{ ...twoCol, marginBottom: '10px' }}>
                <NumberField
                    id="cph-agency-pct"
                    label="Contingency rate"
                    hint="The percentage of first-year base in your signed agreement. We publish no typical rate — this has to come from your paperwork."
                    value={draft.agencyFeePct}
                    suffix="%"
                    onChange={set('agencyFeePct')}
                />
                <NumberField
                    id="cph-base"
                    label="First-year base salary"
                    hint={`Starts at the cited national median (${FIRST_YEAR_BASE_SOURCE}). Replace it with your budgeted base.`}
                    value={draft.firstYearBase}
                    prefix="$"
                    step={1000}
                    onChange={set('firstYearBase')}
                />
            </div>

            {/* Vacancy overlay */}
            <h3 style={{ ...groupHeading, marginTop: '20px' }}>Optional: what the vacancy itself costs</h3>
            <p style={groupNote}>
                Zero by default, which switches the overlay off entirely. Only you know what an unfilled seat costs
                per day — coverage, lost visit revenue, overtime — and we will not guess it for you. The three
                time-to-fill fields start at our {FLAT_FEE_PRICING.paidDurationDays}-day posting window, which is a
                product fact rather than a market average, and the same number for all three channels so the default
                cannot favour one.
            </p>
            <div className="tool-two-col" style={{ ...twoCol, marginBottom: '10px' }}>
                <NumberField
                    id="cph-vacancy-cost"
                    label="Cost per day unfilled"
                    hint="Coverage, lost revenue, or overtime for one open seat, per day."
                    value={draft.dailyVacancyCost}
                    prefix="$"
                    step={50}
                    onChange={set('dailyVacancyCost')}
                />
                <NumberField
                    id="cph-flat-ttf"
                    label="Time-to-fill — flat-fee posting"
                    hint="Days from posting to accepted offer, on your own history."
                    value={draft.flatFeeTimeToFillDays}
                    suffix="days"
                    onChange={set('flatFeeTimeToFillDays')}
                />
                <NumberField
                    id="cph-cpc-ttf"
                    label="Time-to-fill — sponsored"
                    hint="Days from launching the campaign to accepted offer."
                    value={draft.cpcTimeToFillDays}
                    suffix="days"
                    onChange={set('cpcTimeToFillDays')}
                />
                <NumberField
                    id="cph-agency-ttf"
                    label="Time-to-fill — agency"
                    hint="Days from engaging the agency to accepted offer."
                    value={draft.agencyTimeToFillDays}
                    suffix="days"
                    onChange={set('agencyTimeToFillDays')}
                />
            </div>

            {/* Headline */}
            <div style={{ padding: '20px 22px', borderRadius: '16px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '1.5px solid rgba(190,24,93,0.14)', margin: '18px 0 14px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 3px' }}>
                    Your cost per hire, flat-fee posting
                </p>
                <div aria-live="polite" style={{ fontSize: '34px', fontWeight: 800, color: '#831843', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
                    {ourCostPerHire === null ? '—' : formatUsd(ourCostPerHire)}
                </div>
                <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.6 }}>
                    {flat.freePostings > 0 && `${flat.freePostings} free post, `}
                    {flat.paidPostings} paid {flat.paidPostings === 1 ? 'post' : 'posts'} at{' '}
                    {formatUsd(FLAT_FEE_PRICING.postingPrice)} and {flat.renewals}{' '}
                    {flat.renewals === 1 ? 'renewal' : 'renewals'} at {formatUsd(FLAT_FEE_PRICING.renewalPrice)} —{' '}
                    <strong>{formatUsd(flat.total)}</strong> total.
                    {ourCostPerHire !== null && ourCostPerHire > 0 && (
                        <>
                            {' '}On your numbers, any channel costing more than{' '}
                            <strong>{formatUsd(ourCostPerHire)}</strong> per hire is the more expensive option.
                        </>
                    )}
                    {ourCostPerHire === 0 && (
                        <>
                            {' '}That is the free first post doing the work — it is a real price, but it is a one-off
                            for your whole organization rather than a rate, so model your second role too.
                        </>
                    )}
                </p>
            </div>

            {/* Comparison table */}
            <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '620px' }}>
                    <caption style={{ captionSide: 'bottom', textAlign: 'left', fontSize: '11.5px', color: '#94A3B8', paddingTop: '8px' }}>
                        Cost per hire by channel. Flat-fee figures are priced from our published rates; the other two
                        rows use only the numbers you entered.
                    </caption>
                    <thead>
                        <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.08)' }}>
                            <th scope="col" style={{ textAlign: 'left', padding: '8px 10px 8px 0', fontWeight: 700, color: '#334155' }}>Channel</th>
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: '#334155' }}>Spend</th>
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: '#334155' }}>Applicants</th>
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: '#334155' }}>Per applicant</th>
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: TOOL_ACCENT }}>Per hire</th>
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 0 8px 10px', fontWeight: 700, color: '#334155' }}>
                                {vacancyOn ? 'Per hire + vacancy' : 'Per hire + vacancy (off)'}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((result) => (
                            <tr key={result.key} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                <th scope="row" style={{ textAlign: 'left', padding: '11px 10px 11px 0', fontWeight: 700, color: '#1A2E35' }}>
                                    {result.label}
                                </th>
                                {result.isComparable ? (
                                    <>
                                        <td style={{ textAlign: 'right', padding: '11px 10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                                            {formatUsd(result.totalSpend)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '11px 10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                                            {result.totalApplicants > 0 ? Math.round(result.totalApplicants).toLocaleString('en-US') : '—'}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '11px 10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                                            {result.costPerApplicant === null ? '—' : formatUsd(result.costPerApplicant)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '11px 10px', fontWeight: 800, color: '#831843', fontVariantNumeric: 'tabular-nums' }}>
                                            {result.costPerHire === null ? '—' : formatUsd(result.costPerHire)}
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '11px 0 11px 10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                                            {vacancyOn && result.costPerHireWithVacancy !== null
                                                ? formatUsd(result.costPerHireWithVacancy)
                                                : '—'}
                                        </td>
                                    </>
                                ) : (
                                    <td colSpan={5} style={{ textAlign: 'left', padding: '11px 10px', color: '#94A3B8' }}>
                                        Not comparable — {result.missingInput}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {ranked.length > 1 && (
                <p aria-live="polite" style={{ fontSize: '13px', color: '#5A4A42', margin: '0 0 14px', lineHeight: 1.6, padding: '13px 15px', borderRadius: '12px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.05)' }}>
                    On the numbers you entered, <strong>{ranked[0].label.toLowerCase()}</strong> comes out cheapest per
                    hire at {formatUsd(ranked[0].costPerHire as number)}, and{' '}
                    <strong>{ranked[ranked.length - 1].label.toLowerCase()}</strong> most expensive at{' '}
                    {formatUsd(ranked[ranked.length - 1].costPerHire as number)}. That is a statement about your
                    inputs, not about the channels in general.
                </p>
            )}

            <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                <Info size={15} color="#64748B" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                    Cost per hire is spend divided by hires, and nothing else. It says nothing about candidate quality,
                    retention, or the recruiter time each channel consumes — an agency fee buys screening work that a
                    posting does not, and this comparison cannot price that. Weigh it alongside the number, not
                    against it.
                </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px' }}>
                <Link
                    href="/post-job"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: TOOL_ACCENT, color: '#fff', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    Post a role <ArrowRight size={14} />
                </Link>
                <Link
                    href="/pricing"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: '#EEF2FF', color: '#4338CA', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    Full pricing <ArrowRight size={14} />
                </Link>
                <Link
                    href="/tools/salary-benchmark"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: '#F1F5F9', color: '#334155', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    Check your pay range <ArrowRight size={14} />
                </Link>
            </div>
        </div>
    );
}
