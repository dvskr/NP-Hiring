/**
 * P7 runtime fix D1 (CRITICAL) — the CSP must never carry a per-request nonce.
 *
 * ~164 routes are prerendered/ISR: their HTML is generated at build/revalidate
 * time and served from cache, with nonce-less inline RSC flight scripts
 * (`self.__next_f.push(...)`) baked in. A fresh per-request nonce in the CSP
 * header can never match scripts inside cached static HTML — and per the CSP
 * spec, the mere PRESENCE of a nonce (or hash) makes browsers ignore
 * 'unsafe-inline'. Runtime-verified result of the old nonce CSP: 48 "Refused
 * to execute inline script" violations on /pricing, an uncaught
 * "Error: Connection closed." pageerror on every x-nextjs-cache:HIT page, and
 * ZERO hydration — every client component (1099 calculator, specialty quiz,
 * all interactivity) was inert on every static page.
 *
 * The fix: 'self' + 'unsafe-inline' + explicit host allowlist, no nonce, no
 * hash, no 'strict-dynamic' (strict-dynamic would also disable the host
 * allowlist AND ignore unsafe-inline). These tests pin that shape.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mw = read('middleware.ts');

/** Only lines that build CSP values / code — strip // comments so prose
 * explaining the old nonce design can't mask (or trip) the guards. */
const mwCode = mw
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

describe('D1 — CSP carries no nonce (nonces can never match cached static HTML)', () => {
    it('middleware code no longer generates or interpolates a nonce', () => {
        // The old block: const nonce = Buffer.from(crypto.randomUUID())...
        expect(mwCode).not.toMatch(/\bconst nonce\b/);
        expect(mwCode).not.toMatch(/nonce-\$\{/);
        // No hash-source either — the flight payload differs per page and per
        // revalidation, and middleware never sees the HTML it would hash.
        expect(mwCode).not.toMatch(/'sha(256|384|512)-/);
    });

    it("script-src and script-src-elem both allow 'self' + 'unsafe-inline'", () => {
        const scriptSrc = mwCode.match(/"script-src '([^"]*)"/);
        const scriptSrcElem = mwCode.match(/"script-src-elem ([^"]*)"/);
        expect(scriptSrc).not.toBeNull();
        expect(scriptSrcElem).not.toBeNull();
        for (const directive of [scriptSrc![0], scriptSrcElem![0]]) {
            expect(directive).toContain("'self'");
            expect(directive).toContain("'unsafe-inline'");
            expect(directive).not.toContain('nonce');
        }
    });

    it("no 'strict-dynamic' (it would void both the host allowlist and 'unsafe-inline')", () => {
        expect(mwCode).not.toContain("'strict-dynamic'");
    });

    it('the third-party script host allowlist survives (residual XSS containment)', () => {
        // With 'unsafe-inline' the allowlist is what still blocks injected
        // third-party script SOURCES. Losing it silently would widen the gap.
        const scriptDirectives = mwCode
            .split('\n')
            .filter((l) => l.includes('script-src'));
        expect(scriptDirectives.length).toBeGreaterThanOrEqual(2);
        for (const line of scriptDirectives) {
            expect(line).toContain('https://www.googletagmanager.com');
            expect(line).toContain('https://js.stripe.com');
            // Allowlist means: no blanket https: / * source.
            expect(line).not.toMatch(/\shttps:\s/);
            expect(line).not.toMatch(/\s\*\s/);
        }
    });

    it('the nonce is not forwarded to the app via an x-nonce request header (ISR fix F5)', () => {
        // headers()-reading of x-nonce in the root layout is what once opted
        // every route into dynamic rendering and killed ISR.
        expect(mwCode).not.toMatch(/x-nonce/i);
        expect(read('app/layout.tsx')).not.toMatch(/x-nonce/i);
    });

    it('object-src stays none and base-uri stays self (inline-script gap containment)', () => {
        expect(mwCode).toContain('"object-src \'none\'"');
        expect(mwCode).toContain('"base-uri \'self\'"');
    });
});
