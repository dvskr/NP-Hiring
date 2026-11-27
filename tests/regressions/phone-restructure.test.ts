/**
 * The phone restructure the owner approved on 2026-11-27, the parts the
 * phone menu test (tests/regressions/phone-menu.test.ts) does not see:
 *   - who is signed in is found once and shared (lib/auth-role-store.ts)
 *   - the bottom bar follows the signed-in role, not the page
 *   - a signed-out page never downloads the sign in library, and the header
 *     and its menu pull in no animation library
 *   - Google Analytics loads after the page has finished loading
 *   - a split session cookie still counts as a session
 *   - long lists fold on a phone and open again on a wider screen
 *     (PhoneFold): the footer's link columns and the FAQ lists; long tables
 *     stop at ten rows
 *   - big decorative pictures are left out on a phone (app/globals.css), the
 *     contact, FAQ, privacy and terms page heroes among them, and the home
 *     page's states keep theirs only as small icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readCode } from '../helpers/source';

vi.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
// As the other footer tests do: a link renders as a plain anchor.
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
        createElement('a', { href, ...rest }, children as never),
}));

import { getAuthRole, setAuthRole, subscribeAuthRole } from '@/lib/auth-role-store';
import { bottomNavItems } from '@/components/BottomNav';
import { hasLikelyAuthCookie } from '@/lib/auth-cookie';
import { foldForPhone, PHONE_FOLD_QUERY, unfoldForWideScreen } from '@/components/PhoneFold';
import PhoneRowLimit, { PHONE_ROW_LIMIT, type PhoneRowLimitProps } from '@/components/PhoneRowLimit';
import Footer from '@/components/Footer';

const ROOT = process.cwd();
/** A file read as written, line endings normalized (for markers that live in comments). */
const raw = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('who is signed in, found once and shared', () => {
    it('is not known at first, then each change is told to every listener once', () => {
        expect(getAuthRole()).toBeUndefined();
        const heard: unknown[] = [];
        const stop = subscribeAuthRole(() => heard.push(getAuthRole()));
        setAuthRole(null);
        setAuthRole(null);
        setAuthRole('employer');
        stop();
        setAuthRole('job_seeker');
        expect(heard).toEqual([null, 'employer']);
        expect(getAuthRole()).toBe('job_seeker');
    });

    it('the account control reports every answer, and the menu and the bottom bar read it', () => {
        const auth = readCode('components/auth/HeaderAuth.tsx');
        expect(auth).toContain('setAuthRole(profileData.role)');
        // Signed out without a cookie, a stale cookie, a failed profile, a sign out, an error.
        expect((auth.match(/setAuthRole\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
        expect(readCode('components/PhoneMenu.tsx')).toContain('useAuthRole()');
        expect(readCode('components/BottomNav.tsx')).toContain('useAuthRole()');
    });
});

describe('the phone bottom bar follows the signed-in role, not the page', () => {
    type Role = Parameters<typeof bottomNavItems>[0];
    const labels = (role: Role, page: string) => bottomNavItems(role, page).map((item) => item.label);
    const hrefs = (role: Role, page: string) => bottomNavItems(role, page).map((item) => item.href);

    it('a signed-in employer gets the employer tabs on every page', () => {
        for (const page of ['/', '/jobs', '/salary-guide', '/employer/dashboard']) {
            expect(labels('employer', page), page).toEqual(['Home', 'Talent', 'Applicants', 'Messages']);
        }
    });

    it('a signed-in job seeker gets the seeker tabs on every page, the home page included', () => {
        for (const page of ['/', '/jobs', '/dashboard', '/employer/dashboard']) {
            expect(hrefs('job_seeker', page), page).toEqual(['/dashboard', '/jobs', '/my-applications', '/messages']);
        }
    });

    it('a signed-out visitor and an admin get the marketing tabs on every page, an employer page included', () => {
        for (const role of [null, 'admin'] as const) {
            for (const page of ['/', '/jobs', '/dashboard', '/employer/dashboard']) {
                expect(labels(role, page), `${role} ${page}`).toEqual(['Home', 'Jobs', 'Saved', 'Messages']);
            }
        }
    });

    it('before the role is known, an employer page and a seeker app page keep their own tabs, so they never flash away', () => {
        expect(labels(undefined, '/employer/dashboard')).toEqual(['Home', 'Talent', 'Applicants', 'Messages']);
        expect(hrefs(undefined, '/my-applications')).toEqual(['/dashboard', '/jobs', '/my-applications', '/messages']);
        expect(labels(undefined, '/jobs')).toEqual(['Home', 'Jobs', 'Saved', 'Messages']);
        expect(labels(undefined, '/saved')).toEqual(['Home', 'Jobs', 'Saved', 'Messages']);
    });
});

describe('what every page downloads', () => {
    it('the sign in library is loaded only for a visitor who may be signed in', () => {
        for (const file of [
            'components/auth/HeaderAuth.tsx',
            'components/auth/UserMenu.tsx',
            'components/BottomNav.tsx',
            'components/Header.tsx',
            'components/PhoneMenu.tsx',
            'components/PushNotificationPrompt.tsx',
            // Every job page and job card carries these two, and every
            // company profile the claim button.
            'components/ReportJobButton.tsx',
            'components/jobs/MessageEmployerModal.tsx',
            'app/companies/[slug]/ClaimProfileCta.tsx',
        ]) {
            expect(readCode(file), file).not.toMatch(/^import[^;]*from '@\/lib\/supabase\/client'/m);
        }
        const auth = readCode('components/auth/HeaderAuth.tsx');
        expect(auth).toContain("await import('@/lib/supabase/client')");
        expect(auth).toContain('hasLikelyAuthCookie()');
        // The push prompt (on every page through the layout) checks the cookie first.
        const push = readCode('components/PushNotificationPrompt.tsx');
        const check = push.indexOf('if (!hasLikelyAuthCookie()) return;');
        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(push.indexOf("import('@/lib/supabase/client')"));
    });

    it('the header and the phone menu draw without the animation library', () => {
        for (const file of ['components/Header.tsx', 'components/PhoneMenu.tsx']) {
            expect(readCode(file), file).not.toContain('framer-motion');
        }
    });

    it('Google Analytics loads after the page has finished loading', () => {
        const ga = readCode('components/GoogleAnalytics.tsx');
        const loader = ga.slice(ga.indexOf('googletagmanager.com/gtag/js'));
        expect(loader.slice(0, 200)).toContain('strategy="lazyOnload"');
        expect(ga).not.toContain('strategy="afterInteractive"');
    });
});

describe('a session cookie, whole or split', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        ['sb-abcd-auth-token=base64-xyz', true],
        ['theme=light; sb-abcd-auth-token.0=base64-xyz; sb-abcd-auth-token.1=more', true],
        ['sb-abcd-auth-token-code-verifier=abc', false],
        ['theme=light; consent=1', false],
        ['', false],
    ])('%j: %s', (cookie, expected) => {
        vi.stubGlobal('document', { cookie });
        expect(hasLikelyAuthCookie()).toBe(expected);
    });

    it('every component that asks who is signed in asks the one check', () => {
        for (const file of [
            'components/auth/HeaderAuth.tsx',
            'components/PushNotificationPrompt.tsx',
            'components/ReportJobButton.tsx',
            'components/jobs/MessageEmployerModal.tsx',
            'app/companies/[slug]/ClaimProfileCta.tsx',
            'lib/hooks/useSavedJobs.ts',
            'lib/hooks/useAppliedJobs.ts',
        ]) {
            const code = readCode(file);
            expect(code, file).toContain("from '@/lib/auth-cookie'");
            expect(code, file).not.toContain('function hasLikelyAuthCookie');
        }
    });
});

