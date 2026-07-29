/**
 * /accessibility — public accessibility statement (content audit P2 #9,
 * trust cluster; sibling of /editorial-policy and /security).
 *
 * TRUTH RULES this page is built around:
 *   - Every "what works" claim below names a control that actually ships
 *     in this repo and is pinned by a regression test. Nothing here is
 *     aspirational marketing.
 *   - Every "known gap" below was VERIFIED against the current source on
 *     the review date, not guessed:
 *       · contrast — computed ratios for the muted text tokens used in
 *         secondary/meta positions (#B0BEC5 ≈ 1.9:1, #A0AEB5 ≈ 2.3:1,
 *         #94A3B8 ≈ 2.6:1, #8A9BA6 ≈ 2.9:1, #6B7F8A ≈ 4.2:1 on white)
 *         all fall under the 4.5:1 AA minimum for normal-size text;
 *       · status messages — components/ui/ToastProvider.tsx renders no
 *         role="status"/aria-live region, so toast feedback is visual only;
 *       · data tables — zero `<th scope>` attributes exist across app/
 *         and components/;
 *       · dialogs — exactly five files import lib/hooks/useFocusTrap
 *         (app/jobs/JobsPageClient.tsx, components/InPlatformApplyForm.tsx,
 *         components/MobileFilterDrawer.tsx, components/ReportJobButton.tsx,
 *         components/employer/ComposeMessageModal.tsx). Six further
 *         role="dialog" surfaces have NO focus containment and no focus
 *         restore: components/ui/ConfirmDialog.tsx, components/CookieConsent.tsx
 *         (also the one dialog with no aria-modal and no Escape handler),
 *         components/Header.tsx (mobile nav), components/profile/
 *         ResumeAutofillReview.tsx, and the three modals in
 *         components/post-job/JdStarterPanel.tsx;
 *       · reduced motion — app/globals.css gates the CSS animations, but
 *         framer-motion is JS-driven and cannot be reached from CSS. Five
 *         components import it; only three call useReducedMotion()
 *         (EmployerHowItWorks, FeaturedJobs, TopStatesList). HomepageHero
 *         (ungated staggered entrance) and Header (ungated mobile-nav fade)
 *         do not, and there is no <MotionConfig reducedMotion="user">
 *         anywhere in the repo, so nothing gates them globally either;
 *       · the lead-magnet PDF is printed by headless Chromium
 *         (scripts/generate-salary-pdf.ts), which emits an untagged PDF.
 *   - No conformance level is claimed outright. This is a self-assessment
 *     and says so; there is no third-party audit and no VPAT yet, and the
 *     page states that plainly instead of implying certification.
 *
 * When a gap below is fixed, move the row out of "Known gaps" in the SAME
 * change that fixes it, and bump ACCESSIBILITY_LAST_REVIEWED.
 */
import { Metadata } from 'next';
import Link from 'next/link';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import {
    Accessibility as AccessibilityIcon,
    Keyboard,
    Eye,
    AlertTriangle,
    MailWarning,
    ShieldCheck,
    ExternalLink,
} from 'lucide-react';
import { brand } from '@/config/brand';

/**
 * Date this statement was last checked against the live codebase. Bump it
 * whenever a claim below is added, removed, or re-verified — a stale date
 * on an accessibility statement is itself a trust problem.
 */
export const ACCESSIBILITY_LAST_REVIEWED = '2026-07-29';

/** Target we build to. Deliberately described as a target, not a claim. */
const CONFORMANCE_TARGET = 'WCAG 2.2 Level AA';

export const metadata: Metadata = {
    title: 'Accessibility Statement',
    description: `How ${brand.name} approaches accessibility: the ${CONFORMANCE_TARGET} target we build to, the assistive-technology support that ships today, the gaps we know about, and how to report a barrier.`,
    alternates: { canonical: `${brand.baseUrl}/accessibility` },
    robots: { index: true, follow: true },
};

interface SectionProps {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
    return (
        <section style={{ display: 'flex', gap: '14px', marginTop: '28px' }}>
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FDF2F8',
                    color: '#BE185D',
                }}
            >
                {icon}
            </div>
            <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 8px 0' }}>
                    {title}
                </h2>
                <div style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.7 }}>{children}</div>
            </div>
        </section>
    );
}

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };

