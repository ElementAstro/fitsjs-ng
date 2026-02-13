# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

## Quick Start

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-username/typescript-quick-starter.git
cd typescript-quick-starter
pnpm install
```

## Development

Start the development build in watch mode:

```bash
pnpm dev
```

Run tests:

```bash
pnpm test
```

## Build

Build the library for production:

```bash
pnpm build
```

This will output both ESM and CJS formats to the `dist/` directory, along with TypeScript declaration files.

## Available Scripts

| Script               | Description                  |
| -------------------- | ---------------------------- |
| `pnpm build`         | Build the library            |
| `pnpm dev`           | Build in watch mode          |
| `pnpm test`          | Run tests                    |
| `pnpm test:watch`    | Run tests in watch mode      |
| `pnpm test:coverage` | Run tests with coverage      |
| `pnpm lint`          | Lint source files            |
| `pnpm lint:fix`      | Lint and auto-fix            |
| `pnpm format`        | Format source files          |
| `pnpm typecheck`     | Run TypeScript type checking |
| `pnpm docs:dev`      | Start docs dev server        |
| `pnpm docs:build`    | Build docs for production    |
| `pnpm docs:preview`  | Preview built docs           |
