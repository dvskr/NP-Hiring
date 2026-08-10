'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X, ChevronDown, ChevronUp, Search, MapPin } from 'lucide-react';
import { FilterState, FilterCounts, DEFAULT_FILTERS } from '@/types/filters';
import {
  filtersToParams,
  parseFiltersFromParams,
  categoryFilterLabel,
  countActiveFilters,
  SPECIALTY_FILTER_OPTIONS,
  type RecruitmentFilterState,
} from '@/lib/filters';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SALARY_FILTER_BUCKETS } from '@/config/niche/stats';
import { trackSearch, trackFilterChange } from '@/lib/analytics';

// Human-readable names for the active-category pill — derived from the
// taxonomy registry (single source of truth), so removed donor slugs can't
// linger here and new registry slugs label themselves automatically.
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ALL_CATEGORY_SLUGS.map((slug) => [slug, categoryFilterLabel(slug)]),
);

// Pill labels for the `specialty` URL param: registry-slug values use their
// display label; the two legacy work-type values keep their checkbox labels.
const SPECIALTY_VALUE_LABELS: Record<string, string> = {
  ...Object.fromEntries(SPECIALTY_FILTER_OPTIONS.map((opt) => [opt.value, opt.label])),
  Telehealth: 'Telehealth',
  Travel: 'Travel / Locum',
};

interface CheckboxFilterProps {
  label: string;
  /**
   * Result-count badge. `0` renders a gray zero badge; omit (undefined) to
   * hide the badge entirely — used for filter values the counts API does
   * not report yet, so we never fabricate a "0 jobs" signal.
   */
  count?: number;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function CheckboxFilter({ label, count, checked, onChange, disabled }: CheckboxFilterProps) {
  return (
    <label
      className={`li-filter-row ${disabled ? 'li-filter-disabled' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 6px', borderRadius: '8px', cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="li-checkbox"
          style={{
            width: '16px', height: '16px', borderRadius: '4px',
            accentColor: 'var(--color-primary)',
          }}
        />
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
      </div>
      {typeof count === 'number' && (
        <span style={{
          fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px',
          backgroundColor: count === 0 ? '#F3F4F6' : '#FCE7F3',
          color: count === 0 ? '#9CA3AF' : '#9D174D',
          boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.7), 1px 1px 2px rgba(0,0,0,0.03)',
        }}>
          {count.toLocaleString()}
        </span>
      )}
    </label>
  );
}

interface FilterSectionProps {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function FilterSection({ title, defaultExpanded = true, children }: FilterSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // SEO Fix H7: stable id ties button (aria-controls) to the panel and lets
  // assistive tech announce the disclosure relationship (WCAG 4.1.2).
  const panelId = `filter-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', padding: '14px 0' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          cursor: 'pointer', padding: 0,
        }}
      >
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          {title}
        </h3>
        {expanded ? (
          <ChevronUp aria-hidden="true" style={{ width: '16px', height: '16px', color: 'var(--text-muted, var(--text-tertiary))' }} />
        ) : (
          <ChevronDown aria-hidden="true" style={{ width: '16px', height: '16px', color: 'var(--text-muted, var(--text-tertiary))' }} />
        )}
      </button>
      <div id={panelId} role="region" aria-label={title} hidden={!expanded} style={{ marginTop: expanded ? '8px' : 0 }}>
        {children}
      </div>
    </div>
  );
}

// Empty interface removed - not needed

// FilterState + the employer-type param (teardown A6). The extension type
// lives in lib/filters.ts so the URL contract has one owner.
const DEFAULT_RECRUITMENT_FILTERS: RecruitmentFilterState = {
  ...DEFAULT_FILTERS,
  recruitmentType: null,
};

