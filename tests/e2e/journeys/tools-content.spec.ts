import { test as base, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { brand } from '../../../config/brand';
import { uniqueIp } from '../helpers/candidate';

/**
 * Tools + content journey — every /tools route, the salary guide, the
 * scope-of-practice explorer, /compare, /reports, /resources, /blog, /faq,
 * /press, /accessibility and /editorial-policy.
 *
 * Every surface here is public and read-only, so no role-based auth is
 * needed (tests/e2e/helpers/auth.ts is not imported on purpose). The one
 * protected API the tools touch — the employer analytics benchmark — is
 * asserted to REJECT an unauthenticated call.
 *
 * Worked examples are recomputed BY HAND from the model files
 * (components/tools/*-model.ts) and pinned as literals with the derivation in
 * a comment — the spec never imports the model it is checking.
 *
 * Every test runs under a console guard: any uncaught page error or
 * first-party console.error fails the test. Third-party noise (analytics,
 * fonts, external images) is filtered by origin. A test can `guard.allow()`
 * a first-party pattern it deliberately triggers.
 *
 * DEFECTS pinned as test.fixme (each is a real product defect, not a spec
 * weakness — the fix agent owns them):
 *   D1  benchmark tool publishes states /salary-guide gates out + a different
 *       national sample (components/tools/EmployerBenchmarkWidget.tsx)
 *   D2  licensure checker + planner omit guide links in the unsynced state
 *       (app/tools/licensure-checker/page.tsx loadCheckerData)
 *   D3  FAQ accordion duplicates aria-controls / panel ids across groups
 *       (components/FAQAccordion.tsx)
 *   D4  /salary-guide/<state> "Top Cities" links /jobs/city pages that 404
 *       (app/salary-guide/[state]/page.tsx topCities)
 *   D5  pay-transparency report caches a transient DB failure as
 *       "unavailable" for revalidate=3600 (app/reports/pay-transparency/page.tsx)
 *   D5b the state-of-NP-hiring report does the same
 *       (app/reports/state-of-np-hiring-2026/page.tsx + lib/reports/queries.ts)
 *   D6  certification guides 404 / blog index omits live license guides
 *       (lib/blog.ts getPublishedPosts vs getAllPublishedSlugs)
 *   D7  cost-per-hire parser strips the minus sign, so a negative spend is
 *       priced as positive (components/tools/EmployerCostPerHireCalculator.tsx)
 *   D8  benchmark offer parser does the same: a negative offer is graded
 *       against the band as a positive one (components/tools/EmployerBenchmarkPicker.tsx)
 *
 * Copy rule (owner direction 2026-09-12): no em/en dash in rendered text.
 * expectPageBasics audits every page in scope and the interactive flows
 * re-audit after they have changed the DOM.
 */

// ── Console guard fixture ───────────────────────────────────────────────────

const NOISE_PATTERNS: RegExp[] = [
    /Download the React DevTools/i,
    /third-party cookie/i,
    /googletagmanager|google-analytics|gtag|doubleclick/i,
    /sentry|posthog|plausible|beehiiv|vercel\.live|vercel-insights/i,
    /favicon\.ico|manifest\.json|site\.webmanifest/i,
    /apple-touch-icon/i,
    /ResizeObserver loop/i,
    // Cancelled RSC prefetches when a test navigates away mid-flight.
    /net::ERR_ABORTED/i,
    // The app rate-limits by client IP. Every journey suite in this environment
    // shares one IP, so link prefetches can be throttled (429) purely by test
    // traffic volume — not a product defect on the page under test.
    /status of 429/i,
];

interface CapturedError {
    kind: 'pageerror' | 'console';
    text: string;
    url?: string;
}

interface ConsoleGuard {
    readonly captured: CapturedError[];
    /** Allow a first-party pattern (matched against text and URL) for this test only. */
    allow(pattern: RegExp): void;
}

function isNoise(text: string, url: string | undefined, baseOrigin: string): boolean {
    if (NOISE_PATTERNS.some((p) => p.test(text) || (url ? p.test(url) : false))) return true;
    // Resource failures from a different origin are third-party noise.
    if (url && url.startsWith('http') && !url.startsWith(baseOrigin)) return true;
    return false;
}

export const test = base.extend<{ guard: ConsoleGuard }>({
    guard: [
        async ({ page, baseURL }, use) => {
            const captured: CapturedError[] = [];
            const allowed: RegExp[] = [];
            const origin = new URL(baseURL ?? 'http://127.0.0.1:3000').origin;
            const onConsole = (msg: ConsoleMessage) => {
                if (msg.type() !== 'error') return;
                const url = msg.location()?.url;
                const text = msg.text();
                if (isNoise(text, url, origin)) return;
                captured.push({ kind: 'console', text, url });
            };
            const onPageError = (err: Error) => {
                captured.push({ kind: 'pageerror', text: err.message });
            };
            page.on('console', onConsole);
            page.on('pageerror', onPageError);
            await use({ captured, allow: (p) => allowed.push(p) });
            page.off('console', onConsole);
            page.off('pageerror', onPageError);
            const remaining = captured.filter(
                (c) => !allowed.some((p) => p.test(c.text) || (c.url ? p.test(c.url) : false)),
            );
            expect(
                remaining,
                `Uncaught page errors / first-party console errors:\n${remaining
                    .map((c) => `[${c.kind}] ${c.text}${c.url ? ` (${c.url})` : ''}`)
                    .join('\n')}`,
            ).toEqual([]);
        },
        { auto: true },
    ],
});

// ── Shared helpers ──────────────────────────────────────────────────────────

const DUPLICATED_SUFFIX = new RegExp(`\\| ${brand.name} \\| ${brand.name}`);

/**
 * Copy rule in force site-wide (owner direction 2026-09-12): visible text
 * carries no em dash (U+2014) or en dash (U+2013). Scans every text node
 * under <body> (hidden ones included: collapsed FAQ panels, sr-only text and
 * <option> labels are all rendered copy), the document title, and the
 * attributes assistive tech reads out. Script / style / JSON-LD are excluded;
 * employer-authored job data is normalised at render by lib/display-text.ts,
 * so a hit anywhere on these surfaces is a defect.
 */
async function expectNoRenderedDashes(page: Page, label: string): Promise<void> {
    const hits = await page.evaluate(() => {
        const DASH = /[–—]/g;
        const found: string[] = [];
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
        const text = (clone.textContent ?? '').replace(/\s+/g, ' ');
        let m: RegExpExecArray | null;
        while ((m = DASH.exec(text)) && found.length < 12) {
            found.push(`text: …${text.slice(Math.max(0, m.index - 50), m.index + 50)}…`);
        }
        if (/[–—]/.test(document.title)) found.push(`title: ${document.title}`);
        for (const el of Array.from(document.body.querySelectorAll('[aria-label],[title],[alt],[placeholder]'))) {
            for (const attr of ['aria-label', 'title', 'alt', 'placeholder']) {
                const value = el.getAttribute(attr);
                if (value && /[–—]/.test(value)) found.push(`${attr}="${value}"`);
            }
        }
        return found;
    });
    expect(hits, `em/en dash in rendered copy on ${label}`).toEqual([]);
}

/** Exactly one H1, a canonical that matches the path, no doubled brand suffix, no dashes in copy. */
async function expectPageBasics(page: Page, path: string): Promise<void> {
    await expect(page.locator('h1')).toHaveCount(1);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const href = (await canonical.getAttribute('href')) ?? '';
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(href, `canonical for ${path}`).toMatch(new RegExp(`^https?://[^/]+${escaped}$`));
    const title = await page.title();
    expect(title, `title for ${path}`).not.toMatch(DUPLICATED_SUFFIX);
    expect(title.trim().length).toBeGreaterThan(0);
    await expectNoRenderedDashes(page, path);
}

async function gotoOk(page: Page, path: string): Promise<void> {
    const res = await page.goto(path);
    expect(res, `no response for ${path}`).not.toBeNull();
    expect(res!.status(), `status for ${path}`).toBe(200);
}

/** The assumptions panel every tool must render without interaction. */
async function expectAssumptionsPanel(page: Page): Promise<void> {
    const heading = page.locator('#tool-assumptions-heading');
    await expect(heading).toBeVisible();
    const panel = page.locator('section[aria-labelledby="tool-assumptions-heading"]');
    await expect(panel.getByRole('heading', { name: 'What it assumes' })).toBeVisible();
    expect(await panel.locator('ul').first().locator('li').count()).toBeGreaterThan(0);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(overflow.scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(overflow.innerWidth + 1);
}

async function expectNoNaN(page: Page): Promise<void> {
    await expect(page.locator('body')).not.toContainText(/\bNaN\b|Infinity|undefined/);
}

/** Parse "$1,234" → 1234 from arbitrary text (first match). */
function firstUsd(text: string): number {
    const m = text.match(/-?\$([\d,]+)/);
    if (!m) throw new Error(`no $ figure in: ${text}`);
    return Number(m[1].replace(/,/g, '')) * (m[0].startsWith('-') ? -1 : 1);
}

function fmtUsd(n: number): string {
    const r = Math.round(n);
    return (r < 0 ? '-$' : '$') + Math.abs(r).toLocaleString('en-US');
}

async function fillNumber(page: Page, selector: string, value: string): Promise<void> {
    const input = page.locator(selector);
    await input.fill(value);
    await expect(input).toHaveValue(value);
}

/**
 * Keyboard-retype the focused control. Controlled React number inputs can
 * lose a keystroke when typed at full speed (the DOM value is stale until the
 * state flush), so type with a small delay and assert the value landed.
 */
async function retypeFocused(page: Page, selector: string, value: string): Promise<void> {
    const input = page.locator(selector);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    // Number inputs expose no selection API, so select-all cannot be verified;
    // fall back to bounded single-character deletes until the field is empty.
    for (let i = 0; i < 16 && (await input.inputValue()) !== ''; i += 1) {
        await page.keyboard.press('End');
        await page.keyboard.press('Backspace');
    }
    await expect(input).toHaveValue('');
    await page.keyboard.type(value, { delay: 40 });
    await expect(input).toHaveValue(value);
}

/** Innermost <div> that contains a heading with the given text and the given row text. */
function cardWith(page: Page, headingText: string, rowText: string) {
    return page
        .locator('div')
        .filter({ has: page.locator(`h3:has-text("${headingText}")`) })
        .filter({ hasText: rowText })
        .last();
}

const TOOL_PATHS = [
    '/tools/1099-vs-w2-calculator',
    '/tools/cost-of-living-comparison',
    '/tools/licensure-checker',
    '/tools/salary-benchmark',
    '/tools/specialty-finder',
    '/tools/private-practice-revenue-calculator',
    '/tools/cost-per-hire-calculator',
];

const CONTENT_PATHS = [
    '/tools',
    '/salary-guide',
    '/salary-guide/texas',
    '/salary-guide/specialty',
    '/salary-guide/specialty/family-practice',
    '/scope-of-practice',
    '/compare',
    '/compare/np-hiring-vs-indeed',
    '/compare/np-hiring-vs-aanp-jobcenter',
    '/compare/np-hiring-vs-enp-network',
    '/reports',
    '/reports/pay-transparency',
    '/reports/state-of-np-hiring-2026',
    '/resources',
    '/resources/1099-vs-w2',
    '/resources/fpa-guide',
    '/resources/private-practice-guide',
    '/blog',
    '/blog/np-license-texas',
    '/blog/np-license-massachusetts',
    '/faq',
    '/press',
    '/accessibility',
    '/editorial-policy',
];

// ── Cross-cutting: every page in scope ──────────────────────────────────────

test.describe('page hygiene: one H1, canonical, no doubled title suffix, no dashes in copy, no console errors', () => {
    for (const path of [...TOOL_PATHS, ...CONTENT_PATHS]) {
        test(`hygiene: ${path}`, async ({ page }) => {
            await gotoOk(page, path);
            await expectPageBasics(page, path);
        });
    }

    for (const path of TOOL_PATHS) {
        test(`assumptions panel visible without interaction: ${path}`, async ({ page }) => {
            await gotoOk(page, path);
            await expectAssumptionsPanel(page);
        });
    }

    test('unknown slugs under every content hub 404 cleanly (no application error page)', async ({ page, guard }) => {
        guard.allow(/404/);
        for (const path of [
            '/tools/not-a-tool',
            '/salary-guide/not-a-state',
            '/salary-guide/specialty/not-a-specialty',
            '/compare/np-hiring-vs-nobody',
            '/reports/not-a-report',
            '/resources/not-a-guide',
            '/blog/not-a-post',
        ]) {
            const res = await page.goto(path);
            expect(res?.status(), `status for ${path}`).toBe(404);
            await expect(page.locator('body')).not.toContainText('Application error');
        }
    });
});

// ── /tools hub ──────────────────────────────────────────────────────────────

test.describe('/tools hub', () => {
    test('links every one of the 7 tools, nothing more, nothing less', async ({ page }) => {
        await gotoOk(page, '/tools');
        for (const path of TOOL_PATHS) {
            await expect(page.locator(`a[href="${path}"]`).first(), `hub card for ${path}`).toBeVisible();
        }
        const cardHrefs = await page
            .locator('main a[href^="/tools/"]')
            .evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')))]);
        for (const path of TOOL_PATHS) expect(cardHrefs).toContain(path);
        // No phantom tool: every /tools/* link on the hub is a registered tool.
        for (const href of cardHrefs) expect(TOOL_PATHS, `unregistered tool link ${href}`).toContain(href);
    });
});

// ── 1099 vs W-2 take-home calculator ────────────────────────────────────────

/**
 * WORKED EXAMPLE — recomputed by hand from federal-tax-model.ts (TY2026,
 * single) and take-home-model.ts.
 *
 * Inputs: 40 h/wk, 25 days off, W-2 $140,000 + 3% match + $2,400 premium;
 *         1099 $82/h, $6,000 expenses, $9,000 health, $6,000 retirement.
 * Hours: 40×52 − 25×8 = 1,880.
 * W-2:  FICA wages 137,600 → SS 8,531.20 + Medicare 1,995.20 = 10,526.40
 *       taxable 137,600 − 16,100 = 121,500
 *       tax 1,240 + 4,560 + 12,166 + 15,800×0.24 (3,792) = 21,758
 *       cash 140,000 − 2,400 − 10,526.40 − 21,758 = 105,315.60
 *       match 4,200 → net position 109,515.60 → $109,516; 24% bracket
 * 1099: gross 82×1,880 = 154,160; net profit 148,160
 *       SE: 148,160×0.9235 = 136,825.76 → SS 16,966.39 + Med 3,967.95 = 20,934.34
 *       half-SE deduction 10,467.17; health deduction 9,000 (under ceiling)
 *       taxable 148,160 − 10,467.17 − 9,000 − 16,100 = 112,592.83
 *       tax 17,966 + 6,892.83×0.24 (1,654.28) = 19,620.28
 *       cash 154,160 − 6,000 − 20,934.34 − 19,620.28 − 9,000 = 98,605.38 → $98,605
 * Delta 98,605.38 − 109,515.60 = −10,910.22 → "W-2 comes out ahead", $10,910
 * Per hour: 109,515.60/1,880 = $58; 98,605.38/1,880 = $52
 * Break-even (bisection on the same model): ≈ $91.13/h → "$91/hr"
 */
test.describe('/tools/1099-vs-w2-calculator', () => {
    const PATH = '/tools/1099-vs-w2-calculator';

    async function fillWorkedExample(page: Page): Promise<void> {
        await page.selectOption('#takehome-filing', 'single');
        await fillNumber(page, '#takehome-hoursPerWeek', '40');
        await fillNumber(page, '#takehome-paidDaysOff', '25');
        await fillNumber(page, '#takehome-w2Salary', '140000');
        await fillNumber(page, '#takehome-w2EmployerMatchPct', '3');
        await fillNumber(page, '#takehome-w2EmployeePremium', '2400');
        await fillNumber(page, '#takehome-contractHourlyRate', '82');
        await fillNumber(page, '#takehome-contractBusinessExpenses', '6000');
        await fillNumber(page, '#takehome-contractHealthPremium', '9000');
        await fillNumber(page, '#takehome-contractRetirement', '6000');
    }

    test('worked example matches the hand-computed model output', async ({ page }) => {
        await gotoOk(page, PATH);
        await fillWorkedExample(page);

        await expect(page.getByRole('heading', { name: 'W-2 comes out ahead' })).toBeVisible();
        const headline = page.locator('p[aria-live="polite"]');
        await expect(headline).toContainText('$10,910');
        await expect(page.getByText('Both columns work 1,880 hours')).toBeVisible();
        await expect(page.getByText(/Break-even contract rate:/)).toContainText('$91/hr');

        const w2 = cardWith(page, 'W-2 employee', 'FICA withheld');
        await expect(w2).toContainText('$109,516');
        await expect(w2).toContainText('-$10,526'); // FICA
        await expect(w2).toContainText('-$21,758'); // federal income tax
        await expect(w2).toContainText('$105,316'); // cash after tax
        await expect(w2).toContainText('+$4,200');
        await expect(w2).toContainText('24%');
        await expect(w2).toContainText('$58/hr');

        const c = cardWith(page, '1099 contractor', 'Self-employment tax');
        await expect(c).toContainText('$98,605');
        await expect(c).toContainText('$154,160');
        await expect(c).toContainText('-$20,934'); // SE tax
        await expect(c).toContainText('-$19,620'); // federal income tax
        await expect(c).toContainText('-$9,000');
        await expect(c).toContainText('($6,000)');
        await expect(c).toContainText('$52/hr');

        const detail = cardWith(page, 'Where the 1099 deductions land', 'Net profit after business expenses');
        await expect(detail).toContainText('$148,160');
        await expect(detail).toContainText('-$10,467');
        await expect(detail).toContainText('-$9,000');
        await expect(detail).toContainText('$112,593');
    });

    test('filing status changes the bracket table (married joint lowers W-2 tax)', async ({ page }) => {
        await gotoOk(page, PATH);
        await fillWorkedExample(page);
        // Married joint: taxable 137,600 − 32,200 = 105,400 → 2,480 + 9,120 + 4,600×0.22 (1,012) = 12,612
        await page.selectOption('#takehome-filing', 'marriedJoint');
        const w2 = cardWith(page, 'W-2 employee', 'FICA withheld');
        await expect(w2).toContainText('-$12,612');
        await expect(w2).toContainText('22%');
    });

    test('keyboard-only edit: Tab from filing status reaches hours and retypes it', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#takehome-filing').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#takehome-hoursPerWeek')).toBeFocused();
        await retypeFocused(page, '#takehome-hoursPerWeek', '36');
        // 36×52 − 25×7.2 = 1,872 − 180 = 1,692
        await expect(page.getByText('Both columns work 1,692 hours')).toBeVisible();
        // Focus ring class is applied to every control (WCAG 2.4.7 contract).
        await expect(page.locator('#takehome-hoursPerWeek')).toHaveClass(/tool-control/);
    });

    test('invalid / empty / negative input never renders NaN and reset restores defaults', async ({ page }) => {
        await gotoOk(page, PATH);
        const salary = page.locator('#takehome-w2Salary');
        const defaultSalary = await salary.inputValue();
        expect(Number(defaultSalary)).toBeGreaterThan(0);

        await salary.fill('');
        await expectNoNaN(page);
        await expect(page.getByRole('heading', { name: '1099 comes out ahead' })).toBeVisible();

        await page.locator('#takehome-contractHourlyRate').fill('-5');
        await expectNoNaN(page);

        // Double-activating Reset (keyboard) is idempotent and leaves the defaults in place.
        const reset = page.getByRole('button', { name: 'Reset' });
        await reset.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await expect(salary).toHaveValue(defaultSalary);
        await expect(page.locator('#takehome-filing')).toHaveValue('single');
        await expectNoRenderedDashes(page, `${PATH} (after reset)`);
    });

    test('extremes: unreachable break-even hides the line, zero hours renders $0/hr, no NaN', async ({ page }) => {
        await gotoOk(page, PATH);
        // $999,999,999 W-2 cannot be matched by any rate up to the model's $2,000/hr cap → null → line hidden.
        await fillNumber(page, '#takehome-w2Salary', '999999999');
        await expect(page.getByText(/Break-even contract rate:/)).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'W-2 comes out ahead' })).toBeVisible();
        await expectNoNaN(page);
        await page.getByRole('button', { name: 'Reset' }).click();

        await fillNumber(page, '#takehome-hoursPerWeek', '0');
        await expect(page.getByText('Both columns work 0 hours')).toBeVisible();
        await expect(cardWith(page, '1099 contractor', 'Self-employment tax')).toContainText('$0/hr');
        await expectNoNaN(page);
    });

    test('refresh mid-flow returns to defaults without error', async ({ page }) => {
        await gotoOk(page, PATH);
        const salary = page.locator('#takehome-w2Salary');
        const defaultSalary = await salary.inputValue();
        await salary.fill('999999');
        await page.reload();
        await expect(page.locator('#takehome-w2Salary')).toHaveValue(defaultSalary);
        await expect(page.locator('p[aria-live="polite"]')).toContainText('$');
    });

    test('assumptions panel names the tax year, exclusions and IRS/SSA sources', async ({ page }) => {
        await gotoOk(page, PATH);
        const panel = page.locator('section[aria-labelledby="tool-assumptions-heading"]');
        await expect(panel).toContainText('2026');
        await expect(panel.getByRole('heading', { name: 'What it does not include' })).toBeVisible();
        await expect(panel).toContainText('State and local income tax');
        await expect(panel.locator('a[href*="irs.gov"]').first()).toBeVisible();
        await expect(panel.locator('a[href*="ssa.gov"]').first()).toBeVisible();
        await expect(panel).toContainText('Model last reviewed');
    });
});

