import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // 架构约束：物理与模拟层必须是纯 TypeScript，禁止依赖 React / Three / 渲染层 / UI。
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: '物理/模拟层不得依赖 React。' },
            { name: 'react-dom', message: '物理/模拟层不得依赖 React。' },
            { name: 'three', message: '物理/模拟层不得依赖 Three.js，请使用 @/game/physics/math。' },
            { name: 'zustand', message: '物理/模拟层不得依赖状态管理库。' },
          ],
          patterns: [
            { group: ['@react-three/*'], message: '物理/模拟层不得依赖渲染库。' },
            { group: ['@/rendering/*', '@/components/*', '@/app/*', '@/stores/*'], message: '物理/模拟层不得依赖上层模块。' },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.{ts,js}', 'tests/e2e/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
