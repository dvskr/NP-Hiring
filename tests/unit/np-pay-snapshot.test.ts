/**
 * lib/reports/np-pay.ts, the pure parts of the snapshot loader:
 *   - runBounded keeps task order and never has more than `limit` queries in
 *     flight (the serverless pool holds three connections);
 *   - summarizeByState groups one fetch by state and counts each employer
 *     once per state.
 * Prisma is the global mock from tests/setup.ts; all fixtures are fictional.
 */
import { describe, it, expect } from 'vitest';
import { runBounded, summarizeByState } from '@/lib/reports/np-pay';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('runBounded', () => {
    it('returns results in task order and holds at most the limit in flight', async () => {
        let inFlight = 0;
        let peak = 0;
        const tasks = Array.from({ length: 10 }, (_, i) => async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await tick();
            inFlight -= 1;
            return i * 2;
        });
        const results = await runBounded(tasks, 3);
        expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
        expect(peak).toBe(3);
    });

    it('handles fewer tasks than the limit, and none at all', async () => {
        expect(await runBounded([async () => 'a'], 3)).toEqual(['a']);
        expect(await runBounded([], 3)).toEqual([]);
    });

    it('rejects when a task rejects, so the loader can retry', async () => {
        const tasks = [async () => 1, async () => { throw new Error('pool timeout'); }, async () => 3];
        await expect(runBounded(tasks, 2)).rejects.toThrow('pool timeout');
    });
});

describe('summarizeByState', () => {
    const row = (state: string | null, employer: string, min: number) => ({
        state,
        employer,
        title: 'Family Nurse Practitioner',
        professionClass: 'np_eligible',
        normalizedMinSalary: min,
        normalizedMaxSalary: min + 20_000,
    });

    it('groups by state, skips rows with no state and counts each employer once', () => {
        const rows = [
            ...Array.from({ length: 6 }, (_, i) => row('Texas', `Clinic ${i + 1}`, 100_000 + i * 1_000)),
            ...Array.from({ length: 8 }, () => row('Texas', 'Clinic 1', 100_000)),
            row('Ohio', 'Ohio Group', 110_000),
            row(null, 'Nowhere Health', 120_000),
        ];
        const byState = summarizeByState(rows as never);
        expect([...byState.keys()].sort()).toEqual(['Ohio', 'Texas']);
        expect(byState.get('Texas')?.summary.n).toBe(6);
        expect(byState.get('Texas')?.summary.tier).toBe('median');
        expect(byState.get('Ohio')?.summary).toEqual({ tier: 'none', n: 1 });
    });
});
