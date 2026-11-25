/**
 * Merging two companies without losing the employer relationship on either.
 *
 * The old merge moved jobs and aliases, then deleted the merged row, and the
 * database deleted that row's employer claims with it. The badge and the
 * direct hire or staffing agency classification went the same way. Now the
 * claims move to the kept company, and a merge that would drop the verified
 * claim or a classification is refused with a message saying what to do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
    const tx = {
        company: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
        companyClaim: { findMany: vi.fn(), updateMany: vi.fn() },
        job: { updateMany: vi.fn(), count: vi.fn() },
    };
    return {
        tx,
        transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        logAudit: vi.fn(),
    };
});

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: h.transaction } }));
vi.mock('@/lib/audit-log', () => ({ logAudit: h.logAudit }));

import {
    mergeCompanyRecords,
    planCompanyMerge,
    type MergeClaimSnapshot,
    type MergeCompanySnapshot,
    type MergeRefusal,
} from '@/lib/company-merge';
import { mergeCompanies } from '@/lib/company-normalizer';

const KEEP = 'company-keep';
const MERGE = 'company-merge';
const ADMIN = { actorType: 'admin' as const, actorId: 'admin-profile-id' };

function company(over: Partial<MergeCompanySnapshot> & Pick<MergeCompanySnapshot, 'id' | 'name'>): MergeCompanySnapshot {
    return {
        normalizedName: over.name.toLowerCase(),
        aliases: [],
        claimVerifiedAt: null,
        recruitmentType: null,
        ...over,
    };
}

function claim(companyId: string, claimantUserId: string, status: string): MergeClaimSnapshot {
    return { id: `${companyId}-${claimantUserId}-${status}`, companyId, claimantUserId, status };
}

const keep = company({ id: KEEP, name: 'Acme Clinic', aliases: ['acme clinic group'] });
const merge = company({ id: MERGE, name: 'Acme Clinic Inc', normalizedName: 'acme clinic inc', aliases: ['acme'] });
const verified = new Date('2026-10-01T00:00:00.000Z');
/** An en dash or an em dash, built from code points so this file holds neither. */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

function expectRefusal(result: ReturnType<typeof planCompanyMerge>, code: MergeRefusal['code']): MergeRefusal {
    expect(result.ok).toBe(false);
    const refusal = result as MergeRefusal;
    expect(refusal.code).toBe(code);
    expect(refusal.message, 'refusal copy uses no en or em dash').not.toMatch(LONG_DASH);
    return refusal;
}

describe('planCompanyMerge', () => {
    it('refuses to merge a company with itself', () => {
        expect(expectRefusal(planCompanyMerge(keep, keep, []), 'same_company').status).toBe(400);
    });

    it('refuses two companies that both hold a verified claim', () => {
        const byTimestamp = planCompanyMerge(
            { ...keep, claimVerifiedAt: verified }, { ...merge, claimVerifiedAt: verified }, []);
        expect(expectRefusal(byTimestamp, 'both_claimed').status).toBe(409);

        // An approved claim counts even if the timestamp were ever missing.
        const byClaims = planCompanyMerge(keep, merge, [claim(KEEP, 'u1', 'approved'), claim(MERGE, 'u2', 'approved')]);
        expectRefusal(byClaims, 'both_claimed');
    });

    it('refuses to drop the verified claim of the company being merged away, and says which to keep', () => {
        const refusal = expectRefusal(planCompanyMerge(keep, { ...merge, claimVerifiedAt: verified }, []), 'merged_is_claimed');
        expect(refusal.status).toBe(409);
        expect(refusal.message).toContain(`Keep "${merge.name}" instead`);
    });

    it('merges into the claimed company', () => {
        const plan = planCompanyMerge({ ...keep, claimVerifiedAt: verified }, merge, [claim(KEEP, 'u1', 'approved')]);
        expect(plan.ok).toBe(true);
    });

    it('refuses two different classifications', () => {
        const result = planCompanyMerge(
            { ...keep, recruitmentType: 'direct_hire' }, { ...merge, recruitmentType: 'staffing_agency' }, []);
        const refusal = expectRefusal(result, 'classification_conflict');
        expect(refusal.message).toContain('direct hire');
        expect(refusal.message).toContain('staffing agency');
    });

    it('refuses to drop the classification of the company being merged away', () => {
        expectRefusal(planCompanyMerge(keep, { ...merge, recruitmentType: 'direct_hire' }, []), 'merged_is_classified');
    });

    it('merges when the kept company already carries the classification', () => {
        expect(planCompanyMerge({ ...keep, recruitmentType: 'direct_hire' }, merge, []).ok).toBe(true);
        expect(planCompanyMerge(
            { ...keep, recruitmentType: 'direct_hire' }, { ...merge, recruitmentType: 'direct_hire' }, []).ok).toBe(true);
    });

    it('refuses when the same person has an open claim on both companies', () => {
        const result = planCompanyMerge(keep, merge, [claim(KEEP, 'u1', 'pending'), claim(MERGE, 'u1', 'pending')]);
        expectRefusal(result, 'duplicate_open_claim');
    });

    it('moves open claims from different people', () => {
        const result = planCompanyMerge(keep, merge, [claim(KEEP, 'u1', 'pending'), claim(MERGE, 'u2', 'pending')]);
        expect(result.ok).toBe(true);
    });

    it('folds the merged names into the kept aliases once each, kept aliases first', () => {
        const plan = planCompanyMerge(keep, { ...merge, aliases: ['acme', 'acme clinic group'] }, []);
        expect(plan).toEqual({
            ok: true,
            aliases: ['acme clinic group', 'Acme Clinic Inc', 'acme clinic inc', 'acme'],
        });
    });
});

