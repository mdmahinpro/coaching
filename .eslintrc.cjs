module.exports = {
  root: true,
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    babelOptions: {
      presets: ['@babel/preset-typescript', '@babel/preset-react'],
      parserOpts: { flow: false },
    },
    ecmaVersion: 2024,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '**/*.test.ts',
  ],
  plugins: ['react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    // React 17+ doesn't need React in scope
    'react/react-in-jsx-scope': 'off',
    // TypeScript covers prop types
    'react/prop-types': 'off',
    // set-state-in-effect / static-components / purity / immutability:
    // off for existing code patterns; revisit during refactor.
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/static-components': 'off',
    'react-hooks/purity': 'off',
    'react-hooks/immutability': 'off',
    // Warnings for pre-existing issues
    'react-hooks/exhaustive-deps': 'warn',
    'react-hooks/incompatible-library': 'warn',
    // Warn about target="_blank" without rel
    'react/jsx-no-target-blank': 'warn',
    // Unused vars: ignore underscore-prefixed
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Prefer const
    'prefer-const': 'warn',
    // === instead of ==
    'eqeqeq': ['warn', 'always'],
    // Require braces for all blocks
    'curly': 'warn',
    // logger.ts intentionally uses console
    'no-console': 'off',
    // TypeScript handles type checking — ESLint focuses on code quality
    'no-undef': 'off',
    // No unused expressions (allow short-circuit for early returns)
    'no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
    // Control characters in regex
    'no-control-regex': 'warn',
    // Unknown React properties (e.g., shadcn/cmdk data attributes)
    'react/no-unknown-property': 'warn',
    // No implicit returns in arrow functions
    'consistent-return': 'warn',
  },
};
