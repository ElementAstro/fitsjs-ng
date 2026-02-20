/**
 * fitsjs-ng CLI Demo (overview)
 *
 * Run with: pnpm demo
 */

import './_setup'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FITS,
  NodeFSTarget,
  SER,
  XISF,
  XISFWriter,
  convertFitsToHiPS,
  convertFitsToSer,
  convertFitsToXisf,
  convertHiPSToFITS,
  convertHiPSToXisf,
  convertSerToFits,
  convertSerToXisf,
  convertXisfToFits,
  convertXisfToHiPS,
  convertXisfToSer,
  createImageBytesFromArray,
  createImageHDU,
  lintHiPS,
  parseSERBlob,
  parseSERBuffer,
  writeFITS,
  writeSER,
} from '../src/index'

function separator(title: string): void {
  console.log(`\n${'═'.repeat(68)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(68))
}

function ok(name: string, details: Record<string, unknown>): void {
  const summary = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
  console.log(`[OK] ${name}: ${summary}`)
}

function makeFitsImage(width: number, height: number): ArrayBuffer {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = Math.sin(x * 0.2) * Math.cos(y * 0.15) * 120 + 500 + (x + y) * 0.4
    }
  }
  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'OBJECT', value: 'fitsjs-ng overview demo' },
      { key: 'CTYPE1', value: 'RA---TAN' },
      { key: 'CTYPE2', value: 'DEC--TAN' },
      { key: 'CRVAL1', value: 180 },
      { key: 'CRVAL2', value: 0 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.02 },
      { key: 'CDELT2', value: 0.02 },
    ],
  })
  return writeFITS([hdu])
}

function makeDemoSER(): ArrayBuffer {
  const width = 4
  const height = 3
  const frameCount = 3
  const frames: Uint8Array[] = []
  for (let f = 0; f < frameCount; f++) {
    const frame = new Uint8Array(width * height)
    for (let i = 0; i < frame.length; i++) frame[i] = (f * 40 + i * 9) & 0xff
    frames.push(frame)
  }
  const timestamps = Array.from(
    { length: frameCount },
    (_, i) => 638000000000000000n + BigInt(i) * 100000n,
  )
  return writeSER({
    header: {
      colorId: 0,
      width,
      height,
      pixelDepth: 8,
      luId: 1001,
      observer: 'fitsjs-ng overview',
      instrument: 'virtual camera',
      telescope: 'virtual telescope',
      startTime: timestamps[0],
      startTimeUtc: timestamps[0],
    },
    frames,
    timestamps,
  })
}

async function makePlainXisfForHipsBridge(): Promise<ArrayBuffer> {
  const raw = new Uint8Array(4 * 4 * 2)
  const view = new DataView(raw.buffer)
  for (let i = 0; i < 16; i++) view.setUint16(i * 2, i * 257, true)
  return XISFWriter.toMonolithic({
    metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'overview-bridge' }],
    images: [
      {
        id: 'BRIDGE_IMG',
        geometry: [4, 4],
        channelCount: 1,
        sampleFormat: 'UInt16',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: raw.byteLength },
          byteOrder: 'little',
        },
        data: raw,
        properties: [],
        tables: [],
        fitsKeywords: [],
      },
    ],
    standaloneProperties: [],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  })
}

async function findFirstTile(root: string): Promise<{ order: number; ipix: number } | null> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      const match = /Norder(\d+)[\\/]+Dir\d+[\\/]+Npix(\d+)\.(fits|png|jpg)$/iu.exec(full)
      if (match) return { order: Number(match[1]), ipix: Number(match[2]) }
    }
  }
  return null
}

async function demoFitsAndXisf(): Promise<void> {
  separator('1) FITS + XISF Core Flow')

  const fitsBuffer = makeFitsImage(64, 32)
  const fits = FITS.fromArrayBuffer(fitsBuffer)
  const image = fits.getDataUnit()
  if (!image) throw new Error('Missing primary image')
  const frame = await image.getFrame(0)
  const extent = image.getExtent(frame)
  ok('FITS parse', {
    bitpix: fits.getHeader()?.getNumber('BITPIX') ?? 'n/a',
    size: `${fits.getHeader()?.getNumber('NAXIS1')}x${fits.getHeader()?.getNumber('NAXIS2')}`,
    min: extent[0],
    max: extent[1],
  })

  const xisfMonolithic = (await convertFitsToXisf(fitsBuffer)) as ArrayBuffer
  const xisf = await XISF.fromArrayBuffer(xisfMonolithic)
  ok('FITS -> XISF', {
    images: xisf.unit.images.length,
    sampleFormat: xisf.unit.images[0]?.sampleFormat ?? 'n/a',
    geometry: xisf.unit.images[0]?.geometry.join('x') ?? 'n/a',
  })

  const fitsRoundTrip = await convertXisfToFits(xisf)
  const parsedRoundTrip = FITS.fromArrayBuffer(fitsRoundTrip)
  ok('XISF -> FITS', {
    bitpix: parsedRoundTrip.getHeader()?.getNumber('BITPIX') ?? 'n/a',
    naxis: parsedRoundTrip.getHeader()?.getNumber('NAXIS') ?? 'n/a',
  })

  const distributed = await XISFWriter.toDistributed(xisf.unit, { compression: 'zlib' })
  const parsedDistributed = await XISF.fromArrayBuffer(distributed.header.buffer.slice(0), {
    headerDir: '/demo',
    resourceResolver: {
      resolveURL: async () => {
        throw new Error('URL not expected in overview demo')
      },
      resolvePath: async (path) => {
        if (!path.endsWith('/blocks.xisb')) throw new Error(`Unexpected path: ${path}`)
        return distributed.blocks['blocks.xisb']!
      },
    },
  })
  ok('XISF distributed', {
    headerBytes: distributed.header.byteLength,
    blockBytes: distributed.blocks['blocks.xisb']!.byteLength,
    parsedImages: parsedDistributed.unit.images.length,
  })
}

async function demoSerOverview(): Promise<void> {
  separator('2) SER Core Flow')

  const serBuffer = makeDemoSER()
  const parsed = parseSERBuffer(serBuffer)
  const parsedBlob = await parseSERBlob(new Blob([serBuffer]))
  const ser = SER.fromArrayBuffer(serBuffer)
  const frame = ser.getFrame(0)
  const frameRgb = ser.getFrameRGB(0)

  ok('SER parse', {
    frames: parsed.header.frameCount,
    blobFrames: parsedBlob.header.frameCount,
    width: parsed.header.width,
    height: parsed.header.height,
  })
  ok('SER read helpers', {
    frame0Bytes: frame.raw.byteLength,
    frame0RgbSamples: frameRgb.length,
    fps: ser.getEstimatedFPS()?.toFixed(2) ?? 'n/a',
    durationSec: ser.getDurationSeconds()?.toFixed(6) ?? 'n/a',
  })

  const fitsCube = await convertSerToFits(serBuffer, { layout: 'cube' })
  const fitsMulti = await convertSerToFits(serBuffer, { layout: 'multi-hdu' })
  const serFromCube = await convertFitsToSer(fitsCube, { sourceLayout: 'cube' })
  const serFromMulti = await convertFitsToSer(fitsMulti, { sourceLayout: 'auto' })
  const xisfFromSer = (await convertSerToXisf(serBuffer)) as ArrayBuffer
  const serFromXisf = await convertXisfToSer(xisfFromSer)
  ok('SER conversions', {
    cubeFitsBytes: fitsCube.byteLength,
    multiFitsBytes: fitsMulti.byteLength,
    fromCubeFrames: parseSERBuffer(serFromCube).header.frameCount,
    fromMultiFrames: parseSERBuffer(serFromMulti).header.frameCount,
    xisfBytes: xisfFromSer.byteLength,
    backFromXisfFrames: parseSERBuffer(serFromXisf).header.frameCount,
  })
}

async function demoHipsOverview(): Promise<void> {
  separator('3) HiPS Core Flow + XISF Bridge')

  const outRoot = join(process.cwd(), 'demo', '.out', 'index-hips')
  const bridgeRoot = join(outRoot, 'xisf-bridge')
  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })
  await mkdir(bridgeRoot, { recursive: true })

  const fits = makeFitsImage(128, 64)
  const target = new NodeFSTarget(outRoot)
  const build = await convertFitsToHiPS(fits, {
    output: target,
    title: 'fitsjs-ng overview hips',
    creatorDid: 'ivo://fitsjs-ng/demo/overview',
    hipsOrder: 2,
    minOrder: 1,
    tileWidth: 64,
    formats: ['fits', 'png'],
    includeAllsky: true,
    includeMoc: true,
  })
  const lint = await lintHiPS(outRoot)
  const firstTile = await findFirstTile(outRoot)
  if (!firstTile) throw new Error('No tile generated in overview HiPS build')
  const tileFits = await convertHiPSToFITS(outRoot, {
    tile: { order: firstTile.order, ipix: firstTile.ipix },
  })
  const cutoutFits = await convertHiPSToFITS(outRoot, {
    cutout: { width: 96, height: 48, ra: 180, dec: 0, fov: 2.0, interpolation: 'bilinear' },
  })
  ok('FITS -> HiPS', {
    generatedTiles: build.generatedTiles,
    orderRange: `${build.minOrder}..${build.maxOrder}`,
    lintOk: lint.ok,
  })
  ok('HiPS -> FITS', {
    tileBytes: tileFits.byteLength,
    cutoutBytes: cutoutFits.byteLength,
  })

  const bridgeXisf = await makePlainXisfForHipsBridge()
  await convertXisfToHiPS(bridgeXisf, {
    output: new NodeFSTarget(bridgeRoot),
    title: 'XISF bridge',
    creatorDid: 'ivo://fitsjs-ng/demo/overview-xisf',
    hipsOrder: 2,
    minOrder: 1,
    tileWidth: 64,
    formats: ['fits', 'png'],
    includeAllsky: true,
    includeMoc: true,
  })
  const cutoutXisf = await convertHiPSToXisf(bridgeRoot, {
    cutout: { width: 128, height: 64, ra: 0, dec: 0, fov: 1.5 },
  })
  const parsedCutout = await XISF.fromArrayBuffer(cutoutXisf as ArrayBuffer)
  ok('XISF <-> HiPS bridge', {
    cutoutImages: parsedCutout.unit.images.length,
    cutoutGeometry: parsedCutout.unit.images[0]?.geometry.join('x') ?? 'n/a',
  })
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║                 fitsjs-ng — CLI Overview Demo                 ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  await demoFitsAndXisf()
  await demoSerOverview()
  await demoHipsOverview()

  separator('Done')
  console.log('Overview demo completed successfully.\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
