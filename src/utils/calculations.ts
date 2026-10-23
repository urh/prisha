import type { 
  EquityContract, 
  VestingResult, 
  VestingDetail, 
  BudgetSummary, 
  Expense, 
  SalaryData,
  Asset 
} from '../types';

// Constants
export const SURTAX_THRESHOLD = 721560;
export const PENSION_CONTRIBUTION_RATE = 0.20;
export const STUDY_FUND_RATE = 0.10;       // keren hishtalmut ~10% of capped salary
export const STUDY_FUND_CEILING = 15712;   // monthly salary ceiling for study-fund contributions
export const PROPERTY_APPRECIATION_RATE = 0.02;
export const FIXED_COEFFICIENT = 210;
export const FIXED_PENSION_TAX = 0.15;

/**
 * Israeli Income Tax Brackets (2025-2027)
 * For income from employment (יגיעה אישית)
 */
export const EMPLOYMENT_TAX_BRACKETS = [
  { upTo: 84120, rate: 0.10 },
  { upTo: 120720, rate: 0.14 },
  { upTo: 193800, rate: 0.20 },
  { upTo: 269280, rate: 0.31 },
  { upTo: 560280, rate: 0.35 },
  { upTo: 721560, rate: 0.47 },
  { upTo: Infinity, rate: 0.50 }, // 47% + 3% surtax
];

/**
 * Israeli Income Tax Brackets for NON-employment income (before age 60)
 * This applies to early pension withdrawal
 * הכנסה שלא מיגיעה אישית - מתחת לגיל 60
 */
export const NON_EMPLOYMENT_TAX_BRACKETS = [
  { upTo: 269280, rate: 0.31 },
  { upTo: 560280, rate: 0.35 },
  { upTo: 721560, rate: 0.47 },
  { upTo: Infinity, rate: 0.52 }, // 47% + 3% surtax + 2% extra
];

// Legacy constant for backwards compatibility (minimum rate for non-employment)
export const EARLY_PENSION_PENALTY_TAX = 0.31;

/**
 * Israeli Capital Gains Tax Brackets (מס רווחי הון)
 * 
 * Base: 25% on capital gains
 * Surtax (יסף): 3% on annual income above 721,560 NIS
 * Additional surtax: 2% on annual income above ~5M NIS (effectively 30% total)
 * 
 * These are marginal rates applied in brackets.
 */
export const CAPITAL_GAINS_TAX_BRACKETS = [
  { upTo: SURTAX_THRESHOLD, rate: 0.25 },           // 25% up to ~721k
  { upTo: 5000000, rate: 0.28 },                     // 28% (25% + 3% יסף) from ~721k to 5M
  { upTo: Infinity, rate: 0.30 },                    // 30% (25% + 3% + 2%) above 5M
];

/**
 * Calculate net equity after Israeli capital gains taxes
 * Uses marginal tax brackets: 25% base + 3% surtax (יסף) above 721k + 2% above 5M
 * 
 * @param brutoIls - Gross profit in ILS (after subtracting cost basis)
 * @returns Net amount after taxes
 */
export function calculateNetEquity(brutoIls: number): number {
  // Guard against NaN/undefined
  if (brutoIls === undefined || brutoIls === null || isNaN(brutoIls) || brutoIls <= 0) {
    return 0;
  }
  
  const tax = calculateMarginalTax(brutoIls, CAPITAL_GAINS_TAX_BRACKETS);
  return Math.round(brutoIls - tax);
}

/**
 * Calculate the effective tax rate for a given capital gains amount
 * Useful for displaying to users
 */
export function calculateCapitalGainsEffectiveRate(amount: number): number {
  if (amount <= 0) return 0;
  const tax = calculateMarginalTax(amount, CAPITAL_GAINS_TAX_BRACKETS);
  return tax / amount;
}

/**
 * Calculate vesting at a specific date for equity contracts
 *
 * Supports two cliff semantics:
 *  - "standard": classic cliff (e.g. 25% lump at 12-month cliff on a 4-year
 *    grant, then linear vesting along the same slope).
 *  - "delayed-linear": nothing catches up at the cliff — after the cliff,
 *    the remaining shares vest linearly over (periodYears*12 - cliffMonths).
 */
