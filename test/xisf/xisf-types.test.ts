import { describe, expect, it } from 'vitest'
import type { XISFImage, XISFUnit } from '../../src/xisf/xisf-types'

describe('xisf/xisf-types', () => {
  it('preserves minimal XISFImage typing contract', () => {
    const image: XISFImage = {
      geometry: [2, 2],
      channelCount: 1,
      sampleFormat: 'UInt8',
      pixelStorage: 'Planar',
      colorSpace: 'Gray',
      dataBlock: {
        location: { type: 'attachment', position: 0, size: 4 },
      },
      properties: [],
      tables: [],
      fitsKeywords: [],
    }
    expect(image.channelCount).toBe(1)
  })

  it('preserves minimal XISFUnit typing contract', () => {
    const unit: XISFUnit = {
      metadata: [],
      images: [],
      standaloneProperties: [],
      standaloneTables: [],
      version: '1.0',
      signature: { present: false, verified: true },
    }
    expect(unit.version).toBe('1.0')
  })
})
