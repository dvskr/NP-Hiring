import { html, raw, when, type SafeHtml } from '../ui';
import { statusLabel } from '../format';
import type { ApplyViewData, ScreeningQuestion, SubmittedApplicationData } from '../contracts';
import { board } from '../board';
import { alertBox, avatar, button, chip, link } from './common';

export interface ApplyUiState {
  coverLetter: string;
  answers: Record<string, string>;
  consent: boolean;
  /** Field id to message, shown under the field. */
  errors: Record<string, string>;
  busy: string | null;
  formError: string | null;
}

function questionField(q: ScreeningQuestion, ui: ApplyUiState): SafeHtml {
  const value = ui.answers[q.id] ?? '';
  const error = ui.errors[q.id];
  const label = html`${q.text}${q.required ? raw(' <span aria-hidden="true">*</span>') : ''}`;
  const describedBy = error ? `pm-err-${q.id}` : '';
  // data-error-for lets the controller take the message away once the answer is given.
  const errorLine = error ? html`<div class="pm-error" id="${describedBy}" data-error-for="${q.id}">${error}</div>` : '';

  if (q.type === 'boolean' || (q.type === 'select' && q.options.length > 0 && q.options.length <= 4)) {
    const options = q.type === 'boolean' ? ['Yes', 'No'] : q.options;
    return html`<div class="pm-field"><fieldset><legend>${label}</legend><div class="pm-options">${options.map(
      (option) =>
        html`<label class="pm-option"><input type="radio" name="q-${q.id}" value="${option}" data-field="answer" data-question="${q.id}"${
          value === option ? raw(' checked') : ''
        }${q.required ? raw(' required') : ''}>${option}</label>`,
    )}</div></fieldset>${errorLine}</div>`;
  }
  // A choice with nothing to choose falls through to a text box, as on the website.
  if (q.type === 'select' && q.options.length > 0) {
    return html`<div class="pm-field"><label for="q-${q.id}">${label}</label><select class="pm-select" id="q-${q.id}" data-field="answer" data-question="${q.id}"><option value="">Choose one</option>${q.options.map(
      (option) => html`<option value="${option}"${value === option ? raw(' selected') : ''}>${option}</option>`,
    )}</select>${errorLine}</div>`;
  }
  return html`<div class="pm-field"><label for="q-${q.id}">${label}</label><input class="pm-input" id="q-${q.id}" type="${
    q.type === 'number' ? 'number' : 'text'
  }" maxlength="1000" value="${value}" data-field="answer" data-question="${q.id}"${
    describedBy ? html` aria-describedby="${describedBy}"` : ''
  }>${errorLine}</div>`;
}

function shareBlock(data: ApplyViewData): SafeHtml {
  const p = data.profile;
  const item = (label: string, value: string | null | undefined) =>
    value ? html`<div><span>${label}</span>${value}</div>` : '';
  return html`<div class="pm-panel">
  <div class="pm-pay-label" style="margin-bottom:8px"><strong>What ${data.job.employer} will receive</strong>${link('Edit profile', data.profileUrl)}</div>
  <div class="pm-share">
    ${item('Name', p.name)}
    ${item('Email', p.email)}
    ${item('Headline', p.headline)}
    ${item('Experience', p.yearsExperience !== null ? `${p.yearsExperience} years` : null)}
    ${item('Licensed in', p.licenseStates)}
    ${item('Certifications', p.certifications)}
    ${item('Resume', p.hasResume ? 'On file' : 'None on file')}
  </div>
</div>`;
}

