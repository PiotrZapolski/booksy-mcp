import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'extension/dist/', 'node_modules/', 'scripts/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
