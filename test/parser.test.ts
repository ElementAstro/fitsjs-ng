import { describe, it, expect } from 'vitest'
import { parseBuffer, parseBlob } from '../src/parser'
import { Image } from '../src/image'
import { Table } from '../src/table'
import {
  makeSimpleImage,
  makeImageWithTable,
  makeHeaderBlock,
  stringToUint8Array,
  card,
} from './helpers'

describe('parseBuffer', () => {
  it('should parse a single-HDU image', () => {
    const buffer = makeSimpleImage(4, 3, 16, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const hdus = parseBuffer(buffer)
    expect(hdus).toHaveLength(1)
    expect(hdus[0]!.header.isPrimary()).toBe(true)
    expect(hdus[0]!.data).toBeInstanceOf(Image)
  })

  it('should parse multiple HDUs', () => {
    const tableRows = [' 1.00  2.00']
    const tableCols = [
      { name: 'X', form: 'F5.2' },
      { name: 'Y', form: 'F5.2' },
    ]
    const buffer = makeImageWithTable(2, 2, 16, [1, 2, 3, 4], tableRows, tableCols)
    const hdus = parseBuffer(buffer)
    expect(hdus).toHaveLength(2)
    expect(hdus[0]!.data).toBeInstanceOf(Image)
    expect(hdus[1]!.data).toBeInstanceOf(Table)
  })

  it('should handle header-only FITS (NAXIS=0)', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])
    const bytes = stringToUint8Array(headerStr)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const hdus = parseBuffer(buffer)
    expect(hdus).toHaveLength(1)
    expect(hdus[0]!.hasData()).toBe(false)
    expect(hdus[0]!.data).toBeUndefined()
  })

  it('should return empty array for empty buffer', () => {
    const hdus = parseBuffer(new ArrayBuffer(0))
    expect(hdus).toHaveLength(0)
  })

  it('should return empty array for buffer smaller than one block', () => {
    const hdus = parseBuffer(new ArrayBuffer(100))
    expect(hdus).toHaveLength(0)
  })
})

describe('parseBlob', () => {
  it('should parse a blob the same as a buffer', async () => {
    const buffer = makeSimpleImage(2, 2, 16, [10, 20, 30, 40])
    const blob = new Blob([buffer])
    const hdus = await parseBlob(blob)
    expect(hdus).toHaveLength(1)
    expect(hdus[0]!.data).toBeInstanceOf(Image)
  })
})
