import { z } from 'zod';
import { computeTakeHome } from '@/components/tools/take-home-model';
import { TAX_MODEL_YEAR } from '@/components/tools/federal-tax-model';
import { BENCHMARK_FULL_MIN_EMPLOYERS, classifyOffer, type OfferStanding } from '@/components/tools/benchmark-model';
import { getStatesByAuthority, type PracticeAuthority } from '@/lib/state-practice-authority';
import { getPracticeEnvironment, nlcSentence } from '@/lib/pseo/practice-environment';
import type { FactRow, FactSection, FactsViewData } from '@/lib/mcp/widgets/src/contracts';
import { defineTool, UserFacingError } from '@/lib/mcp/server/types';
import { BOARD_NAME, ROLE_TOKEN } from './board-words';
import { AANP_SOURCE, AANP_SOURCE_URL, practiceAuthorityAnswer } from './practice-authority';
import {
  BOARD_MEDIAN_LABEL,
  PAY_METHOD_LINE,
  employersCount,
  guideUrl,
  hasPayRange,
  isPublished,
  noRangeLine,
  payFigure,
  stateGuideUrl,
  withheldLine,
} from './np-pay';
import { resolveStateName } from './shared';

/**
 * NP Hiring's calculators, run for the assistant. The W-2 and 1099
 * comparison calls the same model as the site's calculator
 * (components/tools/take-home-model.ts), so a figure given in a conversation
 * is the figure the page shows for the same inputs. The offer check reads
 * the salary guide's own published figures (lib/salary-analytics.ts).
 *
 * Nothing here is stored: the amounts are tool arguments, and the tool log
 * records the tool's name, never its arguments.
 */

