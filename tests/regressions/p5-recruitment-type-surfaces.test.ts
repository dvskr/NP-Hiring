/**
 * P5 A6 — candidate-side surfaces for the direct-hire vs staffing-agency
 * classification: the /jobs facet, the JobCard badge, the company-profile
 * badge, and the admin queue's reachability.
 *
 * The UX invariants under test:
 *   1. QUIET — the facet is two labelled checkboxes with no explanatory copy
 *      (owner call, 2026-10-12); the deep-link pill for the unclassified
 *      bucket says "No employer type", never anything that reads as an agency.
 *   2. NEUTRALITY — badges render facts ("Direct employer" / "Staffing
 *      agency"), never warnings, and NULL renders as nothing everywhere.
 *   3. NO SILENT DROP — JobsPageClient.fetchJobs serializes its /api/jobs
 *      query through the shared filtersToParams contract, so SPA refetches
 *      (sort change, pagination, facet toggles) keep an active employer-type
 *      filter. The old hard-navigation guard in the facet existed only to
 *      paper over fetchJobs' enumerated param list dropping the param; both
 *      halves must stay in lockstep — reintroducing a hand-enumerated
 *      serialization without restoring the guard silently un-filters the
 *      list while the URL, pill, and total claim otherwise.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('/jobs facet (components/jobs/LinkedInFilters.tsx)', () => {
    const src = read('components/jobs/LinkedInFilters.tsx');

    it('offers the three states: Any (both unchecked), Direct, Staffing', () => {
        expect(src).toContain('Employer Type');
        expect(src).toContain('Direct employers');
        expect(src).toContain('Staffing agencies');
        expect(src).toMatch(/recruitmentType === 'direct_hire' \? null : 'direct_hire'/);
        expect(src).toMatch(/recruitmentType === 'staffing_agency' \? null : 'staffing_agency'/);
    });

    it('carries no explanatory copy under the two options (owner call, 2026-10-12)', () => {
        // No definitions, no process narration, no unclassified-count line.
        expect(src).not.toMatch(/Our team labels employers/);
        expect(src).not.toMatch(/ranks a job higher/);
        expect(src).not.toMatch(/not classified does not mean/);
        expect(src).not.toMatch(/hire for their own staff/);
        // The count line was the only consumer of the unclassified probe, so
        // the extra /api/jobs request went with it.
        expect(src).not.toContain('unclassifiedCount');
        expect(src).not.toMatch(/recruitmentType: 'unclassified'/);
        // The deep-link pill for the unclassified bucket uses neutral
        // wording, never our backlog state ("not yet classified").
        expect(src).toContain(": 'No employer type',");
        expect(src).not.toMatch(/'Employers not yet classified'/);
    });

    it('stays SPA — no hard-navigation guard now that fetchJobs forwards the param', () => {
        // The guard existed only because JobsPageClient.fetchJobs used to
        // re-serialize an enumerated param list that dropped recruitmentType.
        // fetchJobs now goes through the shared filtersToParams contract (see
        // the JobsPageClient describe below), so a document navigation here
        // would be pure regression: full reload on every facet toggle.
        expect(src).not.toContain('window.location.assign');
        // Every mutation path must still route through the single helper —
        // a raw router.push of a filter URL bypasses the shared filtersToParams
        // serialization and could drift from the URL contract. The only
        // permitted direct pushes are the helper's own body (pushes the
        // prebuilt `url` variable) and clear-all's literal '/jobs'.
        const rawFilterPushes = src.match(/router\.push\(`\/jobs\?/g) ?? [];
        expect(rawFilterPushes.length).toBe(0);
        const helperCalls = src.match(/navigateWithFilters\(/g) ?? [];
        // call sites: toggleArrayFilter + setSingleFilter + search + location
        expect(helperCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('substitutes an accurate total while the filter is active (filter-counts drops the param)', () => {
        expect(src).toContain('displayedTotal');
        expect(src).toMatch(/filters\.recruitmentType\s*\?\s*recruitmentTotal/);
    });
});

describe('JobsPageClient refetch keeps the filter (app/jobs/JobsPageClient.tsx)', () => {
    const src = read('app/jobs/JobsPageClient.tsx');

    it('fetchJobs serializes through the shared filtersToParams contract', () => {
        // Sort changes (handleSortChange → router.push) and pagination Links
        // re-enter through the searchParams effect → fetchJobs. The query it
        // sends to /api/jobs must carry EVERY URL filter param — the API
        // re-parses with parseFiltersFromParams, so using filtersToParams on
        // this side makes the round-trip drift-proof by construction.
        expect(src).toMatch(/const params = filtersToParams\(filters\)/);
        expect(src).toMatch(/fetchJobs = useCallback\(async \(filters: RecruitmentFilterState/);
    });

    it('no hand-enumerated param list remains that could silently drop a filter again', () => {
        // The old serialization appended each known field by name and dropped
        // the rest (recruitmentType, newGrad, minYears, employer). Any
        // reappearance of per-field appends inside this file is the drop bug
        // coming back under a new name.
        expect(src).not.toMatch(/params\.append\('workMode'/);
        expect(src).not.toMatch(/params\.set\('q'/);
    });
});

describe('JobCard badge (components/JobCard.tsx)', () => {
    const src = read('components/JobCard.tsx');

    it('renders the badge only for the two classified values — null/absent shows nothing', () => {
        expect(src).toContain('companyRecruitmentType');
        expect(src).toMatch(/value !== 'direct_hire' && value !== 'staffing_agency'\) return null/);
    });

    it('uses the shared label map so surfaces cannot drift', () => {
        expect(src).toContain('RECRUITMENT_TYPE_LABELS');
    });

    it('renders the badge in BOTH view modes (list and grid chip rows)', () => {
        const occurrences = src.match(/recruitmentBadgeLabel\(job\) && \(/g) ?? [];
        expect(occurrences.length).toBe(2);
    });
});

describe('company profile badge (app/companies/[slug]/page.tsx)', () => {
    const src = read('app/companies/[slug]/page.tsx');

    it('renders only for classified companies, from the shared label map', () => {
        expect(src).toMatch(/company\.recruitmentType && \(/);
        expect(src).toContain('RECRUITMENT_TYPE_LABELS[company.recruitmentType]');
    });

    it('keeps the trust family separated — its own block, not folded into isVerified or claim badges', () => {
        // The doc comment carries the separation rule forward; the badge must
        // not render inside the isVerified span or reuse its "Verified" copy.
        expect(src).toMatch(/THIRD member/);
    });

    it('shows the badge alone, with no explanatory sentence or defensive aside (owner call, 2026-10-12)', () => {
        expect(src).not.toContain('hires clinicians for its own staff.');
        expect(src).not.toContain('recruits clinicians for client organizations.');
        expect(src).not.toContain('not a quality judgment');
        expect(src).not.toMatch(/Our team classified/);
    });
});

describe('admin reachability', () => {
    it('the sidebar links the classification queue (otherwise the loop never starts)', () => {
        const src = read('app/admin/_components/AdminSidebar.tsx');
        expect(src).toContain("href: '/admin/companies'");
    });

    it('the admin page tells the classifier to verify, not infer, and to leave unknowns NULL', () => {
        const src = read('app/admin/companies/page.tsx');
        expect(src).toContain('leave it unclassified');
        expect(src).toContain('Neither label is a warning');
        // Triage order — largest active inventory first.
        expect(src).toMatch(/sorted by active job count/);
    });
});
