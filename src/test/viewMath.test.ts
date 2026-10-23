import { describe, it, expect } from 'vitest';
import {
  annualSpendTarget,
  elapsedMonthsOf,
  proratedTarget,
  lineProjection,
  currentMonthProjectionSeed,
  barColor,
  clampAge,
  splitBalanceChange,
  monthlyBalanceSplits,
  noncashByMonth,
  proratedSum,
  yearPace,
  yearProjection,
  recurringMonthlyBudget,
  backfillMonthEnds,
} from '../utils/viewMath';
import { defaultMonthlyExpenses, defaultYearlyExpenses } from '../data/defaultState';
import type { Expense } from '../types';

// ---------------------------------------------------------------------------
// annualSpendTarget — the Overview↔Yearly pace-badge parity bug.
// Review finding: Overview computed the target with includeOneTime=false while
// YearlyTab used true → the two badges disagreed by the one-time budget
// (₪41.7k with the war trip). Both now call this one function.
// ---------------------------------------------------------------------------
describe('annualSpendTarget', () => {
  const monthlySum = 10_000;

  it('includes one-time yearly expenses (YTD actuals include one-off spend)', () => {
    const yearly: Expense[] = [
      { id: 1, name: 'טיולים', amount: 12_000 },
      { id: 2, name: 'טיול מלחמה', amount: 83_000, oneTime: true },
    ];
    const withOneTime = annualSpendTarget(monthlySum, yearly);
    const withoutOneTime = annualSpendTarget(monthlySum, yearly.filter((e) => !e.oneTime));
    expect(withOneTime - withoutOneTime).toBe(83_000);
  });

  it('amortizes every-N-years expenses to a single year', () => {
    const yearly: Expense[] = [{ id: 1, name: 'רכב קטן', amount: 50_000, everyNYears: 5 }];
    expect(annualSpendTarget(0, yearly)).toBe(10_000);
  });

  it('parity: the shipped defaults produce one target for both tabs, incl. one-time', () => {
    const monthlyTotal = defaultMonthlyExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const target = annualSpendTarget(monthlyTotal, defaultYearlyExpenses);
    const oneTimeTotal = defaultYearlyExpenses.filter((e) => e.oneTime).reduce((s, e) => s + (e.amount || 0), 0);
    const targetExOneTime = annualSpendTarget(
      monthlyTotal,
      defaultYearlyExpenses.filter((e) => !e.oneTime),
    );
    // one-time budgets are inside the target — the exact regression that split the badges
    expect(target - targetExOneTime).toBe(oneTimeTotal);
    expect(oneTimeTotal).toBeGreaterThan(0); // defaults really contain a one-time line
  });
});

