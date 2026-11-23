/**
 * Minimal HTML templating for the widget views, escaping by default.
 *
 * Job titles, employer names and descriptions come from employers and from
 * aggregated sources, so every interpolated value is escaped unless it is
 * already a SafeHtml produced by this module. Links are never written as
 * href attributes from data: they carry a data-url that the action handler
 * validates before asking the host to open it.
 */
import { board } from './board';

export interface SafeHtml {
  readonly __safe: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeText(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => ESCAPES[ch] ?? ch);
}

export function raw(markup: string): SafeHtml {
  return { __safe: markup };
}

function isSafe(value: unknown): value is SafeHtml {
  return typeof value === 'object' && value !== null && typeof (value as SafeHtml).__safe === 'string';
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (isSafe(value)) return value.__safe;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeText(String(value));
}

/** Tagged template: `html\`<p>${userText}</p>\`` escapes userText. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  return { __safe: out };
}

export function when(condition: unknown, content: () => SafeHtml): SafeHtml | '' {
  return condition ? content() : '';
}

/** Stripe's checkout, beside the board's own hosts (board().hosts, written by the server). */
const CHECKOUT_HOSTS = ['checkout.stripe.com'];

/** Only https URLs on hosts this app links to may be opened from a widget. */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    // Plain http only for a local dev server, and only where the server named
    // it as the board's host (an issuer on localhost); never in production.
    if (url.protocol !== 'https:') return url.protocol === 'http:' && url.hostname === 'localhost' && board().hosts.includes('localhost');
    return board().hosts.includes(url.hostname) || CHECKOUT_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}
