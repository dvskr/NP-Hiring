/**
 * Every per-state practice answer says only what that state's verified
 * details support.
 *
 * The September 2026 audit corrected every entry in
 * lib/state-practice-authority.ts, and each entry keeps its AANP tier. The
 * tier is too coarse to carry a per-state rule: a dozen full practice states
 * require a transition period, Virginia, South Carolina and Michigan are
 * restricted without requiring physician supervision for all practice, and
 * several reduced and restricted states offer a route out of the agreement.
 * Templates that turned the tier into a rule ("no collaborating or
 * supervising physician is required", "Restricted Practice (Physician
 * Supervision Required)") contradicted the details printed beside them, and
 * a wrong answer here can push a nurse practitioner into an unlawful practice
 * arrangement.
 *
 * This file renders, for all 51 jurisdictions, every per-state consumer
 * through its real exported function or component (the practice card, the
 * listing narrative paragraphs and FAQ answers, the state and city
 * narratives, the license guide with its FAQ and HowTo data, the licensure
 * checker and planner, the job page location panel, the nearby-state tables
 * and the scope-of-practice rows), and audits the text that remains once the
 * verified sources are taken out:
 *   - the state's own `details` string, verbatim;
 *   - AANP's tier definitions (getAanpTierDefinition, AANP_TIER_MEANING),
 *     which are attributed tier text, not a rule for this state;
 *   - the license guide's physician verdict, which section 2 checks against
 *     the details separately.
 * What remains may not claim a requirement or its absence. The rules are
 * computed from each details string, so a future edit to one is audited
 * automatically:
 *   - no claim that no physician, agreement or supervision is required,
 *     unless the details themselves say so and name no arrangement;
 *   - no sentence asserting a requirement (an agreement, supervision, a
 *     physician, a protocol, a transition), since the only per-state
 *     requirement text allowed is the details (or a verified verdict);
 *   - no physician-supervision wording for a state whose details do not
 *     describe supervision;
 *   - no on-site oversight or career-long claim, and none of the retired
 *     tier rules.
 * Questions, sentences hedged with "any" ("any collaborative agreement Texas
 * requires") and tier-level sentences that do not name the state ("several
 * full practice states require a transition period") are not per-state
 * claims, so the requirement checks skip them; the absence check never does.
 *
 * Structured data must say what the visible text says: the license guide's
 * faq_json and HowTo steps are the visible markdown's own strings, and the
 * setting-by-state physician FAQ is the license guide's answer.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import {
    STATE_PRACTICE_AUTHORITY,
    getAanpTierDefinition,
    getAuthorityLabel,
    type PracticeAuthority,
    type StatePracticeInfo,
} from '@/lib/state-practice-authority';
import {
    getNearbyStates,
    getPracticeEnvironment,
    NLC_VERIFIED_LABEL,
    type PracticeEnvironment,
} from '@/lib/pseo/practice-environment';
import {
    NEARBY_STATES_NOTE,
    buildCategoryCityDescription,
    buildCategoryCityFaqs,
    buildCityFaqs,
    buildCompanyStatePracticeLine,
    buildHubDescription,
    buildHubFaqs,
    buildLicensureSentences,
    buildPracticingAsRoleParagraph,
    buildPracticingInStateParagraph,
    buildSalaryPracticeEnvironmentParagraph,
    buildSalaryStateDescription,
    buildSalaryStateFaqAdditions,
    buildSettingStateDescription,
    buildSettingStateFaqs,
} from '@/lib/pseo/listing-narrative';
import { emptyListingFacts } from '@/lib/pseo/listing-facts';
import { buildPlainStateNarrative, buildSettingStateNarrative } from '@/lib/pseo/state-narrative';
import { buildCityFacts, buildCityNarrative, buildTaxonomyCityNarrative } from '@/lib/pseo/city-narrative';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { STATE_CODES, getAllSettingSlugs } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import {
    AANP_TIER_MEANING,
    LICENSE_GUIDE_PHYSICIAN_VERDICTS,
    LICENSE_GUIDE_STATES,
    buildLicenseGuideFaq,
    buildLicenseGuideHowTo,
    buildLicenseGuideSteps,
    getLicenseGuidePost,
    type LicenseGuideState,
} from '@/lib/blog-license-guides';
import { buildLicensureSteps, tierAttributionNote } from '@/components/LicensureChecker';
import { AANP_TIER_LEGEND, TIER_VARIATION_NOTE, plannerPracticeRequirement } from '@/components/tools/MultiStatePlanner';
import PracticeCard, { type PracticeCardVariant } from '@/components/seo/pseo/PracticeCard';
import NearbyStatesTable from '@/components/seo/pseo/NearbyStatesTable';
import JobLocationContext, { type JobLocationContextModel } from '@/components/JobLocationContext';
import { LicenseGuideNearbyStates } from '@/components/blog/LicenseGuideMarketSnapshot';
import { SOP_STATE_ROWS, buildSopFaqs } from '@/components/ScopeOfPracticeData';
import { METRO_CITIES } from '@/lib/metro-data';

const ROOT = path.resolve(__dirname, '../..');
const JURISDICTIONS = Object.keys(STATE_PRACTICE_AUTHORITY);
const TIERS: readonly PracticeAuthority[] = ['full', 'reduced', 'restricted'];
const PHYSICIAN_Q = /collaborating or supervising physician/i;

// ─── Reading a details string ───────────────────────────────────────────────

/** A clause that negates an arrangement: "without physician oversight", "no collaborative agreement". */
const NEGATED_CLAUSE = /\b(?:without|no)\b[^.;]*/gi;
/** Anything that makes practice depend on another provider or on a period of practice. */
const ARRANGEMENT = /transition|collaborat|supervis|mentor|protocol|agreement|arrangement|delegat|standardized procedures|present for/i;

