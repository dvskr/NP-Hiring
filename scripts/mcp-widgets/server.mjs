/**
 * Local preview server for the NP Hiring widget (not part of the app).
 *
 *   node scripts/mcp-widgets/server.mjs [port]
 *
 * Serves the host page (host.html + host.mjs bundled with esbuild) and the
 * widget document built in memory by scripts/build-mcp-widgets.mjs. Open the
 * printed URL and pick a scenario, theme, width and host variable set.
 */
import { createServer } from 'node:http';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildWidgetHtml } from '../build-mcp-widgets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

async function bundleHost() {
    const result = await esbuild.build({
        absWorkingDir: ROOT,
        entryPoints: [path.join(HERE, 'host.mjs')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2020',
        minify: false,
        legalComments: 'none',
        logLevel: 'silent',
    });
    return result.outputFiles[0].text;
}

/** Builds both bundles, then listens on 127.0.0.1. */
export async function startPreviewServer({ port = 0 } = {}) {
    const [{ html: widgetHtml }, hostJs] = await Promise.all([buildWidgetHtml(), bundleHost()]);
    const hostHtml = readFileSync(path.join(HERE, 'host.html'), 'utf8');
    const routes = {
        '/': ['text/html; charset=utf-8', hostHtml],
        '/host.js': ['text/javascript; charset=utf-8', hostJs],
        '/widget.html': ['text/html; charset=utf-8', widgetHtml],
    };
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const route = routes[pathname];
        if (!route) {
            response.writeHead(404, { 'Content-Type': 'text/plain' });
            response.end('Not found');
            return;
        }
        response.writeHead(200, { 'Content-Type': route[0], 'Cache-Control': 'no-store' });
        response.end(route[1]);
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
    return {
        url,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

function isRunDirectly() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isRunDirectly()) {
    const port = Number(process.argv[2] ?? 4410);
    const { url } = await startPreviewServer({ port });
    process.stdout.write(`Widget preview at ${url}/?scenario=list\n`);
}
