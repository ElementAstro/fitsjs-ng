import { describe, expect, it } from 'vitest'
import { SERParseError } from '../../src/ser/ser-errors'
import { parseSERBlob, parseSERBuffer, parseSERBytes } from '../../src/ser/ser-parser'
import { buildSerSequence } from './ser-helpers'

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

  it('parses SER bytes from a contiguous Uint8Array', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 3,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })

    const parsed = parseSERBytes(new Uint8Array(buffer))
    expect(parsed.header.width).toBe(3)
    expect(parsed.header.height).toBe(2)
    expect(parsed.header.frameCount).toBe(2)
    expect(parsed.timestampsPresent).toBe(true)
    expect(parsed.bytes).toBeInstanceOf(Uint8Array)
    expect(parsed.buffer).toBe(buffer)
  })

  it('parses SER bytes from a non-zero byteOffset view', () => {
    const { buffer, frames } = buildSerSequence({
      colorId: 0,
      width: 3,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
      withTimestamps: false,
    })

    const source = new Uint8Array(buffer)
    const padded = new Uint8Array(source.byteLength + 11)
    padded.set(source, 5)
    const view = padded.subarray(5, 5 + source.byteLength)

    const parsed = parseSERBytes(view)
    expect(parsed.header.width).toBe(3)
    expect(parsed.header.height).toBe(2)
    expect(parsed.header.frameCount).toBe(1)
    expect(parsed.buffer).toBeUndefined()
    expect(parsed.bytes).toBe(view)

    const info = parsed.frameInfos[0]!
    expect(Array.from(parsed.bytes!.subarray(info.offset, info.offset + info.byteLength))).toEqual(
      Array.from(frames[0]!),
    )
  })
})
