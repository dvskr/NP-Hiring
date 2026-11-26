'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, TrendingDown } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import { computeVacancyCost, type VacancyCostInputs } from './employer-ops-models';
import { TOOL_ACCENT, clayCard, formatUsd } from './tool-theme';

interface Props {
  defaultAnnualSalary: number;
}

export default function CostOfVacancyCalculatorClient({ defaultAnnualSalary }: Props) {
  const defaults: VacancyCostInputs = {
    completedVisitsPerDay: 16,
    netCollectionPerVisit: 135,
    clinicalDaysPerWeek: 4.5,
    vacancyCalendarDays: 75,
    annualBaseSalary: defaultAnnualSalary,
    benefitsAndPayrollLoadPct: 22,
    locumDailyRate: 1150,
    locumDaysCoveredPct: 0,
    locumProductivityPct: 85,
  };

  const [inputs, setInputs] = useState<VacancyCostInputs>(defaults);
  const update = <K extends keyof VacancyCostInputs>(key: K, val: VacancyCostInputs[K]) =>
    setInputs((prev) => ({ ...prev, [key]: val }));

  const res = useMemo(() => computeVacancyCost(inputs), [inputs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Editable Clinic Inputs
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Unfilled {brand.niche.short} seat revenue & locum bridge modeler
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              v: inputs.completedVisitsPerDay,
              c: inputs.netCollectionPerVisit,
              d: inputs.vacancyCalendarDays,
              s: inputs.annualBaseSalary,
              loc: inputs.locumDaysCoveredPct,
            }}
            showPrint
            printLabel="Print CFO summary"
            onReset={() => setInputs(defaults)}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Sliders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <SliderNumberField
              id="vac-visits"
              label="Completed patient visits per clinical day"
              value={inputs.completedVisitsPerDay}
              min={4}
              max={36}
              step={1}
              suffix="visits"
              onChange={(v) => update('completedVisitsPerDay', v)}
            />
            <SliderNumberField
              id="vac-collection"
              label="Net collected revenue per completed visit"
              value={inputs.netCollectionPerVisit}
              min={50}
              max={350}
              step={5}
              prefix="$"
              hint="Actual cash collected after payer contractual adjustments, not billed charges."
              onChange={(v) => update('netCollectionPerVisit', v)}
            />
            <SliderNumberField
              id="vac-days-wk"
              label="Clinical days per week"
              value={inputs.clinicalDaysPerWeek}
              min={1}
              max={6}
              step={0.5}
              suffix="days/wk"
              onChange={(v) => update('clinicalDaysPerWeek', v)}
            />
            <SliderNumberField
              id="vac-cal-days"
              label="Total calendar days seat stays unfilled"
              value={inputs.vacancyCalendarDays}
              min={15}
              max={180}
              step={5}
              suffix="days"
              hint="Include recruiting, notice period, state licensure, and payer credentialing lead time."
              onChange={(v) => update('vacancyCalendarDays', v)}
            />
            <SliderNumberField
              id="vac-salary"
              label="Planned annual base salary"
              value={inputs.annualBaseSalary}
              min={80000}
              max={240000}
              step={1000}
              prefix="$"
              onChange={(v) => update('annualBaseSalary', v)}
            />
            <SliderNumberField
              id="vac-load"
              label="Benefits, FICA & malpractice load (%)"
              value={inputs.benefitsAndPayrollLoadPct}
              min={0}
              max={40}
              step={1}
              suffix="%"
              onChange={(v) => update('benefitsAndPayrollLoadPct', v)}
            />

            <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', marginBottom: '10px' }}>
                Optional Locum Tenens Bridge Comparison
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <SliderNumberField
                  id="vac-locum-pct"
                  label="Share of vacant shifts covered by locum (%)"
                  value={inputs.locumDaysCoveredPct}
                  min={0}
                  max={100}
                  step={10}
                  suffix="%"
                  onChange={(v) => update('locumDaysCoveredPct', v)}
                />
                {inputs.locumDaysCoveredPct > 0 && (
                  <>
                    <SliderNumberField
                      id="vac-locum-rate"
                      label="All-in locum daily agency invoice"
                      value={inputs.locumDailyRate}
                      min={600}
                      max={2400}
                      step={50}
                      prefix="$"
                      onChange={(v) => update('locumDailyRate', v)}
                    />
                    <SliderNumberField
                      id="vac-locum-prod"
                      label="Locum visit throughput vs permanent clinician (%)"
                      value={inputs.locumProductivityPct}
                      min={50}
                      max={110}
                      step={5}
                      suffix="%"
                      onChange={(v) => update('locumProductivityPct', v)}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              aria-live="polite"
              style={{
                padding: '22px',
                borderRadius: '18px',
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                border: '1.5px solid rgba(190,24,93,0.22)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                <TrendingDown size={15} /> Net Clinic Vacancy Impact ({inputs.vacancyCalendarDays} days)
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#831843', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
                {formatUsd(res.netVacancyLossNoLocum)}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.55 }}>
                <strong>{Math.round(res.totalVisitsUnfilled).toLocaleString('en-US')} unserved patient visits</strong> across{' '}
                {Math.round(res.clinicalWorkdaysMissed)} missed clinic days ({formatUsd(res.dailyNetBleed)} net bleed per calendar day after subtracting saved compensation).
              </p>
            </div>

            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ padding: '14px 16px', borderRadius: '14px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#5A4A42' }}>Foregone Gross Collections</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(res.grossCollectionsForegone)}
                </div>
              </div>
              <div style={{ padding: '14px 16px', borderRadius: '14px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#5A4A42' }}>Unpaid Salary + Load Offset</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(res.savedSalaryAndBenefits)}
                </div>
              </div>
            </div>

            {inputs.locumDaysCoveredPct > 0 && (
              <div style={{ padding: '16px 18px', borderRadius: '14px', background: '#EEF2FF', border: '1.5px solid rgba(67,56,202,0.2)' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#3730A3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                  Locum Bridge Scenario ({inputs.locumDaysCoveredPct}% coverage)
                </div>
                <div style={{ fontSize: '14px', color: '#1A2E35', lineHeight: 1.55 }}>
                  Recovering <strong>{Math.round(res.locumVisitsRecovered)} visits</strong> ({formatUsd(res.locumCollectionsRecovered)}) against{' '}
                  <strong>{formatUsd(res.locumTotalSpend)}</strong> in locum spend leaves a net vacancy cost of{' '}
                  <strong>{formatUsd(res.netPositionWithLocum)}</strong> (
                  {res.locumNetAdvantage >= 0
                    ? `saves ${formatUsd(res.locumNetAdvantage)} vs leaving the panel uncovered`
                    : `costs ${formatUsd(Math.abs(res.locumNetAdvantage))} more in direct cash, though preserves patient panel retention`}
                  ).
                </div>
              </div>
            )}

            {/* 30 / 60 / 90 / 120 Day Loss Chart */}
            <div style={{ padding: '18px', borderRadius: '15px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
              <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>
                Cumulative Net Vacancy Loss by Time-to-Fill Horizon
              </h4>
              <BreakdownBarList
                items={res.milestones.map((m) => ({
                  label: `${m.days} calendar days unfilled`,
                  sublabel: `${m.lostPatientVisits.toLocaleString('en-US')} missed visits`,
                  value: Math.max(0, m.netRevenueLostNoLocum),
                  formatted: formatUsd(m.netRevenueLostNoLocum),
                  color: m.days >= 90 ? 'linear-gradient(90deg, #BE185D, #9D174D)' : 'linear-gradient(90deg, #EC4899, #BE185D)',
                }))}
              />
            </div>

            <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', paddingTop: '4px' }}>
              <Link
                href="/post-job"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  background: TOOL_ACCENT,
                  color: '#FFFFFF',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                Post your {brand.niche.short} role now <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/cost-per-hire-calculator"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '12px 18px',
                  borderRadius: '12px',
                  background: '#F1F5F9',
                  color: '#334155',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Compare recruiting channel fees <ArrowRight size={14} />
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
