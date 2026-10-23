import { Expense } from '../types';
import { yearlyExpenseMonthlyAmount } from './calculations';

/**
 * Single source of truth for the annual spend target ("יעד שנתי").
 * Used by BOTH the Overview pace badge and the Yearly tab — they must agree.
 * includeOneTime MUST stay true: the YTD actuals the target is compared
 * against include one-off spend (e.g. the war trip), so the target has to
 * include the one-off budgets too. Passing false here made the Overview
 * over-report the overshoot by ₪41.7k (confirmed review finding).
 */
export function annualSpendTarget(monthlyTotalSum: number, yearlyExpenses: Expense[]): number {
  const yearlyAnnual = (yearlyExpenses || [])
    .reduce((s, e) => s + yearlyExpenseMonthlyAmount(e, true) * 12, 0);
  return Math.round(monthlyTotalSum * 12 + yearlyAnnual);
}

/**
 * The budget's monthly run-rate: monthly lines + recurring yearly items
 * amortized. Leaves out 2026-only items. Drives the months of the year not yet spent.
 */
export function recurringMonthlyBudget(monthlyTotalSum: number, yearlyExpenses: Expense[]): number {
  return monthlyTotalSum + (yearlyExpenses || [])
    .reduce((s, e) => s + yearlyExpenseMonthlyAmount(e, false), 0);
}

/**
 * Economic spend that is not a card transaction (prisha_actuals.py `noncash`):
 * babysitting paid with the old car. `inTarget` items are also added to the
 * target; daycare is already budgeted, so the babysitting is not.
 */
export interface NoncashItem { ym: string; label: string; amount: number; group: string; in_target: boolean }

/** Per calendar month (index 0 = January) of `year`: all non-cash spend, and the part that goes into the target. */
export function noncashByMonth(items: NoncashItem[] | undefined, year: number): { all: number[]; target: number[] } {
  const all = Array(12).fill(0);
  const target = Array(12).fill(0);
  for (const it of items || []) {
    if (!String(it.ym).startsWith(`${year}-`)) continue;
    const mi = parseInt(it.ym.slice(5, 7), 10) - 1;
    all[mi] += it.amount || 0;
    if (it.in_target) target[mi] += it.amount || 0;
  }
  return { all, target };
}

/** Sum of a per-month series through `elapsedMonths` (the current month prorated). */
export function proratedSum(byMonth: number[], elapsedMonths: number): number {
  return Math.round(byMonth.reduce((s, v, i) => s + v * Math.min(1, Math.max(0, elapsedMonths - i)), 0));
}

/**
 * Year-to-date spend vs. the target, non-cash spend included on both sides.
 * Single source of truth for the Overview and Yearly pace badges.
 */
export function yearPace(
  yearly: { year?: number; monthly_actual?: Record<string, number>; noncash?: NoncashItem[] },
  monthlyTotalSum: number,
  yearlyExpenses: Expense[],
  elapsedMonths: number,
) {
  const year = yearly.year || new Date().getFullYear();
  const nc = noncashByMonth(yearly.noncash, year);
  const cashYtd = Object.values(yearly.monthly_actual || {}).reduce((s: number, v: any) => s + (v || 0), 0);
  const noncashYtd = proratedSum(nc.all, elapsedMonths);
  const baseAnnual = annualSpendTarget(monthlyTotalSum, yearlyExpenses);
  const targetAnnual = baseAnnual + nc.target.reduce((s, v) => s + v, 0);
  const paceTarget = proratedTarget(baseAnnual, elapsedMonths) + proratedSum(nc.target, elapsedMonths);
  const ytd = cashYtd + noncashYtd;
  return { nc, cashYtd, noncashYtd, ytd, baseAnnual, targetAnnual, paceTarget, paceDelta: paceTarget - ytd };
}

/** Elapsed months including the fraction of the current month. */
export function elapsedMonthsOf(currentMonth: number, today: number, daysInMonth: number): number {
  const dayFrac = Math.min(1, (today || 1) / (daysInMonth || 30));
  return (currentMonth - 1) + dayFrac;
}

