# Installation

## As a Dependency

Install `fitsjs-ng` in your project:

::: code-group

```bash [pnpm]
pnpm add fitsjs-ng
```

```bash [npm]
npm install fitsjs-ng
```

```bash [yarn]
yarn add fitsjs-ng
```

:::

## Runtime Requirements

- Node.js `>= 18`
- Modern browsers with `fetch`, typed arrays, and ES modules

## Import Examples

### ESM (recommended)

```ts
import { FITS, XISF, SER, convertFitsToXisf } from 'fitsjs-ng'
```

### CommonJS

```js
const { FITS, XISF, SER, convertFitsToXisf } = require('fitsjs-ng')
```

## Minimal Smoke Test

```ts
import { FITS } from 'fitsjs-ng'

const fits = FITS.fromArrayBuffer(buffer)
console.log(fits.getHeader()?.get('BITPIX'))
```
