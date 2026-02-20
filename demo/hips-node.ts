/**
 * HiPS Node Demo
 *
 * Run with:
 *   pnpm demo:hips
 */

import './_setup'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HiPS,
  HiPSProperties,
  NodeFSTarget,
  XISF,
  XISFWriter,
  convertFitsToHiPS,
  convertHiPSToFITS,
  convertHiPSToXisf,
  convertXisfToHiPS,
  createImageBytesFromArray,
  createImageHDU,
  lintHiPS,
  writeFITS,
} from '../src/index'

function makeSampleFits(width: number, height: number): ArrayBuffer {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2
      const dy = y - height / 2
      values[y * width + x] = Math.exp(-(dx * dx + dy * dy) / 500) * 1000 + x * 0.2 + y * 0.1
    }
  }

  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'CTYPE1', value: 'RA---TAN' },
      { key: 'CTYPE2', value: 'DEC--TAN' },
      { key: 'CRVAL1', value: 83.6331 },
      { key: 'CRVAL2', value: 22.0145 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.01 },
      { key: 'CDELT2', value: 0.01 },
    ],
  })
  return writeFITS([hdu])
}

async function makePlainXisfForBridge(): Promise<ArrayBuffer> {
  const raw = new Uint8Array(4 * 4 * 2)
  const view = new DataView(raw.buffer)
  for (let i = 0; i < 16; i++) view.setUint16(i * 2, i * 257, true)
  return XISFWriter.toMonolithic({
    metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'hips-node bridge' }],
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

function section(title: string): void {
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(64))
}

function ok(name: string, details: Record<string, unknown>): void {
  const summary = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
  console.log(`[OK] ${name}: ${summary}`)
}

async function main() {
  const outRoot = join(process.cwd(), 'demo', '.out', 'hips-node')
  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })

  console.log('== HiPS Node Demo ==')
  console.log('Output directory:', outRoot)

  const fits = makeSampleFits(256, 128)
  const target = new NodeFSTarget(outRoot)

  section('1) FITS -> HiPS')
  const build = await convertFitsToHiPS(fits, {
    output: target,
    title: 'fitsjs-ng HiPS Demo',
    creatorDid: 'ivo://fitsjs-ng/demo',
    hipsOrder: 3,
    minOrder: 1,
    tileWidth: 64,
    formats: ['fits', 'png', 'jpeg'],
    includeMoc: true,
    includeAllsky: true,
    includeIndexHtml: true,
  })
  ok('build', {
    generatedTiles: build.generatedTiles,
    orderRange: `${build.minOrder}..${build.maxOrder}`,
  })

  section('2) Lint HiPS')
  const lint = await lintHiPS(outRoot)
  ok('lint', {
    ok: lint.ok,
    issues: lint.issues.length,
  })
  for (const issue of lint.issues) {
    console.log(`- [${issue.level}] ${issue.code}: ${issue.message}`)
  }

  section('3) HiPS -> FITS (tile/map/cutout)')
  const firstTile = await findFirstTile(outRoot)
  if (!firstTile) throw new Error('No tile generated')

  const tileFits = await convertHiPSToFITS(outRoot, {
    tile: { order: firstTile.order, ipix: firstTile.ipix },
  })
  const mapFits = await convertHiPSToFITS(outRoot, {
    map: { order: 1, ordering: 'NESTED' },
  })
  const cutoutFits = await convertHiPSToFITS(outRoot, {
    cutout: {
      width: 512,
      height: 256,
      ra: 83.6331,
      dec: 22.0145,
      fov: 2.0,
      interpolation: 'bilinear',
    },
  })

  await writeFile(join(outRoot, 'demo-tile.fits'), new Uint8Array(tileFits))
  await writeFile(join(outRoot, 'demo-map.fits'), new Uint8Array(mapFits))
  await writeFile(join(outRoot, 'demo-cutout.fits'), new Uint8Array(cutoutFits))
  ok('export fits', {
    tileBytes: tileFits.byteLength,
    mapBytes: mapFits.byteLength,
    cutoutBytes: cutoutFits.byteLength,
  })

  section('4) HiPS class usage')
  const hips = await HiPS.open(outRoot)
  const props = await hips.getProperties()
  const tileFormats = await hips.tileFormats()
  const tileDecoded = await hips.readTile({
    order: firstTile.order,
    ipix: firstTile.ipix,
    format: tileFormats[0],
  })
  const allskyFits = await hips.readAllsky('fits')
  ok('readers', {
    title: props.get('obs_title') ?? 'n/a',
    formats: tileFormats.join('|'),
    tileShape: `${tileDecoded.width}x${tileDecoded.height}x${tileDecoded.depth}`,
    allskyBytes: allskyFits.byteLength,
  })

  section('5) HiPSProperties API')
  const propsText = await target.readText('properties')
  const parsedProps = HiPSProperties.parse(propsText)
  const report = parsedProps.validate()
  const compatText = parsedProps.withCompatibilityFields().toString()
  const fromObject = HiPSProperties.fromObject({
    creator_did: 'ivo://fitsjs-ng/demo/object',
    obs_title: 'fromObject demo',
    dataproduct_type: 'image',
    hips_version: '1.4',
    hips_frame: 'equatorial',
    hips_order: 2,
    hips_tile_width: 64,
    hips_tile_format: 'fits png',
  })
  const fromObjectReport = fromObject.validate()
  ok('properties methods', {
    parsedKeys: parsedProps.keys().length,
    validateOk: report.ok,
    compatLines: compatText.split('\n').filter(Boolean).length,
    fromObjectOk: fromObjectReport.ok,
  })

  section('6) XISF Bridge (XISF -> HiPS -> XISF cutout/map)')
  const bridgeRoot = join(outRoot, 'xisf-bridge')
  await rm(bridgeRoot, { recursive: true, force: true })
  await mkdir(bridgeRoot, { recursive: true })
  const xisfInput = await makePlainXisfForBridge()

  await convertXisfToHiPS(xisfInput, {
    output: new NodeFSTarget(bridgeRoot),
    title: 'fitsjs-ng XISF bridge',
    creatorDid: 'ivo://fitsjs-ng/demo/xisf-bridge',
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
  const mapXisf = await convertHiPSToXisf(bridgeRoot, {
    map: { order: 1, ordering: 'NESTED' },
  })
  await writeFile(join(outRoot, 'bridge-cutout.xisf'), new Uint8Array(cutoutXisf as ArrayBuffer))
  await writeFile(join(outRoot, 'bridge-map.xisf'), new Uint8Array(mapXisf as ArrayBuffer))

  const cutoutParsed = await XISF.fromArrayBuffer(cutoutXisf as ArrayBuffer)
  const mapParsed = await XISF.fromArrayBuffer(mapXisf as ArrayBuffer)
  ok('bridge outputs', {
    cutoutImages: cutoutParsed.unit.images.length,
    cutoutGeometry: cutoutParsed.unit.images[0]?.geometry.join('x') ?? 'n/a',
    mapImages: mapParsed.unit.images.length,
  })

  section('7) Remote backend note')
  console.log(
    'Optional remote cutout: pass backend="auto|remote" with hipsId in convertHiPSToFITS. This demo remains offline by default.',
  )

  console.log('\nDone.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