/** The annual target prorated to how far we are into the year. */
export function proratedTarget(targetAnnual: number, elapsedMonths: number): number {
  return Math.round((targetAnnual * elapsedMonths) / 12);
}

/**
 * End-of-month projection for a single budget line.
 * - Pending ("צפי") lines project at least their budget (max with any partial
 *   actual the user toggled off).
 * - Auto-inferred "בוצע" (any partial spend flips it) ALSO projects at least
 *   the budget — mid-month partial spend on continuous lines (וולט, סופר…)
 *   must not shrink the projection below plan.
 * - Only an EXPLICIT user toggle with real spend counts at its bare actual
 *   ("this line is finished").
 * - Explicit "בוצע" with no card actual (off-card cash lines: מנקה, גן)
 *   projects at budget, not ₪0.
 */
export function lineProjection(explicitToggle: boolean, isHappened: boolean, actual: number, budget: number): number {
  if (isHappened && explicitToggle && actual > 0) return actual;
  return Math.max(actual || 0, budget || 0);
}

/**
 * Seed for the current month inside the yearly cumulative projection:
 * actuals so far + the UNSPENT remainder of the recurring baseline.
 * NOT a day-fraction prorate — rent/HOA post in full on day 1, and a
 * dayFrac-based seed double-counted them (~₪13k inflation, review finding).
 * Converges to the pure actuals as the month's spend approaches the baseline.
 */
export function currentMonthProjectionSeed(actualCumulative: number, baseline: number, currentMonthActual: number): number {
  return actualCumulative + Math.max(0, (baseline || 0) - (currentMonthActual || 0));
}

/**
 * Cumulative spend through the year: actuals (cash + non-cash) up to today,
 * then the projection. With `futureMonthly` (the budget) the months ahead run
 * on the budget — so editing the budget moves the year-end — otherwise on the
 * recurring baseline + known upcoming one-offs. Non-cash spend always adds.
 * One source for the yearly chart and the budget tab's "this year in
 * practice" row, so both show the same year-end figure.
 */
export function yearProjection(
  yearly: {
    year?: number; current_month?: number; recurring_baseline?: number;
    monthly_actual?: Record<string, number>; upcoming?: { ym: string; amount: number }[]; noncash?: NoncashItem[];
  },
  elapsedMonths: number,
  futureMonthly?: number,
  /** What this month still adds on top of its actuals (yearBreakdown); default: the unspent baseline. */
  curMonthRemaining?: number,
  /** Planned one-offs on top of the budget (yearBreakdown). */
  planned?: { ym: string; amount: number }[],
) {
  const year = yearly.year || new Date().getFullYear();
  const curM = yearly.current_month || 12;
  const byBudget = futureMonthly != null;
  const baseline = byBudget ? futureMonthly : yearly.recurring_baseline || 0;
  const nc = noncashByMonth(yearly.noncash, year);
  const cash = Array.from({ length: 12 }, (_, i) => (yearly.monthly_actual || {})[`${year}-${String(i + 1).padStart(2, '0')}`] ?? 0);
  const up: number[] = Array(12).fill(0);
  for (const u of byBudget ? planned || [] : yearly.upcoming || []) {
    const mi = parseInt(String(u.ym).slice(5, 7), 10) - 1;
    if (mi >= 0 && mi < 12) up[mi] += u.amount || 0;
  }
  const curFrac = elapsedMonths - (curM - 1);
  const actual: (number | null)[] = [];
  const projection: (number | null)[] = [];
  let actCum = 0;
  let projCum = 0;
  for (let i = 0; i < 12; i++) {
    const m = i + 1;
    if (m < curM) {
      actCum += cash[i] + nc.all[i];
      projCum = actCum;
      actual.push(actCum); projection.push(null);
    } else if (m === curM) {
      // Non-cash spend accrues through the month; the cash part is actuals +
      // the unspent remainder of the baseline (see currentMonthProjectionSeed).
      actCum += cash[i] + nc.all[i] * curFrac;
      projCum = (curMonthRemaining != null ? actCum + curMonthRemaining : currentMonthProjectionSeed(actCum, baseline, cash[i]))
        + nc.all[i] * (1 - curFrac);
      actual.push(actCum); projection.push(projCum);
    } else {
      projCum += baseline + up[i] + nc.all[i];
      actual.push(null); projection.push(projCum);
    }
  }
  return { nc, actual, projection, ytd: actCum, yearEnd: projCum };
}

