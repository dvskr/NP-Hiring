/**
 * CE/CEU-by-state hub — deterministic generator (P2 content pillars,
 * audit §6-A "NP CE/CEU Requirements by State" + P3 #5 partial).
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN POST
 * The value of this page is a complete, correct 51-jurisdiction table of
 * WHERE each board publishes its continuing-education rules. Hand-typing
 * 51 board names and 51 URLs would fork them from
 * lib/blog-license-guides.ts, whose LICENSE_GUIDE_STATES table was
 * name-by-name and URL-by-URL verified against the NCSBN member-board
 * directory (see that file's header). A CE hub pointing at a stale or
 * misnamed board is exactly the YMYL failure this content exists to
 * prevent, so the table is DERIVED from that same array.
 *
 * TRUTH RULES — read before editing:
 *   - NO CE hour counts, renewal-cycle lengths, deadlines, audit windows,
 *     or fees appear anywhere in this file. Boards set and revise them;
 *     a stale number here is worse than no number, and there is no repo
 *     source of truth for them. Every such question resolves to a board
 *     link. Same policy as the "Renewing your license" section of the
 *     licensure series.
 *   - Practice-authority labels come from lib/state-practice-authority.ts
 *     (AANP) via LICENSE_GUIDE_STATES, and the count is read from
 *     lib/stats-sources.ts — never restated as a literal.
 *   - Certification bodies are role-correct: AANP/ANCC certify NPs,
 *     NBCRNA certifies CRNAs, AMCB certifies CNMs.
 *
 * RENDERING RULE — never open a body line with `**bold**`. The converter
 * in lib/blog.ts skips its paragraph pass for any line that already
 * begins with `<` (`/^(?!<[a-z/]|%%)/`), and bold runs BEFORE that pass,
 * so `**Label.** text` emits a bare `<strong>…</strong> text` node with
 * no <p> wrapper. Consecutive ones then collapse into a single run-on
 * paragraph inside .editorial-prose (which sets no white-space override).
 * app/blog/[slug]/page.tsx documents the same behaviour for the
 * Quick-answer opener — the ONE line allowed to take that shape, because
 * that page hoists it into the styled `.ed-quick-answer` callout. Author
 * every other bold-led line as a `- **Label.** …` list item; editorial.css
 * already styles `ul li:has(strong:first-child)` as a definition row.
 * Guarded by tests/regressions/p2-content-pillars-guides.test.ts.
 *
 * SERVING: unlike the licensure series (which lib/blog.ts resolves from
 * code), this is a SINGLE post, so it ships through the established .mdx
 * pipeline: `buildCeuGuideMdx()` writes content/blog/<slug>.mdx and
 * scripts/sync-blog-to-db.ts publishes it (extracting the visible FAQ
 * section into faq_json → FAQPage JSON-LD). The committed .mdx must stay
 * byte-identical to this generator's output; that is enforced by
 * tests/regressions/p2-content-pillars-guides.test.ts, which also
 * REGENERATES the file when run as:
 *
 *   UPDATE_CEU_GUIDE_MDX=1 npx vitest run tests/regressions/p2-content-pillars-guides.test.ts
 *
 * (Same env-flag-regenerates-the-artifact convention as the niche-copy
 * debt baseline.)
 */
// Relative imports (not '@/') to match lib/blog-license-guides.ts, so the
// module also loads under plain ts-node/tsx without path registration.
import { brand } from '../config/brand';
import { LICENSE_GUIDE_STATES, type LicenseGuideState } from './blog-license-guides';
import { STAT_SOURCES } from './stats-sources';

// ─── Identity + editorial dates (real, fixed — never render-time) ────────────

export const CEU_GUIDE_SLUG = 'np-ceu-requirements-by-state';
export const CEU_GUIDE_TITLE = `${brand.niche.long} Continuing Education (CE/CEU) Requirements by State`;
/**
 * REACHABILITY, not taxonomy aesthetics — do not "correct" this back to
 * 'state_spotlight'.
 *
 * app/resources/page.tsx splits published posts into `stateGuides`
 * (category === 'state_spotlight') and `articles` (everything else). The
 * stateGuides branch then maps each slug through
 * LICENSE_GUIDE_SLUG_REGEX (`^np-license-`) and drops non-matches with
 * `.filter(Boolean)`. A national CE hub filed as state_spotlight
 * therefore renders in NEITHER the licensure grid NOR the article grid —
 * it disappears from /resources entirely. It would also be buried among
 * the 51 per-state licensure guides on /blog?category=state_spotlight.
 *
 * 'career_opportunities' is a real public category (lib/blog-categories.ts)
 * with a styled group on /resources ("Career"), holds 2 other posts, and
 * sits well under that grid's slice(0, 6) cap.
 * Guarded by tests/regressions/p2-content-pillars-guides.test.ts.
 */
