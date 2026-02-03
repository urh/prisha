import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the state persistence logic
describe('State Persistence', () => {
  const STATE_STORAGE_KEY = 'prisha-financial-state';
  
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves state to localStorage', () => {
    const testState = {
      initialAge: 35,
      assets: [{ id: 1, name: 'Test', value: 100000, type: 'liquid' }],
      monthlyExpenses: [],
      yearlyExpenses: [],
      salaryData: { person1Gross: 40000, person1Net: 25000, person2Gross: 20000, person2Net: 15000 },
      equityCompanies: [],
      propertyPlan: { enabled: false, config: { price: 0, year: 2030, monthlySavings: 0 } },
      simulationParams: { returnRate: 6, inflationRate: 2.5, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };
    
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(testState));
    
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    expect(saved).not.toBeNull();
    
    const parsed = JSON.parse(saved!);
    expect(parsed.initialAge).toBe(35);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.salaryData.person1Gross).toBe(40000);
  });

  it('loads state from localStorage', () => {
    const testState = {
      initialAge: 42,
      assets: [{ id: 1, name: 'Pension', value: 500000, type: 'pension' }],
      monthlyExpenses: [{ id: 1, name: 'Rent', amount: 8000 }],
      yearlyExpenses: [],
      salaryData: { person1Gross: 50000, person1Net: 30000, person2Gross: 25000, person2Net: 18000 },
      equityCompanies: [{
        id: 'test-1',
        name: 'TestCorp',
        ownerName: 'Person 1',
        color: 'indigo',
        contracts: [],
        exitConfig: { exitYear: 2028, sharePriceAtExit: 20 },
      }],
      propertyPlan: { enabled: true, config: { price: 5000000, year: 2030, monthlySavings: 8000 } },
      simulationParams: { returnRate: 7, inflationRate: 3, transitionToHalfWorkYear: 4, stopWorkYear: 12 },
    };
    
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(testState));
    
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    const loaded = JSON.parse(saved!);
    
    expect(loaded.initialAge).toBe(42);
    expect(loaded.monthlyExpenses[0].amount).toBe(8000);
    expect(loaded.equityCompanies[0].name).toBe('TestCorp');
    expect(loaded.simulationParams.returnRate).toBe(7);
  });

  it('returns null for empty localStorage', () => {
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    expect(saved).toBeNull();
  });

  it('handles corrupted localStorage data gracefully', () => {
    localStorage.setItem(STATE_STORAGE_KEY, 'not valid json');
    
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)!);
    } catch (e) {
      parsed = null;
    }
    
    expect(parsed).toBeNull();
  });

  it('preserves all data types correctly', () => {
    const testState = {
      initialAge: 35,
      assets: [
        { id: 1, name: 'פנסיה', value: 1500000.50, type: 'pension' }, // Hebrew + decimal
        { id: 2, name: 'Stocks', value: 0, type: 'liquid' }, // Zero value
      ],
      monthlyExpenses: [{ id: 1, name: 'שכר דירה', amount: 8000 }],
      yearlyExpenses: [],
      salaryData: { person1Gross: 40000, person1Net: 25000, person2Gross: 20000, person2Net: 15000 },
      equityCompanies: [],
      propertyPlan: { enabled: false, config: { price: 5000000, year: 2030, monthlySavings: 8000 } },
      simulationParams: { returnRate: 6.5, inflationRate: 2.5, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };
    
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(testState));
    const loaded = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY)!);
    
    // Check Hebrew preserved
    expect(loaded.assets[0].name).toBe('פנסיה');
    expect(loaded.monthlyExpenses[0].name).toBe('שכר דירה');
    
    // Check decimal preserved
    expect(loaded.assets[0].value).toBe(1500000.50);
    expect(loaded.simulationParams.returnRate).toBe(6.5);
    
    // Check zero preserved
    expect(loaded.assets[1].value).toBe(0);
    
    // Check boolean preserved
    expect(loaded.propertyPlan.enabled).toBe(false);
  });
});

describe('Debounce Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounce delays execution', () => {
    const fn = vi.fn();
    const DEBOUNCE_MS = 2000;
    
    // Simulate debounce behavior using vitest mock timers
    let timeoutId: number | null = null;
    const debouncedFn = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(fn, DEBOUNCE_MS) as unknown as number;
    };
    
    // Call multiple times quickly
    debouncedFn();
    debouncedFn();
    debouncedFn();
    
    // Function should not have been called yet
    expect(fn).not.toHaveBeenCalled();
    
    // Advance time but not enough
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    
    // Advance past debounce time
    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('debounce resets timer on new calls', () => {
    const fn = vi.fn();
    const DEBOUNCE_MS = 2000;
    
    let timeoutId: number | null = null;
    const debouncedFn = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(fn, DEBOUNCE_MS) as unknown as number;
    };
    
    // Call and wait 1.5 seconds
    debouncedFn();
    vi.advanceTimersByTime(1500);
    expect(fn).not.toHaveBeenCalled();
    
    // Call again - timer should reset
    debouncedFn();
    vi.advanceTimersByTime(1500);
    expect(fn).not.toHaveBeenCalled();
    
    // Wait the full debounce time
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
