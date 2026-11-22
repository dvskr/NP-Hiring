/**
 * Supabase auth email templates: source locks.
 *
 * NP Hiring's Supabase project sent its auth mail with five line, unbranded
 * bodies and generic subjects, through Supabase's built in mail service.
 * docs/supabase-email-templates holds the branded bodies to paste instead,
 * rendered from the job board base's shared templates (see its README).
 *
 * An employer on Outlook once reported a password reset email with no button:
 * "Says click below, but there is nothing there." Outlook on Windows renders
 * through Word, which ignores CSS backgrounds on <a>, so a link styled as a
 * button keeps its padding and its white text but loses its fill. Each
 * template defends three times:
 *   1. bgcolor ATTRIBUTE on the wrapping <td> (Word honours attributes).
 *   2. A VML roundrect inside an mso conditional (Outlook's only rounded fill).
 *   3. The raw {{ .ConfirmationURL }} printed as visible copyable text.
 *
 * This file fails if any of those is edited away, if the brand shell drifts
 * apart between templates, or if a template names a brand other than this
 * site's own.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { brand } from '@/config/brand';

const TEMPLATE_DIR = path.resolve(__dirname, '../../docs/supabase-email-templates');

const read = (file: string): string => fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');

/** The button and link colour: the pink-700 of the app's own mail, 6.0:1 under white text. */
const ACCENT = '#BE185D';

/** Templates that carry a Supabase action link, so a button, so the bug. */
const LINK_TEMPLATES = [
  'confirm-signup.html',
  'magic-link.html',
  'invite-user.html',
  'change-email-address.html',
  'reset-password.html',
] as const;

/** Reauthentication ships a {{ .Token }} code, no link and no button. */
const CODE_TEMPLATE = 'reauthentication.html';

const ALL_TEMPLATES = [...LINK_TEMPLATES, CODE_TEMPLATE] as const;

/** The dashboard template and subject heading of each file, as the README must list them. */
const SUBJECTS: ReadonlyArray<readonly [string, string, string]> = [
  ['confirm-signup.html', 'Confirm signup', `Confirm your ${brand.name} account`],
  ['invite-user.html', 'Invite user', `You have been invited to ${brand.name}`],
  ['magic-link.html', 'Magic Link', `Your ${brand.name} sign in link`],
  ['change-email-address.html', 'Change Email Address', `Confirm your new ${brand.name} email address`],
  ['reset-password.html', 'Reset Password', `Reset your ${brand.name} password`],
  ['reauthentication.html', 'Reauthentication', `Your ${brand.name} confirmation code`],
];

const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * Drops the leading `<!-- ... -->` documentation block so assertions about what
 * a template renders are not satisfied (or defeated) by prose explaining it.
 */
const body = (src: string): string => src.replace(/^\s*<!--[\s\S]*?-->\s*/, '');

describe('every auth template exists, shares the brand shell and names this site', () => {
  it.each(ALL_TEMPLATES)('%s is present', (file) => {
    expect(fs.existsSync(path.join(TEMPLATE_DIR, file))).toBe(true);
  });

  it.each(ALL_TEMPLATES)('%s uses the shared palette', (file) => {
    const src = read(file);
    // Page ground, header band and footer: each set twice, the bgcolor
    // attribute for Word and CSS for everyone else.
    expect(src).toContain('background-color:#F5F0EB');
    expect(src).toMatch(/bgcolor="#F6D5C3"[^>]*background-color:#F6D5C3/);
    expect(src).toMatch(/bgcolor="#1F2937"[^>]*background-color:#1F2937/);
    expect(src).toContain('max-width:520px');
  });

  it.each(ALL_TEMPLATES)('%s prints this site\'s name, address and support contact', (file) => {
    const src = body(read(file));
    expect(src).toContain(`>${brand.name}</div>`);
    expect(src).toContain(`mailto:${brand.email.support}`);
    expect(src).toContain(`href="${brand.baseUrl}"`);
  });

  it.each(ALL_TEMPLATES)('%s names no other brand', (file) => {
    // Any "<Name> Hiring" in the file is this site's own name: a body pasted
    // from another site's set fails here.
    const names = new Set(read(file).match(/\b[A-Z][A-Za-z]* Hiring\b/g) ?? []);
    expect([...names]).toEqual([brand.name]);
  });

  it.each(ALL_TEMPLATES)('%s uses no em dash or en dash', (file) => {
    // The whole file is checked, comments included: a dash pasted into the
    // dashboard body is a dash the recipient can end up reading.
    expect(read(file)).not.toMatch(/[–—]/);
  });

  it.each(ALL_TEMPLATES)('%s starts with no byte order mark', (file) => {
    // A pasted BOM reaches the recipient as a stray character before the body.
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, file));
    expect(raw[0]).not.toBe(0xef);
  });
});

