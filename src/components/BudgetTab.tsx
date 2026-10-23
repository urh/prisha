import React, { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Expense } from '../types';
import { baselineGroups, Detail, GROUP_COLOR, Outlier, yearlyDetails } from '../utils/budgetGroups';
import { CHART } from '../utils/palette';
const fmt = (v: number) => `₪${Math.round(v || 0).toLocaleString('en-US')}`;
const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const Dot: React.FC<{ color?: string }> = ({ color }) => (
  <span className="inline-block w-2 h-2 rounded-full ml-2 shrink-0" style={{ background: color ?? CHART.neutral }} />
);

const PAGE = 12;

/** A row that opens into the lines behind it, PAGE at a time. */
const ExpandRow: React.FC<{ label: string; amount: number; color?: string; note?: string; details: Detail[] }> = ({ label, amount, color, note, details }) => {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const canOpen = details.length > 0 || !!note;
  return (
    <div className="border-t border-slate-100" data-comment-row={label}>
      {/* A div, not a <button>: browsers won't select text inside a button, and
          the title must be selectable for inline comments. A click that ends a
          text selection doesn't toggle. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => canOpen && !window.getSelection()?.toString() && setOpen(!open)}
        onKeyDown={(e) => { if (canOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(!open); } }}
        className={`w-full flex items-center justify-between gap-3 py-1.5 text-right text-slate-600 ${canOpen ? 'cursor-pointer hover:text-slate-800' : 'cursor-default'}`}
      >
        <span className="flex items-center min-w-0">
          <ChevronLeft size={12} className={`shrink-0 ml-1 text-slate-300 transition-transform ${open ? '-rotate-90' : ''} ${canOpen ? '' : 'invisible'}`} />
          <Dot color={color} />
          <span className="truncate">{label}</span>
        </span>
        <span className="tabular-nums shrink-0">{fmt(amount)}</span>
      </div>
      {open && (
        <div className="pr-8 pb-2 text-[11px] text-slate-500 space-y-0.5">
          {note && <div className="text-slate-400">{note}</div>}
          {details.slice(0, shown).map((d, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="truncate">{d.label}{d.note && <span className="text-slate-400"> · {d.note}</span>}</span>
              <span className="tabular-nums shrink-0">{fmt(d.amount)}</span>
            </div>
          ))}
          {details.length > shown && (
            <button type="button" onClick={() => setShown(shown + PAGE)} className="text-blue-600 hover:text-blue-700 font-bold pt-1">
              טען עוד ({details.length - shown} נוספים, {fmt(details.slice(shown).reduce((s, d) => s + d.amount, 0))})
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export interface BudgetTabProps {
  year: number;
  currentYm: string;
  income: number;
  spend: number;          // this year's monthly average (actual so far + budget)
  savingNet: number;      // income − spend
  studyFund: number;      // hishtalmut deposits per month (tax-free — saving)
  pension: number;        // pension deposits per month
  normalMonth: number;    // monthly lines + recurring yearly spread
  yearlySpread: number;
  restOfYearMonthly: number;
  outliers: { items: Outlier[]; total: number };
  yearTotal: number;
  monthlyExpenses: Expense[];
  yearlyExpenses: Expense[];
  privacy: boolean;
}

export const BudgetTab: React.FC<BudgetTabProps> = (p) => {
  const saving = p.savingNet + p.studyFund;
  const savingTotal = saving + p.pension;
  const groups = baselineGroups(p.monthlyExpenses);
  const withoutOutliers = (p.yearTotal - p.outliers.total) / 12;
  const upcoming = (p.yearlyExpenses || [])
    .filter((e) => e.plannedYm && e.plannedYm >= p.currentYm)
    .sort((a, b) => (a.plannedYm! < b.plannedYm! ? -1 : 1));
  const sens = p.privacy ? 'sensitive' : '';
  const card = 'bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-slate-100 text-right';

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-12 text-right">
      <div className={`${card} grid grid-cols-3 gap-2 text-center`}>
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">הכנסה חודשית נטו</div>
          <div className={`font-black text-slate-700 ${sens}`}>{fmt(p.income)}</div>
        </div>
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">הוצאה לחודש ({p.year})</div>
          <div className="font-black text-slate-700">{fmt(p.spend)}</div>
        </div>
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">חיסכון לחודש</div>
          <div className={`font-black ${saving >= 0 ? 'text-emerald-700' : 'text-rose-600'} ${sens}`}>{fmt(saving)}</div>
          <div className={`text-[9px] text-slate-400 ${sens}`}>{fmt(p.savingNet)} מהנטו + {fmt(p.studyFund)} השתלמות</div>
        </div>
        <div className={`col-span-3 border-t border-slate-100 pt-2 mt-1 ${sens}`}>
          <span className="text-sm text-slate-500">סה״כ חיסכון לחודש, כולל פנסיה: </span>
          <span className="text-lg font-black text-emerald-700">{fmt(savingTotal)}</span>
          <div className="text-[10px] text-slate-400">{fmt(saving)} חיסכון + {fmt(p.pension)} פנסיה. השתלמות פטורה ממס, אז היא חיסכון לכל דבר.</div>
        </div>
      </div>

      <div className={`${card} grid grid-cols-1 md:grid-cols-2 gap-8 text-[12px] ${sens}`}>
        <div>
          <h3 className="font-black text-slate-800 text-sm">חודש רגיל: {fmt(p.normalMonth)}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-2">מה שיוצא כל חודש — הבסיס. לחיצה על שורה פותחת אותה.</p>
          {groups.map((g) => (
            <ExpandRow key={g.group} label={g.group} amount={g.amount} color={GROUP_COLOR[g.group]} details={g.details} />
          ))}
          <ExpandRow label="הוצאות שנתיות, מפוזר על 12" amount={p.yearlySpread} details={yearlyDetails(p.yearlyExpenses)} />
          <p className="text-[11px] text-slate-400 mt-2">עד סוף {p.year}: {fmt(p.restOfYearMonthly)} לחודש — השנתיות של {p.year} כבר שולמו.</p>
        </div>
        <div>
          <h3 className="font-black text-slate-800 text-sm">מה הקפיץ את {p.year}: {fmt(p.outliers.total)}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-2">חריגים — לא חלק מהחודש הרגיל.</p>
          {p.outliers.items.map((o) => (
            <ExpandRow key={o.label} label={o.label} amount={o.amount} color={GROUP_COLOR[o.group]} note={o.note} details={o.details} />
          ))}
          <p className="text-[11px] text-slate-400 mt-2">
            ממוצע {p.year}: {fmt(p.spend)} לחודש; בלי החריגים {fmt(withoutOutliers)}.
            {withoutOutliers < p.normalMonth && ' פחות מחודש רגיל כי שכ״ד עלה והמאמן התחיל באוגוסט, הגן והמנקה השבועית רק מספטמבר, ובזמן טיול המלחמה כמעט לא הוצאנו בארץ.'}
          </p>
        </div>
      </div>

      <div className={`${card} text-[12px] ${sens}`}>
        <h3 className="font-black text-slate-800 text-sm">הוצאות עתידיות ידועות</h3>
        <p className="text-[11px] text-slate-400 mt-0.5 mb-2">חד-פעמיות שכבר יודעים שיגיעו — מעבר לחודש הרגיל.</p>
        {upcoming.length === 0 && <div className="text-slate-400 border-t border-slate-100 py-1.5">אין כרגע.</div>}
        {upcoming.map((e) => (
          <div key={e.id} className="flex justify-between gap-3 border-t border-slate-100 py-1.5 text-slate-600">
            <span>{e.name} <span className="text-slate-400">· {HEB_MONTHS[parseInt(e.plannedYm!.slice(5, 7), 10) - 1]} {e.plannedYm!.slice(0, 4)}</span></span>
            <span className="tabular-nums">{fmt(parseFloat(String(e.amount)) || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
