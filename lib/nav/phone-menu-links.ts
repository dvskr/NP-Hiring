/**
 * What the phone menu lists (components/PhoneMenu.tsx), the same on every
 * page: two buttons, three short groups and two small links. The menu changes
 * only with who is signed in (a signed-in visitor's own links sit above the
 * groups, lib/nav/role-links.ts), never with the page, so nothing here
 * belongs to one page only.
 *
 * Every link opens a page with content of its own; the tests check that each
 * one has a route in app/ (tests/regressions/phone-menu.test.ts). Browse Jobs
 * and Post a Job are the two buttons, so neither repeats in a group, and
 * About and Contact are the small links at the foot, so neither repeats
 * either.
 *
 * Client and edge safe: plain data.
 */

export interface PhoneMenuLink {
    readonly href: string;
    readonly label: string;
}

export interface PhoneMenuGroup {
    readonly title: string;
    readonly links: readonly PhoneMenuLink[];
}

/** The two buttons at the top of the menu, for every visitor. */
export const PHONE_MENU_BUTTONS: readonly PhoneMenuLink[] = [
    { href: '/jobs', label: 'Browse Jobs' },
    { href: '/post-job', label: 'Post a Job' },
];

/**
 * The three groups, from the links the header and the footer already carry.
 * New Grad Jobs opens the new grad listing itself: /new-grad only redirects
 * there (next.config.ts).
 */
export const PHONE_MENU_GROUPS: readonly PhoneMenuGroup[] = [
    {
        title: 'Find jobs',
        links: [
            { href: '/jobs/locations', label: 'Jobs by Location' },
            { href: '/companies', label: 'Browse Companies' },
            { href: '/job-alerts', label: 'Job Alerts' },
            { href: '/jobs/new-grad', label: 'New Grad Jobs' },
        ],
    },
    {
        title: 'Pay and careers',
        links: [
            { href: '/salary-guide', label: 'Salary Guide' },
            { href: '/tools', label: 'Free Tools' },
            { href: '/guides', label: 'Career Guides' },
            { href: '/resources', label: 'Resources' },
            { href: '/blog', label: 'Blog' },
            { href: '/faq', label: 'FAQ' },
        ],
    },
    {
        title: 'Employers',
        links: [
            { href: '/for-employers', label: 'For Employers' },
            { href: '/pricing', label: 'Pricing' },
        ],
    },
];

/** The small links at the foot of the menu. */
export const PHONE_MENU_SMALL_LINKS: readonly PhoneMenuLink[] = [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
];
