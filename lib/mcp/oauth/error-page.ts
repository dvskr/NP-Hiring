import { brand } from '@/config/brand';
import { escapeHtml } from '@/lib/sanitize';

/**
 * A small self-contained page for authorization errors that must not be
 * redirected to the client (unknown client, unregistered redirect URI).
 * Rendered without the site layout, the same way middleware's 410 page is,
 * because a route handler cannot reach the React tree.
 */
export function oauthErrorPage(status: number, message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Connection problem | ${escapeHtml(brand.name)}</title>
<style>
  :root { color-scheme: light dark; --bg: #F5F0EB; --card: #FFFFFF; --text: #2D3748; --muted: #4A5568; --accent: #0D9488; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --card: #292524; --text: #F5F0EB; --muted: #D6D3D1; --accent: #2DD4BF; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
    font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 440px; background: var(--card); border-radius: 20px; padding: 32px 28px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 20px; color: var(--muted); }
  a { color: var(--accent); font-weight: 600; text-decoration: none; }
  a:hover, a:focus-visible { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <h1>We could not start this connection</h1>
  <p>${escapeHtml(message)}</p>
  <a href="/ai-apps">How connecting to ChatGPT and Claude works</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
