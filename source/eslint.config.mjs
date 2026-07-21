import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['.next/', 'node_modules/', 'out/', 'dist/', '.turbo/'],
  },
  // Browser/React app code
  {
    files: ['src/app/**/*.{js,jsx,ts,tsx}', 'src/components/**/*.{js,jsx,ts,tsx}', '**/*.{jsx,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        React: 'readonly',
        JSX: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Node.js scripts and config files
  {
    files: ['scripts/**/*.{js,mjs,ts}', 'src/scripts/**/*.{js,mjs,ts}', '*.config.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Node libraries (src/lib/)
  {
    files: ['src/lib/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Test files with Vitest globals
  {
    files: ['src/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // TypeScript config for all TS files
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['**/*.{ts,tsx}'],
  })),
  // React hooks for JSX/TSX
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Project-wide tuning: empty `catch {}` blocks are the codebase's intentional
  // best-effort pattern (cleanup, optional probes); non-catch empty blocks still error.
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // R1.4 security invariant (§4.2): app/features must not spawn subprocesses
  // directly — all launches route through the runner chokepoint.
  // User-authorized edit 2026-07-18; see .workflow/LEDGER.md R1.4.
  {
    files: ['src/app/**/*.{js,jsx,ts,tsx}', 'src/features/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'child_process', message: 'Route subprocess launches through src/lib/runner.ts (R1.4).' },
          { name: 'node:child_process', message: 'Route subprocess launches through src/lib/runner.ts (R1.4).' },
        ],
      }],
    },
  },
];
