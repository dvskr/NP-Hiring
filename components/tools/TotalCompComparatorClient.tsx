'use client';

import { useEffect, useMemo, useState } from 'react';
import { Scale, Trophy } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  compareTwoOffers,
  type TotalCompOfferInput,
} from './clinician-comp-models';
import { TOOL_ACCENT, clayCard, controlStyle, iconTile, labelStyle } from './tool-theme';

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

const DEFAULT_OFFER_A: TotalCompOfferInput = {
  label: 'Offer A: Health System Clinic',
  baseSalary: 132000,
  annualProductivityBonus: 6000,
  signOnBonus: 10000,
  signOnClawbackYears: 2,
  ptoDays: 24,
  cmeAllowance: 2500,
  cmeDays: 5,
  employerRetirementMatchPct: 5,
  employerHealthContributionAnnual: 9600,
  tailCoverageIncluded: true,
  estimatedTailValueIfExcluded: 9000,
  clinicalHoursPerWeek: 36,
  unpaidChartingAndCallHoursPerWeek: 3,
};

const DEFAULT_OFFER_B: TotalCompOfferInput = {
  label: 'Offer B: Private Specialty Group',
  baseSalary: 142000,
  annualProductivityBonus: 14000,
  signOnBonus: 5000,
  signOnClawbackYears: 2,
  ptoDays: 15,
  cmeAllowance: 1500,
  cmeDays: 3,
  employerRetirementMatchPct: 3,
  employerHealthContributionAnnual: 4800,
  tailCoverageIncluded: false,
  estimatedTailValueIfExcluded: 10500,
  clinicalHoursPerWeek: 40,
  unpaidChartingAndCallHoursPerWeek: 6,
};

function serializeOffer(o: TotalCompOfferInput): string {
  return [
    o.label.replace(/\|/g, '/'),
    o.baseSalary,
    o.annualProductivityBonus,
    o.signOnBonus,
    o.signOnClawbackYears,
    o.ptoDays,
    o.cmeAllowance,
    o.cmeDays,
    o.employerRetirementMatchPct,
    o.employerHealthContributionAnnual,
    o.tailCoverageIncluded ? 1 : 0,
    o.estimatedTailValueIfExcluded,
    o.clinicalHoursPerWeek,
    o.unpaidChartingAndCallHoursPerWeek,
  ].join('|');
}

function deserializeOffer(raw: string | null, fallback: TotalCompOfferInput): TotalCompOfferInput {
  if (!raw) return fallback;
  const parts = raw.split('|');
  if (parts.length < 14) return fallback;
  const num = (idx: number, fb: number) => {
    const v = Number(parts[idx]);
    return Number.isFinite(v) && v >= 0 ? v : fb;
  };
  return {
    label: parts[0]?.trim() || fallback.label,
    baseSalary: num(1, fallback.baseSalary),
    annualProductivityBonus: num(2, fallback.annualProductivityBonus),
    signOnBonus: num(3, fallback.signOnBonus),
    signOnClawbackYears: Math.max(1, num(4, fallback.signOnClawbackYears)),
    ptoDays: num(5, fallback.ptoDays),
    cmeAllowance: num(6, fallback.cmeAllowance),
    cmeDays: num(7, fallback.cmeDays),
    employerRetirementMatchPct: num(8, fallback.employerRetirementMatchPct),
    employerHealthContributionAnnual: num(9, fallback.employerHealthContributionAnnual),
    tailCoverageIncluded: parts[10] === '1',
    estimatedTailValueIfExcluded: num(11, fallback.estimatedTailValueIfExcluded),
    clinicalHoursPerWeek: Math.max(1, num(12, fallback.clinicalHoursPerWeek)),
    unpaidChartingAndCallHoursPerWeek: num(13, fallback.unpaidChartingAndCallHoursPerWeek),
  };
}