export function getVestingAtDate(contracts: EquityContract[], targetDate: Date): VestingResult {
  let totalVested = 0;
  let totalCost = 0;
  const details: VestingDetail[] = [];
  
  contracts.forEach(contract => {
    const start = new Date(contract.startDate);
    const monthsDiff = (targetDate.getFullYear() - start.getFullYear()) * 12 + 
                       (targetDate.getMonth() - start.getMonth());
    const totalMonths = contract.periodYears * 12;
    const cliffMonths = contract.cliffMonths || 0;
    
    let vested = 0;
    
    if (monthsDiff >= cliffMonths) {
      if (contract.cliffType === 'delayed-linear') {
        const remainingMonths = Math.max(1, totalMonths - cliffMonths);
        const postCliffMonths = Math.min(remainingMonths, monthsDiff - cliffMonths);
        vested = Math.min(
          contract.shares,
          Math.max(0, (postCliffMonths / remainingMonths) * contract.shares)
        );
      } else {
        vested = Math.min(
          contract.shares,
          Math.max(0, (monthsDiff / totalMonths) * contract.shares)
        );
      }
    }
    
    totalVested += vested;
    totalCost += vested * contract.strike;
    
    details.push({ 
      name: contract.name, 
      vested: Math.round(vested), 
      cost: Math.round(vested * contract.strike) 
    });
  });
  
  return { totalVested, totalCost, details };
}

/**
 * Effective monthly amount for a yearly expense, amortized and
 * respecting one-time/every-N-years flags.
 *
 * - oneTime expenses contribute 0 (they are tracked historically in the
 *   "today" balance by default, so we count the full impact in the current year
 *   (amount / 12). Pass includeOneTime=false when building forward-looking
 *   recurring totals for the simulation.
 * - Recurring expenses with everyNYears > 1 contribute amount / N / 12.
 */
export function yearlyExpenseMonthlyAmount(e: Expense, includeOneTime: boolean = true): number {
  const raw = parseFloat(String(e.amount)) || 0;
  if (e.oneTime) return includeOneTime ? raw / 12 : 0;
  const n = Math.max(1, Number(e.everyNYears) || 1);
  return raw / n / 12;
}

/**
 * Calculate budget summary from expenses and salary
 */
export function calculateBudgetSummary(
  monthlyExpenses: Expense[], 
  yearlyExpenses: Expense[], 
  salaryData: SalaryData
): BudgetSummary {
  // Guard against undefined arrays - bug that was encountered
  const safeMonthly = monthlyExpenses || [];
  const safeYearly = yearlyExpenses || [];
  
  const totalMonthlyFixed = safeMonthly.reduce(
    (sum, e) => sum + (parseFloat(String(e.amount)) || 0), 
    0
  );
  
  const totalYearlyToMonthly = safeYearly.reduce(
    (sum, e) => sum + yearlyExpenseMonthlyAmount(e), 
    0
  );

  const salaryNet = (parseFloat(String(salaryData.person1Net)) || 0) +
                    (parseFloat(String(salaryData.person2Net)) || 0);
  const stateIncome = parseFloat(String(salaryData.monthlyStateIncome ?? 0)) || 0;
  const annualBonus = parseFloat(String(salaryData.annualBonus ?? 0)) || 0;
  
  return { 
    totalExpenseToday: Math.round(totalMonthlyFixed + totalYearlyToMonthly),
    totalIncomeNet: salaryNet + stateIncome + annualBonus / 12,
    totalPensionInflow: ((parseFloat(String(salaryData.person1Gross)) || 0) + 
                         (parseFloat(String(salaryData.person2Gross)) || 0)) * PENSION_CONTRIBUTION_RATE,
    totalStudyFundInflow:
      Math.min(parseFloat(String(salaryData.person1Gross)) || 0, STUDY_FUND_CEILING) * STUDY_FUND_RATE +
      Math.min(parseFloat(String(salaryData.person2Gross)) || 0, STUDY_FUND_CEILING) * STUDY_FUND_RATE
  };
}

/**
 * Calculate total assets value
 */
export function calculateTotalAssets(assets: Asset[]): number {
  return Math.round(
    assets.reduce((sum, a) => sum + (parseFloat(String(a.value)) || 0), 0)
  );
}

/**
 * Calculate pension initial value (assets marked as pension type)
 */
export function calculatePensionValue(assets: Asset[]): number {
  return assets
    .filter(a => a.type === "pension")
    .reduce((sum, a) => sum + (parseFloat(String(a.value)) || 0), 0);
}


