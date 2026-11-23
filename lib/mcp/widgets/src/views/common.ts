import { html, raw, type SafeHtml } from '../ui';
import { hueFor, initials, statusLabel } from '../format';

/**
 * Small building blocks shared by every view. Pure functions returning
 * SafeHtml, so views compose without ever concatenating raw strings.
 */

/**
 * The few icons the site's job card uses, drawn inline: a widget can fetch
 * nothing, so there is no icon font or sprite to load. Fixed markup, no data.
 */
const ICON_PATHS = {
  zap: '<path fill="currentColor" stroke="none" d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  bookmarked: '<path fill="currentColor" d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, size = 14): SafeHtml {
  return raw(
    `<svg class="pm-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`,
  );
}

/** The blue check the site puts on an employer it has confirmed. */
const VERIFIED_MARK = raw(
  '<span class="pm-verified" title="Verified employer"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#1d9bf0" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="pm-sr">Verified employer</span></span>',
);

export function avatar(name: string, verified = false): SafeHtml {
  return html`<div class="pm-avatar" style="--pm-hue:${hueFor(name)}"><span aria-hidden="true">${initials(name)}</span>${verified ? VERIFIED_MARK : ''}</div>`;
}

export type ChipTone = 'pay' | 'accent' | 'success' | 'warn' | 'danger' | 'info' | 'plain';

export function chip(label: string | null | undefined, tone: ChipTone = 'plain'): SafeHtml | '' {
  if (!label) return '';
  const cls = tone === 'plain' ? 'pm-chip' : `pm-chip pm-chip--${tone}`;
  return html`<span class="${cls}">${label}</span>`;
}

/** Only known statuses map to a class; anything else renders neutral. */
const STATUS_CLASSES = new Set([
  'applied', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn',
  'draft', 'pending_payment', 'live', 'paused', 'expired', 'closed',
]);

export function statusPill(status: string, label?: string): SafeHtml {
  const cls = STATUS_CLASSES.has(status) ? `pm-status pm-status--${status}` : 'pm-status pm-status--applied';
  return html`<span class="${cls}">${label ?? statusLabel(status)}</span>`;
}

export function alertBox(message: string, tone: 'warn' | 'danger' | 'info' | 'success' = 'info'): SafeHtml {
  return html`<div class="pm-alert pm-alert--${tone}" role="${tone === 'danger' ? 'alert' : 'status'}">${message}</div>`;
}

export function spinner(): SafeHtml {
  return raw('<span class="pm-spin" aria-hidden="true"></span>');
}

export interface ButtonOptions {
  action: string;
  label: string;
  variant?: 'primary' | 'danger' | 'ghost' | 'plain';
  data?: Record<string, string | number | boolean | null | undefined>;
  busy?: boolean;
  disabled?: boolean;
  block?: boolean;
  pressed?: boolean;
  ariaLabel?: string;
  /** Drawn before the label; the spinner takes its place while busy. */
  icon?: IconName;
}

export function button(options: ButtonOptions): SafeHtml {
  const classes = ['pm-btn'];
  if (options.variant && options.variant !== 'plain') classes.push(`pm-btn--${options.variant}`);
  if (options.block) classes.push('pm-btn--block');
  if (options.pressed) classes.push('is-active');
  const dataAttrs = Object.entries(options.data ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => html` data-${raw(k.replace(/[^a-z0-9-]/gi, ''))}="${String(v)}"`);
  const lead = options.busy ? spinner() : options.icon ? icon(options.icon, 13) : '';
  return html`<button type="button" class="${classes.join(' ')}" data-action="${options.action}"${dataAttrs}${
    options.disabled || options.busy ? raw(' disabled') : ''
  }${options.pressed !== undefined ? raw(` aria-pressed="${options.pressed ? 'true' : 'false'}"`) : ''}${
    options.ariaLabel ? html` aria-label="${options.ariaLabel}"` : ''
  }>${lead}${options.label}</button>`;
}

/** A text-style link that opens through the host, never as a raw href. */
export function link(label: string, url: string | null | undefined): SafeHtml | '' {
  if (!url) return '';
  return html`<button type="button" class="pm-link" data-action="open-url" data-url="${url}">${label}</button>`;
}

export function empty(title: string, body: string, action?: SafeHtml): SafeHtml {
  return html`<div class="pm-empty"><strong>${title}</strong>${body}${action ? html`<div class="pm-more">${action}</div>` : ''}</div>`;
}

export function header(title: string, subtitle?: string | null, kicker?: string | null, right?: SafeHtml | ''): SafeHtml {
  return html`<div class="pm-head"><div class="pm-grow">${kicker ? html`<p class="pm-kicker">${kicker}</p>` : ''}<h2>${title}</h2>${
    subtitle ? html`<p>${subtitle}</p>` : ''
  }</div>${right ?? ''}</div>`;
}
