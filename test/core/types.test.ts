import { describe, expect, it } from 'vitest'
import type { BitPix, CompressionType, DataUnitType } from '../../src/core/types'

describe('core/types', () => {
  it('keeps public literal unions stable', () => {
    const bitpix: BitPix = 16
    const dataUnitType: DataUnitType = 'Image'
    const compression: CompressionType = 'RICE_1'

    expect(bitpix).toBe(16)
    expect(dataUnitType).toBe('Image')
    expect(compression).toBe('RICE_1')
  })
})
