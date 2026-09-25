/**
 * A practice-authority TIER never answers a question about one state.
 *
 * AANP groups the 51 jurisdictions into three practice environments, and the
 * tier is too coarse to carry a rule: Virginia, South Carolina and Michigan
 * are restricted but none requires physician supervision for all practice;
 * Arkansas, Illinois, Kentucky, New Jersey, West Virginia and Wisconsin are
 * reduced but each has a route out of the agreement; and a dozen full-tier
 * states require a transition to practice. The label and the narratives used
 * to print a tier rule ("Restricted Practice (Physician Supervision
 * Required)", "independent prescribing without physician oversight") right
 * beside each state's verified details, contradicting them.
 *
 * Pinned here, for every jurisdiction:
 *   1. getAuthorityLabel is AANP's tier name and nothing else.
 *   2. Every practice paragraph and practice FAQ answer (which also feeds
 *      FAQPage JSON-LD) is "AANP classifies X as a Y state." plus the
 *      state's own details, and the rest of the paragraph states no rule.
 *      The District of Columbia is "a Y jurisdiction" there, never a state;
 *      the meta descriptions (item 5) name no noun at all.
 *   3. The plain state hub and city narratives name the tier, attribute it
 *      to AANP, and state no rule; the hub's tier meaning is AANP's own
 *      definition trimmed to what is true of every state in the tier.
 *   4. The job page's location panel labels the tier as AANP's.
 *   5. Every meta description and hero deck that names the tier, built the
 *      way the pages build them (the state hub, setting-state and
 *      category-city pages still pass the dataset's "Full Practice
 *      Authority"), prints "AANP classification: {tier}." and never "Full
 *      Practice Authority" or a bare "is a full practice state"; so do the
 *      nearby-states sentence and the specialty authority sentence.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
    getAanpTierDefinition,
    getAuthorityLabel,
    getStatePracticeAuthority,
    STATE_PRACTICE_AUTHORITY,
    type PracticeAuthority,
} from '@/lib/state-practice-authority';
import {
    getNearbyStates,
    getPracticeEnvironment,
    type PracticeEnvironment,
} from '@/lib/pseo/practice-environment';
import {
    buildCategoryCityDescription,
    buildCategoryCityFaqs,
    buildHubDescription,
    buildHubFaqs,
    buildLicensureSentences,
    buildMetroDescription,
    buildNearbyStatesSentence,
    buildPracticingInStateParagraph,
    buildSalaryPracticeEnvironmentParagraph,
    buildSalaryStateDescription,
    buildSalaryStateFaqAdditions,
    buildSettingStateDescription,
    buildSpecialtyAuthoritySentence,
} from '@/lib/pseo/listing-narrative';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';
import { getNearbyDisplayCities, METRO_CITIES } from '@/lib/metro-data';
import { emptyListingFacts } from '@/lib/pseo/listing-facts';
import { NLC_VERIFIED_LABEL } from '@/lib/pseo/practice-environment';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { buildCityFacts, buildCityNarrative } from '@/lib/pseo/city-narrative';
import { CITIES } from '@/lib/pseo/city-data/cities';
import JobLocationContext, { buildJobLocationContext } from '@/components/JobLocationContext';

const JURISDICTIONS = Object.keys(STATE_PRACTICE_AUTHORITY);

/** Any wording that states a practice rule (the tier's old copy, or any rule at all). */
const RULE_WORDING = /physician|supervis|collaborat|agreement|oversight|career-long|required\b/i;
/** The specific tier-rule strings the old copy printed. */
const OLD_TIER_RULES = /Agreement Required|Supervision Required|without physician oversight|requiring physician supervision|requiring a collaborative agreement|physician-supervised|collaborative-agreement logistics/i;

const envFor = (stateName: string): PracticeEnvironment => {
    const env = getPracticeEnvironment(stateName);
    expect(env, stateName).not.toBeNull();
    return env!;
};

/** The District of Columbia is a jurisdiction, not a state (dc-jurisdiction-wording.test.ts). */
const DC = 'District of Columbia';

const classified = (env: PracticeEnvironment): string => {
    const noun = env.stateName === DC ? 'jurisdiction' : 'state';
    return `AANP classifies ${env.stateName} as a ${env.authorityShort} ${noun}. ${env.details}`;
};

describe('1. the label is the AANP tier name only', () => {
    it('names each tier as AANP does, with no rule attached', () => {
        expect(getAuthorityLabel('full')).toBe('Full Practice');
        expect(getAuthorityLabel('reduced')).toBe('Reduced Practice');
        expect(getAuthorityLabel('restricted')).toBe('Restricted Practice');
        for (const tier of ['full', 'reduced', 'restricted'] as PracticeAuthority[]) {
            expect(getAuthorityLabel(tier), tier).not.toMatch(/[()]/);
            expect(getAuthorityLabel(tier), tier).not.toMatch(RULE_WORDING);
        }
    });
});

