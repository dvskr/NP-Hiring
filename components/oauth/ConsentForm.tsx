'use client';

/**
 * The consent card of /oauth/authorize (design 2.5): who is asking, the
 * signed-in account, what the app may do, and Allow or Cancel.
 *
 * Allow and Cancel POST JSON to /oauth/authorize/decision and then navigate
 * to the redirectTo it answers. A form POST cannot be used: the site CSP's
 * form-action 'self' also applies to the redirect after a form POST, so a
 * 303 to the app would be blocked.
 *
 * "Use a different account": the site has no sign-out URL, so the session
 * ends here (this browser only) and the visitor signs in again, returning
 * to this page.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { brand } from '@/config/brand';
import { createClient } from '@/lib/supabase/client';

export interface ConsentFormProps {
    clientName: string;
    /** The redirect URI's host, or "this computer" for a loopback client. */
    redirectHost: string;
    email: string;
    /** The consent wording of each requested scope. */
    permissions: readonly string[];
    /** The authorization parameters the page validated, sent back as signed. */
    params: Readonly<Record<string, string | undefined>>;
    csrf: string;
}

type Pending = 'allow' | 'deny' | 'switch' | null;

const DECISION_URL = '/oauth/authorize/decision';
const FAILURE_MESSAGE = 'Something went wrong. Reload the page and try again.';
const BERRY = '#BE185D';

/** The redirect target the decision route answered, when it is an http(s) URL. */
function readRedirectTo(body: unknown): string | null {
    if (body === null || typeof body !== 'object') return null;
    const value = (body as { redirectTo?: unknown }).redirectTo;
    return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

const headingStyle: React.CSSProperties = {
    fontSize: '26px',
    fontWeight: 800,
    color: '#1A2E35',
    fontFamily: 'var(--font-lora), Georgia, serif',
    lineHeight: 1.25,
    letterSpacing: '-0.5px',
    margin: '0 0 6px',
    textAlign: 'center',
    overflowWrap: 'anywhere',
};

const cardStyle: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid #E2E8F0',
    padding: '24px',
};

const buttonBase: React.CSSProperties = {
    flex: 1,
    minHeight: '44px',
    padding: '12px 20px',
    borderRadius: '14px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
};

const textButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: '12px 0',
    minHeight: '44px',
    fontSize: '14px',
    fontWeight: 600,
    color: BERRY,
    cursor: 'pointer',
};

export default function ConsentForm({ clientName, redirectHost, email, permissions, params, csrf }: ConsentFormProps): React.JSX.Element {
    const [pending, setPending] = useState<Pending>(null);
    const [failed, setFailed] = useState(false);
    const busy = pending !== null;

    async function decide(decision: 'allow' | 'deny'): Promise<void> {
        if (busy) return;
        setPending(decision);
        setFailed(false);
        try {
            const response = await fetch(DECISION_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params, decision, csrf }),
            });
            const target = response.ok ? readRedirectTo(await response.json()) : null;
            if (!target) throw new Error(`decision answered ${response.status}`);
            // Stay busy: the page is leaving.
            window.location.assign(target);
        } catch {
            setPending(null);
            setFailed(true);
        }
    }

    async function useDifferentAccount(): Promise<void> {
        if (busy) return;
        setPending('switch');
        setFailed(false);
        const back = `${window.location.pathname}${window.location.search}`;
        try {
            const { error } = await createClient().auth.signOut({ scope: 'local' });
            if (error) throw error;
        } catch {
            // Still signed in: the sign-in page would send the visitor straight back here.
            setPending(null);
            setFailed(true);
            return;
        }
        window.location.assign(`/login?next=${encodeURIComponent(back)}`);
    }

    return (
        <div>
            <h1 style={headingStyle}>Allow {clientName} to use your {brand.name} account?</h1>
            <p style={{ fontSize: '14px', color: '#4B5E68', margin: '0 0 18px', textAlign: 'center', overflowWrap: 'anywhere' }}>
                {clientName} at {redirectHost}
            </p>

            <div style={cardStyle}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: '12px', paddingBottom: '6px', borderBottom: '1px solid #E2E8F0' }}>
                    <span style={{ fontSize: '14px', color: '#1A2E35', overflowWrap: 'anywhere' }}>Signed in as {email}</span>
                    <button type="button" onClick={useDifferentAccount} disabled={busy} style={{ ...textButtonStyle, cursor: busy ? 'not-allowed' : 'pointer' }}>
                        Use a different account
                    </button>
                </div>

                <ul aria-label="Permissions" style={{ listStyle: 'none', margin: '16px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {permissions.map((permission) => (
                        <li key={permission} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14px', color: '#1A2E35', lineHeight: 1.5 }}>
                            <Check aria-hidden="true" size={18} style={{ color: BERRY, flexShrink: 0, marginTop: '1px' }} />
                            <span>{permission}</span>
                        </li>
                    ))}
                </ul>

                <p style={{ fontSize: '13px', color: '#4B5E68', lineHeight: 1.6, margin: '0 0 6px' }}>
                    You can remove access at any time in Settings, under Account.
                </p>
                <p style={{ fontSize: '13px', margin: '0 0 18px', display: 'flex', gap: '16px' }}>
                    <Link href="/privacy#ai-apps" style={{ color: BERRY, fontWeight: 600 }}>Privacy Policy</Link>
                    <Link href="/terms" style={{ color: BERRY, fontWeight: 600 }}>Terms</Link>
                </p>

                {failed && (
                    <p role="alert" style={{ fontSize: '13px', color: '#B91C1C', background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: '12px', padding: '10px 12px', margin: '0 0 14px' }}>
                        {FAILURE_MESSAGE}
                    </p>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    <button
                        type="button"
                        onClick={() => decide('deny')}
                        disabled={busy}
                        style={{ ...buttonBase, background: '#FFFFFF', color: '#1A2E35', border: '1.5px solid #D1DBE0', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy && pending !== 'deny' ? 0.6 : 1 }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => decide('allow')}
                        disabled={busy}
                        aria-busy={pending === 'allow'}
                        style={{ ...buttonBase, background: BERRY, color: '#FFFFFF', border: `1.5px solid ${BERRY}`, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy && pending !== 'allow' ? 0.6 : 1 }}
                    >
                        Allow
                    </button>
                </div>
            </div>
        </div>
    );
}
