'use client';

/**
 * Shared tactile UI primitives for the /tools interactive suite.
 *
 * Accessibility & repo invariants:
 * - Every <input> and <select> carries `id` as its first attribute and pairs
 *   with an explicit <label>.
 * - Renders <ToolStyles /> so WCAG 2.4.7 focus rings and responsive collapse
 *   travel with every embedded control.
 * - Zero dashes or hyphen ranges in visible copy.
 */
import { useState } from 'react';
import { Check, Link2, Printer, RotateCcw, ShieldAlert } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, controlStyle, labelStyle } from './tool-theme';
import { LOCAL_DRAFT_KEY, LOCAL_DRAFT_SAVED_AT_KEY } from '@/app/post-job/_lib/local-job-draft';

export interface SliderNumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  hint?: string;
  onChange: (next: number) => void;
}

export function SliderNumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  hint,
  onChange,
}: SliderNumberFieldProps) {
  const numId = `${id}-num`;
  const rangeId = `${id}-range`;
  const hintId = hint ? `${id}-hint` : undefined;
  const clampedRange = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

  return (
    <div>
      <ToolStyles />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <label htmlFor={numId} style={{ ...labelStyle, marginBottom: 0 }}>
          {label}
        </label>
      </div>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '13px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '14.5px',
              fontWeight: 700,
              color: '#64748B',
              pointerEvents: 'none',
            }}
          >
            {prefix}
          </span>
        )}
        <input
          id={numId}
          className="tool-control"
          type="number"
          inputMode="decimal"
          min={min}
          max={max * 4}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          aria-describedby={hintId}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
          }}
          style={{
            ...controlStyle,
            padding: '10px 14px',
            paddingLeft: prefix ? '28px' : '14px',
            paddingRight: suffix ? '52px' : '14px',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        {suffix && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: '13px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#64748B',
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <label htmlFor={rangeId} style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {label} slider
      </label>
      <input
        id={rangeId}
        className="tool-control"
        type="range"
        min={min}
        max={max}
        step={step}
        value={clampedRange}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          marginTop: '7px',
          accentColor: TOOL_ACCENT,
          cursor: 'pointer',
          height: '6px',
        }}
      />
      {hint && (
        <p id={hintId} style={{ fontSize: '12px', color: '#5A4A42', margin: '4px 0 0', lineHeight: 1.45 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface BarSegment {
  label: string;
  value: number;
  formatted: string;
  color?: string;
  sublabel?: string;
}

export function BreakdownBarList({ items, maxOverride }: { items: readonly BarSegment[]; maxOverride?: number }) {
  const maxVal = maxOverride ?? Math.max(1, ...items.map((item) => Math.abs(item.value)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {items.map((item) => {
        const pct = Math.min(100, Math.max(2, (Math.abs(item.value) / Math.max(1, maxVal)) * 100));
        return (
          <div key={item.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '5px' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>{item.label}</span>
                {item.sublabel && (
                  <span style={{ fontSize: '12px', color: '#5A4A42', marginLeft: '6px' }}>({item.sublabel})</span>
                )}
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                {item.formatted}
              </span>
            </div>
            <div style={{ height: '10px', borderRadius: '999px', background: '#E2E8F0', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: '999px',
                  background: item.color ?? 'linear-gradient(90deg, #BE185D, #EC4899)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ShareableToolbar({
  queryParams,
  onReset,
  showPrint = false,
  printLabel = 'Print summary',
}: {
  queryParams: Record<string, string | number | boolean | null | undefined>;
  onReset?: () => void;
  showPrint?: boolean;
  printLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const url = new URL(window.location.href);
      url.search = '';
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && String(v) !== '') {
          url.searchParams.set(k, String(v));
        }
      }
      window.history.replaceState(null, '', url.toString());
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  };

  return (
    <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 14px',
          borderRadius: '10px',
          border: '1.5px solid rgba(190,24,93,0.28)',
          background: copied ? '#ECFDF5' : '#FDF2F8',
          color: copied ? '#065F46' : '#9D174D',
          fontSize: '12.5px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {copied ? <Check size={14} /> : <Link2 size={14} />}
        {copied ? 'Copied shareable link!' : 'Copy shareable link'}
      </button>

      {showPrint && (
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(0,0,0,0.12)',
            background: '#FFFFFF',
            color: '#334155',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Printer size={14} />
          {printLabel}
        </button>
      )}

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '8px 13px',
            borderRadius: '10px',
            border: '1px solid rgba(0,0,0,0.10)',
            background: '#F8FAFC',
            color: '#475569',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={13} />
          Reset
        </button>
      )}
    </div>
  );
}

export function ZeroPhiBanner({ text }: { text?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 15px',
        borderRadius: '13px',
        background: '#ECFDF5',
        border: '1.5px solid rgba(5,150,105,0.24)',
        marginBottom: '18px',
      }}
    >
      <ShieldAlert size={17} color="#047857" aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
      <p style={{ fontSize: '12.5px', color: '#064E3B', margin: 0, lineHeight: 1.55 }}>
        <strong>100% browser-only, zero PHI:</strong>{' '}
        {text ??
          'All calculations run locally in your browser. Never enter patient names, medical record numbers, dates of birth, or protected health information.'}
      </p>
    </div>
  );
}

export interface PostJobDraftHandoff {
  title?: string;
  companyName?: string;
  location?: string;
  mode?: 'Remote' | 'Hybrid' | 'In-Person';
  jobType?: 'Full-Time' | 'Part-Time' | 'Contract' | 'Per Diem';
  salaryPeriod?: 'hourly' | 'weekly' | 'monthly' | 'annual';
  salaryMin?: number;
  salaryMax?: number;
  description?: string;
  benefits?: string[];
  specialty?: string;
  setting?: string;
  population?: string;
}

/**
 * Writes a pre-filled draft to localStorage under 'jobFormData' + 'jobFormDataSavedAt'
 * so /post-job hydrates it immediately on arrival (signed-in or signed-out).
 */
export function saveDraftAndOpenPostJob(handoff: PostJobDraftHandoff): void {
  try {
    let existing: Record<string, unknown> = {};
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
    }
    const merged: Record<string, unknown> = {
      ...existing,
      pricingTier: 'pro',
      salaryCompetitive: false,
      salaryPeriod: handoff.salaryPeriod ?? 'annual',
      ...(handoff.title ? { title: handoff.title } : {}),
      ...(handoff.companyName ? { companyName: handoff.companyName } : {}),
      ...(handoff.location ? { location: handoff.location } : {}),
      ...(handoff.mode ? { mode: handoff.mode } : {}),
      ...(handoff.jobType ? { jobType: handoff.jobType } : {}),
      ...(handoff.salaryMin && handoff.salaryMin > 0 ? { salaryMin: Math.round(handoff.salaryMin) } : {}),
      ...(handoff.salaryMax && handoff.salaryMax > 0 ? { salaryMax: Math.round(handoff.salaryMax) } : {}),
      ...(handoff.description ? { description: handoff.description } : {}),
      ...(handoff.benefits && handoff.benefits.length > 0 ? { benefits: handoff.benefits } : {}),
      ...(handoff.specialty ? { specialty: handoff.specialty } : {}),
      ...(handoff.setting ? { setting: handoff.setting } : {}),
      ...(handoff.population ? { population: handoff.population } : {}),
    };
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(merged));
    window.localStorage.setItem(LOCAL_DRAFT_SAVED_AT_KEY, new Date().toISOString());
  } catch {
    // Storage disabled; still navigate cleanly
  }
  window.location.href = '/post-job';
}
