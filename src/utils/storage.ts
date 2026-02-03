import type {
  Asset,
  Expense,
  SalaryData,
  PropertyConfig,
  EquityContract,
} from '../types';

/**
 * Equity company configuration with contracts
 */
export interface EquityCompany {
  id: string;
  name: string;
  ownerName: string;
  contracts: EquityContract[];
  exitConfig: {
    exitYear: number;
    valuationAtExit: number;
    sharePriceAtExit: number;
    retentionBonusUsd?: number;
  };
  totalShares?: number; // For net equity calculation
  color: 'indigo' | 'purple' | 'emerald' | 'rose' | 'blue' | 'amber';
}

/**
 * Property configuration (optional)
 */
export interface PropertyPlan {
  enabled: boolean;
  config: PropertyConfig;
}

/**
 * Complete app state for export/import
 */
export interface AppExportData {
  version: string;
  exportDate: string;
  initialAge: number;
  assets: Asset[];
  monthlyExpenses: Expense[];
  yearlyExpenses: Expense[];
  salaryData: SalaryData;
  equityCompanies: EquityCompany[];
  propertyPlan: PropertyPlan;
  simulationParams: {
    returnRate: number;
    inflationRate: number;
    transitionToHalfWorkYear: number;
    stopWorkYear: number;
  };
}

// Current export format version
export const EXPORT_VERSION = '1.0.0';

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an asset object
 */
export function validateAsset(asset: unknown, index: number): string[] {
  const errors: string[] = [];
  if (!asset || typeof asset !== 'object') {
    errors.push(`Asset ${index}: Invalid object`);
    return errors;
  }
  
  const a = asset as Record<string, unknown>;
  
  if (typeof a.id !== 'number') {
    errors.push(`Asset ${index}: Missing or invalid 'id' (must be number)`);
  }
  if (typeof a.name !== 'string' || a.name.trim() === '') {
    errors.push(`Asset ${index}: Missing or invalid 'name' (must be non-empty string)`);
  }
  if (typeof a.value !== 'number' || isNaN(a.value)) {
    errors.push(`Asset ${index}: Missing or invalid 'value' (must be number)`);
  }
  if (!['pension', 'liquid', 'invest'].includes(a.type as string)) {
    errors.push(`Asset ${index}: Invalid 'type' (must be pension, liquid, or invest)`);
  }
  
  return errors;
}

/**
 * Validate an expense object
 */
export function validateExpense(expense: unknown, index: number, type: string): string[] {
  const errors: string[] = [];
  if (!expense || typeof expense !== 'object') {
    errors.push(`${type} expense ${index}: Invalid object`);
    return errors;
  }
  
  const e = expense as Record<string, unknown>;
  
  if (typeof e.id !== 'number') {
    errors.push(`${type} expense ${index}: Missing or invalid 'id' (must be number)`);
  }
  if (typeof e.name !== 'string' || e.name.trim() === '') {
    errors.push(`${type} expense ${index}: Missing or invalid 'name' (must be non-empty string)`);
  }
  if (typeof e.amount !== 'number' || isNaN(e.amount) || e.amount < 0) {
    errors.push(`${type} expense ${index}: Missing or invalid 'amount' (must be non-negative number)`);
  }
  
  return errors;
}

/**
 * Validate salary data
 */
export function validateSalaryData(salary: unknown): string[] {
  const errors: string[] = [];
  if (!salary || typeof salary !== 'object') {
    errors.push('Salary data: Invalid object');
    return errors;
  }
  
  const s = salary as Record<string, unknown>;
  const fields = ['person1Gross', 'person1Net', 'person2Gross', 'person2Net'];
  
  fields.forEach(field => {
    if (typeof s[field] !== 'number' || isNaN(s[field] as number) || (s[field] as number) < 0) {
      errors.push(`Salary data: Invalid '${field}' (must be non-negative number)`);
    }
  });
  
  return errors;
}

/**
 * Validate equity contract
 */