// ── Cost-of-living comparator ───────────────────────────────────────────────

test.describe('/tools/cost-of-living-comparison', () => {
    const PATH = '/tools/cost-of-living-comparison';

    /** Reads (nominal, index, adjusted) from a rendered city column. Labels are CSS-uppercased. */
    async function readColumn(page: Page, index: 0 | 1) {
        const columns = page.locator('div.tool-two-col').first().locator('> div');
        const card = columns.nth(index);
        const text = await card.innerText();
        const posted = text.match(/Posted salary\s*\$([\d,]+)/i);
        const worth = text.match(/Worth in national-average dollars\s*\$([\d,]+)/i);
        const idx = text.match(/Cost-of-living index\s*([\d.]+)/i);
        const name = (await card.locator('h3').innerText()).trim();
        if (!posted || !worth || !idx) throw new Error(`column ${index} unparsable: ${text}`);
        return {
            name,
            nominal: Number(posted[1].replace(/,/g, '')),
            adjusted: Number(worth[1].replace(/,/g, '')),
            col: Number(idx[1]),
        };
    }

    test('default pair renders and the arithmetic matches col-model (nominal × 100 / index)', async ({ page }) => {
        await gotoOk(page, PATH);
        const a = page.locator('#col-city-a');
        const b = page.locator('#col-city-b');
        await expect(a).toBeVisible();
        expect(await a.inputValue()).not.toBe('');
        expect(await b.inputValue()).not.toBe('');
        expect(await a.locator('optgroup').count()).toBeGreaterThan(1);

        const A = await readColumn(page, 0);
        const B = await readColumn(page, 1);
        expect(A.adjusted).toBe(Math.round((A.nominal * 100) / A.col));
        expect(B.adjusted).toBe(Math.round((B.nominal * 100) / B.col));

        const realDelta = B.adjusted - A.adjusted;
        const headline = page.locator('p[aria-live="polite"]');
        await expect(headline).toContainText(fmtUsd(Math.abs(realDelta)));
        const pct = Math.abs(Math.round((realDelta / A.adjusted) * 100));
        await expect(headline).toContainText(`${pct}%`);

        const matching = (A.nominal * B.col) / A.col;
        await expect(page.getByText(/To match .* purchasing power/)).toContainText(fmtUsd(matching));
        await expect(page.getByText(/Posted pay differs by/)).toContainText(fmtUsd(Math.abs(B.nominal - A.nominal)));

        // Each column links its state pay page.
        await expect(page.locator('a[href^="/salary-guide/"]').first()).toBeVisible();
        await expectNoRenderedDashes(page, `${PATH} (default pair)`);
    });

    test('swap is keyboard operable and swaps the two columns', async ({ page }) => {
        await gotoOk(page, PATH);
        const before = await readColumn(page, 0);
        const swap = page.getByRole('button', { name: 'Swap the two cities' });
        await swap.focus();
        await expect(swap).toBeFocused();
        // Press-and-verify: a keypress that lands before hydration is dropped, so
        // re-press only while column 0 still shows the original city (never twice).
        await expect(async () => {
            if ((await readColumn(page, 0)).name === before.name) {
                await swap.focus();
                await page.keyboard.press('Enter');
            }
            expect((await readColumn(page, 1)).name).toBe(before.name);
        }).toPass({ timeout: 15_000 });
    });

    test('city picker is keyboard operable: ArrowDown on the focused select changes the column', async ({ page }) => {
        await gotoOk(page, PATH);
        const a = page.locator('#col-city-a');
        const before = await a.inputValue();
        await a.focus();
        await page.keyboard.press('ArrowDown');
        await expect(a).not.toHaveValue(before);
        const selected = await a.inputValue();
        if (selected === '') {
            await expect(page.getByText('Pick two cities')).toBeVisible();
        } else {
            const column = await readColumn(page, 0);
            expect(column.adjusted).toBe(Math.round((column.nominal * 100) / column.col));
        }
    });

    test('clearing a picker shows the empty state, choosing again restores the result', async ({ page }) => {
        await gotoOk(page, PATH);
        const a = page.locator('#col-city-a');
        const originalA = await a.inputValue();
        await a.selectOption('');
        await expect(page.getByText('Pick two cities')).toBeVisible();
        await expect(page.locator('p[aria-live="polite"]')).toHaveCount(0);
        await a.selectOption(originalA);
        await expect(page.locator('p[aria-live="polite"]')).toBeVisible();
    });

    test('comparing a city with itself yields a zero real-terms difference', async ({ page }) => {
        await gotoOk(page, PATH);
        const a = page.locator('#col-city-a');
        const value = await a.inputValue();
        await page.locator('#col-city-b').selectOption(value);
        await expect(page.locator('p[aria-live="polite"]')).toContainText('$0');
        await expect(page.getByText(/Posted pay differs by \$0\./)).toBeVisible();
    });
});

