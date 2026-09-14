/**
 * P10 messaging regressions (UI side, source-level pins):
 *   - /messages bounced signed-out visitors to /login?redirect=, a param the
 *     login page ignores; it must use ?next=
 *   - the reply composer and the employer New Message dialog sent duplicate
 *     POSTs on a same-tick double submit (state-only guards)
 *   - the delete confirmation was a plain div; the options popup ignored
 *     Escape; Back from an open thread left /messages
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('/messages page', () => {
    const src = read('app/messages/page.tsx');

    it('sends signed-out visitors to /login with a return target the login page honours', () => {
        expect(src).toContain("router.push('/login?next=/messages')");
        expect(src).not.toMatch(/login\?redirect=/);
        const login = read('components/auth/LoginContent.tsx');
        expect(login).toMatch(/searchParams\.get\('next'\)/);
    });

    it('guards the reply send with a synchronous ref, set before the first await', () => {
        const handler = src.slice(src.indexOf('const handleSendReply = async'));
        const guard = handler.indexOf('sendingRef.current) return;');
        const set = handler.indexOf('sendingRef.current = true;');
        const firstAwait = handler.indexOf('await ');
        expect(guard).toBeGreaterThan(-1);
        expect(set).toBeGreaterThan(guard);
        expect(set).toBeLessThan(firstAwait);
        expect(handler).toMatch(/finally \{\s*sendingRef\.current = false;/);
    });

    it('renders the delete confirmation as a labelled, focus-trapped modal dialog with Escape', () => {
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen: deleteModal !== null,\s*onEscape: dismissDeleteModal,/);
        expect(src).toMatch(/ref=\{deleteDialogRef\}\s*role="dialog"\s*aria-modal="true"\s*aria-labelledby="delete-confirm-title"/);
        expect(src).toContain('id="delete-confirm-title"');
    });

    it('closes the conversation options popup on Escape and returns focus to its trigger', () => {
        expect(src).toMatch(/if \(e\.key !== 'Escape'\) return;[\s\S]{0,80}setConvMenuId\(null\);\s*focusConvMenuTrigger\(convMenuId\);/);
        expect(src).toContain('data-conv-menu-trigger={conv.id}');
    });

    it('keeps the open thread in the URL so Back closes it inside Messages', () => {
        expect(src).toMatch(/window\.history\.pushState\(null, '', url\)/);
        expect(src).toMatch(/addEventListener\('popstate', onPopState\)/);
        // Both in-app Back affordances go through the history-aware handler.
        expect(src.match(/onClick=\{leaveThread\}/g)?.length).toBe(2);
    });
});

describe('ComposeMessageModal', () => {
    const src = read('components/employer/ComposeMessageModal.tsx');

    it('blocks a second send while one is in flight, via a ref set before the fetch', () => {
        const handler = src.slice(src.indexOf('const handleSend = async'));
        const guard = handler.indexOf('inFlightRef.current) return;');
        const set = handler.indexOf('inFlightRef.current = true;');
        expect(guard).toBeGreaterThan(-1);
        expect(set).toBeGreaterThan(guard);
        expect(set).toBeLessThan(handler.indexOf('await '));
    });

    it('re-arms the guard only on failure, never after a success', () => {
        const handler = src.slice(src.indexOf('const handleSend = async'), src.indexOf('const canSend'));
        expect(handler.match(/inFlightRef\.current = false;/g)?.length).toBe(2);
        expect(src).toMatch(/const canSend = [^;]*status !== 'success'/);
    });
});
