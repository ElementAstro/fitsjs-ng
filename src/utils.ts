import { BLOCK_LENGTH } from './constants'

/**
 * Endian swap functions for converting big-endian data to host byte order.
 * FITS data is always stored in big-endian format.
 */
/** 8-bit: no swap needed */
const swap8 = (value: number): number => value
/** 16-bit endian swap */
const swap16 = (value: number): number => ((value & 0xff) << 8) | ((value >> 8) & 0xff)
/** 32-bit endian swap */
const swap32 = (value: number): number =>
  ((value & 0xff) << 24) |
  ((value & 0xff00) << 8) |
  ((value >> 8) & 0xff00) |
  ((value >> 24) & 0xff)

export const swapEndian = {
  8: swap8,
  B: swap8,
  16: swap16,
  I: swap16,
  32: swap32,
  J: swap32,
} as Record<string | number, (value: number) => number>

/** Shared TextDecoder instance for ASCII decoding. */
const textDecoder = new TextDecoder('ascii')

/**
 * Convert a Uint8Array to a string (ASCII decoding).
 */
export function uint8ArrayToString(arr: Uint8Array): string {
  return textDecoder.decode(arr)
}

/**
 * Calculate the number of excess (padding) bytes needed to reach a FITS block boundary.
 */
export function excessBytes(length: number): number {
  return (BLOCK_LENGTH - (length % BLOCK_LENGTH)) % BLOCK_LENGTH
}

/**
 * Convert a byte to an array of 8 bits (MSB first).
 */
export function toBits(byte: number): number[] {
  const arr: number[] = []
  let i = 128
  while (i >= 1) {
    arr.push(byte & i ? 1 : 0)
    i >>= 1
  }
  return arr
}
