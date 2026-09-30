import { Metadata } from 'next';
import CategoryLandingPage, { buildCategoryLandingMetadata } from '@/lib/pseo/category-landing-template';
import { parseListingPage } from '@/lib/pseo/listing-pagination';

export const revalidate = 3600;

const CATEGORY_SLUG = 'emergency';

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildCategoryLandingMetadata(CATEGORY_SLUG, await searchParams);
}

export default async function EmergencyJobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = parseListingPage(sp.page);
  return <CategoryLandingPage slug={CATEGORY_SLUG} page={page} />;
}
