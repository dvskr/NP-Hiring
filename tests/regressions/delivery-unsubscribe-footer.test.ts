/**
 * F17 regression — marketing emails must carry a real, per-recipient in-body
 * unsubscribe link (CAN-SPAM). unsubscribeFooterV2 previously discarded its
 * token parameter and rendered only a tokenless "Manage preferences" link;
 * the only working opt-out was the hidden List-Unsubscribe header.
 *
 * Locks in:
 *   1. A real token renders BASE_URL/unsubscribe?token=... plus a tokened
 *      manage-preferences link.
 *   2. Missing/'sample' tokens fall back to the generic manage page — never
 *      a dead tokenless /unsubscribe?token= link.
 *   3. lib/broadcast-sender.ts threads getOrCreateUnsubToken into
 *      buildBroadcastHtml so admin broadcasts get working footers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { unsubscribeFooterV2 } from '@/lib/email-templates-v2';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('unsubscribeFooterV2 with a real token', () => {
  const html = unsubscribeFooterV2('tok-abc-123');

  it('renders a one-click unsubscribe link with the token', () => {
    expect(html).toContain('/unsubscribe?token=tok-abc-123');
    expect(html).toMatch(/>\s*Unsubscribe\s*<\/a>/);
  });

  it('renders the manage-preferences link with the token appended', () => {
    expect(html).toContain('/email-preferences?token=tok-abc-123');
    expect(html).toMatch(/>\s*Manage preferences\s*<\/a>/);
  });

  it('URI-encodes the token', () => {
    const encoded = unsubscribeFooterV2('a b&c');
    expect(encoded).toContain('token=a%20b%26c');
  });
});

describe("unsubscribeFooterV2 with a missing/'sample' token", () => {
  for (const bad of ['sample', '']) {
    it(`falls back to the generic manage page for ${JSON.stringify(bad)} instead of a dead link`, () => {
      const html = unsubscribeFooterV2(bad);
      expect(html).not.toContain('token=sample');
      expect(html).not.toContain('/unsubscribe?token=');
      expect(html).toContain('/job-alerts/manage');
    });
  }
});

describe('broadcast sender threads real tokens into the footer', () => {
  const src = read('lib/broadcast-sender.ts');

  it('mints a per-recipient token via getOrCreateUnsubToken', () => {
    expect(src).toMatch(/getOrCreateUnsubToken\(recipient\.email\)/);
  });

  it('passes the token to buildBroadcastHtml (third arg)', () => {
    expect(src).toMatch(/buildBroadcastHtml\(personalizedBody,\s*personalizedSubject,\s*unsubToken\)/);
  });

  it('mints the token only after the suppression gate', () => {
    expect(src.indexOf('isEmailSuppressed(recipient.email)')).toBeLessThan(
      src.indexOf('getOrCreateUnsubToken(recipient.email)'),
    );
  });
});
