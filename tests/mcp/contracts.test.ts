/**
 * lib/mcp/contracts.ts and lib/mcp/tool-names.ts: the tool input and output
 * contracts, checked as data.
 *
 * Pinned:
 *   - COVER_LETTER_MAX equals MAX_COVER_LETTER_LENGTH in the shared submit
 *     routine (tool-names.ts names this file as the pin);
 *   - submit_application takes consent only as the literal true;
 *   - the argument caps hold (page, limit, salary, answers, cover letter);
 *   - directory rules: no input accepts an NPI, DEA, SSN, birth date, license
 *     number or EEO field, and no output carries one, nor an employer-private
 *     field (notes, AI assessment, knockout settings, contact email, the raw
 *     apply link);
 *   - the consent line is the one the site's Easy Apply form shows.
 *
 * Pure data: nothing here touches a database or the network.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as contracts from '@/lib/mcp/contracts';
import {
    APPLICATION_STATUSES,
    APPLICATION_STATUS_LABELS,
    APPLY_CONSENT_TEXT,
    COVER_LETTER_MAX,
    SCREENING_ANSWER_MAX,
    TOOL,
} from '@/lib/mcp/tool-names';
import { MAX_COVER_LETTER_LENGTH } from '@/lib/applications/submit-direct-application';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { dashFindings } from './fixtures';

const INPUT_SCHEMAS: Record<string, z.ZodType> = {
    searchJobsInput: contracts.searchJobsInput,
    getJobInput: contracts.getJobInput,
    practiceAuthorityInput: contracts.practiceAuthorityInput,
    startApplicationInput: contracts.startApplicationInput,
    submitApplicationInput: contracts.submitApplicationInput,
    jobOnlyInput: contracts.jobOnlyInput,
    listApplicationsInput: contracts.listApplicationsInput,
    withdrawApplicationInput: contracts.withdrawApplicationInput,
    listSavedJobsInput: contracts.listSavedJobsInput,
    emptyInput: contracts.emptyInput,
};

const OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
    jobListViewSchema: contracts.jobListViewSchema,
    jobDetailViewSchema: contracts.jobDetailViewSchema,
    applyViewSchema: contracts.applyViewSchema,
    applyResultViewSchema: contracts.applyResultViewSchema,
    applicationsViewSchema: contracts.applicationsViewSchema,
    practiceAuthorityOutput: contracts.practiceAuthorityOutput,
    profileStatusOutput: contracts.profileStatusOutput,
    trackApplicationOutput: contracts.trackApplicationOutput,
    withdrawApplicationOutput: contracts.withdrawApplicationOutput,
    savedJobOutput: contracts.savedJobOutput,
};

/** Every property name declared anywhere in a schema (nested objects and arrays included). */
function propertyNames(schema: z.ZodType): string[] {
    const names: string[] = [];
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (node === null || typeof node !== 'object') return;
        for (const [key, child] of Object.entries(node)) {
            if (key === 'properties' && child !== null && typeof child === 'object') names.push(...Object.keys(child));
            walk(child);
        }
    };
    walk(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
    return [...new Set(names)];
}

const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '');

/** Federal ids, identity and EEO fields: never asked for, never returned (design section 0). */
const FORBIDDEN_PERSONAL = /npi|^dea|deanumber|ssn|socialsecurity|birth|^dob$|licensenumber|licenseno|^race$|ethnicity|gender|veteran|disabilit/;
/** Employer-private fields (design section 0). */
const EMPLOYER_PRIVATE = new Set(['notes', 'aimatchscore', 'aimatchreasons', 'aimissingitems', 'isknockout', 'knockoutanswer', 'contactemail', 'applylink']);

describe('limits shared with the site', () => {
    it('COVER_LETTER_MAX equals the submit routine cap, so a draft is never cut on submit', () => {
        expect(COVER_LETTER_MAX).toBe(MAX_COVER_LETTER_LENGTH);
    });

    it("the consent line is the site Easy Apply form's own wording", () => {
        const form = fs.readFileSync(path.join(process.cwd(), 'components/InPlatformApplyForm.tsx'), 'utf8');
        expect(form.replace(/\s+/g, ' ')).toContain(APPLY_CONSENT_TEXT);
    });

    it('every application status has a label, and the labels follow the copy rule', () => {
        expect(Object.keys(APPLICATION_STATUS_LABELS)).toEqual([...APPLICATION_STATUSES]);
        expect(dashFindings(APPLICATION_STATUS_LABELS)).toEqual([]);
        expect(APPLICATION_STATUS_LABELS.rejected).toBe('Not Selected');
    });

    it('tool names are unique', () => {
        const names = Object.values(TOOL);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toHaveLength(12);
    });

    it('the specialty argument offers every NP specialty and APRN role of the site taxonomy', () => {
        expect([...contracts.SPECIALTY_SLUGS].sort()).toEqual([...CATEGORY_AXES.specialty, ...CATEGORY_AXES.aprn].sort());
    });
});

