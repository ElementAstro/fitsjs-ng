import { describe, expect, it } from 'vitest'
import { FITS } from '../src/fits'
import { Image } from '../src/image'
import { assembleAllsky, encodeAllsky, splitAllsky } from '../src/hips-allsky'

describe('hips-allsky', () => {
  it('assembles sparse allsky tiles and keeps empty areas as NaN', () => {
    const tiles = new Map<number, Float32Array>([
      [0, Float32Array.from([1, 2, 3])], // missing one value to trigger fallback to NaN
      [5, Float32Array.from([5, 6, 7, 8])],
    ])
    const allsky = assembleAllsky(0, 2, 1, tiles)

    expect(allsky.cols).toBe(4)
    expect(allsky.rows).toBe(3)
    expect(allsky.width).toBe(8)
    expect(allsky.height).toBe(6)
    expect(allsky.data[0]).toBe(1)
    expect(allsky.data[1]).toBe(2)
    expect(Number.isNaN(allsky.data[9]!)).toBe(true)
    expect(Number.isNaN(allsky.data[2]!)).toBe(true)
  })

  it('splits allsky image back into tile map', () => {
    const tiles = new Map<number, Float32Array>([[0, Float32Array.from([1, 2, 3, 4])]])
    const allsky = assembleAllsky(0, 2, 1, tiles)
    const split = splitAllsky(allsky)

    expect(split.size).toBe(12)
    expect(Array.from(split.get(0)!)).toEqual([1, 2, 3, 4])
    expect(Number.isNaN(split.get(1)![0]!)).toBe(true)
  })

  it('falls back to NaN when split source indexing is out of range', () => {
    const split = splitAllsky({
      order: 0,
      tileWidth: 2,
      depth: 1,
      width: 1,
      height: 1,
      cols: 1,
      rows: 1,
      data: Float32Array.from([123]),
    })
    expect(Number.isNaN(split.get(11)![3]!)).toBe(true)
  })

  it('encodes assembled allsky grid as FITS tile bytes', () => {
    const tiles = new Map<number, Float32Array>([[0, Float32Array.from([1, 2, 3, 4])]])
    const encoded = encodeAllsky(0, 'fits', 'equatorial', 2, 1, tiles)
    expect(encoded.byteLength).toBeGreaterThan(0)

    const parsed = FITS.fromArrayBuffer(encoded.buffer.slice(0))
    const image = parsed.getDataUnit()
    expect(image).toBeInstanceOf(Image)
    expect((image as Image).width).toBe(8)
    expect((image as Image).height).toBe(8)
  })
})
