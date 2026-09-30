/**
 * URL guards for employer-supplied links on the job detail page.
 *
 * Pure and dependency-free on purpose: the client components (ApplyButton,
 * AboutEmployer) and the server page and JobPosting builder all import it, so
 * it must never pull a server-only module into a client bundle.
 */

/**
 * Returns the value only when it parses as an absolute http: or https: URL
 * with a host; otherwise null. Fails closed on anything unparseable.
 */
export function safeExternalHref(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || /[\u0000-\u001F\u007F\s]/.test(trimmed) || trimmed.startsWith('//')) return null;
    // A bare host ("www.example.com") is a common legacy value; give it
    // https:// rather than rendering it as a broken relative link.
    const candidate = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed) ? `https://${trimmed}` : trimmed;
    try {
        const parsed = new URL(candidate);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname.includes('.')) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

const MAILTO_RE = /^mailto:[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/i;

/**
 * The href an apply control may carry: an absolute http(s) URL, or a mailto:
 * address (lib/sanitize.ts lets employers post either). Anything else,
 * including javascript: and data: values that predate server-side
 * sanitising, yields null so it can never become a clickable link.
 */
export function safeApplyHref(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (MAILTO_RE.test(trimmed)) return trimmed;
    return safeExternalHref(trimmed);
}

/** True when the apply href opens a mail client rather than a web page. */
export function isMailtoHref(href: string): boolean {
    return /^mailto:/i.test(href);
}

/** Link attributes for an employer application URL: new tab for the web, none for mail. */
export function externalApplyLinkProps(href: string): { target?: string; rel?: string } {
    return isMailtoHref(href) ? {} : { target: '_blank', rel: 'nofollow noopener' };
}

/** Screen-reader note on where an external apply link goes. */
export function externalApplyHint(href: string): string {
    return isMailtoHref(href) ? ' (opens your email app)' : " (opens the employer's site in a new tab)";
}
