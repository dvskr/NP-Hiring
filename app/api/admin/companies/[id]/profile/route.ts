import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { createClient } from '@/lib/supabase/server';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { companySelect } from '../../company-select';
import { revalidateCompanySurfaces } from '../../../_lib/public-revalidation';

/**
 * PATCH /api/admin/companies/:id/profile
 *
 * The admin data pass for an employer's own website and logo (indexing audit
 * GFJ-08). The job page passes Company.website and Company.logoUrl into the
 * JobPosting hiringOrganization as sameAs and logo;
 * scripts/indexing-fixes/populate-company-website-logo.ts fills what it can
 * prove from stored data and the employer homepage, and this route is how a
 * person fills the rest from /admin/companies.
 *
 *   { website: 'https://www.example.org' }  → set (stored as the site origin)
 *   { logoUrl: 'https://…/logo.png' }       → set
 *   { website: null } / { logoUrl: null }   → clear
 *
 * Only absolute https URLs are accepted: the markup publishes them to Google
 * and the company page links the website. Every change is audit-logged with
 * the previous values, and the company's public pages are revalidated.
 *
 * Deliberately separate from PATCH /api/admin/companies/:id, which is the
 * single writer of recruitmentType and accepts nothing else. This route never
 * writes recruitmentType, isVerified or claimVerifiedAt.
 */
const MAX_URL_LENGTH = 500;

const httpsUrl = z
    .string()
    .trim()
    .max(MAX_URL_LENGTH)
    .refine((value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.hostname.includes('.');
        } catch {
            return false;
        }
    }, 'Must be an absolute https URL');

const profileSchema = z
    .object({
        website: httpsUrl.nullable().optional(),
        logoUrl: httpsUrl.nullable().optional(),
    })
    .strict()
    .refine((body) => body.website !== undefined || body.logoUrl !== undefined, 'Pass website, logoUrl or both');

/** The site origin of a website URL ("https://www.example.org/about" → "https://www.example.org"). */
function toSiteOrigin(url: string): string {
    return new URL(url).origin;
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const { id } = await params;

    let reviewerId: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        reviewerId = user?.id ?? null;
    } catch {
        reviewerId = null;
    }

    let parsed: z.infer<typeof profileSchema>;
    try {
        parsed = profileSchema.parse(await request.json());
    } catch (err) {
        return NextResponse.json(
            {
                success: false,
                error: 'Invalid request. Pass { website?: https URL | null, logoUrl?: https URL | null }.',
                details: err instanceof Error ? err.message : 'unknown',
            },
            { status: 400 },
        );
    }

    try {
        const existing = await prisma.company.findUnique({
            where: { id },
            select: { id: true, name: true, website: true, logoUrl: true },
        });
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });
        }

        const data = {
            ...(parsed.website !== undefined ? { website: parsed.website === null ? null : toSiteOrigin(parsed.website) } : {}),
            ...(parsed.logoUrl !== undefined ? { logoUrl: parsed.logoUrl } : {}),
        };
        const company = await prisma.company.update({
            where: { id },
            data,
            select: companySelect(),
        });

        await logAudit({
            action: 'company.web_identity.update',
            actorType: 'admin',
            actorId: reviewerId,
            targetType: 'company',
            targetId: existing.id,
            metadata: {
                companyName: existing.name,
                previousWebsite: existing.website,
                previousLogoUrl: existing.logoUrl,
                ...data,
            },
        });

        await revalidateCompanySurfaces(existing.id, 'Admin Companies profile');

        return NextResponse.json({ success: true, company });
    } catch (error) {
        logger.error('[Admin Companies] profile PATCH error', error, { id });
        return NextResponse.json({ success: false, error: 'Failed to update company' }, { status: 500 });
    }
}
