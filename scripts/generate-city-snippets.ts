/**
 * GSC Indexing Crisis (P3.4 — Layer 2): generate LLM-authored snippets for
 * top-N cities and store them in city_snippets / category_city_snippets so
 * the renderer prefers them over the deterministic Layer 1 narrative.
 *
 * Rebuilt for this board (P1 #10): all copy derives from `brand.niche`
 * tokens (config/brand.ts), the per-category taxonomy comes from the live
 * registry (lib/pseo/taxonomy-registry.ts — no local slug/label/hint maps
 * to drift), category context is fed from the Layer 1 leads in
 * lib/pseo/city-narrative.ts (single editorial source of truth), and every
 * generated snippet is validated against the template's reference-niche
 * term scanner (tests/regressions/brand-leak-scan.ts) before it is stored —
 * drafts that leak the donor board's niche terms are rejected, except on
 * the one specialty category page where that terminology is the specialty
 * itself (keyed via PSYCH_SPECIALTY_SLUG, never a literal).
 *
 * Designed for repeated iterative runs — won't redo work you've already done
 * unless you ask it to.
 *
 * Run modes (mutually exclusive — pick one):
 *   (default)            : skip cities that already have an approved snippet
 *                          (default safety — never re-spend $ on done work)
 *   --only-missing       : only generate for cities with NO snippet row at all
 *   --only-unapproved    : re-roll cities whose latest draft is unapproved
 *                          (use when you didn't like the first draft)
 *   --all                : regenerate everything in --top N (forces re-spend)
 *
 * Response cache: the gateway caches seo_content for 30 days keyed on
 * (task, cacheKey) — NOT on promptVersion, which is observability metadata
 * only (lib/ai/cache.ts). So PROMPT_VERSION is a cacheKey part here: bumping
 * it is what actually invalidates every prior response. The two re-roll modes
 * (--only-unapproved, --all) additionally set options.skipCacheRead so
 * "re-roll" / "forces re-spend" mean what they say instead of replaying the
 * identical cached paragraph at $0.
 *
 * Run:
 *   npx tsx scripts/generate-city-snippets.ts --top 3 --dry-run             # render prompts only — no API calls, no DB writes, $0
 *   npx tsx scripts/generate-city-snippets.ts --top 3 --dry-run --with-taxonomy
 *   npx tsx scripts/generate-city-snippets.ts --top 50                      # default mode (skip approved)
 *   npx tsx scripts/generate-city-snippets.ts --top 50 --with-taxonomy      # base + per-taxonomy
 *   npx tsx scripts/generate-city-snippets.ts --top 50 --auto-approve       # auto-flip approved=true
 *   npx tsx scripts/generate-city-snippets.ts --top 100 --only-missing      # add new cities, skip existing
 *   npx tsx scripts/generate-city-snippets.ts --top 50 --only-unapproved    # re-roll rejected drafts
 *
 * Cost basis (documented — do NOT run paid generation casually):
 *   - Task 'seo_content' routes to gpt-5.4 primary (lib/ai/tasks.ts), priced
 *     at $3.00/M input + $15.00/M output tokens (lib/ai/pricing.ts).
 *   - Each generation ≈ 500 input + 250 output tokens →
 *     500×$3/1M + 250×$15/1M ≈ $0.005 per call.
 *   - Calls per city = 1 + N with --with-taxonomy, where N =
 *     CITY_ELIGIBLE_CATEGORY_SLUGS.length (currently 45 categories — the
 *     count is asserted against the live registry by
 *     tests/regressions/p1-snippet-generator-prompt-niche.test.ts, so these
 *     figures can't silently drift as the taxonomy grows).
 *   - Base run:      --top 50                 =    50 calls ≈  $0.25
 *   - Taxonomy run:  --top 50 --with-taxonomy = 50 × (1 + 45)
 *                    = 2,300 calls            ≈ $11.50
 *   - MAX_SPEND_USD hard-caps a run at $25 (an accidental 1,000-city
 *     taxonomy run would be 46,000 calls ≈ $230 — the cap refuses it up
 *     front). Every run prints its exact planned call count and estimated
 *     cost before spending; --dry-run prints the same figures for $0.
 *
 * Throughput ceiling (READ THIS BEFORE PLANNING A BATCH):
 *   - Dollars are NOT the binding constraint — the rate limit is.
 *     TASK_REGISTRY.seo_content.rateLimit caps live calls at 30 per hour
 *     (lib/ai/tasks.ts); past that the gateway throws rate_limited.
 *   - This script mirrors that sliding window client-side: the first 30 live
 *     calls run at full speed, then it paces one call per window/limit
 *     (currently 120s) and retries with exponential back-off if the window is
 *     more exhausted than the local ledger thought (e.g. an earlier run in the
 *     same hour). Cache hits don't consume the window, so they aren't paced.
 *   - Practical cadence at 30/hour:
 *       --top 50                  =    50 calls ≈ 40m wall clock
 *       --top 50 --with-taxonomy  = 2,300 calls ≈ 76h wall clock
 *     Run the taxonomy sweep in per-hour batches, not one invocation. Every
 *     run prints its projected wall clock alongside the cost estimate.
 *   - Interrupting is safe and resuming is cheap: the run-mode filters skip
 *     work already stored, so Ctrl-C and re-run picks up where it stopped
 *     (in the default / --only-missing modes — the re-roll modes intentionally
 *     redo everything in --top N).
 *
 * Generated snippets land with approvedAt = NULL by default — renderer skips
 * un-approved drafts and falls back to Layer 1. Use scripts/approve-snippets.ts
 * to review and approve in bulk. Use scripts/diff-snippets.ts to compare
 * Layer 1 vs Layer 2 for a city before approving.
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.prod' });

import { brand } from '@/config/brand';
import {
    CATEGORY_AXES,
    CITY_ELIGIBLE_CATEGORY_SLUGS,
    PSYCH_SPECIALTY_SLUG,
} from '@/lib/pseo/taxonomy-registry';
import {
    buildCityFacts,
    getTaxonomyLead,
    type CityNarrativeFacts,
} from '@/lib/pseo/city-narrative';
// Same scanner the niche-copy ratchet + scripts/fork-preflight.ts use — ONE
// source of truth for what counts as a reference-niche term.
import { TEMPLATE_REFERENCE_NICHE_TERMS } from '../tests/regressions/brand-leak-scan';
// Registry only — lib/ai/tasks.ts is a plain data table whose sole imports are
// `import type`, so pulling it in does NOT load the gateway, provider clients,
// cost tracker, or rate limiter. Keeps --dry-run gateway-free (see below).
import { TASK_REGISTRY } from '@/lib/ai/tasks';
// AiGatewayError is a value import, but lib/ai/types.ts declares only types +
// this one error class and its sole import is `import type { ZodType }` — so
// it pulls in no provider client, cost tracker, or rate limiter either.
import { AiGatewayError } from '@/lib/ai/types';
import type { AiTenant, CompleteRequest, CompleteResponse } from '@/lib/ai/types';

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const WITH_TAXONOMY = process.argv.includes('--with-taxonomy');
const AUTO_APPROVE = process.argv.includes('--auto-approve');
const ONLY_MISSING = process.argv.includes('--only-missing');
const ONLY_UNAPPROVED = process.argv.includes('--only-unapproved');
const FORCE_ALL = process.argv.includes('--all');
const topIdx = process.argv.indexOf('--top');
const TOP_N = topIdx > 0 ? parseInt(process.argv[topIdx + 1], 10) || 50 : 50;

// Validate mutually-exclusive mode flags.
const modeFlags = [ONLY_MISSING, ONLY_UNAPPROVED, FORCE_ALL].filter(Boolean).length;
if (modeFlags > 1) {
    console.error('Pass at most one of: --only-missing, --only-unapproved, --all');
    process.exit(1);
}

type RunMode = 'skip-approved' | 'only-missing' | 'only-unapproved' | 'all';
const RUN_MODE: RunMode = ONLY_MISSING ? 'only-missing'
    : ONLY_UNAPPROVED ? 'only-unapproved'
    : FORCE_ALL ? 'all'
    : 'skip-approved';

// Per-call cost guard — refuse to run if estimated spend exceeds this cap.
// See the header's "Cost basis" section for the derivation ($3/M input +
// $15/M output on the seo_content primary; ~500 in / ~250 out per call).
const MAX_SPEND_USD = 25;
const COST_PER_CALL_USD = 0.005;
const MIN_SNIPPET_LENGTH = 50;

const AI_TASK = 'seo_content' as const;

/**
 * Prompt revision. Bump on ANY change to SYSTEM_PROMPT / buildCityPrompt /
 * buildTaxonomyPrompt.
 *
 * This is deliberately one constant feeding BOTH `promptVersion` and the
 * `cacheKey`, because the gateway's cache hashes only (task, cacheKey) —
 * `promptVersion` is logged to ai_call_log and never keyed (lib/ai/cache.ts).
 * With a 30-day seo_content TTL, a version bump that isn't in the cacheKey
 * would silently replay every response written under the OLD prompt. Keeping
 * the two wired to one constant makes that drift impossible.
 */
