import { sisterBoard } from '@/config/sister-board';
import { isSisterBoardSpecialty, sisterBoardUrl } from '@/lib/sister-board';
import SisterBoardLink from './SisterBoardLink';

interface SisterBoardPostJobHintProps {
    /** The post-job form's watched specialty value (a taxonomy slug, or empty). */
    specialty: string | null | undefined;
}

/**
 * Note under the post-job specialty select, shown only when the employer picks
 * the sister board's specialty. Owner's pick: post on BOTH boards, so the copy
 * never asks the employer to leave this form. data-sister-board marks it for
 * the E2E donor-copy guards.
 */
export default function SisterBoardPostJobHint({ specialty }: SisterBoardPostJobHintProps) {
    if (!isSisterBoardSpecialty(specialty)) return null;
    const { postJob } = sisterBoard.copy;

    return (
        <div
            role="note"
            data-sister-board=""
            style={{
                marginTop: '10px',
                padding: '12px 14px',
                borderRadius: '12px',
                background: '#F7F3FC',
                border: '1px solid rgba(122,28,43,0.15)',
                fontSize: '13px',
                lineHeight: 1.55,
                color: '#5A4A42',
            }}
        >
            <p style={{ margin: '0 0 6px' }}>{postJob.body}</p>
            <SisterBoardLink
                href={sisterBoardUrl('employers', 'postJob')}
                label={postJob.action}
                style={{ fontWeight: 700, color: '#7A1C2B', textDecoration: 'underline' }}
            >
                {postJob.action} →
            </SisterBoardLink>
        </div>
    );
}
