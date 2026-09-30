'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bell, Bookmark, ExternalLink, ListChecks, LogIn, Zap } from 'lucide-react';
import useAppliedJobs from '@/lib/hooks/useAppliedJobs';
import {
  applyCtaLabel,
  continueApplicationNote,
  resolveApplyRoute,
  APPLY_CTA_LABELS,
  CONTINUE_TO_EMPLOYER_LABEL,
} from '@/lib/direct-apply';
import {
  authGateHref,
  canLinkToEmployer,
  hasApplyIntent,
  isRenderedElement,
  resolveApplyStep,
  withApplyIntent,
  withoutApplyIntent,
} from '@/lib/apply-intent';

import InPlatformApplyForm, { type PlatformApplyOutcome } from '@/components/InPlatformApplyForm';
import { trackJobApply } from '@/lib/analytics';
import { buildTrackedJobItem, type TrackedJob } from '@/components/analytics/ViewTrackers';
import {
  safeApplyHref,
  externalApplyLinkProps,
  externalApplyHint,
  isMailtoHref,
} from '@/components/jobs/safe-external-href';
import Link from 'next/link';
import { brand } from '@/config/brand';

interface ApplyButtonProps {
  jobId: string;
  applyLink: string | null;
  jobTitle: string;
  isAuthenticated?: boolean;
  applyOnPlatform?: boolean;
  /**
   * Whether the job was posted directly by an employer on this platform
   * (vs aggregated from an external source). With the apply URL it decides
   * whether the call to action can say the application continues on the
   * employer's site (lib/direct-apply.ts).
   */
  sourceType?: string | null;
  /**
   * Analytics-only job dimensions, forwarded onto the GA4 item so the apply
   * conversion carries the same employer, type, state and source the job
   * detail page already sends on view_item. Optional because the detail page
   * does not thread them through yet: absent, the item simply carries fewer
   * dimensions, which GA4 reports as "(not set)" rather than a guess.
   *
   * Salary is deliberately not among them. trackJobApply sends the item's
   * price as generate_lead's monetary `value`, so a $120,000 listing would
   * book a $120,000 conversion for one apply click. That figure feeds Google
   * Ads bidding and any ROAS report, so the apply event stays on the flat
   * per-lead value it sends today and salary stays on the impression and
   * detail-view items, where it is an item attribute rather than a value.
   */
  employer?: string | null;
  jobType?: string | null;
  stateCode?: string | null;
  sourceProvider?: string | null;
}

/**
 * Counts one apply click on the job (employer dashboards read it as
 * "clicks"). Fire and forget: the apply flow never waits on it.
 */
function postApplyClick(jobId: string): void {
  try {
    fetch(`/api/jobs/${jobId}/track-apply`, { method: 'POST' }).catch(() => { });
  } catch { }
}

function formatAppliedDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const CTA_STYLE: React.CSSProperties = {
  minHeight: '52px',
  borderRadius: '18px',
  background: '#BE185D',
  border: '1px solid rgba(255,255,255,0.3)',
  boxShadow: '6px 6px 16px rgba(190,24,93,0.30), -3px -3px 10px rgba(255,255,255,0.2), inset 2px 2px 4px rgba(255,255,255,0.25), inset -1px -1px 2px rgba(0,0,0,0.08)',
};

// Full width in the mobile sticky bar; on desktop it fills the sidebar row
// beside the "Applied" chip, so "Apply on employer site" fits on one line.
const CTA_CLASS = 'apply-btn inline-flex items-center justify-center gap-2 text-center text-white px-6 py-4 lg:py-3 font-bold transition-all text-lg w-full lg:flex-1 lg:min-w-0 touch-manipulation';

const CONTINUE_CLASS = 'apply-btn inline-flex items-center justify-center gap-2 text-center text-white px-5 py-3 font-bold transition-all text-base w-full touch-manipulation';

const PANEL_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(190,24,93,0.06)',
  border: '1px solid rgba(190,24,93,0.18)',
};

/**
 * What an account adds, for the gate. Only features the board has today:
 * /my-applications, job alerts and saved jobs.
 */
const GATE_BENEFITS = [
  { Icon: ListChecks, text: 'Track every application in one place' },
  { Icon: Bell, text: 'Get alerts when matching roles are posted' },
  { Icon: Bookmark, text: 'Save jobs to come back to later' },
] as const;

