'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, CheckCircle2, Download, GraduationCap, Plus, Trash2 } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { BreakdownBarList, ShareableToolbar, SliderNumberField, ZeroPhiBanner } from './ToolUiHelpers';
import {
  CERTIFICATION_BOARD_RULES,
  ROTATION_DOMAINS,
  computeClinicalHoursProgress,
  formatClinicalHoursCsv,
  type ClinicalLogEntry,
  type RotationDomain,
} from './clinician-regulatory-models';
import { TOOL_ACCENT, clayCard, controlStyle, iconTile, labelStyle, selectStyle } from './tool-theme';

const STORAGE_KEY = 'npClinicalHoursLogV1';

const SAMPLE_ENTRIES: ClinicalLogEntry[] = [
  {
    id: 'sample-1',
    dateIso: '2026-09-14',
    domain: 'Adult & Chronic Care',
    siteLabel: 'Community Family Health Center',
    preceptorInitials: 'M.R.',
    directHours: 136,
  },
  {
    id: 'sample-2',
    dateIso: '2026-10-05',
    domain: 'Pediatrics & Adolescent',
    siteLabel: 'Metro Pediatric Associates',
    preceptorInitials: 'A.K.',
    directHours: 84,
  },
  {
    id: 'sample-3',
    dateIso: '2026-10-26',
    domain: "Women's Health & Perinatal",
    siteLabel: 'Regional Women’s Clinic',
    preceptorInitials: 'S.L.',
    directHours: 64,
  },
  {
    id: 'sample-4',
    dateIso: '2026-11-12',
    domain: 'Geriatrics & Complex Care',
    siteLabel: 'Senior Care Outpatient Group',
    preceptorInitials: 'D.T.',
    directHours: 72,
  },
];

const TARGET_PRESETS = [
  { label: '500 hrs (MSN / Post-Master’s Min)', hours: 500 },
  { label: '750 hrs (Extended MSN Track)', hours: 750 },
  { label: '1,000 hrs (DNP Standard)', hours: 1000 },
] as const;

