# Prisha - Personal Financial Planning Dashboard

A comprehensive wealth planning and retirement simulation application built for Israeli households. The app helps track assets, manage budgets, simulate equity vesting, and plan for early retirement with accurate Israeli tax calculations.

## Features

### Asset Management
- Track pension accounts, investment portfolios, and liquid assets
- Separate view for pension vs. investment holdings
- Real-time total wealth calculation

### Budget Tracking
- Monthly and yearly expense management
- Salary tracking (gross and net) for household members
- Automatic savings rate calculation

### Stock Equity Simulation
- Track equity vesting schedules for multiple companies
- Support for cliff periods and linear vesting
- Exit scenario modeling (acquisition, IPO)
- Net equity calculation after Israeli capital gains tax

### Retirement Planning
- Multi-phase retirement simulation:
  - Full-time work → Half-time work → Full retirement
- Find optimal monthly withdrawal rate
- Property purchase planning and rent elimination modeling
- Configurable parameters: return rate, inflation, timeline

### Israeli Tax Engine
- Accurate marginal tax brackets for employment income
- Early pension withdrawal tax (before age 60) with 31%+ brackets
- Capital gains tax (25%) with surtax above ₪721,560
- Pension annuity conversion at age 60 (coefficient method)
- 15% pension income tax

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Charts**: Recharts
- **Icons**: Lucide React
- **Testing**: Vitest with Testing Library
- **Storage**: localStorage (auto-save with debounce)

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Project Structure

```
src/
├── App.tsx              # Main application component
├── main.tsx             # Entry point
├── types.ts             # TypeScript interfaces
├── utils/
│   └── calculations.ts  # Financial calculation functions
└── test/
    ├── setup.ts         # Test configuration
    └── calculations.test.ts  # Unit tests
```

## Key Calculations

The simulation engine (`calculations.ts`) handles:

- **Net equity after taxes**: Capital gains + surtax calculation
- **Vesting schedules**: Linear vesting with cliff support
- **Budget summaries**: Monthly expense aggregation
- **Optimal withdrawal**: Binary search for maximum sustainable withdrawal
- **Marginal tax**: Israeli bracket-based tax calculation
- **Pension annuity**: Fixed coefficient (210) conversion at age 60

## Configuration

Default values are set for a specific household but can be adjusted in the UI:

- Initial assets and their types (pension/liquid/investment)
- Monthly and yearly expenses
- Salary data for both household members
- Stock option contracts with vesting schedules
- Property purchase plans
- Simulation parameters (return rate, inflation, timeline)

## Language

The UI is in Hebrew with right-to-left (RTL) layout, designed specifically for Israeli users.

## License

MIT
