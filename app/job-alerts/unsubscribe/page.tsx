'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, Loader2, Pause, CalendarDays, Trash2 } from 'lucide-react';

/**
 * P2 #23 — retention step-down instead of all-or-nothing opt-out.
 *
 * The old page offered exactly two outcomes: delete the alert, or Cancel
 * (which called router.back() and therefore did nothing at all for someone
 * arriving from an email client). Everyone who was merely getting too much
 * mail had to delete. This page now leads with the two reversible outcomes
 * the API already supports — pause (PATCH isActive:false) and weekly instead
 * of daily (PATCH frequency:'weekly') — and keeps delete as the explicit
 * last option.
 *
 * Every action reports its own failure; nothing is claimed to have happened
 * unless the API confirmed it.
 */

type Outcome = 'paused' | 'weekly' | 'deleted';

interface AlertSummary {
  token: string;
  frequency: string;
  isActive: boolean;
}

type PendingAction = 'pause' | 'weekly' | 'delete' | null;

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  /**
   * A token belonging to a DIFFERENT alert on the same address, captured
   * before anything is deleted. Every token grants the same view (GET
   * /api/job-alerts?token= returns all alerts on the email), but the one
   * in this URL stops resolving the moment the alert behind it is deleted
   * — the route 404s "Job alert not found". Keeping a sibling lets the
   * post-delete CTA still land on the alerts the user kept.
   */
  const [siblingToken, setSiblingToken] = useState<string | null>(null);
  const [loadingAlert, setLoadingAlert] = useState(Boolean(token));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    if (!token) {
      setFatalError('Invalid unsubscribe link. No token provided.');
    }
  }, [token]);

  /**
   * Read the alert this token belongs to so the page can offer the right
   * choices — "switch to weekly" is only shown to someone on the daily
   * digest, and "pause" is only shown for an alert that is actually running.
   * GET /api/job-alerts?token= returns every alert on that address; we pick
   * the row this link was minted for.
   */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadAlert(alertToken: string) {
      try {
        const res = await fetch(`/api/job-alerts?token=${encodeURIComponent(alertToken)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setFatalError(data.error || 'We couldn’t find this job alert. It may have already been removed.');
          return;
        }
        const allAlerts = (data.alerts as AlertSummary[] | undefined) ?? [];
        const match = allAlerts.find((a) => a.token === alertToken);
        if (!match) {
          setFatalError('We couldn’t find this job alert. It may have already been removed.');
          return;
        }
        setAlertSummary({ token: match.token, frequency: match.frequency, isActive: match.isActive });
        setSiblingToken(allAlerts.find((a) => a.token !== alertToken)?.token ?? null);
      } catch {
        if (!cancelled) {
          // Not fatal: the three actions below can still be attempted. We just
          // fall back to showing all of them.
          setActionError('We couldn’t load this alert’s current settings. You can still choose an option below.');
        }
      } finally {
        if (!cancelled) setLoadingAlert(false);
      }
    }

    void loadAlert(token);
    return () => { cancelled = true; };
  }, [token]);

  const patchAlert = useCallback(async (
    action: Exclude<PendingAction, null>,
    body: Record<string, unknown>,
    nextOutcome: Outcome,
  ) => {
    if (!token) return;
    setPending(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/job-alerts/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'We couldn’t update this alert. Please try again.');
        return;
      }
      setOutcome(nextOutcome);
    } catch {
      setActionError('Network error — we couldn’t reach the server. Please try again.');
    } finally {
      setPending(null);
    }
  }, [token]);

  const handlePause = () => patchAlert('pause', { isActive: false }, 'paused');
  // Cadence only — never flip isActive here. Resuming a paused alert from the
  // unsubscribe page would be the opposite of what the visitor came to do.
  const handleWeekly = () => patchAlert('weekly', { frequency: 'weekly' }, 'weekly');

  const handleDelete = async () => {
    if (!token) return;
    setPending('delete');
    setActionError(null);
    try {
      const res = await fetch(`/api/job-alerts?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'We couldn’t delete this alert. It may have already been removed.');
        return;
      }
      setOutcome('deleted');
    } catch {
      setActionError('Network error — we couldn’t reach the server. Please try again.');
    } finally {
      setPending(null);
    }
  };

  // ── Fatal (bad/expired token) ─────────────────────────────────────────────
  if (fatalError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-3">Something Went Wrong</h1>
          <p className="text-gray-600 text-center mb-6">{fatalError}</p>
          <Link
            href="/jobs"
            className="block w-full px-4 py-3 bg-pink-700 text-white rounded-lg font-medium text-center hover:bg-pink-800 transition-colors"
          >
            Browse Jobs
          </Link>
        </div>
      </div>
    );
  }

  // ── Confirmed outcome ─────────────────────────────────────────────────────
  if (outcome) {
    const copy = {
      paused: {
        title: 'Alert Paused',
        body: 'You won’t receive this alert until you resume it. Nothing was deleted — your criteria are still saved.',
      },
      weekly: {
        title: 'Switched to Weekly',
        body: 'You’ll now get this alert once a week instead of daily. You can change the cadence or pause it anytime.',
      },
      deleted: {
        title: 'Alert Deleted',
        body: 'This job alert has been deleted. You won’t receive it again.',
      },
    }[outcome];

    /**
     * After a delete this token is gone: /job-alerts/manage?token=<deleted>
     * calls GET /api/job-alerts?token=, which 404s "Job alert not found",
     * so the manage page would render an error banner and an empty list —
     * even for someone who still has other alerts. Route the deleted case
     * through a surviving sibling token when we captured one, and fall back
     * to the public alerts page (which has its own manage link) when we
     * didn't. Pause and cadence changes leave the token valid, so they keep
     * using it.
     */
    const manageHref = outcome !== 'deleted'
      ? `/job-alerts/manage?token=${encodeURIComponent(token ?? '')}`
      : siblingToken
        ? `/job-alerts/manage?token=${encodeURIComponent(siblingToken)}`
        : '/job-alerts';
    const manageLabel = outcome !== 'deleted'
      ? 'Manage This Alert'
      : siblingToken
        ? 'Manage My Other Alerts'
        : 'Create a New Alert';

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-3">{copy.title}</h1>
          <p className="text-gray-600 text-center mb-6">{copy.body}</p>
          <div className="space-y-3">
            <Link
              href={manageHref}
              className="block w-full px-4 py-3 bg-pink-700 text-white rounded-lg font-medium text-center hover:bg-pink-800 transition-colors"
            >
              {manageLabel}
            </Link>
            <Link
              href="/jobs"
              className="block w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium text-center hover:bg-gray-200 transition-colors"
            >
              Browse Jobs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading the alert's current settings ──────────────────────────────────
  if (loadingAlert) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-pink-700" />
          <span className="text-gray-600">Loading your alert…</span>
        </div>
      </div>
    );
  }

  // Show "switch to weekly" only when it is a real step down: the alert has to
  // be running AND on the daily digest. If the settings lookup failed we show
  // both options — the API is the final arbiter either way.
  const isRunning = !alertSummary || alertSummary.isActive;
  const canDownsellToWeekly = isRunning && (!alertSummary || alertSummary.frequency !== 'weekly');
  const canPause = isRunning;
  const busy = pending !== null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-3">
          {isRunning ? 'Too many emails?' : 'This alert is already paused'}
        </h1>
        <p className="text-gray-600 text-center mb-6">
          {isRunning
            ? 'You don’t have to delete this alert to stop the noise — pick whatever fits. Every option below is reversible except the last one.'
            : 'It isn’t sending you anything right now. You can leave it paused, change what it looks for, or delete it for good.'}
        </p>

        {actionError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {actionError}
          </div>
        )}

        <div className="space-y-3">
          {canPause && (
            <button
              onClick={handlePause}
              disabled={busy}
              className="w-full px-4 py-3 bg-pink-700 text-white rounded-lg font-medium hover:bg-pink-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {pending === 'pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pause this alert
            </button>
          )}

          {canDownsellToWeekly && (
            <button
              onClick={handleWeekly}
              disabled={busy}
              className="w-full px-4 py-3 bg-white text-pink-700 border border-pink-200 rounded-lg font-medium hover:bg-pink-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {pending === 'weekly' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              Send it weekly instead
            </button>
          )}

          <Link
            href={`/job-alerts/manage?token=${encodeURIComponent(token ?? '')}`}
            className="block w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium text-center hover:bg-gray-200 transition-colors"
          >
            Change what it sends me
          </Link>

          <button
            onClick={handleDelete}
            disabled={busy}
            className="w-full px-4 py-3 bg-white text-red-600 border border-red-200 rounded-lg font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {pending === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete this alert permanently
          </button>

          {/* Must be a real navigation, not history.back(). This page is
              reached from a digest footer link, which mail clients open in a
              fresh tab with history.length === 1 — router.back() is exactly
              the dead control the header comment above cites as the OLD
              page's defect. Leaving for /jobs changes nothing about the
              alert, which is what "keep everything as-is" promises. */}
          <Link
            href="/jobs"
            aria-disabled={busy || undefined}
            className={`block w-full px-4 py-2 text-gray-500 rounded-lg text-sm font-medium text-center hover:text-gray-700 transition-colors ${busy ? 'pointer-events-none opacity-50' : ''}`}
          >
            Never mind, keep everything as-is
          </Link>
        </div>

        {/* The token MUST be carried here. This page's audience is
            email-only subscribers by design, and /job-alerts/manage without a
            token falls back to /api/auth/me and renders "Please sign in to
            manage your alerts" — a dead end for exactly the people reading
            this. It is load-bearing, not cosmetic: the digest merges a user's
            multiple alerts into ONE email under the first alert's token
            (job-alerts-service.ts), so pausing "this one alert" may not stop
            the mail, and this footnote is the only pointer to the rest.
            GET /api/job-alerts?token= resolves the email and returns EVERY
            alert on it, so the token genuinely delivers "manage them all".
            Token is guaranteed non-empty here — a missing one short-circuits
            to the fatal-error branch above. */}
        <p className="mt-6 text-xs text-gray-400 text-center">
          Pausing and cadence changes only affect this one alert. Any other
          alerts on your address keep running — manage them all from{' '}
          <Link
            href={`/job-alerts/manage?token=${encodeURIComponent(token ?? '')}`}
            className="underline"
          >
            your alerts page
          </Link>.
        </p>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-pink-700" />
        <span className="text-gray-600">Loading...</span>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <UnsubscribeContent />
    </Suspense>
  );
}
