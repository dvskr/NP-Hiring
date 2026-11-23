import { handleMcpRequest } from '@/lib/mcp/server/http-handler';
import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';

/**
 * The job seeker MCP endpoint, one address for ChatGPT, Claude and other MCP
 * clients. Streamable HTTP, stateless, JSON responses. See
 * lib/mcp/server/http-handler.ts.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Well under Claude's 240 second tool-call ceiling; every tool here is a few queries.
export const maxDuration = 60;

function handle(request: Request): Promise<Response> {
  return handleMcpRequest(request, CANDIDATE_ENDPOINT);
}

export { handle as GET, handle as POST, handle as DELETE, handle as OPTIONS };
