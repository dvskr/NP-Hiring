import { html, when, type SafeHtml } from '../ui';
import { shortDate } from '../format';
import type { ApplicationRow, ApplicationsViewData } from '../contracts';
import { board } from '../board';
import { avatar, button, empty, header, link, statusPill } from './common';

export interface ApplicationsUiState {
  busy: string | null;
  /** Set while a withdraw is waiting for its second click. */
  confirmKey: string | null;
  now: number;
}

const ACTIVE = new Set(['applied', 'screening', 'interview', 'offered']);

function row(app: ApplicationRow, ui: ApplicationsUiState): SafeHtml {
  const confirming = ui.confirmKey === `withdraw:${app.id}`;
  const canWithdraw = app.submittedOnPlatform && ACTIVE.has(app.status);
  return html`<article class="pm-card">
  <div class="pm-row">
    ${avatar(app.job.employer)}
    <div class="pm-grow">
      <div class="pm-pay-label" style="margin:0"><h3 class="pm-title">${app.job.title}</h3>${statusPill(app.status)}</div>
      <p class="pm-sub">${app.job.employer} · ${app.job.location}</p>
      <div class="pm-meta">
        <span>Applied ${shortDate(app.appliedAt, ui.now)}${app.statusUpdatedAt ? ` · Updated ${shortDate(app.statusUpdatedAt, ui.now)}` : ''}${
          app.submittedOnPlatform ? '' : ' · Applied on employer site'
        }${app.job.live ? '' : ' · Posting closed'}</span>
        <span class="pm-actions">
          ${link('Job page', app.job.url)}
          ${when(canWithdraw && !confirming, () => button({ action: 'withdraw', label: 'Withdraw', variant: 'ghost', data: { id: app.id } }))}
        </span>
      </div>
      ${when(confirming, () =>
        html`<div class="pm-alert pm-alert--warn" style="margin:10px 0 0;justify-content:space-between;flex-wrap:wrap" role="status">
<span>Withdraw from ${app.job.employer}? Your cover letter, resume link and answers are removed from it for good.</span>
<span class="pm-actions">${button({ action: 'cancel-confirm', label: 'Keep it', variant: 'ghost' })}${button({
          action: 'confirm-withdraw',
          label: 'Withdraw',
          variant: 'danger',
          busy: ui.busy === `withdraw:${app.id}`,
          data: { id: app.id },
        })}</span></div>`,
      )}
    </div>
  </div>
</article>`;
}

export function renderApplications(data: ApplicationsViewData, ui: ApplicationsUiState): SafeHtml {
  if (data.applications.length === 0) {
    return html`${header('Your applications', null, board().name)}${empty(
      'No applications yet',
      'Ask me to find jobs and apply to the ones you like.',
    )}`;
  }
  const active = data.applications.filter((a) => ACTIVE.has(a.status)).length;
  return html`${header('Your applications', `${active} active of ${data.applications.length}`, board().name, link('Manage', data.manageUrl))}
<div class="pm-list">${data.applications.map((a) => row(a, ui))}</div>`;
}