/** The details minus their negated clauses: what the state affirmatively requires. */
const affirmedPart = (details: string): string => details.replace(NEGATED_CLAUSE, ' ');
/** The details require an arrangement or a transition of some kind. */
const requiresArrangement = (details: string): boolean => ARRANGEMENT.test(affirmedPart(details));
/** The details explicitly deny an arrangement somewhere ("without physician oversight", "without a joint protocol"). */
const deniesArrangement = (details: string): boolean =>
    /\b(?:without|no)\b[^.;]*(?:physician|supervis|collaborat|agreement|protocol|oversight|transition)/i.test(details);
/** The details say outright that no arrangement applies, and name none: the only states a "no physician" claim may describe. */
const explicitlyNoArrangement = (details: string): boolean => deniesArrangement(details) && !requiresArrangement(details);
/**
 * The details name a party other than a physician beside one ("physician or
 * dentist", "physician, certified nurse practitioner", "physician or an
 * experienced NP"); "physician or an approved covering physician" is not one.
 */
const ALTERNATIVE_PARTY = new RegExp(
    `\\bphysicians?(?:,| or) (?:with )?(?:a |an )?(?:dentist|advanced practice|certified|supervising|experienced|${brand.niche.short}\\b)`,
    'i',
);
const namesAlternativeParty = (details: string): boolean => ALTERNATIVE_PARTY.test(details);
/** The details describe a way out of the arrangement. */
const hasRouteOut = (details: string): boolean =>
    deniesArrangement(details) || /\b(?:unless|until|except when|qualify|designation|autonomous)\b/i.test(details);

// ─── Auditing rendered text ─────────────────────────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ',
};

/** Visible text of server-rendered markup, one line per block element. */
function textOf(html: string): string {
    return html
        .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<\/(?:p|li|div|td|th|h[1-6]|caption|tr|section|ul|table)>/g, '\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m]);
}

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

/** Tier-level text attributed to AANP: its own definitions, never a rule for one state. */
const AANP_TIER_TEXT: readonly string[] = TIERS.flatMap((tier) => [getAanpTierDefinition(tier), AANP_TIER_MEANING[tier]]);

/** The verified verdict for the state, or null when its details are published alone. */
const verdictOf = (stateName: string): string | null => LICENSE_GUIDE_PHYSICIAN_VERDICTS[stateName]?.verdict ?? null;

/**
 * Removes every verified source from the text, leaving only what the
 * templates add. Each removal leaves a line break, so the sentences on
 * either side are audited apart.
 */
function residualOf(text: string, details: string, verdict: string | null): string {
    let out = text.split(details).join('\n');
    for (const definition of AANP_TIER_TEXT) out = out.split(definition).join('\n');
    if (verdict) out = out.split(`${verdict} `).join('\n');
    return out;
}

