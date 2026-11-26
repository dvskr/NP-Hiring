'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField, ZeroPhiBanner } from './ToolUiHelpers';
import {
  CMS_WRVU_TABLE,
  WRVU_SPECIALTY_PRESETS,
  computeWrvuCompensation,
  type WrvuSpecialtyPresetId,
} from './clinical-coding-models';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd } from './tool-theme';

export default function WrvuCalculatorClient() {
  const initialPreset = WRVU_SPECIALTY_PRESETS[0];
  const [presetId, setPresetId] = useState<WrvuSpecialtyPresetId>(initialPreset.id);
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({ ...initialPreset.dailyCounts });
  const [clinicalDaysPerWeek, setClinicalDaysPerWeek] = useState(initialPreset.clinicalDaysPerWeek);
  const [workingWeeksPerYear, setWorkingWeeksPerYear] = useState(initialPreset.workingWeeksPerYear);
  const [baseSalary, setBaseSalary] = useState(128000);
  const [wrvuThreshold, setWrvuThreshold] = useState(4200);
  const [conversionRate, setConversionRate] = useState(28);

  const selectPreset = (id: WrvuSpecialtyPresetId) => {
    const found = WRVU_SPECIALTY_PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPresetId(id);
    setDailyCounts({ ...found.dailyCounts });
    setClinicalDaysPerWeek(found.clinicalDaysPerWeek);
    setWorkingWeeksPerYear(found.workingWeeksPerYear);
  };

  const res = useMemo(
    () =>
      computeWrvuCompensation({
        dailyCounts,
        clinicalDaysPerWeek,
        workingWeeksPerYear,
        baseSalary,
        annualWrvuThreshold: wrvuThreshold,
        conversionRatePerWrvu: conversionRate,
      }),
    [dailyCounts, clinicalDaysPerWeek, workingWeeksPerYear, baseSalary, wrvuThreshold, conversionRate],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <ZeroPhiBanner text="Aggregate daily CPT counts run locally in your browser. Never enter patient identifiers or chart numbers." />

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              CMS CY2026 Work RVU Schedule
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Pick a specialty preset or enter your daily CPT mix
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              preset: presetId,
              base: baseSalary,
              thr: wrvuThreshold,
              rate: conversionRate,
            }}
            showPrint
            onReset={() => {
              selectPreset('family-practice');
              setBaseSalary(128000);
              setWrvuThreshold(4200);
              setConversionRate(28);
            }}
          />
        </div>

        {/* Specialty Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {WRVU_SPECIALTY_PRESETS.map((p) => {
            const active = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => selectPreset(p.id)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '11px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                  background: active ? '#FDF2F8' : '#F8FAFC',
                  color: active ? '#9D174D' : '#334155',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left: CPT Daily Volume Table */}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
              Daily Encounters & Procedures by CPT Code
            </h4>
            <div style={{ maxHeight: '520px', overflowY: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '14px', background: '#F8FAFC' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ borderBottom: '1.5px solid rgba(0,0,0,0.08)', background: '#FFFFFF', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 800, color: '#334155' }}>CPT</th>
                    <th style={{ textAlign: 'left', padding: '9px 8px', fontWeight: 800, color: '#334155' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 800, color: '#334155' }}>wRVU</th>
                    <th style={{ textAlign: 'right', padding: '9px 12px', fontWeight: 800, color: TOOL_ACCENT }}>Per Day</th>
                  </tr>
                </thead>
                <tbody>
                  {CMS_WRVU_TABLE.map((row) => {
                    const qty = dailyCounts[row.cpt] ?? 0;
                    const inputId = `wrvu-cpt-${row.cpt}`;
                    return (
                      <tr
                        key={row.cpt}
                        style={{
                          borderBottom: '1px solid rgba(0,0,0,0.05)',
                          background: qty > 0 ? '#FDF2F8' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '7px 12px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                          <label htmlFor={inputId} style={{ cursor: 'pointer' }}>{row.cpt}</label>
                        </td>
                        <td style={{ padding: '7px 8px', color: '#334155', lineHeight: 1.35 }}>{row.label}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                          {row.wrvu.toFixed(2)}
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', width: '92px' }}>
                          <input
                            id={inputId}
                            className="tool-control"
                            type="number"
                            min={0}
                            max={60}
                            step={0.5}
                            aria-label={`Daily count for CPT ${row.cpt}`}
                            value={qty}
                            onChange={(e) => {
                              const next = Math.max(0, Number(e.target.value) || 0);
                              setDailyCounts((prev) => ({ ...prev, [row.cpt]: next }));
                            }}
                            style={{
                              ...controlStyle,
                              padding: '6px 8px',
                              fontSize: '13px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Contract Terms + Output */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
              Contract Productivity Terms
            </h4>

            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="wrvu-days"
                label="Clinical days / wk"
                value={clinicalDaysPerWeek}
                min={1}
                max={6}
                step={0.5}
                onChange={setClinicalDaysPerWeek}
              />
              <SliderNumberField
                id="wrvu-weeks"
                label="Working weeks / yr"
                value={workingWeeksPerYear}
                min={36}
                max={52}
                step={1}
                onChange={setWorkingWeeksPerYear}
              />
            </div>

            <SliderNumberField
              id="wrvu-base"
              label="Annual base salary"
              value={baseSalary}
              min={80000}
              max={230000}
              step={1000}
              prefix="$"
              onChange={setBaseSalary}
            />

            <SliderNumberField
              id="wrvu-thresh"
              label="Annual wRVU bonus threshold"
              value={wrvuThreshold}
              min={1500}
              max={8500}
              step={100}
              suffix="wRVUs"
              hint="Contracted annual wRVU floor before productivity bonus dollars kick in."
              onChange={setWrvuThreshold}
            />

            <SliderNumberField
              id="wrvu-rate"
              label="Bonus conversion factor ($ per wRVU above threshold)"
              value={conversionRate}
              min={10}
              max={65}
              step={1}
              prefix="$"
              onChange={setConversionRate}
            />

            {/* Results Card */}
            <div
              aria-live="polite"
              style={{
                padding: '20px 22px',
                borderRadius: '18px',
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                border: '1.5px solid rgba(190,24,93,0.24)',
              }}
            >
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Projected Total Annual Cash Compensation
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#831843', lineHeight: 1.06, fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                {formatUsd(res.totalAnnualCashComp)}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.55 }}>
                <strong>{Math.round(res.annualWrvus).toLocaleString('en-US')} annual wRVUs</strong> ({res.dailyWrvus.toFixed(1)} wRVUs/day across{' '}
                {res.dailyEncounters.toFixed(1)} daily codes) →{' '}
                <strong>{formatUsd(res.annualProductivityBonus)}</strong> productivity bonus above your {wrvuThreshold.toLocaleString('en-US')} threshold.
              </p>
            </div>

            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
              <BreakdownBarList
                items={[
                  {
                    label: 'Guaranteed base salary',
                    value: baseSalary,
                    formatted: formatUsd(baseSalary),
                    color: 'linear-gradient(90deg, #6366F1, #4338CA)',
                  },
                  {
                    label: `wRVU bonus (${Math.round(res.bonusEligibleWrvus).toLocaleString('en-US')} wRVUs × $${conversionRate})`,
                    value: res.annualProductivityBonus,
                    formatted: formatUsd(res.annualProductivityBonus),
                    color: 'linear-gradient(90deg, #BE185D, #EC4899)',
                  },
                ]}
              />
              <p style={{ fontSize: '12px', color: '#5A4A42', margin: '10px 0 0', lineHeight: 1.5 }}>
                <strong>Break-even volume for bonus:</strong> At your average of{' '}
                <strong>{res.averageWrvuPerEncounter.toFixed(2)} wRVU per code</strong>, you hit the{' '}
                {wrvuThreshold.toLocaleString('en-US')} threshold at{' '}
                <strong>{res.breakEvenDailyEncountersForThreshold.toFixed(1)} encounters/day</strong>. Effective blended rate:{' '}
                <strong>${res.effectiveDollarsPerWrvu.toFixed(2)} per total wRVU</strong>.
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <Link
                href="/tools/em-coding-calculator"
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
                Check 99213 vs 99214 E/M rules <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/offer-analyzer"
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
                Benchmark total cash offer <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
