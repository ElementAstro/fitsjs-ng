import { describe, it, expect } from 'vitest'
import { riceDecompress, RiceSetup } from '../src/decompress'

describe('Rice Decompression', () => {
  it('should export RiceSetup for bytepix 1, 2, 4', () => {
    expect(RiceSetup[1]).toBeTypeOf('function')
    expect(RiceSetup[2]).toBeTypeOf('function')
    expect(RiceSetup[4]).toBeTypeOf('function')
  })

  it('should return correct setup values for bytepix 1', () => {
    const arr = new Uint8Array([42, 0, 0, 0])
    const [fsbits, fsmax, lastpix, pointer] = RiceSetup[1]!(arr)
    expect(fsbits).toBe(3)
    expect(fsmax).toBe(6)
    expect(lastpix).toBe(42)
    expect(pointer).toBe(1)
  })

  it('should return correct setup values for bytepix 2', () => {
    // big-endian 0x0102 = 258
    const arr = new Uint8Array([0x01, 0x02, 0, 0])
    const [fsbits, fsmax, lastpix, pointer] = RiceSetup[2]!(arr)
    expect(fsbits).toBe(4)
    expect(fsmax).toBe(14)
    expect(lastpix).toBe(258)
    expect(pointer).toBe(2)
  })

  it('should return correct setup values for bytepix 4', () => {
    // big-endian 0x00000001 = 1
    const arr = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0, 0])
    const [fsbits, fsmax, lastpix, pointer] = RiceSetup[4]!(arr)
    expect(fsbits).toBe(5)
    expect(fsmax).toBe(25)
    expect(lastpix).toBe(1)
    expect(pointer).toBe(4)
  })

  it('should decompress a trivial constant tile', () => {
    // A constant tile: all pixels have the same value (42).
    // Rice encoding for a constant block: fs = -1 (encoded as 0 in fsbits field).
    // For bytepix=1: fsbits=3, so first the lastpix byte (42), then
    // the block header is 0 in 3 bits => fs = 0 - 1 = -1.
    // Each block of `blocksize` pixels gets the constant value.
    const blocksize = 4
    const nx = 4
    const bytepix = 1

    // Manually construct: [lastpix=42, then 3 bits of 0 for fs=-1]
    // 0b000_00000 = 0x00
    const compressedData = new Uint8Array([42, 0x00])
    const pixels = new Int32Array(nx)

    riceDecompress(compressedData, blocksize, bytepix, pixels, nx)

    // All pixels should be 42
    for (let i = 0; i < nx; i++) {
      expect(pixels[i]).toBe(42)
    }
  })

  it('should handle riceDecompress function without crashing', () => {
    // Minimal smoke test — ensure the function doesn't throw with valid inputs
    const nx = 2
    const blocksize = 2
    const bytepix = 4

    // Construct minimal data: 4 bytes for lastpix (big-endian 100), then some encoded data
    const arr = new Uint8Array([0, 0, 0, 100, 0x00, 0x00, 0x00, 0x00])
    const pixels = new Int32Array(nx)

    // This should not throw
    expect(() => {
      riceDecompress(arr, blocksize, bytepix, pixels, nx)
    }).not.toThrow()
  })
})
