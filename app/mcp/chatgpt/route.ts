import { handleMcpRequest } from '@/lib/mcp/handler';

/**
 * The NP Hiring MCP endpoint for ChatGPT: https://nphiring.com/mcp/chatgpt.
 * Same tools as /mcp; it differs in the widget's `ui.domain` and in how a
 * missing sign-in is reported (lib/mcp/config.ts).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'chatgpt');
}

export async function POST(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'chatgpt');
}

export async function DELETE(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'chatgpt');
}

export async function OPTIONS(request: Request): Promise<Response> {
    return handleMcpRequest(request, 'chatgpt');
}
