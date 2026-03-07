import { describe, expect, it } from 'vitest'
import { XISF } from '../../src/xisf'
import { XISFWriter } from '../../src/xisf/xisf-writer'
import type { XISFUnit } from '../../src/xisf/xisf-types'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function xmlToArrayBuffer(xml: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(xml))
}

function makeMonolithicUnit(data: Uint8Array): XISFUnit {
  return {
    metadata: [],
    images: [
      {
        geometry: [2, 2],
        channelCount: 1,
        sampleFormat: 'UInt8',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: data.byteLength },
          byteOrder: 'little',
        },
        data,
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

describe('XISF lazy image data loading', () => {
  it('keeps image.data empty when decodeImageData=false and loads embedded data on demand', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="embedded">
    <Data encoding="base64">AQID</Data>
  </Image>
</xisf>`
    const parsed = await XISF.fromArrayBuffer(xmlToArrayBuffer(xml), {
      decodeImageData: false,
    })

    expect(parsed.getImage(0)?.data).toBeUndefined()

    const loaded = await parsed.getImageData(0)
    expect(Array.from(loaded)).toEqual([1, 2, 3])
    expect(parsed.getImage(0)?.data).toBeUndefined()
  })

  it('supports inline image loading in relaxed mode', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="inline:base64">BA==</Image>
</xisf>`
    const parsed = await XISF.fromArrayBuffer(xmlToArrayBuffer(xml), {
      decodeImageData: false,
      strictValidation: false,
    })

    const loaded = await parsed.getImageData(0)
    expect(Array.from(loaded)).toEqual([4])
  })

  it('loads url/path image blocks through the configured resource resolver', async () => {
    let urlCalls = 0
    let pathCalls = 0
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="url(https://example.test/a.bin)" />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="path(@header_dir/b.bin)" />
</xisf>`

    const parsed = await XISF.fromArrayBuffer(xmlToArrayBuffer(xml), {
      decodeImageData: false,
      headerDir: '/tmp/xisf',
      resourceResolver: {
        async resolveURL(url: string) {
          urlCalls++
          expect(url).toBe('https://example.test/a.bin')
          return Uint8Array.from([7])
        },
        async resolvePath(path: string) {
          pathCalls++
          expect(path).toBe('/tmp/xisf/b.bin')
          return Uint8Array.from([8])
        },
      },
    })

    expect(Array.from(await parsed.getImageData(0))).toEqual([7])
    expect(Array.from(await parsed.getImageData(1))).toEqual([8])
    expect(urlCalls).toBe(1)
    expect(pathCalls).toBe(1)
  })

  it('applies imageDataCacheMaxEntries with LRU eviction and releaseImageData', async () => {
    const calls = new Map<string, number>()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="url(https://example.test/a.bin)" />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="url(https://example.test/b.bin)" />
</xisf>`

    const parsed = await XISF.fromArrayBuffer(xmlToArrayBuffer(xml), {
      decodeImageData: false,
      imageDataCacheMaxEntries: 1,
      resourceResolver: {
        async resolveURL(url: string) {
          calls.set(url, (calls.get(url) ?? 0) + 1)
          return url.endsWith('/a.bin') ? Uint8Array.from([1]) : Uint8Array.from([2])
        },
        async resolvePath() {
          throw new Error('not expected')
        },
      },
    })

    await parsed.getImageData(0, { cache: true })
    await parsed.getImageData(0, { cache: true })
    expect(calls.get('https://example.test/a.bin')).toBe(1)

    await parsed.getImageData(1, { cache: true })
    expect(calls.get('https://example.test/b.bin')).toBe(1)

    await parsed.getImageData(0, { cache: true })
    expect(calls.get('https://example.test/a.bin')).toBe(2)

    parsed.releaseImageData(0)
    await parsed.getImageData(0, { cache: true })
    expect(calls.get('https://example.test/a.bin')).toBe(3)
  })

  it('loads attachment-backed image data lazily when decodeImageData=false', async () => {
    const source = Uint8Array.from([9, 8, 7, 6])
    const monolithic = await XISFWriter.toMonolithic(makeMonolithicUnit(source))
    const parsed = await XISF.fromArrayBuffer(monolithic, {
      decodeImageData: false,
      imageDataCacheMaxEntries: 1,
    })

    const first = await parsed.getImageData(0, { cache: true })
    expect(Array.from(first)).toEqual([9, 8, 7, 6])

    parsed.releaseImageData()
    const second = await parsed.getImageData(0, { cache: true })
    expect(Array.from(second)).toEqual([9, 8, 7, 6])
  })
})