// ── Licensure checker + multi-state planner ─────────────────────────────────

test.describe('/tools/licensure-checker', () => {
    const PATH = '/tools/licensure-checker';

    test('state checker: Texas renders restricted practice, its own practice requirement step, timeline, jobs link and a gated median', async ({ page }) => {
        await gotoOk(page, PATH);
        const select = page.locator('#lic-state');
        expect(await select.locator('option').count()).toBe(52); // placeholder + 51 jurisdictions
        await expect(page.getByText('Select a state above')).toBeVisible();

        await select.selectOption('Texas');
        await expect(page.getByRole('heading', { name: 'Texas Licensure' })).toBeVisible();
        await expect(page.getByText('Restricted Practice', { exact: true })).toBeVisible();
        // The last step is Texas's verified details, never a tier-derived step.
        await expect(page.getByText('Practice requirements in Texas')).toBeVisible();
        await expect(page.getByText(/prescriptive authority agreement with a supervising physician/)).toBeVisible();
        await expect(page.getByText('8-16 weeks')).toBeVisible();
        await expect(page.locator('a[href="/jobs/state/texas"]').first()).toBeVisible();
        // Texas clears the n ≥ 5 / 3-employer gate today: the salary card must be a true median with its sample.
        await expect(page.getByText('Median Salary in Texas')).toBeVisible();
        await expect(page.getByText('Salaried Postings')).toBeVisible();
        const sample = Number(
            (await page.getByText('Salaried Postings').locator('xpath=preceding-sibling::div[1]').innerText()).replace(/,/g, ''),
        );
        expect(sample).toBeGreaterThanOrEqual(5);
    });

    test('state checker: a full-practice state has no physician-agreement step', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#lic-state').selectOption('Arizona');
        await expect(page.getByRole('heading', { name: 'Arizona Licensure' })).toBeVisible();
        // The badge is AANP's tier name, never "Full Practice Authority".
        await expect(page.getByText('Full Practice', { exact: true })).toBeVisible();
        // The checker no longer injects tier-derived steps (LicensureChecker.tsx
        // buildLicensureSteps), so neither retired step renders for any state.
        await expect(page.getByText('Secure supervising physician agreement')).toHaveCount(0);
        await expect(page.getByText('Secure collaborative physician agreement')).toHaveCount(0);
        await expect(page.getByText('Practice requirements in Arizona')).toBeVisible();
        await expect(page.getByText('4-8 weeks')).toBeVisible();
    });

    test('state checker: a full-practice state with a transition period shows it in its own step', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#lic-state').selectOption('Connecticut');
        await expect(page.getByRole('heading', { name: 'Connecticut Licensure' })).toBeVisible();
        await expect(page.getByText('Practice requirements in Connecticut')).toBeVisible();
        await expect(page.getByText(/at least three years and 2,000 hours/)).toBeVisible();
    });

    test('state checker: Virginia shows its practice agreement and no supervision step', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#lic-state').selectOption('Virginia');
        await expect(page.getByRole('heading', { name: 'Virginia Licensure' })).toBeVisible();
        await expect(page.getByText('Practice requirements in Virginia')).toBeVisible();
        // The step block: its title and Virginia's verified details. The page's
        // FAQ mentions supervision at tier level, so scope to the step itself.
        const step = page.getByText('Practice requirements in Virginia').locator('xpath=..');
        await expect(step).toContainText('practice agreement documenting collaboration and consultation');
        await expect(step).not.toContainText(/supervis/i);
    });

    test('state checker: a below-gate state renders no salary card rather than a padded number', async ({ page }) => {
        await gotoOk(page, PATH);
        // Wyoming is below the publishing gate on every database this suite has seen.
        await page.locator('#lic-state').selectOption('Wyoming');
        await expect(page.getByRole('heading', { name: 'Wyoming Licensure' })).toBeVisible();
        const card = page.getByText('Median Salary in Wyoming');
        if ((await card.count()) > 0) {
            // If it ever clears the gate, the sample shown must actually clear it.
            const sample = Number(
                (await page.getByText('Salaried Postings').locator('xpath=preceding-sibling::div[1]').innerText()).replace(/,/g, ''),
            );
            expect(sample).toBeGreaterThanOrEqual(5);
        }
        await expectNoNaN(page);
    });

    test('planner: keyboard-selected states line up by authority; enacted-pending Massachusetts gets no compact verdict', async ({ page }) => {
        await gotoOk(page, PATH);
        expect(await page.locator('input[id^="planner-target-"]').count()).toBe(51);
        await expect(page.getByText('Pick the states you are considering')).toBeVisible();
        const clear = page.getByRole('button', { name: 'Clear selection' });
        await expect(clear).toBeDisabled();

        const ma = page.locator('#planner-target-massachusetts');
        await ma.focus();
        await page.keyboard.press('Space');
        await expect(ma).toBeChecked();
        await page.locator('#planner-target-texas').check();
        await page.locator('#planner-target-arizona').check();
        await expect(page.getByText('3 selected')).toBeVisible();

        await expect(page.getByText('Need their own APRN license', { exact: true }).locator('xpath=preceding-sibling::div[1]')).toHaveText('3');
        await expect(page.getByText('States selected', { exact: true }).locator('xpath=preceding-sibling::div[1]')).toHaveText('3');

        // Rows sort alphabetically: Arizona, Massachusetts, Texas.
        const rows = page.locator('.planner-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('h3')).toHaveText('Arizona');
        await expect(rows.nth(1).locator('h3')).toHaveText('Massachusetts');
        await expect(rows.nth(2).locator('h3')).toHaveText('Texas');
        await expect(rows.nth(2)).toContainText('Restricted practice');
        await expect(rows.nth(0)).toContainText('Full practice');

        // Massachusetts has ENACTED the NLC but implementation is pending. The
        // planner must not collapse that into a member / non-member verdict.
        const maRow = rows.nth(1);
        await expect(maRow).toContainText('APRN layer');
        await expect(maRow).not.toContainText(/\bMember\b/);
        await expect(maRow).not.toContainText(/not a member|non-member|no separate RN application/i);
        await expect(maRow.locator('a[href="/jobs/state/massachusetts"]')).toBeVisible();

        // The compact rules point at the live NCSBN roster instead of asserting membership.
        await expect(page.locator('a[href="https://www.nursecompact.com/"]').first()).toBeVisible();
        await expect(page.getByText('We do not publish a per-state member list here.')).toBeVisible();

        await clear.click();
        await expect(page.getByText('0 selected')).toBeVisible();
        await expect(page.getByText('Pick the states you are considering')).toBeVisible();
        await expect(ma).not.toBeChecked();
    });

    test('interactive states carry no dashes: Texas checker, three planner rows, and the citation block', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#lic-state').selectOption('Texas');
        await expect(page.getByRole('heading', { name: 'Texas Licensure' })).toBeVisible();
        await page.locator('#planner-target-massachusetts').check();
        await page.locator('#planner-target-texas').check();
        await page.locator('#planner-target-arizona').check();
        await expect(page.locator('.planner-row')).toHaveCount(3);
        await expectNoRenderedDashes(page, `${PATH} (Texas + planner)`);
    });

    test('copy-citation button is keyboard operable and copies the citation to the clipboard', async ({ page, context, browserName }) => {
        test.skip(browserName !== 'chromium', 'clipboard permissions are only grantable on chromium');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await gotoOk(page, PATH);
        const copy = page.getByRole('button', { name: 'Copy citation' });
        await copy.scrollIntoViewIfNeeded();
        await copy.focus();
        await expect(copy).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByText('Copied!')).toBeVisible();
        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboard).toContain(brand.name);
        expect(clipboard).toContain('State Licensure Checker');
        expect(clipboard).not.toMatch(/[–—]/);
        // The confirmation is transient (2 s) and the button stays usable afterwards.
        await expect(page.getByText('Copied!')).toBeHidden({ timeout: 5_000 });
        await page.keyboard.press('Enter');
        await expect(page.getByText('Copied!')).toBeVisible();
    });

    test('planner: toggling a state twice removes it; refresh clears the selection', async ({ page }) => {
        await gotoOk(page, PATH);
        const tx = page.locator('#planner-target-texas');
        await tx.check();
        await expect(page.locator('.planner-row')).toHaveCount(1);
        await tx.uncheck();
        await expect(page.locator('.planner-row')).toHaveCount(0);
        await expect(page.getByText('0 selected')).toBeVisible();
        await tx.check();
        await page.reload();
        await expect(page.locator('#planner-target-texas')).not.toBeChecked();
        await expect(page.getByText('Pick the states you are considering')).toBeVisible();
    });

    // D2 — app/tools/licensure-checker/page.tsx loadCheckerData reads guide slugs ONLY from
    // prisma.blogPost rows (status published, category state_spotlight). In the unsynced state
    // no such rows exist, so the checker's "Read Full <State> Guide" link and every planner
    // "<State> guide" link are silently omitted — while /blog/np-license-<state> renders for all
    // 51 states through the LICENSE_GUIDE_SERIES_PUBLISHED code fallback in lib/blog.ts.
    test('DEFECT: licensure checker and planner omit the state licensure-guide links in the unsynced state', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#lic-state').selectOption('Texas');
        await expect(page.locator('a[href="/blog/np-license-texas"]')).toBeVisible();
        await page.locator('#planner-target-massachusetts').check();
        await expect(page.locator('.planner-row').first().locator('a[href="/blog/np-license-massachusetts"]')).toBeVisible();
    });
});

