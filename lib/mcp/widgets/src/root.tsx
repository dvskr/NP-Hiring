/** @jsxImportSource preact */
/**
 * The widget tree: the phase from the host (skeleton, error, view) and, once
 * a view is showing, a small navigation stack. Views the candidate opens from
 * inside the widget (Details, Easy Apply, My applications) go on top; the
 * ones below stay mounted but hidden, so Back restores them exactly as they
 * were (appended jobs, carousel position, typed answers).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { WidgetView } from '../../contracts';
import type { ApplicationStatus } from '../../tool-names';
import { COPY, GENERIC_ERROR } from './copy';
import type { SkeletonKind } from './results';
import { HostContext, NavigationContext, ServicesContext, type Navigation, type PushResult, type Services } from './services';
import type { WidgetState } from './store';
import { Button, InlineError } from './ui/controls';
import { IconChevronLeft } from './ui/icons';
import { ApplyPanel } from './views/apply';
import { ApplyResult } from './views/apply-result';
import { Applications } from './views/applications';
import { JobDetail } from './views/job-detail';
import { JobList } from './views/job-list';
import { Skeleton } from './views/skeletons';

interface Entry {
    id: number;
    view: WidgetView | null;
    skeleton: SkeletonKind;
    /** The control that opened this entry; focus returns there on Back. */
    from: HTMLElement | null;
    /** Window scroll of the entry below when this one opened (fullscreen). */
    scrollBelow: number;
}

type FocusRequest = { kind: 'back'; id: number } | { kind: 'heading'; id: number } | { kind: 'element'; element: HTMLElement | null; scroll: number };

function ViewSwitch({ view }: { view: WidgetView }) {
    switch (view.view) {
        case 'job-list':
            return <JobList view={view} />;
        case 'job-detail':
            return <JobDetail view={view} />;
        case 'apply':
            return <ApplyPanel view={view} />;
        case 'apply-result':
            return <ApplyResult view={view} />;
        case 'applications':
            return <Applications view={view} />;
        default:
            return <ErrorState message={GENERIC_ERROR} />;
    }
}

export function ErrorState({ message }: { message: string }) {
    return (
        <div className="view" data-view="error">
            <div className="panel error-panel" role="alert">
                <InlineError message={message} />
            </div>
        </div>
    );
}

function Navigator({ rootView, services }: { rootView: WidgetView; services: Services }) {
    const [stack, setStack] = useState<Entry[]>(() => [
        { id: 0, view: rootView, skeleton: rootView.view, from: null, scrollBelow: 0 },
    ]);
    const [statuses, setStatuses] = useState<Readonly<Record<string, ApplicationStatus>>>({});
    const [saves, setSaves] = useState<Readonly<Record<string, boolean>>>({});
    const [now] = useState(() => new Date());
    const nextIdRef = useRef(1);
    const liveRef = useRef(stack);
    const focusRequestRef = useRef<FocusRequest | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        liveRef.current = stack;
        const request = focusRequestRef.current;
        if (!request) return;
        focusRequestRef.current = null;
        if (request.kind === 'element') {
            window.scrollTo(0, request.scroll);
            request.element?.focus();
            return;
        }
        const entry = containerRef.current?.querySelector<HTMLElement>(`[data-entry="${request.id}"]`);
        if (request.kind === 'back') {
            window.scrollTo(0, 0);
            entry?.querySelector<HTMLElement>('.back')?.focus();
        } else {
            entry?.querySelector<HTMLElement>('h1')?.focus();
        }
    }, [stack]);

    const nav = useMemo<Navigation>(() => {
        const push = async (
            name: Parameters<Navigation['push']>[0],
            args: Record<string, unknown>,
            skeleton: SkeletonKind,
            from: HTMLElement | null,
        ): Promise<PushResult> => {
            const id = nextIdRef.current++;
            const scrollBelow = window.scrollY;
            focusRequestRef.current = { kind: 'back', id };
            setStack((current) => [...current, { id, view: null, skeleton, from, scrollBelow }]);
            const outcome = await services.callTool(name, args);
            if (!liveRef.current.some((entry) => entry.id === id)) return { kind: 'dismissed' };
            const view = outcome.ok ? outcome.view : null;
            if (!view) {
                focusRequestRef.current = { kind: 'element', element: from, scroll: scrollBelow };
                setStack((current) => current.filter((entry) => entry.id < id));
                return { kind: 'failed', message: outcome.ok ? GENERIC_ERROR : outcome.message };
            }
            setStack((current) => current.map((entry) => (entry.id === id ? { ...entry, view } : entry)));
            return { kind: 'shown' };
        };
        return {
            push,
            replace(view) {
                const top = liveRef.current[liveRef.current.length - 1];
                const id = nextIdRef.current++;
                focusRequestRef.current = { kind: 'heading', id };
                setStack((current) => [
                    ...current.slice(0, -1),
                    { id, view, skeleton: view.view, from: top?.from ?? null, scrollBelow: top?.scrollBelow ?? 0 },
                ]);
            },
            back() {
                const current = liveRef.current;
                if (current.length < 2) return;
                const top = current[current.length - 1];
                focusRequestRef.current = { kind: 'element', element: top.from, scroll: top.scrollBelow };
                setStack((latest) => (latest.length > 1 ? latest.slice(0, -1) : latest));
            },
            statusOf: (jobId) => statuses[jobId],
            savedOf: (jobId) => saves[jobId],
            setStatus: (jobId, status) => setStatuses((current) => ({ ...current, [jobId]: status })),
            setSaved: (jobId, saved) => setSaves((current) => ({ ...current, [jobId]: saved })),
            now,
        };
    }, [services, statuses, saves, now]);

    return (
        <NavigationContext.Provider value={nav}>
            <div ref={containerRef}>
                {stack.map((entry, index) => {
                    const top = index === stack.length - 1;
                    return (
                        <div key={entry.id} className="entry" data-entry={entry.id} hidden={!top}>
                            {index > 0 && (
                                <div className="entry-bar">
                                    <Button variant="ghost" className="back" onClick={() => nav.back()}>
                                        <IconChevronLeft />
                                        {COPY.back}
                                    </Button>
                                </div>
                            )}
                            {entry.view ? <ViewSwitch view={entry.view} /> : <Skeleton kind={entry.skeleton} />}
                        </div>
                    );
                })}
            </div>
        </NavigationContext.Provider>
    );
}

export function Root({ state, services }: { state: WidgetState; services: Services }) {
    const { phase, host } = state;
    let content = null;
    if (phase.kind === 'waiting') content = <Skeleton kind={phase.skeleton} />;
    else if (phase.kind === 'error') content = <ErrorState message={phase.message} />;
    else if (phase.kind === 'ready') content = <Navigator key={phase.seq} rootView={phase.view} services={services} />;

    return (
        <ServicesContext.Provider value={services}>
            <HostContext.Provider value={host}>
                <main className="np-root" data-mode={host.displayMode}>
                    {content}
                </main>
            </HostContext.Provider>
        </ServicesContext.Provider>
    );
}
