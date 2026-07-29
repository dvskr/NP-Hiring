/**
 * Shared visual language for every OG card generator under app/api/og/**.
 *
 * WHY THIS FILE EXISTS (P3 #8): /api/og rendered the donor-era dark-navy card
 * while /api/og/city rendered the live warm clay/cream design, so two share
 * cards from the same site looked like two different products. Both
 * generators now compose the SAME chrome from here.
 *
 * The palette is the live brand, not a new invention — every hex below is
 * already a CSS custom property in app/globals.css:
 *   --color-primary        #BE185D  (berry)
 *   --color-primary-dark   #9D174D
 *   --color-primary-400    #F472B6
 *   --bg-primary           #F5F0EB  (cream page ground)
 * plus the clay accent (#DB7558) and ink (#1F2947) the city card already
 * shipped. config/brand.ts stays the only source of identity STRINGS; this
 * file owns only geometry and colour.
 *
 * DELIBERATELY NOT SHARED — the logo fetch and the brandmark JSX stay
 * duplicated per route:
 *   - tests/regressions/audit-coverage-static.test.ts pins the fixed-origin
 *     logo fetch in EACH route file (the SSRF guard: never the request Host
 *     header).
 *   - tests/regressions/shell-brand-remnants.test.ts pins the config-derived
 *     alt text and wordmark fallback inside app/api/og/route.tsx.
 * Both pins are per-file on purpose: a new generator must re-state the safe
 * pattern rather than inherit it invisibly.
 *
 * Edge-safe: no node APIs, no font fetching. Both routes render on next/og's
 * built-in sans stack exactly as they did before, so nothing here can break
 * the edge runtime or add a network dependency.
 */
import type { ReactNode } from 'react';
import { brand } from '@/config/brand';

/** Canonical share-card box. Every generator renders at this size. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * Edge-cache directives shared by every generator: 30 days at the CDN with a
 * 1-day background revalidate. Vercel keys the cache by full URL, so each
 * distinct query-string combination is cached separately.
 */
export const OG_CACHE_HEADERS = {
  'Cache-Control': 'public, immutable, max-age=0, s-maxage=2592000, stale-while-revalidate=86400',
  'CDN-Cache-Control': 'public, max-age=2592000',
  'Vercel-CDN-Cache-Control': 'public, max-age=2592000',
} as const;

/** Live-brand tokens (see header note for the globals.css mapping). */
export const og = {
  ink: '#1F2947',
  inkMuted: '#55607A',
  inkFaint: '#8A9BA6',
  berry: '#BE185D',
  berryDeep: '#9D174D',
  berryLight: '#F472B6',
  surface: 'linear-gradient(145deg, #FFF8F0 0%, #F5E6D3 40%, #FBEFE4 100%)',
  tile: 'linear-gradient(145deg, #FFFFFF, #F5EDE2)',
  pill: 'linear-gradient(145deg, #FFFFFF, #F1E1CE)',
  accentBar: 'linear-gradient(90deg, #F472B6, #BE185D, #DB7558)',
  berryFill: 'linear-gradient(145deg, #BE185D, #9D174D)',
  clayFill: 'linear-gradient(145deg, #DB7558, #C56B4E)',
  // Deeper clay for white-on-fill chips — the lighter clayFill only reaches
  // ~3:1 against white text, which is thin for a share card seen at
  // thumbnail size in a feed.
  clayFillDeep: 'linear-gradient(145deg, #C05B3D, #A34C30)',
  tileShadow:
    '4px 4px 12px rgba(0,0,0,0.05), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 3px rgba(255,255,255,0.6)',
  hairline: '2px solid rgba(31,41,71,0.08)',
} as const;

/** Amber informational chip — a data designation, not a brand accent. */
const AMBER = { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' } as const;

// ─── icons ────────────────────────────────────────────────────────────────
// Inline strokes only. Emoji and dingbats are avoided on purpose: satori has
// no emoji font unless one is supplied, so a symbol glyph such as the staff of
// Aesculapius (U+2695) renders as tofu instead of an icon.

export type OgIconName =
  | 'briefcase'
  | 'dollar'
  | 'pin'
  | 'layers'
  | 'clock'
  | 'shieldAlert';

/** Single-colour stroke icon sized for a card chip or a pill. */
export function OgIcon({
  name,
  size = 22,
  color,
}: {
  name: OgIconName;
  size?: number;
  color: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'dollar':
      return (
        <svg {...common}>
          <line x1="12" x2="12" y1="2" y2="22" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...common}>
          <path d="M12 2L2 7l10 5 10-5-10-5Z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'shieldAlert':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      );
    case 'briefcase':
    default:
      return (
        <svg {...common}>
          <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
  }
}

// ─── layout primitives ────────────────────────────────────────────────────

/**
 * The card ground: cream gradient, top accent bar, dot texture, two soft
 * clay circles, and the padded content column children render into.
 */
export function OgSurface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: `${OG_SIZE.width}px`,
        height: `${OG_SIZE.height}px`,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'sans-serif',
        background: og.surface,
        color: og.ink,
      }}
    >
      {/* Top accent bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '6px',
          display: 'flex',
          background: og.accentBar,
        }}
      />

      {/* Dot texture */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          backgroundImage: 'radial-gradient(rgba(31,41,71,0.04) 1.5px, transparent 1.5px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Decorative claymorphic circles */}
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: '50%',
          display: 'flex',
          background: 'linear-gradient(145deg, rgba(244,114,182,0.12), rgba(244,114,182,0.04))',
          boxShadow:
            'inset 4px 4px 12px rgba(255,255,255,0.6), inset -4px -4px 12px rgba(0,0,0,0.03)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -40,
          left: -40,
          width: 200,
          height: 200,
          borderRadius: '50%',
          display: 'flex',
          background: 'linear-gradient(145deg, rgba(219,117,88,0.08), rgba(219,117,88,0.02))',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '48px 56px',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Header / body / footer column that fills the surface.
 *
 * Every generator wraps its three bands in this instead of a JSX fragment:
 * satori resolves function components but has no Fragment branch (it would
 * fall through to the unknown-element path), so fragments must not reach it.
 */
export function OgStack({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      {children}
    </div>
  );
}

/** Brandmark on the left, optional chip on the right. */
export function OgHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>{left}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>{right ?? null}</div>
    </div>
  );
}

