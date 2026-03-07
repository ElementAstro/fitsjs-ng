import './_setup'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  FITS,
  HiPS,
  Image,
  createImageBytesFromArray,
  createImageHDU,
  writeFITS,
} from '../src/index'
import { hipsAllskyPath, hipsTilePath } from '../src/hips/hips-path'
import { encodeHiPSTile } from '../src/hips/hips-tile'

type PerfMode = {
  name: string
  fitsFrameCacheMaxFrames?: number
  hipsTileCacheMaxEntries: number
  hipsAllskyCache: boolean
}

type FitsPerfResult = {
  firstFrameMs: number
  repeatFrameMs: number
  repeatAfterOtherFrameMs: number
  peakArrayBuffersDelta: number
  networkRequests: number
}

type HiPSPerfResult = {
  firstTileMs: number
  repeatTileMs: number
  firstAllskyMs: number
  repeatAllskyMs: number
  networkRequests: number
}

type ScenarioResult = {
  mode: PerfMode
  fits: FitsPerfResult
  hips: HiPSPerfResult
}

type RequestCounters = {
  fits: number
  hips: number
  hipsTile: number
  hipsAllsky: number
  hipsProperties: number
}

const FITS_URL = 'https://perf.test/fits/sample.fits'
const HIPS_BASE_URL = 'https://perf.test/hips'

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

function memoryArrayBuffers(): number {
  const usage = process.memoryUsage() as ReturnType<typeof process.memoryUsage> & {
    arrayBuffers?: number
  }
  return usage.arrayBuffers ?? 0
}

function parseRange(range: string): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(range.trim())
  if (!match) {
    throw new Error(`Invalid Range header: ${range}`)
  }
  return {
    start: Number.parseInt(match[1]!, 10),
    end: Number.parseInt(match[2]!, 10),
  }
}

