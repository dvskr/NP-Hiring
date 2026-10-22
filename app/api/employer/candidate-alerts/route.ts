import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    MAX_ALERT_SPECIALTIES,
    MAX_ALERT_STATES,
    joinAlertList,
    splitAlertList,
} from '@/lib/candidate-alert-filters';

// SECURITY (EMP-ALERT-1): the POST body used to be stored as it arrived. A
// 70,000 entry specialties array was saved as one comma string, and the
// daily candidate-alerts cron turned each entry into its own query branch,
// past the Postgres bind limit, which aborted the run for every alert
// after it; a list that was not an array answered 500. Each list is now
// capped (lib/candidate-alert-filters.ts, shared with the cron), and an
// entry may not hold the comma the stored string is split on.
// Test: tests/api/employer-candidate-alerts-body.test.ts
const MAX_SPECIALTY_LENGTH = 60;
const MAX_EXPERIENCE_YEARS = 60;
const MAX_WORK_MODE_LENGTH = 30;

const alertBodySchema = z.object({
    specialties: z
        .array(z.string().trim().min(1).max(MAX_SPECIALTY_LENGTH).regex(/^[^,]+$/))
        .max(MAX_ALERT_SPECIALTIES)
        .optional(),
    states: z
        .array(z.string().trim().regex(/^[A-Za-z]{2}$/).transform(s => s.toUpperCase()))
        .max(MAX_ALERT_STATES)
        .optional(),
    minExperience: z.number().int().min(0).max(MAX_EXPERIENCE_YEARS).nullable().optional(),
    workMode: z.string().trim().max(MAX_WORK_MODE_LENGTH).nullable().optional(),
    isActive: z.boolean().optional(),
});

/**
 * GET /api/employer/candidate-alerts
 * Fetch alert preferences for the authenticated employer.
 */
export async function GET() {
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

    const alert = await prisma.employerCandidateAlert.findFirst({
        where: { employerId: profile.id },
    });

    // The settings page posts this object back as it is, so the lists must
    // pass the POST schema: a row such as "TX,", or one stored over the caps
    // before they existed, would otherwise block saves. The caps also cut
    // each list to the entries the digest uses.
    return NextResponse.json({
        alert: alert ? {
            id: alert.id,
            specialties: splitAlertList(alert.specialties, MAX_ALERT_SPECIALTIES),
            states: splitAlertList(alert.states, MAX_ALERT_STATES),
            minExperience: alert.minExperience,
            workMode: alert.workMode,
            isActive: alert.isActive,
        } : null,
    });
}

/**
 * POST /api/employer/candidate-alerts
 * Create or update alert preferences.
 * Body: { specialties?: string[], states?: string[], minExperience?: number | null, workMode?: string | null, isActive?: boolean }
 * validated by alertBodySchema above; anything else answers 400.
 */
export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'emp-alerts', RATE_LIMITS.employer);
    if (rateLimitResult) return rateLimitResult;

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

    // SECURITY (EMP-ALERT-1): parse before anything is stored; malformed JSON
    // and a body outside the schema answer 400 instead of 500.
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = alertBodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid alert preferences', details: parsed.error.issues },
            { status: 400 },
        );
    }
    const { specialties, states, minExperience, workMode, isActive } = parsed.data;

    const data = {
        specialties: joinAlertList(specialties),
        states: joinAlertList(states),
        minExperience: minExperience ?? null,
        workMode: workMode || null,
        isActive: isActive ?? true,
    };

    // Upsert: find existing or create new
    const existing = await prisma.employerCandidateAlert.findFirst({
        where: { employerId: profile.id },
    });

    if (existing) {
        await prisma.employerCandidateAlert.update({
            where: { id: existing.id },
            data,
        });
    } else {
        await prisma.employerCandidateAlert.create({
            data: {
                employerId: profile.id,
                ...data,
            },
        });
    }

    return NextResponse.json({ success: true });
}

/**
 * DELETE /api/employer/candidate-alerts
 * Disable alerts for this employer.
 */
export async function DELETE() {
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

    await prisma.employerCandidateAlert.updateMany({
        where: { employerId: profile.id },
        data: { isActive: false },
    });

    return NextResponse.json({ success: true });
}
