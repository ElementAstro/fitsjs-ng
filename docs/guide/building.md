# Building

The library uses [tsup](https://tsup.egoist.dev/) for bundling, which is powered by esbuild for fast builds.

## Build Command

```bash
pnpm build
```

## Output

The build produces the following files in `dist/`:

| File            | Format      | Description              |
| --------------- | ----------- | ------------------------ |
| `index.js`      | ESM         | ES Module format         |
| `index.cjs`     | CJS         | CommonJS format          |
| `index.d.ts`    | Declaration | TypeScript types for ESM |
| `index.d.cts`   | Declaration | TypeScript types for CJS |
| `index.js.map`  | Source Map  | ESM source map           |
| `index.cjs.map` | Source Map  | CJS source map           |

## Build Configuration

The build is configured in `tsup.config.ts`:

- **Dual format** — ESM + CJS for maximum compatibility
- **Declaration files** — Auto-generated `.d.ts` and `.d.cts`
- **Source maps** — For debugging in consuming projects
- **Tree shaking** — Removes unused code
- **Minification** — Reduces bundle size for production
- **Clean** — Clears `dist/` before each build
- **Target** — ES2022 for modern JavaScript features

## Watch Mode

For development, use watch mode to rebuild on file changes:

```bash
pnpm dev
```