interface ApplyAuthGateProps {
  applyOnPlatform: boolean;
  onSignUp: () => void;
  onSignIn: () => void;
  onBack: () => void;
}

/**
 * The sign-up or log-in gate every signed-out Apply click opens (owner
 * decision 2026-09). It replaces the button area; the job description
 * above it stays readable without an account.
 */
export function ApplyAuthGate({ applyOnPlatform, onSignUp, onSignIn, onBack }: ApplyAuthGateProps) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-3">
        <LogIn size={18} style={{ color: '#BE185D' }} aria-hidden="true" />
        <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          Sign in to apply
        </h3>
      </div>

      <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {applyOnPlatform
          ? `Easy Apply sends your ${brand.name} profile and resume to the employer. Create a free account or sign in to apply.`
          : "Create a free account or sign in to continue to the employer's application. We will bring you straight back to this job."}
      </p>

      <ul className="space-y-2 mb-4">
        {GATE_BENEFITS.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5">
            <Icon size={14} className="flex-shrink-0" style={{ color: '#BE185D' }} aria-hidden="true" />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {text}
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onSignUp}
          className="w-full py-3 rounded-xl font-bold text-white transition-all text-sm"
          style={{
            background: '#BE185D',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '6px 6px 16px rgba(190,24,93,0.30), -3px -3px 10px rgba(255,255,255,0.2), inset 2px 2px 4px rgba(255,255,255,0.25), inset -1px -1px 2px rgba(0,0,0,0.08)',
          }}
        >
          Create Free Account
        </button>
        <button
          type="button"
          onClick={onSignIn}
          className="w-full py-3 min-h-[44px] rounded-xl font-semibold transition-all text-sm"
          style={{
            backgroundColor: '#EDF2EE',
            color: 'var(--text-primary)',
            border: '1px solid rgba(255,255,255,0.5)',
            borderRadius: '16px',
            boxShadow: '5px 5px 12px rgba(0,0,0,0.08), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.03)',
          }}
        >
          Sign In
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-xs mt-3 py-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back
      </button>
    </div>
  );
}

interface ContinueToEmployerPanelProps {
  href: string;
  note: string;
  onContinue: () => void;
  onDismiss: () => void;
}

/**
 * Shown to a signed-in candidate who arrived with an apply intent (back from
 * sign up or log in, or from a job card) on an external job. The new tab is
 * opened by their own click on this real link, never by window.open.
 */
export function ContinueToEmployerPanel({ href, note, onContinue, onDismiss }: ContinueToEmployerPanelProps) {
  return (
    <div className="w-full rounded-2xl p-4" style={PANEL_STYLE}>
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Continue your application
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
        {note}
      </p>
      <a
        href={href}
        {...externalApplyLinkProps(href)}
        onClick={onContinue}
        className={CONTINUE_CLASS}
        style={{ ...CTA_STYLE, minHeight: '48px', borderRadius: '14px' }}
      >
        {CONTINUE_TO_EMPLOYER_LABEL}
        <ExternalLink size={18} aria-hidden="true" />
        <span className="sr-only">{externalApplyHint(href)}</span>
      </a>
      <button
        type="button"
        onClick={onDismiss}
        className="w-full text-center text-xs mt-3 py-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Not now
      </button>
    </div>
  );
}

interface ApplyButtonPlaceholderProps {
  /** The job page's own path, e.g. /jobs/nurse-practitioner-austin-tx-123. */
  jobPath: string;
  applyLink: string | null;
  applyOnPlatform: boolean;
  sourceType: string | null;
}

/**
 * Server-rendered stand-in for ApplyButton while its Suspense boundary is
 * pending. ApplyButton reads useSearchParams() (the ?apply=1 intent), and on
 * the ISR job route an unwrapped search-param read bails the WHOLE page out
 * to client rendering, so the page wraps it in Suspense with this fallback.
 * It reserves the button's 52px height so hydration causes no layout shift.
 *
 * Applying requires an account (owner decision 2026-09), so the stand-in
 * never links to the employer. Before hydration (or without JavaScript) it
 * is a GET form to /signup that returns to this job with the apply intent;
 * a signed-in visitor is sent straight back by the /signup page. A form,
 * not a link, so crawlers do not queue a sign-up URL for every job.
 */
