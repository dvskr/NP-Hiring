'use client';

/**
 * 1099 vs W-2 take-home calculator (P2 #4).
 *
 * All arithmetic lives in ./take-home-model.ts and all rates live in
 * ./federal-tax-model.ts — this component only collects inputs and renders.
 *
 * TRUTH RULES honoured here:
 *  - The starting numbers are PLACEHOLDERS, labelled as such in the UI. The
 *    two salary placeholders derive from config/niche/salary.ts (this board's
 *    typical W-2 band), never from an invented survey figure.
 *  - The tax-year model, its sources, and its exclusions render on the page
 *    (see AssumptionsPanel on the route) and come from the same module the
 *    math uses.
 *
 * Accessibility: every control has a visible <label htmlFor>, hints are wired
 * with aria-describedby, and the results region is always mounted (it renders
 * from deterministic defaults on first paint) so nothing shifts when a value
 * changes. The live total is announced politely.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Briefcase, Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { salaryConfig } from '@/config/niche/salary';
import { brand } from '@/config/brand';
import {
  FILING_STATUS_LABELS,
  TAX_MODEL_YEAR,
  type FilingStatus,
} from './federal-tax-model';
import { computeTakeHome, type TakeHomeInputs } from './take-home-model';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, controlStyle, labelStyle, selectStyle, formatUsd } from './tool-theme';

/* ── Placeholder starting values ────────────────────────────────────────────
   Both pay placeholders derive from the board's typical W-2 band in
   config/niche/salary.ts: the W-2 field starts at the band midpoint, and the
   contract field starts at the band's top annualised over the config's
   standard work year. Cost placeholders are round planning numbers the user
   is told to replace — they are inputs, not published statistics. */
const TYPICAL_BAND = salaryConfig.normalizer.typical;
const DEFAULT_W2_SALARY = Math.round((TYPICAL_BAND.min + TYPICAL_BAND.max) / 2);
const DEFAULT_HOURLY_RATE = Math.round(TYPICAL_BAND.max / salaryConfig.hoursPerYear);

const DEFAULTS: TakeHomeInputs = {
  filingStatus: 'single',
  hoursPerWeek: 40,
  paidDaysOff: 25,
  w2Salary: DEFAULT_W2_SALARY,
  w2EmployerMatchPct: 3,
  w2EmployeePremium: 2_400,
  contractHourlyRate: DEFAULT_HOURLY_RATE,
  contractBusinessExpenses: 6_000,
  contractHealthPremium: 9_000,
  contractRetirement: 6_000,
};

/** Field metadata drives both the form and the reset behaviour. */
type NumericField = Exclude<keyof TakeHomeInputs, 'filingStatus'>;

interface FieldDef {
  key: NumericField;
  label: string;
  hint: string;
  prefix?: string;
  suffix?: string;
  step: number;
}

const SHARED_FIELDS: readonly FieldDef[] = [
  { key: 'hoursPerWeek', label: 'Hours worked per week', hint: 'Applied to both columns so the comparison holds hours constant.', suffix: 'hrs', step: 1 },
  { key: 'paidDaysOff', label: 'Days off per year', hint: 'PTO plus holidays. Paid on W-2; unpaid on 1099, where it reduces billable hours.', suffix: 'days', step: 1 },
];

const W2_FIELDS: readonly FieldDef[] = [
  { key: 'w2Salary', label: 'Annual base salary', hint: 'Placeholder is this board’s typical band midpoint. Replace it with your offer.', prefix: '$', step: 1_000 },
  { key: 'w2EmployerMatchPct', label: 'Employer retirement match', hint: 'Percent of salary the employer contributes. Counted as money you keep.', suffix: '%', step: 0.5 },
  { key: 'w2EmployeePremium', label: 'Your health premium share', hint: 'Your annual payroll deduction for coverage. Treated as a pre-tax deduction.', prefix: '$', step: 100 },
];

