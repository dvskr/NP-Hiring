'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, DollarSign, Landmark, Trophy } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField } from './ToolUiHelpers';
import {
  NHSC_AWARD_AMOUNTS,
  computeLoanStrategies,
  type NhscTierKey,
} from './clinician-comp-models';
import { FILING_STATUS_LABELS, type FilingStatus } from './federal-tax-model';
import { TOOL_ACCENT, clayCard, iconTile, labelStyle, selectStyle } from './tool-theme';

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

export default function LoanRepaymentCalculatorClient({ nicheShort = 'NP' }: { nicheShort?: string }) {
  const [loanBalance, setLoanBalance] = useState(115000);
  const [interestRatePct, setInterestRatePct] = useState(6.5);
  const [filingStatus, setFilingStatus] = useState<FilingStatus>('single');
  const [nonprofitOrFqhcSalary, setNonprofitOrFqhcSalary] = useState(126000);
  const [privateClinicSalary, setPrivateClinicSalary] = useState(148000);
  const [nhscTier, setNhscTier] = useState<NhscTierKey>('fullTimeHighHpsa');
  const [annualSalaryGrowthPct, setAnnualSalaryGrowthPct] = useState(3);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const bal = Number(p.get('bal'));
      if (Number.isFinite(bal) && bal >= 0) setLoanBalance(bal);
      const rate = Number(p.get('rate'));
      if (Number.isFinite(rate) && rate >= 0 && rate <= 20) setInterestRatePct(rate);
      const fqhc = Number(p.get('fqhc'));
      if (Number.isFinite(fqhc) && fqhc > 0) setNonprofitOrFqhcSalary(fqhc);
      const priv = Number(p.get('priv'));
      if (Number.isFinite(priv) && priv > 0) setPrivateClinicSalary(priv);
      const tier = p.get('tier') as NhscTierKey | null;
      if (tier && tier in NHSC_AWARD_AMOUNTS) setNhscTier(tier);
    } catch {
      // Ignore malformed URL params
    }
  }, []);

  const strategies = useMemo(
    () =>
      computeLoanStrategies({
        loanBalance,
        interestRatePct,
        filingStatus,
        nonprofitOrFqhcSalary,
        privateClinicSalary,
        nhscTier,
        annualSalaryGrowthPct,
      }),
    [
      loanBalance,
      interestRatePct,
      filingStatus,
      nonprofitOrFqhcSalary,
      privateClinicSalary,
      nhscTier,
      annualSalaryGrowthPct,
    ],
  );

  const ranked = useMemo(
    () => [...strategies].sort((a, b) => b.tenYearNetCashAfterDebtAndTax - a.tenYearNetCashAfterDebtAndTax),
    [strategies],
  );
  const best = ranked[0];
  const runnerUp = ranked[1];
  const leadOverSecond = best && runnerUp ? best.tenYearNetCashAfterDebtAndTax - runnerUp.tenYearNetCashAfterDebtAndTax : 0;

  const handleReset = () => {
    setLoanBalance(115000);
    setInterestRatePct(6.5);
    setFilingStatus('single');
    setNonprofitOrFqhcSalary(126000);
    setPrivateClinicSalary(148000);
    setNhscTier('fullTimeHighHpsa');
    setAnnualSalaryGrowthPct(3);
  };

  const barColors: Record<string, string> = {
    pslf: 'linear-gradient(90deg, #BE185D, #EC4899)',
    nhsc: 'linear-gradient(90deg, #059669, #10B981)',
    'nurse-corps': 'linear-gradient(90deg, #0284C7, #38BDF8)',
    'private-payoff': 'linear-gradient(90deg, #475569, #64748B)',
  };

  const bars = strategies.map((s) => ({
    label: s.label,
    value: s.tenYearNetCashAfterDebtAndTax,
    formatted: formatUsd(s.tenYearNetCashAfterDebtAndTax),
    color: barColors[s.id],
    sublabel: s.forgivenOrAwardedPrincipal > 0 ? `${formatUsd(s.forgivenOrAwardedPrincipal)} forgiven/awarded` : '0 forgiven',
  }));

  return (
    <div>
      <ToolStyles />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <ShareableToolbar
          queryParams={{
            bal: loanBalance,
            rate: interestRatePct,
            fqhc: nonprofitOrFqhcSalary,
            priv: privateClinicSalary,
            tier: nhscTier,
          }}
          onReset={handleReset}
          showPrint
          printLabel="Print 10-year comparison"
        />
      </div>

      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.08fr)', gap: '22px', alignItems: 'start' }}>
        {/* Left: Debt & Salary Inputs */}
        <div style={{ ...clayCard, padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
            <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
              <Landmark size={20} color="#fff" />
            </span>
            <div>
              <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                Loan balance & employer pay scenarios
              </h2>
              <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '2px 0 0' }}>
                Compare nonprofit / FQHC forgiveness paths against a higher-paying private clinic
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <SliderNumberField
              id="lrc-balance"
              label="Total qualifying student loan balance"
              value={loanBalance}
              min={10000}
              max={300000}
              step={2500}
              prefix="$"
              onChange={setLoanBalance}
            />
            <SliderNumberField
              id="lrc-rate"
              label="Weighted average loan interest rate"
              value={interestRatePct}
              min={2}
              max={10}
              step={0.1}
              suffix="%"
              onChange={setInterestRatePct}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label htmlFor="lrc-filing" style={labelStyle}>
                  Tax filing status
                </label>
                <select
                  id="lrc-filing"
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
              <div>
                <label htmlFor="lrc-nhsc-tier" style={labelStyle}>
                  HRSA NHSC HPSA award tier
                </label>
                <select
                  id="lrc-nhsc-tier"
                  className="tool-control"
                  value={nhscTier}
                  onChange={(e) => setNhscTier(e.target.value as NhscTierKey)}
                  style={selectStyle}
                >
                  <option value="fullTimeHighHpsa">
                    Full-Time High-Need Primary Care ({formatUsd(NHSC_AWARD_AMOUNTS.fullTimeHighHpsa)})
                  </option>
                  <option value="fullTimeStandardHpsa">
                    Full-Time Standard HPSA ({formatUsd(NHSC_AWARD_AMOUNTS.fullTimeStandardHpsa)})
                  </option>
                  <option value="halfTimeStandardHpsa">
                    Half-Time HPSA ({formatUsd(NHSC_AWARD_AMOUNTS.halfTimeStandardHpsa)})
                  </option>
                </select>
              </div>
            </div>

            <SliderNumberField
              id="lrc-fqhc"
              label="501(c)(3) hospital / FQHC / HPSA starting salary"
              value={nonprofitOrFqhcSalary}
              min={90000}
              max={210000}
              step={2000}
              prefix="$"
              suffix="/yr"
              onChange={setNonprofitOrFqhcSalary}
            />
            <SliderNumberField
              id="lrc-private"
              label="Private clinic / for-profit starting salary"
              value={privateClinicSalary}
              min={95000}
              max={250000}
              step={2000}
              prefix="$"
              suffix="/yr"
              onChange={setPrivateClinicSalary}
            />
            <SliderNumberField
              id="lrc-growth"
              label="Annual salary merit growth assumption"
              value={annualSalaryGrowthPct}
              min={0}
              max={6}
              step={0.5}
              suffix="%/yr"
              onChange={setAnnualSalaryGrowthPct}
            />
          </div>
        </div>

        {/* Right: Winner & 10-Year Net Wealth Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {best && (
            <div
              style={{
                ...clayCard,
                padding: '24px',
                background: 'linear-gradient(145deg, #FFFDFB 0%, #FDF2F8 100%)',
                border: '1.5px solid rgba(190,24,93,0.18)',
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: TOOL_ACCENT, marginBottom: '8px' }}>
                <Trophy size={14} /> Highest 10-year net wealth pathway
              </div>
              <h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px', lineHeight: 1.25 }}>
                {best.label}
              </h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: 'clamp(1.85rem, 3.4vw, 2.45rem)', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(best.tenYearNetCashAfterDebtAndTax)}
                </span>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#047857' }}>
                  +{formatUsd(leadOverSecond)} ahead of #2 over 10 years
                </span>
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', margin: 0, lineHeight: 1.55 }}>{best.note}</p>
            </div>
          )}

          <div style={{ ...clayCard, padding: '24px' }}>
            <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>
              10-year cumulative net cash retained (after federal tax & loan payoff)
            </h3>
            <BreakdownBarList items={bars} />
          </div>
        </div>
      </div>

      {/* Detailed 4-Strategy Matrix */}
      <div style={{ ...clayCard, padding: '24px', marginTop: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <Award size={19} color={TOOL_ACCENT} aria-hidden="true" />
          <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
            Side-by-side 10-year cash & tax breakdown
          </h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '10px 8px' }}>Repayment strategy</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>10-yr gross pay</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Est. federal + FICA</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Out-of-pocket debt paid</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Forgiven / award</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Award tax hit</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>10-yr net cash</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => {
                const isWinner = best?.id === s.id;
                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      background: isWinner ? '#FDF2F8' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '11px 8px', fontWeight: 700, color: '#1A2E35' }}>
                      {s.label}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(s.tenYearGrossEarnings)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', color: '#991B1B', fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(-s.tenYearFederalTax)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', color: '#92400E', fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(-s.totalOutOfPocketLoanPaid)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', color: '#047857', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(s.forgivenOrAwardedPrincipal)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', color: s.awardTaxCost > 0 ? '#991B1B' : '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                      {s.awardTaxCost > 0 ? formatUsd(-s.awardTaxCost) : 'None (Tax-free)'}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(s.tenYearNetCashAfterDebtAndTax)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#5A4A42' }}>
            <DollarSign size={15} color={TOOL_ACCENT} />
            Compare real FQHC, hospital-system, and private-practice {nicheShort} salaries on our job board.
          </span>
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
            Browse {nicheShort} openings
          </Link>
        </div>
      </div>
    </div>
  );
}
