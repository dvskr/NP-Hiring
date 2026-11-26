'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Briefcase, CheckCircle2, Compass, ShieldCheck } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  GSA_DESTINATION_PRESETS,
  computeTravelStipend,
  evaluateIrsTaxHome,
} from './clinician-comp-models';
import { FILING_STATUS_LABELS, type FilingStatus } from './federal-tax-model';
import { TOOL_ACCENT, clayCard, iconTile, labelStyle, selectStyle } from './tool-theme';

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

export default function TravelStipendCalculatorClient({ nicheShort = 'NP' }: { nicheShort?: string }) {
  const [filingStatus, setFilingStatus] = useState<FilingStatus>('single');
  const [presetId, setPresetId] = useState<string>('mid-metro');
  const [taxedHourlyRate, setTaxedHourlyRate] = useState(58);
  const [weeklyHours, setWeeklyHours] = useState(40);
  const [dailyLodgingStipend, setDailyLodgingStipend] = useState(165);
  const [dailyMieStipend, setDailyMieStipend] = useState(80);
  const [stipendDaysPerWeek, setStipendDaysPerWeek] = useState(7);
  const [assignmentWeeksPerYear, setAssignmentWeeksPerYear] = useState(46);
  const [monthlyDuplicatedHousingCost, setMonthlyDuplicatedHousingCost] = useState(1850);
  const [roundTripTravelReimbursement, setRoundTripTravelReimbursement] = useState(1200);
  const [permanentW2ComparisonSalary, setPermanentW2ComparisonSalary] = useState(135000);

  // IRS 3-factor + 12-month screener
  const [regularWorkAtTaxHome, setRegularWorkAtTaxHome] = useState(true);
  const [duplicatedLivingExpenses, setDuplicatedLivingExpenses] = useState(true);
  const [hasNotAbandonedHistoricalHome, setHasNotAbandonedHistoricalHome] = useState(true);
  const [underOneYearAtSingleLocation, setUnderOneYearAtSingleLocation] = useState(true);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const hr = Number(p.get('hr'));
      if (Number.isFinite(hr) && hr > 0) setTaxedHourlyRate(hr);
      const wh = Number(p.get('wh'));
      if (Number.isFinite(wh) && wh > 0) setWeeklyHours(wh);
      const lod = Number(p.get('lod'));
      if (Number.isFinite(lod) && lod >= 0) setDailyLodgingStipend(lod);
      const mie = Number(p.get('mie'));
      if (Number.isFinite(mie) && mie >= 0) setDailyMieStipend(mie);
      const wks = Number(p.get('wks'));
      if (Number.isFinite(wks) && wks >= 1 && wks <= 52) setAssignmentWeeksPerYear(wks);
      const dup = Number(p.get('dup'));
      if (Number.isFinite(dup) && dup >= 0) setMonthlyDuplicatedHousingCost(dup);
      const perm = Number(p.get('perm'));
      if (Number.isFinite(perm) && perm > 0) setPermanentW2ComparisonSalary(perm);
    } catch {
      // Ignore invalid URL query params
    }
  }, []);

  const taxHomeResult = useMemo(
    () =>
      evaluateIrsTaxHome({
        regularWorkAtTaxHome,
        duplicatedLivingExpenses,
        hasNotAbandonedHistoricalHome,
        underOneYearAtSingleLocation,
      }),
    [
      regularWorkAtTaxHome,
      duplicatedLivingExpenses,
      hasNotAbandonedHistoricalHome,
      underOneYearAtSingleLocation,
    ],
  );

  const result = useMemo(
    () =>
      computeTravelStipend({
        filingStatus,
        taxedHourlyRate,
        weeklyHours,
        dailyLodgingStipend: taxHomeResult.eligibleForTaxFreeStipends ? dailyLodgingStipend : 0,
        dailyMieStipend: taxHomeResult.eligibleForTaxFreeStipends ? dailyMieStipend : 0,
        stipendDaysPerWeek,
        assignmentWeeksPerYear,
        monthlyDuplicatedHousingCost,
        roundTripTravelReimbursement: taxHomeResult.eligibleForTaxFreeStipends ? roundTripTravelReimbursement : 0,
        permanentW2ComparisonSalary,
      }),
    [
      filingStatus,
      taxedHourlyRate,
      weeklyHours,
      dailyLodgingStipend,
      dailyMieStipend,
      stipendDaysPerWeek,
      assignmentWeeksPerYear,
      monthlyDuplicatedHousingCost,
      roundTripTravelReimbursement,
      permanentW2ComparisonSalary,
      taxHomeResult.eligibleForTaxFreeStipends,
    ],
  );

  const handlePresetChange = (id: string) => {
    setPresetId(id);
    const found = GSA_DESTINATION_PRESETS.find((g) => g.id === id);
    if (found) {
      setDailyLodgingStipend(found.dailyLodging);
      setDailyMieStipend(found.dailyMie);
    }
  };

  const handleReset = () => {
    setFilingStatus('single');
    handlePresetChange('mid-metro');
    setTaxedHourlyRate(58);
    setWeeklyHours(40);
    setStipendDaysPerWeek(7);
    setAssignmentWeeksPerYear(46);
    setMonthlyDuplicatedHousingCost(1850);
    setRoundTripTravelReimbursement(1200);
    setPermanentW2ComparisonSalary(135000);
    setRegularWorkAtTaxHome(true);
    setDuplicatedLivingExpenses(true);
    setHasNotAbandonedHistoricalHome(true);
    setUnderOneYearAtSingleLocation(true);
  };

  const breakdownItems = [
    {
      label: 'Annual taxed W-2 base wages',
      value: result.annualTaxedWages,
      formatted: formatUsd(result.annualTaxedWages),
      sublabel: `${assignmentWeeksPerYear} wks × ${formatUsd(result.weeklyTaxedPay)}/wk`,
    },
    {
      label: 'Annual tax-free GSA lodging & M&IE stipends',
      value: result.annualTaxFreeStipends,
      formatted: formatUsd(result.annualTaxFreeStipends),
      color: 'linear-gradient(90deg, #059669, #10B981)',
      sublabel: taxHomeResult.eligibleForTaxFreeStipends ? 'Exempt when tax home qualifies' : 'Zeroed (tax home disqualified)',
    },
    {
      label: 'Travel net take-home (after federal tax & primary-home housing)',
      value: result.travelNetTakeHomeAfterHousing,
      formatted: formatUsd(result.travelNetTakeHomeAfterHousing),
      color: 'linear-gradient(90deg, #0284C7, #38BDF8)',
    },
    {
      label: 'Permanent W-2 net take-home (after federal & FICA tax)',
      value: result.permanentW2NetTakeHome,
      formatted: formatUsd(result.permanentW2NetTakeHome),
      color: 'linear-gradient(90deg, #475569, #64748B)',
      sublabel: `${formatUsd(permanentW2ComparisonSalary)} gross`,
    },
  ];

  return (
    <div>
      <ToolStyles />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <ShareableToolbar
          queryParams={{
            hr: taxedHourlyRate,
            wh: weeklyHours,
            lod: dailyLodgingStipend,
            mie: dailyMieStipend,
            wks: assignmentWeeksPerYear,
            dup: monthlyDuplicatedHousingCost,
            perm: permanentW2ComparisonSalary,
          }}
          onReset={handleReset}
          showPrint
          printLabel="Print stipend breakdown"
        />
      </div>

      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
        {/* Left: Contract & GSA Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ ...clayCard, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
              <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
                <Compass size={20} color="#fff" />
              </span>
              <div>
                <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                  Assignment pay & FY2026 GSA per diem
                </h2>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '2px 0 0' }}>
                  Blend taxed W-2 base hourly pay with untaxed lodging and M&IE stipends
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label htmlFor="tsc-preset" style={labelStyle}>
                  FY2026 GSA destination tier
                </label>
                <select
                  id="tsc-preset"
                  className="tool-control"
                  value={presetId}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  style={selectStyle}
                >
                  {GSA_DESTINATION_PRESETS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tsc-filing" style={labelStyle}>
                  Federal tax filing status
                </label>
                <select
                  id="tsc-filing"
                  className="tool-control"
                  value={filingStatus}
                  onChange={(e) => setFilingStatus(e.target.value as FilingStatus)}
                  style={selectStyle}
                >
                  {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map((fs) => (
                    <option key={fs} value={fs}>
                      {FILING_STATUS_LABELS[fs]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <SliderNumberField
                id="tsc-hourly"
                label="Taxed W-2 hourly base rate"
                value={taxedHourlyRate}
                min={20}
                max={130}
                step={1}
                prefix="$"
                suffix="/hr"
                onChange={setTaxedHourlyRate}
              />
              <SliderNumberField
                id="tsc-wh"
                label="Weekly clinical hours"
                value={weeklyHours}
                min={24}
                max={60}
                step={2}
                suffix="hrs/wk"
                onChange={setWeeklyHours}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <SliderNumberField
                  id="tsc-lodging"
                  label="Daily lodging stipend"
                  value={dailyLodgingStipend}
                  min={0}
                  max={400}
                  step={5}
                  prefix="$"
                  suffix="/day"
                  onChange={setDailyLodgingStipend}
                />
                <SliderNumberField
                  id="tsc-mie"
                  label="Daily M&IE stipend"
                  value={dailyMieStipend}
                  min={0}
                  max={120}
                  step={2}
                  prefix="$"
                  suffix="/day"
                  onChange={setDailyMieStipend}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <SliderNumberField
                  id="tsc-days"
                  label="Stipend days per week"
                  value={stipendDaysPerWeek}
                  min={3}
                  max={7}
                  step={1}
                  suffix="days"
                  onChange={setStipendDaysPerWeek}
                />
                <SliderNumberField
                  id="tsc-weeks"
                  label="Assignment weeks per year"
                  value={assignmentWeeksPerYear}
                  min={13}
                  max={50}
                  step={1}
                  suffix="wks"
                  onChange={setAssignmentWeeksPerYear}
                />
              </div>
              <SliderNumberField
                id="tsc-dup"
                label="Monthly primary-home mortgage or lease (duplicated housing)"
                value={monthlyDuplicatedHousingCost}
                min={0}
                max={5000}
                step={50}
                prefix="$"
                suffix="/mo"
                hint="Maintaining a permanent primary residence while paying assignment housing is what justifies tax-free GSA stipends."
                onChange={setMonthlyDuplicatedHousingCost}
              />
              <SliderNumberField
                id="tsc-travel"
                label="Annual tax-free travel / mileage reimbursement"
                value={roundTripTravelReimbursement}
                min={0}
                max={5000}
                step={100}
                prefix="$"
                onChange={setRoundTripTravelReimbursement}
              />
              <SliderNumberField
                id="tsc-perm"
                label="Permanent staff W-2 salary to compare against"
                value={permanentW2ComparisonSalary}
                min={90000}
                max={240000}
                step={2500}
                prefix="$"
                suffix="/yr"
                onChange={setPermanentW2ComparisonSalary}
              />
            </div>
          </div>

          {/* IRS 3-Factor Tax-Home Screener */}
          <div style={{ ...clayCard, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <ShieldCheck size={20} color={TOOL_ACCENT} aria-hidden="true" />
              <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                IRS tax-home & 12-month eligibility screener
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              {[
                {
                  id: 'tsc-th-work',
                  checked: regularWorkAtTaxHome,
                  onChange: setRegularWorkAtTaxHome,
                  text: 'Factor 1: You perform a meaningful portion of work or maintain PRN clinical ties in your home area.',
                },
                {
                  id: 'tsc-th-dup',
                  checked: duplicatedLivingExpenses,
                  onChange: setDuplicatedLivingExpenses,
                  text: 'Factor 2: You incur substantial ongoing mortgage or fair-market lease expenses at your primary home while away.',
                },
                {
                  id: 'tsc-th-hist',
                  checked: hasNotAbandonedHistoricalHome,
                  onChange: setHasNotAbandonedHistoricalHome,
                  text: 'Factor 3: You have not abandoned your historical home (driver license, voter registration, regular return visits).',
                },
                {
                  id: 'tsc-th-yr',
                  checked: underOneYearAtSingleLocation,
                  onChange: setUnderOneYearAtSingleLocation,
                  text: '12-Month Rule: Assignment at this metro area is realistically expected to last 12 months or less.',
                },
              ].map((item) => (
                <label
                  key={item.id}
                  htmlFor={item.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#334155', cursor: 'pointer', lineHeight: 1.5 }}
                >
                  <input
                    id={item.id}
                    className="tool-control"
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => item.onChange(e.target.checked)}
                    style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: TOOL_ACCENT, flexShrink: 0 }}
                  />
                  <span>{item.text}</span>
                </label>
              ))}
            </div>

            <div
              style={{
                padding: '14px 16px',
                borderRadius: '12px',
                background: taxHomeResult.eligibleForTaxFreeStipends ? '#ECFDF5' : '#FEF2F2',
                border: taxHomeResult.eligibleForTaxFreeStipends
                  ? '1.5px solid rgba(5,150,105,0.28)'
                  : '1.5px solid rgba(220,38,38,0.28)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 800, fontSize: '13.5px', color: taxHomeResult.eligibleForTaxFreeStipends ? '#065F46' : '#991B1B', marginBottom: '4px' }}>
                {taxHomeResult.eligibleForTaxFreeStipends ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                {taxHomeResult.statusHeadline}
              </div>
              <p style={{ fontSize: '12.5px', color: taxHomeResult.eligibleForTaxFreeStipends ? '#064E3B' : '#7F1D1D', margin: 0, lineHeight: 1.55 }}>
                {taxHomeResult.explanation}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Blended Package & W-2 Equivalency */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div
            style={{
              ...clayCard,
              padding: '24px',
              background: 'linear-gradient(145deg, #FFFDFB 0%, #FDF2F8 100%)',
              border: '1.5px solid rgba(190,24,93,0.18)',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: TOOL_ACCENT, marginBottom: '6px' }}>
              Blended gross hourly equivalent
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'clamp(2rem, 3.8vw, 2.75rem)', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                ${result.blendedGrossHourly.toFixed(2)}/hr
              </span>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#5A4A42' }}>
                ({formatUsd(result.weeklyGrossBlended)}/wk gross)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Weekly taxed pay</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(result.weeklyTaxedPay)}
                </div>
              </div>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Weekly untaxed stipend</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#047857', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(result.weeklyTaxFreeStipend)}
                </div>
              </div>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Equiv. permanent W-2 gross</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(result.equivalentPermW2GrossNeeded)}
                </div>
              </div>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Net vs perm W-2</div>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 800,
                    color: result.netAdvantageOverPerm >= 0 ? '#047857' : '#B91C1C',
                    marginTop: '2px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {result.netAdvantageOverPerm >= 0 ? '+' : ''}
                  {formatUsd(result.netAdvantageOverPerm)}/yr
                </div>
              </div>
            </div>

            {result.lowTaxedBaseWarning && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '11px 14px',
                  borderRadius: '11px',
                  background: '#FFFBEB',
                  border: '1px solid rgba(217,119,6,0.35)',
                  fontSize: '12.5px',
                  color: '#92400E',
                  lineHeight: 1.5,
                }}
              >
                <strong>IRS wage-recharacterization caution:</strong> Taxed hourly rates below $35/hr for an advanced
                practice clinician can attract IRS scrutiny if stipends are used to disguise base wages. Confirm the
                agency’s reasonable-compensation floor.
              </div>
            )}
          </div>

          <div style={{ ...clayCard, padding: '24px' }}>
            <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>
              Annual gross, tax & housing comparison
            </h3>
            <BreakdownBarList items={breakdownItems} />

            <div style={{ marginTop: '18px', borderTop: '1px solid #E2E8F0', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', color: '#475569' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Annual gross travel package:</span>
                <strong style={{ color: '#1A2E35' }}>{formatUsd(result.annualGrossPackage)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Est. federal income + FICA tax (on taxed base only):</span>
                <strong style={{ color: '#991B1B' }}>{formatUsd(-result.estimatedFederalAndFicaTax)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Primary-home duplicated housing during assignment months:</span>
                <strong style={{ color: '#92400E' }}>{formatUsd(-result.annualDuplicatedHousingOutlay)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px dashed #CBD5E1' }}>
                <span style={{ fontWeight: 700, color: '#1A2E35' }}>Net cash after federal tax & home mortgage/lease:</span>
                <strong style={{ fontSize: '15px', color: '#047857' }}>{formatUsd(result.travelNetTakeHomeAfterHousing)}</strong>
              </div>
            </div>
          </div>

          <div style={{ ...clayCard, padding: '20px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Briefcase size={18} color={TOOL_ACCENT} aria-hidden="true" />
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1A2E35' }}>
                Compare live per diem, contract, and permanent {nicheShort} openings
              </span>
            </div>
            <Link
              href="/jobs"
              style={{
                padding: '9px 15px',
                borderRadius: '10px',
                background: TOOL_ACCENT,
                color: '#FFF',
                fontSize: '12.5px',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Browse {nicheShort} jobs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
