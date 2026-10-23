import React, { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceArea,
  ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowUpRight, ZoomIn } from 'lucide-react';
import type { EquityCompany } from '../utils/storage';
import { SERIES, LINEAR } from '../utils/palette';

export interface SimPoint {
  index: number;
  label: string;
  fullAge: string;
  totalLegacy: number;
  liquidWealth: number;
  investments: number;
  pension: number;
  property: number;
  monthlyOutflow: number;
  monthlySavings: number;
  pensionContribution: number;
  studyFundContribution: number;
  currentIncome: number;
  incomeSource: string;
  event: string | null;
  withdrawalFromInvestments: number;
  withdrawalFromPension: number;
  pensionAnnuity: number;
  taxPaid: number;
}

interface SimulationChartProps {
  data: SimPoint[];
  initialAge: number;
  baseYear: number;
  transitionToHalfWorkYear: number;
  stopWorkYear: number;
  equityCompanies: EquityCompany[];
  propertyYear?: number;
  propertyEnabled: boolean;
  inflationRate: number;
}

const formatShortIls = (v: number): string => {
  if (Math.abs(v) >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `₪${Math.round(v / 1000)}K`;
  return `₪${Math.round(v)}`;
};

// Short Hebrew Gregorian month names (1-indexed via [mo - 1]).
const HE_MONTH_ABBR = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

// Track viewport width so the month-tick density can back off on small screens
// (only months when there's enough room).
function useViewportWidth(): number {
  const [w, setW] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

type ValueMode = 'nominal' | 'real';

const SimulationChart: React.FC<SimulationChartProps> = ({
  data,
  initialAge,
  baseYear,
  transitionToHalfWorkYear,
  stopWorkYear,
  equityCompanies,
  propertyYear,
  propertyEnabled,
  inflationRate,
}) => {
  const [valueMode, setValueMode] = useState<ValueMode>('real');
  const [refLeft, setRefLeft] = useState<number | null>(null);
  const [refRight, setRefRight] = useState<number | null>(null);
  const [leftIdx, setLeftIdx] = useState<number | 'dataMin'>('dataMin');
  const [rightIdx, setRightIdx] = useState<number | 'dataMax'>('dataMax');

  const endMonthIndex = data[data.length - 1]?.index ?? 0;

  // Preset zoom ranges anchored on today.
  const presetZoom = (years: number) => {
    const rightBound = Math.min(years * 12, endMonthIndex);
    setLeftIdx(0);
    setRightIdx(rightBound);
  };

  // Adjust nominal ILS values to today's money using monthly inflation.
  const monthlyInflation = Math.pow(1 + inflationRate / 100, 1 / 12);
  const adjust = (value: number, m: number): number =>
    valueMode === 'real' ? value / Math.pow(monthlyInflation, m) : value;

  const adjustedData = useMemo(() => data.map((d) => ({
    ...d,
    investments: adjust(d.investments, d.index),
    pension: adjust(d.pension, d.index),
    property: adjust(d.property, d.index),
    totalLegacy: adjust(d.totalLegacy, d.index),
    liquidWealth: adjust(d.liquidWealth, d.index),
    monthlyOutflow: adjust(d.monthlyOutflow, d.index),
    monthlySavings: adjust(d.monthlySavings, d.index),
    pensionContribution: adjust(d.pensionContribution, d.index),
    studyFundContribution: adjust(d.studyFundContribution, d.index),
    currentIncome: adjust(d.currentIncome, d.index),
    withdrawalFromInvestments: adjust(d.withdrawalFromInvestments, d.index),
    withdrawalFromPension: adjust(d.withdrawalFromPension, d.index),
    pensionAnnuity: adjust(d.pensionAnnuity, d.index),
    taxPaid: adjust(d.taxPaid, d.index),
  })), [data, valueMode, inflationRate]);

  const handleMouseDown = (e: any) => {
    if (e?.activeLabel !== null && e?.activeLabel !== undefined) setRefLeft(e.activeLabel);
  };
  const handleMouseMove = (e: any) => {
    if (refLeft !== null && e?.activeLabel !== undefined) setRefRight(e.activeLabel);
  };
  const handleZoom = () => {
    if (refLeft === null || refRight === null || Math.abs(refLeft - refRight) < 6) {
      setRefLeft(null); setRefRight(null); return;
    }
    setLeftIdx(Math.min(refLeft, refRight));
    setRightIdx(Math.max(refLeft, refRight));
    setRefLeft(null); setRefRight(null);
  };
  const resetZoom = () => { setLeftIdx('dataMin'); setRightIdx('dataMax'); };

  // Visible data window — used to scale Y axis to what's on screen.
  const visibleData = useMemo(() => {
    if (leftIdx === 'dataMin') return adjustedData;
    return adjustedData.filter(d => d.index >= (leftIdx as number) && d.index <= (rightIdx as number));
  }, [adjustedData, leftIdx, rightIdx]);

  const visibleSpanYears = useMemo(() => {
    if (visibleData.length < 2) return 1;
    return (visibleData[visibleData.length - 1].index - visibleData[0].index) / 12;
  }, [visibleData]);

  // Tick step in years: denser when zoomed in, sparser when zoomed out.
  const yearStep = visibleSpanYears > 40 ? 5
    : visibleSpanYears > 20 ? 2
    : 1;

  // Month labels between the years — but only once zoomed in enough that they
  // fit. The label budget scales with viewport width so a phone doesn't
  // overcrowd. monthStep 0 = years only (zoomed out / not enough room).
  const vw = useViewportWidth();
  const spanMonths = useMemo(() => {
    if (visibleData.length < 2) return 0;
    return visibleData[visibleData.length - 1].index - visibleData[0].index;
  }, [visibleData]);
  const monthStep = useMemo(() => {
    const maxLabels = vw < 640 ? 9 : vw < 1024 ? 13 : 18;
    if (spanMonths <= 0 || spanMonths > 72) return 0; // too wide → years only
    for (const step of [1, 2, 3, 6]) {
      if (spanMonths / step <= maxLabels) return step;
    }
    return 0;
  }, [spanMonths, vw]);

  // X-axis ticks. Zoomed out: January of every `yearStep` years. Zoomed in:
  // month boundaries at `monthStep` (January still lands on a tick → keeps the
  // year anchor). Restricted to the visible window so we never emit hundreds.
  const xTicks = useMemo(() => {
    const lo = visibleData[0]?.index ?? 0;
    const hi = visibleData[visibleData.length - 1]?.index ?? endMonthIndex;
    const inWin = adjustedData.filter(d => d.index >= lo && d.index <= hi);
    if (monthStep === 0) {
      return inWin
        .filter(d => {
          if (!d.label.startsWith('1/')) return false;
          const year = parseInt(d.label.split('/')[1]!, 10);
          return (year - baseYear) % yearStep === 0;
        })
        .map(d => d.index);
    }
    return inWin
      .filter(d => (parseInt(d.label.split('/')[0]!, 10) - 1) % monthStep === 0)
      .map(d => d.index);
  }, [adjustedData, visibleData, monthStep, yearStep, baseYear, endMonthIndex]);

  // With the half-time phase off the engine pins its year to the stop year,
  // so "half-time" is only a real phase when it starts strictly earlier.
  const hasHalfTime = transitionToHalfWorkYear < stopWorkYear;
  const halfTimeIndex = hasHalfTime ? transitionToHalfWorkYear * 12 : stopWorkYear * 12;
  const retireIndex = stopWorkYear * 12;
  const age60Index = Math.max(0, (60 - initialAge) * 12);
  const endIndex = adjustedData[adjustedData.length - 1]?.index ?? 0;

  // Build timeline event markers by scanning the simulation's labels. We
  // use the *adjusted* data so the marker Y lines up with the visible plot.
  const markers = useMemo(() => {
    const out: Array<{
      index: number; label: string; color: string; value: number; group: string; r: number;
    }> = [];
    for (const d of adjustedData) {
      if (!d.event) continue;
      const parts = d.event.split(' + ');
      for (const p of parts) {
        let color = '#b0956a';
        let group = 'event';
        if (p.includes('אקזיט')) { color = '#5d7a68'; group = 'exit'; }
        else if (p.includes('סקנדרי')) { color = '#6d8a9a'; group = 'secondary'; }
        else if (p.includes('דירה')) { color = '#6e7494'; group = 'property'; }
        else if (p.includes('פנסיה') || p.includes('קצבת')) { color = '#8a80a0'; group = 'pension'; }
        else continue;
        out.push({ index: d.index, label: p, color, value: d.totalLegacy, group, r: 5 });
      }
    }
    // Two events in the same month sit at the same (x,y). Draw them as
    // concentric dots (largest first, smallest on top) so both stay visible —
    // e.g. an exit and a secondary both placed in December.
    const byIndex = new Map<number, typeof out>();
    for (const mk of out) {
      const arr = byIndex.get(mk.index) ?? [];
      arr.push(mk);
      byIndex.set(mk.index, arr);
    }
    for (const arr of byIndex.values()) {
      if (arr.length < 2) continue;
      arr.forEach((mk, i) => { mk.r = Math.max(3, 7 - i * 2.5); });
    }
    // Larger radii first → later (smaller) markers render on top.
    out.sort((a, b) => b.r - a.r);
    return out;
  }, [adjustedData]);

  const yDomain = useMemo<[number, number]>(() => {
    if (visibleData.length === 0) return [0, 1];
    const max = Math.max(...visibleData.map(d => d.totalLegacy));
    return [0, Math.max(1, Math.ceil(max * 1.08))];
  }, [visibleData]);

  const flowDomain = useMemo<[number, number]>(() => {
    if (visibleData.length === 0) return [0, 1];
    const maxIn = Math.max(...visibleData.map(d => d.currentIncome));
    const maxOut = Math.max(...visibleData.map(d => d.monthlyOutflow));
    return [0, Math.max(1, Math.ceil(Math.max(maxIn, maxOut) * 1.1))];
  }, [visibleData]);

  // X tick renderer. A year anchor (year + age, two rows) lands on January; the
  // in-between month ticks get a light month label. The leftmost tick also
  // prints its year so a sub-year window never loses its year context.
  const XTick: React.FC<any> = ({ x, y, payload }) => {
    const point = adjustedData.find(d => d.index === payload.value);
    if (!point) return null;
    const [moStr, year] = point.label.split('/');
    const mo = parseInt(moStr!, 10);
    const age = Math.round(parseFloat(point.fullAge));
    const isYearAnchor = monthStep === 0 || mo === 1;
    if (isYearAnchor) {
      return (
        <g transform={`translate(${x},${y + 6})`}>
          <text textAnchor="middle" fill={LINEAR.inkTertiary} fontSize={11} fontWeight={700}>
            {year}
          </text>
          <text y={14} textAnchor="middle" fill={LINEAR.inkSubtle} fontSize={9} fontWeight={600}>
            גיל {age}
          </text>
        </g>
      );
    }
    const showYear = payload.value === xTicks[0];
    return (
      <g transform={`translate(${x},${y + 6})`}>
        <text textAnchor="middle" fill={LINEAR.inkSubtle} fontSize={9} fontWeight={600}>
          {HE_MONTH_ABBR[mo - 1]}
        </text>
        {showYear && (
          <text y={13} textAnchor="middle" fill={LINEAR.inkTertiary} fontSize={8} fontWeight={700}>
            {year}
          </text>
        )}
      </g>
    );
  };

  const zoomed = leftIdx !== 'dataMin' || rightIdx !== 'dataMax';

  // Headline milestones — the questions the chart exists to answer.
  const pointAt = (idx: number) => adjustedData.find(d => d.index >= idx) ?? adjustedData[adjustedData.length - 1];
  const atRetire = pointAt(retireIndex);
  const atAge60 = pointAt(age60Index);
  const atEnd = adjustedData[adjustedData.length - 1];
  // First point where liquid wealth runs dry (before the horizon's final year).
  const depleted = adjustedData.find(d => d.liquidWealth <= 0 && d.index > 0 && d.index < endIndex - 12);

  return (
    <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden text-right">
      <div className="flex justify-between items-center mb-4 px-2 flex-wrap gap-3">
        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <ArrowUpRight className="text-emerald-500" /> תחזית עושר משפחתי
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-[11px] font-bold">
            <button
              onClick={() => setValueMode('nominal')}
              className={`px-3 py-1 rounded-lg transition-all ${valueMode === 'nominal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >
              נומינלי
            </button>
            <button
              onClick={() => setValueMode('real')}
              className={`px-3 py-1 rounded-lg transition-all ${valueMode === 'real' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >
              ערך ריאלי (היום)
            </button>
          </div>
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-[11px] font-bold">
            <button
              onClick={() => presetZoom(3)}
              className={`px-3 py-1 rounded-lg transition-all ${leftIdx === 0 && rightIdx === Math.min(36, endMonthIndex) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-white hover:text-blue-600'}`}
            >
              3 שנים
            </button>
            <button
              onClick={() => presetZoom(10)}
              className={`px-3 py-1 rounded-lg transition-all ${leftIdx === 0 && rightIdx === Math.min(120, endMonthIndex) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-white hover:text-blue-600'}`}
            >
              10 שנים
            </button>
            <button
              onClick={() => presetZoom(20)}
              className={`px-3 py-1 rounded-lg transition-all ${leftIdx === 0 && rightIdx === Math.min(240, endMonthIndex) ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-white hover:text-blue-600'}`}
            >
              20 שנים
            </button>
            <button
              onClick={resetZoom}
              className={`px-3 py-1 rounded-lg transition-all ${!zoomed ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-white hover:text-blue-600'}`}
            >
              הכל
            </button>
          </div>
          <div className="text-[10px] text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full border border-slate-100 flex items-center gap-1.5">
            <ZoomIn size={12} /> גרור לזום
          </div>
        </div>
      </div>

      {/* Headline milestones — the answers, before the chart */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4 px-2 text-center">
        <div className="p-3 bg-slate-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">סך עושר בפרישה ({baseYear + stopWorkYear})</div><div className="font-black text-slate-800">{atRetire ? formatShortIls(atRetire.totalLegacy) : '—'}</div></div>
        <div className="p-3 bg-slate-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">בגיל 60</div><div className="font-black text-slate-800">{atAge60 ? formatShortIls(atAge60.totalLegacy) : '—'}</div></div>
        <div className="p-3 bg-slate-50 rounded-2xl"><div className="text-[10px] text-slate-400 font-bold">בסוף האופק (גיל {atEnd ? Math.round(parseFloat(atEnd.fullAge)) : '—'})</div><div className="font-black text-slate-800">{atEnd ? formatShortIls(atEnd.totalLegacy) : '—'}</div></div>
        <div className={`p-3 rounded-2xl ${depleted ? 'bg-rose-50' : 'bg-emerald-50'}`}>
          <div className="text-[10px] text-slate-400 font-bold">הון נזיל</div>
          <div className={`font-black ${depleted ? 'text-rose-700' : 'text-emerald-700'}`}>{depleted ? `נגמר ב-${depleted.label.split('/')[1]}` : 'שורד את כל האופק'}</div>
        </div>
      </div>

      {/* Inline explanatory caption — answers "what am I looking at" */}
      <p className="text-[11px] text-slate-500 font-medium mb-4 px-2 leading-relaxed">
        ציר X: שנה לוח · גיל. ציר Y: שווי משפחתי מצטבר {valueMode === 'real' ? '(בכוח הקנייה של היום)' : '(ערכים נומינליים, לא מתוקננים לאינפלציה)'}. זהו התרחיש הטיפוסי (תשואה חציונית, ללא תנודתיות) — הפיזור סביבו מופיע בגרף ההתפלגות.
      </p>

      {/* Legend band */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold text-slate-600 mb-4 px-2">
        <LegendSwatch color={SERIES[0]} label="הון נזיל (השקעות)" />
        <LegendSwatch color={SERIES[8]} label="פנסיה" />
        <LegendSwatch color={SERIES[4]} dashed label="דירה למגורים" />
        {hasHalfTime && <LegendSwatch color="#b0956a" bandLabel="חצי משרה" />}
        <LegendSwatch color="#5d7a68" ring label="אקזיט" />
        <LegendSwatch color="#6d8a9a" ring label="סקנדרי" />
      </div>

      {/* Main stacked-area chart */}
      <div className="h-[440px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={adjustedData}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleZoom}
            onMouseLeave={() => { setRefLeft(null); setRefRight(null); }}
            margin={{ top: 30, right: 28, left: 12, bottom: 28 }}
          >
            <defs>
              <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={SERIES[0]} stopOpacity={0.7} />
                <stop offset="95%" stopColor={SERIES[0]} stopOpacity={0.15} />
              </linearGradient>
              <linearGradient id="gradPen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={SERIES[8]} stopOpacity={0.65} />
                <stop offset="95%" stopColor={SERIES[8]} stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="gradProp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={SERIES[4]} stopOpacity={0.5} />
                <stop offset="95%" stopColor={SERIES[4]} stopOpacity={0.08} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />

            {/* Life-phase background bands */}
            <ReferenceArea
              x1={0}
              x2={Math.min(halfTimeIndex, endIndex)}
              fill="#6d907c"
              fillOpacity={0.05}
              strokeOpacity={0}
            />
            {halfTimeIndex < retireIndex && halfTimeIndex < endIndex && (
              <ReferenceArea
                x1={halfTimeIndex}
                x2={Math.min(retireIndex, endIndex)}
                fill="#b0956a"
                fillOpacity={0.06}
                strokeOpacity={0}
              />
            )}
            {retireIndex < endIndex && (
              <ReferenceArea
                x1={retireIndex}
                x2={endIndex}
                fill="#64748b"
                fillOpacity={0.05}
                strokeOpacity={0}
              />
            )}

            <XAxis
              dataKey="index"
              type="number"
              domain={[leftIdx, rightIdx]}
              allowDataOverflow
              ticks={xTicks}
              interval={0}
              height={48}
              tick={<XTick />}
              stroke="#cbd5e1"
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              domain={yDomain}
              allowDataOverflow
              tickFormatter={(v) => formatShortIls(v)}
              width={62}
            />
            <Tooltip content={<WealthTooltip valueMode={valueMode} />} />

            {/* Stacked composition */}
            <Area
              type="monotone"
              dataKey="investments"
              name="השקעות ונזיל"
              stackId="wealth"
              stroke={SERIES[0]}
              strokeWidth={2}
              fill="url(#gradInv)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="pension"
              name="פנסיה"
              stackId="wealth"
              stroke={SERIES[8]}
              strokeWidth={2}
              fill="url(#gradPen)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="property"
              name="דירה"
              stackId="wealth"
              stroke={SERIES[4]}
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="url(#gradProp)"
              isAnimationActive={false}
            />

            {/* Phase boundary vertical lines — labels staggered so they
                don't collide when milestones are close together. */}
            {hasHalfTime && halfTimeIndex > 0 && halfTimeIndex < endIndex && (
              <ReferenceLine
                x={halfTimeIndex}
                stroke="#b0956a"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                label={{
                  value: `חצי משרה ${baseYear + transitionToHalfWorkYear}`,
                  fill: '#8a7048', fontSize: 10, fontWeight: 800, position: 'insideTopLeft',
                  offset: 6,
                }}
              />
            )}
            {retireIndex > 0 && retireIndex < endIndex && (
              <ReferenceLine
                x={retireIndex}
                stroke="#475569"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                label={{
                  value: `פרישה ${baseYear + stopWorkYear}`,
                  fill: '#334155', fontSize: 10, fontWeight: 800, position: 'insideTopRight',
                  offset: 6,
                }}
              />
            )}
            {age60Index > 0 && age60Index < endIndex && (
              <ReferenceLine
                x={age60Index}
                stroke={SERIES[8]}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                label={{
                  value: 'קצבת פנסיה (גיל 60)',
                  fill: '#7a7490', fontSize: 10, fontWeight: 800, position: 'insideTopLeft',
                  offset: 6,
                }}
              />
            )}

            {/* Event markers at the top of the stack */}
            {markers.map((m, i) => (
              <ReferenceDot
                key={`${m.group}-${m.index}-${i}`}
                x={m.index}
                y={m.value}
                r={m.r}
                fill={m.color}
                stroke="#fff"
                strokeWidth={2}
                isFront
              />
            ))}

            {/* Brush overlay while dragging */}
            {refLeft !== null && refRight !== null && (
              <ReferenceArea x1={refLeft} x2={refRight} fillOpacity={0.12} fill="#6d7c94" />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Cash-flow strip */}
      <div className="mt-6 pt-4 border-t border-slate-100">
        <div className="flex justify-between items-baseline px-2 mb-2">
          <h4 className="text-sm font-black text-slate-700">תזרים חודשי</h4>
          <p className="text-[10px] text-slate-400 font-bold">
            <span className="inline-block w-2 h-2 bg-emerald-500 rounded-sm mr-1" /> הכנסה ·
            <span className="inline-block w-2 h-2 bg-rose-500 rounded-sm mx-1" /> הוצאה
          </p>
        </div>
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={adjustedData}
              margin={{ top: 8, right: 28, left: 12, bottom: 6 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="index"
                type="number"
                domain={[leftIdx, rightIdx]}
                ticks={xTicks}
                interval={0}
                height={18}
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                tickFormatter={(i) => {
                  const p = adjustedData.find(d => d.index === i);
                  if (!p) return '';
                  const [mo, yr] = p.label.split('/');
                  return parseInt(mo!, 10) === 1 ? yr! : HE_MONTH_ABBR[parseInt(mo!, 10) - 1];
                }}
                stroke="#cbd5e1"
                allowDataOverflow
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                domain={flowDomain}
                allowDataOverflow
                tickFormatter={(v) => formatShortIls(v)}
                width={62}
              />
              <Tooltip content={<CashFlowTooltip valueMode={valueMode} />} />
              <Area
                type="monotone"
                dataKey="currentIncome"
                name="הכנסה חודשית"
                stroke="#6d907c"
                strokeWidth={2}
                fill="#6d907c"
                fillOpacity={0.15}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="monthlyOutflow"
                name="הוצאה חודשית"
                stroke="#b08088"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Milestones summary */}
      <MilestoneStrip
        initialAge={initialAge}
        baseYear={baseYear}
        halfTimeYear={hasHalfTime ? transitionToHalfWorkYear : null}
        retireYear={stopWorkYear}
        equityCompanies={equityCompanies}
        propertyYear={propertyEnabled ? propertyYear : undefined}
      />
    </div>
  );
};

// ---------------------------------------------------------------------

interface LegendSwatchProps {
  color: string;
  label?: string;
  bandLabel?: string;
  dashed?: boolean;
  ring?: boolean;
}

const LegendSwatch: React.FC<LegendSwatchProps> = ({ color, label, bandLabel, dashed, ring }) => {
  const text = bandLabel ?? label ?? '';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {ring ? (
        <span
          className="w-3 h-3 rounded-full border-2"
          style={{ borderColor: color, backgroundColor: 'white' }}
        />
      ) : dashed ? (
        <span
          className="w-4 h-0 border-t-2 border-dashed"
          style={{ borderColor: color }}
        />
      ) : bandLabel ? (
        <span
          className="w-4 h-3 rounded-sm border"
          style={{ backgroundColor: color, opacity: 0.25, borderColor: color }}
        />
      ) : (
        <span
          className="w-3 h-3 rounded-sm"
          style={{ backgroundColor: color, opacity: 0.85 }}
        />
      )}
      <span className="text-slate-500">{text}</span>
    </span>
  );
};

interface WealthTooltipProps {
  active?: boolean;
  payload?: any[];
  valueMode: ValueMode;
}

const WealthTooltip: React.FC<WealthTooltipProps> = ({ active, payload, valueMode }) => {
  if (!active || !payload?.length) return null;
  const d: SimPoint = payload[0].payload;
  return (
    <div className="bg-white p-5 shadow-2xl border border-slate-100 rounded-2xl text-right min-w-[320px]">
      <div className="flex justify-between items-start border-b pb-1 mb-2">
        <span className="font-black text-slate-800 text-lg">{d.label}</span>
        <span className="font-black text-slate-500">גיל {d.fullAge}</span>
      </div>
      <div className="text-[10px] text-slate-400 font-bold mb-2">
        {valueMode === 'real' ? 'ערך ריאלי (כוח קנייה היום)' : 'ערך נומינלי'}
      </div>
      {d.event && (
        <div className="mb-3 bg-amber-50 text-amber-700 p-2 rounded-lg text-[11px] font-black border border-amber-100">
          {d.event}
        </div>
      )}
      <div className="space-y-1 text-xs">
        <Row color="#6d7c94" name="הון נזיל" value={formatShortIls(d.investments)} />
        {d.pension > 0 && (
          <Row color="#8a80a0" name="פנסיה" value={formatShortIls(d.pension)} />
        )}
        {d.property > 0 && (
          <Row color="#6e7494" name="דירה" value={formatShortIls(d.property)} />
        )}
        <div className="border-t pt-2 mt-1">
          <Row color="#6d907c" name="סך עושר" value={formatShortIls(d.totalLegacy)} bold />
        </div>
        <div className="border-t pt-2 mt-1 space-y-1 text-[11px]">
          <div className="flex justify-between text-slate-500">
            <span>מקור הכנסה</span>
            <span>{d.incomeSource}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">הכנסה חודשית</span>
            <span className="font-black">{formatShortIls(d.currentIncome)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">הוצאה חודשית</span>
            <span className="font-black text-rose-600">{formatShortIls(d.monthlyOutflow)}</span>
          </div>
          {(d.pensionContribution > 0 || d.studyFundContribution > 0) ? (
            <div className="border-t pt-1 mt-1 space-y-0.5">
              <div className="flex justify-between"><span className="text-slate-500">חיסכון נזיל (שכר − הוצאות)</span><span className={`font-black ${d.monthlySavings >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatShortIls(d.monthlySavings)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">הפקדה לפנסיה</span><span className="font-black text-purple-600">{formatShortIls(d.pensionContribution)}</span></div>
              {d.studyFundContribution > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">קרן השתלמות</span><span className="font-black text-sky-700">{formatShortIls(d.studyFundContribution)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1 mt-0.5"><span className="text-slate-600 font-bold">סה״כ נחסך החודש</span><span className="font-black text-emerald-600">{formatShortIls(d.monthlySavings + d.pensionContribution + d.studyFundContribution)}</span></div>
            </div>
          ) : (
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="text-slate-500">חיסכון/גירעון</span>
              <span className={`font-black ${d.monthlySavings >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatShortIls(d.monthlySavings)}
              </span>
            </div>
          )}
          {(d.withdrawalFromInvestments > 0 || d.withdrawalFromPension > 0) && (
            <div className="border-t pt-2 mt-1 space-y-0.5 text-[10px]">
              {d.withdrawalFromInvestments > 0 && (
                <div className="flex justify-between text-blue-600">
                  <span>משיכה מהשקעות</span>
                  <span className="font-black">{formatShortIls(d.withdrawalFromInvestments)}</span>
                </div>
              )}
              {d.withdrawalFromPension > 0 && (
                <div className="flex justify-between text-purple-600">
                  <span>{d.pensionAnnuity > 0 ? 'קצבה' : 'משיכת פנסיה'}</span>
                  <span className="font-black">{formatShortIls(d.withdrawalFromPension)}</span>
                </div>
              )}
              {d.taxPaid > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>מס ששולם</span>
                  <span className="font-black">{formatShortIls(d.taxPaid)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CashFlowTooltip: React.FC<{ active?: boolean; payload?: any[]; valueMode: ValueMode }> = ({ active, payload, valueMode }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as SimPoint;
  return (
    <div className="bg-white p-3 shadow-xl border border-slate-100 rounded-xl text-right min-w-[220px]">
      <p className="font-black text-slate-800 mb-1 text-sm">{d.label}</p>
      <p className="text-[9px] text-slate-400 font-bold mb-1">
        {valueMode === 'real' ? 'ערך היום' : 'ערך נומינלי'}
      </p>
      <div className="space-y-0.5 text-xs">
        <Row color="#6d907c" name="הכנסה" value={formatShortIls(d.currentIncome)} />
        <Row color="#b08088" name="הוצאה" value={formatShortIls(d.monthlyOutflow)} />
        <div className="text-[10px] text-slate-400 font-bold border-t pt-1 mt-1">{d.incomeSource}</div>
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

interface MilestoneStripProps {
  initialAge: number;
  baseYear: number;
  /** Null when there is no half-time phase. */
  halfTimeYear: number | null;
  retireYear: number;
  equityCompanies: EquityCompany[];
  propertyYear?: number;
}

interface Milestone {
  year: number;
  age: number;
  title: string;
  sub?: string;
  color: string;
}

const MilestoneStrip: React.FC<MilestoneStripProps> = ({
  initialAge,
  baseYear,
  halfTimeYear,
  retireYear,
  equityCompanies,
  propertyYear,
}) => {
  const ms: Milestone[] = [];
  if (halfTimeYear != null && halfTimeYear > 0) {
    ms.push({
      year: baseYear + halfTimeYear,
      age: initialAge + halfTimeYear,
      title: 'חצי משרה',
      color: '#b0956a',
    });
  }
  ms.push({
    year: baseYear + retireYear,
    age: initialAge + retireYear,
    title: 'פרישה',
    color: '#64748b',
  });
  if (initialAge < 60) {
    ms.push({
      year: baseYear + (60 - initialAge),
      age: 60,
      title: 'קצבת פנסיה',
      color: '#8a80a0',
    });
  }
  for (const c of equityCompanies) {
    if (c.exitConfig.secondaryIls && c.exitConfig.secondaryYear) {
      ms.push({
        year: c.exitConfig.secondaryYear,
        age: initialAge + (c.exitConfig.secondaryYear - baseYear),
        title: `סקנדרי ${c.name}`,
        sub: formatShortIls(c.exitConfig.secondaryIls),
        color: '#6d8a9a',
      });
    }
    if (c.contracts.length && c.exitConfig.sharePriceAtExit > 0) {
      ms.push({
        year: c.exitConfig.exitYear,
        age: initialAge + (c.exitConfig.exitYear - baseYear),
        title: `אקזיט ${c.name}`,
        color: '#5d7a68',
      });
    }
  }
  if (propertyYear) {
    ms.push({
      year: propertyYear,
      age: initialAge + (propertyYear - baseYear),
      title: 'רכישת דירה',
      color: '#6e7494',
    });
  }
  ms.sort((a, b) => a.year - b.year);

  if (ms.length === 0) return null;
  return (
    <div className="mt-6 pt-6 border-t border-slate-100">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
        ציר זמן – אירועים מרכזיים
      </p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {ms.map((m, i) => (
          <div
            key={`${m.year}-${m.title}-${i}`}
            className="flex-none p-3 bg-slate-50 border border-slate-100 rounded-2xl min-w-[140px]"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              <span className="text-xs font-black text-slate-700">{m.title}</span>
            </div>
            <div className="text-lg font-black text-slate-800 mt-1">{m.year}</div>
            <div className="text-[10px] text-slate-400 font-bold">
              גיל {Math.round(m.age)}{m.sub ? ` · ${m.sub}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SimulationChart;
