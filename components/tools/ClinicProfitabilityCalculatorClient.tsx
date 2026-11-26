'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import { computeClinicProfitability, type ClinicProfitabilityInputs } from './employer-ops-models';
import { TOOL_ACCENT, clayCard, formatUsd } from './tool-theme';

interface Props {
  defaultW2Base: number;
}

export default function ClinicProfitabilityCalculatorClient({ defaultW2Base }: Props) {
  const defaults: ClinicProfitabilityInputs = {
    scheduledVisitsPerDay: 18,
    noShowPct: 10,
    clinicalDaysPerWeek: 4.5,
    workingWeeksPerYear: 47,
    netCollectionPerVisit: 135,
    w2BaseSalary: defaultW2Base,
    benefitsAndPayrollPct: 22,
    annualCmeAndMalpractice: 6000,
    contractorClinicianSplitPct: 65,
    collaboratingMdMonthlyRetainer: 1000,
    monthlySupportAndEhrOverhead: 2200,
  };

  const [inputs, setInputs] = useState<ClinicProfitabilityInputs>(defaults);
  const set = <K extends keyof ClinicProfitabilityInputs>(k: K, v: ClinicProfitabilityInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const res = useMemo(() => computeClinicProfitability(inputs), [inputs]);
  const breakEvenRatioPct = Math.min(
    100,
    res.completedVisitsPerDay > 0
      ? Math.round((res.w2BreakEvenCompletedVisitsPerDay / res.completedVisitsPerDay) * 100)
      : 100,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Editable Clinic Unit Economics
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              {brand.niche.short} hire break-even & W-2 vs 1099 split comparison
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              v: inputs.scheduledVisitsPerDay,
              ns: inputs.noShowPct,
              col: inputs.netCollectionPerVisit,
              w2: inputs.w2BaseSalary,
              sp: inputs.contractorClinicianSplitPct,
            }}
            showPrint
            printLabel="Print P&L summary"
            onReset={() => setInputs(defaults)}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
              1. Patient Volume & Collections
            </h4>
            <SliderNumberField
              id="cp-visits"
              label="Scheduled visits per clinic day"
              value={inputs.scheduledVisitsPerDay}
              min={6}
              max={36}
              step={1}
              suffix="visits"
              onChange={(v) => set('scheduledVisitsPerDay', v)}
            />
            <SliderNumberField
              id="cp-noshow"
              label="No-show & late-cancellation rate (%)"
              value={inputs.noShowPct}
              min={0}
              max={35}
              step={1}
              suffix="%"
              onChange={(v) => set('noShowPct', v)}
            />
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="cp-days"
                label="Clinic days / wk"
                value={inputs.clinicalDaysPerWeek}
                min={1}
                max={6}
                step={0.5}
                onChange={(v) => set('clinicalDaysPerWeek', v)}
              />
              <SliderNumberField
                id="cp-weeks"
                label="Working weeks / yr"
                value={inputs.workingWeeksPerYear}
                min={36}
                max={52}
                step={1}
                onChange={(v) => set('workingWeeksPerYear', v)}
              />
            </div>
            <SliderNumberField
              id="cp-col"
              label="Net collection per completed visit"
              value={inputs.netCollectionPerVisit}
              min={55}
              max={350}
              step={5}
              prefix="$"
              onChange={(v) => set('netCollectionPerVisit', v)}
            />

            <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: '8px 0 0', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              2. W-2 Compensation vs 1099 Split & Support Costs
            </h4>
            <SliderNumberField
              id="cp-w2base"
              label="W-2 annual base salary"
              value={inputs.w2BaseSalary}
              min={85000}
              max={230000}
              step={1000}
              prefix="$"
              onChange={(v) => set('w2BaseSalary', v)}
            />
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="cp-load"
                label="Payroll & benefits (%)"
                value={inputs.benefitsAndPayrollPct}
                min={8}
                max={38}
                step={1}
                suffix="%"
                onChange={(v) => set('benefitsAndPayrollPct', v)}
              />
              <SliderNumberField
                id="cp-cme"
                label="CME + Malpractice / yr"
                value={inputs.annualCmeAndMalpractice}
                min={0}
                max={20000}
                step={500}
                prefix="$"
                onChange={(v) => set('annualCmeAndMalpractice', v)}
              />
            </div>
            <SliderNumberField
              id="cp-split"
              label="Alternative 1099 clinician share of collections (%)"
              value={inputs.contractorClinicianSplitPct}
              min={40}
              max={85}
              step={1}
              suffix="%"
              hint={`Clinic retains ${100 - inputs.contractorClinicianSplitPct}% of collections to cover overhead and margin.`}
              onChange={(v) => set('contractorClinicianSplitPct', v)}
            />
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="cp-mdfee"
                label="Collaborating MD / mo"
                value={inputs.collaboratingMdMonthlyRetainer}
                min={0}
                max={4000}
                step={100}
                prefix="$"
                hint="Set to zero in full-practice states."
                onChange={(v) => set('collaboratingMdMonthlyRetainer', v)}
              />
              <SliderNumberField
                id="cp-overhead"
                label="Seat EHR / MA / room / mo"
                value={inputs.monthlySupportAndEhrOverhead}
                min={0}
                max={12000}
                step={200}
                prefix="$"
                onChange={(v) => set('monthlySupportAndEhrOverhead', v)}
              />
            </div>
          </div>

          {/* Right Output */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Gross Collections Banner */}
            <div style={{ padding: '18px 20px', borderRadius: '16px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Projected Seat Gross Collections
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>
                {formatUsd(res.grossAnnualCollections)} <span style={{ fontSize: '14px', fontWeight: 600, color: '#5A4A42' }}>/ yr</span>
              </div>
              <div style={{ fontSize: '12.5px', color: '#5A4A42', marginTop: '4px' }}>
                {res.completedVisitsPerDay.toFixed(1)} completed visits/day × {res.clinicalDaysPerYear.toFixed(0)} clinic days ={' '}
                <strong>{Math.round(res.completedVisitsPerYear).toLocaleString('en-US')} completed visits/yr</strong>
              </div>
            </div>

            {/* Side-by-side W-2 vs 1099 Cards */}
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div
                aria-live="polite"
                style={{
                  padding: '18px',
                  borderRadius: '16px',
                  background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                  border: '1.5px solid rgba(190,24,93,0.24)',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  W-2 Employed Model
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: res.w2AnnualNetMargin >= 0 ? '#831843' : '#B91C1C', fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                  {formatUsd(res.w2AnnualNetMargin)}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#5A4A42', marginBottom: '10px' }}>
                  {formatUsd(res.w2MonthlyNetMargin)}/mo · {res.w2MarginPct.toFixed(1)}% clinic margin
                </div>
                <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.5 }}>
                  Clinician loaded cost: <strong>{formatUsd(res.w2TotalClinicianCost)}</strong>
                  <br />
                  Break-even: <strong>{res.w2BreakEvenCompletedVisitsPerDay.toFixed(1)} visits/day</strong>
                </div>
              </div>

              <div
                style={{
                  padding: '18px',
                  borderRadius: '16px',
                  background: 'linear-gradient(145deg, #EEF2FF, #E0E7FF)',
                  border: '1.5px solid rgba(67,56,202,0.22)',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#4338CA', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  1099 Split ({inputs.contractorClinicianSplitPct}% / {100 - inputs.contractorClinicianSplitPct}%)
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: res.split1099AnnualNetMargin >= 0 ? '#312E81' : '#B91C1C', fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                  {formatUsd(res.split1099AnnualNetMargin)}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#5A4A42', marginBottom: '10px' }}>
                  {formatUsd(res.split1099MonthlyNetMargin)}/mo · {res.split1099MarginPct.toFixed(1)}% clinic margin
                </div>
                <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.5 }}>
                  1099 clinician payout: <strong>{formatUsd(res.split1099ClinicianPayout)}</strong>
                  <br />
                  Fixed-cost break-even: <strong>{res.split1099BreakEvenCompletedVisitsPerDay.toFixed(1)} visits/day</strong>
                </div>
              </div>
            </div>

            {/* W-2 Break-Even Gauge */}
            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35' }}>
                  W-2 Daily Break-Even Utilization Gauge
                </span>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: TOOL_ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                  {res.w2BreakEvenCompletedVisitsPerDay.toFixed(1)} needed vs {res.completedVisitsPerDay.toFixed(1)} completed/day
                </span>
              </div>
              <div style={{ height: '12px', borderRadius: '999px', background: '#E2E8F0', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${breakEvenRatioPct}%`,
                    height: '100%',
                    background:
                      res.completedVisitsPerDay >= res.w2BreakEvenCompletedVisitsPerDay
                        ? 'linear-gradient(90deg, #059669, #10B981)'
                        : 'linear-gradient(90deg, #D97706, #EF4444)',
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>
              <p style={{ fontSize: '12px', color: '#5A4A42', margin: '7px 0 0', lineHeight: 1.45 }}>
                {res.completedVisitsPerDay >= res.w2BreakEvenCompletedVisitsPerDay
                  ? `Every completed visit above ${res.w2BreakEvenCompletedVisitsPerDay.toFixed(1)}/day contributes ${formatUsd(inputs.netCollectionPerVisit)} directly to practice operating margin.`
                  : `Current volume sits ${(res.w2BreakEvenCompletedVisitsPerDay - res.completedVisitsPerDay).toFixed(1)} completed visits/day short of covering W-2 loaded cost plus seat overhead; a 1099 split lowers fixed ramp risk while panels fill.`}
              </p>
            </div>

            {/* Cost Stack Breakdown */}
            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.07)' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
                Where Each Collected Dollar Goes (W-2 Model)
              </h4>
              <BreakdownBarList
                maxOverride={Math.max(1, res.grossAnnualCollections)}
                items={[
                  {
                    label: 'Clinician base + payroll/benefits + CME/malpractice',
                    value: res.w2TotalClinicianCost,
                    formatted: formatUsd(res.w2TotalClinicianCost),
                    color: 'linear-gradient(90deg, #6366F1, #4338CA)',
                  },
                  {
                    label: 'Collaborating MD retainer + seat EHR/support overhead',
                    value: res.annualFixedPracticeSupportCost,
                    formatted: formatUsd(res.annualFixedPracticeSupportCost),
                    color: 'linear-gradient(90deg, #64748B, #475569)',
                  },
                  {
                    label: res.w2AnnualNetMargin >= 0 ? 'Net clinic contribution margin' : 'Net clinic deficit',
                    value: Math.abs(res.w2AnnualNetMargin),
                    formatted: formatUsd(res.w2AnnualNetMargin),
                    color:
                      res.w2AnnualNetMargin >= 0
                        ? 'linear-gradient(90deg, #059669, #10B981)'
                        : 'linear-gradient(90deg, #DC2626, #B91C1C)',
                  },
                ]}
              />
            </div>

            <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <Link
                href="/post-job"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '11px 18px',
                  borderRadius: '12px',
                  background: TOOL_ACCENT,
                  color: '#FFFFFF',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                Post this {brand.niche.short} role <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/incident-to-roi-calculator"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '11px 16px',
                  borderRadius: '12px',
                  background: '#F1F5F9',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Check Medicare 85% vs 100% incident-to <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print, header, footer, nav { display: none !important; }
          body { background: #FFFFFF !important; }
        }
      `}</style>
    </div>
  );
}