function rangeResponse(bytes: Uint8Array, start: number, end: number): Response {
  const clampedStart = Math.max(0, start)
  const clampedEnd = Math.min(bytes.byteLength - 1, end)
  const body = bytes.subarray(clampedStart, clampedEnd + 1)
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${clampedStart}-${clampedEnd}/${bytes.byteLength}`,
    },
  })
}

function makeFitsCube(width = 160, height = 160, depth = 6): ArrayBuffer {
  const values = new Int16Array(width * height * depth)
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = z * width * height + y * width + x
        values[i] = ((x + y * 3 + z * 17) % 30000) - 15000
      }
    }
  }
  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    depth,
    bitpix: 16,
    data: createImageBytesFromArray(values, 16),
  })
  return writeFITS([hdu])
}

function makeHiPSTileBytes(order: number, ipix: number): Uint8Array {
  return encodeHiPSTile(
    { order, ipix, frame: 'equatorial', format: 'fits' },
    Float32Array.from([1, 2, 3, 4]),
    2,
    1,
  )
}

function installMockFetch(
  fitsBytes: Uint8Array,
  tileBytes: Uint8Array,
  counters: RequestCounters,
): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const parsed = new URL(url)

    if (url.startsWith(FITS_URL)) {
      counters.fits += 1
      const range = headers.get('range')
      if (range) {
        const { start, end } = parseRange(range)
        return rangeResponse(fitsBytes, start, end)
      }
      return new Response(fitsBytes, { status: 200 })
    }

    if (url.startsWith(HIPS_BASE_URL)) {
      counters.hips += 1
      const path = parsed.pathname.replace(/^\/hips\//u, '')
      if (path === 'properties') {
        counters.hipsProperties += 1
        return new Response('hips_tile_format = fits\nhips_frame = equatorial\n', { status: 200 })
      }
      if (path === hipsTilePath({ order: 0, ipix: 0, frame: 'equatorial', format: 'fits' })) {
        counters.hipsTile += 1
        return new Response(tileBytes, { status: 200 })
      }
      if (path === hipsAllskyPath('fits')) {
        counters.hipsAllsky += 1
        return new Response(tileBytes, { status: 200 })
      }
      return new Response('not-found', { status: 404, statusText: 'Not Found' })
    }

    return new Response('not-found', { status: 404, statusText: 'Not Found' })
  }) as typeof fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

async function runFitsScenario(mode: PerfMode): Promise<FitsPerfResult> {
  const baselineArrayBuffers = memoryArrayBuffers()
  let peakArrayBuffers = baselineArrayBuffers
  const updatePeak = () => {
    peakArrayBuffers = Math.max(peakArrayBuffers, memoryArrayBuffers())
  }

  const fitsReadOptions: Parameters<typeof FITS.fromURL>[1] = {
    urlMode: 'range',
    rangeChunkSize: 1024,
    rangeMaxCachedChunks: 1,
  }
  if (mode.fitsFrameCacheMaxFrames !== undefined) {
    fitsReadOptions.imageFrameCacheMaxFrames = mode.fitsFrameCacheMaxFrames
  }

  const fits = await FITS.fromURL(FITS_URL, fitsReadOptions)
  updatePeak()

  const image = fits.getDataUnit() as Image
  const t0 = performance.now()
  await image.getFrame(0)
  const firstFrameMs = performance.now() - t0
  updatePeak()

  const t1 = performance.now()
  await image.getFrame(0)
  const repeatFrameMs = performance.now() - t1
  updatePeak()

  for (let frame = 1; frame < image.depth; frame++) {
    await image.getFrame(frame)
    updatePeak()
  }

  const t2 = performance.now()
  const lastFrame = Math.max(0, image.depth - 1)
  await image.getFrame(lastFrame)
  await image.getFrame(lastFrame)
  const repeatAfterOtherFrameMs = performance.now() - t2
  updatePeak()

  return {
    firstFrameMs,
    repeatFrameMs,
    repeatAfterOtherFrameMs,
    peakArrayBuffersDelta: peakArrayBuffers - baselineArrayBuffers,
    networkRequests: 0,
  }
}

async function runHiPSScenario(mode: PerfMode): Promise<HiPSPerfResult> {
  const hips = await HiPS.open(HIPS_BASE_URL, {
    tileCacheMaxEntries: mode.hipsTileCacheMaxEntries,
    allskyCache: mode.hipsAllskyCache,
  })

  const tileStart = performance.now()
  await hips.readTile({ order: 0, ipix: 0, format: 'fits' })
  const firstTileMs = performance.now() - tileStart

  const tileRepeatStart = performance.now()
  await hips.readTile({ order: 0, ipix: 0, format: 'fits' })
  const repeatTileMs = performance.now() - tileRepeatStart

  const allskyStart = performance.now()
  await hips.readAllsky('fits')
  const firstAllskyMs = performance.now() - allskyStart

  const allskyRepeatStart = performance.now()
  await hips.readAllsky('fits')
  const repeatAllskyMs = performance.now() - allskyRepeatStart

  return {
    firstTileMs,
    repeatTileMs,
    firstAllskyMs,
    repeatAllskyMs,
    networkRequests: 0,
  }
}

async function runScenario(mode: PerfMode): Promise<ScenarioResult> {
  const fitsBytes = new Uint8Array(makeFitsCube())
  const tileBytes = makeHiPSTileBytes(0, 0)
  const counters: RequestCounters = {
    fits: 0,
    hips: 0,
    hipsTile: 0,
    hipsAllsky: 0,
    hipsProperties: 0,
  }
  const restoreFetch = installMockFetch(fitsBytes, tileBytes, counters)

  try {
    const fits = await runFitsScenario(mode)
    const hips = await runHiPSScenario(mode)
    fits.networkRequests = counters.fits
    hips.networkRequests = counters.hips
    return { mode, fits, hips }
  } finally {
    restoreFetch()
  }
}

function buildReport(results: ScenarioResult[]): string {
  const lines: string[] = []
  lines.push('# Perf Loading Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Command: \`pnpm demo:perf:loading\``)
  lines.push('')
  lines.push('## FITS URL Range Read')
  lines.push('')
  lines.push(
    '| Scenario | First frame (ms) | Repeat frame (ms) | Repeat after frame switch (ms) | ArrayBuffer peak delta | Network requests |',
  )
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const result of results) {
    lines.push(
      `| ${result.mode.name} | ${result.fits.firstFrameMs.toFixed(1)} | ${result.fits.repeatFrameMs.toFixed(1)} | ${result.fits.repeatAfterOtherFrameMs.toFixed(1)} | ${formatBytes(result.fits.peakArrayBuffersDelta)} | ${result.fits.networkRequests} |`,
    )
  }
  lines.push('')
  lines.push('## HiPS Read')
  lines.push('')
  lines.push(
    '| Scenario | First tile (ms) | Repeat tile (ms) | First allsky (ms) | Repeat allsky (ms) | Network requests |',
  )
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const result of results) {
    lines.push(
      `| ${result.mode.name} | ${result.hips.firstTileMs.toFixed(1)} | ${result.hips.repeatTileMs.toFixed(1)} | ${result.hips.firstAllskyMs.toFixed(1)} | ${result.hips.repeatAllskyMs.toFixed(1)} | ${result.hips.networkRequests} |`,
    )
  }
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push(
    '- This benchmark uses deterministic in-memory mock HTTP responses for reproducibility.',
  )
  lines.push(
    '- `optimized-low-memory` enables bounded caches (`FITS imageFrameCacheMaxFrames=2`, `HiPS tileCacheMaxEntries=4`, `HiPS allskyCache=true`).',
  )
  lines.push('- `baseline-no-cache` disables frame/tile/allsky caches.')
  lines.push('')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const modes: PerfMode[] = [
    {
      name: 'baseline-legacy',
      hipsTileCacheMaxEntries: 0,
      hipsAllskyCache: false,
    },
    {
      name: 'optimized-low-memory',
      fitsFrameCacheMaxFrames: 2,
      hipsTileCacheMaxEntries: 4,
      hipsAllskyCache: true,
    },
  ]

  const results: ScenarioResult[] = []
  for (const mode of modes) {
    if (globalThis.gc) globalThis.gc()
    results.push(await runScenario(mode))
  }

  const report = buildReport(results)
  const outDir = join(process.cwd(), 'demo', '.out')
  await mkdir(outDir, { recursive: true })
  const reportPath = join(outDir, 'perf-loading-report.md')
  await writeFile(reportPath, report, 'utf8')

  console.log('\nPerf loading benchmark complete.\n')
  console.log(report)
  console.log(`\nReport written to: ${reportPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
