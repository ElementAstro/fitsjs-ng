import { describe, expect, it, vi } from 'vitest'
import { FITS } from '../../src/fits'
import { Image } from '../../src/fits/image'
import { makeSimpleImage } from '../shared/helpers'

function parseRangeHeader(range: string): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d+)$/.exec(range.trim())
  if (!match) {
    throw new Error(`Invalid Range header: ${range}`)
  }
  const start = Number.parseInt(match[1]!, 10)
  const end = Number.parseInt(match[2]!, 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`Invalid Range header values: ${range}`)
  }
  return { start, end }
}

function makeRangeResponse(
  bytes: Uint8Array,
  start: number,
  end: number,
  headers?: Record<string, string>,
): Response {
  const clampedStart = Math.max(0, start)
  const clampedEnd = Math.min(bytes.byteLength - 1, end)
  const body = bytes.subarray(clampedStart, clampedEnd + 1)

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${clampedStart}-${clampedEnd}/${bytes.byteLength}`,
      ...headers,
    },
  })
}

describe('FITS.fromURL', () => {
  it('auto mode uses range loading and defers frame-byte requests until getFrame()', async () => {
    const source = makeSimpleImage(2, 2, 16, [10, 20, 30, 40])
    const bytes = new Uint8Array(source)
    const rangeRequests: string[] = []
    let eagerRequests = 0

    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const range = headers.get('range')
      if (!range) {
        eagerRequests++
        return new Response(bytes, { status: 200 })
      }

      rangeRequests.push(range)
      const { start, end } = parseRangeHeader(range)
      return makeRangeResponse(bytes, start, end)
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fits = await FITS.fromURL('https://example.test/image.fits', {
        urlMode: 'auto',
        rangeChunkSize: 2880,
        rangeMaxCachedChunks: 4,
      })

      expect(eagerRequests).toBe(0)
      expect(rangeRequests).toContain('bytes=0-0')

      const image = fits.getDataUnit() as Image
      const beforeFrameReads = rangeRequests.length
      const frame = await image.getFrame(0)

      expect(image.getPixel(frame, 0, 0)).toBe(10)
      expect(rangeRequests.length).toBeGreaterThan(beforeFrameReads)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('auto mode falls back to eager download when range is unsupported', async () => {
    const source = makeSimpleImage(2, 2, 16, [1, 2, 3, 4])
    const bytes = new Uint8Array(source)

    let rangedCalls = 0
    let eagerCalls = 0

    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      if (range) {
        rangedCalls++
        return new Response(bytes, { status: 200 })
      }
      eagerCalls++
      return new Response(bytes, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fits = await FITS.fromURL('https://example.test/image.fits', { urlMode: 'auto' })
      const image = fits.getDataUnit() as Image
      const frame = await image.getFrame(0)

      expect(image.getPixel(frame, 1, 1)).toBe(4)
      expect(rangedCalls).toBeGreaterThan(0)
      expect(eagerCalls).toBeGreaterThan(0)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('range mode throws when range support is unavailable', async () => {
    const source = makeSimpleImage(2, 2, 16, [1, 2, 3, 4])
    const bytes = new Uint8Array(source)

    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      return new Response(bytes, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        FITS.fromURL('https://example.test/image.fits', { urlMode: 'range' }),
      ).rejects.toThrow('Range probe expected HTTP 206')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('auto mode falls back when range responses are gzip-encoded', async () => {
    const source = makeSimpleImage(2, 2, 16, [6, 7, 8, 9])
    const bytes = new Uint8Array(source)

    let eagerCalls = 0
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      if (range) {
        const { start, end } = parseRangeHeader(range)
        return makeRangeResponse(bytes, start, end, { 'Content-Encoding': 'gzip' })
      }
      eagerCalls++
      return new Response(bytes, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fits = await FITS.fromURL('https://example.test/image.fits', { urlMode: 'auto' })
      const image = fits.getDataUnit() as Image
      const frame = await image.getFrame(0)

      expect(image.getPixel(frame, 0, 1)).toBe(8)
      expect(eagerCalls).toBeGreaterThan(0)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('preserves requestInit options and merges custom headers with Range', async () => {
    const source = makeSimpleImage(2, 2, 16, [11, 12, 13, 14])
    const bytes = new Uint8Array(source)

    let rangeCalls = 0
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(init?.credentials).toBe('include')
      expect(headers.get('authorization')).toBe('Bearer test-token')
      expect(headers.get('x-client-id')).toBe('fitsjs-tests')

      const range = headers.get('range')
      if (!range) {
        throw new Error('Expected range header in request')
      }
      rangeCalls++

      const { start, end } = parseRangeHeader(range)
      return makeRangeResponse(bytes, start, end)
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fits = await FITS.fromURL('https://example.test/image.fits', {
        urlMode: 'auto',
        rangeChunkSize: 2880,
        requestInit: {
          credentials: 'include',
          headers: {
            Authorization: 'Bearer test-token',
            'X-Client-Id': 'fitsjs-tests',
          },
        },
      })
      const image = fits.getDataUnit() as Image
      const frame = await image.getFrame(0)
      expect(image.getPixel(frame, 1, 0)).toBe(12)
      expect(rangeCalls).toBeGreaterThan(1)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('supports timeout control for eager URL loading', async () => {
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'))
          },
          { once: true },
        )
      })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        FITS.fromURL('https://example.test/timeout.fits', {
          urlMode: 'eager',
          timeoutMs: 15,
        }),
      ).rejects.toThrow('timed out')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('retries eager URL loading when retryCount is configured', async () => {
    const source = makeSimpleImage(2, 2, 16, [15, 16, 17, 18])
    const bytes = new Uint8Array(source)
    let attempts = 0

    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      attempts++
      if (attempts === 1) {
        return new Response('temporary failure', { status: 503, statusText: 'Service Unavailable' })
      }
      return new Response(bytes, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fits = await FITS.fromURL('https://example.test/retry.fits', {
        urlMode: 'eager',
        retryCount: 1,
        retryDelayMs: 0,
      })
      const image = fits.getDataUnit() as Image
      const frame = await image.getFrame(0)
      expect(image.getPixel(frame, 1, 1)).toBe(18)
      expect(attempts).toBe(2)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})
