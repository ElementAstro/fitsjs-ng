# Project Structure

```
typescript-quick-starter/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI pipeline
│       └── docs.yml            # Docs deployment
├── .husky/
│   ├── commit-msg              # Commitlint hook
│   └── pre-commit              # Lint-staged hook
├── docs/                       # VitePress documentation
│   ├── .vitepress/
│   │   └── config.ts           # VitePress config
│   ├── api/
│   │   └── index.md            # API reference
│   ├── guide/
│   │   ├── building.md
│   │   ├── getting-started.md
│   │   ├── installation.md
│   │   ├── project-structure.md
│   │   └── testing.md
│   └── index.md                # Home page
├── src/
│   └── index.ts                # Library entry point
├── test/
│   └── index.test.ts           # Tests
├── .editorconfig               # Editor settings
├── .gitignore
├── .lintstagedrc.json          # Lint-staged config
├── .node-version               # Node version
├── .npmrc                      # pnpm settings
├── .prettierrc                 # Prettier config
├── .prettierignore
├── CHANGELOG.md
├── LICENSE
├── README.md
├── commitlint.config.js        # Commit message linting
├── eslint.config.js            # ESLint flat config
├── package.json
├── tsconfig.build.json         # Build-specific TS config
├── tsconfig.json               # Base TS config
├── tsup.config.ts              # Bundler config
└── vitest.config.ts            # Test config
```

## Key Directories

### `src/`

Library source code. The entry point is `src/index.ts`. All public APIs should be exported from here.

### `test/`

Test files using Vitest. Test files should follow the `*.test.ts` or `*.spec.ts` naming convention.

### `docs/`

VitePress documentation site. Run `pnpm docs:dev` to start the local dev server.

### `dist/`

Generated build output (gitignored). Contains ESM, CJS, and declaration files.