// ── Employer salary benchmark ───────────────────────────────────────────────

test.describe('/tools/salary-benchmark', () => {
    const PATH = '/tools/salary-benchmark';

    test('national headline, offer standing below / inside / above the posted band', async ({ page }) => {
        await gotoOk(page, PATH);
        const headline = page.locator('div[aria-live="polite"]').first();
        await expect(headline).toContainText('$');
        const bandText = await page.getByText(/Middle of the market:/).innerText();
        const nums = [...bandText.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
        expect(nums.length).toBeGreaterThanOrEqual(2);
        const [p25, p75] = nums;
        expect(p25).toBeLessThanOrEqual(p75);
        const median = firstUsd(await headline.innerText());
        expect(median).toBeGreaterThanOrEqual(p25);
        expect(median).toBeLessThanOrEqual(p75);
        await expect(page.getByText(/from [\d,]+ published .* postings that disclose pay, across [\d,]+ employers/)).toBeVisible();

        const offer = page.locator('#benchmark-offer');
        await offer.fill(String(p25 - 10_000));
        await expect(page.getByText('Below the market range')).toBeVisible();
        await offer.fill(String(p75 + 10_000));
        await expect(page.getByText('Above the market range')).toBeVisible();
        await offer.fill(String(Math.round((p25 + p75) / 2)));
        await expect(page.getByText('Inside the market range')).toBeVisible();
        // Boundary values are inclusive on both ends of the band.
        await offer.fill(String(p25));
        await expect(page.getByText('Inside the market range')).toBeVisible();
        await offer.fill(String(p75));
        await expect(page.getByText('Inside the market range')).toBeVisible();

        // Zero / cleared offer removes the standing without error.
        await offer.fill('0');
        await expect(page.getByText(/the market range/)).toHaveCount(0);
        await offer.fill('');
        await expect(page.getByText(/the market range/)).toHaveCount(0);
        await expectNoNaN(page);
    });

    test('picking a state rescopes the headline and links its pay page', async ({ page }) => {
        await gotoOk(page, PATH);
        const select = page.locator('#benchmark-state');
        const options = await select.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
        test.skip(options.length === 0, 'no state has cleared the benchmark gate on this database');
        const state = options[0];
        await select.selectOption(state);
        await expect(page.getByText(`Median posted salary · ${state}`)).toBeVisible();
        const slug = state.toLowerCase().replace(/\s+/g, '-');
        await expect(page.locator(`a[href="/salary-guide/${slug}"]`)).toBeVisible();
        await select.selectOption('');
        await expect(page.getByText('Median posted salary · all states')).toBeVisible();
    });

    test('minimum-sample gate is stated on the page (5 postings from 3 employers)', async ({ page }) => {
        await gotoOk(page, PATH);
        await expect(page.getByText(/at least 5 salaried postings from at least 3 distinct employers/).first()).toBeVisible();
        await expect(page.getByText(/Aggregates only/)).toBeVisible();
        // Every state the picker offers must clear the gate it states; nothing below it is selectable.
        const options = await page.locator('#benchmark-state option').evaluateAll((els) =>
            els.map((e) => (e as HTMLOptionElement).textContent ?? ''),
        );
        for (const label of options) expect(label, 'option label must not carry a sample count or a figure').not.toMatch(/\$|\(\d+\)/);
    });

    test('keyboard-only: the offer field and state picker are reachable and the standing updates live', async ({ page }) => {
        await gotoOk(page, PATH);
        const offer = page.locator('#benchmark-offer');
        await offer.focus();
        await expect(offer).toBeFocused();
        const bandText = await page.getByText(/Middle of the market:/).innerText();
        const [p25] = [...bandText.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
        await retypeFocused(page, '#benchmark-offer', String(p25 - 5_000));
        await expect(page.getByText('Below the market range')).toBeVisible();
        await expect(offer).toHaveClass(/tool-control/);
        // Refresh mid-flow clears the draft offer and the standing.
        await page.reload();
        await expect(page.locator('#benchmark-offer')).toHaveValue('');
        await expect(page.getByText(/the market range/)).toHaveCount(0);
        await expectNoRenderedDashes(page, `${PATH} (after reload)`);
    });

    // D8 — components/tools/EmployerBenchmarkPicker.tsx parses the offer with
    // `offer.replace(/[^0-9.]/g, '')`, which strips the minus sign, so an offer of "-90000" is
    // graded as $90,000 and can read "Inside the market range". A negative offer is not an
    // offer; the widget should show no standing (the same branch it takes for 0 and blank).
    test('DEFECT: a negative planned offer is graded against the band as if it were positive', async ({ page }) => {
        await gotoOk(page, PATH);
        const headline = page.locator('div[aria-live="polite"]').first();
        const median = firstUsd(await headline.innerText());
        await page.locator('#benchmark-offer').fill(String(-median));
        await expect(page.getByText(/the market range/)).toHaveCount(0);
    });

    test('the auth-gated employer analytics benchmark API rejects an unauthenticated call', async ({ request }) => {
        const res = await request.get('/api/employer/analytics/benchmarks');
        expect([401, 403]).toContain(res.status());
        const body = await res.text();
        expect(body).not.toMatch(/median|p25|p75/i);
    });

    // D1 — components/tools/EmployerBenchmarkWidget.tsx loadBenchmarkSummary runs its OWN
    // prisma.job.findMany (published + non-estimated only) instead of lib/salary-analytics —
    // no salaryConfidence floor, no expiry filter, no contract-cadence exclusion and no
    // filterNpEligibleRows. Observed on this database: the tool lists Colorado, Indiana,
    // Maryland, Missouri, North Carolina, Ohio and Washington with a published median while
    // /salary-guide names each of them under "sample too small", and its national line says
    // "338 published NP postings … 40 employers" while /salary-guide/<state> says the national
    // base is "Median of 198 postings". The public page therefore publishes non-NP (psychiatrist,
    // PA, podiatrist) and expired pay as an NP benchmark.
    test('DEFECT: benchmark tool disagrees with /salary-guide on which states clear the gate and on the national sample', async ({ page }) => {
        await gotoOk(page, '/salary-guide');
        const smallBox = page.locator('div').filter({ hasText: 'States with too few postings for a reliable figure' }).last();
        const smallStates = await smallBox
            .locator('a.sal-state-link')
            .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\(.*\)/, '').trim()));
        await gotoOk(page, '/salary-guide/texas');
        const nationalLine = await page.getByText(/Median of [\d,]+ postings on /).innerText();
        const nationalSample = Number(nationalLine.match(/Median of ([\d,]+) postings/)![1].replace(/,/g, ''));

        await gotoOk(page, PATH);
        const published = await page.locator('#benchmark-state option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
        const contradictions = published.filter((s) => smallStates.includes(s));
        expect(contradictions, 'states published by the benchmark tool but gated out of /salary-guide').toEqual([]);
        const toolLine = await page.getByText(/from [\d,]+ published .* postings that disclose pay/).innerText();
        const toolSample = Number(toolLine.match(/from ([\d,]+) published/)![1].replace(/,/g, ''));
        expect(toolSample, 'benchmark national sample vs salary-guide national sample').toBe(nationalSample);
    });
});

// ── Specialty finder quiz ───────────────────────────────────────────────────

/**
 * WORKED EXAMPLE — from specialty-quiz-model.ts PROFILE_SEEDS: the neonatal
 * profile is (newborns, high, hospital, collaborative, many|some, episodic|either,
 * shifts, medical|either). Answering exactly those values matches 8/8 = 100%
 * and no other profile accepts 'newborns', so Neonatal is Match 1 and links
 * /jobs/neonatal.
 */
test.describe('/tools/specialty-finder', () => {
    const PATH = '/tools/specialty-finder';

    test('end-to-end: keyboard + click answers → 100% Neonatal → /jobs/neonatal', async ({ page }) => {
        await gotoOk(page, PATH);
        await expect(page.getByText('0 of 8 answered')).toBeVisible();
        await expect(page.getByText('Answer a question to see matches')).toBeVisible();
        const clear = page.getByRole('button', { name: 'Clear answers' });
        await expect(clear).toBeDisabled();

        // Question 1 by keyboard: focus the first radio, ArrowDown ×3 lands on "newborns".
        await page.locator('#q-population-lifespan').focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#q-population-newborns')).toBeChecked();
        await expect(page.getByText('1 of 8 answered')).toBeVisible();
        await expect(page.getByText('1/1 matched').first()).toBeVisible();

        await page.locator('#q-acuity-high').check();
        await page.locator('#q-setting-hospital').check();
        await page.locator('#q-autonomy-collaborative').check();
        await page.locator('#q-procedures-many').check();
        await page.locator('#q-continuity-episodic').check();
        await page.locator('#q-schedule-shifts').check();
        await page.locator('#q-careMix-medical').check();
        await expect(page.getByText('8 of 8 answered')).toBeVisible();

        const top = page.locator('article').first();
        await expect(top).toContainText('Match 1');
        await expect(top.locator('h3')).toHaveText('Neonatal');
        await expect(top).toContainText('100%');
        await expect(top).toContainText('8/8 matched');
        expect(await top.locator('span:has-text("Patient population")').count()).toBeGreaterThan(0);
        const openRoles = top.locator('a[href="/jobs/neonatal"]');
        await expect(openRoles).toHaveText(/Open roles/);

        // Second match must be strictly lower — no other profile takes 'newborns'.
        const second = page.locator('article').nth(1);
        await expect(second).not.toContainText('100%');
        await expectNoRenderedDashes(page, `${PATH} (8/8 answered)`);

        // Every "Open roles" link on the results targets a real specialty route, never a dead slug.
        const roleHrefs = await page.locator('article a[href^="/jobs/"]').evaluateAll((els) =>
            [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''))],
        );
        expect(roleHrefs.length).toBeGreaterThan(1);
        for (const href of roleHrefs) expect(href).toMatch(/^\/jobs\/[a-z0-9-]+$/);

        await Promise.all([
            page.waitForURL(/\/jobs\/neonatal$/, { timeout: 30_000 }),
            openRoles.click(),
        ]);
        await expect(page.locator('h1')).toHaveCount(1);

        // Back navigation lands on an intact quiz page.
        await page.goBack();
        await expect(page).toHaveURL(/\/tools\/specialty-finder$/);
        await expect(page.getByRole('heading', { name: 'Specialties that match your preferences' })).toBeVisible();
    });

    test('clear answers resets progress and results; refresh mid-quiz starts clean', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#q-population-adults').check();
        await page.locator('#q-acuity-low').check();
        await expect(page.getByText('2 of 8 answered')).toBeVisible();
        await page.getByRole('button', { name: 'Clear answers' }).click();
        await expect(page.getByText('0 of 8 answered')).toBeVisible();
        await expect(page.getByText('Answer a question to see matches')).toBeVisible();
        await expect(page.locator('#q-population-adults')).not.toBeChecked();

        await page.locator('#q-population-adults').check();
        await page.reload();
        await expect(page.getByText('0 of 8 answered')).toBeVisible();
        await expect(page.locator('#q-population-adults')).not.toBeChecked();
    });

    test('an APRN-axis match carries the distinct-role caution', async ({ page }) => {
        await gotoOk(page, PATH);
        // Reproductive + independent + many procedures + longitudinal: midwifery 4/4, women's health 3/4.
        await page.locator('#q-population-reproductive').check();
        await page.locator('#q-autonomy-independent').check();
        await page.locator('#q-procedures-many').check();
        await page.locator('#q-continuity-longitudinal').check();
        const top = page.locator('article').first();
        await expect(top).toContainText('100%');
        await expect(top).toContainText(/distinct advanced practice role/);
        await expect(top.locator('a[href="/jobs/midwifery"]')).toBeVisible();
    });
});

