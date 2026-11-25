/**
 * A signed-out visitor fills in the post and previews it, then creates the
 * employer account before publishing (owner decision 2026-11-25, replacing
 * the /post-job sign-up wall).
 *
 *   - /post-job renders the form for a signed-out visitor, with a note that
 *     no account is needed to start, the draft is kept on this device, and
 *     the account comes before publishing, plus a login link. A signed-in
 *     job seeker still gets the wrong-account screen.
 *   - Nothing account-bound runs signed out: no server draft read, save or
 *     delete, no logo upload, and the AI writer, its usage badge and saved
 *     templates say they need an account. The built-in skeletons and writing
 *     by hand work for everyone.
 *   - The preview offers "Create employer account" (back to the preview) and
 *     login in place of a publish button that would only answer 401.
 *   - Newer work wins between the browser copy and an account's server
 *     draft (tests/lib/local-job-draft.test.ts pins the rule itself).
 *
 * The preview and the AI panel are rendered through renderToStaticMarkup
 * with the preview's useState values seeded in order (effects do not run
 * there), as tests/regressions/employer-app-promo-phase.test.ts does. The
 * wizard page cannot be rendered without a DOM (react-hook-form, dynamic
 * imports), so its wiring is pinned on the source with comments blanked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import PreviewPage from '@/app/post-job/preview/page';
import JdStarterPanel from '@/components/post-job/JdStarterPanel';
import { readCode } from '../helpers/source';

const seeded = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => {
            const i = seeded.index++;
            const value = i < seeded.values.length
                ? seeded.values[i]
                : typeof initial === 'function' ? (initial as () => unknown)() : initial;
            return [value, () => undefined];
        },
    };
});

vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, className, children }: { href: string; className?: string; children?: React.ReactNode }) =>
            createElement('a', { href, className }, children),
    };
});
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/analytics', () => ({ trackFreePostLimitHit: vi.fn(), trackPostJobAccountClick: vi.fn() }));
vi.mock('@/components/JobCard', () => ({ default: () => null }));

function render(element: React.ReactElement, state: unknown[] = []): string {
    seeded.values = state;
    seeded.index = 0;
    return renderToStaticMarkup(element);
}

/** Every link in the markup: its href (entities decoded) and visible text. */
function links(html: string): { href: string; text: string }[] {
    return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
        href: m[1].replace(/&amp;/g, '&'),
        text: m[2].replace(/<[^>]*>/g, '').trim(),
    }));
}

/** The opening tag of the first button whose content includes `label`. */
function buttonTag(html: string, label: string): string | undefined {
    return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((m) => m[2].includes(label))?.[1];
}

describe('/post-job/preview: a signed-out visitor is offered an account, not a publish that fails', () => {
    const FORM = {
        title: 'Nurse Practitioner, Telehealth',
        companyName: 'Clinic Co',
        location: 'Remote',
        mode: 'Remote',
        jobType: 'Full-Time',
        description: '<p>Role</p>',
        applyUrl: 'https://clinic.example/apply',
        contactEmail: 'hiring@clinic.example',
        pricingTier: 'pro',
    };
    /** GET /api/employer/free-quota-status answers an anonymous caller 401 with this body. */
    const SIGNED_OUT = { error: 'Unauthorized', eligible: false, reason: 'unauthenticated' };
    const INTRO_QUOTE = { eligible: true, mode: 'intro', tier: 'intro', willBeFree: false, price: config.introPrice, priceCents: config.stripeIntroPriceInCents, durationDays: config.durationDays };
    // useState order: formData, loading, isLoading, error, fetchedQuotaStatus, paidPostingAvailable.
    const renderPreview = (quote: object | null): string => render(React.createElement(PreviewPage), [FORM, false, false, null, quote, true]);

    it('leads with "Create employer account", which signs up as an employer and comes back to the preview', () => {
        const html = renderPreview(SIGNED_OUT);
        expect(html).toContain('Create your employer account to publish this post.');
        const signup = links(html).filter((l) => l.href === '/signup?role=employer&redirectTo=/post-job/preview');
        expect(signup.map((l) => l.text)).toEqual(['Create employer account', 'Create account to publish']);
        expect(links(html)).toContainEqual({ href: '/login?next=/post-job/preview', text: 'I have an account: log in' });
    });

    it('offers no publish button and quotes no price to a signed-out visitor', () => {
        const html = renderPreview(SIGNED_OUT);
        expect(html).not.toContain('Looks Good, Post Job');
        expect(html).not.toContain('Continue to Payment');
        expect(html).not.toMatch(/\$\d/);
        // The primary action keeps its place (and its mobile fixed-bar styling).
        expect(html).toMatch(/<a href="\/signup\?role=employer&amp;redirectTo=\/post-job\/preview" class="preview-btn-primary">/);
    });

    it('a signed-in employer gets the publish button and no account prompt', () => {
        const html = renderPreview(INTRO_QUOTE);
        expect(html).not.toContain('Create employer account');
        expect(html).not.toContain('Create account to publish');
        expect(buttonTag(html, `Continue to Payment: $${config.introPrice}`)).toContain('class="preview-btn-primary"');
    });

    it('no quote yet, or an account that is not an employer: no account prompt, the server stays the gate', () => {
        for (const quote of [null, { eligible: false, reason: 'not-employer' }]) {
            const html = renderPreview(quote);
            expect(html).not.toContain('Create employer account');
            expect(html).toContain('Looks Good, Post Job');
        }
    });

    it('keeps the 401 answer of the quote request instead of dropping it', () => {
        const code = readCode('app/post-job/preview/page.tsx');
        expect(code).toMatch(/fetch\('\/api\/employer\/free-quota-status'\);\s*if \(!res\.ok && res\.status !== 401\) return;/);
        expect(code).toContain("const needsLogin = quotaStatus?.eligible === false && quotaStatus.reason === 'unauthenticated';");
    });
});

