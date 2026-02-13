# typescript-quick-starter

A TypeScript library quick starter template.

## Features

- **TypeScript** with strict mode
- **tsup** for bundling (ESM + CJS dual output, minified, tree-shakeable)
- **Vitest** for testing
- **ESLint** + **Prettier** for code quality
- **VitePress** for documentation
- **Husky** + **lint-staged** + **commitlint** for git workflow
- **GitHub Actions** for CI/CD and docs deployment
- **pnpm** as package manager

## Getting Started

```bash
# Install dependencies
pnpm install

# Development (watch mode)
pnpm dev

# Build
pnpm build

# Test
pnpm test

# Lint
pnpm lint

# Format
pnpm format

# Type check
pnpm typecheck
```

## Documentation

```bash
# Start docs dev server
pnpm docs:dev

# Build docs
pnpm docs:build

# Preview built docs
pnpm docs:preview
```

## Project Structure

```
├── src/                   # Library source code
├── test/                  # Tests
├── docs/                  # VitePress documentation
├── dist/                  # Build output (generated)
├── .github/workflows/     # CI + Docs deployment
├── tsup.config.ts         # Bundler config
├── vitest.config.ts       # Test config
├── eslint.config.js       # ESLint flat config
└── package.json
```

## Publishing

```bash
# Build and publish
pnpm publish
```

## License

[MIT](LICENSE)
