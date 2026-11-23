import { startWidget } from './app';

/**
 * Bundle entry. scripts/mcp/build-widgets.mjs compiles this file and its
 * imports into lib/mcp/widgets/generated/bundle.ts, which the server inlines
 * into every widget document.
 */
const root = document.getElementById('pm-root');
if (root) startWidget(root);
