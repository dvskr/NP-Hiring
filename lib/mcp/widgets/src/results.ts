/**
 * Reading tool results from the host. The server's structuredContent is
 * external data to the widget, so every view gets a structural check before
 * it renders; anything unrecognised becomes the error state instead of a
 * crash inside the host's iframe.
 */
import type { WidgetView } from '../../contracts';
import { TOOL } from '../../tool-names';
import { GENERIC_ERROR } from './copy';

/** The parts of an MCP CallToolResult the widget reads (the SDK type is assignable to it). */
export interface ToolResultLike {
    isError?: boolean;
    content?: ReadonlyArray<{ type: string; text?: string }>;
    structuredContent?: unknown;
}

export type ToolOutcome =
    | { ok: true; view: WidgetView | null; data: Record<string, unknown> | null }
    | { ok: false; message: string; data: Record<string, unknown> | null };

export type SkeletonKind = WidgetView['view'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasJob(value: Record<string, unknown>): boolean {
    const job = value.job;
    return isRecord(job) && typeof job.id === 'string' && typeof job.title === 'string';
}

/** The view a structuredContent object carries, or null when it is not a renderable view. */
export function asWidgetView(value: unknown): WidgetView | null {
    if (!isRecord(value)) return null;
    switch (value.view) {
        case 'job-list':
            return Array.isArray(value.jobs) && Array.isArray(value.filters) && typeof value.heading === 'string'
                ? (value as unknown as WidgetView)
                : null;
        case 'job-detail':
            return hasJob(value) ? (value as unknown as WidgetView) : null;
        case 'apply':
            return hasJob(value) && Array.isArray(value.questions) && isRecord(value.resume)
                ? (value as unknown as WidgetView)
                : null;
        case 'apply-result':
            return hasJob(value) && typeof value.appliedAt === 'string' ? (value as unknown as WidgetView) : null;
        case 'applications':
            return Array.isArray(value.applications) && Array.isArray(value.summary)
                ? (value as unknown as WidgetView)
                : null;
        default:
            return null;
    }
}

/** The first non-empty text block of a result. */
export function firstText(result: ToolResultLike): string | null {
    for (const block of result.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
            return block.text.trim();
        }
    }
    return null;
}

export function readToolResult(result: ToolResultLike): ToolOutcome {
    const data = isRecord(result.structuredContent) ? result.structuredContent : null;
    if (result.isError) {
        return { ok: false, message: firstText(result) ?? GENERIC_ERROR, data };
    }
    return { ok: true, view: asWidgetView(data), data };
}

const SKELETON_BY_TOOL: Readonly<Record<string, SkeletonKind>> = {
    [TOOL.searchJobs]: 'job-list',
    [TOOL.listSavedJobs]: 'job-list',
    [TOOL.getJob]: 'job-detail',
    [TOOL.startApplication]: 'apply',
    [TOOL.submitApplication]: 'apply-result',
    [TOOL.listApplications]: 'applications',
};

/**
 * Which skeleton to show before the result arrives: from the tool's name when
 * the host shares it (hostContext.toolInfo), else from the shape of its input.
 */
export function skeletonFor(toolName: string | undefined, input: Record<string, unknown> | undefined): SkeletonKind {
    if (toolName && SKELETON_BY_TOOL[toolName]) return SKELETON_BY_TOOL[toolName];
    const args = input ?? {};
    if ('consent' in args) return 'apply-result';
    if ('cover_letter_draft' in args) return 'apply';
    if ('job_id' in args) return 'job-detail';
    if ('status' in args) return 'applications';
    return 'job-list';
}
