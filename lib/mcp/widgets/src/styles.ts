/**
 * Widget stylesheet. The cards carry the look of the board's job cards
 * (components/JobCard.tsx and components/ui/Badge.tsx): a
 * soft white card with a raised shadow, a round employer avatar, the serif
 * title, puffy clay pills with pay in pink, and the berry gradient Easy Apply
 * button. The body font and the dark theme's surfaces still come from the
 * host, so a card sits in the conversation instead of on top of it.
 *
 * The site has no dark theme. In a dark host the shapes stay the same and
 * the surfaces, pills and shadows are redrawn for a dark background.
 *
 * Theme follows the host: the runtime sets data-theme on <html>.
 */
export const WIDGET_CSS = `
:root {
  color-scheme: light;
  --pm-font: var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  --pm-heading: Lora, Georgia, "Times New Roman", serif;
  --pm-bg: var(--color-background-primary, #ffffff);
  --pm-surface: #f3f2ef;
  --pm-raised: #ffffff;
  --pm-text: #2d3748;
  --pm-muted: #4a5568;
  --pm-faint: #718096;
  --pm-border: rgba(0, 0, 0, 0.08);
  --pm-border-strong: rgba(0, 0, 0, 0.16);
  --pm-card-edge: rgba(0, 0, 0, 0.05);
  --pm-accent: #be185d;
  --pm-accent-strong: #9d174d;
  --pm-accent-soft: #fce7f3;
  --pm-accent-text: #9d174d;
  --pm-pay-bg: #fbcfe8;
  --pm-pay-text: #9d174d;
  --pm-pill-bg: #edf2ee;
  --pm-pill-text: #374151;
  --pm-pill-edge: rgba(255, 255, 255, 0.5);
  --pm-btn-bg: #f7f8f6;
  --pm-btn-text: #374151;
  --pm-success: #065f46;
  --pm-success-soft: #a7f3d0;
  --pm-warn: #78350f;
  --pm-warn-soft: #fde68a;
  --pm-danger: #991b1b;
  --pm-danger-soft: #fecaca;
  --pm-info: #1e40af;
  --pm-info-soft: #dbeafe;
  --pm-radius: 20px;
  --pm-radius-sm: 14px;
  /* How far a job card's text sits in from the card's edge: the avatar (44px) and the row's gap (14px). */
  --pm-inset: 58px;
  --pm-shadow: 8px 8px 20px rgba(0, 0, 0, 0.07), -4px -4px 12px rgba(255, 255, 255, 0.9), inset 2px 2px 4px rgba(255, 255, 255, 0.6), inset -1px -1px 2px rgba(0, 0, 0, 0.02);
  --pm-clay: 4px 4px 10px rgba(0, 0, 0, 0.06), -2px -2px 6px rgba(255, 255, 255, 0.8), inset 2px 2px 4px rgba(255, 255, 255, 0.7), inset -1px -1px 2px rgba(0, 0, 0, 0.03);
  --pm-clay-accent: 4px 4px 10px rgba(190, 24, 93, 0.25), -2px -2px 6px rgba(255, 255, 255, 0.3), inset 2px 2px 4px rgba(255, 255, 255, 0.25), inset -1px -1px 2px rgba(0, 0, 0, 0.08);
  --pm-focus: 0 0 0 3px rgba(190, 24, 93, 0.35);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --pm-bg: var(--color-background-primary, #1b1c1e);
  --pm-surface: rgba(255, 255, 255, 0.05);
  --pm-raised: #26282b;
  --pm-text: var(--color-text-primary, #f1f2f4);
  --pm-muted: var(--color-text-secondary, #b4bac4);
  --pm-faint: #8b919b;
  --pm-border: rgba(255, 255, 255, 0.10);
  --pm-border-strong: rgba(255, 255, 255, 0.20);
  --pm-card-edge: rgba(255, 255, 255, 0.07);
  --pm-accent: #f472b6;
  --pm-accent-strong: #f9a8d4;
  --pm-accent-soft: rgba(244, 114, 182, 0.14);
  --pm-accent-text: #fbcfe8;
  --pm-pay-bg: rgba(244, 114, 182, 0.20);
  --pm-pay-text: #fbcfe8;
  --pm-pill-bg: rgba(255, 255, 255, 0.09);
  --pm-pill-text: #d7dbe0;
  --pm-pill-edge: rgba(255, 255, 255, 0.06);
  --pm-btn-bg: rgba(255, 255, 255, 0.08);
  --pm-btn-text: #e5e7eb;
  --pm-success: #a7f3d0;
  --pm-success-soft: rgba(52, 211, 153, 0.20);
  --pm-warn: #fde68a;
  --pm-warn-soft: rgba(251, 191, 36, 0.20);
  --pm-danger: #fecaca;
  --pm-danger-soft: rgba(248, 113, 113, 0.22);
  --pm-info: #c7d2fe;
  --pm-info-soft: rgba(129, 140, 248, 0.22);
  --pm-shadow: 6px 6px 16px rgba(0, 0, 0, 0.35), -2px -2px 8px rgba(255, 255, 255, 0.03), inset 1px 1px 2px rgba(255, 255, 255, 0.06), inset -1px -1px 2px rgba(0, 0, 0, 0.25);
  --pm-clay: 3px 3px 8px rgba(0, 0, 0, 0.30), inset 1px 1px 2px rgba(255, 255, 255, 0.08), inset -1px -1px 2px rgba(0, 0, 0, 0.20);
  --pm-clay-accent: 3px 3px 10px rgba(0, 0, 0, 0.35), inset 1px 1px 2px rgba(255, 255, 255, 0.25), inset -1px -1px 2px rgba(0, 0, 0, 0.12);
  --pm-focus: 0 0 0 3px rgba(244, 114, 182, 0.35);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body { font: 14px/1.5 var(--pm-font); color: var(--pm-text); -webkit-font-smoothing: antialiased; }
/* Room for the raised shadows, which the frame would otherwise clip. */
.pm-root { padding: 6px 10px 18px 6px; }
button { font: inherit; }
:focus-visible { outline: none; box-shadow: var(--pm-focus); border-radius: var(--pm-radius-sm); }
.pm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pm-icon { flex: none; display: inline-block; vertical-align: -2px; }

.pm-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 0 0 12px; padding: 0 2px; }
.pm-head h2 { font-family: var(--pm-heading); font-size: 18px; line-height: 1.3; margin: 0; font-weight: 700; }
.pm-head p { margin: 2px 0 0; color: var(--pm-muted); font-size: 13px; }
.pm-kicker { font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--pm-accent-text); margin: 0 0 2px; }

.pm-list { display: grid; gap: 14px; }
/* Cards stacked outside a list (a posting's status above its preview) get the list's gap. */
.pm-card + .pm-card:not(.pm-list > *) { margin-top: 14px; }
.pm-card { background: var(--pm-raised); border: 1px solid var(--pm-card-edge); border-radius: var(--pm-radius); padding: 16px 18px; box-shadow: var(--pm-shadow); transition: transform .2s ease, border-color .2s ease; }
/* A posting that takes applications here, as the site outlines an employer's own post. */
.pm-card.is-easy { border: 2px solid var(--pm-accent); padding: 15px 17px; }
.pm-card.is-clickable { cursor: pointer; }
.pm-card.is-clickable:hover { transform: translateY(-2px); }
.pm-card.is-clickable:active { transform: translateY(0); }
.pm-row { display: flex; gap: 14px; align-items: flex-start; }
.pm-grow { flex: 1 1 auto; min-width: 0; }
.pm-avatar { position: relative; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 16px; letter-spacing: 0.01em; color: #ffffff; background: hsl(var(--pm-hue, 170) 40% 50%); }
:root[data-theme="dark"] .pm-avatar { background: hsl(var(--pm-hue, 170) 38% 44%); }
.pm-verified { position: absolute; right: -2px; bottom: -2px; width: 16px; height: 16px; border-radius: 50%; background: #ffffff; display: grid; place-items: center; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); }
.pm-title { font-family: var(--pm-heading); font-size: 17px; font-weight: 700; line-height: 1.3; margin: 0 0 3px; overflow-wrap: anywhere; }
.pm-title-link { appearance: none; border: 0; background: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.pm-title-link:hover { color: var(--pm-accent-text); }
.pm-sub { margin: 0; color: var(--pm-muted); font-size: 13.5px; font-weight: 500; overflow-wrap: anywhere; }
.pm-dot { color: var(--pm-faint); margin: 0 6px; }
.pm-also { margin: 4px 0 0; color: var(--pm-faint); font-size: 12.5px; font-weight: 500; overflow-wrap: anywhere; }
.pm-loc { white-space: nowrap; }
.pm-loc .pm-icon { color: var(--pm-accent); margin-right: 3px; }
.pm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pm-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; line-height: 1.2; padding: 5px 13px; border-radius: 20px; background: var(--pm-pill-bg); color: var(--pm-pill-text); border: 1px solid var(--pm-pill-edge); box-shadow: var(--pm-clay); white-space: nowrap; }
.pm-chip strong { color: var(--pm-text); font-weight: 700; }
.pm-chip--pay { background: var(--pm-pay-bg); color: var(--pm-pay-text); font-weight: 700; font-size: 13px; }
.pm-chip--accent { background: var(--pm-accent-soft); color: var(--pm-accent-text); font-weight: 600; }
.pm-chip--success { background: var(--pm-success-soft); color: var(--pm-success); font-weight: 600; }
.pm-chip--warn { background: var(--pm-warn-soft); color: var(--pm-warn); font-weight: 600; }
.pm-chip--danger { background: var(--pm-danger-soft); color: var(--pm-danger); font-weight: 600; }
.pm-chip--info { background: var(--pm-info-soft); color: var(--pm-info); font-weight: 600; }
.pm-meta { margin-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--pm-faint); font-size: 12.5px; font-weight: 500; }
.pm-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pm-actions--end { justify-content: flex-end; }
/* A job card's last row. When the date and the buttons do not fit on one
   line, the date keeps its line and the buttons go to the next one together.
   Left to wrap as it liked, a card with Easy Apply (the wider button) broke
   its date over two lines and stacked its buttons. */
.pm-meta--job { flex-wrap: wrap; row-gap: 8px; }
.pm-meta--job > span:first-child { white-space: nowrap; }
.pm-meta--job .pm-actions { flex-wrap: nowrap; margin-left: auto; }

.pm-btn { appearance: none; border: 1px solid var(--pm-pill-edge); background: var(--pm-btn-bg); color: var(--pm-btn-text); border-radius: var(--pm-radius-sm); padding: 8px 16px; font-size: 13px; font-weight: 600; line-height: 1.2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; box-shadow: var(--pm-clay); transition: transform .15s ease, filter .15s ease, opacity .15s ease; }
.pm-btn:hover { transform: translateY(-1px); color: var(--pm-accent-text); }
.pm-btn--primary { background: linear-gradient(135deg, #f472b6, #be185d); border-color: rgba(255, 255, 255, 0.3); color: #ffffff; font-weight: 700; box-shadow: var(--pm-clay-accent); text-shadow: 0 1px 1px rgba(0, 0, 0, 0.18); }
.pm-btn--primary:hover { background: linear-gradient(135deg, #db2777, #9d174d); color: #ffffff; }
.pm-btn--danger { color: var(--pm-danger); background: var(--pm-danger-soft); }
.pm-btn--danger:hover { color: var(--pm-danger); }
.pm-btn--ghost { border-color: transparent; background: transparent; box-shadow: none; color: var(--pm-accent-text); padding-left: 8px; padding-right: 8px; }
.pm-btn--ghost:hover { background: var(--pm-accent-soft); transform: none; }
.pm-btn--block { width: 100%; justify-content: center; padding: 11px 16px; font-size: 14px; }
.pm-btn[disabled] { opacity: .55; cursor: default; transform: none; }
.pm-btn.is-active { color: var(--pm-accent-text); background: var(--pm-accent-soft); }
.pm-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: pm-spin .7s linear infinite; }
@keyframes pm-spin { to { transform: rotate(360deg); } }

.pm-more { margin-top: 14px; display: flex; justify-content: center; }
.pm-footer { margin-top: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; color: var(--pm-faint); font-size: 12.5px; padding: 0 2px; }
.pm-link { appearance: none; border: 0; background: none; padding: 0; color: var(--pm-accent-text); font-weight: 600; cursor: pointer; font-size: inherit; text-decoration: none; text-align: left; }
.pm-link:hover { text-decoration: underline; }

.pm-empty { text-align: center; padding: 24px 16px; border: 1px dashed var(--pm-border-strong); border-radius: var(--pm-radius); color: var(--pm-muted); }
.pm-empty strong { display: block; font-family: var(--pm-heading); color: var(--pm-text); font-size: 16px; margin-bottom: 4px; }
.pm-alert { border-radius: var(--pm-radius-sm); padding: 10px 14px; font-size: 13px; font-weight: 500; margin: 0 0 12px; display: flex; gap: 8px; align-items: flex-start; }
.pm-alert--warn { background: var(--pm-warn-soft); color: var(--pm-warn); }
.pm-alert--danger { background: var(--pm-danger-soft); color: var(--pm-danger); }
.pm-alert--info { background: var(--pm-info-soft); color: var(--pm-info); }
.pm-alert--success { background: var(--pm-success-soft); color: var(--pm-success); }

.pm-detail-head { display: flex; gap: 14px; align-items: flex-start; }
.pm-detail-head .pm-avatar { width: 52px; height: 52px; font-size: 19px; }
.pm-detail-title { font-family: var(--pm-heading); font-size: 20px; font-weight: 700; line-height: 1.28; margin: 0 0 3px; overflow-wrap: anywhere; }
.pm-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
.pm-fact { background: var(--pm-surface); border-radius: var(--pm-radius-sm); padding: 10px 13px; min-width: 0; }
.pm-fact span { display: block; font-size: 11.5px; color: var(--pm-faint); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.pm-fact strong { display: block; font-size: 13.5px; font-weight: 600; margin-top: 2px; overflow-wrap: anywhere; }
.pm-section { margin-top: 16px; }
.pm-card > .pm-section:first-child { margin-top: 0; }
.pm-section h3 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pm-faint); margin: 0 0 8px; font-weight: 700; }
.pm-prose { white-space: pre-line; color: var(--pm-text); font-size: 13.5px; line-height: 1.6; max-height: 260px; overflow: auto; padding-right: 4px; }
.pm-prose.is-open { max-height: none; }
.pm-back { margin: 0 0 10px; }
.pm-divider { height: 1px; background: var(--pm-border); margin: 16px 0; border: 0; }

.pm-rows { display: grid; gap: 2px; }
.pm-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--pm-border); font-size: 13.5px; }
.pm-kv:last-child { border-bottom: 0; }
.pm-kv span { color: var(--pm-muted); }
.pm-kv strong { font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.pm-kv.is-strong strong { font-size: 16px; font-weight: 700; color: var(--pm-accent-text); }
.pm-kv.is-strong span { color: var(--pm-text); font-weight: 600; }
.pm-item { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
.pm-item .pm-title { font-size: 15.5px; }
.pm-item-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.pm-linkbar { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; padding: 0 2px; font-size: 13px; }

.pm-form { display: grid; gap: 14px; }
.pm-field > label, .pm-field legend { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 6px; }
.pm-field .pm-hint { color: var(--pm-faint); font-size: 12px; margin-top: 4px; }
.pm-field fieldset { border: 0; padding: 0; margin: 0; }
.pm-input, .pm-textarea, .pm-select { width: 100%; font: inherit; color: var(--pm-text); background: var(--pm-bg); border: 1px solid var(--pm-border-strong); border-radius: 12px; padding: 10px 12px; }
.pm-textarea { min-height: 150px; resize: vertical; line-height: 1.55; }
.pm-input:focus, .pm-textarea:focus, .pm-select:focus { outline: none; border-color: var(--pm-accent); box-shadow: var(--pm-focus); }
.pm-options { display: flex; flex-wrap: wrap; gap: 8px; }
.pm-option { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border: 1px solid var(--pm-border-strong); border-radius: var(--pm-radius-sm); cursor: pointer; font-size: 13px; }
.pm-option input { accent-color: var(--pm-accent); margin: 0; }
.pm-check { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; background: var(--pm-surface); border-radius: var(--pm-radius-sm); cursor: pointer; font-size: 13px; }
.pm-check input { accent-color: var(--pm-accent); margin-top: 2px; width: 16px; height: 16px; flex: none; }
.pm-share { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px 14px; font-size: 13px; }
.pm-share > div { min-width: 0; overflow-wrap: anywhere; }
.pm-share div span { color: var(--pm-faint); display: block; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.pm-error { color: #b42318; font-size: 12.5px; margin-top: 4px; }
:root[data-theme="dark"] .pm-error { color: #fca5a5; }
.pm-count { font-size: 12px; color: var(--pm-faint); text-align: right; margin-top: 4px; }

.pm-success { text-align: center; padding: 18px 10px 6px; }
.pm-success-icon { width: 48px; height: 48px; border-radius: 50%; margin: 0 auto 10px; display: grid; place-items: center; background: var(--pm-success-soft); color: var(--pm-success); }
.pm-success h2 { font-family: var(--pm-heading); margin: 0 0 4px; font-size: 18px; }
.pm-success p { margin: 0 0 14px; color: var(--pm-muted); }

.pm-pay-rows { display: grid; gap: 14px; margin-top: 6px; }
.pm-pay-label { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; margin-bottom: 6px; }
.pm-pay-label strong { font-weight: 700; }
.pm-pay-label span { color: var(--pm-faint); font-size: 12px; white-space: nowrap; }
.pm-track { position: relative; height: 40px; }
.pm-track::before { content: ""; position: absolute; left: 0; right: 0; top: 27px; height: 2px; background: var(--pm-border); border-radius: 2px; }
.pm-iqr { position: absolute; top: 22px; height: 12px; border-radius: 6px; background: var(--pm-pay-bg); border: 1px solid var(--pm-accent); }
.pm-median { position: absolute; top: 18px; width: 3px; height: 20px; margin-left: -1.5px; border-radius: 2px; background: var(--pm-accent-strong); }
.pm-median-label { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px; font-weight: 700; color: var(--pm-text); white-space: nowrap; }
.pm-axis { display: flex; justify-content: space-between; color: var(--pm-faint); font-size: 11.5px; margin-top: 8px; }
.pm-note { color: var(--pm-faint); font-size: 12px; margin-top: 12px; line-height: 1.5; }

.pm-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 20px; white-space: nowrap; border: 1px solid var(--pm-pill-edge); box-shadow: var(--pm-clay); }
.pm-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pm-status--applied, .pm-status--draft { background: var(--pm-pill-bg); color: var(--pm-pill-text); }
.pm-status--screening, .pm-status--pending_payment { background: var(--pm-info-soft); color: var(--pm-info); }
.pm-status--interview, .pm-status--offered { background: var(--pm-warn-soft); color: var(--pm-warn); }
.pm-status--hired, .pm-status--live { background: var(--pm-success-soft); color: var(--pm-success); }
.pm-status--rejected, .pm-status--withdrawn, .pm-status--expired, .pm-status--paused, .pm-status--closed { background: var(--pm-pill-bg); color: var(--pm-faint); }

.pm-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 8px; margin: 0 0 6px; scrollbar-width: none; }
.pm-tabs::-webkit-scrollbar { display: none; }
.pm-tab { appearance: none; border: 1px solid var(--pm-pill-edge); background: var(--pm-pill-bg); color: var(--pm-pill-text); border-radius: 20px; padding: 6px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; box-shadow: var(--pm-clay); }
.pm-tab.is-active { background: var(--pm-accent); color: #ffffff; border-color: transparent; }
:root[data-theme="dark"] .pm-tab.is-active { color: #04201d; }
.pm-tab b { font-weight: 700; margin-left: 4px; opacity: .8; }
.pm-stats { display: flex; gap: 14px; margin-top: 10px; flex-wrap: wrap; }
.pm-stat { font-size: 12.5px; color: var(--pm-muted); }
.pm-stat strong { color: var(--pm-text); font-size: 14px; margin-right: 3px; }
.pm-qa { margin-top: 10px; display: grid; gap: 4px; font-size: 12.5px; }
.pm-qa div { color: var(--pm-muted); }
.pm-qa strong { color: var(--pm-text); font-weight: 600; }
.pm-price { display: flex; align-items: baseline; gap: 6px; }
.pm-price strong { font-family: var(--pm-heading); font-size: 28px; }
.pm-price span { color: var(--pm-muted); font-size: 13px; }
.pm-panel { background: var(--pm-surface); border-radius: var(--pm-radius-sm); padding: 14px 16px; margin-top: 14px; }
.pm-pulse { display: inline-flex; align-items: center; gap: 8px; color: var(--pm-muted); font-size: 13px; }
.pm-pulse::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--pm-accent); animation: pm-pulse 1.4s ease-in-out infinite; }
@keyframes pm-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

.pm-skel { display: grid; gap: 14px; }
.pm-skel div { height: 96px; border-radius: var(--pm-radius); background: linear-gradient(90deg, var(--pm-surface), var(--pm-border), var(--pm-surface)); background-size: 200% 100%; animation: pm-shimmer 1.3s ease-in-out infinite; }
@keyframes pm-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.pm-toast { position: sticky; bottom: 4px; margin-top: 12px; background: #2d3748; color: #ffffff; border-radius: var(--pm-radius-sm); padding: 10px 14px; font-size: 13px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); }

/* On a phone the pills and the last row of a job card run the card's full
   width, under the avatar, as they do on the site's own card. Indented beside
   the avatar they had too little room: pills dropped to a row of their own
   and Easy Apply, the wider button, did not fit beside the date. 520px is
   past the widest phone and past the width at which that row fits indented. */
@media (max-width: 520px) {
  .pm-job .pm-chips, .pm-job .pm-meta--job { margin-left: calc(-1 * var(--pm-inset)); }
  .pm-meta--job, .pm-meta--job .pm-actions { column-gap: 6px; }
}
@media (max-width: 420px) {
  /* The smaller avatar below (38px) and the row's gap. */
  :root { --pm-inset: 52px; }
  .pm-root { padding: 4px 6px 14px 4px; }
  .pm-card { padding: 14px; }
  .pm-card.is-easy { padding: 13px; }
  .pm-avatar { width: 38px; height: 38px; font-size: 14px; }
  .pm-title { font-size: 16px; }
  .pm-facts { grid-template-columns: 1fr 1fr; }
  .pm-btn { padding: 8px 12px; }
  /* A little tighter in a job card's last row, so the date and both buttons share one line on a narrow phone as well. */
  .pm-meta--job .pm-btn { padding: 8px 10px; gap: 5px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition: none !important; }
}
`;
