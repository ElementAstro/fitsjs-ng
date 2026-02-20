# Documentation Standards

This page defines the project documentation conventions for `README` and `docs/*`.

## Scope and Source of Truth

- Public runtime API is defined by `src/index.ts`.
- API docs must match exported names and option shapes in source.
- Demo commands and output locations must match `package.json` scripts and `demo/*`.

## Writing Style

- Use concise technical English.
- Prefer explicit behavior descriptions over marketing language.
- Use consistent terms: `FITS`, `SER`, `XISF`, `HiPS`, `ArrayBuffer`, `Blob`, `Node buffer-like`.

## Code Snippet Rules

- Snippets must be runnable or clearly marked as pseudo-code.
- Prefer `import { ... } from 'fitsjs-ng'` for public usage.
- Avoid placeholder APIs that do not exist in this repository.
- Keep examples offline-first unless the section is explicitly about remote behavior.

## Path and Output Conventions

- Node demo outputs: `demo/.out/*`.
- Test paths should use current domain folders, e.g. `test/xisf/convert.test.ts`.
- Avoid stale template paths/names (for example `typescript-quick-starter`).

## API Change Checklist

When public APIs change, update:

1. `README.md`
2. `docs/api/*.md`
3. `docs/guide/*.md` examples
4. `demo/*` and relevant script references

## Pre-merge Validation Checklist

Run at least:

```bash
pnpm typecheck
pnpm test
pnpm demo:all
```

For docs-focused updates, also run:

```bash
pnpm docs:build
```