const CONTRACT_FIELDS: readonly FieldDef[] = [
  { key: 'contractHourlyRate', label: 'Contract hourly rate', hint: 'Placeholder annualises the top of this board’s typical band. Replace it with your rate.', prefix: '$', step: 1 },
  { key: 'contractBusinessExpenses', label: 'Deductible business expenses', hint: 'Malpractice, licensure, CME, equipment, home office — annual total.', prefix: '$', step: 500 },
  { key: 'contractHealthPremium', label: 'Health insurance you buy', hint: 'Annual premium you pay yourself. Deducted above the line where income allows.', prefix: '$', step: 500 },
  { key: 'contractRetirement', label: 'Retirement you fund', hint: 'Annual cash into a SEP-IRA or solo 401(k). Counted as money you keep, not as a deduction.', prefix: '$', step: 500 },
];

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Numeric fields keep their RAW string in state rather than a parsed number,
 * so clearing a field to retype it does not snap back to "0" mid-keystroke.
 * The model always receives parsed numbers.
 */
type RawFields = Record<NumericField, string>;

const NUMERIC_KEYS: NumericField[] = [
  'hoursPerWeek', 'paidDaysOff',
  'w2Salary', 'w2EmployerMatchPct', 'w2EmployeePremium',
  'contractHourlyRate', 'contractBusinessExpenses', 'contractHealthPremium', 'contractRetirement',
];

const DEFAULT_RAW: RawFields = NUMERIC_KEYS.reduce((acc, key) => {
  acc[key] = String(DEFAULTS[key]);
  return acc;
}, {} as RawFields);

