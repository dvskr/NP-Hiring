/**
 * Fork preflight — validate env + config + source coherence BEFORE
 * launching a new board off this template.
 *
 * Requires NO database and NO network: everything is checked from
 * process.env (loaded via dotenv like the other scripts), config/brand.ts,
 * config/niche/*, and the local filesystem.
 *
 * Checks (grouped):
 *   1. ENV COMPLETENESS   — required core / email / indexing / push / Stripe
 *   2. BRAND COHERENCE    — NEXT_PUBLIC_BASE_URL vs brand.domain, brand.baseUrl,
 *                           brand inboxes, per-board asset bases
 *   3. LEFTOVER BRAND     — remaining 'pmhnphiring' strings on an actual fork
 *                           (shares the scanner with tests/regressions/brand-leak-ratchet.test.ts)
 *   4. PACK PRESENCE      — config/niche/* packs, content/blog posts,
 *                           content-map slugs resolve to real posts
 *
 * Usage:
 *   npm run fork:preflight
 *   # or directly:
 *   ts-node -r tsconfig-paths/register --project scripts/tsconfig.json \
 *     scripts/fork-preflight.ts
 *
 * Exit codes:
 *   0 — no FAILs (WARNs allowed)
 *   1 — at least one FAIL
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import * as fs from 'node:fs';
import * as path from 'node:path';
import { brand } from '../config/brand';
import { POSITIVE_KEYWORDS, NEGATIVE_KEYWORDS } from '../config/niche/relevance';
import { RELATED_BLOG_SLUGS, HOMEPAGE_FEATURED_POSTS } from '../config/niche/content-map';
import { scanBrandLeaks } from '../tests/regressions/brand-leak-scan';

const ROOT = path.resolve(__dirname, '..');
// Widened to `string` deliberately: brand.domain is an `as const` literal
// type, and comparing two DIFFERENT literals is a TS2367 compile error on
// every fork (it only compiled on the template where the literals match).
const TEMPLATE_DOMAIN: string = 'pmhnphiring.com';
const IS_FORK = (brand.domain as string) !== TEMPLATE_DOMAIN;
const CRON_SECRET_MIN_LENGTH = 16;
const LEFTOVER_SCAN_DIRS = ['app', 'lib', 'components', 'public'];
const MAX_LEFTOVER_FILES_LISTED = 20;

// ─── result collection ──────────────────────────────────────────────────────

type Level = 'PASS' | 'WARN' | 'FAIL';
const MARK: Record<Level, string> = { PASS: '✅', WARN: '⚠️ ', FAIL: '❌' };
const counts: Record<Level, number> = { PASS: 0, WARN: 0, FAIL: 0 };

function report(level: Level, message: string): void {
    counts[level] += 1;
    console.log(`  ${MARK[level]} ${level}  ${message}`);
}
const pass = (m: string) => report('PASS', m);
const warn = (m: string) => report('WARN', m);
const fail = (m: string) => report('FAIL', m);

function section(title: string): void {
    console.log(`\n── ${title} ${'─'.repeat(Math.max(4, 66 - title.length))}`);
}

// ─── env helpers ────────────────────────────────────────────────────────────

type EnvReading =
    | { status: 'missing' }
    | { status: 'placeholder' }
    | { status: 'set'; value: string };

/** Reads an env var; `<angle-bracket>` values from .env.example count as unset. */
function readEnv(name: string): EnvReading {
    const raw = process.env[name]?.trim();
    if (!raw) return { status: 'missing' };
    if (/^<.*>$/.test(raw)) return { status: 'placeholder' };
    return { status: 'set', value: raw };
}

function isSet(name: string): boolean {
    return readEnv(name).status === 'set';
}

function envValue(name: string): string | undefined {
    const r = readEnv(name);
    return r.status === 'set' ? r.value : undefined;
}

function requireEnv(name: string, why: string): boolean {
    const r = readEnv(name);
    if (r.status === 'set') {
        pass(`${name} is set`);
        return true;
    }
    const reason = r.status === 'placeholder'
        ? 'still the <placeholder> from .env.example'
        : 'not set';
    fail(`${name} is ${reason} — ${why}`);
    return false;
}

/** Extracts the bare address from 'Display Name <email@domain>' or a bare email. */
function extractEmailAddress(value: string): string | null {
    const angled = value.match(/<([^<>\s@]+@[^<>\s]+)>/);
    if (angled) return angled[1].toLowerCase();
    const bare = value.trim();
    return /^[^<>\s@]+@[^<>\s]+$/.test(bare) ? bare.toLowerCase() : null;
}