/**
 * Muted/meta text for this page. The site's usual muted grey, #6B7F8A, is one
 * of the tokens the contrast gap below names: it measures 4.177:1 on #FFFFFF
 * and 3.689:1 on the #F5F0EB page background, both under the 4.5:1 AA minimum
 * for normal-size text. Publishing a contrast complaint in text that fails the
 * threshold it complains about is not a defensible thing to ship, so this page
 * uses a darker slate — 5.322:1 on #FFFFFF, 4.700:1 on #F5F0EB — while staying
 * visibly subordinate to the #4A5568 body copy (7.526:1).
 *
 * Ratios are sRGB relative luminance per WCAG 2.x; recompute before changing
 * this value.
 */
const MUTED_TEXT = '#5A6E7A';

/**
 * Controls that actually ship. Each entry names the mechanism (so the claim
 * is falsifiable by reading the code) and the success criterion it serves.
 */
const SHIPPED_CONTROLS: { claim: string; criterion: string }[] = [
    {
        claim: 'A "Skip to main content" link is the first focusable element on every page and jumps past the header navigation.',
        criterion: 'WCAG 2.4.1 Bypass Blocks',
    },
    {
        claim: 'Keyboard focus is always visible: a two-tone focus ring is applied globally on :focus-visible, so it appears for keyboard and switch users without adding a click outline for mouse users.',
        criterion: 'WCAG 2.4.7 Focus Visible',
    },
    {
        claim: 'The five dialogs in the search-and-apply path — the apply modal and its confirmation, the job-alert modal, the mobile filter drawer, the employer message composer, and the report-job flow — share one focus-trap hook: focus moves into the dialog, Tab cycles inside it, Escape closes it, and focus returns to the control that opened it. Other dialogs on the site do not do this yet, and they are listed as a known gap below.',
        criterion: 'WCAG 2.1.2 No Keyboard Trap · 2.4.3 Focus Order',
    },
    {
        claim: 'Dialogs carry role="dialog", and every one except the cookie banner also carries aria-modal. Icon-only buttons carry accessible names, and list rows that behave like buttons expose role="button" with Enter/Space handling rather than a bare click target.',
        criterion: 'WCAG 4.1.2 Name, Role, Value',
    },
    {
        claim: 'Motion honors prefers-reduced-motion in CSS: smooth scrolling becomes instant jumps, and CSS entrance animations, scroll reveals, and the skeleton shimmer are switched off. Three of the JavaScript-animated sections — the employer how-it-works steps, the featured-jobs grid, and the top-states list — check the preference themselves and render straight to their resting state. Two other JavaScript-driven animations do not yet, and they are listed as a known gap below.',
        criterion: 'WCAG 2.3.3 Animation from Interactions',
    },
    {
        claim: 'Form fields — including employer screening questions on the apply form — have programmatic labels, client-side validation with in-context error text, and visible character limits rather than silent server-side truncation.',
        criterion: 'WCAG 3.3.1 Error Identification · 3.3.2 Labels or Instructions',
    },
    {
        claim: 'Blocking window.alert() has been removed from the product surfaces in favour of in-page messaging, and the removal is enforced by a test so it cannot creep back.',
        criterion: 'WCAG 2.2.1 Timing Adjustable (supporting)',
    },
];

/**
 * Verified gaps. Each entry states the barrier, who it affects, and what we
 * intend to do — no "we are committed to accessibility" filler.
 */
