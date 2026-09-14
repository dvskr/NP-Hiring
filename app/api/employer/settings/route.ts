import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { buildEmployerJobUpdate, buildProfileUpdate, normalizeHttpUrl, parseEmployerSettings } from './validation';

/**
 * GET /api/employer/settings
 * Fetch employer company info from their EmployerJob records.
 */
export async function GET(req: NextRequest) {
    const rateLimitResponse = await rateLimit(req, 'employer:settings', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { id: true, role: true, firstName: true, lastName: true, email: true, phone: true, company: true },
    });

    if (!profile || !['employer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get latest company info from EmployerJob records
    const latestJob = await prisma.employerJob.findFirst({
        where: {
            OR: [
                { userId: user.id },
                { userId: null, contactEmail: user.email! },
            ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
            employerName: true,
            companyLogoUrl: true,
            companyDescription: true,
            companyWebsite: true,
            contactEmail: true,
        },
    });

    return NextResponse.json({
        profile: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            phone: profile.phone,
            company: profile.company,
        },
        companyInfo: latestJob ? {
            name: latestJob.employerName,
            logoUrl: latestJob.companyLogoUrl,
            description: latestJob.companyDescription,
            // Never echo a stored unsafe scheme back into the settings form.
            website: latestJob.companyWebsite && normalizeHttpUrl(latestJob.companyWebsite) !== undefined
                ? latestJob.companyWebsite
                : null,
            contactEmail: latestJob.contactEmail,
        } : null,
    });
}

/**
 * PATCH /api/employer/settings
 * Update employer profile and company info.
 */
export async function PATCH(req: NextRequest) {
    const rateLimitResponse = await rateLimit(req, 'employer:settings', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { id: true, role: true },
    });

    if (!profile || !['employer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const parsed = parseEmployerSettings(body);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const profileUpdate = buildProfileUpdate(parsed.data);
    const companyUpdate = buildEmployerJobUpdate(parsed.data);

    try {
        if (Object.keys(profileUpdate).length > 0) {
            await prisma.userProfile.update({
                where: { id: profile.id },
                data: profileUpdate,
            });
        }

        // Update company info on all EmployerJob records
        if (Object.keys(companyUpdate).length > 0) {
            await prisma.employerJob.updateMany({
                where: {
                    OR: [
                        { userId: user.id },
                        { userId: null, contactEmail: user.email! },
                    ],
                },
                data: companyUpdate,
            });
        }
    } catch (err) {
        logger.error('Failed to update employer settings', err);
        return NextResponse.json({ error: 'Failed to save settings. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