function emailDomain(address: string): string | null {
    const at = address.lastIndexOf('@');
    return at === -1 ? null : address.slice(at + 1);
}

function isBrandDomain(domain: string): boolean {
    return domain === brand.domain || domain.endsWith(`.${brand.domain}`);
}

function parseUrlHost(value: string): string | null {
    try {
        return new URL(value).hostname;
    } catch {
        return null;
    }
}

// ─── 1. ENV COMPLETENESS ────────────────────────────────────────────────────

function checkCoreEnv(): void {
    requireEnv('DATABASE_URL', 'Postgres connection string; nothing runs without it');
    requireEnv('DIRECT_URL', 'non-pooled Postgres URL; `prisma migrate deploy` fails without it');
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'Supabase project URL; auth + storage break without it');
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon key; client auth breaks without it');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'Supabase service-role key; server-side auth/storage breaks without it');
    requireEnv('NEXT_PUBLIC_BASE_URL', 'canonical site URL used in email links, OG tags, sitemap');

    const cron = readEnv('CRON_SECRET');
    if (cron.status !== 'set') {
        fail(`CRON_SECRET is ${cron.status === 'placeholder' ? 'still the <placeholder> from .env.example' : 'not set'} — every /api/cron/* endpoint is unprotected/broken. Generate with: openssl rand -hex 32`);
    } else if (cron.value.length < CRON_SECRET_MIN_LENGTH) {
        fail(`CRON_SECRET is only ${cron.value.length} chars — lib/env.ts requires >= ${CRON_SECRET_MIN_LENGTH}. Generate with: openssl rand -hex 32`);
    } else {
        pass(`CRON_SECRET is set (${cron.value.length} chars, >= ${CRON_SECRET_MIN_LENGTH})`);
    }
}

function checkEmailSender(name: string): void {
    const value = envValue(name);
    if (!value) {
        pass(`${name} unset — defaults to config/brand.ts (${name === 'EMAIL_FROM' ? brand.email.transactionalFrom : brand.email.marketingFrom})`);
        return;
    }
    const address = extractEmailAddress(value);
    if (!address) {
        warn(`${name} is not in 'Display Name <email@domain>' format — bare/malformed senders look unprofessional and may fail verification`);
        return;
    }
    const domain = emailDomain(address);
    if (!domain || !isBrandDomain(domain)) {
        warn(`${name} sends from '${domain ?? value}' but brand.domain is '${brand.domain}' — outbound mail would come from a different (likely unverified) domain`);
        return;
    }
    pass(`${name} sends from the brand domain (${address})`);
}

function checkEmailEnv(): void {
    const r = readEnv('RESEND_API_KEY');
    if (r.status === 'set') {
        pass('RESEND_API_KEY is set');
    } else {
        fail('RESEND_API_KEY is not set — every email send fails silently. Get one at https://resend.com/api-keys');
    }
    if (!isSet('RESEND_WEBHOOK_SECRET')) {
        warn('RESEND_WEBHOOK_SECRET is not set — /api/webhooks/resend returns 500 and bounce/complaint events never flip suppression flags');
    } else {
        pass('RESEND_WEBHOOK_SECRET is set');
    }
    checkEmailSender('EMAIL_FROM');
    checkEmailSender('EMAIL_FROM_MARKETING');
}

function checkIndexNow(): void {
    const apiKey = envValue('INDEXNOW_API_KEY');
    const key = envValue('INDEXNOW_KEY');
    if (apiKey && key && apiKey === key) {
        pass('INDEXNOW_API_KEY and INDEXNOW_KEY are both set to the same value');
    } else if (apiKey && key) {
        warn('INDEXNOW_API_KEY and INDEXNOW_KEY are set to DIFFERENT values — lib/search-indexing.ts reads INDEXNOW_API_KEY, lib/indexnow.ts reads INDEXNOW_KEY. Set BOTH to the same value (see .env.example note)');
    } else if (apiKey) {
        warn('INDEXNOW_KEY is not set (only INDEXNOW_API_KEY) — lib/indexnow.ts reads INDEXNOW_KEY, so the enrich-thin-jds IndexNow pings silently no-op. Set both to the same value');
    } else if (key) {
        warn('INDEXNOW_API_KEY is not set (only INDEXNOW_KEY) — lib/search-indexing.ts reads INDEXNOW_API_KEY, so the index-urls / index-pseo / deindex-expired crons silently no-op. Set both to the same value');
    } else {
        warn('IndexNow is unconfigured (INDEXNOW_API_KEY + INDEXNOW_KEY) — indexing crons return 200 OK with zero submissions, indistinguishable from success');
    }
}

