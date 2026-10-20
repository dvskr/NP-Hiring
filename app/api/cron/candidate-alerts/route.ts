import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendNewCandidateAlertEmail } from '@/lib/email-service';
import { logger } from '@/lib/logger';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { getEmployerActivePostings } from '@/lib/tier-limits';
import { SPECIALTY_PRESETS, LICENSE_STATE_OPTIONS } from '@/config/niche/credentials';
import { brand } from '@/config/brand';

export const maxDuration = 120; // 2 minutes — email sends to multiple employers

// SECURITY (CRON-1): the digest picked new job seekers with only role and
// profileVisible, so a candidate who had switched "Open to offers" off was
// still emailed to employers, although every employer-facing candidate
// route hides them. This is the pool rule of GET /api/employer/candidates,
// plus the deleted check.
// Test: tests/api/cron-candidate-alerts-pool.test.ts
const LIVE_POOL_WHERE: Prisma.UserProfileWhereInput = {
    role: 'job_seeker',
    profileVisible: true,
    openToOffers: true,
    deletedAt: null,
};

// SECURITY (EMP-ALERT-1): stored lists get the caps POST
// /api/employer/candidate-alerts now enforces, because rows saved before
// that check can hold tens of thousands of entries, one query branch each.
// Empty entries are dropped: an empty `contains` matches every candidate.
// Test: tests/api/cron-candidate-alerts-pool.test.ts
const MAX_ALERT_SPECIALTIES = SPECIALTY_PRESETS.length * 2;
const MAX_ALERT_STATES = LICENSE_STATE_OPTIONS.length;

function splitAlertList(value: string | null, cap: number): string[] {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean).slice(0, cap);
}

// SECURITY (CRON-1): the list route serves only employers and admins, so an
// alert whose owner has since lost that role, or deleted the account, is
// skipped.
function loadActiveAlerts() {
    return prisma.employerCandidateAlert.findMany({
        where: {
            isActive: true,
            employer: { role: { in: ['employer', 'admin'] }, deletedAt: null },
        },
        include: {
            employer: {
                select: {
                    id: true,
                    supabaseId: true,
                    role: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    company: true,
                },
            },
        },
    });
}

type ActiveAlert = Awaited<ReturnType<typeof loadActiveAlerts>>[number];

function buildCandidateWhere(
    alert: Pick<ActiveAlert, 'specialties' | 'states' | 'minExperience' | 'workMode'>,
    since: Date,
): Prisma.UserProfileWhereInput {
    const specialtyMatch = splitAlertList(alert.specialties, MAX_ALERT_SPECIALTIES)
        .map(s => ({ specialties: { contains: s, mode: 'insensitive' as const } }));
    const stateMatch = splitAlertList(alert.states, MAX_ALERT_STATES)
        .map(s => ({ licenseStates: { contains: s, mode: 'insensitive' as const } }));
    // A candidate must match at least one listed specialty and at least one
    // listed state; a list left empty does not filter.
    const listFilters = [specialtyMatch, stateMatch].filter(group => group.length > 0);

    return {
        createdAt: { gt: since },
        ...(listFilters.length > 0 ? { AND: listFilters.map(group => ({ OR: group })) } : {}),
        ...(typeof alert.minExperience === 'number' ? { yearsExperience: { gte: alert.minExperience } } : {}),
        ...(alert.workMode ? { preferredWorkMode: { equals: alert.workMode, mode: 'insensitive' as const } } : {}),
        // Spread last, so no alert filter can override the pool rule.
        ...LIVE_POOL_WHERE,
    };
}

// SECURITY (CRON-1): licensed states are unlock-eligible metadata. The list
// route returns them only to an admin or to an employer with an active
// posting, so the digest does the same. EmployerJob.userId holds the
// Supabase id, so the posting check takes supabaseId, not the profile id.
async function canSeeLicenseStates(owner: ActiveAlert['employer']): Promise<boolean> {
    if (owner.role === 'admin') return true;
    return (await getEmployerActivePostings(owner.supabaseId)).length > 0;
}

