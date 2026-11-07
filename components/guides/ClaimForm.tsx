'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';

/** The longest address the claim route accepts (app/api/guides/claim). */
const MAX_EMAIL_LENGTH = 254;

interface ClaimFormProps {
    readonly product: string;
    /** The button label: guidePriceCopy(product, now).cta, decided by the page. */
    readonly cta: string;
}

type ClaimState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'pending' }
    | { readonly kind: 'sent'; readonly email: string; readonly emailed: boolean }
    | { readonly kind: 'error'; readonly message: string };

interface ClaimAnswer {
    readonly ok?: boolean;
    readonly emailed?: boolean;
    readonly error?: string;
    readonly code?: string;
}

/** What to tell the reader when the claim route refused. */
function refusal(status: number, answer: ClaimAnswer | null): string {
    if (answer?.code === 'PROMO_ENDED') return 'This guide is no longer free to claim. Refresh the page to see its price.';
    if (status === 429) return 'Too many requests from this connection. Please wait a minute and try again.';
    return answer?.error ?? 'We could not add the guide. Please try again.';
}

/**
 * The promo action: an email address and the copy's button. POST
 * /api/guides/claim records the claim, emails the library link and adds the
 * guides to this browser's library cookie. The route checks the request's
 * Origin (lib/csrf.ts), which a same-origin fetch sends on its own, so the
 * form sends no token of its own.
 */
export default function ClaimForm({ product, cta }: ClaimFormProps) {
    const inputId = useId();
    const [email, setEmail] = useState('');
    const [state, setState] = useState<ClaimState>({ kind: 'idle' });

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const address = email.trim();
        if (!address || state.kind === 'pending') return;
        setState({ kind: 'pending' });
        try {
            const res = await fetch('/api/guides/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product, email: address }),
            });
            const answer = (await res.json().catch(() => null)) as ClaimAnswer | null;
            if (!res.ok || answer?.ok !== true) {
                setState({ kind: 'error', message: refusal(res.status, answer) });
                return;
            }
            setState({ kind: 'sent', email: address, emailed: answer.emailed === true });
        } catch {
            setState({ kind: 'error', message: 'We could not reach the server. Check your connection and try again.' });
        }
    };

    if (state.kind === 'sent') {
        return (
            <div className="gd-sent" role="status">
                <p>{state.emailed ? `Sent to ${state.email}` : 'Your guides are in your library.'}</p>
                <Link href="/guides/library" className="stk-link">
                    Open your library <ArrowRight size={14} aria-hidden="true" />
                </Link>
            </div>
        );
    }

    const pending = state.kind === 'pending';
    return (
        <form className="gd-form" onSubmit={submit}>
            <label htmlFor={inputId} className="sr-only">Email address</label>
            <input
                id={inputId}
                className="gd-input"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                required
                maxLength={MAX_EMAIL_LENGTH}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
            />
            <button type="submit" className="gd-btn" disabled={pending}>
                {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                {cta}
                {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
            {state.kind === 'error' && <p role="alert" className="gd-error">{state.message}</p>}
        </form>
    );
}
