'use client';

/**
 * Private-practice revenue projector (P3 #6a) — client widget.
 *
 * Every default comes from ./practice-revenue-model.ts, which mirrors the
 * revenue model published on /resources/private-practice-guide. The two inputs
 * the guide has no figure for (no-show rate, fixed annual costs) start at zero
 * and are labelled "your assumption" in the UI, because the alternative is
 * inventing vendor pricing.
 *
 * ACCESSIBILITY / STABILITY
 *  - Every control is a labelled native input or select with an id, keyboard
 *    operable, with a hint wired through aria-describedby where the label alone
 *    is not enough.
 *  - The result region is always mounted, so changing an input never adds or
 *    removes a block above it. Only numbers change.
 *  - The headline figure announces politely.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Info } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, formatUsdK, labelStyle, selectStyle } from './tool-theme';
import {
    DEFAULT_SCENARIO_KEY,
    GUIDE_MODEL,
    GUIDE_SCENARIOS,
    PRACTICE_GUIDE_PATH,
    guideBand,
    oneMoreVisitPerWeek,
    presetFor,
    project,
    sensitivity,
    type ProjectorInputs,
    type SensitivityRow,
} from './practice-revenue-model';

/** Inputs held as strings so a field can be emptied without snapping to 0. */
type InputDraft = Record<keyof ProjectorInputs, string>;

const DEFAULT_SCENARIO =
    GUIDE_SCENARIOS.find((scenario) => scenario.key === DEFAULT_SCENARIO_KEY) ?? GUIDE_SCENARIOS[0];

function toDraft(inputs: ProjectorInputs): InputDraft {
    return {
        visitsPerWeek: String(inputs.visitsPerWeek),
        weeksPerYear: String(inputs.weeksPerYear),
        collectedPerVisit: String(inputs.collectedPerVisit),
        overheadPct: String(Math.round(inputs.overheadPct * 10) / 10),
        noShowPct: String(inputs.noShowPct),
        fixedAnnualCosts: String(inputs.fixedAnnualCosts),
    };
}

