/**
 * P10 saved-jobs regressions (non-UI logic).
 *
 *  1. Hydration #418: the hook read localStorage during the hydration render.
 *     The store now exposes an empty server snapshot with status 'unknown'.
 *  2. Save / unsave clicked before GET /api/saved-jobs finished (or while it
 *     failed) was dropped: no server row, no feedback.
 *  3. ConfirmDialog had no focus trap.
 *  4. /saved showed "No saved jobs yet" to signed-out visitors.
 *  5. POST /api/saved-jobs stored rows for job ids that do not exist.
 *  6. Anonymous save flipped silently with no device-only notice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findFirst: vi.fn() },
        savedJob: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    },
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { general: { limit: 100, windowSeconds: 60 } },
}));

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const JOB = '11111111-1111-1111-1111-111111111111';

// ── Minimal browser globals for the module-level store ─────────────────────
interface FakeResponse { status: number; ok: boolean; json: () => Promise<unknown> }
const res = (status: number, body: unknown = {}): FakeResponse => ({
    status, ok: status >= 200 && status < 300, json: async () => body,
});

function installBrowser(cookie: string) {
    const store = new Map<string, string>();
    const g = globalThis as Record<string, unknown>;
    g.window = globalThis;
    g.document = { cookie };
    g.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    };
}
function uninstallBrowser() {
    const g = globalThis as Record<string, unknown>;
    delete g.window;
    delete g.document;
    delete g.localStorage;
}

async function loadStore() {
    const mod = await import('@/lib/hooks/useSavedJobs');
    mod.__savedJobsStore.reset();
    return mod;
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('P10 saved-jobs 1: hydration-safe snapshots', () => {
    afterEach(uninstallBrowser);

    it('server snapshot is empty and unknown even when localStorage has saves', async () => {
        installBrowser('');
        localStorage.setItem('savedJobs', JSON.stringify({ [JOB]: '2026-09-01T00:00:00.000Z' }));
        const { __savedJobsStore: s } = await loadStore();
        expect(s.getServerMap()).toEqual({});
        expect(s.getServerAuthStatus()).toBe('unknown');
        // The client snapshot (post-hydration) does see the device save.
        expect(Object.keys(s.getMap())).toEqual([JOB]);
    });

    it('the hook subscribes through useSyncExternalStore with a server snapshot', () => {
        const src = read('lib/hooks/useSavedJobs.ts');
        expect(src).toContain('useSyncExternalStore(subscribe, getMapSnapshot, getServerMapSnapshot)');
        const hookBody = src.slice(src.indexOf('export default function'));
        // No localStorage read on the render path of the hook body.
        expect(hookBody).not.toMatch(/const [a-zA-Z]+ = getStoredSavedJobs\(\)/);
    });
});

describe('P10 saved-jobs 2: early and failed mutations are not dropped', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        installBrowser('sb-abc-auth-token.0=chunk; other=1');
        fetchMock = vi.fn();
        (globalThis as Record<string, unknown>).fetch = fetchMock;
    });
    afterEach(() => {
        uninstallBrowser();
        vi.unstubAllGlobals();
    });

    it('a save clicked while the GET is pending waits for auth and then POSTs', async () => {
        const { __savedJobsStore: s } = await loadStore();
        const get = deferred<FakeResponse>();
        fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
            init?.method ? Promise.resolve(res(200)) : get.promise);

        const sync = s.sync();
        const save = s.save(JOB);
        expect(JOB in s.getMap()).toBe(true);
        expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);

        get.resolve(res(200, { savedJobs: [] }));
        await sync;
        await save;
        const posts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
        expect(posts).toHaveLength(1);
        expect(JSON.parse(posts[0][1].body)).toEqual({ jobId: JOB });
        // The (older) GET response did not wipe the optimistic save.
        expect(JOB in s.getMap()).toBe(true);
        expect(s.getAuthStatus()).toBe('authenticated');
    });

    it('a save made while the GET failed still reaches the server', async () => {
        const { __savedJobsStore: s } = await loadStore();
        fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
            Promise.resolve(init?.method ? res(200) : res(500)));
        await s.sync();
        expect(s.getAuthStatus()).toBe('error');
        await s.save(JOB);
        expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true);
        expect(JOB in s.getMap()).toBe(true);
    });

    it('a rejected POST rolls the save back and shows an error notice', async () => {
        const { __savedJobsStore: s, SAVED_JOBS_NOTICE_MESSAGES } = await loadStore();
        const notices: string[] = [];
        s.onNotice((k) => notices.push(k));
        fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
            Promise.resolve(init?.method ? res(404) : res(200, { savedJobs: [] })));
        await s.save(JOB);
        expect(JOB in s.getMap()).toBe(false);
        expect(notices).toEqual(['save-failed']);
        expect(SAVED_JOBS_NOTICE_MESSAGES['save-failed']).not.toMatch(/[–—]/);
    });

    it('a rejected DELETE restores the saved job', async () => {
        const { __savedJobsStore: s } = await loadStore();
        const notices: string[] = [];
        s.onNotice((k) => notices.push(k));
        fetchMock.mockImplementation((_url: string, init?: { method?: string }) => {
            if (!init?.method) return Promise.resolve(res(200, { savedJobs: [{ jobId: JOB, savedAt: '2026-09-01T00:00:00.000Z' }] }));
            return Promise.reject(new Error('network down'));
        });
        await s.sync();
        await s.remove(JOB);
        expect(s.getMap()[JOB]).toBe('2026-09-01T00:00:00.000Z');
        expect(notices).toEqual(['remove-failed']);
    });

    it('save then unsave reach the server in order', async () => {
        const { __savedJobsStore: s } = await loadStore();
        fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
            Promise.resolve(init?.method ? res(200) : res(200, { savedJobs: [] })));
        const a = s.save(JOB);
        const b = s.remove(JOB);
        await Promise.all([a, b]);
        const methods = fetchMock.mock.calls.map((c) => c[1]?.method).filter(Boolean);
        expect(methods).toEqual(['POST', 'DELETE']);
        expect(JOB in s.getMap()).toBe(false);
    });
});

describe('P10 saved-jobs 6: anonymous saves disclose device-only storage', () => {
    afterEach(uninstallBrowser);

    it('no session cookie: saves locally, never calls the API, emits the device-only notice', async () => {
        installBrowser('');
        const fetchMock = vi.fn();
        (globalThis as Record<string, unknown>).fetch = fetchMock;
        const { __savedJobsStore: s, SAVED_JOBS_NOTICE_MESSAGES } = await loadStore();
        const notices: string[] = [];
        s.onNotice((k) => notices.push(k));
        await s.save(JOB);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(JOB in s.getMap()).toBe(true);
        expect(s.getAuthStatus()).toBe('anonymous');
        expect(notices).toEqual(['device-only']);
        // Matches the journey specs' prompt detection, copy rule respected.
        expect(SAVED_JOBS_NOTICE_MESSAGES['device-only']).toMatch(/saved on this device/i);
        expect(SAVED_JOBS_NOTICE_MESSAGES['device-only']).toMatch(/sign in to save/i);
        expect(SAVED_JOBS_NOTICE_MESSAGES['device-only']).not.toMatch(/[–—]/);
    });

    it('JobCard and SaveJobButton route saves through the hook that emits the notice', () => {
        expect(read('components/JobCard.tsx')).toContain('saveJob(job.id)');
        expect(read('components/SaveJobButton.tsx')).toContain('saveJob(jobId)');
        const hook = read('lib/hooks/useSavedJobs.ts');
        expect(hook).toContain("toast(SAVED_JOBS_NOTICE_MESSAGES[kind]");
    });
});

describe('P10 saved-jobs 3: ConfirmDialog traps focus', () => {
    const src = read('components/ui/ConfirmDialog.tsx');
    it('imports the shared trap and attaches it to the dialog card', () => {
        expect(src).toContain("import { useFocusTrap } from '@/lib/hooks/useFocusTrap'");
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{ isOpen: true \}\)/);
        expect(src).toContain('ref={cardRef}');
        // Enter still activates confirm: it is focused after the trap's initial focus.
        expect(src).toContain('ref={confirmRef}');
        expect(src).not.toMatch(/\sautoFocus[\s>=]/);
    });
});

describe('P10 saved-jobs 4: /saved gates signed-out visitors', () => {
    const src = read('app/saved/page.tsx');
    it('renders a sign-in link back to /saved when the store is anonymous', () => {
        expect(src).toContain("const SIGN_IN_HREF = '/login?redirectTo=/saved'");
        expect(src).toContain("const isSignedOut = authStatus === 'anonymous'");
        expect(src).toContain('Sign in to see your saved jobs');
        // The account empty state is never shown to a signed-out visitor.
        expect(src).toMatch(/!isSignedOut && jobs\.length === 0/);
    });
});

describe('P10 saved-jobs 5: POST /api/saved-jobs validates the job', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    });

    const post = (body: unknown) => new NextRequest('https://example.com/api/saved-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

    it('returns 404 and stores nothing for a job id that does not exist', async () => {
        const { POST } = await import('@/app/api/saved-jobs/route');
        vi.mocked(prisma.job.findFirst).mockResolvedValue(null);
        const r = await POST(post({ jobId: '00000000-0000-0000-0000-000000000000' }));
        expect(r.status).toBe(404);
        expect(prisma.savedJob.upsert).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.job.findFirst).mock.calls[0][0]).toMatchObject({
            where: { id: '00000000-0000-0000-0000-000000000000', isPublished: true },
        });
    });

    it('saves a published job', async () => {
        const { POST } = await import('@/app/api/saved-jobs/route');
        vi.mocked(prisma.job.findFirst).mockResolvedValue({ id: JOB } as never);
        vi.mocked(prisma.savedJob.upsert).mockResolvedValue({ id: 's1', jobId: JOB } as never);
        const r = await POST(post({ jobId: JOB }));
        expect(r.status).toBe(200);
        expect(prisma.savedJob.upsert).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed body with 400 instead of a 500', async () => {
        const { POST } = await import('@/app/api/saved-jobs/route');
        expect((await POST(post('not json'))).status).toBe(400);
        expect((await POST(post({ jobId: 42 }))).status).toBe(400);
        expect((await POST(post({}))).status).toBe(400);
        expect(prisma.job.findFirst).not.toHaveBeenCalled();
    });

    it('rejects anonymous callers with 401', async () => {
        const { POST } = await import('@/app/api/saved-jobs/route');
        getUserMock.mockResolvedValue({ data: { user: null } });
        expect((await POST(post({ jobId: JOB }))).status).toBe(401);
    });
});