// ── Private practice revenue projector ──────────────────────────────────────

/**
 * WORKED EXAMPLE — from practice-revenue-model.ts. Default preset is the
 * guide's full-time telehealth row: visits midpoint round((22+28)/2)=25,
 * 46 weeks, $175 collected, overhead midpoint 20%, no-show 0, fixed 0.
 * scheduled = 25×46 = 1,150; gross = 1,150×175 = 201,250; overhead = 40,250;
 * net = 161,000; net/visit = 140.
 * Sensitivity, visits row: 20 → 128,800 ($129K); 22.5 → 144,900 ($145K);
 *   27.5 → 177,100 ($177K); 30 → 193,200 ($193K); swing 64,400 ($64K).
 * One more visit/week = 46×175×0.8 = 6,440.
 * No-show 10%: completed 1,035; gross 181,125; overhead 36,225; net 144,900.
 * Cash-pay preset: visits round(21.5)=22, $250, overhead 20% → gross 253,000, net 202,400.
 * Fixed costs $12,000 on the default: net 149,000.
 */
test.describe('/tools/private-practice-revenue-calculator', () => {
    const PATH = '/tools/private-practice-revenue-calculator';

    test('default preset reproduces the guide arithmetic and the sensitivity table', async ({ page }) => {
        await gotoOk(page, PATH);
        await expect(page.locator('#practice-scenario')).toHaveValue('full-time-telehealth');
        await expect(page.locator('#practice-visits')).toHaveValue('25');
        await expect(page.locator('#practice-weeks')).toHaveValue('46');
        await expect(page.locator('#practice-collected')).toHaveValue('175');
        await expect(page.locator('#practice-overhead')).toHaveValue('20');

        const headline = page.locator('div[aria-live="polite"]').first();
        await expect(headline).toHaveText('$161,000');
        await expect(page.getByText(/From 1,150 completed visits/)).toContainText('$201,250');
        await expect(page.getByText(/From 1,150 completed visits/)).toContainText('$40,250');

        const visitsRow = page.locator('table tbody tr', { hasText: 'Visits per week' });
        await expect(visitsRow).toContainText('you entered 25');
        const cells = visitsRow.locator('td');
        await expect(cells.nth(0)).toContainText('$129K');
        await expect(cells.nth(1)).toContainText('$145K');
        await expect(cells.nth(2)).toContainText('$177K');
        await expect(cells.nth(3)).toContainText('$193K');
        await expect(cells.nth(4)).toHaveText('$64K');
        await expect(page.getByText(/One more scheduled visit a week/)).toContainText('$6,440');
        // Column headings are relative moves (ASCII or Unicode minus), and the caption is present for screen readers.
        await expect(page.locator('table thead')).toContainText(/[−-]20%/);
        await expect(page.locator('table thead')).toContainText('+20%');
        await expect(page.locator('table caption')).toContainText('Modelled net before tax');
    });

    test('no-show, fixed costs and preset changes flow through; overhead over 100% is clamped without NaN', async ({ page }) => {
        await gotoOk(page, PATH);
        await fillNumber(page, '#practice-noshow', '10');
        const headline = page.locator('div[aria-live="polite"]').first();
        await expect(headline).toHaveText('$144,900');
        await expect(page.getByText(/From 1,035 completed visits/)).toBeVisible();
        await fillNumber(page, '#practice-noshow', '0');
        await fillNumber(page, '#practice-fixed', '12000');
        await expect(headline).toHaveText('$149,000');

        await page.selectOption('#practice-scenario', 'cash-pay');
        await expect(page.locator('#practice-visits')).toHaveValue('22');
        await expect(page.locator('#practice-collected')).toHaveValue('250');
        await expect(page.locator('#practice-noshow')).toHaveValue('0');
        await expect(page.locator('#practice-fixed')).toHaveValue('0');
        await expect(headline).toHaveText('$202,400');

        await fillNumber(page, '#practice-overhead', '150');
        await expect(headline).toHaveText('$0');
        await expectNoNaN(page);
        await fillNumber(page, '#practice-visits', '');
        await expect(headline).toHaveText('$0');
        await fillNumber(page, '#practice-visits', '-4');
        await expect(headline).toHaveText('$0');
        await expectNoNaN(page);
    });

    test('keyboard: Tab order runs scenario → visits → weeks and typing updates the net', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#practice-scenario').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#practice-visits')).toBeFocused();
        await retypeFocused(page, '#practice-visits', '30');
        await expect(page.locator('div[aria-live="polite"]').first()).toHaveText('$193,200');
        await page.keyboard.press('Tab');
        await expect(page.locator('#practice-weeks')).toBeFocused();
    });
});

// ── Employer cost-per-hire calculator ───────────────────────────────────────

/**
 * WORKED EXAMPLE — from cost-per-hire-model.ts with lib/config pricing on this
 * HEAD (single tier: $199 post / $179 renewal / 60-day paid window / 1 free
 * post per employer email domain, lifetime / 25 unlocks per posting) and
 * STAT_SOURCES.averageSalary $129,210.
 * Roles 3, renewals 1/role, free post on, 1 hire/role, 25 applicants/role:
 *   free 1, paid 2 × 199 = 398; renewals 3 × 179 = 537; total 935
 *   per hire 935/3 = 311.67 → $312; per applicant 935/75 = 12.47 → $12
 * CPC $600/role, 20 applicants/role: spend 1,800; 60 applicants; $30/applicant; $600/hire
 * Agency 20% × 129,210 = 25,842/role: spend 77,526; per hire $25,842; applicants n/a
 * Vacancy $500/day × 60 days × 3 roles = 90,000 on every channel:
 *   flat (935+90,000)/3 = 30,311.67 → $30,312; cpc 91,800/3 = $30,600; agency 167,526/3 = $55,842
 * Free post off, 1 role, 0 renewals → 1 paid post → $199.
 * Default (1 role, free post on, 0 renewals) → $0, "free first post doing the work".
 * 2.7 roles (free on, 0 renewals): floor → 2 roles, 1 free + 1 paid = $199 / 2 hires = 99.50 → $100.
 */
