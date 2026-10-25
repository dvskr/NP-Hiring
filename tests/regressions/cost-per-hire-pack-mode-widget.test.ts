/**
 * The cost-per-hire calculator, opened on the 5-post pack (2027 re-price,
 * phase 3; plan section 3.10).
 *
 * The widget states the pack mix the model priced in its result line: the
 * packs, the intro post bought before them when that costs less, the posts
 * at the posting price, and each renewal at the price it is charged. The
 * intro price box is offered in pack mode too, because a pack uses up the
 * domain's intro price and the intro post is bought first.
 *
 * The suite has no DOM, so the widget mounts on the inputs a reader would
 * have entered: defaultInputs is mocked to return them.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const inputs = vi.hoisted(() => ({ roles: 6, useIntroPrice: true, renewalsPerRole: 0 }));
vi.mock('@/components/tools/cost-per-hire-model', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/tools/cost-per-hire-model')>();
    return {
        ...actual,
        defaultInputs: (phase: 'promo' | 'ladder') => ({ ...actual.defaultInputs(phase), flatFeeMode: 'pack' as const, ...inputs }),
    };
});

import { config } from '@/lib/config';
import EmployerCostPerHireCalculator from '@/components/tools/EmployerCostPerHireCalculator';

const visibleText = (markup: string): string =>
    markup
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');

const usd = (amount: number): string => `$${amount.toLocaleString('en-US')}`;
const render = (phase: 'promo' | 'ladder'): string =>
    renderToStaticMarkup(React.createElement(EmployerCostPerHireCalculator, { phase }));

describe('cost-per-hire calculator: the 5-post pack mode', () => {
    it('shows the pack selected, in both phases', () => {
        expect(render('ladder')).toContain(`<option value="pack" selected="">${config.packPosts}-post pack</option>`);
        expect(render('promo')).toContain(`<option value="pack" selected="">${config.packPosts}-post pack, from ${config.ladderStartsLabel}</option>`);
    });

    it('states the mix it priced: six roles are the intro post and one pack', () => {
        Object.assign(inputs, { roles: config.packPosts + 1, useIntroPrice: true, renewalsPerRole: 0 });
        const text = visibleText(render('ladder'));
        const total = config.introPrice + config.packPrice;
        expect(text).toContain(`1 pack of ${config.packPosts} posts at ${usd(config.packPrice)}, 1 intro post at ${usd(config.introPrice)} and 0 renewals at ${usd(config.renewalPrice)}, for a total of ${usd(total)}`);
    });

    it('names the posts at the posting price and splits the renewals by the price each is charged', () => {
        Object.assign(inputs, { roles: config.packPosts + 1, useIntroPrice: false, renewalsPerRole: 1 });
        const text = visibleText(render('ladder'));
        const total = config.packPrice + config.postingPrice + config.packPosts * config.renewalPrice + config.proRenewalPrice;
        expect(text).toContain(
            `1 pack of ${config.packPosts} posts at ${usd(config.packPrice)}, 1 post at ${usd(config.postingPrice)} and ${config.packPosts + 1} renewals (${config.packPosts} at ${usd(config.renewalPrice)}, 1 at ${usd(config.proRenewalPrice)}), for a total of ${usd(total)}`,
        );
    });

    it('offers the intro price box in pack mode, since the intro post is bought before any pack', () => {
        Object.assign(inputs, { roles: config.packPosts + 1, useIntroPrice: true, renewalsPerRole: 0 });
        expect(render('ladder')).toContain('id="cph-intro-price"');
    });

    it('states the pack price beside the post prices, never a saving', () => {
        const text = visibleText(render('ladder'));
        expect(text).toContain(`or buy ${config.packPosts} posts for ${usd(config.packPrice)}.`);
        expect(text).not.toMatch(/\bsav(?:e|es|ing)\b|\$500|discount/i);
    });
});
