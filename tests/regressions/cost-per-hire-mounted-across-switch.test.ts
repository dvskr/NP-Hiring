/**
 * Backlog 2.1, fix round 1: a cost-per-hire calculator that is already
 * mounted when the launch promo ends stops pricing the promo.
 *
 * The widget seeds its "how you would buy from us" mode from the pricing
 * phase once, at mount (useState). The server page decides the phase per
 * render and hands it down, so a tab held open across config.promoEndsAt can
 * be handed phase 'ladder' (a soft navigation back to the page re-renders the
 * server component under the mounted client tree) while its state still
 * holds 'promo'. It then kept printing "1 free post during the launch promo
 * ... for a total of $0 ... every post is free through December 31, 2026"
 * after the promo had ended, under a select that showed "Per post": no
 * option matched 'promo', so the browser showed the first one, and picking
 * the option already shown changed nothing.
 *
 * The mode the widget prices is now derived on every render: the selected
 * one while the phase still offers it, else the phase's first way to buy
 * (offeredFlatFeeMode). The state itself is kept, so nothing the employer
 * typed is lost.
 *
 * The suite has no DOM, so the stale state is produced the way it arises:
 * the widget mounts holding the promo-phase default (defaultInputs is mocked
 * to return it whatever phase it is asked for) and is rendered with the
 * phase the server hands it afterwards.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/tools/cost-per-hire-model', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/tools/cost-per-hire-model')>();
    return {
        ...actual,
        // What a widget mounted while the promo ran still holds in state.
        defaultInputs: () => actual.defaultInputs('promo'),
    };
});

import { config } from '@/lib/config';
import EmployerCostPerHireCalculator from '@/components/tools/EmployerCostPerHireCalculator';
import {
    defaultInputs,
    flatFeeModeOptions,
    offeredFlatFeeMode,
    type FlatFeeMode,
    type PricingPhase,
} from '@/components/tools/cost-per-hire-model';

/** A post made free during the promo keeps the intro price unspent: history, allowed after it. */
const PROMO_HISTORY = /Posts made free during the launch promo do not use it up\./g;

/** The widget as the server renders it for `phase`, holding the promo-phase state. */
const render = (phase: PricingPhase): string =>
    renderToStaticMarkup(React.createElement(EmployerCostPerHireCalculator, { phase }));

/** The visible text of rendered HTML: tags dropped, entities decoded. */
const visibleText = (markup: string): string =>
    markup
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');

describe('2.1: the way to buy the calculator prices is one the phase offers', () => {
    it('keeps the selected mode while the phase offers it', () => {
        const kept: Array<[FlatFeeMode, PricingPhase]> = [
            ['promo', 'promo'],
            ['per-post', 'promo'],
            ['plan', 'promo'],
            ['per-post', 'ladder'],
            ['plan', 'ladder'],
        ];
        for (const [selected, phase] of kept) {
            expect(offeredFlatFeeMode(selected, phase), `${selected} in ${phase}`).toBe(selected);
        }
    });

    it('falls back to the phase\'s first way to buy once the promo is no longer offered', () => {
        expect(flatFeeModeOptions('ladder').map((option) => option.mode)).not.toContain('promo');
        expect(offeredFlatFeeMode('promo', 'ladder')).toBe('per-post');
        expect(offeredFlatFeeMode('promo', 'ladder')).toBe(flatFeeModeOptions('ladder')[0].mode);
    });
});

describe('2.1: a calculator mounted before the promo ended, handed the ladder phase', () => {
    it('holds the promo mode in state (the fixture reproduces the stale tab)', () => {
        expect(defaultInputs('ladder').flatFeeMode).toBe('promo');
    });

    it('shows and prices the per-post ladder, not the promo it can no longer sell', () => {
        const markup = render('ladder');
        // The select shows the mode that is priced, and the promo is not on offer.
        expect(markup).toContain('<option value="per-post" selected="">Per post</option>');
        expect(markup).not.toContain('value="promo"');
        expect(markup.match(/<option /g)).toHaveLength(2);

        const text = visibleText(markup);
        // One intro post at the real price, with the renewal field of the per-post mode.
        expect(text).toContain(`1 intro post at $${config.introPrice}`);
        expect(text).toContain(`for a total of $${config.introPrice}`);
        expect(text).toContain('Renewals per role');
        expect(text).toContain(`any channel costing more than $${config.introPrice} per hire is the more expensive option`);

        const offer = text.replace(PROMO_HISTORY, '');
        for (const pattern of [/free through/i, /free posts? during/i, /launch promo/i, /launch period/i, /\$0\b/]) {
            expect(offer, String(pattern)).not.toMatch(pattern);
        }
        expect(offer).not.toContain(config.promoEndsLabel);
        expect(offer).not.toContain(config.ladderStartsLabel);
    });

    it('still opens on the promo while the promo runs', () => {
        const markup = render('promo');
        expect(markup).toContain('<option value="promo" selected="">');
        expect(markup.match(/<option /g)).toHaveLength(3);
        const text = visibleText(markup);
        expect(text).toContain('1 free post during the launch promo');
        expect(text).toContain('That is the launch promo doing the work');
    });
});
