import { unzlibSync, zlibSync } from 'fflate'
import type { XISFCodecProvider, XISFCompressionSpec } from './xisf-types'
import { XISFCompressionError } from './xisf-errors'

const SHUFFLE_SUFFIX = '+sh'
const ZLIB_LEVELS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const)

export const DefaultXISFCodecProvider: XISFCodecProvider = {
  supports(codec: string): boolean {
    const canonical = codec.toLowerCase()
    return canonical === 'zlib' || canonical === 'zlib+sh'
  },
  compress(codec: string, input: Uint8Array, level?: number): Uint8Array {
    if (!this.supports(codec)) {
      throw new XISFCompressionError(`Unsupported codec in default provider: ${codec}`)
    }
    const normalizedLevel =
      level !== undefined && ZLIB_LEVELS.has(level as never)
        ? (level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)
        : undefined
    return zlibSync(input, { level: normalizedLevel })
  },
  decompress(codec: string, input: Uint8Array): Uint8Array {
    if (!this.supports(codec)) {
      throw new XISFCompressionError(`Unsupported codec in default provider: ${codec}`)
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
