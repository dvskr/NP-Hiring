import { z } from 'zod';
import { EXPERIENCE_BUCKETS } from '@/lib/experience-label';

export const FREE_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'ymail.com', 'live.com', 'msn.com', 'googlemail.com'];

export const WORK_MODE_REQUIRED_MESSAGE = 'Please select a work mode';
export const JOB_TYPE_REQUIRED_MESSAGE = 'Please select a job type';
export const EXPERIENCE_REQUIRED_MESSAGE = 'Please select an experience level';

/** Visible text length of Quill HTML (markup stripped), matching the UI counter. */
const visibleLength = (html: string): number => html.replace(/<[^>]*>/g, '').length;

export const jobPostingSchema = z.object({
  title: z.string().min(10, 'Job title must be at least 10 characters'),
  companyName: z.string().min(1, 'Company name is required'),
  companyWebsite: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  contactEmail: z.string().email('Must be a valid email address').refine(
    (email) => {
      const domain = email.toLowerCase().split('@')[1];
      return !FREE_EMAIL_DOMAINS.includes(domain);
    },
    { message: 'Please use your company email (not Gmail, Yahoo, etc.)' }
  ),
  location: z.string({ error: 'Location is required' }).min(1, 'Location is required'),
  // An unpicked radio group arrives as undefined or null. Zod's default
  // issue text for that ("Invalid option: expected one of ...") is not
  // copy an employer should read, so every issue on these fields carries
  // the human message.
  mode: z.enum(['Remote', 'Hybrid', 'In-Person'], { error: WORK_MODE_REQUIRED_MESSAGE }),
  jobType: z.enum(['Full-Time', 'Part-Time', 'Contract', 'Per Diem'], { error: JOB_TYPE_REQUIRED_MESSAGE }),
  salaryPeriod: z.enum(['hourly', 'weekly', 'monthly', 'annual']).optional(),
  salaryMin: z.number().positive('Minimum salary must be a positive number').optional().nullable(),
  salaryMax: z.number().positive('Maximum salary must be a positive number').optional().nullable(),
  salaryCompetitive: z.boolean().optional(),
  // Validation operates on visible-text length (HTML stripped) to match the
  // character counter shown in the UI.
  description: z.string()
    .refine((html) => visibleLength(html) >= 200, { message: 'Job description must be at least 200 characters' })
    .refine((html) => visibleLength(html) <= 25000, { message: 'Job description cannot exceed 25,000 characters' }),
  applyUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  applyOnPlatform: z.boolean().optional(),
  pricingTier: z.enum(['pro']),
  benefits: z.array(z.string()).optional(),
  specialty: z.string().optional(),
  setting: z.string().optional(),
  population: z.string().optional(),
  companyLogoUrl: z.string().optional(),
  // Experience requirements: the picker is required. minYearsExperience must
  // match one of the EXPERIENCE_BUCKETS values; maxYearsExperience comes from
  // the same table (paired with the picked min).
  minYearsExperience: z
    .number({ error: EXPERIENCE_REQUIRED_MESSAGE })
    .int({ error: EXPERIENCE_REQUIRED_MESSAGE })
    .refine((v) => EXPERIENCE_BUCKETS.some((b) => b.min === v), {
      message: EXPERIENCE_REQUIRED_MESSAGE,
    }),
  maxYearsExperience: z.number({ error: EXPERIENCE_REQUIRED_MESSAGE }).int().nullable(),
  newGradFriendly: z.boolean().optional(),
  experienceQualifier: z
    .string()
    .max(80, 'Experience note must be 80 characters or fewer')
    .optional()
    .or(z.literal('')),
}).superRefine((data, ctx) => {
  if (!data.salaryCompetitive) {
    if (!data.salaryPeriod) {
      ctx.addIssue({ code: 'custom', message: 'Please select a pay period', path: ['salaryPeriod'] });
    }
    if (!data.salaryMin || data.salaryMin <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Minimum salary is required', path: ['salaryMin'] });
    }
    if (!data.salaryMax || data.salaryMax <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Maximum salary is required', path: ['salaryMax'] });
    }
    if (data.salaryMin && data.salaryMax && data.salaryMin > data.salaryMax) {
      ctx.addIssue({ code: 'custom', message: 'Minimum salary cannot be greater than maximum', path: ['salaryMin'] });
    }
  }
  if (!data.applyOnPlatform && (!data.applyUrl || data.applyUrl.trim() === '')) {
    ctx.addIssue({ code: 'custom', message: 'Apply URL is required when not using platform applications', path: ['applyUrl'] });
  }
});

export type JobPostingFormData = z.infer<typeof jobPostingSchema>;
