import type { Metadata } from 'next';
import GuideView from './guide-view';
import { guideMetadata } from './guide-model';
import { WHAT_IS_A_NURSE_PRACTITIONER } from './content';

// Static, like /resources/fpa-guide (which exports no revalidate): every word
// and figure on the page is in code, so it changes only with a deploy.
export const revalidate = false;

export const metadata: Metadata = guideMetadata(WHAT_IS_A_NURSE_PRACTITIONER);

export default function WhatIsANursePractitionerPage() {
    return <GuideView guide={WHAT_IS_A_NURSE_PRACTITIONER} />;
}
