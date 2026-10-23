import { describe, it, expect } from 'vitest';
import {
  amortizationRealRate,
  findWithdrawalForSuccessRate,
  runMonteCarlo,
  safeWithdrawalRateTable,
} from '../utils/projection';
import type { ProjectionParams, WithdrawalPolicy } from '../utils/projection';

/**
 * The plan card and the retirement-age table answer the same question for the
 * same year, so they must return the same number. They used to differ because
 * the table ran a cheaper Monte Carlo (80 paths vs 400), which showed up as
 * ~₪45k on the card and ~₪50k in the table for an identical scenario.
 *
 * These tests pin the property that matters: identical inputs -> identical
 * output, regardless of which code path asked.
 */

const params = (stopWorkYear: number, equityFactor = 0): ProjectionParams => ({
  investmentInitialValue: 5_831_801,
  investmentInitialGain: 1_441_026,
  pensionInitialValue: 2_710_834,
  returnModel: { annualReturn: 7, annualVolatility: 17 },
  inflationRate: 2.5,
  transitionToHalfWorkYear: stopWorkYear,
  stopWorkYear,
  budgetSummary: {
    totalExpenseToday: 42_158,
    totalIncomeNet: 64_150,
    totalPensionInflow: 22_800,
    totalStudyFundInflow: 3_142,
  },
  monthlyExpenses: [{ id: 1, name: 'living', amount: 34_315 }],
  yearlyExpenses: [{ id: 2, name: 'car', amount: 150_000, everyNYears: 5 }],
  propertyConfig: { price: 7_000_000, year: 2030, monthlySavings: 12_000 },
  equityCompanies: [],
  equityFactor,
  initialAge: 34,
  endOfLifeAge: 90,
  baseYear: 2026,
});

const amortized: WithdrawalPolicy = {
  kind: 'amortized',
  realDiscountRate: amortizationRealRate(7, 17, 2.5),
};

describe('card / table consistency', () => {
  it('the amortized headline is identical for identical inputs', () => {
    const a = runMonteCarlo(amortized, params(10), { paths: 400 });
    const b = runMonteCarlo(amortized, params(10), { paths: 400 });
    expect(Math.round(a.spend.p50)).toBe(Math.round(b.spend.p50));
  });

  it('the fixed-mode headline is identical for identical inputs', () => {
    const a = findWithdrawalForSuccessRate(params(10), 0.85, { paths: 150 });
    const b = findWithdrawalForSuccessRate(params(10), 0.85, { paths: 150 });
    expect(a.monthly).toBe(b.monthly);
  });

  it('a smaller sample really does move the answer — why the counts must match', () => {
    const cheap = runMonteCarlo(amortized, params(10), { paths: 80 });
    const full = runMonteCarlo(amortized, params(10), { paths: 400 });
    // Not asserting a specific gap, just that they are not interchangeable:
    // if this ever becomes exactly equal the guard above is worth revisiting.
    expect(Math.round(cheap.spend.p50)).not.toBe(Math.round(full.spend.p50));
  });

  it('later retirement always allows at least as much spending', () => {
    const byYear = [5, 10, 15, 20, 25].map(
      (y) => runMonteCarlo(amortized, params(y), { paths: 200 }).spend.p50,
    );
    for (let i = 1; i < byYear.length; i++) {
      expect(byYear[i]).toBeGreaterThan(byYear[i - 1]);
    }
  });

  it('the exits plan is never worse than the base plan', () => {
    const base = runMonteCarlo(amortized, params(10, 0), { paths: 200 }).spend.p50;
    const upside = runMonteCarlo(amortized, params(10, 1), { paths: 200 }).spend.p50;
    expect(upside).toBeGreaterThanOrEqual(base);
  });

  it('the safe-rate table depends on its anchor age — so it must be pinned', () => {
    // Built from different start ages the tables disagree for the SAME age,
    // because the underlying path bundle is a different length. The worker
    // therefore always anchors at initialAge; this test documents why.
    const model = { annualReturn: 10, annualVolatility: 18 };
    const from39 = safeWithdrawalRateTable(model, 2.5, 0.95, 39, 90);
    const from44 = safeWithdrawalRateTable(model, 2.5, 0.95, 44, 90);
    expect(from39[60]).not.toBe(from44[60]);
  });

  it('one anchor gives one answer for every retirement age', () => {
    const model = { annualReturn: 10, annualVolatility: 18 };
    const a = safeWithdrawalRateTable(model, 2.5, 0.95, 34, 90);
    const b = safeWithdrawalRateTable(model, 2.5, 0.95, 34, 90);
    expect(a).toEqual(b);
  });
});