test.describe('/tools/cost-per-hire-calculator', () => {
    const PATH = '/tools/cost-per-hire-calculator';
    const headline = (page: Page) => page.locator('div[aria-live="polite"]').first();

    test('defaults: $0 with the free first post applied, other channels honestly "not comparable"', async ({ page }) => {
        await gotoOk(page, PATH);
        await expect(page.locator('#cph-roles')).toHaveValue('1');
        await expect(page.locator('#cph-hires')).toHaveValue('1');
        await expect(page.locator('#cph-renewals')).toHaveValue('0');
        await expect(page.locator('#cph-flat-applicants')).toHaveValue('25');
        await expect(page.locator('#cph-base')).toHaveValue('129210');
        await expect(page.locator('#cph-free-post')).toBeChecked();
        await expect(headline(page)).toHaveText('$0');
        await expect(page.getByText(/1 free post, 0 paid posts at \$199 and 0 renewals at \$179, for/)).toContainText('$0 in total');
        await expect(page.getByText(/That is the free first post doing the work/)).toBeVisible();
        await expect(page.getByText('Not comparable. Enter the sponsored spend per role from your own invoice.')).toBeVisible();
        await expect(page.getByText('Not comparable. Enter the contingency rate in your agency agreement.')).toBeVisible();
        await expect(page.locator('table thead')).toContainText('Per hire + vacancy (off)');
        // The free post is scoped to the email DOMAIN, rendered from the one shared note
        // (FREE_POST_SCOPE_NOTE) in both the widget and the assumptions panel.
        expect(await page.getByText(/1 free post per employer email domain, lifetime, shared across everyone at your organization/).count()).toBeGreaterThanOrEqual(2);
        const panel = page.locator('section[aria-labelledby="tool-assumptions-heading"]');
        await expect(panel).toContainText('$199 per post for 60 days, $179 per renewal');
        await expectNoRenderedDashes(page, `${PATH} (defaults)`);
    });

    test('worked example: three channels priced on the employer\'s own numbers', async ({ page }) => {
        await gotoOk(page, PATH);
        await expect(page.locator('#cph-free-post')).toBeChecked();
        await fillNumber(page, '#cph-roles', '3');
        await fillNumber(page, '#cph-hires', '1');
        await fillNumber(page, '#cph-flat-applicants', '25');
        await fillNumber(page, '#cph-renewals', '1');
        await fillNumber(page, '#cph-cpc-spend', '600');
        await fillNumber(page, '#cph-cpc-applicants', '20');
        await fillNumber(page, '#cph-agency-pct', '20');

        await expect(headline(page)).toHaveText('$312');
        await expect(page.getByText(/1 free post, 2 paid posts at \$199 and 3 renewals at \$179, for/)).toContainText('$935 in total');
        await expect(page.getByText(/any channel costing more than/)).toContainText('$312');

        const rows = page.locator('table tbody tr');
        const flat = rows.filter({ hasText: 'Flat-fee posting' });
        await expect(flat.locator('td').nth(0)).toHaveText('$935');
        await expect(flat.locator('td').nth(1)).toHaveText('75');
        await expect(flat.locator('td').nth(2)).toHaveText('$12');
        await expect(flat.locator('td').nth(3)).toHaveText('$312');
        await expect(flat.locator('td').nth(4)).toHaveText('n/a');

        const cpc = rows.filter({ hasText: 'Sponsored / cost-per-click' });
        await expect(cpc.locator('td').nth(0)).toHaveText('$1,800');
        await expect(cpc.locator('td').nth(1)).toHaveText('60');
        await expect(cpc.locator('td').nth(2)).toHaveText('$30');
        await expect(cpc.locator('td').nth(3)).toHaveText('$600');

        const agency = rows.filter({ hasText: 'Agency / contingency search' });
        await expect(agency.locator('td').nth(0)).toHaveText('$77,526');
        await expect(agency.locator('td').nth(1)).toHaveText('n/a');
        await expect(agency.locator('td').nth(2)).toHaveText('n/a');
        await expect(agency.locator('td').nth(3)).toHaveText('$25,842');

        const verdict = page.getByText(/On the numbers you entered,/);
        await expect(verdict).toContainText('flat-fee posting');
        await expect(verdict).toContainText('$312');
        await expect(verdict).toContainText('agency / contingency search');
        await expect(verdict).toContainText('$25,842');

        // Vacancy overlay: $500/day × the shared 60-day default × 3 roles on every channel.
        await fillNumber(page, '#cph-vacancy-cost', '500');
        await expect(page.locator('table thead')).not.toContainText('(off)');
        await expect(page.locator('table thead')).toContainText('Per hire + vacancy');
        await expect(flat.locator('td').nth(4)).toHaveText('$30,312');
        await expect(cpc.locator('td').nth(4)).toHaveText('$30,600');
        await expect(agency.locator('td').nth(4)).toHaveText('$55,842');
        await expectNoNaN(page);
        await expectNoRenderedDashes(page, `${PATH} (worked example)`);

        // Free post off (a colleague at the domain used it), one role, no renewals → one paid post.
        await fillNumber(page, '#cph-roles', '1');
        await fillNumber(page, '#cph-renewals', '0');
        const freePost = page.locator('#cph-free-post');
        await freePost.focus();
        await page.keyboard.press('Space');
        await expect(freePost).not.toBeChecked();
        await expect(headline(page)).toHaveText('$199');
        await expect(page.getByText(/1 paid post at \$199 and 0 renewals at \$179, for/)).toContainText('$199 in total');
        await expect(page.getByText(/free post,/)).toHaveCount(0);
        // Double toggle is idempotent: back on, back to $0.
        await page.keyboard.press('Space');
        await expect(freePost).toBeChecked();
        await expect(headline(page)).toHaveText('$0');
    });

    test('zero / fractional inputs report not-comparable or clamp to whole roles, never NaN', async ({ page }) => {
        await gotoOk(page, PATH);
        await fillNumber(page, '#cph-roles', '0');
        await expect(headline(page)).toHaveText('n/a');
        await expect(page.getByText('Not comparable. Enter how many roles you plan to fill.')).toBeVisible();
        await expectNoNaN(page);
        await fillNumber(page, '#cph-roles', '2.7');
        // Whole roles only: floor(2.7) = 2 → 1 free + 1 paid ($199) over 2 hires = $99.50 → $100.
        await expect(headline(page)).toHaveText('$100');
        // Zero hires: spend exists but no divisor → per-hire is n/a, not Infinity.
        await fillNumber(page, '#cph-hires', '0');
        await expect(headline(page)).toHaveText('n/a');
        await expect(page.locator('table tbody tr').filter({ hasText: 'Flat-fee posting' }).locator('td').nth(3)).toHaveText('n/a');
        await expectNoNaN(page);
        // Refresh mid-flow returns to the defaults.
        await page.reload();
        await expect(page.locator('#cph-roles')).toHaveValue('1');
        await expect(headline(page)).toHaveText('$0');
    });

    test('keyboard-only: Tab order runs roles → hires, typing a new role count reprices the plan', async ({ page }) => {
        await gotoOk(page, PATH);
        await page.locator('#cph-roles').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#cph-hires')).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#cph-roles')).toBeFocused();
        await retypeFocused(page, '#cph-roles', '4');
        // 1 free + 3 paid × $199 = $597 over 4 hires = 149.25 → $149.
        await expect(headline(page)).toHaveText('$149');
        await expect(page.locator('#cph-roles')).toHaveClass(/tool-control/);
    });

    // D7 — components/tools/EmployerCostPerHireCalculator.tsx `num()` parses drafts with
    // `raw.replace(/[^0-9.]/g, '')`, which strips the minus sign, so "-500" becomes 500 before
    // it reaches the model's atLeastZero clamp. Observed: sponsored spend "-500" over 2 roles
    // renders "$1,000" total and "$500" per hire instead of "Not comparable". The same parser
    // shape sits in EmployerBenchmarkPicker.tsx (D8 below).
    test('DEFECT: a negative sponsored spend is treated as positive spend instead of clamped to zero', async ({ page }) => {
        await gotoOk(page, PATH);
        await fillNumber(page, '#cph-roles', '2');
        await fillNumber(page, '#cph-cpc-spend', '-500');
        await expect(page.getByText('Not comparable. Enter the sponsored spend per role from your own invoice.')).toBeVisible();
        const cpc = page.locator('table tbody tr').filter({ hasText: 'Sponsored / cost-per-click' });
        await expect(cpc).not.toContainText('$1,000');
        await expectNoNaN(page);
    });
});

// ── Salary guide ────────────────────────────────────────────────────────────

