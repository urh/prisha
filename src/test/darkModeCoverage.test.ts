import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dark mode here is a manual @media (prefers-color-scheme: dark) override
 * block in index.html that remaps specific Tailwind utility classes with
 * !important (the app uses the Tailwind CDN — no config, no dark: variants).
 * The #1 regression risk: a new "light-tint" utility class used in JSX but
 * missing from the override silently renders light-mode colors on the dark
 * background. There is no build step that catches it — this test is it.
 */

const ROOT = path.resolve(__dirname, '..', '..');

function darkOverrideCss(): string {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  const start = html.indexOf('prefers-color-scheme: dark');
  expect(start).toBeGreaterThan(-1);
  // strip the CSS escaping so tokens like bg-slate-50\/60 compare cleanly
  return html.slice(start).replace(/\\/g, '');
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.tsx')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

// Light-tint utilities that MUST be remapped for dark mode. Saturated colors
// (bg-*-500+), text-white and gradients read fine on dark and are exempt.
const REQUIRED = new RegExp(
  '^(?:hover:|focus:)?(?:' +
  'bg-white|' +
  'bg-[a-z]+-(?:50|100|200)(?:/\\d{1,3})?|' +
  'text-[a-z]+-(?:200|300|400|500|600|700)|' +
  'border-[a-z]+-(?:50|100|200)' +
  ')$'
);
const EXEMPT = new Set(['text-white']);

const CLASS_TOKEN = /\b((?:hover:|focus:)?(?:bg|text|border)-(?:white|black|slate|gray|zinc|emerald|green|rose|red|sky|blue|amber|yellow|indigo|violet|purple|orange|pink|teal|cyan)(?:-\d{2,3})?(?:\/\d{1,3})?)\b/g;

describe('dark-mode override coverage', () => {
  it('every light-tint utility class used in src is remapped in index.html', () => {
    const css = darkOverrideCss();
    const missing = new Set<string>();
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf-8');
      for (const m of src.matchAll(CLASS_TOKEN)) {
        const token = m[1];
        const base = token.replace(/^(?:hover:|focus:)/, '');
        if (EXEMPT.has(base)) continue;
        if (!REQUIRED.test(token)) continue;
        if (!css.includes(token)) missing.add(`${token} (${path.basename(file)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('regression: no text-slate-200/300 in MonthActuals (dark remap INVERTS them — unreadable on the slate-800 archive chip)', () => {
    // The slate-200/300 dark remaps are intentionally inverted (lighter class →
    // darker color) for faint-on-light-card elements like hover-reveal delete
    // icons. Using them as light-on-dark text yields ~1.7:1 contrast.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'MonthActuals.tsx'), 'utf-8');
    expect(src.includes('text-slate-200')).toBe(false);
    expect(src.includes('text-slate-300')).toBe(false);
  });
});
