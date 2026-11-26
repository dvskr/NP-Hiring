'use client';

/**
 * Interactive filter bar + SSR-complete card grid for /tools.
 *
 * By default (`audience === 'all'`, `category === 'all'`, `query === ''`),
 * every registered tool card renders in initial server HTML so search crawlers
 * and link-integrity checks see all 24 indexable tool links immediately.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, X } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, controlStyle, iconTile, labelStyle } from './tool-theme';
import type { ToolAudience, ToolCategory } from '@/app/tools/tools-registry';

export interface HubToolCardItem {
  path: string;
  title: string;
  blurb: string;
  badge: string;
  audience: ToolAudience;
  category: ToolCategory;
  iconNode: ReactNode;
}

const AUDIENCE_META: Record<ToolAudience, { label: string; color: string; bg: string }> = {
  seeker: { label: 'For clinicians', color: '#BE185D', bg: '#FDF2F8' },
  employer: { label: 'For employers', color: '#4338CA', bg: '#EEF2FF' },
};

const CATEGORIES: readonly ToolCategory[] = [
  'Compensation & Offers',
  'Coding & Productivity',
  'Licensure & Practice',
  'Education & Loans',
  'Hiring & Compliance',
  'Clinic Economics',
];

interface Props {
  items: readonly HubToolCardItem[];
}

export default function ToolsHubFilterClient({ items }: Props) {
  const [audienceFilter, setAudienceFilter] = useState<'all' | ToolAudience>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ToolCategory>('all');
  const [query, setQuery] = useState('');

  const seekerCount = useMemo(() => items.filter((item) => item.audience === 'seeker').length, [items]);
  const employerCount = useMemo(() => items.filter((item) => item.audience === 'employer').length, [items]);

  const availableCategories = useMemo(() => {
    const base = audienceFilter === 'all' ? items : items.filter((i) => i.audience === audienceFilter);
    return CATEGORIES.filter((cat) => base.some((i) => i.category === cat));
  }, [items, audienceFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (audienceFilter !== 'all' && item.audience !== audienceFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.blurb} ${item.badge} ${item.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, audienceFilter, categoryFilter, query]);

  const selectAudience = (next: 'all' | ToolAudience) => {
    setAudienceFilter(next);
    if (next !== 'all' && categoryFilter !== 'all') {
      const stillHas = items.some((i) => i.audience === next && i.category === categoryFilter);
      if (!stillHas) setCategoryFilter('all');
    }
  };

  return (
    <div>
      <ToolStyles />

      {/* Filter Control Deck */}
      <div style={{ ...clayCard, padding: '20px 22px', marginBottom: '26px' }}>
        <div
          className="tool-two-col"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
            gap: '16px',
            alignItems: 'end',
          }}
        >
          {/* Audience Segmented Tabs */}
          <div>
            <span style={labelStyle}>Browse by audience</span>
            <div role="group" aria-label="Filter tools by audience" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { key: 'all' as const, label: `All Tools (${items.length})` },
                { key: 'seeker' as const, label: `For Clinicians (${seekerCount})` },
                { key: 'employer' as const, label: `For Employers (${employerCount})` },
              ].map((tab) => {
                const active = audienceFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectAudience(tab.key)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: '12px',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active ? '1.5px solid #BE185D' : '1.5px solid rgba(0,0,0,0.09)',
                      background: active ? 'linear-gradient(145deg, #BE185D, #9D174D)' : '#F8FAFC',
                      color: active ? '#FFFFFF' : '#334155',
                      boxShadow: active ? '0 4px 12px rgba(190,24,93,0.22)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Instant Search */}
          <div>
            <label htmlFor="tools-hub-search" style={labelStyle}>
              Find a calculator or checker
            </label>
            <div style={{ position: 'relative' }}>
              <Search
                size={16}
                color="#64748B"
                aria-hidden="true"
                style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
              <input
                id="tools-hub-search"
                className="tool-control"
                type="search"
                value={query}
                placeholder="Search wRVU, E/M, PSLF, vacancy, licensure..."
                onChange={(e) => setQuery(e.target.value)}
                style={{ ...controlStyle, paddingLeft: '38px', paddingRight: query ? '36px' : '14px', fontSize: '14px' }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#F1F5F9',
                    color: '#475569',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category Chips */}
        <div
          role="group"
          aria-label="Filter tools by topic"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <button
            type="button"
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
            style={{
              padding: '6px 13px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: categoryFilter === 'all' ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.10)',
              background: categoryFilter === 'all' ? '#FDF2F8' : '#FFFFFF',
              color: categoryFilter === 'all' ? '#9D174D' : '#475569',
            }}
          >
            All topics
          </button>
          {availableCategories.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => setCategoryFilter(active ? 'all' : cat)}
                style={{
                  padding: '6px 13px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.10)',
                  background: active ? '#FDF2F8' : '#FFFFFF',
                  color: active ? '#9D174D' : '#475569',
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status readout when filtered */}
      {(audienceFilter !== 'all' || categoryFilter !== 'all' || query.trim() !== '') && (
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '16px',
            fontSize: '13.5px',
            color: '#5A4A42',
            fontWeight: 600,
          }}
        >
          <span>
            Showing {filtered.length} of {items.length} tools
          </span>
          <button
            type="button"
            onClick={() => {
              setAudienceFilter('all');
              setCategoryFilter('all');
              setQuery('');
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: TOOL_ACCENT,
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            Reset filters
          </button>
        </div>
      )}

      {/* Cards Grid */}
      {filtered.length === 0 ? (
        <div style={{ ...clayCard, padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>
            No tools match your current filter
          </p>
          <p style={{ fontSize: '14px', color: '#5A4A42', margin: '0 0 16px' }}>
            Try clearing your search term or switching back to all topics.
          </p>
          <button
            type="button"
            onClick={() => {
              setAudienceFilter('all');
              setCategoryFilter('all');
              setQuery('');
            }}
            style={{
              padding: '10px 18px',
              borderRadius: '12px',
              border: 'none',
              background: TOOL_ACCENT,
              color: '#FFFFFF',
              fontSize: '13.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Show all {items.length} tools
          </button>
        </div>
      ) : (
        <div className="tools-hub-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {filtered.map((tool) => {
            const audience = AUDIENCE_META[tool.audience];
            return (
              <Link
                key={tool.path}
                href={tool.path}
                className="tool-card"
                style={{
                  ...clayCard,
                  padding: '26px 24px 22px',
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '13px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ ...iconTile, background: audience.bg, color: audience.color }} aria-hidden="true">
                    {tool.iconNode}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#475569',
                        background: '#F1F5F9',
                        padding: '4px 10px',
                        borderRadius: '20px',
                      }}
                    >
                      {tool.category}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: audience.color,
                        background: audience.bg,
                        padding: '4px 11px',
                        borderRadius: '20px',
                      }}
                    >
                      {tool.badge}
                    </span>
                  </div>
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.3 }}>
                  {tool.title}
                </h2>
                <p style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.6, margin: 0, flex: 1 }}>
                  {tool.blurb}
                </p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: TOOL_ACCENT }}>
                  Open the tool <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
