import { DataUnit } from './data-unit'
import { getExtent, getPixel } from './image-utils'
import type { Header } from './header'
import type { BlobSource, TypedArray } from '../core/types'

interface FrameOffset {
  begin: number
  buffers?: ArrayBuffer[]
}

interface ImageOptions {
  frameCacheMaxFrames?: number
}

type BlobFrameCacheMode = 'legacy' | 'disabled' | 'lru'

const IS_LITTLE_ENDIAN = (() => {
  const u16 = new Uint16Array([0x00ff])
  return new Uint8Array(u16.buffer)[0] === 0xff
})()

function swap16(value: number): number {
  return ((value & 0xff) << 8) | (value >>> 8)
}

function swap32(value: number): number {
  return (
    ((value & 0xff) << 24) |
    ((value & 0xff00) << 8) |
    ((value >>> 8) & 0xff00) |
    ((value >>> 24) & 0xff)
  )
}

const FLOAT32_SCRATCH = new ArrayBuffer(4)
const FLOAT32_SCRATCH_U32 = new Uint32Array(FLOAT32_SCRATCH)
const FLOAT32_SCRATCH_F32 = new Float32Array(FLOAT32_SCRATCH)

/**
 * Represents a standard FITS image stored in the data unit of a FITS file.
 * Supports BITPIX values: 8, 16, 32, 64, -32, -64
 * Supports data cubes (NAXIS > 2) with frame-by-frame reading.
 */
export class Image extends DataUnit {
  readonly bitpix: number
  readonly naxis: number[]
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly bzero: number
  readonly bscale: number
  readonly bytes: number
  readonly length: number
  readonly frameLength: number
  readonly frameOffsets: FrameOffset[]
  private readonly blobFrameCacheMode: BlobFrameCacheMode
  private readonly blobFrameCacheMaxFrames: number
  private readonly blobFrameCache = new Map<number, ArrayBuffer>()
  private readonly pendingBlobFrameReads = new Map<number, Promise<ArrayBuffer>>()

  constructor(
    header: Header,
    data: ArrayBuffer | BlobSource | ArrayBufferView,
    options?: ImageOptions,
  ) {
    super(data)

    if (options?.frameCacheMaxFrames === undefined) {
      this.blobFrameCacheMode = 'legacy'
      this.blobFrameCacheMaxFrames = 0
    } else {
      if (!Number.isInteger(options.frameCacheMaxFrames) || options.frameCacheMaxFrames < 0) {
        throw new Error('imageFrameCacheMaxFrames must be a non-negative integer')
      }
      this.blobFrameCacheMode = options.frameCacheMaxFrames === 0 ? 'disabled' : 'lru'
      this.blobFrameCacheMaxFrames = options.frameCacheMaxFrames
    }

    const naxisCount = header.getNumber('NAXIS')
    this.bitpix = header.getNumber('BITPIX')

    this.naxis = []
    for (let i = 1; i <= naxisCount; i++) {
      this.naxis.push(header.getNumber(`NAXIS${i}`))
    }

    this.width = header.getNumber('NAXIS1')
    this.height = header.getNumber('NAXIS2', 1)
    this.depth = header.getNumber('NAXIS3', 1)
    this.bzero = header.getNumber('BZERO')
    this.bscale = header.getNumber('BSCALE', 1)
    this.bytes = Math.abs(this.bitpix) / 8
    this.length = (this.naxis.reduce((a, b) => a * b, 1) * Math.abs(this.bitpix)) / 8

    this.frameOffsets = []
    this.frameLength = this.bytes * this.width * this.height

    for (let i = 0; i < this.depth; i++) {
      const begin = i * this.frameLength
      this.frameOffsets.push({ begin })
    }
  }

  private getFrameInfo(frame: number): FrameOffset {
    const frameInfo = this.frameOffsets[frame]
    if (!frameInfo) {
      throw new Error(`Frame index out of range: ${frame}`)
    }
    return frameInfo
  }

  private getCachedBlobFrameBuffer(frame: number): ArrayBuffer | undefined {
    const frameInfo = this.getFrameInfo(frame)
    if (this.blobFrameCacheMode === 'legacy') {
      return frameInfo.buffers?.[0]
    }
    if (this.blobFrameCacheMode === 'lru') {
      const cached = this.blobFrameCache.get(frame)
      if (cached) {
        this.blobFrameCache.delete(frame)
        this.blobFrameCache.set(frame, cached)
      }
      return cached
    }
    return undefined
  }

