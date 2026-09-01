'use client';

/**
 * Cost-of-living adjusted city-vs-city salary comparator (P2 #5).
 *
 * All arithmetic lives in ./col-model.ts, which uses the same adjustment
 * formula as the pSEO aggregation cron. This component collects two city
 * selections and renders nominal vs real-terms pay side by side.
 *
 * Accessibility: both pickers are native <select> elements with visible
 * labels and state <optgroup> headings; the result region is always mounted
 * (defaults render on first paint) so nothing shifts on change; the headline
 * delta is announced politely.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, Building2, MapPin, Scale } from 'lucide-react';
import { brand } from '@/config/brand';
import type { CityOption } from './city-picker-data';
import { NATIONAL_COL_INDEX, compareCities } from './col-model';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, formatUsd, labelStyle, selectStyle } from './tool-theme';

interface Props {
  options: readonly CityOption[];
  defaultPair: readonly [string, string] | null;
}

function stateSlug(state: string): string {
  return state.toLowerCase().replace(/\s+/g, '-');
}

function basisLabel(option: CityOption): string {
  return option.basis === 'city'
    ? `${option.name} postings (${option.sample.toLocaleString('en-US')} with pay)`
    : `${option.state} median (${option.sample.toLocaleString('en-US')} postings with pay)`;
}

function CityColumn({ option, adjusted, accent }: { option: CityOption; adjusted: number; accent: string }) {
  return (
    <div style={{ ...clayCard, padding: '22px 22px 20px', border: `1.5px solid ${accent}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px' }}>
        <span
          style={{
            width: '32px', height: '32px', borderRadius: '10px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${accent}18`, color: accent,
          }}
          aria-hidden="true"
        >
          <MapPin size={16} />
        </span>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{option.name}</h3>
          <p style={{ fontSize: '11.5px', color: '#94A3B8', margin: 0 }}>{option.state}</p>
        </div>
      </div>

      <p style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>
        Posted salary
      </p>
      <div style={{ fontSize: '26px', fontWeight: 800, color: '#1A2E35', lineHeight: 1.1, marginBottom: '14px', fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(option.nominal)}
      </div>

      <p style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>
        Worth in national-average dollars
      </p>
      <div style={{ fontSize: '30px', fontWeight: 800, color: accent, lineHeight: 1.1, marginBottom: '14px', fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(adjusted)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ color: '#64748B' }}>Cost-of-living index</span>
          <span style={{ fontWeight: 700, color: '#1A2E35' }}>{option.col}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ color: '#64748B' }}>vs national average</span>
          <span style={{ fontWeight: 700, color: option.col > NATIONAL_COL_INDEX ? '#B91C1C' : '#047857' }}>
            {option.col > NATIONAL_COL_INDEX ? '+' : ''}{Math.round(option.col - NATIONAL_COL_INDEX)}%
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ color: '#64748B' }}>Pay basis</span>
          <span style={{ fontWeight: 600, color: '#7A6A62', textAlign: 'right', maxWidth: '60%' }}>{basisLabel(option)}</span>
        </div>
      </div>

      {/*
        The jobs link is server-gated (see cityJobsHref in ./city-picker-data).
        /jobs/city/<slug> hard-404s below 3 postings and on the 101 city names
        whose slug does not round-trip, so a city without a resolved href is
        offered its state pay page only — never a link we know will 404.
      */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
        {option.jobsHref && (
          <Link
            href={option.jobsHref}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '18px', background: '#FDF2F8', color: TOOL_ACCENT, fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}
          >
            Jobs in {option.name} <ArrowRight size={11} />
          </Link>
        )}
        <Link
          href={`/salary-guide/${stateSlug(option.state)}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '18px', background: '#EEF2FF', color: '#4338CA', fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}
        >
          {option.state} pay <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}

export default function CostOfLivingComparator({ options, defaultPair }: Props) {
  const [slugA, setSlugA] = useState(defaultPair ? defaultPair[0] : '');
  const [slugB, setSlugB] = useState(defaultPair ? defaultPair[1] : '');

  const bySlug = useMemo(() => new Map(options.map((o) => [o.slug, o])), [options]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CityOption[]>();
    for (const option of options) {
      const bucket = groups.get(option.state);
      if (bucket) bucket.push(option);
      else groups.set(option.state, [option]);
    }
    return [...groups.entries()];
  }, [options]);

  const cityA = bySlug.get(slugA);
  const cityB = bySlug.get(slugB);

  const comparison = useMemo(() => {
    if (!cityA || !cityB) return null;
    return compareCities(
      { basis: { nominal: cityA.nominal, basis: cityA.basis, sample: cityA.sample }, colIndex: cityA.col },
      { basis: { nominal: cityB.nominal, basis: cityB.basis, sample: cityB.sample }, colIndex: cityB.col },
    );
  }, [cityA, cityB]);

  const renderPicker = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <select
        id={id}
        className="tool-control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">Choose a city…</option>
        {grouped.map(([state, cities]) => (
          <optgroup key={state} label={state}>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}, {c.stateCode}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );

  const swap = () => {
    setSlugA(slugB);
    setSlugB(slugA);
  };

  return (
    <div>
      <ToolStyles />
      {/* ─── Pickers ─── */}
      <div style={{ ...clayCard, padding: '24px 24px 22px', marginBottom: '18px' }}>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: '14px', alignItems: 'end' }}
          className="col-picker-row"
        >
          {renderPicker('col-city-a', 'Compare this city', slugA, setSlugA)}
          <button
            type="button"
            onClick={swap}
            aria-label="Swap the two cities"
            style={{
              width: '44px', height: '44px', borderRadius: '12px', cursor: 'pointer',
              border: '1.5px solid rgba(190,24,93,0.2)', background: '#FFF', color: TOOL_ACCENT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
            className="tool-control"
          >
            <ArrowLeftRight size={18} aria-hidden="true" />
          </button>
          {renderPicker('col-city-b', 'Against this city', slugB, setSlugB)}
        </div>
        <p style={{ fontSize: '12px', color: '#94A3B8', margin: '12px 0 0', lineHeight: 1.55 }}>
          {options.length.toLocaleString('en-US')} cities available. Where a city has at least three of its own
          salaried postings we use them; otherwise the state median stands in, and each column says which.
        </p>
      </div>

      {/* ─── Result ─── */}
      {!comparison || !cityA || !cityB ? (
        <div style={{ ...clayCard, padding: '48px 28px', textAlign: 'center' }}>
          <span
            style={{
              width: '64px', height: '64px', borderRadius: '18px', margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#F1F5F9', color: '#94A3B8',
            }}
            aria-hidden="true"
          >
            <Building2 size={30} />
          </span>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#94A3B8', margin: '0 0 4px' }}>Pick two cities</p>
          <p style={{ fontSize: '13px', color: '#CBD5E1', margin: 0 }}>
            We will show posted pay, the cost-of-living index, and what the salary is actually worth in each.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Headline */}
          <div
            style={{
              ...clayCard,
              padding: '24px 24px 22px',
              background: comparison.reversesOnAdjustment
                ? 'linear-gradient(145deg, #FFFBEB, #FEF3C7)'
                : 'linear-gradient(145deg, #F0FDF4, #DCFCE7)',
              border: comparison.reversesOnAdjustment ? '1.5px solid rgba(245,158,11,0.25)' : '1.5px solid rgba(16,185,129,0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span
                style={{
                  width: '34px', height: '34px', borderRadius: '11px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.75)', color: comparison.reversesOnAdjustment ? '#B45309' : '#047857',
                }}
                aria-hidden="true"
              >
                <Scale size={18} />
              </span>
              <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
                {comparison.reversesOnAdjustment
                  ? 'The bigger salary is the smaller paycheck'
                  : comparison.realDelta >= 0
                    ? `${cityB.name} goes further`
                    : `${cityA.name} goes further`}
              </h2>
            </div>
            <p aria-live="polite" style={{ fontSize: '32px', fontWeight: 800, color: comparison.reversesOnAdjustment ? '#B45309' : '#047857', margin: '0 0 8px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(Math.abs(comparison.realDelta))}
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#7A6A62' }}>
                {' '}real-terms difference ({comparison.realDelta >= 0 ? '+' : '−'}{Math.abs(Math.round(comparison.realDeltaPct))}%)
              </span>
            </p>
            <p style={{ fontSize: '13.5px', color: '#5A4A42', margin: 0, lineHeight: 1.65 }}>
              Posted pay differs by {formatUsd(Math.abs(comparison.nominalDelta))}
              {comparison.nominalDelta === 0 ? '' : comparison.nominalDelta > 0 ? ` in ${cityB.name}’s favour` : ` in ${cityA.name}’s favour`}.
              {' '}Once the cost-of-living gap is applied, {comparison.realDelta >= 0 ? cityB.name : cityA.name} comes out ahead.
            </p>
            <p style={{ fontSize: '13.5px', color: '#5A4A42', margin: '10px 0 0', lineHeight: 1.65 }}>
              To match {cityA.name} purchasing power, a {cityB.name} offer would need to pay{' '}
              <strong>{formatUsd(comparison.matchingSalaryInB)}</strong>.
            </p>
          </div>

          {/* Columns */}
          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <CityColumn option={cityA} adjusted={comparison.a.adjusted} accent="#4338CA" />
            <CityColumn option={cityB} adjusted={comparison.b.adjusted} accent="#047857" />
          </div>

          {/* Cross-links */}
          <div style={{ ...clayCard, padding: '20px 22px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Related
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { href: '/salary-guide', label: `${brand.niche.short} salary guide` },
                { href: '/jobs/locations', label: 'Browse by location' },
                { href: '/tools/1099-vs-w2-calculator', label: '1099 vs W-2 calculator' },
                { href: '/tools/licensure-checker', label: 'Licensure checker' },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '8px 14px', borderRadius: '20px', background: '#FDF2F8', color: TOOL_ACCENT, fontSize: '12.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                  {l.label} <ArrowRight size={12} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .col-picker-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
