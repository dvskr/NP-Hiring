/**
 * SEO / data-integrity helpers for the seo-data-integrity journey.
 *
 * Pure functions over response bodies (no Playwright state) so they can be
 * exercised against `request` fixtures and raw HTML alike. XML well-formedness
 * is checked with @xmldom/xmldom (already a repo dependency) rather than a
 * regex, so an unescaped `&` or an unbalanced tag fails loudly.
 */
import type { APIRequestContext } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

export interface XmlCheck {
    wellFormed: boolean;
    errors: string[];
    rootName: string | null;
}

/** Parse XML strictly; collect parser errors instead of throwing. */
export function checkXml(xml: string): XmlCheck {
    const errors: string[] = [];
    const parser = new DOMParser({
        onError: (level: string, msg: string) => {
            if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${msg}`);
        },
    } as ConstructorParameters<typeof DOMParser>[0]);
    let rootName: string | null = null;
    try {
        const doc = parser.parseFromString(xml, 'text/xml');
        rootName = doc.documentElement?.nodeName ?? null;
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
    }
    return { wellFormed: errors.length === 0 && rootName !== null, errors, rootName };
}

/** Every <loc> value in a sitemap/urlset/sitemapindex body. */
export function parseLocs(xml: string): string[] {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeXmlEntities(m[1].trim()));
}

export function decodeXmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;|&#x27;/g, "'");
}

/** Duplicate entries in a list (each reported once). */
export function duplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const v of values) {
        if (seen.has(v)) dups.add(v);
        seen.add(v);
    }
    return [...dups];
}

/**
 * Visible-text approximation of an HTML document: scripts, styles, tags and
 * entities removed, whitespace collapsed. RSC flight payloads live inside
 * <script> tags and legitimately contain `null`, so they must be stripped
 * before grepping for leaked `undefined` / `NaN` / `null` copy.
 */
export function htmlToText(html: string): string {
    return decodeXmlEntities(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<template[\s\S]*?<\/template>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<[^>]+>/g, ' '),
    )
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** <link rel="canonical"> href from raw HTML (attribute order agnostic). */
export function canonicalOf(html: string): string | null {
    const tag = html.match(/<link\b[^>]*\brel="canonical"[^>]*>/i)?.[0];
    if (!tag) return null;
    return tag.match(/\bhref="([^"]+)"/i)?.[1] ?? null;
}

export function metaRobotsOf(html: string): string | null {
    return html.match(/<meta\b[^>]*\bname="robots"[^>]*\bcontent="([^"]+)"/i)?.[1] ?? null;
}

export function titleOf(html: string): string | null {
    const raw = html.match(/<title>([^<]*)<\/title>/i)?.[1];
    return raw == null ? null : decodeXmlEntities(raw);
}

export function metaDescriptionOf(html: string): string | null {
    const raw = html.match(/<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]*)"/i)?.[1];
    return raw == null ? null : decodeXmlEntities(raw);
}

export interface JsonLdBlock {
    raw: string;
    parsed: unknown | null;
    error: string | null;
}

/** Every application/ld+json block in raw HTML, parsed individually. */
export function extractJsonLd(html: string): JsonLdBlock[] {
    return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
        const raw = m[1].trim();
        try {
            return { raw, parsed: JSON.parse(raw), error: null };
        } catch (err) {
            return { raw, parsed: null, error: err instanceof Error ? err.message : String(err) };
        }
    });
}

export type JsonObject = Record<string, unknown>;

/** Flatten JSON-LD (top-level arrays and @graph) into a list of typed nodes. */
export function flattenJsonLd(parsed: unknown[]): JsonObject[] {
    const out: JsonObject[] = [];
    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (node && typeof node === 'object') {
            const obj = node as JsonObject;
            if (Array.isArray(obj['@graph'])) {
                (obj['@graph'] as unknown[]).forEach(visit);
                return;
            }
            if (typeof obj['@type'] === 'string' || Array.isArray(obj['@type'])) out.push(obj);
        }
    };
    parsed.forEach(visit);
    return out;
}

export function typesOf(node: JsonObject): string[] {
    const t = node['@type'];
    return Array.isArray(t) ? (t as string[]) : typeof t === 'string' ? [t] : [];
}

/** Walk every string leaf of a JSON value. */
export function stringLeaves(value: unknown, path = '$'): Array<{ path: string; value: string }> {
    if (typeof value === 'string') return [{ path, value }];
    if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
        return Object.entries(value as JsonObject).flatMap(([k, v]) => stringLeaves(v, `${path}.${k}`));
    }
    return [];
}

export interface RedirectHop {
    url: string;
    status: number;
    location: string | null;
}

/** Follow redirects by hand (max `limit` hops) recording every hop. */
export async function followRedirects(
    request: APIRequestContext,
    path: string,
    limit = 5,
): Promise<{ hops: RedirectHop[]; finalStatus: number; finalPath: string }> {
    const hops: RedirectHop[] = [];
    let current = path;
    for (let i = 0; i < limit; i++) {
        const res = await request.get(current, { maxRedirects: 0 });
        const location = res.headers()['location'] ?? null;
        hops.push({ url: current, status: res.status(), location });
        if (res.status() >= 300 && res.status() < 400 && location) {
            if (location.startsWith('http')) {
                const u = new URL(location);
                current = u.pathname + u.search;
            } else {
                current = location;
            }
            continue;
        }
        return { hops, finalStatus: res.status(), finalPath: current };
    }
    return { hops, finalStatus: hops[hops.length - 1].status, finalPath: current };
}

/** The trailing UUID of a job-detail path, if any. */
export function jobUuidOf(pathOrUrl: string): string | null {
    return (
        pathOrUrl
            .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1]
            ?.toLowerCase() ?? null
    );
}

/** Same rounding the app applies to headline counts (app/page.tsx etc.). */
export function headlineCountDisplay(n: number): string {
    return n > 1000 ? `${(Math.floor(n / 100) * 100).toLocaleString('en-US')}+` : n.toLocaleString('en-US');
}

/** /for-programs pill formatter (app/for-programs/page.tsx `fmt`). */
export function programsCountDisplay(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

/** Leaked-placeholder copy that must never reach a reader. */
export const LEAKED_PLACEHOLDER_RE = /\b(undefined|NaN|null)\b/;

/**
 * Donor-brand (PMHNP Hiring) copy that must not survive on an NP-board page.
 * Bare "PMHNP" is a legitimate NP specialty token (it appears in job titles,
 * nav quick-links and blog cards), so the patterns target board identity,
 * not the credential.
 */
export const DONOR_COPY_RE =
    /pmhnphiring\.com|PMHNP\s*Hiring\b|PMHNP job board|for PMHNPs\b|PMHNP-only|dedicated to PMHNPs|Psychiatric[- ]Mental Health Nurse Practitioner job board/i;

/** Marker Next.js leaves in SSR HTML when a segment bailed out to client rendering. */
export const CSR_BAILOUT_MARKER = 'BAILOUT_TO_CLIENT_SIDE_RENDERING';
