/**
 * State-diorama source optimiser — public/images/states/*.png.
 *
 * WHAT SHIPS THERE: 52 jurisdiction dioramas (50 states + District of
 * Columbia + Puerto Rico), 1024x1024, wired into four surfaces —
 * /jobs/state/<slug> and /jobs/metro/<slug> (via CategoryHero, contain-fitted
 * over the artwork's own backdrop colour), /salary-guide/<slug>,
 * /jobs/locations, /jobs/locations/<state>, /resources, TopStatesList and
 * LicensureChecker. Largest rendered box on any of them is CategoryHero's
 * panel at `height: clamp(260px, 28vw, 380px)` with next/image `width={560}`,
 * so the widest physical need is ~380 CSS px x DPR 3 = 1140px. 1024 is
 * therefore the right intrinsic size and this script never resizes.
 *
 * THE PROBLEM IT SOLVES: the shipped files were 1024x1024 baseline JPEGs at
 * roughly q95 — 500-860 KB each, 32.03 MB for the set. Every byte is repo and
 * deploy-artifact weight, every byte is what Vercel's image optimiser has to
 * read per variant, and 102 of these URLs are advertised raw to Google Images
 * from app/image-sitemap.xml (lib/image-seo.ts `getStateDioramaImages`), so
 * the raw file is genuinely fetched. Re-encoding at q88 with mozjpeg's
 * trellis quantisation is visually transparent at these display sizes and
 * cuts the set by ~80%.
 *
 * WHY THE FILES STAY NAMED `.png` (they are JPEG, and that predates this
 * script): renaming them to a truthful extension changes
 * `stateDioramaSrc()`'s return value, which is pinned by literal `.png`
 * assertions in FOUR regression suites (three P2 suites plus this pass's own
 * p3-image-optimization-state-dioramas) and by all five keys of
 * scripts/image-manifest.json — mostly files outside this pass's ownership.
 * Rather than half-land a rename, this script keeps the byte format the crawler
 * already has indexed (JPEG) and leaves the rename as a single coordinated
 * change. `--measure-webp` prints what that rename would additionally save so
 * the handoff is costed, plus the exact per-file `.png` counts to change; those
 * counts are pinned by tests/regressions/p3-image-optimization-state-dioramas
 * so the list cannot rot into a wrong instruction. It deliberately writes
 * nothing: unreferenced image variants are how 436 KB of dead files shipped
 * once already (see scripts/regen-image-ladders.mjs).
 *
 * BACKGROUND NORMALISATION IS DELIBERATELY NOT DONE. The 52 backdrops span
 * #CF837D to #EBB0A8 because the generator never hit one requested rose.
 * Recolouring them means masking backdrop from subject, and these are painterly
 * dioramas whose subjects carry the same warm hues as their backdrops — a
 * flood-fill tolerance loose enough to catch the backdrop eats into the art on
 * some of the 52, and there is no way to verify 52 masks by inspection here.
 * The variance is already handled without touching pixels: STATE_DIORAMA_BG in
 * components/StateImage.tsx carries each artwork's sampled corner colour and
 * every surface that letterboxes the square art paints its panel that colour.
 * `--check` prints declared-vs-sampled per slug so drift stays visible.
 *
 * USAGE
 *   node scripts/optimize-state-images.mjs                 # --check (default)
 *   node scripts/optimize-state-images.mjs --apply         # re-encode in place
 *   node scripts/optimize-state-images.mjs --measure-webp   # cost the rename
 *   node scripts/optimize-state-images.mjs --bg-map        # emit the BG literal
 *
 * IDEMPOTENT BY CONSTRUCTION. `--apply` only touches BASELINE JPEGs. Its own
 * output is progressive, so a second run re-encodes nothing and the set can
 * never be double-compressed. Anything that is not a baseline JPEG (already
 * optimised, or a real .webp after the rename lands) is reported and skipped.
 *
 * NOTE: if the dev server is running during a swap, restart it — Next 16
 * caches served images at .next/dev/cache/images (clear with the server
 * STOPPED if old art persists; see project memory).
 */
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DIORAMA_DIR = path.join(REPO_ROOT, 'public/images/states');
const STATE_IMAGE_TSX = path.join(REPO_ROOT, 'components/StateImage.tsx');

/** Intrinsic square size every diorama must keep (STATE_DIORAMA_INTRINSIC). */
const INTRINSIC = 1024;

