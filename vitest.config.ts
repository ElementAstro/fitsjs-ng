import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.1-test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/hips-types.ts', 'src/xisf-types.ts'],
      thresholds: {
        perFile: false,
        lines: 75,
        branches: 60,
        functions: 85,
        statements: 75,
      },
    },
  },
})
