/**
 * Test helpers for creating minimal FITS data structures in-memory.
 */

import { BLOCK_LENGTH, LINE_WIDTH } from '../../src/core/constants'

/**
 * Pad a string to exactly 80 characters (one FITS card).
 */
export function card(content: string): string {
  return content.padEnd(LINE_WIDTH, ' ')
}

/**
 * Create a FITS header block string from an array of card strings.
 * Automatically pads to a multiple of 2880 bytes.
 */
export function makeHeaderBlock(cards: string[]): string {
  // Add END card
  cards.push(card('END'))

  let block = cards.map((c) => c.padEnd(LINE_WIDTH, ' ')).join('')

  // Pad to multiple of BLOCK_LENGTH
  const remainder = block.length % BLOCK_LENGTH
  if (remainder !== 0) {
    block += ' '.repeat(BLOCK_LENGTH - remainder)
  }
  return block
}

/**
 * Convert a string to a Uint8Array (ASCII encoding).
 */
export function stringToUint8Array(str: string): Uint8Array {
  const arr = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i)
  }
  return arr
}

/**
 * Create a minimal FITS primary image (BITPIX=16, 2x2 pixels).
 * Returns an ArrayBuffer representing the complete FITS file.
 */
export function makeSimpleImage(
  width: number,
  height: number,
  bitpix: number,
  pixelValues: number[],
): ArrayBuffer {
  const cards = [
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(width).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(height).padStart(4)} / Height`),
  ]

  const headerStr = makeHeaderBlock(cards)
  const headerBytes = stringToUint8Array(headerStr)

  // Create data unit
  const bytesPerPixel = Math.abs(bitpix) / 8
  const dataLength = width * height * bytesPerPixel
  const paddedDataLength =
    dataLength + ((BLOCK_LENGTH - (dataLength % BLOCK_LENGTH)) % BLOCK_LENGTH)

  const totalLength = headerBytes.length + paddedDataLength
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)

  // Write header
  const headerView = new Uint8Array(buffer)
  headerView.set(headerBytes, 0)

  // Write pixel data in big-endian
  const dataOffset = headerBytes.length
  for (let i = 0; i < pixelValues.length; i++) {
    const val = pixelValues[i]!
    if (bitpix === 8) {
      view.setUint8(dataOffset + i, val)
    } else if (bitpix === 16) {
      view.setInt16(dataOffset + i * 2, val, false)
    } else if (bitpix === 32) {
      view.setInt32(dataOffset + i * 4, val, false)
    } else if (bitpix === -32) {
      view.setFloat32(dataOffset + i * 4, val, false)
    } else if (bitpix === -64) {
      view.setFloat64(dataOffset + i * 8, val, false)
    }
  }

  return buffer
}

/**
 * Create a FITS primary image with custom BZERO and BSCALE values.
 * Raw pixel values are written as-is; BZERO/BSCALE are header-only.
 */
export function makeSimpleImageWithBzero(
  width: number,
  height: number,
  bitpix: number,
  pixelValues: number[],
  bzero: number,
  bscale: number,
): ArrayBuffer {
  const cards = [
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(width).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(height).padStart(4)} / Height`),
    card(`BSCALE  =   ${String(bscale).padStart(20)} / Scale factor`),
    card(`BZERO   =   ${String(bzero).padStart(20)} / Zero offset`),
  ]

  const headerStr = makeHeaderBlock(cards)
  const headerBytes = stringToUint8Array(headerStr)

  const bytesPerPixel = Math.abs(bitpix) / 8
  const dataLength = width * height * bytesPerPixel
  const paddedDataLength =
    dataLength + ((BLOCK_LENGTH - (dataLength % BLOCK_LENGTH)) % BLOCK_LENGTH)

  const totalLength = headerBytes.length + paddedDataLength
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)

  const headerView = new Uint8Array(buffer)
  headerView.set(headerBytes, 0)

  const dataOffset = headerBytes.length
  for (let i = 0; i < pixelValues.length; i++) {
    const val = pixelValues[i]!
    if (bitpix === 8) {
      view.setUint8(dataOffset + i, val)
    } else if (bitpix === 16) {
      view.setInt16(dataOffset + i * 2, val, false)
    } else if (bitpix === 32) {
      view.setInt32(dataOffset + i * 4, val, false)
    } else if (bitpix === -32) {
      view.setFloat32(dataOffset + i * 4, val, false)
    } else if (bitpix === -64) {
      view.setFloat64(dataOffset + i * 8, val, false)
    }
  }

  return buffer
}

