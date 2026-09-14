/**
 * P10 not-found-status regressions (survivors of re-verification round 2).
 *
 *   1. A quarantined job detail URL (/jobs/<slug>-<uuid> whose row fails the
 *      profession quarantine) answered HTTP 200 with the "Page Not Found"
 *      template, cached s-maxage=3600. The round 1 fix put notFound() in
 *      app/jobs/[slug]/page.tsx, but that route streams behind loading.tsx,
 *      so the status is committed before getJob() rules. Middleware now 410s
 *      the row with the page's own GLOBAL_EXCLUSIONS predicate.
 *   2. /jobs/city/notacity-zz answered 404 with the bare __next_error__ shell.
 *      Middleware now rules on the city hub with the page's own parse, metro
 *      redirect, ambiguous-slug resolution and MIN_JOBS gate, and rewrites a
 *      known not-found to an unroutable path so app/not-found.tsx renders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    CITY_GATE_FETCH_LIMIT,
    CITY_HUB_MIN_JOBS,
    LISTING_GATE_SELECT,
    NOT_FOUND_REWRITE_PATH,
    QUARANTINE_EVALUABLE,
    cityGateLookup,
    cityGateVerdict,
    parseCityHubSlug,
    passesListingQuarantine,
    type ListingGateRow,
} from '@/lib/pseo/listing-gates-edge';
import { CODE_TO_STATE } from '@/lib/pseo/setting-state-config';
import { getAllMetroSlugs } from '@/lib/metro-data';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const row = (title: string, professionClass: string | null, employer = 'Acme Health'): ListingGateRow => ({
    title,
    employer,
    profession_class: professionClass,
});

const NP_ROW = row('Psychiatric Mental Health Nurse Practitioner (PMHNP)', 'np_eligible', 'Mindful Psychiatry');
const METRO = new Set(getAllMetroSlugs());
const isMetro = (s: string) => METRO.has(s);

describe('1. job detail: the profession quarantine is ruled in middleware', () => {
    it('every GLOBAL_EXCLUSIONS clause is evaluable from the selected columns', () => {
        expect(QUARANTINE_EVALUABLE).toBe(true);
        expect(LISTING_GATE_SELECT.split(',').sort()).toEqual(['employer', 'profession_class', 'title']);
    });

    it('rejects a classified non-NP row (the Podiatrist probe)', () => {
        expect(passesListingQuarantine(row('Podiatrist (DPM)', 'other_clinical'))).toBe(false);
    });

    it('rejects an unclassified physician-only title (professionClass NULL)', () => {
        expect(passesListingQuarantine(row('Psychiatrist Outpatient', null))).toBe(false);
    });

    it('passes an NP row, classified or not', () => {
        expect(passesListingQuarantine(NP_ROW)).toBe(true);
        expect(passesListingQuarantine({ ...NP_ROW, profession_class: null })).toBe(true);
    });

    const mw = read('middleware.ts');
    const code = mw.replace(/\r\n/g, '\n');

    it('the job gate selects the quarantine columns and 410s a failing row', () => {
        expect(code).toContain('select=id,is_published,expires_at,${LISTING_GATE_SELECT}');
        expect(code).toMatch(/passesListingQuarantine\(row\) === false\)\s*\{\s*cacheLookupSet\(cacheKey, true, 'quarantined'\);\s*return quarantinedJob410\(\);/);
    });

    it('a cached quarantine ruling serves the same Not Listed copy', () => {
        expect(code).toContain("cached.reason === 'quarantined' ? quarantinedJob410() : removedJob410()");
    });

    it('the 410 copy is honest and carries no em or en dash', () => {
        const start = mw.indexOf('function quarantinedJob410');
        expect(start).toBeGreaterThan(-1);
        const body = mw.slice(start, mw.indexOf('function notFoundRewrite', start));
        expect(body).toContain('Not Listed');
        expect(body).not.toMatch(/removed|filled/i);
        expect(body).not.toMatch(/[–—]/);
    });
});

describe('2. city hub: known not-found URLs render the branded 404', () => {
    const pageSrc = read('app/jobs/city/[slug]/page.tsx');

    it('the MIN_JOBS mirror matches the page literal', () => {
        const literal = pageSrc.match(/const MIN_JOBS = (\d+);/);
        expect(literal).not.toBeNull();
        expect(CITY_HUB_MIN_JOBS).toBe(Number(literal![1]));
    });

    it("the page's state-code map is the one the edge parser uses", () => {
        const block = pageSrc.match(/const STATE_CODES: Record<string, string> = \{([\s\S]*?)\};/);
        expect(block).not.toBeNull();
        const pairs = [...block![1].matchAll(/'([^']+)':\s*'([A-Z]{2})'/g)].map(([, name, c]) => [c, name]);
        expect(Object.fromEntries(pairs)).toEqual(CODE_TO_STATE);
    });

    it('parses exactly like the page (regex, state validation, title casing)', () => {
        expect(parseCityHubSlug('new-york-ny')).toEqual({ cityName: 'New York', stateName: 'New York', stateCode: 'NY' });
        expect(parseCityHubSlug('notacity-zz')).toBeNull();
        expect(parseCityHubSlug('nostatecode')).toBeNull();
        expect(parseCityHubSlug('santa-fe')).toBeNull();
    });

    it('builds an ambiguous lookup for a slug with no valid state suffix', () => {
        const lookup = cityGateLookup('notacity-zz', isMetro);
        expect(lookup?.kind).toBe('ambiguous');
        expect(lookup?.query).toContain('city=ilike.Notacity%20Zz');
        expect(lookup?.query).toContain('state_code=not.is.null');
        expect(lookup?.query).toContain('is_published=eq.true');
        expect(lookup?.query).toContain(`limit=${CITY_GATE_FETCH_LIMIT}`);
    });

    it('builds a hub lookup matching the page count predicate (city AND (state OR state code))', () => {
        expect(isMetro('fond-du-lac-wi')).toBe(false);
        const lookup = cityGateLookup('fond-du-lac-wi', isMetro);
        expect(lookup?.kind).toBe('hub');
        expect(decodeURIComponent(lookup!.query)).toContain('city=ilike.Fond Du Lac');
        expect(decodeURIComponent(lookup!.query)).toContain('or=(state.eq."Wisconsin",state_code.eq.WI)');
    });

    it('stands down for metro slugs and slugs outside the canonical alphabet', () => {
        const metro = getAllMetroSlugs()[0];
        expect(metro).toBeTruthy();
        expect(cityGateLookup(metro, isMetro)).toBeNull();
        expect(cityGateLookup('st.-louis-mo', isMetro)).toBeNull();
        expect(cityGateLookup('austin%2A-tx', isMetro)).toBeNull();
    });

    it('rules not-found only on complete evidence the page would 404 on', () => {
        const ambiguous = cityGateLookup('notacity-zz', isMetro)!;
        const hub = cityGateLookup('austin-tx', isMetro)!;
        const quarantined = row('Podiatrist (DPM)', 'other_clinical');

        expect(cityGateVerdict(ambiguous, [])).toBe('not-found');
        expect(cityGateVerdict(ambiguous, [quarantined])).toBe('not-found');
        expect(cityGateVerdict(ambiguous, [NP_ROW])).toBe('pass');

        expect(cityGateVerdict(hub, [NP_ROW, NP_ROW])).toBe('not-found');
        expect(cityGateVerdict(hub, [NP_ROW, NP_ROW, quarantined])).toBe('not-found');
        expect(cityGateVerdict(hub, [NP_ROW, NP_ROW, NP_ROW])).toBe('pass');

        // A full page of rows is not proof of absence.
        const full = Array.from({ length: CITY_GATE_FETCH_LIMIT }, () => quarantined);
        expect(cityGateVerdict(hub, full)).toBe('pass');
        expect(cityGateVerdict(ambiguous, full)).toBe('pass');
    });

    it('the rewrite target can never be routed', () => {
        expect(NOT_FOUND_REWRITE_PATH.startsWith('/_')).toBe(true);
        expect(NOT_FOUND_REWRITE_PATH.startsWith('/_next')).toBe(false);
        const appDirs = fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })
            .filter((d) => d.isDirectory()).map((d) => d.name);
        // No root-level dynamic or catch-all segment may swallow the target.
        expect(appDirs.filter((d) => d.startsWith('['))).toEqual([]);
    });

    const code = read('middleware.ts');

    it('middleware rules on /jobs/city/{slug} and rewrites before the session refresh', () => {
        expect(code).toMatch(/segs\[1\] === 'city'[^\n]*\)\s*\{\s*cityNotFound = await isKnownCityHubNotFound\(segs\[2\]\);/);
        const rewriteIdx = code.indexOf('return notFoundRewrite(request, cspHeader);');
        expect(rewriteIdx).toBeGreaterThan(-1);
        expect(rewriteIdx).toBeLessThan(code.indexOf('await updateSession(request)'));
    });

    it('a failed or unconfigured city lookup lets the page render (never a guessed 404)', () => {
        const start = code.indexOf('async function isKnownCityHubNotFound');
        const body = code.slice(start, code.indexOf('\nfunction unavailable503', start));
        expect(body).toMatch(/if \(!res\.ok\) \{[\s\S]*?return false;/);
        expect(body).toMatch(/catch \(err\) \{[\s\S]*?return false;/);
        expect(body).not.toContain('unavailable503');
    });
});
