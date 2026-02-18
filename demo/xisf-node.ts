/**
 * fitsjs-ng XISF Node Demo
 *
 * Demonstrates:
 * 1) FITS -> XISF (monolithic and distributed)
 * 2) XISF parsing (monolithic and distributed/header+blocks)
 * 3) XISF -> FITS conversion
 * 4) Round-trip checks
 *
 * Run with: pnpm demo:xisf
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import './_setup'
import {
  FITS,
  XISF,
  XISFWriter,
  convertFitsToXisf,
  convertXisfToFits,
  createImageBytesFromArray,
  createImageHDU,
  writeFITS,
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

async function demoFitsToXisfAndBack(): Promise<void> {
  separator('1) FITS -> XISF (Monolithic) -> FITS')

  const fitsBuffer = buildSampleFits(64, 32)
  await writeFile(resolve(OUT_DIR, 'sample-input.fits'), new Uint8Array(fitsBuffer))
  console.log('Wrote:', 'sample-input.fits')

  const xisfMonolithic = (await convertFitsToXisf(fitsBuffer)) as ArrayBuffer
  await writeFile(resolve(OUT_DIR, 'sample-output.xisf'), new Uint8Array(xisfMonolithic))
  console.log('Wrote:', 'sample-output.xisf')

  const parsedXisf = await XISF.fromArrayBuffer(xisfMonolithic)
  const firstImage = parsedXisf.getImage()
  console.log(
    `Parsed XISF image: geometry=${firstImage?.geometry.join('x')}, channels=${firstImage?.channelCount}, sampleFormat=${firstImage?.sampleFormat}`,
  )

  const fitsBack = await convertXisfToFits(parsedXisf)
  await writeFile(resolve(OUT_DIR, 'sample-roundtrip.fits'), new Uint8Array(fitsBack))
  console.log('Wrote:', 'sample-roundtrip.fits')

  const parsedFitsBack = FITS.fromArrayBuffer(fitsBack)
  const bitpix = parsedFitsBack.getHeader()?.getNumber('BITPIX')
  const naxis1 = parsedFitsBack.getHeader()?.getNumber('NAXIS1')
  const naxis2 = parsedFitsBack.getHeader()?.getNumber('NAXIS2')
  console.log(`Round-trip FITS header: BITPIX=${bitpix}, NAXIS1=${naxis1}, NAXIS2=${naxis2}`)
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

  const headerPath = resolve(OUT_DIR, 'distributed.xish')
  const blocksPath = resolve(OUT_DIR, 'blocks.xisb')
  await writeFile(headerPath, distributed.header)
  await writeFile(blocksPath, distributed.blocks['blocks.xisb']!)
  console.log('Wrote:', 'distributed.xish')
  console.log('Wrote:', 'blocks.xisb')

  const parsedDistributed = await XISF.fromArrayBuffer(toArrayBuffer(distributed.header), {
    headerDir: OUT_DIR.replace(/\\/g, '/'),
  })
  console.log(
    `Parsed distributed XISF image count=${parsedDistributed.unit.images.length}, metadata=${parsedDistributed.unit.metadata.length}`,
  )

  const fitsFromDistributed = await convertXisfToFits(parsedDistributed)
  await writeFile(resolve(OUT_DIR, 'distributed-to-fits.fits'), new Uint8Array(fitsFromDistributed))
  console.log('Wrote:', 'distributed-to-fits.fits')
}

async function demoDirectWriter(): Promise<void> {
  separator('3) Direct XISFWriter API')

  const raw = new Uint8Array(16)
  const view = new DataView(raw.buffer)
  for (let i = 0; i < 8; i++) {
    view.setUint16(i * 2, i * 257, true)
  }

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
  console.log('Wrote:', 'writer-direct.xisf')

  const parsed = await XISF.fromArrayBuffer(monolithic)
  console.log(
    `Parsed writer output metadata keys: ${parsed.unit.metadata.map((m) => m.id).join(', ')}`,
  )
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  console.log('Output directory:', OUT_DIR)

  await demoFitsToXisfAndBack()
  await demoDistributedXisf()
  await demoDirectWriter()

  separator('Done')
  console.log('XISF demo completed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
