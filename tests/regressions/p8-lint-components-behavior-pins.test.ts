/**
 * P8 lint-components — behavior pins for the legacy eslint-ERROR fixes.
 *
 * The P8 wave cleared every remaining eslint error in components/, app/ and
 * lib/ legacy files. The mechanical classes (next/link swaps, entity escapes,
 * prefer-const, no-explicit-any typings) are inert, but four classes were
 * behavior-sensitive and each got the repo's established fix pattern:
 *
 *  1. react-hooks/set-state-in-effect → deferred-setTimeout-with-cleanup
 *     (the GoogleAnalytics.tsx / useMirroredConsent.ts P0 pattern): the
 *     effect arms a 0ms timer instead of calling setState synchronously, and
 *     cleanup clears it. First-paint markup is unchanged (initial state
 *     already covers it), so hydration safety and SSR parity hold.
 *  2. react-hooks/purity (Date.now in render) → clock hoisted to state,
 *     seeded/rolled by timers (post-job SavedIndicator).
 *  3. react-hooks/refs (ref read in render) → state mirror for render,
 *     ref kept for once-registered window listeners (ScrollIndicator).
 *  4. react-hooks/globals (module cache reassigned in hook body) → lazy
 *     hydration hoisted to a module-scope ensureCacheHydrated() with call
 *     timing unchanged (useSavedJobs / useAppliedJobs).
 *
 * These static pins (repo style — see shell-isr-static-layout.test.ts) keep
 * the load-bearing halves of each rewrite from being silently dropped:
 * every deferred timer MUST keep its cleanup, the ApplyButton latch MUST
 * stay inside the timer callback, the analytics spinner timer MUST be
 * cleared in `finally`, and no render path may regrow Date.now() or a
 * ref read.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. deferred-setTimeout-with-cleanup adopters ────────────────────────────
// Each entry: [file, a snippet that proves the deferred arm, a snippet that
// proves the cleanup]. The arm and its clearTimeout are a matched pair — if
// either disappears the fix regressed (sync setState back in the effect, or
// a leaked timer firing after unmount).
const DEFERRED: Array<[rel: string, arm: RegExp, cleanup: RegExp]> = [
    [
        'components/SaveJobButton.tsx',
        /const arm = setTimeout\(\(\) => setMounted\(true\), 0\)/,
        /return \(\) => clearTimeout\(arm\)/,
    ],
    [
        'components/FeaturedJobs.tsx',
        /const arm = setTimeout\(\(\) => setMounted\(true\), 0\)/,
        /return \(\) => clearTimeout\(arm\)/,
    ],
    [
        'app/do-not-sell/page.tsx',
        /const arm = setTimeout\(\(\) => setGpcActive\(getPrivacySignal\(\) !== null\), 0\)/,
        /return \(\) => clearTimeout\(arm\)/,
    ],
    [
        'components/CookieConsent.tsx',
        /const arm = setTimeout\(evaluate, 0\)/,
        /clearTimeout\(arm\);/,
    ],
    [
        'components/Header.tsx',
        /const close = setTimeout\(\(\) => setIsMenuOpen\(false\), 0\)/,
        /return \(\) => clearTimeout\(close\)/,
    ],
    [
        'components/ScreeningQuestionsBuilder.tsx',
        /const hydrate = setTimeout\(\(\) => \{/,
        /return \(\) => clearTimeout\(hydrate\)/,
    ],
    [
        'components/employer/SavedCandidatesTab.tsx',
        /const kickoff = setTimeout\(\(\) => \{ fetchSaved\(\); \}, 0\)/,
        /return \(\) => clearTimeout\(kickoff\)/,
    ],
    [
        'lib/hooks/useLocalStorage.ts',
        /const arm = setTimeout\(\(\) => setIsHydrated\(true\), 0\)/,
        /return \(\) => clearTimeout\(arm\)/,
    ],
];

describe('P8 — deferred set-state-in-effect pattern stays armed AND cleaned up', () => {
    it.each(DEFERRED.map(([rel]) => rel))('%s', (rel) => {
        const [, arm, cleanup] = DEFERRED.find(([r]) => r === rel)!;
        const src = read(rel);
        expect(src).toMatch(arm);
        expect(src).toMatch(cleanup);
    });

    it('SaveJobButton still derives isSaved behind the mount gate (hydration parity)', () => {
        const src = read('components/SaveJobButton.tsx');
        expect(src).toContain('const isSaved = mounted && isJobSaved(jobId)');
    });

    it('CookieConsent keeps the reopen listener cleanup beside the timer cleanup', () => {
        const src = read('components/CookieConsent.tsx');
        // Both teardown halves must live in the same cleanup function.
        expect(src).toMatch(
            /return \(\) => \{\s*clearTimeout\(arm\);\s*window\.removeEventListener\(CONSENT_REOPEN_EVENT, onReopen\);\s*\};/,
        );
    });
});

// ── 2. EmployerAnalyticsClient — spinner timer can never stick ─────────────
describe('P8 — employer analytics deferred spinner', () => {
    const src = read('app/employer/analytics/EmployerAnalyticsClient.tsx');

    it('arms the loading flip on a timer instead of a sync setState', () => {
        expect(src).toMatch(/const arm = setTimeout\(\(\) => setLoading\(true\), 0\)/);
        // The old sync call must not come back as effect-body code.
        expect(src).not.toMatch(/cancelled = false;\s*setLoading\(true\);/);
    });

    it('clears the timer in BOTH finally and cleanup (stuck-spinner guard)', () => {
        // finally: a fetch that resolves before the 0ms timer fires must
        // cancel the pending setLoading(true) or the spinner never clears.
        expect(src).toMatch(/\.finally\(\(\) => \{\s*clearTimeout\(arm\);\s*if \(!cancelled\) setLoading\(false\);/);
        // cleanup: days-change re-runs and unmounts must cancel it too.
        expect(src).toMatch(/return \(\) => \{\s*cancelled = true;\s*clearTimeout\(arm\);\s*\};/);
    });
});

// ── 3. ApplyButton — auto-open latch moved inside the timer ────────────────
describe('P8 — ApplyButton ?apply=1 auto-open', () => {
    const src = read('components/ApplyButton.tsx');

    it('sets the once-per-mount latch inside the deferred callback', () => {
        // Latching before arming the timer + clearing on cleanup would let a
        // dep re-run (or StrictMode double-invoke) cancel the open while the
        // latch blocks every retry — the popup would silently never open.
        expect(src).toMatch(
            /const open = setTimeout\(\(\) => \{\s*autoOpened\.current = true;\s*if \(!authed\) \{\s*setShowAuthModal\(true\);\s*\} else \{\s*setShowPlatformApply\(true\);\s*\}\s*\}, 0\);/,
        );
        expect(src).toMatch(/return \(\) => clearTimeout\(open\)/);
    });

    it('keeps the auth-resolution guard ahead of the open (F26)', () => {
        const guardIdx = src.indexOf('if (!authResolved) return;');
        const openIdx = src.indexOf('const open = setTimeout');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(openIdx).toBeGreaterThan(guardIdx);
    });
});

// ── 4. post-job SavedIndicator — render stays pure ─────────────────────────
describe('P8 — SavedIndicator clock lives in state, not render', () => {
    const src = read('app/post-job/page.tsx');

    it('label computes from the `now` state with a null clamp', () => {
        expect(src).toContain("const [now, setNow] = useState<number | null>(null)");
        expect(src).toMatch(/now === null \? 0 : Math\.floor\(\(now - lastSavedAt\.getTime\(\)\) \/ 1000\)/);
    });

    it('Date.now() never runs inside the label IIFE (render path)', () => {
        const start = src.indexOf('const label = (() => {');
        expect(start).toBeGreaterThan(-1);
        const end = src.indexOf('})();', start);
        expect(end).toBeGreaterThan(start);
        expect(src.slice(start, end)).not.toContain('Date.now');
    });

    it('the clock is seeded deferred and rolled every 30s, both torn down', () => {
        expect(src).toMatch(/const seed = setTimeout\(\(\) => setNow\(Date\.now\(\)\), 0\)/);
        expect(src).toMatch(/const id = setInterval\(\(\) => setNow\(Date\.now\(\)\), 30_000\)/);
        expect(src).toMatch(/clearTimeout\(seed\);\s*clearInterval\(id\);/);
    });
});

// ── 5. ScrollIndicator — ref mirrored to state for render ──────────────────
describe('P8 — ScrollIndicator drag transition reads state', () => {
    const src = read('components/ScrollIndicator.tsx');

    it('render styles branch on isDragging state, never on the ref', () => {
        expect(src).toMatch(/transition:\s*isDragging\s*\?\s*'none'/);
        // The JSX must not read the ref (only handlers/effects may). The
        // component's JSX return is the LAST `return (` in the file — the
        // earlier matches are effect-cleanup `return () => {` closures.
        const jsxStart = src.lastIndexOf('return (');
        expect(src.slice(jsxStart)).not.toContain('draggingRef.current');
    });

    it('mousedown and mouseup keep ref and state in lockstep', () => {
        expect(src).toMatch(/draggingRef\.current = true;\s*setIsDragging\(true\);/);
        expect(src).toMatch(/draggingRef\.current = false;\s*setIsDragging\(false\);/);
    });
});

// ── 6. module-cache hooks — hydration hoisted out of the hook body ─────────
describe('P8 — useSavedJobs / useAppliedJobs cache hydration', () => {
    const HOOKS = ['lib/hooks/useSavedJobs.ts', 'lib/hooks/useAppliedJobs.ts'] as const;

    it.each([...HOOKS])('%s hydrates via the module-scope helper', (rel) => {
        const src = read(rel);
        expect(src).toMatch(/function ensureCacheHydrated\(\): void \{/);
        // The helper still carries the exact original semantics…
        expect(src).toMatch(
            /if \(cachedMap === null && typeof window !== 'undefined'\) \{\s*cachedMap = getStored(?:Saved|Applied)Jobs\(\);\s*\}/,
        );
        // …and the hook body calls it instead of reassigning the global.
        const hookStart = src.indexOf('export default function');
        expect(hookStart).toBeGreaterThan(-1);
        const hookBody = src.slice(hookStart);
        expect(hookBody).toContain('ensureCacheHydrated();');
        expect(hookBody).not.toMatch(/cachedMap = getStored/);
    });
});

// ── 7. useLocalStorage — memoization deps stay analyzable ──────────────────
describe('P8 — useLocalStorage setValue memoization', () => {
    const src = read('lib/hooks/useLocalStorage.ts');

    it('closes over the destructured primitive, not the options object', () => {
        expect(src).toContain('const expiryDays = options?.expiryDays;');
        expect(src).toMatch(/\}, \[key, expiryDays\]\);/);
        // Inside the callback the object must not be touched — that is what
        // broke react-hooks/preserve-manual-memoization.
        const cbStart = src.indexOf('const setValue = useCallback');
        const cbEnd = src.indexOf('}, [key, expiryDays]);', cbStart);
        expect(cbStart).toBeGreaterThan(-1);
        expect(cbEnd).toBeGreaterThan(cbStart);
        expect(src.slice(cbStart, cbEnd)).not.toContain('options?.expiryDays');
    });
});
