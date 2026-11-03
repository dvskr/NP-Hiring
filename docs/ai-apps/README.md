# NP Hiring app for Claude and ChatGPT

A remote MCP server with interactive widgets (MCP Apps) that lets nurse practitioner candidates search NP Hiring
jobs and apply from Claude and ChatGPT, plus the OAuth 2.1 server that signs them in. Built 2026-10-28.
Submission steps and listing copy: [submission.md](submission.md). Public page: https://nphiring.com/ai-apps.

## Endpoints

| URL | What | Code |
|---|---|---|
| `/mcp` | MCP endpoint for Claude (and any standard client) | `app/mcp/route.ts` |
| `/mcp/chatgpt` | MCP endpoint for ChatGPT | `app/mcp/chatgpt/route.ts` |
| `/.well-known/oauth-protected-resource/mcp[/chatgpt]` | RFC 9728 metadata per endpoint (root = `/mcp`) | `app/.well-known/oauth-protected-resource/**` |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata (issuer = the site origin) | `app/.well-known/oauth-authorization-server/route.ts` |
| `/oauth/authorize` | Consent page (Supabase session, candidate accounts only) | `app/oauth/authorize/**` |
| `/oauth/token`, `/oauth/register`, `/oauth/revoke` | Token (code + PKCE, rotating refresh), DCR, RFC 7009 | `app/oauth/**` |
| `/api/oauth/grants` | Connected apps list and revoke (Settings, Account) | `app/api/oauth/grants/route.ts` |
| `/.well-known/openai-apps-challenge` | OpenAI domain verification token | `app/.well-known/openai-apps-challenge/route.ts` |

**Why two MCP endpoints:** Claude refuses to render a widget whose `_meta.ui.domain` is not its own
`<hash>.claudemcpcontent.com` form, and ChatGPT requires the app's own origin there before a UI plugin can be
submitted. Claude also starts sign-in only on an HTTP 401, while ChatGPT links accounts from a tool error result
carrying `_meta["mcp/www_authenticate"]`. One codebase serves both (`lib/mcp/config.ts`); each endpoint is its own
OAuth resource and a token for one is refused by the other.

## Code map

| Path | Role |
|---|---|
| `lib/mcp/config.ts` | Base URL, host profiles, scopes |
| `lib/mcp/contracts.ts` | Tool inputs, outputs and widget view shapes (zod) |
| `lib/mcp/tool-names.ts` | Names, labels and limits the widget may import |
| `lib/mcp/server.ts` | The 12 tools, their annotations and the widget resource |
| `lib/mcp/handler.ts` | HTTP: CORS, auth, rate limits, body cap, Claude's sign-in gate, the SDK |
| `lib/mcp/auth.ts` | Token checks, scopes per tool, challenges |
| `lib/mcp/jobs.ts`, `lib/mcp/candidate.ts` | Data, on the site's own rules (filters, visibility, ownership) |
| `lib/mcp/sandbox.ts` | Review sandbox rules |
| `lib/applications/submit-direct-application.ts` | The one Easy Apply routine, shared with `/api/applications/apply-direct` |
| `lib/oauth/**` | The authorization server |
| `lib/mcp/widgets/src/**` | The widget (Preact); `npm run build:mcp-widgets` writes `lib/mcp/widgets/generated/widget-html.ts` |
| `scripts/mcp-review-sandbox.ts` | Creates the reviewer sandbox jobs (dry run by default) |
| `scripts/mcp-widgets/**` | Local widget preview harness and screenshots |

Stack: `@modelcontextprotocol/server` 2.x (`createMcpHandler`, stateless; serves 2026-07-28 and the 2025-era
protocol), `@modelcontextprotocol/ext-apps` 2.x, zod 4, jose.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `MCP_OAUTH_SIGNING_SECRET` | yes, for sign-in | 32+ characters. Signs access tokens and consent CSRF tokens. Rotating it signs every connected app out. |
| `MCP_REVIEWER_USER_IDS` | for review | Comma-separated Supabase user ids that may see sandbox jobs |
| `OPENAI_APPS_CHALLENGE_TOKEN` | for OpenAI | Served as plain text for domain verification |
| `MCP_BASE_URL` | no | Overrides the origin (local runs, previews). Production uses `brand.baseUrl`. |
| `MCP_OAUTH_CIMD_HOSTS`, `MCP_OAUTH_REDIRECT_HOSTS` | no | Extra allowed client metadata hosts and redirect hosts |

## Rules the code keeps (do not loosen without re-reading the directory policies)

- Every tool has a title and all four annotations; reads are `readOnlyHint`, submit and withdraw are
  `destructiveHint`, submit is `openWorldHint` (it reaches an employer).
- No NPI, DEA, SSN, license numbers or EEO fields in any input or output; no employer-private fields.
- No paid or employer-first ranking: the connector's relevance order is quality then recency.
- An employer's apply link only in signed-in results (as on the site).
- A job the site hides (unpublished, expired, dead link, non-NP) is hidden here too.
- Tool arguments are never logged; the server never receives the conversation.
- Widget: host fonts and colors; brand only on the primary button, the Easy Apply badge and the clay chips.

## Testing

Everything is mocked: the only database is production. `npx vitest run tests/mcp tests/oauth` plus the apply-route
regressions. Widget screenshots: `node scripts/mcp-widgets/screenshots.mjs <outDir>`.

Manual end to end after a deploy: add `https://nphiring.com/mcp` as a custom connector in Claude (and
`/mcp/chatgpt` in ChatGPT), then run the prompts in [submission.md](submission.md) section 4.

## Operations

- **A candidate wants an app disconnected:** Settings, Account, Connected apps, Remove access (or set
  `revoked_at` on their `oauth_grants` rows).
- **Signing everyone out:** rotate `MCP_OAUTH_SIGNING_SECRET` and redeploy.
- **Sandbox jobs:** re-run `scripts/mcp-review-sandbox.ts --apply` to restore them; they are unpublished by design.
- **Widget change:** edit `lib/mcp/widgets/src`, run `npm run build:mcp-widgets`, commit the generated file. The
  widget URI carries its hash, so hosts fetch the new copy; old URIs still resolve.