export function renderApply(data: ApplyViewData, ui: ApplyUiState): SafeHtml {
  const job = data.job;
  const top = html`<div class="pm-detail-head" style="margin-bottom:12px">${avatar(job.employer)}<div class="pm-grow"><p class="pm-kicker">Application review</p><h2 class="pm-detail-title">${job.title}</h2><p class="pm-sub">${job.employer} · ${job.location}</p><div class="pm-chips">${chip(job.pay, 'pay')}${chip(job.workMode)}${chip(job.jobType)}</div></div></div>`;

  if (data.channel === 'website') {
    // A job that takes applications here, held up only by a missing resume:
    // the way forward is the profile, not the job page.
    const needsResume = job.easyApply && !data.profile.hasResume;
    return html`<article class="pm-card">${top}${alertBox(data.websiteReason ?? `Finish this application on ${board().name}.`, 'info')}
<div class="pm-actions pm-actions--end">${
      needsResume
        ? button({ action: 'open-url', label: 'Upload a resume', variant: 'primary', data: { url: data.resumeUrl } })
        : button({ action: 'open-url', label: 'Open the job page', variant: 'primary', data: { url: job.url } })
    }</div></article>`;
  }

  const length = ui.coverLetter.length;
  const submitting = ui.busy === 'submit';
  const test = data.testAccount === true;
  return html`<article class="pm-card">
${top}
${when(test, () => alertBox(`This is a test account. Submitting checks this application the way any other is checked, and then nothing is stored and ${job.employer} receives nothing.`, 'warn'))}
${when(data.existingStatus, () => alertBox(`You already applied to this job. Its status is ${statusLabel(data.existingStatus!)}. Submitting again updates your cover letter and answers.`, 'info'))}
${data.warnings.map((w) => alertBox(w, 'warn'))}
${shareBlock(data)}
<form class="pm-form" style="margin-top:14px" data-form="apply" novalidate>
  <div class="pm-field">
    <label for="pm-cover">Cover letter <span style="font-weight:400;color:var(--pm-faint)">(optional)</span></label>
    <textarea class="pm-textarea" id="pm-cover" maxlength="${data.coverLetterMax}" data-field="cover" placeholder="A few lines on why this role fits you.">${ui.coverLetter}</textarea>
    <div class="pm-count">${length.toLocaleString('en-US')} / ${data.coverLetterMax.toLocaleString('en-US')}</div>
  </div>
  ${when(data.questions.length > 0, () => html`<div class="pm-section" style="margin-top:0"><h3>Questions from ${job.employer}</h3><div class="pm-form">${data.questions.map((q) => questionField(q, ui))}</div></div>`)}
  <label class="pm-check">
    <input type="checkbox" data-field="consent"${ui.consent ? raw(' checked') : ''}>
    <span>I agree to share my profile, resume and answers with ${job.employer} for this job.</span>
  </label>
  ${when(ui.errors.consent, () => html`<div class="pm-error" data-error-for="consent">${ui.errors.consent}</div>`)}
  ${when(ui.formError, () => html`<div data-form-error>${alertBox(ui.formError!, 'danger')}</div>`)}
  ${button({
    action: 'submit-application',
    label: test ? (submitting ? 'Checking the application' : 'Check the application') : submitting ? 'Sending your application' : 'Submit application',
    variant: 'primary',
    block: true,
    busy: submitting,
  })}
  <p class="pm-note" style="text-align:center;margin-top:0">${test ? 'A test account sends nothing.' : 'Nothing is sent until you press Submit.'}</p>
</form>
</article>`;
}

export function renderSubmitted(data: SubmittedApplicationData): SafeHtml {
  const job = data.job;
  if (data.test) {
    // No tick and no "sent": a test account's application reached nobody.
    return html`<article class="pm-card"><div class="pm-success">
<div class="pm-success-icon" style="background:var(--pm-surface);color:var(--pm-muted)" aria-hidden="true">i</div>
<h2>Test only: nothing was sent</h2>
<p>This is a test account. The application for ${job.title} passed every check a real one goes through, and ${job.employer} received nothing.</p>
<div class="pm-actions" style="justify-content:center">${button({ action: 'open-url', label: 'Job page', data: { url: job.url } })}</div>
</div></article>`;
  }
  if (data.autoRejected) {
    return html`<article class="pm-card"><div class="pm-success">
<div class="pm-success-icon" style="background:var(--pm-surface);color:var(--pm-muted)" aria-hidden="true">i</div>
<h2>Application received</h2>
<p>Your answers to the screening questions for ${job.title} did not meet ${job.employer}'s stated requirements, so this application will not move forward. Your profile is unchanged and you can apply to other roles right away.</p>
<div class="pm-actions" style="justify-content:center">${button({ action: 'open-url', label: 'My applications', data: { url: data.trackUrl } })}</div>
</div></article>`;
  }
  return html`<article class="pm-card"><div class="pm-success">
<div class="pm-success-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
<h2>Application sent</h2>
<p>Your application for ${job.title} is now with ${job.employer}.</p>
<div class="pm-actions" style="justify-content:center">${button({ action: 'open-url', label: 'Track it', variant: 'primary', data: { url: data.trackUrl } })}${button({ action: 'open-url', label: 'Job page', data: { url: job.url } })}</div>
</div></article>`;
}
