'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Renders a state diorama from the local `public/images/states/{slug}.png`
 * set (50 states, organic rounded bases on the #F8B4A6 rose background —
 * generated 2026-07, no Supabase/CDN dependency).
 *
 * Fallback: slugs without a local asset (notably `district-of-columbia`,
 * which is in the sitemap/licensure lists but has no diorama) degrade to a
 * plain rose tile instead of a broken-image icon or a wrong state's art.
 *
 * Used in: app/jobs/locations/page.tsx, app/resources/page.tsx,
 * components/TopStatesList.tsx, components/LicensureChecker.tsx.
 */

const STATE_IMAGE_BASE = '/images/states';
/* Mid-tone measured from the shipped artwork's corners (the generator did
   not hit the requested #F8B4A6; actual backgrounds range #D38E8A–#EBB2A9). */
const TILE_FALLBACK_BG = '#DC9E97';

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
    const [errored, setErrored] = useState(false);

    if (errored) {
        // Plain rose tile — same hue as the diorama backgrounds, so a
        // missing asset reads as an intentional solid card, not a hole.
        if (props.fill) {
            return <div aria-hidden="true" className={className} style={{ position: 'absolute', inset: 0, background: TILE_FALLBACK_BG, ...style }} />;
        }
        return <div aria-hidden="true" className={className} style={{ width: props.width, height: props.height, background: TILE_FALLBACK_BG, ...style }} />;
    }

    const src = `${STATE_IMAGE_BASE}/${slug}.png`;
    const handleError = () => setErrored(true);

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
                onError={handleError}
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
            onError={handleError}
        />
    );
}
