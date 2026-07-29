/**
 * P1 #15 + #20 — classifier rules for the new verticals and explicit
 * employer-declared field consumption (taxonomy-expansion pkg).
 *
 *   #15 aesthetics / pain-management / palliative-hospice get
 *       title-anchored keyword rules (obvious-match + must-NOT-match,
 *       incl. the 'aesthetic' ⊂ 'anaesthetist' word-boundary trap).
 *
 *   #20 classifyJobTags trusts the /post-job structured fields:
 *       - an explicit `specialty` slug REPLACES substring guessing across
 *         the specialty/APRN axis and survives mutual exclusion;
 *       - `setting` / `population` display values map to canonical tags
 *         through the same EMPLOYER_* maps that drive the form options.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyJobTags,
  CANONICAL_CATEGORY_SLUGS,
  EMPLOYER_SPECIALTY_SLUGS,
  EMPLOYER_SETTING_TAGS,
  EMPLOYER_POPULATION_TAGS,
  type ClassifiableJob,
} from '@/lib/pseo/category-tagger';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';

function tags(job: Partial<ClassifiableJob> & { title: string }): string[] {
  return classifyJobTags(job);
}

describe('P1 #15 — aesthetics rules', () => {
  it('med-spa / injector titles match', () => {
    expect(tags({ title: 'Aesthetic Nurse Practitioner' })).toContain('aesthetics');
    expect(tags({ title: 'Nurse Injector (NP) - Botox & Fillers' })).toContain('aesthetics');
    expect(tags({ title: 'Med Spa Nurse Practitioner' })).toContain('aesthetics');
    expect(tags({ title: 'NP - MedSpa Injectables' })).toContain('aesthetics');
  });

  it("British 'anaesthetist' spellings never leak into aesthetics (word-boundary trap)", () => {
    // 'aesthetic' is a substring of 'anaesthetist'/'anaesthetic' — the
    // rule's space/punct-anchored keywords must not fire on them. (The
    // anesthesia rule itself only carries US spellings; that's its
    // pre-existing scope, not this test's concern.)
    expect(tags({ title: 'Nurse Anaesthetist - Theatre Team' })).not.toContain('aesthetics');
    expect(tags({ title: 'Anaesthetic Nurse Practitioner' })).not.toContain('aesthetics');
  });

  it('CRNA titles do not match aesthetics', () => {
    expect(tags({ title: 'Certified Registered Nurse Anesthetist (CRNA)' })).not.toContain('aesthetics');
  });

  it('aesthetic-dermatology combo titles land on aesthetics, not dermatology (sibling dedupe)', () => {
    const t = tags({ title: 'Aesthetic Dermatology Nurse Practitioner' });
    expect(t).toContain('aesthetics');
    expect(t).not.toContain('dermatology');
  });

  it('plain dermatology titles still tag dermatology', () => {
    expect(tags({ title: 'Dermatology Nurse Practitioner' })).toContain('dermatology');
  });
});

describe('P1 #15 — pain-management rules', () => {
  it('pain practice titles match', () => {
    expect(tags({ title: 'Pain Management Nurse Practitioner' })).toContain('pain-management');
    expect(tags({ title: 'Interventional Pain NP' })).toContain('pain-management');
    expect(tags({ title: 'NP - Chronic Pain Clinic' })).toContain('pain-management');
  });

  it('unrelated specialty titles do not match', () => {
    expect(tags({ title: 'Family Nurse Practitioner' })).not.toContain('pain-management');
    expect(tags({ title: 'Orthopedic Nurse Practitioner' })).not.toContain('pain-management');
  });
});

describe('P1 #15 — palliative-hospice rules', () => {
  it('palliative and hospice titles match', () => {
    expect(tags({ title: 'Palliative Care Nurse Practitioner' })).toContain('palliative-hospice');
    expect(tags({ title: 'Hospice NP - Home Visits' })).toContain('palliative-hospice');
    expect(tags({ title: 'End-of-Life Care Nurse Practitioner' })).toContain('palliative-hospice');
  });

  it('oncology-palliative combo titles keep the palliative tag', () => {
    expect(tags({ title: 'Palliative Care NP - Oncology Service' })).toContain('palliative-hospice');
  });

  it('unrelated titles do not match', () => {
    expect(tags({ title: 'Urgent Care Nurse Practitioner' })).not.toContain('palliative-hospice');
  });
});

describe('P1 #20 — explicit specialty replaces substring guessing', () => {
  it('explicit specialty wins over a conflicting title keyword', () => {
    // Substring guessing alone tags this family-practice (and the
    // exclusion chain would then remove primary-care). The employer's
    // structured answer must win.
    const t = tags({ title: 'FNP - Primary Care Clinic', specialty: 'primary-care' });
    expect(t).toContain('primary-care');
    expect(t).not.toContain('family-practice');
  });

  it('explicit specialty survives the mutual-exclusion pass', () => {
    const t = tags({ title: 'Family Nurse Practitioner', specialty: 'primary-care' });
    expect(t).toContain('primary-care');
    expect(t).not.toContain('family-practice');
  });

  it('explicit APRN-axis specialty is honored', () => {
    const t = tags({ title: 'Advanced Practice Provider', specialty: 'anesthesia' });
    expect(t).toContain('anesthesia');
  });

  it('invalid / non-specialty values are ignored, keyword guessing still applies', () => {
    expect(tags({ title: 'Family Nurse Practitioner', specialty: 'not-a-slug' })).toContain('family-practice');
    // 'remote' is a real slug but NOT a specialty-axis slug — never
    // trusted as a specialty answer.
    const t = tags({ title: 'Family Nurse Practitioner', specialty: 'remote' });
    expect(t).toContain('family-practice');
    expect(t).not.toContain('remote');
  });

  it('non-specialty axes still keyword-match when a specialty is explicit', () => {
    const t = tags({
      title: 'Telehealth Nurse Practitioner',
      specialty: 'psychiatric-mental-health',
      isRemote: true,
    });
    expect(t).toContain('telehealth');
    expect(t).toContain('remote');
    expect(t).toContain('psychiatric-mental-health');
  });
});

describe('P1 #20 — explicit setting / population consumption', () => {
  it('setting display values map to canonical tags', () => {
    expect(tags({ title: 'Nurse Practitioner', setting: 'Urgent Care' })).toContain('urgent-care');
    expect(tags({ title: 'Nurse Practitioner', setting: 'Community Health / FQHC' })).toContain('community-health');
  });

  it('legacy stored setting values still resolve (pre-P1 rows)', () => {
    expect(tags({ title: 'Nurse Practitioner', setting: 'Corrections' })).toContain('correctional');
    expect(tags({ title: 'Nurse Practitioner', setting: 'Community Health' })).toContain('community-health');
  });

  it('LLM-written setting/population vocabulary resolves too (scraped rows)', () => {
    // lib/llm-enrichment.ts:57-58 writes these strings into Job.setting /
    // Job.population for ingested jobs — they must not be dropped.
    expect(tags({ title: 'Nurse Practitioner', setting: 'Emergency' })).toContain('emergency');
    expect(tags({ title: 'Nurse Practitioner', population: 'Children' })).toContain('pediatric');
    expect(tags({ title: 'Nurse Practitioner', population: 'Adolescents' })).toContain('pediatric');
    expect(tags({ title: 'Nurse Practitioner', population: 'Geriatric' })).toContain('geriatric');
    // Pre-P1-#20 form option.
    expect(tags({ title: 'Nurse Practitioner', population: 'Child & Adolescent' })).toContain('pediatric');
  });

  it('values with no NP taxonomy page stay unmapped rather than guessing', () => {
    for (const setting of ['Residential', 'Academic / University']) {
      expect(tags({ title: 'Nurse Practitioner', setting }), setting).toEqual([]);
    }
    for (const population of ['Substance Abuse', 'Forensic']) {
      expect(tags({ title: 'Nurse Practitioner', population }), population).toEqual([]);
    }
  });

  it('population display values map to canonical tags', () => {
    expect(tags({ title: 'Nurse Practitioner', population: 'Geriatric / Older Adults' })).toContain('geriatric');
    expect(tags({ title: 'Nurse Practitioner', population: 'Veterans' })).toContain('veterans');
  });

  it('no-tag options contribute nothing', () => {
    const t = tags({ title: 'Nurse Practitioner', setting: 'Academic / University', population: 'Adults' });
    expect(t).toEqual([]);
  });

  it('explicit setting survives exclusion (hospital + hospitalist can coexist)', () => {
    const t = tags({ title: 'Hospitalist Nurse Practitioner', setting: 'Hospital' });
    expect(t).toContain('hospitalist');
    expect(t).toContain('hospital');
  });

  it('unknown free-text values are ignored', () => {
    expect(tags({ title: 'Nurse Practitioner', setting: 'Underwater Basket Weaving' })).toEqual([]);
  });
});

describe('P1 #20 — option maps stay registry-true', () => {
  it('EMPLOYER_SPECIALTY_SLUGS is exactly the specialty + APRN axes', () => {
    expect([...EMPLOYER_SPECIALTY_SLUGS]).toEqual([
      ...CATEGORY_AXES.specialty,
      ...CATEGORY_AXES.aprn,
    ]);
  });

  it('every non-null setting/population tag is a canonical slug', () => {
    const canonical = new Set<string>(CANONICAL_CATEGORY_SLUGS);
    for (const [option, tag] of Object.entries(EMPLOYER_SETTING_TAGS)) {
      if (tag !== null) expect(canonical.has(tag), `${option} → ${tag}`).toBe(true);
    }
    for (const [option, tag] of Object.entries(EMPLOYER_POPULATION_TAGS)) {
      if (tag !== null) expect(canonical.has(tag), `${option} → ${tag}`).toBe(true);
    }
  });

  it('no psych-era option strings remain in the offered maps', () => {
    const offered = [
      ...Object.keys(EMPLOYER_SETTING_TAGS),
      ...Object.keys(EMPLOYER_POPULATION_TAGS),
    ];
    for (const donorOption of ['Emergency / Crisis', 'Residential', 'Substance Use / Dual Diagnosis', 'Forensic', 'Child & Adolescent']) {
      expect(offered, donorOption).not.toContain(donorOption);
    }
  });

  it('determinism: tags return in canonical order with explicit fields present', () => {
    const job: ClassifiableJob = {
      title: 'Nurse Practitioner - Full Time',
      jobType: 'Full-Time',
      specialty: 'pain-management',
      setting: 'Outpatient',
    };
    expect(tags(job)).toEqual(['outpatient', 'full-time', 'pain-management']);
    expect(tags(job)).toEqual(tags(job));
  });
});