/** Sends one alert's digest. True when an email went out; throws when a query fails. */
async function sendAlertDigest(alert: ActiveAlert): Promise<boolean> {
    if (!alert.employer.email) return false;

    // Find new candidates since last notification (or last 24 hours)
    const since = alert.lastSentAt || new Date(Date.now() - 24 * 60 * 60 * 1000);

    const matchingCandidates = await prisma.userProfile.findMany({
        where: buildCandidateWhere(alert, since),
        select: {
            supabaseId: true,
            firstName: true,
            lastName: true,
            headline: true,
            specialties: true,
            licenseStates: true,
            yearsExperience: true,
        },
        take: 10, // Max 10 per digest
    });

    if (matchingCandidates.length === 0) return false;

    const employerName = alert.employer.company || [alert.employer.firstName, alert.employer.lastName].filter(Boolean).join(' ') || 'Employer';
    const showLicenseStates = await canSeeLicenseStates(alert.employer);

    const digest = matchingCandidates.map(c => ({
        name: [c.firstName, c.lastName?.[0] ? c.lastName[0] + '.' : null].filter(Boolean).join(' ') || `${brand.niche.short} Candidate`,
        headline: c.headline,
        profileUrl: `${brand.baseUrl}/employer/candidates/${c.supabaseId}`,
        specialties: c.specialties ? c.specialties.split(',').map(s => s.trim()) : [],
        states: showLicenseStates && c.licenseStates ? c.licenseStates.split(',').map(s => s.trim()) : [],
        experience: c.yearsExperience,
    }));

    const result = await sendNewCandidateAlertEmail(alert.employer.email, employerName, digest);
    if (!result.success) return false;

    await prisma.employerCandidateAlert.update({
        where: { id: alert.id },
        data: { lastSentAt: new Date() },
    });
    return true;
}

interface AlertFailure {
    alertId: string;
    error: unknown;
}

function summarizeFailures(failures: AlertFailure[], total: number): Error {
    const ids = failures.slice(0, 10).map(f => f.alertId).join(', ');
    const first = failures[0].error;
    const firstMessage = first instanceof Error ? first.message : String(first);
    return new Error(`${failures.length} of ${total} candidate alerts failed (${ids}). First error: ${firstMessage}`);
}

/**
 * GET /api/cron/candidate-alerts
 * Matches new candidates against employer alert preferences and sends digest emails.
 * Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
    // Auth: verify cron secret
    const authError = await verifyCronOrAdmin(req);
    if (authError) return authError;

    try {
        return await withCronTracking('candidate-alerts', async () => {
        // Get all active alerts
        const alerts = await loadActiveAlerts();

        if (alerts.length === 0) {
            return {
                response: NextResponse.json({ message: 'No active alerts', sent: 0 }),
                metrics: { alertsProcessed: 0, emailsSent: 0 },
            };
        }

        let totalSent = 0;
        const failures: AlertFailure[] = [];

        for (const alert of alerts) {
            // SECURITY (EMP-ALERT-1): one bad row used to throw out of this
            // loop and stop the run for every alert after it. Each alert now
            // fails alone: logged with its id, counted, and reported once below.
            try {
                if (await sendAlertDigest(alert)) totalSent++;
            } catch (error) {
                failures.push({ alertId: alert.id, error });
                logger.error('Candidate alert failed', error, { alertId: alert.id });
            }
        }

        if (failures.length > 0) {
            await sendCronFailureAlert('candidate-alerts', summarizeFailures(failures, alerts.length), {
                failed: failures.length,
                total: alerts.length,
            });
        }

        logger.info('Candidate alert cron complete', { alertsProcessed: alerts.length, emailsSent: totalSent, alertsFailed: failures.length });
        return {
            response: NextResponse.json({ message: 'Candidate alerts processed', sent: totalSent, failed: failures.length, total: alerts.length }),
            metrics: { alertsProcessed: alerts.length, emailsSent: totalSent, alertsFailed: failures.length },
        };
        });
    } catch (error) {
        await sendCronFailureAlert('candidate-alerts', error);
        logger.error('Candidate alert cron failed', error);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
