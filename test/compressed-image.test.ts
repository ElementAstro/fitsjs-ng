import { describe, expect, it } from 'vitest'
import { CompressedImage } from '../src/compressed-image'
import { NULL_VALUE, ZERO_VALUE } from '../src/constants'
import { DecompressionError } from '../src/errors'

class HeaderStub {
  constructor(private readonly values: Record<string, string | number>) {}

  contains(key: string): boolean {
    return key in this.values
  }

  getNumber(key: string, fallback?: number): number {
    const value = this.values[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '') return Number(value)
    return fallback ?? 0
  }

  getString(key: string, fallback?: string): string {
    const value = this.values[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return fallback ?? ''
  }
}

function makeCompressedHeader(overrides: Record<string, string | number> = {}): HeaderStub {
  return new HeaderStub({
    NAXIS1: 8,
    NAXIS2: 1,
    TFIELDS: 1,
    TTYPE1: 'COMPRESSED_DATA',
    TFORM1: '1PB',
    PCOUNT: 2,
    ZCMPTYPE: 'RICE_1',
    ZBITPIX: 8,
    ZNAXIS: 2,
    ZNAXIS1: 4,
    ZNAXIS2: 1,
    ZDITHER0: 1,
    ZQUANTIZ: 'LINEAR_SCALING',
    BZERO: 0,
    BSCALE: 1,
    ZNAME1: 'BYTEPIX',
    ZVAL1: 1,
    ZNAME2: 'BLOCKSIZE',
    ZVAL2: 4,
    ...overrides,
  })
}

function makeRowAndHeap(heapBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + heapBytes.byteLength)
  const view = new DataView(out.buffer)
  view.setInt32(0, heapBytes.byteLength, false)
  view.setInt32(4, 0, false)
  out.set(heapBytes, 8)
  return out
}

describe('compressed-image', () => {
  it('decompresses a simple Rice tile from buffer-backed table rows', async () => {
    const bytes = makeRowAndHeap(Uint8Array.from([42, 0x00])) // constant tile
    const image = new CompressedImage(makeCompressedHeader() as never, bytes.buffer)
    const frame = await image.getFrame()

    expect(image.zcmptype).toBe('RICE_1')
    expect(image.width).toBe(4)
    expect(image.height).toBe(1)
    expect(Array.from(frame)).toEqual([42, 42, 42, 42])
    expect(image.getExtent(frame)).toEqual([42, 42])
    expect(image.getPixel(frame, 2, 0)).toBe(42)
  })

  it('loads heap from blob-backed source when needed', async () => {
    const bytes = makeRowAndHeap(Uint8Array.from([42, 0x00]))
    const image = new CompressedImage(makeCompressedHeader() as never, new Blob([bytes]))
    const frame = await image.getFrame(0)
    expect(Array.from(frame)).toEqual([42, 42, 42, 42])
  })

  it('throws for GZIP compressed data accessors and unsupported BYTEPIX typed arrays', () => {
    const gzipHeader = makeCompressedHeader({
      TTYPE1: 'GZIP_COMPRESSED_DATA',
      PCOUNT: 0,
    })
    const gzipImage = new CompressedImage(gzipHeader as never, new ArrayBuffer(8))
    expect(() =>
      (gzipImage as unknown as { accessors: Array<(v: DataView, o: number) => [unknown, number]> })
        .accessors[0]!(new DataView(new ArrayBuffer(8)), 0),
    ).toThrow(DecompressionError)

    const invalidBytepixHeader = makeCompressedHeader({ ZVAL1: 3 })
    const invalid = new CompressedImage(
      invalidBytepixHeader as never,
      makeRowAndHeap(Uint8Array.from([1, 2])).buffer,
    )
    expect(() =>
      (invalid as unknown as { accessors: Array<(v: DataView, o: number) => [unknown, number]> })
        .accessors[0]!(new DataView(makeRowAndHeap(Uint8Array.from([1, 2])).buffer), 0),
    ).toThrow('No typed array for bytepix')
  })

  it('handles NULL/ZERO values and subtractive dithering branches', () => {
    const fake = Object.create(CompressedImage.prototype) as CompressedImage & {
      accessors: Array<(view: DataView, offset: number) => [unknown, number]>
      columns: string[]
    }

    Object.assign(fake, {
      width: 3,
      height: 1,
      accessors: [
        () => [Int32Array.from([NULL_VALUE, ZERO_VALUE, 5]), 0],
        () => [2, 0], // ZSCALE
        () => [10, 0], // ZZERO
      ],
      columns: ['COMPRESSED_DATA', 'ZSCALE', 'ZZERO'],
      zquantiz: 'SUBTRACTIVE_DITHER_1',
      zdither: 1,
      bscale: 1,
      bzero: 0,
    })

    const out = (
      fake as unknown as { _getRows(buffer: ArrayBuffer, nRows: number): Float32Array }
    )._getRows(new ArrayBuffer(0), 1)
    expect(Number.isNaN(out[0]!)).toBe(true)
    expect(out[1]).toBe(0)
    expect(Number.isFinite(out[2]!)).toBe(true)
  })

  it('handles random index wrap-around in dithering mode', () => {
    const pixelCount = 10_050
    const fake = Object.create(CompressedImage.prototype) as CompressedImage & {
      accessors: Array<(view: DataView, offset: number) => [unknown, number]>
      columns: string[]
    }

    Object.assign(fake, {
      width: pixelCount,
      height: 1,
      accessors: [() => [new Int32Array(pixelCount).fill(1), 0]],
      columns: ['COMPRESSED_DATA'],
      zquantiz: 'SUBTRACTIVE_DITHER_2',
      zdither: 1,
      bscale: 1,
      bzero: 0,
    })

    const out = (
      fake as unknown as { _getRows(buffer: ArrayBuffer, nRows: number): Float32Array }
    )._getRows(new ArrayBuffer(0), 1)
    expect(out).toHaveLength(pixelCount)
    expect(Number.isFinite(out[pixelCount - 1]!)).toBe(true)
  })

  it('throws when getFrame is called without heap and blob', async () => {
    const fake = Object.create(CompressedImage.prototype) as CompressedImage & {
      heap?: ArrayBuffer
      blob?: Blob
    }
    fake.heap = undefined
    fake.blob = undefined
    await expect(
      (fake as unknown as { getFrame(index?: number): Promise<Float32Array> }).getFrame(0),
    ).rejects.toThrow('No data source available')
  })
})
