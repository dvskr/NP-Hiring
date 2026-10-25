'use client';

/**
 * /employer/post-pack?session_id=cs_... — what the buyer is told on the way
 * back from the 5-post pack's Stripe Checkout (2027 re-price, phase 3).
 *
 * GET /api/verify-pack-session answers for the signed-in buyer only (401 /
 * 403 otherwise) and records a paid pack the webhook has not yet recorded
 * (its self-heal), so:
 *   paid, with the pack  → ready: the posts left and the date to use them by
 *   paid, no pack yet    → asked again a few times, then "payment received"
 *   processing           → a delayed payment (bank debit) is settling
 *   unpaid               → the checkout was not completed
 * Once the pack is ready the server page is refreshed, so its list of the
 * account's packs includes it.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { config } from '@/lib/config';
import { packUseByLabel } from '@/lib/pricing-copy';

interface VerifiedPack {
  creditsTotal: number;
  creditsRemaining: number;
  expiresAt: string;
}

type ReturnState =
  | { kind: 'checking' }
  | { kind: 'ready'; pack: VerifiedPack }
  | { kind: 'recording' }
  | { kind: 'processing' }
  | { kind: 'unpaid' }
  | { kind: 'error'; message: string };

/** Answers asked for while a paid session's pack is not on the books yet. */
const MAX_ATTEMPTS = 5;
const RETRY_MS = 2000;

const panel: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px', border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8)',
  padding: '22px 24px', marginBottom: '20px', display: 'flex', gap: '14px', alignItems: 'flex-start',
};

export default function PackCheckoutReturn({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ReturnState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const check = async () => {
      try {
        const res = await fetch(`/api/verify-pack-session?session_id=${encodeURIComponent(sessionId)}`);
        const data = (await res.json().catch(() => ({}))) as { status?: string; pack?: VerifiedPack | null; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: 'error', message: data.error || 'We could not check this purchase.' });
          return;
        }
        if (data.status === 'paid' && data.pack) {
          setState({ kind: 'ready', pack: data.pack });
          router.refresh();
          return;
        }
        if (data.status === 'paid') {
          attempts += 1;
          if (attempts < MAX_ATTEMPTS) {
            setTimeout(() => void check(), RETRY_MS);
            return;
          }
          setState({ kind: 'recording' });
          return;
        }
        setState({ kind: data.status === 'processing' ? 'processing' : 'unpaid' });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'We could not reach the server to check this purchase.' });
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [sessionId, router]);

  if (state.kind === 'checking') {
    return (
      <div role="status" style={panel}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#BE185D', flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1A2E35' }}>Checking your purchase…</p>
      </div>
    );
  }

  if (state.kind === 'ready') {
    return (
      <div role="status" style={{ ...panel, border: '1px solid rgba(16,185,129,0.3)' }}>
        <CheckCircle size={22} style={{ color: '#059669', flexShrink: 0 }} />
        <div>
          <p style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 800, color: '#1A2E35' }}>Your {config.packPosts}-post pack is ready</p>
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#5A4A42' }}>
            {state.pack.creditsRemaining} of {state.pack.creditsTotal} posts left, to use by {packUseByLabel(new Date(state.pack.expiresAt))}.
          </p>
          <Link href="/post-job" style={{ fontSize: '14px', fontWeight: 700, color: '#BE185D' }}>Post a Job</Link>
        </div>
      </div>
    );
  }

  const message = {
    recording: { heading: 'Payment received', detail: 'Your posts will show here shortly.' },
    processing: { heading: 'Your payment is processing', detail: 'Your posts will show here once it clears.' },
    unpaid: { heading: 'This checkout was not completed', detail: 'No payment was taken.' },
    error: { heading: 'We could not check this purchase', detail: state.kind === 'error' ? state.message : '' },
  }[state.kind];
  const Icon = state.kind === 'recording' || state.kind === 'processing' ? Clock : AlertTriangle;

  return (
    <div role="status" style={panel}>
      <Icon size={22} style={{ color: state.kind === 'recording' || state.kind === 'processing' ? '#B45309' : '#DC2626', flexShrink: 0 }} />
      <div>
        <p style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 800, color: '#1A2E35' }}>{message.heading}</p>
        <p style={{ margin: 0, fontSize: '14px', color: '#5A4A42' }}>{message.detail}</p>
      </div>
    </div>
  );
}
