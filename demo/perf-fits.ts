/**
 * FITS performance benchmark (manual / local).
 *
 * Run with: pnpm demo:perf
 *
 * Notes:
 * - This is not a unit test and is not meant for CI.
 * - If you want more stable memory numbers, run Node with `--expose-gc`.
 */

import './_setup'
import { performance } from 'node:perf_hooks'
import { FITS, Image, createImageBytesFromArray, createImageHDU, writeFITS } from '../src/index'

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

function makeFitsImage(width: number, height: number, bitpix: 16 | -32): ArrayBuffer {
  const pixels = width * height

  if (bitpix === 16) {
    const values = new Int16Array(pixels)
    for (let i = 0; i < values.length; i++) {
      values[i] = (i * 97) % 32767
    }
    const hdu = createImageHDU({
      primary: true,
      width,
      height,
      bitpix,
      data: createImageBytesFromArray(values, bitpix),
    })
    return writeFITS([hdu])
  }

  const values = new Float32Array(pixels)
  for (let i = 0; i < values.length; i++) {
    values[i] = Math.sin(i * 0.001) * 1000 + 123.45
  }

  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix,
    data: createImageBytesFromArray(values, bitpix),
  })
  return writeFITS([hdu])
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

async function runScenario(label: string, buffer: ArrayBuffer, open: () => FITS): Promise<void> {
  const fits = await bench(`${label} parse`, async () => open())
  const image = fits.getDataUnit() as Image
  const frameFirst = await bench(`${label} decode:first`, async () => image.getFrame(0))
  await bench(`${label} decode:repeat`, async () => image.getFrame(0))
  const extent = image.getExtent(frameFirst)
  console.log(`${label} extent: [${String(extent[0])}, ${String(extent[1])}]`)
}

async function main(): Promise<void> {
  const sizeRaw = process.env.FITS_PERF_SIZE
  const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : 4096
  const width = size
  const height = size

  console.log(`\nFITS perf (size=${width}x${height})\n`)

  for (const bitpix of [16, -32] as const) {
    console.log(`\n--- BITPIX=${bitpix} ---`)
    const buffer = makeFitsImage(width, height, bitpix)

    await runScenario('copy:ArrayBuffer', buffer, () => FITS.fromArrayBuffer(buffer))
    await runScenario('view:bytes', buffer, () => FITS.fromBytes(new Uint8Array(buffer)))
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
