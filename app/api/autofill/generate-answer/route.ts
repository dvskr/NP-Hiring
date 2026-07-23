import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { mintResumeReadUrl, extractRequestContext } from '@/lib/resume-storage';
import { complete } from '@/lib/ai/gateway';
import { AiGatewayError } from '@/lib/ai/types';
import { z } from 'zod';
import { checkAutofillAiQuota, quotaExceededResponse } from '../_lib/quota';
import { checkAutofillAiFeature, aiGatewayErrorResponse } from '../_lib/guard';
import { fetchResumeTextFromSignedUrl } from '../_lib/resume-text';

// ─── Request validation (audit B96) ───
//
// Every field below lands in the LLM prompt, so unvalidated input was both
// a prompt-bloat cost vector (unbounded questionText/jobDescription) and a
// correctness bug (non-string questionText threw on .toLowerCase → 500;
// absurd maxLength values steered the "approximately N characters" prompt
// instruction). maxLength is clamped server-side — malformed values degrade
// to the 300-char default instead of failing the fill.
export const generateAnswerRequestSchema = z.object({
    questionText: z.string().trim().min(1, 'questionText is required').max(2_000),
    questionKey: z.string().max(200).optional().nullable().catch(null),
    jobTitle: z.string().max(300).catch(''),
    jobDescription: z.string().max(20_000).catch(''),
    employerName: z.string().max(300).catch(''),
    maxLength: z.coerce.number().int().min(20).max(1_500).catch(300),
}).transform((v) => ({
    ...v,
    questionKey: v.questionKey ?? '',
    jobTitle: v.jobTitle ?? '',
    jobDescription: v.jobDescription ?? '',
    employerName: v.employerName ?? '',
}));


