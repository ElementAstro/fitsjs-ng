# fitsjs-ng

Modern TypeScript library for reading and writing [FITS](https://fits.gsfc.nasa.gov/), [SER](https://grischa-hahn.hier-im-netz.de/astro/ser/), and [XISF](https://pixinsight.com/xisf/) astronomical files. A complete rewrite of [astrojs/fitsjs](https://github.com/astrojs/fitsjs) with Promise-based APIs, full type safety, and Node.js/browser dual support.

## Features

- **FITS Image Reading** — BITPIX 8, 16, 32, 64, -32, -64 with BZERO/BSCALE scaling
- **FITS Image Writing** — build FITS HDUs and export complete FITS buffers
- **SER Read/Write** — full SER v3 parsing/writing, timestamps, Bayer/CMY + RGB/BGR support
- **XISF Read/Write** — monolithic (`.xisf`) and distributed (`.xish` + `.xisb`) workflows
- **XISF Signature Verification** — XML-DSig `SignedInfo`/digest/signature verification with policy control
- **XISF↔FITS Conversion** — strict conversion with metadata preservation
- **XISF↔HiPS Conversion** — direct conversion APIs via standards-preserving FITS bridge
- **SER↔FITS / SER↔XISF Conversion** — reversible metadata/time-stamp aware conversion pipelines
- **HiPS Image + HiPS3D** — read/write HiPS properties, tiles, Allsky, and lint checks
- **FITS↔HiPS Conversion** — build HiPS directories and export tile/map/cutout FITS
- **Data Cubes** — Frame-by-frame reading of 3D+ image data
- **ASCII Tables** — Fixed-width text table parsing (A/I/F/E/D format codes)
- **Binary Tables** — All standard types (L/B/I/J/K/A/E/D/C/M/X), bit arrays, heap access
- **Compressed Images** — Rice (RICE_1) decompression with subtractive dithering
- **Multiple HDUs** — Sequential parsing of all Header Data Units
- **Modern API** — Async/await, TypeScript types, ES modules, tree-shakeable
- **Universal** — Works in Node.js (18+), modern browsers, and React Native (runtime-safe root import)

## Installation

```bash
npm install fitsjs-ng
# or
pnpm add fitsjs-ng
```

## Runtime Compatibility Matrix

| Capability                                         | Node.js | Browser                      | React Native                 |
| -------------------------------------------------- | ------- | ---------------------------- | ---------------------------- |
| `import { ... } from 'fitsjs-ng'` root import      | ✅      | ✅                           | ✅                           |
| FITS/SER/XISF from `ArrayBuffer`/`Blob`/`URL`      | ✅      | ✅                           | ✅                           |
| XISF detached signature verification (default on)  | ✅      | ✅ (requires WebCrypto)      | ✅ (requires WebCrypto)      |
| `NodeFSTarget`                                     | ✅      | ❌ (runtime error)           | ❌ (runtime error)           |
| `HiPS.open('/local/path')`                         | ✅      | ❌ (runtime error)           | ❌ (runtime error)           |
| `lintHiPS('/local/path')`                          | ✅      | ❌ (runtime error report)    | ❌ (runtime error report)    |
| distributed XISF `path(...)` with default resolver | ✅      | ❌ (provide custom resolver) | ❌ (provide custom resolver) |

Node-only APIs fail with actionable runtime messages in non-Node environments instead of failing at bundle-import time.

## Quick Start

```ts
import {
  FITS,
  SER,
  XISF,
  XISFWriter,
  parseSERBuffer,
  parseSERBlob,
  convertFitsToXisf,
  convertXisfToFits,
  convertSerToFits,
  convertFitsToSer,
  convertSerToXisf,
  convertXisfToSer,
  convertXisfToHiPS,
  convertHiPSToXisf,
  NodeFSTarget,
  Image,
} from 'fitsjs-ng'
import fs from 'node:fs'

// FITS from ArrayBuffer / Blob / Node buffer-like / URL
const fits = FITS.fromArrayBuffer(
  await fs.promises
    .readFile('image.fits')
    .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
)
const fitsFromBlob = await FITS.fromBlob(new Blob([await fs.promises.readFile('image.fits')]))
const fitsFromNodeBuffer = FITS.fromNodeBuffer(await fs.promises.readFile('image.fits'))
const fitsFromUrl = await FITS.fromURL('https://example.com/image.fits')

// Access header + image
const header = fits.getHeader()
console.log(header?.get('BITPIX'))
const image = fits.getDataUnit() as Image
const pixels = await image.getFrame(0)
const [min, max] = image.getExtent(pixels)

// FITS <-> XISF
const xisfBytes = await convertFitsToXisf(
  await fs.promises
    .readFile('image.fits')
    .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
)
const xisf = await XISF.fromArrayBuffer(xisfBytes as ArrayBuffer)
const fitsBytes = await convertXisfToFits(xisf)

// SER parse + conversions
const serBytes = await fs.promises
  .readFile('capture.ser')
  .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const ser = SER.fromArrayBuffer(serBytes)
const parsedSer = parseSERBuffer(serBytes)
const parsedSerBlob = await parseSERBlob(new Blob([serBytes]))
const fitsFromSer = await convertSerToFits(serBytes, { layout: 'cube' })
const serFromFits = await convertFitsToSer(fitsFromSer, { sourceLayout: 'auto' })
const xisfFromSer = await convertSerToXisf(serBytes)
const serFromXisf = await convertXisfToSer(xisfFromSer as ArrayBuffer, { imageIndex: 0 })

// XISF <-> HiPS (offline/local target)
const hipsTarget = new NodeFSTarget('./demo/.out/readme-quickstart-hips')
await convertXisfToHiPS(xisfBytes as ArrayBuffer, {
  output: hipsTarget,
  title: 'XISF Survey',
  creatorDid: 'ivo://example/xisf',
  hipsOrder: 4,
  minOrder: 1,
  tileWidth: 128,
  formats: ['fits', 'png'],
})
const xisfCutout = await convertHiPSToXisf(hipsTarget, {
  cutout: { width: 512, height: 512, ra: 83.63, dec: 22.01, fov: 1.2 },
})

// XISF writer outputs
const monolithic = await XISFWriter.toMonolithic(xisf.unit, { compression: 'zlib' })
const distributed = await XISFWriter.toDistributed(xisf.unit, { compression: 'zlib' })
// distributed.header => .xish bytes, distributed.blocks['blocks.xisb'] => .xisb bytes
```

### HiPS Quick Start

```ts
import { NodeFSTarget, convertFitsToHiPS, convertHiPSToFITS, HiPS, lintHiPS } from 'fitsjs-ng'

const target = new NodeFSTarget('./out/my-hips')
await convertFitsToHiPS(fitsArrayBuffer, {
  output: target,
  title: 'My Survey',
  creatorDid: 'ivo://example/my-survey',
  hipsOrder: 6,
  tileWidth: 512,
  formats: ['fits', 'png'],
  interpolation: 'bilinear',
})

const hips = await HiPS.open('./out/my-hips')
const tile = await hips.readTile({ order: 6, ipix: 12345, format: 'fits' })

const cutoutFits = await convertHiPSToFITS('./out/my-hips', {
  cutout: { width: 1024, height: 1024, ra: 83.63, dec: 22.01, fov: 1.2 },
  backend: 'auto', // local first, fallback to hips2fits if hipsId is set
  hipsId: 'CDS/P/2MASS/K',
})

const lint = await lintHiPS('./out/my-hips')
console.log(lint.ok, lint.issues)
```

### React Native Notes

- Prefer `ArrayBuffer` / `Blob` / URL-based workflows.
- Use custom `HiPSExportTarget` implementations or browser-friendly targets (`BrowserZipTarget`) instead of `NodeFSTarget`.
- Avoid local filesystem path inputs (`HiPS.open('/path')`, `lintHiPS('/path')`) unless you provide your own storage abstraction.
- Detached XISF signature verification requires `crypto.subtle`; if unavailable, verification fails by default.

```ts
import { XISF } from 'fitsjs-ng'

// If your RN runtime does not provide WebCrypto, disable signature verification explicitly.
const xisf = await XISF.fromArrayBuffer(bytes, {
  verifySignatures: false,
  signaturePolicy: 'ignore',
})
```

## API Reference

### `FITS`

Static factory methods:

| Method                         | Description                         |
| ------------------------------ | ----------------------------------- |
| `FITS.fromArrayBuffer(buffer)` | Parse from `ArrayBuffer` (sync)     |
| `FITS.fromBlob(blob)`          | Parse from `Blob`/`File` (async)    |
| `FITS.fromURL(url)`            | Fetch and parse remote file (async) |
| `FITS.fromNodeBuffer(buffer)`  | Parse from Node.js `Buffer` (sync)  |

### `XISF`

Static factory methods:

| Method                         | Description                              |
| ------------------------------ | ---------------------------------------- |
| `XISF.fromArrayBuffer(buffer)` | Parse from `ArrayBuffer`                 |
| `XISF.fromBlob(blob)`          | Parse from `Blob`/`File`                 |
| `XISF.fromURL(url)`            | Fetch and parse remote `.xisf`/`.xish`   |
| `XISF.fromNodeBuffer(buffer)`  | Parse from Node.js `Buffer`-like payload |

### `SER`

Static factory methods:

| Method                        | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `SER.fromArrayBuffer(buffer)` | Parse SER from `ArrayBuffer`                        |
| `SER.fromBlob(blob)`          | Parse SER from `Blob`/`File`                        |
| `SER.fromURL(url)`            | Fetch and parse remote `.ser`                       |
| `SER.fromNodeBuffer(buffer)`  | Parse SER from Node.js `Buffer`-like payload        |
| `parseSERBuffer(buffer)`      | Parse SER buffer and return structured parse result |
| `parseSERBlob(blob)`          | Parse SER blob and return structured parse result   |
| `writeSER(input)`             | Serialize SER header + frames (+ optional trailer)  |

Instance helpers:

| Method                     | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `ser.getFrameCount()`      | Total frame count                              |
| `ser.getFrameRGB(i)`       | RGB helper decode for mono/Bayer/CMY/RGB/BGR   |
| `ser.getDurationTicks()`   | Duration from trailer timestamps (100ns ticks) |
| `ser.getDurationSeconds()` | Duration in seconds from trailer timestamps    |
| `ser.getEstimatedFPS()`    | Estimated FPS from timestamp spacing           |

### `XISFWriter`

| Method                       | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `XISFWriter.toMonolithic()`  | Serialize to monolithic `.xisf` bytes            |
| `XISFWriter.toDistributed()` | Serialize to distributed `.xish` + `.xisb` bytes |

### Conversion

| Method                              | Description                                        |
| ----------------------------------- | -------------------------------------------------- |
| `convertXisfToFits(input)`          | Convert XISF to FITS bytes                         |
| `convertFitsToXisf(input)`          | Convert FITS to XISF bytes (or distributed object) |
| `convertSerToFits(input)`           | Convert SER to FITS bytes                          |
| `convertFitsToSer(input)`           | Convert FITS to SER bytes                          |
| `convertSerToXisf(input)`           | Convert SER to XISF bytes                          |
| `convertXisfToSer(input)`           | Convert XISF to SER bytes                          |
| `convertFitsToHiPS(input, options)` | Convert FITS to HiPS directory                     |
| `convertHiPSToFITS(input, options)` | Export HiPS to FITS tile/map/cutout                |

SER conversion options:

- `convertSerToFits(input, { layout: 'cube' | 'multi-hdu' })` (default: `'cube'`)
- `convertFitsToSer(input, { sourceLayout: 'auto' | 'cube' | 'multi-hdu' })` (default: `'auto'`)
- `convertXisfToSer(input, { imageIndex })` for multi-image XISF units

### HiPS

| Method / Class                           | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `HiPS.open(source)`                      | Open HiPS from local path, URL, or storage target |
| `HiPS.getProperties()`                   | Load and parse `properties`                       |
| `HiPS.readTile({ order, ipix, format })` | Read/decode one tile                              |
| `NodeFSTarget`                           | Node filesystem output target                     |
| `BrowserZipTarget`                       | Browser ZIP output target                         |
| `BrowserOPFSTarget`                      | Browser OPFS output target                        |
| `HiPSProperties`                         | Parse/serialize/validate HiPS properties          |
| `lintHiPS(source)`                       | Validate metadata and structure                   |

Instance methods:

| Method                | Description                             |
| --------------------- | --------------------------------------- |
| `getHDU(index?)`      | Get an HDU by index, or first with data |
| `getHeader(index?)`   | Get a header by HDU index               |
| `getDataUnit(index?)` | Get a data unit by HDU index            |

### `Header`

| Method          | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `get(key)`      | Get keyword value (`null` if missing)                                         |
| `contains(key)` | Check if keyword exists                                                       |
| `keys()`        | List all keyword names                                                        |
| `hasDataUnit()` | Whether this header has associated data                                       |
| `getDataType()` | Returns `'Image'`, `'BinaryTable'`, `'Table'`, `'CompressedImage'`, or `null` |
| `getComments()` | Get all COMMENT card values                                                   |
| `getHistory()`  | Get all HISTORY card values                                                   |

### `Image`

| Method                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `getFrame(frame?)`         | Read a single frame (async)                               |
| `getFrameAsNumber(frame?)` | Read frame as `Float64Array` (explicitly lossy for int64) |
| `getFrames(start, count)`  | Read multiple frames (async)                              |
| `getExtent(pixels)`        | Compute `[min, max]` (`number`/`bigint`)                  |
| `getPixel(pixels, x, y)`   | Get pixel at (x, y) (`number`/`bigint`)                   |
| `isDataCube()`             | Whether NAXIS > 2                                         |

`BITPIX=64` reads use lossless `BigInt64Array` on the primary path when linear scaling is exact (`BSCALE=1`, safe-integer `BZERO`). Use `getFrameAsNumber()` only when you intentionally accept precision loss.

### XISF Signature Policy

`XISF.fromArrayBuffer()` accepts:

- `signaturePolicy: 'require' | 'warn' | 'ignore'` (default: `'require'`)
- `verifySignatures` (default: `true`)

Behavior:

- **`require`**: signed documents must verify; failures throw `XISFSignatureError`
- **`warn`**: signature failures are reported through warnings and `unit.signature`
- **`ignore`**: signature verification is skipped

When a detached signature is present and verification is enabled, checksum verification is forced for attachment/path/url data blocks.

### FITS↔XISF Preservation Scope

`convertFitsToXisf()` / `convertXisfToFits()` preserve:

- FITS keyword values **and comments** (`Header.getCards()` based mapping)
- non-image HDUs through `FITS:PreservedHDULayout` metadata (reversible card+payload container)

For `BITPIX=64`, canonical unsigned encoding (`BSCALE=1`, `BZERO=9223372036854775808`) is detected with strict raw-card parsing (no tolerance heuristics).

### `Table` (ASCII)

| Method                | Description                           |
| --------------------- | ------------------------------------- |
| `getRows(row, count)` | Read rows as `TableRow[]` (async)     |
| `getColumn(name)`     | Read all values from a column (async) |

### `BinaryTable`

Same interface as `Table`, supports types: `L` (logical), `B` (byte), `I` (int16), `J` (int32), `K` (int64), `A` (char), `E` (float32), `D` (float64), `C`/`M` (complex), `X` (bit array).

### `CompressedImage`

| Method                   | Description                         |
| ------------------------ | ----------------------------------- |
| `getFrame(frame?)`       | Decompress and read a frame (async) |
| `getExtent(pixels)`      | Compute `[min, max]` ignoring NaN   |
| `getPixel(pixels, x, y)` | Get pixel at (x, y)                 |

## Data Cube Example

```ts
const image = fits.getDataUnit() as Image

if (image.isDataCube()) {
  console.log(`Depth: ${image.depth} frames`)
  for (let i = 0; i < image.depth; i++) {
    const frame = await image.getFrame(i)
    console.log(`Frame ${i}: ${image.getExtent(frame)}`)
  }
}
```

## Multiple HDUs

```ts
const fits = FITS.fromArrayBuffer(buffer)

for (let i = 0; i < fits.hdus.length; i++) {
  const hdu = fits.hdus[i]
  const type = hdu.header.getDataType()
  console.log(`HDU ${i}: ${type ?? 'no data'}`)
}
```

## Project Structure

```
src/
├── index.ts              # Public exports
├── types.ts              # TypeScript interfaces & types
├── constants.ts          # FITS constants
├── errors.ts             # Custom error classes
├── utils.ts              # Endian swap, byte utilities
├── fits.ts               # Main FITS class
├── parser.ts             # FITS file parser
├── header.ts             # Header parsing
├── header-verify.ts      # Keyword validation
├── hdu.ts                # Header Data Unit
├── data-unit.ts          # Base data unit
├── image.ts              # Image data unit
├── image-utils.ts        # getExtent, getPixel
├── tabular.ts            # Abstract tabular base
├── table.ts              # ASCII table
├── binary-table.ts       # Binary table
├── compressed-image.ts   # Compressed image (Rice)
└── decompress.ts         # Decompression algorithms
```

## Development

```bash
pnpm install
pnpm test          # Run tests
pnpm build         # Build library
pnpm typecheck     # Type check
pnpm lint          # Lint
pnpm demo:all      # Run all Node demos in sequence
pnpm demo          # FITS/XISF CLI demo
pnpm demo:hips     # HiPS Node demo (FITS->HiPS->FITS)
pnpm demo:xisf     # XISF Node demo (FITS<->XISF, monolithic/distributed)
pnpm demo:ser      # SER Node demo (SER<->FITS<->XISF)
pnpm demo:web      # Serve web demos (open /demo/web/index.html, /demo/web/hips.html, /demo/web/xisf.html)
```

Node demo artifacts are written under `demo/.out/*`.

## Standards & Compatibility

- HiPS metadata and directory naming follow HiPS 1.0 conventions (`Norder*/Dir*/Npix*`, `Norder3/Allsky.*`, `properties`, `Moc.fits`).
- FITS writing follows FITS 4.0 card/block alignment rules (80-char cards, 2880-byte blocks).
- Output `properties` defaults to `hips_version=1.4` and also writes legacy compatibility fields (`coordsys`, `maxOrder`, `format`).
- XISF default codec provider supports `zlib`, `lz4`, and `lz4hc` for read/write and `zstd` for read; custom providers can extend encoding support.

## Remote Backend Behavior

- `backend: 'local'`: all conversion is performed locally.
- `backend: 'remote'`: cutout export uses CDS hips2fits endpoint directly.
- `backend: 'auto'`: try local cutout first, then fallback to hips2fits when `hipsId` is provided.

## Credits

Based on [astrojs/fitsjs](https://github.com/astrojs/fitsjs) by Amit Kapadia / Zooniverse.

## License

[MIT](LICENSE)
