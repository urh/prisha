/**
 * Forward projection engine.
 *
 * Replaces the old `runSimulation` / `findOptimalWithdrawal` pair in
 * calculations.ts. Four things changed, in rough order of how much they move
 * the answer:
 *
 *  1. **Volatility.** The old engine ran a single, perfectly smooth return
 *     path. Over a 45+ year drawdown that is not a median outcome — it is a
 *     best case dressed up as one. The engine now supports a stochastic
 *     return model and reports a distribution (percentile bands, probability
 *     of ruin, bust-age) rather than one line.
 *
 *  2. **Capital-gains tax is actually charged.** The old engine computed
 *     `taxPaid` for display but never deducted it from the balance, so a
 *     "sustainable withdrawal" was a pre-tax number being compared against
 *     post-tax spending needs. We now track cost basis alongside market value
 *     and tax only the embedded gain — which is both correct and cheaper than
 *     taxing the gross withdrawal.
 *
 *  3. **The equity scenarios are separated.** Exit proceeds are scaled by an
 *     explicit `equityFactor`, so the "if the startup equity is worth nothing"
 *     plan and the "if the exits land" plan are two runs of the same engine
 *     rather than one blended number that hides the dependency.
 *
 *  4. **Withdrawal policy is pluggable.** A fixed inflation-linked withdrawal
 *     cannot land on zero at end of life — the outcome spread is far too wide.
 *     An amortized policy (recompute each year over remaining life, like a
 *     reverse mortgage schedule) can, at the cost of a variable income. Both
 *     are supported, plus floor/cap guardrails.
 *
 * Money is nominal ILS throughout. `deflator` on each point converts to
 * today's shekels for display.
 */

import {
  CAPITAL_GAINS_TAX_BRACKETS,
  FIXED_PENSION_TAX,
  pensionAnnuityEffectiveRate,
  PROPERTY_APPRECIATION_RATE,
  calculateEarlyPensionWithdrawal,
  calculateGrossForDesiredNet,
  calculateNetEquity,
  getVestingAtDate,
  yearlyExpenseMonthlyAmount,
} from './calculations';
import type { BudgetSummary, EquityContract, Expense } from '../types';

/** USD→ILS used to value exit proceeds (share prices are quoted in USD). */
export const USD_ILS = 3.5;

/** Base Israeli capital-gains rate on the *gain* portion of a withdrawal. */
export const CGT_BASE_RATE = 0.25;
/** יסף surtax added once annual income clears the threshold. */
export const CGT_SURTAX_RATE = 0.03;

/** Default annuity conversion coefficient (מקדם המרה) at age 60. */
export const DEFAULT_ANNUITY_COEFFICIENT = 210;

/** Age at which pension converts to an annuity. */
export const PENSION_ANNUITY_AGE = 60;

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface GlidepathConfig {
  enabled: boolean;
  /** Age at which de-risking begins. */
  startAge: number;
  /** Age at which the portfolio reaches `endEquityPct`. */
  endAge: number;
  /** Equity share (0..1) at and after `endAge`. */
  endEquityPct: number;
  /** Expected nominal annual return of the non-equity sleeve, %. */
  bondReturn: number;
  /** Annual volatility of the non-equity sleeve, %. */
  bondVolatility: number;
}

export interface ReturnModel {
  /** Expected nominal annual return of the equity sleeve, %. */
  annualReturn: number;
  /**
   * Annual volatility of the equity sleeve, %. Zero reproduces the old
   * deterministic behaviour exactly.
   */
  annualVolatility: number;
  glidepath?: GlidepathConfig;
}

export type WithdrawalPolicy =
  /** Constant real withdrawal — the classic SWR shape. */
  | { kind: 'fixed'; monthly: number }
  /**
   * Amortized ("die with zero"): each year, withdraw
   * `balance / annuityFactor(remaining years)`. Cannot run out by
   * construction, but income varies with the portfolio.
   */
  | {
      kind: 'amortized';
      /** Real discount rate used to build the annuity factor, as a fraction. */
      realDiscountRate: number;
      /** Optional floor/cap in *today's* shekels (inflated internally). */
      floorMonthly?: number;
      capMonthly?: number;
    }
  /**
   * Dynamic spending with guardrails — what most advisers actually run.
   *
   * Once a year, recompute what the portfolio can safely support over the
   * remaining horizon, then limit how far this year's income may move from
   * last year's. The collar is the whole point: a pure percentage-of-portfolio
   * rule never runs out but whipsaws with the market, while a rule that only
   * ever ratchets up locks in luck and fails far more often than the fixed
   * plan it replaced (measured: 23% ruin vs 5%).
   */
  | {
      kind: 'dynamic';
      /** Safe annual withdrawal rate per ₪1 of pot, by whole age. */
      rateByAge: Record<number, number>;
      /** Real rate used only to discount the future pension into a PV. */
      realDiscountRate: number;
      /** Max fractional rise/fall in real spending year over year. */
      maxRise: number;
      maxFall: number;
      /**
       * Lifestyle ceiling in today's ILS. Spending efficiently means spending
       * a rising share of the pot as the horizon shortens — mathematically
       * right, but nobody actually spends five times as much at 80. Past this
       * point the money simply accumulates, and the honest lever is retiring
       * earlier rather than pretending it will be consumed.
       */
      capMonthly?: number;
    };

export interface EquityCompanyConfig {
  id: string;
  name: string;
  contracts: EquityContract[];
  exitYear: number;
  exitMonth?: number;
  sharePriceAtExit: number;
  secondaryIls?: number;
  secondaryYear?: number;
  secondaryMonth?: number;
  /** Shares sold in the secondary; excluded from the exit payout. */
  secondaryShares?: number;
}

export interface ProjectionParams {
  /** Market value of all non-pension assets today. */
  investmentInitialValue: number;
  /** Unrealized gain embedded in the above (drives the cost basis). */
  investmentInitialGain: number;
  pensionInitialValue: number;

  returnModel: ReturnModel;
  /** Annual inflation, %. */
  inflationRate: number;

  transitionToHalfWorkYear: number;
  stopWorkYear: number;

  budgetSummary: BudgetSummary;
  monthlyExpenses: Expense[];
  yearlyExpenses: Expense[];

