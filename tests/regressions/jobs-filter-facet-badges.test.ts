/**
 * 2026-11-19: on /jobs the Employer Type and Specialty sections showed no
 * numbers while every other section did. POST /api/jobs/filter-counts never
 * reported those two facets, so the sidebar left their badges out. It now
 * counts both, and the sidebar shows them.
 *
 * Employer Type is a human classification (Company.recruitmentType, set in
 * /admin/companies). On 2026-11-19 no live job belonged to a classified
 * company, so both options matched nothing. The facet now appears only when
 * it can narrow the view, or while it is active so it can be cleared.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { showsEmployerTypeFacet } from '@/components/jobs/employer-type-facet';

const buckets = (direct: number, staffing: number) => ({
  recruitmentType: { direct_hire: direct, staffing_agency: staffing, unclassified: 6150 },
});

describe('showsEmployerTypeFacet', () => {
  it('stays hidden until counts arrive, so an empty facet never renders first', () => {
    expect(showsEmployerTypeFacet(null, null)).toBe(false);
    expect(showsEmployerTypeFacet(null, undefined)).toBe(false);
  });

  it('stays hidden while no job in the view has a classified employer', () => {
    expect(showsEmployerTypeFacet(buckets(0, 0), null)).toBe(false);
  });

  it('appears once either option has jobs', () => {
    expect(showsEmployerTypeFacet(buckets(3, 0), null)).toBe(true);
    expect(showsEmployerTypeFacet(buckets(0, 2), null)).toBe(true);
  });

  it('stays visible while the filter is active, so it can be cleared', () => {
    for (const active of ['direct_hire', 'staffing_agency', 'unclassified'] as const) {
      expect(showsEmployerTypeFacet(null, active)).toBe(true);
      expect(showsEmployerTypeFacet(buckets(0, 0), active)).toBe(true);
    }
  });

  it('stays hidden, without throwing, for a response that carries no employer-type counts', () => {
    expect(showsEmployerTypeFacet({}, null)).toBe(false);
  });
});

describe('the /jobs sidebar reads both facets from filter-counts (components/jobs/LinkedInFilters.tsx)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'components', 'jobs', 'LinkedInFilters.tsx'), 'utf8');

  it('gives every specialty option a badge from the counts', () => {
    expect(src).toMatch(/count=\{counts\?\.specialty\?\.\[option\.value\] \?\? 0\}/);
  });

  it('gives both employer-type options a badge and gates the section on them', () => {
    expect(src).toMatch(/count=\{counts\?\.recruitmentType\?\.direct_hire \?\? 0\}/);
    expect(src).toMatch(/count=\{counts\?\.recruitmentType\?\.staffing_agency \?\? 0\}/);
    expect(src).toMatch(/showsEmployerTypeFacet\(counts, filters\.recruitmentType\)/);
  });

  it('takes the total from filter-counts, which honors the employer type, with no second request', () => {
    expect(src).not.toContain('recruitmentTotal');
    expect(src).not.toMatch(/fetch\(`\/api\/jobs\?/);
    expect(src).toMatch(/const displayedTotal = counts\?\.total \?\? null;/);
  });
});
