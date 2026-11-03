/**
 * What views may ask of the host, behind one interface: main.tsx implements
 * it with the ext-apps App (callServerTool, openLink, requestDisplayMode,
 * updateModelContext). Views never touch the App directly.
 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { WidgetView } from '../../contracts';
import type { ApplicationStatus, ToolName } from '../../tool-names';
import type { SkeletonKind, ToolOutcome } from './results';
import type { HostUi } from './store';

export interface Services {
    callTool(name: ToolName, args: Record<string, unknown>): Promise<ToolOutcome>;
    /** False when the host refused or failed to open the link. */
    openLink(url: string): Promise<boolean>;
    requestFullscreen(): Promise<void>;
    /** Tells the assistant what just happened in the widget (best effort). */
    tellModel(text: string): void;
}

/** How a pushed view ended: shown, failed (the caller shows the message inline) or left with Back first. */
export type PushResult = { kind: 'shown' } | { kind: 'failed'; message: string } | { kind: 'dismissed' };

export interface Navigation {
    /** Opens the view a tool returns on top of the current one, with a skeleton until it arrives. */
    push(name: ToolName, args: Record<string, unknown>, skeleton: SkeletonKind, from: HTMLElement | null): Promise<PushResult>;
    /** Swaps the current view for another (a submitted form for its result). */
    replace(view: WidgetView): void;
    back(): void;
    /** Applications and saves changed in this widget since the views were loaded. */
    statusOf(jobId: string): ApplicationStatus | undefined;
    savedOf(jobId: string): boolean | undefined;
    setStatus(jobId: string, status: ApplicationStatus): void;
    setSaved(jobId: string, saved: boolean): void;
    /** Clock for "Posted today" and similar labels. */
    now: Date;
}

export const ServicesContext = createContext<Services | null>(null);
export const HostContext = createContext<HostUi>({ displayMode: 'inline', canFullscreen: false, timeZone: undefined });
export const NavigationContext = createContext<Navigation | null>(null);

export function useServices(): Services {
    const services = useContext(ServicesContext);
    if (!services) throw new Error('ServicesContext is missing');
    return services;
}

export function useHost(): HostUi {
    return useContext(HostContext);
}

export function useNav(): Navigation {
    const nav = useContext(NavigationContext);
    if (!nav) throw new Error('NavigationContext is missing');
    return nav;
}
