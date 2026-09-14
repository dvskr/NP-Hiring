'use client';

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { X, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import {
    denyAllConsent,
    grantAllConsent,
    updateConsentByCategories,
} from '@/lib/analytics';
import {
    ALL_DENIED,
    ALL_GRANTED,
    ANALYTICS_ONLY,
    CONSENT_EVENT,
    CONSENT_REOPEN_EVENT,
    getConsentRegion,
    getPrivacySignal,
    type ConsentCategories,
    type ConsentRegion,
} from '@/lib/consent';
import { useOverlaySlot } from '@/components/OverlayCoordinator';

interface Props {
    /** Server-rendered initial state from the HttpOnly consent cookie. */
    initialConsent: ConsentCategories | null;
}

/**
 * Persist the user's choice via the HttpOnly cookie API. We also dispatch
 * the consent-changed event so other client components (Speed Insights
 * gate, GA inline) can react without a full page reload.
 */
async function persistConsent(categories: ConsentCategories) {
    try {
        await fetch('/api/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories }),
            credentials: 'same-origin',
        });
    } catch {
        /* the in-memory state is still updated; cookie persistence
           is best-effort and re-tries on next interaction. */
    }
    try {
        window.dispatchEvent(
            new CustomEvent<ConsentCategories>(CONSENT_EVENT, { detail: categories }),
        );
    } catch { /* noop */ }
}

/**
 * What Escape does on the banner. Escape must never grant anything: with no
 * recorded choice it records the privacy-preserving default (decline all
 * non-essential); when the banner was re-opened over an existing choice it
 * closes and keeps that choice untouched.
 */
export type EscapeDismissAction = 'decline' | 'keep-saved';

export function escapeDismissAction(saved: ConsentCategories | null): EscapeDismissAction {
    return saved ? 'keep-saved' : 'decline';
}

/** Delay before the banner appears in a strict-consent region. */
export const BANNER_REVEAL_DELAY_MS = 1500;

/**
 * Mount-time decision for this page view, in priority order:
 *   deny-all       a GPC / DNT privacy signal is present
 *   none           a prior choice is already on the server-rendered cookie
 *   analytics-only implied-consent region
 *   show-banner    strict-consent region with no recorded choice
 */
export type InitialBannerDecision = 'deny-all' | 'none' | 'analytics-only' | 'show-banner';

export function initialBannerDecision(input: {
    privacySignal: boolean;
    initialConsent: ConsentCategories | null;
    region: ConsentRegion;
}): InitialBannerDecision {
    if (input.privacySignal) return 'deny-all';
    if (input.initialConsent) return 'none';
    if (input.region === 'implied') return 'analytics-only';
    return 'show-banner';
}

/**
 * The delayed reveal only fires while no choice has been recorded on this
 * page view. A choice made in the meantime (footer Cookie Settings, then
 * Decline) must never bring the banner back on its own.
 */
export function shouldRevealBanner(savedThisView: ConsentCategories | null): boolean {
    return savedThisView === null;
}

/** Hit area of each category switch in the Customize panel. */
export const CONSENT_SWITCH_TAP_TARGET_PX = 44;

/** Tailwind classes shared by every banner action button: 44px tap target. */
export const CONSENT_BUTTON_BASE =
    'min-h-[44px] rounded-lg text-sm transition-all cursor-pointer';

async function clearConsentServer() {
    try {
        await fetch('/api/consent', { method: 'DELETE', credentials: 'same-origin' });
    } catch { /* noop */ }
    try {
        window.dispatchEvent(new CustomEvent<ConsentCategories | null>(CONSENT_EVENT, { detail: null }));
    } catch { /* noop */ }
}