function stubRows(keepRow: MergeCompanySnapshot | null, mergeRow: MergeCompanySnapshot | null, claims: MergeClaimSnapshot[] = []) {
    h.tx.company.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === KEEP ? keepRow : where.id === MERGE ? mergeRow : null);
    h.tx.companyClaim.findMany.mockResolvedValue(claims);
    h.tx.job.updateMany.mockResolvedValue({ count: 3 });
    h.tx.companyClaim.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 2 });
    h.tx.job.count.mockResolvedValue(10);
    h.tx.company.update.mockResolvedValue({ id: KEEP });
    h.tx.company.delete.mockResolvedValue({ id: MERGE });
}

function expectNoWrites() {
    expect(h.tx.job.updateMany).not.toHaveBeenCalled();
    expect(h.tx.companyClaim.updateMany).not.toHaveBeenCalled();
    expect(h.tx.company.update).not.toHaveBeenCalled();
    expect(h.tx.company.delete).not.toHaveBeenCalled();
    expect(h.logAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    h.tx.companyClaim.updateMany.mockReset();
    h.transaction.mockImplementation(async (fn: (client: typeof h.tx) => Promise<unknown>) => fn(h.tx));
});

describe('mergeCompanyRecords', () => {
    it('moves jobs and claims, recounts, deletes the merged row last, and audits the merge', async () => {
        stubRows(keep, merge, [claim(MERGE, 'u2', 'pending'), claim(MERGE, 'u3', 'rejected')]);

        const result = await mergeCompanyRecords(KEEP, MERGE, ADMIN);

        expect(result).toEqual({
            ok: true, keepId: KEEP, mergeId: MERGE, keptName: 'Acme Clinic', mergedName: 'Acme Clinic Inc',
            jobsMoved: 3, claimsMoved: 2, jobCount: 10,
        });
        expect(h.tx.job.updateMany).toHaveBeenCalledWith({ where: { companyId: MERGE }, data: { companyId: KEEP } });
        expect(h.tx.companyClaim.updateMany).toHaveBeenNthCalledWith(1,
            { where: { pendingCompanyId: MERGE }, data: { pendingCompanyId: KEEP } });
        expect(h.tx.companyClaim.updateMany).toHaveBeenNthCalledWith(2,
            { where: { companyId: MERGE }, data: { companyId: KEEP } });
        expect(h.tx.job.count).toHaveBeenCalledWith({ where: { companyId: KEEP } });

        // The kept row gains aliases and a recounted job count, nothing else:
        // the badge, the classification and the web identity have their own writers.
        expect(h.tx.company.update).toHaveBeenCalledWith({
            where: { id: KEEP },
            data: { aliases: ['acme clinic group', 'Acme Clinic Inc', 'acme clinic inc', 'acme'], jobCount: 10 },
        });

        // The claims leave before the row the database would delete them with.
        const deleteOrder = h.tx.company.delete.mock.invocationCallOrder[0];
        for (const order of h.tx.companyClaim.updateMany.mock.invocationCallOrder) {
            expect(order).toBeLessThan(deleteOrder);
        }
        expect(h.tx.company.delete).toHaveBeenCalledWith({ where: { id: MERGE } });

        expect(h.logAudit).toHaveBeenCalledWith({
            action: 'company.merge',
            actorType: 'admin',
            actorId: 'admin-profile-id',
            targetType: 'company',
            targetId: KEEP,
            metadata: {
                mergedId: MERGE, mergedName: 'Acme Clinic Inc', keptName: 'Acme Clinic',
                jobsMoved: 3, claimsMoved: 2, jobCount: 10,
            },
        });
    });

    it('writes nothing and audits nothing when the plan refuses', async () => {
        stubRows(keep, { ...merge, claimVerifiedAt: verified });

        const result = await mergeCompanyRecords(KEEP, MERGE, ADMIN);

        expect(result).toMatchObject({ ok: false, code: 'merged_is_claimed', status: 409 });
        expectNoWrites();
    });

    it('answers not found for a missing company', async () => {
        stubRows(keep, null);

        const result = await mergeCompanyRecords(KEEP, MERGE, ADMIN);

        expect(result).toMatchObject({ ok: false, code: 'not_found', status: 404 });
        expect((result as MergeRefusal).message).toContain(MERGE);
        expectNoWrites();
    });

    it('refuses a missing or repeated id without opening a transaction', async () => {
        expect(await mergeCompanyRecords('', MERGE, ADMIN)).toMatchObject({ ok: false, code: 'missing_id', status: 400 });
        expect(await mergeCompanyRecords(KEEP, KEEP, ADMIN)).toMatchObject({ ok: false, code: 'same_company', status: 400 });
        expect(h.transaction).not.toHaveBeenCalled();
    });

    it('lets a database failure through, unaudited', async () => {
        stubRows(keep, merge);
        h.tx.job.updateMany.mockRejectedValue(new Error('deadlock detected'));

        await expect(mergeCompanyRecords(KEEP, MERGE, ADMIN)).rejects.toThrow('deadlock detected');
        expect(h.logAudit).not.toHaveBeenCalled();
    });
});

describe('mergeCompanies (the canonicalize script path)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('throws the refusal, so the script reports the pair instead of dropping a claim', async () => {
        stubRows(keep, { ...merge, claimVerifiedAt: verified });

        await expect(mergeCompanies(KEEP, MERGE)).rejects.toThrow(`Keep "${merge.name}" instead`);
        expectNoWrites();
    });

    it('merges and audits as the system when no actor is given', async () => {
        stubRows(keep, merge);

        await expect(mergeCompanies(KEEP, MERGE)).resolves.toBeUndefined();
        expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'company.merge', actorType: 'system', actorId: null, targetId: KEEP,
        }));
    });
});
