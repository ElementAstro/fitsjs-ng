import { describe, expect, it, vi } from 'vitest'
import { requestHiPS2FITS } from '../../src/hips/hips-remote'

describe('hips-remote', () => {
  it('builds hips2fits request and returns response bytes', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]).buffer
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input)
      expect(url).toContain('hips=CDS%2FP%2F2MASS%2FK')
      expect(url).toContain('width=64')
      expect(url).toContain('height=32')
      expect(url).toContain('format=fits')
      return new Response(payload, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const out = await requestHiPS2FITS(
        'CDS/P/2MASS/K',
        {
          width: 64,
          height: 32,
          ra: 83.6,
          dec: 22.0,
          fov: 1.2,
          projection: 'TAN',
          format: 'fits',
        },
        {
          endpoint: 'https://example.org/hips2fits',
          timeoutMs: 5000,
        },
      )
      expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})