describe('2. practice paragraphs and FAQ answers take the rule from details only', () => {
    it.each(JURISDICTIONS)('%s', (stateName) => {
        const env = envFor(stateName);
        const lead = classified(env);

        expect(buildLicensureSentences(env).classification).toBe(lead);

        // CITY-C6 and SAL-S1: the lead, then compact and board sentences that
        // state no practice rule of their own.
        for (const paragraph of [
            buildPracticingInStateParagraph(env),
            buildSalaryPracticeEnvironmentParagraph(env, NLC_VERIFIED_LABEL),
        ]) {
            expect(paragraph.startsWith(`${lead} `), stateName).toBe(true);
            expect(paragraph.slice(lead.length), stateName).not.toMatch(RULE_WORDING);
        }

        // FAQ answers, which the pages also publish as FAQPage JSON-LD.
        const hub = buildHubFaqs({ stateName, facts: emptyListingFacts(new Date()), env, categoryRows: [], stepNames: [] })
            .find((f) => f.question === `What is the practice authority in ${stateName}?`);
        expect(hub?.answer, stateName).toBe(lead);

        const categoryCity = buildCategoryCityFaqs({
            slug: 'remote', label: 'Remote', labelSentence: 'remote', city: 'Anytown', stateName,
            facts: emptyListingFacts(new Date()), cityBenchmark: null, env, qualifications: null,
        }).find((f) => /full practice authority\?$/.test(f.question));
        expect(categoryCity?.answer, stateName)
            .toBe(`${lead} See the practice section on this page for the compact status and board.`);

        const salary = buildSalaryStateFaqAdditions({ env, nlcVerifiedLabel: NLC_VERIFIED_LABEL, topEmployers: [] })
            .find((f) => /full practice authority\?$/.test(f.question));
        expect(salary?.answer, stateName).toBe(lead);
    });

    it('the District of Columbia is classified as a jurisdiction, never a state', () => {
        const env = envFor(DC);
        expect(env.stateCode).toBe('DC');
        const lead = `AANP classifies ${DC} as a full practice jurisdiction.`;
        const answers = [
            buildLicensureSentences(env).classification,
            buildPracticingInStateParagraph(env),
            buildSalaryPracticeEnvironmentParagraph(env, NLC_VERIFIED_LABEL),
            buildHubFaqs({ stateName: DC, facts: emptyListingFacts(new Date()), env, categoryRows: [], stepNames: [] })
                .find((f) => f.question === `What is the practice authority in ${DC}?`)?.answer,
            buildCategoryCityFaqs({
                slug: 'remote', label: 'Remote', labelSentence: 'remote', city: 'Washington', stateName: DC,
                facts: emptyListingFacts(new Date()), cityBenchmark: null, env, qualifications: null,
            }).find((f) => /full practice authority\?$/.test(f.question))?.answer,
            buildSalaryStateFaqAdditions({ env, nlcVerifiedLabel: NLC_VERIFIED_LABEL, topEmployers: [] })
                .find((f) => /full practice authority\?$/.test(f.question))?.answer,
        ];
        for (const text of answers) {
            expect(text).toContain(lead);
            expect(text).not.toContain(`${DC} as a full practice state`);
        }
    });

    it('the District of Columbia meta descriptions attribute the tier and never call it a state', () => {
        const env = envFor(DC);
        const facts = { ...emptyListingFacts(new Date()), total: 4, distinctEmployers: 2 };
        const descriptions = [
            buildHubDescription({ stateName: DC, facts, topCategories: [] }),
            buildSettingStateDescription({ label: 'Remote', slug: 'remote', stateName: DC, facts, statsAsOf: null }),
            buildCategoryCityDescription({ labelSentence: 'remote', city: 'Washington', stateCode: 'DC', facts }),
            buildMetroDescription({ city: 'Washington', stateCode: 'DC', stateName: DC, practiceAuthority: 'Full', nearbyCities: [], subMarkets: [], benchmark: null }),
            buildSalaryStateDescription({ env, facts }),
        ];
        for (const text of descriptions) {
            expect(text).toContain('AANP classification: Full Practice.');
            expect(text).not.toMatch(/\bpractice state\b|Authority/i);
        }
        // A state reads the same attributed clause.
        expect(buildSalaryStateDescription({ env: envFor('Texas'), facts }))
            .toContain('AANP classification: Restricted Practice. Texas is a member of the Nurse Licensure Compact.');
    });

    it('Virginia no longer reads as physician supervised', () => {
        const env = envFor('Virginia');
        const paragraph = buildPracticingInStateParagraph(env);
        expect(paragraph).not.toMatch(OLD_TIER_RULES);
        expect(paragraph).toContain('practice without a practice agreement');
    });
});

