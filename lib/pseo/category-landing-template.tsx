/**
 * lib/pseo/category-landing-template.tsx
 *
 * Shared landing-page template for the NP taxonomy categories added in the
 * 2026-07 folder migration (see lib/pseo/taxonomy-registry.ts). Each
 * app/jobs/<slug>/page.tsx is a thin wrapper over this template, the same
 * pattern as the [state] wrappers over setting-state-template.
 *
 * Bespoke editorial shipped 2026-07-29 (P1 #5/#6/#16): role narrative,
 * requirements/certification, highlights, and salary positioning come from
 * lib/pseo/category-landing-content.ts; hero art adopts CategoryHero via
 * the CATEGORY_ASSET_REGISTRY contract (clean no-image variant when a slug
 * has no entry); state-eligible categories render a live-inventory-gated
 * "browse by state" mesh; FAQs come from lib/pseo/category-faq-data.ts.
 *
 * Thin-content repair 2026-09-20 (PLAN C.4 item 8, thin-spec-1 section 5):
 * every count on the page comes from getListingFacts over the canonical
 * predicate (LAND-T3). The data bands LAND-L1 (market snapshot), L2 (where
 * the listings are), L3 (practice environment, never on the APRN axis), L4
 * (gated posted pay, replacing the posting mean), L5 (per-axis how to use
 * this page), L6 (related categories with live counts) and L7 (low
 * inventory block) render only when their facts pass their render
 * condition. Titles and descriptions come from lib/pseo/category-metadata.ts
 * and robots from lib/pseo/render-gate.ts, the same gate the sitemap reads.
 * Styling is clay throughout (owner decision 2026-09-20): the shared
 * sections in components/seo/pseo/* plus this file's own clayCard token.
 *
 * QUERY NOTE: the legacy keyword registry (lib/filters.ts CATEGORY_FILTERS)
 * still carries the donor board's keyword set, while the ingest classifier
 * (lib/pseo/category-tagger.ts) now emits the 42-slug NP taxonomy (2026-07
 * classifier migration). For slugs with no keyword entry we gate on the
 * precomputed `categoryTags` column instead of letting
 * buildCategoryWhereClause degrade to "all published jobs", so pages render
 * an honest empty state until those rows are tagged.
 */
