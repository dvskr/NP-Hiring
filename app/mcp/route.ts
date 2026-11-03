import { handleMcpRequest } from '@/lib/mcp/handler';

/**
 * The NP Hiring MCP endpoint for Claude (and any standard MCP client):
 * https://nphiring.com/mcp. ChatGPT connects to /mcp/chatgpt instead; see
 * lib/mcp/config.ts for why there are two.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'claude');
}

export async function POST(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'claude');
}

export async function DELETE(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'claude');
}

export async function OPTIONS(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'claude');
}
