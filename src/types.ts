// Asset types
export interface Asset {
  id: number;
  name: string;
  value: number;
  type: 'pension' | 'liquid' | 'invest';
}

// Expense types
export interface Expense {
  id: number;
  name: string;
  amount: number;
}

// Salary data
export interface SalaryData {
  person1Gross: number;
  person1Net: number;
  person2Gross: number;
  person2Net: number;
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
