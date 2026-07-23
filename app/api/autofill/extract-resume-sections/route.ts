import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { mintResumeReadUrl, extractRequestContext } from '@/lib/resume-storage';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { complete } from '@/lib/ai/gateway';
import { AiGatewayError } from '@/lib/ai/types';
import { checkAutofillAiQuota, quotaExceededResponse } from '../_lib/quota';
import { checkAutofillAiFeature, aiGatewayErrorResponse } from '../_lib/guard';

/**
 * POST /api/autofill/extract-resume-sections
 *
 * Extracts structured education and experience arrays from the user's resume PDF.
 * Used as a fallback when profile data is missing but resume exists.
 */
export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-resume', RATE_LIMITS.autofill);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Kill switch (audit F31).
        const disabled = await checkAutofillAiFeature('ai.candidate.autofill_extract', user.userId);
        if (disabled) return disabled;

        const body = await req.json().catch(() => ({}));
        const { sections = ['education', 'experience'] } = body as { sections?: string[] };

        // Monthly AI-generation quota (audit F29) — checked before any
        // resume fetch / model work.
        const quota = await checkAutofillAiQuota(user.userId, 1);
        if (!quota.allowed) return quotaExceededResponse(quota);

        // Fetch candidate profile to get resume URL
        const candidateProfile = await prisma.userProfile.findUnique({
            where: { id: user.userId },
        });

        if (!candidateProfile?.resumeUrl) {
            return NextResponse.json({ error: 'No resume uploaded', education: [], experience: [] }, { status: 200 });
        }

        // Mint a fresh 15-min signed URL via the centralized helper.
        // It handles both bare-path and legacy-URL stored values, and
        // audit-logs the access (audience='extension').
        const freshResumeUrl = await mintResumeReadUrl(candidateProfile.resumeUrl, {
            actorId: candidateProfile.supabaseId,
            ownerId: candidateProfile.supabaseId,
            audience: 'extension',
            action: 'view',
            ...extractRequestContext(req),
            reason: 'chrome autofill — extract-resume-sections',
        });
        if (!freshResumeUrl) {
            return NextResponse.json({ error: 'Could not access stored resume', education: [], experience: [] }, { status: 200 });
        }

        // Extract resume text
        const resumeText = await extractResumeText(freshResumeUrl);
        if (!resumeText) {
            return NextResponse.json({ error: 'Could not extract text from resume', education: [], experience: [] }, { status: 200 });
        }

        // Extract structured data via the LLM gateway (audit F28/V4) —
        // registered autofill_resume_extract task (gpt-5-mini primary,
        // claude-sonnet-4-6 fallback) with timeout + cost tracking, replacing
        // the raw gpt-4o-mini fetch.
        const prompt = buildExtractionPrompt(resumeText, sections);

        let content = '{}';
        let modelUsed = 'unknown';
        try {
            const response = await complete({
                task: 'autofill_resume_extract',
                tenant: { type: 'candidate', id: user.userId },
                promptId: 'autofill_resume_extract',
                promptVersion: 'v2',
                messages: [
                    { role: 'system', content: systemPrompt() },
                    { role: 'user', content: prompt },
                ],
            });
            content = response.content || '{}';
            modelUsed = response.model;
        } catch (err) {
            if (err instanceof AiGatewayError) {
                console.error('AI extract-sections gateway error:', err.code);
                return aiGatewayErrorResponse(err, 'AI extraction');
            }
            throw err;
        }

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            // NB: do not log the raw content — it is the candidate's parsed
            // resume (PII).
            console.error('Failed to parse AI extraction response (invalid JSON)');
            parsed = {};
        }

        // Record usage
        await prisma.autofillUsage.create({
            data: {
                userId: user.userId,
                pageUrl: '',
                atsName: 'SmartRecruiters',
                fieldsFilled: 0,
                aiGenerations: 1,
            },
        });

        return NextResponse.json({
            education: parsed.education || [],
            experience: parsed.experience || [],
            model: modelUsed,
        });
    } catch (error) {
        console.error('Extract resume sections error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Allowlist of hosts the PDF extractor is permitted to fetch from.
// Today the only legitimate caller passes a Supabase-storage signed URL
// minted by `mintResumeReadUrl`; everything else is refused. This is a
// belt-and-suspenders defense — the upstream is server-controlled, but the
// allowlist means a future bug elsewhere can't turn this endpoint into an
// SSRF proxy.
function isAllowedResumeUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Supabase storage URLs are `<project>.supabase.co` or
    // `<project>.supabase.in` for legacy regions.
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.in');
}

async function extractResumeText(resumeUrl: string): Promise<string> {
    if (!isAllowedResumeUrl(resumeUrl)) {
        // Refuse anything that didn't come out of our signed-URL minter.
        // Logged at warn so abuse attempts are visible without crashing.
        console.warn('[extract-resume] refused non-allowlisted resume URL');
        return '';
    }

    try {
        // Run PDF extraction in a separate Node.js process to avoid Turbopack
        // bundling issues with pdf-parse (DOMMatrix, Canvas polyfills, etc.).
        //
        // SECURITY: use `execFile` with an args array — never `exec` with a
        // composed shell string. `execFile` passes args directly to the
        // child process without spawning a shell, so even if `resumeUrl`
        // contains shell metacharacters they cannot break out of the arg
        // boundary.
        const { execFile } = await import('child_process');
        const scriptPath = `${process.cwd()}/scripts/extract-pdf-text.js`;

        const text = await new Promise<string>((resolve) => {
            execFile(
                process.execPath,
                [scriptPath, resumeUrl],
                {
                    timeout: 30000,
                    maxBuffer: 1024 * 1024,
                    shell: false,
                },
                (error, stdout, stderr) => {
                    if (error) {
                        console.error('[extract-resume] Script error:', stderr || error.message);
                        resolve('');
                        return;
                    }
                    resolve(stdout || '');
                },
            );
        });

        return text;
    } catch (err) {
        console.error('[extract-resume] Resume text extraction failed:', err);
        return '';
    }
}

// ─── Prompts ───

function systemPrompt(): string {
    return `You are an expert data extraction AI for healthcare professional resumes (Nurse Practitioners and APRNs across all specialties: FNP, AGNP, PNP, WHNP, ACNP, PMHNP, CRNA, CNM, CNS).

Your task is to extract STRUCTURED data from resume text and return it as valid JSON.

You MUST be accurate — extract exact school names, degree types, dates, job titles, employer names, etc. from the resume.
Do not make up data. Only return what is actually in the resume.

For dates, use YYYY-MM format (e.g., "2019-05"). If only a year is given, use YYYY-01.
For degree types, use standard abbreviations: MSN, BSN, DNP, PhD, ADN, etc.
If a field is not present in the resume, use null.`;
}

function buildExtractionPrompt(resumeText: string, sections: string[]): string {
    let prompt = `Extract structured data from this resume.\n\n`;
    prompt += `**Resume Content:**\n${resumeText}\n\n`;

    prompt += `Return JSON with these sections:\n\n`;

    if (sections.includes('education')) {
        prompt += `"education": Array of education entries, each with:
- "schoolName": string (exact institution name)
- "degreeType": string (MSN, BSN, DNP, PhD, ADN, etc.)
- "fieldOfStudy": string or null (major/track)
- "graduationDate": string or null (YYYY-MM format)
- "gpa": string or null
- "isHighestDegree": boolean
- "description": string or null (brief description of the program, focus areas, or relevant coursework)

Order by graduation date descending (most recent first).\n\n`;
    }

    if (sections.includes('experience')) {
        prompt += `"experience": Array of work experience entries, each with:
- "jobTitle": string
- "employerName": string
- "employerCity": string or null
- "employerState": string or null (2-letter abbreviation)
- "startDate": string (YYYY-MM format)
- "endDate": string or null (YYYY-MM format, null if current)
- "isCurrent": boolean
- "description": string or null (brief description of role)

Order by start date descending (most recent first).\n\n`;
    }

    prompt += `Respond with valid JSON containing the requested arrays. Extract ALL entries found, not just the first one.`;

    return prompt;
}
