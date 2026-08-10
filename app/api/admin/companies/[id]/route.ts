import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { createClient } from '@/lib/supabase/server';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { companySelect } from '../company-select';

/**
 * PATCH /api/admin/companies/:id
 *
 * The ONLY place `Company.recruitmentType` is ever written (teardown A6).
 * Classification is a HUMAN act — no ingest path, backfill, or heuristic may
 * ever set this column, and this route accepts exactly one field:
 *
 *   { recruitmentType: 'direct_hire' }      → classify as a direct employer
 *   { recruitmentType: 'staffing_agency' }  → classify as a staffing agency
 *   { recruitmentType: null }               → UNDO: back to unclassified
 *
 * Null-as-undo mirrors the claim route next door (reject-clears-badge): the
 * badge and filter placement are public assertions about a named organization,
 * and a mistaken classification no admin can walk back would be a one-way door
 * on a public surface.
 *
 * What this route deliberately does NOT do:
 *   - touch `isVerified` (ingest pipeline's column) or `claimVerifiedAt`
 *     (claim queue's column). Three trust signals, three writers.
 *   - accept name/website/description edits — this is the classification
 *     control, not a profile editor.
 */
const patchSchema = z.object({
    recruitmentType: z.enum(['direct_hire', 'staffing_agency']).nullable(),
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

    // Identity of the classifying admin for the audit trail. requireApiAdmin
    // returns only pass/fail, so read the session again rather than trusting
    // anything client-supplied (same pattern as the claim review route).
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
                error: "Invalid request — pass { recruitmentType: 'direct_hire' | 'staffing_agency' | null }.",
                details: err instanceof Error ? err.message : 'unknown',
            },
            { status: 400 },
        );
    }

    try {
        const existing = await prisma.company.findUnique({
            where: { id },
            select: { id: true, name: true, recruitmentType: true },
        });
        if (!existing) {
            return NextResponse.json(
                { success: false, error: 'Company not found' },
                { status: 404 },
            );
        }

        const company = await prisma.company.update({
            where: { id },
            data: { recruitmentType: parsed.recruitmentType },
            select: companySelect(),
        });

        await logAudit({
            action: parsed.recruitmentType === null
                ? 'company.recruitment_type.clear'
                : 'company.recruitment_type.set',
            actorType: 'admin',
            actorId: reviewerId,
            targetType: 'company',
            targetId: existing.id,
            metadata: {
                companyName: existing.name,
                previousRecruitmentType: existing.recruitmentType,
                recruitmentType: parsed.recruitmentType,
            },
        });

        logger.info('[Admin Companies] recruitment type updated', {
            companyId: existing.id,
            recruitmentType: parsed.recruitmentType,
        });

        return NextResponse.json({ success: true, company });
    } catch (error) {
        logger.error('[Admin Companies] PATCH error', error, { id });
        return NextResponse.json(
            { success: false, error: 'Failed to update company' },
            { status: 500 },
        );
    }
}