function checkIndexingEnv(): void {
    checkIndexNow();

    if (isSet('GSC_SERVICE_ACCOUNT_KEY') && isSet('GSC_SITE_URL')) {
        pass('Google Search Console credentials are set (GSC_SERVICE_ACCOUNT_KEY + GSC_SITE_URL)');
    } else {
        warn('GSC_SERVICE_ACCOUNT_KEY / GSC_SITE_URL not fully set — gsc-health-check and historical-deindex crons silently no-op');
    }
    if (isSet('BING_WEBMASTER_API_KEY')) {
        pass('BING_WEBMASTER_API_KEY is set');
    } else {
        warn('BING_WEBMASTER_API_KEY is not set — per-site Bing URL submissions silently no-op');
    }
    if (isSet('BING_WEBMASTER_VERIFICATION')) {
        pass('BING_WEBMASTER_VERIFICATION is set');
    } else {
        warn('BING_WEBMASTER_VERIFICATION is not set — IndexNow pipeline runs blind (no Bing dashboard visibility into submissions/coverage)');
    }
    if (isSet('GOOGLE_INDEXING_CREDENTIALS')) {
        pass('GOOGLE_INDEXING_CREDENTIALS is set');
    } else {
        warn('GOOGLE_INDEXING_CREDENTIALS is not set — Google Indexing API submissions (net-new + URL_DELETED) silently no-op');
    }
}

function checkPushEnv(): void {
    const pub = isSet('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    const priv = isSet('VAPID_PRIVATE_KEY');
    if (pub && priv) {
        pass('VAPID key pair is set (web push enabled)');
    } else if (!pub && !priv) {
        warn('VAPID keys not set — web push disabled (optional). Generate with: npx web-push generate-vapid-keys');
    } else {
        const set = pub ? 'NEXT_PUBLIC_VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY';
        const missing = pub ? 'VAPID_PRIVATE_KEY' : 'NEXT_PUBLIC_VAPID_PUBLIC_KEY';
        fail(`${set} is set but ${missing} is not — the VAPID pair must be both-or-neither; half-configured push breaks subscribe/send`);
    }
}

function checkStripeEnv(): void {
    if (envValue('ENABLE_PAID_POSTING') !== 'true') {
        pass('ENABLE_PAID_POSTING is not true — Stripe keys not required');
        return;
    }
    requireEnv('STRIPE_SECRET_KEY', 'required because ENABLE_PAID_POSTING=true');
    requireEnv('STRIPE_WEBHOOK_SECRET', 'required because ENABLE_PAID_POSTING=true (checkout webhooks fail without it)');
    requireEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'required because ENABLE_PAID_POSTING=true');
}

// ─── 2. BRAND / CONFIG COHERENCE ────────────────────────────────────────────

function checkBaseUrlMatchesBrand(): void {
    const baseUrl = envValue('NEXT_PUBLIC_BASE_URL');
    if (!baseUrl) {
        fail('NEXT_PUBLIC_BASE_URL unavailable — cannot verify it matches brand.domain (fix the env FAIL above)');
        return;
    }
    const host = parseUrlHost(baseUrl);
    if (!host) {
        fail(`NEXT_PUBLIC_BASE_URL ('${baseUrl}') is not a valid URL`);
        return;
    }
    if (host === brand.domain || host === `www.${brand.domain}`) {
        pass(`NEXT_PUBLIC_BASE_URL host '${host}' matches brand.domain '${brand.domain}'`);
    } else {
        fail(`NEXT_PUBLIC_BASE_URL host '${host}' != brand.domain '${brand.domain}' — email links, canonicals and OG tags would point at the wrong site. Set it to ${brand.baseUrl} (or https://www.${brand.domain})`);
    }
}

function checkBrandBaseUrl(): void {
    const host = parseUrlHost(brand.baseUrl);
    if (!host) {
        fail(`config/brand.ts baseUrl ('${brand.baseUrl}') is not a valid URL`);
    } else if (host !== brand.domain) {
        fail(`config/brand.ts baseUrl host '${host}' != brand.domain '${brand.domain}' — keep the two fields in lockstep`);
    } else {
        pass(`config/brand.ts baseUrl (${brand.baseUrl}) matches brand.domain`);
    }
}

