import { html, when, type SafeHtml } from '../ui';
import { moneyK, plural } from '../format';
import type { PaySummary, PayViewData } from '../contracts';
import { board } from '../board';
import { alertBox, chip, header, link } from './common';

/**
 * A range strip per segment: the band is the middle half of advertised pay
 * (25th to 75th percentile), the bar is the median. Every row shares one
 * axis so segments compare at a glance, and every row states its n.
 */

function axisBounds(rows: PaySummary[]): { min: number; max: number } {
  const values = rows.flatMap((r) => [r.p25 ?? r.median, r.p75 ?? r.median, r.median]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(5000, (hi - lo) * 0.12);
  return { min: Math.max(0, Math.floor((lo - pad) / 5000) * 5000), max: Math.ceil((hi + pad) / 5000) * 5000 };
}

function pct(value: number, bounds: { min: number; max: number }): number {
  if (bounds.max === bounds.min) return 50;
  return Math.min(100, Math.max(0, ((value - bounds.min) / (bounds.max - bounds.min)) * 100));
}

function strip(row: PaySummary, bounds: { min: number; max: number }): SafeHtml {
  const median = pct(row.median, bounds);
  const band =
    row.p25 !== null && row.p75 !== null
      ? html`<div class="pm-iqr" style="left:${pct(row.p25, bounds).toFixed(2)}%;width:${(pct(row.p75, bounds) - pct(row.p25, bounds)).toFixed(2)}%"></div>`
      : '';
  const range = row.p25 !== null && row.p75 !== null ? `${moneyK(row.p25)} to ${moneyK(row.p75)}` : 'Median only';
  return html`<div>
  <div class="pm-pay-label"><strong>${row.label}</strong><span>${range} · ${plural(row.n, 'posting', 'postings')}</span></div>
  <div class="pm-track" role="img" aria-label="${`${row.label}: median ${moneyK(row.median)}${row.p25 !== null && row.p75 !== null ? `, middle half ${moneyK(row.p25)} to ${moneyK(row.p75)}` : ''}`}">
    ${band}
    <div class="pm-median" style="left:${median.toFixed(2)}%"></div>
    <div class="pm-median-label" style="left:${median.toFixed(2)}%">${moneyK(row.median)}</div>
  </div>
</div>`;
}

export function renderPay(data: PayViewData): SafeHtml {
  const rows = [data.focus, data.national, data.remote]
    .filter((r): r is PaySummary => !!r)
    .filter((r, i, all) => all.findIndex((o) => o.label === r.label) === i);
  const bounds = rows.length > 0 ? axisBounds(rows) : { min: 0, max: 1 };
  const authority = data.practiceAuthority;
  return html`${header(data.title, 'Advertised pay on live postings', `${board().role} pay`.trim(), link('Salary guide', data.guideUrl))}
<article class="pm-card">
  ${when(data.note, () => alertBox(data.note!, 'info'))}
  ${when(authority, () =>
    html`<div class="pm-chips" style="margin:0 0 12px">${chip(authority!.label, authority!.tone === 'open' ? 'success' : authority!.tone === 'conditional' ? 'info' : 'warn')}</div>`,
  )}
  ${rows.length > 0
    ? html`<div class="pm-pay-rows">${rows.map((r) => strip(r, bounds))}</div>
<div class="pm-axis"><span>${moneyK(bounds.min)}</span><span>${moneyK((bounds.min + bounds.max) / 2)}</span><span>${moneyK(bounds.max)}</span></div>`
    : html`<p class="pm-sub">Not enough postings publish pay to chart yet.</p>`}
  ${when(data.topStates.length > 0, () =>
    html`<div class="pm-section"><h3>Highest state medians</h3><div class="pm-chips">${data.topStates.map((s) =>
      chip(`${s.label} ${moneyK(s.median)}`),
    )}</div></div>`,
  )}
  <p class="pm-note">${data.methodology}</p>
</article>`;
}
