'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  STICKY_APPLY_BAR_CLASS,
  STICKY_APPLY_BAR_CLEARANCE_CSS,
  STICKY_APPLY_BAR_HEIGHT_VAR,
  stickyApplyBarClearance,
} from './sticky-apply-bar';

interface StickyApplyBarProps {
  children: ReactNode;
}

/**
 * Mobile-only fixed apply bar for the job-detail page. Measures itself and
 * reserves matching bottom clearance on <body> so the footer's last links are
 * never hidden behind it (see sticky-apply-bar.ts).
 */
export default function StickyApplyBar({ children }: StickyApplyBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;

    const publish = (): void => {
      const value = stickyApplyBarClearance(bar.getBoundingClientRect().height);
      if (value) root.style.setProperty(STICKY_APPLY_BAR_HEIGHT_VAR, value);
      else root.style.removeProperty(STICKY_APPLY_BAR_HEIGHT_VAR);
    };

    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(STICKY_APPLY_BAR_HEIGHT_VAR);
    };
  }, []);

  return (
    <>
      <style>{STICKY_APPLY_BAR_CLEARANCE_CSS}</style>
      <div
        ref={barRef}
        className={`${STICKY_APPLY_BAR_CLASS} lg:hidden fixed bottom-0 inset-x-0 z-[60] shadow-lg safe-bottom`}
        style={{ backgroundColor: '#FFFFFF', borderTop: '1px solid rgba(0,0,0,0.06)' }}
      >
        {children}
      </div>
    </>
  );
}