describe('the AI writer panel asks for an account instead of calling for one', () => {
    const CONTEXT = { role: 'Nurse Practitioner', setting: '', employer: 'Clinic Co', location: 'Remote', benefits: [] };
    const panel = (props: { description: string; signedIn?: boolean }) =>
        render(React.createElement(JdStarterPanel, { onChange: () => undefined, formContext: CONTEXT, ...props }));
    const ACCOUNT_AI = 'Create a free employer account to use the AI writer.';
    const ACCOUNT_TEMPLATES = 'Create an employer account to save your own templates.';

    it('signed out: Generate with AI is disabled and says why; writing by hand and the skeletons stay open', () => {
        const html = panel({ description: '', signedIn: false });
        expect(html).toContain(ACCOUNT_AI);
        expect(buttonTag(html, 'Generate with AI')).toMatch(/\bdisabled\b/);
        expect(buttonTag(html, 'Write from scratch')).not.toMatch(/\bdisabled\b/);
        expect(buttonTag(html, 'skeleton starters')).not.toMatch(/\bdisabled\b/);
    });

    it('signed in (the default): the AI writer is offered with no account note', () => {
        const html = panel({ description: '' });
        expect(html).not.toContain(ACCOUNT_AI);
        expect(buttonTag(html, 'Generate with AI')).not.toMatch(/\bdisabled\b/);
    });

    it('signed out with a draft in the editor: saving to my templates is disabled and says why', () => {
        const html = panel({ description: `<p>${'Outpatient clinic role. '.repeat(4)}</p>`, signedIn: false });
        const save = buttonTag(html, 'Save to my templates');
        expect(save).toMatch(/\bdisabled\b/);
        expect(save).toContain(`title="${ACCOUNT_TEMPLATES}"`);
        expect(buttonTag(html, 'Browse templates')).not.toMatch(/\bdisabled\b/);
    });

    it('the usage and saved-template requests wait for a signed-in employer, and the AI call refuses without one', () => {
        const code = readCode('components/post-job/JdStarterPanel.tsx');
        expect(code).toMatch(/if \(!signedIn\) return;\s*let cancelled = false;\s*fetch\('\/api\/employer\/ai-jd\/usage'/);
        expect(code).toMatch(/if \(!signedIn\) return;\s*refreshCustomTemplates\(\);/);
        expect(code).toMatch(/async function callAi\([\s\S]*?\)\s*\{\s*if \(!signedIn\)/);
        expect(code).toMatch(/function openSaveAsTemplate\(\)\s*\{\s*if \(!signedIn\)/);
    });
});

describe('/post-job: a signed-out visitor gets the form, not a wall', () => {
    const code = readCode('app/post-job/page.tsx');
    const content = code.slice(code.indexOf('function PostJobContent()'), code.indexOf('export default function PostJobPage'));
    const renderStart = content.indexOf('if (isAuthLoading) return <LoadingFallback />;');
    const renderPath = content.slice(renderStart);
    const autosave = content.slice(content.indexOf('const watchedFormData = watch();'), content.indexOf("fetch('/api/employer/profile-snapshot')"));
    const clearDraft = content.slice(content.indexOf('const performClearDraft = async () => {'), content.indexOf('const handleClearDraft = () => {'));

    it('finds the parts of the page it pins', () => {
        expect(renderStart).toBeGreaterThan(-1);
        expect(renderPath).toContain('id="job-post-form"');
        expect(autosave).toContain("fetch('/api/job-draft', {");
        expect(clearDraft).toContain("localStorage.removeItem('jobFormData')");
    });

    it('no early return sends a signed-out visitor away from the form', () => {
        expect(renderPath).not.toMatch(/if\s*\(\s*!user\s*\)/);
        expect(code).not.toContain('You must be logged in as an employer');
        // The paid-posting gate resolves at once for a signed-out visitor, so
        // the form is not held behind its spinner.
        expect(content).toMatch(/if \(!user \|\| \(userRole !== 'employer' && userRole !== 'admin'\)\) \{\s*setPaidGateLoading\(false\);\s*return;/);
    });

    it('the wrong-account screen is only for a signed-in account that is not an employer', () => {
        expect(renderPath).toMatch(/if\s*\(\s*user\s*&&\s*userRole\s*!==\s*'employer'\s*&&\s*userRole\s*!==\s*'admin'\s*\)/);
    });

    it('the signed-out form says where the draft is kept and offers login', () => {
        expect(renderPath).toMatch(/\{signedOut && \(/);
        expect(renderPath).toContain('No account needed to start');
        expect(renderPath).toContain('href="/login?next=/post-job"');
        expect(renderPath).toContain('deviceOnly={signedOut}');
        expect(code).toContain("deviceOnly ? 'Saved on this device' : 'All changes auto-save'");
    });

    it('account-bound calls are not made for a signed-out visitor', () => {
        // The AI writer and template library, the logo upload and the server
        // draft all belong to an employer account.
        expect(renderPath).toContain('signedIn={!signedOut}');
        // (Anchored on the label: blankComments reads the input's
        // accept="image/*" as the start of a block comment.)
        expect(renderPath).toMatch(/\{signedOut \? \([\s\S]*?\) : \([\s\S]*?'Upload Logo'/);
        expect(content).toMatch(/if \(user\) \{\s*try \{\s*const res = await fetch\('\/api\/job-draft', \{ cache: 'no-store' \}\)/);
        expect(clearDraft).toMatch(/if \(user\) \{\s*try \{\s*await fetch\('\/api\/job-draft', \{ method: 'DELETE' \}\)/);
        const gate = autosave.indexOf("if (!user || (userRole !== 'employer' && userRole !== 'admin')) return;");
        expect(gate).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(autosave.indexOf("fetch('/api/job-draft', {"));
    });

    it('hydration waits for the auth check, and a newer copy on this device beats the server draft', () => {
        expect(content).toMatch(/useEffect\(\(\) => \{\s*if \(isAuthLoading\) return;\s*const markRestored/);
        expect(content).toMatch(/loadFormData\(\);\s*\}, \[[^\]]*\bisAuthLoading\b[^\]]*\]\);/);
        expect(content).toContain('const deviceCopyIsNewer = deviceDraftIsNewer(localDraftSavedAt(localStorage), data?.draft?.savedAt);');
        expect(content).toContain('if (data?.draft?.formData && !deviceCopyIsNewer) {');
    });

    it('the browser copy is stamped only when its content really changes', () => {
        expect(autosave).toMatch(
            /if \(localStorage\.getItem\('jobFormData'\) !== serializedFormData\) \{\s*localStorage\.setItem\('jobFormData', serializedFormData\);\s*if \(hasMeaningful\) localStorage\.setItem\(LOCAL_DRAFT_SAVED_AT_KEY, new Date\(\)\.toISOString\(\)\);/,
        );
        expect(autosave).toContain('const hasMeaningful = hasMeaningfulDraftContent(watchedFormData as DraftValues);');
    });

    it('Clear removes the stamp and the screening questions with the draft', () => {
        expect(clearDraft).toContain('localStorage.removeItem(LOCAL_DRAFT_SAVED_AT_KEY);');
        expect(clearDraft).toContain("localStorage.removeItem('jobScreeningQuestions');");
    });

    it('the sign-in email is suggested after hydration, only into an empty field', () => {
        expect(content).toMatch(/if \(!draftLoaded \|\| !user\) return;[\s\S]{0,200}?if \(user\.email && !getValues\('contactEmail'\)\)/);
    });

    it('records the form opening once, signed in or not', () => {
        expect(content).toContain('trackPostJobFormOpen(!!user);');
    });
});

describe('funnel events', () => {
    const gtag = vi.fn();

    afterEach(() => {
        gtag.mockReset();
        vi.unstubAllGlobals();
    });

    it('post_job_form_open carries signed_in; post_job_account_click carries the action', async () => {
        vi.stubGlobal('window', { gtag });
        const analytics = await vi.importActual<typeof import('@/lib/analytics')>('@/lib/analytics');
        analytics.trackPostJobFormOpen(false);
        analytics.trackPostJobAccountClick('signup');
        analytics.trackPostJobAccountClick('login');
        expect(gtag.mock.calls).toEqual([
            ['event', 'post_job_form_open', { signed_in: false }],
            ['event', 'post_job_account_click', { action: 'signup' }],
            ['event', 'post_job_account_click', { action: 'login' }],
        ]);
    });
});
