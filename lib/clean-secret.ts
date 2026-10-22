/**
 * A secret as the app uses it: trimmed, and undefined when nothing but
 * whitespace was set.
 *
 * A value of spaces passed every "is it set" check (plan sales, checkout, the
 * Stripe webhook's configuration check) while Stripe could verify nothing,
 * and a key pasted with a stray newline failed every call. lib/env.ts reads
 * the Stripe secrets through it, and so does every direct reader of
 * process.env (lib/stripe.ts, the Stripe webhook). It lives in its own module
 * so those readers do not import lib/env. Register 2.26;
 * tests/regressions/plan-sale-requires-stripe-webhook.test.ts.
 */
export function cleanSecret(value: string | undefined | null): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
