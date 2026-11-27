/**
 * The links a signed-in visitor gets in place of the public ones: in the
 * desktop bar (components/Header.tsx) and at the top of the phone menu
 * (components/PhoneMenu.tsx). One list per role, so the two never differ.
 */
import { Activity, Bookmark, Briefcase, FileText, LayoutDashboard, MessageSquare, Users, Workflow, type LucideIcon } from 'lucide-react';

export interface RoleLink {
    readonly href: string;
    readonly label: string;
    readonly icon: LucideIcon;
}

/**
 * A job seeker: the high-frequency destinations only. Settings sits in the
 * account menu; Saved (a daily quick check) takes its slot.
 */
export const SEEKER_LINKS: readonly RoleLink[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/jobs', label: 'Browse Jobs', icon: Briefcase },
    { href: '/saved', label: 'Saved', icon: Bookmark },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
];

/**
 * An employer. Applicants has a route of its own (not a dashboard tab), so
 * it reads as a destination; the dashboard keeps its Applicants tab too.
 */
export const EMPLOYER_LINKS: readonly RoleLink[] = [
    { href: '/employer/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/employer/candidates', label: 'Talent Pool', icon: Users },
    { href: '/employer/applicants', label: 'Applicants', icon: FileText },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
];

/** An admin: the admin surfaces, which beat the public defaults an admin rarely uses. */
export const ADMIN_LINKS: readonly RoleLink[] = [
    { href: '/admin', label: 'Admin', icon: LayoutDashboard },
    { href: '/admin/jobs', label: 'Jobs', icon: Briefcase },
    { href: '/admin/outreach', label: 'Outreach', icon: Activity },
    { href: '/admin/pipeline', label: 'Pipeline', icon: Workflow },
];

/** The links of a signed-in role, or null for a visitor who is signed out or not known yet. */
export function roleLinks(role: string | null | undefined): readonly RoleLink[] | null {
    if (role === 'job_seeker') return SEEKER_LINKS;
    if (role === 'employer') return EMPLOYER_LINKS;
    if (role === 'admin') return ADMIN_LINKS;
    return null;
}
