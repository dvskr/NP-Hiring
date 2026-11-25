/**
 * Public surface of the short-link subsystem.
 *
 * Consumers should import from `@/lib/shortlinks` only; the file-level
 * splits are internal implementation seams.
 */

export type {
  CampaignJob,
  ShortlinkCampaign,
  ShortlinkResolution,
  BotIdentification,
} from './types'

export {
  PLATFORM_BY_LETTER,
  KNOWN_PLATFORM_LETTERS,
  BOARD_CAMPAIGN,
  ACTIVE_CAMPAIGN,
  JOB_LINKS_CAMPAIGN,
} from './campaigns'

export { parseJobLinkCode, jobLinkPath, resolveJobLink } from './job-links'
export type { JobLinkCode } from './job-links'

export { resolveShortlink } from './resolver'
export { identifyBot } from './bots'
export { recordClick, hashIp } from './tracker'
export type { RecordClickInput } from './tracker'