export default function LinkedInFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<RecruitmentFilterState>(DEFAULT_RECRUITMENT_FILTERS);
  const [counts, setCounts] = useState<FilterCounts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  // Honest facet arithmetic for the employer-type filter. `unclassifiedCount`
  // is how many jobs (under the CURRENT other filters) come from employers no
  // human has classified yet — surfaced in the facet so selecting "Direct
  // employers" never SILENTLY hides that inventory or implies it is agency
  // work. `recruitmentTotal` is the true total while an employer-type filter
  // is active: the filter-counts API normalizes its POST body to the fixed
  // FilterState shape and drops recruitmentType, so counts.total would
  // overstate results whenever this filter is on. null = unknown (fetch
  // failed/pending) and renders as NOTHING — never a fabricated zero.
  const [unclassifiedCount, setUnclassifiedCount] = useState<number | null>(null);
  const [recruitmentTotal, setRecruitmentTotal] = useState<number | null>(null);

  // Sync filters from URL params
  useEffect(() => {
    const parsed = parseFiltersFromParams(new URLSearchParams(searchParams.toString()));
    setFilters(parsed);
    setSearchInput(parsed.search || '');
    setLocationInput(parsed.location || '');
  }, [searchParams]);

  // Fetch filter counts (includes category param for accurate counts)
  const fetchCounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const parsed = parseFiltersFromParams(new URLSearchParams(searchParams.toString()));
      const response = await fetch('/api/jobs/filter-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (response.ok) {
        const data = await response.json();
        setCounts(data);
      }
    } catch (error) {
      console.error('Failed to fetch filter counts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [searchParams]);

  // Defer the filter-count POST off the critical render path. Audit 07
  // M-3: this fired on every page load before any user interaction,
  // racing with hydration on the highest-traffic surface. requestIdleCallback
  // (with setTimeout fallback) lets the initial render finish first;
  // the count badges fill in shortly after with no user-visible delay.
  useEffect(() => {
    type IdleHandle = number;
    const idleApi = (typeof window !== 'undefined' && 'requestIdleCallback' in window)
      ? (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => IdleHandle; cancelIdleCallback: (h: IdleHandle) => void })
      : null;
    let handle: number | null = null;
    if (idleApi) {
      handle = idleApi.requestIdleCallback(() => fetchCounts(), { timeout: 2000 });
    } else {
      handle = window.setTimeout(() => fetchCounts(), 250) as unknown as number;
    }
    return () => {
      if (handle == null) return;
      if (idleApi) idleApi.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [fetchCounts]);

  // Employer-type facet arithmetic (see the state declarations above).
  // Deferred off the critical path exactly like fetchCounts. One probe when
  // no employer-type filter is active, two when one is; /api/jobs re-parses
  // its own URL through parseFiltersFromParams, so the totals honor
  // recruitmentType even though the filter-counts POST route does not.
  useEffect(() => {
    let cancelled = false;
    const probeTotal = async (state: RecruitmentFilterState): Promise<number | null> => {
      try {
        const params = filtersToParams(state);
        params.set('limit', '1');
        const res = await fetch(`/api/jobs?${params.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.total === 'number' ? data.total : null;
      } catch {
        return null;
      }
    };
    const run = async () => {
      const parsed = parseFiltersFromParams(new URLSearchParams(searchParams.toString()));
      const [unclassified, activeTotal] = await Promise.all([
        probeTotal({ ...parsed, recruitmentType: 'unclassified' }),
        parsed.recruitmentType ? probeTotal(parsed) : Promise.resolve<number | null>(null),
      ]);
      if (cancelled) return;
      setUnclassifiedCount(unclassified);
      setRecruitmentTotal(parsed.recruitmentType ? activeTotal : null);
    };
    type IdleHandle = number;
    const idleApi = (typeof window !== 'undefined' && 'requestIdleCallback' in window)
      ? (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => IdleHandle; cancelIdleCallback: (h: IdleHandle) => void })
      : null;
    let handle: number | null = null;
    if (idleApi) {
      handle = idleApi.requestIdleCallback(() => void run(), { timeout: 2000 });
    } else {
      handle = window.setTimeout(() => void run(), 250) as unknown as number;
    }
    return () => {
      cancelled = true;
      if (handle == null) return;
      if (idleApi) idleApi.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [searchParams]);

  // Route every filter mutation through one place so the employer-type filter
  // can stay honest. JobsPageClient.fetchJobs now serializes its /api/jobs
  // query through the SAME filtersToParams contract used here (it previously
  // re-enumerated fields and silently dropped recruitmentType — which forced
  // this helper to fall back to a full document navigation whenever the
  // employer-type filter was in play). With the shared serialization, every
  // transition — adding OR removing the filter, sort changes, pagination —
  // stays SPA: the searchParams effect refetches with the param intact.
  const navigateWithFilters = (next: RecruitmentFilterState) => {
    const url = `/jobs?${filtersToParams(next).toString()}`;
    router.push(url, { scroll: false });
  };

  // Toggle array-based filter (workMode, jobType, specialty)
  const toggleArrayFilter = (key: 'workMode' | 'jobType' | 'specialty' | 'experienceLevel', value: string) => {
    const newFilters = { ...filters };
    const arr = [...newFilters[key]];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(value);
    newFilters[key] = arr;
    navigateWithFilters(newFilters);
    trackFilterChange(key, arr.join(','));
  };

  // Set single-value filter. Accepts boolean for the newGradFriendly toggle
  // and string/number for everything else.
  const setSingleFilter = (key: keyof RecruitmentFilterState, value: string | number | boolean | null) => {
    const newFilters = { ...filters, [key]: value };
    navigateWithFilters(newFilters);
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSearchInput('');
    setLocationInput('');
    router.push('/jobs', { scroll: false });
  };

  // Handle search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newFilters = { ...filters, search: searchInput || undefined };
    navigateWithFilters(newFilters as RecruitmentFilterState);
    if (searchInput) trackSearch(searchInput);
  };

  // Handle location submit
  const handleLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newFilters = { ...filters, location: locationInput || undefined };
    navigateWithFilters(newFilters as RecruitmentFilterState);
  };

  // Per-specialty counts: the typed FilterCounts.specialty only declares the
  // two legacy work-type keys; registry-slug keys flow through untyped once
  // the filter-counts API reports them. Undefined hides the badge (we never
  // fabricate a zero).
  const specialtyCounts = (counts?.specialty ?? {}) as Partial<Record<string, number>>;

  // Count active filters through the SHARED helper (lib/filters.ts) — the
  // same rule JobsPageClient uses, so the sidebar and the page can never
  // disagree again about what counts as active (P6 #3). Includes the
  // deep-link-only params (cityExact/stateCode/employer), which also makes
  // "Clear all" appear when they are the sole filters.
  const activeFilterCount = countActiveFilters(filters);

  // Displayed results total. The filter-counts POST route normalizes its body
  // to the fixed FilterState shape and drops recruitmentType, so counts.total
  // ignores an active employer-type filter — substitute the /api/jobs probe
  // total (which honors it) whenever that filter is on.
  const displayedTotal = filters.recruitmentType
    ? recruitmentTotal
    : (counts?.total ?? null);

  // Get active filter pills
  const getActiveFilters = () => {
    const pills: { key: string; label: string; onRemove: () => void }[] = [];

    // Category pill (shown first, with distinct styling)
    if (filters.category) {
      pills.push({
        key: 'category',
        label: CATEGORY_LABELS[filters.category] || filters.category.replace(/-/g, ' '),
        onRemove: () => setSingleFilter('category', null),
      });
    }
    if (filters.search) {
      pills.push({
        key: 'search',
        label: `"${filters.search}"`,
        onRemove: () => setSingleFilter('search', null),
      });
    }
    if (filters.location) {
      pills.push({
        key: 'location',
        label: filters.location,
        onRemove: () => setSingleFilter('location', null),
      });
    }
    // Deep-link-only params (P6 #3) — set by city/metro/company CTAs, never
    // by a facet in this sidebar. They actively narrow results, so each gets
    // a pill showing its value with an individual remove; without these the
    // narrowing was invisible (no pill, no count, no clear affordance). The
    // City:/State: prefixes disambiguate them from the free-text location
    // pill above and from each other.
    if (filters.cityExact) {
      pills.push({
        key: 'cityExact',
        label: `City: ${filters.cityExact}`,
        onRemove: () => setSingleFilter('cityExact', null),
      });
    }
    if (filters.stateCode) {
      pills.push({
        key: 'stateCode',
        label: `State: ${filters.stateCode.toUpperCase()}`,
        onRemove: () => setSingleFilter('stateCode', null),
      });
    }
    if (filters.employer) {
      pills.push({
        key: 'employer',
        label: `Employer: ${filters.employer}`,
        onRemove: () => setSingleFilter('employer', null),
      });
    }
    filters.workMode.forEach(mode => {
      pills.push({
        key: `workMode-${mode}`,
        label: mode.charAt(0).toUpperCase() + mode.slice(1),
        onRemove: () => toggleArrayFilter('workMode', mode),
      });
    });
    filters.jobType.forEach(type => {
      pills.push({
        key: `jobType-${type}`,
        label: type,
        onRemove: () => toggleArrayFilter('jobType', type),
      });
    });
    if (filters.specialty) {
      filters.specialty.forEach(spec => {
        pills.push({
          key: `specialty-${spec}`,
          label: SPECIALTY_VALUE_LABELS[spec] || spec,
          onRemove: () => toggleArrayFilter('specialty', spec),
        });
      });
    }
    if (filters.experienceLevel) {
      filters.experienceLevel.forEach(el => {
        pills.push({
          key: `experienceLevel-${el}`,
          label: el,
          onRemove: () => toggleArrayFilter('experienceLevel', el),
        });
      });
    }
    if (filters.newGradFriendly === true) {
      pills.push({
        key: 'newGradFriendly',
        label: 'Open to new grads',
        onRemove: () => setSingleFilter('newGradFriendly', null),
      });
    }
    if (typeof filters.minYearsExperience === 'number') {
      pills.push({
        key: 'minYearsExperience',
        label: `${filters.minYearsExperience}+ yrs exp`,
        onRemove: () => setSingleFilter('minYearsExperience', null),
      });
    }
    if (filters.salaryMin) {
      pills.push({
        key: 'salary',
        label: `$${(filters.salaryMin / 1000).toFixed(0)}k+`,
        onRemove: () => setSingleFilter('salaryMin', null),
      });
    }
    if (filters.postedWithin) {
      const labels: Record<string, string> = { '24h': 'Past 24h', '3d': 'Past 3 days', '7d': 'Past week', '30d': 'Past month' };
      pills.push({
        key: 'postedWithin',
        label: labels[filters.postedWithin] || filters.postedWithin,
        onRemove: () => setSingleFilter('postedWithin', null),
      });
    }
    if (filters.recruitmentType) {
      pills.push({
        key: 'recruitmentType',
        // 'unclassified' is reachable via deep link only (the count line in
        // the facet is informational) but the pill must still name it
        // honestly rather than showing a raw slug.
        label: filters.recruitmentType === 'direct_hire'
          ? 'Direct employers'
          : filters.recruitmentType === 'staffing_agency'
            ? 'Staffing agencies'
            : 'Employers not yet classified',
        onRemove: () => setSingleFilter('recruitmentType', null),
      });
    }
    return pills;
  };

  return (
    <>
      <div
        style={{
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: activeFilterCount > 0 ? '12px' : '0' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              Filters
            </h2>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                style={{
                  fontSize: '12px', color: 'var(--color-primary)', fontWeight: 600,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0,
                }}
              >
                Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Active Filter Pills */}
          {activeFilterCount > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {getActiveFilters().map((pill) => (
                <span
                  key={pill.key}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '3px 10px', borderRadius: '20px',
                    backgroundColor: '#FCE7F3',
                    color: '#9D174D', fontSize: '11px', fontWeight: 600,
                    boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.6), 1px 1px 3px rgba(0,0,0,0.04)',
                  }}
                >
                  {pill.label}
                  <button
                    onClick={pill.onRemove}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '2px', borderRadius: '50%', display: 'flex',
                      color: 'inherit',
                    }}
                    aria-label={`Remove ${pill.label} filter`}
                  >
                    <X style={{ width: '12px', height: '12px' }} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Results Count */}
        <div style={{
          padding: '10px 20px',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          flexShrink: 0,
        }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500, margin: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {displayedTotal === null || (isLoading && !filters.recruitmentType) ? '...' : displayedTotal.toLocaleString()}
            </span>
            {' '}jobs found
          </p>
        </div>

        {/* Scrollable Filter Content */}
        <div>
          <div style={{ padding: '12px 20px' }}>
            {/* Search */}
            <form onSubmit={handleSearchSubmit} style={{ marginBottom: '12px' }}>
              <div style={{ position: 'relative' }}>
                <Search aria-hidden="true" style={{
                  position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                  width: '15px', height: '15px', color: 'var(--text-tertiary)',
                }} />
                {/* SEO Fix C4: aria-label gives screen readers a name (WCAG 4.1.2). */}
                <input
                  aria-label="Search by job title or company"
                  type="search"
                  placeholder="Job title, company..."
                  value={searchInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
                  className="li-filter-input"
                  style={{
                    width: '100%', paddingLeft: '36px', paddingRight: '14px',
                    paddingTop: '9px', paddingBottom: '9px',
                    backgroundColor: '#F1F5F2',
                    border: '1px solid rgba(0,0,0,0.06)',
                    borderRadius: '14px', fontSize: '13px',
                    color: 'var(--text-primary)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.04), 1px 1px 2px rgba(255,255,255,0.5)',
                  }}
                />
              </div>
            </form>

            {/* Location */}
            <form onSubmit={handleLocationSubmit} style={{ marginBottom: '8px' }}>
              <div style={{ position: 'relative' }}>
                <MapPin aria-hidden="true" style={{
                  position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                  width: '15px', height: '15px', color: 'var(--text-tertiary)',
                }} />
                {/* Copy states what the matcher actually does (P6 #2): state
                    name/code equals-match plus the 'Remote' alias
                    (isRemoteLocationAlias → isRemote in lib/filters.ts).
                    City matching was DELIBERATELY removed for cross-state
                    collisions ("Kansas City, MO" inflating Kansas), so the
                    placeholder must not promise it. */}
                <input
                  aria-label="Filter by state or remote"
                  type="text"
                  placeholder="State or 'Remote'"
                  value={locationInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocationInput(e.target.value)}
                  className="li-filter-input"
                  style={{
                    width: '100%', paddingLeft: '36px', paddingRight: '14px',
                    paddingTop: '9px', paddingBottom: '9px',
                    backgroundColor: '#F1F5F2',
                    border: '1px solid rgba(0,0,0,0.06)',
                    borderRadius: '14px', fontSize: '13px',
                    color: 'var(--text-primary)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.04), 1px 1px 2px rgba(255,255,255,0.5)',
                  }}
                />
              </div>
            </form>

            {/* Date Posted */}
            <FilterSection title="Date Posted">
              <CheckboxFilter
                label="Past 24 hours"
                count={counts?.postedWithin['24h'] || 0}
                checked={filters.postedWithin === '24h'}
                onChange={() => setSingleFilter('postedWithin', filters.postedWithin === '24h' ? null : '24h')}
              />
              <CheckboxFilter
                label="Past 3 days"
                count={counts?.postedWithin['3d'] || 0}
                checked={filters.postedWithin === '3d'}
                onChange={() => setSingleFilter('postedWithin', filters.postedWithin === '3d' ? null : '3d')}
              />
              <CheckboxFilter
                label="Past week"
                count={counts?.postedWithin['7d'] || 0}
                checked={filters.postedWithin === '7d'}
                onChange={() => setSingleFilter('postedWithin', filters.postedWithin === '7d' ? null : '7d')}
              />
              <CheckboxFilter
                label="Past month"
                count={counts?.postedWithin['30d'] || 0}
                checked={filters.postedWithin === '30d'}
                onChange={() => setSingleFilter('postedWithin', filters.postedWithin === '30d' ? null : '30d')}
              />
            </FilterSection>

            {/* Job Type */}
            <FilterSection title="Job Type">
              <CheckboxFilter
                label="Full-Time"
                count={counts?.jobType['Full-Time'] || 0}
                checked={filters.jobType.includes('Full-Time')}
                onChange={() => toggleArrayFilter('jobType', 'Full-Time')}
              />
              <CheckboxFilter
                label="Part-Time"
                count={counts?.jobType['Part-Time'] || 0}
                checked={filters.jobType.includes('Part-Time')}
                onChange={() => toggleArrayFilter('jobType', 'Part-Time')}
              />
              <CheckboxFilter
                label="Contract"
                count={counts?.jobType['Contract'] || 0}
                checked={filters.jobType.includes('Contract')}
                onChange={() => toggleArrayFilter('jobType', 'Contract')}
              />
              <CheckboxFilter
                label="Per Diem"
                count={counts?.jobType['Per Diem'] || 0}
                checked={filters.jobType.includes('Per Diem')}
                onChange={() => toggleArrayFilter('jobType', 'Per Diem')}
              />
              <CheckboxFilter
                label="Other"
                count={counts?.jobType['Other'] || 0}
                checked={filters.jobType.includes('Other')}
                onChange={() => toggleArrayFilter('jobType', 'Other')}
              />
            </FilterSection>

            {/* Work Mode */}
            <FilterSection title="Work Mode">
              <CheckboxFilter
                label="Remote"
                count={counts?.workMode.remote || 0}
                checked={filters.workMode.includes('remote')}
                onChange={() => toggleArrayFilter('workMode', 'remote')}
              />
              <CheckboxFilter
                label="Hybrid"
                count={counts?.workMode.hybrid || 0}
                checked={filters.workMode.includes('hybrid')}
                onChange={() => toggleArrayFilter('workMode', 'hybrid')}
              />
              <CheckboxFilter
                label="On-site"
                count={counts?.workMode.onsite || 0}
                checked={filters.workMode.includes('onsite')}
                onChange={() => toggleArrayFilter('workMode', 'onsite')}
              />
            </FilterSection>

            {/* Employer Type (teardown A6) — company-level, HUMAN-set
                classification (Company.recruitmentType, written only from
                /admin/companies). Three states: Any (both unchecked), Direct,
                Staffing. The facet also names the UNCLASSIFIED bucket with a
                live count so selecting a type never silently hides that
                inventory — and never implies an unclassified employer is an
                agency. No count badges on the two options: the filter-counts
                API doesn't report this facet yet, and we never fabricate a
                zero (see CheckboxFilter's count contract above). */}
            <FilterSection title="Employer Type">
              <CheckboxFilter
                label="Direct employers"
                checked={filters.recruitmentType === 'direct_hire'}
                onChange={() =>
                  setSingleFilter('recruitmentType', filters.recruitmentType === 'direct_hire' ? null : 'direct_hire')
                }
              />
              <CheckboxFilter
                label="Staffing agencies"
                checked={filters.recruitmentType === 'staffing_agency'}
                onChange={() =>
                  setSingleFilter('recruitmentType', filters.recruitmentType === 'staffing_agency' ? null : 'staffing_agency')
                }
              />
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '2px 6px 0', lineHeight: 1.4 }}>
                Our team labels employers one by one: direct employers hire onto
                their own staff; staffing agencies recruit for client
                organizations. Neither label ranks a job higher.
              </p>
              {unclassifiedCount !== null && unclassifiedCount > 0 && (
                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '6px 6px 0', lineHeight: 1.4 }}>
                  {unclassifiedCount.toLocaleString()}{' '}
                  {unclassifiedCount === 1 ? 'job is' : 'jobs are'} from employers
                  we haven&rsquo;t classified yet. Picking a type hides them
                  &mdash; not classified doesn&rsquo;t mean staffing agency.
                </p>
              )}
            </FilterSection>

            {/* Specialty — the taxonomy registry's clinical specialty axis
                (SPECIALTY_FILTER_OPTIONS in lib/filters.ts), riding the same
                `specialty` URL param as the legacy work-type values. Count
                badges appear per specialty once the filter-counts API
                reports keys for these slugs. */}
            <FilterSection title="Specialty">
              {SPECIALTY_FILTER_OPTIONS.map((option) => (
                <CheckboxFilter
                  key={option.value}
                  label={option.label}
                  count={specialtyCounts[option.value]}
                  checked={filters.specialty?.includes(option.value) || false}
                  onChange={() => toggleArrayFilter('specialty', option.value)}
                />
              ))}
            </FilterSection>

            {/* Work Type — the legacy Telehealth / Travel keyword filters.
                Their 'Telehealth' / 'Travel' URL values predate the taxonomy
                registry and are preserved as-is. */}
            <FilterSection title="Work Type">
              <CheckboxFilter
                label="Telehealth"
                count={counts?.specialty?.Telehealth || 0}
                checked={filters.specialty?.includes('Telehealth') || false}
                onChange={() => toggleArrayFilter('specialty', 'Telehealth')}
              />
              <CheckboxFilter
                label="Travel / Locum"
                count={counts?.specialty?.Travel || 0}
                checked={filters.specialty?.includes('Travel') || false}
                onChange={() => toggleArrayFilter('specialty', 'Travel')}
              />
            </FilterSection>

            {/* Experience — two DISTINCT questions, kept visually separate so
                their counts don't read as contradictory:
                  • "Open to new grads" is an EMPLOYER signal (does this employer
                    welcome new grads?) — deliberately a small, specific set.
                  • "Your experience" is CANDIDATE-side: pick your years and we
                    show the roles you qualify for, so counts legitimately GROW
                    with experience.
                The old flat list made the 12 → 1,369 jump look broken. The dead
                7+/10+ buckets (identical to 5+; no job requires >5 yrs) are
                removed — see EXPERIENCE_FILTER_BUCKETS in lib/filters.ts. */}
            <FilterSection title="Experience">
              <CheckboxFilter
                label="Open to new grads"
                count={counts?.newGradFriendly || 0}
                checked={filters.newGradFriendly === true}
                onChange={() =>
                  setSingleFilter('newGradFriendly', filters.newGradFriendly === true ? null : true)
                }
              />
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '2px 6px 0', lineHeight: 1.4 }}>
                Employers open to candidates with little or no experience.
              </p>

              <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', margin: '12px 0 8px' }} />

              <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', margin: '0 6px 2px', letterSpacing: '0.01em' }}>
                Your experience
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 6px 8px', lineHeight: 1.4 }}>
                Pick your years — we&rsquo;ll show the roles you qualify for.
              </p>
              <CheckboxFilter
                label="I have 1+ years"
                count={counts?.minYears?.[1] || 0}
                checked={filters.minYearsExperience === 1}
                onChange={() =>
                  setSingleFilter('minYearsExperience', filters.minYearsExperience === 1 ? null : 1)
                }
              />
              <CheckboxFilter
                label="I have 2+ years"
                count={counts?.minYears?.[2] || 0}
                checked={filters.minYearsExperience === 2}
                onChange={() =>
                  setSingleFilter('minYearsExperience', filters.minYearsExperience === 2 ? null : 2)
                }
              />
              <CheckboxFilter
                label="I have 5+ years"
                count={counts?.minYears?.[5] || 0}
                checked={filters.minYearsExperience === 5}
                onChange={() =>
                  setSingleFilter('minYearsExperience', filters.minYearsExperience === 5 ? null : 5)
                }
              />
            </FilterSection>

            {/* Salary — bucket labels/values/count keys live in
                config/niche/stats.ts (SALARY_FILTER_BUCKETS). `value` flows
                into the salaryMin query param; `countKey` must match the
                filter-counts API's fixed salary buckets. */}
            <FilterSection title="Salary">
              {SALARY_FILTER_BUCKETS.map((bucket) => (
                <CheckboxFilter
                  key={bucket.value}
                  label={bucket.label}
                  count={counts?.salary[bucket.countKey] || 0}
                  checked={filters.salaryMin === bucket.value}
                  onChange={() => setSingleFilter('salaryMin', filters.salaryMin === bucket.value ? null : bucket.value)}
                />
              ))}
            </FilterSection>
          </div>
        </div>
      </div>

      <style>{`
        .li-filter-row:hover {
          background: var(--bg-tertiary) !important;
        }
        .li-filter-disabled {
          opacity: 0.5;
        }
        .li-filter-input::placeholder {
          color: var(--text-tertiary) !important;
        }
        .li-filter-input:focus {
          border-color: var(--color-primary) !important;
          box-shadow: 0 0 0 2px rgba(244,114,182,0.15);
        }
        .li-checkbox:checked {
          accent-color: var(--color-primary);
        }
      `}</style>
    </>
  );
}
