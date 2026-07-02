import { Metadata } from 'next';
import CategoryLandingPage, { buildCategoryLandingMetadata } from '@/lib/pseo/category-landing-template';

export const revalidate = 3600;

const CATEGORY_SLUG = 'pediatric';

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildCategoryLandingMetadata(CATEGORY_SLUG, await searchParams);
}

export default async function PediatricJobsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  return <CategoryLandingPage slug={CATEGORY_SLUG} page={page} />;
}
