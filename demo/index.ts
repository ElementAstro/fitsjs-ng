/**
 * fitsjs-ng CLI Demo
 *
 * Demonstrates the main features of fitsjs-ng by building FITS data in-memory
 * and exercising the public API. Run with: npx tsx demo/index.ts
 */

import './_setup'
import { FITS } from '../src/fits'
import { Image as FITSImage } from '../src/image'
import { Table as FITSTable } from '../src/table'
import { BLOCK_LENGTH, LINE_WIDTH } from '../src/constants'

// ─── FITS Builder Helpers ────────────────────────────────────────────────────

function card(content: string): string {
  return content.padEnd(LINE_WIDTH, ' ')
}

function makeHeaderBlock(cards: string[]): string {
  cards.push(card('END'))
  let block = cards.map((c) => c.padEnd(LINE_WIDTH, ' ')).join('')
  const remainder = block.length % BLOCK_LENGTH
  if (remainder !== 0) {
    block += ' '.repeat(BLOCK_LENGTH - remainder)
  }
  return block
}

function stringToBytes(str: string): Uint8Array {
  const arr = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i)
  }
  return arr
}

function padDataLength(len: number): number {
  return len + ((BLOCK_LENGTH - (len % BLOCK_LENGTH)) % BLOCK_LENGTH)
}