export const PROMPT_VERSION = 'v2';

/**
 * Background/cron identity. `tenant` is an AiTenant object, not a string —
 * recordAiCall writes tenant.id / tenant.type into ai_call_log's non-null
 * tenant_id / tenant_type columns, and the rate-limit bucket is keyed on both.
 */
export const AI_TENANT: AiTenant = { type: 'system', id: 'generate-city-snippets' };

// ─── Throughput pacing (mirrors the gateway's sliding window) ───────────────

/** Live-call ceiling for this task, read from the live registry (no local copy). */
const RATE_LIMIT = TASK_REGISTRY[AI_TASK].rateLimit;
const RATE_LIMIT_WINDOW_MS = RATE_LIMIT.windowSeconds * 1000;
/** Steady-state spacing once the window is saturated. */
export const MIN_CALL_INTERVAL_MS = Math.ceil(RATE_LIMIT_WINDOW_MS / RATE_LIMIT.limit);
/** Clock-skew guard so we never wake a hair before the slot actually frees. */
const SLOT_WAIT_PADDING_MS = 1_000;
const RATE_LIMIT_MAX_RETRIES = 4;

type PrismaModule = typeof import('@/lib/prisma');
let prismaCache: PrismaModule['prisma'] | null = null;
async function getPrisma() {
    if (!prismaCache) prismaCache = (await import('@/lib/prisma')).prisma;
    return prismaCache;
}

