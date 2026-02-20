# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

## Quick Start

```bash
git clone https://github.com/ElementAstro/fitsjs-ng.git
cd fitsjs-ng
pnpm install
```

Run the overview demo:

```bash
pnpm demo
```

Run all Node demos in sequence:

```bash
pnpm demo:all
```

Demo outputs are generated in `demo/.out/*`.

## Development

Start the watch build:

```bash
pnpm dev
```

Run tests:

```bash
pnpm test
```

Run type checking:

```bash
pnpm typecheck
```

## Build

Build ESM + CJS + declaration files:

```bash
pnpm build
```

## Available Scripts

| Script               | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `pnpm build`         | Build the library                                                 |
| `pnpm dev`           | Build in watch mode                                               |
| `pnpm test`          | Run tests                                                         |
| `pnpm test:watch`    | Run tests in watch mode                                           |
| `pnpm test:coverage` | Run tests with coverage                                           |
| `pnpm lint`          | Lint source files                                                 |
| `pnpm lint:fix`      | Lint and auto-fix                                                 |
| `pnpm format`        | Format source files                                               |
| `pnpm typecheck`     | Run TypeScript type checking                                      |
| `pnpm demo`          | Overview Node demo (FITS + XISF + SER + HiPS bridge)              |
| `pnpm demo:ser`      | SER Node demo                                                     |
| `pnpm demo:xisf`     | XISF Node demo                                                    |
| `pnpm demo:hips`     | HiPS Node demo                                                    |
| `pnpm demo:all`      | Run all Node demos (`demo`, `demo:xisf`, `demo:ser`, `demo:hips`) |
| `pnpm demo:web`      | Build and serve web demos                                         |
| `pnpm docs:dev`      | Start docs dev server                                             |
| `pnpm docs:build`    | Build docs for production                                         |
| `pnpm docs:preview`  | Preview built docs                                                |
