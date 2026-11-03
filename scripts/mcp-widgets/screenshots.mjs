/**
 * Screenshots of every widget view and state, light and dark, at 360px and
 * 720px, through the preview harness (server.mjs) and the installed
 * Playwright Chromium. Not part of the app or the test suite.
 *
 *   node scripts/mcp-widgets/screenshots.mjs <outDir> [--only list,detail] [--widths 360,720]
 *                                            [--themes light,dark] [--vars none|claude] [--scale 1]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS } from './scenarios.mjs';
import { startPreviewServer } from './server.mjs';

function readArgs(argv) {
    const [outDir, ...rest] = argv;
    if (!outDir || outDir.startsWith('--')) {
        throw new Error('Usage: node scripts/mcp-widgets/screenshots.mjs <outDir> [--only a,b] [--widths 360,720]');
    }
    const flags = {};
    for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')] = rest[i + 1];
    const list = (value, fallback) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback);
    return {
        outDir: path.resolve(outDir),
        only: list(flags.only, null),
        widths: list(flags.widths, ['360', '720']).map(Number),
        themes: list(flags.themes, ['light', 'dark']),
        vars: flags.vars === 'claude' ? 'claude' : 'none',
        scale: Number(flags.scale ?? 1),
        concurrency: Number(flags.concurrency ?? 3),
    };
}

async function runStep(page, frame, step) {
    if (step.press) {
        for (let i = 0; i < (step.times ?? 1); i += 1) await page.keyboard.press(step.press);
    } else if (step.click) {
        const scope = step.click.within ? frame.locator(step.click.within) : frame;
        let target = scope.getByRole(step.click.role, { name: step.click.name, exact: true });
        if (step.click.nth !== undefined) target = target.nth(step.click.nth);
        await target.click();
    } else if (step.check) {
        await frame.getByLabel(step.check.label).check();
    } else if (step.select) {
        await frame.getByLabel(step.select.label).selectOption({ label: step.select.value });
    } else if (step.fill) {
        await frame.getByLabel(step.fill.label).fill(step.fill.value);
    } else if (step.waitText) {
        await frame.getByText(step.waitText).first().waitFor({ state: 'visible' });
    } else if (step.waitFor) {
        await frame.locator(step.waitFor).first().waitFor({ state: 'visible' });
    } else if (step.waitGone) {
        await frame.locator(step.waitGone).first().waitFor({ state: 'detached' });
    }
}

/** Waits until the widget's reported height stops changing. */
async function settle(page) {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 50 && stable < 4; i += 1) {
        const height = await page.locator('#widget').evaluate((element) => element.getBoundingClientRect().height);
        stable = Math.abs(height - last) < 0.5 ? stable + 1 : 0;
        last = height;
        await page.waitForTimeout(100);
    }
}

async function shoot(browser, baseUrl, job, options) {
    const { scenario, theme, width } = job;
    const context = await browser.newContext({
        viewport: { width: width + 32, height: scenario.height ?? 900 },
        colorScheme: theme,
        reducedMotion: 'reduce',
        deviceScaleFactor: options.scale,
    });
    try {
        const page = await context.newPage();
        const query = new URLSearchParams({
            scenario: scenario.name,
            theme,
            width: String(width),
            vars: options.vars,
            shot: '1',
        });
        await page.goto(`${baseUrl}/?${query.toString()}`);
        const frame = page.frameLocator('#widget');
        await frame.locator(scenario.waitFor).first().waitFor({ state: 'visible', timeout: 60_000 });
        for (const step of scenario.steps ?? []) await runStep(page, frame, step);
        await settle(page);
        const suffix = options.vars === 'claude' ? '--claude' : '';
        const file = path.join(options.outDir, `${scenario.name}--${theme}--${width}${suffix}.png`);
        await page.locator('#stage').screenshot({ path: file, animations: 'disabled' });
        return file;
    } finally {
        await context.close();
    }
}

async function main() {
    const options = readArgs(process.argv.slice(2));
    mkdirSync(options.outDir, { recursive: true });
    const scenarios = options.only ? SCENARIOS.filter((s) => options.only.includes(s.name)) : SCENARIOS;
    const jobs = scenarios.flatMap((scenario) =>
        options.themes.flatMap((theme) => options.widths.map((width) => ({ scenario, theme, width }))),
    );

    const server = await startPreviewServer();
    const browser = await chromium.launch();
    const failures = [];
    let done = 0;
    try {
        const queue = [...jobs];
        const worker = async () => {
            for (let job = queue.shift(); job; job = queue.shift()) {
                try {
                    const file = await shoot(browser, server.url, job, options);
                    done += 1;
                    process.stdout.write(`[${done}/${jobs.length}] ${path.basename(file)}\n`);
                } catch (error) {
                    failures.push(`${job.scenario.name} ${job.theme} ${job.width}: ${error instanceof Error ? error.message : error}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
    } finally {
        await browser.close();
        await server.close();
    }
    process.stdout.write(`Saved ${done} screenshots to ${options.outDir}\n`);
    if (failures.length > 0) {
        process.stderr.write(`${failures.length} failed:\n${failures.join('\n')}\n`);
        process.exitCode = 1;
    }
}

await main();
