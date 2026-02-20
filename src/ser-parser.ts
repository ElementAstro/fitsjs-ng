import {
  SER_COLOR_CHANNELS,
  SER_FILE_ID,
  SER_HEADER_LENGTH,
  SER_SUPPORTED_COLOR_IDS,
  type SERByteOrder,
  type SERColorId,
  type SERFrameInfo,
  type SERParsedFile,
  type SERReadOptions,
  type SERWarning,
} from './ser-types'
import { SERParseError, SERValidationError } from './ser-errors'

const NOOP_WARNING = (_warning: SERWarning): void => undefined

interface ParserDefaults {
  strictValidation: boolean
  endiannessPolicy: NonNullable<SERReadOptions['endiannessPolicy']>
  onWarning: NonNullable<SERReadOptions['onWarning']>
}

function withDefaults(options?: SERReadOptions): ParserDefaults {
  return {
    strictValidation: options?.strictValidation ?? true,
    endiannessPolicy: options?.endiannessPolicy ?? 'compat',
    onWarning: options?.onWarning ?? NOOP_WARNING,
  }
}

function warn(options: ParserDefaults, code: string, message: string): void {
  options.onWarning({ code, message })
}

function readFixedAscii(bytes: Uint8Array): string {
  let end = bytes.length
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i
      break
    }
  }
  return new TextDecoder('ascii').decode(bytes.slice(0, end)).trim()
}

function isSupportedColorId(value: number): value is SERColorId {
  return SER_SUPPORTED_COLOR_IDS.includes(value as SERColorId)
}

function deriveByteOrderFromFlag(
  littleEndianFlag: number,
  policy: ParserDefaults['endiannessPolicy'],
  frameBytes: Uint8Array | null,
): SERByteOrder {
  if (policy === 'spec') {
    return littleEndianFlag !== 0 ? 'little' : 'big'
  }

  if (policy === 'compat') {
    return littleEndianFlag === 0 ? 'little' : 'big'
  }

  // policy === 'auto'
  const compat = littleEndianFlag === 0 ? 'little' : 'big'
  const spec = littleEndianFlag !== 0 ? 'little' : 'big'
  if (!frameBytes || frameBytes.byteLength < 4) {
    return compat
  }

  const score = (endian: SERByteOrder): number => {
    const view = new DataView(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength)
    const little = endian === 'little'
    const sampleCount = Math.min(4096, Math.floor(frameBytes.byteLength / 2))
    if (sampleCount <= 0) return 0

    let multiplesOf256 = 0
    let prev = view.getUint16(0, little)
    let smoothness = 0
    const seenLowBytes = new Set<number>()

    for (let i = 0; i < sampleCount; i++) {
      const value = view.getUint16(i * 2, little)
      if (value % 256 === 0) multiplesOf256++
      seenLowBytes.add(value & 0xff)
      smoothness += Math.abs(value - prev)
      prev = value
    }

    const uniqueness = seenLowBytes.size / 256
    const nonMultipleRatio = 1 - multiplesOf256 / sampleCount
    const smoothRatio = 1 / (1 + smoothness / sampleCount)
    return nonMultipleRatio * 0.5 + uniqueness * 0.4 + smoothRatio * 0.1
  }

  const compatScore = score(compat)
  const specScore = score(spec)
  return compatScore >= specScore ? compat : spec
}

function resolveFrameCountRelaxed(
  declaredFrameCount: number,
  availablePayloadBytes: number,
  frameByteLength: number,
): number {
  if (frameByteLength <= 0) return 0
  if (declaredFrameCount <= 0) return 0

  const byFrameOnly = Math.floor(availablePayloadBytes / frameByteLength)
  const byFrameAndTs = Math.floor(availablePayloadBytes / (frameByteLength + 8))
  return Math.max(0, Math.min(declaredFrameCount, Math.max(byFrameAndTs, 1), byFrameOnly))
}

