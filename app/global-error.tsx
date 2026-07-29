'use client';

import { useEffect } from 'react';
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

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  // Same P3 #13 reasoning as app/error.tsx: React boundary errors never reach
  // the browser's global handlers, so without an explicit capture this page
  // was invisible to error monitoring. No-op without a DSN.
  //
  // Same `digest` gate too — a digest means the failure was thrown during
  // server rendering and instrumentation.ts#onRequestError already filed it
  // with a full server stack. The instance that lands here is a redacted copy
  // in another runtime, so the markSentryCaptured dedupe cannot match it and a
  // second capture would double-count one failure. See app/error.tsx.
  useEffect(() => {
    if (error.digest) return;
    captureException(error, { tags: { boundary: 'global-error', origin: 'client' } });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: 'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)' }}>
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
        }}>
          <div style={{ maxWidth: '640px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{
                ...clayCard,
                position: 'relative',
                padding: '50px 40px',
                textAlign: 'center',
                background: 'linear-gradient(145deg, #FFFFFF, #FFF1F2)',
            }}>
                <div style={{
                    width: '72px', height: '72px', borderRadius: '20px',
                    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8), 2px 2px 8px rgba(217,119,6,0.15)',
                    margin: '0 auto 24px',
                    fontSize: '32px'
                }}>
                    ⚠️
                </div>

                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginBottom: '12px' }}>
                    The site failed to load
                </h1>

                <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, maxWidth: '420px', margin: '0 auto 20px' }}>
                    Something broke before the page could render. Reloading usually fixes it.
                    If it keeps happening, email{' '}
                    <a href={`mailto:${brand.email.support}`} style={{ color: '#B45309', fontWeight: 600 }}>
                        {brand.email.support}
                    </a>
                    {/* Gated for the same reason as app/error.tsx: no `digest` means no
                        Reference block below, so the instruction must not promise one. */}
                    {error.digest ? ' and quote the reference below.' : '.'}
                </p>

                {error.digest && (
                    <p style={{
                        fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A',
                        borderRadius: '10px', padding: '8px 12px', display: 'inline-block',
                        margin: '0 auto 26px', wordBreak: 'break-all',
                    }}>
                        Reference: {error.digest}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={reset} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '12px 24px', borderRadius: '16px',
                        fontSize: '15px', fontWeight: 600, color: '#FFFFFF',
                        background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                        boxShadow: '0 4px 12px rgba(190,24,93,0.3), inset 1px 1px 3px rgba(255,255,255,0.3)',
                        border: 'none', cursor: 'pointer', transition: 'all 0.2s ease'
                    }}>
                        ↻ Reload the page
                    </button>
                    <button onClick={() => window.location.href = '/'} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '12px 24px', borderRadius: '16px',
                        fontSize: '15px', fontWeight: 600, color: '#334155',
                        background: '#FFFFFF',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '4px 4px 10px rgba(0,0,0,0.04), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.7)',
                        cursor: 'pointer', transition: 'all 0.2s ease'
                    }}>
                        🏠 Back to Homepage
                    </button>
                </div>
            </div>

            {process.env.NODE_ENV === 'development' && (
                <div style={{
                    ...clayCard,
                    padding: '24px',
                    background: '#FFF5F5',
                    border: '1px solid #FECACA',
                    boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8)',
                    textAlign: 'left'
                }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        Error detail (development only)
                    </h3>
                    <div style={{ padding: '16px', background: '#FEF2F2', borderRadius: '12px', border: '1px dashed #FCA5A5' }}>
                        <p style={{ fontSize: '13px', fontFamily: 'monospace', color: '#B91C1C', wordBreak: 'break-all', margin: 0 }}>
                            {error.message}
                        </p>
                        {error.digest && (
                            <p style={{ fontSize: '11px', fontFamily: 'monospace', color: '#DC2626', marginTop: '12px', opacity: 0.8, margin: '12px 0 0 0' }}>
                                DIGEST: {error.digest}
                            </p>
                        )}
                    </div>
                </div>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
