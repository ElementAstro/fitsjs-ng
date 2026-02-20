import {
  SER_COLOR_CHANNELS,
  SER_FILE_ID,
  SER_HEADER_LENGTH,
  type SERWarning,
  type SERWriteInput,
  type SERWriteOptions,
} from './ser-types'
import { SERValidationError } from './ser-errors'

const NOOP_WARNING = (_warning: SERWarning): void => undefined

interface WriterDefaults {
  strictValidation: boolean
  endiannessPolicy: NonNullable<SERWriteOptions['endiannessPolicy']>
  onWarning: NonNullable<SERWriteOptions['onWarning']>
}

function withDefaults(options?: SERWriteOptions): WriterDefaults {
  return {
    strictValidation: options?.strictValidation ?? true,
    endiannessPolicy: options?.endiannessPolicy ?? 'compat',
    onWarning: options?.onWarning ?? NOOP_WARNING,
  }
}

function warn(options: WriterDefaults, code: string, message: string): void {
  options.onWarning({ code, message })
}

function encodeFixedAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  const encoder = new TextEncoder()
  const encoded = encoder.encode(value)
  for (let i = 0; i < length; i++) {
    target[offset + i] = encoded[i] ?? 0
  }
}

function asBigInt(value: bigint | number | undefined, fallback: bigint): bigint {
  if (value === undefined) return fallback
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value))
}

function encodeLittleEndianFlag(
  littleEndian: boolean,
  policy: WriterDefaults['endiannessPolicy'],
): number {
  if (policy === 'spec') {
    return littleEndian ? 1 : 0
  }
  return littleEndian ? 0 : 1
}

function normalizeFrameData(
  frame: Uint8Array,
  expectedLength: number,
  cfg: WriterDefaults,
  index: number,
): Uint8Array {
  if (frame.byteLength === expectedLength) {
    return frame
  }

  const message = `Frame ${index} byte length mismatch: expected ${expectedLength}, got ${frame.byteLength}`
  if (cfg.strictValidation) {
    throw new SERValidationError(message)
  }
  warn(cfg, 'frame_length_adjusted', `${message}; applying truncation/padding`)

  const out = new Uint8Array(expectedLength)
  out.set(frame.subarray(0, Math.min(frame.byteLength, expectedLength)))
  return out
}

export function writeSER(input: SERWriteInput, options?: SERWriteOptions): ArrayBuffer {
  const cfg = withDefaults(options)
  const header = input.header
  const frameCount = header.frameCount ?? input.frames.length

  if (!Number.isInteger(frameCount) || frameCount < 0) {
    throw new SERValidationError(`Invalid SER frame count: ${frameCount}`)
  }
  if (!Number.isInteger(header.width) || header.width <= 0) {
    throw new SERValidationError(`Invalid SER width: ${header.width}`)
  }
  if (!Number.isInteger(header.height) || header.height <= 0) {
    throw new SERValidationError(`Invalid SER height: ${header.height}`)
  }
  if (!Number.isInteger(header.pixelDepth) || header.pixelDepth < 1 || header.pixelDepth > 16) {
    throw new SERValidationError(`Invalid SER pixel depth: ${header.pixelDepth}`)
  }

  const channelCount = SER_COLOR_CHANNELS[header.colorId]
  if (!channelCount) {
    throw new SERValidationError(`Unsupported SER color ID: ${header.colorId}`)
  }

  if (input.frames.length !== frameCount) {
    const message = `SER frame array length mismatch: header frameCount=${frameCount}, frames=${input.frames.length}`
    if (cfg.strictValidation) {
      throw new SERValidationError(message)
    }
    warn(cfg, 'frame_count_mismatch', message)
  }

  const bytesPerSample = header.pixelDepth <= 8 ? 1 : 2
  const expectedFrameLength = header.width * header.height * channelCount * bytesPerSample
  if (!Number.isSafeInteger(expectedFrameLength) || expectedFrameLength <= 0) {
    throw new SERValidationError(`Invalid computed frame length: ${expectedFrameLength}`)
  }

  const normalizedFrames: Uint8Array[] = []
  for (let i = 0; i < frameCount; i++) {
    const frame = input.frames[i] ?? new Uint8Array(0)
    normalizedFrames.push(normalizeFrameData(frame, expectedFrameLength, cfg, i))
  }

  let timestamps: bigint[] | undefined
  if (input.timestamps) {
    if (input.timestamps.length !== frameCount) {
      const message = `Timestamp count mismatch: expected ${frameCount}, got ${input.timestamps.length}`
      if (cfg.strictValidation) {
        throw new SERValidationError(message)
      }
      warn(cfg, 'timestamp_count_mismatch', message)
    }
    timestamps = new Array(frameCount)
    for (let i = 0; i < frameCount; i++) {
      timestamps[i] = asBigInt(input.timestamps[i], 0n)
    }
  }

  const payloadSize = frameCount * expectedFrameLength
  const trailerSize = timestamps ? frameCount * 8 : 0
  const totalSize = SER_HEADER_LENGTH + payloadSize + trailerSize
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  encodeFixedAscii(out, 0, 14, SER_FILE_ID)
  view.setInt32(14, header.luId ?? 0, true)
  view.setInt32(18, header.colorId, true)

  const littleEndian = header.littleEndian ?? true
  view.setInt32(22, encodeLittleEndianFlag(littleEndian, cfg.endiannessPolicy), true)

  view.setInt32(26, header.width, true)
  view.setInt32(30, header.height, true)
  view.setInt32(34, header.pixelDepth, true)
  view.setInt32(38, frameCount, true)

  encodeFixedAscii(out, 42, 40, header.observer ?? '')
  encodeFixedAscii(out, 82, 40, header.instrument ?? '')
  encodeFixedAscii(out, 122, 40, header.telescope ?? '')

  view.setBigUint64(162, asBigInt(header.startTime, 0n), true)
  view.setBigUint64(170, asBigInt(header.startTimeUtc, 0n), true)

  let offset = SER_HEADER_LENGTH
  for (const frame of normalizedFrames) {
    out.set(frame, offset)
    offset += expectedFrameLength
  }

  if (timestamps) {
    for (let i = 0; i < timestamps.length; i++) {
      view.setBigUint64(offset + i * 8, timestamps[i]!, true)
    }
  }

  return out.buffer
}
