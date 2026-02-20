import { describe, expect, it } from 'vitest'
import { encodeHiPSTile, grayByteTileToFloat } from '../../src/hips/hips-tile'

describe('hips/hips-tile', () => {
  it('converts grayscale bytes to float values', () => {
    const out = grayByteTileToFloat(Uint8Array.from([0, 7, 255]))
    expect(Array.from(out)).toEqual([0, 7, 255])
  })

  it('throws when tile pixel length does not match width/depth', () => {
    expect(() =>
      encodeHiPSTile(
        { order: 0, ipix: 0, frame: 'equatorial', format: 'fits' },
        new Float32Array([1, 2, 3]),
        2,
        1,
      ),
    ).toThrow('Tile pixel length mismatch')
  })
})