/**
 * Cookie consent banner — Consent Mode v2 compliant with granular categories.
 *
 * Decision tree on mount:
 *   1. Privacy signal (Sec-GPC, DNT) → record all-denied, no banner.
 *   2. Implied-consent region (US, RoW) → auto-grant analytics-only,
 *      no banner. User can revoke via footer "Cookie Settings".
 *   3. Strict-consent region (EEA, UK, CH, CA, BR, AU) → show banner.
 *
 * Categories map to Google Consent Mode v2 signals:
 *   essential  → security_storage, functionality_storage (always on)
 *   analytics  → analytics_storage, personalization_storage
 *   marketing  → ad_storage, ad_user_data, ad_personalization
 */
export default function CookieConsent({ initialConsent }: Props) {
    const [show, setShow] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [cats, setCats] = useState<ConsentCategories>(initialConsent ?? ALL_DENIED);
    const [savedCats, setSavedCats] = useState<ConsentCategories | null>(initialConsent);
    // Focus management. The first automatic appearance never steals focus
    // (the banner is non-blocking; the page stays usable behind it). When the
    // visitor re-opens it from the footer "Cookie Settings" control, focus
    // moves into the dialog and returns to that control when it closes.
    const dialogRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const focusOnShowRef = useRef(false);

    // Latest recorded choice for this page view, readable from timers and
    // event listeners without re-subscribing them when it changes.
    const savedCatsRef = useRef<ConsentCategories | null>(initialConsent);
    useEffect(() => {
        savedCatsRef.current = savedCats;
    }, [savedCats]);

    // Pending 1.5 s reveal, cancelled on unmount.
    const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Mount-time decision tree. Depends on initialConsent only, so it runs
    // ONCE per page view. It used to be re-created from an effect whose deps
    // also listed savedCats, so every choice (Decline, Accept All, Save)
    // re-ran the tree; with no server-rendered consent that re-armed the
    // 1.5 s timer and brought the banner back right after the visitor
    // dismissed it, on top of the footer Cookie Settings control.
    const evaluate = useCallback(() => {
        const decision = initialBannerDecision({
            privacySignal: Boolean(getPrivacySignal()),
            initialConsent,
            region: getConsentRegion(),
        });
        if (decision === 'deny-all') {
            // 1. Honor browser privacy signals (CCPA/CPRA).
            denyAllConsent();
            void persistConsent(ALL_DENIED);
            setSavedCats(ALL_DENIED);
            return;
        }
        if (decision === 'analytics-only') {
            // 3. Implied-consent regions: grant analytics only, no banner.
            updateConsentByCategories(ANALYTICS_ONLY);
            void persistConsent(ANALYTICS_ONLY);
            setSavedCats(ANALYTICS_ONLY);
            return;
        }
        if (decision === 'show-banner') {
            // 4. Strict-consent regions: show after a short delay, unless the
            // visitor recorded a choice in the meantime.
            if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
            revealTimerRef.current = setTimeout(() => {
                revealTimerRef.current = null;
                if (!shouldRevealBanner(savedCatsRef.current)) return;
                setShow(true);
            }, BANNER_REVEAL_DELAY_MS);
        }
        // 'none': 2. a prior choice is already on the cookie.
    }, [initialConsent]);

    useEffect(() => () => {
        if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    }, []);

    useEffect(() => {
        // Deferred a tick: the decision tree reads signals that are stable
        // for the life of the page load (GPC/DNT, region, server-rendered
        // consent), so evaluating one macrotask after mount avoids a
        // cascading synchronous re-render from its setState calls.
        const arm = setTimeout(evaluate, 0);
        // Footer "Cookie Settings" re-opens the banner at any time. Reads the
        // saved choice through a ref so the listener never re-subscribes (and
        // never re-runs evaluate) when a choice is made.
        const onReopen = () => {
            const active = document.activeElement;
            openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
            focusOnShowRef.current = true;
            const saved = savedCatsRef.current;
            if (saved) setCats(saved);
            setExpanded(false);
            setShow(true);
        };
        window.addEventListener(CONSENT_REOPEN_EVENT, onReopen);
        return () => {
            clearTimeout(arm);
            window.removeEventListener(CONSENT_REOPEN_EVENT, onReopen);
        };
    }, [evaluate]);

    /** Hide the banner and hand focus back to whatever re-opened it. */
    const close = () => {
        setShow(false);
        setExpanded(false);
        focusOnShowRef.current = false;
        const opener = openerRef.current;
        openerRef.current = null;
        if (opener && opener.isConnected) {
            // After the banner unmounts, so focus is not dropped to <body>.
            setTimeout(() => opener.focus(), 0);
        }
    };

    const acceptAll = () => {
        close();
        grantAllConsent();
        void persistConsent(ALL_GRANTED);
        setSavedCats(ALL_GRANTED);
    };

    const declineAll = () => {
        close();
        denyAllConsent();
        void persistConsent(ALL_DENIED);
        setSavedCats(ALL_DENIED);
    };

    const savePreferences = () => {
        close();
        updateConsentByCategories(cats);
        void persistConsent(cats);
        setSavedCats(cats);
    };

    const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (escapeDismissAction(savedCats) === 'keep-saved' && savedCats) {
            // Re-opened over an existing choice: discard unsaved toggles and
            // re-record the saved choice (the reopen cleared the cookie).
            setCats(savedCats);
            close();
            updateConsentByCategories(savedCats);
            void persistConsent(savedCats);
            return;
        }
        declineAll();
    };

    // SEO Fix H9: gate via OverlayCoordinator so only one overlay renders
    // at a time. Cookie consent has the highest priority — when it wants
    // to show, push/pwa/exit-intent are blocked from rendering.
    const slotGranted = useOverlaySlot('cookie', show);

    useEffect(() => {
        if (!slotGranted || !focusOnShowRef.current) return;
        focusOnShowRef.current = false;
        dialogRef.current?.focus();
    }, [slotGranted]);

    if (!slotGranted) return null;

    return (
        // Below md, app/globals.css (.cookie-consent-banner) seats it on top of
        // the BottomNav using the nav's measured height (--bottom-nav-h), so the
        // nav stays fully tappable. On md+ where BottomNav is hidden: bottom-0.
        // On job detail below lg, app/globals.css (.cookie-consent-banner)
        // lifts it above the sticky apply bar so Easy Apply stays tappable.
        // Non-blocking dialog: Escape dismisses without consenting.
        <div
            ref={dialogRef}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
            className="cookie-consent-banner fixed left-0 right-0 bottom-0 z-[9990] p-4 focus:outline-none"
            style={{
                backgroundColor: '#F5F0EB',
                backdropFilter: 'blur(8px)',
                borderTop: '1px solid rgba(90,74,66,0.10)',
                boxShadow: '0 -4px 20px rgba(90,74,66,0.08)',
            }}
            role="dialog"
            aria-label="Cookie consent"
            aria-describedby="cookie-consent-description"
        >
            <div className="max-w-5xl mx-auto">
                {/* ─── Top row: message + collapsed actions ─── */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-sm" style={{ color: '#5A4A42' }}>
                        <Shield size={18} style={{ color: '#BE185D', flexShrink: 0 }} />
                        <p id="cookie-consent-description">
                            We use cookies for analytics and to improve your experience.
                            By continuing, you agree to our{' '}
                            <Link href="/privacy" className="underline" style={{ color: '#BE185D', fontWeight: 600 }}>
                                Privacy Policy
                            </Link>.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={declineAll}
                            className={`${CONSENT_BUTTON_BASE} px-4 py-2 font-medium`}
                            style={{
                                color: '#5A4A42',
                                backgroundColor: '#EDE7E0',
                                border: '1px solid rgba(255,255,255,0.5)',
                            }}
                        >
                            Decline
                        </button>
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className={`${CONSENT_BUTTON_BASE} px-4 py-2 font-medium flex items-center gap-1`}
                            style={{
                                color: '#5A4A42',
                                backgroundColor: 'transparent',
                                border: '1px solid rgba(90,74,66,0.20)',
                            }}
                            aria-expanded={expanded}
                            aria-controls="cookie-consent-categories"
                        >
                            Customize
                            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                        <button
                            type="button"
                            onClick={acceptAll}
                            className={`${CONSENT_BUTTON_BASE} px-5 py-2 font-semibold text-white`}
                            style={{ background: 'linear-gradient(135deg, #F472B6, #BE185D)' }}
                        >
                            Accept All
                        </button>
                        {/* Icon dismiss: min 44x44 like every other action. */}
                        <button
                            type="button"
                            onClick={declineAll}
                            className="min-h-[44px] min-w-[44px] p-3 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
                            style={{ color: '#7A6A62' }}
                            aria-label="Decline cookies"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {/* ─── Expanded panel: per-category toggles ─── */}
                {expanded && (
                    <div
                        id="cookie-consent-categories"
                        className="mt-4 pt-4"
                        style={{ borderTop: '1px solid rgba(90,74,66,0.10)' }}
                    >
                        <CategoryRow
                            title="Essential"
                            description="Required for authentication, security, and core site functionality. Always on."
                            locked
                            checked
                        />
                        <CategoryRow
                            title="Analytics"
                            description="Helps us understand how visitors use the site so we can improve it. (Google Analytics, Vercel Speed Insights.)"
                            checked={cats.analytics}
                            onChange={(v) => setCats((p) => ({ ...p, analytics: v }))}
                        />
                        <CategoryRow
                            title="Marketing"
                            description="Personalized job recommendations and advertising relevance. (Currently no advertising partners; reserved for future use.)"
                            checked={cats.marketing}
                            onChange={(v) => setCats((p) => ({ ...p, marketing: v }))}
                        />
                        <div className="flex justify-end mt-3">
                            <button
                                type="button"
                                onClick={savePreferences}
                                className={`${CONSENT_BUTTON_BASE} px-5 py-2 font-semibold text-white`}
                                style={{ background: 'linear-gradient(135deg, #F472B6, #BE185D)' }}
                            >
                                Save Preferences
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Per-category row ───────────────────────────────────────────────
interface CategoryRowProps {
    title: string;
    description: string;
    checked: boolean;
    locked?: boolean;
    onChange?: (next: boolean) => void;
}

function CategoryRow({ title, description, checked, locked = false, onChange }: CategoryRowProps) {
    const id = `consent-cat-${title.toLowerCase()}`;
    return (
        <div className="flex items-start justify-between gap-4 py-2">
            <label htmlFor={id} className="flex-1 cursor-pointer">
                <div className="text-sm font-semibold" style={{ color: '#3D2E24' }}>{title}</div>
                <div className="text-xs mt-0.5" style={{ color: '#7A6A62' }}>{description}</div>
            </label>
            <ConsentToggle
                id={id}
                checked={checked}
                disabled={locked}
                onChange={onChange ?? (() => { /* locked */ })}
            />
        </div>
    );
}

// ─── Toggle switch ──────────────────────────────────────────────────
interface ConsentToggleProps {
    id: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
}

function ConsentToggle({ id, checked, disabled = false, onChange }: ConsentToggleProps) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            // 44x44 hit area (WCAG 2.5.5); the visible 36x20 track is centred
            // inside it, so the switch looks exactly as before.
            style={{
                width: CONSENT_SWITCH_TAP_TARGET_PX,
                height: CONSENT_SWITCH_TAP_TARGET_PX,
                padding: 0,
                border: 'none',
                background: 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                flexShrink: 0,
            }}
        >
            <span
                aria-hidden
                style={{
                    width: 36,
                    height: 20,
                    borderRadius: 999,
                    border: '1px solid rgba(90,74,66,0.20)',
                    backgroundColor: checked ? '#BE185D' : '#EDE7E0',
                    position: 'relative',
                    boxSizing: 'border-box',
                    transition: 'background-color 0.15s ease',
                }}
            >
                <span
                    style={{
                        position: 'absolute',
                        top: 1,
                        left: checked ? 17 : 1,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        backgroundColor: '#FFFFFF',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                        transition: 'left 0.15s ease',
                    }}
                />
            </span>
        </button>
    );
}