/** Sentences, split at line breaks and sentence ends. */
const sentencesOf = (text: string): string[] =>
    text.split(/\n+|(?<=[.?!])\s+(?=[A-Z*"([])/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));

const QUESTION = /\?\s*\**\s*$/;
/** "any collaborative agreement Texas requires", "complete any agreement ... the board requires". */
const HEDGED = /\bany\s+(?:[\w-]+\s+){0,3}?(?:collaborat|supervis|agreement|arrangement|requirement)/i;
const CONDITIONAL = /^\W*(?:When|If|Where|Whether)\b/;
/** About the tier or a group of states, not one state. */
const TIER_LEVEL = /\b(?:several|some|many|most)\b[^.]{0,60}\b(?:states|jurisdictions)\b|\b(?:states|jurisdictions) in the same (?:tier|category)\b/i;

/** A question, a hedge, or tier-level text that does not name the state asserts no per-state requirement. */
function assertsNoPerStateRequirement(sentence: string, stateName: string): boolean {
    if (QUESTION.test(sentence) || HEDGED.test(sentence)) return true;
    return !sentence.includes(stateName) && (CONDITIONAL.test(sentence) || TIER_LEVEL.test(sentence));
}

const REQUIREMENT_VERB = /\b(?:requires?|required|requiring|must|needs?|mandat\w*)\b/i;
const ARRANGEMENT_TERM = /physician|supervis|collaborat|agreement|arrangement|protocol|delegat|mentor|oversight|transition/i;
const PHYSICIAN_SUPERVISION =
    /physician[- ]supervis|supervis\w* (?:by |of )?(?:a |the )?physician|supervising physician|physician (?:oversight|supervision)/i;

/** Claims that no physician, agreement or supervision is needed. */
const ABSENCE_CLAIMS: readonly RegExp[] = [
    /\bno (?:collaborating|collaborative|supervising|supervisory|physician)\b[^.]*\b(?:is |are )?(?:required|needed)\b/i,
    /\bwithout (?:a |any )?(?:required |mandated )?(?:physician|collaborat\w*|supervis\w*|oversight)\b/i,
    /\bindependent prescribing\b|\bprescribes? independently\b/i,
    /\b(?:practices?|practicing) independently\b|\bindependent practice\b/i,
    /\b(?:does not|doesn't|never) (?:need|require)s? (?:a |any )?(?:physician|collaborat|supervis|agreement)/i,
    /\bremoves? the (?:collaborative|agreement|supervis)/i,
    /\bno (?:mandated|required) physician/i,
];

/** Never true of every state it would be printed for. */
const ON_SITE_OR_CAREER_LONG =
    /\bon[- ]site\b[^.]{0,80}(?:physician|supervis|oversight|collaborat)|(?:physician|supervis|oversight|collaborat)\w*[^.]{0,80}\bon[- ]site\b|career[- ]long|day-to-day oversight/i;

/** The tier rules the audit retired, wherever they would reappear. */
const RETIRED_TIER_RULES: readonly RegExp[] = [
    /Supervision Required|Agreement Required/,
    /without physician oversight/i,
    /requiring physician supervision|requiring a collaborative agreement/i,
    /physician-supervised care teams|collaborative-agreement logistics/i,
    /no (?:collaborating|collaborative) or supervising physician is required/i,
    /without a required physician relationship|without a mandated physician relationship/i,
    /physician supervision is built in/i,
    /Secure (?:supervising|collaborative) physician agreement/i,
];

/** Every claim in `text` that the state's details do not support. */
function audit(text: string, stateName: string, info: StatePracticeInfo): string[] {
    const found: string[] = [];
    const noArrangement = explicitlyNoArrangement(info.details);
    const detailsSupervise = /supervis/i.test(affirmedPart(info.details));
    for (const sentence of sentencesOf(residualOf(text, info.details, verdictOf(stateName)))) {
        if (QUESTION.test(sentence)) continue;
        for (const rule of RETIRED_TIER_RULES) {
            if (rule.test(sentence)) found.push(`retired tier rule ${rule}: "${sentence}"`);
        }
        if (ON_SITE_OR_CAREER_LONG.test(sentence)) found.push(`on-site or career-long claim: "${sentence}"`);
        // An absence claim is judged as one: allowed only where the details
        // make it outright, and never read as a requirement.
        const absence = ABSENCE_CLAIMS.filter((claim) => claim.test(sentence));
        if (absence.length > 0) {
            if (!noArrangement) found.push(`absence claim ${absence.join(' ')} the details do not make: "${sentence}"`);
            continue;
        }
        if (assertsNoPerStateRequirement(sentence, stateName)) continue;
        if (REQUIREMENT_VERB.test(sentence) && ARRANGEMENT_TERM.test(sentence)) {
            found.push(`requirement stated outside the details: "${sentence}"`);
        }
        if (!detailsSupervise && PHYSICIAN_SUPERVISION.test(sentence)) {
            found.push(`physician supervision the details do not describe: "${sentence}"`);
        }
    }
    return found;
}

// ─── Every per-state consumer, rendered ─────────────────────────────────────

interface Surface { name: string; text: string }

const facts = () => emptyListingFacts(new Date('2026-09-20T12:00:00Z'));
const guideStateOf = (stateName: string): LicenseGuideState => {
    const state = LICENSE_GUIDE_STATES.find((s) => s.name === stateName);
    expect(state, `${stateName}: no license guide row`).toBeDefined();
    return state!;
};
const envOf = (stateName: string): PracticeEnvironment => {
    const env = getPracticeEnvironment(stateName);
    expect(env, `${stateName}: no practice environment`).not.toBeNull();
    return env!;
};

const PRACTICE_CARD_VARIANTS: readonly PracticeCardVariant[] = [
    { kind: 'licensure' },
    { kind: 'licensure', slug: 'anesthesia' },
    { kind: 'practicing' },
    { kind: 'practicing', certification: 'FNP-BC or FNP-C' },
    { kind: 'salary' },
];

const locationModel = (env: PracticeEnvironment, info: StatePracticeInfo): JobLocationContextModel => ({
    cityName: 'Anytown',
    stateName: env.stateName,
    stateCode: env.stateCode,
    colIndex: 100,
    colDeltaPct: 0,
    adjustedSalary: null,
    authority: info,
    cityJobsHref: null,
    stateJobsHref: `/jobs/state/${env.stateSlug}`,
    salaryGuideHref: `/salary-guide/${env.stateSlug}`,
    comparatorHref: '/tools/cost-of-living-comparison',
});

/** The license guide's physician answer, found the way lib/pseo/setting-state-template.tsx finds it. */
const physicianAnswerOf = (stateName: string): string | null =>
    buildLicenseGuideFaq(guideStateOf(stateName)).find((f) => PHYSICIAN_Q.test(f.name))?.text ?? null;
const nlcAnswerOf = (stateName: string): string | null =>
    buildLicenseGuideFaq(guideStateOf(stateName)).find((f) => /Nurse Licensure Compact/.test(f.name))?.text ?? null;

function surfacesFor(stateName: string): Surface[] {
    const info = STATE_PRACTICE_AUTHORITY[stateName];
    const env = envOf(stateName);
    const guide = guideStateOf(stateName);
    const stateCode = STATE_CODES[stateName];
    const steps = buildLicenseGuideSteps(guide);
    const post = getLicenseGuidePost(guide.stateSlug);
    const cities = CITIES.filter((c) => c.state === stateName);
    const out: Surface[] = [];
    const add = (name: string, text: string | null | undefined) => {
        if (text) out.push({ name, text });
    };

    // Practice card: every variant, chip included.
    for (const variant of PRACTICE_CARD_VARIANTS) {
        add(`PracticeCard ${JSON.stringify(variant)}`, textOf(render(
            React.createElement(PracticeCard, { env, variant, licenseGuideLive: true }),
        )));
    }

    // Listing narrative paragraphs, lines and FAQ answers (FAQPage JSON-LD).
    for (const slug of [undefined, ...ALL_CATEGORY_SLUGS]) {
        const s = buildLicensureSentences(env, slug);
        add(`buildLicensureSentences ${slug ?? ''}`, [s.classification, s.nlc, s.board, s.certification].filter(Boolean).join(' '));
    }
    add('buildPracticingInStateParagraph', buildPracticingInStateParagraph(env));
    add('buildPracticingAsRoleParagraph', buildPracticingAsRoleParagraph(env, 'AANP or ANCC board certification'));
    add('buildSalaryPracticeEnvironmentParagraph', buildSalaryPracticeEnvironmentParagraph(env, NLC_VERIFIED_LABEL));
    add('buildCompanyStatePracticeLine', buildCompanyStatePracticeLine(env));
    const faqText = (faqs: ReadonlyArray<{ question: string; answer: string }>) =>
        faqs.map((f) => `${f.question}\n${f.answer}`).join('\n');
    add('buildHubFaqs', faqText(buildHubFaqs({ stateName, facts: facts(), env, categoryRows: [], stepNames: steps.map((st) => st.name) })));
    add('buildCityFaqs', faqText(buildCityFaqs({ city: cities[0]?.name ?? 'Anytown', stateCode, facts: facts(), env, categoryLabels: [] })));
    add('buildCategoryCityFaqs', faqText(buildCategoryCityFaqs({
        slug: 'remote', label: 'Remote', labelSentence: 'remote', city: cities[0]?.name ?? 'Anytown', stateName,
        facts: facts(), cityBenchmark: null, env, qualifications: null,
    })));
    add('buildSalaryStateFaqAdditions', faqText(buildSalaryStateFaqAdditions({ env, nlcVerifiedLabel: NLC_VERIFIED_LABEL, topEmployers: [] })));
    add('buildSettingStateFaqs', faqText(buildSettingStateFaqs({
        label: 'Remote', stateName, slug: 'remote', facts: facts(),
        physicianAnswer: physicianAnswerOf(stateName), nlcAnswer: nlcAnswerOf(stateName),
    })));
    const described = { ...facts(), total: 4, distinctEmployers: 2 };
    add('buildHubDescription', buildHubDescription({ stateName, facts: described, topCategories: [] }));
    add('buildSettingStateDescription', buildSettingStateDescription({ label: 'Remote', slug: 'remote', stateName, facts: described, statsAsOf: null }));
    add('buildCategoryCityDescription', buildCategoryCityDescription({ labelSentence: 'remote', city: cities[0]?.name ?? 'Anytown', stateCode, facts: described }));
    add('buildSalaryStateDescription', buildSalaryStateDescription({ env, facts: described }));

    // State and city narratives, every setting and taxonomy lead.
    add('buildPlainStateNarrative', buildPlainStateNarrative({
        stateName, stateCode, totalJobs: 9, medianSalaryK: 0, uniqueEmployerCount: 3,
        topCategoryLabels: ['Remote'], topCityNames: cities.slice(0, 3).map((c) => c.name),
    }));
    for (const setting of new Set([...getAllSettingSlugs(), ...ALL_CATEGORY_SLUGS])) {
        add(`buildSettingStateNarrative ${setting}`, buildSettingStateNarrative(setting, stateName, stateCode, 100, 0, 5));
    }
    for (const city of cities) add(`buildCityNarrative ${city.slug}`, buildCityNarrative(buildCityFacts(city), 3));
    if (cities.length > 0) {
        const cityFacts = buildCityFacts(cities[0]);
        for (const taxonomy of ALL_CATEGORY_SLUGS) {
            add(`buildTaxonomyCityNarrative ${taxonomy}`, buildTaxonomyCityNarrative(cityFacts, taxonomy, 3));
        }
    }

    // License guide: the visible markdown, its FAQ and HowTo data, the meta.
    expect(post, `${stateName}: no license guide post`).not.toBeNull();
    add('license guide markdown', post!.content);
    add('license guide meta description', post!.meta_description);
    for (const faq of buildLicenseGuideFaq(guide)) add(`license guide FAQ "${faq.name}"`, faq.text);
    for (const step of steps) add(`license guide step "${step.name}"`, `${step.name}. ${step.text}`);

    // Licensure checker and multi-state planner.
    const checker = buildLicensureSteps(stateName, info);
    add('LicensureChecker steps', checker.map((st) => `${st.text}. ${st.detail ?? ''}`).join('\n'));
    add('LicensureChecker tier note', tierAttributionNote(checker.length));
    add('MultiStatePlanner row', plannerPracticeRequirement(stateName));

    // Job page location panel.
    add('JobLocationContext', textOf(render(React.createElement(JobLocationContext, { model: locationModel(env, info) }))));

    // Nearby-state tables that list this state, and this state's own tables.
    const nearbyRows = getNearbyStates(stateName);
    for (const variant of ['hub', 'salary', 'license'] as const) {
        add(`NearbyStatesTable ${variant}`, textOf(render(React.createElement(NearbyStatesTable, {
            variant,
            rows: [{ env, jobs: 2, medianK: null, link: null, guide: null }, ...nearbyRows.map((near) => ({ env: near, jobs: 1, medianK: null, link: null, guide: null }))],
        }))));
    }
    add('LicenseGuideNearbyStates', textOf(render(React.createElement(LicenseGuideNearbyStates, {
        env, nearby: nearbyRows.map((near) => ({ env: near, guideLive: false })),
    }))));

    return out;
}

// ─── 0. The details reader classifies the audited states as the audit found them ──

describe('0. the details reader agrees with the audit', () => {
    it('reads a transition or arrangement in every full practice state the audit named', () => {
        for (const name of ['Colorado', 'Connecticut', 'Maine', 'Maryland', 'Massachusetts', 'Minnesota', 'Nebraska', 'Nevada', 'New York', 'South Dakota', 'Vermont']) {
            expect(STATE_PRACTICE_AUTHORITY[name].authority, name).toBe('full');
            expect(requiresArrangement(STATE_PRACTICE_AUTHORITY[name].details), name).toBe(true);
        }
    });

    it('reads no supervision for Virginia, South Carolina and Michigan, and a route out for Virginia', () => {
        for (const name of ['Virginia', 'South Carolina', 'Michigan']) {
            expect(/supervis/i.test(affirmedPart(STATE_PRACTICE_AUTHORITY[name].details)), name).toBe(false);
            expect(requiresArrangement(STATE_PRACTICE_AUTHORITY[name].details), name).toBe(true);
        }
        expect(hasRouteOut(STATE_PRACTICE_AUTHORITY.Virginia.details)).toBe(true);
    });

    it('reads a non-physician party for Wisconsin and a route out for the reduced states with one', () => {
        expect(namesAlternativeParty(STATE_PRACTICE_AUTHORITY.Wisconsin.details)).toBe(true);
        for (const name of ['Arkansas', 'Illinois', 'Kentucky', 'New Jersey', 'West Virginia', 'Wisconsin']) {
            expect(hasRouteOut(STATE_PRACTICE_AUTHORITY[name].details), name).toBe(true);
        }
    });

    it('allows a "no physician" claim only where the details make it outright', () => {
        const allowed = JURISDICTIONS.filter((name) => explicitlyNoArrangement(STATE_PRACTICE_AUTHORITY[name].details));
        for (const name of ['Alaska', 'Arizona', 'Delaware']) expect(allowed, name).toContain(name);
        for (const name of allowed) expect(STATE_PRACTICE_AUTHORITY[name].authority, name).toBe('full');
        // A bare "grants full practice authority" verifies nothing either way.
        expect(allowed).not.toContain('Idaho');
    });
});

// ─── 1. No rendered per-state surface outruns its details ───────────────────

describe('1. every per-state consumer, for every jurisdiction, states only what the details support', () => {
    it('covers all 51 jurisdictions', () => {
        expect(JURISDICTIONS).toHaveLength(51);
    });

    it.each(JURISDICTIONS)('%s', (stateName) => {
        const info = STATE_PRACTICE_AUTHORITY[stateName];
        const violations = surfacesFor(stateName).flatMap(({ name, text }) =>
            audit(text, stateName, info).map((v) => `${name}: ${v}`));
        expect(violations).toEqual([]);
    });

    // The audit is only as good as what it catches: each line below is copy a
    // tier template used to print beside that state's details.
    it.each([
        ['Connecticut', 'AANP classifies Connecticut as a full practice state. No collaborative or supervising physician is required in Connecticut.'],
        ['Idaho', 'No collaborating or supervising physician is required in Idaho.'],
        ['New York', 'On the regulatory side, New York grants full practice authority, meaning independent prescribing without physician oversight.'],
        ['Nevada', 'In full practice states you can prescribe without a physician agreement.'],
        ['Virginia', 'Restricted Practice (Physician Supervision Required). Virginia requires physician supervision.'],
        ['Virginia', 'On the regulatory side, most Virginia roles are structured around physician-supervised care teams.'],
        ['South Carolina', 'Expect South Carolina job postings to name a supervising physician.'],
        ['Michigan', 'Secure supervising physician agreement'],
        ['Wisconsin', 'Wisconsin requires a collaborative agreement with a physician.'],
        ['Arkansas', 'Arkansas requires a documented collaborative agreement with a physician.'],
        ['Alabama', 'The collaborating physician typically does not need to be on-site.'],
        ['Kentucky', 'Kentucky requires a career-long collaborative agreement.'],
    ])('flags the retired copy for %s: %s', (stateName, copy) => {
        const info = STATE_PRACTICE_AUTHORITY[stateName];
        expect(audit(`${copy} ${info.details}`, stateName, info)).not.toEqual([]);
    });

    it.each([
        ['Alaska', 'No collaborative agreement is required in Alaska.'],
        ['Virginia', 'Model the after-tax figure, and confirm who holds any collaborative agreement Virginia requires before signing.'],
        ['Virginia', 'Several full practice states require a period of collaborative or supervised practice.'],
        ['Texas', 'AANP classifies Texas as a restricted practice state.'],
    ])('passes what the details support or what is not a per-state claim, for %s: %s', (stateName, copy) => {
        const info = STATE_PRACTICE_AUTHORITY[stateName];
        expect(audit(`${copy} ${info.details}`, stateName, info)).toEqual([]);
    });
});

// ─── 2. The license guide verdicts restate the details ──────────────────────

const VERDICT_TERMS = /supervis|collaborat|agreement|protocol|mentor|transition|delegat|physician|dentist/gi;

/** Everything a physician verdict says that the state's details do not support. */
function verdictProblems(stateName: string, verdict: string): string[] {
    const details = STATE_PRACTICE_AUTHORITY[stateName].details;
    const found: string[] = [];
    // "No" only where the details say outright that no arrangement applies.
    if (/^No\b/.test(verdict) && !explicitlyNoArrangement(details)) found.push('"No" although the details name an arrangement or say nothing either way');
    // "Yes" only where the details require an arrangement involving a physician.
    if (/^Yes\b/.test(verdict) && !(requiresArrangement(details) && /physician/i.test(affirmedPart(details)))) {
        found.push('"Yes" although the details require no physician arrangement');
    }
    // A bare yes or no hides a route out, or a collaborator who need not be a physician.
    if (/^(?:Yes|No)\.$/.test(verdict)) {
        if (requiresArrangement(details) && hasRouteOut(details)) found.push('a bare verdict hides the route out');
        if (namesAlternativeParty(details)) found.push('a bare verdict hides a non-physician party');
    }
    // Every arrangement the verdict names is in the details.
    for (const term of new Set((verdict.match(VERDICT_TERMS) ?? []).map((t) => t.toLowerCase()))) {
        if (!details.toLowerCase().includes(term)) found.push(`the verdict names "${term}" and the details do not`);
    }
    return found;
}

describe('2. every physician verdict is true of its state\'s details', () => {
    it.each(Object.entries(LICENSE_GUIDE_PHYSICIAN_VERDICTS))('%s', (stateName, { verdict }) => {
        expect(verdictProblems(stateName, verdict)).toEqual([]);
    });

    it('catches the verdicts a tier would have produced', () => {
        expect(verdictProblems('Connecticut', 'No.')).not.toEqual([]);
        expect(verdictProblems('Idaho', 'No.')).not.toEqual([]);
        expect(verdictProblems('Virginia', 'Yes.')).not.toEqual([]);
        expect(verdictProblems('Wisconsin', 'Yes.')).not.toEqual([]);
        expect(verdictProblems('South Carolina', 'Yes, a supervising physician.')).not.toEqual([]);
        expect(verdictProblems('Alaska', 'No.')).toEqual([]);
    });

    it('every full practice state whose details require an arrangement gets a verdict or no verdict, never "No."', () => {
        for (const name of JURISDICTIONS) {
            const verdict = verdictOf(name);
            if (verdict && requiresArrangement(STATE_PRACTICE_AUTHORITY[name].details)) {
                expect(verdict, name).not.toMatch(/^No\b/);
            }
        }
    });
});

// ─── 3. Tier labels are AANP's tier names, never the dataset's rule-bearing text ──

describe('3. every tier label beside a state is AANP\'s tier name', () => {
    it.each(JURISDICTIONS)('%s', (stateName) => {
        const info = STATE_PRACTICE_AUTHORITY[stateName];
        const label = getAuthorityLabel(info.authority);
        const env = envOf(stateName);
        expect(env.authorityLabel).toBe(label);
        expect(SOP_STATE_ROWS.find((r) => r.name === stateName)?.authorityLabel).toBe(label);

        const card = render(React.createElement(PracticeCard, { env, licenseGuideLive: false }));
        expect(card).toContain(`>${label}</span>`);
        expect(textOf(render(React.createElement(JobLocationContext, { model: locationModel(env, info) }))))
            .toContain(`AANP classification: ${label}`);

        // No rendered per-state surface prints "Full Practice Authority" as a
        // label: several full practice states require a transition period.
        for (const { name, text } of surfacesFor(stateName)) {
            expect(text, `${stateName} ${name}`).not.toContain('Full Practice Authority');
            expect(text, `${stateName} ${name}`).not.toMatch(/\((?:Physician Supervision|Collaborative Agreement) Required\)/);
        }
    });

    it('the nearby-state tables name the column for AANP and print its tier names', () => {
        const env = envOf('Texas');
        const rows = getNearbyStates('Texas').map((near) => ({ env: near, jobs: 1, medianK: null, link: null, guide: null }));
        const hub = textOf(render(React.createElement(NearbyStatesTable, { variant: 'hub', rows })));
        expect(hub).toContain('AANP classification');
        expect(hub).toContain(NEARBY_STATES_NOTE);
        for (const row of rows) expect(hub).toContain(row.env.authorityLabel);
        const guide = textOf(render(React.createElement(LicenseGuideNearbyStates, {
            env, nearby: rows.map((row) => ({ env: row.env, guideLive: false })),
        })));
        expect(guide).toContain('AANP classification');
        expect(guide).not.toContain('these are the rules');
    });
});

// ─── 4. Structured data says exactly what the visible text says ─────────────

describe('4. structured data equals the visible text', () => {
    it.each(LICENSE_GUIDE_STATES.map((s) => [s.name, s] as const))('%s license guide: faq_json and HowTo are the visible strings', (_name, state) => {
        const post = getLicenseGuidePost(state.stateSlug)!;
        const faqs = buildLicenseGuideFaq(state);
        expect(post.faq_json).toEqual(faqs);
        for (const faq of faqs) {
            expect(post.content, faq.name).toContain(`### ${faq.name}\n\n${faq.text}`);
        }
        const steps = buildLicenseGuideSteps(state);
        const howTo = buildLicenseGuideHowTo(state.stateSlug) as { description: string; step: Array<{ name: string; text: string }> };
        expect(howTo.step.map((st) => ({ name: st.name, text: st.text }))).toEqual(steps);
        for (const step of steps) expect(post.content, step.name).toContain(`**${step.name}.** ${step.text}`);
        expect(howTo.description).toBe(post.meta_description);
    });

    it.each(JURISDICTIONS)('%s: the setting-by-state physician FAQ is the license guide\'s answer, asked the same question', (stateName) => {
        const answer = physicianAnswerOf(stateName);
        expect(answer).toBeTruthy();
        const faq = buildSettingStateFaqs({
            label: 'Remote', stateName, slug: 'remote', facts: facts(), physicianAnswer: answer, nlcAnswer: null,
        }).find((f) => PHYSICIAN_Q.test(f.question));
        expect(faq?.answer).toBe(answer);
    });

    it.each(JURISDICTIONS)('%s: the hub practice FAQ answer is the practice card\'s own paragraph', (stateName) => {
        const env = envOf(stateName);
        const answer = buildHubFaqs({ stateName, facts: facts(), env, categoryRows: [], stepNames: [] })
            .find((f) => f.question === `What is the practice authority in ${stateName}?`)?.answer;
        const card = textOf(render(React.createElement(PracticeCard, { env, licenseGuideLive: false })));
        expect(answer).toBeTruthy();
        expect(card).toContain(answer!);
    });
});

// ─── 5. Tier-level copy says what AANP's tiers mean and that states differ ──

describe('5. tier-level copy beside per-state rows states no rule', () => {
    /** Every sentence that is not attributed AANP text, a question, a hedge or tier-level must state no requirement. */
    const auditTierText = (text: string): string[] => {
        let residual = text;
        for (const definition of AANP_TIER_TEXT) residual = residual.split(definition).join('\n');
        return sentencesOf(residual).flatMap((sentence) => {
            if (QUESTION.test(sentence)) return [];
            const found: string[] = [];
            for (const rule of RETIRED_TIER_RULES) if (rule.test(sentence)) found.push(`retired ${rule}: "${sentence}"`);
            if (ON_SITE_OR_CAREER_LONG.test(sentence)) found.push(`on-site or career-long: "${sentence}"`);
            if (assertsNoPerStateRequirement(sentence, '\u0000')) return found;
            if (REQUIREMENT_VERB.test(sentence) && ARRANGEMENT_TERM.test(sentence)) found.push(`tier rule: "${sentence}"`);
            if (PHYSICIAN_SUPERVISION.test(sentence)) found.push(`physician supervision: "${sentence}"`);
            return found;
        });
    };

    it('the scope-of-practice FAQ (visible and FAQPage) and the tool legends', () => {
        const texts = [
            ...buildSopFaqs().map((f) => f.answer),
            ...AANP_TIER_LEGEND.map((l) => l.definition),
            TIER_VARIATION_NOTE,
            tierAttributionNote(7),
            NEARBY_STATES_NOTE,
        ];
        expect(texts.flatMap(auditTierText)).toEqual([]);
    });

    it('the scope-of-practice legend is AANP\'s definition for each tier', () => {
        const page = fs.readFileSync(path.join(ROOT, 'app/scope-of-practice/page.tsx'), 'utf8');
        for (const tier of TIERS) {
            expect(page).toContain(`heading: getAuthorityLabel('${tier}')`);
            expect(page).toContain(`getAanpTierDefinition('${tier}')`);
        }
    });
});

// ─── 6. No source brings a tier rule back ───────────────────────────────────

describe('6. source guards', () => {
    /** Code only: block comments (JSX ones too) and whole-line comments quote the retired copy on purpose. */
    const codeOf = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const SOURCE_DIRS = ['app', 'components', 'lib', 'scripts'];
    const sources: Array<[string, string]> = SOURCE_DIRS.flatMap((dir) =>
        (fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
            .filter((rel) => /\.(?:ts|tsx|js|mjs)$/.test(rel) && !rel.includes('node_modules'))
            .map((rel) => {
                const file = path.join(dir, rel).replace(/\\/g, '/');
                return [file, codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8'))] as [string, string];
            }));

    /** Tier rules this pass removed from pages that print per-state rows or answer per-state questions. */
    const RETIRED_TIER_COPY: readonly RegExp[] = [
        /without a physician agreement/i,
        /Reduced-practice states require/i,
        /restricted-practice states require physician supervision/i,
        /removes the collaborative-agreement dependency/i,
        /no mandated physician relationship/i,
        /does not need to be on-?site/i,
        /typically name a supervising physician/i,
        /In reduced- and restricted-practice states/i,
        /require physician collaboration or supervision/i,
        /which shapes how much/i,
        /Collaborating physician required first/i,
        /Physician oversight where restricted/i,
        /Full clinical independence/i,
        // The press page's tier hints, as the string literals they were.
        /['"`]Physician supervision required['"`]/,
        /['"`]Collaborative agreement required['"`]/,
        /['"`]Practice without a physician agreement['"`]/,
        /open to you at all/i,
        /these are the rules you would plan around/i,
        // A tier name followed by the rule it was read as ("Virginia is a
        // restricted-practice state requiring a practice agreement"): the
        // metro pages carried this pattern, and each instance dropped the
        // state's route out of the arrangement.
        /\b(?:full|reduced|restricted)[- ]practice (?:authority )?state,? (?:requiring|and requires|that requires|which requires)\b/i,
        /\brequires a joint protocol\b/i,
    ];

    it('found the sources', () => {
        expect(sources.length).toBeGreaterThan(100);
    });

    it.each(RETIRED_TIER_COPY)('%s is gone from app, components, lib and scripts', (phrase) => {
        const hits = sources.filter(([, code]) => phrase.test(code)).map(([file]) => file);
        expect(hits).toEqual([]);
    });

    it('nothing renders the dataset\'s "Full Practice Authority" description; only the environment builder reads it', () => {
        const readers = sources
            .filter(([, code]) => /\b(?:practiceAuthority|authority|auth|info)\??\.description\b|\.authorityDescription\b/.test(code))
            .map(([file]) => file);
        expect(readers).toEqual(['lib/pseo/practice-environment.ts']);
    });

    it('every page that prints a tier chip beside a state\'s details prints AANP\'s tier name', () => {
        const code = (file: string) => sources.find(([f]) => f === file)?.[1] ?? '';
        expect(code('app/jobs/state/[state]/page.tsx')).toContain('AANP classification: {getAuthorityLabel(practiceAuthority.authority)}');
        expect(code('app/jobs/locations/[state]/page.tsx')).toContain('AANP classifies {stateName} as a <strong>{getAuthorityLabel(authority.authority)}</strong>');
        expect(code('app/resources/fpa-guide/page.tsx')).toContain('{getAuthorityLabel(info.authority)}');
        expect(code('app/resources/fpa-guide/page.tsx')).toContain('>AANP Classification</th>');
        expect(code('components/LicensureChecker.tsx')).not.toContain('Full Practice Authority');
        expect(code('components/tools/MultiStatePlanner.tsx')).not.toMatch(/Full practice authority/i);
    });

    it('lib/metro-data.ts carries no tier-read rule, and every arrangement it states keeps the state\'s route out', () => {
        // The /jobs/metro pages print this editorial prose (licensure note,
        // sub-market notes, and FAQ answers as visible text plus FAQPage)
        // beside no details string, so section 1 never sees it. Data-driven:
        // for every state whose verified details give a route out of the
        // arrangement they require, a metro string that states the
        // arrangement as a requirement must also state the route out.
        const metro = sources.find(([f]) => f === 'lib/metro-data.ts')?.[1] ?? '';
        expect(metro).not.toBe('');
        expect(metro).not.toMatch(/\b(?:reduced|restricted)-practice state (?:requiring|and requires)\b/);
        expect(metro).not.toMatch(/\brequires a joint protocol\b/);

        const ROUTE_OUT = /\b(?:unless|until|except|exempt\w*|designation|qualif\w*|autonomous|without|drop the agreement)\b/i;
        const withRouteOut = JURISDICTIONS.filter((name) => {
            const { details } = STATE_PRACTICE_AUTHORITY[name];
            return requiresArrangement(details) && hasRouteOut(details);
        });
        expect(withRouteOut).toEqual(expect.arrayContaining(['Virginia', 'Wisconsin', 'New Jersey']));

        const found: string[] = [];
        for (const m of METRO_CITIES) {
            const strings = [
                m.heroDescription, m.licensureNote, m.careDemandContext, ...m.whyThisMetro,
                ...m.subMarkets.map((s) => s.note), ...m.faqs.map((f) => f.answer),
            ];
            for (const text of strings) {
                for (const stateName of withRouteOut) {
                    const claims = sentencesOf(text).filter((sentence) =>
                        sentence.includes(stateName) && !QUESTION.test(sentence)
                        && REQUIREMENT_VERB.test(sentence) && ARRANGEMENT_TERM.test(sentence));
                    if (claims.length > 0 && !ROUTE_OUT.test(text)) found.push(`${m.slug} [${stateName}]: "${claims[0]}"`);
                }
            }
        }
        expect(found).toEqual([]);
    });

    it('the licensure checker FAQ (visible and FAQPage) says tiers differ and names no tier rule', () => {
        const page = sources.find(([f]) => f === 'app/tools/licensure-checker/page.tsx')?.[1] ?? '';
        expect(page).toContain('states in the same tier still set different rules');
        expect(page).toContain("read each state's own requirements in the planner rather than assuming them from the tier");
    });
});
