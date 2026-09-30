/**
 * lib/pseo/landing-where.ts: one bucket clause per category landing, shared
 * by the landing pages, their sibling cards and the aggregate-pseo landing
 * verdict. Since CQ-14 / fixSoon 11 it is the category's ONE predicate
 * (categoryPredicate), the same clause its state and city pages count with,
 * so /jobs/full-time and /jobs/full-time/{state} count one set (CS-05) and
 * /jobs/remote and /jobs/remote/{state} count the fully remote work mode.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { categoryPredicate, type CategoryTag } from '@/lib/pseo/category-tagger';
import { landingBucketWhere, settingCategoryWhere, stripLocationKeys } from '@/lib/pseo/landing-where';

const ROOT = process.cwd();

describe('stripLocationKeys and settingCategoryWhere', () => {
  it('drops only the top-level state and city keys', () => {
    expect(stripLocationKeys({ isPublished: true, state: { equals: 'Texas' }, city: { equals: 'Waco' }, OR: [1] }))
      .toEqual({ isPublished: true, OR: [1] });
  });

  it('is the setting x state clause without the state', () => {
    const where = settingCategoryWhere('full-time') as Record<string, unknown>;
    const perState = SETTING_CONFIGS['full-time'].buildWhere('Texas') as Record<string, unknown>;
    expect(where).not.toHaveProperty('state');
    expect(where).toEqual(stripLocationKeys(perState));
    expect(settingCategoryWhere('not-a-setting')).toBeNull();
  });
});

describe('landingBucketWhere: one predicate per category (CQ-14, fixSoon 11)', () => {
  it('is the published rows of the category predicate for every taxonomy slug', () => {
    for (const slug of ALL_CATEGORY_SLUGS) {
      expect(landingBucketWhere(slug), slug).toEqual({ isPublished: true, ...categoryPredicate(slug as CategoryTag) });
    }
  });

  it('CS-05: every landing counts exactly the rows its state pages count, without the state', () => {
    for (const slug of Object.keys(SETTING_CONFIGS)) {
      expect(landingBucketWhere(slug), slug).toEqual(settingCategoryWhere(slug));
    }
  });

  it('every landing counts exactly the rows its city pages count, without the location', () => {
    for (const [slug, config] of Object.entries(ALL_CATEGORY_CONFIGS)) {
      const perCity = stripLocationKeys(config.buildWhere('Texas', 'Austin') as Record<string, unknown>);
      expect(landingBucketWhere(slug), slug).toEqual(perCity);
    }
  });

  it('CQ-05: remote is the fully remote work mode; telehealth adds it to its title tag', () => {
    expect(landingBucketWhere('remote')).toEqual({ isPublished: true, OR: [{ isRemote: true, isHybrid: false }] });
    const telehealth = JSON.stringify(landingBucketWhere('telehealth'));
    expect(telehealth).toContain('"categoryTags":{"has":"telehealth"}');
    expect(telehealth).toContain('"isRemote":true,"isHybrid":false');
    // No description keyword decides a work-mode category.
    expect(JSON.stringify(landingBucketWhere('remote'))).not.toContain('"description"');
    expect(telehealth).not.toContain('"description"');
  });

  it('the job types read the structured jobType, never the legacy title sweep', () => {
    for (const slug of ['full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens']) {
      const json = JSON.stringify(landingBucketWhere(slug));
      expect(json, slug).toContain('"jobType"');
      expect(json, slug).not.toContain('"description"');
      expect(json, slug).not.toContain('permanent');
    }
  });

  it('never degrades to all published jobs, and an unknown slug matches nothing', () => {
    for (const slug of ALL_CATEGORY_SLUGS) {
      expect(JSON.stringify(landingBucketWhere(slug)), slug).toMatch(/categoryTags|"title"|isRemote|jobType|newGradFriendly/);
    }
    expect(landingBucketWhere('behavioral-health')).toEqual({ isPublished: true, id: { in: [] } });
  });

  it('every landing page, the template and the cron read the shared helper, with no local copy left', () => {
    const jobsDir = path.join(ROOT, 'app', 'jobs');
    const pages = fs.readdirSync(jobsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(jobsDir, d.name, 'page.tsx'))
      .filter((file) => fs.existsSync(file));
    const readers = [
      ...pages,
      path.join(ROOT, 'lib', 'pseo', 'category-landing-template.tsx'),
      path.join(ROOT, 'app', 'api', 'cron', 'aggregate-pseo', 'route.ts'),
    ];
    for (const file of readers) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/function categoryWhere\(/);
      expect(src, file).not.toMatch(/function landingCategoryWhere\(/);
      expect(src, file).not.toMatch(/const BESPOKE_BUCKETS/);
      // The legacy keyword registry decides no landing any more.
      expect(src, file).not.toMatch(/buildCategoryWhereClause\(/);
      expect(src, file).not.toMatch(/CATEGORY_FILTERS\[/);
    }
  });
});