function OfferColumnEditor({
  prefix,
  badgeColor,
  offer,
  onChange,
}: {
  prefix: 'a' | 'b';
  badgeColor: string;
  offer: TotalCompOfferInput;
  onChange: (next: TotalCompOfferInput) => void;
}) {
  const update = <K extends keyof TotalCompOfferInput>(key: K, val: TotalCompOfferInput[K]) => {
    onChange({ ...offer, [key]: val });
  };

  return (
    <div style={{ ...clayCard, padding: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span
          style={{
            width: '30px',
            height: '30px',
            borderRadius: '9px',
            background: badgeColor,
            color: '#FFF',
            fontWeight: 800,
            fontSize: '14px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {prefix.toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <label htmlFor={`tcc-${prefix}-label`} style={{ ...labelStyle, marginBottom: '4px' }}>
            Offer nickname
          </label>
          <input
            id={`tcc-${prefix}-label`}
            className="tool-control"
            type="text"
            value={offer.label}
            onChange={(e) => update('label', e.target.value)}
            style={{ ...controlStyle, padding: '8px 12px', fontWeight: 700 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <SliderNumberField
          id={`tcc-${prefix}-base`}
          label="Annual base salary"
          value={offer.baseSalary}
          min={80000}
          max={250000}
          step={2000}
          prefix="$"
          onChange={(v) => update('baseSalary', v)}
        />
        <SliderNumberField
          id={`tcc-${prefix}-bonus`}
          label="Expected annual wRVU / quality bonus"
          value={offer.annualProductivityBonus}
          min={0}
          max={60000}
          step={1000}
          prefix="$"
          onChange={(v) => update('annualProductivityBonus', v)}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr', gap: '10px' }}>
          <SliderNumberField
            id={`tcc-${prefix}-sign`}
            label="Year-1 sign-on bonus"
            value={offer.signOnBonus}
            min={0}
            max={40000}
            step={1000}
            prefix="$"
            onChange={(v) => update('signOnBonus', v)}
          />
          <SliderNumberField
            id={`tcc-${prefix}-claw`}
            label="Clawback yrs"
            value={offer.signOnClawbackYears}
            min={1}
            max={4}
            step={1}
            suffix="yr"
            onChange={(v) => update('signOnClawbackYears', Math.max(1, v))}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <SliderNumberField
            id={`tcc-${prefix}-pto`}
            label="Paid PTO + holidays"
            value={offer.ptoDays}
            min={0}
            max={45}
            step={1}
            suffix="days"
            onChange={(v) => update('ptoDays', v)}
          />
          <SliderNumberField
            id={`tcc-${prefix}-cmedays`}
            label="Paid CME days"
            value={offer.cmeDays}
            min={0}
            max={15}
            step={1}
            suffix="days"
            onChange={(v) => update('cmeDays', v)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <SliderNumberField
            id={`tcc-${prefix}-cme`}
            label="Annual CME funds"
            value={offer.cmeAllowance}
            min={0}
            max={8000}
            step={250}
            prefix="$"
            onChange={(v) => update('cmeAllowance', v)}
          />
          <SliderNumberField
            id={`tcc-${prefix}-match`}
            label="401(k)/403(b) match"
            value={offer.employerRetirementMatchPct}
            min={0}
            max={10}
            step={0.5}
            suffix="%"
            onChange={(v) => update('employerRetirementMatchPct', v)}
          />
        </div>
        <SliderNumberField
          id={`tcc-${prefix}-health`}
          label="Employer annual health/dental contribution"
          value={offer.employerHealthContributionAnnual}
          min={0}
          max={22000}
          step={400}
          prefix="$"
          suffix="/yr"
          onChange={(v) => update('employerHealthContributionAnnual', v)}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <SliderNumberField
            id={`tcc-${prefix}-clin`}
            label="Scheduled hrs/wk"
            value={offer.clinicalHoursPerWeek}
            min={20}
            max={50}
            step={2}
            suffix="hrs"
            onChange={(v) => update('clinicalHoursPerWeek', Math.max(1, v))}
          />
          <SliderNumberField
            id={`tcc-${prefix}-chart`}
            label="Unpaid chart/call"
            value={offer.unpaidChartingAndCallHoursPerWeek}
            min={0}
            max={20}
            step={1}
            suffix="hrs"
            onChange={(v) => update('unpaidChartingAndCallHoursPerWeek', v)}
          />
        </div>

        <div style={{ padding: '12px', borderRadius: '11px', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <label
            htmlFor={`tcc-${prefix}-tail`}
            style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', fontWeight: 600, color: '#1A2E35', cursor: 'pointer' }}
          >
            <input
              id={`tcc-${prefix}-tail`}
              className="tool-control"
              type="checkbox"
              checked={offer.tailCoverageIncluded}
              onChange={(e) => update('tailCoverageIncluded', e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: TOOL_ACCENT }}
            />
            Employer pays malpractice tail (or provides occurrence / FTCA coverage)
          </label>
          {!offer.tailCoverageIncluded && (
            <div style={{ marginTop: '10px' }}>
              <SliderNumberField
                id={`tcc-${prefix}-tailcost`}
                label="Est. unpaid tail invoice at exit (amortized over 3 yrs)"
                value={offer.estimatedTailValueIfExcluded}
                min={0}
                max={25000}
                step={500}
                prefix="$"
                onChange={(v) => update('estimatedTailValueIfExcluded', v)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TotalCompComparatorClient() {
  const [offerA, setOfferA] = useState<TotalCompOfferInput>(DEFAULT_OFFER_A);
  const [offerB, setOfferB] = useState<TotalCompOfferInput>(DEFAULT_OFFER_B);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.has('a')) setOfferA(deserializeOffer(p.get('a'), DEFAULT_OFFER_A));
      if (p.has('b')) setOfferB(deserializeOffer(p.get('b'), DEFAULT_OFFER_B));
    } catch {
      // Ignore malformed URL query
    }
  }, []);

  const cmp = useMemo(() => compareTwoOffers(offerA, offerB), [offerA, offerB]);

  const handleReset = () => {
    setOfferA(DEFAULT_OFFER_A);
    setOfferB(DEFAULT_OFFER_B);
  };

  const winnerTitle =
    cmp.winner === 'A'
      ? `${cmp.offerA.label} leads over 3 years`
      : cmp.winner === 'B'
        ? `${cmp.offerB.label} leads over 3 years`
        : 'Both offers are a virtual 3-year tie';

  const bars = [
    {
      label: `${cmp.offerA.label} · 3-Yr Cumulative Total Value`,
      value: cmp.offerA.threeYearCumulativeValue,
      formatted: formatUsd(cmp.offerA.threeYearCumulativeValue),
      color: 'linear-gradient(90deg, #BE185D, #EC4899)',
      sublabel: `$${cmp.offerA.trueSteadyStateHourly.toFixed(2)}/hr true worked rate`,
    },
    {
      label: `${cmp.offerB.label} · 3-Yr Cumulative Total Value`,
      value: cmp.offerB.threeYearCumulativeValue,
      formatted: formatUsd(cmp.offerB.threeYearCumulativeValue),
      color: 'linear-gradient(90deg, #0284C7, #38BDF8)',
      sublabel: `$${cmp.offerB.trueSteadyStateHourly.toFixed(2)}/hr true worked rate`,
    },
  ];

  return (
    <div>
      <ToolStyles />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#475569' }}>
          <Scale size={16} color={TOOL_ACCENT} />
          Edit both offers below and click Copy shareable link to bookmark or share your exact comparison
        </div>
        <ShareableToolbar
          queryParams={{
            a: serializeOffer(offerA),
            b: serializeOffer(offerB),
          }}
          onReset={handleReset}
          showPrint
          printLabel="Print side-by-side comparison"
        />
      </div>

      {/* Winner Banner */}
      <div
        style={{
          ...clayCard,
          padding: '24px',
          marginBottom: '22px',
          background: 'linear-gradient(145deg, #FFFDFB 0%, #FDF2F8 100%)',
          border: '1.5px solid rgba(190,24,93,0.18)',
        }}
      >
        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: TOOL_ACCENT, marginBottom: '6px' }}>
              <Trophy size={14} /> True total compensation verdict
            </div>
            <h2 className="font-lora" style={{ fontSize: 'clamp(1.35rem, 2.6vw, 1.8rem)', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>
              {winnerTitle}
            </h2>
            <p style={{ fontSize: '13.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
              3-year total economic spread:{' '}
              <strong style={{ color: '#1A2E35' }}>{formatUsd(Math.abs(cmp.threeYearDeltaBMinusA))}</strong> · True steady-state
              worked hourly spread:{' '}
              <strong style={{ color: '#1A2E35' }}>
                ${Math.abs(cmp.hourlyDeltaBMinusA).toFixed(2)}/hr
              </strong>{' '}
              ({cmp.hourlyDeltaBMinusA >= 0 ? `${cmp.offerB.label} higher per worked hour` : `${cmp.offerA.label} higher per worked hour`}).
            </p>
          </div>
          <div>
            <BreakdownBarList items={bars} />
          </div>
        </div>
      </div>

      {/* Side-by-Side Editors */}
      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start', marginBottom: '22px' }}>
        <OfferColumnEditor
          prefix="a"
          badgeColor="linear-gradient(145deg, #BE185D, #9D174D)"
          offer={offerA}
          onChange={setOfferA}
        />
        <OfferColumnEditor
          prefix="b"
          badgeColor="linear-gradient(145deg, #0284C7, #0369A1)"
          offer={offerB}
          onChange={setOfferB}
        />
      </div>

      {/* Line-Item Comparison Matrix */}
      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <span style={{ ...iconTile, width: '38px', height: '38px', background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
            <Scale size={18} color="#fff" />
          </span>
          <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
            Line-by-line economic & workload breakdown
          </h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '10px 8px' }}>Component</th>
                <th style={{ padding: '10px 8px', textAlign: 'right', color: '#9D174D' }}>{cmp.offerA.label}</th>
                <th style={{ padding: '10px 8px', textAlign: 'right', color: '#0369A1' }}>{cmp.offerB.label}</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Offer B minus A</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: 'Steady-state annual cash (base + bonus)',
                  a: cmp.offerA.steadyStateCash,
                  b: cmp.offerB.steadyStateCash,
                  fmt: formatUsd,
                },
                {
                  name: 'Year-1 cash (including sign-on)',
                  a: cmp.offerA.yearOneCash,
                  b: cmp.offerB.yearOneCash,
                  fmt: formatUsd,
                },
                {
                  name: 'Employer retirement match ($/yr)',
                  a: cmp.offerA.retirementMatchDollars,
                  b: cmp.offerB.retirementMatchDollars,
                  fmt: formatUsd,
                },
                {
                  name: 'Health + CME value (net of annualized tail drag)',
                  a: cmp.offerA.benefitsAndCmeValue,
                  b: cmp.offerB.benefitsAndCmeValue,
                  fmt: formatUsd,
                },
                {
                  name: 'Steady-state annual total package',
                  a: cmp.offerA.steadyStateTotalEconomicValue,
                  b: cmp.offerB.steadyStateTotalEconomicValue,
                  fmt: formatUsd,
                  bold: true,
                },
                {
                  name: '3-year cumulative total value',
                  a: cmp.offerA.threeYearCumulativeValue,
                  b: cmp.offerB.threeYearCumulativeValue,
                  fmt: formatUsd,
                  bold: true,
                },
                {
                  name: 'Annual clinical + charting/call hours worked',
                  a: cmp.offerA.annualWorkedHours,
                  b: cmp.offerB.annualWorkedHours,
                  fmt: (n: number) => `${Math.round(n).toLocaleString()} hrs`,
                  lowerIsBetter: true,
                },
                {
                  name: 'True steady-state value per worked hour',
                  a: cmp.offerA.trueSteadyStateHourly,
                  b: cmp.offerB.trueSteadyStateHourly,
                  fmt: (n: number) => `$${n.toFixed(2)}/hr`,
                  bold: true,
                },
              ].map((row) => {
                const diff = row.b - row.a;
                const bBetter = row.lowerIsBetter ? diff < 0 : diff > 0;
                return (
                  <tr key={row.name} style={{ borderBottom: '1px solid #F1F5F9', fontWeight: row.bold ? 700 : 400 }}>
                    <td style={{ padding: '11px 8px', color: '#1A2E35' }}>{row.name}</td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {row.fmt(row.a)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {row.fmt(row.b)}
                    </td>
                    <td
                      style={{
                        padding: '11px 8px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: Math.abs(diff) < 0.01 ? '#64748B' : bBetter ? '#047857' : '#B91C1C',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {diff > 0 ? '+' : ''}
                      {row.fmt(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