export default function ClinicalHoursTrackerClient({ nicheShort = 'NP' }: { nicheShort?: string }) {
  const [targetHours, setTargetHours] = useState(500);
  const [plannedWeeklyHours, setPlannedWeeklyHours] = useState(16);
  const [entries, setEntries] = useState<ClinicalLogEntry[]>(SAMPLE_ENTRIES);
  const [hydrated, setHydrated] = useState(false);

  // Entry form inputs
  const [dateIso, setDateIso] = useState('2026-11-26');
  const [domain, setDomain] = useState<RotationDomain>('Adult & Chronic Care');
  const [siteLabel, setSiteLabel] = useState('');
  const [preceptorInitials, setPreceptorInitials] = useState('');
  const [directHours, setDirectHours] = useState(12);

  // 5-year recertification readiness inputs
  const [ceLogged, setCeLogged] = useState(30);
  const [pharmCeLogged, setPharmCeLogged] = useState(12);
  const [practiceHoursLogged, setPracticeHoursLogged] = useState(650);
  const [mateActComplete, setMateActComplete] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.entries)) {
          setEntries(parsed.entries);
        }
        if (parsed && typeof parsed.targetHours === 'number' && parsed.targetHours >= 100) {
          setTargetHours(parsed.targetHours);
        }
        if (parsed && typeof parsed.plannedWeeklyHours === 'number' && parsed.plannedWeeklyHours >= 1) {
          setPlannedWeeklyHours(parsed.plannedWeeklyHours);
        }
      }
      const params = new URLSearchParams(window.location.search);
      const t = Number(params.get('target'));
      if (Number.isFinite(t) && t >= 100 && t <= 2000) setTargetHours(t);
      const w = Number(params.get('wk'));
      if (Number.isFinite(w) && w >= 1 && w <= 60) setPlannedWeeklyHours(w);
    } catch {
      // Ignore storage parse failures
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ targetHours, plannedWeeklyHours, entries }),
      );
    } catch {
      // Ignore quota errors
    }
  }, [hydrated, targetHours, plannedWeeklyHours, entries]);

  const progress = useMemo(
    () => computeClinicalHoursProgress(entries, targetHours, plannedWeeklyHours),
    [entries, targetHours, plannedWeeklyHours],
  );

  const handleAddShift = () => {
    const cleanHours = Math.max(0.5, Number(directHours) || 0);
    const nextEntry: ClinicalLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dateIso: dateIso || '2026-11-26',
      domain,
      siteLabel: siteLabel.trim() || 'Outpatient Clinical Site',
      preceptorInitials: preceptorInitials.trim().slice(0, 8) || 'N/A',
      directHours: Math.round(cleanHours * 10) / 10,
    };
    setEntries((prev) => [nextEntry, ...prev]);
    setSiteLabel('');
    setPreceptorInitials('');
  };

  const handleDelete = (id: string) => {
    setEntries((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDownloadCsv = () => {
    const csv = formatClinicalHoursCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nicheShort.toLowerCase()}-clinical-rotation-hours.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setTargetHours(500);
    setPlannedWeeklyHours(16);
    setEntries(SAMPLE_ENTRIES);
    setCeLogged(30);
    setPharmCeLogged(12);
    setPracticeHoursLogged(650);
    setMateActComplete(false);
  };

  const domainBars = ROTATION_DOMAINS.map((d) => ({
    label: d,
    value: progress.byDomain[d],
    formatted: `${progress.byDomain[d]} hrs`,
    sublabel:
      progress.loggedDirectHours > 0
        ? `${Math.round((progress.byDomain[d] / progress.loggedDirectHours) * 100)}% of logged`
        : '0%',
  }));

  return (
    <div>
      <ToolStyles />
      <ZeroPhiBanner text="Rotation entries save only in your browser localStorage. Log generic clinic names and preceptor initials only. Never type patient names, dates of birth, or medical record numbers." />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {TARGET_PRESETS.map((preset) => {
            const active = targetHours === preset.hours;
            return (
              <button
                key={preset.hours}
                type="button"
                onClick={() => setTargetHours(preset.hours)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '999px',
                  border: active ? `1.5px solid ${TOOL_ACCENT}` : '1px solid rgba(0,0,0,0.12)',
                  background: active ? '#FDF2F8' : '#FFFFFF',
                  color: active ? '#9D174D' : '#334155',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <ShareableToolbar
          queryParams={{ target: targetHours, wk: plannedWeeklyHours }}
          onReset={handleReset}
          showPrint
          printLabel="Print rotation summary"
        />
      </div>

      <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
        {/* Left Column: Targets + Add Rotation Shift */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ ...clayCard, padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
              <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
                <GraduationCap size={20} color="#fff" />
              </span>
              <div>
                <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
                  Program target & weekly pace
                </h2>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '2px 0 0' }}>
                  Direct patient care hours required for graduation and national board sit eligibility
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <SliderNumberField
                id="cht-target"
                label="Program direct clinical hours target"
                value={targetHours}
                min={100}
                max={1500}
                step={25}
                suffix="hrs"
                hint="ANCC and AANPCB require at least 500 faculty-supervised direct hours; DNP tracks typically require 1,000 total post-BSN hours."
                onChange={setTargetHours}
              />
              <SliderNumberField
                id="cht-weekly"
                label="Planned clinical preceptorship pace"
                value={plannedWeeklyHours}
                min={4}
                max={40}
                step={2}
                suffix="hrs/wk"
                hint="Used to project how many clinical weeks remain until completion."
                onChange={setPlannedWeeklyHours}
              />
            </div>
          </div>

          <div className="no-print" style={{ ...clayCard, padding: '24px' }}>
            <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>
              Log a rotation shift or term block
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label htmlFor="cht-date" style={labelStyle}>
                  Date or term end
                </label>
                <input
                  id="cht-date"
                  className="tool-control"
                  type="date"
                  value={dateIso}
                  onChange={(e) => setDateIso(e.target.value)}
                  style={controlStyle}
                />
              </div>
              <div>
                <label htmlFor="cht-hours" style={labelStyle}>
                  Direct patient hours
                </label>
                <input
                  id="cht-hours"
                  className="tool-control"
                  type="number"
                  min={0.5}
                  max={500}
                  step={0.5}
                  value={directHours}
                  onChange={(e) => setDirectHours(Number(e.target.value))}
                  style={controlStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="cht-domain" style={labelStyle}>
                Population / rotation domain
              </label>
              <select
                id="cht-domain"
                className="tool-control"
                value={domain}
                onChange={(e) => setDomain(e.target.value as RotationDomain)}
                style={selectStyle}
              >
                {ROTATION_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label htmlFor="cht-site" style={labelStyle}>
                  Clinic or hospital unit label
                </label>
                <input
                  id="cht-site"
                  className="tool-control"
                  type="text"
                  placeholder="e.g., Valley Family Practice"
                  value={siteLabel}
                  onChange={(e) => setSiteLabel(e.target.value)}
                  style={controlStyle}
                />
              </div>
              <div>
                <label htmlFor="cht-preceptor" style={labelStyle}>
                  Preceptor initials
                </label>
                <input
                  id="cht-preceptor"
                  className="tool-control"
                  type="text"
                  maxLength={8}
                  placeholder="e.g., J.D."
                  value={preceptorInitials}
                  onChange={(e) => setPreceptorInitials(e.target.value)}
                  style={controlStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                onClick={handleAddShift}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '11px 18px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                  color: '#FFF',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} />
                Add clinical hours
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={entries.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '11px 16px',
                  borderRadius: '12px',
                  border: '1.5px solid rgba(190,24,93,0.28)',
                  background: '#FFF',
                  color: '#9D174D',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: entries.length === 0 ? 0.5 : 1,
                }}
              >
                <Download size={15} />
                Export CSV log
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Live Progress & Domain Breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div
            style={{
              ...clayCard,
              padding: '24px',
              background: 'linear-gradient(145deg, #FFFDFB 0%, #FDF2F8 100%)',
              border: '1.5px solid rgba(190,24,93,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: TOOL_ACCENT }}>
                Direct clinical hours progress
              </span>
              <span style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35' }}>
                {progress.completionPct}% complete
              </span>
            </div>

            <div style={{ fontSize: 'clamp(1.9rem, 3.5vw, 2.5rem)', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {progress.loggedDirectHours.toLocaleString()} <span style={{ fontSize: '16px', fontWeight: 600, color: '#5A4A42' }}>of {progress.targetTotalHours.toLocaleString()} hrs</span>
            </div>

            <div style={{ height: '14px', borderRadius: '999px', background: '#FCE7F3', overflow: 'hidden', margin: '14px 0 18px' }}>
              <div
                style={{
                  width: `${progress.completionPct}%`,
                  height: '100%',
                  borderRadius: '999px',
                  background: progress.completionPct >= 100 ? 'linear-gradient(90deg, #059669, #10B981)' : 'linear-gradient(90deg, #BE185D, #EC4899)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Remaining</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {progress.remainingHours} hrs
                </div>
              </div>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>Est. weeks left</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                  {progress.estimatedWeeksToFinish} wks
                </div>
              </div>
              <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11.5px', color: '#5A4A42', fontWeight: 600 }}>500-hr board gate</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: progress.loggedDirectHours >= 500 ? '#047857' : '#B45309', marginTop: '4px' }}>
                  {progress.loggedDirectHours >= 500 ? 'Cleared' : `${Math.max(0, 500 - progress.loggedDirectHours)} hrs to go`}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...clayCard, padding: '24px' }}>
            <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>
              Hours by population & specialty domain
            </h3>
            <BreakdownBarList items={domainBars} maxOverride={Math.max(150, ...domainBars.map((d) => d.value))} />
          </div>
        </div>
      </div>

      {/* Logged Entries Table */}
      <div style={{ ...clayCard, padding: '24px', marginTop: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
            Saved rotation log ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
          </h3>
          {entries.length > 0 && (
            <button
              type="button"
              className="no-print"
              onClick={() => setEntries([])}
              style={{
                background: 'none',
                border: 'none',
                color: '#991B1B',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Clear all entries
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0 }}>
            No shifts logged yet. Add your first clinical rotation block above or click Reset to restore sample entries.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '10px 8px' }}>Date</th>
                  <th style={{ padding: '10px 8px' }}>Domain</th>
                  <th style={{ padding: '10px 8px' }}>Clinical site</th>
                  <th style={{ padding: '10px 8px' }}>Preceptor</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Direct hrs</th>
                  <th className="no-print" style={{ padding: '10px 8px', width: '44px' }} aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '10px 8px', fontVariantNumeric: 'tabular-nums', color: '#334155' }}>{item.dateIso}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600, color: '#1A2E35' }}>{item.domain}</td>
                    <td style={{ padding: '10px 8px', color: '#475569' }}>{item.siteLabel}</td>
                    <td style={{ padding: '10px 8px', color: '#475569' }}>{item.preceptorInitials}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                      {item.directHours}
                    </td>
                    <td className="no-print" style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        aria-label={`Delete ${item.siteLabel} entry`}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748B',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ANCC vs AANPCB Certification & 5-Year Recertification Planner */}
      <div style={{ ...clayCard, padding: '26px', marginTop: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <span style={{ ...iconTile, background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
            <Award size={20} color="#fff" />
          </span>
          <div>
            <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>
              ANCC vs AANPCB initial certification & 5-year renewal planner
            </h2>
            <p style={{ fontSize: '13px', color: '#5A4A42', margin: '2px 0 0' }}>
              Compare national board rules and check your 5-year continuing education plus DEA MATE Act readiness
            </p>
          </div>
        </div>

        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '22px' }}>
          {CERTIFICATION_BOARD_RULES.map((b) => {
            const ceReady = ceLogged >= b.renewalCeHours;
            const pharmReady = pharmCeLogged >= b.pharmacologyCeHours;
            const pracReady = b.board === 'ANCC' ? true : practiceHoursLogged >= 1000;
            const allReady = ceReady && pharmReady && pracReady;
            return (
              <div
                key={b.board}
                style={{
                  borderRadius: '16px',
                  padding: '20px',
                  background: '#F8FAFC',
                  border: allReady ? '1.5px solid rgba(5,150,105,0.35)' : '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35' }}>{b.board}</span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: allReady ? '#ECFDF5' : '#FEF3C7',
                      color: allReady ? '#065F46' : '#92400E',
                    }}
                  >
                    {allReady ? '5-Yr CE & Practice Met' : 'In Progress'}
                  </span>
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: TOOL_ACCENT, marginBottom: '8px' }}>
                  {b.credentials} · {b.fullName}
                </div>
                <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.55, margin: '0 0 10px' }}>{b.focusSummary}</p>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#334155', lineHeight: 1.65 }}>
                  <li>
                    <strong>Initial grad direct hours:</strong> {b.minimumDirectGradHours} supervised hours minimum
                  </li>
                  <li>
                    <strong>5-year CE total:</strong> {b.renewalCeHours} contact hours ({Math.max(0, b.renewalCeHours - ceLogged)} remaining)
                  </li>
                  <li>
                    <strong>Pharmacology CE:</strong> {b.pharmacologyCeHours} pharmacotherapeutic hours ({Math.max(0, b.pharmacologyCeHours - pharmCeLogged)} remaining)
                  </li>
                  <li>
                    <strong>Renewal pathway:</strong> {b.practiceHoursOption}
                  </li>
                </ul>
              </div>
            );
          })}
        </div>

        <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
          <SliderNumberField
            id="cht-ce"
            label="Total CE contact hours logged"
            value={ceLogged}
            min={0}
            max={120}
            step={1}
            suffix="CH"
            onChange={setCeLogged}
          />
          <SliderNumberField
            id="cht-pharm"
            label="Pharmacology CE hours logged"
            value={pharmCeLogged}
            min={0}
            max={50}
            step={1}
            suffix="CH"
            onChange={setPharmCeLogged}
          />
          <SliderNumberField
            id="cht-prac"
            label="5-year clinical practice hours"
            value={practiceHoursLogged}
            min={0}
            max={2500}
            step={50}
            suffix="hrs"
            onChange={setPracticeHoursLogged}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '14px 16px',
            borderRadius: '12px',
            background: mateActComplete ? '#ECFDF5' : '#FFFBEB',
            border: mateActComplete ? '1px solid rgba(5,150,105,0.28)' : '1px solid rgba(217,119,6,0.28)',
          }}
        >
          <label htmlFor="cht-mate" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#1A2E35', fontWeight: 600 }}>
            <input
              id="cht-mate"
              className="tool-control"
              type="checkbox"
              checked={mateActComplete}
              onChange={(e) => setMateActComplete(e.target.checked)}
              style={{ width: '17px', height: '17px', accentColor: TOOL_ACCENT }}
            />
            Completed federal 8-hour DEA MATE Act substance-use disorder training (one-time requirement for DEA initial or renewal registration)
          </label>
          {mateActComplete && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#065F46' }}>
              <CheckCircle2 size={15} /> DEA MATE satisfied
            </span>
          )}
        </div>

        <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#5A4A42' }}>
            Graduating soon? Explore new-graduate friendly fellowships and outpatient clinics.
          </span>
          <Link
            href="/jobs/new-grad"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              borderRadius: '10px',
              background: TOOL_ACCENT,
              color: '#FFF',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Browse new-grad {nicheShort} jobs
          </Link>
        </div>
      </div>
    </div>
  );
}
