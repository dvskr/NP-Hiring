'use client';

import Link from 'next/link';
import Image from 'next/image';
import { DollarSign, Building2, BookOpen, Search, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import HeaderAuth from '@/components/auth/HeaderAuth';
import PhoneMenu from '@/components/PhoneMenu';
import { WORDMARK } from '@/config/niche/copy';
import { brand } from '@/config/brand';
import { roleLinks } from '@/lib/nav/role-links';

/*
 * Header: floating pill navbar, centered nav items.
 *
 * Palette: option B "soft blush" (owner decision 5, 2026-09-29), replacing the
 * mint bar. Bar #FCEEF0 with a berry hairline rgba(122,28,43,0.15) and a soft
 * berry shadow; menu text #3D2A2E; hover tint rgba(190,24,93,0.08) with text
 * #7A1C2B; current page #7A1C2B on rgba(190,24,93,0.12); focus ring #BE185D.
 * The neumorphic white inset highlights went with the mint. Contrast against
 * the bar and the tints is pinned in tests/regressions/header-soft-blush.test.ts.
 *
 * On a phone (below 1024 pixels) the bar holds the logo and the board's name
 * on the left and the phone menu's round button on the right, on every page
 * (components/PhoneMenu.tsx, the phone restructure the owner approved on
 * 2026-11-27): the same button and the same menu everywhere. Sign in, Sign up
 * and the account control live in that menu, so the bar never crowds. The
 * one exception is the jobs page's own Create Alert control, which it places
 * in #nav-alert-slot beside the button while filters are active.
 */

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Public nav — shown when NOT logged in
  const publicNavLinks = [
    { href: '/jobs', label: 'Browse Jobs', icon: Search },
    { href: '/salary-guide', label: 'Salary Guide', icon: DollarSign },
    { href: '/for-employers', label: 'Employers', icon: Building2 },
    { href: '/resources', label: 'Resources', icon: BookOpen },
  ];

  // A signed-in visitor's own links (lib/nav/role-links.ts), the same list
  // the phone menu opens with; the public links otherwise.
  const navLinks = roleLinks(userRole) ?? publicNavLinks;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // Hide header on auth pages — they have their own branding
  const AUTH_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password', '/employer/login', '/employer/signup'];
  if (AUTH_ROUTES.some(r => pathname?.startsWith(r))) return null;

  return (
    <>
      {/* Spacer — pushes page content down past the position:fixed nav.
          Total nav footprint = 18px top + 64px nav pill + 18px bottom = 100px.
          The strip is now symmetric (was 12/0) so the floating nav reads as
          vertically centered inside its background panel instead of flush
          against the bottom edge. (Floating pill, owner direction 2026-09-12: gutters on top,
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
            // Floating pill (owner direction 2026-09-12): spans the full width
            // minus the wrapper's 16px side gutters, no max-width cap.
            // Soft blush (owner decision 5): the resting shadow is the one the
            // owner picked; once the page scrolls it deepens in the same hue so
            // the bar still lifts off the content sliding under it.
            maxWidth: 'none',
            width: '100%',
            height: 64,
            borderRadius: '18px',
            backgroundColor: '#FCEEF0',
            border: '1px solid rgba(122,28,43,0.15)',
            boxShadow: scrolled
              ? '0 10px 30px rgba(122,28,43,0.12), 0 2px 6px rgba(90,74,66,0.06)'
              : '0 6px 22px rgba(122,28,43,0.08), 0 1px 3px rgba(90,74,66,0.05)',
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
              quality={90} />
              {/* The board's name shows on a phone too, a little smaller on
                  the narrowest screens (the .hdr-word rule below), so the bar
                  stays one row beside the menu button. */}
              <span
                className="font-heading hdr-word"
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
              filter prefill and the "only when filters are active" rule. On a
              phone it sits just left of the menu button: its auto margin
              pushes both to the right end of the bar. */}
          <div id="nav-alert-slot" className="flex items-center ml-auto lg:ml-0 mr-2 lg:mr-0" />

          {/* ═══ RIGHT: Auth ═══
              Mounted at every width, so on a phone too it finds out who is
              signed in and tells the phone menu and the bottom bar
              (lib/auth-role-store.ts); it shows from 1024 pixels up. */}
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            {userRole === 'employer' && <PostJobCTA />}
            <HeaderAuth onRoleChange={(role) => setUserRole(role)} />
          </div>

          {/* Phone: the menu's round button at the right end of the bar, on
              every page. Sign in, the account control and Post a Job are in
              the menu. */}
          <PhoneMenu className="lg:hidden" />
        </header>
      </div>

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
          color: #3D2A2E;
          background-color: transparent;
          border: 1px solid transparent;
          box-shadow: none;
          text-decoration: none;
          white-space: nowrap;
          transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }
        .nav-pill-floating:hover:not([aria-current="page"]) {
          background-color: rgba(190,24,93,0.08);
          color: #7A1C2B;
        }
        .nav-pill-floating[aria-current="page"] {
          font-weight: 600;
          color: #7A1C2B;
          background-color: rgba(190,24,93,0.12);
        }
        .nav-pill-floating:focus-visible {
          outline: 2px solid #BE185D;
          outline-offset: 2px;
        }
        .nav-pill-floating:active {
          transform: scale(0.98);
        }
        /* Employer "Post Job" CTA: the same solid berry as Sign up. Every
           state lives here, not in inline styles or mouse handlers, because
           an inline box-shadow beats the global :focus-visible ring. */
        .header-post-job {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 12px;
          font-size: 13.5px;
          font-weight: 700;
          color: #FFFFFF;
          background-color: #9D174D;
          border: 1px solid #9D174D;
          box-shadow: 0 4px 12px rgba(157,23,77,0.25);
          text-decoration: none;
          white-space: nowrap;
          transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        .header-post-job:hover {
          background-color: #831843;
          border-color: #831843;
          box-shadow: 0 6px 16px rgba(157,23,77,0.30);
          transform: translateY(-1px);
        }
        .header-post-job:focus-visible {
          outline: 2px solid #BE185D;
          outline-offset: 2px;
        }
        .header-post-job:active {
          transform: scale(0.98);
        }
        @media (prefers-reduced-motion: reduce) {
          .nav-pill-floating,
          .header-post-job { transition: none; }
          .nav-pill-floating:active,
          .header-post-job:hover,
          .header-post-job:active { transform: none; }
        }
        /* "Create alert" (portaled from /jobs): icon-only below the desktop nav
           breakpoint so it fits beside the menu button. The 26px bell pebble
           plus padding and border comes to 42px, so a 44px floor keeps the
           icon-only control at the touch minimum (content stays centered).
           The board's name beside the logo keeps its 20 pixels where the
           screen allows and shrinks on the narrowest phones, so the bar stays
           on one row. */
        @media (max-width: 1023px) {
          #nav-alert-slot .jp-alert-btn .jp-alert-label { display: none; }
          #nav-alert-slot .jp-alert-btn {
            padding: 7px 9px !important;
            min-height: 44px;
            min-width: 44px;
            justify-content: center;
          }
          .hdr-word { font-size: clamp(16px, 5.4vw, 20px) !important; }
        }
      `}</style>
    </>
  );
}

/**
 * Primary employer CTA, `+ Post Job`, in the desktop bar. A solid berry pill
 * (the same fill as Sign up), visually distinct from the ghost-style nav pills
 * next to it. Surfaces the employer's main money action from every page in
 * one tap; on a phone the menu's Post a Job button does the same. Styled by
 * the .header-post-job rules in Header's stylesheet so hover never writes an
 * inline box-shadow over the keyboard focus ring.
 */
function PostJobCTA() {
  return (
    <Link
      href="/post-job"
      className="header-post-job"
      aria-label="Post a new job"
    >
      <Plus size={15} strokeWidth={2.5} />
      Post Job
    </Link>
  );
}
