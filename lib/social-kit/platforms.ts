import { brand } from '@/config/brand'
import type { SocialPlatform } from './types'

/**
 * The kit's platforms: their /r/ letter (lib/shortlinks/campaigns.ts
 * PLATFORM_BY_LETTER) and the name the page shows. Data only, so the page's
 * client components and the server-side post builder read the same names.
 */

export const PLATFORM_LETTER: Readonly<Record<SocialPlatform, string>> = Object.freeze({
  linkedin: 'l',
  facebook: 'f',
  reddit: 'r',
  x: 'x',
  forum: 'n',
})

/** "NP forums": the forums and communities where the board's audience talks shop. */
export const FORUM_LABEL = `${brand.niche.short} forums`

export const PLATFORM_LABEL: Readonly<Record<SocialPlatform, string>> = Object.freeze({
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  reddit: 'Reddit',
  x: 'X',
  forum: FORUM_LABEL,
})

/** What the post log's "Where" box suggests for each platform. */
export const VENUE_HINT: Readonly<Record<SocialPlatform, string>> = Object.freeze({
  linkedin: 'Company page or group',
  facebook: 'Group or page name',
  reddit: 'r/subreddit',
  x: 'Account',
  forum: `Forum or community name, e.g. a ${brand.niche.descriptor} group`,
})
