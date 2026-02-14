import { describe, it, expect } from 'vitest'
import { FITS } from '../src/fits'
import { Image } from '../src/image'
import { makeSimpleImage, makeSimpleImageWithBzero } from './helpers'

describe('Image', () => {
  it('should read an 8-bit integer image', () => {
    const width = 4
    const height = 3
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    const buffer = makeSimpleImage(width, height, 8, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    expect(fits.hdus).toHaveLength(1)

    const image = fits.getDataUnit() as Image
    expect(image).toBeInstanceOf(Image)
    expect(image.bitpix).toBe(8)
    expect(image.width).toBe(width)
    expect(image.height).toBe(height)
  })

  it('should read pixel values from an 8-bit image', async () => {
    const width = 4
    const height = 3
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    const buffer = makeSimpleImage(width, height, 8, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBe(10)
    expect(image.getPixel(frame, 1, 0)).toBe(20)
    expect(image.getPixel(frame, 3, 0)).toBe(40)
    expect(image.getPixel(frame, 0, 1)).toBe(50)
    expect(image.getPixel(frame, 3, 2)).toBe(120)
  })

  it('should read pixel values from a 16-bit image', async () => {
    const width = 3
    const height = 2
    const pixels = [1000, -500, 32767, -32768, 0, 12345]
    const buffer = makeSimpleImage(width, height, 16, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBe(1000)
    expect(image.getPixel(frame, 1, 0)).toBe(-500)
    expect(image.getPixel(frame, 2, 0)).toBe(32767)
    expect(image.getPixel(frame, 0, 1)).toBe(-32768)
    expect(image.getPixel(frame, 1, 1)).toBe(0)
    expect(image.getPixel(frame, 2, 1)).toBe(12345)
  })

  it('should read pixel values from a 32-bit integer image', async () => {
    const width = 2
    const height = 2
    const pixels = [100000, -200000, 0, 2147483647]
    const buffer = makeSimpleImage(width, height, 32, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBe(100000)
    expect(image.getPixel(frame, 1, 0)).toBe(-200000)
    expect(image.getPixel(frame, 0, 1)).toBe(0)
    expect(image.getPixel(frame, 1, 1)).toBe(2147483647)
  })

  it('should read pixel values from a 32-bit float image', async () => {
    const width = 2
    const height = 2
    const pixels = [1.5, -3.14, 0.0, 1e10]
    const buffer = makeSimpleImage(width, height, -32, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBeCloseTo(1.5, 5)
    expect(image.getPixel(frame, 1, 0)).toBeCloseTo(-3.14, 5)
    expect(image.getPixel(frame, 0, 1)).toBeCloseTo(0.0, 5)
    expect(image.getPixel(frame, 1, 1)).toBeCloseTo(1e10, -5)
  })

  it('should read pixel values from a 64-bit float image', async () => {
    const width = 2
    const height = 2
    const pixels = [1.23456789012345, -9.87654321098765, 0.0, 1e100]
    const buffer = makeSimpleImage(width, height, -64, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBeCloseTo(1.23456789012345, 12)
    expect(image.getPixel(frame, 1, 0)).toBeCloseTo(-9.87654321098765, 12)
    expect(image.getPixel(frame, 0, 1)).toBeCloseTo(0.0, 12)
    expect(image.getPixel(frame, 1, 1)).toBeCloseTo(1e100, 85)
  })

  it('should compute extent (min/max)', async () => {
    const width = 3
    const height = 2
    const pixels = [5, 1, 9, 3, 7, 2]
    const buffer = makeSimpleImage(width, height, 16, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    const [min, max] = image.getExtent(frame)
    expect(min).toBe(1)
    expect(max).toBe(9)
  })

  it('should handle NaN in extent computation', async () => {
    const { getExtent } = await import('../src/image-utils')
    const arr = new Float32Array([NaN, 5, NaN, 3, NaN, 8])
    const [min, max] = getExtent(arr)
    expect(min).toBe(3)
    expect(max).toBe(8)
  })

  it('should not produce negative values for BITPIX=16 with BZERO=32768 (unsigned 16-bit)', async () => {
    // BZERO=32768 is the standard way to store unsigned 16-bit data in FITS.
    // Raw signed values are written; physical = BZERO + BSCALE * raw.
    const width = 2
    const height = 2
    const rawPixels = [0, -32768, 32767, -1]
    const buffer = makeSimpleImageWithBzero(width, height, 16, rawPixels, 32768, 1)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    // physical = 32768 + 1 * raw
    expect(image.getPixel(frame, 0, 0)).toBe(32768) // 32768 + 0
    expect(image.getPixel(frame, 1, 0)).toBe(0) // 32768 + (-32768)
    expect(image.getPixel(frame, 0, 1)).toBe(65535) // 32768 + 32767
    expect(image.getPixel(frame, 1, 1)).toBe(32767) // 32768 + (-1)

    const [min, max] = image.getExtent(frame)
    expect(min).toBe(0)
    expect(max).toBe(65535)
  })

  it('should apply BZERO correctly for BITPIX=8', async () => {
    const width = 2
    const height = 1
    const rawPixels = [0, 255]
    const buffer = makeSimpleImageWithBzero(width, height, 8, rawPixels, 100, 1)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBe(100) // 100 + 0
    expect(image.getPixel(frame, 1, 0)).toBe(355) // 100 + 255
  })

  it('should apply BZERO correctly for BITPIX=32', async () => {
    const width = 2
    const height = 1
    const rawPixels = [0, -2147483648]
    const buffer = makeSimpleImageWithBzero(width, height, 32, rawPixels, 2147483648, 1)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    const frame = await image.getFrame(0)

    expect(image.getPixel(frame, 0, 0)).toBe(2147483648) // 2^31 + 0
    expect(image.getPixel(frame, 1, 0)).toBe(0) // 2^31 + (-2^31)
  })

  it('should detect data cubes', () => {
    // A data cube would need NAXIS=3, NAXIS3>1
    // We test via Image constructor properties
    const width = 2
    const height = 2
    const pixels = [1, 2, 3, 4]
    const buffer = makeSimpleImage(width, height, 16, pixels)

    const fits = FITS.fromArrayBuffer(buffer)
    const image = fits.getDataUnit() as Image
    expect(image.isDataCube()).toBe(false)
  })
})
