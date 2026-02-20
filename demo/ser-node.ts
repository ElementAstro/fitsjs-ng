import './_setup'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  SER,
  XISFWriter,
  convertFitsToSer,
  convertSerToFits,
  convertSerToXisf,
  convertXisfToSer,
  parseSERBlob,
  parseSERBuffer,
  writeSER,
} from '../src/index'
import type { XISFUnit } from '../src/index'

const OUT_DIR = resolve(process.cwd(), 'demo', '.out', 'ser-node')

function section(title: string): void {
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
      littleEndian: true,
      luId: 1001,
      observer: 'fitsjs-ng demo',
      instrument: 'virtual camera',
      telescope: 'virtual telescope',
      startTime: timestamps[0],
      startTimeUtc: timestamps[0],
    },
    frames,
    timestamps,
  })
}

async function makeMultiImageXisf(): Promise<ArrayBuffer> {
  const img0 = new Uint8Array([1, 2, 3, 4])
  const img1 = new Uint8Array([21, 22, 23, 24])
  const unit: XISFUnit = {
    metadata: [],
    images: [
      {
        id: 'FIRST',
        geometry: [2, 2, 1],
        channelCount: 1,
        sampleFormat: 'UInt8',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: img0.byteLength },
          byteOrder: 'little',
        },
        data: img0,
        properties: [],
        tables: [],
        fitsKeywords: [],
      },
      {
        id: 'SECOND',
        geometry: [2, 2, 1],
        channelCount: 1,
        sampleFormat: 'UInt8',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: img1.byteLength },
          byteOrder: 'little',
        },
        data: img1,
        properties: [{ id: 'SER:Observer', type: 'String', value: 'image-index-1' }],
        tables: [],
        fitsKeywords: [],
      },
    ],
    standaloneProperties: [],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  }
  return XISFWriter.toMonolithic(unit)
}

async function demoParsersAndReaders(serBuffer: ArrayBuffer): Promise<void> {
  section('1) Parser Entries + Reader APIs')
  const parsedFromBuffer = parseSERBuffer(serBuffer)
  const parsedFromBlob = await parseSERBlob(new Blob([serBuffer]))
  const compat = parseSERBuffer(serBuffer, { endiannessPolicy: 'compat' })
  const spec = parseSERBuffer(serBuffer, { endiannessPolicy: 'spec' })
  const auto = parseSERBuffer(serBuffer, { endiannessPolicy: 'auto' })

  const serFromArray = SER.fromArrayBuffer(serBuffer)
  const serFromBlob = await SER.fromBlob(new Blob([serBuffer]))
  const u8 = new Uint8Array(serBuffer)
  const serFromNode = SER.fromNodeBuffer({
    buffer: u8.buffer,
    byteOffset: u8.byteOffset,
    byteLength: u8.byteLength,
  })

  const frame0 = serFromArray.getFrame(0)
  const frame0RGB = serFromArray.getFrameRGB(0)
  const firstTwoFrames = serFromArray.getFrames(0, 2)
  let iterCount = 0
  for await (const _frame of serFromArray) iterCount++

  ok('SER parser entrypoints', {
    parseSERBufferFrames: parsedFromBuffer.header.frameCount,
    parseSERBlobFrames: parsedFromBlob.header.frameCount,
    fromArrayFrames: serFromArray.getFrameCount(),
    fromBlobFrames: serFromBlob.getFrameCount(),
    fromNodeFrames: serFromNode.getFrameCount(),
  })
  ok('SER reader coverage', {
    frame0Bytes: frame0.raw.byteLength,
    frame0RgbSamples: frame0RGB.length,
    getFramesCount: firstTwoFrames.length,
    timestampDate: serFromArray.getTimestampDate(0)?.toISOString() ?? 'n/a',
    durationSeconds: serFromArray.getDurationSeconds()?.toFixed(6) ?? 'n/a',
    estimatedFPS: serFromArray.getEstimatedFPS()?.toFixed(2) ?? 'n/a',
    asyncIteratorFrames: iterCount,
  })
  ok('endiannessPolicy coverage', {
    compat: compat.header.byteOrder,
    spec: spec.header.byteOrder,
    auto: auto.header.byteOrder,
  })
}

async function demoConversions(serBuffer: ArrayBuffer): Promise<void> {
  section('2) Conversion Coverage')

  const fitsCube = await convertSerToFits(serBuffer, { layout: 'cube' })
  const fitsMulti = await convertSerToFits(serBuffer, { layout: 'multi-hdu' })
  const serFromCube = await convertFitsToSer(fitsCube, { sourceLayout: 'cube' })
  const serFromMultiAuto = await convertFitsToSer(fitsMulti, { sourceLayout: 'auto' })
  const serFromMultiForced = await convertFitsToSer(fitsMulti, { sourceLayout: 'multi-hdu' })

  const xisfFromSer = (await convertSerToXisf(serBuffer)) as ArrayBuffer
  const serFromXisf = await convertXisfToSer(xisfFromSer)

  const twoImageXisf = await makeMultiImageXisf()
  const serFromImageIndex = await convertXisfToSer(twoImageXisf, { imageIndex: 1 })
  const parsedImageIndexSer = parseSERBuffer(serFromImageIndex)

  await writeFile(resolve(OUT_DIR, 'ser-source.demo.ser'), new Uint8Array(serBuffer))
  await writeFile(resolve(OUT_DIR, 'ser-to-fits.cube.fits'), new Uint8Array(fitsCube))
  await writeFile(resolve(OUT_DIR, 'ser-to-fits.multi-hdu.fits'), new Uint8Array(fitsMulti))
  await writeFile(resolve(OUT_DIR, 'fits-cube-to-ser.demo.ser'), new Uint8Array(serFromCube))
  await writeFile(
    resolve(OUT_DIR, 'fits-multi-auto-to-ser.demo.ser'),
    new Uint8Array(serFromMultiAuto),
  )
  await writeFile(
    resolve(OUT_DIR, 'fits-multi-forced-to-ser.demo.ser'),
    new Uint8Array(serFromMultiForced),
  )
  await writeFile(resolve(OUT_DIR, 'ser-to-xisf.demo.xisf'), new Uint8Array(xisfFromSer))
  await writeFile(resolve(OUT_DIR, 'xisf-to-ser.demo.ser'), new Uint8Array(serFromXisf))
  await writeFile(
    resolve(OUT_DIR, 'xisf-image-index-1-to-ser.demo.ser'),
    new Uint8Array(serFromImageIndex),
  )

  ok('SER <-> FITS', {
    cubeFitsBytes: fitsCube.byteLength,
    multiFitsBytes: fitsMulti.byteLength,
    fromCubeFrames: parseSERBuffer(serFromCube).header.frameCount,
    fromMultiAutoFrames: parseSERBuffer(serFromMultiAuto).header.frameCount,
    fromMultiForcedFrames: parseSERBuffer(serFromMultiForced).header.frameCount,
  })
  ok('SER <-> XISF', {
    xisfBytes: xisfFromSer.byteLength,
    backSerFrames: parseSERBuffer(serFromXisf).header.frameCount,
    selectedImageObserver: parsedImageIndexSer.header.observer || 'n/a',
  })
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  console.log('Output directory:', OUT_DIR)

  const serBuffer = makeDemoSER()
  await demoParsersAndReaders(serBuffer)
  await demoConversions(serBuffer)

  section('Done')
  console.log('SER demo completed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
