'use client';

import type { CSSProperties, ReactNode } from 'react';
import { trackOutboundLink } from '@/lib/analytics';

interface SisterBoardLinkProps {
    /** Absolute, utm-tagged url from sisterBoardUrl(). */
    href: string;
    /** Sent to GA as link_text, so each placement reads on its own in reports. */
    label: string;
    className?: string;
    style?: CSSProperties;
    /**
     * id of a heading inside the link. When set, the link is named by that
     * heading plus the new-tab note, so a card link is not announced as its
     * whole body (chip, title, blurb and action).
     */
    labelledBy?: string;
    children: ReactNode;
}

/**
 * Outbound link to the sister board. Opens a new tab so the visitor keeps
 * their place here, keeps the referrer (noopener only), and records a GA
 * outbound click.
 */
export default function SisterBoardLink({ href, label, className, style, labelledBy, children }: SisterBoardLinkProps) {
    const noteId = labelledBy ? `${labelledBy}-newtab` : undefined;
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener"
            className={className}
            style={style}
            aria-labelledby={labelledBy ? `${labelledBy} ${noteId}` : undefined}
            onClick={() => trackOutboundLink(href, label)}
        >
            {children}
            <span className="sr-only" id={noteId}> (opens in a new tab)</span>
        </a>
    );
}
