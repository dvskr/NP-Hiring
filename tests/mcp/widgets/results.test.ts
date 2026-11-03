import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR } from '@/lib/mcp/widgets/src/copy';
import { asWidgetView, firstText, readToolResult, skeletonFor } from '@/lib/mcp/widgets/src/results';
import { createStore } from '@/lib/mcp/widgets/src/store';

const job = { id: 'job_1', title: 'PMHNP', employer: 'Talkiatry' };

const jobList = {
    view: 'job-list',
    heading: 'PMHNP jobs',
    filters: [],
    total: 1,
    page: 1,
    totalPages: 1,
    jobs: [job],
    nextPageArgs: null,
    browseUrl: 'https://nphiring.com/jobs',
    signedIn: false,
};

describe('readToolResult', () => {
    it('renders the first text block of an error result', () => {
        const outcome = readToolResult({
            isError: true,
            content: [
                { type: 'image', text: undefined },
                { type: 'text', text: '  Sign in to NP Hiring to save jobs.  ' },
            ],
        });
        expect(outcome).toEqual({ ok: false, message: 'Sign in to NP Hiring to save jobs.', data: null });
    });

    it('falls back to the generic message when an error carries no text', () => {
        expect(readToolResult({ isError: true, content: [{ type: 'text', text: ' ' }] })).toMatchObject({
            ok: false,
            message: GENERIC_ERROR,
        });
        expect(readToolResult({ isError: true })).toMatchObject({ ok: false, message: GENERIC_ERROR });
    });

    it('keeps structured data on errors so field errors can be read', () => {
        const outcome = readToolResult({
            isError: true,
            content: [{ type: 'text', text: 'Answer the required questions.' }],
            structuredContent: { missingQuestionIds: ['q1'] },
        });
        expect(outcome).toMatchObject({ ok: false, data: { missingQuestionIds: ['q1'] } });
    });

    it('returns the view for a view result and plain data otherwise', () => {
        expect(readToolResult({ content: [], structuredContent: jobList })).toEqual({
            ok: true,
            view: jobList,
            data: jobList,
        });
        expect(readToolResult({ structuredContent: { jobId: 'job_1', saved: true } })).toEqual({
            ok: true,
            view: null,
            data: { jobId: 'job_1', saved: true },
        });
        expect(readToolResult({ structuredContent: ['not', 'an', 'object'] })).toEqual({ ok: true, view: null, data: null });
    });

    it('reads only non-empty text blocks', () => {
        expect(firstText({ content: [{ type: 'text', text: '' }, { type: 'text', text: 'Second' }] })).toBe('Second');
        expect(firstText({})).toBeNull();
    });
});

describe('asWidgetView', () => {
    it('accepts each view with the fields it renders', () => {
        expect(asWidgetView(jobList)).not.toBeNull();
        expect(asWidgetView({ view: 'job-detail', job, signedIn: true })).not.toBeNull();
        expect(asWidgetView({ view: 'apply', job, questions: [], resume: { onFile: false, fileName: null } })).not.toBeNull();
        expect(asWidgetView({ view: 'apply-result', job, appliedAt: '2026-10-28T00:00:00Z' })).not.toBeNull();
        expect(asWidgetView({ view: 'applications', applications: [], summary: [] })).not.toBeNull();
    });

    it('rejects unknown views and views missing what they render', () => {
        expect(asWidgetView({ view: 'job-list', heading: 'x' })).toBeNull();
        expect(asWidgetView({ view: 'job-detail', job: { id: 1 } })).toBeNull();
        expect(asWidgetView({ view: 'apply', job, questions: [] })).toBeNull();
        expect(asWidgetView({ view: 'apply-result', job })).toBeNull();
        expect(asWidgetView({ view: 'applications', applications: [] })).toBeNull();
        expect(asWidgetView({ view: 'dashboard' })).toBeNull();
        expect(asWidgetView(null)).toBeNull();
        expect(asWidgetView('job-list')).toBeNull();
    });
});