export const CEU_GUIDE_CATEGORY = 'career_opportunities';
export const CEU_GUIDE_PUBLISH_DATE = '2026-07-29';
export const CEU_GUIDE_REVIEWED_AT = '2026-07-29';
export const CEU_GUIDE_TAGS: ReadonlyArray<string> = [
    'np ceu requirements',
    'nurse practitioner continuing education',
    'aprn license renewal',
];
export const CEU_GUIDE_DESCRIPTION =
    `Continuing education for ${brand.niche.descriptor}s runs on two clocks — state license renewal and national certification. ` +
    `Find the board that publishes your state's CE rules, what CE usually has to cover, and how the two renewals fit together.`;

const NP = brand.niche.short; // 'NP'
const NP_PROSE = brand.niche.descriptor; // 'nurse practitioner'

/** Human label for an AANP practice-authority classification. */
function authorityLabel(s: LicenseGuideState): string {
    switch (s.authority) {
        case 'full':
            return 'Full';
        case 'reduced':
            return 'Reduced';
        case 'restricted':
            return 'Restricted';
    }
}

/**
 * The 51-row directory table.
 *
 * Column 1 links our own state licensure guide (internal mesh into the
 * `np-license-*` series); column 2 links the board that actually
 * publishes CE and renewal rules; column 3 carries the AANP
 * practice-authority classification, which is what decides whether a
 * prescriptive-authority CE component is in play at all.
 */
export function buildCeuStateTable(): string {
    const header = [
        `| State | Board that publishes CE + renewal rules | Practice authority |`,
        `|---|---|---|`,
    ];
    const rows = LICENSE_GUIDE_STATES.map(
        (s) =>
            `| [${s.name}](/blog/${s.slug}) | [${s.boardName}](${s.boardUrl}) | ${authorityLabel(s)} |`,
    );
    return [...header, ...rows].join('\n');
}

export interface CeuGuideFaq {
    name: string;
    text: string;
}

/**
 * FAQ — the SAME array feeds the visible "Frequently asked questions"
 * markdown section and (via the sync script's extractor) faq_json →
 * FAQPage JSON-LD, so schema can never diverge from on-page content.
 *
 * Every answer that would need an hour count, cycle length, or fee
 * resolves to the board instead. That is the point of the page.
 */
export function buildCeuGuideFaq(): CeuGuideFaq[] {
    return [
        {
            name: `How many CE hours do ${NP}s need?`,
            text:
                `It depends entirely on the jurisdiction, and boards revise the requirement — so we deliberately do not publish hour counts here. ` +
                `Use the table above to open your board's current renewal page, which is the only authoritative source for hours, the renewal cycle, accepted providers, and fees. ` +
                `If you hold licenses in more than one state, each one renews on its own board's rules.`,
        },
        {
            name: `Is certification renewal the same as license renewal?`,
            text:
                `No — they are two separate clocks with separate requirements, and meeting one does not satisfy the other. ` +
                `Your state board renews your APRN license; your certifying body renews the national certification the board requires you to keep current. ` +
                `For ${NP}s that body is AANP or ANCC; nurse anesthetists recertify through NBCRNA and certified nurse-midwives through AMCB. ` +
                `Track both dates, because a lapsed certification can put the license renewal that depends on it at risk.`,
        },
        {
            name: `Do ${NP}s need pharmacology CE?`,
            text:
                `Commonly, yes — many boards attach a pharmacotherapeutics or prescribing component to prescriptive authority rather than to the base license, ` +
                `and some add required topics such as controlled-substance or opioid prescribing. Whether it applies to you, and in what amount, is set by your board; ` +
                `open your state's row in the table above before assuming general-purpose CE will cover it.`,
        },
        {
            name: `Does CE earned in one state count in another?`,
            text:
                `Sometimes, but never assume it. Multistate RN privileges under the Nurse Licensure Compact cover the RN license, not APRN licensure or its CE — ` +
                `each APRN license renews under its own board's rules, and boards differ on which accrediting organizations they accept. ` +
                `Confirm acceptance with the board you are renewing with before you pay for a course.`,
        },
        {
            name: `What happens if my CE is audited?`,
            text:
                `Boards audit a share of renewals and ask for documentation after the fact, so keep completion certificates, provider names and accreditation numbers, dates, and hour breakdowns for every activity — ` +
                `not just a total. Retention periods and the consequences of an incomplete response are set by each board and published on its site.`,
        },
        {
            name: `Do free CE courses count toward renewal?`,
            text:
                `Often, yes — what usually matters to a board is the accrediting organization behind the activity, not the price. ` +
                `Employer-provided education, conference sessions, and manufacturer-sponsored programs vary in whether they qualify. ` +
                `Check the accepted-provider language on your board's renewal page before counting an activity toward a requirement.`,
        },
    ];
}

