/**
 * Regenerates the exact-DPR size ladder for the "How employers hire"
 * illustrations from the four base files.
 *
 * WHEN TO RUN: every time you replace any of
 *   public/images/how-it-works/step-employer-{post,reach,browse,track}.webp
 * with new artwork. The page serves ONLY the -<size>.webp ladder files
 * (components/EmployerHowItWorks.tsx), so without this step new base
 * images will not appear on the site at all.
 *
 * Usage:  node scripts/regen-step-illustrations.mjs
 *
 * Then restart the dev server if it was running (Next 16 dev caches
 * optimized/served images at .next/dev/cache/images — clear it with the
 * server STOPPED if the old art still shows; see project memory).
 *
 * The ladder gives every standard Windows display scaling an exact-size
 * file (100%→280px … 250%→700px) so the browser paints 1:1 physical
 * pixels with zero resampling — this is what keeps line art crisp. New
 * artwork stays sharp as long as it is bold/simple enough to read at
 * ~280 CSS px (thick outlines, large shapes; avoid fine detail).
 */
import sharp from 'sharp';

const BASES = ['post', 'reach', 'browse', 'track'];
const SIZES = [280, 350, 420, 490, 560, 630, 700, 840];
const DIR = 'public/images/how-it-works';

for (const n of BASES) {
    const src = `${DIR}/step-employer-${n}.webp`;
    for (const s of SIZES) {
        await sharp(src)
            .resize(s, s, { kernel: 'lanczos3' })
            .webp({ quality: 95 })
            .toFile(`${DIR}/step-employer-${n}-${s}.webp`);
    }
    console.log(`step-employer-${n}: ${SIZES.join('/')} regenerated`);
}
console.log('Done. Restart the dev server to see the new art.');
