/**
 * The installed app is named after this site.
 *
 * A phone names a site it installs ("Install app", "Add to Home Screen") from
 * public/site.webmanifest. The file was copied from the PMHNP board with its
 * name and short name left as "PMHNP Jobs", so NP Hiring installed as an app
 * called PMHNP Jobs (found 2026-11-22). The manifest now carries the brand's
 * own name, and this test keeps it there.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { brand } from '@/config/brand';

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/site.webmanifest'), 'utf8'),
) as { name?: string; short_name?: string };

describe('the web app manifest', () => {
  it('names the app after this site, in full and short', () => {
    expect(manifest.name).toBe(brand.name);
    expect(manifest.short_name).toBe(brand.name);
  });

  it('carries no other board\'s name', () => {
    expect(`${manifest.name} ${manifest.short_name}`).not.toMatch(/PMHNP/i);
  });
});
