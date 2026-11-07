import type { CSSProperties } from 'react';

/**
 * The guides store's look: the sticker card system (components/sticker,
 * lib/design/sticker-css.ts) plus the few rules the store adds for prices,
 * forms, covers and the product hero. Every store page renders
 * <StickerStyles /> and then <style>{GUIDES_CSS}</style>.
 *
 * GUIDES_CSS is a plain string with no interpolation (the styled-jsx
 * Turbopack deadlock rule, inventory.md 6.7); per instance values go in
 * inline styles.
 *
 * The clay tokens at the bottom are for GuidePromo on the clay pages it is
 * placed on (owner rule: a block added to a clay page is clay).
 */

/** Sticker ink, border and hard shadow. */
export const OXBLOOD = '#7A1C2B';
export const BERRY = '#BE185D';
export const BERRY_DARK = '#9D174D';
/** Sticker card title ink. */
export const TITLE_INK = '#2b1a1e';
/** Sticker card body text. */
export const MUTED = '#7a6d70';
export const LEDE = '#5A4A42';

/** Clay surfaces (pricing, tools, job pages). */
export const CLAY_INK = '#1A2E35';
export const CLAY_BODY = '#5A4A42';
export const clayCard: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export const GUIDES_CSS = `
  .gd-pill-row { display: flex; flex-wrap: wrap; gap: 10px; }
  .gd-pill-row-center { justify-content: center; }
  .gd-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #7A1C2B;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 2px 2px 0 #7A1C2B;
  }

  .gd-price { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin: 0; }
  .gd-price-now { font-weight: 700; color: #7A1C2B; line-height: 1; }
  .gd-price-was { font-size: 15px; font-weight: 700; color: #9b8291; text-decoration: line-through; }
  .gd-price-lg .gd-price-now { font-size: 52px; }
  .gd-price-md .gd-price-now { font-size: 34px; }
  .gd-price-sm .gd-price-now { font-size: 19px; }
  .gd-price-sm .gd-price-was { font-size: 13px; }
  .gd-price-note { margin: 6px 0 0; font-size: 13px; font-weight: 700; color: #BE185D; line-height: 1.45; }

  .gd-action { display: grid; gap: 10px; width: 100%; }
  .gd-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 14px 22px;
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #fff;
    background: #BE185D;
    border: 2px solid #7A1C2B;
    border-radius: 0;
    box-shadow: 4px 4px 0 #7A1C2B;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.15s ease, background 0.2s ease;
  }
  .gd-btn:hover:not(:disabled) { transform: translateY(-2px); background: #9D174D; }
  .gd-btn:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
  .gd-btn:disabled { cursor: wait; opacity: 0.75; }
  .gd-btn-light { color: #7A1C2B; background: #fff; }
  .gd-btn-light:hover:not(:disabled) { background: #FBF2E6; }
  .gd-btn-auto { width: auto; }

  .gd-form { display: grid; gap: 10px; width: 100%; }
  .gd-input {
    width: 100%;
    box-sizing: border-box;
    padding: 13px 14px;
    font-size: 15px;
    color: #2b1a1e;
    background: #fff;
    border: 2px solid #7A1C2B;
    border-radius: 0;
  }
  .gd-input:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .gd-addon {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    font-size: 13.5px;
    line-height: 1.45;
    color: #2b1a1e;
    background: #FBF2E6;
    border: 2px dashed #7A1C2B;
    cursor: pointer;
  }
  .gd-addon input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; accent-color: #BE185D; }
  .gd-error { margin: 0; font-size: 13px; font-weight: 600; color: #B91C1C; }
  .gd-sent {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    background: #E9F5EE;
    border: 2px solid #7A1C2B;
    box-shadow: 3px 3px 0 #7A1C2B;
  }
  .gd-sent p { margin: 0; font-size: 14px; font-weight: 700; color: #2b1a1e; line-height: 1.5; overflow-wrap: anywhere; }

  .gd-hero {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 8px 8px 0 #7A1C2B;
    overflow: hidden;
  }
  .gd-hero-art {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    overflow: hidden;
    background-color: #FBE7EE;
    background-image: radial-gradient(rgba(122,28,43,0.18) 1.2px, transparent 1.4px);
    background-size: 22px 22px;
    border-right: 2px solid #7A1C2B;
  }
  .gd-hero-copy { padding: 36px 32px; display: flex; flex-direction: column; gap: 14px; text-align: left; }
  .gd-hero-title { font-size: clamp(24px, 3vw, 32px); font-weight: 700; line-height: 1.15; text-transform: uppercase; color: #7A1C2B; margin: 0; }
  .gd-hero-copy p.gd-hero-lede { margin: 0; font-size: 15px; color: #5A4A42; line-height: 1.6; }

  .gd-product-hero { display: grid; grid-template-columns: auto 1fr; gap: 44px; align-items: center; text-align: left; }
  .gd-product-art { display: flex; justify-content: center; }
  .gd-product-copy { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .gd-product-sub { margin: 0; font-size: 17px; color: #5A4A42; line-height: 1.55; }
  .gd-product-action { max-width: 440px; }
  .gd-fine { margin: 0; font-size: 12.5px; color: #7a6d70; line-height: 1.55; }

  .gd-chapters { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
  .gd-chapters li { display: flex; gap: 14px; align-items: baseline; font-size: 15px; color: #2b1a1e; line-height: 1.5; }
  .gd-chapter-no { min-width: 24px; font-size: 13px; font-weight: 800; color: #BE185D; font-variant-numeric: tabular-nums; }
  .gd-checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .gd-checks li { display: flex; gap: 8px; font-size: 13.5px; color: #2b1a1e; line-height: 1.45; }
  .gd-checks svg { color: #BE185D; flex-shrink: 0; margin-top: 2px; }
  .gd-meta { margin: 0; font-size: 12.5px; font-weight: 700; color: #7a6d70; }

  .gd-split { display: grid; grid-template-columns: 1.4fr 1fr; gap: 28px; align-items: start; }
  .gd-row-card { display: flex; flex-direction: row; gap: 16px; align-items: flex-start; }
  .gd-row-card-center { align-items: center; }
  .gd-cover-wrap { flex-shrink: 0; padding: 0 5px 5px 0; }
  .gd-table-mark { color: #BE185D; display: inline-block; vertical-align: middle; }
  .gd-table-none { color: #c9b8bd; }
  .stk-table td.gd-cell-center, .stk-table th.gd-cell-center { text-align: center; }

  @media (max-width: 860px) {
    .gd-hero { grid-template-columns: 1fr; }
    .gd-hero-art { border-right: 0; border-bottom: 2px solid #7A1C2B; }
    .gd-split { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .gd-product-hero { grid-template-columns: 1fr; gap: 28px; }
    .gd-hero-copy { padding: 28px 20px; }
  }
  @media (max-width: 420px) {
    .gd-stack-lg { transform: scale(0.78); margin: -24px 0; }
    .gd-price-lg .gd-price-now { font-size: 42px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gd-btn { transition: none; }
    .gd-btn:hover:not(:disabled) { transform: none; }
  }
`;
