# Testing

The project uses [Vitest](https://vitest.dev/) for unit/integration tests.

## Run Test Suites

```bash
pnpm test
```

Watch mode:

```bash
pnpm test:watch
```

Coverage:

```bash
pnpm test:coverage
```

## Targeted Regression Runs

For fast checks on core conversion flows:

```bash
pnpm test -- -t "SER conversions|XISF/FITS conversion|hips-convert"
```

## Test Layout

- FITS tests: `test/fits/*.test.ts`
- XISF tests: `test/xisf/*.test.ts`
- SER tests: `test/ser/*.test.ts`
- HiPS tests: `test/hips/*.test.ts`
- Validation tests: `test/validation/*.test.ts`
- Shared fixtures/helpers: `test/fixtures/*`, `test/shared/*`

## Writing New Tests

Use `*.test.ts` naming and keep tests near domain folders.

```ts
import { describe, expect, it } from 'vitest'
import { FITS } from '../../src/fits'

describe('fits parser', () => {
  it('parses a simple image', () => {
    const fits = FITS.fromArrayBuffer(buffer)
    expect(fits.getHeader()?.getNumber('NAXIS')).toBe(2)
  })
})
```
