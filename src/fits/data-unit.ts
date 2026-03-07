import { swapEndian } from '../core/utils'
import type { BlobSource } from '../core/types'

function isBlobSource(value: unknown): value is BlobSource {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BlobSource>
  return (
    typeof candidate.size === 'number' &&
    typeof candidate.slice === 'function' &&
    typeof candidate.arrayBuffer === 'function'
  )
}

/**
 * Base class for FITS data units (Image, BinaryTable, Table, CompressedImage).
 *
 * FITS data is always stored in big-endian format. This base class provides
 * shared infrastructure for endian swapping and buffer management.
 */
export class DataUnit {
  /** The ArrayBuffer containing raw data (available when loaded from buffer). */
  buffer?: ArrayBuffer
  /** The blob-like source containing raw data (available for lazy sources). */
  blob?: BlobSource

  /**
   * Byte range of the data unit within `buffer`.
   *
   * When parsing with view-based storage, `buffer` may be a shared larger ArrayBuffer
   * and this range defines the actual data unit payload.
   */
  protected bufferByteOffset = 0
  protected bufferByteLength = 0

  /** Static endian swap functions keyed by type code or byte size. */
  static readonly swapEndian = swapEndian

  constructor(data: ArrayBuffer | BlobSource | ArrayBufferView) {
    if (data instanceof ArrayBuffer) {
      this.buffer = data
      this.bufferByteOffset = 0
      this.bufferByteLength = data.byteLength
      return
    }

    if (ArrayBuffer.isView(data)) {
      if (data.buffer instanceof ArrayBuffer) {
        this.buffer = data.buffer
        this.bufferByteOffset = data.byteOffset
        this.bufferByteLength = data.byteLength
        return
      }

      // SharedArrayBuffer (or other ArrayBufferLike): copy into a real ArrayBuffer to preserve API types.
      const copy = new Uint8Array(data.byteLength)
      copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      this.buffer = copy.buffer
      this.bufferByteOffset = 0
      this.bufferByteLength = copy.byteLength
      return
    }

    if (isBlobSource(data)) {
      this.blob = data
      return
    }
  }

  /**
   * Returns a byte view of the data unit payload for in-memory sources.
   *
   * Note: blob-backed data units cannot provide a synchronous view. Use the
   * appropriate async reader for blob sources.
   */
  getByteView(): Uint8Array {
    if (!this.buffer) {
      if (this.blob) {
        throw new Error('DataUnit is backed by Blob; use async reading methods instead')
      }
      throw new Error('No data source available')
    }
    return new Uint8Array(this.buffer, this.bufferByteOffset, this.bufferByteLength)
  }
}
