/**
 * P5 A6 — direct-hire vs staffing-agency filter plumbing (lib/filters.ts).
 *
 * Behavioral tests for the one piece of the classification machinery with
 * query logic. The properties that matter:
 *
 *   1. The three buckets (direct / staffing / unclassified) PARTITION the
 *      board. "Unclassified" must cover both a job with no Company link and a
 *      Company no human has classified — otherwise the facet's honesty
 *      arithmetic (direct + staffing + unclassified = total) silently breaks
 *      and the filter hides inventory without saying so.
 *   2. NULL never matches either classified bucket. Company.recruitmentType
 *      is written only by an admin (PATCH /api/admin/companies/:id); every
 *      other row is NULL, and NULL must read as "no human has decided",
 *      never as either type.
 *   3. The URL param round-trips and rejects garbage — 'unclassified' is a
 *      legal QUERY value (it powers the facet count) even though the DB enum
 *      can never store it.
 */
import { describe, it, expect } from 'vitest';
import {
    buildWhereClause,
    filtersToParams,
    parseFiltersFromParams,
    parseRecruitmentTypeParam,
    recruitmentTypeClause,
    RECRUITMENT_TYPE_LABELS,
    RECRUITMENT_TYPE_VALUES,
    type RecruitmentFilterState,
} from '@/lib/filters';
import { DEFAULT_FILTERS, type FilterState } from '@/types/filters';

describe('parseRecruitmentTypeParam', () => {
    it('accepts exactly the two enum values plus the unclassified query bucket', () => {
        expect(parseRecruitmentTypeParam('direct_hire')).toBe('direct_hire');
        expect(parseRecruitmentTypeParam('staffing_agency')).toBe('staffing_agency');
        expect(parseRecruitmentTypeParam('unclassified')).toBe('unclassified');
    });

    it('returns null for anything else — never a guess', () => {
        for (const bad of [null, '', 'DIRECT_HIRE', 'agency', 'direct-hire', 'both', '1']) {
            expect(parseRecruitmentTypeParam(bad), String(bad)).toBeNull();
        }
    });
});

describe('URL param round-trip', () => {
    it('parseFiltersFromParams reads ?recruitmentType= and filtersToParams writes it back', () => {
        const parsed = parseFiltersFromParams(
            new URLSearchParams('recruitmentType=staffing_agency&location=Texas'),
        );
        expect(parsed.recruitmentType).toBe('staffing_agency');
        const out = filtersToParams(parsed);
        expect(out.get('recruitmentType')).toBe('staffing_agency');
        expect(out.get('location')).toBe('Texas');
    });

    it('omits the param entirely when no employer-type filter is active', () => {
        const parsed = parseFiltersFromParams(new URLSearchParams('location=Texas'));
        expect(parsed.recruitmentType).toBeNull();
        expect(filtersToParams(parsed).has('recruitmentType')).toBe(false);
    });

    it('drops an invalid param value instead of forwarding it to the query', () => {
        const parsed = parseFiltersFromParams(new URLSearchParams('recruitmentType=evil'));
        expect(parsed.recruitmentType).toBeNull();
    });
});

describe('recruitmentTypeClause — the three buckets partition the board', () => {
    it('classified buckets require a linked Company row with that exact value', () => {
        expect(recruitmentTypeClause('direct_hire')).toEqual({
            company: { is: { recruitmentType: 'direct_hire' } },
        });
        expect(recruitmentTypeClause('staffing_agency')).toEqual({
            company: { is: { recruitmentType: 'staffing_agency' } },
        });
    });

    it('unclassified covers BOTH no-company jobs and unclassified companies', () => {
        // Without the company-is-null branch, a job the normalizer never
        // linked to a Company row would vanish from all three buckets and the
        // facet's "we never silently hide inventory" claim would be false.
        expect(recruitmentTypeClause('unclassified')).toEqual({
            OR: [
                { company: { is: null } },
                { company: { is: { recruitmentType: null } } },
            ],
        });
    });
});

describe('buildWhereClause integration', () => {
    const withRecruitment = (value: RecruitmentFilterState['recruitmentType']): RecruitmentFilterState => ({
        ...DEFAULT_FILTERS,
        recruitmentType: value,
    });

    it('pushes the employer-type clause into AND when the filter is active', () => {
        const where = buildWhereClause(withRecruitment('direct_hire'));
        expect(where.AND).toEqual(
            expect.arrayContaining([{ company: { is: { recruitmentType: 'direct_hire' } } }]),
        );
    });

    it('adds no company condition when the filter is off', () => {
        const where = buildWhereClause(withRecruitment(null));
        expect(JSON.stringify(where)).not.toContain('recruitmentType');
    });

    it('still accepts a plain FilterState with no recruitmentType key (old call sites)', () => {
        // The filter-counts route and job-alert matcher build plain
        // FilterState literals; the extension must stay optional so they
        // compile and behave identically.
        const plain: FilterState = { ...DEFAULT_FILTERS };
        const where = buildWhereClause(plain);
        expect(JSON.stringify(where)).not.toContain('recruitmentType');
    });

    it('composes with other filters instead of replacing them', () => {
        const where = buildWhereClause({
            ...DEFAULT_FILTERS,
            location: 'Texas',
            recruitmentType: 'staffing_agency',
        });
        const clauses = JSON.stringify(where.AND);
        expect(clauses).toContain('staffing_agency');
        expect(clauses).toContain('Texas');
    });
});

describe('candidate-facing labels', () => {
    it('labels exist for exactly the two stored enum values and stay neutral', () => {
        expect(Object.keys(RECRUITMENT_TYPE_LABELS).sort()).toEqual(
            [...RECRUITMENT_TYPE_VALUES].sort(),
        );
        expect(RECRUITMENT_TYPE_LABELS.direct_hire).toBe('Direct employer');
        expect(RECRUITMENT_TYPE_LABELS.staffing_agency).toBe('Staffing agency');
        // Neither label may editorialize — a staffing agency is a fact about
        // who the hiring organization is, not a warning.
        for (const label of Object.values(RECRUITMENT_TYPE_LABELS)) {
            expect(label).not.toMatch(/warning|avoid|spam|beware|caution/i);
        }
    });
});
