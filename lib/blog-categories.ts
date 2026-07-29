/**
 * Public blog taxonomy — the category ids /blog filters by and every
 * surface labels with.
 *
 * WHY THIS IS ITS OWN MODULE (and must stay import-free):
 * lib/blog.ts is a SERVER module — it pulls in @supabase/supabase-js and
 * sanitize-html, and its top-level BLOG_SANITIZE_CONFIG dereferences
 * `sanitizeHtml.defaults`, so the sanitizer is reachable from anything
 * that imports the module at all. The admin editor
 * (app/admin/blog/page.tsx) is a 'use client' component and only needs
 * the label list, so it imports THIS file; importing '@/lib/blog' would
 * drag that entire server graph into the client bundle.
 *
 * lib/blog.ts re-exports both symbols, so server callers are unaffected
 * and there is still exactly one definition of the taxonomy.
 * Guarded by tests/regressions/p1-content-library-blog-seed.test.ts
 * (no 'use client' file may import '@/lib/blog'; this file may not
 * import anything).
 */

export type BlogCategory =
    | 'job_seeker_attraction'
    | 'salary_negotiation'
    | 'career_myths'
    | 'state_spotlight'
    | 'employer_facing'
    | 'community_lifestyle'
    | 'industry_awareness'
    | 'product_lead_gen'
    | 'success_stories'
    | 'mental_health_trends'
    | 'policy_industry'
    | 'career_opportunities'
    | 'tech_tools';

export const BLOG_CATEGORIES: { id: BlogCategory; label: string }[] = [
    { id: 'job_seeker_attraction', label: 'Job Seeker Tips' },
    { id: 'salary_negotiation', label: 'Salary Negotiation' },
    { id: 'career_myths', label: 'Career Myths' },
    { id: 'state_spotlight', label: 'State Spotlight' },
    { id: 'employer_facing', label: 'For Employers' },
    { id: 'community_lifestyle', label: 'Community & Lifestyle' },
    { id: 'industry_awareness', label: 'Industry Awareness' },
    { id: 'product_lead_gen', label: 'Product & Resources' },
    { id: 'success_stories', label: 'Success Stories' },
    { id: 'mental_health_trends', label: 'Mental Health Trends' },
    { id: 'policy_industry', label: 'Policy & Industry' },
    { id: 'career_opportunities', label: 'Career Opportunities' },
    { id: 'tech_tools', label: 'Tech & Tools' },
];
