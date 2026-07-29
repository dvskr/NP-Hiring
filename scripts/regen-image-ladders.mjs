/**
 * Exact-DPR size-ladder generator for images served `unoptimized` at a
 * fixed CSS size (illustrations, decorative art, icons).
 *
 * WHY: the browser needs cssSize × devicePixelRatio physical pixels. If
 * the served file is any OTHER size, the resample blurs line art. The
 * ladder gives every standard Windows/macOS scaling factor an exact file
 * (1x, 1.25x, 1.5x, 1.75x, 2x, 2.25x, 2.5x, 3x), wired up via srcSet —
 * see components/EmployerHowItWorks.tsx for the consumption pattern.
 *
 * USAGE
 *   node scripts/regen-image-ladders.mjs
 *       → regenerates every image in the REGISTRY below (run this after
 *         replacing any registered artwork).
 *
 *   node scripts/regen-image-ladders.mjs <file> <cssSize>
 *       → ad-hoc ladder for any single image, e.g.:
 *         node scripts/regen-image-ladders.mjs public/images/foo.webp 320
 *
 * ADDING AN IMAGE: replace the artwork file, add one line to REGISTRY
 * with the CSS pixel size it renders at, run the script, and wire the
 * component with a srcSet over the generated -<width>.webp files.
 *
 * REGISTRY means WIRED. A row belongs here only once some component
 * actually reads its `-<width>.webp` outputs via srcSet — otherwise the
 * generated files are unreferenced weight in the repo and the deploy
 * artifact. Art that is waiting on that component change goes in
 * PENDING_WIRING below and stays ungenerated until the wiring lands.
 *
 * Non-square images are resized by width (aspect preserved). Output is
 * WebP q95 next to the source: <name>-<width>.webp
 *
 * NOTE: if the dev server is running during an artwork swap, restart it —
 * Next 16 caches served images at .next/dev/cache/images (clear with the
 * server STOPPED if old art persists; see project memory).
 */
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

/** Standard device-pixel-ratio steps (Windows 100%–250% scaling + 3x). */
const DPR_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];

/** Every ladder-served image on the site: source file + CSS display px. */
const REGISTRY = [
    { src: 'public/images/how-it-works/step-employer-post.webp', css: 280 },
    { src: 'public/images/how-it-works/step-employer-reach.webp', css: 280 },
    { src: 'public/images/how-it-works/step-employer-browse.webp', css: 280 },
    { src: 'public/images/how-it-works/step-employer-track.webp', css: 280 },
    // /for-employers comparison-section CTA card
    { src: 'public/images/employers/cta-illustration-v2.webp', css: 260 },
    // /salary-guide "Factors Affecting Salary" icon tiles. NOTE: sources are
    // only 96px, so the ladder caps at 2x — DPR 2.25–3 reuses the 96px file.
    // Truly crisp high-DPR icons need the artwork regenerated at >=144px
    // (ideally 1024 like the other illustrations).
    { src: 'public/images/salary-guide/factor-location.webp', css: 48 },
    { src: 'public/images/salary-guide/factor-experience.webp', css: 48 },
    { src: 'public/images/salary-guide/factor-setting.webp', css: 48 },
    { src: 'public/images/salary-guide/factor-employment.webp', css: 48 },
    { src: 'public/images/salary-guide/factor-specialty.webp', css: 48 },
    { src: 'public/images/salary-guide/factor-negotiate.webp', css: 48 },
    // Homepage "How it works" seeker steps (FeaturedJobs.tsx apricot panel)
    { src: 'public/images/how-it-works/seeker-step1-v2.webp', css: 80 },
    { src: 'public/images/how-it-works/seeker-step2-v2.webp', css: 80 },
    { src: 'public/images/how-it-works/seeker-step3-v2.webp', css: 80 },
    { src: 'public/images/how-it-works/seeker-step4-v2.webp', css: 80 },
];