  private rememberBlobFrameBuffer(frame: number, buffer: ArrayBuffer): void {
    const frameInfo = this.getFrameInfo(frame)

    if (this.blobFrameCacheMode === 'legacy') {
      frameInfo.buffers = [buffer]
      return
    }

    if (this.blobFrameCacheMode === 'disabled') {
      frameInfo.buffers = undefined
      return
    }

    if (this.blobFrameCache.has(frame)) {
      this.blobFrameCache.delete(frame)
    }
    this.blobFrameCache.set(frame, buffer)
    frameInfo.buffers = [buffer]

    while (this.blobFrameCache.size > this.blobFrameCacheMaxFrames) {
      const oldestFrame = this.blobFrameCache.keys().next().value as number | undefined
      if (oldestFrame === undefined) break
      this.blobFrameCache.delete(oldestFrame)
      const oldestInfo = this.frameOffsets[oldestFrame]
      if (oldestInfo) {
        oldestInfo.buffers = undefined
      }
    }
  }

  private async readBlobFrameBuffer(frame: number): Promise<ArrayBuffer> {
    const cached = this.getCachedBlobFrameBuffer(frame)
    if (cached) {
      return cached
    }

    const pending = this.pendingBlobFrameReads.get(frame)
    if (pending) {
      return pending
    }

    if (!this.blob) {
      throw new Error('No data source available for this image frame')
    }

    const frameInfo = this.getFrameInfo(frame)
    const promise = this.blob
      .slice(frameInfo.begin, frameInfo.begin + this.frameLength)
      .arrayBuffer()
      .then((buffer) => {
        this.rememberBlobFrameBuffer(frame, buffer)
        return buffer
      })
      .finally(() => {
        this.pendingBlobFrameReads.delete(frame)
      })

    this.pendingBlobFrameReads.set(frame, promise)
    return promise
  }

  /**
   * Convert raw buffer bytes into pixel values with endian handling and BZERO/BSCALE.
   */
  static computeFrame(
    buffer: ArrayBuffer,
    bitpix: number,
    bzero: number,
    bscale: number,
  ): TypedArray {
    return Image.computeFrameFromRange(buffer, 0, buffer.byteLength, bitpix, bzero, bscale)
  }