function checkBrandInboxes(): void {
    const inboxes: Array<[string, string]> = [
        ['email.privacy', brand.email.privacy],
        ['email.security', brand.email.security],
        ['email.support', brand.email.support],
        ['email.contact', brand.email.contact],
        ['email.hello', brand.email.hello],
        ['email.replyTo', brand.email.replyTo],
        ['email.marketingFrom', brand.email.marketingFrom],
        ['email.transactionalFrom', brand.email.transactionalFrom],
    ];
    const offDomain = inboxes.filter(([, value]) => {
        const address = extractEmailAddress(value);
        const domain = address ? emailDomain(address) : null;
        return !domain || !isBrandDomain(domain);
    });
    if (offDomain.length === 0) {
        pass(`all ${inboxes.length} config/brand.ts email addresses end with @${brand.domain}`);
    } else {
        for (const [field, value] of offDomain) {
            warn(`config/brand.ts ${field} ('${value}') is not @${brand.domain} — likely a leftover from the original board`);
        }
    }
}

function checkBrandAssetBase(field: string, value: string): void {
    const host = parseUrlHost(value);
    if (!value || !host) {
        fail(`config/brand.ts assets.${field} is not a valid URL ('${value}') — email images / salary-guide PDF will 404`);
        return;
    }
    if (!IS_FORK) {
        pass(`assets.${field} is set (template board — cross-board bucket check skipped)`);
        return;
    }
    const supabaseHost = (() => {
        const url = envValue('NEXT_PUBLIC_SUPABASE_URL');
        return url ? parseUrlHost(url) : null;
    })();
    const mentionsOriginalNiche = /pmhnp/i.test(value);
    const onForeignBucket = supabaseHost !== null && host !== supabaseHost;
    if (mentionsOriginalNiche || onForeignBucket) {
        const why = mentionsOriginalNiche
            ? "references the original PMHNP board's assets"
            : `host '${host}' differs from this fork's Supabase project ('${supabaseHost}')`;
        warn(`assets.${field} ('${value}') ${why} — point it at your own bucket or your emails show the wrong niche's imagery`);
    } else {
        pass(`assets.${field} points at this fork's own storage (${host})`);
    }
}

function checkBrandCoherence(): void {
    checkBaseUrlMatchesBrand();
    checkBrandBaseUrl();
    checkBrandInboxes();
    checkBrandAssetBase('emailAssetsBase', brand.assets.emailAssetsBase);
    checkBrandAssetBase('salaryGuidePdf', brand.assets.salaryGuidePdf);
}

// ─── 3. LEFTOVER-BRAND SCAN ─────────────────────────────────────────────────

function checkLeftoverBrand(): void {
    if (!IS_FORK) {
        pass(`brand.domain is the template domain ('${TEMPLATE_DOMAIN}') — leftover-brand scan skipped (nothing has been forked yet)`);
        return;
    }
    const leaks = scanBrandLeaks({
        root: ROOT,
        dirs: LEFTOVER_SCAN_DIRS,
        rootFiles: [],
        patterns: [{ name: 'original-domain', re: /pmhnphiring/gi }],
    });
    const entries = Object.entries(leaks).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
        pass(`no leftover 'pmhnphiring' strings in ${LEFTOVER_SCAN_DIRS.join('/')}`);
        return;
    }
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    fail(`${total} leftover 'pmhnphiring' occurrence(s) across ${entries.length} file(s) — replace with config/brand.ts reads, then regenerate the ratchet baseline (UPDATE_BRAND_LEAK_BASELINE=1 npx vitest run tests/regressions/brand-leak-ratchet.test.ts):`);
    for (const [file, n] of entries.slice(0, MAX_LEFTOVER_FILES_LISTED)) {
        console.log(`       - ${file} (${n})`);
    }
    if (entries.length > MAX_LEFTOVER_FILES_LISTED) {
        console.log(`       … and ${entries.length - MAX_LEFTOVER_FILES_LISTED} more file(s)`);
    }
}

// ─── 4. PACK PRESENCE ───────────────────────────────────────────────────────

const REQUIRED_NICHE_FILES = ['salary.ts', 'relevance.ts', 'content-map.ts', 'copy.ts'];

function checkNichePackFiles(): void {
    const missing = REQUIRED_NICHE_FILES.filter(
        (f) => !fs.existsSync(path.join(ROOT, 'config', 'niche', f)),
    );
    if (missing.length === 0) {
        pass(`config/niche/ pack files all present (${REQUIRED_NICHE_FILES.join(', ')})`);
    } else {
        for (const f of missing) {
            fail(`config/niche/${f} is missing — the code that imports it will not compile`);
        }
    }
}

