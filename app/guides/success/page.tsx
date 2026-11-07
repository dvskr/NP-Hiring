'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle, Loader2, Mail } from 'lucide-react';
import { brand } from '@/config/brand';
import { StickerStyles } from '@/components/sticker';
import GuideCover from '@/components/guides/GuideCover';
import { GUIDES_CSS } from '@/components/guides/styles';
import { GUIDES, isGuideSlug, type GuideSlug } from '@/lib/guides/catalog';

/** This tab's guide checkout session id, kept once it leaves the address bar. */
const SESSION_STORAGE_KEY = 'np_guide_checkout_session_id';
const MAX_ATTEMPTS = 5;
const RETRY_MS = 2000;
/**
 * The webhook sends the delivery email, usually within seconds of payment.
 * Until it has, the page asks again this often, this many times (about 45
 * seconds in all).
 */
const EMAIL_POLL_MS = 3000;
const EMAIL_POLLS = 15;

/**
 * The Checkout session id from ?session_id=, moved into this tab's session
 * storage and out of the address before any analytics tag can read it. A
 * refresh in this tab finds it again in storage.
 */
function takeCheckoutSessionId(storageKey: string): string | null {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('session_id');
    if (fromUrl) {
        try {
            window.sessionStorage.setItem(storageKey, fromUrl);
        } catch {
            // Storage blocked: a refresh sends the reader to their library and email link.
        }
        url.searchParams.delete('session_id');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        return fromUrl;
    }
    try {
        return window.sessionStorage.getItem(storageKey);
    } catch {
        return null;
    }
}

interface Verified {
    readonly guides: readonly GuideSlug[];
    readonly emailed: boolean;
    readonly inLibrary: boolean;
    /** Not emailed yet, and the page is still asking. */
    readonly emailWaiting: boolean;
}

type ViewState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly result: Verified }
    | { readonly kind: 'error'; readonly message: string };

interface VerifyAnswer {
    readonly paid?: boolean;
    readonly guides?: string[];
    readonly emailed?: boolean;
    readonly inLibrary?: boolean;
    readonly error?: string;
}

const noteStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: '8px', textAlign: 'left',
    fontSize: '13.5px', color: '#5A4A42', margin: 0, lineHeight: 1.55, maxWidth: '460px',
};

