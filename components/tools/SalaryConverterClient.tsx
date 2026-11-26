'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  SHIFT_SCHEDULE_PRESETS,
  convertClinicianPay,
  type PayInputUnit,
  type ShiftSchedulePresetId,
} from './clinician-comp-models';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, labelStyle, selectStyle } from './tool-theme';

export default function SalaryConverterClient() {
  const [presetId, setPresetId] = useState<ShiftSchedulePresetId>('3x12');
  const [amount, setAmount] = useState(72);
  const [unit, setUnit] = useState<PayInputUnit>('hourly');
  const [shiftsPerWeek, setShiftsPerWeek] = useState(3);
  const [hoursPerShift, setHoursPerShift] = useState(12);
  const [paidPtoWeeks, setPaidPtoWeeks] = useState(4);
  const [unpaidAdminHoursPerWeek, setUnpaidAdminHoursPerWeek] = useState(3);
  const [isHourlyUnpaidTimeOff, setIsHourlyUnpaidTimeOff] = useState(false);

  const applyPreset = (id: ShiftSchedulePresetId) => {
    setPresetId(id);
    const found = SHIFT_SCHEDULE_PRESETS.find((p) => p.id === id);
    if (found) {
      setShiftsPerWeek(found.shiftsPerWeek);
      setHoursPerShift(found.hoursPerShift);
    }
  };

  const res = useMemo(
    () =>
      convertClinicianPay({
        amount,
        unit,
        shiftsPerWeek,
        hoursPerShift,
        paidPtoWeeks,
        unpaidAdminHoursPerWeek,
        isHourlyUnpaidTimeOff,
      }),
    [amount, unit, shiftsPerWeek, hoursPerShift, paidPtoWeeks, unpaidAdminHoursPerWeek, isHourlyUnpaidTimeOff],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Shift & Schedule Pay Math
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Convert hourly, per-shift, weekly, and annual compensation
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              amt: amount,
              u: unit,
              sh: shiftsPerWeek,
              hr: hoursPerShift,
              pto: paidPtoWeeks,
              ch: unpaidAdminHoursPerWeek,
            }}
            onReset={() => {
              applyPreset('3x12');
              setAmount(72);
              setUnit('hourly');
              setPaidPtoWeeks(4);
              setUnpaidAdminHoursPerWeek(3);
              setIsHourlyUnpaidTimeOff(false);
            }}
          />
        </div>

        {/* Schedule Preset Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {SHIFT_SCHEDULE_PRESETS.map((p) => {
            const active = presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyPreset(p.id)}
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

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label htmlFor="scv-amount" style={labelStyle}>Pay amount ($)</label>
                <input
                  id="scv-amount"
                  className="tool-control"
                  type="number"
                  min={0}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                  style={controlStyle}
                />
              </div>
              <div>
                <label htmlFor="scv-unit" style={labelStyle}>Pay period</label>
                <select
                  id="scv-unit"
                  className="tool-control"
                  value={unit}
                  onChange={(e) => {
                    const next = e.target.value as PayInputUnit;
                    setUnit(next);
                    if (next === 'annual' && amount < 1000) setAmount(135000);
                    if (next === 'hourly' && amount > 1000) setAmount(70);
                    if (next === 'shift' && (amount < 150 || amount > 5000)) setAmount(860);
                  }}
                  style={selectStyle}
                >
                  <option value="hourly">Per Hour</option>
                  <option value="shift">Per Shift</option>
                  <option value="weekly">Per Week</option>
                  <option value="biweekly">Biweekly (26/yr)</option>
                  <option value="monthly">Per Month</option>
                  <option value="annual">Annual Salary</option>
                </select>
              </div>
            </div>

            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="scv-shifts"
                label="Shifts per week"
                value={shiftsPerWeek}
                min={1}
                max={6}
                step={0.5}
                onChange={(v) => {
                  setPresetId('custom');
                  setShiftsPerWeek(v);
                }}
              />
              <SliderNumberField
                id="scv-hrs"
                label="Hours per shift"
                value={hoursPerShift}
                min={4}
                max={16}
                step={1}
                suffix="hrs"
                onChange={(v) => {
                  setPresetId('custom');
                  setHoursPerShift(v);
                }}
              />
            </div>

            <SliderNumberField
              id="scv-pto"
              label="Time off / PTO weeks per year"
              value={paidPtoWeeks}
              min={0}
              max={12}
              step={1}
              suffix="wks"
              onChange={setPaidPtoWeeks}
            />

            <SliderNumberField
              id="scv-chart"
              label="Unpaid charting / inbox hours per worked week"
              value={unpaidAdminHoursPerWeek}
              min={0}
              max={15}
              step={0.5}
              suffix="hrs/wk"
              onChange={setUnpaidAdminHoursPerWeek}
            />

            {(unit === 'hourly' || unit === 'shift' || unit === 'weekly') && (
              <label
                htmlFor="scv-unpaid-off"
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
                  id="scv-unpaid-off"
                  className="tool-control"
                  type="checkbox"
                  checked={isHourlyUnpaidTimeOff}
                  onChange={(e) => setIsHourlyUnpaidTimeOff(e.target.checked)}
                  style={{ width: '17px', height: '17px', accentColor: TOOL_ACCENT }}
                />
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#1A2E35' }}>
                  PRN / Per Diem / 1099 (weeks off are unpaid rather than paid PTO)
                </span>
              </label>
            )}
          </div>

          {/* Right Equivalent Table & True Hourly */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                Annual Gross Pay ({res.scheduledWeeklyHours} scheduled hrs/wk)
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#831843', lineHeight: 1.08, fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                {formatUsd(res.annualGross)}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.55 }}>
                Nominal scheduled rate: <strong>${res.nominalHourlyRate.toFixed(2)}/hr</strong> · True worked rate (factoring{' '}
                {paidPtoWeeks} wks off and {Math.round(res.unpaidChartingAnnualDragHours)} unpaid charting hrs/yr):{' '}
                <strong>${res.trueWorkedHourlyRate.toFixed(2)}/hr</strong>.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {[
                { label: 'Per Hour (scheduled)', val: `$${res.nominalHourlyRate.toFixed(2)}` },
                { label: 'True Worked Hourly', val: `$${res.trueWorkedHourlyRate.toFixed(2)}` },
                { label: `Per ${hoursPerShift}-hr Shift`, val: formatUsd(res.perShiftGross) },
                { label: 'Weekly Gross', val: formatUsd(res.weeklyGross) },
                { label: 'Biweekly (26 paychecks)', val: formatUsd(res.biweeklyGross) },
                { label: 'Monthly Gross', val: formatUsd(res.monthlyGross) },
              ].map((tile) => (
                <div key={tile.label} style={{ padding: '13px 15px', borderRadius: '13px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
                  <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>{tile.label}</div>
                  <div style={{ fontSize: '19px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>
                    {tile.val}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.07)' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
                Annual Hours Breakdown
              </h4>
              <BreakdownBarList
                items={[
                  {
                    label: 'Direct clinical shift hours worked',
                    value: res.actualClinicalHoursWorked,
                    formatted: `${Math.round(res.actualClinicalHoursWorked).toLocaleString('en-US')} hrs`,
                    color: 'linear-gradient(90deg, #BE185D, #EC4899)',
                  },
                  {
                    label: 'Uncompensated charting & inbox hours',
                    value: res.unpaidChartingAnnualDragHours,
                    formatted: `${Math.round(res.unpaidChartingAnnualDragHours).toLocaleString('en-US')} hrs`,
                    color: 'linear-gradient(90deg, #D97706, #F59E0B)',
                  },
                ]}
              />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <Link
                href="/tools/1099-vs-w2-calculator"
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
                Calculate after-tax take-home <ArrowRight size={15} />
              </Link>
              <Link
                href="/jobs"
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
                Browse open roles <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
