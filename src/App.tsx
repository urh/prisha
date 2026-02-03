import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, ReferenceArea
} from 'recharts';
import { 
  Wallet, ArrowUpRight, ShieldCheck, Clock, Plus, Trash2, 
  Home, BarChart3, Sparkles, ZoomIn, RefreshCcw, Target,
  Download, Upload, X, Building2, AlertCircle
} from 'lucide-react';
import type { 
  Asset, Expense, SalaryData, 
  EquityContract 
} from './types';
import {
  calculateNetEquity,
  getVestingAtDate,
  calculateBudgetSummary,
  calculateTotalAssets,
  calculatePensionValue,
  calculateInvestmentValue,
  findOptimalWithdrawal,
} from './utils/calculations';
import {
  EquityCompany,
  PropertyPlan,
  AppExportData,
  EXPORT_VERSION,
  importFromJson,
  downloadAsJson,
  readFileAsText,
  createDefaultEquityCompany,
  createDefaultContract,
} from './utils/storage';
import {
  defaultAssets,
  defaultMonthlyExpenses,
  defaultYearlyExpenses,
  defaultSalaryData,
  defaultEquityCompanies,
  defaultPropertyPlan,
  defaultSimulationParams,
  DEFAULT_INITIAL_AGE,
  END_OF_LIFE_AGE,
} from './data/defaultState';

// Number formatting helper
const formatNumber = (num: number): string => {
  return Math.round(num).toLocaleString('en-US');
};

// Formatted number input component
interface FormattedNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

const FormattedNumberInput: React.FC<FormattedNumberInputProps> = ({ value, onChange, className }) => {
  const [displayValue, setDisplayValue] = useState(formatNumber(value));
  const [isFocused, setIsFocused] = useState(false);

  // Update display when value changes externally
  React.useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatNumber(value));
    }
  }, [value, isFocused]);

  return (
    <input
      type="text"
      className={className}
      value={displayValue}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.-]/g, '');
        setDisplayValue(e.target.value);
        onChange(parseFloat(raw) || 0);
      }}
      onFocus={() => {
        setIsFocused(true);
        setDisplayValue(value.toString());
      }}
      onBlur={() => {
        setIsFocused(false);
        setDisplayValue(formatNumber(value));
      }}
    />
  );
};

// State persistence constants
const STATE_STORAGE_KEY = 'prisha-financial-state';
const SAVE_DEBOUNCE_MS = 2000; // Save after 2 seconds of no changes

// Atomic Components
interface StockInputProps {
  label: string;
  val: number;
  onChange: (v: number) => void;
}

const StockInput: React.FC<StockInputProps> = ({ label, val, onChange }) => (
  <div className="space-y-0.5 text-right">
    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
    <input 
      type="number" 
      className="w-full p-2 bg-slate-50 border border-slate-100 rounded-xl font-black text-sm outline-none focus:ring-2 focus:ring-blue-200 transition-all text-left" 
      value={val} 
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)} 
    />
  </div>
);

interface MiniCardProps {
  label: string;
  value: number;
  color: 'slate' | 'rose';
}

const MiniCard: React.FC<MiniCardProps> = ({ label, value, color }) => {
  const themes = { 
    slate: "bg-slate-900 text-emerald-400", 
    rose: "bg-white text-slate-800 border border-slate-100 shadow-sm" 
  };
  return (
    <div className={`${themes[color]} p-4 rounded-2xl flex flex-col justify-center min-w-[150px] shadow-sm text-right`}>
      <span className="text-[9px] font-black uppercase mb-1 opacity-60">{label}</span>
      <span className="text-lg font-black tracking-tighter text-left">₪{formatNumber(value || 0)}</span>
    </div>
  );
};

interface SalaryBoxProps {
  name: string;
  gross: number;
  net: number;
  onGross: (v: number) => void;
  onNet: (v: number) => void;
}

const SalaryBox: React.FC<SalaryBoxProps> = ({ name, gross, net, onGross, onNet }) => (
  <div className="space-y-3 p-4 bg-white rounded-3xl border border-slate-100 shadow-sm text-right">
    <p className="text-xs font-black text-slate-500 uppercase border-b pb-1">{name}</p>
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-slate-400 uppercase">ברוטו</label>
      <FormattedNumberInput 
        className="w-full bg-slate-50 border border-slate-100 rounded p-1 text-sm font-black outline-none focus:ring-1 focus:ring-blue-100 text-right" 
        value={gross || 0} 
        onChange={onGross} 
      />
    </div>
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-slate-400 uppercase">נטו</label>
      <FormattedNumberInput 
        className="w-full bg-slate-50 border border-slate-100 rounded p-1 text-sm font-black outline-none focus:ring-1 focus:ring-blue-100 text-right" 
        value={net || 0} 
        onChange={onNet} 
      />
    </div>
  </div>
);

interface BudgetRowProps {
  item: Expense;
  onUpdate: (field: string, value: string | number) => void;
  onDelete: () => void;
}

