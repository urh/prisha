import { describe, it, expect } from 'vitest';
import {
  CGT_BASE_RATE,
  amortizationRealRate,
  medianReturnModel,
  DEFAULT_ANNUITY_COEFFICIENT,
  annuityFactor,
  blendedMoments,
  buildEquityInflows,
  buildReturnPath,
  cgtRate,
  equityShareAtAge,
  findDeterministicWithdrawal,
  findWithdrawalForSuccessRate,
  findWithdrawalsForSuccessRates,
  mulberry32,
  runMonteCarlo,
  runProjection,
  safeWithdrawalRateTable,
  withdrawNetFromInvestments,
} from '../utils/projection';
import type { ProjectionParams, ReturnModel } from '../utils/projection';
import { CAPITAL_GAINS_TAX_BRACKETS, SURTAX_THRESHOLD } from '../utils/calculations';

const flatReturn: ReturnModel = { annualReturn: 7, annualVolatility: 0 };

const baseParams: ProjectionParams = {
  investmentInitialValue: 3_000_000,
  investmentInitialGain: 1_000_000,
  pensionInitialValue: 1_000_000,
  returnModel: flatReturn,
  inflationRate: 2.5,
  transitionToHalfWorkYear: 5,
  stopWorkYear: 10,
  budgetSummary: {
    totalExpenseToday: 30_000,
    totalIncomeNet: 50_000,
    totalPensionInflow: 20_000,
    totalStudyFundInflow: 3_000,
  },
  monthlyExpenses: [{ id: 1, name: 'living', amount: 30_000 }],
  yearlyExpenses: [],
  propertyConfig: { price: 0, year: 2100, monthlySavings: 0 },
  equityCompanies: [],
  equityFactor: 0,
  initialAge: 40,
  endOfLifeAge: 90,
  baseYear: 2026,
};

const p = (over: Partial<ProjectionParams> = {}): ProjectionParams => ({
  ...baseParams,
  ...over,
});

// ---------------------------------------------------------------------------

describe('cgtRate', () => {
  it('is 25% below the surtax threshold', () => {
    expect(cgtRate(500_000)).toBeCloseTo(0.25, 10);
  });

  it('adds the 3% surtax above the threshold', () => {
    expect(cgtRate(SURTAX_THRESHOLD + 1)).toBeCloseTo(0.28, 10);
  });
});

describe('withdrawNetFromInvestments', () => {
  it('taxes only the embedded gain, not the whole withdrawal', () => {
    // 50% of the portfolio is gain → effective rate is 12.5%, not 25%.
    const L = { inv: 1_000_000, basis: 500_000, pen: 0 };
    const r = withdrawNetFromInvestments(L, 100_000, 100_000);
    expect(r.net).toBeCloseTo(100_000, 4);
    expect(r.tax / r.gross).toBeCloseTo(CGT_BASE_RATE * 0.5, 6);
  });

  it('charges nothing when there is no embedded gain', () => {
    const L = { inv: 1_000_000, basis: 1_000_000, pen: 0 };
    const r = withdrawNetFromInvestments(L, 100_000, 100_000);
    expect(r.tax).toBeCloseTo(0, 6);
    expect(r.gross).toBeCloseTo(100_000, 6);
  });

  it('actually reduces the balance by the gross amount', () => {
    const L = { inv: 1_000_000, basis: 500_000, pen: 0 };
    const before = L.inv;
    const r = withdrawNetFromInvestments(L, 100_000, 100_000);
    expect(L.inv).toBeCloseTo(before - r.gross, 4);
  });

  it('draws basis down pro-rata so the gain fraction is preserved', () => {
    const L = { inv: 1_000_000, basis: 400_000, pen: 0 };
    const fractionBefore = (L.inv - L.basis) / L.inv;
    withdrawNetFromInvestments(L, 100_000, 100_000);
    const fractionAfter = (L.inv - L.basis) / L.inv;
    expect(fractionAfter).toBeCloseTo(fractionBefore, 8);
  });

  it('never withdraws more than the balance', () => {
    const L = { inv: 50_000, basis: 0, pen: 0 };
    const r = withdrawNetFromInvestments(L, 1_000_000, 100_000);
    expect(r.gross).toBeCloseTo(50_000, 6);
    expect(L.inv).toBeCloseTo(0, 6);
  });

  it('returns zero for a non-positive request or empty balance', () => {
    expect(withdrawNetFromInvestments({ inv: 100, basis: 0, pen: 0 }, 0, 0).gross).toBe(0);
    expect(withdrawNetFromInvestments({ inv: 0, basis: 0, pen: 0 }, 100, 0).gross).toBe(0);
  });
});

describe('amortizationRealRate', () => {
  it('equals the plain real rate when there is no volatility', () => {
    expect(amortizationRealRate(7, 0, 2.5)).toBeCloseTo(1.07 / 1.025 - 1, 8);
  });

  it('sits below the arithmetic real rate once volatility is added', () => {
    const arithmetic = 1.07 / 1.025 - 1;
    expect(amortizationRealRate(7, 17, 2.5)).toBeLessThan(arithmetic);
  });

  it('falls as volatility rises — that is the variance drag', () => {
    expect(amortizationRealRate(7, 25, 2.5)).toBeLessThan(amortizationRealRate(7, 10, 2.5));
  });

  it('never goes negative', () => {
    expect(amortizationRealRate(2, 40, 6)).toBeGreaterThanOrEqual(0);
  });

  it('flattens median spending versus amortizing at the arithmetic mean', () => {
    const vol: ReturnModel = { annualReturn: 7, annualVolatility: 17 };
    const spendPath = (rate: number) =>
      runProjection({ kind: 'amortized', realDiscountRate: rate }, p({ returnModel: vol }), {
        returnPath: buildReturnPath(600, 40, vol, mulberry32(77)),
      }).realWithdrawals;

    const arithmetic = spendPath(1.07 / 1.025 - 1);
    const geometric = spendPath(amortizationRealRate(7, 17, 2.5));
    const decline = (w: number[]) => w[0] / w[Math.floor(w.length * 0.6)];
    // Both decline on this path; amortizing at the median rate declines less.
    expect(decline(geometric)).toBeLessThan(decline(arithmetic));
  });
});