/**
 * q88 + mozjpeg. The sources are ~q95 baseline, so this is a second
 * generation: q88 with trellis quantisation and overshoot deringing holds the
 * soft gradients these dioramas are made of, and everything a browser
 * actually receives is re-encoded again by next/image from this file. Chroma
 * subsampling stays at the input's 4:2:0 — re-decimating already-decimated
 * chroma is near lossless, while forcing 4:4:4 would only pad the file.
 */
const JPEG_OPTIONS = { quality: 88, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0' };

/** Quality ladder priced by `--measure-webp` for the deferred rename. */
const WEBP_QUALITY = 85;

/** Corner-patch edge used to sample an artwork's baked backdrop colour. */
const PATCH = 48;

/** Max per-channel drift tolerated between STATE_DIORAMA_BG and the pixels. */
const BG_TOLERANCE = 3;

/**
 * Mean of the four corner patches — the artwork's baked backdrop.
 *
 * The extract MUST be materialised with `.toBuffer()` before `.stats()`:
 * sharp's stats() re-reads the input instead of running the queued pipeline,
 * so `sharp(f).extract(...).stats()` silently returns the WHOLE image's mean.
 * That bug generated the first STATE_DIORAMA_BG (every value up to 60 RGB
 * units too dark). Same two-step form as the regression suite.
 */
async function sampleBackdrop(input) {
    const { width = 0, height = 0 } = await sharp(input).metadata();
    const corners = [
        [0, 0],
        [width - PATCH, 0],
        [0, height - PATCH],
        [width - PATCH, height - PATCH],
    ];
    const sums = [0, 0, 0];
    for (const [left, top] of corners) {
        const buf = await sharp(input).extract({ left, top, width: PATCH, height: PATCH }).toBuffer();
        const { channels } = await sharp(buf).stats();
        for (let c = 0; c < 3; c += 1) sums[c] += channels[c].mean;
    }
    return sums.map((s) => s / 4);
}

const toHex = (rgb) =>
    `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('')}`;

const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

/**
 * The slug -> backdrop map read straight out of components/StateImage.tsx.
 * The component is the single source of truth for which slugs the site can
 * render, so the script validates against it rather than keeping a second
 * list of jurisdictions that could drift.
 */
function declaredMap() {
    const src = fs.readFileSync(STATE_IMAGE_TSX, 'utf8');
    const block = src.slice(src.indexOf('STATE_DIORAMA_BG'), src.indexOf('TILE_FALLBACK_BG'));
    const entries = [...block.matchAll(/'([a-z-]+)':\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]);
    if (entries.length === 0) {
        throw new Error('could not parse STATE_DIORAMA_BG out of components/StateImage.tsx');
    }
    return new Map(entries);
}

/** Diorama files on disk, keyed by slug (any image extension). */
function onDisk() {
    const files = fs
        .readdirSync(DIORAMA_DIR)
        .filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f))
        .sort();
    return new Map(files.map((f) => [f.replace(/\.[^.]+$/, ''), path.join(DIORAMA_DIR, f)]));
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/**
 * A baseline JPEG is an untouched source. Progressive is this script's own
 * output marker, so `--apply` is safe to re-run and can never stack a third
 * generation of loss onto the artwork.
 */
const isUnoptimised = (meta) => meta.format === 'jpeg' && meta.isProgressive === false;

async function inspect() {
    const declared = declaredMap();
    const disk = onDisk();
    const rows = [];
    const problems = [];

    for (const [slug, hex] of declared) {
        const file = disk.get(slug);
        if (!file) {
            problems.push(`MISSING   ${slug} — declared in STATE_DIORAMA_BG, no file on disk`);
            continue;
        }
        const meta = await sharp(file).metadata();
        const size = fs.statSync(file).size;
        if (meta.width !== INTRINSIC || meta.height !== INTRINSIC) {
            problems.push(`OFF-SIZE  ${slug} — ${meta.width}x${meta.height}, expected ${INTRINSIC} square`);
        }
        const sampled = await sampleBackdrop(file);
        const drift = Math.max(...sampled.map((v, i) => Math.abs(v - hexToRgb(hex)[i])));
        if (drift > BG_TOLERANCE) {
            problems.push(
                `BG DRIFT  ${slug} — declared ${hex}, artwork ${toHex(sampled)} (Δ${drift.toFixed(1)}); ` +
                    'regenerate STATE_DIORAMA_BG with --bg-map',
            );
        }
        rows.push({ slug, file, size, meta, hex, sampled, drift });
    }

    for (const slug of disk.keys()) {
        if (!declared.has(slug)) {
            problems.push(`ORPHAN    ${slug} — file on disk, not in STATE_DIORAMA_BG (nothing renders it)`);
        }
    }
    return { rows, problems, declaredCount: declared.size };
}

