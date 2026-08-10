/**
 * P5 crumbs — the mid-career stipend claim.
 *
 * app/jobs/mid-career/page.tsx:39 used to assert "many employers offer
 * preceptor stipends or bonuses". Preceptor stipends appear in NO repo
 * source of truth (lib/stats-sources.ts, config/niche/salary.ts), which is
 * why tests/regressions/p4-content-wedges-preceptor-schools.test.ts bans the
 * same claim from the preceptor pillar and documents this page as the
 * pre-existing debt it reported upward. This suite retires that debt: the
 * FAQ now states the truthful mechanics (compensation varies by employer;
 * ask during negotiation) and may not regress to a prevalence claim.
 *
 * The FAQ answers double as FAQPage JSON-LD — the schema derives from the
 * same `faqs` array the visible cards render, so keeping the array honest
 * keeps the structured data honest with no separate check.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(
    path.join(process.cwd(), 'app', 'jobs', 'mid-career', 'page.tsx'),
    'utf8',
);

describe('mid-career precepting FAQ carries no unsourced compensation claim', () => {
    it('does not assert that employers offer preceptor stipends or bonuses', () => {
        // Same claim shape the p4 suite bans from the preceptor pillar.
        expect(PAGE).not.toMatch(/employers (?:offer|provide|pay)[^.]{0,60}\bpreceptor (?:stipend|bonus)/i);
        expect(PAGE).not.toMatch(/preceptor stipends?/i);
        expect(PAGE).not.toMatch(/preceptor bonus(?:es)?/i);
    });

    it('states the truthful mechanics instead: varies by employer, ask in negotiation', () => {
        // Mirrors the honest phrasing the preceptor pillar is required to
        // carry ("Whether precepting is compensated…"), so the two surfaces
        // answer the same question the same way.
        expect(PAGE).toMatch(/Whether precepting is compensated varies by employer/);
        expect(PAGE).toMatch(/negotiat/i);
    });

    it('the FAQPage JSON-LD still derives from the same visible faqs array', () => {
        expect(PAGE).toContain('mainEntity: faqs.map(');
        expect(PAGE).toContain("'@type': 'FAQPage'");
    });
});
