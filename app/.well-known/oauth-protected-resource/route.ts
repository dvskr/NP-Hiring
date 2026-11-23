import { DISCOVERY_HEADERS, protectedResourceMetadata } from '@/lib/mcp/oauth/metadata';

/**
 * RFC 9728 metadata at the bare well-known path. The path-inserted forms
 * (/mcp, /mcp/employer) are the canonical ones; this answers clients that
 * look at the root first, for the endpoint most of them connect to.
 */
export function GET(): Response {
  return Response.json(protectedResourceMetadata('candidate'), { headers: DISCOVERY_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
}