export function ApplyButtonPlaceholder({ jobPath, applyLink, applyOnPlatform, sourceType }: ApplyButtonPlaceholderProps) {
  const hasApplyPath = applyOnPlatform || safeApplyHref(applyLink) !== null;
  const returnPath = withApplyIntent(jobPath);
  if (!hasApplyPath || !returnPath) {
    return <div aria-hidden="true" style={{ minHeight: '52px', width: '100%' }} />;
  }
  return (
    <form action="/signup" method="get" className="w-full">
      <input type="hidden" name="redirectTo" value={returnPath} />
      <button type="submit" className={CTA_CLASS} style={CTA_STYLE}>
        {applyOnPlatform && <Zap size={18} fill="currentColor" aria-hidden="true" />}
        {applyCtaLabel({ applyLink, sourceType, applyOnPlatform })}
        <span className="sr-only"> (create a free account or sign in to apply)</span>
      </button>
    </form>
  );
}

export default function ApplyButton({
  jobId,
  applyLink,
  jobTitle,
  isAuthenticated,
  applyOnPlatform = false,
  sourceType = null,
  employer = null,
  jobType = null,
  stateCode = null,
  sourceProvider = null,
}: ApplyButtonProps) {
  const { isApplied, markApplied, getAppliedDate } = useAppliedJobs();
  const searchParams = useSearchParams();

  // GA4 item for this job. Rebuilt per render rather than memoized: it feeds
  // click handlers only, never an effect dependency, so a stable identity
  // would buy nothing.
  const trackedJob: TrackedJob = {
    id: jobId,
    title: jobTitle,
    employer,
    jobType,
    stateCode,
    sourceProvider,
  };

  // Auth is resolved CLIENT-SIDE so the parent job-detail page can stay
  // statically cached (ISR). The server no longer reads cookies to pass
  // isAuthenticated — if a caller still provides it we honor it as the initial
  // value, otherwise we detect via /api/auth/me on mount.
  const [authed, setAuthed] = useState<boolean>(isAuthenticated ?? false);
  // Latches true once the auth state is actually KNOWN: immediately when the
  // caller supplied isAuthenticated, otherwise when the /api/auth/me probe
  // settles (success or failure). The ?apply=1 auto-open effect below gates
  // on this so it never acts on the provisional authed=false default.
  const [authResolved, setAuthResolved] = useState<boolean>(typeof isAuthenticated === 'boolean');
  useEffect(() => {
    if (typeof isAuthenticated === 'boolean') {
      // authResolved was initialized true for this case — nothing to probe.
      return;
    }
    let active = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (active) setAuthed(!!d?.id); })
      .catch(() => { })
      .finally(() => { if (active) setAuthResolved(true); });
    return () => { active = false; };
  }, [isAuthenticated]);

  // Owner decision 2026-09: applying requires an account. The employer's
  // application is a real link only for a visitor known to be signed in;
  // everyone else gets a button that opens the sign-up or log-in gate. Only
  // a value that parses as an http(s) or mailto: URL may become the href.
  const externalHref = applyOnPlatform ? null : safeApplyHref(applyLink);
  const applyRoute = resolveApplyRoute({ applyLink, sourceType, applyOnPlatform });
  const stepInput = { applyOnPlatform, hasExternalHref: externalHref !== null, authResolved, authed };
  const hasApplyPath = resolveApplyStep(stepInput) !== 'unavailable';
  const employerLinkHref = canLinkToEmployer(stepInput) ? externalHref : null;

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPlatformApply, setShowPlatformApply] = useState(false);
  // Signed in, external job, arrived with an apply intent: show the
  // "Continue to employer application" link instead of opening a tab.
  const [showContinuePanel, setShowContinuePanel] = useState(false);
  const [serverApplied, setServerApplied] = useState<{ applied: boolean; appliedAt?: string; status?: string } | null>(null);
  // Tracks whether the user just clicked an EXTERNAL apply link. Drives the
  // "Did you apply?" confirmation prompt — we don't auto-mark applied because
  // a click only signals intent, not a completed application. Returning to
  // the tab without applying (e.g. expired listing, changed mind) shouldn't
  // pollute /my-applications or the dashboard.
  const [awaitingApplyConfirm, setAwaitingApplyConfirm] = useState(false);
  const autoOpened = useRef(false);
  // This instance's outer element. The ?apply=1 effect reads it to tell
  // whether this is the instance on screen (see isRenderedElement).
  const rootRef = useRef<HTMLDivElement>(null);

  // Check server for existing application (for platform-apply jobs)
  useEffect(() => {
    if (!authed || !applyOnPlatform) return;
    fetch(`/api/applications/check?jobId=${jobId}`)
      .then(r => r.json())
      .then(data => setServerApplied(data))
      .catch(() => { });
  }, [authed, applyOnPlatform, jobId]);

  // Apply intent (?apply=1): set by a job card's Apply button and by the
  // return trip from sign up or log in. Fires once per mount. A signed-out
  // visitor gets the gate; a signed-in one gets the Easy Apply form, or for
  // an external job the "Continue to employer application" link. A new tab
  // is never opened here, because this runs outside a user gesture.
  useEffect(() => {
    if (autoOpened.current) return;
    if (!hasApplyIntent(searchParams)) return;
    if (!hasApplyPath) return;
    // F26: wait until auth state is KNOWN before latching. The job detail
    // page doesn't pass isAuthenticated, so authed starts false while the
    // /api/auth/me probe is in flight — acting on that provisional value
    // showed the "Sign in to apply" gate to users who had JUST signed in
    // (every post-auth return now routes back through ?apply=1).
    if (!authResolved) return;
    // Deferred a tick: opening the popup one macrotask after the effect keeps
    // the gate/apply swap a single async transition instead of a cascading
    // synchronous re-render. The once-per-mount latch is set inside the
    // callback — if a dep change (or StrictMode's dev double-invoke) re-runs
    // the effect before the timer fires, cleanup cancels the stale open and
    // the re-run re-arms it with fresh auth state, still firing exactly once.
    const open = setTimeout(() => {
      autoOpened.current = true;
      // The job page mounts two ApplyButtons, the desktop sidebar and the
      // mobile sticky bar, and CSS hides one of them. Both read the same
      // ?apply=1, so only the instance on screen acts on it: two would
      // count the apply click twice and stack two Easy Apply modals (each
      // portals to document.body). Which one is visible depends on the
      // viewport, so a prop from the page cannot choose it.
      if (!isRenderedElement(rootRef.current)) return;
      // The intent is used up once acted on: strip ?apply=1 from the address
      // bar so a reload, a Back press or a copied link does not reopen the
      // form or count the click again. null (not history.state, which
      // carries Next's own __NA marker) sends the call through the App
      // Router's replaceState patch, which keeps its internal state and
      // updates useSearchParams; the autoOpened latch keeps this effect from
      // acting again. The gate re-adds ?apply=1 (buildReturnUrl) when used.
      const clean = withoutApplyIntent(window.location.pathname, window.location.search);
      if (clean) window.history.replaceState(null, '', clean);
      if (!authed) {
        setShowAuthModal(true);
      } else if (applyOnPlatform) {
        // The Apply click that began this trip (before sign in, or on a job
        // card) is counted once, here, as the Easy Apply form opens. An
        // external job counts it when the continue link is clicked.
        postApplyClick(jobId);
        setShowPlatformApply(true);
      } else {
        setShowContinuePanel(true);
      }
    }, 0);
    return () => clearTimeout(open);
  }, [searchParams, applyOnPlatform, hasApplyPath, authed, authResolved, jobId]);

  // Safety net: if the auth probe resolves to authenticated while the
  // sign-in gate is showing (e.g. the user clicked Apply during the brief
  // pre-resolution window), swap the gate for the real apply flow instead
  // of asking an already-authenticated user to sign in again.
  useEffect(() => {
    if (!authed || !showAuthModal) return;
    // Deferred a tick so the gate→apply swap is a single async transition
    // rather than a cascading synchronous re-render inside the effect.
    const swap = setTimeout(() => {
      setShowAuthModal(false);
      if (applyOnPlatform) {
        setShowPlatformApply(true);
      } else {
        setShowContinuePanel(true);
      }
    }, 0);
    return () => clearTimeout(swap);
  }, [authed, showAuthModal, applyOnPlatform]);

  // The "Did you finish applying?" prompt replaces the apply link, so it is
  // raised one tick after the click: the browser has already started the
  // navigation to the employer's page by then (a link removed from the page
  // during its own click would not navigate). Cleared on unmount.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const applied = isApplied(jobId) || serverApplied?.applied;
  const appliedDate = getAppliedDate(jobId);

  // The click tracker for both apply paths (external link and Easy Apply
  // form), so employer dashboards never read "0 clicks, N applicants".
  const fireApplyClick = () => postApplyClick(jobId);

  // An Apply click that lands before the /api/auth/me probe settles is held
  // here instead of flashing the sign-in gate. Showing the gate swapped the
  // Apply button out of the DOM; the safety net above then opened the modal
  // with focus already on <body>, so closing it lost keyboard focus.
  const [pendingApply, setPendingApply] = useState(false);

  /**
   * External apply by a signed-in candidate: the link itself opens the
   * employer's application (no preventDefault). Track the click for
   * engagement analytics, but do NOT mark applied — clicking the link only
   * signals intent. The "Did you apply?" confirmation prompt below captures
   * the actual outcome once the user returns from the employer's site.
   */
  const handleExternalApplyClick = () => {
    fireApplyClick();
    trackJobApply(buildTrackedJobItem(trackedJob), 'external');
    const alreadyApplied = isApplied(jobId);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setShowContinuePanel(false);
      if (!alreadyApplied) setAwaitingApplyConfirm(true);
    }, 0);
  };

  /**
   * The Apply button: every signed-out click opens the gate (Easy Apply and
   * external alike), a click before the sign-in probe answers is held, and a
   * signed-in click opens Easy Apply (or, for an external job whose link
   * button raced the probe, the continue link).
   */
  const handleApply = () => {
    const step = resolveApplyStep(stepInput);
    if (step === 'unavailable') return;
    if (step === 'wait-for-auth') {
      setPendingApply(true);
      return;
    }
    if (step === 'auth-gate') {
      setShowAuthModal(true);
      return;
    }
    if (step === 'continue-to-employer') {
      setShowContinuePanel(true);
      return;
    }
    // Platform apply: show inline form (and bump the click counter — opening
    // the form is the equivalent intent-to-apply moment as clicking external)
    fireApplyClick();
    setShowPlatformApply(true);
  };

  // Resume the held Apply click once auth is known: the gate for a
  // signed-out visitor, the modal (or the continue link) for a signed-in
  // one. Deferred a tick like the other auth transitions above.
  useEffect(() => {
    if (!pendingApply || !authResolved) return;
    const resume = setTimeout(() => {
      setPendingApply(false);
      if (!authed) {
        setShowAuthModal(true);
        return;
      }
      if (!applyOnPlatform) {
        setShowContinuePanel(true);
        return;
      }
      postApplyClick(jobId);
      setShowPlatformApply(true);
    }, 0);
    return () => clearTimeout(resume);
  }, [pendingApply, authResolved, authed, applyOnPlatform, jobId]);

  /** User explicitly confirms they completed the application on the employer's site. */
  const handleConfirmApplied = () => {
    // The hook handles both localStorage and server persistence (when the
    // user is authenticated), so we don't fire a separate POST here.
    markApplied(jobId, applyLink ?? undefined);
    setAwaitingApplyConfirm(false);
  };

  /** User dismisses the prompt — they didn't apply (yet). Reverts to the Apply button. */
  const handleDismissApplyConfirm = () => {
    setAwaitingApplyConfirm(false);
  };

  // The modal stays mounted on success: InPlatformApplyForm swaps to its
  // "Application Submitted!" confirmation and the user dismisses it with Done
  // or Close (onClose). Closing here unmounted the confirmation the instant
  // it rendered, so candidates never saw that the submit went through.
  const handlePlatformApplySuccess = ({ isNew }: PlatformApplyOutcome) => {
    // Count the lead only when this submit created one. The apply route
    // upserts on (userId, jobId) and answers 200 either way, and the button
    // above offers "Apply Again" to someone who has already applied, so an
    // ungated call would book a second generate_lead against one application
    // row.
    //
    // The route's own `isNew` is the authority: it is decided server side
    // under a lock, so it is right even when this browser has never seen the
    // earlier application (another device, cleared storage) or has not
    // finished loading it yet. The local guard below only runs when the
    // response did not carry the flag (a route build that predates it), and
    // it must be read BEFORE markApplied, which flips isApplied(). In that
    // fallback a null serverApplied means the check request has not settled
    // yet, and that counts as not applied on purpose: a slow network must
    // never cost us a real conversion. This fails open in the same direction
    // as the job-alert surfaces.
    const isFirstApplication = typeof isNew === 'boolean'
      ? isNew
      : !serverApplied?.applied && !isApplied(jobId);
    markApplied(jobId);
    // The Easy Apply conversion. Fired on the submitted application, not on
    // the modal opening, because this branch is the one place on the board
    // where an application is known to exist. The external branch has no such
    // moment, so it still fires on the outbound click; apply_method
    // ('platform' against 'external') keeps the two readable apart in
    // reporting instead of averaging an intent signal with a completion one.
    if (isFirstApplication) {
      trackJobApply(buildTrackedJobItem(trackedJob), 'platform');
    }
    // Show the "already applied" notice once the confirmation is dismissed,
    // then settle on the server's record (status, appliedAt).
    setServerApplied({ applied: true, appliedAt: new Date().toISOString() });
    fetch(`/api/applications/check?jobId=${jobId}`)
      .then(r => r.json())
      .then(data => setServerApplied(data))
      .catch(() => { });
  };

  // Focus restore backstop for the apply modal. useFocusTrap returns focus to
  // the element focused when the trap armed; if that node was replaced while
  // the modal was open, focus would drop to <body>. The ref always points at
  // the live Apply button, so land keyboard users back on it instead.
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const platformApplyWasOpen = useRef(false);
  useEffect(() => {
    if (showPlatformApply) {
      platformApplyWasOpen.current = true;
      return;
    }
    if (!platformApplyWasOpen.current) return;
    platformApplyWasOpen.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) {
      applyButtonRef.current?.focus();
    }
  }, [showPlatformApply]);

  // F26: the post-auth return target is this page (pathname + search) with
  // the apply intent set, for Easy Apply AND external jobs, so the candidate
  // lands back here with the Easy Apply form open or the "Continue to
  // employer application" link showing, instead of hunting for the button.
  const buildReturnUrl = (): string =>
    withApplyIntent(window.location.pathname, window.location.search) ?? '/jobs';

  const handleSignIn = () => {
    window.location.href = authGateHref('login', buildReturnUrl());
  };

  const handleSignUp = () => {
    window.location.href = authGateHref('signup', buildReturnUrl());
  };

  const ctaLabel = applyCtaLabel({ applyLink, sourceType, applyOnPlatform }, { applied: Boolean(applied) });

  return (
    <div ref={rootRef} className="flex flex-col w-full">
      {/* Already Applied Notice (server-verified for platform apply jobs) */}
      {applyOnPlatform && serverApplied?.applied && !showPlatformApply && (
        <div
          className="rounded-xl p-4 mb-3"
          style={{
            backgroundColor: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              You&apos;ve already applied
            </span>
            {serverApplied.status && serverApplied.status !== 'applied' && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                style={{ backgroundColor: 'rgba(190,24,93,0.1)', color: '#BE185D' }}
              >
                {serverApplied.status}
              </span>
            )}
          </div>
          <p className="text-xs ml-7" style={{ color: 'var(--text-secondary)' }}>
            {serverApplied.appliedAt ? `Applied on ${formatAppliedDate(new Date(serverApplied.appliedAt))}.` : 'Applied recently.'}{' '}
            <Link href="/my-applications" className="underline font-medium" style={{ color: '#BE185D' }}>
              View your applications →
            </Link>
          </p>
        </div>
      )}

      {/* In-Platform Apply Modal — renders as overlay, doesn't replace button */}
      {showPlatformApply && (
        <InPlatformApplyForm
          jobId={jobId}
          jobTitle={jobTitle}
          onClose={() => setShowPlatformApply(false)}
          onSuccess={handlePlatformApplySuccess}
        />
      )}

      {showAuthModal ? (
        /* Inline Auth Gate — replaces button area when triggered */
        <ApplyAuthGate
          applyOnPlatform={applyOnPlatform}
          onSignUp={handleSignUp}
          onSignIn={handleSignIn}
          onBack={() => setShowAuthModal(false)}
        />
      ) : awaitingApplyConfirm ? (
        /* Inline confirmation — user just clicked the external apply link.
           Click alone doesn't prove they applied; ask explicitly so we don't
           pollute /my-applications with phantom records. */
        <div className="w-full rounded-2xl p-4" style={PANEL_STYLE}>
          <p
            className="text-sm font-semibold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Did you finish applying?
          </p>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            Confirm only after you submit on the employer&apos;s site. We&apos;ll add it
            to your applications.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleConfirmApplied}
              className="apply-btn flex-1 inline-flex items-center justify-center gap-2 text-white px-4 py-2.5 font-semibold text-sm touch-manipulation"
              style={{
                borderRadius: '14px',
                background: '#BE185D',
                border: '1px solid rgba(255,255,255,0.3)',
                boxShadow: '4px 4px 12px rgba(190,24,93,0.25), inset 1px 1px 2px rgba(255,255,255,0.2)',
              }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Yes, I applied
            </button>
            <button
              onClick={handleDismissApplyConfirm}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 font-semibold text-sm touch-manipulation"
              style={{
                borderRadius: '14px',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(90,74,66,0.18)',
              }}
            >
              Not yet
            </button>
          </div>
          {employerLinkHref && (
            <a
              href={employerLinkHref}
              {...externalApplyLinkProps(employerLinkHref)}
              className="inline-block text-xs hover:underline mt-3"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ↗ Reopen the apply link
            </a>
          )}
        </div>
      ) : showContinuePanel && employerLinkHref ? (
        <ContinueToEmployerPanel
          href={employerLinkHref}
          note={continueApplicationNote(applyRoute, isMailtoHref(employerLinkHref))}
          onContinue={handleExternalApplyClick}
          onDismiss={() => setShowContinuePanel(false)}
        />
      ) : (
        <>
          <div className="flex items-center gap-3">
            {employerLinkHref ? (
              <a
                href={employerLinkHref}
                {...externalApplyLinkProps(employerLinkHref)}
                onClick={handleExternalApplyClick}
                className={CTA_CLASS}
                style={CTA_STYLE}
              >
                {ctaLabel}
                <ExternalLink size={20} aria-hidden="true" />
                <span className="sr-only">{externalApplyHint(employerLinkHref)}</span>
              </a>
            ) : (
              <button
                type="button"
                ref={applyButtonRef}
                onClick={handleApply}
                disabled={!hasApplyPath}
                className={CTA_CLASS}
                style={hasApplyPath ? CTA_STYLE : { ...CTA_STYLE, opacity: 0.6, cursor: 'not-allowed' }}
              >
                {applyOnPlatform && <Zap size={18} fill="currentColor" aria-hidden="true" />}
                {hasApplyPath ? ctaLabel : APPLY_CTA_LABELS.none}
                {!applyOnPlatform && hasApplyPath && <ExternalLink size={20} aria-hidden="true" />}
              </button>
            )}

            {applied && (
              <span className="hidden lg:inline-flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-full text-sm font-medium">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
                Applied
              </span>
            )}
          </div>

          {applied && appliedDate && (
            <p className="text-sm mt-2 text-center lg:text-left" style={{ color: 'var(--text-tertiary)' }}>
              Applied on {formatAppliedDate(appliedDate)}
            </p>
          )}

          {!applied && (
            <button
              onClick={() => markApplied(jobId)}
              className="text-sm hover:underline mt-2 text-center lg:text-left py-2 touch-manipulation"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Already applied? Mark as applied
            </button>
          )}
        </>
      )}

      <style>{`
        .apply-btn:hover {
          transform: translateY(-3px);
          box-shadow: 8px 8px 20px rgba(190,24,93,0.35), -4px -4px 12px rgba(255,255,255,0.25), inset 2px 2px 5px rgba(255,255,255,0.3), inset -1px -1px 2px rgba(0,0,0,0.08) !important;
        }
        .apply-btn:active {
          transform: translateY(1px);
          box-shadow: 2px 2px 6px rgba(190,24,93,0.2), inset 3px 3px 6px rgba(0,0,0,0.12), inset -2px -2px 4px rgba(255,255,255,0.15) !important;
        }
      `}
      </style>
    </div>
  );
}
