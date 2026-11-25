'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { VerificationAccount, VerificationIdentity } from '@/lib/admin/employer-verification';

/* Styles matched to admin/company-claims. */
const card: CSSProperties = {
  backgroundColor: '#FAFBF9',
  border: '1px solid rgba(255,255,255,0.7)',
  borderRadius: '18px',
  boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)',
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
};
const heading: CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: CSSProperties = { color: '#6B7F8A', fontSize: 14, lineHeight: 1.6, margin: 0 };
const muted: CSSProperties = { color: '#94A3B8', fontSize: 13 };
const button: CSSProperties = { padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none' };

type BadgeTone = 'green' | 'orange' | 'gray';

const TONES: Record<BadgeTone, { bg: string; text: string }> = {
  green: { bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
  orange: { bg: 'rgba(245,158,11,0.12)', text: '#B45309' },
  gray: { bg: 'rgba(148,163,184,0.12)', text: '#64748B' },
};

function Badge({ text, tone }: { text: string; tone: BadgeTone }) {
  const colors = TONES[tone];
  return (
    <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, backgroundColor: colors.bg, color: colors.text, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function statusOf(identity: VerificationIdentity): { label: string; tone: BadgeTone } {
  if (identity.verified) return { label: 'Verified', tone: 'green' };
  if (identity.copies > 0) return { label: 'Waiting', tone: 'orange' };
  return { label: 'Not verified', tone: 'gray' };
}

function summary(identity: VerificationIdentity): string {
  const posts = plural(identity.livePaidPosts, 'live paid post', 'live paid posts');
  const copies = plural(identity.copies, 'free copy', 'free copies');
  const hidden = identity.livePaidPosts === 0 ? '' : `, ${copies} ${identity.verified ? 'hidden now' : 'would be hidden'}`;
  return `${posts}${hidden}. ${plural(identity.feedListings, 'free listing', 'free listings')} published under this name.`;
}

interface SaveResponse {
  success?: boolean;
  error?: string;
  syncFailed?: boolean;
}

function IdentityRow({ account, identity }: { account: VerificationAccount; identity: VerificationIdentity }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const status = statusOf(identity);
  const name = identity.names[0] ?? identity.orgKey;

  async function change(verified: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/verify-employers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseId: account.supabaseId, orgKey: identity.orgKey, verified }),
      });
      const body = (await res.json().catch(() => null)) as SaveResponse | null;
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'Could not save the change. Try again.');
        return;
      }
      if (body.syncFailed) setNotice('Saved. The listings and the check update at the next hourly run.');
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid #E8ECF0', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ color: '#1A2E35', fontSize: 15 }}>{identity.names.join(' / ') || identity.orgKey}</strong>
        <Badge text={status.label} tone={status.tone} />
      </div>
      <p style={{ ...sub, fontSize: 13 }}>{summary(identity)}</p>
      {identity.samples.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: '#1A2E35', fontSize: 13, lineHeight: 1.6 }}>
          {identity.samples.map((sample, index) => (
            <li key={index}>
              {sample.title}
              {sample.location ? `, ${sample.location}` : ''}
              <span style={muted}>{sample.applyHost ? ` (applies at ${sample.applyHost})` : ' (no apply link)'}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {identity.verified ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(false)}
            style={{ ...button, background: 'rgba(239,68,68,0.1)', color: '#EF4444', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving' : 'Revoke verification'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change(true)}
            style={{ ...button, background: '#BE185D', color: '#FFFFFF', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving' : `Confirm this account is ${name}`}
          </button>
        )}
        {error && <span role="alert" style={{ color: '#EF4444', fontSize: 13 }}>{error}</span>}
        {notice && <span role="status" style={{ color: '#B45309', fontSize: 13 }}>{notice}</span>}
      </div>
    </div>
  );
}

interface VerifyEmployersClientProps {
  accounts: VerificationAccount[];
  loadError: string | null;
}

export default function VerifyEmployersClient({ accounts, loadError }: VerifyEmployersClientProps) {
  const waiting = accounts.filter((account) => account.identities.some((identity) => !identity.verified && identity.copies > 0)).length;
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 16px 48px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ ...heading, fontSize: 28, margin: 0 }}>Verify Employers</h1>
        <p style={{ ...sub, maxWidth: 720 }}>
          An employer account types its own company name, so the name proves nothing. Until you confirm an account is the
          employer it named, its posts show no Verified employer check and its paid post leaves up the copies of that
          role gathered from other job boards. Compare the domain the account signs in with against where the
          employer&apos;s own listings send applicants before you confirm.
        </p>
        <p style={{ ...sub, maxWidth: 720 }}>
          A post counts toward a name only when it was made from the company email domain the account signs in with, so
          accounts on free mail providers do not appear here. This page is separate from Profile Claims, which verifies a
          claim on a company profile.
        </p>
        {!loadError && (
          <p style={{ margin: 0, color: '#1A2E35', fontSize: 14, fontWeight: 600 }}>
            {waiting === 0 ? 'Nothing is waiting.' : `${plural(waiting, 'account has', 'accounts have')} paid posts waiting.`}
          </p>
        )}
      </header>
      {loadError && <div role="alert" style={{ ...card, color: '#EF4444', fontSize: 14 }}>{loadError}</div>}
      {!loadError && accounts.length === 0 && (
        <div style={{ ...card, ...muted, fontSize: 14 }}>No employer account has posted under a name with free listings on the board.</div>
      )}
      {accounts.map((account) => (
        <section key={account.supabaseId} style={card} aria-label={account.email}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: '#1A2E35', fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{account.email}</span>
            <span style={muted}>
              Signs in with: {account.accountDomain ?? 'an address with no domain on record'}
              {account.profileCompany ? `. Profile company: ${account.profileCompany}` : ''}
            </span>
          </div>
          {account.identities.map((identity) => (
            <IdentityRow key={identity.orgKey} account={account} identity={identity} />
          ))}
        </section>
      ))}
    </div>
  );
}