// ─── Taxonomy labels (derived from the live registry slugs) ─────────────────

const APRN_ROLE_SLUGS: ReadonlySet<string> = new Set<string>(CATEGORY_AXES.aprn);

/**
 * Slug → display label. Overrides carry the labels that title-casing the
 * slug can't reach; everything else derives mechanically so new registry
 * entries need no edit here.
 *
 * Source of truth is ALL_CATEGORY_CONFIGS[slug].label in
 * lib/pseo/category-city-template.tsx — the same label the page renders.
 * That module is NOT imported here on purpose: it pulls the Next/React
 * page tree and a module-scope Prisma client (import throws outright when
 * DATABASE_URL is unset), which would make --dry-run fail before printing
 * a single prompt. Instead the parity is asserted for every city-eligible
 * slug by tests/regressions/p1-snippet-generator-prompt-niche.test.ts, so
 * a new category whose label isn't mechanically derivable fails CI here
 * rather than shipping a mislabeled prompt.
 */
const LABEL_OVERRIDES: Record<string, string> = {
    '1099': '1099',
    'va': 'VA',
    'lgbtq': 'LGBTQ+',
    'women-health': "Women's Health",
    'anesthesia': 'Nurse Anesthetist',
    'midwifery': 'Nurse Midwife',
    'clinical-nurse-specialist': 'Clinical Nurse Specialist',
    // Hyphenated / ampersand labels — title-casing the slug loses the mark.
    'full-time': 'Full-Time',
    'part-time': 'Part-Time',
    'entry-level': 'Entry-Level',
    'mid-career': 'Mid-Career',
    'adult-gerontology': 'Adult-Gerontology',
    'palliative-hospice': 'Palliative & Hospice',
};

