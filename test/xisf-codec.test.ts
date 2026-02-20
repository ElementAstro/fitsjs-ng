import { describe, expect, it } from 'vitest'
import * as nodeZlib from 'node:zlib'
import {
  DefaultXISFCodecProvider,
  decodeCompressedBlock,
  encodeCompressedBlock,
  shuffleBytes,
  unshuffleBytes,
} from '../src/xisf-codec'
import { XISFCompressionError } from '../src/xisf-errors'

describe('xisf-codec', () => {
  it('supports zlib/lz4/zstd codecs and rejects unknown ones', () => {
    expect(DefaultXISFCodecProvider.supports('zlib')).toBe(true)
    expect(DefaultXISFCodecProvider.supports('zlib+sh')).toBe(true)
    expect(DefaultXISFCodecProvider.supports('lz4')).toBe(true)
    expect(DefaultXISFCodecProvider.supports('lz4hc')).toBe(true)
    expect(DefaultXISFCodecProvider.supports('zstd')).toBe(true)
    expect(() => DefaultXISFCodecProvider.compress('unknown', new Uint8Array([1]))).toThrow(
      XISFCompressionError,
    )
    expect(() => DefaultXISFCodecProvider.decompress('unknown', new Uint8Array([1]))).toThrow(
      XISFCompressionError,
    )
  })

  it('round-trips zlib compressed payloads', () => {
    const input = new Uint8Array(256)
    for (let i = 0; i < input.length; i++) input[i] = i & 0xff
    const compressed = DefaultXISFCodecProvider.compress('zlib', input, 6)
    const restored = DefaultXISFCodecProvider.decompress('zlib', compressed)
    expect(Array.from(restored)).toEqual(Array.from(input))
  })

  it('shuffles and unshuffles byte-interleaved payloads with trailing bytes', () => {
    const src = Uint8Array.from([1, 2, 3, 4, 5, 6, 7])
    const shuffled = shuffleBytes(src, 2)
    const roundtrip = unshuffleBytes(shuffled, 2)
    expect(Array.from(roundtrip)).toEqual(Array.from(src))
    expect(Array.from(shuffleBytes(src, 1))).toEqual(Array.from(src))
    expect(Array.from(unshuffleBytes(src, 0))).toEqual(Array.from(src))
  })

  it('encodes and decodes single compressed blocks with and without shuffle', () => {
    const payload = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80])
    const plain = encodeCompressedBlock(payload, 'zlib', DefaultXISFCodecProvider, 6)
    const plainDecoded = decodeCompressedBlock(plain.data, plain.spec, DefaultXISFCodecProvider)
    expect(Array.from(plainDecoded)).toEqual(Array.from(payload))

    const shuffled = encodeCompressedBlock(payload, 'zlib+sh', DefaultXISFCodecProvider, 6, 2)
    const shuffledDecoded = decodeCompressedBlock(
      shuffled.data,
      shuffled.spec,
      DefaultXISFCodecProvider,
    )
    expect(Array.from(shuffledDecoded)).toEqual(Array.from(payload))
    expect(shuffled.spec.itemSize).toBe(2)
  })

  it('encodes and decodes lz4 blocks, and supports zstd decompression', () => {
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff)
    const lz4 = encodeCompressedBlock(payload, 'lz4', DefaultXISFCodecProvider, 1)
    const restoredLz4 = decodeCompressedBlock(lz4.data, lz4.spec, DefaultXISFCodecProvider)
    expect(Array.from(restoredLz4)).toEqual(Array.from(payload))

    const zstdCompressSync = (nodeZlib as { zstdCompressSync?: (src: Buffer) => Buffer })
      .zstdCompressSync
    if (zstdCompressSync) {
      const zstdCompressed = new Uint8Array(zstdCompressSync(Buffer.from(payload)))
      const restoredZstd = decodeCompressedBlock(
        zstdCompressed,
        { codec: 'zstd', uncompressedSize: payload.length },
        DefaultXISFCodecProvider,
      )
      expect(Array.from(restoredZstd)).toEqual(Array.from(payload))
    }
    expect(() => DefaultXISFCodecProvider.compress('zstd', payload, 3)).toThrow(
      'decompression only',
    )
  })

  it('validates shuffle itemSize and subblock definitions during decode', () => {
    const passthroughProvider = {
      supports: () => true,
      compress: (_codec: string, input: Uint8Array) => input,
      decompress: (_codec: string, input: Uint8Array) => input,
    }

    expect(() =>
      decodeCompressedBlock(
        Uint8Array.from([1, 2, 3, 4]),
        { codec: 'zlib+sh', uncompressedSize: 4 },
        passthroughProvider,
      ),
    ).toThrow(XISFCompressionError)

    expect(() =>
      decodeCompressedBlock(
        Uint8Array.from([1, 2, 3]),
        {
          codec: 'zlib',
          uncompressedSize: 3,
          subblocks: [{ compressedSize: 4, uncompressedSize: 3 }],
        },
        passthroughProvider,
      ),
    ).toThrow('exceed')

    expect(() =>
      decodeCompressedBlock(
        Uint8Array.from([1, 2, 3]),
        {
          codec: 'zlib',
          uncompressedSize: 3,
          subblocks: [{ compressedSize: 2, uncompressedSize: 2 }],
        },
        passthroughProvider,
      ),
    ).toThrow('mismatch')
  })

  it('validates decoded subblock sizes and total uncompressed size', () => {
    const fixedProvider = {
      supports: () => true,
      compress: (_codec: string, input: Uint8Array) => input,
      decompress: () => Uint8Array.from([1]), // always 1 byte
    }

    expect(() =>
      decodeCompressedBlock(
        Uint8Array.from([1, 2]),
        {
          codec: 'zlib',
          uncompressedSize: 2,
          subblocks: [{ compressedSize: 2, uncompressedSize: 2 }],
        },
        fixedProvider,
      ),
    ).toThrow('Decoded subblock size mismatch')

    const okProvider = {
      supports: () => true,
      compress: (_codec: string, input: Uint8Array) => input,
      decompress: (_codec: string, input: Uint8Array) => input,
    }
    expect(() =>
      decodeCompressedBlock(
        Uint8Array.from([1, 2]),
        {
          codec: 'zlib',
          uncompressedSize: 3,
          subblocks: [{ compressedSize: 2, uncompressedSize: 2 }],
        },
        okProvider,
      ),
    ).toThrow('Decoded uncompressed size mismatch')

    const decoded = decodeCompressedBlock(
      Uint8Array.from([9, 8, 7, 6]),
      {
        codec: 'zlib',
        uncompressedSize: 4,
        subblocks: [
          { compressedSize: 2, uncompressedSize: 2 },
          { compressedSize: 2, uncompressedSize: 2 },
        ],
      },
      okProvider,
    )
    expect(Array.from(decoded)).toEqual([9, 8, 7, 6])
  })
})
