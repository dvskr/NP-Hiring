'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { brand } from '@/config/brand';
import type { StateSalarySnapshot } from '@/lib/tools-salary-data';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import { gradeClinicianOffer, type OfferAnalyzerInputs } from './clinician-comp-models';
import { TOOL_ACCENT, clayCard, formatUsd, labelStyle, selectStyle } from './tool-theme';

interface Props {
  states: readonly StateSalarySnapshot[];
  nationalMedian: number;
}

export default function OfferAnalyzerClient({ states, nationalMedian }: Props) {
  const [selectedState, setSelectedState] = useState('Texas');
  const defaults: OfferAnalyzerInputs = {
    baseSalary: 132000,
    annualBonus: 5000,
    signOnBonus: 5000,
    signOnCommitmentYears: 2,
    ptoDays: 20,
    cmeDollars: 2500,
    yearsExperience: 3,
    hasUnpaidCall: false,
    unpaidChartingHoursPerWeek: 3,
  };
  const [inputs, setInputs] = useState<OfferAnalyzerInputs>(defaults);
  const set = <K extends keyof OfferAnalyzerInputs>(k: K, v: OfferAnalyzerInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const stateRow = useMemo(
    () => states.find((s) => s.state === selectedState) ?? states[0],
    [states, selectedState],
  );

  const result = useMemo(
    () =>
      gradeClinicianOffer(
        inputs,
        {
          state: stateRow.state,
          liveMedian: stateRow.liveMedian,
          liveP25: stateRow.liveP25,
          liveP75: stateRow.liveP75,
          liveEmployers: stateRow.liveEmployers,
          blsMedian: stateRow.blsMedian,
          blsP10: stateRow.blsP10,
          blsP25: stateRow.blsP25,
          blsP75: stateRow.blsP75,
          blsP90: stateRow.blsP90,
        },
        nationalMedian,
      ),
    [inputs, stateRow, nationalMedian],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Live Market Offer Grader
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Enter your written {brand.niche.short} offer details
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              st: selectedState,
              base: inputs.baseSalary,
              bon: inputs.annualBonus,
              exp: inputs.yearsExperience,
              pto: inputs.ptoDays,
            }}
            showPrint
            onReset={() => {
              setSelectedState('Texas');
              setInputs(defaults);
            }}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="oa-state" style={labelStyle}>Practice state / jurisdiction</label>
              <select
                id="oa-state"
                className="tool-control"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                style={selectStyle}
              >
                {states.map((s) => (
                  <option key={s.state} value={s.state}>{s.state}</option>
                ))}
              </select>
            </div>

            <SliderNumberField
              id="oa-base"
              label="Offered annual base salary"
              value={inputs.baseSalary}
              min={75000}
              max={240000}
              step={1000}
              prefix="$"
              onChange={(v) => set('baseSalary', v)}
            />
            <SliderNumberField
              id="oa-bonus"
              label="Expected annual wRVU / quality bonus"
              value={inputs.annualBonus}
              min={0}
              max={60000}
              step={500}
              prefix="$"
              onChange={(v) => set('annualBonus', v)}
            />
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="oa-signon"
                label="Sign-on bonus"
                value={inputs.signOnBonus}
                min={0}
                max={40000}
                step={500}
                prefix="$"
                onChange={(v) => set('signOnBonus', v)}
              />
              <SliderNumberField
                id="oa-commit"
                label="Clawback yrs"
                value={inputs.signOnCommitmentYears}
                min={1}
                max={4}
                step={1}
                suffix="yrs"
                onChange={(v) => set('signOnCommitmentYears', v)}
              />
            </div>

            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="oa-pto"
                label="Paid time off (days/yr)"
                value={inputs.ptoDays}
                min={0}
                max={45}
                step={1}
                suffix="days"
                onChange={(v) => set('ptoDays', v)}
              />
              <SliderNumberField
                id="oa-cme"
                label="Annual CME stipend"
                value={inputs.cmeDollars}
                min={0}
                max={8000}
                step={250}
                prefix="$"
                onChange={(v) => set('cmeDollars', v)}
              />
            </div>

            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="oa-exp"
                label="Years as licensed NP"
                value={inputs.yearsExperience}
                min={0}
                max={20}
                step={1}
                suffix="yrs"
                onChange={(v) => set('yearsExperience', v)}
              />
              <SliderNumberField
                id="oa-chart"
                label="Unpaid charting / wk"
                value={inputs.unpaidChartingHoursPerWeek}
                min={0}
                max={15}
                step={1}
                suffix="hrs"
                onChange={(v) => set('unpaidChartingHoursPerWeek', v)}
              />
            </div>

            <label
              htmlFor="oa-call"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '11px 14px',
                borderRadius: '12px',
                background: '#F8FAFC',
                border: '1px solid rgba(0,0,0,0.08)',
                cursor: 'pointer',
              }}
            >
              <input
                id="oa-call"
                className="tool-control"
                type="checkbox"
                checked={inputs.hasUnpaidCall}
                onChange={(e) => set('hasUnpaidCall', e.target.checked)}
                style={{ width: '17px', height: '17px', accentColor: TOOL_ACCENT }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>
                Includes uncompensated evening or weekend call rotation
              </span>
            </label>
          </div>

          {/* Right Results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              aria-live="polite"
              style={{
                padding: '22px',
                borderRadius: '18px',
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                border: '1.5px solid rgba(190,24,93,0.24)',
              }}
            >
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {selectedState} Market Standing · ~{result.estimatedPercentile}th Percentile
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#831843', marginTop: '4px', lineHeight: 1.15 }}>
                {result.tierLabel}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.55 }}>
                Your base + recurring bonus ({formatUsd(inputs.baseSalary + inputs.annualBonus)}) sits{' '}
                <strong>
                  {result.gapToMedian >= 0
                    ? `${formatUsd(result.gapToMedian)} above`
                    : `${formatUsd(Math.abs(result.gapToMedian))} below`}
                </strong>{' '}
                the {selectedState} benchmark median of <strong>{formatUsd(result.anchorMedian)}</strong>. True worked rate:{' '}
                <strong>${result.trueHourlyRate.toFixed(2)}/hr</strong>.
              </p>

              {/* Percentile Gauge */}
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#5A4A42', marginBottom: '4px' }}>
                  <span>10th</span>
                  <span>25th ({formatUsd(result.anchorP25)})</span>
                  <span>Median ({formatUsd(result.anchorMedian)})</span>
                  <span>75th ({formatUsd(result.anchorP75)})</span>
                </div>
                <div style={{ position: 'relative', height: '12px', borderRadius: '999px', background: '#FBCFE8', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${result.estimatedPercentile}%`,
                      height: '100%',
                      borderRadius: '999px',
                      background: 'linear-gradient(90deg, #BE185D, #831843)',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Market Comparison Bars */}
            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
              <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>
                Your Offer vs {selectedState} Benchmarks
              </h4>
              <BreakdownBarList
                items={[
                  {
                    label: 'Your annualized cash + CME value',
                    value: result.totalPackageValue,
                    formatted: formatUsd(result.totalPackageValue),
                    color: 'linear-gradient(90deg, #BE185D, #EC4899)',
                  },
                  {
                    label: `${selectedState} 25th percentile`,
                    value: result.anchorP25,
                    formatted: formatUsd(result.anchorP25),
                    color: 'linear-gradient(90deg, #94A3B8, #64748B)',
                  },
                  {
                    label: `${selectedState} median (${stateRow.liveMedian !== null ? `live postings, ${stateRow.liveEmployers} employers` : 'BLS May 2025'})`,
                    value: result.anchorMedian,
                    formatted: formatUsd(result.anchorMedian),
                    color: 'linear-gradient(90deg, #6366F1, #4338CA)',
                  },
                  {
                    label: `${selectedState} 75th percentile`,
                    value: result.anchorP75,
                    formatted: formatUsd(result.anchorP75),
                    color: 'linear-gradient(90deg, #059669, #10B981)',
                  },
                ]}
              />
            </div>

            {/* Negotiation Levers */}
            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)' }}>
              <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
                Tailored Counter-Offer Talking Points
              </h4>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {result.negotiationLevers.map((line) => (
                  <li key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12.5px', color: '#334155', lineHeight: 1.55 }}>
                    <CheckCircle2 size={15} color={TOOL_ACCENT} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <Link
                href={`/jobs/state/${stateRow.slug}`}
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
                Browse open {selectedState} {brand.niche.short} jobs <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/total-comp-comparator"
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
                Compare against a second offer <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
