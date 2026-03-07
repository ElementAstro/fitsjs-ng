import { SERParseError, SERValidationError } from './ser-errors'
import { parseSERBlob, parseSERBuffer, parseSERBytes } from './ser-parser'
import { fetchOkWithNetworkPolicy } from '../core/network'
import {
  SER_BAYER_OR_CMY_PATTERN,
  SER_TICKS_AT_UNIX_EPOCH,
  type SERByteOrder,
  type SERColorId,
  type SERFrameStorage,
  type SERFrameData,
  type SERFrameInfo,
  type SERParsedFile,
  type SERReadOptions,
  type SERSampleArray,
} from './ser-types'

interface SERFrameReadOptions {
  asRGB?: boolean
  frameStorage?: SERFrameStorage
}

const HOST_IS_LITTLE_ENDIAN = (() => {
  const probe = new Uint16Array([0x0102])
  return new Uint8Array(probe.buffer)[0] === 0x02
})()

function decodeFrameSamples(
  raw: Uint8Array,
  bytesPerSample: 1 | 2,
  byteOrder: SERByteOrder,
  frameStorage: SERFrameStorage,
): SERSampleArray {
  if (bytesPerSample === 1) {
    return raw
  }

  const little = byteOrder === 'little'
  const supportsFastPath = little === HOST_IS_LITTLE_ENDIAN && raw.byteOffset % 2 === 0
  if (supportsFastPath) {
    const fast = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
    return frameStorage === 'view' ? fast : fast.slice()
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const samples = new Uint16Array(raw.byteLength / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getUint16(i * 2, little)
  }
  return samples
}

function getCfaPattern(colorId: SERColorId): string | undefined {
  return SER_BAYER_OR_CMY_PATTERN[colorId]
}

function sampleAt(samples: SERSampleArray, x: number, y: number, width: number): number {
  return Number(samples[y * width + x] ?? 0)
}

function rgbChannelsForSymbol(symbol: string): [boolean, boolean, boolean] {
  switch (symbol) {
    case 'R':
      return [true, false, false]
    case 'G':
      return [false, true, false]
    case 'B':
      return [false, false, true]
    case 'C':
      return [false, true, true]
    case 'M':
      return [true, false, true]
    case 'Y':
      return [true, true, false]
    case 'W':
      return [true, true, true]
    default:
      return [false, false, false]
  }
}

function decodeCfaToRGB(
  samples: SERSampleArray,
  width: number,
  height: number,
  pattern: string,
  bytesPerSample: 1 | 2,
): SERSampleArray {
  const out =
    bytesPerSample === 1 ? new Uint8Array(width * height * 3) : new Uint16Array(width * height * 3)

  const symbolAt = (x: number, y: number): string => pattern[(y % 2) * 2 + (x % 2)] ?? 'R'

  const nearest = (x: number, y: number, channel: 0 | 1 | 2): number => {
    const maxRadius = 3
    for (let radius = 0; radius <= maxRadius; radius++) {
      const minX = Math.max(0, x - radius)
      const maxX = Math.min(width - 1, x + radius)
      const minY = Math.max(0, y - radius)
      const maxY = Math.min(height - 1, y + radius)

      for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
          const [hasR, hasG, hasB] = rgbChannelsForSymbol(symbolAt(xx, yy))
          const hasChannel = channel === 0 ? hasR : channel === 1 ? hasG : hasB
          if (hasChannel) {
            return sampleAt(samples, xx, yy, width)
          }
        }
      }
    }
    return sampleAt(samples, x, y, width)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      const symbol = symbolAt(x, y)
      const [hasR, hasG, hasB] = rgbChannelsForSymbol(symbol)
      out[idx] = hasR ? sampleAt(samples, x, y, width) : nearest(x, y, 0)
      out[idx + 1] = hasG ? sampleAt(samples, x, y, width) : nearest(x, y, 1)
      out[idx + 2] = hasB ? sampleAt(samples, x, y, width) : nearest(x, y, 2)
    }
  }

  return out
}

export class SER {
  readonly parsed: SERParsedFile
  private readonly frameStorage: SERFrameStorage

  private constructor(parsed: SERParsedFile, frameStorage: SERFrameStorage) {
    this.parsed = parsed
    this.frameStorage = frameStorage
  }

  static fromArrayBuffer(buffer: ArrayBuffer, options?: SERReadOptions): SER {
    const frameStorage = options?.frameStorage ?? 'copy'
    return new SER(parseSERBuffer(buffer, options), frameStorage)
  }

  static fromBytes(bytes: Uint8Array, options?: SERReadOptions): SER {
    const frameStorage = options?.frameStorage ?? 'view'
    return new SER(parseSERBytes(bytes, options), frameStorage)
  }

  static async fromBlob(blob: Blob, options?: SERReadOptions): Promise<SER> {
    const frameStorage = options?.frameStorage ?? 'copy'
    return new SER(await parseSERBlob(blob, options), frameStorage)
  }

  static async fromURL(url: string, options?: SERReadOptions): Promise<SER> {
    const response = await fetchOkWithNetworkPolicy(
      url,
      {
        requestInit: options?.requestInit,
        timeoutMs: options?.timeoutMs,
        retryCount: options?.retryCount,
        retryDelayMs: options?.retryDelayMs,
      },
      { method: 'GET' },
      'Failed to fetch SER file',
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    const frameStorage = options?.frameStorage ?? 'copy'
    return new SER(parseSERBytes(bytes, options), frameStorage)
  }

  static fromNodeBuffer(
    nodeBuffer: { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
    options?: SERReadOptions,
  ): SER {
    const frameStorage = options?.frameStorage ?? 'copy'
    if (frameStorage === 'view') {
      const bytes = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength)
      return SER.fromBytes(bytes, options)
    }

    const buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength,
    )
    return SER.fromArrayBuffer(buffer, { ...options, frameStorage })
  }

