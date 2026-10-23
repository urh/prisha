import React, { useState } from 'react';
import { Expense } from '../types';
import actualsData from '../data/actuals.json';
import { CategoryPie, pieDataFromActualMonth } from './CategoryPie';
import { barColor, lineProjection } from '../utils/viewMath';

const ACT: any = actualsData;
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-US');

// Hebrew month title from a 'YYYY-MM' key.
const monthTitle = (ym: string) => {
  const [y, m] = String(ym).split('-').map((v) => parseInt(v, 10));
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
};

type Txn = { d: string; a: number; dt?: string };

// Expanded detail behind a category row: its individual transactions (largest
// first). `sensitive` on merchant + amount so the privacy toggle blurs them too.
const TxnList: React.FC<{ txns: Txn[] }> = ({ txns }) => (
  <div className="mt-2 pt-2 border-t border-dashed border-slate-200 space-y-0.5">
    {txns.map((t, i) => (
      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
        <span className="shrink-0 w-9 text-left tabular-nums text-slate-400">{t.dt || ''}</span>
        <span className="flex-1 text-right text-slate-500 truncate sensitive">{t.d || '—'}</span>
        <span className="shrink-0 font-bold text-slate-600 sensitive">₪{fmt(t.a)}</span>
      </div>
    ))}
  </div>
);

