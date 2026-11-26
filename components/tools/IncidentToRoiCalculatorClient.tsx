'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckSquare, ShieldAlert } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  INCIDENT_TO_COMPLIANCE_RULES,
  computeIncidentToRoi,
  type IncidentToInputs,
} from './employer-ops-models';
import { TOOL_ACCENT, clayCard, formatUsd } from './tool-theme';

export default function IncidentToRoiCalculatorClient() {
  const defaults: IncidentToInputs = {
    annualTotalVisits: 3800,
    medicarePayerSharePct: 35,
    medicarePhysicianFeeScheduleAllowed: 132,
    commercialFollows85SharePct: 15,
    commercialPhysicianAllowed: 155,
    compliantQualifyingVisitsPct: 45,
    mdSupervisionHoursPerWeek: 2,
    mdHourlyCost: 145,
    workingWeeksPerYear: 47,
  };

  const [inputs, setInputs] = useState<IncidentToInputs>(defaults);
  const [checkedRules, setCheckedRules] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,
  });

  const set = <K extends keyof IncidentToInputs>(k: K, v: IncidentToInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const res = useMemo(() => computeIncidentToRoi(inputs), [inputs]);
  const allRulesChecked = INCIDENT_TO_COMPLIANCE_RULES.every((_, idx) => checkedRules[idx]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              CMS 42 CFR 410.26 Care-Team Model
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Medicare 85% direct NPI billing vs 100% compliant incident-to revenue
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              vis: inputs.annualTotalVisits,
              med: inputs.medicarePayerSharePct,
              q: inputs.compliantQualifyingVisitsPct,
              mdh: inputs.mdSupervisionHoursPerWeek,
            }}
            showPrint
            onReset={() => setInputs(defaults)}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <SliderNumberField
              id="inc-visits"
              label="Annual completed clinician visits"
              value={inputs.annualTotalVisits}
              min={800}
              max={7500}
              step={100}
              suffix="visits/yr"
              onChange={(v) => set('annualTotalVisits', v)}
            />
            <SliderNumberField
              id="inc-med-pct"
              label="Medicare fee-for-service / Medicare Advantage share (%)"
              value={inputs.medicarePayerSharePct}
              min={0}
              max={90}
              step={5}
              suffix="%"
              onChange={(v) => set('medicarePayerSharePct', v)}
            />
            <SliderNumberField
              id="inc-med-pfs"
              label="100% Medicare Physician Fee Schedule allowed per visit"
              value={inputs.medicarePhysicianFeeScheduleAllowed}
              min={65}
              max={260}
              step={2}
              prefix="$"
              hint={`At 85% direct NPI billing, each visit reimburses ${formatUsd(inputs.medicarePhysicianFeeScheduleAllowed * 0.85)}.`}
              onChange={(v) => set('medicarePhysicianFeeScheduleAllowed', v)}
            />
            <SliderNumberField
              id="inc-comm85"
              label="Commercial payer share that mirrors 85% / incident-to (%)"
              value={inputs.commercialFollows85SharePct}
              min={0}
              max={60}
              step={5}
              suffix="%"
              hint="Only enter commercial plans whose provider manual explicitly permits incident-to."
              onChange={(v) => set('commercialFollows85SharePct', v)}
            />
            <SliderNumberField
              id="inc-comm-pfs"
              label="Commercial physician allowed per visit"
              value={inputs.commercialPhysicianAllowed}
              min={80}
              max={320}
              step={5}
              prefix="$"
              onChange={(v) => set('commercialPhysicianAllowed', v)}
            />
            <SliderNumberField
              id="inc-qual-pct"
              label="Share of visits meeting ALL incident-to rules (%)"
              value={inputs.compliantQualifyingVisitsPct}
              min={0}
              max={90}
              step={5}
              suffix="%"
              hint="Established patient + established MD plan + no new problem + MD physically in office suite."
              onChange={(v) => set('compliantQualifyingVisitsPct', v)}
            />
            <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <SliderNumberField
                id="inc-md-hrs"
                label="MD supervision hrs/wk"
                value={inputs.mdSupervisionHoursPerWeek}
                min={0}
                max={12}
                step={0.5}
                onChange={(v) => set('mdSupervisionHoursPerWeek', v)}
              />
              <SliderNumberField
                id="inc-md-cost"
                label="MD hourly cost ($)"
                value={inputs.mdHourlyCost}
                min={80}
                max={300}
                step={5}
                prefix="$"
                onChange={(v) => set('mdHourlyCost', v)}
              />
            </div>
          </div>

          {/* Right Output */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              aria-live="polite"
              style={{
                padding: '22px',
                borderRadius: '18px',
                background:
                  res.netAnnualLiftAfterSupervision >= 0
                    ? 'linear-gradient(145deg, #FDF2F8, #FCE7F3)'
                    : 'linear-gradient(145deg, #FEF2F2, #FEE2E2)',
                border: '1.5px solid rgba(190,24,93,0.24)',
              }}
            >
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Net Annual Revenue Lift (After MD Supervision Time)
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, color: '#831843', lineHeight: 1.08, fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
                {formatUsd(res.netAnnualLiftAfterSupervision)}
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.55 }}>
                Gross 15% fee-schedule recapture of <strong>{formatUsd(res.grossIncidentToLift)}</strong> across{' '}
                <strong>{Math.round(res.qualifyingIncidentToMedicareVisits).toLocaleString('en-US')} qualifying Medicare visits</strong>{' '}
                (plus eligible commercial encounters), less <strong>{formatUsd(res.annualMdSupervisionCost)}</strong> in physician supervision time.
              </p>
            </div>

            <div style={{ padding: '16px 18px', borderRadius: '15px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.08)' }}>
              <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>
                Annual Reimbursement Comparison
              </h4>
              <BreakdownBarList
                items={[
                  {
                    label: '100% Direct NPI Billing (85% Medicare PFS)',
                    value: res.allDirect85Revenue,
                    formatted: formatUsd(res.allDirect85Revenue),
                    color: 'linear-gradient(90deg, #64748B, #475569)',
                  },
                  {
                    label: 'Hybrid Compliant Incident-To + Direct Billing',
                    value: res.hybridCompliantIncidentToRevenue,
                    formatted: formatUsd(res.hybridCompliantIncidentToRevenue),
                    color: 'linear-gradient(90deg, #BE185D, #EC4899)',
                  },
                ]}
              />
            </div>

            {/* Interactive CMS Audit Readiness Checklist */}
            <div style={{ padding: '18px', borderRadius: '15px', background: allRulesChecked ? '#ECFDF5' : '#FEF3C7', border: allRulesChecked ? '1.5px solid rgba(5,150,105,0.28)' : '1.5px solid rgba(217,119,6,0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                {allRulesChecked ? <CheckSquare size={17} color="#047857" /> : <ShieldAlert size={17} color="#B45309" />}
                <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
                  CMS 42 CFR 410.26 Incident-To Compliance Gate
                </h4>
              </div>
              <p style={{ fontSize: '12px', color: '#334155', margin: '0 0 10px', lineHeight: 1.5 }}>
                Uncheck any condition that is NOT met on a given encounter; whenever even one box fails, CMS requires billing directly under the rendering clinician’s NPI at 85%.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {INCIDENT_TO_COMPLIANCE_RULES.map((rule, idx) => {
                  const cbId = `inc-rule-${idx}`;
                  return (
                    <label
                      key={rule.title}
                      htmlFor={cbId}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '9px',
                        padding: '9px 11px',
                        borderRadius: '10px',
                        background: 'rgba(255,255,255,0.82)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        id={cbId}
                        className="tool-control"
                        type="checkbox"
                        checked={Boolean(checkedRules[idx])}
                        onChange={(e) => setCheckedRules((prev) => ({ ...prev, [idx]: e.target.checked }))}
                        style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: TOOL_ACCENT }}
                      />
                      <span style={{ fontSize: '12px', color: '#1A2E35', lineHeight: 1.48 }}>
                        <strong>{rule.title}:</strong> {rule.detail}
                      </span>
                    </label>
                  );
                })}
              </div>
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
                Hire for your care team <ArrowRight size={15} />
              </Link>
              <Link
                href="/tools/clinic-profitability-calculator"
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
                Full seat P&L modeler <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
