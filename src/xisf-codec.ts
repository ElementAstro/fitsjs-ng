import { unzlibSync, zlibSync } from 'fflate'
import { compressBlock, compressBound, decompressBlock } from 'lz4js'
import { decompress as zstdDecompress } from 'fzstd'
import type { XISFCodecProvider, XISFCompressionSpec } from './xisf-types'
import { XISFCompressionError } from './xisf-errors'

const SHUFFLE_SUFFIX = '+sh'
const ZLIB_LEVELS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const)

const LZ4_CODEC_NAMES = new Set(['lz4', 'lz4hc'])
const ZSTD_CODEC_NAMES = new Set(['zstd'])

function encodeUncompressedLz4Block(input: Uint8Array): Uint8Array {
  const literalLength = input.byteLength
  const extraLengthBytes = literalLength >= 15 ? Math.floor((literalLength - 15) / 255) + 1 : 0
  const out = new Uint8Array(1 + extraLengthBytes + literalLength)
  out[0] = Math.min(15, literalLength) << 4
  let offset = 1
  if (literalLength >= 15) {
    let remaining = literalLength - 15
    while (remaining >= 255) {
      out[offset++] = 255
      remaining -= 255
    }
    out[offset++] = remaining
  }
  out.set(input, offset)
  return out
}

function compressLz4(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(compressBound(input.byteLength))
  const hashTable = new Uint32Array(1 << 16)
  const encodedSize = compressBlock(input, out, 0, input.byteLength, hashTable)
  if (encodedSize > 0) {
    return out.slice(0, encodedSize)
  }
  return encodeUncompressedLz4Block(input)
}

function decompressLz4(input: Uint8Array, uncompressedSize?: number): Uint8Array {
  if (!uncompressedSize || uncompressedSize <= 0) {
    throw new XISFCompressionError('LZ4 codecs require uncompressedSize in XISF compression spec')
  }
  const out = new Uint8Array(uncompressedSize)
  const written = decompressBlock(input, out, 0, input.byteLength, 0)
  const actualSize = typeof written === 'number' ? written : out.byteLength
  if (actualSize !== out.byteLength) {
    throw new XISFCompressionError(
      `Decoded LZ4 block length mismatch: expected ${out.byteLength}, got ${actualSize}`,
    )
  }
  return out
}

export const DefaultXISFCodecProvider: XISFCodecProvider = {
  supports(codec: string): boolean {
    const canonical = codec.toLowerCase()
    const baseCodec = canonical.endsWith(SHUFFLE_SUFFIX)
      ? canonical.slice(0, -SHUFFLE_SUFFIX.length)
      : canonical
    return baseCodec === 'zlib' || LZ4_CODEC_NAMES.has(baseCodec) || ZSTD_CODEC_NAMES.has(baseCodec)
  },
  compress(codec: string, input: Uint8Array, level?: number): Uint8Array {
    const canonical = codec.toLowerCase()
    if (!this.supports(canonical)) {
      throw new XISFCompressionError(`Unsupported codec in default provider: ${codec}`)
    }
    if (LZ4_CODEC_NAMES.has(canonical)) {
      return compressLz4(input)
    }
    if (ZSTD_CODEC_NAMES.has(canonical)) {
      throw new XISFCompressionError(
        'Default provider supports zstd decompression only; provide a custom codecProvider for zstd encoding',
      )
    }
    const normalizedLevel =
      level !== undefined && ZLIB_LEVELS.has(level as never)
        ? (level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)
        : undefined
    return zlibSync(input, { level: normalizedLevel })
  },
  decompress(codec: string, input: Uint8Array, uncompressedSize?: number): Uint8Array {
    const canonical = codec.toLowerCase()
    if (!this.supports(canonical)) {
      throw new XISFCompressionError(`Unsupported codec in default provider: ${codec}`)
    }
    if (LZ4_CODEC_NAMES.has(canonical)) {
      return decompressLz4(input, uncompressedSize)
    }
    if (ZSTD_CODEC_NAMES.has(canonical)) {
      const outputBuffer =
        uncompressedSize && uncompressedSize > 0 ? new Uint8Array(uncompressedSize) : undefined
      const out = outputBuffer ? zstdDecompress(input, outputBuffer) : zstdDecompress(input)
      if (outputBuffer && out.byteLength !== outputBuffer.byteLength) {
        throw new XISFCompressionError(
          `Decoded zstd block length mismatch: expected ${outputBuffer.byteLength}, got ${out.byteLength}`,
        )
      }
      return out
    }
    return unzlibSync(input)
  },
}

