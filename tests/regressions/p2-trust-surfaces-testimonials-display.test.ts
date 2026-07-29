/**
 * Regression guards for content audit P2 #18 — the public testimonial
 * display surface.
 *
 * The collection half (consent-gated write path, admin review, the featured
 * band on /for-employers) shipped as backlog B8 and is pinned by
 * tests/regressions/testimonials-read-path.test.ts. This file guards the
 * display half added by P2 #18 and the one property that matters most about
 * it: an empty testimonial system must render NOTHING, and must never be
 * "helpfully" seeded with examples to make the page look populated.
 *
 * Specifically pinned:
 *   1. /testimonials reads only consented + admin-featured rows;
 *   2. it 404s when nothing is approved instead of publishing a thin page;
 *   3. it reuses formatAttribution, so the display level can never be
 *      looser here than on the featured band;
 *   4. it emits NO Review/AggregateRating JSON-LD (self-serving reviews are
 *      ineligible for rich results and a structured-data violation);
 *   5. the featured band's "read them all" link is gated on a real count.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const page = read('app/testimonials/page.tsx');
const band = read('components/FeaturedTestimonials.tsx');

describe('P2 #18 — /testimonials only ever shows consented, approved rows', () => {
    it('exists as a server component', () => {
        expect(exists('app/testimonials/page.tsx')).toBe(true);
        expect(page).not.toContain("'use client'");
    });

    it('queries with the same consent + featured gate as the featured band', () => {
        expect(page).toContain('where: { consent: true, featuredAt: { not: null } }');
        expect(page).toContain("orderBy: { featuredAt: 'desc' }");
        expect(page).toContain('take: MAX_TESTIMONIALS');
    });

    it('404s when nothing is approved rather than rendering an empty page', () => {
        expect(page).toContain("import { notFound } from 'next/navigation'");
        expect(page).toContain('if (testimonials.length === 0) notFound();');
    });

    it('degrades a failed read to the same empty path, never to a 500', () => {
        const fn = page.slice(
            page.indexOf('async function getApprovedTestimonials'),
            page.indexOf('const clayCard'),
        );
        expect(fn).toContain('catch (error)');
        expect(fn).toContain('return [];');
    });

    it('reuses the shared attribution formatter instead of re-implementing it', () => {
        expect(page).toContain("from '@/components/FeaturedTestimonials'");
        expect(page).toContain('formatAttribution(t.employerName, t.displayAs)');
    });

    it('contains no seeded / example testimonial content', () => {
        // Any hardcoded quotation in the JSX body would be fabricated social
        // proof. The only quote marks allowed are the entities wrapping the
        // rendered {t.content}.
        const body = page.slice(page.indexOf('export default async function TestimonialsPage'));
        expect(body).toContain('&ldquo;{t.content}&rdquo;');
        expect(body).not.toMatch(/&ldquo;[A-Za-z]/);
        // No invented reviewer names / credentials (the /login + /signup
        // fabrication pattern purged in P0 #18).
        expect(body).not.toMatch(/[A-Z][a-z]+ [A-Z]\.,\s*(PMHNP|FNP|NP|RN|DNP)/);
    });

    it('emits no self-serving Review or AggregateRating structured data', () => {
        // Assert against the markup, not the header comment that explains
        // why this markup is deliberately absent.
        const body = page.slice(page.indexOf("import { Metadata }"));
        expect(body).not.toContain('AggregateRating');
        expect(body).not.toContain('"@type": "Review"');
        expect(body).not.toContain("'@type': 'Review'");
        expect(body).not.toContain('application/ld+json');
    });

    it('explains how testimonials are collected, including removal on request', () => {
        expect(page).toContain('How these are');
        expect(page).toMatch(/[Cc]onsent is a hard requirement/);
        expect(page).toContain('brand.email.support');
        expect(page).toContain('/editorial-policy');
    });
});

describe('P2 #18 — the featured band links the full surface honestly', () => {
    it('still renders nothing when no testimonial is approved', () => {
        expect(band).toContain('if (testimonials.length === 0) return null;');
    });

    it('counts approved rows with the same consent gate before linking', () => {
        expect(band).toContain('approvedTotal = await prisma.employerTestimonial.count');
        expect(band).toContain('where: { consent: true, featuredAt: { not: null } },');
    });

    it('only shows the "read all" link when there are more than it displays', () => {
        expect(band).toContain('approvedTotal > testimonials.length');
        expect(band).toContain('href="/testimonials"');
    });

    it('exposes a compact variant for point-of-sale use that shares the query', () => {
        expect(band).toContain("variant === 'compact'");
        expect(band).toContain('MAX_COMPACT');
        // One query, two variants — the checkout panel cannot show a looser
        // set of testimonials than the marketing page.
        expect((band.match(/prisma\.employerTestimonial\.findMany/g) || []).length).toBe(1);
    });
});