describe('annuityFactor', () => {
  it('equals the year count at a zero discount rate', () => {
    expect(annuityFactor(30, 0)).toBeCloseTo(30, 8);
  });

  it('is below the year count at a positive rate', () => {
    expect(annuityFactor(30, 0.04)).toBeLessThan(30);
    expect(annuityFactor(30, 0.04)).toBeCloseTo(17.292, 2);
  });

  it('grows with the horizon', () => {
    expect(annuityFactor(40, 0.04)).toBeGreaterThan(annuityFactor(20, 0.04));
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });

  it('stays inside [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('glidepath', () => {
  const gp = {
    enabled: true,
    startAge: 50,
    endAge: 70,
    endEquityPct: 0.5,
    bondReturn: 3,
    bondVolatility: 5,
  };

  it('holds 100% equity before the start age', () => {
    expect(equityShareAtAge(40, gp)).toBe(1);
  });

  it('reaches the target allocation at the end age and holds it', () => {
    expect(equityShareAtAge(70, gp)).toBeCloseTo(0.5, 8);
    expect(equityShareAtAge(85, gp)).toBeCloseTo(0.5, 8);
  });

  it('interpolates linearly in between', () => {
    expect(equityShareAtAge(60, gp)).toBeCloseTo(0.75, 8);
  });

  it('is a no-op when disabled', () => {
    expect(equityShareAtAge(80, { ...gp, enabled: false })).toBe(1);
    expect(equityShareAtAge(80, undefined)).toBe(1);
  });

  it('lowers both expected return and volatility as it de-risks', () => {
    const model: ReturnModel = { annualReturn: 7, annualVolatility: 17, glidepath: gp };
    const young = blendedMoments(40, model);
    const old = blendedMoments(80, model);
    expect(old.mu).toBeLessThan(young.mu);
    expect(old.sigma).toBeLessThan(young.sigma);
    expect(old.mu).toBeCloseTo(0.05, 8); // half 7%, half 3%
    expect(old.sigma).toBeCloseTo(0.11, 8); // half 17%, half 5%
  });
});

describe('buildReturnPath', () => {
  it('is perfectly smooth with zero volatility', () => {
    const path = buildReturnPath(24, 40, flatReturn, null);
    const expected = Math.pow(1.07, 1 / 12) - 1;
    for (let i = 0; i <= 24; i++) expect(path[i]).toBeCloseTo(expected, 12);
  });

  it('preserves the arithmetic mean when volatility is added', () => {
    const rand = mulberry32(3);
    const model: ReturnModel = { annualReturn: 7, annualVolatility: 17 };
    let sum = 0;
    let n = 0;
    for (let k = 0; k < 400; k++) {
      const path = buildReturnPath(120, 40, model, rand);
      for (let i = 0; i <= 120; i++) {
        sum += path[i];
        n++;
      }
    }
    const monthlyMean = sum / n;
    const annualized = Math.pow(1 + monthlyMean, 12) - 1;
    // Lognormal draws are noisy; 1pp of tolerance on 7% is plenty tight
    // to catch a missing variance correction (which would show ~+1.5pp).
    expect(annualized).toBeGreaterThan(0.06);
    expect(annualized).toBeLessThan(0.08);
  });

  it('is reproducible for a given seed', () => {
    const a = buildReturnPath(60, 40, { annualReturn: 7, annualVolatility: 17 }, mulberry32(5));
    const b = buildReturnPath(60, 40, { annualReturn: 7, annualVolatility: 17 }, mulberry32(5));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('buildEquityInflows — plan separation', () => {
  const companies = [
    {
      id: 'acme',
      name: 'Acme',
      contracts: [
        {
          name: 'G1',
          shares: 100_000,
          strike: 1,
          startDate: '2020-01-01',
          periodYears: 4,
          cliffMonths: 0,
          cliffType: 'standard' as const,
        },
      ],
      exitYear: 2030,
      exitMonth: 1,
      sharePriceAtExit: 10,
      secondaryIls: 500_000,
      secondaryYear: 2027,
      secondaryMonth: 6,
    },
  ];

  it('produces nothing at all when the factor is zero', () => {
    const { flows, labels } = buildEquityInflows(companies, 240, 2026, 0);
    expect(flows.reduce((s, v) => s + v, 0)).toBe(0);
    expect(Object.keys(labels)).toHaveLength(0);
  });

  it('scales linearly with the factor', () => {
    const full = buildEquityInflows(companies, 240, 2026, 1).flows.reduce((s, v) => s + v, 0);
    const half = buildEquityInflows(companies, 240, 2026, 0.5).flows.reduce((s, v) => s + v, 0);
    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 4);
  });

  it('lands the secondary in the right month', () => {
    const { flows } = buildEquityInflows(companies, 240, 2026, 1);
    const idx = (2027 - 2026) * 12 + (6 - 1);
    expect(flows[idx]).toBeGreaterThanOrEqual(500_000);
  });

  it('labels exit and secondary events', () => {
    const { labels } = buildEquityInflows(companies, 240, 2026, 1);
    const all = Object.values(labels).flat();
    expect(all).toContain('סקנדרי Acme');
    expect(all).toContain('אקזיט Acme');
  });

  it('excludes shares sold in the secondary from the exit', () => {
    const sum = (cs: typeof companies) =>
      buildEquityInflows(cs, 240, 2026, 1).flows.reduce((s, v) => s + v, 0);
    const base = sum(companies);
    const withSold = sum(companies.map((c) => ({ ...c, secondaryShares: 1_000 })));
    expect(withSold).toBeLessThan(base);
  });
});

describe('runProjection — structure', () => {
  it('starts near the initial balances (month 0 already earns and saves)', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    // One month of growth plus one month of saving — a few percent, no more.
    expect(run.points[0].investments).toBeGreaterThan(baseParams.investmentInitialValue);
    expect(run.points[0].investments).toBeLessThan(baseParams.investmentInitialValue * 1.03);
    expect(run.points[0].pension).toBeGreaterThan(baseParams.pensionInitialValue);
    expect(run.points[0].pension).toBeLessThan(baseParams.pensionInitialValue * 1.05);
  });

  it('covers the whole horizon', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const last = run.points[run.points.length - 1];
    expect(last.index).toBe((90 - 40) * 12);
    expect(parseFloat(last.fullAge)).toBeCloseTo(90, 1);
  });

  it('accrues pension contributions while working and stops after', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const working = run.points.find((pt) => pt.index === 12)!;
    const retired = run.points.find((pt) => pt.index === 12 * 12)!;
    expect(working.pensionContribution).toBeGreaterThan(0);
    expect(retired.pensionContribution).toBe(0);
  });

  it('halves contributions in the half-time phase', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const full = run.points.find((pt) => pt.index === 12)!;
    const half = run.points.find((pt) => pt.index === 7 * 12)!;
    // Contributions are CPI-indexed, so compare in today's money.
    const growth = Math.pow(1 + p().inflationRate / 100, 6);
    expect(half.pensionContribution / full.pensionContribution).toBeCloseTo(growth / 2, 3);
  });

  it('indexes salary and contributions to CPI while working', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const y1 = run.points.find((pt) => pt.index === 12)!;
    const y2 = run.points.find((pt) => pt.index === 24)!;
    const cpi = 1 + p().inflationRate / 100;
    expect(y2.currentIncome / y1.currentIncome).toBeCloseTo(cpi, 4);
    expect(y2.pensionContribution / y1.pensionContribution).toBeCloseTo(cpi, 4);
  });

  it('starts the calendar at startMonth, not January', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 },
      { ...p(), baseYear: 2026, startMonth: 8 });
    expect(run.points[0].label).toBe('9/2026');
    expect(run.points.find((pt) => pt.index === 4)!.label).toBe('1/2027');
  });

  it('converts the pension to an annuity at 60', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const at60 = run.points.find((pt) => parseFloat(pt.fullAge) >= 60)!;
    expect(at60.pensionAnnuity).toBeGreaterThan(0);
    const later = run.points.filter((pt) => parseFloat(pt.fullAge) > 61);
    expect(later.every((pt) => pt.pension === 0)).toBe(true);
  });

  it('exposes a deflator that matches the inflation rate', () => {
    const run = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const oneYear = run.points.find((pt) => pt.index === 12)!;
    expect(oneYear.deflator).toBeCloseTo(1.025, 4);
  });
});

