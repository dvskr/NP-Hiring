/** @jsxImportSource preact */
/**
 * Buttons, links, chips and the employer tile. Brand color appears only on
 * the primary button, the Easy Apply badge and the clay fact chips; the rest
 * takes the host's surface, text and border tokens (styles.css).
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentChildren, Ref, TargetedMouseEvent } from 'preact';
import type { JobSummary } from '../../../contracts';
import type { ApplicationStatus } from '../../../tool-names';
import { statusTone } from '../applications';
import { COPY, experienceLabel, payLabel, statusLabel } from '../copy';
import { initials } from '../format';
import { useServices } from '../services';
import { IconAlert, IconBolt, IconExternal } from './icons';

export function cx(...names: Array<string | false | null | undefined>): string {
    return names.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className' | 'class' | 'ref'> {
    variant?: ButtonVariant;
    className?: string;
    buttonRef?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', className, buttonRef, children, ...rest }: ButtonProps) {
    return (
        <button type="button" ref={buttonRef} className={cx('btn', `btn-${variant}`, className)} {...rest}>
            {children}
        </button>
    );
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'className' | 'class'> {
    href: string;
    className?: string;
    /** Inline links sit in running text and skip the trailing arrow. */
    inline?: boolean;
    children: ComponentChildren;
}

/** A real link for semantics and hover preview; activation always goes through the host's openLink. */
export function ExternalLink({ href, className, inline = false, children, ...rest }: LinkProps) {
    const services = useServices();
    const open = (event: TargetedMouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        void services.openLink(href);
    };
    return (
        <a
            href={href}
            className={cx(inline ? 'link link-inline' : 'link link-row', className)}
            onClick={open}
            onAuxClick={open}
            rel="noopener noreferrer"
            {...rest}
        >
            {children}
            {!inline && <IconExternal />}
        </a>
    );
}

export function InlineError({ message, id }: { message: string; id?: string }) {
    return (
        <p className="inline-error" id={id}>
            <IconAlert />
            <span>{message}</span>
        </p>
    );
}

export function Tile({ name, large = false }: { name: string; large?: boolean }) {
    return (
        <span className={cx('tile', large && 'tile-lg')} aria-hidden="true">
            {initials(name)}
        </span>
    );
}

export function EasyApplyBadge() {
    return (
        <span className="badge">
            <IconBolt />
            {COPY.easyApply}
        </span>
    );
}

export function StatusChip({ status, label }: { status: ApplicationStatus; label?: string }) {
    return <span className={cx('chip', 'status', `status-${statusTone(status)}`)}>{label ?? statusLabel(status)}</span>;
}

/** Work mode, job type, pay and experience in the site's clay pastels. */
export function FactChips({ job, extra }: { job: JobSummary; extra?: ComponentChildren }) {
    const pay = payLabel(job.pay, job.payIsEstimate);
    const experience = experienceLabel(job.newGradFriendly, job.experience);
    return (
        <ul className="chips">
            {job.workMode && <li className="chip chip-mint">{job.workMode}</li>}
            {job.jobType && <li className="chip chip-peach">{job.jobType}</li>}
            {pay && <li className="chip chip-pink">{pay}</li>}
            {experience && <li className="chip chip-green">{experience}</li>}
            {extra}
        </ul>
    );
}

export function NeutralChips({ items, label }: { items: readonly string[]; label?: string }) {
    if (items.length === 0) return null;
    return (
        <ul className="chips" aria-label={label}>
            {items.map((item, index) => (
                <li key={`${index}:${item}`} className="chip chip-neutral">
                    {item}
                </li>
            ))}
        </ul>
    );
}
