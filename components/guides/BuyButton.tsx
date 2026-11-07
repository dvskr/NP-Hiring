'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

/** The checkout add-on, offered as a checkbox above the button. */
export interface AddOnOffer {
    readonly title: string;
    /** The checkbox's price text, e.g. "$5" (formatPrice(ADD_ON.priceCents)). */
    readonly price: string;
    /** The button label with the add-on included: guidePriceCopy for the combined amount, decided by the page. */
    readonly ctaWithAddOn: string;
}

interface BuyButtonProps {
    readonly product: string;
    /** The button label: guidePriceCopy(product, now).cta, decided by the page. */
    readonly label: string;
    /** Offered when the product does not already include the add-on guide. */
    readonly addOn?: AddOnOffer | null;
    readonly variant?: 'primary' | 'secondary';
}

interface CheckoutAnswer {
    readonly url?: string;
    readonly error?: string;
}

/**
 * The paid action: POST /api/guides/checkout with the product slug (never an
 * amount) and whether the add-on is wanted, then off to Stripe Checkout.
 * The route checks the request's Origin (lib/csrf.ts), which a same-origin
 * fetch sends on its own.
 */
export default function BuyButton({ product, label, addOn = null, variant = 'primary' }: BuyButtonProps) {
    const [withAddOn, setWithAddOn] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const addOnChosen = Boolean(addOn && withAddOn);

    // Back from Stripe can restore this page from the back/forward cache with
    // the button still in its pending state.
    useEffect(() => {
        const reset = (event: PageTransitionEvent) => {
            if (event.persisted) setPending(false);
        };
        window.addEventListener('pageshow', reset);
        return () => window.removeEventListener('pageshow', reset);
    }, []);

    const buy = async () => {
        setError(null);
        setPending(true);
        try {
            const res = await fetch('/api/guides/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product, addOn: addOnChosen }),
            });
            const answer = (await res.json().catch(() => null)) as CheckoutAnswer | null;
            if (!res.ok || !answer?.url) {
                setError(answer?.error ?? 'Could not start checkout. Please try again.');
                setPending(false);
                return;
            }
            window.location.href = answer.url;
        } catch {
            setError('Could not reach checkout. Check your connection and try again.');
            setPending(false);
        }
    };

    return (
        <div className="gd-action">
            {addOn && (
                <label className="gd-addon">
                    <input type="checkbox" checked={withAddOn} onChange={(event) => setWithAddOn(event.target.checked)} />
                    <span>
                        Add the <strong>{addOn.title}</strong> for {addOn.price}
                    </span>
                </label>
            )}
            <button
                type="button"
                onClick={buy}
                disabled={pending}
                className={variant === 'primary' ? 'gd-btn' : 'gd-btn gd-btn-light'}
            >
                {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                {pending ? 'Opening checkout' : addOnChosen && addOn ? addOn.ctaWithAddOn : label}
                {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
            {error && (
                <p role="alert" className="gd-error">
                    {error}
                </p>
            )}
        </div>
    );
}