/** Color tiers for budget-vs-actual bars (inline hex — dark-mode safe). */
export function barColor(actual: number, budget: number): string {
  if (budget <= 0) return '#94a3b8';
  const r = actual / budget;
  if (r <= 1) return '#6d907c';
  if (r <= 1.15) return '#d97706';
  return '#e11d48';
}

/**
 * Commit-time clamp for the age input. Clamping must happen on BLUR, not per
 * keystroke — a controlled input that clamps every keystroke makes typing any
 * two-digit age impossible ("5" → 18, then "180" → 80; review finding).
 */
export function clampAge(value: number, fallback: number): number {
  if (isNaN(value) || value === 0) return fallback;
  return Math.min(80, Math.max(18, value));
}

// ---------------------------------------------------------------------------
// Balances over the year: how much of the change is the market, how much is
// money we put in, and what the market part is worth after tax.
// ---------------------------------------------------------------------------

/** One daily snapshot, as written by prisha_actuals.py (`balances`). */
export interface BalancePoint {
  d: string;              // YYYY-MM-DD
  inv: number;            // brokerage accounts (all holders)
  inv_gain: number | null; // their unrealized gain; null before Ordernet reported it
  est?: boolean;          // gain rebuilt from known deposits (before Ordernet reported it)
  hish: number;           // keren hishtalmut (both)
  pen: number;            // pension + gemel (both)
}

export interface BalanceSplit {
  from: string;
  to: string;
  /** Change in the total (brokerage + hishtalmut + pension). */
  total: number;
  /** Change caused by the market, everywhere. */
  market: number;
  /** Market change in what can be withdrawn today (brokerage + hishtalmut). */
  marketLiquid: number;
  /** marketLiquid after capital-gains tax on the brokerage part. */
  marketLiquidNet: number;
  /** Market change inside the pension — locked until retirement. */
  marketPension: number;
  /** Money we added, everywhere. */
  deposits: number;
  /** Into the brokerage accounts — exact (change in cost basis). */
  depositsInv: number;
  /** Into pension + hishtalmut — estimated from the salary contributions. */
  depositsLocked: number;
}

const DAY_MS = 86_400_000;
const monthsBetween = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / DAY_MS / 30.44;

export const balanceTotal = (p: BalancePoint) => p.inv + p.hish + p.pen;

/**
 * Split the change between two snapshots into market vs deposits.
 *
 * Brokerage is exact: Ordernet reports the unrealized gain, so the change in
 * gain is the market and the change in cost basis (value − gain) is money in
 * or out. Pension and hishtalmut report only a balance, so their deposits are
 * the monthly contributions from the salary data and the rest is the market —
 * an estimate, and a noisy one month to month because those balances update
 * about once a month. Hishtalmut is tax-free on withdrawal; pension is locked.
 */
export function splitBalanceChange(
  a: BalancePoint,
  b: BalancePoint,
  monthlyPensionIn: number,
  monthlyStudyIn: number,
  gainTaxRate: number,
): BalanceSplit {
  const months = Math.max(0, monthsBetween(a.d, b.d));
  const gainA = a.inv_gain ?? 0;
  const gainB = b.inv_gain ?? 0;
  const depositsInv = (b.inv - gainB) - (a.inv - gainA);
  const marketInv = gainB - gainA;
  const hishDep = monthlyStudyIn * months;
  const penDep = monthlyPensionIn * months;
  const marketHish = (b.hish - a.hish) - hishDep;
  const marketPension = (b.pen - a.pen) - penDep;
  const marketLiquid = marketInv + marketHish;
  return {
    from: a.d,
    to: b.d,
    total: balanceTotal(b) - balanceTotal(a),
    market: marketLiquid + marketPension,
    marketLiquid,
    marketLiquidNet: marketInv * (1 - gainTaxRate) + marketHish,
    marketPension,
    deposits: depositsInv + hishDep + penDep,
    depositsInv,
    depositsLocked: hishDep + penDep,
  };
}

