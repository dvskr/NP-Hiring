/**
 * Request validation for the answer routes: generate-answer (one question)
 * and generate-bulk (up to MAX_BULK_QUESTIONS). Lives here so the bulk route
 * does not import the single route and its resume-storage graph.
 */

import { z } from 'zod';
import { MAX_EMPLOYER_NAME_CHARS, MAX_JOB_DESCRIPTION_CHARS, MAX_JOB_TITLE_CHARS } from './input';

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
    jobTitle: z.string().max(MAX_JOB_TITLE_CHARS).catch(''),
    jobDescription: z.string().max(MAX_JOB_DESCRIPTION_CHARS).catch(''),
    employerName: z.string().max(MAX_EMPLOYER_NAME_CHARS).catch(''),
    maxLength: z.coerce.number().int().min(20).max(1_500).catch(300),
}).transform((v) => ({
    ...v,
    questionKey: v.questionKey ?? '',
    jobTitle: v.jobTitle ?? '',
    jobDescription: v.jobDescription ?? '',
    employerName: v.employerName ?? '',
}));

export type GenerateAnswerRequest = z.output<typeof generateAnswerRequestSchema>;

export const MAX_BULK_QUESTIONS = 10;

/**
 * SECURITY (AUTOFILL-BULK-1): generate-bulk used each question as sent, so
 * questionText, jobTitle and employerName reached up to ten prompts uncut
 * and a non-string questionText answered 500. Every question now passes the
 * single-question schema above; the route checks the array length first,
 * because zod parses every element before it applies a max.
 * Test: tests/api/autofill-bulk-input.test.ts
 */
export const bulkAnswerQuestionsSchema = z.array(generateAnswerRequestSchema);
