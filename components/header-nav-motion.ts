/**
 * Motion presets for the homepage hero, with a reduced-motion variant.
 *
 * The header's phone menu used to take its fade from here too; since the
 * phone restructure (2026-11-27) the header and its menu use no animation
 * library at all (components/PhoneMenu.tsx animates in plain CSS, which
 * prefers-reduced-motion turns off), so only the hero preset is left.
 *
 * Under prefers-reduced-motion every transition collapses to duration 0 with
 * no delay or stagger. framer-motion treats a zero-duration, zero-delay
 * transition as "skip": it writes the final keyframe on the next frame and
 * never creates a tween or a Web Animation, so the element snaps to its
 * resting state (WCAG 2.3.3) while SSR markup and hydration stay identical.
 */
import type { Transition, Variants } from 'framer-motion';

type Cubic = [number, number, number, number];

const HERO_EASE: Cubic = [0.25, 0.46, 0.45, 0.94];
const HERO_STAGGER_S = 0.08;
const HERO_DELAY_CHILDREN_S = 0.1;
const HERO_FADE_S = 0.4;
const HERO_RISE_PX = 12;

const INSTANT: Transition = { duration: 0, delay: 0 };

export interface HeroVariants {
    container: Variants;
    fadeUp: Variants;
}

/** Stagger container + fade-up child variants for HomepageHero. */
export function getHeroVariants(reduceMotion: boolean | null): HeroVariants {
    if (reduceMotion) {
        return {
            container: {
                hidden: {},
                show: { transition: { staggerChildren: 0, delayChildren: 0 } },
            },
            fadeUp: {
                hidden: { opacity: 0, y: HERO_RISE_PX },
                show: { opacity: 1, y: 0, transition: INSTANT },
            },
        };
    }
    return {
        container: {
            hidden: {},
            show: { transition: { staggerChildren: HERO_STAGGER_S, delayChildren: HERO_DELAY_CHILDREN_S } },
        },
        fadeUp: {
            hidden: { opacity: 0, y: HERO_RISE_PX },
            show: { opacity: 1, y: 0, transition: { duration: HERO_FADE_S, ease: HERO_EASE } },
        },
    };
}
