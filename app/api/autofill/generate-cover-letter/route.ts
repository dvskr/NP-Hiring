import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { complete } from '@/lib/ai/gateway';
import { AiGatewayError } from '@/lib/ai/types';
import { checkAutofillAiQuota, quotaExceededResponse } from '../_lib/quota';
import { checkAutofillAiFeature, aiGatewayErrorResponse } from '../_lib/guard';

export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-cover', RATE_LIMITS.autofill);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Kill switch (audit F31) — 'ai.candidate.cover_letter' finally gates
        // the route it was registered for.
        const disabled = await checkAutofillAiFeature('ai.candidate.cover_letter', user.userId);
        if (disabled) return disabled;

        const body = await req.json();
        const { jobTitle, employerName, jobDescription } = body;

        if (!jobTitle || !employerName) {
            return NextResponse.json({ error: 'jobTitle and employerName are required' }, { status: 400 });
        }

        // Paid-only rule (audit F29 / docs/ai-architecture.md: 'Cover letter
        // generation = paid only') plus the shared monthly quota, both
        // enforced BEFORE the model call.
        const quota = await checkAutofillAiQuota(user.userId, 1);
        if (quota.tier === 'free') {
            return NextResponse.json(
                {
                    error: 'Cover letter generation requires a paid plan. Upgrade to Pro or Premium to unlock it.',
                    code: 'paid_plan_required',
                    tier: quota.tier,
                },
                { status: 403 },
            );
        }
        if (!quota.allowed) return quotaExceededResponse(quota);

        // Fetch candidate profile for context
        const profile = await prisma.userProfile.findUnique({
            where: { id: user.userId },
            include: {
                licenses: true,
                certificationRecords: true,
                education: { orderBy: { graduationDate: 'desc' }, take: 2 },
                workExperience: { orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }], take: 3 },
            },
        });

        const candidateName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
        // License/certification NUMBERS are intentionally absent (audit V5) —
        // type, state, and name are all a cover letter needs.
        const credentials = profile?.licenses?.map(l => `${l.licenseType} (${l.licenseState})`).join(', ') || '';
        const certs = profile?.certificationRecords?.map(c => c.certificationName).join(', ') || '';
        const experience = profile?.workExperience?.map(w =>
            `${w.jobTitle} at ${w.employerName}${w.isCurrent ? ' (current)' : ''}`
        ).join('; ') || '';
        const education = profile?.education?.map(e => `${e.degreeType} from ${e.schoolName}`).join('; ') || '';

        const prompt = `Write a professional cover letter for a PMHNP job application.

**Candidate:** ${candidateName}
**Licenses:** ${credentials}
**Certifications:** ${certs}
**Experience:** ${experience}
**Education:** ${education}

**Position:** ${jobTitle}
**Employer:** ${employerName}
${jobDescription ? `**Job Description (excerpt):** ${jobDescription.substring(0, 1500)}` : ''}

Write a compelling, professional cover letter (3-4 paragraphs). Use first person. Reference specific credentials and experience. Tailor to the employer and position. Do not use placeholder brackets.`;

        // Routed through the LLM gateway (audit F28/V4) via the existing
        // cover_letter task (gpt-5.4 primary, claude-opus-4-7 fallback) —
        // replaces the raw fetch that pinned the invalid 'gpt-5.2' +
        // temperature 0.7 combo and 502'd on every request.
        let coverLetter = '';
        let modelUsed = 'unknown';
        try {
            const response = await complete({
                task: 'cover_letter',
                tenant: { type: 'candidate', id: user.userId },
                promptId: 'autofill_cover_letter',
                promptVersion: 'v2',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional career coach specializing in Nurse Practitioner (NP) and APRN career services across all specialties. Write polished, compelling cover letters.',
                    },
                    { role: 'user', content: prompt },
                ],
            });
            coverLetter = response.content.trim();
            modelUsed = response.model;
        } catch (err) {
            if (err instanceof AiGatewayError) {
                console.error('Cover letter gateway error:', err.code);
                return aiGatewayErrorResponse(err, 'Cover letter generation');
            }
            throw err;
        }

        // Record usage
        await prisma.autofillUsage.create({
            data: {
                userId: user.userId,
                pageUrl: '',
                atsName: null,
                fieldsFilled: 0,
                aiGenerations: 1,
            },
        });

        return NextResponse.json({
            coverLetter,
            model: modelUsed,
        });
    } catch (error) {
        console.error('Cover letter generation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
