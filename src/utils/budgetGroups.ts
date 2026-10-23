import { Expense } from '../types';
import { LINEAR, SERIES } from './palette';
import { yearlyExpenseMonthlyAmount } from './calculations';
import { NoncashItem } from './viewMath';

const HEALTH_GROUP = 'בריאות וטיפוח';

// Headline buckets. ids reference monthlyExpenses line ids (and actuals line ids).
export const BUDGET_GROUPS: { name: string; color: string; ids: number[] }[] = [
  { name: 'דיור וחשבונות', color: SERIES[0], ids: [1, 2, 3, 7, 30] },
  { name: 'אוכל וקניות', color: SERIES[1], ids: [12, 13, 14, 24] },
  { name: 'גן/מטפלת', color: SERIES[2], ids: [20] },
  { name: HEALTH_GROUP, color: SERIES[3], ids: [6, 9, 31, 23, 17, 32] },
  { name: 'חוגים ומנויים', color: SERIES[4], ids: [10, 25, 26, 27, 28] },
  { name: 'מנקה', color: SERIES[5], ids: [15] },
  { name: 'רכב ותחבורה', color: SERIES[6], ids: [8, 16] },
  { name: 'תרומות', color: SERIES[7], ids: [29, 18] },
];

export const TRAVEL_GROUP = 'נסיעות';
export const WAR_TRIP_GROUP = 'טיול מלחמה';
export const ONEOFF_GROUP = 'חד-פעמי';
export const OTHER_GROUP = 'אחר';
export const CAR_GROUP = 'רכב ותחבורה';

export const GROUP_COLOR: Record<string, string> = {
  ...Object.fromEntries(BUDGET_GROUPS.map((g) => [g.name, g.color])),
  [TRAVEL_GROUP]: SERIES[9],
  [WAR_TRIP_GROUP]: SERIES[9],
  [ONEOFF_GROUP]: SERIES[8],
  [OTHER_GROUP]: LINEAR.inkSubtle,
};

const GROUP_OF_LINE = new Map(BUDGET_GROUPS.flatMap((g) => g.ids.map((id) => [id, g.name] as const)));
export const groupOfLine = (id: number) => GROUP_OF_LINE.get(id) ?? OTHER_GROUP;

// Yearly budget items → the group their spend shows up in. The rest (gifts,
// jewelry, appliances) arrive as one-off charges.
const GROUP_OF_YEARLY: Record<number, string> = {
  101: CAR_GROUP, 102: CAR_GROUP, 103: TRAVEL_GROUP, 111: TRAVEL_GROUP, 112: HEALTH_GROUP, 113: 'אוכל וקניות',
};

/** A counted reclass bucket (prisha_actuals.py RECLASS / KW_RECLASS) → group. */
const groupOfReclass = (label: string) =>
  label.includes('מלחמה') ? WAR_TRIP_GROUP
    : label.includes('נסיעות') ? TRAVEL_GROUP : label.startsWith('🚗') ? CAR_GROUP : ONEOFF_GROUP;

/** One actuals month by headline group. Sums to the month's total_actual. */
export function monthActualByGroup(m: any): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (g: string, v: number) => { if (v) out[g] = (out[g] || 0) + v; };
  for (const [id, l] of Object.entries<any>((m && m.lines) || {})) add(groupOfLine(parseInt(id, 10)), l.actual || 0);
  for (const r of (m && m.reclass) || []) if (r.counted) add(groupOfReclass(r.label || ''), r.amount || 0);
  for (const x of (m && m.extra) || []) add(ONEOFF_GROUP, x.amount || 0);
  return out;
}

/**
 * The budget per month by group: monthly lines + recurring yearly items
 * spread over 12. 2026-only items are already spent (actuals). Sums to recurringMonthlyBudget;
 * with `year` it is that year's forecast instead: each line's restOfYear, less
 * the yearly items already spent (skipYear).
 */
export function monthlyBudgetByGroup(monthlyExpenses: Expense[], yearlyExpenses: Expense[], year?: number): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (g: string, v: number) => { if (v) out[g] = (out[g] || 0) + v; };
  for (const e of monthlyExpenses || []) {
    const amt = year !== undefined && e.restOfYear != null ? e.restOfYear : e.amount;
    add(groupOfLine(e.id), parseFloat(String(amt)) || 0);
  }
  for (const e of yearlyExpenses || []) {
    if (e.plannedYm || (year !== undefined && e.skipYear === year)) continue;
    add(GROUP_OF_YEARLY[e.id] ?? ONEOFF_GROUP, yearlyExpenseMonthlyAmount(e, false));
  }
  return out;
}

/** One line of an expandable row: a transaction, a budget line or a yearly item. */
export interface Detail { label: string; amount: number; note?: string }
export interface Outlier { label: string; amount: number; group: string; details: Detail[]; note?: string }