/**
 * Capital-gains tax assumed on the unrealized profit of the liquid
 * securities portfolios: 25% Israeli CGT + 3% high-earner surtax = 28%.
 */
export const LIQUID_GAIN_TAX_RATE = 0.28;

/** Total value of liquid-type assets (cash + securities portfolios). */
export function calculateLiquidValue(assets: Asset[]): number {
  return assets
    .filter(a => a.type === "liquid")
    .reduce((sum, a) => sum + (parseFloat(String(a.value)) || 0), 0);
}

/**
 * Unrealized gain across the liquid securities portfolios. Only assets
 * carrying a Meitav-sourced gainIls contribute; keren-hishtalmut / cash
 * (no gainIls) count as zero gain.
 */
export function calculateLiquidGain(assets: Asset[]): number {
  return assets
    .filter(a => a.type === "liquid")
    .reduce((sum, a) => sum + (parseFloat(String(a.gainIls)) || 0), 0);
}

/**
 * Liquid wealth after capital-gains tax: liquid value minus the tax on the
 * embedded unrealized gain - the realistic spendable liquid today.
 */
export function calculateLiquidAfterTax(
  assets: Asset[],
  rate: number = LIQUID_GAIN_TAX_RATE,
): number {
  return Math.round(calculateLiquidValue(assets) - rate * calculateLiquidGain(assets));
}

/**
 * Calculate investment initial value (non-pension assets)
 */
export function calculateInvestmentValue(assets: Asset[]): number {
  return assets
    .filter(a => a.type !== "pension")
    .reduce((sum, a) => sum + (parseFloat(String(a.value)) || 0), 0);
}

/**
 * Calculate monthly return rate from annual rate
 */
export function calculateMonthlyReturn(annualRate: number): number {
  return Math.pow(1 + annualRate / 100, 1/12) - 1;
}

/**
 * Calculate monthly inflation factor from annual rate
 */
export function calculateMonthlyInflation(annualRate: number): number {
  return Math.pow(1 + annualRate / 100, 1/12);
}


/**
 * Calculate marginal tax using Israeli tax brackets
 * 
 * @param amount - Annual income to tax
 * @param brackets - Tax brackets to use
 * @param existingIncome - Existing annual income (for stacking)
 * @returns Total tax amount
 */
export function calculateMarginalTax(
  amount: number, 
  brackets: Array<{ upTo: number; rate: number }>,
  existingIncome: number = 0
): number {
  if (amount <= 0) return 0;
  
  let remainingAmount = amount;
  let totalTax = 0;
  let currentThreshold = existingIncome;
  
  for (const bracket of brackets) {
    if (currentThreshold >= bracket.upTo) continue;
    
    const taxableInBracket = Math.min(
      remainingAmount, 
      bracket.upTo - currentThreshold
    );
    
    if (taxableInBracket <= 0) continue;
    
    totalTax += taxableInBracket * bracket.rate;
    remainingAmount -= taxableInBracket;
    currentThreshold += taxableInBracket;
    
    if (remainingAmount <= 0) break;
  }
  
  return totalTax;
}

/**
 * Calculate effective tax rate for a given amount
 */
export function calculateEffectiveTaxRate(
  amount: number,
  brackets: Array<{ upTo: number; rate: number }>,
  existingIncome: number = 0
): number {
  if (amount <= 0) return 0;
  const tax = calculateMarginalTax(amount, brackets, existingIncome);
  return tax / amount;
}

/**
 * Calculate early withdrawal tax (before age 60)
 * Uses Israeli non-employment income tax brackets (starts at 31%)
 * 
 * @param grossAmount - Amount to withdraw (gross, annual)
 * @param existingAnnualIncome - Other annual income for bracket calculation
 * @returns Object with net amount and tax paid
 */
export function calculateEarlyPensionWithdrawal(
  grossAmount: number, 
  existingAnnualIncome: number = 0
): { netAmount: number; taxPaid: number; effectiveRate: number } {
  if (grossAmount <= 0) return { netAmount: 0, taxPaid: 0, effectiveRate: 0 };
  
  const taxPaid = calculateMarginalTax(grossAmount, NON_EMPLOYMENT_TAX_BRACKETS, existingAnnualIncome);
  const netAmount = grossAmount - taxPaid;
  const effectiveRate = taxPaid / grossAmount;
  
  return { netAmount, taxPaid, effectiveRate };
}

