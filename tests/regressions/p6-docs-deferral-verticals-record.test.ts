/**
 * P6 docs-deferral — the 8-vertical taxonomy deferral is recorded IN-REPO.
 *
 * The 2026-07 content-gap synthesis §7 deferred eight NP verticals
 * ("add after checking live inventory coverage"), but the synthesis was a
 * session artifact that was never committed — the deferral existed only
 * outside the repo, and taxonomy-registry.ts cited the uncommitted doc.
 * These pins keep the in-repo record honest:
 *
 *   - docs/PENDING_WORK.md §3.7 names all 8 deferred verticals, carries
 *     the original rationale, and lists the full tier-build checklist
 *     (registry + folders + tagger + asset registry + FAQ).
 *   - taxonomy-registry.ts points at that in-repo record instead of the
 *     uncommitted synthesis doc.
 *   - None of the deferred verticals is silently present in the registry:
 *     shipping one must remove it from the §3.7 deferred list in the same
 *     change (this test fails until the doc moves in lockstep).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const PENDING_WORK_PATH = path.join(process.cwd(), 'docs', 'PENDING_WORK.md');
const REGISTRY_PATH = path.join(process.cwd(), 'lib', 'pseo', 'taxonomy-registry.ts');

const DEFERRED_VERTICAL_NAMES = [
    'endocrinology/diabetes',
    'sleep-medicine',
    'utilization-review',
    'informatics',
    'education-faculty',
    'wound-care',
    'iv-infusion',
    'functional-medicine',
] as const;

/** Slug spellings a shipped vertical would plausibly claim in the registry. */
const DEFERRED_SLUG_CANDIDATES = [
    'endocrinology',
    'diabetes',
    'endocrinology-diabetes',
    'sleep-medicine',
    'utilization-review',
    'informatics',
    'education-faculty',
    'wound-care',
    'iv-infusion',
    'functional-medicine',
] as const;

describe('P6 docs-deferral: 8-vertical deferral is recorded in-repo', () => {
    const pendingWork = fs.readFileSync(PENDING_WORK_PATH, 'utf8');
    const registrySource = fs.readFileSync(REGISTRY_PATH, 'utf8');

    it('PENDING_WORK.md has the dated deferred-verticals subsection', () => {
        expect(pendingWork).toMatch(/### 3\.7 Deferred taxonomy verticals \(recorded \d{4}-\d{2}-\d{2}\)/);
    });

    it('names all 8 deferred verticals', () => {
        for (const name of DEFERRED_VERTICAL_NAMES) {
            expect(pendingWork, `deferred vertical "${name}" missing from docs/PENDING_WORK.md §3.7`).toContain(name);
        }
    });

    it('carries the original deferral rationale', () => {
        expect(pendingWork).toContain('add after checking live inventory coverage');
    });

    it('lists the full tier-build checklist for adding a vertical', () => {
        // The five moving parts the drift tests enforce agreement across.
        expect(pendingWork).toContain('CATEGORY_AXES');
        expect(pendingWork).toContain('tests/seo/jobs-segments-drift.test.ts');
        expect(pendingWork).toContain('lib/pseo/category-tagger.ts');
        expect(pendingWork).toContain('scripts/backfill-category-tags.ts');
        expect(pendingWork).toContain('lib/pseo/category-asset-registry.ts');
        expect(pendingWork).toContain('lib/pseo/category-faq-data.ts');
    });

    it('taxonomy-registry.ts cites the in-repo record, not only the uncommitted synthesis', () => {
        expect(registrySource).toContain('docs/PENDING_WORK.md');
    });

    it('no deferred vertical has shipped without updating the deferred list', () => {
        // Ratchet, not a ban: shipping one of these verticals is fine — the
        // same change must move it out of the deferred list in
        // docs/PENDING_WORK.md §3.7 and adjust this test's candidate list.
        const shipped = DEFERRED_SLUG_CANDIDATES.filter((slug) => ALL_CATEGORY_SLUGS.includes(slug));
        expect(
            shipped,
            `slug(s) [${shipped.join(', ')}] are in the registry but still listed as deferred in docs/PENDING_WORK.md §3.7 — update the doc and this test in the same change`,
        ).toEqual([]);
    });
});
