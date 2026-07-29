import Image from 'next/image';

/**
 * Renders a state diorama from the local `public/images/states/{slug}.png`
 * set — 52 shipped jurisdictions (50 states + District of Columbia +
 * Puerto Rico), 1024x1024, no CDN/Supabase dependency.
 *
 * ASSET NOTE: the shipped files carry a `.png` extension but the bytes are
 * JPEG (opaque, 3 channels). They used to be ~630 KB baseline exports —
 * 32.03 MB for the set. P3 #10 re-encoded all 52 in place at q88/mozjpeg,
 * unchanged at 1024 square: 32.03 MB -> 6.05 MB (-25.97 MB, -81.1%), with
 * every artwork's sampled backdrop holding to within 1.0 RGB unit so the map
 * below and the panels painted from it stay correct. Re-run or audit with
 * `node scripts/optimize-state-images.mjs --check | --apply` — `--apply`
 * only touches BASELINE JPEGs, so it can never stack a second generation of
 * loss onto the artwork.
 *
 * The extension still lies, and deliberately so for now: `stateDioramaSrc`'s
 * `.png` return value is pinned by literal assertions in four regression
 * suites — tests/regressions/p2-state-imagery-diorama-wiring.test.ts (6
 * literals), p2-metro-editorial-depth.test.ts (2),
 * p2-seo-ops-indexnow-sitemap.test.ts (1) and
 * p3-image-optimization-state-dioramas.test.ts (2) — plus ALL FIVE keys of
 * scripts/image-manifest.json, every one of which is a diorama path under
 * /images/states (it is legacy migration output pointing at a retired Supabase
 * bucket, so deleting it may beat renaming its keys; either way do not leave
 * 4 of 5 behind). And 102 of these exact URLs are already
 * advertised to Google Images from app/image-sitemap.xml. Renaming to the
 * truthful `.webp` is one coordinated change across those files, not a
 * component-local edit; `node scripts/optimize-state-images.mjs
 * --measure-webp` prices it (a further ~1.3 MB) and prints the current
 * per-file counts. Until then do NOT swap the bytes to WebP under the `.png` name:
 * it would put a third format behind an extension the crawler has indexed,
 * for less than the rename saves.
 *
 * SERVER COMPONENT (deliberate). This used to be a `'use client'`
 * component whose only client behaviour was an `onError` fallback for
 * missing assets. That guard is now a build-time one instead: every slug
 * the site can render is in STATE_DIORAMA_BG below, and
 * tests/regressions/p2-state-imagery-diorama-wiring.test.ts pins that map
 * against the actual directory listing. Resolving the fallback on the
 * server is strictly better — no broken-image flash while the failed
 * request round-trips, no JS shipped, and server pages
 * (app/jobs/state/[state], app/salary-guide/[state], /jobs/locations,
 * /resources) can read the slug/colour helpers directly instead of
 * crossing a client boundary.
 *
 * Used in: app/jobs/state/[state]/page.tsx, app/salary-guide/[state]/page.tsx,
 * app/jobs/locations/page.tsx, app/resources/page.tsx,
 * components/TopStatesList.tsx, components/LicensureChecker.tsx.
 */

const STATE_IMAGE_BASE = '/images/states';

/** Intrinsic pixel dimensions of every shipped diorama (they are square). */
export const STATE_DIORAMA_INTRINSIC = 1024;

/**
 * slug → the artwork's own baked backdrop colour, sampled as the mean of
 * the four 48x48 corner patches of the shipped file. The generator did not
 * hit a single requested rose, so backdrops vary per state (#CF837D to
 * #EBB0A8). Surfaces that letterbox the square art — the `object-fit:
 * contain` hero panel in components/CategoryHero.tsx — paint the panel
 * this colour so the art blends instead of sitting in coloured bars.
 *
 * SAMPLING CONTRACT (this map was once wrong for exactly this reason):
 * sharp's `.stats()` re-reads the INPUT and ignores queued pipeline ops, so
 * `sharp(file).extract(patch).stats()` silently returns the whole image's
 * mean — every corner identical, and ~29 RGB units darker than the real
 * backdrop here (worst: arkansas, 60). The extract must be materialised
 * first:
 *   const buf = await sharp(file).extract({left, top, width: 48, height: 48}).toBuffer();
 *   const { channels } = await sharp(buf).stats();
 *
 * Regenerate after any artwork swap using that two-step form (see
 * tests/regressions/p2-state-imagery-diorama-wiring.test.ts, which
 * re-samples every file the same way and fails if this map drifts).
 */
