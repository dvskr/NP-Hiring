import type { Metadata } from 'next';
import GuideView from '@/app/resources/what-is-a-nurse-practitioner/guide-view';
import { guideMetadata } from '@/app/resources/what-is-a-nurse-practitioner/guide-model';
import { NP_VS_PA } from './content';

// Static, like /resources/fpa-guide (which exports no revalidate): every word
// and figure on the page is in code, so it changes only with a deploy.
export const revalidate = false;

export const metadata: Metadata = guideMetadata(NP_VS_PA);

export default function NpVsPaPage() {
    return <GuideView guide={NP_VS_PA} />;
}
