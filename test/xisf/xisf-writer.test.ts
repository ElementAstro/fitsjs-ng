import { describe, expect, it } from 'vitest'
import { parseMonolithicContainer } from '../../src/xisf/xisf-container'
import { XISFWriter } from '../../src/xisf/xisf-writer'
import type { XISFUnit } from '../../src/xisf/xisf-types'

function makeUnit(): XISFUnit {
  return {
    metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'fitsjs-ng test' }],
    images: [
      {
        id: 'IMG0',
        geometry: [2, 2],
        channelCount: 1,
        sampleFormat: 'UInt8',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: 4 },
          byteOrder: 'little',
        },
        data: Uint8Array.from([1, 2, 3, 4]),
        properties: [],
        tables: [],
        fitsKeywords: [],
      },
    ],
    standaloneProperties: [],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  }
}

describe('xisf/xisf-writer', () => {
  it('writes monolithic XISF bytes for a minimal unit', async () => {
    const serialized = await XISFWriter.toMonolithic(makeUnit())
    expect(serialized.byteLength).toBeGreaterThan(0)

    const parsed = parseMonolithicContainer(serialized)
    expect(parsed.headerXml).toContain('<xisf')
    expect(parsed.payload.byteLength).toBeGreaterThan(0)
  })
})