test.describe('/salary-guide', () => {
    /** The "too few postings" box on the hub, and its state links. */
    function smallSampleBox(page: Page) {
        return page.locator('div').filter({ hasText: 'States with too few postings for a reliable figure' }).last();
    }

    test('hub: cited national median, provenance line, and honest sub-gate list without ranked badges', async ({ page }) => {
        await gotoOk(page, '/salary-guide');
        await expect(page.locator('h1')).toContainText(/Salary/);
        await expect(page.getByText(/BLS OEWS/).first()).toBeVisible();
        await expect(page.getByText(/Sources: BLS OEWS/)).toBeVisible();
        await expect(page.getByText(/own editorial estimate/).first()).toBeVisible();
        await expect(page.getByText(/Fewer than 5 qualifying postings \(or fewer than 3 employers\), so the sample is too small/)).toBeVisible();
        // The sub-gate list names states with a raw count only — no dollar figure next to them.
        const box = smallSampleBox(page);
        for (const text of await box.locator('a.sal-state-link').allInnerTexts()) {
            expect(text, 'below-gate state must not carry a dollar figure').not.toMatch(/\$/);
            expect(text).toMatch(/\(\d+\)/);
        }
        // No medal / rank badges anywhere on the ranked table (review P9 #2d).
        await expect(page.locator('body')).not.toContainText(/🥇|🥈|🥉/);
    });

    test('a state BELOW the gate says "Sample too small" and publishes no figure or rank', async ({ page, guard }) => {
        await gotoOk(page, '/salary-guide');
        const links = smallSampleBox(page).locator('a.sal-state-link');
        const count = await links.count();
        test.skip(count === 0, 'every state currently clears the gate — no below-gate state to test');
        const href = await links.first().getAttribute('href');
        expect(href).toMatch(/^\/salary-guide\/[a-z-]+$/);
        // D4 is covered by its own fixme below; keep this test about the gate.
        guard.allow(/\/jobs\/(city|metro)\//);
        await gotoOk(page, href!);
        await expectPageBasics(page, href!);
        await expect(page.getByText('Sample too small', { exact: true })).toBeVisible();
        await expect(page.getByText(/Needs 5\+ postings from 3\+ employers/)).toBeVisible();
        await expect(page.getByText('Published once the sample clears the gate')).toBeVisible();
        // The only "Median of N postings" line allowed is the NATIONAL base, never a state figure.
        await expect(page.getByText(/Median of \d+ postings · /)).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/#\d+ (in the nation|nationally|ranked)/i);
        await expect(page.locator('body')).not.toContainText(/🥇|🥈|🥉/);
        // Back navigation lands on an intact hub with the same gate box.
        await page.goBack();
        await expect(page).toHaveURL(/\/salary-guide$/);
        await expect(smallSampleBox(page)).toBeVisible();
    });

    test('state page FAQ uses native <details>: first open by default, keyboard toggles the rest', async ({ page, guard }) => {
        guard.allow(/\/jobs\/(city|metro)\//);
        await gotoOk(page, '/salary-guide/texas');
        const faqs = page.locator('details').filter({ has: page.locator('summary') });
        expect(await faqs.count()).toBeGreaterThanOrEqual(2);
        await expect(faqs.first()).toHaveAttribute('open', '');
        const second = faqs.nth(1);
        await expect(second).not.toHaveAttribute('open', '');
        await second.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(second).toHaveAttribute('open', '');
        await expect(second.locator('p').first()).toBeVisible();
        await page.keyboard.press('Space');
        await expect(second).not.toHaveAttribute('open', '');
        // The visible FAQ and the FAQPage JSON-LD are rendered from the same array.
        const ld = (await page.locator('script[type="application/ld+json"]').allInnerTexts()).join('\n');
        const firstQuestion = (await faqs.first().locator('summary').innerText()).trim();
        expect(ld).toContain('FAQPage');
        expect(ld.replace(/\\u0026/g, '&')).toContain(firstQuestion.slice(0, 40).replace(/&/g, '&'));
    });

    test('a state ABOVE the gate publishes a true median with its sample and quartiles', async ({ page, guard }) => {
        guard.allow(/\/jobs\/(city|metro)\//);
        await gotoOk(page, '/salary-guide/texas');
        await expect(page.getByText('Sample too small')).toHaveCount(0);
        const sub = page.getByText(/Median of \d+ postings · /);
        await expect(sub).toBeVisible();
        const n = Number((await sub.innerText()).match(/Median of (\d+) postings/)![1]);
        expect(n).toBeGreaterThanOrEqual(5);
        await expect(page.getByText('25th to 75th percentile')).toBeVisible();
        await expect(page.getByText(/National Median/).first()).toBeVisible();
        // Provenance line (components/SalaryProvenance.tsx): the live basis, never a fabricated date.
        await expect(page.getByText(/Based on [\d,]+ active postings with disclosed salary on /).first()).toBeVisible();
        await expect(page.getByText(/recomputed as postings are ingested daily/).first()).toBeVisible();
    });

    test('specialty page renders with provenance', async ({ page }) => {
        await gotoOk(page, '/salary-guide/specialty/family-practice');
        await expect(page.locator('h1')).toContainText(/Family Practice/);
        await expect(page.getByText(/Source/).first()).toBeVisible();
        await expect(page.getByText(/BLS/).first()).toBeVisible();
        await gotoOk(page, '/salary-guide/specialty');
        await expect(page.locator('a[href="/salary-guide/specialty/family-practice"]').first()).toBeVisible();
    });

    // D4 — app/salary-guide/[state]/page.tsx topCities filters on cityLinkResolves (slug
    // round-trip) but NOT on the MIN_JOBS = 3 render gate that app/jobs/city/[slug]/page.tsx
    // enforces with notFound(), so the "Top Cities in <ST>" sidebar links pages that 404.
    // Observed: Colorado 6 of 8 links 404, Texas 5 of 9, Wyoming 2 of 2. The same route is
    // correctly gated by the COL comparator (city-picker-data cityJobsHref).
    test('DEFECT: /salary-guide/<state> "Top Cities" sidebar links /jobs/city pages that 404', async ({ page, request }) => {
        for (const state of ['texas', 'colorado']) {
            await gotoOk(page, `/salary-guide/${state}`);
            const hrefs = await page.locator('a[href^="/jobs/city/"]').evaluateAll((els) =>
                [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''))],
            );
            expect(hrefs.length, `${state} should list top cities`).toBeGreaterThan(0);
            const dead: string[] = [];
            for (const href of hrefs) {
                // A fresh client IP per probe: /jobs/city is rate limited per IP and a 429 is not a dead link.
                const res = await request.get(href, { maxRedirects: 0, headers: { 'x-forwarded-for': uniqueIp() } });
                if (![200, 301, 308].includes(res.status())) dead.push(`${href} → ${res.status()}`);
            }
            expect(dead, `dead city links on /salary-guide/${state}`).toEqual([]);
        }
    });
});

// ── Scope-of-practice explorer ──────────────────────────────────────────────

test.describe('/scope-of-practice explorer', () => {
    test('51 rows, search by name and code, tier filters with aria-pressed, keyboard sort with aria-sort', async ({ page }) => {
        await gotoOk(page, '/scope-of-practice');
        await expect(page.getByText('Showing 51 of 51 jurisdictions')).toBeVisible();
        const rows = page.locator('table tbody tr');
        await expect(rows).toHaveCount(51);

        const search = page.locator('#sop-state-search');
        await expect(page.locator('label[for="sop-state-search"]')).toBeVisible();
        await search.fill('TX');
        await expect(page.getByText('Showing 1 of 51 jurisdictions')).toBeVisible();
        await expect(rows.first()).toContainText('Texas');
        await search.fill('new');
        expect(await rows.count()).toBeGreaterThanOrEqual(4); // New Hampshire/Jersey/Mexico/York
        await search.fill('zzz');
        await expect(page.getByText('No jurisdictions match')).toBeVisible();
        await search.fill('');
        await expect(rows).toHaveCount(51);

        // Tier filters — keyboard operable toggle buttons.
        const group = page.getByRole('group', { name: 'Filter by practice authority tier' });
        const fullBtn = group.getByRole('button', { name: /^Full \(\d+\)$/ });
        const fullCount = Number((await fullBtn.innerText()).match(/\((\d+)\)/)![1]);
        await fullBtn.focus();
        await page.keyboard.press('Space');
        await expect(fullBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(rows).toHaveCount(fullCount);
        await expect(page.getByText(`Showing ${fullCount} of 51 jurisdictions`)).toBeVisible();
        for (const badge of await rows.locator('td:nth-child(2) span').allInnerTexts()) {
            expect(badge).toMatch(/Full/);
        }
        // Search composes with the tier filter (Texas is restricted → nothing under "Full").
        await search.fill('Texas');
        await expect(page.getByText('No jurisdictions match')).toBeVisible();
        await search.fill('');
        await group.getByRole('button', { name: /^All \(51\)$/ }).click();
        await expect(rows).toHaveCount(51);

        // Sort by authority via keyboard: most autonomous first, then reversed.
        const authorityHeader = page.locator('th', { hasText: 'Practice authority' });
        const authorityBtn = authorityHeader.getByRole('button');
        const stateHeader = page.locator('th', { hasText: /^State/ });
        await expect(stateHeader).toHaveAttribute('aria-sort', 'ascending');
        await authorityBtn.focus();
        await page.keyboard.press('Enter');
        await expect(authorityHeader).toHaveAttribute('aria-sort', 'ascending');
        await expect(rows.first().locator('td:nth-child(2)')).toContainText(/Full/);
        await expect(rows.last().locator('td:nth-child(2)')).toContainText(/Restricted/);
        await page.keyboard.press('Enter');
        await expect(authorityHeader).toHaveAttribute('aria-sort', 'descending');
        await expect(rows.first().locator('td:nth-child(2)')).toContainText(/Restricted/);
        // Only one column carries aria-sort at a time; state sort descending puts Wyoming first.
        await expect(stateHeader).not.toHaveAttribute('aria-sort', /ascending|descending/);
        await stateHeader.getByRole('button').click();
        await stateHeader.getByRole('button').click();
        await expect(stateHeader).toHaveAttribute('aria-sort', 'descending');
        await expect(rows.first()).toContainText('Wyoming');
    });

    test('NLC tri-state: Massachusetts renders "Enacted, implementation pending" with the NCSBN verification date', async ({ page }) => {
        await gotoOk(page, '/scope-of-practice');
        await page.locator('#sop-state-search').fill('Massachusetts');
        await expect(page.getByText('Showing 1 of 51 jurisdictions')).toBeVisible();
        const row = page.locator('table tbody tr').first();
        await expect(row).toContainText('Massachusetts');
        await expect(row).toContainText('Enacted, implementation pending');
        await expect(row).not.toContainText(/\bMember\b/);
        await expect(row).not.toContainText(/Not a member/);
        await expectNoRenderedDashes(page, '/scope-of-practice (Massachusetts row)');
        await expect(page.getByText(/verified 2026-08-11/).first()).toBeVisible();
        // Row links resolve to real routes.
        await expect(row.locator('a[href="/blog/np-license-massachusetts"]')).toBeVisible();
        await expect(row.locator('a[href="/salary-guide/massachusetts"]')).toBeVisible();
        await expect(row.locator('a[href="/jobs/state/massachusetts"]')).toBeVisible();
        // The three statuses are all represented across the table.
        await page.locator('#sop-state-search').fill('');
        await expect(page.locator('table tbody').getByText('Member', { exact: true }).first()).toBeVisible();
        await expect(page.locator('table tbody').getByText('Not a member', { exact: true }).first()).toBeVisible();
        // Alaska is a known non-member (the stale set that once omitted it is the thing this page replaced).
        await page.locator('#sop-state-search').fill('Alaska');
        await expect(page.locator('table tbody tr').first()).toContainText('Not a member');
    });
});

// ── /compare ────────────────────────────────────────────────────────────────

test.describe('/compare', () => {
    const PAGES = ['np-hiring-vs-indeed', 'np-hiring-vs-aanp-jobcenter', 'np-hiring-vs-enp-network'];

    test('hub links all three comparisons', async ({ page }) => {
        await gotoOk(page, '/compare');
        for (const slug of PAGES) await expect(page.locator(`a[href="/compare/${slug}"]`).first()).toBeVisible();
    });

    for (const slug of PAGES) {
        test(`${slug}: dated claims footer and review date on the page`, async ({ page }) => {
            await gotoOk(page, `/compare/${slug}`);
            await expect(page.getByText(/Claims checked against .* on August 6, 2026/)).toBeVisible();
            await expect(page.getByText(/Counts and prices are snapshots/)).toBeVisible();
            await expect(page.getByText(/If you spot something outdated or incorrect/)).toBeVisible();
            await expect(page.getByRole('heading', { name: 'How we verified this page' })).toBeVisible();
            // Every "pages reviewed" citation is an external, absolute URL, and the competitor
            // gets its own "does better" section (the honesty contract of the page).
            const reviewed = page.locator('h2:has-text("How we verified this page")').locator('xpath=following-sibling::ul[1]//a');
            expect(await reviewed.count()).toBeGreaterThan(0);
            for (const href of await reviewed.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''))) {
                expect(href, 'reviewed page citation').toMatch(/^https?:\/\//);
            }
            const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
            expect(ld.some((t) => t.includes('2026-08-06'))).toBe(true);
        });
    }
});

// ── /reports ────────────────────────────────────────────────────────────────

test.describe('/reports', () => {
    test('hub links both reports', async ({ page }) => {
        await gotoOk(page, '/reports');
        await expect(page.locator('a[href="/reports/pay-transparency"]').first()).toBeVisible();
        await expect(page.locator('a[href="/reports/state-of-np-hiring-2026"]').first()).toBeVisible();
    });

    test('pay transparency report: rate section and methodology render; no padded number', async ({ page }) => {
        await gotoOk(page, '/reports/pay-transparency');
        await expect(page.locator('#rate')).toBeVisible();
        await expect(page.locator('#methodology')).toBeVisible();
        await expect(page.locator('#rate')).not.toContainText(/\bNaN\b|undefined/);
    });

    // D5 — app/reports/pay-transparency/page.tsx is ISR (revalidate = 3600). When
    // lib/reports/queries.ts loadHiringReportSnapshot catches a transient DB error
    // (`prisma:error timeout exceeded when trying to connect` under load, see next-start.log)
    // it returns null and the page renders "The live figure is unavailable right now … Reload
    // later." — and THAT render is cached for the next hour, so reloading does not help. The
    // sibling report regenerated in the same minute with live data. A caught data failure
    // should not be persisted as the page (throw to keep the previous render, or set a short
    // revalidate / no-store on the error branch).
    test('DEFECT: pay-transparency caches the transient "live figure unavailable" render for an hour', async ({ page }) => {
        await gotoOk(page, '/reports/pay-transparency');
        const text = await page.locator('#rate').innerText();
        expect(/\d+(\.\d+)?%/.test(text) || /Sample too small to publish/.test(text), text).toBe(true);
        await expect(page.locator('#rate')).not.toContainText('unavailable right now');
    });

    test('state of NP hiring report: every section is a figure, a sample-too-small note or an honest omission, never a padded number', async ({ page }) => {
        await gotoOk(page, '/reports/state-of-np-hiring-2026');
        // The cited context and methodology never depend on the live snapshot.
        await expect(page.locator('#context')).toBeVisible();
        await expect(page.locator('#methodology')).toBeVisible();
        await expect(page.getByRole('link', { name: 'how to cite us' })).toHaveAttribute('href', '/press');
        const omitted = page.getByText(/The live aggregates are unavailable right now/);
        if ((await omitted.count()) > 0) {
            // Honest omission: no board-derived section may render from stored constants.
            for (const id of ['inventory', 'specialty', 'states', 'mode', 'new-grad', 'pay']) {
                await expect(page.locator(`#${id}`), `section #${id} must be omitted, not padded`).toHaveCount(0);
            }
        } else {
            for (const id of ['inventory', 'specialty', 'states', 'mode', 'new-grad', 'pay']) {
                await expect(page.locator(`#${id}`), `section #${id}`).toBeVisible();
            }
            await expect(page.getByText(/Live figures as of/)).toBeVisible();
        }
        await expectNoNaN(page);
        await expect(page.locator('body')).not.toContainText('undefined%');
    });

    // D5b — the same ISR trap on the sibling report: app/reports/state-of-np-hiring-2026/page.tsx
    // renders "The live aggregates are unavailable right now … reload later" when
    // loadHiringReportSnapshot returns null, and that render is what revalidate caches. Observed
    // on this run: BOTH reports served the omission branch for the whole session while
    // /salary-guide/<state> and /tools/salary-benchmark read the same database live.
    test('DEFECT: state-of-NP-hiring report serves the "live aggregates unavailable" render while the database is reachable', async ({ page }) => {
        await gotoOk(page, '/reports/state-of-np-hiring-2026');
        await expect(page.getByText(/The live aggregates are unavailable right now/)).toHaveCount(0);
        await expect(page.locator('#inventory')).toBeVisible();
    });
});

// ── /resources + guides ─────────────────────────────────────────────────────

test.describe('/resources', () => {
    test('hub lists the three guides and the full tools band', async ({ page }) => {
        await gotoOk(page, '/resources');
        for (const href of ['/resources/1099-vs-w2', '/resources/fpa-guide', '/resources/private-practice-guide']) {
            await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
        }
        for (const path of TOOL_PATHS) await expect(page.locator(`a[href="${path}"]`).first()).toBeVisible();
    });

    for (const path of ['/resources/1099-vs-w2', '/resources/fpa-guide', '/resources/private-practice-guide']) {
        test(`${path}: dated "Last Updated" line and a single H1`, async ({ page }) => {
            await gotoOk(page, path);
            await expect(page.getByText(/Last Updated: [A-Z][a-z]+ \d{4}/)).toBeVisible();
        });
    }

    test('the private-practice guide publishes the row the revenue projector mirrors', async ({ page }) => {
        // The projector's GUIDE_MODEL / GUIDE_SCENARIOS mirror this page; the row and the $175 collected figure must be on it.
        await gotoOk(page, '/resources/private-practice-guide');
        await expect(page.getByText(/Full-time telehealth/i).first()).toBeVisible();
        await expect(page.getByText(/\$175/).first()).toBeVisible();
    });
});

// ── /blog ───────────────────────────────────────────────────────────────────

test.describe('/blog', () => {
    test('index renders clean in the unsynced (no DB posts) or synced state', async ({ page }) => {
        await gotoOk(page, '/blog');
        const cards = page.locator('a[href^="/blog/"]:not([href*="?"])');
        const empty = page.getByText('No posts found');
        const n = await cards.count();
        if (n === 0) {
            await expect(empty).toBeVisible();
            await expect(page.getByText('No blog posts have been published yet. Please check back soon.')).toBeVisible();
        } else {
            await expect(empty).toHaveCount(0);
        }
        // Category filter keeps rendering, with its own empty-state copy.
        await gotoOk(page, '/blog?category=state_spotlight');
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('body')).not.toContainText('Application error');
        if ((await page.locator('a[href^="/blog/"]:not([href*="?"])').count()) === 0) {
            await expect(page.getByText('There are no posts in this category yet. Please check back soon.')).toBeVisible();
        }
    });

    test('hostile query params: garbage page numbers and a script-tag category render clean and unreflected', async ({ page }) => {
        for (const path of ['/blog?page=abc', '/blog?page=999', '/blog?page=-1', '/blog?category=state_spotlight&page=2']) {
            await gotoOk(page, path);
            await expect(page.locator('h1')).toHaveCount(1);
            await expect(page.locator('body')).not.toContainText('Application error');
        }
        await gotoOk(page, '/blog?category=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
        const html = await page.content();
        expect(html).not.toContain('<script>alert(1)</script>');
        await expect(page.locator('h1')).toHaveCount(1);
    });

    test('RSS feed serves XML', async ({ request }) => {
        const res = await request.get('/blog/feed.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type'] ?? '').toMatch(/xml/);
        expect(await res.text()).toMatch(/<rss|<feed/);
    });

    test('licensure guide /blog/np-license-texas renders with compact status and board link', async ({ page }) => {
        await gotoOk(page, '/blog/np-license-texas');
        await expect(page.locator('h1')).toContainText('Texas');
        await expect(page.getByText(/Nurse Licensure Compact/).first()).toBeVisible();
        await expect(page.locator('a[href*="ncsbn.org"]').first()).toBeAttached();
        await expect(page.locator('a[href="/jobs/state/texas"]').first()).toBeAttached();
    });

    test('enacted-pending licensure guide (Massachusetts) says implementation is pending, not "member"', async ({ page }) => {
        await gotoOk(page, '/blog/np-license-massachusetts');
        await expect(page.getByText(/implementation is pending/).first()).toBeVisible();
        await expect(page.getByText(/verified against the live NCSBN roster/).first()).toBeVisible();
    });

    // D6a — the four-post certification series ships in content/blog/*.mdx and is wired into
    // config/niche/content-map.ts, but /blog/[slug] resolves only blog_posts rows (plus the
    // license-guide code fallback in lib/blog.ts getPostBySlug). Until scripts/sync-blog-to-db.ts
    // runs against this database every certification guide 404s.
    test('DEFECT: certification guide /blog/pmhnp-certification-guide 404s in the unsynced state', async ({ page }) => {
        await gotoOk(page, '/blog/pmhnp-certification-guide');
        await expectPageBasics(page, '/blog/pmhnp-certification-guide');
        await expect(page.locator('h1')).toContainText(/Certification/i);
        await gotoOk(page, '/blog/fnp-certification-aanp-vs-ancc');
        await expect(page.locator('h1')).toContainText(/FNP|Certification/i);
    });

    // D6b — lib/blog.ts getAllPublishedSlugs appends the 51 code-generated license guides to the
    // sitemap, but getPublishedPosts (the index) does not, so /blog says "No blog posts published
    // yet" while 51 guides are live and indexable.
    test('DEFECT: blog index omits the 51 live license guides and claims nothing is published', async ({ page }) => {
        await gotoOk(page, '/blog?category=state_spotlight');
        // The index paginates 12 per page in alphabetical state order, so page 1 carries
        // Alabama and Texas lands on a later page; walk the pages until it appears.
        await expect(page.locator('a[href^="/blog/np-license-"]').first()).toBeVisible();
        await expect(page.getByText('No posts found')).toHaveCount(0);
        let foundTexas = false;
        for (let n = 1; n <= 6 && !foundTexas; n++) {
            if (n > 1) await gotoOk(page, `/blog?category=state_spotlight&page=${n}`);
            foundTexas = (await page.locator('a[href="/blog/np-license-texas"]').count()) > 0;
        }
        expect(foundTexas, 'the Texas license guide is reachable from the paginated blog index').toBe(true);
    });
});

