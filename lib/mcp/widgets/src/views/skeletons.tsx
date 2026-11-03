/** @jsxImportSource preact */
/**
 * Loading placeholders shaped like the view that replaces them, so nothing
 * jumps when the result lands. No spinners (owner rule); the pulse stops
 * under prefers-reduced-motion.
 */
import type { SkeletonKind } from '../results';
import { cx } from '../ui/controls';

function Bar({ className }: { className: string }) {
    return <span className={cx('skel', className)} />;
}

export function CardSkeleton() {
    return (
        <div className="card job-card" aria-hidden="true">
            <div className="card-top">
                <span className="tile skel" />
            </div>
            <div className="card-text">
                <Bar className="skel-title w90" />
                <Bar className="skel-title w60" />
                <Bar className="skel-line w70" />
                <Bar className="skel-line w45" />
            </div>
            <div className="chips">
                <Bar className="skel-chip w-chip-s" />
                <Bar className="skel-chip w-chip-m" />
                <Bar className="skel-chip w-chip-l" />
            </div>
            <Bar className="skel-small w45" />
            <div className="card-actions">
                <Bar className="skel-btn" />
                <Bar className="skel-btn" />
            </div>
        </div>
    );
}

function ListSkeleton() {
    return (
        <div className="view">
            <div className="list-head">
                <div className="list-titles">
                    <Bar className="skel-h1 w60" />
                    <Bar className="skel-line w30" />
                </div>
            </div>
            <div className="carousel">
                <ul className="track">
                    {[0, 1, 2].map((i) => (
                        <li key={i} className="slide">
                            <CardSkeleton />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

function DetailSkeleton() {
    return (
        <div className="view">
            <div className="panel">
                <div className="detail-head">
                    <span className="tile tile-lg skel" />
                    <div className="detail-titles">
                        <Bar className="skel-h1 w80" />
                        <Bar className="skel-line w45" />
                        <Bar className="skel-line w30" />
                    </div>
                </div>
                <div className="chips">
                    <Bar className="skel-chip w-chip-s" />
                    <Bar className="skel-chip w-chip-m" />
                    <Bar className="skel-chip w-chip-l" />
                </div>
                <div className="facts">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="fact">
                            <Bar className="skel-small w45" />
                            <Bar className="skel-line w70" />
                        </div>
                    ))}
                </div>
                <div className="stack-8">
                    <Bar className="skel-line w100" />
                    <Bar className="skel-line w90" />
                    <Bar className="skel-line w100" />
                    <Bar className="skel-line w60" />
                </div>
                <div className="actions">
                    <Bar className="skel-btn w-btn" />
                    <Bar className="skel-btn w-btn" />
                </div>
            </div>
        </div>
    );
}

function ApplySkeleton() {
    return (
        <div className="view">
            <div className="panel">
                <div className="stack-8">
                    <Bar className="skel-h1 w80" />
                    <Bar className="skel-line w45" />
                </div>
                <div className="field">
                    <Bar className="skel-label w30" />
                    <Bar className="skel-input" />
                </div>
                <div className="field">
                    <Bar className="skel-label w30" />
                    <Bar className="skel-area" />
                </div>
                <div className="field">
                    <Bar className="skel-label w60" />
                    <Bar className="skel-input" />
                </div>
                <Bar className="skel-line w90" />
                <Bar className="skel-btn w-btn-wide" />
            </div>
        </div>
    );
}

function ResultSkeleton() {
    return (
        <div className="view">
            <div className="panel result">
                <span className="result-mark skel" />
                <div className="stack-8">
                    <Bar className="skel-h1 w45" />
                    <Bar className="skel-line w70" />
                    <Bar className="skel-line w30" />
                </div>
                <div className="actions">
                    <Bar className="skel-btn w-btn" />
                </div>
            </div>
        </div>
    );
}

function ApplicationsSkeleton() {
    return (
        <div className="view">
            <div className="list-head">
                <div className="list-titles">
                    <Bar className="skel-h1 w45" />
                    <Bar className="skel-line w30" />
                </div>
            </div>
            <div className="panel panel-rows">
                <ul className="rows">
                    {[0, 1, 2].map((i) => (
                        <li key={i} className="row">
                            <div className="row-main">
                                <Bar className="skel-title w70" />
                                <Bar className="skel-line w45" />
                                <Bar className="skel-small w30" />
                            </div>
                            <div className="row-side">
                                <Bar className="skel-chip w-chip-s" />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export function Skeleton({ kind }: { kind: SkeletonKind }) {
    let body;
    switch (kind) {
        case 'job-detail':
            body = <DetailSkeleton />;
            break;
        case 'apply':
            body = <ApplySkeleton />;
            break;
        case 'apply-result':
            body = <ResultSkeleton />;
            break;
        case 'applications':
            body = <ApplicationsSkeleton />;
            break;
        default:
            body = <ListSkeleton />;
    }
    return (
        <div className="skeleton" aria-busy="true" data-view={`skeleton-${kind}`}>
            {body}
        </div>
    );
}