export function shuffleBytes(input: Uint8Array, itemSize: number): Uint8Array {
  if (itemSize <= 1 || input.byteLength === 0) return input.slice()
  const itemCount = Math.floor(input.byteLength / itemSize)
  const trailing = input.byteLength % itemSize
  const out = new Uint8Array(input.byteLength)
  let dst = 0
  for (let b = 0; b < itemSize; b++) {
    for (let i = 0; i < itemCount; i++) {
      out[dst++] = input[i * itemSize + b]!
    }
  }
  if (trailing > 0) {
    out.set(input.slice(itemCount * itemSize), dst)
  }
  return out
}

export function unshuffleBytes(input: Uint8Array, itemSize: number): Uint8Array {
  if (itemSize <= 1 || input.byteLength === 0) return input.slice()
  const itemCount = Math.floor(input.byteLength / itemSize)
  const trailing = input.byteLength % itemSize
  const out = new Uint8Array(input.byteLength)
  let src = 0
  for (let b = 0; b < itemSize; b++) {
    for (let i = 0; i < itemCount; i++) {
      out[i * itemSize + b] = input[src++]!
    }
  }
  if (trailing > 0) {
    out.set(input.slice(src), itemCount * itemSize)
  }
  return out
}

function splitBySubblocks(
  data: Uint8Array,
  subblocks: Array<{ compressedSize: number; uncompressedSize: number }>,
): Uint8Array[] {
  const blocks: Uint8Array[] = []
  let offset = 0
  for (const part of subblocks) {
    const end = offset + part.compressedSize
    if (end > data.byteLength) {
      throw new XISFCompressionError('Compressed subblocks exceed block length')
    }
    blocks.push(data.slice(offset, end))
    offset = end
  }
  if (offset !== data.byteLength) {
    throw new XISFCompressionError('Compressed subblocks length mismatch')
  }
  return blocks
}

export function decodeCompressedBlock(
  data: Uint8Array,
  spec: XISFCompressionSpec,
  provider: XISFCodecProvider,
): Uint8Array {
  const codec = spec.codec.toLowerCase()
  const usesShuffle = codec.endsWith(SHUFFLE_SUFFIX)
  const baseCodec = usesShuffle ? codec.slice(0, -SHUFFLE_SUFFIX.length) : codec

  const decodeSingle = (input: Uint8Array): Uint8Array => {
    const out = provider.decompress(baseCodec, input, spec.uncompressedSize)
    if (!usesShuffle) return out
    if (!spec.itemSize || spec.itemSize <= 0) {
      throw new XISFCompressionError(`Shuffle codec ${codec} requires itemSize`)
    }
    return unshuffleBytes(out, spec.itemSize)
  }

  if (!spec.subblocks || spec.subblocks.length === 0) {
    return decodeSingle(data)
  }

  const chunks = splitBySubblocks(data, spec.subblocks)
  const out = new Uint8Array(spec.uncompressedSize)
  let cursor = 0
  for (let i = 0; i < chunks.length; i++) {
    const decoded = decodeSingle(chunks[i]!)
    const expected = spec.subblocks[i]!.uncompressedSize
    if (decoded.byteLength !== expected) {
      throw new XISFCompressionError('Decoded subblock size mismatch')
    }
    out.set(decoded, cursor)
    cursor += decoded.byteLength
  }
  if (cursor !== spec.uncompressedSize) {
    throw new XISFCompressionError('Decoded uncompressed size mismatch')
  }
  return out
}

export function encodeCompressedBlock(
  data: Uint8Array,
  codec: XISFCompressionSpec['codec'],
  provider: XISFCodecProvider,
  level?: number,
  itemSize?: number,
): { data: Uint8Array; spec: XISFCompressionSpec } {
  const normalized = codec.toLowerCase() as XISFCompressionSpec['codec']
  const usesShuffle = normalized.endsWith(SHUFFLE_SUFFIX)
  const baseCodec = (
    usesShuffle ? normalized.slice(0, -SHUFFLE_SUFFIX.length) : normalized
  ) as XISFCompressionSpec['codec']

  const toCompress = usesShuffle ? shuffleBytes(data, itemSize ?? 1) : data
  const compressed = provider.compress(baseCodec, toCompress, level)
  return {
    data: compressed,
    spec: {
      codec: normalized,
      uncompressedSize: data.byteLength,
      itemSize: usesShuffle ? (itemSize ?? 1) : undefined,
    },
  }
}
