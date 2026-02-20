import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BinaryTable } from '../../src/fits/binary-table'
import { FITS } from '../../src/fits'
import { convertFitsToHiPS } from '../../src/hips/hips-build'
import { convertHiPSToFITS } from '../../src/hips/hips-export'
import { hipsAllskyPath } from '../../src/hips/hips-path'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../../src/fits/fits-writer'
import { NodeFSTarget } from '../../src/hips/storage-target'
import { lintHiPS } from '../../src/validation/hips-lint'

function createInputFits(width: number, height: number): ArrayBuffer {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = x + y * 0.1
    }
  }
  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'CTYPE1', value: 'RA---CAR' },
      { key: 'CTYPE2', value: 'DEC--CAR' },
      { key: 'CRVAL1', value: 0 },
      { key: 'CRVAL2', value: 0 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.5 },
      { key: 'CDELT2', value: 0.5 },
    ],
  })
  return writeFITS([hdu])
}

function createInputFitsCube(width: number, height: number, depth: number): ArrayBuffer {
  const values = new Float32Array(width * height * depth)
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        values[z * width * height + y * width + x] = z * 100 + x + y * 0.1
      }
    }
  }
  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    depth,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'CTYPE1', value: 'RA---CAR' },
      { key: 'CTYPE2', value: 'DEC--CAR' },
      { key: 'CRVAL1', value: 0 },
      { key: 'CRVAL2', value: 0 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.5 },
      { key: 'CDELT2', value: 0.5 },
    ],
  })
  return writeFITS([hdu])
}

async function findFirstTile(root: string): Promise<{ order: number; ipix: number } | null> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      const match = /Norder(\d+)[\\/]+Dir\d+[\\/]+Npix(\d+)\.fits$/iu.exec(full)
      if (match) {
        return {
          order: Number(match[1]),
          ipix: Number(match[2]),
        }
      }
    }
  }
  return null
}

async function findFirstTileAny(root: string): Promise<{ order: number; ipix: number } | null> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      const match = /Norder(\d+)[\\/]+Dir\d+[\\/]+Npix(\d+)\.(fits|png|jpg)$/iu.exec(full)
      if (match) {
        return {
          order: Number(match[1]),
          ipix: Number(match[2]),
        }
      }
    }
  }
  return null
}

