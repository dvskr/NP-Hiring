/**
 * Review fix (public apply-flow copy and FAQPage structured data): the /faq
 * answer to "How do I apply to a job?" said a click on 'Apply Now' sends the
 * visitor to the employer's application page. Under the owner's 2026-09
 * decision applying requires an account: every signed-out Apply click opens
 * the sign-up or log-in gate, and Easy Apply jobs never leave the job page.
 * The answer is also emitted in the page's FAQPage JSON-LD, so the rendered
 * structured data is checked, not only the source.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FAQPage from '@/app/faq/page';
import { brand } from '@/config/brand';

interface FaqQuestion {
  '@type': string;
  name: string;
  acceptedAnswer: { '@type': string; text: string };
}

function faqPageEntities(html: string): FaqQuestion[] {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, json] of scripts) {
    const data = JSON.parse(json) as { '@type'?: string; mainEntity?: FaqQuestion[] };
    if (data['@type'] === 'FAQPage') return data.mainEntity ?? [];
  }
  throw new Error('no FAQPage JSON-LD on /faq');
}

describe('/faq: how to apply', () => {
  const html = renderToStaticMarkup(React.createElement(FAQPage));
  const entities = faqPageEntities(html);
  const apply = entities.find((q) => q.name === 'How do I apply to a job?');

  it('the FAQPage JSON-LD carries the apply question', () => {
    expect(apply).toBeDefined();
  });

  it('says applying takes an account and that the visitor comes back to the job', () => {
    const text = apply!.acceptedAnswer.text;
    expect(text).toMatch(/account/i);
    expect(text).toContain(`free ${brand.name} account`);
    expect(text).toMatch(/create one or sign in/i);
    expect(text).toMatch(/back to the job/i);
  });

  it('no longer claims every click goes straight to the employer', () => {
    const text = apply!.acceptedAnswer.text;
    expect(text).not.toContain('directed to the employer');
    expect(text).not.toContain("Click 'Apply Now' on any job listing");
  });

  it('names both routes: Easy Apply on the job page, and the employer application otherwise', () => {
    const text = apply!.acceptedAnswer.text;
    expect(text).toContain('Easy Apply');
    expect(text).toMatch(/employer's application/);
  });

  it('follows house style: no em dash, en dash or spaced hyphen', () => {
    const text = apply!.acceptedAnswer.text;
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/\s-\s/);
    expect(text).not.toContain('${');
  });
});
