/**
 * Demo household. Fictional numbers for screenshots and a first boot.
 * After setup, the assistant overwrites this file. Do not edit it by hand.
 */

import type { Asset, Expense, SalaryData } from '../types';
import type { EquityCompany, PropertyPlan } from '../utils/storage';

export const defaultEquityCompanies: EquityCompany[] = [
  {
    id: 'demo-tech',
    name: 'דמו טק',
    ownerName: 'אדם',
    color: 'indigo',
    totalShares: 40000,
    contracts: [
      {
        name: 'Grant A (40k)',
        shares: 40000,
        strike: 1.2,
        startDate: '2024-01-01',
        periodYears: 4,
        cliffMonths: 12,
        cliffType: 'standard',
      },
    ],
    exitConfig: {
      exitYear: 2030,
      sharePriceAtExit: 8,
      valuationAtExit: 1,
    },
  },
];

export const defaultPropertyPlan: PropertyPlan = {
  enabled: false,
  config: { price: 2500000, year: 2031, monthlySavings: 6500 },
};

export const defaultAssets: Asset[] = [
  { id: 1, name: 'פנסיה וגמל (משותף)', value: 1200000, type: 'pension' },
  { id: 2, name: 'קרן השתלמות (אדם)', value: 180000, type: 'liquid' },
  { id: 3, name: 'קרן השתלמות (מאיה)', value: 95000, type: 'liquid' },
  { id: 4, name: 'תיק השקעות (אדם)', value: 420000, type: 'liquid', gainIls: 80000 },
  { id: 5, name: 'תיק השקעות (מאיה)', value: 160000, type: 'liquid', gainIls: 25000 },
  { id: 6, name: 'תיק השקעות (משותף)', value: 250000, type: 'liquid', gainIls: 40000 },
];

export const defaultMonthlyExpenses: Expense[] = [
  { id: 1, name: 'שכר דירה', amount: 7500 },
  { id: 2, name: 'ועד בית', amount: 450 },
  { id: 3, name: 'חשבונות דירה (ארנונה, חשמל, מים)', amount: 900 },
  { id: 6, name: 'קופת חולים', amount: 180 },
  { id: 7, name: 'אינטרנט וטלפון', amount: 160 },
  { id: 8, name: 'דלק', amount: 500 },
  { id: 9, name: 'ביטוח בריאות', amount: 320 },
  { id: 10, name: 'מנויים ובידור', amount: 180 },
  { id: 12, name: 'וולט', amount: 900 },
  { id: 13, name: 'מסעדות', amount: 700 },
  { id: 14, name: 'סופר', amount: 2200 },
  { id: 15, name: 'מנקה', amount: 640 },
  { id: 16, name: 'תחבורה', amount: 350 },
  { id: 17, name: 'שיננית', amount: 80 },
  { id: 32, name: 'ספר', amount: 50 },
  { id: 18, name: 'לא מסווג', amount: 0 },
  { id: 20, name: 'גן', amount: 2800 },
  { id: 23, name: 'פארם', amount: 250 },
  { id: 24, name: 'קניות', amount: 600 },
  { id: 25, name: 'אימון (מאיה)', amount: 300 },
  { id: 26, name: 'צעצועים', amount: 100 },
  { id: 27, name: 'אימון (אדם)', amount: 400 },
  { id: 28, name: 'מנויי טכנולוגיה', amount: 150 },
  { id: 30, name: 'עמלות כרטיס', amount: 40 },
  { id: 29, name: 'תרומות', amount: 100 },
];

export const defaultYearlyExpenses: Expense[] = [
  { id: 101, name: 'טיפול רכב', amount: 1200 },
  { id: 102, name: 'ביטוח רכב', amount: 4200 },
  { id: 110, name: 'מתנות', amount: 2000 },
  { id: 112, name: 'רופאים פרטיים', amount: 1500 },
  { id: 113, name: 'קניות גדולות', amount: 4000 },
];

export const defaultSalaryData: SalaryData = {
  person1Gross: 28000,
  person1Net: 18500,
  person2Gross: 22000,
  person2Net: 14500,
  monthlyStateIncome: 180,
  annualBonus: 8000,
};

export const defaultSimulationParams = {
  returnRate: 7,
  inflationRate: 2.5,
  transitionToHalfWorkYear: 12,
  stopWorkYear: 15,
  annualVolatility: 15,
  successTarget: 0.9,
  withdrawalMode: 'dynamic' as 'fixed' | 'amortized' | 'dynamic',
  spendFloor: 0,
  spendCap: 40000,
  glidepathEnabled: false,
  equityConfidence: 0.5,
  halfTimeEnabled: false,
};

export const DEFAULT_INITIAL_AGE = 36;
export const END_OF_LIFE_AGE = 90;
export const RENT_EXPENSE_ID = 1;

export const defaultState = {
  initialAge: DEFAULT_INITIAL_AGE,
  assets: defaultAssets,
  monthlyExpenses: defaultMonthlyExpenses,
  yearlyExpenses: defaultYearlyExpenses,
  salaryData: defaultSalaryData,
  equityCompanies: defaultEquityCompanies,
  propertyPlan: defaultPropertyPlan,
  simulationParams: defaultSimulationParams,
};
