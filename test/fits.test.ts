import { describe, it, expect } from 'vitest'
import { FITS } from '../src/fits'
import { Image } from '../src/image'
import { Table } from '../src/table'
import {
  makeSimpleImage,
  makeImageWithTable,
  makeHeaderBlock,
  stringToUint8Array,
  card,
} from './helpers'

describe('FITS', () => {
  it('should parse a simple FITS image from ArrayBuffer', () => {
    const buffer = makeSimpleImage(4, 3, 16, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const fits = FITS.fromArrayBuffer(buffer)

    expect(fits.hdus).toHaveLength(1)
    expect(fits.getHDU()).toBeDefined()
    expect(fits.getHeader()).toBeDefined()
    expect(fits.getDataUnit()).toBeDefined()
    expect(fits.getDataUnit()).toBeInstanceOf(Image)
  })

  it('should return specific HDU by index', () => {
    const buffer = makeSimpleImage(2, 2, 16, [1, 2, 3, 4])
    const fits = FITS.fromArrayBuffer(buffer)

    expect(fits.getHDU(0)).toBeDefined()
    expect(fits.getHDU(99)).toBeUndefined()
  })

  it('should parse a FITS file with multiple HDUs (image + table)', () => {
    const tableRows = [' -3.12 -3.12  0.00  0.00', '  1.50  2.30 -0.59  0.09']
    const tableCols = [
      { name: 'XI', form: 'F6.2' },
      { name: 'ETA', form: 'F6.2' },
      { name: 'XI_CORR', form: 'F6.2' },
      { name: 'ETA_CORR', form: 'F6.2' },
    ]

    const buffer = makeImageWithTable(
      4,
      3,
      16,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      tableRows,
      tableCols,
    )

    const fits = FITS.fromArrayBuffer(buffer)
    expect(fits.hdus).toHaveLength(2)

    const image = fits.getDataUnit(0)
    expect(image).toBeInstanceOf(Image)

    const table = fits.getDataUnit(1)
    expect(table).toBeInstanceOf(Table)
  })

  it('should return first HDU with data when no index given', () => {
    const buffer = makeSimpleImage(2, 2, -32, [1.0, 2.0, 3.0, 4.0])
    const fits = FITS.fromArrayBuffer(buffer)

    const hdu = fits.getHDU()
    expect(hdu).toBeDefined()
    expect(hdu!.hasData()).toBe(true)
  })

  it('should handle primary header with no data', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])
    const headerBytes = stringToUint8Array(headerStr)
    const buffer = new ArrayBuffer(headerBytes.byteLength)
    new Uint8Array(buffer).set(headerBytes)

    const fits = FITS.fromArrayBuffer(buffer)
    expect(fits.hdus).toHaveLength(1)
    expect(fits.hdus[0]!.hasData()).toBe(false)
    expect(fits.getHDU()).toBeUndefined()
  })

  it('should handle fromNodeBuffer', () => {
    const buffer = makeSimpleImage(2, 2, 16, [10, 20, 30, 40])
    const nodeBufferLike = {
      buffer: buffer,
      byteOffset: 0,
      byteLength: buffer.byteLength,
    }

    const fits = FITS.fromNodeBuffer(nodeBufferLike)
    expect(fits.hdus).toHaveLength(1)
    expect(fits.getDataUnit()).toBeInstanceOf(Image)
  })
})
