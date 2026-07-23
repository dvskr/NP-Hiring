/**
 * Regression guards for F14 — Messages inbox keyboard accessibility.
 *
 * The inbox was mouse-only: conversation rows were plain <div onClick> with no
 * role/tabIndex/key handler, per-message Edit/Delete buttons were opacity:0 and
 * only revealed by DOM-mutating mouseenter handlers, and several icon-only
 * controls had no accessible name. These tests read the real source file and
 * assert each fix is still in place.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'app/messages/page.tsx'),
  'utf8',
);

describe('F14 — conversation rows are keyboard-operable', () => {
  it('row carries role="button" and tabIndex={0}', () => {
    expect(SRC).toContain('role="button"');
    expect(SRC).toContain('tabIndex={0}');
    expect(SRC).toContain('className="conv-row"');
  });

  it('row opens the conversation on Enter and Space', () => {
    // The onKeyDown handler must gate on Enter/Space and call openConversation.
    expect(SRC).toMatch(
      /onKeyDown=\{[\s\S]{0,400}?(e\.key === 'Enter' \|\| e\.key === ' ')[\s\S]{0,200}?openConversation\(conv\.id\)/,
    );
  });

  it('keyboard focus on the row has a visible indicator', () => {
    expect(SRC).toMatch(/\.conv-row:focus-visible\s*\{[^}]*outline/);
  });
});

describe('F14 — per-message Edit/Delete revealed on focus, not just hover', () => {
  it('reveal is CSS-driven via hover, focus-within, and focus-visible', () => {
    expect(SRC).toMatch(/\.msg-row:hover \.msg-action-btn/);
    expect(SRC).toMatch(/\.msg-row:focus-within \.msg-action-btn/);
    expect(SRC).toMatch(/\.msg-action-btn:focus-visible/);
  });

  it('no DOM-mutating opacity handlers remain for msg-action-btn', () => {
    expect(SRC).not.toContain("querySelectorAll('.msg-action-btn')");
    // Inline opacity:0 on the buttons would beat the stylesheet reveal rules.
    expect(SRC).not.toMatch(/opacity: 0, transition: 'opacity 0\.15s'/);
  });

  it('the no-op .conv-menu-btn reveal handlers are cleaned up', () => {
    // Verifier: these targeted a class no element carries — pure dead code.
    expect(SRC).not.toContain("querySelector('.conv-menu-btn')");
  });
});

describe('F14 — icon-only controls have accessible names', () => {
  it('MoreVertical menu trigger is labeled "Conversation options"', () => {
    expect(SRC).toContain('aria-label="Conversation options"');
  });

  it('thread back button is labeled "Back to conversations"', () => {
    expect(SRC).toContain('aria-label="Back to conversations"');
  });

  it('send button is labeled "Send message"', () => {
    expect(SRC).toContain('aria-label="Send message"');
  });

  it('remove-attachment X is labeled "Remove attachment"', () => {
    expect(SRC).toContain('aria-label="Remove attachment"');
  });
});
