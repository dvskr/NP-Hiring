import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { complete, AiGatewayError } from '@/lib/ai/gateway';
import { loadPrompt } from '@/lib/ai/prompts/registry';

// ═══════════════════════════════════════════════════════════════
// AI Candidate Scorer — Matches candidates to job requirements
// Routes through lib/ai/gateway for cost tracking, caching, fallback.
// Prompt lives in lib/ai/prompts/candidate_scoring/v1.json (Sprint 0.2 registry).
// ═══════════════════════════════════════════════════════════════

// Permissive schema — model output can be off-spec, gateway-side Zod parsing
// catches it; we then clamp/sanitize before persisting.
const scoringResultSchema = z.object({
    score: z.number().optional(),
    matchReasons: z.array(z.unknown()).optional(),
    missingItems: z.array(z.unknown()).optional(),
});

export interface NormalizedScoringResult {
    /** null = model output was off-spec — persist as UNSCORED, never 0% (audit B95). */
    score: number | null;
    matchReasons: string[];
    missingItems: string[];
}

/**
 * Clamp/sanitize the parsed model output before persisting.
 *
 * Audit B95: an off-spec response (missing/NaN score) used to collapse to a
 * literal 0% match score, which employers sorting by "AI Score" read as
 * "terrible candidate" when the truth is "scoring failed". Off-spec now
 * normalizes to score=null so the application renders as unscored (the
 * applicants UI already hides the badge for null).
 */
export function normalizeScoringResult(parsed: z.infer<typeof scoringResultSchema>): NormalizedScoringResult {
    const score = typeof parsed.score === 'number' && Number.isFinite(parsed.score)
        ? Math.max(0, Math.min(100, Math.round(parsed.score)))
        : null;
    const matchReasons = Array.isArray(parsed.matchReasons)
        ? parsed.matchReasons.filter((r): r is string => typeof r === 'string').slice(0, 6)
        : [];
    const missingItems = Array.isArray(parsed.missingItems)
        ? parsed.missingItems.filter((r): r is string => typeof r === 'string').slice(0, 4)
        : [];
    return { score, matchReasons, missingItems };
}

interface JobApplicationForScoring {
    screeningAnswers: unknown;
    coverLetter: string | null;
}

/**
 * Score a candidate against a job posting.
 * Called asynchronously after application submission.
 */
