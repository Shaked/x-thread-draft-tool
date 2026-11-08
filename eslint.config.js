import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'public/**'],
  },

  // Applies to every JavaScript file. TypeScript (tests/e2e/*.ts) is not linted here.
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
      complexity: ['error', 20],
      eqeqeq: 'error',
    },
  },

  // Browser React app.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // The app does not use PropTypes; typing components is out of scope for this gate.
      'react/prop-types': 'off',
    },
  },

  // Server and API routes run on Node. Only error and warn may be logged.
  {
    files: ['server/**/*.{js,mjs,cjs}', 'api/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // Scripts run on Node from the command line.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  // Tests run under vitest (and Node for helpers).
  {
    files: ['tests/**/*.{js,jsx,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...vitestGlobals } },
  },

  // Unit tests render React components in jsdom.
  {
    files: ['tests/unit/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react/prop-types': 'off',
    },
  },

  // Root config files.
  {
    files: ['*.config.{js,mjs,cjs}', 'vite.config.js', 'vitest.config.js'],
    languageOptions: { globals: globals.node },
  },
]
