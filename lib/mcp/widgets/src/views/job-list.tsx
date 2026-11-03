/** @jsxImportSource preact */
/**
 * search_jobs and list_saved_jobs: a horizontal scroll-snap carousel inline
 * (the one scroll area the hosts allow), a grid in fullscreen. "Show more
 * jobs" appends the next page in place.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { JobListView, JobSummary, SearchJobsInput } from '../../../contracts';
import { TOOL } from '../../../tool-names';
import { COPY, GENERIC_ERROR, jobsCount } from '../copy';
import { useHost, useNav, useServices } from '../services';
import { Button, ExternalLink, InlineError, NeutralChips } from '../ui/controls';
import { IconChevronLeft, IconChevronRight, IconExpand } from '../ui/icons';
import { JobCard } from './job-card';
import { CardSkeleton } from './skeletons';

/** Skeleton cards shown at the end of the list while the next page loads. */
const MORE_PLACEHOLDERS = 2;

/** Fewer jobs than this sit in a plain grid: a carousel is for three or more cards. */
const CAROUSEL_MIN_JOBS = 3;

function withoutKey(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
    const next = { ...record };
    delete next[key];
    return next;
}

function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface ListEndProps {
    hasMore: boolean;
    loading: boolean;
    error: string | null;
    browseUrl: string;
    onMore(): void;
    tile: boolean;
}

function ListEnd({ hasMore, loading, error, browseUrl, onMore, tile }: ListEndProps) {
    return (
        <div className={tile ? 'end-tile' : 'end-block'}>
            <div className="end-actions">
                {hasMore && (
                    <Button onClick={onMore} aria-busy={loading}>
                        {COPY.showMoreJobs}
                    </Button>
                )}
                <ExternalLink href={browseUrl}>{COPY.seeAllOnSite}</ExternalLink>
            </div>
            <div className="msg" aria-live="polite">
                {error && <InlineError message={error} />}
            </div>
        </div>
    );
}

interface CarouselProps {
    labelledBy: string;
    /** Changes whenever the slides change, so the edge arrows are measured again. */
    layoutKey: string;
    onOverflow(overflowing: boolean): void;
    children: ComponentChildren;
}