describe('runProjection — capital gains are actually charged', () => {
  it('reports tax during the drawdown', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const retired = run.points.filter((pt) => parseFloat(pt.fullAge) > 50 && parseFloat(pt.fullAge) < 60);
    expect(retired.some((pt) => pt.taxPaid > 0)).toBe(true);
  });

  it('leaves less behind than a hypothetical tax-free run', () => {
    // Same everything, but the portfolio is all basis → nothing to tax.
    const taxed = runProjection({ kind: 'fixed', monthly: 25_000 }, p({ investmentInitialGain: 2_900_000 }));
    const untaxed = runProjection({ kind: 'fixed', monthly: 25_000 }, p({ investmentInitialGain: 0 }));
    expect(untaxed.finalWealth).toBeGreaterThan(taxed.finalWealth);
  });

  it('withdraws more gross than net when there is an embedded gain', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const pt = run.points.find(
      (x) => parseFloat(x.fullAge) > 51 && x.withdrawalFromInvestments > 0,
    )!;
    expect(pt.withdrawalFromInvestments).toBeGreaterThan(pt.monthlyOutflow * 0.99);
  });

  it('taxes the property purchase, which the old engine did not', () => {
    const withProp = runProjection(
      { kind: 'fixed', monthly: 20_000 },
      p({ propertyConfig: { price: 1_000_000, year: 2030, monthlySavings: 0 } }),
    );
    const buy = withProp.points.find((pt) => pt.event?.includes('רכישת דירה'))!;
    expect(buy).toBeDefined();
    expect(buy.taxPaid).toBeGreaterThan(0);
    expect(buy.property).toBeCloseTo(1_000_000, -3);
  });
});

describe('runProjection — equity plan separation', () => {
  const companies = [
    {
      id: 'acme',
      name: 'Acme',
      contracts: [
        {
          name: 'G1',
          shares: 200_000,
          strike: 1,
          startDate: '2020-01-01',
          periodYears: 4,
          cliffMonths: 0,
          cliffType: 'standard' as const,
        },
      ],
      exitYear: 2030,
      exitMonth: 1,
      sharePriceAtExit: 12,
    },
  ];

  it('the base plan (factor 0) is strictly poorer than the upside plan', () => {
    const base = findDeterministicWithdrawal(p({ equityCompanies: companies, equityFactor: 0 }));
    const upside = findDeterministicWithdrawal(p({ equityCompanies: companies, equityFactor: 1 }));
    expect(upside.monthly).toBeGreaterThan(base.monthly);
  });

  it('a zero factor matches having no companies at all', () => {
    const withZero = findDeterministicWithdrawal(p({ equityCompanies: companies, equityFactor: 0 }));
    const without = findDeterministicWithdrawal(p({ equityCompanies: [], equityFactor: 1 }));
    expect(withZero.monthly).toBe(without.monthly);
  });
});

