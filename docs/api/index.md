---
outline: deep
---

# API Reference

## FITS

Main entry point for reading FITS files.

### Factory Methods

```ts
// Synchronous — from ArrayBuffer
static fromArrayBuffer(buffer: ArrayBuffer, options?: ReadOptions): FITS

// Async — from Blob or File
static async fromBlob(blob: Blob, options?: ReadOptions): Promise<FITS>

// Async — from remote URL
static async fromURL(url: string, options?: FetchOptions): Promise<FITS>

// From Node.js Buffer
static fromNodeBuffer(buf: NodeBuffer, options?: ReadOptions): FITS
```

### Instance Methods

```ts
getHDU(index?: number): HDU | undefined
getHeader(index?: number): Header | undefined
getDataUnit(index?: number): DataUnit | undefined
```

### Example

```ts
import { FITS } from 'fitsjs-ng'

const fits = await FITS.fromURL('https://example.com/image.fits')
const header = fits.getHeader()
const image = fits.getDataUnit() as Image
const frame = await image.getFrame(0)
```

---

## Header

Parsed FITS header with keyword-value access.

### Methods

```ts
get(key: string): CardValue                          // Raw access (returns null if missing)
getNumber(key: string, fallback?: number): number     // Type-safe numeric access
getString(key: string, fallback?: string): string     // Type-safe string access
getBoolean(key: string, fallback?: boolean): boolean  // Type-safe boolean access
contains(key: string): boolean
set(key: string, value: CardValue, comment?: string): void
getDataType(): DataUnitType | null
getDataLength(): number
isPrimary(): boolean
isExtension(): boolean
hasDataUnit(): boolean
```

---

## Image

Reads FITS image data (BITPIX 8, 16, 32, -32, -64).

### Properties

```ts
readonly bitpix: number
readonly width: number
readonly height: number
readonly depth: number       // >1 for data cubes
readonly bzero: number
readonly bscale: number
readonly naxis: number[]
```

### Methods

```ts
async getFrame(index: number): Promise<TypedArray>
async getFrames(start: number, count: number): Promise<TypedArray[]>
getExtent(arr: TypedArray): [number, number]
getPixel(arr: TypedArray, x: number, y: number): number
isDataCube(): boolean
async *[Symbol.asyncIterator](): AsyncIterableIterator<TypedArray>  // iterate frames
```

---

## BinaryTable

Reads FITS binary table extensions (BINTABLE).

### Properties

```ts
readonly rows: number
readonly cols: number
readonly columns: string[] | null
```

### Methods

```ts
async getRows(row: number, count: number): Promise<TableRow[] | TypedArray>
async getColumn(name: string): Promise<unknown[]>
```

---

## Table

Reads FITS ASCII table extensions (TABLE). Same API as `BinaryTable`.

---

## CompressedImage

Reads Rice-compressed FITS images stored as binary tables. Extends `BinaryTable`.

### Additional Properties

```ts
readonly zcmptype: string
readonly zbitpix: number
readonly width: number
readonly height: number
```

---

## Types

```ts
type BitPix = 8 | 16 | 32 | -32 | -64
type CardValue = string | number | boolean | null
type DataUnitType = 'Image' | 'Table' | 'BinaryTable' | 'CompressedImage'
type TypedArray = Uint8Array | Int8Array | Int16Array | Int32Array | Float32Array | Float64Array | ...

interface ReadOptions {
  maxHeaderLines?: number
  onWarning?: WarningCallback
}

interface FetchOptions extends ReadOptions {
  requestInit?: RequestInit
}

type WarningCallback = (message: string) => void
type TableRow = Record<string, unknown>
```

---

## Error Classes

```ts
class FITSError extends Error {}
class HeaderError extends FITSError {}
class DataError extends FITSError {}
class DecompressionError extends FITSError {}
```

---

## Utility Functions

```ts
function parseBuffer(buffer: ArrayBuffer, options?: ReadOptions): HDU[]
function parseBlob(blob: Blob, options?: ReadOptions): Promise<HDU[]>
function getExtent(arr: TypedArray): [number, number]
function getPixel(arr: TypedArray, x: number, y: number, width: number): number
function riceDecompress(...): void
```
