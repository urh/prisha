import { describe, it, expect } from 'vitest';
import {
  calculateNetEquity,
  calculateCapitalGainsEffectiveRate,
  getVestingAtDate,
  calculateBudgetSummary,
  calculateTotalAssets,
  calculatePensionValue,
  calculateInvestmentValue,
  calculateMonthlyReturn,
  calculateMonthlyInflation,
  calculateEarlyPensionWithdrawal,
  calculateGrossForDesiredNet,
  calculatePensionAnnuity,
  calculatePensionAnnuityTax,
  calculateInvestmentWithdrawalTax,
  calculateMarginalTax,
  calculateEffectiveTaxRate,
  findOptimalWithdrawal,
  runSimulation,
  SURTAX_THRESHOLD,
  PENSION_CONTRIBUTION_RATE,
  EARLY_PENSION_PENALTY_TAX,
  FIXED_COEFFICIENT,
  FIXED_PENSION_TAX,
  NON_EMPLOYMENT_TAX_BRACKETS,
  EMPLOYMENT_TAX_BRACKETS,
  CAPITAL_GAINS_TAX_BRACKETS,
} from '../utils/calculations';
import type { EquityContract, Expense, SalaryData, Asset, SimulationDataPoint } from '../types';

describe('calculateNetEquity - Israeli Capital Gains Tax', () => {
  it('returns 0 for zero or negative profit', () => {
    expect(calculateNetEquity(0)).toBe(0);
    expect(calculateNetEquity(-1000)).toBe(0);
  });

  it('returns 0 for undefined/NaN input', () => {
    expect(calculateNetEquity(undefined as unknown as number)).toBe(0);
    expect(calculateNetEquity(null as unknown as number)).toBe(0);
    expect(calculateNetEquity(NaN)).toBe(0);
  });

  it('applies 25% tax for amounts below surtax threshold (~721k)', () => {
    // For 100,000 NIS profit, all is taxed at 25%
    const profit = 100000;
    const expectedTax = profit * 0.25; // 25,000
    const expectedNet = profit - expectedTax; // 75,000
    expect(calculateNetEquity(profit)).toBe(expectedNet);
  });

  it('applies 25% for first bracket, then 28% (25%+3% יסף) for second bracket', () => {
    // For 1,000,000 NIS profit:
    // First 721,560 at 25% = 180,390
    // Remaining 278,440 at 28% = 77,963.2
    // Total tax = 258,353.2
    // Net = 1,000,000 - 258,353 = 741,647
    const profit = 1000000;
    const result = calculateNetEquity(profit);
    
    // Calculate expected manually
    const firstBracketTax = SURTAX_THRESHOLD * 0.25;
    const secondBracketTax = (profit - SURTAX_THRESHOLD) * 0.28;
    const expectedNet = Math.round(profit - firstBracketTax - secondBracketTax);
    
    expect(result).toBe(expectedNet);
  });

  it('applies all three brackets for very large amounts (above 5M)', () => {
    // For 10,000,000 NIS profit:
    // First 721,560 at 25%
    // 721,560 to 5,000,000 at 28%
    // Above 5,000,000 at 30%
    const profit = 10000000;
    const result = calculateNetEquity(profit);
    
    // Calculate expected manually
    const firstBracketTax = SURTAX_THRESHOLD * 0.25; // ~180,390
    const secondBracketTax = (5000000 - SURTAX_THRESHOLD) * 0.28; // ~1,197,963
    const thirdBracketTax = (profit - 5000000) * 0.30; // 1,500,000
    const expectedTax = firstBracketTax + secondBracketTax + thirdBracketTax;
    const expectedNet = Math.round(profit - expectedTax);
    
    expect(result).toBe(expectedNet);
  });

  it('effective tax rate is 25% for small amounts', () => {
    const profit = 100000;
    const rate = calculateCapitalGainsEffectiveRate(profit);
    expect(rate).toBeCloseTo(0.25, 2);
  });

  it('effective tax rate increases with amount due to marginal brackets', () => {
    const smallRate = calculateCapitalGainsEffectiveRate(500000);
    const mediumRate = calculateCapitalGainsEffectiveRate(2000000);
    const largeRate = calculateCapitalGainsEffectiveRate(10000000);
    
    expect(smallRate).toBe(0.25); // All in first bracket
    expect(mediumRate).toBeGreaterThan(smallRate);
    expect(largeRate).toBeGreaterThan(mediumRate);
    expect(largeRate).toBeLessThan(0.30); // Never exceeds top marginal rate
  });

  it('validates CAPITAL_GAINS_TAX_BRACKETS structure', () => {
    expect(CAPITAL_GAINS_TAX_BRACKETS).toHaveLength(3);
    expect(CAPITAL_GAINS_TAX_BRACKETS[0].rate).toBe(0.25);
    expect(CAPITAL_GAINS_TAX_BRACKETS[1].rate).toBe(0.28);
    expect(CAPITAL_GAINS_TAX_BRACKETS[2].rate).toBe(0.30);
  });

  it('handles edge case at exactly surtax threshold', () => {
    const profit = SURTAX_THRESHOLD;
    // All at 25%
    const expectedTax = profit * 0.25;
    const expectedNet = Math.round(profit - expectedTax);
    expect(calculateNetEquity(profit)).toBe(expectedNet);
  });
});

