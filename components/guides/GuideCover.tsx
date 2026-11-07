import type { CSSProperties } from 'react';
import { brand } from '@/config/brand';
import { GUIDES, type GuideSlug } from '@/lib/guides/catalog';
import { OXBLOOD } from './styles';

/**
 * A drawn book cover for a guide, so the store reads as a shelf of real
 * titles without shipping cover images. Each guide keeps one colour pair
 * everywhere it appears: store, product page, library, bundle stacks and the
 * cross-links on other pages. The cover is framed as a sticker: square
 * corners, the oxblood border and a hard offset shadow, scaled to its width.
 */

export interface CoverPalette {
    readonly ink: string;
    readonly accent: string;
    readonly label: string;
}

export const COVER_PALETTES: Readonly<Record<GuideSlug, CoverPalette>> = {
    'compensation-report': { ink: '#134E4A', accent: '#5EEAD4', label: 'Pay data' },
    'first-year-playbook': { ink: '#7C2D12', accent: '#FDBA74', label: 'New grads' },
    'interview-prep-pack': { ink: '#1E3A8A', accent: '#93C5FD', label: 'Interviews' },
    'negotiate-like-an-np': { ink: '#14532D', accent: '#86EFAC', label: 'Offers' },
    'telehealth-playbook': { ink: '#4C1D95', accent: '#C4B5FD', label: 'Telehealth' },
    'launch-your-practice': { ink: '#1A2E35', accent: '#FCD34D', label: 'Practice' },
};

/** Width the cover's type and spacing are drawn for; other widths scale from it. */
const BASE_WIDTH = 180;

interface GuideCoverProps {
    readonly slug: GuideSlug;
    /** Rendered width in pixels; the height follows a 3:4 page. */
    readonly width?: number;
    readonly className?: string;
    readonly style?: CSSProperties;
}

export default function GuideCover({ slug, width = BASE_WIDTH, className, style }: GuideCoverProps) {
    const guide = GUIDES[slug];
    const palette = COVER_PALETTES[slug];
    const scale = width / BASE_WIDTH;
    const border = width < 60 ? 1 : 2;
    const shadow = Math.max(2, Math.round(6 * scale));
    // A thumbnail too small to read prints only its colours and band.
    const showText = width >= 56;
    return (
        <div
            className={className}
            aria-hidden="true"
            style={{
                width: `${width}px`,
                aspectRatio: '3 / 4',
                flexShrink: 0,
                position: 'relative',
                boxSizing: 'border-box',
                background: `linear-gradient(160deg, ${palette.ink} 0%, ${palette.ink} 62%, color-mix(in srgb, ${palette.ink} 78%, #000) 100%)`,
                border: `${border}px solid ${OXBLOOD}`,
                boxShadow: `${shadow}px ${shadow}px 0 ${OXBLOOD}`,
                overflow: 'hidden',
                color: '#FFFFFF',
                ...style,
            }}
        >
            {/* Spine fold */}
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${10 * scale}px`, background: 'linear-gradient(90deg, rgba(0,0,0,0.28), rgba(255,255,255,0.08))' }} />
            {/* Accent band */}
            <div style={{ position: 'absolute', left: `${10 * scale}px`, right: 0, top: `${26 * scale}px`, height: `${Math.max(2, 4 * scale)}px`, background: palette.accent }} />
            {showText && (
                <div style={{ position: 'absolute', inset: `${40 * scale}px ${14 * scale}px ${14 * scale}px ${22 * scale}px`, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: `${8.5 * scale}px`, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.accent }}>
                        {palette.label}
                    </span>
                    <span className="font-heading" style={{ marginTop: `${8 * scale}px`, fontSize: `${17 * scale}px`, fontWeight: 700, lineHeight: 1.15 }}>
                        {guide.title}
                    </span>
                    <span style={{ marginTop: 'auto', fontSize: `${8.5 * scale}px`, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75 }}>
                        {brand.name} · {guide.pages} pages
                    </span>
                </div>
            )}
        </div>
    );
}

interface CoverStackProps {
    readonly guides: readonly GuideSlug[];
    readonly width?: number;
}

/** A fanned stack of covers for a bundle, front cover last in the list. */
export function CoverStack({ guides, width = 120 }: CoverStackProps) {
    const shown = guides.slice(0, 6);
    const step = Math.round(width * 0.34);
    const mid = (shown.length - 1) / 2;
    const shadowRoom = Math.max(2, Math.round(6 * (width / BASE_WIDTH)));
    return (
        <div
            aria-hidden="true"
            style={{
                position: 'relative',
                height: `${Math.round((width * 4) / 3) + 16 + shadowRoom}px`,
                width: `${width + step * (shown.length - 1) + shadowRoom}px`,
                maxWidth: '100%',
                flexShrink: 0,
            }}
        >
            {shown.map((slug, index) => (
                <GuideCover
                    key={slug}
                    slug={slug}
                    width={width}
                    style={{
                        position: 'absolute',
                        left: `${index * step}px`,
                        top: `${Math.abs(index - mid) * 4}px`,
                        transform: `rotate(${(index - mid) * 3}deg)`,
                        zIndex: index,
                    }}
                />
            ))}
        </div>
    );
}