function ReadyView({ result }: { readonly result: Verified }) {
    const single = result.guides.length === 1;
    const noun = single ? 'guide' : 'guides';
    return (
        <div style={{ display: 'grid', justifyItems: 'center', gap: '18px' }}>
            <CheckCircle size={40} style={{ color: '#BE185D' }} aria-hidden="true" />
            <h1 className="stk-h2 font-heading">{single ? 'Your guide is ready' : 'Your guides are ready'}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px' }} aria-hidden="true">
                {result.guides.map((slug) => (
                    <GuideCover key={slug} slug={slug} width={result.guides.length > 3 ? 64 : 88} />
                ))}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '14px', color: '#2b1a1e', display: 'grid', gap: '4px' }}>
                {result.guides.map((slug) => <li key={slug}>{GUIDES[slug].title}</li>)}
            </ul>
            {result.inLibrary ? (
                <Link href="/guides/library" className="gd-btn gd-btn-auto">
                    Open your library <ArrowRight size={16} aria-hidden="true" />
                </Link>
            ) : (
                <p style={{ fontSize: '15px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                    Open the link in your purchase email to download your {noun} on this device.
                </p>
            )}
            {result.emailed ? (
                <p style={noteStyle}>
                    <Mail size={16} style={{ color: '#BE185D', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                    We emailed you a private link to your library. Keep it: it opens your {noun} on any device.
                </p>
            ) : result.emailWaiting ? (
                <p style={noteStyle}>
                    <Loader2 size={16} className="animate-spin" style={{ color: '#BE185D', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                    Sending your library email.
                </p>
            ) : (
                <p style={noteStyle}>
                    <Mail size={16} style={{ color: '#B45309', flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
                    <span>
                        We could not send your library email yet and will keep trying. If it has not arrived in a few hours, write to{' '}
                        <a href={`mailto:${brand.email.support}`} className="stk-link" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '13.5px' }}>{brand.email.support}</a> with your receipt.
                    </span>
                </p>
            )}
        </div>
    );
}

export default function GuidesSuccessPage() {
    const [state, setState] = useState<ViewState>({ kind: 'loading' });

    useEffect(() => {
        const sessionId = takeCheckoutSessionId(SESSION_STORAGE_KEY);
        if (!sessionId) {
            window.location.href = '/guides/library';
            return;
        }

        let cancelled = false;
        let attempts = 0;
        let emailPolls = 0;
        let shown: Verified | null = null;
        let retry: ReturnType<typeof setTimeout> | null = null;

        const show = (result: Verified) => {
            shown = result;
            setState({ kind: 'ready', result });
        };

        // Once the guides are shown, a failed check never replaces them: the
        // page only stops asking about the email, and says so.
        const askAgainForEmail = () => {
            if (!shown) return;
            if (emailPolls >= EMAIL_POLLS) {
                show({ ...shown, emailWaiting: false });
                return;
            }
            emailPolls += 1;
            retry = setTimeout(tick, EMAIL_POLL_MS);
        };

        const tick = async () => {
            attempts += 1;
            try {
                const res = await fetch(`/api/guides/verify?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
                const data = (await res.json().catch(() => ({}))) as VerifyAnswer;
                if (cancelled) return;
                if (res.ok && data.paid === true) {
                    const emailed = data.emailed === true;
                    show({
                        guides: (data.guides ?? []).filter(isGuideSlug),
                        emailed,
                        inLibrary: data.inLibrary === true,
                        emailWaiting: !emailed,
                    });
                    if (!emailed) askAgainForEmail();
                    return;
                }
                if (shown) {
                    askAgainForEmail();
                    return;
                }
                if (res.status >= 500 && attempts < MAX_ATTEMPTS) {
                    retry = setTimeout(tick, RETRY_MS);
                    return;
                }
                setState({ kind: 'error', message: data.error ?? 'We could not confirm this checkout.' });
            } catch {
                if (cancelled) return;
                if (shown) {
                    askAgainForEmail();
                    return;
                }
                if (attempts < MAX_ATTEMPTS) {
                    retry = setTimeout(tick, RETRY_MS);
                    return;
                }
                setState({ kind: 'error', message: 'We could not reach the server to confirm your payment. Refresh this page in a moment.' });
            }
        };

        tick();
        return () => {
            cancelled = true;
            if (retry) clearTimeout(retry);
        };
    }, []);

    return (
        <>
            <StickerStyles />
            <style>{GUIDES_CSS}</style>
            <div className="stk-stage stk-stage-grid" style={{ minHeight: '70vh' }}>
                {/* One polite live region, so the result is announced when it replaces the spinner. */}
                <div aria-live="polite" className="stk-card stk-static" style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 28px', textAlign: 'center', height: 'auto' }}>
                    {state.kind === 'loading' && (
                        <div style={{ display: 'grid', justifyItems: 'center', gap: '14px' }}>
                            <Loader2 size={36} className="animate-spin" style={{ color: '#BE185D' }} aria-hidden="true" />
                            <p style={{ fontSize: '16px', color: '#2b1a1e', margin: 0 }}>Confirming your payment and preparing your guides</p>
                        </div>
                    )}

                    {state.kind === 'error' && (
                        <div role="alert" style={{ display: 'grid', justifyItems: 'center', gap: '14px' }}>
                            <AlertTriangle size={36} style={{ color: '#B45309' }} aria-hidden="true" />
                            <h1 className="stk-h2 font-heading">We could not confirm your purchase</h1>
                            <p style={{ fontSize: '15px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>{state.message}</p>
                            <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                                If you were charged, your library link is on its way by email. You can also write to{' '}
                                <a href={`mailto:${brand.email.support}`} className="stk-link" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '14px' }}>{brand.email.support}</a> with your receipt.
                            </p>
                            <Link href="/guides" className="stk-link">Back to the guides</Link>
                        </div>
                    )}

                    {state.kind === 'ready' && <ReadyView result={state.result} />}
                </div>
            </div>
        </>
    );
}
