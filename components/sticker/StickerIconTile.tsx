import Image from 'next/image';
import { isStickerArt, type StickerIcon } from './types';

interface StickerIconTileProps {
  icon: StickerIcon;
  /** 36px tile (default) or the 60px .stk-icon-lg tile. */
  size?: 'md' | 'lg';
  className?: string;
}

const GLYPH_PX = { md: 18, lg: 26 } as const;
const TILE_PX = { md: 36, lg: 60 } as const;

/**
 * The .stk-icon tile. A lucide glyph renders at 18px (26px large) in oxblood;
 * raster art fills the tile edge to edge with object-fit cover and the tile
 * face is painted the art's own ground (A.4.4), so nothing but the 2px border
 * and hard shadow frame it. Decorative: the label beside it carries meaning.
 */
export default function StickerIconTile({ icon, size = 'md', className }: StickerIconTileProps) {
  const classes = ['stk-icon', size === 'lg' && 'stk-icon-lg', className];
  if (isStickerArt(icon)) {
    classes.push('stk-icon-art');
    return (
      <span className={classes.filter(Boolean).join(' ')} style={{ background: icon.bg }} aria-hidden="true">
        <Image src={icon.src} alt="" fill sizes={`${TILE_PX[size]}px`} style={{ objectFit: 'cover' }} />
      </span>
    );
  }
  const Glyph = icon;
  return (
    <span className={classes.filter(Boolean).join(' ')} aria-hidden="true">
      <Glyph size={GLYPH_PX[size]} strokeWidth={2.25} />
    </span>
  );
}
