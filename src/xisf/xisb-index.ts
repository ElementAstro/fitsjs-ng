import { XISFParseError, XISFValidationError } from './xisf-errors'

const XISB_SIGNATURE = 'XISB0100'

export interface XISBIndexElement {
  uniqueId: bigint
  blockPosition: bigint
  blockLength: bigint
  uncompressedBlockLength: bigint
}

export interface XISBIndex {
  elements: XISBIndexElement[]
  byId: Map<bigint, XISBIndexElement>
}

function readAscii(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes)
}

function toNumber(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new XISFValidationError(`${name} exceeds Number.MAX_SAFE_INTEGER`)
  }
  return Number(value)
}

export function parseXISBIndex(buffer: ArrayBuffer): XISBIndex {
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength < 16) {
    throw new XISFParseError('Invalid XISB file: too short')
  }
  const signature = readAscii(bytes.slice(0, 8))
  if (signature !== XISB_SIGNATURE) {
    throw new XISFParseError(`Invalid XISB signature: ${signature}`)
  }

  const view = new DataView(buffer)
  const elements: XISBIndexElement[] = []

  let nodeOffset = 16
  const visited = new Set<number>()
  while (nodeOffset !== 0) {
    if (visited.has(nodeOffset)) {
      throw new XISFParseError('Invalid XISB index: cyclic block index list')
    }
    visited.add(nodeOffset)

    if (nodeOffset + 16 > bytes.byteLength) {
      throw new XISFParseError('Invalid XISB index node offset')
    }

    const length = view.getUint32(nodeOffset, true)
    const nextNode = view.getBigUint64(nodeOffset + 8, true)

    let elementOffset = nodeOffset + 16
    for (let i = 0; i < length; i++) {
      if (elementOffset + 40 > bytes.byteLength) {
        throw new XISFParseError('Invalid XISB index element offset')
      }
      const uniqueId = view.getBigUint64(elementOffset, true)
      const blockPosition = view.getBigUint64(elementOffset + 8, true)
      const blockLength = view.getBigUint64(elementOffset + 16, true)
      const uncompressedBlockLength = view.getBigUint64(elementOffset + 24, true)
      elements.push({ uniqueId, blockPosition, blockLength, uncompressedBlockLength })
      elementOffset += 40
    }

    nodeOffset = toNumber(nextNode, 'nextNode')
  }

  const byId = new Map<bigint, XISBIndexElement>()
  for (const item of elements) {
    byId.set(item.uniqueId, item)
  }

  return { elements, byId }
}

export function sliceXISBBlock(buffer: ArrayBuffer, element: XISBIndexElement): Uint8Array {
  if (element.blockPosition === BigInt(0) || element.blockLength === BigInt(0)) {
    throw new XISFValidationError('Cannot read free XISB index element')
  }
  const start = toNumber(element.blockPosition, 'blockPosition')
  const length = toNumber(element.blockLength, 'blockLength')
  const bytes = new Uint8Array(buffer)
  if (start + length > bytes.byteLength) {
    throw new XISFParseError('XISB block out of bounds')
  }
  return bytes.slice(start, start + length)
}

export function buildXISBFile(blocks: Uint8Array[]): { bytes: Uint8Array; ids: bigint[] } {
  const ids = blocks.map((_, i) => BigInt(i + 1))
  const headerSize = 16
  const nodeHeaderSize = 16
  const elementSize = 40
  const indexSize = nodeHeaderSize + blocks.length * elementSize
  let cursor = headerSize + indexSize

  const elements: XISBIndexElement[] = blocks.map((block, i) => {
    const blockPosition = BigInt(cursor)
    cursor += block.byteLength
    return {
      uniqueId: ids[i]!,
      blockPosition,
      blockLength: BigInt(block.byteLength),
      uncompressedBlockLength: BigInt(0),
    }
  })

  const total = cursor
  const out = new Uint8Array(total)
  out.set(new TextEncoder().encode(XISB_SIGNATURE), 0)

  const view = new DataView(out.buffer)
  let offset = headerSize
  view.setUint32(offset, elements.length, true)
  view.setUint32(offset + 4, 0, true)
  view.setBigUint64(offset + 8, BigInt(0), true)
  offset += nodeHeaderSize

  for (const element of elements) {
    view.setBigUint64(offset, element.uniqueId, true)
    view.setBigUint64(offset + 8, element.blockPosition, true)
    view.setBigUint64(offset + 16, element.blockLength, true)
    view.setBigUint64(offset + 24, element.uncompressedBlockLength, true)
    view.setBigUint64(offset + 32, BigInt(0), true)
    offset += elementSize
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const position = Number(elements[i]!.blockPosition)
    out.set(block, position)
  }

  return { bytes: out, ids }
}
