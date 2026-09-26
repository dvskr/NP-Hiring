'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { X, Bell, ArrowRight } from 'lucide-react';
import { useOverlaySlot } from '@/components/OverlayCoordinator';
import { brand } from '@/config/brand';
import { trackEmailSubscribe } from '@/lib/analytics';

const STORAGE_KEY = 'pmhnp_exit_popup_dismissed';
const SUPPRESS_DAYS = 14;
// subscribe_source for this surface. Separate from the job-alert modal on
// purpose: an interrupted visitor and a visitor who opened the alert form
// are different intents and should never be read as one number.
const SUBSCRIBE_SOURCE = 'exit_intent_popup';
// How long the confirmation stays up before the popup closes itself. Only a
// confirmed signup closes on a timer: a failure stays open so the visitor can
// read what went wrong and try again.
const CONFIRMATION_VISIBLE_MS = 2000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXIT_POPUP_ERROR_ID = 'exit-popup-error';

/**
 * Where the submit stands. A failure returns the form to 'idle' and sets a
 * SubscribeFailure. 'repeat-confirmed' is a 2xx that matched an existing
 * alert (isNew false) rather than storing a new one.
 */
type SubmitStatus = 'idle' | 'loading' | 'subscribed' | 'repeat-confirmed';

/** Why a signup did not go through, in words the visitor can act on. */
export interface SubscribeFailure {
    message: string;
    /** The address itself was the problem, so the field is marked invalid. */
    blamesEmail: boolean;
}

const INVALID_EMAIL_FAILURE: SubscribeFailure = {
    message: 'Enter a valid email address, such as name@example.com.',
    blamesEmail: true,
};

/**
 * The failure shown when the signup did not go through, keyed on the HTTP
 * status the server answered, or null when no answer arrived at all. Each
 * message says the visitor is not subscribed yet and what to do next,
 * because the popup used to report "subscribed" whatever happened, and a
 * visitor who believed it would wait for alerts that were never set up.
 */
export function describeSubscribeFailure(status: number | null): SubscribeFailure {
    if (status === null) {
        return {
            message: 'We could not reach our server, so you are not subscribed yet. Check your connection and try again.',
            blamesEmail: false,
        };
    }
    if (status === 400) {
        // The popup sends only an address, a fixed frequency and a boolean,
        // so a 400 from app/api/job-alerts/route.ts means the address.
        return {
            message: 'That email address was not accepted, so you are not subscribed yet. Check it for typos and try again.',
            blamesEmail: true,
        };
    }
    if (status === 429) {
        // RATE_LIMITS.jobAlerts in lib/rate-limit.ts counts attempts over a
        // 60 second window, so a minute is enough for the next try to land.
        return {
            message: 'Too many attempts, so you are not subscribed yet. Please wait a minute, then try again.',
            blamesEmail: false,
        };
    }
    return {
        message: 'Something went wrong on our side, so you are not subscribed yet. Please try again in a few minutes.',
        blamesEmail: false,
    };
}

/**
 * Exit-intent popup for job alerts
 * Desktop: triggers on mouse leaving viewport
 * Mobile: DISABLED — Google's "intrusive interstitial" ranking penalty
 *         specifically targets timed mobile popups blocking content. The
 *         previous 45s mobile timer was the exact pattern Google calls
 *         out as a soft penalty trigger. Desktop mouse-leave is not
 *         affected because there's no mobile equivalent of the gesture.
 * Suppressed for 14 days after it is closed or a signup is confirmed (a
 *         failed signup leaves it open for a retry)
 * Skips logged-in users (they already have an account)
 */
