import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_PATHS, toolApplicationCategory } from '@/app/tools/tools-registry';
import { PAGE_CONTENT_DATES } from '@/app/api/sitemaps/lastmod';
import {
  CMS_WRVU_TABLE,
  computeEmLevel,
  computeWrvuCompensation,
} from '@/components/tools/clinical-coding-models';
import {
  INTERVIEW_TRACKS,
  PAY_TRANSPARENCY_JURISDICTIONS,
  buildCredentialingIcs,
  computeClinicProfitability,
  computeCredentialingTimeline,
  computeIncidentToRoi,
  computeVacancyCost,
  evaluatePayTransparency,
  scoreInterviewCandidate,
} from '@/components/tools/employer-ops-models';
import {
  NHSC_AWARD_AMOUNTS,
  compareTwoOffers,
  computeLoanStrategies,
  computeTravelStipend,
  convertClinicianPay,
  evaluateIrsTaxHome,
  gradeClinicianOffer,
} from '@/components/tools/clinician-comp-models';
import {
  CERTIFICATION_BOARD_RULES,
  NON_COMPETE_STATE_RULES,
  PRESCRIPTIVE_AUTHORITY_RULES,
  computeClinicalHoursProgress,
  computeTailCoverage,
  formatClinicalHoursCsv,
} from '@/components/tools/clinician-regulatory-models';

