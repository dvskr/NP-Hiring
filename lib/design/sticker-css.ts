/**
 * Sticker card system: the one static stylesheet every pSEO page renders
 * through <StickerStyles /> (components/sticker/StickerStyles.tsx).
 *
 * Source of truth for the shared rules is app/resources/page.tsx (the first
 * page converted to the system, 2026-09-10 owner direction): every rule that
 * page also declares is copied here byte for byte, so the two surfaces can
 * never drift apart in the shared classes. That page keeps its own copy for
 * now (its tests read the file); the dedupe is a recorded follow-up.
 *
 * Additions for the pSEO restyle (PLAN.md B.2): compact tiles and pills, a
 * native <details> accordion, divided lists, a scoped JobCard surface
 * override, a table, a 12 column bento grid, a full bleed picture frame and
 * the breadcrumb band the templates wrap the shared Breadcrumbs component in.
 *
 * DELIVERY RULE (inventory.md 6.7): this string is a plain template literal
 * with no interpolation, rendered in a plain <style>. styled-jsx with `${}`
 * deadlocks the Turbopack route compile. Per instance values (chip fill,
 * bar width, icon ground) go in inline `style`, never in here. The absence
 * of `${` is pinned by tests/regressions/sticker-kit.test.ts.
 *
 * Tokens (inventory.md 6.1): ink, border and hard shadow #7A1C2B; berry
 * #BE185D; berry dark #9D174D; card face #fff; title ink #2b1a1e; body
 * muted #7a6d70; lede #5A4A42; action muted #9b8291. Radius 0 everywhere
 * except the clay chip (999px). Shadows are hard offsets with no blur.
 */

/** Chip and stat fills, cycled by index (homepage constants). */
export const STICKER_FILLS = ['#D5F5F1', '#FBCFE8', '#FDE3C8', '#B9EBD6'] as const;

/** Decorative accent bar widths, cycled by index (homepage constants). */
export const STICKER_BAR_WIDTHS = ['38%', '64%', '22%', '50%'] as const;

/** Fill for the nth chip or stat; any integer index wraps around the cycle. */
export function stickerFill(index: number): string {
  const n = STICKER_FILLS.length;
  return STICKER_FILLS[((index % n) + n) % n];
}

/** Accent bar width for the nth card; any integer index wraps around the cycle. */
export function stickerBarWidth(index: number): string {
  const n = STICKER_BAR_WIDTHS.length;
  return STICKER_BAR_WIDTHS[((index % n) + n) % n];
}