function Carousel({ labelledBy, layoutKey, onOverflow, children }: CarouselProps) {
    const trackRef = useRef<HTMLUListElement>(null);
    const [edges, setEdges] = useState({ atStart: true, atEnd: true });

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return undefined;
        const update = () => {
            // A hidden view (another one is on top) measures zero: keep the last state.
            if (track.clientWidth === 0) return;
            const max = track.scrollWidth - track.clientWidth;
            setEdges({ atStart: track.scrollLeft <= 4, atEnd: track.scrollLeft >= max - 4 });
            // "More jobs than fit": the last job card, not the end tile, runs past the edge.
            const jobs = track.querySelectorAll<HTMLElement>('.slide-job');
            const last = jobs[jobs.length - 1];
            const right = last
                ? last.getBoundingClientRect().right - track.getBoundingClientRect().left + track.scrollLeft
                : 0;
            onOverflow(right > track.clientWidth + 1);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(track);
        track.addEventListener('scroll', update, { passive: true });
        return () => {
            observer.disconnect();
            track.removeEventListener('scroll', update);
        };
    }, [layoutKey, onOverflow]);

    const page = (direction: 1 | -1) => {
        const track = trackRef.current;
        if (!track) return;
        track.scrollBy({
            left: direction * Math.max(track.clientWidth * 0.85, 200),
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
    };

    return (
        <div className="carousel">
            <ul className="track" ref={trackRef} aria-labelledby={labelledBy}>
                {children}
            </ul>
            {!edges.atStart && (
                <button type="button" className="nav-btn nav-prev" aria-label={COPY.previous} onClick={() => page(-1)}>
                    <IconChevronLeft />
                </button>
            )}
            {!edges.atEnd && (
                <button type="button" className="nav-btn nav-next" aria-label={COPY.next} onClick={() => page(1)}>
                    <IconChevronRight />
                </button>
            )}
        </div>
    );
}

export function JobList({ view }: { view: JobListView }) {
    const services = useServices();
    const nav = useNav();
    const host = useHost();
    const headingId = useId();
    const [jobs, setJobs] = useState<JobSummary[]>(view.jobs);
    const [nextArgs, setNextArgs] = useState<SearchJobsInput | null>(view.nextPageArgs);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState<string | null>(null);
    const [cardErrors, setCardErrors] = useState<Readonly<Record<string, string>>>({});
    const [overflowing, setOverflowing] = useState(false);
    const detailButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const focusAfterLoadRef = useRef<string | null>(null);

    // After "Show more jobs", bring the first new card to the start and move focus to it.
    useEffect(() => {
        const id = focusAfterLoadRef.current;
        if (!id) return;
        focusAfterLoadRef.current = null;
        const button = detailButtonsRef.current.get(id);
        if (!button) return;
        button.closest('.slide')?.scrollIntoView({
            block: 'nearest',
            inline: 'start',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
        button.focus({ preventScroll: true });
    }, [jobs]);

    const fullscreen = host.displayMode === 'fullscreen';
    const carousel = !fullscreen && jobs.length >= CAROUSEL_MIN_JOBS;
    const showSeeAll = host.canFullscreen && carousel && overflowing;

    const open = async (job: JobSummary, from: HTMLElement, kind: 'details' | 'apply') => {
        setCardErrors((errors) => withoutKey(errors, job.id));
        const result =
            kind === 'details'
                ? await nav.push(TOOL.getJob, { job_id: job.id }, 'job-detail', from)
                : await nav.push(TOOL.startApplication, { job_id: job.id }, 'apply', from);
        if (result.kind === 'failed') setCardErrors((errors) => ({ ...errors, [job.id]: result.message }));
    };

    const loadMore = async () => {
        if (!nextArgs || loadingMore) return;
        setLoadingMore(true);
        setMoreError(null);
        const outcome = await services.callTool(TOOL.searchJobs, nextArgs);
        setLoadingMore(false);
        if (!outcome.ok) {
            setMoreError(outcome.message);
            return;
        }
        const next = outcome.view;
        if (!next || next.view !== 'job-list') {
            setMoreError(GENERIC_ERROR);
            return;
        }
        const known = new Set(jobs.map((job) => job.id));
        const fresh = next.jobs.filter((job) => !known.has(job.id));
        focusAfterLoadRef.current = fresh[0]?.id ?? null;
        setJobs((current) => [...current, ...fresh]);
        setNextArgs(next.nextPageArgs);
    };

    const cards = jobs.map((job) => (
        <li key={job.id} className="slide slide-job">
            <JobCard
                job={job}
                error={cardErrors[job.id] ?? null}
                onDetails={(item, from) => void open(item, from, 'details')}
                onApply={(item, from) => void open(item, from, 'apply')}
                detailsRef={(element) => {
                    if (element) detailButtonsRef.current.set(job.id, element);
                    else detailButtonsRef.current.delete(job.id);
                }}
            />
        </li>
    ));
    const placeholders = loadingMore
        ? Array.from({ length: MORE_PLACEHOLDERS }, (_, i) => (
              <li key={`loading-${i}`} className="slide" aria-hidden="true">
                  <CardSkeleton />
              </li>
          ))
        : null;
    const end = (tile: boolean) => (
        <ListEnd
            hasMore={nextArgs !== null}
            loading={loadingMore}
            error={moreError}
            browseUrl={view.browseUrl}
            onMore={() => void loadMore()}
            tile={tile}
        />
    );

    let body;
    if (jobs.length === 0) {
        body = (
            <div className="panel empty">
                <p>{COPY.noJobs}</p>
            </div>
        );
    } else if (!carousel) {
        body = (
            <>
                <ul className="grid" aria-labelledby={headingId}>
                    {cards}
                    {placeholders}
                </ul>
                {end(false)}
            </>
        );
    } else {
        body = (
            <Carousel labelledBy={headingId} layoutKey={`${jobs.length}:${loadingMore}`} onOverflow={setOverflowing}>
                {cards}
                {placeholders}
                <li className="slide slide-end">{end(true)}</li>
            </Carousel>
        );
    }

    return (
        <section className="view" data-view="job-list" aria-labelledby={headingId}>
            <header className="list-head">
                <div className="list-titles">
                    <h1 id={headingId} className="h1" tabIndex={-1}>
                        {view.heading}
                    </h1>
                    {(jobs.length > 0 || view.filters.length > 0) && (
                        <div className="list-sub">
                            {jobs.length > 0 && <span className="count">{jobsCount(view.total)}</span>}
                            <NeutralChips items={view.filters} />
                        </div>
                    )}
                </div>
                {showSeeAll && (
                    <Button variant="ghost" className="see-all" onClick={() => void services.requestFullscreen()}>
                        <IconExpand />
                        {COPY.seeAll}
                    </Button>
                )}
            </header>
            {body}
        </section>
    );
}
