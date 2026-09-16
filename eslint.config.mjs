import next from 'eslint-config-next';

const config = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'tests/e2e/**', 'data/**'],
  },
  {
    // Server code must never write to stdout directly. All logging goes through
    // lib/logger.ts, which redacts identifying fields. This is also enforced at
    // runtime by tests/logging-canary.test.ts.
    files: ['lib/**/*.ts', 'app/api/**/*.ts'],
    ignores: ['lib/logger.ts'],
    rules: {
      'no-console': 'error',
    },
  },
];

export default config;