describe('findDeterministicWithdrawal', () => {
  it('finds a positive, finite withdrawal', () => {
    const { monthly } = findDeterministicWithdrawal(p());
    expect(monthly).toBeGreaterThan(0);
    expect(Number.isFinite(monthly)).toBe(true);
  });

  it('is the edge of solvency — a bit more ruins the plan', () => {
    const { monthly } = findDeterministicWithdrawal(p());
    const tooMuch = runProjection({ kind: 'fixed', monthly: monthly * 1.25 }, p());
    expect(tooMuch.ruined).toBe(true);
  });

  it('rises with the return rate', () => {
    const low = findDeterministicWithdrawal(p({ returnModel: { annualReturn: 4, annualVolatility: 0 } }));
    const high = findDeterministicWithdrawal(p({ returnModel: { annualReturn: 9, annualVolatility: 0 } }));
    expect(high.monthly).toBeGreaterThan(low.monthly);
  });

  it('falls when inflation rises', () => {
    const low = findDeterministicWithdrawal(p({ inflationRate: 1 }));
    const high = findDeterministicWithdrawal(p({ inflationRate: 4 }));
    expect(high.monthly).toBeLessThan(low.monthly);
  });

  it('falls when retirement comes sooner', () => {
    const late = findDeterministicWithdrawal(p({ stopWorkYear: 20, transitionToHalfWorkYear: 15 }));
    const early = findDeterministicWithdrawal(p({ stopWorkYear: 5, transitionToHalfWorkYear: 3 }));
    expect(early.monthly).toBeLessThan(late.monthly);
  });
});

describe('volatility is what the refactor is for', () => {
  it('the deterministic optimum fails often once volatility is added', () => {
    const params = p();
    const { monthly } = findDeterministicWithdrawal(params);
    const mc = runMonteCarlo(
      { kind: 'fixed', monthly },
      { ...params, returnModel: { annualReturn: 7, annualVolatility: 17 } },
      { paths: 120, seed: 1 },
    );
    // A plan tuned to land on exactly zero has no margin: roughly a coin flip.
    expect(mc.failureRate).toBeGreaterThan(0.3);
  });

  it('a zero-volatility Monte Carlo reproduces the deterministic run', () => {
    const params = p();
    const { monthly } = findDeterministicWithdrawal(params);
    const mc = runMonteCarlo({ kind: 'fixed', monthly: monthly * 0.8 }, params, {
      paths: 5,
      seed: 2,
    });
    expect(mc.failureRate).toBe(0);
    expect(mc.finalWealthReal.p10).toBeCloseTo(mc.finalWealthReal.p90, 4);
  });

  it('higher volatility means more failures at the same withdrawal', () => {
    const params = p();
    const { monthly } = findDeterministicWithdrawal(params);
    const draw = monthly * 0.75;
    const calm = runMonteCarlo(
      { kind: 'fixed', monthly: draw },
      { ...params, returnModel: { annualReturn: 7, annualVolatility: 8 } },
      { paths: 120, seed: 3 },
    );
    const wild = runMonteCarlo(
      { kind: 'fixed', monthly: draw },
      { ...params, returnModel: { annualReturn: 7, annualVolatility: 25 } },
      { paths: 120, seed: 3 },
    );
    expect(wild.failureRate).toBeGreaterThan(calm.failureRate);
  });
});

describe('runMonteCarlo', () => {
  const vol: ReturnModel = { annualReturn: 7, annualVolatility: 17 };

  it('is reproducible for a given seed', () => {
    const a = runMonteCarlo({ kind: 'fixed', monthly: 30_000 }, p({ returnModel: vol }), { paths: 40, seed: 11 });
    const b = runMonteCarlo({ kind: 'fixed', monthly: 30_000 }, p({ returnModel: vol }), { paths: 40, seed: 11 });
    expect(a.failureRate).toBe(b.failureRate);
    expect(a.bands.map((x) => x.p50)).toEqual(b.bands.map((x) => x.p50));
  });

  it('returns ordered percentile bands', () => {
    const mc = runMonteCarlo({ kind: 'fixed', monthly: 30_000 }, p({ returnModel: vol }), { paths: 60, seed: 12 });
    expect(mc.bands.length).toBeGreaterThan(0);
    for (const b of mc.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p90);
    }
  });

  it('reports a ruin age only when there are failures', () => {
    const safe = runMonteCarlo({ kind: 'fixed', monthly: 1_000 }, p(), { paths: 20, seed: 13 });
    expect(safe.failureRate).toBe(0);
    expect(safe.medianRuinAge).toBeNull();

    const doomed = runMonteCarlo({ kind: 'fixed', monthly: 400_000 }, p({ returnModel: vol }), { paths: 20, seed: 14 });
    expect(doomed.failureRate).toBeGreaterThan(0);
    expect(doomed.medianRuinAge).toBeGreaterThan(40);
  });

  it('failure rate rises monotonically with the withdrawal', () => {
    const at = (monthly: number) =>
      runMonteCarlo({ kind: 'fixed', monthly }, p({ returnModel: vol }), { paths: 100, seed: 15 }).failureRate;
    expect(at(20_000)).toBeLessThanOrEqual(at(45_000));
    expect(at(45_000)).toBeLessThanOrEqual(at(90_000));
  });
});

