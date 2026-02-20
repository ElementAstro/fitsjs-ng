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

// From Node.js Buffer-like data
static fromNodeBuffer(
  buf: { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
  options?: ReadOptions,
): FITS
```

### Instance Methods

```ts
getHDU(index?: number): HDU | undefined
getHeader(index?: number): Header | undefined
getDataUnit(index?: number): DataUnit | undefined
```

### Example

```ts
import { FITS, Image } from 'fitsjs-ng'

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

Reads FITS image data (BITPIX 8, 16, 32, 64, -32, -64).

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
async getFrameAsNumber(index?: number): Promise<Float64Array>
async getFrames(start: number, count: number): Promise<TypedArray[]>
getExtent(arr: TypedArray): [number | bigint, number | bigint]
getPixel(arr: TypedArray, x: number, y: number): number | bigint
isDataCube(): boolean
async *[Symbol.asyncIterator](): AsyncIterableIterator<TypedArray>  // iterate frames
```

`getFrame()` keeps `BITPIX=64` data lossless as bigint where possible. Use `getFrameAsNumber()` only for explicit lossy conversion.

---

## XISF Signature Verification

`XISF.fromArrayBuffer()` supports:

```ts
{
  verifySignatures?: boolean           // default true
  signaturePolicy?: 'require' | 'warn' | 'ignore' // default 'require'
}
```

- `require`: throw on signed-document verification failure
- `warn`: continue parse and report signature failure
- `ignore`: skip signature verification

For signed documents, checksum verification is forced for attachment/path/url blocks.

---

## SER

SER support includes reading, writing, and conversion:

```ts
class SER {
  static fromArrayBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SER
  static fromBlob(blob: Blob, options?: SERReadOptions): Promise<SER>
  static fromURL(
    url: string,
    options?: SERReadOptions & { requestInit?: RequestInit },
  ): Promise<SER>
  static fromNodeBuffer(buffer: NodeBufferLike, options?: SERReadOptions): SER

  getHeader(): SERHeader
  getFrameCount(): number
  getFrame(index: number, options?: { asRGB?: boolean }): SERFrameData
  getFrameRGB(index: number): Uint8Array | Uint16Array
  getFrames(startFrame: number, count: number, options?: { asRGB?: boolean }): SERFrameData[]
  getTimestamp(index: number): bigint | undefined
  getTimestampDate(index: number): Date | undefined
  getDurationTicks(): bigint | undefined
  getDurationSeconds(): number | undefined
  getEstimatedFPS(): number | undefined
  async *[Symbol.asyncIterator](): AsyncIterableIterator<SERFrameData>
}

function parseSERBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SERParsedFile
function parseSERBlob(blob: Blob, options?: SERReadOptions): Promise<SERParsedFile>
function writeSER(input: SERWriteInput, options?: SERWriteOptions): ArrayBuffer

// Conversion options:
// convertSerToFits(..., { layout?: 'cube' | 'multi-hdu' })
// convertFitsToSer(..., { sourceLayout?: 'auto' | 'cube' | 'multi-hdu' })
// convertXisfToSer(..., { imageIndex?: number })
```

For full SER API details, see [`/api/ser`](/api/ser).

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
type BitPix = 8 | 16 | 32 | 64 | -32 | -64
type CardValue = string | number | boolean | null
type DataUnitType = 'Image' | 'BinaryTable' | 'Table' | 'CompressedImage'
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
function getExtent(arr: TypedArray): [number | bigint, number | bigint]
function getPixel(arr: TypedArray, x: number, y: number, width: number): number | bigint
function riceDecompress(...): void
```

---

## HiPS APIs

HiPS-specific APIs are documented in [`/api/hips`](/api/hips), including:

- `HiPS`, `HiPSProperties`
- `convertFitsToHiPS`, `convertHiPSToFITS`
- `NodeFSTarget`, `BrowserZipTarget`, `BrowserOPFSTarget`
- `lintHiPS`
