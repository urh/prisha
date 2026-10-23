// Asset types
export interface Asset {
  id: number;
  name: string;
  value: number;
  type: 'pension' | 'liquid' | 'invest';
  /** Unrealized profit (market value - cost basis), Meitav-sourced.
   *  Only the taxable securities portfolios carry this. */
  gainIls?: number;
}

// Expense types
export interface Expense {
  id: number;
  name: string;
  amount: number;
  // Yearly-expense-only fields (ignored on monthly expenses):
  // Number of years between occurrences. Default 1 (annual).
  // e.g., 5 means "every 5 years" (averaged as amount/5 per year in simulation).
  everyNYears?: number;
  // If true, expense is excluded from the long-running simulation
  // (useful for this-year-only items already absorbed by current balances).
  oneTime?: boolean;
  // Already fully spent in this year (its actuals are in the dashboard): left
  // out of that year's rest-of-year budget, still counted in later years.
  skipYear?: number;
  // A planned one-off paid in this month ('YYYY-MM'): counted in that year's
  // rest-of-year until the month arrives (then the actuals have it).
  plannedYm?: string;
  // Monthly lines: what the rest of the current year will actually cost when
  // that differs from the average `amount` (only the fixed part: Ozempic, not
  // the one-off checkups; subscriptions still active). `amount` stays the
  // normal-month budget for the long-term plan.
  restOfYear?: number;
}

// Salary data
export interface SalaryData {
  person1Gross: number;
  person1Net: number;
  person2Gross: number;
  person2Net: number;
  // Extra monthly net income from the state (e.g., קצבת ילדים).
  monthlyStateIncome?: number;
  // Annual bonus (net), amortized to monthly in budget/simulation.
  annualBonus?: number;
}

// Stock configuration
// Equity exit configuration
export interface EquityExitConfig {
  exitYear: number;
  sharePriceAtExit: number;
}

// Property configuration
export interface PropertyConfig {
  price: number;
  year: number;
  monthlySavings: number; // Monthly expense reduction after buying (e.g., rent)
}

// Equity contract
export interface EquityContract {
  name: string;
  shares: number;
  strike: number;
  startDate: string;
  periodYears: number;
  cliffMonths: number;
  /**
   * Vesting behavior at the cliff.
   *
   * - "standard" (default): classic cliff — nothing vests before `cliffMonths`,
   *   then at the cliff you receive `cliffMonths / totalMonths` of the grant
   *   as a lump (e.g. 25% for a 12-month cliff on a 4-year grant), and then
   *   monthly/quarterly vesting continues along the same linear slope.
   * - "delayed-linear": nothing vests before the cliff and nothing is
   *   "caught up" at the cliff. Vesting starts linearly over the remaining
   *   (`periodYears * 12 - cliffMonths`) months. This is how some refresh
   *   grants are structured (e.g. 1-year cliff then straight-line for 3 years).
   */
  cliffType?: 'standard' | 'delayed-linear';
}

// Vesting result
export interface VestingDetail {
  name: string;
  vested: number;
  cost: number;
}

export interface VestingResult {
  totalVested: number;
  totalCost: number;
  details: VestingDetail[];
}

// Simulation data point
export interface SimulationDataPoint {
  index: number;
  label: string;
  fullAge: string;
  totalLegacy: number;
  liquidWealth: number;
  investments: number;
  pension: number;
  property: number;
  monthlyOutflow: number;
  monthlySavings: number;
  currentIncome: number;
  incomeSource: string;
  earlyTaxPenalty: number;
  event: string | null;
  // New fields for withdrawal breakdown
  withdrawalFromInvestments: number;
  withdrawalFromPension: number;
  pensionAnnuity: number; // Monthly pension annuity after age 60
  taxPaid: number; // Total tax paid this month
}

// Budget summary
export interface BudgetSummary {
  totalExpenseToday: number;
  totalIncomeNet: number;
  totalPensionInflow: number;
  totalStudyFundInflow?: number;
}

// Simulation result
export interface SimulationResult {
  val: number;
  data: SimulationDataPoint[];
}

// Equity timeline point (for charts)
export interface EquityTimelinePoint {
  index: number;
  label: string;
}

// Re-export storage types for convenience
export type { 
  EquityCompany, 
  PropertyPlan, 
  AppExportData, 
  ValidationResult 
} from './utils/storage';
