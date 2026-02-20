import { swapEndian } from '../core/utils'

/**
 * Base class for FITS data units (Image, BinaryTable, Table, CompressedImage).
 *
 * FITS data is always stored in big-endian format. This base class provides
 * shared infrastructure for endian swapping and buffer management.
 */
export class DataUnit {
  /** The ArrayBuffer containing raw data (available when loaded from buffer). */
  buffer?: ArrayBuffer
  /** The Blob containing raw data (available when loaded from file). */
  blob?: Blob

  /** Static endian swap functions keyed by type code or byte size. */
  static readonly swapEndian = swapEndian

  constructor(data: ArrayBuffer | Blob) {
    if (data instanceof ArrayBuffer) {
      this.buffer = data
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      this.blob = data
    }
  }
}
