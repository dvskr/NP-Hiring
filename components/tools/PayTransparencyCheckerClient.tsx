'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { brand } from '@/config/brand';
import type { StateSalarySnapshot } from '@/lib/tools-salary-data';
import ToolStyles from './ToolStyles';
import { ShareableToolbar, SliderNumberField, saveDraftAndOpenPostJob } from './ToolUiHelpers';
import {
  PAY_TRANSPARENCY_JURISDICTIONS,
  evaluatePayTransparency,
  type PayTransparencyTier,
} from './employer-ops-models';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, labelStyle, selectStyle } from './tool-theme';

interface Props {
  states: readonly StateSalarySnapshot[];
}

export default function PayTransparencyCheckerClient({ states }: Props) {
  const [selectedState, setSelectedState] = useState('Colorado');
  const [headcount, setHeadcount] = useState(25);
  const [workMode, setWorkMode] = useState<'In-Person' | 'Hybrid' | 'Remote'>('In-Person');
  const [remoteNationwide, setRemoteNationwide] = useState(true);
  const [tableFilter, setTableFilter] = useState<'all' | PayTransparencyTier | 'history_ban'>('all');
  const [searchText, setSearchText] = useState('');

  const verdict = useMemo(
    () =>
      evaluatePayTransparency({
        state: selectedState,
        employerHeadcount: headcount,
        workMode,
        remoteNationwide,
      }),
    [selectedState, headcount, workMode, remoteNationwide],
  );

  const market = useMemo(
    () => states.find((s) => s.state === selectedState) ?? null,
    [states, selectedState],
  );

  const suggestedMin = market?.liveP25 ?? market?.blsP25 ?? 118000;
  const suggestedMax = market?.liveP75 ?? market?.blsP75 ?? 154000;

  const filteredTable = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return PAY_TRANSPARENCY_JURISDICTIONS.filter((r) => {
      if (tableFilter === 'history_ban' && r.salaryHistoryBan !== 'statewide_ban') return false;
      if (tableFilter !== 'all' && tableFilter !== 'history_ban' && r.tier !== tableFilter) return false;
      if (q && !`${r.state} ${r.stateCode} ${r.effectiveLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tableFilter, searchText]);

  const postingRequiredCount = useMemo(
    () => PAY_TRANSPARENCY_JURISDICTIONS.filter((r) => r.tier === 'posting_required').length,
    [],
  );

  const handleOpenPostJob = () => {
    saveDraftAndOpenPostJob({
      title: `${brand.niche.long} (${selectedState})`,
      location: workMode === 'Remote' ? `Remote (${selectedState})` : selectedState,
      mode: workMode,
      jobType: 'Full-Time',
      salaryPeriod: 'annual',
      salaryMin: suggestedMin,
      salaryMax: suggestedMax,
      benefits: ['Health Insurance', 'Dental & Vision', 'PTO / Vacation', 'CME Allowance', 'Malpractice Coverage', '401k / Retirement'],
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <ToolStyles />

      {/* Top Checker Card */}
      <div style={{ ...clayCard, padding: '26px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Interactive Compliance Check
            </span>
            <h3 style={{ fontSize: '19px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Configure your job posting location & employer size
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{ state: selectedState, emp: headcount, mode: workMode, nat: remoteNationwide ? 1 : 0 }}
            onReset={() => {
              setSelectedState('Colorado');
              setHeadcount(25);
              setWorkMode('In-Person');
              setRemoteNationwide(true);
            }}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '22px' }}>
          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label htmlFor="pt-state" style={labelStyle}>Primary job state / jurisdiction</label>
              <select
                id="pt-state"
                className="tool-control"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                style={selectStyle}
              >
                {PAY_TRANSPARENCY_JURISDICTIONS.map((r) => (
                  <option key={r.state} value={r.state}>{r.state} ({r.stateCode})</option>
                ))}
              </select>
            </div>

            <SliderNumberField
              id="pt-headcount"
              label="Total organization employee headcount"
              value={headcount}
              min={1}
              max={200}
              step={1}
              suffix="staff"
              hint="State pay-transparency thresholds range from 1+ (CO, DC, MD) up to 50+ (HI)."
              onChange={setHeadcount}
            />

            <div>
              <label htmlFor="pt-mode" style={labelStyle}>Work arrangement</label>
              <select
                id="pt-mode"
                className="tool-control"
                value={workMode}
                onChange={(e) => setWorkMode(e.target.value as 'In-Person' | 'Hybrid' | 'Remote')}
                style={selectStyle}
              >
                <option value="In-Person">In-Person clinic / hospital</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Remote">100% Remote telehealth</option>
              </select>
            </div>

            {workMode === 'Remote' && (
              <label
                htmlFor="pt-remote-nat"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: '#F8FAFC',
                  border: '1px solid rgba(0,0,0,0.08)',
                  cursor: 'pointer',
                }}
              >
                <input
                  id="pt-remote-nat"
                  className="tool-control"
                  type="checkbox"
                  checked={remoteNationwide}
                  onChange={(e) => setRemoteNationwide(e.target.checked)}
                  style={{ width: '17px', height: '17px', marginTop: '2px', accentColor: TOOL_ACCENT }}
                />
                <span style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                  <strong>Open to multi-state / nationwide remote applicants:</strong> Triggers the strictest-state rule because candidates residing in Colorado, Washington, California, New York, or Maryland may apply.
                </span>
              </label>
            )}
          </div>

          {/* Verdict Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              aria-live="polite"
              style={{
                padding: '20px 22px',
                borderRadius: '16px',
                background: verdict.mustPublishRangeNow
                  ? 'linear-gradient(145deg, #FDF2F8, #FCE7F3)'
                  : 'linear-gradient(145deg, #EEF2FF, #E0E7FF)',
                border: verdict.mustPublishRangeNow
                  ? '1.5px solid rgba(190,24,93,0.28)'
                  : '1.5px solid rgba(67,56,202,0.22)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {verdict.mustPublishRangeNow ? (
                  <ShieldAlert size={19} color="#BE185D" />
                ) : (
                  <ShieldCheck size={19} color="#4338CA" />
                )}
                <span style={{ fontSize: '11.5px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: verdict.mustPublishRangeNow ? '#9D174D' : '#3730A3' }}>
                  {verdict.rule.effectiveLabel}
                </span>
              </div>
              <h4 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px', lineHeight: 1.25 }}>
                {verdict.headline}
              </h4>
              <p style={{ fontSize: '13.5px', color: '#334155', margin: '0 0 12px', lineHeight: 1.55 }}>
                {verdict.rule.summary}
              </p>

              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {verdict.checklist.map((line) => (
                  <li key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12.5px', color: '#1A2E35', lineHeight: 1.5 }}>
                    <CheckCircle2 size={15} color="#059669" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Market Band Card */}
            <div style={{ padding: '16px 18px', borderRadius: '14px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                {selectedState} {brand.niche.short} Market Pay Anchor
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'baseline', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '11.5px', color: '#5A4A42' }}>25th to 75th percentile band</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                    {formatUsd(suggestedMin)} to {formatUsd(suggestedMax)}
                  </div>
                </div>
                {market?.liveMedian !== null && market?.liveMedian !== undefined && (
                  <div>
                    <div style={{ fontSize: '11.5px', color: '#5A4A42' }}>Live posted median ({market.liveEmployers} employers)</div>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: TOOL_ACCENT, fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(market.liveMedian)}
                    </div>
                  </div>
                )}
                {market?.blsMedian !== null && market?.blsMedian !== undefined && (
                  <div>
                    <div style={{ fontSize: '11.5px', color: '#5A4A42' }}>BLS May 2025 median</div>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(market.blsMedian)}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleOpenPostJob}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '10px 16px',
                  borderRadius: '11px',
                  border: 'none',
                  background: TOOL_ACCENT,
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Use this compliant band in Post a Job <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 51-Jurisdiction Reference Matrix */}
      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>
              All 51 Jurisdictions: 2026 to 2027 Pay Transparency & Salary-History Matrix
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {[
                { id: 'all' as const, label: 'All (51)' },
                { id: 'posting_required' as const, label: `Posting Range Required (${postingRequiredCount})` },
                { id: 'upcoming_posting_law' as const, label: 'Enacted Upcoming (2027)' },
                { id: 'milestone_disclosure' as const, label: 'Interview / Request Disclosure' },
                { id: 'history_ban' as const, label: 'Statewide Salary-History Ban' },
              ].map((chip) => {
                const active = tableFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTableFilter(chip.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                      background: active ? '#FDF2F8' : '#F8FAFC',
                      color: active ? '#9D174D' : '#334155',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ minWidth: '220px' }}>
            <label htmlFor="pt-table-search" style={labelStyle}>Filter state</label>
            <input
              id="pt-table-search"
              className="tool-control"
              type="search"
              placeholder="Search state..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ ...controlStyle, padding: '9px 12px', fontSize: '13.5px' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '680px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.08)', textAlign: 'left' }}>
                <th style={{ padding: '9px 10px', color: '#334155', fontWeight: 800 }}>Jurisdiction</th>
                <th style={{ padding: '9px 10px', color: '#334155', fontWeight: 800 }}>Job Ad Range Rule</th>
                <th style={{ padding: '9px 10px', color: '#334155', fontWeight: 800 }}>Headcount Floor</th>
                <th style={{ padding: '9px 10px', color: '#334155', fontWeight: 800 }}>Benefits in Ad</th>
                <th style={{ padding: '9px 10px', color: '#334155', fontWeight: 800 }}>Salary-History Ban</th>
              </tr>
            </thead>
            <tbody>
              {filteredTable.map((row) => (
                <tr
                  key={row.state}
                  onClick={() => setSelectedState(row.state)}
                  style={{
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                    cursor: 'pointer',
                    background: row.state === selectedState ? '#FDF2F8' : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px', fontWeight: 800, color: '#1A2E35' }}>
                    {row.state} ({row.stateCode})
                  </td>
                  <td style={{ padding: '10px', color: '#334155' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background:
                          row.tier === 'posting_required'
                            ? '#FCE7F3'
                            : row.tier === 'upcoming_posting_law'
                              ? '#FEF3C7'
                              : row.tier === 'milestone_disclosure'
                                ? '#E0E7FF'
                                : '#F1F5F9',
                        color:
                          row.tier === 'posting_required'
                            ? '#9D174D'
                            : row.tier === 'upcoming_posting_law'
                              ? '#92400E'
                              : row.tier === 'milestone_disclosure'
                                ? '#3730A3'
                                : '#475569',
                      }}
                    >
                      {row.effectiveLabel}
                    </span>
                  </td>
                  <td style={{ padding: '10px', color: '#5A4A42', fontVariantNumeric: 'tabular-nums' }}>
                    {row.minEmployees > 0 ? `${row.minEmployees}+ employees` : 'n/a'}
                  </td>
                  <td style={{ padding: '10px', color: '#5A4A42' }}>
                    {row.requiresBenefitsInPost ? 'Required' : 'Optional'}
                  </td>
                  <td style={{ padding: '10px', color: '#5A4A42' }}>
                    {row.salaryHistoryBan === 'statewide_ban'
                      ? 'Statewide ban'
                      : row.salaryHistoryBan === 'public_employers_only'
                        ? 'Public agencies'
                        : 'No statewide ban'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
