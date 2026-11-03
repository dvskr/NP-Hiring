/**
 * The committed widget document must equal a fresh build of
 * lib/mcp/widgets/src (run `npm run build:mcp-widgets` after any change),
 * and it must stay a single self-contained page: one inline module script,
 * nothing loaded from another origin.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { WIDGET_HTML, WIDGET_VERSION } from '@/lib/mcp/widgets/generated/widget-html';
import { buildWidgetHtml, renderWidgetModule } from '../../../scripts/build-mcp-widgets.mjs';

// esbuild bundles the App SDK and zod: a few seconds on CI, longer on a busy laptop.
const BUILD_TIMEOUT_MS = 240_000;

/** The markup with the bodies of <script> and <style> removed, so only real attributes remain. */
function markupOnly(html: string): string {
    return html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2').replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
}

describe('generated widget document', () => {
    let fresh: { html: string; version: string };

    beforeAll(async () => {
        fresh = await buildWidgetHtml();
    }, BUILD_TIMEOUT_MS);

    it('matches a fresh build of lib/mcp/widgets/src (run npm run build:mcp-widgets)', () => {
        expect(fresh.html === WIDGET_HTML).toBe(true);
        expect(fresh.version).toBe(WIDGET_VERSION);
    });

    it('versions the document by the first 12 hex characters of its SHA-256', () => {
        expect(WIDGET_VERSION).toBe(createHash('sha256').update(WIDGET_HTML).digest('hex').slice(0, 12));
        expect(renderWidgetModule(fresh)).toContain(`export const WIDGET_VERSION = "${fresh.version}";`);
    });

    it('is one HTML5 document with a single inline module script', () => {
        expect(WIDGET_HTML.startsWith('<!doctype html><html lang="en">')).toBe(true);
        expect(WIDGET_HTML).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
        const markup = markupOnly(WIDGET_HTML);
        const scripts = [...markup.matchAll(/<script\b([^>]*)>/gi)];
        expect(scripts).toHaveLength(1);
        expect(scripts[0][1].trim()).toBe('type="module"');
        // Inside the script every "</script" is escaped, so the element closes exactly once.
        expect(WIDGET_HTML.match(/<\/script/gi)).toHaveLength(1);
        expect(markup.match(/<style\b/gi)).toHaveLength(1);
        expect(markup).not.toMatch(/<(link|iframe|object|embed|img|base)\b/i);
    });

    it('loads nothing from a URL', () => {
        const markup = markupOnly(WIDGET_HTML);
        const attributes = [...markup.matchAll(/\s(?:src|href|srcset|action|poster|data)\s*=\s*["']?([^"'\s>]*)/gi)];
        expect(attributes.map((match) => match[1])).toEqual([]);
        const css = WIDGET_HTML.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
        expect(css.length).toBeGreaterThan(0);
        expect(css).not.toMatch(/@import\b/i);
        expect(css).not.toMatch(/url\(/i);
    });
});
