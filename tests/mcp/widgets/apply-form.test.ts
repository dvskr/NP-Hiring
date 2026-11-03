import { describe, expect, it } from 'vitest';
import type { ApplicationItem, ApplicationsView, ScreeningQuestion } from '@/lib/mcp/contracts';
import {
    buildSubmitArgs,
    canSubmitForm,
    missingQuestionIds,
    unansweredRequired,
    usesLongAnswer,
} from '@/lib/mcp/widgets/src/apply-form';
import { markWithdrawn, moveSummaryCount, statusTone } from '@/lib/mcp/widgets/src/applications';

const questions: ScreeningQuestion[] = [
    { id: 'q1', text: 'Do you hold an active Texas APRN license?', type: 'boolean', options: [], required: true },
    { id: 'q2', text: 'Preferred schedule?', type: 'select', options: ['Days', 'Evenings'], required: true },
    { id: 'q3', text: 'Years as a PMHNP?', type: 'number', options: [], required: false },
];

describe('Easy Apply form rules', () => {
    it('keeps Submit disabled until consent and every required answer are in', () => {
        expect(canSubmitForm(questions, { q1: 'Yes', q2: 'Days' }, false)).toBe(false);
        expect(canSubmitForm(questions, { q1: 'Yes', q2: '   ' }, true)).toBe(false);
        expect(canSubmitForm(questions, { q1: 'Yes', q2: 'Days' }, true)).toBe(true);
        expect(canSubmitForm([], {}, true)).toBe(true);
        expect(unansweredRequired(questions, { q2: 'Days' })).toEqual(['q1']);
    });

    it('sends consent as true, trimmed answers only for answered questions, and no blank cover letter', () => {
        expect(buildSubmitArgs('job_1', '  ', questions, { q1: ' Yes ', q2: 'Days', q3: '' })).toEqual({
            job_id: 'job_1',
            screening_answers: [
                { question_id: 'q1', answer: 'Yes' },
                { question_id: 'q2', answer: 'Days' },
            ],
            consent: true,
        });
        expect(buildSubmitArgs('job_1', 'Dear team,\n\nHello.', [], {})).toEqual({
            job_id: 'job_1',
            cover_letter: 'Dear team,\n\nHello.',
            screening_answers: [],
            consent: true,
        });
    });

    it('gives long text questions a multi-line answer', () => {
        const short: ScreeningQuestion = { id: 't1', text: 'When could you start?', type: 'text', options: [], required: true };
        const long: ScreeningQuestion = { ...short, text: 'Tell us about '.padEnd(120, 'x') };
        expect(usesLongAnswer(short)).toBe(false);
        expect(usesLongAnswer(long)).toBe(true);
        expect(usesLongAnswer({ ...long, type: 'select' })).toBe(false);
    });

    it('reads unanswered question ids from an error result, ignoring anything malformed', () => {
        expect(missingQuestionIds({ missingQuestionIds: ['q1', 2, 'q2'] })).toEqual(['q1', 'q2']);
        expect(missingQuestionIds({ missingQuestionIds: 'q1' })).toEqual([]);
        expect(missingQuestionIds(null)).toEqual([]);
    });
});

const item = (overrides: Partial<ApplicationItem>): ApplicationItem => ({
    id: 'app_1',
    jobId: 'job_1',
    title: 'PMHNP',
    employer: 'Talkiatry',
    location: 'Remote',
    appliedAt: '2026-10-20T12:00:00Z',
    status: 'applied',
    statusLabel: 'Applied',
    easyApply: true,
    jobUrl: null,
    jobOpen: true,
    canWithdraw: true,
    ...overrides,
});

describe('withdraw updates', () => {
    it('marks only the withdrawn row and leaves the input untouched', () => {
        const items = [item({ id: 'a' }), item({ id: 'b', status: 'interview', statusLabel: 'Interview' })];
        const next = markWithdrawn(items, 'b');
        expect(next[1]).toMatchObject({ status: 'withdrawn', statusLabel: 'Withdrawn', canWithdraw: false });
        expect(next[0]).toBe(items[0]);
        expect(items[1].status).toBe('interview');
    });

    it('moves one count to Withdrawn in pipeline order and drops empty statuses', () => {
        const summary: ApplicationsView['summary'] = [
            { status: 'applied', label: 'Applied', count: 1 },
            { status: 'interview', label: 'Interview', count: 2 },
        ];
        expect(moveSummaryCount(summary, 'applied', 'withdrawn')).toEqual([
            { status: 'interview', label: 'Interview', count: 2 },
            { status: 'withdrawn', label: 'Withdrawn', count: 1 },
        ]);
        expect(moveSummaryCount(summary, 'interview', 'withdrawn')).toEqual([
            { status: 'applied', label: 'Applied', count: 1 },
            { status: 'interview', label: 'Interview', count: 1 },
            { status: 'withdrawn', label: 'Withdrawn', count: 1 },
        ]);
        expect(summary[0].count).toBe(1);
    });

    it('colors statuses with the host semantic families', () => {
        expect(statusTone('applied')).toBe('info');
        expect(statusTone('interview')).toBe('warning');
        expect(statusTone('hired')).toBe('success');
        expect(statusTone('rejected')).toBe('danger');
        expect(statusTone('withdrawn')).toBe('disabled');
    });
});
