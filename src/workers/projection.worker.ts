/**
 * Runs the forecast off the main thread.
 *
 * The Monte Carlo is hundreds of 56-year projections; doing that inline froze
 * the UI for seconds every time a slider moved. The worker keeps the page at
 * 60fps and the results land when they land.
 *
 * Requests are keyed, and the newest request of each kind wins — the UI can
 * fire one per slider tick and only the last one's result is used.
 */

import {
  amortizationRealRate,
  findWithdrawalForSuccessRate,
  medianReturnModel,
  runMonteCarlo,
  runProjection,
  safeWithdrawalRateTable,
} from '../utils/projection';
import type {
  GlidepathConfig,
  MonteCarloResult,
  ProjectionParams,
  ProjectionPoint,
  WithdrawalPolicy,
} from '../utils/projection';
import type { BudgetSummary, Expense } from '../types';

const END_OF_LIFE_AGE = 90;

/** Everything the worker needs, in a structured-cloneable shape. */
export interface EngineInputs {
  investmentInitialValue: number;
  investmentInitialGain: number;
  pensionInitialValue: number;
  returnRate: number;
  annualVolatility: number;
  inflationRate: number;
  transitionToHalfWorkYear: number;
  stopWorkYear: number;
  budgetSummary: BudgetSummary;
  monthlyExpenses: Expense[];
  yearlyExpenses: Expense[];
  propertyConfig: { price: number; year: number; monthlySavings?: number };
  equityCompanies: ProjectionParams['equityCompanies'];
  initialAge: number;
  baseYear: number;
  /** Today's calendar month (0 = January) — month 0 of the projection. */
  startMonth: number;
  glidepath: GlidepathConfig;
  withdrawalMode: 'fixed' | 'amortized' | 'dynamic';
  /** Guardrails for the dynamic rule: max real rise/fall per year. */
  maxRise: number;
  maxFall: number;
  successTarget: number;
  spendFloor: number;
  spendCap: number;
  equityConfidence: number;
  solverPaths: number;
  displayPaths: number;
}

export interface GridInputs extends Omit<EngineInputs, 'stopWorkYear' | 'transitionToHalfWorkYear'> {
  /** Years of half-time before stopping. 0 = straight from full-time to none. */
  halfTimeGap: number;
  years: number[];
}

export interface PlanResult {
  headline: number;
  failureRate: number;
  medianRuinAge: number | null;
  finalWealthRealP50: number;
  /** Median real monthly spend by age — the trajectory, not a single figure. */
  spendByAge: Record<number, number>;
  /** Median lifetime tax, today's ILS. */
  lifetimeTax: number;
  /**
   * Earliest whole year from today at which work can stop and the very first
   * retirement year already funds the lifestyle ceiling. Null when the ceiling
   * is unset, or when no retirement date in range reaches it.
   */
  earliestYearForCap: number | null;
  bands: MonteCarloResult['bands'];
  paths: number;
  points: ProjectionPoint[];
}

export interface PlansResult {
  base: PlanResult;
  upside: PlanResult;
}

export type GridRow = { year: number; base: number; upside: number };

type Request =
  | { id: number; kind: 'plans'; inputs: EngineInputs }
  | { id: number; kind: 'grid'; inputs: GridInputs };

export type Response =
  | { id: number; kind: 'plans'; result: PlansResult }
  | { id: number; kind: 'grid'; result: GridRow[] }
  | { id: number; kind: 'error'; message: string };

function paramsFor(
  i: Omit<EngineInputs, 'stopWorkYear' | 'transitionToHalfWorkYear'>,
  stopWorkYear: number,
  transitionToHalfWorkYear: number,
  equityFactor: number,
): ProjectionParams {
  return {
    investmentInitialValue: i.investmentInitialValue,
    investmentInitialGain: i.investmentInitialGain,
    pensionInitialValue: i.pensionInitialValue,
    returnModel: {
      annualReturn: i.returnRate,
      annualVolatility: i.annualVolatility,
      glidepath: i.glidepath,
    },
    inflationRate: i.inflationRate,
    transitionToHalfWorkYear,
    stopWorkYear,
    budgetSummary: i.budgetSummary,
    monthlyExpenses: i.monthlyExpenses,
    yearlyExpenses: i.yearlyExpenses,
    propertyConfig: i.propertyConfig,
    equityCompanies: i.equityCompanies,
    equityFactor,
    initialAge: i.initialAge,
    endOfLifeAge: END_OF_LIFE_AGE,
    baseYear: i.baseYear,
    startMonth: i.startMonth,
  };
}

type Inputs = Omit<EngineInputs, 'stopWorkYear' | 'transitionToHalfWorkYear'>;

/**
 * The withdrawal policy for a given set of assumptions.
 *
 * Shared by the plan cards and the retirement-age table so the two can never
 * disagree — they previously used different Monte Carlo sample sizes, which
 * made the same year read ~10% differently in the two places.
 */
