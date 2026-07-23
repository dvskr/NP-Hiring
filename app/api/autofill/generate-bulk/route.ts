import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { complete } from '@/lib/ai/gateway';
import { AiGatewayError } from '@/lib/ai/types';
import { checkAutofillAiQuota, quotaExceededResponse } from '../_lib/quota';
import { checkAutofillAiFeature, aiGatewayErrorResponse } from '../_lib/guard';

interface BulkQuestion {
    questionText: string;
    questionKey?: string;
    jobTitle?: string;
    employerName?: string;
    jobDescription?: string;
    maxLength?: number;
}

interface BulkResult {
    answer: string;
    questionKey: string;
    model: string;
    basedOnStoredResponse: boolean;
    /** Present when generation failed for THIS question (audit F28 — the
     *  old code silently returned answer:'' with no signal). */
    error?: string;
}

export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-bulk', RATE_LIMITS.autofill);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Kill switch (audit F31).
        const disabled = await checkAutofillAiFeature('ai.candidate.autofill_bulk', user.userId);
        if (disabled) return disabled;

        const body = await req.json();
        const { questions } = body as { questions: BulkQuestion[] };

        if (!Array.isArray(questions) || questions.length === 0) {
            return NextResponse.json({ error: 'questions array is required' }, { status: 400 });
        }

        if (questions.length > 10) {
            return NextResponse.json({ error: 'Maximum 10 questions per bulk request' }, { status: 400 });
        }

        // Check stored responses first
        const storedResponses = await prisma.candidateOpenEndedResponse.findMany({
            where: { userId: user.userId },
        });

        const findStored = (q: BulkQuestion) =>
            storedResponses.find(
                (r) => r.questionKey === q.questionKey ||
                    r.questionText.toLowerCase().includes(q.questionText.toLowerCase().substring(0, 30))
            );

        // Monthly AI-generation quota (audit F29): count how many questions
        // actually need the model (stored answers are free), and check the
        // WHOLE batch against the shared SUM-based cap BEFORE any model call.
        const aiNeeded = questions.filter((q) => !findStored(q)?.response).length;
        if (aiNeeded > 0) {
            const quota = await checkAutofillAiQuota(user.userId, aiNeeded);
            if (!quota.allowed) return quotaExceededResponse(quota);
        }

        // Fetch profile context once
        const profile = await prisma.userProfile.findUnique({
            where: { id: user.userId },
            include: {
                licenses: true,
                certificationRecords: true,
                education: { orderBy: { graduationDate: 'desc' }, take: 2 },
                workExperience: { orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }], take: 3 },
            },
        });

        const profileContext = buildProfileContext(profile);
        const results: BulkResult[] = [];

        for (const q of questions) {
            // Check stored first
            const stored = findStored(q);

            if (stored?.response) {
                results.push({
                    answer: stored.response,
                    questionKey: q.questionKey || stored.questionKey,
                    model: 'stored',
                    basedOnStoredResponse: true,
                });
                continue;
            }

            // Generate via the LLM gateway (audit F28/V4) — registered
            // autofill_answer task instead of the raw 'gpt-5.2' fetch that
            // failed 100% of the time and surfaced as silent empty answers.
            try {
                const prompt = `Generate a professional response for this PMHNP job application question.

**Question:** ${q.questionText}
${q.jobTitle ? `**Position:** ${q.jobTitle}` : ''}
${q.employerName ? `**Employer:** ${q.employerName}` : ''}
${q.jobDescription ? `**Job Context:** ${q.jobDescription.substring(0, 500)}` : ''}

**Candidate:** ${profileContext}

Write approximately ${q.maxLength || 300} characters. Be specific and professional.`;

                const response = await complete({
                    task: 'autofill_answer',
                    tenant: { type: 'candidate', id: user.userId },
                    promptId: 'autofill_bulk',
                    promptVersion: 'v2',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a career coach for PMHNPs. Generate concise, professional job application responses.',
                        },
                        { role: 'user', content: prompt },
                    ],
                });

                results.push({
                    answer: response.content.trim(),
                    questionKey: q.questionKey || '',
                    model: response.model,
                    basedOnStoredResponse: false,
                });
            } catch (err) {
                // Explicit per-question error (audit F28) — never a silent
                // empty answer again.
                const message = err instanceof AiGatewayError
                    ? `AI generation failed (${err.code})`
                    : 'AI generation failed';
                console.error('Bulk generation question failed:', err instanceof AiGatewayError ? err.code : err);
                results.push({
                    answer: '',
                    questionKey: q.questionKey || '',
                    model: '',
                    basedOnStoredResponse: false,
                    error: message,
                });
                // If the gateway rate limiter tripped, every remaining
                // question would fail the same way — bail out with the
                // proper 429 unless we already have partial results to keep.
                if (err instanceof AiGatewayError && err.code === 'rate_limited' && results.length === 1) {
                    return aiGatewayErrorResponse(err, 'Bulk generation');
                }
            }
        }

        // Record bulk usage
        const aiCount = results.filter(r => !r.basedOnStoredResponse && r.answer).length;
        if (aiCount > 0) {
            await prisma.autofillUsage.create({
                data: {
                    userId: user.userId,
                    pageUrl: '',
                    atsName: null,
                    fieldsFilled: 0,
                    aiGenerations: aiCount,
                },
            });
        }

        return NextResponse.json(results);
    } catch (error) {
        console.error('Bulk generation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProfileContext(profile: any): string {
    if (!profile) return 'No profile data available.';
    const parts: string[] = [];
    if (profile.firstName) parts.push(`${profile.firstName} ${profile.lastName || ''}`);
    if (profile.licenses?.length > 0) {
        parts.push(`Licenses: ${profile.licenses.map((l: { licenseType: string; licenseState: string }) => `${l.licenseType} (${l.licenseState})`).join(', ')}`);
    }
    if (profile.certificationRecords?.length > 0) {
        parts.push(`Certifications: ${profile.certificationRecords.map((c: { certificationName: string }) => c.certificationName).join(', ')}`);
    }
    if (profile.workExperience?.length > 0) {
        parts.push(`Experience: ${profile.workExperience.map((w: { jobTitle: string; employerName: string }) => `${w.jobTitle} at ${w.employerName}`).join('; ')}`);
    }
    return parts.join('. ');
}
