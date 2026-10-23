import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Expense } from '../types';
import { BUDGET_GROUPS, GROUP_COLOR, OTHER_GROUP, monthActualByGroup } from '../utils/budgetGroups';

const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-US');

export { BUDGET_GROUPS } from '../utils/budgetGroups';

export type PieDatum = { name: string; color: string; value: number };

const KNOWN_IDS = new Set(BUDGET_GROUPS.flatMap((g) => g.ids));
const OTHER_COLOR = GROUP_COLOR[OTHER_GROUP];

const toPie = (byGroup: Record<string, number>): PieDatum[] =>
  Object.entries(byGroup)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, color: GROUP_COLOR[name] ?? OTHER_COLOR, value }))
    .sort((a, b) => b.value - a.value);

// Planned-budget pie: sum each group's monthlyExpenses amounts.
// Lines whose id isn't in any group (user-added rows) fold into 'אחר'.
export function pieDataFromBudget(monthlyExpenses: Expense[]): PieDatum[] {
  const byId: Record<number, number> = {};
  monthlyExpenses.forEach((e) => { byId[e.id] = parseFloat(String(e.amount)) || 0; });
  const data = BUDGET_GROUPS
    .map((g) => ({ name: g.name, color: g.color, value: g.ids.reduce((s, id) => s + (byId[id] || 0), 0) }))
    .filter((d) => d.value > 0);
  const other = monthlyExpenses.filter((e) => !KNOWN_IDS.has(e.id)).reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);
  if (other > 0) data.push({ name: 'אחר', color: OTHER_COLOR, value: other });
  return data.sort((a, b) => b.value - a.value);
}

// Actual-spending pie for a given actuals month object {lines, reclass, extra}.
// Sums to total_actual (see budgetGroups.monthActualByGroup).
export function pieDataFromActualMonth(m: any): PieDatum[] {
  return toPie(monthActualByGroup(m));
}

// Actual-spending pie for a whole year: the same grouping, summed over the
// months, plus non-cash spend by group. Totals to the yearly chart's YTD.
export function pieDataFromActualYear(
  months: Record<string, any>,
  year: number,
  uptoMonth: number,
  /** Non-cash spend already summed per group name (car cost, in-kind babysitting). */
  noncashByGroup: Record<string, number> = {},
): PieDatum[] {
  const byGroup: Record<string, number> = { ...noncashByGroup };
  for (let mo = 1; mo <= uptoMonth; mo++) {
    for (const [g, v] of Object.entries(monthActualByGroup(months[`${year}-${String(mo).padStart(2, '0')}`]))) {
      byGroup[g] = (byGroup[g] || 0) + v;
    }
  }
  return toPie(byGroup);
}

const RAD = Math.PI / 180;
// percentage drawn inside each slice
const renderPct = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.06) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central">
      {Math.round(percent * 100)}%
    </text>
  );
};
// tooltip shows the CATEGORY NAME next to the number (+ share %)
// Uses utility classes (not inline colors) so the dark-mode override applies.
const PieTip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div dir="rtl" className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[13px] shadow-xl">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: d.color }} />
        <b className="text-slate-800">{d.name}</b>
      </div>
      <div className="text-slate-500 mt-0.5">₪{fmt(d.value)} · {d.pct}%</div>
    </div>
  );
};

export const CategoryPie: React.FC<{ data: PieDatum[]; title: string; suffix?: string }> = ({ data, title, suffix = '/חודש' }) => {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const dd = data.map((d) => ({ ...d, pct: Math.round((d.value / total) * 100) }));
  return (
    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 text-right">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-slate-800">{title}</h3>
        <span className="text-sm font-black text-slate-700">₪{fmt(total)}{suffix}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={dd} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} innerRadius={52} paddingAngle={1} isAnimationActive={false} label={renderPct} labelLine={false}>
                {dd.map((d, i) => <Cell key={i} fill={d.color} stroke="transparent" strokeWidth={1} />)}
              </Pie>
              <Tooltip content={<PieTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded" style={{ background: d.color }} /><span className="text-slate-600">{d.name}</span></span>
              <span className="font-bold text-slate-800">₪{fmt(d.value)} <span className="text-[11px] text-slate-400 font-normal">({Math.round((d.value / total) * 100)}%)</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