function parseFromArrayBuffer(
  buffer: ArrayBuffer,
  options?: SERReadOptions,
  sourceBlob?: Blob,
): SERParsedFile {
  const cfg = withDefaults(options)
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength < SER_HEADER_LENGTH) {
    throw new SERParseError(
      `SER buffer is too short: expected at least ${SER_HEADER_LENGTH} bytes, got ${bytes.byteLength}`,
    )
  }

  const view = new DataView(buffer)
  const fileId = readFixedAscii(bytes.slice(0, 14))
  if (fileId !== SER_FILE_ID) {
    throw new SERParseError(`Invalid SER FileID: expected "${SER_FILE_ID}", got "${fileId}"`)
  }

  const luId = view.getInt32(14, true)
  const colorIdRaw = view.getInt32(18, true)
  const littleEndianFlag = view.getInt32(22, true)
  const width = view.getInt32(26, true)
  const height = view.getInt32(30, true)
  const pixelDepth = view.getInt32(34, true)
  const declaredFrameCount = view.getInt32(38, true)
  const observer = readFixedAscii(bytes.slice(42, 82))
  const instrument = readFixedAscii(bytes.slice(82, 122))
  const telescope = readFixedAscii(bytes.slice(122, 162))
  const startTime = view.getBigUint64(162, true)
  const startTimeUtc = view.getBigUint64(170, true)

  if (!Number.isInteger(width) || width <= 0) {
    throw new SERValidationError(`Invalid SER width: ${width}`)
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new SERValidationError(`Invalid SER height: ${height}`)
  }
  if (!Number.isInteger(pixelDepth) || pixelDepth < 1 || pixelDepth > 16) {
    throw new SERValidationError(`Invalid SER pixel depth: ${pixelDepth}`)
  }
  if (!Number.isInteger(declaredFrameCount) || declaredFrameCount < 0) {
    throw new SERValidationError(`Invalid SER frame count: ${declaredFrameCount}`)
  }

  if (!isSupportedColorId(colorIdRaw)) {
    const message = `Unsupported SER color ID: ${colorIdRaw}`
    if (cfg.strictValidation) {
      throw new SERValidationError(message)
    }
    warn(cfg, 'unsupported_color_id', `${message}; falling back to monochrome (0)`)
  }

  const colorId = (isSupportedColorId(colorIdRaw) ? colorIdRaw : 0) as SERColorId
  const channelCount = SER_COLOR_CHANNELS[colorId]
  const bytesPerSample = (pixelDepth <= 8 ? 1 : 2) as 1 | 2
  const frameByteLength = width * height * channelCount * bytesPerSample

  if (!Number.isSafeInteger(frameByteLength) || frameByteLength <= 0) {
    throw new SERValidationError(`Invalid SER frame byte length: ${frameByteLength}`)
  }

  const availablePayloadBytes = bytes.byteLength - SER_HEADER_LENGTH
  let frameCount = declaredFrameCount

  if (frameCount * frameByteLength > availablePayloadBytes) {
    const message = `SER frame count exceeds payload capacity (declared=${frameCount}, frameBytes=${frameByteLength}, payload=${availablePayloadBytes})`
    if (cfg.strictValidation) {
      throw new SERValidationError(message)
    }
    const fixedFrameCount = resolveFrameCountRelaxed(
      frameCount,
      availablePayloadBytes,
      frameByteLength,
    )
    warn(cfg, 'frame_count_adjusted', `${message}; adjusted to ${fixedFrameCount}`)
    frameCount = fixedFrameCount
  }

  if (frameCount === 0) {
    warn(cfg, 'empty_sequence', 'SER sequence has zero frames')
  }

  const firstFrameBytes =
    frameCount > 0
      ? bytes.slice(SER_HEADER_LENGTH, SER_HEADER_LENGTH + Math.min(frameByteLength, 8192))
      : null
  const byteOrder = deriveByteOrderFromFlag(littleEndianFlag, cfg.endiannessPolicy, firstFrameBytes)

  const dataPayloadLength = frameCount * frameByteLength
  const trailerStart = SER_HEADER_LENGTH + dataPayloadLength
  const trailerLength = bytes.byteLength - trailerStart

  let timestampsPresent = false
  const timestamps: bigint[] = []
  if (frameCount > 0 && trailerLength >= frameCount * 8) {
    timestampsPresent = true
    const tsView = new DataView(buffer, trailerStart, frameCount * 8)
    for (let i = 0; i < frameCount; i++) {
      timestamps.push(tsView.getBigUint64(i * 8, true))
    }

    let ordered = true
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i]! < timestamps[i - 1]!) {
        ordered = false
        break
      }
    }
    if (!ordered) {
      warn(cfg, 'timestamps_not_ordered', 'SER frame timestamps are not in ascending order')
    }

    if (trailerLength !== frameCount * 8) {
      const message = `SER trailer contains extra bytes (${trailerLength - frameCount * 8}) beyond timestamps`
      if (cfg.strictValidation) {
        throw new SERValidationError(message)
      }
      warn(cfg, 'extra_trailer_bytes', message)
    }
  } else if (trailerLength > 0) {
    const message = `SER trailer has ${trailerLength} bytes but expected 0 or ${frameCount * 8}`
    if (cfg.strictValidation) {
      throw new SERValidationError(message)
    }
    warn(cfg, 'truncated_timestamps', message)
  }

  const frameInfos: SERFrameInfo[] = []
  for (let i = 0; i < frameCount; i++) {
    frameInfos.push({
      index: i,
      offset: SER_HEADER_LENGTH + i * frameByteLength,
      byteLength: frameByteLength,
      timestamp: timestamps[i],
    })
  }

  return {
    header: {
      fileId,
      luId,
      colorId,
      littleEndianFlag,
      byteOrder,
      width,
      height,
      pixelDepth,
      frameCount,
      observer,
      instrument,
      telescope,
      startTime,
      startTimeUtc,
      channelCount,
      bytesPerSample,
      frameByteLength,
    },
    frameInfos,
    timestamps,
    timestampsPresent,
    buffer,
    blob: sourceBlob,
  }
}

export function parseSERBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SERParsedFile {
  return parseFromArrayBuffer(buffer, options)
}

export async function parseSERBlob(blob: Blob, options?: SERReadOptions): Promise<SERParsedFile> {
  const buffer = await blob.arrayBuffer()
  return parseFromArrayBuffer(buffer, options, blob)
}