describe('submit_application input', () => {
    const base = { job_id: '3f2b8c1d-9a4e-4b7f-8c2d-1e5f6a7b8c9d' };

    it('takes consent only as the literal true', () => {
        expect(contracts.submitApplicationInput.safeParse({ ...base, consent: true }).success).toBe(true);
        for (const consent of [false, 'true', 1, 'yes', null, undefined]) {
            expect(contracts.submitApplicationInput.safeParse({ ...base, consent }).success, String(consent)).toBe(false);
        }
        expect(contracts.submitApplicationInput.safeParse(base).success).toBe(false);
    });

    it('caps the cover letter and the screening answers', () => {
        const ok = { ...base, consent: true };
        expect(contracts.submitApplicationInput.safeParse({ ...ok, cover_letter: 'x'.repeat(COVER_LETTER_MAX) }).success).toBe(true);
        expect(contracts.submitApplicationInput.safeParse({ ...ok, cover_letter: 'x'.repeat(COVER_LETTER_MAX + 1) }).success).toBe(false);
        const answer = (text: string) => ({ question_id: 'q1', answer: text });
        expect(contracts.submitApplicationInput.safeParse({ ...ok, screening_answers: [answer('x'.repeat(SCREENING_ANSWER_MAX))] }).success).toBe(true);
        expect(contracts.submitApplicationInput.safeParse({ ...ok, screening_answers: [answer('x'.repeat(SCREENING_ANSWER_MAX + 1))] }).success).toBe(false);
        expect(contracts.submitApplicationInput.safeParse({ ...ok, screening_answers: Array.from({ length: 51 }, () => answer('a')) }).success).toBe(false);
    });

    it('a job id is a short non-empty string', () => {
        expect(contracts.jobOnlyInput.safeParse({ job_id: '   ' }).success).toBe(false);
        expect(contracts.jobOnlyInput.safeParse({ job_id: 'x'.repeat(301) }).success).toBe(false);
    });
});

describe('search_jobs input caps', () => {
    it.each([
        [{ page: 20 }, true],
        [{ page: 21 }, false],
        [{ page: 0 }, false],
        [{ limit: 10 }, true],
        [{ limit: 11 }, false],
        [{ min_salary: 19_999 }, false],
        [{ min_salary: 20_000 }, true],
        [{ specialty: 'astrology' }, false],
        [{ setting: 'remote' }, false],
        [{ work_mode: ['remote', 'hybrid', 'onsite', 'remote'] }, false],
        [{ query: 'x'.repeat(201) }, false],
    ])('%j parses: %s', (args, ok) => {
        expect(contracts.searchJobsInput.safeParse(args).success).toBe(ok);
    });
});

describe('directory rules on the contracts', () => {
    it.each(Object.entries(INPUT_SCHEMAS))('%s asks for no NPI, DEA, SSN, birth date, license number or EEO field', (_name, schema) => {
        const offending = propertyNames(schema).filter((name) => FORBIDDEN_PERSONAL.test(normalize(name)));
        expect(offending).toEqual([]);
    });

    it.each(Object.entries(OUTPUT_SCHEMAS))('%s returns no federal id, EEO field or employer-private field', (_name, schema) => {
        const names = propertyNames(schema);
        expect(names.length).toBeGreaterThan(0);
        expect(names.filter((name) => FORBIDDEN_PERSONAL.test(normalize(name)))).toEqual([]);
        expect(names.filter((name) => EMPLOYER_PRIVATE.has(normalize(name)))).toEqual([]);
    });

    it('the property walk sees nested fields (a sanity check for the two tests above)', () => {
        expect(propertyNames(contracts.applyViewSchema)).toEqual(expect.arrayContaining(['employerApplyUrl', 'questions', 'resume', 'onFile', 'required']));
        expect(propertyNames(contracts.submitApplicationInput)).toEqual(expect.arrayContaining(['consent', 'screening_answers', 'question_id']));
    });
});
