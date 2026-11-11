/**
 * The fuzzy duplicate strategy reads at most 20 look-alike rows. It has to
 * read the published ones first.
 *
 * Unordered, the 20 were whichever rows the database returned first, which
 * is usually the oldest. Unpublished rows stay in the table, so a role an
 * employer keeps reposting can have more than 20 dead copies,
 * and the one published copy fell outside the window: the posting was then
 * matched to a dead row, and the renewal brought that row back beside the
 * published one.
 *
 * The fake below applies the orderBy and take the query asks for, so the
 * test fails if either is dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { checkDuplicate } from '@/lib/deduplicator';

interface Row {
    id: string;
    title: string;
    employer: string;
    location: string;
    isPublished: boolean;
    createdAt: Date;
}

type OrderBy = Array<Record<string, 'asc' | 'desc'>>;

interface FindManyArgs {
    where: { AND: Array<{ employer?: { contains: string }; title?: { contains: string } }> };
    orderBy?: OrderBy;
    take?: number;
}

function installJobs(rows: Row[]): void {
    vi.mocked(prisma.job.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: FindManyArgs) => {
        const employer = args.where.AND.find((c) => c.employer)?.employer?.contains ?? '';
        const title = args.where.AND.find((c) => c.title)?.title?.contains ?? '';
        const matched = rows.filter((r) => r.employer.includes(employer) && r.title.includes(title));
        const ordered = [...matched].sort((a, b) => {
            for (const clause of args.orderBy ?? []) {
                const [key, direction] = Object.entries(clause)[0];
                const left = Number(a[key as keyof Row]);
                const right = Number(b[key as keyof Row]);
                if (left !== right) return direction === 'desc' ? right - left : left - right;
            }
            return 0;
        });
        return ordered.slice(0, args.take ?? ordered.length);
    }) as never);
}

const day = (n: number): Date => new Date(Date.UTC(2026, 9, n));

const copy = (id: string, over: Partial<Row> = {}): Row => ({
    id,
    title: 'Family Nurse Practitioner, Primary Care',
    employer: 'Example Family Health',
    location: 'Austin, TX',
    isPublished: false,
    createdAt: day(1),
    ...over,
});

// Not an exact identity match (the maps hold none here), so the check falls
// through to the fuzzy strategy.
const posting = {
    title: 'Family Nurse Practitioner - Primary Care',
    employer: 'Example Family Health',
    location: 'Austin, TX',
    externalId: 'feed-99',
    sourceProvider: 'lever',
    applyLink: 'https://ats.example/example/99',
};

const emptyMaps = { globalTitleKeyMap: new Map<string, string>(), globalApplyLinkMap: new Map<string, string>() };

beforeEach(() => {
    vi.clearAllMocks();
});

describe('checkDuplicate, fuzzy strategy', () => {
    it('matches the published copy even when more than 20 dead copies were stored before it', async () => {
        const dead = Array.from({ length: 25 }, (_, i) => copy(`dead-${i + 1}`, { createdAt: day(i + 1) }));
        installJobs([...dead, copy('live', { isPublished: true, createdAt: day(3) })]);

        const result = await checkDuplicate(posting, emptyMaps);

        expect(result).toMatchObject({ isDuplicate: true, matchType: 'fuzzy_title', matchedJobId: 'live' });
    });

    it('with no published copy, matches the newest dead one', async () => {
        installJobs([copy('older', { createdAt: day(2) }), copy('newest', { createdAt: day(9) }), copy('oldest', { createdAt: day(1) })]);

        const result = await checkDuplicate(posting, emptyMaps);

        expect(result).toMatchObject({ isDuplicate: true, matchType: 'fuzzy_title', matchedJobId: 'newest' });
    });
});