  propertyConfig: { price: number; year: number; monthlySavings?: number };

  equityCompanies: EquityCompanyConfig[];
  /**
   * Scales *all* exit and secondary proceeds. 0 = assume the startup equity
   * is worth nothing (the base plan); 1 = the full modelled exits.
   */
  equityFactor: number;

  initialAge: number;
  endOfLifeAge: number;
  baseYear?: number;
  /**
   * Calendar month (0 = January) that month 0 of the projection falls in.
   * The balances are a snapshot of *today*, so month 0 must be today's month:
   * starting the clock in January replayed the months already lived — their
   * savings were counted twice and every dated event (secondaries, exits,
   * retirement) moved later by the months elapsed.
   */
  startMonth?: number;

  /** Annuity conversion coefficient at 60. Higher = smaller monthly annuity. */
  annuityCoefficient?: number;
  /**
   * People drawing the pension. The exemption, the credits and the tax
   * brackets all apply per person, so two recipients splitting one pot pay
   * materially less than one. Defaults to a couple.
   */
  pensionRecipients?: number;
}

export interface ProjectionPoint {
  index: number;
  label: string;
  fullAge: string;
  /** Nominal→real conversion factor for this month. */
  deflator: number;
  totalLegacy: number;
  liquidWealth: number;
  investments: number;
  pension: number;
  property: number;
  monthlyOutflow: number;
  monthlySavings: number;
  pensionContribution: number;
  studyFundContribution: number;
  currentIncome: number;
  incomeSource: string;
  event: string | null;
  withdrawalFromInvestments: number;
  withdrawalFromPension: number;
  pensionAnnuity: number;
  taxPaid: number;
}

export interface ProjectionRun {
  points: ProjectionPoint[];
  /** True if liquid wealth hit zero before end of life. */
  ruined: boolean;
  /** Age at ruin, or null. */
  ruinAge: number | null;
  /** Nominal liquid wealth at end of life. */
  finalWealth: number;
  /** Real (today's ILS) liquid wealth at end of life. */
  finalWealthReal: number;
  /** Realized withdrawals in today's ILS, retirement months only. */
  realWithdrawals: number[];
  /** Same, split at the age the pension annuity starts. */
  realWithdrawalsBeforeAnnuity: number[];
  realWithdrawalsFromAnnuity: number[];
  /** Real monthly withdrawal sampled at each whole age, for the trajectory. */
  realWithdrawalByAge: Record<number, number>;
  /** Total tax paid over the whole projection, in today's ILS. */
  lifetimeTaxReal: number;
}

// ---------------------------------------------------------------------------
// Deterministic RNG — results must not jitter between renders.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function standardNormal(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Return paths
// ---------------------------------------------------------------------------

/** Equity share of the portfolio at a given age, per the glidepath. */
export function equityShareAtAge(age: number, gp?: GlidepathConfig): number {
  if (!gp || !gp.enabled) return 1;
  if (age <= gp.startAge) return 1;
  if (age >= gp.endAge) return gp.endEquityPct;
  const t = (age - gp.startAge) / Math.max(1e-9, gp.endAge - gp.startAge);
  return 1 + t * (gp.endEquityPct - 1);
}

/**
 * Blended expected return and volatility for a month, honouring the glidepath.
 * Volatility blends by weight (a conservative simplification — it ignores the
 * small diversification benefit from imperfect stock/bond correlation).
 */
export function blendedMoments(
  age: number,
  model: ReturnModel,
): { mu: number; sigma: number } {
  const w = equityShareAtAge(age, model.glidepath);
  const gp = model.glidepath;
  const bondRet = gp?.enabled ? gp.bondReturn : model.annualReturn;
  const bondVol = gp?.enabled ? gp.bondVolatility : model.annualVolatility;
  return {
    mu: (w * model.annualReturn + (1 - w) * bondRet) / 100,
    sigma: (w * model.annualVolatility + (1 - w) * bondVol) / 100,
  };
}

/**
 * Monthly gross returns for one path.
 *
 * Lognormal: the arithmetic mean is preserved by subtracting half the variance
 * from the log drift, so raising volatility does not secretly raise the
 * expected return.
 */