export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-answer', RATE_LIMITS.autofill);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Kill switch (audit F31).
        const disabled = await checkAutofillAiFeature('ai.candidate.autofill_answer', user.userId);
        if (disabled) return disabled;

        const body = await req.json().catch(() => null);
        const parsedBody = generateAnswerRequestSchema.safeParse(body ?? {});
        if (!parsedBody.success) {
            return NextResponse.json(
                { error: parsedBody.error.issues[0]?.message || 'Invalid request body' },
                { status: 400 }
            );
        }
        const { questionText, questionKey, jobTitle, jobDescription, employerName, maxLength } = parsedBody.data;

        // Check if we have a stored open-ended response that matches
        const storedResponses = await prisma.candidateOpenEndedResponse.findMany({
            where: { userId: user.userId },
        });

        const matchingStored = storedResponses.find(
            (r) =>
                (questionKey !== '' && r.questionKey === questionKey) ||
                r.questionText.toLowerCase().includes(questionText.toLowerCase().substring(0, 30))
        );

        if (matchingStored?.response) {
            return NextResponse.json({
                answer: matchingStored.response,
                questionKey: questionKey || matchingStored.questionKey,
                model: 'stored',
                basedOnStoredResponse: true,
            });
        }

        // Monthly AI-generation quota (audit F29) — the shared SUM-based
        // helper (replaces the old row-count check that disagreed with the
        // usage display). Checked AFTER the stored-response path so capped
        // users still get their saved answers for free.
        const quota = await checkAutofillAiQuota(user.userId, 1);
        if (!quota.allowed) return quotaExceededResponse(quota);

        // Fetch candidate profile for context
        const candidateProfile = await prisma.userProfile.findUnique({
            where: { id: user.userId },
            include: {
                licenses: true,
                certificationRecords: true,
                education: { orderBy: { graduationDate: 'desc' } },
                workExperience: { orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }], take: 3 },
            },
        });

        // Build AI prompt with resume context. resumeUrl is a bare storage path,
        // so mint a signed URL before fetching (fetching the path directly threw
        // and returned '' — the answer was generated without the resume).
        const profileContext = buildProfileContext(candidateProfile);
        let resumeText = '';
        if (candidateProfile?.resumeUrl) {
            const signedUrl = await mintResumeReadUrl(candidateProfile.resumeUrl, {
                actorId: candidateProfile.supabaseId,
                ownerId: candidateProfile.supabaseId,
                audience: 'extension',
                action: 'view',
                ...extractRequestContext(req),
                reason: 'chrome autofill — generate-answer',
            });
            if (signedUrl) resumeText = await fetchResumeTextFromSignedUrl(signedUrl);
        }
        const prompt = buildPrompt(questionText, jobTitle, jobDescription, employerName, profileContext, resumeText, maxLength);

        // Routed through the LLM gateway (audit F28/V4): registered
        // autofill_answer task (gpt-5-mini primary, claude-sonnet-4-6
        // fallback) with timeout, circuit breaker, and ai_call_log cost
        // tracking — replaces the raw gpt-4o fetch (a model the
        // architecture doc deprecates and the pricing registry omits).
        let answer = '';
        let modelUsed = 'unknown';
        try {
            const response = await complete({
                task: 'autofill_answer',
                tenant: { type: 'candidate', id: user.userId },
                promptId: 'autofill_answer',
                promptVersion: 'v2',
                messages: [
                    { role: 'system', content: systemPrompt() },
                    { role: 'user', content: prompt },
                ],
            });
            answer = response.content.trim();
            modelUsed = response.model;
        } catch (err) {
            if (err instanceof AiGatewayError) {
                console.error('AI answer gateway error:', err.code);
                return aiGatewayErrorResponse(err, 'AI generation');
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
            answer,
            questionKey: questionKey || '',
            model: modelUsed,
            basedOnStoredResponse: false,
        });
    } catch (error) {
        console.error('AI Generation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProfileContext(profile: any): string {
    if (!profile) return 'No profile data available.';

    const parts: string[] = [];

    if (profile.firstName || profile.lastName) {
        parts.push(`Name: ${profile.firstName || ''} ${profile.lastName || ''}`.trim());
    }

    if (profile.licenses?.length > 0) {
        const licenseInfo = profile.licenses
            .map((l: { licenseType: string; licenseState: string }) => `${l.licenseType} (${l.licenseState})`)
            .join(', ');
        parts.push(`Licenses: ${licenseInfo}`);
    }

    if (profile.certificationRecords?.length > 0) {
        const certInfo = profile.certificationRecords
            .map((c: { certificationName: string }) => c.certificationName)
            .join(', ');
        parts.push(`Certifications: ${certInfo}`);
    }

    if (profile.education?.length > 0) {
        const eduInfo = profile.education
            .map((e: { degreeType: string; schoolName: string }) => `${e.degreeType} from ${e.schoolName}`)
            .join('; ');
        parts.push(`Education: ${eduInfo}`);
    }

    if (profile.workExperience?.length > 0) {
        const workInfo = profile.workExperience
            .map((w: { jobTitle: string; employerName: string; isCurrent: boolean }) =>
                `${w.jobTitle} at ${w.employerName}${w.isCurrent ? ' (current)' : ''}`)
            .join('; ');
        parts.push(`Experience: ${workInfo}`);
    }

    return parts.join('\n');
}

function systemPrompt(): string {
    return `You are an expert career coach and professional writer specializing in Nurse Practitioner (NP) and APRN job applications across all specialties.

Your task is to generate professional, compelling responses to job application questions. 

Guidelines:
- Write in first person as the candidate
- Be specific and use clinical terminology appropriate for the candidate's NP/APRN specialty
- Reference the candidate's actual credentials and experience when provided
- Keep responses concise and within the requested length
- Be professional but personable
- Avoid generic filler language
- Tailor each response to the specific employer and position when context is available`;
}

function buildPrompt(
    questionText: string,
    jobTitle: string,
    jobDescription: string,
    employerName: string,
    profileContext: string,
    resumeText: string,
    maxLength: number
): string {
    let prompt = `Generate a professional response for this job application question.\n\n`;
    prompt += `**Question:** ${questionText}\n\n`;

    if (jobTitle) prompt += `**Position:** ${jobTitle}\n`;
    if (employerName) prompt += `**Employer:** ${employerName}\n`;
    if (jobDescription) prompt += `**Job Description (excerpt):** ${jobDescription.substring(0, 1000)}\n\n`;

    prompt += `**Candidate Profile:**\n${profileContext}\n\n`;

    if (resumeText) {
        prompt += `**Full Resume Content:**\n${resumeText}\n\n`;
    }

    prompt += `**Requirements:** Write a response of approximately ${maxLength} characters. Be specific, professional, and tailored to this role. Reference actual credentials, experience, and skills from the candidate's resume when relevant.`;

    return prompt;
}

// Resume text extraction moved to ../_lib/resume-text.ts (audit B89): the
// old inline extractor called pdf-parse's removed v1 function API, threw on
// every invocation, and silently generated answers without resume context.
