import type { BlobSource } from '../core/types'
import { fetchWithNetworkPolicy, withNetworkRetry, type NetworkReadOptions } from '../core/network'

const DEFAULT_RANGE_CHUNK_SIZE = 262_144
const DEFAULT_RANGE_MAX_CACHED_CHUNKS = 16

function parseContentRange(
  value: string | null,
): { start: number; end: number; total: number } | null {
  if (!value) return null
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim())
  if (!match) return null
  if (match[3] === '*') return null

  const start = Number.parseInt(match[1]!, 10)
  const end = Number.parseInt(match[2]!, 10)
  const total = Number.parseInt(match[3]!, 10)

  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) return null
  if (start < 0 || end < start || total <= end) return null

  return { start, end, total }
}

function normalizeChunkSize(chunkSize?: number): number {
  if (chunkSize === undefined) return DEFAULT_RANGE_CHUNK_SIZE
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid rangeChunkSize: ${chunkSize}`)
  }
  return chunkSize
}

function normalizeMaxCachedChunks(maxCachedChunks?: number): number {
  if (maxCachedChunks === undefined) return DEFAULT_RANGE_MAX_CACHED_CHUNKS
  if (!Number.isInteger(maxCachedChunks) || maxCachedChunks <= 0) {
    throw new Error(`Invalid rangeMaxCachedChunks: ${maxCachedChunks}`)
  }
  return maxCachedChunks
}

function normalizeSliceIndex(index: number | undefined, size: number, fallback: number): number {
  if (index === undefined) return fallback
  if (!Number.isFinite(index)) return fallback
  if (index < 0) return Math.max(size + Math.trunc(index), 0)
  return Math.min(Math.trunc(index), size)
}

function ensureIdentityEncoding(response: Response): void {
  const contentEncoding = response.headers.get('content-encoding')
  if (!contentEncoding) return
  const normalized = contentEncoding.trim().toLowerCase()
  if (!normalized || normalized === 'identity') return
  throw new Error(
    `HTTP Range source must return identity content encoding; got "${contentEncoding}"`,
  )
}

class HTTPRangeBlobState {
  private readonly cache = new Map<number, Uint8Array>()
  private readonly pending = new Map<number, Promise<Uint8Array>>()

  constructor(
    readonly url: string,
    readonly networkOptions: NetworkReadOptions | undefined,
    readonly size: number,
    readonly chunkSize: number,
    readonly maxCachedChunks: number,
  ) {}

  async getChunk(index: number): Promise<Uint8Array> {
    const cached = this.cache.get(index)
    if (cached) {
      this.cache.delete(index)
      this.cache.set(index, cached)
      return cached
    }

    const inflight = this.pending.get(index)
    if (inflight) return inflight

    const promise = this.fetchChunk(index).finally(() => {
      this.pending.delete(index)
    })
    this.pending.set(index, promise)
    return promise
  }

  private async fetchChunk(index: number): Promise<Uint8Array> {
    const chunkStart = index * this.chunkSize
    if (chunkStart < 0 || chunkStart >= this.size) {
      throw new Error(`Range chunk index out of bounds: ${index}`)
    }
    const chunkEndExclusive = Math.min(this.size, chunkStart + this.chunkSize)
    const chunkEndInclusive = chunkEndExclusive - 1
    const expectedLength = chunkEndExclusive - chunkStart

    const bytes = await withNetworkRetry(
      async () => {
        const response = await fetchWithNetworkPolicy(
          this.url,
          {
            requestInit: this.networkOptions?.requestInit,
            timeoutMs: this.networkOptions?.timeoutMs,
            retryCount: 0,
            retryDelayMs: 0,
          },
          {
            method: 'GET',
            headers: {
              Range: `bytes=${chunkStart}-${chunkEndInclusive}`,
            },
          },
        )

        if (response.status !== 206) {
          throw new Error(
            `Range request expected HTTP 206 but got ${response.status} ${response.statusText}`,
          )
        }
        ensureIdentityEncoding(response)

        const parsed = parseContentRange(response.headers.get('content-range'))
        if (!parsed) {
          throw new Error('Invalid or missing Content-Range header in range response')
        }
        if (
          parsed.start !== chunkStart ||
          parsed.end !== chunkEndInclusive ||
          parsed.total !== this.size
        ) {
          throw new Error(
            `Content-Range mismatch: expected bytes ${chunkStart}-${chunkEndInclusive}/${this.size}, got bytes ${parsed.start}-${parsed.end}/${parsed.total}`,
          )
        }

        const chunkBytes = new Uint8Array(await response.arrayBuffer())
        if (chunkBytes.byteLength !== expectedLength) {
          throw new Error(
            `Range response length mismatch: expected ${expectedLength}, got ${chunkBytes.byteLength}`,
          )
        }
        return chunkBytes
      },
      {
        retryCount: this.networkOptions?.retryCount,
        retryDelayMs: this.networkOptions?.retryDelayMs,
        signal: this.networkOptions?.requestInit?.signal ?? undefined,
      },
    )

    this.rememberChunk(index, bytes)
    return bytes
  }

  private rememberChunk(index: number, bytes: Uint8Array): void {
    if (this.cache.has(index)) {
      this.cache.delete(index)
    }
    this.cache.set(index, bytes)

    while (this.cache.size > this.maxCachedChunks) {
      const oldestKey = this.cache.keys().next().value as number | undefined
      if (oldestKey === undefined) break
      this.cache.delete(oldestKey)
    }
  }
}

/**
 * Blob-like HTTP source backed by range requests.
 *
 * Supports `size`, `slice()`, and `arrayBuffer()` so it can be consumed by the
 * same parser path as native Blob sources.
 */
export class HTTPRangeBlob implements BlobSource {
  private constructor(
    private readonly state: HTTPRangeBlobState,
    private readonly absoluteStart: number,
    private readonly absoluteEnd: number,
  ) {}

  static async open(
    url: string,
    options?: {
      requestInit?: RequestInit
      timeoutMs?: number
      retryCount?: number
      retryDelayMs?: number
      chunkSize?: number
      maxCachedChunks?: number
    },
  ): Promise<HTTPRangeBlob> {
    const chunkSize = normalizeChunkSize(options?.chunkSize)
    const maxCachedChunks = normalizeMaxCachedChunks(options?.maxCachedChunks)

    const parsed = await withNetworkRetry(
      async () => {
        const probeResponse = await fetchWithNetworkPolicy(
          url,
          {
            requestInit: options?.requestInit,
            timeoutMs: options?.timeoutMs,
            retryCount: 0,
            retryDelayMs: 0,
          },
          {
            method: 'GET',
            headers: {
              Range: 'bytes=0-0',
            },
          },
        )

        if (probeResponse.status !== 206) {
          throw new Error(
            `Range probe expected HTTP 206 but got ${probeResponse.status} ${probeResponse.statusText}`,
          )
        }
        ensureIdentityEncoding(probeResponse)

        const contentRange = parseContentRange(probeResponse.headers.get('content-range'))
        if (!contentRange || contentRange.start !== 0 || contentRange.end !== 0) {
          throw new Error('Range probe returned invalid Content-Range header')
        }

        await probeResponse.arrayBuffer()
        return contentRange
      },
      {
        retryCount: options?.retryCount,
        retryDelayMs: options?.retryDelayMs,
        signal: options?.requestInit?.signal ?? undefined,
      },
    )

    const state = new HTTPRangeBlobState(
      url,
      {
        requestInit: options?.requestInit,
        timeoutMs: options?.timeoutMs,
        retryCount: options?.retryCount,
        retryDelayMs: options?.retryDelayMs,
      },
      parsed.total,
      chunkSize,
      maxCachedChunks,
    )
    return new HTTPRangeBlob(state, 0, parsed.total)
  }

  get size(): number {
    return this.absoluteEnd - this.absoluteStart
  }

  slice(start?: number, end?: number, _contentType?: string): HTTPRangeBlob {
    const localStart = normalizeSliceIndex(start, this.size, 0)
    const localEnd = normalizeSliceIndex(end, this.size, this.size)
    const clampedEnd = Math.max(localStart, localEnd)
    return new HTTPRangeBlob(
      this.state,
      this.absoluteStart + localStart,
      this.absoluteStart + clampedEnd,
    )
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const outLength = this.size
    if (outLength <= 0) return new ArrayBuffer(0)

    const out = new Uint8Array(outLength)
    const firstChunk = Math.floor(this.absoluteStart / this.state.chunkSize)
    const lastChunk = Math.floor((this.absoluteEnd - 1) / this.state.chunkSize)

    const indices = Array.from({ length: lastChunk - firstChunk + 1 }, (_, i) => firstChunk + i)
    const chunks = await Promise.all(indices.map((index) => this.state.getChunk(index)))

    for (let i = 0; i < indices.length; i++) {
      const chunkIndex = indices[i]!
      const chunk = chunks[i]!
      const chunkStart = chunkIndex * this.state.chunkSize
      const copyStart = Math.max(this.absoluteStart, chunkStart)
      const copyEnd = Math.min(this.absoluteEnd, chunkStart + chunk.byteLength)

      if (copyEnd <= copyStart) continue

      const sourceStart = copyStart - chunkStart
      const sourceEnd = sourceStart + (copyEnd - copyStart)
      const targetStart = copyStart - this.absoluteStart
      out.set(chunk.subarray(sourceStart, sourceEnd), targetStart)
    }

    return out.buffer
  }
}