describe('hips-convert', () => {
  it('converts FITS to HiPS and exports back to FITS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-'))
    try {
      const inputFits = createInputFits(32, 16)
      const target = new NodeFSTarget(dir)
      const build = await convertFitsToHiPS(inputFits, {
        output: target,
        title: 'Test HiPS',
        creatorDid: 'ivo://fitsjs-ng/tests',
        hipsOrder: 1,
        minOrder: 0,
        tileWidth: 8,
        formats: ['fits'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      expect(build.generatedTiles).toBeGreaterThan(0)
      expect(await target.exists('properties')).toBe(true)

      const tile = await findFirstTile(dir)
      expect(tile).not.toBeNull()
      const tileFits = await convertHiPSToFITS(dir, {
        tile: {
          order: tile!.order,
          ipix: tile!.ipix,
        },
      })
      const parsedTile = FITS.fromArrayBuffer(tileFits)
      const tileImage = parsedTile.getDataUnit()
      expect(tileImage).toBeDefined()

      const mapFits = await convertHiPSToFITS(dir, {
        map: {
          order: 0,
          ordering: 'NESTED',
        },
      })
      const mapParsed = FITS.fromArrayBuffer(mapFits)
      expect(mapParsed.hdus.length).toBe(2)
      expect(mapParsed.getDataUnit()).toBeInstanceOf(BinaryTable)
      expect(mapParsed.getHeader()?.getString('XTENSION')).toBe('BINTABLE')
      expect(mapParsed.getHeader()?.getNumber('NAXIS2')).toBe(12)

      const cutoutFits = await convertHiPSToFITS(dir, {
        cutout: {
          width: 24,
          height: 12,
          ra: 0,
          dec: 0,
          fov: 5,
          projection: 'TAN',
        },
      })
      const cutout = FITS.fromArrayBuffer(cutoutFits)
      const cutoutImage = cutout.getDataUnit()
      expect(cutoutImage && 'width' in cutoutImage ? cutoutImage.width : 0).toBe(24)

      const lint = await lintHiPS(dir)
      expect(lint.ok).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports png-only HiPS source for tile/map/cutout export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-png-'))
    try {
      const inputFits = createInputFits(32, 16)
      await convertFitsToHiPS(inputFits, {
        output: new NodeFSTarget(dir),
        title: 'PNG HiPS',
        creatorDid: 'ivo://fitsjs-ng/tests/png',
        hipsOrder: 1,
        minOrder: 1,
        tileWidth: 8,
        formats: ['png'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      const tile = await findFirstTileAny(dir)
      expect(tile).not.toBeNull()

      // Choose an order-1 tile that should likely exist near the center.
      const tileFits = await convertHiPSToFITS(dir, {
        tile: {
          order: tile!.order,
          ipix: tile!.ipix,
        },
      })
      const tileParsed = FITS.fromArrayBuffer(tileFits)
      expect(tileParsed.getDataUnit()).toBeDefined()

      const mapFits = await convertHiPSToFITS(dir, {
        map: { order: 1 },
      })
      const mapParsed = FITS.fromArrayBuffer(mapFits)
      expect(mapParsed.getDataUnit()).toBeInstanceOf(BinaryTable)

      const cutoutFits = await convertHiPSToFITS(dir, {
        cutout: { width: 20, height: 10, ra: 0, dec: 0, fov: 8, interpolation: 'bilinear' },
      })
      const cutoutParsed = FITS.fromArrayBuffer(cutoutFits)
      const cutoutImage = cutoutParsed.getDataUnit()
      expect(cutoutImage && 'width' in cutoutImage ? cutoutImage.width : 0).toBe(20)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports jpeg-only HiPS source for tile/map/cutout export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-jpeg-'))
    try {
      const inputFits = createInputFits(32, 16)
      await convertFitsToHiPS(inputFits, {
        output: new NodeFSTarget(dir),
        title: 'JPEG HiPS',
        creatorDid: 'ivo://fitsjs-ng/tests/jpeg',
        hipsOrder: 1,
        minOrder: 1,
        tileWidth: 8,
        formats: ['jpeg'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      const tile = await findFirstTileAny(dir)
      expect(tile).not.toBeNull()

      const tileFits = await convertHiPSToFITS(dir, {
        tile: {
          order: tile!.order,
          ipix: tile!.ipix,
        },
      })
      const parsed = FITS.fromArrayBuffer(tileFits)
      const image = parsed.getDataUnit()
      expect(image && 'width' in image ? image.width : 0).toBeGreaterThan(0)

      const mapFits = await convertHiPSToFITS(dir, {
        map: { order: tile!.order },
      })
      const mapParsed = FITS.fromArrayBuffer(mapFits)
      expect(mapParsed.getDataUnit()).toBeInstanceOf(BinaryTable)

      const cutoutFits = await convertHiPSToFITS(dir, {
        cutout: { width: 16, height: 8, ra: 0, dec: 0, fov: 8, interpolation: 'nearest' },
      })
      const cutoutParsed = FITS.fromArrayBuffer(cutoutFits)
      const cutout = cutoutParsed.getDataUnit()
      expect(cutout && 'height' in cutout ? cutout.height : 0).toBe(8)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('generates Allsky for png-only datasets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-allsky-png-'))
    try {
      const target = new NodeFSTarget(dir)
      await convertFitsToHiPS(createInputFits(32, 16), {
        output: target,
        title: 'PNG Allsky',
        creatorDid: 'ivo://fitsjs-ng/tests/allsky/png',
        hipsOrder: 3,
        minOrder: 3,
        tileWidth: 8,
        formats: ['png'],
        includeAllsky: true,
        includeMoc: false,
        includeIndexHtml: false,
      })

      expect(await target.exists(hipsAllskyPath('png'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('generates Allsky for jpeg-only datasets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-allsky-jpeg-'))
    try {
      const target = new NodeFSTarget(dir)
      await convertFitsToHiPS(createInputFits(32, 16), {
        output: target,
        title: 'JPEG Allsky',
        creatorDid: 'ivo://fitsjs-ng/tests/allsky/jpeg',
        hipsOrder: 3,
        minOrder: 3,
        tileWidth: 8,
        formats: ['jpeg'],
        includeAllsky: true,
        includeMoc: false,
        includeIndexHtml: false,
      })

      expect(await target.exists(hipsAllskyPath('jpeg'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps cube Allsky to FITS when requesting fits+png formats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-allsky-cube-'))
    try {
      const target = new NodeFSTarget(dir)
      await convertFitsToHiPS(createInputFitsCube(16, 8, 3), {
        output: target,
        title: 'Cube Allsky',
        creatorDid: 'ivo://fitsjs-ng/tests/allsky/cube',
        hipsOrder: 3,
        minOrder: 3,
        tileWidth: 8,
        formats: ['fits', 'png'],
        includeAllsky: true,
        includeMoc: false,
        includeIndexHtml: false,
      })

      expect(await target.exists(hipsAllskyPath('fits'))).toBe(true)
      expect(await target.exists(hipsAllskyPath('png'))).toBe(false)
      const properties = await target.readText('properties')
      expect(properties).toContain('hips_allsky_restriction')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports HiPS3D generation and tile export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-cube-'))
    try {
      const inputFits = createInputFitsCube(16, 8, 3)
      await convertFitsToHiPS(inputFits, {
        output: new NodeFSTarget(dir),
        title: 'Cube HiPS',
        creatorDid: 'ivo://fitsjs-ng/tests/cube',
        hipsOrder: 1,
        minOrder: 1,
        tileWidth: 8,
        formats: ['fits', 'png'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      const tile = await findFirstTileAny(dir)
      expect(tile).not.toBeNull()

      const tileFits = await convertHiPSToFITS(dir, {
        tile: {
          order: tile!.order,
          ipix: tile!.ipix,
        },
      })
      const parsed = FITS.fromArrayBuffer(tileFits)
      const header = parsed.getHeader()
      expect(header?.getNumber('NAXIS')).toBe(3)
      expect(header?.getNumber('NAXIS3')).toBe(3)

      const propertiesText = await new NodeFSTarget(dir).readText('properties')
      expect(propertiesText).toContain('dataproduct_type')
      expect(propertiesText).toContain('cube')
      expect(propertiesText).toContain('hips_cube_depth')
      expect(propertiesText).toContain('3')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
