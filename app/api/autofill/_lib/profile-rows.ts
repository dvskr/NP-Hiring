/**
 * How many profile rows of each section the autofill AI routes read into a
 * prompt.
 *
 * SECURITY (sibling of AUTOFILL-CLASSIFY-1): the routes loaded every
 * license, certification and education row. The profile routes cap each
 * field's length but not the number of rows, so a profile padded with
 * thousands of rows put megabytes into every generation, which still
 * counted as one. The limits sit far above any real profile: every license
 * type in every state and DC is 204 rows.
 * Test: tests/api/autofill-profile-context-bounds.test.ts
 */
export const PROFILE_PROMPT_ROWS = {
    licenses: 250,
    certificationRecords: 50,
    education: 20,
} as const;
