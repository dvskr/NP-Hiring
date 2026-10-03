/**
 * lib/hooks/useRerenderAtPromoEnd.ts: an employer surface left open over
 * config.promoEndsAt gets a render at that instant.
 *
 * The employer app decides the promo phase while it renders, so its copy is
 * only as fresh as its last render, and nothing caused one at the boundary:
 * a preview opened at 09:55Z on 2027-01-01 still read "Free through December
 * 31, 2026" at 10:05Z, and a page restored from the back/forward cache kept
 * the render it was frozen with.
 *
 * Pinned:
 *   - the subscription tells React once, at the first check that finds the
 *     promo over: at the boundary by timer, or when the page is shown again
 *     (pageshow) or its tab becomes visible again (visibilitychange) after
 *     the boundary passed with the timer not running;
 *   - the timer never asks setTimeout for more than its 32-bit limit (a
 *     longer delay fires at once) and is set again until the boundary;
 *   - the end itself, and unsubscribing, leave no timer and no listener;
 *   - the hook renders on the server, where nothing subscribes;
 *   - every employer surface that decides the phase while rendering calls it
 *     where a hook may be called.
 *
 * vitest runs in node and renderToStaticMarkup runs no effect, so the
 * subscription is driven directly, with EventTargets standing in for window
 * and document. That is the half of useSyncExternalStore this repo owns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { config } from '@/lib/config';
import { MAX_TIMER_DELAY_MS, subscribeToPromoEnd, useRerenderAtPromoEnd } from '@/lib/hooks/useRerenderAtPromoEnd';

const PROMO_END_MS = Date.parse(config.promoEndsAt);
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('subscribeToPromoEnd', () => {
    /** Stand-ins for window and document: the subscription only listens on them. */
    let page: EventTarget;
    let tab: EventTarget;
    const showPage = (): boolean => page.dispatchEvent(new Event('pageshow'));
    const showTab = (): boolean => tab.dispatchEvent(new Event('visibilitychange'));

    beforeEach(() => {
        vi.useFakeTimers();
        page = new EventTarget();
        tab = new EventTarget();
        vi.stubGlobal('window', page);
        vi.stubGlobal('document', tab);
    });

    it('tells React at the instant the promo ends, and not a millisecond before', () => {
        vi.setSystemTime(PROMO_END_MS - 5 * MINUTE_MS);
        const onPromoEnd = vi.fn();
        subscribeToPromoEnd(onPromoEnd);

        vi.advanceTimersByTime(5 * MINUTE_MS - 1);
        expect(config.isPromoActive()).toBe(true);
        expect(onPromoEnd).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(config.isPromoActive()).toBe(false);
        expect(onPromoEnd).toHaveBeenCalledTimes(1);
    });

    it('never waits longer than setTimeout can count, and sets the timer again until the boundary', () => {
        // 91 days out, as a dashboard opened in early October is. One timer
        // cannot span that: a delay over the limit fires at once.
        const total = 91 * DAY_MS;
        expect(total).toBeGreaterThan(MAX_TIMER_DELAY_MS);
        vi.setSystemTime(PROMO_END_MS - total);
        const onPromoEnd = vi.fn();
        subscribeToPromoEnd(onPromoEnd);

        // Each wait, read off the clock as the pending timer fires.
        const waits: number[] = [];
        while (vi.getTimerCount() > 0 && waits.length < 10) {
            const armedAt = Date.now();
            expect(onPromoEnd).not.toHaveBeenCalled();
            vi.advanceTimersToNextTimer();
            waits.push(Date.now() - armedAt);
        }

        expect(waits).toHaveLength(Math.ceil(total / MAX_TIMER_DELAY_MS));
        expect(Math.max(...waits)).toBe(MAX_TIMER_DELAY_MS);
        expect(waits.reduce((sum, wait) => sum + wait, 0)).toBe(total);
        expect(Date.now()).toBe(PROMO_END_MS);
        expect(onPromoEnd).toHaveBeenCalledTimes(1);
    });

    it.each<[string, () => boolean]>([
        ['the page is shown again, as after a back/forward cache restore', showPage],
        ['its tab becomes visible again', showTab],
    ])('re-reads the phase when %s, the boundary having passed with the timer frozen', (_label, show) => {
        vi.setSystemTime(PROMO_END_MS - 5 * MINUTE_MS);
        const onPromoEnd = vi.fn();
        subscribeToPromoEnd(onPromoEnd);

        // The wall clock moves on while the page is frozen or the device
        // sleeps; the timer has not fired.
        vi.setSystemTime(PROMO_END_MS + 5 * MINUTE_MS);
        expect(onPromoEnd).not.toHaveBeenCalled();

        show();

        expect(onPromoEnd).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a show before the boundary tells React nothing and aims the one timer at the boundary again', () => {
        vi.setSystemTime(PROMO_END_MS - 10 * MINUTE_MS);
        const onPromoEnd = vi.fn();
        subscribeToPromoEnd(onPromoEnd);

        // Eight minutes pass with the timer frozen, so it would now fire
        // eight minutes late.
        vi.setSystemTime(PROMO_END_MS - 2 * MINUTE_MS);
        showPage();
        showTab();

        expect(onPromoEnd).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(2 * MINUTE_MS - 1);
        expect(onPromoEnd).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onPromoEnd).toHaveBeenCalledTimes(1);
    });

    it('stops watching once the promo has ended: the phase never goes back', () => {
        vi.setSystemTime(PROMO_END_MS - MINUTE_MS);
        const onPromoEnd = vi.fn();
        subscribeToPromoEnd(onPromoEnd);
        vi.advanceTimersByTime(MINUTE_MS);
        expect(onPromoEnd).toHaveBeenCalledTimes(1);

        showPage();
        showTab();
        vi.advanceTimersByTime(DAY_MS);

        expect(onPromoEnd).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('unsubscribing clears the timer and both listeners', () => {
        vi.setSystemTime(PROMO_END_MS - MINUTE_MS);
        const onPromoEnd = vi.fn();
        const unsubscribe = subscribeToPromoEnd(onPromoEnd);
        expect(vi.getTimerCount()).toBe(1);

        unsubscribe();

        expect(vi.getTimerCount()).toBe(0);
        vi.setSystemTime(PROMO_END_MS + MINUTE_MS);
        showPage();
        showTab();
        expect(onPromoEnd).not.toHaveBeenCalled();
    });

    it('has nothing to watch when the component mounts after the promo ended', () => {
        vi.setSystemTime(PROMO_END_MS);
        const listening = [vi.spyOn(page, 'addEventListener'), vi.spyOn(tab, 'addEventListener')];
        const onPromoEnd = vi.fn();

        const unsubscribe = subscribeToPromoEnd(onPromoEnd);

        expect(vi.getTimerCount()).toBe(0);
        for (const spy of listening) expect(spy).not.toHaveBeenCalled();
        showPage();
        showTab();
        expect(onPromoEnd).not.toHaveBeenCalled();
        expect(unsubscribe).not.toThrow();
    });
});