const dollars = (value: number): string => `${value < 0 ? 'minus ' : ''}$${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
const cents = (value: number): string =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function factsText(data: FactsViewData): string {
  const lines = [data.subtitle ? `${data.title}. ${data.subtitle}` : data.title];
  for (const section of data.sections) {
    if (section.heading) lines.push(`${section.heading}:`);
    for (const row of section.rows) lines.push(`${section.heading ? '  ' : ''}${row.label}: ${row.value}`);
  }
  lines.push(...data.notes);
  for (const link of data.links) lines.push(`${link.label}: ${link.url}`);
  return lines.join('\n');
}

const DEFAULT_HOURS_PER_WEEK = 40;
/** A gap this small either way is called even: the inputs are estimates themselves. */
const EVEN_WITHIN_DOLLARS = 500;

export const compareW2And1099 = defineTool({
  name: 'compare_w2_and_1099',
  title: 'Compare a W-2 offer with a 1099 rate',
  description:
    'Compare a W-2 salary with a 1099 contract rate after federal income tax: what each side leaves in hand after payroll or self-employment tax, federal income tax, insurance premiums and business expenses, the difference, and the 1099 hourly rate that would match the W-2 side. ' +
    `Same calculation as the 1099 vs W-2 calculator on ${BOARD_NAME}. Amounts that are not given count as zero, and the result names them. State and local tax are not included. It is an estimate, not tax advice.`,
  input: {
    w2_annual_salary: z.number().min(1).max(2_000_000).describe('W-2 base salary in dollars a year.'),
    contractor_hourly_rate: z.number().min(1).max(2_000).describe('The 1099 rate in dollars an hour.'),
    hours_per_week: z.number().min(1).max(100).optional().describe('Hours worked a week, the same on both sides. 40 when not given.'),
    paid_days_off: z.number().min(0).max(260).optional().describe('Paid days off a year on the W-2 side, holidays included; the 1099 side takes the same days unpaid. Zero when not given.'),
    filing_status: z.enum(['single', 'married_joint']).optional().describe('Federal filing status. single when not given.'),
    employer_match_percent: z.number().min(0).max(100).optional().describe('Employer retirement match on the W-2 side, as a percent of salary. Zero when not given.'),
    w2_employee_premium_yearly: z.number().min(0).max(100_000).optional().describe('The person\'s own yearly share of the W-2 health premium. Zero when not given.'),
    contractor_business_expenses_yearly: z.number().min(0).max(1_000_000).optional().describe('Yearly business expenses on the 1099 side: malpractice, CME, licensure, equipment. Zero when not given.'),
    contractor_insurance_premium_yearly: z.number().min(0).max(100_000).optional().describe('Yearly health insurance the person buys on the 1099 side. Zero when not given.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'none',
  widget: 'facts',
  invoking: 'Comparing W-2 and 1099',
  invoked: 'Comparison ready',
  async run(args, ctx) {
    const hours = args.hours_per_week ?? DEFAULT_HOURS_PER_WEEK;
    const result = computeTakeHome({
      filingStatus: args.filing_status === 'married_joint' ? 'marriedJoint' : 'single',
      hoursPerWeek: hours,
      paidDaysOff: args.paid_days_off ?? 0,
      w2Salary: args.w2_annual_salary,
      w2EmployerMatchPct: args.employer_match_percent ?? 0,
      w2EmployeePremium: args.w2_employee_premium_yearly ?? 0,
      contractHourlyRate: args.contractor_hourly_rate,
      contractBusinessExpenses: args.contractor_business_expenses_yearly ?? 0,
      contractHealthPremium: args.contractor_insurance_premium_yearly ?? 0,
      // Money moved from the cash in hand, not a cost: it does not change the comparison.
      contractRetirement: 0,
    });
    const unstated = [
      args.paid_days_off === undefined ? 'paid days off' : '',
      args.employer_match_percent === undefined ? 'employer retirement match' : '',
      args.w2_employee_premium_yearly === undefined ? 'the W-2 health premium share' : '',
      args.contractor_business_expenses_yearly === undefined ? '1099 business expenses' : '',
      args.contractor_insurance_premium_yearly === undefined ? '1099 health insurance' : '',
    ].filter(Boolean);
    const delta = result.netPositionDelta;
    const verdict =
      Math.abs(delta) < EVEN_WITHIN_DOLLARS ? 'About even' : `${delta > 0 ? '1099' : 'W-2'} ahead by ${dollars(Math.abs(delta))} a year`;

    const structured: FactsViewData = {
      view: 'facts',
      kicker: '1099 vs W-2',
      title: verdict,
      subtitle: `After federal income tax, ${args.filing_status === 'married_joint' ? 'married filing jointly' : 'filing single'}`,
      sections: [
        {
          heading: 'W-2',
          rows: [
            { label: 'Salary', value: dollars(result.w2.gross) },
            { label: 'Health premium share', value: `minus ${dollars(result.w2.employeePremium)}` },
            { label: 'Payroll tax', value: `minus ${dollars(result.w2.payrollTax)}` },
            { label: 'Federal income tax', value: `minus ${dollars(result.w2.federalTax)}` },
            { label: 'Employer retirement match', value: dollars(result.w2.employerMatch) },
            { label: 'In hand, with the match', value: dollars(result.w2.netPosition), emphasis: true },
          ],
        },
        {
          heading: '1099',
          rows: [
            { label: `Gross at ${cents(args.contractor_hourly_rate)} an hour, ${Math.round(result.billableHours).toLocaleString('en-US')} hours`, value: dollars(result.contract.gross) },
            { label: 'Business expenses', value: `minus ${dollars(result.contract.businessExpenses)}` },
            { label: 'Self-employment tax', value: `minus ${dollars(result.contract.selfEmploymentTax)}` },
            { label: 'Federal income tax', value: `minus ${dollars(result.contract.federalTax)}` },
            { label: 'Health insurance', value: `minus ${dollars(result.contract.healthPremium)}` },
            { label: 'In hand', value: dollars(result.contract.netPosition), emphasis: true },
          ],
        },
        {
          heading: 'Break even',
          rows: [
            {
              label: '1099 rate that matches the W-2 side',
              value: result.breakEvenHourlyRate === null ? 'No rate up to $2,000 an hour closes the gap' : `${cents(result.breakEvenHourlyRate)} an hour`,
              emphasis: true,
            },
          ],
        },
      ],
      notes: [
        ...(unstated.length > 0 ? [`Not given, so counted as zero: ${unstated.join(', ')}. Add them for a fair comparison.`] : []),
        `Both sides work ${hours} hours a week; days off are paid on W-2 and unpaid on 1099.`,
        `${TAX_MODEL_YEAR} federal income tax and payroll or self-employment tax. State and local tax are not included. An estimate, not tax advice.`,
      ],
      links: [{ label: 'Open the calculator', url: `${ctx.baseUrl}/tools/1099-vs-w2-calculator` }],
    };
    return { text: factsText(structured), structured };
  },
});

type PayPeriod = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'annual';

const PERIODS: readonly { key: PayPeriod; label: string }[] = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every two weeks' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'annual', label: 'Yearly' },
];
const PERIOD_KEYS = PERIODS.map((p) => p.key) as [PayPeriod, ...PayPeriod[]];

/** A day counts as 8 hours. */
const HOURS_PER_DAY = 8;

/** How many of a period are paid in a year, for a schedule. */
function periodsPerYear(period: PayPeriod, hoursPerWeek: number, weeksPerYear: number): number {
  switch (period) {
    case 'hourly':
      return hoursPerWeek * weeksPerYear;
    case 'daily':
      return (hoursPerWeek / HOURS_PER_DAY) * weeksPerYear;
    case 'weekly':
      return weeksPerYear;
    case 'biweekly':
      return weeksPerYear / 2;
    case 'monthly':
      return 12;
    case 'annual':
      return 1;
  }
}

/** Pay outside this range is a mistyped period far more often than a real figure. */
const ANNUAL_PAY_FLOOR = 10_000;
const ANNUAL_PAY_CEILING = 5_000_000;

function requirePlausibleAnnual(annual: number): void {
  if (annual < ANNUAL_PAY_FLOOR || annual > ANNUAL_PAY_CEILING) {
    throw new UserFacingError(
      `That works out to ${dollars(annual)} a year, which does not look right. Check the amount and whether it is hourly or yearly.`,
    );
  }
}

/** The site-wide median, for context, when it is published. */
async function boardMedianNote(): Promise<string | null> {
  const figure = await payFigure({ kind: 'board' });
  if (!isPublished(figure)) return null;
  return `For context, the ${BOARD_MEDIAN_LABEL.charAt(0).toLowerCase()}${BOARD_MEDIAN_LABEL.slice(1)} is ${dollars(figure.median)} a year in advertised pay, across ${employersCount(figure.employers)} that disclose pay.`;
}

export const convertPay = defineTool({
  name: 'convert_pay',
  title: 'Convert pay between periods',
  description:
    'Convert a pay figure between hourly, daily, weekly, every two weeks, monthly and yearly, for a given number of hours a week and weeks a year. A day counts as 8 hours, before tax. ' +
    'Useful for comparing an hourly or per diem rate with a salaried offer.',
  input: {
    amount: z.number().positive().max(10_000_000).describe('The pay amount in dollars.'),
    period: z.enum(PERIOD_KEYS).describe('What the amount is paid per.'),
    hours_per_week: z.number().min(1).max(100).optional().describe('Hours worked a week. 40 when not given.'),
    weeks_per_year: z.number().min(1).max(53).optional().describe('Weeks worked a year. 52 when not given.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'none',
  widget: 'facts',
  invoking: 'Converting pay',
  invoked: 'Pay converted',
  async run(args, ctx) {
    const hoursPerWeek = args.hours_per_week ?? DEFAULT_HOURS_PER_WEEK;
    const weeksPerYear = args.weeks_per_year ?? 52;
    const annual = args.amount * periodsPerYear(args.period, hoursPerWeek, weeksPerYear);
    requirePlausibleAnnual(annual);
    const rows: FactRow[] = PERIODS.map(({ key, label }) => {
      const value = annual / periodsPerYear(key, hoursPerWeek, weeksPerYear);
      return { label, value: key === 'hourly' ? cents(value) : dollars(value), emphasis: key === 'annual' };
    });
    const context = await boardMedianNote();
    const from = PERIODS.find((p) => p.key === args.period)!.label.toLowerCase();
    const structured: FactsViewData = {
      view: 'facts',
      kicker: 'Pay converter',
      title: `${args.period === 'hourly' ? cents(args.amount) : dollars(args.amount)} ${from}`,
      subtitle: `${hoursPerWeek} hours a week, ${weeksPerYear} weeks a year`,
      sections: [{ heading: null, rows }],
      notes: ['A day counts as 8 hours. Before tax.', ...(context ? [context] : [])],
      links: [{ label: 'Salary guide', url: guideUrl(ctx.baseUrl) }],
    };
    return { text: factsText(structured), structured };
  },
});

const STANDING_TITLES: Readonly<Record<OfferStanding, string>> = {
  below: 'Below the middle half of advertised pay',
  competitive: 'Within the middle half of advertised pay',
  above: 'Above the middle half of advertised pay',
};

export const analyzeOffer = defineTool({
  name: 'analyze_offer',
  title: 'Check an offer against advertised pay',
  description:
    `Place a job offer against advertised pay on live ${BOARD_NAME} postings: below, within or above the middle half (25th to 75th percentile) in a state, among remote roles or across all ${BOARD_NAME} postings, next to the median, with the number of employers behind the figures. ` +
    `A scope where fewer than ${BENCHMARK_FULL_MIN_EMPLOYERS} employers disclose pay has no middle half, so the offer is compared with all ${BOARD_NAME} postings instead. ` +
    'The comparison is with advertised salary ranges, not reported earnings, and the amount is not stored. It gives figures, not advice on whether to accept.',
  input: {
    amount: z.number().positive().max(10_000_000).describe('The offer in dollars.'),
    period: z.enum(['annual', 'hourly']).describe('Whether the amount is a yearly salary or an hourly rate.'),
    hours_per_week: z.number().min(1).max(100).optional().describe('For an hourly offer: hours a week. 40 when not given.'),
    state: z.string().trim().max(40).optional().describe('US state to compare within, by name or two-letter code.'),
    remote: z.boolean().optional().describe('Compare with remote roles. Ignored when a state is given.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'none',
  widget: 'facts',
  invoking: 'Checking the offer',
  invoked: 'Offer checked',
  async run(args, ctx) {
    const stateName = resolveStateName(args.state);
    if (args.state && !stateName) {
      throw new UserFacingError(`"${args.state}" does not match a US state. Use a state name or its two-letter code.`);
    }
    const hours = args.hours_per_week ?? DEFAULT_HOURS_PER_WEEK;
    const annual = args.period === 'annual' ? args.amount : args.amount * hours * 52;
    requirePlausibleAnnual(annual);

    // The scope asked for, and the site-wide figure where that one has no
    // middle half to compare with: no median at all below
    // BENCHMARK_MIN_EMPLOYERS employers, and a median but no 25th to 75th
    // percentile range below BENCHMARK_FULL_MIN_EMPLOYERS.
    const asked = stateName
      ? { label: stateName, figure: await payFigure({ kind: 'state', stateName }) }
      : args.remote
        ? { label: 'remote postings', figure: await payFigure({ kind: 'remote' }) }
        : null;
    const board = await payFigure({ kind: 'board' });
    const usingAsked = !!asked && hasPayRange(asked.figure);
    const scope = usingAsked ? asked! : { label: `all ${BOARD_NAME} postings`, figure: board };
    if (!scope.figure) throw new UserFacingError('Pay data is unavailable for a moment. Try again shortly.');
    const figure = scope.figure;
    const standing = hasPayRange(figure)
      ? classifyOffer(annual, {
          scope: scope.label,
          tier: 'full',
          median: figure.median,
          p25: figure.p25,
          p75: figure.p75,
          postings: figure.postings,
          employers: figure.employers,
        })
      : null;
    if (!hasPayRange(figure) || !standing) {
      const why = isPublished(figure) ? noRangeLine(figure, scope.label) : withheldLine(figure, scope.label);
      throw new UserFacingError(`${why} So there is nothing to compare the offer with right now.`);
    }
    // Why the scope asked for was not used, with its median when it has one.
    const askedNote = asked && !usingAsked
      ? `${isPublished(asked.figure) ? noRangeLine(asked.figure, asked.label) : withheldLine(asked.figure, asked.label)} This uses all ${BOARD_NAME} postings instead.`
      : null;

    const structured: FactsViewData = {
      view: 'facts',
      kicker: 'Offer check',
      title: STANDING_TITLES[standing],
      subtitle: `Compared with ${scope.label}`,
      sections: [
        {
          heading: null,
          rows: [
            {
              label: args.period === 'hourly' ? `Offer (${cents(args.amount)} an hour, ${hours} hours a week)` : 'Offer',
              value: `${dollars(annual)} a year`,
            },
            { label: '25th percentile', value: dollars(figure.p25) },
            { label: 'Median', value: dollars(figure.median), emphasis: true },
            { label: '75th percentile', value: dollars(figure.p75) },
            { label: 'Employers compared', value: figure.employers.toLocaleString('en-US') },
          ],
        },
      ],
      notes: [...(askedNote ? [askedNote] : []), PAY_METHOD_LINE],
      links: [{ label: 'Salary guide', url: stateName ? stateGuideUrl(ctx.baseUrl, stateName) : guideUrl(ctx.baseUrl) }],
    };
    return { text: factsText(structured), structured };
  },
});

// ── Practice authority ───────────────────────────────────────────────────────

const AUTHORITY_ORDER: readonly PracticeAuthority[] = ['full', 'reduced', 'restricted'];
const AUTHORITY_HEADINGS: Readonly<Record<PracticeAuthority, string>> = {
  full: 'Full Practice',
  reduced: 'Reduced Practice',
  restricted: 'Restricted Practice',
};

/** Every jurisdiction in the dataset, by AANP category, least restricted first. */
function sectionsByAuthority(): FactSection[] {
  return AUTHORITY_ORDER.flatMap((authority) => {
    const states = [...getStatesByAuthority(authority)].sort();
    return states.length > 0 ? [{ heading: `${AUTHORITY_HEADINGS[authority]} (${states.length})`, rows: [{ label: 'Where', value: states.join(', ') }] }] : [];
  });
}

const CONFIRM_WITH_BOARD = 'Practice rules change; confirm them with the state board of nursing.';
const SOURCE_LINE = `The category is AANP's: ${AANP_SOURCE} (${AANP_SOURCE_URL}).`;

