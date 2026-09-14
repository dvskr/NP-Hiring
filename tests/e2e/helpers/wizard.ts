import { expect, type Page } from '@playwright/test';

/**
 * Driver for the 5-step /post-job wizard (app/post-job/page.tsx).
 *
 * Selectors are the wizard's own stable ids/names. Radios are visually
 * hidden (`display:none`) so we click their <label> wrappers.
 */

export const WIZARD = {
    next: 'button.wizard-next-btn',
    back: 'button.wizard-nav-btn:has-text("Back")',
    clear: 'button.wizard-nav-btn:has-text("Clear")',
    submitToPreview: 'button[type="submit"][form="job-post-form"]',
    quill: '.ql-editor',
    savedIndicator: '[role="status"]',
} as const;

export interface Step1 {
    title: string;
    companyName: string;
    companyWebsite?: string;
    contactEmail: string;
}

export async function fillStep1(page: Page, s: Step1): Promise<void> {
    await page.locator('#title').fill(s.title);
    await page.locator('#companyName').fill(s.companyName);
    if (s.companyWebsite !== undefined) await page.locator('#companyWebsite').fill(s.companyWebsite);
    await page.locator('#contactEmail').fill(s.contactEmail);
}

export async function clickRadioLabel(page: Page, name: string, value: string): Promise<void> {
    await page.locator('label', { has: page.locator(`input[name="${name}"][value="${value}"]`) }).click();
}

export async function pickExperience(page: Page, label: string): Promise<void> {
    await page.locator('label', { hasText: label }).first().click();
}

export async function next(page: Page): Promise<void> {
    await page.locator(WIZARD.next).click();
}

/** Step heading (h2) that identifies the active step. */
export function stepHeading(page: Page, title: RegExp) {
    return page.getByRole('heading', { level: 2, name: title });
}

/** Visible-text length the wizard's own counter uses. */
export async function descriptionLength(page: Page): Promise<number> {
    const text = await page.locator(WIZARD.quill).innerText();
    return text.replace(/\s+/g, ' ').trim().length;
}

export async function typeDescription(page: Page, text: string): Promise<void> {
    const editor = page.locator(WIZARD.quill);
    await editor.click();
    await editor.fill(text);
}

/** Wait until the autosave pill reports a successful server save. */
export async function waitForSaved(page: Page): Promise<void> {
    await expect(page.locator(WIZARD.savedIndicator)).toHaveText(/Saved (just now|\d+s ago)/, { timeout: 20_000 });
}

/** Long enough (>200 visible chars) and clearly test-only. */
export function sampleDescription(tag: string): string {
    return (
        `E2E lifecycle posting ${tag}. We are hiring a psychiatric mental health nurse practitioner ` +
        `for a telehealth practice serving adults across several states. Responsibilities include ` +
        `psychiatric evaluations, medication management, collaboration with therapists, and ` +
        `documentation in our EHR. Requirements: active PMHNP certification, at least two years of ` +
        `outpatient psychiatry experience, and a compact or multi-state license. Safe to delete.`
    );
}
