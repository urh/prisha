import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine,
} from 'recharts';
import { Asset, Expense } from '../types';
import { elapsedMonthsOf, yearPace, yearProjection } from '../utils/viewMath';
import { yearBreakdown } from '../utils/budgetGroups';
import actualsData from '../data/actuals.json';
import { CategoryPie, pieDataFromActualYear } from './CategoryPie';
import { BalancesCard } from './BalancesCard';
import { CHART } from '../utils/palette';

const ACT: any = actualsData;
const MONTHS_HE = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const fmtK = (n: number) => `₪${Math.round((n || 0) / 1000)}k`;
const fmtFull = (n: number) => `₪${Math.round(n || 0).toLocaleString('en-US')}`;

export const YearlyTab: React.FC<{
  monthlyExpenses: Expense[]; yearlyExpenses: Expense[]; income: number; privacy?: boolean;
  /** Monthly pension / hishtalmut contributions — the deposit estimate in the balances card. */
  monthlyPensionIn: number; monthlyStudyIn: number;
  assets: Asset[];
}> = ({ monthlyExpenses, yearlyExpenses, income, privacy, monthlyPensionIn, monthlyStudyIn, assets }) => {
  const y = ACT.yearly || { monthly_actual: {}, upcoming: [], recurring_baseline: 0, current_month: 12, noncash: [] };
  const year: number = y.year || 2026;
  const curM: number = y.current_month || 12;
  // How far into the year we are (incl. the fraction of the current month) —
  // drives the pace badge and the "saved so far" figure.
  const elapsedMonths = elapsedMonthsOf(curM, ACT.today || 30, ACT.days_in_month || 30);

  const monthlyTotal = monthlyExpenses.reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);
  // Shared with the Overview pace badge — the two must agree. Includes the
  // non-cash spend (babysitting paid with the old car).
  const pace = yearPace(y, monthlyTotal, yearlyExpenses, elapsedMonths);
  const { targetAnnual, baseAnnual, paceDelta } = pace;
  const nc = pace.nc;
  const incomeAnnual = Math.round(income * 12);
  // Months ahead run on the budget, so editing it moves the year-end; same
  // per-category math as the budget tab's table.
  const bd = yearBreakdown(y, ACT.months || {}, monthlyExpenses, yearlyExpenses, elapsedMonths);
  const proj = yearProjection(y, elapsedMonths, bd.futureMonthly, bd.curMonthRemaining, bd.planned);
  const { ytd, yearEnd } = proj;

  let ncTargetCum = 0;
  const data = MONTHS_HE.map((month, i) => {
    ncTargetCum += nc.target[i];
    return {
      month,
      actual: proj.actual[i],
      projection: proj.projection[i],
      target: Math.round((baseAnnual * (i + 1)) / 12 + ncTargetCum),
      income: Math.round((incomeAnnual * (i + 1)) / 12),
    };
  });
  const inkind = y.old_car_inkind;
  const inkindMonthly = (y.noncash || []).find((n: any) => !n.in_target)?.amount || 0;
  // Saved = what is left of the net income (to the brokerage / bank) + the
  // pension and hishtalmut contributions. Deposits only — no market gains.
  const lockedMonthly = monthlyPensionIn + monthlyStudyIn;
  const savedCash = Math.round(incomeAnnual - yearEnd);
  const savedLocked = Math.round(lockedMonthly * 12);
  const savedYear = savedCash + savedLocked;   // projected full year
  const savedYtd = Math.round((income + lockedMonthly) * elapsedMonths - ytd);  // so far this year

  // Where the year's money actually went, by headline category. Sums to the
  // same YTD figure as the chart above.
  const yearPie = React.useMemo(() => {
    const byGroup: Record<string, number> = {};
    for (const n of (y.noncash || [])) {
      const mi = parseInt(String(n.ym).slice(5, 7), 10) - 1;
      byGroup[n.group] = (byGroup[n.group] || 0) + n.amount * Math.min(1, Math.max(0, elapsedMonths - mi));
    }
    return pieDataFromActualYear(ACT.months || {}, year, curM, byGroup);
  }, [year, curM, elapsedMonths, y.noncash]);

  // mark big one-off events (trips) on the projection line so the jumps are obvious
  const markers = (y.upcoming || [])
    .filter((u: any) => (u.amount || 0) >= 20000)
    .map((u: any) => {
      const mi = parseInt(String(u.ym).slice(5, 7), 10) - 1;
      const pt = data[mi];
      return { month: MONTHS_HE[mi], value: pt ? (pt.projection ?? pt.actual ?? 0) : 0, text: `${u.label} +${fmtK(u.amount)}` };
    })
    .filter((m: any) => m.value);

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500 pb-12 text-right">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-4 text-center">
        <div className="p-3 bg-emerald-50 rounded-2xl sensitive"><div className="text-[10px] text-slate-400 font-bold">הכנסה צפויה</div><div className="font-black text-emerald-700">{fmtFull(incomeAnnual)}</div><div className="text-[9px] text-slate-400">כולל בונוס וקצבאות</div></div>
        <div className="p-3 bg-slate-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">יעד שנתי</div><div className="font-black text-slate-700">{fmtFull(targetAnnual)}</div></div>
        <div className="p-3 bg-blue-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">הוצאה מתחילת השנה</div><div className="font-black text-blue-700">{fmtFull(ytd)}</div></div>
        <div className="p-3 bg-amber-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">צפי לסוף {year}</div><div className="font-black text-amber-700">{fmtFull(yearEnd)}</div></div>
        <div className={`p-3 rounded-2xl sensitive ${savedYear >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}><div className="text-[10px] text-slate-400 font-bold">נחסך (צפי {year})</div><div className={`font-black ${savedYear >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtFull(savedYear)}</div><div className="text-[9px] text-slate-400">מהנטו (לתיק/עו״ש) {fmtFull(savedCash)}</div><div className="text-[9px] text-slate-400">לפנסיה+השתלמות {fmtFull(savedLocked)}</div><div className="text-[9px] text-slate-400">עד עכשיו {fmtFull(savedYtd)}</div></div>
      </div>
      <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex justify-end mb-1">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${paceDelta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {paceDelta >= 0 ? `בקצב טוב — מתחת ליעד היחסי ב-${fmtFull(paceDelta)}` : `מעל היעד היחסי ב-${fmtFull(-paceDelta)}`}
          </span>
        </div>
        <div style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="month" reversed tick={{ fontSize: 11, fill: CHART.axis }} />
              <YAxis orientation="right" width={50} tickFormatter={fmtK} tick={{ fontSize: 11, fill: CHART.axis }} />
              <Tooltip formatter={(v: any, n: any) => [fmtFull(v as number), n]} contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 12 }} />
              <ReferenceLine x={MONTHS_HE[curM - 1]} stroke={CHART.axis} strokeDasharray="3 3" label={{ value: 'היום', position: 'top', fontSize: 10, fill: CHART.axis }} />
              {!privacy && <Line type="monotone" dataKey="income" name="הכנסה" stroke={CHART.income} strokeWidth={2} dot={false} isAnimationActive={false} />}
              <Line type="monotone" dataKey="target" name="יעד" stroke={CHART.target} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="actual" name="הוצאה בפועל" stroke={CHART.actual} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="projection" name="תחזית" stroke={CHART.projection} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
              {markers.map((m: any, i: number) => (
                <ReferenceDot key={i} x={m.month} y={m.value} r={4} fill={CHART.marker} stroke="#fff" strokeWidth={1.5} isFront
                  label={{ value: m.text, position: 'top', fontSize: 10, fill: CHART.marker, fontWeight: 500 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end mt-2 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-[3px] rounded" style={{ background: CHART.actual }} />הוצאה בפועל</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: CHART.projection }} />תחזית</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: CHART.target }} />יעד</span>
          {!privacy && <span className="flex items-center gap-1"><span className="inline-block w-3 h-[3px] rounded" style={{ background: CHART.income }} />הכנסה</span>}
        </div>
        {markers.length > 0 && (
          <div className="mt-2 text-[11px] text-slate-500 text-right">אירועים גדולים בתחזית: {markers.map((m: any) => m.text).join(' · ')}</div>
        )}
        {inkind && (
          <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 text-right">
            {inkind.label}: שווה ~{fmtK(inkind.amount)}, נספר כהוצאת גן של {fmtFull(inkindMonthly)} לחודש
            ב{MONTHS_HE[parseInt(String(inkind.from_ym).slice(5, 7), 10) - 1]}–{MONTHS_HE[parseInt(String(inkind.to_ym).slice(5, 7), 10) - 1]} (הגן כבר ביעד כל השנה).
          </div>
        )}
      </div>

      <BalancesCard monthlyPensionIn={monthlyPensionIn} monthlyStudyIn={monthlyStudyIn} assets={assets} />

      {yearPie.length > 0 && (
        <div className={`mt-4 ${privacy ? 'sensitive' : ''}`}>
          <CategoryPie
            data={yearPie}
            title={`לאן הלך הכסף מתחילת ${year}`}
            suffix=""
          />
        </div>
      )}
    </div>
  );
};
