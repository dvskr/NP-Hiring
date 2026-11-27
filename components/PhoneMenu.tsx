'use client';

/**
 * The phone menu: one round button on the right of the header bar, and the
 * card it opens, the same on every page (components/Header.tsx places it on
 * every page that has the header). The button never moves and the menu never
 * changes between pages: it changes only with who is signed in
 * (lib/auth-role-store.ts).
 *
 * The card, top to bottom:
 *   - Browse Jobs and Post a Job, for every visitor
 *   - a signed-in visitor's own links (lib/nav/role-links.ts)
 *   - three short groups: Find jobs, Pay and careers, Employers
 *     (lib/nav/phone-menu-links.ts)
 *   - the account row: Sign in and Create account, or the account control
 *   - the small links, About and Contact
 *
 * It is a modal dialog: focus moves in on open, Tab stays inside, Escape and
 * a tap outside close it, focus returns to the button, and the page under it
 * does not scroll. A tap on any link closes it, and so does a new page. No
 * animation library: the card drops in with a CSS animation
 * (components/phone-menu.ts), which reduced motion turns off.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { ChevronRight, Menu, X } from 'lucide-react';
import HeaderAuth from '@/components/auth/HeaderAuth';
import { PHONE_MENU_CSS } from '@/components/phone-menu';
import { useAuthRole } from '@/lib/auth-role-store';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { roleLinks } from '@/lib/nav/role-links';
import { PHONE_MENU_BUTTONS, PHONE_MENU_GROUPS, PHONE_MENU_SMALL_LINKS } from '@/lib/nav/phone-menu-links';

/** The card's id, which the button names in aria-controls. */
export const PHONE_MENU_ID = 'phone-menu';

/** Whether `href` is the page on screen or a page under it. */
function isHere(pathname: string, href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
}

interface MenuRowProps {
    readonly href: string;
    readonly label: string;
    readonly here: boolean;
    readonly onTap: () => void;
}

/** One row of the menu: its label and a chevron; the page on screen is marked current. */
function MenuRow({ href, label, here, onTap }: MenuRowProps) {
    return (
        <Link href={href} className="phone-menu-link" aria-current={here ? 'page' : undefined} onClick={onTap}>
            {label}
            <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true" className="phone-menu-chevron" />
        </Link>
    );
}

export interface PhoneMenuProps {
    /** Classes for the menu's wrapper, so the bar that places it decides at which widths it shows. */
    readonly className?: string;
}

export default function PhoneMenu({ className }: PhoneMenuProps) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname() ?? '/';
    const role = useAuthRole();
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const close = useCallback(() => setOpen(false), []);
    const cardRef = useFocusTrap<HTMLDivElement>({ isOpen: open, onEscape: close });

    // A new page closes the menu (Back and Forward included). Deferred a tick,
    // the repo's set-state-in-effect pattern; on first mount the menu is
    // already closed, so the deferred set does nothing.
    useEffect(() => {
        const pageChanged = setTimeout(() => setOpen(false), 0);
        return () => clearTimeout(pageChanged);
    }, [pathname]);

    // The page under the open menu does not scroll. html is the page's
    // scroller (globals.css sets overflow-y on it), so both are locked, and
    // the cleanup puts back exactly what was there, so another overlay's lock
    // survives this menu closing.
    useEffect(() => {
        if (!open) return;
        const body = document.body.style.overflow;
        const html = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            if (document.body.style.overflow === 'hidden') document.body.style.overflow = body;
            if (document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = html;
        };
    }, [open]);

    // Focus return fallback. useFocusTrap gives focus back to whatever held it
    // when the menu opened, but a browser that does not focus a button on a
    // tap (Safari) leaves that as <body>. When the menu closes with focus
    // stranded on <body>, the button takes it.
    const wasOpen = useRef(false);
    useEffect(() => {
        if (open) {
            wasOpen.current = true;
            return;
        }
        if (!wasOpen.current) return;
        wasOpen.current = false;
        const id = window.setTimeout(() => {
            const active = document.activeElement;
            if (!active || active === document.body) buttonRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(id);
    }, [open]);

    // Browse Jobs is one of the two buttons, so a seeker's own list does not repeat it.
    const ownLinks = (roleLinks(role) ?? []).filter((link) => link.href !== '/jobs');

    const card = (
        <>
            <div aria-hidden="true" className="phone-menu-backdrop" onClick={close} />
            <div ref={cardRef} id={PHONE_MENU_ID} role="dialog" aria-modal="true" aria-label="Menu" className="phone-menu-card">
                <div className="phone-menu-buttons">
                    {PHONE_MENU_BUTTONS.map((button) => (
                        <Link
                            key={button.href}
                            href={button.href}
                            className={button.href === '/jobs' ? 'phone-menu-cta phone-menu-browse' : 'phone-menu-cta phone-menu-post'}
                            onClick={close}
                        >
                            {button.label}
                        </Link>
                    ))}
                </div>
                {ownLinks.length > 0 && (
                    <nav aria-label="Your account">
                        <p className="phone-menu-label">Your account</p>
                        {ownLinks.map((link) => (
                            <MenuRow key={link.href} href={link.href} label={link.label} here={isHere(pathname, link.href)} onTap={close} />
                        ))}
                    </nav>
                )}
                {PHONE_MENU_GROUPS.map((group) => (
                    <nav key={group.title} aria-label={group.title}>
                        <p className="phone-menu-label">{group.title}</p>
                        {group.links.map((link) => (
                            <MenuRow key={link.href} href={link.href} label={link.label} here={isHere(pathname, link.href)} onTap={close} />
                        ))}
                    </nav>
                ))}
                {role === null && (
                    <div className="phone-menu-account">
                        <Link href="/login" className="phone-menu-link" onClick={close}>
                            Sign in
                        </Link>
                        <Link href="/signup" className="phone-menu-create" onClick={close}>
                            Create account
                        </Link>
                    </div>
                )}
                {typeof role === 'string' && (
                    <div className="phone-menu-account">
                        <HeaderAuth onNavigate={close} />
                    </div>
                )}
                <p className="phone-menu-small">
                    {PHONE_MENU_SMALL_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} className="phone-menu-small-link" onClick={close}>
                            {link.label}
                        </Link>
                    ))}
                </p>
            </div>
        </>
    );

    // The wrapper carries the bar's classes (at which widths the menu shows),
    // so the button's own look never overrides them.
    return (
        <div className={className} data-phone-menu="">
            <button
                ref={buttonRef}
                type="button"
                className="phone-menu-button"
                data-phone-menu-button=""
                aria-label="Menu"
                aria-expanded={open}
                aria-controls={PHONE_MENU_ID}
                onClick={() => setOpen((was) => !was)}
            >
                {open ? <X size={22} strokeWidth={2.25} aria-hidden="true" /> : <Menu size={22} strokeWidth={2.25} aria-hidden="true" />}
            </button>
            {/* Only a tap opens the menu, so a server render never reaches the portal. */}
            {open && createPortal(card, document.body)}
            <style>{PHONE_MENU_CSS}</style>
        </div>
    );
}
