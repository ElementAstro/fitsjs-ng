import type { XISFWriteOptions } from './xisf-types'

export type SERColorId = 0 | 8 | 9 | 10 | 11 | 16 | 17 | 18 | 19 | 100 | 101

export type SERByteOrder = 'little' | 'big'

export type SEREndiannessPolicy = 'compat' | 'spec' | 'auto'

export type SERSampleArray = Uint8Array | Uint16Array

export interface SERWarning {
  code: string
  message: string
}

export type SERWarningCallback = (warning: SERWarning) => void

export interface SERReadOptions {
  strictValidation?: boolean
  endiannessPolicy?: SEREndiannessPolicy
  onWarning?: SERWarningCallback
}

export interface SERHeader {
  fileId: string
  luId: number
  colorId: SERColorId
  littleEndianFlag: number
  byteOrder: SERByteOrder
  width: number
  height: number
  pixelDepth: number
  frameCount: number
  observer: string
  instrument: string
  telescope: string
  startTime: bigint
  startTimeUtc: bigint
  channelCount: number
  bytesPerSample: 1 | 2
  frameByteLength: number
}

export interface SERFrameInfo {
  index: number
  offset: number
  byteLength: number
  timestamp?: bigint
}

export interface SERFrameData {
  info: SERFrameInfo
  raw: Uint8Array
  samples: SERSampleArray
  width: number
  height: number
  channelCount: number
  interleaved: boolean
  colorId: SERColorId
  pixelDepth: number
  byteOrder: SERByteOrder
}

export interface SERParsedFile {
  header: SERHeader
  frameInfos: SERFrameInfo[]
  timestamps: bigint[]
  timestampsPresent: boolean
  buffer?: ArrayBuffer
  blob?: Blob
}

export interface SERWriteHeader {
  luId?: number
  colorId: SERColorId
  width: number
  height: number
  pixelDepth: number
  frameCount?: number
  observer?: string
  instrument?: string
  telescope?: string
  startTime?: bigint | number
  startTimeUtc?: bigint | number
  littleEndian?: boolean
}

export interface SERWriteInput {
  header: SERWriteHeader
  frames: Uint8Array[]
  timestamps?: Array<bigint | number>
}

export interface SERWriteOptions {
  strictValidation?: boolean
  endiannessPolicy?: Exclude<SEREndiannessPolicy, 'auto'>
  onWarning?: SERWarningCallback
}

export interface SERConversionOptions {
  strictValidation?: boolean
  relaxed?: boolean
  endiannessPolicy?: SEREndiannessPolicy
  onWarning?: SERWarningCallback
}

export interface SerToFitsOptions extends SERConversionOptions {
  includeTimestampExtension?: boolean
  layout?: 'cube' | 'multi-hdu'
}

export interface FitsToSerOptions extends SERConversionOptions {
  sourceLayout?: 'auto' | 'cube' | 'multi-hdu'
}

export interface SerToXisfOptions extends SERConversionOptions {
  distributed?: boolean
  writeOptions?: XISFWriteOptions
}

export interface XisfToSerOptions extends SERConversionOptions {
  imageIndex?: number
}

export const SER_HEADER_LENGTH = 178
export const SER_FILE_ID = 'LUCAM-RECORDER'
export const SER_SUPPORTED_COLOR_IDS: SERColorId[] = [0, 8, 9, 10, 11, 16, 17, 18, 19, 100, 101]

export const SER_COLOR_CHANNELS: Record<SERColorId, 1 | 3> = {
  0: 1,
  8: 1,
  9: 1,
  10: 1,
  11: 1,
  16: 1,
  17: 1,
  18: 1,
  19: 1,
  100: 3,
  101: 3,
}

export const SER_BAYER_OR_CMY_PATTERN: Partial<Record<SERColorId, string>> = {
  8: 'RGGB',
  9: 'GRBG',
  10: 'GBRG',
  11: 'BGGR',
  16: 'CYYM',
  17: 'YCMY',
  18: 'YMCY',
  19: 'MYYC',
}

export const SER_TICKS_AT_UNIX_EPOCH = 621355968000000000n
