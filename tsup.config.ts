import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  shims: true,
  banner: {
    js: `// ${pkg.name} v${pkg.version} | ${pkg.license} License`,
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.charset = 'utf8'
  },
})
