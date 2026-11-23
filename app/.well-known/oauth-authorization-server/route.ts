import { authorizationServerMetadata, DISCOVERY_HEADERS } from '@/lib/mcp/oauth/metadata';

/** RFC 8414 metadata for the AI assistant connectors' authorization server. */
export function GET(): Response {
  return Response.json(authorizationServerMetadata(), { headers: DISCOVERY_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
}
