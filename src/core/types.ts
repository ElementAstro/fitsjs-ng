/**
 * FITS standard BITPIX values representing data types in image arrays.
 * Positive values are integer types, negative values are floating point.
 */
export type BitPix = 8 | 16 | 32 | 64 | -32 | -64

/**
 * Extended BITPIX values used in compressed images (ZBITPIX).
 */
export type ZBitPix = 8 | 16 | 32 | 64 | -32 | -64

/**
 * Possible value types stored in a FITS header card.
 */
export type CardValue = string | number | boolean | null

/**
 * A single header card entry with its positional index, value, and optional comment.
 */
export interface HeaderCard {
  index: number
  value: CardValue
  comment: string
}

/**
 * Types of FITS data units.
 */
export type DataUnitType = 'Image' | 'BinaryTable' | 'Table' | 'CompressedImage'

/**
 * FITS extension types as stored in the XTENSION keyword.
 */
export type ExtensionType = 'IMAGE' | 'BINTABLE' | 'TABLE'

/**
 * Compression algorithms supported by the FITS tiled image convention.
 */
export type CompressionType = 'GZIP_1' | 'RICE_1' | 'PLIO_1' | 'HCOMPRESS_1'

/**
 * Quantization methods for compressed images.
 */
export type QuantizationType = 'LINEAR_SCALING' | 'SUBTRACTIVE_DITHER_1' | 'SUBTRACTIVE_DITHER_2'

/**
 * Binary table format type codes (single character descriptors).
 */
export type BinaryTableTypeCode =
  | 'L' // Logical
  | 'B' // Unsigned byte
  | 'I' // 16-bit integer
  | 'J' // 32-bit integer
  | 'K' // 64-bit integer
  | 'A' // Character
  | 'E' // Single-precision float
  | 'D' // Double-precision float
  | 'C' // Single-precision complex
  | 'M' // Double-precision complex
  | 'X' // Bit

/**
 * ASCII table format type codes.
 */
export type AsciiTableTypeCode = 'A' | 'I' | 'F' | 'E' | 'D'

/**
 * Byte sizes for each binary table type code.
 */
export const BINARY_TYPE_BYTE_SIZES: Record<string, number> = {
  L: 1,
  B: 1,
  I: 2,
  J: 4,
  K: 8,
  A: 1,
  E: 4,
  D: 8,
  C: 8,
  M: 16,
}

/**
 * A binary table accessor function reads a value from a DataView at the given offset
 * and returns the value plus the new offset.
 */
export type BinaryAccessor = (view: DataView, offset: number) => [value: unknown, newOffset: number]

/**
 * An ASCII table accessor transforms a string value into the appropriate type.
 */
export type AsciiAccessor = (value: string) => CardValue

/**
 * Typed array constructors mapped by binary type codes.
 */
export const TYPED_ARRAY_CONSTRUCTORS: Record<string, TypedArrayConstructor> = {
  B: Uint8Array,
  I: Int16Array,
  J: Int32Array,
  K: BigInt64Array,
  E: Float32Array,
  D: Float64Array,
  1: Uint8Array,
  2: Int16Array,
  4: Int32Array,
}

export type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Int8ArrayConstructor
  | Uint16ArrayConstructor
  | Int16ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor

export type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array

/**
 * Warning callback type for non-fatal issues during parsing.
 */
export type WarningCallback = (message: string) => void

/**
 * Options for reading FITS data.
 */
export interface ReadOptions {
  /** Maximum number of header lines to parse (default: 600) */
  maxHeaderLines?: number
  /** Callback for non-fatal warnings during parsing (default: console.warn) */
  onWarning?: WarningCallback
}

/**
 * Options for fetching remote FITS files.
 */
export interface FetchOptions extends ReadOptions {
  /** Additional fetch options (headers, signal, etc.) */
  requestInit?: RequestInit
}

/**
 * Row data from a table, keyed by column name.
 */
export type TableRow = Record<string, unknown>

/**
 * Compression algorithm parameters (e.g., BLOCKSIZE, BYTEPIX).
 */
export type AlgorithmParameters = Record<string, number>
