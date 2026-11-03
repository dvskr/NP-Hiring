/**
 * GET /.well-known/oauth-protected-resource: the root protected resource
 * metadata (RFC 9728) answers the Claude endpoint's document (design 1), for
 * clients that look here before the path-suffixed URL.
 */
import type { NextResponse } from 'next/server';
import { mcpHostProfile } from '@/lib/mcp/config';
import { corsPreflight, publicJson } from '@/lib/oauth/http';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
    return publicJson(protectedResourceMetadata(mcpHostProfile('claude')));
}

export function OPTIONS(): NextResponse {
    return corsPreflight('GET, OPTIONS');
}
