/**
 * Regressions for the onboarding/funnel-seams backlog (post-payment page):
 *
 *   B85 — /success must NOT wipe the localStorage job draft before payment
 *         verification succeeds. The draft is the employer's only copy of
 *         the form; clearing it up-front meant an unpaid/failed session
 *         forced a full re-type.
 *   B81 — the paid success path must clear jobScreeningQuestions together
 *         with jobFormData, otherwise stale questions leak into the next
 *         job post.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, 'app/success/page.tsx'), 'utf8');

describe('B85/B81 — /success clears the draft only after the job is confirmed in', () => {
  it('defines a single clearJobDraft helper removing BOTH draft keys', () => {
    expect(src).toMatch(/const clearJobDraft = \(\) => \{/);
    expect(src).toContain("localStorage.removeItem('jobFormData')");
    expect(src).toContain("localStorage.removeItem('jobScreeningQuestions')");
    // Exactly one removal site per key — everything else goes through the helper.
    expect(src.match(/localStorage\.removeItem\('jobFormData'\)/g)).toHaveLength(1);
    expect(src.match(/localStorage\.removeItem\('jobScreeningQuestions'\)/g)).toHaveLength(1);
  });

  it('does not clear before verification: the helper is invoked only on free-mode, paid-processing, and verified-paid paths', () => {
    const calls = [...src.matchAll(/clearJobDraft\(\);/g)].map((m) => m.index ?? -1);
    expect(calls).toHaveLength(3);

    // Free mode: cleared inside the isFreeMode branch (job already posted upstream).
    const freeBranch = src.indexOf('if (isFreeMode) {');
    expect(freeBranch).toBeGreaterThan(-1);
    expect(calls[0]).toBeGreaterThan(freeBranch);

    // The 402 (unpaid — final state) branch must NOT clear the draft.
    const unpaidBranch = src.indexOf('if (res.status === 402)');
    const processingBranch = src.indexOf('if (res.status === 202 || data.processing)');
    expect(unpaidBranch).toBeGreaterThan(-1);
    expect(processingBranch).toBeGreaterThan(unpaidBranch);
    expect(calls.some((i) => i > unpaidBranch && i < processingBranch)).toBe(false);

    // Paid-but-processing clears (Stripe says paid), verified-paid clears.
    expect(calls.some((i) => i > processingBranch)).toBe(true);
  });

  it('the old unconditional wipe at effect start is gone', () => {
    // Previously the first statement of the effect removed jobFormData
    // before any verification ran. The helper definition must now precede
    // any invocation, and no removal may appear before the isFreeMode gate.
    const helperDef = src.indexOf('const clearJobDraft');
    const freeGate = src.indexOf('if (isFreeMode) {');
    const firstRemoval = src.indexOf("localStorage.removeItem('jobFormData')");
    expect(helperDef).toBeGreaterThan(-1);
    // The only literal removal lives inside the helper definition.
    expect(firstRemoval).toBeGreaterThan(helperDef);
    expect(firstRemoval).toBeLessThan(freeGate);
  });
});
