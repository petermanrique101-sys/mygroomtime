import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const restrictPrismaClient = {
  files: ['**/*.{ts,tsx,js,mjs,cjs}'],
  ignores: ['packages/db/**', 'scripts/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message:
              'Do not import @prisma/client directly. Use `db.forTenant(tenantId)` or `db.global` from @mygroomtime/db so every query is tenant-scoped.',
          },
        ],
        patterns: [
          {
            group: ['@prisma/client/*'],
            message:
              'Do not import @prisma/client internals. Use @mygroomtime/db.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/generated/**',
      '**/coverage/**',
      '**/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  restrictPrismaClient,
);