export async function scoreCandidate(
    applicationId: string,
    jobId: string,
    userId: string,
): Promise<void> {
    try {
        const job = await prisma.job.findUnique({
            where: { id: jobId },
            select: {
                title: true,
                description: true,
                location: true,
                mode: true,
                experienceLevel: true,
                benefits: true,
                setting: true,
                population: true,
                state: true,
            },
        });
        if (!job) {
            logger.warn('scoreCandidate: Job not found', { jobId });
            return;
        }

        const candidate = await prisma.userProfile.findUnique({
            where: { supabaseId: userId },
            select: {
                firstName: true,
                lastName: true,
                headline: true,
                yearsExperience: true,
                certifications: true,
                licenseStates: true,
                specialties: true,
                skills: true,
                bio: true,
                npiNumber: true,
                deaNumber: true,
                education: { orderBy: { graduationDate: 'desc' }, take: 5 },
                workExperience: { orderBy: { startDate: 'desc' }, take: 5 },
                certificationRecords: { take: 10 },
                licenses: { take: 10 },
            },
        });
        if (!candidate) {
            logger.warn('scoreCandidate: Candidate not found', { userId });
            return;
        }

        const application = await prisma.jobApplication.findUnique({
            where: { id: applicationId },
            select: { screeningAnswers: true, coverLetter: true },
        });

        const candidateSummary = buildCandidateSummary(candidate, application);
        const jobSummary = buildJobSummary(job);
        const prompt = await loadPrompt('candidate_scoring');

        const result = await complete({
            task: 'candidate_scoring',
            tenant: { type: 'candidate', id: userId },
            messages: prompt.render({ jobSummary, candidateSummary }),
            promptId: prompt.id,
            promptVersion: prompt.version,
            // Cache key includes prompt version so a prompt rollout invalidates
            // every cached score for that pair automatically.
            cacheKey: ['scoring', prompt.version, jobId, userId],
            outputSchema: scoringResultSchema,
        });

        const parsed = result.parsed ?? {};
        const { score, matchReasons, missingItems } = normalizeScoringResult(parsed);

        if (score === null) {
            // Off-spec model output (audit B95): persist as UNSCORED rather
            // than a fake 0% that would sink the candidate in the employer's
            // AI-Score sort. Leave aiMatchScore null; don't persist reasons
            // derived from an output we couldn't trust the score of.
            logger.warn('scoreCandidate: off-spec model output — leaving application unscored', {
                applicationId,
                jobId,
                promptVersion: prompt.version,
            });
            return;
        }

        await prisma.jobApplication.update({
            where: { id: applicationId },
            data: {
                aiMatchScore: score,
                aiMatchReasons: matchReasons,
                aiMissingItems: missingItems,
            },
        });

        logger.info('AI scoring complete', {
            applicationId,
            score,
            cacheHit: result.cacheHit,
            fallbackUsed: result.fallbackUsed,
            costUsd: result.usage.costUsd,
        });
    } catch (err) {
        if (err instanceof AiGatewayError) {
            logger.error('scoreCandidate: gateway error', err, { applicationId, jobId, code: err.code });
        } else {
            logger.error('scoreCandidate failed', err);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCandidateSummary(candidate: any, application: JobApplicationForScoring | null): string {
    const parts: string[] = [];

    if (candidate.headline) parts.push(`Headline: ${candidate.headline}`);
    if (candidate.yearsExperience) parts.push(`Years of Experience: ${candidate.yearsExperience}`);
    if (candidate.certifications) parts.push(`Certifications: ${candidate.certifications}`);
    if (candidate.licenseStates) parts.push(`Licensed States: ${candidate.licenseStates}`);
    if (candidate.specialties) parts.push(`Specialties: ${candidate.specialties}`);
    if (candidate.skills?.length) parts.push(`Skills: ${candidate.skills.join(', ')}`);
    if (candidate.npiNumber) parts.push('Has NPI Number: Yes');
    if (candidate.deaNumber) parts.push('Has DEA Number: Yes');
    if (candidate.bio) parts.push(`Bio: ${candidate.bio.slice(0, 300)}`);

    if (candidate.education?.length > 0) {
        parts.push('Education:');
        for (const edu of candidate.education) {
            parts.push(`  - ${edu.degreeType} in ${edu.fieldOfStudy || 'N/A'} from ${edu.schoolName}`);
        }
    }

    if (candidate.workExperience?.length > 0) {
        parts.push('Work Experience:');
        for (const exp of candidate.workExperience) {
            const dates = `${exp.startDate ? new Date(exp.startDate).getFullYear() : '?'} - ${exp.isCurrent ? 'Present' : exp.endDate ? new Date(exp.endDate).getFullYear() : '?'}`;
            parts.push(`  - ${exp.jobTitle} at ${exp.employerName} (${dates})`);
        }
    }

    if (candidate.certificationRecords?.length > 0) {
        parts.push('Detailed Certifications:');
        for (const cert of candidate.certificationRecords) {
            parts.push(`  - ${cert.certificationName}${cert.certifyingBody ? ` (${cert.certifyingBody})` : ''}`);
        }
    }

    if (candidate.licenses?.length > 0) {
        parts.push('Licenses:');
        for (const lic of candidate.licenses) {
            parts.push(`  - ${lic.licenseType} in ${lic.licenseState} (${lic.status})`);
        }
    }

    if (application?.screeningAnswers) {
        try {
            const answers = typeof application.screeningAnswers === 'string'
                ? JSON.parse(application.screeningAnswers)
                : application.screeningAnswers;
            if (Array.isArray(answers) && answers.length > 0) {
                parts.push('Screening Answers:');
                for (const a of answers) {
                    parts.push(`  Q: ${a.questionText} → A: ${a.answer}`);
                }
            }
        } catch {
            // ignore malformed screening answers
        }
    }

    if (application?.coverLetter) {
        parts.push(`Cover Letter (excerpt): ${application.coverLetter.slice(0, 300)}`);
    }

    return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildJobSummary(job: any): string {
    const parts: string[] = [];

    parts.push(`Title: ${job.title}`);
    if (job.location) parts.push(`Location: ${job.location}`);
    if (job.mode) parts.push(`Work Mode: ${job.mode}`);
    if (job.experienceLevel) parts.push(`Experience Level: ${job.experienceLevel}`);
    if (job.setting) parts.push(`Clinical Setting: ${job.setting}`);
    if (job.population) parts.push(`Patient Population: ${job.population}`);
    if (job.benefits?.length) parts.push(`Benefits: ${job.benefits.join(', ')}`);
    if (job.state) parts.push(`State: ${job.state}`);

    if (job.description) {
        parts.push(`Job Description:\n${job.description.slice(0, 2000)}`);
    }

    return parts.join('\n');
}
