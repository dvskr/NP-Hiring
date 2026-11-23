import { html, when, type SafeHtml } from '../ui';
import { moneyK, plural, postedLabel } from '../format';
import type { JobCard, JobViewData, JobsViewData } from '../contracts';
import { board } from '../board';
import { avatar, button, chip, empty, header, icon, link } from './common';

export interface JobsUiState {
  busy: string | null;
  now: number;
}

/** How many postings and places a folded result stands for, with the first few places named. */
const PLACES_ON_CARD = 3;
function repeatPostings(job: JobCard): SafeHtml | '' {
  const repeat = job.alsoPosted;
  if (!repeat) return '';
  const named = repeat.places.slice(0, PLACES_ON_CARD);
  const more = repeat.placeCount - named.length;
  const places =
    named.length > 0
      ? ` in ${plural(repeat.placeCount, 'place', 'places')}: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
      : '';
  return html`<p class="pm-also">${plural(repeat.postings, 'posting', 'postings')}${places}</p>`;
}

function cardChips(job: JobCard): SafeHtml {
  // A remote job already says "Remote" in its location line.
  const workMode = job.workMode === 'Remote' && job.location === 'Remote' ? null : job.workMode;
  // The site's order: pay, schedule, work mode, experience.
  return html`<div class="pm-chips">${chip(job.pay, 'pay')}${chip(job.jobType)}${chip(workMode)}${chip(
    job.experience,
    job.experience === 'New grads welcome' ? 'success' : 'plain',
  )}</div>`;
}

export function jobCard(job: JobCard, saved: boolean, signedIn: boolean, ui: JobsUiState): SafeHtml {
  const posted = postedLabel(job.postedAt, ui.now);
  // The title is the keyboard and screen reader target; a click anywhere else
  // on the card opens it too (data-card-open), without nesting buttons inside
  // a button.
  // pm-job and pm-meta--job are what the stylesheet lays a job card out by on
  // a phone: the pills and this last row run the card's full width there.
  return html`<article class="pm-card is-clickable${job.easyApply ? ' is-easy' : ''} pm-job" data-card-open="${job.id}">
  <div class="pm-row">
    ${avatar(job.employer, job.verifiedEmployer)}
    <div class="pm-grow">
      <h3 class="pm-title"><button type="button" class="pm-title-link" data-action="open-job" data-id="${job.id}">${job.title}</button></h3>
      <p class="pm-sub">${job.employer}<span class="pm-dot" aria-hidden="true">·</span><span class="pm-loc">${icon('pin', 12)}${job.location}</span></p>
      ${repeatPostings(job)}
      ${cardChips(job)}
      <div class="pm-meta pm-meta--job">
        <span>${posted ?? ''}</span>
        <span class="pm-actions">
          ${button({
            action: 'save',
            label: saved ? 'Saved' : 'Save',
            icon: saved ? 'bookmarked' : 'bookmark',
            pressed: saved,
            busy: ui.busy === `save:${job.id}`,
            data: { id: job.id, saved: saved ? 'false' : 'true' },
            ariaLabel: saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`,
          })}
          ${job.easyApply
            ? button({ action: 'apply', label: 'Easy Apply', variant: 'primary', icon: 'zap', busy: ui.busy === `apply:${job.id}`, data: { id: job.id } })
            : button({ action: 'open-url', label: 'View job', data: { url: job.url } })}
        </span>
      </div>
    </div>
  </div>
</article>`;
}

export function renderJobs(data: JobsViewData, ui: JobsUiState): SafeHtml {
  const saved = new Set(data.savedJobIds);
  // Open postings, the number the website shows; a folded result stands for several of them.
  const openJobs = data.postings ?? data.total;
  const subtitle =
    openJobs > 0
      ? data.postingsCapped
        ? `${openJobs.toLocaleString('en-US')} or more open jobs on ${board().name}`
        : `${plural(openJobs, 'open job', 'open jobs')} on ${board().name}`
      : null;
  if (data.jobs.length === 0) {
    return html`${header(data.summary, null, board().name)}${empty(
      'No open jobs match yet',
      'Try fewer filters, a nearby state, or remote roles.',
      button({ action: 'open-url', label: 'Browse all jobs', data: { url: data.browseUrl } }),
    )}`;
  }
  return html`${header(data.summary, subtitle, board().name)}
<div class="pm-list">${data.jobs.map((job) => jobCard(job, saved.has(job.id), data.signedIn, ui))}</div>
${when(data.hasMore, () =>
    html`<div class="pm-more">${button({ action: 'more', label: 'Show more jobs', busy: ui.busy === 'more' })}</div>`,
  )}
<div class="pm-footer"><span>${plural(data.jobs.length, 'job', 'jobs')} shown</span>${link(`See all on ${board().name}`, data.browseUrl)}</div>`;
}

/** Roughly what fits in the clipped description box before it scrolls. */
const LONG_DESCRIPTION = 700;

export interface JobUiState {
  busy: string | null;
  now: number;
  descriptionOpen: boolean;
  canGoBack: boolean;
}

function fact(label: string, value: string | null | undefined): SafeHtml | '' {
  if (!value) return '';
  return html`<div class="pm-fact"><span>${label}</span><strong>${value}</strong></div>`;
}

export function renderJob(data: JobViewData, ui: JobUiState): SafeHtml {
  const job = data.job;
  const posted = postedLabel(job.postedAt, ui.now);
  const schedules = [job.jobType, ...job.schedules.filter((s) => s !== job.jobType)].filter(Boolean).join(', ');
  const payContext =
    job.stateMedianK > 0
      ? `${job.stateName ?? 'State'} median ${moneyK(job.stateMedianK * 1000)}`
      : job.nationalMedianK > 0
        ? `US median ${moneyK(job.nationalMedianK * 1000)}`
        : null;
  return html`${when(ui.canGoBack, () => html`<div class="pm-back">${button({ action: 'back', label: 'Back to results', variant: 'ghost' })}</div>`)}
<article class="pm-card">
  <div class="pm-detail-head">
    ${avatar(job.employer, job.verifiedEmployer)}
    <div class="pm-grow">
      <h2 class="pm-detail-title">${job.title}</h2>
      <p class="pm-sub">${job.employer}<span class="pm-dot" aria-hidden="true">·</span><span class="pm-loc">${icon('pin', 12)}${job.location}</span>${
        posted ? html`<span class="pm-dot" aria-hidden="true">·</span>${posted}` : ''
      }</p>
      <div class="pm-chips">${job.easyApply ? chip('Apply from here', 'accent') : chip('Applies on employer site')}${
        job.practiceAuthority?.tone === 'open' ? chip(job.practiceAuthority.label, 'success') : ''
      }</div>
    </div>
  </div>
  <div class="pm-facts">
    ${fact('Pay', job.pay ?? 'Not published')}
    ${fact('Typical in area', payContext)}
    ${fact('Work mode', job.workMode)}
    ${fact('Schedule', schedules)}
    ${fact('Experience', job.experience)}
    ${fact('Setting', job.setting)}
    ${fact('Population', job.population)}
    ${fact('Licensed states', job.eligibleStates.length > 0 ? job.eligibleStates.join(', ') : null)}
  </div>
  ${when(job.payNote, () => html`<p class="pm-note" style="margin-top:0">The pay shown is ${job.payNote}.</p>`)}
  ${when(job.practiceAuthority, () => html`<p class="pm-note" style="margin-top:0">${job.practiceAuthority!.state}: ${job.practiceAuthority!.label}.</p>`)}
  ${when(job.summary, () => html`<div class="pm-section"><h3>Summary</h3><div class="pm-prose is-open">${job.summary}</div></div>`)}
  ${when(job.benefits.length > 0, () => html`<div class="pm-section"><h3>Benefits</h3><div class="pm-chips">${job.benefits.map((b) => chip(b))}</div></div>`)}
  <div class="pm-section">
    <h3>Description</h3>
    <div class="pm-prose${ui.descriptionOpen ? ' is-open' : ''}" id="pm-desc">${job.description}</div>
    <div class="pm-actions" style="margin-top:6px">${
      // Only a description long enough to be clipped gets the toggle.
      job.description.length > LONG_DESCRIPTION
        ? button({ action: 'toggle-description', label: ui.descriptionOpen ? 'Show less' : 'Read full description', variant: 'ghost' })
        : ''
    }${job.descriptionTruncated ? link(`Full posting on ${board().name}`, job.url) : ''}</div>
  </div>
  <hr class="pm-divider">
  <div class="pm-actions pm-actions--end">
    ${button({
      action: 'save',
      label: data.saved ? 'Saved' : 'Save job',
      icon: data.saved ? 'bookmarked' : 'bookmark',
      pressed: data.saved,
      busy: ui.busy === `save:${job.id}`,
      data: { id: job.id, saved: data.saved ? 'false' : 'true' },
    })}
    ${button({ action: 'open-url', label: 'Open job page', data: { url: job.url } })}
    ${job.easyApply
      ? button({ action: 'apply', label: 'Easy Apply', variant: 'primary', icon: 'zap', busy: ui.busy === `apply:${job.id}`, data: { id: job.id } })
      : ''}
  </div>
  ${when(job.easyApply && job.screeningQuestionCount > 0, () =>
    html`<p class="pm-note">${plural(job.screeningQuestionCount, 'screening question', 'screening questions')} from the employer.</p>`,
  )}
</article>`;
}
