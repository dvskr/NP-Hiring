import Image from 'next/image';
import type { CSSProperties } from 'react';
import { ART_GROUND } from '@/lib/pseo/category-art-ground';

interface ImmersiveImageProps {
  src: string;
  alt: string;
  /**
   * Width hint for the optimizer. Defaults to the cell height with headroom,
   * because the square art is letterboxed to the cell height, never the
   * cell width. A plain px hint keeps the small srcset candidates.
   */
  sizes?: string;
  /** Height of the cell when nothing beside it is taller. */
  minHeight?: number;
  /** Width to height ratio of the picture. The category art is square. */
  aspectRatio?: number;
  /** Fallback ground color when the picture is not in ART_GROUND. */
  ground?: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
}

const FOREGROUND_HEADROOM = 1.25;
/** How far the edge columns are stretched; anything above the band width works. */
const EDGE_STRETCH = 40;

const edgeBox: CSSProperties = { position: 'absolute', top: 0, bottom: 0, height: 'auto' };

/**
 * Edge-to-edge image cell.
 *
 * The picture is letterboxed inside the cell so nothing is cropped. The bands
 * beside it are painted by the picture's own outermost columns, stretched
 * across the band (one copy clamped to each edge), so the color at the seam
 * is exactly the picture's edge, row by row: flat grounds stay flat and
 * vignettes continue outward. A blurred copy cannot do this, because a band
 * always maps to interior columns of the picture. All three layers request
 * the same URL, so the cell costs one image download.
 *
 * The wrapper is painted the picture's sampled ground color as a placeholder
 * while the image loads (owner request, 2026-09-16: no padding, frame or
 * color seam around the art).
 */
export default function ImmersiveImage({
  src,
  alt,
  sizes,
  minHeight = 220,
  aspectRatio = 1,
  ground,
  className,
  style,
  priority,
}: ImmersiveImageProps) {
  const hint = sizes ?? `${Math.round(minHeight * FOREGROUND_HEADROOM)}px`;
  const background = ART_GROUND[src] ?? ground;
  return (
    <div className={className} style={{ ...style, position: 'relative', overflow: 'hidden', minHeight, background }}>
      <div aria-hidden="true" style={{ ...edgeBox, left: 0, aspectRatio, transformOrigin: 'left center', transform: `scaleX(${EDGE_STRETCH})` }}>
        <Image src={src} alt="" fill sizes={hint} style={{ objectFit: 'fill' }} />
      </div>
      <div aria-hidden="true" style={{ ...edgeBox, right: 0, aspectRatio, transformOrigin: 'right center', transform: `scaleX(${EDGE_STRETCH})` }}>
        <Image src={src} alt="" fill sizes={hint} style={{ objectFit: 'fill' }} />
      </div>
      <div style={{ ...edgeBox, left: '50%', transform: 'translateX(-50%)', aspectRatio, maxWidth: '100%' }}>
        <Image src={src} alt={alt} fill sizes={hint} priority={priority} style={{ objectFit: 'contain' }} />
      </div>
    </div>
  );
}
