import { describe, it, expect } from 'vitest';
import { baselineGroups, monthActualByGroup, monthlyBudgetByGroup, yearBreakdown, yearOutliers, yearlyDetails } from '../utils/budgetGroups';
import { recurringMonthlyBudget, yearProjection } from '../utils/viewMath';

const month = (lines: Record<number, number>, reclass: any[] = [], extra: any[] = []) => ({
  lines: Object.fromEntries(Object.entries(lines).map(([id, a]) => [id, { actual: a }])),
  reclass, extra,
});

describe('monthActualByGroup', () => {
  it('sends travel and car reclass to their groups and skips uncounted buckets', () => {
    const m = month({ 1: 12_000, 12: 3_000, 999: 50 }, [
      { label: '✈️ נסיעות', amount: 5_000, counted: true },
      { label: '🚗 ביטוח/רישוי רכב (שנתי)', amount: 1_000, counted: true },
      { label: '💸 העברות ומזומן', amount: 9_000, counted: false },
    ], [{ label: 'birthday', amount: 800 }]);
    expect(monthActualByGroup(m)).toEqual({
      'דיור וחשבונות': 12_000, 'אוכל וקניות': 3_000, 'אחר': 50,
      'נסיעות': 5_000, 'רכב ותחבורה': 1_000, 'חד-פעמי': 800,
    });
  });
});

describe('yearBreakdown', () => {
  const monthly = [{ id: 1, name: 'rent', amount: 10_000 }, { id: 12, name: 'wolt', amount: 2_000 }];
  const yearlyItems = [
    { id: 103, name: 'trips', amount: 12_000 },
    { id: 109, name: 'war trip', amount: 60_000, oneTime: true },
  ];
  const yearly = {
    year: 2026, current_month: 11,
    monthly_actual: {} as Record<string, number>,
    noncash: [
      { ym: '2026-10', label: 'car', amount: 2_000, group: 'רכב ותחבורה', in_target: true },
      { ym: '2026-11', label: 'car', amount: 2_000, group: 'רכב ותחבורה', in_target: true },
      { ym: '2026-12', label: 'car', amount: 2_000, group: 'רכב ותחבורה', in_target: true },
    ],
  };
  const months: Record<string, any> = {};
  for (let m = 1; m <= 11; m++) {
    const ym = `2026-${String(m).padStart(2, '0')}`;
    months[ym] = m === 11 ? month({ 1: 10_000, 12: 2_500 }) : month({ 1: 10_000, 12: 1_500 }, m === 3 ? [{ label: '✈️ נסיעות', amount: 60_000, counted: true }] : []);
    yearly.monthly_actual[ym] = Object.values(monthActualByGroup(months[ym])).reduce((s, v) => s + v, 0);
  }

  it('budget per group matches the monthly run-rate', () => {
    const byGroup = monthlyBudgetByGroup(monthly as any, yearlyItems as any);
    expect(byGroup).toEqual({ 'דיור וחשבונות': 10_000, 'אוכל וקניות': 2_000, 'נסיעות': 1_000 });
    expect(Object.values(byGroup).reduce((s, v) => s + v, 0)).toBe(recurringMonthlyBudget(12_000, yearlyItems as any));
  });

  it('actuals so far + the budget left, per group; ends where the chart ends', () => {
    const b = yearBreakdown(yearly, months, monthly as any, yearlyItems as any, 10.5);
    const food = b.rows.find((r) => r.group === 'אוכל וקניות')!;
    // 10 x 1.5k + 2.5k this month (over budget -> nothing left), then Dec 2k
    expect(food.ytd).toBe(17_500);
    expect(food.rest).toBe(2_000);
    const travel = b.rows.find((r) => r.group === 'נסיעות')!;
    expect(travel.ytd).toBe(60_000);
    expect(travel.rest).toBe(1_000 + 1_000); // Nov unspent + Dec
    const car = b.rows.find((r) => r.group === 'רכב ותחבורה')!;
    expect(car.ytd).toBe(2_000 + 1_000); // Oct + half of Nov
    expect(car.rest).toBe(1_000 + 2_000);
    const p = yearProjection(yearly, 10.5, b.futureMonthly, b.curMonthRemaining);
    expect(p.yearEnd).toBeCloseTo(b.total, 6);
    expect(p.ytd).toBeCloseTo(b.ytd, 6);
  });

  it('leaves out a yearly item already spent this year, only for that year', () => {
    const items = [...yearlyItems, { id: 103, name: 'trips', amount: 24_000, skipYear: 2026 }];
    expect(monthlyBudgetByGroup(monthly as any, items as any, 2026)['נסיעות']).toBe(1_000);
    expect(monthlyBudgetByGroup(monthly as any, items as any, 2027)['נסיעות']).toBe(3_000);
  });

  it('the war trip gets a row of its own', () => {
    const g = monthActualByGroup(month({}, [
      { label: '✈️ נסיעות — טיול מלחמה', amount: 9_000, counted: true },
      { label: '✈️ נסיעות', amount: 1_000, counted: true },
    ]));
    expect(g).toEqual({ 'טיול מלחמה': 9_000, 'נסיעות': 1_000 });
  });

  it('a planned one-off counts in its month, and the chart ends on the same total', () => {
    const items = [...yearlyItems, { id: 111, name: 'hotel', amount: 3_650, oneTime: true, plannedYm: '2026-12' }];
    const b = yearBreakdown(yearly, months, monthly as any, items as any, 10.5);
    expect(b.rows.find((r) => r.group === 'נסיעות')!.rest).toBe(1_000 + 1_000 + 3_650);
    const p = yearProjection(yearly, 10.5, b.futureMonthly, b.curMonthRemaining, b.planned);
    expect(p.yearEnd).toBeCloseTo(b.total, 6);
    // Once its month is here, the actuals carry it.
    const past = yearBreakdown(yearly, months, monthly as any, [...yearlyItems, { ...items[items.length - 1], plannedYm: '2026-11' }] as any, 10.5);
    expect(past.planned).toEqual([]);
  });

  it("the rest of the year uses each line's restOfYear; the normal month keeps the average", () => {
    const lines = [{ id: 1, name: 'rent', amount: 10_000 }, { id: 12, name: 'food', amount: 2_000, restOfYear: 1_200 }];
    expect(monthlyBudgetByGroup(lines as any, [], 2026)['אוכל וקניות']).toBe(1_200);
    expect(monthlyBudgetByGroup(lines as any, [])['אוכל וקניות']).toBe(2_000);
  });
});

