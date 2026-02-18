import { describe, expect, it } from 'vitest'
import {
  extensionToFormat,
  formatToExtension,
  hipsAllskyPath,
  hipsDirIndex,
  hipsTilePath,
  parseHiPSTilePath,
} from '../src/hips-path'

describe('hips-path', () => {
  it('builds standard tile paths', () => {
    expect(hipsDirIndex(12345)).toBe(10000)
    expect(
      hipsTilePath({
        order: 5,
        ipix: 12345,
        frame: 'equatorial',
        format: 'fits',
      }),
    ).toBe('Norder5/Dir10000/Npix12345.fits')
  })

  it('supports hips3d tile names', () => {
    expect(
      hipsTilePath({
        order: 6,
        spectralOrder: 2,
        ipix: 12345,
        spectralIndex: 34,
        frame: 'equatorial',
        format: 'jpeg',
      }),
    ).toBe('Norder6_2/Dir10000_30/Npix12345_34.jpg')
  })

  it('parses tile paths', () => {
    const parsed = parseHiPSTilePath('Norder6/Dir10000/Npix12345.jpg')
    expect(parsed).toEqual({
      order: 6,
      ipix: 12345,
      frame: 'equatorial',
      format: 'jpeg',
    })
  })

  it('handles format mapping and allsky naming', () => {
    expect(formatToExtension('jpeg')).toBe('jpg')
    expect(extensionToFormat('jpg')).toBe('jpeg')
    expect(hipsAllskyPath('fits')).toBe('Norder3/Allsky.fits')
  })
})
