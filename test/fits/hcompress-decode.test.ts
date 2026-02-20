import { describe, expect, it } from 'vitest'
import { DecompressionError } from '../../src/core/errors'
import { hDecompressInt32 } from '../../src/fits/hcompress-decode'

describe('fits/hcompress-decode', () => {
  it('throws on invalid stream magic', () => {
    const invalid = Uint8Array.from([0x00, 0x00, 0x00, 0x00])
    expect(() => hDecompressInt32(invalid)).toThrowError(DecompressionError)
  })
})
