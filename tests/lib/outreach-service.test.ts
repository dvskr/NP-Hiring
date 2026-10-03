/**
 * lib/outreach-service.ts: the cold-outreach templates switch when the
 * launch promo ends (backlog 2.1, package R1).
 *
 * Before: LAUNCH_OFFER_LINE ("Right now every job post ... is free during
 * our launch period ...") was a module-scope constant in all three
 * templates, so from 2027 every template the admin copied would still pitch
 * free posting, and the freeOffer template had nothing true left to say.
 *
 * After, decided per render at `now`:
 *   promo  — all three templates, each carrying the launch offer unchanged
 *   ladder — initial and followUp state the package at today's ladder price;
 *            freeOffer is no longer listed and renderTemplate refuses it with
 *            a clear OutreachTemplateUnavailableError
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { config } from '@/lib/config';
import { brand } from '@/config/brand';
import { LADDER_PRICES } from '@/lib/pricing-copy';
import {
    OUTREACH_TEMPLATE_NAMES,
    OutreachTemplateUnavailableError,
    availableOutreachTemplates,
    renderTemplate,
    type OutreachTemplateName,
} from '@/lib/outreach-service';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');
const VARS = { companyName: 'Riverside Clinic', contactName: 'Dana' };

/** The launch offer exactly as the templates printed it before this change. */
const LAUNCH_OFFER = `Right now every job post on ${brand.name} is free during our launch period through ${config.promoEndsLabel}: a ${config.durationDays}-day Featured listing with top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;
/** The same package at the ladder price, present tense. */
const LADDER_OFFER = `Every job post on ${brand.name} is a ${config.durationDays}-day Featured listing with top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. ${LADDER_PRICES}`;
/** Free posting stated as a current offer: never true once the promo is over. */
const FREE_AS_CURRENT_OFFER = /\bfree\b|launch (period|promo)|\$0\b|no credit card/i;
const DASHES = /[–—]| - /;

afterEach(() => {
    vi.useRealTimers();
});

describe('while the launch promo runs', () => {
    it('lists all three templates', () => {
        expect(availableOutreachTemplates(DURING_PROMO)).toEqual(['initial', 'followUp', 'freeOffer']);
        expect(availableOutreachTemplates(LAST_PROMO_SECOND)).toEqual([...OUTREACH_TEMPLATE_NAMES]);
    });

    it.each(OUTREACH_TEMPLATE_NAMES)('%s carries the launch offer, word for word', (name) => {
        expect(renderTemplate(name, VARS, DURING_PROMO).body).toContain(LAUNCH_OFFER);
        expect(renderTemplate(name, VARS, LAST_PROMO_SECOND).body).toContain(LAUNCH_OFFER);
    });

    it('freeOffer keeps its subject and its post-job link', () => {
        const { subject, body } = renderTemplate('freeOffer', VARS, DURING_PROMO);
        expect(subject).toBe(`Free ${brand.niche.short} job posting for Riverside Clinic`);
        expect(body).toContain(`${brand.domain}/post-job`);
    });
});

describe('from the instant the promo ends', () => {
    it('freeOffer is no longer listed', () => {
        for (const now of [LADDER_START, LATER]) {
            expect(availableOutreachTemplates(now)).toEqual(['initial', 'followUp']);
        }
    });

    it.each(['initial', 'followUp'] as const)('%s states the package at the ladder price, present tense', (name) => {
        for (const now of [LADDER_START, LATER]) {
            const { subject, body } = renderTemplate(name, VARS, now);
            expect(body).toContain(LADDER_OFFER);
            expect(`${subject}\n${body}`).not.toMatch(FREE_AS_CURRENT_OFFER);
            // Never announce a date that has already passed.
            expect(body).not.toContain(config.ladderStartsLabel);
            expect(body).not.toContain(config.promoEndsLabel);
        }
    });

    it('freeOffer is refused with an error that says why and what to use instead', () => {
        const attempt = () => renderTemplate('freeOffer', VARS, LADDER_START);
        expect(attempt).toThrow(OutreachTemplateUnavailableError);
        expect(attempt).toThrow(
            `The freeOffer template is no longer available: free posting ran through ${config.promoEndsLabel}. Use the initial or followUp template, which state the current prices.`,
        );
        try {
            attempt();
        } catch (error) {
            expect(error).toBeInstanceOf(OutreachTemplateUnavailableError);
            expect((error as OutreachTemplateUnavailableError).templateName).toBe('freeOffer');
            expect((error as Error).name).toBe('OutreachTemplateUnavailableError');
        }
    });
});

describe('the phase is decided per call, never at module load', () => {
    it('the same imported module switches on the default clock', () => {
        vi.useFakeTimers({ toFake: ['Date'] });

        vi.setSystemTime(LAST_PROMO_SECOND);
        expect(availableOutreachTemplates()).toContain('freeOffer');
        expect(renderTemplate('initial', VARS).body).toContain(LAUNCH_OFFER);
        expect(renderTemplate('freeOffer', VARS).body).toContain(LAUNCH_OFFER);

        vi.setSystemTime(LADDER_START);
        expect(availableOutreachTemplates()).not.toContain('freeOffer');
        expect(renderTemplate('initial', VARS).body).toContain(LADDER_OFFER);
        expect(() => renderTemplate('freeOffer', VARS)).toThrow(OutreachTemplateUnavailableError);
    });
});

describe('every template, either phase', () => {
    const rendered: [string, Date, OutreachTemplateName][] = [
        ['promo initial', DURING_PROMO, 'initial'],
        ['promo followUp', DURING_PROMO, 'followUp'],
        ['promo freeOffer', DURING_PROMO, 'freeOffer'],
        ['ladder initial', LATER, 'initial'],
        ['ladder followUp', LATER, 'followUp'],
    ];

    it.each(rendered)('%s: variables filled, no dashes in the copy', (_label, now, name) => {
        const { subject, body } = renderTemplate(name, VARS, now);
        expect(`${subject}\n${body}`).not.toMatch(/\{\{\w+\}\}/);
        expect(body).toContain('Hi Dana,');
        expect(`${subject}\n${body}`).not.toMatch(DASHES);
    });

    it('falls back to "there" without a contact name', () => {
        expect(renderTemplate('followUp', { companyName: 'Riverside Clinic' }, LATER).body).toContain('Hi there,');
    });
});
