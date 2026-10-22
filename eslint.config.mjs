// ESLint flat config: typescript-eslint with type information. Formatting is
// left to Prettier (eslint-config-prettier turns off conflicting rules).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**', '*.vsix'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Processes are spawned only by src/core/process.ts (argument array, no shell).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', message: 'Use src/core/process.ts.' },
            { name: 'node:child_process', message: 'Use src/core/process.ts.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/process.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync', 'execFile', 'execFileSync'],
              message: 'Use spawn with shell: false.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  prettier,
);
