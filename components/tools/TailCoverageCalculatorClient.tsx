'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Scale, Shield, Sparkles } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  NON_COMPETE_STATE_RULES,
  computeTailCoverage,
} from './clinician-regulatory-models';
import { TOOL_ACCENT, clayCard, iconTile, labelStyle, selectStyle } from './tool-theme';

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

export default function TailCoverageCalculatorClient({ nicheShort = 'NP' }: { nicheShort?: string }) {
  const [selectedState, setSelectedState] = useState('Texas');
  const [policyType, setPolicyType] = useState<'claims_made' | 'occurrence'>('claims_made');
  const [yearsOnPolicy, setYearsOnPolicy] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [matureAnnualPremium, setMatureAnnualPremium] = useState(5200);
  const [tailMultiplier, setTailMultiplier] = useState(2.0);
  const [employerPaysTailPct, setEmployerPaysTailPct] = useState(0);
  const [contractBuyoutOrRelocationCost, setContractBuyoutOrRelocationCost] = useState(5000);
  const [marginalTaxRatePct, setMarginalTaxRatePct] = useState(32);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const st = p.get('state');
      if (st && NON_COMPETE_STATE_RULES.some((r) => r.state.toLowerCase() === st.toLowerCase())) {
        const match = NON_COMPETE_STATE_RULES.find((r) => r.state.toLowerCase() === st.toLowerCase());
        if (match) setSelectedState(match.state);
      }
      const pt = p.get('pt');
      if (pt === 'claims_made' || pt === 'occurrence') setPolicyType(pt);
      const yr = Number(p.get('yr'));
      if ([1, 2, 3, 4, 5].includes(yr)) setYearsOnPolicy(yr as 1 | 2 | 3 | 4 | 5);
      const prem = Number(p.get('prem'));
      if (Number.isFinite(prem) && prem >= 0) setMatureAnnualPremium(prem);
      const mult = Number(p.get('mult'));
      if (Number.isFinite(mult) && mult >= 0.5 && mult <= 4) setTailMultiplier(mult);
      const emp = Number(p.get('emp'));
      if (Number.isFinite(emp) && emp >= 0 && emp <= 100) setEmployerPaysTailPct(emp);
      const buy = Number(p.get('buy'));
      if (Number.isFinite(buy) && buy >= 0) setContractBuyoutOrRelocationCost(buy);
    } catch {
      // Ignore malformed query params
    }
  }, []);

  const stateRule = useMemo(
    () => NON_COMPETE_STATE_RULES.find((r) => r.state === selectedState) ?? NON_COMPETE_STATE_RULES[0],
    [selectedState],
  );

  const result = useMemo(
    () =>
      computeTailCoverage({
        policyType,
        matureAnnualPremium,
        yearsOnPolicy,
        tailMultiplier,
        employerPaysTailPct,
        contractBuyoutOrRelocationCost,
        marginalTaxRatePct,
      }),
    [
      policyType,
      matureAnnualPremium,
      yearsOnPolicy,
      tailMultiplier,
      employerPaysTailPct,
      contractBuyoutOrRelocationCost,
      marginalTaxRatePct,
    ],
  );

  const handleReset = () => {
    setSelectedState('Texas');
    setPolicyType('claims_made');
    setYearsOnPolicy(3);
    setMatureAnnualPremium(5200);
    setTailMultiplier(2.0);
    setEmployerPaysTailPct(0);
    setContractBuyoutOrRelocationCost(5000);
    setMarginalTaxRatePct(32);
  };

  const badgePalette =
    stateRule.status === 'broad_statutory_ban'
      ? { bg: '#ECFDF5', border: 'rgba(5,150,105,0.28)', text: '#065F46' }
      : stateRule.status === 'healthcare_restricted_or_threshold'
        ? { bg: '#FFFBEB', border: 'rgba(217,119,6,0.32)', text: '#92400E' }
        : { bg: '#F8FAFC', border: 'rgba(71,85,105,0.28)', text: '#334155' };

  const bars = [
    {
      label: 'Gross extended reporting (tail) endorsement invoice',
      value: result.grossTailPremium,
      formatted: formatUsd(result.grossTailPremium),
      sublabel: policyType === 'occurrence' ? 'Occurrence policy needs no tail' : `${tailMultiplier.toFixed(2)}x step-adjusted base`,
    },
    {
      label: 'Outgoing employer covered tail share',
      value: result.employerCoveredDollars,
      formatted: formatUsd(result.employerCoveredDollars),
      color: 'linear-gradient(90deg, #059669, #10B981)',
      sublabel: `${employerPaysTailPct}% employer share`,
    },
    {
      label: 'Your after-tax exit cost (unpaid tail + buyout/clawback)',
      value: result.totalAfterTaxExitCost,
      formatted: formatUsd(result.totalAfterTaxExitCost),
      color: 'linear-gradient(90deg, #D97706, #F59E0B)',
    },
    {
      label: 'Grossed-up signing bonus counter-ask at next job',
      value: result.grossedUpSigningBonusCounterAsk,
      formatted: formatUsd(result.grossedUpSigningBonusCounterAsk),
      color: 'linear-gradient(90deg, #BE185D, #EC4899)',
      sublabel: `At ${marginalTaxRatePct}% marginal tax withholding`,
    },
  ];

  const stateSlug = selectedState.toLowerCase().replace(/\s+/g, '-');

  return (
    <div>
      <ToolStyles />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <ShareableToolbar
          queryParams={{
            state: selectedState,
            pt: policyType,
            yr: yearsOnPolicy,
            prem: matureAnnualPremium,
            mult: tailMultiplier,
            emp: employerPaysTailPct,
            buy: contractBuyoutOrRelocationCost,
          }}
          onReset={handleReset}
          showPrint
          printLabel="Print exit & tail summary"
        />
      </div>

      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
        {/* Left: State Non-Compete + Malpractice Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ ...clayCard, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
                <Scale size={20} color="#fff" />
              </span>
              <div>
                <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                  State healthcare non-compete lookup
                </h2>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '2px 0 0' }}>
                  Check statutory bans, healthcare practitioner caps, and common-law rules across all 51 jurisdictions
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label htmlFor="tcc-state" style={labelStyle}>
                Practice jurisdiction
              </label>
              <select
                id="tcc-state"
                className="tool-control"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                style={selectStyle}
              >
                {NON_COMPETE_STATE_RULES.map((r) => (
                  <option key={r.state} value={r.state}>
                    {r.state} ({r.badgeLabel})
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                background: badgePalette.bg,
                border: `1.5px solid ${badgePalette.border}`,
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 800, color: badgePalette.text, marginBottom: '6px' }}>
                {stateRule.status === 'broad_statutory_ban' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {selectedState}: {stateRule.badgeLabel}
              </div>
              <p style={{ fontSize: '13px', color: '#1E293B', lineHeight: 1.6, margin: 0 }}>
                {stateRule.summary}
              </p>
            </div>
          </div>

          <div style={{ ...clayCard, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
                <Shield size={20} color="#fff" />
              </span>
              <div>
                <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                  Malpractice policy & contract exit terms
                </h2>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '2px 0 0' }}>
                  Claims-made step rates, carrier tail factor, and sign-on clawback buyout
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label htmlFor="tcc-policy" style={labelStyle}>
                  Malpractice policy type
                </label>
                <select
                  id="tcc-policy"
                  className="tool-control"
                  value={policyType}
                  onChange={(e) => setPolicyType(e.target.value as 'claims_made' | 'occurrence')}
                  style={selectStyle}
                >
                  <option value="claims_made">Claims-Made (Requires Tail / Nose)</option>
                  <option value="occurrence">Occurrence (No Tail Required)</option>
                </select>
              </div>
              <div>
                <label htmlFor="tcc-years" style={labelStyle}>
                  Policy year at exit
                </label>
                <select
                  id="tcc-years"
                  className="tool-control"
                  value={yearsOnPolicy}
                  disabled={policyType === 'occurrence'}
                  onChange={(e) => setYearsOnPolicy(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                  style={{ ...selectStyle, opacity: policyType === 'occurrence' ? 0.55 : 1 }}
                >
                  <option value={1}>Year 1 (35% step factor)</option>
                  <option value={2}>Year 2 (60% step factor)</option>
                  <option value={3}>Year 3 (80% step factor)</option>
                  <option value={4}>Year 4 (92% step factor)</option>
                  <option value={5}>Year 5+ Mature (100% factor)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <SliderNumberField
                id="tcc-prem"
                label="Mature annual malpractice premium"
                value={matureAnnualPremium}
                min={1500}
                max={18000}
                step={250}
                prefix="$"
                suffix="/yr"
                hint="Outpatient primary care policies are often lower than acute care, neonatal, emergency, or procedural policies."
                onChange={setMatureAnnualPremium}
              />
              {policyType === 'claims_made' && (
                <>
                  <SliderNumberField
                    id="tcc-mult"
                    label="Carrier tail endorsement multiplier (typically 1.5x to 2.5x)"
                    value={tailMultiplier}
                    min={1.5}
                    max={2.5}
                    step={0.05}
                    suffix="x"
                    onChange={setTailMultiplier}
                  />
                  <SliderNumberField
                    id="tcc-emp"
                    label="Share of tail paid by outgoing employer"
                    value={employerPaysTailPct}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    onChange={setEmployerPaysTailPct}
                  />
                </>
              )}
              <SliderNumberField
                id="tcc-buyout"
                label="Unvested sign-on clawback, CME repayment, or buyout"
                value={contractBuyoutOrRelocationCost}
                min={0}
                max={50000}
                step={500}
                prefix="$"
                onChange={setContractBuyoutOrRelocationCost}
              />
              <SliderNumberField
                id="tcc-tax"
                label="Combined marginal tax rate on a new signing bonus"
                value={marginalTaxRatePct}
                min={15}
                max={48}
                step={1}
                suffix="%"
                hint="Supplemental bonuses are typically withheld at 22% federal plus FICA and state income tax."
                onChange={setMarginalTaxRatePct}
              />
            </div>
          </div>
        </div>

        {/* Right: Exit Cost & Signing-Bonus Counter-Ask */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div
            style={{
              ...clayCard,
              padding: '24px',
              background: 'linear-gradient(145deg, #FFFDFB 0%, #FDF2F8 100%)',
              border: '1.5px solid rgba(190,24,93,0.18)',
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: TOOL_ACCENT, marginBottom: '6px' }}>
              <Sparkles size={14} /> Next-job signing bonus counter-ask
            </div>
            <div style={{ fontSize: 'clamp(2rem, 3.8vw, 2.75rem)', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {formatUsd(result.grossedUpSigningBonusCounterAsk)}
            </div>
            <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 16px', lineHeight: 1.55 }}>
              Pre-tax sign-on bonus required from your incoming employer (or nose/prior-acts assumption) so your after-tax
              proceeds cover <strong>{formatUsd(result.totalAfterTaxExitCost)}</strong> in unpaid tail and contract exit costs.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Est. current yr premium</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(result.estimatedCurrentAnnualPremium)}
                </div>
              </div>
              <div style={{ background: '#FFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Your unpaid tail bill</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: '#991B1B', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(result.clinicianOutOfPocketTail)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...clayCard, padding: '24px' }}>
            <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>
              Tail & contract exit cost breakdown
            </h3>
            <BreakdownBarList items={bars} />

            <div
              style={{
                marginTop: '18px',
                padding: '14px 16px',
                borderRadius: '12px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: '12.5px',
                color: '#334155',
                lineHeight: 1.6,
              }}
            >
              <strong>Contract negotiation tip:</strong> Ask your incoming clinic or hospital whether their carrier can
              attach <strong>prior-acts (nose) coverage</strong> back to your current retroactive date. Nose coverage is
              often cheaper for the incoming group than reimbursing a standalone tail endorsement.
            </div>
          </div>

          <div style={{ ...clayCard, padding: '20px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1A2E35' }}>
              Explore active {nicheShort} roles in {selectedState}
            </span>
            <Link
              href={`/jobs/state/${stateSlug}`}
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
              View {selectedState} jobs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
