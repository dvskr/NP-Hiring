/**
 * P2 #24 (seo-ops) — email art must resolve.
 *
 * Every retention email pointed its images at a Supabase `email-assets`
 * bucket that was never created (every object 400s), and there was no local
 * fallback: `public/images/email/` did not exist, so the "fallback" branch
 * 404'd too. Result: broken image boxes in every V2 template — the logo in
 * every header, the three seeker onboarding steps, the three employer steps,
 * and every hero panel in the email preview surface.
 *
 * The fix ships the art with the deploy. `public/images/email/*.png` is
 * derived from artwork already in the repo — no new commissions:
 *
 *   logo-cropped.png          96x110   ← public/logo-cropped.png            (contain, alpha)
 *   logo.png                  200x200  ← public/logo.png                    (contain, alpha)
 *   step-build-profile.png    160x160  ← images/how-it-works/seeker-step1-v2.webp
 *   step-ai-alerts.png        160x160  ← images/how-it-works/seeker-step2-v2.webp
 *   step-connect.png          160x160  ← images/how-it-works/seeker-step3-v2.webp
 *   icon-emp-megaphone.png    160x160  ← images/how-it-works/step-employer-post.webp
 *   icon-emp-analytics.png    160x160  ← images/how-it-works/step-employer-track.webp
 *   icon-emp-handshake.png    160x160  ← images/how-it-works/step-employer-browse.webp
 *   hero-alert-subscription   1040x560 ← illustrations/clay-stat-alerts.png       (cover)
 *   hero-job-post             1040x560 ← images/how-it-works/step-employer-post.webp   (contain)
 *   hero-renewal              1040x560 ← images/how-it-works/step-employer-reach.webp  (contain)
 *   hero-salary-guide         1040x560 ← images/job-seekers/bento-salary.webp          (contain)
 *   hero-new-candidate        1040x560 ← images/how-it-works/step-employer-browse.webp (contain)
 *   hero-new-application      1040x560 ← illustrations/spot-applications.png     (cover)
 *   hero-app-confirm          1040x560 ← illustrations/spot-applied.png          (cover)
 *   hero-status-update        1040x560 ← illustrations/clay-stat-applied.png     (cover)
 *   hero-performance          1040x560 ← illustrations/clay-stat-views.png       (cover)
 *   hero-draft-saved          1040x560 ← illustrations/spot-saved.png            (cover)
 *
 * `contain` fills the letterbox with the artwork's own sampled corner colour
 * (materialise the extract before .stats() — see components/StateImage.tsx);
 * `cover` is used where the subject is centred with margin to spare.
 *
 * Pins:
 *  1. A rendered template's every <img src> is an ABSOLUTE URL (mail clients
 *     cannot resolve root-relative paths) on this board's own origin, and the
 *     file it points at exists in public/.
 *  2. Every email-asset filename referenced anywhere in the email code —
 *     including the foreign modules lib/email-service.ts and
 *     app/api/email-preview/v2-templates.ts — exists on disk.
 *  3. NO email module reads EMAIL_ASSETS_URL, and the var is gone from the env
 *     schema and .env.example, so a stale env pointing at the dead bucket
 *     cannot re-break the shipped art.
 *
 * Pin 3 originally covered only lib/email-templates-v2.ts, which is how the
 * first pass at this fix shipped half-landed: the header logo moved to the
 * local base, but lib/email-service.ts and the preview route still opened with
 * `process.env.EMAIL_ASSETS_URL || …`, and .env set that var — so `||` never
 * reached the fallback and the six step icons in the employer and seeker
 * welcome emails stayed broken boxes in every real send. The pin now covers
 * every module that builds an art base, and every preview template is
 * rendered so the assertion is about output, not just source text.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { brand } from '@/config/brand';
import {
  emailShellV2,
  headerBlockV2,
  amberHeaderV2,
  closeContentV2,
} from '@/lib/email-templates-v2';
import { v2Templates } from '@/app/api/email-preview/v2-templates';

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const EMAIL_ASSET_DIR = path.join(PUBLIC_DIR, 'images/email');
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '');

const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every `src="…"` in a rendered HTML string. */
function imgSources(html: string): string[] {
  return [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
}

/** Maps an absolute asset URL back to the file that must serve it. */
function publicFileFor(url: string): string {
  return path.join(PUBLIC_DIR, new URL(url).pathname);
}

const RENDERED = {
  'headerBlockV2 (every transactional + retention email)': emailShellV2(
    headerBlockV2('Heading', 'Subtitle') + closeContentV2(),
    '',
    'preheader',
  ),
  'amberHeaderV2 (expiry warnings)': emailShellV2(
    amberHeaderV2('Heading', 'Subtitle') + closeContentV2(),
    '',
    'preheader',
  ),
};

describe('P2 #24 — rendered email templates reference resolvable art', () => {
  for (const [label, html] of Object.entries(RENDERED)) {
    it(`${label}: every img src is absolute, on-origin, and exists on disk`, () => {
      const sources = imgSources(html);
      expect(sources.length, 'template rendered zero images').toBeGreaterThan(0);

      for (const url of sources) {
        expect(url.startsWith('http'), `mail clients cannot resolve relative src: ${url}`).toBe(true);
        expect(url.startsWith(`${BASE_URL}/`), `img src is off-origin: ${url}`).toBe(true);
        expect(url, 'img src points back at the dead storage bucket').not.toContain('supabase');
        expect(
          fs.existsSync(publicFileFor(url)),
          `img src has no file behind it: ${url}`,
        ).toBe(true);
      }
    });
  }

  it('the shipped logo art lives under /images/email like every other email asset', () => {
    const sources = Object.values(RENDERED).flatMap(imgSources);
    for (const url of sources) {
      expect(url.startsWith(`${BASE_URL}/images/email/`), `email art outside the asset folder: ${url}`).toBe(true);
    }
  });
});

describe('P2 #24 — the whole email asset contract ships', () => {
  /**
   * Bare `'<name>.png'` literals in the email modules ARE the asset contract:
   * lib/email-service.ts and the preview route interpolate them into
   * `${IMG}/${file}`, so a missing file is a broken image in a real send.
   */
  const EMAIL_SOURCE_FILES = [
    'lib/email-templates-v2.ts',
    'lib/email-service.ts',
    'app/api/email-preview/v2-templates.ts',
  ];

  const referenced = new Set<string>();
  for (const rel of EMAIL_SOURCE_FILES) {
    for (const m of src(rel).matchAll(/'([a-z0-9-]+\.png)'/g)) referenced.add(m[1]);
  }

  it('finds the referenced asset names (guards the scan itself)', () => {
    expect(referenced.size).toBeGreaterThanOrEqual(16);
    expect(referenced.has('step-build-profile.png')).toBe(true);
    expect(referenced.has('icon-emp-megaphone.png')).toBe(true);
  });

  it('every referenced email asset exists in public/images/email', () => {
    const missing = [...referenced].filter(
      (file) => !fs.existsSync(path.join(EMAIL_ASSET_DIR, file)),
    );
    expect(missing, `email assets referenced but not shipped: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships nothing but PNG in the email asset folder (mail clients: no webp/avif)', () => {
    const stray = fs.readdirSync(EMAIL_ASSET_DIR).filter((f) => !f.endsWith('.png'));
    expect(stray, `non-PNG email assets: ${stray.join(', ')}`).toEqual([]);
  });
});

describe('P2 #24 — every step icon actually resolves in a rendered template', () => {
  /**
   * The employer/seeker welcome emails are the templates whose step icons
   * stayed broken after the first fix. Rendering every preview template
   * exercises the same `${IMG}/${file}` interpolation a real send uses, so a
   * regressed art base fails here instead of in someone's inbox.
   */
  const RENDERED_PREVIEWS = Object.entries(v2Templates).map(
    ([key, entry]) => [key, entry.fn()] as const,
  );

  it('renders the templates that carry the step icons (guards the scan itself)', () => {
    const withSteps = RENDERED_PREVIEWS.filter(([, html]) =>
      /step-build-profile\.png|icon-emp-megaphone\.png/.test(html),
    ).map(([key]) => key);
    expect(withSteps.length, 'no preview template renders the onboarding steps').toBeGreaterThanOrEqual(2);
  });

  for (const [key, html] of RENDERED_PREVIEWS) {
    it(`preview '${key}': every img src is absolute, on-origin, and exists on disk`, () => {
      for (const url of imgSources(html)) {
        expect(url.startsWith(`${BASE_URL}/images/email/`), `bad email art base: ${url}`).toBe(true);
        expect(url, 'img src points back at the dead storage bucket').not.toContain('supabase');
        expect(fs.existsSync(publicFileFor(url)), `img src has no file behind it: ${url}`).toBe(true);
      }
    });
  }
});

describe('P2 #24 — the dead bucket cannot come back', () => {
  /** Every module that builds an email art base. */
  const ART_BASE_MODULES = [
    'lib/email-templates-v2.ts',
    'lib/email-service.ts',
    'app/api/email-preview/v2-templates.ts',
  ];

  for (const rel of ART_BASE_MODULES) {
    it(`${rel} does not read EMAIL_ASSETS_URL`, () => {
      // (Doc comments name the var to explain why it is ignored — only the env
      // READ is forbidden.)
      expect(src(rel)).not.toContain('process.env.EMAIL_ASSETS_URL');
    });

    it(`${rel} builds its asset base from BASE_URL + /images/email`, () => {
      expect(src(rel)).toContain('const IMG = `${BASE_URL}/images/email`');
    });
  }

  it('EMAIL_ASSETS_URL is gone from the env schema', () => {
    // A schema entry with a dead-bucket default is what made `||` resolve to
    // the bucket on every machine that copied .env.example.
    expect(src('lib/env.ts')).not.toMatch(/^\s*EMAIL_ASSETS_URL\s*:/m);
  });

  it('.env.example no longer tells operators to set EMAIL_ASSETS_URL', () => {
    expect(src('.env.example')).not.toMatch(/^\s*EMAIL_ASSETS_URL\s*=/m);
  });
});
