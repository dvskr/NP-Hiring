/**
 * Styles for a guide preview page (components/guides/GuidePreviewPage.tsx):
 * the excerpt set like an article inside one sticker, the table of
 * contents, the key figure stickers and the open FAQ. Same oxblood, berry
 * and cream palette as the rest of the store (components/guides/styles.ts).
 *
 * A plain string with no interpolation (the styled-jsx Turbopack deadlock
 * rule, inventory.md 6.7), rendered after GUIDES_CSS.
 */
export const GUIDE_PREVIEW_CSS = `
  .gd-reading { max-width: 780px; margin: 0 auto; text-align: left; }
  .gd-intro { margin: 0; font-size: 17px; color: #3d2f33; line-height: 1.6; }
  .gd-section-head { text-align: left; margin: 0 0 24px; }
  .gd-section-head .stk-h2 { text-align: left; }
  .gd-section-note { margin: 12px 0 0; font-size: 15px; color: #5A4A42; line-height: 1.6; }

  .gd-inline-link { color: #9D174D; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
  .gd-inline-link:hover { color: #BE185D; }
  .gd-inline-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

  .gd-excerpt-card {
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 6px 6px 0 #7A1C2B;
    padding: clamp(22px, 4.5vw, 44px);
  }
  .guide-excerpt { color: #2b1a1e; font-size: 16.5px; line-height: 1.7; overflow-wrap: anywhere; }
  .guide-excerpt h2 { font-size: clamp(1.4rem, 2.8vw, 1.8rem); font-weight: 700; line-height: 1.25; margin: 44px 0 14px; color: #7A1C2B; }
  .guide-excerpt h3 { font-size: 18px; font-weight: 800; line-height: 1.35; margin: 30px 0 10px; color: #2b1a1e; }
  .guide-excerpt h2:first-child, .guide-excerpt h3:first-child { margin-top: 0; }
  .guide-excerpt p { margin: 0 0 14px; color: #3d2f33; }
  .guide-excerpt strong { color: #2b1a1e; font-weight: 800; }
  .guide-excerpt ul, .guide-excerpt ol { margin: 0 0 16px; padding-left: 22px; }
  .guide-excerpt li { margin: 0 0 6px; color: #3d2f33; }
  .guide-excerpt ul li::marker { color: #BE185D; }
  .guide-excerpt ol li::marker { font-weight: 800; color: #7A1C2B; }
  .guide-excerpt-template {
    margin: 6px 0 18px;
    padding: 16px 18px;
    background: #FDFBF7;
    border: 2px dashed #7A1C2B;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.65;
    color: #2b1a1e;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .guide-excerpt-table, .guide-figure-table { overflow-x: auto; background: #fff; border: 2px solid #7A1C2B; }
  .guide-excerpt-table { margin: 6px 0 20px; box-shadow: 4px 4px 0 #7A1C2B; }
  .guide-excerpt-table:focus-visible, .guide-figure-table:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
  .guide-excerpt table, .guide-figure table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.45; overflow-wrap: normal; }
  .guide-excerpt th, .guide-excerpt td, .guide-figure th, .guide-figure td { padding: 10px 14px; text-align: left; vertical-align: top; border-top: 1px solid rgba(122,28,43,0.12); }
  .guide-excerpt th, .guide-excerpt td { min-width: 120px; }
  .guide-figure th, .guide-figure td { min-width: 88px; }
  .guide-excerpt thead th, .guide-figure thead th {
    background: #FBF2E6;
    color: #7A1C2B;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-top: 0;
    border-bottom: 2px solid #7A1C2B;
  }
  .guide-excerpt tbody td:first-child { font-weight: 700; color: #2b1a1e; }
  .guide-excerpt tbody tr:nth-child(even) td { background: #FDFBF7; }
  .guide-excerpt-disclaimer {
    margin: 28px 0 0;
    padding: 14px 16px;
    background: #FBE7EE;
    border-left: 4px solid #BE185D;
    font-size: 13.5px;
    line-height: 1.6;
    color: #5A4A42;
  }
  .guide-bridge { margin: 24px 0 0; font-size: 15.5px; line-height: 1.65; color: #2b1a1e; }
  .guide-bridge a { color: #9D174D; font-weight: 800; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
  .guide-bridge a:hover { color: #BE185D; }
  .guide-bridge a:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

  .guide-toc { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); text-align: left; }
  .guide-toc-entry { background: #fff; border: 2px solid #7A1C2B; box-shadow: 4px 4px 0 #7A1C2B; padding: 16px 18px; }
  .guide-toc-entry-shown { background: #FBE7EE; }
  .guide-toc-title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 0; font-size: 15px; font-weight: 800; color: #2b1a1e; line-height: 1.4; }
  .guide-toc-number { color: #BE185D; }
  .guide-toc-page { flex-shrink: 0; font-size: 12.5px; font-weight: 700; color: #7a6d70; font-variant-numeric: tabular-nums; }
  .guide-toc-shown {
    display: inline-block;
    margin-top: 10px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #fff;
    background: #BE185D;
    border: 2px solid #7A1C2B;
    text-decoration: none;
  }
  .guide-toc-shown:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .guide-toc-sections { margin: 10px 0 0; padding-left: 18px; display: grid; gap: 3px; font-size: 13.5px; color: #5A4A42; line-height: 1.45; }

  .guide-figures { display: flex; flex-wrap: wrap; gap: 20px; text-align: left; }
  .guide-figure {
    flex: 1 1 260px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    padding: 22px;
  }
  .guide-figure-wide { flex: 2 1 420px; }
  .guide-figure h3 { margin: 0; font-size: 11.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #BE185D; }
  .guide-figure-number { margin: 0; font-size: clamp(1.6rem, 3.4vw, 2.1rem); font-weight: 700; color: #7A1C2B; line-height: 1.1; }
  .guide-figure-text { margin: 0; font-size: 14.5px; color: #5A4A42; line-height: 1.6; }
  .guide-figure tbody th { font-weight: 700; color: #2b1a1e; }
  .guide-figure td { font-variant-numeric: tabular-nums; color: #3d2f33; }
  .guide-figure-source { margin: auto 0 0; padding-top: 10px; font-size: 12px; line-height: 1.5; color: #7a6d70; border-top: 1px dashed rgba(122,28,43,0.3); }

  .gd-audience { display: grid; gap: 10px; background: #fff; border: 2px solid #7A1C2B; box-shadow: 5px 5px 0 #7A1C2B; padding: 26px; text-align: left; }
  .gd-audience h2 { margin: 0; font-size: 22px; font-weight: 700; color: #7A1C2B; display: flex; align-items: center; gap: 10px; }
  .gd-audience h3 { margin: 8px 0 0; font-size: 15px; font-weight: 800; color: #2b1a1e; }
  .gd-audience p { margin: 0; font-size: 15px; color: #5A4A42; line-height: 1.65; }

  .guide-faq { display: grid; gap: 14px; text-align: left; }
  .guide-faq-item { background: #fff; border: 2px solid #7A1C2B; box-shadow: 4px 4px 0 #7A1C2B; padding: 18px 22px; }
  .guide-faq-item h3 { margin: 0 0 8px; font-size: 16.5px; font-weight: 800; color: #2b1a1e; line-height: 1.4; }
  .guide-faq-item p { margin: 0; font-size: 15px; color: #5A4A42; line-height: 1.65; }

  .gd-buy-card { background: #fff; border: 2px solid #7A1C2B; box-shadow: 8px 8px 0 #7A1C2B; padding: clamp(24px, 4vw, 40px); }
  .gd-others { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr); }
  .gd-other-card { display: flex; flex-direction: row; gap: 14px; align-items: flex-start; text-decoration: none; color: inherit; }
  .gd-other-card .stk-title { font-size: 15px; margin: 0 0 4px; }
  .gd-other-card .stk-desc { margin: 0 0 10px; }

  @media (min-width: 760px) {
    .guide-toc { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gd-others { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 1000px) {
    .gd-others { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
`;
