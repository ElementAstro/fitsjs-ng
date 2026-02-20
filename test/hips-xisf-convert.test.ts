import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FITS } from '../src/fits'
import { convertXisfToFits } from '../src/convert'
import { convertFitsToHiPS } from '../src/hips-build'
import { convertHiPSToXisf, convertXisfToHiPS } from '../src/hips-xisf-convert'
import { NodeFSTarget } from '../src/storage-target'
import { XISF } from '../src/xisf'
import { XISFConversionError } from '../src/xisf-errors'
import { XISFWriter } from '../src/xisf-writer'
import type { XISFUnit } from '../src/xisf-types'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../src/fits-writer'

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

function u16le(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i]!, true)
  }
  return out
}

describe('hips-xisf-convert', () => {
  it('converts XISF image index to HiPS output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-xisf-to-hips-'))
    try {
      const unit: XISFUnit = {
        metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'hips-xisf-test' }],
        images: [
          {
            id: 'first',
            geometry: [2, 2],
            channelCount: 1,
            sampleFormat: 'UInt16',
            pixelStorage: 'Planar',
            colorSpace: 'Gray',
            dataBlock: {
              location: { type: 'attachment', position: 0, size: 8 },
              byteOrder: 'little',
            },
            data: u16le([1, 2, 3, 4]),
            properties: [],
            tables: [],
            fitsKeywords: [],
          },
          {
            id: 'second',
            geometry: [2, 2],
            channelCount: 1,
            sampleFormat: 'UInt16',
            pixelStorage: 'Planar',
            colorSpace: 'Gray',
            dataBlock: {
              location: { type: 'attachment', position: 0, size: 8 },
              byteOrder: 'little',
            },
            data: u16le([50, 60, 70, 80]),
            properties: [],
            tables: [],
            fitsKeywords: [],
          },
        ],
        standaloneProperties: [],
        standaloneTables: [],
        version: '1.0',
        signature: { present: false, verified: true },
      }
      const xisf = await XISFWriter.toMonolithic(unit)

      const result = await convertXisfToHiPS(xisf, {
        output: new NodeFSTarget(dir),
        imageIndex: 1,
        title: 'XISF Index',
        creatorDid: 'ivo://fitsjs-ng/tests/xisf-index',
        hipsOrder: 1,
        minOrder: 0,
        tileWidth: 8,
        formats: ['fits'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })
      expect(result.generatedTiles).toBeGreaterThan(0)
      const props = await new NodeFSTarget(dir).readText('properties')
      expect(props).toContain('obs_title')
      expect(props).toContain('XISF Index')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('converts HiPS to XISF (cutout and map modes)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-to-xisf-'))
    try {
      await convertFitsToHiPS(createInputFits(32, 16), {
        output: new NodeFSTarget(dir),
        title: 'HiPS Source',
        creatorDid: 'ivo://fitsjs-ng/tests/hips-to-xisf',
        hipsOrder: 1,
        minOrder: 0,
        tileWidth: 8,
        formats: ['fits'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      const cutoutXisf = await convertHiPSToXisf(dir, {
        cutout: { width: 8, height: 8, ra: 0, dec: 0, fov: 1 },
      })
      const parsedCutout = await XISF.fromArrayBuffer(cutoutXisf as ArrayBuffer)
      expect(parsedCutout.unit.images.length).toBeGreaterThan(0)

      const mapXisf = await convertHiPSToXisf(dir, {
        map: { order: 0, ordering: 'NESTED', columnName: 'SIGNAL' },
      })
      const parsedMap = await XISF.fromArrayBuffer(mapXisf as ArrayBuffer)
      expect(parsedMap.unit.images).toHaveLength(0)

      const restoredFits = await convertXisfToFits(mapXisf as ArrayBuffer, {
        includeXisfMetaExtension: false,
      })
      const fits = FITS.fromArrayBuffer(restoredFits)
      expect(fits.hdus.length).toBeGreaterThan(1)
      expect(fits.hdus[1]!.header.extensionType).toBe('BINTABLE')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects complex XISF images for HiPS conversion', async () => {
    const complex = new Uint8Array(16)
    new DataView(complex.buffer).setFloat32(0, 1.5, true)
    const unit: XISFUnit = {
      metadata: [],
      images: [
        {
          geometry: [2, 1],
          channelCount: 1,
          sampleFormat: 'Complex32',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: complex.byteLength },
            byteOrder: 'little',
          },
          data: complex,
          properties: [],
          tables: [],
          fitsKeywords: [],
        },
      ],
      standaloneProperties: [],
      standaloneTables: [],
      version: '1.0',
      signature: { present: false, verified: true },
    }
    const xisf = await XISFWriter.toMonolithic(unit)
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-xisf-complex-'))
    try {
      await expect(
        convertXisfToHiPS(xisf, {
          output: new NodeFSTarget(dir),
          title: 'Complex',
          creatorDid: 'ivo://fitsjs-ng/tests/complex',
          hipsOrder: 0,
          tileWidth: 8,
          formats: ['fits'],
        }),
      ).rejects.toBeInstanceOf(XISFConversionError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects out-of-range XISF imageIndex when converting to HiPS', async () => {
    const unit: XISFUnit = {
      metadata: [],
      images: [
        {
          geometry: [2, 1],
          channelCount: 1,
          sampleFormat: 'UInt16',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: 4 },
            byteOrder: 'little',
          },
          data: u16le([1, 2]),
          properties: [],
          tables: [],
          fitsKeywords: [],
        },
      ],
      standaloneProperties: [],
      standaloneTables: [],
      version: '1.0',
      signature: { present: false, verified: true },
    }
    const xisf = await XISFWriter.toMonolithic(unit)
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-xisf-index-range-'))
    try {
      await expect(
        convertXisfToHiPS(xisf, {
          output: new NodeFSTarget(dir),
          imageIndex: 2,
          title: 'Out of range',
          creatorDid: 'ivo://fitsjs-ng/tests/out-of-range',
          hipsOrder: 0,
          tileWidth: 8,
          formats: ['fits'],
        }),
      ).rejects.toBeInstanceOf(XISFConversionError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('converts HiPS to distributed XISF when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-to-xisf-dist-'))
    try {
      await convertFitsToHiPS(createInputFits(16, 16), {
        output: new NodeFSTarget(dir),
        title: 'HiPS Distributed',
        creatorDid: 'ivo://fitsjs-ng/tests/hips-distributed',
        hipsOrder: 1,
        minOrder: 0,
        tileWidth: 8,
        formats: ['fits'],
        includeAllsky: false,
        includeMoc: false,
        includeIndexHtml: false,
      })

      const distributed = await convertHiPSToXisf(dir, {
        distributed: true,
        cutout: { width: 8, height: 8, ra: 0, dec: 0, fov: 1 },
      })
      expect(distributed).toHaveProperty('header')
      expect(distributed).toHaveProperty('blocks')

      const asDistributed = distributed as {
        header: Uint8Array
        blocks: Record<string, Uint8Array>
      }
      expect(asDistributed.header.byteLength).toBeGreaterThan(0)
      expect(Object.keys(asDistributed.blocks).length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
