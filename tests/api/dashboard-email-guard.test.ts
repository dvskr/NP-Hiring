/**
 * GET /api/dashboard: a session with no email (docs/PENDING_WORK.md 2.20).
 *
 * The route passed `user.email!` straight into two queries. A sign-in method
 * that carries no email leaves it undefined, and Prisma drops an undefined
 * condition: the alert count then ran with no email filter and counted every
 * active alert on the board, and the newsletter lookup threw on an empty
 * unique key, which turned the whole dashboard into a 500.
 *
 * Pinned:
 *   - with no email the route answers 200, runs neither email query, and
 *     reports no alerts and no newsletter opt-in;
 *   - with an email both queries are keyed on exactly that address.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    alertCount: vi.fn(),
    applicationCount: vi.fn(),
    applicationFindMany: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: vi.fn(async () => false) }));

import { GET as dashboard } from '@/app/api/dashboard/route';

// The global prisma fake has neither a jobApplication model nor jobAlert.count.
Object.assign(prisma, { jobApplication: { count: mocks.applicationCount, findMany: mocks.applicationFindMany } });
Object.assign(prisma.jobAlert, { count: mocks.alertCount });

const USER_ID = 'supabase-seeker';
const EMAIL = 'np@example.com';

function signedIn(user: { id: string; email?: string }): void {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
}

async function load(): Promise<{ status: number; body: { stats?: { activeAlerts: number }; profile?: { newsletterOptIn: boolean } } }> {
    const res = await dashboard(new Request('http://localhost:3000/api/dashboard'));
    return { status: res.status, body: await res.json() };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.applicationCount.mockResolvedValue(0);
    mocks.applicationFindMany.mockResolvedValue([]);
    // What an unfiltered count would return: every active alert on the board.
    mocks.alertCount.mockResolvedValue(4321);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ newsletterOptIn: true } as never);
});

describe('GET /api/dashboard: a session without an email', () => {
    it('answers 200 and runs neither query that is keyed on the email', async () => {
        signedIn({ id: USER_ID });
        const { status, body } = await load();
        expect(status).toBe(200);
        expect(mocks.alertCount).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.emailLead.findUnique)).not.toHaveBeenCalled();
        expect(body.stats?.activeAlerts).toBe(0);
        expect(body.profile?.newsletterOptIn).toBe(false);
    });

    it('treats an empty email the same way', async () => {
        signedIn({ id: USER_ID, email: '' });
        const { status, body } = await load();
        expect(status).toBe(200);
        expect(mocks.alertCount).not.toHaveBeenCalled();
        expect(body.stats?.activeAlerts).toBe(0);
    });
});

describe('GET /api/dashboard: a session with an email', () => {
    it('counts the alerts under that address and reads its newsletter row', async () => {
        signedIn({ id: USER_ID, email: EMAIL });
        mocks.alertCount.mockResolvedValue(2);
        const { status, body } = await load();
        expect(status).toBe(200);
        expect(mocks.alertCount).toHaveBeenCalledWith({
            where: { email: { equals: EMAIL, mode: 'insensitive' }, isActive: true },
        });
        expect(vi.mocked(prisma.emailLead.findUnique)).toHaveBeenCalledWith({
            where: { email: EMAIL },
            select: { newsletterOptIn: true },
        });
        expect(body.stats?.activeAlerts).toBe(2);
        expect(body.profile?.newsletterOptIn).toBe(true);
    });
});
