import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Cache invalidation for public ISR pages that render admin moderation
 * decisions (P10 admin-revalidate #3 and #4).
 *
 * Every page below is ISR (`revalidate = 3600`). Without an explicit
 * revalidatePath after an admin write, a page rendered before the decision
 * keeps serving the stale answer for up to an hour: /testimonials stays a
 * 404 after a testimonial is featured, a company profile keeps offering
 * "Claim this profile" after approval, and job pages keep rendering
 * AboutEmployer without the Claimed badge.
 *
 * Revalidation runs AFTER the database write has committed. A failure here
 * never undoes or fails the moderation decision (the hourly ISR window is the
 * fallback), so it is logged rather than thrown.
 */

/** Public pages that render featured employer testimonials. */
export const TESTIMONIAL_PUBLIC_PATHS: readonly string[] = [
    '/testimonials',
    // <FeaturedTestimonials /> section band.
    '/for-employers',
    // <FeaturedTestimonials variant="compact" /> point-of-sale panel.
    '/post-job/checkout',
];

/**
 * Public URL segment for a company profile. Mirrors the link builder in
 * app/companies/page.tsx: legacy rows store the space form of normalizedName,
 * and single space to hyphen is the inverse of the profile resolver's
 * legacy fallback.
 */
export function companyProfileSlug(normalizedName: string): string {
    return normalizedName.replace(/ /g, '-');
}

/**
 * Every public path that renders a company's trust signals
 * (claimVerifiedAt, recruitmentType): the A to Z hub, the profile, and each
 * job page (AboutEmployer badge). Pure, so it is unit-testable.
 */
export function companyPublicPaths(
    normalizedName: string,
    jobSlugs: readonly (string | null | undefined)[],
): string[] {
    const paths = ['/companies', `/companies/${companyProfileSlug(normalizedName)}`];
    for (const slug of jobSlugs) {
        if (typeof slug === 'string' && slug.trim() !== '') {
            paths.push(`/jobs/${slug}`);
        }
    }
    return [...new Set(paths)];
}

/** Revalidate each path, isolating failures so one bad path cannot block the rest. */
export function revalidatePublicPaths(paths: readonly string[], context: string): void {
    for (const path of paths) {
        try {
            revalidatePath(path);
        } catch (error) {
            logger.error(`[${context}] revalidatePath failed`, error, { path });
        }
    }
}

export function revalidateTestimonialSurfaces(): void {
    revalidatePublicPaths(TESTIMONIAL_PUBLIC_PATHS, 'Admin Testimonials');
}

/**
 * Look up the company's profile slug and job slugs, then revalidate every
 * public page that shows its trust signals.
 */
export async function revalidateCompanySurfaces(companyId: string, context: string): Promise<void> {
    try {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: {
                normalizedName: true,
                jobs: { where: { slug: { not: null } }, select: { slug: true } },
            },
        });
        if (!company) {
            // Still refresh the hub so a vanished row cannot linger there.
            revalidatePublicPaths(['/companies'], context);
            return;
        }
        revalidatePublicPaths(
            companyPublicPaths(company.normalizedName, company.jobs.map((job) => job.slug)),
            context,
        );
    } catch (error) {
        logger.error(`[${context}] company revalidation lookup failed`, error, { companyId });
        revalidatePublicPaths(['/companies'], context);
    }
}