/** Centre band that grows to fill whatever the header and footer leave. */
export function OgBody({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Hairline-topped footer row. The domain pill is appended here rather than
 * passed in, so every card in the system carries it in the same corner.
 */
export function OgFooter({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        paddingTop: 26,
        borderTop: og.hairline,
      }}
    >
      {children ?? null}
      <OgDomainPill />
    </div>
  );
}

/** Berry pill carrying the board's domain. Always the footer's right edge. */
export function OgDomainPill() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginLeft: 'auto',
        flexShrink: 0,
        padding: '14px 24px',
        borderRadius: '14px',
        background: og.berryFill,
        color: '#fff',
        fontSize: 17,
        fontWeight: 800,
        letterSpacing: '0.05em',
        boxShadow: '4px 4px 12px rgba(190,24,93,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
      }}
    >
      {brand.domain}
    </div>
  );
}

export type OgBadgeTone = 'berry' | 'clay' | 'amber';

/** Rounded chip for the header-right slot and for data designations. */
export function OgBadge({
  tone = 'berry',
  icon,
  children,
}: {
  tone?: OgBadgeTone;
  icon?: OgIconName;
  children: ReactNode;
}) {
  const skin =
    tone === 'clay'
      ? { background: og.clayFillDeep, color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.35)' }
      : tone === 'amber'
        ? { background: AMBER.bg, color: AMBER.text, border: `1px solid ${AMBER.border}` }
        : { background: og.pill, color: og.berry, border: '1px solid rgba(255,255,255,0.8)' };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
        padding: '10px 22px',
        borderRadius: '999px',
        background: skin.background,
        border: skin.border,
        boxShadow:
          tone === 'amber'
            ? 'none'
            : '4px 4px 12px rgba(0,0,0,0.06), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 3px rgba(255,255,255,0.6)',
        fontSize: 16,
        fontWeight: 800,
        color: skin.color,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
      }}
    >
      {icon ? <OgIcon name={icon} size={16} color={skin.color} /> : null}
      {children}
    </div>
  );
}

/** Icon chip used inside fact tiles. */
function OgIconChip({
  icon,
  fill,
  size,
}: {
  icon: OgIconName;
  fill: string;
  size: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: Math.round(size / 3),
        background: fill,
        color: '#fff',
      }}
    >
      <OgIcon name={icon} size={Math.round(size / 2)} color="#FFFFFF" />
    </div>
  );
}

/**
 * Raised clay tile: icon chip + small uppercase label + value.
 * `compact` shrinks it so up to four fit on one row beside the domain pill.
 */
export function OgFactTile({
  icon,
  iconTone = 'berry',
  label,
  value,
  compact = false,
}: {
  icon: OgIconName;
  iconTone?: 'berry' | 'clay';
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? '12px' : '16px',
        flexShrink: 0,
        padding: compact ? '12px 18px' : '14px 28px',
        borderRadius: '18px',
        background: og.tile,
        border: '1px solid rgba(255,255,255,0.5)',
        boxShadow: og.tileShadow,
      }}
    >
      <OgIconChip
        icon={icon}
        fill={iconTone === 'clay' ? og.clayFill : og.berryFill}
        size={compact ? 36 : 44}
      />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: compact ? 12 : 13,
            fontWeight: 700,
            color: og.inkFaint,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: compact ? 22 : 28,
            fontWeight: 900,
            color: og.ink,
            lineHeight: 1.1,
            marginTop: 2,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/** Evergreen stat tile — big berry figure over a faint label. */
export function OgStatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexGrow: 1,
        padding: '14px 20px',
        borderRadius: '18px',
        background: og.tile,
        border: '1px solid rgba(255,255,255,0.5)',
        boxShadow: og.tileShadow,
      }}
    >
      <div style={{ display: 'flex', fontSize: 38, fontWeight: 900, color: og.berry, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 13,
          fontWeight: 700,
          color: og.inkFaint,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── text helpers ─────────────────────────────────────────────────────────

/**
 * Hard cap on any query-supplied string. Every value on these cards comes
 * from a public query string, so a length cap is both a layout guarantee
 * (satori does not shrink overflowing text) and cheap abuse containment.
 */
export function ogClamp(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}
