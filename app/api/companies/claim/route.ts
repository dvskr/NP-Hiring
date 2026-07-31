/**
 * POST /api/companies/claim
 *
 * An authenticated employer asks to be recognised as the owner of a `Company`
 * profile. This is the claim STEP ONLY — it publishes nothing. The row lands in
 * `company_claims` with status='pending' and stays inert until an admin
 * approves it at /admin/company-claims, which is the only place
 * `Company.claimVerifiedAt` is ever written.
 *
 * Body: { companyId: string, claimantRole?: string, note?: string }
 *
 * WHY companyId AND NOT THE URL SLUG. /companies/[slug] resolves a URL through
 * a two-step quirk (kebab form first, then the legacy space form kept by rows
 * inserted before the normalizer changed — app/companies/[slug]/page.tsx
 * `resolveCompanyNormalizedName`). Re-implementing that resolution here would
 * be a second copy of a rule that already has one edge case, and a claim bound
 * to the wrong Company row is the single worst failure this endpoint has. The
 * profile page has already resolved the row it rendered, so it posts that row's
 * id and the server re-reads every fact it needs from it. Passing an arbitrary
 * companyId grants nothing: submitting a claim is not an authorisation.
 *
 * Layered like the rest of the employer surface:
 *   rate limit → CSRF (defence in depth; middleware.ts enforces it centrally
 *   for every /api/* mutation) → employer session gate → zod → ownership /
 *   duplicate checks → write.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireEmployerApi } from '@/lib/auth/require-employer-api';
import { verifyCsrf } from '@/lib/csrf';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { evaluateClaimDomain } from './domain-signal';

const claimSchema = z.object({
    companyId: z.string().min(1).max(64),
    claimantRole: z.string().trim().max(120).optional().or(z.literal('')),
    note: z.string().trim().max(1000).optional().or(z.literal('')),
});

export async function POST(request: NextRequest) {
    // Claiming is a once-per-employer action; the low cap is an abuse bound,
    // not a throughput constraint.
    const limited = await rateLimit(request, 'company-claim', RATE_LIMITS.feedback);
    if (limited) return limited;

    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await requireEmployerApi();
    if (auth.error) return auth.error;
    const { user } = auth;

    if (!user.email) {
        // The domain signal is the whole point of the submission-time snapshot;
        // a session with no email cannot produce one.
        return NextResponse.json(
            { error: 'Your account has no email address on file. Contact support to claim a profile.' },
            { status: 400 },
        );
    }

    let parsed: z.infer<typeof claimSchema>;
    try {
        parsed = claimSchema.parse(await request.json());
    } catch (err) {
        return NextResponse.json(
            { error: 'Invalid request', details: err instanceof Error ? err.message : 'unknown' },
            { status: 400 },
        );
    }

    try {
        const company = await prisma.company.findUnique({
            where: { id: parsed.companyId },
            select: { id: true, name: true, website: true, claimVerifiedAt: true },
        });

        if (!company) {
            return NextResponse.json({ error: 'Employer profile not found' }, { status: 404 });
        }

        // Already claimed by someone. We do not say by whom — that would leak
        // one employer's account details to another visitor.
        if (company.claimVerifiedAt) {
            return NextResponse.json(
                {
                    error: 'This profile has already been claimed. If that is a mistake, contact support.',
                    code: 'already_claimed',
                },
                { status: 409 },
            );
        }

        const existingOpen = await prisma.companyClaim.findFirst({
            where: {
                companyId: company.id,
                claimantUserId: user.id,
                status: 'pending',
            },
            select: { id: true },
        });
        if (existingOpen) {
            return NextResponse.json(
                {
                    error: 'You already have a claim awaiting review for this employer.',
                    code: 'already_pending',
                },
                { status: 409 },
            );
        }

        // Submission-time evidence for the admin. Advisory only — see
        // ./domain-signal.ts. Neither branch changes what happens next.
        const signal = evaluateClaimDomain(user.email, company.website);
        if (!signal.claimantDomain) {
            return NextResponse.json(
                { error: 'Your account email could not be read. Contact support to claim a profile.' },
                { status: 400 },
            );
        }

        const claim = await prisma.companyClaim.create({
            data: {
                companyId: company.id,
                claimantUserId: user.id,
                claimantEmail: user.email,
                claimantDomain: signal.claimantDomain,
                companyHost: signal.companyHost,
                domainMatch: signal.domainMatch,
                freeEmailDomain: signal.freeEmailDomain,
                claimantRole: parsed.claimantRole ? parsed.claimantRole : null,
                note: parsed.note ? parsed.note : null,
                status: 'pending',
                // Non-null only while pending — this is the half of the unique
                // index that makes a duplicate open claim impossible.
                pendingCompanyId: company.id,
            },
            select: { id: true },
        });

        await logAudit({
            action: 'company.claim.submitted',
            actorType: 'user',
            actorId: user.id,
            targetType: 'company',
            targetId: company.id,
            metadata: {
                claimId: claim.id,
                domainMatch: signal.domainMatch,
                freeEmailDomain: signal.freeEmailDomain,
            },
        });

        logger.info('[Company Claim] submitted', {
            claimId: claim.id,
            companyId: company.id,
            domainMatch: signal.domainMatch,
        });

        // Deliberately no domain-match echo: telling a submitter whether their
        // domain matched turns this endpoint into an oracle for guessing which
        // address makes a claim look legitimate.
        return NextResponse.json({ success: true, status: 'pending' }, { status: 201 });
    } catch (error) {
        // Lost the race against a concurrent duplicate submission — the unique
        // index caught what the read-then-write check above could not.
        // Duck-typed rather than `instanceof PrismaClientKnownRequestError`,
        // matching app/api/webhooks/stripe/route.ts and
        // app/api/employer/messages/route.ts: an `instanceof` check silently
        // stops matching if two copies of the client class are in play.
        if ((error as { code?: string } | null)?.code === 'P2002') {
            return NextResponse.json(
                {
                    error: 'You already have a claim awaiting review for this employer.',
                    code: 'already_pending',
                },
                { status: 409 },
            );
        }
        logger.error('[Company Claim] POST error', error, { companyId: parsed.companyId });
        return NextResponse.json(
            { error: 'Could not submit your claim. Please try again.' },
            { status: 500 },
        );
    }
}
