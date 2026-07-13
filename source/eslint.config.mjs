import js from '@eslint/js';

export default [
  {
    ignores: ['.next/', 'node_modules/', 'out/', 'dist/', '.turbo/'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        React: 'readonly',
        JSX: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
];
