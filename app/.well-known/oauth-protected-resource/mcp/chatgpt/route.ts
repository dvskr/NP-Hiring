/**
 * GET /.well-known/oauth-protected-resource/mcp/chatgpt: RFC 9728 metadata
 * of the ChatGPT endpoint, https://nphiring.com/mcp/chatgpt (design 2.3).
 */
import type { NextResponse } from 'next/server';
import { mcpHostProfile } from '@/lib/mcp/config';
import { corsPreflight, publicJson } from '@/lib/oauth/http';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
    return publicJson(protectedResourceMetadata(mcpHostProfile('chatgpt')));
}

export function OPTIONS(): NextResponse {
    return corsPreflight('GET, OPTIONS');
}