export function validateEquityContract(contract: unknown, companyName: string, index: number): string[] {
  const errors: string[] = [];
  if (!contract || typeof contract !== 'object') {
    errors.push(`${companyName} contract ${index}: Invalid object`);
    return errors;
  }
  
  const c = contract as Record<string, unknown>;
  
  if (typeof c.name !== 'string' || c.name.trim() === '') {
    errors.push(`${companyName} contract ${index}: Missing or invalid 'name'`);
  }
  if (typeof c.shares !== 'number' || isNaN(c.shares) || c.shares < 0) {
    errors.push(`${companyName} contract ${index}: Invalid 'shares' (must be non-negative number)`);
  }
  if (typeof c.strike !== 'number' || isNaN(c.strike) || c.strike < 0) {
    errors.push(`${companyName} contract ${index}: Invalid 'strike' (must be non-negative number)`);
  }
  if (typeof c.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.startDate)) {
    errors.push(`${companyName} contract ${index}: Invalid 'startDate' (must be YYYY-MM-DD format)`);
  }
  if (typeof c.periodYears !== 'number' || isNaN(c.periodYears) || c.periodYears <= 0) {
    errors.push(`${companyName} contract ${index}: Invalid 'periodYears' (must be positive number)`);
  }
  if (typeof c.cliffMonths !== 'number' || isNaN(c.cliffMonths) || c.cliffMonths < 0) {
    errors.push(`${companyName} contract ${index}: Invalid 'cliffMonths' (must be non-negative number)`);
  }
  
  return errors;
}

/**
 * Validate equity company
 */
export function validateEquityCompany(company: unknown, index: number): string[] {
  const errors: string[] = [];
  if (!company || typeof company !== 'object') {
    errors.push(`Equity company ${index}: Invalid object`);
    return errors;
  }
  
  const c = company as Record<string, unknown>;
  
  if (typeof c.id !== 'string' || c.id.trim() === '') {
    errors.push(`Equity company ${index}: Missing or invalid 'id'`);
  }
  if (typeof c.name !== 'string' || c.name.trim() === '') {
    errors.push(`Equity company ${index}: Missing or invalid 'name'`);
  }
  if (typeof c.ownerName !== 'string' || c.ownerName.trim() === '') {
    errors.push(`Equity company ${index}: Missing or invalid 'ownerName'`);
  }
  
  const validColors = ['indigo', 'purple', 'emerald', 'rose', 'blue', 'amber'];
  if (!validColors.includes(c.color as string)) {
    errors.push(`Equity company ${index}: Invalid 'color' (must be one of: ${validColors.join(', ')})`);
  }
  
  // Validate contracts array
  if (!Array.isArray(c.contracts)) {
    errors.push(`Equity company ${index}: 'contracts' must be an array`);
  } else {
    (c.contracts as unknown[]).forEach((contract, i) => {
      errors.push(...validateEquityContract(contract, c.name as string || `Company ${index}`, i));
    });
  }
  
  // Validate exit config
  if (!c.exitConfig || typeof c.exitConfig !== 'object') {
    errors.push(`Equity company ${index}: Missing or invalid 'exitConfig'`);
  } else {
    const ec = c.exitConfig as Record<string, unknown>;
    if (typeof ec.exitYear !== 'number' || isNaN(ec.exitYear)) {
      errors.push(`Equity company ${index}: Invalid 'exitConfig.exitYear'`);
    }
    if (typeof ec.valuationAtExit !== 'number' || isNaN(ec.valuationAtExit)) {
      errors.push(`Equity company ${index}: Invalid 'exitConfig.valuationAtExit'`);
    }
    if (typeof ec.sharePriceAtExit !== 'number' || isNaN(ec.sharePriceAtExit)) {
      errors.push(`Equity company ${index}: Invalid 'exitConfig.sharePriceAtExit'`);
    }
  }
  
  return errors;
}

/**
 * Validate property plan
 */
export function validatePropertyPlan(plan: unknown): string[] {
  const errors: string[] = [];
  if (!plan || typeof plan !== 'object') {
    errors.push('Property plan: Invalid object');
    return errors;
  }
  
  const p = plan as Record<string, unknown>;
  
  if (typeof p.enabled !== 'boolean') {
    errors.push("Property plan: 'enabled' must be boolean");
  }
  
  if (!p.config || typeof p.config !== 'object') {
    errors.push('Property plan: Missing or invalid config');
  } else {
    const c = p.config as Record<string, unknown>;
    if (typeof c.price !== 'number' || isNaN(c.price) || c.price < 0) {
      errors.push("Property plan: Invalid 'price'");
    }
    if (typeof c.year !== 'number' || isNaN(c.year)) {
      errors.push("Property plan: Invalid 'year'");
    }
  }
  
  return errors;
}

/**
 * Validate simulation params
 */