export const getPracticeAuthority = defineTool({
  name: 'get_practice_authority',
  title: 'Look up NP practice authority by state',
  description:
    'Nurse practitioner practice authority by US state, as AANP categorizes it: Full Practice, Reduced Practice or Restricted Practice. ' +
    'With a state it returns that state\'s category, what the state requires as the dataset records it, what AANP means by the category, the state board of nursing and whether the state is in the Nurse Licensure Compact; with none, every state grouped by category. Rules change, and the result says to confirm them with the state board of nursing.',
  input: {
    state: z.string().trim().max(40).optional().describe('US state name or two-letter code. Omit for all states.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'none',
  widget: 'facts',
  invoking: 'Checking practice authority',
  invoked: 'Practice authority ready',
  async run(args, ctx) {
    const stateName = resolveStateName(args.state);
    if (args.state && !stateName) {
      throw new UserFacingError(`"${args.state}" does not match a US state. Use a state name or its two-letter code.`);
    }
    const scopeUrl = `${ctx.baseUrl}/scope-of-practice`;
    if (!stateName) {
      const structured: FactsViewData = {
        view: 'facts',
        kicker: 'NP practice authority',
        title: 'NP practice authority by state',
        subtitle: 'AANP categories',
        sections: sectionsByAuthority(),
        notes: [SOURCE_LINE, CONFIRM_WITH_BOARD],
        links: [{ label: 'Scope of practice', url: scopeUrl }],
      };
      return { text: factsText(structured), structured };
    }

    const answer = practiceAuthorityAnswer(stateName);
    if (!answer) throw new UserFacingError(`${BOARD_NAME} has no practice authority entry for ${stateName}.`);
    const environment = getPracticeEnvironment(stateName);
    const compact = nlcSentence(stateName);
    const rows: FactRow[] = [
      { label: 'AANP category', value: answer.label, emphasis: true },
      { label: `In ${stateName}`, value: answer.details },
      { label: 'What AANP means by it', value: answer.tierDefinition },
      ...(environment?.boardName
        ? [{ label: 'State board of nursing', value: environment.boardUrl ? `${environment.boardName} (${environment.boardUrl})` : environment.boardName }]
        : []),
      ...(compact ? [{ label: 'Nurse Licensure Compact', value: compact }] : []),
    ];
    const links = [
      ...(environment?.licenseGuideSlug ? [{ label: `${ROLE_TOKEN} license guide for ${stateName}`, url: `${ctx.baseUrl}/blog/${environment.licenseGuideSlug}` }] : []),
      { label: `${ROLE_TOKEN} jobs in ${stateName}`, url: `${ctx.baseUrl}/jobs?location=${encodeURIComponent(stateName)}` },
      { label: 'Scope of practice', url: scopeUrl },
    ];
    const structured: FactsViewData = {
      view: 'facts',
      kicker: 'NP practice authority',
      title: stateName,
      subtitle: answer.label,
      sections: [{ heading: null, rows }],
      notes: [SOURCE_LINE, CONFIRM_WITH_BOARD],
      links,
    };
    return { text: factsText(structured), structured };
  },
});
