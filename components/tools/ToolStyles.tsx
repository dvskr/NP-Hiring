/**
 * Style carrier for the tool widgets.
 *
 * WHY THIS EXISTS
 * The tool controls are styled with inline objects (controlStyle/selectStyle),
 * but a focus ring cannot be expressed inline — it needs a :focus-visible
 * rule. That rule used to be injected only by the four app/tools/**\/page.tsx
 * routes, which was fine until EmployerBenchmarkPicker was embedded on
 * /for-employers: there the controls were focusable with no visible focus
 * state at all (WCAG 2.4.7), and the .tool-two-col grid never collapsed on
 * mobile.
 *
 * So the widgets carry their own CSS. Every tool component that renders a
 * .tool-control or .tool-two-col must render <ToolStyles /> too, and
 * tests/regressions/p2-tools-calculators-routes.test.ts enforces that. Host
 * pages then need to know nothing about tool styling.
 *
 * Rendering it more than once on a page is harmless — the rules are identical
 * and idempotent.
 */
import { TOOL_CONTROL_CSS } from './tool-theme';

export default function ToolStyles() {
  return <style>{TOOL_CONTROL_CSS}</style>;
}