export function validateSimulationParams(params: unknown): string[] {
  const errors: string[] = [];
  if (!params || typeof params !== 'object') {
    errors.push('Simulation params: Invalid object');
    return errors;
  }
  
  const p = params as Record<string, unknown>;
  
  if (typeof p.returnRate !== 'number' || isNaN(p.returnRate)) {
    errors.push("Simulation params: Invalid 'returnRate'");
  }
  if (typeof p.inflationRate !== 'number' || isNaN(p.inflationRate)) {
    errors.push("Simulation params: Invalid 'inflationRate'");
  }
  if (typeof p.transitionToHalfWorkYear !== 'number' || isNaN(p.transitionToHalfWorkYear)) {
    errors.push("Simulation params: Invalid 'transitionToHalfWorkYear'");
  }
  if (typeof p.stopWorkYear !== 'number' || isNaN(p.stopWorkYear)) {
    errors.push("Simulation params: Invalid 'stopWorkYear'");
  }
  
  return errors;
}

/**
 * Validate initial age
 */
export function validateInitialAge(age: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof age !== 'number' || isNaN(age)) {
    errors.push("Initial age: Invalid value (must be a number)");
    return errors;
  }
  
  if (age < 18 || age > 80) {
    errors.push("Initial age: Must be between 18 and 80");
  }
  
  return errors;
}

/**
 * Validate complete export data
 */
export function validateExportData(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid data format: expected object'], warnings };
  }
  
  const d = data as Record<string, unknown>;
  
  // Check version
  if (typeof d.version !== 'string') {
    warnings.push('Missing version field, assuming compatible format');
  } else if (d.version !== EXPORT_VERSION) {
    warnings.push(`Version mismatch: expected ${EXPORT_VERSION}, got ${d.version}`);
  }
  
  // Validate initial age
  if (d.initialAge !== undefined) {
    errors.push(...validateInitialAge(d.initialAge));
  }
  
  // Validate assets
  if (!Array.isArray(d.assets)) {
    errors.push("'assets' must be an array");
  } else {
    (d.assets as unknown[]).forEach((asset, i) => {
      errors.push(...validateAsset(asset, i));
    });
  }
  
  // Validate monthly expenses
  if (!Array.isArray(d.monthlyExpenses)) {
    errors.push("'monthlyExpenses' must be an array");
  } else {
    (d.monthlyExpenses as unknown[]).forEach((expense, i) => {
      errors.push(...validateExpense(expense, i, 'Monthly'));
    });
  }
  
  // Validate yearly expenses
  if (!Array.isArray(d.yearlyExpenses)) {
    errors.push("'yearlyExpenses' must be an array");
  } else {
    (d.yearlyExpenses as unknown[]).forEach((expense, i) => {
      errors.push(...validateExpense(expense, i, 'Yearly'));
    });
  }
  
  // Validate salary data
  errors.push(...validateSalaryData(d.salaryData));
  
  // Validate equity companies
  if (!Array.isArray(d.equityCompanies)) {
    errors.push("'equityCompanies' must be an array");
  } else {
    (d.equityCompanies as unknown[]).forEach((company, i) => {
      errors.push(...validateEquityCompany(company, i));
    });
  }
  
  // Validate property plan
  errors.push(...validatePropertyPlan(d.propertyPlan));
  
  // Validate simulation params
  errors.push(...validateSimulationParams(d.simulationParams));
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Export data to JSON string
 */
export function exportToJson(data: AppExportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Import data from JSON string
 */
export function importFromJson(jsonString: string): { data: AppExportData | null; validation: ValidationResult } {
  let parsed: unknown;
  
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      data: null,
      validation: {
        valid: false,
        errors: [`Invalid JSON: ${(e as Error).message}`],
        warnings: [],
      },
    };
  }
  
  const validation = validateExportData(parsed);
  
  if (!validation.valid) {
    return { data: null, validation };
  }
  
  return { data: parsed as AppExportData, validation };
}

/**
 * Download data as JSON file
 */
export function downloadAsJson(data: AppExportData, filename: string = 'financial-plan.json'): void {
  const json = exportToJson(data);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read file and return contents
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Generate unique ID for new items
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default equity company template
 */
export function createDefaultEquityCompany(name: string, ownerName: string, color: EquityCompany['color'] = 'blue'): EquityCompany {
  return {
    id: generateId(),
    name,
    ownerName,
    color,
    contracts: [],
    exitConfig: {
      exitYear: new Date().getFullYear() + 5,
      valuationAtExit: 1,
      sharePriceAtExit: 10,
    },
  };
}

/**
 * Create default equity contract template
 */
export function createDefaultContract(): EquityContract {
  const today = new Date();
  return {
    name: 'New Grant',
    shares: 10000,
    strike: 1.0,
    startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
    periodYears: 4,
    cliffMonths: 12,
  };
}
