/**
 * Icon resolution for the pSEO sections: a registry nav tile, a lucide
 * glyph name from CATEGORY_GLYPHS, a raw Art entry or a lucide component
 * all resolve to a SectionGlyph (a lucide component or a registry Art)
 * that IconWell draws. Unknown glyph names fall back to the registry's
 * never-blank default (Briefcase), never to an empty well.
 */
import { icons, type LucideIcon } from 'lucide-react';
import { categoryNavArt, type Art, type CategoryNavArt } from '@/lib/pseo/category-asset-registry';

/** A registry picture: a path under public/ and its painted ground. */
export type SectionArt = Art;

/** What IconWell draws: a lucide component or a registry Art tile. */
export type SectionGlyph = LucideIcon | SectionArt;

/** Anything a section may be handed as an icon. A string is a lucide glyph name. */
export type SectionIcon = SectionGlyph | CategoryNavArt | string;

export function isSectionArt(icon: SectionGlyph): icon is SectionArt {
  return 'src' in icon;
}

const GLYPHS = icons as Record<string, LucideIcon | undefined>;
const FALLBACK_GLYPH: LucideIcon = icons.Briefcase;

/** The lucide component for a canonical glyph name (`icons` map key). */
export function glyphIcon(name: string): LucideIcon {
  return GLYPHS[name] ?? FALLBACK_GLYPH;
}

export function resolveSectionIcon(icon: SectionIcon): SectionGlyph {
  if (typeof icon === 'string') return glyphIcon(icon);
  if ('src' in icon) return icon;
  if ('icon' in icon) return icon.icon;
  if ('glyph' in icon) return glyphIcon(icon.glyph);
  return icon;
}

/** The nav tile or glyph for a taxonomy slug, as a SectionGlyph. */
export function categoryNavIcon(slug: string): SectionGlyph {
  return resolveSectionIcon(categoryNavArt(slug));
}
