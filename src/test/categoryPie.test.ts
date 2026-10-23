import { describe, it, expect } from 'vitest';
import { pieDataFromBudget, pieDataFromActualMonth, pieDataFromActualYear, BUDGET_GROUPS } from '../components/CategoryPie';
import actualsData from '../data/actuals.json';
import type { Expense } from '../types';

// Review-adjacent fix: budget lines whose id is not in any BUDGET_GROUPS
// bucket (user-added rows) used to be silently dropped from both pies.
describe('pieDataFromBudget', () => {
  it('folds unknown line ids into an אחר bucket instead of dropping them', () => {
    const expenses: Expense[] = [
      { id: 1, name: 'שכד', amount: 12_000 },       // דיור וחשבונות
      { id: 999, name: 'שורה שהוספתי', amount: 500 }, // not in any group
    ];
    const data = pieDataFromBudget(expenses);
    const other = data.find((d) => d.name === 'אחר');
    expect(other?.value).toBe(500);
    expect(data.find((d) => d.name === 'דיור וחשבונות')?.value).toBe(12_000);
    // the pie must account for every shekel
    expect(data.reduce((s, d) => s + d.value, 0)).toBe(12_500);
  });

  it('omits empty groups and the אחר bucket when everything is mapped', () => {
    const expenses: Expense[] = [{ id: 15, name: 'מנקה', amount: 700 }];
    const data = pieDataFromBudget(expenses);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('מנקה');
  });
});

describe('pieDataFromActualMonth', () => {
  it('sums to total_actual: grouped lines + אחר + counted reclass + one-time extra', () => {
    const m = {
      lines: { '12': { actual: 100 }, '999': { actual: 50 } }, // וולט + unknown id
      reclass: [
        { label: 'נסיעות', amount: 30, counted: true },
        { label: 'העברות', amount: 99, counted: false }, // money movement — not spend
      ],
      extra: [{ label: 'יום הולדת', amount: 20 }],
    };
    const data = pieDataFromActualMonth(m);
    expect(data.find((d) => d.name === 'אוכל וקניות')?.value).toBe(100);
    expect(data.find((d) => d.name === 'אחר')?.value).toBe(50);
    expect(data.find((d) => d.name === 'נסיעות')?.value).toBe(30); // counted only
    expect(data.find((d) => d.name === 'חד-פעמי')?.value).toBe(20);
    expect(data.reduce((s, d) => s + d.value, 0)).toBe(200);
  });

  it('handles an empty month (fresh month, no data) without crashing', () => {
    expect(pieDataFromActualMonth({ lines: {} })).toEqual([]);
    expect(pieDataFromActualMonth(null)).toEqual([]);
  });
});

describe('BUDGET_GROUPS integrity', () => {
  it('no budget-line id appears in two buckets (would double-count in every pie)', () => {
    const all = BUDGET_GROUPS.flatMap((g) => g.ids);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('pieDataFromActualYear', () => {
  it('totals to the same YTD figure the yearly chart shows', () => {
    const ACT: any = actualsData;
    const y = ACT.yearly;
    const ytd = Object.values(y.monthly_actual as Record<string, number>)
      .reduce((s, v) => s + (v || 0), 0);
    const pie = pieDataFromActualYear(ACT.months || {}, y.year, y.current_month);
    const pieTotal = pie.reduce((s, d) => s + d.value, 0);
    // The line-detail window covers every month with spend, so these agree to
    // within the rounding of the per-line actuals (a couple of shekels over a
    // whole year — the months' total_actual is rounded independently).
    expect(Math.abs(pieTotal - ytd)).toBeLessThan(20);
  });

  it('returns groups sorted by size, all positive', () => {
    const ACT: any = actualsData;
    const pie = pieDataFromActualYear(ACT.months || {}, ACT.yearly.year, ACT.yearly.current_month);
    expect(pie.length).toBeGreaterThan(0);
    pie.forEach((d) => expect(d.value).toBeGreaterThan(0));
    for (let i = 1; i < pie.length; i++) {
      expect(pie[i - 1].value).toBeGreaterThanOrEqual(pie[i].value);
    }
  });

  it('ignores months outside the requested range', () => {
    const ACT: any = actualsData;
    const full = pieDataFromActualYear(ACT.months || {}, ACT.yearly.year, ACT.yearly.current_month);
    const partial = pieDataFromActualYear(ACT.months || {}, ACT.yearly.year, 4);
    const sum = (d: typeof full) => d.reduce((s, x) => s + x.value, 0);
    expect(sum(partial)).toBeLessThan(sum(full));
  });

  it('is empty for a year with no data', () => {
    expect(pieDataFromActualYear({}, 1999, 12)).toEqual([]);
  });
});