describe('skeletonFor', () => {
    it('maps tool names to the view they return', () => {
        expect(skeletonFor('search_jobs', undefined)).toBe('job-list');
        expect(skeletonFor('list_saved_jobs', undefined)).toBe('job-list');
        expect(skeletonFor('get_job', undefined)).toBe('job-detail');
        expect(skeletonFor('start_application', undefined)).toBe('apply');
        expect(skeletonFor('submit_application', undefined)).toBe('apply-result');
        expect(skeletonFor('list_my_applications', undefined)).toBe('applications');
    });

    it('falls back to the shape of the input when the host does not name the tool', () => {
        expect(skeletonFor(undefined, { job_id: 'x', consent: true })).toBe('apply-result');
        expect(skeletonFor(undefined, { job_id: 'x', cover_letter_draft: 'Hi' })).toBe('apply');
        expect(skeletonFor(undefined, { job_id: 'x' })).toBe('job-detail');
        expect(skeletonFor(undefined, { status: 'applied' })).toBe('applications');
        expect(skeletonFor(undefined, { query: 'pmhnp' })).toBe('job-list');
        expect(skeletonFor('unknown_tool', undefined)).toBe('job-list');
    });
});

describe('widget store', () => {
    it('shows the skeleton for the tool once connected, then the view', () => {
        const store = createStore();
        expect(store.get().phase).toEqual({ kind: 'connecting' });
        store.connected('get_job');
        expect(store.get().phase).toEqual({ kind: 'waiting', skeleton: 'job-detail' });
        store.toolResult({ structuredContent: jobList });
        expect(store.get().phase).toMatchObject({ kind: 'ready', seq: 1, view: jobList });
    });

    it('keeps a result that arrives before the connect promise settles', () => {
        const store = createStore();
        store.toolInput({ query: 'pmhnp' });
        store.toolResult({ structuredContent: jobList });
        store.connected('search_jobs');
        expect(store.get().phase.kind).toBe('ready');
    });

    it('turns error results and unrenderable results into the error state', () => {
        const store = createStore();
        store.toolResult({ isError: true, content: [{ type: 'text', text: 'Job not found.' }] });
        expect(store.get().phase).toEqual({ kind: 'error', seq: 1, message: 'Job not found.' });
        store.toolResult({ structuredContent: { view: 'mystery' } });
        expect(store.get().phase).toEqual({ kind: 'error', seq: 2, message: GENERIC_ERROR });
    });

    it('ignores a repeated delivery of the same result so in-widget navigation survives', () => {
        const store = createStore();
        store.toolResult({ content: [{ type: 'text', text: 'Jobs.' }], structuredContent: jobList });
        store.toolResult({ content: [{ type: 'text', text: 'Jobs.' }], structuredContent: { ...jobList } });
        expect(store.get().phase).toMatchObject({ kind: 'ready', seq: 1 });
        store.toolResult({ structuredContent: { ...jobList, heading: 'Other jobs' } });
        expect(store.get().phase).toMatchObject({ kind: 'ready', seq: 2 });
    });

    it('drops the skeleton when the tool call is cancelled, but never a shown view', () => {
        const cancelled = createStore();
        cancelled.connected('search_jobs');
        cancelled.toolCancelled();
        expect(cancelled.get().phase).toEqual({ kind: 'cancelled' });

        const shown = createStore();
        shown.toolResult({ structuredContent: jobList });
        shown.toolCancelled();
        expect(shown.get().phase.kind).toBe('ready');
    });

    it('notifies subscribers and merges host updates', () => {
        const store = createStore();
        const seen: string[] = [];
        const unsubscribe = store.subscribe((state) => seen.push(state.host.displayMode));
        store.setHost({ displayMode: 'fullscreen', canFullscreen: true });
        unsubscribe();
        store.setHost({ displayMode: 'inline' });
        expect(seen).toEqual(['fullscreen']);
        expect(store.get().host).toEqual({ displayMode: 'inline', canFullscreen: true, timeZone: undefined });
    });
});
