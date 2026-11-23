import type { z } from 'zod';
import { brand } from '@/config/brand';
import type { McpResourceId } from '@/lib/mcp/oauth/config';
import type { VerifiedAccess } from '@/lib/mcp/oauth/tokens';
import type { WidgetData, WidgetView } from '@/lib/mcp/widgets/src/contracts';

/**
 * Shared types for the MCP tool layer.
 *
 * A tool is declared as data (McpToolSpec) and registered with the SDK by
 * lib/mcp/server/build-server.ts, which is where every cross-cutting rule
 * lives: annotations, widget metadata, sign-in challenges, per-account rate
 * limits and error shaping. A tool's run() only does its own job.
 */

/**
 * none      works signed out, never reads the account.
 * optional  works signed out; signed in, it can mark saved jobs and such.
 * required  needs a signed-in account; signed out, the caller is asked to sign in.
 */
export type ToolAuth = 'none' | 'optional' | 'required';

export interface ToolAnnotationsSpec {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
}

export interface ToolContext {
  endpoint: McpResourceId;
  /** Null when the request carries no token (candidate endpoint only). */
  access: VerifiedAccess | null;
  /** The site's absolute base URL, for links. */
  baseUrl: string;
  /** Client IP, for anonymous rate limiting. */
  ip: string;
  /** params._meta of the tool call, as hints only, never for authorization. */
  requestMeta: Record<string, unknown> | undefined;
  /**
   * 'chatgpt' when the request is recognisably ChatGPT's. It decides which
   * tools are listed and nothing else: the caller sets what it is read from.
   */
  host?: 'chatgpt';
}

export interface ToolOutcome {
  /** What the model reads. Always present, so hosts without UI still work. */
  text: string;
  /** Visible to the model and to the widget. Keep it compact. */
  structured?: WidgetData | Record<string, unknown>;
  /** Widget-only extras. ChatGPT hides _meta from the model. */
  widgetMeta?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpToolSpec<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, at most 64 characters (Claude directory rule). */
  name: string;
  title: string;
  description: string;
  input: Shape;
  annotations: ToolAnnotationsSpec;
  auth: ToolAuth;
  /** The widget that renders this tool's result, if any. */
  widget?: WidgetView;
  /**
   * Left out of the tool list for ChatGPT, whose directory allows neither
   * digital goods nor links toward a purchase.
   */
  notOnChatGpt?: boolean;
  /** Status line while the tool runs and after, at most 64 characters each (ChatGPT). */
  invoking?: string;
  invoked?: string;
  run(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<ToolOutcome>;
}

/**
 * Thrown by a tool that needs an account when the caller has none. The
 * builder turns it into the sign-in challenge the host understands.
 */
export class SignInRequiredError extends Error {
  constructor(message = `Sign in to ${brand.name} to do this.`) {
    super(message);
    this.name = 'SignInRequiredError';
  }
}

/** A failure whose message is safe and useful to show the person. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function requireAccess(ctx: ToolContext): VerifiedAccess {
  if (!ctx.access) throw new SignInRequiredError();
  return ctx.access;
}

/** Narrows a spec list without losing each tool's own argument types. */
export function defineTool<Shape extends z.ZodRawShape>(spec: McpToolSpec<Shape>): McpToolSpec<Shape> {
  return spec;
}
