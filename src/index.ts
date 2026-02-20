// Main entry point
export { FITS } from './fits'
export { XISF } from './xisf'
export { XISFWriter } from './xisf/xisf-writer'
export { convertXisfToFits, convertFitsToXisf } from './xisf/convert'
export { SER } from './ser'
export { parseSERBuffer, parseSERBlob } from './ser/ser-parser'
export { writeSER } from './ser/ser-writer'
export {
  convertSerToFits,
  convertFitsToSer,
  convertSerToXisf,
  convertXisfToSer,
} from './ser/ser-convert'

// Core classes
export { Header } from './fits/header'
export { HDU } from './fits/hdu'
export { DataUnit } from './fits/data-unit'

// Data unit types
export { Image } from './fits/image'
export { Table } from './fits/table'
export { BinaryTable } from './fits/binary-table'
export {
  CompressedImage,
  getCompressedImageDecoderProvider,
  setCompressedImageDecoderProvider,
} from './fits/compressed-image'

// Utilities
export { getExtent, getPixel } from './fits/image-utils'
export { riceDecompress, RiceSetup } from './fits/decompress'
export { parseBuffer, parseBlob } from './fits/parser'
export { writeFITS, createImageHDU, createImageBytesFromArray } from './fits/fits-writer'
export { HiPS } from './hips'
export { HiPSProperties } from './hips/hips-properties'
export { convertFitsToHiPS } from './hips/hips-build'
export { convertHiPSToFITS } from './hips/hips-export'
export { convertXisfToHiPS, convertHiPSToXisf } from './hips/hips-xisf-convert'
export { NodeFSTarget, BrowserZipTarget, BrowserOPFSTarget } from './hips/storage-target'
export { lintHiPS } from './validation/hips-lint'

// Types
export type {
  BitPix,
  ZBitPix,
  CardValue,
  HeaderCard,
  DataUnitType,
  ExtensionType,
  CompressionType,
  QuantizationType,
  BinaryTableTypeCode,
  AsciiTableTypeCode,
  BinaryAccessor,
  AsciiAccessor,
  TypedArray,
  TypedArrayConstructor,
  ReadOptions,
  FetchOptions,
  WarningCallback,
  TableRow,
  AlgorithmParameters,
} from './core/types'
export type {
  CompressedImageDecodeContext,
  CompressedImageDecoderProvider,
  CompressedImageOptions,
} from './fits/compressed-image'
export type {
  SERColorId,
  SERByteOrder,
  SEREndiannessPolicy,
  SERSampleArray,
  SERWarning,
  SERWarningCallback,
  SERReadOptions,
  SERHeader,
  SERFrameInfo,
  SERFrameData,
  SERParsedFile,
  SERWriteHeader,
  SERWriteInput,
  SERWriteOptions,
  SERConversionOptions,
  SerToFitsOptions,
  FitsToSerOptions,
  SerToXisfOptions,
  XisfToSerOptions,
} from './ser/ser-types'
export type {
  HiPSFrame,
  HiPSTileFormat,
  HiPSDataproductType,
  HiPSInterpolation,
  HiPSBackend,
  HiPSMapOrdering,
  HiPSTileMeta,
  HiPSWCSDefinition,
  ReprojectOptions,
  HiPSExportTarget,
  HiPSBuildOptions,
  HiPSCutoutOptions,
  HiPSExportTileOptions,
  HiPSExportMapOptions,
  HiPSReadTileResult,
  HiPSMapResult,
  HiPSRemoteOptions,
  ConvertFitsToHiPSOptions,
  ConvertHiPSToFITSOptions,
  ConvertXisfToHiPSOptions,
  ConvertHiPSToXisfOptions,
  HiPSInput,
} from './hips/hips-types'

export type {
  XISFSampleFormat,
  XISFColorSpace,
  XISFPixelStorage,
  XISFByteOrder,
  XISFDataBlockEncoding,
  XISFChecksumSpec,
  XISFCompressionSpec,
  XISFLocation,
  XISFDataBlock,
  XISFProperty,
  XISFStructureField,
  XISFTableRow,
  XISFTable,
  XISFFITSKeyword,
  XISFRGBWorkingSpace,
  XISFDisplayFunction,
  XISFColorFilterArray,
  XISFResolution,
  XISFSignatureResult,
  XISFImage,
  XISFUnit,
  XISFWarning,
  XISFWarningCallback,
  XISFCodecProvider,
  XISFSignaturePolicy,
  XISFReadOptions,
  XISFWriteOptions,
  XISFResourceContext,
  XISFResourceResolver,
  ConversionOptions,
} from './xisf/xisf-types'

// Constants
export {
  LINE_WIDTH,
  BLOCK_LENGTH,
  LINES_PER_BLOCK,
  DEFAULT_MAX_HEADER_LINES,
  NULL_VALUE,
  ZERO_VALUE,
  N_RANDOM,
  VERSION,
} from './core/constants'

// Errors
export { FITSError, HeaderError, DataError, DecompressionError } from './core/errors'
export { SERError, SERParseError, SERValidationError, SERConversionError } from './ser/ser-errors'
export {
  XISFError,
  XISFParseError,
  XISFValidationError,
  XISFResourceError,
  XISFCompressionError,
  XISFChecksumError,
  XISFSignatureError,
  XISFConversionError,
} from './xisf/xisf-errors'
