/**
 * Default application state - anonymized sample data
 * This file contains the initial state when no saved data exists
 */

import type { Asset, Expense, SalaryData } from '../types';
import type { EquityCompany, PropertyPlan } from '../utils/storage';

// Randomized startup company names
const startupNames = [
  'NovaTech', 'Quantum Labs', 'SkyBridge', 'DataForge', 'CloudPeak',
  'Nexus AI', 'Pulse Systems', 'Vertex', 'Horizon Tech', 'Atlas Digital'
];

const getRandomStartup = (index: number) => startupNames[index % startupNames.length];

// Default equity companies with randomized names
export const defaultEquityCompanies: EquityCompany[] = [
  {
    id: 'company-1',
    name: getRandomStartup(3), // DataForge
    ownerName: 'Person 1',
    color: 'indigo',
    totalShares: 150000,
    contracts: [
      { name: "Initial Grant", shares: 100000, strike: 1.5, startDate: "2023-06-01", periodYears: 4, cliffMonths: 12 },
      { name: "Refresher 2024", shares: 50000, strike: 3.0, startDate: "2024-06-01", periodYears: 4, cliffMonths: 0 }
    ],
    exitConfig: {
      exitYear: 2028,
      valuationAtExit: 8,
      sharePriceAtExit: 15
    }
  },
  {
    id: 'company-2',
    name: getRandomStartup(5), // Nexus AI
    ownerName: 'Person 2',
    color: 'purple',
    totalShares: 20000,
    contracts: [
      { name: "Base Grant", shares: 10000, strike: 0.5, startDate: "2023-01-01", periodYears: 4, cliffMonths: 12 },
      { name: "Performance Grant", shares: 10000, strike: 5.0, startDate: "2024-01-01", periodYears: 3, cliffMonths: 0 }
    ],
    exitConfig: {
      exitYear: 2029,
      valuationAtExit: 3,
      sharePriceAtExit: 80
    }
  }
];

// Default property plan
export const defaultPropertyPlan: PropertyPlan = {
  enabled: true,
  config: { price: 5000000, year: 2030, monthlySavings: 8000 }
};

// Default assets (anonymized)
export const defaultAssets: Asset[] = [
  { id: 1, name: "פנסיות וקופות גמל", value: 1500000, type: "pension" },
  { id: 2, name: "קרנות השתלמות", value: 350000, type: "liquid" },
  { id: 3, name: "תיק מניות (אדם 1)", value: 800000, type: "liquid" },
  { id: 4, name: "תיק מניות (אדם 2)", value: 400000, type: "liquid" },
  { id: 5, name: "תיק מניות משותף", value: 600000, type: "liquid" },
  { id: 6, name: "נכס להשקעה", value: 300000, type: "invest" },
  { id: 7, name: "עו״ש ומזומן", value: 50000, type: "liquid" }
];

// Default monthly expenses (anonymized, rent = 8000)
export const defaultMonthlyExpenses: Expense[] = [
  { id: 1, name: 'שכר דירה', amount: 8000 },
  { id: 2, name: 'מזון וסופר', amount: 4000 },
  { id: 3, name: 'חשמל ומים', amount: 800 },
  { id: 4, name: 'ועד בית וארנונה', amount: 700 },
  { id: 5, name: 'ביטוחים', amount: 1200 },
  { id: 6, name: 'תחבורה ודלק', amount: 1500 },
  { id: 7, name: 'טלפון ואינטרנט', amount: 400 },
  { id: 8, name: 'בילויים ומסעדות', amount: 2000 },
  { id: 9, name: 'בגדים וקניות', amount: 1000 },
  { id: 10, name: 'חוגים וספורט', amount: 800 },
  { id: 11, name: 'הוצאות רפואיות', amount: 500 },
  { id: 12, name: 'שונות', amount: 1000 }
];

// Default yearly expenses (anonymized)
export const defaultYearlyExpenses: Expense[] = [
  { id: 101, name: 'ביטוח רכב', amount: 5000 },
  { id: 102, name: 'טיפולי רכב', amount: 3000 },
  { id: 103, name: 'חופשות ונסיעות', amount: 30000 },
  { id: 104, name: 'מתנות וחגים', amount: 5000 },
  { id: 105, name: 'ריהוט ושיפוצים', amount: 10000 }
];

// Default salary data (person1: 40k gross/25k net, person2: 20k gross/15k net)
export const defaultSalaryData: SalaryData = {
  person1Gross: 40000,
  person1Net: 25000,
  person2Gross: 20000,
  person2Net: 15000
};

// Default simulation parameters
export const defaultSimulationParams = {
  returnRate: 6,
  inflationRate: 2.5,
  transitionToHalfWorkYear: 5,
  stopWorkYear: 15
};

// Default initial age
export const DEFAULT_INITIAL_AGE = 35;

// End of life age for simulation
export const END_OF_LIFE_AGE = 90;

// ID for rent expense (used to remove rent when buying property)
export const RENT_EXPENSE_ID = 1;

// Complete default state object
export const defaultState = {
  initialAge: DEFAULT_INITIAL_AGE,
  assets: defaultAssets,
  monthlyExpenses: defaultMonthlyExpenses,
  yearlyExpenses: defaultYearlyExpenses,
  salaryData: defaultSalaryData,
  equityCompanies: defaultEquityCompanies,
  propertyPlan: defaultPropertyPlan,
  simulationParams: defaultSimulationParams
};
