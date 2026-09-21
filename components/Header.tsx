'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, LayoutDashboard, Briefcase, MessageSquare, Calculator, DollarSign, Building2, BookOpen, Search, HelpCircle, Info, Mail, MapPin, PenSquare, GraduationCap, UserCheck, Users, Bookmark, FileText, Activity, Workflow, Plus } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
// SEO Fix H5: use LazyMotion + the lightweight `m` namespace instead of the
// full `motion` import. Header renders on every page, so importing the full
// framer-motion namespace bloats every page's JS bundle. LazyMotion ships
// only the animation features used and is the recommended pattern (matches
// HomepageHero.tsx).
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import HeaderAuth from '@/components/auth/HeaderAuth';
import { WORDMARK } from '@/config/niche/copy';
import { brand } from '@/config/brand';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { getMobileMenuMotion } from '@/components/header-nav-motion';

/*
 * Header — Floating claymorphic navbar.
 * Warm diorama palette, pill-shaped, centered nav items.
 */

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  // The mobile menu is role=dialog aria-modal, so it must own keyboard focus:
  // focus moves to its first link on open, Tab / Shift+Tab cycle inside it,
  // Escape closes it, and focus returns to the element that opened it.
  const menuRef = useFocusTrap<HTMLDivElement>({ isOpen: isMenuOpen, onEscape: closeMenu });
  const reduceMotion = useReducedMotion();
  const menuMotion = getMobileMenuMotion(reduceMotion);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Body + html scroll lock + ESC + route-change reset, all in one effect so
  // the cleanup ALWAYS restores whatever overflow values existed before this
  // overlay locked the page. globals.css sets `html { overflow-y: scroll }`,
  // so locking only `body.overflow` lets the html element keep scrolling
  // underneath the menu -- which is the bug the user spotted ("contents are
  // visible and scrollable when the menu is open"). We lock html.overflow
  // too. The previous version blindly wrote `''` on cleanup -- if another
  // overlay had also locked the page, that overlay's lock got stomped when
  // this menu closed during its 0.15s exit animation; we now restore the
  // exact prior values instead.
  useEffect(() => {
    if (!isMenuOpen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = prevBody;
      }
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = prevHtml;
      }
    };
  }, [isMenuOpen]);

  // Focus return fallback. useFocusTrap restores focus to whatever was
  // focused when the menu opened, but browsers that do not focus a button on
  // click (Safari) leave that as <body>. When the menu closes and focus is
  // stranded on <body> or inside the exiting overlay, hand it to the toggle.
  const wasMenuOpen = useRef(false);
  useEffect(() => {
    if (isMenuOpen) {
      wasMenuOpen.current = true;
      return;
    }
    if (!wasMenuOpen.current) return;
    wasMenuOpen.current = false;
    const id = window.setTimeout(() => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || !!document.getElementById('mobile-nav-menu')?.contains(active);
      if (stranded) toggleRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isMenuOpen]);

  useEffect(() => {
    // Don't touch body.style.overflow here -- the [isMenuOpen] effect's
    // cleanup handles that, and writing '' here can race with that cleanup
    // if the user navigates during the drawer's exit animation.
    // Deferred a tick: closing the drawer one macrotask after the route
    // commit avoids a cascading synchronous re-render; on first mount the
    // initial state (closed) already matches, so the deferred set is a no-op.
    const close = setTimeout(() => setIsMenuOpen(false), 0);
    return () => clearTimeout(close);
  }, [pathname]);

  // Public nav — shown when NOT logged in
  const publicNavLinks = [
    { href: '/jobs', label: 'Browse Jobs', icon: Search },
    { href: '/salary-guide', label: 'Salary Guide', icon: DollarSign },
    { href: '/for-employers', label: 'Employers', icon: Building2 },
    { href: '/resources', label: 'Resources', icon: BookOpen },
  ];

  // Logged-in job seeker nav — high-frequency destinations only.
  // Settings is accessible from the avatar dropdown; freeing the slot for
  // Saved (a daily quick-check action) is the better UX trade.
  const seekerNavLinks = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/jobs', label: 'Browse Jobs', icon: Briefcase },
    { href: '/saved', label: 'Saved', icon: Bookmark },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
  ];

  // Logged-in employer nav — high-frequency destinations only.
  // Applicants gets its own dedicated route (not a dashboard tab) so the
  // nav navigation feels like a destination, not a tab switch inside the
  // dashboard. The dashboard still has an Applicants tab for in-context
  // viewing alongside other dashboard data.
  const employerNavLinks = [
    { href: '/employer/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/employer/candidates', label: 'Talent Pool', icon: Users },
    { href: '/employer/applicants', label: 'Applicants', icon: FileText },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
  ];

  // Logged-in admin nav — admin-specific surfaces beat the public Browse
  // Jobs / Messages defaults that admins rarely use day-to-day.
  const adminNavLinks = [
    { href: '/admin', label: 'Admin', icon: LayoutDashboard },
    { href: '/admin/jobs', label: 'Jobs', icon: Briefcase },
    { href: '/admin/outreach', label: 'Outreach', icon: Activity },
    { href: '/admin/pipeline', label: 'Pipeline', icon: Workflow },
  ];

  // Mobile-only extra links for public users (pages not in top nav).
  //
  // P2 #11/#12: the employer directory and the location hub were footer-only —
  // no entry point at all on mobile, where the footer is a long scroll away.
  // They are promoted here rather than into the top nav on purpose: the desktop
  // pill row already carries an "Employers" item pointing at /for-employers
  // (the B2B post-a-job surface), and a second employer-shaped pill next to it
  // reads as a duplicate to a job seeker. This slot is the honest promotion.
  const mobileExtraLinks = [
    { href: '/tools', label: 'Free Tools', icon: Calculator },
    { href: '/companies', label: 'Browse Companies', icon: Building2 },
    { href: '/jobs/locations', label: 'Jobs by Location', icon: MapPin },
    { href: '/for-job-seekers', label: 'For Job Seekers', icon: UserCheck },
    { href: '/new-grad', label: 'New Grad Guide', icon: GraduationCap },
    { href: '/blog', label: 'Blog', icon: PenSquare },
    { href: '/faq', label: 'FAQ', icon: HelpCircle },
    { href: '/about', label: 'About', icon: Info },
    { href: '/contact', label: 'Contact', icon: Mail },
  ];

  // Pick the right nav set
  const navLinks = userRole === 'job_seeker'
    ? seekerNavLinks
    : userRole === 'employer'
      ? employerNavLinks
      : userRole === 'admin'
        ? adminNavLinks
        : publicNavLinks;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // Hide header on auth pages — they have their own branding
  const AUTH_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password', '/employer/login', '/employer/signup'];
  if (AUTH_ROUTES.some(r => pathname?.startsWith(r))) return null;

  return (
    <LazyMotion features={domAnimation}>
      {/* Spacer — pushes page content down past the position:fixed nav.
          Total nav footprint = 18px top + 64px nav pill + 18px bottom = 100px.
          The strip is now symmetric (was 12/0) so the floating nav reads as
          vertically centered inside its background panel instead of flush
          against the bottom edge. (Floating mint pill — owner direction 2026-09-12: gutters on top,
          left and right, no max-width cap. The hero pulls up under it by 80.) */}
      <div style={{ height: 100 }} />

      {/* Floating navbar wrapper. Solid background matching the page bg so
          the padding strip above + below + on the sides of the visible nav
          pill stays opaque when the page scrolls — without it, content slips
          up through the transparent strip and renders behind the nav.
          pointer-events: none stays on the wrapper so clicks pass through to
          the page below the nav. */}
      <div
        className="fixed top-0 left-0 right-0 z-[100]"
        style={{
          padding: '18px 16px',
          pointerEvents: 'none',
          background: '#F5F0EB',
        }}
      >
        <header
          className="transition-all duration-300"
          style={{
            // Responsive cap — held at 1360px on viewports ≤ ~1448px (no
            // change vs. the previous fixed value), then scales with the
            // viewport up to a ceiling of 1680px on very wide screens.
            // Wrapper padding (16px each side) still bounds it on narrow.
            // Floating mint pill (owner direction 2026-09-12): spans the full width
            // minus the wrapper's 16px side gutters — no max-width cap.
            maxWidth: 'none',
            width: '100%',
            height: 64,
            borderRadius: '18px',
            backgroundColor: '#D5F5F1',
            border: '1px solid rgba(122,28,43,0.12)',
            boxShadow: scrolled
              ? '0 8px 32px rgba(90,74,66,0.14), 0 2px 8px rgba(90,74,66,0.06), inset 0 1px 0 rgba(255,255,255,0.7)'
              : '0 4px 20px rgba(90,74,66,0.10), 0 1px 4px rgba(90,74,66,0.04), inset 0 1px 0 rgba(255,255,255,0.7)',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 'clamp(12px, 2vw, 32px)',
            paddingRight: 'clamp(12px, 2vw, 32px)',
            pointerEvents: 'auto',
            transition: 'box-shadow 0.3s ease, transform 0.3s ease',
          }}
          suppressHydrationWarning
        >
          {/* ═══ LEFT: Logo ═══ */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mobile hamburger.
                SEO Fix M8: padding bumped 7px → 12px so the button hits a
                44×44px tap target (Apple HIG / Google ≥48 informal).
                With the 20px icon: 12px*2 + 20 = 44px. */}
            <button
              ref={toggleRef}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="lg:hidden transition-all"
              data-icon-btn
              style={{
                padding: '12px',
                borderRadius: '10px',
                color: '#5A4A42',
                backgroundColor: '#B9EBD6',
                border: '1px solid rgba(255,255,255,0.5)',
                boxShadow: '3px 3px 8px rgba(90,74,66,0.08), -2px -2px 5px rgba(255,255,255,0.7), inset 1px 1px 2px rgba(255,255,255,0.6)',
                cursor: 'pointer',
              }}
              aria-label="Toggle menu"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav-menu"
            >
              {isMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>

            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              {/* SEO Fix L8: next/image automatically picks the right format
                  (avif/webp), generates a srcset, and sets fetchpriority on
                  the LCP-relevant header logo. priority=true since this is
                  above the fold on every page. */}
              <Image
                src="/logo.png"
                alt={brand.name}
                width={56}
                height={56}
                priority
                // Without `sizes`, next/image defaults to 100vw and the browser
                // downloads a 1080px+ srcset candidate for a 56px logo on every
                // page. `56px` lets it pick the smallest matching candidate.
                sizes="56px"
                style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }}
              />
              <span
                className="font-heading hidden sm:inline"
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#3D2E24',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                  marginLeft: '-6px',
                }}
              >
                {WORDMARK.primary}{' '}
                <span style={{ fontStyle: 'italic', color: '#BE185D', fontWeight: 600 }}>{WORDMARK.accent}</span>
              </span>
            </Link>
          </div>

          {/* ═══ CENTER: Nav ═══ */}
          <nav className="hidden lg:flex items-center justify-center flex-1 gap-1 mx-4">
            {navLinks.map((link) => {
              const NavIcon = link.icon;
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="nav-pill-floating"
                  aria-current={active ? 'page' : undefined}
                >
                  <NavIcon size={15} style={{ opacity: 0.85 }} />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* ═══ Page-owned slot ═══
              app/jobs/JobsPageClient.tsx portals its "Create alert" button in
              here (owner direction 2026-09-12: the control lives in the nav
              bar). Empty everywhere else; the page keeps the modal, the
              filter prefill and the "only when filters are active" rule. */}
          <div id="nav-alert-slot" className="flex items-center ml-auto lg:ml-0 mr-2 lg:mr-0" />

{/* ═══ RIGHT: Auth ═══ */}
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            {userRole === 'employer' && <PostJobCTA />}
            <HeaderAuth onRoleChange={(role) => setUserRole(role)} />
          </div>

          {/* Mobile right side - just auth (hamburger is on left) */}
          <div className="lg:hidden flex items-center gap-2">
            {userRole === 'employer' && <PostJobCTA mobile />}
            <HeaderAuth onRoleChange={(role) => setUserRole(role)} />
          </div>
        </header>
      </div>

      {/* ═══ Mobile Menu ═══ */}
      <AnimatePresence>
        {isMenuOpen && (
          <m.div
            id="mobile-nav-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation menu"
            ref={menuRef}
            initial={menuMotion.initial}
            animate={menuMotion.animate}
            exit={menuMotion.exit}
            transition={menuMotion.transition}
            className="fixed inset-0 z-[99] lg:hidden"
            style={{ top: 100 }}
          >
            <div
              // Fully opaque (1.0) -- 0.98 let the page content bleed through
              // visibly underneath the menu, which combined with the scroll
              // lock bug made the menu feel see-through.
              className="absolute inset-0"
              style={{ backgroundColor: '#F5F0EB' }}
              onClick={() => setIsMenuOpen(false)}
            />
            {/* Scroll container. The overlay itself is `position: fixed` and
                the [isMenuOpen] effect locks BOTH html.overflow and
                body.overflow, so anything taller than the fixed box paints
                outside it and is unreachable — no page scroll to chase it
                with. Promoting three links into `mobileExtraLinks` pushed the
                signed-out Login / Sign up block past the bottom edge at
                375x812. `.mobile-menu-scroll` caps this container at the
                overlay's own height and lets it scroll instead. */}
            <div className="relative px-6 pt-4 pb-8 mobile-menu-scroll">
              <nav className="flex flex-col">
                {navLinks.map((link) => {
                  const MobileIcon = link.icon;
                  const active = isActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsMenuOpen(false)}
                      style={{
                        padding: '14px 16px',
                        fontSize: '16px',
                        fontWeight: active ? 600 : 500,
                        color: active ? '#BE185D' : '#5A4A42',
                        backgroundColor: active ? 'rgba(190,24,93,0.08)' : 'transparent',
                        borderRadius: '14px',
                        marginBottom: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        textDecoration: 'none',
                        transition: 'all 0.15s',
                      }}
                    >
                      <MobileIcon size={20} style={{ opacity: 0.75 }} />
                      {link.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Extra links for public mobile users */}
              {!userRole && (
                <div className="mt-3 pt-4" style={{ borderTop: '1px solid rgba(90,74,66,0.08)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3 px-4" style={{ color: '#A89890' }}>More</p>
                  <nav className="flex flex-col">
                    {mobileExtraLinks.map((link) => {
                      const ExtraIcon = link.icon;
                      const active = isActive(link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setIsMenuOpen(false)}
                          style={{
                            padding: '12px 16px',
                            fontSize: '15px',
                            fontWeight: active ? 600 : 400,
                            color: active ? '#BE185D' : '#7A6A62',
                            backgroundColor: active ? 'rgba(190,24,93,0.06)' : 'transparent',
                            borderRadius: '12px',
                            marginBottom: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            textDecoration: 'none',
                            transition: 'all 0.15s',
                          }}
                        >
                          <ExtraIcon size={18} style={{ opacity: 0.65 }} />
                          {link.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              )}
              {/* Auth section — only render when signed OUT, where it shows
                  Login + Sign up CTAs that complement the link list. When
                  signed IN, this would duplicate the bell + avatar that's
                  already visible in the top header strip behind the menu. */}
              {!userRole && (
                <div className="mt-6 pt-5 px-4" style={{ borderTop: '1px solid rgba(90,74,66,0.08)' }}>
                  <HeaderAuth onNavigate={() => setIsMenuOpen(false)} onRoleChange={(role) => setUserRole(role)} />
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Floating nav hover styles */}
      <style>{`
        /* Desktop nav pills. Every state lives here rather than in inline
           styles set from mouse handlers: an inline box-shadow beats any
           stylesheet rule, which erased the keyboard focus ring. The ring is
           an outline so it never competes with the pill's own shadows. */
        .nav-pill-floating {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
          border-radius: 12px;
          font-size: 13.5px;
          font-weight: 500;
          color: #5A4A42;
          background-color: transparent;
          border: 1px solid transparent;
          box-shadow: none;
          text-decoration: none;
          white-space: nowrap;
          transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }
        .nav-pill-floating:hover:not([aria-current="page"]) {
          background-color: #B9EBD6;
          color: #5A4A42;
          border-color: rgba(255,255,255,0.5);
          box-shadow: 3px 3px 8px rgba(90,74,66,0.10), -2px -2px 5px rgba(255,255,255,0.7), inset 1px 1px 3px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02);
          transform: translateY(-1px);
        }
        .nav-pill-floating[aria-current="page"] {
          font-weight: 600;
          color: #9D174D;
          background-color: rgba(190,24,93,0.10);
          border-color: rgba(190,24,93,0.15);
          box-shadow: inset 1px 1px 3px rgba(190,24,93,0.06), 2px 2px 6px rgba(190,24,93,0.06);
        }
        .nav-pill-floating:focus-visible {
          outline: 2px solid #BE185D;
          outline-offset: 2px;
        }
        .nav-pill-floating:active {
          transform: translateY(0) scale(0.98) !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .nav-pill-floating { transition: none; }
          .nav-pill-floating:hover:not([aria-current="page"]) { transform: none; }
        }
        /* Mobile menu scroll container. 100px == the fixed overlay's top
           offset (the nav footprint), so the cap matches the visible box.
           The vh line is the fallback for engines without dvh; the dvh line
           wins where supported and is the one that matters on iOS Safari,
           whose visible viewport shrinks under the URL bar. overscroll-behavior
           keeps the rubber-band from chaining to the locked page behind. */
        /* "Create alert" (portaled from /jobs): icon-only below the desktop nav
           breakpoint so it fits beside the auth controls. The 26px bell pebble
           plus padding and border comes to 42px, so a 44px floor keeps the
           icon-only control at the touch minimum (content stays centered). */
        @media (max-width: 1023px) {
          #nav-alert-slot .jp-alert-btn .jp-alert-label { display: none; }
          #nav-alert-slot .jp-alert-btn {
            padding: 7px 9px !important;
            min-height: 44px;
            min-width: 44px;
            justify-content: center;
          }
        }

        .mobile-menu-scroll {
          max-height: calc(100vh - 100px);
          max-height: calc(100dvh - 100px);
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
      `}</style>
    </LazyMotion>
  );
}

/**
 * Primary employer CTA — `+ Post Job`. Filled-pill, branded primary color,
 * visually distinct from the ghost-style nav pills next to it. Surfaces the
 * employer's #1 money action from every page in one tap.
 */
function PostJobCTA({ mobile = false }: { mobile?: boolean }) {
  return (
    <Link
      href="/post-job"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: mobile ? '7px 12px' : '8px 16px',
        borderRadius: '12px',
        fontSize: mobile ? '13px' : '13.5px',
        fontWeight: 700,
        color: '#FFFFFF',
        background: 'linear-gradient(135deg, #BE185D, #9D174D)',
        border: '1px solid rgba(255,255,255,0.25)',
        boxShadow: '0 2px 8px rgba(190,24,93,0.25), inset 0 1px 0 rgba(255,255,255,0.2)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(190,24,93,0.35), inset 0 1px 0 rgba(255,255,255,0.25)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(190,24,93,0.25), inset 0 1px 0 rgba(255,255,255,0.2)';
      }}
      aria-label="Post a new job"
    >
      <Plus size={mobile ? 14 : 15} strokeWidth={2.5} />
      {mobile ? 'Post' : 'Post Job'}
    </Link>
  );
}
