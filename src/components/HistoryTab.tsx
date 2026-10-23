import { SERIES, LINEAR } from '../utils/palette';
import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Calendar, TrendingUp, TrendingDown, Sparkles,
} from 'lucide-react';
import {
  historicalYears,
  historyCategoryOrder,
  type HistoryYear,
} from '../data/history';

const formatIls = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `₪${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `₪${Math.round(n / 1000)}K`;
  return `₪${Math.round(n).toLocaleString('en-US')}`;
};

const formatCompactIls = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `₪${Math.round(n / 1000)}K`;
  return `₪${Math.round(n)}`;
};

function buildStackedRows(years: HistoryYear[]) {
  return years.map((y) => {
    const row: Record<string, number | string> = { year: y.year };
    for (const cat of historyCategoryOrder) {
      row[cat] = Math.round(y.categories[cat] ?? 0);
    }
    return row;
  });
}

const CATEGORY_COLORS = [...SERIES];

const colorFor = (cat: string): string => {
  const idx = historyCategoryOrder.indexOf(cat);
  if (idx < 0) return LINEAR.inkSubtle;
  return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
};

type ViewMode = 'absolute' | 'share';

const HistoryTab: React.FC = () => {
  const [mode, setMode] = useState<ViewMode>('absolute');

  const rows = useMemo(() => buildStackedRows(historicalYears), []);

  const shareRows = useMemo(() => rows.map((r) => {
    const total = historyCategoryOrder.reduce(
      (sum, cat) => sum + (Number(r[cat]) || 0),
      0,
    );
    const out: Record<string, number | string> = { year: r.year };
    for (const cat of historyCategoryOrder) {
      out[cat] = total > 0 ? +(((Number(r[cat]) || 0) / total) * 100).toFixed(1) : 0;
    }
    return out;
  }), [rows]);

  // --- Net worth series (primary chart) -------------------------------
  const netWorthRows = useMemo(() => {
    return historicalYears
      .filter((y) => y.netWorth !== null)
      .map((y) => ({
        year: y.year,
        netWorth: y.netWorth ?? 0,
        liquid: y.liquid ?? 0,
        // Split pension into two columns so we can render the "estimated"
        // portion with a distinct striped pattern without touching the stack.
        pension: y.pensionEstimated ? 0 : (y.pension ?? 0),
        pensionEst: y.pensionEstimated ? (y.pension ?? 0) : 0,
        property: y.property ?? 0,
        yoy: 0, // filled in below
        interpolated: !!y.netWorthInterpolated,
        pensionEstimated: !!y.pensionEstimated,
        pensionTotal: y.pension ?? 0,
      }));
  }, []);

  // Year-over-year absolute delta (for the tooltip badge).
  for (let i = 1; i < netWorthRows.length; i += 1) {
    netWorthRows[i].yoy = netWorthRows[i].netWorth - netWorthRows[i - 1].netWorth;
  }

  // First year where pension was measured directly (not estimated).
  // Used to draw a reference line on the chart.
  const firstMeasuredPensionYear = netWorthRows
    .find((r) => !r.pensionEstimated && r.pensionTotal > 0)?.year;

  const netWorthSummary = useMemo(() => {
    if (netWorthRows.length < 2) return null;
    const first = netWorthRows[0];
    const last = netWorthRows[netWorthRows.length - 1];
    const growth = last.netWorth / first.netWorth;
    const years = last.year - first.year;
    const cagr = years > 0 ? (Math.pow(growth, 1 / years) - 1) * 100 : 0;
    return {
      first, last, growth, years, cagr,
      absoluteGrowth: last.netWorth - first.netWorth,
    };
  }, [netWorthRows]);

  // --- Income / expenses / savings series -----------------------------
  const incomeExpense = useMemo(() => historicalYears.map((y) => ({
    year: y.year,
    income: Math.round(y.yearlyIncome ?? 0),
    expenses: Math.round(y.yearlyExpenses ?? 0),
    savings: Math.round((y.yearlyIncome ?? 0) - (y.yearlyExpenses ?? 0)),
    savingsRate: y.yearlyIncome
      ? Math.round(((y.yearlyIncome - y.yearlyExpenses) / y.yearlyIncome) * 100)
      : 0,
  })), []);

  const summary = useMemo(() => {
    const totalIncome = historicalYears.reduce((s, y) => s + (y.yearlyIncome ?? 0), 0);
    const totalExpenses = historicalYears.reduce((s, y) => s + y.yearlyExpenses, 0);
    const totalSavings = totalIncome - totalExpenses;
    const avgExpenses = totalExpenses / historicalYears.length;
    const biggestCats: Record<string, number> = {};
    for (const y of historicalYears) {
      for (const [cat, amt] of Object.entries(y.categories)) {
        biggestCats[cat] = (biggestCats[cat] ?? 0) + amt;
      }
    }
    const [topCat, topCatTotal] = Object.entries(biggestCats).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    return {
      yearsSpan: `${historicalYears[0].year}–${historicalYears[historicalYears.length - 1].year}`,
      totalIncome, totalExpenses, totalSavings,
      savingsRate: totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0,
      avgExpenses,
      topCat, topCatTotal,
    };
  }, []);

  const stackedData = mode === 'absolute' ? rows : shareRows;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12 text-right">
      {/* Summary cards — net worth now leads */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-right">
        {netWorthSummary && (
          <SummaryCard
            icon={<Sparkles className="text-emerald-500" size={18} />}
            label="שווי נקי היום"
            value={formatIls(netWorthSummary.last.netWorth)}
            hint={`×${netWorthSummary.growth.toFixed(1)} מאז ${netWorthSummary.first.year} · ${netWorthSummary.cagr.toFixed(1)}% CAGR`}
            accent="emerald"
          />
        )}
        <SummaryCard
          icon={<Calendar className="text-slate-500" size={18} />}
          label="טווח שנים"
          value={summary.yearsSpan}
          hint={`${historicalYears.length} שנות מעקב`}
        />
        <SummaryCard
          icon={<TrendingUp className="text-emerald-500" size={18} />}
          label="סה״כ הכנסות"
          value={formatIls(summary.totalIncome)}
          hint={`שיעור חיסכון ממוצע ${Math.round(summary.savingsRate)}%`}
          accent="emerald"
        />
        <SummaryCard
          icon={<TrendingDown className="text-rose-500" size={18} />}
          label="ממוצע הוצאות שנתי"
          value={formatIls(summary.avgExpenses)}
          hint={`סה״כ הוצאות: ${formatIls(summary.totalExpenses)}`}
          accent="rose"
        />
      </div>

      {/* HERO: Net worth over the years (primary focus) */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="flex justify-between items-start mb-2 gap-4 flex-wrap">
          <div>
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Sparkles className="text-emerald-500" size={18} /> שווי נקי לאורך השנים
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
              תמונת מצב של תחילת כל שנה (1 בינואר). שכבות: <span className="font-black text-blue-600">נזיל</span> (השקעות, מזומן, קרן השתלמות),{' '}
              <span className="font-black text-violet-600">פנסיה</span>, <span className="font-black text-indigo-500">דירה</span>.
              2018–2022 כולל רק את הנכסים הנזילים שלך; 2023+ כולל את המשפחה.
              אזור <span className="font-black text-violet-600">פנסיה</span> המשורטט בקווקווים הוא הערכה רטרוגרדית (מבוססת על היתרה הידועה ב-2026 ותרומות צפויות).
            </p>
          </div>
          {netWorthSummary && (
            <div className="flex gap-2 flex-wrap items-end">
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-2">
                <div className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">צמיחה</div>
                <div className="text-2xl font-black text-emerald-700">
                  +{formatIls(netWorthSummary.absoluteGrowth)}
                </div>
                <div className="text-[10px] text-emerald-500 font-bold mt-0.5">
                  ב-{netWorthSummary.years} שנים · ×{netWorthSummary.growth.toFixed(1)}
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2">
                <div className="text-[10px] text-blue-600 font-black uppercase tracking-widest">CAGR</div>
                <div className="text-2xl font-black text-blue-700">
                  {netWorthSummary.cagr.toFixed(1)}%
                </div>
                <div className="text-[10px] text-blue-500 font-bold mt-0.5">
                  ריבית דריבית שנתית
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-[420px] mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netWorthRows} margin={{ top: 20, right: 28, left: 12, bottom: 10 }}>
              <defs>
                <linearGradient id="gradNWLiquid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={LINEAR.primary} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={LINEAR.primary} stopOpacity={0.2} />
                </linearGradient>
                <linearGradient id="gradNWPension" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8a80a0" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#8a80a0" stopOpacity={0.15} />
                </linearGradient>
                <linearGradient id="gradNWProperty" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6e7494" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#6e7494" stopOpacity={0.1} />
                </linearGradient>
                {/* Diagonal stripes for the estimated pension portion */}
                <pattern
                  id="patNWPensionEst"
                  patternUnits="userSpaceOnUse"
                  width="8"
                  height="8"
                  patternTransform="rotate(45)"
                >
                  <rect width="8" height="8" fill="#f5f3ff" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#8a80a0" strokeWidth="2" strokeOpacity="0.55" />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="year"
                stroke="#94a3b8"
                fontSize={12}
                tick={{ fontWeight: 700 }}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickFormatter={(v) => formatCompactIls(v)}
                width={72}
              />
              <Tooltip content={<NetWorthTooltip />} />
              {/* Mark family-scope transition so the user doesn't misread the jump */}
              <ReferenceLine
                x={2023}
                stroke="#cbd5e1"
                strokeDasharray="4 4"
                label={{
                  value: 'נכסי משפחה נכללים',
                  fill: '#64748b', fontSize: 10, fontWeight: 700,
                  position: 'insideTopRight',
                }}
              />
              {/* Mark the first year the pension is measured directly */}
              {firstMeasuredPensionYear !== undefined && (
                <ReferenceLine
                  x={firstMeasuredPensionYear}
                  stroke="#8a80a0"
                  strokeOpacity={0.6}
                  strokeDasharray="2 3"
                  label={{
                    value: 'פנסיה נמדדה ✓',
                    fill: '#7a7490', fontSize: 10, fontWeight: 800,
                    position: 'insideBottomRight',
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="liquid"
                name="נזיל"
                stackId="nw"
                stroke="#6d7c94"
                strokeWidth={2}
                fill="url(#gradNWLiquid)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="pensionEst"
                name="פנסיה (הערכה)"
                stackId="nw"
                stroke="#8a80a0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="url(#patNWPensionEst)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="pension"
                name="פנסיה (נמדדה)"
                stackId="nw"
                stroke="#8a80a0"
                strokeWidth={2}
                fill="url(#gradNWPension)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="property"
                name="דירה"
                stackId="nw"
                stroke="#6e7494"
                strokeWidth={2}
                strokeDasharray="4 4"
                fill="url(#gradNWProperty)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Per-year deltas strip */}
        <div className="mt-6 pt-4 border-t border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
            שינוי שנתי בשווי נקי
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {netWorthRows.map((r, i) => {
              const prev = i > 0 ? netWorthRows[i - 1].netWorth : r.netWorth;
              const pct = prev > 0 ? ((r.netWorth - prev) / prev) * 100 : 0;
              const up = pct >= 0;
              return (
                <div
                  key={r.year}
                  className="flex-none min-w-[108px] p-3 bg-slate-50 border border-slate-100 rounded-2xl"
                >
                  <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                    1.1.{r.year}
                  </div>
                  <div className="text-sm font-black text-slate-800 mt-0.5">
                    {formatCompactIls(r.netWorth)}
                  </div>
                  {i > 0 && (
                    <div className={`text-[11px] font-black mt-0.5 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Secondary: income vs expenses */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 text-right">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-lg font-black text-slate-800">הכנסות, הוצאות וחיסכון שנתי</h3>
            <p className="text-xs text-slate-400 font-medium mt-1">
              מתוך קבצי Annual Expenses בגוגל דרייב. חיסכון = הכנסה שנתית − הוצאה שנתית.
            </p>
          </div>
        </div>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={incomeExpense} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" fontSize={12} />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickFormatter={(v) => formatCompactIls(v)}
              />
              <Tooltip content={<IncomeExpenseTooltip />} />
              <Legend
                verticalAlign="top"
                height={32}
                iconType="circle"
                formatter={(v) => (
                  <span className="text-[11px] font-bold text-slate-600">{v}</span>
                )}
              />
              <Bar dataKey="income" name="הכנסות" fill="#6d907c" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expenses" name="הוצאות" fill="#b08088" radius={[6, 6, 0, 0]} />
              <Line
                type="monotone"
                dataKey="savings"
                name="חיסכון"
                stroke="#6e7494"
                strokeWidth={3}
                dot={{ r: 5, strokeWidth: 2, fill: '#fff' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stacked expenses */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 text-right">
        <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-black text-slate-800">הוצאות לפי קטגוריה</h3>
            <p className="text-xs text-slate-400 font-medium mt-1">
              קיבוץ ההוצאות החודשיות (×12) והוצאות שנתיות לכל שנה לפי קטגוריה.
            </p>
          </div>
          <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200 text-[11px] font-bold">
            <button
              onClick={() => setMode('absolute')}
              className={`px-4 py-1 rounded-xl transition-all ${mode === 'absolute' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >
              ₪ בפועל
            </button>
            <button
              onClick={() => setMode('share')}
              className={`px-4 py-1 rounded-xl transition-all ${mode === 'share' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >
              % מההוצאה
            </button>
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stackedData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" fontSize={12} />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickFormatter={(v) => mode === 'share' ? `${v}%` : formatCompactIls(v)}
                domain={mode === 'share' ? [0, 100] : [0, 'auto']}
              />
              <Tooltip content={<CategoryTooltip mode={mode} />} />
              <Legend
                verticalAlign="bottom"
                wrapperStyle={{ paddingTop: 16 }}
                iconType="square"
                formatter={(v) => (
                  <span className="text-[10px] font-bold text-slate-500 mx-1">{v}</span>
                )}
              />
              {historyCategoryOrder.map((cat) => (
                <Bar
                  key={cat}
                  dataKey={cat}
                  stackId="expenses"
                  fill={colorFor(cat)}
                  name={cat}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-year detail table */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 text-right overflow-x-auto">
        <h3 className="text-lg font-black text-slate-800 mb-4">פירוט לפי שנה</h3>
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b-2 border-slate-100 text-[10px] uppercase text-slate-400 font-black tracking-widest">
              <th className="p-3 text-right">שנה</th>
              <th className="p-3 text-left">שווי נקי (1.1)</th>
              <th className="p-3 text-left">הכנסה</th>
              <th className="p-3 text-left">הוצאות</th>
              <th className="p-3 text-left">חיסכון</th>
              <th className="p-3 text-left">% חיסכון</th>
              <th className="p-3 text-right">קטגוריה מובילה</th>
            </tr>
          </thead>
          <tbody>
            {historicalYears.map((y) => {
              const topCat = Object.entries(y.categories).sort((a, b) => b[1] - a[1])[0];
              const savings = (y.yearlyIncome ?? 0) - y.yearlyExpenses;
              const savingsRate = y.yearlyIncome
                ? (savings / y.yearlyIncome) * 100
                : 0;
              return (
                <tr key={y.year} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-black text-slate-700">{y.year}</td>
                  <td className="p-3 text-left font-bold text-emerald-700">
                    {y.netWorth !== null ? formatIls(y.netWorth) : '—'}
                  </td>
                  <td className="p-3 text-left font-bold text-emerald-600">
                    {y.yearlyIncome !== null ? formatIls(y.yearlyIncome) : '—'}
                  </td>
                  <td className="p-3 text-left font-bold text-rose-600">{formatIls(y.yearlyExpenses)}</td>
                  <td className={`p-3 text-left font-bold ${savings >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>
                    {formatIls(savings)}
                  </td>
                  <td className={`p-3 text-left font-bold ${savingsRate >= 40 ? 'text-emerald-600' : savingsRate >= 20 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {Math.round(savingsRate)}%
                  </td>
                  <td className="p-3 text-slate-500 font-bold text-xs">
                    {topCat ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: colorFor(topCat[0]) }}
                        />
                        {topCat[0]} · {formatIls(topCat[1])}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- helpers -----------------------------------------------------------

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  accent?: 'emerald' | 'rose' | 'indigo';
}

const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value, hint, accent }) => {
  const accents = {
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    indigo: 'text-indigo-600',
  };
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 text-right">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-black mt-2 ${accent ? accents[accent] : 'text-slate-800'}`}>{value}</div>
      <div className="text-[11px] text-slate-400 font-medium mt-1">{hint}</div>
    </div>
  );
};

const NetWorthTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as {
    year: number; netWorth: number; liquid: number;
    pension: number; pensionEst: number; pensionTotal: number;
    property: number; yoy: number; interpolated: boolean;
    pensionEstimated: boolean;
  };
  const pensionShown = row.pensionTotal ?? (row.pension + row.pensionEst);
  return (
    <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100 text-right min-w-[250px]">
      <div className="flex justify-between items-baseline border-b pb-1 mb-2">
        <span className="font-black text-slate-800 text-lg">1.1.{label}</span>
        <span className="text-[10px] font-bold text-slate-400">תמונת מצב</span>
      </div>
      {row.interpolated && (
        <div className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mb-2">
          ערך משוער – אין תמונת מצב ישירה בגיליון
        </div>
      )}
      {row.pensionEstimated && (
        <div className="text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-2 py-1 mb-2">
          פנסיה מחושבת לאחור ממודל (לא נרשמה בגיליון השנה ההיא)
        </div>
      )}
      <div className="space-y-1 text-xs">
        {row.liquid > 0 && (
          <Row color="#6d7c94" name="נזיל + קרן השתלמות" value={formatIls(row.liquid)} />
        )}
        {pensionShown > 0 && (
          <Row
            color="#8a80a0"
            name={row.pensionEstimated ? 'פנסיה ★ הערכה' : 'פנסיה'}
            value={formatIls(pensionShown)}
          />
        )}
        {row.property > 0 && (
          <Row color="#6e7494" name="דירה" value={formatIls(row.property)} />
        )}
        <div className="border-t pt-2 mt-1">
          <Row color="#6d907c" name="סך הכל" value={formatIls(row.netWorth)} bold />
        </div>
        {row.yoy !== 0 && (
          <div className="pt-1">
            <Row
              color={row.yoy > 0 ? '#6d907c' : '#b08088'}
              name={row.yoy > 0 ? 'גדל בשנה החולפת' : 'ירד בשנה החולפת'}
              value={`${row.yoy > 0 ? '+' : ''}${formatIls(row.yoy)}`}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const IncomeExpenseTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const savingsRate = row.income > 0 ? Math.round((row.savings / row.income) * 100) : 0;
  return (
    <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100 text-right min-w-[220px]">
      <p className="font-black text-slate-800 mb-2 border-b pb-1">{label}</p>
      <div className="space-y-1 text-xs">
        <Row color="#6d907c" name="הכנסה" value={formatIls(row.income)} />
        <Row color="#b08088" name="הוצאה" value={formatIls(row.expenses)} />
        <div className="border-t pt-1 mt-1">
          <Row color="#6e7494" name="חיסכון" value={formatIls(row.savings)} bold />
          <Row color="#6e7494" name="שיעור חיסכון" value={`${savingsRate}%`} />
        </div>
      </div>
    </div>
  );
};

const CategoryTooltip: React.FC<any> = ({ active, payload, label, mode }) => {
  if (!active || !payload?.length) return null;
  const entries = [...payload]
    .filter((p) => (p.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = entries.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100 text-right min-w-[220px]">
      <div className="flex justify-between items-center mb-2 border-b pb-1">
        <span className="font-black text-slate-800">{label}</span>
        <span className="text-[10px] font-bold text-slate-400">
          {mode === 'share' ? `${Math.round(total)}%` : formatIls(total)}
        </span>
      </div>
      <div className="space-y-1 text-xs max-h-60 overflow-auto">
        {entries.map((p) => (
          <Row
            key={p.dataKey}
            color={p.color}
            name={p.name as string}
            value={mode === 'share' ? `${p.value}%` : formatIls(p.value ?? 0)}
          />
        ))}
      </div>
    </div>
  );
};

const Row: React.FC<{ color: string; name: string; value: string; bold?: boolean }> = ({ color, name, value, bold }) => (
  <div className="flex justify-between items-center gap-6">
    <span className={`inline-flex items-center gap-2 ${bold ? 'font-black text-slate-800' : 'text-slate-600'}`}>
      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
      {name}
    </span>
    <span className={`${bold ? 'font-black' : 'font-bold'} text-left`}>{value}</span>
  </div>
);

export default HistoryTab;
