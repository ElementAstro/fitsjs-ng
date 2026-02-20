import { XISFParseError } from './xisf-errors'

const XISF_SIGNATURE = 'XISF0100'
const SIGNATURE_LENGTH = 8
const HEADER_LENGTH_OFFSET = 8
const RESERVED_LENGTH = 4
const HEADER_OFFSET = SIGNATURE_LENGTH + 4 + RESERVED_LENGTH

export interface XISFMonolithicContainer {
  signature: string
  headerLength: number
  reserved: Uint8Array
  headerXml: string
  payload: Uint8Array
}

function readAscii(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes)
}

export function isMonolithicXISF(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_OFFSET) return false
  const signature = readAscii(new Uint8Array(buffer, 0, SIGNATURE_LENGTH))
  return signature === XISF_SIGNATURE
}

export function parseMonolithicContainer(buffer: ArrayBuffer): XISFMonolithicContainer {
  if (buffer.byteLength < HEADER_OFFSET) {
    throw new XISFParseError('Invalid XISF file: too short')
  }

  const signature = readAscii(new Uint8Array(buffer, 0, SIGNATURE_LENGTH))
  if (signature !== XISF_SIGNATURE) {
    throw new XISFParseError(`Invalid XISF signature: ${signature}`)
  }

  const view = new DataView(buffer)
  const headerLength = view.getUint32(HEADER_LENGTH_OFFSET, true)
  const headerBegin = HEADER_OFFSET
  const headerEnd = headerBegin + headerLength

  if (headerEnd > buffer.byteLength) {
    throw new XISFParseError('Invalid XISF header length')
  }

  const headerBytes = new Uint8Array(buffer, headerBegin, headerLength)
  const headerXml = new TextDecoder('utf-8').decode(headerBytes)
  const reserved = new Uint8Array(buffer, SIGNATURE_LENGTH + 4, RESERVED_LENGTH)
  const payload = new Uint8Array(buffer, headerEnd)

  return {
    signature,
    headerLength,
    reserved,
    headerXml,
    payload,
  }
}

export function extractAttachmentBytes(
  buffer: ArrayBuffer,
  position: number,
  size: number,
): Uint8Array {
  if (position < 0 || size < 0 || position + size > buffer.byteLength) {
    throw new XISFParseError(`Attachment block out of bounds: position=${position}, size=${size}`)
  }
  return new Uint8Array(buffer, position, size)
}

export function buildMonolithicContainer(
  headerXml: string,
  attachments: Array<{ position: number; data: Uint8Array }>,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(headerXml)
  const baseLength = HEADER_OFFSET + headerBytes.byteLength

  let total = baseLength
  for (const attachment of attachments) {
    const end = attachment.position + attachment.data.byteLength
    if (end > total) total = end
  }

  const out = new Uint8Array(total)
  out.set(new TextEncoder().encode(XISF_SIGNATURE), 0)
  const view = new DataView(out.buffer)
  view.setUint32(HEADER_LENGTH_OFFSET, headerBytes.byteLength, true)
  view.setUint32(SIGNATURE_LENGTH + 4, 0, true)
  out.set(headerBytes, HEADER_OFFSET)

  for (const attachment of attachments) {
    out.set(attachment.data, attachment.position)
  }

  return out
}

export const XISF_CONSTANTS = {
  XISF_SIGNATURE,
  SIGNATURE_LENGTH,
  RESERVED_LENGTH,
  HEADER_OFFSET,
}
