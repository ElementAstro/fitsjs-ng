import { describe, it, expect } from 'vitest'
import { HDU } from '../../src/fits/hdu'
import { Header } from '../../src/fits/header'
import { DataUnit } from '../../src/fits/data-unit'
import { makeHeaderBlock, card } from '../shared/helpers'

describe('HDU', () => {
  function makeHeader(cards: string[]): Header {
    return new Header(makeHeaderBlock(cards))
  }

  it('should store header and report no data when dataunit is undefined', () => {
    const header = makeHeader([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])
    const hdu = new HDU(header)
    expect(hdu.header).toBe(header)
    expect(hdu.data).toBeUndefined()
    expect(hdu.hasData()).toBe(false)
  })

  it('should store header and data unit', () => {
    const header = makeHeader([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                    2 / Width'),
      card('NAXIS2  =                    2 / Height'),
    ])
    const data = new ArrayBuffer(8)
    const dataunit = new DataUnit(header, data)
    const hdu = new HDU(header, dataunit)

    expect(hdu.header).toBe(header)
    expect(hdu.data).toBe(dataunit)
    expect(hdu.hasData()).toBe(true)
  })
})
