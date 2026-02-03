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
 * Handles cliff periods and linear vesting
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
    
    let vested = 0;
    
    // Check if cliff period has passed
    if (monthsDiff >= (contract.cliffMonths || 0)) {
      // Linear vesting calculation
      vested = Math.min(
        contract.shares, 
        Math.max(0, (monthsDiff / totalMonths) * contract.shares)
      );
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
    (sum, e) => sum + (parseFloat(String(e.amount)) || 0), 
    0
  ) / 12;
  
  return { 
    totalExpenseToday: Math.round(totalMonthlyFixed + totalYearlyToMonthly),
    totalIncomeNet: (parseFloat(String(salaryData.person1Net)) || 0) + 
                    (parseFloat(String(salaryData.person2Net)) || 0),
    totalPensionInflow: ((parseFloat(String(salaryData.person1Gross)) || 0) + 
                         (parseFloat(String(salaryData.person2Gross)) || 0)) * PENSION_CONTRIBUTION_RATE
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
 * Simulation parameters
 */
export interface EquityCompanyConfig {
  id: string;
  name: string;
  contracts: EquityContract[];
  exitYear: number;
  sharePriceAtExit: number;
}

export interface SimulationParams {
  investmentInitialValue: number;
  pensionInitialValue: number;
  returnRate: number;
  inflationRate: number;
  transitionToHalfWorkYear: number;
  stopWorkYear: number;
  budgetSummary: BudgetSummary;
  monthlyExpenses: Expense[];
  yearlyExpenses: Expense[];
  propertyConfig: { price: number; year: number; monthlySavings?: number };
  equityCompanies: EquityCompanyConfig[];
  initialAge: number;
  endOfLifeAge: number;
}

/**
 * Run simulation to find optimal withdrawal rate
 * Uses binary search to find maximum sustainable withdrawal
 */
export function findOptimalWithdrawal(params: SimulationParams): { val: number; data: ReturnType<typeof runSimulation> } {
  let low = 5000;
  let high = 500000;
  let bestVal = 0;
  
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const data = runSimulation(mid, params);
    
    const bankrupt = data.some(p => 
      p.liquidWealth <= 0 && 
      p.index < (params.endOfLifeAge - params.initialAge) * 12 - 12
    );
    const finalSolvent = data[data.length - 1].liquidWealth <= 2000;
    
    if (!bankrupt && !finalSolvent) {
      bestVal = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  
  return { val: Math.round(bestVal), data: runSimulation(bestVal, params) };
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
 * Calculate tax on pension annuity (after age 60)
 * Standard 15% tax on pension income in Israel
 */
export function calculatePensionAnnuityTax(monthlyAnnuity: number): number {
  if (monthlyAnnuity <= 0) return 0;
  return monthlyAnnuity * FIXED_PENSION_TAX;
}

/**
 * Calculate capital gains tax on investment withdrawals
 * 25% capital gains + 3% surtax if above threshold
 */
export function calculateInvestmentWithdrawalTax(amount: number, annualIncome: number): number {
  if (amount <= 0) return 0;
  
  // Base capital gains tax: 25%
  let tax = amount * 0.25;
  
  // Add surtax if total annual income exceeds threshold
  if (annualIncome > SURTAX_THRESHOLD) {
    tax += amount * 0.03;
  }
  
  return tax;
}

/**
 * Run monthly simulation
 */
export function runSimulation(targetWithdrawal: number, params: SimulationParams) {
  const {
    investmentInitialValue,
    pensionInitialValue,
    returnRate,
    inflationRate,
    transitionToHalfWorkYear,
    stopWorkYear,
    budgetSummary,
    monthlyExpenses,
    yearlyExpenses,
    propertyConfig,
    equityCompanies,
    initialAge,
    endOfLifeAge,
  } = params;

  let curInv = investmentInitialValue;
  let curPen = pensionInitialValue;
  let propValue = 0;
  let monthlyAnnuity = 0; // Pension annuity after age 60
  
  const monthlyReturn = calculateMonthlyReturn(returnRate);
  const monthlyInflation = calculateMonthlyInflation(inflationRate);
  const data: any[] = [];

  // Monthly savings after buying property (e.g., rent that we stop paying)
  const monthlySavingsAfterProperty = propertyConfig.monthlySavings || 0;
  
  // Total monthly expenses (all expenses)
  const totalMonthlyExpenses = (monthlyExpenses || [])
    .reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0) + 
    ((yearlyExpenses || []).reduce((sum, e) => sum + (parseFloat(String(e.amount)) || 0), 0) / 12);

  const totalMonths = (endOfLifeAge - initialAge) * 12;
  
  // Track vested shares already cashed out per company (to avoid double counting)
  const exitedCompanies = new Set<string>();
  const previousVestedShares: Record<string, number> = {};
  
  // Initialize previous vested to 0 for all companies
  equityCompanies.forEach(company => {
    previousVestedShares[company.id] = 0;
  });

  for (let m = 0; m <= totalMonths; m++) {
    const date = new Date(2026, m, 1);
    const curYear = date.getFullYear();
    const yearsPassed = m / 12;
    const curAge = initialAge + yearsPassed;
    const eventLabels: string[] = [];
    let income = 0;
    let source = "שכר";
    let taxPaid = 0;
    let withdrawalFromInvestments = 0;
    let withdrawalFromPension = 0;
    let currentPensionAnnuity = 0;

    // Handle equity - dynamic for all companies
    for (const company of equityCompanies) {
      if (company.contracts.length === 0 || company.sharePriceAtExit <= 0) continue;
      
      const vest = getVestingAtDate(company.contracts, date);
      const currentVested = vest.totalVested;
      
      // At exit year (January): cash out all vested shares
      if (curYear === company.exitYear && date.getMonth() === 0 && !exitedCompanies.has(company.id)) {
        const grossValue = (currentVested * company.sharePriceAtExit * 3.5) - (vest.totalCost * 3.5);
        curInv += calculateNetEquity(grossValue);
        exitedCompanies.add(company.id);
        previousVestedShares[company.id] = currentVested;
        eventLabels.push(`${company.name} Exit`);
      }
      // After exit: cash out newly vested shares each month
      else if (exitedCompanies.has(company.id)) {
        const newlyVested = currentVested - previousVestedShares[company.id];
        if (newlyVested > 0) {
          // Calculate cost basis for newly vested shares
          const totalShares = company.contracts.reduce((sum, c) => sum + c.shares, 0);
          const avgStrike = totalShares > 0 ? vest.totalCost / currentVested : 0;
          const grossValue = (newlyVested * company.sharePriceAtExit * 3.5) - (newlyVested * avgStrike * 3.5);
          curInv += calculateNetEquity(grossValue);
          previousVestedShares[company.id] = currentVested;
        }
      }
    }

    // Handle property
    const ownsProp = curYear >= propertyConfig.year;
    if (ownsProp) {
      if (curYear === propertyConfig.year && date.getMonth() === 0) {
        curInv -= propertyConfig.price;
        propValue = propertyConfig.price;
        eventLabels.push(`רכישת דירה`);
      } else {
        propValue *= Math.pow(1 + PROPERTY_APPRECIATION_RATE, 1/12);
      }
    }

    // Calculate monthly expenses (adjusted for inflation)
    // After buying property, we save the monthlySavings amount (e.g., rent)
    const expenseBeforeSavings = totalMonthlyExpenses;
    const monthlyExpenseBase = (ownsProp ? expenseBeforeSavings - monthlySavingsAfterProperty : expenseBeforeSavings) * Math.pow(monthlyInflation, m);
    let monthlyOut = monthlyExpenseBase;
    let monthlySavings = 0;

    if (yearsPassed < stopWorkYear) {
      // Working phase
      income = (yearsPassed < transitionToHalfWorkYear) ? budgetSummary.totalIncomeNet : monthlyExpenseBase;
      source = (yearsPassed < transitionToHalfWorkYear) ? "שכר מלא" : "חצי משרה";
      curPen = (curPen * (1 + monthlyReturn)) + 
               (yearsPassed < transitionToHalfWorkYear ? 
                 budgetSummary.totalPensionInflow/12 : 
                 budgetSummary.totalPensionInflow/24);
      curInv = (curInv * (1 + monthlyReturn)) + income - monthlyOut;
      monthlySavings = income - monthlyOut;
    } else {
      // Retirement phase - target withdrawal is constant (adjusted for inflation)
      const desiredWithdrawal = targetWithdrawal * Math.pow(monthlyInflation, m);
      monthlyOut = desiredWithdrawal;
      
      if (curAge < 60) {
        // Before age 60: Early withdrawal with marginal tax brackets
        // Non-employment income: 31% up to 269K, 35% up to 560K, 47% up to 721K, 52% above
        // First try to withdraw from investments (25% capital gains tax)
        // If not enough, withdraw from pension (marginal income tax)
        
        // Apply growth first
        curInv *= (1 + monthlyReturn);
        curPen *= (1 + monthlyReturn);
        
        // Annualize for tax bracket calculation
        const annualWithdrawal = desiredWithdrawal * 12;
        
        if (curInv >= desiredWithdrawal) {
          // Can cover entirely from investments
          withdrawalFromInvestments = desiredWithdrawal;
          const invTax = calculateInvestmentWithdrawalTax(desiredWithdrawal, annualWithdrawal);
          taxPaid = invTax;
          // Withdraw gross amount (tax is embedded)
          curInv -= desiredWithdrawal;
          source = "משיכה מהשקעות";
        } else {
          // Need to withdraw from pension too
          withdrawalFromInvestments = Math.max(0, curInv);
          const invTax = calculateInvestmentWithdrawalTax(withdrawalFromInvestments, annualWithdrawal);
          curInv = 0;
          
          // Remaining needed from pension (with marginal tax brackets)
          const remainingNeeded = desiredWithdrawal - withdrawalFromInvestments;
          // Calculate annual gross needed and convert to monthly
          const annualGrossFromPension = calculateGrossForDesiredNet(remainingNeeded * 12, 0);
          const monthlyGrossFromPension = annualGrossFromPension / 12;
          withdrawalFromPension = monthlyGrossFromPension;
          
          const pensionTaxResult = calculateEarlyPensionWithdrawal(monthlyGrossFromPension * 12, 0);
          const pensionTaxMonthly = pensionTaxResult.taxPaid / 12;
          
          curPen -= monthlyGrossFromPension;
          taxPaid = invTax + pensionTaxMonthly;
          
          // Show effective rate in source description
          const effectiveRate = Math.round(pensionTaxResult.effectiveRate * 100);
          source = `משיכה מהון + פנסיה (מס ${effectiveRate}%)`;
        }
        
        income = 0;
      } else {
        // Age 60+: Convert pension to annuity on first month
        if (curPen > 0 && monthlyAnnuity === 0) {
          // Convert pension balance to monthly annuity
          const grossAnnuity = calculatePensionAnnuity(curPen);
          const annuityTax = calculatePensionAnnuityTax(grossAnnuity);
          monthlyAnnuity = grossAnnuity - annuityTax;
          curPen = 0;
          eventLabels.push("המרה לקצבת פנסיה");
        }
        
        // Annuity grows with inflation each month
        if (m > 0) {
          monthlyAnnuity *= monthlyInflation;
        }
        currentPensionAnnuity = monthlyAnnuity;
        
        // Apply investment growth
        curInv *= (1 + monthlyReturn);
        
        // Calculate how much more we need beyond the annuity
        if (desiredWithdrawal <= monthlyAnnuity) {
          // Annuity covers everything
          income = monthlyAnnuity;
          withdrawalFromPension = monthlyAnnuity;
          withdrawalFromInvestments = 0;
          taxPaid = monthlyAnnuity * (FIXED_PENSION_TAX / (1 - FIXED_PENSION_TAX)); // Already deducted
          source = "קצבת פנסיה";
          // Excess annuity goes back to investments
          curInv += (monthlyAnnuity - desiredWithdrawal);
        } else {
          // Need to supplement from investments
          const gapNeeded = desiredWithdrawal - monthlyAnnuity;
          withdrawalFromPension = monthlyAnnuity;
          withdrawalFromInvestments = gapNeeded;
          
          // Tax on annuity (already deducted) + capital gains on investment withdrawal
          const annuityGross = monthlyAnnuity / (1 - FIXED_PENSION_TAX);
          const annuityTaxPaid = annuityGross * FIXED_PENSION_TAX;
          const invTax = calculateInvestmentWithdrawalTax(gapNeeded, (monthlyAnnuity + gapNeeded) * 12);
          taxPaid = annuityTaxPaid + invTax;
          
          curInv -= gapNeeded;
          income = monthlyAnnuity;
          source = "קצבה + השקעות";
        }
      }
      
      monthlySavings = income - monthlyOut;
    }

    const liquidWealth = Math.max(0, curInv + curPen);

    if (m % 3 === 0 || m < 36) {
      data.push({ 
        index: m, 
        label: `${date.getMonth()+1}/${date.getFullYear()}`, 
        fullAge: curAge.toFixed(1), 
        totalLegacy: Math.round(liquidWealth + propValue), 
        liquidWealth: Math.round(liquidWealth), 
        investments: Math.round(Math.max(0, curInv)), 
        pension: Math.round(Math.max(0, curPen)), 
        property: Math.round(propValue), 
        monthlyOutflow: Math.round(monthlyOut), 
        monthlySavings: Math.round(monthlySavings),
        currentIncome: Math.round(income), 
        incomeSource: source, 
        earlyTaxPenalty: Math.round(taxPaid),
        event: eventLabels.length > 0 ? eventLabels.join(" + ") : null,
        // New fields for withdrawal breakdown
        withdrawalFromInvestments: Math.round(withdrawalFromInvestments),
        withdrawalFromPension: Math.round(withdrawalFromPension),
        pensionAnnuity: Math.round(currentPensionAnnuity),
        taxPaid: Math.round(taxPaid)
      });
    }
  }
  
  return data;
}
