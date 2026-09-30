import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SettingStatePage, { buildSettingStateMetadata } from '@/lib/pseo/setting-state-template';
import { resolveStateSlug } from '@/lib/pseo/setting-state-config';
import { parseListingPage } from '@/lib/pseo/listing-pagination';

export const revalidate = 3600;

const SETTING_KEY = 'hospitalist';

interface Props {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { state } = await params;
  const sp = await searchParams;
  const page = parseListingPage(sp.page);
  return buildSettingStateMetadata(SETTING_KEY, state, page);
}

export default async function HospitalistStateJobsPage({ params, searchParams }: Props) {
  const { state } = await params;
  const sp = await searchParams;
  const page = parseListingPage(sp.page);

  const stateName = resolveStateSlug(state);
  if (!stateName) notFound();

  return <SettingStatePage settingKey={SETTING_KEY} stateSlug={state} page={page} />;
}
