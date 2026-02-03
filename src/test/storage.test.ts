import { describe, it, expect } from 'vitest';
import {
  validateAsset,
  validateExpense,
  validateSalaryData,
  validateEquityContract,
  validateEquityCompany,
  validatePropertyPlan,
  validateSimulationParams,
  validateInitialAge,
  validateExportData,
  exportToJson,
  importFromJson,
  generateId,
  createDefaultEquityCompany,
  createDefaultContract,
  EXPORT_VERSION,
  type AppExportData,
  type EquityCompany,
} from '../utils/storage';

// ============================================
// Validation Tests
// ============================================

describe('validateAsset', () => {
  it('returns no errors for valid asset', () => {
    const asset = { id: 1, name: 'Pension', value: 1000000, type: 'pension' };
    const errors = validateAsset(asset, 0);
    expect(errors).toHaveLength(0);
  });

  it('returns error for missing id', () => {
    const asset = { name: 'Pension', value: 1000000, type: 'pension' };
    const errors = validateAsset(asset, 0);
    expect(errors.some(e => e.includes('id'))).toBe(true);
  });

  it('returns error for invalid name', () => {
    const asset = { id: 1, name: '', value: 1000000, type: 'pension' };
    const errors = validateAsset(asset, 0);
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('returns error for invalid value', () => {
    const asset = { id: 1, name: 'Test', value: 'not a number', type: 'pension' };
    const errors = validateAsset(asset, 0);
    expect(errors.some(e => e.includes('value'))).toBe(true);
  });

  it('returns error for invalid type', () => {
    const asset = { id: 1, name: 'Test', value: 1000, type: 'invalid' };
    const errors = validateAsset(asset, 0);
    expect(errors.some(e => e.includes('type'))).toBe(true);
  });

  it('accepts all valid asset types', () => {
    const types = ['pension', 'liquid', 'invest'];
    types.forEach(type => {
      const asset = { id: 1, name: 'Test', value: 1000, type };
      const errors = validateAsset(asset, 0);
      expect(errors).toHaveLength(0);
    });
  });

  it('returns error for null/undefined', () => {
    expect(validateAsset(null, 0).length).toBeGreaterThan(0);
    expect(validateAsset(undefined, 0).length).toBeGreaterThan(0);
  });
});

describe('validateExpense', () => {
  it('returns no errors for valid expense', () => {
    const expense = { id: 1, name: 'Rent', amount: 12000 };
    const errors = validateExpense(expense, 0, 'Monthly');
    expect(errors).toHaveLength(0);
  });

  it('returns error for negative amount', () => {
    const expense = { id: 1, name: 'Rent', amount: -1000 };
    const errors = validateExpense(expense, 0, 'Monthly');
    expect(errors.some(e => e.includes('amount'))).toBe(true);
  });

  it('returns error for missing name', () => {
    const expense = { id: 1, name: '', amount: 1000 };
    const errors = validateExpense(expense, 0, 'Monthly');
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('includes expense type in error message', () => {
    const expense = { id: 1, name: '', amount: 1000 };
    const errors = validateExpense(expense, 0, 'Yearly');
    expect(errors.some(e => e.includes('Yearly'))).toBe(true);
  });
});

describe('validateSalaryData', () => {
  it('returns no errors for valid salary data', () => {
    const salary = { person1Gross: 70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 };
    const errors = validateSalaryData(salary);
    expect(errors).toHaveLength(0);
  });

  it('returns errors for missing fields', () => {
    const salary = { person1Gross: 70000, person1Net: 35000 };
    const errors = validateSalaryData(salary);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns error for negative values', () => {
    const salary = { person1Gross: -70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 };
    const errors = validateSalaryData(salary);
    expect(errors.some(e => e.includes('person1Gross'))).toBe(true);
  });

  it('returns error for NaN values', () => {
    const salary = { person1Gross: NaN, person1Net: 35000, person2Gross: 44000, person2Net: 26000 };
    const errors = validateSalaryData(salary);
    expect(errors.some(e => e.includes('person1Gross'))).toBe(true);
  });
});

describe('validateEquityContract', () => {
  const validContract = {
    name: 'Grant 1',
    shares: 10000,
    strike: 1.0,
    startDate: '2024-01-01',
    periodYears: 4,
    cliffMonths: 12,
  };

  it('returns no errors for valid contract', () => {
    const errors = validateEquityContract(validContract, 'Test Company', 0);
    expect(errors).toHaveLength(0);
  });

  it('returns error for invalid date format', () => {
    const contract = { ...validContract, startDate: '01-01-2024' };
    const errors = validateEquityContract(contract, 'Test Company', 0);
    expect(errors.some(e => e.includes('startDate'))).toBe(true);
  });

  it('returns error for negative shares', () => {
    const contract = { ...validContract, shares: -1000 };
    const errors = validateEquityContract(contract, 'Test Company', 0);
    expect(errors.some(e => e.includes('shares'))).toBe(true);
  });

  it('returns error for zero period years', () => {
    const contract = { ...validContract, periodYears: 0 };
    const errors = validateEquityContract(contract, 'Test Company', 0);
    expect(errors.some(e => e.includes('periodYears'))).toBe(true);
  });

  it('accepts cliffMonths of 0', () => {
    const contract = { ...validContract, cliffMonths: 0 };
    const errors = validateEquityContract(contract, 'Test Company', 0);
    expect(errors).toHaveLength(0);
  });
});

describe('validateEquityCompany', () => {
  const validCompany: EquityCompany = {
    id: 'test-company',
    name: 'Test Inc',
    ownerName: 'John',
    color: 'indigo',
    contracts: [
      {
        name: 'Grant 1',
        shares: 10000,
        strike: 1.0,
        startDate: '2024-01-01',
        periodYears: 4,
        cliffMonths: 12,
      },
    ],
    exitConfig: {
      exitYear: 2028,
      valuationAtExit: 5,
      sharePriceAtExit: 20,
    },
  };

  it('returns no errors for valid company', () => {
    const errors = validateEquityCompany(validCompany, 0);
    expect(errors).toHaveLength(0);
  });

  it('returns error for invalid color', () => {
    const company = { ...validCompany, color: 'invalid' };
    const errors = validateEquityCompany(company, 0);
    expect(errors.some(e => e.includes('color'))).toBe(true);
  });

  it('accepts all valid colors', () => {
    const colors = ['indigo', 'purple', 'emerald', 'rose', 'blue', 'amber'];
    colors.forEach(color => {
      const company = { ...validCompany, color };
      const errors = validateEquityCompany(company, 0);
      expect(errors.filter(e => e.includes('color'))).toHaveLength(0);
    });
  });

  it('returns error for missing exitConfig', () => {
    const { exitConfig, ...companyWithoutExit } = validCompany;
    const errors = validateEquityCompany(companyWithoutExit, 0);
    expect(errors.some(e => e.includes('exitConfig'))).toBe(true);
  });

  it('validates nested contracts', () => {
    const company = {
      ...validCompany,
      contracts: [{ name: '', shares: -1, strike: 0, startDate: 'invalid', periodYears: 0, cliffMonths: -1 }],
    };
    const errors = validateEquityCompany(company, 0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows empty contracts array', () => {
    const company = { ...validCompany, contracts: [] };
    const errors = validateEquityCompany(company, 0);
    expect(errors.filter(e => e.includes('contract'))).toHaveLength(0);
  });
});

describe('validatePropertyPlan', () => {
  it('returns no errors for valid enabled plan', () => {
    const plan = { enabled: true, config: { price: 7000000, year: 2030 } };
    const errors = validatePropertyPlan(plan);
    expect(errors).toHaveLength(0);
  });

  it('returns no errors for valid disabled plan', () => {
    const plan = { enabled: false, config: { price: 7000000, year: 2030 } };
    const errors = validatePropertyPlan(plan);
    expect(errors).toHaveLength(0);
  });

  it('returns error for missing enabled field', () => {
    const plan = { config: { price: 7000000, year: 2030 } };
    const errors = validatePropertyPlan(plan);
    expect(errors.some(e => e.includes('enabled'))).toBe(true);
  });

  it('returns error for negative price', () => {
    const plan = { enabled: true, config: { price: -1000, year: 2030 } };
    const errors = validatePropertyPlan(plan);
    expect(errors.some(e => e.includes('price'))).toBe(true);
  });
});

describe('validateSimulationParams', () => {
  const validParams = {
    returnRate: 6,
    inflationRate: 2.5,
    transitionToHalfWorkYear: 5,
    stopWorkYear: 15,
  };

  it('returns no errors for valid params', () => {
    const errors = validateSimulationParams(validParams);
    expect(errors).toHaveLength(0);
  });

  it('returns error for NaN returnRate', () => {
    const params = { ...validParams, returnRate: NaN };
    const errors = validateSimulationParams(params);
    expect(errors.some(e => e.includes('returnRate'))).toBe(true);
  });

  it('returns error for missing inflationRate', () => {
    const { inflationRate, ...params } = validParams;
    const errors = validateSimulationParams(params);
    expect(errors.some(e => e.includes('inflationRate'))).toBe(true);
  });
});

// ============================================
// Full Export Data Validation Tests
// ============================================

describe('validateInitialAge', () => {
  it('returns no errors for valid age', () => {
    expect(validateInitialAge(34)).toHaveLength(0);
    expect(validateInitialAge(18)).toHaveLength(0);
    expect(validateInitialAge(80)).toHaveLength(0);
  });

  it('returns error for non-number', () => {
    expect(validateInitialAge('34').some(e => e.includes('number'))).toBe(true);
    expect(validateInitialAge(null).some(e => e.includes('number'))).toBe(true);
    expect(validateInitialAge(undefined).some(e => e.includes('number'))).toBe(true);
  });

  it('returns error for age out of range', () => {
    expect(validateInitialAge(17).some(e => e.includes('between'))).toBe(true);
    expect(validateInitialAge(81).some(e => e.includes('between'))).toBe(true);
  });

  it('returns error for NaN', () => {
    expect(validateInitialAge(NaN).length).toBeGreaterThan(0);
  });
});

describe('validateExportData', () => {
  const createValidExportData = (): AppExportData => ({
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    initialAge: 34,
    assets: [{ id: 1, name: 'Pension', value: 1000000, type: 'pension' }],
    monthlyExpenses: [{ id: 1, name: 'Rent', amount: 12000 }],
    yearlyExpenses: [{ id: 101, name: 'Vacation', amount: 24000 }],
    salaryData: { person1Gross: 70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 },
    equityCompanies: [{
      id: 'test',
      name: 'Test',
      ownerName: 'Owner',
      color: 'indigo',
      contracts: [],
      exitConfig: { exitYear: 2028, valuationAtExit: 5, sharePriceAtExit: 20 },
    }],
    propertyPlan: { enabled: true, config: { price: 7000000, year: 2030, monthlySavings: 8000 } },
    simulationParams: { returnRate: 6, inflationRate: 2.5, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
  });

  it('returns valid for complete valid data', () => {
    const data = createValidExportData();
    const result = validateExportData(data);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns warning for missing version', () => {
    const data = createValidExportData();
    delete (data as any).version;
    const result = validateExportData(data);
    expect(result.warnings.some(w => w.includes('version'))).toBe(true);
  });

  it('returns warning for version mismatch', () => {
    const data = createValidExportData();
    data.version = '0.0.1';
    const result = validateExportData(data);
    expect(result.warnings.some(w => w.includes('Version mismatch'))).toBe(true);
  });

  it('returns error for non-array assets', () => {
    const data = createValidExportData();
    (data as any).assets = 'not an array';
    const result = validateExportData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('assets'))).toBe(true);
  });

  it('returns error for invalid asset in array', () => {
    const data = createValidExportData();
    data.assets.push({ id: 2, name: '', value: -100, type: 'invalid' } as any);
    const result = validateExportData(data);
    expect(result.valid).toBe(false);
  });

  it('returns error for non-object data', () => {
    const result = validateExportData('string');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected object'))).toBe(true);
  });

  it('returns error for null data', () => {
    const result = validateExportData(null);
    expect(result.valid).toBe(false);
  });

  it('validates all sections comprehensively', () => {
    const data = createValidExportData();
    // Make multiple things invalid
    data.assets = [{ id: 'invalid' as any, name: '', value: 'bad', type: 'wrong' } as any];
    data.monthlyExpenses = [{ id: 'bad' as any, name: 123 as any, amount: 'invalid' } as any];
    
    const result = validateExportData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

// ============================================
// Export/Import Tests
// ============================================

describe('exportToJson', () => {
  it('returns valid JSON string', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [{ id: 1, name: 'Test', value: 1000, type: 'liquid' }],
      monthlyExpenses: [],
      yearlyExpenses: [],
      salaryData: { person1Gross: 0, person1Net: 0, person2Gross: 0, person2Net: 0 },
      equityCompanies: [],
      propertyPlan: { enabled: false, config: { price: 0, year: 2030, monthlySavings: 0 } },
      simulationParams: { returnRate: 6, inflationRate: 2, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };
    
    const json = exportToJson(data);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('preserves data through JSON roundtrip', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: '2024-01-01T00:00:00.000Z',
      initialAge: 34,
      assets: [{ id: 1, name: 'Pension', value: 1500000, type: 'pension' }],
      monthlyExpenses: [{ id: 1, name: 'Rent', amount: 12000 }],
      yearlyExpenses: [],
      salaryData: { person1Gross: 70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 },
      equityCompanies: [{
        id: 'test',
        name: 'Test',
        ownerName: 'Owner',
        color: 'blue',
        contracts: [{ name: 'Grant', shares: 10000, strike: 1.5, startDate: '2024-01-01', periodYears: 4, cliffMonths: 12 }],
        exitConfig: { exitYear: 2028, valuationAtExit: 5, sharePriceAtExit: 20 },
      }],
      propertyPlan: { enabled: true, config: { price: 7000000, year: 2030, monthlySavings: 8000 } },
      simulationParams: { returnRate: 6.5, inflationRate: 2.5, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };
    
    const json = exportToJson(data);
    const parsed = JSON.parse(json);
    
    expect(parsed.version).toBe(data.version);
    expect(parsed.assets[0].value).toBe(1500000);
    expect(parsed.equityCompanies[0].contracts[0].shares).toBe(10000);
    expect(parsed.propertyPlan.enabled).toBe(true);
  });
});

describe('importFromJson', () => {
  it('successfully imports valid JSON', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [{ id: 1, name: 'Test', value: 1000, type: 'liquid' }],
      monthlyExpenses: [],
      yearlyExpenses: [],
      salaryData: { person1Gross: 70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 },
      equityCompanies: [],
      propertyPlan: { enabled: false, config: { price: 0, year: 2030, monthlySavings: 0 } },
      simulationParams: { returnRate: 6, inflationRate: 2, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };
    
    const json = JSON.stringify(data);
    const result = importFromJson(json);
    
    expect(result.validation.valid).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data?.assets[0].value).toBe(1000);
  });

  it('returns error for invalid JSON syntax', () => {
    const result = importFromJson('{ invalid json }');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.data).toBeNull();
  });

  it('returns error for valid JSON but invalid data structure', () => {
    const result = importFromJson('{"assets": "not an array"}');
    expect(result.validation.valid).toBe(false);
    expect(result.data).toBeNull();
  });

  it('handles empty JSON object', () => {
    const result = importFromJson('{}');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });
});

// ============================================
// Helper Function Tests
// ============================================

describe('generateId', () => {
  it('returns a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('ID contains timestamp component', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    
    const timestamp = parseInt(id.split('-')[0]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('createDefaultEquityCompany', () => {
  it('creates company with provided name and owner', () => {
    const company = createDefaultEquityCompany('Test Corp', 'Alice');
    expect(company.name).toBe('Test Corp');
    expect(company.ownerName).toBe('Alice');
  });

  it('creates company with specified color', () => {
    const company = createDefaultEquityCompany('Test', 'Owner', 'purple');
    expect(company.color).toBe('purple');
  });

  it('defaults to blue color', () => {
    const company = createDefaultEquityCompany('Test', 'Owner');
    expect(company.color).toBe('blue');
  });

  it('creates company with valid exit config', () => {
    const company = createDefaultEquityCompany('Test', 'Owner');
    expect(company.exitConfig.exitYear).toBeGreaterThan(2024);
    expect(company.exitConfig.valuationAtExit).toBeGreaterThan(0);
    expect(company.exitConfig.sharePriceAtExit).toBeGreaterThan(0);
  });

  it('creates company with empty contracts array', () => {
    const company = createDefaultEquityCompany('Test', 'Owner');
    expect(company.contracts).toEqual([]);
  });

  it('generates unique ID', () => {
    const company1 = createDefaultEquityCompany('Test1', 'Owner1');
    const company2 = createDefaultEquityCompany('Test2', 'Owner2');
    expect(company1.id).not.toBe(company2.id);
  });
});

describe('createDefaultContract', () => {
  it('creates contract with default values', () => {
    const contract = createDefaultContract();
    expect(contract.name).toBe('New Grant');
    expect(contract.shares).toBe(10000);
    expect(contract.strike).toBe(1.0);
    expect(contract.periodYears).toBe(4);
    expect(contract.cliffMonths).toBe(12);
  });

  it('creates contract with valid date format', () => {
    const contract = createDefaultContract();
    expect(contract.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('creates contract with current month start date', () => {
    const contract = createDefaultContract();
    const today = new Date();
    const expectedMonth = String(today.getMonth() + 1).padStart(2, '0');
    expect(contract.startDate).toContain(`-${expectedMonth}-01`);
  });
});

// ============================================
// Edge Cases and Integration Tests
// ============================================

describe('Export/Import Integration', () => {
  it('full roundtrip preserves all data', () => {
    const originalData: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [
        { id: 1, name: 'Pension Fund', value: 2500000, type: 'pension' },
        { id: 2, name: 'Stocks', value: 1900000, type: 'liquid' },
        { id: 3, name: 'Property Investment', value: 400000, type: 'invest' },
      ],
      monthlyExpenses: [
        { id: 1, name: 'Rent', amount: 12000 },
        { id: 2, name: 'Food', amount: 3000 },
        { id: 3, name: 'Utilities', amount: 1500 },
      ],
      yearlyExpenses: [
        { id: 101, name: 'Vacation', amount: 50000 },
        { id: 102, name: 'Insurance', amount: 4500 },
      ],
      salaryData: { person1Gross: 70000, person1Net: 35200, person2Gross: 44000, person2Net: 26300 },
      equityCompanies: [
        {
          id: 'company-1',
          name: 'TechCorp',
          ownerName: 'Alice',
          color: 'indigo',
          totalShares: 100000,
          contracts: [
            { name: 'Initial Grant', shares: 80000, strike: 0.5, startDate: '2022-01-01', periodYears: 4, cliffMonths: 12 },
            { name: 'Refresher', shares: 20000, strike: 2.0, startDate: '2024-01-01', periodYears: 4, cliffMonths: 0 },
          ],
          exitConfig: { exitYear: 2027, valuationAtExit: 8, sharePriceAtExit: 25, retentionBonusUsd: 100000 },
        },
        {
          id: 'company-2',
          name: 'StartupInc',
          ownerName: 'Bob',
          color: 'purple',
          contracts: [
            { name: 'Founder Grant', shares: 50000, strike: 0.01, startDate: '2020-06-01', periodYears: 4, cliffMonths: 0 },
          ],
          exitConfig: { exitYear: 2029, valuationAtExit: 3, sharePriceAtExit: 50 },
        },
      ],
      propertyPlan: { enabled: true, config: { price: 7500000, year: 2031, monthlySavings: 10000 } },
      simulationParams: { returnRate: 7, inflationRate: 3, transitionToHalfWorkYear: 6, stopWorkYear: 18 },
    };

    // Export
    const json = exportToJson(originalData);
    
    // Import
    const { data: importedData, validation } = importFromJson(json);
    
    // Validate
    expect(validation.valid).toBe(true);
    expect(importedData).not.toBeNull();
    
    // Deep comparison
    expect(importedData?.assets).toEqual(originalData.assets);
    expect(importedData?.monthlyExpenses).toEqual(originalData.monthlyExpenses);
    expect(importedData?.yearlyExpenses).toEqual(originalData.yearlyExpenses);
    expect(importedData?.salaryData).toEqual(originalData.salaryData);
    expect(importedData?.equityCompanies).toEqual(originalData.equityCompanies);
    expect(importedData?.propertyPlan).toEqual(originalData.propertyPlan);
    expect(importedData?.simulationParams).toEqual(originalData.simulationParams);
  });

  it('handles empty arrays in roundtrip', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [],
      monthlyExpenses: [],
      yearlyExpenses: [],
      salaryData: { person1Gross: 0, person1Net: 0, person2Gross: 0, person2Net: 0 },
      equityCompanies: [],
      propertyPlan: { enabled: false, config: { price: 0, year: 2030, monthlySavings: 0 } },
      simulationParams: { returnRate: 6, inflationRate: 2, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };

    const json = exportToJson(data);
    const { data: imported, validation } = importFromJson(json);

    expect(validation.valid).toBe(true);
    expect(imported?.assets).toEqual([]);
    expect(imported?.equityCompanies).toEqual([]);
  });

  it('handles special characters in names', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [{ id: 1, name: 'פנסיה', value: 1000000, type: 'pension' }],
      monthlyExpenses: [{ id: 1, name: 'שכ"ד', amount: 12000 }],
      yearlyExpenses: [],
      salaryData: { person1Gross: 70000, person1Net: 35000, person2Gross: 44000, person2Net: 26000 },
      equityCompanies: [{
        id: 'test',
        name: 'חברה "בדיקה"',
        ownerName: 'משתמש',
        color: 'blue',
        contracts: [],
        exitConfig: { exitYear: 2028, valuationAtExit: 5, sharePriceAtExit: 20 },
      }],
      propertyPlan: { enabled: true, config: { price: 7000000, year: 2030, monthlySavings: 8000 } },
      simulationParams: { returnRate: 6, inflationRate: 2, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };

    const json = exportToJson(data);
    const { data: imported, validation } = importFromJson(json);

    expect(validation.valid).toBe(true);
    expect(imported?.assets[0].name).toBe('פנסיה');
    expect(imported?.monthlyExpenses[0].name).toBe('שכ"ד');
    expect(imported?.equityCompanies[0].name).toBe('חברה "בדיקה"');
  });

  it('handles very large numbers', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [{ id: 1, name: 'Large Fund', value: 999999999999, type: 'pension' }],
      monthlyExpenses: [],
      yearlyExpenses: [],
      salaryData: { person1Gross: 9999999, person1Net: 5000000, person2Gross: 8000000, person2Net: 4000000 },
      equityCompanies: [],
      propertyPlan: { enabled: true, config: { price: 50000000000, year: 2030, monthlySavings: 8000 } },
      simulationParams: { returnRate: 6, inflationRate: 2, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };

    const json = exportToJson(data);
    const { data: imported, validation } = importFromJson(json);

    expect(validation.valid).toBe(true);
    expect(imported?.assets[0].value).toBe(999999999999);
    expect(imported?.propertyPlan.config.price).toBe(50000000000);
  });

  it('handles decimal values', () => {
    const data: AppExportData = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      initialAge: 34,
      assets: [{ id: 1, name: 'Test', value: 1234567.89, type: 'liquid' }],
      monthlyExpenses: [{ id: 1, name: 'Test', amount: 12345.67 }],
      yearlyExpenses: [],
      salaryData: { person1Gross: 70000.5, person1Net: 35000.25, person2Gross: 44000.75, person2Net: 26000.33 },
      equityCompanies: [{
        id: 'test',
        name: 'Test',
        ownerName: 'Owner',
        color: 'blue',
        contracts: [{ name: 'Grant', shares: 10000, strike: 1.234567, startDate: '2024-01-01', periodYears: 4, cliffMonths: 12 }],
        exitConfig: { exitYear: 2028, valuationAtExit: 5.5, sharePriceAtExit: 20.99 },
      }],
      propertyPlan: { enabled: true, config: { price: 7000000.50, year: 2030, monthlySavings: 8000.50 } },
      simulationParams: { returnRate: 6.75, inflationRate: 2.33, transitionToHalfWorkYear: 5, stopWorkYear: 15 },
    };

    const json = exportToJson(data);
    const { data: imported, validation } = importFromJson(json);

    expect(validation.valid).toBe(true);
    expect(imported?.simulationParams.returnRate).toBe(6.75);
    expect(imported?.equityCompanies[0].contracts[0].strike).toBe(1.234567);
  });
});
