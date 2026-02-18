import { DataUnit } from './data-unit'
import { getExtent, getPixel } from './image-utils'
import type { Header } from './header'
import type { TypedArray } from './types'

interface FrameOffset {
  begin: number
  buffers?: ArrayBuffer[]
}

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

  constructor(header: Header, data: ArrayBuffer | Blob) {
    super(data)

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
      const info: FrameOffset = { begin }
      if (this.buffer) {
        info.buffers = [this.buffer.slice(begin, begin + this.frameLength)]
      }
      this.frameOffsets.push(info)
    }
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
    const bytes = Math.abs(bitpix) / 8
    const nPixels = buffer.byteLength / bytes
    const identity = bzero === 0 && bscale === 1
    const view = new DataView(buffer)
    const needFloat = !(Number.isInteger(bzero) && Number.isInteger(bscale))

    if (bitpix === 8) {
      if (identity) return new Uint8Array(buffer.slice(0))
      const result = needFloat ? new Float32Array(nPixels) : new Int32Array(nPixels)
      for (let i = 0; i < nPixels; i++) {
        result[i] = bzero + bscale * view.getUint8(i)
      }
      return result
    }

    if (bitpix === 16) {
      if (identity) {
        const result = new Int16Array(nPixels)
        for (let i = 0; i < nPixels; i++) result[i] = view.getInt16(i * 2, false)
        return result
      }
      const result = needFloat ? new Float32Array(nPixels) : new Int32Array(nPixels)
      for (let i = 0; i < nPixels; i++) {
        result[i] = bzero + bscale * view.getInt16(i * 2, false)
      }
      return result
    }

    if (bitpix === 32) {
      if (identity) {
        const result = new Int32Array(nPixels)
        for (let i = 0; i < nPixels; i++) result[i] = view.getInt32(i * 4, false)
        return result
      }
      const result = new Float64Array(nPixels)
      for (let i = 0; i < nPixels; i++) {
        result[i] = bzero + bscale * view.getInt32(i * 4, false)
      }
      return result
    }

    if (bitpix === 64) {
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
      if (identity) {
        for (let i = 0; i < nPixels; i++) result[i] = view.getFloat32(i * 4, false)
      } else {
        for (let i = 0; i < nPixels; i++) {
          result[i] = bzero + bscale * view.getFloat32(i * 4, false)
        }
      }
      return result
    }

    // bitpix === -64
    const result = new Float64Array(nPixels)
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
    const frameInfo = this.frameOffsets[frame]!

    if (frameInfo.buffers && frameInfo.buffers.length > 0) {
      return Image.computeFrame(frameInfo.buffers[0]!, this.bitpix, this.bzero, this.bscale)
    }

    // Read from blob
    if (!this.blob) {
      throw new Error('No data source available for this image frame')
    }

    const begin = frameInfo.begin
    const blobFrame = this.blob.slice(begin, begin + this.frameLength)
    const arrayBuffer = await blobFrame.arrayBuffer()

    // Cache the buffer for future access
    frameInfo.buffers = [arrayBuffer]

    return Image.computeFrame(arrayBuffer, this.bitpix, this.bzero, this.bscale)
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
