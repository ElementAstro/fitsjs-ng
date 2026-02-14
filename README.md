# fitsjs-ng

Modern TypeScript library for reading [FITS](https://fits.gsfc.nasa.gov/) (Flexible Image Transport System) astronomical files. A complete rewrite of [astrojs/fitsjs](https://github.com/astrojs/fitsjs) with Promise-based APIs, full type safety, and Node.js/browser dual support.

## Features

- **FITS Image Reading** — BITPIX 8, 16, 32, -32, -64 with BZERO/BSCALE scaling
- **Data Cubes** — Frame-by-frame reading of 3D+ image data
- **ASCII Tables** — Fixed-width text table parsing (A/I/F/E/D format codes)
- **Binary Tables** — All standard types (L/B/I/J/K/A/E/D/C/M/X), bit arrays, heap access
- **Compressed Images** — Rice (RICE_1) decompression with subtractive dithering
- **Multiple HDUs** — Sequential parsing of all Header Data Units
- **Modern API** — Async/await, TypeScript types, ES modules, tree-shakeable
- **Universal** — Works in Node.js (18+) and modern browsers

## Installation

```bash
npm install fitsjs-ng
# or
pnpm add fitsjs-ng
```

## Quick Start

```ts
import { FITS, Image } from 'fitsjs-ng'

// From a URL
const fits = await FITS.fromURL('https://example.com/image.fits')

// From an ArrayBuffer
const fits = FITS.fromArrayBuffer(buffer)

// From a File/Blob (browser)
const fits = await FITS.fromBlob(file)

// From a Node.js Buffer
const fits = FITS.fromNodeBuffer(fs.readFileSync('image.fits'))

// Access the primary header
const header = fits.getHeader()
console.log(header.get('BITPIX')) // e.g. -32
console.log(header.get('NAXIS1')) // e.g. 1024

// Read image pixels
const image = fits.getDataUnit() as Image
const pixels = await image.getFrame(0)
const [min, max] = image.getExtent(pixels)
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

| Method                    | Description                       |
| ------------------------- | --------------------------------- |
| `getFrame(frame?)`        | Read a single frame (async)       |
| `getFrames(start, count)` | Read multiple frames (async)      |
| `getExtent(pixels)`       | Compute `[min, max]` ignoring NaN |
| `getPixel(pixels, x, y)`  | Get pixel at (x, y)               |
| `isDataCube()`            | Whether NAXIS > 2                 |

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
```

## Credits

Based on [astrojs/fitsjs](https://github.com/astrojs/fitsjs) by Amit Kapadia / Zooniverse.

## License

[MIT](LICENSE)
