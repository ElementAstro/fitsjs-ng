import { parseBuffer, parseBlob } from './parser'
import { HDU } from './hdu'
import type { Header } from './header'
import type { DataUnit } from './data-unit'
import type { ReadOptions, FetchOptions } from './types'

/**
 * Main FITS class — the primary entry point for reading FITS files.
 *
 * Provides static factory methods for creating FITS instances from
 * various data sources (ArrayBuffer, Blob/File, URL, Node.js Buffer).
 *
 * @example
 * ```ts
 * // From URL (browser)
 * const fits = await FITS.fromURL('https://example.com/image.fits');
 *
 * // From ArrayBuffer
 * const fits = FITS.fromArrayBuffer(buffer);
 *
 * // From File object (browser)
 * const fits = await FITS.fromBlob(fileInput.files[0]);
 *
 * // Access data
 * const header = fits.getHeader();
 * const image = fits.getDataUnit();
 * ```
 */
export class FITS {
  /** All Header Data Units in this FITS file. */
  readonly hdus: HDU[]

  private constructor(hdus: HDU[]) {
    this.hdus = hdus
  }

  // --- Static factory methods ---

  /**
   * Parse a FITS file from an ArrayBuffer (synchronous).
   */
  static fromArrayBuffer(buffer: ArrayBuffer, options?: ReadOptions): FITS {
    const hdus = parseBuffer(buffer, options)
    return new FITS(hdus)
  }

  /**
   * Parse a FITS file from a Blob or File object (async).
   */
  static async fromBlob(blob: Blob, options?: ReadOptions): Promise<FITS> {
    const hdus = await parseBlob(blob, options)
    return new FITS(hdus)
  }

  /**
   * Fetch a remote FITS file and parse it (async, browser or Node 18+).
   *
   * @param url - URL of the FITS file.
   * @param init - Optional fetch RequestInit (headers, signal, etc.).
   */
  static async fromURL(url: string, options?: FetchOptions): Promise<FITS> {
    const response = await fetch(url, options?.requestInit)
    if (!response.ok) {
      throw new Error(`Failed to fetch FITS file: ${response.status} ${response.statusText}`)
    }
    const buffer = await response.arrayBuffer()
    return FITS.fromArrayBuffer(buffer, options)
  }

  /**
   * Parse a FITS file from a Node.js Buffer.
   * The buffer is converted to an ArrayBuffer internally.
   */
  static fromNodeBuffer(
    nodeBuffer: { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
    options?: ReadOptions,
  ): FITS {
    const arrayBuffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength,
    )
    return FITS.fromArrayBuffer(arrayBuffer, options)
  }

  // --- Public API ---

  /**
   * Returns the first HDU containing a data unit.
   * If `index` is provided, returns that specific HDU.
   */
  getHDU(index?: number): HDU | undefined {
    if (index !== undefined) {
      return index >= 0 && index < this.hdus.length ? this.hdus[index] : undefined
    }
    for (const hdu of this.hdus) {
      if (hdu.hasData()) return hdu
    }
    return undefined
  }

  /**
   * Returns the header associated with the first HDU containing a data unit.
   * If `index` is provided, returns the header of that specific HDU.
   */
  getHeader(index?: number): Header | undefined {
    return this.getHDU(index)?.header
  }

  /**
   * Returns the data unit associated with the first HDU containing a data unit.
   * If `index` is provided, returns the data unit of that specific HDU.
   */
  getDataUnit(index?: number): DataUnit | undefined {
    return this.getHDU(index)?.data
  }
}
