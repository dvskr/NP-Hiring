import { DISCOVERY_HEADERS, protectedResourceMetadata } from '@/lib/mcp/oauth/metadata';

/** RFC 9728 metadata for the candidate MCP endpoint, /mcp. */
export function GET(): Response {
  return Response.json(protectedResourceMetadata('candidate'), { headers: DISCOVERY_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
}
