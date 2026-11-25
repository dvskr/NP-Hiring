/**
 * lib/salary-guide-hub-faq.ts: the /salary-guide FAQ, one array that feeds
 * both the visible accordion and the FAQPage JSON-LD (salary build 2026-11,
 * spec Item 2).
 *
 * Every answer comes from a cited figure or from the one salary engine:
 *   - BLS OEWS May 2025 (STAT_SOURCES, lib/salary-guide-bls-states.ts,
 *     OCCUPATION_WAGES), always with its source and vintage;
 *   - the NP Pay Report snapshot (lib/reports/np-pay.ts), always with its
 *     employer count, and only for scopes the engine publishes.
 * Without a snapshot (a build with no database) the answers fall back to
 * the BLS sentences alone; they never print a posted figure they cannot
 * back. No answer says what nurse practitioners "earn", none says
 * "average", and none carries a dash.
 */
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { OCCUPATION_WAGES } from '@/lib/salary-guide-occupation-wages';
import {
    BLS_NATIONAL,
    BLS_OEWS_REFERENCE_PERIOD,
    BLS_PA_STATE_WAGES,
    BLS_STATE_WAGES,
    blsStatesByMedianDesc,
    bottomStatesByMedian,
    formatBlsDollars,
    topStatesByMedian,
} from '@/lib/salary-guide-bls-states';
import { BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { usd, type NpPayScopeRow, type NpPaySnapshot } from '@/lib/reports/np-pay-model';
import { joinWithAnd } from '@/lib/display-text';

export interface HubFaq {
    q: string;
    a: string;
}

const NP = brand.niche.short;
const NP_PLURAL = `${brand.niche.descriptor}s`;
const BLS_NP_SOURCE = STAT_SOURCES.npMedianWageBls.source;
const NATIONAL = formatBlsDollars(BLS_NATIONAL.np.annualMedian);

/** Scopes the engine published (the median tier or above), highest median first. */
export function publishedByMedian(rows: readonly NpPayScopeRow[]): NpPayScopeRow[] {
    return rows
        .filter((row): row is NpPayScopeRow & { median: number; employers: number } => row.median !== null && row.employers !== null)
        .sort((a, b) => (b.median as number) - (a.median as number));
}

function employersClause(row: NpPayScopeRow): string {
    return `${row.employers} ${row.employers === 1 ? 'employer' : 'employers'}`;
}

export function howMuchAnswer(): string {
    const [high] = topStatesByMedian(1);
    const [low] = bottomStatesByMedian(1);
    const range = high && low
        ? ` State medians in the same survey run from ${formatBlsDollars(low.annualMedian)} in ${low.state} to ${formatBlsDollars(high.annualMedian)} in ${high.state}.`
        : '';
    return `The median annual wage for ${NP_PLURAL} was ${NATIONAL} in ${BLS_OEWS_REFERENCE_PERIOD}, according to federal wage data (${BLS_NP_SOURCE}). The 10th percentile wage was ${STAT_SOURCES.salaryPercentile10.formatted} and the 90th percentile wage was ${STAT_SOURCES.salaryPercentile90.formatted}.${range} Individual offers move with setting, specialty and location.`;
}

export function highestPayingStateAnswer(): string {
    const [first, second, third] = topStatesByMedian(3);
    if (!first || !second || !third) {
        return `The BLS ${BLS_OEWS_REFERENCE_PERIOD} survey publishes a median annual wage for ${NP_PLURAL} in each state, and the national median was ${NATIONAL}.`;
    }
    return `In the BLS ${BLS_OEWS_REFERENCE_PERIOD} survey, ${first.state} had the highest median annual wage for ${NP_PLURAL} at ${formatBlsDollars(first.annualMedian)}, followed by ${second.state} (${formatBlsDollars(second.annualMedian)}) and ${third.state} (${formatBlsDollars(third.annualMedian)}). The national median was ${NATIONAL}.`;
}

export function highestPaidTypeAnswer(snapshot: NpPaySnapshot | null): string {
    const crna = `Nurse anesthetists are a separate APRN role, not ${NP_PLURAL}: their median annual wage was ${OCCUPATION_WAGES.nurseAnesthetists.formatted} (${OCCUPATION_WAGES.nurseAnesthetists.source}).`;
    const ranked = snapshot ? publishedByMedian(snapshot.specialties) : [];
    if (ranked.length >= 2) {
        const [first, second] = ranked;
        return `BLS does not publish ${NP} wages by specialty. On ${brand.name}, among specialties where at least ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay in live postings, ${first.scope} has the highest median advertised pay at ${usd(first.median as number)} across ${employersClause(first)}, followed by ${second.scope} at ${usd(second.median as number)} across ${employersClause(second)}. ${crna}`;
    }
    return `BLS does not publish ${NP} wages by specialty, and fewer than ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay for most specialties in live postings here right now, so no ranking is published. ${crna}`;
}

/** States where the BLS NP median was above the PA median, counted from the same release. */
export function statesWhereNpMedianTopsPa(): string[] {
    return Object.values(BLS_STATE_WAGES)
        .filter((np) => {
            const pa = BLS_PA_STATE_WAGES[np.state];
            return np.annualMedian.value !== null && pa?.annualMedian.value != null && np.annualMedian.value > pa.annualMedian.value;
        })
        .map((np) => np.state)
        .sort();
}

export function paOrNpAnswer(): string {
    const pa = BLS_NATIONAL.pa.annualMedian.value;
    const np = BLS_NATIONAL.np.annualMedian.value;
    if (pa === null || np === null) return `BLS publishes both occupations' wages each year; see the side by side comparison on ${brand.name}.`;
    const higher = pa > np ? 'physician assistants' : NP_PLURAL;
    const npStates = statesWhereNpMedianTopsPa().length;
    return `In the BLS ${BLS_OEWS_REFERENCE_PERIOD} survey, the median annual wage was ${formatBlsDollars(BLS_NATIONAL.pa.annualMedian)} for physician assistants and ${NATIONAL} for ${NP_PLURAL}, so ${higher} were ahead by ${usd(Math.abs(pa - np))} nationally. By state the order changes: the ${NP} median was higher in ${npStates} of the 50 states and DC. The NP vs PA guide compares training, practice authority and pay side by side.`;
}

export function twoHundredKAnswer(snapshot: NpPaySnapshot | null): string {
    const above = blsStatesByMedianDesc().filter((row) => row.annualP90.value !== null && row.annualP90.value >= 200_000);
    const states = above.length > 0
        ? ` In ${above.length} ${above.length === 1 ? 'state' : 'states'} the 90th percentile wage reached $200,000 or more: ${joinWithAnd(above.map((row) => row.state))}.`
        : '';
    const share = snapshot?.atOrAbove200k;
    const posted = share
        ? ` On ${brand.name}, ${share.employers} of the ${share.of} employers that disclose pay in live postings advertise a median of $200,000 or more (each employer counted once).`
        : '';
    return `Yes, though it is uncommon. The BLS 90th percentile wage for ${NP_PLURAL} was ${STAT_SOURCES.salaryPercentile90.formatted} nationally in ${BLS_OEWS_REFERENCE_PERIOD}, so fewer than one in ten ${NP} jobs paid $200,000 or more.${states}${posted}`;
}

export function rnOrNpAnswer(): string {
    return `In the BLS ${BLS_OEWS_REFERENCE_PERIOD} survey, the median annual wage was ${formatBlsDollars(BLS_NATIONAL.rn.annualMedian)} for registered nurses and ${NATIONAL} for ${NP_PLURAL}. Every ${NP} holds a registered nurse license plus a graduate degree and a national certification in a population focus.`;
}

export function telehealthAnswer(snapshot: NpPaySnapshot | null): string {
    const remote = snapshot?.workModes.find((row) => row.scope === 'Remote');
    const onSite = snapshot?.workModes.find((row) => row.scope === 'On site');
    if (remote?.median != null && onSite?.median != null) {
        const lead = remote.median < onSite.median ? 'On the postings here, remote roles advertise less' : 'Not on the postings here';
        return `${lead}: on ${brand.name}, the median advertised pay is ${usd(remote.median)} for remote postings (${employersClause(remote)}) and ${usd(onSite.median)} for on-site postings (${employersClause(onSite)}). Telehealth roles also differ on licensure cost across states and on patient volume, so compare whole offers.`;
    }
    return `There is no reliable comparison yet: fewer than ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay for remote or on-site roles in live postings here. Telehealth roles also differ on licensure cost across states and on patient volume, so compare whole offers.`;
}

export function increaseAnswer(): string {
    return `The levers that move pay are the state you practice in (the BLS table on this page shows how far state medians differ), the specialty and setting, the employment structure, and negotiation. Practice authority matters too: Full Practice states open independent, contract and telehealth work, though several first require a transition period. Model private practice against your own visit volume and overhead, consider rural and underserved roles for loan repayment, and negotiate the whole package.`;
}

export function travelAnswer(): string {
    return `Travel and locum tenens work is quoted as an hourly or weekly rate plus stipends rather than a salary, so it is not directly comparable to a permanent offer: the rate has to cover the health coverage, malpractice, retirement and unpaid downtime a permanent job absorbs. Hourly and weekly rates are left out of every pay figure on this page for that reason. The 1099 vs W-2 comparison works out the rate a contract has to clear to match a salaried package.`;
}

/** The hub FAQ, in display order. */
export function buildHubFaqs(snapshot: NpPaySnapshot | null): HubFaq[] {
    return [
        { q: `How much do ${NP_PLURAL} make?`, a: howMuchAnswer() },
        { q: `What is the highest paying state for ${NP_PLURAL}?`, a: highestPayingStateAnswer() },
        { q: `What type of ${NP} gets paid the most?`, a: highestPaidTypeAnswer(snapshot) },
        { q: `Which pays more, PA or ${NP}?`, a: paOrNpAnswer() },
        { q: `Can a ${brand.niche.descriptor} make $200,000 a year?`, a: twoHundredKAnswer(snapshot) },
        { q: `What pays more, RN or ${NP}?`, a: rnOrNpAnswer() },
        { q: `Do telehealth ${NP}s make less than in-person?`, a: telehealthAnswer(snapshot) },
        { q: `How can I increase my ${NP} salary?`, a: increaseAnswer() },
        { q: `How much do travel ${NP}s make?`, a: travelAnswer() },
    ];
}
