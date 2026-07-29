'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';
import { captureException } from '@/lib/sentry';
import { brand } from '@/config/brand';

/* ═══ Clay Tokens ═══ */
const clayShadow = '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)';
const clayCard = {
    background: '#FFFFFF',
    borderRadius: '24px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: clayShadow,
    overflow: 'hidden' as const,
};

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  // P3 #13: this boundary previously only wrote to the browser console while
  // the visible copy claimed the team already knew about the failure — false,
  // because logger.error's Sentry forwarding is server/edge-only
  // (lib/logger.ts bails on `typeof window !== 'undefined'`) and React
  // swallows boundary-caught errors before the browser's global handlers see
  // them. Capturing explicitly is the documented App Router pattern and is a
  // no-op when no DSN is configured — which is exactly why the copy below
  // promises the user nothing about our side and instead hands them the
  // digest to quote at support.
  //
  // GATED ON `digest` to hold this repo's one-event-per-failure invariant
  // (lib/sentry.ts captureException; instrumentation.ts onRequestError). Next
  // attaches `digest` only to errors thrown during SERVER rendering, and those
  // already reached Sentry via onRequestError with a real server stack. What
  // crosses to the browser is a redacted shell ("An error occurred in the
  // Server Components render…") — a different Error object in a different
  // runtime, so the markSentryCaptured dedupe (a marker on the instance) can
  // never see it. Re-capturing here would file a second, strictly worse event
  // for one failure. Digest-less errors are client-origin: nothing else in the
  // stack reports those, which is the gap this boundary exists to close.
  //
  // The gate cannot silently drop a server error into a blind spot, because
  // sentry.server.config.ts falls back to NEXT_PUBLIC_SENTRY_DSN — there is no
  // configuration where the browser can report but the server cannot.
  useEffect(() => {
    if (error.digest) return;
    captureException(error, { tags: { boundary: 'app-error', origin: 'client' } });
  }, [error]);

  return (
    <main style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        fontFamily: 'var(--font-inter), system-ui, sans-serif'
    }}>
        <div style={{ maxWidth: '640px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Main Error Node */}
            <div style={{
                ...clayCard,
                position: 'relative',
                padding: '50px 40px',
                textAlign: 'center',
                background: 'linear-gradient(145deg, #FFFFFF, #FFF1F2)',
            }}>
                <div style={{
                    width: '72px', height: '72px', borderRadius: '20px',
                    background: 'linear-gradient(135deg, #FECDD3, #FDA4AF)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8), 2px 2px 8px rgba(225,29,72,0.15)',
                    margin: '0 auto 24px'
                }}>
                    <AlertTriangle size={36} color="#E11D48" />
                </div>

                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginBottom: '12px' }}>
                    Something went wrong
                </h1>

                <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, maxWidth: '420px', margin: '0 auto 20px' }}>
                    This page didn&apos;t load properly. Trying again usually fixes it. If it
                    keeps happening, email{' '}
                    <a href={`mailto:${brand.email.support}`} style={{ color: '#BE123C', fontWeight: 600 }}>
                        {brand.email.support}
                    </a>
                    {/* The reference is Next's `digest`, which exists ONLY on errors
                        thrown during server rendering. Client-origin failures carry
                        none — and those are precisely the ones this boundary is here
                        for (see the digest gate above) — so the block below does not
                        render for them. The instruction has to be gated on the same
                        condition, or the most common visitor is told to quote an
                        identifier that is nowhere on the page. */}
                    {error.digest ? ' and include the reference below.' : '.'}
                </p>

                {error.digest && (
                    <p style={{
                        fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: '#9F1239', background: '#FFF1F2', border: '1px solid #FECDD3',
                        borderRadius: '10px', padding: '8px 12px', display: 'inline-block',
                        margin: '0 auto 26px', wordBreak: 'break-all',
                    }}>
                        Reference: {error.digest}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={reset} className="clay-btn-primary" style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '12px 24px', borderRadius: '16px',
                        fontSize: '15px', fontWeight: 600, color: '#FFFFFF',
                        background: 'linear-gradient(135deg, #E11D48, #BE123C)',
                        boxShadow: '0 4px 12px rgba(225,29,72,0.3), inset 1px 1px 3px rgba(255,255,255,0.3)',
                        border: 'none', cursor: 'pointer', transition: 'all 0.2s ease'
                    }}>
                        <RefreshCw size={18} />
                        Try again
                    </button>
                    <Link href="/" className="clay-btn-secondary" style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '12px 24px', borderRadius: '16px',
                        fontSize: '15px', fontWeight: 600, color: '#334155',
                        background: '#FFFFFF',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '4px 4px 10px rgba(0,0,0,0.04), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.7)',
                        textDecoration: 'none', transition: 'all 0.2s ease'
                    }}>
                        <Home size={18} />
                        Back to Homepage
                    </Link>
                </div>
            </div>

            {/* Developer diagnostics — dev only; the digest above is the
                production-safe identifier users can quote to support. */}
            {process.env.NODE_ENV === 'development' && (
                <div style={{
                    ...clayCard,
                    padding: '24px',
                    background: '#FFF5F5',
                    border: '1px solid #FECACA',
                    boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8)'
                }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        Error detail (development only)
                    </h3>
                    <div style={{ padding: '16px', background: '#FEF2F2', borderRadius: '12px', border: '1px dashed #FCA5A5' }}>
                        <p style={{ fontSize: '13px', fontFamily: 'monospace', color: '#B91C1C', wordBreak: 'break-all' }}>
                            {error.message}
                        </p>
                        {error.digest && (
                            <p style={{ fontSize: '11px', fontFamily: 'monospace', color: '#DC2626', marginTop: '12px', opacity: 0.8 }}>
                                DIGEST: {error.digest}
                            </p>
                        )}
                    </div>
                </div>
            )}

            
            <style>{`
                .clay-btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(225,29,72,0.4), inset 1px 1px 4px rgba(255,255,255,0.4) !important;
                }
                .clay-btn-secondary:hover {
                    transform: translateY(-2px);
                    box-shadow: 6px 6px 14px rgba(0,0,0,0.06), -3px -3px 8px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.7) !important;
                }
            `}</style>
        </div>
    </main>
  );
}
