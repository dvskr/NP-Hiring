'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { ShareableToolbar, SliderNumberField, ZeroPhiBanner } from './ToolUiHelpers';
import {
  MDM_DATA_OPTIONS,
  MDM_PROBLEMS_OPTIONS,
  MDM_RISK_OPTIONS,
  computeEmLevel,
  type EmPatientType,
  type MdmComplexity,
  type MdmElementOption,
} from './clinical-coding-models';
import { TOOL_ACCENT, clayCard } from './tool-theme';

function MdmColumn({
  heading,
  options,
  value,
  onSelect,
}: {
  heading: string;
  options: readonly MdmElementOption[];
  value: MdmComplexity;
  onSelect: (lvl: MdmComplexity) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {heading}
      </h4>
      {options.map((opt) => {
        const active = opt.level === value;
        return (
          <button
            key={opt.level}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(opt.level)}
            style={{
              textAlign: 'left',
              padding: '12px 13px',
              borderRadius: '13px',
              cursor: 'pointer',
              border: active ? '2px solid #BE185D' : '1px solid rgba(0,0,0,0.09)',
              background: active ? '#FDF2F8' : '#FFFFFF',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: '12.5px', fontWeight: 800, color: active ? '#9D174D' : '#1A2E35', marginBottom: '3px' }}>
              {opt.title}
            </div>
            <div style={{ fontSize: '11.5px', color: '#5A4A42', lineHeight: 1.42 }}>{opt.examples}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function EmCodingCalculatorClient() {
  const [patientType, setPatientType] = useState<EmPatientType>('established');
  const [problems, setProblems] = useState<MdmComplexity>('moderate');
  const [data, setData] = useState<MdmComplexity>('low');
  const [risk, setRisk] = useState<MdmComplexity>('moderate');
  const [totalMinutes, setTotalMinutes] = useState(26);

  const res = useMemo(
    () => computeEmLevel({ patientType, problems, data, risk, totalMinutes }),
    [patientType, problems, data, risk, totalMinutes],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <ZeroPhiBanner text="Educational 2023+ AMA outpatient E/M leveling matrix. Runs 100% in your browser; never enter patient names, MRNs, or clinical text." />

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { id: 'established' as const, label: 'Established Patient (99212 to 99215)' },
              { id: 'new' as const, label: 'New Patient (99202 to 99205)' },
            ].map((tab) => {
              const active = patientType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPatientType(tab.id)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '12px',
                    fontSize: '13.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: active ? '1.5px solid #BE185D' : '1.5px solid rgba(0,0,0,0.1)',
                    background: active ? 'linear-gradient(145deg, #BE185D, #9D174D)' : '#F8FAFC',
                    color: active ? '#FFFFFF' : '#334155',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <ShareableToolbar
            queryParams={{ pt: patientType, p: problems, d: data, r: risk, m: totalMinutes }}
            onReset={() => {
              setPatientType('established');
              setProblems('moderate');
              setData('low');
              setRisk('moderate');
              setTotalMinutes(26);
            }}
          />
        </div>

        {/* Live Result Banner */}
        <div
          aria-live="polite"
          style={{
            padding: '20px 22px',
            borderRadius: '18px',
            background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
            border: '1.5px solid rgba(190,24,93,0.25)',
            marginBottom: '22px',
          }}
        >
          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '16px', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Supported Outpatient E/M Code · {res.recommendedMethod}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '4px' }}>
                <span style={{ fontSize: '40px', fontWeight: 800, color: '#831843', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {res.recommendedCode}
                </span>
                <span style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                  {res.recommendedWrvu.toFixed(2)} CMS wRVU
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.5 }}>
                Under AMA 2023+ outpatient E/M guidelines, you may select the visit level supported by <strong>either</strong>{' '}
                2-of-3 Medical Decision Making ({res.mdmCode}, {res.mdmOverallComplexity}) <strong>or</strong> Total Time on the date of the encounter ({res.timeCode ?? 'below time floor'}).
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ padding: '12px 14px', borderRadius: '13px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#5A4A42' }}>By 2-of-3 MDM</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                  {res.mdmCode}
                </div>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', textTransform: 'capitalize' }}>
                  {res.mdmOverallComplexity} ({res.mdmWrvu.toFixed(2)} wRVU)
                </div>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: '13px', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#5A4A42' }}>By Total Time ({res.timeMinutes}m)</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                  {res.timeCode ?? 'n/a'}
                </div>
                <div style={{ fontSize: '11.5px', color: '#5A4A42' }}>
                  {res.timeCode ? `${res.timeWrvu.toFixed(2)} wRVU` : 'Use MDM'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3-Column MDM Matrix */}
        <div style={{ marginBottom: '22px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>
            Method A · Medical Decision Making (Highest Level Met by at Least 2 of 3 Elements)
          </h3>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            <MdmColumn heading="1. Problems Addressed" options={MDM_PROBLEMS_OPTIONS} value={problems} onSelect={setProblems} />
            <MdmColumn heading="2. Data Reviewed & Analyzed" options={MDM_DATA_OPTIONS} value={data} onSelect={setData} />
            <MdmColumn heading="3. Risk of Morbidity" options={MDM_RISK_OPTIONS} value={risk} onSelect={setRisk} />
          </div>
        </div>

        {/* Total Time Slider */}
        <div style={{ padding: '18px 20px', borderRadius: '16px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Clock size={16} color={TOOL_ACCENT} />
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
              Method B · Total Clinician Time on Date of Encounter (Face-to-Face + Non-Face-to-Face)
            </h3>
          </div>
          <SliderNumberField
            id="em-minutes"
            label="Total same-calendar-day clinician minutes (pre-charting, exam, counseling, orders, care coordination, note)"
            value={totalMinutes}
            min={5}
            max={105}
            step={1}
            suffix="min"
            hint={res.nextTimeTierHint}
            onChange={setTotalMinutes}
          />
          {(res.prolongedCommercial99417Units > 0 || res.prolongedMedicareG2212Units > 0) && (
            <div style={{ marginTop: '10px', padding: '10px 13px', borderRadius: '11px', background: '#ECFDF5', border: '1px solid rgba(5,150,105,0.25)', fontSize: '12.5px', color: '#064E3B', fontWeight: 700 }}>
              Prolonged Services Threshold Reached: Commercial CPT 99417 = {res.prolongedCommercial99417Units} unit(s) · Medicare HCPCS G2212 = {res.prolongedMedicareG2212Units} unit(s).
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '18px' }}>
          <Link
            href="/tools/wrvu-calculator"
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
            Model annual wRVU bonus impact <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
