import { describe, expect, it } from 'vitest'
import {
  XISF_CONSTANTS,
  buildMonolithicContainer,
  extractAttachmentBytes,
  isMonolithicXISF,
  parseMonolithicContainer,
} from '../../src/xisf/xisf-container'
import { XISFParseError } from '../../src/xisf/xisf-errors'

describe('xisf/xisf-container', () => {
  it('builds and parses a monolithic container with attachments', () => {
    const headerXml = '<xisf version="1.0"></xisf>'
    const headerLen = new TextEncoder().encode(headerXml).byteLength
    const attachmentPos = XISF_CONSTANTS.HEADER_OFFSET + headerLen
    const attachment = Uint8Array.from([1, 2, 3, 4])

    const bytes = buildMonolithicContainer(headerXml, [
      { position: attachmentPos, data: attachment },
    ])
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    expect(isMonolithicXISF(buffer)).toBe(true)

    const parsed = parseMonolithicContainer(buffer)
    expect(parsed.headerXml).toBe(headerXml)
    const extracted = extractAttachmentBytes(buffer, attachmentPos, attachment.length)
    expect(Array.from(extracted)).toEqual([1, 2, 3, 4])
  })

  it('rejects out-of-bounds attachment extraction', () => {
    const buffer = new ArrayBuffer(8)
    expect(() => extractAttachmentBytes(buffer, 4, 8)).toThrowError(XISFParseError)
  })
})