describe('elapsedMonthsOf / proratedTarget', () => {
  it('adds the fraction of the current month', () => {
    expect(elapsedMonthsOf(7, 1, 31)).toBeCloseTo(6 + 1 / 31, 5);
    expect(elapsedMonthsOf(1, 15, 30)).toBeCloseTo(0.5, 5);
  });

  it('clamps a day past month-end to a full month', () => {
    expect(elapsedMonthsOf(7, 45, 30)).toBe(7);
  });

  it('prorates the annual target linearly', () => {
    expect(proratedTarget(558_900, 6)).toBe(279_450);
    expect(proratedTarget(120_000, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lineProjection — the "צפי סוף חודש" semantics bug.
// Review finding: any partial spend auto-flipped a line to בוצע and projected
// it at spend-so-far, collapsing the projection mid-month; explicit בוצע on an
// off-card cash line (actual=0) silently dropped its whole budget.
// ---------------------------------------------------------------------------
describe('lineProjection', () => {
  it('pending line projects at its budget', () => {
    expect(lineProjection(false, false, 0, 3_000)).toBe(3_000);
  });

  it('pending line the user toggled off keeps at least its partial actual', () => {
    expect(lineProjection(true, false, 3_655, 3_000)).toBe(3_655);
  });

  it('auto-inferred happened with PARTIAL spend still projects the budget (וולט ₪198 → ₪3,000)', () => {
    expect(lineProjection(false, true, 198, 3_000)).toBe(3_000);
  });

  it('auto-inferred happened over budget projects the actual', () => {
    expect(lineProjection(false, true, 3_655, 3_000)).toBe(3_655);
  });

  it('EXPLICIT happened with real spend counts at its bare actual (line finished under budget)', () => {
    expect(lineProjection(true, true, 450, 600)).toBe(450);
  });

  it('explicit happened with NO card actual (off-card cash: מנקה) projects the budget, not ₪0', () => {
    expect(lineProjection(true, true, 0, 700)).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// currentMonthProjectionSeed — the yearly-projection double-count bug.
// Review finding: seeding with actCum + baseline*(1−dayFrac) counted day-1
// rent/HOA twice (once in actuals, again in the prorated baseline), inflating
// צפי לסוף השנה by ~₪13k at each month start.
// ---------------------------------------------------------------------------
describe('currentMonthProjectionSeed', () => {
  it('adds only the UNSPENT remainder of the baseline (day-1 rent not double-counted)', () => {
    // shipped repro: ytd ₪309,459 incl. July's ₪13,698 (full rent+HOA), baseline ₪26,427
    expect(currentMonthProjectionSeed(309_459, 26_427, 13_698)).toBe(309_459 + 12_729);
  });

  it('adds nothing once the month already spent past the baseline', () => {
    expect(currentMonthProjectionSeed(100_000, 26_427, 30_000)).toBe(100_000);
  });

  it('converges to pure actuals with a zero baseline', () => {
    expect(currentMonthProjectionSeed(50_000, 0, 5_000)).toBe(50_000);
  });
});

describe('barColor', () => {
  it('green at/under budget, amber ≤115%, red above, neutral without a budget', () => {
    expect(barColor(500, 1_000)).toBe('#6d907c');
    expect(barColor(1_000, 1_000)).toBe('#6d907c');
    expect(barColor(1_100, 1_000)).toBe('#d97706');
    expect(barColor(1_200, 1_000)).toBe('#e11d48');
    expect(barColor(5, 0)).toBe('#94a3b8');
  });
});

// ---------------------------------------------------------------------------
// clampAge — the age-input regression. Review finding: clamping every
// keystroke made typing any two-digit age impossible ("5"→18, then "180"→80).
// The clamp must run only when committing (blur); this is that commit clamp.
// ---------------------------------------------------------------------------
describe('clampAge', () => {
  it('clamps into [18, 80] on commit', () => {
    expect(clampAge(5, 34)).toBe(18);
    expect(clampAge(90, 34)).toBe(80);
    expect(clampAge(45, 34)).toBe(45);
  });

  it('falls back when the field was cleared', () => {
    expect(clampAge(NaN, 34)).toBe(34);
    expect(clampAge(0, 34)).toBe(34);
  });
});

describe('splitBalanceChange', () => {
  const a = { d: '2026-06-01', inv: 1_000_000, inv_gain: 200_000, hish: 100_000, pen: 500_000 };

  it('separates brokerage deposits (cost basis) from market (gain)', () => {
    // +50k deposited, +30k market gain; nothing else moves.
    const b = { d: '2026-06-01', inv: 1_080_000, inv_gain: 230_000, hish: 100_000, pen: 500_000 };
    const s = splitBalanceChange(a, b, 0, 0, 0.28);
    expect(s.depositsInv).toBe(50_000);
    expect(s.marketLiquid).toBe(30_000);
    expect(s.marketLiquidNet).toBeCloseTo(30_000 * 0.72, 6);
    expect(s.total).toBe(80_000);
    expect(s.market + s.deposits).toBe(s.total);
  });

  it('treats pension/hishtalmut contributions as deposits and the rest as market', () => {
    // ~one month later; 10k/month pension and 2k/month hishtalmut contributions.
    const b = { ...a, d: '2026-07-01', hish: 105_000, pen: 530_000 };
    const s = splitBalanceChange(a, b, 10_000, 2_000, 0.28);
    const months = 30 / 30.44;
    expect(s.depositsLocked).toBeCloseTo(12_000 * months, 6);
    expect(s.marketPension).toBeCloseTo(30_000 - 10_000 * months, 6);
    // Hishtalmut market gains are tax-free when withdrawn.
    expect(s.marketLiquidNet).toBeCloseTo(5_000 - 2_000 * months, 6);
    expect(s.market + s.deposits).toBeCloseTo(s.total, 6);
  });

  it('monthly splits chain month-end to month-end and skip gain-less points', () => {
    const pts = [
      { d: '2026-05-17', inv: 900_000, inv_gain: null, hish: 100_000, pen: 500_000 },
      a,
      { ...a, d: '2026-06-30', inv: 1_010_000, inv_gain: 210_000 },
      { ...a, d: '2026-07-31', inv: 1_030_000, inv_gain: 220_000 },
    ];
    const m = monthlyBalanceSplits(pts, 0, 0, 0.28);
    expect(m.map((x) => x.ym)).toEqual(['2026-06', '2026-07']);
    expect(m[0].marketLiquid).toBe(10_000);
    expect(m[1].depositsInv).toBe(10_000);
    expect(m[1].marketLiquid).toBe(10_000);
  });
});

describe('non-cash spend (car cost of ownership, in-kind babysitting)', () => {
  const items = [
    ...['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map((ym) => (
      { ym, label: 'car', amount: 3470, group: 'רכב ותחבורה', in_target: true })),
    ...['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((ym) => (
      { ym, label: 'inkind', amount: 6250, group: 'גן/מטפלת', in_target: false })),
  ];

  it('buckets by month and keeps only in_target items in the target series', () => {
    const nc = noncashByMonth(items, 2026);
    expect(nc.all[0]).toBe(6250);
    expect(nc.all[5]).toBe(6250 + 3470);
    expect(nc.all[11]).toBe(3470);
    expect(nc.target[0]).toBe(0);
    expect(nc.target[5]).toBe(3470);
    expect(noncashByMonth(items, 2027).all.every((v) => v === 0)).toBe(true);
  });

  it('prorates the current month', () => {
    // 8.5 months elapsed: Jan..Aug full, September half
    expect(proratedSum([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 8.5)).toBe(9);
    expect(proratedSum([0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0], 8.5)).toBe(5);
  });

  it('yearPace adds non-cash spend to YTD and the car (only) to the target', () => {
    const yearly = { year: 2026, monthly_actual: { '2026-01': 30000, '2026-02': 30000 }, noncash: items };
    const withNc = yearPace(yearly, 30000, [], 2);
    const without = yearPace({ ...yearly, noncash: [] }, 30000, [], 2);
    expect(withNc.cashYtd).toBe(60000);
    expect(withNc.ytd).toBe(60000 + 2 * 6250);
    // In-kind babysitting is already budgeted (gan line) — no target change Jan/Feb.
    expect(withNc.paceTarget).toBe(without.paceTarget);
    expect(withNc.targetAnnual - without.targetAnnual).toBe(7 * 3470);
    expect(withNc.paceDelta).toBe(without.paceDelta - 2 * 6250);
  });
});

describe('backfillMonthEnds', () => {
  // Tracking starts mid-May; the first priced month-end after it is May 31.
  const tracked = [
    { d: '2026-05-17', inv: 1_000_000, inv_gain: 300_000, hish: 100_000, pen: 500_000 },
    { d: '2026-05-31', inv: 1_010_000, inv_gain: 310_000, hish: 110_000, pen: 550_000 },
  ];
  const inv = [{ d: '2026-04-30', inv: 950_000 }, { d: '2026-05-31', inv: 1_010_000 }];
  const sp = [{ d: '2026-04-30', price: 100 }, { d: '2026-05-31', price: 110 }];

  it('uses the statement total and walks pension/hishtalmut back by the S&P return', () => {
    const [p] = backfillMonthEnds(tracked, inv, sp, [], 2_000, 1_000);
    const months = (Date.parse('2026-05-31') - Date.parse('2026-04-30')) / 86_400_000 / 30.44;
    expect(p.d).toBe('2026-04-30');
    expect(p.est).toBe(true);
    expect(p.inv).toBe(950_000);
    expect(p.inv_gain).toBe(950_000 - 700_000); // basis unchanged: no money moved
    expect(p.hish).toBe(Math.round((110_000 - 1_000 * months) / 1.1));
    expect(p.pen).toBe(Math.round((550_000 - 2_000 * months) / 1.1));
  });

  it('takes brokerage deposits out of the earlier cost basis', () => {
    const [p] = backfillMonthEnds(tracked, inv, sp, [{ d: '2026-05-10', amount: 50_000 }], 0, 0);
    expect(p.inv_gain).toBe(950_000 - 650_000);
  });

  it('returns nothing without a priced month-end after tracking began', () => {
    expect(backfillMonthEnds(tracked, inv, sp.slice(0, 1), [], 0, 0)).toEqual([]);
  });
});

describe('yearProjection', () => {
  it('adds actuals, then baseline + upcoming + non-cash to year end', () => {
    const yearly = {
      year: 2026, current_month: 3, recurring_baseline: 30_000,
      monthly_actual: { '2026-01': 40_000, '2026-02': 35_000, '2026-03': 10_000 },
      upcoming: [{ ym: '2026-06', amount: 20_000 }],
      noncash: [{ ym: '2026-01', label: 'x', amount: 1_000, group: 'g', in_target: false }],
    };
    const p = yearProjection(yearly, 2.5); // mid-March
    expect(p.actual[1]).toBe(76_000);
    expect(p.ytd).toBe(86_000);
    // March: 10k spent of a 30k baseline -> 20k more; then 9 months x 30k + 20k upcoming.
    expect(p.yearEnd).toBe(86_000 + 20_000 + 9 * 30_000 + 20_000);
    expect(p.projection[0]).toBeNull();
    expect(p.actual[11]).toBeNull();
  });
});

describe('budget-driven year', () => {
  it('recurringMonthlyBudget amortizes yearly items, skipping one-offs', () => {
    const yearly = [
      { id: 103, name: 'trips', amount: 12_000 },
      { id: 106, name: 'fridge', amount: 6_000, everyNYears: 10 },
      { id: 109, name: 'war trip', amount: 83_000, oneTime: true },
    ];
    expect(recurringMonthlyBudget(30_000, yearly as any)).toBeCloseTo(30_000 + 1_000 + 50, 6);
  });

  it('yearProjection runs the months ahead on the budget and ignores upcoming', () => {
    const yearly = {
      year: 2026, current_month: 11, recurring_baseline: 99_999,
      monthly_actual: { '2026-11': 5_000 },
      upcoming: [{ ym: '2026-12', amount: 50_000 }],
    };
    const p = yearProjection(yearly, 10.5, 20_000);
    // Nov: 5k spent of 20k -> 15k more; Dec: 20k.
    expect(p.yearEnd).toBe(5_000 + 15_000 + 20_000);
  });
});