const HEB_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const monthName = (ym: string) => HEB_MONTHS[parseInt(ym.slice(5, 7), 10) - 1] || ym;
/** actuals txn {d, a, dt: 'DD/MM'} → a detail line. */
const txnDetail = (t: any, ym: string): Detail => ({
  label: String(t.d || '').replace(/\s{2,}.*$/, '').trim(), amount: t.a || 0, note: t.dt || monthName(ym),
});
const largestFirst = (ds: Detail[]) => [...ds].sort((a, b) => b.amount - a.amount);

/** One merchant however the card spells it this time ("PAYPAL *APPLE.COM/BILL 3531…" = "APPLE.COM/BILL"). */
const merchantKey = (d: string) =>
  String(d || '').toUpperCase().replace(/^PAYPAL \*/, '').replace(/\s{2,}.*$/, '').replace(/[\d*]+/g, '').trim().slice(0, 14);

interface MerchantSpend { label: string; amount: number; months: Set<number>; n: number; dt?: string }

/** The regular month by group, each with the budget lines inside it. */
export function baselineGroups(monthlyExpenses: Expense[]): { group: string; amount: number; details: Detail[] }[] {
  const by = new Map<string, Detail[]>();
  for (const e of monthlyExpenses || []) {
    const amt = parseFloat(String(e.amount)) || 0;
    if (!amt) continue;
    const g = groupOfLine(e.id);
    by.set(g, [...(by.get(g) || []), { label: e.name, amount: amt }]);
  }
  return [...by.entries()]
    .map(([group, ds]) => ({ group, amount: ds.reduce((s, d) => s + d.amount, 0), details: ds.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/** Recurring yearly items as detail lines: per month, with the yearly amount as the note. */
export function yearlyDetails(yearlyExpenses: Expense[]): Detail[] {
  return (yearlyExpenses || [])
    .filter((e) => !e.oneTime && !e.plannedYm)
    .map((e) => {
      const amt = parseFloat(String(e.amount)) || 0;
      const n = e.everyNYears && e.everyNYears > 1 ? e.everyNYears : 1;
      return { label: e.name, amount: yearlyExpenseMonthlyAmount(e, false), note: `₪${Math.round(amt).toLocaleString('en-US')} ${n > 1 ? `כל ${n} שנים` : 'בשנה'}` };
    })
    .filter((d) => d.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Below this a line's spend above its monthly amount is noise, not an outlier. */
const OUTLIER_MIN = 1_000;

const stripEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();

/**
 * What pushed `year` above its regular months: trips and other counted
 * reclass buckets, one-off charges, planned one-offs, and each card line's
 * spend above its monthly amount (compared over the months it had spend at
 * all — during the war trip the card lines were ~0 and the trip took their
 * place). Off-card lines (rent, daycare, …) are the regular month itself.
 */
export function yearOutliers(
  months: Record<string, any>,
  monthlyExpenses: Expense[],
  yearlyExpenses: Expense[],
  year: number,
  elapsedMonths: number,
  offcardLines: number[] = [],
): { items: Outlier[]; total: number } {
  const curM = Math.ceil(elapsedMonths) || 1;
  const curFrac = elapsedMonths - (curM - 1);
  const ym = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const by = new Map<string, Outlier>();
  const add = (label: string, amount: number, group: string, details: Detail[] = []) => {
    const o = by.get(label) || { label, amount: 0, group, details: [] };
    o.amount += amount;
    o.details.push(...details);
    by.set(label, o);
  };
  for (let m = 1; m <= curM; m++) {
    const mo = months[ym(m)];
    for (const r of (mo && mo.reclass) || []) {
      if (r.counted) add(stripEmoji(r.label || ''), r.amount || 0, groupOfReclass(r.label || ''), (r.txns || []).map((t: any) => txnDetail(t, ym(m))));
    }
    for (const x of (mo && mo.extra) || []) {
      add(stripEmoji(String(x.label || '').replace(/\s*\(חד-פעמי\)/, '')), x.amount || 0, ONEOFF_GROUP, [{ label: monthName(ym(m)), amount: x.amount || 0 }]);
    }
  }
  for (const e of yearlyExpenses || []) {
    if (e.plannedYm && e.plannedYm.startsWith(`${year}-`) && e.plannedYm > ym(curM)) {
      const amt = parseFloat(String(e.amount)) || 0;
      add(e.name, amt, GROUP_OF_YEARLY[e.id] ?? ONEOFF_GROUP, [{ label: `מתוכנן ל${monthName(e.plannedYm)}`, amount: amt }]);
    }
  }
  for (const e of monthlyExpenses || []) {
    if (offcardLines.includes(e.id)) continue;
    const base = parseFloat(String(e.amount)) || 0;
    let spent = 0, n = 0;
    const merchants = new Map<string, MerchantSpend>();
    for (let m = 1; m <= curM; m++) {
      const l = months[ym(m)]?.lines?.[e.id];
      const a = l?.actual || 0;
      if (a <= 0) continue;
      spent += a;
      n += m === curM ? curFrac : 1;
      for (const t of l.txns || []) {
        const d = txnDetail(t, ym(m));
        const k = merchantKey(t.d);
        const ms = merchants.get(k) || { label: d.label, amount: 0, months: new Set<number>(), n: 0 };
        ms.amount += d.amount; ms.n += 1; ms.months.add(m); ms.dt = d.note;
        merchants.set(k, ms);
      }
    }
    const over = spent - base * n;
    if (over >= OUTLIER_MIN) {
      // A merchant charging most months and still charging is the regular
      // month itself (Netflix, Ozempic-free Super-Pharm): name it, don't list
      // it as what pushed the line up. Stopped ones (a cancelled standing
      // order) and one-offs are the outlier.
      const regular = [...merchants.values()].filter((ms) => ms.months.size >= 3 && (ms.months.has(curM) || ms.months.has(curM - 1)));
      const rest = [...merchants.values()].filter((ms) => !regular.includes(ms)).map((ms): Detail => ({
        label: ms.label,
        amount: ms.amount,
        note: ms.n === 1 ? ms.dt : `×${ms.n}, ${monthName(ym(Math.min(...ms.months)))}–${monthName(ym(Math.max(...ms.months)))}`,
      }));
      const label = `${e.name} — מעל ${base ? `₪${Math.round(base).toLocaleString('en-US')} לחודש` : 'הקבוע'}`;
      add(label, over, groupOfLine(e.id), rest);
      by.get(label)!.note = `יצא ₪${Math.round(spent).toLocaleString('en-US')} השנה, מזה ₪${Math.round(base * n).toLocaleString('en-US')} קבוע.`
        + (regular.length ? ` חוזרים כל חודש, בבסיס: ${regular.sort((a, b) => b.amount - a.amount).map((ms) => ms.label).join(', ')}.` : '');
    }
  }
  const items = [...by.values()]
    .filter((o) => Math.round(o.amount) > 0)
    .map((o) => ({ ...o, details: largestFirst(o.details) }))
    .sort((a, b) => b.amount - a.amount);
  return { items, total: items.reduce((s, o) => s + o.amount, 0) };
}

export interface YearRow { group: string; ytd: number; rest: number; total: number }

/**
 * The year by headline group: what was actually spent so far (cash + non-cash)
 * and the budget for the rest of it. This month's remainder is each group's
 * unspent budget (never negative); later months are the full budget.
 * Planned one-offs (plannedYm) are added in their month.
 * `curMonthRemaining`, `futureMonthly` and `planned` feed yearProjection so
 * the chart ends on the same total.
 */
export function yearBreakdown(
  yearly: { year?: number; current_month?: number; noncash?: NoncashItem[] },
  months: Record<string, any>,
  monthlyExpenses: Expense[],
  yearlyExpenses: Expense[],
  elapsedMonths: number,
) {
  const year = yearly.year || new Date().getFullYear();
  const curM = yearly.current_month || 12;
  const curFrac = Math.min(1, Math.max(0, elapsedMonths - (curM - 1)));
  const ym = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const ytd: Record<string, number> = {};
  const rest: Record<string, number> = {};
  const add = (o: Record<string, number>, g: string, v: number) => { if (v) o[g] = (o[g] || 0) + v; };

  for (let m = 1; m <= curM; m++) {
    for (const [g, v] of Object.entries(monthActualByGroup(months[ym(m)]))) add(ytd, g, v);
  }
  // Non-cash spend accrues through its month.
  for (const n of yearly.noncash || []) {
    const mi = parseInt(String(n.ym).slice(5, 7), 10);
    if (!String(n.ym).startsWith(String(year))) continue;
    const done = mi < curM ? 1 : mi === curM ? curFrac : 0;
    add(ytd, n.group, n.amount * done);
    add(rest, n.group, n.amount * (1 - done));
  }

  const budget = monthlyBudgetByGroup(monthlyExpenses, yearlyExpenses, year);
  const cur = monthActualByGroup(months[ym(curM)]);
  let curMonthRemaining = 0;
  for (const [g, b] of Object.entries(budget)) {
    const left = Math.max(0, b - (cur[g] || 0));
    curMonthRemaining += left;
    add(rest, g, left + b * (12 - curM));
  }

  const planned = (yearlyExpenses || [])
    .filter((e) => e.plannedYm && e.plannedYm.startsWith(`${year}-`) && e.plannedYm > ym(curM))
    .map((e) => ({ ym: e.plannedYm!, name: e.name, amount: parseFloat(String(e.amount)) || 0, group: GROUP_OF_YEARLY[e.id] ?? ONEOFF_GROUP }));
  for (const p of planned) add(rest, p.group, p.amount);

  const rows: YearRow[] = [...new Set([...Object.keys(ytd), ...Object.keys(rest)])]
    .map((group) => ({ group, ytd: ytd[group] || 0, rest: rest[group] || 0, total: (ytd[group] || 0) + (rest[group] || 0) }))
    .filter((r) => Math.round(r.total) !== 0)
    .sort((a, b) => b.total - a.total);
  const sum = (k: 'ytd' | 'rest' | 'total') => rows.reduce((s, r) => s + r[k], 0);
  return {
    rows,
    ytd: sum('ytd'),
    rest: sum('rest'),
    total: sum('total'),
    curMonthRemaining,
    planned,
    futureMonthly: Object.values(budget).reduce((s, v) => s + v, 0),
  };
}
