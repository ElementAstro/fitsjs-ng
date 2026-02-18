import { describe, expect, it } from 'vitest'
import { downsampleTile, reprojectToHiPSTile, samplePlane } from '../src/hips-reproject'

describe('hips-reproject', () => {
  it('samples planes using nearest and handles out-of-bounds with blank values', () => {
    const plane = Float64Array.from([1, 2, 3, 4])
    expect(samplePlane(plane, 2, 2, 0.49, 1.49, 'nearest', -1)).toBe(3)
    expect(samplePlane(plane, 2, 2, -10, 1, 'nearest', -1)).toBe(-1)
  })

  it('samples planes using bilinear interpolation', () => {
    const plane = Float64Array.from([1, 2, 3, 4])
    const sampled = samplePlane(plane, 2, 2, 0.5, 0.5, 'bilinear', Number.NaN)
    expect(sampled).toBeCloseTo(2.5, 10)
  })

  it('uses bicubic interpolation and falls back to bilinear when neighborhood has NaN', () => {
    const gradient = new Float64Array(16)
    for (let i = 0; i < gradient.length; i++) gradient[i] = i
    const bicubic = samplePlane(gradient, 4, 4, 1.5, 1.5, 'bicubic', -1)
    expect(Number.isFinite(bicubic)).toBe(true)

    const withNaN = gradient.slice()
    withNaN[0] = Number.NaN
    const fallback = samplePlane(withNaN, 4, 4, 1.1, 1.1, 'bicubic', -1)
    expect(Number.isFinite(fallback)).toBe(true)
  })

  it('reprojects image planes into HiPS tile pixels', () => {
    const plane = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    const output = reprojectToHiPSTile(
      {
        width: 4,
        height: 4,
        depth: 1,
        planes: [plane],
        wcs: {
          definition: {
            ctype1: 'RA---CAR',
            ctype2: 'DEC--CAR',
            crpix1: 1,
            crpix2: 1,
            crval1: 0,
            crval2: 0,
          },
          pixelToWorld: () => ({ lon: 0, lat: 0 }),
          worldToPixel: () => ({ x: 1, y: 1 }),
        },
      },
      { order: 0, ipix: 0, frame: 'equatorial', format: 'fits' },
      2,
      { interpolation: 'nearest', blankValue: -999 },
    )

    expect(output).toHaveLength(4)
    expect(Array.from(output)).toEqual([5, 5, 5, 5])
  })

  it('downsamples tiles in mean and nearest modes with depth support', () => {
    const tile = Float32Array.from([
      // z0
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      // z1
      16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ])

    const mean = downsampleTile(tile, 4, 2, 'mean')
    expect(mean).toHaveLength(8)
    expect(mean[0]).toBeCloseTo(3.5)
    expect(mean[4]).toBeCloseTo(13.5)

    const nearest = downsampleTile(tile, 4, 2, 'nearest')
    expect(Array.from(nearest)).toEqual([1, 3, 9, 11, 16, 14, 8, 6])
  })

  it('outputs NaN for empty mean neighborhoods', () => {
    const tile = Float32Array.from([Number.NaN, Number.NaN, Number.NaN, Number.NaN])
    const out = downsampleTile(tile, 2, 1, 'mean')
    expect(Number.isNaN(out[0]!)).toBe(true)
  })
})
