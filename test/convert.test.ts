import { describe, expect, it } from 'vitest'
import { FITS } from '../src/fits'
import { XISF } from '../src/xisf'
import { XISFWriter } from '../src/xisf-writer'
import { convertFitsToXisf, convertXisfToFits } from '../src/convert'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../src/fits-writer'
import { XISFConversionError } from '../src/xisf-errors'
import type { XISFUnit } from '../src/xisf-types'
import { makeImageWithTable, makeSimpleImage } from './helpers'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function decodeU16LE(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: number[] = []
  for (let i = 0; i < bytes.byteLength; i += 2) {
    out.push(view.getUint16(i, true))
  }
  return out
}

describe('XISF/FITS conversion', () => {
  it('round-trips XISF -> FITS -> XISF for UInt16 images', async () => {
    const raw = new Uint8Array(8)
    const view = new DataView(raw.buffer)
    view.setUint16(0, 0, true)
    view.setUint16(2, 1, true)
    view.setUint16(4, 65535, true)
    view.setUint16(6, 42, true)

    const unit: XISFUnit = {
      metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'convert-test' }],
      images: [
        {
          geometry: [2, 2],
          channelCount: 1,
          sampleFormat: 'UInt16',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: raw.byteLength },
            byteOrder: 'little',
          },
          data: raw,
          properties: [],
          tables: [],
          fitsKeywords: [],
        },
      ],
      standaloneProperties: [{ id: 'Processing:Description', type: 'String', value: 'roundtrip' }],
      standaloneTables: [],
      version: '1.0',
      signature: { present: false, verified: true },
    }

    const xisfBuffer = await XISFWriter.toMonolithic(unit)
    const fitsBuffer = await convertXisfToFits(xisfBuffer)
    const backToXisf = await convertFitsToXisf(fitsBuffer)
    const parsed = await XISF.fromArrayBuffer(backToXisf as ArrayBuffer)

    expect(parsed.unit.images).toHaveLength(1)
    expect(parsed.unit.images[0]!.sampleFormat).toBe('UInt16')
    expect(parsed.unit.images[0]!.geometry).toEqual([2, 2])
    expect(decodeU16LE(parsed.unit.images[0]!.data!)).toEqual([0, 1, 65535, 42])
  })

  it('round-trips Complex32 via FITS BINTABLE wrapper', async () => {
    const complexBytes = new Uint8Array(16)
    const view = new DataView(complexBytes.buffer)
    view.setFloat32(0, 1.5, true)
    view.setFloat32(4, -2.5, true)
    view.setFloat32(8, 3.25, true)
    view.setFloat32(12, 4.75, true)

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
            location: { type: 'attachment', position: 0, size: complexBytes.byteLength },
            byteOrder: 'little',
          },
          data: complexBytes,
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

    const xisfBuffer = await XISFWriter.toMonolithic(unit)
    const fitsBuffer = await convertXisfToFits(xisfBuffer)
    const back = await convertFitsToXisf(fitsBuffer)
    const parsed = await XISF.fromArrayBuffer(back as ArrayBuffer)

    expect(parsed.unit.images[0]!.sampleFormat).toBe('Complex32')
    expect(Array.from(parsed.unit.images[0]!.data!)).toEqual(Array.from(complexBytes))
  })

  it('converts FITS to distributed XISF and reloads via resolver', async () => {
    const fitsBuffer = makeSimpleImage(2, 2, 16, [10, 20, 30, 40])
    const converted = await convertFitsToXisf(fitsBuffer, { distributed: true })

    expect(converted).toHaveProperty('header')
    expect(converted).toHaveProperty('blocks')

    const distributed = converted as { header: Uint8Array; blocks: Record<string, Uint8Array> }
    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(distributed.header), {
      headerDir: '/tmp/convert',
      resourceResolver: {
        resolveURL: async () => {
          throw new Error('not expected')
        },
        resolvePath: async (path) => {
          if (!path.endsWith('/blocks.xisb')) throw new Error(`unexpected path: ${path}`)
          return distributed.blocks['blocks.xisb']!
        },
      },
    })

    expect(parsed.unit.images).toHaveLength(1)
    expect(parsed.unit.images[0]!.geometry).toEqual([2, 2])
    expect(parsed.unit.images[0]!.sampleFormat).toBe('Float64')
  })

  it('rejects non-canonical BITPIX=64 conversions in strict mode', async () => {
    const hdu = createImageHDU({
      width: 2,
      height: 1,
      bitpix: 64,
      data: createImageBytesFromArray([1n, 2n], 64),
    })
    const fits = FITS.fromArrayBuffer(writeFITS([hdu]))

    await expect(convertFitsToXisf(fits, { strictValidation: true })).rejects.toBeInstanceOf(
      XISFConversionError,
    )
  })

  it('preserves FITS keyword comments through FITS -> XISF -> FITS', async () => {
    const hdu = createImageHDU({
      width: 2,
      height: 1,
      bitpix: 16,
      data: createImageBytesFromArray([1, 2], 16),
      additionalCards: [
        { key: 'OBSERVER', value: 'Ada', comment: 'observer name' },
        { key: 'FILTER', value: 'R', comment: 'bandpass' },
      ],
    })
    const fits = writeFITS([hdu])

    const xisf = await convertFitsToXisf(fits)
    const backFits = await convertXisfToFits(xisf as ArrayBuffer, {
      includeXisfMetaExtension: false,
    })
    const parsed = FITS.fromArrayBuffer(backFits)
    const cards = parsed.getHeader()!.getCards()

    expect(cards.find((card) => card.key === 'OBSERVER')?.comment).toBe('observer name')
    expect(cards.find((card) => card.key === 'FILTER')?.comment).toBe('bandpass')
  })

  it('preserves non-image HDUs through FITS -> XISF -> FITS', async () => {
    const source = makeImageWithTable(
      2,
      2,
      16,
      [1, 2, 3, 4],
      ['A0001'],
      [{ name: 'COL1', form: 'A5' }],
    )

    const xisf = await convertFitsToXisf(source)
    const backFits = await convertXisfToFits(xisf as ArrayBuffer, {
      includeXisfMetaExtension: false,
    })
    const parsed = FITS.fromArrayBuffer(backFits)

    expect(parsed.hdus).toHaveLength(2)
    expect(parsed.hdus[1]!.header.extensionType).toBe('TABLE')
    expect(parsed.hdus[1]!.header.getString('TTYPE1')).toBe('COL1')
  })

  it('converts canonical UInt64 FITS payloads losslessly', async () => {
    const hdu = createImageHDU({
      width: 2,
      height: 1,
      bitpix: 64,
      bzero: 9223372036854775808n,
      bscale: 1,
      data: createImageBytesFromArray([5n, 9007199254740995n], 64),
    })
    const fits = writeFITS([hdu])

    const xisfBuffer = await convertFitsToXisf(fits)
    const parsedXisf = await XISF.fromArrayBuffer(xisfBuffer as ArrayBuffer)
    expect(parsedXisf.unit.images[0]!.sampleFormat).toBe('UInt64')

    const view = new DataView(
      parsedXisf.unit.images[0]!.data!.buffer,
      parsedXisf.unit.images[0]!.data!.byteOffset,
    )
    expect(view.getBigUint64(0, true)).toBe(9223372036854775813n)
    expect(view.getBigUint64(8, true)).toBe(9232379236109516803n)
  })
})
