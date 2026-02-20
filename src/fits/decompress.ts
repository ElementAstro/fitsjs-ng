import type { TypedArray } from '../core/types'

/**
 * Setup functions for Rice decompression, keyed by bytepix (1, 2, or 4).
 * Each returns [fsbits, fsmax, lastpix, pointer].
 */
export const RiceSetup: Record<number, (array: Uint8Array) => [number, number, number, number]> = {
  1(array) {
    const pointer = 1
    const fsbits = 3
    const fsmax = 6
    const lastpix = array[0]!
    return [fsbits, fsmax, lastpix, pointer]
  },

  2(array) {
    const pointer = 2
    const fsbits = 4
    const fsmax = 14
    let lastpix = 0
    lastpix = lastpix | (array[0]! << 8)
    lastpix = lastpix | array[1]!
    return [fsbits, fsmax, lastpix, pointer]
  },

  4(array) {
    const pointer = 4
    const fsbits = 5
    const fsmax = 25
    let lastpix = 0
    lastpix = lastpix | (array[0]! << 24)
    lastpix = lastpix | (array[1]! << 16)
    lastpix = lastpix | (array[2]! << 8)
    lastpix = lastpix | array[3]!
    return [fsbits, fsmax, lastpix, pointer]
  },
}

/**
 * Rice decompression algorithm.
 *
 * Decompresses a byte array that was compressed using the Rice algorithm,
 * as defined in the FITS tiled image compression convention.
 *
 * @param array - Compressed byte array.
 * @param blocksize - Number of pixels encoded in a block.
 * @param bytepix - Number of bytes per original pixel (1, 2, or 4).
 * @param pixels - Output array to fill with decompressed values.
 * @param nx - Number of output pixels (tile length).
 * @param setup - Setup function map (default: RiceSetup).
 * @returns The filled pixels array.
 */
export function riceDecompress(
  array: Uint8Array,
  blocksize: number,
  bytepix: number,
  pixels: TypedArray,
  nx: number,
  setup: Record<number, (array: Uint8Array) => [number, number, number, number]> = RiceSetup,
): TypedArray {
  const setupFn = setup[bytepix]
  if (!setupFn) {
    throw new Error(`Unsupported bytepix value: ${bytepix}`)
  }

  const [fsbits, fsmax, initialLastpix, initialPointer] = setupFn(array)
  let lastpix = initialLastpix
  let pointer = initialPointer

  const bbits = 1 << fsbits

  // Build non-zero count lookup table
  const nonzeroCount = new Uint8Array(256)
  let nzero = 8
  let k = 128
  let idx = 255
  while (idx >= 0) {
    while (idx >= k) {
      nonzeroCount[idx] = nzero
      idx--
    }
    k = k / 2
    nzero--
  }
  nonzeroCount[0] = 0

  // Bit buffer
  let b = array[pointer++]!
  let nbits = 8

  let i = 0
  while (i < nx) {
    nbits -= fsbits

    while (nbits < 0) {
      b = (b << 8) | array[pointer++]!
      nbits += 8
    }

    const fs = (b >> nbits) - 1
    b &= (1 << nbits) - 1

    let imax = i + blocksize
    if (imax > nx) imax = nx

    if (fs < 0) {
      // All pixels in block have same value
      while (i < imax) {
        ;(pixels as Int32Array)[i] = lastpix
        i++
      }
    } else if (fs === fsmax) {
      // Uncompressed block
      while (i < imax) {
        k = bbits - nbits
        let diff = b << k
        k -= 8
        while (k >= 0) {
          b = array[pointer++]!
          diff |= b << k
          k -= 8
        }
        if (nbits > 0) {
          b = array[pointer++]!
          diff |= b >> -k
          b &= (1 << nbits) - 1
        } else {
          b = 0
        }
        if ((diff & 1) === 0) {
          diff = diff >> 1
        } else {
          diff = ~(diff >> 1)
        }
        ;(pixels as Int32Array)[i] = diff + lastpix
        lastpix = (pixels as Int32Array)[i]!
        i++
      }
    } else {
      // Normal compressed block
      while (i < imax) {
        while (b === 0) {
          nbits += 8
          b = array[pointer++]!
        }
        nzero = nbits - nonzeroCount[b]!
        nbits -= nzero + 1
        b ^= 1 << nbits
        nbits -= fs
        while (nbits < 0) {
          b = (b << 8) | array[pointer++]!
          nbits += 8
        }
        let diff = (nzero << fs) | (b >> nbits)
        b &= (1 << nbits) - 1
        if ((diff & 1) === 0) {
          diff = diff >> 1
        } else {
          diff = ~(diff >> 1)
        }
        ;(pixels as Int32Array)[i] = diff + lastpix
        lastpix = (pixels as Int32Array)[i]!
        i++
      }
    }
  }

  return pixels
}
