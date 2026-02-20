---
outline: deep
---

# SER API

## `SER`

Main entry point for reading SER v3 image sequences.

### Factory Methods

```ts
static fromArrayBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SER
static fromBlob(blob: Blob, options?: SERReadOptions): Promise<SER>
static fromURL(url: string, options?: SERReadOptions & { requestInit?: RequestInit }): Promise<SER>
static fromNodeBuffer(buffer: NodeBufferLike, options?: SERReadOptions): SER
```

### Instance Methods

```ts
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
```

---

## Parser / Writer

```ts
parseSERBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SERParsedFile
parseSERBlob(blob: Blob, options?: SERReadOptions): Promise<SERParsedFile>
writeSER(input: SERWriteInput, options?: SERWriteOptions): ArrayBuffer
```

---

## Conversion APIs

```ts
convertSerToFits(input: ArrayBuffer | Blob | SER, options?: SerToFitsOptions): Promise<ArrayBuffer>
convertFitsToSer(input: ArrayBuffer | Blob | FITS, options?: FitsToSerOptions): Promise<ArrayBuffer>

convertSerToXisf(
  input: ArrayBuffer | Blob | SER,
  options?: SerToXisfOptions,
): Promise<ArrayBuffer | { header: Uint8Array; blocks: Record<string, Uint8Array> }>

convertXisfToSer(input: ArrayBuffer | Blob | XISF, options?: XisfToSerOptions): Promise<ArrayBuffer>
```

### Conversion Option Highlights

```ts
interface SerToFitsOptions {
  layout?: 'cube' | 'multi-hdu' // default 'cube'
  includeTimestampExtension?: boolean // default true
}

interface FitsToSerOptions {
  sourceLayout?: 'auto' | 'cube' | 'multi-hdu' // default 'auto'
}

interface XisfToSerOptions {
  imageIndex?: number // default 0
}
```

---

## Core Types

```ts
type SERColorId = 0 | 8 | 9 | 10 | 11 | 16 | 17 | 18 | 19 | 100 | 101
type SEREndiannessPolicy = 'compat' | 'spec' | 'auto'
type SERByteOrder = 'little' | 'big'

interface SERReadOptions {
  strictValidation?: boolean
  endiannessPolicy?: SEREndiannessPolicy
  onWarning?: SERWarningCallback
}

interface SERWriteOptions {
  strictValidation?: boolean
  endiannessPolicy?: 'compat' | 'spec'
  onWarning?: SERWarningCallback
}
```

---

## Errors

```ts
class SERError extends FITSError {}
class SERParseError extends SERError {}
class SERValidationError extends SERError {}
class SERConversionError extends SERError {}
```
