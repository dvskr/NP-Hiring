/**
 * The phone menu's look (components/PhoneMenu.tsx), in the header's own soft
 * blush palette (components/Header.tsx, owner decision 5): the card wears the
 * bar's fill #FCEEF0 with its berry hairline and shadow, rows are set in the
 * bar's ink #3D2A2E, and the page on screen takes the desktop pills' current
 * look, #7A1C2B on the rgba(190,24,93,0.12) tint. Post a Job is the solid
 * berry #9D174D of Sign up and the desktop Post Job button; the focus ring is
 * the header's #BE185D outline. Every text colour clears 4.5:1 on its ground
 * (tests/regressions/header-soft-blush.test.ts).
 *
 * Every state lives in this stylesheet rather than in inline styles, as in
 * the header: an inline box-shadow would beat the keyboard focus ring.
 *
 * The card sits just under the bar (the bar's footprint is 100 pixels: 18 +
 * 64 + 18) and ends above the bottom bar, whose height BottomNav publishes as
 * --bottom-nav-h. The page under the open menu is locked, so the card scrolls
 * itself and its last rows stay reachable on a short screen: the vh cap is
 * the fallback, the dvh cap wins where supported (iOS Safari's visible
 * viewport shrinks under the address bar).
 *
 * Static CSS, no interpolation: a plain style element, not styled-jsx.
 */
export const PHONE_MENU_CSS = `
.phone-menu-button {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  color: #3D2A2E;
  background-color: #FFFFFF;
  border: 1px solid rgba(122,28,43,0.15);
  cursor: pointer;
}
.phone-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 98;
  background-color: rgba(61,42,46,0.10);
  animation: phone-menu-fade 0.16s ease-out;
}
.phone-menu-card {
  position: fixed;
  z-index: 99;
  top: 100px;
  left: max(16px, env(safe-area-inset-left, 0px));
  right: max(16px, env(safe-area-inset-right, 0px));
  max-height: calc(100vh - 116px - var(--bottom-nav-h, 0px));
  max-height: calc(100dvh - 116px - var(--bottom-nav-h, 0px));
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 18px 16px 14px;
  border-radius: 18px;
  background-color: #FCEEF0;
  border: 1px solid rgba(122,28,43,0.15);
  box-shadow: 0 10px 30px rgba(122,28,43,0.12), 0 2px 6px rgba(90,74,66,0.06);
  animation: phone-menu-in 0.16s ease-out;
}
.phone-menu-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 6px;
}
.phone-menu-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  text-align: center;
  text-decoration: none;
}
.phone-menu-browse {
  color: #FFFFFF;
  background-color: #3D2A2E;
}
.phone-menu-post {
  color: #FFFFFF;
  background-color: #9D174D;
  box-shadow: 0 4px 12px rgba(157,23,77,0.25);
}
.phone-menu-label {
  margin: 14px 4px 4px;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7A1C2B;
}
.phone-menu-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  color: #3D2A2E;
  background-color: transparent;
}
.phone-menu-link[aria-current="page"] {
  color: #7A1C2B;
  background-color: rgba(190,24,93,0.12);
}
.phone-menu-chevron {
  flex-shrink: 0;
  color: #7A1C2B;
}
.phone-menu-account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(122,28,43,0.10);
}
.phone-menu-create {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  color: #3D2A2E;
  background-color: transparent;
  border: 2px solid #3D2A2E;
}
.phone-menu-small {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 10px 0 0;
}
.phone-menu-small-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  color: #6B5B53;
}
.phone-menu-button:focus-visible,
.phone-menu-card a:focus-visible,
.phone-menu-card button:focus-visible {
  outline: 2px solid #BE185D;
  outline-offset: 2px;
}
@keyframes phone-menu-in {
  from { opacity: 0; transform: translateY(-6px); }
}
@keyframes phone-menu-fade {
  from { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .phone-menu-card,
  .phone-menu-backdrop { animation: none; }
}
`;