describe('amortized ("die with zero") policy', () => {
  const vol: ReturnModel = { annualReturn: 7, annualVolatility: 17 };
  const amortized = { kind: 'amortized' as const, realDiscountRate: 0.04 };

  it('never runs out — that is the whole point', () => {
    const mc = runMonteCarlo(amortized, p({ returnModel: vol }), { paths: 150, seed: 21 });
    expect(mc.failureRate).toBe(0);
  });

  it('leaves far less behind than a conservative fixed rule', () => {
    const amort = runMonteCarlo(amortized, p(), { paths: 10, seed: 22 });
    const fixed = runMonteCarlo({ kind: 'fixed', monthly: 15_000 }, p(), { paths: 10, seed: 22 });
    expect(amort.finalWealthReal.p50).toBeLessThan(fixed.finalWealthReal.p50);
  });

  it('lands near zero on a smooth path', () => {
    const run = runProjection(amortized, p());
    const start = baseParams.investmentInitialValue + baseParams.pensionInitialValue;
    expect(run.finalWealthReal).toBeLessThan(start * 0.15);
  });

  it('pays for that safety with a volatile income', () => {
    const mc = runMonteCarlo(amortized, p({ returnModel: vol }), { paths: 150, seed: 23 });
    expect(mc.spend.worstYearP50).toBeLessThan(mc.spend.p50);
  });

  it('honours a spending floor', () => {
    const withFloor = runProjection(
      { kind: 'amortized', realDiscountRate: 0.04, floorMonthly: 40_000 },
      p(),
    );
    const retired = withFloor.realWithdrawals;
    expect(retired.length).toBeGreaterThan(0);
    expect(Math.min(...retired)).toBeGreaterThanOrEqual(40_000 - 1);
  });

  it('honours a spending cap', () => {
    const withCap = runProjection(
      { kind: 'amortized', realDiscountRate: 0.04, capMonthly: 25_000 },
      p(),
    );
    expect(Math.max(...withCap.realWithdrawals)).toBeLessThanOrEqual(25_000 + 1);
  });

  it('a floor can reintroduce ruin risk', () => {
    const mc = runMonteCarlo(
      { kind: 'amortized', realDiscountRate: 0.04, floorMonthly: 120_000 },
      p({ returnModel: vol }),
      { paths: 100, seed: 24 },
    );
    expect(mc.failureRate).toBeGreaterThan(0);
  });
});

describe('findWithdrawalForSuccessRate', () => {
  const vol: ReturnModel = { annualReturn: 7, annualVolatility: 17 };

  it('respects the requested success target', () => {
    const r = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.85, { paths: 80, seed: 31 });
    expect(r.monthly).toBeGreaterThan(0);
    expect(r.failureRate).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it('a stricter target allows less spending', () => {
    const lenient = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.7, { paths: 80, seed: 32 });
    const strict = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.95, { paths: 80, seed: 32 });
    expect(strict.monthly).toBeLessThan(lenient.monthly);
  });

  it('comes in below the deterministic optimum', () => {
    const det = findDeterministicWithdrawal(p({ returnModel: vol }));
    const prob = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.85, { paths: 80, seed: 33 });
    expect(prob.monthly).toBeLessThan(det.monthly);
  });

  it('is reproducible', () => {
    const a = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.85, { paths: 60, seed: 34 });
    const b = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.85, { paths: 60, seed: 34 });
    expect(a.monthly).toBe(b.monthly);
  });
});

describe('every reported figure is in today\'s shekels', () => {
  it('a fixed policy holds real spending exactly constant for life', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const w = run.realWithdrawals;
    expect(w.length).toBeGreaterThan(400);
    for (const v of w) expect(v).toBeCloseTo(25_000, 6);
  });

  it('...while the amount actually leaving the account tracks the CPI', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const retired = run.points.filter((pt) => parseFloat(pt.fullAge) >= 50);
    const first = retired[0];
    const twentyYearsOn = retired.find(
      (pt) => pt.index >= first.index + 240 && pt.monthlyOutflow > 0,
    )!;
    // 20 years of 2.5% inflation ≈ x1.64 in nominal terms.
    expect(twentyYearsOn.monthlyOutflow / first.monthlyOutflow).toBeCloseTo(
      Math.pow(1.025, 20),
      1,
    );
  });

  it('reports Monte Carlo spend percentiles in real terms too', () => {
    const mc = runMonteCarlo({ kind: 'fixed', monthly: 25_000 }, p(), { paths: 20, seed: 5 });
    // No volatility here, so every path spends exactly the real target.
    expect(mc.spend.p50).toBeCloseTo(25_000, 4);
    expect(mc.spend.worstYearP50).toBeCloseTo(25_000, 4);
  });

  it('reports wealth bands in real terms', () => {
    const mc = runMonteCarlo({ kind: 'fixed', monthly: 25_000 }, p(), { paths: 10, seed: 6 });
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const last = mc.bands[mc.bands.length - 1];
    const lastPoint = run.points[run.points.length - 1];
    expect(last.p50).toBeCloseTo(lastPoint.liquidWealth / lastPoint.deflator, -2);
  });
});