function checkRelevanceKeywords(): void {
    if (Array.isArray(POSITIVE_KEYWORDS) && POSITIVE_KEYWORDS.length > 0) {
        pass(`config/niche/relevance.ts POSITIVE_KEYWORDS has ${POSITIVE_KEYWORDS.length} entries`);
    } else {
        fail('config/niche/relevance.ts POSITIVE_KEYWORDS is empty — the relevance engine passes nothing; every ingested job gets rejected');
    }
    if (Array.isArray(NEGATIVE_KEYWORDS) && NEGATIVE_KEYWORDS.length > 0) {
        pass(`config/niche/relevance.ts NEGATIVE_KEYWORDS has ${NEGATIVE_KEYWORDS.length} entries`);
    } else {
        fail('config/niche/relevance.ts NEGATIVE_KEYWORDS is empty — wrong-role postings will flood the board; start strict and loosen with rejected_jobs data');
    }
}

function listBlogSlugs(): Set<string> {
    const blogDir = path.join(ROOT, 'content', 'blog');
    if (!fs.existsSync(blogDir)) return new Set();
    return new Set(
        fs.readdirSync(blogDir)
            .filter((f) => f.endsWith('.mdx'))
            .map((f) => f.replace(/\.mdx$/, '')),
    );
}

function checkBlogContent(existingSlugs: Set<string>): void {
    if (existingSlugs.size >= 1) {
        pass(`content/blog has ${existingSlugs.size} .mdx post(s)`);
    } else {
        fail('content/blog has no .mdx posts — the blog index is empty and every content-map link 404s');
    }
}

function checkContentMapSlugs(existingSlugs: Set<string>): void {
    const mapped: Array<{ slug: string; source: string }> = [];
    for (const [group, slugs] of Object.entries(RELATED_BLOG_SLUGS)) {
        for (const slug of slugs) {
            mapped.push({ slug, source: `RELATED_BLOG_SLUGS.${group}` });
        }
    }
    for (const post of HOMEPAGE_FEATURED_POSTS) {
        if (post.href.startsWith('/blog/')) {
            mapped.push({ slug: post.href.slice('/blog/'.length), source: 'HOMEPAGE_FEATURED_POSTS' });
        } else {
            warn(`HOMEPAGE_FEATURED_POSTS href '${post.href}' does not start with /blog/ — cannot verify it resolves to a post`);
        }
    }

    const missing = mapped.filter(({ slug }) => !existingSlugs.has(slug));
    if (missing.length === 0) {
        pass(`all ${mapped.length} config/niche/content-map.ts slugs resolve to files in content/blog`);
        return;
    }
    for (const { slug, source } of missing) {
        fail(`content-map slug '${slug}' (${source}) has no content/blog/${slug}.mdx — ${source.startsWith('HOMEPAGE') ? 'live sitewide internal 404 on the homepage' : 'silently drops out of the job-page sidebar'}`);
    }
}

// ─── main ───────────────────────────────────────────────────────────────────

function main(): void {
    console.log(`[fork-preflight] brand: ${brand.name} (${brand.domain}) — ${IS_FORK ? 'FORK of the template' : 'template board'}`);
    console.log('[fork-preflight] offline validation only — no database, no network');

    section('1. ENV COMPLETENESS');
    checkCoreEnv();
    checkEmailEnv();
    checkIndexingEnv();
    checkPushEnv();
    checkStripeEnv();

    section('2. BRAND / CONFIG COHERENCE');
    checkBrandCoherence();

    section('3. LEFTOVER-BRAND SCAN');
    checkLeftoverBrand();

    section('4. PACK PRESENCE');
    checkNichePackFiles();
    checkRelevanceKeywords();
    const existingSlugs = listBlogSlugs();
    checkBlogContent(existingSlugs);
    checkContentMapSlugs(existingSlugs);

    section('SUMMARY');
    console.log(`  ✅ ${counts.PASS} passed   ⚠️  ${counts.WARN} warnings   ❌ ${counts.FAIL} failures`);
    if (counts.FAIL > 0) {
        console.log('[fork-preflight] FAIL — fix the ❌ items above before launching this board.');
        process.exit(1);
    }
    console.log(`[fork-preflight] PASS${counts.WARN > 0 ? ' (with warnings — the ⚠️  items degrade silently in production)' : ''}`);
    process.exit(0);
}

main();
