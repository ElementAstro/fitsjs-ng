export type XISFSampleFormat =
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Float32'
  | 'Float64'
  | 'Complex32'
  | 'Complex64'

export type XISFColorSpace = 'Gray' | 'RGB' | 'CIELab'

export type XISFPixelStorage = 'Planar' | 'Normal'

export type XISFByteOrder = 'little' | 'big'

export type XISFDataBlockEncoding = 'base64' | 'hex'

export interface XISFChecksumSpec {
  algorithm:
    | 'sha1'
    | 'sha-1'
    | 'sha256'
    | 'sha-256'
    | 'sha512'
    | 'sha-512'
    | 'sha3-256'
    | 'sha3-512'
  digest: string
}

export interface XISFCompressionSpec {
  codec: 'zlib' | 'zlib+sh' | 'lz4' | 'lz4+sh' | 'lz4hc' | 'lz4hc+sh' | 'zstd' | 'zstd+sh'
  uncompressedSize: number
  itemSize?: number
  subblocks?: Array<{ compressedSize: number; uncompressedSize: number }>
}

export interface XISFAttachmentLocation {
  type: 'attachment'
  position: number
  size: number
}

export interface XISFInlineLocation {
  type: 'inline'
  encoding: XISFDataBlockEncoding
}

export interface XISFEmbeddedLocation {
  type: 'embedded'
  encoding?: XISFDataBlockEncoding
}

export interface XISFURLLocation {
  type: 'url'
  url: string
  indexId?: bigint
}

export interface XISFPathLocation {
  type: 'path'
  path: string
  indexId?: bigint
}

export type XISFLocation =
  | XISFAttachmentLocation
  | XISFInlineLocation
  | XISFEmbeddedLocation
  | XISFURLLocation
  | XISFPathLocation

export interface XISFDataBlock {
  location: XISFLocation
  byteOrder?: XISFByteOrder
  checksum?: XISFChecksumSpec
  compression?: XISFCompressionSpec
  inlineData?: string
  embeddedData?: string
}

export type XISFScalarValue = string | number | boolean | bigint

export interface XISFProperty {
  id: string
  type: string
  format?: string
  comment?: string
  value?:
    | XISFScalarValue
    | ArrayLike<number | bigint>
    | Array<XISFScalarValue>
    | Record<string, unknown>
  length?: number
  rows?: number
  columns?: number
  dataBlock?: XISFDataBlock
}

export interface XISFStructureField {
  id: string
  type: string
  format?: string
  header?: string
}

export interface XISFTableRow {
  cells: XISFProperty[]
}

export interface XISFTable {
  id: string
  caption?: string
  rows?: number
  columns?: number
  comment?: string
  structure: XISFStructureField[]
  dataRows: XISFTableRow[]
}

export interface XISFFITSKeyword {
  name: string
  value: string
  comment: string
}

export interface XISFRGBWorkingSpace {
  gamma: string
  x: [number, number, number]
  y: [number, number, number]
  Y: [number, number, number]
  name?: string
}

export interface XISFDisplayFunction {
  m: [number, number, number, number]
  s: [number, number, number, number]
  h: [number, number, number, number]
  l: [number, number, number, number]
  r: [number, number, number, number]
  name?: string
}

export interface XISFColorFilterArray {
  pattern: string
  width: number
  height: number
  name?: string
}

export interface XISFResolution {
  horizontal: number
  vertical: number
  unit?: 'inch' | 'cm'
}

export interface XISFSignatureResult {
  present: boolean
  verified: boolean
  algorithm?: string
  reason?: string
}

export interface XISFImage {
  id?: string
  uuid?: string
  geometry: number[]
  channelCount: number
  sampleFormat: XISFSampleFormat
  bounds?: [number, number]
  imageType?: string
  pixelStorage?: XISFPixelStorage
  colorSpace?: XISFColorSpace
  offset?: number
  orientation?: string
  dataBlock: XISFDataBlock
  data?: Uint8Array
  properties: XISFProperty[]
  tables: XISFTable[]
  fitsKeywords: XISFFITSKeyword[]
  iccProfile?: Uint8Array
  rgbWorkingSpace?: XISFRGBWorkingSpace
  displayFunction?: XISFDisplayFunction
  colorFilterArray?: XISFColorFilterArray
  resolution?: XISFResolution
  thumbnail?: XISFImage
}

export interface XISFUnit {
  metadata: XISFProperty[]
  images: XISFImage[]
  standaloneProperties: XISFProperty[]
  standaloneTables: XISFTable[]
  version: string
  signature: XISFSignatureResult
}

export interface XISFWarning {
  code: string
  message: string
}

export type XISFWarningCallback = (warning: XISFWarning) => void

export interface XISFCodecProvider {
  supports(codec: string): boolean
  compress(codec: string, input: Uint8Array, level?: number): Uint8Array
  decompress(codec: string, input: Uint8Array, uncompressedSize?: number): Uint8Array
}

export type XISFSignaturePolicy = 'require' | 'warn' | 'ignore'

export interface XISFReadOptions {
  strictValidation?: boolean
  verifyChecksums?: boolean
  verifySignatures?: boolean
  signaturePolicy?: XISFSignaturePolicy
  decodeImageData?: boolean
  baseUrl?: string
  headerDir?: string
  onWarning?: XISFWarningCallback
  codecProvider?: XISFCodecProvider
  resourceResolver?: XISFResourceResolver
}

export interface XISFWriteOptions {
  strictValidation?: boolean
  blockAlignment?: number
  maxInlineBlockSize?: number
  compression?: XISFCompressionSpec['codec'] | null
  compressionLevel?: number
  checksumAlgorithm?: XISFChecksumSpec['algorithm'] | null
  codecProvider?: XISFCodecProvider
}

export interface XISFResourceContext {
  baseUrl?: string
  headerDir?: string
}

export interface XISFResourceResolver {
  resolveURL(url: string): Promise<Uint8Array>
  resolvePath(path: string): Promise<Uint8Array>
}

export interface ConversionOptions {
  strictValidation?: boolean
  relaxed?: boolean
  includeXisfMetaExtension?: boolean
}
