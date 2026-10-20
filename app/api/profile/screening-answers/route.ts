import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/sanitize'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface ScreeningQuestion {
    questionText: string
    answerType: 'boolean' | 'boolean_with_details' | 'text'
    category: 'Background' | 'Logistics'
}

// SECURITY (SCR-1): the PUT stored questionKey, questionText, answerType and
// category exactly as sent, one upsert per element with no cap, so one
// request could write thousands of rows to a profile and hold a pooled
// connection for the whole function lifetime. Keys are now held to the
// questions the settings page asks (QUESTIONS in
// components/settings/ScreeningAnswersSection.tsx, same order; the extension
// reads answers by these keys through /api/profile/export), and the stored
// text, type and category come from here, never from the body.
// tests/api/screening-answers-put.test.ts fails if the two lists drift.
const SCREENING_QUESTIONS: Readonly<Record<string, ScreeningQuestion>> = {
    felony_conviction: { questionText: 'Have you ever been convicted of a felony?', answerType: 'boolean_with_details', category: 'Background' },
    license_revoked: { questionText: 'Have you ever had a professional license revoked, suspended, or restricted?', answerType: 'boolean_with_details', category: 'Background' },
    malpractice_lawsuit: { questionText: 'Have you ever been named in a malpractice lawsuit?', answerType: 'boolean_with_details', category: 'Background' },
    board_disciplinary: { questionText: 'Have you ever been subject to disciplinary action by any licensing board?', answerType: 'boolean_with_details', category: 'Background' },
    consent_background_check: { questionText: 'Do you consent to a background check?', answerType: 'boolean', category: 'Background' },
    consent_drug_screen: { questionText: 'Do you consent to a drug screen?', answerType: 'boolean', category: 'Background' },
    telehealth_comfortable: { questionText: 'Are you comfortable providing care via telehealth?', answerType: 'boolean', category: 'Logistics' },
    willing_to_relocate: { questionText: 'Are you willing to relocate?', answerType: 'boolean', category: 'Logistics' },
    currently_employed: { questionText: 'Are you currently employed?', answerType: 'boolean', category: 'Logistics' },
    notice_period: { questionText: 'Notice period required at your current job', answerType: 'text', category: 'Logistics' },
}
const QUESTION_KEYS = Object.keys(SCREENING_QUESTIONS)
const ANSWER_TEXT_MAX = 2000

// Only the key and the answer are read from the body. The page also sends
// questionText, answerType and category; those are dropped.
const answerSchema = z.object({
    questionKey: z.enum(QUESTION_KEYS),
    answerBool: z.boolean().nullish(),
    answerText: z.string().nullish(),
})
type ScreeningAnswerInput = z.infer<typeof answerSchema>

/** The answers in a PUT body, or null unless they are a valid set: known keys, each at most once. */
function parseAnswers(body: unknown): ScreeningAnswerInput[] | null {
    const answers = (body as { answers?: unknown } | null)?.answers
    // Length first: zod would parse every element of an oversized list
    // before an array max check ran.
    if (!Array.isArray(answers) || answers.length > QUESTION_KEYS.length) return null
    const parsed = z.array(answerSchema).safeParse(answers)
    if (!parsed.success) return null
    const keys = new Set(parsed.data.map((a) => a.questionKey))
    return keys.size === parsed.data.length ? parsed.data : null
}

// SECURITY (SCR-1): the text is cut BEFORE sanitizeText, whose event-handler
// regex is quadratic on a long whitespace run (40,000 spaces take seconds).
// The page's inputs have no maxLength, so longer text is still cut, not refused.
function cleanAnswerText(text: string): string {
    return sanitizeText(text.slice(0, ANSWER_TEXT_MAX), ANSWER_TEXT_MAX)
}

// GET — fetch all screening answers for current user
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id }, select: { id: true },
        })
        if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

        // The configured questions only: at most one row each (unique on
        // userId + questionKey), whatever an older request stored.
        const answers = await prisma.candidateScreeningAnswer.findMany({
            where: { userId: profile.id, questionKey: { in: QUESTION_KEYS } },
            orderBy: { createdAt: 'asc' },
        })

        return NextResponse.json(answers)
    } catch (err) {
        console.error('Screening answers GET error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// PUT — bulk upsert screening answers
export async function PUT(request: NextRequest) {
    // SECURITY (SCR-1): the PUT had no rate limit. It is keyed per IP, so the
    // body caps below remain the main control.
    const rateLimitResult = await rateLimit(request, 'profile-screening', RATE_LIMITS.profile);
    if (rateLimitResult) return rateLimitResult;

    try {
        const supabase = await createClient()
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id }, select: { id: true },
        })
        if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

        // Invalid JSON, wrong types, unknown or repeated keys and oversized
        // lists are a 400 before any write (invalid JSON and wrong types were a 500).
        const answers = parseAnswers(await request.json().catch(() => null))
        if (!answers) {
            return NextResponse.json({ error: 'Invalid screening answers' }, { status: 400 })
        }

        // Use a transaction for bulk upsert
        const results = await prisma.$transaction(
            answers.map((a) => {
                const question = SCREENING_QUESTIONS[a.questionKey]
                const answerBool = a.answerBool ?? null
                const answerText = a.answerText ? cleanAnswerText(a.answerText) : null
                return prisma.candidateScreeningAnswer.upsert({
                    where: {
                        userId_questionKey: {
                            userId: profile.id,
                            questionKey: a.questionKey,
                        },
                    },
                    update: { answerBool, answerText },
                    create: {
                        userId: profile.id,
                        questionKey: a.questionKey,
                        questionText: question.questionText,
                        answerType: question.answerType,
                        answerBool,
                        answerText,
                        category: question.category,
                    },
                })
            })
        )

        return NextResponse.json(results)
    } catch (err) {
        console.error('Screening answers PUT error:', err)
        return NextResponse.json({ error: 'Failed to save screening answers' }, { status: 500 })
    }
}