// Small caret that rotates when its row is open (rotate-90 → points down in RTL).
const Caret: React.FC<{ open: boolean }> = ({ open }) => (
  <span className={`shrink-0 text-slate-400 text-[11px] leading-none transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
);

const MonthTable: React.FC<{ monthKey: string; monthlyExpenses: Expense[]; isCurrent: boolean; income: number }> = ({ monthKey, monthlyExpenses, isCurrent, income }) => {
  // Which category rows are expanded to show their underlying transactions.
  // Collapsed by default so the WhatsApp snapshot stays unchanged.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const m = (ACT.months && ACT.months[monthKey]) || { lines: {}, total_actual: 0 };
  const offcard: number[] = ACT.offcard_lines || [];
  const days = ACT.days_in_month || 30;
  const today = ACT.today || days;
  const dayFrac = Math.min(1, today / days);

  const toggleOpen = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const rows = monthlyExpenses.map((e) => {
    const cell = m.lines[String(e.id)] || {};
    const actual = cell.actual || 0;
    const auto = actual > 0;
    const isHappened = isCurrent ? auto : true;
    return { e, actual, n: cell.n || 0, txns: (cell.txns || []) as Txn[], isHappened, isOff: offcard.includes(e.id) };
  });
  // Happened lines first (largest actual on top), then pending estimates.
  const sortedRows = [...rows].sort((a, b) =>
    (Number(b.isHappened) - Number(a.isHappened)) ||
    (a.isHappened ? b.actual - a.actual : (b.e.amount || 0) - (a.e.amount || 0)));

  const totalBudget = monthlyExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalActual = m.total_actual || 0;
  const countedReclass = ((m.reclass || []) as any[]).filter((x) => x.counted).reduce((s, x) => s + (x.amount || 0), 0);
  const extraSum = ((m.extra || []) as any[]).reduce((s, x) => s + (x.amount || 0), 0);
  // End-of-month projection (semantics documented in viewMath.lineProjection).
  const projected = rows.reduce((s, r) =>
    s + lineProjection(false, r.isHappened, r.actual, r.e.amount || 0), 0)
    + countedReclass + extraSum;
  const remaining = income - (isCurrent ? projected : totalActual);
  const monthPct = totalBudget > 0 ? Math.min(100, (totalActual / totalBudget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* KPI header */}
      <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 text-right">
        <div className={`grid grid-cols-2 ${isCurrent ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-2 text-center`}>
          <div className="p-3 bg-emerald-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">הכנסות צפויות</div><div className="font-black text-emerald-700 sensitive">₪{fmt(income)}</div><div className="text-[9px] text-slate-400">משכורת נטו</div></div>
          <div className="p-3 bg-slate-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">תקציב</div><div className="font-black text-slate-700">₪{fmt(totalBudget)}</div></div>
          <div className="p-3 bg-rose-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">{isCurrent ? 'הוצאות עד כה' : 'הוצאות'}</div><div className="font-black text-rose-700">₪{fmt(totalActual)}</div><div className="text-[9px] text-slate-400">אשראי + שכד + ועד</div></div>
          {isCurrent && (
            <div className="p-3 bg-indigo-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">צפי סוף חודש</div><div className="font-black text-indigo-700">₪{fmt(projected)}</div><div className="text-[9px] text-slate-400">בוצע + הערכות</div></div>
          )}
          <div className={`p-3 rounded-2xl ${remaining >= 0 ? 'bg-sky-50' : 'bg-rose-100'}`}><div className="text-[10px] text-slate-400 font-bold">{isCurrent ? 'צפי נשאר החודש' : 'נשאר'}</div><div className={`font-black sensitive ${remaining >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>₪{fmt(remaining)}</div></div>
        </div>
        {isCurrent && (
          <div className="mt-4">
            <div className="relative h-2.5 bg-slate-100 rounded-full">
              <div className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${monthPct}%`, background: barColor(totalActual, totalBudget) }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-slate-400 rounded" style={{ right: `${dayFrac * 100}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-bold mt-1">
              <span>יום {today} מתוך {days}</span>
              <span>{totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0}% מהתקציב נוצל</span>
            </div>
          </div>
        )}
      </div>

      {/* Where the money went */}
      <CategoryPie data={pieDataFromActualMonth(m)} title="לאן הלך הכסף בפועל" suffix="" />

      {/* Line-by-line */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 text-right">
        {isCurrent && <div className="text-[10px] text-slate-400 mb-3 text-right">שורות אפורות = הערכה שטרם בוצעה. הסטטוס מגיע מהעוזר, לא מלחיצה כאן.</div>}
        <div className="space-y-1 max-h-[620px] overflow-y-auto pl-1 custom-scrollbar">
          {sortedRows.map((r) => {
            const gray = !r.isHappened;
            const shown = r.isHappened ? r.actual : (r.e.amount || 0);
            const budget = r.e.amount || 0;
            const over = r.isHappened && r.actual > budget * 1.15;
            const hasTxns = r.txns.length > 0;
            const key = `line:${r.e.id}`;
            const isOpen = !!open[key];
            return (
              <div key={r.e.id} className={`p-2 rounded-xl border ${gray ? 'bg-slate-50/60 border-slate-100' : 'bg-white border-slate-100'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${r.isHappened ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {r.isHappened ? '✓ בוצע' : '○ צפי'}
                  </span>
                  <div
                    onClick={hasTxns ? () => toggleOpen(key) : undefined}
                    role={hasTxns ? 'button' : undefined}
                    aria-expanded={hasTxns ? isOpen : undefined}
                    className={`flex-1 min-w-0 flex items-center gap-1.5 ${hasTxns ? 'cursor-pointer select-none' : ''}`}
                  >
                    {hasTxns && <Caret open={isOpen} />}
                    <span className={`min-w-0 truncate text-sm font-bold ${gray ? 'text-slate-400' : 'text-slate-700'}`}>
                      {r.e.name}{r.isOff && <span className="text-[9px] text-slate-400 me-1">(לא בכרטיס)</span>}
                      {r.n > 0 && <span className="text-[9px] text-slate-400 me-1">· {r.n}</span>}
                    </span>
                  </div>
                  <div className={`shrink-0 text-sm font-black ${over ? 'text-rose-600' : gray ? 'text-slate-400' : 'text-slate-800'}`}>₪{fmt(shown)}</div>
                  <div className="shrink-0 w-20 text-[10px] text-slate-400 text-left">תקציב ₪{fmt(budget)}</div>
                </div>
                {r.isHappened && budget > 0 && (
                  <div className="relative h-1 bg-slate-100 rounded-full mt-1.5">
                    <div className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${Math.min(100, (r.actual / budget) * 100)}%`, background: barColor(r.actual, budget) }} />
                  </div>
                )}
                {isOpen && hasTxns && <TxnList txns={r.txns} />}
              </div>
            );
          })}
        </div>
        {(m.reclass && m.reclass.length > 0) && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 font-bold mb-1 text-right">שובץ מחוץ לשורות התקציב</div>
            {m.reclass.map((x: any, i: number) => {
              const rtx = (x.txns || []) as Txn[];
              const hasTxns = rtx.length > 0;
              const key = `rc:${i}`;
              const isOpen = !!open[key];
              return (
                <div key={i} className={`p-2 rounded-xl border mb-1 ${x.counted ? 'border-sky-100 bg-sky-50/50' : 'border-slate-100 bg-slate-50/60'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${x.counted ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-400'}`}>{x.counted ? 'שובץ' : 'לא נספר'}</span>
                    <div
                      onClick={hasTxns ? () => toggleOpen(key) : undefined}
                      role={hasTxns ? 'button' : undefined}
                      aria-expanded={hasTxns ? isOpen : undefined}
                      className={`flex-1 min-w-0 flex items-center gap-1.5 ${hasTxns ? 'cursor-pointer select-none' : ''}`}
                    >
                      {hasTxns && <Caret open={isOpen} />}
                      <span className={`min-w-0 truncate text-sm font-bold ${x.counted ? 'text-slate-700' : 'text-slate-400'}`}>{x.label}{x.n > 0 && <span className="text-[9px] text-slate-400 me-1">· {x.n}</span>}</span>
                    </div>
                    <div className={`shrink-0 text-sm font-black ${x.counted ? 'text-sky-700' : 'text-slate-400'}`}>₪{fmt(x.amount)}</div>
                    <div className="shrink-0 w-20" />
                  </div>
                  {isOpen && hasTxns && <TxnList txns={rtx} />}
                </div>
              );
            })}
          </div>
        )}
        {(m.extra && m.extra.length > 0) && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 font-bold mb-1 text-right">חד-פעמי החודש</div>
            {m.extra.map((x: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-xl border border-amber-100 bg-amber-50/50">
                <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">🎁 חד-פעמי</span>
                <div className="flex-1 text-right text-sm font-bold text-slate-700 truncate">{x.label}</div>
                <div className="shrink-0 text-sm font-black text-amber-700">₪{fmt(x.amount)}</div>
                <div className="shrink-0 w-20" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MonthActualsTab: React.FC<{ monthlyExpenses: Expense[]; income: number }> = ({ monthlyExpenses, income }) => (
  <div className="animate-in slide-in-from-bottom-4 duration-500 pb-12 text-right">
    <MonthTable monthKey={ACT.current_month} monthlyExpenses={monthlyExpenses} isCurrent income={income} />
  </div>
);

export const ArchiveTab: React.FC<{ monthlyExpenses: Expense[]; income: number }> = ({ monthlyExpenses, income }) => {
  const months: string[] = Object.keys(ACT.months || {}).filter((k) => k !== ACT.current_month).sort().reverse();
  const [sel, setSel] = useState<string>(months[0] || ACT.current_month);
  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500 pb-12 text-right">
      <div className="flex flex-wrap gap-2 mb-4">
        {months.map((k) => {
          const active = sel === k;
          const tot = (ACT.months[k] || {}).total_actual || 0;
          return (
            <button key={k} onClick={() => setSel(k)} className={`px-3 py-1.5 rounded-xl text-right transition-all border ${active ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              <div className="text-[11px] font-black">{monthTitle(k)}</div>
              <div className={`text-[10px] font-bold ${active ? 'text-white/70' : 'text-slate-400'}`}>₪{fmt(tot)}</div>
            </button>
          );
        })}
      </div>
      <MonthTable key={sel} monthKey={sel} monthlyExpenses={monthlyExpenses} isCurrent={false} income={income} />
    </div>
  );
};
