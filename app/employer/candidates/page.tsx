import { Suspense } from 'react'
import { brand } from '@/config/brand'
import { requireEmployer } from '@/lib/auth/protect'
import CandidateSearchClient from '@/components/employer/CandidateSearchClient'

export const metadata = {
    title: `${brand.niche.short} Talent Pool | Browse Candidates`,
    description: `Browse qualified ${brand.niche.long}s actively looking for new opportunities.`,
}

export default async function CandidatesPage() {
    await requireEmployer('/employer/candidates')

    // Suspense wraps the client because CandidateSearchClient calls
    // useSearchParams() to honor the ?ai=1 deep-link from the talent-search
    // redirect stub. Next App Router requires the boundary explicitly.
    return (
        <Suspense fallback={null}>
            <CandidateSearchClient />
        </Suspense>
    )
}