describe('Tools Suite Registry & Sitemap Parity', () => {
  it('registers 24 total tools (15 clinician/student + 9 employer) with page files and lastmod dates', () => {
    expect(TOOLS).toHaveLength(24);
    expect(TOOLS.filter((t) => t.audience === 'seeker')).toHaveLength(15);
    expect(TOOLS.filter((t) => t.audience === 'employer')).toHaveLength(9);

    const uniquePaths = new Set(TOOL_PATHS);
    expect(uniquePaths.size).toBe(24);

    for (const tool of TOOLS) {
      const routeFile = path.join(process.cwd(), 'app', tool.path, 'page.tsx');
      expect(fs.existsSync(routeFile), `Missing page.tsx for ${tool.path}`).toBe(true);
      expect(toolApplicationCategory(tool.path)).toBe(tool.applicationCategory);
      expect(PAGE_CONTENT_DATES[tool.path], `Missing PAGE_CONTENT_DATES for ${tool.path}`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });
});

describe('Clinical Coding & Productivity Models (wRVU & AMA E/M)', () => {
  it('computes CMS wRVU volume, productivity bonus above threshold, and break-even daily encounters', () => {
    expect(CMS_WRVU_TABLE.find((c) => c.cpt === '99214')?.wrvu).toBe(1.92);
    expect(CMS_WRVU_TABLE.find((c) => c.cpt === '99213')?.wrvu).toBe(1.3);

    const res = computeWrvuCompensation({
      dailyCounts: { '99213': 10, '99214': 10 }, // 10*1.3 + 10*1.92 = 32.2 daily wRVUs across 20 visits
      clinicalDaysPerWeek: 4,
      workingWeeksPerYear: 48, // 192 days -> 6,182.4 annual wRVUs
      baseSalary: 130_000,
      annualWrvuThreshold: 4_500,
      conversionRatePerWrvu: 24,
    });

    expect(res.clinicalDaysPerYear).toBe(192);
    expect(res.dailyEncounters).toBe(20);
    expect(res.dailyWrvus).toBeCloseTo(32.2, 2);
    expect(res.annualWrvus).toBeCloseTo(6182.4, 1);
    expect(res.bonusEligibleWrvus).toBeCloseTo(1682.4, 1);
    expect(res.annualProductivityBonus).toBeCloseTo(40_377.6, 1);
    expect(res.totalAnnualCashComp).toBeCloseTo(170_377.6, 1);
    expect(res.breakEvenDailyEncountersForThreshold).toBeCloseTo(4500 / (192 * 1.61), 2);
  });

  it('applies the AMA 2-of-3 MDM matrix rule and compares against Total Time + prolonged thresholds', () => {
    // High problem + Straightforward data + Moderate risk -> 2nd highest is Moderate (99214)
    const mdmDriven = computeEmLevel({
      patientType: 'established',
      problems: 'high',
      data: 'straightforward',
      risk: 'moderate',
      totalMinutes: 22, // 22 min alone is only 99213
    });
    expect(mdmDriven.mdmOverallComplexity).toBe('moderate');
    expect(mdmDriven.mdmCode).toBe('99214');
    expect(mdmDriven.timeCode).toBe('99213');
    expect(mdmDriven.recommendedCode).toBe('99214');
    expect(mdmDriven.recommendedMethod).toBe('MDM (2 of 3 elements)');

    // Time-driven override + prolonged service thresholds (70 min established -> 99215 + 99417 + G2212)
    const timeDriven = computeEmLevel({
      patientType: 'established',
      problems: 'low',
      data: 'straightforward',
      risk: 'low',
      totalMinutes: 70,
    });
    expect(timeDriven.mdmCode).toBe('99213');
    expect(timeDriven.timeCode).toBe('99215');
    expect(timeDriven.recommendedCode).toBe('99215');
    expect(timeDriven.recommendedMethod).toBe('Total Time on Date of Encounter');
    expect(timeDriven.prolongedCommercial99417Units).toBe(2);
    expect(timeDriven.prolongedMedicareG2212Units).toBe(1);

    // New patient prolonged thresholds (90 min -> 99205 + 99417 + G2212)
    const newProlonged = computeEmLevel({
      patientType: 'new',
      problems: 'moderate',
      data: 'moderate',
      risk: 'moderate',
      totalMinutes: 90,
    });
    expect(newProlonged.recommendedCode).toBe('99205');
    expect(newProlonged.prolongedCommercial99417Units).toBe(2);
    expect(newProlonged.prolongedMedicareG2212Units).toBe(1);
  });
});

describe('Employer & Clinic Operations Models', () => {
  it('evaluates 51-jurisdiction pay transparency headcount thresholds and nationwide remote rules', () => {
    expect(PAY_TRANSPARENCY_JURISDICTIONS).toHaveLength(51);

    const caSmall = evaluatePayTransparency({
      state: 'California',
      employerHeadcount: 8,
      workMode: 'In-Person',
    });
    expect(caSmall.mustPublishRangeNow).toBe(false);
    expect(caSmall.mustAvoidSalaryHistoryQuestions).toBe(true);

    const caCovered = evaluatePayTransparency({
      state: 'California',
      employerHeadcount: 20,
      workMode: 'In-Person',
    });
    expect(caCovered.mustPublishRangeNow).toBe(true);

    const coSolo = evaluatePayTransparency({
      state: 'Colorado',
      employerHeadcount: 1,
      workMode: 'In-Person',
    });
    expect(coSolo.mustPublishRangeNow).toBe(true);
    expect(coSolo.mustIncludeBenefitsDescription).toBe(true);

    const txRemote = evaluatePayTransparency({
      state: 'Texas',
      employerHeadcount: 5,
      workMode: 'Remote',
      remoteNationwide: true,
    });
    expect(txRemote.strictestRemoteTriggered).toBe(true);
    expect(txRemote.mustPublishRangeNow).toBe(true);
    expect(txRemote.mustIncludeBenefitsDescription).toBe(true);
  });

  it('calculates cost of vacancy and locum bridge recovery across 30/60/90/120-day milestones', () => {
    const vac = computeVacancyCost({
      completedVisitsPerDay: 18,
      netCollectionPerVisit: 135,
      clinicalDaysPerWeek: 5,
      vacancyCalendarDays: 70, // 50 clinical workdays
      annualBaseSalary: 130_000,
      benefitsAndPayrollLoadPct: 20, // $156,000/yr loaded
      locumDailyRate: 1_150,
      locumDaysCoveredPct: 80, // 40 locum days
      locumProductivityPct: 90,
    });

    expect(vac.clinicalWorkdaysMissed).toBeCloseTo(50, 4);
    expect(vac.totalVisitsUnfilled).toBeCloseTo(900, 4);
    expect(vac.grossCollectionsForegone).toBeCloseTo(121_500, 1);
    expect(vac.netVacancyLossNoLocum).toBeGreaterThan(85_000);
    expect(vac.locumNetAdvantage).toBeGreaterThan(30_000);
    expect(vac.milestones.map((m) => m.days)).toEqual([30, 60, 90, 120]);
  });

  it('models clinic profitability for W-2 vs 1099 split and Medicare 85% vs 100% incident-to ROI', () => {
    const prof = computeClinicProfitability({
      scheduledVisitsPerDay: 20,
      noShowPct: 10, // 18 completed/day
      clinicalDaysPerWeek: 4.5,
      workingWeeksPerYear: 48, // 216 days -> 3,888 visits
      netCollectionPerVisit: 125, // $486,000 gross collections
      w2BaseSalary: 132_000,
      benefitsAndPayrollPct: 22,
      annualCmeAndMalpractice: 7_500,
      contractorClinicianSplitPct: 60,
      collaboratingMdMonthlyRetainer: 1_200,
      monthlySupportAndEhrOverhead: 3_800,
    });

    expect(prof.grossAnnualCollections).toBeCloseTo(486_000, 1);
    expect(prof.w2AnnualNetMargin).toBeGreaterThan(200_000);
    expect(prof.w2BreakEvenCompletedVisitsPerDay).toBeLessThan(prof.completedVisitsPerDay);
    expect(prof.split1099ClinicianPayout).toBeCloseTo(291_600, 1);

    const inc = computeIncidentToRoi({
      annualTotalVisits: 4_000,
      medicarePayerSharePct: 50, // 2,000 Medicare visits
      medicarePhysicianFeeScheduleAllowed: 120, // $102 at 85% vs $120 at 100% = $18 lift/visit
      commercialFollows85SharePct: 0,
      commercialPhysicianAllowed: 140,
      compliantQualifyingVisitsPct: 60, // 1,200 qualifying Medicare visits -> $21,600 lift
      mdSupervisionHoursPerWeek: 2,
      mdHourlyCost: 150,
      workingWeeksPerYear: 48, // $14,400 supervision cost
    });
    expect(inc.perQualifyingVisitMedicareGain).toBeCloseTo(18, 2);
    expect(inc.grossIncidentToLift).toBeCloseTo(21_600, 1);
    expect(inc.netAnnualLiftAfterSupervision).toBeCloseTo(7_200, 1);
  });

  it('builds reverse go-live credentialing timelines, valid .ics calendars, and weighted interview scores', () => {
    const plan = computeCredentialingTimeline({
      targetGoLiveIso: '2027-06-01',
      alreadyLicensedInState: false,
      needsHospitalPrivileges: true,
      stateBonDays: 45,
      deaAndCsrDays: 28,
      caqhAndMalpracticeDays: 14,
      payerPanelingDays: 90,
      hospitalPrivilegingDays: 75,
      ehrAndOnboardingDays: 14,
    });
    expect(plan.totalLeadTimeCalendarDays).toBe(135); // max(45,14) + max(90,75,28,14)
    expect(plan.latestOfferSignIso).toBe('2027-01-17');

    const ics = buildCredentialingIcs(plan, 'Outpatient FNP');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270117');
    expect(ics).toContain('END:VCALENDAR');

    expect(INTERVIEW_TRACKS).toHaveLength(5);
    const score = scoreInterviewCandidate([
      { questionId: 'q1', weight: 60, score: 5 },
      { questionId: 'q2', weight: 40, score: 4 },
    ]);
    expect(score.weightedAverage1To5).toBe(4.6);
    expect(score.normalizedScore100).toBe(92);
    expect(score.recommendation).toBe('Strong Hire');
  });
});

describe('Clinician Compensation, Travel Stipend, Loan & Regulatory Models', () => {
  it('grades offers, converts 3x12 vs 5x8 shift schedules, and compares Offer A vs Offer B', () => {
    const grade = gradeClinicianOffer(
      {
        baseSalary: 145_000,
        annualBonus: 8_000,
        signOnBonus: 10_000,
        signOnCommitmentYears: 2,
        ptoDays: 20,
        cmeDollars: 2_500,
        yearsExperience: 4,
        hasUnpaidCall: false,
        unpaidChartingHoursPerWeek: 2,
      },
      {
        state: 'Washington',
        liveMedian: 142_000,
        liveP25: 130_000,
        liveP75: 158_000,
        liveEmployers: 12,
        blsMedian: 140_000,
        blsP10: 112_000,
        blsP25: 126_000,
        blsP75: 156_000,
        blsP90: 174_000,
      },
    );
    expect(grade.referenceSourceUsed).toBe('live_and_bls');
    expect(grade.tierLabel).toBe('Above Market Median');
    expect(grade.estimatedPercentile).toBeGreaterThan(50);

    const shift3x12 = convertClinicianPay({
      amount: 135_000,
      unit: 'annual',
      shiftsPerWeek: 3,
      hoursPerShift: 12,
      paidPtoWeeks: 4,
      unpaidAdminHoursPerWeek: 0,
      isHourlyUnpaidTimeOff: false,
    });
    const clinic5x8 = convertClinicianPay({
      amount: 135_000,
      unit: 'annual',
      shiftsPerWeek: 5,
      hoursPerShift: 8,
      paidPtoWeeks: 4,
      unpaidAdminHoursPerWeek: 0,
      isHourlyUnpaidTimeOff: false,
    });
    expect(shift3x12.scheduledAnnualHours).toBe(1_872);
    expect(clinic5x8.scheduledAnnualHours).toBe(2_080);
    expect(shift3x12.nominalHourlyRate).toBeGreaterThan(clinic5x8.nominalHourlyRate);

    const cmp = compareTwoOffers(
      {
        label: 'System A',
        baseSalary: 135_000,
        annualProductivityBonus: 5_000,
        signOnBonus: 12_000,
        signOnClawbackYears: 2,
        ptoDays: 25,
        cmeAllowance: 3_000,
        cmeDays: 5,
        employerRetirementMatchPct: 6,
        employerHealthContributionAnnual: 10_000,
        tailCoverageIncluded: true,
        estimatedTailValueIfExcluded: 9_000,
        clinicalHoursPerWeek: 36,
        unpaidChartingAndCallHoursPerWeek: 2,
      },
      {
        label: 'Clinic B',
        baseSalary: 140_000,
        annualProductivityBonus: 0,
        signOnBonus: 0,
        signOnClawbackYears: 1,
        ptoDays: 10,
        cmeAllowance: 1_000,
        cmeDays: 0,
        employerRetirementMatchPct: 0,
        employerHealthContributionAnnual: 0,
        tailCoverageIncluded: false,
        estimatedTailValueIfExcluded: 9_000,
        clinicalHoursPerWeek: 40,
        unpaidChartingAndCallHoursPerWeek: 6,
      },
    );
    expect(cmp.winner).toBe('A');
    expect(cmp.offerA.trueSteadyStateHourly).toBeGreaterThan(cmp.offerB.trueSteadyStateHourly);
  });

  it('evaluates IRS tax-home eligibility, GSA travel stipends, and 10-year student loan strategies', () => {
    expect(
      evaluateIrsTaxHome({
        regularWorkAtTaxHome: true,
        duplicatedLivingExpenses: true,
        hasNotAbandonedHistoricalHome: true,
        underOneYearAtSingleLocation: false,
      }).eligibleForTaxFreeStipends,
    ).toBe(false);

    expect(
      evaluateIrsTaxHome({
        regularWorkAtTaxHome: false,
        duplicatedLivingExpenses: true,
        hasNotAbandonedHistoricalHome: true,
        underOneYearAtSingleLocation: true,
      }).eligibleForTaxFreeStipends,
    ).toBe(true);

    const travel = computeTravelStipend({
      filingStatus: 'single',
      taxedHourlyRate: 30,
      weeklyHours: 40,
      dailyLodgingStipend: 165,
      dailyMieStipend: 80,
      stipendDaysPerWeek: 7,
      assignmentWeeksPerYear: 46,
      monthlyDuplicatedHousingCost: 1_600,
      roundTripTravelReimbursement: 1_000,
      permanentW2ComparisonSalary: 130_000,
    });
    expect(travel.lowTaxedBaseWarning).toBe(true);
    expect(travel.weeklyTaxFreeStipend).toBe(1_715);
    expect(travel.equivalentPermW2GrossNeeded).toBeGreaterThan(100_000);

    const loans = computeLoanStrategies({
      loanBalance: 140_000,
      interestRatePct: 6.8,
      filingStatus: 'single',
      nonprofitOrFqhcSalary: 125_000,
      privateClinicSalary: 145_000,
      nhscTier: 'fullTimeHighHpsa',
      annualSalaryGrowthPct: 3,
    });
    expect(loans).toHaveLength(4);
    const pslf = loans.find((s) => s.id === 'pslf')!;
    const nhsc = loans.find((s) => s.id === 'nhsc')!;
    const nurseCorps = loans.find((s) => s.id === 'nurse-corps')!;
    expect(pslf.awardTaxCost).toBe(0);
    expect(nhsc.forgivenOrAwardedPrincipal).toBe(NHSC_AWARD_AMOUNTS.fullTimeHighHpsa);
    expect(nhsc.awardTaxCost).toBe(0);
    expect(nurseCorps.awardTaxCost).toBeGreaterThan(0);
  });

  it('covers prescriptive authority, clinical hours CSV tracking, and malpractice tail step-rates', () => {
    expect(PRESCRIPTIVE_AUTHORITY_RULES).toHaveLength(51);
    expect(NON_COMPETE_STATE_RULES).toHaveLength(51);
    expect(CERTIFICATION_BOARD_RULES).toHaveLength(2);

    const maRule = PRESCRIPTIVE_AUTHORITY_RULES.find((r) => r.state === 'Massachusetts')!;
    expect(maRule.separateStateCsrRequired).toBe(true);

    const entries = [
      {
        id: '1',
        dateIso: '2026-10-01',
        domain: 'Adult & Chronic Care' as const,
        siteLabel: 'Metro "A" Clinic',
        preceptorInitials: 'K.P.',
        directHours: 250,
      },
    ];
    const prog = computeClinicalHoursProgress(entries, 500, 25);
    expect(prog.completionPct).toBe(50);
    expect(prog.remainingHours).toBe(250);
    expect(prog.estimatedWeeksToFinish).toBe(10);
    expect(formatClinicalHoursCsv(entries)).toContain('"Metro ""A"" Clinic"');

    const occ = computeTailCoverage({
      policyType: 'occurrence',
      matureAnnualPremium: 6_000,
      yearsOnPolicy: 5,
      tailMultiplier: 2,
      employerPaysTailPct: 0,
      contractBuyoutOrRelocationCost: 4_000,
      marginalTaxRatePct: 25,
    });
    expect(occ.grossTailPremium).toBe(0);
    expect(occ.grossedUpSigningBonusCounterAsk).toBeCloseTo(4_000 / 0.75, 2);

    const yr1Tail = computeTailCoverage({
      policyType: 'claims_made',
      matureAnnualPremium: 6_000,
      yearsOnPolicy: 1,
      tailMultiplier: 2,
      employerPaysTailPct: 0,
      contractBuyoutOrRelocationCost: 0,
      marginalTaxRatePct: 30,
    });
    const yr5Tail = computeTailCoverage({
      policyType: 'claims_made',
      matureAnnualPremium: 6_000,
      yearsOnPolicy: 5,
      tailMultiplier: 2,
      employerPaysTailPct: 0,
      contractBuyoutOrRelocationCost: 0,
      marginalTaxRatePct: 30,
    });
    expect(yr5Tail.grossTailPremium).toBeGreaterThan(yr1Tail.grossTailPremium);
  });
});