export function taxonomyLabel(slug: string): string {
    const override = LABEL_OVERRIDES[slug];
    if (override) return override;
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Page-title phrase for a category×city page. APRN cohort roles (CRNA /
 * CNM / CNS) are their own credential — never "<Label> ${short}".
 */
export function taxonomyPageTitle(slug: string, cityName: string, stateCode: string): string {
    const label = taxonomyLabel(slug);
    const rolePhrase = APRN_ROLE_SLUGS.has(slug) ? label : `${label} ${brand.niche.short}`;
    return `${rolePhrase} Jobs in ${cityName}, ${stateCode}`;
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an SEO content writer for ${brand.name}, a ${brand.niche.descriptor} (${brand.niche.short}) job board covering all ${brand.niche.short} specialties plus the wider APRN cohort (CRNA, CNM, CNS). Write concise, factual paragraphs about ${brand.niche.category} job markets in specific U.S. cities.

Style rules:
- 2-4 sentences, 60-120 words total
- Plain prose only (no markdown, no headings, no bullet lists)
- US English, third person, no first-person ("I", "we")
- No salesy claims ("the best", "premier")
- Use ONLY the facts and category context provided — never invent numbers, salary figures, employers, program names, or certification requirements
- Write for the page's stated role and specialty — do not drift into other specialties
- If a fact contradicts an obvious claim, prefer the fact

Output: just the paragraph. No preamble, no quotation marks, no explanation.`;

export interface CityFactBlock {
    cityName: string;
    stateName: string;
    stateCode: string;
    population: number;
    costOfLivingIndex: number;
    medianIncome: number;
    metroArea: string | null;
    shortageArea: boolean;
    healthcareSystems: string[];
    /**
     * Authority LEVEL only. The free-text `details` prose in
     * lib/state-practice-authority.ts still reads as donor-board copy, so
     * prompts render the enum and let the model phrase it — exactly like
     * Layer 1's AUTHORITY_PHRASES approach in lib/pseo/city-narrative.ts.
     */
    practiceAuthority: 'full' | 'reduced' | 'restricted' | null;
}

/** One mapping from the Layer 1 fact provider into the prompt fact block. */
export function toCityFactBlock(facts: CityNarrativeFacts): CityFactBlock {
    return {
        cityName: facts.city.name,
        stateName: facts.city.state,
        stateCode: facts.city.stateCode,
        population: facts.city.population,
        costOfLivingIndex: facts.city.costOfLivingIndex,
        medianIncome: facts.city.medianIncome,
        metroArea: facts.city.metroArea,
        shortageArea: facts.shortage,
        healthcareSystems: facts.topEmployers,
        practiceAuthority: facts.practiceAuthority,
    };
}

export function buildCityPrompt(facts: CityFactBlock, totalJobs: number): string {
    return [
        `Write a market-context paragraph for the page "${brand.niche.short} Jobs in ${facts.cityName}, ${facts.stateCode}".`,
        ``,
        `Facts:`,
        `- City: ${facts.cityName}, ${facts.stateCode} (${facts.stateName})`,
        `- Population: ${facts.population.toLocaleString('en-US')}`,
        facts.metroArea ? `- Metro area: ${facts.metroArea}` : null,
        `- Cost of living index: ${facts.costOfLivingIndex} (US average = 100)`,
        facts.medianIncome > 0 ? `- Median household income: $${facts.medianIncome.toLocaleString('en-US')}` : null,
        `- HRSA-designated Health Professional Shortage Area: ${facts.shortageArea ? 'Yes — federally designated' : 'No'}`,
        facts.practiceAuthority ? `- ${facts.stateName} ${brand.niche.short} practice authority: ${facts.practiceAuthority}` : null,
        facts.healthcareSystems.length > 0 ? `- Major healthcare employers: ${facts.healthcareSystems.slice(0, 4).join(', ')}` : null,
        `- Active ${brand.niche.short} listings on this page: ${totalJobs}`,
        ``,
        `Mention shortage status if Yes (it implies NHSC loan repayment eligibility).`,
        `Mention practice authority because it directly shapes ${brand.niche.short} scope and earning potential.`,
    ].filter(Boolean).join('\n');
}

export function buildTaxonomyPrompt(
    facts: CityFactBlock,
    narrativeFacts: CityNarrativeFacts,
    taxonomySlug: string,
    totalJobs: number,
): string {
    const label = taxonomyLabel(taxonomySlug);
    // Layer 1 lead = the deterministic editorial context already shipped on
    // these pages (lib/pseo/city-narrative.ts). Reusing it keeps Layer 2
    // grounded in the same reviewed claims instead of a stale local map.
    const lead = getTaxonomyLead(taxonomySlug, narrativeFacts);
    return [
        `Write a market-context paragraph for the page "${taxonomyPageTitle(taxonomySlug, facts.cityName, facts.stateCode)}".`,
        ``,
        `The page lists ${label} positions specifically — open with the category-specific compensation/benefit nuance, then ground it in the city facts.`,
        ``,
        `Facts:`,
        `- City: ${facts.cityName}, ${facts.stateCode}`,
        `- Population: ${facts.population.toLocaleString('en-US')}`,
        `- Cost of living index: ${facts.costOfLivingIndex} (US average = 100)`,
        `- HRSA-designated Health Professional Shortage Area: ${facts.shortageArea ? 'Yes' : 'No'}`,
        // The board niche's practice-authority ladder does not govern the APRN
        // cohort roles (CRNA / CNM / CNS licensure is regulated separately) —
        // omit the fact on those pages rather than misapply it.
        facts.practiceAuthority && !APRN_ROLE_SLUGS.has(taxonomySlug)
            ? `- ${facts.stateName} ${brand.niche.short} practice authority: ${facts.practiceAuthority}`
            : null,
        `- Active listings on this page: ${totalJobs}`,
        ``,
        `Category context (from our editorial system — reword it, do not copy verbatim, and do not add claims beyond it):`,
        lead ?? `- Conventional W-2 ${brand.niche.descriptor} employment; no category-specific compensation structure.`,
    ].filter(Boolean).join('\n');
}

// ─── Gateway request builders ───────────────────────────────────────────────

/**
 * The two re-roll modes exist to produce DIFFERENT copy ("use when you didn't
 * like the first draft" / "forces re-spend"). A cache hit would hand back the
 * byte-identical paragraph at $0, so they skip the cache read. The gateway
 * still WRITES the fresh response, so the stale entry is replaced rather than
 * left to serve the next run.
 */
export function isReRollMode(mode: RunMode): boolean {
    return mode === 'all' || mode === 'only-unapproved';
}

export function buildCityRequest(
    citySlug: string,
    facts: CityFactBlock,
    totalJobs: number,
    mode: RunMode,
): CompleteRequest {
    return {
        task: AI_TASK,
        tenant: AI_TENANT,
        promptId: 'pseo_city_narrative',
        promptVersion: PROMPT_VERSION,
        // PROMPT_VERSION is a key part on purpose — see its docblock.
        cacheKey: ['city', PROMPT_VERSION, citySlug, totalJobs],
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildCityPrompt(facts, totalJobs) },
        ],
        ...(isReRollMode(mode) && { options: { skipCacheRead: true } }),
    };
}

export function buildTaxonomyRequest(
    citySlug: string,
    facts: CityFactBlock,
    narrativeFacts: CityNarrativeFacts,
    taxonomySlug: string,
    totalJobs: number,
    mode: RunMode,
): CompleteRequest {
    return {
        task: AI_TASK,
        tenant: AI_TENANT,
        promptId: 'pseo_taxcity_narrative',
        promptVersion: PROMPT_VERSION,
        cacheKey: ['taxcity', PROMPT_VERSION, taxonomySlug, citySlug, totalJobs],
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildTaxonomyPrompt(facts, narrativeFacts, taxonomySlug, totalJobs) },
        ],
        ...(isReRollMode(mode) && { options: { skipCacheRead: true } }),
    };
}

// ─── Throughput pacing (client mirror of the gateway's sliding window) ──────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Projected wall clock to land `calls` live calls under the task's rate limit. */
export function estimateWallClockMs(calls: number): number {
    if (calls <= RATE_LIMIT.limit) return 0;
    return (calls - RATE_LIMIT.limit) * MIN_CALL_INTERVAL_MS;
}

export function formatDuration(ms: number): string {
    if (ms <= 0) return 'immediate';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** True for the gateway's rate-limit rejection specifically. */
export function isRateLimitError(err: unknown): boolean {
    return err instanceof AiGatewayError && err.code === 'rate_limited';
}

/**
 * Timestamps of live calls believed to still be inside the server's window.
 * The server allows RATE_LIMIT.limit calls per window, so the first N run at
 * full speed and only a saturated window pays the wait.
 */
let liveCallTimestamps: readonly number[] = [];

function recordLiveCall(): void {
    liveCallTimestamps = [...liveCallTimestamps, Date.now()];
}

/** Exposed so tests can run the pacing logic from a known state. */
export function __resetRateLimitLedger(): void {
    liveCallTimestamps = [];
}

async function awaitRateLimitSlot(onWait: WaitReporter): Promise<void> {
    for (;;) {
        const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
        liveCallTimestamps = liveCallTimestamps.filter((t) => t > cutoff);
        if (liveCallTimestamps.length < RATE_LIMIT.limit) return;
        const waitMs = liveCallTimestamps[0] - cutoff + SLOT_WAIT_PADDING_MS;
        onWait(waitMs, 'slot');
        await sleep(waitMs);
    }
}

export type WaitReporter = (ms: number, reason: 'slot' | 'backoff') => void;
export type CompleteFn = (req: CompleteRequest) => Promise<CompleteResponse>;

/**
 * Rate-limit-aware wrapper around the gateway's `complete`.
 *
 * Without this the run simply stops producing snippets: seo_content allows
 * RATE_LIMIT.limit live calls per window and `complete` throws
 * AiGatewayError('rate_limited') the moment the window is exhausted — which
 * the per-item try/catch below would quietly tally as a failure, so a
 * --with-taxonomy sweep would report thousands of "✗ ... rate limit exceeded".
 */
export async function completePaced(
    completeFn: CompleteFn,
    req: CompleteRequest,
    onWait: WaitReporter,
): Promise<CompleteResponse> {
    for (let attempt = 0; ; attempt++) {
        await awaitRateLimitSlot(onWait);
        try {
            const res = await completeFn(req);
            // Cache hits are served before the limiter runs (lib/ai/gateway.ts
            // §1 vs §2), so they cost nothing against the window.
            if (!res.cacheHit) recordLiveCall();
            return res;
        } catch (err) {
            if (!isRateLimitError(err) || attempt >= RATE_LIMIT_MAX_RETRIES) throw err;
            // The real window is further along than the local ledger knew — an
            // earlier run in the same hour, or another process on this tenant
            // bucket. Charge the ledger (conservative: over-pace rather than
            // hammer the limiter) and back off before re-checking for a slot.
            const backoffMs = MIN_CALL_INTERVAL_MS * 2 ** attempt;
            onWait(backoffMs, 'backoff');
            recordLiveCall();
            await sleep(backoffMs);
        }
    }
}

// ─── Output validation (reference-niche leakage guard) ──────────────────────

/** All matches of the template's reference-niche terms in `text`. */
export function findDonorNicheTerms(text: string): string[] {
    const leaks: string[] = [];
    for (const re of TEMPLATE_REFERENCE_NICHE_TERMS) {
        const matches = text.match(new RegExp(re.source, re.flags));
        if (matches) leaks.push(...matches);
    }
    return leaks;
}

export interface SnippetValidation {
    ok: boolean;
    reason?: string;
}

/**
 * Reject drafts that are too short or that leak the donor board's niche
 * terms. The single specialty category whose subject matter IS that niche
 * (resolved via PSYCH_SPECIALTY_SLUG — never a literal) is exempt from the
 * term check, matching the visible copy on its own landing pages.
 */
export function validateSnippetBody(
    body: string | null | undefined,
    categorySlug?: string,
): SnippetValidation {
    const trimmed = body?.trim() ?? '';
    if (trimmed.length < MIN_SNIPPET_LENGTH) {
        return { ok: false, reason: 'empty/short response' };
    }
    const isSanctionedSpecialtyPage =
        categorySlug !== undefined
        && PSYCH_SPECIALTY_SLUG !== undefined
        && categorySlug === PSYCH_SPECIALTY_SLUG;
    if (!isSanctionedSpecialtyPage) {
        const leaks = findDonorNicheTerms(trimmed);
        if (leaks.length > 0) {
            const unique = [...new Set(leaks.map((t) => t.toLowerCase()))];
            return { ok: false, reason: `reference-niche term leakage: ${unique.join(', ')}` };
        }
    }
    return { ok: true };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const prisma = await getPrisma();

    // Pick top-N cities by current active-job count.
    const cityRows = await prisma.job.groupBy({
        by: ['city', 'state'],
        where: {
            isPublished: true,
            OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } },
            ],
            city: { not: null },
            state: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: TOP_N,
    });

    const { CITIES } = await import('@/lib/pseo/city-data/cities');

    // Resolve each (city, state) pair to a CITIES entry by name + state.
    const allTargets: { citySlug: string; cityName: string; stateName: string; stateCode: string; totalJobs: number; facts: CityNarrativeFacts }[] = [];
    for (const row of cityRows) {
        if (!row.city || !row.state) continue;
        const match = CITIES.find(
            (c) => c.name.toLowerCase() === row.city!.toLowerCase()
                && c.state.toLowerCase() === row.state!.toLowerCase()
        );
        if (!match) continue;
        allTargets.push({
            citySlug: match.slug,
            cityName: match.name,
            stateName: match.state,
            stateCode: match.stateCode,
            totalJobs: row._count._all,
            facts: buildCityFacts(match),
        });
    }

    // Apply run-mode filter against existing snippet state.
    // Pull every snippet row in one query so we don't issue per-city lookups.
    const existingCitySnippets = new Map<string, { approvedAt: Date | null }>();
    const allSnippetRows = await prisma.citySnippet.findMany({
        where: { citySlug: { in: allTargets.map((t) => t.citySlug) } },
        select: { citySlug: true, approvedAt: true },
    });
    for (const r of allSnippetRows) existingCitySnippets.set(r.citySlug, { approvedAt: r.approvedAt });

    const targets = allTargets.filter((t) => {
        const existing = existingCitySnippets.get(t.citySlug);
        switch (RUN_MODE) {
            case 'only-missing':
                return !existing;
            case 'only-unapproved':
                return existing && !existing.approvedAt;
            case 'skip-approved':
                // Skip if already approved (don't re-spend); generate if missing or unapproved.
                return !existing || !existing.approvedAt;
            case 'all':
                return true;
        }
    });

    const skipped = allTargets.length - targets.length;
    if (skipped > 0) {
        console.log(`Filter mode: ${RUN_MODE} → skipping ${skipped} cities (already in desired state).`);
    }

    // Same pre-fetch for per-(taxonomy, city) snippets so we can apply the
    // mode filter on the inner loop too.
    const existingTaxSnippets = new Map<string, { approvedAt: Date | null }>();
    if (WITH_TAXONOMY && targets.length > 0) {
        const taxRows = await prisma.categoryCitySnippet.findMany({
            where: { citySlug: { in: targets.map((t) => t.citySlug) } },
            select: { categorySlug: true, citySlug: true, approvedAt: true },
        });
        for (const r of taxRows) {
            existingTaxSnippets.set(`${r.categorySlug}|${r.citySlug}`, { approvedAt: r.approvedAt });
        }
    }
    function shouldGenerateTaxonomy(tax: string, citySlug: string): boolean {
        const existing = existingTaxSnippets.get(`${tax}|${citySlug}`);
        switch (RUN_MODE) {
            case 'only-missing': return !existing;
            case 'only-unapproved': return !!existing && !existing.approvedAt;
            case 'skip-approved': return !existing || !existing.approvedAt;
            case 'all': return true;
        }
    }

    // Calculate exact call count based on the run-mode filter. The taxonomy
    // loop iterates the LIVE registry's city-eligible slugs — never a local
    // copy that can go stale.
    const baseCalls = targets.length;
    let taxCalls = 0;
    if (WITH_TAXONOMY) {
        for (const t of targets) {
            for (const tax of CITY_ELIGIBLE_CATEGORY_SLUGS) {
                if (shouldGenerateTaxonomy(tax, t.citySlug)) taxCalls++;
            }
        }
    }
    const totalCalls = baseCalls + taxCalls;
    const estCost = totalCalls * COST_PER_CALL_USD;
    console.log(`Targets: ${targets.length} cities (after ${RUN_MODE} filter)`);
    console.log(`Mode: ${WITH_TAXONOMY ? `base + per-taxonomy (${CITY_ELIGIBLE_CATEGORY_SLUGS.length} categories)` : 'base only'}`);
    console.log(`Base-city calls: ${baseCalls}${WITH_TAXONOMY ? `,  per-taxonomy calls: ${taxCalls}` : ''}`);
    console.log(`Total LLM calls planned: ${totalCalls}`);
    console.log(`Estimated cost: ~$${estCost.toFixed(2)}`);
    console.log(
        `Throughput ceiling: ${RATE_LIMIT.limit} live calls / ${RATE_LIMIT.windowSeconds}s`
        + ` → projected wall clock ~${formatDuration(estimateWallClockMs(totalCalls))}`
        + ` (paced automatically; Ctrl-C is safe — re-run resumes)`,
    );
    console.log(`Cache: ${isReRollMode(RUN_MODE) ? `bypassed on read (${RUN_MODE} re-rolls fresh copy)` : `enabled (prompt ${PROMPT_VERSION})`}`);
    console.log(`Auto-approve: ${AUTO_APPROVE ? 'YES (skips human review)' : 'NO (rows insert with approvedAt = NULL)'}`);

    if (totalCalls === 0) {
        console.log(`\nNothing to generate. All targets are already in the desired state for mode "${RUN_MODE}".`);
        return;
    }

    if (!DRY && estCost > MAX_SPEND_USD) {
        console.error(`\n✗ Estimated cost $${estCost.toFixed(2)} exceeds MAX_SPEND_USD ($${MAX_SPEND_USD}). Reduce --top or omit --with-taxonomy.`);
        process.exit(1);
    }

    if (DRY) {
        console.log(`\n--dry-run: rendering every prompt that WOULD be sent — no API calls, no DB writes, $0 spent.`);
        console.log(`\n════ SYSTEM PROMPT (shared by every call) ════\n${SYSTEM_PROMPT}`);
        for (const target of targets) {
            const factBlock = toCityFactBlock(target.facts);
            console.log(`\n════ ${target.citySlug} (${target.cityName}, ${target.stateCode}) — ${target.totalJobs} jobs — base city prompt ════`);
            console.log(buildCityPrompt(factBlock, target.totalJobs));
            if (!WITH_TAXONOMY) continue;
            for (const tax of CITY_ELIGIBLE_CATEGORY_SLUGS) {
                if (!shouldGenerateTaxonomy(tax, target.citySlug)) continue;
                console.log(`\n──── ${target.citySlug} × ${tax} ────`);
                console.log(buildTaxonomyPrompt(factBlock, target.facts, tax, target.totalJobs));
            }
        }
        console.log(`\n--dry-run complete: ${totalCalls} prompt(s) rendered (est. ~$${estCost.toFixed(2)} if run for real).`);
        return;
    }

    // Imported only past the --dry-run return: a dry run must not so much as
    // load the AI gateway (provider clients, cost tracker, rate limiter).
    const { complete } = await import('@/lib/ai/gateway');

    const reportWait: WaitReporter = (ms, reason) => {
        console.log(
            reason === 'slot'
                ? `  … rate-limit window full (${RATE_LIMIT.limit}/${RATE_LIMIT.windowSeconds}s) — waiting ${formatDuration(ms)} for the next slot`
                : `  … gateway returned rate_limited — backing off ${formatDuration(ms)} before retry`,
        );
    };

    let cityOk = 0;
    let cityFail = 0;
    let taxOk = 0;
    let taxFail = 0;

    for (const target of targets) {
        const factBlock = toCityFactBlock(target.facts);

        // Base city snippet
        try {
            const res = await completePaced(
                complete,
                buildCityRequest(target.citySlug, factBlock, target.totalJobs, RUN_MODE),
                reportWait,
            );
            const body = res.content?.trim();
            const verdict = validateSnippetBody(body);
            if (body && verdict.ok) {
                await prisma.citySnippet.upsert({
                    where: { citySlug: target.citySlug },
                    update: {
                        body,
                        sourceModel: res.model,
                        generatedAt: new Date(),
                        ...(AUTO_APPROVE && { approvedAt: new Date() }),
                    },
                    create: {
                        citySlug: target.citySlug,
                        body,
                        sourceModel: res.model,
                        approvedAt: AUTO_APPROVE ? new Date() : null,
                    },
                });
                cityOk++;
                console.log(`  ✓ ${target.citySlug} (city)`);
            } else {
                cityFail++;
                console.error(`  ✗ ${target.citySlug} (city) — rejected: ${verdict.reason}`);
            }
        } catch (err) {
            cityFail++;
            console.error(`  ✗ ${target.citySlug} (city) — ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!WITH_TAXONOMY) continue;

        for (const tax of CITY_ELIGIBLE_CATEGORY_SLUGS) {
            if (!shouldGenerateTaxonomy(tax, target.citySlug)) continue;
            try {
                const res = await completePaced(
                    complete,
                    buildTaxonomyRequest(target.citySlug, factBlock, target.facts, tax, target.totalJobs, RUN_MODE),
                    reportWait,
                );
                const body = res.content?.trim();
                const verdict = validateSnippetBody(body, tax);
                if (body && verdict.ok) {
                    await prisma.categoryCitySnippet.upsert({
                        where: {
                            categorySlug_citySlug: { categorySlug: tax, citySlug: target.citySlug },
                        },
                        update: {
                            body,
                            sourceModel: res.model,
                            generatedAt: new Date(),
                            ...(AUTO_APPROVE && { approvedAt: new Date() }),
                        },
                        create: {
                            categorySlug: tax,
                            citySlug: target.citySlug,
                            body,
                            sourceModel: res.model,
                            approvedAt: AUTO_APPROVE ? new Date() : null,
                        },
                    });
                    taxOk++;
                } else {
                    taxFail++;
                    console.error(`  ✗ ${target.citySlug} × ${tax} — rejected: ${verdict.reason}`);
                }
            } catch (err) {
                taxFail++;
                console.error(`  ✗ ${target.citySlug} × ${tax} — ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        console.log(`  …${target.citySlug} done (taxonomy ok=${taxOk}, fail=${taxFail})`);
    }

    console.log(`\nDone.`);
    console.log(`  City snippets:     ok=${cityOk}, fail=${cityFail}`);
    if (WITH_TAXONOMY) console.log(`  Taxonomy snippets: ok=${taxOk}, fail=${taxFail}`);
    if (!AUTO_APPROVE) {
        console.log(`\n${cityOk + taxOk} rows inserted with approvedAt = NULL — they won't render until approved.`);
        console.log(`To approve a single row: UPDATE city_snippets SET approved_at = NOW() WHERE city_slug = '...';`);
        console.log(`To approve all rows generated this run: UPDATE city_snippets SET approved_at = NOW() WHERE generated_at >= NOW() - INTERVAL '1 hour' AND approved_at IS NULL;`);
    }
}

// Only run when invoked as a script (npx tsx scripts/generate-city-snippets.ts).
// Importing the prompt builders / validator from a unit test must NOT trigger
// generation (same guard as scripts/scan-prompt-pii.ts).
if (typeof require !== 'undefined' && require.main === module) {
    main()
        .catch((err) => { console.error(err); process.exit(1); })
        .finally(async () => { if (prismaCache) await prismaCache.$disconnect(); });
}
