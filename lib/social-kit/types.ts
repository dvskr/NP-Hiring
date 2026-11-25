/**
 * The job fields the social kit reads. A structural subset of the Prisma
 * Job row plus the employer's website from EmployerJob, so the admin page
 * can pass query results straight in and tests can build plain objects.
 */
export interface SocialKitJob {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly employer: string
  readonly location: string
  readonly city: string | null
  readonly state: string | null
  readonly stateCode: string | null
  readonly country: string | null
  readonly isRemote: boolean
  readonly isHybrid: boolean
  readonly mode: string | null
  readonly jobType: string | null
  readonly salaryPeriod: string | null
  readonly minSalary: number | null
  readonly maxSalary: number | null
  readonly salaryIsEstimated: boolean
  readonly salaryConfidence: number | null
  readonly experienceLabel: string | null
  readonly minYearsExperience: number | null
  readonly maxYearsExperience: number | null
  readonly newGradFriendly: boolean
  readonly setting: string | null
  readonly population: string | null
  readonly benefits: readonly string[]
  readonly description: string
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly companyWebsite: string | null
}

export type SocialPlatform = 'linkedin' | 'facebook' | 'reddit' | 'x' | 'forum'

/** One copyable piece of a post: a Reddit title, a body, an X reply. */
export interface PostPart {
  readonly label: string
  readonly text: string
  /** The platform's cap for this part, or null when it has none worth showing. */
  readonly limit: number | null
  /** Length as the platform counts it (X counts every link as 23). */
  readonly length: number
}

export interface SocialPost {
  readonly platform: SocialPlatform
  readonly label: string
  /** The tracked short link this post carries. */
  readonly link: string
  /** The /r/ code inside that link, to match click counts back to the post. */
  readonly code: string
  readonly parts: readonly PostPart[]
  /** True when the description was cut to fit the platform's limit. */
  readonly trimmed: boolean
}

export interface SocialKitEntry {
  readonly id: string
  readonly title: string
  readonly employer: string
  readonly jobUrl: string
  readonly companyWebsite: string | null
  readonly postedAt: string
  readonly expiresAt: string | null
  readonly isNew: boolean
  readonly facts: readonly { readonly label: string; readonly value: string }[]
  readonly descriptionText: string
  readonly posts: readonly SocialPost[]
}
