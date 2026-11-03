/** @jsxImportSource preact */
/**
 * The few 16px line icons the widget uses, inline so the document loads
 * nothing. All are decorative: the control or text next to them carries the
 * meaning.
 */
import type { ComponentChildren } from 'preact';

function Icon({ children, className }: { children: ComponentChildren; className?: string }) {
    return (
        <svg
            className={className ? `icon ${className}` : 'icon'}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export function IconBolt() {
    return (
        <Icon className="icon-bolt">
            <path d="M9.2 1.6 3.6 9h4l-.8 5.4L12.4 7h-4l.8-5.4Z" fill="currentColor" stroke-width="1" />
        </Icon>
    );
}

export function IconChevronLeft() {
    return (
        <Icon>
            <path d="M10 3.5 5.5 8l4.5 4.5" />
        </Icon>
    );
}

export function IconChevronRight() {
    return (
        <Icon>
            <path d="m6 3.5 4.5 4.5L6 12.5" />
        </Icon>
    );
}

export function IconChevronDown() {
    return (
        <Icon>
            <path d="m3.5 6 4.5 4.5L12.5 6" />
        </Icon>
    );
}

export function IconExternal() {
    return (
        <Icon className="icon-external">
            <path d="M6 4.5h5.5V10M11.5 4.5l-7 7" />
        </Icon>
    );
}

export function IconExpand() {
    return (
        <Icon>
            <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.25 6.75M2.5 13.5l4.25-4.25" />
        </Icon>
    );
}

export function IconBookmark({ filled }: { filled: boolean }) {
    return (
        <Icon>
            <path d="M4.5 2.5h7v11L8 11l-3.5 2.5v-11Z" fill={filled ? 'currentColor' : 'none'} />
        </Icon>
    );
}

export function IconCheck() {
    return (
        <Icon>
            <path d="m3.5 8.5 3 3 6-7" />
        </Icon>
    );
}

export function IconAlert() {
    return (
        <Icon>
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.9v3.5M8 11h.01" />
        </Icon>
    );
}
