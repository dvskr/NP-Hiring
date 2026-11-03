/**
 * Easy Apply form rules, kept pure so the suite can pin them: when Submit is
 * enabled, what submit_application receives, and which questions the server
 * reported as unanswered.
 */
import type { ScreeningQuestion, SubmitApplicationInput } from '../../contracts';

export type Answers = Readonly<Record<string, string>>;

/** A text question longer than this gets a multi-line answer box. */
export const LONG_QUESTION_CHARS = 80;

export function isAnswered(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim() !== '';
}

export function unansweredRequired(questions: readonly ScreeningQuestion[], answers: Answers): string[] {
    return questions.filter((q) => q.required && !isAnswered(answers[q.id])).map((q) => q.id);
}

/** Submit stays disabled until consent is given and every required question has an answer. */
export function canSubmitForm(questions: readonly ScreeningQuestion[], answers: Answers, consent: boolean): boolean {
    return consent && unansweredRequired(questions, answers).length === 0;
}

export function usesLongAnswer(question: ScreeningQuestion): boolean {
    return question.type === 'text' && question.text.length > LONG_QUESTION_CHARS;
}

/** The submit_application arguments; consent is only ever sent as true, after the box is checked. */
export function buildSubmitArgs(
    jobId: string,
    coverLetter: string,
    questions: readonly ScreeningQuestion[],
    answers: Answers,
): SubmitApplicationInput {
    const screeningAnswers = questions
        .filter((q) => isAnswered(answers[q.id]))
        .map((q) => ({ question_id: q.id, answer: answers[q.id].trim() }));
    return {
        job_id: jobId,
        ...(coverLetter.trim() !== '' ? { cover_letter: coverLetter } : {}),
        screening_answers: screeningAnswers,
        consent: true,
    };
}

/**
 * Question ids an error result names as unanswered. The server reports them
 * as `structuredContent.missingQuestionIds` on an isError result (proposed
 * contract addition, see the widget report); anything else yields none.
 */
export function missingQuestionIds(data: Record<string, unknown> | null): string[] {
    const ids = data?.missingQuestionIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
