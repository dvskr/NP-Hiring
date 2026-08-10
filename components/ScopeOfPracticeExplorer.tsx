'use client';

/**
 * Interactive 51-jurisdiction scope-of-practice explorer (P5 sop-hub).
 *
 * Sortable + filterable table over the rows assembled in
 * ScopeOfPracticeData.ts — no external table/map libraries. Accessibility
 * contract (pinned by tests/regressions/p5-sop-hub-scope-of-practice.test.ts):
 *   - the search input has a visible <label> wired via htmlFor
 *   - tier filters are toggle buttons with aria-pressed
 *   - sortable column headers carry aria-sort and are operated by real
 *     <button> elements (keyboard-native)
 *   - the result count announces changes via aria-live="polite"
 *
 * Tier colors come from getAuthorityColor in lib/state-practice-authority.ts
 * — the same helper /resources/fpa-guide renders — so the hub can never
 * drift from the board-wide full/reduced/restricted color semantics.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
    getAuthorityColor,
    type PracticeAuthority,
} from '@/lib/state-practice-authority';
import type { SopStateRow } from './ScopeOfPracticeData';

type TierFilter = 'all' | PracticeAuthority;
type SortKey = 'state' | 'authority';
type SortDir = 'asc' | 'desc';

/** Sort rank for the authority column: most→least autonomous. */
const AUTHORITY_RANK: Record<PracticeAuthority, number> = {
    full: 0,
    reduced: 1,
    restricted: 2,
};

const TIER_FILTERS: { value: TierFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'full', label: 'Full' },
    { value: 'reduced', label: 'Reduced' },
    { value: 'restricted', label: 'Restricted' },
];

interface ScopeOfPracticeExplorerProps {
    rows: ReadonlyArray<SopStateRow>;
}

export default function ScopeOfPracticeExplorer({ rows }: ScopeOfPracticeExplorerProps) {
    const [query, setQuery] = useState('');
    const [tier, setTier] = useState<TierFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('state');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const tierCounts = useMemo(() => {
        const counts: Record<TierFilter, number> = {
            all: rows.length,
            full: 0,
            reduced: 0,
            restricted: 0,
        };
        for (const row of rows) counts[row.authority] += 1;
        return counts;
    }, [rows]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = rows.filter((row) => {
            if (tier !== 'all' && row.authority !== tier) return false;
            if (!q) return true;
            return (
                row.name.toLowerCase().includes(q) || row.code.toLowerCase() === q
            );
        });
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            if (sortKey === 'authority') {
                const byRank = AUTHORITY_RANK[a.authority] - AUTHORITY_RANK[b.authority];
                if (byRank !== 0) return byRank * dir;
                return a.name.localeCompare(b.name);
            }
            return a.name.localeCompare(b.name) * dir;
        });
    }, [rows, query, tier, sortKey, sortDir]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortKey(key);
        setSortDir('asc');
    };

    const ariaSortFor = (key: SortKey): 'ascending' | 'descending' | 'none' => {
        if (sortKey !== key) return 'none';
        return sortDir === 'asc' ? 'ascending' : 'descending';
    };

    const sortArrow = (key: SortKey) =>
        sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕';

    return (
        <div>
            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-end gap-4 mb-4">
                <div className="flex-1">
                    <label
                        htmlFor="sop-state-search"
                        className="block text-sm font-semibold mb-1"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        Search by state name or postal code
                    </label>
                    <input
                        id="sop-state-search"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="e.g. Texas or TX"
                        autoComplete="off"
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{
                            backgroundColor: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)',
                        }}
                    />
                </div>
                <div
                    role="group"
                    aria-label="Filter by practice authority tier"
                    className="flex flex-wrap gap-2"
                >
                    {TIER_FILTERS.map((f) => {
                        const isActive = tier === f.value;
                        return (
                            <button
                                key={f.value}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => setTier(f.value)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                    isActive
                                        ? 'bg-pink-700 border-pink-700 text-white'
                                        : 'bg-transparent hover:bg-pink-50'
                                }`}
                                style={
                                    isActive
                                        ? undefined
                                        : {
                                              border: '1px solid var(--border-color)',
                                              color: 'var(--text-primary)',
                                          }
                                }
                            >
                                {f.label} ({tierCounts[f.value]})
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Result count — announced to screen readers as filters change */}
            <p
                aria-live="polite"
                className="text-sm mb-3"
                style={{ color: 'var(--text-secondary)' }}
            >
                Showing {visibleRows.length} of {rows.length} jurisdictions
            </p>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                            <th
                                aria-sort={ariaSortFor('state')}
                                className="text-left py-3 pr-4"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleSort('state')}
                                    className="font-semibold hover:underline"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    State <span aria-hidden="true">{sortArrow('state')}</span>
                                </button>
                            </th>
                            <th
                                aria-sort={ariaSortFor('authority')}
                                className="text-left py-3 px-4"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleSort('authority')}
                                    className="font-semibold hover:underline"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    Practice authority{' '}
                                    <span aria-hidden="true">{sortArrow('authority')}</span>
                                </button>
                            </th>
                            <th
                                className="text-left py-3 pl-4 font-semibold hidden lg:table-cell"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                What that means here
                            </th>
                            <th
                                className="text-right py-3 pl-4 font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                Go to
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="py-6 text-center"
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    No jurisdictions match — clear the search or pick a
                                    different tier.
                                </td>
                            </tr>
                        )}
                        {visibleRows.map((row) => {
                            const colors = getAuthorityColor(row.authority);
                            return (
                                <tr
                                    key={row.stateSlug}
                                    style={{ borderBottom: '1px solid var(--border-color)' }}
                                >
                                    <td className="py-3 pr-4">
                                        {/* Deep anchor into the per-state detail
                                            section further down this page */}
                                        <a
                                            href={`#${row.anchorId}`}
                                            className="font-medium hover:underline"
                                            style={{ color: 'var(--color-primary)' }}
                                        >
                                            {row.name}
                                        </a>
                                        <span
                                            className="ml-1 text-xs"
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            {row.code}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} ${colors.border} border`}
                                        >
                                            {row.authorityLabel}
                                        </span>
                                    </td>
                                    <td
                                        className="py-3 pl-4 hidden lg:table-cell text-xs"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {row.details}
                                    </td>
                                    <td className="py-3 pl-4 text-right whitespace-nowrap">
                                        <span className="inline-flex gap-3 text-xs font-medium">
                                            {row.licenseGuideHref && (
                                                <Link
                                                    href={row.licenseGuideHref}
                                                    className="hover:underline"
                                                    style={{ color: 'var(--color-primary)' }}
                                                >
                                                    Licensure
                                                </Link>
                                            )}
                                            <Link
                                                href={row.salaryHref}
                                                className="hover:underline"
                                                style={{ color: 'var(--color-primary)' }}
                                            >
                                                Salary
                                            </Link>
                                            <Link
                                                href={row.jobsHref}
                                                className="hover:underline"
                                                style={{ color: 'var(--color-primary)' }}
                                            >
                                                Jobs
                                            </Link>
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
