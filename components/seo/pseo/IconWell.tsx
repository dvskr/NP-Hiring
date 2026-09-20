import Image from 'next/image';
import type { CSSProperties } from 'react';
import { CLAY_ACCENT, clayWell } from './clay';
import { isSectionArt, type SectionGlyph } from './section-icon';

export type IconWellSize = 'sm' | 'md' | 'lg';

interface WellDimensions {
  well: number;
  radius: number;
  glyph: number;
  art: number;
}

const DIMENSIONS: Record<IconWellSize, WellDimensions> = {
  sm: { well: 32, radius: 10, glyph: 16, art: 22 },
  md: { well: 56, radius: 16, glyph: 22, art: 36 },
  lg: { well: 72, radius: 20, glyph: 30, art: 48 },
};

interface IconWellProps {
  icon: SectionGlyph;
  size?: IconWellSize;
  className?: string;
  style?: CSSProperties;
}

/**
 * The clay icon well: a recessed #F9F7F1 square (56px, radius 16 by
 * default) holding a lucide glyph in the berry accent, or a registry Art
 * tile through next/image with the well painted the art's own ground so the
 * tile shows no seam. Decorative: aria-hidden, empty alt.
 */
export default function IconWell({ icon, size = 'md', className, style }: IconWellProps) {
  const d = DIMENSIONS[size];
  const box: CSSProperties = { ...clayWell, width: d.well, height: d.well, borderRadius: d.radius, ...style };
  if (isSectionArt(icon)) {
    return (
      <span className={className} style={{ ...box, background: icon.bg }} aria-hidden="true">
        <Image
          src={icon.src}
          alt=""
          width={d.art}
          height={d.art}
          sizes={`${d.art}px`}
          style={{ width: d.art, height: d.art, objectFit: 'contain' }}
        />
      </span>
    );
  }
  const Glyph = icon;
  return (
    <span className={className} style={box} aria-hidden="true">
      <Glyph size={d.glyph} strokeWidth={2} color={CLAY_ACCENT} />
    </span>
  );
}
