/**
 * Display formatting for the widget views. Pure, so it is unit tested
 * against fixed clocks. Copy follows the site style: no dashes, ranges read
 * "X to Y".
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Posted today", "Posted yesterday", "Posted 5 days ago", "Posted 3 weeks ago". */
export function postedLabel(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 14) return `Posted ${days} days ago`;
  if (days < 60) return `Posted ${Math.floor(days / 7)} weeks ago`;
  return `Posted ${Math.floor(days / 30)} months ago`;
}

/** "Oct 3", or "Oct 3, 2025" outside the current year. */
export function shortDate(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** 145000 to "$145k". Whole thousands; the figures are advertised pay, not precise. */
export function moneyK(dollars: number): string {
  return `$${Math.round(dollars / 1000)}k`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** First letters of the first two words, for the employer avatar. */
export function initials(name: string): string {
  // An explicit Latin range rather than \p{L}: tsconfig targets ES2017,
  // which predates Unicode property escapes.
  const words = name.replace(/[^A-Za-z0-9À-ɏ\s]/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join('') || '?';
}

/** Stable hue from a string, so each employer keeps its avatar colour. */
export function hueFor(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}

export const STATUS_LABELS: Readonly<Record<string, string>> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offered: 'Offer',
  hired: 'Hired',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export const POSTING_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  pending_payment: 'Awaiting payment',
  live: 'Live',
  paused: 'Paused',
  expired: 'Expired',
  closed: 'Closed',
};
