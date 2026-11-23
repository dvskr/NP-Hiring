import { board } from '../board';
import { html, when, type SafeHtml } from '../ui';
import { POSTING_STATUS_LABELS, plural, shortDate, statusLabel } from '../format';
import type {
  ApplicantRow,
  ApplicantsViewData,
  PostingRow,
  PostingViewData,
  PostingsViewData,
} from '../contracts';
import { alertBox, avatar, button, chip, empty, header, link, statusPill } from './common';

export interface EmployerUiState {
  busy: string | null;
  confirmKey: string | null;
  now: number;
  /** Set while the widget is watching for a Stripe payment to land. */
  watchingPayment: boolean;
}

// ─── Posting preview, publish, checkout ──────────────────────────────────

export function renderPosting(data: PostingViewData, ui: EmployerUiState): SafeHtml {
  const p = data.preview;
  const preview = html`<article class="pm-card">
  <div class="pm-row">${avatar(p.employer)}<div class="pm-grow">
    <p class="pm-kicker">How candidates will see it</p>
    <h3 class="pm-title">${p.title}</h3>
    <p class="pm-sub">${p.employer} · ${p.location}</p>
    <div class="pm-chips">${chip(p.pay ?? 'No pay listed', p.pay ? 'pay' : 'warn')}${chip(p.workMode)}${chip(p.jobType)}${chip(p.experience)}${
      p.applyMethod === 'platform' ? chip(`Apply on ${board().name}`, 'accent') : chip('Applies on your site')
    }</div>
  </div></div>
  <div class="pm-section"><h3>Description</h3><div class="pm-prose">${p.descriptionExcerpt}</div></div>
  ${when(p.screeningQuestions.length > 0, () =>
    html`<div class="pm-section"><h3>Screening questions</h3><div class="pm-qa">${p.screeningQuestions.map((q) => html`<div>${q}</div>`)}</div></div>`,
  )}
  ${when(p.benefits.length > 0, () => html`<div class="pm-section"><h3>Benefits</h3><div class="pm-chips">${p.benefits.map((b) => chip(b))}</div></div>`)}
  ${when(p.contactEmail, () => html`<p class="pm-note">Applications and the posting's private dashboard link go to <strong>${p.contactEmail}</strong>.</p>`)}
</article>`;

  const issues = html`${data.errors.map((e) => alertBox(e, 'danger'))}${data.suggestions.map((s) => alertBox(s, 'info'))}`;

  if (data.stage === 'published') {
    return html`${header('Your job is live', `${p.title} · ${p.location}`, board().employerName)}
<article class="pm-card"><div class="pm-success">
<div class="pm-success-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
<h2>Published</h2><p>Candidates can see it and apply now. A confirmation with your dashboard link is in your inbox.</p>
<div class="pm-actions" style="justify-content:center">${data.jobUrl ? button({ action: 'open-url', label: 'View posting', variant: 'primary', data: { url: data.jobUrl } }) : ''}${button({
      action: 'open-url',
      label: 'Dashboard',
      data: { url: data.dashboardUrl },
    })}</div></div></article>`;
  }

  if (data.stage === 'inactive') {
    const why =
      data.inactiveReason === 'removed'
        ? `${board().name} took this posting down, so it cannot be put back up from here.${board().support ? ` If that is unexpected, write to ${board().support}.` : ''}`
        : data.inactiveReason === 'closed'
        ? `Its payment was refunded or disputed, so it is closed.${board().support ? ` If that is unexpected, write to ${board().support}.` : ''}`
        : data.inactiveReason === 'expired'
          ? 'It has reached the end of its run. Renew it from your dashboard.'
          : 'It is paused. Turn it back on or renew it from your dashboard.';
    return html`${header('This posting is not live', `${p.title} · ${p.location}`, board().employerName)}
<article class="pm-card">${alertBox(why, 'info')}
<div class="pm-actions pm-actions--end">${button({ action: 'open-url', label: 'Open dashboard', variant: 'primary', data: { url: data.dashboardUrl } })}</div></article>
${preview}`;
  }

  if (data.stage === 'checkout') {
    // A status check of an older checkout carries no quote; the card still works without a figure.
    const price = data.quote ? `$${data.quote.priceDollars}` : '';
    return html`${header('Ready for payment', `${p.title} · ${p.location}`, board().employerName)}
<article class="pm-card">
  ${when(data.quote, () => html`<div class="pm-price"><strong>${price}</strong><span>${data.quote!.durationDays} days</span></div>`)}
  <p class="pm-sub" style="margin-top:6px">Payment happens on Stripe's secure checkout in your browser. The posting goes live as soon as it completes.</p>
  <div class="pm-actions" style="margin-top:12px">
    ${data.checkoutUrl ? button({ action: 'pay', label: price ? `Pay ${price} on Stripe` : 'Pay on Stripe', variant: 'primary', data: { url: data.checkoutUrl } }) : ''}
    ${button({ action: 'refresh-posting', label: 'Check status', busy: ui.busy === 'refresh-posting', data: { id: data.jobId ?? '' } })}
  </div>
  ${when(ui.watchingPayment, () => html`<p class="pm-pulse" style="margin-top:12px">Waiting for Stripe to confirm the payment</p>`)}
</article>
${preview}`;
  }

  const blocked = data.errors.length > 0 || !data.previewId;
  const quote = data.quote;
  const priceLine = quote
    ? quote.fundedByCredit
      ? `Covered by one of your ${plural(quote.creditsAvailable, 'posting credit', 'posting credits')}.`
      : `$${quote.priceDollars} for ${quote.durationDays} days${quote.priceKind === 'first' ? ', first post price' : ''}.`
    : '';
  const publishLabel = quote?.fundedByCredit
    ? 'Publish with 1 credit'
    : data.checkoutEnabled
      ? `Continue to payment, $${quote?.priceDollars ?? ''}`
      : `Finish on ${board().name}`;
  return html`${header('Posting preview', blocked ? 'Fix the items below to publish' : 'Review it, then publish', board().employerName)}
${issues}
${preview}
<article class="pm-card" style="margin-top:8px">
  <div class="pm-pay-label" style="margin:0"><strong>${quote?.fundedByCredit ? 'Ready to publish' : 'Price'}</strong><span>${priceLine}</span></div>
  <div class="pm-actions pm-actions--end" style="margin-top:10px">
    ${data.checkoutEnabled || quote?.fundedByCredit
      ? button({ action: 'publish', label: publishLabel, variant: 'primary', disabled: blocked, busy: ui.busy === 'publish' })
      : button({ action: 'open-url', label: publishLabel, variant: 'primary', data: { url: data.dashboardUrl } })}
  </div>
  <p class="pm-note">Publishing makes the posting public on ${board().name} for its full run. ${
    quote?.fundedByCredit ? 'One credit is used.' : data.checkoutEnabled ? 'You pay on Stripe before anything goes live.' : ''
  }</p>
</article>`;
}

// ─── Postings dashboard ──────────────────────────────────────────────────

function postingRow(row: PostingRow, ui: EmployerUiState): SafeHtml {
  return html`<article class="pm-card">
  <div class="pm-pay-label" style="margin:0"><h3 class="pm-title">${row.title}</h3>${statusPill(row.status, POSTING_STATUS_LABELS[row.status])}</div>
  <p class="pm-sub">${row.location} · Posted ${shortDate(row.createdAt, ui.now)}${row.expiresAt ? ` · Ends ${shortDate(row.expiresAt, ui.now)}` : ''}</p>
  <div class="pm-stats">
    <span class="pm-stat"><strong>${row.applicants.toLocaleString('en-US')}</strong>applicants${row.newApplicants > 0 ? html` <span class="pm-chip pm-chip--accent">${row.newApplicants} new</span>` : ''}</span>
    <span class="pm-stat"><strong>${row.views.toLocaleString('en-US')}</strong>views</span>
    <span class="pm-stat"><strong>${row.applyClicks.toLocaleString('en-US')}</strong>apply clicks</span>
  </div>
  <div class="pm-actions pm-actions--end" style="margin-top:8px">
    ${link('Posting', row.url)}
    ${row.applicants > 0 ? button({ action: 'view-applicants', label: 'Applicants', variant: 'primary', busy: ui.busy === `applicants:${row.jobId}`, data: { id: row.jobId } }) : ''}
  </div>
</article>`;
}

export function renderPostings(data: PostingsViewData, ui: EmployerUiState): SafeHtml {
  const credits = data.creditsAvailable > 0 ? `${plural(data.creditsAvailable, 'posting credit', 'posting credits')} available` : null;
  if (data.postings.length === 0) {
    return html`${header('Your job postings', credits, board().employerName)}${empty(
      'No postings yet',
      'Describe the role and I will draft the posting for you to review.',
      button({ action: 'open-url', label: 'Open dashboard', data: { url: data.dashboardUrl } }),
    )}`;
  }
  const live = data.postings.filter((p) => p.status === 'live').length;
  return html`${header('Your job postings', [`${live} live`, credits].filter(Boolean).join(' · '), board().employerName, link('Dashboard', data.dashboardUrl))}
<div class="pm-list">${data.postings.map((p) => postingRow(p, ui))}</div>`;
}

// ─── Applicants ──────────────────────────────────────────────────────────

/** The next stages the widget offers from each status. The employer decides; nothing moves on its own. */
const NEXT_STAGES: Readonly<Record<string, readonly string[]>> = {
  applied: ['screening', 'interview', 'rejected'],
  screening: ['interview', 'rejected'],
  interview: ['offered', 'rejected'],
  offered: ['hired', 'rejected'],
  hired: [],
  rejected: ['screening'],
  withdrawn: [],
};

function applicantRow(row: ApplicantRow, ui: EmployerUiState): SafeHtml {
  const confirming = ui.confirmKey?.startsWith(`status:${row.applicationId}:`) ? ui.confirmKey.split(':')[2] : null;
  const stages = NEXT_STAGES[row.status] ?? [];
  return html`<article class="pm-card">
  <div class="pm-row">${avatar(row.name)}<div class="pm-grow">
    <div class="pm-pay-label" style="margin:0"><h3 class="pm-title">${row.name}</h3>${statusPill(row.status)}</div>
    <p class="pm-sub">${row.headline ?? `${board().role} candidate`.trim()}${row.yearsExperience !== null ? ` · ${row.yearsExperience} yrs` : ''} · ${row.job.title}</p>
    <div class="pm-chips">${row.licenseStates.slice(0, 6).map((s) => chip(s))}${row.certifications.slice(0, 3).map((c) => chip(c, 'info'))}${
      row.hasResume ? chip('Resume', 'success') : chip('No resume')
    }${row.hasCoverLetter ? chip('Cover letter', 'success') : ''}</div>
    ${when(row.screeningAnswers.length > 0, () =>
      html`<div class="pm-qa">${row.screeningAnswers.slice(0, 4).map((qa) => html`<div><strong>${qa.question}</strong> ${qa.answer || 'No answer'}</div>`)}</div>`,
    )}
    <div class="pm-meta"><span>Applied ${shortDate(row.appliedAt, ui.now)}</span>
      <span class="pm-actions">${!confirming ? stages.map((stage) =>
        button({
          action: 'ask-status',
          label: stage === 'rejected' ? 'Not a fit' : statusLabel(stage),
          variant: stage === 'rejected' ? 'ghost' : 'plain',
          data: { id: row.applicationId, status: stage },
        }),
      ) : ''}</span>
    </div>
    ${when(confirming, () =>
      html`<div class="pm-alert pm-alert--${confirming === 'rejected' ? 'warn' : 'info'}" style="margin:10px 0 0;justify-content:space-between;flex-wrap:wrap" role="status">
<span>Move ${row.name} to ${statusLabel(confirming!)}? They get an email about the change.</span>
<span class="pm-actions">${button({ action: 'cancel-confirm', label: 'Cancel', variant: 'ghost' })}${button({
        action: 'confirm-status',
        label: `Move to ${statusLabel(confirming!)}`,
        variant: confirming === 'rejected' ? 'danger' : 'primary',
        busy: ui.busy === `status:${row.applicationId}`,
        data: { id: row.applicationId, status: confirming },
      })}</span></div>`,
    )}
  </div></div>
</article>`;
}

export function renderApplicants(data: ApplicantsViewData, ui: EmployerUiState): SafeHtml {
  const counts: Record<string, number> = {};
  for (const a of data.applicants) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const tabs = html`<div class="pm-tabs" role="tablist">${[null, ...data.statuses].map((status) => {
    const active = (data.statusFilter ?? null) === status;
    const label = status ? statusLabel(status) : 'All';
    return html`<button type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" class="pm-tab${active ? ' is-active' : ''}" data-action="filter-applicants" data-status="${status ?? ''}" data-id="${data.jobFilter?.id ?? ''}">${label}${
      status && counts[status] ? html`<b>${counts[status]}</b>` : ''
    }</button>`;
  })}</div>`;
  const title = data.jobFilter ? `Applicants for ${data.jobFilter.title}` : 'Applicants';
  return html`${header(title, `${plural(data.applicants.length, 'applicant', 'applicants')}, newest first`, board().employerName, link('Review resumes', data.reviewUrl))}
${tabs}
${data.applicants.length === 0
    ? empty('No applicants here yet', data.statusFilter ? 'Try another stage.' : 'New applicants show up here as they apply.')
    : html`<div class="pm-list">${data.applicants.map((a) => applicantRow(a, ui))}</div>`}`;
}
