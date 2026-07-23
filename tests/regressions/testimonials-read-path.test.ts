/**
 * Regression guards for the employer-testimonial read path (backlog B8).
 *
 * Before this fix, EmployerTestimonial was write-only: the POST route and
 * dashboard card collected consented submissions, but featuredAt/displayAs
 * were dead columns — no admin review surface, no public display.
 *
 * These guards pin:
 *   1. the write path's consent semantics stay intact;
 *   2. the admin list + review routes exist behind requireApiAdmin;
 *   3. featuring is consent-gated and displayAs can only be narrowed
 *      (privacy-monotonic), never widened beyond what was consented to;
 *   4. the public display component only ever shows consented + featured
 *      rows, renders nothing when none are approved, and never renders an
 *      email address as attribution;
 *   5. the component is actually mounted on /for-employers and the admin
 *      surface is reachable from the sidebar.
 *
 * Static source assertions (mirroring saved-apps-clear-and-errors.test.ts)
 * because the vitest environment is node-only — no DOM/RTL harness exists
 * in this repo to mount the components.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const writeRoute = read('app/api/employer/testimonials/route.ts');
const listRoute = read('app/api/admin/testimonials/route.ts');
const patchRoute = read('app/api/admin/testimonials/[id]/route.ts');
const displayComponent = read('components/FeaturedTestimonials.tsx');
const forEmployersPage = read('app/for-employers/page.tsx');
const adminPage = read('app/admin/testimonials/page.tsx');
const sidebar = read('app/admin/_components/AdminSidebar.tsx');

describe('B8: write path consent semantics stay intact', () => {
    it('still refuses submissions without explicit consent', () => {
        expect(writeRoute).toContain('if (consent !== true)');
        expect(writeRoute).toContain('Please check the consent box');
    });
});

describe('B8: admin review API', () => {
    it('list route is admin-gated and reads the testimonial table', () => {
        expect(listRoute).toContain("import { requireApiAdmin } from '@/lib/auth/require-api-admin'");
        expect(listRoute).toContain('const authError = await requireApiAdmin(request)');
        expect(listRoute).toContain('prisma.employerTestimonial.findMany');
        // Admins see everything, newest first — review before featuring.
        expect(listRoute).toContain("orderBy: { createdAt: 'desc' }");
        expect(listRoute).toContain('consent: true,');
        expect(listRoute).toContain('featuredAt: true,');
    });

    it('PATCH route is admin-gated', () => {
        expect(patchRoute).toContain('const authError = await requireApiAdmin(request)');
    });

    it('featuring is consent-gated (schema default is false — defense in depth)', () => {
        const featureBranch = patchRoute.slice(
            patchRoute.indexOf('if (featured === true)'),
            patchRoute.indexOf('} else if (featured === false)'),
        );
        expect(featureBranch.length).toBeGreaterThan(0);
        expect(featureBranch).toContain('if (!existing.consent)');
        expect(featureBranch).toContain('without public-display consent');
        // The consent rejection comes BEFORE any featuredAt stamp.
        expect(featureBranch.indexOf('!existing.consent')).toBeLessThan(
            featureBranch.indexOf('data.featuredAt = new Date()'),
        );
    });

    it('unfeaturing clears featuredAt', () => {
        expect(patchRoute).toMatch(/featured === false\) \{\s*data\.featuredAt = null;/);
    });

    it('displayAs is privacy-monotonic — widening past the consented setting is rejected', () => {
        expect(patchRoute).toContain('const PRIVACY_RANK');
        expect(patchRoute).toMatch(/anonymous:\s*0/);
        expect(patchRoute).toMatch(/initial:\s*1/);
        expect(patchRoute).toMatch(/full:\s*2/);
        expect(patchRoute).toContain('if (PRIVACY_RANK[displayAs] > currentRank)');
        expect(patchRoute).toContain('Cannot widen attribution');
    });

    it('rejects unknown displayAs values and non-boolean featured', () => {
        expect(patchRoute).toContain('!(displayAs in PRIVACY_RANK)');
        expect(patchRoute).toContain("typeof featured !== 'boolean'");
    });
});

describe('B8: public display component', () => {
    it('is a server component (no client bundle for a marketing section)', () => {
        expect(displayComponent).not.toContain("'use client'");
        expect(displayComponent).toContain('export default async function FeaturedTestimonials');
    });

    it('only ever queries consented AND admin-featured rows', () => {
        expect(displayComponent).toContain('where: { consent: true, featuredAt: { not: null } }');
        expect(displayComponent).toContain("orderBy: { featuredAt: 'desc' }");
        expect(displayComponent).toContain('take: MAX_FEATURED');
    });

    it('renders nothing when no testimonial is approved and on DB failure', () => {
        expect(displayComponent).toContain('if (testimonials.length === 0) return null;');
        // DB errors on a marketing page degrade to nothing, not a 500.
        const catchBlock = displayComponent.slice(displayComponent.indexOf('} catch (error) {'));
        expect(catchBlock).toContain('return null;');
    });

    it('never renders an email address as attribution, whatever displayAs says', () => {
        expect(displayComponent).toContain("if (!name || name.includes('@')) return 'Verified employer';");
        // Email guard runs before the 'full' name branch.
        const fn = displayComponent.slice(
            displayComponent.indexOf('export function formatAttribution'),
            displayComponent.indexOf('const clayCard'),
        );
        expect(fn.indexOf(".includes('@')")).toBeLessThan(fn.indexOf("displayAs === 'full'"));
    });

    it('honors each displayAs consent level', () => {
        expect(displayComponent).toContain("if (displayAs === 'anonymous') return 'Verified employer';");
        expect(displayComponent).toContain("if (displayAs === 'full') return name;");
        // 'initial' default: first name + last-word initial.
        expect(displayComponent).toContain('${words[0]} ${words[1][0].toUpperCase()}.');
    });
});

describe('B8: surfaces are wired up', () => {
    it('for-employers page mounts the display component', () => {
        expect(forEmployersPage).toContain("import FeaturedTestimonials from '@/components/FeaturedTestimonials'");
        expect(forEmployersPage).toContain('<FeaturedTestimonials />');
    });

    it('admin page consumes the admin API and exposes feature/unfeature', () => {
        expect(adminPage).toContain("fetch('/api/admin/testimonials')");
        expect(adminPage).toContain('/api/admin/testimonials/${id}');
        expect(adminPage).toContain("method: 'PATCH'");
        expect(adminPage).toContain('featured: !isFeatured');
    });

    it('admin page mirrors the privacy-monotonic displayAs rule client-side', () => {
        expect(adminPage).toContain('const PRIVACY_RANK');
        expect(adminPage).toContain('PRIVACY_RANK[o.key] <= currentRank');
    });

    it('admin sidebar links to the review surface', () => {
        expect(sidebar).toContain("href: '/admin/testimonials'");
    });
});
