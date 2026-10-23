import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  Wallet,
  Home, BarChart3, Sparkles, Target,
  History, Eye, EyeOff,
  LayoutDashboard, SlidersHorizontal, CalendarDays, Archive, TrendingUp, Rocket, ChevronLeft
} from 'lucide-react';
import HistoryTab from './components/HistoryTab';
import SimulationChart from './components/SimulationChart';
import FanChart from './components/FanChart';
import type { 
  Asset, Expense, SalaryData, 
} from './types';
import {
  calculateNetEquity,
  getVestingAtDate,
  calculateBudgetSummary,
  calculateTotalAssets,
  calculatePensionValue,
  calculateInvestmentValue,
  calculateLiquidAfterTax,
  calculateLiquidGain,
  LIQUID_GAIN_TAX_RATE,
} from './utils/calculations';
import type { GlidepathConfig } from './utils/projection';
import { useProjectionEngine } from './hooks/useProjectionEngine';
import type { EngineInputs, GridInputs } from './workers/projection.worker';
import { SERIES, CHART } from './utils/palette';
import { yearPace, elapsedMonthsOf, barColor } from './utils/viewMath';
import {
  EquityCompany,
  PropertyPlan,
} from './utils/storage';
import { MonthActualsTab, ArchiveTab } from './components/MonthActuals';
import { CategoryPie } from './components/CategoryPie';
import { yearBreakdown, yearOutliers } from './utils/budgetGroups';
import { YearlyTab } from './components/YearlyTab';
import { BudgetTab } from './components/BudgetTab';
import { CommentLayer } from './components/CommentLayer';
import actualsData from './data/actuals.json';
import {
  defaultAssets,
  defaultMonthlyExpenses,
  defaultYearlyExpenses,
  defaultSalaryData,
  defaultEquityCompanies,
  defaultPropertyPlan,
  defaultSimulationParams,
  DEFAULT_INITIAL_AGE,
} from './data/defaultState';

// Number formatting helper
const formatNumber = (num: number): string => {
  return Math.round(num).toLocaleString('en-US');
};

// Live actuals snapshot (regenerated on the box at rebuild time).
const ACT: any = actualsData;

// Fixed conversion rate used for equity ($→₪) across the stocks tab.
const USD_ILS = 3.5;

const MONTHS_HE_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

// Formatted number input component
// State persistence constants
const STATE_STORAGE_KEY = 'prisha-financial-state';
const STATE_MIGRATION_KEY = 'prisha-financial-state-migration';
const SAVE_DEBOUNCE_MS = 2000; // Save after 2 seconds of no changes
// Bump when default data changes significantly. On first boot after a
// bump we nuke the cached state once (via the migration marker) so
// stale in-memory state from an HMR session can't "rescue" old values
// by autosaving with the new version tag.
// Monte Carlo path counts. The solver runs many projections per binary-search
// step, so it gets fewer paths than the single display run.
const SOLVER_PATHS = 150;
const DISPLAY_PATHS = 250;
const RETIREMENT_GRID_YEARS = [5, 10, 15, 20, 25];
// The two confidence levels shown side by side.
// Guardrails on the year-over-year change in real spending. Tighter collars
// (Vanguard's default is +5%/-2.5%) smooth income but stop it ever catching up
// with a growing portfolio — measured, that still leaves ~4x at the median.
const MAX_RISE = 0.20;
const MAX_FALL = 0.10;
// Ages shown in the spending trajectory.
const TRAJECTORY_AGES = [55, 65, 75, 85];

const DATA_VERSION = 179;

// Runs synchronously at module load, before any React state initializer
// reads localStorage. Guarantees the cached snapshot is cleared exactly
// once per DATA_VERSION bump.
(function runMigration() {
  try {
    const stored = localStorage.getItem(STATE_MIGRATION_KEY);
    const storedVersion = stored ? parseInt(stored, 10) : 0;
    if (storedVersion < DATA_VERSION) {
      localStorage.removeItem(STATE_STORAGE_KEY);
      localStorage.setItem(STATE_MIGRATION_KEY, String(DATA_VERSION));
      console.info(`[prisha] Applied data migration ${storedVersion} → ${DATA_VERSION}; cleared cached state.`);
    }
  } catch (e) {
    console.warn('[prisha] Migration failed:', e);
  }
})();

// Small stat card used across the overview tab.
interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'plain' | 'emerald' | 'amber' | 'rose' | 'blue';
  hidden?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, tone = 'plain', hidden }) => {
  const tones: Record<string, string> = {
    plain: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-600',
    blue: 'text-blue-700',
  };
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-right">
      <div className="text-[10px] font-black text-slate-400 uppercase mb-1">{label}</div>
      <div className={`text-xl font-black text-left ${tones[tone]} ${hidden ? 'sensitive' : ''}`}>{value}</div>
      {sub && <div className={`text-[10px] text-slate-400 font-bold mt-0.5 ${hidden ? 'sensitive' : ''}`}>{sub}</div>}
    </div>
  );
};

interface EquityMetricProps {
  label: string;
  val: string;
  color?: string;
}

const EquityMetric: React.FC<EquityMetricProps> = ({ label, val, color }) => (
  <div className="p-5 bg-white rounded-[1.5rem] shadow-sm border border-slate-100 text-right">
    <p className="text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">{label}</p>
    <p className={`text-sm font-black text-left ${color || 'text-slate-800'}`}>{val}</p>
  </div>
);