export default function ExitIntentPopup() {
    const [isOpen, setIsOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [newsletterOptIn, setNewsletterOptIn] = useState(true);
    const [status, setStatus] = useState<SubmitStatus>('idle');
    const [failure, setFailure] = useState<SubscribeFailure | null>(null);

    const dismiss = useCallback(() => {
        setIsOpen(false);
        try {
            localStorage.setItem(STORAGE_KEY, Date.now().toString());
        } catch { /* noop */ }
    }, []);

    useEffect(() => {
        // Skip for logged-in users
        try {
            const hasAuth = document.cookie.includes('sb-') || localStorage.getItem('supabase.auth.token');
            if (hasAuth) return;
        } catch { /* noop */ }

        // Check if suppressed
        try {
            const dismissed = localStorage.getItem(STORAGE_KEY);
            if (dismissed) {
                const elapsed = Date.now() - parseInt(dismissed, 10);
                if (elapsed < SUPPRESS_DAYS * 24 * 60 * 60 * 1000) return;
            }
        } catch { /* noop */ }

        let triggered = false;

        // Desktop only: mouse leave (no mobile equivalent — see header comment).
        const handleMouseLeave = (e: MouseEvent) => {
            // Hard-gate: never run on small viewports even if a desktop UA somehow
            // ends up in a narrow window — defense in depth against the
            // intrusive-interstitial penalty.
            if (window.innerWidth < 768) return;
            if (e.clientY <= 5 && !triggered) {
                triggered = true;
                setIsOpen(true);
            }
        };

        document.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            document.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, []);

    // A failure puts the form back, with the address still filled in, so a
    // retry is one click; only a confirmed signup closes the popup.
    const failWith = (reason: SubscribeFailure) => {
        setFailure(reason);
        setStatus('idle');
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim();
        // The form validates here rather than through the browser (it is
        // noValidate), so an empty or malformed address gets the same inline
        // message instead of either a native tooltip or, for an empty field,
        // a click that silently did nothing.
        if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
            failWith(INVALID_EMAIL_FAILURE);
            return;
        }
        setFailure(null);
        setStatus('loading');

        let response: Response;
        try {
            response = await fetch('/api/job-alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: trimmed, frequency: 'daily', newsletterOptIn }),
            });
        } catch {
            failWith(describeSubscribeFailure(null));
            return;
        }
        // The body read must not be able to fail the handler: a route that
        // answers a non-JSON body (a proxy error page) would otherwise throw
        // past every state below and leave the popup spinning.
        const body = await response.json().catch(() => null);

        // The confirmation is shown only for an answer that created or
        // matched an alert. The popup used to say "subscribed" whatever the
        // server answered, so a rejected or failed signup left the visitor
        // waiting for alerts that were never set up.
        if (!response.ok || body?.success === false) {
            failWith(describeSubscribeFailure(response.status));
            return;
        }

        // `isNew` matters more here than on the alert modal. The popup posts
        // no search criteria at all, so every submission from one address
        // collides on the same all-null criteria key and
        // app/api/job-alerts/route.ts updates the existing row rather than
        // storing a second one. The dismissal latch does not prevent that:
        // it lives in this browser's localStorage, so the same person meets
        // the popup again after the suppression window, on a second device,
        // or once site data is cleared, and each of those used to report
        // another subscribe against the one alert they already have. Tested
        // against false rather than for truth so a route build that predates
        // the flag still reports its real signups.
        const isRepeat = body?.isNew === false;
        if (!isRepeat) trackEmailSubscribe(SUBSCRIBE_SOURCE);
        // A repeat gets its own confirmation, which promises no email: the
        // route sends the welcome email only for an alert it newly
        // confirmed, so "check your inbox" would send the visitor looking
        // for an email that is usually not coming.
        //
        // Nor may it claim the address was subscribed before this click.
        // isNew is false for any matched row, including one paused through
        // PATCH /api/job-alerts/[token], one whose address clicked
        // Unsubscribe (unsubscribeLead suppresses the EmailLead and leaves
        // the JobAlert row), and a legacy pending alert with no confirmedAt.
        // None of those people were receiving alerts before this click, and
        // one who unsubscribed would read "already" as proof the unsubscribe
        // never worked. What holds in every repeat case after a 2xx is that
        // alerts are on now: the route has just set isActive, confirmedAt
        // and frequency on the row and lifted any unsubscribe suppression.
        setStatus(isRepeat ? 'repeat-confirmed' : 'subscribed');
        setTimeout(dismiss, CONFIRMATION_VISIBLE_MS);
    };

    const isConfirmed = status === 'subscribed' || status === 'repeat-confirmed';

    // SEO Fix H9: gate via OverlayCoordinator (priority 4 — lowest).
    const slotGranted = useOverlaySlot('exit', isOpen);
    if (!slotGranted) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
        >
            <div
                className="relative w-full max-w-md mx-4 rounded-2xl p-8"
                style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25), 0 0 40px rgba(244,114,182,0.1)',
                }}
            >
                {/* Close button */}
                <button
                    onClick={dismiss}
                    className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Close popup"
                >
                    <X size={18} />
                </button>

                {/* Icon */}
                <div className="flex justify-center mb-4">
                    <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center"
                        style={{
                            background: 'linear-gradient(135deg, rgba(244,114,182,0.15), rgba(232,108,44,0.1))',
                        }}
                    >
                        <Bell size={24} style={{ color: '#F472B6' }} />
                    </div>
                </div>

                <h3 className="text-xl font-bold text-center mb-2" style={{ color: 'var(--text-primary)' }}>
                    Don&apos;t Miss Your Dream {brand.niche.short} Job
                </h3>
                <p className="text-sm text-center mb-6" style={{ color: 'var(--text-secondary)' }}>
                    Get the latest {brand.niche.short} positions delivered to your inbox daily. No spam, only jobs.
                </p>

                {isConfirmed ? (
                    <div className="text-center py-4" role="status">
                        {status === 'repeat-confirmed' ? (
                            <>
                                <p className="text-base font-semibold" style={{ color: '#22c55e' }}>
                                    ✓ You&apos;re subscribed
                                </p>
                                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                                    Daily job alerts for this address are on.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-base font-semibold" style={{ color: '#22c55e' }}>
                                    ✓ You&apos;re subscribed!
                                </p>
                                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                                    Check your inbox for a welcome email.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                // Editing the address is the retry, so the
                                // stale failure message goes with it.
                                if (failure) setFailure(null);
                            }}
                            placeholder="your@email.com"
                            aria-label="Email address"
                            aria-invalid={failure?.blamesEmail ? true : undefined}
                            aria-describedby={failure ? EXIT_POPUP_ERROR_ID : undefined}
                            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                            style={{
                                backgroundColor: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                            }}
                            autoFocus
                        />
                        {failure && (
                            // #B91C1C reads at AA contrast on the popup's
                            // light surface; the lighter reds used elsewhere
                            // do not at this text size.
                            <p
                                id={EXIT_POPUP_ERROR_ID}
                                role="alert"
                                className="text-sm"
                                style={{ color: '#B91C1C' }}
                            >
                                {failure.message}
                            </p>
                        )}
                        <label
                            className="flex items-center gap-2 cursor-pointer select-none"
                            style={{ padding: '4px 0' }}
                        >
                            <input
                                type="checkbox"
                                checked={newsletterOptIn}
                                onChange={(e) => setNewsletterOptIn(e.target.checked)}
                                className="w-4 h-4 rounded cursor-pointer accent-[#F472B6]"
                            />
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                Also send me the monthly {brand.niche.short} newsletter
                            </span>
                        </label>
                        <button
                            type="submit"
                            disabled={status === 'loading'}
                            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                            style={{
                                background: 'linear-gradient(135deg, #F472B6, #BE185D)',
                            }}
                        >
                            {status === 'loading' ? 'Subscribing...' : (
                                <>Get Daily Job Alerts <ArrowRight size={16} /></>
                            )}
                        </button>
                        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
                            Free forever. Unsubscribe anytime.
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}