// ── /faq accordion ──────────────────────────────────────────────────────────

test.describe('/faq', () => {
    test('accordion is keyboard operable with aria-expanded and single-open behaviour within a group', async ({ page }) => {
        await gotoOk(page, '/faq');
        // Scope to the first group: panel ids repeat across groups (see the fixme below).
        const group = page.locator('section').filter({ has: page.locator('button[aria-expanded][aria-controls^="faq-answer-"]') }).first();
        const buttons = group.locator('button[aria-expanded][aria-controls^="faq-answer-"]');
        expect(await buttons.count()).toBeGreaterThan(2);
        expect(await page.locator('button[aria-expanded][aria-controls^="faq-answer-"]').count()).toBeGreaterThan(5);
        const first = buttons.nth(0);
        const second = buttons.nth(1);
        await expect(first).toHaveAttribute('aria-expanded', 'false');
        const panelId = await first.getAttribute('aria-controls');
        const panel = group.locator(`[id="${panelId}"]`).first();
        await expect(panel).toBeHidden();

        await first.focus();
        await page.keyboard.press('Enter');
        await expect(first).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        expect((await panel.innerText()).trim().length).toBeGreaterThan(20);

        await page.keyboard.press('Space');
        await expect(first).toHaveAttribute('aria-expanded', 'false');
        await expect(panel).toBeHidden();

        // Double-activation is idempotent: two rapid Enters land closed again, never a stuck state.
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await expect(first).toHaveAttribute('aria-expanded', 'false');

        // Opening the second closes the first within the same group.
        await first.click();
        await second.click();
        await expect(second).toHaveAttribute('aria-expanded', 'true');
        await expect(first).toHaveAttribute('aria-expanded', 'false');
    });

    // D3 — components/FAQAccordion.tsx builds `faq-answer-${index}` from the item index and
    // app/faq/page.tsx mounts six accordions, so /faq serves faq-answer-0 … faq-answer-N six
    // times each (37 panels, 7 duplicated ids observed). Duplicate ids make every button's
    // aria-controls point at the FIRST group's panel and break in-page anchors.
    test('DEFECT: FAQ accordion panel ids / aria-controls are duplicated across the six groups', async ({ page }) => {
        await gotoOk(page, '/faq');
        const ids = await page.locator('[id^="faq-answer-"]').evaluateAll((els) => els.map((e) => e.id));
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect([...new Set(dupes)], 'duplicated panel ids').toEqual([]);
        // Every accordion aria-controls must resolve to exactly one element (scoped to the page
        // body: the header menu toggle points at a menu that mounts only while it is open).
        const controls = await page.locator('#main-content button[aria-controls]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-controls') ?? ''));
        for (const id of controls) expect(await page.locator(`[id="${id}"]`).count(), `#${id}`).toBe(1);
    });
});

// ── Policy / press pages ────────────────────────────────────────────────────

test.describe('press, accessibility, editorial policy', () => {
    test('/press: figures, methodology, citation and media contact', async ({ page }) => {
        await gotoOk(page, '/press');
        await expect(page.locator('#data')).toBeVisible();
        await expect(page.getByRole('heading', { name: /Methodology/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'How to cite us' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Media contact' })).toBeVisible();
        await expectNoNaN(page);
    });

    test('/accessibility: known gaps and a way to report a barrier', async ({ page }) => {
        await gotoOk(page, '/accessibility');
        await expect(page.getByRole('heading', { name: /Known gaps/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Report a barrier' })).toBeVisible();
        await expect(page.locator('a[href^="mailto:"]').first()).toBeVisible();
    });

    test('/editorial-policy: provenance, review status and corrections', async ({ page }) => {
        await gotoOk(page, '/editorial-policy');
        await expect(page.getByRole('heading', { name: 'Where our numbers come from' })).toBeVisible();
        await expect(page.getByRole('heading', { name: /Review status/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Corrections' })).toBeVisible();
    });
});

// ── Mobile (375px) ──────────────────────────────────────────────────────────

test.describe('mobile 375px', () => {
    test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });

    test('1099 calculator core flow works on a phone with no horizontal overflow', async ({ page }) => {
        await gotoOk(page, '/tools/1099-vs-w2-calculator');
        await noHorizontalOverflow(page);
        await fillNumber(page, '#takehome-w2Salary', '140000');
        await fillNumber(page, '#takehome-w2EmployerMatchPct', '3');
        await fillNumber(page, '#takehome-w2EmployeePremium', '2400');
        await fillNumber(page, '#takehome-hoursPerWeek', '40');
        await fillNumber(page, '#takehome-paidDaysOff', '25');
        await fillNumber(page, '#takehome-contractHourlyRate', '82');
        await fillNumber(page, '#takehome-contractBusinessExpenses', '6000');
        await fillNumber(page, '#takehome-contractHealthPremium', '9000');
        await fillNumber(page, '#takehome-contractRetirement', '6000');
        await expect(page.locator('p[aria-live="polite"]')).toContainText('$10,910');
        await noHorizontalOverflow(page);
        await expectAssumptionsPanel(page);
    });

    test('licensure planner on a phone: tap-select two states, rows render, no overflow', async ({ page }) => {
        await gotoOk(page, '/tools/licensure-checker');
        await noHorizontalOverflow(page);
        await page.locator('#planner-target-texas').check();
        await page.locator('#planner-target-arizona').check();
        await expect(page.getByText('2 selected')).toBeVisible();
        await expect(page.locator('.planner-row')).toHaveCount(2);
        await noHorizontalOverflow(page);
    });

    for (const path of ['/tools', '/tools/specialty-finder', '/tools/cost-per-hire-calculator', '/tools/salary-benchmark', '/scope-of-practice', '/salary-guide', '/faq']) {
        test(`no horizontal overflow: ${path}`, async ({ page }) => {
            await gotoOk(page, path);
            await noHorizontalOverflow(page);
            await expect(page.locator('h1')).toHaveCount(1);
        });
    }

    test('scope-of-practice explorer still filters on mobile (compact column hidden, not broken)', async ({ page }) => {
        await gotoOk(page, '/scope-of-practice');
        await page.locator('#sop-state-search').fill('TX');
        await expect(page.getByText('Showing 1 of 51 jurisdictions')).toBeVisible();
        await noHorizontalOverflow(page);
    });
});