/** Build a simple 2D FITS image. */
function buildImage(width: number, height: number, bitpix: number, pixels: number[]): ArrayBuffer {
  const headerStr = makeHeaderBlock([
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(width).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(height).padStart(4)} / Height`),
  ])
  const headerBytes = stringToBytes(headerStr)

  const bpp = Math.abs(bitpix) / 8
  const dataLen = padDataLength(width * height * bpp)
  const buffer = new ArrayBuffer(headerBytes.length + dataLen)
  new Uint8Array(buffer).set(headerBytes, 0)

  const view = new DataView(buffer)
  const off = headerBytes.length
  for (let i = 0; i < pixels.length; i++) {
    if (bitpix === 16) view.setInt16(off + i * 2, pixels[i]!, false)
    else if (bitpix === -32) view.setFloat32(off + i * 4, pixels[i]!, false)
    else if (bitpix === -64) view.setFloat64(off + i * 8, pixels[i]!, false)
  }
  return buffer
}

/** Build a 3D data cube image. */
function buildDataCube(
  width: number,
  height: number,
  depth: number,
  bitpix: number,
  pixels: number[],
): ArrayBuffer {
  const headerStr = makeHeaderBlock([
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    3 / Number of axes'),
    card(`NAXIS1  =                 ${String(width).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(height).padStart(4)} / Height`),
    card(`NAXIS3  =                 ${String(depth).padStart(4)} / Depth`),
  ])
  const headerBytes = stringToBytes(headerStr)

  const bpp = Math.abs(bitpix) / 8
  const dataLen = padDataLength(width * height * depth * bpp)
  const buffer = new ArrayBuffer(headerBytes.length + dataLen)
  new Uint8Array(buffer).set(headerBytes, 0)

  const view = new DataView(buffer)
  const off = headerBytes.length
  for (let i = 0; i < pixels.length; i++) {
    if (bitpix === 16) view.setInt16(off + i * 2, pixels[i]!, false)
    else if (bitpix === -32) view.setFloat32(off + i * 4, pixels[i]!, false)
  }
  return buffer
}

/** Build a multi-HDU file: image + ASCII table. */
function buildImageWithTable(): ArrayBuffer {
  const imgW = 4,
    imgH = 3,
    bitpix = 16
  const imgPixels = Array.from({ length: imgW * imgH }, (_, i) => (i + 1) * 100)

  // Primary image header
  const primaryStr = makeHeaderBlock([
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(imgW).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(imgH).padStart(4)} / Height`),
    card('EXTEND  =                    T / Extensions present'),
  ])
  const primaryBytes = stringToBytes(primaryStr)
  const imgDataLen = padDataLength(imgW * imgH * 2)

  // ASCII table extension
  const tableRows = [
    'Sirius     -1.46  A1V   ',
    'Canopus    -0.74  F0II  ',
    'Arcturus   -0.05  K1III ',
  ]
  const rowByteSize = tableRows[0]!.length
  const nRows = tableRows.length

  const tableCols = [
    { name: 'STAR', form: 'A10' },
    { name: 'MAG', form: 'F6.2' },
    { name: 'SPTYPE', form: 'A6' },
  ]

  const tableHeaderStr = makeHeaderBlock([
    card("XTENSION= 'TABLE   '           / ASCII table extension"),
    card('BITPIX  =                    8 / Bits per pixel'),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(rowByteSize).padStart(4)} / Row width`),
    card(`NAXIS2  =                 ${String(nRows).padStart(4)} / Number of rows`),
    card('PCOUNT  =                    0 / No extra parameters'),
    card('GCOUNT  =                    1 / One group'),
    card(`TFIELDS =                    ${tableCols.length} / Number of columns`),
    ...tableCols.flatMap((col, i) => [
      card(`TTYPE${i + 1}  = '${col.name.padEnd(8)}'`),
      card(`TFORM${i + 1}  = '${col.form.padEnd(8)}'`),
    ]),
  ])
  const tableHeaderBytes = stringToBytes(tableHeaderStr)
  const tableDataLen = padDataLength(rowByteSize * nRows)

  // Assemble
  const total = primaryBytes.length + imgDataLen + tableHeaderBytes.length + tableDataLen
  const buffer = new ArrayBuffer(total)
  const u8 = new Uint8Array(buffer)
  const view = new DataView(buffer)

  let offset = 0
  u8.set(primaryBytes, offset)
  offset += primaryBytes.length

  for (let i = 0; i < imgPixels.length; i++) {
    view.setInt16(offset + i * 2, imgPixels[i]!, false)
  }
  offset += imgDataLen

  u8.set(tableHeaderBytes, offset)
  offset += tableHeaderBytes.length

  for (let r = 0; r < tableRows.length; r++) {
    const row = tableRows[r]!
    for (let c = 0; c < row.length; c++) {
      u8[offset + r * rowByteSize + c] = row.charCodeAt(c)
    }
  }

  return buffer
}

// ─── Demo Runner ─────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

async function demoBasicImage() {
  separator('1. Basic Image Parsing')

  const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
  const buffer = buildImage(4, 3, 16, pixels)
  const fits = FITS.fromArrayBuffer(buffer)

  const header = fits.getHeader()!
  console.log('Header keywords:', header.keys().join(', '))
  console.log('BITPIX:', header.get('BITPIX'))
  console.log('NAXIS1 (width):', header.get('NAXIS1'))
  console.log('NAXIS2 (height):', header.get('NAXIS2'))
  console.log('Data type:', header.getDataType())

  const image = fits.getDataUnit() as FITSImage
  console.log(`\nImage: ${image.width}×${image.height}, ${image.bitpix}-bit`)

  const frame = await image.getFrame(0)
  console.log('Pixel values:', Array.from(frame))

  const [min, max] = image.getExtent(frame)
  console.log(`Extent: [${min}, ${max}]`)
  console.log(`Pixel at (0,0): ${image.getPixel(frame, 0, 0)}`)
  console.log(`Pixel at (3,2): ${image.getPixel(frame, 3, 2)}`)
}

async function demoFloat32Image() {
  separator('2. Float32 Image (BITPIX=-32)')

  const pixels = [1.5, 2.7, 3.14, 0.0, -1.2, 42.0]
  const buffer = buildImage(3, 2, -32, pixels)
  const fits = FITS.fromArrayBuffer(buffer)
  const image = fits.getDataUnit() as FITSImage

  console.log(`Image: ${image.width}×${image.height}, BITPIX=${image.bitpix}`)
  const frame = await image.getFrame(0)
  console.log(
    'Pixel values:',
    Array.from(frame as Float32Array).map((v) => v.toFixed(4)),
  )
  const [min, max] = image.getExtent(frame)
  console.log(`Extent: [${min.toFixed(4)}, ${max.toFixed(4)}]`)
}

async function demoDataCube() {
  separator('3. Data Cube (3D Image)')

  const w = 3,
    h = 2,
    d = 3
  const pixels: number[] = []
  for (let f = 0; f < d; f++) {
    for (let i = 0; i < w * h; i++) {
      pixels.push((f + 1) * 10 + i)
    }
  }

  const buffer = buildDataCube(w, h, d, 16, pixels)
  const fits = FITS.fromArrayBuffer(buffer)
  const image = fits.getDataUnit() as FITSImage

  console.log(`Data cube: ${image.width}×${image.height}×${image.depth}`)
  console.log('Is data cube:', image.isDataCube())

  for (let f = 0; f < image.depth; f++) {
    const frame = await image.getFrame(f)
    const [min, max] = image.getExtent(frame)
    console.log(`  Frame ${f}: values=${Array.from(frame).join(',')}, extent=[${min},${max}]`)
  }
}

async function demoAsciiTable() {
  separator('4. Multi-HDU: Image + ASCII Table')

  const buffer = buildImageWithTable()
  const fits = FITS.fromArrayBuffer(buffer)

  console.log(`Total HDUs: ${fits.hdus.length}`)

  // Enumerate HDUs
  for (let i = 0; i < fits.hdus.length; i++) {
    const hdu = fits.hdus[i]!
    const type = hdu.header.getDataType()
    console.log(
      `  HDU ${i}: ${type ?? 'no data'} (${hdu.header.isPrimary() ? 'primary' : 'extension'})`,
    )
  }

  // Read image from HDU 0
  const image = fits.getDataUnit(0) as FITSImage
  const frame = await image.getFrame(0)
  console.log(`\nImage (HDU 0): ${image.width}×${image.height}`)
  console.log('  Pixels:', Array.from(frame))

  // Read table from HDU 1
  const table = fits.getDataUnit(1) as FITSTable
  console.log(`\nTable (HDU 1): ${table.rows} rows, ${table.cols} cols`)
  console.log('  Columns:', table.columns?.join(', '))

  const rows = await table.getRows(0, table.rows)
  console.log('  Rows:')
  for (const row of rows as Record<string, unknown>[]) {
    console.log(`    ${JSON.stringify(row)}`)
  }

  // Read single column
  const magCol = await table.getColumn('MAG')
  console.log('  MAG column:', magCol)
}

async function demoNodeBuffer() {
  separator('5. fromNodeBuffer')

  const pixels = [100, 200, 300, 400]
  const arrayBuffer = buildImage(2, 2, 16, pixels)

  // Simulate a Node.js Buffer-like object
  const nodeBufferLike = {
    buffer: arrayBuffer,
    byteOffset: 0,
    byteLength: arrayBuffer.byteLength,
  }

  const fits = FITS.fromNodeBuffer(nodeBufferLike)
  const image = fits.getDataUnit() as FITSImage
  const frame = await image.getFrame(0)
  console.log(`Image: ${image.width}×${image.height}`)
  console.log('Pixels:', Array.from(frame))
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║              fitsjs-ng — CLI Demo                       ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await demoBasicImage()
  await demoFloat32Image()
  await demoDataCube()
  await demoAsciiTable()
  await demoNodeBuffer()

  separator('Done!')
  console.log('All demos completed successfully.\n')
}

main().catch(console.error)