describe('consumption smoothing across the pension', () => {
  // A pot amortized on its own gives ~₪11k/month until 60 and ~₪70k after,
  // because the pension is ignored until it suddenly arrives. Nobody wants to
  // live that, and the blended median describes neither half.
  const amortized = { kind: 'amortized' as const, realDiscountRate: 0.03 };

  const bigPension = () =>
    p({ pensionInitialValue: 4_000_000, investmentInitialValue: 4_000_000, investmentInitialGain: 0, stopWorkYear: 12, transitionToHalfWorkYear: 12 });

  it('does not leave a large step at the pension age', () => {
    const run = runProjection(amortized, bigPension());
    const before = run.realWithdrawalsBeforeAnnuity;
    const after = run.realWithdrawalsFromAnnuity;
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    const lastBefore = before[before.length - 1];
    const firstAfter = after[0];
    // Within 2x rather than the ~6x step the un-smoothed rule produced.
    expect(firstAfter / lastBefore).toBeLessThan(2);
  });

  it('raises pre-60 spending versus ignoring the pension entirely', () => {
    const run = runProjection(amortized, bigPension());
    const investmentsOnly =
      bigPension().investmentInitialValue / (annuityFactor(50 - 12, 0.03) * 12);
    expect(run.realWithdrawalsBeforeAnnuity[0]).toBeGreaterThan(investmentsOnly);
  });

  it('never plans the bridge past what the accessible pot can fund', () => {
    // A huge pension must not tempt the rule into spending more before 60 than
    // the (untouchable-pension-excluded) bridge can actually cover.
    const params = p({
      pensionInitialValue: 20_000_000,
      investmentInitialValue: 500_000,
      investmentInitialGain: 0,
      stopWorkYear: 5,
      transitionToHalfWorkYear: 5,
    });
    const run = runProjection(amortized, params);
    const retireIndex = 5 * 12;
    const atRetirement = run.points.find((pt) => pt.index === retireIndex)!;
    const bridgeReal = atRetirement.investments / atRetirement.deflator;
    const monthsToSixty = (60 - 45) * 12;
    // The first year's draw cannot exceed a level spend-down of the bridge.
    expect(run.realWithdrawalsBeforeAnnuity[0]).toBeLessThanOrEqual(
      bridgeReal / monthsToSixty + 1,
    );
  });

  it('reports the two phases separately', () => {
    const mc = runMonteCarlo(amortized, bigPension(), { paths: 30, seed: 41 });
    expect(mc.spend.beforeAnnuityP50).toBeGreaterThan(0);
    expect(mc.spend.fromAnnuityP50).toBeGreaterThan(0);
  });

  it('sizes withdrawals off the after-tax pot, not the headline value', () => {
    // Same market value, all of it gain vs none of it — the taxable one must
    // support a smaller withdrawal, or the target would be unfundable.
    const allGain = runProjection(amortized, p({ investmentInitialGain: 3_000_000 }));
    const noGain = runProjection(amortized, p({ investmentInitialGain: 0 }));
    expect(allGain.realWithdrawals[0]).toBeLessThan(noGain.realWithdrawals[0]);
  });
});

describe('findWithdrawalsForSuccessRates', () => {
  const vol: ReturnModel = { annualReturn: 10, annualVolatility: 18 };

  it('a stricter confidence level never allows more spending', () => {
    const [at90, at95] = findWithdrawalsForSuccessRates(
      p({ returnModel: vol }), [0.9, 0.95], { paths: 80, seed: 51 },
    );
    expect(at95.monthly).toBeLessThanOrEqual(at90.monthly);
  });

  it('matches solving each level on its own', () => {
    const together = findWithdrawalsForSuccessRates(
      p({ returnModel: vol }), [0.9, 0.95], { paths: 80, seed: 52 },
    );
    const alone90 = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.9, { paths: 80, seed: 52 });
    const alone95 = findWithdrawalForSuccessRate(p({ returnModel: vol }), 0.95, { paths: 80, seed: 52 });
    expect(together[0].monthly).toBe(alone90.monthly);
    expect(together[1].monthly).toBe(alone95.monthly);
  });

  it('honours every requested level', () => {
    const levels = [0.8, 0.9, 0.95];
    const out = findWithdrawalsForSuccessRates(
      p({ returnModel: vol }), levels, { paths: 80, seed: 53 },
    );
    expect(out).toHaveLength(3);
    out.forEach((r, i) => expect(r.failureRate).toBeLessThanOrEqual(1 - levels[i] + 1e-9));
  });

  it('is monotone across the whole ladder', () => {
    const out = findWithdrawalsForSuccessRates(
      p({ returnModel: vol }), [0.7, 0.8, 0.9, 0.95, 0.99], { paths: 80, seed: 54 },
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].monthly).toBeLessThanOrEqual(out[i - 1].monthly);
    }
  });

  it('a fixed plan sized for a bad future leaves a large median estate', () => {
    // Safety and legacy are the same dial.
    const [solved] = findWithdrawalsForSuccessRates(
      p({ returnModel: vol }), [0.95], { paths: 80, seed: 55 },
    );
    const mc = runMonteCarlo({ kind: 'fixed', monthly: solved.monthly }, p({ returnModel: vol }), {
      paths: 150, seed: 56,
    });
    const startingWealth = baseParams.investmentInitialValue + baseParams.pensionInitialValue;
    expect(mc.finalWealthReal.p50).toBeGreaterThan(startingWealth);
  });
});

