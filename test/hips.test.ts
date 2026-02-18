import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hipsAllskyPath, hipsTilePath } from '../src/hips-path'
import { HiPS } from '../src/hips'
import { encodeHiPSTile } from '../src/hips-tile'

function fitsTileBytes(order: number, ipix: number): Uint8Array {
  return encodeHiPSTile(
    { order, ipix, frame: 'equatorial', format: 'fits' },
    Float32Array.from([1, 2, 3, 4]),
    2,
    1,
  )
}

describe('hips', () => {
  it('reads properties and tiles from custom source objects', async () => {
    const tileBytes = fitsTileBytes(0, 0)
    let readTextCalls = 0
    const source = {
      async readText(path: string) {
        readTextCalls++
        expect(path).toBe('properties')
        return 'hips_tile_format = png fits\nhips_frame = equatorial\n'
      },
      async readBinary(path: string) {
        if (path.endsWith('.png')) throw new Error('png missing')
        if (path === hipsTilePath({ order: 0, ipix: 0, frame: 'equatorial', format: 'fits' }))
          return tileBytes
        if (path === hipsAllskyPath('fits')) return tileBytes
        throw new Error(`unexpected path: ${path}`)
      },
      async writeText(_path: string, _text: string) {
        // no-op
      },
    }

    const hips = await HiPS.open(source)
    expect(readTextCalls).toBe(1)
    expect(await hips.tileFormats()).toEqual(['png', 'fits'])

    const tile = await hips.readTile({ order: 0, ipix: 0 })
    expect(tile.width).toBe(2)
    expect(tile.height).toBe(2)
    expect(tile.depth).toBe(1)
    expect(Array.from(tile.data.slice(0, 4))).toEqual([1, 2, 3, 4])

    const allsky = await hips.readAllsky()
    expect(allsky.byteLength).toBeGreaterThan(0)

    const writes: Array<{ path: string; text: string }> = []
    await hips.exportProperties({
      async writeText(path: string, text: string) {
        writes.push({ path, text })
      },
      async writeBinary() {},
      async readText() {
        return ''
      },
      async readBinary() {
        return new Uint8Array(0)
      },
      async exists() {
        return false
      },
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe('properties')
    expect(writes[0]!.text).toContain('hips_tile_format')
  })

  it('uses root directory source to read local files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-'))
    try {
      await writeFile(join(dir, 'properties'), 'hips_tile_format = fits\nhips_frame = equatorial\n')
      await mkdir(join(dir, 'Norder3'), { recursive: true })
      await writeFile(join(dir, hipsAllskyPath('fits')), fitsTileBytes(0, 0))
      const hips = new HiPS({ root: dir })
      const props = await hips.getProperties()
      expect(props.get('hips_tile_format')).toBe('fits')
      const allsky = await hips.readAllsky('fits')
      expect(allsky.byteLength).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports URL-like sources and reports fetch failures', async () => {
    const originalFetch = globalThis.fetch
    const tile = fitsTileBytes(0, 0)
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/properties')) {
        return new Response('hips_tile_format = fits\nhips_frame = equatorial\n', { status: 200 })
      }
      if (url.endsWith('/Norder0/Dir0/Npix0.fits') || url.endsWith('/Norder3/Allsky.fits')) {
        return new Response(tile, { status: 200 })
      }
      return new Response('missing', { status: 404, statusText: 'Not Found' })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const fromRootUrl = new HiPS({ root: 'https://example.test/base' })
      expect((await fromRootUrl.getProperties()).get('hips_frame')).toBe('equatorial')

      const fromStringUrl = new HiPS('https://example.test/base')
      expect((await fromStringUrl.readAllsky('fits')).byteLength).toBeGreaterThan(0)

      const fromUrlObject = new HiPS(new URL('https://example.test/base'))
      const tileResult = await fromUrlObject.readTile({ order: 0, ipix: 0, format: 'fits' })
      expect(tileResult.width).toBe(2)

      await expect(fromRootUrl.readAllsky('jpeg')).rejects.toThrow('Allsky not found')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('throws for unsupported source types', async () => {
    const hips = new HiPS(123 as never)
    await expect(hips.getProperties()).rejects.toThrow('Unsupported HiPS source')
  })
})
