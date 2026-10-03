/**
 * Strip secrets and PII from strings before they're sent to Discord.
 *
 * Cron failure alerts include raw error messages + stack traces. If an
 * upstream throw embeds a Postgres connection string with password, an
 * API key, a Bearer token, or a user email, those land in our team
 * channel as-is. Discord webhooks are not encrypted and the channel
 * scrollback is searchable forever.
 *
 * This is best-effort defense in depth — it does NOT replace careful
 * error throwing in upstream code, just catches the obvious slips.
 *
 * Patterns covered:
 *   - DB URLs with credentials (postgres / mongodb / mysql / redis)
 *   - Bearer tokens
 *   - Webhook signing secrets (whsec_: Stripe's, and the base64 Svix format
 *     the Resend webhook uses)
 *   - sk_/pk_/rk_ key prefixes (Stripe, RapidAPI, OpenAI-style)
 *   - JWT-shaped tokens (header.body.sig)
 *   - Email addresses (PII)
 *   - Long base64-ish blobs ≥ 40 chars (catches API keys we missed), except
 *     Stripe object ids (STRIPE_OBJECT_ID below)
 */

/**
 * Stripe object ids stay readable: an alert names the session, payment or
 * subscription a human has to look up or refund. A Checkout Session id
 * (cs_live_ or cs_test_ plus about 58 characters) is long enough for
 * long_token, which masked the sessionId in every Stripe webhook alert.
 *
 * Only an exact id is kept: a known prefix, then letters and digits only,
 * as Stripe issues them. Secrets carry other prefixes (sk_ and rk_ are
 * masked by api_key_prefix, whsec_ by webhook_secret, before long_token
 * runs), and a client secret (pi_..._secret_...) or anything else joined on
 * with an underscore fails the letters-and-digits body, so it stays masked.
 */
const STRIPE_OBJECT_ID = /^(?:cs_live|cs_test|pi|ch|in|sub|cus|evt|re|dp|price|prod|plink|seti|py)_[A-Za-z0-9]+$/;

interface RedactionPattern {
    id: string;
    re: RegExp;
    replacement: string;
    /** A match this returns true for is left as it is. */
    keep?: (match: string) => boolean;
}

const PATTERNS: ReadonlyArray<RedactionPattern> = [
    // Database URLs with embedded credentials
    {
        id: 'db_url',
        re: /\b(postgres|postgresql|mongodb|mongodb\+srv|mysql|mariadb|redis|rediss):\/\/[^\s/@]+:[^\s@]*@[^\s"'`<>]+/gi,
        replacement: '[REDACTED_DB_URL]',
    },
    // Bearer tokens
    {
        id: 'bearer',
        re: /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/g,
        replacement: 'Bearer [REDACTED]',
    },
    // Webhook signing secrets (whsec_). A rule of their own for two reasons:
    // one can be shorter than long_token's 40 character floor, and the body
    // is not always letters and digits. Stripe's are, but a Svix secret (the
    // Resend webhook's RESEND_WEBHOOK_SECRET) is base64 and can hold + / and
    // =, where the key body class below would stop masking at the first + or
    // /, or never start when one falls inside the first 16 characters.
    {
        id: 'webhook_secret',
        re: /\bwhsec_[A-Za-z0-9+/=_-]{16,}/g,
        replacement: '[REDACTED_API_KEY]',
    },
    // Stripe / OpenAI / RapidAPI / Anthropic key prefixes
    {
        id: 'api_key_prefix',
        re: /\b(sk|pk|rk|sk-ant|sk-proj)[_-][A-Za-z0-9_\-]{16,}/g,
        replacement: '[REDACTED_API_KEY]',
    },
    // JWT tokens (header.payload.signature, all base64url)
    {
        id: 'jwt',
        re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
        replacement: '[REDACTED_JWT]',
    },
    // PII: email addresses
    {
        id: 'email',
        re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
        replacement: '[REDACTED_EMAIL]',
    },
    // Long base64-ish or hex blobs (catches keys we don't have explicit prefixes for).
    // Tuned narrow: ≥40 chars of base64 alphabet without dots — typical for raw
    // API keys but not for paths or long URLs (which contain "/").
    {
        id: 'long_token',
        re: /\b[A-Za-z0-9_\-+]{40,}\b/g,
        replacement: '[REDACTED_TOKEN]',
        keep: (match) => STRIPE_OBJECT_ID.test(match),
    },
];

/**
 * Run every redaction pattern against the input. Order is significant —
 * specific patterns (db_url, bearer, JWT) run before the catch-all
 * long_token so they get more descriptive replacement labels.
 */
export function sanitizeForDiscord(input: string | null | undefined): string {
    if (input === null || input === undefined) return '';
    let out = String(input);
    for (const p of PATTERNS) {
        const keep = p.keep;
        out = keep
            ? out.replace(p.re, (match) => (keep(match) ? match : p.replacement))
            : out.replace(p.re, p.replacement);
    }
    return out;
}
