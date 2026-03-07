import { describe, it, expect } from 'vitest'
import { FITS } from '../../src/fits'
import { parseBuffer } from '../../src/fits/parser'
import { Image } from '../../src/fits/image'
import { Table } from '../../src/fits/table'
import { makeSimpleImage, makeImageWithTable } from '../shared/helpers'

describe('dataUnitStorage=view', () => {
  it('should parse Image in view mode without copying the data unit buffer', async () => {
    const width = 4
    const height = 3
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    const buffer = makeSimpleImage(width, height, 8, pixels)

    const fits = FITS.fromArrayBuffer(buffer, { dataUnitStorage: 'view' })
    const image = fits.getDataUnit() as Image

    expect(image).toBeInstanceOf(Image)
    expect(image.buffer).toBe(buffer)

    const frame = await image.getFrame(0)
    expect(frame).toBeInstanceOf(Uint8Array)
    expect((frame as Uint8Array).buffer).toBe(buffer)
    expect((frame as Uint8Array).byteOffset).toBeGreaterThan(0)
    expect(image.getPixel(frame, 0, 0)).toBe(10)
    expect(image.getPixel(frame, 3, 2)).toBe(120)
  })

  it('should fall back to copy mode for non-Image data units and emit a warning', () => {
    const warnings: string[] = []
    const onWarning = (message: string) => warnings.push(message)

    const tableRows = [' 1.00  2.00']
    const tableCols = [
      { name: 'X', form: 'F5.2' },
      { name: 'Y', form: 'F5.2' },
    ]
    const buffer = makeImageWithTable(2, 2, 16, [1, 2, 3, 4], tableRows, tableCols)

    const hdus = parseBuffer(buffer, { dataUnitStorage: 'view', onWarning })
    expect(hdus).toHaveLength(2)

    expect(hdus[0]!.data).toBeInstanceOf(Image)
    expect((hdus[0]!.data as Image).buffer).toBe(buffer)

    expect(hdus[1]!.data).toBeInstanceOf(Table)
    expect((hdus[1]!.data as Table).buffer).not.toBe(buffer)

    expect(warnings.some((w) => w.includes('falling back to copy') && w.includes('Table'))).toBe(
      true,
    )
  })
})
