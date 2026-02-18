import { describe, expect, it } from 'vitest'
import {
  createHiPSTileHeader,
  createLinearWCS,
  estimateOrderFromImageResolution,
  inferFrameFromCType,
  readLinearWCSFromHeader,
  readWCSFromCards,
  tileCenterLonLat,
  tilePixelLonLat,
} from '../src/hips-wcs'

describe('hips-wcs', () => {
  it('infers coordinate frame from CTYPE keywords', () => {
    expect(inferFrameFromCType('GLON-HPX', 'GLAT-HPX')).toBe('galactic')
    expect(inferFrameFromCType('ELON-HPX', 'ELAT-HPX')).toBe('ecliptic')
    expect(inferFrameFromCType('RA---HPX', 'DEC--HPX')).toBe('equatorial')
  })

  it('builds WCS with CD matrix and round-trips pixel/world coordinates', () => {
    const wcs = createLinearWCS({
      ctype1: 'RA---TAN',
      ctype2: 'DEC--TAN',
      crpix1: 10,
      crpix2: 20,
      crval1: 120,
      crval2: -10,
      cd11: -0.01,
      cd12: 0,
      cd21: 0,
      cd22: 0.01,
    })

    const world = wcs.pixelToWorld(9, 19)
    expect(world.lon).toBeCloseTo(120, 10)
    expect(world.lat).toBeCloseTo(-10, 10)
    const pixel = wcs.worldToPixel(world.lon, world.lat)
    expect(pixel.x).toBeCloseTo(9, 10)
    expect(pixel.y).toBeCloseTo(19, 10)
  })

  it('falls back to CDELT/CROTA when CD is not provided', () => {
    const wcs = createLinearWCS({
      ctype1: 'RA---CAR',
      ctype2: 'DEC--CAR',
      crpix1: 1,
      crpix2: 1,
      crval1: 0,
      crval2: 0,
      cdelt1: -2,
      cdelt2: 2,
      crota2: 0,
    })
    const world = wcs.pixelToWorld(0, 0)
    expect(world.lon).toBeCloseTo(0)
    expect(world.lat).toBeCloseTo(0)
  })

  it('rejects singular WCS matrices', () => {
    expect(() =>
      createLinearWCS({
        ctype1: 'RA---TAN',
        ctype2: 'DEC--TAN',
        crpix1: 1,
        crpix2: 1,
        crval1: 0,
        crval2: 0,
        cd11: 1,
        cd12: 0,
        cd21: 2,
        cd22: 0,
      }),
    ).toThrow('singular')
  })

  it('reads linear WCS from header-like objects and card records', () => {
    const fromHeader = readLinearWCSFromHeader({
      getNumber(key, fallback = 0) {
        const numbers: Record<string, number> = {
          CRPIX1: 2,
          CRPIX2: 3,
          CRVAL1: 10,
          CRVAL2: 11,
          CDELT1: -0.5,
          CDELT2: 0.5,
        }
        return numbers[key] ?? fallback
      },
      getString(key, fallback = '') {
        const strings: Record<string, string> = { CTYPE1: 'RA---CAR', CTYPE2: 'DEC--CAR' }
        return strings[key] ?? fallback
      },
    })
    expect(fromHeader.definition.ctype1).toBe('RA---CAR')

    const fromCards = readWCSFromCards({
      CTYPE1: 'RA---TAN',
      CTYPE2: 'DEC--TAN',
      CRPIX1: '5',
      CRPIX2: 6,
      CRVAL1: '180',
      CRVAL2: '-30',
      CDELT1: '-0.1',
      CDELT2: 0.1,
      CROTA2: 5,
    })
    expect(fromCards.definition.crpix1).toBe(5)
    expect(fromCards.definition.crpix2).toBe(6)
  })

  it('estimates order and generates HiPS tile coordinate helpers', () => {
    expect(estimateOrderFromImageResolution(512, 512, 512)).toBe(0)
    expect(estimateOrderFromImageResolution(4096, 1024, 512)).toBe(3)
    expect(estimateOrderFromImageResolution(1_000_000_000, 1_000_000_000, 1)).toBe(13)

    const meta = { order: 0, ipix: 0, frame: 'equatorial' as const, format: 'fits' as const }
    const center = tileCenterLonLat(meta)
    const px = tilePixelLonLat(meta, 0, 0, 64)
    expect(Number.isFinite(center.lon)).toBe(true)
    expect(Number.isFinite(center.lat)).toBe(true)
    expect(Number.isFinite(px.lon)).toBe(true)
    expect(Number.isFinite(px.lat)).toBe(true)
  })

  it('creates HiPS tile FITS headers with optional spectral cards', () => {
    const cards = createHiPSTileHeader(
      { order: 2, ipix: 7, frame: 'galactic', format: 'fits', spectralOrder: 3, spectralIndex: 4 },
      64,
      2,
    )
    const keys = cards.map((c) => c.key)
    expect(keys).toContain('CTYPE1')
    expect(keys).toContain('CTYPE2')
    expect(keys).toContain('ORDER')
    expect(keys).toContain('NPIX')
    expect(keys).toContain('FORDER')
    expect(keys).toContain('FPIX')
    expect(keys).toContain('NAXIS3')
  })
})
