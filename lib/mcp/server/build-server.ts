import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
import { MCP_RESOURCES, protectedResourceMetadataUrl, type McpResourceId } from '@/lib/mcp/oauth/config';
import {
  RESOURCE_MIME_TYPE,
  WIDGETS,
  widgetHtml,
  widgetResourceMeta,
  widgetResourceUri,
} from '@/lib/mcp/widgets/resources';
import type { WidgetView } from '@/lib/mcp/widgets/src/contracts';
import { checkToolBudget } from './rate-limits';
import {
  SignInRequiredError,
  UserFacingError,
  type McpToolSpec,
  type ToolAuth,
  type ToolContext,
  type ToolOutcome,
} from './types';

/**
 * Turns a list of McpToolSpec into a configured McpServer for one request.
 *
 * Stateless: the route builds a server per HTTP request, so the caller's
 * verified identity is closed over here rather than threaded through the
 * SDK. Nothing about one request survives into the next.
 */

/**
 * The board's name as a server id: "Example Jobs Hub" is "example-jobs-hub".
 * Hosts show the title; the id only has to be stable and the board's own.
 */
const SERVER_SLUG = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job-board';

export interface EndpointDefinition {
  id: McpResourceId;
  title: string;
  description: string;
  instructions: string;
  tools: readonly McpToolSpec[];
}

/** ChatGPT's per-tool auth declaration (Apps SDK securitySchemes). */
export function securitySchemesFor(auth: ToolAuth, endpoint: McpResourceId): Record<string, unknown>[] {
  const oauth = { type: 'oauth2', scopes: [MCP_RESOURCES[endpoint].scope] };
  if (auth === 'required') return [oauth];
  return [{ type: 'noauth' }, oauth];
}

export function toolMeta(spec: McpToolSpec, endpoint: McpResourceId): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    securitySchemes: securitySchemesFor(spec.auth, endpoint),
    // Every tool may be called from a card as well as by the model: the
    // cards save jobs, submit applications and move applicants themselves,
    // and some of those tools have no card of their own. ChatGPT's legacy
    // flag says the same thing for hosts that still read it.
    ui: { visibility: ['model', 'app'] },
    'openai/widgetAccessible': true,
  };
  if (spec.invoking) meta['openai/toolInvocation/invoking'] = spec.invoking;
  if (spec.invoked) meta['openai/toolInvocation/invoked'] = spec.invoked;
  if (spec.widget) {
    const uri = widgetResourceUri(spec.widget);
    meta.ui = { resourceUri: uri, visibility: ['model', 'app'] };
    // Deprecated flat key, still read by hosts that predate the nested form.
    meta['ui/resourceUri'] = uri;
    // ChatGPT's compatibility alias. Same URI, so precedence cannot matter.
    meta['openai/outputTemplate'] = uri;
  }
  return meta;
}

/** The value of a WWW-Authenticate challenge for this endpoint (RFC 6750, RFC 9728). */
export function bearerChallenge(endpoint: McpResourceId, error?: string, description?: string): string {
  const parts = [
    `resource_metadata="${protectedResourceMetadataUrl(endpoint)}"`,
    `scope="${MCP_RESOURCES[endpoint].scope}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * ChatGPT starts its account-linking flow from a tool result that carries
 * mcp/www_authenticate with both error and error_description. Claude needs
 * an HTTP 401 instead, which the route sends before a tool ever runs, so
 * this result only reaches hosts that read the _meta form.
 */
function signInResult(endpoint: McpResourceId, message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${message} Sign in to ${brand.name} when prompted, then ask again.` }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [bearerChallenge(endpoint, 'insufficient_scope', `Sign in to ${brand.name} to continue`)],
    },
  };
}

function outcomeToResult(outcome: ToolOutcome): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: outcome.text }] };
  if (outcome.structured) result.structuredContent = outcome.structured as Record<string, unknown>;
  if (outcome.widgetMeta) result._meta = outcome.widgetMeta;
  if (outcome.isError) result.isError = true;
  return result;
}

async function runTool(
  spec: McpToolSpec,
  args: unknown,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const started = Date.now();
  if (spec.auth === 'required' && !ctx.access) {
    return signInResult(ctx.endpoint, `This needs your ${brand.name} account.`);
  }
  const budget = await checkToolBudget(spec.name, ctx);
  if (!budget.allowed) {
    return textResult(
      `That is a lot of requests in a short time. Try again in about ${budget.retryAfterSeconds} seconds.`,
      true,
    );
  }
  try {
    const outcome = await spec.run(args as never, ctx);
    logger.info('MCP tool call', {
      endpoint: ctx.endpoint,
      tool: spec.name,
      signedIn: !!ctx.access,
      client: ctx.access?.clientName,
      ms: Date.now() - started,
      isError: outcome.isError === true,
    });
    return outcomeToResult(outcome);
  } catch (error) {
    if (error instanceof SignInRequiredError) return signInResult(ctx.endpoint, error.message);
    if (error instanceof UserFacingError) return textResult(error.message, true);
    logger.error('MCP tool failed', error, { endpoint: ctx.endpoint, tool: spec.name });
    return textResult(`Something went wrong on ${brand.name}. Try again in a moment.`, true);
  }
}

export const SERVER_VERSION = '1.0.0';

/**
 * The tools this host is offered: everything, less what a host's rules
 * exclude. ChatGPT's directory allows no digital goods, so a tool marked
 * notOnChatGpt is withheld there; no job seeker tool is marked today.
 */
export function toolsForHost(definition: EndpointDefinition, host: ToolContext['host']): readonly McpToolSpec[] {
  return host === 'chatgpt' ? definition.tools.filter((t) => !t.notOnChatGpt) : definition.tools;
}

export function buildMcpServer(definition: EndpointDefinition, ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: definition.id === 'employer' ? `${SERVER_SLUG}-employers` : SERVER_SLUG,
      title: definition.title,
      version: SERVER_VERSION,
      description: definition.description,
      websiteUrl: ctx.baseUrl,
      icons: [{ src: `${ctx.baseUrl}/icon-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] }],
    },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: definition.instructions,
    },
  );

  const tools = toolsForHost(definition, ctx.host);
  for (const spec of tools) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        annotations: { title: spec.title, ...spec.annotations },
        _meta: toolMeta(spec, definition.id),
      },
      (args: unknown) => runTool(spec, args, ctx),
    );
  }

  const views = new Set<WidgetView>(
    tools.map((t) => t.widget).filter((v): v is WidgetView => !!v),
  );
  for (const view of views) {
    const uri = widgetResourceUri(view);
    const meta = widgetResourceMeta(view, definition.id);
    server.registerResource(
      view,
      uri,
      { title: WIDGETS[view].title, description: WIDGETS[view].description, mimeType: RESOURCE_MIME_TYPE, _meta: meta },
      async () => ({
        contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(view), _meta: meta }],
      }),
    );
  }

  return server;
}
