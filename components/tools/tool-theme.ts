/**
 * Shared visual tokens for the /tools surfaces (P2 #4, #5, #6, #17).
 *
 * The four tools are separate indexable routes but must read as one product
 * surface, so the clay card / icon tile / control styles live here instead of
 * being re-typed per tool. Values match the established clay treatment used by
 * app/resources/page.tsx and components/LicensureChecker.tsx.
 *
 * Plain data only — imported by both server pages and client components.
 */
import type { CSSProperties } from 'react';

/** Warm cream page background used by every tool hero. */
export const TOOL_HERO_BG = 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 40%, #FFF5EE 100%)';

/** Cool slate band used for the interactive panel behind each tool. */
export const TOOL_PANEL_BG = 'linear-gradient(180deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)';

/** Accent used for tool eyebrows, primary CTAs, and focus rings. */
export const TOOL_ACCENT = '#BE185D';

export const clayCard: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow:
    '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export const iconTile: CSSProperties = {
  width: '48px',
  height: '48px',
  borderRadius: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

/**
 * Form control shared by every tool select/number input.
 *
 * NOTE — deliberately no `outline: 'none'`. These controls are embedded on
 * pages outside /tools (the benchmark picker sits on /for-employers), so the
 * focus indicator cannot depend on a stylesheet the host page happens to
 * inject. The user-agent focus ring is the floor that always renders;
 * TOOL_CONTROL_CSS then upgrades it to the brand ring. See WCAG 2.4.7.
 */
export const controlStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1.5px solid rgba(0,0,0,0.10)',
  background: '#FFFFFF',
  fontSize: '15px',
  fontWeight: 600,
  color: '#1A2E35',
  boxShadow: 'inset 2px 2px 4px rgba(0,0,0,0.03)',
};

/** Select variant — extra right padding leaves room for the native chevron. */
export const selectStyle: CSSProperties = {
  ...controlStyle,
  padding: '12px 40px 12px 14px',
  appearance: 'none',
  cursor: 'pointer',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '6px',
};

/**
 * Rules for the widgets themselves: control focus ring, source-link hover, and
 * the two-column control grid's mobile collapse.
 *
 * OWNED BY THE COMPONENTS, NOT THE PAGE. Every tool widget renders
 * <ToolStyles /> so this travels with it. It previously shipped only from the
 * four app/tools/**\/page.tsx routes, which left the benchmark picker embedded
 * on /for-employers with no focus ring and no mobile collapse.
 *
 * Plain <style> element, no template interpolation — see the styled-jsx /
 * Turbopack note in the repo's CLAUDE notes.
 */
export const TOOL_CONTROL_CSS = `
  .tool-control:focus-visible {
    border-color: rgba(190,24,93,0.55) !important;
    outline: 2px solid #BE185D !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 0 4px rgba(190,24,93,0.12), inset 2px 2px 4px rgba(0,0,0,0.03) !important;
  }
  .tool-control:focus {
    border-color: rgba(190,24,93,0.55) !important;
  }
  .tool-link:hover {
    text-decoration: underline;
  }
  @media (max-width: 860px) {
    .tool-two-col { grid-template-columns: 1fr !important; }
  }
`;

/**
 * Rules for the page chrome around the widgets (cross-link card grid). Only
 * the /tools routes render these classes, so unlike TOOL_CONTROL_CSS this one
 * stays page-owned.
 */
export const TOOL_PAGE_CSS = `
  .tool-card {
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }
  .tool-card:hover {
    transform: translateY(-4px);
  }
  @media (max-width: 860px) {
    .tool-three-col { grid-template-columns: 1fr !important; }
  }
`;

/** Currency formatter used across the tools (whole dollars). */
export function formatUsd(value: number): string {
  const rounded = Math.round(value);
  return (rounded < 0 ? '-$' : '$') + Math.abs(rounded).toLocaleString('en-US');
}

/** Compact $K formatter for dense stat tiles. */
export function formatUsdK(value: number): string {
  return '$' + Math.round(value / 1000).toLocaleString('en-US') + 'K';
}
