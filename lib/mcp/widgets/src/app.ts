import { board } from './board';
import { connectBridge, type Bridge, type HostContext, type ToolResult } from './bridge';
import { html, isOpenableUrl, raw, type SafeHtml } from './ui';
import type {
  ApplicantsViewData,
  ApplicationsViewData,
  ApplyViewData,
  JobViewData,
  JobsViewData,
  PostingViewData,
  WidgetData,
} from './contracts';
import { alertBox } from './views/common';
import { renderJob, renderJobs } from './views/jobs';
import { renderApply, renderSubmitted, type ApplyUiState } from './views/apply';
import { renderApplications } from './views/applications';
import { renderPay } from './views/pay';
import { renderFacts, renderList } from './views/facts';
import { renderApplicants, renderPosting, renderPostings } from './views/employer';

/**
 * The widget controller. One bundle serves every view: the view is chosen by
 * the `view` field of the tool result, so a card can move from results to a
 * job's details and back without another message in the conversation.
 *
 * Rendering is a full innerHTML swap from pure view functions. Typing is the
 * exception: input events update state without re-rendering, so a textarea
 * keeps its cursor and the person's text is never clobbered.
 */

interface State {
  data: WidgetData | null;
  stack: WidgetData[];
  busy: string | null;
  confirmKey: string | null;
  toast: string | null;
  error: string | null;
  descriptionOpen: boolean;
  apply: ApplyUiState;
  watchingPayment: boolean;
}

const PAYMENT_POLL_MS = 5000;
const PAYMENT_WATCH_MS = 15 * 60 * 1000;
/** Status reads in a row that may fail before the watch gives up and says so, once. */
const MAX_POLL_FAILURES = 3;
/** The apply form's summary when a required answer or the consent tick is missing. */
const NEEDS_ATTENTION = 'A few things need your attention above.';
const TOAST_MS = 5000;

const blankApply = (coverLetter = ''): ApplyUiState => ({
  coverLetter,
  answers: {},
  consent: false,
  errors: {},
  busy: null,
  formError: null,
});