const STATE_DIORAMA_BG: Readonly<Record<string, string>> = {
    'alabama': '#E3A39A',
    'alaska': '#DD9F9B',
    'arizona': '#D39189',
    'arkansas': '#E4A29A',
    'california': '#E0A4A1',
    'colorado': '#E0A19A',
    'connecticut': '#E39D96',
    'delaware': '#E1A69E',
    'district-of-columbia': '#E0ABA1',
    'florida': '#DE9B95',
    'georgia': '#CF837D',
    'hawaii': '#E9ACA4',
    'idaho': '#D38C83',
    'illinois': '#D68E89',
    'indiana': '#E2A19C',
    'iowa': '#DD8F8A',
    'kansas': '#DB9D97',
    'kentucky': '#DA9A93',
    'louisiana': '#E5A49B',
    'maine': '#E4A29B',
    'maryland': '#E1A19A',
    'massachusetts': '#DE9B95',
    'michigan': '#E5A9A1',
    'minnesota': '#D9948F',
    'mississippi': '#D78E87',
    'missouri': '#D5938D',
    'montana': '#DE9E94',
    'nebraska': '#DC918B',
    'nevada': '#E1A299',
    'new-hampshire': '#EAA9A5',
    'new-jersey': '#D88A86',
    'new-mexico': '#DC9F99',
    'new-york': '#DB9990',
    'north-carolina': '#D48C85',
    'north-dakota': '#E7AEA5',
    'ohio': '#E6A9A1',
    'oklahoma': '#D99D94',
    'oregon': '#DC9A94',
    'pennsylvania': '#E5AAA3',
    'puerto-rico': '#D8A292',
    'rhode-island': '#D18B86',
    'south-carolina': '#D69391',
    'south-dakota': '#DD948E',
    'tennessee': '#E7A79E',
    'texas': '#D6988D',
    'utah': '#DA9D95',
    'vermont': '#DA9B90',
    'virginia': '#EBB0A8',
    'washington': '#D48F88',
    'west-virginia': '#D49893',
    'wisconsin': '#E6ABA3',
    'wyoming': '#DB9289',
};

/** Mean of the 52 sampled backdrops — used when a slug has no artwork. */
const TILE_FALLBACK_BG = '#DD9C95';

/** Every jurisdiction slug that has a diorama on disk. */
export const STATE_DIORAMA_SLUGS: readonly string[] = Object.keys(STATE_DIORAMA_BG);

/** True when `public/images/states/{slug}.png` ships with the build. */
export function hasStateDiorama(slug: string): boolean {
    return Object.prototype.hasOwnProperty.call(STATE_DIORAMA_BG, slug);
}

/** Public path to a state's diorama, or null when none ships for that slug. */
export function stateDioramaSrc(slug: string): string | null {
    return hasStateDiorama(slug) ? `${STATE_IMAGE_BASE}/${slug}.png` : null;
}

/**
 * The artwork's baked backdrop colour for `slug`, or the set-wide mean when
 * no artwork ships — so a caller painting a panel behind the image never
 * has to branch.
 */
export function stateDioramaBg(slug: string): string {
    return STATE_DIORAMA_BG[slug] ?? TILE_FALLBACK_BG;
}

type FillProps = {
    fill: true;
    width?: never;
    height?: never;
};
type FixedProps = {
    fill?: false;
    width: number;
    height: number;
};

type StateImageProps = (FillProps | FixedProps) & {
    slug: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    sizes?: string;
    loading?: 'eager' | 'lazy';
    priority?: boolean;
};

export default function StateImage(props: StateImageProps) {
    const { slug, alt, className, style, sizes, loading, priority } = props;
    const src = stateDioramaSrc(slug);

    if (!src) {
        // Plain tile in the set's mean hue — a slug with no artwork reads as
        // an intentional solid card, not a hole or a wrong state's art.
        if (props.fill) {
            return <div aria-hidden="true" className={className} style={{ position: 'absolute', inset: 0, background: TILE_FALLBACK_BG, ...style }} />;
        }
        return <div aria-hidden="true" className={className} style={{ width: props.width, height: props.height, background: TILE_FALLBACK_BG, ...style }} />;
    }

    if (props.fill) {
        return (
            <Image
                src={src}
                alt={alt}
                fill
                className={className}
                style={style}
                sizes={sizes}
                loading={loading}
                priority={priority}
            />
        );
    }

    return (
        <Image
            src={src}
            alt={alt}
            width={props.width}
            height={props.height}
            className={className}
            style={style}
            sizes={sizes}
            loading={loading}
            priority={priority}
        />
    );
}