const KNOWN_GAPS: { gap: string; impact: string; plan: string }[] = [
    {
        gap: 'Low-contrast secondary text.',
        impact: 'Several muted grey tokens used for metadata, helper text, and captions measure between roughly 1.9:1 and 4.2:1 against our light backgrounds — below the 4.5:1 minimum for normal-size text. Anyone with low vision, or reading on a bright screen outdoors, may lose that text.',
        plan: 'We are darkening the muted text tokens site-wide. The primary body and heading colours already pass comfortably; this affects secondary copy.',
    },
    {
        gap: 'Focus is not trapped in every dialog.',
        impact: 'Five dialogs share our focus-trap hook, but the rest do not: the cookie banner, the mobile navigation menu, the shared confirm dialog, the resume-autofill review, and the three job-description starter modals. In those, Tab can walk out of the dialog into the page behind it, and closing the dialog does not return focus to the control that opened it — so a keyboard or screen-reader user loses their place. The cookie banner is also the one dialog missing aria-modal and an Escape handler.',
        plan: 'We are moving the remaining dialogs onto the same shared hook. Each one that moves across leaves this list and joins the list above in the same change.',
    },
    {
        gap: 'Two JavaScript-driven animations ignore reduced motion.',
        impact: 'Our site-wide reduced-motion rule is written in CSS, and the animation library a handful of sections use drives its movement from JavaScript, where that CSS rule cannot reach it. Three of those sections check the preference themselves; the homepage hero entrance and the mobile navigation overlay do not, so they still animate for people who have asked their system for less motion.',
        plan: 'Both are moving onto the same reduced-motion check the other three already use. When they do, this entry is deleted in the same change.',
    },
    {
        gap: 'Status messages are not announced.',
        impact: 'Confirmation and error toasts appear visually but are not exposed in a live region, so screen-reader users may not hear that a save, apply, or alert action succeeded.',
        plan: 'Adding a polite live region to the shared toast component is the next accessibility change queued.',
    },
    {
        gap: 'Some data tables lack header associations.',
        impact: 'Several tables — including the salary-guide and pricing tables — use visually styled header rows without scope attributes or a caption, so a screen reader may not tie a cell back to its column heading.',
        plan: 'We are adding scope attributes and captions table by table. The employer comparison table, the press data table, and the resource-guide tables have been corrected already.',
    },
    {
        gap: 'The downloadable salary-guide PDF is not tagged.',
        impact: 'It is produced by printing a web page to PDF, which does not emit a tagged reading order, so assistive technology may read it out of order.',
        plan: 'The same content is published as accessible HTML on our salary guide, and we link there as the primary source. Ask us and we will send the content in whatever format works for you.',
    },
    {
        gap: 'Employer-authored job descriptions.',
        impact: 'Job description HTML is written by the hiring organisation. We sanitise it for safety, but we cannot guarantee its heading order, link text, or image alternatives.',
        plan: 'Report a specific listing and we will contact the employer or correct the markup.',
    },
    {
        gap: 'No independent audit and no automated checks in our test suite.',
        impact: 'Everything above is a self-assessment by the team that builds the site. We have not commissioned a third-party audit, we do not publish a VPAT, and our continuous integration does not yet run automated accessibility scans.',
        plan: 'Automated scanning in CI first, an external review after that. We will say so here when either lands.',
    },
];

