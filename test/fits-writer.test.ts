import { describe, expect, it } from 'vitest'
import { FITS } from '../src/fits'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../src/fits-writer'

describe('fits-writer', () => {
  it('creates big-endian image bytes for all supported BITPIX values', () => {
    const b8 = createImageBytesFromArray([255], 8)
    expect(Array.from(b8)).toEqual([255])

    const b16 = createImageBytesFromArray([0x0102], 16)
    expect(Array.from(b16)).toEqual([0x01, 0x02])

    const b32 = createImageBytesFromArray([0x01020304], 32)
    expect(Array.from(b32)).toEqual([0x01, 0x02, 0x03, 0x04])

    const b64 = createImageBytesFromArray([BigInt(2)], 64)
    expect(b64.byteLength).toBe(8)
    const b64View = new DataView(b64.buffer)
    expect(b64View.getBigInt64(0, false)).toBe(BigInt(2))

    const f32 = createImageBytesFromArray([1.25], -32)
    expect(new DataView(f32.buffer).getFloat32(0, false)).toBeCloseTo(1.25)

    const f64 = createImageBytesFromArray([Math.PI], -64)
    expect(new DataView(f64.buffer).getFloat64(0, false)).toBeCloseTo(Math.PI)
  })

  it('creates primary image HDUs and extension image HDUs with optional cards', () => {
    const primary = createImageHDU({
      width: 2,
      height: 2,
      bitpix: 16,
      data: createImageBytesFromArray([1, 2, 3, 4], 16),
      bscale: 2,
      bzero: 10,
      extname: 'SCI',
      additionalCards: [{ key: 'ORIGIN', value: "O'HARE" }],
    })
    expect(primary.cards.find((c) => c.key === 'SIMPLE')?.value).toBe(true)
    expect(primary.cards.find((c) => c.key === 'NAXIS')?.value).toBe(2)
    expect(primary.cards.find((c) => c.key === 'BSCALE')?.value).toBe(2)
    expect(primary.cards.find((c) => c.key === 'BZERO')?.value).toBe(10)
    expect(primary.cards.find((c) => c.key === 'EXTNAME')?.value).toBe('SCI')

    const extension = createImageHDU({
      primary: false,
      extensionType: 'IMAGE',
      width: 2,
      height: 2,
      depth: 3,
      bitpix: -32,
      data: createImageBytesFromArray(new Float32Array(12), -32),
    })
    expect(extension.cards.find((c) => c.key === 'XTENSION')?.value).toBe('IMAGE')
    expect(extension.cards.find((c) => c.key === 'NAXIS')?.value).toBe(3)
    expect(extension.cards.find((c) => c.key === 'NAXIS3')?.value).toBe(3)
    expect(extension.cards.find((c) => c.key === 'PCOUNT')?.value).toBe(0)
    expect(extension.cards.find((c) => c.key === 'GCOUNT')?.value).toBe(1)
  })

  it('writes FITS headers/data with END handling and parses back', () => {
    const primary = createImageHDU({
      width: 1,
      height: 1,
      bitpix: 8,
      data: Uint8Array.from([7]),
      additionalCards: [{ key: 'COMMENT', comment: 'no value keyword' }],
    })

    const extension = {
      cards: [
        { key: 'XTENSION', value: 'IMAGE' },
        { key: 'BITPIX', value: 8 },
        { key: 'NAXIS', value: 2 },
        { key: 'NAXIS1', value: 1 },
        { key: 'NAXIS2', value: 1 },
        { key: 'PCOUNT', value: 0 },
        { key: 'GCOUNT', value: 1 },
        { key: 'EXTNAME', value: 'EXT' },
        { key: 'BIGVAL', value: BigInt(123) },
        { key: 'NANKEY', value: Number.NaN },
        { key: 'END' },
      ],
      data: Uint8Array.from([9]),
    }

    const buffer = writeFITS([primary, extension])
    expect(buffer.byteLength % 2880).toBe(0)

    const fits = FITS.fromArrayBuffer(buffer)
    expect(fits.getHDU(0)).toBeDefined()
    expect(fits.getHDU(1)).toBeDefined()

    const firstHeader = fits.getHeader(0)!
    expect(firstHeader.getBoolean('SIMPLE')).toBe(true)
    expect(firstHeader.contains('EXTEND')).toBe(true)

    const secondHeader = fits.getHeader(1)!
    expect(secondHeader.getString('XTENSION')).toBe('IMAGE')
    expect(secondHeader.getString('EXTNAME')).toBe('EXT')
    expect(secondHeader.getNumber('BIGVAL')).toBe(123)
  })

  it('escapes single quotes in string card values', () => {
    const hdu = {
      cards: [
        { key: 'SIMPLE', value: true },
        { key: 'BITPIX', value: 8 },
        { key: 'NAXIS', value: 0 },
        { key: 'AUTHOR', value: "O'HARE" },
      ],
      data: new Uint8Array(0),
    }
    const buffer = writeFITS([hdu])
    const bytes = new Uint8Array(buffer)
    const line = new TextDecoder().decode(bytes.slice(80 * 3, 80 * 4))
    expect(line).toContain("O''HARE")
  })
})