describe('long lists fold on a phone', () => {
    /** A details element reduced to its attributes, and a root that answers the two queries the fold asks. */
    function fakeFold(name: string, open: boolean) {
        const attributes = new Set<string>(open ? ['open'] : []);
        return {
            name,
            attributes,
            removeAttribute: (attribute: string) => attributes.delete(attribute),
            setAttribute: (attribute: string) => attributes.add(attribute),
        };
    }
    function fakeRoot(folds: ReturnType<typeof fakeFold>[]) {
        return {
            querySelectorAll: (selector: string) => {
                if (selector === 'details[data-phone-fold][open]') return folds.filter((fold) => fold.attributes.has('open'));
                if (selector === 'details[data-phone-fold][data-phone-folded]') return folds.filter((fold) => fold.attributes.has('data-phone-folded'));
                return [];
            },
        } as unknown as ParentNode;
    }

    it('closes every open fold it finds, on screens 760 pixels and narrower', () => {
        const folds = [fakeFold('footer', true), fakeFold('faq', true), fakeFold('closed by the visitor', false)];
        expect(foldForPhone(fakeRoot(folds))).toBe(2);
        expect(folds.map((fold) => fold.attributes.has('open'))).toEqual([false, false, false]);
        expect(PHONE_FOLD_QUERY).toBe('(max-width: 760px)');
    });

    it('opens again exactly what it closed when the screen grows wider (a tablet turned on its side)', () => {
        const folds = [fakeFold('footer', true), fakeFold('closed by the visitor', false)];
        foldForPhone(fakeRoot(folds));
        expect(unfoldForWideScreen(fakeRoot(folds))).toBe(1);
        expect(folds.map((fold) => fold.attributes.has('open'))).toEqual([true, false]);
        expect(folds[0].attributes.has('data-phone-folded')).toBe(false);
    });

    it('PhoneFold runs on every page with the site chrome, and listens for the screen changing width', () => {
        // Mounted once in the root layout. (The import is not read: a line
        // comment near the top of the layout names /blog/*, which
        // blankComments takes for the start of a block comment, and the type
        // check fails anyway if the component is used without it.)
        const layout = readCode('app/layout.tsx');
        expect(layout.match(/<PhoneFold \/>/g)).toHaveLength(1);
        const fold = readCode('components/PhoneFold.tsx');
        expect(fold).toContain("phone.addEventListener('change', onChange)");
        expect(fold).toContain("return () => phone.removeEventListener('change', onChange)");
    });

    it('the footer serves every link column open and marked to fold, its heading the summary inside the column', () => {
        const html = renderToStaticMarkup(createElement(Footer));
        const folds = html.match(/<details class="footer-fold" open="" data-phone-fold="">/g) ?? [];
        expect(folds.length).toBeGreaterThan(3);
        expect((html.match(/<nav aria-label="[^"]+"><details class="footer-fold"/g) ?? []).length).toBe(folds.length);
        expect((html.match(/<summary class="footer-fold-summary"><h3 /g) ?? []).length).toBe(folds.length);
        // The legal row is not a column: it never folds.
        const legal = html.slice(html.indexOf('aria-label="Legal"'));
        expect(legal).not.toContain('<details');
    });

    it('on a wide screen a footer heading looks and acts like the plain heading it was; on a phone it is a tappable row', () => {
        const footer = raw('components/Footer.tsx');
        const start = footer.indexOf('const FOOTER_FOLD_CSS = `');
        expect(start).toBeGreaterThan(-1);
        const css = footer.slice(start, footer.indexOf('`;', start));
        const wide = css.slice(0, css.indexOf('@media (max-width: 760px)'));
        const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
        expect(wide).toMatch(/\.footer-fold-summary \{[^}]*list-style: none;[^}]*pointer-events: none;/);
        expect(wide).toMatch(/\.footer-fold-summary::-webkit-details-marker \{\s*display: none;/);
        expect(wide).toMatch(/\.footer-fold-summary::marker \{\s*content: '';/);
        expect(phone).toMatch(/\.footer-fold-summary \{[^}]*min-height: 52px;[^}]*pointer-events: auto;/);
        // The single-column phone grid comes after the 480px rule, so it wins.
        const jsx = footer.slice(footer.indexOf('<style jsx>{`'));
        expect(jsx.indexOf('@media (max-width: 760px)')).toBeGreaterThan(jsx.indexOf('@media (max-width: 480px)'));
    });

    it('FAQ lists start closed on a phone: every question is marked to fold', () => {
        for (const file of [
            'components/CategoryFAQAccordion.tsx',
            'components/seo/pseo/ClayAccordion.tsx',
            'components/sticker/StickerAccordion.tsx',
            'app/jobs/state/[state]/page.tsx',
        ]) {
            expect(readCode(file), file).toMatch(/<details [^>]*open=\{(?:index|i|idx) === 0\} data-phone-fold="">/);
        }
        // The home page's questions are served closed already.
        expect(readCode('components/HomepageFAQ.tsx')).not.toMatch(/<details[^>]*\bopen\b/);
    });

    it('a long table shows ten rows on a phone, then Show all', () => {
        expect(PHONE_ROW_LIMIT).toBe(10);
        // The table goes in as createElement's third argument, as JSX passes
        // it; the props carry only the count and the noun.
        const limited = (total: number) =>
            renderToStaticMarkup(createElement(PhoneRowLimit, { total, noun: 'rows' } as PhoneRowLimitProps, createElement('table')));
        const long = limited(51);
        expect(long).toContain('Show all 51 rows');
        const short = limited(9);
        expect(short).not.toContain('Show all');
        // The salary guide's table of 50 states and DC.
        expect(readCode('app/salary-guide/page.tsx')).toContain('<PhoneRowLimit total={BLS_TABLE_ROWS.length} noun="rows">');
    });
});

describe('big decorative pictures are left out on a phone', () => {
    // Read as written: the marker this looks for is in a CSS comment, which readCode blanks.
    const css = raw('app/globals.css');
    const phone = css.slice(css.indexOf('Phone restructure (2026-11-27)'));

    it('the site stylesheet holds the phone rules: hidden pictures, and the eleventh row on', () => {
        expect(css.indexOf('Phone restructure (2026-11-27)')).toBeGreaterThan(-1);
        expect(phone).toMatch(/@media \(max-width: 760px\) \{\s*\[data-phone-hide\] \{\s*display: none !important;/);
        expect(phone).toContain('tbody tr:nth-child(n + 11)');
    });

    it('data-phone-hide has a rule of its own, so a browser without :has() still honours it', () => {
        const rule = phone.slice(phone.indexOf('[data-phone-hide]'));
        expect(rule.slice(0, rule.indexOf('}'))).not.toContain(':has(');
    });

    it('a frame holding only a bento or call-to-action picture, and an ImmersiveImage cell showing one, are left out', () => {
        for (const family of ['bento-', 'cta-illustration', 'cta-dream-role']) expect(phone).toContain(`[src*="${family}"]`);
        expect(phone).toContain('[data-immersive]:has(');
        expect(readCode('components/ImmersiveImage.tsx')).toContain('data-immersive=""');
    });

    it('the how it works step drawings are marked and lazy, and their steps take numbers instead', () => {
        for (const file of ['components/FeaturedJobs.tsx', 'components/EmployerHowItWorks.tsx']) {
            const code = readCode(file);
            expect(code, file).toContain('data-phone-hide=""');
            expect(code, file).toContain('loading="lazy"');
            expect(code, file).toMatch(/@media \(max-width: 760px\) \{[\s\S]*counter-increment/);
        }
    });

    it('the home page states keep their pictures only as small icons', () => {
        const code = readCode('components/TopStatesList.tsx');
        expect(code).toContain('sizes="(max-width: 760px) 52px, (max-width: 1024px) 25vw, 20vw"');
        expect(code).toMatch(/\.tsl-pic \{[^}]*width: 52px;[^}]*height: 52px;/);
    });

    it('a picture that loads at once carries a 1 pixel phone size hint as well', () => {
        const hero = readCode('components/CategoryHero.tsx');
        expect(hero).toContain("const HERO_ART_SIZES = '(max-width: 760px) 1px, ");
        expect(hero).toContain('<div className="cath5-photo" data-phone-hide="">');
        const stateSalary = readCode('app/salary-guide/[state]/page.tsx');
        expect(stateSalary).toContain('<div className="sg-hero-art" data-phone-hide="">');
        expect(stateSalary).toContain('sizes="(max-width: 760px) 1px, ');
    });

    // The page heroes beside a heading, as on the sister site: each loads at
    // once (priority, or a high fetch priority), so its frame is left out and
    // the 1 pixel hint sends a phone the smallest copy. Wide screens keep the
    // size the picture is drawn at.
    it.each([
        ['app/contact/page.tsx', '280px'],
        ['app/faq/page.tsx', '280px'],
        ['app/privacy/page.tsx', '140px'],
        ['app/terms/page.tsx', '140px'],
    ])('%s: the hero picture is left out on a phone and sends it the smallest copy', (rel, wide) => {
        const code = readCode(rel);
        const frameAt = code.indexOf(`<div data-phone-hide="" style={{ display: 'flex', justifyContent: 'center' }}>`);
        expect(frameAt, 'the hero frame carries data-phone-hide').toBeGreaterThan(-1);
        const frame = code.slice(frameAt, code.indexOf('</div>', frameAt));
        expect(frame).toMatch(/\bpriority\b|fetchPriority="high"/);
        expect(frame).toContain(`sizes="(max-width: 760px) 1px, ${wide}"`);
    });

    // The legal pages' hero grid turns one column at the very width where
    // data-phone-hide leaves the icon out, so between 601 and 760 pixels no
    // empty column is left beside the heading. Hiding the icon below 600
    // pixels stays a rule of its own.
    it.each(['app/privacy/page.tsx', 'app/terms/page.tsx'])('%s: the hero grid is one column wherever its icon is left out', (rel) => {
        const hideAt = /@media \(max-width: (\d+)px\) \{\s*\[data-phone-hide\]/.exec(phone)?.[1];
        expect(hideAt, 'the data-phone-hide breakpoint').toBe('760');
        const src = raw(rel);
        const styles = src.slice(src.lastIndexOf('<style dangerouslySetInnerHTML'));
        const oneColumn = /@media \(max-width: (\d+)px\) \{\s*\.legal-hero-grid \{ grid-template-columns: 1fr !important;/.exec(styles);
        expect(oneColumn, 'the one-column rule').not.toBeNull();
        expect(oneColumn![1]).toBe(hideAt);
        expect(styles).toMatch(/@media \(max-width: 600px\) \{\s*\.legal-hero-grid > div:last-child \{ display: none; \}/);
    });
});