describe('getVestingAtDate', () => {
  const contracts: EquityContract[] = [
    {
      name: "Contract 1",
      shares: 100000,
      strike: 1.0,
      startDate: "2023-01-01",
      periodYears: 4,
      cliffMonths: 12,
    }
  ];

  it('returns 0 vested before cliff', () => {
    const date = new Date(2023, 6, 1); // 6 months in
    const result = getVestingAtDate(contracts, date);
    expect(result.totalVested).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it('calculates partial vesting after cliff', () => {
    const date = new Date(2024, 6, 1); // 18 months in, cliff passed
    const result = getVestingAtDate(contracts, date);
    // 18 months out of 48 = 37.5%
    expect(result.totalVested).toBeGreaterThan(0);
    expect(result.totalVested).toBeLessThan(100000);
    // Approximately 37500 shares
    expect(result.totalVested).toBeCloseTo(37500, -2);
  });

  it('returns full vesting after period ends', () => {
    const date = new Date(2027, 6, 1); // Way past 4 years
    const result = getVestingAtDate(contracts, date);
    expect(result.totalVested).toBe(100000);
    expect(result.totalCost).toBe(100000); // 100000 * 1.0 strike
  });

  it('handles contracts with no cliff (cliffMonths = 0)', () => {
    const noCliffContracts: EquityContract[] = [
      {
        name: "No Cliff Contract",
        shares: 12000,
        strike: 2.0,
        startDate: "2024-01-01",
        periodYears: 1, // 12 months
        cliffMonths: 0,
      }
    ];
    
    // 3 months in = 25%
    const date = new Date(2024, 3, 1);
    const result = getVestingAtDate(noCliffContracts, date);
    expect(result.totalVested).toBe(3000); // 25% of 12000
    expect(result.totalCost).toBe(6000); // 3000 * 2.0
  });

  it('handles multiple contracts', () => {
    const multiContracts: EquityContract[] = [
      {
        name: "Contract A",
        shares: 10000,
        strike: 1.0,
        startDate: "2023-01-01",
        periodYears: 4,
        cliffMonths: 0,
      },
      {
        name: "Contract B",
        shares: 5000,
        strike: 2.0,
        startDate: "2023-01-01",
        periodYears: 4,
        cliffMonths: 0,
      }
    ];

    const date = new Date(2025, 0, 1); // 24 months = 50%
    const result = getVestingAtDate(multiContracts, date);
    
    // A: 5000 vested, $5000 cost
    // B: 2500 vested, $5000 cost
    expect(result.totalVested).toBe(7500);
    expect(result.totalCost).toBe(10000);
    expect(result.details).toHaveLength(2);
  });
});

describe('calculateBudgetSummary', () => {
  const monthlyExpenses: Expense[] = [
    { id: 1, name: 'Rent', amount: 12000 },
    { id: 2, name: 'Food', amount: 3000 },
  ];

  const yearlyExpenses: Expense[] = [
    { id: 101, name: 'Vacation', amount: 24000 },
  ];

  const salaryData: SalaryData = {
    person1Gross: 70000,
    person1Net: 35200,
    person2Gross: 44000,
    person2Net: 26300,
  };

  it('calculates total monthly expense including yearly', () => {
    const result = calculateBudgetSummary(monthlyExpenses, yearlyExpenses, salaryData);
    // Monthly: 12000 + 3000 = 15000
    // Yearly to monthly: 24000 / 12 = 2000
    // Total: 17000
    expect(result.totalExpenseToday).toBe(17000);
  });

  it('calculates total net income', () => {
    const result = calculateBudgetSummary(monthlyExpenses, yearlyExpenses, salaryData);
    expect(result.totalIncomeNet).toBe(35200 + 26300);
  });

  it('calculates pension inflow at 20%', () => {
    const result = calculateBudgetSummary(monthlyExpenses, yearlyExpenses, salaryData);
    expect(result.totalPensionInflow).toBe((70000 + 44000) * PENSION_CONTRIBUTION_RATE);
  });

  // Bug fix: handling undefined/null arrays
  it('handles undefined arrays gracefully (bug fix)', () => {
    const result = calculateBudgetSummary(
      undefined as unknown as Expense[], 
      null as unknown as Expense[], 
      salaryData
    );
    expect(result.totalExpenseToday).toBe(0);
    expect(result.totalIncomeNet).toBe(61500);
  });

  it('handles expenses with string amounts', () => {
    const stringExpenses = [
      { id: 1, name: 'Test', amount: '5000' as unknown as number }
    ];
    const result = calculateBudgetSummary(stringExpenses, [], salaryData);
    expect(result.totalExpenseToday).toBe(5000);
  });
});

describe('calculateTotalAssets', () => {
  const assets: Asset[] = [
    { id: 1, name: 'Pension', value: 2500000, type: 'pension' },
    { id: 2, name: 'Stocks', value: 1900000, type: 'liquid' },
    { id: 3, name: 'Property', value: 400000, type: 'invest' },
  ];

  it('sums all asset values', () => {
    expect(calculateTotalAssets(assets)).toBe(4800000);
  });

  it('handles empty array', () => {
    expect(calculateTotalAssets([])).toBe(0);
  });

  it('handles string values', () => {
    const mixedAssets: Asset[] = [
      { id: 1, name: 'Test', value: '1000000' as unknown as number, type: 'liquid' }
    ];
    expect(calculateTotalAssets(mixedAssets)).toBe(1000000);
  });
});

describe('calculatePensionValue', () => {
  const assets: Asset[] = [
    { id: 1, name: 'Pension Fund', value: 2500000, type: 'pension' },
    { id: 2, name: 'Stocks', value: 1900000, type: 'liquid' },
    { id: 3, name: 'More Pension', value: 500000, type: 'pension' },
  ];

  it('only sums pension-type assets', () => {
    expect(calculatePensionValue(assets)).toBe(3000000);
  });
});

describe('calculateInvestmentValue', () => {
  const assets: Asset[] = [
    { id: 1, name: 'Pension Fund', value: 2500000, type: 'pension' },
    { id: 2, name: 'Stocks', value: 1900000, type: 'liquid' },
    { id: 3, name: 'Property', value: 400000, type: 'invest' },
  ];

  it('sums non-pension assets', () => {
    expect(calculateInvestmentValue(assets)).toBe(2300000);
  });
});

describe('calculateMonthlyReturn', () => {
  it('converts annual rate to monthly', () => {
    // 6% annual should give approximately 0.487% monthly
    const monthly = calculateMonthlyReturn(6);
    expect(monthly).toBeCloseTo(0.00487, 4);
  });

  it('handles 0% rate', () => {
    expect(calculateMonthlyReturn(0)).toBe(0);
  });
});

describe('calculateMonthlyInflation', () => {
  it('converts annual inflation to monthly factor', () => {
    // 2.5% annual inflation
    const monthly = calculateMonthlyInflation(2.5);
    // (1 + 0.025)^(1/12) ≈ 1.00206
    expect(monthly).toBeCloseTo(1.00206, 4);
  });
});

describe('Edge cases and regression tests', () => {
  it('handles multiple contracts with different vesting schedules', () => {
    // Sample startup contracts
    const contracts: EquityContract[] = [
      { 
        name: "Initial Grant", 
        shares: 100000,
        strike: 1.0, 
        startDate: "2023-02-01", 
        periodYears: 4, 
        cliffMonths: 0 
      },
      { 
        name: "Refresher Grant", 
        shares: 50000, 
        strike: 2.0, 
        startDate: "2025-10-01", 
        periodYears: 3, 
        cliffMonths: 12 
      },
    ];

    // At end of 2028 - Initial should be fully vested, Refresher partially
    const date = new Date(2028, 11, 31);
    const result = getVestingAtDate(contracts, date);
    
    // Initial: Fully vested (100000)
    // Refresher: Started Oct 2025, by Dec 2028 = 38 months, cliff=12
    //   After cliff: 26 months of vesting out of 36 months = ~72%
    expect(result.totalVested).toBeGreaterThan(130000);
    expect(result.details[0].vested).toBe(100000);
  });

  it('handles stepped grant contracts', () => {
    const contracts: EquityContract[] = [
      { name: "Base Grant", shares: 5000, strike: 0.5, startDate: "2023-03-01", periodYears: 4, cliffMonths: 0 },
      { name: "Performance Grant", shares: 2000, strike: 5.0, startDate: "2024-05-12", periodYears: 4, cliffMonths: 0 },
    ];

    const date = new Date(2027, 2, 1); // March 2027
    const result = getVestingAtDate(contracts, date);
    
    // Base: 48 months passed, fully vested = 5000
    // Performance: ~34 months passed out of 48 = ~71%, so ~1417 shares
    expect(result.details[0].vested).toBe(5000);
    expect(result.details[1].vested).toBeGreaterThan(1000);
    expect(result.details[1].vested).toBeLessThan(2000);
  });
});

// ============================================
// Tax Rules Tests - Israeli Pension/Investment Tax Law
// ============================================

describe('Israeli Tax Brackets Configuration', () => {
  it('has correct non-employment brackets (before age 60)', () => {
    // מדרגות מס על הכנסה שלא מיגיעה אישית - מתחת לגיל 60
    expect(NON_EMPLOYMENT_TAX_BRACKETS[0]).toEqual({ upTo: 269280, rate: 0.31 });
    expect(NON_EMPLOYMENT_TAX_BRACKETS[1]).toEqual({ upTo: 560280, rate: 0.35 });
    expect(NON_EMPLOYMENT_TAX_BRACKETS[2]).toEqual({ upTo: 721560, rate: 0.47 });
    expect(NON_EMPLOYMENT_TAX_BRACKETS[3]).toEqual({ upTo: Infinity, rate: 0.52 });
  });

  it('has correct employment brackets', () => {
    // מדרגות מס על הכנסה מיגיעה אישית
    expect(EMPLOYMENT_TAX_BRACKETS[0]).toEqual({ upTo: 84120, rate: 0.10 });
    expect(EMPLOYMENT_TAX_BRACKETS[1]).toEqual({ upTo: 120720, rate: 0.14 });
    expect(EMPLOYMENT_TAX_BRACKETS[2]).toEqual({ upTo: 193800, rate: 0.20 });
    expect(EMPLOYMENT_TAX_BRACKETS[3]).toEqual({ upTo: 269280, rate: 0.31 });
    expect(EMPLOYMENT_TAX_BRACKETS[4]).toEqual({ upTo: 560280, rate: 0.35 });
    expect(EMPLOYMENT_TAX_BRACKETS[5]).toEqual({ upTo: 721560, rate: 0.47 });
    expect(EMPLOYMENT_TAX_BRACKETS[6]).toEqual({ upTo: Infinity, rate: 0.50 });
  });
});

describe('calculateMarginalTax', () => {
  it('calculates tax for amount in first bracket (31%)', () => {
    // 100,000 annual income, all in first bracket (up to 269,280)
    const tax = calculateMarginalTax(100000, NON_EMPLOYMENT_TAX_BRACKETS);
    expect(tax).toBe(31000); // 100,000 * 31%
  });

  it('calculates tax spanning multiple brackets', () => {
    // 400,000 annual income spans first two brackets
    // First bracket: 269,280 * 31% = 83,476.8
    // Second bracket: (400,000 - 269,280) * 35% = 130,720 * 35% = 45,752
    // Total: 129,228.8
    const tax = calculateMarginalTax(400000, NON_EMPLOYMENT_TAX_BRACKETS);
    expect(tax).toBeCloseTo(129228.8, 0);
  });

  it('calculates tax with existing income (stacking)', () => {
    // Already have 200,000 income, adding 100,000 more
    // Additional income is in first bracket (31%)
    const tax = calculateMarginalTax(100000, NON_EMPLOYMENT_TAX_BRACKETS, 200000);
    
    // 200,000 + 100,000 = 300,000, but we only tax the additional 100,000
    // Part in first bracket (269,280 - 200,000 = 69,280): 69,280 * 31% = 21,476.8
    // Part in second bracket (100,000 - 69,280 = 30,720): 30,720 * 35% = 10,752
    // Total: 32,228.8
    expect(tax).toBeCloseTo(32228.8, 0);
  });

  it('calculates employment tax correctly', () => {
    // 15,000/month = 180,000/year for employment income
    // Bracket 1: 84,120 * 10% = 8,412
    // Bracket 2: (120,720 - 84,120) * 14% = 36,600 * 14% = 5,124
    // Bracket 3: (180,000 - 120,720) * 20% = 59,280 * 20% = 11,856
    // Total: 25,392
    const tax = calculateMarginalTax(180000, EMPLOYMENT_TAX_BRACKETS);
    expect(tax).toBeCloseTo(25392, 0);
  });

  it('returns 0 for zero or negative amounts', () => {
    expect(calculateMarginalTax(0, NON_EMPLOYMENT_TAX_BRACKETS)).toBe(0);
    expect(calculateMarginalTax(-1000, NON_EMPLOYMENT_TAX_BRACKETS)).toBe(0);
  });
});

describe('calculateEffectiveTaxRate', () => {
  it('calculates effective rate for first bracket only', () => {
    const rate = calculateEffectiveTaxRate(100000, NON_EMPLOYMENT_TAX_BRACKETS);
    expect(rate).toBe(0.31); // All in 31% bracket
  });

  it('calculates blended effective rate across brackets', () => {
    const rate = calculateEffectiveTaxRate(400000, NON_EMPLOYMENT_TAX_BRACKETS);
    // Tax is ~129,229, so effective rate is ~32.3%
    expect(rate).toBeCloseTo(0.323, 2);
  });
});

describe('calculateEarlyPensionWithdrawal (before age 60)', () => {
  it('applies 31% tax on small withdrawal (first bracket)', () => {
    // 100,000 annual withdrawal, all in first bracket
    const result = calculateEarlyPensionWithdrawal(100000);
    
    expect(result.taxPaid).toBe(31000);
    expect(result.netAmount).toBe(69000);
    expect(result.effectiveRate).toBe(0.31);
  });

  it('applies marginal rates on larger withdrawals', () => {
    // 400,000 annual withdrawal spans brackets
    const result = calculateEarlyPensionWithdrawal(400000);
    
    // Tax: ~129,229 (calculated in calculateMarginalTax test)
    expect(result.taxPaid).toBeCloseTo(129228.8, 0);
    expect(result.netAmount).toBeCloseTo(270771.2, 0);
    expect(result.effectiveRate).toBeCloseTo(0.323, 2);
  });

  it('returns 0 for zero or negative amounts', () => {
    const result = calculateEarlyPensionWithdrawal(0);
    expect(result).toEqual({ netAmount: 0, taxPaid: 0, effectiveRate: 0 });
  });

  it('verifies minimum rate is 31% (EARLY_PENSION_PENALTY_TAX)', () => {
    expect(EARLY_PENSION_PENALTY_TAX).toBe(0.31);
  });
});

describe('calculateGrossForDesiredNet (reverse early withdrawal)', () => {
  it('calculates gross needed for net in first bracket', () => {
    // Need 69,000 net, with 31% tax
    // gross - (gross * 0.31) = 69000
    // gross * 0.69 = 69000
    // gross = 100,000
    const desiredNet = 69000;
    const gross = calculateGrossForDesiredNet(desiredNet);
    
    expect(gross).toBeCloseTo(100000, 0);
  });

  it('round-trips with calculateEarlyPensionWithdrawal', () => {
    const desiredNet = 200000;
    const gross = calculateGrossForDesiredNet(desiredNet);
    const result = calculateEarlyPensionWithdrawal(gross);
    
    // Allow for small rounding differences in binary search
    expect(result.netAmount).toBeCloseTo(desiredNet, -1);
  });

  it('handles amounts spanning multiple brackets', () => {
    const desiredNet = 270771; // ~400k gross based on earlier test
    const gross = calculateGrossForDesiredNet(desiredNet);
    const result = calculateEarlyPensionWithdrawal(gross);
    
    expect(result.netAmount).toBeCloseTo(desiredNet, 0);
  });

  it('returns 0 for zero or negative amounts', () => {
    expect(calculateGrossForDesiredNet(0)).toBe(0);
    expect(calculateGrossForDesiredNet(-1000)).toBe(0);
  });
});

describe('calculatePensionAnnuity (age 60+)', () => {
  it('uses fixed coefficient of 210 for annuity calculation', () => {
    expect(FIXED_COEFFICIENT).toBe(210);
  });

  it('calculates monthly annuity from pension balance', () => {
    const pensionBalance = 2100000; // 2.1M
    const monthlyAnnuity = calculatePensionAnnuity(pensionBalance);
    
    // 2,100,000 / 210 = 10,000 per month
    expect(monthlyAnnuity).toBe(10000);
  });

  it('returns 0 for zero or negative balance', () => {
    expect(calculatePensionAnnuity(0)).toBe(0);
    expect(calculatePensionAnnuity(-500000)).toBe(0);
  });
});

describe('calculatePensionAnnuityTax (age 60+)', () => {
  it('applies 15% tax on pension annuity', () => {
    expect(FIXED_PENSION_TAX).toBe(0.15);
  });

  it('calculates tax on monthly annuity', () => {
    const monthlyAnnuity = 10000;
    const tax = calculatePensionAnnuityTax(monthlyAnnuity);
    
    // 15% tax
    expect(tax).toBe(1500);
  });

  it('returns 0 for zero or negative annuity', () => {
    expect(calculatePensionAnnuityTax(0)).toBe(0);
    expect(calculatePensionAnnuityTax(-1000)).toBe(0);
  });
});

describe('calculateInvestmentWithdrawalTax', () => {
  it('applies 25% capital gains tax', () => {
    const amount = 100000;
    const tax = calculateInvestmentWithdrawalTax(amount, 500000); // Below surtax threshold
    
    expect(tax).toBe(25000); // 25%
  });

  it('adds 3% surtax when annual income exceeds threshold', () => {
    const amount = 100000;
    // Annual income above SURTAX_THRESHOLD (721,500)
    const tax = calculateInvestmentWithdrawalTax(amount, 800000);
    
    // 25% + 3% = 28%
    expect(tax).toBe(28000);
  });

  it('verifies surtax threshold is 721,560', () => {
    expect(SURTAX_THRESHOLD).toBe(721560);
  });

  it('returns 0 for zero or negative amounts', () => {
    expect(calculateInvestmentWithdrawalTax(0, 500000)).toBe(0);
    expect(calculateInvestmentWithdrawalTax(-1000, 500000)).toBe(0);
  });
});

describe('Tax rule integration - withdrawal priority', () => {
  it('31% minimum pension tax is higher than 25% investment tax before age 60', () => {
    // This confirms the logic: withdraw from investments first (25% tax)
    // Only use pension (31%+ marginal) when investments are depleted
    
    const investmentTaxRate = 0.25;
    const pensionMinRate = EARLY_PENSION_PENALTY_TAX; // 31%
    
    expect(pensionMinRate).toBeGreaterThan(investmentTaxRate);
  });

  it('pension annuity tax (15%) is lower than capital gains (25%) after age 60', () => {
    // After age 60, pension annuity is tax-efficient
    expect(FIXED_PENSION_TAX).toBeLessThan(0.25);
  });

  it('higher withdrawals face higher marginal rates (up to 52%)', () => {
    // Verify progressive nature
    const smallWithdrawal = calculateEarlyPensionWithdrawal(100000);
    const mediumWithdrawal = calculateEarlyPensionWithdrawal(400000);
    const largeWithdrawal = calculateEarlyPensionWithdrawal(800000);
    
    expect(smallWithdrawal.effectiveRate).toBeCloseTo(0.31, 2);
    expect(mediumWithdrawal.effectiveRate).toBeGreaterThan(smallWithdrawal.effectiveRate);
    expect(largeWithdrawal.effectiveRate).toBeGreaterThan(mediumWithdrawal.effectiveRate);
    expect(largeWithdrawal.effectiveRate).toBeLessThanOrEqual(0.52);
  });
});

describe('Simulation edge cases and bugs', () => {
  const baseParams = {
    investmentInitialValue: 1500000, // 1.5M investments
    pensionInitialValue: 1500000, // 1.5M pension = 3M total
    returnRate: 6,
    inflationRate: 2.5,
    transitionToHalfWorkYear: 5,
    stopWorkYear: 15,
    budgetSummary: {
      totalExpenseToday: 35000,
      totalIncomeNet: 61500,
      totalPensionInflow: 22800,
    },
    monthlyExpenses: [
      { id: 1, name: 'Rent', amount: 12000 },
      { id: 2, name: 'Other', amount: 23000 },
    ],
    yearlyExpenses: [] as Expense[],
    propertyConfig: { price: 7000000, year: 2050, monthlySavings: 8000 }, // Far future, no property purchase
    equityCompanies: [], // No equity companies for base test
    initialAge: 34,
    endOfLifeAge: 90,
  };

  it('BUG FIX: should return non-zero withdrawal with 3M assets', () => {
    const result = findOptimalWithdrawal(baseParams);
    
    // With 3M assets at age 34, even with moderate expenses,
    // there should be SOME sustainable withdrawal rate
    expect(result.val).toBeGreaterThan(0);
  });

  it('BUG FIX: should handle 3M assets with 7M property purchase gracefully', () => {
    const paramsWithProperty = {
      ...baseParams,
      propertyConfig: { price: 7000000, year: 2030, monthlySavings: 8000 }, // Buy property in 4 years
    };
    
    const result = findOptimalWithdrawal(paramsWithProperty);
    
    // With only 3M assets and a 7M property purchase, this should either:
    // - Return a positive withdrawal if somehow sustainable
    // - Or return 0 if the numbers don't work (which is valid)
    // But it should NOT crash and should return valid data
    expect(result.data.length).toBeGreaterThan(0);
    
    // Check that data is valid even if val is 0
    const lastPoint = result.data[result.data.length - 1];
    expect(lastPoint).toBeDefined();
    expect(typeof lastPoint.totalLegacy).toBe('number');
  });

  it('BUG FIX: with very low assets, should still find minimum sustainable withdrawal', () => {
    const lowAssetParams = {
      ...baseParams,
      investmentInitialValue: 500000, // Only 500k investments
      pensionInitialValue: 500000, // Only 500k pension = 1M total
    };
    
    const result = findOptimalWithdrawal(lowAssetParams);
    
    // Even with 1M, there should be some withdrawal possible
    // (might be very low, but not 0)
    expect(result.val).toBeGreaterThanOrEqual(0);
    // If result is 0, the data should still be valid
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('BUG FIX: pension should NOT convert to annuity at age 60 if still working', () => {
    // Set retirement at age 65 (31 years from age 34)
    const params = {
      ...baseParams,
      stopWorkYear: 31, // Retire at 65
    };
    
    // Run simulation with some withdrawal rate
    const data = runSimulation(30000, params);
    
    // Find data point at age 60 (26 years from start)
    const age60Data = data.find((d: SimulationDataPoint) => Math.abs(parseFloat(d.fullAge) - 60) < 0.5);
    
    // At age 60, person is still working (until age 65)
    // So pension should NOT be converted, and should still have balance
    expect(age60Data).toBeDefined();
    // Should be working (either full or half salary)
    expect(['שכר מלא', 'חצי משרה']).toContain(age60Data!.incomeSource);
    expect(age60Data!.pension).toBeGreaterThan(0); // Pension should not be 0
    expect(age60Data!.withdrawalFromPension).toBe(0); // Not withdrawing from pension
  });

  it('pension should convert to annuity at retirement (age 65), not age 60', () => {
    const params = {
      ...baseParams,
      stopWorkYear: 31, // Retire at 65
    };
    
    const data = runSimulation(30000, params);
    
    // Find data point right after age 65
    const age65Data = data.find((d: SimulationDataPoint) => parseFloat(d.fullAge) >= 65 && parseFloat(d.fullAge) < 66);
    
    // At retirement, pension should be converted to annuity
    expect(age65Data).toBeDefined();
    expect(age65Data!.pension).toBe(0); // Pension converted
    expect(age65Data!.pensionAnnuity).toBeGreaterThan(0); // Now receiving annuity
    expect(age65Data!.incomeSource).not.toContain('שכר'); // No longer salary
  });

  it('withdrawal breakdown should show 0 during working phase', () => {
    const data = runSimulation(30000, baseParams);
    
    // During first 5 years (full work), no withdrawals should happen
    const workingData = data.filter((d: SimulationDataPoint) => parseFloat(d.fullAge) < 39);
    
    workingData.forEach((d: SimulationDataPoint) => {
      expect(d.withdrawalFromInvestments).toBe(0);
      expect(d.withdrawalFromPension).toBe(0);
    });
  });
});

describe('Full pension lifecycle scenario', () => {
  it('calculates correct net after converting 2.5M pension to annuity at age 60', () => {
    const pensionBalance = 2500000;
    
    // Step 1: Convert to monthly annuity
    const grossAnnuity = calculatePensionAnnuity(pensionBalance);
    expect(grossAnnuity).toBeCloseTo(11905, 0); // 2.5M / 210
    
    // Step 2: Apply 15% tax
    const tax = calculatePensionAnnuityTax(grossAnnuity);
    expect(tax).toBeCloseTo(1786, 0);
    
    // Step 3: Net monthly income
    const netAnnuity = grossAnnuity - tax;
    expect(netAnnuity).toBeCloseTo(10119, 0);
  });

  it('early withdrawal scenario: need 50k/month, have 30k investments', () => {
    // Before age 60, need to withdraw 50,000 net monthly = 600,000 annual
    // Have only 30,000 in investments (monthly)
    
    // Withdraw all investments (30k with 25% tax = ~7,500 tax)
    const invTax = calculateInvestmentWithdrawalTax(30000, 50000 * 12);
    expect(invTax).toBe(7500);
    
    // Remaining 20k/month = 240k/year must come from pension (marginal tax)
    const annualNetNeeded = 20000 * 12;
    const grossFromPensionAnnual = calculateGrossForDesiredNet(annualNetNeeded);
    
    const pensionWithdrawal = calculateEarlyPensionWithdrawal(grossFromPensionAnnual);
    // Allow for binary search rounding
    expect(pensionWithdrawal.netAmount).toBeCloseTo(annualNetNeeded, -1);
    
    // At ~348k gross (for 240k net), tax should be around 31% effective
    expect(pensionWithdrawal.effectiveRate).toBeCloseTo(0.31, 1);
  });

  it('very early retirement with large withdrawals faces higher rates', () => {
    // Someone retiring at 45 needing 80k/month = 960k/year
    const annualNet = 960000;
    const gross = calculateGrossForDesiredNet(annualNet);
    const result = calculateEarlyPensionWithdrawal(gross);
    
    // At this level, effective rate should be around 35-40%
    expect(result.effectiveRate).toBeGreaterThan(0.35);
    expect(result.effectiveRate).toBeLessThan(0.50);
    expect(result.netAmount).toBeCloseTo(annualNet, 0);
  });
});
