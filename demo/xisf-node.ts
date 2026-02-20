/**
 * fitsjs-ng XISF Node Demo
 *
 * Demonstrates:
 * 1) FITS -> XISF (monolithic and distributed) -> FITS round-trip
 * 2) XISF parsing entrypoints (ArrayBuffer / Blob / NodeBuffer-like)
 * 3) Signature policy calls (offline)
 * 4) Direct XISFWriter API
 * 5) SER/HiPS bridge from XISF
 *
 * Run with: pnpm demo:xisf
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import './_setup'
import {
  FITS,
  NodeFSTarget,
  SER,
  XISF,
  XISFWriter,
  convertFitsToXisf,
  convertHiPSToXisf,
  convertSerToXisf,
  convertXisfToHiPS,
  convertXisfToFits,
  convertXisfToSer,
  createImageBytesFromArray,
  createImageHDU,
  writeFITS,
  writeSER,
} from '../src/index'
import type { XISFUnit } from '../src/index'

const OUT_DIR = resolve(process.cwd(), 'demo/.out/xisf-node')

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function separator(title: string): void {
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

function buildSampleFits(width: number, height: number): ArrayBuffer {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      values[i] = Math.sin(x * 0.2) * Math.cos(y * 0.15) * 120 + 500 + (x + y) * 0.4
    }
  }

  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'OBJECT', value: 'fitsjs-ng XISF demo' },
      { key: 'CTYPE1', value: 'RA---TAN' },
      { key: 'CTYPE2', value: 'DEC--TAN' },
      { key: 'CRVAL1', value: 180 },
      { key: 'CRVAL2', value: 0 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.01 },
      { key: 'CDELT2', value: 0.01 },
    ],
  })
  return writeFITS([hdu])
}

function buildDemoSER(): ArrayBuffer {
  const width = 4
  const height = 2
  const frames = [new Uint8Array(width * height), new Uint8Array(width * height)]
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    for (let p = 0; p < frame.length; p++) frame[p] = (i * 50 + p * 7) & 0xff
  }
  const timestamps = [638000000000000000n, 638000000000100000n]
  return writeSER({
    header: {
      colorId: 0,
      width,
      height,
      pixelDepth: 8,
      luId: 4200,
      observer: 'xisf-node bridge demo',
      instrument: 'virtual cam',
      telescope: 'virtual scope',
      startTime: timestamps[0],
      startTimeUtc: timestamps[0],
    },
    frames,
    timestamps,
  })
}

async function demoFitsRoundTrip(): Promise<ArrayBuffer> {
  separator('1) FITS -> XISF (Monolithic) -> FITS')

  const fitsBuffer = buildSampleFits(64, 32)
  await writeFile(resolve(OUT_DIR, 'sample-input.fits'), new Uint8Array(fitsBuffer))
  ok('write', { file: 'sample-input.fits' })

  const xisfMonolithic = (await convertFitsToXisf(fitsBuffer)) as ArrayBuffer
  await writeFile(resolve(OUT_DIR, 'sample-output.xisf'), new Uint8Array(xisfMonolithic))
  ok('write', { file: 'sample-output.xisf' })

  const parsedXisf = await XISF.fromArrayBuffer(xisfMonolithic)
  const firstImage = parsedXisf.getImage()

  const fitsBack = await convertXisfToFits(parsedXisf)
  await writeFile(resolve(OUT_DIR, 'sample-roundtrip.fits'), new Uint8Array(fitsBack))
  ok('write', { file: 'sample-roundtrip.fits' })

  const parsedFitsBack = FITS.fromArrayBuffer(fitsBack)
  ok('FITS <-> XISF round-trip', {
    sampleFormat: firstImage?.sampleFormat ?? 'n/a',
    geometry: firstImage?.geometry.join('x') ?? 'n/a',
    bitpix: parsedFitsBack.getHeader()?.getNumber('BITPIX') ?? 'n/a',
    naxis1: parsedFitsBack.getHeader()?.getNumber('NAXIS1') ?? 'n/a',
    naxis2: parsedFitsBack.getHeader()?.getNumber('NAXIS2') ?? 'n/a',
  })
  return xisfMonolithic
}

async function demoDistributedXisf(): Promise<void> {
  separator('2) XISF Distributed (.xish + .xisb)')

  const fitsBuffer = buildSampleFits(48, 24)
  const distributed = (await convertFitsToXisf(fitsBuffer, {
    distributed: true,
    writeOptions: {
      maxInlineBlockSize: 128,
      compression: 'zlib',
    },
  })) as { header: Uint8Array; blocks: Record<string, Uint8Array> }

  await writeFile(resolve(OUT_DIR, 'distributed.xish'), distributed.header)
  await writeFile(resolve(OUT_DIR, 'blocks.xisb'), distributed.blocks['blocks.xisb']!)
  ok('write', { header: 'distributed.xish', blocks: 'blocks.xisb' })

  const parsedDistributed = await XISF.fromArrayBuffer(toArrayBuffer(distributed.header), {
    headerDir: OUT_DIR.replace(/\\/g, '/'),
  })
  const fitsFromDistributed = await convertXisfToFits(parsedDistributed)
  await writeFile(resolve(OUT_DIR, 'distributed-to-fits.fits'), new Uint8Array(fitsFromDistributed))
  ok('distributed parse+export', {
    images: parsedDistributed.unit.images.length,
    metadata: parsedDistributed.unit.metadata.length,
    fitsBytes: fitsFromDistributed.byteLength,
  })
}

async function demoParsingEntryPoints(monolithic: ArrayBuffer): Promise<void> {
  separator('3) XISF Parsing Entry Points + Signature Policy Calls')

  const blobParsed = await XISF.fromBlob(new Blob([monolithic]))
  const u8 = new Uint8Array(monolithic)
  const nodeLikeParsed = await XISF.fromNodeBuffer({
    buffer: u8.buffer,
    byteOffset: u8.byteOffset,
    byteLength: u8.byteLength,
  })

  const ignoreSig = await XISF.fromArrayBuffer(monolithic, {
    verifySignatures: false,
    signaturePolicy: 'ignore',
  })
  const warnings: string[] = []
  const warnSig = await XISF.fromArrayBuffer(monolithic, {
    verifySignatures: true,
    signaturePolicy: 'warn',
    onWarning: (warning) => warnings.push(`${warning.code}:${warning.message}`),
  })

  ok('parse entrypoints', {
    fromBlobImages: blobParsed.unit.images.length,
    fromNodeBufferImages: nodeLikeParsed.unit.images.length,
    fromArrayBufferImages: ignoreSig.unit.images.length,
  })
  ok('signature options', {
    ignorePolicyPresent: ignoreSig.unit.signature.present,
    warnPolicyPresent: warnSig.unit.signature.present,
    warnings: warnings.length,
  })
}

async function demoDirectWriter(): Promise<void> {
  separator('4) Direct XISFWriter API')

  const raw = new Uint8Array(16)
  const view = new DataView(raw.buffer)
  for (let i = 0; i < 8; i++) view.setUint16(i * 2, i * 257, true)

  const unit: XISFUnit = {
    metadata: [
      { id: 'XISF:CreatorApplication', type: 'String', value: 'fitsjs-ng demo/xisf-node.ts' },
      { id: 'XISF:CreationTime', type: 'TimePoint', value: new Date().toISOString() },
      {
        id: 'Demo:UI16Values',
        type: 'UI16Vector',
        value: [0, 257, 514, 771, 1028, 1285, 1542, 1799],
        dataBlock: { location: { type: 'attachment', position: 0, size: 0 }, byteOrder: 'little' },
      },
    ],
    images: [
      {
        id: 'DEMO_IMG',
        geometry: [4, 2],
        channelCount: 1,
        sampleFormat: 'UInt16',
        colorSpace: 'Gray',
        pixelStorage: 'Planar',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: raw.byteLength },
          byteOrder: 'little',
        },
        data: raw,
        properties: [],
        tables: [],
        fitsKeywords: [{ name: 'OBJECT', value: 'XISFWriter demo image', comment: 'demo' }],
      },
    ],
    standaloneProperties: [
      { id: 'Demo:Note', type: 'String', value: 'Generated by direct writer demo' },
    ],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  }

  const monolithic = await XISFWriter.toMonolithic(unit, { compression: 'zlib' })
  await writeFile(resolve(OUT_DIR, 'writer-direct.xisf'), new Uint8Array(monolithic))
  ok('write', { file: 'writer-direct.xisf' })

  const parsed = await XISF.fromArrayBuffer(monolithic)
  ok('writer parse', {
    metadata: parsed.unit.metadata.map((m) => m.id).join('|'),
    images: parsed.unit.images.length,
  })
}

async function demoSerAndHipsBridge(): Promise<void> {
  separator('5) XISF -> SER / HiPS Bridge')

  const demoSer = buildDemoSER()
  const xisfFromSer = (await convertSerToXisf(demoSer)) as ArrayBuffer
  const serRoundTrip = await convertXisfToSer(xisfFromSer)
  const parsedSerRoundTrip = SER.fromArrayBuffer(serRoundTrip)

  await writeFile(resolve(OUT_DIR, 'bridge-from-ser.xisf'), new Uint8Array(xisfFromSer))
  await writeFile(resolve(OUT_DIR, 'bridge-ser-roundtrip.ser'), new Uint8Array(serRoundTrip))

  const bridgeDir = join(OUT_DIR, 'bridge-hips')
  await rm(bridgeDir, { recursive: true, force: true })
  await mkdir(bridgeDir, { recursive: true })
  await convertXisfToHiPS(xisfFromSer, {
    output: new NodeFSTarget(bridgeDir),
    title: 'XISF bridge HiPS',
    creatorDid: 'ivo://fitsjs-ng/demo/xisf-bridge',
    hipsOrder: 2,
    minOrder: 1,
    tileWidth: 64,
    formats: ['fits', 'png'],
    includeAllsky: true,
    includeMoc: true,
  })
  const cutoutXisf = await convertHiPSToXisf(bridgeDir, {
    cutout: { width: 96, height: 48, ra: 0, dec: 0, fov: 2.5 },
  })
  await writeFile(
    resolve(OUT_DIR, 'bridge-hips-cutout.xisf'),
    new Uint8Array(cutoutXisf as ArrayBuffer),
  )
  const parsedCutout = await XISF.fromArrayBuffer(cutoutXisf as ArrayBuffer)

  ok('XISF <-> SER bridge', {
    xisfBytes: xisfFromSer.byteLength,
    serFrames: parsedSerRoundTrip.getFrameCount(),
  })
  ok('XISF -> HiPS -> XISF bridge', {
    cutoutImages: parsedCutout.unit.images.length,
    cutoutGeometry: parsedCutout.unit.images[0]?.geometry.join('x') ?? 'n/a',
  })
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  console.log('Output directory:', OUT_DIR)

  const monolithic = await demoFitsRoundTrip()
  await demoDistributedXisf()
  await demoParsingEntryPoints(monolithic)
  await demoDirectWriter()
  await demoSerAndHipsBridge()

  separator('Done')
  console.log('XISF demo completed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
