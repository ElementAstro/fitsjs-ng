import { BLOCK_LENGTH, LINE_WIDTH } from './constants'
import { Header } from './header'
import { HDU } from './hdu'
import { Image } from './image'
import { Table } from './table'
import { BinaryTable } from './binary-table'
import { CompressedImage } from './compressed-image'
import { excessBytes, uint8ArrayToString } from './utils'
import type { DataUnit } from './data-unit'
import type { DataUnitType, ReadOptions } from './types'

/**
 * Data unit factory: creates the appropriate data unit subclass based on header info.
 */
function createDataUnit(header: Header, data: ArrayBuffer | Blob): DataUnit | undefined {
  const type: DataUnitType | null = header.getDataType()
  if (!type) return undefined

  switch (type) {
    case 'Image':
      return new Image(header, data)
    case 'BinaryTable':
      return new BinaryTable(header, data)
    case 'Table':
      return new Table(header, data)
    case 'CompressedImage':
      return new CompressedImage(header, data)
    default:
      return undefined
  }
}

/**
 * Parse a FITS file from an ArrayBuffer.
 *
 * Reads 2880-byte blocks sequentially, looking for the END keyword
 * to delimit headers. After each header, the corresponding data unit
 * is sliced from the buffer and an HDU is created.
 *
 * @param buffer - The complete FITS file as an ArrayBuffer.
 * @returns Array of parsed HDUs.
 */
export function parseBuffer(buffer: ArrayBuffer, options?: ReadOptions): HDU[] {
  const hdus: HDU[] = []
  const totalLength = buffer.byteLength
  let offset = 0

  while (offset < totalLength) {
    // --- Read header blocks ---
    let blockCount = 0
    let headerStorage = new Uint8Array(0)
    let headerFound = false

    while (!headerFound && offset + blockCount * BLOCK_LENGTH + BLOCK_LENGTH <= totalLength) {
      const blockStart = offset + blockCount * BLOCK_LENGTH
      const blockBytes = new Uint8Array(buffer, blockStart, BLOCK_LENGTH)

      // Expand header storage
      const newStorage = new Uint8Array(headerStorage.length + BLOCK_LENGTH)
      newStorage.set(headerStorage, 0)
      newStorage.set(blockBytes, headerStorage.length)
      headerStorage = newStorage

      // Check block for END keyword (scanning rows bottom-up)
      const rows = BLOCK_LENGTH / LINE_WIDTH
      for (let row = rows - 1; row >= 0; row--) {
        const rowIndex = row * LINE_WIDTH
        const b = blockBytes[rowIndex]!

        // Skip whitespace rows
        if (b === 32) continue

        // Check for 'E' 'N' 'D' ' ' (69, 78, 68, 32)
        if (
          b === 69 &&
          blockBytes[rowIndex + 1] === 78 &&
          blockBytes[rowIndex + 2] === 68 &&
          blockBytes[rowIndex + 3] === 32
        ) {
          headerFound = true
          break
        }

        // If we hit a non-whitespace, non-END row, stop checking this block
        break
      }

      blockCount++

      if (!headerFound) {
        continue
      }

      // Parse header string
      const headerString = uint8ArrayToString(headerStorage)
      const header = new Header(headerString, options?.maxHeaderLines, options?.onWarning)

      // Calculate data unit position
      const headerEnd = offset + blockCount * BLOCK_LENGTH
      const dataLength = header.getDataLength()

      // Slice data unit bytes
      const dataSlice = buffer.slice(headerEnd, headerEnd + dataLength)

      // Create data unit if header indicates one
      let dataunit: DataUnit | undefined
      if (header.hasDataUnit()) {
        dataunit = createDataUnit(header, dataSlice)
      }

      // Store HDU
      hdus.push(new HDU(header, dataunit))

      // Advance offset past header + data + padding
      offset = headerEnd + dataLength + excessBytes(dataLength)

      // If we've reached the end of the file, stop
      if (offset >= totalLength) {
        break
      }
    }

    // Safety: if header was not found, break to avoid infinite loop
    if (!headerFound) {
      break
    }
  }

  return hdus
}

/**
 * Parse a FITS file from a Blob (File object) using streaming block reads.
 *
 * Reads header blocks incrementally (2880 bytes at a time) without loading
 * the entire file into memory. Data units are kept as Blob slices for
 * lazy on-demand reading, significantly reducing memory usage for large files.
 *
 * @param blob - The FITS file as a Blob or File object.
 * @returns Promise resolving to an array of parsed HDUs.
 */
export async function parseBlob(blob: Blob, options?: ReadOptions): Promise<HDU[]> {
  const hdus: HDU[] = []
  const totalLength = blob.size
  let offset = 0

  while (offset < totalLength) {
    // --- Read header blocks incrementally ---
    let blockCount = 0
    const headerChunks: Uint8Array[] = []
    let headerFound = false

    while (!headerFound && offset + blockCount * BLOCK_LENGTH + BLOCK_LENGTH <= totalLength) {
      const blockStart = offset + blockCount * BLOCK_LENGTH
      const blockBlob = blob.slice(blockStart, blockStart + BLOCK_LENGTH)
      const blockBuffer = await blockBlob.arrayBuffer()
      const blockBytes = new Uint8Array(blockBuffer)

      headerChunks.push(blockBytes)

      // Check block for END keyword (scanning rows bottom-up)
      const rows = BLOCK_LENGTH / LINE_WIDTH
      for (let row = rows - 1; row >= 0; row--) {
        const rowIndex = row * LINE_WIDTH
        const b = blockBytes[rowIndex]!

        if (b === 32) continue

        if (
          b === 69 &&
          blockBytes[rowIndex + 1] === 78 &&
          blockBytes[rowIndex + 2] === 68 &&
          blockBytes[rowIndex + 3] === 32
        ) {
          headerFound = true
          break
        }

        break
      }

      blockCount++

      if (!headerFound) {
        continue
      }

      // Assemble header string from chunks
      const totalHeaderBytes = headerChunks.reduce((sum, c) => sum + c.length, 0)
      const headerStorage = new Uint8Array(totalHeaderBytes)
      let pos = 0
      for (const chunk of headerChunks) {
        headerStorage.set(chunk, pos)
        pos += chunk.length
      }
      const headerString = uint8ArrayToString(headerStorage)
      const header = new Header(headerString, options?.maxHeaderLines, options?.onWarning)

      // Calculate data unit position
      const headerEnd = offset + blockCount * BLOCK_LENGTH
      const dataLength = header.getDataLength()

      // Create data unit using Blob slice (lazy — no data loaded yet)
      let dataunit: DataUnit | undefined
      if (header.hasDataUnit()) {
        const dataBlob = blob.slice(headerEnd, headerEnd + dataLength)
        dataunit = createDataUnit(header, dataBlob)
      }

      hdus.push(new HDU(header, dataunit))

      // Advance past header + data + padding
      offset = headerEnd + dataLength + excessBytes(dataLength)

      if (offset >= totalLength) {
        break
      }
    }

    if (!headerFound) {
      break
    }
  }

  return hdus
}