async function check() {
    const { rows, problems, declaredCount } = await inspect();
    const total = rows.reduce((n, r) => n + r.size, 0);
    const stale = rows.filter((r) => isUnoptimised(r.meta));

    console.log(`Dioramas: ${rows.length}/${declaredCount} slugs resolved, ${mb(total)} on disk`);
    for (const r of rows) {
        console.log(
            `  ${r.slug.padEnd(22)} ${String(r.meta.format).padEnd(4)} ${r.meta.width}x${r.meta.height} ` +
                `${kb(r.size).padStart(7)}  bg ${r.hex} (Δ${r.drift.toFixed(1)})` +
                `${isUnoptimised(r.meta) ? '  UNOPTIMISED (baseline JPEG)' : ''}`,
        );
    }
    if (stale.length) {
        console.log(
            `\n${stale.length} file(s) are unoptimised baseline JPEGs (${mb(stale.reduce((n, r) => n + r.size, 0))}). ` +
                'Run with --apply.',
        );
    }
    if (problems.length) {
        console.log(`\nProblems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    }
    if (stale.length || problems.length) process.exitCode = 1;
    else console.log('\nAll 52 dioramas resolve, are square at the declared intrinsic size, and are optimised.');
}

async function apply() {
    const { rows, problems } = await inspect();
    if (problems.length) {
        console.log(`Problems (not blocking the re-encode, but fix them):\n${problems.map((p) => `  ${p}`).join('\n')}`);
    }

    let before = 0;
    let after = 0;
    let touched = 0;
    for (const r of rows) {
        before += r.size;
        if (!isUnoptimised(r.meta)) {
            after += r.size;
            console.log(`  skip     ${r.slug.padEnd(22)} ${r.meta.format}${r.meta.isProgressive ? ' progressive' : ''} — already optimised`);
            continue;
        }
        // Buffer first: sharp cannot stream into the file it is reading.
        const buf = await sharp(r.file).jpeg(JPEG_OPTIONS).toBuffer();
        if (buf.length >= r.size) {
            after += r.size;
            console.log(`  skip     ${r.slug.padEnd(22)} re-encode is larger (${kb(buf.length)} >= ${kb(r.size)})`);
            continue;
        }
        // Backdrop must survive: every letterboxing surface paints its panel
        // the declared colour, so a shifted backdrop shows as coloured bars.
        const sampled = await sampleBackdrop(buf);
        const drift = Math.max(...sampled.map((v, i) => Math.abs(v - hexToRgb(r.hex)[i])));
        if (drift > BG_TOLERANCE) {
            after += r.size;
            console.log(`  SKIP     ${r.slug.padEnd(22)} backdrop would drift Δ${drift.toFixed(1)} past ${BG_TOLERANCE} — left untouched`);
            continue;
        }
        fs.writeFileSync(r.file, buf);
        after += buf.length;
        touched += 1;
        const cut = (100 * (1 - buf.length / r.size)).toFixed(0);
        console.log(`  ok       ${r.slug.padEnd(22)} ${kb(r.size).padStart(7)} -> ${kb(buf.length).padStart(7)}  -${cut}%  (bg Δ${drift.toFixed(1)})`);
    }

    console.log(
        `\nRe-encoded ${touched} file(s): ${mb(before)} -> ${mb(after)} ` +
            `(-${mb(before - after)}, -${(100 * (1 - after / before)).toFixed(1)}%)`,
    );
    if (touched) {
        console.log('Re-run --check, then `npx vitest run tests/regressions/p3-image-optimization-state-dioramas.test.ts`.');
    }
}

/**
 * Prices the deferred `.png` -> `.webp` rename WITHOUT writing anything.
 * Emitting real .webp siblings before `stateDioramaSrc()` points at them would
 * ship 52 files no request can reach — the exact anti-pattern
 * scripts/regen-image-ladders.mjs documents in PENDING_WIRING.
 *
 * The projection reads what is on disk, i.e. it prices WebP encoded FROM the
 * already-re-encoded JPEG. When the rename actually lands, export the .webp
 * from the pristine q95 masters instead of stacking a third generation on the
 * artwork — they are in git, not gone (e477feb carries all 52 pristine masters,
 * 32.03 MB; it is the commit this pass re-encoded on top of):
 *   git show e477feb:public/images/states/<slug>.png > /tmp/<slug>.jpg
 */
async function measureWebp() {
    const { rows } = await inspect();
    let jpeg = 0;
    let webp = 0;
    for (const r of rows) {
        const buf = await sharp(r.file).webp({ quality: WEBP_QUALITY }).toBuffer();
        jpeg += r.size;
        webp += buf.length;
        console.log(`  ${r.slug.padEnd(22)} ${kb(r.size).padStart(7)} jpeg -> ${kb(buf.length).padStart(7)} webp q${WEBP_QUALITY}`);
    }
    console.log(
        `\nProjection only — nothing written. WebP q${WEBP_QUALITY} at ${INTRINSIC}px: ` +
            `${mb(jpeg)} -> ${mb(webp)} (a further -${mb(jpeg - webp)}, -${(100 * (1 - webp / jpeg)).toFixed(1)}%).`,
    );
    console.log('Landing it means renaming the files AND updating, in one change.');
    console.log('Counts below are every `.png` substring in each file, verified against the');
    console.log('tree at the time of writing — re-grep before you start:');
    console.log('  components/StateImage.tsx                                    6 literal `.png`: 1 in stateDioramaSrc -> `${slug}.webp`, 5 in comments (the rename-rationale block goes away entirely)');
    console.log('  tests/regressions/p2-state-imagery-diorama-wiring.test.ts    6 literal `.png` -> `.webp`  (readdir filter + slug strip, 2 path joins, hawaii, texas src)');
    console.log('  tests/regressions/p2-metro-editorial-depth.test.ts           2 literal `.png` -> `.webp`  (1 existsSync path + 1 in its failure message)');
    console.log('  tests/regressions/p2-seo-ops-indexnow-sitemap.test.ts        1 literal `.png` -> `.webp`  (image-sitemap <image:loc>)');
    console.log('  tests/regressions/p3-image-optimization-state-dioramas.test.ts  2 literal `.png` -> `.webp`  (1 stateDioramaSrc assertion + 1 header comment)');
    console.log('  scripts/image-manifest.json                                 ALL 5 keys `.png` -> `.webp` — every key in the file is /images/states/*.png');
    console.log('');
    console.log('On the manifest: it is legacy migration output (written by');
    console.log('scripts/migrate-images-to-supabase.mjs, read only by');
    console.log('scripts/rewrite-image-paths.mjs) and its five values all point at a');
    console.log('Supabase bucket this site no longer uses. Deleting it is likely more');
    console.log('correct than renaming its keys — but decide that deliberately; do not');
    console.log('leave 4 of 5 keys stale.');
    console.log('');
    console.log('Dead tooling, do NOT run, no action needed:');
    console.log('  scripts/rewrite-image-paths.mjs holds a LIVE `.png`-keyed regex (the');
    console.log('  template-literal branch), so the rename silently stops it matching.');
    console.log('  That is harmless only because running it at all would repoint these');
    console.log('  assets at the retired bucket. Leave it; do not "fix" its regex.');
    console.log('');
    console.log('Comment-only mentions, no behaviour, update for honesty:');
    console.log('  app/jobs/state/[state]/page.tsx, app/salary-guide/[state]/page.tsx,');
    console.log('  and this script\'s own header.');
}

/** Emits the STATE_DIORAMA_BG literal resampled from whatever is on disk. */
async function bgMap() {
    const disk = onDisk();
    const lines = [];
    for (const slug of [...disk.keys()].sort()) {
        lines.push(`    '${slug}': '${toHex(await sampleBackdrop(disk.get(slug)))}',`);
    }
    console.log('const STATE_DIORAMA_BG: Readonly<Record<string, string>> = {');
    console.log(lines.join('\n'));
    console.log('};');
}

const mode = process.argv[2] ?? '--check';
const modes = { '--check': check, '--apply': apply, '--measure-webp': measureWebp, '--bg-map': bgMap };
if (!modes[mode]) {
    console.error(`Unknown mode ${mode}. Use ${Object.keys(modes).join(' | ')}`);
    process.exit(1);
}
await modes[mode]();
