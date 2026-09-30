/**
 * CQ-06 (indexing audit): APRN-axis roles (nurse anesthetist, nurse midwife,
 * clinical nurse specialist) are not NP roles, so the category landing and
 * the setting x state templates name them through labelNoun
 * (lib/pseo/category-metadata.ts): "Nurse Anesthetist Jobs", never "Nurse
 * Anesthetist NP Jobs". NP settings keep "{Label} NP".
 *
 * The narrative builders (titles, descriptions, FAQ questions) are pinned
 * by behaviour in tests/unit/listing-narrative.test.ts. The templates render
 * through React server components that need a database, so their headings
 * and structured data names are pinned here on the comment-stripped source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';
import { labelNoun } from '@/lib/pseo/category-metadata';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';

const ROOT = process.cwd();
const read = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NP = brand.niche.short;

describe('labelNoun over the live configs', () => {
    it.each([...CATEGORY_AXES.aprn])('%s: the landing and setting labels are the role itself', (slug) => {
        const landingLabel = ALL_CATEGORY_CONFIGS[slug]?.label;
        expect(landingLabel, slug).toBeTruthy();
        expect(labelNoun(slug, landingLabel!)).toBe(landingLabel);
        expect(labelNoun(slug, landingLabel!)).not.toContain(` ${NP}`);
        const settingLabel = SETTING_CONFIGS[slug]?.label;
        if (settingLabel) expect(labelNoun(slug, settingLabel)).toBe(settingLabel);
    });

    it('an NP setting keeps the suffix', () => {
        expect(labelNoun('remote', SETTING_CONFIGS.remote.label)).toBe(`${SETTING_CONFIGS.remote.label} ${NP}`);
    });
});

describe('lib/pseo/category-landing-template.tsx names the role through labelNoun', () => {
    const code = stripComments(read('lib/pseo/category-landing-template.tsx'));

    it('derives the noun once from the slug and label', () => {
        expect(code).toContain('const noun = labelNoun(slug, label);');
    });

    it('the H1 second line drops the NP suffix for a standalone role', () => {
        expect(code).toContain("headlineLine2={noun === label ? 'Jobs' : `${brand.niche.short} Jobs`}");
        expect(code).not.toContain('headlineLine2={`${brand.niche.short} Jobs`}');
    });

    it('the state section heading and the FAQ heading read the noun', () => {
        expect(code).toContain('Browse {noun} Jobs by State');
        expect(code).not.toContain('Browse {label} {brand.niche.short} Jobs by State');
        expect(code).toContain('heading={noun === label ? `${noun} Jobs FAQ` : undefined}');
    });
});

describe('lib/pseo/setting-state-template.tsx names the role through labelNoun', () => {
    const code = stripComments(read('lib/pseo/setting-state-template.tsx'));

    it('derives the noun once from the config', () => {
        expect(code).toContain('const noun = labelNoun(config.slug, config.label);');
        expect(code).toContain('const isStandaloneRole = noun === config.label;');
    });

    it('the H1 reads "{Label} Jobs in {State}" for a standalone role and "{Label} NP jobs in {State}" otherwise', () => {
        expect(code).toContain('headlineLine1={config.label}');
        expect(code).toContain("headlineLine2={isStandaloneRole ? 'Jobs' : brand.niche.short}");
        expect(code).toContain('headlineSub={isStandaloneRole ? `in ${stateName}.` : `jobs in ${stateName}.`}');
    });

    it('the ItemList and WebPage names, the hero copy and the FAQ heading read the noun', () => {
        // Both JSON-LD nodes (ItemList and WebPage) carry the same name.
        expect(code.match(/name: `\$\{noun\} Jobs in \$\{stateName\}`,/g)?.length).toBe(2);
        expect(code).toContain('heroAlt={`${noun} jobs in ${stateName}`}');
        expect(code).toContain('description={`${noun} positions in ${stateName}. ${config.heroSubtitle}.`}');
        expect(code).toContain('heading={`${noun} Jobs in ${stateName} FAQ`}');
        expect(code).toContain('buildSettingStateTitle({ titleLabel: config.label, slug: config.slug, stateName, total: facts.total })');
    });

    it('no heading or schema name hard-codes "{label} NP" any more', () => {
        expect(code).not.toContain('name: `${config.label} ${brand.niche.short} Jobs in ${stateName}`');
        expect(code).not.toContain('heading={`${config.label} ${brand.niche.short} Jobs in ${stateName} FAQ`}');
        expect(code).not.toContain('{config.label} {brand.niche.short} jobs in nearby states');
    });
});