/** Post body (everything below the frontmatter). */
export function buildCeuGuideMarkdown(): string {
    const faqMd = buildCeuGuideFaq()
        .map((f) => `### ${f.name}\n\n${f.text}`)
        .join('\n\n');

    return `**Quick answer:** Continuing education for ${NP_PROSE}s runs on two independent clocks — your state APRN license and your national certification — and meeting one does not satisfy the other. Hour counts, renewal cycles, accepted providers, and fees are set by each state board and revised periodically, so this page links all 51 boards directly instead of publishing numbers that go stale.

---

## Two CE clocks, not one

The single most expensive CE mistake is treating renewal as one deadline.

- **Your state APRN license** renews with the board of nursing (or equivalent agency) in each state where you hold a license. The board sets the hours, the cycle, which topics are mandatory, which accrediting organizations it recognizes, and the audit rules.
- **Your national certification** renews with the body that issued it: AANP or ANCC for ${NP}s, NBCRNA for nurse anesthetists through its Continued Professional Certification program, and AMCB for certified nurse-midwives. Each has its own cycle, its own category rules, and its own documentation standards.

The two overlap but are not interchangeable. Most boards require current national certification as a *condition* of license renewal, which means a lapsed certification can jeopardize a license that is otherwise in good standing. And hours that satisfy a certifying body's category rules will not necessarily satisfy a board's mandatory-topic requirement. Plan the certification cycle first — it is usually the longer one — then map the state requirements onto it.

## Find your board

Every jurisdiction publishes its own CE and renewal requirements. The table below links the board that publishes them, alongside the ${brand.name} licensure guide for that state. Practice-authority classification comes from the ${STAT_SOURCES.fullPracticeStates.source} (as of ${STAT_SOURCES.fullPracticeStates.asOf}), which classifies ${STAT_SOURCES.fullPracticeStates.formatted} as full practice authority.

${buildCeuStateTable()}

*We do not restate hour counts, renewal cycles, or fees from these boards. They change, third-party summaries go stale quietly, and a wrong number on a renewal page is a licensure problem rather than a typo. Open the board link.*

## What CE usually has to cover

Requirements differ, but the same categories recur across boards:

- **General clinical CE** — the bulk of the requirement, usually accepted from any recognized accrediting organization.
- **Pharmacology or pharmacotherapeutics** — frequently tied to prescriptive authority rather than the base license, and often required in a specific amount. In reduced- and restricted-practice states this can be bundled with the collaborative or supervisory paperwork your board requires.
- **Controlled-substance and prescribing topics** — many boards require prescribers to complete education on safe prescribing, and clinicians registering with the DEA are subject to a separate federal training requirement for controlled-substance registrants; the current terms are published by the [DEA Diversion Control Division](https://www.deadiversion.usdoj.gov/).
- **State-mandated topics** — boards add jurisdiction-specific subjects, and the list changes by legislative session. This is the category most often missed by clinicians relying on last cycle's plan.
- **Practice hours** — some boards accept or require a minimum number of practice hours alongside CE, particularly for reactivating an inactive license.

## Documentation is the part people lose

Boards audit renewals after the fact. Attestation at renewal is not proof; the certificate is. For every activity, keep the completion certificate, the provider's name and accreditation number, the completion date, and the hour breakdown by category — because an audit asks for the breakdown, not the total. Store them somewhere that survives a job change, since employer learning-management systems are the most common place NPs discover a lost record.

If you hold licenses in more than one state, keep a single ledger with a column per license and a column per certification. Overlapping activities usually count in several places at once — but only if you can show the documentation each one wants.

## How CE fits the rest of your career

CE is a negotiable line item, not just a compliance chore. A CME/CE allowance and dedicated CE days are standard components of ${NP} compensation packages and are frequently easier to move than base salary — see the [salary negotiation guide](/blog/np-salary-negotiation-guide) for how to ask, and the [salary guide](/salary-guide) for what the market pays in your state. In 1099 and contract work the allowance usually does not exist, and CE becomes an out-of-pocket cost you should price into your rate; the [1099 vs W-2 breakdown](/blog/np-1099-vs-w2) walks through the full comparison.

Relocating or picking up a second license? Open your target state's [licensure guide](/resources) — linked from the first column above — which covers the application path, practice authority, and Nurse Licensure Compact status alongside the same board link.

## Frequently asked questions

${faqMd}
`;
}

/** Complete .mdx file contents (frontmatter + body) for content/blog/. */
export function buildCeuGuideMdx(): string {
    const frontmatter = [
        '---',
        `title: ${CEU_GUIDE_TITLE}`,
        `slug: ${CEU_GUIDE_SLUG}`,
        `description: ${CEU_GUIDE_DESCRIPTION}`,
        `category: ${CEU_GUIDE_CATEGORY}`,
        `date: ${CEU_GUIDE_PUBLISH_DATE}`,
        `reviewed: ${CEU_GUIDE_REVIEWED_AT}`,
        `tags: ${JSON.stringify([...CEU_GUIDE_TAGS])}`,
        '---',
        '',
        '',
    ].join('\n');
    return frontmatter + buildCeuGuideMarkdown();
}
