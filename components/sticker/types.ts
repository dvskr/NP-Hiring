import type { LucideIcon } from 'lucide-react';

/**
 * Raster art for a sticker icon tile: a path under public/ and the picture's
 * baked ground color, which paints the tile face so the art shows no seam.
 * Structurally the same shape as the registry's `Art`
 * (lib/pseo/category-asset-registry.ts), so registry values pass straight in.
 */
export interface StickerArt {
  src: string;
  bg: string;
}

/** A lucide glyph component or a raster art entry. */
export type StickerIcon = LucideIcon | StickerArt;

export function isStickerArt(icon: StickerIcon): icon is StickerArt {
  return typeof icon === 'object' && icon !== null && 'src' in icon;
}
