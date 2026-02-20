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
- React Native with ES module support (`import`), typed arrays, and `fetch`

## Runtime Compatibility Matrix

| Capability                                          | Node.js | Browser                 | React Native            |
| --------------------------------------------------- | ------- | ----------------------- | ----------------------- |
| Root import (`import { FITS } from 'fitsjs-ng'`)    | ✅      | ✅                      | ✅                      |
| FITS/SER/XISF parse from `ArrayBuffer`/`Blob`/`URL` | ✅      | ✅                      | ✅                      |
| `NodeFSTarget` / local-path HiPS APIs               | ✅      | ❌                      | ❌                      |
| Default distributed XISF `path(...)` resolver       | ✅      | ❌                      | ❌                      |
| Detached XISF signature verification                | ✅      | ✅ (WebCrypto required) | ✅ (WebCrypto required) |

### React Native Guidance

- Prefer URL-based or in-memory (`ArrayBuffer`/`Blob`) inputs.
- Use custom `HiPSExportTarget` implementations for app storage integration.
- Do not rely on local path strings unless running in Node.js.
- If your runtime lacks `crypto.subtle`, disable signature verification explicitly (`verifySignatures: false`, `signaturePolicy: 'ignore'`).

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
