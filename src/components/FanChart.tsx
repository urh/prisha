import React, { useMemo } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { PercentileBand } from '../utils/projection';
import { CHART, LINEAR } from '../utils/palette';

interface FanChartProps {
  bands: PercentileBand[];
  initialAge: number;
  /** Years from today until work stops — draws the retirement marker. */
  stopWorkYear: number;
  /** Share of paths that ran out, 0..1. */
  failureRate: number;
  medianRuinAge: number | null;
  paths: number;
}

const fmt = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₪${Math.round(v / 1000)}K`;
  return `₪${Math.round(v)}`;
};

const FanTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as PercentileBand & { spread: number[] };
  const rows: Array<[string, number, string]> = [
    ['אופטימי (10% העליונים)', d.p90, 'text-emerald-600'],
    ['טוב (רבעון עליון)', d.p75, 'text-emerald-500'],
    ['חציון', d.p50, 'text-slate-800'],
    ['חלש (רבעון תחתון)', d.p25, 'text-amber-600'],
    ['גרוע (10% התחתונים)', d.p10, 'text-rose-600'],
  ];
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-xl p-3 text-right min-w-[210px]">
      <div className="text-[11px] font-black text-slate-800 mb-2">
        גיל {d.fullAge} · {d.label}
      </div>
      <div className="space-y-1">
        {rows.map(([label, value, cls]) => (
          <div key={label} className="flex justify-between gap-4 text-[11px]">
            <span className="text-slate-500">{label}</span>
            <span className={`font-black ${cls}`}>{fmt(value)}</span>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
        הון נזיל בשקלים של היום
      </div>
    </div>
  );
};

/**
 * Monte Carlo fan chart: the p10–p90 spread of liquid wealth over time, in
 * today's shekels. The single deterministic line the dashboard used to show
 * is roughly the middle of this — the point of the chart is how wide the rest
 * of it is.
 */
const FanChart: React.FC<FanChartProps> = ({
  bands,
  initialAge,
  stopWorkYear,
  failureRate,
  medianRuinAge,
  paths,
}) => {
  // Recharts stacks an invisible base under a visible band to fake a range.
  const data = useMemo(
    () =>
      bands.map((b) => ({
        ...b,
        outerBase: b.p10,
        outerSpan: Math.max(0, b.p90 - b.p10),
        innerBase: b.p25,
        innerSpan: Math.max(0, b.p75 - b.p25),
      })),
    [bands],
  );

  const retireIndex = stopWorkYear * 12;
  const endIndex = bands[bands.length - 1]?.index ?? 0;

  const xTicks = useMemo(
    () =>
      bands
        .filter((b) => {
          if (!b.label.startsWith('1/')) return false;
          const age = parseFloat(b.fullAge);
          return Math.round(age) % 10 === 0;
        })
        .map((b) => b.index),
    [bands],
  );

  const failPct = failureRate * 100;
  const tone =
    failPct < 10
      ? { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' }
      : failPct < 25
        ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' }
        : { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' };

  return (
    <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-100 text-right">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div>
          <h3 className="font-black text-slate-800 text-sm">התפלגות תרחישים</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {paths.toLocaleString()} מסלולי שוק אקראיים · הון נזיל בשקלים של היום
          </p>
        </div>
        <div className={`${tone.bg} ${tone.border} border rounded-2xl px-3 py-2`}>
          <div className={`text-[10px] font-bold ${tone.text} opacity-80`}>סיכוי שהכסף ייגמר</div>
          <div className={`text-lg font-black ${tone.text} text-left`}>{failPct.toFixed(1)}%</div>
          {medianRuinAge != null && (
            <div className={`text-[10px] font-bold ${tone.text} opacity-70`}>
              חציון: גיל {medianRuinAge.toFixed(0)}
            </div>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="fanOuter" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINEAR.primary} stopOpacity={0.22} />
              <stop offset="100%" stopColor={LINEAR.primary} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="fanInner" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINEAR.primary} stopOpacity={0.4} />
              <stop offset="100%" stopColor={LINEAR.primary} stopOpacity={0.24} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="index"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tickFormatter={(v) => `גיל ${Math.round(initialAge + v / 12)}`}
            stroke={CHART.grid}
            fontSize={11}
          />
          <YAxis
            stroke={CHART.axis}
            fontSize={11}
            tickFormatter={fmt}
            width={62}
          />
          <Tooltip content={<FanTooltip />} />

          {/* p10–p90 */}
          <Area
            dataKey="outerBase"
            stackId="outer"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
          />
          <Area
            dataKey="outerSpan"
            stackId="outer"
            name="10%–90%"
            stroke="none"
            fill="url(#fanOuter)"
            isAnimationActive={false}
          />

          {/* p25–p75 */}
          <Area
            dataKey="innerBase"
            stackId="inner"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
          />
          <Area
            dataKey="innerSpan"
            stackId="inner"
            name="25%–75%"
            stroke="none"
            fill="url(#fanInner)"
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="p50"
            name="חציון"
            stroke={LINEAR.primary}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />

          <ReferenceLine y={0} stroke={CHART.marker} strokeWidth={1} strokeDasharray="4 4" />
          {retireIndex > 0 && retireIndex < endIndex && (
            <ReferenceLine
              x={retireIndex}
              stroke={LINEAR.inkTertiary}
              strokeWidth={1.5}
              strokeDasharray="5 5"
              label={{
                value: 'פרישה',
                position: 'top',
                fontSize: 10,
                fontWeight: 700,
                fill: LINEAR.inkTertiary,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-4 mt-3 text-[10px] font-bold text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-blue-700" /> חציון
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-blue-500/40" /> 25%–75% מהמסלולים
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-blue-500/20" /> 10%–90% מהמסלולים
        </span>
      </div>
    </div>
  );
};

export default FanChart;
