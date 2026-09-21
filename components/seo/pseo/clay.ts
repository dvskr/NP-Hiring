/**
 * Clay tokens for the pSEO sections (owner decision, 2026-09-20: the site is
 * a combination of clay and sticker; the pSEO pages are clay and every new
 * block on them is styled clay to match its host).
 *
 * Every value is copied from the templates (lib/pseo/setting-state-template.tsx
 * `clayCard`, app/jobs/remote/page.tsx, app/jobs/locations/page.tsx): white
 * rounded cards with the soft neumorphic shadow on the cream ground, pastel
 * chips, recessed icon wells and the berry accent. Styles are inline objects;
 * the one stylesheet (PSEO_CLAY_CSS) is a static string with no interpolation,
 * rendered by <ClayStyles /> (React hoists it into <head> and keeps one copy).
 */
import type { CSSProperties } from 'react';

export const CLAY_GROUND = '#FDFBF7';
export const CLAY_INK = '#1A2E35';
export const CLAY_BODY = '#5A4A42';
export const CLAY_MUTED = '#7A6A62';
export const CLAY_ACCENT = '#BE185D';
export const CLAY_ACCENT_DEEP = '#831843';
export const CLAY_EYEBROW = '#E86C2C';
export const CLAY_WELL_GROUND = '#F9F7F1';
export const CLAY_RULE = 'rgba(0,0,0,0.06)';
/** Pay bar track (oxblood at 12%); the fill is the flat accent. */
export const CLAY_TRACK = 'rgba(122,28,43,0.12)';

/** Pastel chip fills, cycled by index: blush, mint, peach, deep blush. */
export const CLAY_FILLS = ['#FDF2F8', '#E6FFFA', '#FFF3E8', '#FCE7F3'] as const;

/** The fill for an index; any integer wraps the cycle. */
export function clayFill(index: number): string {
  const n = CLAY_FILLS.length;
  return CLAY_FILLS[((index % n) + n) % n];
}

const CARD_SHADOW =
  '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)';
const SOFT_SHADOW = '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)';
const INSET_SHADOW = 'inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5)';

/** The clay card surface, identical to the templates' `clayCard`. */
export const clayCard: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: CARD_SHADOW,
};

/** Recessed icon well; IconWell sets the size and radius. */
export const clayWell: CSSProperties = {
  background: CLAY_WELL_GROUND,
  border: '1px solid #EAE6DF',
  boxShadow: INSET_SHADOW,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

/** Pastel label chip; the fill comes from clayFill. */
export const clayChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 12px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: CLAY_INK,
  border: '1px solid rgba(255,255,255,0.6)',
  boxShadow: SOFT_SHADOW,
  whiteSpace: 'nowrap',
};

/** Linked place tile (radius 12, soft shadow), count in the accent. */
export const clayTile: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 14px',
  borderRadius: '12px',
  background: '#FFFFFF',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: SOFT_SHADOW,
  color: CLAY_INK,
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
};

/** Stat tile: a small clay card. */
export const clayStat: CSSProperties = {
  ...clayCard,
  borderRadius: '16px',
  padding: '12px 16px',
  minWidth: '96px',
  textAlign: 'center',
};

/** The alert CTA card on the pastel gradient with the 2px berry border. */
export const clayCta: CSSProperties = {
  ...clayCard,
  padding: '24px',
  background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
  border: '2px solid rgba(190,24,93,0.15)',
};

/** Primary button: berry, white text, radius 12. */
export const clayButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px 28px',
  borderRadius: '12px',
  background: CLAY_ACCENT,
  color: '#FFFFFF',
  fontSize: '14px',
  fontWeight: 700,
  textDecoration: 'none',
  boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
};

export const clayEyebrow: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: CLAY_EYEBROW,
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  margin: '0 0 8px',
};

/** Band heading; pair with className="font-lora". */
export const clayH2: CSSProperties = {
  fontSize: 'clamp(24px, 3.2vw, 34px)',
  fontWeight: 700,
  color: CLAY_INK,
  lineHeight: 1.2,
  margin: 0,
};

export const clayLede: CSSProperties = {
  fontSize: '15px',
  color: CLAY_BODY,
  lineHeight: 1.6,
  margin: '8px 0 0',
  maxWidth: '560px',
};

/** Card title (h3 or h4). */
export const clayTitle: CSSProperties = {
  fontSize: '17px',
  fontWeight: 800,
  color: CLAY_INK,
  lineHeight: 1.3,
  margin: '0 0 8px',
};

export const clayDesc: CSSProperties = {
  fontSize: '14px',
  color: CLAY_BODY,
  lineHeight: 1.65,
  margin: 0,
};

export const clayMuted: CSSProperties = {
  fontSize: '12px',
  color: CLAY_MUTED,
  lineHeight: 1.5,
  margin: 0,
};

export const clayLink: CSSProperties = {
  color: CLAY_ACCENT,
  fontWeight: 600,
  textDecoration: 'none',
};

/** Row meta (a count, a figure) in the accent. */
export const clayMeta: CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: CLAY_ACCENT,
  whiteSpace: 'nowrap',
};

/** Divided list: rows separated by the 1px rule. */
export const clayList: CSSProperties = {
  listStyle: 'none',
  margin: '16px 0 0',
  padding: 0,
};

export function clayRow(isLast: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 0',
    fontSize: '14px',
    color: CLAY_BODY,
    borderBottom: isLast ? undefined : '1px solid rgba(0,0,0,0.06)',
  };
}

export function cx(...names: Array<string | null | undefined | false>): string {
  return names.filter(Boolean).join(' ');
}

/**
 * The one stylesheet: column grids and bento spans (with their tablet and
 * phone collapse), the hover lift (transform only, links only, gated for
 * reduced motion) and the native accordion marker. Static, no interpolation.
 */
export const PSEO_CLAY_CSS = `
.pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
.pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
.pseo-clay-span-3 { grid-column: span 3; }
.pseo-clay-span-4 { grid-column: span 4; }
.pseo-clay-span-6 { grid-column: span 6; }
.pseo-clay-span-8 { grid-column: span 8; }
.pseo-clay-span-12 { grid-column: span 12; }
.pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pseo-clay-lift { transition: transform 0.25s ease; }
.pseo-clay-lift:hover { transform: translateY(-3px); }
.pseo-clay-faq summary { list-style: none; }
.pseo-clay-faq summary::-webkit-details-marker { display: none; }
.pseo-clay-chevron svg { transition: transform 0.2s ease; }
.pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
@media (min-width: 769px) and (max-width: 1024px) {
  .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
}
@media (max-width: 768px) {
  .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
  .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
  .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
  .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .pseo-clay-lift { transition: none; }
  .pseo-clay-lift:hover { transform: none; }
  .pseo-clay-chevron svg { transition: none; }
}
`;
