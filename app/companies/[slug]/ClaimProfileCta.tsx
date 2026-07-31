'use client';

import { useState, useEffect, useId } from 'react';
import { BadgeCheck, Building2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * "Claim this profile" affordance for /companies/[slug].
 *
 * WHY A CLIENT COMPONENT. The profile page is ISR-cached (`revalidate = 3600`)
 * and that cache is shared by every visitor including Googlebot. Reading the
 * session on the server would either opt the whole route out of ISR — the
 * regression the `revalidate` comment at the top of page.tsx exists to prevent —
 * or bake one visitor's auth state into a page served to everyone. So the page
 * ships one identical HTML shell and this component resolves the viewer
 * client-side, exactly as components/ReportJobButton.tsx does on the equally
 * cached job-detail page.
 *
 * WHAT IT PROMISES. Nothing but "we will look at this". Submitting writes a
 * pending CompanyClaim row and changes no public pixel; only an admin approving
 * it at /admin/company-claims stamps Company.claimVerifiedAt and lights the
 * Claimed badge. The copy below says that in those words, because a claim CTA
 * that implies instant control over an employer's public page would be making a
 * promise the flow deliberately does not keep.
 */

interface ClaimProfileCtaProps {
    companyId: string;
    companyName: string;
    /** Path to return to after signing in. */
    profilePath: string;
}

type Phase = 'idle' | 'form' | 'submitting' | 'success' | 'error';

const MAX_NOTE = 1000;
const MAX_ROLE = 120;

const cardStyle: React.CSSProperties = {
    borderRadius: '16px',
    padding: '20px 22px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px dashed var(--border-color)',
};

const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: '10px',
    fontSize: '14px',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    outline: 'none',
};

export default function ClaimProfileCta({ companyId, companyName, profilePath }: ClaimProfileCtaProps) {
    const [phase, setPhase] = useState<Phase>('idle');
    const [signedIn, setSignedIn] = useState<boolean | null>(null);
    const [role, setRole] = useState('');
    const [note, setNote] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const fieldId = useId();

    useEffect(() => {
        let cancelled = false;
        const supabase = createClient();
        supabase.auth
            .getUser()
            .then(({ data: { user } }) => {
                if (!cancelled) setSignedIn(!!user);
            })
            .catch(() => {
                // Treat an auth-infra failure as "signed out": the sign-in path
                // still works, and a false "you're signed in" would send the
                // visitor into a form that can only 401.
                if (!cancelled) setSignedIn(false);
            });
        return () => { cancelled = true; };
    }, []);

    const submit = async () => {
        setPhase('submitting');
        setErrorMsg('');
        try {
            const res = await fetch('/api/companies/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId,
                    claimantRole: role.trim() || undefined,
                    note: note.trim() || undefined,
                }),
            });
            const data = await res.json().catch(() => ({} as { error?: string }));

            if (res.ok) {
                setPhase('success');
                return;
            }
            if (res.status === 401) {
                setPhase('error');
                setErrorMsg('Please sign in with your employer account to claim this profile.');
                setSignedIn(false);
                return;
            }
            if (res.status === 403) {
                setPhase('error');
                setErrorMsg('Profile claims come from employer accounts. Switch to (or create) your employer account and try again.');
                return;
            }
            setPhase('error');
            setErrorMsg(data.error || 'Could not submit your claim. Please try again.');
        } catch {
            setPhase('error');
            setErrorMsg('Network error — please try again.');
        }
    };

    if (phase === 'success') {
        return (
            <section aria-labelledby={`${fieldId}-claim-heading`} style={cardStyle}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <CheckCircle2 size={18} style={{ color: '#16A34A', flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <h2 id={`${fieldId}-claim-heading`} className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Claim submitted
                        </h2>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Our team reviews claims by hand. Nothing on this page changes until a
                            reviewer approves it — if they do, a &ldquo;Claimed by employer&rdquo; badge
                            appears here.
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section aria-labelledby={`${fieldId}-claim-heading`} style={cardStyle}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Building2 size={18} style={{ color: '#BE185D', flexShrink: 0, marginTop: 3 }} />
                <div className="flex-1 min-w-0">
                    <h2 id={`${fieldId}-claim-heading`} className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Work at {companyName}?
                    </h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        This profile was built from public job postings. If you hire here, you can ask
                        us to recognise you as its owner. A reviewer checks every claim by hand, and
                        nothing on this page changes unless one is approved.
                    </p>

                    {signedIn === false && (
                        <a
                            href={`/login?redirectTo=${encodeURIComponent(profilePath)}`}
                            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg text-sm font-semibold"
                            style={{ backgroundColor: '#BE185D', color: '#fff', textDecoration: 'none' }}
                        >
                            <BadgeCheck size={15} />
                            Sign in to claim this profile
                        </a>
                    )}

                    {signedIn === true && phase === 'idle' && (
                        <button
                            type="button"
                            onClick={() => setPhase('form')}
                            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg text-sm font-semibold"
                            style={{ backgroundColor: '#BE185D', color: '#fff', border: 'none', cursor: 'pointer' }}
                        >
                            <BadgeCheck size={15} />
                            Claim this profile
                        </button>
                    )}

                    {signedIn === true && (phase === 'form' || phase === 'submitting' || phase === 'error') && (
                        <div className="mt-4 space-y-3">
                            <div>
                                <label htmlFor={`${fieldId}-role`} className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                    Your role at {companyName} <span style={{ fontWeight: 400 }}>(optional)</span>
                                </label>
                                <input
                                    id={`${fieldId}-role`}
                                    type="text"
                                    value={role}
                                    maxLength={MAX_ROLE}
                                    onChange={(e) => setRole(e.target.value)}
                                    placeholder="Talent Acquisition Manager"
                                    disabled={phase === 'submitting'}
                                    style={fieldStyle}
                                />
                            </div>
                            <div>
                                <label htmlFor={`${fieldId}-note`} className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                    Anything that helps us verify you <span style={{ fontWeight: 400 }}>(optional)</span>
                                </label>
                                <textarea
                                    id={`${fieldId}-note`}
                                    value={note}
                                    maxLength={MAX_NOTE}
                                    rows={3}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="A careers page, your team page, or the address we should email."
                                    disabled={phase === 'submitting'}
                                    style={{ ...fieldStyle, resize: 'vertical' }}
                                />
                                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                    We compare your account email&apos;s domain to this employer&apos;s website as one
                                    signal among several. A mismatch is not a rejection — agencies, health
                                    systems and small practices routinely mail from another domain.
                                </p>
                            </div>

                            {phase === 'error' && errorMsg && (
                                <p role="alert" className="text-sm flex items-start gap-1.5" style={{ color: '#DC2626' }}>
                                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                                    <span>{errorMsg}</span>
                                </p>
                            )}

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => void submit()}
                                    disabled={phase === 'submitting'}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
                                    style={{
                                        backgroundColor: '#BE185D', color: '#fff', border: 'none',
                                        cursor: phase === 'submitting' ? 'wait' : 'pointer',
                                        opacity: phase === 'submitting' ? 0.6 : 1,
                                    }}
                                >
                                    {phase === 'submitting'
                                        ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
                                        : <><BadgeCheck size={15} /> Submit claim</>}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setPhase('idle'); setErrorMsg(''); }}
                                    disabled={phase === 'submitting'}
                                    className="px-3 py-2 rounded-lg text-sm font-medium"
                                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
