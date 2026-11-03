/**
 * GET /.well-known/oauth-authorization-server: RFC 8414 metadata of the
 * OAuth server behind the NP Hiring app in Claude and ChatGPT (design 2.2).
 */
import type { NextResponse } from 'next/server';
import { corsPreflight, publicJson } from '@/lib/oauth/http';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
    return publicJson(authorizationServerMetadata());
}

export function OPTIONS(): NextResponse {
    return corsPreflight('GET, OPTIONS');
}