describe('3. narratives name the tier and state no rule', () => {
    const hubInput = (stateName: string) => ({
        stateName,
        stateCode: 'XX',
        totalJobs: 9,
        medianSalaryK: 0,
        uniqueEmployerCount: 3,
        topCategoryLabels: ['Remote'],
        topCityNames: ['Springfield'],
    });

    it('AANP tier meanings keep only what is true of every state in the tier', () => {
        const full = getAanpTierDefinition('full');
        expect(full).toContain('transition period');
        // AANP's own defining clause, and the transition caveat as its own
        // sentence (AANP's page says nothing about transitions).
        expect(full).toMatch(/^AANP uses this category where state law lets .+, under the exclusive licensure authority of the state board of nursing\. Some of these states first require a transition period\.$/);
        // Never defined by the absence of a career-long requirement: beside
        // the other two definitions that would claim the others have one.
        expect(full).not.toMatch(/career-long|physician|supervis|collaborat/i);
        for (const tier of ['reduced', 'restricted'] as PracticeAuthority[]) {
            const definition = getAanpTierDefinition(tier);
            expect(definition, tier).toMatch(/^AANP uses this category where state law/);
            expect(definition, tier).toContain('at least one element');
            expect(definition, tier).toContain('for example');
            expect(definition, tier).not.toMatch(/career-long|physician/i);
        }
    });

    it.each(JURISDICTIONS)('%s hub narrative', (stateName) => {
        const tier = STATE_PRACTICE_AUTHORITY[stateName].authority;
        const narrative = buildPlainStateNarrative(hubInput(stateName));
        const definition = getAanpTierDefinition(tier);
        expect(narrative).toContain(`AANP places ${stateName} in its ${tier} practice category.`);
        expect(narrative).toContain(definition);
        expect(narrative).not.toMatch(OLD_TIER_RULES);
        // Outside AANP's own (trimmed) definition, no sentence states a rule.
        expect(narrative.replace(definition, '')).not.toMatch(RULE_WORDING);
    });

    it('the District of Columbia hub and city narratives never count DC among states', () => {
        const hub = buildPlainStateNarrative({ ...hubInput(DC), stateCode: 'DC' });
        expect(hub).toContain(`AANP places ${DC} in its full practice category.`);
        expect(hub).toContain(`Jurisdictions in the same category still set different requirements, so check the ${DC} rules themselves before applying.`);
        expect(hub).not.toContain('States in the same category');
        // A state keeps its state wording.
        expect(buildPlainStateNarrative({ ...hubInput('Texas'), stateCode: 'TX' }))
            .toContain('States in the same category still set different requirements, so check the Texas rules themselves before applying.');

        const washington = CITIES.find((c) => c.stateCode === 'DC');
        expect(washington).toBeDefined();
        const city = buildCityNarrative(buildCityFacts(washington!), 3);
        expect(city).toContain(`AANP places ${DC} in its full practice category; jurisdictions in the same category still set different requirements`);
        expect(city).not.toContain('states in the same category');
    });

    it('city narratives name the tier and state no rule, in every city', () => {
        const offenders: string[] = [];
        for (const city of CITIES) {
            const text = buildCityNarrative(buildCityFacts(city), 3);
            if (RULE_WORDING.test(text) || OLD_TIER_RULES.test(text)) offenders.push(city.slug);
        }
        expect(offenders).toEqual([]);
        const richmond = CITIES.find((c) => c.name === 'Richmond' && c.stateCode === 'VA');
        expect(richmond).toBeDefined();
        expect(buildCityNarrative(buildCityFacts(richmond!), 3))
            .toContain('AANP places Virginia in its restricted practice category;');
    });
});

describe('4. the job page location panel labels the tier as AANP\'s', () => {
    it('Virginia shows the AANP tier, then its own details, and no tier rule', () => {
        const model = buildJobLocationContext({
            city: 'Richmond', state: 'Virginia', stateCode: 'VA',
            normalizedMinSalary: null, normalizedMaxSalary: null, salaryIsEstimated: false,
        }, 0);
        expect(model).not.toBeNull();
        const html = renderToStaticMarkup(React.createElement(JobLocationContext, { model: model! }));
        expect(html).toContain('AANP classification: Restricted Practice');
        expect(html).toContain('Classification source:');
        expect(html).not.toMatch(OLD_TIER_RULES);
    });
});

