import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // tsconfig keeps Next's `jsx: preserve`; tests that import .tsx components (DeptTag)
  // need Vite's transformer (oxc) to actually compile JSX.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': resolve(__dirname) },
  },
});
