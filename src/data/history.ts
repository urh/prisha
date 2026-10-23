export interface HistoryYear {
  year: number;
  yearlyIncome: number | null;
  yearlyExpenses: number;
  yearlySavings: number | null;
  monthlyIncome: number | null;
  monthlyExpenses: number;
  netWorth: number | null;
  liquid: number | null;
  pension: number | null;
  property: number | null;
  netWorthInterpolated?: boolean;
  pensionEstimated?: boolean;
  categories: Record<string, number>;
}

export const historyCategoryOrder: string[] = [
  'דיור',
  'אוכל',
  'אחר',
];

export const historicalYears: HistoryYear[] = [
  {
    year: 2024,
    yearlyIncome: 360000,
    yearlyExpenses: 240000,
    yearlySavings: 120000,
    monthlyIncome: 30000,
    monthlyExpenses: 20000,
    netWorth: 1400000,
    liquid: 700000,
    pension: 700000,
    property: 0,
    categories: { 'דיור': 110000, 'אוכל': 50000, 'אחר': 80000 },
  },
  {
    year: 2025,
    yearlyIncome: 390000,
    yearlyExpenses: 252000,
    yearlySavings: 138000,
    monthlyIncome: 32500,
    monthlyExpenses: 21000,
    netWorth: 1650000,
    liquid: 820000,
    pension: 830000,
    property: 0,
    categories: { 'דיור': 114000, 'אוכל': 54000, 'אחר': 84000 },
  },
];
