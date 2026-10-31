import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', '.data/**', '.tmp/**', 'node_modules/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**'] },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
      // Effects here load data or reset local form state when a prop changes; they do not cascade.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