/** Points from the first one that carries the brokerage gain (the split needs it). */
export function splittablePoints(points: BalancePoint[]): BalancePoint[] {
  const i = points.findIndex((p) => p.inv_gain != null);
  return i < 0 ? [] : points.slice(i);
}

/** Per-calendar-month split, month-end to month-end (the first month from the first point). */
export function monthlyBalanceSplits(
  points: BalancePoint[],
  monthlyPensionIn: number,
  monthlyStudyIn: number,
  gainTaxRate: number,
): Array<BalanceSplit & { ym: string }> {
  const pts = splittablePoints(points);
  if (pts.length < 2) return [];
  const lastOfMonth = new Map<string, BalancePoint>();
  for (const p of pts) lastOfMonth.set(p.d.slice(0, 7), p);
  const out: Array<BalanceSplit & { ym: string }> = [];
  let prev = pts[0];
  for (const [ym, p] of lastOfMonth) {
    if (p === prev) continue;
    out.push({ ym, ...splitBalanceChange(prev, p, monthlyPensionIn, monthlyStudyIn, gainTaxRate) });
    prev = p;
  }
  return out;
}

/**
 * Month-end points before daily tracking began, so the year starts on Jan 1.
 *
 * Brokerage: the Meitav monthly statement totals (exact). Its cost basis moves
 * only with money in/out (`events`), so gain = value − basis.
 * Pension + hishtalmut: both sit in S&P 500 tracks, so they are walked back
 * from the first tracked month-end with the S&P 500 (ILS) month-end prices,
 * taking out the monthly salary contributions on the way. An estimate.
 */
export function backfillMonthEnds(
  points: BalancePoint[],
  invMonthEnds: { d: string; inv: number }[],
  sp500Ils: { d: string; price: number }[],
  events: { d: string; amount: number }[],
  monthlyPensionIn: number,
  monthlyStudyIn: number,
): BalancePoint[] {
  const pts = splittablePoints(points);
  if (!pts.length) return [];
  const first = pts[0];
  const price = new Map(sp500Ils.map((p) => [p.d, p.price]));
  // The chain starts at the first priced month-end after tracking began,
  // from the tracked balances on that day.
  const start = [...sp500Ils].sort((a, b) => (a.d < b.d ? -1 : 1)).find((p) => p.d >= first.d);
  if (!start) return [];
  const at = [...pts].reverse().find((p) => p.d <= start.d) ?? first;
  const basisFirst = first.inv - (first.inv_gain ?? 0);
  const ends = invMonthEnds.filter((e) => e.d < first.d && price.has(e.d)).sort((a, b) => (a.d < b.d ? -1 : 1));
  const out: BalancePoint[] = [];
  let { hish, pen } = at;
  let nextD = start.d;
  let nextP = start.price;
  for (let i = ends.length - 1; i >= 0; i--) {
    const e = ends[i];
    const p = price.get(e.d)!;
    const growth = nextP / p;
    const months = monthsBetween(e.d, nextD);
    hish = (hish - monthlyStudyIn * months) / growth;
    pen = (pen - monthlyPensionIn * months) / growth;
    const moved = events.filter((x) => x.d > e.d && x.d <= first.d).reduce((s, x) => s + x.amount, 0);
    out.unshift({ d: e.d, inv: e.inv, inv_gain: e.inv - (basisFirst - moved), hish: Math.round(hish), pen: Math.round(pen), est: true });
    nextD = e.d;
    nextP = p;
  }
  return out;
}
