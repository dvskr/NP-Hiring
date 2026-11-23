import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { brand } from '@/config/brand';
import { ShieldCheck, AlertTriangle, Check, Clock } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/protect';
import { consentPath, loadPendingAuthorization } from '@/lib/mcp/oauth/authorize';
import { cleanDisplayString, describeRedirectTarget, verifiedClientLabel } from '@/lib/mcp/oauth/clients';
import { SCOPE_PERMISSIONS, resourceForUrl, type OAuthScope } from '@/lib/mcp/oauth/config';
import ConsentActions from '@/components/oauth/ConsentActions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // Bare title: the root layout's template appends the brand.
  title: 'Connect an app',
  robots: { index: false, follow: false },
};

const clayShadow =
  '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)';

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 16px',
};

const card: React.CSSProperties = {
  maxWidth: '480px',
  width: '100%',
  background: '#FFFFFF',
  borderRadius: '24px',
  border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: clayShadow,
  padding: '36px 28px',
};

function ExpiredCard() {
  return (
    <div style={page}>
      <div style={{ ...card, textAlign: 'center' }}>
        <Clock size={36} color="#BE185D" aria-hidden="true" style={{ margin: '0 auto 16px' }} />
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>
          This connection link has expired
        </h1>
        <p style={{ fontSize: '15px', color: '#4B5E68', lineHeight: 1.6, margin: '0 0 24px' }}>
          Connection links work for 30 minutes and only once. Go back to ChatGPT or Claude and start the connection again.
        </p>
        <Link href="/ai-apps" style={{ color: '#9D174D', fontWeight: 600, textDecoration: 'none' }}>
          How connecting works
        </Link>
      </div>
    </div>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ req?: string }>;
}) {
  const { req } = await searchParams;
  const pending = await loadPendingAuthorization(req);
  if (!pending) return <ExpiredCard />;

  const resource = resourceForUrl(pending.resource);
  if (!resource) return <ExpiredCard />;

  const returnPath = consentPath(pending.id);
  // The employer connector opens the employer tab of the login page.
  const loginHref = `/login?${resource.id === 'employer' ? 'role=employer&' : ''}redirectTo=${encodeURIComponent(returnPath)}`;
  const current = await getCurrentUser();
  if (!current) redirect(loginHref);

  const target = describeRedirectTarget(pending.redirectUri);
  // Verified only when every address the app registered is Claude's or
  // ChatGPT's own callback; the name it gave itself proves nothing.
  const verifiedAs = verifiedClientLabel(pending.clientRedirectUris);
  const claimedName = cleanDisplayString(pending.clientName, 120) ?? 'Unnamed app';
  const destination = target.local ? `an app on this computer (${target.display})` : target.display;
  const role = current.profile?.role ?? 'job_seeker';
  const canApprove = resource.allowedRoles.includes(role);
  const permissions = SCOPE_PERMISSIONS[resource.scope as OAuthScope] ?? [];

  return (
    <div style={page}>
      <div style={card}>
        <p style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9D174D', margin: '0 0 10px' }}>
          {resource.displayName}
        </p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: '24px', fontWeight: 700, color: '#1A2E35', lineHeight: 1.25, margin: '0 0 14px' }}>
          {verifiedAs
            ? `Allow ${verifiedAs} to use your ${brand.name} account?`
            : `An unverified app wants to use your ${brand.name} account`}
        </h1>

        {verifiedAs ? (
          <p style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px', color: '#065F46', background: '#ECFDF5', borderRadius: '14px', padding: '10px 12px', margin: '0 0 20px' }}>
            <ShieldCheck size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              Verified: this request comes back to {verifiedAs} at <strong>{target.display}</strong>.
            </span>
          </p>
        ) : (
          <p style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '14px', color: '#92400E', background: '#FFFBEB', borderRadius: '14px', padding: '10px 12px', margin: '0 0 20px' }}>
            <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              It calls itself &ldquo;{claimedName}&rdquo;, which nobody has checked, and it will send you to{' '}
              <strong>{destination}</strong>. Only continue if you started this connection yourself, from that app.
            </span>
          </p>
        )}

        <p style={{ fontSize: '14px', color: '#4B5E68', margin: '0 0 8px' }}>It will be able to:</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'grid', gap: '8px' }}>
          {permissions.map((line) => (
            <li key={line} style={{ display: 'flex', gap: '8px', fontSize: '15px', color: '#1A2E35', lineHeight: 1.45 }}>
              <Check size={18} color="#BE185D" aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: '13px', color: '#4B5E68', lineHeight: 1.55, margin: '0 0 20px' }}>
          It never sees your password. What you share in a conversation is also handled under the assistant
          provider&apos;s own terms. You can disconnect it at any time in{' '}
          <Link href="/settings" style={{ color: '#9D174D', fontWeight: 600 }}>Settings</Link>. See our{' '}
          <Link href="/privacy" style={{ color: '#9D174D', fontWeight: 600 }}>Privacy Policy</Link>.
        </p>

        <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '16px', marginBottom: '18px', fontSize: '14px', color: '#4B5E68' }}>
          Signed in as <strong style={{ color: '#1A2E35' }}>{current.user.email}</strong>
        </div>

        {!canApprove && (
          <p role="alert" style={{ fontSize: '14px', color: '#991B1B', background: '#FEF2F2', borderRadius: '14px', padding: '10px 12px', margin: '0 0 16px' }}>
            {resource.displayName} works with employer accounts. Sign in with the account you use to post jobs.
          </p>
        )}

        <ConsentActions
          requestId={pending.id}
          expectedUserId={current.user.id}
          canApprove={canApprove}
          acknowledgement={verifiedAs ? null : `I started this connection myself, from ${destination}.`}
          switchAccountHref={loginHref}
        />
      </div>
    </div>
  );
}
