/**
 * SSRF guard for the dead-link cron (B102).
 *
 * `applyLink` values originate from external aggregator feeds and employer
 * input — they are attacker-influenceable. Without a guard this cron would
 * happily probe http://169.254.169.254/, internal hostnames, raw IPs, etc.
 * from inside the deployment's network on every sweep. This module rejects
 * anything that is not a plain public https URL BEFORE lib/health issues a
 * fetch.
 *
 * Design: conservative static validation (scheme + port + hostname
 * denylist), no DNS resolution. WHATWG URL parsing already normalizes
 * obfuscated IPv4 forms (decimal `2130706433`, hex `0x7f.0x0.0x0.0x1`)
 * into dotted-quad hostnames, which the IP-literal rule then blocks.
 *
 * Residual risk (documented, accepted): redirect chains and DNS rebinding
 * inside lib/health's probe are NOT re-validated here — lib/health is
 * outside this package's ownership. A public hostname that resolves to a
 * private IP (or redirects to one) can still be probed. The guard removes
 * the direct, trivially-exploitable surface.
 */

export type UrlGuardVerdict =
    | { safe: true }
    | { safe: false; reason: string };

/** Hostname suffixes that always denote non-public / internal targets. */
const BLOCKED_HOSTNAME_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal', // covers metadata.google.internal
    '.home.arpa',
    '.in-addr.arpa',
    '.ip6.arpa',
];

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Label that is purely numeric or hex — an obfuscated-IP building block. */
const NUMERIC_OR_HEX_LABEL = /^(0x[0-9a-f]+|\d+)$/i;

/**
 * Validates an external apply link before the health checker fetches it.
 * Returns { safe: true } for plain public https URLs on the default port;
 * otherwise { safe: false, reason } with a machine-greppable reason code.
 */
export function assessApplyLinkSafety(rawUrl: string): UrlGuardVerdict {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { safe: false, reason: 'invalid_url' };
    }

    // https only — the probe never needs plaintext http, and internal
    // metadata/admin endpoints are overwhelmingly plain-http.
    if (parsed.protocol !== 'https:') {
        return { safe: false, reason: 'non_https_scheme' };
    }

    // Default port only. A cron that will fetch arbitrary host:port pairs
    // is a free port-prober; real job boards serve on 443.
    if (parsed.port !== '' && parsed.port !== '443') {
        return { safe: false, reason: 'non_default_port' };
    }

    // Normalize: lowercase + strip a single trailing dot (FQDN form).
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);

    if (hostname.length === 0) {
        return { safe: false, reason: 'empty_hostname' };
    }

    // IPv6 literals arrive bracketed from URL.hostname ("[::1]").
    if (hostname.startsWith('[') || hostname.includes(':')) {
        return { safe: false, reason: 'ipv6_literal' };
    }

    if (hostname === 'localhost') {
        return { safe: false, reason: 'localhost' };
    }

    if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
        return { safe: false, reason: 'private_hostname' };
    }

    // Block ALL IPv4 literals — public ones included. Legitimate job
    // postings never use raw IP apply links; anything here is junk data
    // or a probe target (loopback, RFC1918, link-local metadata, …).
    if (IPV4_LITERAL.test(hostname)) {
        return { safe: false, reason: 'ip_literal' };
    }

    // Single-label hostnames ("intranet", "printer") are internal names
    // that only resolve on private networks.
    if (!hostname.includes('.')) {
        return { safe: false, reason: 'single_label_hostname' };
    }

    // Belt-and-suspenders for obfuscated IPs the URL parser didn't
    // normalize: every label purely numeric/hex (e.g. "1.2.3.4.5").
    const labels = hostname.split('.');
    if (labels.every((label) => NUMERIC_OR_HEX_LABEL.test(label))) {
        return { safe: false, reason: 'numeric_hostname' };
    }

    return { safe: true };
}
