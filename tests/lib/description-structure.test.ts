/**
 * Walls of text in ingested descriptions, broken into the lines the job page
 * reads as headings, paragraphs and bullets (owner, 2026-11-25: "the job
 * descriptions from aggregated posts are not structured ... please fix it and
 * back fill the structuring"). The VA announcements USAJobs sends carry each
 * section as one block of several thousand characters with the section's own
 * labels inside it; these hold what the structuring may and may not do.
 */
import { describe, expect, it } from 'vitest';
import { LONG_LINE_CHARS, isLabelSentence, structureDescription, wordsOf } from '@/lib/description-structure';
import { normalizeJobWithReason } from '@/lib/job-normalizer';

const SENTENCE =
  'Applicants are expected to keep a current, full and unrestricted license in a State or Territory of the United States, and to show it on the first day of work.';

/** A USAJobs style block: the labels sit inside one long line, as the API sends them. */
const FEDERAL_BLOCK = [
  'The staff clinician provides a full range of services in inpatient and outpatient settings.',
  SENTENCE,
  'Licensure and Certification.',
  'The following licensure and certification requirements are considered conditions of employment.',
  SENTENCE,
  SENTENCE,
  'Basic Certification.',
  'All staff must maintain full and current certification by the national board, as required under 38 U.S.C. § 7402 and VA Directive No. 5005.',
  SENTENCE,
  'Demonstrated Knowledge, Skills, and Abilities.',
  'Entry level into practice may include but are not limited to the following:',
  'Ability to translate the principles of professional practice into care.',
  'Knowledge of the standards of care for the population served.',
  'Skill in clear written and spoken communication with patients and families.',
  'Preferred Experience.',
  'Two years in an acute care setting, including Dr. supervised rotations, is preferred but not required for the entry grade.',
].join(' ');

describe('structureDescription', () => {
  it('leaves a short description, and every short line, exactly as it is', () => {
    const short = 'ABOUT THE ROLE\n\n• Medication management\n• Telehealth\n\nApply today.';
    expect(structureDescription(short)).toBe(short);
    const shortLines = Array.from({ length: 12 }, () => SENTENCE).join('\n');
    expect(structureDescription(shortLines)).toBe(shortLines);
  });

  it('breaks a federal block into headings, paragraphs and bullets', () => {
    expect(FEDERAL_BLOCK.length).toBeGreaterThan(LONG_LINE_CHARS);
    const lines = structureDescription(FEDERAL_BLOCK).split('\n');
    expect(lines).toContain('Licensure and Certification:');
    expect(lines).toContain('Basic Certification:');
    expect(lines).toContain('Demonstrated Knowledge, Skills, and Abilities:');
    expect(lines).toContain('Preferred Experience:');
    expect(lines).toContain('• Knowledge of the standards of care for the population served.');
    // Every heading is short enough for the page to read it as one.
    for (const line of lines.filter((l) => l.endsWith(':') && !l.includes(' the following:'))) {
      expect(line.length).toBeLessThan(60);
    }
    // No paragraph is a wall any more.
    for (const line of lines) expect(line.length).toBeLessThan(LONG_LINE_CHARS);
  });

  it('only adds line breaks and marks: every word stays, in order', () => {
    expect(wordsOf(structureDescription(FEDERAL_BLOCK))).toEqual(wordsOf(FEDERAL_BLOCK));
  });

  it('does not split at an abbreviation, a statute number or an initial', () => {
    const out = structureDescription(FEDERAL_BLOCK);
    expect(out).toContain('38 U.S.C. § 7402 and VA Directive No. 5005.');
    expect(out).toContain('including Dr. supervised rotations');
  });

  it('runs twice to the same result', () => {
    const once = structureDescription(FEDERAL_BLOCK);
    expect(structureDescription(once)).toBe(once);
  });

  it('turns a lone Title Case sentence into a heading only when the line holds at least two', () => {
    const one = Array.from({ length: 5 }, () => SENTENCE).join(' ') + ' Apply Today. ' + SENTENCE;
    const lines = structureDescription(one).split('\n');
    expect(lines).not.toContain('Apply Today:');
    expect(wordsOf(lines.join(' '))).toEqual(wordsOf(one));
  });

  it('reads a list cue only as a whole word: "Healthcare:" or "Analysis:" does not turn the prose after it into bullets', () => {
    const wall = [
      'About Acme Healthcare: Acme runs outpatient clinics across the region and treats adults and adolescents in person and by video.',
      'Our clinicians share one record system and meet weekly to review complex cases together with the medical director.',
      'Case Analysis: Each new patient receives a full evaluation before a treatment plan is set with the family.',
      'The team works Monday to Friday and shares call one weekend a month, with protected time for notes every afternoon.',
      'Each clinician keeps a steady panel and receives mentorship during the first year on the team.',
      'Duties include: Evaluate new patients. Manage medications. Coordinate with therapists.',
    ].join(' ');
    expect(wall.length).toBeGreaterThan(LONG_LINE_CHARS);
    const lines = structureDescription(wall).split('\n');
    const bullets = lines.filter((line) => line.startsWith('•'));
    // Only the real list, after "Duties include:", is bulleted.
    expect(bullets).toEqual(['• Evaluate new patients.', '• Manage medications.', '• Coordinate with therapists.']);
    expect(wordsOf(lines.join(' '))).toEqual(wordsOf(wall));
  });

  it('keeps a long line with no sentence end as it is, and a long bullet as it is', () => {
    const run = 'word '.repeat(200).trim();
    expect(structureDescription(run)).toBe(run);
    const bullet = `• ${Array.from({ length: 5 }, () => SENTENCE).join(' ')}`;
    expect(structureDescription(bullet)).toBe(bullet);
  });
});

describe('isLabelSentence', () => {
  it.each([
    ['Licensure and Certification.', true],
    ['Education.', true],
    ['Demonstrated Knowledge, Skills, and Abilities.', true],
    ['U.S. Citizenship.', false],
    ['All applicants must apply online.', false],
    ['The following requirements apply to every candidate in this posting and series.', false],
  ])('%s -> %s', (sentence, expected) => {
    expect(isLabelSentence(sentence)).toBe(expected);
  });
});

describe('ingest stores the structured text', () => {
  it('a federal block comes out of the normalizer with its headings on their own lines', () => {
    const result = normalizeJobWithReason(
      {
        title: 'Nurse Practitioner',
        employer: 'Veterans Health Administration',
        location: 'Boston, MA',
        description: FEDERAL_BLOCK,
        applyLink: 'https://www.usajobs.gov/job/123456789',
        externalId: 'usajobs-123456789',
      },
      'usajobs',
    );
    expect(result.job).not.toBeNull();
    const lines = result.job!.description.split('\n');
    expect(lines).toContain('Licensure and Certification:');
    expect(wordsOf(result.job!.description)).toEqual(wordsOf(FEDERAL_BLOCK));
  });
});
