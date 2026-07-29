'use client';

/**
 * Employer salary-benchmark picker (P2 #17) — public, aggregate-only.
 *
 * Receives already-aggregated rows from the server component; it never sees
 * per-employer data. See ./benchmark-model.ts for the public-safety rules
 * (minimum postings AND minimum distinct employers per published row).
 *
 * Accessibility: labelled select + labelled number input, keyboard operable,
 * the result region is always mounted so nothing shifts as the selection
 * changes, and the headline figure is announced politely. The focus-ring CSS
 * ships with the component (<ToolStyles />) because this widget is embedded on
 * /for-employers, which knows nothing about the /tools stylesheet.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3, Info } from 'lucide-react';
import { brand } from '@/config/brand';
import { classifyOffer, type BenchmarkRow, type OfferStanding } from './benchmark-model';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, labelStyle, selectStyle } from './tool-theme';

interface Props {
  national: BenchmarkRow | null;
  states: readonly BenchmarkRow[];
  /** Rendered above the controls; the host page owns the section heading. */
  compact?: boolean;
}

const STANDING_META: Record<OfferStanding, { label: string; color: string; bg: string; note: string }> = {
  below: {
    label: 'Below the market range',
    color: '#B91C1C',
    bg: '#FEE2E2',
    note: 'Your figure sits under the 25th percentile of posted pay here. Expect a smaller and slower applicant pool, and be ready to justify the gap with schedule, autonomy, or support.',
  },
  competitive: {
    label: 'Inside the market range',
    color: '#047857',
    bg: '#D1FAE5',
    note: 'Your figure sits between the 25th and 75th percentiles of posted pay here — the band most candidates are seeing from other employers.',
  },
  above: {
    label: 'Above the market range',
    color: '#4338CA',
    bg: '#E0E7FF',
    note: 'Your figure sits above the 75th percentile of posted pay here. That is a genuine recruiting advantage — say the number in the posting so it does the work.',
  },
};

function stateSlug(state: string): string {
  return state.toLowerCase().replace(/\s+/g, '-');
}

export default function EmployerBenchmarkPicker({ national, states, compact = false }: Props) {
  const [scope, setScope] = useState('');
  const [offer, setOffer] = useState('');

  const row = useMemo<BenchmarkRow | null>(() => {
    if (!scope) return national;
    return states.find((s) => s.scope === scope) ?? national;
  }, [scope, states, national]);

  const offerValue = useMemo(() => {
    const parsed = Number.parseFloat(offer.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [offer]);

  const standing = row && offerValue ? classifyOffer(offerValue, row) : null;

  if (!row) {
    return (
      <div style={{ ...clayCard, padding: '32px 26px', textAlign: 'center' }}>
        <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>
          Not enough posted pay data to publish a benchmark yet
        </p>
        <p style={{ fontSize: '13.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
          We only publish a figure once enough employers have posted disclosed ranges that no single one can be
          identified from the aggregate. Until then we would rather show nothing than a number built from a
          handful of listings.
        </p>
      </div>
    );
  }

  const spread = Math.max(1, row.p75 - row.p25);
  const markerPct = offerValue
    ? Math.min(100, Math.max(0, ((offerValue - row.p25) / spread) * 100))
    : null;

  return (
    <div style={{ ...clayCard, padding: compact ? '24px 24px 22px' : '28px 28px 24px' }}>
      <ToolStyles />
      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '14px', marginBottom: '22px' }} className="tool-two-col">
        <div>
          <label htmlFor="benchmark-state" style={labelStyle}>State</label>
          <select
            id="benchmark-state"
            className="tool-control"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            style={selectStyle}
          >
            <option value="">All states (national)</option>
            {states.map((s) => (
              <option key={s.scope} value={s.scope}>{s.scope}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="benchmark-offer" style={labelStyle}>Your planned salary (optional)</label>
          <div style={{ position: 'relative' }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', fontWeight: 600, color: '#94A3B8' }}>$</span>
            <input
              id="benchmark-offer"
              className="tool-control"
              type="number"
              inputMode="decimal"
              min={0}
              step={1000}
              placeholder="e.g. 130000"
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              aria-describedby="benchmark-offer-hint"
              style={{ ...controlStyle, paddingLeft: '28px' }}
            />
          </div>
          <p id="benchmark-offer-hint" style={{ fontSize: '11.5px', color: '#94A3B8', margin: '5px 0 0' }}>
            Annual base. We will place it against the posted range.
          </p>
        </div>
      </div>

      {/* Headline */}
      <div style={{ padding: '20px 22px', borderRadius: '16px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '1.5px solid rgba(190,24,93,0.14)', marginBottom: '16px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 3px' }}>
          Median posted salary · {row.scope === 'National' ? 'all states' : row.scope}
        </p>
        <div aria-live="polite" style={{ fontSize: '34px', fontWeight: 800, color: '#831843', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {formatUsd(row.median)}
        </div>
        <p style={{ fontSize: '13px', color: '#5A4A42', margin: '8px 0 0', lineHeight: 1.6 }}>
          Middle of the market: <strong>{formatUsd(row.p25)} – {formatUsd(row.p75)}</strong> (25th to 75th
          percentile), from {row.postings.toLocaleString('en-US')} published {brand.niche.short} postings that
          disclose pay, across {row.employers.toLocaleString('en-US')} employers.
        </p>
      </div>

      {/* Range bar */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', fontWeight: 700, color: '#64748B', marginBottom: '6px' }}>
          <span>{formatUsd(row.p25)}</span>
          <span>Median {formatUsd(row.median)}</span>
          <span>{formatUsd(row.p75)}</span>
        </div>
        <div style={{ position: 'relative', height: '12px', borderRadius: '8px', background: 'linear-gradient(90deg, #FCE7F3, #BE185D)' }}>
          {markerPct !== null && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', top: '-5px', left: `${markerPct}%`, transform: 'translateX(-50%)',
                width: '4px', height: '22px', borderRadius: '3px', background: '#1A2E35',
                boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
              }}
            />
          )}
        </div>
      </div>

      {/* Offer standing */}
      {standing && (
        <div style={{ padding: '16px 18px', borderRadius: '14px', background: STANDING_META[standing].bg, marginBottom: '16px' }}>
          <p style={{ fontSize: '13.5px', fontWeight: 800, color: STANDING_META[standing].color, margin: '0 0 5px' }}>
            {formatUsd(offerValue as number)} — {STANDING_META[standing].label}
          </p>
          <p style={{ fontSize: '13px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>{STANDING_META[standing].note}</p>
        </div>
      )}

      {/* Method note */}
      <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <Info size={15} color="#64748B" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
        <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
          Aggregates only. A state appears here only once enough employers have posted disclosed ranges that no
          single employer is identifiable from the figure, and listings whose pay was inferred rather than
          posted are excluded entirely. This is posted pay, not accepted offers or total compensation.
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px', marginTop: '16px' }}>
        <Link
          href="/post-job"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: TOOL_ACCENT, color: '#fff', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
        >
          Post a role with this range <ArrowRight size={14} />
        </Link>
        {row.scope !== 'National' && (
          <Link
            href={`/salary-guide/${stateSlug(row.scope)}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: '#EEF2FF', color: '#4338CA', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
          >
            {row.scope} pay detail <ArrowRight size={14} />
          </Link>
        )}
        <Link
          href="/for-employers/resources/how-to-hire"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', borderRadius: '12px', background: '#F1F5F9', color: '#334155', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}
        >
          <BarChart3 size={14} aria-hidden="true" /> Hiring guide
        </Link>
      </div>
    </div>
  );
}
