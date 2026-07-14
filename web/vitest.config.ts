import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['lib/**', 'app/**'],
      exclude: [
        'lib/api/mock.ts',
        'lib/share-cards.ts',
        'app/**/*.tsx',
        'app/**/*.css',
        '**/*.test.ts',
        '**/__tests__/**',
        'app/layout.tsx',
        'app/page.tsx',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
        'lib/llm.ts': { lines: 90 },
        'lib/report.ts': { lines: 85 },
        'lib/safety.ts': { lines: 85 },
      },
    },
  },
});
