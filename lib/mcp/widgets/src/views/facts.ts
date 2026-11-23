import { html, when, type SafeHtml } from '../ui';
import type { CardLink, FactSection, FactsViewData, ListViewData } from '../contracts';
import { chip, empty, header, icon, link } from './common';

/**
 * The two generic cards: labelled figures in sections (a calculator result,
 * a profile check, jobs side by side) and titled rows that open pages
 * (articles, guides, alerts). Tools that answer with facts or with a list
 * share these instead of each bringing a renderer.
 */

function linkBar(links: CardLink[]): SafeHtml | '' {
  if (links.length === 0) return '';
  return html`<div class="pm-linkbar">${links.map((l) => link(l.label, l.url))}</div>`;
}

function section(data: FactSection): SafeHtml {
  return html`<div class="pm-section">
  ${when(data.heading, () => html`<h3>${data.heading}</h3>`)}
  <div class="pm-rows">${data.rows.map(
    (row) => html`<div class="pm-kv${row.emphasis ? ' is-strong' : ''}"><span>${row.label}</span><strong>${row.value}</strong></div>`,
  )}</div>
</div>`;
}

export function renderFacts(data: FactsViewData): SafeHtml {
  const sections = data.sections.filter((s) => s.rows.length > 0);
  return html`${header(data.title, data.subtitle, data.kicker)}
<article class="pm-card">
  ${sections.length > 0 ? sections.map(section) : html`<p class="pm-sub">Nothing to show yet.</p>`}
  ${data.notes.map((note) => html`<p class="pm-note">${note}</p>`)}
</article>
${linkBar(data.links)}`;
}

export function renderList(data: ListViewData): SafeHtml {
  if (data.items.length === 0) {
    return html`${header(data.title, data.subtitle, data.kicker)}${empty(data.title, data.emptyText)}${linkBar(data.links)}`;
  }
  return html`${header(data.title, data.subtitle, data.kicker)}
<div class="pm-list">${data.items.map(
    (item) => html`<article class="pm-card">
  <div class="pm-item">
    <div class="pm-grow">
      <h3 class="pm-title">${
        item.url
          ? html`<button type="button" class="pm-title-link" data-action="open-url" data-url="${item.url}">${item.title}</button>`
          : item.title
      }</h3>
      ${when(item.subtitle, () => html`<p class="pm-sub">${item.subtitle}</p>`)}
      ${when(item.meta, () => html`<div class="pm-meta" style="margin-top:8px"><span>${item.meta}</span></div>`)}
    </div>
    <div class="pm-item-side">
      ${chip(item.badge, item.badge && item.badge.startsWith('$') ? 'pay' : 'plain')}
      ${item.url ? html`<button type="button" class="pm-btn" data-action="open-url" data-url="${item.url}">Open${icon('arrow', 13)}</button>` : ''}
    </div>
  </div>
</article>`,
  )}</div>
${linkBar(data.links)}`;
}