/**
 * Calculate how much gross to withdraw to get desired net (before age 60)
 * Uses binary search since marginal rates make this non-linear
 * 
 * @param desiredNet - Net amount needed (annual)
 * @param existingAnnualIncome - Other annual income
 * @returns Gross amount needed to withdraw
 */
export function calculateGrossForDesiredNet(
  desiredNet: number, 
  existingAnnualIncome: number = 0
): number {
  if (desiredNet <= 0) return 0;
  
  // Binary search for the correct gross amount
  let low = desiredNet;
  let high = desiredNet * 3; // At most 52% tax means gross is at most ~2x net
  
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const result = calculateEarlyPensionWithdrawal(mid, existingAnnualIncome);
    
    if (Math.abs(result.netAmount - desiredNet) < 1) {
      return mid;
    }
    
    if (result.netAmount < desiredNet) {
      low = mid;
    } else {
      high = mid;
    }
  }
  
  return (low + high) / 2;
}

/**
 * Calculate pension annuity at age 60 (קצבה)
 * Uses fixed coefficient method common in Israel
 * 
 * @param pensionBalance - Total pension balance
 * @returns Monthly annuity (gross before tax)
 */
export function calculatePensionAnnuity(pensionBalance: number): number {
  if (pensionBalance <= 0) return 0;
  return pensionBalance / FIXED_COEFFICIENT;
}

/**
 * Israeli pension-annuity taxation (קצבה מזכה), 2025 figures.
 *
 * A flat 15% was a placeholder. The real treatment: a slice of the monthly
 * annuity is exempt — `PENSION_EXEMPTION_RATE` of the eligible-pension ceiling,
 * per recipient — and whatever is left is ordinary income taxed at the
 * employment brackets, less personal credits. Both the ceiling and the credit
 * are indexed to the CPI, so working in today's shekels keeps them valid.
 *
 * Two recipients matter a lot here: the exemption, the credits and the whole
 * bracket ladder all apply per person, so a couple splitting one pot pays far
 * less than one person drawing it alone.
 */
export const PENSION_ELIGIBLE_CEILING_MONTHLY = 9430;
export const PENSION_EXEMPTION_RATE = 0.67;
/** ~2.25 credit points, the rounded couple-average, per recipient per month. */
export const PENSION_TAX_CREDIT_MONTHLY = 545;

export interface PensionTaxOptions {
  recipients?: number;
  ceilingMonthly?: number;
  exemptionRate?: number;
  creditMonthly?: number;
}

/**
 * Monthly tax on a gross annuity, in the same (real) units as the input.
 */
export function calculatePensionAnnuityTaxIsraeli(
  monthlyGross: number,
  opts: PensionTaxOptions = {},
): number {
  if (monthlyGross <= 0) return 0;
  const recipients = Math.max(1, opts.recipients ?? 2);
  const ceiling = opts.ceilingMonthly ?? PENSION_ELIGIBLE_CEILING_MONTHLY;
  const exemptionRate = opts.exemptionRate ?? PENSION_EXEMPTION_RATE;
  const credit = opts.creditMonthly ?? PENSION_TAX_CREDIT_MONTHLY;

  const perPerson = monthlyGross / recipients;
  // The exemption is a share of the *ceiling*, not of your pension, so a large
  // annuity does not get a proportionally larger exemption.
  const exempt = exemptionRate * Math.min(perPerson, ceiling);
  const taxablePerPerson = Math.max(0, perPerson - exempt);

  const annualTax = calculateMarginalTax(taxablePerPerson * 12, EMPLOYMENT_TAX_BRACKETS);
  const monthlyAfterCredit = Math.max(0, annualTax / 12 - credit);
  return monthlyAfterCredit * recipients;
}

/** Effective rate on the annuity, for reporting and for discounting. */
export function pensionAnnuityEffectiveRate(
  monthlyGross: number,
  opts: PensionTaxOptions = {},
): number {
  if (monthlyGross <= 0) return 0;
  return calculatePensionAnnuityTaxIsraeli(monthlyGross, opts) / monthlyGross;
}

/**
 * Calculate tax on pension annuity (after age 60)
 * Legacy flat 15% — superseded by calculatePensionAnnuityTaxIsraeli, kept
 * because the historical figures in the dashboard were produced with it.
 */
export function calculatePensionAnnuityTax(monthlyAnnuity: number): number {
  if (monthlyAnnuity <= 0) return 0;
  return monthlyAnnuity * FIXED_PENSION_TAX;
}