  getHeader() {
    return this.parsed.header
  }

  getFrameCount(): number {
    return this.parsed.header.frameCount
  }

  getFrameInfo(index: number): SERFrameInfo {
    const info = this.parsed.frameInfos[index]
    if (!info) {
      throw new SERValidationError(`Frame index out of range: ${index}`)
    }
    return info
  }

  getTimestamp(index: number): bigint | undefined {
    return this.getFrameInfo(index).timestamp
  }

  getTimestampDate(index: number): Date | undefined {
    const ts = this.getTimestamp(index)
    if (ts === undefined) return undefined
    const unixTicks = ts - SER_TICKS_AT_UNIX_EPOCH
    const ms = Number(unixTicks / 10000n)
    return new Date(ms)
  }

  getDurationTicks(): bigint | undefined {
    if (this.parsed.timestamps.length < 2) return undefined
    const first = this.parsed.timestamps[0]!
    const last = this.parsed.timestamps[this.parsed.timestamps.length - 1]!
    if (last < first) return undefined
    return last - first
  }

  getDurationSeconds(): number | undefined {
    const ticks = this.getDurationTicks()
    if (ticks === undefined) return undefined
    return Number(ticks) / 10_000_000
  }

  getEstimatedFPS(): number | undefined {
    const duration = this.getDurationSeconds()
    const frameCount = this.getFrameCount()
    if (!duration || duration <= 0 || frameCount < 2) return undefined
    return (frameCount - 1) / duration
  }

  private readFrameRawBytes(info: SERFrameInfo, storage: SERFrameStorage): Uint8Array {
    const bytes = this.parsed.bytes
    if (bytes) {
      const end = info.offset + info.byteLength
      return storage === 'view' ? bytes.subarray(info.offset, end) : bytes.slice(info.offset, end)
    }

    if (!this.parsed.buffer) {
      throw new SERParseError('SER source buffer is unavailable')
    }

    if (storage === 'view') {
      return new Uint8Array(this.parsed.buffer, info.offset, info.byteLength)
    }
    return new Uint8Array(this.parsed.buffer.slice(info.offset, info.offset + info.byteLength))
  }

  private samplesToRGB(samples: SERSampleArray, colorId: SERColorId): SERSampleArray {
    const { width, height, bytesPerSample } = this.parsed.header
    const framePixels = width * height

    if (colorId === 100 || colorId === 101) {
      const out =
        bytesPerSample === 1 ? new Uint8Array(framePixels * 3) : new Uint16Array(framePixels * 3)
      for (let i = 0; i < framePixels; i++) {
        const s = i * 3
        if (colorId === 100) {
          out[s] = samples[s] ?? 0
          out[s + 1] = samples[s + 1] ?? 0
          out[s + 2] = samples[s + 2] ?? 0
        } else {
          out[s] = samples[s + 2] ?? 0
          out[s + 1] = samples[s + 1] ?? 0
          out[s + 2] = samples[s] ?? 0
        }
      }
      return out
    }

    if (colorId === 0) {
      const out =
        bytesPerSample === 1 ? new Uint8Array(framePixels * 3) : new Uint16Array(framePixels * 3)
      for (let i = 0; i < framePixels; i++) {
        const value = Number(samples[i] ?? 0)
        const s = i * 3
        out[s] = value
        out[s + 1] = value
        out[s + 2] = value
      }
      return out
    }

    const pattern = getCfaPattern(colorId)
    if (!pattern) {
      throw new SERValidationError(`No RGB decode helper available for color ID ${colorId}`)
    }
    return decodeCfaToRGB(samples, width, height, pattern, bytesPerSample)
  }

  getFrame(index: number, options?: SERFrameReadOptions): SERFrameData {
    const info = this.getFrameInfo(index)
    const frameStorage = options?.frameStorage ?? this.frameStorage
    const raw = this.readFrameRawBytes(info, frameStorage)
    const samples = decodeFrameSamples(
      raw,
      this.parsed.header.bytesPerSample,
      this.parsed.header.byteOrder,
      frameStorage,
    )
    const frameSamples = options?.asRGB
      ? this.samplesToRGB(samples, this.parsed.header.colorId)
      : samples
    const channelCount = options?.asRGB ? 3 : this.parsed.header.channelCount

    return {
      info,
      raw,
      samples: frameSamples,
      width: this.parsed.header.width,
      height: this.parsed.header.height,
      channelCount,
      interleaved: channelCount > 1,
      colorId: this.parsed.header.colorId,
      pixelDepth: this.parsed.header.pixelDepth,
      byteOrder: this.parsed.header.byteOrder,
    }
  }

  getFrameRGB(index: number): SERSampleArray {
    const frame = this.getFrame(index)
    return this.samplesToRGB(frame.samples, this.parsed.header.colorId)
  }

  getFrames(startFrame: number, count: number, options?: SERFrameReadOptions): SERFrameData[] {
    const frames: SERFrameData[] = []
    for (let i = 0; i < count; i++) {
      frames.push(this.getFrame(startFrame + i, options))
    }
    return frames
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<SERFrameData> {
    for (let i = 0; i < this.parsed.header.frameCount; i++) {
      yield this.getFrame(i)
    }
  }
}