// Load state from localStorage. If the stored snapshot predates the
// current DATA_VERSION (or has no version), we discard it so the user
// sees the fresh defaults rather than a stale cache.
const loadSavedState = () => {
  try {
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if ((parsed?.dataVersion ?? 0) < DATA_VERSION) {
      console.info(`[prisha] Discarding saved state: version ${parsed?.dataVersion ?? 0} < ${DATA_VERSION}. Loading defaults.`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('Failed to load saved state:', e);
  }
  return null;
};

// Main App Component
const App: React.FC = () => {
  // Load saved state or use defaults
  const savedState = useMemo(() => loadSavedState(), []);
  
  // States
  const [activeTab, setActiveTab] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem('prisha-active-tab') || 'overview'; } catch { return 'overview'; }
  });
  useEffect(() => { try { localStorage.setItem('prisha-active-tab', activeTab); } catch { /* ignore */ } }, [activeTab]);
  const [privacy, setPrivacy] = useState<boolean>(() => { try { return localStorage.getItem('prisha-privacy') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('prisha-privacy', privacy ? '1' : '0'); } catch { /* ignore */ } document.body.classList.toggle('privacy-on', privacy); }, [privacy]);
  const [returnRate] = useState<number>(savedState?.simulationParams?.returnRate ?? defaultSimulationParams.returnRate);
  const [inflationRate] = useState<number>(savedState?.simulationParams?.inflationRate ?? defaultSimulationParams.inflationRate);
  const [transitionToHalfWorkYear] = useState<number>(savedState?.simulationParams?.transitionToHalfWorkYear ?? defaultSimulationParams.transitionToHalfWorkYear);
  const [stopWorkYear] = useState<number>(savedState?.simulationParams?.stopWorkYear ?? defaultSimulationParams.stopWorkYear);
  // Volatility is what turns the old single-line forecast into a distribution.
  // ~17% is the long-run standard deviation of annual S&P 500 returns.
  const [annualVolatility] = useState<number>(
    savedState?.simulationParams?.annualVolatility ?? defaultSimulationParams.annualVolatility);
  const [successTarget] = useState<number>(
    savedState?.simulationParams?.successTarget ?? defaultSimulationParams.successTarget);
  // Dynamic spending with guardrails — review once a year, and limit how far
  // income may move from last year. This is what advisers actually run, and it
  // is the only rule measured here that does not die with a fortune: a fixed
  // inflation-linked withdrawal leaves ~7x the starting pot at the median,
  // because it is sized for a bad future and lived in an average one.
  const withdrawalMode = 'dynamic' as const;
  const spendFloor = 0;
  // Lifestyle ceiling: the most the household can realistically spend in a month. Past
  // it the plan stops trying to consume the money — see the note in the UI.
  const [spendCap] = useState<number>(
    savedState?.simulationParams?.spendCap ?? defaultSimulationParams.spendCap);
  const [glidepathEnabled] = useState<boolean>(
    savedState?.simulationParams?.glidepathEnabled ?? defaultSimulationParams.glidepathEnabled);
  // How much of the modelled exit proceeds the upside plan believes in.
  const [equityConfidence] = useState<number>(
    savedState?.simulationParams?.equityConfidence ?? defaultSimulationParams.equityConfidence);
  // The usual question is when work stops, not when it goes half-time, so
  // the intermediate phase is opt-in. Off means full work right up to the stop.
  const [halfTimeEnabled] = useState<boolean>(
    savedState?.simulationParams?.halfTimeEnabled
      ?? (savedState?.simulationParams
        ? savedState.simulationParams.transitionToHalfWorkYear < savedState.simulationParams.stopWorkYear
        : defaultSimulationParams.halfTimeEnabled));
  const [activePlan, setActivePlan] = useState<'base' | 'upside'>('base');

  // Keep the half-time year pinned to the stop year while the phase is off,
  // so the engine sees "full time until retirement" no matter how the stop
  // slider moves.
  const [initialAge] = useState<number>(savedState?.initialAge ?? DEFAULT_INITIAL_AGE);

  const [salaryData] = useState<SalaryData>(savedState?.salaryData ?? defaultSalaryData);

  const [currentAssets] = useState<Asset[]>(savedState?.assets ?? defaultAssets);
  const [monthlyExpenses] = useState<Expense[]>(savedState?.monthlyExpenses ?? defaultMonthlyExpenses);
  const [yearlyExpenses] = useState<Expense[]>(savedState?.yearlyExpenses ?? defaultYearlyExpenses);

  // Dynamic equity companies
  const [equityCompanies] = useState<EquityCompany[]>(savedState?.equityCompanies ?? defaultEquityCompanies);
  
  // Property plan (can be disabled)
  const [propertyPlan] = useState<PropertyPlan>(savedState?.propertyPlan ?? defaultPropertyPlan);
  
  // Auto-save with debounce
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const saveState = useCallback(() => {
    const stateToSave = {
      dataVersion: DATA_VERSION,
      initialAge,
      assets: currentAssets,
      monthlyExpenses,
      yearlyExpenses,
      salaryData,
      equityCompanies,
      propertyPlan,
      simulationParams: {
        returnRate,
        inflationRate,
        transitionToHalfWorkYear,
        stopWorkYear,
        annualVolatility,
        successTarget,
        withdrawalMode,
        spendFloor,
        spendCap,
        glidepathEnabled,
        equityConfidence,
        halfTimeEnabled,
      },
    };
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [initialAge, currentAssets, monthlyExpenses, yearlyExpenses, salaryData, equityCompanies, propertyPlan, returnRate, inflationRate, transitionToHalfWorkYear, stopWorkYear, annualVolatility, successTarget, withdrawalMode, spendFloor, spendCap, glidepathEnabled, equityConfidence, halfTimeEnabled]);
  
  // Debounced auto-save effect
  useEffect(() => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Set new timeout to save after debounce period
    saveTimeoutRef.current = setTimeout(() => {
      saveState();
    }, SAVE_DEBOUNCE_MS);
    
    // Cleanup on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveState]);

  // Flush pending edits when the tab closes — the debounce alone can lose
  // the last 2 seconds of typing.
  useEffect(() => {
    window.addEventListener('beforeunload', saveState);
    return () => window.removeEventListener('beforeunload', saveState);
  }, [saveState]);

  // Calculations
  const totalAssetsNow = useMemo(() => calculateTotalAssets(currentAssets), [currentAssets]);
  const monthlyTotalSum = useMemo(() => monthlyExpenses.reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0), [monthlyExpenses]);
  const yearlyMonthlyAvgRecurring = useMemo(() => yearlyExpenses.reduce((s, e) => { if (e.oneTime) return s; const raw = parseFloat(String(e.amount)) || 0; const n = Math.max(1, Number(e.everyNYears) || 1); return s + raw / n / 12; }, 0), [yearlyExpenses]);
  const pensionInitialValue = useMemo(() => calculatePensionValue(currentAssets), [currentAssets]);
  const investmentInitialValue = useMemo(() => calculateInvestmentValue(currentAssets), [currentAssets]);

  const budgetSummary = useMemo(() =>
    calculateBudgetSummary(monthlyExpenses, yearlyExpenses, salaryData),
    [monthlyExpenses, yearlyExpenses, salaryData]
  );

  // Net monthly income (salaries only — feeds the month/yearly views).
  const netIncomeMonthly = (salaryData.person1Net || 0) + (salaryData.person2Net || 0);
  // Ongoing monthly spend (no 2026-only items) — the retirement comparison.
  const normalizedSpend = monthlyTotalSum + yearlyMonthlyAvgRecurring;
  // Pension + hishtalmut contributions: saving too, on top of the net income.
  const lockedMonthly = (budgetSummary.totalPensionInflow || 0) + (budgetSummary.totalStudyFundInflow || 0);

  // This year, one figure for every screen: actual spend so far + the budget
  // for the months left, by category (yearBreakdown). Same as the yearly tab.
  const yearInPractice = useMemo(() => {
    const yr = ACT.yearly;
    if (!yr) return null;
    const elapsed = elapsedMonthsOf(yr.current_month || 12, ACT.today || 30, ACT.days_in_month || 30);
    const breakdown = yearBreakdown(yr, ACT.months || {}, monthlyExpenses, yearlyExpenses, elapsed);
    const spend = breakdown.total / 12;
    // Peer transfers and cash (BIT, withdrawals) — not counted as spend.
    const transfersYtd = Object.entries<any>(ACT.months || {})
      .filter(([ym]) => ym.startsWith(String(yr.year)))
      .reduce((s, [, m]) => s + (m.reclass || []).filter((r: any) => !r.counted).reduce((t: number, r: any) => t + (r.amount || 0), 0), 0);
    const outliers = yearOutliers(ACT.months || {}, monthlyExpenses, yearlyExpenses, yr.year, elapsed, ACT.offcard_lines || []);
    return { year: yr.year, breakdown, spend, saving: budgetSummary.totalIncomeNet - spend, transfersYtd, outliers };
  }, [monthlyExpenses, yearlyExpenses, budgetSummary.totalIncomeNet]);
  // Hishtalmut is tax-free and liquid after six years: saving, not pension.
  const savingMonthly = (yearInPractice?.saving ?? 0) + (budgetSummary.totalStudyFundInflow || 0);

  // Asset composition for the assets-tab donut.
  const assetPieData = useMemo(() => {
    const sums = { liquid: 0, pension: 0, invest: 0 };
    currentAssets.forEach((a) => { sums[a.type] = (sums[a.type] || 0) + (a.value || 0); });
    return [
      // Same hues as the simulation chart's stack, so the donut and the
      // projection read as one picture.
      { name: 'נזיל', color: SERIES[0], value: sums.liquid },
      { name: 'פנסיה', color: SERIES[8], value: sums.pension },
      { name: 'נדל״ן', color: SERIES[4], value: sums.invest },
    ].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  }, [currentAssets]);

  // Convert equity companies to simulation format
  const equityCompaniesForSim = useMemo(() => {
    return equityCompanies.map(company => ({
      id: company.id,
      name: company.name,
      contracts: company.contracts,
      exitYear: company.exitConfig.exitYear,
      exitMonth: company.exitConfig.exitMonth,
      sharePriceAtExit: company.exitConfig.sharePriceAtExit,
      secondaryIls: company.exitConfig.secondaryIls,
      secondaryYear: company.exitConfig.secondaryYear,
      secondaryMonth: company.exitConfig.secondaryMonth,
      secondaryShares: company.exitConfig.secondaryShares,
    }));
  }, [equityCompanies]);

  // Effective property config (disabled means far future, no savings)
  const effectivePropertyConfig = useMemo(() => {
    if (!propertyPlan.enabled) {
      return { price: 0, year: 2100, monthlySavings: 0 };
    }
    return propertyPlan.config;
  }, [propertyPlan]);

  // Unrealized gain across the taxable portfolios — drives the cost basis, and
  // therefore how much capital-gains tax a withdrawal actually costs.
  const investmentInitialGain = useMemo(() => calculateLiquidGain(currentAssets), [currentAssets]);

  const glidepath = useMemo<GlidepathConfig>(() => ({
    enabled: glidepathEnabled,
    startAge: 55,
    endAge: 75,
    endEquityPct: 0.6,
    bondReturn: 3.5,
    bondVolatility: 6,
  }), [glidepathEnabled]);

  // Everything the projection depends on, in one object. Deferring it keeps
  // slider drags responsive: React renders the previous plans while the new
  // Monte Carlo runs.
  const halfTimeGap = halfTimeEnabled ? Math.max(0, stopWorkYear - transitionToHalfWorkYear) : 0;

  const planInputs = useMemo<EngineInputs>(() => ({
    investmentInitialValue,
    investmentInitialGain,
    pensionInitialValue,
    returnRate,
    annualVolatility,
    inflationRate,
    transitionToHalfWorkYear,
    stopWorkYear,
    budgetSummary,
    monthlyExpenses,
    yearlyExpenses,
    propertyConfig: effectivePropertyConfig,
    equityCompanies: equityCompaniesForSim,
    initialAge,
    baseYear: new Date().getFullYear(),
    startMonth: new Date().getMonth(),
    glidepath,
    withdrawalMode,
    successTarget,
    maxRise: MAX_RISE,
    maxFall: MAX_FALL,
    spendFloor,
    spendCap,
    equityConfidence,
    solverPaths: SOLVER_PATHS,
    displayPaths: DISPLAY_PATHS,
  }), [
    investmentInitialValue, investmentInitialGain, pensionInitialValue, returnRate,
    annualVolatility, inflationRate, transitionToHalfWorkYear, stopWorkYear,
    budgetSummary, monthlyExpenses, yearlyExpenses, effectivePropertyConfig,
    equityCompaniesForSim, initialAge, glidepath, withdrawalMode, successTarget,
    spendFloor, spendCap, equityConfidence,
  ]);

  // The forecast runs in a worker — see useProjectionEngine. Previous numbers
  // stay on screen while a new run is in flight.
  const gridInputs = useMemo<GridInputs>(() => ({
    ...planInputs,
    // Deliberately independent of the stop-work slider: the table's rows are
    // fixed years, so dragging that slider must not re-run these ten solves.
    halfTimeGap,
    years: RETIREMENT_GRID_YEARS,
  }), [planInputs, halfTimeGap]);

  const { plans, grid, plansPending, gridPending } = useProjectionEngine(planInputs, gridInputs);

  const plan = plans ? (activePlan === 'base' ? plans.base : plans.upside) : null;
  const retirementGrid = grid ?? [];

  // Base timeline for equity charts (60 months from the current year).
  const equityTimeline = useMemo(() => {
    const data: Array<{ index: number; label: string }> = [];
    const base = new Date(new Date().getFullYear(), 0, 1);
    for (let i = 0; i <= 60; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      data.push({
        index: i,
        label: `${d.getMonth() + 1}/${d.getFullYear()}`,
      });
    }
    return data;
  }, []);

  return (
    <div className="p-3 sm:p-6 bg-slate-50 min-h-screen text-right font-sans" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6 text-right">
        
        {/* Slim Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-right">
          <h1 className="text-xl font-black text-slate-800 tracking-tight order-first">
            מצב פיננסי
            <span className="text-[10px] font-bold text-slate-400 mr-2">מתעדכן מהעוזר</span>
          </h1>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <span className="text-blue-500">גיל {initialAge}</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-2xl border border-slate-200 shadow-inner text-[11px] font-bold max-w-full">
          {([
            [{ id: 'overview', label: 'סקירה', Icon: LayoutDashboard }],
            [
              { id: 'month', label: 'החודש', Icon: CalendarDays },
              { id: 'budget', label: 'תקציב', Icon: SlidersHorizontal },
              { id: 'archive', label: 'ארכיון', Icon: Archive },
              { id: 'yearly', label: 'מצב שנתי', Icon: BarChart3 },
            ],
            [
              { id: 'assets', label: 'נכסים', Icon: Wallet },
              { id: 'stocks', label: 'הון מנייתי', Icon: TrendingUp },
              { id: 'history', label: 'היסטוריה', Icon: History },
            ],
            [{ id: 'scenario', label: 'סימולציית עתיד', Icon: Rocket }],
          ] as { id: string; label: string; Icon: React.ComponentType<{ size?: number }> }[][]).map((group, gi, groups) => (
            <React.Fragment key={gi}>
              {group.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-2.5 sm:px-4 py-2 rounded-xl transition-all inline-flex items-center gap-1.5 whitespace-nowrap ${activeTab === id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
              {gi < groups.length - 1 && <span className="hidden sm:block w-px h-5 bg-slate-200 mx-0.5" />}
            </React.Fragment>
          ))}
          <button onClick={() => setPrivacy((p) => !p)} title={privacy ? 'הצג מספרים' : 'הסתר מספרים רגישים'} aria-pressed={privacy} className={`px-3 py-2 rounded-xl transition-all inline-flex items-center ms-auto ${privacy ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{privacy ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (() => {
          const curMonth = (ACT.months && ACT.months[ACT.current_month]) || { total_actual: 0 };
          const spent = curMonth.total_actual || 0;
          const today: number = ACT.today || 1;
          const daysInMonth: number = ACT.days_in_month || 30;
          const dayFrac = Math.min(1, today / daysInMonth);
          const monthPct = monthlyTotalSum > 0 ? Math.min(100, (spent / monthlyTotalSum) * 100) : 0;
          // green under budget, amber near it, red over (the day marker shows pace)
          const monthBarColor = barColor(spent, monthlyTotalSum);

          const yr = ACT.yearly || { monthly_actual: {}, upcoming: [], current_month: 1 };
          const curM: number = yr.current_month || 1;
          const elapsedMonths = elapsedMonthsOf(curM, today, daysInMonth);
          // Shared with YearlyTab — the two pace badges must agree.
          const { ytd, paceTarget, paceDelta } = yearPace(yr, monthlyTotalSum, yearlyExpenses, elapsedMonths); // positive = under target
          const savedYtd = (budgetSummary.totalIncomeNet + lockedMonthly) * elapsedMonths - ytd; // same as the yearly tab

          // Upcoming: trips from actuals + a single daycare marker + equity exits.
          const trips = (yr.upcoming || []).filter((u: any) => (u.amount || 0) >= 20000);
          const daycare = (yr.upcoming || []).find((u: any) => (u.amount || 0) < 20000);
          const thisYear = new Date().getFullYear();
          const exits = equityCompanies
            .filter((c) => c.exitConfig.exitYear >= thisYear && c.contracts.length > 0 && c.exitConfig.sharePriceAtExit > 0)
            .map((c) => ({ label: `אקזיט ${c.name}`, year: c.exitConfig.exitYear }));
          const monthName = (ym: string) => MONTHS_HE_SHORT[(parseInt(String(ym).slice(5, 7), 10) || 1) - 1];

          return (
            <div className="space-y-4 animate-in fade-in duration-500 pb-12 text-right">
              {/* KPI row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex flex-col justify-center text-right">
                  <span className="text-[10px] font-black uppercase mb-1 text-emerald-700">
                    משיכה חודשית ({activePlan === 'base' ? 'בלי אקזיטים' : 'עם אקזיטים'})
                  </span>
                  <span className={`text-xl font-black text-left text-emerald-700 ${privacy ? 'sensitive' : ''}`}>
                    {plan ? `₪${formatNumber(plan.headline)}` : '···'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-500 mt-0.5">
                    {plan ? `בכוח קנייה של היום · סיכוי לאזול ${(plan.failureRate * 100).toFixed(0)}%` : 'מחשב…'}
                  </span>
                </div>
                <StatCard label="נכסים היום" value={`₪${formatNumber(totalAssetsNow)}`} hidden={privacy} />
                <StatCard label="נזיל אחרי מס" value={`₪${formatNumber(calculateLiquidAfterTax(currentAssets))}`} tone="amber" hidden={privacy} />
                <StatCard
                  label={`חיסכון חודשי (${yearInPractice?.year ?? ''})`}
                  value={`₪${formatNumber(Math.round(savingMonthly))}`}
                  sub={`מהנטו ₪${formatNumber(Math.round(yearInPractice?.saving ?? 0))} + השתלמות ₪${formatNumber(Math.round(budgetSummary.totalStudyFundInflow || 0))} · כולל פנסיה ₪${formatNumber(Math.round(savingMonthly + (budgetSummary.totalPensionInflow || 0)))}`}
                  tone={savingMonthly >= 0 ? 'emerald' : 'rose'}
                  hidden={privacy}
                />
              </div>

              {/* Panels */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* This month */}
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 text-right flex flex-col">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-black text-slate-800 text-sm">החודש</h3>
                    <span className="text-[10px] font-bold text-slate-400">יום {today} מתוך {daysInMonth}</span>
                  </div>
                  <div className="relative h-2.5 bg-slate-100 rounded-full mb-1 overflow-visible">
                    <div className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${monthPct}%`, background: monthBarColor }} />
                    <div className="absolute -top-1 h-4 w-0.5 bg-slate-400 rounded" style={{ right: `${dayFrac * 100}%` }} title="איפה אנחנו בחודש" />
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-3">
                    <span>תקציב ₪{formatNumber(monthlyTotalSum)}</span>
                    <span>יצא ₪{formatNumber(spent)}</span>
                  </div>
                  <div className="space-y-1.5 text-xs flex-1">
                    <div className="flex justify-between"><span className="text-slate-500">נשאר מההכנסה החודש</span><span className={`font-black ${netIncomeMonthly - spent >= 0 ? 'text-emerald-700' : 'text-rose-600'} ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(netIncomeMonthly - spent)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">קצב מול תקציב</span><span className={`font-black ${spent <= monthlyTotalSum * dayFrac ? 'text-emerald-700' : 'text-amber-700'}`}>{monthlyTotalSum > 0 ? Math.round((spent / monthlyTotalSum) * 100) : 0}% מהתקציב</span></div>
                  </div>
                  <button onClick={() => setActiveTab('month')} className="mt-3 self-start text-[11px] font-black text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">לפירוט החודש <ChevronLeft size={12} /></button>
                </div>

                {/* This year */}
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 text-right flex flex-col">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-black text-slate-800 text-sm">השנה ({yr.year || thisYear})</h3>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${paceDelta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {paceDelta >= 0 ? `מתחת ליעד ב-₪${formatNumber(paceDelta)}` : `מעל היעד ב-₪${formatNumber(-paceDelta)}`}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs flex-1">
                    <div className="flex justify-between"><span className="text-slate-500">הוצאה מתחילת השנה</span><span className="font-black text-slate-800">₪{formatNumber(ytd)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">יעד יחסי עד היום</span><span className="font-black text-slate-500">₪{formatNumber(paceTarget)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">נחסך עד כה</span><span className={`font-black ${savedYtd >= 0 ? 'text-emerald-700' : 'text-rose-600'} ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(savedYtd)}</span></div>
                  </div>
                  <button onClick={() => setActiveTab('yearly')} className="mt-3 self-start text-[11px] font-black text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">למצב השנתי <ChevronLeft size={12} /></button>
                </div>

                {/* Upcoming */}
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 text-right flex flex-col">
                  <h3 className="font-black text-slate-800 text-sm mb-3">בקרוב</h3>
                  <div className="space-y-1.5 flex-1">
                    {trips.map((u: any, i: number) => (
                      <div key={i} className="flex justify-between items-center text-xs bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
                        <span className="font-bold text-amber-700">{monthName(u.ym)} · {u.label}</span>
                        <span className="font-black text-amber-700">₪{formatNumber(u.amount)}</span>
                      </div>
                    ))}
                    {daycare && (
                      <div className="flex justify-between items-center text-xs bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-1.5">
                        <span className="font-bold text-indigo-700">מ{monthName(daycare.ym)} · {daycare.label}</span>
                        <span className="font-black text-indigo-700">₪{formatNumber(daycare.amount)}/חודש</span>
                      </div>
                    )}
                    {exits.map((x, i) => (
                      <div key={`x${i}`} className={`flex justify-between items-center text-xs bg-sky-50 border border-sky-100 rounded-xl px-3 py-1.5 ${privacy ? 'sensitive' : ''}`}>
                        <span className="font-bold text-sky-700">{x.label}</span>
                        <span className="font-black text-sky-700">{x.year}</span>
                      </div>
                    ))}
                    {trips.length === 0 && !daycare && exits.length === 0 && (
                      <p className="text-xs text-slate-400">אין אירועים גדולים על הרדאר.</p>
                    )}
                  </div>
                  <button onClick={() => setActiveTab('stocks')} className="mt-3 self-start text-[11px] font-black text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">להון המנייתי <ChevronLeft size={12} /></button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 animate-in fade-in duration-500 text-right">
            <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center justify-end gap-2">
              <Wallet className="text-emerald-500" /> הרכב הון נוכחי
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-right">
              <div className="space-y-3 text-right">
                {currentAssets.map((asset) => (
                  <div key={asset.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-transparent text-right">
                    <span className="flex-1 font-bold text-slate-700 text-sm">{asset.name}</span>
                    <span className="w-16 text-[11px] font-bold text-slate-500">
                      {asset.type === 'pension' ? 'פנסיה' : asset.type === 'invest' ? 'נדל״ן' : 'נזיל'}
                    </span>
                    {asset.type === 'liquid' && (
                      <span className={`w-24 text-left font-black text-xs text-amber-700 ${privacy ? 'sensitive' : ''}`}>
                        ₪{formatNumber(asset.gainIls || 0)}
                      </span>
                    )}
                    <span className={`w-32 text-left font-black text-sm text-slate-800 ${privacy ? 'sensitive' : ''}`}>
                      ₪{formatNumber(asset.value)}
                    </span>
                  </div>
                ))}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] font-bold text-slate-400">
                  <div className="p-2 bg-emerald-50 rounded-xl">
                    <div className="text-slate-400 uppercase tracking-wide">נזיל</div>
                    <div className={`text-emerald-700 font-black text-sm mt-1 ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(currentAssets.filter(a => a.type === 'liquid').reduce((s, a) => s + (a.value || 0), 0))}</div>
                  </div>
                  <div className="p-2 bg-blue-50 rounded-xl">
                    <div className="text-slate-400 uppercase tracking-wide">פנסיה</div>
                    <div className={`text-blue-700 font-black text-sm mt-1 ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(currentAssets.filter(a => a.type === 'pension').reduce((s, a) => s + (a.value || 0), 0))}</div>
                  </div>
                  <div className="p-2 bg-indigo-50 rounded-xl">
                    <div className="text-slate-400 uppercase tracking-wide">נדל״ן</div>
                    <div className={`text-indigo-700 font-black text-sm mt-1 ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(currentAssets.filter(a => a.type === 'invest').reduce((s, a) => s + (a.value || 0), 0))}</div>
                  </div>
                  <div className="p-2 bg-amber-50 rounded-xl">
                    <div className="text-slate-400 uppercase tracking-wide">נזיל אחרי מס</div>
                    <div className={`text-amber-700 font-black text-sm mt-1 ${privacy ? 'sensitive' : ''}`}>₪{formatNumber(calculateLiquidAfterTax(currentAssets))}</div>
                    <div className={`text-[9px] text-slate-400 font-bold mt-0.5 leading-tight ${privacy ? 'sensitive' : ''}`}>מס {Math.round(LIQUID_GAIN_TAX_RATE*100)}% על רווח ₪{formatNumber(calculateLiquidGain(currentAssets))}</div>
                  </div>
                </div>
                <p className="text-[9px] text-slate-400 font-bold mt-2">בשורות נזילות: הכתום = רווח לא ממומש (לחישוב המס), הלבן = שווי. עדכון דרך העוזר.</p>
              </div>
              <div className={privacy ? 'sensitive' : ''}>
                <CategoryPie data={assetPieData} title="הרכב ההון" suffix="" />
              </div>
            </div>
          </div>
        )}

        {/* Budget Tab */}
        {activeTab === 'budget' && yearInPractice && (
          <BudgetTab
            year={yearInPractice.year}
            currentYm={`${yearInPractice.year}-${String(ACT.yearly?.current_month || 12).padStart(2, '0')}`}
            income={budgetSummary.totalIncomeNet}
            spend={yearInPractice.spend}
            savingNet={yearInPractice.saving}
            studyFund={budgetSummary.totalStudyFundInflow || 0}
            pension={budgetSummary.totalPensionInflow || 0}
            normalMonth={normalizedSpend}
            yearlySpread={yearlyMonthlyAvgRecurring}
            restOfYearMonthly={yearInPractice.breakdown.futureMonthly}
            outliers={yearInPractice.outliers}
            yearTotal={yearInPractice.breakdown.total}
            monthlyExpenses={monthlyExpenses}
            yearlyExpenses={yearlyExpenses}
            privacy={privacy}
          />
        )}

        {/* Stocks Tab */}
        {activeTab === 'stocks' && (
          <div className={`space-y-8 animate-in slide-in-from-left-4 duration-500 pb-12 text-right ${privacy ? 'sensitive' : ''}`}>
            {/* Dynamic Equity Company Panels */}
            {equityCompanies.map((company) => {
              const colorClasses: Record<string, { border: string; bg: string; text: string; fill: string; stroke: string }> = {
                indigo: { border: 'border-indigo-100', bg: 'bg-indigo-600', text: 'text-indigo-500', fill: '#e4e6ee', stroke: '#5c6578' },
                purple: { border: 'border-purple-100', bg: 'bg-purple-600', text: 'text-purple-500', fill: '#e8e6ee', stroke: '#8a80a0' },
                emerald: { border: 'border-emerald-100', bg: 'bg-emerald-600', text: 'text-emerald-500', fill: '#e4ebe6', stroke: '#6d907c' },
                rose: { border: 'border-rose-100', bg: 'bg-rose-600', text: 'text-rose-500', fill: '#eee6e7', stroke: '#b08088' },
                blue: { border: 'border-blue-100', bg: 'bg-blue-600', text: 'text-blue-500', fill: '#e6e8ee', stroke: '#6d7c94' },
                amber: { border: 'border-amber-100', bg: 'bg-amber-600', text: 'text-amber-500', fill: '#eee9df', stroke: '#b0956a' },
              };
              const colors = colorClasses[company.color] || colorClasses.blue;
              const totalShares = company.totalShares || company.contracts.reduce((sum, c) => sum + c.shares, 0);
              const baseYear = new Date().getFullYear();
              const vestingData = equityTimeline.map(point => {
                const vesting = getVestingAtDate(company.contracts, new Date(baseYear, point.index, 1));
                return { ...point, vested: Math.round(vesting.totalVested), cost: Math.round(vesting.totalCost), details: vesting.details };
              });

              return (
                <div key={company.id} className={`bg-white p-6 sm:p-8 rounded-3xl shadow-sm border ${colors.border} text-right`}>
                  <div className="flex flex-col md:flex-row justify-between gap-6 mb-6 border-b border-slate-100 pb-6 text-right">
                    <div className="flex items-center gap-4 text-right">
                      <div className={`p-4 ${colors.bg} text-white rounded-2xl shadow-lg`}>
                        {company.color === 'purple' ? <Sparkles size={32}/> : <BarChart3 size={32}/>}
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-slate-800">{company.name}</h3>
                        <p className="text-slate-400 font-bold mt-1 text-sm italic">
                          {company.ownerName} · {totalShares.toLocaleString()} מניות · {company.contracts.length} חוזים
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 flex-1 text-right">
                      <EquityMetric label="שנת אקזיט" val={String(company.exitConfig.exitYear)} />
                      <EquityMetric label="חודש" val={String(company.exitConfig.exitMonth || 1)} />
                      <EquityMetric label="מחיר מניה ($)" val={`$${company.exitConfig.sharePriceAtExit}`} />
                    </div>
                  </div>

                  <div className="mb-8">
                    <h4 className="font-black text-slate-500 uppercase text-[11px] tracking-widest mb-4">חוזי הון</h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-auto">
                      {/* Header row */}
                      <div className="flex items-center gap-2 px-3 text-[10px] font-bold text-slate-400 uppercase min-w-[680px]">
                        <span className="flex-1">שם חוזה</span>
                        <span className="w-20 text-center">מניות</span>
                        <span className="w-16 text-center">סטרייק $</span>
                        <span className="w-32 text-center">תאריך התחלה</span>
                        <span className="w-14 text-center">שנות הבשלה</span>
                        <span className="w-14 text-center">קליף (ח׳)</span>
                        <span className="w-24 text-center">סוג קליף</span>
                        <span className="w-6"></span>
                      </div>
                      {company.contracts.map((contract, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl min-w-[640px]">
                          <span className="flex-1 font-bold text-slate-700 text-sm">{contract.name}</span>
                          <span className="w-20 text-center font-black text-xs">{contract.shares.toLocaleString()}</span>
                          <span className="w-16 text-center font-black text-xs">${contract.strike}</span>
                          <span className="w-32 text-center text-xs">{contract.startDate}</span>
                          <span className="w-14 text-center font-black text-xs">{contract.periodYears}</span>
                          <span className="w-14 text-center font-black text-xs">{contract.cliffMonths ?? 0}</span>
                          <span className="w-24 text-center text-[10px] font-bold text-slate-600">
                            {(contract.cliffType ?? 'standard') === 'delayed-linear' ? 'קו ישר אחרי קליף' : 'רגיל'}
                          </span>
                        </div>
                      ))}
                      {company.contracts.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-4">אין חוזים. מבקשים מהעוזר להוסיף.</p>
                      )}
                    </div>
                    {!!company.exitConfig.secondaryIls && (
                      <p className="mt-4 text-sm font-bold text-slate-600">
                        סקנדרי: ₪{formatNumber(company.exitConfig.secondaryIls)} ב-{company.exitConfig.secondaryMonth || 1}/{company.exitConfig.secondaryYear}
                        {company.exitConfig.secondaryShares ? ` · ${company.exitConfig.secondaryShares.toLocaleString()} מניות` : ''}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-right">
                    {(() => {
                      // Calculate vested shares at exit date
                      const exitDate = new Date(company.exitConfig.exitYear, (company.exitConfig.exitMonth ?? 1) - 1, 1);
                      const vestingAtExit = getVestingAtDate(company.contracts, exitDate);
                      // Shares sold in the secondary are gone by the exit.
                      const sold = Math.min(vestingAtExit.totalVested, company.exitConfig.secondaryShares ?? 0);
                      const vestedShares = vestingAtExit.totalVested - sold;
                      const costBasis = vestingAtExit.totalVested > 0
                        ? vestingAtExit.totalCost * (vestedShares / vestingAtExit.totalVested) : 0;

                      // Gross value in ILS (price * shares * exchange rate - cost basis)
                      const grossValueUsd = vestedShares * company.exitConfig.sharePriceAtExit;
                      const grossValueIls = grossValueUsd * USD_ILS;
                      const costBasisIls = costBasis * USD_ILS;
                      const profit = grossValueIls - costBasisIls;
                      const netValue = calculateNetEquity(profit);

                      return (
                        <div className="space-y-8 text-right">
                          <h4 className="font-black text-slate-500 uppercase text-[11px] tracking-widest flex items-center justify-end gap-3">
                            <Target size={16}/> אומדן רווח נקי (מניות שהבשילו עד האקזיט · שער $ {USD_ILS})
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-right">
                            <EquityMetric 
                              label={`מניות שהבשילו (${company.exitConfig.exitYear})`}
                              val={`${Math.round(vestedShares).toLocaleString()} / ${totalShares.toLocaleString()}`} 
                            />
                            <EquityMetric 
                              label="ברוטו (רווח)" 
                              val={`₪${(profit/1000000).toFixed(2)}M`} 
                            />
                            <EquityMetric 
                              label="נטו (אחרי מס)" 
                              val={`₪${netValue.toLocaleString()}`} 
                              color={colors.text} 
                            />
                          </div>
                        </div>
                      );
                    })()}
                    <div className="h-64 text-right">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={vestingData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
                          <XAxis dataKey="label" fontSize={9} interval={11} />
                          <Tooltip content={({active, payload}) => { 
                            if (active && payload && payload.length) { 
                              const d = payload[0].payload; 
                              return (
                                <div className="bg-white p-4 shadow-xl border border-slate-100 rounded-2xl text-right min-w-[200px]">
                                  <p className="font-bold border-b border-slate-100 mb-2">{d.label}</p>
                                  {d.details.map((det: any) => (
                                    <div key={det.name} className="flex justify-between gap-6 text-[10px]">
                                      <span className="text-slate-500">{det.name}:</span>
                                      <span className="font-black">{det.vested.toLocaleString()}</span>
                                    </div>
                                  ))}
                                  <div className={`border-t border-slate-100 mt-2 pt-2 flex justify-between font-black ${colors.text} text-xs`}>
                                    <span>עלות קנייה:</span>
                                    <span>₪{(d.cost * USD_ILS).toLocaleString()}</span>
                                  </div>
                                </div>
                              ); 
                            } 
                            return null; 
                          }}/>
                          <Area type="monotone" dataKey="vested" stroke={colors.stroke} fill={colors.fill} strokeWidth={4} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Property Panel */}
            <div className={`bg-white p-6 sm:p-8 rounded-3xl shadow-sm border ${propertyPlan.enabled ? 'border-slate-200' : 'border-slate-100 opacity-60'} flex flex-col md:flex-row gap-6 items-center text-right`}>
              <div className={`p-4 ${propertyPlan.enabled ? 'bg-slate-800' : 'bg-slate-400'} text-white rounded-2xl shadow-xl shadow-slate-100`}>
                <Home size={32}/>
              </div>
              <div className="flex-1 space-y-2 text-right">
                <h4 className="text-2xl font-black text-slate-800 tracking-tight">קניית דירה למגורים בהמשך</h4>
                <p className="text-sm text-slate-500 font-medium italic">
                  {propertyPlan.enabled
                    ? `רכישת דירה ב-₪${(propertyPlan.config.price/1000000).toFixed(1)}M בשנת ${propertyPlan.config.year}. לאחר הרכישה נחסוך ₪${formatNumber(propertyPlan.config.monthlySavings)} בחודש (למשל: שכירות).`
                    : 'רכישת דירה מושבתת - ממשיכים לשלם שכירות. שינוי דרך העוזר.'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scenario Tab */}
        {activeTab === 'scenario' && (
          <div className={`space-y-4 animate-in fade-in duration-500 pb-12 text-right ${privacy ? 'sensitive' : ''}`}>
            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100 text-right">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h3 className="font-black text-slate-800 text-sm">ההנחות של התוכנית</h3>
                <span className="text-[11px] font-bold text-slate-400">משתנה רק דרך העוזר</span>
              </div>
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">מפסיקים לעבוד</dt>
                  <dd className="font-black text-blue-600 text-lg">בעוד {stopWorkYear} שנים</dd>
                  <dd className="text-[11px] text-slate-400">גיל {initialAge + stopWorkYear} · שנת {new Date().getFullYear() + stopWorkYear}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">רמת ביטחון</dt>
                  <dd className="font-black text-slate-800">{Math.round(successTarget * 100)}% מהתרחישים</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">תקרת רמת חיים</dt>
                  <dd className="font-black text-slate-800">{spendCap > 0 ? `₪${formatNumber(spendCap)}` : 'בלי תקרה'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">חצי משרה</dt>
                  <dd className="font-black text-slate-800">{halfTimeEnabled ? `מגיל ${initialAge + transitionToHalfWorkYear}` : 'אין'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">תשואה / תנודתיות / אינפלציה</dt>
                  <dd className="font-black text-slate-800">{returnRate}% · {annualVolatility}% · {inflationRate}%</dd>
                  <dd className="text-[11px] text-slate-400">ריאלי {(((1 + returnRate / 100) / (1 + inflationRate / 100) - 1) * 100).toFixed(1)}%. זה המספר שקובע בפועל.</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400">אקזיטים</dt>
                  <dd className="font-black text-slate-800">אמון {Math.round(equityConfidence * 100)}%</dd>
                  <dd className="text-[11px] text-slate-400">{glidepathEnabled ? '100% מניות עד 60% בגיל 75' : '100% מניות לכל החיים'}</dd>
                </div>
              </dl>
            </div>

            {/* The two plans */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {([
                ['base', 'בלי אקזיטים', 'רק משכורות ומה שיש בפועל היום. זו הרצפה.', plans?.base],
                ['upside', 'עם אקזיטים', 'כולל תמורת האקזיטים כפי שהם מודלים בלשונית ההון המנייתי.', plans?.upside],
              ] as const).map(([id, title, blurb, pl]) => {
                const selected = activePlan === id;
                // What a fixed plan leaves behind at 90. It is large by design:
                // sizing spending to survive a bad future means that in a
                // typical future the money outgrows the withdrawals.
                const leftover = pl?.finalWealthRealP50 ?? 0;
                return (
                  <button
                    key={id}
                    onClick={() => setActivePlan(id)}
                    className={`text-right p-5 rounded-3xl border-2 bg-white transition-all ${selected ? 'border-blue-500 shadow-lg' : 'border-slate-100 opacity-70 hover:opacity-100 hover:border-slate-300'}`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <div>
                        <h3 className="font-black text-slate-800 text-sm">{title}</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 max-w-[30ch]">{blurb}</p>
                      </div>
                      {selected && <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-1 rounded-full">בגרף</span>}
                    </div>

                    <div className="text-3xl font-black text-slate-800 text-left">
                      {pl ? `₪${formatNumber(pl.headline)}` : <span className="text-slate-300">···</span>}
                    </div>
                    <div
                      className="text-[10px] font-bold text-slate-400 text-left mb-3"
                      title="כל הסכומים הם בכוח הקנייה של היום. הסכום בפועל גדל עם המדד, ומעבר לכך מתעדכן פעם בשנה לפי מצב התיק."
                    >
                      לחודש, בשנת הפרישה הראשונה · בשקלים של היום
                    </div>

                    <div className="space-y-1.5 text-[11px] border-t border-slate-100 pt-3">
                      {(() => {
                        // The typical-path trajectory, but only until it hits the
                        // ceiling — four rows of the same capped figure said nothing.
                        const atCap = (v: number | undefined) => spendCap > 0 && v != null && v >= spendCap * 0.995;
                        if (pl && atCap(pl.headline)) {
                          return <div className="text-[10px] font-bold text-slate-400">בתקרה כבר מהשנה הראשונה</div>;
                        }
                        const rows: React.ReactNode[] = [];
                        for (const age of TRAJECTORY_AGES) {
                          if (age <= initialAge + stopWorkYear) continue;
                          const amount = pl?.spendByAge?.[age];
                          const capped = atCap(amount);
                          rows.push(
                            <div key={age} className="flex justify-between">
                              <span className="text-slate-500">{capped ? `מגיע לתקרה עד גיל ${age}` : `בגיל ${age}`}</span>
                              <span className="font-black text-slate-700">
                                {amount != null ? `₪${formatNumber(Math.round(amount))}` : '—'}
                              </span>
                            </div>,
                          );
                          if (capped) break;
                        }
                        return rows.length ? (
                          <>
                            <div className="text-[10px] font-bold text-slate-400 pb-0.5">בתרחיש טיפוסי המשיכה עולה:</div>
                            {rows}
                          </>
                        ) : null;
                      })()}
                      {spendCap > 0 && (
                        <div className="flex justify-between pt-1.5 border-t border-slate-100">
                          <span className="text-slate-500">אפשר להפסיק לעבוד</span>
                          <span className="font-black text-blue-600">
                            {pl
                              ? pl.earliestYearForCap != null
                                ? `בגיל ${initialAge + pl.earliestYearForCap}`
                                : 'לא מגיע לתקרה'
                              : '—'}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          מס לאורך החיים <span className="text-slate-300">· חציון</span>
                        </span>
                        <span className="font-black text-slate-600">
                          {pl ? `₪${formatNumber(pl.lifetimeTax)}` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1.5 border-t border-slate-100">
                        <span className="text-slate-500">סיכוי שהכסף ייגמר</span>
                        <span className={`font-black ${(pl?.failureRate ?? 0) < 0.05 ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {pl ? `${((pl.failureRate) * 100).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">
                          {spendCap > 0 ? 'נצבר מעבר לתקרה' : 'נשאר בגיל 90'}{' '}
                          <span className="text-slate-300">· חציון</span>
                        </span>
                        <span className="font-black text-slate-500">
                          {pl ? `₪${formatNumber(leftover)}` : '—'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <details className="px-1 -mt-1 text-[11px] text-slate-400 leading-relaxed">
              <summary className="cursor-pointer font-bold text-slate-500 list-none">איך מחושבת המשיכה? ›</summary>
              <p className="mt-2">
              <b className="text-slate-500">איך זה עובד:</b> פעם בשנה בודקים מה יש בתיק וכמה שנים נשארו
              ומעדכנים את המשיכה, אבל לא יותר מ-20% למעלה או 10% למטה משנה קודמת — וגם אף פעם לא מעבר
              לתקרת רמת החיים. זה מה שרוב היועצים מריצים בפועל.
              <br />
              <b className="text-slate-500">למה יש בכל זאת צבירה:</b> ככל שהאופק מתקצר אפשר למשוך אחוז
              גבוה יותר, אז מתמטית "לסיים באפס" דורש להוציא פי כמה בגיל 80. אם זה לא ריאלי — והוא לא —
              הכסף העודף פשוט נצבר. <b className="text-slate-500">אי אפשר לקבל את שלושת אלה יחד:</b>
              רמת חיים קבועה וסבירה, פרישה מוקדמת, ולא להשאיר כלום. צריך לוותר על אחד.
              <br />
              <b className="text-slate-500">מה עושים עם זה:</b> אם יש עודף גדול, המנוף הוא
              "אפשר להפסיק לעבוד" בכרטיס — להמיר את הכסף לזמן במקום לירושה. או לתת מתנות בחיים,
              כשזה מועיל.
              <br />
              <b className="text-slate-500">המחיר:</b> בערך אחת לשלוש שנים תהיה הורדה (עד 10%).
              כל הסכומים בכוח הקנייה של היום.
              </p>
            </details>

            {/* How the answer moves with the retirement date */}
            <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-100 text-right">
              <h3 className="font-black text-slate-800 text-sm mb-1">כמה נוכל למשוך, לפי מתי נפסיק לעבוד</h3>
              <p className="text-[11px] text-slate-400 mb-4">
                {`המשיכה בשנה הראשונה, בכוח הקנייה של היום. מכוילת כך שהכסף יחזיק עד 90 ב-${Math.round(successTarget * 100)}% מהתרחישים, ומתעדכנת כל שנה.`}
              </p>
              <div className={`overflow-x-auto ${gridPending && retirementGrid.length > 0 ? 'opacity-50 transition-opacity' : 'transition-opacity'}`}>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="text-right pb-2 font-bold">מפסיקים לעבוד</th>
                      <th className="text-left pb-2 font-bold">בלי אקזיטים</th>
                      <th className="text-left pb-2 font-bold">עם אקזיטים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retirementGrid.length === 0 && (
                      <tr><td colSpan={3} className="py-6 text-center text-[11px] text-slate-400">מחשב…</td></tr>
                    )}
                    {retirementGrid.map((row) => {
                      const current = row.year === stopWorkYear;
                      return (
                        <tr
                          key={row.year}
                          className={`border-t border-slate-100 ${current ? 'bg-blue-50/60' : ''}`}
                        >
                          <td className="py-2.5 font-bold text-slate-700">
                            בעוד {row.year} שנים
                            <span className="text-slate-400 font-normal"> · גיל {initialAge + row.year}</span>
                            {current && <span className="mr-2 text-[9px] font-black bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">נבחר</span>}
                          </td>
                          <td className="py-2.5 text-left font-black text-slate-800">₪{formatNumber(row.base)}</td>
                          <td className="py-2.5 text-left font-black text-emerald-700">₪{formatNumber(row.upside)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 mt-3">
                להשוואה — ההוצאה השוטפת שלנו היום: ₪{formatNumber(Math.round(normalizedSpend))} לחודש.
              </p>
            </div>

            {plan && (
              <div className={plansPending ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                <FanChart
                  bands={plan.bands}
                  initialAge={initialAge}
                  stopWorkYear={stopWorkYear}
                  failureRate={plan.failureRate}
                  medianRuinAge={plan.medianRuinAge}
                  paths={plan.paths}
                />
              </div>
            )}

            {plan && (
            <SimulationChart
              data={plan.points}
              initialAge={initialAge}
              baseYear={new Date().getFullYear()}
              transitionToHalfWorkYear={transitionToHalfWorkYear}
              stopWorkYear={stopWorkYear}
              equityCompanies={equityCompanies}
              propertyYear={propertyPlan.config.year}
              propertyEnabled={propertyPlan.enabled}
              inflationRate={inflationRate}
            />
            )}

          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && <div className={privacy ? 'sensitive' : ''}><HistoryTab /></div>}
        {activeTab === 'month' && <MonthActualsTab monthlyExpenses={monthlyExpenses} income={salaryData.person1Net + salaryData.person2Net} />}
        {activeTab === 'archive' && <ArchiveTab monthlyExpenses={monthlyExpenses} income={salaryData.person1Net + salaryData.person2Net} />}
        {activeTab === 'yearly' && <YearlyTab monthlyExpenses={monthlyExpenses} yearlyExpenses={yearlyExpenses} income={budgetSummary.totalIncomeNet} privacy={privacy} monthlyPensionIn={budgetSummary.totalPensionInflow} monthlyStudyIn={budgetSummary.totalStudyFundInflow || 0} assets={currentAssets} />}
        <CommentLayer tab={activeTab} />
      </div>
    </div>
  );
};

export default App;
