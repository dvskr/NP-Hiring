/**
 * The Claude directory's compliance step asks whoever submits the connector
 * to confirm that "tool descriptions contain no instructions about model
 * behavior, other tools, or external instruction sources, and no hidden or
 * encoded text". Its review criteria put it as: describe what the tool does,
 * and don't tell Claude how to behave.
 *
 * So a description, and every input's description, says what the tool does,
 * what it takes and returns, and when it fits. How the assistant should reply
 * (ask before deleting, use the person's answers as given, say a figure is
 * advertised pay) lives in the endpoint's instructions or in the tool's own
 * result. PMHNP Hiring moved sixteen such sentences out on 2026-11-17, its
 * employer connector had the same pass on 2026-11-23, and NP Hiring's
 * connector, built on the same design, is held to it from the start.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';

/** Every description the directory reads, with where it came from. */
function descriptions(): { where: string; text: string }[] {
  return CANDIDATE_ENDPOINT.tools.flatMap((tool) => [
    { where: tool.name, text: tool.description },
    ...Object.entries(tool.input).flatMap(([key, schema]) => {
      const text = (schema as { description?: string }).description;
      return text ? [{ where: `${tool.name}.${key}`, text }] : [];
    }),
  ]);
}

const sentencesOf = (text: string): string[] => text.split(/(?<=[.;:])\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * A sentence that tells the model how to act. A tool's own action ("Search
 * open <role> jobs", "Send the person's application") opens with a verb too,
 * so only verbs that are about the conversation are listed at the start.
 */
const TELLS_THE_MODEL: readonly RegExp[] = [
  /\byour?\b/i,
  /^(?:ask|tell|say|mention|confirm|report|link|prefer|pass|use|never|do not|don't|only call|call this|call it|collect|gather|present)\b/i,
  /\b(?:tell|ask) the person\b/i,
  /\bsay (?:so|that|what)\b/i,
  /\bnever guess\b/i,
  /\bonly call\b/i,
  /\bcall [a-z]+_[a-z_]+/i,
];

describe('job seeker tool descriptions describe the tool', () => {
  it('have no sentence that tells the model how to act', () => {
    const found = descriptions().flatMap(({ where, text }) =>
      sentencesOf(text)
        .filter((sentence) => TELLS_THE_MODEL.some((pattern) => pattern.test(sentence)))
        .map((sentence) => `${where}: ${sentence}`),
    );
    expect(found).toEqual([]);
  });

  it('hold no hidden or encoded text: printable characters only', () => {
    for (const { where, text } of descriptions()) {
      expect(text, where).toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it('still say what each tool is for', () => {
    for (const tool of CANDIDATE_ENDPOINT.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(60);
    }
  });
});

describe('the rules that left the descriptions are in the instructions', () => {
  const rules = CANDIDATE_ENDPOINT.instructions;

  const RULES: Array<[string, RegExp]> = [
    ['screening answers are used as given', /use their answers exactly as given, never guessed or improved/],
    ['one job per confirmation', /One job per confirmation/],
    ['withdrawing and deleting wait for the person to say which one', /withdraw_application and delete_job_alert only after they confirm which one/],
    ['an alert is created only once its criteria are agreed', /create_job_alert only after confirming its criteria and how often it emails/],
    ['an article is linked', /link the page they name/],
    ['practice authority is confirmed with the board of nursing', /tell the person to confirm it with the state board of nursing/],
    ['a practice authority category is never read as a rule', /never infer a rule from the category/],
    ['amounts counted as zero are named', /say which amounts counted as zero/],
    ['an offer is the person\'s decision', /leave the decision to the person/],
    ['free material first', /Prefer the free articles, tools and pay data/],
    ['featured jobs are found with the filter', /search with employer_posted_only/],
    ['"Featured" means only that the employer posted the job here', /and means only that/],
    ['the site-wide pay figure is never called national', /never a national figure/],
    ['a long list is paged', /ask for the next page, or a larger page_size for jobs/],
  ];

  it.each(RULES)('%s', (_name, pattern) => {
    expect(rules).toMatch(pattern);
  });

  it('say nothing about the guides, which a host may not be offered', () => {
    expect(rules).not.toMatch(/guide/i);
  });

  it('describe what the tools offer without steering the model away from its own knowledge', () => {
    // OpenAI's guidelines (3.3, 3.4) bar metadata that redirects the
    // conversation or steers tool choice; its scan sent these instructions
    // to further review (2026-11-22). "Answer from our material instead of
    // memory" was the one sentence that read that way.
    expect(rules).not.toMatch(/instead of (?:memory|your own)/i);
  });
});
