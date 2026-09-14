/**
 * P10 a11y-contrast regressions (reverify round 2).
 *
 * axe color-contrast still failed after the site-chrome token fix because
 * these three nodes used hard-coded hex literals that bypassed the corrected
 * tokens:
 *   /jobs header subtitle   #6B7F8A on #F5F0EB (3.68:1)  app/jobs/JobsPageClient.tsx
 *   /jobs "About This Board" #E86C2C on #FDFBF7 (3.07:1) app/jobs/page.tsx
 *   AssumptionsPanel hint   #94A3B8 on #FFFFFF (2.56:1)  components/tools/AssumptionsPanel.tsx
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const css = read('app/globals.css');
function token(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} is not defined as a hex in globals.css`);
  return m[1];
}

function resolveColor(value: string): string {
  const v = value.match(/^var\((--[\w-]+)\)$/);
  return v ? token(v[1]) : value;
}

/** Colour of the inline style on the <p> whose text starts with `text`. */
function colorBefore(src: string, text: string): string {
  const idx = src.indexOf(text);
  expect(idx, `"${text}" present`).toBeGreaterThan(-1);
  const head = src.slice(0, idx);
  const matches = [...head.matchAll(/color: '([^']+)'/g)];
  expect(matches.length).toBeGreaterThan(0);
  return resolveColor(matches[matches.length - 1][1]);
}

describe('P10 a11y-contrast: /jobs and tool hint text clears WCAG AA 4.5:1', () => {
  it('/jobs header subtitle on --bg-primary', () => {
    const src = read('app/jobs/JobsPageClient.tsx');
    const fg = colorBefore(src, 'Browse fresh {brand.niche.short} roles');
    expect(contrast(fg, token('--bg-primary'))).toBeGreaterThanOrEqual(4.5);
    expect(src).not.toMatch(/#6B7F8A/i);
  });

  it('/jobs "About This Board" eyebrow on #FDFBF7', () => {
    const src = read('app/jobs/page.tsx');
    const fg = colorBefore(src, 'About This Board');
    expect(contrast(fg, '#FDFBF7')).toBeGreaterThanOrEqual(4.5);
    expect(src).not.toMatch(/#E86C2C/i);
  });

  it('AssumptionsPanel "Model last reviewed" hint on white', () => {
    const src = read('components/tools/AssumptionsPanel.tsx');
    const fg = colorBefore(src, 'Model last reviewed');
    expect(contrast(fg, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(src).not.toMatch(/#94A3B8/i);
  });

  it('/jobs browse error text is not the 3.76:1 #EF4444', () => {
    const src = read('app/jobs/JobsPageClient.tsx');
    expect(src).not.toMatch(/color: '#EF4444', fontSize/);
  });
});
