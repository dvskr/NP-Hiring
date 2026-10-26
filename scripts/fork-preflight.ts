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
 *   5. NICHE-COPY DEBT    — reference-niche terms (PMHNP/psychiatric/mental
 *                           health) still hardcoded in production source.
 *                           WARN-only, never FAILs: on a fork each hit is
 *                           either an intentional specialty mention or copy
 *                           to rewrite (shares the scanner with
 *                           tests/regressions/niche-copy-debt.test.ts)
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
import { scanBrandLeaks, scanNicheCopyDebt } from '../tests/regressions/brand-leak-scan';

const ROOT = path.resolve(__dirname, '..');
// Widened to `string` deliberately: brand.domain is an `as const` literal
// type, and comparing two DIFFERENT literals is a TS2367 compile error on
// every fork (it only compiled on the template where the literals match).
// Found by the first real fork (NP Hiring, 2026-07-02).
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

/**
 * IndexNow key naming.
 *
 * The old two-name drift is gone: lib/indexnow.ts (every submission) and
 * lib/indexnow-key-file.ts (the key file middleware.ts serves) both resolve
 * INDEXNOW_KEY first and fall back to INDEXNOW_API_KEY. So EITHER name alone
 * works everywhere, and the only thing left to warn about is an unconfigured
 * pipeline, plus the cosmetic case of two names holding different values.
 */
function checkIndexNow(): void {
    const apiKey = envValue('INDEXNOW_API_KEY');
    const key = envValue('INDEXNOW_KEY');
    if (!apiKey && !key) {
        warn('IndexNow is unconfigured (neither INDEXNOW_KEY nor INDEXNOW_API_KEY). Indexing crons return 200 OK with zero submissions, indistinguishable from success');
        return;
    }
    if (apiKey && key && apiKey !== key) {
        // Not an outage: both the served key file and the submitted key follow
        // INDEXNOW_KEY. It is still worth one line, because the value the
        // engines fetch and the value an operator reads in the dashboard for
        // INDEXNOW_API_KEY would disagree.
        warn('INDEXNOW_KEY and INDEXNOW_API_KEY hold DIFFERENT values. Every reader uses INDEXNOW_KEY, so INDEXNOW_API_KEY is dead weight that will mislead the next reader. Unset it');
        return;
    }
    pass(`IndexNow key is set (${key ? 'INDEXNOW_KEY' : 'INDEXNOW_API_KEY'}; either name is resolved by every reader)`);
}

/**
 * Search Console is read by the gsc-health-check cron and the admin panels.
 * It is NOT what arms the de-indexing crons: historical-deindex reads neither
 * GSC var. lib/gsc-client.ts falls back to GOOGLE_INDEXING_CREDENTIALS for the
 * key, so the key alone is enough; GSC_SITE_URL is the part that is usually
 * wrong, because the fallback guesses the sc-domain property while this repo
 * verifies a URL prefix.
 */
function checkSearchConsoleEnv(): void {
    const hasKey = isSet('GSC_SERVICE_ACCOUNT_KEY') || isSet('GOOGLE_INDEXING_CREDENTIALS');
    if (!hasKey) {
        warn('No Search Console service-account key (GSC_SERVICE_ACCOUNT_KEY, or GOOGLE_INDEXING_CREDENTIALS as fallback). The gsc-health-check cron and the admin Search Console panels skip their work');
        return;
    }
    if (!isSet('GSC_SITE_URL')) {
        warn(`GSC_SITE_URL is not set. lib/gsc-client.ts falls back to 'sc-domain:${brand.domain}', but this repo verifies a URL PREFIX property (public/google*.html), which does not create a domain property. Expect 403 on every Search Console call. Set it to the property you verified, normally ${brand.baseUrl}/`);
        return;
    }
    pass(`Search Console is configured (service-account key + GSC_SITE_URL='${envValue('GSC_SITE_URL')}')`);
}

/**
 * GOOGLE_INDEXING_CREDENTIALS is the only key in this file whose PRESENCE is
 * the risk. It arms app/api/cron/historical-deindex, which runs unattended
 * three times a day and asks Google to remove queued URLs from the index.
 * An operator should be told that here rather than discover it from a traffic
 * drop, so this warns when set and only notes when unset.
 */
function checkGoogleIndexingCredentials(): void {
    if (isSet('GOOGLE_INDEXING_CREDENTIALS')) {
        warn('GOOGLE_INDEXING_CREDENTIALS is SET, which ARMS app/api/cron/historical-deindex: it runs unattended at 01:00, 07:00 and 19:00 and submits URL_DELETED to Google for queued URLs it can prove are gone. Check what is queued before a launch: SELECT status, count(*) FROM deindex_queue GROUP BY status');
        return;
    }
    warn('GOOGLE_INDEXING_CREDENTIALS is not set. Google Indexing API submissions (net-new + URL_DELETED) silently no-op, and the historical-deindex cron returns before it reads its queue, so the backlog stays whole until you arm it');
}

function checkIndexingEnv(): void {
    checkIndexNow();
    checkSearchConsoleEnv();

    if (isSet('BING_WEBMASTER_API_KEY')) {
        pass('BING_WEBMASTER_API_KEY is set');
    } else {
        warn('BING_WEBMASTER_API_KEY is not set. Per-site Bing URL submissions silently no-op');
    }
    if (isSet('BING_WEBMASTER_VERIFICATION')) {
        pass('BING_WEBMASTER_VERIFICATION is set');
    } else {
        warn('BING_WEBMASTER_VERIFICATION is not set. The IndexNow pipeline runs blind (no Bing dashboard visibility into submissions/coverage)');
    }

    checkGoogleIndexingCredentials();
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

// ─── 5. NICHE-COPY DEBT ─────────────────────────────────────────────────────

const MAX_NICHE_DEBT_FILES_LISTED = 15;

/**
 * WARN-only (never FAIL) inventory of reference-niche terms (PMHNP /
 * psychiatric / mental health) still present in production source. Runs on
 * template AND fork: on the template most hits are expected (it IS the
 * reference niche); on a fork every hit is either an intentional specialty
 * mention or copy that still needs rewriting for the new niche.
 */
function checkNicheCopyDebt(): void {
    const debt = scanNicheCopyDebt({ root: ROOT });
    const entries = Object.entries(debt).sort(
        ([fileA, a], [fileB, b]) => b - a || fileA.localeCompare(fileB),
    );
    if (entries.length === 0) {
        pass('no reference-niche terms (PMHNP/psychiatric/mental health) remain in production source');
        return;
    }
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    warn(`${total} reference-niche term occurrence(s) across ${entries.length} file(s) — on a fork, each is EITHER an intentional specialty mention OR copy still written for the template's PMHNP niche; rewrite the latter (derive identity strings from brand.niche tokens), then regenerate the baseline (UPDATE_NICHE_COPY_BASELINE=1 npx vitest run tests/regressions/niche-copy-debt.test.ts). Top ${Math.min(entries.length, MAX_NICHE_DEBT_FILES_LISTED)} file(s) by count:`);
    for (const [file, n] of entries.slice(0, MAX_NICHE_DEBT_FILES_LISTED)) {
        console.log(`       - ${file} (${n})`);
    }
    if (entries.length > MAX_NICHE_DEBT_FILES_LISTED) {
        console.log(`       … and ${entries.length - MAX_NICHE_DEBT_FILES_LISTED} more file(s)`);
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

    section('5. NICHE-COPY DEBT');
    checkNicheCopyDebt();

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
