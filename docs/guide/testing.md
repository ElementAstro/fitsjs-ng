# Testing

The project uses [Vitest](https://vitest.dev/) as its testing framework.

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage report
pnpm test:coverage
```

## Writing Tests

Test files should be placed in the `test/` directory with a `.test.ts` or `.spec.ts` suffix.

```ts
import { describe, it, expect } from 'vitest'
import { greet } from '../src/index'

describe('greet', () => {
  it('should return greeting message', () => {
    expect(greet('World')).toBe('Hello, World!')
  })
})
```

## Coverage

Coverage is collected using the `v8` provider and outputs in three formats:

- **text** — Console output
- **json** — Machine-readable JSON
- **html** — Browse at `coverage/index.html`

```bash
pnpm test:coverage
```
