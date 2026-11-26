'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, Download } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  buildCredentialingIcs,
  computeCredentialingTimeline,
  type CredentialingInputs,
} from './employer-ops-models';
import { TOOL_ACCENT, clayCard, controlStyle, labelStyle } from './tool-theme';

export default function CredentialingTimelinePlannerClient() {
  const defaults: CredentialingInputs = {
    targetGoLiveIso: '2027-03-01',
    alreadyLicensedInState: false,
    needsHospitalPrivileges: false,
    stateBonDays: 35,
    deaAndCsrDays: 21,
    caqhAndMalpracticeDays: 14,
    payerPanelingDays: 75,
    hospitalPrivilegingDays: 90,
    ehrAndOnboardingDays: 14,
  };

  const [inputs, setInputs] = useState<CredentialingInputs>(defaults);
  const set = <K extends keyof CredentialingInputs>(k: K, v: CredentialingInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const plan = useMemo(() => computeCredentialingTimeline(inputs), [inputs]);
  const totalSpan = Math.max(1, plan.totalLeadTimeCalendarDays);

  const downloadIcs = () => {
    const ics = buildCredentialingIcs(plan, `${brand.niche.short} Onboarding`);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `np-credentialing-golive-${plan.targetGoLiveIso}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Reverse Go-Live Gantt Planner
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Work backwards from your target first billable patient day
            </h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={downloadIcs}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '10px',
                border: 'none',
                background: TOOL_ACCENT,
                color: '#FFFFFF',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Download size={14} /> Export .ics Calendar
            </button>
            <ShareableToolbar
              queryParams={{
                date: inputs.targetGoLiveIso,
                lic: inputs.alreadyLicensedInState ? 1 : 0,
                hosp: inputs.needsHospitalPrivileges ? 1 : 0,
                pay: inputs.payerPanelingDays,
              }}
              showPrint
              onReset={() => setInputs(defaults)}
            />
          </div>
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="cred-golive" style={labelStyle}>Target first billable patient day</label>
              <input
                id="cred-golive"
                className="tool-control"
                type="date"
                value={inputs.targetGoLiveIso}
                onChange={(e) => set('targetGoLiveIso', e.target.value)}
                style={controlStyle}
              />
            </div>

            <label
              htmlFor="cred-licensed"
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
                id="cred-licensed"
                className="tool-control"
                type="checkbox"
                checked={inputs.alreadyLicensedInState}
                onChange={(e) => set('alreadyLicensedInState', e.target.checked)}
                style={{ width: '17px', height: '17px', accentColor: TOOL_ACCENT }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>
                Candidate already holds active in-state APRN license
              </span>
            </label>

            <label
              htmlFor="cred-hosp"
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
                id="cred-hosp"
                className="tool-control"
                type="checkbox"
                checked={inputs.needsHospitalPrivileges}
                onChange={(e) => set('needsHospitalPrivileges', e.target.checked)}
                style={{ width: '17px', height: '17px', accentColor: TOOL_ACCENT }}
              />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>
                Role requires hospital or ASC medical-staff privileging
              </span>
            </label>

            {!inputs.alreadyLicensedInState && (
              <SliderNumberField
                id="cred-bon"
                label="State BON endorsement / initial APRN processing (days)"
                value={inputs.stateBonDays}
                min={7}
                max={120}
                step={1}
                suffix="days"
                hint="Enter your state board’s current processing turnaround."
                onChange={(v) => set('stateBonDays', v)}
              />
            )}

            <SliderNumberField
              id="cred-caqh"
              label="NPI taxonomy, CAQH attestation & malpractice COI (days)"
              value={inputs.caqhAndMalpracticeDays}
              min={3}
              max={45}
              step={1}
              suffix="days"
              onChange={(v) => set('caqhAndMalpracticeDays', v)}
            />

            <SliderNumberField
              id="cred-dea"
              label="Federal DEA & state CSR registration (days)"
              value={inputs.deaAndCsrDays}
              min={0}
              max={75}
              step={1}
              suffix="days"
              onChange={(v) => set('deaAndCsrDays', v)}
            />

            <SliderNumberField
              id="cred-payer"
              label="PECOS, Medicaid & commercial payer enrollment (days)"
              value={inputs.payerPanelingDays}
              min={15}
              max={150}
              step={5}
              suffix="days"
              hint="Replace with your slowest major payer’s current roster turnaround."
              onChange={(v) => set('payerPanelingDays', v)}
            />

            {inputs.needsHospitalPrivileges && (
              <SliderNumberField
                id="cred-priv"
                label="Hospital MEC & Governing Board privileging (days)"
                value={inputs.hospitalPrivilegingDays}
                min={30}
                max={180}
                step={5}
                suffix="days"
                onChange={(v) => set('hospitalPrivilegingDays', v)}
              />
            )}

            <SliderNumberField
              id="cred-ehr"
              label="EHR build, EPCS token & clinical orientation (days)"
              value={inputs.ehrAndOnboardingDays}
              min={3}
              max={45}
              step={1}
              suffix="days"
              onChange={(v) => set('ehrAndOnboardingDays', v)}
            />
          </div>

          {/* Right Gantt Timeline */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <Calendar size={15} /> Latest Safe Signed-Offer Date
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#831843', lineHeight: 1.12, fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                {plan.latestOfferSignIso}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '6px 0 0', lineHeight: 1.55 }}>
                Total critical-path lead time: <strong>{plan.totalLeadTimeCalendarDays} calendar days</strong> before your{' '}
                <strong>{plan.targetGoLiveIso}</strong> target go-live date. Add recruiting time on top to decide when to post the job.
              </p>
            </div>

            {/* Visual Gantt Bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {plan.milestones.map((m) => {
                const leftPct = Math.max(0, ((totalSpan - m.offsetStartDaysBeforeGoLive) / totalSpan) * 100);
                const widthPct = Math.max(6, (m.durationDays / totalSpan) * 100);
                return (
                  <div
                    key={m.id}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '14px',
                      background: '#F8FAFC',
                      border: m.criticalPath ? '1.5px solid rgba(190,24,93,0.28)' : '1px solid rgba(0,0,0,0.07)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35' }}>
                        {m.label}
                        {m.criticalPath && (
                          <span style={{ marginLeft: '8px', fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px', background: '#FCE7F3', color: '#9D174D' }}>
                            Critical path
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {m.startIso} to {m.endIso} ({m.durationDays}d)
                      </span>
                    </div>

                    <div style={{ position: 'relative', height: '10px', borderRadius: '999px', background: '#E2E8F0', overflow: 'hidden', marginBottom: '7px' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${Math.min(94, leftPct)}%`,
                          width: `${Math.min(100 - Math.min(94, leftPct), widthPct)}%`,
                          height: '100%',
                          borderRadius: '999px',
                          background: m.criticalPath
                            ? 'linear-gradient(90deg, #BE185D, #EC4899)'
                            : 'linear-gradient(90deg, #6366F1, #4338CA)',
                        }}
                      />
                    </div>

                    <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0, lineHeight: 1.45 }}>{m.note}</p>
                  </div>
                );
              })}
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
                Start recruiting ahead of deadline <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/licensure-checker"
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
                Check state licensure rules <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
