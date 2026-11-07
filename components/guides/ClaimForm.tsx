'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import { trackEmailSubscribe, trackGuideClaim } from '@/lib/analytics';

/** The longest address the claim route accepts (app/api/guides/claim). */
const MAX_EMAIL_LENGTH = 254;
/** The email lead source the claim route records for a newsletter opt-in. */
const NEWSLETTER_SOURCE = 'guide_claim';

interface ClaimFormProps {
    readonly product: string;
    /** The button label: guidePriceCopy(product, now).cta, decided by the page. */
    readonly cta: string;
}

type ClaimState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'pending' }
    | { readonly kind: 'sent'; readonly email: string; readonly inLibrary: boolean }
    | { readonly kind: 'error'; readonly message: string };

interface ClaimAnswer {
    readonly ok?: boolean;
    readonly emailed?: boolean;
    readonly inLibrary?: boolean;
    readonly error?: string;
    readonly code?: string;
}

/** What to tell the reader when the claim route refused. */
function refusal(status: number, answer: ClaimAnswer | null): string {
    if (answer?.code === 'PROMO_ENDED') return 'This guide is no longer free to claim. Refresh the page to see its price.';
    if (status === 429) return 'Too many requests from this connection. Please wait a minute and try again.';
    return answer?.error ?? 'We could not add the guide. Please try again.';
}

/** The state an accepted claim leads to: the link went by email, or (for the address's signed-in owner) the guides are in the library. */
function accepted(answer: ClaimAnswer, email: string): ClaimState {
    const inLibrary = answer.inLibrary === true;
    if (answer.emailed === true || inLibrary) return { kind: 'sent', email, inLibrary };
    return { kind: 'error', message: 'We could not send the email. Please try again in a few minutes.' };
}

/**
 * The promo action: an email address, an unticked newsletter box and the
 * copy's button. POST /api/guides/claim records the claim and emails the
 * library link; only a reader signed in with that address gets the guides in
 * this browser at once. The route checks the request's Origin
 * (lib/csrf.ts), which a same-origin fetch sends on its own, so the form
 * sends no token of its own.
 */
export default function ClaimForm({ product, cta }: ClaimFormProps) {
    const inputId = useId();
    const [email, setEmail] = useState('');
    const [newsletter, setNewsletter] = useState(false);
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
                body: JSON.stringify({ product, email: address, newsletter }),
            });
            const answer = (await res.json().catch(() => null)) as ClaimAnswer | null;
            if (!res.ok || answer?.ok !== true) {
                setState({ kind: 'error', message: refusal(res.status, answer) });
                return;
            }
            trackGuideClaim(product);
            if (newsletter) trackEmailSubscribe(NEWSLETTER_SOURCE);
            setState(accepted(answer, address));
        } catch {
            setState({ kind: 'error', message: 'We could not reach the server. Check your connection and try again.' });
        }
    };

    if (state.kind === 'sent') {
        return (
            <div className="gd-sent" role="status">
                {state.inLibrary ? (
                    <>
                        <p>Your guides are in your library.</p>
                        <Link href="/guides/library" className="stk-link">
                            Open your library <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                    </>
                ) : (
                    <p>Check {state.email} for your download link.</p>
                )}
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
            <label className="gd-addon">
                <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} disabled={pending} />
                <span>Send me career tips, salary insights, and market updates.</span>
            </label>
            <button type="submit" className="gd-btn" disabled={pending}>
                {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                {cta}
                {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
            {state.kind === 'error' && <p role="alert" className="gd-error">{state.message}</p>}
        </form>
    );
}
