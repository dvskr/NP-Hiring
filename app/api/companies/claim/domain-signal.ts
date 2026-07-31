/**
 * Domain-match signal for company profile claims.
 *
 * This is the `quotaDomain` primitive (EmployerJob.quotaDomain — an immutable
 * snapshot of the signup email's domain, already the anchor for the per-domain
 * free-post quota) reused as EVIDENCE FOR A HUMAN REVIEWER.
 *
 * TRUTH BOUNDARY — read this before wiring the result anywhere:
 *   - `domainMatch: true` is NOT an approval. It says one string matched
 *     another string. Anyone who can receive mail at a domain can trigger it,
 *     and plenty of legitimate claimants can never trigger it: staffing
 *     agencies and MSOs recruiting for a client, multi-brand health systems,
 *     solo practices on a consumer mailbox, and every Company row whose
 *     `website` is null or points at an aggregator (the ingest pipeline never
 *     writes `website` at all — lib/company-normalizer.ts has zero references
 *     to it — so null is the COMMON case, not the exception).
 *   - `domainMatch: false` is NOT a rejection, for the same reasons.
 *   - Nothing in this module may gate a public surface. The only thing that
 *     ever publishes a claim is an admin stamping Company.claimVerifiedAt.
 */

/**
 * Consumer mailbox providers. Kept in sync with the FREE_EMAIL_DOMAINS list in
 * app/api/jobs/post-free/route.ts, which uses it to REFUSE a free post. Here it
 * is only a display signal: a two-clinician practice on a Gmail address is a
 * perfectly real employer, it just cannot prove anything with its domain.
 */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
    'ymail.com', 'live.com', 'msn.com', 'googlemail.com',
];

/** Lowercased domain part of an email address, or null when unparseable. */
export function emailDomain(email: string): string | null {
    const parts = email.toLowerCase().trim().split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return parts[1];
}

/**
 * Host of a stored Company.website, lowercased and `www.`-stripped.
 *
 * Company.website is aggregator-derived when it is set at all, so it arrives in
 * every shape: "acme.com", "https://acme.com/careers", "WWW.Acme.com/". Returns
 * null for anything that will not parse into a host with a dot in it.
 */
export function websiteHost(website: string | null | undefined): string | null {
    if (!website) return null;
    const raw = website.trim();
    if (!raw) return null;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let host: string;
    try {
        host = new URL(withScheme).hostname.toLowerCase();
    } catch {
        return null;
    }
    const stripped = host.replace(/^www\./, '');
    // A bare label ("localhost", "acme") is not a claimable identity.
    if (!stripped.includes('.')) return null;
    return stripped;
}

/**
 * Do the claimant's email domain and the company's website host describe the
 * same organisation, to the limited extent a string comparison can tell?
 *
 * Accepts an exact match plus a subdomain relationship in either direction
 * (mail.acme.com ↔ acme.com, acme.com ↔ careers.acme.com), which is where real
 * corporate mail lives. `notacme.com` vs `acme.com` and `acme.com.evil.com` vs
 * `acme.com` both fail, because the test is on a dot-prefixed suffix rather
 * than a bare substring.
 *
 * KNOWN FALSE POSITIVE #1 — SHARED HOSTS, and this one is NOT theoretical.
 * `Company.website` is aggregator/ATS-derived whenever it is set at all, so it
 * frequently holds a tenant URL on a host the employer does not own:
 * `acme.applicantpro.com`, `acme.bamboohr.com`, `acme.myworkdayjobs.com`. The
 * suffix test compares hosts, not owners, so a claimant whose mail lives at
 * the SHARED parent — `@applicantpro.com` — matches every tenant under it,
 * including employers they have nothing to do with. The same shape hits any
 * multi-tenant host. This is not repaired here on purpose: a hardcoded
 * blocklist of ATS parents would go stale silently and would still be wrong
 * for the ATS vendor's own genuine profile. It is contained instead by the two
 * things that already hold — the signal can never approve anything on its own,
 * and /admin/company-claims prints the compared pair (`claimantDomain` vs
 * `companyHost`) next to the badge, so the reviewer sees `applicantpro.com vs
 * acme.applicantpro.com` and can judge it. Read the pair, not the badge.
 *
 * KNOWN FALSE POSITIVE #2 — PUBLIC SUFFIXES: this does NOT do registrable-
 * domain comparison — that needs a PSL, and a half-implemented one is worse
 * than none. The suffix test would report a match if the SHORTER side were
 * itself a public suffix (an account at `@co.uk` against `acme.co.uk`). No
 * registrar sells a mailbox at a bare public suffix, so unlike #1 this one is
 * theoretical.
 *
 * In both cases the cost of a false positive is bounded to an admin reading
 * one more line of evidence, because nothing here decides anything.
 */
export function domainsMatch(
    claimantDomain: string | null,
    companyHost: string | null,
): boolean {
    if (!claimantDomain || !companyHost) return false;
    if (claimantDomain === companyHost) return true;
    return (
        claimantDomain.endsWith(`.${companyHost}`) ||
        companyHost.endsWith(`.${claimantDomain}`)
    );
}

export function isFreeEmailDomain(domain: string | null): boolean {
    if (!domain) return false;
    return FREE_EMAIL_DOMAINS.includes(domain);
}

export interface ClaimDomainSignal {
    claimantDomain: string | null;
    companyHost: string | null;
    domainMatch: boolean;
    freeEmailDomain: boolean;
}

/**
 * Single entry point used by the claim route so the stored evidence and the
 * admin's displayed evidence can never drift apart.
 */
export function evaluateClaimDomain(
    claimantEmail: string,
    companyWebsite: string | null | undefined,
): ClaimDomainSignal {
    const claimantDomain = emailDomain(claimantEmail);
    const companyHost = websiteHost(companyWebsite);
    return {
        claimantDomain,
        companyHost,
        domainMatch: domainsMatch(claimantDomain, companyHost),
        freeEmailDomain: isFreeEmailDomain(claimantDomain),
    };
}