export const STICKER_CSS = `
  /* Sticker card system: same anatomy as the homepage tools band */
  .stk-grid { display: grid; gap: 24px; }
  .stk-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    padding: 20px;
    text-decoration: none;
    color: inherit;
    text-align: left;
    transition: transform 0.15s ease;
  }
  a.stk-card { cursor: pointer; }
  a.stk-card:hover { transform: translateY(-4px); }
  a.stk-card:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .stk-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .stk-chip {
    display: inline-block;
    align-self: flex-start;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.5);
    box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 5px rgba(255,255,255,0.8), inset 2px 2px 3px rgba(255,255,255,0.7);
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #7A1C2B;
  }
  .stk-icon {
    flex: none;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #FBF2E6;
    border: 2px solid #7A1C2B;
    box-shadow: 3px 3px 0 #7A1C2B;
    color: #7A1C2B;
  }
  .stk-icon-lg { width: 60px; height: 60px; box-shadow: 4px 4px 0 #7A1C2B; }
  /* Raster icon in the tile: the art fills the face edge to edge, and the
     tile is painted the art's own baked ground (inline) so no seam shows. */
  .stk-icon-art { position: relative; overflow: hidden; }
  .stk-title {
    font-weight: 700;
    font-size: 18px;
    line-height: 1.3;
    color: #2b1a1e;
    margin: 0 0 8px;
  }
  .stk-desc {
    font-size: 12.5px;
    color: #7a6d70;
    line-height: 1.5;
    margin: 0 0 14px;
  }
  .stk-bar {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stk-track {
    flex: 1;
    height: 4px;
    background: rgba(122,28,43,0.12);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .stk-fill {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    background: #BE185D;
    border-radius: 2px;
  }
  .stk-action {
    font-size: 11px;
    font-weight: 800;
    color: #9b8291;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .stk-wide {
    flex-direction: row;
    align-items: center;
    gap: 24px;
    height: auto;
  }
  .stk-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .stk-grid-2 > .stk-card:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .stk-body .stk-chip { margin-bottom: 12px; }
  .stk-more {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 24px;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #fff;
    background: #BE185D;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
    text-decoration: none;
    transition: transform 0.15s ease, background 0.2s ease;
  }
  .stk-more:hover { transform: translateY(-2px); background: #9D174D; }
  .stk-more:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  @media (max-width: 560px) {
    .stk-wide { flex-direction: column; align-items: flex-start; }
    .stk-wide .stk-icon-lg { display: none; }
  }
  /* Stages: each band keeps its own ground (homepage rule) */
  .stk-stage { position: relative; padding: 88px 20px; }
  .stk-stage-grid {
    background-color: #F5F0EB;
    background-image: linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px);
    background-size: 44px 44px;
  }
  .stk-stage-mint { background-color: #E9F5EE; }
  .stk-stage-peach {
    background-color: #FBF2E6;
    background-image: radial-gradient(rgba(122,28,43,0.14) 1.2px, transparent 1.4px);
    background-size: 22px 22px;
  }
  .stk-stage-blush {
    background-color: #FBE7EE;
    background-image: radial-gradient(rgba(122,28,43,0.18) 1.2px, transparent 1.4px);
    background-size: 22px 22px;
  }
  .stk-stage-cream { background-color: #FDFBF7; }
  /* Content column inside a stage (1100px on /resources; override inline) */
  .stk-inner { max-width: 1100px; margin: 0 auto; }

  /* Headings: pink eyebrow, uppercase berry Lora, muted lede */
  .stk-head { text-align: center; margin: 0 auto 40px; max-width: 640px; }
  .stk-eyebrow {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #BE185D;
    margin: 0 0 8px;
  }
  .stk-h1 {
    font-weight: 700;
    font-size: clamp(2.2rem, 5.2vw, 3.6rem);
    line-height: 1.02;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: #7A1C2B;
    margin: 0;
    text-wrap: balance;
  }
  .stk-h2 {
    font-weight: 700;
    font-size: clamp(26px, 3vw, 36px);
    line-height: 1.1;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: #7A1C2B;
    margin: 0;
    text-wrap: balance;
  }
  .stk-lede { font-size: 15px; color: #5A4A42; line-height: 1.6; max-width: 580px; margin: 12px auto 0; }
  /* Homepage variant: left aligned copy with the action button on the right */
  .stk-head-left {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 16px 32px;
    text-align: left;
    max-width: none;
    margin: 0 0 30px;
  }
  .stk-head-left .stk-lede { margin: 12px 0 0; }
  .stk-head-action { margin-top: 20px; }

  /* Stat stickers in the hero */
  .stk-stat {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 18px;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
  }
  .stk-stat-value { font-size: 22px; font-weight: 700; color: #7A1C2B; line-height: 1; }
  .stk-stat-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #7A1C2B; }
  .stk-stat-row { display: flex; flex-wrap: wrap; gap: 16px; }

  /* Large sticker frame around an embedded tool */
  .stk-frame { background: #fff; border: 2px solid #7A1C2B; box-shadow: 6px 6px 0 #7A1C2B; overflow: hidden; }
  /* The embedded checker ships its own rounded, shadowed shell: square it off inside the frame */
  .stk-frame > * { border-radius: 0 !important; box-shadow: none !important; border: 0 !important; margin: 0 !important; }

  /* Full bleed picture frame: the picture cell (components/ImmersiveImage.tsx)
     runs edge to edge inside a 2px border with a hard shadow, never padded. */
  .stk-img {
    display: block;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    overflow: hidden;
  }
  .stk-img > * { display: block; }

  /* State guide tiles: image in a sticker frame, name, action word */
  .stk-state { display: flex; flex-direction: column; align-items: center; gap: 6px; text-decoration: none; transition: transform 0.15s ease; }
  .stk-state-img {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    margin-bottom: 8px;
  }
  .stk-state-name { font-size: 15px; font-weight: 700; color: #2b1a1e; text-align: center; line-height: 1.25; }
  .stk-state:hover { transform: translateY(-4px); }
  .stk-state:focus-visible { outline: 3px solid #BE185D; outline-offset: 4px; }

  /* Article category header */
  .stk-cat-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .stk-cat-title { font-size: 20px; font-weight: 700; color: #7A1C2B; text-transform: uppercase; letter-spacing: -0.01em; margin: 0; }
  .stk-cat-count {
    font-size: 11px;
    font-weight: 800;
    color: #7A1C2B;
    background: #FDE3C8;
    border: 2px solid #7A1C2B;
    padding: 2px 9px;
  }

  /* Inline text link */
  .stk-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7A1C2B;
    text-decoration: none;
    border-bottom: 2px solid #BE185D;
    padding-bottom: 2px;
  }
  .stk-link:hover { color: #BE185D; }
  .stk-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }

  /* Closing call to action: one berry sticker */
  .stk-cta {
    text-align: center;
    background: #BE185D;
    border: 2px solid #7A1C2B;
    box-shadow: 8px 8px 0 #7A1C2B;
    padding: 44px 32px;
    color: #fff;
  }
  .stk-icon-on-berry { margin: 0 auto 18px; background: #FBCFE8; }
  .stk-cta-title {
    font-size: clamp(22px, 2.6vw, 30px);
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.15;
    margin: 0 0 10px;
    color: #fff;
    text-wrap: balance;
  }
  .stk-cta-lede { font-size: 15px; color: #FDE7F0; margin: 0 0 28px; }
  .stk-cta-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; }
  .stk-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 13px 26px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7A1C2B;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
    text-decoration: none;
    transition: transform 0.15s ease;
  }
  .stk-btn:hover { transform: translateY(-2px); }
  .stk-btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .stk-btn-ghost { background: #9D174D; color: #fff; }
  /* The same button on a light stage (pagination, secondary CTAs) needs the berry outline */
  .stk-btn-light:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
  .stk-btn-sm { padding: 9px 16px; font-size: 12px; }
  .stk-btn[aria-disabled="true"] { box-shadow: none; opacity: 0.55; pointer-events: none; }

  /* Compact linked tile: label and an optional count badge */
  .stk-tile {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
    color: #2b1a1e;
    text-decoration: none;
    transition: transform 0.15s ease;
  }
  .stk-tile-label { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; line-height: 1.25; }
  .stk-tile:hover { transform: translateY(-2px); }
  .stk-tile:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .stk-tile-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }

  /* Link pill: the smallest sticker */
  .stk-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #7A1C2B;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 2px 2px 0 #7A1C2B;
    text-decoration: none;
    transition: transform 0.15s ease, background 0.2s ease;
  }
  .stk-pill-count {
    font-size: 10.5px;
    padding: 1px 6px;
    background: #FDE3C8;
    border: 1px solid #7A1C2B;
    line-height: 1.4;
  }
  .stk-pill:hover { transform: translateY(-2px); background: #FBF2E6; }
  .stk-pill:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .stk-pill-row { display: flex; flex-wrap: wrap; gap: 12px; }

  /* Accordion: native details and summary, answers always in the HTML */
  .stk-acc-list { display: flex; flex-direction: column; gap: 14px; }
  .stk-acc {
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
  }
  .stk-acc > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    cursor: pointer;
    list-style: none;
  }
  .stk-acc > summary::-webkit-details-marker { display: none; }
  .stk-acc > summary:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .stk-acc-q { font-size: 16px; font-weight: 700; line-height: 1.35; color: #2b1a1e; margin: 0; }
  .stk-acc-chevron svg { transition: transform 0.15s ease; }
  .stk-acc[open] > summary .stk-acc-chevron svg { transform: rotate(180deg); }
  .stk-acc-body { padding: 0 20px 20px; }
  .stk-acc .faq-answer { font-size: 14px; color: #5A4A42; line-height: 1.7; margin: 0; }

  /* Divided list inside a static card */
  .stk-list { list-style: none; margin: 0; padding: 0; }
  .stk-list > li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid rgba(122,28,43,0.12);
    font-size: 13.5px;
    color: #2b1a1e;
    line-height: 1.4;
  }
  .stk-list > li:first-child { border-top: 0; }
  .stk-list-meta { flex: none; font-size: 12px; font-weight: 700; color: #7a6d70; white-space: nowrap; }
  .stk-list a { color: inherit; text-decoration: none; }
  .stk-list a:hover { color: #BE185D; }
  .stk-list a:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

  /* Job listings on pSEO pages: only the JobCard surface changes
     (components/JobCard.tsx is untouched; its inline styles need !important) */
  .stk-jobs .jc-card, .stk-jobs .jc-list-card {
    border-radius: 0 !important;
    border: 2px solid #7A1C2B !important;
    box-shadow: 4px 4px 0 #7A1C2B !important;
    background-color: #fff !important;
  }

  /* Table (nearby states): one sticker around a plain table */
  .stk-table-wrap {
    overflow-x: auto;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
  }
  .stk-table { width: 100%; border-collapse: collapse; font-size: 13.5px; color: #2b1a1e; }
  .stk-table caption {
    caption-side: top;
    text-align: left;
    padding: 14px 18px 6px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #BE185D;
  }
  .stk-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #7A1C2B;
    padding: 10px 18px;
    background: #FBF2E6;
    border-bottom: 2px solid #7A1C2B;
  }
  .stk-table tbody th { font-size: 13.5px; letter-spacing: 0; text-transform: none; background: transparent; border-bottom: 0; }
  .stk-table td, .stk-table tbody th { padding: 11px 18px; border-top: 1px solid rgba(122,28,43,0.12); }
  .stk-table tbody tr:first-child td, .stk-table tbody tr:first-child th { border-top: 0; }
  .stk-table .stk-num { text-align: right; font-variant-numeric: tabular-nums; }
  .stk-table a { color: #7A1C2B; font-weight: 700; text-decoration: none; }
  .stk-table a:hover { color: #BE185D; }
  .stk-table a:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

  /* Bento: 12 columns, two columns under 1024px, one column under 768px */
  .stk-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 24px; }
  .stk-span-3 { grid-column: span 3; }
  .stk-span-4 { grid-column: span 4; }
  .stk-span-6 { grid-column: span 6; }
  .stk-span-8 { grid-column: span 8; }
  .stk-span-12 { grid-column: 1 / -1; }

  /* Column helpers for .stk-grid (3 to 2 to 1, 4 to 2 to 1, 5 to 3 to 2) */
  .stk-cols-2 { grid-template-columns: repeat(2, 1fr); }
  .stk-cols-3 { grid-template-columns: repeat(3, 1fr); }
  .stk-cols-4 { grid-template-columns: repeat(4, 1fr); }
  .stk-cols-5 { grid-template-columns: repeat(5, 1fr); }

  /* Breadcrumb band above the hero: the shared Breadcrumbs component is not
     restyled itself, only framed here (its inline colors need !important) */
  .pseo-crumb-band { background: #FDFBF7; border-bottom: 2px solid #7A1C2B; padding: 14px 56px; }
  .pseo-crumb-band nav { margin-bottom: 0; }
  .pseo-crumb-band nav ol { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .pseo-crumb-band .bc-link { color: #7A1C2B !important; }
  .pseo-crumb-band .bc-link:hover { color: #BE185D !important; }
  .pseo-crumb-band .bc-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  /* The current page is the H1 directly below, so its crumb is kept for
     assistive technology but not drawn (owner request, 2026-09-16). */
  .pseo-crumb-band nav ol li:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  @media (prefers-reduced-motion: reduce) {
    a.stk-card:hover, .stk-more:hover, .stk-state:hover, .stk-btn:hover, .stk-tile:hover, .stk-pill:hover { transform: none; }
    .stk-acc-chevron svg { transition: none; }
  }
  @media (min-width: 769px) and (max-width: 1024px) {
    .stk-cols-3, .stk-cols-4 { grid-template-columns: repeat(2, 1fr); }
    .stk-cols-5 { grid-template-columns: repeat(3, 1fr); }
    .stk-bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stk-span-3, .stk-span-4, .stk-span-6 { grid-column: span 1; }
    .stk-span-8 { grid-column: 1 / -1; }
  }
  @media (max-width: 768px) {
    .stk-cols-2, .stk-cols-3, .stk-cols-4 { grid-template-columns: 1fr; }
    .stk-cols-5 { grid-template-columns: repeat(2, 1fr); }
    .stk-bento { grid-template-columns: 1fr; }
    .stk-span-3, .stk-span-4, .stk-span-6, .stk-span-8 { grid-column: 1 / -1; }
    .stk-head-left { margin-bottom: 24px; }
    .stk-stage { padding: 60px 16px; }
    .stk-cta { padding: 36px 20px; }
    .pseo-crumb-band { padding: 12px 24px; }
  }
`;
