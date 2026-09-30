import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CategoryCityPage, {
  buildCategoryCityMetadata,
} from '@/lib/pseo/category-city-template';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { parseListingPage } from '@/lib/pseo/listing-pagination';

export const revalidate = 3600;

const CATEGORY_KEY = 'emergency';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  return buildCategoryCityMetadata(CATEGORY_KEY, slug, parseListingPage(sp.page));
}

export default async function EmergencyCityJobsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = parseListingPage(sp.page);

  if (!getCityBySlug(slug)) notFound();

  return <CategoryCityPage categoryKey={CATEGORY_KEY} citySlug={slug} page={page} />;
}
