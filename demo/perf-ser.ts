/**
 * SER performance benchmark (manual / local).
 *
 * Run with: pnpm demo:perf:ser
 *
 * Notes:
 * - This is not a unit test and is not meant for CI.
 * - If you want more stable memory numbers, run Node with `--expose-gc`.
 */

import './_setup'
import { performance } from 'node:perf_hooks'
import { SER, writeSER } from '../src/index'

type MemorySnapshot = {
  rss: number
  heapUsed: number
  external: number
  arrayBuffers?: number
}

function snapshotMemory(): MemorySnapshot {
  const usage = process.memoryUsage() as ReturnType<typeof process.memoryUsage> & {
    arrayBuffers?: number
  }
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  }
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'n/a'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

function makeSerSequence(
  width: number,
  height: number,
  frameCount: number,
  pixelDepth: 8 | 16,
): ArrayBuffer {
  const bytesPerSample = pixelDepth <= 8 ? 1 : 2
  const frameLength = width * height * bytesPerSample
  const frames: Uint8Array[] = []

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frame = new Uint8Array(frameLength)
    if (pixelDepth === 8) {
      for (let i = 0; i < frame.length; i++) {
        frame[i] = (i + frameIndex * 17) & 0xff
      }
    } else {
      const view = new DataView(frame.buffer)
      const pixels = width * height
      for (let i = 0; i < pixels; i++) {
        view.setUint16(i * 2, (i * 37 + frameIndex * 97) & 0xffff, true)
      }
    }
    frames.push(frame)
  }

  return writeSER({
    header: {
      colorId: 0,
      width,
      height,
      pixelDepth,
      littleEndian: true,
      observer: 'perf-ser',
    },
    frames,
  })
}

async function bench<T>(name: string, fn: () => Promise<T>): Promise<T> {
  globalThis.gc?.()
  const before = snapshotMemory()
  const t0 = performance.now()
  const result = await fn()
  const t1 = performance.now()
  const after = snapshotMemory()

  console.log(
    `${name}: ${(t1 - t0).toFixed(1)} ms | arrayBuffers ${formatBytes(before.arrayBuffers)} -> ${formatBytes(after.arrayBuffers)}`,
  )

  return result
}

async function runScenario(label: string, open: () => Promise<SER>): Promise<void> {
  const ser = await bench(`${label} parse`, async () => open())
  await bench(`${label} frame0`, async () => ser.getFrame(0))
  await bench(`${label} allFrames`, async () => {
    for (let i = 0; i < ser.getFrameCount(); i++) {
      ser.getFrame(i)
    }
  })
}

async function main(): Promise<void> {
  const sizeRaw = process.env.SER_PERF_SIZE
  const frameCountRaw = process.env.SER_PERF_FRAMES
  const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : 1920
  const frameCount = frameCountRaw ? Number.parseInt(frameCountRaw, 10) : 64
  const width = size
  const height = Math.floor(size * 0.5625)

  console.log(`\nSER perf (size=${width}x${height}, frames=${frameCount})\n`)

  for (const pixelDepth of [8, 16] as const) {
    console.log(`\n--- pixelDepth=${pixelDepth} ---`)
    const buffer = makeSerSequence(width, height, frameCount, pixelDepth)
    const bytes = new Uint8Array(buffer)
    const nodeLike = {
      buffer: bytes.buffer,
      byteOffset: bytes.byteOffset,
      byteLength: bytes.byteLength,
    }
    const blob = new Blob([bytes])

    console.log(`source size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`)

    await runScenario('copy:ArrayBuffer', async () => SER.fromArrayBuffer(buffer))
    await runScenario('view:bytes', async () => SER.fromBytes(bytes))
    await runScenario('copy:NodeBuffer', async () =>
      SER.fromNodeBuffer(nodeLike, { frameStorage: 'copy' }),
    )
    await runScenario('view:NodeBuffer', async () =>
      SER.fromNodeBuffer(nodeLike, { frameStorage: 'view' }),
    )
    await runScenario('copy:Blob', async () => SER.fromBlob(blob, { frameStorage: 'copy' }))
    await runScenario('view:Blob', async () => SER.fromBlob(blob, { frameStorage: 'view' }))
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