export default function AccessibilityPage() {
    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Accessibility', url: `${brand.baseUrl}/accessibility` },
                ]}
            />
            <article style={{ ...clayCard, maxWidth: '820px', margin: '0 auto', padding: '48px 40px' }}>
                <header>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 14px',
                            background: '#FDF2F8',
                            color: '#BE185D',
                            borderRadius: '20px',
                            fontSize: '13px',
                            fontWeight: 700,
                            marginBottom: '16px',
                        }}
                    >
                        <AccessibilityIcon size={14} /> Trust Center
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(2rem, 5vw, 2.75rem)',
                            fontWeight: 800,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35',
                            margin: '0 0 12px 0',
                            lineHeight: 1.15,
                        }}
                    >
                        Accessibility <span style={{ color: '#BE185D' }}>Statement</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: MUTED_TEXT, margin: 0, lineHeight: 1.6 }}>
                        Last reviewed against the live site: {ACCESSIBILITY_LAST_REVIEWED}
                    </p>
                </header>

                <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: 1.75, marginTop: '32px' }}>
                    {brand.name} (operated by <strong>{brand.legal.entityName}</strong>) is a job board for{' '}
                    {brand.niche.descriptor}s. People use it to find work, so it has to work with a keyboard, with a
                    screen reader, at high zoom, and with motion turned off. This page states what we have actually
                    built, what we know is still broken, and how to tell us when something blocks you.
                </p>

                <div
                    style={{
                        ...clayCard,
                        padding: '18px 22px',
                        marginTop: '20px',
                        background: '#FFFBEB',
                        border: '1px solid #FDE68A',
                    }}
                >
                    <p style={{ fontSize: '14px', color: '#78350F', margin: 0, lineHeight: 1.7 }}>
                        <strong>Conformance status: partial.</strong> We build to {CONFORMANCE_TARGET} as our target,
                        and we do <em>not</em> claim to fully meet it. The gaps listed further down are the ones we
                        have found and confirmed ourselves. This is a self-assessment: no independent audit has been
                        performed, and we do not publish a VPAT. We would rather publish an honest partial statement
                        than a conformance badge we cannot stand behind.
                    </p>
                </div>

                <Section icon={<Keyboard size={20} />} title="What works today">
                    <p style={{ marginBottom: '12px' }}>
                        Each item below is a control that ships in the product right now, with the success criterion
                        it is there to serve:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                        {SHIPPED_CONTROLS.map((c) => (
                            <li key={c.criterion + c.claim.slice(0, 24)} style={{ marginBottom: '10px' }}>
                                {c.claim}{' '}
                                <span style={{ color: MUTED_TEXT, fontSize: '13px', whiteSpace: 'nowrap' }}>
                                    ({c.criterion})
                                </span>
                            </li>
                        ))}
                    </ul>
                </Section>

                <Section icon={<AlertTriangle size={20} />} title="Known gaps — the honest list">
                    <p style={{ marginBottom: '14px' }}>
                        These are real barriers on the site today. We publish them because you deserve to know what
                        you will run into before you run into it.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {KNOWN_GAPS.map((g) => (
                            <div
                                key={g.gap}
                                style={{
                                    ...clayCard,
                                    padding: '16px 20px',
                                    borderLeft: '3px solid #BE185D',
                                }}
                            >
                                <p style={{ fontSize: '14.5px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>
                                    {g.gap}
                                </p>
                                <p style={{ fontSize: '13.5px', color: '#4A5568', margin: '0 0 6px', lineHeight: 1.65 }}>
                                    {g.impact}
                                </p>
                                <p style={{ fontSize: '13px', color: MUTED_TEXT, margin: 0, lineHeight: 1.6 }}>
                                    <strong style={{ color: '#7A1C2B' }}>What we are doing:</strong> {g.plan}
                                </p>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section icon={<Eye size={20} />} title="Parts of the experience we do not control">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>Payment.</strong> Paid job posts are completed on Stripe&apos;s hosted checkout.
                            That page is Stripe&apos;s, not ours, and its accessibility is governed by their own
                            statement.
                        </li>
                        <li>
                            <strong>Employer application sites.</strong> Many listings send you to the
                            employer&apos;s own application system. Where a job supports applying on {brand.name}{' '}
                            directly, that flow is ours and the accessibility commitments on this page apply to it.
                        </li>
                        <li>
                            <strong>Outbound links to boards and agencies.</strong> State board of nursing sites,
                            federal data sources, and certification bodies are third-party sites we cite but do not
                            operate.
                        </li>
                    </ul>
                </Section>

                <Section icon={<MailWarning size={20} />} title="Report a barrier">
                    <p>
                        If any part of {brand.name} stops you from finding a job, applying, or posting a role, email{' '}
                        <a href={`mailto:${brand.email.contact}`} style={linkStyle}>
                            {brand.email.contact}
                        </a>{' '}
                        with the word &quot;accessibility&quot; in the subject. It helps if you can include:
                    </p>
                    <ul style={{ margin: '10px 0 0', paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>the page address where it happened;</li>
                        <li>what you were trying to do;</li>
                        <li>your browser, and your screen reader or other assistive technology if you use one.</li>
                    </ul>
                    <p style={{ marginTop: '12px' }}>
                        We aim to acknowledge accessibility reports within five business days. If a fix will take
                        longer than that, we will tell you what the timeline is — and in the meantime we will get you
                        the information or complete the task with you another way, by email or phone, at no
                        disadvantage to you.
                    </p>
                    <p style={{ marginTop: '10px' }}>
                        If our response does not resolve things, you can escalate to{' '}
                        <a href={`mailto:${brand.email.support}`} style={linkStyle}>
                            {brand.email.support}
                        </a>
                        , which reaches the same team through a monitored operational queue.
                    </p>
                </Section>

                <Section icon={<ShieldCheck size={20} />} title="Standards and related policies">
                    <p style={{ marginBottom: '10px' }}>
                        We measure ourselves against the{' '}
                        <a
                            href="https://www.w3.org/TR/WCAG22/"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={linkStyle}
                        >
                            Web Content Accessibility Guidelines 2.2 <ExternalLink size={12} style={{ display: 'inline', verticalAlign: 'baseline' }} />
                        </a>{' '}
                        at Level AA.
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <Link href="/editorial-policy" style={linkStyle}>
                                Editorial Policy
                            </Link>{' '}
                            — how our content and statistics are produced and sourced.
                        </li>
                        <li>
                            <Link href="/security" style={linkStyle}>
                                Security &amp; Trust
                            </Link>{' '}
                            — how we protect your data.
                        </li>
                        <li>
                            <Link href="/privacy" style={linkStyle}>
                                Privacy Policy
                            </Link>{' '}
                            and{' '}
                            <Link href="/terms" style={linkStyle}>
                                Terms of Service
                            </Link>
                            .
                        </li>
                    </ul>
                </Section>
            </article>
        </div>
    );
}