describe('5. meta descriptions and hero decks attribute the tier, built the way the pages build them', () => {
    const facts = { ...emptyListingFacts(new Date()), total: 4, distinctEmployers: 2 };
    /** The tier printed as a bare fact about the state, or the dataset's rule-bearing name for it. */
    const BARE_TIER = /Authority|\bis an? (full|reduced|restricted) practice (state|jurisdiction)\b/i;
    const clauseFor = (stateName: string): string =>
        `AANP classification: ${getAuthorityLabel(STATE_PRACTICE_AUTHORITY[stateName].authority)}.`;

    it('the full tier includes every jurisdiction whose details describe a transition period', () => {
        const fullTier = JURISDICTIONS.filter((s) => STATE_PRACTICE_AUTHORITY[s].authority === 'full');
        for (const stateName of ['Colorado', 'Connecticut', 'Maine', 'Maryland', 'Massachusetts', 'Minnesota', 'Nebraska', 'Nevada', 'New York', 'South Dakota', 'Vermont']) {
            expect(fullTier, stateName).toContain(stateName);
            // The dataset still names the tier "Full Practice Authority"; the
            // builders must never print it.
            expect(STATE_PRACTICE_AUTHORITY[stateName].description).toBe('Full Practice Authority');
        }
    });

    it.each(JURISDICTIONS)('%s', (stateName) => {
        const clause = clauseFor(stateName);
        const env = getPracticeEnvironment(stateName);
        const city = CITIES.find((c) => c.state === stateName);
        const cityName = city?.name ?? 'Anytown';
        const stateCode = city?.stateCode ?? STATE_CODES[stateName];
        const built = {
            // app/jobs/state/[state]/page.tsx: generateMetadata, and the
            // heroDescription CategoryHero renders as visible text.
            hubMeta: buildHubDescription({ stateName, facts, authorityDescription: getStatePracticeAuthority(stateName)?.description ?? null, topCategories: [] }),
            // lib/pseo/setting-state-template.tsx generateMetadata.
            settingState: buildSettingStateDescription({ label: 'Remote', slug: 'remote', stateName, facts, authorityDescription: env?.authorityDescription ?? null, statsAsOf: null }),
            // lib/pseo/category-city-template.tsx generateMetadata.
            categoryCity: buildCategoryCityDescription({ labelSentence: 'remote', city: cityName, stateCode, facts, authorityDescription: env?.authorityDescription ?? null }),
            // The same builders once the callers stop passing the retired field.
            hubBare: buildHubDescription({ stateName, facts, topCategories: [] }),
            settingStateBare: buildSettingStateDescription({ label: 'Remote', slug: 'remote', stateName, facts, statsAsOf: null }),
            categoryCityBare: buildCategoryCityDescription({ labelSentence: 'remote', city: cityName, stateCode, facts }),
            // app/salary-guide/[state]/page.tsx below the pay gate.
            salary: env ? buildSalaryStateDescription({ env, facts }) : '',
        };
        for (const [surface, text] of Object.entries(built)) {
            expect(text, `${stateName} ${surface}`).toContain(clause);
            expect(text, `${stateName} ${surface}`).not.toMatch(BARE_TIER);
            expect(text, `${stateName} ${surface}`).not.toMatch(RULE_WORDING);
        }

        // HUB-S9 as components/seo/pseo/NearbyStatesTable.tsx builds its rows.
        const nearby = getNearbyStates(stateName);
        const sentence = buildNearbyStatesSentence(nearby.map((row) => ({
            name: row.stateName, count: 1, authorityDescription: row.authorityDescription,
        })));
        if (nearby.length > 0) {
            expect(sentence, stateName).toMatch(/with AANP's classification of each: /);
            expect(sentence, stateName).not.toMatch(/Authority/);
            for (const row of nearby.slice(0, 3)) {
                expect(sentence, `${stateName} near ${row.stateName}`).toContain(`${row.stateName} (1 role, ${getAuthorityLabel(row.authority)})`);
            }
        }
    });

    it.each(METRO_CITIES.map((m) => [m.slug, m] as const))('metro %s', (_slug, metro) => {
        // app/jobs/metro/[slug]/page.tsx: the meta description and the visible hero deck.
        const text = buildMetroDescription({
            city: metro.city, stateCode: metro.stateCode, stateName: metro.state, practiceAuthority: metro.practiceAuthority,
            nearbyCities: getNearbyDisplayCities(metro), subMarkets: [], benchmark: null,
        });
        expect(text).toContain(clauseFor(metro.state));
        expect(text).not.toMatch(BARE_TIER);
    });

    it('the specialty authority sentence names the full tier as AANP does', () => {
        const text = buildSpecialtyAuthoritySentence({ label: 'family practice', states: [{ name: 'Connecticut', count: 4 }, { name: 'New York', count: 2 }] });
        expect(text).toBe('Of the 6 open family practice roles with a listed state, 6 are in full practice states (Connecticut and New York), using the AANP classification.');
    });
});
