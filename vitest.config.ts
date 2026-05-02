import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 10_000,
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'index.ts'],
      exclude: ['src/**/*.d.ts', 'src/types.ts', 'src/events.ts']
    }
  }
})
