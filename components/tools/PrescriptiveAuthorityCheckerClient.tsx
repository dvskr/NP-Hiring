'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { ShareableToolbar } from './ToolUiHelpers';
import {
  PRESCRIPTIVE_AUTHORITY_RULES,
  type Schedule2Pathway,
} from './clinician-regulatory-models';
import { TOOL_ACCENT, clayCard, controlStyle, labelStyle, selectStyle } from './tool-theme';

export default function PrescriptiveAuthorityCheckerClient() {
  const [selectedState, setSelectedState] = useState('Texas');
  const [filterMode, setFilterMode] = useState<'all' | 'csr_required' | Schedule2Pathway>('all');
  const [search, setSearch] = useState('');

  const active = useMemo(
    () => PRESCRIPTIVE_AUTHORITY_RULES.find((r) => r.state === selectedState) ?? PRESCRIPTIVE_AUTHORITY_RULES[0],
    [selectedState],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PRESCRIPTIVE_AUTHORITY_RULES.filter((r) => {
      if (filterMode === 'csr_required' && !r.separateStateCsrRequired) return false;
      if (filterMode !== 'all' && filterMode !== 'csr_required' && r.schedule2Pathway !== filterMode) return false;
      if (q && !`${r.state} ${r.authorityLabel} ${r.stateCsrAgencyLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filterMode, search]);

  const stateSlug = active.state.toLowerCase().replace(/\s+/g, '-');
  const csrCount = useMemo(
    () => PRESCRIPTIVE_AUTHORITY_RULES.filter((r) => r.separateStateCsrRequired).length,
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              51-Jurisdiction Prescribing Lookup
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Schedule II to V authority, state CSR/CDS registration & practice details
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{ state: selectedState }}
            onReset={() => {
              setSelectedState('Texas');
              setFilterMode('all');
              setSearch('');
            }}
          />
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.25fr)', gap: '22px', alignItems: 'start' }}>
          {/* Left Selector + DEA Federal Box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="pa-state" style={labelStyle}>Select state or DC</label>
              <select
                id="pa-state"
                className="tool-control"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                style={selectStyle}
              >
                {PRESCRIPTIVE_AUTHORITY_RULES.map((r) => (
                  <option key={r.state} value={r.state}>{r.state}</option>
                ))}
              </select>
            </div>

            <div style={{ padding: '16px 18px', borderRadius: '14px', background: '#EEF2FF', border: '1.5px solid rgba(67,56,202,0.2)' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#3730A3', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                Federal DEA & MATE Act Baseline (Applies Nationwide)
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#1E1B4B', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>
                  <strong>DEA Registration + State Tie:</strong> Every state where you prescribe controlled substances (including via telehealth) requires a federal DEA registration tied to a practice address and active prescriptive authority in that state.
                </li>
                <li>
                  <strong>8-Hour MATE Act Training:</strong> Initial DEA applicants and renewals must attest to completing 8 hours of training on opioid or other substance-use disorders.
                </li>
                <li>
                  <strong>Telehealth Controlled Substances:</strong> Verify current DEA/HHS telemedicine flexibilities and each patient-location state’s in-person exam and PDMP rules before prescribing Schedule II to V medications virtually.
                </li>
              </ul>
            </div>
          </div>

          {/* Right State Detail Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              aria-live="polite"
              style={{
                padding: '22px',
                borderRadius: '18px',
                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                border: '1.5px solid rgba(190,24,93,0.24)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', background: '#FFFFFF', color: '#9D174D' }}>
                  AANP Tier: {active.authorityLabel}
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: active.separateStateCsrRequired ? '#FEF3C7' : '#ECFDF5',
                    color: active.separateStateCsrRequired ? '#92400E' : '#065F46',
                  }}
                >
                  {active.separateStateCsrRequired ? 'Separate State CSR/CDS Required' : 'No Separate State CSR Agency'}
                </span>
              </div>

              <h4 style={{ fontSize: '22px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
                {active.state} Prescriptive Authority
              </h4>

              <div style={{ fontSize: '13.5px', color: '#1A2E35', lineHeight: 1.6, marginBottom: '12px' }}>
                <strong>Schedule II to V Pathway:</strong> {active.scheduleSummary}
              </div>

              <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6, padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.8)', marginBottom: '10px' }}>
                <strong>State Controlled-Substance Registration:</strong> {active.stateCsrAgencyLabel}
              </div>

              <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6, padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,0.8)' }}>
                <strong>Practice Environment in {active.state}:</strong> {active.practiceDetails}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <Link
                href={`/jobs/state/${stateSlug}`}
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
                Browse {active.state} {brand.niche.short} jobs <ArrowRight size={15} />
              </Link>
              <Link
                href={`/blog/np-license-${stateSlug}`}
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
                {active.state} licensure guide <ArrowRight size={14} />
              </Link>
              <Link
                href="/tools/licensure-checker"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '11px 16px',
                  borderRadius: '12px',
                  background: '#EEF2FF',
                  color: '#4338CA',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Multi-state planner <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* 51-State Filterable Table */}
      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: '12px', marginBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '16.5px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>
              Compare All 51 Jurisdictions Side by Side
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {[
                { id: 'all' as const, label: 'All (51)' },
                { id: 'independent_upon_licensure' as const, label: 'Day-One Independent' },
                { id: 'independent_after_transition' as const, label: 'Independent After Transition' },
                { id: 'csr_required' as const, label: `Separate State CSR (${csrCount})` },
                { id: 'schedule_2_specific_limits' as const, label: 'Schedule II Specific Limits' },
              ].map((chip) => {
                const on = filterMode === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilterMode(chip.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: on ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                      background: on ? '#FDF2F8' : '#F8FAFC',
                      color: on ? '#9D174D' : '#334155',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ minWidth: '210px' }}>
            <label htmlFor="pa-search" style={labelStyle}>Filter jurisdiction</label>
            <input
              id="pa-search"
              className="tool-control"
              type="search"
              placeholder="Search state or agency..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...controlStyle, padding: '8px 12px', fontSize: '13.5px' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '680px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(0,0,0,0.08)', textAlign: 'left' }}>
                <th style={{ padding: '9px 10px', fontWeight: 800, color: '#334155' }}>Jurisdiction</th>
                <th style={{ padding: '9px 10px', fontWeight: 800, color: '#334155' }}>AANP Tier</th>
                <th style={{ padding: '9px 10px', fontWeight: 800, color: '#334155' }}>Separate State CSR</th>
                <th style={{ padding: '9px 10px', fontWeight: 800, color: '#334155' }}>Controlled-Substance Summary</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.state}
                  onClick={() => setSelectedState(row.state)}
                  style={{
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                    cursor: 'pointer',
                    background: row.state === selectedState ? '#FDF2F8' : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px', fontWeight: 800, color: '#1A2E35', whiteSpace: 'nowrap' }}>
                    <ShieldCheck size={13} color={TOOL_ACCENT} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'text-bottom' }} />
                    {row.state}
                  </td>
                  <td style={{ padding: '10px', color: '#334155', whiteSpace: 'nowrap' }}>{row.authorityLabel}</td>
                  <td style={{ padding: '10px', color: row.separateStateCsrRequired ? '#92400E' : '#065F46', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {row.separateStateCsrRequired ? 'Yes (separate CSR/CDS)' : 'No'}
                  </td>
                  <td style={{ padding: '10px', color: '#5A4A42', lineHeight: 1.45 }}>{row.scheduleSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