export function startWidget(root: HTMLElement): void {
  const state: State = {
    data: null,
    stack: [],
    busy: null,
    confirmKey: null,
    toast: null,
    error: null,
    descriptionOpen: false,
    apply: blankApply(),
    watchingPayment: false,
  };
  let bridge: Bridge | null = null;
  let toastTimer: number | null = null;
  let pollTimer: number | null = null;
  /** Bumped by every start and stop, so a status read that returns late can tell it belongs to an old watch. */
  let watchGeneration = 0;

  // ─── Rendering ──────────────────────────────────────────────────────

  const skeleton = (): SafeHtml =>
    raw('<div class="pm-skel" aria-hidden="true"><div></div><div></div></div>');

  function viewHtml(): SafeHtml {
    const data = state.data;
    const now = Date.now();
    if (!data) {
      if (state.error) return alertBox(state.error, 'danger');
      return skeleton();
    }
    switch (data.view) {
      case 'jobs':
        return renderJobs(data, { busy: state.busy, now });
      case 'job':
        return renderJob(data, { busy: state.busy, now, descriptionOpen: state.descriptionOpen, canGoBack: state.stack.length > 0 });
      case 'apply':
        // Opened from a job card, the review can go back to the results it came from.
        return html`${state.stack.length > 0 && !('submitted' in data) ? raw('<div class="pm-back"><button type="button" class="pm-btn pm-btn--ghost" data-action="back">Back</button></div>') : ''}${
          'submitted' in data ? renderSubmitted(data) : renderApply(data, state.apply)
        }`;
      case 'applications':
        return renderApplications(data, { busy: state.busy, confirmKey: state.confirmKey, now });
      case 'pay':
        return renderPay(data);
      case 'facts':
        return renderFacts(data);
      case 'list':
        return renderList(data);
      case 'posting':
        return renderPosting(data, { busy: state.busy, confirmKey: state.confirmKey, now, watchingPayment: state.watchingPayment });
      case 'postings':
        return renderPostings(data, { busy: state.busy, confirmKey: state.confirmKey, now, watchingPayment: false });
      case 'applicants':
        return html`${state.stack.length > 0 ? raw('<div class="pm-back"><button type="button" class="pm-btn pm-btn--ghost" data-action="back">Back to postings</button></div>') : ''}${renderApplicants(data, {
          busy: state.busy,
          confirmKey: state.confirmKey,
          now,
          watchingPayment: false,
        })}`;
      default:
        return alertBox('This card could not be shown. Ask again in the conversation.', 'warn');
    }
  }

  function render(): void {
    const body = viewHtml();
    const toast = state.toast ? html`<div class="pm-toast" role="status">${state.toast}</div>` : '';
    root.innerHTML = html`${body}${toast}`.__safe;
  }

  function toast(message: string): void {
    state.toast = message;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      state.toast = null;
      render();
    }, TOAST_MS);
    render();
  }

  function setData(data: WidgetData, opts: { push?: boolean } = {}): void {
    // A new card state is never the checkout the watch was waiting on; Pay starts a fresh one.
    stopPaymentWatch();
    if (opts.push && state.data) state.stack.push(state.data);
    if (!opts.push) state.stack = [];
    state.data = data;
    state.error = null;
    state.confirmKey = null;
    state.descriptionOpen = false;
    if (data.view === 'apply' && !('submitted' in data)) state.apply = blankApply((data as ApplyViewData).coverLetterDraft);
    render();
  }

  // ─── Host results ───────────────────────────────────────────────────

  function textOf(result: ToolResult): string {
    return (result.content ?? []).map((c) => c.text ?? '').filter(Boolean).join(' ').trim();
  }

  function needsSignIn(result: ToolResult): boolean {
    return !!result._meta && 'mcp/www_authenticate' in result._meta;
  }

  function widgetData(result: ToolResult): WidgetData | null {
    const s = result.structuredContent;
    return s && typeof s === 'object' && typeof (s as { view?: unknown }).view === 'string' ? (s as unknown as WidgetData) : null;
  }

  function onToolResult(result: ToolResult): void {
    const data = widgetData(result);
    if (data && !result.isError) {
      setData(data);
      return;
    }
    if (!state.data) {
      state.error = textOf(result) || 'Something went wrong. Ask again in the conversation.';
      render();
    }
  }

  /** Calls a tool from the card. Resolves to the result, or null after telling the person what went wrong. */
  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult | null> {
    if (!bridge) return null;
    try {
      const result = await bridge.callTool(name, args);
      if (result.isError) {
        toast(needsSignIn(result) ? `Sign in to ${board().name} to do that. Your assistant will show a sign in button.` : textOf(result) || 'That did not work. Try again.');
        return null;
      }
      return result;
    } catch {
      toast(`${board().name} did not answer. If you are signed out, ask your assistant to connect your account.`);
      return null;
    }
  }

  async function withBusy<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
    if (state.busy) return undefined;
    state.busy = key;
    render();
    try {
      return await task();
    } finally {
      state.busy = null;
      render();
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────

  async function openJob(id: string): Promise<void> {
    await withBusy(`open:${id}`, async () => {
      const result = await call('get_job', { job_id: id });
      const data = result && widgetData(result);
      if (data && data.view === 'job') {
        setData(data, { push: true });
        // Ids and fixed words only: a job title is employer-written text, and
        // nothing from a listing may reach the conversation as if we said it.
        const job = (data as JobViewData).job;
        void bridge?.updateModelContext(`The person opened ${board().name} job ${job.id} in the card.`).catch(() => undefined);
      }
    });
  }

  async function loadMore(): Promise<void> {
    const current = state.data as JobsViewData;
    await withBusy('more', async () => {
      const result = await call('search_jobs', { ...current.searchArgs, page: current.page + 1 });
      const next = result && widgetData(result);
      if (next && next.view === 'jobs' && state.data === current) {
        state.data = {
          ...current,
          jobs: [...current.jobs, ...next.jobs.filter((j) => !current.jobs.some((c) => c.id === j.id))],
          page: next.page,
          hasMore: next.hasMore,
          total: next.total,
          postings: next.postings,
          postingsCapped: next.postingsCapped,
          savedJobIds: Array.from(new Set([...current.savedJobIds, ...next.savedJobIds])),
          searchArgs: next.searchArgs,
        };
      }
    });
  }

  async function toggleSave(id: string, saved: boolean): Promise<void> {
    await withBusy(`save:${id}`, async () => {
      // Two tools since 2026-11-22: save_job only adds, unsave_job removes.
      const result = saved ? await call('save_job', { job_id: id }) : await call('unsave_job', { job_id: id });
      if (!result || !state.data) return;
      if (state.data.view === 'jobs') {
        const ids = new Set(state.data.savedJobIds);
        if (saved) ids.add(id);
        else ids.delete(id);
        state.data = { ...state.data, savedJobIds: Array.from(ids), signedIn: true };
      } else if (state.data.view === 'job') {
        state.data = { ...state.data, saved, signedIn: true };
      }
      state.stack = state.stack.map((d) =>
        d.view === 'jobs'
          ? { ...d, savedJobIds: saved ? Array.from(new Set([...d.savedJobIds, id])) : d.savedJobIds.filter((x) => x !== id) }
          : d,
      );
    });
  }

  async function startApplication(el: HTMLElement): Promise<void> {
    const { id } = el.dataset;
    if (!id || !bridge) return;
    const host = bridge;
    await withBusy(`apply:${id}`, async () => {
      // With the account connected, open the review card right here: one
      // press, nothing for the person to send. Anything else (signed out, a
      // host that will not run this tool from a card, a job that just
      // closed) goes to the assistant instead, which is where the host shows
      // its sign-in button and where an error can be explained. Hosts do not
      // agree on how a card is told that sign-in is needed, so the card does
      // not try to tell the cases apart.
      let result: ToolResult | null = null;
      try {
        result = await host.callTool('prepare_application', { job_id: id });
      } catch {
        result = null;
      }
      const data = result && !result.isError ? widgetData(result) : null;
      if (data) {
        setData(data, { push: true });
        // Ids and fixed words only, as everywhere a card speaks to the model.
        void host.updateModelContext(`The person opened the application review for ${board().name} job ${id} in the card.`).catch(() => undefined);
        return;
      }
      // The host posts this as the person's own message, so it carries the id
      // and nothing else: a title written to look like an instruction would
      // otherwise arrive with the person's authority.
      try {
        await host.sendMessage(`Help me apply to the ${board().name} job with id ${id}. Prepare the application so I can review it.`);
      } catch {
        toast('Ask your assistant to help you apply to this job.');
      }
    });
  }

  function validateApplication(data: ApplyViewData): boolean {
    const errors: Record<string, string> = {};
    for (const q of data.questions) {
      if (q.required && !(state.apply.answers[q.id] ?? '').trim()) errors[q.id] = 'Please answer this question.';
    }
    if (!state.apply.consent) errors.consent = 'Tick the box to agree before submitting.';
    state.apply.errors = errors;
    state.apply.formError = Object.keys(errors).length > 0 ? NEEDS_ATTENTION : null;
    return Object.keys(errors).length === 0;
  }

  /**
   * Takes one field's error away, from state and from the card, once the
   * person has dealt with it. Done in place rather than by re-rendering,
   * which would move the cursor out of the field they are typing in.
   */
  function clearApplyError(key: string): void {
    if (!(key in state.apply.errors)) return;
    delete state.apply.errors[key];
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-error-for]'))) {
      if (node.dataset.errorFor === key) node.remove();
    }
    if (Object.keys(state.apply.errors).length === 0 && state.apply.formError === NEEDS_ATTENTION) {
      state.apply.formError = null;
      root.querySelector('[data-form-error]')?.remove();
    }
  }

  async function submitApplication(): Promise<void> {
    const data = state.data as ApplyViewData;
    if (!validateApplication(data)) {
      render();
      const first = root.querySelector('.pm-error');
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (!data.reviewId) {
      state.apply.formError = 'This review cannot be sent. Ask your assistant to prepare the application again.';
      render();
      return;
    }
    state.apply.busy = 'submit';
    state.apply.formError = null;
    render();
    try {
      const result = await call('submit_application', {
        review_id: data.reviewId,
        cover_letter: state.apply.coverLetter.trim() || undefined,
        screening_answers: data.questions
          .filter((q) => (state.apply.answers[q.id] ?? '').trim())
          .map((q) => ({ question_id: q.id, answer: state.apply.answers[q.id].trim() })),
        consent_to_share_profile: true,
      });
      const next = result && widgetData(result);
      if (next) {
        setData(next);
        // A test account's application reached nobody, and the assistant must
        // not be told otherwise by the card.
        const wasTest = next.view === 'apply' && 'submitted' in next && next.test === true;
        void bridge
          ?.updateModelContext(
            wasTest
              ? `The person ran a test of their application to ${board().name} job ${data.job.id} from the card. It is a test account: nothing was sent.`
              : `The person submitted their application to ${board().name} job ${data.job.id} from the card.`,
          )
          .catch(() => undefined);
        return;
      }
      state.apply.formError = 'Your application was not sent. Check the message above and try again.';
    } finally {
      state.apply.busy = null;
      render();
    }
  }

  async function confirmWithdraw(id: string): Promise<void> {
    await withBusy(`withdraw:${id}`, async () => {
      const result = await call('withdraw_application', { application_id: id, confirm: true });
      const data = result && widgetData(result);
      if (data && data.view === 'applications') {
        setData(data as ApplicationsViewData);
        toast('Application withdrawn.');
      }
    });
    // After a failure too: the confirm box closes now, not when a toast happens to re-render.
    state.confirmKey = null;
    render();
  }

  function stopPaymentWatch(): void {
    watchGeneration++;
    state.watchingPayment = false;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  /**
   * One status read, without a toast: the watch decides when a failure is
   * worth telling the person about. Swaps to the live card when it is live.
   */
  async function readPosting(jobId: string): Promise<'live' | 'waiting' | 'failed'> {
    if (!bridge) return 'failed';
    try {
      const result = await bridge.callTool('get_posting_status', { job_id: jobId });
      if (result.isError) return 'failed';
      const data = widgetData(result);
      if (data && data.view === 'posting' && (data as PostingViewData).stage === 'published') {
        setData(data);
        void bridge.updateModelContext(`The employer paid, and ${board().name} posting ${jobId} is now live.`).catch(() => undefined);
        return 'live';
      }
      return 'waiting';
    } catch {
      return 'failed';
    }
  }

  function watchPayment(jobId: string): void {
    stopPaymentWatch();
    const generation = watchGeneration;
    state.watchingPayment = true;
    render();
    const until = Date.now() + PAYMENT_WATCH_MS;
    let failures = 0;
    const tick = async () => {
      if (generation !== watchGeneration) return;
      if (Date.now() > until) {
        stopPaymentWatch();
        render();
        return;
      }
      const outcome = await readPosting(jobId);
      // Stopped or restarted while that read was out: this chain is done.
      if (generation !== watchGeneration || outcome === 'live') return;
      failures = outcome === 'failed' ? failures + 1 : 0;
      if (failures >= MAX_POLL_FAILURES) {
        stopPaymentWatch();
        toast('Could not check the payment just now. Press Check status once you have paid.');
        return;
      }
      pollTimer = window.setTimeout(tick, PAYMENT_POLL_MS);
    };
    pollTimer = window.setTimeout(tick, PAYMENT_POLL_MS);
  }

  async function publishPosting(): Promise<void> {
    const data = state.data as PostingViewData;
    if (!data.previewId) return;
    await withBusy('publish', async () => {
      const result = await call('publish_job_posting', {
        preview_id: data.previewId,
        confirm_price_dollars: data.quote?.fundedByCredit ? 0 : data.quote?.priceDollars ?? 0,
      });
      const next = result && widgetData(result);
      if (next) setData(next);
    });
  }

  async function openApplicants(jobId: string | undefined, status: string | undefined, push: boolean): Promise<void> {
    await withBusy(jobId ? `applicants:${jobId}` : 'applicants', async () => {
      const result = await call('list_applicants', {
        ...(jobId ? { job_id: jobId } : {}),
        ...(status ? { status } : {}),
      });
      const data = result && widgetData(result);
      if (data && data.view === 'applicants') {
        if (push) setData(data, { push: true });
        else {
          state.data = data;
          state.confirmKey = null;
        }
      }
    });
  }

  async function confirmStatus(id: string, status: string): Promise<void> {
    await withBusy(`status:${id}`, async () => {
      const result = await call('update_applicant_status', { application_id: id, status, confirm: true });
      if (result && state.data?.view === 'applicants') {
        const current = state.data as ApplicantsViewData;
        state.data = {
          ...current,
          applicants: current.applicants.map((a) => (a.applicationId === id ? { ...a, status } : a)),
        };
        // Only a real change emails the candidate; the tool says which it was.
        const changed = (result.structuredContent as { changed?: unknown } | null | undefined)?.changed !== false;
        toast(changed ? 'Status updated. The candidate is being emailed.' : 'Already in that stage. No email was sent.');
      }
    });
    state.confirmKey = null;
    render();
  }

  /** Opens a link through the host. False when it was refused or failed. */
  async function openUrl(url: string | undefined): Promise<boolean> {
    if (!isOpenableUrl(url) || !bridge) return false;
    try {
      await bridge.openLink(url);
      return true;
    } catch {
      toast('The link could not be opened from here.');
      return false;
    }
  }

  async function dispatch(action: string, el: HTMLElement): Promise<void> {
    const d = el.dataset;
    switch (action) {
      case 'open-job':
        return d.id || d.cardOpen ? openJob((d.id ?? d.cardOpen)!) : undefined;
      case 'back': {
        const previous = state.stack.pop();
        if (previous) {
          state.data = previous;
          state.confirmKey = null;
          render();
        }
        return;
      }
      case 'more':
        return state.data?.view === 'jobs' ? loadMore() : undefined;
      case 'save':
        return d.id ? toggleSave(d.id, d.saved === 'true') : undefined;
      case 'apply':
        return startApplication(el);
      case 'open-url':
        await openUrl(d.url);
        return;
      case 'toggle-description':
        state.descriptionOpen = !state.descriptionOpen;
        render();
        return;
      case 'submit-application':
        return state.data?.view === 'apply' && !('submitted' in state.data) ? submitApplication() : undefined;
      case 'withdraw':
        state.confirmKey = `withdraw:${d.id}`;
        render();
        return;
      case 'confirm-withdraw':
        return d.id ? confirmWithdraw(d.id) : undefined;
      case 'cancel-confirm':
        state.confirmKey = null;
        render();
        return;
      case 'publish':
        return state.data?.view === 'posting' ? publishPosting() : undefined;
      case 'pay': {
        const data = state.data as PostingViewData;
        // Watch only a checkout that actually opened.
        if ((await openUrl(d.url)) && data?.jobId) watchPayment(data.jobId);
        return;
      }
      case 'refresh-posting':
        if (d.id) {
          await withBusy('refresh-posting', async () => {
            const outcome = await readPosting(d.id!);
            if (outcome === 'waiting') toast('Not paid yet. It goes live as soon as Stripe confirms.');
            if (outcome === 'failed') toast('Could not check the payment just now. Try again in a moment.');
          });
        }
        return;
      case 'view-applicants':
        return openApplicants(d.id, undefined, true);
      case 'filter-applicants':
        return openApplicants(d.id || undefined, d.status || undefined, false);
      case 'ask-status':
        state.confirmKey = `status:${d.id}:${d.status}`;
        render();
        return;
      case 'confirm-status':
        return d.id && d.status ? confirmStatus(d.id, d.status) : undefined;
      default:
        return undefined;
    }
  }

  // ─── DOM wiring ─────────────────────────────────────────────────────

  root.addEventListener('click', (event) => {
    const target = event.target as Element;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl && root.contains(actionEl)) {
      event.preventDefault();
      if ((actionEl as HTMLButtonElement).disabled) return;
      void dispatch(actionEl.dataset.action!, actionEl);
      return;
    }
    // Clicking the body of a job card opens it; the title button is the
    // keyboard path to the same action.
    const card = target.closest<HTMLElement>('[data-card-open]');
    if (card && root.contains(card) && !target.closest('input, textarea, select, label')) {
      void dispatch('open-job', card);
    }
  });

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    void dispatch('submit-application', root);
  });

  const onField = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const field = el.dataset?.field;
    if (!field) return;
    if (field === 'cover') {
      state.apply.coverLetter = el.value;
      const counter = root.querySelector('.pm-count');
      const max = (state.data as ApplyViewData | null)?.coverLetterMax ?? 5000;
      if (counter) counter.textContent = `${el.value.length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`;
    } else if (field === 'answer' && el.dataset.question) {
      state.apply.answers[el.dataset.question] = el.value;
      if (el.value.trim()) clearApplyError(el.dataset.question);
    } else if (field === 'consent') {
      state.apply.consent = (el as HTMLInputElement).checked;
      if (state.apply.consent) clearApplyError('consent');
    }
  };
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);

  // Report the content height so the host sizes the frame to fit.
  let lastHeight = 0;
  let frame = 0;
  const reportSize = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (bridge && Math.abs(height - lastHeight) >= 1) {
        lastHeight = height;
        bridge.notifySize(Math.ceil(document.documentElement.scrollWidth), height);
      }
    });
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportSize).observe(document.body);

  // ─── Theme ──────────────────────────────────────────────────────────

  const applyContext = (context: HostContext) => {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = context.theme ?? (prefersDark ? 'dark' : 'light');
    const variables = context.styles?.variables;
    if (variables) {
      for (const [name, value] of Object.entries(variables)) {
        if (typeof value !== 'string' || value.length > 200) continue;
        const key = name.startsWith('--') ? name : `--${name}`;
        if (/^--[a-z0-9-]+$/i.test(key)) document.documentElement.style.setProperty(key, value);
      }
    }
  };
  applyContext({});

  render();
  void connectBridge({
    // The skeleton already covers the wait. ChatGPT may also hold back the
    // arguments of a tool that needs approval, so nothing depends on them.
    onToolInput: () => undefined,
    onToolResult,
    onContext: applyContext,
  }).then((connected) => {
    bridge = connected;
    reportSize();
  });
}