  private static computeFrameFromRange(
    buffer: ArrayBuffer,
    byteOffset: number,
    byteLength: number,
    bitpix: number,
    bzero: number,
    bscale: number,
  ): TypedArray {
    const bytes = Math.abs(bitpix) / 8
    const nPixels = byteLength / bytes
    const identity = bzero === 0 && bscale === 1
    const needFloat = !(Number.isInteger(bzero) && Number.isInteger(bscale))
    const aligned = byteOffset % bytes === 0

    if (bitpix === 8) {
      if (identity) return new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength))
      const result = needFloat ? new Float32Array(nPixels) : new Int32Array(nPixels)
      const input = new Uint8Array(buffer, byteOffset, byteLength)
      for (let i = 0; i < nPixels; i++) {
        result[i] = bzero + bscale * input[i]!
      }
      return result
    }

    if (bitpix === 16) {
      const result = identity
        ? new Int16Array(nPixels)
        : needFloat
          ? new Float32Array(nPixels)
          : new Int32Array(nPixels)

      if (identity) {
        if (aligned && IS_LITTLE_ENDIAN) {
          const input = new Uint16Array(buffer, byteOffset, nPixels)
          for (let i = 0; i < nPixels; i++) {
            const swapped = swap16(input[i]!)
            result[i] = (swapped << 16) >> 16
          }
          return result as Int16Array
        }
        if (aligned && !IS_LITTLE_ENDIAN) {
          const input = new Int16Array(buffer, byteOffset, nPixels)
          ;(result as Int16Array).set(input)
          return result as Int16Array
        }
        const view = new DataView(buffer, byteOffset, byteLength)
        for (let i = 0; i < nPixels; i++) (result as Int16Array)[i] = view.getInt16(i * 2, false)
        return result as Int16Array
      }

      if (aligned && IS_LITTLE_ENDIAN) {
        const input = new Uint16Array(buffer, byteOffset, nPixels)
        for (let i = 0; i < nPixels; i++) {
          const swapped = swap16(input[i]!)
          const raw = (swapped << 16) >> 16
          result[i] = bzero + bscale * raw
        }
        return result
      }
      if (aligned && !IS_LITTLE_ENDIAN) {
        const input = new Int16Array(buffer, byteOffset, nPixels)
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * input[i]!
        }
        return result
      }
      const view = new DataView(buffer, byteOffset, byteLength)
      for (let i = 0; i < nPixels; i++) result[i] = bzero + bscale * view.getInt16(i * 2, false)
      return result
    }

    if (bitpix === 32) {
      if (identity) {
        const result = new Int32Array(nPixels)
        if (aligned && IS_LITTLE_ENDIAN) {
          const input = new Uint32Array(buffer, byteOffset, nPixels)
          for (let i = 0; i < nPixels; i++) {
            result[i] = swap32(input[i]!) | 0
          }
          return result
        }
        if (aligned && !IS_LITTLE_ENDIAN) {
          const input = new Int32Array(buffer, byteOffset, nPixels)
          result.set(input)
          return result
        }
        const view = new DataView(buffer, byteOffset, byteLength)
        for (let i = 0; i < nPixels; i++) result[i] = view.getInt32(i * 4, false)
        return result
      }
      const result = new Float64Array(nPixels)
      if (aligned && IS_LITTLE_ENDIAN) {
        const input = new Uint32Array(buffer, byteOffset, nPixels)
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * (swap32(input[i]!) | 0)
        }
        return result
      }
      if (aligned && !IS_LITTLE_ENDIAN) {
        const input = new Int32Array(buffer, byteOffset, nPixels)
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * input[i]!
        }
        return result
      }
      const view = new DataView(buffer, byteOffset, byteLength)
      for (let i = 0; i < nPixels; i++) result[i] = bzero + bscale * view.getInt32(i * 4, false)
      return result
    }

    if (bitpix === 64) {
      const view = new DataView(buffer, byteOffset, byteLength)
      const canKeepBigInt = bscale === 1 && Number.isInteger(bzero) && Number.isSafeInteger(bzero)
      if (canKeepBigInt) {
        const result = new BigInt64Array(nPixels)
        const zero = BigInt(bzero)
        for (let i = 0; i < nPixels; i++) {
          result[i] = view.getBigInt64(i * 8, false) + zero
        }
        return result
      }

      const result = new Float64Array(nPixels)
      if (identity) {
        for (let i = 0; i < nPixels; i++) {
          result[i] = Number(view.getBigInt64(i * 8, false))
        }
      } else {
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * Number(view.getBigInt64(i * 8, false))
        }
      }
      return result
    }

    if (bitpix === -32) {
      const result = new Float32Array(nPixels)
      if (aligned && IS_LITTLE_ENDIAN) {
        const input = new Uint32Array(buffer, byteOffset, nPixels)
        if (identity) {
          for (let i = 0; i < nPixels; i++) {
            FLOAT32_SCRATCH_U32[0] = swap32(input[i]!) >>> 0
            result[i] = FLOAT32_SCRATCH_F32[0]!
          }
          return result
        }
        for (let i = 0; i < nPixels; i++) {
          FLOAT32_SCRATCH_U32[0] = swap32(input[i]!) >>> 0
          result[i] = bzero + bscale * FLOAT32_SCRATCH_F32[0]!
        }
        return result
      }
      if (aligned && !IS_LITTLE_ENDIAN) {
        const input = new Float32Array(buffer, byteOffset, nPixels)
        if (identity) {
          result.set(input)
          return result
        }
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * input[i]!
        }
        return result
      }

      const view = new DataView(buffer, byteOffset, byteLength)
      if (identity) {
        for (let i = 0; i < nPixels; i++) result[i] = view.getFloat32(i * 4, false)
        return result
      }
      for (let i = 0; i < nPixels; i++) result[i] = bzero + bscale * view.getFloat32(i * 4, false)
      return result
    }

    // bitpix === -64
    const result = new Float64Array(nPixels)
    const view = new DataView(buffer, byteOffset, byteLength)
    if (identity) {
      for (let i = 0; i < nPixels; i++) result[i] = view.getFloat64(i * 8, false)
    } else {
      for (let i = 0; i < nPixels; i++) {
        result[i] = bzero + bscale * view.getFloat64(i * 8, false)
      }
    }
    return result
  }

  /**
   * Read a single frame from the image. For 2D images, frame is always 0.
   * For data cubes, frame selects the z-slice.
   *
   * @returns Promise resolving to pixel data as a typed array.
   */
  async getFrame(frame: number = 0): Promise<TypedArray> {
    const frameInfo = this.getFrameInfo(frame)
    const cachedBlobFrame = this.getCachedBlobFrameBuffer(frame)
    if (cachedBlobFrame) {
      return Image.computeFrame(cachedBlobFrame, this.bitpix, this.bzero, this.bscale)
    }

    // Read from in-memory buffer (including view-based storage)
    if (this.buffer) {
      const begin = this.bufferByteOffset + frameInfo.begin
      if (
        begin < this.bufferByteOffset ||
        begin + this.frameLength > this.bufferByteOffset + this.bufferByteLength
      ) {
        throw new Error('Frame byte range is out of bounds')
      }
      if (
        this.bitpix === 8 &&
        this.bzero === 0 &&
        this.bscale === 1 &&
        (this.bufferByteOffset !== 0 || this.bufferByteLength !== this.buffer.byteLength)
      ) {
        return new Uint8Array(this.buffer, begin, this.frameLength)
      }
      return Image.computeFrameFromRange(
        this.buffer,
        begin,
        this.frameLength,
        this.bitpix,
        this.bzero,
        this.bscale,
      )
    }

    // Read from blob
    const arrayBuffer = await this.readBlobFrameBuffer(frame)
    return Image.computeFrame(arrayBuffer, this.bitpix, this.bzero, this.bscale)
  }

  /**
   * Release cached blob-backed frame buffers.
   *
   * @param frameIndex - Optional frame index to clear. If omitted, clears all cached frames.
   */
  releaseFrameCache(frameIndex?: number): void {
    if (frameIndex === undefined) {
      this.pendingBlobFrameReads.clear()
      this.blobFrameCache.clear()
      for (const frameInfo of this.frameOffsets) {
        frameInfo.buffers = undefined
      }
      return
    }

    const frameInfo = this.getFrameInfo(frameIndex)
    this.pendingBlobFrameReads.delete(frameIndex)
    this.blobFrameCache.delete(frameIndex)
    frameInfo.buffers = undefined
  }

  /**
   * Read a frame as numbers, explicitly allowing precision loss for int64 images.
   */
  async getFrameAsNumber(frame: number = 0): Promise<Float64Array> {
    const pixels = await this.getFrame(frame)
    if (pixels instanceof Float64Array) {
      return pixels
    }
    const out = new Float64Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) {
      out[i] = Number(pixels[i]!)
    }
    return out
  }

  /**
   * Read multiple sequential frames from a data cube.
   *
   * @param startFrame - First frame index to read.
   * @param count - Number of frames to read.
   * @returns Promise resolving to an array of typed arrays, one per frame.
   */
  async getFrames(startFrame: number, count: number): Promise<TypedArray[]> {
    const indices = Array.from({ length: count }, (_, i) => startFrame + i)
    return Promise.all(indices.map((i) => this.getFrame(i)))
  }

  /** Check if the image is a data cube (more than 2 axes). */
  isDataCube(): boolean {
    return this.naxis.length > 2
  }

  /**
   * Async iterator for frame-by-frame reading of data cubes.
   * Yields each frame sequentially from index 0 to depth-1.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<TypedArray> {
    for (let i = 0; i < this.depth; i++) {
      yield this.getFrame(i)
    }
  }

  /** Compute min/max pixel values of an array, ignoring NaN. */
  getExtent(arr: TypedArray): [number | bigint, number | bigint] {
    return getExtent(arr)
  }

  /** Get a single pixel value at (x, y) from a pixel array. */
  getPixel(arr: TypedArray, x: number, y: number): number | bigint {
    return getPixel(arr, x, y, this.width)
  }
}