const BudgetRow: React.FC<BudgetRowProps> = ({ item, onUpdate, onDelete }) => (
  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl group hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-100 text-right">
    <input 
      className="flex-1 bg-transparent border-none font-bold text-slate-700 outline-none focus:ring-0 text-sm text-right" 
      value={item.name} 
      onChange={(e) => onUpdate('name', e.target.value)} 
    />
    <FormattedNumberInput 
      className="w-24 bg-white border border-slate-100 rounded p-1 text-center font-black text-slate-800 text-xs text-left" 
      value={item.amount || 0} 
      onChange={(v) => onUpdate('amount', v)} 
    />
    <button 
      onClick={onDelete} 
      className="text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all outline-none"
    >
      <Trash2 size={14}/>
    </button>
  </div>
);

interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: 'blue' | 'orange' | 'emerald' | 'purple';
}

const ControlSlider: React.FC<ControlSliderProps> = ({ label, value, min, max, step, onChange, color }) => {
  const colors = { 
    blue: "text-blue-600", 
    orange: "text-orange-600", 
    emerald: "text-emerald-600", 
    purple: "text-purple-600" 
  };
  return (
    <div className="space-y-3 text-right">
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</label>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={value} 
        onChange={(e) => onChange(parseFloat(e.target.value))} 
        className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-600" 
      />
      <div className={`text-left font-black text-sm ${colors[color]}`}>
        {label.includes('%') ? `${value}%` : `${value} שנים`}
      </div>
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

// Load state from localStorage
const loadSavedState = () => {
  try {
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed;
    }
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
  const [activeTab, setActiveTab] = useState<string>('assets');
  const [returnRate, setReturnRate] = useState<number>(savedState?.simulationParams?.returnRate ?? defaultSimulationParams.returnRate);
  const [inflationRate, setInflationRate] = useState<number>(savedState?.simulationParams?.inflationRate ?? defaultSimulationParams.inflationRate);
  const [transitionToHalfWorkYear, setTransitionToHalfWorkYear] = useState<number>(savedState?.simulationParams?.transitionToHalfWorkYear ?? defaultSimulationParams.transitionToHalfWorkYear);
  const [stopWorkYear, setStopWorkYear] = useState<number>(savedState?.simulationParams?.stopWorkYear ?? defaultSimulationParams.stopWorkYear);
  
  // Initial age (editable, affects simulation)
  const [initialAge, setInitialAge] = useState<number>(savedState?.initialAge ?? DEFAULT_INITIAL_AGE);

  const [salaryData, setSalaryData] = useState<SalaryData>(savedState?.salaryData ?? defaultSalaryData);

  const [currentAssets, setCurrentAssets] = useState<Asset[]>(savedState?.assets ?? defaultAssets);
  const [monthlyExpenses, setMonthlyExpenses] = useState<Expense[]>(savedState?.monthlyExpenses ?? defaultMonthlyExpenses);
  const [yearlyExpenses, setYearlyExpenses] = useState<Expense[]>(savedState?.yearlyExpenses ?? defaultYearlyExpenses);

  // Dynamic equity companies
  const [equityCompanies, setEquityCompanies] = useState<EquityCompany[]>(savedState?.equityCompanies ?? defaultEquityCompanies);
  
  // Property plan (can be disabled)
  const [propertyPlan, setPropertyPlan] = useState<PropertyPlan>(savedState?.propertyPlan ?? defaultPropertyPlan);
  
  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Auto-save with debounce
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const saveState = useCallback(() => {
    const stateToSave = {
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
      },
    };
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [initialAge, currentAssets, monthlyExpenses, yearlyExpenses, salaryData, equityCompanies, propertyPlan, returnRate, inflationRate, transitionToHalfWorkYear, stopWorkYear]);
  
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

  // Zoom States
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [leftIdx, setLeftIdx] = useState<number | 'dataMin'>('dataMin');
  const [rightIdx, setRightIdx] = useState<number | 'dataMax'>('dataMax');

  // Helper functions
  const updateRowGeneric = <T extends { id: number }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>, 
    items: T[], 
    idx: number, 
    field: keyof T, 
    val: T[keyof T]
  ) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: val };
    setter(next);
  };
  
  const deleteRowGeneric = <T,>(
    setter: React.Dispatch<React.SetStateAction<T[]>>, 
    items: T[], 
    idx: number
  ) => setter(items.filter((_, i) => i !== idx));
  
  const addRowGeneric = <T,>(
    setter: React.Dispatch<React.SetStateAction<T[]>>, 
    items: T[], 
    template: T
  ) => setter([...items, template]);

  // Zoom handlers
  const handleMouseDown = (e: any) => { 
    if (e && e.activeLabel !== null) setRefAreaLeft(e.activeLabel); 
  };
  
  const handleMouseMove = (e: any) => { 
    if (e && refAreaLeft !== null) setRefAreaRight(e.activeLabel); 
  };
  
  const handleZoom = () => {
    if (refAreaLeft === null || refAreaRight === null || refAreaLeft === refAreaRight) {
      setRefAreaLeft(null); 
      setRefAreaRight(null); 
      return;
    }
    setLeftIdx(Math.min(refAreaLeft, refAreaRight));
    setRightIdx(Math.max(refAreaLeft, refAreaRight));
    setRefAreaLeft(null); 
    setRefAreaRight(null);
  };
  
  const handleZoomOut = () => { 
    setLeftIdx('dataMin'); 
    setRightIdx('dataMax'); 
  };

  // Calculations
  const totalAssetsNow = useMemo(() => calculateTotalAssets(currentAssets), [currentAssets]);
  const pensionInitialValue = useMemo(() => calculatePensionValue(currentAssets), [currentAssets]);
  const investmentInitialValue = useMemo(() => calculateInvestmentValue(currentAssets), [currentAssets]);

  const budgetSummary = useMemo(() => 
    calculateBudgetSummary(monthlyExpenses, yearlyExpenses, salaryData), 
    [monthlyExpenses, yearlyExpenses, salaryData]
  );

  // Convert equity companies to simulation format
  const equityCompaniesForSim = useMemo(() => {
    return equityCompanies.map(company => ({
      id: company.id,
      name: company.name,
      contracts: company.contracts,
      exitYear: company.exitConfig.exitYear,
      sharePriceAtExit: company.exitConfig.sharePriceAtExit,
    }));
  }, [equityCompanies]);

  // Effective property config (disabled means far future, no savings)
  const effectivePropertyConfig = useMemo(() => {
    if (!propertyPlan.enabled) {
      return { price: 0, year: 2100, monthlySavings: 0 };
    }
    return propertyPlan.config;
  }, [propertyPlan]);

  const simResult = useMemo(() => {
    return findOptimalWithdrawal({
      investmentInitialValue,
      pensionInitialValue,
      returnRate,
      inflationRate,
      transitionToHalfWorkYear,
      stopWorkYear,
      budgetSummary,
      monthlyExpenses,
      yearlyExpenses,
      propertyConfig: effectivePropertyConfig,
      equityCompanies: equityCompaniesForSim,
      initialAge: initialAge,
      endOfLifeAge: END_OF_LIFE_AGE,
    });
  }, [
    returnRate, inflationRate, budgetSummary, transitionToHalfWorkYear, 
    stopWorkYear, effectivePropertyConfig, equityCompaniesForSim, investmentInitialValue, 
    pensionInitialValue, monthlyExpenses, yearlyExpenses, initialAge
  ]);

  // Base timeline for equity charts (60 months)
  const equityTimeline = useMemo(() => {
    const data: Array<{ index: number; label: string }> = [];
    const base = new Date(2026, 0, 1);
    for (let i = 0; i <= 60; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      data.push({ 
        index: i, 
        label: `${d.getMonth()+1}/${d.getFullYear()}`,
      });
    }
    return data;
  }, []);

  // Export/Import handlers
  const handleExport = () => {
    const exportData: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
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
      },
    };
    downloadAsJson(exportData, `financial-plan-${new Date().toISOString().split('T')[0]}.json`);
  };

  const handleImportClick = () => {
    setImportError(null);
    setImportWarnings([]);
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const content = await readFileAsText(file);
      const { data, validation } = importFromJson(content);
      
      if (!validation.valid) {
        setImportError(validation.errors.join('\n'));
        setImportWarnings(validation.warnings);
        setShowImportModal(true);
        return;
      }
      
      if (data) {
        // Apply imported data
        if (data.initialAge !== undefined) {
          setInitialAge(data.initialAge);
        }
        setCurrentAssets(data.assets);
        setMonthlyExpenses(data.monthlyExpenses);
        setYearlyExpenses(data.yearlyExpenses);
        setSalaryData(data.salaryData);
        setEquityCompanies(data.equityCompanies);
        setPropertyPlan(data.propertyPlan);
        setReturnRate(data.simulationParams.returnRate);
        setInflationRate(data.simulationParams.inflationRate);
        setTransitionToHalfWorkYear(data.simulationParams.transitionToHalfWorkYear);
        setStopWorkYear(data.simulationParams.stopWorkYear);
        
        if (validation.warnings.length > 0) {
          setImportWarnings(validation.warnings);
          setShowImportModal(true);
        }
      }
    } catch (err) {
      setImportError(`Failed to read file: ${(err as Error).message}`);
      setShowImportModal(true);
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Equity company management
  const addEquityCompany = () => {
    const newCompany = createDefaultEquityCompany(
      'New Company',
      'Owner',
      ['emerald', 'rose', 'blue', 'amber'][equityCompanies.length % 4] as EquityCompany['color']
    );
    setEquityCompanies([...equityCompanies, newCompany]);
  };

  const removeEquityCompany = (companyId: string) => {
    setEquityCompanies(equityCompanies.filter(c => c.id !== companyId));
  };

  const updateEquityCompany = (companyId: string, updates: Partial<EquityCompany>) => {
    setEquityCompanies(equityCompanies.map(c => 
      c.id === companyId ? { ...c, ...updates } : c
    ));
  };

  const addContractToCompany = (companyId: string) => {
    setEquityCompanies(equityCompanies.map(c => 
      c.id === companyId 
        ? { ...c, contracts: [...c.contracts, createDefaultContract()] }
        : c
    ));
  };

  const removeContractFromCompany = (companyId: string, contractIndex: number) => {
    setEquityCompanies(equityCompanies.map(c => 
      c.id === companyId 
        ? { ...c, contracts: c.contracts.filter((_, i) => i !== contractIndex) }
        : c
    ));
  };

  const updateContract = (companyId: string, contractIndex: number, updates: Partial<EquityContract>) => {
    setEquityCompanies(equityCompanies.map(c => 
      c.id === companyId 
        ? { 
            ...c, 
            contracts: c.contracts.map((contract, i) => 
              i === contractIndex ? { ...contract, ...updates } : contract
            )
          }
        : c
    ));
  };

  const yDomain = useMemo<[number | 'auto', number | 'auto']>(() => {
    if (leftIdx === 'dataMin') return ['auto', 'auto'];
    const visibleData = simResult.data.filter(d => 
      d.index >= (leftIdx as number) && d.index <= (rightIdx as number)
    );
    if (visibleData.length === 0) return ['auto', 'auto'];
    const maxVal = Math.max(...visibleData.map(d => d.totalLegacy));
    const minVal = Math.min(...visibleData.map(d => d.totalLegacy));
    return [Math.floor(minVal * 0.95), Math.ceil(maxVal * 1.05)];
  }, [leftIdx, rightIdx, simResult.data]);

  return (
    <div className="p-6 bg-slate-50 min-h-screen text-right font-sans select-none" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6 text-right">
        
        {/* Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-3xl max-w-md w-full mx-4 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-black text-slate-800">
                  {importError ? 'Import Error' : 'Import Warnings'}
                </h3>
                <button 
                  onClick={() => setShowImportModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={20} />
                </button>
              </div>
              {importError && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-xl mb-4">
                  <div className="flex gap-2 text-red-700">
                    <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                    <pre className="text-sm whitespace-pre-wrap font-mono">{importError}</pre>
                  </div>
                </div>
              )}
              {importWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                  <p className="font-bold text-amber-700 mb-2">Warnings:</p>
                  <ul className="text-sm text-amber-700 space-y-1">
                    {importWarnings.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={() => setShowImportModal(false)}
                className="mt-4 w-full bg-slate-900 text-white py-2 rounded-xl font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Hidden file input for import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".json"
          className="hidden"
        />

        {/* Summary Header */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 text-right">
          <div className="space-y-1 text-right w-full md:w-auto">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center justify-end gap-2">
              Wealth Planner Pro <ShieldCheck className="text-emerald-500" size={20}/>
            </h1>
            <div className="flex items-center justify-end gap-4 text-slate-400 font-bold text-xs uppercase">
              <span className="flex items-center gap-1 text-slate-500"><Clock size={14}/> 10.01.2026</span>
              <span className="text-blue-500 tracking-tight flex items-center gap-1">
                גיל:
                <input
                  type="number"
                  value={initialAge}
                  onChange={(e) => setInitialAge(parseInt(e.target.value) || DEFAULT_INITIAL_AGE)}
                  className="bg-blue-50 border border-blue-200 rounded px-2 py-0.5 w-12 text-center font-bold outline-none focus:ring-1 focus:ring-blue-300"
                  min={18}
                  max={80}
                />
              </span>
              <button
                onClick={handleExport}
                className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full hover:bg-emerald-100 transition-all"
              >
                <Download size={12} /> Export
              </button>
              <button
                onClick={handleImportClick}
                className="flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1 rounded-full hover:bg-blue-100 transition-all"
              >
                <Upload size={12} /> Import
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full md:w-auto text-right">
            <MiniCard label="נכסים היום" value={totalAssetsNow} color="slate" />
            <MiniCard label="הוצאה חודשית (ממוצעת)" value={budgetSummary.totalExpenseToday} color="rose" />
            <div className="bg-emerald-700 text-white p-6 rounded-3xl flex flex-col justify-center min-w-[200px] shadow-xl ring-2 ring-emerald-500 text-right">
              <span className="text-[10px] font-black uppercase mb-1 opacity-90 tracking-widest">משיכה חודשית מקסימלית (נטו)</span>
              <span className="text-3xl font-black tracking-tighter text-left">₪{simResult.val.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex p-1 bg-slate-100 rounded-2xl w-fit border border-slate-200 shadow-inner text-[11px] font-bold mr-0 ml-auto">
          {['assets', 'budget', 'stocks', 'scenario'].map((t) => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)} 
              className={`px-6 py-2 rounded-xl transition-all ${activeTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'assets' ? 'נכסים' : t === 'budget' ? 'ניהול תקציב' : t === 'stocks' ? 'הון מנייתי' : 'סימולציית עתיד'}
            </button>
          ))}
        </div>

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 animate-in fade-in duration-500 text-right">
            <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center justify-end gap-2">
              <Wallet className="text-emerald-500" /> הרכב הון נוכחי
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-right">
              <div className="space-y-3 text-right">
                {currentAssets.map((asset, idx) => (
                  <div key={asset.id} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl hover:bg-white border border-transparent hover:border-slate-200 group transition-all text-right">
                    <input 
                      type="text"
                      className="flex-1 font-bold text-slate-700 text-sm text-right bg-transparent border-none outline-none focus:bg-white focus:border focus:border-slate-200 focus:rounded focus:px-2 transition-all" 
                      value={asset.name}
                      onChange={(e) => updateRowGeneric(setCurrentAssets, currentAssets, idx, 'name', e.target.value)} 
                    />
                    <FormattedNumberInput 
                      className="w-32 bg-white border border-slate-100 rounded p-1 text-left font-black text-sm" 
                      value={asset.value} 
                      onChange={(v) => updateRowGeneric(setCurrentAssets, currentAssets, idx, 'value', v)} 
                    />
                    <button 
                      onClick={() => deleteRowGeneric(setCurrentAssets, currentAssets, idx)} 
                      className="text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16}/>
                    </button>
                  </div>
                ))}
                <button 
                  onClick={() => addRowGeneric(setCurrentAssets, currentAssets, { id: Date.now(), name: "נכס חדש", value: 0, type: "liquid" as const })} 
                  className="w-full p-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold hover:text-blue-500 transition-all text-xs text-right"
                >
                  + הוספת שורה
                </button>
              </div>
              <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white flex flex-col justify-center items-center relative overflow-hidden shadow-2xl text-right">
                <p className="text-slate-400 font-bold uppercase text-xs mb-1 tracking-widest tracking-tighter">סה״כ הון התחלתי</p>
                <p className="text-5xl font-black text-emerald-400 tracking-tighter">₪{formatNumber(totalAssetsNow)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Budget Tab */}
        {activeTab === 'budget' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-500 pb-12 text-right">
            <div className="space-y-8 text-right">
              <SalaryBox 
                name="משכורת 1" 
                gross={salaryData.person1Gross} 
                net={salaryData.person1Net} 
                onGross={(v) => setSalaryData({...salaryData, person1Gross: v})} 
                onNet={(v) => setSalaryData({...salaryData, person1Net: v})} 
              />
              <SalaryBox 
                name="משכורת 2" 
                gross={salaryData.person2Gross} 
                net={salaryData.person2Net} 
                onGross={(v) => setSalaryData({...salaryData, person2Gross: v})} 
                onNet={(v) => setSalaryData({...salaryData, person2Net: v})} 
              />
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 space-y-6 text-right">
                <div className="flex justify-between items-center text-right">
                  <h3 className="font-bold text-slate-800 text-right">הוצאות שנתיות</h3>
                  <button 
                    onClick={() => addRowGeneric(setYearlyExpenses, yearlyExpenses, { id: Date.now(), name: "הוצאה חדשה", amount: 0 })} 
                    className="p-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                  >
                    <Plus size={16}/>
                  </button>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar text-right">
                  {yearlyExpenses.map((e, idx) => (
                    <BudgetRow 
                      key={e.id} 
                      item={e} 
                      onUpdate={(f, v) => updateRowGeneric(setYearlyExpenses, yearlyExpenses, idx, f as keyof Expense, v as string | number)} 
                      onDelete={() => deleteRowGeneric(setYearlyExpenses, yearlyExpenses, idx)} 
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 space-y-6 text-right">
              <div className="flex justify-between items-center text-right">
                <h3 className="font-bold text-slate-800 text-right">הוצאות חודשיות</h3>
                <button 
                  onClick={() => addRowGeneric(setMonthlyExpenses, monthlyExpenses, { id: Date.now(), name: "הוצאה חדשה", amount: 0 })} 
                  className="p-1 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-all"
                >
                  <Plus size={16}/>
                </button>
              </div>
              <div className="space-y-2 max-h-[650px] overflow-y-auto pr-2 custom-scrollbar text-right">
                {monthlyExpenses.map((e, idx) => (
                  <BudgetRow 
                    key={e.id} 
                    item={e} 
                    onUpdate={(f, v) => updateRowGeneric(setMonthlyExpenses, monthlyExpenses, idx, f as keyof Expense, v as string | number)} 
                    onDelete={() => deleteRowGeneric(setMonthlyExpenses, monthlyExpenses, idx)} 
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stocks Tab */}
        {activeTab === 'stocks' && (
          <div className="space-y-8 animate-in slide-in-from-left-4 duration-500 pb-12 text-right">
            {/* Dynamic Equity Company Panels */}
            {equityCompanies.map((company) => {
              const colorClasses: Record<string, { border: string; bg: string; text: string; fill: string; stroke: string }> = {
                indigo: { border: 'border-indigo-100', bg: 'bg-indigo-600', text: 'text-indigo-500', fill: '#e0e7ff', stroke: '#4f46e5' },
                purple: { border: 'border-purple-100', bg: 'bg-purple-600', text: 'text-purple-500', fill: '#f3e8ff', stroke: '#a855f7' },
                emerald: { border: 'border-emerald-100', bg: 'bg-emerald-600', text: 'text-emerald-500', fill: '#d1fae5', stroke: '#10b981' },
                rose: { border: 'border-rose-100', bg: 'bg-rose-600', text: 'text-rose-500', fill: '#ffe4e6', stroke: '#f43f5e' },
                blue: { border: 'border-blue-100', bg: 'bg-blue-600', text: 'text-blue-500', fill: '#dbeafe', stroke: '#3b82f6' },
                amber: { border: 'border-amber-100', bg: 'bg-amber-600', text: 'text-amber-500', fill: '#fef3c7', stroke: '#f59e0b' },
              };
              const colors = colorClasses[company.color] || colorClasses.blue;
              const totalShares = company.totalShares || company.contracts.reduce((sum, c) => sum + c.shares, 0);
              const vestingData = equityTimeline.map(point => {
                const vesting = getVestingAtDate(company.contracts, new Date(2026, point.index, 1));
                return { ...point, vested: Math.round(vesting.totalVested), cost: Math.round(vesting.totalCost), details: vesting.details };
              });

              return (
                <div key={company.id} className={`bg-white p-10 rounded-[3.5rem] shadow-sm border ${colors.border} text-right`}>
                  <div className="flex flex-col md:flex-row justify-between gap-10 mb-10 border-b pb-10 text-right">
                    <div className="flex items-center gap-6 text-right">
                      <div className={`p-6 ${colors.bg} text-white rounded-[2.5rem] shadow-lg`}>
                        {company.color === 'purple' ? <Sparkles size={48}/> : <BarChart3 size={48}/>}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            className="text-4xl font-black text-slate-800 bg-transparent border-none outline-none w-48"
                            value={company.name}
                            onChange={(e) => updateEquityCompany(company.id, { name: e.target.value })}
                          />
                          <button
                            onClick={() => removeEquityCompany(company.id)}
                            className="text-slate-300 hover:text-red-500 transition-all p-2"
                            title="Remove company"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                        <p className="text-slate-400 font-bold mt-1 text-sm italic">
                          {totalShares.toLocaleString()} shares | {company.contracts.length} contracts
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 flex-1 text-right">
                      <StockInput 
                        label="שנת אקזיט" 
                        val={company.exitConfig.exitYear} 
                        onChange={(v) => updateEquityCompany(company.id, { 
                          exitConfig: { ...company.exitConfig, exitYear: v }
                        })} 
                      />
                      <StockInput 
                        label="מחיר מניה ($)" 
                        val={company.exitConfig.sharePriceAtExit} 
                        onChange={(v) => updateEquityCompany(company.id, { 
                          exitConfig: { ...company.exitConfig, sharePriceAtExit: v }
                        })} 
                      />
                    </div>
                  </div>
                  
                  {/* Contracts Section */}
                  <div className="mb-8">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="font-black text-slate-500 uppercase text-[11px] tracking-widest">חוזי הון</h4>
                      <button
                        onClick={() => addContractToCompany(company.id)}
                        className="flex items-center gap-1 bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-slate-200"
                      >
                        <Plus size={12} /> Add Contract
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {/* Header row */}
                      <div className="flex items-center gap-3 px-3 text-[10px] font-bold text-slate-400 uppercase">
                        <span className="flex-1">שם חוזה</span>
                        <span className="w-20 text-center">מניות</span>
                        <span className="w-16 text-center">סטרייק $</span>
                        <span className="w-32 text-center">תאריך התחלה</span>
                        <span className="w-16 text-center">שנות הבשלה</span>
                        <span className="w-6"></span>
                      </div>
                      {company.contracts.map((contract, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl group hover:bg-white border border-transparent hover:border-slate-100">
                          <input
                            className="flex-1 bg-transparent border-none font-bold text-slate-700 outline-none text-sm"
                            value={contract.name}
                            onChange={(e) => updateContract(company.id, idx, { name: e.target.value })}
                          />
                          <input
                            type="number"
                            className="w-20 bg-white border border-slate-100 rounded p-1 text-center font-black text-xs"
                            value={contract.shares}
                            onChange={(e) => updateContract(company.id, idx, { shares: parseFloat(e.target.value) || 0 })}
                          />
                          <input
                            type="number"
                            step="0.01"
                            className="w-16 bg-white border border-slate-100 rounded p-1 text-center font-black text-xs"
                            value={contract.strike}
                            onChange={(e) => updateContract(company.id, idx, { strike: parseFloat(e.target.value) || 0 })}
                          />
                          <input
                            type="date"
                            className="w-32 bg-white border border-slate-100 rounded p-1 text-center text-xs"
                            value={contract.startDate}
                            onChange={(e) => updateContract(company.id, idx, { startDate: e.target.value })}
                          />
                          <input
                            type="number"
                            className="w-16 bg-white border border-slate-100 rounded p-1 text-center font-black text-xs"
                            value={contract.periodYears}
                            onChange={(e) => updateContract(company.id, idx, { periodYears: parseFloat(e.target.value) || 1 })}
                          />
                          <button
                            onClick={() => removeContractFromCompany(company.id, idx)}
                            className="text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 w-6"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      {company.contracts.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-4">No contracts yet. Click "Add Contract" to add one.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 text-right">
                    {(() => {
                      // Calculate vested shares at exit date
                      const exitDate = new Date(company.exitConfig.exitYear, 0, 1);
                      const vestingAtExit = getVestingAtDate(company.contracts, exitDate);
                      const vestedShares = vestingAtExit.totalVested;
                      const costBasis = vestingAtExit.totalCost;
                      
                      // Gross value in ILS (price * shares * exchange rate - cost basis)
                      const grossValueUsd = vestedShares * company.exitConfig.sharePriceAtExit;
                      const grossValueIls = grossValueUsd * 3.5;
                      const costBasisIls = costBasis * 3.5;
                      const profit = grossValueIls - costBasisIls;
                      const netValue = calculateNetEquity(profit);
                      
                      return (
                        <div className="space-y-8 text-right">
                          <h4 className="font-black text-slate-500 uppercase text-[11px] tracking-widest flex items-center justify-end gap-3">
                            <Target size={16}/> אומדן רווח נקי (מניות שהבשילו עד האקזיט)
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
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="label" fontSize={9} interval={11} />
                          <Tooltip content={({active, payload}) => { 
                            if (active && payload && payload.length) { 
                              const d = payload[0].payload; 
                              return (
                                <div className="bg-white p-4 shadow-xl border rounded-2xl text-right min-w-[200px]">
                                  <p className="font-bold border-b mb-2">{d.label}</p>
                                  {d.details.map((det: any) => (
                                    <div key={det.name} className="flex justify-between gap-6 text-[10px]">
                                      <span className="text-slate-500">{det.name}:</span>
                                      <span className="font-black">{det.vested.toLocaleString()}</span>
                                    </div>
                                  ))}
                                  <div className={`border-t mt-2 pt-2 flex justify-between font-black ${colors.text} text-xs`}>
                                    <span>עלות קנייה:</span>
                                    <span>₪{(d.cost * 3.5).toLocaleString()}</span>
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

            {/* Add Company Button */}
            <button
              onClick={addEquityCompany}
              className="w-full p-8 border-2 border-dashed border-slate-200 rounded-[3.5rem] text-slate-400 font-bold hover:text-blue-500 hover:border-blue-200 transition-all flex items-center justify-center gap-2"
            >
              <Building2 size={24} />
              <span>Add Equity Company</span>
            </button>

            {/* Property Panel */}
            <div className={`bg-white p-10 rounded-[3.5rem] shadow-sm border ${propertyPlan.enabled ? 'border-slate-200' : 'border-slate-100 opacity-60'} flex flex-col md:flex-row gap-10 items-center text-right`}>
              <div className={`p-6 ${propertyPlan.enabled ? 'bg-slate-800' : 'bg-slate-400'} text-white rounded-3xl shadow-xl shadow-slate-100`}>
                <Home size={48}/>
              </div>
              <div className="flex-1 space-y-2 text-right">
                <div className="flex items-center gap-3">
                  <h4 className="text-2xl font-black text-slate-800 tracking-tight">קניית דירה למגורים בהמשך</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={propertyPlan.enabled}
                      onChange={(e) => setPropertyPlan({ ...propertyPlan, enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>
                <p className="text-sm text-slate-500 font-medium italic">
                  {propertyPlan.enabled 
                    ? `רכישת דירה ב-₪${(propertyPlan.config.price/1000000).toFixed(1)}M בשנת ${propertyPlan.config.year}. לאחר הרכישה נחסוך ₪${formatNumber(propertyPlan.config.monthlySavings)} בחודש (למשל: שכירות).`
                    : 'רכישת דירה מושבתת - ממשיכים לשלם שכירות.'
                  }
                </p>
              </div>
              {propertyPlan.enabled && (
                <div className="flex gap-4 text-right">
                  <StockInput 
                    label="שנה" 
                    val={propertyPlan.config.year} 
                    onChange={(v) => setPropertyPlan({ ...propertyPlan, config: { ...propertyPlan.config, year: v }})} 
                  />
                  <StockInput 
                    label="מחיר (₪)" 
                    val={propertyPlan.config.price} 
                    onChange={(v) => setPropertyPlan({ ...propertyPlan, config: { ...propertyPlan.config, price: v }})} 
                  />
                  <StockInput 
                    label="חיסכון חודשי (₪)" 
                    val={propertyPlan.config.monthlySavings} 
                    onChange={(v) => setPropertyPlan({ ...propertyPlan, config: { ...propertyPlan.config, monthlySavings: v }})} 
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scenario Tab */}
        {activeTab === 'scenario' && (
          <div className="space-y-6 animate-in fade-in duration-500 pb-12 text-right">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-8 shadow-sm text-right">
              <ControlSlider label="תשואה שנתית (%)" value={returnRate} min={1} max={12} step={0.5} onChange={setReturnRate} color="blue" />
              <ControlSlider label="אינפלציה (%)" value={inflationRate} min={0} max={6} step={0.1} onChange={setInflationRate} color="orange" />
              <ControlSlider label="שנים לחצי משרה" value={transitionToHalfWorkYear} min={0} max={20} step={1} onChange={setTransitionToHalfWorkYear} color="emerald" />
              <ControlSlider label="שנים לפרישה" value={stopWorkYear} min={0} max={40} step={1} onChange={setStopWorkYear} color="purple" />
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden text-right">
              <div className="flex justify-between items-center mb-8 px-2 text-right">
                <h3 className="text-xl font-bold text-slate-800 flex items-center justify-end gap-2">
                  <ArrowUpRight className="text-emerald-500" /> תחזית עושר משפחתי (זום מופעל)
                </h3>
                <div className="flex gap-3 text-right">
                  <div className="text-[10px] text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full border border-slate-100 flex items-center gap-2">
                    <ZoomIn size={12}/> לחץ וגרור לזום
                  </div>
                  {(leftIdx !== 'dataMin' || rightIdx !== 'dataMax') && (
                    <button 
                      onClick={handleZoomOut} 
                      className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-1 rounded-full font-black text-xs hover:bg-blue-100 shadow-sm"
                    >
                      <RefreshCcw size={14}/> איפוס זום
                    </button>
                  )}
                </div>
              </div>
              
              <div className="h-[550px] text-right">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart 
                    data={simResult.data} 
                    onMouseDown={handleMouseDown} 
                    onMouseMove={handleMouseMove} 
                    onMouseUp={handleZoom}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="index" 
                      type="number" 
                      domain={[leftIdx, rightIdx]} 
                      allowDataOverflow 
                      fontSize={10} 
                      stroke="#94a3b8" 
                      tickFormatter={(i) => simResult.data.find(d => d.index === i)?.label ?? ''} 
                      interval={leftIdx === 'dataMin' ? 36 : 0} 
                    />
                    <YAxis 
                      stroke="#94a3b8" 
                      fontSize={11} 
                      domain={yDomain} 
                      allowDataOverflow 
                      tickFormatter={(val) => `₪${(val/1000000).toFixed(0)}M`} 
                    />
                    <Tooltip content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white p-5 shadow-2xl border-none rounded-2xl text-right min-w-[320px]">
                            <p className="font-bold text-slate-800 mb-1 text-lg">{d.label} (גיל {d.fullAge})</p>
                            {d.event && (
                              <div className="mb-3 bg-amber-50 text-amber-700 p-2 rounded-lg text-[10px] font-black border border-amber-100 animate-pulse">
                                ✨ {d.event}
                              </div>
                            )}
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between items-center text-slate-600 font-medium">
                                <span>הון נזיל להשקעה:</span>
                                <span className="font-black text-left">₪{d.investments.toLocaleString()}</span>
                              </div>
                              {parseFloat(d.fullAge) < 60 && (
                                <div className="flex justify-between items-center text-blue-600 font-medium">
                                  <span>יתרת פנסיה:</span>
                                  <span className="font-black text-left">₪{d.pension.toLocaleString()}</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center text-indigo-600 font-medium">
                                <span>ערך דירה:</span>
                                <span className="font-black text-left">₪{d.property.toLocaleString()}</span>
                              </div>
                              <div className="border-t pt-2 mt-1">
                                <div className="flex justify-between items-center text-slate-500 italic">
                                  <span>מקור הכנסה:</span>
                                  <span>{d.incomeSource}</span>
                                </div>
                                <div className="flex justify-between items-center text-slate-800 font-bold">
                                  <span>הכנסה חודשית:</span>
                                  <span>₪{d.currentIncome.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center text-rose-500 font-bold">
                                  <span>הוצאה חודשית:</span>
                                  <span>₪{d.monthlyOutflow.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center border-t pt-1 mt-1 text-emerald-600 font-black">
                                  <span>חסכון/גירעון חודשי:</span>
                                  <span>₪{d.monthlySavings.toLocaleString()}</span>
                                </div>
                                {/* Withdrawal breakdown during retirement */}
                                {(d.withdrawalFromInvestments > 0 || d.withdrawalFromPension > 0) && (
                                  <div className="border-t pt-2 mt-2 space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase">פירוט משיכה:</p>
                                    {d.withdrawalFromInvestments > 0 && (
                                      <div className="flex justify-between items-center text-blue-600 text-[11px]">
                                        <span>מהשקעות:</span>
                                        <span className="font-black">₪{d.withdrawalFromInvestments.toLocaleString()}</span>
                                      </div>
                                    )}
                                    {d.withdrawalFromPension > 0 && (
                                      <div className="flex justify-between items-center text-purple-600 text-[11px]">
                                        <span>{d.pensionAnnuity > 0 ? 'קצבת פנסיה:' : 'מפנסיה (קנס 35%):'}</span>
                                        <span className="font-black">₪{d.withdrawalFromPension.toLocaleString()}</span>
                                      </div>
                                    )}
                                    {d.pensionAnnuity > 0 && (
                                      <div className="flex justify-between items-center text-indigo-500 text-[10px]">
                                        <span>קצבה חודשית נטו:</span>
                                        <span className="font-bold">₪{d.pensionAnnuity.toLocaleString()}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {d.taxPaid > 0 && (
                                  <div className="flex justify-between items-center text-red-500 text-[10px] font-bold mt-1">
                                    <span>מס ששולם:</span>
                                    <span>₪{d.taxPaid.toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex justify-between items-center border-t pt-2 text-emerald-700 font-black text-lg underline">
                                <span>סך עושר משפחתי:</span>
                                <span>₪{d.totalLegacy.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }} />
                    <Area 
                      type="monotone" 
                      dataKey="property" 
                      stroke="#818cf8" 
                      fillOpacity={0.05} 
                      fill="#818cf8" 
                      strokeWidth={1} 
                      strokeDasharray="5 5" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="totalLegacy" 
                      stroke="#10b981" 
                      strokeWidth={4} 
                      fillOpacity={0.2} 
                      fill="#10b981" 
                      animationDuration={300} 
                      dot={(props: any) => {
                        if (!props.payload.event) return <circle key={props.index} cx={0} cy={0} r={0} fill="transparent" />;
                        return (
                          <circle 
                            key={props.index} 
                            cx={props.cx} 
                            cy={props.cy} 
                            r={7} 
                            fill="#f59e0b" 
                            stroke="#fff" 
                            strokeWidth={3} 
                          />
                        );
                      }} 
                    />
                    {refAreaLeft !== null && refAreaRight !== null && (
                      <ReferenceArea 
                        x1={refAreaLeft} 
                        x2={refAreaRight} 
                        fillOpacity={0.1} 
                        fill="#3b82f6" 
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex justify-center gap-8 text-xs font-bold text-slate-400 text-right">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded"></div> קו עושר כולל (נזיל + נדל"ן)</div>
                <div className="flex items-center gap-2 opacity-40"><div className="w-3 h-3 bg-indigo-400 rounded"></div> שווי נדל"ן לבדו</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