describe('dynamic spending with guardrails', () => {
  const vol: ReturnModel = { annualReturn: 10, annualVolatility: 18 };
  const rates = () =>
    safeWithdrawalRateTable(vol, 2.5, 0.95, 50, 90, { paths: 120, seed: 4 });

  const dyn = (maxRise = 0.2, maxFall = 0.1) => ({
    kind: 'dynamic' as const,
    rateByAge: rates(),
    realDiscountRate: 0.03,
    maxRise,
    maxFall,
  });

  it('the safe rate rises as the horizon shortens', () => {
    const t = rates();
    expect(t[50]).toBeGreaterThan(0);
    expect(t[80]).toBeGreaterThan(t[60]);
    expect(t[60]).toBeGreaterThan(t[50]);
  });

  it('a stricter confidence target lowers every rate', () => {
    const at90 = safeWithdrawalRateTable(vol, 2.5, 0.9, 50, 90, { paths: 120, seed: 4 });
    const at95 = safeWithdrawalRateTable(vol, 2.5, 0.95, 50, 90, { paths: 120, seed: 4 });
    for (const age of [50, 60, 70, 80]) {
      expect(at95[age]).toBeLessThanOrEqual(at90[age]);
    }
  });

  it('prices the glidepath: de-risked years get the bond return, not equity', () => {
    const glide = {
      ...vol,
      glidepath: { enabled: true, startAge: 50, endAge: 70, endEquityPct: 0.3, bondReturn: 4, bondVolatility: 6 },
    };
    const equity = safeWithdrawalRateTable(vol, 2.5, 0.95, 50, 90, { paths: 120, seed: 4 });
    const derisked = safeWithdrawalRateTable(glide, 2.5, 0.95, 50, 90, { paths: 120, seed: 4 });
    // At 75 the glidepath pot is 30% equity — a very different rate from 100%.
    expect(Math.abs(derisked[75] - equity[75])).toBeGreaterThan(0.002);
  });

  it('never moves spending more than the collar allows', () => {
    const run = runProjection(dyn(0.2, 0.1), p({ returnModel: vol }));
    const byAge = run.realWithdrawalByAge;
    const ages = Object.keys(byAge).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < ages.length; i++) {
      const prev = byAge[ages[i - 1]];
      const cur = byAge[ages[i]];
      if (ages[i] - ages[i - 1] !== 1) continue;
      expect(cur).toBeLessThanOrEqual(prev * 1.2 + 1);
      expect(cur).toBeGreaterThanOrEqual(prev * 0.9 - 1);
    }
  });

  it('a tighter collar produces a smoother path', () => {
    const spread = (maxRise: number, maxFall: number) => {
      const w = runProjection(dyn(maxRise, maxFall), p({ returnModel: vol })).realWithdrawals;
      return Math.max(...w) / Math.min(...w);
    };
    expect(spread(0.05, 0.025)).toBeLessThan(spread(0.5, 0.3));
  });

  it('leaves far less behind than an equivalent fixed plan', () => {
    const dynamicMc = runMonteCarlo(dyn(), p({ returnModel: vol }), { paths: 120, seed: 61 });
    const [fixed] = findWithdrawalsForSuccessRates(p({ returnModel: vol }), [0.95], {
      paths: 60, seed: 62,
    });
    const fixedMc = runMonteCarlo({ kind: 'fixed', monthly: fixed.monthly }, p({ returnModel: vol }), {
      paths: 120, seed: 61,
    });
    expect(dynamicMc.finalWealthReal.p50).toBeLessThan(fixedMc.finalWealthReal.p50);
  });

  it('does not raise the chance of running out versus the fixed plan', () => {
    const dynamicMc = runMonteCarlo(dyn(), p({ returnModel: vol }), { paths: 150, seed: 63 });
    const [fixed] = findWithdrawalsForSuccessRates(p({ returnModel: vol }), [0.95], {
      paths: 60, seed: 64,
    });
    const fixedMc = runMonteCarlo({ kind: 'fixed', monthly: fixed.monthly }, p({ returnModel: vol }), {
      paths: 150, seed: 63,
    });
    expect(dynamicMc.failureRate).toBeLessThanOrEqual(fixedMc.failureRate + 0.02);
  });

  it('reports a spending trajectory that grows as the horizon shortens', () => {
    const mc = runMonteCarlo(dyn(), p({ returnModel: vol }), { paths: 120, seed: 65 });
    expect(mc.spendByAge[85]).toBeGreaterThan(mc.spendByAge[55]);
  });
});

describe('lifestyle ceiling', () => {
  const vol: ReturnModel = { annualReturn: 10, annualVolatility: 18 };
  const rates = safeWithdrawalRateTable(vol, 2.5, 0.95, 40, 90, { paths: 120, seed: 4 });
  const dyn = (cap?: number) => ({
    kind: 'dynamic' as const,
    rateByAge: rates,
    realDiscountRate: 0.03,
    maxRise: 0.2,
    maxFall: 0.1,
    capMonthly: cap,
  });

  it('never spends above the ceiling', () => {
    const run = runProjection(dyn(40_000), p({ returnModel: vol }));
    expect(Math.max(...run.realWithdrawals)).toBeLessThanOrEqual(40_001);
  });

  it('leaves the early years untouched when the ceiling is far above them', () => {
    const capped = runProjection(dyn(500_000), p({ returnModel: vol })).realWithdrawals;
    const free = runProjection(dyn(), p({ returnModel: vol })).realWithdrawals;
    expect(capped[0]).toBeCloseTo(free[0], 4);
  });

  it('flattens the late-life trajectory — the whole point', () => {
    const capped = runMonteCarlo(dyn(40_000), p({ returnModel: vol }), { paths: 80, seed: 71 });
    const free = runMonteCarlo(dyn(), p({ returnModel: vol }), { paths: 80, seed: 71 });
    expect(free.spendByAge[85]).toBeGreaterThan(capped.spendByAge[85]);
    expect(capped.spendByAge[85]).toBeLessThanOrEqual(40_001);
  });

  it('converts the unspent money into an estate — the honest trade-off', () => {
    const capped = runMonteCarlo(dyn(40_000), p({ returnModel: vol }), { paths: 80, seed: 72 });
    const free = runMonteCarlo(dyn(), p({ returnModel: vol }), { paths: 80, seed: 72 });
    expect(capped.finalWealthReal.p50).toBeGreaterThan(free.finalWealthReal.p50);
  });

  it('a lower ceiling leaves more behind', () => {
    const low = runMonteCarlo(dyn(25_000), p({ returnModel: vol }), { paths: 80, seed: 73 });
    const high = runMonteCarlo(dyn(60_000), p({ returnModel: vol }), { paths: 80, seed: 73 });
    expect(low.finalWealthReal.p50).toBeGreaterThan(high.finalWealthReal.p50);
  });
});

