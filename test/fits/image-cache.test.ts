import { describe, expect, it } from 'vitest'
import { Image } from '../../src/fits/image'
import type { BlobSource } from '../../src/core/types'
import type { Header } from '../../src/fits/header'

class CountingBlobSource implements BlobSource {
  readonly size: number

  constructor(
    private readonly source: Uint8Array,
    private readonly onRead: () => void,
    private readonly delayMs: number = 0,
    private readonly absoluteStart: number = 0,
    private readonly absoluteEnd: number = source.byteLength,
  ) {
    this.size = this.absoluteEnd - this.absoluteStart
  }

  slice(start?: number, end?: number): BlobSource {
    const localStart = start === undefined ? 0 : Math.max(0, Math.trunc(start))
    const localEnd = end === undefined ? this.size : Math.max(localStart, Math.trunc(end))
    return new CountingBlobSource(
      this.source,
      this.onRead,
      this.delayMs,
      this.absoluteStart + localStart,
      Math.min(this.absoluteStart + localEnd, this.absoluteEnd),
    )
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.onRead()
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    }
    return this.source.slice(this.absoluteStart, this.absoluteEnd).buffer
  }
}

function makeImageHeader(width: number, height: number, depth: number, bitpix: number): Header {
  const values: Record<string, number> = {
    NAXIS: depth > 1 ? 3 : 2,
    BITPIX: bitpix,
    NAXIS1: width,
    NAXIS2: height,
    NAXIS3: depth,
    BZERO: 0,
    BSCALE: 1,
  }
  return {
    getNumber(key: string, fallback = 0) {
      return values[key] ?? fallback
    },
  } as Header
}

function makeInt16Frames(width: number, height: number, frames: number[][]): Uint8Array {
  const bytesPerFrame = width * height * 2
  const out = new Uint8Array(bytesPerFrame * frames.length)
  const view = new DataView(out.buffer)
  for (let frame = 0; frame < frames.length; frame++) {
    const frameValues = frames[frame]!
    for (let i = 0; i < frameValues.length; i++) {
      view.setInt16(frame * bytesPerFrame + i * 2, frameValues[i]!, false)
    }
  }
  return out
}

describe('Image frame cache controls', () => {
  it('preserves legacy unlimited blob frame cache when imageFrameCacheMaxFrames is undefined', async () => {
    const width = 2
    const height = 1
    const bytes = makeInt16Frames(width, height, [[1, 2]])
    let reads = 0
    const image = new Image(
      makeImageHeader(width, height, 1, 16),
      new CountingBlobSource(bytes, () => {
        reads++
      }),
    )

    await image.getFrame(0)
    await image.getFrame(0)

    expect(reads).toBe(1)
  })

  it('disables blob frame caching when imageFrameCacheMaxFrames=0', async () => {
    const width = 2
    const height = 1
    const bytes = makeInt16Frames(width, height, [[3, 4]])
    let reads = 0
    const image = new Image(
      makeImageHeader(width, height, 1, 16),
      new CountingBlobSource(bytes, () => {
        reads++
      }),
      { frameCacheMaxFrames: 0 },
    )

    await image.getFrame(0)
    await image.getFrame(0)

    expect(reads).toBe(2)
  })

  it('uses LRU eviction for blob frame cache when imageFrameCacheMaxFrames>0', async () => {
    const width = 2
    const height = 1
    const bytes = makeInt16Frames(width, height, [
      [10, 11],
      [20, 21],
    ])
    let reads = 0
    const image = new Image(
      makeImageHeader(width, height, 2, 16),
      new CountingBlobSource(bytes, () => {
        reads++
      }),
      { frameCacheMaxFrames: 1 },
    )

    await image.getFrame(0)
    await image.getFrame(1)
    await image.getFrame(0)

    expect(reads).toBe(3)
  })

  it('deduplicates concurrent blob reads for the same frame', async () => {
    const width = 2
    const height = 1
    const bytes = makeInt16Frames(width, height, [[30, 31]])
    let reads = 0
    const image = new Image(
      makeImageHeader(width, height, 1, 16),
      new CountingBlobSource(
        bytes,
        () => {
          reads++
        },
        25,
      ),
      { frameCacheMaxFrames: 0 },
    )

    const [a, b] = await Promise.all([image.getFrame(0), image.getFrame(0)])

    expect(reads).toBe(1)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('clears cached frames via releaseFrameCache', async () => {
    const width = 2
    const height = 1
    const bytes = makeInt16Frames(width, height, [[40, 41]])
    let reads = 0
    const image = new Image(
      makeImageHeader(width, height, 1, 16),
      new CountingBlobSource(bytes, () => {
        reads++
      }),
    )

    await image.getFrame(0)
    image.releaseFrameCache(0)
    await image.getFrame(0)

    expect(reads).toBe(2)
  })
})