function StatRow({ label, value, tone }: { label: string; value: string; tone?: 'negative' | 'muted' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', fontSize: '13.5px' }}>
      <span style={{ color: '#64748B' }}>{label}</span>
      <span style={{ fontWeight: 700, color: tone === 'negative' ? '#B91C1C' : tone === 'muted' ? '#94A3B8' : '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

function ColumnCard({
  title, icon, accent, headline, headlineLabel, children,
}: {
  title: string; icon: ReactNode; accent: string; headline: string; headlineLabel: string; children: ReactNode;
}) {
  return (
    <div style={{ ...clayCard, padding: '22px 22px 20px', border: `1.5px solid ${accent}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span
          style={{
            width: '34px', height: '34px', borderRadius: '11px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${accent}18`, color: accent,
          }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{title}</h3>
      </div>
      <p style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>
        {headlineLabel}
      </p>
      <div style={{ fontSize: '30px', fontWeight: 800, color: accent, lineHeight: 1.1, marginBottom: '16px', fontVariantNumeric: 'tabular-nums' }}>
        {headline}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>{children}</div>
    </div>
  );
}

export default function TakeHomeCalculator() {
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(DEFAULTS.filingStatus);
  const [raw, setRaw] = useState<RawFields>(DEFAULT_RAW);

  const values: TakeHomeInputs = useMemo(() => {
    const parsed = NUMERIC_KEYS.reduce((acc, key) => {
      acc[key] = parseNumber(raw[key]);
      return acc;
    }, {} as Record<NumericField, number>);
    return { filingStatus, ...parsed };
  }, [filingStatus, raw]);

  const result = useMemo(() => computeTakeHome(values), [values]);

  const setNumeric = (key: NumericField, next: string) =>
    setRaw((prev) => ({ ...prev, [key]: next }));

  const reset = () => {
    setFilingStatus(DEFAULTS.filingStatus);
    setRaw(DEFAULT_RAW);
  };

  const contractAhead = result.netPositionDelta >= 0;

  const renderField = (field: FieldDef) => {
    const inputId = `takehome-${field.key}`;
    const hintId = `${inputId}-hint`;
    return (
      <div key={field.key}>
        <label htmlFor={inputId} style={labelStyle}>{field.label}</label>
        <div style={{ position: 'relative' }}>
          {field.prefix && (
            <span aria-hidden="true" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', fontWeight: 600, color: '#94A3B8' }}>
              {field.prefix}
            </span>
          )}
          <input
            id={inputId}
            className="tool-control"
            type="number"
            inputMode="decimal"
            min={0}
            step={field.step}
            value={raw[field.key]}
            onChange={(e) => setNumeric(field.key, e.target.value)}
            aria-describedby={hintId}
            style={{
              ...controlStyle,
              paddingLeft: field.prefix ? '28px' : controlStyle.paddingLeft,
              paddingRight: field.suffix ? '52px' : controlStyle.paddingRight,
            }}
          />
          {field.suffix && (
            <span aria-hidden="true" style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', fontWeight: 600, color: '#94A3B8' }}>
              {field.suffix}
            </span>
          )}
        </div>
        <p id={hintId} style={{ fontSize: '11.5px', color: '#94A3B8', margin: '5px 0 0', lineHeight: 1.45 }}>{field.hint}</p>
      </div>
    );
  };

  return (
    <div>
      <ToolStyles />
      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)', gap: '20px', alignItems: 'start' }}>

        {/* ─── Inputs ─── */}
        <form
          style={{ ...clayCard, padding: '24px 24px 22px' }}
          onSubmit={(e) => e.preventDefault()}
          aria-label="Take-home comparison inputs"
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', margin: '0 0 4px' }}>Your numbers</h2>
              <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                Every field starts on a placeholder. Replace them with the offers in front of you —
                nothing here is a published benchmark.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              style={{
                flexShrink: 0, padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
                border: '1.5px solid rgba(190,24,93,0.2)', background: 'transparent',
                fontSize: '12px', fontWeight: 700, color: TOOL_ACCENT,
              }}
            >
              Reset
            </button>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label htmlFor="takehome-filing" style={labelStyle}>Filing status</label>
            <select
              id="takehome-filing"
              className="tool-control"
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.target.value as FilingStatus)}
              aria-describedby="takehome-filing-hint"
              style={selectStyle}
            >
              {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map((status) => (
                <option key={status} value={status}>{FILING_STATUS_LABELS[status]}</option>
              ))}
            </select>
            <p id="takehome-filing-hint" style={{ fontSize: '11.5px', color: '#94A3B8', margin: '5px 0 0' }}>
              Sets the standard deduction and bracket table for tax year {TAX_MODEL_YEAR}.
            </p>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
            <legend style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', padding: 0, marginBottom: '10px' }}>
              Both roles
            </legend>
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {SHARED_FIELDS.map(renderField)}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
            <legend style={{ fontSize: '13px', fontWeight: 800, color: '#1E3A5F', padding: 0, marginBottom: '10px' }}>
              W-2 employee offer
            </legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {W2_FIELDS.map(renderField)}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: '13px', fontWeight: 800, color: '#92400E', padding: 0, marginBottom: '10px' }}>
              1099 contract offer
            </legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {CONTRACT_FIELDS.map(renderField)}
            </div>
          </fieldset>
        </form>

        {/* ─── Results ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Headline verdict */}
          <div
            style={{
              ...clayCard,
              padding: '24px 24px 22px',
              background: contractAhead
                ? 'linear-gradient(145deg, #FFFBEB, #FEF3C7)'
                : 'linear-gradient(145deg, #EEF2FF, #E0E7FF)',
              border: contractAhead ? '1.5px solid rgba(245,158,11,0.25)' : '1.5px solid rgba(99,102,241,0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span
                style={{
                  width: '34px', height: '34px', borderRadius: '11px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.75)', color: contractAhead ? '#B45309' : '#4338CA',
                }}
                aria-hidden="true"
              >
                {contractAhead ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
              </span>
              <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
                {contractAhead ? '1099 comes out ahead' : 'W-2 comes out ahead'}
              </h2>
            </div>
            <p aria-live="polite" style={{ fontSize: '34px', fontWeight: 800, color: contractAhead ? '#B45309' : '#4338CA', margin: '0 0 6px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(Math.abs(result.netPositionDelta))}
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#7A6A62' }}> / year</span>
            </p>
            <p style={{ fontSize: '13px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
              Difference in <strong>net position</strong> — cash after federal tax and insurance, measured the
              same way on both sides, plus any retirement dollars an <em>employer</em> adds. Retirement you fund
              yourself is already inside your own cash, so it is shown but not added again.
              Both columns work {Math.round(result.billableHours).toLocaleString('en-US')} hours.
            </p>
            {result.breakEvenHourlyRate !== null && (
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '10px 0 0', lineHeight: 1.6 }}>
                Break-even contract rate: <strong>{formatUsd(result.breakEvenHourlyRate)}/hr</strong> — below that,
                the W-2 offer wins on these inputs.
              </p>
            )}
          </div>

          {/* Side-by-side breakdown */}
          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <ColumnCard
              title="W-2 employee"
              icon={<Briefcase size={17} />}
              accent="#4338CA"
              headlineLabel="Net position"
              headline={formatUsd(result.w2.netPosition)}
            >
              <StatRow label="Gross salary" value={formatUsd(result.w2.gross)} />
              <StatRow label="Health premium (pre-tax)" value={`-${formatUsd(result.w2.employeePremium)}`} tone="negative" />
              <StatRow label="FICA withheld" value={`-${formatUsd(result.w2.payrollTax)}`} tone="negative" />
              <StatRow label="Federal income tax" value={`-${formatUsd(result.w2.federalTax)}`} tone="negative" />
              <StatRow label="Cash after tax" value={formatUsd(result.w2.cashAfterTax)} />
              <StatRow label="Employer retirement match" value={`+${formatUsd(result.w2.employerMatch)}`} />
              <StatRow label="Marginal federal bracket" value={`${Math.round(result.w2.marginalRate * 100)}%`} tone="muted" />
              <StatRow label="Net position per hour" value={`${formatUsd(result.w2EffectiveHourly)}/hr`} tone="muted" />
            </ColumnCard>

            <ColumnCard
              title="1099 contractor"
              icon={<Wallet size={17} />}
              accent="#B45309"
              headlineLabel="Net position"
              headline={formatUsd(result.contract.netPosition)}
            >
              <StatRow label="Gross contract income" value={formatUsd(result.contract.gross)} />
              <StatRow label="Business expenses" value={`-${formatUsd(result.contract.businessExpenses)}`} tone="negative" />
              <StatRow label="Self-employment tax" value={`-${formatUsd(result.contract.selfEmploymentTax)}`} tone="negative" />
              <StatRow label="Federal income tax" value={`-${formatUsd(result.contract.federalTax)}`} tone="negative" />
              <StatRow label="Health insurance" value={`-${formatUsd(result.contract.healthPremium)}`} tone="negative" />
              <StatRow label="Cash after tax" value={formatUsd(result.contract.cashAfterTax)} />
              <StatRow label="Of which you fund retirement" value={`(${formatUsd(result.contract.retirement)})`} tone="muted" />
              <StatRow label="Marginal federal bracket" value={`${Math.round(result.contract.marginalRate * 100)}%`} tone="muted" />
              <StatRow label="Net position per hour" value={`${formatUsd(result.contractEffectiveHourly)}/hr`} tone="muted" />
            </ColumnCard>
          </div>

          {/* Deduction detail */}
          <div style={{ ...clayCard, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' }}>
              <Scale size={16} color="#64748B" aria-hidden="true" />
              <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Where the 1099 deductions land
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <StatRow label="Net profit after business expenses" value={formatUsd(result.contract.netProfit)} />
              <StatRow label="Deduction: half of self-employment tax" value={`-${formatUsd(result.contract.halfSeDeduction)}`} />
              <StatRow label="Deduction: self-employed health premium" value={`-${formatUsd(result.contract.healthPremiumDeduction)}`} />
              <StatRow label="Taxable income after standard deduction" value={formatUsd(result.contract.taxableIncome)} />
            </div>
            <p style={{ fontSize: '12px', color: '#94A3B8', margin: '12px 0 0', lineHeight: 1.55 }}>
              Federal only, tax year {TAX_MODEL_YEAR}. State and local income tax are not modeled — see the
              assumptions below before you rely on any figure here.
            </p>
          </div>

          {/* Cross-links */}
          <div style={{ ...clayCard, padding: '20px 22px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Put a real rate in the box
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { href: '/jobs/1099', label: '1099 roles' },
                { href: '/jobs/locum-tenens', label: 'Locum tenens' },
                { href: '/jobs/contract', label: 'Contract roles' },
                { href: '/jobs/per-diem', label: 'Per diem' },
                { href: '/salary-guide', label: `${brand.niche.short} salary guide` },
                { href: '/resources/1099-vs-w2', label: '1099 vs W2 guide' },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '8px 14px', borderRadius: '20px', textDecoration: 'none',
                    background: '#FDF2F8', color: TOOL_ACCENT, fontSize: '12.5px', fontWeight: 700,
                  }}
                >
                  {l.label} <ArrowRight size={12} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