describe('taxes', () => {
  it('the surtax is marginal, not a cliff', () => {
    // Just past the threshold only the excess is surcharged, so the marginal
    // rate on the next shekel is 28% while the average stays near 25%.
    expect(cgtRate(SURTAX_THRESHOLD - 1)).toBeCloseTo(0.25, 10);
    expect(cgtRate(SURTAX_THRESHOLD + 1)).toBeCloseTo(0.28, 10);
  });

  it('adds the second surtax tier above 5M', () => {
    expect(cgtRate(6_000_000)).toBeCloseTo(0.3, 10);
  });

  it('agrees with how exit proceeds are taxed', () => {
    // calculateNetEquity has always used the brackets; the withdrawal path
    // must sit on the same ladder.
    expect(cgtRate(100_000)).toBe(CAPITAL_GAINS_TAX_BRACKETS[0].rate);
    expect(cgtRate(1_000_000)).toBe(CAPITAL_GAINS_TAX_BRACKETS[1].rate);
    expect(cgtRate(9_000_000)).toBe(CAPITAL_GAINS_TAX_BRACKETS[2].rate);
  });

  it('taxes only the gain, so a higher basis costs less tax', () => {
    const bigGain = runProjection({ kind: 'fixed', monthly: 25_000 }, p({ investmentInitialGain: 2_900_000 }));
    const noGain = runProjection({ kind: 'fixed', monthly: 25_000 }, p({ investmentInitialGain: 0 }));
    expect(bigGain.lifetimeTaxReal).toBeGreaterThan(noGain.lifetimeTaxReal);
  });

  it('reports a lifetime tax bill that is material but not absurd', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const lifetimeSpend = 25_000 * run.realWithdrawals.length;
    expect(run.lifetimeTaxReal).toBeGreaterThan(0);
    expect(run.lifetimeTaxReal).toBeLessThan(lifetimeSpend * 0.5);
  });

  it('charges the 15% pension annuity tax from 60', () => {
    const run = runProjection({ kind: 'fixed', monthly: 25_000 }, p());
    const at65 = run.points.find((pt) => parseFloat(pt.fullAge) >= 65)!;
    expect(at65.pensionAnnuity).toBeGreaterThan(0);
    expect(at65.taxPaid).toBeGreaterThan(0);
  });

  it('resets the bracket position each calendar year', () => {
    // Two identical years must cost the same tax; if the year-to-date base
    // never reset, the second year would be pushed into a higher bracket.
    const run = runProjection({ kind: 'fixed', monthly: 60_000 }, p({ investmentInitialGain: 2_900_000 }));
    const taxIn = (age: number) =>
      run.points.filter((pt) => Math.floor(parseFloat(pt.fullAge)) === age)
        .reduce((sum, pt) => sum + pt.taxPaid, 0);
    expect(taxIn(52)).toBeGreaterThan(0);
    expect(taxIn(53) / taxIn(52)).toBeGreaterThan(0.7);
    expect(taxIn(53) / taxIn(52)).toBeLessThan(1.4);
  });
});

describe('regression guards', () => {
  it('handles a zero-length horizon without throwing', () => {
    expect(() => runProjection({ kind: 'fixed', monthly: 1000 }, p({ endOfLifeAge: 40 }))).not.toThrow();
  });

  it('handles empty expense arrays', () => {
    expect(() =>
      runProjection({ kind: 'fixed', monthly: 1000 }, p({ monthlyExpenses: [], yearlyExpenses: [] })),
    ).not.toThrow();
  });

  it('does not deduct one-time expenses — today\'s balances already paid them', () => {
    const withOneTime = runProjection(
      { kind: 'fixed', monthly: 20_000 },
      p({ yearlyExpenses: [{ id: 1, name: 'trip', amount: 100_000, oneTime: true }] }),
    );
    const baseline = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const last = (r: typeof baseline) => r.points[r.points.length - 1].investments;
    expect(last(withOneTime)).toBeCloseTo(last(baseline), 0);
  });

  it('amortizes every-N-years expenses rather than charging them in full', () => {
    const withCar = runProjection(
      { kind: 'fixed', monthly: 20_000 },
      p({ yearlyExpenses: [{ id: 1, name: 'car', amount: 150_000, everyNYears: 5 }] }),
    );
    const baseline = runProjection({ kind: 'fixed', monthly: 20_000 }, p());
    const a = withCar.points.find((x) => x.index === 12)!;
    const b = baseline.points.find((x) => x.index === 12)!;
    expect(a.monthlyOutflow - b.monthlyOutflow).toBeCloseTo((150_000 / 5 / 12) * Math.pow(1.025, 1), -1);
  });

  it('uses the configured annuity coefficient', () => {
    const generous = runProjection({ kind: 'fixed', monthly: 20_000 }, p({ annuityCoefficient: 150 }));
    const stingy = runProjection({ kind: 'fixed', monthly: 20_000 }, p({ annuityCoefficient: 250 }));
    const at60 = (r: typeof generous) =>
      r.points.find((pt) => parseFloat(pt.fullAge) >= 60)!.pensionAnnuity;
    expect(at60(generous)).toBeGreaterThan(at60(stingy));
  });

  it('defaults the annuity coefficient to 210', () => {
    expect(DEFAULT_ANNUITY_COEFFICIENT).toBe(210);
  });
});

describe('medianReturnModel', () => {
  it('compounds at the geometric mean, so the smooth path tracks the median', () => {
    const m = medianReturnModel({ annualReturn: 10, annualVolatility: 18 });
    // (1.10 · e^(−0.0162)) − 1 ≈ 8.23%
    expect(m.annualReturn).toBeCloseTo(8.23, 1);
    expect(m.annualVolatility).toBe(18);
  });
  it('leaves a volatility-free model unchanged', () => {
    const m = medianReturnModel({ annualReturn: 7, annualVolatility: 0 });
    expect(m.annualReturn).toBeCloseTo(7, 10);
  });
  it('matches the geometric rate the amortized rule already uses', () => {
    const m = medianReturnModel({ annualReturn: 10, annualVolatility: 18 });
    const real = (1 + m.annualReturn / 100) / 1.025 - 1;
    expect(real).toBeCloseTo(amortizationRealRate(10, 18, 2.5), 4);
  });
});