/**
 * Create a minimal FITS file with a primary header (no data) and an ASCII TABLE extension.
 */
export function makeImageWithTable(
  imageWidth: number,
  imageHeight: number,
  bitpix: number,
  pixelValues: number[],
  tableRows: string[],
  tableCols: { name: string; form: string }[],
): ArrayBuffer {
  // Primary image header
  const primaryCards = [
    card('SIMPLE  =                    T / Standard FITS'),
    card(`BITPIX  =                   ${String(bitpix).padStart(2)} / Bits per pixel`),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(imageWidth).padStart(4)} / Width`),
    card(`NAXIS2  =                 ${String(imageHeight).padStart(4)} / Height`),
    card('EXTEND  =                    T / Extensions may be present'),
  ]
  const primaryHeaderStr = makeHeaderBlock(primaryCards)
  const primaryHeaderBytes = stringToUint8Array(primaryHeaderStr)

  // Primary data
  const bytesPerPixel = Math.abs(bitpix) / 8
  const imageDataLength = imageWidth * imageHeight * bytesPerPixel
  const imagePaddedLength =
    imageDataLength + ((BLOCK_LENGTH - (imageDataLength % BLOCK_LENGTH)) % BLOCK_LENGTH)

  // Table extension
  const rowByteSize = tableRows[0]?.length ?? 0
  const nRows = tableRows.length

  const tableCards = [
    card("XTENSION= 'TABLE   '           / ASCII table extension"),
    card('BITPIX  =                    8 / Bits per pixel'),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  =                 ${String(rowByteSize).padStart(4)} / Row width in bytes`),
    card(`NAXIS2  =                 ${String(nRows).padStart(4)} / Number of rows`),
    card('PCOUNT  =                    0 / No extra parameters'),
    card('GCOUNT  =                    1 / One group'),
    card(`TFIELDS =                    ${tableCols.length} / Number of columns`),
  ]

  for (let i = 0; i < tableCols.length; i++) {
    const col = tableCols[i]!
    tableCards.push(card(`TTYPE${i + 1}  = '${col.name.padEnd(8)}'`))
    tableCards.push(card(`TFORM${i + 1}  = '${col.form.padEnd(8)}'`))
  }

  const tableHeaderStr = makeHeaderBlock(tableCards)
  const tableHeaderBytes = stringToUint8Array(tableHeaderStr)

  // Table data
  const tableDataLength = rowByteSize * nRows
  const tablePaddedLength =
    tableDataLength + ((BLOCK_LENGTH - (tableDataLength % BLOCK_LENGTH)) % BLOCK_LENGTH)

  // Assemble
  const totalLength =
    primaryHeaderBytes.length + imagePaddedLength + tableHeaderBytes.length + tablePaddedLength
  const buffer = new ArrayBuffer(totalLength)
  const uint8 = new Uint8Array(buffer)
  const view = new DataView(buffer)

  let offset = 0

  // Primary header
  uint8.set(primaryHeaderBytes, offset)
  offset += primaryHeaderBytes.length

  // Primary data
  for (let i = 0; i < pixelValues.length; i++) {
    const val = pixelValues[i]!
    if (bitpix === 16) {
      view.setInt16(offset + i * 2, val, false)
    } else if (bitpix === -32) {
      view.setFloat32(offset + i * 4, val, false)
    }
  }
  offset += imagePaddedLength

  // Table header
  uint8.set(tableHeaderBytes, offset)
  offset += tableHeaderBytes.length

  // Table data
  for (let r = 0; r < tableRows.length; r++) {
    const row = tableRows[r]!
    for (let c = 0; c < row.length; c++) {
      uint8[offset + r * rowByteSize + c] = row.charCodeAt(c)
    }
  }

  return buffer
}
