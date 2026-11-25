/**
 * The /salary-guide FAQ (lib/salary-guide-hub-faq.ts): every answer comes
 * from a cited BLS figure or from the engine's snapshot with its employer
 * count, falls back to BLS alone without a snapshot, and never says "earn",
 * "average" or uses a dash. Fixtures are fictional.
 */
import { describe, it, expect } from 'vitest';
import { summarizeScope } from '@/components/tools/benchmark-model';
import { scopeRow, stateRows, NATIONAL_BLS, type NpPaySnapshot } from '@/lib/reports/np-pay-model';
import {
    buildHubFaqs,
    highestPaidTypeAnswer,
    paOrNpAnswer,
    publishedByMedian,
    statesWhereNpMedianTopsPa,
    twoHundredKAnswer,
} from '@/lib/salary-guide-hub-faq';
import { BLS_NATIONAL, topStatesByMedian } from '@/lib/salary-guide-bls-states';
import { OCCUPATION_WAGES } from '@/lib/salary-guide-occupation-wages';

const rows = (n: number, base: number) =>
    Array.from({ length: n }, (_, i) => ({ state: 'Texas', employer: `E${base}-${i}`, normalizedMinSalary: base + i * 1_000, normalizedMaxSalary: base + 20_000 + i * 1_000 }));

function snapshot(): NpPaySnapshot {
    const empty = summarizeScope('none', []);
    return {
        asOf: '2026-11-25T06:00:00.000Z',
        disclosure: { disclosed: 300, total: 900 },
        atOrAbove200k: { threshold: 200_000, employers: 4, of: 40 },
        national: scopeRow({ scopeType: 'national', scope: 'United States', summary: summarizeScope('n', rows(40, 110_000)), bls: NATIONAL_BLS }),
        states: stateRows(new Map(), empty, new Map()),
        specialties: [
            scopeRow({ scopeType: 'specialty', scope: 'Dermatology', summary: summarizeScope('d', rows(6, 150_000)) }),
            scopeRow({ scopeType: 'specialty', scope: 'Family Practice', summary: summarizeScope('f', rows(12, 120_000)) }),
            scopeRow({ scopeType: 'specialty', scope: 'Pediatrics', summary: summarizeScope('p', rows(3, 200_000)) }),
        ],
        workModes: [
            scopeRow({ scopeType: 'work_mode', scope: 'Remote', summary: summarizeScope('r', rows(5, 115_000)) }),
            scopeRow({ scopeType: 'work_mode', scope: 'On site', summary: summarizeScope('o', rows(9, 125_000)) }),
        ],
        employmentTypes: [],
        experience: [],
    };
}

const BANNED = /\bearn|average|[–—]/i;

describe('salary guide FAQ', () => {
    it('every answer, with or without live data, avoids "earn", "average" and dashes', () => {
        for (const snap of [null, snapshot()]) {
            const faqs = buildHubFaqs(snap);
            expect(faqs.length).toBeGreaterThanOrEqual(9);
            for (const { q, a } of faqs) {
                expect(a, q).not.toMatch(BANNED);
                expect(q).not.toMatch(/average|\bearn/i);
                expect(a, q).not.toMatch(/\$0\b|NaN|undefined|null/);
            }
        }
    });

    it('asks the questions the SERP asks, once each', () => {
        const questions = buildHubFaqs(null).map((f) => f.q);
        expect(new Set(questions).size).toBe(questions.length);
        for (const q of ['highest paying state', 'type of NP', 'PA or NP', '$200,000', 'RN or NP', 'How much do nurse practitioners make']) {
            expect(questions.some((question) => question.includes(q)), q).toBe(true);
        }
    });

    it('ranks specialties only among published scopes, with their employer counts', () => {
        const answer = highestPaidTypeAnswer(snapshot());
        // Pediatrics has 3 employers: below the median tier, never ranked.
        expect(answer).not.toContain('Pediatrics');
        expect(answer).toMatch(/Dermatology has the highest median advertised pay at \$[\d,]+ across 6 employers/);
        expect(answer).toContain('Family Practice');
        expect(answer).toContain(OCCUPATION_WAGES.nurseAnesthetists.formatted);
        expect(publishedByMedian(snapshot().specialties).map((r) => r.scope)).toEqual(['Dermatology', 'Family Practice']);
        // Without live data: no ranking, the CRNA note still cites BLS.
        expect(highestPaidTypeAnswer(null)).toContain('no ranking is published');
    });

    it('answers PA or NP from the same BLS release, with the state count it computes', () => {
        const answer = paOrNpAnswer();
        expect(answer).toContain('$135,880');
        expect(answer).toContain('$132,300');
        expect(answer).toContain(`$${((BLS_NATIONAL.pa.annualMedian.value as number) - (BLS_NATIONAL.np.annualMedian.value as number)).toLocaleString('en-US')}`);
        expect(answer).toContain(`higher in ${statesWhereNpMedianTopsPa().length} of the 50 states and DC`);
    });

    it('answers the $200,000 question from BLS, and adds the employer share only with live data', () => {
        expect(twoHundredKAnswer(null)).toContain('$174,420');
        expect(twoHundredKAnswer(null)).not.toContain('employers that disclose pay');
        expect(twoHundredKAnswer(snapshot())).toContain('4 of the 40 employers that disclose pay in live postings');
    });

    it('names the highest paying state from the BLS rows', () => {
        const [first] = topStatesByMedian(1);
        const faq = buildHubFaqs(null).find((f) => f.q.includes('highest paying state'));
        expect(faq?.a).toContain(`${first.state} had the highest median annual wage`);
        expect(buildHubFaqs(null).find((f) => f.q.includes('RN or NP'))?.a).toContain('$97,550');
    });
});