const num = (raw: string): number => {
    const parsed = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

function fromDraft(draft: InputDraft): ProjectorInputs {
    return {
        visitsPerWeek: num(draft.visitsPerWeek),
        weeksPerYear: num(draft.weeksPerYear),
        collectedPerVisit: num(draft.collectedPerVisit),
        overheadPct: num(draft.overheadPct),
        noShowPct: num(draft.noShowPct),
        fixedAnnualCosts: num(draft.fixedAnnualCosts),
    };
}

const pctLabel = (step: number): string => `${step > 0 ? '+' : ''}${Math.round(step * 100)}%`;

/** One decimal at most, no trailing .0 — sensitivity steps land on fractions. */
const trim = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * A sensitivity driver's value WITH ITS UNIT.
 *
 * The column headers are relative moves (+20% means the input is 20% higher than
 * you entered it), which is ambiguous for the overhead row on its own: +20% on a
 * 20%-of-collections overhead share is 24%, not 40%. Rendering the actual value
 * the model used removes the ambiguity instead of explaining it away.
 */
function driverValueLabel(driver: SensitivityRow['driver'], value: number): string {
    if (driver === 'collectedPerVisit') return formatUsd(value);
    if (driver === 'overheadPct') return `${trim(value)}% of collections`;
    return `${trim(value)} visits/wk`;
}

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
                    style={{
                        ...controlStyle,
                        paddingLeft: prefix ? '28px' : '14px',
                        paddingRight: suffix ? '34px' : '14px',
                    }}
                />
                {suffix && (
                    <span aria-hidden="true" style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', fontWeight: 600, color: '#94A3B8' }}>
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

export default function PracticeRevenueProjector() {
    const [scenarioKey, setScenarioKey] = useState(DEFAULT_SCENARIO.key);
    const [draft, setDraft] = useState<InputDraft>(() => toDraft(presetFor(DEFAULT_SCENARIO)));

    const scenario = GUIDE_SCENARIOS.find((s) => s.key === scenarioKey) ?? DEFAULT_SCENARIO;
    const inputs = useMemo(() => fromDraft(draft), [draft]);
    const result = useMemo(() => project(inputs), [inputs]);
    const rows = useMemo(() => sensitivity(inputs), [inputs]);
    const perExtraVisit = useMemo(() => oneMoreVisitPerWeek(inputs), [inputs]);
    const band = useMemo(() => guideBand(scenario), [scenario]);

    /**
     * Live worked example for the "relative move, not percentage points" note —
     * built from the overhead row the table is about to render, so it always uses
     * the reader's own overhead share and cannot drift from the step ladder.
     */
    const overheadRow = rows.find((row) => row.driver === 'overheadPct');
    const overheadUp = overheadRow?.points[overheadRow.points.length - 1];

    const set = (key: keyof InputDraft) => (next: string) =>
        setDraft((current) => ({ ...current, [key]: next }));

    const applyScenario = (key: string) => {
        const next = GUIDE_SCENARIOS.find((s) => s.key === key);
        if (!next) return;
        setScenarioKey(key);
        setDraft(toDraft(presetFor(next)));
    };

    return (
        <div style={{ ...clayCard, padding: '28px 26px 24px' }}>
            <ToolStyles />

            {/* Illustration notice — first thing in the widget, not a footnote. */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: '#FFFBEB', border: '1.5px solid rgba(217,119,6,0.22)', marginBottom: '22px' }}>
                <AlertTriangle size={16} color="#B45309" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '12.5px', color: '#78350F', margin: 0, lineHeight: 1.6 }}>
                    <strong>This is an illustration of arithmetic, not a financial projection.</strong> It multiplies
                    the volume and per-visit collections you enter and subtracts the overhead you enter. It knows
                    nothing about your payer contracts, your market, or your ramp — and the sensitivity table below
                    exists to show how much the answer moves when those inputs are wrong.
                </p>
            </div>

            {/* Preset */}
            <div style={{ marginBottom: '18px' }}>
                <label htmlFor="practice-scenario" style={labelStyle}>Start from a published scenario</label>
                <select
                    id="practice-scenario"
                    className="tool-control"
                    value={scenarioKey}
                    aria-describedby="practice-scenario-hint"
                    onChange={(event) => applyScenario(event.target.value)}
                    style={selectStyle}
                >
                    {GUIDE_SCENARIOS.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                </select>
                <p id="practice-scenario-hint" style={{ fontSize: '11.5px', color: '#94A3B8', margin: '5px 0 0', lineHeight: 1.45 }}>
                    Loads the midpoint of that scenario&rsquo;s published volume and overhead bands. Selecting a
                    scenario overwrites the fields below — then change whatever you like.
                </p>
            </div>

            {/* Controls */}
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '14px', marginBottom: '10px' }}>
                <NumberField
                    id="practice-visits"
                    label="Scheduled visits per week"
                    hint={`Guide band for ${scenario.label.toLowerCase()}: ${scenario.visitsPerWeek.min}–${scenario.visitsPerWeek.max}.`}
                    value={draft.visitsPerWeek}
                    onChange={set('visitsPerWeek')}
                />
                <NumberField
                    id="practice-weeks"
                    label="Working weeks per year"
                    hint={`Guide default: ${GUIDE_MODEL.workingWeeksPerYear} — 52 less about six for holidays, vacation, and admin days.`}
                    value={draft.weeksPerYear}
                    onChange={set('weeksPerYear')}
                />
                <NumberField
                    id="practice-collected"
                    label="Collected per completed visit"
                    hint={`What you COLLECT, not what you bill. Guide planning inputs: $${GUIDE_MODEL.insuranceCollectedPerVisit} insurance, $${GUIDE_MODEL.cashCollectedPerVisit} cash-pay. Replace with your contracted rates.`}
                    value={draft.collectedPerVisit}
                    prefix="$"
                    step={5}
                    onChange={set('collectedPerVisit')}
                />
                <NumberField
                    id="practice-overhead"
                    label="Overhead, share of collections"
                    hint={`Guide band for ${scenario.label.toLowerCase()}: ${Math.round(scenario.overhead.min * 100)}–${Math.round(scenario.overhead.max * 100)}%. Covers the costs that scale with volume.`}
                    value={draft.overheadPct}
                    suffix="%"
                    onChange={set('overheadPct')}
                />
                <NumberField
                    id="practice-noshow"
                    label="No-shows and late cancellations"
                    hint="Your assumption — we publish no figure for this. Starts at 0, which assumes every scheduled visit completes."
                    value={draft.noShowPct}
                    suffix="%"
                    onChange={set('noShowPct')}
                />
                <NumberField
                    id="practice-fixed"
                    label="Fixed annual costs on top"
                    hint="Your assumption — a lease, a specific EHR or billing contract. Starts at 0 because vendor pricing changes and we will not print a figure that expires."
                    value={draft.fixedAnnualCosts}
                    prefix="$"
                    step={1000}
                    onChange={set('fixedAnnualCosts')}
                />
            </div>

            {/* Headline */}
            <div style={{ padding: '20px 22px', borderRadius: '16px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '1.5px solid rgba(190,24,93,0.14)', margin: '18px 0 14px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 3px' }}>
                    Modelled net before tax
                </p>
                <div aria-live="polite" style={{ fontSize: '34px', fontWeight: 800, color: '#831843', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
                    {formatUsd(result.netBeforeTax)}
                </div>
                <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.6 }}>
                    From {Math.round(result.completedVisits).toLocaleString('en-US')} completed visits and{' '}
                    <strong>{formatUsd(result.grossCollections)}</strong> of gross collections, less{' '}
                    {formatUsd(result.totalCosts)} of costs ({Math.round(result.totalCostPctOfGross)}% of
                    collections). Before self-employment tax and income tax.
                </p>
            </div>

            {/* Breakdown */}
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '10px', marginBottom: '14px' }}>
                {[
                    { label: 'Gross collections', value: formatUsd(result.grossCollections) },
                    { label: 'Overhead', value: `− ${formatUsd(result.overheadCost)}` },
                    { label: 'Fixed costs', value: `− ${formatUsd(result.fixedCosts)}` },
                    { label: 'Net per completed visit', value: formatUsd(result.netPerCompletedVisit) },
                ].map((cell) => (
                    <div key={cell.label} style={{ padding: '13px 15px', borderRadius: '12px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.05)' }}>
                        <p style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>
                            {cell.label}
                        </p>
                        <p style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {cell.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Published band for the selected scenario */}
            <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', marginBottom: '18px' }}>
                <Info size={15} color="#64748B" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                    Our{' '}
                    <Link href={PRACTICE_GUIDE_PATH} className="tool-link" style={{ color: TOOL_ACCENT, fontWeight: 700, textDecoration: 'none' }}>
                        private practice guide
                    </Link>{' '}
                    publishes {scenario.label.toLowerCase()} as {formatUsdK(band.grossMin)}–{formatUsdK(band.grossMax)}{' '}
                    gross and {formatUsdK(band.netMin)}–{formatUsdK(band.netMax)} net, pairing its lowest volume with
                    its highest overhead and vice versa. The figure above is a single point inside that method — the
                    preset loads the midpoint of both bands.
                </p>
            </div>

            {/* Sensitivity */}
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 4px' }}>
                How wrong can this be?
            </h3>
            <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: '0 0 12px', lineHeight: 1.55 }}>
                Each row moves one input and holds the rest. The column headings are moves relative to the value you
                entered, <strong>not percentage points</strong>
                {overheadRow && overheadUp && overheadRow.baseValue > 0 && (
                    <>
                        {' '}— on your {trim(overheadRow.baseValue)}% overhead share, the{' '}
                        {pctLabel(overheadUp.step)} column is {trim(overheadUp.value)}% of collections, not{' '}
                        {trim(overheadRow.baseValue + overheadUp.step * 100)}%
                    </>
                )}
                . Each cell prints the value the model actually used underneath the net it produced. The swing column
                is what that single input is worth to your net across the range; the largest swing is the number to go
                and verify first.
            </p>
            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '520px' }}>
                    <caption style={{ captionSide: 'bottom', textAlign: 'left', fontSize: '11.5px', color: '#94A3B8', paddingTop: '8px' }}>
                        Modelled net before tax when one input moves and the others hold.
                    </caption>
                    <thead>
                        <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.08)' }}>
                            <th scope="col" style={{ textAlign: 'left', padding: '8px 10px 8px 0', fontWeight: 700, color: '#334155' }}>Input</th>
                            {rows[0]?.points.map((point) => (
                                <th key={point.step} scope="col" style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: '#334155' }}>
                                    {pctLabel(point.step)}
                                </th>
                            ))}
                            <th scope="col" style={{ textAlign: 'right', padding: '8px 0 8px 10px', fontWeight: 700, color: TOOL_ACCENT }}>Swing</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.driver} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                <th scope="row" style={{ textAlign: 'left', padding: '10px 10px 10px 0', fontWeight: 700, color: '#1A2E35' }}>
                                    {row.label}
                                    <span style={{ display: 'block', fontWeight: 600, fontSize: '11px', color: '#94A3B8' }}>
                                        you entered {driverValueLabel(row.driver, row.baseValue)}
                                    </span>
                                </th>
                                {row.points.map((point) => (
                                    <td key={point.step} style={{ textAlign: 'right', padding: '10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                                        {formatUsdK(point.net)}
                                        <span style={{ display: 'block', fontSize: '11px', color: '#94A3B8' }}>
                                            at {driverValueLabel(row.driver, point.value)}
                                        </span>
                                    </td>
                                ))}
                                <td style={{ textAlign: 'right', padding: '10px 0 10px 10px', fontWeight: 800, color: '#831843', fontVariantNumeric: 'tabular-nums' }}>
                                    {formatUsdK(row.swing)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: '13px', color: '#5A4A42', margin: '0 0 16px', lineHeight: 1.6, padding: '13px 15px', borderRadius: '12px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.05)' }}>
                One more scheduled visit a week, all else equal, is worth{' '}
                <strong>{formatUsd(perExtraVisit)}</strong> a year at these inputs. That is the number to hold your
                caseload plan against.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px' }}>
                <Link
                    href={PRACTICE_GUIDE_PATH}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: TOOL_ACCENT, color: '#fff', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    Read the full startup guide <ArrowRight size={14} />
                </Link>
                <Link
                    href="/tools/1099-vs-w2-calculator"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: '#EEF2FF', color: '#4338CA', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    What comes off after tax <ArrowRight size={14} />
                </Link>
            </div>
        </div>
    );
}
