import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import {
  CompressedImage,
  getCompressedImageDecoderProvider,
  setCompressedImageDecoderProvider,
} from '../../src/fits/compressed-image'
import { NULL_VALUE, ZERO_VALUE } from '../../src/core/constants'

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

function makeRowAndHeap(
  heapBytes: Uint8Array,
  heapElementLength: number = heapBytes.byteLength,
): Uint8Array {
  const out = new Uint8Array(8 + heapBytes.byteLength)
  const view = new DataView(out.buffer)
  view.setInt32(0, heapElementLength, false)
  view.setInt32(4, 0, false)
  out.set(heapBytes, 8)
  return out
}

function decodeFirstTile(
  image: CompressedImage,
  heapBytes: Uint8Array,
  heapElementLength?: number,
): unknown {
  return (image as unknown as { accessors: Array<(v: DataView, o: number) => [unknown, number]> })
    .accessors[0]!(new DataView(makeRowAndHeap(heapBytes, heapElementLength).buffer), 0)[0]
}

function i16be(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < values.length; i++) {
    view.setInt16(i * 2, values[i]!, false)
  }
  return out
}

function hcompressZeroTile2x2(): Uint8Array {
  return Uint8Array.from([
    0xdd,
    0x99,
    0x00,
    0x00,
    0x00,
    0x02, // nx
    0x00,
    0x00,
    0x00,
    0x02, // ny
    0x00,
    0x00,
    0x00,
    0x01, // scale
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // sumall
    0x00,
    0x00,
    0x00, // nbitplanes
    0x00, // EOF nybble
  ])
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

  it('decompresses GZIP_1 tile payloads and rejects unsupported BYTEPIX typed arrays', async () => {
    const gzipPayload = gzipSync(Uint8Array.from([5, 6, 7, 8]))
    const gzipHeader = makeCompressedHeader({
      TTYPE1: 'GZIP_COMPRESSED_DATA',
      ZCMPTYPE: 'GZIP_1',
      ZBITPIX: 8,
      PCOUNT: gzipPayload.length,
    })
    const gzipImage = new CompressedImage(
      gzipHeader as never,
      makeRowAndHeap(gzipPayload as Uint8Array).buffer,
    )
    const gzipFrame = await gzipImage.getFrame(0)
    expect(Array.from(gzipFrame)).toEqual([5, 6, 7, 8])

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

  it('decompresses minimal HCOMPRESS_1 tiles', () => {
    const payload = hcompressZeroTile2x2()
    const header = makeCompressedHeader({
      ZCMPTYPE: 'HCOMPRESS_1',
      PCOUNT: payload.byteLength,
    })
    const image = new CompressedImage(header as never, makeRowAndHeap(payload).buffer)
    const decoded = decodeFirstTile(image, payload) as ArrayLike<number>
    expect(Array.from(decoded)).toEqual([0, 0, 0, 0])
  })

  it('reports explicit errors for malformed HCOMPRESS tiles', () => {
    const header = makeCompressedHeader({
      ZCMPTYPE: 'HCOMPRESS_1',
    })
    const image = new CompressedImage(header as never, makeRowAndHeap(Uint8Array.from([1])).buffer)
    expect(() => decodeFirstTile(image, Uint8Array.from([1]))).toThrow('HCOMPRESS stream')
  })

  it('decompresses PLIO_1 payloads backed by 16-bit heap descriptors', () => {
    const header = makeCompressedHeader({
      ZCMPTYPE: 'PLIO_1',
      TFORM1: '1PI',
      PCOUNT: 16,
    })
    const words = [0, 7, -100, 8, 0, 0, 0, 16388]
    const heap = i16be(words)
    const image = new CompressedImage(header as never, makeRowAndHeap(heap, words.length).buffer)
    const decoded = decodeFirstTile(image, heap, words.length) as ArrayLike<number>
    expect(Array.from(decoded)).toEqual([1, 1, 1, 1])
  })

  it('rejects malformed odd-length PLIO byte payloads', () => {
    const header = makeCompressedHeader({
      ZCMPTYPE: 'PLIO_1',
      TFORM1: '1PB',
      PCOUNT: 1,
    })
    const image = new CompressedImage(header as never, makeRowAndHeap(Uint8Array.from([1])).buffer)
    expect(() => decodeFirstTile(image, Uint8Array.from([1]))).toThrow(
      'PLIO_1 compressed stream must contain 16-bit words',
    )
  })

  it('uses instance decoderProvider for custom compression algorithms', () => {
    const providerCalls: string[] = []
    const header = makeCompressedHeader({
      ZCMPTYPE: 'CUSTOM_1',
    })
    const image = new CompressedImage(
      header as never,
      makeRowAndHeap(Uint8Array.from([0xaa, 0xbb])).buffer,
      {
        decoderProvider: {
          decodeTile: (context) => {
            providerCalls.push(context.algorithm)
            expect(context.descriptor).toBe('B')
            expect(context.compressedData).toBeInstanceOf(Uint8Array)
            expect(context.zbitpix).toBe(8)
            expect(context.tileSize).toBe(4)
            expect(Array.from(context.compressedBytes)).toEqual([0xaa, 0xbb])
            return Int32Array.from([7, 8, 9, 10])
          },
        },
      },
    )

    const decoded = decodeFirstTile(image, Uint8Array.from([0xaa, 0xbb])) as ArrayLike<number>
    expect(Array.from(decoded)).toEqual([7, 8, 9, 10])
    expect(providerCalls).toEqual(['CUSTOM_1'])
  })

  it('supports global decoder provider registration', () => {
    const previous = getCompressedImageDecoderProvider()
    setCompressedImageDecoderProvider({
      decodeTile: (context) => {
        if (context.algorithm !== 'CUSTOM_2') return undefined
        return Int32Array.from([1, 1, 2, 3])
      },
    })
    try {
      const header = makeCompressedHeader({
        ZCMPTYPE: 'CUSTOM_2',
      })
      const image = new CompressedImage(
        header as never,
        makeRowAndHeap(Uint8Array.from([0xde, 0xad])).buffer,
      )
      const decoded = decodeFirstTile(image, Uint8Array.from([0xde, 0xad])) as ArrayLike<number>
      expect(Array.from(decoded)).toEqual([1, 1, 2, 3])
    } finally {
      setCompressedImageDecoderProvider(previous)
    }
  })

  it('maps 2D tiles into image coordinates correctly', () => {
    const fake = Object.create(CompressedImage.prototype) as CompressedImage & {
      accessors: Array<(view: DataView, offset: number) => [unknown, number]>
      columns: string[]
      width: number
      height: number
      ztile: number[]
      zquantiz: string
      zdither: number
      bscale: number
      bzero: number
    }

    const tiles = [
      Int32Array.from([1, 2, 3, 4]),
      Int32Array.from([5, 6, 7, 8]),
      Int32Array.from([9, 10, 11, 12]),
      Int32Array.from([13, 14, 15, 16]),
    ]
    let tileReadIndex = 0

    Object.assign(fake, {
      width: 4,
      height: 4,
      ztile: [2, 2],
      accessors: [() => [tiles[tileReadIndex++]!, 0]],
      columns: ['COMPRESSED_DATA'],
      zquantiz: 'LINEAR_SCALING',
      zdither: 1,
      bscale: 1,
      bzero: 0,
    })

    const out = (
      fake as unknown as { _getRows(buffer: ArrayBuffer, nRows: number): Float32Array }
    )._getRows(new ArrayBuffer(0), 4)
    expect(Array.from(out)).toEqual([1, 2, 5, 6, 3, 4, 7, 8, 9, 10, 13, 14, 11, 12, 15, 16])
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
