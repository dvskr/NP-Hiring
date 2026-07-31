import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { createClient } from '@/lib/supabase/server';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { CLAIM_SELECT } from '../claim-select';

/**
 * PATCH /api/admin/company-claims/:id
 *
 * The ONLY place `Company.claimVerifiedAt` is ever written.
 *
 *   { action: 'approve' }  → claim approved; stamps Company.claimVerifiedAt
 *                            (once — repeat approvals keep the original date,
 *                            same rule as EmployerTestimonial.featuredAt)
 *   { action: 'reject' }   → claim rejected. Rejecting a claim that had been
 *                            approved is the UNDO path: it clears
 *                            Company.claimVerifiedAt, but only when no OTHER
 *                            approved claim is left standing for that company.
 *
 * Why reject doubles as undo: the claimed badge is a public trust assertion. A
 * mistaken approval that no admin can walk back would be a one-way door on a
 * public surface, which is exactly the failure mode the testimonial flow avoids
 * by making "feature" reversible.
 *
 * What this route deliberately does NOT do:
 *   - touch `Company.isVerified`. That column belongs to the ingest pipeline
 *     (lib/company-normalizer.ts writes it at row creation to mean "the scraped
 *     name matched the KNOWN_COMPANIES map"). Approving a claim here must never
 *     silently upgrade the meaning of that badge.
 *   - touch `description`, `logoUrl` or `website`. The claim step buys the
 *     employer a badge and an org linkage, not edit rights; the enhanced-profile
 *     editor is a separate, later decision.
 */
const patchSchema = z.object({
    action: z.enum(['approve', 'reject']),
    reviewNote: z.string().trim().max(1000).optional().or(z.literal('')),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    // requireApiAdmin also applies the admin rate limit (20/min per IP).
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    // Defence in depth — middleware.ts already gates every /api/* mutation.
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const { id } = await params;

    // Identity of the reviewing admin, for `reviewedBy` and the audit trail.
    // requireApiAdmin returns only pass/fail, so read the session again rather
    // than trusting anything client-supplied.
    let reviewerId: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        reviewerId = user?.id ?? null;
    } catch {
        // Non-fatal: the decision is still recorded, just without an actor id.
        reviewerId = null;
    }

    let parsed: z.infer<typeof patchSchema>;
    try {
        parsed = patchSchema.parse(await request.json());
    } catch (err) {
        return NextResponse.json(
            {
                success: false,
                error: "Invalid request — pass { action: 'approve' | 'reject' }.",
                details: err instanceof Error ? err.message : 'unknown',
            },
            { status: 400 },
        );
    }

    try {
        const existing = await prisma.companyClaim.findUnique({
            where: { id },
            select: { id: true, companyId: true, status: true, claimantUserId: true },
        });
        if (!existing) {
            return NextResponse.json(
                { success: false, error: 'Claim not found' },
                { status: 404 },
            );
        }

        const now = new Date();
        const reviewNote = parsed.reviewNote ? parsed.reviewNote : null;
        const nextStatus = parsed.action === 'approve' ? 'approved' : 'rejected';

        // The transaction RETURNS the resulting company state rather than
        // assigning to an outer `let`: TypeScript does not track assignments
        // made inside a callback, so the post-transaction read of an outer
        // variable would be narrowed to its initializer type.
        const companyClaimVerifiedAt = await prisma.$transaction(async (tx): Promise<Date | null> => {
            await tx.companyClaim.update({
                where: { id },
                data: {
                    status: nextStatus,
                    // Frees the (pendingCompanyId, claimantUserId) unique slot so
                    // a resolved claim never blocks a later resubmission, and so
                    // two rejections of the same pair cannot collide.
                    pendingCompanyId: null,
                    reviewedAt: now,
                    reviewedBy: reviewerId,
                    ...(reviewNote ? { reviewNote } : {}),
                },
            });

            const company = await tx.company.findUnique({
                where: { id: existing.companyId },
                select: { claimVerifiedAt: true },
            });

            if (parsed.action === 'approve') {
                if (company && company.claimVerifiedAt === null) {
                    await tx.company.update({
                        where: { id: existing.companyId },
                        data: { claimVerifiedAt: now },
                    });
                    return now;
                }
                return company?.claimVerifiedAt ?? null;
            }

            // Reject. Only pull the public badge when nothing else justifies it.
            const remainingApproved = await tx.companyClaim.count({
                where: { companyId: existing.companyId, status: 'approved' },
            });
            if (remainingApproved === 0 && company?.claimVerifiedAt) {
                await tx.company.update({
                    where: { id: existing.companyId },
                    data: { claimVerifiedAt: null },
                });
                return null;
            }
            return company?.claimVerifiedAt ?? null;
        });

        await logAudit({
            action: `company.claim.${nextStatus}`,
            actorType: 'admin',
            actorId: reviewerId,
            targetType: 'company',
            targetId: existing.companyId,
            metadata: {
                claimId: id,
                claimantUserId: existing.claimantUserId,
                previousStatus: existing.status,
                claimVerifiedAt: companyClaimVerifiedAt?.toISOString() ?? null,
            },
        });

        logger.info('[Admin Company Claims] reviewed', {
            claimId: id,
            action: parsed.action,
            companyId: existing.companyId,
        });

        const claim = await prisma.companyClaim.findUnique({
            where: { id },
            select: CLAIM_SELECT,
        });

        return NextResponse.json({ success: true, claim });
    } catch (error) {
        logger.error('[Admin Company Claims] PATCH error', error, { id });
        return NextResponse.json(
            { success: false, error: 'Failed to update claim' },
            { status: 500 },
        );
    }
}