describe('useRerenderAtPromoEnd', () => {
    it('renders on the server in both phases, where there is no window to subscribe to', () => {
        const Probe = (): React.ReactElement => {
            useRerenderAtPromoEnd();
            return React.createElement('p', null, config.isPromoActive() ? 'promo' : 'ladder');
        };
        vi.useFakeTimers({ toFake: ['Date'] });

        vi.setSystemTime(PROMO_END_MS - 1);
        expect(renderToStaticMarkup(React.createElement(Probe))).toBe('<p>promo</p>');
        vi.setSystemTime(PROMO_END_MS);
        expect(renderToStaticMarkup(React.createElement(Probe))).toBe('<p>ladder</p>');
        expect(typeof window).toBe('undefined');
    });
});

describe('every employer surface that decides the phase while rendering calls the hook', () => {
    const SURFACES = [
        'app/post-job/page.tsx',
        'app/post-job/preview/page.tsx',
        'app/post-job/checkout/page.tsx',
        'components/employer/UsageWidget.tsx',
        'components/employer/CandidateProfileClient.tsx',
        'components/employer/EmployerDashboardClient.tsx',
        'app/jobs/edit/[token]/page.tsx',
    ];
    /** What makes a surface one of these: it reads the promo phase from the clock as it renders. */
    const DECIDES_PHASE = /config\.isPromoActive\(\)|currentQuote\(|postJobPricingCopy\(\)/;
    const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

    /** True when the statement leaves the component: a return, or an if that returns. */
    const exitsComponent = (statement: ts.Statement): boolean => {
        if (ts.isReturnStatement(statement)) return true;
        if (!ts.isIfStatement(statement)) return false;
        const returns = (branch: ts.Statement | undefined): boolean =>
            branch !== undefined && (ts.isBlock(branch) ? branch.statements.some(exitsComponent) : exitsComponent(branch));
        return returns(statement.thenStatement) || returns(statement.elseStatement);
    };

    it.each(SURFACES)('%s', (rel) => {
        const src = read(rel);
        expect(src).toMatch(DECIDES_PHASE);
        expect(src).toContain("import { useRerenderAtPromoEnd } from '@/lib/hooks/useRerenderAtPromoEnd';");

        const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const calls: ts.CallExpression[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && node.expression.getText(sf) === 'useRerenderAtPromoEnd') calls.push(node);
            ts.forEachChild(node, visit);
        };
        visit(sf);
        expect(calls).toHaveLength(1);

        // A hook runs on every render: a bare statement in the body of a
        // module-level component, ahead of its first early return, never in
        // a branch, a loop or a callback.
        const statement = calls[0].parent;
        expect(ts.isExpressionStatement(statement)).toBe(true);
        const body = statement.parent;
        expect(ts.isBlock(body)).toBe(true);
        expect(ts.isFunctionDeclaration(body.parent)).toBe(true);
        expect(body.parent.parent).toBe(sf);
        const statements = (body as ts.Block).statements;
        const firstExit = statements.findIndex(exitsComponent);
        expect(firstExit).toBeGreaterThan(-1);
        expect(statements.indexOf(statement as ts.Statement)).toBeLessThan(firstExit);
    });
});