function policyFor(
  i: Inputs,
  params: ProjectionParams,
  rateByAge: Record<number, number>,
): { policy: WithdrawalPolicy; solved: number } {
  if (i.withdrawalMode === 'dynamic') {
    return {
      policy: {
        kind: 'dynamic',
        rateByAge,
        realDiscountRate: amortizationRealRate(i.returnRate, i.annualVolatility, i.inflationRate),
        maxRise: i.maxRise,
        maxFall: i.maxFall,
        capMonthly: i.spendCap > 0 ? i.spendCap : undefined,
      },
      solved: 0,
    };
  }
  if (i.withdrawalMode === 'amortized') {
    return {
      policy: {
        kind: 'amortized',
        realDiscountRate: amortizationRealRate(i.returnRate, i.annualVolatility, i.inflationRate),
        floorMonthly: i.spendFloor > 0 ? i.spendFloor : undefined,
        capMonthly: i.spendCap > 0 ? i.spendCap : undefined,
      },
      solved: 0,
    };
  }
  const solved = findWithdrawalForSuccessRate(params, i.successTarget, {
    paths: i.solverPaths,
  });
  return { policy: { kind: 'fixed', monthly: solved.monthly }, solved: solved.monthly };
}

/** The headline monthly figure, plus the Monte Carlo it came from. */
function headlineFor(
  i: Inputs,
  params: ProjectionParams,
  rateByAge: Record<number, number>,
  collectBands = true,
) {
  const { policy, solved } = policyFor(i, params, rateByAge);
  const mc = runMonteCarlo(policy, params, { paths: i.displayPaths, collectBands });
  const headline =
    i.withdrawalMode === 'fixed'
      ? solved
      : Math.round(mc.spendByAge[Math.round(params.initialAge + params.stopWorkYear)] ?? mc.spend.p50);
  return { policy, mc, headline };
}

function buildPlan(
  i: EngineInputs,
  equityFactor: number,
  rateByAge: Record<number, number>,
): PlanResult {
  const params = paramsFor(i, i.stopWorkYear, i.transitionToHalfWorkYear, equityFactor);
  const { policy, mc, headline } = headlineFor(i, params, rateByAge);
  // The chart's smooth line is drawn at the geometric (median) return, not
  // the arithmetic mean: the mean path is the average of every future, pulled
  // up by a few lucky ones, and over 56 years it ended ~3x above the Monte
  // Carlo median shown on the card next to it.
  const run = runProjection(policy, { ...params, returnModel: medianReturnModel(params.returnModel) });

  // If a lifestyle ceiling is set, the interesting question stops being "how
  // much can I draw" and becomes "how soon can I stop working and still draw
  // it". Search the smallest retirement year that clears the ceiling in year
  // one; the objective is monotone in the retirement year, so bisection is safe.
  let earliestYearForCap: number | null = null;
  if (i.spendCap > 0) {
    const startsAt = (years: number): number => {
      const pr = paramsFor(i, years, Math.max(0, years - (i.stopWorkYear - i.transitionToHalfWorkYear)), equityFactor);
      return headlineFor(i, pr, rateByAge, false).headline;
    };
    let lo = 0;
    let hi = 40;
    if (startsAt(hi) >= i.spendCap) {
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (startsAt(mid) >= i.spendCap) hi = mid; else lo = mid + 1;
      }
      earliestYearForCap = lo;
    }
  }

  return {
    lifetimeTax: Math.round(mc.lifetimeTaxRealP50),
    earliestYearForCap,
    spendByAge: mc.spendByAge,
    headline,
    failureRate: mc.failureRate,
    medianRuinAge: mc.medianRuinAge,
    finalWealthRealP50: Math.round(mc.finalWealthReal.p50),
    bands: mc.bands,
    paths: mc.paths,
    points: run.points,
  };
}

function buildGrid(i: GridInputs, rateByAge: Record<number, number>): GridRow[] {
  // The table must answer the same question the plan cards do, so it follows
  // the selected withdrawal policy rather than always solving the fixed rule.
  const solve = (years: number, equityFactor: number): number => {
    const params = paramsFor(
      i,
      years,
      Math.max(0, years - i.halfTimeGap),
      equityFactor,
    );
    return headlineFor(i, params, rateByAge, false).headline;
  };

  return i.years.map((year) => ({
    year,
    base: solve(year, 0),
    upside: solve(year, i.equityConfidence),
  }));
}

/**
 * One table per request, not per plan or per grid row.
 *
 * Always anchored at `initialAge`, never at the retirement age. The table is
 * built from a bundle of random paths whose length depends on the start age,
 * so anchoring it anywhere else gives the cards and the retirement-age table
 * subtly different rates for the same year — which is exactly the card/table
 * disagreement this code has already been bitten by once.
 */
function tableFor(i: EngineInputs): Record<number, number> {
  if (i.withdrawalMode !== 'dynamic') return {};
  return safeWithdrawalRateTable(
    { annualReturn: i.returnRate, annualVolatility: i.annualVolatility, glidepath: i.glidepath },
    i.inflationRate,
    i.successTarget,
    Math.floor(i.initialAge),
    END_OF_LIFE_AGE,
  );
}

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.kind === 'plans') {
      const rateByAge = tableFor(req.inputs);
      const result: PlansResult = {
        base: buildPlan(req.inputs, 0, rateByAge),
        upside: buildPlan(req.inputs, req.inputs.equityConfidence, rateByAge),
      };
      (self as unknown as Worker).postMessage({ id: req.id, kind: 'plans', result } satisfies Response);
    } else {
      const rateByAge = tableFor(req.inputs as unknown as EngineInputs);
      const result = buildGrid(req.inputs, rateByAge);
      (self as unknown as Worker).postMessage({ id: req.id, kind: 'grid', result } satisfies Response);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: req.id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies Response);
  }
};
