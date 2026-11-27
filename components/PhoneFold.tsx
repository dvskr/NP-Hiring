'use client';

/**
 * Folds long lists on a phone. A list marked `<details data-phone-fold open>`
 * is served open, so a wide screen, and a reader with no script, see every
 * link and every answer at once. On a phone (760 pixels and narrower) this
 * closes each one once the page is on screen, on every page the visitor
 * opens, so the footer's link columns and a page's FAQ take a row each
 * instead of whole screens.
 *
 * When the screen grows past 760 pixels (a tablet turned on its side), the
 * lists it closed open again: a wide screen shows a fold's heading as a plain
 * heading that cannot be tapped, so a list left closed there could only be
 * opened from the keyboard. Narrow again, they close again. A list the
 * visitor closed is left as it is.
 *
 * Nothing is removed: the links and answers stay in the page, one tap away,
 * and Google, which reads the phone version of a page, reads them all.
 * Everything a fold closes sits below the first screen, so closing it moves
 * nothing a visitor is looking at.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** The screens a fold closes on. */
export const PHONE_FOLD_QUERY = '(max-width: 760px)';

/** The marker a fold this closed carries, so a wider screen opens exactly those again. */
const FOLDED_MARK = 'data-phone-folded';

/** Closes every open fold under `root`; returns how many it closed. */
export function foldForPhone(root: ParentNode): number {
    let closed = 0;
    root.querySelectorAll('details[data-phone-fold][open]').forEach((fold) => {
        fold.removeAttribute('open');
        fold.setAttribute(FOLDED_MARK, '');
        closed += 1;
    });
    return closed;
}

/** Opens again every fold under `root` that foldForPhone closed; returns how many it opened. */
export function unfoldForWideScreen(root: ParentNode): number {
    let opened = 0;
    root.querySelectorAll(`details[data-phone-fold][${FOLDED_MARK}]`).forEach((fold) => {
        fold.removeAttribute(FOLDED_MARK);
        fold.setAttribute('open', '');
        opened += 1;
    });
    return opened;
}

export default function PhoneFold() {
    const pathname = usePathname();
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const phone = window.matchMedia(PHONE_FOLD_QUERY);
        if (phone.matches) foldForPhone(document);
        const onChange = (event: MediaQueryListEvent) => {
            if (event.matches) foldForPhone(document);
            else unfoldForWideScreen(document);
        };
        phone.addEventListener('change', onChange);
        return () => phone.removeEventListener('change', onChange);
    }, [pathname]);
    return null;
}
