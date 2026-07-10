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
}
console.log('Done. Restart the dev server to see new art.');