import { Prisma } from '@prisma/client';
import { Metadata } from 'next';
import Link from 'next/link';
import {
    Activity, ArrowRight, Baby, Bell, BookOpen, Bone, Brain, Building2, Calendar,
    CheckCircle2, Clock, DollarSign, Globe, GraduationCap, Heart, HeartPulse,
    Home, MapPin, Microscope, Moon, Shield, ShieldCheck, Sun, Syringe, TrendingUp, Users, Zap,
    type LucideIcon,
} from 'lucide-react';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { buildCategoryWhereClause, CATEGORY_FILTERS, CATEGORY_EXTRA_OR } from '@/lib/filters';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount, pluralize } from '@/lib/display-text';
import { STAT_SOURCES } from '@/lib/stats-sources';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import CategoryLocationsExplore from '@/components/seo/CategoryLocationsExplore';
import CategoryHero from '@/components/CategoryHero';
import CategoryFAQ from '@/components/CategoryFAQ';
import {
    ClayCard,
    ClayHead,
    ClayStyles,
    IconWell,
    LocationSpread,
    MarketSnapshot,
    PostedPay,
    clayDesc,
    clayLink,
    clayList,
    clayMeta,
    clayRow,
    employerSentence,
    postedPaySentence,
    type LocationSpreadPlace,
} from '@/components/seo/pseo';
import { isCategoryFaqSlug } from '@/lib/pseo/category-faq-data';
// Asset contract: the registry is owned by the asset pipeline. Entries may
// be absent for a slug (render the clean no-image hero variant). NEVER
// hardcode asset paths here.
import { CATEGORY_ASSET_REGISTRY } from '@/lib/pseo/category-asset-registry';
import { getCategoryLandingContent } from '@/lib/pseo/category-landing-content';
import { ALL_CATEGORY_SLUGS, CATEGORY_AXES, STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { CODE_TO_STATE, STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import { getListingFacts, type ListingFacts, type StateCount } from '@/lib/pseo/listing-facts';
import {
    buildListingsAuthoritySentence,
    buildLiveRolesBadge,
    buildLowInventoryIntro,
    buildRecencySentence,
    buildRelatedCategorySub,
    buildRoleSetup,
    formatK,
} from '@/lib/pseo/listing-narrative';
import {
    buildCategoryLandingDescription,
    buildCategoryLandingTitle,
    labelNoun,
    labelSentence,
} from '@/lib/pseo/category-metadata';
import { getLandingAxisGuide } from '@/lib/pseo/category-axis-guide';
import { MIN_JOBS_FOR_INDEX, shouldIndexListingPage } from '@/lib/pseo/render-gate';

// ─── Category copy ───────────────────────────────────────────────────────────

interface CategoryCopy {
    /** Short label for breadcrumbs / headings (e.g. "Family Practice"). */
    label: string;
    /** Full role name for titles (e.g. "Family Practice Nurse Practitioner (FNP)"). */
    role: string;
    /** One-sentence hero description. TODO(content): per-board editorial copy. */
    blurb: string;
}

/** Labels for the NP slugs introduced by the 2026-07 taxonomy migration. */
export const NEW_CATEGORY_COPY: Record<string, CategoryCopy> = {
    'urgent-care': {
        label: 'Urgent Care',
        role: 'Urgent Care Nurse Practitioner',
        blurb: 'Walk-in clinic and urgent care NP roles with shift-based schedules and episodic acute care.',
    },
    'home-health': {
        label: 'Home Health',
        role: 'Home Health Nurse Practitioner',
        blurb: 'In-home visit NP roles spanning transitional care, chronic disease management, and house-call programs.',
    },
    'family-practice': {
        label: 'Family Practice',
        role: 'Family Practice Nurse Practitioner (FNP)',
        blurb: 'FNP roles across primary care clinics, health systems, and community practices treating patients of all ages.',
    },
    'adult-gerontology': {
        label: 'Adult-Gerontology',
        role: 'Adult-Gerontology Nurse Practitioner (AGNP)',
        blurb: 'AGNP roles in primary and acute care for adult and older-adult populations.',
    },
    pediatric: {
        label: 'Pediatric',
        role: 'Pediatric Nurse Practitioner (PNP)',
        blurb: 'PNP roles in pediatric clinics, children’s hospitals, and specialty practices.',
    },
    neonatal: {
        label: 'Neonatal',
        role: 'Neonatal Nurse Practitioner (NNP)',
        blurb: 'NNP roles in NICUs and newborn care teams at every acuity level.',
    },
    'women-health': {
        label: "Women's Health",
        role: "Women's Health Nurse Practitioner (WHNP)",
        blurb: 'WHNP roles across OB/GYN practices, reproductive health clinics, and women’s health programs.',
    },
    'acute-care': {
        label: 'Acute Care',
        role: 'Acute Care Nurse Practitioner (ACNP)',
        blurb: 'ACNP roles in ICUs, step-down units, and hospital specialty services.',
    },
    emergency: {
        label: 'Emergency',
        role: 'Emergency Nurse Practitioner (ENP)',
        blurb: 'ENP roles in emergency departments, fast tracks, and freestanding ERs.',
    },
    'psychiatric-mental-health': {
        label: 'Psychiatric Mental Health',
        role: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)',
        blurb: 'PMHNP roles spanning outpatient, inpatient, and telepsychiatry settings.',
    },
    oncology: {
        label: 'Oncology',
        role: 'Oncology Nurse Practitioner',
        blurb: 'Oncology NP roles in cancer centers, infusion clinics, and survivorship programs.',
    },
    cardiology: {
        label: 'Cardiology',
        role: 'Cardiology Nurse Practitioner',
        blurb: 'Cardiology NP roles in heart failure clinics, cath lab teams, and cardiovascular practices.',
    },
    'primary-care': {
        label: 'Primary Care',
        role: 'Primary Care Nurse Practitioner',
        blurb: 'Primary care NP roles in outpatient clinics, FQHCs, and value-based care groups.',
    },
    hospitalist: {
        label: 'Hospitalist',
        role: 'Hospitalist Nurse Practitioner',
        blurb: 'Hospitalist NP roles on inpatient medicine teams with rounding and admission coverage.',
    },
    dermatology: {
        label: 'Dermatology',
        role: 'Dermatology Nurse Practitioner',
        blurb: 'Dermatology NP roles in medical, surgical, and cosmetic dermatology practices.',
    },
    orthopedic: {
        label: 'Orthopedic',
        role: 'Orthopedic Nurse Practitioner',
        blurb: 'Orthopedic NP roles in sports medicine, joint replacement, and spine practices.',
    },
    anesthesia: {
        label: 'Nurse Anesthetist',
        role: 'Certified Registered Nurse Anesthetist (CRNA)',
        blurb: 'CRNA roles in hospital ORs, ambulatory surgery centers, and anesthesia groups.',
    },
    midwifery: {
        label: 'Nurse Midwife',
        role: 'Certified Nurse Midwife (CNM)',
        blurb: 'CNM roles in hospital L&D units, birth centers, and midwifery practices.',
    },
    'clinical-nurse-specialist': {
        label: 'Clinical Nurse Specialist',
        role: 'Clinical Nurse Specialist (CNS)',
        blurb: 'CNS roles in quality, education, and specialty practice leadership across health systems.',
    },
    // 2026-07 P1 #15 verticals: labels so the shared template renders real
    // role names instead of the title-case slug fallback.
    aesthetics: {
        label: 'Aesthetics',
        role: 'Aesthetic Nurse Practitioner',
        blurb: 'Aesthetic NP roles in medical spas, dermatology and plastic surgery practices, and NP-owned clinics.',
    },
    'pain-management': {
        label: 'Pain Management',
        role: 'Pain Management Nurse Practitioner',
        blurb: 'Pain management NP roles in interventional pain clinics, spine practices, and hospital pain services.',
    },
    'palliative-hospice': {
        label: 'Palliative & Hospice',
        role: 'Palliative Care & Hospice Nurse Practitioner',
        blurb: 'Palliative and hospice NP roles across hospital consult services, clinics, home programs, and inpatient units.',
    },
};

/** Human label for any registry slug (falls back to title-case). */
export function categorySlugLabel(slug: string): string {
    if (NEW_CATEGORY_COPY[slug]) return NEW_CATEGORY_COPY[slug].label;
    const SPECIAL: Record<string, string> = { va: 'VA', lgbtq: 'LGBTQ+', '1099': '1099' };
    if (SPECIAL[slug]) return SPECIAL[slug];
    return slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Full role name for titles and the H1; the niche noun comes from brand tokens. */
function landingRole(slug: string): string {
    return NEW_CATEGORY_COPY[slug]?.role ?? `${categorySlugLabel(slug)} ${brand.niche.long}`;
}

// ─── Query ───────────────────────────────────────────────────────────────────

function categoryWhere(slug: string): Prisma.JobWhereInput {
    const hasLegacyKeywordFilter =
        (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
    // TODO(content): migrate lib/filters.ts CATEGORY_FILTERS and
    // lib/pseo/category-tagger.ts to the NP taxonomy. Until then, slugs
    // without a keyword entry gate on the precomputed categoryTags column
    // so the page never lists off-category jobs.
    return hasLegacyKeywordFilter
        ? buildCategoryWhereClause(slug)
        : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

/**
 * The one facts load per landing (LAND-T3): getListingFacts composes the
 * canonical predicate and is React cache()d on the scope key, so
 * generateMetadata and the page body share a single set of queries.
 */
function getLandingFacts(slug: string): Promise<ListingFacts> {
    return getListingFacts(`category-landing:${slug}`, categoryWhere(slug));
}

/**
 * Canonical full state name for a raw Job.state value (full names expected;
 * codes tolerated), or null for a value that names no state.
 */
function canonicalStateName(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;
    if (STATE_CODES[value]) return value;
    return CODE_TO_STATE[value.toUpperCase()]
        ?? Object.keys(STATE_CODES).find((name) => name.toLowerCase() === value.toLowerCase())
        ?? null;
}

/** The facts' states folded onto canonical names (unknown values dropped), volume then name. */
function canonicalStates(states: readonly StateCount[]): StateCount[] {
    const counts = new Map<string, number>();
    for (const state of states) {
        const canonical = canonicalStateName(state.name);
        if (!canonical) continue;
        counts.set(canonical, (counts.get(canonical) ?? 0) + state.count);
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ─── State-spoke links (P1 #16: DB-gated category to state mesh) ─────────────

interface StateSpokeLink { href: string; label: string; count: number; }

/**
 * Live-inventory state links for state-eligible categories. Gating rule:
 * a state link renders only when the LIVE jobs table has at least one
 * canonical, on-category job in that state; we never link an empty spoke.
 * (Unlike CategoryLocationsExplore this reads the jobs table directly, so
 * new categories get their state mesh before the pseoStats cron catches up.)
 */
async function getStateSpokeLinks(slug: string): Promise<StateSpokeLink[]> {
    if (!STATE_ELIGIBLE_CATEGORY_SLUGS.includes(slug)) return [];
    const rows = await prisma.job.groupBy({
        by: ['state'],
        where: canonicalBucketWhere(categoryWhere(slug)),
        _count: { state: true },
    });
    // Canonicalize raw state values (full names expected; codes tolerated)
    // and aggregate counts per canonical state.
    const counts = new Map<string, number>();
    for (const row of rows as Array<{ state: string | null; _count: { state: number } }>) {
        const canonical = canonicalStateName(row.state ?? '');
        if (!canonical) continue;
        counts.set(canonical, (counts.get(canonical) ?? 0) + row._count.state);
    }
    return [...counts.entries()]
        .map(([name, count]) => ({
            href: `/jobs/${slug}/${stateToSlug(name)}`,
            label: name,
            count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ─── Related categories (LAND-L6) ────────────────────────────────────────────

interface RelatedCategory { slug: string; label: string; count: number | null; }

/**
 * The axis siblings with their canonical live counts, in one Promise.all.
 * A failed count logs and renders the count-free subtitle instead of a
 * figure, so no card ever states a number the query did not return.
 */
async function getRelatedCategories(slug: string): Promise<RelatedCategory[]> {
    return Promise.all(axisSiblings(slug).map(async (sibling): Promise<RelatedCategory> => {
        let count: number | null = null;
        try {
            count = await prisma.job.count({ where: canonicalBucketWhere(categoryWhere(sibling)) });
        } catch (error) {
            console.error(`[category-landing] sibling count failed for "${sibling}":`, error);
        }
        return { slug: sibling, label: categorySlugLabel(sibling), count };
    }));
}

// ─── Highlight icon map (curated lucide set for editorial content) ───────────

const HIGHLIGHT_ICONS: Record<string, LucideIcon> = {
    Activity, Baby, Bone, Brain, Building2, Calendar, Clock, DollarSign,
    Globe, GraduationCap, Heart, HeartPulse, Home, MapPin, Microscope,
    Moon, Shield, Sun, Syringe, TrendingUp, Users, Zap,
};

// ─── Metadata ────────────────────────────────────────────────────────────────

function parsePage(raw: string | undefined): number {
    return Math.max(1, parseInt(raw || '1', 10) || 1);
}

export async function buildCategoryLandingMetadata(
    slug: string,
    searchParams: { page?: string },
): Promise<Metadata> {
    const role = landingRole(slug);
    const page = parsePage(searchParams.page);
    const facts = await getLandingFacts(slug);
    const totalJobs = facts.total;
    const title = buildCategoryLandingTitle({ role, totalJobs });
    const description = buildCategoryLandingDescription({
        role,
        totalJobs,
        employerCount: facts.distinctEmployers,
        stateCount: canonicalStates(facts.states).length,
        medianK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : null,
    });
    // The OG subtitle carries the live count only at the display floor and
    // never a freshness claim.
    const ogSubtitle = totalJobs >= COUNT_DISPLAY_FLOOR
        ? formatCount(totalJobs, 'open position')
        : 'Role overview, certification requirements and state links';
    return {
        title,
        description,
        // OG images route through the board's own /api/og renderer (the same
        // pattern as app/jobs/va/page.tsx), never a remote storage bucket.
        openGraph: {
            title,
            description,
            type: 'website',
            images: [{
                url: `/api/og?type=page&title=${encodeURIComponent(`${role} Jobs`)}&subtitle=${encodeURIComponent(ogSubtitle)}`,
                width: 1200,
                height: 630,
                alt: `${role} Jobs`,
            }],
        },
        // Self canonical on page 1; paginated views canonical to page 1.
        alternates: { canonical: `${brand.baseUrl}/jobs/${slug}` },
        // thin-spec-1 8.3 / PLAN C.2: index only page 1 at MIN_JOBS_FOR_INDEX
        // or more canonical jobs, through the same gate the sitemap reads.
        // Every other view stays follow and keeps its canonical.
        ...(!shouldIndexListingPage(totalJobs, page) && { robots: { index: false, follow: true } }),
    };
}

// ─── Page component ──────────────────────────────────────────────────────────

const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Band grounds for the new data bands; adjacent bands never share one. */
const MINT_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #E6FFFA 50%, #FDFBF7 100%)';
const PEACH_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #FFF3E8 50%, #FDFBF7 100%)';

/**
 * Sibling slugs from the same taxonomy axis (for the internal-links grid).
 *
 * Deterministic ROTATION, not a head slice: the band starts just after the
 * slug's own axis position and wraps around, so each landing shows a stable,
 * category-seeded window of its axis. Coverage guarantee: every axis slug
 * appears in the bands of the `limit` slugs preceding it (wrapping), so no
 * category hub is stranded without a deterministic inbound link. The old
 * `.filter().slice(0, 6)` head slice left the tail of the 17-slug specialty
 * axis (oncology, cardiology, orthopedic, aesthetics, pain-management,
 * palliative-hospice) out of EVERY landing's band (P6 completeness hole
 * #6). Exported for
 * tests/regressions/p6-nav-mesh-sibling-band-coverage.test.ts, which proves
 * the full-coverage invariant against CATEGORY_AXES.
 */
export function axisSiblings(slug: string, limit = 6): string[] {
    const axis = Object.values(CATEGORY_AXES).find((slugs) => (slugs as readonly string[]).includes(slug));
    if (!axis) return [];
    const slugs = axis as readonly string[];
    const start = slugs.indexOf(slug);
    const rotated = [...slugs.slice(start + 1), ...slugs.slice(0, start)];
    return rotated.slice(0, limit);
}

/**
 * LAND-L2 places: every canonical state in the facts. A category with its
 * own state spokes keeps its mesh band below and shows the sentence alone
 * here, so no state is tiled twice on one page; every other category links
 * each state to its hub, which renders for any state with a job.
 */
function landingPlaces(states: readonly StateCount[], coversStates: boolean): LocationSpreadPlace[] {
    return states.map((state) => ({
        name: state.name,
        count: state.count,
        link: coversStates ? null : { href: `/jobs/state/${stateToSlug(state.name)}`, renders: state.count >= 1 },
    }));
}

interface BandProps {
    id: string;
    eyebrow: string;
    title: string;
    background: string;
    children: React.ReactNode;
}

/** A data band in the page's own chrome: stage ground, eyebrow, Lora H2, then clay cards. */
function Band({ id, eyebrow, title, background, children }: BandProps) {
    return (
        <div style={{ background }}>
            <section aria-labelledby={id} style={{ maxWidth: '1140px', margin: '0 auto', padding: '48px 24px 32px' }}>
                <ClayHead eyebrow={eyebrow} title={title} id={id} />
                {children}
            </section>
        </div>
    );
}

/** LAND-L3: the AANP classification of the listings' states, cited and linked. */
function PracticeEnvironmentCard({ sentence }: { sentence: string }) {
    const aanp = STAT_SOURCES.fullPracticeStates;
    return (
        <ClayCard chip="Practice authority" index={2} icon={ShieldCheck} title="Practice environment of current listings" desc={sentence}>
            <ul className="pseo-clay-list" style={clayList}>
                <li style={clayRow(false)}>
                    <span>Classification</span>
                    <a href={aanp.sourceUrl} target="_blank" rel="noopener noreferrer" style={clayLink}>{aanp.source}</a>
                </li>
                <li style={clayRow(true)}>
                    <Link href="/resources/fpa-guide" style={clayLink}>Full practice authority guide</Link>
                </li>
            </ul>
        </ClayCard>
    );
}

/** LAND-L5: the per-axis paragraph in one clay card (no figures, no claims). */
function AxisGuideCard({ guide }: { guide: string }) {
    return (
        <div
            className="pseo-clay-card"
            style={{ ...clayCard, padding: '28px', display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '860px', margin: '0 auto' }}
        >
            <IconWell icon={BookOpen} />
            <p style={{ ...clayDesc, fontSize: '15px', lineHeight: 1.75 }}>{guide}</p>
        </div>
    );
}

interface LowInventoryBlockProps {
    /** Mid-sentence label, e.g. "family practice". */
    label: string;
    total: number;
    related: RelatedCategory[];
}

/**
 * LAND-L7 (0 to 2 listings): the counted intro, then the axis siblings
 * that clear the index floor, with their live counts. The sidebar's alert
 * card beside this block is the page's one alert CTA. Below the floor the
 * page stays noindex whatever this block says (thin-spec-1 section 8.3).
 */
function LowInventoryBlock({ label, total, related }: LowInventoryBlockProps) {
    const intro = buildLowInventoryIntro({ label, total });
    const open = related.flatMap((category) =>
        category.count !== null && category.count >= MIN_JOBS_FOR_INDEX
            ? [{ ...category, count: category.count }]
            : [],
    );
    // The builder's trailer introduces the sibling list; with no sibling at
    // the floor there is nothing to introduce, so only the count sentence
    // prints and the reader is sent to the full board instead.
    const lead = open.length > 0 ? intro : intro.split(' These related categories')[0];
    return (
        <div style={{ ...clayCard, padding: '32px 28px', marginTop: total > 0 ? '24px' : 0 }}>
            <p style={{ ...clayDesc, fontSize: '15px', margin: 0 }}>{lead}</p>
            {open.length > 0 ? (
                <ul className="pseo-clay-list" style={clayList}>
                    {open.map((category, i) => (
                        <li key={category.slug} style={clayRow(i === open.length - 1)}>
                            <Link href={`/jobs/${category.slug}`} style={clayLink}>{category.label}</Link>
                            <span style={clayMeta}>{buildRelatedCategorySub(category.count)}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p style={{ margin: '16px 0 0', fontSize: '14px' }}>
                    <Link href="/jobs" style={clayLink}>Browse all {brand.niche.short} jobs</Link>
                </p>
            )}
        </div>
    );
}

interface CategoryLandingPageProps {
    slug: string;
    page: number;
}

export default async function CategoryLandingPage({ slug, page }: CategoryLandingPageProps) {
    const copy = NEW_CATEGORY_COPY[slug];
    const label = categorySlugLabel(slug);
    const role = landingRole(slug);
    const noun = labelNoun(slug, label);
    const midSentenceLabel = labelSentence(label);
    const take = 10;
    const skip = (page - 1) * take;

    const [facts, stateLinks, related] = await Promise.all([
        getLandingFacts(slug),
        getStateSpokeLinks(slug),
        getRelatedCategories(slug),
    ]);
    const jobs = facts.total > 0
        ? await prisma.job.findMany({ where: canonicalBucketWhere(categoryWhere(slug)), orderBy: BEST_SORT_ORDER_BY, skip, take })
        : [];

    // Bespoke editorial (P1 #5) + hero art via the asset-registry contract
    // (P1 #6). Both are optional: pages render cleanly without either.
    const content = getCategoryLandingContent(slug);
    const assets = CATEGORY_ASSET_REGISTRY[slug];
    const heroArt = assets?.heroImage ? assets : undefined;
    // When this page renders its own live-DB state mesh, suppress the
    // pseoStats-based "Top States" block in CategoryLocationsExplore so the
    // two never duplicate (cities still render there).
    const coversStates = STATE_ELIGIBLE_CATEGORY_SLUGS.includes(slug);
    const heroBadge = facts.total > 0 ? buildLiveRolesBadge(facts.total) : `${brand.niche.long} Careers`;
    const heroDescription = copy?.blurb
        ?? `Browse ${midSentenceLabel} ${brand.niche.descriptor} positions from employers nationwide.`;
    const heroStats = [
        { value: `${facts.total}`, label: pluralize(facts.total, 'position') },
        ...(facts.distinctEmployers > 0
            ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }]
            : []),
        // The gated median only (T0-3): below the gate the stat is omitted.
        ...(facts.benchmark ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }] : []),
    ];

    // Data bands, each rendered only when its builder returns something.
    const states = canonicalStates(facts.states);
    const snapshotRenders =
        employerSentence({ kind: 'scoped', label: midSentenceLabel, scope: 'nationwide' }, facts) !== null
        || buildRoleSetup({ slug, facts }).rendered
        || buildRecencySentence(facts.recency) !== null;
    const places = landingPlaces(states, coversStates);
    const practiceSentence = buildListingsAuthoritySentence({ slug, states, total: facts.total });
    const locationCards = [places.length > 0, practiceSentence !== null].filter(Boolean).length;
    const payRenders = postedPaySentence({ kind: 'category', slug }, facts) !== null;
    const axisGuide = getLandingAxisGuide(slug);
    const isLowInventory = facts.total < MIN_JOBS_FOR_INDEX;

    // One array drives the BreadcrumbList JSON-LD and the hero's visible,
    // linked trail, so the two can never disagree on labels or URLs.
    const breadcrumbTrail = [
        { name: 'Home', url: brand.baseUrl },
        { name: 'Jobs', url: `${brand.baseUrl}/jobs` },
        { name: label, url: `${brand.baseUrl}/jobs/${slug}` },
    ];

    return (
        <div style={{ backgroundColor: '#FDFBF7' }}>
            <ClayStyles />
            <BreadcrumbSchema items={breadcrumbTrail} />
            <JobListViewTracker
                jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
                listName={`${label} Jobs`}
            />
            {jobs.length > 0 && (
                // Job titles are employer-supplied, so the serialized JSON-LD
                // goes through the repo's \u003c escape chain (same as
                // app/blog/[slug] and app/companies/[slug]): an unescaped
                // </script> in a title would otherwise break out of the block.
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'ItemList',
                    name: `${role} Jobs`,
                    numberOfItems: facts.total,
                    itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                        '@type': 'ListItem',
                        position: idx + 1,
                        name: job.title,
                        url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
                    })),
                }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
            )}

            {/* HERO: CategoryHero art when the asset registry has an entry
                for this slug; clean no-image variant otherwise (P1 #6). */}
            {heroArt ? (
                <CategoryHero
                    bgColor={heroArt.bgColor}
                    heroImage={heroArt.heroImage}
                    heroAlt={`${role} illustration`}
                    badgeText={heroBadge}
                    breadcrumbs={breadcrumbTrail.map((crumb) => ({ label: crumb.name, href: crumb.url }))}
                    indexLabel={`№ ${String(ALL_CATEGORY_SLUGS.indexOf(slug) + 1).padStart(2, '0')} / ${ALL_CATEGORY_SLUGS.length}`}
                    headlineLine1={label}
                    headlineLine2={`${brand.niche.short} Jobs`}
                    headlineSub="find your next role."
                    stats={heroStats}
                    description={heroDescription}
                    ctaLabel={`Browse ${label} Jobs`}
                    ctaHref={`/jobs?category=${slug}`}
                    secondaryCtaLabel="Set Alert"
                    secondaryCtaHref="/job-alerts"
                />
            ) : (
                <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 55%, #FDFBF7 100%)' }}>
                    <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '72px 24px 48px', textAlign: 'center' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
                            {heroBadge}
                        </p>
                        <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15, color: '#1A2E35', marginBottom: '16px' }}>
                            {role} Jobs
                        </h1>
                        <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '640px', margin: '0 auto 28px', lineHeight: 1.6 }}>
                            {heroDescription}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            <Link href={`/jobs?category=${slug}`} className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>
                                Browse {label} Jobs <ArrowRight size={16} />
                            </Link>
                            <Link href="/job-alerts" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', color: '#BE185D', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', border: '1px solid rgba(190,24,93,0.25)' }}>
                                <Bell size={16} /> Set Alert
                            </Link>
                        </div>
                    </section>
                </div>
            )}

            {/* JOB LISTINGS: the grid, the LAND-L7 block below the index floor,
                and a sidebar holding the page's one alert CTA. */}
            <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
                <div className="grid lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3">
                        <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                            {label} Positions ({facts.total})
                        </h2>
                        {jobs.length > 0 && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                                {jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}
                            </div>
                        )}
                        {isLowInventory && (
                            <LowInventoryBlock label={midSentenceLabel} total={facts.total} related={related} />
                        )}
                        {jobs.length > 0 && (
                            <div style={{ textAlign: 'center', marginTop: '32px' }}>
                                <Link href={`/jobs?category=${slug}`} className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>
                                    Browse All {label} Jobs <ArrowRight size={16} />
                                </Link>
                            </div>
                        )}
                    </div>
                    <div className="lg:col-span-1">
                        {/* Alert cadence: /api/cron/send-alerts runs in the daily
                            group (config/cron-schedule.ts), so "daily" is true. */}
                        <div style={{ ...clayCard, padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
                            <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                            <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>{label} Alerts</h3>
                            <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px' }}>New {midSentenceLabel} roles delivered daily.</p>
                            <Link href="/job-alerts" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* LAND-L1 MARKET SNAPSHOT: who is hiring (the former sidebar
                employer list, now with the sentence and company links),
                how the roles are set up, and how current the listings are. */}
            {snapshotRenders && (
                <Band id={`snapshot-${slug}`} eyebrow="Market Snapshot" title={`What current ${noun} listings show`} background="#FDFBF7">
                    <MarketSnapshot slug={slug} label={midSentenceLabel} scope="nationwide" facts={facts} />
                </Band>
            )}

            {/* LAND-L2 WHERE THE LISTINGS ARE + LAND-L3 PRACTICE ENVIRONMENT
                (L3 never on the APRN axis; both need their own floor). */}
            {locationCards > 0 && (
                <Band id={`locations-${slug}`} eyebrow="Locations" title={`Where ${noun} listings are`} background={MINT_STAGE}>
                    <div className={locationCards > 1 ? 'pseo-clay-grid pseo-clay-cols-2' : 'pseo-clay-grid'}>
                        <LocationSpread variant={{ kind: 'landing' }} places={places} title="States with current listings" index={1} />
                        {practiceSentence && <PracticeEnvironmentCard sentence={practiceSentence} />}
                    </div>
                </Band>
            )}

            {/* ═══ BESPOKE EDITORIAL (P1 #5): role narrative, requirements,
                highlights, and salary positioning from category-landing-content ═══ */}
            {content && (
                <>
                    {/* ABOUT THE ROLE + REQUIREMENTS */}
                    <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '32px 24px 8px' }}>
                        <div className="cat-editorial-grid" style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '28px', alignItems: 'start' }}>
                            <section aria-labelledby={`about-${slug}`}>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>The Role</p>
                                <h2 id={`about-${slug}`} className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 700, color: '#1A2E35', marginBottom: '16px' }}>
                                    The {label} role at a glance
                                </h2>
                                {content.intro.map((para, i) => (
                                    <p key={i} style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.75, margin: '0 0 14px' }}>{para}</p>
                                ))}
                            </section>
                            <section aria-labelledby={`requirements-${slug}`} style={{ ...clayCard, padding: '28px' }}>
                                <h2 id={`requirements-${slug}`} className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: '0 0 16px' }}>
                                    Requirements &amp; certification
                                </h2>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {content.requirements.map((item, i) => (
                                        <li key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                            <CheckCircle2 size={17} style={{ color: '#BE185D', flexShrink: 0, marginTop: '2px' }} />
                                            <span style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.55 }}>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    </div>

                    {/* HIGHLIGHTS TRIO */}
                    <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '32px 24px 8px' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Highlights</p>
                        <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
                            Why {label}?
                        </h2>
                        <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                            {content.highlights.map((h, i) => {
                                const Icon = HIGHLIGHT_ICONS[h.icon] ?? Activity;
                                return (
                                    <div key={i} style={{ ...clayCard, padding: '26px 22px' }}>
                                        <Icon size={26} style={{ color: '#BE185D', marginBottom: '12px' }} />
                                        <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>{h.title}</h3>
                                        <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{h.description}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {/* COMPENSATION: the salary narrative (cites BLS only) beside the
                LAND-L4 gated posted-pay card, which replaced the posting mean. */}
            {(content || payRenders) && (
                <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '32px 24px 24px' }}>
                    <div className={content && payRenders ? 'pseo-clay-grid pseo-clay-cols-2' : 'pseo-clay-grid'}>
                        {content && (
                            <div style={{ ...clayCard, padding: '32px' }}>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 6px' }}>Compensation</p>
                                <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{role} salary</h2>
                                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '0 0 12px' }}>{content.salaryNarrative}</p>
                                <Link href="/salary-guide" style={{ fontSize: '13px', fontWeight: 700, color: '#BE185D', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    See the full {brand.niche.short} salary guide <ArrowRight size={14} />
                                </Link>
                            </div>
                        )}
                        {payRenders && (
                            <PostedPay variant={{ kind: 'category', slug }} facts={facts} headingLevel={content ? 3 : 2} />
                        )}
                    </div>
                </div>
            )}

            {/* LAND-L5 HOW TO USE THIS PAGE: one paragraph per taxonomy axis. */}
            {axisGuide && (
                <Band id={`guide-${slug}`} eyebrow="Using This Page" title="How to use this page" background={PEACH_STAGE}>
                    <AxisGuideCard guide={axisGuide} />
                </Band>
            )}

            {/* ═══ BROWSE BY STATE (P1 #16): live-inventory-gated links into
                the /jobs/<category>/<state> spokes ═══ */}
            {stateLinks.length > 0 && (
                <div style={{ background: '#FDFBF7' }}>
                    <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 24px' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>State by State</p>
                        <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '32px' }}>
                            Browse {label} {brand.niche.short} Jobs by State
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
                            {stateLinks.map((link) => (
                                <Link key={link.href} href={link.href} className="cat-state-link" style={{ ...clayCard, borderRadius: '14px', padding: '13px 16px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#1A2E35' }}>{link.label}</span>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D' }}>{link.count}</span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {/* LAND-L6 RELATED CATEGORIES: same taxonomy axis, live counts. */}
            {related.length > 0 && (
                <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
                    <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
                        <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Related Categories</h2>
                        <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                            {related.map((sibling) => (
                                <Link key={sibling.slug} href={`/jobs/${sibling.slug}`} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center' }}>
                                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{sibling.label}</span>
                                    <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{buildRelatedCategorySub(sibling.count ?? 0)}</span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {/* By Location: pseoStats-gated internal links. stateLimit=0 when
                this page already renders its own live-DB state mesh above, so
                the two state blocks never duplicate (cities still render). */}
            <CategoryLocationsExplore categorySlug={slug} categoryLabel={label} stateLimit={coversStates ? 0 : undefined} />

            {/* FAQ + FAQPage schema: builders in lib/pseo/category-faq-data;
                the pay answer receives the gated median only (T14). */}
            {isCategoryFaqSlug(slug) && (
                <CategoryFAQ
                    category={slug}
                    totalJobs={facts.total}
                    avgSalary={facts.benchmark ? facts.benchmark.median : undefined}
                />
            )}

            <style>{`
                .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
                .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
                .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
                .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
                .cat-state-link { transition: transform 0.25s ease, box-shadow 0.25s ease; }
                .cat-state-link:hover { transform: translateY(-2px); box-shadow: 6px 6px 18px rgba(0,0,0,0.09), -3px -3px 10px rgba(255,255,255,0.9) !important; }
                @media (max-width: 768px) { .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; } }
                @media (max-width: 900px) { .cat-editorial-grid { grid-template-columns: 1fr !important; } }
                @media (prefers-reduced-motion: reduce) {
                    .cat-cta-primary, .cat-bento-card, .cat-state-link { transition: none; }
                    .cat-cta-primary:hover, .cat-bento-card:hover, .cat-state-link:hover { transform: none; }
                }
            `}</style>
        </div>
    );
}
