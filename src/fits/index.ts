import { parseBuffer, parseBlob, parseBytes } from './parser'
import { HDU } from './hdu'
import { HTTPRangeBlob } from './http-range-blob'
import { fetchOkWithNetworkPolicy } from '../core/network'
import type { Header } from './header'
import type { DataUnit } from './data-unit'
import type { ReadOptions, FetchOptions } from '../core/types'

async function responseToArrayBuffer(response: Response): Promise<ArrayBuffer> {
  const responseWithBytes = response as Response & {
    bytes?: () => Promise<Uint8Array>
  }
  if (typeof responseWithBytes.bytes === 'function') {
    const bytes = await responseWithBytes.bytes()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  return response.arrayBuffer()
}

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
   * Parse a FITS file from an in-memory byte view (synchronous).
   *
   * By default this opts into view-based storage for supported data units to avoid copies.
   * Pass `dataUnitStorage: 'copy'` to preserve copy-based behavior.
   */
  static fromBytes(bytes: Uint8Array, options?: ReadOptions): FITS {
    const effectiveStorage = options?.dataUnitStorage ?? 'view'
    const hdus = parseBytes(bytes, { ...options, dataUnitStorage: effectiveStorage })
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
   * @param options - Optional fetch/read options.
   *
   * Default mode is `urlMode: 'auto'`:
   * - try HTTP Range-backed lazy loading first,
   * - fall back to eager full download when range loading is unavailable.
   */
  static async fromURL(url: string, options?: FetchOptions): Promise<FITS> {
    const urlMode = options?.urlMode ?? 'auto'
    const warn = options?.onWarning ?? console.warn

    if (urlMode === 'auto' || urlMode === 'range') {
      try {
        const rangeSource = await HTTPRangeBlob.open(url, {
          requestInit: options?.requestInit,
          timeoutMs: options?.timeoutMs,
          retryCount: options?.retryCount,
          retryDelayMs: options?.retryDelayMs,
          chunkSize: options?.rangeChunkSize,
          maxCachedChunks: options?.rangeMaxCachedChunks,
        })
        const hdus = await parseBlob(rangeSource, options)
        return new FITS(hdus)
      } catch (error) {
        if (urlMode === 'range') {
          throw error
        }
        warn(
          `FITS.fromURL auto mode fell back to eager download because range loading is unavailable: ${String(error)}`,
        )
      }
    }

    const response = await fetchOkWithNetworkPolicy(
      url,
      {
        requestInit: options?.requestInit,
        timeoutMs: options?.timeoutMs,
        retryCount: options?.retryCount,
        retryDelayMs: options?.retryDelayMs,
      },
      { method: 'GET' },
      'Failed to fetch FITS file',
    )
    const buffer = await responseToArrayBuffer(response)
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
    if (options?.dataUnitStorage === 'view') {
      const bytes = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength)
      return FITS.fromBytes(bytes, options)
    }

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