describe('the invisible-button defences are intact', () => {
  it.each(LINK_TEMPLATES)('%s fills the button via the bgcolor attribute', (file) => {
    const src = read(file);
    // The attribute is the defence. The inline style alone is exactly the bug.
    expect(src).toMatch(new RegExp(`<td[^>]*\\sbgcolor="${ACCENT}"`));
    expect(src).toContain(`background-color:${ACCENT}`);
  });

  it.each(LINK_TEMPLATES)('%s carries the mso VML roundrect fallback', (file) => {
    const src = read(file);
    expect(src).toContain('<!--[if mso]>');
    expect(src).toContain('v:roundrect');
    expect(src).toContain(`fillcolor="${ACCENT}"`);
    expect(src).toContain('<w:anchorlock/>');
    // The real button must be hidden from Outlook, or it renders twice.
    expect(src).toContain('<!--[if !mso]><!-- -->');
    expect(src).toContain('<!--<![endif]-->');
  });

  it.each(LINK_TEMPLATES)('%s prints the raw URL as visible copyable text', (file) => {
    const src = read(file);
    expect(src).toMatch(/copy and paste this link into your browser/);
    // href AND link text, so the URL is readable even with images and styles
    // stripped, and long URLs wrap instead of overflowing the card.
    expect(src).toContain(`<a href="{{ .ConfirmationURL }}" style="color:${ACCENT};">{{ .ConfirmationURL }}</a>`);
    expect(src).toContain('word-break:break-all');
  });

  it.each(LINK_TEMPLATES)('%s repeats {{ .ConfirmationURL }} in all three places', (file) => {
    // Header comments are documentation, not output: count what renders.
    const src = body(read(file));
    // VML href, button anchor href, fallback href, fallback text = 4.
    expect(countOccurrences(src, '{{ .ConfirmationURL }}')).toBe(4);
    // Ordering proves the placeholder is in the VML block, not just repeated
    // inside the ordinary button.
    const msoIdx = src.indexOf('<!--[if mso]>');
    const vmlHrefIdx = src.indexOf('href="{{ .ConfirmationURL }}"');
    expect(msoIdx).toBeGreaterThan(-1);
    expect(vmlHrefIdx).toBeGreaterThan(msoIdx);
    expect(vmlHrefIdx).toBeLessThan(src.indexOf('<!--[if !mso]><!-- -->'));
  });

  it.each(LINK_TEMPLATES)('%s never styles a bare <a> as the only button', (file) => {
    const src = read(file);
    // Every button anchor sits inside a td that was painted by bgcolor above.
    expect(countOccurrences(src, 'display:inline-block;padding:14px 28px')).toBe(1);
    const tdIdx = src.indexOf(`bgcolor="${ACCENT}"`);
    expect(tdIdx).toBeGreaterThan(-1);
    expect(tdIdx).toBeLessThan(src.indexOf('display:inline-block;padding:14px 28px'));
  });
});

describe('reauthentication is a code, not a link', () => {
  const src = read(CODE_TEMPLATE);
  // The header comment explains why this template has no button, so it names
  // ConfirmationURL. Assert on what actually renders.
  const rendered = body(src);

  it('renders the Token placeholder exactly once', () => {
    expect(countOccurrences(rendered, '{{ .Token }}')).toBe(1);
  });

  it('never claims a ConfirmationURL Supabase does not send', () => {
    // Supabase runs the whole file through its template engine before
    // sending, so a braced placeholder in a comment is evaluated too.
    expect(src).not.toContain('{{ .ConfirmationURL }}');
    expect(rendered).not.toContain('v:roundrect');
    expect(rendered).not.toContain(`bgcolor="${ACCENT}"`);
  });

  it('still paints its panel with the bgcolor attribute', () => {
    expect(rendered).toMatch(/<td[^>]*\sbgcolor="#FEF6E7"/);
  });

  it('keeps the explanation of why it differs, so nobody "fixes" it', () => {
    expect(src).toMatch(/DELIBERATELY DIFFERENT/);
  });
});

describe('copy stays honest about expiry', () => {
  it.each(['confirm-signup.html', 'magic-link.html', 'invite-user.html', 'change-email-address.html', CODE_TEMPLATE])(
    '%s states no expiry duration',
    (file) => {
      // Link lifetime is a project setting (Email OTP Expiration), not a fixed
      // Supabase constant, so these templates say nothing about it.
      expect(read(file)).not.toMatch(/expires? in \d/i);
      expect(read(file)).not.toMatch(/valid for \d/i);
    },
  );
});

describe('README documents the mapping and the rules the templates depend on', () => {
  const readme = read('README.md');

  it.each(SUBJECTS)('maps %s to the %s template with its subject heading', (file, template, subject) => {
    expect(readme).toContain(`| \`${file}\` | ${template} | ${subject} |`);
  });

  it('states the three-place ConfirmationURL rule and the do-not-remove rule', () => {
    expect(readme).toContain('`{{ .ConfirmationURL }}` appears in all three places');
    expect(readme).toContain('The visible URL fallback is never removed');
  });

  it('says Supabase must send through Resend', () => {
    expect(readme).toContain('smtp.resend.com');
    expect(readme).toContain(`noreply@${brand.domain}`);
  });
});