/**
 * Art whose SOURCE is big enough for a ladder, but whose CONSUMER still
 * serves the raw file through a plain `<img src>` with no `srcSet`.
 *
 * A ladder file nobody references is not a speed-up — it is bytes in the
 * repo and the deploy artifact that no browser will ever request. So these
 * rows deliberately do NOT sit in REGISTRY, and their `-<w>.webp` outputs
 * are deliberately NOT checked in: generating them first and wiring them
 * "later" is how 436 KB of dead files got shipped in the P3 #12 pass.
 *
 * ORDER OF OPERATIONS when picking one of these up:
 *   1. add the row to REGISTRY above (delete it here),
 *   2. `node scripts/regen-image-ladders.mjs public/illustrations/<name>.png <css>`,
 *   3. in the SAME change, replace the raw `<img src>` in `consumer` with a
 *      srcSet over the generated widths (pattern:
 *      components/EmployerHowItWorks.tsx `stepSrcSet`).
 *
 * All eleven are 1024×1024 PNG masters rendered at 64–120 CSS px — roughly
 * 400 KB decoded at up to 16x the pixels needed — so the payoff is large.
 * Every consumer below is owned outside the polish batch, which is why the
 * wiring is a handoff rather than a silent REGISTRY row.
 */
const PENDING_WIRING = [
    { src: 'public/illustrations/clay-stat-saved.png', css: 64, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/clay-stat-applied.png', css: 64, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/clay-stat-views.png', css: 64, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/clay-stat-alerts.png', css: 64, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/empty-applications.png', css: 80, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/empty-saved.png', css: 80, consumer: 'components/dashboard/DashboardContent.tsx' },
    { src: 'public/illustrations/empty-messages.png', css: 100, consumer: 'app/messages/page.tsx' },
    { src: 'public/illustrations/spot-alerts-empty.png', css: 120, consumer: 'app/job-alerts/manage/page.tsx' },
    { src: 'public/illustrations/spot-applications.png', css: 120, consumer: 'app/my-applications/page.tsx' },
    { src: 'public/illustrations/spot-saved.png', css: 120, consumer: 'app/saved/page.tsx' },
    { src: 'public/illustrations/spot-applied.png', css: 120, consumer: 'app/saved/page.tsx' },
];

/**
 * Art whose SOURCE is at or below the size it renders at, so a ladder
 * cannot help yet — sharp never upscales, and neither does next/image.
 * The fix for these is an artwork re-render at >= `needs` px, after which
 * the entry moves into REGISTRY above and one command makes them crisp.
 *
 * Listed here (rather than silently in REGISTRY) so `node
 * scripts/regen-image-ladders.mjs` prints the outstanding artwork
 * commission instead of quietly emitting 1x-only "ladders".
 *
 * `needs` = ceil(css * 3) — the top DPR step the ladder targets.
 */
const PENDING_RERENDER = [
    { src: 'public/images/contact/hero.webp', css: 280, note: '/contact hero (priority/LCP)' },
    { src: 'public/images/terms/hero.webp', css: 140, note: '/terms hero (priority)' },
    { src: 'public/images/employers/bento-60day.webp', css: 280, note: '/for-employers + /pricing bento' },
    { src: 'public/images/employers/bento-analytics.webp', css: 280, note: '/for-employers + /pricing bento' },
    { src: 'public/images/employers/bento-featured.webp', css: 200, note: '/for-employers + /pricing bento' },
    { src: 'public/images/job-seekers/bento-match.webp', css: 280, note: '/for-job-seekers bento' },
    { src: 'public/images/job-seekers/bento-salary.webp', css: 200, note: '/for-job-seekers bento' },
    { src: 'public/images/job-seekers/bento-guides.webp', css: 280, note: '/for-job-seekers bento' },
    { src: 'public/images/job-seekers/cta-dream-role.webp', css: 260, note: '/for-job-seekers CTA card' },
    { src: 'public/images/job-seekers/remote-telehealth.webp', css: 280, note: '/for-job-seekers explore card + /about diorama' },
    { src: 'public/images/job-seekers/clinical-inperson.webp', css: 280, note: '/for-job-seekers explore card + /about diorama' },
    { src: 'public/images/job-seekers/private-practice.webp', css: 280, note: '/for-job-seekers explore card + /about diorama' },
    { src: 'public/images/job-seekers/parttime-prn.webp', css: 280, note: '/for-job-seekers explore card' },
];

async function buildLadder(src, css) {
    if (!fs.existsSync(src)) {
        console.error(`SKIP (missing): ${src}`);
        return;
    }
    const { dir, name } = path.parse(src);
    const meta = await sharp(src).metadata();
    const widths = [...new Set(DPR_STEPS.map((d) => Math.round(css * d)))];
    const made = [];
    for (const w of widths) {
        if (w > meta.width) {
            // never upscale — the source caps the ladder
            continue;
        }
        await sharp(src)
            .resize(w, null, { kernel: 'lanczos3' })
            .webp({ quality: 95 })
            .toFile(path.join(dir, `${name}-${w}.webp`));
        made.push(w);
    }
    console.log(`${name}: ${made.join('/')}${made.length < widths.length ? ` (capped at source ${meta.width}px)` : ''}`);
}

/**
 * Report art that is still source-capped. No files are written — the fix
 * is an artwork re-render, not a resample.
 */
async function reportPendingRerenders() {
    const rows = [];
    for (const { src, css, note } of PENDING_RERENDER) {
        if (!fs.existsSync(src)) {
            rows.push(`  MISSING  ${src} — ${note}`);
            continue;
        }
        const meta = await sharp(src).metadata();
        const needs = Math.ceil(css * DPR_STEPS[DPR_STEPS.length - 1]);
        if (meta.width >= needs) {
            rows.push(`  READY    ${src} (${meta.width}px >= ${needs}px) — move into REGISTRY at css ${css}`);
        } else {
            rows.push(`  TOO SMALL ${src} (${meta.width}px, renders at ${css} CSS px, needs >= ${needs}px) — ${note}`);
        }
    }
    if (rows.length) {
        console.log('\nSource-capped art (re-render required before a ladder helps):');
        console.log(rows.join('\n'));
    }
}

/**
 * Report art that has a usable source but no srcSet consumer yet. Nothing
 * is written: the fix is a one-line component change plus a regen, and
 * emitting the ladder before that lands only ships unreferenced bytes.
 */
async function reportPendingWiring() {
    if (!PENDING_WIRING.length) return;
    const rows = [];
    for (const { src, css, consumer } of PENDING_WIRING) {
        if (!fs.existsSync(src)) {
            rows.push(`  MISSING  ${src} — consumer ${consumer}`);
            continue;
        }
        const meta = await sharp(src).metadata();
        const needs = Math.ceil(css * DPR_STEPS[DPR_STEPS.length - 1]);
        const ready = meta.width >= needs ? 'READY' : `CAPPED (${meta.width}px < ${needs}px)`;
        rows.push(`  ${ready.padEnd(9)} ${src} @ ${css}px CSS — wire srcSet in ${consumer}, then move into REGISTRY`);
    }
    console.log('\nUnwired art (source is fine; consumer still serves the raw file):');
    console.log(rows.join('\n'));
}

const [, , fileArg, sizeArg] = process.argv;
if (fileArg) {
    const css = Number(sizeArg);
    if (!css || css <= 0) {
        console.error('Usage: node scripts/regen-image-ladders.mjs <file> <cssSize>');
        process.exit(1);
    }
    await buildLadder(fileArg, css);
} else {
    for (const { src, css } of REGISTRY) {
        await buildLadder(src, css);
    }
    await reportPendingRerenders();
    await reportPendingWiring();
}
console.log('\nDone. Restart the dev server to see new art.');