describe('yearOutliers', () => {
  const monthly = [
    { id: 1, name: 'rent', amount: 10_000 },
    { id: 24, name: 'shopping', amount: 1_000 },
    { id: 12, name: 'wolt', amount: 3_000 },
  ];
  const months: Record<string, any> = {
    '2026-01': month({ 1: 9_000, 24: 4_000, 12: 3_100 }, [
      { label: '✈️ נסיעות — טיול מלחמה', amount: 50_000, counted: true },
      { label: '💸 העברות ומזומן', amount: 9_000, counted: false },
    ], [{ label: 'charger (חד-פעמי)', amount: 6_000 }]),
    '2026-02': month({ 1: 9_000, 24: 0, 12: 2_900 }),
    '2026-03': month({ 1: 10_000, 24: 1_000, 12: 3_000 }),
  };
  const planned = [{ id: 111, name: 'hotel', amount: 3_650, plannedYm: '2026-05' }];

  it('lists trips, one-offs, planned items and card lines above their amount', () => {
    const { items, total } = yearOutliers(months, monthly as any, planned as any, 2026, 3, [1]);
    expect(items.map((o) => [o.label, Math.round(o.amount)])).toEqual([
      ['נסיעות — טיול מלחמה', 50_000],
      ['charger', 6_000],
      ['hotel', 3_650],
      ['shopping — מעל ₪1,000 לחודש', 3_000], // months with no spend don't count
    ]);
    expect(total).toBe(62_650);
  });

  it('opens each outlier into its transactions, largest first', () => {
    const m = { '2026-01': { lines: {}, extra: [], reclass: [{ label: '✈️ נסיעות', amount: 700, counted: true, txns: [{ d: 'hotel', a: 200, dt: '02/01' }, { d: 'EL AL   TLV', a: 500, dt: '01/01' }] }] } };
    const [trip] = yearOutliers(m, [], [], 2026, 1).items;
    expect(trip.details).toEqual([{ label: 'EL AL', amount: 500, note: '01/01' }, { label: 'hotel', amount: 200, note: '02/01' }]);
  });
});

describe('yearOutliers line details', () => {
  it('names the still-charging regulars and lists what stopped or came once', () => {
    const tx = (d: string, a: number) => ({ d, a, dt: '01/01' });
    const mo = (txns: any[]) => ({ lines: { 10: { actual: txns.reduce((s, t) => s + t.a, 0), txns } }, reclass: [], extra: [] });
    const months = {
      '2026-01': mo([tx('NETFLIX.COM', 100), tx("החברים של גורג'", 1_200)]),
      '2026-02': mo([tx('NETFLIX.COM', 100), tx("החברים של גורג'", 1_200), tx('ALBUME', 600)]),
      '2026-03': mo([tx('NETFLIX.COM', 100), tx("החברים של גורג'", 1_200)]),
      '2026-04': mo([tx('NETFLIX.COM', 100)]),
      '2026-05': mo([tx('NETFLIX.COM', 100)]),
    };
    const [o] = yearOutliers(months, [{ id: 10, name: 'subs', amount: 100 }] as any, [], 2026, 5).items;
    expect(Math.round(o.amount)).toBe(4_200);
    expect(o.details.map((d) => [d.label, d.amount, d.note])).toEqual([
      ["החברים של גורג'", 3_600, '×3, ינו׳–מרץ'],
      ['ALBUME', 600, '01/01'],
    ]);
    expect(o.note).toContain('בבסיס: NETFLIX.COM');
  });
});

describe('baseline details', () => {
  it('groups the monthly lines and spreads the recurring yearly items', () => {
    const groups = baselineGroups([{ id: 12, name: 'wolt', amount: 3_000 }, { id: 14, name: 'super', amount: 2_000 }, { id: 26, name: 'toys', amount: 0 }] as any);
    expect(groups).toEqual([{ group: 'אוכל וקניות', amount: 5_000, details: [{ label: 'wolt', amount: 3_000 }, { label: 'super', amount: 2_000 }] }]);
    const yd = yearlyDetails([{ id: 102, name: 'car ins', amount: 1_200 }, { id: 106, name: 'fridge', amount: 6_000, everyNYears: 10 }, { id: 111, name: 'hotel', amount: 3_650, oneTime: true, plannedYm: '2026-10' }] as any);
    expect(yd.map((d) => [d.label, Math.round(d.amount)])).toEqual([['car ins', 100], ['fridge', 50]]);
  });
});