export function buildReturnPath(
  months: number,
  initialAge: number,
  model: ReturnModel,
  rand: (() => number) | null,
): Float64Array {
  const path = new Float64Array(months + 1);
  for (let m = 0; m <= months; m++) {
    const age = initialAge + m / 12;
    const { mu, sigma } = blendedMoments(age, model);
    if (!rand || sigma <= 0) {
      path[m] = Math.pow(1 + mu, 1 / 12) - 1;
    } else {
      const varM = (sigma * sigma) / 12;
      const drift = Math.log(1 + mu) / 12 - 0.5 * varM;
      path[m] = Math.exp(drift + Math.sqrt(varM) * standardNormal(rand)) - 1;
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// Tax-aware withdrawal
// ---------------------------------------------------------------------------

/**
 * Marginal capital-gains rate on the NEXT shekel of gain, given taxable income
 * already recognised this calendar year.
 *
 * מס יסף is marginal, not a cliff: it applies to the income above the
 * threshold, not retroactively to all of it. This used to return a flat 28%
 * the moment income crossed ~₪721k, which over-taxed every withdrawal just
 * past the line and disagreed with how exits are taxed
 * (`calculateNetEquity`, which always used the brackets properly).
 */
export function cgtRate(ytdTaxableIncome: number): number {
  for (const bracket of CAPITAL_GAINS_TAX_BRACKETS) {
    if (ytdTaxableIncome < bracket.upTo) return bracket.rate;
  }
  return CAPITAL_GAINS_TAX_BRACKETS[CAPITAL_GAINS_TAX_BRACKETS.length - 1].rate;
}

interface Ledger {
  inv: number;
  /** Cost basis of `inv`. Only (inv - basis) is taxable on withdrawal. */
  basis: number;
  pen: number;
}

/**
 * Withdraw enough gross from investments to net `netWanted`.
 *
 * Only the embedded gain is taxed, so the effective rate on the withdrawal is
 * `cgt * gainFraction`, not `cgt`. Basis is drawn down pro-rata, which is the
 * standard average-cost treatment.
 */
export function withdrawNetFromInvestments(
  L: Ledger,
  netWanted: number,
  ytdTaxableIncome: number,
): { gross: number; net: number; tax: number; gainRealized: number } {
  if (netWanted <= 0 || L.inv <= 0) return { gross: 0, net: 0, tax: 0, gainRealized: 0 };

  const gain = Math.max(0, L.inv - L.basis);
  const gainFraction = L.inv > 0 ? gain / L.inv : 0;
  const effRate = cgtRate(ytdTaxableIncome) * gainFraction;

  const grossWanted = netWanted / Math.max(1e-9, 1 - effRate);
  const gross = Math.min(grossWanted, L.inv);
  const tax = gross * effRate;
  const net = gross - tax;

  const basisShare = L.inv > 0 ? L.basis / L.inv : 0;
  L.basis = Math.max(0, L.basis - gross * basisShare);
  L.inv = Math.max(0, L.inv - gross);

  return { gross, net, tax, gainRealized: gross * gainFraction };
}

/**
 * Real return to amortize against — the *median* outcome, not the mean.
 *
 * Volatility drags the median below the arithmetic average (a portfolio that
 * gains 20% then loses 20% is down 4%). Amortizing at the arithmetic mean
 * therefore front-loads spending and guarantees a declining income: the median
 * path simply never earns what the schedule assumed. Using the geometric mean
 * keeps median real spending roughly flat, which is what "die with zero"
 * should feel like.
 */
export function amortizationRealRate(
  annualReturnPct: number,
  annualVolatilityPct: number,
  inflationPct: number,
): number {
  const mu = annualReturnPct / 100;
  const sigma = annualVolatilityPct / 100;
  const geometricNominal = Math.exp(Math.log(1 + mu) - 0.5 * sigma * sigma) - 1;
  return Math.max(0, (1 + geometricNominal) / (1 + inflationPct / 100) - 1);
}

/**
 * The return model whose smooth, zero-volatility path tracks the *median*
 * Monte Carlo outcome rather than the mean.
 *
 * A deterministic run at the arithmetic mean (10%) is the *average* future,
 * and for a lognormal that average is pulled up by a few very lucky paths:
 * over 56 years it ended ~3x above the Monte Carlo median for the same plan,
 * so the chart's "at 90" box said ₪200M while the card next to it said ₪70M.
 * Compounding at the geometric mean ((1+μ)·e^(−σ²/2) − 1) gives the typical
 * path instead, which is the one worth drawing.
 */
export function medianReturnModel(model: ReturnModel): ReturnModel {
  const mu = model.annualReturn / 100;
  const sigma = model.annualVolatility / 100;
  const geometric = (1 + mu) * Math.exp(-0.5 * sigma * sigma) - 1;
  return { ...model, annualReturn: geometric * 100 };
}

/** Annuity factor: PV of 1/year for `years` at `rate` (real). */
export function annuityFactor(years: number, rate: number): number {
  const n = Math.max(1 / 12, years);
  if (Math.abs(rate) < 1e-9) return n;
  return (1 - Math.pow(1 + rate, -n)) / rate;
}

/**
 * Safe annual withdrawal rate per ₪1 of portfolio, by remaining horizon.
 *
 * A plain Monte Carlo on a unit pot — no pension, no salary, no expenses —
 * which is exactly the question the dynamic rule asks each year: "given this
 * balance and this many years left, what can it support?" Built once per set
 * of assumptions and reused across every path.
 */
export function safeWithdrawalRateTable(
  model: ReturnModel,
  inflationRate: number,
  successTarget: number,
  fromAge: number,
  endOfLifeAge: number,
  opts: { paths?: number; seed?: number } = {},
): Record<number, number> {
  const paths = opts.paths ?? 300;
  const seed = opts.seed ?? 9090;

  const start = Math.floor(fromAge);
  const maxMonths = Math.max(1, Math.round((endOfLifeAge - start) * 12));

  // Real monthly growth moments at each absolute month, honouring the
  // glidepath. The table used to assume 100% equity at every age, so with
  // de-risking on it sized withdrawals for returns the portfolio no longer had.
  const driftAt = new Float64Array(maxMonths);
  const volAt = new Float64Array(maxMonths);
  for (let k = 0; k < maxMonths; k++) {
    const { mu, sigma } = blendedMoments(start + k / 12, model);
    const realMean = (1 + mu) / (1 + inflationRate / 100) - 1;
    const varM = (sigma * sigma) / 12;
    driftAt[k] = Math.log(1 + realMean) / 12 - 0.5 * varM;
    volAt[k] = Math.sqrt(varM);
  }

  // Draw the return paths ONCE and reuse them for every age and every step of
  // every binary search. Regenerating them inside the search meant tens of
  // millions of log/cos calls per request, which is what made the table — not
  // the Monte Carlo that consumes it — the slowest thing in the worker.
  // Month k of a path is the return at absolute age start + k/12, so a pot
  // starting at `age` reads the bundle from offset (age - start) * 12.
  const bundle = new Float64Array(paths * maxMonths);
  const rand = mulberry32(seed);
  for (let p = 0; p < paths; p++) {
    for (let k = 0; k < maxMonths; k++) {
      bundle[p * maxMonths + k] =
        volAt[k] > 0
          ? Math.exp(driftAt[k] + volAt[k] * standardNormal(rand))
          : Math.exp(driftAt[k]);
    }
  }

  const failureAt = (rate: number, months: number, offset: number): number => {
    const w = rate / 12;
    let fails = 0;
    for (let p = 0; p < paths; p++) {
      const base = p * maxMonths + offset;
      let pot = 1;
      for (let m = 0; m < months; m++) {
        pot *= bundle[base + m];
        if (pot <= w) { fails++; break; }
        pot -= w;
      }
    }
    return fails / paths;
  };

  const maxFailure = 1 - successTarget;
  const table: Record<number, number> = {};
  for (let age = start; age < endOfLifeAge; age++) {
    const offset = (age - start) * 12;
    const months = Math.min(maxMonths - offset, Math.max(12, Math.round((endOfLifeAge - age) * 12)));
    let lo = 0;
    let hi = 1;
    let best = 0;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (failureAt(mid, months, offset) <= maxFailure) { best = mid; lo = mid; } else hi = mid;
    }
    table[age] = best;
  }
  return table;
}

// ---------------------------------------------------------------------------
// Equity proceeds
// ---------------------------------------------------------------------------

/** Net ILS from exits/secondaries, per month index. Scaled by `equityFactor`. */
export function buildEquityInflows(
  companies: EquityCompanyConfig[],
  totalMonths: number,
  baseYear: number,
  equityFactor: number,
  startMonth = 0,
): { flows: Float64Array; labels: Record<number, string[]> } {
  const flows = new Float64Array(totalMonths + 1);
  const labels: Record<number, string[]> = {};
  if (equityFactor <= 0) return { flows, labels };

  const exited = new Set<string>();
  const paidSecondary = new Set<string>();
  const prevVested: Record<string, number> = {};
  companies.forEach((c) => {
    prevVested[c.id] = 0;
  });

  const push = (m: number, label: string) => {
    (labels[m] ||= []).push(label);
  };

  for (let m = 0; m <= totalMonths; m++) {
    const date = new Date(baseYear, startMonth + m, 1);
    const year = date.getFullYear();

    for (const co of companies) {
      if (
        co.secondaryIls &&
        co.secondaryYear &&
        year === co.secondaryYear &&
        date.getMonth() === (co.secondaryMonth ?? 1) - 1 &&
        !paidSecondary.has(co.id)
      ) {
        flows[m] += co.secondaryIls * equityFactor;
        paidSecondary.add(co.id);
        push(m, `סקנדרי ${co.name}`);
      }

      if (co.contracts.length === 0 || co.sharePriceAtExit <= 0) continue;

      const vest = getVestingAtDate(co.contracts, date);
      const vested = vest.totalVested;
      // Shares sold in an already-paid secondary aren't there at the exit.
      const sold = paidSecondary.has(co.id) ? Math.min(vested, co.secondaryShares ?? 0) : 0;

      const isExitMonth =
        year === co.exitYear && date.getMonth() === (co.exitMonth ?? 1) - 1;

      if (isExitMonth && !exited.has(co.id)) {
        const held = vested - sold;
        const heldCost = vested > 0 ? vest.totalCost * (held / vested) : 0;
        const gross = held * co.sharePriceAtExit * USD_ILS - heldCost * USD_ILS;
        flows[m] += calculateNetEquity(gross) * equityFactor;
        exited.add(co.id);
        prevVested[co.id] = vested;
        push(m, `אקזיט ${co.name}`);
      } else if (exited.has(co.id)) {
        const newly = vested - prevVested[co.id];
        if (newly > 0) {
          const avgStrike = vested > 0 ? vest.totalCost / vested : 0;
          const gross =
            newly * co.sharePriceAtExit * USD_ILS - newly * avgStrike * USD_ILS;
          flows[m] += calculateNetEquity(gross) * equityFactor;
          prevVested[co.id] = vested;
        }
      }
    }
  }

  return { flows, labels };
}

// ---------------------------------------------------------------------------
// Core projection
// ---------------------------------------------------------------------------

interface RunOptions {
  /** Pre-built return path; built deterministically when omitted. */
  returnPath?: Float64Array;
  /** Skip building the (heavy) points array — Monte Carlo only needs scalars. */
  collectPoints?: boolean;
  /** Pre-built equity inflows, to avoid rebuilding per Monte Carlo path. */
  equity?: { flows: Float64Array; labels: Record<number, string[]> };
}

export function runProjection(
  policy: WithdrawalPolicy,
  params: ProjectionParams,
  opts: RunOptions = {},
): ProjectionRun {
  const {
    investmentInitialValue,
    investmentInitialGain,
    pensionInitialValue,
    returnModel,
    inflationRate,
    transitionToHalfWorkYear,
    stopWorkYear,
    budgetSummary,
    monthlyExpenses,
    yearlyExpenses,
    propertyConfig,
    equityCompanies,
    equityFactor,
    initialAge,
    endOfLifeAge,
  } = params;

  const baseYear = params.baseYear ?? new Date().getFullYear();
  const startMonth = params.startMonth ?? 0;
  const annuityCoeff = params.annuityCoefficient ?? DEFAULT_ANNUITY_COEFFICIENT;
  const pensionRecipients = params.pensionRecipients ?? 2;
  const collectPoints = opts.collectPoints !== false;
  const totalMonths = Math.max(0, (endOfLifeAge - initialAge) * 12);

  const equity =
    opts.equity ??
    buildEquityInflows(equityCompanies, totalMonths, baseYear, equityFactor, startMonth);
  const returnPath =
    opts.returnPath ??
    buildReturnPath(totalMonths, initialAge, returnModel, null);

  const monthlyInflation = Math.pow(1 + inflationRate / 100, 1 / 12);

  const recurringMonthly =
    (monthlyExpenses || []).reduce(
      (s, e) => s + (parseFloat(String(e.amount)) || 0),
      0,
    ) +
    (yearlyExpenses || []).reduce(
      (s, e) => s + yearlyExpenseMonthlyAmount(e, false),
      0,
    );

  const savingsAfterProperty = propertyConfig.monthlySavings || 0;

  const L: Ledger = {
    inv: investmentInitialValue,
    basis: Math.max(0, investmentInitialValue - Math.max(0, investmentInitialGain)),
    pen: pensionInitialValue,
  };

  let propValue = 0;
  let propertyBought = false;
  let annuity = 0;
  let currentAmortWithdrawal = 0;
  // מס יסף is assessed on the calendar year's income, so the bracket the next
  // shekel of gain falls into depends on what has already been recognised this
  // year. Reset every January.
  let ytdTaxableIncome = 0;
  // Effective annuity tax rate, fixed at conversion. The annuity and the
  // exemption ceiling are both CPI-indexed, so the rate does not drift.
  let annuityTaxRate = FIXED_PENSION_TAX;
  // Accumulated in today's ILS so it can be compared against anything else.
  let lifetimeTaxReal = 0;

  const points: ProjectionPoint[] = [];
  const realWithdrawals: number[] = [];
  const realWithdrawalsBeforeAnnuity: number[] = [];
  const realWithdrawalsFromAnnuity: number[] = [];
  const realWithdrawalByAge: Record<number, number> = {};
  let ruined = false;
  let ruinAge: number | null = null;

  for (let m = 0; m <= totalMonths; m++) {
    const date = new Date(baseYear, startMonth + m, 1);
    const year = date.getFullYear();
    const yearsPassed = m / 12;
    const age = initialAge + yearsPassed;
    const deflator = Math.pow(monthlyInflation, m);
    const events: string[] = [];
    // The tax year is the calendar year, not the projection year.
    if (date.getMonth() === 0) ytdTaxableIncome = 0;

    let income = 0;
    let source = 'שכר';
    let taxPaid = 0;
    let fromInvestments = 0;
    let fromPension = 0;
    let currentAnnuity = 0;
    let pensionContribution = 0;
    let studyFundContribution = 0;
    let monthlyOut = 0;

    // One-time yearly items are deliberately absent: they are this year's
    // already-paid spend (the war trip), so today's balances already reflect
    // them. Deducting them again at month 0 double-counted every one.

    // Equity proceeds arrive net of tax, so they carry full basis.
    if (equity.flows[m] > 0) {
      L.inv += equity.flows[m];
      L.basis += equity.flows[m];
      const lbl = equity.labels[m];
      if (lbl) events.push(...lbl);
    }

    // Property. Buying is a real sale of securities, so it realizes gains —
    // the old engine took the price straight off the balance untaxed.
    const ownsProperty = year >= propertyConfig.year;
    if (ownsProperty) {
      // Bought in the first projected month of the purchase year — January,
      // or month 0 when the purchase year is the current one.
      if (!propertyBought) {
        propertyBought = true;
        const buy = withdrawNetFromInvestments(L, propertyConfig.price, ytdTaxableIncome);
        ytdTaxableIncome += buy.gainRealized;
        taxPaid += buy.tax;
        propValue = propertyConfig.price;
        events.push('רכישת דירה');
      } else {
        propValue *= Math.pow(1 + PROPERTY_APPRECIATION_RATE, 1 / 12);
      }
    }

    const baseExpense =
      (ownsProperty ? recurringMonthly - savingsAfterProperty : recurringMonthly) *
      deflator;

    const r = returnPath[Math.min(m, returnPath.length - 1)];

    if (yearsPassed < stopWorkYear) {
      // --- Working phase -------------------------------------------------
      const fullTime = yearsPassed < transitionToHalfWorkYear;
      // Salary and contributions are today's figures, so they move with CPI
      // exactly as expenses do. Holding them flat in nominal terms meant a
      // silent 2.5%-a-year real pay cut: after ten years the household was
      // saving almost nothing while every label claimed today's shekels.
      income = fullTime ? budgetSummary.totalIncomeNet * deflator : baseExpense;
      source = fullTime ? 'שכר מלא' : 'חצי משרה';
      monthlyOut = baseExpense;

      const pensionInflow = budgetSummary.totalPensionInflow * deflator;
      const studyInflow = (budgetSummary.totalStudyFundInflow || 0) * deflator;
      pensionContribution = fullTime ? pensionInflow : pensionInflow / 2;
      studyFundContribution = fullTime ? studyInflow : studyInflow / 2;

      L.pen = L.pen * (1 + r) + pensionContribution;

      const contribution = income - monthlyOut + studyFundContribution;
      L.inv = L.inv * (1 + r) + contribution;
      // Fresh contributions arrive already taxed → they add basis.
      L.basis += Math.max(0, contribution);
    } else {
      // --- Retirement phase ----------------------------------------------
      L.inv *= 1 + r;
      if (age < PENSION_ANNUITY_AGE) L.pen *= 1 + r;

      if (age >= PENSION_ANNUITY_AGE && L.pen > 0 && annuity === 0) {
        const grossAnnuity = L.pen / annuityCoeff;
        annuityTaxRate = pensionAnnuityEffectiveRate(grossAnnuity / deflator, {
          recipients: pensionRecipients,
        });
        annuity = grossAnnuity * (1 - annuityTaxRate);
        L.pen = 0;
        events.push('המרה לקצבת פנסיה');
      }
      if (annuity > 0) {
        annuity *= monthlyInflation;
        currentAnnuity = annuity;
      }

      // Decide the target withdrawal for this month.
      let target: number;
      if (policy.kind === 'fixed') {
        target = policy.monthly * deflator;
      } else {
        // Re-plan annually (and on the first retirement month).
        if (m % 12 === 0 || currentAmortWithdrawal === 0) {
          const rate = policy.realDiscountRate;
          const remainingYears = Math.max(1 / 12, endOfLifeAge - age);
          const af = annuityFactor(remainingYears, rate);
          // Spendable, not market value: selling to fund a withdrawal realizes
          // the embedded gain, so the pot is worth less than it displays.
          // Sizing withdrawals off the gross value made the target unfundable
          // once tax was charged, which the ruin check then flagged as failure.
          const gainFraction =
            L.inv > 0 ? Math.max(0, L.inv - L.basis) / L.inv : 0;
          const netOfTax = 1 - CGT_BASE_RATE * gainFraction;
          const investmentsReal = (Math.max(0, L.inv) / deflator) * netOfTax;
          const annuityIncomeReal = annuity / deflator;

          // The pension is locked until 60, but it is not unknown — it is a
          // balance we own with a known conversion rule. Amortizing only the
          // investment pot therefore produced a step function: ~₪11k/month
          // from retirement to 59, then ~₪70k the moment the annuity starts.
          // No one wants to live that. Instead we bring the *present value* of
          // the future annuity into the pot being amortized, which lets the
          // early years draw down investments faster against income that is
          // genuinely coming. The result is roughly level spending for life.
          let pensionPresentValue = 0;
          if (annuity <= 0 && L.pen > 0) {
            const yearsToAnnuity = Math.max(0, PENSION_ANNUITY_AGE - age);
            const pensionRealAtSixty =
              (L.pen / deflator) * Math.pow(1 + rate, yearsToAnnuity);
            const grossAnnuityReal = pensionRealAtSixty / annuityCoeff;
            const monthlyAnnuityReal =
              grossAnnuityReal *
              (1 - pensionAnnuityEffectiveRate(grossAnnuityReal, { recipients: pensionRecipients }));
            // PV of a level stream that only starts at 60: the full-horizon
            // annuity factor minus the years we will not be receiving it.
            const deferred = Math.max(
              0,
              af - annuityFactor(Math.min(yearsToAnnuity, remainingYears), rate),
            );
            pensionPresentValue = monthlyAnnuityReal * 12 * deferred;
          }

          // How much of the pot may be spent this year, per ₪1. The amortized
          // rule derives it from the annuity factor; the dynamic rule takes it
          // from a Monte-Carlo-calibrated table, so the confidence target the
          // user picked actually drives the number.
          const perYearRate =
            policy.kind === 'dynamic'
              ? policy.rateByAge[Math.min(endOfLifeAge - 1, Math.floor(age))] ?? 1 / af
              : 1 / af;

          let fresh =
            ((investmentsReal + pensionPresentValue) * perYearRate) / 12 + annuityIncomeReal;

          // Guardrails: cap how far this year's income may move from last
          // year's. Without them the same rule whipsaws with the market.
          if (policy.kind === 'dynamic' && currentAmortWithdrawal > 0) {
            const ceiling = currentAmortWithdrawal * (1 + policy.maxRise);
            const floor = currentAmortWithdrawal * (1 - policy.maxFall);
            fresh = Math.max(Math.min(fresh, ceiling), floor);
          }

          currentAmortWithdrawal = fresh;

          // Bridge constraint. Smoothing against the pension is only safe if
          // the *accessible* money actually lasts until the annuity starts —
          // otherwise the plan quietly relies on raiding the pension early at
          // 31–52%, and a mediocre decade empties the bridge. So before 60 the
          // draw is also capped at what the investment pot alone can sustain
          // to age 60. When this binds, income is lower before 60 and steps up
          // after; that step is real information, not something to hide.
          if (annuity <= 0 && L.pen > 0) {
            const yearsToAnnuity = Math.max(0, PENSION_ANNUITY_AGE - age);
            if (yearsToAnnuity > 0) {
              // Amortize the bridge at 0% real — assume it does not grow. The
              // bridge has no second chance: if it empties at 57 the pension
              // is still three years away and the only way out is an early
              // raid at 31–52%. Pricing in expected growth here plans it to
              // exactly zero, which a single mediocre decade then undershoots.
              const bridgeCeiling = investmentsReal / (yearsToAnnuity * 12);
              currentAmortWithdrawal = Math.min(currentAmortWithdrawal, bridgeCeiling);
            }
          }
          if (policy.kind === 'dynamic' && policy.capMonthly != null && policy.capMonthly > 0) {
            currentAmortWithdrawal = Math.min(currentAmortWithdrawal, policy.capMonthly);
          }
          if (policy.kind === 'amortized') {
            if (policy.floorMonthly != null) {
              currentAmortWithdrawal = Math.max(currentAmortWithdrawal, policy.floorMonthly);
            }
            if (policy.capMonthly != null) {
              currentAmortWithdrawal = Math.min(currentAmortWithdrawal, policy.capMonthly);
            }
          }
        }
        target = currentAmortWithdrawal * deflator;
      }

      monthlyOut = target;

      // The annuity covers the first slice for free.
      let stillNeeded = target;
      if (annuity > 0) {
        const used = Math.min(annuity, target);
        fromPension += used;
        income += used;
        stillNeeded -= used;
        // Annuity tax was already withheld at conversion.
        const annuityGross = used / Math.max(1e-9, 1 - annuityTaxRate);
        taxPaid += annuityGross * annuityTaxRate;
        ytdTaxableIncome += annuityGross;
        if (annuity > target) {
          // Surplus annuity is reinvested (already taxed → full basis).
          const surplus = annuity - target;
          L.inv += surplus;
          L.basis += surplus;
        }
        source = stillNeeded > 0 ? 'קצבה + השקעות' : 'קצבת פנסיה';
      }

      if (stillNeeded > 0) {
        const fromInv = withdrawNetFromInvestments(L, stillNeeded, ytdTaxableIncome);
        fromInvestments = fromInv.gross;
        ytdTaxableIncome += fromInv.gainRealized;
        taxPaid += fromInv.tax;
        stillNeeded -= fromInv.net;
        if (annuity <= 0) source = 'משיכה מהשקעות';
      }

      if (stillNeeded > 1 && L.pen > 0 && age < PENSION_ANNUITY_AGE) {
        // Early pension raid — taxed at the non-employment brackets. The
        // balance may not cover the gross we'd need, so recompute the net we
        // actually get from whatever we can take rather than assuming it.
        const grossAnnual = calculateGrossForDesiredNet(stillNeeded * 12, 0);
        const grossMonthly = Math.min(grossAnnual / 12, L.pen);
        const { netAmount } = calculateEarlyPensionWithdrawal(grossMonthly * 12, 0);
        const netGot = Math.min(stillNeeded, netAmount / 12);
        L.pen = Math.max(0, L.pen - grossMonthly);
        fromPension += grossMonthly;
        taxPaid += grossMonthly - netGot;
        ytdTaxableIncome += grossMonthly;
        stillNeeded -= netGot;
        source = 'משיכה מהון + פנסיה';
      }

      // Ruin means "could not fund the target spend, materially, with life
      // left to live". A few shekels short counts as rounding, and an
      // amortized plan is *designed* to hit zero in its final year — neither
      // is a failed retirement.
      const shortfallTolerance = Math.max(1, target * 0.005);
      if (
        stillNeeded > shortfallTolerance &&
        !ruined &&
        age < endOfLifeAge - 1
      ) {
        ruined = true;
        ruinAge = age;
      }

      const realTarget = target / deflator;
      realWithdrawals.push(realTarget);
      const wholeAge = Math.round(age);
      if (Math.abs(age - wholeAge) < 0.5 / 12 && realWithdrawalByAge[wholeAge] == null) {
        realWithdrawalByAge[wholeAge] = realTarget;
      }
      if (age < PENSION_ANNUITY_AGE) realWithdrawalsBeforeAnnuity.push(realTarget);
      else realWithdrawalsFromAnnuity.push(realTarget);
    }

    lifetimeTaxReal += taxPaid / deflator;
    const liquidWealth = Math.max(0, L.inv) + Math.max(0, L.pen);
    if (!ruined && liquidWealth <= 0 && yearsPassed >= stopWorkYear && age < endOfLifeAge - 1) {
      ruined = true;
      ruinAge = age;
    }

    // Quarterly after year 3, on calendar quarters so every January is kept
    // (the chart's year ticks are anchored on January points), plus every
    // anniversary of today, where the retirement and age-60 markers sit, and
    // any month with an event so its marker is never sampled away.
    const keepPoint = m < 36 || m % 12 === 0 || date.getMonth() % 3 === 0 || events.length > 0 || m === totalMonths;
    if (collectPoints && keepPoint) {
      points.push({
        index: m,
        label: `${date.getMonth() + 1}/${date.getFullYear()}`,
        fullAge: age.toFixed(1),
        deflator,
        totalLegacy: Math.round(liquidWealth + propValue),
        liquidWealth: Math.round(liquidWealth),
        investments: Math.round(Math.max(0, L.inv)),
        pension: Math.round(Math.max(0, L.pen)),
        property: Math.round(propValue),
        monthlyOutflow: Math.round(monthlyOut),
        monthlySavings: Math.round(income - monthlyOut),
        pensionContribution: Math.round(pensionContribution),
        studyFundContribution: Math.round(studyFundContribution),
        currentIncome: Math.round(income),
        incomeSource: source,
        event: events.length ? events.join(' + ') : null,
        withdrawalFromInvestments: Math.round(fromInvestments),
        withdrawalFromPension: Math.round(fromPension),
        pensionAnnuity: Math.round(currentAnnuity),
        taxPaid: Math.round(taxPaid),
      });
    }
  }

  const finalWealth = Math.max(0, L.inv) + Math.max(0, L.pen);
  const finalDeflator = Math.pow(monthlyInflation, totalMonths);

  return {
    points,
    ruined,
    ruinAge,
    finalWealth,
    finalWealthReal: finalWealth / finalDeflator,
    realWithdrawals,
    realWithdrawalsBeforeAnnuity,
    realWithdrawalsFromAnnuity,
    realWithdrawalByAge,
    lifetimeTaxReal,
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

export interface MonteCarloOptions {
  paths?: number;
  seed?: number;
  /**
   * Collect the percentile bands. Only the two plan cards draw them; the
   * retirement-age table needs a single number per cell, and building the
   * per-month samples for ten cells dominated the whole request.
   */
  collectBands?: boolean;
}

export interface PercentileBand {
  index: number;
  label: string;
  fullAge: string;
  deflator: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  paths: number;
  /** Share of paths that ran out of money before end of life. */
  failureRate: number;
  /** Median age at ruin among failing paths, or null. */
  medianRuinAge: number | null;
  /** Real end-of-life wealth percentiles. */
  finalWealthReal: { p10: number; p50: number; p90: number };
  /**
   * Real monthly spend percentiles — meaningful for amortized policies.
   * `beforeAnnuityP50` / `fromAnnuityP50` split at 60, because a plan whose
   * income steps at 60 is badly described by one blended median.
   */
  spend: {
    p10: number;
    p50: number;
    p90: number;
    worstYearP50: number;
    beforeAnnuityP50: number;
    fromAnnuityP50: number;
  };
  /** Median real monthly spend at each whole age, across paths. */
  spendByAge: Record<number, number>;
  /** Median lifetime tax paid, in today's ILS. */
  lifetimeTaxRealP50: number;
  /** Real liquid-wealth bands over time, sampled on the same grid as points. */
  bands: PercentileBand[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function runMonteCarlo(
  policy: WithdrawalPolicy,
  params: ProjectionParams,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  const paths = Math.max(1, opts.paths ?? 500);
  const seed = opts.seed ?? 12345;
  const collectBands = opts.collectBands !== false;
  const totalMonths = Math.max(0, (params.endOfLifeAge - params.initialAge) * 12);
  const baseYear = params.baseYear ?? new Date().getFullYear();

  // Built once and shared — it does not depend on the return path.
  const equity = buildEquityInflows(
    params.equityCompanies,
    totalMonths,
    baseYear,
    params.equityFactor,
    params.startMonth ?? 0,
  );

  const rand = mulberry32(seed);
  const failures: number[] = [];
  const finals: number[] = [];
  const medSpend: number[] = [];
  const worstSpend: number[] = [];
  const beforeSpend: number[] = [];
  const fromSpend: number[] = [];
  const spendSamplesByAge: Record<number, number[]> = {};
  const lifetimeTax: number[] = [];
  let failCount = 0;

  // Wealth samples per grid month, for the bands.
  let gridIndices: number[] = [];
  let gridMeta: Array<{ label: string; fullAge: string; deflator: number }> = [];
  let wealthByGrid: number[][] = [];

  for (let p = 0; p < paths; p++) {
    const returnPath = buildReturnPath(
      totalMonths,
      params.initialAge,
      params.returnModel,
      rand,
    );
    const run = runProjection(policy, params, {
      returnPath,
      equity,
      collectPoints: collectBands,
    });

    if (collectBands && p === 0) {
      gridIndices = run.points.map((pt) => pt.index);
      gridMeta = run.points.map((pt) => ({
        label: pt.label,
        fullAge: pt.fullAge,
        deflator: pt.deflator,
      }));
      wealthByGrid = gridIndices.map(() => []);
    }
    if (collectBands) {
      run.points.forEach((pt, i) => {
        if (wealthByGrid[i]) wealthByGrid[i].push(pt.liquidWealth / pt.deflator);
      });
    }

    if (run.ruined) {
      failCount++;
      if (run.ruinAge != null) failures.push(run.ruinAge);
    }
    finals.push(run.finalWealthReal);
    lifetimeTax.push(run.lifetimeTaxReal);

    if (run.realWithdrawals.length) {
      const sortedW = [...run.realWithdrawals].sort((a, b) => a - b);
      medSpend.push(quantile(sortedW, 0.5));
      worstSpend.push(sortedW[0]);
    }
    if (run.realWithdrawalsBeforeAnnuity.length) {
      const s1 = [...run.realWithdrawalsBeforeAnnuity].sort((a, b) => a - b);
      beforeSpend.push(quantile(s1, 0.5));
    }
    for (const [ageKey, value] of Object.entries(run.realWithdrawalByAge)) {
      (spendSamplesByAge[Number(ageKey)] ||= []).push(value);
    }
    if (run.realWithdrawalsFromAnnuity.length) {
      const s2 = [...run.realWithdrawalsFromAnnuity].sort((a, b) => a - b);
      fromSpend.push(quantile(s2, 0.5));
    }
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  const sortedMed = [...medSpend].sort((a, b) => a - b);
  const sortedWorst = [...worstSpend].sort((a, b) => a - b);
  const sortedRuin = [...failures].sort((a, b) => a - b);
  const sortedBefore = [...beforeSpend].sort((a, b) => a - b);
  const sortedFrom = [...fromSpend].sort((a, b) => a - b);

  const spendByAge: Record<number, number> = {};
  for (const [ageKey, samples] of Object.entries(spendSamplesByAge)) {
    spendByAge[Number(ageKey)] = quantile([...samples].sort((a, b) => a - b), 0.5);
  }

  const bands: PercentileBand[] = gridIndices.map((index, i) => {
    const s = [...wealthByGrid[i]].sort((a, b) => a - b);
    return {
      index,
      label: gridMeta[i].label,
      fullAge: gridMeta[i].fullAge,
      deflator: gridMeta[i].deflator,
      p10: Math.round(quantile(s, 0.1)),
      p25: Math.round(quantile(s, 0.25)),
      p50: Math.round(quantile(s, 0.5)),
      p75: Math.round(quantile(s, 0.75)),
      p90: Math.round(quantile(s, 0.9)),
    };
  });

  return {
    paths,
    failureRate: failCount / paths,
    medianRuinAge: sortedRuin.length ? quantile(sortedRuin, 0.5) : null,
    finalWealthReal: {
      p10: quantile(sortedFinals, 0.1),
      p50: quantile(sortedFinals, 0.5),
      p90: quantile(sortedFinals, 0.9),
    },
    spend: {
      p10: quantile(sortedMed, 0.1),
      p50: quantile(sortedMed, 0.5),
      p90: quantile(sortedMed, 0.9),
      worstYearP50: quantile(sortedWorst, 0.5),
      beforeAnnuityP50: quantile(sortedBefore, 0.5),
      fromAnnuityP50: quantile(sortedFrom, 0.5),
    },
    spendByAge,
    lifetimeTaxRealP50: quantile([...lifetimeTax].sort((a, b) => a - b), 0.5),
    bands,
  };
}

// ---------------------------------------------------------------------------
// Solvers
// ---------------------------------------------------------------------------

/**
 * Largest fixed withdrawal that survives a *smooth* return path to end of life.
 *
 * This is the old dashboard number. It is kept because it is a useful upper
 * bound and it is what the historical screenshots show — but it assumes zero
 * volatility, so treat it as "the best case", not a plan.
 */
export function findDeterministicWithdrawal(params: ProjectionParams): {
  monthly: number;
  run: ProjectionRun;
} {
  const totalMonths = Math.max(0, (params.endOfLifeAge - params.initialAge) * 12);
  const baseYear = params.baseYear ?? new Date().getFullYear();
  const equity = buildEquityInflows(
    params.equityCompanies,
    totalMonths,
    baseYear,
    params.equityFactor,
    params.startMonth ?? 0,
  );
  const returnPath = buildReturnPath(
    totalMonths,
    params.initialAge,
    params.returnModel,
    null,
  );

  let lo = 0;
  let hi = 600_000;
  let best = 0;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    const run = runProjection({ kind: 'fixed', monthly: mid }, params, {
      returnPath,
      equity,
      collectPoints: false,
    });
    if (!run.ruined && run.finalWealth > 2000) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    monthly: Math.round(best),
    run: runProjection({ kind: 'fixed', monthly: best }, params, {
      returnPath,
      equity,
      collectPoints: true,
    }),
  };
}

/**
 * Largest fixed withdrawal whose probability of ruin stays under
 * `1 - targetSuccess` across the Monte Carlo. This is the honest headline
 * number: it prices volatility and sequence risk, which the deterministic
 * solver cannot.
 */
export function findWithdrawalForSuccessRate(
  params: ProjectionParams,
  targetSuccess = 0.85,
  opts: MonteCarloOptions = {},
): { monthly: number; failureRate: number } {
  return findWithdrawalsForSuccessRates(params, [targetSuccess], opts)[0];
}

/**
 * Solve several success targets at once against one shared bundle of return
 * paths. Sharing matters twice over: it is cheaper than independent runs, and
 * it guarantees the answers are monotone with respect to each other — a 95%
 * plan can never come out above a 90% plan because of sampling noise.
 */
export function findWithdrawalsForSuccessRates(
  params: ProjectionParams,
  targets: number[],
  opts: MonteCarloOptions = {},
): Array<{ monthly: number; failureRate: number }> {
  const paths = Math.max(1, opts.paths ?? 250);
  const seed = opts.seed ?? 4242;
  const totalMonths = Math.max(0, (params.endOfLifeAge - params.initialAge) * 12);
  const baseYear = params.baseYear ?? new Date().getFullYear();

  const equity = buildEquityInflows(
    params.equityCompanies,
    totalMonths,
    baseYear,
    params.equityFactor,
    params.startMonth ?? 0,
  );

  // Reuse one bundle of return paths for every binary-search probe, so the
  // objective is monotone and the search converges instead of chasing noise.
  const rand = mulberry32(seed);
  const bundle: Float64Array[] = [];
  for (let p = 0; p < paths; p++) {
    bundle.push(
      buildReturnPath(totalMonths, params.initialAge, params.returnModel, rand),
    );
  }

  const failureAt = (monthly: number): number => {
    let fails = 0;
    for (const returnPath of bundle) {
      const run = runProjection({ kind: 'fixed', monthly }, params, {
        returnPath,
        equity,
        collectPoints: false,
      });
      if (run.ruined) fails++;
    }
    return fails / bundle.length;
  };

  return targets.map((targetSuccess) => {
    const maxFailure = 1 - targetSuccess;
    let lo = 0;
    let hi = 600_000;
    let best = 0;
    let bestFailure = 0;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      const f = failureAt(mid);
      if (f <= maxFailure) {
        best = mid;
        bestFailure = f;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return { monthly: Math.round(best), failureRate: bestFailure };
  });
}
