import React from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import actualsData from '../data/actuals.json';
import { Asset } from '../types';
import { CHART, LINEAR } from '../utils/palette';
import { LIQUID_GAIN_TAX_RATE } from '../utils/calculations';
import {
  BalancePoint, backfillMonthEnds, balanceTotal, monthlyBalanceSplits, splitBalanceChange, splittablePoints,
} from '../utils/viewMath';

const ACT: any = actualsData;
const MONTHS_HE = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const fmtK = (n: number) => `₪${Math.round((n || 0) / 1000).toLocaleString('en-US')}k`;
const fmtM = (n: number) => `₪${(n / 1_000_000).toFixed(2)}M`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}₪${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const dayLabel = (d: string) => `${parseInt(d.slice(8, 10), 10)}.${parseInt(d.slice(5, 7), 10)}`;
const DOWN = '#d8607a';
const MARKET = LINEAR.success;
const DEPOSIT = LINEAR.primary;
// The assets the daily refresh tracks (prisha_actuals BAL_PEN/BAL_HISH/BAL_INV).
// The rest (the Rishon property, the kids' savings) hold a fixed value and are
// added flat, so the total matches the net worth while the market/deposit split
// stays about the tracked ones only.
const TRACKED_ASSET_IDS = [1, 2, 3, 4, 5, 6];

/**
 * "היתרות שלנו השנה" — the balance over the year, and how much of each move
 * was the market versus money we put in.
 *
 * The chart draws the balance next to a "no market" line (start + deposits
 * only); the gap between the two is what the market did. Brokerage deposits
 * are exact (Ordernet cost basis); pension/hishtalmut deposits are estimated
 * from the salary contributions — see viewMath.splitBalanceChange.
 */
export const BalancesCard: React.FC<{
  monthlyPensionIn: number;
  monthlyStudyIn: number;
  assets: Asset[];
}> = ({ monthlyPensionIn, monthlyStudyIn, assets }) => {
  const fixedAssets = assets.filter((a) => !TRACKED_ASSET_IDS.includes(a.id) && a.value > 0);
  const fixed = fixedAssets.reduce((s, a) => s + a.value, 0);
  const tracked: BalancePoint[] = ACT.balances || [];
  // Money into / out of the brokerage accounts, from the Meitav history.
  const events: Array<{ d: string; amount: number; label: string; account?: string }> = ACT.balance_events || [];
  const year: number = ACT.yearly?.year || new Date().getFullYear();
  const monthEnds = ACT.balance_month_ends || { inv: [], sp500_ils: [] };

  const model = React.useMemo(() => {
    // Month-ends before daily tracking (Meitav statements + a pension estimate);
    // Dec 31 is the year's opening balance.
    const back = backfillMonthEnds(tracked, monthEnds.inv, monthEnds.sp500_ils, events, monthlyPensionIn, monthlyStudyIn)
      .map((p) => (p.d === `${year - 1}-12-31` ? { ...p, d: `${year}-01-01` } : p));
    const points = [...back, ...tracked];
    const split = splittablePoints(points);
    if (split.length < 2) return null;
    const first = split[0];
    const last = split[split.length - 1];
    const firstTracked = tracked.find((p) => p.inv_gain != null) ?? tracked[0];
    const whole = splitBalanceChange(first, last, monthlyPensionIn, monthlyStudyIn, LIQUID_GAIN_TAX_RATE);
    const start = balanceTotal(first) + fixed;

    const rows = split.map((p) => {
      const total = balanceTotal(p) + fixed;
      return {
        t: Date.parse(p.d),
        d: p.d,
        // Month-end estimates draw dashed, joined to the first tracked day.
        early: back.includes(p) || p === firstTracked ? total : null,
        total: back.includes(p) ? null : total,
        noMarket: start + splitBalanceChange(first, p, monthlyPensionIn, monthlyStudyIn, LIQUID_GAIN_TAX_RATE).deposits,
      };
    });

    const monthly = monthlyBalanceSplits(split, monthlyPensionIn, monthlyStudyIn, LIQUID_GAIN_TAX_RATE).map((m) => ({
      label: MONTHS_HE[parseInt(m.ym.slice(5, 7), 10) - 1],
      market: Math.round(m.market),
      deposits: Math.round(m.deposits),
      marketLiquidNet: Math.round(m.marketLiquidNet),
    }));

    const liquidGross = last.inv + last.hish;
    const liquidNet = last.inv - LIQUID_GAIN_TAX_RATE * (last.inv_gain ?? 0) + last.hish;
    const invBefore = events.filter((e) => e.d <= firstTracked.d).reduce((s, e) => s + e.amount, 0);
    return { first, last, whole, rows, monthly, liquidGross, liquidNet, back, firstTracked, invBefore, start };
  }, [tracked, events, monthEnds, monthlyPensionIn, monthlyStudyIn, year, fixed]);

  if (!model) return null;
  const { first, last, whole, rows, monthly, liquidGross, liquidNet, back, firstTracked, invBefore, start: startTotal } = model;
  const since = dayLabel(first.d);
  // Brokerage cash in: rows labeled as an exit, versus everything else
  // (transfers from the bank).
  const yearEvents = events.filter((e) => e.d >= `${year}-01-01`);
  const fromExits = yearEvents.filter((e) => e.label.includes('אקזיט'));
  const fromSalary = yearEvents.filter((e) => !e.label.includes('אקזיט')).reduce((s, e) => s + e.amount, 0);

  const monthTicks: number[] = [];
  for (let m = 0; m < 12; m++) {
    const t = Date.parse(`${year}-${String(m + 1).padStart(2, '0')}-01`);
    if (t >= (rows[0].t as number) && t <= (rows[rows.length - 1].t as number)) monthTicks.push(t);
  }

  return (
    <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 mt-4">
      <div className="mb-3">
        <h3 className="font-black text-slate-800 text-sm">היתרות שלנו השנה</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">
          תיקי השקעות, קרנות השתלמות ופנסיה{fixedAssets.length > 0 && <>, ועוד {fixedAssets.map((a) => `${a.name} ${fmtK(a.value)}`).join(' ו')} (שווי קבוע)</>}. מעקב יומי מאז {dayLabel(firstTracked.d)}{back.length > 0 ? '; לפני כן סוף כל חודש' : ''}.
          כסף שנכנס ויצא מהתיקים — מדויק, מהיסטוריית התנועות במיטב.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4 text-center">
        <div className="p-3 bg-slate-50 rounded-2xl sensitive">
          <div className="text-[10px] text-slate-400 font-bold">שינוי מאז {since}</div>
          <div className={`font-black ${whole.total >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signed(whole.total)}</div>
          <div className="text-[9px] text-slate-400">{fmtM(startTotal)} → {fmtM(balanceTotal(last) + fixed)}</div>
        </div>
        <div className="p-3 bg-emerald-50 rounded-2xl sensitive">
          <div className="text-[10px] text-slate-400 font-bold">מהשוק</div>
          <div className={`font-black ${whole.market >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signed(whole.market)}</div>
          <div className="text-[9px] text-slate-400">
            נזיל {signed(whole.marketLiquid)} · פנסיה ~{signed(whole.marketPension)}
          </div>
        </div>
        <div className="p-3 bg-emerald-50 rounded-2xl sensitive">
          <div className="text-[10px] text-slate-400 font-bold">רווח השוק הנזיל, נטו אחרי מס</div>
          <div className={`font-black ${whole.marketLiquidNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signed(whole.marketLiquidNet)}</div>
          <div className="text-[9px] text-slate-400">
            {Math.round(LIQUID_GAIN_TAX_RATE * 100)}% מס רווחי הון בתיקים · השתלמות פטורה · פנסיה נעולה
          </div>
        </div>
        <div className="p-3 bg-blue-50 rounded-2xl sensitive">
          <div className="text-[10px] text-slate-400 font-bold">כסף שהוספנו</div>
          <div className="font-black text-blue-700">{signed(whole.deposits)}</div>
          <div className="text-[9px] text-slate-400">לתיקים במיטב {signed(whole.depositsInv)}:</div>
          {fromExits.map((e) => (
            <div key={e.d + e.label} className="text-[9px] text-slate-400">{e.label} {signed(e.amount)}</div>
          ))}
          <div className="text-[9px] text-slate-400">חיסכון מהמשכורת {signed(fromSalary)}</div>
          <div className="text-[9px] text-slate-400">הפקדות לפנסיה+השתלמות (הערכה) ~{signed(whole.depositsLocked)}</div>
        </div>
      </div>

      <div className="sensitive" style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="t" type="number" scale="time" reversed
              domain={['dataMin', 'dataMax']} ticks={monthTicks}
              tickFormatter={(t) => MONTHS_HE[new Date(t).getMonth()]}
              tick={{ fontSize: 11, fill: CHART.axis }}
            />
            <YAxis
              orientation="right" width={56} tickFormatter={fmtM}
              domain={[(min: number) => Math.floor(min / 100_000) * 100_000, (max: number) => Math.ceil(max / 100_000) * 100_000]}
              tick={{ fontSize: 11, fill: CHART.axis }}
            />
            <Tooltip
              labelFormatter={(t) => dayLabel(new Date(t as number).toISOString().slice(0, 10))}
              formatter={(v: any, n: any) => [fmtM(v as number), n]}
              contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 12 }}
            />
            {/* Before daily tracking: month-end points only. */}
            {back.length > 0 && (
              <ReferenceArea
                x1={rows[0].t as number} x2={Date.parse(firstTracked.d)}
                fill={CHART.neutral} fillOpacity={0.06} strokeOpacity={0}
                label={{ value: `${since}–${dayLabel(firstTracked.d)}: סוף חודש`, position: 'insideTop', fontSize: 10, fill: CHART.axis }}
              />
            )}
            {events.map((e, i) => (
              <ReferenceLine
                key={`${e.d}-${i}`} x={Date.parse(e.d)} stroke={e.amount >= 0 ? DEPOSIT : DOWN} strokeDasharray="2 3"
                label={Math.abs(e.amount) >= 50_000
                  ? { value: `${e.label} ${signed(e.amount)}`, position: 'insideBottomLeft', fontSize: 10, fill: DEPOSIT }
                  : undefined}
              />
            ))}
            <Line dataKey="early" name="יתרה (סוף חודש)" stroke={CHART.actual} strokeWidth={1.5} strokeDasharray="3 4" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            <Line dataKey="total" name="יתרה" stroke={CHART.actual} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="noMarket" name="בלי תנודות השוק" stroke={CHART.target} strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end mt-1 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-[3px] rounded" style={{ background: CHART.actual }} />יתרה</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: CHART.target }} />בלי תנודות השוק (רק ההפקדות) — הפער = השוק</span>
        {events.length > 0 && <span className="flex items-center gap-1"><span className="inline-block h-3 border-l border-dashed" style={{ borderColor: DEPOSIT }} />כסף שנכנס / יצא מהתיקים</span>}
      </div>

      {(events.length > 0 || back.length > 0) && (
        <div className="mt-3 text-[11px] text-slate-500">
          <div className="font-bold mb-1">כסף שנכנס ויצא מהתיקים השנה</div>
          {back.length > 0 && invBefore === 0 && (
            <div className="text-slate-400 mb-1">{since}–{dayLabel(firstTracked.d)}: לא נכנס ולא יצא כסף מהתיקים — כל השינוי בהם היה שוק.</div>
          )}
          <div className="sensitive space-y-0.5">
            {events.map((e, i) => (
              <div key={`${e.d}-${i}`} className="flex justify-between gap-2">
                <span>{dayLabel(e.d)} · {e.label}{e.account ? ` · ${e.account}` : ''}</span>
                <span className={`font-bold ${e.amount >= 0 ? 'text-blue-700' : 'text-rose-600'}`}>{signed(e.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {monthly.length > 0 && (
        <>
          <div className="mt-5 pt-4 border-t border-slate-100 text-[11px] font-bold text-slate-500">לפי חודש: שוק מול הפקדות</div>
          <div className="sensitive" style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={monthly} stackOffset="sign" margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" reversed tick={{ fontSize: 11, fill: CHART.axis }} />
                <YAxis orientation="right" width={56} tickFormatter={fmtK} tick={{ fontSize: 11, fill: CHART.axis }} />
                <ReferenceLine y={0} stroke={CHART.axis} />
                <Tooltip
                  formatter={(v: any, n: any, item: any) =>
                    n === 'שוק'
                      ? [`${signed(v as number)} (נטו נזיל אחרי מס ${signed(item?.payload?.marketLiquidNet ?? 0)})`, n]
                      : [signed(v as number), n]}
                  contentStyle={{ direction: 'rtl', fontSize: 12, borderRadius: 12 }}
                />
                <Bar dataKey="deposits" name="הפקדות" stackId="s" fill={DEPOSIT} isAnimationActive={false} />
                <Bar dataKey="market" name="שוק" stackId="s" isAnimationActive={false}>
                  {monthly.map((m, i) => <Cell key={i} fill={m.market >= 0 ? MARKET : DOWN} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end mt-1 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: DEPOSIT }} />הפקדות</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: MARKET }} />שוק עלה</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: DOWN }} />שוק ירד</span>
          </div>
        </>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex flex-wrap justify-between gap-2">
        <span className="sensitive">אם מושכים את כל הנזיל היום: <b className="text-slate-700">{fmtM(liquidNet)}</b> נטו מתוך {fmtM(liquidGross)}</span>
        <span className="text-slate-400">הפקדות לתיקים — מדויק (תנועות מיטב). פנסיה והשתלמות מתעדכנות פעם בחודש, וההפקדות שלהן מוערכות לפי השכר{back.length > 0 ? `. עד ${dayLabel(firstTracked.d)}: התיקים לפי הדוחות החודשיים של מיטב (מדויק); פנסיה והשתלמות משוחזרות לאחור לפי תשואת S&P 500 בשקלים בכל חודש (הערכה)` : ''}.</span>
      </div>
    </div>
  );
};
