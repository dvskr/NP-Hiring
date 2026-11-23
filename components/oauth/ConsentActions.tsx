'use client';

import { useState } from 'react';
import { brand } from '@/config/brand';
import { createClient } from '@/lib/supabase/client';

interface ConsentActionsProps {
  requestId: string;
  /** The account this page was rendered for. A decision from any other session is refused. */
  expectedUserId: string;
  canApprove: boolean;
  /** For an unverified app: a statement the person ticks before Allow works. */
  acknowledgement: string | null;
  /** Login page that returns to this consent request. */
  switchAccountHref: string;
}

type Decision = 'approve' | 'deny';

/**
 * Allow / Cancel for the OAuth consent page.
 *
 * The decision is POSTed with fetch and the browser is then sent on with
 * location.assign, rather than through a form POST that redirects. The site
 * CSP sets form-action 'self', and Chrome applies form-action to the redirect
 * that follows a form submission too, so a form that 303'd to claude.ai or
 * chatgpt.com would be blocked at the last step.
 */
export default function ConsentActions({
  requestId,
  expectedUserId,
  canApprove,
  acknowledgement,
  switchAccountHref,
}: ConsentActionsProps) {
  const [pending, setPending] = useState<Decision | 'switch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const decide = async (decision: Decision) => {
    setPending(decision);
    setError(null);
    try {
      const res = await fetch('/api/oauth/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, expectedUserId }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
      if (!res.ok || !data.redirectTo) {
        setError(data.error ?? 'Something went wrong. Go back to the app and connect again.');
        setPending(null);
        return;
      }
      window.location.assign(data.redirectTo);
    } catch {
      setError(`We could not reach ${brand.name}. Check your connection and try again.`);
      setPending(null);
    }
  };

  const switchAccount = async () => {
    setPending('switch');
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign(switchAccountHref);
    }
  };

  const primary: React.CSSProperties = {
    flex: '1 1 140px',
    padding: '13px 20px',
    borderRadius: '16px',
    border: 'none',
    fontSize: '15px',
    fontWeight: 700,
    color: '#FFFFFF',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
    boxShadow: '0 4px 12px rgba(13,148,136,0.3), inset 1px 1px 3px rgba(255,255,255,0.3)',
    cursor: 'pointer',
  };
  const secondary: React.CSSProperties = {
    flex: '1 1 140px',
    padding: '13px 20px',
    borderRadius: '16px',
    border: '1px solid rgba(0,0,0,0.08)',
    fontSize: '15px',
    fontWeight: 600,
    color: '#4B5E68',
    background: '#FFFFFF',
    cursor: 'pointer',
  };
  const busy = pending !== null;
  const allowBlocked = busy || (acknowledgement !== null && !acknowledged);

  return (
    <div>
      {error && (
        <p role="alert" style={{ fontSize: '14px', color: '#991B1B', background: '#FEF2F2', borderRadius: '14px', padding: '10px 12px', margin: '0 0 14px' }}>
          {error}
        </p>
      )}
      {canApprove && acknowledgement && (
        <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: '#4B5E68', lineHeight: 1.5, margin: '0 0 16px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            disabled={busy}
            style={{ width: '18px', height: '18px', marginTop: '1px', flexShrink: 0, accentColor: '#BE185D' }}
          />
          <span>{acknowledgement}</span>
        </label>
      )}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {canApprove ? (
          <button
            type="button"
            onClick={() => decide('approve')}
            disabled={allowBlocked}
            style={{ ...primary, opacity: allowBlocked ? 0.6 : 1, cursor: allowBlocked ? 'not-allowed' : 'pointer' }}
          >
            {pending === 'approve' ? 'Connecting...' : 'Allow'}
          </button>
        ) : (
          <button type="button" onClick={switchAccount} disabled={busy} style={{ ...primary, opacity: busy ? 0.7 : 1 }}>
            {pending === 'switch' ? 'Signing out...' : 'Use an employer account'}
          </button>
        )}
        <button type="button" onClick={() => decide('deny')} disabled={busy} style={{ ...secondary, opacity: busy ? 0.7 : 1 }}>
          {pending === 'deny' ? 'Cancelling...' : 'Cancel'}
        </button>
      </div>
      {canApprove && (
        <button
          type="button"
          onClick={switchAccount}
          disabled={busy}
          style={{ marginTop: '14px', background: 'none', border: 'none', padding: 0, fontSize: '14px', fontWeight: 600, color: '#BE185D', cursor: 'pointer' }}
        >
          Use a different account
        </button>
      )}
    </div>
  );
}
