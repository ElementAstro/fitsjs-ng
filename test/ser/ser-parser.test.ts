import { describe, expect, it } from 'vitest'
import { SERParseError } from '../../src/ser/ser-errors'
import { parseSERBlob, parseSERBuffer } from '../../src/ser/ser-parser'

describe('ser/ser-parser', () => {
  it('throws parse error when buffer is too short', () => {
    expect(() => parseSERBuffer(new ArrayBuffer(10))).toThrowError(SERParseError)
  })

  it('throws parse error for invalid file id', () => {
    const buffer = new ArrayBuffer(178)
    const bytes = new Uint8Array(buffer)
    bytes.set(new TextEncoder().encode('NOT-A-SER-FILE'))
    expect(() => parseSERBuffer(buffer)).toThrowError(SERParseError)
  })

  it('rejects blob parsing for too-short data', async () => {
    const blob = new Blob([new Uint8Array(4)])
    await expect(parseSERBlob(blob)).rejects.toThrowError(SERParseError)
  })
})
