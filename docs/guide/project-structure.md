# Project Structure

```text
fitsjs-ng/
├── demo/                        # Node + web demos
│   ├── index.ts
│   ├── ser-node.ts
│   ├── xisf-node.ts
│   ├── hips-node.ts
│   └── web/
├── docs/                        # VitePress docs
│   ├── .vitepress/config.ts
│   ├── api/
│   └── guide/
├── src/                         # Library source
│   ├── core/                    # Shared constants/types/errors/utils
│   ├── fits/                    # FITS parser/writer/data units
│   ├── xisf/                    # XISF parser/writer/conversion
│   ├── ser/                     # SER parser/writer/conversion
│   ├── hips/                    # HiPS build/export/bridge/targets
│   ├── validation/              # Lint/validation helpers
│   └── index.ts                 # Public exports
├── test/                        # Domain-grouped tests
│   ├── core/
│   ├── fits/
│   ├── xisf/
│   ├── ser/
│   ├── hips/
│   ├── validation/
│   ├── shared/
│   └── fixtures/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Directory Notes

### `src/`

All runtime code. Public APIs are re-exported via `src/index.ts`.

### `demo/`

Executable examples for Node and browser scenarios.

- Node demos write artifacts under `demo/.out/*`.
- Web demos are served via `pnpm demo:web`.

### `test/`

Tests are organized by domain to mirror `src/` for easier maintenance.

### `docs/`

VitePress documentation. Run `pnpm docs:dev` for local preview.
